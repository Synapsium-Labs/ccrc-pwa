// `containment-refuted` (child reclamation wave 7, spec §5.6) is the shared
// tail's word for a PROVEN refusal at its removal-time re-ask. It is declared
// with its ccd emission (`_ws_reclaim_tail`'s literal `_ws_reclaim_fail …
// containment-refuted`). Its sentence says only what is true under any server.
// Wave 8's `stuck` class reads it in the reclaim parser as `stuck`; until a
// server classes it, the expiry parser reads it as the resumable failure it is,
// so it is retried. Wave 8 changed the reclaim parser's pin below on purpose.
import { describe, it, expect } from 'vitest';
import { LC_REFUSAL_WORD, isLcRefusalToken, lcRefusalWord } from '../../shared/api.js';
import { SENTENCES, refusalSentence } from '../src/wsaudit.js';
import { childReclaimTokenKind, parseChildReclaimResult } from '../src/coord/childReclaim.js';
import { parseExpireResult } from '../src/archivedExpiry.js';
import { childReclaimFailureLine, childReclaimTerminalRefusal } from '../src/childReclaimSweep.js';

const W = 'containment-refuted' as const;
const DOC = JSON.stringify({ failed: W, detail: 'd' });

describe('the word', () => {
  it('is a journal-only token with a word of its own, never a SENTENCES key', () => {
    expect(isLcRefusalToken(W)).toBe(true);
    expect(W in SENTENCES, 'one word for one token, once').toBe(false);
    expect(lcRefusalWord(W)).toBe(LC_REFUSAL_WORD[W]);
    expect(lcRefusalWord(W)).not.toBe(refusalSentence(W));
  });

  it('says what is true under any server: stopped, nothing further deleted, and a retry meets the same', () => {
    expect(LC_REFUSAL_WORD[W]).toMatch(/The session was stopped/);
    expect(LC_REFUSAL_WORD[W]).toMatch(/nothing further was deleted/);
    expect(LC_REFUSAL_WORD[W]).toMatch(/A retry finds the same thing until that other tree or row is moved or removed/);
  });

  it('promises nothing a server decides: not whether or when ccrc retries, nor that anything is intact', () => {
    expect(LC_REFUSAL_WORD[W]).not.toMatch(/intact|will not|won’t|never retr|from the start|resumes|tries again/i);
  });
});

// Wave 8 retitles this describe and flips ONE assertion in it on purpose (spec
// §5.6, the stuck class): the reclaim parser reads the word as `stuck`.
// `parseExpireResult`'s, below, is workspace-lifecycle's and is left as found.
describe('the parsers read it as a failure: the reclaim parser as stuck, the expiry parser as resumable', () => {
  it('parseChildReclaimResult: failed, stuck, with its token', () => {
    expect(parseChildReclaimResult('demo-quiet-basin', DOC, '')).toEqual({
      kind: 'failed', resume: 'stuck', detail: `${W}: d`, token: W });
  });

  it('parseExpireResult: failed, resumable — the expiry lane asks again on its backoff, never at +∞', () => {
    expect(parseExpireResult('demo-quiet-dune', DOC, '')).toEqual({ kind: 'failed', resumable: true, detail: `${W}: d` });
  });

  it('the sweep reads its journal line as a FAILURE line, never a terminal refusal', () => {
    expect(childReclaimFailureLine({ outcome: 'failed', refusal: W })).toBe(true);
    expect(childReclaimTokenKind(W)).toBeNull();
    expect(childReclaimTerminalRefusal(
      { sessionId: 'demo-quiet-basin', outcome: 'failed', refusal: W, at: 1, failingSince: 1 }, childReclaimTokenKind,
    )).toBe(false);
  });
});
