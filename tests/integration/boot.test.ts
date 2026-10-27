/**
 * Boot integration: the CPU executes the real firmware from ROM, which reads
 * the kernel from block storage and copies it into RAM. No mocks: these tests
 * observe the virtual machine running the assembled guest software.
 */
import { describe, expect, it } from 'vitest';
import { bootConfig } from '../../src/core/build/system';
import { DISK_BLOCK_SIZE, MEM } from '../../src/core/isa/constants';
import { Machine } from '../../src/core/machine/machine';
import { GUEST_SOURCES } from '../../src/guest';
import { boot, build, prog } from './os-helpers';

function sym(b: ReturnType<typeof build>, name: string, which: 'kernel' | 'firmware' = 'kernel'): number {
  const v = b[which].symbols.find((s) => s.name === name)?.value;
  if (v === undefined) throw new Error(`no symbol ${name}`);
  return v;
}

describe('authentic boot sequence', () => {
  it('starts at the reset vector and executes firmware from ROM', () => {
    const { m, b } = boot([prog('hello')]);
    m.stepInstruction(); // the 5-cycle reset sequence
    expect(m.trace.toArray()[0]!.kind).toBe('reset');
    expect(m.cpu.pc).toBe(sym(b, 'fw_reset', 'firmware'));
    expect(m.cpu.supervisor).toBe(true);
    expect(m.cycle).toBe(5);
    m.stepInstruction();
    expect(m.trace.toArray()[1]!.pc).toBe(sym(b, 'fw_reset', 'firmware'));
  });

  it('the host never writes the kernel into RAM: firmware instructions copy every byte', () => {
    const { m, b } = boot([prog('hello')]);
    const k = b.kernelImage!;
    const lo = k.load;
    const hi = k.load + k.count * DISK_BLOCK_SIZE - 1;
    // After power-on kernel RAM is empty.
    for (let a = lo; a <= hi; a++) expect(m.bus.peek(a)).toBe(0);

    const writers = new Map<number, number>(); // address -> PC of the storing instruction
    m.bus.observer = (addr, kind) => {
      if (kind === 'write' && addr >= lo && addr <= hi) writers.set(addr, m.cpu.instrStart);
    };
    m.breakpoints.add(k.entry);
    const res = m.run(2_000_000);
    expect(res.reason).toBe('breakpoint');
    expect(m.cpu.pc).toBe(sym(b, 'kernel_entry'));
    // Every byte of the kernel image was stored by an instruction executing in ROM.
    expect(writers.size).toBe(k.count * DISK_BLOCK_SIZE);
    for (const pc of writers.values()) expect(pc).toBeLessThanOrEqual(MEM.ROM_END);
    // ... and RAM now holds exactly the image from the disk.
    const disk = b.disk.subarray(k.block * DISK_BLOCK_SIZE, (k.block + k.count) * DISK_BLOCK_SIZE);
    expect(Array.from(m.bus.mem.subarray(lo, hi + 1))).toEqual(Array.from(disk));
    // The storage device served the reads.
    expect(m.storage.reads).toBe(1 + k.count); // boot block + kernel blocks
    // Control reached the kernel by a JMP executed in ROM.
    const last = m.trace.peekLast()!;
    expect(last.pc).toBeLessThanOrEqual(MEM.ROM_END);
    expect(m.terminal.text()).toContain('Loading kernel ' + '.'.repeat(k.count) + ' checksum OK');
    expect(m.terminal.text()).toContain('Jumping to kernel entry at 0x2000');
  });

  it('firmware rejects a disk without a valid boot block', () => {
    const b = build([prog('hello')]);
    const disk = b.disk.slice();
    disk[0] = 0x00; // destroy the magic
    const m = new Machine();
    m.powerOn({ rom: b.rom, disk });
    const res = m.run(1_000_000);
    expect(res.reason).toBe('halted');
    expect(m.terminal.text()).toContain('No bootable kernel: bad boot block');
    expect(m.bus.peek(0x2000)).toBe(0);
  });

  it('firmware detects a corrupted kernel image by its checksum', () => {
    const b = build([prog('hello')]);
    const disk = b.disk.slice();
    const at = b.kernelImage!.block * DISK_BLOCK_SIZE + 100;
    disk[at] = disk[at]! ^ 0xff;
    const m = new Machine();
    m.powerOn({ rom: b.rom, disk });
    m.run(2_000_000);
    expect(m.terminal.text()).toContain('Kernel checksum mismatch');
    expect(m.cpu.pc).toBeLessThanOrEqual(MEM.ROM_END);
  });

  it.each([
    ['a load address that would overwrite the firmware stack', 6, 0x5e],
    ['a load address in device space', 6, 0xef],
    ['a kernel that runs off the end of the disk', 3, 250],
    ['a kernel starting at the boot block', 3, 0],
  ])('firmware rejects %s', (_name, offset, value) => {
    const b = build([prog('hello')]);
    const disk = b.disk.slice();
    disk[offset] = value;
    const m = new Machine();
    m.powerOn({ rom: b.rom, disk });
    const res = m.run(2_000_000);
    expect(res.reason).toBe('halted');
    expect(m.terminal.text()).toContain('Boot block describes an invalid kernel layout');
    expect(m.timer.ctrl).toBe(0);
    expect(m.gpio.leds).toBe(0);
  });

  it('firmware accepts a kernel that ends exactly at the last block (255)', () => {
    const b = build([prog('hello')]);
    const k = b.kernelImage!;
    const disk = b.disk.slice();
    const first = 256 - k.count;
    disk.set(b.disk.subarray(k.block * 256, (k.block + k.count) * 256), first * 256);
    disk[3] = first;
    const m = new Machine();
    m.powerOn({ rom: b.rom, disk });
    m.run(3_000_000);
    expect(m.terminal.text()).toContain('checksum OK');
    expect(m.terminal.text()).toContain('VC-8 Workshop Kernel');
  });

  it('firmware detects a kernel area that holds no kernel (checksum over the blocks it read)', () => {
    const b = build([prog('hello')]);
    const disk = b.disk.slice();
    disk[3] = 200; // kernel at block 200..211: valid layout, but the blocks are empty
    const m = new Machine();
    m.powerOn({ rom: b.rom, disk });
    m.run(2_000_000);
    expect(m.terminal.text()).toContain('Kernel checksum mismatch');
  });

  it('boots with an empty storage medium only as far as the firmware', () => {
    const b = build([prog('hello')]);
    const m = new Machine();
    m.powerOn({ rom: b.rom, disk: null });
    m.run(1_000_000);
    expect(m.terminal.text()).toContain('No bootable kernel');
  });

  it('editing the firmware source changes what the machine does after rebuild', () => {
    const b = build([prog('hello')], {
      'firmware/bios.asm': GUEST_SOURCES['firmware/bios.asm']!.replace(
        'VC-8 Workshop Boot ROM v1.0',
        'Custom ROM by the user',
      ),
    });
    const m = new Machine();
    m.powerOn(bootConfig(b));
    m.run(200_000);
    expect(m.terminal.text()).toContain('Custom ROM by the user');
  });
});
