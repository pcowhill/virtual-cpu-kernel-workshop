/**
 * Projects: the editable sources plus the build configuration that turn into
 * a machine configuration. Building happens on the UI thread (the assembler is
 * fast); only the resulting ROM/disk/preload images go to the machine host.
 */
import {
  assemble,
  type AssemblyResult,
  type Diagnostic,
  type SourceMapEntry,
  type SymbolInfo,
} from '../core/asm/assembler';
import { bareMetalConfig } from '../core/build/bareMetal';
import {
  buildSystem,
  DEFAULT_DATA_FILE,
  DEFAULT_PROGRAMS,
  type ProgramSpec,
  type SystemBuild,
} from '../core/build/system';
import { DISK_BLOCK_COUNT, DISK_BLOCK_SIZE } from '../core/isa/constants';

/** Storage medium for bare-metal experiments: only the data area is populated. */
export function dataDisk(): Uint8Array {
  const d = new Uint8Array(DISK_BLOCK_COUNT * DISK_BLOCK_SIZE);
  d.set(DEFAULT_DATA_FILE.bytes, DEFAULT_DATA_FILE.block * DISK_BLOCK_SIZE);
  return d;
}
import { FIRMWARE_MAIN, GUEST_SOURCES, KERNEL_MAIN } from '../guest';
import type { LoadRequest } from '../host/protocol';

export type ProjectMode = 'bare' | 'os';

export interface Project {
  mode: ProjectMode;
  /** All editable source files, path → text. */
  files: Record<string, string>;
  /** Bare-metal program (assembled and programmed into ROM/RAM). */
  bareMain: string;
  /** Operating-system build configuration. */
  os: { firmware: string; kernel: string; programs: ProgramSpec[] };
}

export interface ComponentBuild {
  /** "program", "firmware", "kernel", "process 1 (alpha)" ... */
  component: string;
  file: string;
  result: AssemblyResult;
}

export interface BuildOutput {
  ok: boolean;
  mode: ProjectMode;
  diagnostics: (Diagnostic & { component: string })[];
  components: ComponentBuild[];
  load: LoadRequest | null;
  system: SystemBuild | null;
  /** All labels and constants, for disassembly and expressions. */
  symbols: (SymbolInfo & { component: string })[];
  sourceMap: (SourceMapEntry & { component: string })[];
  builtAt: number;
  /** Snapshot of the sources used (to detect later edits). */
  sourceHash: string;
}

export function defaultProject(): Project {
  return {
    mode: 'bare',
    files: { ...GUEST_SOURCES },
    bareMain: 'examples/first-program.asm',
    os: { firmware: FIRMWARE_MAIN, kernel: KERNEL_MAIN, programs: DEFAULT_PROGRAMS.map((p) => ({ ...p })) },
  };
}

/** A cheap content hash to detect whether the sources changed since a build. */
export function hashSources(p: Project): string {
  let h = 2166136261;
  const s = JSON.stringify([p.mode, p.bareMain, p.os, Object.entries(p.files).sort()]);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function buildProject(p: Project): BuildOutput {
  const sourceHash = hashSources(p);
  if (p.mode === 'bare') {
    const file = p.bareMain;
    const result = assemble(p.files[file] ?? '', { fileName: file, files: p.files });
    if (p.files[file] === undefined) {
      result.diagnostics.push({
        severity: 'error',
        message: `file '${file}' does not exist`,
        file,
        line: 0,
        column: 0,
      });
      result.ok = false;
    }
    let load: LoadRequest | null = null;
    const diagnostics = result.diagnostics.map((d) => ({ ...d, component: 'program' }));
    if (result.ok) {
      try {
        const config = bareMetalConfig(result.segments, dataDisk());
        if (!config.rom.some((s) => s.address === 0 && s.bytes.length >= 2)) {
          diagnostics.push({
            component: 'program',
            severity: 'warning',
            message:
              'no reset vector: put ".org 0x0000" and ".word start" in the program so the CPU knows where to begin',
            file,
            line: 0,
            column: 0,
          });
        }
        const symbols: Record<string, number> = {};
        for (const s of result.symbols) symbols[s.name] = s.value;
        load = { config, symbols, kernelSymbols: null, label: `bare metal: ${file}` };
      } catch (e) {
        diagnostics.push({ component: 'program', severity: 'error', message: String(e), file, line: 0, column: 0 });
      }
    }
    return {
      ok: result.ok && load !== null,
      mode: 'bare',
      diagnostics,
      components: [{ component: 'program', file, result }],
      load,
      system: null,
      symbols: result.symbols.map((s) => ({ ...s, component: 'program' })),
      sourceMap: result.sourceMap.map((s) => ({ ...s, component: 'program' })),
      builtAt: Date.now(),
      sourceHash,
    };
  }

  const system = buildSystem(p.files, { firmware: p.os.firmware, kernel: p.os.kernel, programs: p.os.programs });
  const components: ComponentBuild[] = [
    { component: 'firmware', file: p.os.firmware, result: system.firmware },
    { component: 'kernel', file: p.os.kernel, result: system.kernel },
    ...system.programs.map((pr) => ({
      component: `process ${pr.slot + 1} (${pr.spec.name})`,
      file: pr.spec.path,
      result: pr.result,
    })),
  ];
  const symbols: Record<string, number> = {};
  for (const c of components) for (const s of c.result.symbols) if (s.kind === 'label') symbols[s.name] = s.value;
  return {
    ok: system.ok,
    mode: 'os',
    diagnostics: system.diagnostics,
    components,
    load: system.ok
      ? {
          config: { rom: system.rom, disk: system.disk },
          symbols,
          kernelSymbols: system.kernelSymbols,
          label: `operating system: ${p.os.programs.map((x) => x.name).join(', ') || 'no programs'}`,
        }
      : null,
    system,
    symbols: components.flatMap((c) => c.result.symbols.map((s) => ({ ...s, component: c.component }))),
    sourceMap: components.flatMap((c) => c.result.sourceMap.map((s) => ({ ...s, component: c.component }))),
    builtAt: Date.now(),
    sourceHash,
  };
}

/** Build an address → label resolver from a build (labels only, first wins). */
export function labelResolver(build: BuildOutput | null): (addr: number) => string | undefined {
  const m = new Map<number, string>();
  if (build) {
    for (const s of build.symbols) {
      if (s.kind === 'label' && !m.has(s.value) && !s.name.includes('.')) m.set(s.value, s.name);
    }
  }
  return (a) => m.get(a);
}

export function sourceFor(
  build: BuildOutput | null,
  addr: number,
): (SourceMapEntry & { component: string }) | undefined {
  if (!build) return undefined;
  for (const e of build.sourceMap) if (addr >= e.address && addr < e.address + e.size) return e;
  return undefined;
}
