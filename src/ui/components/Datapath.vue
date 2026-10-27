<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from '../../app/store';
import { hex2, hex4, flagsString } from '../format';

/**
 * Datapath diagram. Highlighted units and bus values come from the activity
 * record of the micro-operation that actually executed last (cpu.lastOp) —
 * never from a script. Unit boxes light for the units that execution used;
 * the buses light only for a recorded bus transfer. The internal wires are
 * drawn as structure only: the core records which units took part, not the
 * individual transfers between them, so no wire is ever highlighted.
 */
const s = useStore();
const cpu = computed(() => s.view.value?.cpu ?? null);
const active = computed(() => new Set(cpu.value?.lastOp?.units ?? []));
const on = (u: string) => active.value.has(u);
const bus = computed(() => cpu.value?.lastOp?.bus ?? { addr: -1, data: -1, op: 'none' });
const alu = computed(() => cpu.value?.lastOp?.alu ?? null);
/** Lit only when the last micro-operation actually performed a memory or device access. */
const busActive = computed(() => bus.value.op !== 'none' && bus.value.addr >= 0);

interface Box {
  id: string;
  unit: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  value: () => string;
  title: string;
}

const boxes: Box[] = [
  {
    id: 'pc',
    unit: 'PC',
    x: 560,
    y: 40,
    w: 100,
    h: 44,
    label: 'PC',
    value: () => hex4(cpu.value?.pc ?? 0),
    title: 'Program counter',
  },
  {
    id: 'agu',
    unit: 'AGU',
    x: 560,
    y: 110,
    w: 100,
    h: 44,
    label: 'Address unit',
    value: () => '16-bit +/−',
    title: '16-bit incrementer/adder used for PC, SP and effective addresses',
  },
  {
    id: 'sp',
    unit: 'SP',
    x: 560,
    y: 180,
    w: 100,
    h: 44,
    label: 'SP',
    value: () => hex4(cpu.value?.sp ?? 0),
    title: 'Active stack pointer (KSP or USP)',
  },
  {
    id: 'mar',
    unit: 'MAR',
    x: 690,
    y: 40,
    w: 90,
    h: 44,
    label: 'MAR',
    value: () => hex4(cpu.value?.latches.mar ?? 0),
    title: 'Memory address register',
  },
  {
    id: 'mdr',
    unit: 'MDR',
    x: 690,
    y: 250,
    w: 90,
    h: 44,
    label: 'MDR',
    value: () => hex2(cpu.value?.latches.mdr ?? 0),
    title: 'Memory data register',
  },
  {
    id: 'mem',
    unit: 'MEMORY',
    x: 820,
    y: 40,
    w: 110,
    h: 254,
    label: 'Memory & I/O',
    value: () => (bus.value.op === 'none' ? 'idle' : bus.value.op),
    title: 'ROM, RAM and memory-mapped devices behind the protection unit',
  },
  {
    id: 'ir',
    unit: 'IR',
    x: 40,
    y: 40,
    w: 90,
    h: 44,
    label: 'IR',
    value: () => hex2(cpu.value?.latches.ir ?? 0),
    title: 'Instruction register (opcode)',
  },
  {
    id: 'opr',
    unit: 'OPR',
    x: 140,
    y: 40,
    w: 90,
    h: 44,
    label: 'OPR',
    value: () => hex2(cpu.value?.latches.opr ?? 0),
    title: 'Register-operand byte (fields a, b)',
  },
  {
    id: 'imm',
    unit: 'IMM',
    x: 240,
    y: 40,
    w: 90,
    h: 44,
    label: 'IMM',
    value: () => hex4(cpu.value?.latches.imm ?? 0),
    title: 'Immediate / address operand latch',
  },
  {
    id: 'dec',
    unit: 'DECODER',
    x: 40,
    y: 110,
    w: 290,
    h: 44,
    label: 'Decoder / control unit',
    value: () => cpu.value?.sequence?.mnemonic ?? cpu.value?.sequence?.kind ?? '',
    title: 'Selects the micro-program for the opcode in IR',
  },
  {
    id: 'regs',
    unit: 'REGISTERS',
    x: 40,
    y: 190,
    w: 180,
    h: 160,
    label: 'Register file',
    value: () => '',
    title: 'R0–R7 (pairs P0–P3)',
  },
  {
    id: 'ctrl',
    unit: 'CONTROL_REGS',
    x: 40,
    y: 370,
    w: 180,
    h: 44,
    label: 'Control registers',
    value: () => `VBASE ${hex4(cpu.value?.vbase ?? 0)}`,
    title: 'PSW, USP, VBASE, UBASE, ULIMIT, CAUSE, FADDR, KSCRATCH',
  },
  {
    id: 'tmp',
    unit: 'TMP',
    x: 560,
    y: 250,
    w: 100,
    h: 44,
    label: 'T / TMP',
    value: () => hex4(cpu.value?.latches.t16 ?? 0),
    title: 'Internal 16-bit temporary latch',
  },
  {
    id: 'flags',
    unit: 'FLAGS',
    x: 300,
    y: 370,
    w: 160,
    h: 44,
    label: 'PSW / flags',
    value: () => flagsString(cpu.value?.psw ?? 0),
    title: 'Processor status word',
  },
  {
    id: 'irq',
    unit: 'INTERRUPTS',
    x: 690,
    y: 370,
    w: 240,
    h: 44,
    label: 'Interrupt / exception logic',
    value: () => (cpu.value?.pendingException ? `pending vector ${cpu.value.pendingException.vector}` : ''),
    title: 'Exception entry, interrupt sampling, HLT',
  },
];

const regRows = computed(() => {
  const r = cpu.value?.r ?? [];
  return [0, 2, 4, 6].map((i) => `R${i} ${hex2(r[i] ?? 0)}  R${i + 1} ${hex2(r[i + 1] ?? 0)}`);
});
</script>

<template>
  <svg
    viewBox="0 0 960 440"
    class="datapath"
    role="img"
    aria-label="CPU datapath with the units used by the current micro-operation highlighted"
  >
    <!-- buses -->
    <g class="bus" :class="{ on: busActive }">
      <line x1="780" y1="62" x2="820" y2="62" />
      <text x="800" y="30" text-anchor="middle" class="buslabel">address bus</text>
      <text v-if="busActive" x="800" y="54" text-anchor="middle" class="busval" data-testid="dp-address-bus">
        {{ hex4(bus.addr) }}
      </text>
    </g>
    <g class="bus" :class="{ on: busActive && bus.data >= 0 }">
      <line x1="780" y1="272" x2="820" y2="272" />
      <text x="800" y="320" text-anchor="middle" class="buslabel">data bus</text>
      <text
        v-if="busActive && bus.data >= 0"
        x="800"
        y="264"
        text-anchor="middle"
        class="busval"
        data-testid="dp-data-bus"
      >
        {{ hex2(bus.data) }} {{ bus.op === 'write' ? '→' : '←' }}
      </text>
    </g>
    <g class="bus internal">
      <line x1="660" y1="62" x2="690" y2="62" />
    </g>
    <g class="bus internal">
      <line x1="610" y1="84" x2="610" y2="110" />
      <line x1="610" y1="154" x2="610" y2="180" />
    </g>
    <g class="bus internal"><line x1="735" y1="84" x2="735" y2="250" /></g>
    <g class="bus internal">
      <polyline points="820,150 760,150 760,20 185,20 185,40" fill="none" />
    </g>
    <g class="bus internal">
      <line x1="220" y1="250" x2="300" y2="250" />
    </g>
    <g class="bus internal">
      <polyline points="220,320 540,320 540,272 560,272" fill="none" />
    </g>
    <g class="bus internal"><line x1="380" y1="330" x2="380" y2="370" /></g>

    <!-- ALU -->
    <g class="unit" :class="{ on: on('ALU') }">
      <polygon points="300,200 460,200 430,330 330,330" />
      <text x="380" y="222" text-anchor="middle" class="ulabel">ALU (8-bit)</text>
      <text x="380" y="245" text-anchor="middle" class="uval">{{ alu ? alu.op : '' }}</text>
      <text x="335" y="270" class="small">A {{ hex2(cpu?.latches.a ?? 0) }}</text>
      <text x="395" y="270" class="small">B {{ hex2(cpu?.latches.b ?? 0) }}</text>
      <text x="380" y="300" text-anchor="middle" class="uval" data-testid="dp-alu-y">
        Y {{ hex2(cpu?.latches.y ?? 0) }}
      </text>
      <title>Arithmetic/logic unit: A op B → Y and new flags</title>
    </g>

    <g
      v-for="b in boxes"
      :key="b.id"
      class="unit"
      :class="{ on: on(b.unit) }"
      :data-testid="`dp-${b.id}`"
      :data-active="on(b.unit)"
    >
      <rect :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="4" />
      <text :x="b.x + 8" :y="b.y + 16" class="ulabel">{{ b.label }}</text>
      <text :x="b.x + 8" :y="b.y + 35" class="uval">{{ b.value() }}</text>
      <title>{{ b.title }}</title>
    </g>
    <text v-for="(row, i) in regRows" :key="i" x="52" :y="240 + i * 24" class="uval">{{ row }}</text>
  </svg>
</template>

<style scoped>
.datapath {
  width: 100%;
  height: auto;
  font-family: var(--font-mono);
}
.unit rect,
.unit polygon {
  fill: var(--panel-2);
  stroke: var(--border-strong);
  stroke-width: 1.2;
}
.unit.on rect,
.unit.on polygon {
  fill: var(--active);
  stroke: var(--warn);
  stroke-width: 2.5;
}
.ulabel {
  font-size: 11px;
  fill: var(--muted);
  font-family: var(--font-ui);
}
.uval {
  font-size: 13px;
  fill: var(--text);
  font-weight: 600;
}
.small {
  font-size: 11px;
  fill: var(--text);
}
.bus line,
.bus polyline {
  stroke: var(--border-strong);
  stroke-width: 3;
}
.bus.internal line,
.bus.internal polyline {
  stroke-width: 2;
  stroke-dasharray: 3 3;
}
.bus.on line,
.bus.on polyline {
  stroke: var(--warn);
  stroke-width: 4;
  stroke-dasharray: none;
}
.buslabel {
  font-size: 10px;
  fill: var(--muted);
  font-family: var(--font-ui);
}
.busval {
  font-size: 11px;
  font-weight: 700;
  fill: var(--warn);
}
</style>
