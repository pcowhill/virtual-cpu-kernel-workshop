<script setup lang="ts">
import { computed, ref } from 'vue';
import { INSTRUCTIONS, type InstructionDef } from '../../core/isa/opcodes';
import { syntaxSummary } from '../../core/asm/assembler';
import { addressingMode, cycleCount, encodingLayout, microOpNames } from '../../core/isa/reference';
import { renderMarkdown } from '../markdown';
import archDoc from '../../../docs/spec/architecture.md?raw';
import kernelDoc from '../../../docs/os/kernel.md?raw';
import bootDoc from '../../../docs/os/boot-process.md?raw';
import preemptDoc from '../../../docs/os/preemption-walkthrough.md?raw';
import asmDoc from '../../../docs/spec/assembly-language.md?raw';
import guideDoc from '../../../docs/guide/user-guide.md?raw';
import limitsDoc from '../../../docs/limitations.md?raw';
import syscallsInc from '../../guest/include/syscalls.inc?raw';

const tab = ref<'isa' | 'asm' | 'arch' | 'kernel' | 'boot' | 'preempt' | 'abi' | 'guide' | 'limits'>('isa');
const q = ref('');
const selected = ref<InstructionDef | null>(INSTRUCTIONS[0] ?? null);

const rows = computed(() => {
  const t = q.value.trim().toLowerCase();
  return INSTRUCTIONS.filter(
    (d) =>
      !t ||
      d.mnemonic.toLowerCase().includes(t) ||
      d.aliases.some((a) => a.toLowerCase().includes(t)) ||
      d.summary.toLowerCase().includes(t) ||
      d.group.toLowerCase().includes(t) ||
      d.opcode.toString(16).padStart(2, '0') === t.replace(/^0x/, ''),
  );
});

const DOCS: Record<string, string> = {
  arch: archDoc,
  asm: asmDoc,
  kernel: kernelDoc,
  boot: bootDoc,
  preempt: preemptDoc,
  guide: guideDoc,
  limits: limitsDoc,
};
const html = computed(() => (DOCS[tab.value] ? renderMarkdown(DOCS[tab.value]!) : ''));
const TABS = [
  { id: 'guide', label: 'User guide' },
  { id: 'isa', label: 'Instruction set' },
  { id: 'asm', label: 'Assembly language' },
  { id: 'arch', label: 'Architecture spec' },
  { id: 'abi', label: 'System calls' },
  { id: 'kernel', label: 'Kernel' },
  { id: 'boot', label: 'Boot walkthrough' },
  { id: 'preempt', label: 'Preemption walkthrough' },
  { id: 'limits', label: 'Simplifications & limitations' },
] as const;
</script>

<template>
  <div class="lab">
    <div class="lab-title">
      <h1>Reference</h1>
      <p>
        VC-8 is a custom educational ISA. Everything here is generated from, or shipped with, the implementation and
        works offline.
      </p>
    </div>
    <div class="tabs" role="tablist">
      <button
        v-for="t in TABS"
        :key="t.id"
        class="btn"
        :class="{ primary: tab === t.id }"
        role="tab"
        :aria-selected="tab === t.id"
        :data-testid="`ref-${t.id}`"
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
    </div>
    <div v-if="tab === 'isa'" class="isa">
      <section class="panel">
        <header>
          {{ rows.length }} instructions
          <span class="spacer" />
          <input
            v-model="q"
            type="text"
            placeholder="search mnemonic, group, opcode"
            aria-label="Search instructions"
            data-testid="isa-search"
          />
        </header>
        <div class="body scroll isatable">
          <table class="data mono">
            <thead>
              <tr>
                <th>op</th>
                <th>syntax</th>
                <th>bytes</th>
                <th>cycles</th>
                <th>flags</th>
                <th>priv</th>
                <th>summary</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="d in rows"
                :key="d.opcode"
                class="clickable"
                :class="{ selected: selected === d }"
                @click="selected = d"
              >
                <td>{{ d.opcode.toString(16).toUpperCase().padStart(2, '0') }}</td>
                <td>{{ syntaxSummary(d) }}</td>
                <td>{{ d.length }}</td>
                <td>{{ cycleCount(d) }}</td>
                <td>{{ d.flags }}</td>
                <td>{{ d.privileged ? 'yes' : '' }}</td>
                <td class="sum">{{ d.summary }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section v-if="selected" class="panel" data-testid="isa-detail">
        <header>{{ syntaxSummary(selected) }}</header>
        <div class="body prose">
          <p>
            <b>{{ selected.summary }}</b
            >{{ selected.aliases.length ? ` (aliases: ${selected.aliases.join(', ')})` : '' }}
          </p>
          <p class="mono">{{ selected.rtl }}</p>
          <table class="data mono">
            <tbody>
              <tr>
                <td>opcode</td>
                <td>
                  0x{{ selected.opcode.toString(16).toUpperCase().padStart(2, '0') }} =
                  {{ selected.opcode.toString(2).padStart(8, '0') }}
                </td>
              </tr>
              <tr>
                <td>encoding</td>
                <td>{{ encodingLayout(selected) }}</td>
              </tr>
              <tr>
                <td>length</td>
                <td>{{ selected.length }} byte(s)</td>
              </tr>
              <tr>
                <td>addressing</td>
                <td>{{ addressingMode(selected) }}</td>
              </tr>
              <tr>
                <td>flags written</td>
                <td>{{ selected.flags }}</td>
              </tr>
              <tr>
                <td>privilege</td>
                <td>{{ selected.privileged ? 'supervisor only (privilege fault in user mode)' : 'any mode' }}</td>
              </tr>
              <tr>
                <td>group</td>
                <td>{{ selected.group }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="selected.notes">{{ selected.notes }}</p>
          <h4>Micro-program ({{ cycleCount(selected) }} cycles)</h4>
          <ol class="mono micro">
            <li v-for="(m, i) in microOpNames(selected)" :key="i">{{ m }}</li>
          </ol>
        </div>
      </section>
    </div>
    <section v-else-if="tab === 'abi'" class="panel">
      <header>System-call ABI (include/syscalls.inc)</header>
      <div class="body">
        <pre class="mono abi">{{ syscallsInc }}</pre>
      </div>
    </section>
    <section v-else class="panel">
      <div class="body prose doc" v-html="html"></div>
    </section>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}
.isa {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(300px, 1fr);
  gap: 0.75rem;
  align-items: start;
}
.isatable {
  max-height: 70vh;
}
.sum {
  white-space: normal;
}
.micro {
  font-size: 0.8rem;
  padding-left: 1.4rem;
}
.abi {
  font-size: 0.82rem;
  margin: 0;
}
.doc :deep(table) {
  border-collapse: collapse;
  font-size: 0.82rem;
  margin: 0.6rem 0;
}
.doc :deep(th),
.doc :deep(td) {
  border: 1px solid var(--border);
  padding: 0.2rem 0.45rem;
  text-align: left;
  vertical-align: top;
}
.doc :deep(th) {
  background: var(--panel-2);
}
.doc :deep(h1) {
  font-size: 1.3rem;
}
.doc :deep(h2) {
  font-size: 1.1rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.2rem;
  margin-top: 1.4rem;
}
.doc :deep(h3) {
  font-size: 1rem;
}
.doc :deep(blockquote) {
  border-left: 4px solid var(--accent);
  margin: 0.6rem 0;
  padding: 0.3rem 0.8rem;
  background: var(--accent-soft);
}
.doc {
  max-width: 100ch;
}
@media (max-width: 1200px) {
  .isa {
    grid-template-columns: 1fr;
  }
}
</style>
