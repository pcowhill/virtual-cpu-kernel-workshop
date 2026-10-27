<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStore } from '../../app/store';
import { regionOf, MEM } from '../../core/isa/constants';
import { hex2, hex4, printable } from '../format';

const props = withDefaults(defineProps<{ base: number; rows?: number }>(), { rows: 24 });
const emit = defineEmits<{ select: [addr: number] }>();
const s = useStore();
const selected = ref<number | null>(null);
const editing = ref<number | null>(null);
const editValue = ref('');

const lines = computed(() => {
  const v = s.view.value;
  if (!v) return [];
  const prev = s.prevView.value?.memory;
  const start = props.base & 0xfff0;
  const out: { addr: number; cells: { a: number; v: number; changed: boolean }[] }[] = [];
  for (let r = 0; r < props.rows; r++) {
    const addr = (start + r * 16) & 0xffff;
    if (r > 0 && addr < start) break;
    const cells = [];
    for (let i = 0; i < 16; i++) {
      const a = addr + i;
      cells.push({ a, v: v.memory[a]!, changed: !!prev && prev[a] !== v.memory[a] });
    }
    out.push({ addr, cells });
  }
  return out;
});

const userWindow = computed(() => {
  const c = s.view.value?.cpu;
  return c ? { lo: c.ubase, hi: c.ulimit } : { lo: 0, hi: 0 };
});
const sp = computed(() => s.view.value?.cpu.sp ?? -1);
const pc = computed(() => s.view.value?.cpu.pc ?? -1);
const watched = computed(() => new Map(s.debug.watchpoints));

function classes(a: number): string[] {
  const c = [`r-${regionOf(a)}`];
  if (a >= MEM.URAM_START && a <= MEM.URAM_END && a >= userWindow.value.lo && a < userWindow.value.hi)
    c.push('in-window');
  if (a === sp.value) c.push('sp');
  if (a === pc.value) c.push('pc');
  if (watched.value.has(a)) c.push('watch');
  if (a === selected.value) c.push('selected');
  return c;
}

function select(a: number): void {
  selected.value = a;
  emit('select', a);
}

function startEdit(a: number): void {
  if (a >= MEM.MMIO_START) {
    s.notify(
      'info',
      'Device registers cannot be edited by the debugger; drive them from the Devices lab or guest code.',
    );
    return;
  }
  editing.value = a;
  editValue.value = hex2(s.view.value?.memory[a] ?? 0);
}

function commit(): void {
  if (editing.value === null) return;
  const v = parseInt(editValue.value, 16);
  if (!Number.isNaN(v) && v >= 0 && v <= 255) {
    s.send({ type: 'poke', address: editing.value, value: v });
    s.notify(
      'info',
      `Debugger write: M[0x${hex4(editing.value)}] ← 0x${hex2(v)} (a privileged debugger action, not guest behaviour).`,
    );
  }
  editing.value = null;
}
</script>

<template>
  <div class="hex mono" role="grid" aria-label="Memory contents">
    <div class="head faint">
      <span class="addr">addr</span>
      <span v-for="i in 16" :key="i" class="cellh">{{ hex2(i - 1).slice(1) }}</span>
      <span class="ascii">ascii</span>
    </div>
    <div v-for="l in lines" :key="l.addr" class="line" role="row">
      <span class="addr">{{ hex4(l.addr) }}</span>
      <template v-for="c in l.cells" :key="c.a">
        <input
          v-if="editing === c.a"
          v-model="editValue"
          class="cell edit"
          maxlength="2"
          :aria-label="`New value for ${hex4(c.a)}`"
          autofocus
          @keydown.enter="commit"
          @keydown.escape="editing = null"
          @blur="commit"
        />
        <span
          v-else
          class="cell"
          :class="[...classes(c.a), { changed: c.changed }]"
          role="gridcell"
          :data-addr="c.a"
          :title="`${hex4(c.a)}: 0x${hex2(c.v)} = ${c.v} — double-click to edit (debugger)`"
          @click="select(c.a)"
          @dblclick="startEdit(c.a)"
          >{{ hex2(c.v) }}</span
        >
      </template>
      <span class="ascii">{{ l.cells.map((c) => printable(c.v)).join('') }}</span>
    </div>
  </div>
</template>

<style scoped>
.hex {
  font-size: 0.8rem;
  line-height: 1.5;
  user-select: none;
}
.head,
.line {
  display: grid;
  grid-template-columns: 3.4rem repeat(16, 1.6rem) 9rem;
  align-items: center;
}
.cellh {
  text-align: center;
}
.addr {
  color: var(--muted);
}
.cell {
  text-align: center;
  border-radius: 2px;
  cursor: pointer;
}
.cell.edit {
  width: 1.6rem;
  padding: 0;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 0.8rem;
}
.r-rom {
  background: color-mix(in srgb, var(--rom) 55%, transparent);
}
.r-kernel {
  background: color-mix(in srgb, var(--kernel) 55%, transparent);
}
.r-user {
  background: color-mix(in srgb, var(--user) 40%, transparent);
}
.r-mmio {
  background: color-mix(in srgb, var(--mmio) 55%, transparent);
}
.in-window {
  background: var(--user);
}
.cell.changed {
  background: var(--changed);
  font-weight: 700;
}
.cell.sp {
  outline: 2px solid var(--kernel-strong);
  outline-offset: -2px;
}
.cell.pc {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.cell.watch {
  text-decoration: underline wavy var(--err);
}
.cell.selected {
  background: var(--accent);
  color: #fff;
}
.ascii {
  padding-left: 0.7rem;
  color: var(--muted);
  white-space: pre;
}
</style>
