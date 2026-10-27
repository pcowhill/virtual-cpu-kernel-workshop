import { DISK_BLOCK_COUNT, DISK_BLOCK_SIZE, DISK_LATENCY_CYCLES, IRQ_LINE } from '../isa/constants';
import { base64ToBytes, bytesToBase64, type ClockedDevice, type Device, type InterruptSource } from './device';

export const DISK_STATUS = { BUSY: 0x01, DONE: 0x02, ERROR: 0x04 } as const;
export const DISK_CMD = { READ: 0x01, WRITE: 0x02, REWIND: 0x03 } as const;
export const DISK_ERR = { NONE: 0, BAD_BLOCK: 1, BAD_COMMAND: 2, BUSY: 3 } as const;

export interface StorageState {
  image: string; // base64 of the full medium
  buffer: string; // base64 of the 256-byte buffer
  ptr: number;
  block: number;
  status: number;
  errcode: number;
  ctrl: number;
  busyCycles: number;
  pendingCmd: number;
  reads: number;
  writes: number;
}

/** Block storage: 256 × 256-byte blocks, programmed-I/O data port, fixed latency (IRQ line 2). */
export class Storage implements Device<StorageState>, ClockedDevice, InterruptSource {
  readonly id = 'storage';
  readonly name = 'Block storage';
  readonly base = 0xf060;
  readonly irqLine = IRQ_LINE.STORAGE;

  /** The storage medium. Survives CPU reset (it is persistent media). */
  image = new Uint8Array(DISK_BLOCK_COUNT * DISK_BLOCK_SIZE);
  buffer = new Uint8Array(DISK_BLOCK_SIZE);
  ptr = 0;
  block = 0;
  status = 0;
  errcode = 0;
  ctrl = 0;
  busyCycles = 0;
  pendingCmd = 0;
  reads = 0;
  writes = 0;

  /** Controller reset: registers clear, the medium is untouched. */
  reset(): void {
    this.buffer.fill(0);
    this.ptr = 0;
    this.block = 0;
    this.status = 0;
    this.errcode = 0;
    this.ctrl = 0;
    this.busyCycles = 0;
    this.pendingCmd = 0;
    this.reads = 0;
    this.writes = 0;
  }

  /** Host: insert a medium (e.g. a freshly built disk image). */
  loadImage(bytes: Uint8Array): void {
    this.image.fill(0);
    this.image.set(bytes.subarray(0, this.image.length));
  }

  peek(offset: number): number {
    switch (offset) {
      case 0x1:
        return this.status;
      case 0x2:
        return this.block & 0xff;
      case 0x3:
        return this.block >> 8;
      case 0x4:
        return this.buffer[this.ptr]!;
      case 0x5:
        return this.errcode;
      case 0x6:
        return this.ctrl;
      case 0x7:
        return DISK_BLOCK_COUNT & 0xff;
      default:
        return 0;
    }
  }

  read(offset: number): number {
    if (offset === 0x4) {
      const v = this.buffer[this.ptr]!;
      this.ptr = (this.ptr + 1) & 0xff;
      return v;
    }
    return this.peek(offset);
  }

  write(offset: number, value: number): void {
    switch (offset) {
      case 0x0:
        this.command(value);
        break;
      case 0x1:
        this.status &= ~(DISK_STATUS.DONE | DISK_STATUS.ERROR);
        break;
      case 0x2:
        this.block = (this.block & 0xff00) | value;
        break;
      case 0x3:
        this.block = (this.block & 0x00ff) | (value << 8);
        break;
      case 0x4:
        this.buffer[this.ptr] = value;
        this.ptr = (this.ptr + 1) & 0xff;
        break;
      case 0x6:
        this.ctrl = value & 0x01;
        break;
      default:
        break;
    }
  }

  private fail(code: number): void {
    this.status = (this.status & ~(DISK_STATUS.BUSY | DISK_STATUS.DONE)) | DISK_STATUS.ERROR;
    this.errcode = code;
  }

  private command(cmd: number): void {
    if (this.status & DISK_STATUS.BUSY) {
      // The in-flight operation continues; the new command is rejected.
      this.errcode = DISK_ERR.BUSY;
      return;
    }
    this.ptr = 0;
    this.status &= ~(DISK_STATUS.DONE | DISK_STATUS.ERROR);
    this.errcode = DISK_ERR.NONE;
    if (cmd === DISK_CMD.REWIND) return;
    if (cmd !== DISK_CMD.READ && cmd !== DISK_CMD.WRITE) {
      this.fail(DISK_ERR.BAD_COMMAND);
      return;
    }
    this.pendingCmd = cmd;
    this.busyCycles = DISK_LATENCY_CYCLES;
    this.status |= DISK_STATUS.BUSY;
  }

  tick(): void {
    if (!(this.status & DISK_STATUS.BUSY)) return;
    if (--this.busyCycles > 0) return;
    const cmd = this.pendingCmd;
    this.pendingCmd = 0;
    if (this.block >= DISK_BLOCK_COUNT) {
      this.fail(DISK_ERR.BAD_BLOCK);
      return;
    }
    const start = this.block * DISK_BLOCK_SIZE;
    if (cmd === DISK_CMD.READ) {
      this.buffer.set(this.image.subarray(start, start + DISK_BLOCK_SIZE));
      this.reads++;
    } else {
      this.image.set(this.buffer, start);
      this.writes++;
    }
    this.status = (this.status & ~DISK_STATUS.BUSY) | DISK_STATUS.DONE;
  }

  irqAsserted(): boolean {
    return (this.status & (DISK_STATUS.DONE | DISK_STATUS.ERROR)) !== 0 && (this.ctrl & 1) !== 0;
  }

  getState(): StorageState {
    return {
      image: bytesToBase64(this.image),
      buffer: bytesToBase64(this.buffer),
      ptr: this.ptr,
      block: this.block,
      status: this.status,
      errcode: this.errcode,
      ctrl: this.ctrl,
      busyCycles: this.busyCycles,
      pendingCmd: this.pendingCmd,
      reads: this.reads,
      writes: this.writes,
    };
  }

  setState(s: StorageState): void {
    this.image.set(base64ToBytes(s.image));
    this.buffer.set(base64ToBytes(s.buffer));
    this.ptr = s.ptr;
    this.block = s.block;
    this.status = s.status;
    this.errcode = s.errcode;
    this.ctrl = s.ctrl;
    this.busyCycles = s.busyCycles;
    this.pendingCmd = s.pendingCmd;
    this.reads = s.reads;
    this.writes = s.writes;
  }
}
