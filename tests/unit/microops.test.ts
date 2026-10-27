/**
 * Micro-operation model: intermediate states are real, and instruction-level
 * execution (stepInstruction / run) produces exactly the same architectural
 * results as micro-stepping.
 */
import { describe, expect, it } from 'vitest';
import { Machine } from '../../src/core/machine/machine';
import { INSTRUCTION_PROGRAMS } from '../../src/core/cpu/microcode';
import { INSTRUCTIONS } from '../../src/core/isa/opcodes';
import { bareMachine } from '../helpers';

function architecturalState(m: Machine) {
  const s = m.snapshot();
  // latches are micro-architectural; compare architectural state + memory + devices + cycle
  const { latches: _l, ...cpu } = s.cpu;
  return { ...s, cpu };
}

const PROGRAM = `
      MOVP SP, #0x3000
      MOVP P2, #0x2000
      MOV R0, #10
loop: ST [P2], R0
      INCP P2
      PUSH R0
      CALL double
      POP R6
      ST [P2+0x20], R3
      DEC R0
      JNE loop
      LDW P1, [0x2000]
      CMPP P1, #0x090A
      HLT
double:
      LD R3, [SP+2]
      ADD R3, R3
      PUSHP P2
      ADDP P2, R3
      SUBP P2, P3
      POPP P2
      RET
`;

describe('micro-operation equivalence', () => {
  it('instruction stepping equals micro-stepping, at every instruction boundary', () => {
    const a = bareMachine(PROGRAM).m;
    const b = bareMachine(PROGRAM).m;
    for (let i = 0; i < 200; i++) {
      a.stepInstruction();
      let r: string;
      do r = b.microStep();
      while (r === 'cycle');
      expect(architecturalState(b)).toEqual(architecturalState(a));
      if (a.cpu.status !== 'running') break;
    }
    expect(a.cpu.status).toBe('waiting');
  });

  it('run() equals micro-stepping for the same number of cycles', () => {
    const a = bareMachine(PROGRAM).m;
    const b = bareMachine(PROGRAM).m;
    const res = a.run(5000);
    expect(res.reason).toBe('halted');
    for (let i = 0; i < res.cycles; i++) b.microStep();
    expect(architecturalState(b)).toEqual(architecturalState(a));
  });

  it('every instruction micro-program starts with FETCH and DECODE and is at least 2 cycles', () => {
    for (const d of INSTRUCTIONS) {
      const p = INSTRUCTION_PROGRAMS[d.opcode]!;
      expect(p.ops[0]!.name).toBe('FETCH');
      expect(p.ops[1]!.name).toBe('DECODE');
    }
  });
});

describe('micro-operation intermediate states (ADD R0, R1)', () => {
  it('each micro-op performs only its own register transfer', () => {
    const { m } = bareMachine('MOV R0, #0x7F\nMOV R1, #1\nADD R0, R1\nHLT');
    m.stepInstruction(); // reset
    m.stepInstruction();
    m.stepInstruction();
    const cpu = m.cpu;
    const pc0 = cpu.pc;
    const psw0 = cpu.psw;
    const seen: string[] = [];

    m.microStep(); // FETCH
    seen.push(cpu.activity.op!.name);
    expect(cpu.ir).toBe(0x30);
    expect(cpu.pc).toBe(pc0 + 1);
    expect(cpu.activity.bus).toEqual({ addr: pc0, data: 0x30, op: 'fetch' });
    expect(cpu.r[0]).toBe(0x7f);

    m.microStep(); // DECODE
    seen.push(cpu.activity.op!.name);
    expect(cpu.def?.mnemonic).toBe('ADD');
    expect(cpu.activity.bus.op).toBe('none');

    m.microStep(); // FETCH REG
    seen.push(cpu.activity.op!.name);
    expect(cpu.opr).toBe(0x01);
    expect(cpu.pc).toBe(pc0 + 2);

    m.microStep(); // READ REGS
    seen.push(cpu.activity.op!.name);
    expect([cpu.a, cpu.b]).toEqual([0x7f, 0x01]);

    m.microStep(); // ALU
    seen.push(cpu.activity.op!.name);
    expect(cpu.y).toBe(0x80);
    expect(cpu.activity.alu).toMatchObject({ op: 'ADD', a: 0x7f, b: 1, y: 0x80 });
    expect(cpu.r[0]).toBe(0x7f); // not yet written
    expect(cpu.psw).toBe(psw0); // flags not yet committed

    const r = m.microStep(); // WRITE BACK
    seen.push(cpu.activity.op!.name);
    expect(r).toBe('end');
    expect(cpu.r[0]).toBe(0x80);
    expect(cpu.psw & 0x0f).toBe(0x04 | 0x08); // N, V
    expect(seen).toEqual(['FETCH', 'DECODE', 'FETCH REG', 'READ REGS', 'ALU', 'WRITE BACK']);
  });

  it('a load shows address, memory read and write-back as separate cycles', () => {
    const { m } = bareMachine('MOVP P1, #0x2000\nLD R0, [P1+4]\nHLT');
    m.debugPoke(0x2004, 0x5a);
    m.stepInstruction();
    m.stepInstruction();
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      m.microStep();
      names.push(m.cpu.activity.op!.name);
    }
    expect(names).toEqual(['FETCH', 'DECODE', 'FETCH REG', 'FETCH IMM']);
    m.microStep();
    expect(m.cpu.activity.op!.name).toBe('ADDRESS');
    expect(m.cpu.mar).toBe(0x2004);
    m.microStep();
    expect(m.cpu.activity.op!.name).toBe('MEM READ');
    expect(m.cpu.activity.bus).toEqual({ addr: 0x2004, data: 0x5a, op: 'read' });
    expect(m.cpu.mdr).toBe(0x5a);
    expect(m.cpu.r[0]).toBe(0);
    m.microStep();
    expect(m.cpu.r[0]).toBe(0x5a);
  });

  it('exception entry writes the frame one byte per memory cycle', () => {
    const { m } = bareMachine(`
        MOVP SP, #0x3000
        MOVP P0, #vectors
        MTC VBASE, P0
        SYS
        HLT
handler: HLT
vectors: .word 0,0,0,0,handler
`);
    for (let i = 0; i < 4; i++) m.stepInstruction();
    m.stepInstruction(); // SYS executes, trap pending
    expect(m.cpu.exception?.vector).toBe(4);
    const retPc = m.cpu.pc;
    const names: string[] = [];
    const writes: [number, number][] = [];
    for (;;) {
      const r = m.microStep();
      names.push(m.cpu.activity.op!.name);
      if (m.cpu.activity.bus.op === 'write') writes.push([m.cpu.activity.bus.addr, m.cpu.activity.bus.data]);
      if (r === 'end') break;
    }
    expect(names).toHaveLength(12);
    expect(names[0]).toBe('EXC ENTER');
    expect(writes).toEqual([
      [0x2fff, retPc >> 8],
      [0x2ffe, retPc & 0xff],
      [0x2ffd, 0x80],
    ]);
    expect(m.cpu.ksp).toBe(0x2ffd);
  });
});
