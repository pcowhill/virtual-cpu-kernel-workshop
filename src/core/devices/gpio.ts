import type { Device } from './device';

export interface GpioState {
  leds: number;
  switches: number;
  ledWrites: number;
}

/** Eight output LEDs and eight input switches. */
export class Gpio implements Device<GpioState> {
  readonly id = 'gpio';
  readonly name = 'LEDs / GPIO';
  readonly base = 0xf050;

  leds = 0;
  switches = 0;
  /** Number of guest writes to the LED register (host statistic). */
  ledWrites = 0;

  reset(): void {
    this.leds = 0;
    this.ledWrites = 0;
    // Switch positions are physical inputs; they survive a reset.
  }

  setSwitches(value: number): void {
    this.switches = value & 0xff;
  }

  peek(offset: number): number {
    return offset === 0 ? this.leds : offset === 1 ? this.switches : 0;
  }

  read(offset: number): number {
    return this.peek(offset);
  }

  write(offset: number, value: number): void {
    if (offset === 0) {
      this.leds = value & 0xff;
      this.ledWrites++;
    }
  }

  getState(): GpioState {
    return { leds: this.leds, switches: this.switches, ledWrites: this.ledWrites };
  }

  setState(s: GpioState): void {
    this.leds = s.leds;
    this.switches = s.switches;
    this.ledWrites = s.ledWrites;
  }
}
