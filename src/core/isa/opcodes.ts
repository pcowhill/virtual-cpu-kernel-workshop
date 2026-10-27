/**
 * Machine-readable VC-8 instruction table.
 *
 * This table is the single source of truth for opcode numbers, operand syntax,
 * encodings, lengths, flag effects and privilege. The assembler, disassembler,
 * CPU decoder, generated documentation and in-app reference all consume it.
 * Execution semantics live in the CPU micro-programs (src/core/cpu/microcode.ts),
 * keyed by `family`.
 */

/** Kind of a 4-bit register field in the register byte. */
export type FieldKind = 'R' | 'W' | 'CR';

/** How an assembly operand maps onto the encoding. */
export type OperandSyntax =
  | { kind: 'reg'; field: 'a' | 'b' } // R0..R7
  | { kind: 'wide'; field: 'a' | 'b' } // P0..P3 or SP
  | { kind: 'cr'; field: 'a' | 'b' } // PSW, USP, ...
  | { kind: 'imm8' } // #expr (8-bit)
  | { kind: 'imm16' } // #expr (16-bit)
  | { kind: 'abs' } // [expr]  (16-bit address)
  | { kind: 'mem'; base: 'b' } // [W+expr] (8-bit unsigned offset)
  | { kind: 'addr' }; // expr (16-bit jump target)

export type ImmKind = 'i8' | 'i16';

export type AluOp =
  | 'ADD'
  | 'ADC'
  | 'SUB'
  | 'SBC'
  | 'CMP'
  | 'AND'
  | 'OR'
  | 'XOR'
  | 'INC'
  | 'DEC'
  | 'NOT'
  | 'NEG'
  | 'SHL'
  | 'SHR'
  | 'SAR'
  | 'ROL'
  | 'ROR'
  | 'TST';

export type Family =
  | 'nop'
  | 'hlt'
  | 'sys'
  | 'brk'
  | 'rti'
  | 'ret'
  | 'cli'
  | 'sti'
  | 'clc'
  | 'sec'
  | 'mov_rr'
  | 'mov_ri'
  | 'ld_abs'
  | 'ld_mem'
  | 'st_abs'
  | 'st_mem'
  | 'push'
  | 'pop'
  | 'movp_ww'
  | 'movp_wi'
  | 'ldw_abs'
  | 'ldw_mem'
  | 'stw_abs'
  | 'stw_mem'
  | 'pushp'
  | 'popp'
  | 'mfc'
  | 'mtc'
  | 'alu_rr'
  | 'alu_ri'
  | 'alu_r'
  | 'incp'
  | 'decp'
  | 'addp_ww'
  | 'addp_wi'
  | 'addp_wr'
  | 'subp_ww'
  | 'cmpp_ww'
  | 'cmpp_wi'
  | 'jcc'
  | 'jmp_w'
  | 'call_abs'
  | 'call_w';

export type Group =
  | 'System and control'
  | 'Data movement'
  | 'Stack'
  | '16-bit data movement'
  | 'Privileged control registers'
  | '8-bit arithmetic and logic'
  | '8-bit unary and shifts'
  | '16-bit arithmetic'
  | 'Control flow';

export interface InstructionDef {
  opcode: number;
  mnemonic: string;
  aliases: readonly string[];
  operands: readonly OperandSyntax[];
  fieldA: FieldKind | null;
  fieldB: FieldKind | null;
  imm: ImmKind | null;
  length: number;
  family: Family;
  aluOp: AluOp | null;
  cond: number | null;
  privileged: boolean;
  /** Flags written, as a subset of "CZNV" ('-' = none). */
  flags: string;
  group: Group;
  summary: string;
  /** Register-transfer description of the architectural effect. */
  rtl: string;
  /** Additional notes: errors, edge cases. */
  notes: string;
}

interface DefInput {
  opcode: number;
  mnemonic: string;
  aliases?: string[];
  operands?: OperandSyntax[];
  a?: FieldKind;
  b?: FieldKind;
  imm?: ImmKind;
  family: Family;
  aluOp?: AluOp;
  cond?: number;
  privileged?: boolean;
  flags?: string;
  group: Group;
  summary: string;
  rtl: string;
  notes?: string;
}

function def(d: DefInput): InstructionDef {
  const hasRegByte = d.a !== undefined || d.b !== undefined;
  const length = 1 + (hasRegByte ? 1 : 0) + (d.imm === 'i8' ? 1 : d.imm === 'i16' ? 2 : 0);
  return {
    opcode: d.opcode,
    mnemonic: d.mnemonic,
    aliases: d.aliases ?? [],
    operands: d.operands ?? [],
    fieldA: d.a ?? null,
    fieldB: d.b ?? null,
    imm: d.imm ?? null,
    length,
    family: d.family,
    aluOp: d.aluOp ?? null,
    cond: d.cond ?? null,
    privileged: d.privileged ?? false,
    flags: d.flags ?? '-',
    group: d.group,
    summary: d.summary,
    rtl: d.rtl,
    notes: d.notes ?? '',
  };
}

const rA = { kind: 'reg', field: 'a' } as const;
const rB = { kind: 'reg', field: 'b' } as const;
const wA = { kind: 'wide', field: 'a' } as const;
const wB = { kind: 'wide', field: 'b' } as const;
const crA = { kind: 'cr', field: 'a' } as const;
const crB = { kind: 'cr', field: 'b' } as const;
const imm8 = { kind: 'imm8' } as const;
const imm16 = { kind: 'imm16' } as const;
const abs = { kind: 'abs' } as const;
const mem = { kind: 'mem', base: 'b' } as const;
const addr = { kind: 'addr' } as const;

const SYS: Group = 'System and control';

const ALU_BINARY: { op: AluOp; summary: string; rtl: string; rtlImm: string; flags: string }[] = [
  { op: 'ADD', summary: 'Add', rtl: 'Ra ← Ra + Rb', rtlImm: 'Ra ← Ra + imm8', flags: 'CZNV' },
  {
    op: 'ADC',
    summary: 'Add with carry',
    rtl: 'Ra ← Ra + Rb + C',
    rtlImm: 'Ra ← Ra + imm8 + C',
    flags: 'CZNV',
  },
  {
    op: 'SUB',
    summary: 'Subtract (C = borrow)',
    rtl: 'Ra ← Ra − Rb',
    rtlImm: 'Ra ← Ra − imm8',
    flags: 'CZNV',
  },
  {
    op: 'SBC',
    summary: 'Subtract with borrow',
    rtl: 'Ra ← Ra − Rb − C',
    rtlImm: 'Ra ← Ra − imm8 − C',
    flags: 'CZNV',
  },
  {
    op: 'CMP',
    summary: 'Compare (subtract, discard result)',
    rtl: 'flags ← Ra − Rb',
    rtlImm: 'flags ← Ra − imm8',
    flags: 'CZNV',
  },
  { op: 'AND', summary: 'Bitwise AND', rtl: 'Ra ← Ra & Rb', rtlImm: 'Ra ← Ra & imm8', flags: 'CZNV' },
  { op: 'OR', summary: 'Bitwise OR', rtl: 'Ra ← Ra | Rb', rtlImm: 'Ra ← Ra | imm8', flags: 'CZNV' },
  { op: 'XOR', summary: 'Bitwise XOR', rtl: 'Ra ← Ra ^ Rb', rtlImm: 'Ra ← Ra ^ imm8', flags: 'CZNV' },
];

const ALU_UNARY: { op: AluOp; summary: string; rtl: string; flags: string }[] = [
  { op: 'INC', summary: 'Increment', rtl: 'Ra ← Ra + 1', flags: 'ZNV' },
  { op: 'DEC', summary: 'Decrement', rtl: 'Ra ← Ra − 1', flags: 'ZNV' },
  { op: 'NOT', summary: "Bitwise NOT (one's complement)", rtl: 'Ra ← ~Ra', flags: 'CZNV' },
  { op: 'NEG', summary: "Negate (two's complement)", rtl: 'Ra ← 0 − Ra', flags: 'CZNV' },
  { op: 'SHL', summary: 'Shift left', rtl: 'C ← Ra[7]; Ra ← Ra << 1', flags: 'CZNV' },
  { op: 'SHR', summary: 'Logical shift right', rtl: 'C ← Ra[0]; Ra ← Ra >> 1', flags: 'CZNV' },
  {
    op: 'SAR',
    summary: 'Arithmetic shift right',
    rtl: 'C ← Ra[0]; Ra ← (Ra >> 1) | Ra[7]',
    flags: 'CZNV',
  },
  {
    op: 'ROL',
    summary: 'Rotate left through carry',
    rtl: '{C, Ra} ← {Ra, C} (9-bit rotate)',
    flags: 'CZNV',
  },
  {
    op: 'ROR',
    summary: 'Rotate right through carry',
    rtl: '{Ra, C} ← {C, Ra} (9-bit rotate)',
    flags: 'CZNV',
  },
  { op: 'TST', summary: 'Test register (set Z, N)', rtl: 'flags ← Ra', flags: 'CZNV' },
];

export const CONDITIONS: readonly { code: number; mnemonic: string; aliases: string[]; test: string }[] = [
  { code: 0, mnemonic: 'JMP', aliases: [], test: 'always' },
  { code: 1, mnemonic: 'JEQ', aliases: ['JZ'], test: 'Z = 1' },
  { code: 2, mnemonic: 'JNE', aliases: ['JNZ'], test: 'Z = 0' },
  { code: 3, mnemonic: 'JCS', aliases: ['JLTU', 'JC'], test: 'C = 1 (unsigned <)' },
  { code: 4, mnemonic: 'JCC', aliases: ['JGEU', 'JNC'], test: 'C = 0 (unsigned ≥)' },
  { code: 5, mnemonic: 'JMI', aliases: [], test: 'N = 1' },
  { code: 6, mnemonic: 'JPL', aliases: [], test: 'N = 0' },
  { code: 7, mnemonic: 'JVS', aliases: [], test: 'V = 1' },
  { code: 8, mnemonic: 'JVC', aliases: [], test: 'V = 0' },
  { code: 9, mnemonic: 'JLT', aliases: [], test: 'N ≠ V (signed <)' },
  { code: 10, mnemonic: 'JGE', aliases: [], test: 'N = V (signed ≥)' },
  { code: 11, mnemonic: 'JGT', aliases: [], test: 'Z = 0 and N = V (signed >)' },
  { code: 12, mnemonic: 'JLE', aliases: [], test: 'Z = 1 or N ≠ V (signed ≤)' },
  { code: 13, mnemonic: 'JGTU', aliases: [], test: 'C = 0 and Z = 0 (unsigned >)' },
  { code: 14, mnemonic: 'JLEU', aliases: [], test: 'C = 1 or Z = 1 (unsigned ≤)' },
];

function buildTable(): InstructionDef[] {
  const t: InstructionDef[] = [];
  const add = (d: DefInput) => t.push(def(d));

  // ---- System and control -------------------------------------------------
  add({ opcode: 0x01, mnemonic: 'NOP', family: 'nop', group: SYS, summary: 'No operation', rtl: '—' });
  add({
    opcode: 0x02,
    mnemonic: 'HLT',
    family: 'hlt',
    privileged: true,
    group: SYS,
    summary: 'Halt until an enabled interrupt line is pending',
    rtl: 'state ← waiting',
    notes:
      'Wakes when (PENDING & MASK) ≠ 0 regardless of PSW.I. If PSW.I = 1 the interrupt is then taken; otherwise execution continues after HLT.',
  });
  add({
    opcode: 0x03,
    mnemonic: 'SYS',
    family: 'sys',
    group: SYS,
    summary: 'System call (software trap, vector 4)',
    rtl: 'trap(SYSCALL); saved PC = next instruction',
  });
  add({
    opcode: 0x04,
    mnemonic: 'BRK',
    family: 'brk',
    group: SYS,
    summary: 'Breakpoint trap (vector 5)',
    rtl: 'trap(BREAKPOINT); saved PC = next instruction',
  });
  add({
    opcode: 0x05,
    mnemonic: 'RTI',
    family: 'rti',
    privileged: true,
    flags: 'CZNV',
    group: SYS,
    summary: 'Return from interrupt/exception',
    rtl: 'PSW ← pop; PC.lo ← pop; PC.hi ← pop',
    notes: 'Restores the whole PSW, including S and I; returning with S = 0 switches to USP.',
  });
  add({
    opcode: 0x06,
    mnemonic: 'RET',
    family: 'ret',
    group: 'Control flow',
    summary: 'Return from subroutine',
    rtl: 'PC.lo ← pop; PC.hi ← pop',
  });
  add({
    opcode: 0x07,
    mnemonic: 'CLI',
    family: 'cli',
    privileged: true,
    group: SYS,
    summary: 'Disable maskable interrupts',
    rtl: 'PSW.I ← 0',
  });
  add({
    opcode: 0x08,
    mnemonic: 'STI',
    family: 'sti',
    privileged: true,
    group: SYS,
    summary: 'Enable maskable interrupts',
    rtl: 'PSW.I ← 1',
  });
  add({
    opcode: 0x09,
    mnemonic: 'CLC',
    family: 'clc',
    flags: 'C',
    group: SYS,
    summary: 'Clear carry',
    rtl: 'C ← 0',
  });
  add({
    opcode: 0x0a,
    mnemonic: 'SEC',
    family: 'sec',
    flags: 'C',
    group: SYS,
    summary: 'Set carry',
    rtl: 'C ← 1',
  });

  // ---- 8-bit data movement ----------------------------------------------------
  const DM: Group = 'Data movement';
  add({
    opcode: 0x10,
    mnemonic: 'MOV',
    operands: [rA, rB],
    a: 'R',
    b: 'R',
    family: 'mov_rr',
    group: DM,
    summary: 'Copy register',
    rtl: 'Ra ← Rb',
  });
  add({
    opcode: 0x11,
    mnemonic: 'MOV',
    operands: [rA, imm8],
    a: 'R',
    imm: 'i8',
    family: 'mov_ri',
    group: DM,
    summary: 'Load immediate byte',
    rtl: 'Ra ← imm8',
  });
  add({
    opcode: 0x12,
    mnemonic: 'LD',
    operands: [rA, abs],
    a: 'R',
    imm: 'i16',
    family: 'ld_abs',
    group: DM,
    summary: 'Load byte from absolute address',
    rtl: 'Ra ← M[addr16]',
    notes: 'Memory fault if the access is not permitted.',
  });
  add({
    opcode: 0x13,
    mnemonic: 'LD',
    operands: [rA, mem],
    a: 'R',
    b: 'W',
    imm: 'i8',
    family: 'ld_mem',
    group: DM,
    summary: 'Load byte from base register + offset',
    rtl: 'Ra ← M[Wb + off8]',
    notes: 'Offset is unsigned (0–255); the address wraps modulo 65 536.',
  });
  add({
    opcode: 0x14,
    mnemonic: 'ST',
    operands: [abs, rA],
    a: 'R',
    imm: 'i16',
    family: 'st_abs',
    group: DM,
    summary: 'Store byte to absolute address',
    rtl: 'M[addr16] ← Ra',
    notes: 'Memory fault if the access is not permitted (ROM is never writable).',
  });
  add({
    opcode: 0x15,
    mnemonic: 'ST',
    operands: [mem, rA],
    a: 'R',
    b: 'W',
    imm: 'i8',
    family: 'st_mem',
    group: DM,
    summary: 'Store byte to base register + offset',
    rtl: 'M[Wb + off8] ← Ra',
  });

  // ---- Stack ------------------------------------------------------------------
  const ST: Group = 'Stack';
  add({
    opcode: 0x16,
    mnemonic: 'PUSH',
    operands: [rA],
    a: 'R',
    family: 'push',
    group: ST,
    summary: 'Push byte',
    rtl: 'SP ← SP − 1; M[SP] ← Ra',
  });
  add({
    opcode: 0x17,
    mnemonic: 'POP',
    operands: [rA],
    a: 'R',
    family: 'pop',
    group: ST,
    summary: 'Pop byte',
    rtl: 'Ra ← M[SP]; SP ← SP + 1',
  });

  // ---- 16-bit data movement ------------------------------------------------------
  const DM16: Group = '16-bit data movement';
  add({
    opcode: 0x18,
    mnemonic: 'MOVP',
    operands: [wA, wB],
    a: 'W',
    b: 'W',
    family: 'movp_ww',
    group: DM16,
    summary: 'Copy 16-bit register (pairs or SP)',
    rtl: 'Wa ← Wb',
  });
  add({
    opcode: 0x19,
    mnemonic: 'MOVP',
    operands: [wA, imm16],
    a: 'W',
    imm: 'i16',
    family: 'movp_wi',
    group: DM16,
    summary: 'Load 16-bit immediate',
    rtl: 'Wa ← imm16',
  });
  add({
    opcode: 0x1a,
    mnemonic: 'LDW',
    operands: [wA, abs],
    a: 'W',
    imm: 'i16',
    family: 'ldw_abs',
    group: DM16,
    summary: 'Load 16-bit word (little-endian) from absolute address',
    rtl: 'Wa.lo ← M[addr]; Wa.hi ← M[addr+1]',
  });
  add({
    opcode: 0x1b,
    mnemonic: 'LDW',
    operands: [wA, mem],
    a: 'W',
    b: 'W',
    imm: 'i8',
    family: 'ldw_mem',
    group: DM16,
    summary: 'Load 16-bit word from base register + offset',
    rtl: 'Wa.lo ← M[Wb+off]; Wa.hi ← M[Wb+off+1]',
  });
  add({
    opcode: 0x1c,
    mnemonic: 'STW',
    operands: [abs, wA],
    a: 'W',
    imm: 'i16',
    family: 'stw_abs',
    group: DM16,
    summary: 'Store 16-bit word to absolute address',
    rtl: 'M[addr] ← Wa.lo; M[addr+1] ← Wa.hi',
    notes: 'If the second byte faults, the first byte has already been written.',
  });
  add({
    opcode: 0x1d,
    mnemonic: 'STW',
    operands: [mem, wA],
    a: 'W',
    b: 'W',
    imm: 'i8',
    family: 'stw_mem',
    group: DM16,
    summary: 'Store 16-bit word to base register + offset',
    rtl: 'M[Wb+off] ← Wa.lo; M[Wb+off+1] ← Wa.hi',
    notes: 'If the second byte faults, the first byte has already been written.',
  });
  add({
    opcode: 0x1e,
    mnemonic: 'PUSHP',
    operands: [wA],
    a: 'W',
    family: 'pushp',
    group: ST,
    summary: 'Push 16-bit register (high byte first)',
    rtl: 'SP ← SP − 1; M[SP] ← Wa.hi; SP ← SP − 1; M[SP] ← Wa.lo',
  });
  add({
    opcode: 0x1f,
    mnemonic: 'POPP',
    operands: [wA],
    a: 'W',
    family: 'popp',
    group: ST,
    summary: 'Pop 16-bit register',
    rtl: 'Wa.lo ← M[SP]; Wa.hi ← M[SP+1]; SP ← SP + 2',
    notes: 'POPP SP leaves SP equal to the popped value.',
  });

  // ---- Privileged control registers -------------------------------------------------
  const PR: Group = 'Privileged control registers';
  add({
    opcode: 0x20,
    mnemonic: 'MFC',
    operands: [wA, crB],
    a: 'W',
    b: 'CR',
    family: 'mfc',
    privileged: true,
    group: PR,
    summary: 'Move from control register',
    rtl: 'Wa ← CRb',
  });
  add({
    opcode: 0x21,
    mnemonic: 'MTC',
    operands: [crA, wB],
    a: 'CR',
    b: 'W',
    family: 'mtc',
    privileged: true,
    flags: 'CZNV',
    group: PR,
    summary: 'Move to control register',
    rtl: 'CRa ← Wb',
    notes:
      'Writes to CAUSE and FADDR are ignored. Writing PSW takes effect immediately (flags only change when the target is PSW).',
  });

  // ---- 8-bit ALU --------------------------------------------------------------------
  ALU_BINARY.forEach((o, i) => {
    add({
      opcode: 0x30 + i,
      mnemonic: o.op,
      operands: [rA, rB],
      a: 'R',
      b: 'R',
      family: 'alu_rr',
      aluOp: o.op,
      flags: o.flags,
      group: '8-bit arithmetic and logic',
      summary: o.summary,
      rtl: o.rtl,
    });
  });
  ALU_BINARY.forEach((o, i) => {
    add({
      opcode: 0x38 + i,
      mnemonic: o.op,
      operands: [rA, imm8],
      a: 'R',
      imm: 'i8',
      family: 'alu_ri',
      aluOp: o.op,
      flags: o.flags,
      group: '8-bit arithmetic and logic',
      summary: `${o.summary} (immediate)`,
      rtl: o.rtlImm,
    });
  });
  ALU_UNARY.forEach((o, i) => {
    add({
      opcode: 0x40 + i,
      mnemonic: o.op,
      operands: [rA],
      a: 'R',
      family: 'alu_r',
      aluOp: o.op,
      flags: o.flags,
      group: '8-bit unary and shifts',
      summary: o.summary,
      rtl: o.rtl,
    });
  });

  // ---- 16-bit arithmetic ---------------------------------------------------------------
  const A16: Group = '16-bit arithmetic';
  add({
    opcode: 0x50,
    mnemonic: 'INCP',
    operands: [wA],
    a: 'W',
    family: 'incp',
    flags: 'Z',
    group: A16,
    summary: 'Increment 16-bit register',
    rtl: 'Wa ← Wa + 1',
  });
  add({
    opcode: 0x51,
    mnemonic: 'DECP',
    operands: [wA],
    a: 'W',
    family: 'decp',
    flags: 'Z',
    group: A16,
    summary: 'Decrement 16-bit register',
    rtl: 'Wa ← Wa − 1',
  });
  add({
    opcode: 0x52,
    mnemonic: 'ADDP',
    operands: [wA, wB],
    a: 'W',
    b: 'W',
    family: 'addp_ww',
    flags: 'CZNV',
    group: A16,
    summary: '16-bit add',
    rtl: 'Wa ← Wa + Wb',
  });
  add({
    opcode: 0x53,
    mnemonic: 'ADDP',
    operands: [wA, imm16],
    a: 'W',
    imm: 'i16',
    family: 'addp_wi',
    flags: 'CZNV',
    group: A16,
    summary: '16-bit add immediate',
    rtl: 'Wa ← Wa + imm16',
  });
  add({
    opcode: 0x54,
    mnemonic: 'ADDP',
    operands: [wA, rB],
    a: 'W',
    b: 'R',
    family: 'addp_wr',
    flags: 'CZNV',
    group: A16,
    summary: 'Add zero-extended byte register to 16-bit register',
    rtl: 'Wa ← Wa + zext(Rb)',
  });
  add({
    opcode: 0x55,
    mnemonic: 'SUBP',
    operands: [wA, wB],
    a: 'W',
    b: 'W',
    family: 'subp_ww',
    flags: 'CZNV',
    group: A16,
    summary: '16-bit subtract (C = borrow)',
    rtl: 'Wa ← Wa − Wb',
  });
  add({
    opcode: 0x56,
    mnemonic: 'CMPP',
    operands: [wA, wB],
    a: 'W',
    b: 'W',
    family: 'cmpp_ww',
    flags: 'CZNV',
    group: A16,
    summary: '16-bit compare',
    rtl: 'flags ← Wa − Wb',
  });
  add({
    opcode: 0x57,
    mnemonic: 'CMPP',
    operands: [wA, imm16],
    a: 'W',
    imm: 'i16',
    family: 'cmpp_wi',
    flags: 'CZNV',
    group: A16,
    summary: '16-bit compare with immediate',
    rtl: 'flags ← Wa − imm16',
  });

  // ---- Control flow ------------------------------------------------------------------------
  for (const c of CONDITIONS) {
    add({
      opcode: 0x60 + c.code,
      mnemonic: c.mnemonic,
      aliases: c.aliases,
      operands: [addr],
      imm: 'i16',
      family: 'jcc',
      cond: c.code,
      group: 'Control flow',
      summary: c.code === 0 ? 'Jump' : `Jump if ${c.test}`,
      rtl: c.code === 0 ? 'PC ← addr16' : `if ${c.test}: PC ← addr16`,
    });
  }
  add({
    opcode: 0x70,
    mnemonic: 'JMP',
    operands: [wA],
    a: 'W',
    family: 'jmp_w',
    group: 'Control flow',
    summary: 'Jump to address in 16-bit register',
    rtl: 'PC ← Wa',
  });
  add({
    opcode: 0x71,
    mnemonic: 'CALL',
    operands: [addr],
    imm: 'i16',
    family: 'call_abs',
    group: 'Control flow',
    summary: 'Call subroutine',
    rtl: 'push PC.hi; push PC.lo; PC ← addr16',
  });
  add({
    opcode: 0x72,
    mnemonic: 'CALL',
    operands: [wA],
    a: 'W',
    family: 'call_w',
    group: 'Control flow',
    summary: 'Call subroutine at address in 16-bit register',
    rtl: 'push PC.hi; push PC.lo; PC ← Wa',
  });

  return t;
}

export const INSTRUCTIONS: readonly InstructionDef[] = buildTable();

/** Decoder lookup: opcode → definition (undefined = illegal opcode). */
export const OPCODE_TABLE: readonly (InstructionDef | undefined)[] = (() => {
  const table: (InstructionDef | undefined)[] = new Array(256).fill(undefined);
  for (const d of INSTRUCTIONS) {
    if (table[d.opcode]) throw new Error(`duplicate opcode 0x${d.opcode.toString(16)}`);
    table[d.opcode] = d;
  }
  return table;
})();

/** Mnemonic (including aliases, upper-case) → candidate definitions. */
export const MNEMONIC_TABLE: ReadonlyMap<string, readonly InstructionDef[]> = (() => {
  const m = new Map<string, InstructionDef[]>();
  for (const d of INSTRUCTIONS) {
    for (const name of [d.mnemonic, ...d.aliases]) {
      const list = m.get(name) ?? [];
      list.push(d);
      m.set(name, list);
    }
  }
  return m;
})();

export function fieldLimit(kind: FieldKind): number {
  return kind === 'R' ? 8 : kind === 'W' ? 5 : 8;
}

export const WIDE_NAMES = ['P0', 'P1', 'P2', 'P3', 'SP'] as const;
export const REG_NAMES = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'] as const;
