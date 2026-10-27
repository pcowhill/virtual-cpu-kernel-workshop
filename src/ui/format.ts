import { PSW } from '../core/isa/constants';

export const hex2 = (v: number): string => (v & 0xff).toString(16).toUpperCase().padStart(2, '0');
export const hex4 = (v: number): string => (v & 0xffff).toString(16).toUpperCase().padStart(4, '0');
export const bin8 = (v: number): string => (v & 0xff).toString(2).padStart(8, '0');
export const signed8 = (v: number): number => (v & 0x80 ? (v & 0xff) - 256 : v & 0xff);
export const signed16 = (v: number): number => (v & 0x8000 ? (v & 0xffff) - 65536 : v & 0xffff);

export function flagsString(psw: number): string {
  return (
    (psw & PSW.S ? 'S' : '-') +
    (psw & PSW.I ? 'I' : '-') +
    (psw & PSW.V ? 'V' : '-') +
    (psw & PSW.N ? 'N' : '-') +
    (psw & PSW.Z ? 'Z' : '-') +
    (psw & PSW.C ? 'C' : '-')
  );
}

export function printable(b: number): string {
  return b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·';
}

/** Parse "0x1234", "1234h", "$1234", decimal, or a symbol via `lookup`. */
export function parseAddress(text: string, lookup?: (name: string) => number | undefined): number | null {
  const t = text.trim();
  if (!t) return null;
  let m = /^(?:0x|\$)([0-9a-f]+)$/i.exec(t) ?? /^([0-9a-f]+)h$/i.exec(t);
  if (m) return parseInt(m[1]!, 16) & 0xffff;
  m = /^[0-9]+$/.exec(t);
  if (m) return Number(t) & 0xffff;
  if (/^[0-9a-f]{1,4}$/i.test(t)) return parseInt(t, 16);
  const v = lookup?.(t);
  return v === undefined ? null : v & 0xffff;
}

export function formatCycles(c: number): string {
  return c.toLocaleString('en-US');
}

export function formatHz(hz: number): string {
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(2)} MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(1)} kHz`;
  return `${hz.toFixed(0)} Hz`;
}
