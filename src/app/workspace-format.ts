/**
 * Workspaces: a project (sources + build configuration), debugger settings,
 * experiment notes, the machine state at save time and named snapshots.
 *
 * The export format is plain JSON, versioned and validated field by field.
 * Imported content is data only: sources are assembled by the workshop
 * assembler and machine snapshots are restored into the emulator after they
 * pass structural, range and round-trip checks. Nothing imported is ever
 * evaluated as host JavaScript.
 */
import { buildProject, defaultProject, type Project } from './project';
import type { DebugSettings } from './store';
import { Machine, type MachineSnapshot } from '../core/machine/machine';
import { MAX_PROGRAMS } from '../core/build/system';
import { KBD_QUEUE_CAPACITY, TERM_COLS } from '../core/isa/constants';

export const WORKSPACE_FORMAT = 'vc8-workspace';
export const WORKSPACE_VERSION = 1;
/** Imports larger than this are refused before parsing. */
export const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 400;
const MAX_FILE_CHARS = 512 * 1024;
const MAX_SNAPSHOTS = 50;
const MAX_NOTES = 100_000;
const MAX_NAME = 80;

export interface SnapshotRecord {
  id: string;
  name: string;
  createdAt: number;
  cycle: number;
  /** Machine label (what was loaded) when the snapshot was taken. */
  label: string;
  /** Hash of the sources the loaded machine was built from. */
  sourceHash: string | null;
  machine: MachineSnapshot;
}

export interface Workspace {
  id: string;
  name: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  project: Project;
  debug: DebugSettings;
  /** Machine state when the workspace was saved (null if nothing was loaded). */
  machine: SnapshotRecord | null;
  snapshots: SnapshotRecord[];
}

export interface WorkspaceExport {
  format: typeof WORKSPACE_FORMAT;
  version: typeof WORKSPACE_VERSION;
  exportedAt: string;
  workspace: Omit<Workspace, 'id'>;
}

export class ImportError extends Error {}

export function newId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function exportWorkspace(ws: Workspace): string {
  const { id: _id, ...rest } = ws;
  const out: WorkspaceExport = {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    exportedAt: new Date().toISOString(),
    workspace: rest,
  };
  return JSON.stringify(out, null, 1);
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function isObj(x: unknown): x is Obj {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function obj(x: unknown, where: string): Obj {
  if (!isObj(x)) throw new ImportError(`${where} must be an object`);
  return x;
}

function str(x: unknown, where: string, max: number): string {
  if (typeof x !== 'string') throw new ImportError(`${where} must be text`);
  if (x.length > max) throw new ImportError(`${where} is too long (${x.length} > ${max})`);
  return x;
}

function int(x: unknown, where: string, min: number, max: number): number {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max)
    throw new ImportError(`${where} must be an integer between ${min} and ${max}`);
  return x;
}

function bool(x: unknown, where: string): boolean {
  if (typeof x !== 'boolean') throw new ImportError(`${where} must be true or false`);
  return x;
}

const PATH_RE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*\.(asm|inc)$/;

function validPath(p: string): boolean {
  return PATH_RE.test(p) && !p.split('/').some((seg) => seg === '..' || seg === '.' || seg === '') && p.length <= 120;
}

export function validateProject(x: unknown): Project {
  const p = obj(x, 'project');
  const mode = p['mode'];
  if (mode !== 'bare' && mode !== 'os') throw new ImportError('project.mode must be "bare" or "os"');
  const filesIn = obj(p['files'], 'project.files');
  const entries = Object.entries(filesIn);
  if (entries.length === 0) throw new ImportError('project.files is empty');
  if (entries.length > MAX_FILES) throw new ImportError(`too many source files (${entries.length} > ${MAX_FILES})`);
  const files: Record<string, string> = {};
  const has = (name: string) => Object.prototype.hasOwnProperty.call(files, name);
  for (const [path, text] of entries) {
    if (!validPath(path)) throw new ImportError(`invalid source file name "${path.slice(0, 80)}"`);
    files[path] = str(text, `file ${path}`, MAX_FILE_CHARS);
  }
  const bareMain = str(p['bareMain'], 'project.bareMain', 120);
  if (!has(bareMain)) throw new ImportError(`project.bareMain "${bareMain}" is not one of the files`);
  const os = obj(p['os'], 'project.os');
  const firmware = str(os['firmware'], 'project.os.firmware', 120);
  const kernel = str(os['kernel'], 'project.os.kernel', 120);
  for (const [k, f] of [
    ['firmware', firmware],
    ['kernel', kernel],
  ] as const)
    if (!has(f)) throw new ImportError(`project.os.${k} "${f}" is not one of the files`);
  const progsIn = os['programs'];
  if (!Array.isArray(progsIn) || progsIn.length > MAX_PROGRAMS)
    throw new ImportError(`project.os.programs must be a list of at most ${MAX_PROGRAMS} programs`);
  const programs = progsIn.map((q, i) => {
    const o = obj(q, `program ${i + 1}`);
    const name = str(o['name'], `program ${i + 1} name`, 32);
    const path = str(o['path'], `program ${i + 1} path`, 120);
    if (!has(path)) throw new ImportError(`program ${i + 1} source "${path}" is not one of the files`);
    return { name, path };
  });
  return { mode, files, bareMain, os: { firmware, kernel, programs } };
}

export function validateDebug(x: unknown): DebugSettings {
  const d = obj(x, 'debug');
  const bps = d['breakpoints'];
  if (!Array.isArray(bps) || bps.length > 256) throw new ImportError('debug.breakpoints must be a list');
  const wps = d['watchpoints'];
  if (!Array.isArray(wps) || wps.length > 256) throw new ImportError('debug.watchpoints must be a list');
  const on = obj(d['breakOn'], 'debug.breakOn');
  const speed = d['speed'];
  if (speed !== 'max') int(speed, 'debug.speed', 1, 100_000_000);
  return {
    breakpoints: bps.map((a, i) => int(a, `breakpoint ${i + 1}`, 0, 0xffff)),
    watchpoints: wps.map((w, i) => {
      if (!Array.isArray(w) || w.length !== 2) throw new ImportError(`watchpoint ${i + 1} is malformed`);
      const kind = w[1];
      if (kind !== 'r' && kind !== 'w' && kind !== 'rw')
        throw new ImportError(`watchpoint ${i + 1} has an invalid kind`);
      return [int(w[0], `watchpoint ${i + 1}`, 0, 0xffff), kind] as [number, 'r' | 'w' | 'rw'];
    }),
    breakOn: {
      faults: bool(on['faults'], 'debug.breakOn.faults'),
      traps: bool(on['traps'], 'debug.breakOn.traps'),
      interrupts: bool(on['interrupts'], 'debug.breakOn.interrupts'),
    },
    traceEnabled: bool(d['traceEnabled'], 'debug.traceEnabled'),
    traceCapacity: int(d['traceCapacity'], 'debug.traceCapacity', 0, 100_000),
    speed: speed === 'max' ? 'max' : (speed as number),
  };
}

/** A powered-on machine's snapshot, used as the structural schema. */
let reference: MachineSnapshot | null = null;
function referenceSnapshot(): MachineSnapshot {
  if (!reference) {
    const m = new Machine();
    m.powerOn(buildProject(defaultProject()).load!.config);
    reference = m.snapshot();
  }
  return reference;
}

/** Fields whose type the reference cannot show: nullable fields and list elements. */
const NULLABLE: Record<string, 'string' | 'flat-object'> = {
  'cpu.programId': 'string',
  'cpu.exception': 'flat-object',
};
const LIST_ELEMENT: Record<string, unknown> = {
  'devices.terminal.lines': '',
  'devices.keyboard.queue': 0,
  inputLog: { cycle: 0, device: 'keyboard', value: 0 },
};

/** Same JSON shape as the reference: same keys and value types, recursively. */
function sameShape(x: unknown, ref: unknown, where: string, path: string): void {
  if (path in NULLABLE) {
    if (x === null) return;
    if (NULLABLE[path] === 'string') {
      str(x, where, 200);
      return;
    }
    for (const [k, v] of Object.entries(obj(x, where))) {
      if (!['number', 'boolean'].includes(typeof v)) throw new ImportError(`${where}.${k} has an invalid type`);
      if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new ImportError(`${where}.${k} must be an integer`);
    }
    return;
  }
  if (Array.isArray(ref)) {
    if (!Array.isArray(x)) throw new ImportError(`${where} must be a list`);
    if (x.length > 1_000_000) throw new ImportError(`${where} is too long`);
    const elem = path in LIST_ELEMENT ? LIST_ELEMENT[path] : ref[0];
    if (elem === undefined) {
      if (x.length !== 0) throw new ImportError(`${where} must be empty`);
      return;
    }
    if (path === 'cpu.r' || path === 'devices.sysctl.latch')
      if (x.length !== ref.length) throw new ImportError(`${where} must have ${ref.length} entries`);
    x.forEach((e, i) => sameShape(e, elem, `${where}[${i}]`, `${path}[]`));
    return;
  }
  if (isObj(ref)) {
    const o = obj(x, where);
    const keys = Object.keys(ref);
    for (const k of Object.keys(o))
      if (!keys.includes(k)) throw new ImportError(`${where}.${k} is not part of the format`);
    for (const k of keys) {
      if (!(k in o)) throw new ImportError(`${where}.${k} is missing`);
      sameShape(o[k], ref[k], `${where}.${k}`, path ? `${path}.${k}` : k);
    }
    return;
  }
  if (ref === null) {
    if (x !== null) throw new ImportError(`${where} must be empty (null)`);
    return;
  }
  if (typeof x !== typeof ref) throw new ImportError(`${where} has the wrong type`);
  if (typeof x === 'number' && !Number.isSafeInteger(x)) throw new ImportError(`${where} must be an integer`);
}

/** No negative numbers anywhere in a snapshot. */
function nonNegative(x: unknown, where: string): void {
  if (typeof x === 'number') {
    if (x < 0) throw new ImportError(`${where} must not be negative`);
  } else if (Array.isArray(x)) x.forEach((e, i) => nonNegative(e, `${where}[${i}]`));
  else if (isObj(x)) for (const [k, v] of Object.entries(x)) nonNegative(v, `${where}.${k}`);
}

/** Device registers and internal state must hold values the hardware could hold. */
function checkDeviceRanges(snap: MachineSnapshot, where: string): void {
  nonNegative(snap, where);
  const d = snap.devices;
  const w = `${where}.devices`;
  const byte = (v: number, name: string) => int(v, `${w}.${name}`, 0, 0xff);
  byte(d.gpio.leds, 'gpio.leds');
  byte(d.gpio.switches, 'gpio.switches');
  byte(d.pic.mask, 'pic.mask');
  d.sysctl.latch.forEach((v, i) => byte(v, `sysctl.latch[${i}]`));
  byte(d.timer.ctrl, 'timer.ctrl');
  int(d.timer.reload, `${w}.timer.reload`, 0, 0xffff);
  int(d.timer.count, `${w}.timer.count`, 0, 0xffff);
  byte(d.keyboard.ctrl, 'keyboard.ctrl');
  if (d.keyboard.queue.length > KBD_QUEUE_CAPACITY)
    throw new ImportError(`${w}.keyboard.queue holds more than ${KBD_QUEUE_CAPACITY} keys`);
  d.keyboard.queue.forEach((v, i) => byte(v, `keyboard.queue[${i}]`));
  int(d.terminal.col, `${w}.terminal.col`, 0, TERM_COLS);
  for (const k of ['ptr', 'block', 'status', 'errcode', 'ctrl', 'pendingCmd', 'pendingBlock'] as const)
    byte(d.storage[k], `storage.${k}`);
  int(d.storage.busyCycles, `${w}.storage.busyCycles`, 0, 0xffff);
}

/**
 * Validate a machine snapshot from an untrusted source: structure, register
 * ranges, then a round trip through a scratch machine (restore → snapshot must
 * reproduce it exactly) and a short trial run that must not throw.
 */
export function validateSnapshot(x: unknown, where = 'snapshot'): MachineSnapshot {
  const s = obj(x, where);
  if (s['format'] !== 'vc8-machine-snapshot' || s['version'] !== 1)
    throw new ImportError(`${where} is not a version 1 VC-8 machine snapshot`);
  sameShape(s, referenceSnapshot(), where, '');
  const snap = s as unknown as MachineSnapshot;
  const c = snap.cpu;
  c.r.forEach((v, i) => int(v, `${where}.cpu.r[${i}]`, 0, 0xff));
  for (const k of ['pc', 'ksp', 'usp', 'vbase', 'ubase', 'ulimit', 'faddr', 'instrStart'] as const)
    int(c[k], `${where}.cpu.${k}`, 0, 0xffff);
  for (const k of ['psw', 'cause', 'kscratch'] as const) int(c[k], `${where}.cpu.${k}`, 0, 0xff);
  int(snap.cycle, `${where}.cycle`, 0, Number.MAX_SAFE_INTEGER);
  checkDeviceRanges(snap, where);
  const m = new Machine();
  try {
    m.restore(snap);
  } catch (e) {
    throw new ImportError(`${where} cannot be restored: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (JSON.stringify(m.snapshot()) !== JSON.stringify(snap))
    throw new ImportError(`${where} contains values the machine does not accept`);
  try {
    m.run(2000);
  } catch (e) {
    throw new ImportError(`${where} does not run: ${e instanceof Error ? e.message : String(e)}`);
  }
  return snap;
}

function validateSnapshotRecord(x: unknown, where: string): SnapshotRecord {
  const r = obj(x, where);
  return {
    id: str(r['id'], `${where}.id`, 80),
    name: str(r['name'], `${where}.name`, MAX_NAME),
    createdAt: int(r['createdAt'], `${where}.createdAt`, 0, Number.MAX_SAFE_INTEGER),
    cycle: int(r['cycle'], `${where}.cycle`, 0, Number.MAX_SAFE_INTEGER),
    label: str(r['label'], `${where}.label`, 200),
    sourceHash: r['sourceHash'] === null ? null : str(r['sourceHash'], `${where}.sourceHash`, 64),
    machine: validateSnapshot(r['machine'], `${where}.machine`),
  };
}

function uniqueIds(list: SnapshotRecord[]): SnapshotRecord[] {
  const seen = new Set<string>();
  for (const r of list) {
    if (seen.has(r.id)) throw new ImportError(`two snapshots share the id "${r.id.slice(0, 40)}"`);
    seen.add(r.id);
  }
  return list;
}

/** Parse and validate an exported workspace. Throws ImportError with a readable reason. */
export function importWorkspace(text: string): Omit<Workspace, 'id'> {
  if (text.length > MAX_IMPORT_BYTES) throw new ImportError('the file is too large to be a workspace');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError('the file is not valid JSON');
  }
  const top = obj(data, 'file');
  if (top['format'] !== WORKSPACE_FORMAT) throw new ImportError('the file is not a VC-8 workspace export');
  if (top['version'] !== WORKSPACE_VERSION)
    throw new ImportError(
      `unsupported workspace version ${String(top['version'])} (this workbench reads version ${WORKSPACE_VERSION})`,
    );
  const w = obj(top['workspace'], 'workspace');
  const snapsIn = w['snapshots'];
  if (!Array.isArray(snapsIn) || snapsIn.length > MAX_SNAPSHOTS)
    throw new ImportError(`workspace.snapshots must be a list of at most ${MAX_SNAPSHOTS}`);
  const name = str(w['name'], 'workspace.name', MAX_NAME).trim();
  return {
    name: name || 'Imported workspace',
    notes: str(w['notes'], 'workspace.notes', MAX_NOTES),
    createdAt: int(w['createdAt'], 'workspace.createdAt', 0, Number.MAX_SAFE_INTEGER),
    updatedAt: int(w['updatedAt'], 'workspace.updatedAt', 0, Number.MAX_SAFE_INTEGER),
    project: validateProject(w['project']),
    debug: validateDebug(w['debug']),
    machine: w['machine'] === null ? null : validateSnapshotRecord(w['machine'], 'workspace.machine'),
    snapshots: uniqueIds(snapsIn.map((s, i) => validateSnapshotRecord(s, `snapshot ${i + 1}`))),
  };
}
