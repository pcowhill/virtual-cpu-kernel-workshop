/** Syntax highlighting for VC-8 assembly (produces escaped HTML). */
import { MNEMONIC_TABLE } from '../core/isa/opcodes';
import { CR_NAMES } from '../core/isa/constants';

const REGS = new Set(['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'P0', 'P1', 'P2', 'P3', 'SP', ...CR_NAMES]);

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function span(cls: string, text: string): string {
  return `<span class="tok-${cls}">${esc(text)}</span>`;
}

export function highlightLine(line: string): string {
  let out = '';
  let i = 0;
  let sawOp = false;
  while (i < line.length) {
    const rest = line.slice(i);
    const ch = line[i]!;
    if (ch === ';') {
      out += span('comment', rest);
      break;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
      out += span('string', line.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    let m = /^[A-Za-z_.@][A-Za-z0-9_.@]*/.exec(rest);
    if (m) {
      const w = m[0];
      const after = line.slice(i + w.length);
      if (!sawOp && /^\s*:/.test(after)) out += span('label', w);
      else if (!sawOp && w.startsWith('.')) {
        out += span('directive', w);
        sawOp = true;
      } else if (!sawOp && MNEMONIC_TABLE.has(w.toUpperCase())) {
        out += span('mnemonic', w);
        sawOp = true;
      } else if (REGS.has(w.toUpperCase())) out += span('register', w);
      else if (!sawOp && /^\s*(=|\.equ\b)/i.test(after)) out += span('constant', w);
      else out += span('symbol', w);
      i += w.length;
      continue;
    }
    m = /^(0x[0-9a-fA-F_]+|0b[01_]+|[0-9][0-9_]*)/.exec(rest);
    if (m) {
      out += span('number', m[0]);
      i += m[0].length;
      continue;
    }
    if (ch === '#') {
      out += span('hash', ch);
      i++;
      continue;
    }
    out += esc(ch);
    i++;
  }
  return out;
}
