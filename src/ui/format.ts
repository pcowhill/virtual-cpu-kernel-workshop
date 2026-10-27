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
/**
 * Parse an address typed by the user. Symbols of the loaded program win;
 * numbers are hexadecimal like everywhere else in the workbench (0x2000,
 * $2000, 2000h or plain 2000); decimal needs a # prefix or d suffix.
 */
export function parseAddress(text: string, lookup?: (name: string) => number | undefined): number | null {
  const t = text.trim();
  if (!t) return null;
  const v = lookup?.(t);
  if (v !== undefined) return v & 0xffff;
  let m = /^(?:0x|\$)([0-9a-f]{1,4})$/i.exec(t) ?? /^([0-9a-f]{1,4})h$/i.exec(t) ?? /^([0-9a-f]{1,4})$/i.exec(t);
  if (m) return parseInt(m[1]!, 16);
  m = /^#([0-9]{1,5})$/.exec(t) ?? /^([0-9]{1,5})d$/i.exec(t);
  if (m && Number(m[1]) <= 0xffff) return Number(m[1]);
  return null;
}

/**
 * Parse a register value typed by the user: decimal by default (42, -2),
 * hexadecimal with 0x/$ or an h suffix, binary with 0b. Returns null if invalid.
 */
export function parseValue(text: string): number | null {
  const t = text.trim();
  let m = /^(-?)(?:0x|\$)([0-9a-f]+)$/i.exec(t) ?? /^(-?)([0-9a-f]+)h$/i.exec(t);
  let v: number;
  if (m) v = parseInt(m[2]!, 16);
  else if ((m = /^(-?)0b([01]+)$/i.exec(t))) v = parseInt(m[2]!, 2);
  else if ((m = /^(-?)([0-9]+)$/.exec(t))) v = Number(m[2]);
  else return null;
  if (v > 0xffff) return null;
  return m[1] ? -v & 0xffff : v;
}

export function formatCycles(c: number): string {
  return c.toLocaleString('en-US');
}

export function formatHz(hz: number): string {
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(2)} MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(1)} kHz`;
  return `${hz.toFixed(0)} Hz`;
}
