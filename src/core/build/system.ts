/**
 * System build: the "development workstation" that assembles the firmware,
 * kernel and user programs and writes a bootable disk image.
 *
 * Nothing here runs guest code or touches a machine's RAM. It only produces
 * the contents of the ROM chip and of the storage medium; the firmware then
 * loads the kernel and the kernel loads the programs by executing VC-8
 * instructions.
 */
import { assemble, type AssemblyResult, type Diagnostic } from '../asm/assembler';
import { DISK_BLOCK_COUNT, DISK_BLOCK_SIZE, MEM } from '../isa/constants';
import type { MachineConfig, MemorySegment } from '../machine/machine';

export const KERNEL_LOAD = 0x2000;
/** The kernel image may occupy 0x2000–0x4FFF; 0x5000–0x5FFF is kernel data and stacks. */
export const KERNEL_IMAGE_END = 0x4fff;
export const MAX_PROGRAMS = 4;
export const SLOT_SIZE = 0x2000;
export const DATA_AREA_BLOCK = 0x80;

export function slotBase(slot: number): number {
  return MEM.URAM_START + slot * SLOT_SIZE;
}

export interface ProgramSpec {
  /** Name stored in the boot block (at most 8 characters). */
  name: string;
  /** Path of the program's main source file. */
  path: string;
}

export interface DataFile {
  block: number;
  bytes: Uint8Array;
  description: string;
}

export interface SystemConfig {
  firmware: string;
  kernel: string;
  programs: ProgramSpec[];
  dataFiles?: DataFile[];
}

export interface ImageInfo {
  block: number;
  count: number;
  load: number;
  entry: number;
  size: number;
}

export interface ProgramBuild {
  spec: ProgramSpec;
  slot: number;
  result: AssemblyResult;
  image: ImageInfo | null;
}

export interface BuildDiagnostic extends Diagnostic {
  component: string;
}

export interface SystemBuild {
  ok: boolean;
  diagnostics: BuildDiagnostic[];
  firmware: AssemblyResult;
  kernel: AssemblyResult;
  kernelImage: ImageInfo | null;
  kernelChecksum: number;
  programs: ProgramBuild[];
  rom: MemorySegment[];
  disk: Uint8Array;
  dataFiles: DataFile[];
  /** Kernel symbol values by name (used by OS-aware debugger views). */
  kernelSymbols: Record<string, number>;
}

/** Flatten segments into a contiguous image starting at `load` (gaps are zero). */
function flatten(segments: readonly MemorySegment[], load: number): Uint8Array {
  let end = load;
  for (const s of segments) end = Math.max(end, s.address + s.bytes.length);
  const img = new Uint8Array(end - load);
  for (const s of segments) img.set(s.bytes, s.address - load);
  return img;
}

function symbol(r: AssemblyResult, name: string): number | undefined {
  return r.symbols.find((s) => s.name === name)?.value;
}

export const DEFAULT_DATA_FILE: DataFile = {
  block: DATA_AREA_BLOCK,
  description: 'Text file read by the "reader" program',
  bytes: new TextEncoder().encode(
    'Hello from block storage! This text was read from block 128 by the kernel storage driver.\n\0',
  ),
};

export function buildSystem(files: Record<string, string>, config: SystemConfig): SystemBuild {
  const diagnostics: BuildDiagnostic[] = [];
  const collect = (component: string, r: AssemblyResult) => {
    for (const d of r.diagnostics) diagnostics.push({ ...d, component });
  };
  const fail = (component: string, file: string, message: string) =>
    diagnostics.push({ component, file, line: 0, column: 0, severity: 'error', message });

  // ---- firmware (ROM) ----
  const firmware = assemble(files[config.firmware] ?? '', {
    fileName: config.firmware,
    files,
    regions: [{ start: MEM.ROM_START, end: MEM.ROM_END, name: 'Boot ROM' }],
  });
  collect('firmware', firmware);
  if (files[config.firmware] === undefined) fail('firmware', config.firmware, 'firmware source file not found');

  // ---- kernel ----
  const kernel = assemble(files[config.kernel] ?? '', {
    fileName: config.kernel,
    files,
    regions: [{ start: KERNEL_LOAD, end: KERNEL_IMAGE_END, name: 'kernel image area' }],
  });
  collect('kernel', kernel);
  if (files[config.kernel] === undefined) fail('kernel', config.kernel, 'kernel source file not found');

  // ---- user programs ----
  if (config.programs.length > MAX_PROGRAMS) {
    fail('disk', '', `at most ${MAX_PROGRAMS} programs fit in the process table (got ${config.programs.length})`);
  }
  const programs: ProgramBuild[] = config.programs.slice(0, MAX_PROGRAMS).map((spec, slot) => {
    const base = slotBase(slot);
    const result = assemble(files[spec.path] ?? '', {
      fileName: spec.path,
      files,
      predefined: { PROC_BASE: base, PROC_LIMIT: base + SLOT_SIZE },
      regions: [{ start: base, end: base + SLOT_SIZE - 1, name: `process slot ${slot}` }],
    });
    collect(`program ${spec.name}`, result);
    if (files[spec.path] === undefined) fail(`program ${spec.name}`, spec.path, 'source file not found');
    return { spec, slot, result, image: null };
  });

  // ---- disk image ----
  const disk = new Uint8Array(DISK_BLOCK_COUNT * DISK_BLOCK_SIZE);
  let nextBlock = 1;
  let kernelImage: ImageInfo | null = null;
  let kernelChecksum = 0;
  const place = (bytes: Uint8Array, component: string): { block: number; count: number } | null => {
    const count = Math.max(1, Math.ceil(bytes.length / DISK_BLOCK_SIZE));
    if (nextBlock + count > DATA_AREA_BLOCK) {
      fail(component, '', `disk image is full: the system area ends at block ${DATA_AREA_BLOCK}`);
      return null;
    }
    const block = nextBlock;
    disk.set(bytes, block * DISK_BLOCK_SIZE);
    nextBlock += count;
    return { block, count };
  };

  if (kernel.ok && kernel.segments.length) {
    const lowest = Math.min(...kernel.segments.map((s) => s.address));
    if (lowest !== KERNEL_LOAD) fail('kernel', config.kernel, `kernel must start at 0x2000 (starts at 0x${lowest.toString(16)})`);
    const img = flatten(kernel.segments, KERNEL_LOAD);
    const where = place(img, 'kernel');
    if (where) {
      const padded = disk.subarray(where.block * DISK_BLOCK_SIZE, (where.block + where.count) * DISK_BLOCK_SIZE);
      kernelChecksum = padded.reduce((a, b) => (a + b) & 0xff, 0);
      kernelImage = {
        ...where,
        load: KERNEL_LOAD,
        entry: symbol(kernel, 'kernel_entry') ?? KERNEL_LOAD,
        size: img.length,
      };
    }
  }

  for (const p of programs) {
    if (!p.result.ok || !p.result.segments.length) continue;
    const load = Math.min(...p.result.segments.map((s) => s.address));
    const img = flatten(p.result.segments, load);
    const where = place(img, `program ${p.spec.name}`);
    if (where) p.image = { ...where, load, entry: symbol(p.result, 'start') ?? load, size: img.length };
  }

  // ---- block 0: boot block ----
  const hdr = disk.subarray(0, DISK_BLOCK_SIZE);
  hdr[0] = 'V'.charCodeAt(0);
  hdr[1] = 'K'.charCodeAt(0);
  hdr[2] = 1;
  if (kernelImage) {
    hdr[3] = kernelImage.block;
    hdr[4] = kernelImage.count;
    hdr[5] = kernelImage.load & 0xff;
    hdr[6] = kernelImage.load >> 8;
    hdr[7] = kernelImage.entry & 0xff;
    hdr[8] = kernelImage.entry >> 8;
    hdr[9] = kernelChecksum;
  }
  const placed = programs.filter((p) => p.image);
  hdr[10] = placed.length;
  placed.forEach((p, i) => {
    const e = hdr.subarray(16 + i * 16, 32 + i * 16);
    const name = new TextEncoder().encode(p.spec.name.slice(0, 8));
    e.set(name, 0);
    e[8] = p.image!.block;
    e[9] = p.image!.count;
    e[10] = p.image!.load & 0xff;
    e[11] = p.image!.load >> 8;
    e[12] = p.image!.entry & 0xff;
    e[13] = p.image!.entry >> 8;
    e[14] = p.slot;
  });
  // Programs are slotted by their position; skipped programs would shift slots.
  if (placed.length !== programs.length) {
    fail('disk', '', 'some programs failed to build; fix them before booting');
  }

  // ---- data files ----
  const dataFiles = config.dataFiles ?? [DEFAULT_DATA_FILE];
  for (const f of dataFiles) {
    if (f.block < DATA_AREA_BLOCK || f.block * DISK_BLOCK_SIZE + f.bytes.length > disk.length) {
      fail('disk', '', `data file at block ${f.block} is outside the data area`);
      continue;
    }
    disk.set(f.bytes, f.block * DISK_BLOCK_SIZE);
  }

  const kernelSymbols: Record<string, number> = {};
  for (const s of kernel.symbols) kernelSymbols[s.name] = s.value;

  const ok = !diagnostics.some((d) => d.severity === 'error') && kernelImage !== null;
  if (kernelImage === null && kernel.ok) fail('kernel', config.kernel, 'kernel produced no code');
  return {
    ok,
    diagnostics,
    firmware,
    kernel,
    kernelImage,
    kernelChecksum,
    programs,
    rom: firmware.segments,
    disk,
    dataFiles,
    kernelSymbols,
  };
}

/** Machine configuration for booting a built system: ROM chip + storage medium only. */
export function bootConfig(build: SystemBuild): MachineConfig {
  return { rom: build.rom, disk: build.disk };
}

export const DEFAULT_PROGRAMS: ProgramSpec[] = [
  { name: 'alpha', path: 'programs/alpha.asm' },
  { name: 'digits', path: 'programs/digits.asm' },
  { name: 'echo', path: 'programs/echo.asm' },
  { name: 'blinker', path: 'programs/blinker.asm' },
];
