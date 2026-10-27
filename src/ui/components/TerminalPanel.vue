<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useStore } from '../../app/store';

const props = defineProps<{ rows?: number }>();
const s = useStore();
const screen = ref<HTMLElement | null>(null);
const focused = ref(false);

const text = computed(() => {
  const t = s.view.value?.devices.terminal;
  if (!t) return '';
  return [...t.lines.slice(-(props.rows ?? 400)), t.current].join('\n');
});

watch(text, async () => {
  await nextTick();
  if (screen.value) screen.value.scrollTop = screen.value.scrollHeight;
});

/** Translate a browser key into a byte for the virtual keyboard device. */
function keyToByte(e: KeyboardEvent): number | null {
  if (e.ctrlKey || e.metaKey || e.altKey) {
    if (e.ctrlKey && /^[a-z]$/i.test(e.key)) return e.key.toUpperCase().charCodeAt(0) - 64;
    return null;
  }
  if (e.key === 'Enter') return 13;
  if (e.key === 'Backspace') return 8;
  if (e.key.length === 1) {
    const c = e.key.charCodeAt(0);
    return c < 128 ? c : null;
  }
  return null;
}

function onKey(e: KeyboardEvent): void {
  if (/^F\d{1,2}$/.test(e.key)) return; // leave debugger shortcuts alone
  // Tab moves focus as usual and Escape leaves the terminal, so keyboard users are never trapped.
  if (e.key === 'Tab') return;
  if (e.key === 'Escape') {
    (e.currentTarget as HTMLElement).blur();
    return;
  }
  const b = keyToByte(e);
  if (b === null) return;
  e.preventDefault();
  e.stopPropagation();
  s.send({ type: 'injectKeys', bytes: [b] });
}
</script>

<template>
  <section class="panel terminal" aria-label="Terminal">
    <header>
      Terminal
      <span class="spacer" />
      <span class="faint" style="text-transform: none; font-weight: 400">
        {{ focused ? 'typing goes to the virtual keyboard · Esc leaves' : 'click to type' }}
      </span>
    </header>
    <pre
      ref="screen"
      class="screen mono"
      tabindex="0"
      role="log"
      aria-live="polite"
      aria-label="Terminal output. Focus and type to send keys to the virtual keyboard."
      data-testid="terminal"
      :class="{ focused }"
      @focus="focused = true"
      @blur="focused = false"
      @keydown="onKey">{{ text }}<span v-if="focused" class="cursor">▌</span></pre>
  </section>
</template>

<style scoped>
.terminal {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.screen {
  margin: 0;
  flex: 1;
  min-height: 8rem;
  max-height: 100%;
  overflow: auto;
  background: #10161d;
  color: #d6f5d6;
  padding: 0.5rem 0.6rem;
  font-size: 0.8rem;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-all;
  border-radius: 0 0 var(--radius) var(--radius);
  cursor: text;
}
.screen.focused {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.cursor {
  animation: blink 1s steps(1) infinite;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
</style>
