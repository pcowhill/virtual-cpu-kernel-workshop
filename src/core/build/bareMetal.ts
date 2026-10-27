import { MEM } from '../isa/constants';
import type { MachineConfig, MemorySegment } from '../machine/machine';

/**
 * Turn an assembled bare-metal program into a machine configuration.
 *
 * Bytes addressed inside the boot ROM become the ROM chip's contents (the
 * program owns the reset vector). Bytes addressed in RAM are written by the
 * workbench acting as a hardware programmer before power-on — a debugger-level
 * action, clearly distinct from the authentic firmware boot path.
 */
export function bareMetalConfig(segments: readonly MemorySegment[], disk: Uint8Array | null = null): MachineConfig {
  const rom: MemorySegment[] = [];
  const preload: MemorySegment[] = [];
  for (const seg of segments) {
    const end = seg.address + seg.bytes.length;
    if (end > MEM.MMIO_START) {
      throw new Error(
        `cannot load bytes at 0x${MEM.MMIO_START.toString(16)}–0x${(end - 1).toString(16)}: that is device (MMIO) space`,
      );
    }
    const romEnd = Math.min(end, MEM.ROM_END + 1);
    if (seg.address <= MEM.ROM_END) {
      rom.push({ address: seg.address, bytes: seg.bytes.slice(0, romEnd - seg.address) });
    }
    if (end > MEM.KRAM_START) {
      const from = Math.max(seg.address, MEM.KRAM_START);
      const to = Math.min(end, MEM.URAM_END + 1);
      if (to > from) preload.push({ address: from, bytes: seg.bytes.slice(from - seg.address, to - seg.address) });
    }
  }
  return { rom, preload, disk };
}
