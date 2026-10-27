/**
 * The workbench store: the UI's view of the world.
 *
 * - `view` mirrors the latest MachineView published by the machine host; the
 *   UI never mutates machine state except by sending commands.
 * - `project` holds the editable sources and build configuration.
 * - `build` is the most recent build; `buildStale` tells the user that the
 *   sources changed since the machine was loaded (rebuilding is explicit).
 */
import { computed, reactive, ref, shallowRef, watch } from 'vue';
import { MachineClient } from '../host/client';
import type { Command, MachineView, SpeedSetting } from '../host/protocol';
import type { MachineSnapshot } from '../core/machine/machine';
import { buildProject, defaultProject, hashSources, type BuildOutput, type Project } from './project';

export type LabId =
  | 'start'
  | 'cpu'
  | 'editor'
  | 'memory'
  | 'datapath'
  | 'boot'
  | 'kernel'
  | 'processes'
  | 'devices'
  | 'trace'
  | 'lessons'
  | 'examples'
  | 'workspaces'
  | 'reference';

export interface DebugSettings {
  breakpoints: number[];
  watchpoints: [number, 'r' | 'w' | 'rw'][];
  breakOn: { faults: boolean; traps: boolean; interrupts: boolean };
  traceEnabled: boolean;
  traceCapacity: number;
  speed: SpeedSetting;
}

export function defaultDebugSettings(): DebugSettings {
  return {
    breakpoints: [],
    watchpoints: [],
    breakOn: { faults: true, traps: false, interrupts: false },
    traceEnabled: true,
    traceCapacity: 5000,
    speed: 100_000,
  };
}

export const SPEEDS: { label: string; value: SpeedSetting }[] = [
  { label: '2 Hz', value: 2 },
  { label: '10 Hz', value: 10 },
  { label: '50 Hz', value: 50 },
  { label: '250 Hz', value: 250 },
  { label: '1 kHz', value: 1000 },
  { label: '10 kHz', value: 10_000 },
  { label: '100 kHz', value: 100_000 },
  { label: '1 MHz', value: 1_000_000 },
  { label: 'Max', value: 'max' },
];

function createStore() {
  const client = MachineClient.create();
  const view = shallowRef<MachineView | null>(null);
  /** The view before the current one (for change highlighting). */
  const prevView = shallowRef<MachineView | null>(null);
  const hostError = ref<string | null>(null);
  const project = reactive<Project>(defaultProject());
  const build = shallowRef<BuildOutput | null>(null);
  const loadedHash = ref<string | null>(null);
  const debug = reactive<DebugSettings>(defaultDebugSettings());
  const lab = ref<LabId>('start');
  const selectedFile = ref<string>(project.bareMain);
  /** Line selected in the editor (1-based), used to link source and bytes. */
  const editorLine = ref<number | null>(null);
  /** Address the memory/disassembly views should focus on. */
  const focusAddress = ref<number | null>(null);
  const theme = ref<'light' | 'dark' | 'system'>('system');
  const notice = ref<{ kind: 'info' | 'error' | 'success'; text: string } | null>(null);

  client.onView((v) => {
    prevView.value = view.value;
    view.value = v;
  });
  client.onError((m) => {
    hostError.value = m;
    notify('error', m);
  });

  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  function notify(kind: 'info' | 'error' | 'success', text: string): void {
    notice.value = { kind, text };
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice.value = null), 6000);
  }

  function send(c: Command): void {
    client.send(c);
  }

  function syncDebug(): void {
    // Plain copies: reactive proxies cannot be posted to the worker.
    send({ type: 'setBreakpoints', addresses: [...debug.breakpoints] });
    send({ type: 'setWatchpoints', watchpoints: debug.watchpoints.map(([a, k]) => [a, k] as [number, 'r' | 'w' | 'rw']) });
    send({ type: 'setBreakOn', breakOn: { ...debug.breakOn } });
    send({ type: 'setTrace', enabled: debug.traceEnabled, capacity: debug.traceCapacity });
    send({ type: 'setSpeed', speed: debug.speed });
  }
  watch(debug, syncDebug, { deep: true });

  const currentHash = computed(() => hashSources(project));
  const buildStale = computed(() => loadedHash.value !== null && loadedHash.value !== currentHash.value);

  /** Assemble the project. Does not touch the running machine. */
  function runBuild(): BuildOutput {
    const out = buildProject(project);
    build.value = out;
    return out;
  }

  /** Build and, if successful, load into the machine (power-cycle). */
  function buildAndLoad(): boolean {
    const out = runBuild();
    if (!out.ok || !out.load) {
      notify('error', `Build failed: ${out.diagnostics.filter((d) => d.severity === 'error').length} error(s). See the Assembly Editor.`);
      return false;
    }
    send({ type: 'pause' });
    send({ type: 'load', request: out.load });
    syncDebug();
    loadedHash.value = out.sourceHash;
    notify('success', `Built and loaded ${out.load.label}. The machine was powered on with the new images.`);
    return true;
  }

  async function snapshot(): Promise<MachineSnapshot> {
    return client.request<MachineSnapshot>({ type: 'snapshot' });
  }

  function restore(s: MachineSnapshot): void {
    send({ type: 'restore', snapshot: s });
  }

  /** Run until `addr` is about to execute, using a temporary breakpoint. */
  let tempBreakpoint: number | null = null;
  function runTo(addr: number): void {
    if (!debug.breakpoints.includes(addr)) {
      debug.breakpoints.push(addr);
      tempBreakpoint = addr;
    }
    syncDebug();
    send({ type: 'run' });
  }
  watch(view, (v) => {
    if (tempBreakpoint !== null && v && v.runState === 'paused' && v.stop) {
      const i = debug.breakpoints.indexOf(tempBreakpoint);
      if (i >= 0) debug.breakpoints.splice(i, 1);
      tempBreakpoint = null;
    }
  });

  function symbol(name: string): number | undefined {
    return build.value?.symbols.find((x) => x.name === name)?.value;
  }

  function toggleBreakpoint(addr: number): void {
    const i = debug.breakpoints.indexOf(addr);
    if (i >= 0) debug.breakpoints.splice(i, 1);
    else debug.breakpoints.push(addr);
  }

  return {
    client,
    view,
    prevView,
    hostError,
    project,
    build,
    loadedHash,
    debug,
    lab,
    selectedFile,
    editorLine,
    focusAddress,
    theme,
    notice,
    buildStale,
    notify,
    send,
    syncDebug,
    runBuild,
    buildAndLoad,
    snapshot,
    restore,
    toggleBreakpoint,
    runTo,
    symbol,
  };
}

export type WorkbenchStore = ReturnType<typeof createStore>;

let store: WorkbenchStore | null = null;

export function useStore(): WorkbenchStore {
  if (!store) store = createStore();
  return store;
}

/** For tests: discard the singleton. */
export function resetStore(): void {
  store?.client.dispose();
  store = null;
}
