// Delegation broker wave 3, Task 8A: the durable journal, the atomic checkpoint, recovery, retention planning and the serialized
// durable applier.
//
// The journal (`delegation-events.log`) and the checkpoint (`delegation-checkpoint.json`) are AUTHORITY; `coord.db` is repairable
// output. These rows hold the modules to O1 to O5 under crash injection, and to the plan's mutation rows W3-M12 to M18A, M38, M62
// and M71 (the grammar rows M20 to M24 are in `coordination-snapshot.test.ts`). Every hash is computed independently of the
// implementation (Python's hashlib and json, or Node's crypto over a preimage spelled out in the test), and every file is in a
// FIXTURE directory: nothing here reads or writes the live `~/.ccrc`.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import {
  DelegationModelError,
  assertDelegationCheckpointIdentity,
  canonicalDelegationJson,
  delegationSha256Hex,
  delegationIntentKey,
  deriveDelegationActivityId,
  deriveDelegationLineageId,
  emptyDelegationCheckpoint,
  encodeDelegationNaturalKey,
  formatDelegationInstant,
  projectionViewOfDelegationCheckpoint,
  type DelegationActivityRow,
  type DelegationCheckpointV1,
  type DelegationJournalEntryV1,
  type DelegationJournalRecordV1,
  type DelegationLeaseCreationRequest,
  type DelegationLeaseRow,
  type DelegationLineageRow,
} from '../src/coord/delegation-model.js';
import {
  DELEGATION_JOURNAL_FILE,
  DELEGATION_TORN_DIR,
  DelegationJournalError,
  DelegationJournalWriter,
  buildDelegationJournalRecord,
  decodeDelegationJournalLine,
  delegationJournalDigest,
  delegationJournalId,
  delegationRetentionViewOf,
  delegationTailHealPlan,
  encodeDelegationJournalRecord,
  findDelegationJsonDefect,
  nodeDelegationFilePort,
  parseDelegationJournal,
  planDelegationJournalAppend,
  planDelegationPruning,
  readDelegationJournalRecords,
  type DelegationFileHandle,
  type DelegationFilePort,
  type DelegationJournalTail,
} from '../src/coord/delegation-journal.js';
import {
  DELEGATION_CHECKPOINT_FILE,
  DELEGATION_DURABILITY_EDGES,
  DELEGATION_RECOVERY_PHASES,
  DelegationCheckpointBuilder,
  DelegationCheckpointError,
  COORDINATION_RESTORE_MARKER_FILE,
  DELEGATION_RESTORE_IN_PROGRESS,
  DelegationDurability,
  DelegationEvidenceIndex,
  assertDelegationCheckpointProjectable,
  decodeDelegationCheckpoint,
  encodeDelegationCheckpoint,
  recoverDelegation,
  recoverDelegationFromFiles,
  recoverDelegationState,
  repairDelegationProjection,
  type DelegationDurabilityDeps,
  type DelegationDurabilityEdge,
  type DelegationDurableBatch,
  type DelegationProjectionPort,
} from '../src/coord/delegation-checkpoint.js';
import { unreadableDelegationBucketResult } from '../src/coord/delegation-ingest.js';

// A pass-through of the journal's append planner that a test can switch to "skip everything". `createLease` calls the planner after its
// own checks, so no real input makes the planner skip the entry it was handed; this is the only way to reach that branch (fix round 1, M6).
const planControl = vi.hoisted(() => ({ skipEverything: false }));
vi.mock('../src/coord/delegation-journal.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/coord/delegation-journal.js')>();
  return {
    ...actual,
    planDelegationJournalAppend: (input: Parameters<typeof actual.planDelegationJournalAppend>[0]) =>
      planControl.skipEverything
        ? { records: [], skipped: input.items.map((_, index) => ({ index, reason: 'duplicate-lease' as const, leaseId: 'phantom' })) }
        : actual.planDelegationJournalAppend(input),
  };
});

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The projection port over the store: three one-line adapters. `projectDelegationCheckpoint`, `insertDelegationEvents` (ONE
 * transaction, a conflict reported and never thrown) and `delegationEventStats` are the production methods Task 7's second fix round
 * gave the store, so this is the same port production uses and the SQLite differential below runs against the real thing.
 */
function delegationProjectionPortOfStore(store: CoordStore): DelegationProjectionPort {
  return {
    project: (cp) => store.projectDelegationCheckpoint(cp),
    insertEvents: (rows) => store.insertDelegationEvents(rows),
    eventStats: () => store.delegationEventStats(),
  };
}

const PARENT = 'lane-a-demo';
const INC = 'g1';
const CLAUDE = '11111111-2222-3333-4444-555555555555';
const X = 'agent-abc123';
const Y = 'agent-def456';
const T = (s: number): string => formatDelegationInstant(Date.UTC(2026, 9, 14) + s * 1000);
const eid = (n: number): string => delegationSha256Hex(`fixture-event-${n}`);
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

const base = (n: number, over: { sessionId?: string; parentIncarnation?: string } = {}) => ({
  v: 1 as const, observedAt: T(n), sessionId: over.sessionId ?? PARENT, parentIncarnation: over.parentIncarnation ?? INC, claudeSessionId: CLAUDE,
  eventId: eid(n), bucket: '2026101400', startOffset: n * 100, endOffset: n * 100 + 99,
});
type Over = { sessionId?: string; parentIncarnation?: string };
const sessionStart = (n: number, over: Over = {}): DelegationEventEnvelopeV1 => ({ ...base(n, over), eventKind: 'SessionStart', source: 'startup' });
/** A tool event inside a subagent: it names the agent only through the common `agentId` field. NOT a qualifying join. */
const bareTool = (n: number, agentId: string, over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_${n}`, outcome: 'completed', agentId });
const subagentStart = (n: number, agentId: string, over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'SubagentStart', agentId, agentType: null });
const subagentStop = (n: number, agentId: string, over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'SubagentStop', agentId, agentType: null, agentTranscriptPath: null });
const agentLaunch = (n: number, agentId: string, status: 'async-launched' | 'completed' = 'async-launched', over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'PostToolUse', toolName: 'Agent', toolUseId: `toolu_${n}`, outcome: status, launch: { status, agentId, isAsync: status === 'async-launched' } });

const evidence = (event: DelegationEventEnvelopeV1): DelegationJournalEntryV1 => ({ kind: 'evidence-accepted', event });
/** A chain of records from `first`, each accepted at an instant that is NOT its event's observation time. */
function chainOf(entries: readonly DelegationJournalEntryV1[], first = 1, previous: string | null = null): DelegationJournalRecordV1[] {
  const out: DelegationJournalRecordV1[] = [];
  let prev = previous;
  entries.forEach((entry, i) => {
    const r = buildDelegationJournalRecord({ sequence: first + i, acceptedAt: T(100000 + first + i), previousDigest: prev, entry });
    out.push(r);
    prev = r.digest;
  });
  return out;
}
const evidenceChain = (events: readonly DelegationEventEnvelopeV1[], first = 1, previous: string | null = null): DelegationJournalRecordV1[] =>
  chainOf(events.map(evidence), first, previous);

const keyOf = (agentId: string, over: Over = {}) => ({ parentId: over.sessionId ?? PARENT, parentIncarnation: over.parentIncarnation ?? INC, sourceKind: 'agent' as const, upstreamId: agentId });
const activityOf = (cp: DelegationCheckpointV1, agentId: string): DelegationActivityRow | undefined => cp.activities.find((a) => a.upstreamId === agentId);
const failureCode = (fn: () => unknown): string => {
  try { fn(); } catch (err) { if (err instanceof DelegationJournalError || err instanceof DelegationCheckpointError || err instanceof DelegationModelError) return err.code; throw err; }
  return 'accepted';
};
const bytesOf = (records: readonly DelegationJournalRecordV1[]): Uint8Array => {
  const parts = records.map(encodeDelegationJournalRecord);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const withoutRevision = (cp: DelegationCheckpointV1): string => canonicalDelegationJson({ ...cp, revision: 0 });
/** Replaces the LAST occurrence: the record's own trailing key, not the identical text nested inside its event. */
const replaceLast = (s: string, from: string, to: string): string => {
  const at = s.lastIndexOf(from);
  if (at < 0) throw new Error(`${from} not found`);
  return s.slice(0, at) + to + s.slice(at + from.length);
};
/** Valid JSON for the same value that is NOT the canonical encoding: the keys written in reverse order. */
const uncanonical = (canonicalText: string): string => {
  const reversed = (v: unknown): unknown => (Array.isArray(v) ? v.map(reversed) : v !== null && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)])) : v);
  return JSON.stringify(reversed(JSON.parse(canonicalText)));
};
/** A retention cutoff so late that every record is older than the floor: the plan is bounded by holds and the anchor alone. */
const NO_FLOOR = Date.UTC(2100, 0, 1);

/** A ready recovery of a journal of events, from no checkpoint. */
function ready(events: readonly DelegationEventEnvelopeV1[]) {
  const records = evidenceChain(events);
  const report = recoverDelegation(null, records);
  expect(report.failure).toBeNull();
  return { records, report, cp: report.state.checkpoint };
}

// ── W3-M71: the canonical preimage vectors ──────────────────────────────────────────────────────────────────────────

describe('canonical-preimage vectors (W3-M71): the two journal preimages are nonrecursive, canonical and exact', () => {
  // Python: canon = json.dumps(v, sort_keys=True, separators=(',', ':'), ensure_ascii=False); sha256 of its UTF-8 bytes.
  const EVENT_A: DelegationEventEnvelopeV1 = {
    v: 1, eventKind: 'SessionStart', source: 'startup', observedAt: '2026-10-14T00:00:00.000Z', sessionId: PARENT, parentIncarnation: INC,
    claudeSessionId: CLAUDE, eventId: 'a'.repeat(64), bucket: '2026101400', startOffset: 0, endOffset: 100,
  };
  const A_ID_PREIMAGE = '{"acceptedAt":"2026-10-14T00:00:01.000Z","entry":{"event":{"bucket":"2026101400","claudeSessionId":"11111111-2222-3333-4444-555555555555","endOffset":100,"eventId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","eventKind":"SessionStart","observedAt":"2026-10-14T00:00:00.000Z","parentIncarnation":"g1","sessionId":"lane-a-demo","source":"startup","startOffset":0,"v":1},"kind":"evidence-accepted"},"previousDigest":null,"sequence":1,"v":1}';
  const A_JOURNAL_ID = '93d36739e183fae9d71b701295ab4f8aee14ae2765c5433fc9cc607230942939';
  const A_DIGEST = '03649ebf24741fdb6777644873afddc4e49dd975b035e1762b1a663f8ee30d96';
  const recordA = { sequence: 1, acceptedAt: '2026-10-14T00:00:01.000Z', previousDigest: null, entry: evidence(EVENT_A) };

  it('journalId is SHA-256 of the canonical {v, sequence, acceptedAt, previousDigest, entry} and of nothing else', () => {
    expect(sha(A_ID_PREIMAGE)).toBe(A_JOURNAL_ID);
    expect(delegationJournalId(recordA)).toBe(A_JOURNAL_ID);
    expect(A_ID_PREIMAGE).not.toContain('journalId');
    expect(A_ID_PREIMAGE).not.toContain('digest"');
  });

  it('digest is SHA-256 of the canonical {v, sequence, journalId, acceptedAt, previousDigest, entry}, without itself', () => {
    const pre = A_ID_PREIMAGE.replace('{"acceptedAt"', `{"acceptedAt"`).replace('"previousDigest":null', `"journalId":"${A_JOURNAL_ID}","previousDigest":null`);
    // canonical order puts journalId between entry and previousDigest
    expect(pre).toContain(`"entry":{`);
    expect(sha(pre)).toBe(A_DIGEST);
    expect(delegationJournalDigest({ ...recordA, journalId: A_JOURNAL_ID })).toBe(A_DIGEST);
  });

  it('a built record carries exactly those two hashes, and the text it is written as is canonical JSON plus one LF', () => {
    const r = buildDelegationJournalRecord(recordA);
    expect([r.journalId, r.digest]).toEqual([A_JOURNAL_ID, A_DIGEST]);
    const written = new TextDecoder().decode(encodeDelegationJournalRecord(r));
    expect(written.endsWith('\n')).toBe(true);
    expect(written.slice(0, -1)).toBe(canonicalDelegationJson(r));
    expect(written.slice(0, -1).includes('\n')).toBe(false);
    // Properties are sorted at EVERY depth, not in construction order.
    expect(written.startsWith('{"acceptedAt":"2026-10-14T00:00:01.000Z","digest":"')).toBe(true);
  });

  it('changing journalId changes the digest and does not change the journalId preimage', () => {
    const a = delegationJournalDigest({ ...recordA, journalId: A_JOURNAL_ID });
    const b = delegationJournalDigest({ ...recordA, journalId: 'b'.repeat(64) });
    expect(a).not.toBe(b);
    expect(delegationJournalId({ ...recordA })).toBe(A_JOURNAL_ID);
  });

  it('pins a multibyte record (UTF-8 bytes are hashed, not UTF-16 units) and a lease-created record with a derived lineage ID', () => {
    const multibyte = buildDelegationJournalRecord({
      sequence: 3, acceptedAt: '2026-10-14T00:00:04.000Z', previousDigest: '1ba0da46e7757b7d45e8e912f765bbeb1258df03e17b2662d528cdb92da5e4c2',
      entry: evidence({ ...EVENT_A, eventId: 'c'.repeat(64), source: 'résumé 日本語 é', cwd: '/work/café/日本', startOffset: 230, endOffset: 400 }),
    });
    expect([multibyte.journalId, multibyte.digest]).toEqual(['aa15ed8ba8f002daee0c3f2a195d422996e116a542f3a1cddb4fb279bebacf2c', 'cac1b79e215955a8aef5b1894462c958108aa33d0021ea7f50f4885b536d9186']);
    const lease = buildDelegationJournalRecord({
      sequence: 7, acceptedAt: '2026-10-14T00:15:00.000Z', previousDigest: 'f1a9e9b86dd342f3dcba4e0c6e667cf21f3cb6dc7773dca8aa10778a1f9fa366',
      entry: {
        kind: 'lease-created', leaseId: '5b0d9d9e-6d3c-4d2e-9f7a-0a1b2c3d4e5f', generation: 0,
        activityId: '9239bd0ac5b8d4af700cd38ae205546b428bc6b605ef1d9adcd09c1796afcbfc', parentId: PARENT, parentIncarnation: INC, project: 'project-a',
        adminRecord: 'wt-1', canonicalPath: '/work/project-a/.claude/worktrees/wt-1', creationBase: null, sourceKind: 'agent',
        correlationJournalIds: ['842563601695ebb48c8fbb35e752df0c7c36923d6c8dea27f0602367d17add3b'], firstObservedAt: '2026-10-14T00:14:59.000Z',
        lineageId: '047ea347b1d2689ce34424088dd6e9af1f13eb8d0302b609a205d230322478e6',
      },
    });
    expect([lease.journalId, lease.digest]).toEqual(['864b5eba5127ed8f21b78c5ef0772331343e968bd43bc9371ae46061b2befe3e', '835325d84c9e328473d5240633999dd86b2136e64c7f317e8147d1787b8626fc']);
    // Round trip through the strict decoder.
    expect(decodeDelegationJournalLine(encodeDelegationJournalRecord(lease).subarray(0, -1))).toEqual(lease);
  });

  it('the lease lineage ID is the Python-derived domain-separated, length-prefixed tuple hash', () => {
    // Python: sha256(lp('ccrc-delegation-lineage-v1') + lp(leaseId) + lp(parentId) + lp(parentIncarnation) + lp(activityId))
    expect(deriveDelegationLineageId({
      leaseId: '5b0d9d9e-6d3c-4d2e-9f7a-0a1b2c3d4e5f', parentId: PARENT, parentIncarnation: INC, activityId: '9239bd0ac5b8d4af700cd38ae205546b428bc6b605ef1d9adcd09c1796afcbfc',
    })).toBe('047ea347b1d2689ce34424088dd6e9af1f13eb8d0302b609a205d230322478e6');
    const lp = (s: string): string => `${Buffer.byteLength(s, 'utf8')}:${s}`;
    expect(sha(lp('ccrc-delegation-lineage-v1') + lp('5b0d9d9e-6d3c-4d2e-9f7a-0a1b2c3d4e5f') + lp(PARENT) + lp(INC) + lp('9239bd0ac5b8d4af700cd38ae205546b428bc6b605ef1d9adcd09c1796afcbfc'))).toBe('047ea347b1d2689ce34424088dd6e9af1f13eb8d0302b609a205d230322478e6');
    // Domain-separated and field-separated: moving a character between two fields is a different ID.
    const parts = { leaseId: 'ab', parentId: 'c', parentIncarnation: 'g1', activityId: 'd' };
    expect(deriveDelegationLineageId(parts)).not.toBe(deriveDelegationLineageId({ ...parts, leaseId: 'a', parentId: 'bc' }));
  });

  it('refuses a value outside the canonical JSON domain, before any hash exists', () => {
    const bad: Array<[string, unknown]> = [
      ['a lone surrogate', { ...EVENT_A, cwd: 'a\ud800b' }],
      ['an undefined member', { ...EVENT_A, cwd: undefined }],
      ['a Date', { ...EVENT_A, cwd: new Date(0) }],
      ['a class instance', { ...EVENT_A, cwd: new (class Odd { x = 1; })() }],
      ['a sparse array', { ...EVENT_A, listing: [1, , 3] }],
      ['NaN', { ...EVENT_A, listing: [Number.NaN] }],
      ['an unsafe integer', { ...EVENT_A, listing: [2 ** 53] }],
      ['a bigint', { ...EVENT_A, listing: [1n] }],
    ];
    for (const [name, event] of bad) {
      expect(() => buildDelegationJournalRecord({ ...recordA, entry: { kind: 'evidence-accepted', event: event as DelegationEventEnvelopeV1 } }), name).toThrow();
    }
  });

  it('refuses, on decode, a record whose text is valid JSON but not the canonical encoding of its value, and a lone-surrogate escape', () => {
    const line = new TextDecoder().decode(encodeDelegationJournalRecord(buildDelegationJournalRecord(recordA))).trimEnd();
    const reorder = uncanonical(line);
    expect(reorder).not.toBe(line);
    expect(failureCode(() => decodeDelegationJournalLine(new TextEncoder().encode(reorder)))).toBe('noncanonical');
    expect(failureCode(() => decodeDelegationJournalLine(new TextEncoder().encode(line.replace('"source":"startup"', '"source":"\\ud800"'))))).toBe('invalid-domain');
    expect(failureCode(() => decodeDelegationJournalLine(new TextEncoder().encode(line.replace('"source":"startup"', '"source":"start\\u0075p"'))))).toBe('noncanonical');
  });
});

// ── the closed grammar ───────────────────────────────────────────────────────────────────────────────────────────────

describe('the canonical journal grammar: what is accepted and what is refused', () => {
  const [r1] = evidenceChain([sessionStart(1)]);
  const good = new TextDecoder().decode(encodeDelegationJournalRecord(r1)).trimEnd();
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
  const code = (line: string | Uint8Array): string => failureCode(() => decodeDelegationJournalLine(typeof line === 'string' ? enc(line) : line));

  it('accepts a canonical evidence record and a canonical lease-created record', () => {
    expect(code(good)).toBe('accepted');
  });

  const table: Array<[string, string | Uint8Array, string]> = [
    ['a BOM', new Uint8Array([0xef, 0xbb, 0xbf, ...enc(good)]), 'bom'],
    ['a trailing CR (CRLF)', `${good}\r`, 'crlf'],
    ['a blank line', '', 'blank-line'],
    ['invalid UTF-8', new Uint8Array([...enc(good.slice(0, 10)), 0xc3, 0x28, ...enc(good.slice(10))]), 'invalid-utf8'],
    ['text that is not JSON', '{"a":', 'malformed-json'],
    ['trailing garbage after the value', `${good} x`, 'malformed-json'],
    ['a duplicate top-level key', replaceLast(good, '"v":1}', '"v":1,"v":1}'), 'duplicate-key'],
    ['a duplicate key inside the entry', good.replace('"kind":"evidence-accepted"', '"kind":"evidence-accepted","kind":"evidence-accepted"'), 'duplicate-key'],
    ['a duplicate key inside the event', good.replace('"source":"startup"', '"source":"startup","source":"startup"'), 'duplicate-key'],
    ['an unknown record key', replaceLast(good, '"v":1}', '"v":1,"zzz":1}'), 'unknown-key'],
    ['an unknown entry key', good.replace('"kind":"evidence-accepted"', '"kind":"evidence-accepted","zzz":1'), 'unknown-key'],
    ['a missing record key', good.replace(/"acceptedAt":"[^"]+",/, ''), 'bad-field'],
    ['v other than 1', replaceLast(good, '"v":1}', '"v":2}'), 'bad-field'],
    ['an acceptedAt without milliseconds', good.replace(/"acceptedAt":"[^"]+"/, '"acceptedAt":"2026-10-14T00:00:01Z"'), 'bad-field'],
    ['an uppercase previousDigest', good.replace('"previousDigest":null', `"previousDigest":"${'A'.repeat(64)}"`), 'bad-field'],
    ['a short journalId', good.replace(/"journalId":"[0-9a-f]{64}"/, '"journalId":"abc"'), 'bad-field'],
    ['an unknown entry kind', good.replace('"kind":"evidence-accepted"', '"kind":"lease-released"'), 'bad-field'],
    ['an event with no eventId', good.replace(/"eventId":"[0-9a-f]{64}",/, ''), 'bad-field'],
    ['an event whose endOffset is not past its startOffset', good.replace('"endOffset":199', '"endOffset":100'), 'bad-field'],
    ['whitespace between tokens', replaceLast(good, '"v":1}', '"v": 1}'), 'noncanonical'],
    ['a number written 1.0', good.replace('"sequence":1', '"sequence":1.0'), 'noncanonical'],
    ['an escape where a plain character is canonical', good.replace('lane-a-demo', 'lane\\u002da-demo'), 'noncanonical'],
    ['a journalId that is not the hash of its preimage', good.replace(/"journalId":"[0-9a-f]{64}"/, `"journalId":"${'0'.repeat(64)}"`), 'journal-id-mismatch'],
    ['a digest that is not the hash of its preimage', good.replace(/"digest":"[0-9a-f]{64}"/, `"digest":"${'0'.repeat(64)}"`), 'digest-mismatch'],
  ];
  for (const [name, line, expected] of table) it(`refuses ${name}`, () => { expect(code(line)).toBe(expected); });

  it('refuses a lease-created entry with a nonzero generation, an unknown source, a non-hex correlation ID and an empty base', () => {
    const lease = (over: Record<string, unknown>) => buildDelegationJournalRecord({
      sequence: 1, acceptedAt: T(1), previousDigest: null,
      entry: { kind: 'lease-created', leaseId: 'lease-1', generation: 0, activityId: 'a'.repeat(64), parentId: PARENT, parentIncarnation: INC, project: 'project-a', adminRecord: 'wt-1', canonicalPath: '/work/p/wt-1', creationBase: null, sourceKind: 'agent', correlationJournalIds: [], firstObservedAt: T(1), lineageId: 'b'.repeat(64), ...over } as DelegationJournalEntryV1,
    });
    expect(failureCode(() => lease({ generation: 1 }))).toBe('bad-field');
    expect(failureCode(() => lease({ sourceKind: 'carrier' }))).toBe('bad-field');
    expect(failureCode(() => lease({ correlationJournalIds: ['xyz'] }))).toBe('bad-field');
    expect(failureCode(() => lease({ creationBase: '' }))).toBe('bad-field');
    expect(failureCode(() => lease({ extra: 1 }))).toBe('unknown-key');
    expect(failureCode(() => lease({}))).toBe('accepted');
  });

  it('parses a whole journal and refuses every line that is wrong, naming the line', () => {
    const records = evidenceChain([sessionStart(1), sessionStart(2), sessionStart(3)]);
    expect(parseDelegationJournal(bytesOf(records), { completeFromStart: true })).toEqual(records);
    const lines = new TextDecoder().decode(bytesOf(records)).split('\n').slice(0, 3);
    try {
      parseDelegationJournal(enc(`${lines[0]}\n\n${lines[1]}\n`));
      throw new Error('accepted');
    } catch (err) {
      expect(err).toBeInstanceOf(DelegationJournalError);
      expect((err as DelegationJournalError).code).toBe('blank-line');
      expect((err as DelegationJournalError).where?.line).toBe(2);
    }
  });
});

describe('findDelegationJsonDefect: the scanner that names what JSON.parse hides', () => {
  const table: Array<[string, string, 'duplicate-key' | 'malformed-json' | null]> = [
    ['a clean object', '{"a":1,"b":[1,2,{"c":null}],"d":"x"}', null],
    ['the same key in two different objects', '{"a":{"k":1},"b":{"k":2}}', null],
    ['a repeated key at the top level', '{"a":1,"a":2}', 'duplicate-key'],
    ['a repeated key inside a nested object', '{"a":{"k":1,"k":2}}', 'duplicate-key'],
    ['a repeated key inside an object in an array', '{"a":[{"k":1},{"k":1,"k":2}]}', 'duplicate-key'],
    ['a repeated key spelled with an escape', '{"a":1,"\\u0061":2}', 'duplicate-key'],
    ['key-like text inside a string value', '{"a":"\\"b\\":1,\\"b\\":2"}', null],
    ['numbers in every form', '[0,-1,1.5,1e5,-2.5E-3,true,false,null]', null],
    ['a trailing comma', '{"a":1,}', 'malformed-json'],
    ['a missing value', '{"a":}', 'malformed-json'],
    ['trailing garbage', '{"a":1} x', 'malformed-json'],
    ['an unterminated string', '{"a":"x', 'malformed-json'],
    ['nothing at all', '', 'malformed-json'],
    ['nesting past the bound', `${'['.repeat(70)}${']'.repeat(70)}`, 'malformed-json'],
    ['a bare word', 'nope', 'malformed-json'],
  ];
  for (const [name, text, expected] of table) it(`${name}: ${String(expected)}`, () => { expect(findDelegationJsonDefect(text)).toBe(expected); });
});

// ── the checkpoint codec and its invariants ──────────────────────────────────────────────────────────────────────────

describe('the canonical checkpoint codec', () => {
  const { cp } = ready([sessionStart(1), bareTool(2, X), subagentStart(3, X), sessionStart(4)]);
  const bytes = encodeDelegationCheckpoint(cp);
  const text = new TextDecoder().decode(bytes);
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

  it('writes its canonical JSON and one LF, and decodes to exactly the checkpoint', () => {
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.slice(0, -1)).toBe(canonicalDelegationJson(cp));
    expect(decodeDelegationCheckpoint(bytes)).toEqual(cp);
    expect(encodeDelegationCheckpoint(decodeDelegationCheckpoint(bytes))).toEqual(bytes);
  });
  it('refuses a BOM, invalid UTF-8, a missing or doubled LF, a CR, a duplicate key, an unknown key and a non-canonical encoding', () => {
    const body = text.slice(0, -1);
    expect(failureCode(() => decodeDelegationCheckpoint(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes])))).toBe('bom');
    expect(failureCode(() => decodeDelegationCheckpoint(new Uint8Array([...bytes.subarray(0, 20), 0xc3, 0x28, ...bytes.subarray(20)])))).toBe('invalid-utf8');
    expect(failureCode(() => decodeDelegationCheckpoint(enc(body)))).toBe('missing-final-lf');
    expect(failureCode(() => decodeDelegationCheckpoint(enc(`${body}\n\n`)))).toBe('crlf');
    expect(failureCode(() => decodeDelegationCheckpoint(enc(`${body}\r\n`)))).toBe('crlf');
    expect(failureCode(() => decodeDelegationCheckpoint(enc(`${body.slice(0, -1)},"v":1}\n`)))).toBe('duplicate-key');
    expect(failureCode(() => decodeDelegationCheckpoint(enc(`${body.slice(0, -1)},"zzz":1}\n`)))).toBe('bad-shape');
    expect(failureCode(() => decodeDelegationCheckpoint(enc(`${uncanonical(body)}\n`)))).toBe('noncanonical');
    expect(failureCode(() => decodeDelegationCheckpoint(enc(`${body.replace('"v":1', '"v":2')}\n`)))).toBe('bad-version');
    expect(failureCode(() => decodeDelegationCheckpoint(enc('')))).toBe('missing-final-lf');
  });
  it('refuses an anchor whose sequence, journalId and digest do not come together, and a wrong word or instant in a row', () => {
    const mutate = (f: (c: Record<string, unknown>) => void): Uint8Array => {
      const c = JSON.parse(text) as Record<string, unknown>;
      f(c);
      return enc(`${canonicalDelegationJson(c)}\n`);
    };
    expect(failureCode(() => decodeDelegationCheckpoint(mutate((c) => { c['appliedJournalId'] = null; })))).toBe('bad-anchor');
    expect(failureCode(() => decodeDelegationCheckpoint(mutate((c) => { c['appliedJournalSequence'] = 0; })))).toBe('bad-anchor');
    expect(failureCode(() => decodeDelegationCheckpoint(mutate((c) => { (c['activities'] as Array<Record<string, unknown>>)[0]!['executionState'] = 'finished'; })))).toBe('bad-shape');
    expect(failureCode(() => decodeDelegationCheckpoint(mutate((c) => { (c['sessions'] as Array<Record<string, unknown>>)[0]!['firstObservedAt'] = '2026-10-14'; })))).toBe('bad-shape');
    expect(failureCode(() => decodeDelegationCheckpoint(mutate((c) => { (c['sessions'] as Array<Record<string, unknown>>)[0]!['extra'] = 1; })))).toBe('bad-shape');
    expect(failureCode(() => decodeDelegationCheckpoint(mutate((c) => { c['revision'] = -1; })))).toBe('bad-shape');
  });
  it('the empty checkpoint round-trips', () => {
    const empty = emptyDelegationCheckpoint();
    expect(decodeDelegationCheckpoint(encodeDelegationCheckpoint(empty))).toEqual(empty);
  });
});

describe('the checkpoint identity invariants (one pure helper, at build and at recovery)', () => {
  const { cp } = ready([sessionStart(1), bareTool(2, X), subagentStart(3, X)]);
  const act = cp.activities[0]!;

  it('a built checkpoint satisfies them', () => { expect(() => assertDelegationCheckpointIdentity(cp)).not.toThrow(); });

  it('refuses an activity whose ID is not the derivation from its natural key and identity journalId', () => {
    const wrong = { ...cp, activities: [{ ...act, identityJournalId: eid(99) }] };
    expect(failureCode(() => assertDelegationCheckpointIdentity(wrong))).toBe('activity-id-mismatch');
  });
  it('refuses a natural-key map that disagrees with the activity rows in either direction', () => {
    const enc = encodeDelegationNaturalKey(act);
    expect(failureCode(() => assertDelegationCheckpointIdentity({ ...cp, activityIdsByNaturalKey: {} }))).toBe('natural-key-map');
    expect(failureCode(() => assertDelegationCheckpointIdentity({ ...cp, activityIdsByNaturalKey: { [enc]: '0'.repeat(64) } }))).toBe('natural-key-map');
    expect(failureCode(() => assertDelegationCheckpointIdentity({ ...cp, activityIdsByNaturalKey: { ...cp.activityIdsByNaturalKey, [encodeDelegationNaturalKey(keyOf(Y))]: '1'.repeat(64) } }))).toBe('natural-key-map');
    expect(failureCode(() => assertDelegationCheckpointIdentity({ ...cp, activities: [act, act] }))).toBe('natural-key-map');
  });
  it('refuses an intent map that disagrees with the session rows\' explicitIntentAt', () => {
    expect(failureCode(() => assertDelegationCheckpointIdentity({ ...cp, coordinatorIntentByParent: { [delegationIntentKey(PARENT, INC)]: T(5) } }))).toBe('intent-map');
    const withIntent = { ...cp, sessions: cp.sessions.map((s) => ({ ...s, explicitIntentAt: T(5) })) };
    expect(failureCode(() => assertDelegationCheckpointIdentity(withIntent))).toBe('intent-map');
    expect(failureCode(() => assertDelegationCheckpointIdentity({ ...withIntent, coordinatorIntentByParent: { [delegationIntentKey(PARENT, INC)]: T(5) } }))).toBe('accepted');
    // The map is keyed by (session, incarnation): the bare session id is no key at all, so the old spelling is refused.
    expect(failureCode(() => assertDelegationCheckpointIdentity({ ...withIntent, coordinatorIntentByParent: { [PARENT]: T(5) } }))).toBe('intent-map');
  });

  describe('each lease\'s opening lineage row (hand-off 1 from the Task 7 re-review)', () => {
    const lease: DelegationLeaseRow = {
      leaseId: 'lease-1', generation: 0, creatingJournalSequence: 3, currentJournalSequence: 3, activityId: act.activityId, parentId: PARENT, parentIncarnation: INC,
      project: 'project-a', adminRecord: 'wt-1', canonicalPath: '/work/p/wt-1', creationBase: null, sourceKind: 'agent', parentageState: 'linked',
      workspaceState: 'unmeasured', disposition: 'ephemeral', cleanupState: 'not-due', cleanupPopulation: 'ephemeral-lease', firstObservedAt: T(7), lastObservedAt: T(7),
      terminalEvidenceAt: null, adoptedAt: null, retainedAt: null, promotedAt: null, cleanupDueAt: null, cleanupStartedAt: null, cleanupFinishedAt: null,
      cleanupEvidenceJson: null, carrierGenerationSeen: null, releasedAt: null,
    };
    const lineageId = deriveDelegationLineageId(lease);
    const opening: DelegationLineageRow = { lineageId, parentId: PARENT, parentIncarnation: INC, activityId: null, leaseId: 'lease-1', runId: null, openedAt: T(7), closedAt: null, closeReason: null };
    const withLease = (over: Partial<DelegationLineageRow> | null): DelegationCheckpointV1 =>
      ({ ...cp, leases: [lease], lineage: over === null ? [] : [{ ...opening, ...over }] });
    it('accepts the derived, lease-owned, same-parent row opened at the lease\'s firstObservedAt', () => {
      expect(failureCode(() => assertDelegationCheckpointIdentity(withLease({})))).toBe('accepted');
    });
    const table: Array<[string, Partial<DelegationLineageRow> | null]> = [
      ['no opening row at all', null],
      ['a row whose lineageId is not the derivation', { lineageId: 'c'.repeat(64) }],
      ['a row for another parent session', { parentId: 'lane-b-demo' }],
      ['a row for another incarnation', { parentIncarnation: 'g2' }],
      ['a row that also names an activity', { activityId: act.activityId }],
      ['a row opened at another instant', { openedAt: T(8) }],
      ['a row owned by another lease', { leaseId: 'lease-2' }],
    ];
    for (const [name, over] of table) {
      it(`refuses ${name}`, () => { expect(failureCode(() => assertDelegationCheckpointIdentity(withLease(over)))).toBe('lease-lineage'); });
    }
    it('refuses a lease-owned lineage row whose lease has no row, and one whose parent is not its lease\'s', () => {
      expect(failureCode(() => assertDelegationCheckpointIdentity({ ...cp, lineage: [opening] }))).toBe('lease-lineage');
      const stray: DelegationLineageRow = { ...opening, lineageId: 'd'.repeat(64), parentId: 'lane-b-demo' };
      expect(failureCode(() => assertDelegationCheckpointIdentity({ ...cp, leases: [lease], lineage: [opening, stray] }))).toBe('lease-lineage');
    });
  });
});

describe('projectability: a checkpoint no projection could accept is refused before it is durable', () => {
  const { cp } = ready([sessionStart(1), bareTool(2, X), subagentStart(3, X)]);
  const act = cp.activities[0]!;
  const lease: DelegationLeaseRow = {
    leaseId: 'lease-1', generation: 0, creatingJournalSequence: 3, currentJournalSequence: 3, activityId: act.activityId, parentId: PARENT, parentIncarnation: INC,
    project: 'project-a', adminRecord: 'wt-1', canonicalPath: '/work/p/wt-1', creationBase: null, sourceKind: 'agent', parentageState: 'linked',
    workspaceState: 'unmeasured', disposition: 'ephemeral', cleanupState: 'not-due', cleanupPopulation: 'ephemeral-lease', firstObservedAt: T(7), lastObservedAt: T(7),
    terminalEvidenceAt: null, adoptedAt: null, retainedAt: null, promotedAt: null, cleanupDueAt: null, cleanupStartedAt: null, cleanupFinishedAt: null,
    cleanupEvidenceJson: null, carrierGenerationSeen: null, releasedAt: null,
  };
  const lineage = (l: DelegationLeaseRow): DelegationLineageRow => ({ lineageId: deriveDelegationLineageId(l), parentId: l.parentId, parentIncarnation: l.parentIncarnation, activityId: null, leaseId: l.leaseId, runId: null, openedAt: l.firstObservedAt, closedAt: null, closeReason: null });
  const sess = cp.sessions[0]!;
  const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-deleg-proj-'), 'coord.db')));

  const table: Array<[string, DelegationCheckpointV1]> = [
    ['two sessions with one key', { ...cp, sessions: [sess, sess] }],
    ['a session last observed before it was first', { ...cp, sessions: [{ ...sess, lastObservedAt: T(0) }] }],
    ['an activity for a session that has no row', { ...cp, sessions: [] }],
    ['an activity that ended before it opened', { ...cp, activities: [{ ...act, executionState: 'ended', endedAt: T(0) }] }],
    ['an activity whose last event precedes its opening', { ...cp, activities: [{ ...act, lastEventAt: T(0) }] }],
    ['a lease for an activity with no row', { ...cp, activities: [], activityIdsByNaturalKey: {}, leases: [lease], lineage: [lineage(lease)] }],
    ['two unreleased leases on one canonical path', { ...cp, leases: [lease, { ...lease, leaseId: 'lease-2', creatingJournalSequence: 4, currentJournalSequence: 4, adminRecord: 'wt-2' }], lineage: [lineage(lease), lineage({ ...lease, leaseId: 'lease-2', adminRecord: 'wt-2' })] }],
    ['two unreleased leases on one identity tuple (and so one path)', { ...cp, leases: [lease, { ...lease, leaseId: 'lease-2', creatingJournalSequence: 4, currentJournalSequence: 4 }], lineage: [lineage(lease), lineage({ ...lease, leaseId: 'lease-2' })] }],
    ['two leases created at one journal sequence', { ...cp, leases: [lease, { ...lease, leaseId: 'lease-2', adminRecord: 'wt-2', canonicalPath: '/work/p/wt-2' }], lineage: [lineage(lease), lineage({ ...lease, leaseId: 'lease-2', adminRecord: 'wt-2', canonicalPath: '/work/p/wt-2' })] }],
    ['a lineage row owned by two things', { ...cp, leases: [lease], lineage: [lineage(lease), { ...lineage(lease), lineageId: 'e'.repeat(64), activityId: act.activityId }] }],
    ['a lineage row closed before it opened', { ...cp, leases: [lease], lineage: [{ ...lineage(lease), closedAt: T(1), closeReason: 'x' }] }],
    ['a lineage row with a closedAt and no reason', { ...cp, leases: [lease], lineage: [{ ...lineage(lease), closedAt: T(9), closeReason: null }] }],
    ['a linked attempt with no path', { ...cp, attempts: [{ attemptId: 'a1', parentId: PARENT, parentIncarnation: INC, project: 'p', adminRecord: 'w', canonicalPath: null, attemptedAt: T(1), rung: 2, verdict: 'linked', evidenceJournalIds: [], detail: null }] }],
  ];
  it('accepts the valid checkpoint, and the real store accepts it too', () => {
    expect(() => assertDelegationCheckpointProjectable({ ...cp, leases: [lease], lineage: [lineage(lease)] })).not.toThrow();
    store().projectDelegationCheckpoint({ ...cp, appliedJournalSequence: 3, leases: [lease], lineage: [lineage(lease)] });
  });
  for (const [name, bad] of table) {
    it(`refuses ${name}, exactly as SQLite would`, () => {
      expect(failureCode(() => assertDelegationCheckpointProjectable(bad))).toBe('unprojectable');
      // The differential, with no exception: wherever the pure check refuses, the real store refuses too (a SQLite error, or its
      // own pre-flight; a repeated session key is the store's `bad-checkpoint`, refused before BEGIN).
      expect(() => store().projectDelegationCheckpoint({ ...bad, appliedJournalSequence: Math.max(bad.appliedJournalSequence, 4) })).toThrow();
    });
  }
});

// ── the writer, deduplication ────────────────────────────────────────────────────────────────────────────────────────

/** Every descriptor a test's port has opened and not yet closed: after each test none may remain. */
const liveHandles = new Set<string>();
let handleSerial = 0;

/** A port that logs every operation and can be told to short-write or fail. */
function spyPort(log: string[], inner: DelegationFilePort = nodeDelegationFilePort, opts: { shortWrite?: boolean } = {}): DelegationFilePort {
  const track = (label: string): (() => void) => {
    const id = `${label}#${++handleSerial}`;
    liveHandles.add(id);
    return () => { liveHandles.delete(id); };
  };
  const wrap = (kind: 'journal' | 'checkpoint' | 'quarantine', h: DelegationFileHandle): DelegationFileHandle => {
    const release = track(kind);
    return {
      write: async (b) => {
        log.push(`${kind}.write:${b.length}:${b[b.length - 1]}`);
        if (opts.shortWrite === true && kind === 'journal') return h.write(b.subarray(0, Math.max(1, b.length - 3)));
        return h.write(b);
      },
      sync: async () => { log.push(`${kind}.sync`); await h.sync(); },
      close: async () => { release(); await h.close(); },
    };
  };
  return {
    openAppend: async (p) => wrap('journal', await inner.openAppend(p)),
    // The tail heal's quarantine copy goes through `createTemp` too (D-4655): it is logged under its own name.
    createTemp: async (p) => wrap(p.includes(DELEGATION_TORN_DIR) ? 'quarantine' : 'checkpoint', await inner.createTemp(p)),
    rename: async (a, b) => { log.push(`rename:${path.basename(a)}->${path.basename(b)}`); await inner.rename(a, b); },
    fsyncDir: async (d) => { log.push('dir.sync'); await inner.fsyncDir(d); },
    // The heal's two journal operations (D-4655): the cut, and the fsync of what is left.
    truncate: async (p, length) => { log.push(`${path.basename(p) === DELEGATION_JOURNAL_FILE ? 'journal' : 'file'}.truncate:${length}`); await inner.truncate(p, length); },
    fsyncFile: async (p) => { log.push(`file.sync:${path.basename(p)}`); await inner.fsyncFile(p); },
    readFile: (p) => inner.readFile(p),
    // MUST 1's boot report: two reads of the tail quarantine, not logged (no read is), so every write-order row is unchanged
    listDir: (d) => inner.listDir(d),
    statFile: (p) => inner.statFile(p),
    openRead: async (p) => {
      const h = await inner.openRead(p);
      if (h === null) return null;
      const release = track('read');
      return { size: () => h.size(), read: (pos, len) => h.read(pos, len), close: async () => { release(); await h.close(); } };
    },
    mkdirp: (d) => inner.mkdirp(d),
  };
}

describe('the serialized journal writer: O_APPEND, one complete write of record plus LF, then fsync', () => {
  const dirOf = (): string => mkTmp('ccrc-deleg-journal-');

  it('one append is exactly one write of the whole record plus its LF, and then one fsync, in that order', async () => {
    const dir = dirOf();
    const log: string[] = [];
    const writer = new DelegationJournalWriter(spyPort(log), path.join(dir, DELEGATION_JOURNAL_FILE), dir);
    const [r1] = evidenceChain([sessionStart(1)]);
    await writer.write(r1!);
    await writer.sync();
    await writer.close();
    const bytes = encodeDelegationJournalRecord(r1!);
    expect(log).toEqual([`journal.write:${bytes.length}:10`, 'journal.sync', 'dir.sync']);     // the directory entry of a NEW file is made durable once
    expect(new Uint8Array(readFileSync(path.join(dir, DELEGATION_JOURNAL_FILE)))).toEqual(bytes);
  });

  it('opens with O_APPEND: another descriptor\'s bytes are never overwritten', async () => {
    const dir = dirOf();
    const file = path.join(dir, DELEGATION_JOURNAL_FILE);
    const writer = new DelegationJournalWriter(nodeDelegationFilePort, file, dir);
    const [r1, r2] = evidenceChain([sessionStart(1), sessionStart(2)]);
    await writer.write(r1!);
    appendFileSync(file, 'x'.repeat(0));                  // a second descriptor appending behind the writer's back
    const middle = Buffer.from('EXTERNAL\n');
    appendFileSync(file, middle);
    // The writer's next write lands at the CURRENT end of the file, not at its own remembered offset.
    await writer.write(r2!);
    await writer.close();
    const all = readFileSync(file);
    expect(all.subarray(0, encodeDelegationJournalRecord(r1!).length)).toEqual(Buffer.from(encodeDelegationJournalRecord(r1!)));
    expect(all.indexOf(middle)).toBe(encodeDelegationJournalRecord(r1!).length);
    expect(all.subarray(all.length - encodeDelegationJournalRecord(r2!).length)).toEqual(Buffer.from(encodeDelegationJournalRecord(r2!)));
  });

  it('a short write is refused as short-write, and the writer is then unusable: nothing is appended behind a fragment', async () => {
    const dir = dirOf();
    const log: string[] = [];
    const writer = new DelegationJournalWriter(spyPort(log, nodeDelegationFilePort, { shortWrite: true }), path.join(dir, DELEGATION_JOURNAL_FILE), dir);
    const [r1] = evidenceChain([sessionStart(1)]);
    await expect(writer.write(r1!)).rejects.toMatchObject({ code: 'short-write' });
    await expect(writer.write(r1!)).rejects.toMatchObject({ code: 'writer-unusable' });
    await expect(writer.sync()).rejects.toMatchObject({ code: 'writer-unusable' });
    await writer.close();
  });

  it('refuses to open behind a torn tail, and leaves the file exactly as it was', async () => {
    const dir = dirOf();
    const file = path.join(dir, DELEGATION_JOURNAL_FILE);
    const [r1, r2] = evidenceChain([sessionStart(1), sessionStart(2)]);
    const torn = Buffer.concat([Buffer.from(encodeDelegationJournalRecord(r1!)), Buffer.from(encodeDelegationJournalRecord(r2!)).subarray(0, 40)]);
    writeFileSync(file, torn);
    const writer = new DelegationJournalWriter(nodeDelegationFilePort, file, dir);
    await expect(writer.write(r2!)).rejects.toMatchObject({ code: 'torn-tail' });
    await writer.close();
    expect(readFileSync(file)).toEqual(torn);
  });

  describe('deduplication plans (nothing renumbered, nothing appended for a duplicate)', () => {
    const noLeases = { byIdentity: () => undefined, byPath: () => undefined };
    const item = (e: DelegationEventEnvelopeV1) => ({ entry: evidence(e), acceptedAt: T(500) });

    it('a duplicate evidence eventId (already journaled, or earlier in the batch) is skipped and the chain closes over the survivors', () => {
      const [r1] = evidenceChain([sessionStart(1)]);
      const plan = planDelegationJournalAppend({
        head: { sequence: 1, journalId: r1!.journalId, digest: r1!.digest }, eventIds: new Set([eid(1)]), leases: noLeases,
        items: [item(sessionStart(1)), item(sessionStart(2)), item(sessionStart(2)), item(sessionStart(3))],
      });
      expect(plan.skipped).toEqual([{ index: 0, reason: 'duplicate-event' }, { index: 2, reason: 'duplicate-event' }]);
      expect(plan.records.map((r) => r.sequence)).toEqual([2, 3]);
      expect(plan.records[0]!.previousDigest).toBe(r1!.digest);
      expect(plan.records[1]!.previousDigest).toBe(plan.records[0]!.digest);
      expect(() => parseDelegationJournal(bytesOf([r1!, ...plan.records]), { completeFromStart: true })).not.toThrow();
    });

    const leaseEntry = (over: Record<string, unknown>): DelegationJournalEntryV1 => ({
      kind: 'lease-created', leaseId: 'lease-1', generation: 0, activityId: 'a'.repeat(64), parentId: PARENT, parentIncarnation: INC, project: 'project-a',
      adminRecord: 'wt-1', canonicalPath: '/work/p/wt-1', creationBase: null, sourceKind: 'agent', correlationJournalIds: [], firstObservedAt: T(1), lineageId: 'b'.repeat(64), ...over,
    } as DelegationJournalEntryV1);
    it('a duplicate unreleased lease identity, and a canonical path another lease holds, are skipped; a null base is not a string base', () => {
      const held = { byIdentity: (k: string) => (k === canonicalDelegationJson(['project-a', 'wt-1', null, '/work/p/wt-1']) ? 'lease-1' : undefined), byPath: (p: string) => (p === '/work/p/wt-1' ? 'lease-1' : undefined) };
      const plan = planDelegationJournalAppend({
        head: null, eventIds: new Set(), leases: held,
        items: [
          { entry: leaseEntry({ leaseId: 'lease-2' }), acceptedAt: T(5) },                                              // same identity
          { entry: leaseEntry({ leaseId: 'lease-3', creationBase: 'base-1' }), acceptedAt: T(5) },                       // other identity, same path
          { entry: leaseEntry({ leaseId: 'lease-4', canonicalPath: '/work/p/wt-4', adminRecord: 'wt-4' }), acceptedAt: T(5) },
          { entry: leaseEntry({ leaseId: 'lease-5', canonicalPath: '/work/p/wt-5', adminRecord: 'wt-4' }), acceptedAt: T(5) },   // same identity? no: other path
        ],
      });
      expect(plan.skipped).toEqual([{ index: 0, reason: 'duplicate-lease', leaseId: 'lease-1' }, { index: 1, reason: 'lease-path-held', leaseId: 'lease-1' }]);
      expect(plan.records.map((r) => r.entry.kind === 'lease-created' ? r.entry.leaseId : '')).toEqual(['lease-4', 'lease-5']);
    });
    it('two leases in ONE batch that collide are caught against each other', () => {
      const plan = planDelegationJournalAppend({
        head: null, eventIds: new Set(), leases: noLeases,
        items: [{ entry: leaseEntry({ leaseId: 'lease-1' }), acceptedAt: T(5) }, { entry: leaseEntry({ leaseId: 'lease-2' }), acceptedAt: T(5) }, { entry: leaseEntry({ leaseId: 'lease-3', creationBase: 'b' }), acceptedAt: T(5) }],
      });
      expect(plan.skipped).toEqual([{ index: 1, reason: 'duplicate-lease', leaseId: 'lease-1' }, { index: 2, reason: 'lease-path-held', leaseId: 'lease-1' }]);
    });
  });
});

// ── recovery ─────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('recoverDelegationState: reconstruction phases (O2)', () => {
  it('no checkpoint and no journal is a ready, empty state with every phase completed and pruning enabled', () => {
    const report = recoverDelegation(null, []);
    expect(report.failure).toBeNull();
    expect(report.state).toEqual({ checkpoint: emptyDelegationCheckpoint(), phase: 'ready' });
    expect(report.completedPhases).toEqual([...DELEGATION_RECOVERY_PHASES]);
    expect(report.pruning).toBe('enabled');
  });

  it('rebuilds sessions and an activity from the journal alone, with the ID derived from the accepted journalId of the earliest naming record', () => {
    const { records, cp } = ready([sessionStart(1), bareTool(2, X), subagentStart(3, X), bareTool(4, X)]);
    expect(cp.sessions).toHaveLength(1);
    expect(cp.sessions[0]).toMatchObject({ sessionId: PARENT, parentIncarnation: INC, claudeSessionIds: [CLAUDE], firstObservedAt: T(1), lastObservedAt: T(4), explicitIntentAt: null, effective: false });
    const act = activityOf(cp, X)!;
    expect(act.identityJournalId).toBe(records[1]!.journalId);                                  // the bare occurrence at sequence 2, not the join at 3
    expect(act.activityId).toBe(deriveDelegationActivityId(keyOf(X), records[1]!.journalId));
    expect(act).toMatchObject({ openedAt: T(2), lastEventAt: T(4), executionState: 'active', endedAt: null, displayName: null });
    expect(cp.activityIdsByNaturalKey).toEqual({ [encodeDelegationNaturalKey(keyOf(X))]: act.activityId });
    expect(cp.appliedJournalSequence).toBe(4);
    expect(cp.appliedJournalId).toBe(records[3]!.journalId);
  });

  it('only a qualifying join opens an activity: a bare agent_id and an unpaired stop do not', () => {
    const { cp } = ready([sessionStart(1), bareTool(2, X), subagentStop(3, Y)]);
    expect(cp.activities).toEqual([]);
    expect(cp.pruningHolds.filter((h) => h.reason === 'identity-candidate')).toHaveLength(2);
  });

  it('a launch response and a SubagentStart each qualify; a completed launch opens it already ended; a stop ends it', () => {
    const { cp } = ready([sessionStart(1), agentLaunch(2, X, 'completed'), agentLaunch(3, Y), subagentStop(4, Y)]);
    expect(activityOf(cp, X)).toMatchObject({ executionState: 'ended', endedAt: T(2), openedAt: T(2) });
    expect(activityOf(cp, Y)).toMatchObject({ executionState: 'ended', endedAt: T(4), openedAt: T(3) });
  });

  it('clamps endedAt and lastEventAt so no SQLite CHECK can fail on out-of-order observation times', () => {
    const early = { ...subagentStop(5, X), observedAt: T(1) } as DelegationEventEnvelopeV1;
    const { cp } = ready([sessionStart(2), subagentStart(3, X), early]);
    const act = activityOf(cp, X)!;
    expect(act.endedAt! >= act.openedAt).toBe(true);
    expect(act.lastEventAt >= act.openedAt).toBe(true);
    expect(() => assertDelegationCheckpointProjectable(cp)).not.toThrow();
  });

  it('events from two incarnations of one parent stay two sessions and two activities', () => {
    const { cp } = ready([sessionStart(1), subagentStart(2, X), sessionStart(3, { parentIncarnation: 'g2' }), subagentStart(4, X, { parentIncarnation: 'g2' })]);
    expect(cp.sessions.map((s) => s.parentIncarnation)).toEqual(['g1', 'g2']);
    expect(cp.activities).toHaveLength(2);
    expect(new Set(cp.activities.map((a) => a.activityId)).size).toBe(2);
  });

  describe('every recovery failure leaves the phase reconstructing and pruning disabled', () => {
    const events = [sessionStart(1), bareTool(2, X), sessionStart(3), subagentStart(4, X), sessionStart(5)];
    const records = evidenceChain(events);
    const good = recoverDelegation(null, records).state.checkpoint;
    const goodBytes = encodeDelegationCheckpoint(good);
    const at3 = recoverDelegation(null, records.slice(0, 3)).state.checkpoint;
    const at3Bytes = encodeDelegationCheckpoint(at3);
    const corrupt = (f: (c: Record<string, unknown>) => void): Uint8Array => {
      const c = JSON.parse(new TextDecoder().decode(goodBytes)) as Record<string, unknown>;
      f(c);
      return new TextEncoder().encode(`${canonicalDelegationJson(c)}\n`);
    };

    const failures: Array<[string, Uint8Array | null, readonly DelegationJournalRecordV1[], string]> = [
      ['a BOM on the checkpoint', new Uint8Array([0xef, 0xbb, 0xbf, ...goodBytes]), records, 'checkpoint-decode'],
      ['a non-canonical checkpoint', new TextEncoder().encode(`${uncanonical(new TextDecoder().decode(goodBytes).trimEnd())}\n`), records, 'checkpoint-decode'],
      ['an activity whose ID is not the derivation from its identity journalId', corrupt((c) => { (c['activities'] as Array<Record<string, unknown>>)[0]!['identityJournalId'] = eid(99); }), records, 'checkpoint-validate'],
      ['a natural-key map with an orphan mapping', corrupt((c) => { (c['activityIdsByNaturalKey'] as Record<string, string>)[encodeDelegationNaturalKey(keyOf(Y))] = '1'.repeat(64); }), records, 'checkpoint-validate'],
      ['an intent map the session rows do not say', corrupt((c) => { c['coordinatorIntentByParent'] = { [delegationIntentKey(PARENT, INC)]: T(9) }; }), records, 'checkpoint-validate'],
      ['a journal with a sequence gap', null, [records[0]!, records[1]!, records[3]!, records[4]!], 'journal-validate'],
      ['a journal with a broken chain (a record from another history)', null, [records[0]!, ...evidenceChain([sessionStart(2)], 2, 'd'.repeat(64)), records[2]!], 'journal-validate'],
      ['a checkpoint ahead of its journal (the journal was lost)', goodBytes, [], 'journal-validate'],
      ['a checkpoint ahead of a shorter journal', goodBytes, records.slice(0, 3), 'journal-validate'],
      ['an anchor whose digest the journal does not hold', corrupt((c) => { c['appliedJournalDigest'] = 'f'.repeat(64); }), records, 'journal-validate'],
      ['a retained journal that begins past the checkpoint', at3Bytes, records.slice(4), 'journal-validate'],
      ['a held identity record the journal no longer retains', at3Bytes, records.slice(2), 'holds'],
      ['a join inside the applied journal for an agent the checkpoint does not hold', encodeDelegationCheckpoint({ ...good, activities: [], activityIdsByNaturalKey: {}, pruningHolds: good.pruningHolds.filter((h) => h.reason === 'checkpoint-anchor') }), records, 'identity-evidence'],
      ['a lease in the checkpoint that no journal entry created', encodeDelegationCheckpoint(withLeaseRow(good)), records, 'final-validate'],
      ['a journal record the fold refuses (a lease for an activity nothing holds)', null, chainOf([evidence(sessionStart(1)), leaseEntryFor('a'.repeat(64))]), 'suffix-replay'],
    ];
    for (const [name, checkpointBytes, journal, phase] of failures) {
      it(`${name}: fails in ${phase}`, () => {
        const report = recoverDelegation(checkpointBytes, journal);
        expect(report.failure?.phase, JSON.stringify(report.failure)).toBe(phase);
        expect(report.state.phase).toBe('reconstructing');
        expect(report.pruning).toBe('disabled');
        expect(report.facts).toBeNull();
        expect(report.completedPhases).not.toContain('final-validate');
        // Pruning is a function of the state: the plan refuses on every one of them.
        const plan = planDelegationPruning({ state: report.state, view: delegationRetentionViewOf(journal, new Set(), NO_FLOOR) });
        expect(plan.enabled).toBe(false);
        expect(plan.prunableThroughSequence).toBe(0);
        // The plan's entry point agrees.
        expect(recoverDelegationState(checkpointBytes, journal).phase).toBe('reconstructing');
      });
    }
    it('a failed recovery keeps the best checkpoint it decoded; one that could not decode keeps the empty one', () => {
      expect(recoverDelegation(goodBytes, []).state.checkpoint).toEqual(good);
      expect(recoverDelegation(new Uint8Array([1, 2, 3]), records).state.checkpoint).toEqual(emptyDelegationCheckpoint());
    });
    it('a complete recovery enables pruning, and only a complete one', () => {
      const report = recoverDelegation(goodBytes, records);
      expect(report.failure).toBeNull();
      expect(report.pruning).toBe('enabled');
      expect(report.state.phase).toBe('ready');
    });
  });
});

function leaseEntryFor(activityId: string, over: Record<string, unknown> = {}): DelegationJournalEntryV1 {
  const leaseId = typeof over['leaseId'] === 'string' ? over['leaseId'] : 'lease-1';
  const lineageId = deriveDelegationLineageId({ leaseId, parentId: PARENT, parentIncarnation: INC, activityId });
  return {
    kind: 'lease-created', leaseId, generation: 0, activityId, parentId: PARENT, parentIncarnation: INC, project: 'project-a', adminRecord: 'wt-1',
    canonicalPath: '/work/project-a/wt-1', creationBase: null, sourceKind: 'agent', correlationJournalIds: [], firstObservedAt: T(7), lineageId, ...over,
  } as DelegationJournalEntryV1;
}

function withLeaseRow(cp: DelegationCheckpointV1): DelegationCheckpointV1 {
  const act = cp.activities[0]!;
  const lease: DelegationLeaseRow = {
    leaseId: 'lease-9', generation: 0, creatingJournalSequence: 2, currentJournalSequence: 2, activityId: act.activityId, parentId: PARENT, parentIncarnation: INC,
    project: 'project-a', adminRecord: 'wt-9', canonicalPath: '/work/project-a/wt-9', creationBase: null, sourceKind: 'agent', parentageState: 'linked',
    workspaceState: 'unmeasured', disposition: 'ephemeral', cleanupState: 'not-due', cleanupPopulation: 'ephemeral-lease', firstObservedAt: T(7), lastObservedAt: T(7),
    terminalEvidenceAt: null, adoptedAt: null, retainedAt: null, promotedAt: null, cleanupDueAt: null, cleanupStartedAt: null, cleanupFinishedAt: null,
    cleanupEvidenceJson: null, carrierGenerationSeen: null, releasedAt: null,
  };
  const lineage: DelegationLineageRow = { lineageId: deriveDelegationLineageId(lease), parentId: PARENT, parentIncarnation: INC, activityId: null, leaseId: 'lease-9', runId: null, openedAt: T(7), closedAt: null, closeReason: null };
  return { ...cp, leases: [lease], lineage: [lineage] };
}

// ── W3-M16, W3-M17, W3-M14, W3-M18: identity across the checkpoint boundary ─────────────────────────────────────────────

describe('sequence-10 / position-20 row (W3-M16): retained pre-checkpoint evidence for an activity absent from the checkpoint', () => {
  // 20 records; the bare occurrence of X is sequence 10; the checkpoint covers all 20 and holds no activity for X; the join is 21.
  const filler = (n: number): DelegationEventEnvelopeV1 => sessionStart(n);
  const events20 = Array.from({ length: 20 }, (_, i) => (i + 1 === 10 ? bareTool(10, X) : filler(i + 1)));
  const records20 = evidenceChain(events20);
  const at20 = recoverDelegation(null, records20);
  const bytes20 = encodeDelegationCheckpoint(at20.state.checkpoint);
  const join = evidenceChain([subagentStart(21, X)], 21, records20[19]!.digest);
  const records21 = [...records20, ...join];
  const E1 = records20[9]!;

  it('the checkpoint at position 20 holds no activity for X, but holds the identity record: position is not coverage', () => {
    expect(at20.state.checkpoint.appliedJournalSequence).toBe(20);
    expect(activityOf(at20.state.checkpoint, X)).toBeUndefined();
    expect(at20.state.checkpoint.pruningHolds).toContainEqual({ journalId: E1.journalId, reason: 'identity-candidate', ownerId: encodeDelegationNaturalKey(keyOf(X)) });
  });

  it('the join at 21 opens the activity from the RETAINED record at 10, selected by its accepted journalId, not the join\'s and never the envelope eventId', () => {
    const report = recoverDelegation(bytes20, records21);
    expect(report.failure).toBeNull();
    const act = activityOf(report.state.checkpoint, X)!;
    expect(act.identityJournalId).toBe(E1.journalId);
    expect(act.activityId).toBe(deriveDelegationActivityId(keyOf(X), E1.journalId));
    expect(act.activityId).not.toBe(deriveDelegationActivityId(keyOf(X), join[0]!.journalId));            // what ignoring the pre-checkpoint record would pick
    const rawEventId = (E1.entry as { event: { eventId: string } }).event.eventId;
    expect(act.activityId).not.toBe(deriveDelegationActivityId(keyOf(X), rawEventId));                     // the raw envelope eventId is a different, rejected value
    expect(act.openedAt).toBe(T(10));
    expect(report.replayed).toBe(1);
    // A recovery from the journal alone reaches the same ID: replay and the live path are one fold.
    expect(activityOf(recoverDelegation(null, records21).state.checkpoint, X)!.activityId).toBe(act.activityId);
  });

  it('the candidate\'s hold is released once the checkpoint holds the ID, and not before', () => {
    const after = recoverDelegation(bytes20, records21).state.checkpoint;
    expect(after.pruningHolds.filter((h) => h.reason === 'identity-candidate')).toEqual([]);
    expect(Object.keys(after.activityIdsByNaturalKey)).toHaveLength(1);
  });
});

describe('identity-hold row (W3-M17): positional checkpoint coverage does not substitute for selected-ID coverage', () => {
  const events = [sessionStart(1), bareTool(2, X), sessionStart(3), sessionStart(4), sessionStart(5), sessionStart(6)];
  const records = evidenceChain(events);
  const state = recoverDelegation(null, records).state;
  const ownerId = encodeDelegationNaturalKey(keyOf(X));
  const view = delegationRetentionViewOf(records, new Set(state.checkpoint.pruningHolds.map((h) => h.journalId)), NO_FLOOR);

  it('the record at 2 is held although the checkpoint\'s position (6) is past it', () => {
    expect(state.checkpoint.appliedJournalSequence).toBe(6);
    expect(state.checkpoint.pruningHolds).toContainEqual({ journalId: records[1]!.journalId, reason: 'identity-candidate', ownerId });
  });
  it('so the plan may prune nothing from sequence 2 on, however far the checkpoint has applied', () => {
    const plan = planDelegationPruning({ state, view });
    expect(plan.enabled).toBe(true);
    expect(plan.prunableThroughSequence).toBe(1);                       // the identity record at 2 is held; only sequence 1 may go
  });
  it('once a checkpoint holds the selected ID, the hold is released and the plan is bounded by the anchor alone', () => {
    const joined = evidenceChain([...events, subagentStart(7, X)]);
    const after = recoverDelegation(null, joined).state;
    expect(after.checkpoint.pruningHolds.map((h) => h.reason)).toEqual(['checkpoint-anchor']);
    const plan = planDelegationPruning({ state: after, view: delegationRetentionViewOf(joined, new Set(after.checkpoint.pruningHolds.map((h) => h.journalId)), NO_FLOOR) });
    expect(plan.prunableThroughSequence).toBe(6);                       // strictly before the anchor at 7
  });
});

describe('O4 immutable natural-key row (W3-M14): a mapped activity keeps its ID though its identity record has been pruned', () => {
  // The identity record is sequence 3; the checkpoint covers through 8; the retained journal begins at 5 (3 was pruned).
  const events = [sessionStart(1), sessionStart(2), subagentStart(3, X), sessionStart(4), sessionStart(5), bareTool(6, X), sessionStart(7), sessionStart(8)];
  const all = evidenceChain(events);
  const original = recoverDelegation(null, all);
  const act = activityOf(original.state.checkpoint, X)!;
  const bytes = encodeDelegationCheckpoint(original.state.checkpoint);
  const retained = [...all.slice(4), ...evidenceChain([subagentStart(9, X), bareTool(10, X)], 9, all[7]!.digest)];

  it('the checkpoint holds the mapping, so no hold keeps the pruned identity record', () => {
    expect(act.identityJournalId).toBe(all[2]!.journalId);
    expect(original.state.checkpoint.pruningHolds.map((h) => h.reason)).toEqual(['checkpoint-anchor']);
  });
  it('recovery over the pruned journal restores the ID verbatim, never rehashing from what is still retained', () => {
    const report = recoverDelegation(bytes, retained);
    expect(report.failure).toBeNull();
    const after = activityOf(report.state.checkpoint, X)!;
    expect(after.activityId).toBe(act.activityId);
    expect(after.identityJournalId).toBe(all[2]!.journalId);
    expect(after.openedAt).toBe(act.openedAt);
    expect(report.state.checkpoint.activities).toHaveLength(1);
    expect(report.state.checkpoint.activityIdsByNaturalKey).toEqual(original.state.checkpoint.activityIdsByNaturalKey);
    // What a rehash would have produced: the earliest RETAINED naming record is sequence 6.
    expect(after.activityId).not.toBe(deriveDelegationActivityId(keyOf(X), all[5]!.journalId));
    expect(after.lastEventAt).toBe(T(10));              // later evidence still touches the mapped activity
  });
  it('a retained journal that begins past the original identity record is not a recovery failure for a mapped activity', () => {
    expect(recoverDelegation(bytes, retained).state.phase).toBe('ready');
  });
});

describe('replay-preserves-projection row (W3-M18): replay never changes a projected ID or generation', () => {
  const events = [sessionStart(1), bareTool(2, X), subagentStart(3, X), subagentStart(4, Y)];
  const base4 = evidenceChain(events);
  const baseState = recoverDelegation(null, base4).state.checkpoint;
  const leaseRecords = chainOf([leaseEntryFor(activityOf(baseState, X)!.activityId)], 5, base4[3]!.digest);
  const all5 = [...base4, ...leaseRecords];

  it('a checkpoint plus the retained suffix equals the journal replayed from nothing: same IDs, same generation, same rows', () => {
    const viaCheckpoint = recoverDelegation(encodeDelegationCheckpoint(baseState), all5);
    const viaJournal = recoverDelegation(null, all5);
    expect(viaCheckpoint.failure).toBeNull();
    expect(withoutRevision(viaCheckpoint.state.checkpoint)).toBe(withoutRevision(viaJournal.state.checkpoint));
    expect(viaCheckpoint.state.checkpoint.leases.map((l) => [l.leaseId, l.generation])).toEqual([['lease-1', 0]]);
    expect(viaCheckpoint.state.checkpoint.activities.map((a) => a.activityId)).toEqual(baseState.activities.map((a) => a.activityId));
    // Independently of the fold: X's ID is the derivation from the bare occurrence at 2, and Y's from its own SubagentStart at 4.
    expect(activityOf(viaCheckpoint.state.checkpoint, X)!.activityId).toBe(deriveDelegationActivityId(keyOf(X), base4[1]!.journalId));
    expect(activityOf(viaCheckpoint.state.checkpoint, Y)!.activityId).toBe(deriveDelegationActivityId(keyOf(Y), base4[3]!.journalId));
    expect(activityOf(viaJournal.state.checkpoint, X)!.activityId).toBe(activityOf(viaCheckpoint.state.checkpoint, X)!.activityId);
  });
  it('replaying a record already covered, over a checkpoint that holds it, changes nothing', () => {
    const full = recoverDelegation(null, all5).state.checkpoint;
    const again = recoverDelegation(encodeDelegationCheckpoint(full), all5);
    expect(withoutRevision(again.state.checkpoint)).toBe(withoutRevision(full));
    expect(again.replayed).toBe(0);
  });
  it('the replayed state projects to exactly the rows the checkpoint stands for', () => {
    const store = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-deleg-replay-'), 'coord.db')));
    const cp = recoverDelegation(null, all5).state.checkpoint;
    store.projectDelegationCheckpoint(cp);
    expect(canonicalDelegationJson(store.readDelegationProjection())).toBe(canonicalDelegationJson(projectionViewOfDelegationCheckpoint(cp)));
  });
  it('a record out of the chain, or a second creation of the same lease, is refused by the fold', () => {
    const dup = chainOf([leaseEntryFor(activityOf(baseState, X)!.activityId), leaseEntryFor(activityOf(baseState, X)!.activityId)], 5, base4[3]!.digest);
    expect(recoverDelegation(null, [...base4, ...dup]).failure?.phase).toBe('suffix-replay');
    const builder = DelegationCheckpointBuilder.from(emptyDelegationCheckpoint());
    expect(failureCode(() => builder.foldRecord(base4[1]!))).toBe('fold-refused');
  });
});

// ── lease-created: the journal alone creates leases ──────────────────────────────────────────────────────────────────

describe('lease replay: first and last observation and the lineage opening come from the entry, never from replay time or acceptedAt', () => {
  const events = [sessionStart(1), subagentStart(2, X)];
  const base2 = evidenceChain(events);
  const act = activityOf(recoverDelegation(null, base2).state.checkpoint, X)!;
  const lease = chainOf([leaseEntryFor(act.activityId, { firstObservedAt: T(40) })], 3, base2[1]!.digest);
  const cp = recoverDelegation(null, [...base2, ...lease]).state.checkpoint;

  it('sets firstObservedAt, lastObservedAt and the lineage openedAt to the entry\'s firstObservedAt', () => {
    expect(lease[0]!.acceptedAt).not.toBe(T(40));                      // acceptedAt is deliberately another instant
    expect(cp.leases[0]).toMatchObject({ leaseId: 'lease-1', generation: 0, creatingJournalSequence: 3, currentJournalSequence: 3, firstObservedAt: T(40), lastObservedAt: T(40) });
    expect(cp.lineage).toHaveLength(1);
    expect(cp.lineage[0]).toMatchObject({ leaseId: 'lease-1', activityId: null, runId: null, openedAt: T(40), closedAt: null, parentId: PARENT, parentIncarnation: INC });
    expect(cp.lineage[0]!.lineageId).toBe(deriveDelegationLineageId({ leaseId: 'lease-1', parentId: PARENT, parentIncarnation: INC, activityId: act.activityId }));
  });
  it('writes only the wave-3 constants: parentage linked, workspace unmeasured, ephemeral, not-due, every transition field null', () => {
    expect(cp.leases[0]).toMatchObject({
      parentageState: 'linked', workspaceState: 'unmeasured', disposition: 'ephemeral', cleanupState: 'not-due', cleanupPopulation: 'ephemeral-lease',
      terminalEvidenceAt: null, adoptedAt: null, retainedAt: null, promotedAt: null, cleanupDueAt: null, cleanupStartedAt: null, cleanupFinishedAt: null,
      cleanupEvidenceJson: null, carrierGenerationSeen: null, releasedAt: null,
    });
  });
  it('holds the creating record and its correlation evidence, for the lease and for its open lineage', () => {
    const evidenceId = base2[1]!.journalId;
    const withEvidence = chainOf([leaseEntryFor(act.activityId, { correlationJournalIds: [evidenceId] })], 3, base2[1]!.digest);
    const held = recoverDelegation(null, [...base2, ...withEvidence]).state.checkpoint.pruningHolds;
    const reasons = (r: string) => held.filter((h) => h.reason === r).map((h) => h.journalId).sort();
    expect(reasons('open-lease')).toEqual([evidenceId, withEvidence[0]!.journalId].sort());
    expect(reasons('open-lineage')).toEqual([evidenceId, withEvidence[0]!.journalId].sort());
  });
  it('a checkpoint lease whose entry differs from the journal\'s in any identity column fails the proof', () => {
    const goodBytes = encodeDelegationCheckpoint(cp);
    expect(recoverDelegation(goodBytes, [...base2, ...lease]).failure).toBeNull();
    for (const field of ['project', 'adminRecord', 'canonicalPath', 'sourceKind', 'creationBase', 'firstObservedAt'] as const) {
      const changed: Record<string, unknown> = { project: 'project-z', adminRecord: 'wt-z', canonicalPath: '/work/z', sourceKind: 'workflow', creationBase: 'base-z', firstObservedAt: T(41) };
      const tampered = { ...cp, leases: [{ ...cp.leases[0]!, [field]: changed[field], ...(field === 'firstObservedAt' ? { lastObservedAt: T(41) } : {}) }] };
      const bad = field === 'firstObservedAt' ? { ...tampered, lineage: [{ ...cp.lineage[0]!, openedAt: T(41) }] } : tampered;
      const report = recoverDelegation(encodeDelegationCheckpoint(bad), [...base2, ...lease]);
      expect(report.failure?.phase, field).toMatch(/checkpoint-validate|final-validate/);
      expect(report.state.phase).toBe('reconstructing');
    }
  });
  it('a lease whose creatingJournalSequence names an evidence record, not a lease-created one, fails the proof', () => {
    const moved = { ...cp, leases: [{ ...cp.leases[0]!, creatingJournalSequence: 2, currentJournalSequence: 2 }] };
    const report = recoverDelegation(encodeDelegationCheckpoint(moved), [...base2, ...lease]);
    expect(report.failure?.phase).toBe('final-validate');
    expect(report.failure?.code).toBe('lease-proof');
  });
  it('a retained lease-created entry the checkpoint has applied but has no row for fails the proof', () => {
    const without = { ...cp, leases: [], lineage: [] };
    const report = recoverDelegation(encodeDelegationCheckpoint(without), [...base2, ...lease]);
    expect(report.failure?.code).toBe('lease-proof');
  });
});

// ── the durable applier ──────────────────────────────────────────────────────────────────────────────────────────────

interface Harness {
  dir: string;
  store: CoordStore;
  log: string[];
  clock: { ms: number };
  uuids: string[];
  uuidCalls: { n: number };
  deps: (over?: Partial<DelegationDurabilityDeps>) => DelegationDurabilityDeps;
  open: (over?: Partial<DelegationDurabilityDeps>) => Promise<DelegationDurability>;
}

/** Every applier a test opens, closed after the test so no descriptor is left to the garbage collector. */
const opened: DelegationDurability[] = [];
const track = (d: DelegationDurability): DelegationDurability => { opened.push(d); return d; };
afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.close().catch(() => undefined)));
  const leaked = [...liveHandles];
  liveHandles.clear();
  expect(leaked, 'descriptors left open by the test').toEqual([]);
});

function harness(opts: { dir?: string; store?: CoordStore } = {}): Harness {
  const dir = opts.dir ?? mkTmp('ccrc-deleg-dur-');
  const store = opts.store ?? new CoordStore(openCoordDb(path.join(dir, 'coord.db')));
  const log: string[] = [];
  const clock = { ms: Date.UTC(2026, 9, 15) };
  const uuids = ['5b0d9d9e-6d3c-4d2e-9f7a-0a1b2c3d4e5f', '6c1e0eaf-7e4d-4e3f-8a8b-1b2c3d4e5f60', '7d2f1fb0-8f5e-4f40-9b9c-2c3d4e5f6071'];
  const uuidCalls = { n: 0 };
  const real = delegationProjectionPortOfStore(store);
  const projection: DelegationProjectionPort = {
    project: (cp) => { log.push('project'); real.project(cp); },
    insertEvents: (rows) => { log.push(`insertEvents:${rows.length}`); return real.insertEvents(rows); },
    eventStats: () => real.eventStats(),
  };
  const deps = (over: Partial<DelegationDurabilityDeps> = {}): DelegationDurabilityDeps => ({
    dir, projection, port: spyPort(log), now: () => clock.ms, randomUUID: () => { uuidCalls.n++; return uuids.shift() ?? `generated-${uuidCalls.n}`; }, ...over,
  });
  return { dir, store, log, clock, uuids, uuidCalls, deps, open: async (over) => track(await DelegationDurability.open(deps(over))) };
}

const batch = (events: readonly DelegationEventEnvelopeV1[], extra: { cursor?: Parameters<DelegationDurability['applyAccepted']>[0]['cursor']; interval?: Parameters<DelegationDurability['applyAccepted']>[0]['interval'] } = {}) =>
  ({ accepted: events.map((event) => ({ event })), cursor: extra.cursor ?? null, interval: extra.interval ?? null });
const cursorFor = (bucket: string, cursor: number) => ({ sessionId: PARENT, parentIncarnation: INC, bucket, cursor, lastSize: cursor, lastCompleteAt: T(9), intervalState: 'measured' as const, detail: null, anchor: cursor > 0 ? { start: 0, sha256: 'a'.repeat(64) } : null, replaced: false });
const intervalFor = (utcHour: string, state: 'measured' | 'unmeasured', recordedAt: string) => ({ sessionId: PARENT, parentIncarnation: INC, utcHour, state, detail: null, recordedAt });
const readDisk = (dir: string): { journal: Buffer | null; checkpoint: Buffer | null } => ({
  journal: existsSync(path.join(dir, DELEGATION_JOURNAL_FILE)) ? readFileSync(path.join(dir, DELEGATION_JOURNAL_FILE)) : null,
  checkpoint: existsSync(path.join(dir, DELEGATION_CHECKPOINT_FILE)) ? readFileSync(path.join(dir, DELEGATION_CHECKPOINT_FILE)) : null,
});

describe('the durable applier: O5 ordering, the entry point Task 9 calls', () => {
  it('opens on an empty directory ready, writes nothing, and enables pruning', async () => {
    const h = harness();
    const dur = await h.open();
    expect(dur.failure()).toBeNull();
    expect(dur.state().phase).toBe('ready');
    expect(dur.pruningEnabled()).toBe(true);
    expect(readDisk(h.dir)).toEqual({ journal: null, checkpoint: null });
    expect(h.log).toEqual(['project']);                      // the (empty) projection is made at open
  });

  it('applies a batch in O5 order: append, fsync, (build), temp write, temp fsync, rename, directory fsync, and only then SQLite', async () => {
    const h = harness();
    const dur = await h.open();
    h.log.length = 0;
    const edges: string[] = [];
    const out = await h.open({ onEdge: (edge, when) => { edges.push(`${edge}:${when}`); } }).then(async (d) => {
      h.log.length = 0;
      edges.length = 0;
      return d.applyAccepted(batch([sessionStart(1)]));
    });
    expect(h.log).toEqual([
      expect.stringMatching(/^journal\.write:\d+:10$/), 'journal.sync', 'dir.sync',                        // the new journal's entry is made durable once
      expect.stringMatching(/^checkpoint\.write:\d+:10$/), 'checkpoint.sync', 'rename:delegation-checkpoint.json.tmp->delegation-checkpoint.json', 'dir.sync',
      'project', 'insertEvents:1',
    ]);
    expect(edges).toEqual(DELEGATION_DURABILITY_EDGES.flatMap((e) => [`${e}:before`, `${e}:after`]));
    expect(out.durable).toBe(true);
    expect(out.projection.status).toBe('projected');
    expect(dur.state().phase).toBe('ready');
    expect(existsSync(path.join(h.dir, `${DELEGATION_CHECKPOINT_FILE}.tmp`))).toBe(false);          // the temp file was renamed away
  });

  it('writes records and a checkpoint that recovery reads back to the same state', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([sessionStart(1), bareTool(2, X), subagentStart(3, X)], { cursor: cursorFor('2026101400', 300), interval: intervalFor('2026101400', 'measured', T(3)) }));
    const disk = readDisk(h.dir);
    const records = parseDelegationJournal(new Uint8Array(disk.journal!), { completeFromStart: true });
    expect(records.map((r) => r.sequence)).toEqual([1, 2, 3]);
    expect(records.every((r) => r.acceptedAt === formatDelegationInstant(h.clock.ms))).toBe(true);      // the INJECTED clock stamped them
    const cp = decodeDelegationCheckpoint(new Uint8Array(disk.checkpoint!));
    expect(cp).toEqual(dur.state().checkpoint);
    expect(cp.revision).toBe(1);
    expect(cp.bucketCursors).toHaveLength(1);
    expect(cp.observationIntervals).toHaveLength(1);
    const fresh = await harness({ dir: h.dir }).open();
    expect(fresh.state().checkpoint).toEqual(cp);
  });

  it('a duplicate evidence eventId is not appended again, in the same batch or a later one', async () => {
    const h = harness();
    const dur = await h.open();
    const first = await dur.applyAccepted(batch([sessionStart(1), sessionStart(1), sessionStart(2)]));
    expect(first.appended.map((r) => r.sequence)).toEqual([1, 2]);
    expect(first.skipped).toEqual([{ index: 1, reason: 'duplicate-event' }]);
    const again = await dur.applyAccepted(batch([sessionStart(2)]));
    expect(again.appended).toEqual([]);
    expect(again.durable).toBe(false);
    expect(parseDelegationJournal(new Uint8Array(readDisk(h.dir).journal!)).length).toBe(2);
  });

  it('a re-read of bytes that were journaled before their cursor advanced appends nothing and still advances the cursor', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([sessionStart(1)]));
    const out = await dur.applyAccepted(batch([sessionStart(1)], { cursor: cursorFor('2026101400', 100) }));
    expect(out.appended).toEqual([]);
    expect(out.durable).toBe(true);                                // a checkpoint-only replacement: the cursor moved
    expect(dur.state().checkpoint.revision).toBe(2);
    expect(dur.state().checkpoint.appliedJournalSequence).toBe(1);     // no journal sequence was invented
    expect(dur.state().checkpoint.bucketCursors).toHaveLength(1);
  });

  it('an application that changes nothing writes nothing and keeps the revision', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([sessionStart(1)], { cursor: cursorFor('2026101400', 100) }));
    h.log.length = 0;
    const out = await dur.applyAccepted(batch([], { cursor: cursorFor('2026101400', 100) }));
    expect(out.durable).toBe(false);
    expect(h.log).toEqual([]);
    expect(dur.state().checkpoint.revision).toBe(1);
  });

  it('an unmeasured hour stays unmeasured when a later read of it is measured', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([], { interval: intervalFor('2026101400', 'unmeasured', T(5)) }));
    await dur.applyAccepted(batch([], { interval: intervalFor('2026101400', 'measured', T(9)) }));
    expect(dur.state().checkpoint.observationIntervals.map((i) => i.state)).toEqual(['unmeasured']);
  });

  it('projects ONCE per application and inserts the batch\'s events in ONE call', async () => {
    const h = harness();
    const dur = await h.open();
    h.log.length = 0;
    await dur.applyAccepted(batch([sessionStart(1), sessionStart(2), sessionStart(3), sessionStart(4)]));
    expect(h.log.filter((l) => l === 'project')).toHaveLength(1);
    expect(h.log.filter((l) => l.startsWith('insertEvents'))).toEqual(['insertEvents:4']);
    expect(h.log.indexOf('project')).toBeGreaterThan(h.log.lastIndexOf('dir.sync'));
  });

  it('rejects a cursor that recovery could not read, before anything is written', async () => {
    const h = harness();
    const dur = await h.open();
    h.log.length = 0;
    await expect(dur.applyAccepted(batch([sessionStart(1)], { cursor: { ...cursorFor('b', 1), lastCompleteAt: 'yesterday' } }))).rejects.toThrow();
    expect(h.log).toEqual([]);
    expect(readDisk(h.dir)).toEqual({ journal: null, checkpoint: null });
    expect(dur.failure()).toBeNull();                                  // a refusal before step 1 is not a failed application
    await dur.applyAccepted(batch([sessionStart(1)]));
  });

  it('a checkpoint-only change whose rows recovery could not read is refused before anything is written', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([sessionStart(1)]));
    const before = readDisk(h.dir);
    h.log.length = 0;
    await expect(dur.applyCheckpointChange((cp) => ({ ...cp, bucketCursors: [{ ...cursorFor('b', 1), lastCompleteAt: 'yesterday' }] }))).rejects.toMatchObject({ code: 'bad-shape' });
    await expect(dur.applyCheckpointChange((cp) => ({ ...cp, observationIntervals: [{ ...intervalFor('h', 'measured', T(1)), state: 'maybe' as 'measured' }] }))).rejects.toMatchObject({ code: 'bad-shape' });
    expect(h.log).toEqual([]);
    expect(readDisk(h.dir)).toEqual(before);
    expect(dur.failure()).toBeNull();
  });

  it('keeps applications serialized: concurrent calls get contiguous sequences and a single chain', async () => {
    const h = harness();
    const dur = await h.open();
    const outs = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => dur.applyAccepted(batch([sessionStart(n)]))));
    expect(outs.map((o) => o.appended[0]!.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(() => parseDelegationJournal(new Uint8Array(readDisk(h.dir).journal!), { completeFromStart: true })).not.toThrow();
    expect(dur.state().checkpoint.revision).toBe(6);
  });
});

// ── the fault matrix (W3-M15) ────────────────────────────────────────────────────────────────────────────────────────

class SimulatedCrash extends Error {}

/** Copies a directory, optionally reverting what a power loss would lose: a journal tail that was never fsynced and a rename
 *  whose directory entry was never fsynced. */
function copyDisk(from: string, opts: { journalSyncedSize?: number; checkpointBytes?: Buffer | null }): string {
  const to = mkTmp('ccrc-deleg-crash-');
  for (const f of readdirSync(from)) if (f === DELEGATION_JOURNAL_FILE || f === DELEGATION_CHECKPOINT_FILE) cpSync(path.join(from, f), path.join(to, f));
  if (opts.journalSyncedSize !== undefined && existsSync(path.join(to, DELEGATION_JOURNAL_FILE))) truncateSync(path.join(to, DELEGATION_JOURNAL_FILE), opts.journalSyncedSize);
  if (opts.checkpointBytes !== undefined) {
    if (opts.checkpointBytes === null) { try { writeFileSync(path.join(to, DELEGATION_CHECKPOINT_FILE), ''); } catch { /* none */ } }
    else writeFileSync(path.join(to, DELEGATION_CHECKPOINT_FILE), opts.checkpointBytes);
  }
  return to;
}

// THE TWO DISK MODELS, AND THE THIRD OUTCOME. Each crash below is recovered under a process crash (every issued write survives) and a
// power loss (only fsynced bytes survive). Both models treat an unfsynced journal tail as vanishing WHOLE, which is the clean case.
// A real power loss in the middle of an append can instead leave a PARTIAL last record, and that is the honest third result: not the
// old state and not the new one but a torn tail. Under D-4655 (the operator's ruling of 2026-10-15) a torn tail HEALS ITSELF: it is
// healable when every complete record validates with an intact chain and the checkpoint names a complete record or none, and then
// recovery cuts it off (keeping the bytes) so the next pass re-mints what it held; anything else is corruption and stays a recovery
// FAILURE. It is pinned by "every position of a torn tail on disk" and "a torn journal tail the checkpoint names" below and by the
// D-4655 describe; this matrix is the "old or new" half of the guarantee, and those rows are the third.
describe('O5 fault matrix (W3-M15): a crash injected at EVERY edge, before and after, leaves the old state or the new one', () => {
  const EDGES = DELEGATION_DURABILITY_EDGES.filter((e) => e !== 'project');
  /** After these (edge, when) pairs the checkpoint replacement has completed in the process-crash model. */
  const checkpointDurable = (edge: DelegationDurabilityEdge, when: 'before' | 'after'): boolean =>
    edge === 'project' || (edge === 'directory-fsync' && when === 'after');
  /** After these pairs the journal record is in the file (process-crash model). */
  const journalWritten = (edge: DelegationDurabilityEdge, when: 'before' | 'after'): boolean =>
    !(edge === 'journal-write' && when === 'before');
  /** After these pairs the journal record has been fsynced (the power-loss model keeps only that much). */
  const journalSynced = (edge: DelegationDurabilityEdge, when: 'before' | 'after'): boolean =>
    !(edge === 'journal-write' || (edge === 'journal-fsync' && when === 'before'));

  const rowsOf = (cp: DelegationCheckpointV1): string => withoutRevision({ ...cp, pruningHolds: [] });
  /** The old state (X named, no join) and the new one (X's join applied), from an uncrashed run on the same injected clock. */
  let referenceRows: Promise<{ oldRows: string; newRows: string }> | null = null;
  const reference = (): Promise<{ oldRows: string; newRows: string }> => (referenceRows ??= (async () => {
    const dur = await harness().open();
    await dur.applyAccepted(batch([sessionStart(1), bareTool(2, X)]));
    const oldRows = rowsOf(dur.state().checkpoint);
    await dur.applyAccepted(batch([subagentStart(3, X)]));
    return { oldRows, newRows: rowsOf(dur.state().checkpoint) };
  })());

  /** The application under test: X's join, alone, or carrying the bucket cursor and the observation interval a Task 9 batch carries. */
  const joinBatch = (withBucket: boolean) => batch([subagentStart(3, X)], withBucket
    ? { cursor: cursorFor('2026101400', 300), interval: intervalFor('2026101400', 'measured', T(3)) } : {});

  async function crashRun(edge: DelegationDurabilityEdge, when: 'before' | 'after', withBucket = false) {
    const h = harness();
    // Old state: X's bare occurrence is journaled and checkpointed. The application under test is X's join, which opens the activity.
    const old = await h.open();
    await old.applyAccepted(batch([sessionStart(1), bareTool(2, X)]));
    const oldDisk = readDisk(h.dir);
    await old.close();

    const store2 = new CoordStore(openCoordDb(path.join(h.dir, 'coord.db')));
    const h2 = harness({ dir: h.dir, store: store2 });
    let hits = 0;
    const crashing = await h2.open({ onEdge: (e, w) => { if (e === edge && w === when) { hits++; throw new SimulatedCrash(`${edge}:${when}`); } } });
    h2.log.length = 0;
    const idsExposed: string[] = [];
    await expect(crashing.applyAccepted(joinBatch(withBucket)).then((o) => { idsExposed.push(...o.openedActivities.map((a) => a.activityId)); return o; })).rejects.toThrow(SimulatedCrash);
    expect(hits).toBe(1);
    expect(idsExposed).toEqual([]);                                  // no ID escaped
    // The crashed applier is poisoned: reconstructing, pruning off, and it refuses everything until it re-recovers.
    expect(crashing.state().phase).toBe('reconstructing');
    expect(crashing.pruningEnabled()).toBe(false);
    // Nothing of the failed application is visible in the applier's own state either: the activity the join would have opened
    // is not there (O1: an ID is not exposed before the checkpoint replacement completed).
    expect(crashing.state().checkpoint.activities).toEqual([]);
    expect(crashing.state().checkpoint.appliedJournalSequence).toBe(2);
    await expect(crashing.applyAccepted(batch([sessionStart(9)]))).rejects.toMatchObject({ code: 'not-ready' });
    return { h2, oldDisk, projectionLog: [...h2.log] };
  }

  for (const edge of EDGES) {
    for (const when of ['before', 'after'] as const) {
      it(`crash ${when} ${edge}`, async () => {
        const { oldRows, newRows } = await reference();
        const { h2, oldDisk } = await crashRun(edge, when);
        // Process crash: every issued write is on disk. Power loss: only what was fsynced is (a journal tail never fsynced is lost,
        // and a rename whose directory entry was never fsynced is lost).
        const powerDisk = copyDisk(h2.dir, {
          journalSyncedSize: journalSynced(edge, when) ? undefined : oldDisk.journal!.length,
          checkpointBytes: checkpointDurable(edge, when) ? undefined : oldDisk.checkpoint,
        });
        for (const [variant, source] of [['process crash', h2.dir], ['power loss', powerDisk]] as const) {
          const dir = copyDisk(source, {});
          const fresh = await harness({ dir }).open();
          expect(fresh.failure(), `${variant}: ${JSON.stringify(fresh.failure())}`).toBeNull();
          const got = rowsOf(fresh.state().checkpoint);
          // Whatever disk survived, the answer is the old state or the new one: never a third.
          expect([oldRows, newRows], `${variant} recovered a third state`).toContain(got);
          if (variant === 'process crash') {
            expect(got, `${variant} at ${when} ${edge}`).toBe(journalWritten(edge, when) || checkpointDurable(edge, when) ? newRows : oldRows);
          } else {
            expect(got, `${variant} at ${when} ${edge}`).toBe(journalSynced(edge, when) ? newRows : oldRows);
          }
          // The journal is never BEHIND the checkpoint: the applied position names a retained record.
          const records = parseDelegationJournal(new Uint8Array(readDisk(dir).journal ?? Buffer.alloc(0)), {});
          expect(records.length).toBeGreaterThanOrEqual(fresh.state().checkpoint.appliedJournalSequence);
          // Recovery SAVES what it replayed, through the same atomic replacement: the file on disk is the recovered state.
          if (fresh.state().checkpoint.appliedJournalSequence > 0) {
            expect(decodeDelegationCheckpoint(new Uint8Array(readDisk(dir).checkpoint!)), `${variant}: the recovered state was not saved`).toEqual(fresh.state().checkpoint);
          }
          // And what recovery saves is what the next recovery reads.
          const again = await harness({ dir }).open();
          expect(rowsOf(again.state().checkpoint)).toBe(got);
        }
      });
    }
  }

  it('SQLite is untouched at every edge before the directory fsync completes', async () => {
    for (const edge of EDGES) {
      for (const when of ['before', 'after'] as const) {
        if (checkpointDurable(edge, when)) continue;
        const { projectionLog } = await crashRun(edge, when);
        expect(projectionLog.filter((l) => l === 'project' || l.startsWith('insertEvents')), `${when} ${edge}`).toEqual([]);
      }
    }
  });

  describe('a batch that carries a cursor and an interval, as Task 9\'s batches will (fix round 1, M4)', () => {
    // The checkpoint-owned cursor and interval are NOT in the journal, so a crash that leaves the journal ahead of the checkpoint
    // recovers the NEW ROWS with the OLD cursor and interval: a legitimate fourth state, REPLAYED. It converges: the bucket is
    // re-read, its event is a duplicate (nothing appended), and the cursor-only application brings the state to FULL.
    let fullRows: Promise<string> | null = null;
    const full = (): Promise<string> => (fullRows ??= (async () => {
      const dur = await harness().open();
      await dur.applyAccepted(batch([sessionStart(1), bareTool(2, X)]));
      await dur.applyAccepted(joinBatch(true));
      return rowsOf(dur.state().checkpoint);
    })());
    /** Process-crash model: the rename has happened. */
    const renamed = (edge: DelegationDurabilityEdge, when: 'before' | 'after'): boolean =>
      edge === 'directory-fsync' || (edge === 'checkpoint-rename' && when === 'after');

    for (const edge of EDGES) {
      for (const when of ['before', 'after'] as const) {
        it(`crash ${when} ${edge}: old rows, new rows with the old bucket state, or everything, and a re-read converges`, async () => {
          const { oldRows, newRows: replayedRows } = await reference();
          const fullRowsNow = await full();
          // Independently of the code that built it: the FULL state carries exactly this cursor and this interval.
          const fullState = JSON.parse(fullRowsNow) as { bucketCursors: unknown; observationIntervals: unknown };
          expect(fullState.bucketCursors).toEqual([cursorFor('2026101400', 300)]);
          expect(fullState.observationIntervals).toEqual([intervalFor('2026101400', 'measured', T(3))]);
          const { h2, oldDisk } = await crashRun(edge, when, true);
          const powerDisk = copyDisk(h2.dir, {
            journalSyncedSize: journalSynced(edge, when) ? undefined : oldDisk.journal!.length,
            checkpointBytes: checkpointDurable(edge, when) ? undefined : oldDisk.checkpoint,
          });
          const expectations = [
            ['process crash', h2.dir, renamed(edge, when) ? 'full' : journalWritten(edge, when) ? 'replayed' : 'old'],
            ['power loss', powerDisk, checkpointDurable(edge, when) ? 'full' : journalSynced(edge, when) ? 'replayed' : 'old'],
          ] as const;
          for (const [variant, source, expected] of expectations) {
            const dir = copyDisk(source, {});
            const fresh = await harness({ dir }).open();
            expect(fresh.failure(), `${variant}: ${JSON.stringify(fresh.failure())}`).toBeNull();
            const got = rowsOf(fresh.state().checkpoint);
            const byName = { old: oldRows, replayed: replayedRows, full: fullRowsNow };
            expect(got, `${variant} at ${when} ${edge}: expected the ${expected} state`).toBe(byName[expected]);
            if (expected === 'replayed') {
              expect(fresh.state().checkpoint.bucketCursors, 'the journal carries no cursor').toEqual([]);
              expect(fresh.state().checkpoint.observationIntervals).toEqual([]);
            }
            // The bucket is re-read: whichever state recovery reached, the same batch converges on the full one.
            const reread = await fresh.applyAccepted(joinBatch(true));
            expect(reread.appended.length, `${variant}: the re-read appends only what the journal lacks`).toBe(expected === 'old' ? 1 : 0);
            expect(rowsOf(fresh.state().checkpoint), `${variant}: the re-read did not converge`).toBe(fullRowsNow);
          }
        });
      }
    }
  });

  describe('createLease: a crash before the checkpoint replacement exposes neither the UUID nor the ID mapping (fix round 1, M4; brief Step 3)', () => {
    const UUID0 = '5b0d9d9e-6d3c-4d2e-9f7a-0a1b2c3d4e5f';
    const renamedAt = (edge: DelegationDurabilityEdge, when: 'before' | 'after'): boolean =>
      edge === 'directory-fsync' || (edge === 'checkpoint-rename' && when === 'after');

    for (const edge of EDGES) {
      for (const when of ['before', 'after'] as const) {
        it(`crash ${when} ${edge}`, async () => {
          const h = harness();
          let crashAt: { edge: DelegationDurabilityEdge; when: 'before' | 'after' } | null = null;
          const dur = await h.open({ onEdge: (e, w) => { if (crashAt !== null && e === crashAt.edge && w === crashAt.when) throw new SimulatedCrash(`${e}:${w}`); } });
          const built = await dur.applyAccepted(batch([sessionStart(1), bareTool(2, X), subagentStart(3, X)]));
          const act = built.openedActivities[0]!;
          const oldDisk = readDisk(h.dir);
          const lineageId = deriveDelegationLineageId({ leaseId: UUID0, parentId: PARENT, parentIncarnation: INC, activityId: act.activityId });
          h.log.length = 0;
          crashAt = { edge, when };
          const returned: unknown[] = [];
          const request: DelegationLeaseCreationRequest = {
            activityId: act.activityId, parentId: PARENT, parentIncarnation: INC, project: 'project-a', adminRecord: 'wt-1', canonicalPath: '/work/project-a/wt-1',
            creationBase: null, sourceKind: 'agent', correlationJournalIds: [], firstObservedAt: T(40),
          };
          await expect(dur.createLease(request).then((o) => { returned.push(o); return o; })).rejects.toThrow(SimulatedCrash);
          expect(returned, 'no lease ID was handed back').toEqual([]);
          expect(h.uuidCalls.n, 'the UUID was minted once, after deduplication').toBe(1);
          // The UUID and the lineage mapping are in none of the applier's views...
          const seenInState = JSON.stringify(dur.state().checkpoint);
          expect(seenInState).not.toContain(UUID0);
          expect(seenInState).not.toContain(lineageId);
          expect(dur.state().checkpoint.leases).toEqual([]);
          expect(dur.state().checkpoint.lineage).toEqual([]);
          // ...not in SQLite (nothing was projected before the directory fsync)...
          expect(h.log.filter((l) => l === 'project' || l.startsWith('insertEvents'))).toEqual([]);
          expect(h.store.readDelegationProjection().leases).toEqual([]);
          expect(h.store.readDelegationProjection().lineage).toEqual([]);
          // ...and not in the checkpoint file unless the rename completed (the journal MAY hold the entry: it is authority, not exposure).
          const onDisk = readDisk(h.dir).checkpoint!.toString('utf8');
          expect(onDisk.includes(UUID0), 'the checkpoint file on disk').toBe(renamedAt(edge, when));
          expect(onDisk.includes(lineageId)).toBe(renamedAt(edge, when));
          expect(decodeDelegationCheckpoint(new Uint8Array(oldDisk.checkpoint!)).leases).toEqual([]);
          // Recovery under both disk models: the lease exists only if its journal entry survived, and then with the SAME UUID and lineage.
          const journalHasIt = !(edge === 'journal-write' && when === 'before');
          const powerDisk = copyDisk(h.dir, {
            journalSyncedSize: journalSynced(edge, when) ? undefined : oldDisk.journal!.length,
            checkpointBytes: checkpointDurable(edge, when) ? undefined : oldDisk.checkpoint,
          });
          for (const [variant, source, hasLease] of [['process crash', h.dir, journalHasIt], ['power loss', powerDisk, journalSynced(edge, when)]] as const) {
            const fresh = await harness({ dir: copyDisk(source, {}) }).open();
            expect(fresh.failure(), variant).toBeNull();
            const leases = fresh.state().checkpoint.leases;
            expect(leases.map((l) => l.leaseId), `${variant} at ${when} ${edge}`).toEqual(hasLease ? [UUID0] : []);
            expect(fresh.state().checkpoint.lineage.map((n) => n.lineageId)).toEqual(hasLease ? [lineageId] : []);
          }
        });
      }
    }
  });

  it('a crash at the project edge leaves the checkpoint durable and SQLite stale; the next start repairs it', async () => {
    const h = harness();
    const dur = await h.open({ onEdge: (e, w) => { if (e === 'project' && w === 'before') throw new SimulatedCrash('project'); } });
    const out = await dur.applyAccepted(batch([sessionStart(1), subagentStart(2, X)]));
    // The projection edge never throws out of the applier: SQLite is repairable output.
    expect(out.durable).toBe(true);
    expect(out.projection.status).toBe('failed');
    expect(dur.state().phase).toBe('ready');
    expect(h.store.readDelegationProjection().sessions).toEqual([]);
    const fresh = await harness({ dir: h.dir, store: h.store }).open();
    expect(h.store.readDelegationProjection().sessions).toHaveLength(1);
    expect(fresh.failure()).toBeNull();
  });

  it('the stale projection is also repaired by the NEXT application, with the missed events replayed from the journal', async () => {
    const h = harness();
    let fail = true;
    const dur = await h.open({ onEdge: (e, w) => { if (fail && e === 'project' && w === 'before') throw new SimulatedCrash('project'); } });
    await dur.applyAccepted(batch([sessionStart(1), sessionStart(2)]));
    fail = false;
    const out = await dur.applyAccepted(batch([sessionStart(3)]));
    expect(out.projection.status).toBe('projected');
    expect(delegationProjectionPortOfStore(h.store).eventStats()).toEqual({ count: 3, maxSequence: 3 });
  });

  it('a crash between two records of one batch leaves the journal with a prefix, and recovery replays that prefix', async () => {
    const h = harness();
    let writes = 0;
    const crashing = await h.open({ onEdge: (e, w) => { if (e === 'journal-fsync' && w === 'after' && ++writes === 1) throw new SimulatedCrash('mid-batch'); } });
    await expect(crashing.applyAccepted(batch([sessionStart(1), sessionStart(2), sessionStart(3)]))).rejects.toThrow(SimulatedCrash);
    expect(parseDelegationJournal(new Uint8Array(readDisk(h.dir).journal!)).map((r) => r.sequence)).toEqual([1]);
    expect(readDisk(h.dir).checkpoint).toBeNull();
    const fresh = await harness({ dir: h.dir }).open();
    expect(fresh.state().checkpoint.appliedJournalSequence).toBe(1);
    expect(fresh.state().checkpoint.sessions).toHaveLength(1);
    // The batch is then re-read: the journaled record is a duplicate, the other two are appended.
    const redo = await fresh.applyAccepted(batch([sessionStart(1), sessionStart(2), sessionStart(3)]));
    expect(redo.appended.map((r) => r.sequence)).toEqual([2, 3]);
  });

  it('a stale checkpoint temp file from a crash is ignored, and the next application replaces it', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([sessionStart(1)]));
    writeFileSync(path.join(h.dir, `${DELEGATION_CHECKPOINT_FILE}.tmp`), 'garbage that is not a checkpoint');
    const fresh = await harness({ dir: h.dir }).open();
    expect(fresh.failure()).toBeNull();
    await fresh.applyAccepted(batch([sessionStart(2)]));
    expect(existsSync(path.join(h.dir, `${DELEGATION_CHECKPOINT_FILE}.tmp`))).toBe(false);
  });

  it('every position of a torn tail on disk is a HEALABLE recovery when no checkpoint names it (D-4655): ready, a plan for the tail, the disk untouched', async () => {
    const [r1, r2] = evidenceChain([sessionStart(1), sessionStart(2)]);
    const first = Buffer.from(encodeDelegationJournalRecord(r1!));
    const second = Buffer.from(encodeDelegationJournalRecord(r2!));
    const lineLen = second.length - 1;
    for (const k of [1, 2, 7, 100, Math.floor(lineLen / 2), lineLen - 2, lineLen - 1, lineLen]) {
      const dir = mkTmp('ccrc-deleg-torn-');
      const bytes = Buffer.concat([first, second.subarray(0, k)]);
      writeFileSync(path.join(dir, DELEGATION_JOURNAL_FILE), bytes);
      const report = await recoverDelegationFromFiles(nodeDelegationFilePort, dir);
      expect(report.failure, `cut ${k}`).toBeNull();
      expect(report.tailHeal, `cut ${k}`).toMatchObject({ offset: first.length, bytes: k, code: k === lineLen ? 'missing-final-lf' : 'torn-tail' });
      expect(report.state.phase).toBe('ready');
      expect(report.pruning).toBe('enabled');
      expect(readFileSync(path.join(dir, DELEGATION_JOURNAL_FILE)), 'recovery itself never writes').toEqual(bytes);
    }
  });

  it('re-recovery clears a poisoned applier: it reads the disk and is ready again', async () => {
    const h = harness();
    let armed = true;
    const dur = await h.open({ onEdge: (e, w) => { if (armed && e === 'checkpoint-rename' && w === 'before') throw new SimulatedCrash('rename'); } });
    await expect(dur.applyAccepted(batch([sessionStart(1)]))).rejects.toThrow(SimulatedCrash);
    expect(dur.pruningEnabled()).toBe(false);
    armed = false;
    const report = await dur.recover();
    expect(report.failure).toBeNull();
    expect(dur.pruningEnabled()).toBe(true);
    expect(dur.state().checkpoint.appliedJournalSequence).toBe(1);        // the journaled record was replayed
    await dur.applyAccepted(batch([sessionStart(2)]));
  });

  it('a torn journal tail the checkpoint names is still a recovery failure: reconstructing, pruning off, and nothing is appended behind it', async () => {
    // The checkpoint's applied position is record 2, and the journal holds record 1 and a FRAGMENT of record 2: the fragment is not a
    // crash artefact (a checkpoint is replaced only after its record is durable), so it is corruption and nothing is cut.
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([sessionStart(1), sessionStart(2)]));
    await dur.close();
    const file = path.join(h.dir, DELEGATION_JOURNAL_FILE);
    const whole = readFileSync(file);
    const firstLen = Buffer.from(encodeDelegationJournalRecord(parseDelegationJournal(new Uint8Array(whole))[0]!)).length;
    const torn = whole.subarray(0, firstLen + 25);
    writeFileSync(file, torn);
    const fresh = await harness({ dir: h.dir }).open();
    expect(fresh.failure()).toMatchObject({ phase: 'journal-validate', code: 'torn-tail' });
    expect(fresh.state().phase).toBe('reconstructing');
    expect(fresh.pruningEnabled()).toBe(false);
    await expect(fresh.applyAccepted(batch([sessionStart(3)]))).rejects.toMatchObject({ code: 'not-ready' });
    expect(readFileSync(file)).toEqual(torn);                           // not truncated, not repaired, not appended to
    expect(existsSync(path.join(h.dir, DELEGATION_TORN_DIR))).toBe(false);
  });
});

// ── D-4655: a torn journal tail heals itself ─────────────────────────────────────────────────────────────────────────
//
// THE SAFETY ARGUMENT THESE ROWS PROVE. Under O5 a record is applied only after the journal fsync, and the checkpoint is replaced only
// after that. So a crash or a failed write in the middle of an append leaves at most ONE partial line after the last LF, and no
// checkpoint, cursor, ID or interval refers to it: the bucket cursor still points before its spool line. The next pass reads that line
// again and mints the same eventId, so cutting the partial line loses nothing the spool does not still hold (and a bucket that has
// gone meanwhile is already an unmeasured hour, spec 5.3). That argument holds ONLY when the journal's complete records validate with
// an intact chain and the checkpoint names a complete record (or none). Everything else is corruption and stays fail-closed.
//
// THE ONE NAMED EXCEPTION. Task 8 Step 4's "no production caller truncates the journal" pin, W3-M22 (every torn position is refused) and
// W3-M38 (no rewrite, truncate or rename of the journal) each carry exactly one exception: the server's tail heal, which cuts only to
// the end of the last complete validated record after the cut bytes are durable somewhere else. Every other truncate, rewrite or
// rename path stays red (the pin rows below, and the mutation table in the task report).
describe('D-4655: a torn journal tail heals itself (the one named exception to the no-truncate pin)', () => {
  const chain = evidenceChain([sessionStart(1), sessionStart(2), sessionStart(3), sessionStart(4)]);
  const line = (i: number): Buffer => Buffer.from(encodeDelegationJournalRecord(chain[i]!));
  const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
  const tornDirOf = (dir: string): string => path.join(dir, DELEGATION_TORN_DIR);
  const tornFiles = (dir: string): string[] => (existsSync(tornDirOf(dir)) ? readdirSync(tornDirOf(dir)).sort() : []);
  const journalOf = (dir: string): Buffer => readFileSync(path.join(dir, DELEGATION_JOURNAL_FILE));
  /** A checkpoint at the first `n` records (revision 1: every persisted checkpoint has one). */
  const checkpointAt = (n: number): Buffer => Buffer.from(encodeDelegationCheckpoint({ ...recoverDelegation(null, chain.slice(0, n)).state.checkpoint, revision: 1 }));
  /** A fixture directory: `complete` records, then `tail` (bytes with no LF after the last one), and a checkpoint at `applied` records. */
  function plant(opts: { complete: number; tail?: Uint8Array; applied?: number; journal?: Buffer }): { dir: string; whole: Buffer; prefixLen: number } {
    const dir = mkTmp('ccrc-deleg-heal-');
    const prefix = Buffer.concat(Array.from({ length: opts.complete }, (_, i) => line(i)));
    const whole = opts.journal ?? Buffer.concat([prefix, opts.tail ?? Buffer.alloc(0)]);
    writeFileSync(path.join(dir, DELEGATION_JOURNAL_FILE), whole);
    if (opts.applied !== undefined) writeFileSync(path.join(dir, DELEGATION_CHECKPOINT_FILE), checkpointAt(opts.applied));
    return { dir, whole, prefixLen: prefix.length };
  }
  const nameOf = (offset: number, tail: Uint8Array): string => `${offset}-${sha256(tail)}.tail`;
  /** The cut points of the next record: a few bytes, the middle, all but its LF (a complete record with no LF after it). */
  const cuts = (): number[] => { const n = line(2).length - 1; return [1, 2, 7, 100, Math.floor(n / 2), n - 2, n - 1, n]; };

  describe('the rule, once (delegation-journal.ts): healable only when a tail exists AND the complete records and the checkpoint are sound', () => {
    const tail = (bytes: Uint8Array, offset = 500, code: 'torn-tail' | 'missing-final-lf' = 'torn-tail'): DelegationJournalTail => ({ offset, bytes, sha256: sha256(bytes), code });

    it('a tail on a sound prefix is a plan whose name is content-addressed: <offset>-<sha256>.tail', () => {
      const bytes = new TextEncoder().encode('{"acceptedAt":"2026-10-1');
      expect(delegationTailHealPlan(tail(bytes), true)).toEqual({ offset: 500, bytes: bytes.length, sha256: sha256(bytes), code: 'torn-tail', name: `500-${sha256(bytes)}.tail` });
      expect(delegationTailHealPlan(tail(bytes, 0), true)!.name).toBe(`0-${sha256(bytes)}.tail`);
    });
    it('no tail is no plan, and an unsound prefix is no plan, whatever the tail looks like', () => {
      const bytes = new Uint8Array([0x7b, 0x22]);
      expect(delegationTailHealPlan(null, true)).toBeNull();
      expect(delegationTailHealPlan(null, false)).toBeNull();
      expect(delegationTailHealPlan(tail(bytes), false)).toBeNull();
    });
    it('the plan is a pure function of the tail: no clock, no randomness, so the same bytes at the same offset always get the same name', () => {
      const bytes = new TextEncoder().encode('xyz');
      const a = delegationTailHealPlan(tail(bytes, 77), true)!;
      const b = delegationTailHealPlan(tail(new Uint8Array(bytes), 77), true)!;
      expect(a).toEqual(b);
      expect(delegationTailHealPlan(tail(bytes, 78), true)!.name).not.toBe(a.name);
      expect(delegationTailHealPlan(tail(new TextEncoder().encode('xyZ'), 77), true)!.name).not.toBe(a.name);
    });
  });

  describe('the strict reader reports a tail to a sink and still throws without one', () => {
    it('with a sink: every complete record is yielded, then the sink gets {offset, bytes, sha256, code}, and nothing throws', async () => {
      for (const k of cuts()) {
        const { dir, prefixLen } = plant({ complete: 2, tail: line(2).subarray(0, k) });
        const seen: DelegationJournalTail[] = [];
        const got: number[] = [];
        for await (const r of readDelegationJournalRecords(nodeDelegationFilePort, path.join(dir, DELEGATION_JOURNAL_FILE), undefined, (t) => seen.push(t))) got.push(r.sequence);
        expect(got, `cut ${k}`).toEqual([1, 2]);
        expect(seen, `cut ${k}`).toHaveLength(1);
        expect(seen[0]).toMatchObject({ offset: prefixLen, sha256: sha256(line(2).subarray(0, k)), code: k === line(2).length - 1 ? 'missing-final-lf' : 'torn-tail' });
        expect(Buffer.from(seen[0]!.bytes)).toEqual(line(2).subarray(0, k));
      }
    });
    it('a chunk size that splits the tail does not change the answer', async () => {
      const { dir, prefixLen } = plant({ complete: 2, tail: line(2).subarray(0, 90) });
      for (const chunk of [1, 7, 64, 4096]) {
        const seen: DelegationJournalTail[] = [];
        for await (const r of readDelegationJournalRecords(nodeDelegationFilePort, path.join(dir, DELEGATION_JOURNAL_FILE), chunk, (t) => seen.push(t))) void r;
        expect(seen[0], `chunk ${chunk}`).toMatchObject({ offset: prefixLen, sha256: sha256(line(2).subarray(0, 90)) });
      }
    });
    it('without a sink the reader throws exactly as before: torn-tail, or missing-final-lf for a whole record with no LF', async () => {
      for (const [k, code] of [[40, 'torn-tail'], [line(2).length - 1, 'missing-final-lf']] as const) {
        const { dir } = plant({ complete: 2, tail: line(2).subarray(0, k) });
        const drain = async (): Promise<void> => { for await (const r of readDelegationJournalRecords(nodeDelegationFilePort, path.join(dir, DELEGATION_JOURNAL_FILE))) void r; };
        await expect(drain()).rejects.toMatchObject({ code });
      }
    });
    it('a journal with no tail never calls the sink', async () => {
      const { dir } = plant({ complete: 2 });
      const seen: DelegationJournalTail[] = [];
      for await (const r of readDelegationJournalRecords(nodeDelegationFilePort, path.join(dir, DELEGATION_JOURNAL_FILE), undefined, (t) => seen.push(t))) void r;
      expect(seen).toEqual([]);
    });
  });

  describe('recovery classifies a tail: healable, or the same refusal as before', () => {
    it('HEALABLE: no checkpoint, a checkpoint at the last complete record, and a checkpoint BEHIND it (the journal is ahead), at every cut', async () => {
      for (const applied of [undefined, 2, 1] as const) {
        for (const k of cuts()) {
          const tail = line(2).subarray(0, k);
          const { dir, prefixLen } = plant({ complete: 2, tail, ...(applied === undefined ? {} : { applied }) });
          const report = await recoverDelegationFromFiles(nodeDelegationFilePort, dir);
          const what = `applied ${applied}, cut ${k}`;
          expect(report.failure, what).toBeNull();
          expect(report.tailHeal, what).toEqual({ offset: prefixLen, bytes: k, sha256: sha256(tail), code: k === line(2).length - 1 ? 'missing-final-lf' : 'torn-tail', name: nameOf(prefixLen, tail) });
          expect(report.state.phase).toBe('ready');
          expect(report.facts!.head!.sequence, what).toBe(2);
        }
      }
    });

    it('NOT healable: the checkpoint names the record that is the LF-less one (a durable, applied record with no LF is corruption)', async () => {
      const { dir, whole } = plant({ complete: 2, tail: line(2).subarray(0, line(2).length - 1), applied: 3 });
      // The checkpoint at 3 needs record 3 to exist; build it from the real chain.
      const report = await recoverDelegationFromFiles(nodeDelegationFilePort, dir);
      expect(report.tailHeal).toBeNull();
      expect(report.failure).toMatchObject({ phase: 'journal-validate', code: 'missing-final-lf' });
      expect(report.failure!.detail).toMatch(/anchor-missing/);
      expect(report.state.phase).toBe('reconstructing');
      expect(journalOf(dir)).toEqual(whole);
    });

    it('NOT healable: the checkpoint names a record that is torn, or one past the last complete record', async () => {
      for (const applied of [3, 4]) {
        const { dir, whole } = plant({ complete: 2, tail: line(2).subarray(0, 60), applied });
        const report = await recoverDelegationFromFiles(nodeDelegationFilePort, dir);
        expect(report.tailHeal, `applied ${applied}`).toBeNull();
        expect(report.failure, `applied ${applied}`).toMatchObject({ phase: 'journal-validate', code: 'torn-tail' });
        expect(report.state.phase).toBe('reconstructing');
        expect(journalOf(dir)).toEqual(whole);
      }
    });

    it('NOT healable: a held record the tail would have to carry (a checkpoint hold on the LF-less record)', async () => {
      const { dir } = plant({ complete: 2, tail: line(2).subarray(0, line(2).length - 1) });
      const cp = recoverDelegation(null, chain.slice(0, 2)).state.checkpoint;
      const held = { ...cp, revision: 1, pruningHolds: [...cp.pruningHolds, { journalId: chain[2]!.journalId, reason: 'identity-candidate' as const, ownerId: 'agent-1' }] };
      writeFileSync(path.join(dir, DELEGATION_CHECKPOINT_FILE), encodeDelegationCheckpoint(held));
      const report = await recoverDelegationFromFiles(nodeDelegationFilePort, dir);
      expect(report.tailHeal).toBeNull();
      expect(report.failure).toMatchObject({ phase: 'journal-validate', code: 'missing-final-lf' });
    });

    it('CORRUPTION is never healable, with or without a tail: an invalid complete record, a chain break, a gap, a duplicate', async () => {
      const text = (i: number): string => line(i).toString('utf8');
      const rows: Array<[string, Buffer, string]> = [
        ['a digest that is not the hash of its preimage', Buffer.concat([line(0), Buffer.from(text(1).replace(/"digest":"[0-9a-f]{64}"/, `"digest":"${'0'.repeat(64)}"`)), line(2).subarray(0, 50)]), 'digest-mismatch'],
        ['an invalid complete record that is the LAST complete one', Buffer.concat([line(0), Buffer.from(text(1).replace(/"journalId":"[0-9a-f]{64}"/, `"journalId":"${'0'.repeat(64)}"`)), line(2).subarray(0, 50)]), 'journal-id-mismatch'],
        ['a record whose previousDigest is not the prior digest', Buffer.concat([line(0), Buffer.from(encodeDelegationJournalRecord(buildDelegationJournalRecord({ sequence: 2, acceptedAt: T(5), previousDigest: 'd'.repeat(64), entry: evidence(sessionStart(2)) }))), line(2).subarray(0, 50)]), 'previous-digest'],
        ['a sequence gap', Buffer.concat([line(0), line(2), line(3).subarray(0, 50)]), 'sequence-gap'],
        ['a duplicated record', Buffer.concat([line(0), line(0), line(1).subarray(0, 50)]), 'sequence-duplicate'],
        ['a record that is not canonical JSON', Buffer.concat([line(0), Buffer.from('{"a":1}\n'), line(2).subarray(0, 50)]), 'unknown-key'],
        ['a blank line', Buffer.concat([line(0), Buffer.from('\n'), line(1).subarray(0, 50)]), 'blank-line'],
      ];
      for (const [name, journal, code] of rows) {
        const { dir } = plant({ complete: 0, journal });
        const report = await recoverDelegationFromFiles(nodeDelegationFilePort, dir);
        expect(report.tailHeal, name).toBeNull();
        expect(report.failure, name).toMatchObject({ phase: 'journal-validate', code });
        expect(report.state.phase, name).toBe('reconstructing');
      }
    });

    it('a journal with no tail has no plan', async () => {
      const { dir } = plant({ complete: 3, applied: 3 });
      const report = await recoverDelegationFromFiles(nodeDelegationFilePort, dir);
      expect(report.failure).toBeNull();
      expect(report.tailHeal).toBeNull();
    });
  });

  describe('the applier heals the live journal, and stays its only writer', () => {
    /** Every operation of one port, mutating ones numbered, with a way to die (or fail once) at the k-th. */
    function faultPort(inner: DelegationFilePort, opts: { dieAt?: number; failAt?: number } = {}): { port: DelegationFilePort; ops: string[]; count: () => number } {
      const ops: string[] = [];
      let n = 0;
      let dead = false;
      const read = (what: string): void => { if (dead) throw new Error('process is dead'); ops.push(what); };
      const mutate = (what: string): void => {
        if (dead) throw new Error('process is dead');
        const i = n++;
        ops.push(`${i}:${what}`);
        if (opts.dieAt !== undefined && i >= opts.dieAt) { dead = true; throw new Error(`crash at op ${i}`); }
        if (opts.failAt === i) throw new Error(`fault at op ${i}`);
      };
      const wrapHandle = (label: string, h: DelegationFileHandle): DelegationFileHandle => ({
        write: async (b) => { mutate(`${label}.write`); return h.write(b); },
        sync: async () => { mutate(`${label}.sync`); await h.sync(); },
        close: async () => { await h.close(); },
      });
      const port: DelegationFilePort = {
        openAppend: async (p) => { mutate('journal.open'); return wrapHandle('journal', await inner.openAppend(p)); },
        createTemp: async (p) => { mutate(`create:${path.basename(p)}`); return wrapHandle(p.includes(DELEGATION_TORN_DIR) ? 'quarantine' : 'checkpoint', await inner.createTemp(p)); },
        rename: async (a, b) => { mutate(`rename:${path.basename(a)}->${path.basename(b)}`); await inner.rename(a, b); },
        fsyncDir: async (d) => { mutate(`dirsync:${path.basename(d)}`); await inner.fsyncDir(d); },
        truncate: async (p, len) => { mutate(`truncate:${path.basename(p)}:${len}`); await inner.truncate(p, len); },
        fsyncFile: async (p) => { mutate(`filesync:${path.basename(p)}`); await inner.fsyncFile(p); },
        mkdirp: async (d) => { mutate(`mkdirp:${path.basename(d)}`); await inner.mkdirp(d); },
        readFile: async (p) => { read(`readFile:${path.basename(p)}`); return inner.readFile(p); },
        openRead: async (p) => { read(`openRead:${path.basename(p)}`); return inner.openRead(p); },
        listDir: async (d) => { read(`listDir:${path.basename(d)}`); return inner.listDir(d); },
        statFile: async (p) => { read(`statFile:${path.basename(p)}`); return inner.statFile(p); },
      };
      return { port, ops, count: () => n };
    }

    it('heals: the tail is kept under a content-addressed name, the journal is cut to the last complete record, and the applier opens READY', async () => {
      const tail = line(2).subarray(0, 61);
      const { dir, prefixLen } = plant({ complete: 2, tail, applied: 2 });
      const h = harness({ dir });
      const warned: string[] = [];
      const dur = await h.open({ warn: (m) => warned.push(m) });
      expect(dur.failure()).toBeNull();
      expect(dur.state().phase).toBe('ready');
      expect(dur.pruningEnabled()).toBe(true);
      expect(journalOf(dir)).toEqual(Buffer.concat([line(0), line(1)]));
      expect(journalOf(dir).length).toBe(prefixLen);
      expect(tornFiles(dir)).toEqual([nameOf(prefixLen, tail)]);
      expect(readFileSync(path.join(tornDirOf(dir), nameOf(prefixLen, tail)))).toEqual(tail);
      expect(warned).toHaveLength(1);
      expect(warned[0]).toMatch(/^ccrc-server: /);
      expect(warned[0]).toContain(`${tail.length} byte`);
      expect(warned[0]).toContain(path.join(tornDirOf(dir), nameOf(prefixLen, tail)));
      expect(warned[0]).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
      // and the next application appends behind the cut, continuing the chain
      const out = await dur.applyAccepted(batch([sessionStart(3)]));
      expect(out.appended.map((r) => r.sequence)).toEqual([3]);
      expect(parseDelegationJournal(new Uint8Array(journalOf(dir)), { completeFromStart: true }).map((r) => r.sequence)).toEqual([1, 2, 3]);
    });

    it('a LF-less COMPLETE record that no checkpoint names is cut and kept too', async () => {
      const tail = line(2).subarray(0, line(2).length - 1);
      const { dir, prefixLen } = plant({ complete: 2, tail, applied: 2 });
      const dur = await harness({ dir }).open();
      expect(dur.failure()).toBeNull();
      expect(journalOf(dir)).toEqual(Buffer.concat([line(0), line(1)]));
      expect(readFileSync(path.join(tornDirOf(dir), nameOf(prefixLen, tail)))).toEqual(tail);
    });

    it('with no checkpoint and nothing but a fragment, the journal is cut to empty and the applier is ready', async () => {
      const tail = Buffer.from('{"acceptedAt":"2026-10-1');
      const { dir } = plant({ complete: 0, tail });
      const dur = await harness({ dir }).open();
      expect(dur.failure()).toBeNull();
      expect(journalOf(dir)).toEqual(Buffer.alloc(0));
      expect(tornFiles(dir)).toEqual([nameOf(0, tail)]);
      expect((await dur.applyAccepted(batch([sessionStart(1)]))).appended.map((r) => r.sequence)).toEqual([1]);
    });

    it('a journal with no tail is never touched: no quarantine directory, no truncate, no extra fsync of the journal file', async () => {
      const { dir, whole } = plant({ complete: 2, applied: 2 });
      const h = harness({ dir });
      await h.open();
      expect(journalOf(dir)).toEqual(whole);
      expect(existsSync(tornDirOf(dir))).toBe(false);
      expect(h.log.filter((l) => /truncate|file\.sync/.test(l))).toEqual([]);
    });

    it('the order is quarantine (temp write, fsync, rename, directory fsyncs), THEN the cut, THEN the journal fsync and its directory (W3-M38 mutant c)', async () => {
      const tail = line(2).subarray(0, 61);
      const { dir, prefixLen } = plant({ complete: 2, tail, applied: 2 });
      const h = harness({ dir });
      await h.open();
      const name = nameOf(prefixLen, tail);
      const heal = h.log.filter((l) => l !== 'project' && !l.startsWith('insertEvents'));
      expect(heal).toEqual([
        `quarantine.write:${tail.length}:${tail[tail.length - 1]}`, 'quarantine.sync', `rename:${name}.tmp->${name}`, 'dir.sync', 'dir.sync',
        `journal.truncate:${prefixLen}`, `file.sync:${DELEGATION_JOURNAL_FILE}`, 'dir.sync',
      ]);
      expect(existsSync(path.join(tornDirOf(dir), `${name}.tmp`))).toBe(false);
    });

    it('recover() on a LIVE applier heals too: a failed append that left a fragment is cut by the retry, and the next application appends', async () => {
      const h = harness();
      const dur = await h.open();
      await dur.applyAccepted(batch([sessionStart(1)]));
      appendFileSync(path.join(h.dir, DELEGATION_JOURNAL_FILE), '{"acceptedAt":"2026-10-1');
      const report = await dur.recover();
      expect(report.failure).toBeNull();
      expect(report.tailHeal).not.toBeNull();
      expect(dur.state().phase).toBe('ready');
      expect(tornFiles(h.dir)).toHaveLength(1);
      expect((await dur.applyAccepted(batch([sessionStart(2)]))).appended.map((r) => r.sequence)).toEqual([2]);
    });

    it('the applier appends NOTHING until the heal is durable: an application queued behind a held heal writes after the cut, never before', async () => {
      const h = harness();
      const journal = path.join(h.dir, DELEGATION_JOURNAL_FILE);
      let armed = false;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const inner = spyPort(h.log);
      const port: DelegationFilePort = { ...inner, truncate: async (p, len) => { if (armed) await gate; return inner.truncate(p, len); } };
      const dur = await h.open({ port });
      await dur.applyAccepted(batch([sessionStart(1)]));
      const clean = readFileSync(journal);
      appendFileSync(journal, '{"acceptedAt":"2026-10-1');
      armed = true;
      h.log.length = 0;
      const recovering = dur.recover();
      const applying = dur.applyAccepted(batch([sessionStart(2)]));
      await new Promise((r) => setTimeout(r, 40));
      expect(h.log.filter((l) => l.startsWith('journal.write')), 'nothing is appended while the heal is held').toEqual([]);
      expect(readFileSync(journal).length, 'and nothing is cut before the gate opens').toBe(clean.length + '{"acceptedAt":"2026-10-1'.length);
      release();
      await recovering;
      await applying;
      const cut = h.log.findIndex((l) => l.startsWith('journal.truncate'));
      const wrote = h.log.findIndex((l) => l.startsWith('journal.write'));
      expect(cut).toBeGreaterThan(-1);
      expect(wrote, 'the first append comes after the cut').toBeGreaterThan(cut);
      expect(parseDelegationJournal(new Uint8Array(readFileSync(journal)), { completeFromStart: true }).map((r) => r.sequence)).toEqual([1, 2]);
    });

    it('a defect that is NOT a crash artefact is never cut: the journal is byte-identical, nothing is kept, no truncate is issued (W3-M38 mutants b)', async () => {
      const text = (i: number): string => line(i).toString('utf8');
      const rows: Array<[string, Buffer, number | undefined, string]> = [
        ['a chain break before the tail', Buffer.concat([line(0), Buffer.from(encodeDelegationJournalRecord(buildDelegationJournalRecord({ sequence: 2, acceptedAt: T(5), previousDigest: 'd'.repeat(64), entry: evidence(sessionStart(2)) }))), line(2).subarray(0, 50)]), undefined, 'previous-digest'],
        ['an invalid complete record that is the last complete one', Buffer.concat([line(0), Buffer.from(text(1).replace(/"digest":"[0-9a-f]{64}"/, `"digest":"${'0'.repeat(64)}"`)), line(2).subarray(0, 50)]), undefined, 'digest-mismatch'],
        ['a sequence gap', Buffer.concat([line(0), line(2), line(3).subarray(0, 50)]), undefined, 'sequence-gap'],
        ['a checkpoint that names the LF-less record', Buffer.concat([line(0), line(1), line(2).subarray(0, line(2).length - 1)]), 3, 'missing-final-lf'],
        ['a checkpoint that names a torn record', Buffer.concat([line(0), line(1), line(2).subarray(0, 60)]), 3, 'torn-tail'],
        ['a checkpoint past the last complete record', Buffer.concat([line(0), line(1), line(2).subarray(0, 60)]), 4, 'torn-tail'],
      ];
      for (const [name, journal, applied, code] of rows) {
        const { dir } = plant({ complete: 0, journal, ...(applied === undefined ? {} : { applied }) });
        const h = harness({ dir });
        const dur = await h.open();
        expect(dur.failure(), name).toMatchObject({ phase: 'journal-validate', code });
        expect(dur.state().phase, name).toBe('reconstructing');
        expect(dur.pruningEnabled(), name).toBe(false);
        expect(journalOf(dir), name).toEqual(journal);
        expect(existsSync(tornDirOf(dir)), `${name}: nothing is kept`).toBe(false);
        expect(h.log.filter((l) => /truncate|quarantine|file\.sync/.test(l)), name).toEqual([]);
        await expect(dur.applyAccepted(batch([sessionStart(9)])), name).rejects.toMatchObject({ code: 'not-ready' });
        expect(journalOf(dir), `${name}: nothing was appended behind it`).toEqual(journal);
      }
    });

    it('the name is DETERMINISTIC: the same tail at the same offset gets the same name in another directory, under another clock', async () => {
      const tail = line(2).subarray(0, 77);
      const names: string[] = [];
      for (const ms of [Date.UTC(2026, 9, 15), Date.UTC(2031, 1, 2)]) {
        const { dir } = plant({ complete: 2, tail, applied: 2 });
        const h = harness({ dir });
        h.clock.ms = ms;
        await h.open();
        names.push(...tornFiles(dir));
      }
      expect(names).toEqual([nameOf(line(0).length + line(1).length, tail), nameOf(line(0).length + line(1).length, tail)]);
      expect(names[0]).toMatch(/^\d+-[0-9a-f]{64}\.tail$/);
    });

    it('lastTailHeal() reports the heal for /api/fleet/health: when (the injected clock), how many bytes, and where they are kept', async () => {
      const tail = line(2).subarray(0, 45);
      const { dir, prefixLen } = plant({ complete: 2, tail, applied: 2 });
      const h = harness({ dir });
      const dur = await h.open();
      expect(dur.lastTailHeal()).toEqual({ at: formatDelegationInstant(h.clock.ms), bytes: 45, quarantinePath: path.join(tornDirOf(dir), nameOf(prefixLen, tail)) });
      const clean = await harness({ dir: plant({ complete: 2, applied: 2 }).dir }).open();
      expect(clean.lastTailHeal()).toBeNull();
    });

    it('a quarantine file that is already there with the SAME bytes (an earlier heal that died after its rename) is reused: nothing is rewritten, nothing duplicated', async () => {
      const tail = line(2).subarray(0, 52);
      const { dir, prefixLen } = plant({ complete: 2, tail, applied: 2 });
      mkdirSync(tornDirOf(dir), { recursive: true });
      writeFileSync(path.join(tornDirOf(dir), nameOf(prefixLen, tail)), tail);
      const h = harness({ dir });
      const dur = await h.open();
      expect(dur.failure()).toBeNull();
      expect(h.log.filter((l) => l.startsWith('quarantine.write')), 'no second copy is written').toEqual([]);
      expect(tornFiles(dir)).toEqual([nameOf(prefixLen, tail)]);
      expect(journalOf(dir).length).toBe(prefixLen);
    });

    it('a quarantine file of that name with DIFFERENT bytes is never overwritten and never trusted: the heal fails closed and the journal is untouched', async () => {
      const tail = line(2).subarray(0, 52);
      const { dir, prefixLen, whole } = plant({ complete: 2, tail, applied: 2 });
      mkdirSync(tornDirOf(dir), { recursive: true });
      writeFileSync(path.join(tornDirOf(dir), nameOf(prefixLen, tail)), 'something else entirely');
      const dur = await harness({ dir }).open();
      expect(dur.failure()).toMatchObject({ code: 'tail-heal-failed' });
      expect(dur.state().phase).toBe('reconstructing');
      expect(journalOf(dir)).toEqual(whole);
      expect(readFileSync(path.join(tornDirOf(dir), nameOf(prefixLen, tail)), 'utf8')).toBe('something else entirely');
    });

    it('the tail is re-measured at the cut: bytes that changed between recovery\'s read and the heal are not cut, and are not kept as if they were the tail', async () => {
      const tail = line(2).subarray(0, 52);
      const { dir, whole } = plant({ complete: 2, tail, applied: 2 });
      let opens = 0;
      const inner = nodeDelegationFilePort;
      const port: DelegationFilePort = {
        ...inner,
        openRead: async (p) => {
          if (p.endsWith(DELEGATION_JOURNAL_FILE) && ++opens === 2) appendFileSync(p, 'more bytes behind the tail');
          return inner.openRead(p);
        },
      };
      const dur = await harness({ dir }).open({ port });
      expect(dur.failure()).toMatchObject({ code: 'tail-heal-failed' });
      expect(journalOf(dir)).toEqual(Buffer.concat([whole, Buffer.from('more bytes behind the tail')]));
      expect(existsSync(tornDirOf(dir))).toBe(false);
    });

    describe('a crash or a fault at EVERY operation of the heal (W3-M38 mutant c): the tail is always in the journal or in quarantine, and the next recovery heals the same way', () => {
      const TAIL = line(2).subarray(0, 61);
      const fixture = (): { dir: string; prefixLen: number; whole: Buffer } => plant({ complete: 2, tail: TAIL, applied: 2 });
      let total = 0;
      it('a recording run counts the heal\'s mutating operations (ten: the directory, the temp file, its write and fsync, the rename, two directory fsyncs, the cut, the file fsync, the directory fsync)', async () => {
        const { dir } = fixture();
        const rec = faultPort(nodeDelegationFilePort);
        await harness({ dir }).open({ port: rec.port });
        total = rec.count();
        expect(rec.ops.filter((o) => /^\d+:/.test(o)).map((o) => o.replace(/^\d+:/, '').replace(/[0-9a-f]{64}/g, '<sha>').replace(/\d+-<sha>/g, '<name>'))).toEqual([
          'mkdirp:delegation-events.torn', 'create:<name>.tail.tmp', 'quarantine.write', 'quarantine.sync', 'rename:<name>.tail.tmp-><name>.tail',
          'dirsync:delegation-events.torn', expect.stringMatching(/^dirsync:/), expect.stringMatching(/^truncate:delegation-events\.log:\d+$/),
          'filesync:delegation-events.log', expect.stringMatching(/^dirsync:/),
        ]);
        expect(total).toBe(10);
      });

      for (let k = 0; k < 10; k++) {
        it(`the process dies at operation ${k}: nothing is lost, and a fresh open heals it with no duplicate`, async () => {
          const { dir, prefixLen, whole } = fixture();
          const dying = faultPort(nodeDelegationFilePort, { dieAt: k });
          const dur = await harness({ dir }).open({ port: dying.port });
          expect(dur.failure(), `op ${k}`).toMatchObject({ code: 'tail-heal-failed' });
          expect(dur.state().phase).toBe('reconstructing');
          await expect(dur.applyAccepted(batch([sessionStart(9)]))).rejects.toMatchObject({ code: 'not-ready' });
          // THE INVARIANT: the tail's bytes are in the journal, or whole in quarantine, at every instant.
          const inJournal = journalOf(dir).length === whole.length;
          const keptAs = path.join(tornDirOf(dir), nameOf(prefixLen, TAIL));
          const inQuarantine = existsSync(keptAs) && readFileSync(keptAs).equals(TAIL);
          expect(inJournal || inQuarantine, `op ${k}: the tail is nowhere`).toBe(true);
          if (!inJournal) expect(journalOf(dir), `op ${k}`).toEqual(whole.subarray(0, prefixLen));
          // The next recovery (a restart) heals it the same way.
          const fresh = await harness({ dir }).open();
          expect(fresh.failure(), `op ${k}`).toBeNull();
          expect(journalOf(dir), `op ${k}`).toEqual(whole.subarray(0, prefixLen));
          expect(tornFiles(dir), `op ${k}: one copy, no temp file`).toEqual([nameOf(prefixLen, TAIL)]);
          expect(readFileSync(keptAs)).toEqual(TAIL);
          expect((await fresh.applyAccepted(batch([sessionStart(3)]))).appended.map((r) => r.sequence)).toEqual([3]);
        });

        it(`one transient fault at operation ${k}: the applier is not ready, and its own recover() heals it`, async () => {
          const { dir, prefixLen, whole } = fixture();
          const flaky = faultPort(nodeDelegationFilePort, { failAt: k });
          const dur = await harness({ dir }).open({ port: flaky.port });
          expect(dur.failure(), `op ${k}`).toMatchObject({ code: 'tail-heal-failed' });
          const again = await dur.recover();
          expect(again.failure, `op ${k}`).toBeNull();
          expect(dur.state().phase).toBe('ready');
          expect(journalOf(dir)).toEqual(whole.subarray(0, prefixLen));
          expect(tornFiles(dir)).toEqual([nameOf(prefixLen, TAIL)]);
        });
      }
      it('the count is the one the rows above visit', () => { expect(total).toBe(10); });
    });

    it('a failed append that leaves a fragment is healed by the retry and LOSES NOTHING: the next application reproduces the run that never tore (the lossless row)', async () => {
      const tear = { on: false };
      const tearing = (inner: DelegationFilePort): DelegationFilePort => ({
        ...inner,
        openAppend: async (p) => {
          const handle = await inner.openAppend(p);
          return { ...handle, write: async (b) => (tear.on ? handle.write(b.subarray(0, Math.max(1, b.length - 3))) : handle.write(b)) };
        },
      });
      const first = batch([sessionStart(1)]);
      const second = batch([bareTool(2, X), subagentStart(3, X)], { cursor: cursorFor('2026101400', 300), interval: intervalFor('2026101400', 'measured', T(3)) });
      const a = harness();
      const never = await a.open();
      await never.applyAccepted(first);
      await never.applyAccepted(second);

      const b = harness();
      const torn = await b.open({ port: tearing(spyPort(b.log)) });
      await torn.applyAccepted(first);
      tear.on = true;
      await expect(torn.applyAccepted(second)).rejects.toMatchObject({ code: 'short-write' });
      tear.on = false;
      expect(torn.failure()).toMatchObject({ phase: 'durable-application' });
      const fragment = readFileSync(path.join(b.dir, DELEGATION_JOURNAL_FILE));
      expect(fragment[fragment.length - 1], 'the failed append really left a fragment').not.toBe(0x0a);
      const report = await torn.recover();
      expect(report.failure).toBeNull();
      expect(torn.lastTailHeal()).not.toBeNull();
      await torn.applyAccepted(second);                                   // the bucket is read again: the same events mint the same eventIds

      expect(canonicalDelegationJson(torn.state().checkpoint)).toBe(canonicalDelegationJson(never.state().checkpoint));
      expect(torn.state().checkpoint.activityIdsByNaturalKey).toEqual(never.state().checkpoint.activityIdsByNaturalKey);
      expect(torn.state().checkpoint.bucketCursors).toEqual(never.state().checkpoint.bucketCursors);
      expect(torn.state().checkpoint.observationIntervals).toEqual(never.state().checkpoint.observationIntervals);
      expect(readFileSync(path.join(b.dir, DELEGATION_JOURNAL_FILE))).toEqual(readFileSync(path.join(a.dir, DELEGATION_JOURNAL_FILE)));
      expect(tornFiles(b.dir)).toHaveLength(1);
    });

    // ── MUST 1 (coordinator 5424, R76 M1): a heal is reported as soon as its cut returns, and the boot reports any heal nobody did ──
    /** A port whose `truncate` cuts and then DIES: the kill between the cut and the report. From then on every operation of the dead
     *  process fails, so nothing after the cut (no report, no listing) can happen in it. */
    const dyingAfterCut = (inner: DelegationFilePort): DelegationFilePort => {
      let dead = false;
      const alive = <A extends unknown[], R>(f: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => { if (dead) throw new SimulatedCrash('the process is dead'); return f(...a); };
      return {
        openAppend: alive(inner.openAppend), createTemp: alive(inner.createTemp), rename: alive(inner.rename), fsyncDir: alive(inner.fsyncDir),
        readFile: alive(inner.readFile), openRead: alive(inner.openRead), mkdirp: alive(inner.mkdirp), fsyncFile: alive(inner.fsyncFile),
        listDir: alive(inner.listDir), statFile: alive(inner.statFile),
        truncate: alive(async (p: string, len: number) => { await inner.truncate(p, len); dead = true; throw new SimulatedCrash('killed after the cut'); }),
      };
    };

    it('MUST 1: killed between the cut and the report, the NEXT boot reports the heal from the quarantine: its time, bytes and path', async () => {
      const tail = line(2).subarray(0, 61);
      const { dir, prefixLen } = plant({ complete: 2, tail, applied: 2 });
      const dying = await harness({ dir }).open({ port: dyingAfterCut(nodeDelegationFilePort), warn: () => undefined });
      expect(dying.failure()).toMatchObject({ code: 'tail-heal-failed' });
      expect(dying.lastTailHeal(), 'the dead process reported nothing').toBeNull();
      await dying.close();
      expect(journalOf(dir).length, 'the cut happened').toBe(prefixLen);
      const kept = path.join(tornDirOf(dir), nameOf(prefixLen, tail));
      const warned: string[] = [];
      const booted = await harness({ dir, store: new CoordStore(openCoordDb(path.join(dir, 'coord.db'))) }).open({ warn: (m) => warned.push(m) });
      expect(booted.failure()).toBeNull();
      const mtime = formatDelegationInstant(Math.trunc(statSync(kept).mtimeMs));
      expect(booted.lastTailHeal()).toEqual({ at: mtime, bytes: tail.length, quarantinePath: kept, foundAtBoot: true });
      const line0 = warned.filter((m) => m.includes(kept));
      expect(line0).toHaveLength(1);
      expect(line0[0]).toMatch(/^ccrc-server: /);
      expect(line0[0]).toContain(`${tail.length} byte`);
      expect(line0[0]).toContain(mtime);
      expect(booted.tailQuarantineUnmeasured()).toBe(false);
    });

    it('R76 M1: the heal is recorded and told as soon as the cut returns: a fsync failing after it still leaves the heal reported', async () => {
      const tail = line(2).subarray(0, 61);
      const { dir, prefixLen } = plant({ complete: 2, tail, applied: 2 });
      const warned: string[] = [];
      const failingSync: DelegationFilePort = { ...nodeDelegationFilePort, fsyncFile: async () => { throw new Error('EIO: the journal fsync failed'); } };
      const dur = await harness({ dir }).open({ port: failingSync, warn: (m) => warned.push(m) });
      expect(dur.failure()).toMatchObject({ code: 'tail-heal-failed' });
      const kept = path.join(tornDirOf(dir), nameOf(prefixLen, tail));
      expect(dur.lastTailHeal()).toMatchObject({ bytes: tail.length, quarantinePath: kept });
      expect(dur.lastTailHeal()!.foundAtBoot).toBeUndefined();
      expect(warned.some((m) => m.includes('healed a torn tail') && m.includes(kept))).toBe(true);
    });

    it('MUST 1: every boot reports the newest quarantined tail again until it is removed; a leftover *.tail.tmp is ignored; no marker is written', async () => {
      const { dir } = plant({ complete: 2, applied: 2 });
      mkdirSync(tornDirOf(dir), { recursive: true });
      const older = path.join(tornDirOf(dir), `10-${'a'.repeat(64)}.tail`);
      const newer = path.join(tornDirOf(dir), `20-${'b'.repeat(64)}.tail`);
      writeFileSync(older, 'abc');
      writeFileSync(newer, 'defgh');
      writeFileSync(path.join(tornDirOf(dir), `30-${'c'.repeat(64)}.tail.tmp`), 'ignored');
      utimesSync(older, new Date(Date.UTC(2026, 9, 14, 1)), new Date(Date.UTC(2026, 9, 14, 1)));
      utimesSync(newer, new Date(Date.UTC(2026, 9, 14, 2)), new Date(Date.UTC(2026, 9, 14, 2)));
      const before = tornFiles(dir);
      for (let boot = 0; boot < 2; boot++) {
        const warned: string[] = [];
        const dur = await harness({ dir, store: new CoordStore(openCoordDb(path.join(dir, 'coord.db'))) }).open({ warn: (m) => warned.push(m) });
        expect(dur.lastTailHeal(), `boot ${boot}: the newest`).toEqual({ at: '2026-10-14T02:00:00.000Z', bytes: 5, quarantinePath: newer, foundAtBoot: true });
        expect(warned.filter((m) => m.includes('quarantined torn tail')), `boot ${boot}: each one once`).toHaveLength(2);
        expect(warned.some((m) => m.includes('.tail.tmp'))).toBe(false);
        await dur.recover();
        expect(warned.filter((m) => m.includes('quarantined torn tail')), `boot ${boot}: a recovery of the SAME process does not repeat them`).toHaveLength(2);
        await dur.close();
      }
      expect(tornFiles(dir), 'the report wrote nothing').toEqual(before);
      rmSync(older);
      rmSync(newer);
      const after = await harness({ dir, store: new CoordStore(openCoordDb(path.join(dir, 'coord.db'))) }).open({ warn: () => undefined });
      expect(after.lastTailHeal(), 'removed by the operator: nothing to report').toBeNull();
    });

    it('MUST 1: a quarantine that cannot be listed is UNMEASURED, never "no heal"', async () => {
      const { dir } = plant({ complete: 2, applied: 2 });
      const warned: string[] = [];
      const unlistable: DelegationFilePort = { ...nodeDelegationFilePort, listDir: async () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); } };
      const dur = await harness({ dir }).open({ port: unlistable, warn: (m) => warned.push(m) });
      expect(dur.failure()).toBeNull();
      expect(dur.tailQuarantineUnmeasured()).toBe(true);
      expect(dur.lastTailHeal()).toBeNull();
      expect(warned.some((m) => m.startsWith('ccrc-server: ') && m.includes('could not be listed') && m.includes('unmeasured'))).toBe(true);
      const absent = await harness({ dir: plant({ complete: 2, applied: 2 }).dir }).open();
      expect(absent.tailQuarantineUnmeasured(), 'no quarantine directory at all is a measured "none"').toBe(false);
    });
  });
});


// ── O1: a meta-opened ID is not exposed before the checkpoint replacement (W3-M12) ──────────────────────────────────────

describe('O1 crash-window row (W3-M12): a meta-opened activity ID escapes only after an atomic checkpoint holds it', () => {
  let expectedId = '';
  async function metaRun(edge: DelegationDurabilityEdge | null, when: 'before' | 'after') {
    const h = harness();
    const first = await h.open();
    const named = await first.applyAccepted(batch([sessionStart(1), bareTool(2, X)]));          // X is named, no qualifying join: a candidate
    // The identity record is the bare occurrence's ACCEPTED journalId (sequence 2); the ID is derived from it.
    expectedId = deriveDelegationActivityId(keyOf(X), named.appended[1]!.journalId);
    await first.close();
    const store2 = new CoordStore(openCoordDb(path.join(h.dir, 'coord.db')));
    const h2 = harness({ dir: h.dir, store: store2 });
    const dur = await h2.open({ onEdge: edge === null ? undefined : (e, w) => { if (e === edge && w === when) throw new SimulatedCrash(`${e}:${w}`); } });
    h2.log.length = 0;
    return { h2, dur, store2 };
  }

  it('a meta read opens the activity from the earliest retained naming record, without a journal event, and advances only the revision', async () => {
    const { h2, dur } = await metaRun(null, 'before');
    const before = dur.state().checkpoint;
    const out = await dur.applyPositiveAgentMeta({ parentId: PARENT, parentIncarnation: INC, agentId: X });
    expect(out).toMatchObject({ kind: 'opened', activityId: expectedId });
    const after = dur.state().checkpoint;
    expect(after.revision).toBe(before.revision + 1);
    expect(after.appliedJournalSequence).toBe(before.appliedJournalSequence);       // no journal sequence invented
    expect(after.appliedJournalId).toBe(before.appliedJournalId);
    expect(h2.log.some((l) => l.startsWith('journal.'))).toBe(false);
    expect(after.activityIdsByNaturalKey[encodeDelegationNaturalKey(keyOf(X))]).toBe(expectedId);
    expect(after.pruningHolds.filter((h) => h.reason === 'identity-candidate')).toEqual([]);
  });

  it('opening waits for at least one retained event naming the agent; a mapped agent answers already-open', async () => {
    const { dur } = await metaRun(null, 'before');
    expect(await dur.applyPositiveAgentMeta({ parentId: PARENT, parentIncarnation: INC, agentId: Y })).toEqual({ kind: 'waiting-for-evidence' });
    await dur.applyPositiveAgentMeta({ parentId: PARENT, parentIncarnation: INC, agentId: X });
    expect(await dur.applyPositiveAgentMeta({ parentId: PARENT, parentIncarnation: INC, agentId: X })).toEqual({ kind: 'already-open', activityId: expectedId });
  });

  const EDGES = ['build', 'checkpoint-write', 'checkpoint-fsync', 'checkpoint-rename', 'directory-fsync'] as const;
  for (const edge of EDGES) {
    for (const when of ['before', 'after'] as const) {
      it(`crash ${when} ${edge}: the call rejects, no ID is returned, SQLite is untouched, and the ID is in no durable place unless the rename completed`, async () => {
        const { h2, dur, store2 } = await metaRun(edge, when);
        const returned: string[] = [];
        await expect(dur.applyPositiveAgentMeta({ parentId: PARENT, parentIncarnation: INC, agentId: X }).then((o) => { if (o.kind === 'opened') returned.push(o.activityId); return o; })).rejects.toThrow(SimulatedCrash);
        expect(returned).toEqual([]);
        expect(dur.state().checkpoint.activities).toEqual([]);                  // not even the applier's own state shows it
        expect(dur.state().checkpoint.activityIdsByNaturalKey).toEqual({});
        expect(h2.log.filter((l) => l === 'project' || l.startsWith('insertEvents'))).toEqual([]);
        expect(store2.readDelegationProjection().activities).toEqual([]);
        const onDisk = decodeDelegationCheckpoint(new Uint8Array(readDisk(h2.dir).checkpoint!));
        const renamed = edge === 'directory-fsync' || (edge === 'checkpoint-rename' && when === 'after');
        expect(onDisk.activities.map((a) => a.activityId)).toEqual(renamed ? [expectedId] : []);
        // A restart never invents it either; the same meta later yields the same, deterministic ID.
        const fresh = await harness({ dir: h2.dir }).open();
        const out = await fresh.applyPositiveAgentMeta({ parentId: PARENT, parentIncarnation: INC, agentId: X });
        expect(out.kind === 'opened' || out.kind === 'already-open' ? out.activityId : 'none').toBe(expectedId);
      });
    }
  }
});

// ── lease creation by the serialized adapter (W3-M18A, W3-M62) ───────────────────────────────────────────────────────

describe('journal-alone-creates-lease table (W3-M18A)', () => {
  async function withActivity() {
    const h = harness();
    const dur = await h.open();
    const out = await dur.applyAccepted(batch([sessionStart(1), bareTool(2, X), subagentStart(3, X)]));
    const act = out.openedActivities[0]!;
    const request = (over: Partial<DelegationLeaseCreationRequest> = {}): DelegationLeaseCreationRequest => ({
      activityId: act.activityId, parentId: PARENT, parentIncarnation: INC, project: 'project-a', adminRecord: 'wt-1', canonicalPath: '/work/project-a/wt-1',
      creationBase: null, sourceKind: 'agent', correlationJournalIds: [out.appended[2]!.journalId], firstObservedAt: T(40), ...over,
    });
    return { h, dur, act, request, out };
  }

  it('creates a lease only by appending a lease-created entry: generation 0, equal sequences, the injected UUID, the derived lineage ID', async () => {
    const { h, dur, act, request } = await withActivity();
    const out = await dur.createLease(request());
    expect(out).toMatchObject({ kind: 'created', leaseId: '5b0d9d9e-6d3c-4d2e-9f7a-0a1b2c3d4e5f', sequence: 4 });
    const records = parseDelegationJournal(new Uint8Array(readDisk(h.dir).journal!), { completeFromStart: true });
    const entry = records[3]!.entry;
    expect(entry.kind).toBe('lease-created');
    if (entry.kind !== 'lease-created') return;
    expect(entry).toMatchObject({ leaseId: '5b0d9d9e-6d3c-4d2e-9f7a-0a1b2c3d4e5f', generation: 0, activityId: act.activityId, firstObservedAt: T(40) });
    expect(entry.lineageId).toBe(deriveDelegationLineageId({ leaseId: entry.leaseId, parentId: PARENT, parentIncarnation: INC, activityId: act.activityId }));
    const cp = dur.state().checkpoint;
    expect(cp.leases).toHaveLength(1);
    expect(cp.leases[0]).toMatchObject({ generation: 0, creatingJournalSequence: 4, currentJournalSequence: 4, leaseId: entry.leaseId });
    expect(cp.appliedJournalSequence).toBe(4);
    // and SQLite says the same
    expect(h.store.readDelegationProjection().leases.map((l) => l.leaseId)).toEqual([entry.leaseId]);
  });

  it('the lease ID is exactly what the injected randomUUID returned: not derived from the request, the activity or any report data', async () => {
    const { h, dur, request } = await withActivity();
    h.uuids.length = 0;
    h.uuids.push('00000000-0000-4000-8000-000000000001');
    const a = await dur.createLease(request());
    h.uuids.push('00000000-0000-4000-8000-000000000002');
    const b = await dur.createLease(request({ adminRecord: 'wt-2', canonicalPath: '/work/project-a/wt-2' }));
    expect([a, b].map((o) => (o.kind === 'created' ? o.leaseId : o.kind))).toEqual(['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']);
  });

  it('refuses a checkpoint-only change that adds a lease row, or alters one: only the journal creates leases', async () => {
    const { dur, act, request } = await withActivity();
    const add = (cp: DelegationCheckpointV1): DelegationCheckpointV1 => {
      const lease: DelegationLeaseRow = {
        leaseId: 'lease-forged', generation: 0, creatingJournalSequence: 3, currentJournalSequence: 3, activityId: act.activityId, parentId: PARENT, parentIncarnation: INC,
        project: 'project-a', adminRecord: 'wt-f', canonicalPath: '/work/f', creationBase: null, sourceKind: 'agent', parentageState: 'linked', workspaceState: 'unmeasured',
        disposition: 'ephemeral', cleanupState: 'not-due', cleanupPopulation: 'ephemeral-lease', firstObservedAt: T(7), lastObservedAt: T(7), terminalEvidenceAt: null,
        adoptedAt: null, retainedAt: null, promotedAt: null, cleanupDueAt: null, cleanupStartedAt: null, cleanupFinishedAt: null, cleanupEvidenceJson: null,
        carrierGenerationSeen: null, releasedAt: null,
      };
      return { ...cp, leases: [lease], lineage: [{ lineageId: deriveDelegationLineageId(lease), parentId: PARENT, parentIncarnation: INC, activityId: null, leaseId: 'lease-forged', runId: null, openedAt: T(7), closedAt: null, closeReason: null }] };
    };
    await expect(dur.applyCheckpointChange(add)).rejects.toMatchObject({ code: 'change-refused' });
    expect(dur.state().checkpoint.leases).toEqual([]);
    await dur.createLease(request());
    await expect(dur.applyCheckpointChange((cp) => ({ ...cp, leases: cp.leases.map((l) => ({ ...l, generation: 1 })) }))).rejects.toMatchObject({ code: 'change-refused' });
    await expect(dur.applyCheckpointChange((cp) => ({ ...cp, leases: [] }))).rejects.toMatchObject({ code: 'change-refused' });
    expect(dur.failure()).toBeNull();                                    // refused before any write: not a failed application
  });

  it('recovery refuses a checkpoint that carries a lease no journal entry created, and one with a nonzero generation', async () => {
    const { h, dur, request } = await withActivity();
    await dur.createLease(request());
    await dur.close();
    const cp = decodeDelegationCheckpoint(new Uint8Array(readDisk(h.dir).checkpoint!));
    const journal = new Uint8Array(readDisk(h.dir).journal!);
    const records = parseDelegationJournal(journal, { completeFromStart: true });
    expect(recoverDelegation(encodeDelegationCheckpoint(cp), records).failure).toBeNull();
    expect(recoverDelegation(encodeDelegationCheckpoint({ ...cp, leases: cp.leases.map((l) => ({ ...l, generation: 1 })) }), records).failure?.phase).toBe('checkpoint-validate');
    expect(recoverDelegation(encodeDelegationCheckpoint(cp), records.slice(0, 3)).failure).not.toBeNull();   // the entry is gone: the lease has no authority
  });

  it('recovery refuses a lease row whose creating sequence names an evidence record: the proof needs a lease-created entry, not just a record', () => {
    const { cp, records } = ready([sessionStart(1), subagentStart(2, X), sessionStart(3)]);
    const forged = withLeaseRow(cp);                                    // lease-9, creatingJournalSequence 2: an evidence record
    expect(forged.leases[0]!.creatingJournalSequence).toBe(2);
    const report = recoverDelegation(encodeDelegationCheckpoint(forged), records);
    expect(report.failure).toMatchObject({ phase: 'final-validate', code: 'lease-proof' });
    expect(report.state.phase).toBe('reconstructing');
    // The same lease with a real lease-created entry behind it is accepted: the proof is exactly what separates the two.
    const act = activityOf(cp, X)!;
    const withEntry = chainOf([evidence(sessionStart(1)), evidence(subagentStart(2, X)), leaseEntryFor(act.activityId, { leaseId: 'lease-9', adminRecord: 'wt-9', canonicalPath: '/work/project-a/wt-9' })]);
    expect(recoverDelegation(null, withEntry).failure).toBeNull();
  });

  it('no entry kind but the two wave-3 ones can be journaled, and a lease-created decoded with generation 1 is refused', () => {
    const [r] = chainOf([leaseEntryFor('a'.repeat(64))]);
    const line = new TextDecoder().decode(encodeDelegationJournalRecord(r!)).trimEnd();
    expect(failureCode(() => decodeDelegationJournalLine(new TextEncoder().encode(line.replace('"generation":0', '"generation":1'))))).toBe('bad-field');
    expect(failureCode(() => decodeDelegationJournalLine(new TextEncoder().encode(line.replace('"kind":"lease-created"', '"kind":"lease-transitioned"'))))).toBe('bad-field');
  });
});

describe('adapter-owned UUID and replay-stable lineage table (W3-M62)', () => {
  async function ready2() {
    const h = harness();
    const dur = await h.open();
    const out = await dur.applyAccepted(batch([sessionStart(1), subagentStart(2, X)]));
    const act = out.openedActivities[0]!;
    const req = (over: Partial<DelegationLeaseCreationRequest> = {}): DelegationLeaseCreationRequest => ({
      activityId: act.activityId, parentId: PARENT, parentIncarnation: INC, project: 'project-a', adminRecord: 'wt-1', canonicalPath: '/work/project-a/wt-1',
      creationBase: null, sourceKind: 'agent', correlationJournalIds: [], firstObservedAt: T(40), ...over,
    });
    return { h, dur, act, req };
  }

  it('calls the injected randomUUID exactly once for a new identity', async () => {
    const { h, dur, req } = await ready2();
    await dur.createLease(req());
    expect(h.uuidCalls.n).toBe(1);
  });

  it('calls it ZERO times after deduplication for a duplicate identity, a held path, an unmeasured request and an unmeasured activity', async () => {
    const { h, dur, act, req } = await ready2();
    await dur.createLease(req());
    const before = h.uuidCalls.n;
    const calls: Array<[string, DelegationLeaseCreationRequest, string]> = [
      ['a duplicate unreleased identity', req(), 'duplicate'],
      ['a path another identity holds', req({ creationBase: 'base-1' }), 'refused'],
      ['a request with no canonical path', req({ canonicalPath: '' }), 'refused'],
      ['a request with an unmeasured instant', req({ firstObservedAt: 'later' }), 'refused'],
      ['a source kind no wave-3 writer has', req({ sourceKind: 'attached' }), 'refused'],
      ['a source kind that is not the activity\'s', req({ adminRecord: 'wt-3', canonicalPath: '/w/3', sourceKind: 'workflow' }), 'refused'],
      ['an activity the checkpoint does not hold', req({ activityId: 'f'.repeat(64), adminRecord: 'wt-4', canonicalPath: '/w/4' }), 'refused'],
      ['an activity of another parent', req({ parentId: 'lane-b-demo', adminRecord: 'wt-5', canonicalPath: '/w/5' }), 'refused'],
    ];
    for (const [name, request, kind] of calls) {
      const out = await dur.createLease(request);
      expect(out.kind, name).toBe(kind);
      // `attached` has no wave-3 writer: it is refused as an unmeasured REQUEST, before any activity check could refuse it for another reason.
      if (request.sourceKind === 'attached') expect(out).toMatchObject({ kind: 'refused', reason: 'unmeasured-request', detail: expect.stringContaining('agent, workflow, raw') });
    }
    expect(h.uuidCalls.n).toBe(before);
    expect(dur.state().checkpoint.leases).toHaveLength(1);
  });

  it('refuses a lease whose canonical path an unreleased lease holds, with the holder named, and journals nothing', async () => {
    const { h, dur, req } = await ready2();
    const first = await dur.createLease(req());
    const journalBefore = readDisk(h.dir).journal!;
    const out = await dur.createLease(req({ creationBase: 'base-1' }));
    expect(out).toMatchObject({ kind: 'refused', reason: 'canonical-path-held', heldBy: first.kind === 'created' ? first.leaseId : '?' });
    expect(readDisk(h.dir).journal).toEqual(journalBefore);
    // The projection cannot have been poisoned by the refused lease.
    expect(h.store.readDelegationProjection().leases).toHaveLength(1);
  });

  it('the same identity with a null base and with a string base are two identities (on two paths)', async () => {
    const { dur, req } = await ready2();
    expect((await dur.createLease(req())).kind).toBe('created');
    expect((await dur.createLease(req({ creationBase: 'main', canonicalPath: '/work/project-a/wt-2' }))).kind).toBe('created');
    expect((await dur.createLease(req({ creationBase: 'main', canonicalPath: '/work/project-a/wt-2' }))).kind).toBe('duplicate');
  });

  it('replay reconstructs the lease and its lineage from the entry\'s firstObservedAt, whatever the clock says at replay', async () => {
    const { h, dur, req } = await ready2();
    await dur.createLease(req({ firstObservedAt: T(40) }));
    await dur.close();
    const live = decodeDelegationCheckpoint(new Uint8Array(readDisk(h.dir).checkpoint!));
    // Lose the checkpoint; replay the journal alone, years later.
    const dir = copyDisk(h.dir, {});
    rmSync(path.join(dir, DELEGATION_CHECKPOINT_FILE));
    const later = harness({ dir });
    later.clock.ms = Date.UTC(2031, 0, 1);
    const replayed = await later.open();
    const cp = replayed.state().checkpoint;
    expect(replayed.failure()).toBeNull();
    expect(cp.leases[0]).toMatchObject({ firstObservedAt: T(40), lastObservedAt: T(40), generation: 0, creatingJournalSequence: 3 });
    expect(cp.lineage[0]).toMatchObject({ openedAt: T(40) });
    const record = parseDelegationJournal(new Uint8Array(readDisk(h.dir).journal!))[2]!;
    expect(record.acceptedAt).not.toBe(T(40));                            // the entry's instant is neither the acceptance time...
    expect(cp.leases[0]!.firstObservedAt).not.toBe(record.acceptedAt);
    expect(cp.leases[0]!.firstObservedAt).not.toBe(formatDelegationInstant(later.clock.ms));        // ...nor the replay clock
    expect(withoutRevision({ ...cp, pruningHolds: [] })).toBe(withoutRevision({ ...live, pruningHolds: [] }));
    expect(cp.lineage[0]!.lineageId).toBe(live.lineage[0]!.lineageId);
  });
});

// ── checkpoint-only changes and the sessions that never leave ────────────────────────────────────────────────────────

describe('checkpoint-only changes, and wave 3 never removes a session (hand-off 2 from the Task 7 re-review)', () => {
  it('a change that records coordinator intent goes through the same replacement; the identity invariants hold', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([sessionStart(1)]));
    const out = await dur.applyCheckpointChange((cp) => ({
      ...cp, coordinatorIntentByParent: { [delegationIntentKey(PARENT, INC)]: T(5) },
      sessions: cp.sessions.map((s) => ({ ...s, explicitIntentAt: T(5), effective: true, effectiveBasis: ['explicit' as const] })),
    }));
    expect(out.durable).toBe(true);
    expect(dur.state().checkpoint.revision).toBe(2);
    expect(dur.state().checkpoint.appliedJournalSequence).toBe(1);
    const fresh = await harness({ dir: h.dir }).open();
    expect(fresh.state().checkpoint.coordinatorIntentByParent).toEqual({ [delegationIntentKey(PARENT, INC)]: T(5) });
    await expect(dur.applyCheckpointChange((cp) => ({ ...cp, coordinatorIntentByParent: {} }))).rejects.toMatchObject({ code: 'intent-map' });
  });

  it('refuses a change that moves the applied journal position', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([sessionStart(1)]));
    await expect(dur.applyCheckpointChange((cp) => ({ ...cp, appliedJournalSequence: 0, appliedJournalId: null, appliedJournalDigest: null }))).rejects.toMatchObject({ code: 'change-refused' });
  });

  it('REFUSES a change that removes a session: nothing in wave 3 lets a session leave the checkpoint', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([sessionStart(1), sessionStart(2, { sessionId: 'lane-b-demo' })]));
    const before = readDisk(h.dir);
    await expect(dur.applyCheckpointChange((cp) => ({
      ...cp, sessions: cp.sessions.filter((s) => s.sessionId !== 'lane-b-demo'),
    }))).rejects.toMatchObject({ code: 'change-refused', message: expect.stringContaining('never removes a session') });
    expect(readDisk(h.dir)).toEqual(before);
    expect(dur.state().checkpoint.sessions.map((s) => s.sessionId)).toEqual([PARENT, 'lane-b-demo']);
  });

  it('every durable state, live or recovered, holds every session any earlier state held (the fold and recovery only add or update)', async () => {
    const h = harness();
    const dur = await h.open();
    let seen = new Set<string>();
    for (const n of [1, 2, 3, 4, 5]) {
      await dur.applyAccepted(batch([sessionStart(n, { sessionId: `lane-${n}-demo` }), subagentStart(n + 10, `agent-${n}`, { sessionId: `lane-${n}-demo` })]));
      const now = new Set(dur.state().checkpoint.sessions.map((s) => `${s.sessionId}/${s.parentIncarnation}`));
      for (const k of seen) expect(now.has(k), k).toBe(true);
      seen = now;
      const recovered = recoverDelegation(readDisk(h.dir).checkpoint, parseDelegationJournal(new Uint8Array(readDisk(h.dir).journal!)));
      expect(recovered.state.checkpoint.sessions.length).toBe(now.size);
    }
    expect(seen.size).toBe(5);
  });

  it('the projection repair removes a session\'s SQLite events only for drift, one session at a time, touching no other session\'s rows', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([sessionStart(1), sessionStart(2), sessionStart(3, { sessionId: 'lane-b-demo' }), sessionStart(4, { sessionId: 'lane-b-demo' })]));
    const db: DatabaseSync = h.store.db;
    const idsOf = (session: string): unknown[] => db.prepare('SELECT id FROM delegation_events WHERE sessionId = ? ORDER BY id').all(session).map((r) => r['id']);
    const bBefore = idsOf('lane-b-demo');
    // Drift: one of lane-a's stored rows no longer says what the journal says, and another is missing (so SQLite's count disagrees
    // with the journal's and the replay covers the whole journal, where the tampered row is met).
    db.prepare("UPDATE delegation_events SET payloadJson = '{}' WHERE sessionId = ? AND journalSequence = 1").run(PARENT);
    db.prepare('DELETE FROM delegation_events WHERE journalSequence = 2').run();
    const report = await dur.repairProjection();
    expect(report).toMatchObject({ healedSessions: 1, wipedAll: false, fullReplay: true });
    expect(idsOf('lane-b-demo')).toEqual(bBefore);                       // the other session's rows were not touched
    const row = db.prepare('SELECT payloadJson FROM delegation_events WHERE journalSequence = 1').get();
    expect(row?.['payloadJson']).not.toBe('{}');                          // the journal won over SQLite
    expect(h.store.readDelegationProjection().sessions).toHaveLength(2);
  });
});

// ── fix round 1, I1: O4's immutable mapping on the checkpoint-only door ──────────────────────────────────────────────

describe('O4 guard on the checkpoint-only door (fix round 1, I1): a change cannot drop, re-map or add an activity', () => {
  async function withX() {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([sessionStart(1), bareTool(2, X), subagentStart(3, X)]));
    const act = activityOf(dur.state().checkpoint, X)!;
    return { h, dur, act, enc: encodeDelegationNaturalKey(keyOf(X)) };
  }
  const otherJournalId = eid(99);
  const otherId = deriveDelegationActivityId(keyOf(X), otherJournalId);

  type Change = (cp: DelegationCheckpointV1, act: DelegationActivityRow, enc: string) => DelegationCheckpointV1;
  const table: Array<[string, Change]> = [
    ['drops an activity and its mapping', (cp) => ({ ...cp, activities: [], activityIdsByNaturalKey: {} })],
    ['re-maps an activity to another identity journalId, rows and map consistent', (cp, act, enc) => ({
      ...cp, activities: [{ ...act, activityId: otherId, identityJournalId: otherJournalId }], activityIdsByNaturalKey: { [enc]: otherId },
    })],
    ['re-maps the natural-key map alone', (cp, _act, enc) => ({ ...cp, activityIdsByNaturalKey: { [enc]: otherId } })],
    ['adds an activity and its mapping (only the fold and the meta door open activities)', (cp, act) => {
      const y = { ...act, activityId: deriveDelegationActivityId(keyOf(Y), eid(98)), upstreamId: Y, identityJournalId: eid(98), openedAt: T(5), lastEventAt: T(5) };
      return { ...cp, activities: [act, y], activityIdsByNaturalKey: { ...cp.activityIdsByNaturalKey, [encodeDelegationNaturalKey(keyOf(Y))]: y.activityId } };
    }],
    ['changes an identity column of a kept activity (openedAt)', (cp, act) => ({ ...cp, activities: [{ ...act, openedAt: T(3) }] })],
  ];
  for (const [name, change] of table) {
    it(`refuses a change that ${name}, writes nothing and does not poison the applier`, async () => {
      const { h, dur, act, enc } = await withX();
      const before = readDisk(h.dir);
      const stateBefore = dur.state();
      h.log.length = 0;
      await expect(dur.applyCheckpointChange((cp) => change(cp, act, enc))).rejects.toMatchObject({ code: 'change-refused' });
      expect(h.log, 'nothing was written').toEqual([]);
      expect(readDisk(h.dir)).toEqual(before);
      expect(dur.state()).toBe(stateBefore);
      expect(dur.failure()).toBeNull();
      expect(dur.pruningEnabled()).toBe(true);
      // The activity is still there under the same ID, and the applier still applies.
      expect(activityOf(dur.state().checkpoint, X)!.activityId).toBe(act.activityId);
      await dur.applyAccepted(batch([sessionStart(9)]));
    });
  }

  it('accepts a change that updates the activity\'s non-identity columns, with the ID and the mapping unchanged', async () => {
    const { dur, act, enc } = await withX();
    const out = await dur.applyCheckpointChange((cp) => ({
      ...cp, activities: cp.activities.map((a) => ({ ...a, displayName: 'reviewer', executionState: 'ended' as const, endedAt: T(6), lastEventAt: T(6) })),
    }));
    expect(out.durable).toBe(true);
    const after = activityOf(dur.state().checkpoint, X)!;
    expect(after).toMatchObject({ activityId: act.activityId, identityJournalId: act.identityJournalId, openedAt: act.openedAt, displayName: 'reviewer', executionState: 'ended' });
    expect(dur.state().checkpoint.activityIdsByNaturalKey).toEqual({ [enc]: act.activityId });
  });

  it('and a recovery after those refusals still finds the one original ID', async () => {
    const { h, dur, act } = await withX();
    await expect(dur.applyCheckpointChange((cp) => ({ ...cp, activities: [], activityIdsByNaturalKey: {} }))).rejects.toMatchObject({ code: 'change-refused' });
    await dur.close();
    const fresh = await harness({ dir: h.dir }).open();
    expect(fresh.failure()).toBeNull();
    expect(fresh.state().checkpoint.activities.map((a) => a.activityId)).toEqual([act.activityId]);
  });
});

// ── fix round 2, N1: a change is handed a copy ───────────────────────────────────────────────────────────────────────

describe('a checkpoint-only change is handed a COPY, so editing its argument in place cannot get past the guards (fix round 2, N1)', () => {
  async function withXAndLease() {
    const h = harness();
    const dur = await h.open();
    const built = await dur.applyAccepted(batch([sessionStart(1), bareTool(2, X), subagentStart(3, X), sessionStart(4, { sessionId: 'lane-b-demo' })]));
    const act = built.openedActivities[0]!;
    await dur.createLease({
      activityId: act.activityId, parentId: PARENT, parentIncarnation: INC, project: 'project-a', adminRecord: 'wt-1', canonicalPath: '/work/project-a/wt-1',
      creationBase: null, sourceKind: 'agent', correlationJournalIds: [], firstObservedAt: T(40),
    });
    return { h, dur, enc: encodeDelegationNaturalKey(keyOf(X)) };
  }
  type InPlace = (cp: DelegationCheckpointV1, enc: string) => DelegationCheckpointV1;
  const otherId = deriveDelegationActivityId(keyOf(X), eid(99));
  // Each change edits its ARGUMENT and returns it. Against a change handed the very object the guards compare it with, the before/after
  // comparison is the object against itself and every guard passes.
  const table: Array<[string, InPlace]> = [
    ['drops the activities and their map, in place', (cp) => { Object.assign(cp, { activities: [], activityIdsByNaturalKey: {} }); return cp; }],
    ['edits an activity\'s identity column (openedAt), in place', (cp) => { Object.assign(cp.activities[0]!, { openedAt: T(3) }); return cp; }],
    ['re-maps the natural-key map, in place', (cp, enc) => { (cp.activityIdsByNaturalKey as Record<string, string>)[enc] = otherId; return cp; }],
    ['removes a session by splicing the list, in place', (cp) => { (cp.sessions as unknown as unknown[]).splice(1); return cp; }],
    ['alters a lease (parentageState), in place', (cp) => { Object.assign(cp.leases[0]!, { parentageState: 'unmeasured' }); return cp; }],
  ];
  for (const [name, change] of table) {
    it(`refuses a change that ${name}; nothing is written and the live state is untouched`, async () => {
      const { h, dur, enc } = await withXAndLease();
      const disk = readDisk(h.dir);
      const live = dur.state().checkpoint;
      const snapshot = JSON.stringify({ a: live.activities, m: live.activityIdsByNaturalKey, s: live.sessions.map((x) => x.sessionId), l: live.leases, n: live.lineage });
      h.log.length = 0;
      await expect(dur.applyCheckpointChange((cp) => change(cp, enc))).rejects.toMatchObject({ code: 'change-refused' });
      expect(h.log, 'nothing was written').toEqual([]);
      expect(readDisk(h.dir)).toEqual(disk);
      expect(dur.failure()).toBeNull();
      // A refused change must not have reached the applier's own rows through the argument: the next application builds from them.
      await dur.applyAccepted(batch([sessionStart(9)]));
      const after = dur.state().checkpoint;
      expect(JSON.stringify({ a: after.activities, m: after.activityIdsByNaturalKey, s: after.sessions.map((x) => x.sessionId), l: after.leases, n: after.lineage })).toBe(snapshot);
    });
  }

  it('still accepts a change that edits a non-identity column of its argument in place and returns it', async () => {
    const { dur, enc } = await withXAndLease();
    const out = await dur.applyCheckpointChange((cp) => { Object.assign(cp.activities[0]!, { displayName: 'reviewer' }); return cp; });
    expect(out.durable).toBe(true);
    expect(activityOf(dur.state().checkpoint, X)).toMatchObject({ displayName: 'reviewer' });
    expect(Object.keys(dur.state().checkpoint.activityIdsByNaturalKey)).toEqual([enc]);
  });
});

// ── fix round 2, N2: the evidence count is proved before step 1 and adopted without a throw ─────────────────────────────

describe('the evidence count cannot reject an application that is already durable (fix round 2, N2)', () => {
  it('assertExtendedBy refuses a batch that does not extend the index strictly upward; extend adopts one that does', () => {
    const index = new DelegationEvidenceIndex();
    index.add(2);
    index.add(5);
    for (const bad of [[5], [4], [1], [6, 6], [6, 7, 7], [7, 6]]) {
      expect(failureCode(() => index.assertExtendedBy(bad)), JSON.stringify(bad)).toBe('fold-refused');
    }
    expect(index.total).toBe(2);                                 // a refused batch changed nothing
    expect(failureCode(() => index.assertExtendedBy([]))).toBe('accepted');
    expect(failureCode(() => index.assertExtendedBy([6, 9, 10]))).toBe('accepted');
    index.extend([6, 9, 10]);
    expect(index.total).toBe(5);
    expect(index.countAtOrBelow(9)).toBe(4);
    expect(failureCode(() => index.add(10))).toBe('fold-refused');          // recovery's one-at-a-time add keeps its refusal
  });

  it('an index that runs ahead of the journal refuses the application BEFORE step 1 and FAILS the applier, and recovery rebuilds it (8A re-review 2)', async () => {
    const h = harness();
    const dur = await h.open({ warn: () => undefined });
    await dur.applyAccepted(batch([sessionStart(1)]));
    const disk = readDisk(h.dir);
    // The bug this invariant exists to catch: the applier's count of the journal is ahead of the journal.
    (dur as unknown as { evidence: DelegationEvidenceIndex }).evidence.add(500);
    h.log.length = 0;
    await expect(dur.applyAccepted(batch([sessionStart(2)]))).rejects.toMatchObject({ code: 'fold-refused' });
    expect(h.log, 'nothing was written').toEqual([]);
    expect(readDisk(h.dir)).toEqual(disk);
    // the applier's own state is wrong: it is failed (reconstructing, pruning off), never left refusing every later application
    expect(dur.failure()).toMatchObject({ phase: 'durable-application' });
    expect(dur.pruningEnabled()).toBe(false);
    await dur.recover();
    expect(dur.failure()).toBeNull();
    expect(dur.state().checkpoint.appliedJournalSequence).toBe(1);
    expect((await dur.applyAccepted(batch([sessionStart(2)]))).appended.map((r) => r.sequence), 'the rebuilt index takes the next record').toEqual([2]);
  });
});

// ── SQLite as repairable output (R20) ────────────────────────────────────────────────────────────────────────────────

describe('SQLite is repaired from the checkpoint and the journal (ruling R20)', () => {
  const evs = [sessionStart(1), bareTool(2, X), subagentStart(3, X), sessionStart(4), sessionStart(5), sessionStart(6, { sessionId: 'lane-b-demo' })];
  const statsOf = (store: CoordStore) => delegationProjectionPortOfStore(store).eventStats();

  it('a lost coord.db is rebuilt: the checkpoint is projected and every event is replayed from the journal', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch(evs));
    await dur.close();
    const fresh = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-deleg-lost-'), 'coord.db')));
    const again = await harness({ dir: h.dir, store: fresh }).open();
    expect(statsOf(fresh)).toEqual({ count: 6, maxSequence: 6 });
    expect(canonicalDelegationJson(fresh.readDelegationProjection())).toBe(canonicalDelegationJson(projectionViewOfDelegationCheckpoint(again.state().checkpoint)));
  });

  it('a rolled-back coord.db resumes from SQLite\'s MAX(journalSequence), not from the start', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch(evs.slice(0, 3)));
    const rolled = path.join(mkTmp('ccrc-deleg-roll-'), 'coord.db');
    await (async () => { h.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); cpSync(path.join(h.dir, 'coord.db'), rolled); })();
    await dur.applyAccepted(batch(evs.slice(3)));
    await dur.close();
    const rolledStore = new CoordStore(openCoordDb(rolled));
    expect(statsOf(rolledStore)).toEqual({ count: 3, maxSequence: 3 });
    const port = delegationProjectionPortOfStore(rolledStore);
    const inserted: number[] = [];
    const spy: DelegationProjectionPort = { project: (cp) => port.project(cp), eventStats: () => port.eventStats(), insertEvents: (rows) => { inserted.push(rows.length); return port.insertEvents(rows); } };
    const report = await repairDelegationProjection({
      projection: spy, checkpoint: (await harness({ dir: h.dir }).open()).state().checkpoint,
      journal: () => (async function* () { for (const r of parseDelegationJournal(new Uint8Array(readFileSync(path.join(h.dir, DELEGATION_JOURNAL_FILE))))) yield r; })(),
    });
    expect(report).toMatchObject({ resumedAfter: 3, inserted: 3, fullReplay: false, healedSessions: 0, wipedAll: false });
    expect(inserted).toEqual([3]);
    expect(statsOf(rolledStore)).toEqual({ count: 6, maxSequence: 6 });
  });

  it('replays in bounded chunks and yields the event loop between them', async () => {
    const h = harness();
    const dur = await h.open();
    const many = Array.from({ length: 25 }, (_, i) => sessionStart(i + 1));
    await dur.applyAccepted(batch(many));
    const empty = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-deleg-chunk-'), 'coord.db')));
    const port = delegationProjectionPortOfStore(empty);
    const sizes: number[] = [];
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 0);
    await repairDelegationProjection({
      projection: { project: (cp) => port.project(cp), eventStats: () => port.eventStats(), insertEvents: (rows) => { sizes.push(rows.length); return port.insertEvents(rows); } },
      checkpoint: dur.state().checkpoint, chunkSize: 10,
      journal: () => (async function* () { for (const r of parseDelegationJournal(new Uint8Array(readFileSync(path.join(h.dir, DELEGATION_JOURNAL_FILE))))) yield r; })(),
    });
    clearInterval(timer);
    expect(sizes).toEqual([10, 10, 5]);
    expect(ticks).toBeGreaterThan(0);
  });

  it('an event-conflict is SQLite drift: that session\'s events are deleted and replayed, and SQLite never wins', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch(evs));
    h.store.db.prepare("UPDATE delegation_events SET eventKind = 'SessionEnd' WHERE journalSequence = 4").run();
    h.store.db.prepare('DELETE FROM delegation_events WHERE journalSequence = 1').run();       // the count now disagrees: the replay covers sequence 4
    const report = await dur.repairProjection();
    expect(report?.healedSessions).toBe(1);
    const row = h.store.db.prepare('SELECT eventKind FROM delegation_events WHERE journalSequence = 4').get();
    expect(row?.['eventKind']).toBe('SessionStart');
    expect(statsOf(h.store)).toEqual({ count: 6, maxSequence: 6 });
  });

  it('a conflict found WHILE healing is never declared repaired: it falls through to the last resort (fix round 1, M1)', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([sessionStart(1), sessionStart(2), sessionStart(3, { sessionId: 'lane-b-demo' }), sessionStart(4, { sessionId: 'lane-b-demo' })]));
    const db: DatabaseSync = h.store.db;
    // lane-a's event at sequence 1 is missing, and lane-b owns a STRAY row on sequence 2 (lane-a's slot). After the replay the counts
    // agree with the journal's, so only the conflict itself says anything is wrong; healing lane-a deletes lane-a's rows and never
    // lane-b's stray one, so the conflict is found again while healing.
    db.prepare('DELETE FROM delegation_events WHERE journalSequence = 1').run();
    db.prepare("UPDATE delegation_events SET eventId = 'stray', sessionId = 'lane-b-demo' WHERE journalSequence = 2").run();
    const report = await dur.repairProjection();
    expect(report).toMatchObject({ fullReplay: true, wipedAll: true });
    const rows = db.prepare('SELECT journalSequence AS s, eventId AS e, sessionId AS sid FROM delegation_events ORDER BY journalSequence').all();
    expect(rows.map((r) => [r['s'], r['e'], r['sid']])).toEqual([
      [1, eid(1), PARENT], [2, eid(2), PARENT], [3, eid(3), 'lane-b-demo'], [4, eid(4), 'lane-b-demo'],
    ]);
    expect(dur.failure()).toBeNull();
  });

  it('an application that meets a conflicting SQLite row reports the projection stale, and the next one heals it from the journal', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([sessionStart(1)]));
    // A row SQLite holds for the event that is about to be journaled, but with another kind: drift the journal must win over.
    h.store.db.prepare(`INSERT INTO delegation_events (eventId, journalSequence, journalDigest, acceptedAt, sessionId, parentIncarnation, claudeSessionId, eventKind, observedAt, payloadJson)
      VALUES (?, 2, ?, 1, ?, ?, 'c', 'SessionEnd', 1, '{}')`).run(eid(2), '0'.repeat(64), PARENT, INC);
    const out = await dur.applyAccepted(batch([sessionStart(2)]));
    expect(out.durable).toBe(true);                                     // the journal and checkpoint are authoritative and are done
    expect(out.projection.status).toBe('failed');
    const next = await dur.applyAccepted(batch([sessionStart(3)]));
    expect(next.projection.status).toBe('projected');                   // the stale projection was repaired first
    const row = h.store.db.prepare('SELECT eventKind FROM delegation_events WHERE eventId = ?').get(eid(2));
    expect(row?.['eventKind']).toBe('SessionStart');
    expect(statsOf(h.store)).toEqual({ count: 3, maxSequence: 3 });
  });

  it('stray rows the journal does not hold are cleared (the last resort), and the events end up exactly the journal\'s', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch(evs.slice(0, 3)));
    h.store.db.prepare(`INSERT INTO delegation_events (eventId, journalSequence, journalDigest, acceptedAt, sessionId, parentIncarnation, claudeSessionId, eventKind, observedAt, payloadJson)
      VALUES ('stray', 2000, ?, 1, ?, ?, 'c', 'SessionStart', 1, '{}')`).run('0'.repeat(64), PARENT, INC);
    const report = await dur.repairProjection();
    expect(report?.wipedAll).toBe(true);
    expect(statsOf(h.store)).toEqual({ count: 3, maxSequence: 3 });
  });

  it('a projection over a large events table touches no staying session\'s event row', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch(Array.from({ length: 40 }, (_, i) => sessionStart(i + 1))));
    const before = h.store.db.prepare('SELECT id, eventId FROM delegation_events ORDER BY id').all().map((r) => [r['id'], r['eventId']]);
    await dur.applyAccepted(batch([sessionStart(41)]));
    const after = h.store.db.prepare('SELECT id, eventId FROM delegation_events ORDER BY id').all().map((r) => [r['id'], r['eventId']]);
    expect(after.slice(0, 40)).toEqual(before);
    expect(after).toHaveLength(41);
  });
});

// ── fix round 1, M3: the repair's passes over the journal ────────────────────────────────────────────────────────────

describe('the repair reads the journal as few times as it can (fix round 1, M3)', () => {
  const records = evidenceChain([1, 2, 3, 4, 5, 6].map((n) => sessionStart(n)));
  const checkpoint = recoverDelegation(null, records).state.checkpoint;
  /** Recovery's count of the evidence records, built inside the test that uses it. */
  const countsOf = (): DelegationEvidenceIndex => {
    const evidence = new DelegationEvidenceIndex();
    for (const r of records) if (r.entry.kind === 'evidence-accepted') evidence.add(r.sequence);
    return evidence;
  };

  /** A projection port over a set of sequences SQLite "has"; counts what the repair does to it. */
  function fakeProjection(have: readonly number[]) {
    const held = new Set(have);
    const calls = { project: 0, inserts: [] as number[] };
    const port: DelegationProjectionPort = {
      project: () => { calls.project++; },
      insertEvents: (rows) => {
        calls.inserts.push(rows.length);
        let inserted = 0;
        for (const r of rows) if (!held.has(r.journalSequence)) { held.add(r.journalSequence); inserted++; }
        return { inserted, duplicate: rows.length - inserted, conflicts: [] };
      },
      eventStats: () => ({ count: held.size, maxSequence: held.size === 0 ? null : Math.max(...held) }),
    };
    return { port, calls };
  }
  function journalOf() {
    const seen = { passes: 0 };
    return { seen, journal: () => { seen.passes++; return (async function* () { for (const r of records) yield r; })(); } };
  }

  it('skips the whole-journal pass when SQLite\'s (count, max) matches what recovery counted', async () => {
    const { port, calls } = fakeProjection([1, 2, 3, 4, 5, 6]);
    const j = journalOf();
    const report = await repairDelegationProjection({ projection: port, checkpoint, journal: j.journal, evidence: countsOf() });
    expect(j.seen.passes).toBe(0);
    expect(report).toMatchObject({ journalPasses: 0, inserted: 0, fullReplay: false, wipedAll: false, healedSessions: 0 });
    expect(calls.inserts).toEqual([]);
  });

  it('reads once, from the resume point, when SQLite is merely behind', async () => {
    const { port } = fakeProjection([1, 2, 3]);
    const j = journalOf();
    const report = await repairDelegationProjection({ projection: port, checkpoint, journal: j.journal, evidence: countsOf() });
    expect(j.seen.passes).toBe(1);
    expect(report).toMatchObject({ journalPasses: 1, inserted: 3, fullReplay: false, resumedAfter: 3 });
  });

  it('reads ONCE, in full, when the counts disagree below the resume point (no counting pass first)', async () => {
    const { port } = fakeProjection([1, 2, 3, 5]);                      // count 4 but the journal has 5 evidence records up to sequence 5
    const j = journalOf();
    const report = await repairDelegationProjection({ projection: port, checkpoint, journal: j.journal, evidence: countsOf() });
    expect(j.seen.passes).toBe(1);
    expect(report).toMatchObject({ journalPasses: 1, fullReplay: true, inserted: 2, wipedAll: false });
  });

  it('without recovery\'s counts it still counts as it reads: two passes when the counts disagree (the old behaviour, kept as the fallback)', async () => {
    const { port } = fakeProjection([1, 2, 3, 5]);
    const j = journalOf();
    const report = await repairDelegationProjection({ projection: port, checkpoint, journal: j.journal });
    expect(j.seen.passes).toBe(2);
    expect(report).toMatchObject({ journalPasses: 2, fullReplay: true });
  });

  it('heals every drifted session in ONE journal pass, deleting them one session at a time with the loop yielded between', async () => {
    // Three sessions, so "without one session" is visible in what the projection is handed.
    const three = evidenceChain([sessionStart(1, { sessionId: 's1' }), sessionStart(2, { sessionId: 's2' }), sessionStart(3, { sessionId: 's3' })]);
    const threeCp = recoverDelegation(null, three).state.checkpoint;
    const threeCounts = (): DelegationEvidenceIndex => { const e = new DelegationEvidenceIndex(); for (const r of three) e.add(r.sequence); return e; };
    const threeJournal = () => { const seen = { passes: 0 }; return { seen, journal: () => { seen.passes++; return (async function* () { for (const r of three) yield r; })(); } }; };
    const keys = [{ sessionId: 's1', incarnation: 'g1' }, { sessionId: 's2', incarnation: 'g1' }, { sessionId: 's3', incarnation: 'g1' }];
    const sessionsSeen = (held: number[]) => {
      const seenSessions: number[] = [];
      const f = fakeProjection(held);
      return { seenSessions, port: { ...f.port, project: (cp: DelegationCheckpointV1) => { seenSessions.push(cp.sessions.length); f.port.project(cp); } } satisfies DelegationProjectionPort };
    };

    const withCounts = sessionsSeen([1, 2, 3]);
    const j1 = threeJournal();
    const a = await repairDelegationProjection({ projection: withCounts.port, checkpoint: threeCp, journal: j1.journal, evidence: threeCounts(), heal: keys });
    expect(j1.seen.passes).toBe(1);                                      // the main pass was skipped; the heal is the only pass
    expect(a).toMatchObject({ healedSessions: 3, journalPasses: 1, wipedAll: false });
    // the checkpoint, then (without one session, the whole checkpoint) three times: never two sessions gone at once
    expect(withCounts.seenSessions).toEqual([3, 2, 3, 2, 3, 2, 3]);

    const without = sessionsSeen([1, 2, 3]);
    const j2 = threeJournal();
    const b = await repairDelegationProjection({ projection: without.port, checkpoint: threeCp, journal: j2.journal, heal: keys });
    expect(j2.seen.passes).toBe(2);                                      // one counting pass, one heal pass: never one pass per session
    expect(b).toMatchObject({ healedSessions: 3, journalPasses: 2 });
    expect(without.seenSessions).toEqual([3, 2, 3, 2, 3, 2, 3]);
  });

  it('recovery hands over its per-sequence evidence count, leases excluded, and the applier keeps it current', async () => {
    const base = evidenceChain([sessionStart(1), subagentStart(2, X), sessionStart(3)]);
    const act = activityOf(recoverDelegation(null, base).state.checkpoint, X)!;
    const mixed = [...base, ...chainOf([leaseEntryFor(act.activityId)], 4, base[2]!.digest)];
    const more = [...mixed, ...evidenceChain([sessionStart(5), sessionStart(6)], 5, mixed[3]!.digest)];
    const facts = recoverDelegation(null, more).facts!;
    expect(facts.evidence.total).toBe(5);                                // 1,2,3,5,6: the lease at 4 is not evidence
    expect([0, 1, 2, 3, 4, 5, 6, 7, 100].map((n) => facts.evidence.countAtOrBelow(n))).toEqual([0, 1, 2, 3, 3, 4, 5, 5, 5]);
    // The applier's live copy of the counts is kept current by every application (a lease is not evidence): with SQLite in sync, its
    // own repair finds nothing to read.
    const h = harness();
    const dur = await h.open();
    const built = await dur.applyAccepted(batch([sessionStart(1), subagentStart(2, X)]));
    await dur.createLease({ activityId: built.openedActivities[0]!.activityId, parentId: PARENT, parentIncarnation: INC, project: 'p', adminRecord: 'wt', canonicalPath: '/w/1', creationBase: null, sourceKind: 'agent', correlationJournalIds: [], firstObservedAt: T(9) });
    await dur.applyAccepted(batch([sessionStart(5)]));
    expect(await dur.repairProjection()).toMatchObject({ journalPasses: 0, inserted: 0, fullReplay: false, wipedAll: false });
  });

  it('open() against an SQLite that is in sync reads the journal ONCE (recovery\'s own pass), not twice', async () => {
    const h = harness();
    const first = await h.open();
    await first.applyAccepted(batch([sessionStart(1), bareTool(2, X), subagentStart(3, X), sessionStart(4)]));
    await first.close();
    let journalReads = 0;
    const inner = spyPort(h.log);
    const counting: DelegationFilePort = { ...inner, openRead: async (p) => { if (p.endsWith(DELEGATION_JOURNAL_FILE)) journalReads++; return inner.openRead(p); } };
    const again = await h.open({ port: counting });
    expect(again.failure()).toBeNull();
    expect(journalReads).toBe(1);
    // A lost SQLite is still rebuilt (the pass is skipped only when nothing needs inserting).
    const lost = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-deleg-lost2-'), 'coord.db')));
    journalReads = 0;
    const rebuilt = await harness({ dir: h.dir, store: lost }).open({ port: counting });
    expect(rebuilt.failure()).toBeNull();
    expect(journalReads).toBe(2);
    expect(delegationProjectionPortOfStore(lost).eventStats()).toEqual({ count: 4, maxSequence: 4 });
  });
});

// ── fix round 1, M5 / M6: two small guards ───────────────────────────────────────────────────────────────────────────

describe('the recovery save and the lease adapter fail loudly (fix round 1, M5 and M6)', () => {
  it('M5: a throw BEFORE step 1 of the recovery save marks the applier failed; it is never reported ready', async () => {
    const h = harness();
    // Leave the journal ahead of the checkpoint: a crash before the rename of the second batch.
    let armed = false;
    const crashing = await h.open({ onEdge: (e, w) => { if (armed && e === 'checkpoint-rename' && w === 'before') throw new SimulatedCrash('rename'); } });
    await crashing.applyAccepted(batch([sessionStart(1)]));
    armed = true;
    await expect(crashing.applyAccepted(batch([sessionStart(2)]))).rejects.toThrow(SimulatedCrash);
    const before = readDisk(h.dir);
    // Recovery replays record 2 and must save it. The save's own build throws before anything is written (the first build is
    // recovery's final validation; the second is the save's).
    const realBuild = DelegationCheckpointBuilder.prototype.build;
    let builds = 0;
    const spy = vi.spyOn(DelegationCheckpointBuilder.prototype, 'build').mockImplementation(function (this: DelegationCheckpointBuilder, revision: number) {
      builds++;
      if (builds === 2) throw new Error('injected: a throw before step 1');
      return realBuild.call(this, revision);
    });
    let dur: DelegationDurability;
    try { dur = await harness({ dir: h.dir }).open(); } finally { spy.mockRestore(); }
    expect(builds).toBe(2);
    expect(dur.failure()).toMatchObject({ phase: 'durable-application', detail: expect.stringContaining('injected') });
    expect(dur.state().phase).toBe('reconstructing');
    expect(dur.pruningEnabled()).toBe(false);
    await expect(dur.applyAccepted(batch([sessionStart(3)]))).rejects.toMatchObject({ code: 'not-ready' });
    expect(readDisk(h.dir)).toEqual(before);                             // nothing was written
    // A later recovery, without the injected throw, is ready and saves.
    const report = await dur.recover();
    expect(report.failure).toBeNull();
    expect(dur.pruningEnabled()).toBe(true);
    expect(dur.state().checkpoint.appliedJournalSequence).toBe(2);
  });

  it('M6: if the planner skips the lease entry it was handed, createLease throws; it does not answer "duplicate" with a UUID that names no lease', async () => {
    const h = harness();
    const dur = await h.open();
    const built = await dur.applyAccepted(batch([sessionStart(1), subagentStart(2, X)]));
    const request: DelegationLeaseCreationRequest = {
      activityId: built.openedActivities[0]!.activityId, parentId: PARENT, parentIncarnation: INC, project: 'project-a', adminRecord: 'wt-1',
      canonicalPath: '/work/project-a/wt-1', creationBase: null, sourceKind: 'agent', correlationJournalIds: [], firstObservedAt: T(40),
    };
    planControl.skipEverything = true;
    try {
      await expect(dur.createLease(request)).rejects.toThrow(/skipped the lease-created entry/);
    } finally {
      planControl.skipEverything = false;
    }
    expect(dur.failure()).toBeNull();                                    // nothing was written, so nothing is poisoned
    expect(dur.state().checkpoint.leases).toEqual([]);
    expect((await dur.createLease(request)).kind).toBe('created');
  });
});

// ── retention planning, and no compaction (W3-M38) ───────────────────────────────────────────────────────────────────

describe('no-compaction / hold table (W3-M38): holds are computed and tested, and nothing rewrites the journal', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const lease = (act: DelegationActivityRow): DelegationJournalEntryV1 => leaseEntryFor(act.activityId, { firstObservedAt: T(40), correlationJournalIds: [] });

  it('holds the checkpoint anchor', () => {
    const { cp, records } = ready([sessionStart(1), sessionStart(2), sessionStart(3)]);
    expect(cp.pruningHolds).toEqual([{ journalId: records[2]!.journalId, reason: 'checkpoint-anchor', ownerId: 'checkpoint' }]);
    expect(planDelegationPruning({ state: { checkpoint: cp, phase: 'ready' }, view: delegationRetentionViewOf(records, new Set([records[2]!.journalId]), NO_FLOOR) }).prunableThroughSequence).toBe(2);
  });

  it('holds an open lease\'s creating record and an open lineage edge\'s, and an identity candidate\'s, each for its own reason', () => {
    const base2 = evidenceChain([sessionStart(1), subagentStart(2, X)]);
    const act = activityOf(recoverDelegation(null, base2).state.checkpoint, X)!;
    const bare = evidenceChain([bareTool(3, Y)], 3, base2[1]!.digest);
    const leaseRec = chainOf([lease(act)], 4, bare[0]!.digest);
    const all = [...base2, ...bare, ...leaseRec];
    const cp = recoverDelegation(null, all).state.checkpoint;
    const reasons = (r: string): string[] => cp.pruningHolds.filter((h) => h.reason === r).map((h) => h.journalId);
    expect(reasons('checkpoint-anchor')).toEqual([all[3]!.journalId]);
    expect(reasons('open-lease')).toEqual([all[3]!.journalId]);
    expect(reasons('open-lineage')).toEqual([all[3]!.journalId]);
    expect(reasons('identity-candidate')).toEqual([all[2]!.journalId]);
    const plan = planDelegationPruning({ state: { checkpoint: cp, phase: 'ready' }, view: delegationRetentionViewOf(all, new Set(cp.pruningHolds.map((h) => h.journalId)), NO_FLOOR) });
    expect(plan.prunableThroughSequence).toBe(2);                         // the candidate at 3 is the first held record
  });

  it('open-lease and open-lineage each hold a lease\'s evidence on their own: dropping either leaves the plan unchanged, dropping both frees it', () => {
    const base2 = evidenceChain([sessionStart(1), subagentStart(2, X)]);
    const act = activityOf(recoverDelegation(null, base2).state.checkpoint, X)!;
    const evidenceId = base2[0]!.journalId;
    const leaseRec = chainOf([leaseEntryFor(act.activityId, { firstObservedAt: T(40), correlationJournalIds: [evidenceId] })], 3, base2[1]!.digest);
    const all = [...base2, ...leaseRec, ...evidenceChain([sessionStart(4), sessionStart(5), sessionStart(6)], 4, leaseRec[0]!.digest)];
    const cp = recoverDelegation(null, all).state.checkpoint;
    const plan = (holds: typeof cp.pruningHolds) => planDelegationPruning({
      state: { checkpoint: { ...cp, pruningHolds: holds }, phase: 'ready' }, view: delegationRetentionViewOf(all, new Set(cp.pruningHolds.map((h) => h.journalId)), NO_FLOOR),
    }).prunableThroughSequence;
    expect(plan(cp.pruningHolds)).toBe(0);                                // sequence 1 is held by the lease's evidence
    for (const reason of ['open-lease', 'open-lineage'] as const) {
      const without = cp.pruningHolds.filter((h) => h.reason !== reason);
      expect(plan(without), `without ${reason}`).toBe(0);                  // the other reason still holds it: a record can have two reasons
    }
    expect(plan(cp.pruningHolds.filter((h) => h.reason === 'checkpoint-anchor'))).toBe(5);
    expect(plan(cp.pruningHolds.filter((h) => h.reason !== 'open-lease' && h.reason !== 'open-lineage'))).toBe(5);
  });

  it('the retention floor holds back records accepted inside it', () => {
    const { cp, records } = ready([sessionStart(1), sessionStart(2), sessionStart(3), sessionStart(4)]);
    const accepted = (i: number) => Date.parse(records[i]!.acceptedAt);
    const cutoff = accepted(1) + 1;                                       // records 3 and 4 were accepted inside the floor
    const plan = planDelegationPruning({ state: { checkpoint: cp, phase: 'ready' }, view: delegationRetentionViewOf(records, new Set(cp.pruningHolds.map((h) => h.journalId)), cutoff) });
    expect(plan.prunableThroughSequence).toBe(2);
    expect(DAY).toBeGreaterThan(0);
  });

  it('disables pruning during reconstruction, after a failed one, and while the applier is poisoned', async () => {
    const records = evidenceChain([sessionStart(1), sessionStart(2)]);
    const reconstructing = { checkpoint: emptyDelegationCheckpoint(), phase: 'reconstructing' as const };
    expect(planDelegationPruning({ state: reconstructing, view: delegationRetentionViewOf(records, new Set(), NO_FLOOR) })).toMatchObject({ enabled: false, prunableThroughSequence: 0 });
    const h = harness();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const port = spyPort(h.log);
    const slow: DelegationFilePort = { ...port, readFile: async (p) => { await gate; return port.readFile(p); } };
    const opening = DelegationDurability.open(h.deps({ port: slow })).then(track);
    await new Promise((r) => setTimeout(r, 20));
    release();
    const dur = await opening;
    expect(dur.pruningEnabled()).toBe(true);
    const crashing = await h.open({ onEdge: (e, w) => { if (e === 'journal-fsync' && w === 'before') throw new SimulatedCrash('x'); } });
    await expect(crashing.applyAccepted(batch([sessionStart(1)]))).rejects.toThrow(SimulatedCrash);
    expect(crashing.pruningEnabled()).toBe(false);
    expect((await crashing.planPruning(Date.now(), 0)).enabled).toBe(false);
  });

  it('pruning is off from the moment recovery starts until it succeeds (observed from inside an in-flight recovery)', async () => {
    const h = harness();
    const first = await h.open();
    await first.applyAccepted(batch([sessionStart(1)]));
    await first.close();
    const seen: string[] = [];
    let durRef: DelegationDurability | null = null;
    let recording = false;
    const port = spyPort(h.log);
    const probe = (what: string): void => { if (recording && durRef !== null) seen.push(`${what}:${durRef.pruningEnabled()}`); };
    const probing: DelegationFilePort = {
      ...port,
      readFile: async (p) => { probe('checkpoint-read'); return port.readFile(p); },
      openRead: async (p) => { probe('journal-read'); return port.openRead(p); },
    };
    const dur = track(await DelegationDurability.open(h.deps({ port: probing })));
    durRef = dur;
    expect(dur.pruningEnabled()).toBe(true);
    recording = true;
    const recovering = dur.recover();
    await recovering;
    recording = false;
    // The first three reads are recovery's own (the restore marker, whose read is a `readFile` too (8B), then the checkpoint, then the
    // journal): pruning was off for all of them.
    expect(seen.slice(0, 3)).toEqual(['checkpoint-read:false', 'checkpoint-read:false', 'journal-read:false']);
    expect(dur.pruningEnabled()).toBe(true);
  });

  describe('no production call path opens a rewrite, truncate, rename or delete target for delegation-events.log', () => {
    const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const stripComments = (src: string): string => src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    const code = (file: string): string => stripComments(readFileSync(path.join(srcDir, 'coord', file), 'utf8'));

    // THE ONE NAMED EXCEPTION (D-4655, the operator's ruling of 2026-10-15): the server's tail heal. It is the ONLY production path that
    // cuts the journal, it cuts only to the end of the last complete validated record, and only after the cut bytes are durable in
    // `delegation-events.torn/`. The two rows below pin its exact shape, so a second truncate, a truncate to any other offset, a truncate
    // outside the heal, or a rename of anything but the two temp files each turn them red.
    it('the journal module has no method that could rewrite it: its ONLY truncate is the port member the tail heal calls, and the writer has none', () => {
      const j = code('delegation-journal.ts');
      expect(j).not.toMatch(/ftruncate|\bunlink\(|\brm\(|\.writeFile\(|\bcreateWriteStream\(|O_TRUNC\b.*journal/i);
      expect(j.match(/\btruncate\b/g), 'the port member, its node adapter and the adapter\'s fsp call: three words, no more').toHaveLength(3);
      expect(j).toMatch(/^  truncate\(path: string, length: number\): Promise<void>;$/m);
      expect(j).toMatch(/^  truncate: \(p, length\) => fsp\.truncate\(p, length\),$/m);
      expect(j.slice(j.indexOf('export class DelegationJournalWriter')), 'the writer cannot cut').not.toMatch(/truncate/);
      expect(j.match(/O_TRUNC/g)?.length ?? 0).toBe(1);                      // only createTemp (the checkpoint's and the quarantine copy's temp file) truncates
      expect(j).toMatch(/createTemp:[^\n]*O_TRUNC/);
      expect(j.match(/O_APPEND/g)?.length).toBe(1);
    });
    it('the checkpoint module cuts the journal in ONE place (the heal, at the plan\'s offset), renames only its two temp files, and opens the journal only for append or read', () => {
      const c = code('delegation-checkpoint.ts');
      expect(c.match(/\.rename\(/g), 'the checkpoint temp file and the quarantine temp file').toEqual(['.rename(', '.rename(']);
      expect(c).toMatch(/this\.port\.rename\(this\.tempPath, this\.checkpointPath\)/);
      expect(c).toMatch(/this\.port\.rename\(temp, kept\)/);
      expect(c).toMatch(/const temp = `\$\{kept\}\.tmp`;/);
      expect(c).toMatch(/const kept = path\.join\(this\.deps\.dir, DELEGATION_TORN_DIR, plan\.name\);/);
      expect(c).not.toMatch(/unlink|\.writeFile\(|rmSync/);
      expect(c.match(/truncate/g), 'exactly one truncate in the module').toEqual(['truncate']);
      expect(c).toMatch(/await this\.port\.truncate\(this\.journalPath, plan\.offset\);/);
      const heal = c.slice(c.indexOf('private async healTailLocked'), c.indexOf('private async remeasureTail'));
      expect(heal, 'the cut is inside the heal').toMatch(/await this\.port\.truncate\(this\.journalPath, plan\.offset\);/);
      expect(c.match(/healTailLocked\(/g), 'the heal is declared once and called once').toHaveLength(2);
      expect(c).toMatch(/if \(report\.tailHeal !== null\) \{\s*try \{\s*await this\.healTailLocked\(report\.tailHeal\);/);
      // the cut comes after the copy is durable: the copy's fsyncs precede the truncate in the heal's text
      expect(heal.indexOf('await handle.sync();')).toBeGreaterThan(-1);
      expect(heal.indexOf('await handle.sync();')).toBeLessThan(heal.indexOf('this.port.truncate('));
      expect(heal.indexOf('this.port.rename(temp, kept)')).toBeLessThan(heal.indexOf('await this.port.fsyncDir(path.dirname(kept))'));
      expect(heal.indexOf('await this.port.fsyncDir(path.dirname(kept))')).toBeLessThan(heal.indexOf('this.port.truncate('));
      expect(heal.indexOf('this.port.truncate(')).toBeLessThan(heal.indexOf('this.port.fsyncFile(this.journalPath)'));
      expect(c).not.toMatch(/createTemp\([^)]*journalPath/);
    });
    it('a full run of every application kind renames exactly one file name, never the journal', async () => {
      const h = harness();
      const dur = await h.open();
      await dur.applyAccepted(batch([sessionStart(1), subagentStart(2, X)]));
      const act = dur.state().checkpoint.activities[0]!;
      await dur.createLease({ activityId: act.activityId, parentId: PARENT, parentIncarnation: INC, project: 'p', adminRecord: 'wt', canonicalPath: '/w/1', creationBase: null, sourceKind: 'agent', correlationJournalIds: [], firstObservedAt: T(9) });
      await dur.applyCheckpointChange((cp) => cp);
      await dur.recover();
      await dur.repairProjection();
      expect([...new Set(h.log.filter((l) => l.startsWith('rename')))]).toEqual(['rename:delegation-checkpoint.json.tmp->delegation-checkpoint.json']);
      const journal = readFileSync(path.join(h.dir, DELEGATION_JOURNAL_FILE));
      expect(parseDelegationJournal(new Uint8Array(journal), { completeFromStart: true }).map((r) => r.sequence)).toEqual([1, 2, 3]);
    });
    it('no other production source names the journal file at all', () => {
      const hits: string[] = [];
      const walk = (dir: string): void => {
        for (const f of readdirSync(dir)) {
          const p = path.join(dir, f);
          if (statSync(p).isDirectory()) walk(p);
          else if (/\.(ts|mjs|js)$/.test(f) && /delegation-events\.log|DELEGATION_JOURNAL_FILE/.test(stripComments(readFileSync(p, 'utf8')))) hits.push(path.relative(srcDir, p));
        }
      };
      walk(srcDir);
      expect(hits.sort()).toEqual(['coord/delegation-checkpoint.ts', 'coord/delegation-journal.ts']);
    });
  });
});

// ── the pure/impure split ────────────────────────────────────────────────────────────────────────────────────────────

describe('the pure/impure split is explicit, and nothing pure mints an ID or reads a clock', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord');
  const strip = (s: string): string => s.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  const BANNER = /^\/\/ IMPURE SHELL:/m;

  for (const file of ['delegation-journal.ts', 'delegation-checkpoint.ts']) {
    it(`${file}: above the IMPURE SHELL banner the code names no filesystem, no SQLite and no store`, () => {
      const src = readFileSync(path.join(dir, file), 'utf8');
      const at = src.search(BANNER);
      expect(at).toBeGreaterThan(0);
      const pure = strip(src.slice(0, at));
      expect(pure).not.toMatch(/node:fs|fsp\.|fsConstants|node:sqlite|\.\/db\.js|\.\/store\.js|CoordStore|process\.|readFileSync|writeFileSync|openSync/);
      const imports = [...pure.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gms)].map((m) => m[1]);
      expect(imports.sort()).toEqual(file === 'delegation-journal.ts'
        ? ['../../../shared/api.js', './delegation-model.js']
        : ['../../../shared/api.js', './delegation-journal.js', './delegation-model.js', 'node:path']);
    });
    it(`${file}: no randomness and no clock anywhere in the module (they are injected)`, () => {
      const src = strip(readFileSync(path.join(dir, file), 'utf8'));
      expect(src).not.toMatch(/(?<!deps\.)\brandomUUID\(|\brandomBytes\b|Math\.random|Date\.now|new Date\(|performance\.now|node:crypto/);
      // R76 M2: Web Crypto's randomness too (the heal names its quarantine file from a digest, and a digest is the ONLY Web Crypto use)
      expect(src).not.toMatch(/getRandomValues|crypto\.randomUUID|webcrypto/);
      expect(src.match(/globalThis\.crypto\b[^\n]*/g) ?? [], 'every Web Crypto use').toEqual(file === 'delegation-journal.ts'
        ? ["globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));"] : []);
      expect(src.match(/\bcrypto\./g)?.length ?? 0, 'no other crypto handle').toBe(file === 'delegation-journal.ts' ? 1 : 0);
    });
  }
  it('the lease adapter calls the INJECTED randomUUID in one place only, after the identity and path checks', () => {
    const src = strip(readFileSync(path.join(dir, 'delegation-checkpoint.ts'), 'utf8'));
    expect(src.match(/this\.deps\.randomUUID\(\)/g)).toHaveLength(1);
    const at = src.indexOf('this.deps.randomUUID()');
    expect(src.lastIndexOf('byIdentity(identity)', at)).toBeGreaterThan(0);
    expect(src.lastIndexOf('byPath(request.canonicalPath)', at)).toBeGreaterThan(src.lastIndexOf('byIdentity(identity)', at));
  });
  it('only the model is imported for canonical JSON: neither module defines a second canonical writer', () => {
    for (const file of ['delegation-journal.ts', 'delegation-checkpoint.ts']) {
      const src = strip(readFileSync(path.join(dir, file), 'utf8'));
      expect(src).not.toMatch(/JSON\.stringify\([^)]*\)\s*\+\s*'\\n'|function canonical|const canonical[A-Z]\w* =/);
    }
  });
});

// ── a sanity row for the harness itself ──────────────────────────────────────────────────────────────────────────────

describe('growth (the numbers the report quotes)', () => {
  it('a record and a checkpoint row are measured, so the growth estimate rests on bytes and not on a guess', () => {
    const records = evidenceChain([sessionStart(1), bareTool(2, X), subagentStart(3, X)]);
    const sizes = records.map((r) => encodeDelegationJournalRecord(r).length);
    // A minimal envelope is a few hundred bytes; Task 9's real envelopes (cwd, transcript paths, listings) add to it.
    expect(sizes.every((n) => n > 300 && n < 1200)).toBe(true);
  });
});

// ── 8B: startup refuses an active coordination restore marker (brief Step 7; `deploy/coordination-snapshot.mjs` publishes it) ──

describe('8B: an active restore marker refuses recovery, and only the marker\'s removal lets it proceed', () => {
  const markerPath = (dir: string): string => path.join(dir, COORDINATION_RESTORE_MARKER_FILE);
  const tree = (dir: string): string[] => readdirSync(dir).sort();

  it('the marker is a closed failure: reconstructing, pruning off, the closed code, and every apply refused', async () => {
    const h = harness();
    writeFileSync(markerPath(h.dir), '{"format":"ccrc-coordination-restore","state":"replacing","version":1}\n');
    const dur = await h.open();
    expect(dur.failure()).toMatchObject({ phase: 'checkpoint-decode', code: DELEGATION_RESTORE_IN_PROGRESS });
    expect(DELEGATION_RESTORE_IN_PROGRESS).toBe('restore-in-progress');
    expect(dur.state().phase).toBe('reconstructing');
    expect(dur.pruningEnabled()).toBe(false);
    await expect(dur.applyAccepted(batch([sessionStart(1)]))).rejects.toMatchObject({ code: 'not-ready' });
    expect(readDisk(h.dir)).toEqual({ journal: null, checkpoint: null });
  });

  it('it comes BEFORE any other reading: a healthy journal and checkpoint beside the marker are neither read nor changed, and recovery reports the marker, not them', async () => {
    const h = harness();
    const first = await h.open();
    await first.applyAccepted(batch([sessionStart(1), bareTool(2, X)]));
    await first.close();
    const before = readDisk(h.dir);
    expect(before.journal).not.toBeNull();
    writeFileSync(markerPath(h.dir), 'a marker of any shape: its presence is the fact\n');
    // Corrupt the checkpoint too: a recovery that read it first would name THAT failure.
    writeFileSync(path.join(h.dir, DELEGATION_CHECKPOINT_FILE), 'not a checkpoint\n');
    const dur = await h.open();
    expect(dur.failure()).toMatchObject({ code: DELEGATION_RESTORE_IN_PROGRESS });
    expect(dur.pruningEnabled()).toBe(false);
    expect(readFileSync(path.join(h.dir, DELEGATION_JOURNAL_FILE))).toEqual(before.journal);
    expect(readFileSync(path.join(h.dir, DELEGATION_CHECKPOINT_FILE), 'utf8')).toBe('not a checkpoint\n');
    const report = await recoverDelegationFromFiles(nodeDelegationFilePort, h.dir);
    expect(report).toMatchObject({ failure: { code: DELEGATION_RESTORE_IN_PROGRESS }, pruning: 'disabled', state: { phase: 'reconstructing' }, facts: null });
  });

  it('it never deletes the marker: recover() on the same applier still refuses, and a fixture that removes the marker then recovers ready', async () => {
    const h = harness();
    const first = await h.open();
    await first.applyAccepted(batch([sessionStart(1)]));
    await first.close();
    writeFileSync(markerPath(h.dir), 'x\n');
    const dur = await h.open();
    const filesBefore = tree(h.dir);
    expect((await dur.recover()).failure).toMatchObject({ code: DELEGATION_RESTORE_IN_PROGRESS });
    expect(existsSync(markerPath(h.dir))).toBe(true);
    expect(tree(h.dir)).toEqual(filesBefore);
    rmSync(markerPath(h.dir));
    const report = await dur.recover();
    expect(report.failure).toBeNull();
    expect(dur.state().phase).toBe('ready');
    expect(dur.pruningEnabled()).toBe(true);
    await expect(dur.applyAccepted(batch([sessionStart(2)]))).resolves.toBeDefined();
  });

  it('the failure appears in the server log line the applier warns with', async () => {
    const h = harness();
    writeFileSync(markerPath(h.dir), 'x\n');
    const warned: string[] = [];
    await h.open({ warn: (m) => warned.push(m) });
    expect(warned).toEqual(['ccrc-server: delegation recovery failed at checkpoint-decode: restore-in-progress']);
  });
});

// ── Task 9 fix round 2 (R36): the applier never clears a cursor row's `replaced` flag ──

describe('Task 9 R36: a stale result can never write replaced:false over a durable replaced:true', () => {
  const replacedRow = (cursor: number) => ({ ...cursorFor('2026101412', cursor), intervalState: 'unmeasured' as const, detail: 'bucket-replaced: size 3 is below the cursor 40', replaced: true });

  it('a replaced row, then a stale result for the same bucket with replaced:false: the durable row is still replaced', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([sessionStart(1)], { cursor: replacedRow(40) }));
    expect(dur.state().checkpoint.bucketCursors[0]).toMatchObject({ replaced: true });
    const stale = { ...cursorFor('2026101412', 10), replaced: false };       // computed from a state older than the replacement
    await dur.applyAccepted(batch([sessionStart(2)], { cursor: stale }));
    const row = dur.state().checkpoint.bucketCursors.find((r) => r.bucket === '2026101412');
    expect(row).toMatchObject({ replaced: true, cursor: 10 });                // only the flag is monotonic here; where the cursor goes is Task 13's (M6)
    await dur.close();
    const reopened = await h.open();
    expect(reopened.state().checkpoint.bucketCursors.find((r) => r.bucket === '2026101412')).toMatchObject({ replaced: true });
  });

  it('the OR keeps the durable replaced words and the unmeasured state: a stale torn-tail row, a reader gap, then a clean tick still answer bucket-replaced', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([sessionStart(1)], { cursor: replacedRow(40) }));
    const stale = { ...cursorFor('2026101412', 10), replaced: false, intervalState: 'measured' as const, detail: 'torn-tail: 3 unframed bytes after offset 10' };
    await dur.applyAccepted(batch([sessionStart(2)], { cursor: stale }));
    const row = dur.state().checkpoint.bucketCursors.find((r) => r.bucket === '2026101412')!;
    expect(row).toMatchObject({ replaced: true, intervalState: 'unmeasured' });
    expect(row.detail).toMatch(/^bucket-replaced/);
    const id = { sessionId: row.sessionId, parentIncarnation: row.parentIncarnation, bucket: row.bucket };
    const reader = unreadableDelegationBucketResult(id, dur.state(), { reason: 'capability-unmeasured', detail: 'x' });
    expect(reader.cursor.detail).toMatch(/^bucket-replaced/);
    await dur.applyAccepted({ accepted: [], cursor: reader.cursor, interval: null });
    expect(dur.state().checkpoint.bucketCursors.find((r) => r.bucket === '2026101412')!.detail).toMatch(/^bucket-replaced/);
    await dur.close();
  });

  it('another bucket is unaffected, and a row that was never replaced stays false', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([sessionStart(1)], { cursor: replacedRow(40) }));
    await dur.applyAccepted(batch([sessionStart(2)], { cursor: cursorFor('2026101413', 5) }));
    const rows = new Map(dur.state().checkpoint.bucketCursors.map((r) => [r.bucket, r.replaced] as const));
    expect(rows.get('2026101412')).toBe(true);
    expect(rows.get('2026101413')).toBe(false);
  });
});

// ── Task 13, hand-off 6 (D-4648): a Workflow WORKER's positive meta is durable only after the checkpoint replacement (O1, W3-M12) ──

describe('Task 13: applyPositiveWorkflowMeta opens a workflow worker exactly as applyPositiveAgentMeta opens an agent (O1)', () => {
  const RUN = 'wf_run1';
  const workflowLaunch = (n: number, runId = RUN): DelegationEventEnvelopeV1 => ({
    ...base(n), eventKind: 'PostToolUse', toolName: 'Workflow', toolUseId: `toolu_wf${n}`, outcome: 'async-launched',
    launch: { status: 'async-launched', taskId: `task_${n}`, taskType: 'local_workflow', workflowName: 'review-pass', runId, transcriptDir: `/work/t/${runId}`, scriptPath: '/work/s.js' },
  });
  const workerKey = (index: number) => ({ parentId: PARENT, parentIncarnation: INC, sourceKind: 'workflow' as const, upstreamId: `${RUN}-${index}` });
  const meta = (index: number, over: { parentId?: string } = {}) => ({ parentId: over.parentId ?? PARENT, parentIncarnation: INC, runId: RUN, workerIndex: index });
  let launchJournalId = '';

  /** The run's launch response is its qualifying join (R44): it opens the RUN row and the mapping, so the worker takes the run's identity record. */
  async function metaRun(edge: DelegationDurabilityEdge | null, when: 'before' | 'after') {
    const h = harness();
    const first = await h.open();
    const named = await first.applyAccepted(batch([sessionStart(1), workflowLaunch(2)]));
    launchJournalId = named.appended[1]!.journalId;
    await first.close();
    const store2 = new CoordStore(openCoordDb(path.join(h.dir, 'coord.db')));
    const h2 = harness({ dir: h.dir, store: store2 });
    const dur = await h2.open({ onEdge: edge === null ? undefined : (e, w) => { if (e === edge && w === when) throw new SimulatedCrash(`${e}:${w}`); } });
    h2.log.length = 0;
    return { h2, dur, store2 };
  }
  const expectedId = (index: number): string => deriveDelegationActivityId(workerKey(index), launchJournalId);

  it('opens the worker from the RUN\'s record, without a journal event, advancing only the revision, and returns the ID only after the replacement', async () => {
    const { h2, dur } = await metaRun(null, 'before');
    const before = dur.state().checkpoint;
    const out = await dur.applyPositiveWorkflowMeta(meta(1));
    expect(out).toMatchObject({ kind: 'opened', activityId: expectedId(1) });
    const after = dur.state().checkpoint;
    expect(after.revision).toBe(before.revision + 1);
    expect(after.appliedJournalSequence).toBe(before.appliedJournalSequence);          // no journal sequence invented
    expect(h2.log.some((l) => l.startsWith('journal.'))).toBe(false);
    expect(after.activityIdsByNaturalKey[encodeDelegationNaturalKey(workerKey(1))]).toBe(expectedId(1));
    const row = after.activities.find((a) => a.upstreamId === `${RUN}-1`)!;
    expect(row).toMatchObject({ sourceKind: 'workflow', identityJournalId: launchJournalId, parentId: PARENT });
    if (out.kind === 'opened') expect(out.applied.durable).toBe(true);
    expect(out.kind === 'opened' && after.activities.some((a) => a.activityId === out.activityId)).toBe(true);
  });

  it('waits when no run is open, answers already-open for a mapped worker, and a second worker takes the same identity record', async () => {
    const { dur } = await metaRun(null, 'before');
    expect(await dur.applyPositiveWorkflowMeta({ ...meta(0), runId: 'wf_unknown' })).toEqual({ kind: 'waiting-for-evidence' });
    expect(dur.state().checkpoint.revision).toBe(1);                                    // a wait writes nothing
    await dur.applyPositiveWorkflowMeta(meta(0));
    await dur.applyPositiveWorkflowMeta(meta(1));
    expect(await dur.applyPositiveWorkflowMeta(meta(0))).toEqual({ kind: 'already-open', activityId: expectedId(0) });
    const workers = dur.state().checkpoint.activities.filter((a) => /-\d+$/.test(a.upstreamId));
    expect(workers.map((a) => a.upstreamId).sort()).toEqual([`${RUN}-0`, `${RUN}-1`]);
    expect(new Set(workers.map((a) => a.identityJournalId))).toEqual(new Set([launchJournalId]));
  });

  it('refuses an index that is not a non-negative safe integer, writes nothing, and mints nothing', async () => {
    const { h2, dur } = await metaRun(null, 'before');
    const before = readDisk(h2.dir);
    for (const index of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '1' as unknown as number]) {
      await expect(dur.applyPositiveWorkflowMeta(meta(index)), String(index)).rejects.toMatchObject({ code: 'bad-shape' });
    }
    expect(readDisk(h2.dir)).toEqual(before);
    expect(dur.state().checkpoint.activities.map((a) => a.upstreamId)).toEqual([RUN]);
    expect(dur.state().phase).toBe('ready');                                            // a refused index is not a failed application
    expect(dur.failure()).toBeNull();
  });

  const EDGES = ['build', 'checkpoint-write', 'checkpoint-fsync', 'checkpoint-rename', 'directory-fsync'] as const;
  for (const edge of EDGES) {
    for (const when of ['before', 'after'] as const) {
      it(`O1 crash ${when} ${edge}: the call rejects, no ID is returned, SQLite is untouched, and the ID is on disk only if the rename completed`, async () => {
        const { h2, dur, store2 } = await metaRun(edge, when);
        const returned: string[] = [];
        await expect(dur.applyPositiveWorkflowMeta(meta(1)).then((o) => { if (o.kind === 'opened') returned.push(o.activityId); return o; })).rejects.toThrow(SimulatedCrash);
        expect(returned).toEqual([]);
        expect(dur.state().checkpoint.activities.map((a) => a.upstreamId)).toEqual([RUN]);   // not even the applier's own state shows the worker
        expect(Object.keys(dur.state().checkpoint.activityIdsByNaturalKey)).toHaveLength(1);
        expect(h2.log.filter((l) => l === 'project' || l.startsWith('insertEvents'))).toEqual([]);
        expect(store2.readDelegationProjection().activities.map((a) => a.upstreamId)).toEqual([RUN]);
        const onDisk = decodeDelegationCheckpoint(new Uint8Array(readDisk(h2.dir).checkpoint!));
        const renamed = edge === 'directory-fsync' || (edge === 'checkpoint-rename' && when === 'after');
        expect(onDisk.activities.map((a) => a.upstreamId).sort()).toEqual(renamed ? [RUN, `${RUN}-1`] : [RUN]);
        // A restart never invents it either; the same meta later yields the same, deterministic ID.
        const fresh = await harness({ dir: h2.dir }).open();
        const out = await fresh.applyPositiveWorkflowMeta(meta(1));
        expect(out.kind === 'opened' || out.kind === 'already-open' ? out.activityId : 'none').toBe(expectedId(1));
      });
    }
  }

  it('the new ID cannot escape through the applier\'s serialized queue: a rejected application leaves it reconstructing, and a later call refuses', async () => {
    const { dur } = await metaRun('checkpoint-rename', 'before');
    await expect(dur.applyPositiveWorkflowMeta(meta(1))).rejects.toThrow(SimulatedCrash);
    expect(dur.state().phase).toBe('reconstructing');
    await expect(dur.applyPositiveWorkflowMeta(meta(1))).rejects.toMatchObject({ code: 'not-ready' });
  });
});

// ── Task 13 fix round 1, R58 (D-4654): bucket cursors retire through the one application path ──────────────────────────

describe('Task 13 fix 1 (R58, D-4654): pruneBucketCursors drops a cursor only under the applier\'s lock, only where its hour is on file, only past the read horizon', () => {
  const NOW_MS = Date.UTC(2026, 9, 15, 10, 30);
  const NOW_HOUR_MS = Date.UTC(2026, 9, 15, 10);
  const HOUR = 3_600_000;
  const bucketBack = (back: number): string => formatDelegationInstant(NOW_HOUR_MS - back * HOUR).replace(/[-:T]/g, '').slice(0, 10);
  const hourBack = (back: number): string => formatDelegationInstant(NOW_HOUR_MS - back * HOUR);
  const cursorBack = (back: number, over: Record<string, unknown> = {}) => ({ ...cursorFor(bucketBack(back), 10), ...over });
  /** A cursor and (when asked) its interval row, through the ingestion door. */
  async function put(dur: DelegationDurability, back: number, o: { interval?: 'measured' | 'unmeasured' | null; replaced?: boolean } = {}) {
    await dur.applyAccepted(batch([], {
      cursor: cursorBack(back, o.replaced === true ? { replaced: true, intervalState: 'unmeasured', detail: 'bucket-replaced: x' } : {}),
      interval: o.interval === null ? null : intervalFor(hourBack(back), o.interval ?? 'measured', T(1)),
    }));
  }
  const buckets = (dur: DelegationDurability): string[] => dur.state().checkpoint.bucketCursors.map((c) => c.bucket).sort();

  it('47 h is kept, 49 h is dropped, and an old cursor with NO interval row is kept: the drop is conditional on the hour being on file', async () => {
    const h = harness();
    const dur = await h.open();
    await put(dur, 47);
    await put(dur, 49);
    await put(dur, 100, { interval: null });
    await put(dur, 90, { interval: 'unmeasured' });
    const before = dur.state().checkpoint.revision;
    const out = await dur.pruneBucketCursors(NOW_MS);
    expect(out.dropped).toBe(2);
    expect(buckets(dur)).toEqual([bucketBack(47), bucketBack(100)].sort());
    expect(dur.state().checkpoint.revision).toBe(before + 1);
    expect(out.applied.durable).toBe(true);
    // the intervals are exactly what they were
    expect(dur.state().checkpoint.observationIntervals.map((r) => [r.utcHour, r.state]).sort()).toEqual([[hourBack(47), 'measured'], [hourBack(49), 'measured'], [hourBack(90), 'unmeasured']].sort());
  });

  it('it goes through the ONE application path: the O5 edges in order, the journal untouched, SQLite projected after the rename', async () => {
    const h = harness();
    const dur = await h.open();
    await put(dur, 49);
    const journalBefore = readDisk(h.dir).journal;
    h.log.length = 0;
    const edges: string[] = [];
    const dur2 = await h.open({ onEdge: (edge, when) => { edges.push(`${edge}:${when}`); } });
    h.log.length = 0;
    edges.length = 0;
    const out = await dur2.pruneBucketCursors(NOW_MS);
    expect(out.dropped).toBe(1);
    // a checkpoint-only application: O5's steps 3 to 8, with no journal record (so no journal-write and no journal-fsync edge)
    expect(edges).toEqual(DELEGATION_DURABILITY_EDGES.filter((e) => e !== 'journal-write' && e !== 'journal-fsync').flatMap((e) => [`${e}:before`, `${e}:after`]));
    expect(h.log.filter((l) => l.startsWith('journal.'))).toEqual([]);             // no journal write, fsync or open for append
    expect(h.log).toContain('rename:delegation-checkpoint.json.tmp->delegation-checkpoint.json');
    expect(h.log.indexOf('project')).toBeGreaterThan(h.log.indexOf('rename:delegation-checkpoint.json.tmp->delegation-checkpoint.json'));
    expect(readDisk(h.dir).journal).toEqual(journalBefore);
  });

  it('a no-op prune costs no write: nothing droppable changes neither the file, the revision nor SQLite', async () => {
    const h = harness();
    const dur = await h.open();
    await put(dur, 47);
    await put(dur, 100, { interval: null });
    const before = readDisk(h.dir);
    const revision = dur.state().checkpoint.revision;
    h.log.length = 0;
    const out = await dur.pruneBucketCursors(NOW_MS);
    expect(out.dropped).toBe(0);
    expect(out.applied.durable).toBe(false);
    expect(dur.state().checkpoint.revision).toBe(revision);
    expect(readDisk(h.dir)).toEqual(before);
    expect(h.log).toEqual([]);
  });

  it('a kept row\'s replaced:true survives the prune and a restart; a dropped row stays dropped', async () => {
    const h = harness();
    const dur = await h.open();
    await put(dur, 47, { replaced: true });
    await put(dur, 49, { replaced: true });
    await dur.pruneBucketCursors(NOW_MS);
    await dur.close();
    const again = await h.open();
    expect(again.state().checkpoint.bucketCursors.map((c) => [c.bucket, c.replaced])).toEqual([[bucketBack(47), true]]);
  });

  it('it refuses to run unless the applier is ready, and writes nothing', async () => {
    const h = harness();
    const dur = await h.open();
    await put(dur, 49);
    writeFileSync(path.join(h.dir, COORDINATION_RESTORE_MARKER_FILE), 'x\n');
    await dur.recover();
    expect(dur.state().phase).toBe('reconstructing');
    const before = readDisk(h.dir);
    await expect(dur.pruneBucketCursors(NOW_MS)).rejects.toMatchObject({ code: 'not-ready' });
    expect(readDisk(h.dir)).toEqual(before);
  });

  it('the decision is the applier\'s, on its OWN rows, inside the lock: an ingestion queued while a prune is pending marks a kept bucket replaced, and the prune does not undo it', async () => {
    const h = harness();
    let hold: Promise<void> | null = null;
    let release!: () => void;
    const dur = await h.open({ onEdge: async (edge, when) => { if (edge === 'build' && when === 'before' && hold !== null) { const g = hold; hold = null; await g; } } });
    await put(dur, 47);                                                                // the kept bucket, not replaced yet
    await put(dur, 49);                                                                // the droppable one
    hold = new Promise<void>((resolve) => { release = resolve; });
    const ingestion = dur.applyAccepted(batch([], { cursor: cursorBack(47, { replaced: true, intervalState: 'unmeasured', detail: 'bucket-replaced: x' }), interval: null }));
    const prune = dur.pruneBucketCursors(NOW_MS);                                      // a copy taken NOW would still show 47 as not replaced
    await new Promise((resolve) => setTimeout(resolve, 30));
    release();
    await Promise.all([ingestion, prune]);
    expect(dur.state().checkpoint.bucketCursors.map((c) => [c.bucket, c.replaced])).toEqual([[bucketBack(47), true]]);
    await dur.close();
    expect((await h.open()).state().checkpoint.bucketCursors.map((c) => [c.bucket, c.replaced])).toEqual([[bucketBack(47), true]]);
  });

  it('a bucket whose hour does not parse is kept, and the drop reports it', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([], { cursor: { ...cursorFor('garbage', 10) }, interval: null }));
    await put(dur, 49);
    const out = await dur.pruneBucketCursors(NOW_MS);
    expect(out.dropped).toBe(1);
    expect(out.unparseable).toBe(1);
    expect(buckets(dur)).toEqual(['garbage']);
  });
});

// ── Task 13 fix round 1, M1 (D-4652): the lane reads retained evidence through the applier, read-only and on its queue ──

describe('Task 13 fix 1 (M1, D-4652): visitRetainedRecords is read-only, serialized with every application, and only ever runs ready', () => {
  /** A port whose journal READS wait on a gate: the visit is then held open mid-stream. */
  function gatedPort(inner: DelegationFilePort, gate: { wait: Promise<void> | null }): DelegationFilePort {
    return {
      ...inner,
      openRead: async (p) => {
        const handle = await inner.openRead(p);
        if (handle === null) return null;
        // The gate holds the FIRST read after it is armed and then disarms: the visit's first read waits, while an application's own reads
        // (the journal writer checks the tail it appends behind) go straight through, so only a queue can keep the two apart.
        return { size: () => handle.size(), close: () => handle.close(), read: async (pos, len) => { const held = gate.wait; if (held !== null) { gate.wait = null; await held; } return handle.read(pos, len); } };
      },
    };
  }

  it('an application enqueued during a held visit completes only after the visit', async () => {
    const h = harness();
    const first = await h.open();
    await first.applyAccepted(batch([sessionStart(1), subagentStart(2, X)]));
    await first.close();
    const gate: { wait: Promise<void> | null } = { wait: null };
    const dur = await h.open({ port: gatedPort(spyPort(h.log), gate) });
    let release!: () => void;
    gate.wait = new Promise<void>((resolve) => { release = resolve; });
    const order: string[] = [];
    const seen: number[] = [];
    const visit = dur.visitRetainedRecords((r) => { seen.push(r.sequence); }).then(() => { order.push('visit'); });
    const apply = dur.applyAccepted(batch([sessionStart(3)])).then(() => { order.push('apply'); });
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(order, 'the application ran beside the visit').toEqual([]);
    } finally {
      release();                                                    // a failed assertion must not leave the gate shut: the test's cleanup awaits the queue
    }
    await Promise.all([visit, apply]);
    expect(order).toEqual(['visit', 'apply']);
    expect(seen).toEqual([1, 2]);                                   // the visit saw the journal as it stood when it began, not the application's record
  });

  it('it refuses unless the applier is ready (a reconstructing applier streams nothing), and visits nothing', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAccepted(batch([sessionStart(1)]));
    writeFileSync(path.join(h.dir, COORDINATION_RESTORE_MARKER_FILE), 'x\n');
    await dur.recover();
    const seen: number[] = [];
    await expect(dur.visitRetainedRecords((r) => { seen.push(r.sequence); })).rejects.toMatchObject({ code: 'not-ready' });
    expect(seen).toEqual([]);
  });

  it('it is read-only: no file, no revision, no SQLite row and no log entry changes, and it opens no write, rename or truncate target', async () => {
    const h = harness();
    const first = await h.open();
    await first.applyAccepted(batch([sessionStart(1), subagentStart(2, X)]));
    await first.close();
    const dur = await h.open();
    const before = { disk: readDisk(h.dir), revision: dur.state().checkpoint.revision, stats: h.store.delegationEventStats() };
    h.log.length = 0;
    const seen: number[] = [];
    await dur.visitRetainedRecords((r) => { seen.push(r.sequence); });
    expect(seen).toEqual([1, 2]);
    expect(readDisk(h.dir)).toEqual(before.disk);
    expect(dur.state().checkpoint.revision).toBe(before.revision);
    expect(h.store.delegationEventStats()).toEqual(before.stats);
    expect(h.log.filter((l) => /^(journal|checkpoint)\.|^rename|^dir\.sync|^project|^insertEvents/.test(l))).toEqual([]);
  });

  it('retained records before the applied position change nothing: an activity the checkpoint already maps keeps its ID verbatim', async () => {
    const h = harness();
    const first = await h.open();
    const named = await first.applyAccepted(batch([sessionStart(1), bareTool(2, X), subagentStart(3, X)]));
    const idBefore = activityOf(first.state().checkpoint, X)!.activityId;
    expect(idBefore).toBe(deriveDelegationActivityId(keyOf(X), named.appended[1]!.journalId));
    await first.close();
    const dur = await h.open();
    const mapped = { ...dur.state().checkpoint.activityIdsByNaturalKey };
    const seen: Array<[number, string]> = [];
    await dur.visitRetainedRecords((r) => { seen.push([r.sequence, r.entry.kind]); });
    expect(seen.map(([n]) => n)).toEqual([1, 2, 3]);                                // every retained record, including those before the applied position
    expect(activityOf(dur.state().checkpoint, X)!.activityId).toBe(idBefore);
    expect(dur.state().checkpoint.activityIdsByNaturalKey).toEqual(mapped);
    expect(dur.state().checkpoint.activities.map((a) => a.activityId)).toEqual([idBefore]);
  });

  it('a failure DURING a visit rejects, leaves the applier ready and unchanged, and a later application still works', async () => {
    const h = harness();
    const first = await h.open();
    await first.applyAccepted(batch([sessionStart(1), subagentStart(2, X)]));
    await first.close();
    const dur = await h.open();
    const before = readDisk(h.dir);
    await expect(dur.visitRetainedRecords((r) => { if (r.sequence === 2) throw new Error('visit failed midway'); })).rejects.toThrow('visit failed midway');
    expect(dur.state().phase).toBe('ready');
    expect(dur.failure()).toBeNull();
    expect(readDisk(h.dir)).toEqual(before);
    await expect(dur.applyAccepted(batch([sessionStart(3)]))).resolves.toBeDefined();
  });
});

// ── D-4658 (ruling R79): one durable application per pass, `applyAcceptedBatch` ─────────────────────────────────────────

describe('D-4658: applyAcceptedBatch applies several buckets as ONE durable application, in O5 order, equal to one application each', () => {
  const OTHER = 'lane-b-demo';
  const cursorOf = (sessionId: string, bucket: string, cursor: number, over: { replaced?: boolean; intervalState?: 'measured' | 'unmeasured'; detail?: string | null } = {}) =>
    ({ ...cursorFor(bucket, cursor), sessionId, ...over });
  const intervalOf = (sessionId: string, utcHour: string, recordedAt: string) => ({ ...intervalFor(utcHour, 'measured', recordedAt), sessionId });
  const HOUR0 = '2026-10-14T00:00:00.000Z';
  const HOUR1 = '2026-10-14T01:00:00.000Z';
  /** Three buckets of a pass: two owners, one with two hours; seven records in all, one opening an activity. */
  const passBatches = (): DelegationDurableBatch[] => [
    batch([sessionStart(1), subagentStart(2, X), bareTool(3, X)], { cursor: cursorOf(PARENT, '2026101400', 300), interval: intervalOf(PARENT, HOUR0, T(10)) }),
    batch([sessionStart(4, { sessionId: OTHER }), bareTool(5, Y, { sessionId: OTHER })], { cursor: cursorOf(OTHER, '2026101400', 200), interval: intervalOf(OTHER, HOUR0, T(10)) }),
    batch([bareTool(6, X), subagentStop(7, X)], { cursor: cursorOf(PARENT, '2026101401', 200), interval: intervalOf(PARENT, HOUR1, T(10)) }),
  ];
  /** SQLite's events, without the table's own autoincrement `id` (a repair that re-inserts renumbers it; nothing reads it). */
  const eventsOf = (store: CoordStore) => (store as unknown as { db: DatabaseSync }).db.prepare('SELECT * FROM delegation_events ORDER BY journalSequence').all()
    .map((r) => { const { id: _id, ...rest } = r as Record<string, unknown>; return rest; });
  /** Everything an application can leave: the journal's bytes, the checkpoint's rows (its revision aside) and SQLite. */
  const outcomeOf = (h: Harness, dur: DelegationDurability) => ({
    journal: readFileSync(path.join(h.dir, DELEGATION_JOURNAL_FILE)).toString('base64'),
    rows: withoutRevision(dur.state().checkpoint),
    projection: canonicalDelegationJson(h.store.readDelegationProjection()),
    events: JSON.stringify(eventsOf(h.store)),
  });
  /** THE REFERENCE: the same input, unbatched (one `applyAccepted` per bucket, as the lane applied before D-4658). */
  async function unbatched() {
    const h = harness();
    const dur = await h.open();
    for (const b of passBatches()) await dur.applyAccepted(b);
    return outcomeOf(h, dur);
  }
  /** Reopens a crashed directory with a fresh applier (recovery), as a restart does. */
  async function reopen(dir: string) {
    const h = harness({ dir, store: new CoordStore(openCoordDb(path.join(dir, 'coord.db'))) });
    return { h, dur: await h.open() };
  }

  it('O5 in order: every record written then fsynced before the next, then ONE checkpoint replacement and ONE projection', async () => {
    const h = harness();
    const edges: string[] = [];
    const dur = await h.open({ onEdge: (e, w) => { if (w === 'before') edges.push(e); } });
    edges.length = 0;
    const out = await dur.applyAcceptedBatch(passBatches());
    expect(out.appended).toHaveLength(7);
    expect(edges).toEqual([
      ...Array.from({ length: 7 }, () => ['journal-write', 'journal-fsync']).flat(),
      'build', 'checkpoint-write', 'checkpoint-fsync', 'checkpoint-rename', 'directory-fsync', 'project',
    ]);
    expect(dur.state().checkpoint.bucketCursors.map((c) => [c.sessionId, c.bucket, c.cursor])).toEqual([
      [PARENT, '2026101400', 300], [OTHER, '2026101400', 200], [PARENT, '2026101401', 200],
    ].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)));
  });

  it('the same input unbatched leaves the SAME journal bytes, checkpoint rows and SQLite', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAcceptedBatch(passBatches());
    expect(outcomeOf(h, dur)).toEqual(await unbatched());
  });

  it('a batch\'s members are validated before the first byte: one unreadable cursor refuses the WHOLE application, and nothing is written', async () => {
    const h = harness();
    const dur = await h.open();
    const before = readDisk(h.dir);
    const bad = passBatches();
    bad[1] = { ...bad[1]!, cursor: { ...bad[1]!.cursor!, cursor: -1 } };
    await expect(dur.applyAcceptedBatch(bad)).rejects.toThrow();
    expect(readDisk(h.dir)).toEqual(before);
    expect(dur.failure()).toBeNull();
    expect(dur.state().checkpoint.appliedJournalSequence).toBe(0);
  });

  it('replaced stays sticky across a batch: a later member of the same application cannot un-replace a bucket', async () => {
    const h = harness();
    const dur = await h.open();
    const replaced = cursorOf(PARENT, '2026101400', 40, { replaced: true, intervalState: 'unmeasured', detail: 'bucket-replaced: size 3 is below the cursor 40' });
    await dur.applyAcceptedBatch([batch([sessionStart(1)], { cursor: replaced }), batch([sessionStart(2)], { cursor: cursorOf(PARENT, '2026101400', 10) })]);
    expect(dur.state().checkpoint.bucketCursors[0]).toMatchObject({ replaced: true, intervalState: 'unmeasured' });
    expect(dur.state().checkpoint.bucketCursors[0]!.detail).toMatch(/^bucket-replaced/);
  });

  // Coordinator 5443 condition 1: batching widens the window past the checkpoint from one record to k.
  const crashes: ReadonlyArray<readonly [string, (e: DelegationDurabilityEdge, w: 'before' | 'after', n: { writes: number }) => boolean, number]> = [
    ['after all seven records are appended and fsynced, before the checkpoint rename', (e, w) => e === 'checkpoint-rename' && w === 'before', 7],
    ['between two of the batch\'s record fsyncs (two records durable, the third not yet written)', (e, w, n) => e === 'journal-write' && w === 'before' && ++n.writes === 3, 2],
  ];
  for (const [label, at, durable] of crashes) {
    it(`a crash ${label}: recovery replays every record, and the next pass completes to the unbatched state`, async () => {
      const h = harness();
      const n = { writes: 0 };
      const dur = await h.open({ onEdge: (e, w) => { if (at(e, w, n)) throw new SimulatedCrash(`${e}:${w}`); } });
      await expect(dur.applyAcceptedBatch(passBatches())).rejects.toThrow(SimulatedCrash);
      expect(dur.state().checkpoint.appliedJournalSequence, 'nothing of the application is visible').toBe(0);
      await dur.close();
      const again = await reopen(h.dir);
      expect(again.dur.failure()).toBeNull();
      expect(again.dur.state().checkpoint.appliedJournalSequence, `${durable} record(s) past the checkpoint, all replayed`).toBe(durable);
      expect(again.dur.state().checkpoint.bucketCursors, 'cursors are checkpoint-only: the crash lost them, so the next pass re-reads').toEqual([]);
      await again.dur.applyAcceptedBatch(passBatches());                   // the next pass: the same buckets from the same cursors
      expect(outcomeOf(again.h, again.dur)).toEqual(await unbatched());
    });
  }

  it('condition 3, the heal: a torn LAST record of a batch heals at recovery, and the next pass completes to the unbatched state', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAcceptedBatch(passBatches());
    await dur.close();
    const jp = path.join(h.dir, DELEGATION_JOURNAL_FILE);
    const bytes = readFileSync(jp);
    const lines = bytes.toString('utf8').split('\n').filter((l) => l !== '');
    const keep = lines.slice(0, 6).join('\n') + '\n';                      // six whole records, then half of the seventh: a torn tail
    writeFileSync(jp, keep + lines[6]!.slice(0, Math.floor(lines[6]!.length / 2)));
    writeFileSync(path.join(h.dir, DELEGATION_CHECKPOINT_FILE), '');        // the checkpoint of the batch never landed
    rmSync(path.join(h.dir, DELEGATION_CHECKPOINT_FILE));
    const again = await reopen(h.dir);
    expect(again.dur.failure()).toBeNull();
    expect(again.dur.lastTailHeal()).not.toBeNull();
    expect(again.dur.state().checkpoint.appliedJournalSequence).toBe(6);
    await again.dur.applyAcceptedBatch(passBatches());
    expect(outcomeOf(again.h, again.dur)).toEqual(await unbatched());
  });

  it('condition 3, corruption: a batch with a damaged record BEFORE its last is not a torn tail; recovery fails closed and cuts nothing', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAcceptedBatch(passBatches());
    await dur.close();
    const jp = path.join(h.dir, DELEGATION_JOURNAL_FILE);
    const lines = readFileSync(jp, 'utf8').split('\n').filter((l) => l !== '');
    const damaged = [...lines.slice(0, 3), lines[3]!.slice(0, Math.floor(lines[3]!.length / 2)), ...lines.slice(4)].join('\n') + '\n';
    writeFileSync(jp, damaged);
    rmSync(path.join(h.dir, DELEGATION_CHECKPOINT_FILE));
    const again = await reopen(h.dir);
    expect(again.dur.failure(), 'a damaged record that is not the last one is corruption').not.toBeNull();
    expect(again.dur.lastTailHeal()).toBeNull();
    expect(readFileSync(jp, 'utf8'), 'nothing is cut').toBe(damaged);
  });

  it('O1 (the batch door\'s own crash row): a crash at any edge exposes no activity ID and poisons the applier; recovery replays a PREFIX of the records, and the next pass completes to the unbatched state', async () => {
    const reference = await unbatched();
    for (const edge of DELEGATION_DURABILITY_EDGES.filter((e) => e !== 'project')) {
      for (const when of ['before', 'after'] as const) {
        const h = harness();
        let hit = false;
        const dur = await h.open({ onEdge: (e, w) => { if (!hit && e === edge && w === when) { hit = true; throw new SimulatedCrash(`${e}:${w}`); } } });
        const exposed: string[] = [];
        await expect(dur.applyAcceptedBatch(passBatches()).then((o) => { exposed.push(...o.openedActivities.map((a) => a.activityId)); })).rejects.toThrow(SimulatedCrash);
        expect(exposed, `${when} ${edge}`).toEqual([]);
        expect(dur.state().checkpoint.activities, `${when} ${edge}: nothing visible`).toEqual([]);
        await expect(dur.applyAcceptedBatch(passBatches())).rejects.toMatchObject({ code: 'not-ready' });
        await dur.close();
        const again = await reopen(h.dir);
        expect(again.dur.failure(), `${when} ${edge}`).toBeNull();
        const k = again.dur.state().checkpoint.appliedJournalSequence;
        expect(k >= 0 && k <= 7, `${when} ${edge}: a prefix of the batch (${k})`).toBe(true);
        await again.dur.applyAcceptedBatch(passBatches());
        expect(outcomeOf(again.h, again.dur), `${when} ${edge}`).toEqual(reference);
      }
    }
  });

  it('condition 4, the compare: a re-applied pass whose records all dedupe and whose rows are unchanged writes NOTHING; a change that removes rows without appending is written', async () => {
    const h = harness();
    const dur = await h.open();
    await dur.applyAcceptedBatch(passBatches());
    const revision = dur.state().checkpoint.revision;
    const before = readDisk(h.dir);
    const again = await dur.applyAcceptedBatch(passBatches());              // the caller hands seven records; the measured plan appends none
    expect(again.durable).toBe(false);
    expect(dur.state().checkpoint.revision).toBe(revision);
    expect(readDisk(h.dir)).toEqual(before);
    // a checkpoint-only change that REMOVES rows (no record appended) runs the compare and is written
    const removed = await dur.applyCheckpointChange((cp) => ({ ...cp, observationIntervals: cp.observationIntervals.slice(1) }));
    expect(removed.durable).toBe(true);
    expect(dur.state().checkpoint.observationIntervals).toHaveLength(2);
    // and a deduped re-application that changes a cursor is written too
    const moved = passBatches().map((b, i) => (i === 0 ? { ...b, cursor: cursorOf(PARENT, '2026101400', 400) } : b));
    expect((await dur.applyAcceptedBatch(moved)).durable).toBe(true);
  });
});
