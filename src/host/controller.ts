/**
 * MachineController: owns the authoritative Machine and executes host
 * commands. It is transport-agnostic; the Web Worker and the in-thread
 * fallback host both wrap it.
 *
 * Speed control only decides how many simulated cycles run per real-time
 * slice. Results depend solely on the cycle count and on inputs, which are
 * time-stamped with the simulated cycle at which they arrive.
 */
import { Machine, type MachineConfig, type RunResult } from '../core/machine/machine';
import { unitNames } from '../core/cpu/types';
import { PREFIX_PROGRAM } from '../core/cpu/microcode';
import { CR } from '../core/isa/constants';
import {
  currentProcess,
  kernelLayout,
  readProcessTable,
  SchedulingTimeline,
  type KernelLayout,
} from '../core/os/awareness';
import type { Command, CpuView, LoadRequest, MachineView, Request, SpeedSetting } from './protocol';

export const DEFAULT_SPEED: SpeedSetting = 100_000;
const VIEW_TRACE = 300;
const VIEW_EVENTS = 300;
/** Real-time budget per slice at maximum speed (ms). */
const MAX_SPEED_SLICE_MS = 14;
/** Never try to catch up more than this much real time after a stall. */
const MAX_DT_MS = 100;

export class MachineController {
  readonly machine = new Machine();
  private config: MachineConfig | null = null;
  private label = 'No program loaded';
  private layout: KernelLayout | null = null;
  private timeline: SchedulingTimeline | null = null;
  runState: 'running' | 'paused' = 'paused';
  speed: SpeedSetting = DEFAULT_SPEED;
  private stop: MachineView['stop'] = null;
  private carry = 0;
  private lastTick = 0;
  private seq = 0;
  private hzWindow: { t: number; c: number }[] = [];
  private measuredHz = 0;
  /** Set by commands that change state while paused, so the host knows to publish a view. */
  dirty = true;

  constructor() {
    this.machine.eventListeners.push((e) => this.timeline?.onEvent(e));
  }

  // ------------------------------------------------------------------
  // Commands
  // ------------------------------------------------------------------

  handle(cmd: Command, now: number): void {
    const m = this.machine;
    this.dirty = true;
    switch (cmd.type) {
      case 'load':
        this.load(cmd.request);
        break;
      case 'powerOn':
        this.powerOn();
        break;
      case 'reset':
        m.reset();
        this.timeline?.reset();
        this.stop = null;
        break;
      case 'run':
        if (!this.config) return;
        if (m.cpu.halted) {
          this.stop = { reason: m.cpu.status === 'off' ? 'power-off' : 'machine-check', detail: m.cpu.machineCheckReason };
          return;
        }
        this.runState = 'running';
        this.stop = null;
        this.carry = 0;
        this.lastTick = now;
        this.hzWindow = [{ t: now, c: m.cycle }];
        break;
      case 'pause':
        if (this.runState === 'running') {
          this.runState = 'paused';
          this.stop = { reason: 'user', detail: 'paused' };
        }
        break;
      case 'stop':
        this.runState = 'paused';
        this.powerOn();
        this.stop = { reason: 'user', detail: 'stopped: machine returned to its power-on state' };
        break;
      case 'stepInstruction':
        if (this.runState === 'running' || !this.config) return;
        this.stop = this.toStop(m.stepInstruction());
        break;
      case 'stepMicro':
        if (this.runState === 'running' || !this.config) return;
        if (m.microStep() === 'none') this.stop = { reason: 'halted', detail: 'the CPU is not running' };
        else this.stop = null;
        break;
      case 'setSpeed':
        this.speed = cmd.speed;
        this.carry = 0;
        break;
      case 'setBreakpoints':
        m.breakpoints.clear();
        for (const a of cmd.addresses) m.breakpoints.add(a & 0xffff);
        break;
      case 'setWatchpoints':
        m.watchpoints.clear();
        for (const [a, k] of cmd.watchpoints) m.watchpoints.set(a & 0xffff, k);
        break;
      case 'setBreakOn':
        m.breakOn = { ...cmd.breakOn };
        break;
      case 'setTrace':
        m.traceEnabled = cmd.enabled;
        m.trace.resize(Math.max(0, Math.min(100_000, cmd.capacity)));
        break;
      case 'clearTrace':
        m.trace.clear();
        break;
      case 'injectKeys':
        for (const b of cmd.bytes) m.injectKey(b);
        break;
      case 'setSwitches':
        m.setSwitches(cmd.value);
        break;
      case 'poke':
        m.debugPoke(cmd.address, cmd.value);
        break;
      case 'setRegister':
        this.setRegister(cmd.name, cmd.value);
        break;
      case 'restore':
        this.runState = 'paused';
        m.restore(cmd.snapshot);
        this.timeline?.reset();
        this.stop = { reason: 'user', detail: 'snapshot restored' };
        break;
      case 'requestView':
        break;
    }
  }

  request(req: Request): unknown {
    const m = this.machine;
    switch (req.type) {
      case 'snapshot':
        return m.snapshot();
      case 'getTrace':
        return m.trace.toArray();
      case 'getEvents':
        return m.events.toArray();
      case 'getDisk':
        return m.storage.image.slice();
      case 'runDeterministic': {
        const r = m.run(req.cycles);
        this.dirty = true;
        return r;
      }
    }
  }

  private load(req: LoadRequest): void {
    this.config = req.config;
    this.label = req.label;
    this.layout = req.kernelSymbols ? kernelLayout(req.kernelSymbols) : null;
    this.timeline = this.layout ? new SchedulingTimeline((a) => this.machine.bus.peek(a), this.layout) : null;
    this.runState = 'paused';
    this.powerOn();
  }

  private powerOn(): void {
    if (!this.config) return;
    this.machine.powerOn(this.config);
    this.timeline?.reset();
    this.stop = null;
  }

  private setRegister(name: string, value: number): void {
    const c = this.machine.cpu;
    const up = name.toUpperCase();
    const r = /^R([0-7])$/.exec(up);
    if (r) c.r[Number(r[1])] = value & 0xff;
    else if (up === 'PC') c.pc = value & 0xffff;
    else if (up === 'SP') c.sp = value;
    else if (up === 'KSP') c.ksp = value & 0xffff;
    else if (up === 'USP') c.usp = value & 0xffff;
    else if (up in CR) c.setCR(CR[up as keyof typeof CR], value);
    else throw new Error(`unknown register ${name}`);
  }

  private toStop(r: RunResult): MachineView['stop'] {
    return r.reason === 'budget' || r.reason === 'instruction-limit' ? null : { reason: r.reason, detail: r.detail };
  }

  // ------------------------------------------------------------------
  // Execution slices
  // ------------------------------------------------------------------

  /** Run one real-time slice. Returns true if execution stopped during it. */
  tick(now: number, clock: () => number = () => now): boolean {
    if (this.runState !== 'running') return false;
    const m = this.machine;
    const dt = Math.min(MAX_DT_MS, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    let result: RunResult | null = null;
    if (this.speed === 'max') {
      const deadline = clock() + MAX_SPEED_SLICE_MS;
      do {
        result = m.run(20_000);
        if (result.reason !== 'budget') break;
      } while (clock() < deadline);
    } else {
      this.carry += (this.speed * dt) / 1000;
      const n = Math.floor(this.carry);
      this.carry -= n;
      if (n > 0) result = m.run(n);
    }
    this.measure(now);
    this.dirty = true;
    if (result && result.reason !== 'budget') {
      this.runState = 'paused';
      this.stop = this.toStop(result);
      return true;
    }
    return false;
  }

  private measure(now: number): void {
    this.hzWindow.push({ t: now, c: this.machine.cycle });
    while (this.hzWindow.length > 2 && now - this.hzWindow[0]!.t > 1000) this.hzWindow.shift();
    const first = this.hzWindow[0]!;
    this.measuredHz = now > first.t ? ((this.machine.cycle - first.c) * 1000) / (now - first.t) : 0;
  }

  // ------------------------------------------------------------------
  // Views
  // ------------------------------------------------------------------

  /** RAM/ROM plus side-effect-free reads of the device registers. */
  private memoryImage(): Uint8Array {
    const m = this.machine;
    const img = m.bus.mem.slice();
    for (const d of m.bus.devices) for (let i = 0; i < 16; i++) img[d.base + i] = d.peek(i) & 0xff;
    return img;
  }

  view(): MachineView {
    const m = this.machine;
    const c = m.cpu;
    const prog = c.program ?? (c.halted ? null : null);
    const nextKind = m.nextSequenceKind();
    let sequence: CpuView['sequence'] = null;
    if (prog) {
      sequence = {
        kind: prog.kind,
        ops: prog.ops.map((o) => ({ name: o.name, rtl: o.rtl })),
        mpc: c.mpc,
        mnemonic: c.def?.mnemonic ?? null,
      };
    } else if (nextKind === 'instruction') {
      sequence = {
        kind: 'instruction',
        ops: PREFIX_PROGRAM.ops.map((o) => ({ name: o.name, rtl: o.rtl })),
        mpc: 0,
        mnemonic: null,
      };
    } else if (nextKind) {
      sequence = { kind: nextKind, ops: [], mpc: 0, mnemonic: null };
    }
    const act = c.activity;
    const cpu: CpuView = {
      r: Array.from(c.r),
      pc: c.pc,
      sp: c.sp,
      ksp: c.ksp,
      usp: c.usp,
      psw: c.psw,
      vbase: c.vbase,
      ubase: c.ubase,
      ulimit: c.ulimit,
      cause: c.cause,
      faddr: c.faddr,
      kscratch: c.kscratch,
      latches: { ir: c.ir, opr: c.opr, imm: c.imm, mar: c.mar, mdr: c.mdr, a: c.a, b: c.b, y: c.y, t16: c.t16, tmp: c.tmp },
      status: c.status,
      machineCheckReason: c.machineCheckReason,
      instrStart: c.instrStart,
      sequence,
      lastOp: act.op
        ? {
            name: act.op.name,
            rtl: act.op.rtl,
            units: unitNames(act.op.units),
            bus: { ...act.bus },
            alu: act.alu ? { ...act.alu } : null,
            fault: act.fault ? { ...act.fault } : null,
          }
        : null,
      pendingException: c.exception ? { vector: c.exception.vector, cause: c.exception.cause, faddr: c.exception.faddr } : null,
    };
    let os: MachineView['os'] = null;
    if (this.layout) {
      const peek = (a: number) => m.bus.peek(a);
      os = {
        processes: readProcessTable(peek, this.layout),
        current: currentProcess(peek, this.layout),
        segments: this.timeline ? this.timeline.snapshot(m.cycle).slice(-600) : [],
        markers: this.timeline ? this.timeline.markers.slice(-600) : [],
        ticks: m.bus.peekWord(this.layout.ticks),
      };
    }
    const t = m.terminal;
    return {
      seq: ++this.seq,
      label: this.label,
      loaded: this.config !== null,
      runState: this.runState,
      speed: this.speed,
      stop: this.stop,
      cycle: m.cycle,
      instructions: m.instructions,
      modeCycles: { ...m.modeCycles },
      measuredHz: this.runState === 'running' ? this.measuredHz : 0,
      cpu,
      memory: this.memoryImage(),
      devices: {
        timer: { ...m.timer.getState(), irq: m.timer.irqAsserted() },
        terminal: { lines: t.lines.slice(-200), current: t.current, col: t.col, bytesWritten: t.bytesWritten },
        keyboard: { ...m.keyboard.getState(), irq: m.keyboard.irqAsserted() },
        gpio: m.gpio.getState(),
        storage: {
          status: m.storage.status,
          block: m.storage.block,
          errcode: m.storage.errcode,
          ctrl: m.storage.ctrl,
          busyCycles: m.storage.busyCycles,
          ptr: m.storage.ptr,
          reads: m.storage.reads,
          writes: m.storage.writes,
          irq: m.storage.irqAsserted(),
        },
        pic: { pending: m.pic.pending(), mask: m.pic.mask },
      },
      trace: m.trace.last(VIEW_TRACE),
      traceTotal: m.trace.total,
      events: m.events.last(VIEW_EVENTS),
      breakpoints: [...m.breakpoints],
      watchpoints: [...m.watchpoints.entries()],
      breakOn: { ...m.breakOn },
      traceEnabled: m.traceEnabled,
      traceCapacity: m.trace.capacity,
      lastWatchHit: m.lastWatchHit ? { ...m.lastWatchHit } : null,
      os,
      inputLogLength: m.inputLog.length,
    };
  }
}
