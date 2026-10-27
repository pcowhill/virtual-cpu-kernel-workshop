import { MEM } from '../isa/constants';
import type { CpuBus } from '../cpu/types';
import type { Device } from '../devices/device';

export type BusAccessObserver = (addr: number, kind: 'read' | 'write', value: number, old: number) => void;

/**
 * The system bus: 64 KiB of ROM/RAM storage plus memory-mapped device blocks.
 * Protection is enforced by the CPU's protection unit *before* accesses reach
 * the bus; the bus itself only routes them.
 */
export class Bus implements CpuBus {
  readonly mem = new Uint8Array(MEM.SIZE);
  private readonly blocks: (Device | undefined)[] = new Array(256).fill(undefined);
  readonly devices: Device[] = [];
  /** Optional observer for CPU accesses (watchpoints, trace). Not called for debugger peeks. */
  observer: BusAccessObserver | null = null;

  attach(device: Device): void {
    const idx = (device.base - MEM.MMIO_START) >> 4;
    if (device.base < MEM.MMIO_START || (device.base & 0xf) !== 0 || this.blocks[idx]) {
      throw new Error(`cannot attach ${device.name} at 0x${device.base.toString(16)}`);
    }
    this.blocks[idx] = device;
    this.devices.push(device);
  }

  deviceAt(addr: number): Device | undefined {
    return addr >= MEM.MMIO_START ? this.blocks[(addr - MEM.MMIO_START) >> 4] : undefined;
  }

  isDecoded(addr: number): boolean {
    return this.deviceAt(addr) !== undefined;
  }

  read(addr: number): number {
    let v: number;
    if (addr >= MEM.MMIO_START) {
      const d = this.blocks[(addr - MEM.MMIO_START) >> 4];
      v = d ? d.read(addr & 0xf) & 0xff : 0;
    } else {
      v = this.mem[addr]!;
    }
    if (this.observer) this.observer(addr, 'read', v, v);
    return v;
  }

  write(addr: number, value: number): void {
    let old: number;
    if (addr >= MEM.MMIO_START) {
      const d = this.blocks[(addr - MEM.MMIO_START) >> 4];
      old = d ? d.peek(addr & 0xf) : 0;
      d?.write(addr & 0xf, value);
    } else {
      old = this.mem[addr]!;
      this.mem[addr] = value;
    }
    if (this.observer) this.observer(addr, 'write', value, old);
  }

  /** Side-effect-free read for debuggers and visualisations. */
  peek(addr: number): number {
    addr &= 0xffff;
    if (addr >= MEM.MMIO_START) {
      const d = this.blocks[(addr - MEM.MMIO_START) >> 4];
      return d ? d.peek(addr & 0xf) & 0xff : 0;
    }
    return this.mem[addr]!;
  }

  peekWord(addr: number): number {
    return this.peek(addr) | (this.peek((addr + 1) & 0xffff) << 8);
  }
}
