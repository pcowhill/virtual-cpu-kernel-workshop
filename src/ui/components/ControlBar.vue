<script setup lang="ts">
import { computed } from 'vue';
import { SPEEDS, useStore } from '../../app/store';
import { formatCycles, formatHz, hex4 } from '../format';
import { PSW } from '../../core/isa/constants';

const s = useStore();
const v = computed(() => s.view.value);
const running = computed(() => v.value?.runState === 'running');
const loaded = computed(() => v.value?.loaded ?? false);
const supervisor = computed(() => ((v.value?.cpu.psw ?? 0) & PSW.S) !== 0);

const status = computed(() => {
  const view = v.value;
  if (!view || !view.loaded) return { text: 'No program loaded', cls: '' };
  const st = view.cpu.status;
  if (st === 'machine-check') return { text: 'Machine check', cls: 'err' };
  if (st === 'off') return { text: 'Powered off', cls: 'warn' };
  if (view.runState === 'running')
    return { text: st === 'waiting' ? 'Running · waiting for interrupt' : 'Running', cls: 'ok' };
  if (view.stop?.reason === 'breakpoint') return { text: 'Paused at breakpoint', cls: 'accent' };
  if (view.stop?.reason === 'watchpoint') return { text: 'Paused at watchpoint', cls: 'accent' };
  if (view.stop?.reason === 'exception') return { text: 'Paused: exception', cls: 'warn' };
  if (view.stop?.reason === 'halted') return { text: 'Halted', cls: 'warn' };
  if (st === 'waiting') return { text: 'Paused · waiting for interrupt', cls: '' };
  return { text: 'Paused', cls: '' };
});

const speed = computed({
  get: () => String(s.debug.speed),
  set: (val: string) => {
    s.debug.speed = val === 'max' ? 'max' : Number(val);
  },
});

function runPause(): void {
  s.send({ type: running.value ? 'pause' : 'run' });
}
</script>

<template>
  <div class="controlbar" role="toolbar" aria-label="Machine controls">
    <div class="group">
      <button
        class="btn"
        :disabled="!loaded"
        title="Power-cycle: reload the ROM and storage images and reset everything (RAM cleared)"
        @click="s.send({ type: 'powerOn' })"
      >
        ⏻ Power
      </button>
      <button
        class="btn"
        :disabled="!loaded"
        title="Reset button: reset the CPU and device registers; RAM and storage are kept"
        @click="s.send({ type: 'reset' })"
      >
        ↺ Reset
      </button>
    </div>
    <div class="group">
      <button
        class="btn primary run"
        :disabled="!loaded"
        :title="running ? 'Pause (F5)' : 'Run until a breakpoint, watchpoint, exception or halt (F5)'"
        data-testid="run-pause"
        @click="runPause"
      >
        {{ running ? '❚❚ Pause' : '▶ Run' }}
      </button>
      <button
        class="btn"
        :disabled="!loaded"
        title="Stop: pause and return the machine to its power-on state (Shift+F5)"
        @click="s.send({ type: 'stop' })"
      >
        ■ Stop
      </button>
      <button
        class="btn"
        :disabled="!loaded || running"
        title="Execute one instruction, exception entry or reset sequence (F10)"
        data-testid="step"
        @click="s.send({ type: 'stepInstruction' })"
      >
        Step
      </button>
      <button
        class="btn"
        :disabled="!loaded || running"
        title="Execute one micro-operation = one clock cycle (Shift+F10)"
        data-testid="micro-step"
        @click="s.send({ type: 'stepMicro' })"
      >
        µStep
      </button>
    </div>
    <label
      class="group speed"
      title="Simulated clock rate. Changes how fast cycles run in real time, never the result."
    >
      <span class="muted">Clock</span>
      <select v-model="speed" aria-label="Execution speed" data-testid="speed">
        <option v-for="sp in SPEEDS" :key="String(sp.value)" :value="String(sp.value)">{{ sp.label }}</option>
      </select>
    </label>
    <div class="group status">
      <span class="chip" :class="status.cls" data-testid="machine-status" role="status">{{ status.text }}</span>
      <span
        v-if="loaded"
        class="chip"
        :class="supervisor ? 'warn' : 'ok'"
        :title="supervisor ? 'Supervisor mode (PSW.S = 1)' : 'User mode (PSW.S = 0)'"
      >
        {{ supervisor ? 'SUPERVISOR' : 'USER' }}
      </span>
    </div>
    <div class="group counters mono" aria-live="off">
      <span title="Program counter"
        >PC <b data-testid="pc">{{ v ? hex4(v.cpu.pc) : '----' }}</b></span
      >
      <span title="Simulated clock cycles since power-on"
        >cycle <b data-testid="cycle">{{ v ? formatCycles(v.cycle) : 0 }}</b></span
      >
      <span title="Instructions completed"
        >instr <b>{{ v ? formatCycles(v.instructions) : 0 }}</b></span
      >
      <span v-if="running && v" class="muted" title="Measured simulated clock rate">{{ formatHz(v.measuredHz) }}</span>
    </div>
    <div v-if="v?.stop?.detail && !running" class="stopdetail" data-testid="stop-detail">{{ v.stop.detail }}</div>
    <div v-if="v?.cpu.status === 'machine-check'" class="stopdetail err">{{ v.cpu.machineCheckReason }}</div>
  </div>
</template>

<style scoped>
.controlbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem 1rem;
  padding: 0.45rem 0.9rem;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}
.group {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.run {
  min-width: 5.5rem;
  justify-content: center;
}
.counters {
  gap: 0.9rem;
  font-size: 0.82rem;
  color: var(--muted);
}
.counters b {
  color: var(--text);
  font-weight: 600;
}
.stopdetail {
  flex-basis: 100%;
  font-size: 0.8rem;
  color: var(--muted);
}
.stopdetail.err {
  color: var(--err);
}
</style>
