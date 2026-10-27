<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watchEffect, type Component } from 'vue';
import { useStore, type LabId } from './app/store';
import ControlBar from './ui/components/ControlBar.vue';
import RegisterPanel from './ui/components/RegisterPanel.vue';
import TerminalPanel from './ui/components/TerminalPanel.vue';
import StartLab from './ui/labs/StartLab.vue';
import CpuLab from './ui/labs/CpuLab.vue';
import EditorLab from './ui/labs/EditorLab.vue';
import MemoryLab from './ui/labs/MemoryLab.vue';
import DatapathLab from './ui/labs/DatapathLab.vue';
import BootLab from './ui/labs/BootLab.vue';
import KernelLab from './ui/labs/KernelLab.vue';
import ProcessLab from './ui/labs/ProcessLab.vue';
import DevicesLab from './ui/labs/DevicesLab.vue';
import TraceLab from './ui/labs/TraceLab.vue';
import ReferenceLab from './ui/labs/ReferenceLab.vue';
import LessonsLab from './ui/labs/LessonsLab.vue';
import ExamplesLab from './ui/labs/ExamplesLab.vue';
import WorkspacesLab from './ui/labs/WorkspacesLab.vue';

const s = useStore();

const LABS: { id: LabId; label: string; icon: string; component: Component; group: string }[] = [
  { id: 'start', label: 'Start', icon: '⌂', component: StartLab, group: 'Workbench' },
  { id: 'lessons', label: 'Guided lessons', icon: '✎', component: LessonsLab, group: 'Workbench' },
  { id: 'examples', label: 'Examples', icon: '❖', component: ExamplesLab, group: 'Workbench' },
  { id: 'cpu', label: 'CPU & registers', icon: '▣', component: CpuLab, group: 'Hardware' },
  { id: 'datapath', label: 'Datapath & micro-ops', icon: '⇄', component: DatapathLab, group: 'Hardware' },
  { id: 'memory', label: 'Memory & stack', icon: '▤', component: MemoryLab, group: 'Hardware' },
  { id: 'devices', label: 'Devices', icon: '⌨', component: DevicesLab, group: 'Hardware' },
  { id: 'editor', label: 'Assembly editor', icon: '✐', component: EditorLab, group: 'Software' },
  { id: 'boot', label: 'Boot & firmware', icon: '⏻', component: BootLab, group: 'Software' },
  { id: 'kernel', label: 'Kernel & interrupts', icon: '⚡', component: KernelLab, group: 'Software' },
  { id: 'processes', label: 'Processes & scheduling', icon: '☰', component: ProcessLab, group: 'Software' },
  { id: 'trace', label: 'Trace & breakpoints', icon: '≡', component: TraceLab, group: 'Debugger' },
  { id: 'workspaces', label: 'Workspaces', icon: '⛁', component: WorkspacesLab, group: 'Debugger' },
  { id: 'reference', label: 'Reference', icon: '?', component: ReferenceLab, group: 'Debugger' },
];
const groups = [...new Set(LABS.map((l) => l.group))];
const active = computed(() => LABS.find((l) => l.id === s.lab.value) ?? LABS[0]!);

watchEffect(() => {
  const t = s.theme.value;
  const dark = t === 'dark' || (t === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
});

function onKeydown(e: KeyboardEvent): void {
  const loaded = s.view.value?.loaded;
  if (e.key === 'F5') {
    e.preventDefault();
    if (!loaded) return;
    if (e.shiftKey) s.send({ type: 'stop' });
    else s.send({ type: s.view.value?.runState === 'running' ? 'pause' : 'run' });
  } else if (e.key === 'F10') {
    e.preventDefault();
    if (loaded) s.send({ type: e.shiftKey ? 'stepMicro' : 'stepInstruction' });
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    s.buildAndLoad();
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  if (!s.view.value?.loaded) s.buildAndLoad();
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="logo" aria-hidden="true">VC8</span>
        <div>
          <div class="title">Virtual CPU &amp; Kernel Workshop</div>
          <div class="subtitle">a custom educational 8-bit computer — not a model of any real CPU</div>
        </div>
      </div>
      <div class="machine-label mono" data-testid="machine-label">{{ s.view.value?.label ?? 'starting…' }}</div>
      <span
        v-if="s.buildStale.value"
        class="chip warn"
        title="The sources changed since the machine was loaded. Rebuilding power-cycles the machine with the new images."
      >
        sources changed since load
        <button class="btn small" @click="s.buildAndLoad()">Rebuild &amp; reload</button>
      </span>
      <div class="spacer" />
      <label class="theme">
        <span class="sr-only">Theme</span>
        <select v-model="s.theme.value" aria-label="Colour theme">
          <option value="system">System theme</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
    </header>
    <ControlBar />
    <div class="main">
      <nav class="nav" aria-label="Labs">
        <div v-for="g in groups" :key="g" class="navgroup">
          <div class="navgroup-title">{{ g }}</div>
          <button
            v-for="l in LABS.filter((x) => x.group === g)"
            :key="l.id"
            class="navitem"
            :class="{ active: s.lab.value === l.id }"
            :aria-current="s.lab.value === l.id ? 'page' : undefined"
            :data-testid="`nav-${l.id}`"
            @click="s.lab.value = l.id"
          >
            <span class="icon" aria-hidden="true">{{ l.icon }}</span
            >{{ l.label }}
          </button>
        </div>
        <div class="shortcuts faint">
          <div><span class="kbd">F5</span> run / pause</div>
          <div><span class="kbd">⇧F5</span> stop</div>
          <div><span class="kbd">F10</span> step</div>
          <div><span class="kbd">⇧F10</span> µ-step</div>
          <div><span class="kbd">Ctrl+↵</span> build &amp; load</div>
        </div>
      </nav>
      <main class="content" :aria-label="active.label">
        <KeepAlive>
          <component :is="active.component" :key="active.id" />
        </KeepAlive>
      </main>
      <aside class="dock" aria-label="Machine state">
        <RegisterPanel compact />
        <TerminalPanel />
      </aside>
    </div>
    <div v-if="s.notice.value" class="notice" :class="s.notice.value.kind" role="status" data-testid="notice">
      <span>{{ s.notice.value.text }}</span>
      <button class="btn small" aria-label="Dismiss" @click="s.notice.value = null">✕</button>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-rows: auto auto 1fr;
  height: 100vh;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.45rem 0.9rem;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.logo {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 0.75rem;
  background: var(--accent);
  color: #fff;
  border-radius: 4px;
  padding: 0.3rem 0.35rem;
}
.title {
  font-weight: 650;
}
.subtitle {
  font-size: 0.72rem;
  color: var(--muted);
}
.machine-label {
  font-size: 0.8rem;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40vw;
}
.spacer {
  flex: 1;
}
.main {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr) 330px;
  min-height: 0;
}
.nav {
  border-right: 1px solid var(--border);
  background: var(--panel);
  overflow: auto;
  padding: 0.5rem 0.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.navgroup-title {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--faint);
  padding: 0 0.5rem 0.2rem;
}
.navitem {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  text-align: left;
  border: 0;
  background: none;
  padding: 0.35rem 0.5rem;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.86rem;
}
.navitem:hover {
  background: var(--panel-2);
}
.navitem.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.icon {
  width: 1.1rem;
  text-align: center;
  color: var(--muted);
}
.shortcuts {
  margin-top: auto;
  font-size: 0.75rem;
  display: grid;
  gap: 0.2rem;
  padding: 0.5rem;
}
.content {
  overflow: auto;
  min-width: 0;
}
.dock {
  border-left: 1px solid var(--border);
  padding: 0.6rem;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 0.6rem;
  min-height: 0;
  overflow: hidden;
}
.notice {
  position: fixed;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  background: var(--panel);
  border: 1px solid var(--border-strong);
  border-left: 4px solid var(--accent);
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  display: flex;
  gap: 0.75rem;
  align-items: center;
  max-width: 80vw;
  z-index: 50;
}
.notice.error {
  border-left-color: var(--err);
}
.notice.success {
  border-left-color: var(--ok);
}
@media (max-width: 1100px) {
  .main {
    grid-template-columns: 170px minmax(0, 1fr);
  }
  .dock {
    display: none;
  }
}
@media (max-width: 760px) {
  .main {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
  .nav {
    flex-direction: row;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .shortcuts {
    display: none;
  }
}
</style>
