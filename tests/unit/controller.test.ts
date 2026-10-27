/** The machine host: command handling, speed-independent execution, views. */
import { describe, expect, it } from 'vitest';
import { MachineController } from '../../src/host/controller';
import { HostLoop } from '../../src/host/loop';
import { buildProject, defaultProject } from '../../src/app/project';
import type { FromHost, LoadRequest } from '../../src/host/protocol';

function load(file = 'examples/first-program.asm'): LoadRequest {
  const p = defaultProject();
  p.bareMain = file;
  const b = buildProject(p);
  if (!b.ok) throw new Error(JSON.stringify(b.diagnostics));
  return b.load!;
}

function osLoad(): LoadRequest {
  const p = defaultProject();
  p.mode = 'os';
  p.os.programs = [
    { name: 'spinner', path: 'programs/spinner.asm' },
    { name: 'spinner', path: 'programs/spinner.asm' },
  ];
  return buildProject(p).load!;
}

describe('MachineController', () => {
  it('loads, steps and reports a consistent view', () => {
    const c = new MachineController();
    c.handle({ type: 'load', request: load() }, 0);
    expect(c.view().loaded).toBe(true);
    c.handle({ type: 'stepInstruction' }, 0); // reset sequence
    c.handle({ type: 'stepInstruction' }, 0); // MOV R0, #0
    const v = c.view();
    expect(v.cpu.pc).toBe(0x103);
    expect(v.trace.at(-1)?.kind).toBe('instruction');
    expect(v.cpu.sequence?.ops[0]?.name).toBe('FETCH');
  });

  it('runs exactly speed × elapsed time cycles per slice', () => {
    const c = new MachineController();
    c.handle({ type: 'load', request: load() }, 0);
    c.handle({ type: 'setSpeed', speed: 1000 }, 0);
    c.handle({ type: 'run' }, 0);
    c.tick(50);
    expect(c.machine.cycle).toBe(50);
    c.tick(75);
    expect(c.machine.cycle).toBe(75);
    c.handle({ type: 'pause' }, 75);
    c.tick(500);
    expect(c.machine.cycle).toBe(75);
    expect(c.view().stop?.reason).toBe('user');
  });

  it('execution speed never changes the result', () => {
    const run = (speed: number | 'max', step: number) => {
      const c = new MachineController();
      c.handle({ type: 'load', request: osLoad() }, 0);
      c.handle({ type: 'setSpeed', speed }, 0);
      c.handle({ type: 'run' }, 0);
      let t = 0;
      let n = 0;
      while (c.runState === 'running' && n++ < 100_000) c.tick((t += step), () => t);
      return c.machine.snapshot();
    };
    const fast = run('max', 20);
    const slow = run(2_000_000, 7);
    expect(fast.cpu.status).toBe('waiting');
    expect(JSON.stringify(slow)).toBe(JSON.stringify(fast));
  });

  it('stops at breakpoints, and stop returns to the power-on state', () => {
    const c = new MachineController();
    const req = load();
    c.handle({ type: 'load', request: req }, 0);
    c.handle({ type: 'setBreakpoints', addresses: [req.symbols['loop']!] }, 0);
    c.handle({ type: 'setSpeed', speed: 'max' }, 0);
    c.handle({ type: 'run' }, 0);
    c.tick(10, () => 10);
    expect(c.view().stop?.reason).toBe('breakpoint');
    expect(c.machine.cpu.pc).toBe(req.symbols['loop']);
    c.handle({ type: 'stop' }, 0);
    expect(c.machine.cycle).toBe(0);
    expect(c.runState).toBe('paused');
  });

  it('debugger edits and snapshots', () => {
    const c = new MachineController();
    c.handle({ type: 'load', request: load() }, 0);
    c.handle({ type: 'poke', address: 0x2000, value: 0x42 }, 0);
    c.handle({ type: 'setRegister', name: 'R3', value: 0x99 }, 0);
    const snap = c.request({ type: 'snapshot' }) as ReturnType<typeof c.machine.snapshot>;
    c.handle({ type: 'poke', address: 0x2000, value: 0 }, 0);
    c.handle({ type: 'restore', snapshot: snap }, 0);
    expect(c.machine.bus.peek(0x2000)).toBe(0x42);
    expect(c.machine.cpu.r[3]).toBe(0x99);
  });

  it('the view shows device registers in the memory image (without side effects)', () => {
    const c = new MachineController();
    c.handle({ type: 'load', request: load() }, 0);
    c.handle({ type: 'injectKeys', bytes: [0x41] }, 0);
    const v = c.view();
    expect(v.memory[0xf000]).toBe(0x56); // SYS_ID 'V'
    expect(v.memory[0xf040]).toBe(0x41); // keyboard DATA (peeked)
    expect(c.machine.keyboard.queue).toEqual([0x41]);
  });

  it('OS-aware views decode the process table and timeline', () => {
    const c = new MachineController();
    c.handle({ type: 'load', request: osLoad() }, 0);
    c.request({ type: 'runDeterministic', cycles: 400_000 });
    const v = c.view();
    expect(v.os?.processes.map((p) => p.name)).toEqual(['spinner', 'spinner']);
    expect(v.os?.segments.some((s) => s.kind === 'user')).toBe(true);
    expect(v.os?.markers.some((m) => m.kind === 'timer')).toBe(true);
  });
});

describe('HostLoop', () => {
  it('publishes a view after every command and answers requests after the view', () => {
    const msgs: FromHost[] = [];
    const loop = new HostLoop(
      (m) => msgs.push(m),
      () => 0,
    );
    loop.receive({ kind: 'command', command: { type: 'load', request: load() } });
    expect(msgs.at(-1)?.kind).toBe('view');
    loop.receive({ kind: 'request', id: 7, request: { type: 'runDeterministic', cycles: 100 } });
    expect(msgs.at(-2)?.kind).toBe('view');
    expect(msgs.at(-1)).toMatchObject({ kind: 'response', id: 7, ok: true });
    loop.receive({ kind: 'command', command: { type: 'setRegister', name: 'NOPE', value: 1 } });
    expect(msgs.some((m) => m.kind === 'error')).toBe(true);
    loop.dispose();
  });
});
