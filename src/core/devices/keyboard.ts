import { IRQ_LINE, KBD_QUEUE_CAPACITY } from '../isa/constants';
import type { Device, InterruptSource } from './device';

export interface KeyboardState {
  queue: number[];
  overflow: boolean;
  ctrl: number;
  received: number;
}

/** Keyboard input device with a 16-byte FIFO (IRQ line 1). */
export class Keyboard implements Device<KeyboardState>, InterruptSource {
  readonly id = 'keyboard';
  readonly name = 'Keyboard';
  readonly base = 0xf040;
  readonly irqLine = IRQ_LINE.KEYBOARD;

  queue: number[] = [];
  overflow = false;
  ctrl = 0;
  /** Total bytes accepted (host statistic). */
  received = 0;

  reset(): void {
    this.queue = [];
    this.overflow = false;
    this.ctrl = 0;
    this.received = 0;
  }

  /** Host input: a key arrives at the current simulated cycle. Returns false if dropped. */
  inject(byte: number): boolean {
    if (this.queue.length >= KBD_QUEUE_CAPACITY) {
      this.overflow = true;
      return false;
    }
    this.queue.push(byte & 0xff);
    this.received++;
    return true;
  }

  peek(offset: number): number {
    switch (offset) {
      case 0x0:
        return this.queue[0] ?? 0;
      case 0x1:
        return (this.queue.length > 0 ? 0x01 : 0) | (this.overflow ? 0x02 : 0);
      case 0x2:
        return this.ctrl;
      case 0x3:
        return this.queue.length;
      default:
        return 0;
    }
  }

  read(offset: number): number {
    if (offset === 0x0) return this.queue.shift() ?? 0;
    return this.peek(offset);
  }

  write(offset: number, value: number): void {
    if (offset === 0x1 && value & 0x02) this.overflow = false;
    else if (offset === 0x2) this.ctrl = value & 0x01;
  }

  irqAsserted(): boolean {
    return this.queue.length > 0 && (this.ctrl & 0x01) !== 0;
  }

  getState(): KeyboardState {
    return { queue: [...this.queue], overflow: this.overflow, ctrl: this.ctrl, received: this.received };
  }

  setState(s: KeyboardState): void {
    this.queue = [...s.queue];
    this.overflow = s.overflow;
    this.ctrl = s.ctrl;
    this.received = s.received;
  }
}
