<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStore } from '../../app/store';
import Timeline from '../components/Timeline.vue';
import type { TimelineMarker } from '../../core/os/awareness';
import { flagsString, hex2, hex4 } from '../format';
import { causeLabel } from '../../core/machine/machine';
import { MAX_PROGRAMS } from '../../core/build/system';

const s = useStore();
const v = computed(() => s.view.value);
const os = computed(() => v.value?.os ?? null);
const windowSize = ref(60_000);
const selected = ref<TimelineMarker | null>(null);

const procAt = computed(() => (selected.value ? os.value?.processes.find((p) => p.index === selected.value!.index) : undefined));

const programFiles = computed(() =>
  Object.keys(s.project.files)
    .filter((f) => f.startsWith('programs/') && f.endsWith('.asm'))
    .sort(),
);

function addProgram(): void {
  if (s.project.os.programs.length >= MAX_PROGRAMS) return;
  const f = programFiles.value[0]!;
  s.project.os.programs.push({ name: f.slice(9, -4).slice(0, 8), path: f });
}

function setPath(i: number, path: string): void {
  const p = s.project.os.programs[i]!;
  p.path = path;
  p.name = path.slice(9, -4).slice(0, 8);
}

function bootOs(): void {
  s.project.mode = 'os';
  s.buildAndLoad();
}

const traceNear = computed(() => {
  const m = selected.value;
  if (!m) return [];
  return (v.value?.trace ?? []).filter((t) => Math.abs(t.cycle - m.cycle) < 40).slice(0, 6);
});
</script>

<template>
  <div class="lab">
    <div class="lab-title">
      <h1>Processes &amp; scheduling</h1>
      <p>
        The kernel's process table and a timeline of what the CPU executed. The kernel alone decides what runs; this
        view reads its data structures using the kernel's symbol table.
      </p>
    </div>
    <section class="panel">
      <header>
        Programs on the boot disk
        <span class="spacer" />
        <button class="btn small primary" data-testid="boot-programs" @click="bootOs">Build &amp; boot</button>
      </header>
      <div class="body progs">
        <div v-for="(p, i) in s.project.os.programs" :key="i" class="prog">
          <span class="mono faint">slot {{ i }} · pid {{ i + 1 }}</span>
          <select :value="p.path" :aria-label="`Program for slot ${i}`" @change="setPath(i, ($event.target as HTMLSelectElement).value)">
            <option v-for="f in programFiles" :key="f" :value="f">{{ f.slice(9) }}</option>
          </select>
          <button class="btn small" :aria-label="`Remove program in slot ${i}`" @click="s.project.os.programs.splice(i, 1)">✕</button>
        </div>
        <button class="btn small" :disabled="s.project.os.programs.length >= MAX_PROGRAMS" @click="addProgram">+ add program</button>
        <span class="faint small">Up to {{ MAX_PROGRAMS }} programs, each in its own 8 KiB slot. Rebuilding power-cycles the machine.</span>
      </div>
    </section>
    <template v-if="os">
      <section class="panel">
        <header>Process table (kernel memory at proc_table)</header>
        <div class="body scroll">
          <table class="data mono" data-testid="process-table">
            <thead>
              <tr>
                <th>pid</th><th>name</th><th>state</th><th>window</th><th>saved PC</th><th>saved SP (user)</th>
                <th>ticks</th><th>dispatches</th><th>syscalls</th><th>exit</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in os.processes" :key="p.index" :class="{ cur: p.index === os.current }">
                <td>{{ p.pid }}</td>
                <td>{{ p.name }}</td>
                <td>
                  <span class="chip" :class="{ ok: p.state === 'running', accent: p.state === 'ready', warn: p.state === 'blocked', err: p.state === 'exited' && p.faultCause }">
                    {{ p.state }}{{ p.state === 'blocked' ? ` (${p.wait})` : '' }}
                  </span>
                </td>
                <td>{{ hex4(p.base) }}–{{ hex4(p.limit - 1) }}</td>
                <td>{{ p.frame ? hex4(p.frame.pc) : p.state === 'running' ? 'on CPU' : '—' }}</td>
                <td>{{ p.frame ? hex4(p.frame.usp) : '—' }}</td>
                <td>{{ p.ticks }}</td>
                <td>{{ p.runs }}</td>
                <td>{{ p.syscalls }}</td>
                <td>{{ p.state === 'exited' ? (p.faultCause ? `killed: ${causeLabel(p.faultCause)}` : p.exitCode) : '' }}</td>
              </tr>
            </tbody>
          </table>
          <div class="frames">
            <div v-for="p in os.processes.filter((x) => x.frame)" :key="p.index" class="frame mono">
              <b>pid {{ p.pid }} saved context</b> (trap frame at {{ hex4(p.frame!.frameAddress) }}):
              R0–R7 {{ p.frame!.regs.map(hex2).join(' ') }} · PSW {{ hex2(p.frame!.psw) }} {{ flagsString(p.frame!.psw) }}
            </div>
          </div>
          <div class="muted small">timer ticks since boot: {{ os.ticks }} · running: {{ os.current === null ? 'none (idle or kernel)' : `pid ${os.current + 1}` }}</div>
        </div>
      </section>
      <section class="panel">
        <header>
          Scheduling timeline
          <span class="spacer" />
          <select v-model.number="windowSize" aria-label="Timeline window">
            <option :value="20_000">last 20k cycles</option>
            <option :value="60_000">last 60k cycles</option>
            <option :value="250_000">last 250k cycles</option>
            <option :value="1_000_000">last 1M cycles</option>
          </select>
        </header>
        <div class="body"><Timeline :window="windowSize" @select="(m) => (selected = m)" /></div>
      </section>
      <section v-if="selected" class="panel" data-testid="marker-details">
        <header>Selected event</header>
        <div class="body mono small">
          <div>cycle {{ selected.cycle }} · {{ selected.kind }} · {{ selected.detail }}</div>
          <div v-if="selected.pc">PC {{ hex4(selected.pc) }}{{ procAt ? ` in pid ${procAt.pid} (${procAt.name})` : '' }}</div>
          <div v-if="procAt?.frame">pid {{ procAt.pid }} now: saved PC {{ hex4(procAt.frame.pc) }}, R0–R7 {{ procAt.frame.regs.map(hex2).join(' ') }}</div>
          <div v-for="t in traceNear" :key="t.seq" class="faint">
            trace @{{ t.cycle }} {{ t.kind }} PC {{ hex4(t.pc) }} {{ t.regs.map((r) => `${r.name}=${r.new.toString(16)}`).join(' ') }}
          </div>
        </div>
      </section>
    </template>
    <div v-else class="panel"><div class="body muted">Boot the operating system to see processes.</div></div>
  </div>
</template>

<style scoped>
.progs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
}
.prog {
  display: flex;
  gap: 0.3rem;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 0.2rem 0.4rem;
}
tr.cur td {
  background: var(--ok-soft);
}
.frames {
  margin: 0.5rem 0;
  display: grid;
  gap: 0.2rem;
}
.frame,
.small {
  font-size: 0.78rem;
}
</style>
