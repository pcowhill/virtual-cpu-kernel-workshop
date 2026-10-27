<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStore } from '../../app/store';
import { labelResolver } from '../../app/project';
import { causeLabel } from '../../core/machine/machine';
import { PSW, VECTOR_NAMES } from '../../core/isa/constants';
import { flagsString, hex2, hex4 } from '../format';
import { SYSCALL_NAMES } from '../osnames';

const s = useStore();
const v = computed(() => s.view.value);
const filter = ref<'all' | 'syscall' | 'irq' | 'fault'>('all');


const vectors = computed(() => {
  const view = v.value;
  if (!view) return [];
  const labels = labelResolver(s.build.value);
  const base = view.cpu.vbase;
  return Array.from({ length: 16 }, (_, i) => {
    const a = (base + 2 * i) & 0xffff;
    const target = view.memory[a]! | (view.memory[(a + 1) & 0xffff]! << 8);
    return { i, name: VECTOR_NAMES[i], target, label: target === 0xffff ? '(no handler)' : labels(target) ?? '' };
  });
});

const events = computed(() => {
  const list = (v.value?.events ?? []).filter((e) => e.type === 'exception' || e.type === 'rti' || e.type === 'halt' || e.type === 'wake');
  return list
    .filter((e) => {
      if (filter.value === 'all') return true;
      if (e.type !== 'exception') return false;
      if (filter.value === 'syscall') return e.vector === 4;
      if (filter.value === 'irq') return (e.vector ?? 0) >= 8;
      return (e.vector ?? 0) < 8 && e.vector !== 4;
    })
    .slice(-150)
    .reverse();
});

function describe(e: (typeof events.value)[number]): string {
  if (e.type === 'rti') return `RTI → ${e.toUser ? 'user' : 'supervisor'} mode at ${hex4(e.pc)}${e.toUser ? ` (window from ${hex4(e.ubase ?? 0)})` : ''}`;
  if (e.type === 'halt') return 'HLT: CPU waits for an interrupt line';
  if (e.type === 'wake') return 'woke from HLT';
  const v0 = e.vector ?? 0;
  let d = `vector ${v0} ${VECTOR_NAMES[v0]} — ${causeLabel(e.cause ?? 0)} from ${e.fromUser ? 'user' : 'supervisor'} PC=${hex4(e.fromPc ?? 0)} → handler ${hex4(e.pc)}`;
  if (v0 === 4 && e.r0 !== undefined) d += ` · syscall ${e.r0} (${SYSCALL_NAMES[e.r0] ?? 'unknown'})`;
  if (v0 === 3) d += ` · FADDR=${hex4(e.faddr ?? 0)}`;
  return d;
}

/** The kernel's most recent trap frame, if the kernel exports `kframe`. */
const frame = computed(() => {
  const view = v.value;
  const sym = s.build.value?.system?.kernelSymbols['kframe'];
  if (!view || sym === undefined) return null;
  const f = view.memory[sym]! | (view.memory[sym + 1]! << 8);
  if (f === 0) return null;
  const m = (o: number) => view.memory[(f + o) & 0xffff]!;
  return {
    at: f,
    usp: m(0) | (m(1) << 8),
    regs: [9, 8, 7, 6, 5, 4, 3, 2].map((o) => m(o)),
    psw: m(10),
    pc: m(11) | (m(12) << 8),
  };
});

const pic = computed(() => v.value?.devices.pic);
const ie = computed(() => ((v.value?.cpu.psw ?? 0) & PSW.I) !== 0);
</script>

<template>
  <div class="lab">
    <div class="lab-title">
      <h1>Kernel &amp; interrupts</h1>
      <p>
        Exceptions enter through the vector table at VBASE. The CPU pushes PC and PSW; the kernel saves everything else.
      </p>
    </div>
    <div class="layout">
      <section class="panel">
        <header>Vector table at VBASE = {{ hex4(v?.cpu.vbase ?? 0) }}</header>
        <div class="body">
          <table class="data mono">
            <thead><tr><th>#</th><th>event</th><th>handler</th><th></th></tr></thead>
            <tbody>
              <tr v-for="x in vectors" :key="x.i" :class="{ faint: x.target === 0xffff }">
                <td>{{ x.i }}</td>
                <td>{{ x.name }}</td>
                <td>{{ hex4(x.target) }}</td>
                <td class="accent">{{ x.label }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <div class="col">
        <section class="panel">
          <header>Interrupt controller</header>
          <div class="body">
            <table class="data mono">
              <thead><tr><th>line</th><th>device</th><th>pending</th><th>enabled (MASK)</th></tr></thead>
              <tbody>
                <tr v-for="(name, i) in ['timer', 'keyboard', 'storage']" :key="i">
                  <td>IRQ{{ i }}</td>
                  <td>{{ name }}</td>
                  <td><span class="chip" :class="(pic?.pending ?? 0) & (1 << i) ? 'warn' : ''">{{ (pic?.pending ?? 0) & (1 << i) ? 'asserted' : '—' }}</span></td>
                  <td>{{ (pic?.mask ?? 0) & (1 << i) ? 'yes' : 'no' }}</td>
                </tr>
              </tbody>
            </table>
            <p class="small">
              PSW.I = <b>{{ ie ? 1 : 0 }}</b> — an enabled, pending line interrupts the CPU at the next instruction boundary
              only when PSW.I = 1. Exception entry clears I.
            </p>
          </div>
        </section>
        <section class="panel">
          <header>Kernel's latest trap frame (kframe)</header>
          <div class="body mono small">
            <template v-if="frame">
              <div>frame at {{ hex4(frame.at) }} on the kernel stack</div>
              <div>saved by CPU: PC={{ hex4(frame.pc) }} PSW={{ hex2(frame.psw) }} ({{ flagsString(frame.psw) }})</div>
              <div>saved by kernel: USP={{ hex4(frame.usp) }} R0–R7={{ frame.regs.map(hex2).join(' ') }}</div>
            </template>
            <span v-else class="muted">Available when the OS is running (kernel symbol kframe).</span>
          </div>
        </section>
      </div>
    </div>
    <section class="panel">
      <header>
        Exceptions, interrupts and returns (newest first)
        <span class="spacer" />
        <select v-model="filter" aria-label="Filter events">
          <option value="all">all</option>
          <option value="syscall">system calls</option>
          <option value="irq">interrupts</option>
          <option value="fault">faults</option>
        </select>
      </header>
      <div class="body scroll log">
        <table class="data mono">
          <thead><tr><th>cycle</th><th>event</th></tr></thead>
          <tbody>
            <tr v-for="(e, i) in events" :key="i" :class="`e-${e.type}`">
              <td>{{ e.cycle }}</td>
              <td>{{ describe(e) }}</td>
            </tr>
            <tr v-if="!events.length"><td colspan="2" class="muted">No exceptions yet.</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: minmax(300px, 1fr) minmax(300px, 1.2fr);
  gap: 0.75rem;
  align-items: start;
}
.col {
  display: grid;
  gap: 0.75rem;
}
.small {
  font-size: 0.8rem;
}
.accent {
  color: var(--accent);
}
.log {
  max-height: 360px;
}
.e-exception td {
  background: var(--warn-soft);
}
.e-rti td {
  color: var(--muted);
}
</style>
