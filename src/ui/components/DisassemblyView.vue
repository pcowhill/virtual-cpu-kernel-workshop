<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from '../../app/store';
import { labelResolver, sourceFor } from '../../app/project';
import { disassembleAt, type DisassembledInstruction } from '../../core/asm/disassembler';
import { hex2, hex4 } from '../format';

const props = withDefaults(defineProps<{ address?: number | null; count?: number; before?: number }>(), {
  address: null,
  count: 18,
  before: 6,
});
const emit = defineEmits<{ select: [addr: number] }>();
const s = useStore();

const center = computed(() => props.address ?? s.view.value?.cpu.instrStart ?? 0);

/** Find a start address a few instructions before `center` using known instruction boundaries. */
const rows = computed<(DisassembledInstruction & { label?: string; source?: string })[]>(() => {
  const v = s.view.value;
  if (!v) return [];
  const mem = v.memory;
  const read = (a: number) => mem[a & 0xffff]!;
  const build = s.build.value;
  const labels = labelResolver(build);
  const starts = (build?.sourceMap ?? [])
    .filter((e) => e.kind === 'instruction' && e.address <= center.value && e.address > center.value - 64)
    .map((e) => e.address)
    .sort((a, b) => a - b);
  let addr = center.value;
  const prior = starts.filter((a) => a < center.value);
  if (prior.length) addr = prior[Math.max(0, prior.length - props.before)]!;
  const out: (DisassembledInstruction & { label?: string; source?: string })[] = [];
  for (let i = 0; i < props.count; i++) {
    const ins = disassembleAt(read, addr, labels);
    const src = sourceFor(build, addr);
    out.push({ ...ins, label: labels(addr), source: src ? `${src.file}:${src.line}` : undefined });
    addr = (addr + ins.length) & 0xffff;
  }
  return out;
});

const pc = computed(() => s.view.value?.cpu.pc);
const current = computed(() => s.view.value?.cpu.instrStart);
const midInstruction = computed(() => {
  const seq = s.view.value?.cpu.sequence;
  return seq !== null && seq !== undefined && seq.mpc > 0;
});

function isBp(a: number): boolean {
  return s.debug.breakpoints.includes(a);
}

function openSource(src?: string): void {
  if (!src) return;
  const file = src.slice(0, src.lastIndexOf(':'));
  if (s.project.files[file] !== undefined) {
    s.selectedFile.value = file;
    s.lab.value = 'editor';
  }
}
</script>

<template>
  <div class="disasm mono" role="table" aria-label="Disassembly">
    <div v-for="r in rows" :key="r.address" class="row-wrap">
      <div v-if="r.label" class="label">{{ r.label }}:</div>
      <div
        class="row"
        role="row"
        :class="{
          current: r.address === current && midInstruction,
          next: r.address === pc && !midInstruction,
          invalid: !r.valid,
        }"
        @click="emit('select', r.address)"
      >
        <button
          class="bp"
          :class="{ on: isBp(r.address) }"
          :aria-label="`${isBp(r.address) ? 'Remove' : 'Set'} breakpoint at ${hex4(r.address)}`"
          :aria-pressed="isBp(r.address)"
          @click.stop="s.toggleBreakpoint(r.address)"
        >
          ●
        </button>
        <span class="marker" aria-hidden="true">{{
          r.address === pc && !midInstruction ? '▶' : r.address === current && midInstruction ? '◆' : ''
        }}</span>
        <span class="addr">{{ hex4(r.address) }}</span>
        <span class="bytes">{{ r.bytes.map(hex2).join(' ') }}</span>
        <span class="text">{{ r.text }}</span>
        <button v-if="r.source" class="src faint" :title="`Open ${r.source} in the editor`" @click.stop="openSource(r.source)">
          {{ r.source }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.disasm {
  font-size: 0.82rem;
  line-height: 1.45;
}
.label {
  color: var(--accent);
  padding-left: 3.4rem;
  font-weight: 600;
}
.row {
  display: grid;
  grid-template-columns: 1.3rem 1rem 3.3rem 7.5rem minmax(10rem, 1fr) auto;
  align-items: center;
  gap: 0.3rem;
  padding: 0 0.3rem;
  border-radius: 3px;
  cursor: default;
}
.row.next {
  background: var(--accent-soft);
  box-shadow: inset 3px 0 0 var(--active-line);
}
.row.current {
  background: var(--changed);
  box-shadow: inset 3px 0 0 var(--warn);
}
.row.invalid .text {
  color: var(--faint);
}
.bp {
  border: 0;
  background: none;
  color: transparent;
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0;
}
.row:hover .bp {
  color: var(--border-strong);
}
.bp.on,
.row:hover .bp.on {
  color: var(--err);
}
.marker {
  color: var(--accent);
}
.addr {
  color: var(--muted);
}
.bytes {
  color: var(--faint);
}
.src {
  border: 0;
  background: none;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  text-align: right;
}
.src:hover {
  color: var(--accent);
  text-decoration: underline;
}
</style>
