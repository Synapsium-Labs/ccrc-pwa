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

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 8B: THE SNAPSHOT HELPER (`deploy/coordination-snapshot.mjs`): capture, classify, restore, recover.
//
// Everything below is a FIXTURE: a fixture HOME with a `.ccrc` directory, a fixture timestamp directory, a fake `systemctl` on a
// private PATH. Nothing reads or writes the live `~/.ccrc`, `~/ccrc-backups` or any unit. The helper is a plain `.mjs` that
// imports `node:*` only, so it is loaded by path (and mutated, in the mutation runs, as a copy of the tree).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
import { afterEach, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DELEGATION_LEASE_SOURCE_KINDS } from '../../shared/api.js';
import { emptyDelegationCheckpoint, type DelegationCheckpointV1 } from '../src/coord/delegation-model.js';
import {
  COORDINATION_RESTORE_MARKER_FILE,
  DELEGATION_CHECKPOINT_FILE,
  decodeDelegationCheckpoint,
  encodeDelegationCheckpoint,
} from '../src/coord/delegation-checkpoint.js';
import { DELEGATION_JOURNAL_FILE } from '../src/coord/delegation-journal.js';
import { mkTmp } from './tmpHelpers.js';

const HERE8B = path.dirname(fileURLToPath(import.meta.url));
const HELPER_PATH = path.join(HERE8B, '..', '..', 'deploy', 'coordination-snapshot.mjs');
const BACKUP_COORD_PATH = path.join(HERE8B, '..', '..', 'deploy', 'backup-coord.mjs');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let H: any;
beforeAll(async () => { H = await import(pathToFileURL(HELPER_PATH).href); });

const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

// ── Fixture builders ─────────────────────────────────────────────────────────────────────────────────────────────────────

const cpBytes = (revision: number, anchor: DelegationJournalRecordV1 | null, patch: Partial<DelegationCheckpointV1> = {}): Uint8Array =>
  encodeDelegationCheckpoint({
    ...emptyDelegationCheckpoint(),
    revision,
    appliedJournalSequence: anchor?.sequence ?? 0,
    appliedJournalId: anchor?.journalId ?? null,
    appliedJournalDigest: anchor?.digest ?? null,
    pruningHolds: anchor === null ? [] : [{ journalId: anchor.journalId, reason: 'checkpoint-anchor', ownerId: 'checkpoint' }],
    ...patch,
  });

const LEASE_RECORD = (prev: DelegationJournalRecordV1): DelegationJournalRecordV1 => buildDelegationJournalRecord({
  sequence: prev.sequence + 1, acceptedAt: '2026-10-14T00:00:09.000Z', previousDigest: prev.digest,
  entry: {
    kind: 'lease-created', leaseId: 'lease-1', generation: 0, activityId: 'a1'.repeat(32), parentId: 'lane-a-demo', parentIncarnation: 'g1',
    project: 'project-a', adminRecord: 'adm-1', canonicalPath: '/work/p', creationBase: null, sourceKind: DELEGATION_LEASE_SOURCE_KINDS[0],
    correlationJournalIds: [RA.journalId], firstObservedAt: '2026-10-14T00:00:08.000Z', lineageId: 'b2'.repeat(32),
  },
});

/** A chain of `n` evidence records, sequences 1..n, every eventId distinct. */
function chainOf(n: number): DelegationJournalRecordV1[] {
  const out: DelegationJournalRecordV1[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(rec(
      { sequence: i, acceptedAt: '2026-10-14T00:00:05.000Z', previousDigest: i === 1 ? null : out[i - 2]!.digest },
      { ...EVENT_A, eventId: String(i).padStart(64, '0'), startOffset: (i - 1) * 100, endOffset: i * 100 },
    ));
  }
  return out;
}

const mkHome = (): string => {
  const home = mkTmp('ccrc-fx-snap-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  return home;
};
const liveDir = (home: string): string => path.join(home, '.ccrc');
const liveFile = (home: string, name: string): string => path.join(home, '.ccrc', name);
const snapDirOf = (home: string, ts = '20261014-120000'): string => {
  const d = path.join(home, 'ccrc-backups', ts);
  mkdirSync(d, { recursive: true });
  return d;
};

/** A real SQLite database; `extra` adds a table so two databases differ and a `delegation_*` table can be planted. */
function plantDb(file: string, opts: { tables?: string[]; marker?: number } = {}): void {
  rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE fixture (x INTEGER)');
  db.prepare('INSERT INTO fixture VALUES (?)').run(opts.marker ?? 42);
  for (const t of opts.tables ?? []) db.exec(`CREATE TABLE ${t} (id INTEGER)`);
  db.close();
}

interface LiveSet { journal?: Uint8Array | null; checkpoint?: Uint8Array | null; db?: { marker: number; tables?: string[] } | null; wal?: string | null; shm?: string | null }
/** Plants (or removes) the five live members under a fixture home. `undefined` leaves a member alone, `null` removes it. */
function setLive(home: string, set: LiveSet): void {
  const put = (name: string, v: Uint8Array | string | null | undefined): void => {
    if (v === undefined) return;
    if (v === null) rmSync(liveFile(home, name), { force: true });
    else writeFileSync(liveFile(home, name), v);
  };
  put('delegation-events.log', set.journal);
  put('delegation-checkpoint.json', set.checkpoint);
  if (set.db === null) rmSync(liveFile(home, 'coord.db'), { force: true });
  else if (set.db !== undefined) plantDb(liveFile(home, 'coord.db'), set.db);
  put('coord.db-wal', set.wal);
  put('coord.db-shm', set.shm);
}
const FIVE = ['delegation-events.log', 'delegation-checkpoint.json', 'coord.db-wal', 'coord.db-shm', 'coord.db'] as const;
/** The five members' bytes (hex-hashed) or null: a set's identity. */
const liveState = (home: string): Record<string, string | null> =>
  Object.fromEntries(FIVE.map((n) => [n, existsSync(liveFile(home, n)) ? sha(readFileSync(liveFile(home, n))) : null]));
const dirListing = (d: string): string[] => (existsSync(d) ? readdirSync(d).sort() : []);

/** The existing SQLite-only snapshot step, run for real: what `_upd_backup` does before the capture. */
function takeDbSnapshot(home: string, dir: string): void {
  const r = spawnSync(process.execPath, ['--no-warnings', BACKUP_COORD_PATH, liveFile(home, 'coord.db'), path.join(dir, 'coord.db')], { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
}

/** One full snapshot of a live set into a fresh timestamp directory. Returns the directory and the manifest. */
function snapshotOf(home: string, ts = '20261014-120000', opts: { sleep?: (ms: number) => void } = {}): { dir: string; manifest: any } {
  const dir = snapDirOf(home, ts);
  if (existsSync(liveFile(home, 'coord.db'))) takeDbSnapshot(home, dir);
  const manifest = H.capture({ home, dir, sleep: opts.sleep ?? (() => undefined), now: () => new Date('2026-10-14T12:00:00.000Z') });
  return { dir, manifest };
}

// ── A fault-injecting, logging file port over the helper's real one ────────────────────────────────────────────────────

interface FsLog { ops: string[]; mutating: number[] }
/**
 * Wraps `H.realFs`. Every MUTATING operation (create, write, fsync, close of a created file, rename, unlink, mkdir, rmdir, fsyncDir,
 * fsyncFile) is one numbered fault point; reads are logged but are not. `crashAt: k` kills the process at mutating op k: that op
 * and EVERY operation after it (reads and cleanup included) throws, and nothing it was about to do happens. `failOnly: k` fails
 * that one op and lets the rest run (a transient fault). `root` is shortened to `<root>` in the log.
 */
function loggedFs(root: string, opts: { crashAt?: number; failOnly?: number; onRead?: (what: string, p: string) => void } = {}): { fs: any; log: FsLog } {
  const log: FsLog = { ops: [], mutating: [] };
  let counter = 0;
  let dead = false;
  const short = (p: string): string => p.split(root).join('<root>');
  const read = (name: string, p: string): void => {
    if (dead) throw new Error('process is dead');
    log.ops.push(`${name} ${short(p)}`);
    opts.onRead?.(name, p);
  };
  const mutate = (name: string, p: string): void => {
    if (dead) throw new Error('process is dead');
    const i = counter++;
    log.ops.push(`${name} ${short(p)}`);
    log.mutating.push(log.ops.length - 1);
    if (opts.crashAt !== undefined && i >= opts.crashAt) { dead = true; throw new Error(`crash at op ${i}`); }
    if (opts.failOnly === i) throw new Error(`fault at op ${i}`);
  };
  const base = H.realFs;
  const fs = {
    lstat: (p: string) => { read('lstat', p); return base.lstat(p); },
    readFile: (p: string) => { read('readFile', p); return base.readFile(p); },
    openRead: (p: string) => {
      read('openRead', p);
      const h = base.openRead(p);
      if (h === null) return null;
      return { size: h.size, read: (pos: number, len: number) => { read('read', p); return h.read(pos, len); }, close: () => h.close() };
    },
    create: (p: string) => {
      mutate('create', p);
      const h = base.create(p);
      return {
        write: (b: Uint8Array) => { mutate('write', p); h.write(b); },
        fsync: () => { mutate('fsync', p); h.fsync(); },
        close: () => { if (dead) { try { h.close(); } catch { /* released */ } throw new Error('process is dead'); } h.close(); },
      };
    },
    rename: (a: string, b: string) => { mutate('rename', `${short(a)} -> ${short(b)}`); base.rename(a, b); },
    unlink: (p: string) => { mutate('unlink', p); return base.unlink(p); },
    mkdir: (p: string) => { mutate('mkdir', p); base.mkdir(p); },
    rmdir: (p: string) => { mutate('rmdir', p); base.rmdir(p); },
    readdir: (p: string) => { read('readdir', p); return base.readdir(p); },
    fsyncDir: (p: string) => { mutate('fsyncDir', p); base.fsyncDir(p); },
    fsyncFile: (p: string) => { mutate('fsyncFile', p); base.fsyncFile(p); },
  };
  return { fs, log };
}

const outcome = <T>(fn: () => T): { ok: true; value: T } | { ok: false; code: string; message: string } => {
  try { return { ok: true, value: fn() }; } catch (err) {
    if (err instanceof Error && typeof (err as { code?: unknown }).code === 'string') return { ok: false, code: (err as unknown as { code: string }).code, message: err.message };
    if (err instanceof Error) return { ok: false, code: 'ERR', message: err.message };
    throw err;
  }
};

// ═══ The differential set: ONE validation meaning ═══════════════════════════════════════════════════════════════════════
// The helper re-implements the journal validation in plain JS. Every row below feeds the SAME bytes and the SAME expectation to the
// helper's validator and to the server's `validateDelegationJournalBytes`, and requires the same verdict, the same refusal code
// and the same coverage. Mutating either side reds this set (W3-M20 to W3-M24 hold on both sides at once).

type Verdict = { ok: true; coverage: unknown } | { ok: false; code: string };
const serverVerdict = (bytes: Uint8Array, opts: Parameters<typeof validateDelegationJournalBytes>[1]): Verdict => {
  try { return { ok: true, coverage: validateDelegationJournalBytes(bytes, opts) }; } catch (err) {
    if (err instanceof DelegationJournalError) return { ok: false, code: err.code };
    throw err;
  }
};
const helperVerdict = (bytes: Uint8Array, opts: Parameters<typeof validateDelegationJournalBytes>[1]): Verdict => {
  try { return { ok: true, coverage: H.validateJournalBytes(bytes, opts) }; } catch (err) {
    if (err instanceof H.SnapError) return { ok: false, code: (err as { code: string }).code };
    throw err;
  }
};
const bothAgree = (name: string, bytes: Uint8Array, opts: Parameters<typeof validateDelegationJournalBytes>[1] = {}): Verdict => {
  const s = serverVerdict(bytes, opts);
  const h = helperVerdict(bytes, opts);
  expect(h, name).toEqual(s);
  return s;
};

describe('8B: the helper validates a journal exactly as the server does (differential, one meaning)', () => {
  const full = bytesOf(RA, RB, RC);

  it('a valid multi-record journal (evidence and a lease-created entry, multibyte text) is accepted by both, with the same coverage', () => {
    const lease = LEASE_RECORD(RC);
    const v = bothAgree('valid', bytesOf(RA, RB, RC, lease), { completeFromStart: true });
    expect(v).toMatchObject({ ok: true, coverage: { firstSequence: 1, lastSequence: 4, recordCount: 4, copiedEof: { sequence: 4 } } });
    expect(bothAgree('empty', new Uint8Array(0), { completeFromStart: true })).toMatchObject({ ok: true, coverage: { recordCount: 0, copiedEof: null } });
    const big = chainOf(60);
    expect(bothAgree('sixty', bytesOf(...big), { completeFromStart: true })).toMatchObject({ ok: true, coverage: { lastSequence: 60 } });
  });

  it('the helper hashes a record the way the server does: both preimages equal the server\'s and the Python-computed ones', () => {
    for (const [r, f] of [[RA, A], [RB, B], [RC, C]] as const) {
      expect([H.journalIdOf(r), H.digestOf(r)]).toEqual([f.journalId, f.digest]);
    }
    expect(H.canonicalJson({ b: 1, a: [true, null, 'é日本'], '\u00e9': -0 })).toBe('{"a":[true,null,"é日本"],"b":1,"é":0}');
  });

  describe('the anchor triple (W3-M20), the chain input (W3-M21), the sequence table (W3-M23) and held evidence (W3-M24)', () => {
    const anchors: Array<[string, DelegationJournalPosition]> = [
      ['the first record', posOf(RA)], ['the middle record', posOf(RB)], ['the last record', posOf(RC)],
      ['a journalId from another record', { ...posOf(RB), journalId: RA.journalId }],
      ['a flipped journalId', { ...posOf(RB), journalId: 'f'.repeat(64) }],
      ['a digest from another record', { ...posOf(RB), digest: RA.digest }],
      ['a flipped digest', { ...posOf(RB), digest: 'f'.repeat(64) }],
      ['the sequence of the record before', { ...posOf(RB), sequence: 1 }],
      ['a sequence that is another record', { ...posOf(RB), sequence: 3 }],
      ['a sequence past the end', { ...posOf(RC), sequence: 4 }],
      ['a sequence before the start', { ...posOf(RA), sequence: 0 }],
      ['a triple that names no record', { sequence: 4, journalId: 'f'.repeat(64), digest: 'f'.repeat(64) }],
    ];
    for (const [name, anchor] of anchors) it(`anchor: ${name}`, () => { bothAgree(name, full, { anchor }); });
    it('anchor against an empty journal', () => { expect(bothAgree('empty anchored', new Uint8Array(0), { anchor: posOf(RA) })).toEqual({ ok: false, code: 'anchor-missing' }); });

    it('chain input: a record whose previousDigest is not the prior digest; a first record claiming one; hashes that do not match', () => {
      expect(bothAgree('orphan', bytesOf(RA, rec({ ...B, previousDigest: 'd'.repeat(64) }, EVENT_B)))).toEqual({ ok: false, code: 'previous-digest' });
      expect(bothAgree('claimed', bytesOf(rec({ ...A, previousDigest: 'd'.repeat(64) }, EVENT_A)), { completeFromStart: true })).toEqual({ ok: false, code: 'previous-digest' });
      const line = new TextDecoder().decode(encodeDelegationJournalRecord(RB)).trimEnd();
      const first = new TextDecoder().decode(encodeDelegationJournalRecord(RA));
      expect(bothAgree('digest', text(`${first}${line.replace(B.digest, '0'.repeat(64))}\n`))).toEqual({ ok: false, code: 'digest-mismatch' });
      expect(bothAgree('id', text(`${first}${line.replace(`"journalId":"${B.journalId}"`, `"journalId":"${'0'.repeat(64)}"`)}\n`))).toEqual({ ok: false, code: 'journal-id-mismatch' });
      // The digest WITHOUT the chain input is a different, internally consistent record that does not chain.
      const noChain = rec({ ...B, previousDigest: null }, EVENT_B);
      expect(bothAgree('without chain input', bytesOf(RA, noChain))).toEqual({ ok: false, code: 'previous-digest' });
    });

    const at = (sequence: number, previous: DelegationJournalRecordV1 | null): DelegationJournalRecordV1 =>
      rec({ sequence, acceptedAt: '2026-10-14T00:00:05.000Z', previousDigest: previous === null ? null : previous.digest }, { ...EVENT_A, eventId: String(sequence).padStart(64, '0') });
    const r1 = at(1, null); const r2 = at(2, r1); const r3 = at(3, r2);
    const sequences: Array<[string, DelegationJournalRecordV1[], boolean]> = [
      ['1,2,3', [r1, r2, r3], true], ['duplicate 1,2,2', [r1, r2, r2], true], ['repeated first', [r1, r1], true], ['gap 1,3', [r1, at(3, r1)], true],
      ['gap of many', [r1, at(9, r1)], true], ['descent 1,2,3,2', [r1, r2, r3, at(2, r3)], true], ['descent to the start', [r1, r2, at(1, r2)], true],
      ['not from 1 (complete)', [r2, r3], true], ['not from 1 (incomplete)', [r2, r3], false],
    ];
    for (const [name, records, complete] of sequences) it(`sequence: ${name}${complete ? ' (complete)' : ''}`, () => { bothAgree(name, bytesOf(...records), { completeFromStart: complete }); });
    it('sequence 0, negative, a fraction, unsafe and a string, in the record text', () => {
      const line = new TextDecoder().decode(encodeDelegationJournalRecord(r1)).trimEnd();
      for (const bad of ['0', '-1', '1.5', '9007199254740993', '"1"']) bothAgree(`sequence ${bad}`, text(`${line.replace('"sequence":1', `"sequence":${bad}`)}\n`));
    });

    it('held pre-anchor evidence: retained, missing, unknown, at or after the anchor', () => {
      const anchor = posOf(RC);
      expect(bothAgree('retained', full, { anchor, heldJournalIds: [RA.journalId] })).toMatchObject({ ok: true });
      expect(bothAgree('trimmed', bytesOf(RB, RC), { anchor, heldJournalIds: [RA.journalId] })).toEqual({ ok: false, code: 'held-evidence-missing' });
      expect(bothAgree('trimmed, nothing held', bytesOf(RB, RC), { anchor })).toMatchObject({ ok: true });
      expect(bothAgree('unknown', full, { anchor, heldJournalIds: [RA.journalId, 'f'.repeat(64)] })).toEqual({ ok: false, code: 'held-evidence-missing' });
      expect(bothAgree('at the anchor', full, { anchor: posOf(RB), heldJournalIds: [RB.journalId, RC.journalId] })).toMatchObject({ ok: true });
    });
  });

  it('every torn-tail position (W3-M22): the same refusal code at each cut, for a tail of the next record', () => {
    const two = bytesOf(RA, RB);
    const last = encodeDelegationJournalRecord(RC);
    const noLf = last.subarray(0, last.length - 1);
    for (let k = 1; k <= noLf.length; k++) {
      const torn = new Uint8Array(two.length + k);
      torn.set(two, 0); torn.set(noLf.subarray(0, k), two.length);
      const v = bothAgree(`cut ${k}`, torn);
      expect(v, `cut ${k}`).toEqual({ ok: false, code: k === noLf.length ? 'missing-final-lf' : 'torn-tail' });
    }
    expect(bothAgree('bare CR', new Uint8Array([...two, 0x0d]))).toEqual({ ok: false, code: 'torn-tail' });
    expect(bothAgree('fragment only', text('{"a'))).toEqual({ ok: false, code: 'torn-tail' });
    expect(bothAgree('garbage after', new Uint8Array([...two, 0xff, 0xfe]))).toEqual({ ok: false, code: 'torn-tail' });
  });

  it('the grammar: BOM, CRLF, blank line, invalid UTF-8, JSON syntax, duplicate and unknown keys, noncanonical text, bad fields', () => {
    const line = (r: DelegationJournalRecordV1): string => new TextDecoder().decode(encodeDelegationJournalRecord(r)).trimEnd();
    const a = line(RA); const b = line(RB);
    const rows: Array<[string, Uint8Array]> = [
      ['BOM', new Uint8Array([0xef, 0xbb, 0xbf, ...text(`${a}\n`)])],
      ['CRLF', text(`${a}\r\n`)],
      ['blank line', text(`${a}\n\n${b}\n`)],
      ['invalid UTF-8', new Uint8Array([...text(`${a.slice(0, 20)}`), 0xff, ...text(`${a.slice(20)}\n`)])],
      ['not JSON', text('{not json}\n')],
      ['not an object', text('[1]\n')],
      ['duplicate key', text(`${a.replace('{"acceptedAt"', '{"v":1,"acceptedAt"')}\n`)],
      ['unknown key', text(`${a.replace('{"acceptedAt"', '{"zz":1,"acceptedAt"')}\n`)],
      ['missing key', text(`${a.replace(/"digest":"[0-9a-f]{64}"/, '').replace(',}', '}')}\n`)],
      ['pretty-printed', text(`${JSON.stringify(JSON.parse(a), null, 1).replace(/\n/g, ' ')}\n`)],
      ['key order', text(`${JSON.stringify(JSON.parse(a))}\n`)],
      ['v is 2', text(`${a.replace('"v":1', '"v":2')}\n`)],
      ['bad instant', text(`${a.replace('2026-10-14T00:00:01.000Z', '2026-10-14T00:00:01Z')}\n`)],
      ['unknown entry kind', text(`${a.replace('"kind":"evidence-accepted"', '"kind":"surprise"')}\n`)],
      ['lone surrogate escape', text(`${a.replace('"startup"', '"\\ud800"')}\n`)],
      ['unsafe integer', text(`${a.replace('"endOffset":100', '"endOffset":9007199254740993')}\n`)],
      ['negative zero', text(`${a.replace('"startOffset":0', '"startOffset":-0')}\n`)],
      ['no LF at all', text(a)],
    ];
    for (const [name, bytes] of rows) bothAgree(name, bytes);
    // Spot-check that the table is not vacuous: most rows are refusals.
    const refusals = rows.filter(([name, bytes]) => !serverVerdict(bytes, {}).ok && name !== '').length;
    expect(refusals).toBeGreaterThanOrEqual(rows.length - 1);
  });

  it('a lease-created entry: a nonzero generation, a bad hash, a bad base and a good one agree', () => {
    const base = LEASE_RECORD(RC);
    const asLine = (r: DelegationJournalRecordV1): string => new TextDecoder().decode(encodeDelegationJournalRecord(r));
    const good = asLine(base);
    bothAgree('good lease', text(good), {});
    for (const [name, mutate] of [
      ['generation 1', (s: string) => s.replace('"generation":0', '"generation":1')],
      ['activityId not hex', (s: string) => s.replace(`"activityId":"${'a1'.repeat(32)}"`, '"activityId":"xyz"')],
      ['empty leaseId', (s: string) => s.replace('"leaseId":"lease-1"', '"leaseId":""')],
      ['creationBase empty', (s: string) => s.replace('"creationBase":null', '"creationBase":""')],
    ] as const) bothAgree(name, text(`${asLine(RC)}${mutate(good)}`), {});
  });
});

describe('8B: the helper reads a checkpoint exactly as the server does, as far as a snapshot needs (differential)', () => {
  const real = [cpBytes(0, null), cpBytes(7, RC), cpBytes(3, RB, { pruningHolds: [{ journalId: RB.journalId, reason: 'checkpoint-anchor', ownerId: 'c' }, { journalId: RA.journalId, reason: 'identity-candidate', ownerId: 'agent-1' }] })];
  const refusals: Array<[string, Uint8Array]> = (() => {
    const good = new TextDecoder().decode(cpBytes(7, RC));
    return [
      ['BOM', new Uint8Array([0xef, 0xbb, 0xbf, ...text(good)])],
      ['no final LF', text(good.slice(0, -1))],
      ['CRLF', text(`${good.slice(0, -1)}\r\n`)],
      ['not JSON', text('nope\n')],
      ['duplicate key', text(good.replace('{"activities"', '{"v":1,"activities"'))],
      ['noncanonical', text(`${JSON.stringify(JSON.parse(good), null, 1).replace(/\n/g, ' ')}\n`)],
      ['version 2', text(good.replace('"v":1', '"v":2'))],
      ['unknown key', text(good.replace('{"activities"', '{"zz":1,"activities"'))],
      ['anchor sequence without journalId', text(good.replace(`"appliedJournalId":"${RC.journalId}"`, '"appliedJournalId":null'))],
      ['anchor id not hex', text(good.replace(RC.journalId, 'XYZ'))],
      ['negative revision', text(good.replace('"revision":7', '"revision":-1'))],
      ['a list that is an object', text(good.replace('"sessions":[]', '"sessions":{}'))],
    ];
  })();
  it('accepts every checkpoint the server\'s own encoder writes, with the same revision, anchor and holds', () => {
    for (const bytes of real) {
      const server = decodeDelegationCheckpoint(bytes);
      const header = H.readCheckpointHeader(bytes);
      expect(header.revision).toBe(server.revision);
      expect(header.appliedJournalSequence).toBe(server.appliedJournalSequence);
      expect(header.anchor).toEqual(server.appliedJournalId === null ? null : { sequence: server.appliedJournalSequence, journalId: server.appliedJournalId, digest: server.appliedJournalDigest });
      expect(header.heldJournalIds.sort()).toEqual([...new Set(server.pruningHolds.filter((h) => h.reason === 'checkpoint-anchor' || h.reason === 'identity-candidate').map((h) => h.journalId))].sort());
    }
  });
  for (const [name, bytes] of refusals) {
    it(`both refuse: ${name}`, () => {
      const server = outcome(() => decodeDelegationCheckpoint(bytes));
      const helper = outcome(() => H.readCheckpointHeader(bytes));
      expect(server.ok, `the server refuses ${name}`).toBe(false);
      expect(helper, name).toMatchObject({ ok: false, code: (server as { code: string }).code });
    });
  }
  it('the restore marker and file names the helper spells are the ones the server module reads', () => {
    expect(H.RESTORE_MARKER_FILE).toBe(COORDINATION_RESTORE_MARKER_FILE);
    expect(H.JOURNAL_FILE).toBe(DELEGATION_JOURNAL_FILE);
    expect(H.CHECKPOINT_FILE).toBe(DELEGATION_CHECKPOINT_FILE);
    expect(H.MANIFEST_FILE).toBe('coordination-snapshot.json');
  });
});

// ═══ Stable capture (W3-M19, M25, M26, M27) ═════════════════════════════════════════════════════════════════════════════

const J3 = bytesOf(RA, RB, RC);
const CP3 = cpBytes(5, RC);
const captureCli = (home: string, dir: string, extraEnv: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } =>
  spawnSync(process.execPath, ['--no-warnings', HELPER_PATH, 'capture', '--dir', dir], { env: { PATH: process.env['PATH'] ?? '', HOME: home, ...extraEnv }, encoding: 'utf8' });

describe('8B: the manifest names every member and the capture copies them faithfully (W3-M19)', () => {
  it('a full live set yields exactly the journal, the checkpoint, the DB snapshot and the manifest, byte-equal to the live files', () => {
    const home = mkHome();
    setLive(home, { journal: J3, checkpoint: CP3, db: { marker: 1 } });
    const { dir, manifest } = snapshotOf(home);
    expect(dirListing(dir)).toEqual(['coord.db', 'coordination-snapshot.json', 'delegation-checkpoint.json', 'delegation-events.log']);
    expect(readFileSync(path.join(dir, 'delegation-events.log'))).toEqual(Buffer.from(J3));
    expect(readFileSync(path.join(dir, 'delegation-checkpoint.json'))).toEqual(Buffer.from(CP3));
    expect(manifest.members).toEqual({
      delegationJournal: { filename: 'delegation-events.log', present: true, bytes: J3.length, sha256: sha(J3) },
      delegationCheckpoint: { filename: 'delegation-checkpoint.json', present: true, bytes: CP3.length, sha256: sha(CP3) },
      coordDb: { filename: 'coord.db', present: true, bytes: readFileSync(path.join(dir, 'coord.db')).length, sha256: sha(readFileSync(path.join(dir, 'coord.db'))) },
    });
    expect(manifest).toMatchObject({
      format: 'ccrc-coordination-snapshot', version: 1, capturedAt: '2026-10-14T12:00:00.000Z',
      delegation: {
        state: 'initialized', checkpointRevision: 5, anchor: posOf(RC),
        journal: { firstSequence: 1, lastSequence: 3, recordCount: 3, firstPreviousDigest: null, copiedEof: posOf(RC) },
      },
    });
    // The manifest on disk is the canonical encoding of that value, and the directory classifies as v1.
    expect(readFileSync(path.join(dir, 'coordination-snapshot.json'), 'utf8')).toBe(`${H.canonicalJson(manifest)}\n`);
    expect(H.classify({ from: dir })).toMatchObject({ kind: 'v1' });
  });

  it('each member is required: a snapshot missing the journal, the checkpoint, the manifest or the DB is not a valid v1 snapshot', () => {
    const home = mkHome();
    setLive(home, { journal: J3, checkpoint: CP3, db: { marker: 1 } });
    const { dir } = snapshotOf(home);
    const all = ['delegation-events.log', 'delegation-checkpoint.json', 'coord.db', 'coordination-snapshot.json'];
    for (const gone of all) {
      const copy = snapDirOf(home, `2026101${all.indexOf(gone)}-000000`);
      for (const n of all) if (n !== gone) writeFileSync(path.join(copy, n), readFileSync(path.join(dir, n)));
      // Without the manifest the sidecars have no description; without a member the manifest describes something that is not there.
      expect(H.classify({ from: copy }).kind, `without ${gone}`).toBe('invalid');
    }
  });

  it('a box with nothing live (a fleet box) gets a v1 manifest of absent members; a journal alone is revision 0; a checkpoint alone is at sequence 0', () => {
    const home = mkHome();
    const empty = snapshotOf(home, '20261014-000001');
    expect(empty.manifest.members).toEqual({
      delegationJournal: { filename: 'delegation-events.log', present: false },
      delegationCheckpoint: { filename: 'delegation-checkpoint.json', present: false },
      coordDb: { filename: 'coord.db', present: false },
    });
    expect(empty.manifest.delegation).toEqual({ state: 'absent', checkpointRevision: null, anchor: null, journal: null });
    expect(dirListing(empty.dir)).toEqual(['coordination-snapshot.json']);
    expect(H.classify({ from: empty.dir }).kind).toBe('v1');

    setLive(home, { journal: bytesOf(RA) });
    const journalOnly = snapshotOf(home, '20261014-000002');
    expect(journalOnly.manifest.delegation).toMatchObject({ state: 'initialized', checkpointRevision: 0, anchor: null, journal: { recordCount: 1, lastSequence: 1 } });
    expect(journalOnly.manifest.members.delegationCheckpoint).toEqual({ filename: 'delegation-checkpoint.json', present: false });

    setLive(home, { journal: null, checkpoint: cpBytes(2, null) });
    const checkpointOnly = snapshotOf(home, '20261014-000003');
    expect(checkpointOnly.manifest.delegation).toEqual({
      state: 'initialized', checkpointRevision: 2, anchor: null,
      journal: { firstSequence: null, lastSequence: null, recordCount: 0, firstPreviousDigest: null, copiedEof: null },
    });
    expect(H.classify({ from: checkpointOnly.dir }).kind).toBe('v1');
  });

  it('a pre-anchor suffix is validated whole: a checkpoint anchored at record 3 with a hold on record 1 needs record 1 in the copy', () => {
    const home = mkHome();
    const cp = cpBytes(4, RC, { pruningHolds: [{ journalId: RC.journalId, reason: 'checkpoint-anchor', ownerId: 'c' }, { journalId: RA.journalId, reason: 'identity-candidate', ownerId: 'agent-1' }] });
    setLive(home, { journal: J3, checkpoint: cp });
    expect(snapshotOf(home, '20261014-000001').manifest.delegation.journal.recordCount).toBe(3);
    // The live journal lost record 1 (a compaction wave 3 does not ship): the hold on it makes the snapshot refuse.
    setLive(home, { journal: bytesOf(RB, RC) });
    const dir = snapDirOf(home, '20261014-000002');
    expect(outcome(() => H.capture({ home, dir, sleep: () => undefined }))).toMatchObject({ ok: false, code: 'held-evidence-missing' });
    expect(dirListing(dir)).toEqual([]);
  });

  it('refuses, with no manifest and nothing left behind, an anchor no journal record satisfies, an anchored checkpoint with no journal, and a bad checkpoint', () => {
    const home = mkHome();
    const cases: Array<[string, LiveSet, string]> = [
      ['anchor mismatch', { journal: bytesOf(RA, RB), checkpoint: cpBytes(2, RC) }, 'anchor-missing'],
      ['checkpoint anchored, journal absent', { journal: null, checkpoint: cpBytes(2, RC) }, 'anchor-missing'],
      ['checkpoint not canonical', { journal: J3, checkpoint: text('{"v":1}\n') }, 'bad-shape'],
      ['journal not canonical', { journal: text('{"v":1}\n'), checkpoint: null }, 'bad-field'],
      ['checkpoint behind a journal that starts late', { journal: bytesOf(RC), checkpoint: cpBytes(1, RA) }, 'sequence-gap'],
    ];
    cases.forEach(([name, set, code], i) => {
      setLive(home, set);
      const dir = snapDirOf(home, `2026101${i}-000000`);
      expect(outcome(() => H.capture({ home, dir, sleep: () => undefined })), name).toMatchObject({ ok: false, code });
      expect(dirListing(dir), `${name} leaves nothing`).toEqual([]);
    });
  });

  it('refuses a symlinked journal or checkpoint without following it', () => {
    const home = mkHome();
    const elsewhere = path.join(home, 'elsewhere');
    writeFileSync(elsewhere, J3);
    symlinkSync(elsewhere, liveFile(home, 'delegation-events.log'));
    const dir = snapDirOf(home);
    const r = outcome(() => H.capture({ home, dir, sleep: () => undefined }));
    expect(r.ok).toBe(false);
    expect(dirListing(dir)).toEqual([]);
    rmSync(liveFile(home, 'delegation-events.log'));
    symlinkSync(elsewhere, liveFile(home, 'delegation-checkpoint.json'));
    expect(outcome(() => H.capture({ home, dir, sleep: () => undefined })).ok).toBe(false);
    expect(dirListing(dir)).toEqual([]);
  });

  it('expects the SQLite snapshot exactly when the live DB exists, and validates it', () => {
    const home = mkHome();
    setLive(home, { journal: J3, checkpoint: CP3, db: { marker: 1 } });
    const dir = snapDirOf(home);
    expect(outcome(() => H.capture({ home, dir, sleep: () => undefined }))).toMatchObject({ ok: false, code: 'db-snapshot-missing' });
    writeFileSync(path.join(dir, 'coord.db'), 'a text placeholder, not a database\n');
    expect(outcome(() => H.capture({ home, dir, sleep: () => undefined }))).toMatchObject({ ok: false, code: 'db-snapshot-invalid' });
    expect(dirListing(dir)).toEqual(['coord.db']);        // the helper never removes what it did not make
    const home2 = mkHome();
    setLive(home2, { journal: J3, checkpoint: CP3 });
    const dir2 = snapDirOf(home2);
    plantDb(path.join(dir2, 'coord.db'));
    expect(outcome(() => H.capture({ home: home2, dir: dir2, sleep: () => undefined }))).toMatchObject({ ok: false, code: 'db-snapshot-unexpected' });
  });

  it('never writes the DB snapshot it describes, and refuses a directory that already has a manifest or does not exist', () => {
    const home = mkHome();
    setLive(home, { journal: J3, checkpoint: CP3, db: { marker: 1 } });
    const dir = snapDirOf(home);
    takeDbSnapshot(home, dir);
    const before = sha(readFileSync(path.join(dir, 'coord.db')));
    H.capture({ home, dir, sleep: () => undefined });
    expect(sha(readFileSync(path.join(dir, 'coord.db')))).toBe(before);
    expect(outcome(() => H.capture({ home, dir, sleep: () => undefined }))).toMatchObject({ ok: false, code: 'manifest-exists' });
    expect(outcome(() => H.capture({ home, dir: path.join(home, 'no-such-dir'), sleep: () => undefined }))).toMatchObject({ ok: false, code: 'bad-dir' });
  });

  it('the command line: exit 0 with one line, then exit 1 when the directory already holds a manifest, and 70 for bad usage', () => {
    const home = mkHome();
    setLive(home, { journal: J3, checkpoint: CP3 });
    const dir = snapDirOf(home);
    const r = captureCli(home, dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('coordination snapshot: initialized delegation, coord.db absent, manifest written\n');
    expect(captureCli(home, dir).status).toBe(1);
    const usage = spawnSync(process.execPath, ['--no-warnings', HELPER_PATH, 'capture'], { env: { PATH: process.env['PATH'] ?? '', HOME: home }, encoding: 'utf8' });
    expect(usage.status).toBe(70);
    expect(spawnSync(process.execPath, ['--no-warnings', HELPER_PATH, 'bogus'], { env: { HOME: home }, encoding: 'utf8' }).status).toBe(70);
  });
});

describe('8B: capture reads one stable view (W3-M25, W3-M26)', () => {
  it('copies exactly the byte count fstat reports on the opened inode: a record appended while it copies is not in the copy', () => {
    const home = mkHome();
    const four = LEASE_RECORD(RC);
    setLive(home, { journal: J3, checkpoint: CP3 });
    const dir = snapDirOf(home);
    let appended = false;
    const { fs } = loggedFs(home, {
      onRead: (what, p) => {
        if (what === 'read' && p.endsWith('delegation-events.log') && !appended) {
          appended = true;
          writeFileSync(liveFile(home, 'delegation-events.log'), Buffer.concat([Buffer.from(J3), Buffer.from(encodeDelegationJournalRecord(four))]));
        }
      },
    });
    const m = H.capture({ home, dir, fs, sleep: () => undefined, now: () => new Date('2026-10-14T12:00:00.000Z') });
    expect(appended).toBe(true);
    expect(m.delegation.journal).toMatchObject({ lastSequence: 3, recordCount: 3 });
    expect(readFileSync(path.join(dir, 'delegation-events.log'))).toEqual(Buffer.from(J3));
  });

  it('a checkpoint that moves during capture is never accepted (W3-M25): the attempt is retried and the snapshot carries the settled checkpoint', () => {
    const home = mkHome();
    setLive(home, { journal: J3, checkpoint: cpBytes(5, RC) });
    const dir = snapDirOf(home);
    const sleeps: number[] = [];
    let seen = 0;
    const m = H.capture({
      home, dir, sleep: (ms: number) => sleeps.push(ms), now: () => new Date('2026-10-14T12:00:00.000Z'),
      hooks: { afterJournalCopy: () => { seen++; if (seen === 1) writeFileSync(liveFile(home, 'delegation-checkpoint.json'), cpBytes(6, RC)); } },
    });
    expect(seen).toBe(2);
    expect(sleeps).toEqual([10]);
    expect(m.delegation.checkpointRevision).toBe(6);
    expect(readFileSync(path.join(dir, 'delegation-checkpoint.json'))).toEqual(Buffer.from(readFileSync(liveFile(home, 'delegation-checkpoint.json'))));
  });

  it('a checkpoint that appears, or disappears, between the two reads counts as moved', () => {
    const home = mkHome();
    setLive(home, { journal: bytesOf(RA), checkpoint: null });
    const dir = snapDirOf(home);
    let seen = 0;
    const m = H.capture({
      home, dir, sleep: () => undefined,
      hooks: { afterJournalCopy: () => { seen++; if (seen === 1) writeFileSync(liveFile(home, 'delegation-checkpoint.json'), cpBytes(1, RA)); } },
    });
    expect(seen).toBe(2);
    expect(m.delegation).toMatchObject({ checkpointRevision: 1, anchor: posOf(RA) });
  });

  it('a torn tail (a writer mid-append) is retried; it is accepted only once it is whole', () => {
    const home = mkHome();
    const whole = bytesOf(RA, RB);
    const torn = new Uint8Array([...bytesOf(RA), ...encodeDelegationJournalRecord(RB).subarray(0, 40)]);
    setLive(home, { journal: torn, checkpoint: cpBytes(1, RA) });
    const dir = snapDirOf(home);
    const sleeps: number[] = [];
    let seen = 0;
    const m = H.capture({
      home, dir, sleep: (ms: number) => sleeps.push(ms),
      hooks: { afterJournalCopy: () => { seen++; if (seen === 1) writeFileSync(liveFile(home, 'delegation-events.log'), whole); } },
    });
    expect(sleeps).toEqual([10]);
    expect(m.delegation.journal.lastSequence).toBe(2);
  });

  it('exactly FIVE attempts with 10, 25, 50 and 100 ms between them (W3-M26), then exhaustion: no manifest, nothing left, an error', () => {
    const home = mkHome();
    setLive(home, { journal: J3, checkpoint: cpBytes(1, RC) });
    const dir = snapDirOf(home);
    const sleeps: number[] = [];
    let attempts = 0;
    const r = outcome(() => H.capture({
      home, dir, sleep: (ms: number) => sleeps.push(ms),
      hooks: { afterJournalCopy: () => { attempts++; writeFileSync(liveFile(home, 'delegation-checkpoint.json'), cpBytes(100 + attempts, RC)); } },
    }));
    expect(r).toMatchObject({ ok: false, code: 'capture-exhausted' });
    expect(attempts).toBe(5);
    expect(sleeps).toEqual([10, 25, 50, 100]);
    expect(H.CAPTURE_RETRY_DELAYS_MS).toEqual([10, 25, 50, 100]);
    expect(dirListing(dir)).toEqual([]);
  });

  it('succeeds on the fifth attempt and not before when only the first four move', () => {
    const home = mkHome();
    setLive(home, { journal: J3, checkpoint: cpBytes(1, RC) });
    const dir = snapDirOf(home);
    const sleeps: number[] = [];
    let attempts = 0;
    const m = H.capture({
      home, dir, sleep: (ms: number) => sleeps.push(ms),
      hooks: { afterJournalCopy: () => { attempts++; if (attempts <= 4) writeFileSync(liveFile(home, 'delegation-checkpoint.json'), cpBytes(10 + attempts, RC)); } },
    });
    expect(attempts).toBe(5);
    expect(sleeps).toEqual([10, 25, 50, 100]);
    expect(m.delegation.checkpointRevision).toBe(14);
  });

  it('a persistent refusal (not a race) is not retried: one attempt, no sleep', () => {
    const home = mkHome();
    setLive(home, { journal: bytesOf(RA, RB), checkpoint: cpBytes(2, RC) });
    const dir = snapDirOf(home);
    const sleeps: number[] = [];
    expect(outcome(() => H.capture({ home, dir, sleep: (ms: number) => sleeps.push(ms) }))).toMatchObject({ ok: false, code: 'anchor-missing' });
    expect(sleeps).toEqual([]);
  });
});

describe('8B: the manifest is written last, after every member is durable (W3-M27)', () => {
  const liveWithEverything = (): string => {
    const home = mkHome();
    setLive(home, { journal: J3, checkpoint: CP3, db: { marker: 1 } });
    return home;
  };
  const run = (home: string, dir: string, opts: { crashAt?: number; failOnly?: number } = {}): { error: Error | null; log: FsLog } => {
    const { fs, log } = loggedFs(home, opts);
    try { H.capture({ home, dir, fs, sleep: () => undefined }); return { error: null, log }; } catch (err) { return { error: err as Error, log }; }
  };

  it('in the operation log the manifest is the last file created and its rename follows every member fsync, the DB fsync and the directory fsync', () => {
    const home = liveWithEverything();
    const dir = snapDirOf(home);
    takeDbSnapshot(home, dir);
    const { error, log } = run(home, dir);
    expect(error).toBeNull();
    const ops = log.ops;
    const idx = (needle: string, from = 0): number => ops.findIndex((o, i) => i >= from && o.includes(needle));
    const manifestCreate = idx('create <root>/ccrc-backups/20261014-120000/coordination-snapshot.json.partial');
    const manifestRename = idx('rename <root>/ccrc-backups/20261014-120000/coordination-snapshot.json.partial');
    expect(manifestCreate).toBeGreaterThan(-1);
    expect(manifestRename).toBeGreaterThan(manifestCreate);
    const before = ops.slice(0, manifestCreate);
    for (const needle of [
      'fsync <root>/ccrc-backups/20261014-120000/delegation-events.log.partial',
      'fsync <root>/ccrc-backups/20261014-120000/delegation-checkpoint.json.partial',
      'rename <root>/ccrc-backups/20261014-120000/delegation-events.log.partial',
      'rename <root>/ccrc-backups/20261014-120000/delegation-checkpoint.json.partial',
      'fsyncFile <root>/ccrc-backups/20261014-120000/coord.db',
      'fsyncDir <root>/ccrc-backups/20261014-120000',
    ]) expect(before.some((o) => o.startsWith(needle)), `${needle} precedes the manifest`).toBe(true);
    expect(ops.slice(manifestCreate).filter((o) => o.startsWith('create '))).toHaveLength(1);
    // And the manifest is made durable itself: fsync of its partial, then the rename, then the directory.
    expect(ops.slice(manifestCreate, manifestRename).some((o) => o.startsWith('fsync <root>/ccrc-backups/20261014-120000/coordination-snapshot.json.partial'))).toBe(true);
    expect(ops.slice(manifestRename).some((o) => o.startsWith('fsyncDir <root>/ccrc-backups/20261014-120000'))).toBe(true);
  });

  it('a crash at EVERY operation leaves either no manifest or a snapshot that classifies v1: a manifest is never visible before its members', () => {
    const probeHome = liveWithEverything();
    const probeDir = snapDirOf(probeHome);
    takeDbSnapshot(probeHome, probeDir);
    const total = run(probeHome, probeDir).log.mutating.length;
    expect(total).toBeGreaterThanOrEqual(15);
    for (let k = 0; k < total; k++) {
      const home = liveWithEverything();
      const dir = snapDirOf(home);
      takeDbSnapshot(home, dir);
      const { error } = run(home, dir, { crashAt: k });
      expect(error, `crash at ${k}`).not.toBeNull();
      if (existsSync(path.join(dir, 'coordination-snapshot.json'))) {
        expect(H.classify({ from: dir }), `a manifest after a crash at ${k}`).toMatchObject({ kind: 'v1' });
      } else {
        expect(H.classify({ from: dir }).kind, `no manifest after a crash at ${k}`).not.toBe('v1');
      }
    }
  });

  it('a failed fsync of any member or of the DB snapshot leaves no manifest and no helper-owned file, and the run reports it', () => {
    const probeHome = liveWithEverything();
    const probeDir = snapDirOf(probeHome);
    takeDbSnapshot(probeHome, probeDir);
    const probe = run(probeHome, probeDir);
    const fsyncOps = probe.log.mutating.map((i) => ({ i, op: probe.log.ops[i]! })).filter((x) => x.op.startsWith('fsync'));
    expect(fsyncOps.length).toBeGreaterThanOrEqual(5);
    let n = 0;
    for (const [k, i] of probe.log.mutating.entries()) {
      if (!probe.log.ops[i]!.startsWith('fsync')) continue;
      const home = liveWithEverything();
      const dir = snapDirOf(home);
      takeDbSnapshot(home, dir);
      const { error } = run(home, dir, { failOnly: k });
      expect(error?.message, `fault at op ${k}`).toMatch(/fault at op/);
      // A fault after the manifest was renamed into place (its own directory fsync) removes the manifest too: no description of removed members.
      expect(dirListing(dir).filter((f) => f !== 'coord.db'), `fault at op ${k}`).toEqual([]);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(5);
  });
});

// ═══ The classifier (W3-M29, W3-M30) ════════════════════════════════════════════════════════════════════════════════════

const classifyCli = (dir: string, verb = 'classify'): { status: number | null; stdout: string; stderr: string } =>
  spawnSync(process.execPath, ['--no-warnings', HELPER_PATH, verb, '--from', dir], { env: { PATH: process.env['PATH'] ?? '' }, encoding: 'utf8' });

describe('8B: classify and validate: v1, legacy, none, invalid (W3-M29, W3-M30)', () => {
  const fullSnapshot = (): { home: string; dir: string } => {
    const home = mkHome();
    setLive(home, { journal: J3, checkpoint: CP3, db: { marker: 1 } });
    return { home, dir: snapshotOf(home).dir };
  };

  it('v1: a valid manifest and everything it names; also with an absent DB; output and exit codes through the command line', () => {
    const { dir } = fullSnapshot();
    expect(classifyCli(dir)).toMatchObject({ status: 0, stdout: 'v1\n' });
    const v = classifyCli(dir, 'validate');
    expect(v.status).toBe(0);
    expect(v.stdout).toMatch(/^v1: a valid manifest, initialized delegation, coord\.db present\ndata: yes\n$/);
    const home = mkHome();
    setLive(home, { journal: J3, checkpoint: CP3 });
    const noDb = snapshotOf(home);
    expect(noDb.manifest.members.coordDb.present).toBe(false);
    expect(classifyCli(noDb.dir)).toMatchObject({ status: 0, stdout: 'v1\n' });
  });

  it('validate\'s second line says whether the snapshot holds data: a v1 with any member present and a legacy one do; an empty v1, none and invalid do not', () => {
    const dataOf = (dir: string): string => classifyCli(dir, 'validate').stdout.split('\n')[1]!;
    const home = mkHome();
    setLive(home, { journal: J3, checkpoint: CP3, db: { marker: 1 } });
    expect(dataOf(snapshotOf(home, '20261014-000001').dir)).toBe('data: yes');
    setLive(home, { journal: null, checkpoint: cpBytes(2, null), db: null });
    expect(dataOf(snapshotOf(home, '20261014-000002').dir)).toBe('data: yes');                 // a sidecar alone
    setLive(home, { journal: null, checkpoint: null, db: { marker: 3 } });
    expect(dataOf(snapshotOf(home, '20261014-000003').dir)).toBe('data: yes');                 // a DB alone
    setLive(home, { journal: null, checkpoint: null, db: null });
    const empty = snapshotOf(home, '20261014-000004');
    expect(empty.manifest.members.coordDb.present).toBe(false);
    expect(classifyCli(empty.dir)).toMatchObject({ status: 0, stdout: 'v1\n' });
    expect(dataOf(empty.dir)).toBe('data: no');                                                  // valid, and empty
    const legacy = snapDirOf(home, '20261014-000005');
    plantDb(path.join(legacy, 'coord.db'), { tables: ['claims'] });
    expect(dataOf(legacy)).toBe('data: yes');
    expect(dataOf(snapDirOf(home, '20261014-000006'))).toBe('data: no');                         // none
    writeFileSync(path.join(legacy, 'coordination-snapshot.json'), '{');
    expect(dataOf(legacy)).toBe('data: no');                                                     // invalid
    // The four words and their exits are what they were; `data` is only ever a second line of `validate`.
    expect(classifyCli(legacy)).toMatchObject({ status: 2, stdout: 'invalid\n' });
  });

  it('no manifest, no sidecars, a valid DB without delegation_* tables is legacy (exit 0)', () => {
    const home = mkHome();
    const dir = snapDirOf(home);
    plantDb(path.join(dir, 'coord.db'), { tables: ['claims', 'mail'] });
    expect(H.classify({ from: dir })).toMatchObject({ kind: 'legacy' });
    expect(classifyCli(dir)).toMatchObject({ status: 0, stdout: 'legacy\n' });
  });

  it('a manifest-less DB that HOLDS a delegation_* table is NOT legacy (W3-M30): it is invalid, exit 2', () => {
    const home = mkHome();
    for (const table of ['delegation_sessions', 'delegation_leases', 'delegation_events']) {
      const dir = snapDirOf(home, `${table.length}0261014-120000`);
      plantDb(path.join(dir, 'coord.db'), { tables: ['claims', table] });
      expect(H.classify({ from: dir }), table).toMatchObject({ kind: 'invalid' });
      expect(classifyCli(dir), table).toMatchObject({ status: 2, stdout: 'invalid\n' });
    }
  });

  it('none (exit 1): an empty directory, a tree-only backup, and a directory with only stray files', () => {
    const home = mkHome();
    const empty = snapDirOf(home, '20261014-000001');
    expect(classifyCli(empty)).toMatchObject({ status: 1, stdout: 'none\n' });
    const tree = snapDirOf(home, '20261014-000002');
    mkdirSync(path.join(tree, 'agent-dist'));
    writeFileSync(path.join(tree, 'ccd'), '#!/bin/sh\n');
    expect(H.classify({ from: tree }).kind).toBe('none');
    expect(classifyCli(path.join(home, 'no-such-dir')).status).toBe(2);
  });

  it('sidecars without a manifest are invalid, and so is a DB that is not a database', () => {
    const home = mkHome();
    const a = snapDirOf(home, '20261014-000001');
    writeFileSync(path.join(a, 'delegation-events.log'), J3);
    expect(H.classify({ from: a }).kind).toBe('invalid');
    const b = snapDirOf(home, '20261014-000002');
    writeFileSync(path.join(b, 'delegation-checkpoint.json'), CP3);
    plantDb(path.join(b, 'coord.db'));
    expect(H.classify({ from: b }).kind).toBe('invalid');
    const c = snapDirOf(home, '20261014-000003');
    writeFileSync(path.join(c, 'coord.db'), 'fixture coord.db snapshot\n');
    expect(H.classify({ from: c })).toMatchObject({ kind: 'invalid' });
  });

  describe('a PRESENT invalid manifest never falls back to the healthy DB beside it (W3-M29)', () => {
    type Tamper = (dir: string) => void;
    const manifestPath = (dir: string): string => path.join(dir, 'coordination-snapshot.json');
    const editManifest = (dir: string, edit: (m: any) => void): void => {
      const m = JSON.parse(readFileSync(manifestPath(dir), 'utf8'));
      edit(m);
      writeFileSync(manifestPath(dir), `${H.canonicalJson(m)}\n`);
    };
    const tampers: Array<[string, Tamper]> = [
      ['manifest is truncated JSON', (d) => writeFileSync(manifestPath(d), readFileSync(manifestPath(d)).subarray(0, 40))],
      ['manifest is empty', (d) => writeFileSync(manifestPath(d), '')],
      ['manifest is not canonical', (d) => writeFileSync(manifestPath(d), `${JSON.stringify(JSON.parse(readFileSync(manifestPath(d), 'utf8')), null, 2)}\n`)],
      ['manifest is a directory', (d) => { rmSync(manifestPath(d)); mkdirSync(manifestPath(d)); }],
      ['manifest is a symlink', (d) => { const real = path.join(d, 'real.json'); writeFileSync(real, readFileSync(manifestPath(d))); rmSync(manifestPath(d)); symlinkSync(real, manifestPath(d)); }],
      ['wrong format', (d) => editManifest(d, (m) => { m.format = 'something-else'; })],
      ['version 2', (d) => editManifest(d, (m) => { m.version = 2; })],
      ['unknown top-level key', (d) => editManifest(d, (m) => { m.extra = 1; })],
      ['journal size lies', (d) => editManifest(d, (m) => { m.members.delegationJournal.bytes += 1; })],
      ['journal hash lies', (d) => editManifest(d, (m) => { m.members.delegationJournal.sha256 = 'f'.repeat(64); })],
      ['checkpoint hash lies', (d) => editManifest(d, (m) => { m.members.delegationCheckpoint.sha256 = 'f'.repeat(64); })],
      ['DB hash lies', (d) => editManifest(d, (m) => { m.members.coordDb.sha256 = 'f'.repeat(64); })],
      ['manifest says the journal is absent but it is there', (d) => editManifest(d, (m) => { m.members.delegationJournal = { filename: 'delegation-events.log', present: false }; })],
      ['a member filename is wrong', (d) => editManifest(d, (m) => { m.members.coordDb.filename = 'other.db'; })],
      ['delegation section lies about the anchor', (d) => editManifest(d, (m) => { m.delegation.anchor.sequence = 2; })],
      ['delegation section lies about the revision', (d) => editManifest(d, (m) => { m.delegation.checkpointRevision = 99; })],
      ['delegation section lies about coverage', (d) => editManifest(d, (m) => { m.delegation.journal.recordCount = 2; })],
      ['delegation says absent but sidecars exist', (d) => editManifest(d, (m) => { m.delegation = { state: 'absent', checkpointRevision: null, anchor: null, journal: null }; })],
      ['a member file was edited after the manifest', (d) => writeFileSync(path.join(d, 'delegation-events.log'), Buffer.concat([readFileSync(path.join(d, 'delegation-events.log')), Buffer.from('\n')]))],
      ['the journal lost its last LF', (d) => writeFileSync(path.join(d, 'delegation-events.log'), readFileSync(path.join(d, 'delegation-events.log')).subarray(0, -1))],
      ['a member file is missing', (d) => rmSync(path.join(d, 'delegation-checkpoint.json'))],
      ['the DB is replaced by a text file', (d) => writeFileSync(path.join(d, 'coord.db'), 'fixture coord.db snapshot\n')],
      ['an undeclared sidecar appears beside an absent-sidecar manifest', (d) => { editManifest(d, (m) => { m.members.delegationCheckpoint = { filename: 'delegation-checkpoint.json', present: false }; }); }],
    ];
    for (const [name, tamper] of tampers) {
      it(`${name}: invalid, exit 2, and the DB beside it (valid, no delegation tables) is not used instead`, () => {
        const { dir } = fullSnapshot();
        // The DB stays a healthy legacy-shaped DB unless the row itself damages it.
        tamper(dir);
        expect(H.classify({ from: dir }).kind).toBe('invalid');
        expect(classifyCli(dir)).toMatchObject({ status: 2, stdout: 'invalid\n' });
        expect(classifyCli(dir, 'validate').stdout).toMatch(/^invalid: .*\ndata: no\n$/);
      });
    }
    it('even a manifest that cannot be parsed at all, beside a perfectly healthy legacy DB, is invalid and never legacy', () => {
      const home = mkHome();
      const dir = snapDirOf(home);
      plantDb(path.join(dir, 'coord.db'), { tables: ['claims'] });
      expect(H.classify({ from: dir }).kind).toBe('legacy');
      writeFileSync(path.join(dir, 'coordination-snapshot.json'), '{"format":');
      expect(H.classify({ from: dir }).kind).toBe('invalid');
    });
  });

  it('a snapshot with sidecars and NO coord.db (the live DB was absent) is a valid v1 snapshot (W3-M28, helper side)', () => {
    const home = mkHome();
    setLive(home, { journal: J3, checkpoint: CP3, db: null });
    const { dir } = snapshotOf(home);
    expect(dirListing(dir)).toEqual(['coordination-snapshot.json', 'delegation-checkpoint.json', 'delegation-events.log']);
    expect(classifyCli(dir)).toMatchObject({ status: 0, stdout: 'v1\n' });
  });

  it('usage and helper failures are 70, never one of the classifier answers', () => {
    expect(spawnSync(process.execPath, ['--no-warnings', HELPER_PATH, 'classify'], { encoding: 'utf8' }).status).toBe(70);
    expect(spawnSync(process.execPath, ['--no-warnings', HELPER_PATH, 'classify', '--from'], { encoding: 'utf8' }).status).toBe(70);
    expect(spawnSync(process.execPath, ['--no-warnings', HELPER_PATH, 'classify', '--from', 'a', 'b'], { encoding: 'utf8' }).status).toBe(70);
    expect(spawnSync(process.execPath, ['--no-warnings', HELPER_PATH], { encoding: 'utf8' }).status).toBe(70);
  });
});

// ═══ Transactional restore and its recovery (W3-M33 to M37) ═════════════════════════════════════════════════════════════

const J2 = bytesOf(RA, RB);
const CP2 = cpBytes(3, RB);
type Five = Record<string, string | null>;

function buildRestoreFixture(): { home: string; dir: string; oldState: Five; newState: Five } {
  const home = mkHome();
  setLive(home, { journal: J3, checkpoint: CP3, db: { marker: 2 }, wal: null, shm: null });
  const { dir } = snapshotOf(home);
  const newState: Five = {
    'delegation-events.log': sha(J3), 'delegation-checkpoint.json': sha(CP3), 'coord.db-wal': null, 'coord.db-shm': null,
    'coord.db': sha(readFileSync(path.join(dir, 'coord.db'))),
  };
  setLive(home, { journal: J2, checkpoint: CP2, db: { marker: 1 }, wal: 'old wal bytes', shm: 'old shm bytes' });
  return { home, dir, oldState: liveState(home), newState };
}
let restoreTemplate: ReturnType<typeof buildRestoreFixture> | null = null;
/** A fixture home that holds an OLD live set (all five members) and a VALID v1 snapshot of a NEW one. Built once; every call is a copy. */
function restoreFixture(): { home: string; dir: string; oldState: Five; newState: Five } {
  restoreTemplate ??= buildRestoreFixture();
  const home = mkTmp('ccrc-fx-snap-');
  cpSync(restoreTemplate.home, home, { recursive: true });
  return { home, dir: path.join(home, path.relative(restoreTemplate.home, restoreTemplate.dir)), oldState: restoreTemplate.oldState, newState: restoreTemplate.newState };
}
const inactive = (): string => 'inactive';
/** One clean restore on a fresh fixture: where the two marker publications sit among the mutating operations, and the whole log. */
function cleanRestoreRun(): { total: number; replacingAt: number; committedAt: number; ops: string[] } {
  const { home, dir } = restoreFixture();
  const { fs, log } = loggedFs(home);
  H.restore({ home, from: dir, fs, probe: inactive });
  const markerRenames = log.mutating.map((p, i) => ({ i, op: log.ops[p]! })).filter((x) => /^rename .*coordination-restore\.json\.partial -> /.test(x.op));
  return { total: log.mutating.length, replacingAt: markerRenames[0]!.i, committedAt: markerRenames[1]!.i, ops: log.ops };
}
const NO_MUTATION = new Set(['lstat', 'readFile', 'openRead', 'read', 'readdir']);

describe('8B: restore requires the service MEASURED inactive (W3-M34)', () => {
  const table: Array<[string, string, boolean]> = [
    ['inactive', 'inactive', true], ['active', 'active', false], ['unmeasured', 'unmeasured', false], ['an unknown word', 'bogus', false],
  ];
  for (const [name, state, ok] of table) {
    it(`probe says ${name}: ${ok ? 'the restore proceeds' : 'refused before any live mutation'}`, () => {
      const { home, dir, oldState, newState } = restoreFixture();
      const { fs, log } = loggedFs(home);
      const r = outcome(() => H.restore({ home, from: dir, fs, probe: () => state }));
      if (ok) {
        expect(r.ok).toBe(true);
        expect(liveState(home)).toEqual(newState);
      } else {
        expect(r).toMatchObject({ ok: false, code: 'service-not-inactive' });
        expect(liveState(home)).toEqual(oldState);
        expect(log.ops.filter((o) => !NO_MUTATION.has(o.split(' ')[0]!)), 'no mutating operation').toEqual([]);
        expect(dirListing(liveDir(home)).filter((n) => /restore/.test(n))).toEqual([]);
      }
    });
  }
  it('recover is held to the same rule', () => {
    const { home, dir, oldState } = restoreFixture();
    const { fs } = loggedFs(home, { crashAt: cleanRestoreRun().replacingAt + 3 });   // the replacing marker is durable, the old set is not yet back
    outcome(() => H.restore({ home, from: dir, fs, probe: inactive }));
    expect(existsSync(liveFile(home, 'coordination-restore.json')) || existsSync(liveFile(home, 'coordination-restore.stage'))).toBe(true);
    for (const state of ['active', 'unmeasured']) {
      expect(outcome(() => H.recover({ home, probe: () => state })), state).toMatchObject({ ok: false, code: 'service-not-inactive' });
    }
    expect(outcome(() => H.recover({ home, probe: inactive }))).toMatchObject({ ok: true, value: 'rolled-back' });
    expect(liveState(home)).toEqual(oldState);
  });

  it('the service is measured AGAIN once the marker is durable: a unit that started in between refuses the restore, which puts nothing aside and clears its marker', () => {
    for (const second of ['active', 'unmeasured']) {
      const f = restoreFixture();
      const answers = ['inactive', second];
      let asked = 0;
      const { fs, log } = loggedFs(f.home);
      const r = outcome(() => H.restore({ home: f.home, from: f.dir, fs, probe: () => { asked++; return answers.shift() ?? 'active'; } }));
      expect(r, second).toMatchObject({ ok: false, code: 'service-not-inactive' });
      expect(asked, 'the probe ran twice').toBe(2);
      expect(liveState(f.home), second).toEqual(f.oldState);
      expect(dirListing(liveDir(f.home)).filter((n) => /restore/.test(n)), second).toEqual([]);
      // The marker WAS published (the second probe comes after it), and no live member was renamed before the refusal.
      const markerAt = log.ops.findIndex((o) => /^rename .*coordination-restore\.json\.partial -> /.test(o));
      expect(markerAt).toBeGreaterThan(-1);
      expect(log.ops.slice(0, markerAt + 1).some((o) => /^rename <root>\/\.ccrc\/(coord\.db|delegation-)/.test(o))).toBe(false);
    }
  });

  describe('through the command line, with a fake systemctl on a private PATH', () => {
    const bin = (home: string): string => {
      const b = path.join(home, 'bin');
      mkdirSync(b, { recursive: true });
      writeFileSync(path.join(b, 'systemctl'), '#!/bin/sh\n[ "$1 $2 $3" = "--user is-active ccrc.service" ] || { echo "unexpected: $*" >&2; exit 64; }\nprintf "%s\\n" "$FAKE_STATE"\nexit "${FAKE_RC:-0}"\n');
      chmodSync(path.join(b, 'systemctl'), 0o755);
      return b;
    };
    const restoreCli = (home: string, dir: string, env: NodeJS.ProcessEnv): { status: number | null; stdout: string; stderr: string } =>
      spawnSync(process.execPath, ['--no-warnings', HELPER_PATH, 'restore', '--from', dir], { env: { HOME: home, ...env }, encoding: 'utf8' });
    const rows: Array<[string, NodeJS.ProcessEnv, number]> = [
      ['inactive (exit 3)', { FAKE_STATE: 'inactive', FAKE_RC: '3' }, 0],
      ['failed (not running)', { FAKE_STATE: 'failed', FAKE_RC: '3' }, 0],
      ['active', { FAKE_STATE: 'active', FAKE_RC: '0' }, 2],
      ['activating', { FAKE_STATE: 'activating', FAKE_RC: '3' }, 2],
      ['deactivating', { FAKE_STATE: 'deactivating', FAKE_RC: '3' }, 2],
      ['garbage output', { FAKE_STATE: 'who knows', FAKE_RC: '0' }, 2],
      ['no output at all', { FAKE_STATE: '', FAKE_RC: '1' }, 2],
    ];
    for (const [name, env, status] of rows) {
      it(`systemctl says ${name}: exit ${status}`, () => {
        const { home, dir, oldState, newState } = restoreFixture();
        const r = restoreCli(home, dir, { PATH: bin(home), ...env });
        expect(r.status, r.stderr).toBe(status);
        expect(liveState(home)).toEqual(status === 0 ? newState : oldState);
      });
    }
    it('no systemctl at all is unmeasurable and refuses', () => {
      const { home, dir, oldState } = restoreFixture();
      const empty = path.join(home, 'empty-path');
      mkdirSync(empty);
      const r = restoreCli(home, dir, { PATH: empty });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/could not be measured as inactive/);
      expect(liveState(home)).toEqual(oldState);
    });
    it('a systemctl that says inactive on the first call and active on the second refuses with exit 2 and leaves the live set alone', () => {
      const { home, dir, oldState } = restoreFixture();
      const b = path.join(home, 'bin2');
      mkdirSync(b);
      writeFileSync(path.join(b, 'systemctl'), '#!/bin/sh\nif [ -f "$HOME/probed-once" ]; then echo active; exit 0; fi\n: > "$HOME/probed-once"\necho inactive\nexit 3\n');
      chmodSync(path.join(b, 'systemctl'), 0o755);
      const r = restoreCli(home, dir, { PATH: b });
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toMatch(/ccrc\.service is running/);
      expect(liveState(home)).toEqual(oldState);
      expect(dirListing(liveDir(home)).filter((n) => /restore/.test(n))).toEqual([]);
    });
    it('probeService reads the same words', () => {
      const home = mkHome();
      const b = bin(home);
      expect(H.probeService({ PATH: b, FAKE_STATE: 'inactive', FAKE_RC: '3' })).toBe('inactive');
      expect(H.probeService({ PATH: b, FAKE_STATE: 'active' })).toBe('active');
      expect(H.probeService({ PATH: b, FAKE_STATE: 'reloading' })).toBe('active');
      expect(H.probeService({ PATH: b, FAKE_STATE: 'nonsense' })).toBe('unmeasured');
      expect(H.probeService({ PATH: path.join(home, 'nowhere') })).toBe('unmeasured');
    });
  });
});

describe('8B: restore validates the source BEFORE it mutates anything live (W3-M33)', () => {
  const sources: Array<[string, (dir: string) => void]> = [
    ['a member whose bytes changed', (d) => writeFileSync(path.join(d, 'delegation-events.log'), Buffer.concat([readFileSync(path.join(d, 'delegation-events.log')), Buffer.from('x')]))],
    ['the manifest removed', (d) => rmSync(path.join(d, 'coordination-snapshot.json'))],
    ['a manifest that is not JSON', (d) => writeFileSync(path.join(d, 'coordination-snapshot.json'), 'nope\n')],
    ['the checkpoint removed', (d) => rmSync(path.join(d, 'delegation-checkpoint.json'))],
    ['the DB replaced by text', (d) => writeFileSync(path.join(d, 'coord.db'), 'text, not a database')],
    ['an empty directory (none)', (d) => { for (const f of readdirSync(d)) rmSync(path.join(d, f)); }],
    ['a legacy snapshot (a bare DB)', (d) => { for (const f of readdirSync(d)) if (f !== 'coord.db') rmSync(path.join(d, f)); }],
  ];
  for (const [name, tamper] of sources) {
    it(`${name}: refused with a source error, live files untouched, no staging, and the service was not even asked`, () => {
      const { home, dir, oldState } = restoreFixture();
      tamper(dir);
      const { fs, log } = loggedFs(home);
      let asked = 0;
      const r = outcome(() => H.restore({ home, from: dir, fs, probe: () => { asked++; return 'inactive'; } }));
      expect(r).toMatchObject({ ok: false, code: 'source-invalid' });
      expect(liveState(home)).toEqual(oldState);
      expect(log.ops.filter((o) => !NO_MUTATION.has(o.split(' ')[0]!)), 'no mutating operation').toEqual([]);
      expect(dirListing(liveDir(home)).sort()).toEqual(['coord.db', 'coord.db-shm', 'coord.db-wal', 'delegation-checkpoint.json', 'delegation-events.log']);
      expect(asked).toBe(0);
    });
  }
  it('the command line exits 2 for each refusal and leaves the live set alone', () => {
    const { home, dir, oldState } = restoreFixture();
    writeFileSync(path.join(dir, 'delegation-events.log'), 'tampered');
    const r = spawnSync(process.execPath, ['--no-warnings', HELPER_PATH, 'restore', '--from', dir], { env: { HOME: home, PATH: '' }, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(liveState(home)).toEqual(oldState);
  });
});

describe('8B: a restore replaces the five-member set as one unit', () => {
  it('journal, checkpoint and DB become the snapshot\'s, the old WAL and SHM are gone, and nothing is left behind', () => {
    const { home, dir, newState } = restoreFixture();
    const r = H.restore({ home, from: dir, probe: inactive });
    expect(r.restored.sort()).toEqual(['coord.db', 'delegation-checkpoint.json', 'delegation-events.log']);
    expect(r.removed.sort()).toEqual(['coord.db-shm', 'coord.db-wal']);
    expect(liveState(home)).toEqual(newState);
    expect(dirListing(liveDir(home))).toEqual(['coord.db', 'delegation-checkpoint.json', 'delegation-events.log']);
    // The snapshot is only read: it still validates.
    expect(H.classify({ from: dir }).kind).toBe('v1');
  });

  it('a restored DB opens, and the restored journal and checkpoint validate as a pair', () => {
    const { home, dir } = restoreFixture();
    H.restore({ home, from: dir, probe: inactive });
    const db = new DatabaseSync(liveFile(home, 'coord.db'), { readOnly: true });
    expect(db.prepare('SELECT x FROM fixture').get()).toMatchObject({ x: 2 });
    db.close();
    expect(H.validateSidecars(H.realFs, { checkpointBytes: readFileSync(liveFile(home, 'delegation-checkpoint.json')), journalPath: liveFile(home, 'delegation-events.log') }))
      .toMatchObject({ revision: 5, coverage: { lastSequence: 3 } });
  });

  it('a live member the snapshot does not have is removed (an absent checkpoint, an absent journal)', () => {
    const home = mkHome();
    setLive(home, { journal: bytesOf(RA), checkpoint: null, db: null });
    const { dir } = snapshotOf(home);
    setLive(home, { journal: J3, checkpoint: CP3, db: { marker: 9 }, wal: 'w', shm: 's' });
    H.restore({ home, from: dir, probe: inactive });
    expect(dirListing(liveDir(home))).toEqual(['delegation-events.log']);
  });

  it('refuses to start while an earlier restore is pending, and a stale stage is a pending restore too', () => {
    const { home, dir, oldState } = restoreFixture();
    mkdirSync(liveFile(home, 'coordination-restore.stage'));
    expect(outcome(() => H.restore({ home, from: dir, probe: inactive }))).toMatchObject({ ok: false, code: 'restore-pending' });
    expect(liveState(home)).toEqual(oldState);
    rmSync(liveFile(home, 'coordination-restore.stage'), { recursive: true });
    writeFileSync(liveFile(home, 'coordination-restore.json'), 'x');
    expect(outcome(() => H.restore({ home, from: dir, probe: inactive }))).toMatchObject({ ok: false, code: 'restore-pending' });
    expect(liveState(home)).toEqual(oldState);
  });

  it('an unreadable marker is never guessed at: recover refuses and changes nothing', () => {
    const { home, oldState } = restoreFixture();
    writeFileSync(liveFile(home, 'coordination-restore.json'), 'not a marker\n');
    expect(outcome(() => H.recover({ home, probe: inactive }))).toMatchObject({ ok: false, code: 'marker-invalid' });
    expect(liveState(home)).toEqual(oldState);
    expect(H.main(['recover'], { HOME: home, PATH: '' }, { out: () => undefined, err: () => undefined })).toBe(2);
  });

  it('recover with nothing to recover is a no-op, and needs no service measurement', () => {
    const { home, oldState } = restoreFixture();
    expect(H.recover({ home, probe: () => { throw new Error('must not probe'); } })).toBe('none');
    expect(liveState(home)).toEqual(oldState);
  });
});

describe('8B: an absent DB is removed only by the manifest\'s explicit acknowledgement (W3-M36)', () => {
  it('coordDb.present:false removes the DB, its WAL and its SHM, and nothing else is guessed', () => {
    const home = mkHome();
    setLive(home, { journal: J3, checkpoint: CP3, db: null });
    const { dir, manifest } = snapshotOf(home);
    expect(manifest.members.coordDb).toEqual({ filename: 'coord.db', present: false });
    setLive(home, { journal: J2, checkpoint: CP2, db: { marker: 1 }, wal: 'w', shm: 's' });
    H.restore({ home, from: dir, probe: inactive });
    expect(dirListing(liveDir(home))).toEqual(['delegation-checkpoint.json', 'delegation-events.log']);
  });

  it('a manifest that says the DB is PRESENT, with the DB file missing from the directory, removes nothing', () => {
    const { home, dir, oldState } = restoreFixture();
    rmSync(path.join(dir, 'coord.db'));
    expect(outcome(() => H.restore({ home, from: dir, probe: inactive }))).toMatchObject({ ok: false, code: 'source-invalid' });
    expect(liveState(home)).toEqual(oldState);
    expect(existsSync(liveFile(home, 'coord.db'))).toBe(true);
    expect(existsSync(liveFile(home, 'coord.db-wal'))).toBe(true);
    expect(existsSync(liveFile(home, 'coord.db-shm'))).toBe(true);
  });

  it('a snapshot that merely has no coord.db and no acknowledgement (a manifest-less directory) is not a restore source', () => {
    const { home, dir, oldState } = restoreFixture();
    rmSync(path.join(dir, 'coordination-snapshot.json'));
    rmSync(path.join(dir, 'coord.db'));
    expect(outcome(() => H.restore({ home, from: dir, probe: inactive }))).toMatchObject({ ok: false, code: 'source-invalid' });
    expect(liveState(home)).toEqual(oldState);
  });

  it('a manifest acknowledging an absent DB beside a coord.db file in the directory is invalid, and removes nothing', () => {
    const home = mkHome();
    setLive(home, { journal: J3, checkpoint: CP3, db: null });
    const { dir } = snapshotOf(home);
    plantDb(path.join(dir, 'coord.db'));
    setLive(home, { journal: J2, checkpoint: CP2, db: { marker: 1 } });
    const before = liveState(home);
    expect(outcome(() => H.restore({ home, from: dir, probe: inactive }))).toMatchObject({ ok: false, code: 'source-invalid' });
    expect(liveState(home)).toEqual(before);
  });
});

describe('8B: the replacement fault matrix, and the interrupted-restore table (W3-M35, W3-M37)', () => {
  // One clean run tells where the two marker publications sit among the mutating operations.
  const clean = { get: cleanRestoreRun };
  const isOld = (s: Five, f: { oldState: Five }): boolean => FIVE.every((n) => s[n] === f.oldState[n]);
  const isNew = (s: Five, f: { newState: Five }): boolean => FIVE.every((n) => s[n] === f.newState[n]);
  const leftovers = (home: string): string[] => dirListing(liveDir(home)).filter((n) => /restore/.test(n));

  it('the clean run publishes the replacing marker, then the committed marker, in that order, among a few dozen operations', () => {
    const c = clean.get();
    expect(c.total).toBeGreaterThan(30);
    expect(c.replacingAt).toBeGreaterThan(5);
    expect(c.committedAt).toBeGreaterThan(c.replacingAt + 8);
    expect(c.committedAt).toBeLessThan(c.total - 4);
    const aside = c.ops.findIndex((o) => o.startsWith('rename <root>/.ccrc/coord.db ->'));
    const placed = c.ops.findIndex((o) => o.includes('rename <root>/.ccrc/coordination-restore.stage/new/coord.db -> '));
    expect(aside, 'old DB set aside').toBeGreaterThan(-1);
    expect(placed, 'new DB placed').toBeGreaterThan(aside);
  });

  it('a CRASH at every operation, then `recover`: the live set is all-old before COMMITTED and all-new after it, never mixed, with nothing left behind', () => {
    const c = clean.get();
    for (let k = 0; k < c.total; k++) {
      const f = restoreFixture();
      const { fs } = loggedFs(f.home, { crashAt: k });
      const r = outcome(() => H.restore({ home: f.home, from: f.dir, fs, probe: inactive }));
      expect(r.ok, `crash at ${k}`).toBe(false);
      const word = outcome(() => H.recover({ home: f.home, probe: inactive }));
      expect(word.ok, `recover after a crash at ${k}`).toBe(true);
      const state = liveState(f.home);
      const wantNew = k > c.committedAt;
      expect(wantNew ? isNew(state, f) : isOld(state, f), `crash at ${k} (committed at ${c.committedAt}): ${JSON.stringify(state)}`).toBe(true);
      expect(leftovers(f.home), `crash at ${k}`).toEqual([]);
    }
  }, 120_000);

  it('a transient FAULT at every operation: the restore reports it and the live set is all-old before COMMITTED and all-new after it, never mixed', () => {
    const c = clean.get();
    for (let k = 0; k < c.total; k++) {
      const f = restoreFixture();
      const { fs } = loggedFs(f.home, { failOnly: k });
      const r = outcome(() => H.restore({ home: f.home, from: f.dir, fs, probe: inactive }));
      expect(r.ok, `fault at ${k}`).toBe(false);
      if (k <= c.committedAt) {
        // Before COMMITTED the restore puts the old set back ITSELF; no marker or stage is left for anyone.
        expect(isOld(liveState(f.home), f), `fault at ${k} (before commit): ${JSON.stringify(liveState(f.home))}`).toBe(true);
        expect(leftovers(f.home), `fault at ${k}`).toEqual([]);
      } else {
        // After COMMITTED the new set is whole and in place; at worst the cleanup is left for `recover`.
        expect(isNew(liveState(f.home), f), `fault at ${k} (after commit)`).toBe(true);
        if (leftovers(f.home).length > 0) {
          expect(outcome(() => H.recover({ home: f.home, probe: inactive })).ok, `recover after a fault at ${k}`).toBe(true);
        }
        expect(leftovers(f.home), `fault at ${k}`).toEqual([]);
        expect(isNew(liveState(f.home), f)).toBe(true);
      }
    }
  }, 120_000);

  it('the interrupted-restore table: no marker + a stage is cleaned; replacing goes BACK; committed goes FORWARD', () => {
    const c = clean.get();
    const rows: Array<[string, number, string, 'old' | 'new']> = [
      ['crash before the marker is published (stage only)', c.replacingAt - 1, 'cleaned', 'old'],
      ['crash while publishing the replacing marker', c.replacingAt, 'cleaned', 'old'],
      ['crash right after the replacing marker is durable', c.replacingAt + 2, 'rolled-back', 'old'],
      ['crash with the old set aside and nothing placed', c.replacingAt + 5, 'rolled-back', 'old'],
      ['crash mid-placement (some members new, some gone)', c.committedAt - 4, 'rolled-back', 'old'],
      ['crash while publishing the committed marker', c.committedAt, 'rolled-back', 'old'],
      ['crash right after COMMITTED is durable', c.committedAt + 2, 'finalized', 'new'],
      ['crash during cleanup after COMMITTED (stage half removed)', c.committedAt + 6, 'finalized', 'new'],
      ['crash just before the marker itself is removed', c.total - 3, 'finalized', 'new'],
    ];
    for (const [name, k, word, side] of rows) {
      const f = restoreFixture();
      const { fs } = loggedFs(f.home, { crashAt: k });
      outcome(() => H.restore({ home: f.home, from: f.dir, fs, probe: inactive }));
      expect(outcome(() => H.recover({ home: f.home, probe: inactive })), name).toMatchObject({ ok: true, value: word });
      expect(side === 'old' ? isOld(liveState(f.home), f) : isNew(liveState(f.home), f), `${name}: ${JSON.stringify(liveState(f.home))}`).toBe(true);
      expect(leftovers(f.home), name).toEqual([]);
      // Recovery is idempotent: running it again changes nothing.
      expect(H.recover({ home: f.home, probe: inactive })).toBe('none');
    }
  });

  it('recovery itself survives a crash at any of its own operations: running it again finishes the same way', () => {
    const c = clean.get();
    for (const k of [c.replacingAt + 6, c.committedAt - 4, c.committedAt + 2]) {
      const probe = restoreFixture();
      outcome(() => H.restore({ home: probe.home, from: probe.dir, fs: loggedFs(probe.home, { crashAt: k }).fs, probe: inactive }));
      const recorder = loggedFs(probe.home);
      H.recover({ home: probe.home, fs: recorder.fs, probe: inactive });
      const total = recorder.log.mutating.length;
      expect(total, `recovery after a crash at ${k} has work to do`).toBeGreaterThan(3);
      for (let j = 0; j < total; j++) {
        const g = restoreFixture();
        outcome(() => H.restore({ home: g.home, from: g.dir, fs: loggedFs(g.home, { crashAt: k }).fs, probe: inactive }));
        const crashing = loggedFs(g.home, { crashAt: j });
        expect(outcome(() => H.recover({ home: g.home, fs: crashing.fs, probe: inactive })).ok, `recover crash ${j}`).toBe(false);
        expect(outcome(() => H.recover({ home: g.home, probe: inactive })).ok, `recover again after ${j}`).toBe(true);
        const state = liveState(g.home);
        expect(k > c.committedAt ? isNew(state, g) : isOld(state, g), `restore crash ${k}, recovery crash ${j}`).toBe(true);
        expect(leftovers(g.home)).toEqual([]);
      }
    }
  }, 240_000);

  it('the command line: `recover` finishes an interrupted restore (exit 0) and says what it did', () => {
    const c = clean.get();
    const f = restoreFixture();
    const { fs } = loggedFs(f.home, { crashAt: c.committedAt - 3 });
    outcome(() => H.restore({ home: f.home, from: f.dir, fs, probe: inactive }));
    const bin = path.join(f.home, 'bin');
    mkdirSync(bin);
    writeFileSync(path.join(bin, 'systemctl'), '#!/bin/sh\necho inactive\nexit 3\n');
    chmodSync(path.join(bin, 'systemctl'), 0o755);
    const r = spawnSync(process.execPath, ['--no-warnings', HELPER_PATH, 'recover'], { env: { HOME: f.home, PATH: bin }, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('coordination restore recovery: rolled-back\n');
    expect(liveState(f.home)).toEqual(f.oldState);
  });
});

describe('8B: backup-coord.mjs stays the SQLite-only snapshot, and the helper never changes it (W3-M40)', () => {
  it('its bytes are pinned, it names no sidecar, and it imports only node:sqlite and node:fs', () => {
    const src = readFileSync(BACKUP_COORD_PATH, 'utf8');
    expect(createHash('sha256').update(src).digest('hex')).toBe('057ce6ade9d695cdd7971f0ca2cadbbdb535de4a7dbe446d11319fb373354f99');
    expect(src).not.toMatch(/delegation|sidecar|coordination|manifest/i);
    expect([...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1])).toEqual(['node:sqlite', 'node:fs']);
  });
  it('run on a live DB beside both sidecars it writes exactly one file: the DB snapshot', () => {
    const home = mkHome();
    setLive(home, { journal: J3, checkpoint: CP3, db: { marker: 1, tables: ['delegation_sessions'] } });
    const dest = snapDirOf(home);
    takeDbSnapshot(home, dest);
    expect(dirListing(dest)).toEqual(['coord.db']);
  });
  it('the helper imports node: modules only, and names no file of the server or shared trees', () => {
    const src = readFileSync(HELPER_PATH, 'utf8');
    const imports = [...src.matchAll(/^import (?:.* from )?'([^']+)';$/gm)].map((m) => m[1]!);
    expect(imports.length).toBeGreaterThan(4);
    for (const spec of imports) expect(spec, spec).toMatch(/^node:/);
    // Every module it loads at run time is a node: one, too (the sqlite check goes through createRequire).
    for (const m of src.matchAll(/(?:require|createRequire\(import\.meta\.url\))\('([^']+)'\)/g)) expect(m[1], m[1]).toMatch(/^node:/);
    expect(src).not.toMatch(/await import\(|import\(['"`]\./);
  });
});
