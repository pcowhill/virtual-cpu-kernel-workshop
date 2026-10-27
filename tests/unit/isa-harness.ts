import { assemble } from '../../src/core/asm/assembler';
import { bareMetalConfig } from '../../src/core/build/bareMetal';
import { MEM, PSW } from '../../src/core/isa/constants';
import { Machine } from '../../src/core/machine/machine';

export interface CpuSetup {
  /** Register values by name: R0..R7, P0..P3 (pairs), SP, KSP, USP, PSW, VBASE, UBASE, ULIMIT. */
  regs?: Record<string, number>;
  /** Initial memory contents (RAM only). */
  mem?: Record<number, number>;
  /** Run the code in user mode (code is then placed at 0x6000). */
  user?: boolean;
}

export interface CpuExpect {
  regs?: Record<string, number>;
  /** Exact set of flags that must be 1 among C, Z, N, V (e.g. "CZ", "" for none). */
  flags?: string;
  mem?: Record<number, number>;
  /** Expected PC, or a label name from the test program. */
  pc?: number | string;
  cycles?: number;
  /** Expected pending exception after the step (fault/trap). */
  exception?: { vector: number; cause: number; faddr?: number };
  status?: string;
}

export interface IsaCase extends CpuSetup {
  name: string;
  code: string;
  /** Instructions to execute (default 1). */
  steps?: number;
  expect: CpuExpect;
}

export const KERNEL_STACK_TOP = 0x3000;

/**
 * Build a machine whose ROM holds a reset vector to `start`, run the reset
 * sequence, then apply the setup directly to CPU state (test harness only).
 */
export function prepare(c: IsaCase): { m: Machine; labels: Map<string, number>; startCycle: number } {
  const origin = c.user ? 0x6000 : 0x0100;
  const src = ['  .org 0x0000', '  .word start', `  .org 0x${origin.toString(16)}`, 'start:', c.code].join('\n');
  const r = assemble(src, { fileName: c.name });
  if (!r.ok) throw new Error(`${c.name}: ${r.diagnostics.map((d) => `${d.line}: ${d.message}`).join('; ')}`);
  const m = new Machine();
  m.powerOn(bareMetalConfig(r.segments));
  m.stepInstruction(); // reset sequence → PC = start
  const cpu = m.cpu;
  cpu.ksp = KERNEL_STACK_TOP;
  for (const [addr, v] of Object.entries(c.mem ?? {})) m.debugPoke(Number(addr), v);
  if (c.user) {
    cpu.usp = 0x7000;
    cpu.ubase = 0x6000;
    cpu.ulimit = 0x8000;
    cpu.psw = 0;
  }
  for (const [name, v] of Object.entries(c.regs ?? {})) setReg(m, name, v);
  const labels = new Map(r.symbols.map((s) => [s.name, s.value]));
  return { m, labels, startCycle: m.cycle };
}

export function setReg(m: Machine, name: string, v: number): void {
  const cpu = m.cpu;
  const up = name.toUpperCase();
  const rm = /^R([0-7])$/.exec(up);
  if (rm) cpu.r[Number(rm[1])] = v & 0xff;
  else if (/^P[0-3]$/.test(up)) cpu.setW(Number(up[1]), v);
  else if (up === 'SP') cpu.sp = v;
  else if (up === 'KSP') cpu.ksp = v;
  else if (up === 'USP') cpu.usp = v;
  else if (up === 'PSW') cpu.psw = v;
  else if (up === 'VBASE') cpu.vbase = v;
  else if (up === 'UBASE') cpu.ubase = v;
  else if (up === 'ULIMIT') cpu.ulimit = v;
  else throw new Error(`unknown register ${name}`);
}

export function getReg(m: Machine, name: string): number {
  const cpu = m.cpu;
  const up = name.toUpperCase();
  const rm = /^R([0-7])$/.exec(up);
  if (rm) return cpu.r[Number(rm[1])]!;
  if (/^P[0-3]$/.test(up)) return cpu.getW(Number(up[1]));
  switch (up) {
    case 'SP':
      return cpu.sp;
    case 'KSP':
      return cpu.ksp;
    case 'USP':
      return cpu.usp;
    case 'PSW':
      return cpu.psw;
    case 'PC':
      return cpu.pc;
    case 'VBASE':
      return cpu.vbase;
    case 'UBASE':
      return cpu.ubase;
    case 'ULIMIT':
      return cpu.ulimit;
    case 'CAUSE':
      return cpu.cause;
    case 'FADDR':
      return cpu.faddr;
    case 'KSCRATCH':
      return cpu.kscratch;
  }
  throw new Error(`unknown register ${name}`);
}

export function flagString(psw: number): string {
  return (psw & PSW.C ? 'C' : '') + (psw & PSW.Z ? 'Z' : '') + (psw & PSW.N ? 'N' : '') + (psw & PSW.V ? 'V' : '');
}

export function normalizeFlags(f: string): string {
  return ['C', 'Z', 'N', 'V'].filter((x) => f.includes(x)).join('');
}

/** Execute the case and return a list of mismatches (empty = pass). */
export function runCase(c: IsaCase): { m: Machine; problems: string[] } {
  const { m, labels, startCycle } = prepare(c);
  const steps = c.steps ?? 1;
  for (let i = 0; i < steps; i++) m.stepInstruction();
  const problems: string[] = [];
  const e = c.expect;
  for (const [name, v] of Object.entries(e.regs ?? {})) {
    const got = getReg(m, name);
    if (got !== v) problems.push(`${name}: expected 0x${v.toString(16)}, got 0x${got.toString(16)}`);
  }
  if (e.flags !== undefined) {
    const got = flagString(m.cpu.psw);
    if (got !== normalizeFlags(e.flags)) problems.push(`flags: expected "${normalizeFlags(e.flags)}", got "${got}"`);
  }
  for (const [addr, v] of Object.entries(e.mem ?? {})) {
    const got = m.bus.peek(Number(addr));
    if (got !== v)
      problems.push(`mem[0x${Number(addr).toString(16)}]: expected 0x${v.toString(16)}, got 0x${got.toString(16)}`);
  }
  if (e.pc !== undefined) {
    const want = typeof e.pc === 'string' ? labels.get(e.pc) : e.pc;
    if (want === undefined) problems.push(`no label ${String(e.pc)}`);
    else if (m.cpu.pc !== want) problems.push(`PC: expected 0x${want.toString(16)}, got 0x${m.cpu.pc.toString(16)}`);
  }
  if (e.cycles !== undefined && m.cycle - startCycle !== e.cycles) {
    problems.push(`cycles: expected ${e.cycles}, got ${m.cycle - startCycle}`);
  }
  if (e.exception) {
    const ex = m.cpu.exception;
    if (!ex) problems.push('expected a pending exception, none raised');
    else {
      if (ex.vector !== e.exception.vector) problems.push(`vector: expected ${e.exception.vector}, got ${ex.vector}`);
      if (ex.cause !== e.exception.cause) problems.push(`cause: expected ${e.exception.cause}, got ${ex.cause}`);
      if (e.exception.faddr !== undefined && ex.faddr !== e.exception.faddr)
        problems.push(`faddr: expected 0x${e.exception.faddr.toString(16)}, got 0x${ex.faddr.toString(16)}`);
    }
  } else if (m.cpu.exception && !c.expect.status) {
    problems.push(`unexpected exception: cause 0x${m.cpu.exception.cause.toString(16)}`);
  }
  if (e.status !== undefined && m.cpu.status !== e.status)
    problems.push(`status: expected ${e.status}, got ${m.cpu.status}`);
  return { m, problems };
}

export const ROM_END = MEM.ROM_END;
