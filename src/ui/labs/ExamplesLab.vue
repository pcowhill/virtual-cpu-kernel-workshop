<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStore } from '../../app/store';
import { EXAMPLES, evaluateCheck, type CheckResult, type Example } from '../../catalog/examples';
import type { RunResult } from '../../core/machine/machine';

const s = useStore();
const level = ref<'all' | Example['difficulty']>('all');
const results = ref<Record<string, CheckResult | 'running'>>({});

const list = computed(() => EXAMPLES.filter((e) => level.value === 'all' || e.difficulty === level.value));

/** Configure the project for an example and build + load it (power-cycles the machine). */
function load(e: Example, open = true): boolean {
  if (e.kind === 'bare') {
    s.project.mode = 'bare';
    s.project.bareMain = e.file!;
    s.selectedFile.value = e.file!;
  } else {
    s.project.mode = 'os';
    s.project.os.programs.splice(0, s.project.os.programs.length, ...e.programs!.map((p) => ({ ...p })));
    s.selectedFile.value = e.programs![0]!.path;
  }
  const ok = s.buildAndLoad();
  if (ok && open) s.lab.value = e.lab;
  return ok;
}

/** Load, run the example's check deterministically on the machine host, and evaluate it. */
async function runCheck(e: Example): Promise<void> {
  if (!load(e, false)) return;
  results.value[e.id] = 'running';
  if (e.check.keys) s.send({ type: 'injectKeys', bytes: [...e.check.keys].map((c) => c.charCodeAt(0)) });
  await s.client.request<RunResult>({ type: 'runDeterministic', cycles: e.check.cycles });
  const v = s.view.value!;
  const terminal = [...v.devices.terminal.lines, v.devices.terminal.current].join('\n');
  results.value[e.id] = evaluateCheck(e.check, {
    terminal,
    r: v.cpu.r,
    peek: (a) => v.memory[a]!,
    leds: v.devices.gpio.leds,
    processes: v.os?.processes ?? null,
  });
}

function result(e: Example): CheckResult | 'running' | undefined {
  return results.value[e.id];
}
</script>

<template>
  <div class="lab">
    <div class="lab-title">
      <h1>Examples</h1>
      <p>Working programs, built from source with the workshop assembler. Every example has an automated check.</p>
    </div>
    <div class="filters" role="radiogroup" aria-label="Difficulty">
      <button
        v-for="l in ['all', 'beginner', 'intermediate', 'advanced'] as const"
        :key="l"
        class="btn small"
        :class="{ primary: level === l }"
        role="radio"
        :aria-checked="level === l"
        @click="level = l"
      >
        {{ l }}
      </button>
    </div>
    <div class="cards">
      <article v-for="e in list" :key="e.id" class="panel card" :data-testid="`example-${e.id}`">
        <header>
          <span class="t">{{ e.title }}</span>
          <span class="spacer" />
          <span class="chip" :class="{ ok: e.difficulty === 'beginner', accent: e.difficulty === 'intermediate', warn: e.difficulty === 'advanced' }">{{ e.difficulty }}</span>
          <span class="chip">{{ e.kind === 'bare' ? 'bare metal' : 'with OS' }}</span>
        </header>
        <div class="body">
          <p>{{ e.description }}</p>
          <p class="muted"><b>Expected:</b> {{ e.expected }}</p>
          <p class="concepts">
            <span v-for="c in e.concepts" :key="c" class="chip">{{ c }}</span>
          </p>
          <p class="mono faint small">{{ e.kind === 'bare' ? e.file : e.programs!.map((p) => p.path).join(', ') }}</p>
          <div class="actions">
            <button class="btn primary small" :data-testid="`load-${e.id}`" @click="load(e)">Load</button>
            <button class="btn small" :data-testid="`check-${e.id}`" @click="runCheck(e)">Run &amp; check</button>
            <button v-if="e.kind === 'bare'" class="btn small" @click="(s.selectedFile.value = e.file!), (s.lab.value = 'editor')">View source</button>
          </div>
          <div v-if="result(e) === 'running'" class="muted small">running…</div>
          <div v-else-if="result(e)" class="checks small" :data-testid="`result-${e.id}`">
            <div :class="(result(e) as CheckResult).ok ? 'okline' : 'errline'">
              {{ (result(e) as CheckResult).ok ? '✔ check passed' : '✖ check failed' }}
            </div>
            <div v-for="m in (result(e) as CheckResult).failed" :key="m" class="errline">✖ {{ m }}</div>
            <div v-for="m in (result(e) as CheckResult).passed" :key="m" class="faint">✔ {{ m }}</div>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  gap: 0.3rem;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 0.75rem;
}
.card header {
  text-transform: none;
  font-size: 0.9rem;
  color: var(--text);
  flex-wrap: wrap;
}
.card p {
  margin: 0.25rem 0;
  font-size: 0.86rem;
}
.concepts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.actions {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.4rem;
}
.small {
  font-size: 0.78rem;
}
.checks {
  margin-top: 0.4rem;
}
.okline {
  color: var(--ok);
  font-weight: 600;
}
.errline {
  color: var(--err);
}
</style>
