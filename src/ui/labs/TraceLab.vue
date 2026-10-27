<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStore } from '../../app/store';
import TraceTable from '../components/TraceTable.vue';
import { labelResolver } from '../../app/project';
import type { TraceEntry } from '../../core/machine/trace';
import { disassembleBytes } from '../../core/asm/disassembler';
import { hex4, parseAddress } from '../format';

const s = useStore();
const filter = ref('all');
const bpText = ref('');
const wpText = ref('');
const wpKind = ref<'r' | 'w' | 'rw'>('w');
const v = computed(() => s.view.value);
const labels = computed(() => labelResolver(s.build.value));

function lookup(name: string): number | undefined {
  return s.symbol(name);
}

function addBp(): void {
  const a = parseAddress(bpText.value, lookup);
  if (a === null) return s.notify('error', `Unknown address or label: ${bpText.value}`);
  if (!s.debug.breakpoints.includes(a)) s.debug.breakpoints.push(a);
  bpText.value = '';
}

function addWp(): void {
  const a = parseAddress(wpText.value, lookup);
  if (a === null) return s.notify('error', `Unknown address or label: ${wpText.value}`);
  s.debug.watchpoints.push([a, wpKind.value]);
  wpText.value = '';
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportTrace(fmt: 'json' | 'csv'): Promise<void> {
  const all = await s.client.request<TraceEntry[]>({ type: 'getTrace' });
  if (fmt === 'json') {
    download('vc8-trace.json', JSON.stringify(all, null, 1), 'application/json');
    return;
  }
  const rows = ['seq,cycle,cycles,kind,mode,pc,bytes,instruction,changes'];
  for (const e of all) {
    const text = e.kind === 'instruction' ? (disassembleBytes(e.bytes, e.pc)[0]?.text ?? '') : e.kind;
    const ch = [
      ...e.regs.map((r) => `${r.name}=${r.new.toString(16)}`),
      ...e.mem.map((m) => `[${hex4(m.addr)}]=${m.new.toString(16)}`),
    ].join(' ');
    rows.push(
      [
        e.seq,
        e.cycle,
        e.cycles,
        e.kind,
        e.supervisor ? 'S' : 'U',
        hex4(e.pc),
        e.bytes.map((b) => b.toString(16)).join(' '),
        `"${text}"`,
        `"${ch}"`,
      ].join(','),
    );
  }
  download('vc8-trace.csv', rows.join('\n'), 'text/csv');
}
</script>

<template>
  <div class="lab">
    <div class="lab-title">
      <h1>Trace &amp; breakpoints</h1>
      <p>Every completed instruction, exception entry and reset, with register and memory changes (bounded history).</p>
    </div>
    <div class="layout">
      <section class="panel">
        <header>Breakpoints</header>
        <div class="body">
          <form class="row" @submit.prevent="addBp">
            <input
              v-model="bpText"
              type="text"
              placeholder="address or label"
              aria-label="Breakpoint address or label"
              data-testid="bp-input"
            />
            <button class="btn small" type="submit" data-testid="bp-add">Add</button>
            <button
              class="btn small"
              type="button"
              :disabled="!s.debug.breakpoints.length"
              @click="s.debug.breakpoints.splice(0)"
            >
              Clear all
            </button>
          </form>
          <ul class="list mono">
            <li v-for="(a, i) in s.debug.breakpoints" :key="a">
              ● {{ hex4(a) }} <span class="accent">{{ labels(a) ?? '' }}</span>
              <button
                class="btn small"
                :aria-label="`Remove breakpoint ${hex4(a)}`"
                @click="s.debug.breakpoints.splice(i, 1)"
              >
                ✕
              </button>
            </li>
            <li v-if="!s.debug.breakpoints.length" class="muted">
              None. Click the gutter in a disassembly or the editor.
            </li>
          </ul>
        </div>
      </section>
      <section class="panel">
        <header>Watchpoints</header>
        <div class="body">
          <form class="row" @submit.prevent="addWp">
            <input
              v-model="wpText"
              type="text"
              placeholder="address or label"
              aria-label="Watchpoint address or label"
            />
            <select v-model="wpKind" aria-label="Access">
              <option value="w">write</option>
              <option value="r">read</option>
              <option value="rw">read/write</option>
            </select>
            <button class="btn small" type="submit">Add</button>
          </form>
          <ul class="list mono">
            <li v-for="(w, i) in s.debug.watchpoints" :key="i">
              {{ w[1] }} {{ hex4(w[0]) }} <span class="accent">{{ labels(w[0]) ?? '' }}</span>
              <button
                class="btn small"
                :aria-label="`Remove watchpoint ${hex4(w[0])}`"
                @click="s.debug.watchpoints.splice(i, 1)"
              >
                ✕
              </button>
            </li>
            <li v-if="!s.debug.watchpoints.length" class="muted">None.</li>
          </ul>
          <div v-if="v?.lastWatchHit" class="mono small">
            last hit: {{ v.lastWatchHit.kind }} {{ hex4(v.lastWatchHit.addr) }} =
            {{ v.lastWatchHit.value.toString(16) }} by {{ hex4(v.lastWatchHit.pc) }} @ cycle {{ v.lastWatchHit.cycle }}
          </div>
        </div>
      </section>
      <section class="panel">
        <header>Stop on…</header>
        <div class="body checks">
          <label
            ><input v-model="s.debug.breakOn.faults" type="checkbox" /> faults (illegal instruction, privilege,
            memory)</label
          >
          <label><input v-model="s.debug.breakOn.traps" type="checkbox" /> traps (SYS, BRK)</label>
          <label><input v-model="s.debug.breakOn.interrupts" type="checkbox" /> hardware interrupts</label>
          <p class="faint small">The machine pauses before the CPU enters the handler, so you can inspect the cause.</p>
        </div>
      </section>
    </div>
    <section class="panel">
      <header>
        Execution trace
        <span class="spacer" />
        <label class="tl"><input v-model="s.debug.traceEnabled" type="checkbox" /> record</label>
        <label class="tl"
          >keep
          <select v-model.number="s.debug.traceCapacity" aria-label="Trace capacity">
            <option :value="1000">1 000</option>
            <option :value="5000">5 000</option>
            <option :value="20000">20 000</option>
            <option :value="100000">100 000</option>
          </select>
        </label>
        <select v-model="filter" aria-label="Trace filter">
          <option value="all">all</option>
          <option value="events">exceptions &amp; faults</option>
          <option value="user">user mode</option>
          <option value="supervisor">supervisor mode</option>
        </select>
        <button class="btn small" @click="exportTrace('csv')">Export CSV</button>
        <button class="btn small" @click="exportTrace('json')">Export JSON</button>
        <button class="btn small" @click="s.send({ type: 'clearTrace' })">Clear</button>
      </header>
      <div class="body scroll tracebox">
        <TraceTable :limit="300" :filter="filter" />
        <p class="faint small">
          Showing the newest 300 of {{ v?.traceTotal ?? 0 }} recorded entries (the UI receives a bounded window; export
          downloads everything retained).
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 0.75rem;
}
.row {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 0.4rem;
}
.row input {
  flex: 1;
  min-width: 0;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 0.82rem;
  display: grid;
  gap: 0.2rem;
}
.list li {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}
.list li .btn {
  margin-left: auto;
}
.accent {
  color: var(--accent);
}
.checks {
  display: grid;
  gap: 0.35rem;
}
.small {
  font-size: 0.78rem;
}
.tl {
  text-transform: none;
  font-weight: 400;
  display: flex;
  gap: 0.3rem;
  align-items: center;
}
.tracebox {
  max-height: 60vh;
}
</style>
