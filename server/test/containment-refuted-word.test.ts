// `containment-refuted` (child reclamation wave 7, spec §5.6) is the shared
// tail's word for a PROVEN refusal at its removal-time re-ask. It is declared
// with its ccd emission (`_ws_reclaim_tail`'s literal `_ws_reclaim_fail …
// containment-refuted`). Its sentence says only what is true under any server.
// The expiry lane classes it `stuck` (workspace lifecycle wave 6, ruling B), in
// a describe of its own below. Until the reclaim side classes it, its parser
// reads it as the resumable failure it is, so it is retried; wave 8's `stuck`
// class changes that pin on purpose.
import { describe, it, expect } from 'vitest';
import { LC_REFUSAL_WORD, isLcRefusalToken, lcRefusalWord } from '../../shared/api.js';
import { SENTENCES, refusalSentence } from '../src/wsaudit.js';
import { childReclaimTokenKind, parseChildReclaimResult } from '../src/coord/childReclaim.js';
import { EXPIRE_STUCK_WORD, parseExpireResult } from '../src/archivedExpiry.js';
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

describe('today’s parsers read it as a resumable failure — retried', () => {
  it('parseChildReclaimResult: failed, resumable, with its token', () => {
    expect(parseChildReclaimResult('demo-quiet-basin', DOC, '')).toEqual({
      kind: 'failed', resume: 'resumable', detail: `${W}: d`, token: W });
  });

  it('the sweep reads its journal line as a FAILURE line, never a terminal refusal', () => {
    expect(childReclaimFailureLine({ outcome: 'failed', refusal: W })).toBe(true);
    expect(childReclaimTokenKind(W)).toBeNull();
    expect(childReclaimTerminalRefusal(
      { sessionId: 'demo-quiet-basin', outcome: 'failed', refusal: W, at: 1, failingSince: 1 }, childReclaimTokenKind,
    )).toBe(false);
  });
});

describe('the expiry lane reads it as STUCK, whatever crumb says (workspace lifecycle wave 6, ruling B; CCR-15’s R76 and R77)', () => {
  it('parseExpireResult: stuck — listed at once and asked again on the persistent tier, never at +∞', () => {
    for (const extra of [{}, { crumb: true }, { crumb: false }, { crumb: 'yes' }]) {
      expect(parseExpireResult('demo-quiet-dune', JSON.stringify({ failed: W, detail: 'd', ...extra }), ''), JSON.stringify(extra))
        .toEqual({ kind: 'stuck', detail: `${W}: d` });
    }
  });

  it('reads the word from its L0 home: the expiry’s stuck word IS the journal-only token, typed against it', () => {
    expect(EXPIRE_STUCK_WORD).toBe(W);
    expect(isLcRefusalToken(EXPIRE_STUCK_WORD)).toBe(true);
  });
});
