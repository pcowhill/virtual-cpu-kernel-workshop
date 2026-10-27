import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/ui/markdown';
import { highlightLine } from '../../src/ui/highlight';
import { parseAddress, parseValue, flagsString, signed8 } from '../../src/ui/format';

describe('markdown renderer', () => {
  it('renders headings, lists, tables, code and inline formatting', () => {
    const html = renderMarkdown(
      '# Title\n\nSome **bold** and `code` and _it_.\n\n- a\n- b\n\n| x | y |\n| --- | --- |\n| 1 | a\\|b |\n\n```\nMOV R0, #1\n```',
    );
    expect(html).toContain('<h1 id="title">Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<em>it</em>');
    expect(html).toContain('<ul><li>a</li><li>b</li></ul>');
    expect(html).toContain('<td>a|b</td>');
    expect(html).toContain('<pre><code>MOV R0, #1</code></pre>');
  });

  it('escapes HTML and neutralises unsafe links', () => {
    const html = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1))');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('href="#"');
  });

  it('renders the bundled architecture specification', async () => {
    const { readFileSync } = await import('node:fs');
    const html = renderMarkdown(readFileSync('docs/spec/architecture.md', 'utf8'));
    expect(html).toContain('VC-8 Workshop Machine');
    expect((html.match(/<table>/g) ?? []).length).toBeGreaterThan(10);
  });
});

describe('syntax highlighting', () => {
  it('classifies tokens', () => {
    const h = highlightLine('loop:   ADD R0, #0x10 ; add "x"');
    expect(h).toContain('<span class="tok-label">loop</span>');
    expect(h).toContain('<span class="tok-mnemonic">ADD</span>');
    expect(h).toContain('<span class="tok-register">R0</span>');
    expect(h).toContain('<span class="tok-number">0x10</span>');
    expect(h).toContain(
      '<span class="tok-comment">; add &quot;x&quot;</span>'.replace('&quot;', '"').replace('&quot;', '"'),
    );
    expect(highlightLine('X = 5')).toContain('tok-constant');
    expect(highlightLine('        .org 0x100')).toContain('tok-directive');
    const esc = highlightLine('<b>');
    expect(esc).not.toContain('<b>');
    expect(esc.startsWith('&lt;')).toBe(true);
    expect(esc.endsWith('&gt;')).toBe(true);
  });
});

describe('format helpers', () => {
  it('parses addresses and symbols', () => {
    expect(parseAddress('0x2000')).toBe(0x2000);
    expect(parseAddress('$FF00')).toBe(0xff00);
    expect(parseAddress('100h')).toBe(0x100);
    // Bare numbers are hex, as the workbench displays them; decimal is explicit.
    expect(parseAddress('0100')).toBe(0x100);
    expect(parseAddress('2000')).toBe(0x2000);
    expect(parseAddress('#4096')).toBe(4096);
    expect(parseAddress('4096d')).toBe(4096);
    expect(parseAddress('#70000')).toBeNull();
    expect(parseAddress('12345')).toBeNull();
    expect(parseAddress('start', (n) => (n === 'start' ? 0x100 : undefined))).toBe(0x100);
    // Labels that look like hex numbers resolve as labels.
    expect(parseAddress('add2', (n) => (n === 'add2' ? 0x10f : undefined))).toBe(0x10f);
    expect(parseAddress('add2')).toBe(0xadd2);
    expect(parseAddress('nope')).toBeNull();
  });
  it('parses register values (decimal by default)', () => {
    expect(parseValue('42')).toBe(42);
    expect(parseValue('0x2A')).toBe(0x2a);
    expect(parseValue('$ff')).toBe(0xff);
    expect(parseValue('2Ah')).toBe(0x2a);
    expect(parseValue('0b101')).toBe(5);
    expect(parseValue('-2')).toBe(0xfffe);
    expect(parseValue('70000')).toBeNull();
    expect(parseValue('abc')).toBeNull();
  });
  it('formats flags and signed values', () => {
    expect(flagsString(0x80 | 0x40 | 0x03)).toBe('SI--ZC');
    expect(signed8(0xfe)).toBe(-2);
  });
});
