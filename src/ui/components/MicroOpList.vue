<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from '../../app/store';
import { disassembleAt } from '../../core/asm/disassembler';
import { hex2, hex4 } from '../format';
import { causeLabel } from '../../core/machine/machine';

const s = useStore();
const cpu = computed(() => s.view.value?.cpu ?? null);
const seq = computed(() => cpu.value?.sequence ?? null);

const title = computed(() => {
  const c = cpu.value;
  const v = s.view.value;
  if (!c || !seq.value || !v) return '';
  if (seq.value.kind === 'reset') return 'Reset sequence (load PC from the reset vector at 0x0000)';
  if (seq.value.kind === 'idle') return 'Idle cycle: waiting for an interrupt (HLT)';
  if (seq.value.kind === 'exception') {
    const e = c.pendingException;
    return e ? `Exception entry → vector ${e.vector} (${causeLabel(e.cause)})` : 'Exception entry';
  }
  const at = seq.value.mpc === 0 ? c.pc : c.instrStart;
  const d = disassembleAt((a) => v.memory[a & 0xffff]!, at);
  return `${hex4(at)}  ${d.text}${seq.value.mpc === 0 ? '  (not started — next µStep fetches it)' : ''}`;
});

const last = computed(() => cpu.value?.lastOp ?? null);
</script>

<template>
  <div class="micro">
    <div class="title mono" data-testid="micro-title">{{ title }}</div>
    <ol v-if="seq && seq.ops.length" class="ops" aria-label="Micro-operations of the current sequence">
      <li
        v-for="(op, i) in seq.ops"
        :key="i"
        :class="{ done: i < seq.mpc, next: i === seq.mpc, justran: i === seq.mpc - 1 }"
        :data-testid="`micro-op-${i}`"
      >
        <span class="n mono">{{ i + 1 }}</span>
        <span class="name">{{ op.name }}</span>
        <span class="rtl mono">{{ op.rtl }}</span>
      </li>
    </ol>
    <p v-if="seq && seq.kind === 'instruction' && seq.mpc === 0 && seq.ops.length === 2" class="faint small">
      The full micro-program is selected by DECODE, after the opcode has been fetched.
    </p>
    <div v-if="last" class="last">
      <div class="small muted">Last micro-operation: <b class="mono">{{ last.name }}</b> — {{ last.rtl }}</div>
      <div v-if="last.bus.op !== 'none'" class="small mono">
        bus {{ last.bus.op }} addr {{ hex4(last.bus.addr) }}{{ last.bus.data >= 0 ? ` data ${hex2(last.bus.data)}` : '' }}
      </div>
      <div v-if="last.alu" class="small mono">
        ALU {{ last.alu.op }}: A={{ hex2(last.alu.a) }} B={{ hex2(last.alu.b) }} → Y={{ hex2(last.alu.y) }}
      </div>
      <div v-if="last.fault" class="small err">fault: {{ causeLabel(last.fault.cause) }} at {{ hex4(last.fault.addr) }}</div>
    </div>
  </div>
</template>

<style scoped>
.title {
  font-weight: 600;
  margin-bottom: 0.4rem;
}
.ops {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 0.82rem;
}
.ops li {
  display: grid;
  grid-template-columns: 1.6rem 7.5rem 1fr;
  gap: 0.4rem;
  padding: 0.15rem 0.35rem;
  border-radius: 3px;
  color: var(--faint);
}
.ops li.done {
  color: var(--text);
}
.ops li.justran {
  background: var(--active);
  color: var(--text);
}
.ops li.next {
  box-shadow: inset 3px 0 0 var(--accent);
  color: var(--text);
}
.name {
  font-weight: 600;
}
.last {
  margin-top: 0.6rem;
  border-top: 1px solid var(--border);
  padding-top: 0.4rem;
}
.small {
  font-size: 0.8rem;
}
.err {
  color: var(--err);
}
</style>
