/** The workstation side: assembling the guest software and laying out the boot disk. */
import { describe, expect, it } from 'vitest';
import { buildSystem, slotBase } from '../../src/core/build/system';
import { GUEST_SOURCES, FIRMWARE_MAIN, KERNEL_MAIN } from '../../src/guest';
import { build, prog } from './os-helpers';

describe('system build and disk layout', () => {
  it('writes a boot block that describes the kernel and programs', () => {
    const b = build([prog('hello'), prog('alpha')]);
    const h = b.disk.subarray(0, 256);
    expect(String.fromCharCode(h[0]!, h[1]!)).toBe('VK');
    expect(h[2]).toBe(1);
    const k = b.kernelImage!;
    expect([h[3], h[4]]).toEqual([1, k.count]);
    expect(h[5]! | (h[6]! << 8)).toBe(0x2000);
    expect(h[7]! | (h[8]! << 8)).toBe(b.kernelSymbols['kernel_entry']);
    // Checksum: sum of all kernel block bytes modulo 256 (computed independently here).
    let sum = 0;
    for (let i = 256; i < 256 * (1 + k.count); i++) sum = (sum + b.disk[i]!) & 0xff;
    expect(h[9]).toBe(sum);
    expect(h[10]).toBe(2);
    const e0 = h.subarray(16, 32);
    expect(new TextDecoder().decode(e0.subarray(0, 5))).toBe('hello');
    expect(e0[8]).toBe(1 + k.count); // first program follows the kernel
    expect(e0[10]! | (e0[11]! << 8)).toBe(slotBase(0));
    expect(e0[14]).toBe(0);
    const e1 = h.subarray(32, 48);
    expect(e1[10]! | (e1[11]! << 8)).toBe(slotBase(1));
    expect(e1[14]).toBe(1);
  });

  it('assembles each user program for its own slot (PROC_BASE)', () => {
    const b = build([prog('spinner'), prog('spinner'), prog('spinner')]);
    expect(b.programs.map((p) => p.image!.load)).toEqual([0x6000, 0x8000, 0xa000]);
    expect(b.programs.map((p) => p.image!.entry)).toEqual([0x6000, 0x8000, 0xa000]);
  });

  it('places the data file in the data area', () => {
    const b = build([prog('reader')]);
    expect(new TextDecoder().decode(b.disk.subarray(128 * 256, 128 * 256 + 25))).toBe('Hello from block storage!');
  });

  it('reports diagnostics with the component that failed', () => {
    const b = buildSystem(
      { ...GUEST_SOURCES, 'programs/broken.asm': '.org PROC_BASE\nFROB R0' },
      { firmware: FIRMWARE_MAIN, kernel: KERNEL_MAIN, programs: [{ name: 'broken', path: 'programs/broken.asm' }] },
    );
    expect(b.ok).toBe(false);
    expect(b.diagnostics[0]).toMatchObject({ component: 'program broken', line: 2 });
    expect(b.diagnostics.map((d) => d.message).join('\n')).toMatch(/unknown instruction 'FROB'/);
  });

  it('rejects a program assembled outside its slot', () => {
    const b = buildSystem(
      { ...GUEST_SOURCES, 'programs/wrong.asm': '.org 0x9000\nstart: NOP' },
      { firmware: FIRMWARE_MAIN, kernel: KERNEL_MAIN, programs: [{ name: 'wrong', path: 'programs/wrong.asm' }] },
    );
    expect(b.ok).toBe(false);
    expect(b.diagnostics[0]!.message).toMatch(/outside the region allowed for this build: process slot 0/);
  });

  it('rejects more programs than process slots', () => {
    const b = buildSystem(GUEST_SOURCES, {
      firmware: FIRMWARE_MAIN,
      kernel: KERNEL_MAIN,
      programs: Array.from({ length: 5 }, () => prog('hello')),
    });
    expect(b.ok).toBe(false);
    expect(b.diagnostics.some((d) => /at most 4 programs/.test(d.message))).toBe(true);
  });

  it('keeps firmware inside the boot ROM and the kernel inside its image area', () => {
    const fw = buildSystem(
      { ...GUEST_SOURCES, 'firmware/bios.asm': '.org 0x2000\nNOP' },
      { firmware: FIRMWARE_MAIN, kernel: KERNEL_MAIN, programs: [] },
    );
    expect(fw.diagnostics.some((d) => d.component === 'firmware' && /Boot ROM/.test(d.message))).toBe(true);
    const k = buildSystem(
      { ...GUEST_SOURCES, 'kernel/main.asm': '.org 0x5000\nNOP' },
      { firmware: FIRMWARE_MAIN, kernel: KERNEL_MAIN, programs: [] },
    );
    expect(k.diagnostics.some((d) => d.component === 'kernel' && /kernel image area/.test(d.message))).toBe(true);
  });

  it('truncates long multi-byte names to 8 bytes instead of failing', () => {
    const b = build([{ name: 'héllo-wörld', path: 'programs/hello.asm' }]);
    const stored = b.disk.subarray(16, 24);
    expect(new TextDecoder('utf-8', { fatal: true }).decode(stored.filter((x) => x !== 0))).toBe('héllo-w');
  });

  it('reports an empty program and overlapping data files', () => {
    const empty = buildSystem(
      { ...GUEST_SOURCES, 'programs/empty.asm': '; nothing here' },
      { firmware: FIRMWARE_MAIN, kernel: KERNEL_MAIN, programs: [{ name: 'empty', path: 'programs/empty.asm' }] },
    );
    expect(empty.ok).toBe(false);
    expect(empty.diagnostics.map((d) => d.message).join()).toMatch(/produced no code/);
    const overlap = buildSystem(GUEST_SOURCES, {
      firmware: FIRMWARE_MAIN,
      kernel: KERNEL_MAIN,
      programs: [],
      dataFiles: [
        { block: 130, bytes: new Uint8Array(600), description: 'a' },
        { block: 132, bytes: new Uint8Array(10), description: 'b' },
      ],
    });
    expect(overlap.diagnostics.map((d) => d.message).join()).toMatch(/overlaps another data file/);
  });

  it('every shipped program builds', () => {
    const names = Object.keys(GUEST_SOURCES)
      .filter((p) => p.startsWith('programs/'))
      .map((p) => p.slice(9, -4));
    expect(names.length).toBeGreaterThanOrEqual(12);
    for (const n of names) expect(() => build([prog(n)])).not.toThrow();
  });
});
