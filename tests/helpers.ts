import { assemble, type AssembleOptions, type AssemblyResult } from '../src/core/asm/assembler';
import { bareMetalConfig } from '../src/core/build/bareMetal';
import { Machine } from '../src/core/machine/machine';

/** Assemble or throw with readable diagnostics. */
export function asm(source: string, options: AssembleOptions = {}): AssemblyResult {
  const r = assemble(source, options);
  if (!r.ok) {
    throw new Error(
      'assembly failed:\n' + r.diagnostics.map((d) => `${d.file}:${d.line}:${d.column}: ${d.message}`).join('\n'),
    );
  }
  return r;
}

/**
 * Build a bare-metal machine: the source must provide a reset vector at 0x0000.
 * If `withVector` is true, a reset vector pointing at `start` and an origin of 0x0100 are added.
 */
export function bareMachine(body: string, withVector = true): { m: Machine; r: AssemblyResult } {
  const src = withVector ? `\t.org 0x0000\n\t.word start\n\t.org 0x0100\nstart:\n${body}` : body;
  const r = asm(src);
  const m = new Machine();
  m.powerOn(bareMetalConfig(r.segments));
  return { m, r };
}

/** Run the reset sequence and then `n` instructions. */
export function runInstructions(m: Machine, n: number): void {
  if (m.cpu.program?.kind === 'reset') m.stepInstruction();
  for (let i = 0; i < n; i++) m.stepInstruction();
}

export function sym(r: AssemblyResult, name: string): number {
  const s = r.symbols.find((x) => x.name === name);
  if (!s) throw new Error(`no symbol ${name}`);
  return s.value;
}
