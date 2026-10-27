<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useStore } from '../../app/store';
import CodeEditor from '../components/CodeEditor.vue';
import { hex2, hex4 } from '../format';
import { sourceFor } from '../../app/project';
import { disassembleBytes } from '../../core/asm/disassembler';

const s = useStore();
const p = s.project;
const filter = ref('');
const newName = ref('');
const tab = ref<'listing' | 'symbols' | 'bytes'>('listing');
const revealLine = ref<number | null>(null);

const files = computed(() =>
  Object.keys(p.files)
    .filter((f) => f.toLowerCase().includes(filter.value.toLowerCase()))
    .sort(),
);
const groups = computed(() => {
  const g = new Map<string, string[]>();
  for (const f of files.value) {
    const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.';
    g.set(dir, [...(g.get(dir) ?? []), f]);
  }
  return [...g.entries()];
});

const text = computed({
  get: () => p.files[s.selectedFile.value] ?? '',
  set: (v: string) => {
    p.files[s.selectedFile.value] = v;
  },
});

const build = computed(() => s.build.value);

/** The component builds that include the selected file (directly or via .include). */
const listing = computed(() => {
  const b = build.value;
  if (!b) return [];
  const out: { component: string; address: number | null; bytes: number[]; line: number; source: string }[] = [];
  for (const c of b.components) {
    for (const l of c.result.listing) {
      if (l.file === s.selectedFile.value)
        out.push({ component: c.component, address: l.address, bytes: l.bytes, line: l.line, source: l.source });
    }
  }
  return out;
});

const diagnostics = computed(() => {
  const m = new Map<number, { severity: 'error' | 'warning'; message: string }>();
  for (const d of build.value?.diagnostics ?? [])
    if (d.file === s.selectedFile.value && !m.has(d.line)) m.set(d.line, d);
  return m;
});

/**
 * The build the machine runs, if the sources still match it. Breakpoints and
 * the PC marker map lines to addresses through it; after an edit they are
 * unavailable until the next Build & load.
 */
const machineBuild = computed(() => (s.buildStale.value ? null : s.loadedBuild.value));

const lineToAddress = computed(() => {
  const m = new Map<number, number>();
  for (const c of machineBuild.value?.components ?? [])
    for (const l of c.result.listing)
      if (l.file === s.selectedFile.value && l.bytes.length && l.address !== null && !m.has(l.line))
        m.set(l.line, l.address);
  return m;
});
const codeLines = computed(() => {
  const set = new Set<number>();
  for (const e of machineBuild.value?.sourceMap ?? [])
    if (e.file === s.selectedFile.value && e.kind === 'instruction') set.add(e.line);
  return set;
});
const bpLines = computed(() => {
  const set = new Set<number>();
  for (const [line, addr] of lineToAddress.value) if (s.debug.breakpoints.includes(addr)) set.add(line);
  return set;
});
const pcLine = computed(() => {
  const v = s.view.value;
  if (!v) return null;
  const e = sourceFor(machineBuild.value, v.cpu.pc);
  return e && e.file === s.selectedFile.value ? e.line : null;
});

const cursor = computed(() => {
  const line = s.editorLine.value;
  if (!line) return null;
  return listing.value.find((l) => l.line === line) ?? null;
});

watch(
  () => s.selectedFile.value,
  () => {
    revealLine.value = null;
  },
);

function toggleBp(line: number): void {
  const a = lineToAddress.value.get(line);
  if (a !== undefined) s.toggleBreakpoint(a);
}

function selectLine(line: number): void {
  s.editorLine.value = line;
  revealLine.value = line;
}

function goToDiagnostic(file: string, line: number): void {
  if (p.files[file] === undefined) return;
  s.selectedFile.value = file;
  selectLine(line);
}

function newFile(): void {
  let name = newName.value.trim();
  if (!name) return;
  if (!name.endsWith('.asm') && !name.endsWith('.inc')) name += '.asm';
  if (!name.includes('/')) name = `user/${name}`;
  if (p.files[name] !== undefined) {
    s.notify('error', `${name} already exists.`);
    return;
  }
  p.files[name] =
    `; ${name}\n        .include "vc8.inc"\n\n        .org 0x0000\n        .word start\n\n        .org 0x0100\nstart:  NOP\n        HLT\n`;
  s.selectedFile.value = name;
  newName.value = '';
}

function useAsProgram(): void {
  p.mode = 'bare';
  p.bareMain = s.selectedFile.value;
  s.buildAndLoad();
}

/** The bytes emitted for the selected file, with the source line of each byte. */
const byteRows = computed(() => {
  const rows: { address: number; line: number; bytes: number[]; text: string }[] = [];
  for (const l of listing.value) {
    if (l.address === null || !l.bytes.length) continue;
    const dis = disassembleBytes(l.bytes, l.address);
    const isCode = codeLines.value.has(l.line);
    rows.push({
      address: l.address,
      line: l.line,
      bytes: l.bytes,
      text: isCode ? dis.map((d) => d.text).join('; ') : '(data)',
    });
  }
  return rows;
});
</script>

<template>
  <div class="lab">
    <div class="lab-title">
      <h1>Assembly editor</h1>
      <p>
        Edit firmware, kernel, programs and examples. Building is explicit: the running machine is never changed
        silently.
      </p>
    </div>
    <div class="layout">
      <aside class="panel files">
        <header>Files</header>
        <div class="body">
          <input v-model="filter" type="text" placeholder="Filter files" aria-label="Filter files" class="filter" />
          <div v-for="[dir, fs] in groups" :key="dir" class="dir">
            <div class="dirname faint">{{ dir }}/</div>
            <button
              v-for="f in fs"
              :key="f"
              class="file mono"
              :class="{ active: f === s.selectedFile.value }"
              :data-testid="`file-${f}`"
              @click="s.selectedFile.value = f"
            >
              {{ f.slice(dir.length + 1) }}
            </button>
          </div>
          <form class="new" @submit.prevent="newFile">
            <input v-model="newName" type="text" placeholder="new file name" aria-label="New file name" />
            <button class="btn small" type="submit">New</button>
          </form>
        </div>
      </aside>
      <div class="main">
        <section class="panel">
          <header>
            <span class="mono" style="text-transform: none">{{ s.selectedFile.value }}</span>
            <span class="spacer" />
            <button
              class="btn small"
              title="Assemble only (does not touch the machine)"
              data-testid="assemble"
              @click="s.runBuild()"
            >
              Assemble
            </button>
            <button
              class="btn small primary"
              title="Assemble and power-cycle the machine with the new images (Ctrl+Enter)"
              data-testid="build-load"
              @click="s.buildAndLoad()"
            >
              Build &amp; load
            </button>
          </header>
          <div class="body buildcfg">
            <label>
              Machine
              <select v-model="p.mode" aria-label="Machine configuration" data-testid="mode">
                <option value="bare">Bare metal (program in ROM, no OS)</option>
                <option value="os">Operating system (firmware + kernel + programs)</option>
              </select>
            </label>
            <label v-if="p.mode === 'bare'">
              Program
              <select v-model="p.bareMain" aria-label="Bare-metal program">
                <option
                  v-for="f in Object.keys(p.files).filter(
                    (x) => x.endsWith('.asm') && !x.startsWith('kernel/') && !x.startsWith('programs/'),
                  )"
                  :key="f"
                  :value="f"
                >
                  {{ f }}
                </option>
              </select>
            </label>
            <span v-if="p.mode === 'os'" class="muted">
              Programs: {{ p.os.programs.map((x) => x.name).join(', ') }} — configure them in the Processes lab.
            </span>
            <button
              v-if="p.mode === 'os' || p.bareMain !== s.selectedFile.value"
              class="btn small"
              @click="useAsProgram"
            >
              Run this file bare-metal
            </button>
          </div>
          <div v-if="s.buildStale.value" class="body stale small" role="note">
            The sources differ from the loaded machine: breakpoints and the PC marker return after
            <b>Build &amp; load</b>.
          </div>
          <CodeEditor
            v-model="text"
            :diagnostics="diagnostics"
            :breakpoints="bpLines"
            :code-lines="codeLines"
            :pc-line="pcLine"
            :reveal-line="revealLine"
            :label="`Source of ${s.selectedFile.value}`"
            @toggle-breakpoint="toggleBp"
            @cursor="(l) => (s.editorLine.value = l)"
          />
        </section>
        <section class="panel" aria-label="Build diagnostics">
          <header>
            Diagnostics
            <span v-if="build" class="chip" :class="build.ok ? 'ok' : 'err'" data-testid="build-status">
              {{ build.ok ? 'build OK' : `${build.diagnostics.filter((d) => d.severity === 'error').length} error(s)` }}
            </span>
          </header>
          <div class="body diag">
            <div v-if="!build" class="muted">Not built yet.</div>
            <div v-else-if="!build.diagnostics.length" class="muted">No problems.</div>
            <button
              v-for="(d, i) in build?.diagnostics ?? []"
              :key="i"
              class="dline mono"
              :class="d.severity"
              data-testid="diagnostic"
              @click="goToDiagnostic(d.file, d.line)"
            >
              <b>{{ d.severity }}</b> {{ d.file }}:{{ d.line }}{{ d.column ? `:${d.column}` : '' }} [{{ d.component }}]
              — {{ d.message }}
            </button>
          </div>
        </section>
      </div>
      <aside class="panel inspector">
        <header>
          <div class="tabs" role="tablist">
            <button
              v-for="t in ['listing', 'bytes', 'symbols'] as const"
              :key="t"
              class="btn small"
              :class="{ primary: tab === t }"
              role="tab"
              :aria-selected="tab === t"
              @click="tab = t"
            >
              {{ t }}
            </button>
          </div>
        </header>
        <div class="body">
          <div v-if="cursor" class="cursorinfo mono" data-testid="line-bytes">
            line {{ cursor.line }} →
            <template v-if="cursor.address !== null && cursor.bytes.length">
              {{ hex4(cursor.address) }}: {{ cursor.bytes.map(hex2).join(' ') }}
            </template>
            <template v-else>no bytes</template>
          </div>
        </div>
        <div class="body scroll pane">
          <table v-if="tab === 'listing'" class="data mono">
            <thead>
              <tr>
                <th>line</th>
                <th>addr</th>
                <th>bytes</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="l in listing.filter((x) => x.bytes.length)"
                :key="l.component + l.line"
                class="clickable"
                :class="{ selected: l.line === s.editorLine.value }"
                @click="selectLine(l.line)"
              >
                <td>{{ l.line }}</td>
                <td>{{ l.address !== null ? hex4(l.address) : '' }}</td>
                <td class="wrap">
                  {{ l.bytes.slice(0, 8).map(hex2).join(' ') }}{{ l.bytes.length > 8 ? ` … (${l.bytes.length})` : '' }}
                </td>
              </tr>
            </tbody>
          </table>
          <table v-else-if="tab === 'bytes'" class="data mono">
            <thead>
              <tr>
                <th>addr</th>
                <th>bytes → source</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in byteRows"
                :key="r.address"
                class="clickable"
                :class="{ selected: r.line === s.editorLine.value }"
                :title="`Go to line ${r.line}`"
                @click="selectLine(r.line)"
              >
                <td>{{ hex4(r.address) }}</td>
                <td class="wrap">
                  {{ r.bytes.slice(0, 6).map(hex2).join(' ') }}
                  <span class="faint">→ {{ r.text }} (line {{ r.line }})</span>
                </td>
              </tr>
            </tbody>
          </table>
          <table v-else class="data mono">
            <thead>
              <tr>
                <th>symbol</th>
                <th>value</th>
                <th>kind</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="sym in (build?.symbols ?? []).filter(
                  (x) => x.file === s.selectedFile.value || x.kind === 'predefined',
                )"
                :key="sym.component + sym.name"
                class="clickable"
                @click="goToDiagnostic(sym.file, sym.line)"
              >
                <td>{{ sym.name }}</td>
                <td>{{ hex4(sym.value) }}</td>
                <td class="faint">{{ sym.kind }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr) 300px;
  gap: 0.75rem;
  align-items: start;
}
.files .body {
  display: grid;
  gap: 0.4rem;
  max-height: 80vh;
  overflow: auto;
}
.filter {
  width: 100%;
}
.dirname {
  font-size: 0.75rem;
  margin-top: 0.3rem;
}
.file {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  background: none;
  padding: 0.12rem 0.4rem;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.8rem;
}
.file:hover {
  background: var(--panel-2);
}
.file.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.new {
  display: flex;
  gap: 0.3rem;
  margin-top: 0.5rem;
}
.new input {
  width: 100%;
}
.main {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}
.buildcfg {
  display: flex;
  gap: 0.8rem;
  align-items: center;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
  font-size: 0.85rem;
}
.diag {
  display: grid;
  gap: 0.2rem;
  max-height: 200px;
  overflow: auto;
}
.dline {
  text-align: left;
  border: 0;
  background: none;
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0.15rem 0.3rem;
  border-radius: 3px;
}
.dline.error b {
  color: var(--err);
}
.dline.warning b {
  color: var(--warn);
}
.dline:hover {
  background: var(--panel-2);
}
.tabs {
  display: flex;
  gap: 0.2rem;
  text-transform: none;
}
.pane {
  max-height: 70vh;
  padding-top: 0;
}
.cursorinfo {
  font-size: 0.8rem;
  background: var(--accent-soft);
  border-radius: 4px;
  padding: 0.3rem 0.4rem;
}
.wrap {
  white-space: normal;
}
@media (max-width: 1350px) {
  .layout {
    grid-template-columns: 180px minmax(0, 1fr);
  }
  .inspector {
    grid-column: 1 / -1;
  }
}
.stale {
  color: var(--warn, inherit);
  border-bottom: 1px solid var(--border);
}
</style>
