/**
 * ISA conformance: table-driven tests with hand-computed expected CPU states.
 * Expected values come from the specification (docs/spec/architecture.md), not
 * from running the emulator. Every opcode in the instruction table must be
 * exercised by at least one case (checked at the end).
 */
import { describe, expect, it } from 'vitest';
import { CAUSE, PSW } from '../../src/core/isa/constants';
import { INSTRUCTIONS } from '../../src/core/isa/opcodes';
import { runCase, type IsaCase } from './isa-harness';

const C = PSW.C;
const Z = PSW.Z;
const N = PSW.N;
const V = PSW.V;
const S = PSW.S;
const I = PSW.I;

const ILLEGAL = { vector: 1, cause: CAUSE.ILLEGAL_INSTRUCTION };
const PRIV = { vector: 2, cause: CAUSE.PRIVILEGED_INSTRUCTION };

const cases: IsaCase[] = [
  // ---------------- system ----------------
  { name: 'NOP advances PC by 1', code: 'NOP', expect: { pc: 0x101, cycles: 2, flags: '' } },
  { name: 'CLC clears carry only', code: 'CLC', regs: { PSW: S | C | Z }, expect: { flags: 'Z', cycles: 3 } },
  { name: 'SEC sets carry', code: 'SEC', regs: { PSW: S }, expect: { flags: 'C', cycles: 3 } },
  { name: 'STI sets I', code: 'STI', regs: { PSW: S }, expect: { regs: { PSW: S | I }, cycles: 3 } },
  { name: 'CLI clears I', code: 'CLI', regs: { PSW: S | I | N }, expect: { regs: { PSW: S | N }, cycles: 3 } },
  { name: 'HLT enters waiting state', code: 'HLT', expect: { status: 'waiting', pc: 0x101, cycles: 3 } },
  {
    name: 'SYS raises a syscall trap with PC at the next instruction',
    code: 'SYS\nNOP',
    expect: { exception: { vector: 4, cause: CAUSE.SYSCALL }, pc: 0x101, cycles: 3 },
  },
  {
    name: 'BRK raises a breakpoint trap',
    code: 'BRK',
    expect: { exception: { vector: 5, cause: CAUSE.BREAKPOINT }, pc: 0x101, cycles: 3 },
  },
  {
    name: 'RTI restores PSW and PC and switches to user mode',
    code: 'RTI',
    regs: { KSP: 0x2ffd },
    mem: { 0x2ffd: I | C | Z, 0x2ffe: 0x00, 0x2fff: 0x70 },
    expect: { pc: 0x7000, regs: { PSW: I | C | Z, KSP: 0x3000 }, cycles: 9 },
  },
  {
    name: 'RTI to supervisor mode keeps using KSP',
    code: 'RTI',
    regs: { KSP: 0x2ffd },
    mem: { 0x2ffd: S | N, 0x2ffe: 0x34, 0x2fff: 0x12 },
    expect: { pc: 0x1234, regs: { PSW: S | N, SP: 0x3000 } },
  },
  {
    name: 'RTI masks reserved PSW bits 4-5',
    code: 'RTI',
    regs: { KSP: 0x2ffd },
    mem: { 0x2ffd: 0xff, 0x2ffe: 0x00, 0x2fff: 0x02 },
    expect: { regs: { PSW: 0xcf } },
  },

  // ---------------- 8-bit data movement ----------------
  {
    name: 'MOV R,R copies',
    code: 'MOV R0, R1',
    regs: { R1: 0x5a, PSW: S | C },
    expect: { regs: { R0: 0x5a, R1: 0x5a }, flags: 'C', cycles: 4 },
  },
  { name: 'MOV R,#imm', code: 'MOV R3, #0xFF', expect: { regs: { R3: 0xff }, cycles: 5, pc: 0x103 } },
  { name: 'MOV R,#negative wraps', code: 'MOV R7, #-1', expect: { regs: { R7: 0xff } } },
  {
    name: 'LD absolute',
    code: 'LD R2, [0x2345]',
    mem: { 0x2345: 0x77 },
    expect: { regs: { R2: 0x77 }, cycles: 8, pc: 0x104 },
  },
  {
    name: 'LD base+offset',
    code: 'LD R0, [P1+0x10]',
    regs: { P1: 0x2300 },
    mem: { 0x2310: 0x42 },
    expect: { regs: { R0: 0x42 }, cycles: 7, pc: 0x103 },
  },
  {
    name: 'LD register indirect',
    code: 'LD R4, [P3]',
    regs: { P3: 0x2222 },
    mem: { 0x2222: 0x99 },
    expect: { regs: { R4: 0x99 } },
  },
  {
    name: 'LD SP-relative',
    code: 'LD R1, [SP+2]',
    regs: { SP: 0x3000 },
    mem: { 0x3002: 9 },
    expect: { regs: { R1: 9 } },
  },
  {
    name: 'LD effective address wraps modulo 65536',
    code: 'LD R1, [P0+0x20]',
    regs: { P0: 0xfff0 },
    expect: { regs: { R1: 0xff } }, // 0x0010 is erased ROM
  },
  { name: 'LD does not change flags', code: 'LD R1, [0x2000]', regs: { PSW: S | Z | V }, expect: { flags: 'ZV' } },
  { name: 'ST absolute', code: 'ST [0x2400], R4', regs: { R4: 0x99 }, expect: { mem: { 0x2400: 0x99 }, cycles: 7 } },
  {
    name: 'ST base+offset',
    code: 'ST [P2+5], R6',
    regs: { P2: 0x2500, R6: 0x12 },
    expect: { mem: { 0x2505: 0x12 }, cycles: 6 },
  },
  {
    name: 'ST to ROM raises ROM_WRITE and leaves PC at the instruction',
    code: 'ST [0x0050], R0',
    expect: { exception: { vector: 3, cause: CAUSE.ROM_WRITE, faddr: 0x0050 }, pc: 0x100 },
  },

  // ---------------- stack ----------------
  {
    name: 'PUSH pre-decrements SP',
    code: 'PUSH R0',
    regs: { R0: 0xab, SP: 0x3000 },
    expect: { mem: { 0x2fff: 0xab }, regs: { SP: 0x2fff }, cycles: 6 },
  },
  {
    name: 'POP post-increments SP',
    code: 'POP R5',
    regs: { SP: 0x2fff },
    mem: { 0x2fff: 0xcd },
    expect: { regs: { R5: 0xcd, SP: 0x3000 }, cycles: 6 },
  },
  {
    name: 'PUSHP pushes high byte first (little-endian in memory)',
    code: 'PUSHP P0',
    regs: { P0: 0x1234, SP: 0x3000 },
    expect: { mem: { 0x2fff: 0x12, 0x2ffe: 0x34 }, regs: { SP: 0x2ffe }, cycles: 8 },
  },
  {
    name: 'POPP restores a pair',
    code: 'POPP P3',
    regs: { SP: 0x2ffe },
    mem: { 0x2ffe: 0x78, 0x2fff: 0x56 },
    expect: { regs: { P3: 0x5678, R6: 0x56, R7: 0x78, SP: 0x3000 }, cycles: 8 },
  },
  {
    name: 'POPP SP loads SP from the stack',
    code: 'POPP SP',
    regs: { SP: 0x2ffe },
    mem: { 0x2ffe: 0x00, 0x2fff: 0x40 },
    expect: { regs: { SP: 0x4000 } },
  },
  {
    name: 'PUSH wraps SP from 0x0000',
    code: 'PUSH R0',
    regs: { SP: 0x0000, R0: 1 },
    expect: { exception: { vector: 3, cause: CAUSE.BUS_ERROR, faddr: 0xffff }, regs: { SP: 0 } },
  },

  // ---------------- 16-bit data movement ----------------
  { name: 'MOVP P,P', code: 'MOVP P1, P2', regs: { P2: 0x1234 }, expect: { regs: { R2: 0x12, R3: 0x34 }, cycles: 4 } },
  { name: 'MOVP SP,P', code: 'MOVP SP, P0', regs: { P0: 0x4567 }, expect: { regs: { KSP: 0x4567 } } },
  { name: 'MOVP P,SP', code: 'MOVP P0, SP', regs: { SP: 0x2abc }, expect: { regs: { P0: 0x2abc } } },
  { name: 'MOVP P,#imm16', code: 'MOVP P3, #0xBEEF', expect: { regs: { R6: 0xbe, R7: 0xef }, cycles: 6, pc: 0x104 } },
  { name: 'MOVP SP,#imm16', code: 'MOVP SP, #0x6000', expect: { regs: { SP: 0x6000 } } },
  {
    name: 'LDW absolute (little-endian)',
    code: 'LDW P0, [0x2600]',
    mem: { 0x2600: 0x34, 0x2601: 0x12 },
    expect: { regs: { P0: 0x1234 }, cycles: 10 },
  },
  {
    name: 'LDW base+offset',
    code: 'LDW P1, [P0+2]',
    regs: { P0: 0x2600 },
    mem: { 0x2602: 0xcd, 0x2603: 0xab },
    expect: { regs: { P1: 0xabcd }, cycles: 9 },
  },
  {
    name: 'LDW SP,[abs]',
    code: 'LDW SP, [0x2600]',
    mem: { 0x2600: 0x00, 0x2601: 0x58 },
    expect: { regs: { SP: 0x5800 } },
  },
  {
    name: 'STW absolute',
    code: 'STW [0x2700], P2',
    regs: { P2: 0xa1b2 },
    expect: { mem: { 0x2700: 0xb2, 0x2701: 0xa1 }, cycles: 9 },
  },
  {
    name: 'STW base+offset with SP as data',
    code: 'STW [P1+1], SP',
    regs: { P1: 0x2800, SP: 0x2f00 },
    expect: { mem: { 0x2801: 0x00, 0x2802: 0x2f }, cycles: 8 },
  },
  {
    name: 'STW whose second byte faults leaves the first byte written',
    code: 'STW [0x1FFF], P0',
    regs: { P0: 0x1234 },
    // 0x1FFF is ROM: the first byte faults immediately
    expect: { exception: { vector: 3, cause: CAUSE.ROM_WRITE, faddr: 0x1fff } },
  },
  {
    name: 'STW whose second byte leaves the user window writes only the first byte',
    code: 'STW [0x7FFF], P0',
    user: true,
    regs: { P0: 0x1234 },
    expect: {
      exception: { vector: 3, cause: CAUSE.WRITE_VIOLATION, faddr: 0x8000 },
      mem: { 0x7fff: 0x34 },
      pc: 0x6000,
    },
  },

  // ---------------- control registers ----------------
  {
    name: 'MFC reads VBASE',
    code: 'MFC P0, VBASE',
    regs: { VBASE: 0x2000 },
    expect: { regs: { P0: 0x2000 }, cycles: 4 },
  },
  {
    name: 'MFC reads PSW zero-extended',
    code: 'MFC P2, PSW',
    regs: { PSW: S | Z },
    expect: { regs: { R4: 0, R5: S | Z } },
  },
  {
    name: 'MTC writes UBASE',
    code: 'MTC UBASE, P1',
    regs: { P1: 0x8000 },
    expect: { regs: { UBASE: 0x8000 }, cycles: 4 },
  },
  { name: 'MTC writes ULIMIT', code: 'MTC ULIMIT, P1', regs: { P1: 0xa000 }, expect: { regs: { ULIMIT: 0xa000 } } },
  { name: 'MTC writes USP', code: 'MTC USP, P3', regs: { P3: 0x7ff0 }, expect: { regs: { USP: 0x7ff0, KSP: 0x3000 } } },
  {
    name: 'MTC writes KSCRATCH',
    code: 'MTC KSCRATCH, P0\nMFC P1, KSCRATCH',
    steps: 2,
    regs: { P0: 0xbeef },
    expect: { regs: { P1: 0xbeef } },
  },
  {
    name: 'MTC PSW sets flags and I',
    code: 'MTC PSW, P0',
    regs: { P0: 0x00c3 },
    expect: { regs: { PSW: S | I | C | Z } },
  },
  { name: 'MTC to CAUSE is ignored', code: 'MTC CAUSE, P0', regs: { P0: 0x1234 }, expect: { regs: { CAUSE: 0 } } },
  { name: 'MTC to FADDR is ignored', code: 'MTC FADDR, P0', regs: { P0: 0x1234 }, expect: { regs: { FADDR: 0 } } },

  // ---------------- 8-bit ALU: register forms ----------------
  {
    name: 'ADD simple',
    code: 'ADD R0, R1',
    regs: { R0: 0x10, R1: 0x20 },
    expect: { regs: { R0: 0x30 }, flags: '', cycles: 6 },
  },
  {
    name: 'ADD unsigned carry and zero',
    code: 'ADD R0, R1',
    regs: { R0: 0xff, R1: 0x01 },
    expect: { regs: { R0: 0 }, flags: 'CZ' },
  },
  {
    name: 'ADD signed overflow',
    code: 'ADD R0, R1',
    regs: { R0: 0x7f, R1: 0x01 },
    expect: { regs: { R0: 0x80 }, flags: 'NV' },
  },
  {
    name: 'ADD -128 + -128',
    code: 'ADD R0, R1',
    regs: { R0: 0x80, R1: 0x80 },
    expect: { regs: { R0: 0 }, flags: 'CZV' },
  },
  {
    name: 'ADD register to itself',
    code: 'ADD R2, R2',
    regs: { R2: 0x41 },
    expect: { regs: { R2: 0x82 }, flags: 'NV' },
  },
  {
    name: 'ADC adds carry',
    code: 'ADC R0, R1',
    regs: { R0: 0x10, R1: 0x20, PSW: S | C },
    expect: { regs: { R0: 0x31 }, flags: '' },
  },
  {
    name: 'ADC carry chain to zero',
    code: 'ADC R0, R1',
    regs: { R0: 0xff, R1: 0x00, PSW: S | C },
    expect: { regs: { R0: 0 }, flags: 'CZ' },
  },
  { name: 'SUB simple', code: 'SUB R0, R1', regs: { R0: 0x30, R1: 0x10 }, expect: { regs: { R0: 0x20 }, flags: '' } },
  {
    name: 'SUB borrow sets C',
    code: 'SUB R0, R1',
    regs: { R0: 0x10, R1: 0x20 },
    expect: { regs: { R0: 0xf0 }, flags: 'CN' },
  },
  {
    name: 'SUB signed overflow',
    code: 'SUB R0, R1',
    regs: { R0: 0x80, R1: 0x01 },
    expect: { regs: { R0: 0x7f }, flags: 'V' },
  },
  { name: 'SUB equal gives zero', code: 'SUB R0, R1', regs: { R0: 5, R1: 5 }, expect: { regs: { R0: 0 }, flags: 'Z' } },
  {
    name: 'SBC subtracts borrow',
    code: 'SBC R0, R1',
    regs: { R0: 0x10, R1: 0x05, PSW: S | C },
    expect: { regs: { R0: 0x0a }, flags: '' },
  },
  {
    name: 'SBC borrow chain',
    code: 'SBC R0, R1',
    regs: { R0: 0, R1: 0, PSW: S | C },
    expect: { regs: { R0: 0xff }, flags: 'CN' },
  },
  {
    name: 'CMP less (unsigned)',
    code: 'CMP R0, R1',
    regs: { R0: 5, R1: 7 },
    expect: { regs: { R0: 5, R1: 7 }, flags: 'CN' },
  },
  { name: 'CMP greater', code: 'CMP R0, R1', regs: { R0: 7, R1: 5 }, expect: { regs: { R0: 7 }, flags: '' } },
  { name: 'CMP equal', code: 'CMP R0, R1', regs: { R0: 0x42, R1: 0x42 }, expect: { flags: 'Z' } },
  {
    name: 'AND clears C and V',
    code: 'AND R0, R1',
    regs: { R0: 0xf0, R1: 0x3c, PSW: S | C | V },
    expect: { regs: { R0: 0x30 }, flags: '' },
  },
  { name: 'AND to zero', code: 'AND R0, R1', regs: { R0: 0x0f, R1: 0xf0 }, expect: { regs: { R0: 0 }, flags: 'Z' } },
  { name: 'OR sets N', code: 'OR R0, R1', regs: { R0: 0x80, R1: 0x01 }, expect: { regs: { R0: 0x81 }, flags: 'N' } },
  { name: 'XOR self is zero', code: 'XOR R3, R3', regs: { R3: 0xff }, expect: { regs: { R3: 0 }, flags: 'Z' } },

  // ---------------- 8-bit ALU: immediate forms ----------------
  {
    name: 'ADD #imm',
    code: 'ADD R0, #0x10',
    regs: { R0: 0xf0 },
    expect: { regs: { R0: 0 }, flags: 'CZ', cycles: 7, pc: 0x103 },
  },
  { name: 'ADC #imm', code: 'ADC R1, #1', regs: { R1: 1, PSW: S | C }, expect: { regs: { R1: 3 }, flags: '' } },
  { name: 'SUB #imm', code: 'SUB R2, #1', regs: { R2: 0 }, expect: { regs: { R2: 0xff }, flags: 'CN' } },
  { name: 'SBC #imm', code: 'SBC R2, #0', regs: { R2: 0x80, PSW: S | C }, expect: { regs: { R2: 0x7f }, flags: 'V' } },
  { name: 'CMP #imm signed', code: 'CMP R4, #0x01', regs: { R4: 0x80 }, expect: { flags: 'V', regs: { R4: 0x80 } } },
  { name: 'AND #imm', code: 'AND R5, #0x0F', regs: { R5: 0xab }, expect: { regs: { R5: 0x0b }, flags: '' } },
  { name: 'OR #imm', code: 'OR R6, #0x80', regs: { R6: 0 }, expect: { regs: { R6: 0x80 }, flags: 'N' } },
  { name: 'XOR #imm', code: 'XOR R7, #0xFF', regs: { R7: 0x0f }, expect: { regs: { R7: 0xf0 }, flags: 'N' } },

  // ---------------- 8-bit unary and shifts ----------------
  {
    name: 'INC to signed overflow',
    code: 'INC R0',
    regs: { R0: 0x7f },
    expect: { regs: { R0: 0x80 }, flags: 'NV', cycles: 6 },
  },
  {
    name: 'INC wraps and keeps C',
    code: 'INC R0',
    regs: { R0: 0xff, PSW: S | C },
    expect: { regs: { R0: 0 }, flags: 'CZ' },
  },
  { name: 'DEC signed overflow', code: 'DEC R1', regs: { R1: 0x80 }, expect: { regs: { R1: 0x7f }, flags: 'V' } },
  { name: 'DEC to zero', code: 'DEC R1', regs: { R1: 1 }, expect: { regs: { R1: 0 }, flags: 'Z' } },
  { name: 'DEC wraps', code: 'DEC R1', regs: { R1: 0 }, expect: { regs: { R1: 0xff }, flags: 'N' } },
  { name: 'NOT', code: 'NOT R2', regs: { R2: 0x0f, PSW: S | C }, expect: { regs: { R2: 0xf0 }, flags: 'N' } },
  { name: 'NEG 1', code: 'NEG R3', regs: { R3: 1 }, expect: { regs: { R3: 0xff }, flags: 'CN' } },
  { name: 'NEG 0', code: 'NEG R3', regs: { R3: 0 }, expect: { regs: { R3: 0 }, flags: 'Z' } },
  { name: 'NEG -128 overflows', code: 'NEG R3', regs: { R3: 0x80 }, expect: { regs: { R3: 0x80 }, flags: 'CNV' } },
  { name: 'SHL shifts bit 7 into C', code: 'SHL R4', regs: { R4: 0x81 }, expect: { regs: { R4: 0x02 }, flags: 'C' } },
  { name: 'SHL into sign', code: 'SHL R4', regs: { R4: 0x40 }, expect: { regs: { R4: 0x80 }, flags: 'N' } },
  { name: 'SHR shifts bit 0 into C', code: 'SHR R5', regs: { R5: 0x81 }, expect: { regs: { R5: 0x40 }, flags: 'C' } },
  { name: 'SHR to zero', code: 'SHR R5', regs: { R5: 0x01 }, expect: { regs: { R5: 0 }, flags: 'CZ' } },
  { name: 'SAR keeps sign', code: 'SAR R6', regs: { R6: 0x81 }, expect: { regs: { R6: 0xc0 }, flags: 'CN' } },
  { name: 'SAR positive', code: 'SAR R6', regs: { R6: 0x40 }, expect: { regs: { R6: 0x20 }, flags: '' } },
  {
    name: 'ROL through carry (C=1)',
    code: 'ROL R7',
    regs: { R7: 0x80, PSW: S | C },
    expect: { regs: { R7: 0x01 }, flags: 'C' },
  },
  { name: 'ROL through carry (C=0)', code: 'ROL R7', regs: { R7: 0x40 }, expect: { regs: { R7: 0x80 }, flags: 'N' } },
  {
    name: 'ROR through carry (C=1)',
    code: 'ROR R0',
    regs: { R0: 0x01, PSW: S | C },
    expect: { regs: { R0: 0x80 }, flags: 'CN' },
  },
  { name: 'ROR through carry (C=0)', code: 'ROR R0', regs: { R0: 0x02 }, expect: { regs: { R0: 0x01 }, flags: '' } },
  {
    name: 'TST zero clears C',
    code: 'TST R1',
    regs: { R1: 0, PSW: S | C | V },
    expect: { regs: { R1: 0 }, flags: 'Z' },
  },
  { name: 'TST negative', code: 'TST R1', regs: { R1: 0x80 }, expect: { regs: { R1: 0x80 }, flags: 'N' } },

  // ---------------- 16-bit arithmetic ----------------
  {
    name: 'INCP carries into high byte',
    code: 'INCP P0',
    regs: { P0: 0x00ff },
    expect: { regs: { P0: 0x0100 }, flags: '', cycles: 5 },
  },
  {
    name: 'INCP wraps to zero, keeps C',
    code: 'INCP P0',
    regs: { P0: 0xffff, PSW: S | C },
    expect: { regs: { P0: 0 }, flags: 'CZ' },
  },
  { name: 'INCP SP', code: 'INCP SP', regs: { SP: 0x2fff }, expect: { regs: { SP: 0x3000 } } },
  {
    name: 'DECP borrows from high byte',
    code: 'DECP P1',
    regs: { P1: 0x0100 },
    expect: { regs: { P1: 0x00ff }, flags: '' },
  },
  { name: 'DECP to zero', code: 'DECP P1', regs: { P1: 1, PSW: S | N }, expect: { regs: { P1: 0 }, flags: 'ZN' } },
  {
    name: 'ADDP P,P with carry between bytes',
    code: 'ADDP P0, P1',
    regs: { P0: 0x12ff, P1: 0x0001 },
    expect: { regs: { P0: 0x1300 }, flags: '', cycles: 8 },
  },
  {
    name: 'ADDP low byte zero but result non-zero',
    code: 'ADDP P0, P1',
    regs: { P0: 0x00ff, P1: 0x0001 },
    expect: { regs: { P0: 0x0100 }, flags: '' },
  },
  {
    name: 'ADDP wraps to zero',
    code: 'ADDP P0, P1',
    regs: { P0: 0xffff, P1: 0x0001 },
    expect: { regs: { P0: 0 }, flags: 'CZ' },
  },
  {
    name: 'ADDP signed overflow',
    code: 'ADDP P0, P1',
    regs: { P0: 0x7fff, P1: 0x0001 },
    expect: { regs: { P0: 0x8000 }, flags: 'NV' },
  },
  { name: 'ADDP #imm16', code: 'ADDP P2, #0x1000', regs: { P2: 0x2345 }, expect: { regs: { P2: 0x3345 }, cycles: 10 } },
  { name: 'ADDP SP, #-4', code: 'ADDP SP, #-4', regs: { SP: 0x3000 }, expect: { regs: { SP: 0x2ffc }, flags: 'C' } },
  {
    name: 'ADDP P,R zero-extends',
    code: 'ADDP P0, R3',
    regs: { P0: 0x10f0, R3: 0x20 },
    expect: { regs: { P0: 0x1110 }, cycles: 8 },
  },
  {
    name: 'ADDP P,R 0xFF',
    code: 'ADDP P0, R7',
    regs: { P0: 0x0001, R7: 0xff },
    expect: { regs: { P0: 0x0100 }, flags: '' },
  },
  {
    name: 'SUBP simple',
    code: 'SUBP P0, P1',
    regs: { P0: 0x1000, P1: 0x0001 },
    expect: { regs: { P0: 0x0fff }, flags: '' },
  },
  {
    name: 'SUBP borrow',
    code: 'SUBP P0, P1',
    regs: { P0: 0x0000, P1: 0x0001 },
    expect: { regs: { P0: 0xffff }, flags: 'CN' },
  },
  {
    name: 'SUBP signed overflow',
    code: 'SUBP P0, P1',
    regs: { P0: 0x8000, P1: 0x0001 },
    expect: { regs: { P0: 0x7fff }, flags: 'V' },
  },
  {
    name: 'CMPP equal',
    code: 'CMPP P2, P3',
    regs: { P2: 0xabcd, P3: 0xabcd },
    expect: { regs: { P2: 0xabcd }, flags: 'Z', cycles: 8 },
  },
  { name: 'CMPP unsigned less', code: 'CMPP P2, P3', regs: { P2: 0x1000, P3: 0x2000 }, expect: { flags: 'CN' } },
  {
    name: 'CMPP #imm16 equal',
    code: 'CMPP P0, #0x1234',
    regs: { P0: 0x1234 },
    expect: { flags: 'Z', regs: { P0: 0x1234 }, cycles: 10 },
  },
  { name: 'CMPP SP with immediate', code: 'CMPP SP, #0x3000', regs: { SP: 0x2fff }, expect: { flags: 'CN' } },

  // ---------------- control flow ----------------
  { name: 'JMP absolute', code: 'JMP target\nNOP\ntarget: NOP', expect: { pc: 'target', cycles: 5 } },
  { name: 'JMP register', code: 'JMP P2', regs: { P2: 0x1234 }, expect: { pc: 0x1234, cycles: 4 } },
  {
    name: 'CALL absolute pushes return address',
    code: 'CALL sub\nNOP\nsub: RET',
    regs: { SP: 0x3000 },
    expect: { pc: 'sub', mem: { 0x2fff: 0x01, 0x2ffe: 0x03 }, regs: { SP: 0x2ffe }, cycles: 9 },
  },
  {
    name: 'CALL register',
    code: 'CALL P1',
    regs: { SP: 0x3000, P1: 0x0200 },
    expect: { pc: 0x0200, mem: { 0x2fff: 0x01, 0x2ffe: 0x02 }, regs: { SP: 0x2ffe }, cycles: 8 },
  },
  {
    name: 'RET pops return address',
    code: 'RET',
    regs: { SP: 0x2ffe },
    mem: { 0x2ffe: 0x34, 0x2fff: 0x12 },
    expect: { pc: 0x1234, regs: { SP: 0x3000 }, cycles: 7 },
  },
  {
    name: 'CALL then RET round trip',
    code: 'CALL sub\nback: NOP\nsub: RET',
    steps: 2,
    regs: { SP: 0x3000 },
    expect: { pc: 'back', regs: { SP: 0x3000 } },
  },

  // ---------------- invalid encodings and privilege ----------------
  { name: 'opcode 0x00 is illegal', code: '.byte 0x00', expect: { exception: ILLEGAL, pc: 0x100, cycles: 2 } },
  { name: 'opcode 0xFF is illegal', code: '.byte 0xFF', expect: { exception: ILLEGAL, pc: 0x100 } },
  { name: 'opcode 0x6F (gap) is illegal', code: '.byte 0x6F, 0, 0', expect: { exception: ILLEGAL } },
  {
    name: 'register field 8 is illegal',
    code: '.byte 0x10, 0x81',
    regs: { R0: 7 },
    expect: { exception: ILLEGAL, regs: { R0: 7 }, cycles: 3 },
  },
  {
    name: 'non-zero unused field is illegal',
    code: '.byte 0x16, 0x01',
    regs: { SP: 0x3000 },
    expect: { exception: ILLEGAL, regs: { SP: 0x3000 } },
  },
  { name: 'wide field 5 is illegal', code: '.byte 0x18, 0x50', expect: { exception: ILLEGAL } },
  { name: 'control register 8 is illegal', code: '.byte 0x20, 0x08', expect: { exception: ILLEGAL } },
  { name: 'user mode: HLT is privileged', code: 'HLT', user: true, expect: { exception: PRIV, pc: 0x6000, cycles: 2 } },
  { name: 'user mode: CLI is privileged', code: 'CLI', user: true, expect: { exception: PRIV } },
  { name: 'user mode: STI is privileged', code: 'STI', user: true, expect: { exception: PRIV } },
  { name: 'user mode: RTI is privileged', code: 'RTI', user: true, expect: { exception: PRIV } },
  {
    name: 'user mode: MFC is privileged',
    code: 'MFC P0, PSW',
    user: true,
    regs: { P0: 0x1111 },
    expect: { exception: PRIV, regs: { P0: 0x1111 } },
  },
  {
    name: 'user mode: MTC is privileged',
    code: 'MTC ULIMIT, P0',
    user: true,
    regs: { P0: 0xf000 },
    expect: { exception: PRIV, regs: { ULIMIT: 0x8000 } },
  },
  {
    name: 'user mode: SYS is allowed',
    code: 'SYS',
    user: true,
    expect: { exception: { vector: 4, cause: CAUSE.SYSCALL }, pc: 0x6001 },
  },
  { name: 'user mode: ordinary ALU works', code: 'ADD R0, #1', user: true, expect: { regs: { R0: 1 } } },
  {
    name: 'user mode: SP means USP',
    code: 'PUSH R0',
    user: true,
    regs: { R0: 0x5e },
    expect: { regs: { USP: 0x6fff, KSP: 0x3000 }, mem: { 0x6fff: 0x5e } },
  },
];

const conditionCases: [string, number, boolean][] = [
  ['JEQ', Z, true],
  ['JEQ', 0, false],
  ['JZ', Z, true],
  ['JNE', 0, true],
  ['JNE', Z, false],
  ['JNZ', Z, false],
  ['JCS', C, true],
  ['JCS', 0, false],
  ['JLTU', C, true],
  ['JCC', 0, true],
  ['JCC', C, false],
  ['JGEU', 0, true],
  ['JMI', N, true],
  ['JMI', 0, false],
  ['JPL', 0, true],
  ['JPL', N, false],
  ['JVS', V, true],
  ['JVS', 0, false],
  ['JVC', 0, true],
  ['JVC', V, false],
  ['JLT', N, true],
  ['JLT', V, true],
  ['JLT', N | V, false],
  ['JLT', 0, false],
  ['JGE', N | V, true],
  ['JGE', 0, true],
  ['JGE', N, false],
  ['JGT', 0, true],
  ['JGT', N | V, true],
  ['JGT', Z, false],
  ['JGT', N, false],
  ['JLE', Z, true],
  ['JLE', N, true],
  ['JLE', 0, false],
  ['JLE', N | V, false],
  ['JGTU', 0, true],
  ['JGTU', C, false],
  ['JGTU', Z, false],
  ['JLEU', C, true],
  ['JLEU', Z, true],
  ['JLEU', 0, false],
];

for (const [mn, flags, taken] of conditionCases) {
  cases.push({
    name: `${mn} with flags ${flags.toString(2).padStart(4, '0')} ${taken ? 'is taken' : 'falls through'}`,
    code: `${mn} target\nnext: NOP\ntarget: NOP`,
    regs: { PSW: S | flags },
    expect: { pc: taken ? 'target' : 'next', cycles: 5, regs: { PSW: S | flags } },
  });
}

describe('ISA conformance (hand-computed expectations)', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const { problems } = runCase(c);
    expect(problems).toEqual([]);
  });

  it('exercises every opcode in the instruction table', () => {
    const executed = new Set<number>();
    for (const c of cases) {
      const { m } = runCase(c);
      for (const t of m.trace.toArray()) if (t.kind === 'instruction' && t.bytes.length) executed.add(t.bytes[0]!);
    }
    const missing = INSTRUCTIONS.filter((d) => !executed.has(d.opcode)).map(
      (d) => `${d.mnemonic} (0x${d.opcode.toString(16)})`,
    );
    expect(missing).toEqual([]);
  });
});
