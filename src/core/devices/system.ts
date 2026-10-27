import { POWER_OFF_MAGIC, SYS_ID_VALUE, SYS_VERSION_VALUE } from '../isa/constants';
import type { Device, InterruptSource } from './device';

export interface InterruptControllerState {
  mask: number;
}

/** Interrupt controller: collects level-sensitive request lines and applies a per-line mask. */
export class InterruptController implements Device<InterruptControllerState> {
  readonly id = 'pic';
  readonly name = 'Interrupt controller';
  readonly base = 0xf010;
  mask = 0;

  constructor(private readonly sources: readonly InterruptSource[]) {}

  /** Bit n set while line n is asserted by its device. */
  pending(): number {
    let p = 0;
    for (const s of this.sources) if (s.irqAsserted()) p |= 1 << s.irqLine;
    return p;
  }

  pendingEnabled(): number {
    return this.pending() & this.mask;
  }

  reset(): void {
    this.mask = 0;
  }

  peek(offset: number): number {
    return offset === 0 ? this.pending() : offset === 1 ? this.mask : 0;
  }

  read(offset: number): number {
    return this.peek(offset);
  }

  write(offset: number, value: number): void {
    if (offset === 1) this.mask = value & 0xff;
  }

  getState(): InterruptControllerState {
    return { mask: this.mask };
  }

  setState(s: InterruptControllerState): void {
    this.mask = s.mask;
  }
}

export interface SystemControlState {
  latch: number[];
}

/** System control: ID, version, power-off, cycle counter. */
export class SystemControl implements Device<SystemControlState> {
  readonly id = 'sysctl';
  readonly name = 'System control';
  readonly base = 0xf000;
  latch = [0, 0, 0, 0];

  constructor(
    private readonly cycles: () => number,
    private readonly powerOff: () => void,
  ) {}

  reset(): void {
    this.latch = [0, 0, 0, 0];
  }

  peek(offset: number): number {
    switch (offset) {
      case 0x0:
        return SYS_ID_VALUE;
      case 0x1:
        return SYS_VERSION_VALUE;
      case 0x4:
        return this.cycles() & 0xff;
      case 0x5:
      case 0x6:
      case 0x7:
        return this.latch[offset - 4]!;
      default:
        return 0;
    }
  }

  read(offset: number): number {
    if (offset === 0x4) {
      const c = this.cycles();
      this.latch = [c & 0xff, (c >>> 8) & 0xff, (c >>> 16) & 0xff, (c >>> 24) & 0xff];
      return this.latch[0]!;
    }
    return this.peek(offset);
  }

  write(offset: number, value: number): void {
    if (offset === 0x2 && value === POWER_OFF_MAGIC) this.powerOff();
  }

  getState(): SystemControlState {
    return { latch: [...this.latch] };
  }

  setState(s: SystemControlState): void {
    this.latch = [...s.latch];
  }
}
