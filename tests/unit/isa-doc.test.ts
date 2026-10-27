/**
 * The committed ISA reference must equal the document generated from the
 * machine-readable table. Run `npm run docs:isa` to regenerate.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateIsaReferenceMarkdown } from '../../src/core/isa/reference';

const path = resolve(__dirname, '../../docs/spec/isa-reference.md');

describe('generated ISA reference', () => {
  it('is up to date', () => {
    const generated = generateIsaReferenceMarkdown();
    if (process.env.UPDATE_DOCS) writeFileSync(path, generated);
    expect(readFileSync(path, 'utf8')).toBe(generated);
  });
});
