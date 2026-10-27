import { GUEST_SOURCES, FIRMWARE_MAIN, KERNEL_MAIN } from '../../src/guest';
import { bootConfig, buildSystem, type ProgramSpec, type SystemBuild } from '../../src/core/build/system';
import { Machine } from '../../src/core/machine/machine';

export function build(programs: ProgramSpec[], files: Record<string, string> = {}): SystemBuild {
  const b = buildSystem({ ...GUEST_SOURCES, ...files }, { firmware: FIRMWARE_MAIN, kernel: KERNEL_MAIN, programs });
  if (!b.ok) {
    throw new Error(
      'system build failed:\n' +
        b.diagnostics.map((d) => `[${d.component}] ${d.file}:${d.line}:${d.column} ${d.message}`).join('\n'),
    );
  }
  return b;
}

export function prog(name: string, file = name): ProgramSpec {
  return { name, path: `programs/${file}.asm` };
}

export function boot(programs: ProgramSpec[], files: Record<string, string> = {}): { m: Machine; b: SystemBuild } {
  const b = build(programs, files);
  const m = new Machine();
  m.breakOn.faults = false;
  m.powerOn(bootConfig(b));
  return { m, b };
}

/** Run until the machine halts, powers off, or the cycle budget is exhausted. */
export function runToHalt(m: Machine, maxCycles = 5_000_000) {
  return m.run(maxCycles);
}
