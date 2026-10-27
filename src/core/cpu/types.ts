import type { Cpu } from './cpu';

/** Datapath units, used to highlight what a micro-operation actually exercised. */
export const UNIT = {
  PC: 1 << 0,
  IR: 1 << 1,
  DECODER: 1 << 2,
  MAR: 1 << 3,
  MDR: 1 << 4,
  MEMORY: 1 << 5,
  ADDRESS_BUS: 1 << 6,
  DATA_BUS: 1 << 7,
  REGISTERS: 1 << 8,
  ALU: 1 << 9,
  FLAGS: 1 << 10,
  AGU: 1 << 11,
  SP: 1 << 12,
  CONTROL_REGS: 1 << 13,
  IMM: 1 << 14,
  OPR: 1 << 15,
  TMP: 1 << 16,
  INTERRUPTS: 1 << 17,
} as const;
export type UnitName = keyof typeof UNIT;

export function unitNames(mask: number): UnitName[] {
  return (Object.keys(UNIT) as UnitName[]).filter((k) => (mask & UNIT[k]) !== 0);
}

export type SequenceKind = 'instruction' | 'exception' | 'reset' | 'idle';

export interface MicroOp {
  /** Short stage name, e.g. "FETCH", "ALU". */
  readonly name: string;
  /** Register-transfer description. a/b refer to the register-byte fields. */
  readonly rtl: string;
  /** Datapath units this micro-operation drives. */
  readonly units: number;
  run(cpu: Cpu): void;
}

export interface MicroProgram {
  readonly id: string;
  readonly kind: SequenceKind;
  readonly ops: readonly MicroOp[];
}

export type AccessKind = 'fetch' | 'read' | 'write';

/** What the memory/IO system looks like to the CPU (after protection checks). */
export interface CpuBus {
  read(addr: number): number;
  write(addr: number, value: number): void;
  /** True if an MMIO address is decoded by some device register block. */
  isDecoded(addr: number): boolean;
}

/** Interrupt request lines as seen by the CPU: pending AND enabled in the controller mask. */
export interface InterruptInput {
  pendingEnabled(): number;
}

export type CpuStatus = 'running' | 'waiting' | 'off' | 'machine-check';

/** Bus activity of the most recent micro-operation (for visualisation and tracing). */
export interface BusActivity {
  /** -1 when the address bus was idle. */
  addr: number;
  /** -1 when the data bus was idle. */
  data: number;
  op: 'none' | 'fetch' | 'read' | 'write';
}

export interface AluActivity {
  op: string;
  a: number;
  b: number;
  y: number;
  flags: number;
}

export interface MicroActivity {
  op: MicroOp | null;
  bus: BusActivity;
  alu: AluActivity | null;
  /** Fault raised by this micro-operation, if any. */
  fault: { cause: number; addr: number } | null;
}

export interface PendingException {
  vector: number;
  cause: number;
  faddr: number;
  /** Faults restore PC to the faulting instruction; traps and IRQs do not. */
  isFault: boolean;
}
