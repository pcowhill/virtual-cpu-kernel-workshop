/**
 * Guided-lesson engine.
 *
 * A lesson is data: a starting machine (a bare-metal program or an OS build),
 * steps with explanations, and for each step a check evaluated against the
 * live MachineView the emulator publishes. Nothing here produces machine
 * behaviour: checks only read state, and "show me" solutions are sequences of
 * the same commands the user's buttons send.
 */
import type { LabId } from '../app/store';
import type { BuildOutput, Project } from '../app/project';
import type { ProgramSpec } from '../core/build/system';
import type { Command, MachineView } from '../host/protocol';
import { DISK_BLOCK_SIZE, PSW } from '../core/isa/constants';

export type LessonSetup =
  | { kind: 'bare'; file: string }
  | { kind: 'os'; programs: ProgramSpec[] };

export type FlagName = 'C' | 'Z' | 'N' | 'V' | 'I' | 'S';
const FLAG_BITS: Record<FlagName, number> = { C: PSW.C, Z: PSW.Z, N: PSW.N, V: PSW.V, I: PSW.I, S: PSW.S };

/** An address given as a number or as a symbol of the current build. */
export type Where = number | string;

export type LessonCheck =
  | { kind: 'loaded'; label: string }
  | { kind: 'cyclesAtLeast'; cycles: number }
  | { kind: 'instructionsAtLeast'; count: number }
  /** The CPU is stopped with PC at an address (about to execute it). */
  | { kind: 'pausedAt'; at: Where }
  /** A micro-operation sequence is in progress (stopped between clock cycles). */
  | { kind: 'midInstruction' }
  | { kind: 'reg'; reg: string; value: number }
  | { kind: 'flag'; flag: FlagName; set: boolean }
  | { kind: 'mem'; at: Where; value: number }
  | { kind: 'terminalIncludes'; text: string }
  | { kind: 'leds'; value: number }
  | { kind: 'stopped'; reason: string }
  | { kind: 'mode'; mode: 'user' | 'supervisor' }
  | { kind: 'userCyclesAtLeast'; cycles: number }
  /** An exception/interrupt entry with this vector appears in the recent event log. */
  | { kind: 'exceptionSeen'; vector: number; minCount?: number }
  /** The CPU detected an exception that it has not entered yet (break-on-fault). */
  | { kind: 'pendingException'; vector: number }
  | { kind: 'process'; name: string; state?: string; exitCode?: number; dispatchesAtLeast?: number; killed?: boolean }
  /** At least `count` processes currently have a saved trap frame (they are off the CPU). */
  | { kind: 'savedFrames'; count: number }
  /** At least `bytes` bytes (default: all) of the kernel image in RAM match the image on the disk. */
  | { kind: 'kernelInRam'; bytes?: number }
  | { kind: 'ticksAtLeast'; ticks: number }
  | { kind: 'timerReload'; value: number }
  /** The loaded machine was built from sources where `file` contains `text`. */
  | { kind: 'sourceLoaded'; file: string; text: string }
  | { kind: 'all'; checks: LessonCheck[] };

export type LessonAction =
  | { do: 'setup' }
  | { do: 'command'; command: Command }
  | { do: 'step'; count: number }
  | { do: 'micro'; count: number }
  /** Run for at most `cycles` simulated cycles (stops early at breakpoints). */
  | { do: 'run'; cycles: number }
  /** Run until the CPU is about to execute `at` (temporary breakpoint). */
  | { do: 'runTo'; at: Where; maxCycles?: number }
  | { do: 'keys'; text: string }
  /** Add (or replace) a watchpoint, as the Memory lab's button does. */
  | { do: 'watch'; at: number; access: 'r' | 'w' | 'rw' }
  | { do: 'unwatch'; at: number }
  /** Replace text in a source file (`find` must occur exactly once). */
  | { do: 'edit'; file: string; find: string; replace: string }
  | { do: 'build' };

export interface LessonStep {
  title: string;
  /** Markdown. */
  body: string;
  /** Lab to show for this step. */
  lab?: LabId;
  check?: LessonCheck;
  /** A hint shown on request. */
  hint?: string;
  /** What "Show me" does: the actions a user would take. */
  solution?: LessonAction[];
}

export interface Lesson {
  id: string;
  number: number;
  title: string;
  summary: string;
  objectives: string[];
  /** Markdown: the short explanation before the steps. */
  explanation: string;
  setup: LessonSetup;
  /** Lab opened when the lesson starts. */
  lab: LabId;
  steps: LessonStep[];
  experiments: string[];
  observations: string[];
  /** Related catalog examples. */
  examples?: string[];
}

export interface LessonContext {
  view: MachineView | null;
  build: BuildOutput | null;
  project: Project;
  /** Hash of the sources of the loaded machine and of the current sources. */
  loadedHash: string | null;
}

export function resolveWhere(at: Where, build: BuildOutput | null): number | undefined {
  if (typeof at === 'number') return at;
  return build?.symbols.find((s) => s.name === at)?.value;
}

function terminalText(v: MachineView): string {
  return [...v.devices.terminal.lines, v.devices.terminal.current].join('\n');
}

const REG8 = /^R([0-7])$/;

function regValue(v: MachineView, reg: string): number | undefined {
  const r = REG8.exec(reg.toUpperCase());
  if (r) return v.cpu.r[Number(r[1])];
  const key = reg.toLowerCase() as keyof MachineView['cpu'];
  const x = v.cpu[key];
  return typeof x === 'number' ? x : undefined;
}

/** Evaluate one check against the current state. Pure: reads only. */
export function evaluateLessonCheck(check: LessonCheck, ctx: LessonContext): boolean {
  const v = ctx.view;
  if (check.kind === 'all') return check.checks.every((c) => evaluateLessonCheck(c, ctx));
  if (check.kind === 'sourceLoaded')
    return (
      !!v?.loaded &&
      ctx.loadedHash !== null &&
      ctx.build?.sourceHash === ctx.loadedHash &&
      (ctx.project.files[check.file] ?? '').includes(check.text)
    );
  if (!v || !v.loaded) return false;
  switch (check.kind) {
    case 'loaded':
      return v.label.includes(check.label);
    case 'cyclesAtLeast':
      return v.cycle >= check.cycles;
    case 'instructionsAtLeast':
      return v.instructions >= check.count;
    case 'pausedAt': {
      const a = resolveWhere(check.at, ctx.build);
      return a !== undefined && v.runState === 'paused' && v.cpu.pc === a && (v.cpu.sequence?.mpc ?? 0) === 0;
    }
    case 'midInstruction':
      return v.runState === 'paused' && !!v.cpu.sequence && v.cpu.sequence.mpc > 0;
    case 'reg':
      return regValue(v, check.reg) === check.value;
    case 'flag':
      return ((v.cpu.psw & FLAG_BITS[check.flag]) !== 0) === check.set;
    case 'mem': {
      const a = resolveWhere(check.at, ctx.build);
      return a !== undefined && v.memory[a] === check.value;
    }
    case 'terminalIncludes':
      return terminalText(v).includes(check.text);
    case 'leds':
      return v.devices.gpio.leds === check.value;
    case 'stopped':
      return v.runState === 'paused' && v.stop?.reason === check.reason;
    case 'mode':
      return ((v.cpu.psw & PSW.S) !== 0) === (check.mode === 'supervisor');
    case 'userCyclesAtLeast':
      return v.modeCycles.user >= check.cycles;
    case 'exceptionSeen':
      return v.events.filter((e) => e.type === 'exception' && e.vector === check.vector).length >= (check.minCount ?? 1);
    case 'pendingException':
      return v.runState === 'paused' && v.cpu.pendingException?.vector === check.vector;
    case 'process': {
      const p = v.os?.processes.find((x) => x.name === check.name);
      if (!p) return false;
      if (check.state !== undefined && p.state !== check.state) return false;
      if (check.exitCode !== undefined && (p.state !== 'exited' || p.exitCode !== check.exitCode)) return false;
      if (check.dispatchesAtLeast !== undefined && p.runs < check.dispatchesAtLeast) return false;
      if (check.killed !== undefined && (p.state === 'exited' && !!p.faultCause) !== check.killed) return false;
      return true;
    }
    case 'savedFrames':
      return (v.os?.processes.filter((p) => p.frame).length ?? 0) >= check.count;
    case 'kernelInRam':
      return kernelBytesInRam(ctx) >= (check.bytes ?? ctx.build?.system?.kernelImage?.size ?? Infinity);
    case 'ticksAtLeast':
      return (v.os?.ticks ?? 0) >= check.ticks;
    case 'timerReload':
      return v.devices.timer.reload === check.value;
  }
}

/** How many bytes of the kernel image (from the boot disk) are already present in RAM, in order. */
export function kernelBytesInRam(ctx: LessonContext): number {
  const sys = ctx.build?.system;
  const img = sys?.kernelImage;
  const v = ctx.view;
  if (!sys || !img || !v) return 0;
  const from = img.block * DISK_BLOCK_SIZE;
  let n = 0;
  while (n < img.size && v.memory[(img.load + n) & 0xffff] === sys.disk[from + n]) n++;
  return n;
}

/** A plain-language description of a check, shown next to its status. */
export function describeCheck(check: LessonCheck): string {
  const at = (w: Where) => (typeof w === 'number' ? `0x${w.toString(16).toUpperCase().padStart(4, '0')}` : w);
  const h = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;
  switch (check.kind) {
    case 'all':
      return check.checks.map(describeCheck).join('; ');
    case 'loaded':
      return `the machine is loaded with ${check.label}`;
    case 'cyclesAtLeast':
      return `at least ${check.cycles} clock cycles have run`;
    case 'instructionsAtLeast':
      return `at least ${check.count} instructions have completed`;
    case 'pausedAt':
      return `the CPU is paused about to execute ${at(check.at)}`;
    case 'midInstruction':
      return 'the CPU is stopped in the middle of an instruction (between micro-operations)';
    case 'reg':
      return `${check.reg.toUpperCase()} = ${check.value > 0xff ? at(check.value) : h(check.value)}`;
    case 'flag':
      return `flag ${check.flag} is ${check.set ? 'set' : 'clear'}`;
    case 'mem':
      return `memory ${at(check.at)} holds ${h(check.value)}`;
    case 'terminalIncludes':
      return `the terminal shows “${check.text.trim()}”`;
    case 'leds':
      return `the LEDs show ${check.value.toString(2).padStart(8, '0')}`;
    case 'stopped':
      return `execution stopped (${check.reason})`;
    case 'mode':
      return `the CPU is in ${check.mode} mode`;
    case 'userCyclesAtLeast':
      return `user programs have run for at least ${check.cycles} cycles`;
    case 'exceptionSeen':
      return `the CPU entered vector ${check.vector}${check.minCount && check.minCount > 1 ? ` at least ${check.minCount} times` : ''}`;
    case 'pendingException':
      return `the CPU is paused before entering vector ${check.vector}`;
    case 'savedFrames':
      return `at least ${check.count} processes have a saved context in their kernel stack`;
    case 'kernelInRam':
      return check.bytes ? `at least ${check.bytes} kernel bytes have been copied into RAM` : 'the whole kernel image is in RAM';
    case 'process':
      return `process “${check.name}”${check.state ? ` is ${check.state}` : ''}${
        check.dispatchesAtLeast ? ` has been dispatched at least ${check.dispatchesAtLeast} times` : ''
      }${check.exitCode !== undefined ? ` exited with code ${check.exitCode}` : ''}${
        check.killed ? ' was killed by the kernel' : ''
      }`;
    case 'ticksAtLeast':
      return `the kernel has counted at least ${check.ticks} timer ticks`;
    case 'timerReload':
      return `the timer RELOAD register holds ${check.value}`;
    case 'sourceLoaded':
      return `${check.file} contains “${check.text}” and the machine runs the rebuilt code`;
  }
}

/** What a lesson driver must provide: the same operations the UI offers the user. */
export interface LessonDriver {
  setup(lesson: Lesson): Promise<boolean>;
  send(cmd: Command): void;
  /** Run up to `cycles` cycles on the machine host now; resolves once the new view is visible. */
  run(cycles: number): Promise<void>;
  symbol(name: string): number | undefined;
  edit(file: string, find: string, replace: string): boolean;
  build(): boolean;
  /** Current breakpoints (restored after a temporary one). */
  breakpoints(): number[];
  watch(at: number, access: 'r' | 'w' | 'rw'): void;
  unwatch(at: number): void;
}

const RUN_CHUNK = 200_000;

/** Execute a solution. Throws a readable error if an action cannot be performed. */
export async function performActions(lesson: Lesson, actions: LessonAction[], d: LessonDriver): Promise<void> {
  for (const a of actions) {
    switch (a.do) {
      case 'setup':
        if (!(await d.setup(lesson))) throw new Error('the lesson program failed to build');
        break;
      case 'command':
        d.send(a.command);
        await d.run(0);
        break;
      case 'step':
        for (let i = 0; i < a.count; i++) d.send({ type: 'stepInstruction' });
        await d.run(0);
        break;
      case 'micro':
        for (let i = 0; i < a.count; i++) d.send({ type: 'stepMicro' });
        await d.run(0);
        break;
      case 'run':
        await d.run(a.cycles);
        break;
      case 'runTo': {
        const addr = typeof a.at === 'number' ? a.at : d.symbol(a.at);
        if (addr === undefined) throw new Error(`unknown symbol ${String(a.at)}`);
        const keep = d.breakpoints();
        d.send({ type: 'setBreakpoints', addresses: [...new Set([...keep, addr])] });
        await d.run(a.maxCycles ?? RUN_CHUNK);
        d.send({ type: 'setBreakpoints', addresses: keep });
        await d.run(0);
        break;
      }
      case 'keys':
        d.send({ type: 'injectKeys', bytes: [...a.text].map((c) => c.charCodeAt(0) & 0xff) });
        await d.run(0);
        break;
      case 'watch':
        d.watch(a.at, a.access);
        await d.run(0);
        break;
      case 'unwatch':
        d.unwatch(a.at);
        await d.run(0);
        break;
      case 'edit':
        if (!d.edit(a.file, a.find, a.replace)) throw new Error(`could not find the text to change in ${a.file}`);
        break;
      case 'build':
        if (!d.build()) throw new Error('the edited sources did not build');
        await d.run(0);
        break;
    }
  }
}

/** Apply a lesson's setup to a project (does not build). */
export function applySetup(project: Project, setup: LessonSetup): void {
  if (setup.kind === 'bare') {
    project.mode = 'bare';
    project.bareMain = setup.file;
  } else {
    project.mode = 'os';
    project.os.programs.splice(0, project.os.programs.length, ...setup.programs.map((p) => ({ ...p })));
  }
}

/** Edit helper shared by drivers: replace exactly one occurrence. */
export function editSource(project: Project, file: string, find: string, replace: string): boolean {
  const src = project.files[file];
  if (src === undefined) return false;
  const i = src.indexOf(find);
  if (i < 0 || src.indexOf(find, i + 1) >= 0) return false;
  project.files[file] = src.slice(0, i) + replace + src.slice(i + find.length);
  return true;
}
