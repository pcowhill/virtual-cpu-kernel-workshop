/** A memory-mapped device occupying one 16-byte register block. */
export interface Device<S = unknown> {
  readonly id: string;
  readonly name: string;
  /** Base address of the 16-byte register block. */
  readonly base: number;
  /** Guest read: may have side effects (e.g. dequeuing a key). */
  read(offset: number): number;
  /** Debugger read: never has side effects. */
  peek(offset: number): number;
  write(offset: number, value: number): void;
  reset(): void;
  getState(): S;
  setState(state: S): void;
}

/** Devices that advance with the simulated clock. */
export interface ClockedDevice {
  tick(): void;
}

/** Devices that drive an interrupt request line. */
export interface InterruptSource {
  readonly irqLine: number;
  irqAsserted(): boolean;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
