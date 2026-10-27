/**
 * Exhaustive ALU verification against an independent reference model.
 * The reference computes flags from the *mathematical* definitions (unsigned and
 * signed integer results), not from the bit tricks used by the implementation.
 */
import { describe, expect, it } from 'vitest';
import { alu, aluFlags, aluHigh, aluMask, aluY } from '../../src/core/cpu/alu';
import type { AluOp } from '../../src/core/isa/opcodes';

const s8 = (v: number) => (v & 0x80 ? v - 256 : v);
const s16 = (v: number) => (v & 0x8000 ? v - 65536 : v);
const fits8 = (v: number) => v >= -128 && v <= 127;
const fits16 = (v: number) => v >= -32768 && v <= 32767;

interface Ref {
  y: number;
  c?: boolean;
  v?: boolean;
}

function reference(op: AluOp, a: number, b: number, cin: number): Ref {
  switch (op) {
    case 'ADD':
    case 'ADC': {
      const k = op === 'ADC' ? cin : 0;
      const u = a + b + k;
      return { y: u % 256, c: u > 255, v: !fits8(s8(a) + s8(b) + k) };
    }
    case 'SUB':
    case 'CMP':
    case 'SBC': {
      const k = op === 'SBC' ? cin : 0;
      const u = a - b - k;
      return { y: ((u % 256) + 256) % 256, c: u < 0, v: !fits8(s8(a) - s8(b) - k) };
    }
    case 'AND':
      return { y: a & b, c: false, v: false };
    case 'OR':
      return { y: a | b, c: false, v: false };
    case 'XOR':
      return { y: a ^ b, c: false, v: false };
    case 'INC':
      return { y: (a + 1) % 256, v: !fits8(s8(a) + 1) };
    case 'DEC':
      return { y: (a + 255) % 256, v: !fits8(s8(a) - 1) };
    case 'NOT':
      return { y: 255 - a, c: false, v: false };
    case 'NEG':
      return { y: (256 - a) % 256, c: a !== 0, v: !fits8(-s8(a)) };
    case 'SHL':
      return { y: (a * 2) % 256, c: a >= 128, v: false };
    case 'SHR':
      return { y: Math.floor(a / 2), c: a % 2 === 1, v: false };
    case 'SAR':
      return { y: (Math.floor(s8(a) / 2) + 256) % 256, c: a % 2 === 1, v: false };
    case 'ROL':
      return { y: ((a * 2) % 256) + cin, c: a >= 128, v: false };
    case 'ROR':
      return { y: Math.floor(a / 2) + cin * 128, c: a % 2 === 1, v: false };
    case 'TST':
      return { y: a, c: false, v: false };
  }
}

const OPS: AluOp[] = [
  'ADD',
  'ADC',
  'SUB',
  'SBC',
  'CMP',
  'AND',
  'OR',
  'XOR',
  'INC',
  'DEC',
  'NOT',
  'NEG',
  'SHL',
  'SHR',
  'SAR',
  'ROL',
  'ROR',
  'TST',
];
const UNARY = new Set<AluOp>(['INC', 'DEC', 'NOT', 'NEG', 'SHL', 'SHR', 'SAR', 'ROL', 'ROR', 'TST']);

describe('8-bit ALU (exhaustive)', () => {
  for (const op of OPS) {
    it(`${op} matches the reference for every input`, () => {
      const bs = UNARY.has(op) ? [0] : Array.from({ length: 256 }, (_, i) => i);
      let failures = 0;
      for (let a = 0; a < 256; a++)
        for (const b of bs)
          for (const cin of [0, 1]) {
            const p = alu(op, a, b, cin);
            const ref = reference(op, a, b, cin);
            const f = aluFlags(p);
            const m = aluMask(p);
            const ok =
              aluY(p) === ref.y &&
              ((f & 2) !== 0) === (ref.y === 0) &&
              ((f & 4) !== 0) === ref.y >= 128 &&
              (ref.c === undefined ? (m & 1) === 0 : ((f & 1) !== 0) === ref.c) &&
              (ref.v === undefined ? (m & 8) === 0 : ((f & 8) !== 0) === ref.v);
            if (!ok && failures++ < 5) {
              expect.fail(
                `${op} a=${a} b=${b} cin=${cin}: got y=${aluY(p)} flags=${f.toString(2)}; ref ${JSON.stringify(ref)}`,
              );
            }
          }
      expect(failures).toBe(0);
    });
  }
});

describe('16-bit arithmetic via two 8-bit ALU passes', () => {
  function add16(a: number, b: number) {
    const lo = alu('ADD', a & 0xff, b & 0xff, 0);
    const hi = aluHigh('add', a >> 8, b >> 8, aluFlags(lo) & 1, aluY(lo) === 0);
    return { y: (aluY(hi) << 8) | aluY(lo), f: aluFlags(hi) };
  }
  function sub16(a: number, b: number) {
    const lo = alu('SUB', a & 0xff, b & 0xff, 0);
    const hi = aluHigh('sub', a >> 8, b >> 8, aluFlags(lo) & 1, aluY(lo) === 0);
    return { y: (aluY(hi) << 8) | aluY(lo), f: aluFlags(hi) };
  }
  // Pseudo-random but deterministic sample plus boundary values.
  const samples: number[] = [0, 1, 0x7f, 0x80, 0xff, 0x100, 0x7fff, 0x8000, 0x8001, 0xfffe, 0xffff];
  let x = 12345;
  for (let i = 0; i < 300; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    samples.push(x & 0xffff);
  }
  it('add16 matches integer arithmetic', () => {
    for (const a of samples)
      for (const b of samples) {
        const { y, f } = add16(a, b);
        const u = a + b;
        expect(y).toBe(u % 65536);
        expect((f & 1) !== 0).toBe(u > 65535);
        expect((f & 2) !== 0).toBe(u % 65536 === 0);
        expect((f & 4) !== 0).toBe(u % 65536 >= 32768);
        expect((f & 8) !== 0).toBe(!fits16(s16(a) + s16(b)));
      }
  });
  it('sub16 matches integer arithmetic', () => {
    for (const a of samples)
      for (const b of samples) {
        const { y, f } = sub16(a, b);
        const u = a - b;
        const w = ((u % 65536) + 65536) % 65536;
        expect(y).toBe(w);
        expect((f & 1) !== 0).toBe(u < 0);
        expect((f & 2) !== 0).toBe(w === 0);
        expect((f & 4) !== 0).toBe(w >= 32768);
        expect((f & 8) !== 0).toBe(!fits16(s16(a) - s16(b)));
      }
  });
});
