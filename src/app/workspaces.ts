/**
 * Workspace session: the current workspace (name, notes, snapshots) and the
 * operations of the Workspaces lab. Machine state is captured from and
 * restored to the machine host; nothing here changes the machine except the
 * explicit open/restore operations.
 */
import { computed, reactive, ref } from 'vue';
import { useStore, defaultDebugSettings, type DebugSettings } from './store';
import { defaultProject, hashSources, type Project } from './project';
import { exportWorkspace, importWorkspace, newId, type SnapshotRecord, type Workspace } from './workspace-format';
import { deleteWorkspace, getWorkspace, listWorkspaces, putWorkspace, type WorkspaceSummary } from './workspace-db';

interface Current {
  id: string | null;
  name: string;
  notes: string;
  createdAt: number;
  snapshots: SnapshotRecord[];
}

function copy<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function createWorkspaces() {
  const s = useStore();
  const current = reactive<Current>({
    id: null,
    name: 'Untitled workspace',
    notes: '',
    createdAt: Date.now(),
    snapshots: [],
  });
  const list = ref<WorkspaceSummary[]>([]);
  const storageError = ref<string | null>(null);
  const savedKey = ref<string | null>(null);

  /** What "unsaved changes" compares: sources, build configuration and notes. */
  const contentKey = computed(() => `${hashSources(s.project)}|${current.name}|${current.notes}`);
  const dirty = computed(() => savedKey.value !== contentKey.value);

  async function refresh(): Promise<void> {
    try {
      list.value = await listWorkspaces();
      storageError.value = null;
    } catch (e) {
      storageError.value = e instanceof Error ? e.message : String(e);
    }
  }

  async function machineRecord(name: string): Promise<SnapshotRecord | null> {
    const v = s.view.value;
    if (!v?.loaded) return null;
    const machine = await s.snapshot();
    return {
      id: newId(),
      name,
      createdAt: Date.now(),
      cycle: machine.cycle,
      label: v.label,
      sourceHash: s.loadedHash.value,
      machine,
    };
  }

  async function capture(): Promise<Workspace> {
    const now = Date.now();
    return {
      id: current.id ?? newId(),
      name: current.name.trim() || 'Untitled workspace',
      notes: current.notes,
      createdAt: current.createdAt,
      updatedAt: now,
      project: copy(s.project),
      debug: copy(s.debug),
      machine: await machineRecord('state at save'),
      snapshots: copy(current.snapshots),
    };
  }

  async function save(): Promise<void> {
    const ws = await capture();
    await putWorkspace(ws);
    current.id = ws.id;
    current.name = ws.name;
    savedKey.value = contentKey.value;
    await refresh();
    s.notify('success', `Saved workspace “${ws.name}”.`);
  }

  function applyProject(p: Project): void {
    s.project.mode = p.mode;
    s.project.bareMain = p.bareMain;
    for (const k of Object.keys(s.project.files)) if (!(k in p.files)) delete s.project.files[k];
    Object.assign(s.project.files, p.files);
    s.project.os.firmware = p.os.firmware;
    s.project.os.kernel = p.os.kernel;
    s.project.os.programs.splice(0, s.project.os.programs.length, ...p.os.programs.map((x) => ({ ...x })));
  }

  function applyDebug(d: DebugSettings): void {
    s.debug.breakpoints.splice(0, s.debug.breakpoints.length, ...d.breakpoints);
    s.debug.watchpoints.splice(
      0,
      s.debug.watchpoints.length,
      ...d.watchpoints.map(([a, k]) => [a, k] as [number, typeof k]),
    );
    Object.assign(s.debug.breakOn, d.breakOn);
    s.debug.traceEnabled = d.traceEnabled;
    s.debug.traceCapacity = d.traceCapacity;
    s.debug.speed = d.speed;
  }

  /**
   * Open a workspace: its sources are built and loaded, then the saved machine
   * state is restored if it was taken from exactly these sources.
   */
  async function open(id: string): Promise<boolean> {
    const ws = await getWorkspace(id);
    if (!ws) {
      s.notify('error', 'That workspace no longer exists.');
      await refresh();
      return false;
    }
    applyProject(ws.project);
    applyDebug(ws.debug);
    current.id = ws.id;
    current.name = ws.name;
    current.notes = ws.notes;
    current.createdAt = ws.createdAt;
    current.snapshots = copy(ws.snapshots);
    savedKey.value = contentKey.value;
    s.selectedFile.value =
      ws.project.mode === 'bare' ? ws.project.bareMain : (ws.project.os.programs[0]?.path ?? ws.project.bareMain);
    if (!s.buildAndLoad()) return false;
    if (ws.machine && ws.machine.sourceHash === s.loadedHash.value) {
      s.restore(ws.machine.machine);
      s.notify(
        'success',
        `Opened “${ws.name}” and restored its machine state (cycle ${ws.machine.cycle.toLocaleString('en-US')}).`,
      );
    } else if (ws.machine) {
      s.notify(
        'info',
        `Opened “${ws.name}”. Its saved machine state came from different sources, so the machine starts fresh.`,
      );
    }
    return true;
  }

  function newWorkspace(): void {
    applyProject(defaultProject());
    applyDebug(defaultDebugSettings());
    current.id = null;
    current.name = 'Untitled workspace';
    current.notes = '';
    current.createdAt = Date.now();
    current.snapshots = [];
    savedKey.value = null;
    s.selectedFile.value = s.project.bareMain;
    s.buildAndLoad();
  }

  async function duplicate(id: string): Promise<void> {
    const ws = await getWorkspace(id);
    if (!ws) return;
    const now = Date.now();
    await putWorkspace({ ...ws, id: newId(), name: `Copy of ${ws.name}`.slice(0, 80), createdAt: now, updatedAt: now });
    await refresh();
  }

  async function rename(id: string, name: string): Promise<void> {
    const n = name.trim().slice(0, 80);
    if (!n) return;
    const ws = await getWorkspace(id);
    if (!ws) return;
    await putWorkspace({ ...ws, name: n, updatedAt: Date.now() });
    if (current.id === id) {
      current.name = n;
      if (!dirty.value) savedKey.value = contentKey.value;
    }
    await refresh();
  }

  async function remove(id: string): Promise<void> {
    await deleteWorkspace(id);
    if (current.id === id) {
      current.id = null;
      savedKey.value = null;
    }
    await refresh();
  }

  /** Persist the snapshot list of the current workspace (saving it first if needed). */
  async function persistSnapshots(): Promise<void> {
    if (!current.id) {
      await save();
      return;
    }
    const ws = await getWorkspace(current.id);
    if (!ws) {
      await save();
      return;
    }
    await putWorkspace({ ...ws, snapshots: copy(current.snapshots), updatedAt: Date.now() });
    await refresh();
  }

  async function takeSnapshot(name: string): Promise<SnapshotRecord | null> {
    const rec = await machineRecord(name.trim() || `snapshot at cycle ${s.view.value?.cycle ?? 0}`);
    if (!rec) {
      s.notify('error', 'Nothing is loaded: there is no machine state to snapshot.');
      return null;
    }
    current.snapshots.push(rec);
    await persistSnapshots();
    s.notify('success', `Snapshot “${rec.name}” saved (cycle ${rec.cycle.toLocaleString('en-US')}).`);
    return rec;
  }

  function snapshotMatchesLoaded(rec: SnapshotRecord): boolean {
    return rec.sourceHash !== null && rec.sourceHash === s.loadedHash.value;
  }

  function restoreSnapshot(rec: SnapshotRecord): void {
    s.send({ type: 'pause' });
    s.restore(copy(rec.machine));
    s.notify(
      snapshotMatchesLoaded(rec) ? 'success' : 'info',
      snapshotMatchesLoaded(rec)
        ? `Restored “${rec.name}” (cycle ${rec.cycle.toLocaleString('en-US')}).`
        : `Restored “${rec.name}”. It was taken with different sources, so source and symbol views may not match.`,
    );
  }

  async function deleteSnapshot(id: string): Promise<void> {
    current.snapshots = current.snapshots.filter((x) => x.id !== id);
    if (current.id) await persistSnapshots();
  }

  async function exportCurrent(): Promise<{ name: string; text: string }> {
    const ws = await capture();
    return { name: ws.name, text: exportWorkspace(ws) };
  }

  async function exportById(id: string): Promise<{ name: string; text: string } | null> {
    const ws = await getWorkspace(id);
    return ws ? { name: ws.name, text: exportWorkspace(ws) } : null;
  }

  /** Validate and store an imported workspace. Throws ImportError with the reason. */
  async function importText(text: string): Promise<string> {
    const data = importWorkspace(text);
    const names = new Set(list.value.map((w) => w.name));
    let name = data.name;
    if (names.has(name)) name = `${name} (imported)`.slice(0, 80);
    const id = newId();
    await putWorkspace({ ...data, id, name, updatedAt: Date.now() });
    await refresh();
    return id;
  }

  return {
    current,
    list,
    storageError,
    dirty,
    refresh,
    save,
    open,
    newWorkspace,
    duplicate,
    rename,
    remove,
    takeSnapshot,
    restoreSnapshot,
    deleteSnapshot,
    snapshotMatchesLoaded,
    exportCurrent,
    exportById,
    importText,
  };
}

let instance: ReturnType<typeof createWorkspaces> | null = null;

export function useWorkspaces(): ReturnType<typeof createWorkspaces> {
  if (!instance) instance = createWorkspaces();
  return instance;
}

export function resetWorkspaces(): void {
  instance = null;
}
