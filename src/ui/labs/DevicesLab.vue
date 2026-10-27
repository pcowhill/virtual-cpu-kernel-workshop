<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStore } from '../../app/store';
import TerminalPanel from '../components/TerminalPanel.vue';
import { hex2, hex4, bin8 } from '../format';
import { IO } from '../../core/isa/constants';

const s = useStore();
const v = computed(() => s.view.value);
const d = computed(() => v.value?.devices ?? null);
const text = ref('');

function sendText(): void {
  const bytes = [...text.value].map((c) => c.charCodeAt(0) & 0x7f);
  if (bytes.length) s.send({ type: 'injectKeys', bytes });
  text.value = '';
}

function toggleSwitch(i: number): void {
  const cur = d.value?.gpio.switches ?? 0;
  s.send({ type: 'setSwitches', value: cur ^ (1 << i) });
}

const REGS: { dev: string; regs: [string, number, string][] }[] = [
  {
    dev: 'System control (0xF000)',
    regs: [
      ['ID', IO.SYS_ID, 'R'],
      ['VERSION', IO.SYS_VERSION, 'R'],
      ['POWER', IO.SYS_POWER, 'W: 0xA5 powers off'],
      ['CYCLES0–3', IO.SYS_CYCLES0, 'R, latched'],
    ],
  },
  {
    dev: 'Interrupt controller (0xF010)',
    regs: [
      ['PENDING', IO.PIC_PENDING, 'R'],
      ['MASK', IO.PIC_MASK, 'R/W'],
    ],
  },
  {
    dev: 'Timer (0xF020) — IRQ 0',
    regs: [
      ['CTRL', IO.TIMER_CTRL, 'EN|IE|PERIODIC'],
      ['STATUS', IO.TIMER_STATUS, 'EXPIRED, W1C'],
      ['RELOAD_LO/HI', IO.TIMER_RELOAD_LO, 'R/W'],
      ['COUNT_LO/HI', IO.TIMER_COUNT_LO, 'R'],
    ],
  },
  {
    dev: 'Terminal (0xF030)',
    regs: [
      ['DATA', IO.TERM_DATA, 'W'],
      ['STATUS', IO.TERM_STATUS, 'R: READY'],
      ['CTRL', IO.TERM_CTRL, 'W: 1 = clear'],
    ],
  },
  {
    dev: 'Keyboard (0xF040) — IRQ 1',
    regs: [
      ['DATA', IO.KBD_DATA, 'R: dequeue'],
      ['STATUS', IO.KBD_STATUS, 'AVAIL|OVERFLOW'],
      ['CTRL', IO.KBD_CTRL, 'IE'],
      ['COUNT', IO.KBD_COUNT, 'R'],
    ],
  },
  {
    dev: 'LEDs / GPIO (0xF050)',
    regs: [
      ['LEDS', IO.GPIO_LEDS, 'R/W'],
      ['SWITCHES', IO.GPIO_SWITCHES, 'R'],
    ],
  },
  {
    dev: 'Storage (0xF060) — IRQ 2',
    regs: [
      ['CMD', IO.DISK_CMD, 'W: 1 read, 2 write, 3 rewind'],
      ['STATUS', IO.DISK_STATUS, 'BUSY|DONE|ERROR'],
      ['BLOCK_LO/HI', IO.DISK_BLOCK_LO, 'R/W'],
      ['DATA', IO.DISK_DATA, 'R/W, auto-increment'],
      ['ERRCODE', IO.DISK_ERRCODE, 'R'],
      ['CTRL', IO.DISK_CTRL, 'IE'],
      ['BLOCKS', IO.DISK_BLOCKS, 'R: capacity'],
    ],
  },
];

function peek(a: number, wide = false): string {
  const m = v.value?.memory;
  if (!m) return '--';
  return wide ? hex4(m[a]! | (m[a + 1]! << 8)) : hex2(m[a]!);
}
</script>

<template>
  <div class="lab">
    <div class="lab-title">
      <h1>Devices</h1>
      <p>Memory-mapped hardware at 0xF000–0xF06F. Guest software reaches these only through loads and stores.</p>
    </div>
    <div class="grid2">
      <div class="col">
        <TerminalPanel class="bigterm" />
        <section class="panel">
          <header>Keyboard input</header>
          <div class="body">
            <form class="kbd-form" @submit.prevent="sendText">
              <input v-model="text" type="text" placeholder="type text, Enter sends it" aria-label="Text to type on the virtual keyboard" data-testid="kbd-input" />
              <button class="btn small" type="submit">Send</button>
              <button class="btn small" type="button" @click="s.send({ type: 'injectKeys', bytes: [13] })">⏎ CR</button>
            </form>
            <div v-if="d" class="mono small">
              FIFO ({{ d.keyboard.queue.length }}/16): {{ d.keyboard.queue.map(hex2).join(' ') || 'empty' }}
              <span v-if="d.keyboard.overflow" class="chip err">overflow</span>
              <span class="chip" :class="d.keyboard.irq ? 'warn' : ''">IRQ1 {{ d.keyboard.irq ? 'asserted' : 'idle' }}</span>
            </div>
            <p class="faint small">Keys are delivered at the current simulated cycle, so a run with the same inputs at the same cycles is reproducible.</p>
          </div>
        </section>
      </div>
      <div class="col">
        <section v-if="d" class="panel">
          <header>LEDs and switches</header>
          <div class="body">
            <div class="leds" role="img" :aria-label="`LEDs: ${bin8(d.gpio.leds)}`" data-testid="leds">
              <span v-for="i in 8" :key="i" class="led" :class="{ on: d.gpio.leds & (1 << (8 - i)) }" :title="`LED ${8 - i}`" />
              <span class="mono small">{{ bin8(d.gpio.leds) }} (writes: {{ d.gpio.ledWrites }})</span>
            </div>
            <div class="switches">
              <label v-for="i in 8" :key="i" class="sw" :title="`Switch ${8 - i}`">
                <input type="checkbox" :checked="!!(d.gpio.switches & (1 << (8 - i)))" @change="toggleSwitch(8 - i)" />
                <span class="mono">{{ 8 - i }}</span>
              </label>
            </div>
          </div>
        </section>
        <section v-if="d" class="panel">
          <header>Timer · storage · interrupts</header>
          <div class="body mono small status">
            <div>
              timer: CTRL {{ hex2(d.timer.ctrl) }} RELOAD {{ d.timer.reload }} COUNT {{ d.timer.count }}
              <span class="chip" :class="d.timer.irq ? 'warn' : ''">{{ d.timer.expired ? 'EXPIRED' : 'counting' }}</span>
              expirations {{ d.timer.expirations }}
            </div>
            <div>
              storage: STATUS {{ hex2(d.storage.status) }} BLOCK {{ d.storage.block }} ERR {{ d.storage.errcode }} ptr {{ d.storage.ptr }}
              busy {{ d.storage.busyCycles }} · reads {{ d.storage.reads }} writes {{ d.storage.writes }}
            </div>
            <div>PIC: PENDING {{ bin8(d.pic.pending) }} MASK {{ bin8(d.pic.mask) }}</div>
          </div>
        </section>
        <section class="panel">
          <header>Register map (live, read without side effects)</header>
          <div class="body scroll regmap">
            <table class="data mono">
              <tbody>
                <template v-for="g in REGS" :key="g.dev">
                  <tr><th colspan="4">{{ g.dev }}</th></tr>
                  <tr v-for="r in g.regs" :key="r[0]">
                    <td>{{ hex4(r[1]) }}</td>
                    <td>{{ r[0] }}</td>
                    <td>{{ peek(r[1], r[0].includes('/HI')) }}</td>
                    <td class="faint">{{ r[2] }}</td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid2 {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 0.75rem;
  align-items: start;
}
.col {
  display: grid;
  gap: 0.75rem;
}
.bigterm :deep(.screen) {
  min-height: 22rem;
  max-height: 32rem;
}
.kbd-form {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 0.4rem;
}
.kbd-form input {
  flex: 1;
}
.small {
  font-size: 0.8rem;
}
.leds {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}
.led {
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 50%;
  background: var(--panel-2);
  border: 2px solid var(--border-strong);
}
.led.on {
  background: #ff4d4d;
  border-color: #c21f1f;
  box-shadow: 0 0 8px #ff4d4d;
}
.switches {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.sw {
  display: grid;
  justify-items: center;
  font-size: 0.75rem;
}
.status {
  display: grid;
  gap: 0.35rem;
}
.regmap {
  max-height: 420px;
}
@media (max-width: 1250px) {
  .grid2 {
    grid-template-columns: 1fr;
  }
}
</style>
