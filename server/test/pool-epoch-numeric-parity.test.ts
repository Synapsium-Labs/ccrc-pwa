// The pool-epoch numeric grammar — "zero, or a non-zero digit followed by any
// digits, never a leading zero" (the control plane's `%d` can never produce
// one) — is spelled in THREE languages, none of which can import another:
// bash's `numRe` (`ccd/ccd:2157`, validates `epoch`/`issued`/`lease` for
// `_acct_pool_state` — `ccd/ccd` sources nothing from this repository),
// python's `NUM` (`ccd/ccd-pool-sync:156`, the writer's own pre-render check),
// and TypeScript's `OBSERVED_EPOCH_NUM` (`agent/src/server.ts`, the
// epoch-only READER task 8 added). Held equal HERE instead, the same move
// `pool-name-parity.test.ts` makes for the pool-NAME grammar and
// `pool-tag-parity.test.ts` makes for the tag PARSE.
//
// Review T8-R1, F5 (Minor 4): the leading-zero fix in fix round 1 tightened
// `readObservedEpoch`'s regex to agree with bash's `numRe`, on the strength of
// a comment CLAIMING agreement — a claim nothing checked, the third hand-typed
// copy of one grammar. This is the check.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CCD } from './ccdWsHelpers.js';
import { OBSERVED_EPOCH_NUM } from '../../agent/src/server.js';

const ccdSrc = readFileSync(CCD, 'utf8');
const poolSyncSrc = readFileSync(path.join(path.dirname(CCD), 'ccd-pool-sync'), 'utf8');

/** Asserts EXACTLY ONE occurrence of an assignment matched by `nameRe` (a
 *  global regex with no capture groups, matching the whole assignment
 *  token — not merely the bare name, so a mid-line `local a='' numRe='…'`
 *  assignment is still found and a bare USE of the name, like `$numRe`, is
 *  not) — a second assignment anywhere in the file is the drift this test
 *  exists to refuse, exactly as `pool-name-parity.test.ts`'s own
 *  `exactlyOne` argues. Then applies `valueRe` (one capture group) to that
 *  single match and returns the captured payload. */
function exactlyOneAssignment(src: string, nameRe: RegExp, valueRe: RegExp, what: string): string {
  const all = [...src.matchAll(nameRe)];
  expect(all.length, `${what}: expected exactly one assignment, found ${all.length}`).toBe(1);
  const m = valueRe.exec(all[0]![0]);
  expect(m, `${what}: the one assignment found ('${all[0]![0]}') is not in the expected spelling`)
    .not.toBeNull();
  return m![1]!;
}

describe('the pool-epoch numeric grammar is one grammar in three languages', () => {
  it('guards the guard: OBSERVED_EPOCH_NUM is the non-capturing fragment it claims to be, not an empty or trivial pattern', () => {
    // A guard that returns '' or '()' would make every comparison below pass
    // against a pattern matching almost anything.
    expect(OBSERVED_EPOCH_NUM.startsWith('(?:')).toBe(true);
    expect(OBSERVED_EPOCH_NUM.endsWith(')')).toBe(true);
    expect(OBSERVED_EPOCH_NUM.length).toBeGreaterThan(8);
    // And it actually behaves as the grammar it claims: accepts 0 and 43,
    // rejects a leading zero and a non-digit.
    const re = new RegExp(`^${OBSERVED_EPOCH_NUM}$`);
    expect(re.test('0')).toBe(true);
    expect(re.test('43')).toBe(true);
    expect(re.test('007')).toBe(false);
    expect(re.test('4a')).toBe(false);
    expect(re.test('')).toBe(false);
  });

  it('ccd/ccd holds exactly one numRe, and its core matches OBSERVED_EPOCH_NUM', () => {
    // `numRe` is assigned mid-line, alongside `local found=''` — not a
    // top-level `NAME=…` the way `POOL_NAME_RE` is, so the name-match is a
    // bare-word search for `numRe='...'`, not a line anchor.
    const core = exactlyOneAssignment(
      ccdSrc, /\bnumRe='[^']*'/g, /^numRe='\^\(([^)]*)\)\$'$/, 'ccd/ccd numRe',
    );
    expect(`(?:${core})`).toBe(OBSERVED_EPOCH_NUM);
  });

  it('ccd/ccd-pool-sync holds exactly one NUM, byte-equal to OBSERVED_EPOCH_NUM', () => {
    const value = exactlyOneAssignment(
      poolSyncSrc, /^NUM = r"[^"]*"$/gm, /^NUM = r"([^"]*)"$/, 'ccd-pool-sync NUM',
    );
    expect(value).toBe(OBSERVED_EPOCH_NUM);
  });
});
