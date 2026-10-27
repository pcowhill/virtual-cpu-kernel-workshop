<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from '../../app/store';
import { MEM, REGION_INFO, PSW } from '../../core/isa/constants';
import { hex4 } from '../format';

const emit = defineEmits<{ jump: [addr: number] }>();
const s = useStore();
const H = 512; // pixels for 64 KiB
const y = (a: number) => (a / 0x10000) * H;

const regions = computed(() =>
  (['rom', 'kernel', 'user', 'mmio'] as const).map((id) => {
    const r = REGION_INFO[id];
    const access =
      id === 'rom'
        ? 'supervisor: read/execute · user: none'
        : id === 'kernel'
          ? 'supervisor: read/write/execute · user: none'
          : id === 'user'
            ? 'supervisor: all · user: only inside [UBASE, ULIMIT)'
            : 'supervisor: device registers · user: none';
    return { id, ...r, access };
  }),
);

const cpu = computed(() => s.view.value?.cpu);
const userMode = computed(() => ((cpu.value?.psw ?? PSW.S) & PSW.S) === 0);
const procs = computed(() => s.view.value?.os?.processes ?? []);
const current = computed(() => s.view.value?.os?.current ?? null);
</script>

<template>
  <div class="mapwrap">
    <svg :viewBox="`0 0 300 ${H + 2}`" class="map" role="img" aria-label="Memory map with protection boundaries">
      <g v-for="r in regions" :key="r.id" class="region" @click="emit('jump', r.start)">
        <rect :x="40" :y="y(r.start)" :width="110" :height="y(r.end + 1) - y(r.start)" :class="`fill-${r.id}`" />
        <text :x="95" :y="y(r.start) + (y(r.end + 1) - y(r.start)) / 2 + 4" text-anchor="middle" class="rlabel">
          {{ r.name }}
        </text>
        <text :x="36" :y="y(r.start) + 10" text-anchor="end" class="addr">{{ hex4(r.start) }}</text>
        <title>{{ r.name }} {{ hex4(r.start) }}–{{ hex4(r.end) }}: {{ r.access }}</title>
      </g>
      <text x="36" :y="H" text-anchor="end" class="addr">FFFF</text>
      <!-- process slots (OS) -->
      <g v-for="p in procs" :key="p.index" class="slot" @click="emit('jump', p.base)">
        <rect
          x="154"
          :y="y(p.base)"
          width="18"
          :height="y(p.limit) - y(p.base)"
          :class="{ cur: p.index === current, exited: p.state === 'exited' }"
        />
        <text x="176" :y="y(p.base) + 12" class="plabel">pid {{ p.pid }} {{ p.name }} ({{ p.state }})</text>
        <title>pid {{ p.pid }} {{ p.name }}: window {{ hex4(p.base) }}–{{ hex4(p.limit - 1) }}</title>
      </g>
      <!-- active protection window -->
      <g v-if="cpu">
        <rect
          x="38"
          :y="y(Math.max(cpu.ubase, MEM.URAM_START))"
          width="114"
          :height="Math.max(1, y(Math.min(cpu.ulimit, MEM.URAM_END + 1)) - y(Math.max(cpu.ubase, MEM.URAM_START)))"
          class="window"
          :class="{ active: userMode }"
        />
        <line x1="20" x2="155" :y1="y(cpu.pc)" :y2="y(cpu.pc)" class="pcline" />
        <text x="2" :y="y(cpu.pc) + 4" class="ptr pc">PC</text>
        <line x1="20" x2="155" :y1="y(cpu.sp)" :y2="y(cpu.sp)" class="spline" />
        <text x="2" :y="y(cpu.sp) + 4" class="ptr sp">SP</text>
      </g>
    </svg>
    <div v-if="cpu" class="legend">
      <div>
        <b>Protection window</b> <span class="mono">[{{ hex4(cpu.ubase) }}, {{ hex4(cpu.ulimit) }})</span>
        <span class="chip" :class="userMode ? 'ok' : ''">{{
          userMode ? 'enforced now (user mode)' : 'inactive (supervisor mode)'
        }}</span>
      </div>
      <div class="muted small">
        User-mode code may only access user RAM inside the window; everything else raises a memory fault. Click a region
        to view it.
      </div>
    </div>
  </div>
</template>

<style scoped>
.map {
  width: 100%;
  max-width: 340px;
  height: auto;
  font-family: var(--font-mono);
}
.region {
  cursor: pointer;
}
.fill-rom {
  fill: var(--rom);
  stroke: var(--rom-strong);
}
.fill-kernel {
  fill: var(--kernel);
  stroke: var(--kernel-strong);
}
.fill-user {
  fill: var(--user);
  stroke: var(--user-strong);
}
.fill-mmio {
  fill: var(--mmio);
  stroke: var(--mmio-strong);
}
.rlabel {
  font-size: 10px;
  fill: var(--text);
  font-family: var(--font-ui);
}
.addr {
  font-size: 9px;
  fill: var(--muted);
}
.slot rect {
  fill: var(--user);
  stroke: var(--user-strong);
  cursor: pointer;
}
.slot rect.cur {
  fill: var(--user-strong);
}
.slot rect.exited {
  fill: var(--panel-2);
  stroke: var(--border-strong);
}
.plabel {
  font-size: 9px;
  fill: var(--text);
}
.window {
  fill: none;
  stroke: var(--user-strong);
  stroke-width: 2;
  stroke-dasharray: 4 3;
}
.window.active {
  stroke-dasharray: none;
  stroke-width: 3;
}
.pcline {
  stroke: var(--accent);
  stroke-width: 1.5;
}
.spline {
  stroke: var(--kernel-strong);
  stroke-width: 1.5;
}
.ptr {
  font-size: 9px;
  font-weight: 700;
}
.ptr.pc {
  fill: var(--accent);
}
.ptr.sp {
  fill: var(--kernel-strong);
}
.legend {
  font-size: 0.82rem;
  display: grid;
  gap: 0.3rem;
}
.small {
  font-size: 0.78rem;
}
</style>
