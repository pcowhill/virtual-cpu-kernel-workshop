<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from '../../app/store';
import DisassemblyView from '../components/DisassemblyView.vue';
import { hex2, hex4 } from '../format';
import { MEM } from '../../core/isa/constants';
import { DATA_AREA_BLOCK } from '../../core/build/system';

const s = useStore();
const v = computed(() => s.view.value);
const sys = computed(() => s.build.value?.system ?? null);
const isOs = computed(() => s.build.value?.mode === 'os');

/** Boot stage derived from observable machine state (PC region, events). */
const stages = computed(() => {
  const view = v.value;
  const k = sys.value?.kernelImage;
  const events = view?.events ?? [];
  const reachedUser = events.some((e) => e.type === 'rti' && e.toUser);
  const pc = view?.cpu.pc ?? 0;
  const inRom = pc <= MEM.ROM_END;
  const kernelStarted = !!view && (!inRom || reachedUser);
  const blocksRead = view ? view.devices.storage.reads : 0;
  const kernelBlocks = k?.count ?? 0;
  return [
    { id: 'reset', label: 'Reset: PC ← vector at 0x0000', done: (view?.cycle ?? 0) >= 5 },
    { id: 'fw', label: 'Firmware runs from ROM', done: (view?.cycle ?? 0) > 5 },
    { id: 'hdr', label: 'Boot block 0 read and validated', done: blocksRead >= 1 },
    {
      id: 'copy',
      label: `Kernel copied from storage into RAM (${Math.max(0, Math.min(blocksRead - 1, kernelBlocks))}/${kernelBlocks} blocks)`,
      done: kernelStarted || blocksRead - 1 >= kernelBlocks,
    },
    { id: 'jump', label: 'JMP to kernel entry (supervisor mode)', done: kernelStarted },
    { id: 'init', label: 'Kernel: vectors, drivers, processes loaded', done: reachedUser },
    { id: 'user', label: 'RTI into the first user program', done: reachedUser },
  ];
});

const kernelProgress = computed(() => {
  const view = v.value;
  const k = sys.value?.kernelImage;
  if (!view || !k || !sys.value) return null;
  const start = k.block * 256;
  let same = 0;
  const n = k.count * 256;
  for (let i = 0; i < n; i++) if (view.memory[k.load + i] === sys.value.disk[start + i]) same++;
  return { same, n };
});

const blocks = computed(() => {
  const b = sys.value;
  if (!b) return [];
  const k = b.kernelImage;
  const use: { kind: string; label: string }[] = Array.from({ length: 256 }, (_, i) => ({
    kind: i >= DATA_AREA_BLOCK ? 'data-free' : 'free',
    label: i >= DATA_AREA_BLOCK ? 'data area' : 'free',
  }));
  use[0] = { kind: 'boot', label: 'boot block' };
  if (k) for (let i = 0; i < k.count; i++) use[k.block + i] = { kind: 'kernel', label: `kernel ${i + 1}/${k.count}` };
  for (const p of b.programs) {
    if (!p.image) continue;
    for (let i = 0; i < p.image.count; i++) use[p.image.block + i] = { kind: 'program', label: `${p.spec.name} ${i + 1}/${p.image.count}` };
  }
  for (const f of b.dataFiles) use[f.block] = { kind: 'data', label: f.description };
  return use;
});

const header = computed(() => {
  const b = sys.value;
  if (!b) return null;
  const h = b.disk.subarray(0, 256);
  const word = (o: number) => h[o]! | (h[o + 1]! << 8);
  return {
    magic: String.fromCharCode(h[0]!, h[1]!),
    version: h[2],
    kblock: h[3],
    kcount: h[4],
    kload: word(5),
    kentry: word(7),
    ksum: h[9],
    nprog: h[10],
    progs: Array.from({ length: h[10]! }, (_, i) => {
      const e = h.subarray(16 + i * 16, 32 + i * 16);
      return {
        name: new TextDecoder().decode(e.subarray(0, 8)).replace(/\0+$/, ''),
        block: e[8],
        count: e[9],
        load: e[10]! | (e[11]! << 8),
        entry: e[12]! | (e[13]! << 8),
      };
    }),
  };
});

function bootOs(): void {
  s.project.mode = 'os';
  s.buildAndLoad();
}
</script>

<template>
  <div class="lab">
    <div class="lab-title">
      <h1>Boot &amp; firmware</h1>
      <p>
        The CPU starts in ROM; the firmware reads the kernel from block storage and copies it into RAM byte by byte. The
        workbench only provides the ROM chip and the disk.
      </p>
    </div>
    <div v-if="!isOs" class="panel">
      <div class="body">
        The machine is currently in bare-metal mode.
        <button class="btn primary" data-testid="boot-os" @click="bootOs">Build &amp; boot the operating system</button>
      </div>
    </div>
    <template v-else>
      <div class="actions">
        <button class="btn" :disabled="v?.runState === 'running'" @click="s.runTo(s.symbol('fw_reset') ?? 0x40)">Run to fw_reset</button>
        <button class="btn" :disabled="v?.runState === 'running'" data-testid="run-to-kernel" @click="s.runTo(s.symbol('kernel_entry') ?? 0x2000)">
          Run to kernel entry
        </button>
        <button class="btn" @click="s.debug.watchpoints.push([sys?.kernelImage?.load ?? 0x2000, 'w'])">
          Watch first kernel byte being written
        </button>
        <span class="muted">Tip: use a slow clock (1 kHz) and watch the Memory lab fill in.</span>
      </div>
      <div class="layout">
        <section class="panel">
          <header>Boot progress</header>
          <div class="body">
            <ol class="stages">
              <li v-for="st in stages" :key="st.id" :class="{ done: st.done }" :data-testid="`stage-${st.id}`">
                <span class="tick">{{ st.done ? '✔' : '○' }}</span>{{ st.label }}
              </li>
            </ol>
            <div v-if="kernelProgress" class="progress">
              <div class="bar"><div class="fill" :style="{ width: `${(100 * kernelProgress.same) / kernelProgress.n}%` }" /></div>
              <span class="mono small">{{ kernelProgress.same }} / {{ kernelProgress.n }} kernel bytes in RAM match the disk</span>
            </div>
          </div>
        </section>
        <section class="panel">
          <header>Firmware code (ROM)</header>
          <div class="body">
            <DisassemblyView :address="(v?.cpu.pc ?? 0) <= 0x1fff ? null : s.symbol('fw_reset') ?? 0x40" :count="14" />
          </div>
        </section>
      </div>
      <div class="layout">
        <section class="panel">
          <header>
            Storage medium — 256 blocks
            <span class="spacer" />
            <span class="mono" style="text-transform: none">BLOCK = {{ v?.devices.storage.block ?? 0 }}, reads = {{ v?.devices.storage.reads ?? 0 }}</span>
          </header>
          <div class="body">
            <div class="disk" role="img" aria-label="Disk block map">
              <span
                v-for="(b, i) in blocks"
                :key="i"
                class="blk"
                :class="[b.kind, { cur: i === v?.devices.storage.block }]"
                :title="`block ${i}: ${b.label}`"
              />
            </div>
            <div class="legend faint">
              <span class="blk boot" /> boot block <span class="blk kernel" /> kernel <span class="blk program" /> programs
              <span class="blk data" /> data files · outlined = BLOCK register
            </div>
          </div>
        </section>
        <section v-if="header" class="panel">
          <header>Boot block (block 0) as the firmware reads it</header>
          <div class="body">
            <table class="data mono">
              <tbody>
                <tr><td>magic / version</td><td>"{{ header.magic }}" / {{ header.version }}</td></tr>
                <tr><td>kernel blocks</td><td>{{ header.kblock }} … {{ (header.kblock ?? 0) + (header.kcount ?? 0) - 1 }} ({{ header.kcount }})</td></tr>
                <tr><td>load / entry</td><td>0x{{ hex4(header.kload) }} / 0x{{ hex4(header.kentry) }}</td></tr>
                <tr><td>checksum</td><td>0x{{ hex2(header.ksum ?? 0) }}</td></tr>
                <tr v-for="p in header.progs" :key="p.name">
                  <td>program "{{ p.name }}"</td>
                  <td>blocks {{ p.block }}+{{ p.count }} → 0x{{ hex4(p.load) }}, entry 0x{{ hex4(p.entry) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
}
.layout {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
  gap: 0.75rem;
}
.stages {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.3rem;
}
.stages li {
  color: var(--faint);
}
.stages li.done {
  color: var(--text);
}
.tick {
  display: inline-block;
  width: 1.4rem;
  color: var(--ok);
}
.progress {
  margin-top: 0.7rem;
  display: grid;
  gap: 0.3rem;
}
.bar {
  height: 8px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--ok);
}
.small {
  font-size: 0.78rem;
}
.disk {
  display: grid;
  grid-template-columns: repeat(32, 1fr);
  gap: 2px;
}
.blk {
  display: inline-block;
  aspect-ratio: 1;
  min-width: 8px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 2px;
}
.legend .blk {
  width: 10px;
  vertical-align: middle;
  margin-left: 0.4rem;
}
.blk.boot {
  background: var(--rom-strong);
}
.blk.kernel {
  background: var(--kernel-strong);
}
.blk.program {
  background: var(--user-strong);
}
.blk.data {
  background: var(--mmio-strong);
}
.blk.data-free {
  background: color-mix(in srgb, var(--mmio) 40%, transparent);
}
.blk.cur {
  outline: 2px solid var(--accent);
}
.legend {
  font-size: 0.75rem;
  margin-top: 0.4rem;
}
</style>
