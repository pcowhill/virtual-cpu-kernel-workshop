<script setup lang="ts">
import { nextTick, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue';
import { useStore } from '../../app/store';
import { useWorkspaces } from '../../app/workspaces';
import { ImportError, type SnapshotRecord } from '../../app/workspace-format';

const s = useStore();
const W = useWorkspaces();
const snapName = ref('');
const renaming = ref<string | null>(null);
const renameText = ref('');
/** Pending destructive action awaiting explicit confirmation. */
const confirming = ref<{ title: string; detail: string; action: () => Promise<unknown> | unknown } | null>(null);
const importError = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const dialog = ref<HTMLElement | null>(null);
const cancelBtn = ref<HTMLButtonElement | null>(null);
const renameInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null);
let returnFocus: HTMLElement | null = null;

onMounted(() => {
  void W.refresh();
  document.addEventListener('keydown', onDialogKey);
});
onBeforeUnmount(() => document.removeEventListener('keydown', onDialogKey));
// The lab is kept alive while hidden: an open dialog must not keep capturing keys.
onDeactivated(() => {
  confirming.value = null;
  returnFocus = null;
});

/** Ask for confirmation in a modal dialog; Cancel has the initial focus. */
function ask(title: string, detail: string, action: () => Promise<unknown> | unknown): void {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  confirming.value = { title, detail, action };
  void nextTick(() => cancelBtn.value?.focus());
}

function closeDialog(): void {
  confirming.value = null;
  const el = returnFocus;
  returnFocus = null;
  if (el?.isConnected) el.focus();
}

/** Escape closes the dialog; Tab stays inside it while it is open. */
function onDialogKey(e: KeyboardEvent): void {
  if (!confirming.value) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeDialog();
  } else if (e.key === 'Tab' && dialog.value) {
    const items = [...dialog.value.querySelectorAll<HTMLElement>('button')];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
    e.preventDefault();
    items[next]!.focus();
  }
}

async function confirmNow(): Promise<void> {
  const c = confirming.value;
  closeDialog();
  if (c) await run(c.action);
}

async function run(fn: () => Promise<unknown> | unknown): Promise<void> {
  try {
    await fn();
  } catch (e) {
    s.notify('error', `Workspace storage failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function openWs(id: string, name: string): void {
  if (W.dirty.value)
    ask(
      id === W.current.id ? `Reopen “${name}”?` : `Open “${name}”?`,
      id === W.current.id
        ? 'Your unsaved changes are replaced by the saved copy.'
        : 'Unsaved changes to the current workspace will be lost.',
      () => W.open(id),
    );
  else void run(() => W.open(id));
}

function newWs(): void {
  if (W.dirty.value)
    ask('Start a new workspace?', 'Unsaved changes to the current sources and notes will be lost.', W.newWorkspace);
  else W.newWorkspace();
}

async function snap(): Promise<void> {
  await run(() => W.takeSnapshot(snapName.value));
  snapName.value = '';
}

function startRename(id: string, name: string): void {
  renaming.value = id;
  renameText.value = name;
  void nextTick(() => {
    const el = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value;
    el?.focus();
    el?.select();
  });
}

async function finishRename(): Promise<void> {
  const id = renaming.value;
  renaming.value = null;
  if (id) await run(() => W.rename(id, renameText.value));
}

function download(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace'}.vc8.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function exportCurrent(): Promise<void> {
  await run(async () => {
    const { name, text } = await W.exportCurrent();
    download(name, text);
  });
}

async function exportOne(id: string): Promise<void> {
  await run(async () => {
    const r = await W.exportById(id);
    if (r) download(r.name, r.text);
  });
}

async function onImport(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  importError.value = null;
  if (!file) return;
  try {
    // The file is read as text and parsed as JSON data; nothing in it is executed.
    const id = await W.importText(await file.text());
    const ws = W.list.value.find((x) => x.id === id);
    s.notify('success', `Imported workspace “${ws?.name ?? file.name}”. Open it to load it into the machine.`);
  } catch (err) {
    importError.value =
      err instanceof ImportError
        ? `This file cannot be imported: ${err.message}.`
        : `Import failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function restore(rec: SnapshotRecord): void {
  W.restoreSnapshot(rec);
}

const when = (t: number) => new Date(t).toLocaleString();
</script>

<template>
  <div class="lab">
    <div class="lab-title">
      <h1>Workspaces</h1>
      <p>
        Save your sources, build configuration, debugger settings, notes and machine state in this browser (IndexedDB),
        take snapshots, and move workspaces between browsers as versioned JSON files.
      </p>
    </div>
    <div v-if="W.storageError.value" class="panel">
      <div class="body err" role="alert">Workspace storage is unavailable: {{ W.storageError.value }}</div>
    </div>
    <div class="layout">
      <section class="panel" aria-label="Current workspace">
        <header>
          Current workspace
          <span class="spacer" />
          <span v-if="W.dirty.value" class="chip warn" data-testid="ws-dirty">unsaved changes</span>
          <span v-else class="chip ok" data-testid="ws-saved">saved</span>
        </header>
        <div class="body form">
          <label>Name <input v-model="W.current.name" type="text" maxlength="80" data-testid="ws-name" /></label>
          <label>
            Experiment notes
            <textarea
              v-model="W.current.notes"
              rows="5"
              maxlength="100000"
              placeholder="What are you trying? What did you observe?"
              data-testid="ws-notes"
            ></textarea>
          </label>
          <div class="row">
            <button class="btn primary" data-testid="ws-save" @click="run(W.save)">Save</button>
            <button class="btn" data-testid="ws-new" @click="newWs">New</button>
            <button class="btn" data-testid="ws-export-current" @click="exportCurrent">Export…</button>
            <button class="btn" data-testid="ws-import" @click="fileInput?.click()">Import…</button>
            <input
              ref="fileInput"
              type="file"
              accept=".json,application/json"
              class="sr-only"
              aria-label="Workspace file to import"
              data-testid="ws-import-file"
              @change="onImport"
            />
          </div>
          <div v-if="importError" class="err small" role="alert" data-testid="ws-import-error">{{ importError }}</div>
          <p class="faint small">
            Saving stores the sources, build configuration, debugger settings, notes and the complete machine state
            (registers, memory, devices, storage, pending interrupts, cycle count). Opening rebuilds the sources and
            restores that state, so execution continues exactly where it was.
          </p>
        </div>
      </section>

      <section class="panel" aria-label="Machine snapshots">
        <header>Snapshots of this workspace</header>
        <div class="body">
          <form class="row" @submit.prevent="snap">
            <input
              v-model="snapName"
              type="text"
              maxlength="80"
              placeholder="snapshot name"
              aria-label="Snapshot name"
              data-testid="snap-name"
            />
            <button class="btn small primary" type="submit" :disabled="!s.view.value?.loaded" data-testid="snap-take">
              Take snapshot
            </button>
          </form>
          <div v-if="!W.current.snapshots.length" class="muted small">No snapshots yet.</div>
          <table v-else class="data" data-testid="snap-list">
            <thead>
              <tr>
                <th>name</th>
                <th>cycle</th>
                <th>machine</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in W.current.snapshots" :key="r.id">
                <td>{{ r.name }}</td>
                <td class="mono">{{ r.cycle.toLocaleString('en-US') }}</td>
                <td class="small">
                  {{ r.label }}
                  <span
                    v-if="!W.snapshotMatchesLoaded(r)"
                    class="chip warn"
                    title="Taken from different sources than the loaded machine"
                  >
                    other sources
                  </span>
                </td>
                <td class="acts">
                  <button class="btn small" :data-testid="`snap-restore-${r.name}`" @click="restore(r)">Restore</button>
                  <button
                    class="btn small"
                    :aria-label="`Delete snapshot ${r.name}`"
                    @click="ask(`Delete snapshot “${r.name}”?`, 'This cannot be undone.', () => W.deleteSnapshot(r.id))"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <section class="panel" aria-label="Saved workspaces">
      <header>Saved in this browser</header>
      <div class="body">
        <div v-if="!W.list.value.length" class="muted">No saved workspaces yet.</div>
        <table v-else class="data" data-testid="ws-list">
          <thead>
            <tr>
              <th>name</th>
              <th>mode</th>
              <th>snapshots</th>
              <th>last saved</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="w in W.list.value" :key="w.id" :class="{ cur: w.id === W.current.id }">
              <td>
                <form v-if="renaming === w.id" class="row" @submit.prevent="finishRename">
                  <input
                    ref="renameInput"
                    v-model="renameText"
                    type="text"
                    maxlength="80"
                    aria-label="New name"
                    data-testid="ws-rename-input"
                    @keydown.esc.stop="renaming = null"
                  />
                  <button class="btn small" type="submit">OK</button>
                  <button class="btn small" type="button" @click="renaming = null">Cancel</button>
                </form>
                <template v-else>
                  {{ w.name }} <span v-if="w.id === W.current.id" class="chip accent">open</span>
                </template>
              </td>
              <td>{{ w.mode === 'os' ? 'operating system' : 'bare metal' }}</td>
              <td class="mono">{{ w.snapshots }}</td>
              <td class="small">{{ when(w.updatedAt) }}</td>
              <td class="acts">
                <button class="btn small primary" :data-testid="`ws-open-${w.name}`" @click="openWs(w.id, w.name)">
                  Open
                </button>
                <button class="btn small" @click="run(() => W.duplicate(w.id))">Duplicate</button>
                <button class="btn small" :data-testid="`ws-rename-${w.name}`" @click="startRename(w.id, w.name)">
                  Rename
                </button>
                <button class="btn small" @click="exportOne(w.id)">Export</button>
                <button
                  class="btn small"
                  :data-testid="`ws-delete-${w.name}`"
                  @click="
                    ask(
                      `Delete workspace “${w.name}”?`,
                      'Its sources, notes and snapshots are removed from this browser. This cannot be undone.',
                      () => W.remove(w.id),
                    )
                  "
                >
                  Delete
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="confirming" class="modal-backdrop" @click.self="closeDialog">
      <div
        ref="dialog"
        class="modal panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-detail"
        data-testid="confirm-dialog"
      >
        <header id="confirm-title">{{ confirming.title }}</header>
        <div class="body">
          <p id="confirm-detail">{{ confirming.detail }}</p>
          <div class="row">
            <button ref="cancelBtn" class="btn" data-testid="confirm-no" @click="closeDialog">Cancel</button>
            <button class="btn danger" data-testid="confirm-yes" @click="confirmNow">Yes, continue</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.75rem;
  align-items: start;
}
.form {
  display: grid;
  gap: 0.6rem;
}
.form label {
  display: grid;
  gap: 0.25rem;
}
.form textarea {
  font: inherit;
  resize: vertical;
}
.row {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  align-items: center;
}
.acts {
  white-space: nowrap;
  text-align: right;
}
tr.cur td {
  background: var(--accent-soft);
}
.err {
  color: var(--err);
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 0.35);
  display: grid;
  place-items: center;
  z-index: 50;
}
.modal {
  max-width: 28rem;
  width: calc(100% - 2rem);
}
.btn.danger {
  border-color: var(--err);
  color: var(--err);
}
@media (max-width: 1100px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
