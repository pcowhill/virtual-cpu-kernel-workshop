/**
 * Assembler expressions.
 *
 * Grammar (lowest to highest precedence):
 *   expr   := or
 *   or     := xor ('|' xor)*
 *   xor    := and ('^' and)*
 *   and    := shift ('&' shift)*
 *   shift  := sum (('<<' | '>>') sum)*
 *   sum    := prod (('+' | '-') prod)*
 *   prod   := unary (('*' | '/' | '%') unary)*
 *   unary  := ('-' | '~' | '+') unary | primary
 *   primary:= number | char | symbol | '$' | '(' expr ')' | ('lo' | 'hi') '(' expr ')'
 */

export type Expr =
  | { type: 'num'; value: number }
  | { type: 'sym'; name: string }
  | { type: 'here' }
  | { type: 'unary'; op: '-' | '~' | '+'; arg: Expr }
  | { type: 'binary'; op: string; left: Expr; right: Expr }
  | { type: 'func'; name: 'lo' | 'hi'; arg: Expr };

export class ExprError extends Error {}

const ESCAPES: Record<string, number> = {
  n: 10,
  r: 13,
  t: 9,
  '0': 0,
  '\\': 92,
  "'": 39,
  '"': 34,
  a: 7,
  b: 8,
  e: 27,
};

/** Decode one possibly escaped character from `s` at `i`. Returns [code, nextIndex]. */
export function decodeChar(s: string, i: number): [number, number] {
  const ch = s[i];
  if (ch === undefined) throw new ExprError('unterminated character');
  if (ch !== '\\') return [ch.charCodeAt(0), i + 1];
  const e = s[i + 1];
  if (e === undefined) throw new ExprError('unterminated escape sequence');
  if (e === 'x') {
    const hex = s.slice(i + 2, i + 4);
    if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new ExprError('\\x escape needs two hex digits');
    return [parseInt(hex, 16), i + 4];
  }
  const code = ESCAPES[e];
  if (code === undefined) throw new ExprError(`unknown escape sequence \\${e}`);
  return [code, i + 2];
}

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const m = /^(0x[0-9a-fA-F_]+|0b[01_]+|[0-9][0-9_]*)/.exec(src.slice(i))!;
      const text = m[0].replace(/_/g, '');
      if (/[a-zA-Z]/.test(src[i + m[0].length] ?? '')) {
        throw new ExprError(`malformed number '${src.slice(i).split(/[^0-9a-zA-Z_]/)[0]}'`);
      }
      const v = text.startsWith('0x')
        ? parseInt(text.slice(2), 16)
        : text.startsWith('0b')
          ? parseInt(text.slice(2), 2)
          : parseInt(text, 10);
      out.push({ t: 'num', v });
      i += m[0].length;
      continue;
    }
    if (ch === "'") {
      const [code, next] = decodeChar(src, i + 1);
      if (src[next] !== "'") throw new ExprError('character literal must contain exactly one character');
      out.push({ t: 'num', v: code });
      i = next + 1;
      continue;
    }
    if (/[A-Za-z_.@]/.test(ch)) {
      const m = /^[A-Za-z_.@][A-Za-z0-9_.@]*/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    if (src.startsWith('<<', i) || src.startsWith('>>', i)) {
      out.push({ t: 'op', v: src.slice(i, i + 2) });
      i += 2;
      continue;
    }
    if ('+-*/%&|^~()$'.includes(ch)) {
      out.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    throw new ExprError(`unexpected character '${ch}' in expression`);
  }
  return out;
}

export function parseExpr(src: string): Expr {
  const toks = tokenize(src);
  let p = 0;
  const peek = (): Tok | undefined => toks[p];
  const isOp = (v: string): boolean => {
    const t = toks[p];
    return t !== undefined && t.t === 'op' && t.v === v;
  };
  const expectOp = (v: string): void => {
    if (!isOp(v)) throw new ExprError(`expected '${v}'`);
    p++;
  };

  const binaryLevel = (ops: string[], next: () => Expr) => (): Expr => {
    let left = next();
    for (;;) {
      const t = peek();
      if (t && t.t === 'op' && ops.includes(t.v)) {
        p++;
        left = { type: 'binary', op: t.v, left, right: next() };
      } else return left;
    }
  };

  const primary = (): Expr => {
    const t = toks[p++];
    if (!t) throw new ExprError('expression ended unexpectedly');
    if (t.t === 'num') return { type: 'num', value: t.v };
    if (t.t === 'id') {
      const lower = t.v.toLowerCase();
      if ((lower === 'lo' || lower === 'hi') && isOp('(')) {
        p++;
        const arg = expr();
        expectOp(')');
        return { type: 'func', name: lower, arg };
      }
      return { type: 'sym', name: t.v };
    }
    if (t.v === '$') return { type: 'here' };
    if (t.v === '(') {
      const e = expr();
      expectOp(')');
      return e;
    }
    throw new ExprError(`unexpected '${t.v}'`);
  };
  const unary = (): Expr => {
    const t = peek();
    if (t && t.t === 'op' && (t.v === '-' || t.v === '~' || t.v === '+')) {
      p++;
      return { type: 'unary', op: t.v, arg: unary() };
    }
    return primary();
  };
  const prod = binaryLevel(['*', '/', '%'], unary);
  const sum = binaryLevel(['+', '-'], prod);
  const shift = binaryLevel(['<<', '>>'], sum);
  const and = binaryLevel(['&'], shift);
  const xor = binaryLevel(['^'], and);
  const or = binaryLevel(['|'], xor);
  const expr = or;

  if (toks.length === 0) throw new ExprError('missing expression');
  const e = expr();
  if (p < toks.length) {
    const t = toks[p]!;
    throw new ExprError(`unexpected '${t.t === 'num' ? String(t.v) : t.v}' after expression`);
  }
  return e;
}

export interface EvalContext {
  /** Look up a symbol's value; return undefined if not (yet) defined. */
  lookup(name: string): number | undefined;
  here: number;
}

/** Evaluate; returns undefined if a symbol is unresolved. Throws ExprError for invalid operations. */
export function evaluate(e: Expr, ctx: EvalContext, unresolved?: string[]): number | undefined {
  switch (e.type) {
    case 'num':
      return e.value;
    case 'here':
      return ctx.here;
    case 'sym': {
      const v = ctx.lookup(e.name);
      if (v === undefined) unresolved?.push(e.name);
      return v;
    }
    case 'unary': {
      const v = evaluate(e.arg, ctx, unresolved);
      if (v === undefined) return undefined;
      return e.op === '-' ? -v : e.op === '~' ? ~v : v;
    }
    case 'func': {
      const v = evaluate(e.arg, ctx, unresolved);
      if (v === undefined) return undefined;
      return e.name === 'lo' ? v & 0xff : (v >> 8) & 0xff;
    }
    case 'binary': {
      const l = evaluate(e.left, ctx, unresolved);
      const r = evaluate(e.right, ctx, unresolved);
      if (l === undefined || r === undefined) return undefined;
      switch (e.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          if (r === 0) throw new ExprError('division by zero');
          return Math.trunc(l / r);
        case '%':
          if (r === 0) throw new ExprError('division by zero');
          return l % r;
        case '&':
          return l & r;
        case '|':
          return l | r;
        case '^':
          return l ^ r;
        case '<<':
          return l << r;
        case '>>':
          return l >> r;
        default:
          throw new ExprError(`unknown operator ${e.op}`);
      }
    }
  }
}

/** Collect symbol names referenced by an expression. */
export function symbolsIn(e: Expr, out: string[] = []): string[] {
  switch (e.type) {
    case 'sym':
      out.push(e.name);
      break;
    case 'unary':
    case 'func':
      symbolsIn(e.arg, out);
      break;
    case 'binary':
      symbolsIn(e.left, out);
      symbolsIn(e.right, out);
      break;
    default:
      break;
  }
  return out;
}

/** Rewrite local symbol references (".name") into scoped names. */
export function scopeExpr(e: Expr, scope: string): Expr {
  switch (e.type) {
    case 'sym':
      return e.name.startsWith('.') ? { type: 'sym', name: scope + e.name } : e;
    case 'unary':
      return { ...e, arg: scopeExpr(e.arg, scope) };
    case 'func':
      return { ...e, arg: scopeExpr(e.arg, scope) };
    case 'binary':
      return { ...e, left: scopeExpr(e.left, scope), right: scopeExpr(e.right, scope) };
    default:
      return e;
  }
}
