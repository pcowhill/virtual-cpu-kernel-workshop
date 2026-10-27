/**
 * OS awareness for the debugger: decode the Workshop Kernel's data
 * structures from guest memory using the kernel's own symbol table, and
 * build a scheduling timeline from hardware events.
 *
 * This is observation only. Nothing here changes guest state; the kernel
 * alone decides what runs. If the kernel source is edited so that symbols
 * are missing, the views degrade gracefully (return null / empty).
 */
import type { MachineEvent } from '../machine/trace';

export type PeekFn = (addr: number) => number;

export const PROCESS_STATES = ['free', 'ready', 'running', 'blocked', 'exited'] as const;
export type ProcessStateName = (typeof PROCESS_STATES)[number] | 'unknown';
export const WAIT_REASONS = ['none', 'keyboard', 'sleep'] as const;

export interface SavedFrame {
  frameAddress: number;
  usp: number;
  regs: number[]; // R0..R7
  psw: number;
  pc: number;
}

export interface ProcessInfo {
  index: number;
  pid: number;
  name: string;
  state: ProcessStateName;
  stateCode: number;
  wait: string;
  exitCode: number;
  ksp: number;
  base: number;
  limit: number;
  entry: number;
  sleep: number;
  ticks: number;
  runs: number;
  syscalls: number;
  faultCause: number;
  slot: number;
  /** The trap frame saved on the process's kernel stack (absent while it runs). */
  frame: SavedFrame | null;
}

export interface KernelLayout {
  procTable: number;
  current: number;
  ticks: number;
  maxProcs: number;
  pcbSize: number;
  off: Record<string, number>;
}

const PCB_FIELDS = [
  'PCB_PID',
  'PCB_STATE',
  'PCB_WAIT',
  'PCB_EXIT',
  'PCB_KSP',
  'PCB_BASE',
  'PCB_LIMIT',
  'PCB_ENTRY',
  'PCB_SLEEP',
  'PCB_TICKS',
  'PCB_RUNS',
  'PCB_SYSCALLS',
  'PCB_NAME',
  'PCB_FAULT',
  'PCB_SLOT',
] as const;

/** Extract the kernel data layout from its symbol table; null if it is not a compatible kernel. */
export function kernelLayout(symbols: Record<string, number>): KernelLayout | null {
  const need = ['proc_table', 'current', 'ticks', 'MAX_PROCS', 'PCB_SIZE', ...PCB_FIELDS];
  if (!need.every((n) => symbols[n] !== undefined)) return null;
  const off: Record<string, number> = {};
  for (const f of PCB_FIELDS) off[f] = symbols[f]!;
  return {
    procTable: symbols['proc_table']!,
    current: symbols['current']!,
    ticks: symbols['ticks']!,
    maxProcs: symbols['MAX_PROCS']!,
    pcbSize: symbols['PCB_SIZE']!,
    off,
  };
}

function word(peek: PeekFn, a: number): number {
  return peek(a & 0xffff) | (peek((a + 1) & 0xffff) << 8);
}

export function readProcessTable(peek: PeekFn, layout: KernelLayout): ProcessInfo[] {
  const out: ProcessInfo[] = [];
  const current = peek(layout.current);
  for (let i = 0; i < layout.maxProcs; i++) {
    const p = layout.procTable + i * layout.pcbSize;
    const o = layout.off;
    const stateCode = peek(p + o['PCB_STATE']!);
    if (stateCode === 0) continue;
    let name = '';
    for (let k = 0; k < 8; k++) {
      const c = peek(p + o['PCB_NAME']! + k);
      if (c === 0) break;
      name += String.fromCharCode(c);
    }
    const ksp = word(peek, p + o['PCB_KSP']!);
    const state = (PROCESS_STATES[stateCode] ?? 'unknown') as ProcessStateName;
    const running = state === 'running' && current === i;
    out.push({
      index: i,
      pid: peek(p + o['PCB_PID']!),
      name,
      state,
      stateCode,
      wait: WAIT_REASONS[peek(p + o['PCB_WAIT']!)] ?? 'unknown',
      exitCode: peek(p + o['PCB_EXIT']!),
      ksp,
      base: word(peek, p + o['PCB_BASE']!),
      limit: word(peek, p + o['PCB_LIMIT']!),
      entry: word(peek, p + o['PCB_ENTRY']!),
      sleep: peek(p + o['PCB_SLEEP']!),
      ticks: word(peek, p + o['PCB_TICKS']!),
      runs: word(peek, p + o['PCB_RUNS']!),
      syscalls: word(peek, p + o['PCB_SYSCALLS']!),
      faultCause: peek(p + o['PCB_FAULT']!),
      slot: peek(p + o['PCB_SLOT']!),
      frame:
        running || state === 'exited'
          ? null
          : {
              frameAddress: ksp,
              usp: word(peek, ksp),
              regs: [9, 8, 7, 6, 5, 4, 3, 2].map((d) => peek(ksp + d)),
              psw: peek(ksp + 10),
              pc: word(peek, ksp + 11),
            },
    });
  }
  return out;
}

/** Index of the running process, or null when idle / unknown. */
export function currentProcess(peek: PeekFn, layout: KernelLayout): number | null {
  const c = peek(layout.current);
  return c < layout.maxProcs ? c : null;
}

// ---------------------------------------------------------------------------
// Scheduling timeline
// ---------------------------------------------------------------------------

export interface TimelineSegment {
  /** Process index, or -1 for kernel/idle time. */
  index: number;
  pid: number;
  name: string;
  start: number;
  end: number;
  kind: 'user' | 'kernel' | 'idle';
}

export type MarkerKind = 'timer' | 'syscall' | 'fault' | 'keyboard' | 'switch' | 'exit' | 'irq';

export interface TimelineMarker {
  cycle: number;
  kind: MarkerKind;
  index: number;
  pid: number;
  detail: string;
  /** PC involved (interrupted PC or resumed PC). */
  pc: number;
}

/**
 * Builds a timeline of which process the CPU executed over simulated time,
 * purely from hardware events (exception entry, RTI, HLT) plus the kernel's
 * own `current` variable read at RTI time.
 */
export class SchedulingTimeline {
  segments: TimelineSegment[] = [];
  markers: TimelineMarker[] = [];
  private open: TimelineSegment | null = null;
  private lastUserIndex = -1;
  private states = new Map<number, string>();

  constructor(
    private readonly peek: PeekFn,
    private readonly layout: KernelLayout,
    private readonly maxSegments = 4000,
  ) {}

  reset(): void {
    this.segments = [];
    this.markers = [];
    this.open = null;
    this.lastUserIndex = -1;
    this.states.clear();
  }

  private procName(index: number): { pid: number; name: string } {
    if (index < 0) return { pid: 0, name: 'kernel' };
    const p = readProcessTable(this.peek, this.layout).find((x) => x.index === index);
    return { pid: p?.pid ?? index + 1, name: p?.name ?? `#${index}` };
  }

  private begin(kind: TimelineSegment['kind'], index: number, cycle: number): void {
    this.close(cycle);
    const { pid, name } = kind === 'user' ? this.procName(index) : { pid: 0, name: kind };
    this.open = { index: kind === 'user' ? index : -1, pid, name, start: cycle, end: cycle, kind };
  }

  private close(cycle: number): void {
    if (!this.open) return;
    this.open.end = cycle;
    if (this.open.end > this.open.start) {
      const prev = this.segments.at(-1);
      if (prev && prev.kind === this.open.kind && prev.index === this.open.index && prev.end === this.open.start) {
        prev.end = this.open.end;
      } else {
        this.segments.push(this.open);
        if (this.segments.length > this.maxSegments) this.segments.shift();
      }
    }
    this.open = null;
  }

  private marker(m: TimelineMarker): void {
    this.markers.push(m);
    if (this.markers.length > this.maxSegments) this.markers.shift();
  }

  private checkExits(cycle: number): void {
    for (const p of readProcessTable(this.peek, this.layout)) {
      const prev = this.states.get(p.index);
      if (prev !== p.state && p.state === 'exited') {
        this.marker({
          cycle,
          kind: p.faultCause ? 'fault' : 'exit',
          index: p.index,
          pid: p.pid,
          detail: p.faultCause ? `killed (cause 0x${p.faultCause.toString(16)})` : `exit code ${p.exitCode}`,
          pc: 0,
        });
      }
      this.states.set(p.index, p.state);
    }
  }

  /** Feed a machine event. */
  onEvent(e: MachineEvent): void {
    if (e.type === 'exception') {
      const idx = e.fromUser ? this.lastUserIndex : -1;
      const { pid } = this.procName(idx);
      const kind: MarkerKind =
        e.vector === 8
          ? 'timer'
          : e.vector === 9
            ? 'keyboard'
            : e.vector === 4
              ? 'syscall'
              : e.vector! >= 8
                ? 'irq'
                : 'fault';
      const detail =
        kind === 'syscall'
          ? `syscall ${e.r0}`
          : kind === 'timer'
            ? 'timer interrupt'
            : kind === 'keyboard'
              ? 'keyboard interrupt'
              : kind === 'fault'
                ? `exception vector ${e.vector} (cause 0x${(e.cause ?? 0).toString(16)})`
                : `IRQ vector ${e.vector}`;
      if (e.fromUser || kind !== 'fault')
        this.marker({ cycle: e.cycle, kind, index: idx, pid, detail, pc: e.fromPc ?? 0 });
      this.begin('kernel', -1, e.cycle);
    } else if (e.type === 'rti' && e.toUser) {
      this.checkExits(e.cycle);
      const idx = currentProcess(this.peek, this.layout) ?? -1;
      if (idx !== this.lastUserIndex && idx >= 0) {
        const { pid, name } = this.procName(idx);
        this.marker({
          cycle: e.cycle,
          kind: 'switch',
          index: idx,
          pid,
          detail: `switch to pid ${pid} (${name})`,
          pc: e.pc,
        });
      }
      this.lastUserIndex = idx;
      this.begin('user', idx, e.cycle);
    } else if (e.type === 'halt') {
      this.checkExits(e.cycle);
      this.begin('idle', -1, e.cycle);
    } else if (e.type === 'wake') {
      this.begin('kernel', -1, e.cycle);
    } else if (e.type === 'reset') {
      this.reset();
    }
  }

  /** Close the open segment at `cycle` (for display) without ending it permanently. */
  snapshot(cycle: number): TimelineSegment[] {
    const segs = [...this.segments];
    if (this.open && cycle > this.open.start) segs.push({ ...this.open, end: cycle });
    return segs;
  }
}
