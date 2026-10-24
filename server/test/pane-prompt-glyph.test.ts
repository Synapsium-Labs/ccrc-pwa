/**
 * ARCH-24: the prompt glyph is read by ONE export, `startsWithPromptGlyph` (src/pane/dialog.ts).
 * `inject/send.ts` used to test it with a literal `startsWith('❯')` at several sites, so a change
 * of the glyph meant finding every spelling.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { startsWithPromptGlyph } from '../src/pane/dialog.js';

describe('startsWithPromptGlyph', () => {
  it('is true for a row that starts with the prompt glyph, bare or with text', () => {
    expect(startsWithPromptGlyph('❯')).toBe(true);
    expect(startsWithPromptGlyph('❯ ')).toBe(true);
    expect(startsWithPromptGlyph('❯ fix the test')).toBe(true);
  });
  it('is false for a row where the glyph is not first, and for an empty row', () => {
    expect(startsWithPromptGlyph('  ❯ 1. Yes')).toBe(false);
    expect(startsWithPromptGlyph('x ❯')).toBe(false);
    expect(startsWithPromptGlyph('')).toBe(false);
  });
});

describe('inject/send.ts', () => {
  it("spells the prompt glyph test through the pane export, with no inline startsWith('❯')", () => {
    const src = readFileSync(path.resolve(__dirname, '../src/inject/send.ts'), 'utf8');
    expect(src.match(/startsWith\('❯'\)/g) ?? []).toHaveLength(0);
    expect(src.match(/startsWithPromptGlyph\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});
