// Landing order wave 5k, Task 3: the console's words for the line and its doors (`fleet/landingWords.ts`, L1). The table
// below is the plan's section 4.2 table, copied from the plan's text, so each sentence is pinned byte for byte.
import { describe, it, expect } from 'vitest';
import { LANDING_INFRASTRUCTURE_CODES, LANDING_MUTATION_CODES, type LandingNoticeOutcome } from '../../shared/landingLine';
import { ApiError } from '../src/lib/apiError';
import {
  LANDING_ROUTE_TEXT, LANDING_ROUTE_WORDS, OUTCOME_UNKNOWN_TAIL, UNKNOWN_WORD_READ_TEXT, UNKNOWN_WORD_TEXT, UNREACHABLE_READ_TEXT,
  UNREACHABLE_WRITE_TEXT, UNWORDED_READ_TEXT, UNWORDED_TEXT, landingFailureOf, landingNoticeText, type LandingDoor,
} from '../src/fleet/landingWords';

const ROUTE_WORDS = ['run-unreadable', 'bad-request', 'not-configured', 'unauthenticated'] as const;
const EVERY = [...LANDING_INFRASTRUCTURE_CODES, ...LANDING_MUTATION_CODES, ...ROUTE_WORDS];

/** The plan's words table (section 4.2): word, scope, sentence. */
const TABLE: [string, 'box' | 'absent', string][] = [
  ["landing-journal-unavailable", "box", "The landing line's journal could not be opened, so nothing was read or changed. Try again in a minute; if it stays, the server needs a restart."],
  ["landing-journal-unreadable", "box", "The landing line's journal could not be read, so nothing was read or changed. If it stays, the server needs a restart."],
  ["landing-journal-invalid", "box", "The landing line's journal holds a record this server cannot read, so nothing was read or changed. The line stays stopped until the journal is repaired."],
  ["landing-journal-missing", "box", "The landing line's journal is missing on the server, so nothing was read or changed. The line stays stopped until the journal is back."],
  ["landing-journal-cursor", "box", "The landing database and its journal disagree about how far the journal was applied, so nothing was read or changed. A restart replays the journal."],
  ["landing-journal-changed", "box", "The landing line's journal changed while the server read it, so nothing was changed. Try again."],
  ["landing-journal-durability", "box", "The server could not confirm its journal reached its disk, so the line stays stopped until the server replays the journal."],
  ["landing-journal-append", "box", "The server could not finish writing the journal."],
  ["landing-db-unavailable", "box", "The coordination database is not available, so the landing line was not read or changed. Try again in a minute."],
  ["landing-db-apply", "box", "The server wrote the journal but could not apply it. The server's next replay of its journal settles it."],
  ["landing-db-commit", "box", "The server could not commit the change. The server's next replay of its journal settles it."],
  ["landing-fenced", "box", "The landing line is stopped after an earlier failure. It reads and changes nothing until the server replays its journal or restarts."],
  ["landing-projection-unreadable", "box", "A record of the landing line does not read, so nothing was read or changed. A replay or a restart does not fix it; the record needs repair."],
  ["landing-entry-exists", "box", "That pull request already has an entry in the line, so nothing was changed."],
  ["landing-entry-missing", "box", "That pull request has no entry in this project's line any more, so nothing was changed. The line is read again."],
  ["landing-after-missing", "box", "An order named an entry that is not in the line, so nothing was changed."],
  ["landing-after-cross-project", "box", "An order named an entry of another project, so nothing was changed."],
  ["landing-cycle", "box", "That order would make entries wait on each other in a circle, so nothing was changed."],
  ["landing-dependencies-unreadable", "box", "An entry's order could not be read, so nothing was changed."],
  ["landing-recovery-unresolved", "box", "This entry's records are still being recovered, so it cannot be withdrawn yet. Nothing was changed."],
  ["landing-identity-conflict", "box", "Two records of this line claim the same entry, so nothing can be withdrawn until that is repaired. Nothing was changed."],
  ["landing-id-overflow", "box", "The line has run out of entry numbers, so nothing was changed."],
  ["landing-sequence-overflow", "box", "The landing journal has run out of sequence numbers, so nothing was changed."],
  ["landing-entry-terminal", "box", "That entry has already left the line: it landed, was closed or was withdrawn. Nothing was changed; the line is read again."],
  ["landing-entry-moved", "box", "The server's record of that entry does not match what this screen read, so nothing was withdrawn. The line is read again; look at it and confirm again if you still mean to."],
  ["landing-project-unknown", "box", "The landing line has never seen this project, so there is nothing to pause. Nothing was changed."],
  ["landing-record-unparseable", "box", "The server built a journal record its own reader refuses, so it wrote nothing. Nothing was changed; this is a server defect worth reporting."],
  ["run-unreadable", "box", "The run behind this entry could not be read, so the server could not tell who to notify and withdrew nothing. Trying again does not help until the run or the entry's record is repaired."],
  ["bad-request", "box", "The server refused the request as malformed, so nothing was changed. This page and the server may be out of step; reload the page."],
  ["not-configured", "absent", "This box runs no coordination, so it has no landing line."],
  ["unauthenticated", "box", "Your sign-in has lapsed, so nothing was changed. Sign in again and retry."],
];

const refusal = (status: number, body: unknown): ApiError => new ApiError(status, body);

describe('the route words table (wave 5k)', () => {
  it('every word has one sentence that is non-empty, ends with a full stop, names no code and is its own', () => {
    expect(Object.keys(LANDING_ROUTE_WORDS).sort()).toEqual([...EVERY].sort());
    const seen = new Set<string>();
    for (const word of EVERY) {
      const w = LANDING_ROUTE_WORDS[word];
      expect(w.text.length, word).toBeGreaterThan(0);
      expect(w.text.endsWith('.'), word).toBe(true);
      expect(w.text, word).not.toContain(word);
      expect(seen.has(w.text), word).toBe(false);
      seen.add(w.text);
      expect(w.scope, word).toBe(word === 'not-configured' ? 'absent' : 'box');
      expect(Object.hasOwn(w, 'mayApply'), word).toBe(false);
    }
  });
  it('the derived text record has exactly the table\'s keys, each with its text', () => {
    expect(Object.keys(LANDING_ROUTE_TEXT).sort()).toEqual(Object.keys(LANDING_ROUTE_WORDS).sort());
    for (const [word, w] of Object.entries(LANDING_ROUTE_WORDS)) expect(LANDING_ROUTE_TEXT[word as keyof typeof LANDING_ROUTE_TEXT]).toBe(w.text);
  });
  it('the plan\'s table has a row for every word', () => {
    expect(TABLE.map(([w]) => w).sort()).toEqual([...EVERY].sort());
  });
  it.each(TABLE)('%s is %s: the plan\'s sentence, byte for byte', (word, scope, text) => {
    expect(LANDING_ROUTE_WORDS[word as keyof typeof LANDING_ROUTE_WORDS]).toEqual({ scope, text });
  });
});

describe('landingFailureOf (wave 5k; section 11, C1 and C3)', () => {
  const WRITES: LandingDoor[] = ['pause', 'withdraw'];
  it('a known word answers its sentence and scope, with the tail exactly when the body says mayApply on a write', () => {
    const commit = LANDING_ROUTE_WORDS['landing-db-commit'].text;
    for (const door of WRITES) {
      expect(landingFailureOf(refusal(503, { ok: false, error: 'landing-db-commit', mayApply: true }), door))
        .toEqual({ text: commit + OUTCOME_UNKNOWN_TAIL, scope: 'box', outcomeUnknown: true });
      expect(landingFailureOf(refusal(503, { ok: false, error: 'landing-db-commit' }), door))
        .toEqual({ text: commit, scope: 'box', outcomeUnknown: false });
    }
    expect(landingFailureOf(refusal(503, { ok: false, error: 'landing-db-commit', mayApply: true }), 'read'))
      .toEqual({ text: commit, scope: 'box', outcomeUnknown: false });
    expect(landingFailureOf(refusal(503, { ok: false, error: 'landing-db-commit' }), 'read').outcomeUnknown).toBe(false);
  });
  it('the body decides, not the word: landing-entry-moved with mayApply carries the tail, without it none', () => {
    const moved = LANDING_ROUTE_WORDS['landing-entry-moved'].text;
    expect(landingFailureOf(refusal(409, { ok: false, error: 'landing-entry-moved', mayApply: true }), 'withdraw'))
      .toEqual({ text: moved + OUTCOME_UNKNOWN_TAIL, scope: 'box', outcomeUnknown: true });
    expect(landingFailureOf(refusal(409, { ok: false, error: 'landing-entry-moved' }), 'withdraw'))
      .toEqual({ text: moved, scope: 'box', outcomeUnknown: false });
  });
  it('not-configured is absent; landing-projection-unreadable is box on every door', () => {
    for (const door of ['read', ...WRITES] as LandingDoor[]) {
      expect(landingFailureOf(refusal(501, { ok: false, error: 'not-configured' }), door).scope).toBe('absent');
      expect(landingFailureOf(refusal(503, { ok: false, error: 'landing-projection-unreadable', recovery: 'repair' }), door).scope).toBe('box');
    }
  });
  it('an unknown word names it; on a write the tail follows mayApply or a status of 500 or more, never on a read', () => {
    expect(landingFailureOf(refusal(409, { ok: false, error: 'brand-new-word' }), 'withdraw'))
      .toEqual({ text: UNKNOWN_WORD_TEXT('brand-new-word'), scope: 'box', outcomeUnknown: false });
    expect(landingFailureOf(refusal(409, { ok: false, error: 'brand-new-word', mayApply: true }), 'pause'))
      .toEqual({ text: UNKNOWN_WORD_TEXT('brand-new-word') + OUTCOME_UNKNOWN_TAIL, scope: 'box', outcomeUnknown: true });
    expect(landingFailureOf(refusal(500, { ok: false, error: 'brand-new-word' }), 'withdraw'))
      .toEqual({ text: UNKNOWN_WORD_TEXT('brand-new-word') + OUTCOME_UNKNOWN_TAIL, scope: 'box', outcomeUnknown: true });
    expect(landingFailureOf(refusal(500, { ok: false, error: 'brand-new-word', mayApply: true }), 'read'))
      .toEqual({ text: UNKNOWN_WORD_READ_TEXT('brand-new-word'), scope: 'box', outcomeUnknown: false });
    expect(UNKNOWN_WORD_TEXT('brand-new-word')).toContain('`brand-new-word`');
    expect(landingFailureOf(refusal(409, { ok: false, error: '' }), 'read').text.length).toBeGreaterThan(0);
  });
  it('an ApiError with no readable word answers its status: the tail on a write at 500 or more, never on a read', () => {
    expect(landingFailureOf(refusal(502, '<html>bad gateway</html>'), 'withdraw'))
      .toEqual({ text: UNWORDED_TEXT(502) + OUTCOME_UNKNOWN_TAIL, scope: 'box', outcomeUnknown: true });
    expect(landingFailureOf(refusal(400, null), 'pause')).toEqual({ text: UNWORDED_TEXT(400), scope: 'box', outcomeUnknown: false });
    expect(landingFailureOf(refusal(502, '<html>bad gateway</html>'), 'read'))
      .toEqual({ text: UNWORDED_READ_TEXT(502), scope: 'box', outcomeUnknown: false });
    expect(landingFailureOf(refusal(500, { ok: false, error: 7 }), 'read').text).toBe(UNWORDED_READ_TEXT(500));
  });
  it('anything else is the unreachable sentence, with the tail on pause and withdraw and not on read', () => {
    for (const door of WRITES) {
      expect(landingFailureOf(new Error('network'), door))
        .toEqual({ text: UNREACHABLE_WRITE_TEXT + OUTCOME_UNKNOWN_TAIL, scope: 'box', outcomeUnknown: true });
    }
    expect(landingFailureOf(new Error('timeout'), 'read')).toEqual({ text: UNREACHABLE_READ_TEXT, scope: 'box', outcomeUnknown: false });
    expect(landingFailureOf('a thrown string', 'read').text).toBe(UNREACHABLE_READ_TEXT);
  });
  it('the unreachable write sentence is section 5\'s, byte for byte', () => {
    expect(landingFailureOf(new Error('network'), 'withdraw').text)
      .toBe('The server could not be reached or did not answer. Whether this change took effect is not known; the line is read again to show what stands.');
  });
});

describe('landingNoticeText (wave 5k)', () => {
  const prOf = (id: number): number | null => ({ 107: 107, 108: 108 } as Record<number, number>)[id] ?? null;
  const at = (o: LandingNoticeOutcome): string => landingNoticeText(o, 104, prOf);
  it('each kind and reason', () => {
    expect(at({ word: 'landing-withdrawn', entryId: 104, kind: 'queued', toId: 'lane-a-project-a', mailId: 1, deliveryId: 2 }))
      .toBe('Told lane-a-project-a, its coordinator.');
    expect(at({ word: 'landing-held', entryId: 107, kind: 'queued', toId: 'lane-b-project-a', mailId: 3, deliveryId: 4 }))
      .toBe('Told lane-b-project-a, coordinator of #107, which now waits on it.');
    expect(at({ word: 'landing-held', entryId: 107, kind: 'none', reason: 'unclaimed' })).toBe('No one to tell about #107: its run has no coordinator.');
    expect(at({ word: 'landing-withdrawn', entryId: 104, kind: 'none', reason: 'unrecorded' }))
      .toBe('No one to tell about #104: no coordinator was recorded when it entered the line.');
    expect(at({ word: 'landing-held', entryId: 108, kind: 'unreadable' })).toBe('Could not tell the coordinator of #108: its run could not be read.');
  });
  it('a dependant the line as read does not name is entry <id>', () => {
    expect(at({ word: 'landing-held', entryId: 555, kind: 'unreadable' })).toBe('Could not tell the coordinator of entry 555: its run could not be read.');
    expect(at({ word: 'landing-held', entryId: 555, kind: 'queued', toId: 'lane-c', mailId: 5, deliveryId: 6 }))
      .toBe('Told lane-c, coordinator of entry 555, which now waits on it.');
    expect(at({ word: 'landing-held', entryId: 555, kind: 'none', reason: 'unrecorded' })).not.toContain('#null');
  });
});
