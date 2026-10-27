<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useStore } from '../../app/store';
import HexView from '../components/HexView.vue';
import MemoryMap from '../components/MemoryMap.vue';
import { hex2, hex4, parseAddress } from '../format';
import { regionOf, REGION_INFO } from '../../core/isa/constants';

const s = useStore();
const base = ref(0x2000);
const rows = 24;
const jumpText = ref('');
const searchText = ref('');
const selected = ref<number | null>(null);
const watchKind = ref<'r' | 'w' | 'rw'>('w');

watch(s.focusAddress, (a) => {
  if (a !== null) base.value = a & 0xfff0;
});

function lookup(name: string): number | undefined {
  return s.build.value?.symbols.find((x) => x.name === name)?.value;
}

function jump(): void {
  const a = parseAddress(jumpText.value, lookup);
  if (a === null) s.notify('error', `Unknown address or symbol: ${jumpText.value}`);
  else base.value = a & 0xfff0;
}

function page(d: number): void {
  base.value = (base.value + d * 16 * rows + 0x10000) & 0xfff0;
}

/** Search for a byte sequence (hex, e.g. "48 65") or text ("Hello"). */
function search(): void {
  const v = s.view.value;
  if (!v || !searchText.value) return;
  const t = searchText.value.trim();
  const needle =
    /^([0-9a-f]{2}\s*)+$/i.test(t) && t.length >= 2
      ? t
          .split(/\s+/)
          .flatMap((x) => x.match(/../g) ?? [])
          .map((x) => parseInt(x, 16))
      : [...t].map((c) => c.charCodeAt(0));
  const from = ((selected.value ?? base.value) + 1) & 0xffff;
  for (let k = 0; k < 0x10000; k++) {
    const a = (from + k) & 0xffff;
    if (needle.every((b, i) => v.memory[(a + i) & 0xffff] === b)) {
      selected.value = a;
      base.value = a & 0xfff0;
      return;
    }
  }
  s.notify('info', 'Not found.');
}

function addWatch(): void {
  if (selected.value === null) return;
  const others = s.debug.watchpoints.filter(([a]) => a !== selected.value);
  s.debug.watchpoints.splice(0, s.debug.watchpoints.length, ...others, [selected.value, watchKind.value]);
}

const stack = computed(() => {
  const v = s.view.value;
  if (!v) return [];
  const sp = v.cpu.sp;
  return Array.from({ length: 16 }, (_, i) => {
    const a = (sp + i) & 0xffff;
    return { a, v: v.memory[a]! };
  });
});

const selectedInfo = computed(() => {
  if (selected.value === null || !s.view.value) return null;
  const a = selected.value;
  const r = regionOf(a);
  const sym = s.build.value?.symbols.find((x) => x.value === a && x.kind === 'label');
  return { a, v: s.view.value.memory[a]!, region: REGION_INFO[r].name, sym: sym?.name };
});
</script>

<template>
  <div class="lab">
    <div class="lab-title">
      <h1>Memory &amp; stack</h1>
      <p>The full 64 KiB address space, coloured by region; the dashed box is the user protection window.</p>
    </div>
    <div class="layout">
      <section class="panel">
        <header>
          Hex view
          <span class="spacer" />
          <button class="btn small" title="Previous page" @click="page(-1)">◀</button>
          <button class="btn small" title="Next page" @click="page(1)">▶</button>
        </header>
        <div class="body tools">
          <form @submit.prevent="jump">
            <label
              >Go to
              <input
                v-model="jumpText"
                type="text"
                placeholder="0x2000 or label"
                aria-label="Address or label"
                data-testid="mem-goto"
            /></label>
            <button class="btn small" type="submit">Go</button>
          </form>
          <button class="btn small" @click="base = (s.view.value?.cpu.pc ?? 0) & 0xfff0">PC</button>
          <button class="btn small" @click="base = (s.view.value?.cpu.sp ?? 0) & 0xfff0">SP</button>
          <form @submit.prevent="search">
            <label
              >Find
              <input v-model="searchText" type="text" placeholder="bytes (48 65) or text" aria-label="Search memory"
            /></label>
            <button class="btn small" type="submit">Next</button>
          </form>
        </div>
        <div class="body scroll">
          <HexView :base="base" :rows="rows" @select="(a) => (selected = a)" />
        </div>
        <div class="body legend faint">
          <span class="sw rom" />ROM <span class="sw kernel" />kernel RAM <span class="sw user" />user RAM
          <span class="sw mmio" />devices · <b class="mono">highlighted</b> = changed since last update · outlined: PC
          (blue), SP (orange) · double-click a byte to edit it (debugger action)
        </div>
      </section>
      <div class="side">
        <section class="panel">
          <header>Selected byte</header>
          <div class="body">
            <template v-if="selectedInfo">
              <div class="mono">
                {{ hex4(selectedInfo.a) }} = 0x{{ hex2(selectedInfo.v) }} ({{ selectedInfo.v }})
                <span v-if="selectedInfo.sym" class="chip accent">{{ selectedInfo.sym }}</span>
              </div>
              <div class="muted">{{ selectedInfo.region }}</div>
              <div class="wp">
                <select v-model="watchKind" aria-label="Watchpoint type">
                  <option value="w">write</option>
                  <option value="r">read</option>
                  <option value="rw">read/write</option>
                </select>
                <button class="btn small" data-testid="add-watchpoint" @click="addWatch">Add watchpoint</button>
              </div>
            </template>
            <span v-else class="muted">Click a byte.</span>
          </div>
        </section>
        <section class="panel">
          <header>Stack (from SP upward)</header>
          <div class="body mono stack">
            <div v-for="(e, i) in stack" :key="e.a" class="srow">
              <span class="faint">SP+{{ i }}</span
              ><span>{{ hex4(e.a) }}</span
              ><b>{{ hex2(e.v) }}</b>
            </div>
          </div>
        </section>
        <section class="panel">
          <header>Memory map</header>
          <div class="body"><MemoryMap @jump="(a) => (base = a & 0xfff0)" /></div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 0.75rem;
  align-items: start;
}
.side {
  display: grid;
  gap: 0.75rem;
}
.tools {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  align-items: center;
  border-bottom: 1px solid var(--border);
}
.tools form {
  display: flex;
  gap: 0.3rem;
  align-items: center;
}
.tools input {
  width: 9rem;
}
.legend {
  font-size: 0.75rem;
  border-top: 1px solid var(--border);
}
.sw {
  display: inline-block;
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 2px;
  vertical-align: middle;
  margin: 0 0.2rem 0 0.4rem;
}
.sw.rom {
  background: var(--rom);
}
.sw.kernel {
  background: var(--kernel);
}
.sw.user {
  background: var(--user);
}
.sw.mmio {
  background: var(--mmio);
}
.wp {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.4rem;
}
.stack {
  font-size: 0.8rem;
}
.srow {
  display: grid;
  grid-template-columns: 3.5rem 3.5rem 2rem;
}
@media (max-width: 1300px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
