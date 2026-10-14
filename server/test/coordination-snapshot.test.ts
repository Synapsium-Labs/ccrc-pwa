// Delegation broker wave 3, Task 8: coordination snapshots.
//
// This file is shared by two halves of Task 8. THE FIRST DESCRIBE BELOW IS 8A's: the journal-grammar rows W3-M20 to W3-M24 against
// the journal VALIDATOR (`validateDelegationJournalBytes` and the chain it is built on): the anchor triple, the chain input,
// every torn-tail position, the sequence table, and the retained pre-anchor identity evidence. 8B extends this file with the
// capture, classifier and restore rows in describes of its own; it must not edit these.
//
// Every hash below was computed by Python's `hashlib` and `json` (sorted keys, no whitespace, ensure_ascii=False), never by
// running the code under test.
import { describe, it, expect } from 'vitest';
import {
  DelegationJournalError,
  buildDelegationJournalRecord,
  delegationJournalDigest,
  delegationJournalId,
  encodeDelegationJournalRecord,
  parseDelegationJournal,
  validateDelegationJournalBytes,
  type DelegationJournalPosition,
} from '../src/coord/delegation-journal.js';
import type { DelegationJournalRecordV1 } from '../src/coord/delegation-model.js';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';

const CLAUDE = '11111111-2222-3333-4444-555555555555';
const common = {
  v: 1 as const, sessionId: 'lane-a-demo', parentIncarnation: 'g1', claudeSessionId: CLAUDE, bucket: '2026101400',
};

// Three records whose journalId and digest were computed in Python (see the header).
const EVENT_A: DelegationEventEnvelopeV1 = {
  ...common, eventKind: 'SessionStart', source: 'startup', observedAt: '2026-10-14T00:00:00.000Z', eventId: 'a'.repeat(64), startOffset: 0, endOffset: 100,
};
const EVENT_B: DelegationEventEnvelopeV1 = {
  ...common, eventKind: 'SubagentStart', agentId: 'agent-abc123', agentType: null, observedAt: '2026-10-14T00:00:02.000Z', eventId: 'b'.repeat(64), startOffset: 100, endOffset: 230,
};
const EVENT_C: DelegationEventEnvelopeV1 = {
  ...common, eventKind: 'SessionStart', source: 'résumé 日本語 é', cwd: '/work/café/日本', observedAt: '2026-10-14T00:00:00.000Z', eventId: 'c'.repeat(64), startOffset: 230, endOffset: 400,
};
const A = { sequence: 1, acceptedAt: '2026-10-14T00:00:01.000Z', previousDigest: null, journalId: '93d36739e183fae9d71b701295ab4f8aee14ae2765c5433fc9cc607230942939', digest: '03649ebf24741fdb6777644873afddc4e49dd975b035e1762b1a663f8ee30d96' };
const B = { sequence: 2, acceptedAt: '2026-10-14T00:00:03.000Z', previousDigest: A.digest, journalId: '7f81126a96ce1ebca93b10199c698cc73bee7df3e554ec7b8be2517cdf118312', digest: '1ba0da46e7757b7d45e8e912f765bbeb1258df03e17b2662d528cdb92da5e4c2' };
const C = { sequence: 3, acceptedAt: '2026-10-14T00:00:04.000Z', previousDigest: B.digest, journalId: 'aa15ed8ba8f002daee0c3f2a195d422996e116a542f3a1cddb4fb279bebacf2c', digest: 'cac1b79e215955a8aef5b1894462c958108aa33d0021ea7f50f4885b536d9186' };
// Record 2 hashed as if its previousDigest were null: what a digest computed WITHOUT the chain input would be.
const B_NULL_PREVIOUS = { journalId: 'fdf65f906f4375214c8058305383ff8f4ef6e3ae4d1fbdeecff9cd278a40591c', digest: '4c111b7afd1ae6bac66c57d752a6707b7d59a691547ed4042adf49f3554a7577' };

const rec = (f: { sequence: number; acceptedAt: string; previousDigest: string | null }, event: DelegationEventEnvelopeV1): DelegationJournalRecordV1 =>
  buildDelegationJournalRecord({ ...f, entry: { kind: 'evidence-accepted', event } });
const RA = rec(A, EVENT_A);
const RB = rec(B, EVENT_B);
const RC = rec(C, EVENT_C);
const bytesOf = (...records: DelegationJournalRecordV1[]): Uint8Array => {
  const parts = records.map(encodeDelegationJournalRecord);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const posOf = (r: DelegationJournalRecordV1): DelegationJournalPosition => ({ sequence: r.sequence, journalId: r.journalId, digest: r.digest });
const codeOf = (fn: () => unknown): string => {
  try { fn(); } catch (err) { if (err instanceof DelegationJournalError) return err.code; throw err; }
  return 'accepted';
};

describe('8A: journal-grammar rows (delegation broker wave 3, W3-M20 to W3-M24) against the journal validator', () => {
  it('the three fixed records are the Python-computed ones, and a valid journal covers all three', () => {
    expect([RA.journalId, RA.digest]).toEqual([A.journalId, A.digest]);
    expect([RB.journalId, RB.digest]).toEqual([B.journalId, B.digest]);
    expect([RC.journalId, RC.digest]).toEqual([C.journalId, C.digest]);
    expect(validateDelegationJournalBytes(bytesOf(RA, RB, RC), { completeFromStart: true })).toEqual({
      firstSequence: 1, lastSequence: 3, recordCount: 3, firstPreviousDigest: null, copiedEof: posOf(RC),
    });
  });

  describe('anchor-triple table (W3-M20): sequence, journalId and digest must ALL equal the record at that sequence', () => {
    const journal = bytesOf(RA, RB, RC);
    it('accepts each real anchor, first, middle and last', () => {
      for (const r of [RA, RB, RC]) expect(codeOf(() => validateDelegationJournalBytes(journal, { anchor: posOf(r) }))).toBe('accepted');
    });
    const table: Array<[string, DelegationJournalPosition, string]> = [
      // Record 1's journalId claimed at sequence 2: the journalId is real, and it sits at sequence 1.
      ['a journalId from another record', { ...posOf(RB), journalId: RA.journalId }, 'anchor-sequence'],
      ['a flipped journalId', { ...posOf(RB), journalId: 'f'.repeat(64) }, 'anchor-journal-id'],
      ['a digest from another record', { ...posOf(RB), digest: RA.digest }, 'anchor-digest'],
      ['a flipped digest', { ...posOf(RB), digest: 'f'.repeat(64) }, 'anchor-digest'],
      // The right journalId and digest, at the wrong sequence: the record the anchor names is somewhere else.
      ['the sequence of the record before', { ...posOf(RB), sequence: 1 }, 'anchor-journal-id'],
      ['a sequence that is another record, with this record\'s journalId', { ...posOf(RB), sequence: 3 }, 'anchor-sequence'],
      ['a sequence past the end, with the last record\'s journalId', { ...posOf(RC), sequence: 4 }, 'anchor-sequence'],
      ['a sequence before the start, with the first record\'s journalId', { ...posOf(RA), sequence: 0 }, 'anchor-sequence'],
      ['a whole triple that names no retained record (past the end)', { sequence: 4, journalId: 'f'.repeat(64), digest: 'f'.repeat(64) }, 'anchor-missing'],
    ];
    for (const [name, anchor, code] of table) {
      it(`refuses ${name}`, () => { expect(codeOf(() => validateDelegationJournalBytes(journal, { anchor }))).toBe(code); });
    }
    it('refuses an anchor against an empty journal', () => {
      expect(codeOf(() => validateDelegationJournalBytes(new Uint8Array(0), { anchor: posOf(RA) }))).toBe('anchor-missing');
    });
    it('accepts an empty journal with no anchor, and reports empty coverage', () => {
      expect(validateDelegationJournalBytes(new Uint8Array(0), { anchor: null })).toEqual({
        firstSequence: null, lastSequence: null, recordCount: 0, firstPreviousDigest: null, copiedEof: null,
      });
    });
  });

  describe('chain-input row (W3-M21): the digest includes previousDigest, and the chain is checked', () => {
    it('digest is the Python-computed hash WITH previousDigest, and differs from the one computed without it', () => {
      expect(B.digest).not.toBe(B_NULL_PREVIOUS.digest);
      expect(RB.digest).toBe(B.digest);
      const withoutChain = rec({ ...B, previousDigest: null }, EVENT_B);
      expect([withoutChain.journalId, withoutChain.digest]).toEqual([B_NULL_PREVIOUS.journalId, B_NULL_PREVIOUS.digest]);
    });
    it('changing previousDigest alone changes BOTH hashes, because both preimages carry it', () => {
      const base = { sequence: 2, acceptedAt: B.acceptedAt, entry: RB.entry };
      const one = { ...base, previousDigest: A.digest };
      const two = { ...base, previousDigest: 'e'.repeat(64) };
      expect(delegationJournalId(one)).not.toBe(delegationJournalId(two));
      const j = delegationJournalId(one);
      expect(delegationJournalDigest({ ...one, journalId: j })).not.toBe(delegationJournalDigest({ ...two, journalId: j }));
    });
    it('refuses a record whose previousDigest is not the prior record\'s digest, even when its own hashes are consistent', () => {
      // A record that is internally perfect (its hashes match its preimage) but chains from nothing real.
      const orphan = rec({ ...B, previousDigest: 'd'.repeat(64) }, EVENT_B);
      expect(codeOf(() => validateDelegationJournalBytes(bytesOf(RA, orphan), {}))).toBe('previous-digest');
    });
    it('refuses a first record of a complete journal that has a previousDigest, and accepts one with null', () => {
      const claimed = rec({ ...A, previousDigest: 'd'.repeat(64) }, EVENT_A);
      expect(codeOf(() => validateDelegationJournalBytes(bytesOf(claimed), { completeFromStart: true }))).toBe('previous-digest');
      expect(codeOf(() => validateDelegationJournalBytes(bytesOf(RA), { completeFromStart: true }))).toBe('accepted');
    });
    it('refuses a record whose digest does not match its preimage, and one whose journalId does not', () => {
      const line = new TextDecoder().decode(encodeDelegationJournalRecord(RB)).trimEnd();
      const badDigest = line.replace(B.digest, '0'.repeat(64));
      const badId = line.replace(`"journalId":"${B.journalId}"`, `"journalId":"${'0'.repeat(64)}"`);
      expect(codeOf(() => parseDelegationJournal(text(`${new TextDecoder().decode(encodeDelegationJournalRecord(RA))}${badDigest}\n`)))).toBe('digest-mismatch');
      expect(codeOf(() => parseDelegationJournal(text(`${new TextDecoder().decode(encodeDelegationJournalRecord(RA))}${badId}\n`)))).toBe('journal-id-mismatch');
    });
  });

  describe('torn-position table (W3-M22): every position of a torn tail is refused', () => {
    const full = bytesOf(RA, RB);
    const lastLine = encodeDelegationJournalRecord(RC);                  // includes its LF
    const lineNoLf = lastLine.subarray(0, lastLine.length - 1);
    it('a journal that ends exactly at a record boundary is complete', () => {
      expect(codeOf(() => validateDelegationJournalBytes(full, {}))).toBe('accepted');
    });
    for (let k = 1; k <= lineNoLf.length; k++) {
      it(`refuses the tail cut after ${k} of ${lineNoLf.length} bytes of the next record`, () => {
        const torn = new Uint8Array(full.length + k);
        torn.set(full, 0);
        torn.set(lineNoLf.subarray(0, k), full.length);
        const code = codeOf(() => validateDelegationJournalBytes(torn, {}));
        // The whole record minus only its LF is a complete record that was never terminated.
        expect(code).toBe(k === lineNoLf.length ? 'missing-final-lf' : 'torn-tail');
      });
    }
    it('parseDelegationJournal refuses every one of those positions too, not only the validator', () => {
      for (let k = 1; k <= lineNoLf.length; k++) {
        const torn = new Uint8Array(full.length + k);
        torn.set(full, 0);
        torn.set(lineNoLf.subarray(0, k), full.length);
        expect(codeOf(() => parseDelegationJournal(torn)), `cut after ${k} bytes`).toBe(k === lineNoLf.length ? 'missing-final-lf' : 'torn-tail');
      }
    });
    it('refuses a lone LF-less fragment after a CR, and a bare CR, as torn', () => {
      expect(codeOf(() => validateDelegationJournalBytes(new Uint8Array([...full, 0x0d]), {}))).toBe('torn-tail');
    });
    it('refuses a torn tail in a journal of one record, and in a journal of nothing but a fragment', () => {
      expect(codeOf(() => validateDelegationJournalBytes(text('{"a'), {}))).toBe('torn-tail');
      expect(codeOf(() => validateDelegationJournalBytes(new Uint8Array([...bytesOf(RA), 0x7b]), {}))).toBe('torn-tail');
    });
    it('refuses a torn tail whatever else is wrong with it: it is never parsed', () => {
      expect(codeOf(() => validateDelegationJournalBytes(new Uint8Array([...full, 0xff, 0xfe]), {}))).toBe('torn-tail');
    });
  });

  describe('sequence table (W3-M23): duplicate, gapped and descending sequences are refused', () => {
    const at = (sequence: number, previous: DelegationJournalRecordV1 | null): DelegationJournalRecordV1 =>
      rec({ sequence, acceptedAt: '2026-10-14T00:00:05.000Z', previousDigest: previous === null ? null : previous.digest }, { ...EVENT_A, eventId: String(sequence).padStart(64, '0') });
    const r1 = at(1, null);
    const r2 = at(2, r1);
    const r3 = at(3, r2);
    it('accepts 1, 2, 3', () => { expect(codeOf(() => validateDelegationJournalBytes(bytesOf(r1, r2, r3), { completeFromStart: true }))).toBe('accepted'); });
    const table: Array<[string, DelegationJournalRecordV1[], string]> = [
      ['a duplicated sequence', [r1, r2, r2], 'sequence-duplicate'],
      ['a repeated first record', [r1, r1], 'sequence-duplicate'],
      ['a gap (1, 3)', [r1, at(3, r1)], 'sequence-gap'],
      ['a gap of many (1, 9)', [r1, at(9, r1)], 'sequence-gap'],
      ['a descent (1, 2, 3, 2)', [r1, r2, r3, at(2, r3)], 'sequence-descent'],
      ['a descent to the start (1, 2, 1)', [r1, r2, at(1, r2)], 'sequence-descent'],
    ];
    for (const [name, records, code] of table) {
      it(`refuses ${name}`, () => { expect(codeOf(() => validateDelegationJournalBytes(bytesOf(...records), {}))).toBe(code); });
    }
    it('refuses a complete journal that does not begin at 1, and accepts one that does not claim to be complete', () => {
      expect(codeOf(() => validateDelegationJournalBytes(bytesOf(r2, r3), { completeFromStart: true }))).toBe('sequence-start');
      expect(validateDelegationJournalBytes(bytesOf(r2, r3), {})).toMatchObject({ firstSequence: 2, lastSequence: 3, recordCount: 2, firstPreviousDigest: r1.digest });
    });
    it('refuses sequence 0, a negative sequence, a fraction and an unsafe integer in the record text', () => {
      const line = new TextDecoder().decode(encodeDelegationJournalRecord(r1)).trimEnd();
      for (const bad of ['0', '-1', '1.5', '9007199254740993', '"1"']) {
        expect(codeOf(() => parseDelegationJournal(text(`${line.replace('"sequence":1', `"sequence":${bad}`)}\n`)))).toBe('sequence-domain');
      }
    });
  });

  describe('pre-anchor identity evidence (W3-M24): a journal that drops retained pre-anchor evidence does not validate', () => {
    // A checkpoint anchored at record 3 whose identity-candidate hold names record 1 (the bare occurrence an unopened agent needs).
    const anchor = posOf(RC);
    it('accepts the complete journal, which retains the held record before the anchor', () => {
      expect(codeOf(() => validateDelegationJournalBytes(bytesOf(RA, RB, RC), { anchor, heldJournalIds: [RA.journalId] }))).toBe('accepted');
    });
    it('refuses a journal that begins after the held record, though its chain and its anchor are perfect', () => {
      const trimmed = bytesOf(RB, RC);
      expect(codeOf(() => validateDelegationJournalBytes(trimmed, { anchor }))).toBe('accepted');                    // chain and anchor alone cannot see the loss
      expect(codeOf(() => validateDelegationJournalBytes(trimmed, { anchor, heldJournalIds: [RA.journalId] }))).toBe('held-evidence-missing');
    });
    it('refuses a held journalId no record has, whatever else is held', () => {
      expect(codeOf(() => validateDelegationJournalBytes(bytesOf(RA, RB, RC), { anchor, heldJournalIds: [RA.journalId, 'f'.repeat(64)] }))).toBe('held-evidence-missing');
    });
    it('accepts a held record AT the anchor or after it: held evidence need only be retained', () => {
      expect(codeOf(() => validateDelegationJournalBytes(bytesOf(RA, RB, RC), { anchor: posOf(RB), heldJournalIds: [RB.journalId, RC.journalId] }))).toBe('accepted');
    });
  });
});
