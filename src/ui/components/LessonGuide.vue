<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useStore } from '../../app/store';
import { useLessons } from '../../app/lessons';
import { describeCheck } from '../../lessons/engine';
import { renderMarkdown } from '../markdown';

/**
 * The active lesson's current step, shown above whichever lab is open. The
 * check status is evaluated from the live machine view, never assumed.
 */
const s = useStore();
const L = useLessons();
const showHint = ref(false);
const collapsed = ref(false);

const lesson = computed(() => L.active.value!);
const st = computed(() => L.current.value!);
const body = computed(() => renderMarkdown(st.value.body));
const isLast = computed(() => L.step.value === lesson.value.steps.length - 1);
const stepDone = computed(() => !!L.passed[L.step.value]);
const allDone = computed(() => lesson.value.steps.every((_, i) => L.passed[i]));

watch(
  () => L.step.value,
  () => (showHint.value = false),
);
</script>

<template>
  <section class="panel guide" aria-label="Lesson guide" data-testid="lesson-guide">
    <header>
      <span>Lesson {{ lesson.number }} · {{ lesson.title }}</span>
      <span class="spacer" />
      <span class="faint small">step {{ L.step.value + 1 }} of {{ lesson.steps.length }}</span>
      <button class="btn small" :aria-expanded="!collapsed" @click="collapsed = !collapsed">
        {{ collapsed ? 'Show' : 'Hide' }}
      </button>
      <button
        class="btn small"
        title="Leave the lesson (the machine stays as it is)"
        data-testid="lesson-exit"
        @click="L.exit()"
      >
        Leave
      </button>
    </header>
    <div v-if="!collapsed" class="body">
      <ol class="steps" aria-label="Lesson steps">
        <li v-for="(x, i) in lesson.steps" :key="x.title">
          <button
            class="dot"
            :class="{ cur: i === L.step.value, ok: L.passed[i] }"
            :title="x.title"
            :aria-label="`Step ${i + 1}: ${x.title}${L.passed[i] ? ' (done)' : ''}`"
            :aria-current="i === L.step.value ? 'step' : undefined"
            :disabled="L.busy.value"
            @click="L.go(i)"
          >
            {{ L.passed[i] ? '✔' : i + 1 }}
          </button>
        </li>
      </ol>
      <h3>{{ st.title }}</h3>
      <div class="prose" v-html="body"></div>
      <div v-if="st.check" class="check" :class="stepDone ? 'ok' : ''" data-testid="lesson-check" role="status">
        <b>{{ stepDone ? '✔ Observed:' : L.currentHolds.value ? '✔ Now:' : 'Waiting for:' }}</b>
        {{ describeCheck(st.check) }}
      </div>
      <div v-if="L.error.value" class="err small" role="alert">Could not perform the step: {{ L.error.value }}</div>
      <div v-if="showHint && st.hint" class="hint small">{{ st.hint }}</div>
      <div class="actions">
        <button class="btn small" :disabled="L.step.value === 0 || L.busy.value" @click="L.go(L.step.value - 1)">
          ◀ Back
        </button>
        <button
          v-if="st.solution"
          class="btn small"
          :disabled="L.busy.value || s.view.value?.runState === 'running'"
          title="Perform this step with the same controls you would use"
          data-testid="lesson-show-me"
          @click="L.showMe()"
        >
          Show me
        </button>
        <button v-if="st.hint" class="btn small" @click="showHint = !showHint">Hint</button>
        <button v-if="st.lab && s.lab.value !== st.lab" class="btn small" @click="s.lab.value = st.lab!">
          Open the {{ st.lab }} lab
        </button>
        <span class="spacer" />
        <button
          v-if="!isLast"
          class="btn small"
          :disabled="L.busy.value"
          :class="{ primary: stepDone }"
          data-testid="lesson-next"
          @click="L.go(L.step.value + 1)"
        >
          Next ▶
        </button>
        <span v-else-if="allDone" class="chip ok" data-testid="lesson-complete">Lesson complete</span>
      </div>
      <details v-if="isLast" class="more">
        <summary>Experiments and expected observations</summary>
        <h4>Try</h4>
        <ul>
          <li v-for="e in lesson.experiments" :key="e">{{ e }}</li>
        </ul>
        <h4>You should observe</h4>
        <ul>
          <li v-for="o in lesson.observations" :key="o">{{ o }}</li>
        </ul>
      </details>
    </div>
  </section>
</template>

<style scoped>
.guide {
  border-color: var(--accent);
}
.guide h3 {
  margin: 0.4rem 0 0.2rem;
  font-size: 1rem;
}
.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
}
.dot {
  min-width: 1.7rem;
  height: 1.7rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: inherit;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.dot.cur {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.dot.ok {
  background: var(--ok-soft);
}
.check {
  margin: 0.5rem 0;
  padding: 0.4rem 0.6rem;
  border-radius: 6px;
  background: var(--panel-2);
  font-size: 0.88rem;
}
.check.ok {
  background: var(--ok-soft);
}
.hint {
  margin: 0.3rem 0;
  font-style: italic;
}
.err {
  color: var(--err);
}
.actions {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  flex-wrap: wrap;
}
.more {
  margin-top: 0.6rem;
  font-size: 0.9rem;
}
</style>
