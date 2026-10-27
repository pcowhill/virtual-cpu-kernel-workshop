import { describe, expect, it } from 'vitest';
import { Ring } from '../../src/core/machine/trace';
import { bareMetalConfig } from '../../src/core/build/bareMetal';

describe('trace ring buffer', () => {
  it('peekLast agrees with toArray().at(-1) across wrap-around, resize and zero capacity', () => {
    for (const cap of [0, 1, 3, 7]) {
      const r = new Ring<number>(cap);
      expect(r.peekLast()).toBeUndefined();
      for (let i = 0; i < 25; i++) {
        r.push(i);
        expect(r.peekLast()).toBe(r.toArray().at(-1));
        if (i === 12) r.resize(Math.max(0, cap - 1));
      }
    }
  });

  it('since() returns items pushed after a given total', () => {
    const r = new Ring<number>(4);
    for (let i = 0; i < 10; i++) r.push(i);
    expect(r.since(7)).toEqual([7, 8, 9]);
    expect(r.since(0)).toEqual([6, 7, 8, 9]);
  });
});

describe('bare-metal loader', () => {
  it('refuses bytes in device space', () => {
    expect(() => bareMetalConfig([{ address: 0xeffe, bytes: new Uint8Array(4) }])).toThrow(/device \(MMIO\) space/);
  });

  it('splits a segment that spans ROM and RAM', () => {
    const cfg = bareMetalConfig([{ address: 0x1ffe, bytes: new Uint8Array([1, 2, 3, 4]) }]);
    expect(cfg.rom).toEqual([{ address: 0x1ffe, bytes: new Uint8Array([1, 2]) }]);
    expect(cfg.preload).toEqual([{ address: 0x2000, bytes: new Uint8Array([3, 4]) }]);
  });
});
