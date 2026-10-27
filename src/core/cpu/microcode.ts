/**
 * VC-8 micro-programs.
 *
 * Every instruction is a fixed list of micro-operations; each micro-operation is
 * one clock cycle and performs the register transfers named in its `rtl`.
 * Instruction stepping and micro-stepping both execute these same functions.
 *
 * Invariant (precise faults): within every instruction micro-program, all
 * architectural register/flag/SP writes happen after the last memory access
 * that could fault. Only PC advances earlier, and Cpu.fault() restores it.
 */
import { CAUSE, PSW, VECTOR, VECTOR_ABSENT, VECTOR_NAMES } from '../isa/constants';
import {
  INSTRUCTIONS,
  fieldLimit,
  type AluOp,
  type FieldKind,
  type InstructionDef,
  OPCODE_TABLE,
} from '../isa/opcodes';
import { alu, aluFlags, aluHigh, aluMask, aluWritesResult, aluY } from './alu';
import type { Cpu } from './cpu';
import { UNIT as U, type MicroOp, type MicroProgram } from './types';

function op(name: string, rtl: string, units: number, run: (c: Cpu) => void): MicroOp {
  return Object.freeze({ name, rtl, units, run });
}

const fa = (c: Cpu): number => c.opr >> 4;
const fb = (c: Cpu): number => c.opr & 0x0f;
const ALL_FLAGS = PSW.C | PSW.Z | PSW.N | PSW.V;

function validField(kind: FieldKind | null, v: number): boolean {
  return kind === null ? v === 0 : v < fieldLimit(kind);
}

const BUS_READ = U.MAR | U.ADDRESS_BUS | U.MEMORY | U.DATA_BUS | U.MDR;
const BUS_WRITE = BUS_READ;
const FETCH_UNITS = U.PC | U.ADDRESS_BUS | U.MEMORY | U.DATA_BUS | U.AGU;

// ---------------------------------------------------------------------------
// Fetch / decode / operand fetch
// ---------------------------------------------------------------------------

export const FETCH = op('FETCH', 'MAR ← PC; IR ← M[MAR]; PC ← PC + 1', FETCH_UNITS | U.MAR | U.IR, (c) => {
  c.mar = c.pc;
  const v = c.read(c.pc, 'fetch');
  if (c.faulted) return;
  c.ir = v;
  c.pc = (c.pc + 1) & 0xffff;
});

export const DECODE = op('DECODE', 'decode IR; select micro-program; check privilege', U.IR | U.DECODER, (c) => {
  const d = OPCODE_TABLE[c.ir];
  if (!d) {
    c.fault(CAUSE.ILLEGAL_INSTRUCTION);
    return;
  }
  if (d.privileged && !c.supervisor) {
    c.fault(CAUSE.PRIVILEGED_INSTRUCTION);
    return;
  }
  c.def = d;
  c.program = INSTRUCTION_PROGRAMS[c.ir]!;
});

const FETCH_REG = op(
  'FETCH REG',
  'OPR ← M[PC]; PC ← PC + 1; validate fields a, b',
  FETCH_UNITS | U.OPR | U.DECODER,
  (c) => {
    const v = c.read(c.pc, 'fetch');
    if (c.faulted) return;
    c.opr = v;
    c.pc = (c.pc + 1) & 0xffff;
    const d = c.def!;
    if (!validField(d.fieldA, v >> 4) || !validField(d.fieldB, v & 0x0f)) {
      c.fault(CAUSE.ILLEGAL_INSTRUCTION);
    }
  },
);

const FETCH_IMM8 = op('FETCH IMM', 'IMM ← M[PC]; PC ← PC + 1', FETCH_UNITS | U.IMM, (c) => {
  const v = c.read(c.pc, 'fetch');
  if (c.faulted) return;
  c.imm = v;
  c.pc = (c.pc + 1) & 0xffff;
});

const FETCH_IMM_LO = op('FETCH IMM LO', 'IMM.lo ← M[PC]; PC ← PC + 1', FETCH_UNITS | U.IMM, (c) => {
  const v = c.read(c.pc, 'fetch');
  if (c.faulted) return;
  c.imm = v;
  c.pc = (c.pc + 1) & 0xffff;
});

const FETCH_IMM_HI = op('FETCH IMM HI', 'IMM.hi ← M[PC]; PC ← PC + 1', FETCH_UNITS | U.IMM, (c) => {
  const v = c.read(c.pc, 'fetch');
  if (c.faulted) return;
  c.imm = (c.imm & 0xff) | (v << 8);
  c.pc = (c.pc + 1) & 0xffff;
});

// ---------------------------------------------------------------------------
// Generic memory micro-operations
// ---------------------------------------------------------------------------

const MEM_READ = op('MEM READ', 'MDR ← M[MAR]', BUS_READ, (c) => {
  const v = c.read(c.mar, 'read');
  if (c.faulted) return;
  c.mdr = v;
});

const MEM_WRITE = op('MEM WRITE', 'M[MAR] ← MDR', BUS_WRITE, (c) => {
  c.write(c.mar, c.mdr);
});

const READ_LO = op('MEM READ', 'MDR ← M[MAR]; T.lo ← MDR', BUS_READ | U.TMP, (c) => {
  const v = c.read(c.mar, 'read');
  if (c.faulted) return;
  c.mdr = v;
  c.t16 = (c.t16 & 0xff00) | v;
});

const READ_HI = op('MEM READ', 'MDR ← M[MAR]; T.hi ← MDR', BUS_READ | U.TMP, (c) => {
  const v = c.read(c.mar, 'read');
  if (c.faulted) return;
  c.mdr = v;
  c.t16 = (c.t16 & 0x00ff) | (v << 8);
});

const MAR_INC = op('ADDRESS', 'MAR ← MAR + 1', U.MAR | U.AGU, (c) => {
  c.mar = (c.mar + 1) & 0xffff;
});

const ADDR_ABS = op('ADDRESS', 'MAR ← IMM', U.MAR | U.IMM, (c) => {
  c.mar = c.imm;
});

const ADDR_MEM = op('ADDRESS', 'MAR ← Wb + IMM (address unit)', U.MAR | U.AGU | U.REGISTERS | U.IMM, (c) => {
  c.mar = (c.getW(fb(c)) + c.imm) & 0xffff;
});

const ADDR_ABS_ST = op('ADDRESS', 'MAR ← IMM; MDR ← Ra', U.MAR | U.IMM | U.MDR | U.REGISTERS, (c) => {
  c.mar = c.imm;
  c.mdr = c.r[fa(c)]!;
});

const ADDR_MEM_ST = op(
  'ADDRESS',
  'MAR ← Wb + IMM (address unit); MDR ← Ra',
  U.MAR | U.AGU | U.REGISTERS | U.IMM | U.MDR,
  (c) => {
    c.mar = (c.getW(fb(c)) + c.imm) & 0xffff;
    c.mdr = c.r[fa(c)]!;
  },
);

const WB_LOAD = op('WRITE BACK', 'Ra ← MDR', U.REGISTERS | U.MDR, (c) => {
  c.r[fa(c)] = c.mdr;
});

const WB_W = op('WRITE BACK', 'Wa ← T', U.REGISTERS | U.TMP, (c) => {
  c.setW(fa(c), c.t16);
});

const ADDR_ABS_STW = op(
  'ADDRESS',
  'MAR ← IMM; T ← Wa; MDR ← T.lo',
  U.MAR | U.IMM | U.REGISTERS | U.TMP | U.MDR,
  (c) => {
    c.mar = c.imm;
    c.t16 = c.getW(fa(c));
    c.mdr = c.t16 & 0xff;
  },
);

const ADDR_MEM_STW = op(
  'ADDRESS',
  'MAR ← Wb + IMM (address unit); T ← Wa; MDR ← T.lo',
  U.MAR | U.AGU | U.IMM | U.REGISTERS | U.TMP | U.MDR,
  (c) => {
    c.mar = (c.getW(fb(c)) + c.imm) & 0xffff;
    c.t16 = c.getW(fa(c));
    c.mdr = c.t16 & 0xff;
  },
);

const MAR_INC_T_HI = op('ADDRESS', 'MAR ← MAR + 1; MDR ← T.hi', U.MAR | U.AGU | U.TMP | U.MDR, (c) => {
  c.mar = (c.mar + 1) & 0xffff;
  c.mdr = c.t16 >> 8;
});

// ---------------------------------------------------------------------------
// Stack
// ---------------------------------------------------------------------------

const PUSH_ADDR = op('ADDRESS', 'MAR ← SP − 1; MDR ← Ra', U.SP | U.AGU | U.MAR | U.MDR | U.REGISTERS, (c) => {
  c.mar = (c.sp - 1) & 0xffff;
  c.mdr = c.r[fa(c)]!;
});

const SP_FROM_MAR = op('UPDATE SP', 'SP ← MAR', U.SP | U.MAR, (c) => {
  c.sp = c.mar;
});

const POP_ADDR = op('ADDRESS', 'MAR ← SP', U.SP | U.MAR, (c) => {
  c.mar = c.sp;
});

const POP_WB = op('WRITE BACK', 'SP ← MAR + 1; Ra ← MDR', U.SP | U.AGU | U.REGISTERS | U.MDR, (c) => {
  c.sp = c.mar + 1;
  c.r[fa(c)] = c.mdr;
});

const PUSHP_HI = op(
  'ADDRESS',
  'T ← Wa; MAR ← SP − 1; MDR ← T.hi',
  U.REGISTERS | U.TMP | U.SP | U.AGU | U.MAR | U.MDR,
  (c) => {
    c.t16 = c.getW(fa(c));
    c.mar = (c.sp - 1) & 0xffff;
    c.mdr = c.t16 >> 8;
  },
);

const MAR_DEC_T_LO = op('ADDRESS', 'MAR ← MAR − 1; MDR ← T.lo', U.MAR | U.AGU | U.TMP | U.MDR, (c) => {
  c.mar = (c.mar - 1) & 0xffff;
  c.mdr = c.t16 & 0xff;
});

const POPP_WB = op('WRITE BACK', 'SP ← MAR + 1; Wa ← T', U.SP | U.AGU | U.REGISTERS | U.TMP, (c) => {
  c.sp = c.mar + 1;
  c.setW(fa(c), c.t16);
});

// ---------------------------------------------------------------------------
// Register moves and control registers
// ---------------------------------------------------------------------------

const MOV_RR = op('EXECUTE', 'Ra ← Rb', U.REGISTERS, (c) => {
  c.r[fa(c)] = c.r[fb(c)]!;
});

const MOV_RI = op('WRITE BACK', 'Ra ← IMM', U.REGISTERS | U.IMM, (c) => {
  c.r[fa(c)] = c.imm & 0xff;
});

const MOVP_WW = op('EXECUTE', 'Wa ← Wb', U.REGISTERS | U.SP, (c) => {
  c.setW(fa(c), c.getW(fb(c)));
});

const MOVP_WI = op('WRITE BACK', 'Wa ← IMM', U.REGISTERS | U.IMM, (c) => {
  c.setW(fa(c), c.imm);
});

const MFC_EXEC = op('EXECUTE', 'Wa ← CRb', U.CONTROL_REGS | U.REGISTERS, (c) => {
  c.setW(fa(c), c.getCR(fb(c)));
});

const MTC_EXEC = op('EXECUTE', 'CRa ← Wb', U.CONTROL_REGS | U.REGISTERS, (c) => {
  c.setCR(fa(c), c.getW(fb(c)));
});

// ---------------------------------------------------------------------------
// 8-bit ALU
// ---------------------------------------------------------------------------

const READ_RR = op('READ REGS', 'A ← Ra; B ← Rb', U.REGISTERS | U.ALU, (c) => {
  c.a = c.r[fa(c)]!;
  c.b = c.r[fb(c)]!;
});

const READ_RI = op('READ REGS', 'A ← Ra; B ← IMM', U.REGISTERS | U.IMM | U.ALU, (c) => {
  c.a = c.r[fa(c)]!;
  c.b = c.imm & 0xff;
});

const READ_R = op('READ REGS', 'A ← Ra', U.REGISTERS | U.ALU, (c) => {
  c.a = c.r[fa(c)]!;
  c.b = 0;
});

function recordAlu(c: Cpu, name: string): void {
  c.activity.alu = { op: name, a: c.a, b: c.b, y: c.y, flags: aluFlags(c.aluPacked) };
}

const ALU_EXEC = op('ALU', "Y ← A op B; FLAGS' ← computed flags", U.ALU, (c) => {
  const o = c.def!.aluOp!;
  c.aluPacked = alu(o, c.a, c.b, c.psw & PSW.C);
  c.y = aluY(c.aluPacked);
  recordAlu(c, o);
});

function commitFlags(c: Cpu): void {
  const m = aluMask(c.aluPacked);
  c.psw = (c.psw & ~m) | (aluFlags(c.aluPacked) & m);
}

const ALU_WB = op('WRITE BACK', "Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'", U.REGISTERS | U.FLAGS, (c) => {
  if (aluWritesResult(c.def!.aluOp!)) c.r[fa(c)] = c.y;
  commitFlags(c);
});

// ---------------------------------------------------------------------------
// 16-bit arithmetic (two passes through the 8-bit ALU)
// ---------------------------------------------------------------------------

function isSub16(d: InstructionDef): boolean {
  return d.family === 'subp_ww' || d.family === 'cmpp_ww' || d.family === 'cmpp_wi';
}
function writes16(d: InstructionDef): boolean {
  return d.family !== 'cmpp_ww' && d.family !== 'cmpp_wi';
}

const READ16_LO_WW = op('READ REGS', 'A ← Wa.lo; B ← Wb.lo', U.REGISTERS | U.SP | U.ALU, (c) => {
  c.a = c.getW(fa(c)) & 0xff;
  c.b = c.getW(fb(c)) & 0xff;
});
const READ16_LO_WI = op('READ REGS', 'A ← Wa.lo; B ← IMM.lo', U.REGISTERS | U.SP | U.IMM | U.ALU, (c) => {
  c.a = c.getW(fa(c)) & 0xff;
  c.b = c.imm & 0xff;
});
const READ16_LO_WR = op('READ REGS', 'A ← Wa.lo; B ← Rb', U.REGISTERS | U.SP | U.ALU, (c) => {
  c.a = c.getW(fa(c)) & 0xff;
  c.b = c.r[fb(c)]!;
});

const ALU16_LO = op('ALU', 'Y ← A ± B (low byte); Cint ← carry/borrow', U.ALU, (c) => {
  const o: AluOp = isSub16(c.def!) ? 'SUB' : 'ADD';
  c.aluPacked = alu(o, c.a, c.b, 0);
  c.y = aluY(c.aluPacked);
  c.cint = aluFlags(c.aluPacked) & PSW.C;
  c.zlo = c.y === 0;
  recordAlu(c, `${o} (low)`);
});

const READ16_HI_WW = op('READ REGS', 'T.lo ← Y; A ← Wa.hi; B ← Wb.hi', U.REGISTERS | U.SP | U.ALU | U.TMP, (c) => {
  c.t16 = c.y;
  c.a = c.getW(fa(c)) >> 8;
  c.b = c.getW(fb(c)) >> 8;
});
const READ16_HI_WI = op(
  'READ REGS',
  'T.lo ← Y; A ← Wa.hi; B ← IMM.hi',
  U.REGISTERS | U.SP | U.IMM | U.ALU | U.TMP,
  (c) => {
    c.t16 = c.y;
    c.a = c.getW(fa(c)) >> 8;
    c.b = c.imm >> 8;
  },
);
const READ16_HI_WR = op('READ REGS', 'T.lo ← Y; A ← Wa.hi; B ← 0', U.REGISTERS | U.SP | U.ALU | U.TMP, (c) => {
  c.t16 = c.y;
  c.a = c.getW(fa(c)) >> 8;
  c.b = 0;
});

const ALU16_HI = op('ALU', "Y ← A ± B ± Cint (high byte); FLAGS' ← 16-bit flags", U.ALU, (c) => {
  const sub = isSub16(c.def!);
  c.aluPacked = aluHigh(sub ? 'sub' : 'add', c.a, c.b, c.cint, c.zlo);
  c.y = aluY(c.aluPacked);
  recordAlu(c, sub ? 'SBC (high)' : 'ADC (high)');
});

const WB16 = op('WRITE BACK', "Wa ← {Y, T.lo} (unless CMPP); PSW flags ← FLAGS'", U.REGISTERS | U.SP | U.FLAGS, (c) => {
  if (writes16(c.def!)) c.setW(fa(c), (c.y << 8) | (c.t16 & 0xff));
  c.psw = (c.psw & ~ALL_FLAGS) | aluFlags(c.aluPacked);
});

const INCP_EXEC = op('EXECUTE', 'T ← Wa + 1 (incrementer)', U.REGISTERS | U.SP | U.AGU | U.TMP, (c) => {
  c.t16 = (c.getW(fa(c)) + 1) & 0xffff;
});
const DECP_EXEC = op('EXECUTE', 'T ← Wa − 1 (incrementer)', U.REGISTERS | U.SP | U.AGU | U.TMP, (c) => {
  c.t16 = (c.getW(fa(c)) - 1) & 0xffff;
});
const WB16_Z = op('WRITE BACK', 'Wa ← T; Z ← (T = 0)', U.REGISTERS | U.SP | U.TMP | U.FLAGS, (c) => {
  c.setW(fa(c), c.t16);
  c.psw = c.t16 === 0 ? c.psw | PSW.Z : c.psw & ~PSW.Z;
});

// ---------------------------------------------------------------------------
// Control flow
// ---------------------------------------------------------------------------

export function conditionHolds(cond: number, psw: number): boolean {
  const c = (psw & PSW.C) !== 0;
  const z = (psw & PSW.Z) !== 0;
  const n = (psw & PSW.N) !== 0;
  const v = (psw & PSW.V) !== 0;
  switch (cond) {
    case 0:
      return true;
    case 1:
      return z;
    case 2:
      return !z;
    case 3:
      return c;
    case 4:
      return !c;
    case 5:
      return n;
    case 6:
      return !n;
    case 7:
      return v;
    case 8:
      return !v;
    case 9:
      return n !== v;
    case 10:
      return n === v;
    case 11:
      return !z && n === v;
    case 12:
      return z || n !== v;
    case 13:
      return !c && !z;
    case 14:
      return c || z;
    default:
      return false;
  }
}

const BRANCH = op('BRANCH', 'if condition(PSW): PC ← IMM', U.FLAGS | U.PC | U.IMM | U.DECODER, (c) => {
  if (conditionHolds(c.def!.cond!, c.psw)) c.pc = c.imm;
  else c.activity.units &= ~U.PC; // not taken: PC keeps its value
});

const JMP_W = op('EXECUTE', 'PC ← Wa', U.PC | U.REGISTERS | U.SP, (c) => {
  c.pc = c.getW(fa(c));
});

const CALL_PUSH_HI = op('ADDRESS', 'MAR ← SP − 1; MDR ← PC.hi', U.SP | U.AGU | U.MAR | U.MDR | U.PC, (c) => {
  c.mar = (c.sp - 1) & 0xffff;
  c.mdr = c.pc >> 8;
});

const CALLW_PUSH_HI = op(
  'ADDRESS',
  'T ← Wa; MAR ← SP − 1; MDR ← PC.hi',
  U.REGISTERS | U.TMP | U.SP | U.AGU | U.MAR | U.MDR | U.PC,
  (c) => {
    c.t16 = c.getW(fa(c));
    c.mar = (c.sp - 1) & 0xffff;
    c.mdr = c.pc >> 8;
  },
);

const CALL_PUSH_LO = op('ADDRESS', 'MAR ← MAR − 1; MDR ← PC.lo', U.MAR | U.AGU | U.MDR | U.PC, (c) => {
  c.mar = (c.mar - 1) & 0xffff;
  c.mdr = c.pc & 0xff;
});

const CALL_FINISH = op('EXECUTE', 'SP ← MAR; PC ← IMM', U.SP | U.MAR | U.PC | U.IMM, (c) => {
  c.sp = c.mar;
  c.pc = c.imm;
});

const CALLW_FINISH = op('EXECUTE', 'SP ← MAR; PC ← T', U.SP | U.MAR | U.PC | U.TMP, (c) => {
  c.sp = c.mar;
  c.pc = c.t16;
});

const RET_FINISH = op('EXECUTE', 'SP ← MAR + 1; PC ← T', U.SP | U.AGU | U.PC | U.TMP, (c) => {
  c.sp = c.mar + 1;
  c.pc = c.t16;
});

const READ_PSW = op('MEM READ', 'MDR ← M[MAR]; TMP ← MDR', BUS_READ | U.TMP, (c) => {
  const v = c.read(c.mar, 'read');
  if (c.faulted) return;
  c.mdr = v;
  c.tmp = v;
});

const RTI_FINISH = op(
  'EXECUTE',
  'SP ← MAR + 1; PSW ← TMP (may switch to user mode/USP); PC ← T',
  U.SP | U.AGU | U.PC | U.TMP | U.FLAGS | U.INTERRUPTS,
  (c) => {
    c.sp = c.mar + 1;
    c.setPsw(c.tmp);
    c.pc = c.t16;
  },
);

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

const HALT = op('EXECUTE', 'enter waiting state (sleep until an enabled IRQ is pending)', U.INTERRUPTS, (c) => {
  c.status = 'waiting';
});

const TRAP_SYS = op('EXECUTE', 'raise SYSCALL trap (vector 4)', U.INTERRUPTS, (c) => {
  c.trap(CAUSE.SYSCALL);
});

const TRAP_BRK = op('EXECUTE', 'raise BREAKPOINT trap (vector 5)', U.INTERRUPTS, (c) => {
  c.trap(CAUSE.BREAKPOINT);
});

const CLI_EXEC = op('EXECUTE', 'PSW.I ← 0', U.FLAGS | U.INTERRUPTS, (c) => {
  c.psw &= ~PSW.I;
});
const STI_EXEC = op('EXECUTE', 'PSW.I ← 1', U.FLAGS | U.INTERRUPTS, (c) => {
  c.psw |= PSW.I;
});
const CLC_EXEC = op('EXECUTE', 'PSW.C ← 0', U.FLAGS, (c) => {
  c.psw &= ~PSW.C;
});
const SEC_EXEC = op('EXECUTE', 'PSW.C ← 1', U.FLAGS, (c) => {
  c.psw |= PSW.C;
});

// ---------------------------------------------------------------------------
// Family → micro-operations (after FETCH and DECODE)
// ---------------------------------------------------------------------------

function familyOps(d: InstructionDef): MicroOp[] {
  switch (d.family) {
    case 'nop':
      return [];
    case 'hlt':
      return [HALT];
    case 'sys':
      return [TRAP_SYS];
    case 'brk':
      return [TRAP_BRK];
    case 'cli':
      return [CLI_EXEC];
    case 'sti':
      return [STI_EXEC];
    case 'clc':
      return [CLC_EXEC];
    case 'sec':
      return [SEC_EXEC];
    case 'rti':
      return [POP_ADDR, READ_PSW, MAR_INC, READ_LO, MAR_INC, READ_HI, RTI_FINISH];
    case 'ret':
      return [POP_ADDR, READ_LO, MAR_INC, READ_HI, RET_FINISH];
    case 'mov_rr':
      return [FETCH_REG, MOV_RR];
    case 'mov_ri':
      return [FETCH_REG, FETCH_IMM8, MOV_RI];
    case 'ld_abs':
      return [FETCH_REG, FETCH_IMM_LO, FETCH_IMM_HI, ADDR_ABS, MEM_READ, WB_LOAD];
    case 'ld_mem':
      return [FETCH_REG, FETCH_IMM8, ADDR_MEM, MEM_READ, WB_LOAD];
    case 'st_abs':
      return [FETCH_REG, FETCH_IMM_LO, FETCH_IMM_HI, ADDR_ABS_ST, MEM_WRITE];
    case 'st_mem':
      return [FETCH_REG, FETCH_IMM8, ADDR_MEM_ST, MEM_WRITE];
    case 'push':
      return [FETCH_REG, PUSH_ADDR, MEM_WRITE, SP_FROM_MAR];
    case 'pop':
      return [FETCH_REG, POP_ADDR, MEM_READ, POP_WB];
    case 'movp_ww':
      return [FETCH_REG, MOVP_WW];
    case 'movp_wi':
      return [FETCH_REG, FETCH_IMM_LO, FETCH_IMM_HI, MOVP_WI];
    case 'ldw_abs':
      return [FETCH_REG, FETCH_IMM_LO, FETCH_IMM_HI, ADDR_ABS, READ_LO, MAR_INC, READ_HI, WB_W];
    case 'ldw_mem':
      return [FETCH_REG, FETCH_IMM8, ADDR_MEM, READ_LO, MAR_INC, READ_HI, WB_W];
    case 'stw_abs':
      return [FETCH_REG, FETCH_IMM_LO, FETCH_IMM_HI, ADDR_ABS_STW, MEM_WRITE, MAR_INC_T_HI, MEM_WRITE];
    case 'stw_mem':
      return [FETCH_REG, FETCH_IMM8, ADDR_MEM_STW, MEM_WRITE, MAR_INC_T_HI, MEM_WRITE];
    case 'pushp':
      return [FETCH_REG, PUSHP_HI, MEM_WRITE, MAR_DEC_T_LO, MEM_WRITE, SP_FROM_MAR];
    case 'popp':
      return [FETCH_REG, POP_ADDR, READ_LO, MAR_INC, READ_HI, POPP_WB];
    case 'mfc':
      return [FETCH_REG, MFC_EXEC];
    case 'mtc':
      return [FETCH_REG, MTC_EXEC];
    case 'alu_rr':
      return [FETCH_REG, READ_RR, ALU_EXEC, ALU_WB];
    case 'alu_ri':
      return [FETCH_REG, FETCH_IMM8, READ_RI, ALU_EXEC, ALU_WB];
    case 'alu_r':
      return [FETCH_REG, READ_R, ALU_EXEC, ALU_WB];
    case 'incp':
      return [FETCH_REG, INCP_EXEC, WB16_Z];
    case 'decp':
      return [FETCH_REG, DECP_EXEC, WB16_Z];
    case 'addp_ww':
    case 'subp_ww':
    case 'cmpp_ww':
      return [FETCH_REG, READ16_LO_WW, ALU16_LO, READ16_HI_WW, ALU16_HI, WB16];
    case 'addp_wi':
    case 'cmpp_wi':
      return [FETCH_REG, FETCH_IMM_LO, FETCH_IMM_HI, READ16_LO_WI, ALU16_LO, READ16_HI_WI, ALU16_HI, WB16];
    case 'addp_wr':
      return [FETCH_REG, READ16_LO_WR, ALU16_LO, READ16_HI_WR, ALU16_HI, WB16];
    case 'jcc':
      return [FETCH_IMM_LO, FETCH_IMM_HI, BRANCH];
    case 'jmp_w':
      return [FETCH_REG, JMP_W];
    case 'call_abs':
      return [FETCH_IMM_LO, FETCH_IMM_HI, CALL_PUSH_HI, MEM_WRITE, CALL_PUSH_LO, MEM_WRITE, CALL_FINISH];
    case 'call_w':
      return [FETCH_REG, CALLW_PUSH_HI, MEM_WRITE, CALL_PUSH_LO, MEM_WRITE, CALLW_FINISH];
  }
}

/** Full micro-program per opcode (undefined for illegal opcodes). */
export const INSTRUCTION_PROGRAMS: readonly (MicroProgram | undefined)[] = (() => {
  const t: (MicroProgram | undefined)[] = new Array(256).fill(undefined);
  for (const d of INSTRUCTIONS) {
    t[d.opcode] = Object.freeze({
      id: `op:${d.opcode.toString(16).padStart(2, '0')}`,
      kind: 'instruction',
      ops: Object.freeze([FETCH, DECODE, ...familyOps(d)]),
    });
  }
  return t;
})();

/** Every instruction starts with FETCH + DECODE; DECODE swaps in the opcode's full program. */
export const PREFIX_PROGRAM: MicroProgram = Object.freeze({
  id: 'prefix',
  kind: 'instruction',
  ops: Object.freeze([FETCH, DECODE]),
});

// ---------------------------------------------------------------------------
// Hardware sequences: reset, exception entry, idle
// ---------------------------------------------------------------------------

const RESET_ADDR = op('RESET', 'MAR ← 0x0000 (reset vector)', U.MAR, (c) => {
  c.mar = 0x0000;
});

const RESET_FINISH = op('RESET', 'PC ← T (reset vector)', U.PC | U.TMP, (c) => {
  if (c.t16 === VECTOR_ABSENT) {
    c.machineCheck('no reset vector: ROM location 0x0000 is unprogrammed (0xFFFF)');
    return;
  }
  c.pc = c.t16;
});

export const RESET_PROGRAM: MicroProgram = Object.freeze({
  id: 'reset',
  kind: 'reset',
  ops: Object.freeze([RESET_ADDR, READ_LO, MAR_INC, READ_HI, RESET_FINISH]),
});

const EXC_ENTER = op(
  'EXC ENTER',
  'TMP ← PSW; CAUSE ← code; PSW.S ← 1 (select KSP); PSW.I ← 0',
  U.TMP | U.FLAGS | U.CONTROL_REGS | U.SP | U.INTERRUPTS,
  (c) => {
    const e = c.exception!;
    c.inEntry = true;
    c.tmp = c.psw;
    c.cause = e.cause;
    if (e.vector === VECTOR.MEMORY) c.faddr = e.faddr;
    c.psw = (c.psw | PSW.S) & ~PSW.I;
  },
);

const EXC_PUSH_PSW = op('ADDRESS', 'MAR ← MAR − 1; MDR ← TMP (old PSW)', U.MAR | U.AGU | U.TMP | U.MDR, (c) => {
  c.mar = (c.mar - 1) & 0xffff;
  c.mdr = c.tmp;
});

const EXC_VECTOR_ADDR = op(
  'ADDRESS',
  'SP ← MAR; MAR ← VBASE + 2 × vector',
  U.SP | U.MAR | U.AGU | U.CONTROL_REGS,
  (c) => {
    c.sp = c.mar;
    c.mar = (c.vbase + 2 * c.exception!.vector) & 0xffff;
  },
);

const EXC_FINISH = op('EXC JUMP', 'PC ← T (handler address)', U.PC | U.TMP, (c) => {
  const v = c.exception!.vector;
  c.exception = null;
  c.inEntry = false;
  if (c.t16 === VECTOR_ABSENT) {
    c.machineCheck(`unhandled exception: vector ${v} (${VECTOR_NAMES[v]}) has no handler installed`);
    return;
  }
  c.pc = c.t16;
});

export const EXCEPTION_PROGRAM: MicroProgram = Object.freeze({
  id: 'exception',
  kind: 'exception',
  ops: Object.freeze([
    EXC_ENTER,
    CALL_PUSH_HI,
    MEM_WRITE,
    CALL_PUSH_LO,
    MEM_WRITE,
    EXC_PUSH_PSW,
    MEM_WRITE,
    EXC_VECTOR_ADDR,
    READ_LO,
    MAR_INC,
    READ_HI,
    EXC_FINISH,
  ]),
});

const IDLE = op('IDLE', 'waiting for an enabled interrupt line (no fetch)', U.INTERRUPTS, () => {});

export const IDLE_PROGRAM: MicroProgram = Object.freeze({
  id: 'idle',
  kind: 'idle',
  ops: Object.freeze([IDLE]),
});

export function programById(id: string): MicroProgram {
  switch (id) {
    case 'prefix':
      return PREFIX_PROGRAM;
    case 'reset':
      return RESET_PROGRAM;
    case 'exception':
      return EXCEPTION_PROGRAM;
    case 'idle':
      return IDLE_PROGRAM;
  }
  const m = /^op:([0-9a-f]{2})$/.exec(id);
  const p = m ? INSTRUCTION_PROGRAMS[parseInt(m[1]!, 16)] : undefined;
  if (!p) throw new Error(`unknown micro-program id: ${id}`);
  return p;
}

/** Number of cycles an instruction takes (= micro-operations). */
export function cyclesFor(opcode: number): number {
  return INSTRUCTION_PROGRAMS[opcode]?.ops.length ?? 0;
}
