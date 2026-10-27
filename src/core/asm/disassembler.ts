import { CR_NAMES } from '../isa/constants';
import { OPCODE_TABLE, REG_NAMES, WIDE_NAMES, fieldLimit, type FieldKind, type InstructionDef } from '../isa/opcodes';

export interface DisassembledInstruction {
  address: number;
  bytes: number[];
  length: number;
  /** Canonical assembly text, re-assemblable by the assembler. */
  text: string;
  mnemonic: string;
  operands: string[];
  def: InstructionDef | null;
  /** False for undefined opcodes or invalid register fields (decoded as .byte). */
  valid: boolean;
  /** Absolute target for jumps/calls and absolute loads/stores. */
  target?: number;
}

export type ByteReader = (addr: number) => number;
export type SymbolResolver = (addr: number) => string | undefined;

function hx(v: number, w: number): string {
  return '0x' + v.toString(16).toUpperCase().padStart(w, '0');
}

function fieldName(kind: FieldKind, n: number): string {
  if (kind === 'R') return REG_NAMES[n]!;
  if (kind === 'W') return WIDE_NAMES[n]!;
  return CR_NAMES[n]!;
}

/** Decode the instruction at `address`. Never throws; invalid bytes decode as `.byte`. */
export function disassembleAt(read: ByteReader, address: number, symbols?: SymbolResolver): DisassembledInstruction {
  const opcode = read(address & 0xffff);
  const d = OPCODE_TABLE[opcode];
  const invalid = (): DisassembledInstruction => ({
    address,
    bytes: [opcode],
    length: 1,
    text: `.byte ${hx(opcode, 2)}`,
    mnemonic: '.byte',
    operands: [hx(opcode, 2)],
    def: null,
    valid: false,
  });
  if (!d) return invalid();
  const bytes = [opcode];
  for (let i = 1; i < d.length; i++) bytes.push(read((address + i) & 0xffff));
  let idx = 1;
  let a = 0;
  let b = 0;
  if (d.fieldA !== null || d.fieldB !== null) {
    const rb = bytes[idx++]!;
    a = rb >> 4;
    b = rb & 0xf;
    const ok = (k: FieldKind | null, v: number) => (k === null ? v === 0 : v < fieldLimit(k));
    if (!ok(d.fieldA, a) || !ok(d.fieldB, b)) return invalid();
  }
  let imm = 0;
  if (d.imm === 'i8') imm = bytes[idx++]!;
  else if (d.imm === 'i16') {
    imm = bytes[idx]! | (bytes[idx + 1]! << 8);
    idx += 2;
  }
  let target: number | undefined;
  const sym = (v: number) => symbols?.(v);
  const operands = d.operands.map((o) => {
    switch (o.kind) {
      case 'reg':
      case 'wide':
      case 'cr':
        return fieldName(o.kind === 'reg' ? 'R' : o.kind === 'wide' ? 'W' : 'CR', o.field === 'a' ? a : b);
      case 'imm8':
        return `#${hx(imm, 2)}`;
      case 'imm16':
        return `#${sym(imm) ?? hx(imm, 4)}`;
      case 'abs':
        target = imm;
        return `[${sym(imm) ?? hx(imm, 4)}]`;
      case 'mem':
        return imm === 0 ? `[${WIDE_NAMES[b]}]` : `[${WIDE_NAMES[b]}+${hx(imm, 2)}]`;
      case 'addr':
        target = imm;
        return sym(imm) ?? hx(imm, 4);
    }
  });
  return {
    address,
    bytes,
    length: d.length,
    text: operands.length ? `${d.mnemonic} ${operands.join(', ')}` : d.mnemonic,
    mnemonic: d.mnemonic,
    operands,
    def: d,
    valid: true,
    target,
  };
}

/** Linear-sweep disassembly of `count` instructions starting at `address`. */
export function disassembleRange(
  read: ByteReader,
  address: number,
  count: number,
  symbols?: SymbolResolver,
): DisassembledInstruction[] {
  const out: DisassembledInstruction[] = [];
  let a = address & 0xffff;
  for (let i = 0; i < count; i++) {
    const ins = disassembleAt(read, a, symbols);
    out.push(ins);
    a = (a + ins.length) & 0xffff;
    if (a < address && i > 0) break; // wrapped around the address space
  }
  return out;
}

export function disassembleBytes(bytes: Uint8Array | number[], origin = 0): DisassembledInstruction[] {
  const read = (addr: number) => bytes[addr - origin] ?? 0;
  const out: DisassembledInstruction[] = [];
  let a = origin;
  while (a < origin + bytes.length) {
    const ins = disassembleAt(read, a);
    out.push(ins);
    a += ins.length;
  }
  return out;
}
