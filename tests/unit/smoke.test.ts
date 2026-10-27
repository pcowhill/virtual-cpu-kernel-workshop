import { describe, expect, it } from 'vitest';
import { bareMachine, runInstructions } from '../helpers';

describe('smoke', () => {
  it('adds two numbers', () => {
    const { m } = bareMachine(`
      MOV R0, #5
      MOV R1, #7
      ADD R0, R1
      HLT
    `);
    runInstructions(m, 3);
    expect(m.cpu.r[0]).toBe(12);
    expect(m.cpu.pc).toBe(0x0100 + 3 + 3 + 2);
  });
});
