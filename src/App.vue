<script setup lang="ts">
import { computed } from 'vue';
import { assemble } from './core/asm/assembler';
import { bareMetalConfig } from './core/build/bareMetal';
import { Machine } from './core/machine/machine';

// Milestone 1 placeholder: proves the real CPU core runs in the browser bundle.
const demo = computed(() => {
  const r = assemble(`
        .org 0x0000
        .word start
        .org 0x0100
start:  MOVP P0, #msg
loop:   LD R2, [P0]
        CMP R2, #0
        JEQ done
        ST [0xF030], R2
        INCP P0
        JMP loop
done:   HLT
msg:    .asciz "Hello from the VC-8 CPU."
`);
  const m = new Machine();
  m.powerOn(bareMetalConfig(r.segments));
  const res = m.run(100000);
  return { output: m.terminal.text(), cycles: m.cycle, instructions: m.instructions, reason: res.reason };
});
</script>

<template>
  <main class="placeholder">
    <h1>Virtual CPU &amp; Kernel Workshop</h1>
    <p>The workbench is under construction. Core self-test:</p>
    <pre data-testid="demo-output">{{ demo.output }}</pre>
    <p class="muted">{{ demo.instructions }} instructions, {{ demo.cycles }} cycles ({{ demo.reason }}).</p>
  </main>
</template>

<style scoped>
.placeholder {
  max-width: 720px;
  margin: 4rem auto;
  padding: 0 1rem;
}
pre {
  font-family: var(--font-mono);
  background: var(--panel);
  border: 1px solid var(--border);
  padding: 1rem;
}
.muted {
  color: var(--muted);
}
</style>
