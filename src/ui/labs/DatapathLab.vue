<script setup lang="ts">
import { useStore } from '../../app/store';
import Datapath from '../components/Datapath.vue';
import MicroOpList from '../components/MicroOpList.vue';

const s = useStore();
</script>

<template>
  <div class="lab">
    <div class="lab-title">
      <h1>Datapath &amp; micro-operations</h1>
      <p>
        Each micro-operation is one clock cycle. Press <span class="kbd">⇧F10</span> (µStep) to execute exactly one and see
        which units it used.
      </p>
    </div>
    <div class="controls">
      <button class="btn primary" :disabled="!s.view.value?.loaded || s.view.value?.runState === 'running'" @click="s.send({ type: 'stepMicro' })">
        µStep (one cycle)
      </button>
      <button class="btn" :disabled="!s.view.value?.loaded || s.view.value?.runState === 'running'" @click="s.send({ type: 'stepInstruction' })">
        Finish / step instruction
      </button>
      <span class="muted">
        Highlighted = driven by the last micro-operation. Values are the live latch contents.
      </span>
    </div>
    <section class="panel">
      <header>Datapath</header>
      <div class="body"><Datapath /></div>
    </section>
    <section class="panel">
      <header>Current sequence</header>
      <div class="body"><MicroOpList /></div>
    </section>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  flex-wrap: wrap;
}
</style>
