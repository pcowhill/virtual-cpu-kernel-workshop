import { IRQ_LINE } from '../isa/constants';
import type { ClockedDevice, Device, InterruptSource } from './device';

export interface TimerState {
  ctrl: number;
  expired: boolean;
  reload: number;
  count: number;
  expirations: number;
}

export const TIMER_CTRL = { EN: 0x01, IE: 0x02, PERIODIC: 0x04 } as const;

/** Programmable down-counting timer driven by the simulated clock (IRQ line 0). */
export class Timer implements Device<TimerState>, ClockedDevice, InterruptSource {
  readonly id = 'timer';
  readonly name = 'Programmable timer';
  readonly base = 0xf020;
  readonly irqLine = IRQ_LINE.TIMER;

  ctrl = 0;
  expired = false;
  reload = 0;
  count = 0;
  /** Total expirations since reset (host statistic, not a register). */
  expirations = 0;

  reset(): void {
    this.ctrl = 0;
    this.expired = false;
    this.reload = 0;
    this.count = 0;
    this.expirations = 0;
  }

  private effectiveReload(): number {
    return this.reload === 0 ? 0x10000 : this.reload;
  }

  peek(offset: number): number {
    switch (offset) {
      case 0x0:
        return this.ctrl;
      case 0x1:
        return this.expired ? 1 : 0;
      case 0x2:
        return this.reload & 0xff;
      case 0x3:
        return this.reload >> 8;
      case 0x4:
        return this.count & 0xff;
      case 0x5:
        return (this.count >> 8) & 0xff;
      default:
        return 0;
    }
  }

  read(offset: number): number {
    return this.peek(offset);
  }

  write(offset: number, value: number): void {
    switch (offset) {
      case 0x0: {
        const wasEnabled = (this.ctrl & TIMER_CTRL.EN) !== 0;
        this.ctrl = value & 0x07;
        if (!wasEnabled && this.ctrl & TIMER_CTRL.EN) this.count = this.effectiveReload();
        break;
      }
      case 0x1:
        if (value & 1) this.expired = false;
        break;
      case 0x2:
        this.reload = (this.reload & 0xff00) | value;
        break;
      case 0x3:
        this.reload = (this.reload & 0x00ff) | (value << 8);
        break;
      default:
        break;
    }
  }

  tick(): void {
    if (!(this.ctrl & TIMER_CTRL.EN)) return;
    this.count--;
    if (this.count <= 0) {
      this.expired = true;
      this.expirations++;
      if (this.ctrl & TIMER_CTRL.PERIODIC) this.count = this.effectiveReload();
      else {
        this.count = 0;
        this.ctrl &= ~TIMER_CTRL.EN;
      }
    }
  }

  irqAsserted(): boolean {
    return this.expired && (this.ctrl & TIMER_CTRL.IE) !== 0;
  }

  /** Cycles until the next expiry, or Infinity if not counting. */
  cyclesUntilExpiry(): number {
    return this.ctrl & TIMER_CTRL.EN ? this.count : Infinity;
  }

  getState(): TimerState {
    return {
      ctrl: this.ctrl,
      expired: this.expired,
      reload: this.reload,
      count: this.count,
      expirations: this.expirations,
    };
  }

  setState(s: TimerState): void {
    this.ctrl = s.ctrl;
    this.expired = s.expired;
    this.reload = s.reload;
    this.count = s.count;
    this.expirations = s.expirations;
  }
}
