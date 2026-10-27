/**
 * Generates the per-opcode ISA reference from the machine-readable table and the
 * micro-programs, so documentation can never drift from the implementation.
 */
import { syntaxSummary } from '../asm/assembler';
import { EXCEPTION_PROGRAM, INSTRUCTION_PROGRAMS, RESET_PROGRAM } from '../cpu/microcode';
import { INSTRUCTIONS, type InstructionDef } from './opcodes';
import { SPEC_VERSION } from './constants';

export function encodingLayout(d: InstructionDef): string {
  const parts = [`${d.opcode.toString(2).padStart(8, '0')}`];
  if (d.fieldA !== null || d.fieldB !== null) {
    const a = d.fieldA ? (d.fieldA === 'R' ? 'rrrr' : d.fieldA === 'W' ? 'wwww' : 'cccc') : '0000';
    const b = d.fieldB ? (d.fieldB === 'R' ? 'ssss' : d.fieldB === 'W' ? 'bbbb' : 'cccc') : '0000';
    parts.push(`${a}${b}`);
  }
  if (d.imm === 'i8') parts.push(d.operands.some((o) => o.kind === 'mem') ? 'offset8' : 'imm8');
  if (d.imm === 'i16') parts.push('lo8', 'hi8');
  return parts.join(' ');
}

export function cycleCount(d: InstructionDef): number {
  return INSTRUCTION_PROGRAMS[d.opcode]!.ops.length;
}

export function microOpNames(d: InstructionDef): string[] {
  return INSTRUCTION_PROGRAMS[d.opcode]!.ops.map((o) => `${o.name}: ${o.rtl}`);
}

export function addressingMode(d: InstructionDef): string {
  const kinds = d.operands.map((o) => o.kind);
  if (kinds.includes('mem')) return 'base + offset / register-indirect';
  if (kinds.includes('abs')) return 'absolute';
  if (kinds.includes('imm8') || kinds.includes('imm16')) return 'immediate';
  if (kinds.includes('addr')) return 'direct (absolute target)';
  if (d.family === 'jmp_w' || d.family === 'call_w') return 'register-indirect target';
  if (kinds.length) return 'register';
  return d.family === 'ret' || d.family === 'rti' ? 'stack' : 'implied';
}

export function generateIsaReferenceMarkdown(): string {
  const out: string[] = [];
  out.push('# VC-8 Instruction Set Reference');
  out.push('');
  out.push(
    `<!-- GENERATED FILE: do not edit. Source: src/core/isa/opcodes.ts + src/core/cpu/microcode.ts. Regenerate with \`npm run docs:isa\`. -->`,
  );
  out.push('');
  out.push(
    `Specification version ${SPEC_VERSION}. VC-8 is a custom educational ISA; see [architecture.md](architecture.md) for registers, memory map, flags and exception rules.`,
  );
  out.push('');
  out.push(
    'Encoding notation: `rrrr`/`ssss` = 8-bit register field (R0–R7), `wwww`/`bbbb` = wide register field (P0–P3 = 0–3, SP = 4), `cccc` = control register number, `0000` = must be zero. Multi-byte immediates are little-endian. Cycles = micro-operations = clock cycles.',
  );
  out.push('');
  out.push(`${INSTRUCTIONS.length} instructions. Opcodes not listed raise an illegal-instruction fault.`);
  out.push('');

  const groups = [...new Set(INSTRUCTIONS.map((d) => d.group))];
  for (const g of groups) {
    out.push(`## ${g}`);
    out.push('');
    out.push('| Opcode | Syntax | Bytes | Encoding | Mode | Flags | Cycles | Priv | Operation |');
    out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const d of INSTRUCTIONS.filter((x) => x.group === g)) {
      const syntax = (syntaxSummary(d) + (d.aliases.length ? ` (alias ${d.aliases.join(', ')})` : '')).replace(
        /\|/g,
        '\\|',
      );
      out.push(
        `| \`0x${d.opcode.toString(16).toUpperCase().padStart(2, '0')}\` | \`${syntax}\` | ${d.length} | \`${encodingLayout(d)}\` | ${addressingMode(d)} | ${d.flags} | ${cycleCount(d)} | ${d.privileged ? 'yes' : '—'} | ${d.rtl.replace(/\|/g, '\\|')} |`,
      );
    }
    out.push('');
  }

  out.push('## Micro-programs');
  out.push('');
  out.push('Each line is one clock cycle. `a`/`b` are the register-byte fields.');
  out.push('');
  for (const d of INSTRUCTIONS) {
    out.push(`### \`0x${d.opcode.toString(16).toUpperCase().padStart(2, '0')}\` ${syntaxSummary(d)} — ${d.summary}`);
    out.push('');
    if (d.notes) {
      out.push(`*Notes:* ${d.notes}`);
      out.push('');
    }
    out.push(
      `*Errors:* ${[
        d.privileged ? 'privilege fault (vector 2) in user mode' : null,
        d.fieldA !== null || d.fieldB !== null
          ? 'illegal-instruction fault (vector 1) for invalid register fields'
          : null,
        [
          'ld_abs',
          'ld_mem',
          'st_abs',
          'st_mem',
          'push',
          'pop',
          'ldw_abs',
          'ldw_mem',
          'stw_abs',
          'stw_mem',
          'pushp',
          'popp',
          'call_abs',
          'call_w',
          'ret',
          'rti',
        ].includes(d.family)
          ? 'memory fault (vector 3) if a data access is not permitted'
          : null,
        'memory fault (vector 3) if an instruction byte cannot be fetched',
      ]
        .filter(Boolean)
        .join('; ')}.`,
    );
    out.push('');
    microOpNames(d).forEach((m, i) => out.push(`${i + 1}. ${m}`));
    out.push('');
  }

  out.push('## Hardware sequences');
  out.push('');
  out.push('### Reset');
  out.push('');
  RESET_PROGRAM.ops.forEach((o, i) => out.push(`${i + 1}. ${o.name}: ${o.rtl}`));
  out.push('');
  out.push('### Exception / interrupt entry');
  out.push('');
  EXCEPTION_PROGRAM.ops.forEach((o, i) => out.push(`${i + 1}. ${o.name}: ${o.rtl}`));
  out.push('');
  return out.join('\n');
}
