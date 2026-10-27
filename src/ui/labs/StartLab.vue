<script setup lang="ts">
import { useStore } from '../../app/store';
import { EXAMPLES } from '../../catalog/examples';

const s = useStore();

function quickStart(): void {
  s.project.mode = 'bare';
  s.project.bareMain = 'examples/first-program.asm';
  s.selectedFile.value = 'examples/first-program.asm';
  if (s.buildAndLoad()) s.lab.value = 'cpu';
}

function bootOs(): void {
  const ex = EXAMPLES.find((e) => e.id === 'os-full')!;
  s.project.mode = 'os';
  s.project.os.programs.splice(0, s.project.os.programs.length, ...ex.programs!.map((p) => ({ ...p })));
  if (s.buildAndLoad()) {
    s.lab.value = 'boot';
    s.send({ type: 'run' });
  }
}
</script>

<template>
  <div class="lab start">
    <section class="hero panel">
      <div class="body">
        <h1>Virtual CPU &amp; Kernel Workshop</h1>
        <p class="lead">
          A complete little computer you can take apart: a custom 8-bit CPU that executes every instruction as real
          micro-operations, devices, boot firmware, and a preemptive multitasking kernel — all written in its own
          assembly language and running in your browser.
        </p>
        <p class="muted">
          <b>VC-8 is a custom educational instruction set.</b> It is not x86, ARM, RISC-V or any real processor; the
          Reference lab documents every rule it follows.
        </p>
        <div class="cta">
          <button class="btn primary" data-testid="quick-start" @click="quickStart">
            ▶ Quick start: step through a first program
          </button>
          <button class="btn primary" data-testid="boot-full-os" @click="bootOs">⏻ Boot the operating system</button>
          <button class="btn" @click="s.lab.value = 'lessons'">✎ Guided lessons</button>
          <button class="btn" @click="s.lab.value = 'examples'">❖ Example catalog</button>
        </div>
      </div>
    </section>
    <div class="grid3">
      <section class="panel">
        <header>1 · The CPU</header>
        <div class="body">
          Load the first program and press <span class="kbd">F10</span> to execute one instruction at a time. Watch
          registers and flags change in the panel on the right, and open <b>Datapath</b> to step a single clock cycle
          with <span class="kbd">⇧F10</span>.
        </div>
      </section>
      <section class="panel">
        <header>2 · Your own code</header>
        <div class="body">
          The <b>Assembly editor</b> holds every source file — examples, the boot ROM, the kernel and user programs.
          Edit, then <b>Build &amp; load</b> (<span class="kbd">Ctrl+↵</span>). Click the gutter to set breakpoints.
        </div>
      </section>
      <section class="panel">
        <header>3 · The operating system</header>
        <div class="body">
          Boot the OS and follow it in <b>Boot &amp; firmware</b>, <b>Kernel &amp; interrupts</b> and
          <b>Processes &amp; scheduling</b>. Type into the terminal: the echo program wakes up on the keyboard
          interrupt.
        </div>
      </section>
    </div>
    <section class="panel">
      <header>How to read this workbench</header>
      <div class="body prose">
        <ul>
          <li>
            Everything shown comes from one simulated machine running in a background worker. Views never animate
            invented activity: highlights and traces are produced by the instructions that actually executed.
          </li>
          <li>
            The machine only changes when you run, step, rebuild, or make an explicit debugger edit (marked as such).
            Editing source code never silently changes a running machine — rebuild to apply it.
          </li>
          <li>
            Execution is deterministic: time is counted in simulated clock cycles. The clock setting only changes how
            fast cycles pass for you, never the result.
          </li>
          <li>
            Press <span class="kbd">F5</span> or Pause to stop a runaway program at any time; the interface stays
            responsive.
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hero h1 {
  margin: 0.2rem 0 0.5rem;
  font-size: 1.5rem;
}
.lead {
  font-size: 1.02rem;
  max-width: 75ch;
  line-height: 1.5;
}
.cta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.8rem;
}
.grid3 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 0.75rem;
}
.grid3 .body {
  line-height: 1.5;
  font-size: 0.9rem;
}
</style>
