<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStore } from '../../app/store';
import { bin8, hex2, hex4, signed8 } from '../format';
import { PSW } from '../../core/isa/constants';

defineProps<{ compact?: boolean }>();
const s = useStore();
const v = computed(() => s.view.value);
const fmt = ref<'hex' | 'dec' | 'bin'>('hex');

const regs = computed(() => v.value?.cpu ?? null);

/** True if register i (0-7 = R0-R7, 8 = PC, 9 = SP, 10 = PSW) changed since the previous view. */
function changed(i: number): boolean {
  const a = s.prevView.value?.cpu;
  const b = v.value?.cpu;
  if (!a || !b) return false;
  const pick = (c: typeof b) => (i < 8 ? c.r[i] : i === 8 ? c.pc : i === 9 ? c.sp : c.psw);
  return pick(a) !== pick(b);
}

function show8(x: number): string {
  if (fmt.value === 'dec') return `${x} / ${signed8(x)}`;
  if (fmt.value === 'bin') return bin8(x);
  return hex2(x);
}

const flags = computed(() => {
  const p = v.value?.cpu.psw ?? 0;
  return [
    { name: 'S', on: !!(p & PSW.S), title: 'Supervisor mode' },
    { name: 'I', on: !!(p & PSW.I), title: 'Interrupts enabled' },
    { name: 'V', on: !!(p & PSW.V), title: 'Signed overflow' },
    { name: 'N', on: !!(p & PSW.N), title: 'Negative (bit 7)' },
    { name: 'Z', on: !!(p & PSW.Z), title: 'Zero' },
    { name: 'C', on: !!(p & PSW.C), title: 'Carry / borrow' },
  ];
});
</script>

<template>
  <section class="panel registers" aria-label="CPU registers">
    <header>
      Registers
      <span class="spacer" />
      <div class="fmt" role="radiogroup" aria-label="Number format">
        <button
          v-for="f in ['hex', 'dec', 'bin'] as const"
          :key="f"
          class="btn small"
          :class="{ primary: fmt === f }"
          role="radio"
          :aria-checked="fmt === f"
          @click="fmt = f"
        >
          {{ f }}
        </button>
      </div>
    </header>
    <div v-if="regs" class="body">
      <table class="regs mono">
        <tbody>
          <tr v-for="i in 4" :key="i">
            <template v-for="j in [2 * (i - 1), 2 * (i - 1) + 1]" :key="j">
              <th :title="`R${j} — part of pair P${Math.floor(j / 2)}`">R{{ j }}</th>
              <td :class="{ changed: changed(j) }" :data-testid="`reg-R${j}`">{{ show8(regs.r[j]!) }}</td>
            </template>
            <th class="pair" :title="`P${i - 1} = R${2 * (i - 1)}:R${2 * (i - 1) + 1}`">P{{ i - 1 }}</th>
            <td class="pair">{{ hex4((regs.r[2 * (i - 1)]! << 8) | regs.r[2 * (i - 1) + 1]!) }}</td>
          </tr>
        </tbody>
      </table>
      <table class="regs mono special">
        <tbody>
          <tr>
            <th title="Program counter">PC</th>
            <td :class="{ changed: changed(8) }" data-testid="reg-PC">{{ hex4(regs.pc) }}</td>
            <th title="Active stack pointer (KSP in supervisor mode, USP in user mode)">SP</th>
            <td :class="{ changed: changed(9) }">{{ hex4(regs.sp) }}</td>
          </tr>
          <tr v-if="!compact">
            <th title="Kernel (supervisor) stack pointer">KSP</th>
            <td>{{ hex4(regs.ksp) }}</td>
            <th title="User stack pointer">USP</th>
            <td>{{ hex4(regs.usp) }}</td>
          </tr>
        </tbody>
      </table>
      <div class="flags" aria-label="Processor status flags">
        <span class="mono muted">PSW {{ hex2(regs.psw) }}</span>
        <span
          v-for="f in flags"
          :key="f.name"
          class="flag mono"
          :class="{ on: f.on }"
          :title="`${f.title}: ${f.on ? 1 : 0}`"
          :data-testid="`flag-${f.name}`"
          >{{ f.name }}</span
        >
      </div>
      <table v-if="!compact" class="regs mono special">
        <tbody>
          <tr>
            <th title="Exception vector table base">VBASE</th>
            <td>{{ hex4(regs.vbase) }}</td>
            <th title="User window: first allowed address">UBASE</th>
            <td>{{ hex4(regs.ubase) }}</td>
          </tr>
          <tr>
            <th title="User window: first address after the window">ULIMIT</th>
            <td>{{ hex4(regs.ulimit) }}</td>
            <th title="Cause of the last exception">CAUSE</th>
            <td>{{ hex2(regs.cause) }}</td>
          </tr>
          <tr>
            <th title="Faulting address of the last memory fault">FADDR</th>
            <td>{{ hex4(regs.faddr) }}</td>
            <th title="Kernel scratch register">KSCR</th>
            <td>{{ hex4(regs.kscratch) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="body muted">Load a program to see the CPU.</div>
  </section>
</template>

<style scoped>
.regs {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.85rem;
}
.regs th {
  text-align: left;
  color: var(--muted);
  font-weight: 500;
  padding: 0.1rem 0.3rem 0.1rem 0;
  width: 2.6rem;
}
.regs td {
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  transition: background 0.3s;
}
.regs .pair {
  color: var(--faint);
}
.special {
  margin-top: 0.4rem;
}
.flags {
  display: flex;
  gap: 0.3rem;
  align-items: center;
  margin-top: 0.45rem;
}
.flags .muted {
  margin-right: 0.3rem;
  font-size: 0.82rem;
}
.flag {
  width: 1.5rem;
  text-align: center;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--faint);
  font-size: 0.82rem;
}
.flag.on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  font-weight: 700;
}
:root[data-theme='dark'] .flag.on {
  color: #0f1318;
}
.fmt {
  display: flex;
  gap: 0.15rem;
  text-transform: none;
}
</style>
