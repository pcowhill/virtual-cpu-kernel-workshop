import { describe, expect, it } from 'vitest';
import { assemble, sourceForAddress, toImage } from '../../src/core/asm/assembler';
import { disassembleAt, disassembleBytes } from '../../src/core/asm/disassembler';
import { INSTRUCTIONS, type InstructionDef } from '../../src/core/isa/opcodes';

function bytesOf(src: string, opts = {}): number[] {
  const r = assemble(src, opts);
  if (!r.ok) throw new Error(r.diagnostics.map((d) => `${d.line}: ${d.message}`).join('\n'));
  return r.segments.flatMap((s) => Array.from(s.bytes));
}

function errorsOf(src: string, opts = {}): string[] {
  const r = assemble(src, opts);
  return r.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.line}: ${d.message}`);
}

describe('instruction encodings (hand-written expected bytes)', () => {
  const table: [string, number[]][] = [
    ['NOP', [0x01]],
    ['HLT', [0x02]],
    ['SYS', [0x03]],
    ['BRK', [0x04]],
    ['RTI', [0x05]],
    ['RET', [0x06]],
    ['CLI', [0x07]],
    ['STI', [0x08]],
    ['CLC', [0x09]],
    ['SEC', [0x0a]],
    ['MOV R1, R2', [0x10, 0x12]],
    ['MOV R7, #0x80', [0x11, 0x70, 0x80]],
    ['MOV R0, #-1', [0x11, 0x00, 0xff]],
    ['LD R3, [0x1234]', [0x12, 0x30, 0x34, 0x12]],
    ['LD R3, [P2+7]', [0x13, 0x32, 0x07]],
    ['LD R3, [P2]', [0x13, 0x32, 0x00]],
    ['LD R0, [SP+255]', [0x13, 0x04, 0xff]],
    ['ST [0xABCD], R5', [0x14, 0x50, 0xcd, 0xab]],
    ['ST [P1+1], R6', [0x15, 0x61, 0x01]],
    ['PUSH R4', [0x16, 0x40]],
    ['POP R4', [0x17, 0x40]],
    ['MOVP P0, P3', [0x18, 0x03]],
    ['MOVP SP, P1', [0x18, 0x41]],
    ['MOVP P2, SP', [0x18, 0x24]],
    ['MOVP P1, #0x6000', [0x19, 0x10, 0x00, 0x60]],
    ['MOVP SP, #0x6000', [0x19, 0x40, 0x00, 0x60]],
    ['LDW P1, [0x2000]', [0x1a, 0x10, 0x00, 0x20]],
    ['LDW SP, [P3+4]', [0x1b, 0x43, 0x04]],
    ['STW [0x2000], P1', [0x1c, 0x10, 0x00, 0x20]],
    ['STW [P0+2], SP', [0x1d, 0x40, 0x02]],
    ['PUSHP P2', [0x1e, 0x20]],
    ['POPP SP', [0x1f, 0x40]],
    ['MFC P0, CAUSE', [0x20, 0x05]],
    ['MTC VBASE, P1', [0x21, 0x21]],
    ['MTC KSCRATCH, SP', [0x21, 0x74]],
    ['ADD R0, R1', [0x30, 0x01]],
    ['ADC R2, R3', [0x31, 0x23]],
    ['SUB R4, R5', [0x32, 0x45]],
    ['SBC R6, R7', [0x33, 0x67]],
    ['CMP R0, R7', [0x34, 0x07]],
    ['AND R1, R1', [0x35, 0x11]],
    ['OR R2, R0', [0x36, 0x20]],
    ['XOR R3, R4', [0x37, 0x34]],
    ['ADD R0, #1', [0x38, 0x00, 0x01]],
    ['ADC R0, #2', [0x39, 0x00, 0x02]],
    ['SUB R1, #3', [0x3a, 0x10, 0x03]],
    ['SBC R1, #4', [0x3b, 0x10, 0x04]],
    ["CMP R2, #'A'", [0x3c, 0x20, 0x41]],
    ['AND R3, #0x0F', [0x3d, 0x30, 0x0f]],
    ['OR R4, #0b1000_0000', [0x3e, 0x40, 0x80]],
    ['XOR R5, #255', [0x3f, 0x50, 0xff]],
    ['INC R0', [0x40, 0x00]],
    ['DEC R1', [0x41, 0x10]],
    ['NOT R2', [0x42, 0x20]],
    ['NEG R3', [0x43, 0x30]],
    ['SHL R4', [0x44, 0x40]],
    ['SHR R5', [0x45, 0x50]],
    ['SAR R6', [0x46, 0x60]],
    ['ROL R7', [0x47, 0x70]],
    ['ROR R0', [0x48, 0x00]],
    ['TST R1', [0x49, 0x10]],
    ['INCP P1', [0x50, 0x10]],
    ['DECP SP', [0x51, 0x40]],
    ['ADDP P0, P1', [0x52, 0x01]],
    ['ADDP SP, #-2', [0x53, 0x40, 0xfe, 0xff]],
    ['ADDP P2, R7', [0x54, 0x27]],
    ['SUBP P3, P0', [0x55, 0x30]],
    ['CMPP P1, P2', [0x56, 0x12]],
    ['CMPP P1, #0xF000', [0x57, 0x10, 0x00, 0xf0]],
    ['JMP 0x1234', [0x60, 0x34, 0x12]],
    ['JEQ 0x1234', [0x61, 0x34, 0x12]],
    ['JZ 0x1234', [0x61, 0x34, 0x12]],
    ['JNE 0x0001', [0x62, 0x01, 0x00]],
    ['JCS 2', [0x63, 0x02, 0x00]],
    ['JLTU 2', [0x63, 0x02, 0x00]],
    ['JCC 2', [0x64, 0x02, 0x00]],
    ['JMI 2', [0x65, 0x02, 0x00]],
    ['JPL 2', [0x66, 0x02, 0x00]],
    ['JVS 2', [0x67, 0x02, 0x00]],
    ['JVC 2', [0x68, 0x02, 0x00]],
    ['JLT 2', [0x69, 0x02, 0x00]],
    ['JGE 2', [0x6a, 0x02, 0x00]],
    ['JGT 2', [0x6b, 0x02, 0x00]],
    ['JLE 2', [0x6c, 0x02, 0x00]],
    ['JGTU 2', [0x6d, 0x02, 0x00]],
    ['JLEU 2', [0x6e, 0x02, 0x00]],
    ['JMP P3', [0x70, 0x30]],
    ['CALL 0x0300', [0x71, 0x00, 0x03]],
    ['CALL SP', [0x72, 0x40]],
  ];
  it.each(table)('%s', (src, expected) => {
    expect(bytesOf(src)).toEqual(expected);
  });

  it('covers every opcode', () => {
    const covered = new Set(table.map(([, b]) => b[0]));
    expect(INSTRUCTIONS.filter((d) => !covered.has(d.opcode)).map((d) => d.mnemonic)).toEqual([]);
  });

  it('mnemonics and registers are case-insensitive', () => {
    expect(bytesOf('mov r1, r2\nld r0, [p1+1]\nmovp sp, #1')).toEqual(
      bytesOf('MOV R1, R2\nLD R0, [P1+1]\nMOVP SP, #1'),
    );
  });
});

/** A representative operand list for each operand syntax, for round-trips. */
function sampleOperands(d: InstructionDef, variant: number): string[] {
  return d.operands.map((o, i) => {
    switch (o.kind) {
      case 'reg':
        return `R${(variant + i * 3) % 8}`;
      case 'wide':
        return ['P0', 'P1', 'P2', 'P3', 'SP'][(variant + i * 2) % 5]!;
      case 'cr':
        return ['PSW', 'USP', 'VBASE', 'UBASE', 'ULIMIT', 'CAUSE', 'FADDR', 'KSCRATCH'][(variant + i) % 8]!;
      case 'imm8':
        return `#0x${((variant * 37) & 0xff).toString(16)}`;
      case 'imm16':
        return `#0x${((variant * 4099) & 0xffff).toString(16)}`;
      case 'abs':
        return `[0x${((variant * 911 + 0x2000) & 0xffff).toString(16)}]`;
      case 'mem':
        return `[${['P0', 'P1', 'P2', 'P3', 'SP'][variant % 5]}+${(variant * 13) & 0xff}]`;
      case 'addr':
        return `0x${((variant * 1237) & 0xffff).toString(16)}`;
    }
  });
}

describe('assembler/disassembler round trip', () => {
  for (const d of INSTRUCTIONS) {
    it(`${d.mnemonic} (0x${d.opcode.toString(16)})`, () => {
      for (let variant = 0; variant < 12; variant++) {
        const ops = sampleOperands(d, variant);
        const src = ops.length ? `${d.mnemonic} ${ops.join(', ')}` : d.mnemonic;
        const bytes = bytesOf(src);
        expect(bytes[0]).toBe(d.opcode);
        expect(bytes.length).toBe(d.length);
        const dis = disassembleAt((a) => bytes[a] ?? 0, 0);
        expect(dis.valid).toBe(true);
        expect(dis.length).toBe(d.length);
        // Re-assembling the disassembly gives identical bytes.
        expect(bytesOf(dis.text)).toEqual(bytes);
      }
    });
  }

  it('invalid bytes disassemble as .byte and re-assemble identically', () => {
    for (const bytes of [[0x00], [0xff], [0x10, 0x89], [0x16, 0x01], [0x18, 0x55], [0x20, 0x09]]) {
      const dis = disassembleAt((a) => bytes[a] ?? 0, 0);
      expect(dis.valid).toBe(false);
      expect(dis.length).toBe(1);
      expect(bytesOf(dis.text)).toEqual([bytes[0]]);
    }
  });

  it('linear disassembly of a program', () => {
    const r = assemble('.org 0x100\nstart: MOV R0, #1\nADD R0, R0\nJMP start');
    const dis = disassembleBytes(r.segments[0]!.bytes, 0x100);
    expect(dis.map((d) => d.text)).toEqual(['MOV R0, #0x01', 'ADD R0, R0', 'JMP 0x0100']);
    expect(dis.map((d) => d.address)).toEqual([0x100, 0x103, 0x105]);
  });

  it('uses symbol names when a resolver is supplied', () => {
    const bytes = bytesOf('CALL 0x0200\nLD R0, [0x2000]');
    const names = new Map([
      [0x0200, 'print'],
      [0x2000, 'counter'],
    ]);
    const read = (a: number) => bytes[a] ?? 0;
    expect(disassembleAt(read, 0, (a) => names.get(a)).text).toBe('CALL print');
    expect(disassembleAt(read, 3, (a) => names.get(a)).text).toBe('LD R0, [counter]');
  });
});

describe('labels, expressions and directives', () => {
  it('resolves forward and backward labels', () => {
    expect(bytesOf('.org 0x10\na: JMP b\nb: JMP a')).toEqual([0x60, 0x13, 0x00, 0x60, 0x10, 0x00]);
  });

  it('supports local labels scoped to the previous global label', () => {
    const src = `.org 0
f1: NOP
.loop: JMP .loop
f2: NOP
.loop: JMP .loop`;
    expect(bytesOf(src)).toEqual([0x01, 0x60, 0x01, 0x00, 0x01, 0x60, 0x05, 0x00]);
    const r = assemble(src);
    expect(r.symbols.map((s) => s.name)).toEqual(['f1', 'f1.loop', 'f2', 'f2.loop']);
  });

  it('evaluates expressions with precedence, lo/hi and $', () => {
    const src = `BASE = 0x1234
COUNT .equ 3
.equ SIZE, COUNT * 2 + 1
.org 0x40
here: .byte lo(BASE), hi(BASE), SIZE, (1 << 4) | 2, ~0 & 0xFF, 10 / 3, 10 % 3, -1
      .word $, here + 1, BASE >> 4`;
    expect(bytesOf(src)).toEqual([0x34, 0x12, 7, 0x12, 0xff, 3, 1, 0xff, 0x48, 0x00, 0x41, 0x00, 0x23, 0x01]);
  });

  it('constants may reference later labels', () => {
    expect(bytesOf('PTR = target\nMOVP P0, #PTR\ntarget: NOP')).toEqual([0x19, 0x00, 0x04, 0x00, 0x01]);
  });

  it('string, ascii, space, fill and align directives', () => {
    const src = `.org 0
.ascii "AB"
.asciz "C\\n"
.byte "hi", 0
.space 2
.fill 3, 0xEE
.align 4
.byte 1`;
    expect(bytesOf(src)).toEqual([0x41, 0x42, 0x43, 0x0a, 0x00, 0x68, 0x69, 0x00, 0, 0, 0xee, 0xee, 0xee, 0x01]);
    const r = assemble(src);
    // .align 4 moved the last byte from 13 to 16
    expect(r.segments.map((s) => [s.address, s.bytes.length])).toEqual([
      [0, 13],
      [16, 1],
    ]);
  });

  it('a label on a .org or .align line names the new address', () => {
    const r = assemble('.org 0x10\nhere: .org 0x40\nNOP\naligned: .align 8\nNOP');
    expect(r.symbols.find((x) => x.name === 'here')?.value).toBe(0x40);
    expect(r.symbols.find((x) => x.name === 'aligned')?.value).toBe(0x48);
  });

  it('accepts .EQU in any case and upper-case 0X/0B prefixes', () => {
    expect(bytesOf('A .Equ 0X10\n.EQU B, 0B11\n.byte A, B')).toEqual([0x10, 3]);
  });

  it('character literals and escapes', () => {
    expect(bytesOf("MOV R0, #'\\n'\nMOV R1, #'\\x41'\nMOV R2, #';'")).toEqual([
      0x11, 0x00, 0x0a, 0x11, 0x10, 0x41, 0x11, 0x20, 0x3b,
    ]);
  });

  it('predefined symbols from the build configuration', () => {
    expect(bytesOf('.org PROC_BASE\nJMP PROC_BASE', { predefined: { PROC_BASE: 0x8000 } })).toEqual([0x60, 0x00, 0x80]);
  });

  it('.include pulls in other files with their own source map entries', () => {
    const r = assemble('.org 0\n.include "lib.asm"\nCALL helper', {
      fileName: 'main.asm',
      files: { 'lib.asm': 'helper: RET' },
    });
    expect(r.ok).toBe(true);
    expect(r.sourceMap).toEqual([
      { address: 0, size: 1, file: 'lib.asm', line: 1, kind: 'instruction' },
      { address: 1, size: 3, file: 'main.asm', line: 3, kind: 'instruction' },
    ]);
  });
});

describe('diagnostics', () => {
  const cases: [string, string, RegExp][] = [
    ['unknown mnemonic with suggestion', 'MOVV R0, R1', /unknown instruction 'MOVV'.*Did you mean 'MOV/],
    ['invalid operand combination', 'MOV R0, P1', /invalid operands for MOV; expected/],
    ['too many operands', 'NOP R1', /invalid operands for NOP/],
    ['non-existent register', 'INC R8', /no register R8/],
    ['non-existent pair', 'INCP P4', /no register pair P4/],
    ['duplicate label', 'a: NOP\na: NOP', /duplicate symbol 'a'/],
    ['undefined symbol', 'JMP nowhere', /undefined symbol 'nowhere'/],
    ['immediate out of range', 'MOV R0, #256', /immediate value 256 .* out of range/],
    ['negative immediate out of range', 'MOV R0, #-129', /out of range/],
    ['16-bit immediate out of range', 'MOVP P0, #0x10000', /out of range/],
    ['offset out of range', 'LD R0, [P0+256]', /offset 256 .* out of range/],
    ['negative offset', 'LD R0, [P0-1]', /negative offsets are not supported/],
    ['8-bit register used as pointer', 'LD R0, [R1]', /8-bit registers cannot hold addresses/],
    ['memory layout conflict', '.org 0\nNOP\n.org 0\nHLT', /memory-layout conflict: address 0x0000/],
    ['bytes in MMIO', '.org 0xF000\nNOP', /device \(MMIO\) space/],
    ['region restriction', '.org 0x3000\nNOP', /outside the region allowed/],
    ['reserved name as label', 'SP: NOP', /reserved register name/],
    ['unknown directive', '.blah 3', /unknown directive '.blah'/],
    ['bad number', 'MOV R0, #12abc', /malformed number/],
    ['unterminated string', '.ascii "abc', /expected a "string"/],
    ['circular constants', 'A = B\nB = A\nMOV R0, #A', /circular definition/],
    ['org forward reference', '.org LATER\nLATER = 5', /not defined yet/],
    ['missing include', '.include "nope.asm"', /cannot find include file/],
    ['local label without scope', '.x: NOP', /needs a preceding global label/],
    ['address space overflow', '.org 0xFFFF\nMOVP P0, #1', /past the end of the address space|MMIO/],
    ['number without digits', 'MOV R0, #0x_', /malformed number '0x_'/],
    ['binary number without digits', '.byte 0b', /malformed number/],
    ['shift count too large', 'MOV R0, #(1 << 32)', /shift count 32 is out of range/],
    ['shift overflow is range-checked', '.word 1 << 20', /word value 1048576 .* out of range/],
    ['register-like label', 'R8: NOP', /reserved register name/],
  ];
  it.each(cases)('%s', (_n, src, re) => {
    const errs = errorsOf(
      src,
      _n === 'region restriction' ? { regions: [{ start: 0, end: 0x1fff, name: 'Boot ROM' }] } : {},
    );
    expect(errs.join('\n')).toMatch(re);
  });

  it('reports the line and column of errors', () => {
    const r = assemble('NOP\n  MOV R0, #300');
    expect(r.diagnostics[0]).toMatchObject({ line: 2, column: 11, severity: 'error' });
  });

  it('keeps assembling after an error and reports all errors', () => {
    const r = assemble('FOO\nBAR\nNOP\nJMP nowhere');
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(3);
  });
});

describe('outputs', () => {
  it('produces symbols, a listing and a source map that agree', () => {
    const r = assemble('.org 0x200\nstart: MOV R0, #1 ; comment\n  ; only a comment\ndata: .byte 1,2,3');
    expect(r.symbols).toEqual([
      { name: 'start', value: 0x200, kind: 'label', file: 'main.asm', line: 2 },
      { name: 'data', value: 0x203, kind: 'label', file: 'main.asm', line: 4 },
    ]);
    expect(r.listing[1]).toMatchObject({ line: 2, address: 0x200, bytes: [0x11, 0x00, 0x01] });
    expect(r.listing[2]).toMatchObject({ line: 3, address: null, bytes: [] });
    expect(sourceForAddress(r.sourceMap, 0x201)?.line).toBe(2);
    expect(sourceForAddress(r.sourceMap, 0x205)).toMatchObject({ line: 4, kind: 'data' });
    expect(sourceForAddress(r.sourceMap, 0x206)).toBeUndefined();
    const img = toImage(r.segments);
    expect(Array.from(img.slice(0x200, 0x206))).toEqual([0x11, 0x00, 0x01, 1, 2, 3]);
    expect(r.size).toBe(6);
  });
});
