<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStore } from '../../app/store';
import { useLessons } from '../../app/lessons';
import { LESSONS } from '../../lessons/lessons';
import { EXAMPLES } from '../../catalog/examples';
import { renderMarkdown } from '../markdown';

const s = useStore();
const L = useLessons();
const selectedId = ref<string>(L.active.value?.id ?? LESSONS[0]!.id);
const selected = computed(() => LESSONS.find((l) => l.id === selectedId.value)!);
const modified = computed(() => L.modifiedFiles(selected.value));
const explanation = computed(() => renderMarkdown(selected.value.explanation));
const done = (id: string) => L.completed.value.includes(id);

function exampleTitle(id: string): string {
  return EXAMPLES.find((e) => e.id === id)?.title ?? id;
}
</script>

<template>
  <div class="lab">
    <div class="lab-title">
      <h1>Guided lessons</h1>
      <p>
        Eighteen hands-on walkthroughs. Each one loads a working machine, then asks you to do something and checks the
        result on the running emulator. You can leave a lesson at any time and experiment freely.
      </p>
    </div>
    <div class="layout">
      <section class="panel">
        <header>
          Lessons
          <span class="spacer" />
          <span class="faint small" data-testid="lesson-progress"
            >{{ L.completed.value.length }}/{{ LESSONS.length }} done</span
          >
        </header>
        <ol class="list">
          <li v-for="l in LESSONS" :key="l.id">
            <button
              class="item"
              :class="{ active: l.id === selectedId }"
              :aria-current="l.id === selectedId ? 'true' : undefined"
              :data-testid="`lesson-${l.id}`"
              @click="selectedId = l.id"
            >
              <span class="num mono">{{ l.number }}</span>
              <span class="ttl">{{ l.title }}</span>
              <span v-if="done(l.id)" class="chip ok small" title="All steps observed on the machine">✔</span>
            </button>
          </li>
        </ol>
        <div class="body">
          <button class="btn small" :disabled="!L.completed.value.length" @click="L.resetProgress()">
            Reset progress
          </button>
        </div>
      </section>
      <section class="panel detail" :aria-label="selected.title">
        <header>Lesson {{ selected.number }}</header>
        <div class="body prose">
          <h2>{{ selected.title }}</h2>
          <p class="muted">{{ selected.summary }}</p>
          <h4>You will learn to</h4>
          <ul>
            <li v-for="o in selected.objectives" :key="o">{{ o }}</li>
          </ul>
          <div v-html="explanation"></div>
          <h4>Steps</h4>
          <ol>
            <li v-for="st in selected.steps" :key="st.title">{{ st.title }}</li>
          </ol>
          <div v-if="modified.length" class="warnbox" role="note">
            You have edited {{ modified.join(', ') }}. The lesson's checks expect the original source.
            <button class="btn small" data-testid="lesson-restore" @click="L.restoreFiles(selected)">
              Restore the original file{{ modified.length > 1 ? 's' : '' }}
            </button>
          </div>
          <div class="cta">
            <button
              class="btn primary"
              data-testid="lesson-start"
              :disabled="L.busy.value"
              @click="L.start(selected.id)"
            >
              {{ L.active.value?.id === selected.id ? '↺ Restart lesson' : '▶ Start lesson' }}
            </button>
            <span class="muted small">Starting builds the lesson's program and power-cycles the machine.</span>
          </div>
          <template v-if="selected.examples?.length">
            <h4>Related examples</h4>
            <ul>
              <li v-for="e in selected.examples" :key="e">
                <a href="#" @click.prevent="s.lab.value = 'examples'">{{ exampleTitle(e) }}</a>
              </li>
            </ul>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
  gap: 0.75rem;
  align-items: start;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0.3rem;
}
.item {
  display: grid;
  grid-template-columns: 1.8rem 1fr auto;
  gap: 0.4rem;
  align-items: center;
  width: 100%;
  text-align: left;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  padding: 0.35rem 0.4rem;
  border-radius: 6px;
  cursor: pointer;
}
.item:hover,
.item.active {
  background: var(--accent-soft);
}
.num {
  color: var(--muted);
  text-align: right;
}
.detail h2 {
  margin-top: 0;
}
.cta {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  flex-wrap: wrap;
  margin: 0.8rem 0;
}
.warnbox {
  border: 1px solid var(--border);
  border-left: 4px solid var(--warn);
  padding: 0.5rem 0.7rem;
  border-radius: 6px;
  margin: 0.6rem 0;
}
@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
