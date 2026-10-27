/** Determinism, snapshots, pause/resume equivalence, breakpoints and watchpoints. */
import { describe, expect, it } from 'vitest';
import { Machine } from '../../src/core/machine/machine';
import { bareMachine, sym } from '../helpers';

const PROGRAM = `
      MOVP SP, #0x3000
      MOVP P1, #vectors
      MTC VBASE, P1
      MOV R0, #100
      ST [0xF022], R0
      MOV R0, #0
      ST [0xF023], R0
      MOV R0, #0x07
      ST [0xF020], R0       ; periodic timer, 100 cycles
      MOV R0, #0x03
      ST [0xF011], R0       ; timer + keyboard lines
      MOV R0, #1
      ST [0xF042], R0       ; keyboard IE
      MOVP P2, #0x2100
      STI
main: INC R3
      ST [0xF050], R3
      JMP main
timer:
      PUSH R0
      MOV R0, #1
      ST [0xF021], R0
      INC R6
      POP R0
      RTI
kbd:  PUSH R0
      LD R0, [0xF040]
      ST [P2], R0
      INCP P2
      POP R0
      RTI
vectors: .word 0, 0, 0, 0, 0, 0, 0, 0, timer, kbd
`;

function fingerprint(m: Machine) {
  const s = m.snapshot();
  return JSON.stringify({ ...s, inputLog: undefined });
}

describe('determinism', () => {
  it('identical runs produce identical states and traces', () => {
    const a = bareMachine(PROGRAM).m;
    const b = bareMachine(PROGRAM).m;
    a.run(20000);
    b.run(20000);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(a.trace.toArray()).toEqual(b.trace.toArray());
    expect(a.events.toArray()).toEqual(b.events.toArray());
  });

  it('pause/resume in arbitrary slices equals one continuous run', () => {
    const a = bareMachine(PROGRAM).m;
    const b = bareMachine(PROGRAM).m;
    a.run(30000);
    let done = 0;
    const slices = [1, 7, 333, 1, 2000, 13, 5000];
    let i = 0;
    while (done < 30000) {
      const n = Math.min(slices[i++ % slices.length]!, 30000 - done);
      done += b.run(n).cycles;
    }
    expect(fingerprint(b)).toBe(fingerprint(a));
  });

  it('host execution speed (slice size) does not change outcomes with inputs at the same cycles', () => {
    const run = (slice: number) => {
      const { m } = bareMachine(PROGRAM);
      const inputs = new Map([
        [5000, 0x41],
        [12000, 0x42],
        [12001, 0x43],
      ]);
      while (m.cycle < 20000) {
        const next = [...inputs.keys()].filter((c) => c > m.cycle - 0).sort((x, y) => x - y)[0];
        const limit = Math.min(slice, (next ?? Infinity) - m.cycle, 20000 - m.cycle);
        if (limit > 0) m.run(limit);
        const key = inputs.get(m.cycle);
        if (key !== undefined) {
          m.injectKey(key);
          inputs.delete(m.cycle);
        }
      }
      return m;
    };
    const slow = run(3);
    const fast = run(10000);
    expect(fingerprint(slow)).toBe(fingerprint(fast));
    expect(Array.from(slow.bus.mem.slice(0x2100, 0x2103))).toEqual([0x41, 0x42, 0x43]);
  });

  it('snapshot/restore reproduces the same future exactly, including mid-instruction', () => {
    const { m } = bareMachine(PROGRAM);
    m.run(7777);
    // Stop in the middle of an instruction.
    m.microStep();
    m.microStep();
    const snap = m.snapshot();
    const json = JSON.parse(JSON.stringify(snap));
    m.run(10000);
    const expected = fingerprint(m);
    const n = new Machine();
    n.restore(json);
    n.run(10000);
    expect(fingerprint(n)).toBe(expected);
    // Restoring into the same machine works too.
    m.restore(json);
    m.run(10000);
    expect(fingerprint(m)).toBe(expected);
  });

  it('repeated interrupt sequences are reproducible', () => {
    const a = bareMachine(PROGRAM).m;
    a.run(50000);
    const irqCycles = a.events
      .toArray()
      .filter((e) => e.type === 'exception')
      .map((e) => e.cycle);
    expect(irqCycles.length).toBeGreaterThan(100);
    const b = bareMachine(PROGRAM).m;
    b.run(50000);
    expect(
      b.events
        .toArray()
        .filter((e) => e.type === 'exception')
        .map((e) => e.cycle),
    ).toEqual(irqCycles);
  });

  it('rejects incompatible snapshots', () => {
    const m = new Machine();
    expect(() => m.restore({ format: 'nope' } as never)).toThrow(/incompatible/);
  });
});

describe('breakpoints and watchpoints', () => {
  it('stops before the breakpoint instruction and resumes past it', () => {
    const { m, r } = bareMachine(`
      MOV R0, #0
loop: INC R0
      CMP R0, #5
      JNE loop
done: HLT`);
    m.breakpoints.add(sym(r, 'loop'));
    let res = m.run(10000);
    expect(res.reason).toBe('breakpoint');
    expect(m.cpu.pc).toBe(sym(r, 'loop'));
    expect(m.cpu.r[0]).toBe(0);
    res = m.run(10000);
    expect(res.reason).toBe('breakpoint');
    expect(m.cpu.r[0]).toBe(1);
    m.breakpoints.clear();
    m.breakpoints.add(sym(r, 'done'));
    res = m.run(10000);
    expect(res.reason).toBe('breakpoint');
    expect(m.cpu.r[0]).toBe(5);
  });

  it('write watchpoints stop after the writing instruction', () => {
    const { m, r } = bareMachine(`
      MOV R0, #1
      LD R1, [0x2000]
store: ST [0x2000], R0
      NOP
      HLT`);
    m.watchpoints.set(0x2000, 'w');
    const res = m.run(1000);
    expect(res.reason).toBe('watchpoint');
    expect(m.lastWatchHit).toMatchObject({ addr: 0x2000, kind: 'write', value: 1, pc: sym(r, 'store') });
    expect(m.cpu.pc).toBe(sym(r, 'store') + 4);
  });

  it('read watchpoints', () => {
    const { m } = bareMachine('LD R1, [0x2000]\nHLT');
    m.watchpoints.set(0x2000, 'r');
    expect(m.run(1000).reason).toBe('watchpoint');
  });

  it('break-on-fault pauses before the exception is entered', () => {
    const { m } = bareMachine('ST [0x0010], R0\nHLT');
    const res = m.run(1000);
    expect(res.reason).toBe('exception');
    expect(res.detail).toMatch(/write to ROM/);
    expect(m.cpu.exception).not.toBeNull();
  });

  it('trace records register and memory changes with bounded retention', () => {
    const { m } = bareMachine('MOV R0, #7\nST [0x2000], R0\nloop: JMP loop');
    m.trace.resize(10);
    m.run(5000);
    expect(m.trace.length).toBe(10);
    const { m: m2 } = bareMachine('MOV R0, #7\nST [0x2000], R0\nHLT');
    m2.run(100);
    const t = m2.trace.toArray();
    expect(t[0]!.kind).toBe('reset');
    expect(t[1]!.regs).toEqual([{ name: 'R0', old: 0, new: 7 }]);
    expect(t[2]!.mem).toEqual([{ addr: 0x2000, old: 0, new: 7 }]);
    expect(t[2]!.bytes).toEqual([0x14, 0x00, 0x00, 0x20]);
  });
});
