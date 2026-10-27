import { TERM_COLS } from '../isa/constants';
import type { Device } from './device';

export interface TerminalState {
  lines: string[];
  current: string;
  col: number;
  bytesWritten: number;
  transcript: string;
}

/** Maximum lines of scroll-back retained by the host. */
export const TERMINAL_SCROLLBACK = 500;
/** Maximum characters retained in the raw transcript (most recent kept). */
export const TERMINAL_TRANSCRIPT_LIMIT = 32768;

/** Memory-mapped text terminal (output only). */
export class Terminal implements Device<TerminalState> {
  readonly id = 'terminal';
  readonly name = 'Text terminal';
  readonly base = 0xf030;

  /** Completed lines (oldest first), bounded by TERMINAL_SCROLLBACK. */
  lines: string[] = [];
  /** The line under the cursor. */
  current = '';
  col = 0;
  bytesWritten = 0;
  /** Raw byte transcript as text (bounded). */
  transcript = '';

  reset(): void {
    this.lines = [];
    this.current = '';
    this.col = 0;
    this.bytesWritten = 0;
    this.transcript = '';
  }

  peek(offset: number): number {
    return offset === 0x1 ? 0x01 : 0;
  }

  read(offset: number): number {
    return this.peek(offset);
  }

  write(offset: number, value: number): void {
    if (offset === 0x0) this.putByte(value);
    else if (offset === 0x2 && value === 0x01) this.clear();
  }

  private clear(): void {
    this.lines = [];
    this.current = '';
    this.col = 0;
  }

  private newline(): void {
    this.lines.push(this.current);
    if (this.lines.length > TERMINAL_SCROLLBACK) this.lines.shift();
    this.current = '';
    this.col = 0;
  }

  putByte(b: number): void {
    this.bytesWritten++;
    let ch: string;
    if (b === 0x0a) {
      this.newline();
      ch = '\n';
    } else if (b === 0x0d) {
      this.col = 0;
      ch = '\r';
    } else if (b === 0x08) {
      if (this.col > 0) this.col--;
      ch = '\b';
    } else {
      ch = b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '·';
      if (this.col >= TERM_COLS) this.newline();
      const padded = this.current.padEnd(this.col, ' ');
      this.current = padded.slice(0, this.col) + ch + padded.slice(this.col + 1);
      this.col++;
    }
    this.transcript += ch;
    if (this.transcript.length > TERMINAL_TRANSCRIPT_LIMIT) {
      this.transcript = this.transcript.slice(this.transcript.length - TERMINAL_TRANSCRIPT_LIMIT);
    }
  }

  /** Visible text: scroll-back plus the current line. */
  text(): string {
    return [...this.lines, this.current].join('\n');
  }

  getState(): TerminalState {
    return {
      lines: [...this.lines],
      current: this.current,
      col: this.col,
      bytesWritten: this.bytesWritten,
      transcript: this.transcript,
    };
  }

  setState(s: TerminalState): void {
    this.lines = [...s.lines];
    this.current = s.current;
    this.col = s.col;
    this.bytesWritten = s.bytesWritten;
    this.transcript = s.transcript;
  }
}
