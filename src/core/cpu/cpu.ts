import { CAUSE, CR, MEM, PSW, PSW_RESET, PSW_WRITABLE_MASK, RESET_UBASE, RESET_ULIMIT, VECTOR } from '../isa/constants';
import { OPCODE_TABLE, type InstructionDef } from '../isa/opcodes';
import { EXCEPTION_PROGRAM, IDLE_PROGRAM, PREFIX_PROGRAM, RESET_PROGRAM, programById } from './microcode';
import type {
  AccessKind,
  CpuBus,
  CpuStatus,
  InterruptInput,
  MicroActivity,
  MicroOp,
  MicroProgram,
  PendingException,
} from './types';

/** Serializable CPU state, including in-flight micro-program position and internal latches. */
export interface CpuState {
  r: number[];
  pc: number;
  ksp: number;
  usp: number;
  psw: number;
  vbase: number;
  ubase: number;
  ulimit: number;
  cause: number;
  faddr: number;
  kscratch: number;
  latches: {
    ir: number;
    opr: number;
    imm: number;
    mar: number;
    mdr: number;
    a: number;
    b: number;
    y: number;
    aluPacked: number;
    t16: number;
    tmp: number;
    cint: number;
    zlo: boolean;
  };
  instrStart: number;
  programId: string | null;
  seqKind: MicroProgram['kind'];
  mpc: number;
  status: CpuStatus;
  machineCheckReason: string;
  exception: PendingException | null;
  inEntry: boolean;
}

export function vectorForCause(cause: number): number {
  switch (cause) {
    case CAUSE.ILLEGAL_INSTRUCTION:
      return VECTOR.ILLEGAL;
    case CAUSE.PRIVILEGED_INSTRUCTION:
      return VECTOR.PRIVILEGE;
    case CAUSE.SYSCALL:
      return VECTOR.SYSCALL;
    case CAUSE.BREAKPOINT:
      return VECTOR.BREAK;
    default:
      return VECTOR.MEMORY;
  }
}

/**
 * The VC-8 CPU. All execution happens one micro-operation (one clock cycle) at a
 * time through `microStep()`; instruction-level stepping is just repeated
 * micro-steps until a sequence boundary.
 */
export class Cpu {
  // ---- architectural state ----
  readonly r = new Uint8Array(8);
  pc = 0;
  ksp = 0;
  usp = 0;
  psw: number = PSW_RESET;
  vbase = 0;
  ubase = RESET_UBASE;
  ulimit = RESET_ULIMIT;
  cause = 0;
  faddr = 0;
  kscratch = 0;

  // ---- internal latches (visible in the datapath view) ----
  ir = 0;
  opr = 0;
  imm = 0;
  mar = 0;
  mdr = 0;
  a = 0;
  b = 0;
  y = 0;
  aluPacked = 0;
  t16 = 0;
  tmp = 0;
  cint = 0;
  zlo = false;

  // ---- sequencing ----
  instrStart = 0;
  def: InstructionDef | null = null;
  program: MicroProgram | null = RESET_PROGRAM;
  /** Kind of the current (or most recently completed) sequence. */
  seqKind: MicroProgram['kind'] = 'reset';
  mpc = 0;
  status: CpuStatus = 'running';
  machineCheckReason = '';
  exception: PendingException | null = null;
  /** True while the hardware exception-entry sequence runs (faults become double faults). */
  inEntry = false;
  /** Set by a micro-operation that raised a fault; ends the current sequence. */
  faulted = false;

  /** Activity of the most recent micro-operation. */
  readonly activity: MicroActivity = {
    op: null,
    bus: { addr: -1, data: -1, op: 'none' },
    alu: null,
    fault: null,
  };

  constructor(
    private readonly bus: CpuBus,
    private readonly irq: InterruptInput,
  ) {}

  // ===================================================================
  // Reset
  // ===================================================================

  reset(): void {
    this.r.fill(0);
    this.pc = 0;
    this.ksp = 0;
    this.usp = 0;
    this.psw = PSW_RESET;
    this.vbase = 0;
    this.ubase = RESET_UBASE;
    this.ulimit = RESET_ULIMIT;
    this.cause = 0;
    this.faddr = 0;
    this.kscratch = 0;
    this.ir = this.opr = this.imm = this.mar = this.mdr = 0;
    this.a = this.b = this.y = this.aluPacked = this.t16 = this.tmp = this.cint = 0;
    this.zlo = false;
    this.instrStart = 0;
    this.def = null;
    this.program = RESET_PROGRAM;
    this.seqKind = 'reset';
    this.mpc = 0;
    this.status = 'running';
    this.machineCheckReason = '';
    this.exception = null;
    this.inEntry = false;
    this.faulted = false;
    this.clearActivity();
  }

  // ===================================================================
  // Register access helpers (used by micro-operations)
  // ===================================================================

  get supervisor(): boolean {
    return (this.psw & PSW.S) !== 0;
  }

  get sp(): number {
    return this.supervisor ? this.ksp : this.usp;
  }
  set sp(v: number) {
    if (this.supervisor) this.ksp = v & 0xffff;
    else this.usp = v & 0xffff;
  }

  getW(i: number): number {
    if (i === 4) return this.sp;
    return (this.r[i * 2]! << 8) | this.r[i * 2 + 1]!;
  }
  setW(i: number, v: number): void {
    v &= 0xffff;
    if (i === 4) {
      this.sp = v;
      return;
    }
    this.r[i * 2] = v >> 8;
    this.r[i * 2 + 1] = v & 0xff;
  }

  setPsw(v: number): void {
    this.psw = v & PSW_WRITABLE_MASK;
  }

  getCR(i: number): number {
    switch (i) {
      case CR.PSW:
        return this.psw;
      case CR.USP:
        return this.usp;
      case CR.VBASE:
        return this.vbase;
      case CR.UBASE:
        return this.ubase;
      case CR.ULIMIT:
        return this.ulimit;
      case CR.CAUSE:
        return this.cause;
      case CR.FADDR:
        return this.faddr;
      case CR.KSCRATCH:
        return this.kscratch;
      default:
        return 0;
    }
  }
  setCR(i: number, v: number): void {
    v &= 0xffff;
    switch (i) {
      case CR.PSW:
        this.setPsw(v & 0xff);
        break;
      case CR.USP:
        this.usp = v;
        break;
      case CR.VBASE:
        this.vbase = v;
        break;
      case CR.UBASE:
        this.ubase = v;
        break;
      case CR.ULIMIT:
        this.ulimit = v;
        break;
      case CR.KSCRATCH:
        this.kscratch = v;
        break;
      default:
        // CAUSE and FADDR are read-only.
        break;
    }
  }

  // ===================================================================
  // Memory access through the protection unit
  // ===================================================================

  /** Returns the fault cause for an access in the current mode, or 0 if permitted. */
  checkAccess(addr: number, kind: AccessKind): number {
    if (this.supervisor) {
      if (kind === 'write' && addr <= MEM.ROM_END) return CAUSE.ROM_WRITE;
      if (addr >= MEM.MMIO_START && (kind === 'fetch' || !this.bus.isDecoded(addr))) return CAUSE.BUS_ERROR;
      return 0;
    }
    if (addr < MEM.URAM_START || addr > MEM.URAM_END || addr < this.ubase || addr >= this.ulimit) {
      return kind === 'fetch' ? CAUSE.FETCH_VIOLATION : kind === 'read' ? CAUSE.READ_VIOLATION : CAUSE.WRITE_VIOLATION;
    }
    return 0;
  }

  /** Read a byte via the protection unit. On a fault returns 0 and sets `faulted`. */
  read(addr: number, kind: 'fetch' | 'read'): number {
    addr &= 0xffff;
    const act = this.activity.bus;
    act.addr = addr;
    act.op = kind;
    const cause = this.checkAccess(addr, kind);
    if (cause) {
      this.memoryFault(cause, addr);
      return 0;
    }
    const v = this.bus.read(addr) & 0xff;
    act.data = v;
    return v;
  }

  write(addr: number, value: number): void {
    addr &= 0xffff;
    value &= 0xff;
    const act = this.activity.bus;
    act.addr = addr;
    act.data = value;
    act.op = 'write';
    const cause = this.checkAccess(addr, 'write');
    if (cause) {
      this.memoryFault(cause, addr);
      return;
    }
    this.bus.write(addr, value);
  }

  // ===================================================================
  // Exceptions
  // ===================================================================

  /** Raise a fault: abandon the instruction, restore PC, enter the vector next. */
  fault(cause: number, faddr = 0): void {
    this.activity.fault = { cause, addr: faddr };
    if (this.inEntry) {
      this.machineCheck(
        `double fault: ${cause === CAUSE.ROM_WRITE ? 'ROM write' : 'fault'} at 0x${faddr
          .toString(16)
          .padStart(4, '0')} during exception entry`,
      );
      return;
    }
    this.faulted = true;
    this.pc = this.instrStart;
    this.exception = { vector: vectorForCause(cause), cause, faddr, isFault: true };
  }

  private memoryFault(cause: number, addr: number): void {
    this.fault(cause, addr);
  }

  /** Raise a trap (SYS/BRK): the instruction completes, then the handler is entered. */
  trap(cause: number): void {
    this.exception = { vector: vectorForCause(cause), cause, faddr: 0, isFault: false };
  }

  machineCheck(reason: string): void {
    this.status = 'machine-check';
    this.machineCheckReason = reason;
    this.faulted = true;
    this.inEntry = false;
  }

  // ===================================================================
  // Sequencing
  // ===================================================================

  /** True when the CPU is between sequences (an instruction boundary). */
  get atBoundary(): boolean {
    return this.program === null;
  }

  get halted(): boolean {
    return this.status === 'off' || this.status === 'machine-check';
  }

  /** Called at a sequence boundary to pick what runs next. */
  private beginSequence(): void {
    this.instrStart = this.pc;
    this.def = null;
    this.mpc = 0;
    if (this.exception) {
      this.program = EXCEPTION_PROGRAM;
      return;
    }
    const lines = this.irq.pendingEnabled();
    if (this.status === 'waiting') {
      if (lines === 0) {
        this.program = IDLE_PROGRAM;
        return;
      }
      this.status = 'running';
    }
    if (lines !== 0 && this.psw & PSW.I) {
      let line = 0;
      while (!(lines & (1 << line))) line++;
      this.exception = {
        vector: VECTOR.IRQ_BASE + line,
        cause: CAUSE.IRQ_BASE + line,
        faddr: 0,
        isFault: false,
      };
      this.program = EXCEPTION_PROGRAM;
      return;
    }
    this.program = PREFIX_PROGRAM;
  }

  private clearActivity(): void {
    const act = this.activity;
    act.op = null;
    act.bus.addr = -1;
    act.bus.data = -1;
    act.bus.op = 'none';
    act.alu = null;
    act.fault = null;
  }

  /** The micro-operation that the next `microStep()` will execute (null if a sequence must begin). */
  peekNextOp(): MicroOp | null {
    if (!this.program) return null;
    return this.program.ops[this.mpc] ?? null;
  }

  /**
   * Execute exactly one micro-operation (one clock cycle).
   * Returns true if a sequence (instruction, exception entry, reset or idle cycle) ended.
   * Returns false without consuming a cycle if the CPU is off or in machine check.
   */
  microStep(): boolean {
    if (this.halted) return false;
    if (this.program === null) this.beginSequence();
    const program = this.program!;
    this.seqKind = program.kind;
    const op = program.ops[this.mpc++]!;
    this.clearActivity();
    this.activity.op = op;
    this.faulted = false;
    op.run(this);
    if (this.faulted) {
      this.program = null;
      this.inEntry = false;
      return true;
    }
    // DECODE swaps in the full micro-program, so re-read this.program.
    if (this.mpc >= this.program!.ops.length) {
      this.program = null;
      return true;
    }
    return false;
  }

  /** The kind of sequence currently in progress (or about to start). */
  get sequenceKind(): MicroProgram['kind'] | null {
    return this.program?.kind ?? null;
  }

  // ===================================================================
  // Snapshots
  // ===================================================================

  getState(): CpuState {
    return {
      r: Array.from(this.r),
      pc: this.pc,
      ksp: this.ksp,
      usp: this.usp,
      psw: this.psw,
      vbase: this.vbase,
      ubase: this.ubase,
      ulimit: this.ulimit,
      cause: this.cause,
      faddr: this.faddr,
      kscratch: this.kscratch,
      latches: {
        ir: this.ir,
        opr: this.opr,
        imm: this.imm,
        mar: this.mar,
        mdr: this.mdr,
        a: this.a,
        b: this.b,
        y: this.y,
        aluPacked: this.aluPacked,
        t16: this.t16,
        tmp: this.tmp,
        cint: this.cint,
        zlo: this.zlo,
      },
      instrStart: this.instrStart,
      programId: this.program?.id ?? null,
      seqKind: this.seqKind,
      mpc: this.mpc,
      status: this.status,
      machineCheckReason: this.machineCheckReason,
      exception: this.exception ? { ...this.exception } : null,
      inEntry: this.inEntry,
    };
  }

  setState(s: CpuState): void {
    this.r.set(s.r);
    this.pc = s.pc;
    this.ksp = s.ksp;
    this.usp = s.usp;
    this.psw = s.psw;
    this.vbase = s.vbase;
    this.ubase = s.ubase;
    this.ulimit = s.ulimit;
    this.cause = s.cause;
    this.faddr = s.faddr;
    this.kscratch = s.kscratch;
    const l = s.latches;
    this.ir = l.ir;
    this.opr = l.opr;
    this.imm = l.imm;
    this.mar = l.mar;
    this.mdr = l.mdr;
    this.a = l.a;
    this.b = l.b;
    this.y = l.y;
    this.aluPacked = l.aluPacked;
    this.t16 = l.t16;
    this.tmp = l.tmp;
    this.cint = l.cint;
    this.zlo = l.zlo;
    this.instrStart = s.instrStart;
    this.program = s.programId === null ? null : programById(s.programId);
    this.seqKind = s.seqKind;
    this.mpc = s.mpc;
    this.status = s.status;
    this.machineCheckReason = s.machineCheckReason;
    this.exception = s.exception ? { ...s.exception } : null;
    this.inEntry = s.inEntry;
    this.faulted = false;
    this.def = this.program?.kind === 'instruction' && this.program.id.startsWith('op:') ? defFor(this.ir) : null;
    this.clearActivity();
  }
}

function defFor(opcode: number): InstructionDef | null {
  return OPCODE_TABLE[opcode] ?? null;
}
