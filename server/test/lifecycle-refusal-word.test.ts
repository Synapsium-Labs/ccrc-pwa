// The journal's own refusal copy, and the ONE property that keeps it from
// becoming a second, drifting copy of `wsaudit.ts`'s SENTENCES: the two maps
// are DISJOINT. A token with a word in both is exactly the shape the
// `branch-drift` -> `registry-branch-drift` incident left behind.
//
// Why two maps at all, rather than widening SENTENCES: `wsaudit.test.ts` holds
// SENTENCES set-equal in BOTH directions to tokens grepped from ccd's source
// by four regexes (`wsaudit.test.ts:57-60`), and a `_lc_refuse` call changes
// no stdout and no exit contract — it produces no `verdict`/`refused` JSON for
// those regexes to see. A SENTENCES entry for a journal-only token would
// therefore red that test's stale-copy direction, and the only fixes would be
// deleting copy or weakening an approved mechanism (`ccd:2121-2128` records
// the same argument being had once already). D15 rules it: no SENTENCES entry;
// journal-only tokens get their word here.
import { describe, it, expect } from 'vitest';
import {
  LC_REFUSAL_TOKENS, LC_REFUSAL_WORD, isLcRefusalToken, lcRefusalWord,
  type LcRefusalToken,
} from '../../shared/api.js';
import { SENTENCES, refusalSentence } from '../src/wsaudit.js';

const ALL_TOKENS: Record<LcRefusalToken, true> = {
  'scratch-unwritable': true, 'tip-unreadable': true, 'bad-session-id': true,
  'flock-unavailable': true, 'lock-unopenable': true, 'is-a-workspace': true,
  'session-live': true, 'session-verdict-unknown': true, 'spawn-failed': true,
};
const TOKENS = Object.keys(ALL_TOKENS) as LcRefusalToken[];

describe('the journal-only refusal vocabulary', () => {
  it.each(TOKENS)('isLcRefusalToken(%s)', (t) => { expect(isLcRefusalToken(t)).toBe(true); });

  it('covers the whole union and derives its list from the map', () => {
    expect(TOKENS.length).toBe(9);
    expect([...LC_REFUSAL_TOKENS].sort()).toEqual([...TOKENS].sort());
  });

  it('every token has a real sentence — no blanks, no bare token echoed back', () => {
    for (const t of LC_REFUSAL_TOKENS) {
      const w = LC_REFUSAL_WORD[t];
      expect(w, t).toBeTruthy();
      expect(w.length, `${t}'s word is too short to be one`).toBeGreaterThan(20);
      expect(w, `${t} echoes its own token at a person`).not.toContain(t);
    }
  });
});

describe('DISJOINT from wsaudit`s SENTENCES — one word for one token, once', () => {
  it('shares no key with SENTENCES', () => {
    const both = LC_REFUSAL_TOKENS.filter((t) => t in SENTENCES);
    expect(both, `these have copy in BOTH maps — delete one: ${both.join(', ')}`).toEqual([]);
  });

  it('and the scan is looking at something — SENTENCES really is populated', () => {
    // Guards the guard: an empty SENTENCES would make the filter above
    // vacuously empty and retire the assertion silently. Measured today: 54.
    expect(Object.keys(SENTENCES).length).toBeGreaterThan(50);
    expect(SENTENCES).toHaveProperty('held');
    expect(SENTENCES).toHaveProperty('dirty-tree');
  });

  it('the tokens ccd ALREADY answers in JSON are deliberately NOT here', () => {
    // These nine are the shared rungs — ws-rm and ws-reap both refuse on them
    // — and every one already has a SENTENCES entry. A word here would be the
    // second copy.
    for (const t of ['held', 'dirty-tree', 'no-such-session', 'not-a-workspace',
      'incomplete-registry', 'foreign-worktree', 'tree-unreadable',
      'nested-checkouts-present', 'in-progress']) {
      expect(isLcRefusalToken(t), t).toBe(false);
      expect(refusalSentence(t), `${t} must still be answerable`)
        .not.toBe(`ccrc declined: ${t}.`);
    }
  });
});

describe('lcRefusalWord — null is a POSITIVE answer, not a failure', () => {
  it('answers the word for a journal-only token', () => {
    expect(lcRefusalWord('session-live')).toBe(LC_REFUSAL_WORD['session-live']);
  });

  it('answers null for a token wsaudit owns, so the caller falls through to it', () => {
    expect(lcRefusalWord('held')).toBeNull();
    expect(lcRefusalWord('')).toBeNull();
    expect(lcRefusalWord('a-token-nobody-writes')).toBeNull();
    // The composition wave 9 writes: `lcRefusalWord(t) ?? refusalSentence(t)`.
    // L0 cannot import wsaudit (it imports nothing), so the fallthrough is the
    // caller's and the null is how L0 says "not mine".
  });
});
