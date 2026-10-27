/**
 * Component tests: the real workbench components wired to the real machine
 * host (inline, on the main thread — happy-dom has no module workers).
 * Every value asserted on screen was produced by the emulated CPU.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { resetStore, useStore } from '../../src/app/store';
import { resetLessons } from '../../src/app/lessons';
import { resetWorkspaces } from '../../src/app/workspaces';
import type { MachineView } from '../../src/host/protocol';
import App from '../../src/App.vue';
import ControlBar from '../../src/ui/components/ControlBar.vue';
import RegisterPanel from '../../src/ui/components/RegisterPanel.vue';
import ReferenceLab from '../../src/ui/labs/ReferenceLab.vue';
import EditorLab from '../../src/ui/labs/EditorLab.vue';
import MemoryLab from '../../src/ui/labs/MemoryLab.vue';
import ExamplesLab from '../../src/ui/labs/ExamplesLab.vue';
import DatapathLab from '../../src/ui/labs/DatapathLab.vue';
import TerminalPanel from '../../src/ui/components/TerminalPanel.vue';

async function until(pred: (v: MachineView) => boolean, timeoutMs = 5000): Promise<MachineView> {
  const s = useStore();
  const t0 = Date.now();
  for (;;) {
    await flushPromises();
    const v = s.view.value;
    if (v && pred(v)) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('timed out waiting for machine view');
    s.send({ type: 'requestView' });
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Load the first example and wait until the machine reports it. */
async function loadFirstProgram(): Promise<void> {
  const s = useStore();
  s.project.mode = 'bare';
  s.project.bareMain = 'examples/first-program.asm';
  expect(s.buildAndLoad()).toBe(true);
  // Power-on leaves the CPU at the start of its reset micro-sequence.
  const v = await until((x) => x.loaded && x.label.includes('first-program'));
  expect(v.cycle).toBe(0);
  expect(v.cpu.sequence?.kind).toBe('reset');
  // One step completes the reset sequence: PC is loaded from the reset vector.
  s.send({ type: 'stepInstruction' });
  await until((x) => x.cpu.pc === 0x0100 && x.cycle > 0);
}

const mounted: VueWrapper[] = [];
function mountC(c: Parameters<typeof mount>[0]): VueWrapper {
  const w = mount(c, { attachTo: document.body });
  mounted.push(w);
  return w;
}

beforeEach(() => {
  vi.stubGlobal('Worker', undefined);
  resetStore();
  resetLessons();
  resetWorkspaces();
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetStore();
  vi.unstubAllGlobals();
});

describe('machine host wiring', () => {
  it('uses the inline host when workers are unavailable', () => {
    expect(useStore().client.hostKind).toBe('inline');
  });
});

describe('ControlBar + RegisterPanel', () => {
  it('stepping executes real instructions and the register panel shows the result', async () => {
    await loadFirstProgram();
    const bar = mountC(ControlBar);
    const regs = mountC(RegisterPanel);
    await nextTick();
    expect(bar.get('[data-testid=pc]').text()).toBe('0100');
    expect(bar.get('[data-testid=machine-status]').text()).toBe('Paused');

    // MOV R0,#0 ; MOV R1,#10 ; ADD R0,R1
    for (let i = 0; i < 3; i++) {
      const before = useStore().view.value!.instructions;
      await bar.get('[data-testid=step]').trigger('click');
      await until((v) => v.instructions === before + 1);
    }
    await nextTick();
    expect(regs.get('[data-testid=reg-R0]').text()).toBe('0A');
    expect(regs.get('[data-testid=reg-R1]').text()).toBe('0A');
    expect(useStore().view.value!.cpu.r[0]).toBe(10);
    expect(bar.get('[data-testid=pc]').text()).toBe(
      useStore().view.value!.cpu.pc.toString(16).toUpperCase().padStart(4, '0'),
    );
  });

  it('micro-step advances exactly one clock cycle', async () => {
    await loadFirstProgram();
    const bar = mountC(ControlBar);
    const c0 = useStore().view.value!.cycle;
    await bar.get('[data-testid=micro-step]').trigger('click');
    const v = await until((x) => x.cycle !== c0);
    expect(v.cycle).toBe(c0 + 1);
    expect(v.cpu.lastOp).not.toBeNull();
  });

  it('run to completion halts with the computed sum in R0 and on the LEDs', async () => {
    await loadFirstProgram();
    const bar = mountC(ControlBar);
    await bar.get('[data-testid=run-pause]').trigger('click');
    const v = await until((x) => x.runState === 'paused' && x.stop?.reason === 'halted');
    expect(v.cpu.r[0]).toBe(55);
    expect(v.devices.gpio.leds).toBe(55);
    expect(v.memory[0x2000]).toBe(55);
    expect(v.devices.terminal.lines.join('\n') + v.devices.terminal.current).toContain('1 + 2 + ... + 10 = 0x37');
    await nextTick();
    expect(bar.get('[data-testid=machine-status]').text()).toBe('Halted');
  });

  it('a breakpoint stops a run at the requested address', async () => {
    await loadFirstProgram();
    const s = useStore();
    const done = s.symbol('done')!;
    expect(done).toBeGreaterThan(0x100);
    s.toggleBreakpoint(done);
    await flushPromises();
    s.send({ type: 'run' });
    const v = await until((x) => x.runState === 'paused' && x.stop?.reason === 'breakpoint');
    expect(v.cpu.pc).toBe(done);
    expect(v.cpu.r[0]).toBe(55);
  });
});

describe('TerminalPanel', () => {
  it('sends typed characters (including capital F) to the keyboard device, and Escape leaves the terminal', async () => {
    await loadFirstProgram();
    const s = useStore();
    const sent: unknown[] = [];
    const orig = s.send;
    const spy = vi.spyOn(s.client, 'send').mockImplementation((c) => {
      sent.push(c);
    });
    const w = mountC(TerminalPanel);
    const screen = w.get('[data-testid=terminal]');
    (screen.element as HTMLElement).focus();
    await screen.trigger('keydown', { key: 'F' });
    await screen.trigger('keydown', { key: 'F5' });
    await screen.trigger('keydown', { key: 'Tab' });
    expect(sent).toEqual([{ type: 'injectKeys', bytes: [0x46] }]);
    await screen.trigger('keydown', { key: 'Escape' });
    expect(document.activeElement).not.toBe(screen.element);
    spy.mockRestore();
    expect(s.send).toBe(orig);
  });
});

describe('EditorLab', () => {
  it('reports assembler diagnostics without touching the loaded machine', async () => {
    await loadFirstProgram();
    const s = useStore();
    const w = mountC(EditorLab);
    const file = 'examples/first-program.asm';
    const original = s.project.files[file]!;
    s.project.files[file] = original.replace('DEC R1', 'DEC R9');
    await w.get('[data-testid=assemble]').trigger('click');
    await nextTick();
    expect(w.get('[data-testid=build-status]').classes()).toContain('err');
    const diags = w.findAll('[data-testid=diagnostic]');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0]!.text()).toMatch(/R9|register/i);
    // The machine still holds the previous, valid program.
    expect(s.view.value!.label).toContain('first-program');
    expect(s.buildStale.value).toBe(true);

    s.project.files[file] = original;
    await w.get('[data-testid=assemble]').trigger('click');
    await nextTick();
    expect(w.get('[data-testid=build-status]').classes()).toContain('ok');
  });
});

describe('MemoryLab', () => {
  it('jumps to a label and adds a watchpoint that the machine honours', async () => {
    await loadFirstProgram();
    const s = useStore();
    const w = mountC(MemoryLab);
    await w.get('[data-testid=mem-goto]').setValue('message');
    await w.get('form').trigger('submit');
    await nextTick();
    const msg = s.symbol('message')!;
    const cell = w.find(`[data-addr="${msg}"]`);
    expect(cell.exists()).toBe(true);
    await cell.trigger('click');
    await nextTick();
    expect(w.text()).toContain('message');

    // Watch writes to the result variable at 0x2000.
    s.debug.watchpoints.push([0x2000, 'w']);
    await flushPromises();
    s.send({ type: 'run' });
    const v = await until((x) => x.runState === 'paused' && x.stop?.reason === 'watchpoint');
    expect(v.lastWatchHit?.addr).toBe(0x2000);
    expect(v.lastWatchHit?.value).toBe(55);
  });
});

describe('DatapathLab', () => {
  it('highlights only the units used by the executed micro-operation', async () => {
    await loadFirstProgram();
    const w = mountC(DatapathLab);
    await w.get('button.primary').trigger('click');
    const v = await until((x) => x.cpu.lastOp !== null);
    await nextTick();
    const active = w.findAll('[data-active=true]').map((e) => e.attributes('data-testid'));
    expect(active.length).toBeGreaterThan(0);
    // The first micro-op of an instruction is an opcode fetch: it uses the bus.
    expect(v.cpu.lastOp!.units).toContain('ADDRESS_BUS');
    expect(w.find('[data-testid=dp-address-bus]').text()).toContain('0100');
  });
});

describe('ReferenceLab', () => {
  it('filters the instruction table and shows micro-programs', async () => {
    const w = mountC(ReferenceLab);
    await w.get('[data-testid=isa-search]').setValue('ADD');
    const rows = w.findAll('tbody tr.clickable');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(80);
    await rows[0]!.trigger('click');
    expect(w.get('[data-testid=isa-detail]').text()).toMatch(/Micro-program \(\d+ cycles\)/);
    await w.get('[data-testid=ref-arch]').trigger('click');
    expect(w.find('.doc h1').exists()).toBe(true);
    // A link to another bundled document switches tabs instead of leaving the app.
    await w.get('[data-testid=ref-limits]').trigger('click');
    const link = w.findAll('.doc a').find((x) => x.attributes('data-href') === 'spec/architecture.md')!;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.element.dispatchEvent(ev);
    await nextTick();
    expect(ev.defaultPrevented).toBe(true);
    expect(w.get('[data-testid=ref-arch]').attributes('aria-selected')).toBe('true');
  });
});

describe('ExamplesLab', () => {
  it('runs an example and reports its checks as passed', async () => {
    const w = mountC(ExamplesLab);
    await w.get('[data-testid=check-first-program]').trigger('click');
    const t0 = Date.now();
    while (!w.find('[data-testid=result-first-program]').exists()) {
      if (Date.now() - t0 > 10000) throw new Error('no result');
      await flushPromises();
      await new Promise((r) => setTimeout(r, 20));
    }
    const res = w.get('[data-testid=result-first-program]').text();
    expect(res).toMatch(/pass/i);
    expect(res).not.toMatch(/fail/i);
  });
});

describe('App shell', () => {
  it('navigates between labs and builds the default program on mount', async () => {
    const w = mountC(App);
    await until((v) => v.loaded);
    await w.get('[data-testid=nav-reference]').trigger('click');
    expect(w.find('[data-testid=isa-search]').exists()).toBe(true);
    await w.get('[data-testid=nav-memory]').trigger('click');
    expect(w.find('[data-testid=mem-goto]').exists()).toBe(true);
  });

  it('F10 steps one instruction', async () => {
    mountC(App);
    const v0 = await until((v) => v.loaded);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10' }));
    // The first step finishes the power-on reset sequence and loads PC from the vector.
    const v1 = await until((v) => v.cycle > v0.cycle);
    expect(v0.cpu.pc).toBe(0);
    expect(v1.cpu.pc).toBe(0x0100);
  });
});
