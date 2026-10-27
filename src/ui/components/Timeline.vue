<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStore } from '../../app/store';
import type { TimelineMarker } from '../../core/os/awareness';

/**
 * Scheduling timeline: which process the CPU executed over simulated time,
 * reconstructed from hardware events (exception entry, RTI, HLT).
 */
const props = withDefaults(defineProps<{ window?: number }>(), { window: 60_000 });
const emit = defineEmits<{ select: [m: TimelineMarker] }>();
const s = useStore();
const W = 900;
const ROW = 22;
const selected = ref<TimelineMarker | null>(null);

const os = computed(() => s.view.value?.os ?? null);
const end = computed(() => s.view.value?.cycle ?? 0);
const start = computed(() => Math.max(0, end.value - props.window));
const x = (c: number) => ((c - start.value) / Math.max(1, end.value - start.value)) * W;

const rows = computed(() => {
  const procs = os.value?.processes ?? [];
  return [
    ...procs.map((p) => ({ key: `p${p.index}`, index: p.index, label: `pid ${p.pid} ${p.name}`, kind: 'user' })),
    { key: 'kernel', index: -1, label: 'kernel', kind: 'kernel' },
    { key: 'idle', index: -2, label: 'idle (HLT)', kind: 'idle' },
  ];
});

function rowOf(seg: { kind: string; index: number }): number {
  if (seg.kind === 'kernel') return rows.value.findIndex((r) => r.kind === 'kernel');
  if (seg.kind === 'idle') return rows.value.findIndex((r) => r.kind === 'idle');
  return rows.value.findIndex((r) => r.index === seg.index);
}

const segments = computed(() =>
  (os.value?.segments ?? [])
    .filter((g) => g.end >= start.value)
    .map((g) => ({ ...g, row: rowOf(g), x0: x(Math.max(g.start, start.value)), x1: x(g.end) })),
);
const markers = computed(() => (os.value?.markers ?? []).filter((m) => m.cycle >= start.value).slice(-400));

const COLORS = ['var(--accent)', 'var(--user-strong)', 'var(--rom-strong)', 'var(--mmio-strong)'];
function color(seg: { kind: string; index: number }): string {
  if (seg.kind === 'kernel') return 'var(--kernel-strong)';
  if (seg.kind === 'idle') return 'var(--border-strong)';
  return COLORS[seg.index % COLORS.length]!;
}
const MARK: Record<string, { y: number; color: string; symbol: string }> = {
  timer: { y: 0, color: 'var(--warn)', symbol: 'T' },
  syscall: { y: 0, color: 'var(--accent)', symbol: 'S' },
  keyboard: { y: 0, color: 'var(--ok)', symbol: 'K' },
  irq: { y: 0, color: 'var(--ok)', symbol: 'I' },
  fault: { y: 0, color: 'var(--err)', symbol: '!' },
  switch: { y: 0, color: 'var(--text)', symbol: '⇄' },
  exit: { y: 0, color: 'var(--err)', symbol: '✕' },
};

function pick(m: TimelineMarker): void {
  selected.value = m;
  emit('select', m);
}

const height = computed(() => 30 + rows.value.length * ROW + 20);
</script>

<template>
  <div class="timeline">
    <svg :viewBox="`-110 0 ${W + 120} ${height}`" class="tl" role="img" aria-label="Scheduling timeline">
      <g v-for="(r, i) in rows" :key="r.key">
        <text x="-6" :y="30 + i * ROW + 15" text-anchor="end" class="rlabel">{{ r.label }}</text>
        <line x1="0" :x2="W" :y1="30 + i * ROW + ROW - 1" :y2="30 + i * ROW + ROW - 1" class="grid" />
      </g>
      <rect
        v-for="(g, i) in segments"
        :key="`s${i}`"
        :x="g.x0"
        :y="30 + g.row * ROW + 3"
        :width="Math.max(1, g.x1 - g.x0)"
        :height="ROW - 7"
        :fill="color(g)"
        class="seg"
      >
        <title>{{ g.name }}: cycles {{ g.start }}–{{ g.end }} ({{ g.end - g.start }} cycles)</title>
      </rect>
      <g v-for="(m, i) in markers" :key="`m${i}`" class="marker" :class="{ sel: selected === m }" @click="pick(m)">
        <line
          :x1="x(m.cycle)"
          :x2="x(m.cycle)"
          y1="14"
          :y2="30 + rows.length * ROW"
          :stroke="MARK[m.kind]?.color"
          class="mline"
        />
        <text :x="x(m.cycle)" y="12" text-anchor="middle" :fill="MARK[m.kind]?.color" class="msym">
          {{ MARK[m.kind]?.symbol }}
        </text>
        <title>cycle {{ m.cycle }}: {{ m.detail }}</title>
      </g>
      <text x="0" :y="height - 4" class="axis">cycle {{ start }}</text>
      <text :x="W" :y="height - 4" text-anchor="end" class="axis">cycle {{ end }}</text>
    </svg>
    <div class="legend faint">
      <span><b style="color: var(--warn)">T</b> timer IRQ</span>
      <span><b style="color: var(--accent)">S</b> system call</span>
      <span><b style="color: var(--ok)">K</b> keyboard IRQ</span>
      <span><b>⇄</b> context switch</span>
      <span><b style="color: var(--err)">!</b> fault</span>
      <span><b style="color: var(--err)">✕</b> exit</span>
      <span>— click a marker for details</span>
    </div>
  </div>
</template>

<style scoped>
.tl {
  width: 100%;
  height: auto;
  font-family: var(--font-mono);
}
.rlabel {
  font-size: 11px;
  fill: var(--text);
}
.grid {
  stroke: var(--border);
}
.seg {
  opacity: 0.85;
}
.marker {
  cursor: pointer;
}
.mline {
  stroke-width: 1;
  opacity: 0.35;
}
.marker:hover .mline,
.marker.sel .mline {
  opacity: 1;
  stroke-width: 2;
}
.msym {
  font-size: 10px;
  font-weight: 700;
}
.axis {
  font-size: 10px;
  fill: var(--muted);
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem;
  font-size: 0.75rem;
}
</style>
