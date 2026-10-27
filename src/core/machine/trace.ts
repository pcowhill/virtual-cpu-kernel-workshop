/** Execution trace records produced by the machine (observation only). */

export interface RegChange {
  name: string;
  old: number;
  new: number;
}

export interface MemWrite {
  addr: number;
  old: number;
  new: number;
}

export type TraceKind = 'instruction' | 'exception' | 'reset' | 'idle';

export interface TraceEntry {
  seq: number;
  kind: TraceKind;
  /** Cycle at which the sequence started. */
  cycle: number;
  cycles: number;
  /** Address of the instruction (or the PC at exception entry). */
  pc: number;
  /** Instruction bytes (instructions only). */
  bytes: number[];
  supervisor: boolean;
  regs: RegChange[];
  mem: MemWrite[];
  /** Set for exception-entry sequences. */
  exception?: { vector: number; cause: number; faddr: number };
  /** A fault raised by this instruction (it was abandoned). */
  fault?: { cause: number; addr: number };
  /** Number of idle cycles merged into this entry (idle entries only). */
  idleCycles?: number;
}

export type MachineEventType =
  | 'reset'
  | 'exception' // fault, trap or IRQ entry completed
  | 'rti'
  | 'mode' // privilege mode changed by MTC PSW
  | 'halt' // entered waiting state
  | 'wake'
  | 'machine-check'
  | 'power-off'
  | 'input';

export interface MachineEvent {
  cycle: number;
  type: MachineEventType;
  /** PC relevant to the event (handler entry address, return address, ...). */
  pc: number;
  vector?: number;
  cause?: number;
  faddr?: number;
  /** Saved/interrupted PC for exceptions. */
  fromPc?: number;
  fromUser?: boolean;
  toUser?: boolean;
  /** For syscalls: value of R0 at the trap. */
  r0?: number;
  detail?: string;
  /** UBASE at the time of the event (identifies the user window). */
  ubase?: number;
}

/** Fixed-capacity ring buffer. */
export class Ring<T> {
  private buf: T[] = [];
  private start = 0;
  total = 0;

  constructor(public capacity: number) {}

  push(item: T): void {
    this.total++;
    if (this.capacity <= 0) return;
    if (this.buf.length < this.capacity) {
      this.buf.push(item);
    } else {
      this.buf[this.start] = item;
      this.start = (this.start + 1) % this.capacity;
    }
  }

  get length(): number {
    return this.buf.length;
  }

  /** Items oldest → newest. */
  toArray(): T[] {
    return this.buf.slice(this.start).concat(this.buf.slice(0, this.start));
  }

  last(n: number): T[] {
    const all = this.toArray();
    return all.slice(Math.max(0, all.length - n));
  }

  /** Items whose position (0-based, in push order) is ≥ `fromTotal`. */
  since(fromTotal: number): T[] {
    const available = this.total - this.buf.length;
    const skip = Math.max(0, fromTotal - available);
    return this.toArray().slice(skip);
  }

  clear(): void {
    this.buf = [];
    this.start = 0;
  }

  resize(capacity: number): void {
    const items = this.last(capacity);
    this.capacity = capacity;
    this.buf = items;
    this.start = 0;
  }
}
