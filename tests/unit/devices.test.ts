/** Device register behaviour, exercised both directly and by guest programs. */
import { describe, expect, it } from 'vitest';
import { Timer } from '../../src/core/devices/timer';
import { Keyboard } from '../../src/core/devices/keyboard';
import { Storage, DISK_STATUS } from '../../src/core/devices/storage';
import { Terminal } from '../../src/core/devices/terminal';
import { bareMachine } from '../helpers';

describe('timer', () => {
  it('counts down per cycle, expires, reloads when periodic', () => {
    const t = new Timer();
    t.write(2, 3);
    t.write(3, 0);
    t.write(0, 0x05); // EN | PERIODIC
    expect(t.count).toBe(3);
    t.tick();
    t.tick();
    expect(t.expired).toBe(false);
    t.tick();
    expect(t.expired).toBe(true);
    expect(t.count).toBe(3);
    expect(t.irqAsserted()).toBe(false); // IE not set
    t.write(0, 0x07);
    expect(t.irqAsserted()).toBe(true);
    t.write(1, 1); // acknowledge
    expect(t.expired).toBe(false);
    expect(t.irqAsserted()).toBe(false);
  });

  it('one-shot mode disables itself; reload 0 means 65536', () => {
    const t = new Timer();
    t.write(0, 0x01);
    expect(t.count).toBe(0x10000);
    for (let i = 0; i < 0x10000; i++) t.tick();
    expect(t.expired).toBe(true);
    expect(t.ctrl & 1).toBe(0);
  });

  it('reading COUNT reports the live count', () => {
    const t = new Timer();
    t.write(2, 0x34);
    t.write(3, 0x12);
    t.write(0, 1);
    t.tick();
    expect(t.read(4) | (t.read(5) << 8)).toBe(0x1233);
  });
});

describe('keyboard', () => {
  it('FIFO, status, overflow and level-sensitive IRQ', () => {
    const k = new Keyboard();
    expect(k.read(1)).toBe(0);
    for (let i = 0; i < 16; i++) expect(k.inject(65 + i)).toBe(true);
    expect(k.inject(1)).toBe(false);
    expect(k.read(1)).toBe(0x03); // AVAIL | OVERFLOW
    expect(k.read(3)).toBe(16);
    expect(k.irqAsserted()).toBe(false);
    k.write(2, 1);
    expect(k.irqAsserted()).toBe(true);
    expect(k.peek(0)).toBe(65); // peek does not dequeue
    expect(k.read(0)).toBe(65);
    expect(k.read(0)).toBe(66);
    k.write(1, 0x02);
    expect(k.read(1)).toBe(0x01);
  });
});

describe('storage', () => {
  it('read command completes after a fixed latency and fills the buffer', () => {
    const s = new Storage();
    const img = new Uint8Array(512);
    img[256] = 0xaa;
    img[257] = 0xbb;
    s.loadImage(img);
    s.write(2, 1); // block 1
    s.write(0, 1); // READ
    expect(s.read(1) & DISK_STATUS.BUSY).toBeTruthy();
    for (let i = 0; i < 63; i++) s.tick();
    expect(s.read(1) & DISK_STATUS.BUSY).toBeTruthy();
    s.tick();
    expect(s.read(1)).toBe(DISK_STATUS.DONE);
    expect(s.read(4)).toBe(0xaa);
    expect(s.read(4)).toBe(0xbb);
  });

  it('write command stores the buffer; errors are reported', () => {
    const s = new Storage();
    s.write(0, 3); // rewind
    s.write(4, 0x11);
    s.write(4, 0x22);
    s.write(2, 5);
    s.write(0, 2);
    for (let i = 0; i < 64; i++) s.tick();
    expect(Array.from(s.image.slice(5 * 256, 5 * 256 + 2))).toEqual([0x11, 0x22]);
    s.write(3, 1); // block 0x105: out of range
    s.write(0, 1);
    for (let i = 0; i < 64; i++) s.tick();
    expect(s.read(1)).toBe(DISK_STATUS.ERROR);
    expect(s.read(5)).toBe(1);
    s.write(1, 0);
    expect(s.read(1)).toBe(0);
    s.write(0, 9);
    expect(s.read(5)).toBe(2);
  });

  it('completion raises IRQ only when enabled', () => {
    const s = new Storage();
    s.write(0, 1);
    for (let i = 0; i < 64; i++) s.tick();
    expect(s.irqAsserted()).toBe(false);
    s.write(6, 1);
    expect(s.irqAsserted()).toBe(true);
  });
});

describe('terminal', () => {
  it('prints, handles control characters and wraps at 80 columns', () => {
    const t = new Terminal();
    for (const ch of 'AB\rC\nX\bY') t.write(0, ch.charCodeAt(0));
    expect(t.text()).toBe('CB\nY');
    t.write(0, 0x01);
    expect(t.text()).toBe('CB\nY·');
    t.write(2, 1);
    expect(t.text()).toBe('');
    for (let i = 0; i < 81; i++) t.write(0, 0x2a);
    expect(t.lines).toEqual(['*'.repeat(80)]);
    expect(t.read(1)).toBe(1);
  });
});

describe('guest programs driving devices', () => {
  it('prints a string to the terminal', () => {
    const { m } = bareMachine(`
      MOVP P0, #msg
loop: LD R2, [P0]
      CMP R2, #0
      JEQ done
      ST [0xF030], R2
      INCP P0
      JMP loop
done: HLT
msg:  .asciz "Hello, VC-8!\\n"`);
    m.run(10000);
    expect(m.terminal.text()).toBe('Hello, VC-8!\n');
  });

  it('LED register reflects guest writes; switches are readable', () => {
    const { m } = bareMachine(`
      LD R0, [0xF051]
      NOT R0
      ST [0xF050], R0
      HLT`);
    m.setSwitches(0x0f);
    m.run(1000);
    expect(m.gpio.leds).toBe(0xf0);
  });

  it('polls the storage device and copies a block with programmed I/O', () => {
    const disk = new Uint8Array(65536);
    for (let i = 0; i < 256; i++) disk[3 * 256 + i] = (i * 7) & 0xff;
    const { m } = bareMachine(`
      MOV R0, #3
      ST [0xF062], R0
      MOV R0, #0
      ST [0xF063], R0
      MOV R0, #1
      ST [0xF060], R0       ; READ block 3
wait: LD R0, [0xF061]
      AND R0, #0x06
      JEQ wait
      MOVP P1, #0x2000
      MOV R4, #0
copy: LD R0, [0xF064]
      ST [P1], R0
      INCP P1
      DEC R4
      JNE copy
      HLT`);
    m.storage.loadImage(disk);
    m.run(20000);
    for (let i = 0; i < 256; i++) expect(m.bus.peek(0x2000 + i)).toBe((i * 7) & 0xff);
  });

  it('reads the latched cycle counter', () => {
    const { m } = bareMachine(`
      LD R0, [0xF004]
      LD R1, [0xF005]
      HLT`);
    m.run(1000);
    expect(m.cpu.r[1]).toBe(0);
    expect(m.cpu.r[0]).toBe(5 + 6); // reset (5 cycles) + the 6 cycles of LD before its MEM READ cycle
  });

  it('powers off through the system control register', () => {
    const { m } = bareMachine(`
      MOV R0, #0xA5
      ST [0xF002], R0
      NOP`);
    const res = m.run(1000);
    expect(res.reason).toBe('power-off');
    expect(m.cpu.status).toBe('off');
  });

  it('the debugger can peek device registers without side effects', () => {
    const { m } = bareMachine('HLT');
    m.injectKey(0x41);
    expect(m.bus.peek(0xf040)).toBe(0x41);
    expect(m.bus.peek(0xf040)).toBe(0x41);
    expect(m.keyboard.queue).toEqual([0x41]);
    expect(() => m.debugPoke(0xf050, 1)).toThrow();
  });
});
