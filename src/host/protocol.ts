/**
 * Messages between the UI and the machine host (normally a Web Worker).
 *
 * The host owns the single authoritative Machine. The UI never touches it
 * directly: it sends commands and renders the MachineView snapshots it
 * receives. Views are throttled while running.
 */
import type { MachineConfig, MachineSnapshot, BreakOnException, RunResult } from '../core/machine/machine';
import type { MachineEvent, TraceEntry } from '../core/machine/trace';
import type { ProcessInfo, TimelineMarker, TimelineSegment } from '../core/os/awareness';
import type { CpuStatus } from '../core/cpu/types';

/** What the workbench loads into the machine: the configuration plus debug information. */
export interface LoadRequest {
  config: MachineConfig;
  /** Label/constant symbols for disassembly and OS awareness. */
  symbols: Record<string, number>;
  /** Kernel symbols for OS-aware views (OS profile only). */
  kernelSymbols: Record<string, number> | null;
  label: string;
}

export type SpeedSetting = number | 'max';

export type Command =
  | { type: 'load'; request: LoadRequest }
  | { type: 'powerOn' }
  | { type: 'reset' }
  /** Run; with `until`, stop before the instruction at that address executes (one-shot breakpoint). */
  | { type: 'run'; until?: number }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'stepInstruction' }
  | { type: 'stepMicro' }
  | { type: 'setSpeed'; speed: SpeedSetting }
  | { type: 'setBreakpoints'; addresses: number[] }
  | { type: 'setWatchpoints'; watchpoints: [number, 'r' | 'w' | 'rw'][] }
  | { type: 'setBreakOn'; breakOn: BreakOnException }
  | { type: 'setTrace'; enabled: boolean; capacity: number }
  | { type: 'clearTrace' }
  | { type: 'injectKeys'; bytes: number[] }
  | { type: 'setSwitches'; value: number }
  | { type: 'poke'; address: number; value: number }
  | { type: 'setRegister'; name: string; value: number }
  | { type: 'restore'; snapshot: MachineSnapshot }
  | { type: 'requestView' };

export type Request =
  | { type: 'snapshot' }
  | { type: 'getTrace' }
  | { type: 'getEvents' }
  | { type: 'getDisk' }
  /** No-op round trip: resolves after every earlier command's view has been delivered. */
  | { type: 'sync' }
  /**
   * Run `cycles` cycles synchronously. With `ignoreDebugStops`, breakpoints,
   * watchpoints and break-on-exception settings are suspended for this run
   * (automated example checks run the whole budget).
   */
  | { type: 'runDeterministic'; cycles: number; ignoreDebugStops?: boolean };

export type ToHost = { kind: 'command'; command: Command } | { kind: 'request'; id: number; request: Request };

export type FromHost =
  | { kind: 'view'; view: MachineView }
  | { kind: 'response'; id: number; ok: boolean; value?: unknown; error?: string }
  | { kind: 'error'; message: string };

export interface MicroOpView {
  name: string;
  rtl: string;
}

export interface CpuView {
  r: number[];
  pc: number;
  sp: number;
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
    t16: number;
    tmp: number;
  };
  status: CpuStatus;
  machineCheckReason: string;
  /** Address of the instruction/sequence in progress (or about to start). */
  instrStart: number;
  /** Kind and micro-operations of the current sequence; `mpc` = index of the next micro-op. */
  sequence: { kind: string; ops: MicroOpView[]; mpc: number; mnemonic: string | null } | null;
  /** The most recently executed micro-operation and what it did. */
  lastOp: {
    name: string;
    rtl: string;
    units: string[];
    bus: { addr: number; data: number; op: string };
    alu: { op: string; a: number; b: number; y: number; flags: number } | null;
    fault: { cause: number; addr: number } | null;
  } | null;
  pendingException: { vector: number; cause: number; faddr: number } | null;
}

export interface DeviceView {
  timer: { ctrl: number; expired: boolean; reload: number; count: number; expirations: number; irq: boolean };
  terminal: { lines: string[]; current: string; col: number; bytesWritten: number };
  keyboard: { queue: number[]; overflow: boolean; ctrl: number; received: number; irq: boolean };
  gpio: { leds: number; switches: number; ledWrites: number };
  storage: {
    status: number;
    block: number;
    errcode: number;
    ctrl: number;
    busyCycles: number;
    ptr: number;
    reads: number;
    writes: number;
    irq: boolean;
  };
  pic: { pending: number; mask: number };
}

export type RunState = 'running' | 'paused';

export interface MachineView {
  seq: number;
  label: string;
  loaded: boolean;
  runState: RunState;
  speed: SpeedSetting;
  /** Why the last run stopped (null while running or before the first run). */
  stop: { reason: RunResult['reason'] | 'user'; detail?: string } | null;
  cycle: number;
  instructions: number;
  modeCycles: { supervisor: number; user: number; idle: number };
  /** Measured simulated cycles per real second (while running). */
  measuredHz: number;
  cpu: CpuView;
  memory: Uint8Array;
  devices: DeviceView;
  trace: TraceEntry[];
  traceTotal: number;
  events: MachineEvent[];
  breakpoints: number[];
  watchpoints: [number, 'r' | 'w' | 'rw'][];
  breakOn: BreakOnException;
  traceEnabled: boolean;
  traceCapacity: number;
  lastWatchHit: { addr: number; kind: string; value: number; pc: number; cycle: number } | null;
  os: {
    processes: ProcessInfo[];
    current: number | null;
    segments: TimelineSegment[];
    markers: TimelineMarker[];
    ticks: number;
  } | null;
  inputLogLength: number;
}
