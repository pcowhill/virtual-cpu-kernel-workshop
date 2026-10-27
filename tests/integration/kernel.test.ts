/**
 * Kernel integration: system calls, interrupts, preemptive scheduling, process
 * isolation and drivers — all performed by the assembled kernel running on the
 * virtual CPU. These tests only observe; the kernel does the work.
 */
import { describe, expect, it } from 'vitest';
import { CAUSE, MEM, VECTOR } from '../../src/core/isa/constants';
import { Machine } from '../../src/core/machine/machine';
import { kernelLayout, readProcessTable, SchedulingTimeline } from '../../src/core/os/awareness';
import { boot, prog, runToHalt } from './os-helpers';

/** Raw terminal output (the screen wraps long lines at 80 columns; the transcript does not). */
function out(m: Machine): string {
  return m.terminal.transcript;
}

function processes(m: Machine, symbols: Record<string, number>) {
  return readProcessTable((a) => m.bus.peek(a), kernelLayout(symbols)!);
}

describe('kernel initialisation', () => {
  it('installs vectors, loads programs into their slots with its own driver, and starts them', () => {
    const { m, b } = boot([prog('hello'), prog('alpha')]);
    const writes: number[] = []; // PCs of instructions storing into user RAM before the first RTI
    let firstRti = -1;
    m.bus.observer = (addr, kind) => {
      if (kind === 'write' && addr >= MEM.URAM_START && addr <= MEM.URAM_END && firstRti < 0)
        writes.push(m.cpu.instrStart);
    };
    m.eventListeners.push((e) => {
      if (e.type === 'rti' && firstRti < 0) firstRti = e.cycle;
    });
    m.run(3_000_000, Infinity);
    expect(m.cpu.vbase).toBe(b.kernelSymbols['kvectors']);
    // All user-RAM writes before the first process ran were made by kernel code (its storage driver).
    expect(writes.length).toBeGreaterThan(0);
    for (const pc of writes) {
      expect(pc).toBeGreaterThanOrEqual(0x2000);
      expect(pc).toBeLessThan(0x5000);
    }
    const text = out(m);
    expect(text).toContain('VC-8 Workshop Kernel v1.0');
    expect(text).toContain("[kernel] pid 1 'hello' loaded, window 0x6000-0x7FFF, entry 0x6000");
    expect(text).toContain("[kernel] pid 2 'alpha' loaded, window 0x8000-0x9FFF, entry 0x8000");
    expect(text).toContain('starting round-robin scheduler');
  });

  it('places each program image exactly at its slot', () => {
    const { m, b } = boot([prog('hello'), prog('digits')]);
    m.breakpoints.add(b.kernelSymbols['schedule']!);
    expect(m.run(3_000_000).reason).toBe('breakpoint');
    for (const p of b.programs) {
      const seg = p.result.segments[0]!;
      expect(Array.from(m.bus.mem.subarray(seg.address, seg.address + seg.bytes.length))).toEqual(
        Array.from(seg.bytes),
      );
    }
    const ps = processes(m, b.kernelSymbols);
    expect(ps.map((p) => [p.pid, p.name, p.state, p.base, p.limit])).toEqual([
      [1, 'hello', 'ready', 0x6000, 0x8000],
      [2, 'digits', 'ready', 0x8000, 0xa000],
    ]);
    // Initial frames: user mode, interrupts enabled, PC = entry, USP = top of slot.
    expect(ps[0]!.frame).toMatchObject({ pc: 0x6000, psw: 0x40, usp: 0x8000, regs: [0, 0, 0, 0, 0, 0, 0, 0] });
  });
});

describe('system calls', () => {
  it('a user program traps into the kernel and resumes after SYS', () => {
    const { m } = boot([prog('hello')]);
    const res = runToHalt(m);
    expect(res.reason).toBe('halted');
    expect(out(m)).toContain('Hello from user mode! I am pid 1\n');
    expect(out(m)).toContain("[kernel] pid 1 'hello' exited with code 0");
    expect(out(m)).toContain('all processes have finished; system halted.');
    const ev = m.events.toArray();
    const sys = ev.filter((e) => e.type === 'exception' && e.vector === VECTOR.SYSCALL);
    expect(sys.map((e) => e.r0)).toEqual([2, 6, 1, 1, 0]); // puts, getpid, putc, putc, exit
    for (const e of sys) expect(e.fromUser).toBe(true);
    // Each syscall that returns resumes in user mode at the instruction after SYS.
    for (const e of sys.slice(0, 4)) {
      const back = ev.find((x) => x.type === 'rti' && x.cycle > e.cycle)!;
      expect(back.toUser).toBe(true);
      expect(back.pc).toBe(e.fromPc);
    }
  });

  it('rejects unknown calls and bad pointers', () => {
    const { m } = boot([prog('badcall')]);
    runToHalt(m);
    expect(out(m)).toContain('[badcall] kernel rejected both bad calls');
    expect(out(m)).toContain("'badcall' exited with code 0");
  });

  it('reads a storage block through the kernel driver', () => {
    const { m } = boot([prog('reader')]);
    runToHalt(m);
    expect(out(m)).toContain('Hello from block storage! This text was read from block 128');
    expect(out(m)).toContain("'reader' exited with code 0");
  });

  it('drives the LEDs and sleeps on timer ticks', () => {
    const { m, b } = boot([prog('blinker')]);
    const patterns: number[] = [];
    m.bus.observer = (addr, kind, value) => {
      if (kind === 'write' && addr === 0xf050) {
        // The LED register is written by kernel code on behalf of the program.
        expect(m.cpu.supervisor).toBe(true);
        patterns.push(value);
      }
    };
    let sawSleeping = false;
    const layout = kernelLayout(b.kernelSymbols)!;
    m.eventListeners.push((e) => {
      if (e.type === 'halt') {
        const p = readProcessTable((a) => m.bus.peek(a), layout)[0];
        if (p?.state === 'blocked' && p.wait === 'sleep') sawSleeping = true;
      }
    });
    runToHalt(m);
    expect(patterns.slice(0, 9)).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 1]);
    expect(patterns.at(-1)).toBe(0);
    expect(sawSleeping).toBe(true);
    expect(out(m)).toContain("'blinker' exited with code 0");
  });
});

describe('preemptive multitasking', () => {
  it('two compute-bound programs with no system calls in their loops both make progress', () => {
    const { m, b } = boot([prog('spinner'), prog('spinner')]);
    const counter = b.programs[0]!.result.symbols.find((s) => s.name === 'counter')!.value;
    const counterB = b.programs[1]!.result.symbols.find((s) => s.name === 'counter')!.value;
    m.breakpoints.add(b.kernelSymbols['schedule']!);
    m.run(3_000_000); // boot until the scheduler first runs
    m.breakpoints.clear();
    const samples: [number, number][] = [];
    for (let i = 0; i < 40; i++) {
      m.run(1500);
      samples.push([m.bus.peekWord(counter), m.bus.peekWord(counterB)]);
    }
    // Both counters advanced while the other process still had work to do.
    const mid = samples.find(([a, c]) => a > 0 && c > 0 && a < 0x800 && c < 0x800);
    expect(mid).toBeDefined();
    // Switches happened only through timer interrupts taken in user mode.
    const timer = m.events.toArray().filter((e) => e.type === 'exception' && e.vector === VECTOR.IRQ_BASE);
    expect(timer.length).toBeGreaterThan(5);
    expect(timer.every((e) => e.fromUser)).toBe(true);
    const syscalls = m.events.toArray().filter((e) => e.type === 'exception' && e.vector === VECTOR.SYSCALL);
    expect(syscalls).toHaveLength(0); // nobody yielded or called the kernel yet
    const rtis = m.events.toArray().filter((e) => e.type === 'rti');
    expect(new Set(rtis.map((e) => e.ubase))).toEqual(new Set([0x6000, 0x8000]));
    runToHalt(m);
    expect(out(m)).toContain("pid 1 'spinner' exited with code 0");
    expect(out(m)).toContain("pid 2 'spinner' exited with code 0");
  });

  it('the kernel preserves every register and the stack across context switches', () => {
    const { m } = boot([prog('regcheck'), prog('regcheck'), prog('spinner'), prog('regcheck')]);
    const switches: number[] = [];
    m.eventListeners.push((e) => {
      if (e.type === 'rti' && e.toUser) switches.push(e.ubase!);
    });
    runToHalt(m, 20_000_000);
    const text = out(m);
    expect(text).toContain("pid 1 'regcheck' exited with code 0");
    expect(text).toContain("pid 2 'regcheck' exited with code 0");
    expect(text).toContain("pid 4 'regcheck' exited with code 0");
    // Many preemptions actually happened between different processes.
    let changes = 0;
    for (let i = 1; i < switches.length; i++) if (switches[i] !== switches[i - 1]) changes++;
    expect(changes).toBeGreaterThan(30);
  });

  it('output of two printing processes interleaves (time slicing)', () => {
    const { m } = boot([prog('alpha'), prog('digits')]);
    runToHalt(m);
    const text = out(m);
    const body = text.slice(text.indexOf('scheduler\n\n') + 11).replace(/\[kernel\][^\n]*\n/g, '');
    // Letters and digits alternate in runs rather than one finishing first.
    const firstDigit = body.search(/[0-9]/);
    const lastLetter = Math.max(...[...'abcdefghijklmnopqrstuvwxyz'].map((c) => body.lastIndexOf(c)));
    expect(firstDigit).toBeLessThan(lastLetter);
    expect(body.replace(/[^a-z]/g, '')).toBe('abcdefghijklmnopqrstuvwxyz'.repeat(2));
    expect(body.replace(/[^0-9]/g, '').startsWith('0123456789'.repeat(4))).toBe(true);
  });

  it('the scheduling timeline reconstructs alternating user segments', () => {
    const { m, b } = boot([prog('spinner'), prog('spinner')]);
    const tl = new SchedulingTimeline((a) => m.bus.peek(a), kernelLayout(b.kernelSymbols)!);
    m.eventListeners.push((e) => tl.onEvent(e));
    runToHalt(m);
    const user = tl.segments.filter((s) => s.kind === 'user');
    expect(user.length).toBeGreaterThan(10);
    let alternations = 0;
    for (let i = 1; i < user.length; i++) if (user[i]!.index !== user[i - 1]!.index) alternations++;
    expect(alternations).toBeGreaterThan(5);
    expect(tl.markers.some((k) => k.kind === 'timer')).toBe(true);
    expect(tl.markers.some((k) => k.kind === 'switch')).toBe(true);
    expect(tl.markers.filter((k) => k.kind === 'exit')).toHaveLength(2);
    // Segments are well-formed and non-overlapping.
    for (let i = 1; i < tl.segments.length; i++)
      expect(tl.segments[i]!.start).toBeGreaterThanOrEqual(tl.segments[i - 1]!.end);
  });
});

describe('protection and faults', () => {
  it('a process writing into another process is killed; the other keeps running', () => {
    const { m } = boot([prog('intruder'), prog('digits')]);
    runToHalt(m);
    const text = out(m);
    expect(text).toContain("[kernel] pid 1 'intruder' killed: write protection violation at PC=0x600B, address 0x8000");
    expect(text).not.toContain('the write succeeded');
    expect(text).toContain("pid 2 'digits' exited with code 0");
    expect(m.bus.peek(0x8000)).not.toBe(0x66);
  });

  it('reading kernel memory is a read violation', () => {
    const { m, b } = boot([prog('kspy')]);
    runToHalt(m);
    expect(out(m)).toContain("pid 1 'kspy' killed: read protection violation at PC=0x6000, address 0x5040");
    const p = processes(m, b.kernelSymbols)[0]!;
    expect(p).toMatchObject({ state: 'exited', exitCode: 0xff, faultCause: CAUSE.READ_VIOLATION });
  });

  it('a privileged instruction in user mode is a privilege fault', () => {
    const { m } = boot([prog('privileged')]);
    runToHalt(m);
    expect(out(m)).toContain('killed: privileged instruction in user mode at PC=0x6004');
    expect(m.cpu.ulimit).not.toBe(0xf000);
  });
});

describe('keyboard input and blocking', () => {
  it('a blocked reader uses no CPU and is woken by the keyboard interrupt', () => {
    const { m, b } = boot([prog('echo')]);
    m.run(1_000_000);
    const ps = processes(m, b.kernelSymbols);
    expect(ps[0]).toMatchObject({ name: 'echo', state: 'blocked', wait: 'keyboard' });
    // The kernel idles in HLT with the timer stopped (nobody sleeps): no CPU is used.
    expect(m.cpu.status).toBe('waiting');
    expect(m.timer.ctrl & 1).toBe(0);
    const idleBefore = m.modeCycles.idle;
    m.run(100_000);
    expect(m.modeCycles.idle - idleBefore).toBe(100_000);
    for (const ch of 'hi\r') m.injectKey(ch.charCodeAt(0));
    m.run(200_000);
    expect(out(m)).toContain('HI\r\n'); // the echoed Enter (CR) followed by LF
    const kbd = m.events.toArray().filter((e) => e.type === 'exception' && e.vector === VECTOR.IRQ_BASE + 1);
    const wakes = m.events.toArray().filter((e) => e.type === 'wake');
    expect(kbd.length + wakes.length).toBeGreaterThan(0);
    m.injectKey('~'.charCodeAt(0));
    runToHalt(m);
    expect(out(m)).toContain('[echo] bye');
    expect(out(m)).toContain("'echo' exited with code 0");
  });

  it('keys typed while a program computes are delivered by interrupt into the kernel buffer', () => {
    const { m, b } = boot([prog('echo'), prog('spinner')]);
    m.run(200_000);
    m.injectKey('x'.charCodeAt(0));
    m.run(200_000);
    expect(out(m)).toContain('X');
    expect(m.events.toArray().some((e) => e.type === 'exception' && e.vector === 9 && e.fromUser)).toBe(true);
    expect(processes(m, b.kernelSymbols)[0]!.state).not.toBe('exited');
  });
});

describe('determinism of the whole system', () => {
  it('two runs of the full OS are identical, and snapshot/restore reproduces the future', () => {
    const run = () => {
      const { m } = boot([prog('alpha'), prog('digits'), prog('echo'), prog('blinker')]);
      m.run(300_000);
      m.injectKey(0x61);
      return m;
    };
    const a = run();
    const b = run();
    const snap = JSON.stringify(a.snapshot());
    expect(JSON.stringify(b.snapshot())).toBe(snap);
    a.run(500_000);
    const n = new Machine();
    n.restore(JSON.parse(snap));
    n.run(500_000);
    expect(JSON.stringify(n.snapshot())).toBe(JSON.stringify(a.snapshot()));
    expect(n.terminal.text()).toBe(a.terminal.text());
  });
});
