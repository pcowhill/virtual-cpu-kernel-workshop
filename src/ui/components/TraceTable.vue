<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from '../../app/store';
import { disassembleBytes } from '../../core/asm/disassembler';
import type { TraceEntry } from '../../core/machine/trace';
import { causeLabel } from '../../core/machine/machine';
import { hex2, hex4 } from '../format';
import { VECTOR_NAMES } from '../../core/isa/constants';

const props = withDefaults(defineProps<{ limit?: number; entries?: TraceEntry[] | null; filter?: string }>(), {
  limit: 200,
  entries: null,
  filter: 'all',
});
const emit = defineEmits<{ select: [e: TraceEntry] }>();
const s = useStore();

function describe(e: TraceEntry): string {
  if (e.kind === 'reset') return 'RESET: PC ← reset vector';
  if (e.kind === 'idle') return `idle (waiting for interrupt) ×${e.idleCycles ?? 1}`;
  if (e.kind === 'exception' && e.exception)
    return `⚡ EXCEPTION ENTRY vector ${e.exception.vector} ${VECTOR_NAMES[e.exception.vector]} — ${causeLabel(e.exception.cause)}`;
  const d = disassembleBytes(e.bytes, e.pc)[0];
  return d ? d.text : '?';
}

const rows = computed(() => {
  let list = props.entries ?? s.view.value?.trace ?? [];
  if (props.filter === 'events') list = list.filter((e) => e.kind !== 'instruction' || e.fault);
  else if (props.filter === 'user') list = list.filter((e) => !e.supervisor);
  else if (props.filter === 'supervisor') list = list.filter((e) => e.supervisor);
  return list.slice(-props.limit).reverse();
});
</script>

<template>
  <table class="data mono trace" aria-label="Execution trace (newest first)">
    <thead>
      <tr>
        <th>cycle</th>
        <th>mode</th>
        <th>PC</th>
        <th>bytes</th>
        <th>instruction</th>
        <th>changes</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="e in rows"
        :key="e.seq"
        class="clickable"
        :class="[`k-${e.kind}`, { fault: e.fault }]"
        @click="emit('select', e)"
      >
        <td>{{ e.cycle }}</td>
        <td :title="e.supervisor ? 'supervisor' : 'user'">{{ e.supervisor ? 'S' : 'U' }}</td>
        <td>{{ hex4(e.pc) }}</td>
        <td class="faint">{{ e.bytes.map(hex2).join(' ') }}</td>
        <td>
          {{ describe(e) }}
          <span v-if="e.fault" class="err"> ✖ {{ causeLabel(e.fault.cause) }} @ {{ hex4(e.fault.addr) }}</span>
        </td>
        <td class="changes">
          <span v-for="r in e.regs" :key="r.name">{{ r.name }}={{ r.name.length > 2 || r.new > 255 ? hex4(r.new) : hex2(r.new) }} </span>
          <span v-for="m in e.mem" :key="m.addr" class="memw">[{{ hex4(m.addr) }}]={{ hex2(m.new) }} </span>
        </td>
      </tr>
      <tr v-if="!rows.length">
        <td colspan="6" class="muted">No trace entries yet. Step or run the machine.</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.trace td {
  font-size: 0.78rem;
}
.k-exception td {
  background: var(--warn-soft);
}
.k-reset td,
.k-idle td {
  color: var(--muted);
}
.fault td {
  background: var(--err-soft);
}
.err {
  color: var(--err);
}
.changes {
  white-space: normal;
  min-width: 12rem;
}
.memw {
  color: var(--kernel-strong);
}
</style>
