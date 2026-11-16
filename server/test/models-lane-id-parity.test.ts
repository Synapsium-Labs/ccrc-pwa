// The lane-id pattern `ccrc models` accepts, and the two words it reads as
// subcommands rather than lane ids — each DEFINED ONCE, in `shared/models.mjs`
// (auto-advance plan W2 Task 7) — held equal, as text, to the places that
// cannot import them: `shared/roster.ts`'s module-private ID_RE, the bash
// shape contract's WRAPPER_ID_RE, `ccd/ccrc`'s MODELS_RESERVED, and
// `deploy/models-op.mjs`, which re-exports the pattern under its old name.
// Neutral ids only: this repository is public.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS_LANE_ID_RE, MODELS_RESERVED_IDS } from '../../shared/models.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');
/** The ONE capture of `re` in `src`: a second definition is a red here, not a quiet drift. */
const only = (src: string, re: RegExp, what: string): string => {
  const all = [...src.matchAll(re)];
  expect(all.length, `expected exactly one ${what}, found ${all.length}`).toBe(1);
  return all[0]![1]!;
};

describe('the lane-id pattern is one pattern in four spellings (plan W2 Task 7)', () => {
  it('shared/models.mjs defines it once, as a regex literal', () => {
    const src = read('shared/models.mjs');
    expect(only(src, /^export const MODELS_LANE_ID_RE = \/(.+)\/;$/gm, 'MODELS_LANE_ID_RE definition'))
      .toBe(MODELS_LANE_ID_RE.source);
  });

  it("shared/roster.ts's ID_RE has the same source", () => {
    expect(only(read('shared/roster.ts'), /^const ID_RE = \/(.+)\/;$/gm, 'ID_RE in shared/roster.ts'))
      .toBe(MODELS_LANE_ID_RE.source);
  });

  it("ccd/ccrc-wrapper-shape's WRAPPER_ID_RE has the same source", () => {
    expect(only(read('ccd/ccrc-wrapper-shape'), /^WRAPPER_ID_RE='([^']+)'$/gm, 'WRAPPER_ID_RE'))
      .toBe(MODELS_LANE_ID_RE.source);
  });

  it('deploy/models-op.mjs re-exports it as ACCOUNT_ID_RE and spells no literal of its own', () => {
    const src = read('deploy/models-op.mjs');
    expect(src).toContain('export const ACCOUNT_ID_RE = MODELS_LANE_ID_RE;');
    expect(src).not.toMatch(/ACCOUNT_ID_RE = \//);
    expect(src).not.toContain('[a-z0-9-]{0,31}');
  });

  it('accepts lane-a and a 32-character id; refuses .., a slash, a leading dash, uppercase and 33 characters', () => {
    for (const ok of ['lane-a', 'a', `a${'b'.repeat(31)}`]) expect(MODELS_LANE_ID_RE.test(ok), ok).toBe(true);
    for (const bad of ['..', 'lane/a', '-lane', 'Lane-a', `a${'b'.repeat(32)}`, '']) {
      expect(MODELS_LANE_ID_RE.test(bad), bad).toBe(false);
    }
  });
});

describe('the reserved words are one list in two languages (plan W2 Task 7)', () => {
  it("equal ccd/ccrc's MODELS_RESERVED, element for element", () => {
    const words = only(read('ccd/ccrc'), /^MODELS_RESERVED="([^"]*)"$/gm, 'MODELS_RESERVED');
    expect([...MODELS_RESERVED_IDS].sort()).toEqual(words.split(' ').filter(Boolean).sort());
  });

  it('is a frozen array', () => {
    expect(Array.isArray(MODELS_RESERVED_IDS)).toBe(true);
    expect(Object.isFrozen(MODELS_RESERVED_IDS)).toBe(true);
  });
});
