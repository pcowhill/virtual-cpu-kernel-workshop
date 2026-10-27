/**
 * Two-pass VC-8 assembler.
 *
 * Pass 1 expands includes, assigns addresses to labels and sizes every statement
 * (instruction sizes depend only on operand *syntax*, never on symbol values).
 * Pass 2 evaluates expressions, range-checks and encodes using the shared
 * instruction table, and records a source map and listing.
 */
import { CR_NAMES } from '../isa/constants';
import { MNEMONIC_TABLE, type InstructionDef, type OperandSyntax } from '../isa/opcodes';
import type { MemorySegment } from '../machine/machine';
import { ExprError, decodeChar, evaluate, parseExpr, scopeExpr, type Expr } from './expr';

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  severity: Severity;
  message: string;
  file: string;
  line: number;
  /** 1-based column, 0 if unknown. */
  column: number;
}

export interface SymbolInfo {
  name: string;
  value: number;
  kind: 'label' | 'constant' | 'predefined';
  file: string;
  line: number;
}

export interface SourceMapEntry {
  address: number;
  size: number;
  file: string;
  line: number;
  kind: 'instruction' | 'data';
}

export interface ListingLine {
  file: string;
  line: number;
  address: number | null;
  bytes: number[];
  source: string;
}

export interface AssemblyResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  segments: MemorySegment[];
  symbols: SymbolInfo[];
  sourceMap: SourceMapEntry[];
  listing: ListingLine[];
  /** Total bytes emitted. */
  size: number;
}

export interface AddressRegion {
  start: number;
  end: number;
  name: string;
}

export interface AssembleOptions {
  /** Name of the main file (for diagnostics and source maps). */
  fileName?: string;
  /** Files available to `.include`, keyed by path. */
  files?: Record<string, string>;
  /** Symbols defined before assembly (e.g. PROC_BASE for user programs). */
  predefined?: Record<string, number>;
  /** If given, every emitted byte must fall inside one of these regions. */
  regions?: AddressRegion[];
}

type Operand =
  | { k: 'reg'; n: number }
  | { k: 'wide'; n: number }
  | { k: 'cr'; n: number }
  | { k: 'imm'; e: Expr }
  | { k: 'abs'; e: Expr }
  | { k: 'mem'; base: number; e: Expr | null }
  | { k: 'expr'; e: Expr };

interface Stmt {
  file: string;
  line: number;
  source: string;
  labels: { name: string; column: number }[];
  /** Upper-case mnemonic or lower-case directive (with leading dot). */
  op: string | null;
  opColumn: number;
  operands: { text: string; column: number }[];
  /** NAME = expr / NAME .equ expr */
  equ: { name: string; expr: string; column: number } | null;
  // filled by pass 1
  address: number;
  size: number;
  def: InstructionDef | null;
  parsed: Operand[];
  scope: string;
  failed: boolean;
}

const RESERVED = new Set([
  ...['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'P0', 'P1', 'P2', 'P3', 'SP'],
  ...CR_NAMES,
]);

const DIRECTIVES = new Set([
  '.org',
  '.byte',
  '.db',
  '.word',
  '.dw',
  '.ascii',
  '.asciz',
  '.string',
  '.space',
  '.fill',
  '.align',
  '.equ',
  '.include',
]);

class AsmError extends Error {
  constructor(
    message: string,
    public column = 0,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Line parsing
// ---------------------------------------------------------------------------

/** Remove a ';' comment, respecting string and character literals. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ';') return line.slice(0, i);
  }
  return line;
}

/** Split operands at top-level commas. */
function splitOperands(text: string, baseColumn: number): { text: string; column: number }[] {
  const out: { text: string; column: number }[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  const push = (end: number) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    out.push({ text: raw.trim(), column: baseColumn + start + lead });
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(text.length);
  if (out.length === 1 && out[0]!.text === '') return [];
  return out;
}

const IDENT = /^[A-Za-z_.@][A-Za-z0-9_.@]*/;

function parseLine(file: string, lineNo: number, source: string): Stmt {
  const stmt: Stmt = {
    file,
    line: lineNo,
    source,
    labels: [],
    op: null,
    opColumn: 0,
    operands: [],
    equ: null,
    address: 0,
    size: 0,
    def: null,
    parsed: [],
    scope: '',
    failed: false,
  };
  const code = stripComment(source);
  let pos = 0;
  const skipWs = () => {
    while (pos < code.length && /\s/.test(code[pos]!)) pos++;
  };
  skipWs();
  // labels
  for (;;) {
    const m = IDENT.exec(code.slice(pos));
    if (!m) break;
    let after = pos + m[0].length;
    while (after < code.length && /[ \t]/.test(code[after]!)) after++;
    if (code[after] === ':') {
      stmt.labels.push({ name: m[0], column: pos + 1 });
      pos = after + 1;
      skipWs();
      continue;
    }
    break;
  }
  if (pos >= code.length) return stmt;
  const m = IDENT.exec(code.slice(pos));
  if (!m) throw new AsmError(`unexpected '${code[pos]}'`, pos + 1);
  const word = m[0];
  const wordCol = pos + 1;
  pos += word.length;
  const rest = code.slice(pos);
  // NAME = expr   |   NAME .equ expr
  const equMatch = /^\s*(=|\.equ\b)\s*(.*)$/i.exec(rest);
  if (equMatch && !word.startsWith('.')) {
    stmt.equ = { name: word, expr: equMatch[2]!.trim(), column: wordCol };
    return stmt;
  }
  stmt.op = word.startsWith('.') ? word.toLowerCase() : word.toUpperCase();
  stmt.opColumn = wordCol;
  stmt.operands = splitOperands(rest, pos + 1);
  if (stmt.op === '.equ') {
    // .equ NAME, expr
    if (stmt.operands.length !== 2) throw new AsmError('.equ needs a name and a value: .equ NAME, expr', wordCol);
    const name = stmt.operands[0]!.text;
    if (!/^[A-Za-z_@][A-Za-z0-9_.@]*$/.test(name)) throw new AsmError(`invalid constant name '${name}'`, wordCol);
    stmt.equ = { name, expr: stmt.operands[1]!.text, column: stmt.operands[0]!.column };
    stmt.op = null;
    stmt.operands = [];
  }
  return stmt;
}

function parseStringLiteral(text: string): number[] {
  if (!text.startsWith('"') || !text.endsWith('"') || text.length < 2) throw new AsmError('expected a "string"');
  const body = text.slice(1, -1);
  const out: number[] = [];
  let i = 0;
  while (i < body.length) {
    if (body[i] === '"') throw new AsmError('unescaped quote inside string');
    const [code, next] = decodeChar(body, i);
    out.push(code);
    i = next;
  }
  return out;
}

function parseOperand(text: string): Operand {
  const t = text.trim();
  if (t === '') throw new AsmError('missing operand');
  const up = t.toUpperCase();
  let m = /^R(\d+)$/.exec(up);
  if (m) {
    const n = Number(m[1]);
    if (n > 7) throw new AsmError(`there is no register ${t}; registers are R0–R7`);
    return { k: 'reg', n };
  }
  m = /^P(\d+)$/.exec(up);
  if (m) {
    const n = Number(m[1]);
    if (n > 3) throw new AsmError(`there is no register pair ${t}; pairs are P0–P3`);
    return { k: 'wide', n };
  }
  if (up === 'SP') return { k: 'wide', n: 4 };
  const crIdx = CR_NAMES.indexOf(up as (typeof CR_NAMES)[number]);
  if (crIdx >= 0) return { k: 'cr', n: crIdx };
  if (t.startsWith('#')) return { k: 'imm', e: parseExpr(t.slice(1)) };
  if (t.startsWith('[')) {
    if (!t.endsWith(']')) throw new AsmError("missing ']'");
    const inner = t.slice(1, -1).trim();
    const bm = /^(P[0-3]|SP)\b\s*(.*)$/i.exec(inner);
    if (bm) {
      const baseName = bm[1]!.toUpperCase();
      const base = baseName === 'SP' ? 4 : Number(baseName[1]);
      const tail = bm[2]!.trim();
      if (tail === '') return { k: 'mem', base, e: null };
      if (tail.startsWith('+')) return { k: 'mem', base, e: parseExpr(tail.slice(1)) };
      if (tail.startsWith('-'))
        throw new AsmError('negative offsets are not supported: [W+offset] takes an unsigned offset 0–255');
      throw new AsmError(`expected '+' after base register in '${t}'`);
    }
    if (/^R[0-7]$/i.test(inner))
      throw new AsmError(`'${t}': 8-bit registers cannot hold addresses; use a pair (P0–P3)`);
    return { k: 'abs', e: parseExpr(inner) };
  }
  return { k: 'expr', e: parseExpr(t) };
}

function operandMatches(syntax: OperandSyntax, op: Operand): boolean {
  switch (syntax.kind) {
    case 'reg':
      return op.k === 'reg';
    case 'wide':
      return op.k === 'wide';
    case 'cr':
      return op.k === 'cr';
    case 'imm8':
    case 'imm16':
      return op.k === 'imm';
    case 'abs':
      return op.k === 'abs';
    case 'mem':
      return op.k === 'mem';
    case 'addr':
      return op.k === 'expr';
  }
}

export function syntaxSummary(d: InstructionDef): string {
  const parts = d.operands.map((o) => {
    switch (o.kind) {
      case 'reg':
        return 'Rn';
      case 'wide':
        return 'Pn|SP';
      case 'cr':
        return 'CR';
      case 'imm8':
        return '#imm8';
      case 'imm16':
        return '#imm16';
      case 'abs':
        return '[addr]';
      case 'mem':
        return '[Pn|SP+off]';
      case 'addr':
        return 'addr';
    }
  });
  return `${d.mnemonic}${parts.length ? ' ' + parts.join(', ') : ''}`;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[a.length]![b.length]!;
}

function suggestMnemonic(word: string): string {
  let best = '';
  let bestD = 3;
  for (const name of MNEMONIC_TABLE.keys()) {
    const d = levenshtein(word, name);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best ? ` Did you mean '${best}'?` : '';
}

function hex(v: number, w = 4): string {
  return '0x' + (v >>> 0).toString(16).toUpperCase().padStart(w, '0');
}

// ---------------------------------------------------------------------------
// Assembler
// ---------------------------------------------------------------------------

interface SymEntry {
  name: string;
  kind: 'label' | 'constant' | 'predefined';
  value: number | undefined;
  expr: Expr | null;
  here: number;
  file: string;
  line: number;
  resolving: boolean;
}

export function assemble(source: string, options: AssembleOptions = {}): AssemblyResult {
  const mainFile = options.fileName ?? 'main.asm';
  const diagnostics: Diagnostic[] = [];
  const err = (file: string, line: number, message: string, column = 0, severity: Severity = 'error') =>
    diagnostics.push({ severity, message, file, line, column });

  // ---- expand includes and parse ----
  const stmts: Stmt[] = [];
  const includeStack: string[] = [];
  const load = (file: string, text: string) => {
    if (includeStack.includes(file)) {
      err(includeStack.at(-1) ?? file, 0, `recursive .include of '${file}'`);
      return;
    }
    if (includeStack.length > 16) {
      err(file, 0, '.include nesting is too deep');
      return;
    }
    includeStack.push(file);
    const lines = text.split(/\r?\n/);
    lines.forEach((src, i) => {
      let st: Stmt;
      try {
        st = parseLine(file, i + 1, src);
      } catch (e) {
        if (e instanceof AsmError || e instanceof ExprError) {
          err(file, i + 1, e.message, e instanceof AsmError ? e.column : 0);
          return;
        }
        throw e;
      }
      if (st.op === '.include') {
        const arg = st.operands[0]?.text ?? '';
        let path: string;
        try {
          path = String.fromCharCode(...parseStringLiteral(arg));
        } catch {
          err(file, i + 1, '.include needs a quoted file name', st.opColumn);
          return;
        }
        const body = options.files?.[path];
        if (body === undefined) {
          err(file, i + 1, `cannot find include file '${path}'`, st.opColumn);
          return;
        }
        if (st.labels.length) stmts.push({ ...st, op: null, operands: [] });
        load(path, body);
        return;
      }
      stmts.push(st);
    });
    includeStack.pop();
  };
  load(mainFile, source);

  // ---- symbol table ----
  const symbols = new Map<string, SymEntry>();
  for (const [name, value] of Object.entries(options.predefined ?? {})) {
    symbols.set(name, {
      name,
      kind: 'predefined',
      value,
      expr: null,
      here: 0,
      file: '(predefined)',
      line: 0,
      resolving: false,
    });
  }

  const lookupFactory =
    (strict: boolean) =>
    (name: string): number | undefined => {
      const s = symbols.get(name);
      if (!s) return undefined;
      if (s.value !== undefined) return s.value;
      if (!s.expr || !strict) {
        if (!s.expr) return undefined;
      }
      if (s.resolving) throw new ExprError(`circular definition involving '${name}'`);
      s.resolving = true;
      try {
        const v = evaluate(s.expr!, { lookup: lookupFactory(strict), here: s.here });
        if (v !== undefined) s.value = v;
        return v;
      } finally {
        s.resolving = false;
      }
    };
  const lookup = lookupFactory(true);

  const define = (
    st: Stmt,
    name: string,
    kind: 'label' | 'constant',
    value: number | undefined,
    expr: Expr | null,
    column: number,
  ) => {
    if (RESERVED.has(name.toUpperCase()) || /^[RP]\d+$/i.test(name)) {
      err(st.file, st.line, `'${name}' is a reserved register name and cannot be used as a symbol`, column);
      return;
    }
    const prev = symbols.get(name);
    if (prev) {
      err(
        st.file,
        st.line,
        prev.kind === 'predefined'
          ? `'${name}' is predefined by the build configuration and cannot be redefined`
          : `duplicate symbol '${name}' (first defined at ${prev.file}:${prev.line})`,
        column,
      );
      return;
    }
    symbols.set(name, { name, kind, value, expr, here: st.address, file: st.file, line: st.line, resolving: false });
  };

  const evalNow = (st: Stmt, text: string, what: string): number => {
    const e = scopeExpr(parseExpr(text), st.scope);
    const unresolved: string[] = [];
    const v = evaluate(e, { lookup, here: st.address }, unresolved);
    if (v === undefined) {
      throw new AsmError(
        `${what} must be computable when it is reached; '${unresolved[0]}' is not defined yet (define constants before use)`,
      );
    }
    return v;
  };

  // ---- pass 1 ----
  let pc = 0;
  let scope = '';
  for (const st of stmts) {
    st.address = pc;
    try {
      // Labels on a .org or .align line name the address *after* the directive.
      if (st.op === '.org' || st.op === '.align') {
        const target = sizeDirective(st, (text, what) => evalNow(st, text, what));
        pc = st.op === '.org' ? target : alignUp(pc, evalNow(st, st.operands[0]!.text, '.align boundary'));
        st.address = pc;
      }
      for (const l of st.labels) {
        let name = l.name;
        if (name.startsWith('.')) {
          if (!scope) throw new AsmError(`local label '${name}' needs a preceding global label`, l.column);
          name = scope + name;
        } else scope = name;
        define(st, name, 'label', pc, null, l.column);
      }
      st.scope = scope;
      if (st.equ) {
        const e = scopeExpr(parseExpr(st.equ.expr), scope);
        define(st, st.equ.name, 'constant', undefined, e, st.equ.column);
        continue;
      }
      if (!st.op) continue;
      if (st.op === '.org' || st.op === '.align') {
        st.size = 0;
      } else if (st.op.startsWith('.')) {
        st.size = sizeDirective(st, (text, what) => evalNow(st, text, what));
      } else {
        const candidates = MNEMONIC_TABLE.get(st.op);
        if (!candidates) throw new AsmError(`unknown instruction '${st.op}'.${suggestMnemonic(st.op)}`, st.opColumn);
        st.parsed = st.operands.map((o) => {
          try {
            return parseOperand(o.text);
          } catch (e) {
            if (e instanceof AsmError || e instanceof ExprError)
              throw new AsmError(`operand '${o.text}': ${e.message}`, o.column);
            throw e;
          }
        });
        const def = candidates.find(
          (d) => d.operands.length === st.parsed.length && d.operands.every((s, i) => operandMatches(s, st.parsed[i]!)),
        );
        if (!def) {
          const forms = [...new Set(candidates.map(syntaxSummary))].join('  |  ');
          throw new AsmError(
            `invalid operands for ${st.op}; expected: ${forms}`,
            st.operands[0]?.column ?? st.opColumn,
          );
        }
        st.def = def;
        st.size = def.length;
      }
    } catch (e) {
      if (e instanceof AsmError || e instanceof ExprError) {
        err(st.file, st.line, e.message, e instanceof AsmError ? e.column || st.opColumn : st.opColumn);
        st.failed = true;
        st.size = 0;
      } else throw e;
    }
    pc += st.size;
    if (pc > 0x10000) {
      err(st.file, st.line, `code runs past the end of the address space (${hex(pc - 1, 5)})`);
      pc &= 0xffff;
    }
  }

  // ---- pass 2 ----
  const emitted = new Map<number, Stmt>();
  const bytesAt = new Map<number, number>();
  const sourceMap: SourceMapEntry[] = [];
  const listing: ListingLine[] = [];

  const value = (st: Stmt, e: Expr, column: number): number => {
    const unresolved: string[] = [];
    const v = evaluate(e, { lookup, here: st.address }, unresolved);
    if (v === undefined) {
      const name = unresolved[0]!;
      throw new AsmError(
        `undefined symbol '${name.includes('.') && st.scope && name.startsWith(st.scope + '.') ? name.slice(st.scope.length) : name}'`,
        column,
      );
    }
    return v;
  };

  const checkRange = (v: number, min: number, max: number, what: string, column: number): number => {
    if (v < min || v > max)
      throw new AsmError(`${what} ${v} (${hex(v >>> 0, 2)}) is out of range (${min}…${max})`, column);
    return v;
  };

  for (const st of stmts) {
    const out: number[] = [];
    try {
      if (st.failed) {
        listing.push({ file: st.file, line: st.line, address: null, bytes: [], source: st.source });
        continue;
      }
      if (st.equ) {
        const v = lookup(st.equ.name);
        if (v === undefined) {
          const s = symbols.get(st.equ.name);
          if (s?.kind === 'constant' && s.expr) {
            const unresolved: string[] = [];
            evaluate(s.expr, { lookup, here: s.here }, unresolved);
            throw new AsmError(`undefined symbol '${unresolved[0]}' in constant '${st.equ.name}'`, st.equ.column);
          }
        }
      } else if (st.op && st.op.startsWith('.')) {
        emitDirective(st, out, (e, col) => value(st, e, col), checkRange);
      } else if (st.def) {
        encodeInstruction(st, out, (e, col) => value(st, e, col), checkRange);
      }
    } catch (e) {
      if (e instanceof AsmError || e instanceof ExprError) {
        err(st.file, st.line, e.message, e instanceof AsmError ? e.column || st.opColumn : st.opColumn);
        out.length = 0;
      } else throw e;
    }
    // place bytes
    let conflict = false;
    for (let i = 0; i < out.length; i++) {
      const addr = st.address + i;
      const prev = emitted.get(addr);
      if (prev && !conflict) {
        err(
          st.file,
          st.line,
          `memory-layout conflict: address ${hex(addr)} is already used by ${prev.file}:${prev.line}`,
          st.opColumn,
        );
        conflict = true;
      }
      if (addr >= 0xf000 && !conflict) {
        err(st.file, st.line, `cannot place bytes at ${hex(addr)}: 0xF000–0xFFFF is device (MMIO) space`, st.opColumn);
        conflict = true;
      }
      if (options.regions && !conflict && !options.regions.some((r) => addr >= r.start && addr <= r.end)) {
        const allowed = options.regions.map((r) => `${r.name} (${hex(r.start)}–${hex(r.end)})`).join(', ');
        err(
          st.file,
          st.line,
          `address ${hex(addr)} is outside the region allowed for this build: ${allowed}`,
          st.opColumn,
        );
        conflict = true;
      }
      emitted.set(addr, st);
      bytesAt.set(addr, out[i]!);
    }
    if (out.length) {
      sourceMap.push({
        address: st.address,
        size: out.length,
        file: st.file,
        line: st.line,
        kind: st.def ? 'instruction' : 'data',
      });
    }
    listing.push({
      file: st.file,
      line: st.line,
      address: out.length || st.labels.length || st.op ? st.address : null,
      bytes: out,
      source: st.source,
    });
  }

  // ---- segments ----
  const addrs = [...bytesAt.keys()].sort((a, b) => a - b);
  const segments: MemorySegment[] = [];
  let i = 0;
  while (i < addrs.length) {
    const start = addrs[i]!;
    let end = start;
    while (i + 1 < addrs.length && addrs[i + 1] === end + 1) {
      i++;
      end++;
    }
    const bytes = new Uint8Array(end - start + 1);
    for (let a = start; a <= end; a++) bytes[a - start] = bytesAt.get(a)!;
    segments.push({ address: start, bytes });
    i++;
  }

  const symbolList: SymbolInfo[] = [];
  for (const s of symbols.values()) {
    let v = s.value;
    if (v === undefined && s.expr) {
      try {
        v = lookup(s.name);
      } catch {
        v = undefined;
      }
    }
    if (v !== undefined) symbolList.push({ name: s.name, value: v, kind: s.kind, file: s.file, line: s.line });
  }
  symbolList.sort((a, b) => a.value - b.value || a.name.localeCompare(b.name));

  diagnostics.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return {
    ok: !diagnostics.some((d) => d.severity === 'error'),
    diagnostics,
    segments,
    symbols: symbolList,
    sourceMap,
    listing,
    size: bytesAt.size,
  };
}

// ---------------------------------------------------------------------------
// Directives
// ---------------------------------------------------------------------------

function alignUp(pc: number, n: number): number {
  return Math.ceil(pc / n) * n;
}

function sizeDirective(st: Stmt, evalNow: (text: string, what: string) => number): number {
  const ops = st.operands;
  switch (st.op) {
    case '.org': {
      if (ops.length !== 1) throw new AsmError('.org needs exactly one address', st.opColumn);
      const v = evalNow(ops[0]!.text, '.org address');
      if (v < 0 || v > 0xffff) throw new AsmError(`.org address ${v} is outside 0x0000–0xFFFF`, ops[0]!.column);
      return v;
    }
    case '.byte':
    case '.db':
      if (!ops.length) throw new AsmError(`${st.op} needs at least one value`, st.opColumn);
      return ops.reduce((n, o) => n + (o.text.startsWith('"') ? parseStringLiteral(o.text).length : 1), 0);
    case '.word':
    case '.dw':
      if (!ops.length) throw new AsmError(`${st.op} needs at least one value`, st.opColumn);
      return ops.length * 2;
    case '.ascii':
    case '.asciz':
    case '.string': {
      if (!ops.length) throw new AsmError(`${st.op} needs a string`, st.opColumn);
      const n = ops.reduce((acc, o) => acc + parseStringLiteral(o.text).length, 0);
      return st.op === '.ascii' ? n : n + 1;
    }
    case '.space':
    case '.fill': {
      if (ops.length < 1 || ops.length > 2)
        throw new AsmError(`${st.op} needs a count and an optional fill value`, st.opColumn);
      const n = evalNow(ops[0]!.text, `${st.op} count`);
      if (n < 0 || n > 0x10000) throw new AsmError(`${st.op} count ${n} is out of range`, ops[0]!.column);
      return n;
    }
    case '.align': {
      if (ops.length !== 1) throw new AsmError('.align needs one boundary value', st.opColumn);
      const n = evalNow(ops[0]!.text, '.align boundary');
      if (n <= 0 || n > 0x8000) throw new AsmError(`.align boundary ${n} is out of range`, ops[0]!.column);
      return 0;
    }
    default:
      if (DIRECTIVES.has(st.op!)) return 0;
      throw new AsmError(
        `unknown directive '${st.op}'. Supported: .org .byte .word .ascii .asciz .space .fill .align .equ .include`,
        st.opColumn,
      );
  }
}

type ValueFn = (e: Expr, column: number) => number;
type RangeFn = (v: number, min: number, max: number, what: string, column: number) => number;

function emitDirective(st: Stmt, out: number[], value: ValueFn, range: RangeFn): void {
  const ops = st.operands;
  const expr = (o: { text: string; column: number }): number => {
    try {
      return value(scopeExpr(parseExpr(o.text), st.scope), o.column);
    } catch (e) {
      if (e instanceof ExprError) throw new AsmError(e.message, o.column);
      throw e;
    }
  };
  switch (st.op) {
    case '.byte':
    case '.db':
      for (const o of ops) {
        if (o.text.startsWith('"')) out.push(...parseStringLiteral(o.text));
        else out.push(range(expr(o), -128, 255, 'byte value', o.column) & 0xff);
      }
      break;
    case '.word':
    case '.dw':
      for (const o of ops) {
        const v = range(expr(o), -32768, 65535, 'word value', o.column) & 0xffff;
        out.push(v & 0xff, v >> 8);
      }
      break;
    case '.ascii':
    case '.asciz':
    case '.string':
      for (const o of ops) out.push(...parseStringLiteral(o.text));
      if (st.op !== '.ascii') out.push(0);
      break;
    case '.space':
    case '.fill': {
      const fill = ops[1] ? range(expr(ops[1]), -128, 255, 'fill value', ops[1].column) & 0xff : 0;
      for (let i = 0; i < st.size; i++) out.push(fill);
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Instruction encoding
// ---------------------------------------------------------------------------

function encodeInstruction(st: Stmt, out: number[], value: ValueFn, range: RangeFn): void {
  const d = st.def!;
  let fieldA = 0;
  let fieldB = 0;
  let imm: number | null = null;
  d.operands.forEach((syntax, i) => {
    const op = st.parsed[i]!;
    const col = st.operands[i]!.column;
    const v = (e: Expr) => value(scopeExpr(e, st.scope), col);
    switch (syntax.kind) {
      case 'reg':
      case 'wide':
      case 'cr': {
        const n = (op as { n: number }).n;
        if (syntax.field === 'a') fieldA = n;
        else fieldB = n;
        break;
      }
      case 'imm8':
        imm = range(v((op as { e: Expr }).e), -128, 255, 'immediate value', col) & 0xff;
        break;
      case 'imm16':
        imm = range(v((op as { e: Expr }).e), -32768, 65535, '16-bit immediate', col) & 0xffff;
        break;
      case 'abs':
        imm = range(v((op as { e: Expr }).e), 0, 65535, 'address', col);
        break;
      case 'addr':
        imm = range(v((op as { e: Expr }).e), 0, 65535, 'jump target', col);
        break;
      case 'mem': {
        const m = op as { base: number; e: Expr | null };
        fieldB = m.base;
        imm = m.e ? range(v(m.e), 0, 255, 'offset', col) : 0;
        break;
      }
    }
  });
  out.push(d.opcode);
  if (d.fieldA !== null || d.fieldB !== null) out.push((fieldA << 4) | fieldB);
  if (d.imm === 'i8') out.push(imm ?? 0);
  else if (d.imm === 'i16') {
    const v = imm ?? 0;
    out.push(v & 0xff, v >> 8);
  }
}

/** Find the source location for an address using a source map. */
export function sourceForAddress(map: readonly SourceMapEntry[], addr: number): SourceMapEntry | undefined {
  for (const e of map) if (addr >= e.address && addr < e.address + e.size) return e;
  return undefined;
}

/** Flatten segments into a 64 KiB image (0 where nothing was emitted). */
export function toImage(segments: readonly MemorySegment[]): Uint8Array {
  const img = new Uint8Array(0x10000);
  for (const s of segments) img.set(s.bytes, s.address);
  return img;
}
