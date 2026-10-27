<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStore } from '../../app/store';
import RegisterPanel from '../components/RegisterPanel.vue';
import DisassemblyView from '../components/DisassemblyView.vue';
import MicroOpList from '../components/MicroOpList.vue';
import TraceTable from '../components/TraceTable.vue';
import { parseValue } from '../format';

const s = useStore();
const regName = ref('R0');
const regValue = ref('');
const view = computed(() => s.view.value);

function setReg(): void {
  const v = parseValue(regValue.value);
  if (v === null) {
    s.notify('error', 'Enter a number such as 42, -2, 0x2A or 0b101010.');
    return;
  }
  s.send({ type: 'setRegister', name: regName.value, value: v });
  s.notify(
    'info',
    `Debugger set ${regName.value} = 0x${v.toString(16).toUpperCase()} (a debugger action, not guest behaviour).`,
  );
}
</script>

<template>
  <div class="lab">
    <div class="lab-title">
      <h1>CPU &amp; registers</h1>
      <p>
        8 general registers (8-bit), pairs P0–P3 for addresses, banked stack pointers, flags and privileged control
        registers. Highlighted values changed in the last step.
      </p>
    </div>
    <div class="layout">
      <div class="col">
        <RegisterPanel />
        <section class="panel">
          <header>Debugger: edit a register</header>
          <form class="body edit" @submit.prevent="setReg">
            <select v-model="regName" aria-label="Register">
              <option
                v-for="r in [
                  'R0',
                  'R1',
                  'R2',
                  'R3',
                  'R4',
                  'R5',
                  'R6',
                  'R7',
                  'PC',
                  'SP',
                  'KSP',
                  'USP',
                  'PSW',
                  'VBASE',
                  'UBASE',
                  'ULIMIT',
                  'KSCRATCH',
                ]"
                :key="r"
              >
                {{ r }}
              </option>
            </select>
            <input v-model="regValue" type="text" placeholder="42 or 0x2A" aria-label="Value" />
            <button class="btn small" type="submit" :disabled="view?.runState === 'running'">Set</button>
          </form>
          <p class="body faint small">
            Editing state is a privileged debugger intervention; a guest program can only change registers through
            instructions.
          </p>
        </section>
      </div>
      <div class="col">
        <section class="panel">
          <header>Disassembly around PC</header>
          <div class="body"><DisassemblyView :count="20" /></div>
        </section>
        <section class="panel">
          <header>Current instruction — micro-operations</header>
          <div class="body"><MicroOpList /></div>
        </section>
      </div>
    </div>
    <section class="panel">
      <header>Recent instructions</header>
      <div class="body scroll recent"><TraceTable :limit="12" /></div>
    </section>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 0.75rem;
  align-items: start;
}
.col {
  display: grid;
  gap: 0.75rem;
}
.edit {
  display: flex;
  gap: 0.4rem;
}
.edit input {
  width: 6rem;
}
.small {
  font-size: 0.78rem;
  margin: 0;
}
.recent {
  max-height: 320px;
}
@media (max-width: 1200px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
