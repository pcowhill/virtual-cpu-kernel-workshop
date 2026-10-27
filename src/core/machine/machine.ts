import { Cpu, type CpuState } from '../cpu/cpu';
import { CAUSE, MEM, PSW, VECTOR } from '../isa/constants';
import { OPCODE_TABLE } from '../isa/opcodes';
import { base64ToBytes, bytesToBase64 } from '../devices/device';
import { Gpio, type GpioState } from '../devices/gpio';
import { Keyboard, type KeyboardState } from '../devices/keyboard';
import { Storage, type StorageState } from '../devices/storage';
import {
  InterruptController,
  SystemControl,
  type InterruptControllerState,
  type SystemControlState,
} from '../devices/system';
import { Terminal, type TerminalState } from '../devices/terminal';
import { Timer, type TimerState } from '../devices/timer';
import { Bus } from './bus';
import { Ring, type MachineEvent, type MemWrite, type RegChange, type TraceEntry } from './trace';

export interface MemorySegment {
  address: number;
  bytes: Uint8Array;
}

/**
 * What exists before power-on: the contents of the boot ROM chip, the storage
 * medium, and (for bare-metal experiments only) RAM contents written by the
 * workbench acting as a hardware programmer.
 */
export interface MachineConfig {
  rom: MemorySegment[];
  preload?: MemorySegment[];
  disk?: Uint8Array | null;
  switches?: number;
}

export type StopReason =
  'budget' | 'breakpoint' | 'watchpoint' | 'exception' | 'machine-check' | 'power-off' | 'halted' | 'instruction-limit';

export interface RunResult {
  reason: StopReason;
  cycles: number;
  instructions: number;
  detail?: string;
}

export interface WatchHit {
  addr: number;
  kind: 'read' | 'write';
  value: number;
  pc: number;
  cycle: number;
}

export interface BreakOnException {
  faults: boolean;
  traps: boolean;
  interrupts: boolean;
}

export interface MachineSnapshot {
  format: 'vc8-machine-snapshot';
  version: 1;
  cycle: number;
  instructions: number;
  memory: string;
  cpu: CpuState;
  devices: {
    pic: InterruptControllerState;
    sysctl: SystemControlState;
    timer: TimerState;
    terminal: TerminalState;
    keyboard: KeyboardState;
    gpio: GpioState;
    storage: StorageState;
  };
  inputLog: InputRecord[];
  modeCycles: { supervisor: number; user: number; idle: number };
}

export interface InputRecord {
  cycle: number;
  device: 'keyboard' | 'switches';
  value: number;
}

const DEFAULT_TRACE_CAPACITY = 2000;
const DEFAULT_EVENT_CAPACITY = 5000;
/** Safety cap for a single instruction-step while the CPU waits for an interrupt. */
export const IDLE_STEP_LIMIT = 1_000_000;

/**
 * The complete virtual computer: CPU, bus, memory and devices, plus the
 * observation facilities (trace, events, breakpoints, watchpoints). Execution is
 * strictly one clock cycle per micro-operation; devices tick after each cycle.
 */
export class Machine {
  readonly bus = new Bus();
  readonly timer = new Timer();
  readonly terminal = new Terminal();
  readonly keyboard = new Keyboard();
  readonly gpio = new Gpio();
  readonly storage = new Storage();
  readonly pic = new InterruptController([this.timer, this.keyboard, this.storage]);
  readonly sysctl = new SystemControl(
    () => this.cycle,
    () => this.powerOff(),
  );
  readonly cpu: Cpu;

  cycle = 0;
  instructions = 0;
  readonly modeCycles = { supervisor: 0, user: 0, idle: 0 };

  // ---- debugger state ----
  readonly breakpoints = new Set<number>();
  readonly watchpoints = new Map<number, 'r' | 'w' | 'rw'>();
  breakOn: BreakOnException = { faults: true, traps: false, interrupts: false };
  traceEnabled = true;
  readonly trace = new Ring<TraceEntry>(DEFAULT_TRACE_CAPACITY);
  readonly events = new Ring<MachineEvent>(DEFAULT_EVENT_CAPACITY);
  inputLog: InputRecord[] = [];
  /** Listeners notified synchronously of every machine event. */
  readonly eventListeners: ((e: MachineEvent) => void)[] = [];

  lastWatchHit: WatchHit | null = null;
  private watchTriggered = false;
  private exceptionTriggered = false;
  private traceSeq = 0;

  // per-sequence trace bookkeeping
  private seqStartCycle = 0;
  private seqRegs = new Array<number>(16).fill(0);
  private seqMem: MemWrite[] = [];
  private seqSupervisor = true;
  private seqException: { vector: number; cause: number; faddr: number } | null = null;
  private seqFault: { cause: number; addr: number } | null = null;
  private seqActive = false;

  constructor() {
    this.cpu = new Cpu(this.bus, this.pic);
    this.bus.attach(this.sysctl);
    this.bus.attach(this.pic);
    this.bus.attach(this.timer);
    this.bus.attach(this.terminal);
    this.bus.attach(this.keyboard);
    this.bus.attach(this.gpio);
    this.bus.attach(this.storage);
    this.bus.observer = (addr, kind, value, old) => this.onBusAccess(addr, kind, value, old);
    this.blankMemory();
  }

  // =====================================================================
  // Power and reset
  // =====================================================================

  private blankMemory(): void {
    this.bus.mem.fill(0);
    this.bus.mem.fill(0xff, MEM.ROM_START, MEM.ROM_END + 1);
    this.bus.mem.fill(0, MEM.MMIO_START);
  }

  /** Power on with the given configuration. All volatile state is cleared. */
  powerOn(config: MachineConfig): void {
    this.blankMemory();
    for (const seg of config.rom) {
      assertWithin(seg, MEM.ROM_START, MEM.ROM_END, 'ROM image');
      this.bus.mem.set(seg.bytes, seg.address);
    }
    for (const seg of config.preload ?? []) {
      assertWithin(seg, MEM.KRAM_START, MEM.URAM_END, 'RAM preload');
      this.bus.mem.set(seg.bytes, seg.address);
    }
    this.storage.image.fill(0);
    if (config.disk) this.storage.loadImage(config.disk);
    for (const d of this.bus.devices) d.reset();
    this.gpio.setSwitches(config.switches ?? 0);
    this.cpu.reset();
    this.cycle = 0;
    this.instructions = 0;
    this.modeCycles.supervisor = this.modeCycles.user = this.modeCycles.idle = 0;
    this.trace.clear();
    this.events.clear();
    this.inputLog = [];
    this.lastWatchHit = null;
    this.seqActive = false;
    this.emit({ cycle: 0, type: 'reset', pc: 0, detail: 'power on' });
  }

  /** Reset button: CPU and device registers reset; RAM and the storage medium are kept. */
  reset(): void {
    for (const d of this.bus.devices) d.reset();
    this.cpu.reset();
    this.seqActive = false;
    this.emit({ cycle: this.cycle, type: 'reset', pc: 0, detail: 'reset button' });
  }

  private powerOff(): void {
    this.cpu.status = 'off';
    this.emit({ cycle: this.cycle, type: 'power-off', pc: this.cpu.pc });
  }

  // =====================================================================
  // Host inputs (deterministically time-stamped with the current cycle)
  // =====================================================================

  injectKey(byte: number): boolean {
    this.inputLog.push({ cycle: this.cycle, device: 'keyboard', value: byte & 0xff });
    this.emit({ cycle: this.cycle, type: 'input', pc: this.cpu.pc, detail: `key 0x${hex2(byte)}` });
    return this.keyboard.inject(byte);
  }

  setSwitches(value: number): void {
    this.inputLog.push({ cycle: this.cycle, device: 'switches', value: value & 0xff });
    this.gpio.setSwitches(value);
  }

  // =====================================================================
  // Observation
  // =====================================================================

  private emit(e: MachineEvent): void {
    this.events.push(e);
    for (const l of this.eventListeners) l(e);
  }

  private onBusAccess(addr: number, kind: 'read' | 'write', value: number, old: number): void {
    if (kind === 'write' && this.seqActive && this.traceEnabled) this.seqMem.push({ addr, old, new: value });
    if (this.watchpoints.size) {
      const w = this.watchpoints.get(addr);
      if (w && (w === 'rw' || (w === 'r' && kind === 'read') || (w === 'w' && kind === 'write'))) {
        this.watchTriggered = true;
        this.lastWatchHit = { addr, kind, value, pc: this.cpu.instrStart, cycle: this.cycle };
      }
    }
  }

  private regVector(out: number[]): void {
    const c = this.cpu;
    for (let i = 0; i < 8; i++) out[i] = c.r[i]!;
    out[8] = c.pc;
    out[9] = c.ksp;
    out[10] = c.usp;
    out[11] = c.psw;
    out[12] = c.vbase;
    out[13] = c.ubase;
    out[14] = c.ulimit;
    out[15] = (c.cause << 16) | c.faddr;
  }

  private static readonly REG_NAMES = [
    'R0',
    'R1',
    'R2',
    'R3',
    'R4',
    'R5',
    'R6',
    'R7',
    'PC',
    'KSP',
    'USP',
    'PSW',
    'VBASE',
    'UBASE',
    'ULIMIT',
    'CAUSE/FADDR',
  ];

  private beginTraceSequence(): void {
    this.seqActive = true;
    this.seqStartCycle = this.cycle;
    this.seqSupervisor = this.cpu.supervisor;
    this.seqMem = [];
    this.seqFault = null;
    const ex = this.cpu.exception;
    this.seqException = ex ? { vector: ex.vector, cause: ex.cause, faddr: ex.faddr } : null;
    if (this.traceEnabled) this.regVector(this.seqRegs);
  }

  private endTraceSequence(kind: TraceEntry['kind']): void {
    this.seqActive = false;
    if (!this.traceEnabled) return;
    const regs: RegChange[] = [];
    const now = new Array<number>(16);
    this.regVector(now);
    for (let i = 0; i < 16; i++) {
      if (i === 8 && kind === 'instruction') continue; // PC always advances; shown separately
      if (now[i] !== this.seqRegs[i]) {
        if (i === 15) {
          regs.push({ name: 'CAUSE', old: this.seqRegs[i]! >> 16, new: now[i]! >> 16 });
          regs.push({ name: 'FADDR', old: this.seqRegs[i]! & 0xffff, new: now[i]! & 0xffff });
        } else regs.push({ name: Machine.REG_NAMES[i]!, old: this.seqRegs[i]!, new: now[i]! });
      }
    }
    const pc = this.cpu.instrStart;
    const entry: TraceEntry = {
      seq: this.traceSeq++,
      kind,
      cycle: this.seqStartCycle,
      cycles: this.cycle - this.seqStartCycle,
      pc,
      bytes: [],
      supervisor: this.seqSupervisor,
      regs: regs.filter((r) => r.old !== r.new),
      mem: this.seqMem,
    };
    if (kind === 'instruction') {
      const len = OPCODE_TABLE[this.bus.peek(pc)]?.length ?? 1;
      for (let i = 0; i < len; i++) entry.bytes.push(this.bus.peek((pc + i) & 0xffff));
    }
    if (this.seqException) entry.exception = this.seqException;
    if (this.seqFault) entry.fault = this.seqFault;
    if (kind === 'idle') {
      const prev = this.trace.toArray().at(-1);
      if (prev && prev.kind === 'idle' && prev.cycle + prev.cycles === entry.cycle) {
        prev.cycles += entry.cycles;
        prev.idleCycles = (prev.idleCycles ?? 1) + 1;
        return;
      }
      entry.idleCycles = 1;
    }
    this.trace.push(entry);
  }

  // =====================================================================
  // Execution
  // =====================================================================

  /** Kind of the sequence that will start at the next boundary (no side effects). */
  nextSequenceKind(): TraceEntry['kind'] | null {
    const c = this.cpu;
    if (c.halted) return null;
    if (c.program) return c.program.kind;
    if (c.exception) return 'exception';
    const lines = this.pic.pendingEnabled();
    if (c.status === 'waiting' && lines === 0) return 'idle';
    if (lines !== 0 && c.psw & PSW.I) return 'exception';
    return 'instruction';
  }

  /**
   * Execute one clock cycle (one micro-operation).
   * @returns 'none' if the CPU is stopped, 'cycle' if mid-sequence, 'end' if a sequence completed.
   */
  microStep(): 'none' | 'cycle' | 'end' {
    const cpu = this.cpu;
    if (cpu.halted) return 'none';
    const startingSequence = cpu.program === null;
    if (startingSequence) this.beginTraceSequence();
    const wasWaiting = cpu.status === 'waiting';
    const supervisorBefore = cpu.supervisor;
    const ended = cpu.microStep();
    const kind: TraceEntry['kind'] = cpu.seqKind;
    if (startingSequence && this.seqException === null && cpu.exception && kind === 'exception') {
      const ex = cpu.exception;
      this.seqException = { vector: ex.vector, cause: ex.cause, faddr: ex.faddr };
    }
    if (kind === 'idle') this.modeCycles.idle++;
    else if (supervisorBefore) this.modeCycles.supervisor++;
    else this.modeCycles.user++;
    this.cycle++;
    this.timer.tick();
    this.storage.tick();

    const act = cpu.activity;
    if (act.fault && cpu.status !== 'machine-check') {
      this.seqFault = { ...act.fault };
      if (this.breakOn.faults) this.exceptionTriggered = true;
    }
    if (wasWaiting && cpu.status === 'running') {
      this.emit({ cycle: this.cycle, type: 'wake', pc: cpu.pc });
    }
    if (!ended) return 'cycle';

    // ---- a sequence completed ----
    if (cpu.status === 'machine-check') {
      this.emit({ cycle: this.cycle, type: 'machine-check', pc: cpu.pc, detail: cpu.machineCheckReason });
    }
    if (kind === 'instruction') {
      if (!act.fault) this.instructions++;
      const d = cpu.def;
      if (d && !act.fault) {
        if (d.family === 'rti') {
          this.emit({
            cycle: this.cycle,
            type: 'rti',
            pc: cpu.pc,
            toUser: !cpu.supervisor,
            ubase: cpu.ubase,
          });
        } else if (d.family === 'hlt') {
          this.emit({ cycle: this.cycle, type: 'halt', pc: cpu.pc });
        } else if (d.family === 'mtc' && supervisorBefore !== cpu.supervisor) {
          this.emit({ cycle: this.cycle, type: 'mode', pc: cpu.pc, toUser: !cpu.supervisor });
        } else if ((d.family === 'sys' || d.family === 'brk') && this.breakOn.traps) {
          this.exceptionTriggered = true;
        }
      }
    } else if (kind === 'exception' && this.seqException && cpu.status !== 'machine-check') {
      const ex = this.seqException;
      // Saved PC is in the frame just pushed: [SP+1] lo, [SP+2] hi; saved PSW at [SP].
      const sp = cpu.ksp;
      const savedPsw = this.bus.peek(sp);
      const fromPc = this.bus.peekWord((sp + 1) & 0xffff);
      const fromUser = (savedPsw & PSW.S) === 0;
      this.emit({
        cycle: this.cycle,
        type: 'exception',
        pc: cpu.pc,
        vector: ex.vector,
        cause: ex.cause,
        faddr: ex.faddr,
        fromPc,
        fromUser,
        r0: ex.vector === VECTOR.SYSCALL ? cpu.r[0] : undefined,
        ubase: cpu.ubase,
      });
      if (ex.vector >= VECTOR.IRQ_BASE && this.breakOn.interrupts) this.exceptionTriggered = true;
    }
    this.endTraceSequence(kind);
    return 'end';
  }

  /**
   * Execute until the current sequence (instruction, exception entry, reset) completes.
   * If the CPU is waiting for an interrupt, idles until it wakes (bounded).
   */
  stepInstruction(): RunResult {
    const startCycle = this.cycle;
    const startInstr = this.instructions;
    if (this.cpu.halted) return this.result('halted', startCycle, startInstr);
    let idle = 0;
    for (;;) {
      const r = this.microStep();
      if (r === 'none') return this.result('halted', startCycle, startInstr);
      if (r !== 'end') continue;
      if (this.cpu.status === 'machine-check') return this.result('machine-check', startCycle, startInstr);
      if (this.cpu.status === 'off') return this.result('power-off', startCycle, startInstr);
      if (this.cpu.seqKind !== 'idle') break;
      if (this.pic.mask === 0)
        return this.result('halted', startCycle, startInstr, 'CPU halted with no interrupt lines enabled');
      if (++idle >= IDLE_STEP_LIMIT)
        return this.result('halted', startCycle, startInstr, 'still waiting for an interrupt');
    }
    this.watchTriggered = false;
    this.exceptionTriggered = false;
    return this.result('budget', startCycle, startInstr);
  }

  private result(reason: StopReason, startCycle: number, startInstr: number, detail?: string): RunResult {
    return { reason, cycles: this.cycle - startCycle, instructions: this.instructions - startInstr, detail };
  }

  /**
   * Run until a stop condition or until `maxCycles` cycles have elapsed.
   * Breakpoints stop *before* the instruction at the breakpoint address executes;
   * the instruction under the PC when run() is called is never treated as a breakpoint.
   */
  run(maxCycles: number, maxInstructions = Infinity): RunResult {
    const startCycle = this.cycle;
    const startInstr = this.instructions;
    const cpu = this.cpu;
    this.watchTriggered = false;
    this.exceptionTriggered = false;
    let first = true;
    const hasBreakpoints = () => this.breakpoints.size > 0;
    while (this.cycle - startCycle < maxCycles) {
      if (cpu.halted) {
        return this.result(
          cpu.status === 'off' ? 'power-off' : 'machine-check',
          startCycle,
          startInstr,
          cpu.machineCheckReason || undefined,
        );
      }
      if (cpu.program === null) {
        if (this.instructions - startInstr >= maxInstructions)
          return this.result('instruction-limit', startCycle, startInstr);
        if (!first && hasBreakpoints() && this.breakpoints.has(cpu.pc) && this.nextSequenceKind() === 'instruction') {
          return this.result('breakpoint', startCycle, startInstr, `breakpoint at 0x${hex4(cpu.pc)}`);
        }
        if (cpu.status === 'waiting' && this.pic.mask === 0) {
          return this.result('halted', startCycle, startInstr, 'CPU halted with no interrupt lines enabled');
        }
      }
      first = false;
      const r = this.microStep();
      if (r === 'end') {
        if (this.watchTriggered) {
          this.watchTriggered = false;
          const w = this.lastWatchHit!;
          return this.result(
            'watchpoint',
            startCycle,
            startInstr,
            `${w.kind} of 0x${hex2(w.value)} at 0x${hex4(w.addr)} by instruction at 0x${hex4(w.pc)}`,
          );
        }
        if (this.exceptionTriggered) {
          this.exceptionTriggered = false;
          return this.result('exception', startCycle, startInstr, this.describePendingException());
        }
      }
    }
    return this.result('budget', startCycle, startInstr);
  }

  private describePendingException(): string {
    const ex = this.cpu.exception;
    const last = this.events.toArray().at(-1);
    if (ex) {
      return `${causeLabel(ex.cause)} at 0x${hex4(this.cpu.pc)}${ex.vector === VECTOR.MEMORY ? ` (address 0x${hex4(ex.faddr)})` : ''} — the CPU will enter vector ${ex.vector}`;
    }
    if (last?.type === 'exception') return `entered vector ${last.vector} (${causeLabel(last.cause ?? 0)})`;
    return 'exception';
  }

  // =====================================================================
  // Debugger interventions (clearly not guest behaviour)
  // =====================================================================

  /** Debugger write to RAM or ROM (bypasses protection; not allowed on MMIO). */
  debugPoke(addr: number, value: number): void {
    addr &= 0xffff;
    if (addr >= MEM.MMIO_START) throw new Error('debugger cannot poke device registers');
    this.bus.mem[addr] = value & 0xff;
  }

  // =====================================================================
  // Snapshots
  // =====================================================================

  snapshot(): MachineSnapshot {
    return {
      format: 'vc8-machine-snapshot',
      version: 1,
      cycle: this.cycle,
      instructions: this.instructions,
      memory: bytesToBase64(this.bus.mem),
      cpu: this.cpu.getState(),
      devices: {
        pic: this.pic.getState(),
        sysctl: this.sysctl.getState(),
        timer: this.timer.getState(),
        terminal: this.terminal.getState(),
        keyboard: this.keyboard.getState(),
        gpio: this.gpio.getState(),
        storage: this.storage.getState(),
      },
      inputLog: this.inputLog.map((r) => ({ ...r })),
      modeCycles: { ...this.modeCycles },
    };
  }

  restore(s: MachineSnapshot): void {
    if (s.format !== 'vc8-machine-snapshot' || s.version !== 1) throw new Error('incompatible machine snapshot');
    const mem = base64ToBytes(s.memory);
    if (mem.length !== MEM.SIZE) throw new Error('snapshot memory image has the wrong size');
    this.bus.mem.set(mem);
    this.cpu.setState(s.cpu);
    this.pic.setState(s.devices.pic);
    this.sysctl.setState(s.devices.sysctl);
    this.timer.setState(s.devices.timer);
    this.terminal.setState(s.devices.terminal);
    this.keyboard.setState(s.devices.keyboard);
    this.gpio.setState(s.devices.gpio);
    this.storage.setState(s.devices.storage);
    this.cycle = s.cycle;
    this.instructions = s.instructions;
    this.inputLog = s.inputLog.map((r) => ({ ...r }));
    Object.assign(this.modeCycles, s.modeCycles);
    this.seqActive = false;
    this.trace.clear();
    this.events.clear();
  }
}

function assertWithin(seg: MemorySegment, lo: number, hi: number, what: string): void {
  if (seg.address < lo || seg.address + seg.bytes.length - 1 > hi) {
    throw new Error(
      `${what} segment 0x${hex4(seg.address)}–0x${hex4(seg.address + seg.bytes.length - 1)} lies outside 0x${hex4(lo)}–0x${hex4(hi)}`,
    );
  }
}

export function hex2(v: number): string {
  return (v & 0xff).toString(16).toUpperCase().padStart(2, '0');
}
export function hex4(v: number): string {
  return (v & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

function causeLabel(cause: number): string {
  switch (cause) {
    case CAUSE.ILLEGAL_INSTRUCTION:
      return 'illegal instruction';
    case CAUSE.PRIVILEGED_INSTRUCTION:
      return 'privileged instruction in user mode';
    case CAUSE.READ_VIOLATION:
      return 'read protection violation';
    case CAUSE.WRITE_VIOLATION:
      return 'write protection violation';
    case CAUSE.FETCH_VIOLATION:
      return 'fetch protection violation';
    case CAUSE.ROM_WRITE:
      return 'write to ROM';
    case CAUSE.BUS_ERROR:
      return 'bus error';
    case CAUSE.SYSCALL:
      return 'system call';
    case CAUSE.BREAKPOINT:
      return 'BRK trap';
    default:
      return cause >= CAUSE.IRQ_BASE ? `interrupt request ${cause - CAUSE.IRQ_BASE}` : 'exception';
  }
}
export { causeLabel };
