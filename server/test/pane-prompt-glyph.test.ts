/**
 * ARCH-24: the prompt glyph is read by ONE export, `startsWithPromptGlyph` (src/pane/dialog.ts).
 * `inject/send.ts` used to test it with a literal `startsWith('❯')` at several sites, so a change
 * of the glyph meant finding every spelling.
 *
 * TWO DIRECT SITES since Desktop polish wave 185 (task note
 * docs/superpowers/programs/desktop-polish/tall-draft-submit.md): `boxMarkerIndex` is the one answer to "which row is
 * the box's marker row", and `draftOfMeasured`, `boxRows` and `continuationRows` ask it rather than scan for the glyph
 * each on its own (four sites before). `stashHeld` keeps its own scan (it needs a plain rule directly above the marker
 * row), so it still calls the export itself. A third direct site, or one of the three finding the marker row its own
 * way, goes red here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
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

const SENDER = 'server/src/inject/send.ts';

describe('inject/send.ts', () => {
  it('reads the prompt glyph through the pane export at exactly two direct sites: the marker-row helper and the stash reader', () => {
    const parsed = parsedFile(SENDER);
    const sites = parsed.calls.filter((c) => c.name === 'startsWithPromptGlyph').map((c) => {
      const within = parsed.symbols.filter((s) => s.start <= c.start && c.end <= s.end);
      return within.sort((a, b) => (a.end - a.start) - (b.end - b.start))[0]?.name ?? '(top level)';
    });
    expect(sites.sort()).toEqual(['boxMarkerIndex', 'stashHeld']);
  });
  it('finds the marker row through the helper in each of the three box readers, which never test the glyph themselves', () => {
    for (const name of ['draftOfMeasured', 'boxRows', 'continuationRows']) {
      const calls = callsIn(symbolOf(SENDER, name)).map((c) => c.name);
      expect(calls, name).toContain('boxMarkerIndex');
      expect(calls, name).not.toContain('startsWithPromptGlyph');
      expect(calls, name).not.toContain('startsWith');
    }
  });
  it('has no inline startsWith of the prompt glyph left (an added fifth site goes red)', () => {
    const inline = parsedFile(SENDER).calls.filter((c) => c.name === 'startsWith' && c.args[0]?.kind === 'string' && c.args[0].text.includes('❯'));
    expect(inline).toEqual([]);
  });
  it('carries the prompt glyph in no code at all, only in comments (any literal, regex or template slips nothing past)', () => {
    const src = readFileSync(path.resolve(__dirname, '../src/inject/send.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code.split('\n').filter((l) => l.includes('❯'))).toEqual([]);
  });
});
