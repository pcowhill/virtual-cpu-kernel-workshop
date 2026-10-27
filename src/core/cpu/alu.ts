import type { AluOp } from '../isa/opcodes';
import { PSW } from '../isa/constants';

/**
 * The 8-bit ALU. Pure functions; results are packed as `y | (flags << 8) | (mask << 12)`
 * where `flags` uses PSW bit positions (C=1, Z=2, N=4, V=8) and `mask` says which
 * flags the operation writes. Packing avoids allocating an object per cycle.
 */

const C = PSW.C;
const Z = PSW.Z;
const N = PSW.N;
const V = PSW.V;
const ALL = C | Z | N | V;

function pack(y: number, flags: number, mask: number): number {
  return (y & 0xff) | (flags << 8) | (mask << 12);
}

export function aluY(packed: number): number {
  return packed & 0xff;
}
export function aluFlags(packed: number): number {
  return (packed >> 8) & 0x0f;
}
export function aluMask(packed: number): number {
  return (packed >> 12) & 0x0f;
}

function zn(y: number): number {
  return (y === 0 ? Z : 0) | (y & 0x80 ? N : 0);
}

function add(a: number, b: number, cin: number): number {
  const sum = a + b + cin;
  const y = sum & 0xff;
  let f = zn(y);
  if (sum > 0xff) f |= C;
  if (~(a ^ b) & (a ^ y) & 0x80) f |= V;
  return pack(y, f, ALL);
}

function sub(a: number, b: number, bin: number): number {
  const diff = a - b - bin;
  const y = diff & 0xff;
  let f = zn(y);
  if (diff < 0) f |= C; // borrow
  if ((a ^ b) & (a ^ y) & 0x80) f |= V;
  return pack(y, f, ALL);
}

/**
 * Execute an 8-bit ALU operation.
 * @param carryIn the current PSW.C (0/1), used by ADC, SBC, ROL, ROR.
 */
export function alu(op: AluOp, a: number, b: number, carryIn: number): number {
  a &= 0xff;
  b &= 0xff;
  switch (op) {
    case 'ADD':
      return add(a, b, 0);
    case 'ADC':
      return add(a, b, carryIn);
    case 'SUB':
    case 'CMP':
      return sub(a, b, 0);
    case 'SBC':
      return sub(a, b, carryIn);
    case 'AND':
      return pack(a & b, zn(a & b), ALL);
    case 'OR':
      return pack(a | b, zn(a | b), ALL);
    case 'XOR':
      return pack(a ^ b, zn(a ^ b), ALL);
    case 'INC': {
      const y = (a + 1) & 0xff;
      return pack(y, zn(y) | (a === 0x7f ? V : 0), Z | N | V);
    }
    case 'DEC': {
      const y = (a - 1) & 0xff;
      return pack(y, zn(y) | (a === 0x80 ? V : 0), Z | N | V);
    }
    case 'NOT': {
      const y = ~a & 0xff;
      return pack(y, zn(y), ALL);
    }
    case 'NEG':
      return sub(0, a, 0);
    case 'SHL': {
      const y = (a << 1) & 0xff;
      return pack(y, zn(y) | (a & 0x80 ? C : 0), ALL);
    }
    case 'SHR': {
      const y = a >> 1;
      return pack(y, zn(y) | (a & 1 ? C : 0), ALL);
    }
    case 'SAR': {
      const y = (a >> 1) | (a & 0x80);
      return pack(y, zn(y) | (a & 1 ? C : 0), ALL);
    }
    case 'ROL': {
      const y = ((a << 1) | carryIn) & 0xff;
      return pack(y, zn(y) | (a & 0x80 ? C : 0), ALL);
    }
    case 'ROR': {
      const y = (a >> 1) | (carryIn << 7);
      return pack(y, zn(y) | (a & 1 ? C : 0), ALL);
    }
    case 'TST':
      return pack(a, zn(a), ALL);
  }
}

/** True if the ALU op writes its result back to the destination register. */
export function aluWritesResult(op: AluOp): boolean {
  return op !== 'CMP' && op !== 'TST';
}

export const ALU_SYMBOL: Record<AluOp, string> = {
  ADD: '+',
  ADC: '+ C +',
  SUB: '−',
  SBC: '− C −',
  CMP: '−',
  AND: '&',
  OR: '|',
  XOR: '^',
  INC: '+1',
  DEC: '−1',
  NOT: '~',
  NEG: 'neg',
  SHL: '<<1',
  SHR: '>>1',
  SAR: '>>>1',
  ROL: 'rol',
  ROR: 'ror',
  TST: 'test',
};

/**
 * High half of a 16-bit add/sub performed by the 8-bit ALU.
 * Z is computed over the full 16-bit result using `lowWasZero`.
 */
export function aluHigh(kind: 'add' | 'sub', a: number, b: number, carryIn: number, lowWasZero: boolean): number {
  const r = kind === 'add' ? add(a, b, carryIn) : sub(a, b, carryIn);
  const y = aluY(r);
  let f = aluFlags(r) & ~Z;
  if (y === 0 && lowWasZero) f |= Z;
  return pack(y, f, ALL);
}
