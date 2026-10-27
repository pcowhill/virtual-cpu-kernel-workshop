<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { highlightLine } from '../highlight';

/**
 * A lightweight code editor: a transparent <textarea> over a highlighted
 * <pre>, with a gutter for line numbers, breakpoints, diagnostics and the
 * current-PC marker. Native undo/redo and selection are preserved.
 */
const props = defineProps<{
  modelValue: string;
  /** Diagnostics by line (1-based). */
  diagnostics?: Map<number, { severity: 'error' | 'warning'; message: string }>;
  /** Lines that have a breakpoint. */
  breakpoints?: Set<number>;
  /** Lines that contain code (breakpoints can be set). */
  codeLines?: Set<number>;
  /** Line of the instruction at PC. */
  pcLine?: number | null;
  /** Line to reveal and highlight. */
  revealLine?: number | null;
  label?: string;
}>();
const emit = defineEmits<{
  'update:modelValue': [v: string];
  toggleBreakpoint: [line: number];
  cursor: [line: number];
}>();

const ta = ref<HTMLTextAreaElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const cursorLine = ref(1);

const lines = computed(() => props.modelValue.split('\n'));
const html = computed(() => lines.value.map((l) => highlightLine(l) || ' ').join('\n') + '\n');

function onInput(e: Event): void {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value);
  updateCursor();
}

function updateCursor(): void {
  const el = ta.value;
  if (!el) return;
  const line = el.value.slice(0, el.selectionStart).split('\n').length;
  if (line !== cursorLine.value) {
    cursorLine.value = line;
    emit('cursor', line);
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
    const el = ta.value!;
    e.preventDefault();
    const start = el.selectionStart;
    const end = el.selectionEnd;
    el.setRangeText(
      '        '.slice(0, 8 - ((start - el.value.lastIndexOf('\n', start - 1) - 1) % 8)),
      start,
      end,
      'end',
    );
    emit('update:modelValue', el.value);
  }
}

watch(
  () => props.revealLine,
  async (line) => {
    if (!line || !scroller.value || !ta.value) return;
    await nextTick();
    const lh = 19.5;
    const top = (line - 1) * lh;
    const sc = scroller.value;
    if (top < sc.scrollTop || top > sc.scrollTop + sc.clientHeight - 2 * lh)
      sc.scrollTop = Math.max(0, top - sc.clientHeight / 3);
  },
);
</script>

<template>
  <div ref="scroller" class="editor mono">
    <div class="gutter" aria-hidden="true">
      <div
        v-for="(_, i) in lines"
        :key="i"
        class="gline"
        :class="{
          err: diagnostics?.get(i + 1)?.severity === 'error',
          warn: diagnostics?.get(i + 1)?.severity === 'warning',
          pc: pcLine === i + 1,
          reveal: revealLine === i + 1,
          code: codeLines?.has(i + 1),
        }"
        :title="diagnostics?.get(i + 1)?.message ?? (codeLines?.has(i + 1) ? 'Click to toggle a breakpoint' : '')"
        @click="codeLines?.has(i + 1) && emit('toggleBreakpoint', i + 1)"
      >
        <span class="bp" :class="{ on: breakpoints?.has(i + 1) }">●</span>
        <span class="num">{{ i + 1 }}</span>
        <span class="mark">{{ pcLine === i + 1 ? '▶' : diagnostics?.get(i + 1) ? '!' : '' }}</span>
      </div>
    </div>
    <div class="code">
      <pre class="hl" aria-hidden="true" v-html="html"></pre>
      <div v-if="pcLine" class="pcbar" :style="{ top: `${(pcLine - 1) * 19.5 + 6}px` }" />
      <div v-if="revealLine" class="revealbar" :style="{ top: `${(revealLine - 1) * 19.5 + 6}px` }" />
      <textarea
        ref="ta"
        class="input"
        :value="modelValue"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        wrap="off"
        :aria-label="label ?? 'Assembly source'"
        data-testid="code-editor"
        @input="onInput"
        @keydown="onKeydown"
        @click="updateCursor"
        @keyup="updateCursor"
      ></textarea>
    </div>
  </div>
</template>

<style scoped>
.editor {
  display: grid;
  grid-template-columns: auto 1fr;
  font-size: 13px;
  line-height: 19.5px;
  overflow: auto;
  max-height: 70vh;
  min-height: 300px;
  background: var(--panel);
  position: relative;
}
.gutter {
  padding: 6px 0;
  background: var(--panel-2);
  border-right: 1px solid var(--border);
  user-select: none;
  position: sticky;
  left: 0;
  z-index: 2;
}
.gline {
  display: grid;
  grid-template-columns: 1rem 2.6rem 1rem;
  padding-right: 0.3rem;
  color: var(--faint);
  height: 19.5px;
}
.gline.code {
  cursor: pointer;
}
.gline.code:hover .bp {
  color: var(--border-strong);
}
.bp {
  color: transparent;
  text-align: center;
  font-size: 0.75rem;
}
.bp.on,
.gline.code:hover .bp.on {
  color: var(--err);
}
.num {
  text-align: right;
  padding-right: 0.3rem;
}
.gline.err .num,
.gline.err .mark {
  color: var(--err);
  font-weight: 700;
}
.gline.warn .mark {
  color: var(--warn);
}
.gline.pc .mark {
  color: var(--accent);
}
.code {
  position: relative;
  min-width: 0;
}
.hl,
.input {
  margin: 0;
  padding: 6px 10px;
  font: inherit;
  line-height: inherit;
  white-space: pre;
  tab-size: 8;
}
.hl {
  position: relative;
  z-index: 0;
  pointer-events: none;
  color: var(--text);
  min-height: 100%;
}
.input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  resize: none;
  border: 0;
  background: transparent;
  color: transparent;
  caret-color: var(--text);
  overflow: hidden;
  outline: none;
  z-index: 1;
}
.input::selection {
  background: color-mix(in srgb, var(--accent) 30%, transparent);
  color: transparent;
}
.pcbar,
.revealbar {
  position: absolute;
  left: 0;
  right: 0;
  height: 19.5px;
  pointer-events: none;
  z-index: 0;
}
.pcbar {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  border-left: 3px solid var(--accent);
}
.revealbar {
  background: color-mix(in srgb, var(--active) 35%, transparent);
}
:deep(.tok-comment) {
  color: var(--faint);
  font-style: italic;
}
:deep(.tok-label) {
  color: var(--accent);
  font-weight: 600;
}
:deep(.tok-mnemonic) {
  color: #8a3ab9;
  font-weight: 600;
}
:root[data-theme='dark'] :deep(.tok-mnemonic) {
  color: #d29cf5;
}
:deep(.tok-directive) {
  color: var(--kernel-strong);
}
:deep(.tok-register) {
  color: var(--ok);
}
:deep(.tok-number),
:deep(.tok-hash) {
  color: var(--warn);
}
:deep(.tok-string) {
  color: var(--mmio-strong);
}
:deep(.tok-constant) {
  color: var(--rom-strong);
  font-weight: 600;
}
</style>
