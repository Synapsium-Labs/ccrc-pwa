/**
 * ARCH-24: the prompt glyph is read by ONE export, `startsWithPromptGlyph` (src/pane/dialog.ts).
 * `inject/send.ts` used to test it with a literal `startsWith('❯')` at several sites, so a change
 * of the glyph meant finding every spelling.
 */
import { describe, it, expect } from 'vitest';
import { startsWithPromptGlyph } from '../src/pane/dialog.js';
import { callsIn, parsedFile, symbolOf } from './scan/symbols.js';

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
  it('reads the prompt glyph through the pane export at each of its four sites', () => {
    for (const name of ['draftOfMeasured', 'boxRows', 'stashHeld', 'continuationRows']) {
      expect(callsIn(symbolOf('server/src/inject/send.ts', name)).map((c) => c.name), name).toContain('startsWithPromptGlyph');
    }
  });
  it('has no inline startsWith of the prompt glyph left (an added fifth site goes red)', () => {
    const inline = parsedFile('server/src/inject/send.ts').calls.filter((c) => c.name === 'startsWith' && c.args[0]?.kind === 'string' && c.args[0].text.includes('❯'));
    expect(inline).toEqual([]);
  });
});
