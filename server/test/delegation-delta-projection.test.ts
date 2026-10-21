// The delta projection, STORE side: the pure diff `diffDelegationProjection(prior, next)` (delegation-model.ts) and the store method
// `CoordStore.projectDelegationCheckpointChanges(prior, next)`. A flush changes a handful of rows; the full projection deletes and
// re-inserts all five tables for it. The delta writes only the rows that differ (a compare-and-swap UPDATE per changed row, a plain
// INSERT per new row, parents first), checks the row count of the five tables on EVERY delta, a zero-row one included, and falls back to
// the full projection INSIDE the same call for anything it does not do: a row leaving, or any lease or lease-lineage change.
//
// WHAT THIS FILE PINS (the row ids are this file's own; the applier's and the lane's rows live in their own files)
//   R6   a row LEAVING falls back: one case per table (a session, an activity, a lease with its lineage, an activity-owned lineage row,
//        and an attempt); each answers `{ mode: 'full' }` and parity holds at once
//   R7   every lease row and lease-lineage row that differs, is new or leaves falls back, asserted on the RETURNED mode and on the diff's
//        `applicable: false`, a lineage row whose `leaseId` goes non-null to null included
//   R8   the compare-and-swap catches what the count cannot: an out-of-band delete of one activity plus an out-of-band insert of another
//        in the same parent keep the counts equal, and the delta that updates the deleted one is refused naming the miss
//   R9   the count tripwire: a stray out-of-band attempt trips an updating delta and a zero-row delta; SQLite is byte-identical after
//   R10  SQLite holding another value on a row the delta updates (an out-of-band edit of a column the delta does not write) is a miss
//   R15  refusal parity: every checkpoint the full path refuses is refused by the delta with the same code, SQLite unchanged and no BEGIN;
//        plus the position case (leases shared by reference) and foreign keys off run as an APPLICABLE delta
//   R16  one GENERATED case per codec column, from the codecs' own `columns`: a non-key column writes exactly one row, a key column and
//        `lineage.leaseId` fall back, a lease column `assertWave3Lease` leaves free falls back, a lease column it pins is refused with the
//        code the full path gives (measured here on a twin store, not typed)
//   R17  an intent-change shaped next (every reference new) writes exactly one session row; an interval-only next writes none
//   R18  a new session and its first activity in one delta: the activity INSERT follows its session's (the foreign key)
//        plus an UPDATE onto a parent new in the same delta (an attempt to a new session, a lineage row to a new activity): the INSERT goes first
//   R21  the rows written do not scale with the table: the same count at 1k and at 20k activities, counted, never timed
//   R24  a fault at each statement of a multi-row delta, the UPDATEs included, leaves SQLite as it was
//
// THE NEW EXPORTS ARE REACHED THROUGH CASTS. `diffDelegationProjection` is read off the namespace import and the store method through a
// cast of the store, as `delegation-pass-timing.test.ts` does for its seams, so this file type-checks against code that has neither and
// each row then fails on its own assertion (not a function), never as a whole file on an import error.
//
// EVERY ROW ALSO ASSERTS PARITY wherever the delta succeeds: `readDelegationProjection()` canonically equals
// `projectionViewOfDelegationCheckpoint(next)`. The statement traces use a proxy over the real handle that also matches UPDATE (the
// full projection's statement lists, pinned in coord-store.test.ts, neither run nor change here). Every store is a fixture store in a
// temp directory; ids are generated and neutral.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import * as model from '../src/coord/delegation-model.js';
import {
  DelegationModelError, canonicalDelegationJson, declareCoordinatorIntent, delegationActivityCodec, delegationAttemptCodec,
  delegationLeaseCodec, delegationLineageCodec, delegationSessionCodec, delegationSha256Hex, deriveCoordinatorIntentByParent,
  deriveDelegationActivityId, encodeDelegationNaturalKey, formatDelegationInstant,
  type DelegationActivityRow, type DelegationAttemptRow, type DelegationCheckpointV1, type DelegationEventRow,
  type DelegationLeaseRow, type DelegationLineageRow, type DelegationSessionRow, type DelegationSqlValue,
} from '../src/coord/delegation-model.js';
import {
  DELEGATION_ACTIVITY_SOURCE_KINDS, DELEGATION_ATTEMPT_VERDICTS, DELEGATION_CLEANUP_POPULATIONS, DELEGATION_CLEANUP_STATES,
  DELEGATION_DISPOSITIONS, DELEGATION_EXECUTION_STATES, DELEGATION_LEASE_SOURCE_KINDS, DELEGATION_PARENTAGE_STATES,
  DELEGATION_WORKSPACE_STATES,
} from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

// ── The two new things, reached through casts ────────────────────────────────────────────────────────────────────────────

type ChangesResult = { mode: 'delta'; rows: number } | { mode: 'full' };
type DiffResult =
  | { applicable: false; reason: string }
  | { applicable: true; updates: readonly { table: string }[]; inserts: readonly { table: string }[]; counts: readonly { table: string; count: number }[] };

const diffOf = (prior: DelegationCheckpointV1, next: DelegationCheckpointV1): DiffResult =>
  (model as unknown as { diffDelegationProjection(p: DelegationCheckpointV1, n: DelegationCheckpointV1): DiffResult }).diffDelegationProjection(prior, next);
const changes = (s: CoordStore, prior: DelegationCheckpointV1, next: DelegationCheckpointV1): ChangesResult =>
  (s as unknown as { projectDelegationCheckpointChanges(p: DelegationCheckpointV1, n: DelegationCheckpointV1): ChangesResult }).projectDelegationCheckpointChanges(prior, next);

// ── Small helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────

const DELEGATION_TABLES = [
  'delegation_lineage', 'delegation_leases', 'delegation_events', 'delegation_attempts', 'delegation_activities', 'delegation_sessions',
] as const;
const jid = (n: number): string => delegationSha256Hex(`fixture-journal-${n}`);
const at = (minute: number): string => formatDelegationInstant(Date.UTC(2026, 9, 14, 0, minute, 0, 0));
const natural = (parentId: string, parentIncarnation: string, sourceKind: DelegationActivityRow['sourceKind'], upstreamId: string) =>
  ({ parentId, parentIncarnation, sourceKind, upstreamId });
const canon = (cp: DelegationCheckpointV1): string => canonicalDelegationJson(cp);
const refusedWith = (fn: () => unknown, code: string): void => {
  expect(fn).toThrowError(expect.objectContaining({ name: 'DelegationModelError', code }));
};

const sessionRow = (sessionId: string, parentIncarnation: string, over: Partial<DelegationSessionRow> = {}): DelegationSessionRow => ({
  sessionId, parentIncarnation, explicitIntentAt: null, effective: false, effectiveBasis: [], claudeSessionIds: [],
  firstObservedAt: at(0), lastObservedAt: at(4), ...over,
});
const activityRow = (n: number, k: ReturnType<typeof natural>, over: Partial<DelegationActivityRow> = {}): DelegationActivityRow => ({
  activityId: deriveDelegationActivityId(k, jid(n)), parentId: k.parentId, parentIncarnation: k.parentIncarnation,
  sourceKind: k.sourceKind, upstreamId: k.upstreamId, identityJournalId: jid(n), displayName: null,
  executionState: 'active', openedAt: at(1), endedAt: null, lastEventAt: at(2), ...over,
});
const attemptRow = (id: string, parentId: string, parentIncarnation: string, over: Partial<DelegationAttemptRow> = {}): DelegationAttemptRow => ({
  attemptId: id, parentId, parentIncarnation, project: 'project-a', adminRecord: `wt-${id}`, canonicalPath: null, attemptedAt: at(3),
  rung: null, verdict: 'unresolved', evidenceJournalIds: [], detail: null, ...over,
});
const lineageRow = (id: string, parentId: string, parentIncarnation: string, over: Partial<DelegationLineageRow> = {}): DelegationLineageRow => ({
  lineageId: delegationSha256Hex(`fixture-lineage-${id}`), parentId, parentIncarnation, activityId: null, leaseId: null, runId: null,
  openedAt: at(1), closedAt: null, closeReason: null, ...over,
});
const leaseRow = (n: number, a: DelegationActivityRow, over: Partial<DelegationLeaseRow> = {}): DelegationLeaseRow => ({
  leaseId: `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`,
  generation: 0, creatingJournalSequence: 3 + n, currentJournalSequence: 3 + n, activityId: a.activityId,
  parentId: a.parentId, parentIncarnation: a.parentIncarnation, project: 'project-a', adminRecord: `wt-${n}`,
  canonicalPath: `/work/project-a/wt-${n}`, creationBase: null, sourceKind: 'agent', parentageState: 'linked',
  workspaceState: 'present', disposition: 'ephemeral', cleanupState: 'not-due', cleanupPopulation: 'ephemeral-lease',
  firstObservedAt: at(2), lastObservedAt: at(2), terminalEvidenceAt: null, adoptedAt: null, retainedAt: null,
  promotedAt: null, cleanupDueAt: null, cleanupStartedAt: null, cleanupFinishedAt: null, cleanupEvidenceJson: null,
  carrierGenerationSeen: null, releasedAt: null, ...over,
});
/** The lease-OWNED lineage row replay opens for a lease, at the lease's `firstObservedAt` (what `assertWave3Leases` looks for). */
const openingRow = (id: string, l: DelegationLeaseRow, over: Partial<DelegationLineageRow> = {}): DelegationLineageRow =>
  lineageRow(id, l.parentId, l.parentIncarnation, { leaseId: l.leaseId, openedAt: l.firstObservedAt, ...over });
const eventRow = (n: number, over: Partial<DelegationEventRow> = {}): DelegationEventRow => ({
  eventId: delegationSha256Hex(`fixture-event-${n}`), journalSequence: n, journalDigest: delegationSha256Hex(`digest-${n}`),
  acceptedAt: at(n), sessionId: 'lane-a-demo', parentIncarnation: 'g1', claudeSessionId: 'cs-1', eventKind: 'PostToolUse',
  observedAt: at(n - 1 < 0 ? 0 : n - 1), payloadJson: `{"v":1,"n":${n}}`, ...over,
});

/** A checkpoint that fills every table. `variant` 1 changes the CONTENT of the sessions, activities, attempts and activity-owned
 *  lineage but no key, and leaves every lease and lease-owned lineage row value-equal (fresh objects), so `fixture(0)` to `fixture(1)`
 *  is an APPLICABLE delta. Beside the shapes any store fixture holds it carries three things the rows need:
 *    - a LEAF session (`lane-d-demo`) and a LEAF activity (no lease, no lineage, nothing pointing at it), so a key column can move
 *      without a dependent row losing its parent;
 *    - a SECOND lease-owned lineage row for the first lease, opened at that lease's `firstObservedAt`, so one of the two can turn
 *      activity-owned and `assertWave3Leases` still finds the lease's opening row (R7);
 *    - two real runs, for the run-owned lineage row's foreign key and a second run to point it at. */
const fixture = (runIds: readonly [number, number], variant: 0 | 1): DelegationCheckpointV1 => {
  const tag = variant === 0 ? 'a' : 'b';
  const m = variant === 0 ? 0 : 5;
  const k1 = natural('lane-a-demo', 'g1', 'agent', 'agent-1');
  const k2 = natural('lane-a-demo', 'g1', 'workflow', 'run-1#0');
  const k3 = natural('lane-b-demo', 'g1', 'bash-worktree', 'toolu_1');
  const k4 = natural('lane-b-demo', 'g1', 'agent', 'agent-4');
  const activities = [
    activityRow(1, k1, { displayName: `reviewer-${tag}`, executionState: 'ended', endedAt: at(3), lastEventAt: at(3) }),
    activityRow(2, k2, { lastEventAt: at(2 + m) }),
    activityRow(3, k3, { executionState: 'unknown', lastEventAt: at(2 + m) }),
    activityRow(4, k4, {}),
  ];
  const leases = [
    leaseRow(1, activities[0]!),
    leaseRow(2, activities[1]!, { creationBase: 'abc123', sourceKind: 'workflow', parentageState: 'unresolved', workspaceState: 'provisioning' }),
    leaseRow(3, activities[2]!, { project: 'project-b', sourceKind: 'raw', parentageState: 'conflicting', workspaceState: 'unmeasured' }),
  ];
  const sessions = [
    sessionRow('lane-a-demo', 'g1', { explicitIntentAt: variant === 0 ? at(10) : at(11), effective: variant === 0,
      effectiveBasis: variant === 0 ? ['explicit', 'delegation-inferred'] : ['run-owner'],
      claudeSessionIds: variant === 0 ? ['cs-1', 'cs-2'] : ['cs-9'], firstObservedAt: at(variant === 0 ? 0 : 1), lastObservedAt: at(20 + m) }),
    sessionRow('lane-a-demo', 'g2', { explicitIntentAt: variant === 0 ? at(10) : at(11), effective: variant === 0,
      effectiveBasis: variant === 0 ? ['explicit'] : ['retained-lineage'], claudeSessionIds: variant === 0 ? [] : ['cs-8'],
      firstObservedAt: at(variant === 0 ? 0 : 1), lastObservedAt: at(21 + m) }),
    sessionRow('lane-b-demo', 'g1', { explicitIntentAt: variant === 0 ? null : at(12), effective: variant !== 0,
      effectiveBasis: variant === 0 ? [] : ['explicit'], claudeSessionIds: variant === 0 ? ['cs-3'] : [],
      firstObservedAt: at(variant === 0 ? 0 : 1), lastObservedAt: at(22 + m) }),
    sessionRow('lane-d-demo', 'g1', {}),
  ];
  return {
    v: 1, revision: 3, appliedJournalSequence: 6, appliedJournalId: jid(6), appliedJournalDigest: delegationSha256Hex('digest-6'),
    activityIdsByNaturalKey: Object.fromEntries(activities.map((a) => [encodeDelegationNaturalKey(a), a.activityId])),
    coordinatorIntentByParent: deriveCoordinatorIntentByParent(sessions),
    sessions,
    attempts: [
      attemptRow('attempt-1', 'lane-a-demo', 'g1', { verdict: 'linked', canonicalPath: '/work/project-a/wt-1', rung: 2, evidenceJournalIds: [jid(1)], detail: `ok-${tag}` }),
      attemptRow('attempt-2', 'lane-a-demo', 'g1', { detail: `no admin record ${tag}`, attemptedAt: at(4) }),
      attemptRow('attempt-3', 'lane-a-demo', 'g1', { verdict: 'conflicting', rung: 3, evidenceJournalIds: [jid(2), jid(3)], attemptedAt: at(5) }),
      attemptRow('attempt-4', 'lane-b-demo', 'g1', { verdict: 'unmeasured', detail: 'registry unreadable', attemptedAt: at(6) }),
    ],
    activities,
    leases,
    lineage: [
      lineageRow('1', 'lane-a-demo', 'g1', { activityId: activities[0]!.activityId }),
      openingRow('2', leases[0]!),
      openingRow('2b', leases[0]!),
      lineageRow('3', 'lane-b-demo', 'g1', { activityId: activities[2]!.activityId, closedAt: at(5), closeReason: `activity-ended-${tag}` }),
      lineageRow('4', 'lane-a-demo', 'g1', { runId: runIds[0] }),
      openingRow('5', leases[1]!),
      openingRow('6', leases[2]!),
    ],
    bucketCursors: [], observationIntervals: [], pruningHolds: [],
  };
};

// ── The traced handle ────────────────────────────────────────────────────────────────────────────────────────────────────

type Write = { kind: 'delete' | 'insert' | 'update'; table: string; sql: string };
/** The task's regex for a write of a delegation table, unanchored, so a statement that reaches one inside a longer text is seen too. */
const WRITE_RE = /(DELETE FROM|INSERT INTO|UPDATE)\s+(delegation_[a-z]+)/g;
const KIND: Readonly<Record<string, Write['kind']>> = { 'DELETE FROM': 'delete', 'INSERT INTO': 'insert', 'UPDATE': 'update' };

/** A proxy over the real handle that records (and optionally faults) every DELETE, INSERT and UPDATE on a delegation table before it
 *  runs, by whichever path it takes (`exec`, or a prepared statement's `run`, `get`, `all` or `iterate`), and every `exec` (so a BEGIN
 *  is visible). Only a statement whose text matches the write regex is recorded. The UPDATE arm is what coord-store.test.ts's own
 *  `traced()` does not carry. */
const traced = (real: DatabaseSync) => {
  const log: Write[] = [];
  const execs: string[] = [];
  let failAt: number | null = null;
  const note = (sql: string): void => {
    for (const m of sql.matchAll(WRITE_RE)) {
      const idx = log.length;
      log.push({ kind: KIND[m[1]!]!, table: m[2]!, sql });
      if (failAt === idx) throw new Error('injected fault');
    }
  };
  const db = new Proxy(real, {
    get(target, prop) {
      if (prop === 'exec') return (sql: string) => { execs.push(sql); note(sql); target.exec(sql); };
      if (prop === 'prepare') {
        return (sql: string) => {
          const stmt = target.prepare(sql);
          if (!new RegExp(WRITE_RE.source).test(sql)) return stmt;
          return new Proxy(stmt, {
            get(st, p) {
              const v = Reflect.get(st, p, st) as unknown;
              if (typeof v !== 'function') return v;
              if (p === 'run' || p === 'get' || p === 'all' || p === 'iterate') return (...args: never[]) => { note(sql); return (v as (...a: never[]) => unknown).apply(st, args); };
              return v.bind(st);
            },
          });
        };
      }
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as DatabaseSync;
  return {
    db, log, execs,
    words: (): string[] => log.map((w) => `${w.kind} ${w.table}`),
    reset: (): void => { log.length = 0; execs.length = 0; },
    failAt: (i: number | null): void => { failAt = i; log.length = 0; execs.length = 0; },
  };
};

interface Open { s: CoordStore; raw: DatabaseSync; t: ReturnType<typeof traced> }
const openStore = (): Open => {
  const raw = openCoordDb(path.join(mkTmp('ccrc-delta-'), '.ccrc', 'coord.db'));
  // Durability is not under test here (the transactions, the foreign keys and the rollbacks are): no fsync per commit keeps the
  // generated R16 cases, which commit a few dozen times each, from waiting on the disk.
  raw.exec('PRAGMA synchronous = OFF');
  const t = traced(raw);
  return { s: new CoordStore(t.db), raw, t };
};
interface World extends Open {
  runIds: readonly [number, number];
  prior: DelegationCheckpointV1;
  fx: (v: 0 | 1) => DelegationCheckpointV1;
}
/** A store with two runs, `fixture(0)` projected by the FULL path, two events, and an empty trace. */
const openWorld = (): World => {
  const o = openStore();
  const run = (wave: number): number =>
    (o.s.openRun({ program: 'delta-fixture', title: 'Delta fixture', project: 'project-a', wave, waveOf: 5, claimedBy: 'coordinator-a' }) as { id: number }).id;
  const runIds = [run(1), run(2)] as const;
  const fx = (v: 0 | 1): DelegationCheckpointV1 => fixture(runIds, v);
  const prior = fx(0);
  o.s.projectDelegationCheckpoint(prior);
  o.s.insertDelegationEvent(eventRow(1));
  o.s.insertDelegationEvent(eventRow(2, { sessionId: 'lane-b-demo' }));
  o.t.reset();
  return { ...o, runIds, prior, fx };
};
const dumpAll = (raw: DatabaseSync): Record<string, unknown[]> =>
  Object.fromEntries(DELEGATION_TABLES.map((t) => [t, raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const expectParity = (s: CoordStore, next: DelegationCheckpointV1): void => {
  expect(canon(s.readDelegationProjection())).toBe(canon(model.projectionViewOfDelegationCheckpoint(next)));
};
/** A raw INSERT of a codec-encoded row, for the out-of-band edits (through the untraced handle). */
const insertRaw = (raw: DatabaseSync, codec: { table: string; columns: readonly string[] }, enc: Readonly<Record<string, DelegationSqlValue>>): void => {
  raw.prepare(`INSERT INTO ${codec.table} (${codec.columns.join(', ')}) VALUES (${codec.columns.map(() => '?').join(', ')})`)
    .run(...codec.columns.map((c) => enc[c]!));
};
const beginsOf = (t: Open['t']): string[] => t.execs.filter((e) => /BEGIN/.test(e));

// ── R6: a row LEAVING falls back ─────────────────────────────────────────────────────────────────────────────────────────

describe('R6: a row leaving falls back to the full projection inside the same call, one case per table', () => {
  const cases: Array<[string, (p: DelegationCheckpointV1) => DelegationCheckpointV1]> = [
    ['a session', (p) => ({ ...p, sessions: p.sessions.filter((x) => x.sessionId !== 'lane-d-demo') })],
    ['an activity', (p) => ({ ...p, activities: p.activities.filter((a) => a.upstreamId !== 'agent-4') })],
    ['a lease with its lineage', (p) => {
      const gone = p.leases[2]!.leaseId;
      return { ...p, leases: p.leases.filter((l) => l.leaseId !== gone), lineage: p.lineage.filter((n) => n.leaseId !== gone) };
    }],
    ['an activity-owned lineage row', (p) => ({ ...p, lineage: p.lineage.filter((n) => n.activityId !== p.activities[2]!.activityId) })],
    ['an attempt', (p) => ({ ...p, attempts: p.attempts.filter((a) => a.attemptId !== 'attempt-3') })],
  ];
  it.each(cases)('R6: %s leaves: mode full, parity at once', (_label, make) => {
    const w = openWorld();
    const next = make(w.prior);
    expect(diffOf(w.prior, next).applicable, 'the pure diff declines').toBe(false);
    expect(changes(w.s, w.prior, next)).toEqual({ mode: 'full' });
    expectParity(w.s, next);
  });

  it('R6: a lease leaving alone (no lineage row, unreachable through a projected prior) is declined by the pure diff itself; MD3(leases) reds it', () => {
    const w = openWorld();
    const alone = leaseRow(9, w.prior.activities[0]!);
    expect(w.prior.lineage.some((n) => n.leaseId === alone.leaseId), 'the extra lease has no lineage row, so only the lease check can see it leave').toBe(false);
    const prior = { ...w.prior, leases: [...w.prior.leases, alone] };
    const next = { ...w.prior, leases: [...w.prior.leases] };
    expect(diffOf(prior, next).applicable, 'the pure diff declines: a lease left').toBe(false);
  });
});

// ── R7: any lease row or lease-lineage row that differs, is new or leaves ────────────────────────────────────────────────

describe('R7: a lease row or a lease-owned lineage row that differs, is new or leaves falls back, on the returned mode', () => {
  const cases: Array<[string, (p: DelegationCheckpointV1) => DelegationCheckpointV1]> = [
    ['a lease differs (a column assertWave3Lease leaves free)', (p) => ({ ...p, leases: p.leases.map((l, i) => (i === 0 ? { ...l, workspaceState: 'absent' } : l)) })],
    ['a lease is new (with its opening lineage row)', (p) => {
      const l4 = leaseRow(4, p.activities[3]!);
      return { ...p, appliedJournalSequence: 7, leases: [...p.leases, l4], lineage: [...p.lineage, openingRow('7', l4)] };
    }],
    ['a lease leaves (with its lineage)', (p) => {
      const gone = p.leases[1]!.leaseId;
      return { ...p, leases: p.leases.filter((l) => l.leaseId !== gone), lineage: p.lineage.filter((n) => n.leaseId !== gone) };
    }],
    ['a lease-owned lineage row differs', (p) => ({ ...p, lineage: p.lineage.map((n) => (n.lineageId === p.lineage[2]!.lineageId ? { ...n, closedAt: at(5), closeReason: 'lease-closed' } : n)) })],
    ['a lease-owned lineage row is new', (p) => ({ ...p, lineage: [...p.lineage, openingRow('8', p.leases[1]!, { openedAt: at(3) })] })],
    ['a lease-owned lineage row leaves (the lease keeps its opening row)', (p) => ({ ...p, lineage: p.lineage.filter((n) => n.lineageId !== p.lineage[2]!.lineageId) })],
    ['a lineage row whose leaseId goes non-null to null (the SECOND lease-owned row of a lease turns activity-owned)', (p) => ({ ...p,
      lineage: p.lineage.map((n) => (n.lineageId === p.lineage[2]!.lineageId ? { ...n, leaseId: null, activityId: p.activities[0]!.activityId } : n)) })],
    ['a lineage row whose leaseId goes null to non-null (an activity-owned row becomes a lease’s)', (p) => ({ ...p,
      lineage: p.lineage.map((n) => (n.lineageId === p.lineage[0]!.lineageId ? { ...n, activityId: null, leaseId: p.leases[1]!.leaseId } : n)) })],
  ];
  it.each(cases)('R7: %s: mode full, diff not applicable, parity', (_label, make) => {
    const w = openWorld();
    const next = make(w.prior);
    expect(diffOf(w.prior, next).applicable, 'the pure diff declines').toBe(false);
    expect(changes(w.s, w.prior, next)).toEqual({ mode: 'full' });
    expectParity(w.s, next);
  });
});

// ── R8, R9, R10: what the compare-and-swap and the count each catch ──────────────────────────────────────────────────────

describe('R8 / R9 / R10: the store half of the compare-and-swap and the count tripwire', () => {
  const leafActivity = (p: DelegationCheckpointV1): DelegationActivityRow => p.activities.find((a) => a.upstreamId === 'agent-4')!;
  const touchSession = (p: DelegationCheckpointV1): DelegationCheckpointV1 => ({ ...p,
    sessions: p.sessions.map((x, i) => (i === 0 ? { ...x, claudeSessionIds: [...x.claudeSessionIds, 'cs-new'] } : x)) });

  it('R8: a delete of activity X plus an insert of a stray Y in one parent keeps the counts equal; the update of X is refused naming the compare-and-swap miss', () => {
    const w = openWorld();
    const x = leafActivity(w.prior);
    w.raw.prepare('DELETE FROM delegation_activities WHERE activityId = ?').run(x.activityId);
    insertRaw(w.raw, delegationActivityCodec, delegationActivityCodec.toDb({ ...x, activityId: 'stray-activity', upstreamId: 'agent-stray' }));
    expect((w.raw.prepare('SELECT count(*) AS n FROM delegation_activities').get() as { n: number }).n, 'the counts are equal').toBe(w.prior.activities.length);
    const before = dumpAll(w.raw);
    const next = { ...w.prior, activities: w.prior.activities.map((a) => (a.activityId === x.activityId ? { ...a, lastEventAt: at(30) } : a)) };
    let thrown: unknown;
    try { changes(w.s, w.prior, next); } catch (e) { thrown = e; }
    expect(thrown, 'the delta refuses').toBeInstanceOf(DelegationModelError);
    const err = thrown as DelegationModelError;
    expect(err.code).toBe('projection-delta-mismatch');
    expect(err.message, 'names the table').toContain('delegation_activities');
    expect(err.message, 'names the key of the row that did not match').toContain(x.activityId);
    expect(err.message, 'a compare-and-swap miss').toMatch(/compare-and-swap changed/);
    expect(err.message, 'not the count tripwire\'s message').not.toMatch(/after the delta, expected/);
    expect(dumpAll(w.raw), 'SQLite after the call is SQLite before it').toEqual(before);
  });

  it('R9 (i): a stray out-of-band attempt trips the count on a delta that updates a session; SQLite is byte-identical', () => {
    const w = openWorld();
    insertRaw(w.raw, delegationAttemptCodec, delegationAttemptCodec.toDb(attemptRow('attempt-stray', 'lane-a-demo', 'g1')));
    const before = dumpAll(w.raw);
    let thrown: unknown;
    try { changes(w.s, w.prior, touchSession(w.prior)); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(DelegationModelError);
    const err = thrown as DelegationModelError;
    expect(err.code).toBe('projection-delta-mismatch');
    expect(err.message, 'names the table').toContain('delegation_attempts');
    expect(err.message, 'names the counts it measured').toContain(String(w.prior.attempts.length));
    expect(err.message, 'names the counts it measured').toContain(String(w.prior.attempts.length + 1));
    expect(dumpAll(w.raw), 'every delegation table, byte for byte').toEqual(before);
  });

  it('R9 (ii): a stray out-of-band attempt trips the count on an interval-only delta (zero rows); SQLite is byte-identical', () => {
    const w = openWorld();
    insertRaw(w.raw, delegationAttemptCodec, delegationAttemptCodec.toDb(attemptRow('attempt-stray', 'lane-a-demo', 'g1')));
    const before = dumpAll(w.raw);
    const intervalOnly: DelegationCheckpointV1 = { ...w.prior,
      observationIntervals: [{ sessionId: 'lane-a-demo', parentIncarnation: 'g1', utcHour: at(0), state: 'measured', detail: null, recordedAt: at(1) }] };
    let thrown: unknown;
    try { changes(w.s, w.prior, intervalOnly); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(DelegationModelError);
    const err = thrown as DelegationModelError;
    expect(err.code).toBe('projection-delta-mismatch');
    expect(err.message).toContain('delegation_attempts');
    expect(err.message).toContain(String(w.prior.attempts.length));
    expect(err.message).toContain(String(w.prior.attempts.length + 1));
    expect(dumpAll(w.raw)).toEqual(before);
  });

  // R10: the compare-and-swap's WHERE carries EVERY prior value, so an edit to a column the delta does not write is a miss too.
  const r10: Array<{ table: string; key: (p: DelegationCheckpointV1) => string; next: (p: DelegationCheckpointV1) => DelegationCheckpointV1; tamper: (p: DelegationCheckpointV1) => [string, unknown[]] }> = [
    { table: 'delegation_sessions', key: (p) => p.sessions[0]!.sessionId,
      next: touchSession,
      tamper: (p) => ['UPDATE delegation_sessions SET effective = 1 - effective WHERE sessionId = ? AND parentIncarnation = ?', [p.sessions[0]!.sessionId, p.sessions[0]!.parentIncarnation]] },
    { table: 'delegation_activities', key: (p) => p.activities[1]!.activityId,
      next: (p) => ({ ...p, activities: p.activities.map((a, i) => (i === 1 ? { ...a, lastEventAt: at(30) } : a)) }),
      tamper: (p) => ["UPDATE delegation_activities SET displayName = 'tampered' WHERE activityId = ?", [p.activities[1]!.activityId]] },
    { table: 'delegation_attempts', key: (p) => p.attempts[1]!.attemptId,
      next: (p) => ({ ...p, attempts: p.attempts.map((a, i) => (i === 1 ? { ...a, detail: 'changed' } : a)) }),
      tamper: (p) => ["UPDATE delegation_attempts SET project = 'tampered' WHERE attemptId = ?", [p.attempts[1]!.attemptId]] },
    { table: 'delegation_lineage', key: (p) => p.lineage[3]!.lineageId,
      next: (p) => ({ ...p, lineage: p.lineage.map((n, i) => (i === 3 ? { ...n, closeReason: 'changed' } : n)) }),
      tamper: (p) => ['UPDATE delegation_lineage SET openedAt = openedAt + 1 WHERE lineageId = ?', [p.lineage[3]!.lineageId]] },
  ];
  it.each(r10)('R10: another value in SQLite on a row the delta updates in $table is a compare-and-swap miss naming table and key; SQLite unchanged', (c) => {
    const w = openWorld();
    const [sql, args] = c.tamper(w.prior);
    w.raw.prepare(sql).run(...(args as never[]));
    const before = dumpAll(w.raw);
    let thrown: unknown;
    try { changes(w.s, w.prior, c.next(w.prior)); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(DelegationModelError);
    const err = thrown as DelegationModelError;
    expect(err.code).toBe('projection-delta-mismatch');
    expect(err.message).toContain(c.table);
    expect(err.message).toContain(c.key(w.prior));
    expect(dumpAll(w.raw)).toEqual(before);
  });
});

// ── R15: refusal parity ──────────────────────────────────────────────────────────────────────────────────────────────────

describe('R15: every checkpoint the full path refuses is refused by the delta with the same code and message, SQLite unchanged and no BEGIN', () => {
  const lease0 = (cp: DelegationCheckpointV1, f: (l: DelegationLeaseRow) => DelegationLeaseRow): DelegationCheckpointV1 =>
    ({ ...cp, leases: [f(cp.leases[0]!), ...cp.leases.slice(1)] });
  const withoutOpening = (cp: DelegationCheckpointV1, f: (n: DelegationLineageRow) => DelegationLineageRow | null): DelegationCheckpointV1 => {
    // The first lease's lease-owned rows are the opening row and its twin; both must change for the lease to lose its opening.
    const id = cp.leases[0]!.leaseId;
    return { ...cp, lineage: cp.lineage.flatMap((n) => (n.leaseId === id ? (f(n) === null ? [] : [f(n)!]) : [n])) };
  };
  const cases: Array<[string, (cp: DelegationCheckpointV1) => DelegationCheckpointV1, string]> = [
    ['a nonzero generation', (cp) => lease0(cp, (l) => ({ ...l, generation: 1 })), 'lease-generation'],
    ['unequal creating and current sequences at generation 0', (cp) => lease0(cp, (l) => ({ ...l, currentJournalSequence: l.creatingJournalSequence + 1 })), 'lease-sequences'],
    ['a non-ephemeral disposition', (cp) => lease0(cp, (l) => ({ ...l, disposition: 'retained' })), 'lease-disposition'],
    ['a cleanup state other than not-due', (cp) => lease0(cp, (l) => ({ ...l, cleanupState: 'pending' })), 'lease-cleanup-state'],
    ['a transition clock', (cp) => lease0(cp, (l) => ({ ...l, adoptedAt: at(9) })), 'lease-transition-field'],
    ['transition evidence', (cp) => lease0(cp, (l) => ({ ...l, cleanupEvidenceJson: '{}' })), 'lease-transition-field'],
    ['a carrier generation', (cp) => lease0(cp, (l) => ({ ...l, carrierGenerationSeen: 1 })), 'lease-transition-field'],
    ['a release', (cp) => lease0(cp, (l) => ({ ...l, releasedAt: at(9) })), 'lease-transition-field'],
    ['a lastObservedAt that is not its firstObservedAt', (cp) => lease0(cp, (l) => ({ ...l, lastObservedAt: at(9) })), 'lease-last-observed'],
    ['an event-less lease (its creating sequence is past the applied journal)', (cp) => lease0(cp, (l) => ({ ...l, creatingJournalSequence: 7, currentJournalSequence: 7 })), 'lease-without-journal-entry'],
    ['no opening lineage row at all', (cp) => withoutOpening(cp, () => null), 'lease-opening-lineage'],
    ['opening rows opened at another instant', (cp) => withoutOpening(cp, (n) => ({ ...n, openedAt: at(9) })), 'lease-opening-lineage'],
    ['activity-owned rows standing in for the lease’s own', (cp) => withoutOpening(cp, (n) => ({ ...n, leaseId: null, activityId: cp.activities[0]!.activityId })), 'lease-opening-lineage'],
    ['a session list a projection could not read back', (cp) => ({ ...cp,
      sessions: [{ ...cp.sessions[0]!, effectiveBasis: ['made-up'] as unknown as DelegationSessionRow['effectiveBasis'] }, ...cp.sessions.slice(1)] }), 'bad-row'],
    ['a session key repeated, identically', (cp) => ({ ...cp, sessions: [...cp.sessions, cp.sessions[0]!] }), 'bad-checkpoint'],
    ['a session key repeated with other content', (cp) => ({ ...cp,
      sessions: [cp.sessions[0]!, { ...cp.sessions[0]!, claudeSessionIds: ['other'], lastObservedAt: at(25) }, ...cp.sessions.slice(1)] }), 'bad-checkpoint'],
    // Doubly corrupt: the full path walks sessions, activities, attempts, leases, lineage in that order and the first it cannot encode
    // decides. A table the diff declines (a repeat, a leave) is not encoded by the diff, so the delta must hand the whole answer to the full path.
    ['a session key repeated, the repeat carrying a malformed instant', (cp) => ({ ...cp,
      sessions: [cp.sessions[0]!, { ...cp.sessions[0]!, firstObservedAt: '2026-10-14 00:00:00' }, ...cp.sessions.slice(1)] }), 'bad-instant'],
    ['a session that leaves, a session in next that cannot encode, and a new activity that cannot encode', (cp) => ({ ...cp,
      sessions: [{ ...cp.sessions[0]!, effectiveBasis: ['made-up'] as unknown as DelegationSessionRow['effectiveBasis'] }, ...cp.sessions.slice(1, 3)],
      activities: [...cp.activities, activityRow(12, natural('lane-a-demo', 'g1', 'agent', 'agent-12'), { openedAt: '2026-10-14 00:00:00' })] }), 'bad-row'],
    ['a checkpoint that is not version 1', (cp) => ({ ...cp, v: 2 as unknown as 1 }), 'bad-checkpoint'],
    ['a negative applied sequence', (cp) => ({ ...cp, appliedJournalSequence: -1 }), 'bad-checkpoint'],
    ['a fractional applied sequence', (cp) => ({ ...cp, appliedJournalSequence: 1.5 }), 'bad-checkpoint'],
    ['a malformed instant', (cp) => ({ ...cp, sessions: [{ ...cp.sessions[0]!, firstObservedAt: '2026-10-14 00:00:00' }, ...cp.sessions.slice(1)] }), 'bad-instant'],
    ['(i) a lower applied position with the leases shared by reference', (cp) => ({ ...cp, appliedJournalSequence: 3 }), 'lease-without-journal-entry'],
  ];
  /** What the FULL path throws for `next` on a twin of the world (a fresh store, the same prior projected), so the delta is held to the
   *  full path's own code and message and not only to the codes typed in this file. */
  const fullPathRefusal = (next: DelegationCheckpointV1, foreignKeysOff = false): DelegationModelError => {
    const twin = openWorld();
    if (foreignKeysOff) twin.raw.exec('PRAGMA foreign_keys = OFF');
    let thrown: unknown;
    try { twin.s.projectDelegationCheckpoint(next); } catch (e) { thrown = e; }
    expect(thrown, 'the full path refuses this checkpoint too').toBeInstanceOf(DelegationModelError);
    return thrown as DelegationModelError;
  };
  const sameRefusal = (delta: unknown, full: DelegationModelError): void => {
    expect(delta, 'the delta refuses with a DelegationModelError').toBeInstanceOf(DelegationModelError);
    expect((delta as DelegationModelError).code, 'the same code as the full path').toBe(full.code);
    expect((delta as DelegationModelError).message, 'the same message as the full path').toBe(full.message);
  };
  it.each(cases)('R15: %s is refused with the full path’s code and message', (_label, make, code) => {
    const w = openWorld();
    const before = dumpAll(w.raw);
    const next = make(w.prior);
    refusedWith(() => changes(w.s, w.prior, next), code);
    expect(dumpAll(w.raw), 'nothing written').toEqual(before);
    expect(beginsOf(w.t), 'refused before BEGIN').toEqual([]);
    expect(w.t.log, 'no delegation statement ran').toEqual([]);
    // in addition to the fixed code above: the twin's full path says the same, word for word
    const full = fullPathRefusal(next);
    expect(full.code, 'the full path\'s code is the fixed one').toBe(code);
    let thrown: unknown;
    try { changes(w.s, w.prior, next); } catch (e) { thrown = e; }
    sameRefusal(thrown, full);
  });

  it('R15 (ii): foreign keys off, run as an APPLICABLE delta (fixture 0 to fixture 1 share every lease and lease-owned lineage row), is refused foreign-keys-off before BEGIN', () => {
    const w = openWorld();
    const next = w.fx(1);
    expect(diffOf(w.prior, next).applicable, 'the two fixtures differ only in rows a delta may write').toBe(true);
    const before = dumpAll(w.raw);
    w.raw.exec('PRAGMA foreign_keys = OFF');
    try {
      refusedWith(() => changes(w.s, w.prior, next), 'foreign-keys-off');
      expect(dumpAll(w.raw)).toEqual(before);
      expect(beginsOf(w.t)).toEqual([]);
      expect(w.t.log).toEqual([]);
      let thrown: unknown;
      try { changes(w.s, w.prior, next); } catch (e) { thrown = e; }
      sameRefusal(thrown, fullPathRefusal(next, true));
    } finally {
      w.raw.exec('PRAGMA foreign_keys = ON');
    }
    expect(changes(w.s, w.prior, next).mode, 'with foreign keys on it is a delta').toBe('delta');
    expectParity(w.s, next);
  });

  // A next the diff declines is the full path's to answer whole, its own foreign-keys check included, so the delta's check (which
  // guards its own writes) must not answer first. Each case's full path says something other than foreign-keys-off.
  it.each(cases.filter(([label]) => /repeated|that leaves/.test(label)))('R15 (iii): foreign keys off, %s (not a delta): the full path’s code and message, not foreign-keys-off', (_label, make, code) => {
    const w = openWorld();
    const next = make(w.prior);
    expect(diffOf(w.prior, next).applicable, 'the pure diff declines').toBe(false);
    const before = dumpAll(w.raw);
    w.raw.exec('PRAGMA foreign_keys = OFF');
    try {
      const full = fullPathRefusal(next, true);
      expect(full.code, 'the full path decides before its own foreign-keys check').toBe(code);
      let thrown: unknown;
      try { changes(w.s, w.prior, next); } catch (e) { thrown = e; }
      sameRefusal(thrown, full);
      expect(dumpAll(w.raw)).toEqual(before);
      expect(beginsOf(w.t)).toEqual([]);
    } finally {
      w.raw.exec('PRAGMA foreign_keys = ON');
    }
  });
});

// ── R16: one generated case per codec column ─────────────────────────────────────────────────────────────────────────────

type Sql = DelegationSqlValue;
interface LooseCodec {
  readonly table: string;
  readonly columns: readonly string[];
  toDb(row: never): Readonly<Record<string, Sql>>;
  fromDb(raw: Readonly<Record<string, unknown>>): unknown;
}
type Field = 'sessions' | 'attempts' | 'activities' | 'leases' | 'lineage';
interface TableSpec { field: Field; codec: LooseCodec; key: readonly string[] }
/** The five projected tables, their codecs and their primary keys. The COLUMNS come from `codec.columns`; only the keys (which the
 *  diff keys its rows by) are named here, and each is checked to be a column of its codec. */
const TABLES: readonly TableSpec[] = [
  { field: 'sessions', codec: delegationSessionCodec as unknown as LooseCodec, key: ['sessionId', 'parentIncarnation'] },
  { field: 'activities', codec: delegationActivityCodec as unknown as LooseCodec, key: ['activityId'] },
  { field: 'attempts', codec: delegationAttemptCodec as unknown as LooseCodec, key: ['attemptId'] },
  { field: 'leases', codec: delegationLeaseCodec as unknown as LooseCodec, key: ['leaseId'] },
  { field: 'lineage', codec: delegationLineageCodec as unknown as LooseCodec, key: ['lineageId'] },
];
const encodeRow = (codec: LooseCodec, row: unknown): Readonly<Record<string, Sql>> => codec.toDb(row as never);
const rowsOf = (cp: DelegationCheckpointV1, field: Field): readonly unknown[] => cp[field];
const replaceRow = (cp: DelegationCheckpointV1, field: Field, idx: number, row: unknown): DelegationCheckpointV1 =>
  ({ ...cp, [field]: rowsOf(cp, field).map((r, i) => (i === idx ? row : r)) } as DelegationCheckpointV1);

/** The lease columns `assertWave3Lease` leaves free, and those it pins: the task's own expectation, typed. R16 measures each column's
 *  outcome on a twin store and asserts it is the category named here, so a lease column added to the codec (or a guard that moves) is a
 *  red case that asks for a decision, never a silent skip. `leaseId` is the lease table's key. */
const LEASE_FREE: ReadonlySet<string> = new Set(['activityId', 'parentId', 'parentIncarnation', 'project', 'adminRecord', 'canonicalPath', 'creationBase',
  'sourceKind', 'parentageState', 'workspaceState', 'cleanupPopulation']);
const LEASE_PINNED: ReadonlySet<string> = new Set(['generation', 'creatingJournalSequence', 'currentJournalSequence', 'disposition', 'cleanupState',
  'terminalEvidenceAt', 'adoptedAt', 'retainedAt', 'promotedAt', 'cleanupDueAt', 'cleanupStartedAt', 'cleanupFinishedAt', 'cleanupEvidenceJson',
  'carrierGenerationSeen', 'releasedAt', 'lastObservedAt', 'firstObservedAt']);
/** Columns for which NO valid change exists, with the reason; each has its own case below, so none is skipped silently. */
const UNCHANGEABLE: Readonly<Record<string, string>> = {
  'delegation_leases.cleanupPopulation': `its vocabulary holds ${DELEGATION_CLEANUP_POPULATIONS.length} word and the table's CHECK pins that word, so the codec can write no other and read none back`,
};

type Outcome = { kind: 'ok' } | { kind: 'refused'; code: string } | { kind: 'invalid' };
let twinWorld: World | null = null;
const twin = (): World => (twinWorld ??= openWorld());
/** What the FULL projection does with `next`, measured on a twin store (reset to `prior` after a success). `invalid` is an SQLite
 *  refusal (a CHECK, a unique index, a foreign key): the candidate is not a value the table can hold. */
const probe = (next: DelegationCheckpointV1): Outcome => {
  const tw = twin();
  try {
    tw.s.projectDelegationCheckpoint(next);
    tw.s.projectDelegationCheckpoint(tw.prior);
    return { kind: 'ok' };
  } catch (e) {
    return e instanceof DelegationModelError ? { kind: 'refused', code: e.code } : { kind: 'invalid' };
  }
};

const VOCABULARY: readonly Sql[] = [
  ...DELEGATION_ACTIVITY_SOURCE_KINDS, ...DELEGATION_LEASE_SOURCE_KINDS, ...DELEGATION_EXECUTION_STATES, ...DELEGATION_PARENTAGE_STATES,
  ...DELEGATION_WORKSPACE_STATES, ...DELEGATION_DISPOSITIONS, ...DELEGATION_CLEANUP_STATES, ...DELEGATION_CLEANUP_POPULATIONS,
  ...DELEGATION_ATTEMPT_VERDICTS,
];
interface Pool { all: Sql[]; byColumn: ReadonlyMap<string, Sql[]> }
const poolOf = (cp: DelegationCheckpointV1): Pool => {
  const all = new Set<Sql>();
  const byColumn = new Map<string, Set<Sql>>();
  for (const spec of TABLES) {
    for (const row of rowsOf(cp, spec.field)) {
      for (const [c, v] of Object.entries(encodeRow(spec.codec, row))) {
        all.add(v);
        byColumn.set(c, (byColumn.get(c) ?? new Set<Sql>()).add(v));
      }
    }
  }
  return { all: [...all], byColumn: new Map([...byColumn].map(([c, vs]) => [c, [...vs]])) };
};
/** Values to try for the column `col` holding `cur`, nearest first: a neighbour of the same type, the usual small literals, every value
 *  another row holds in a column of that name (so a foreign key can point at a parent that exists), every other value any row holds,
 *  then the vocabulary. Each is filtered by the codec's own reader and the full projection, so what survives is a value the table
 *  writes. */
const candidatesFor = (col: string, cur: Sql, pool: Pool): Sql[] => {
  const derived: Sql[] = typeof cur === 'number' ? [cur + 60_000, cur - 60_000, cur + 1, cur - 1] : typeof cur === 'string' ? [`${cur}-x`] : [];
  const extras: Sql[] = [null, 1, 2, 3, 4, 5, 'x', '[]', '["cs-x"]'];
  return [...new Set<Sql>([...derived, ...extras, ...(pool.byColumn.get(col) ?? []), ...pool.all, ...VOCABULARY])].filter((v) => v !== cur);
};
interface Found { idx: number; value: Sql; next: DelegationCheckpointV1; outcome: Outcome }
/** The first change of EXACTLY column `col` (on one of `rows`, through the codec's reader) whose full-projection outcome `accept`s. */
const findChange = (
  prior: DelegationCheckpointV1, spec: TableSpec, rows: readonly number[], col: string, accept: (o: Outcome) => boolean,
  fixup?: (next: DelegationCheckpointV1, oldRow: unknown, newRow: unknown) => DelegationCheckpointV1,
): Found | null => {
  expect(prior, 'the twin store the full path is probed on mints the same run ids as this world, so its fixture is this world\'s').toEqual(twin().prior);
  const pool = poolOf(prior);
  for (const idx of rows) {
    const row = rowsOf(prior, spec.field)[idx];
    const enc = encodeRow(spec.codec, row);
    for (const value of candidatesFor(col, enc[col]!, pool)) {
      let changed: unknown;
      try { changed = spec.codec.fromDb({ ...enc, [col]: value }); } catch { continue; }
      const re = encodeRow(spec.codec, changed);
      if (re[col] !== value || spec.codec.columns.some((c) => c !== col && re[c] !== enc[c])) continue;
      let next = replaceRow(prior, spec.field, idx, changed);
      if (fixup !== undefined) next = fixup(next, row, changed);
      const outcome = probe(next);
      if (accept(outcome)) return { idx, value, next, outcome };
    }
  }
  return null;
};
const indexWhere = <T>(rows: readonly T[], pred: (r: T) => boolean): number[] => rows.flatMap((r, i) => (pred(r) ? [i] : []));
const all = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** Which rows a column's case may change. A key moves only on a LEAF (nothing points at the row), so the full fallback's foreign keys
 *  hold; a lineage row is changed in place only when it is not lease-owned. */
const rowsFor = (prior: DelegationCheckpointV1, spec: TableSpec, col: string): number[] => {
  const isKey = spec.key.includes(col);
  switch (spec.field) {
    case 'sessions': return isKey ? indexWhere(prior.sessions, (x) => x.sessionId === 'lane-d-demo') : all(prior.sessions.length);
    case 'activities': return isKey ? indexWhere(prior.activities, (a) => a.upstreamId === 'agent-4') : all(prior.activities.length);
    case 'attempts': return all(prior.attempts.length);
    case 'leases': return all(prior.leases.length);
    case 'lineage': return col === 'leaseId' ? all(prior.lineage.length) : indexWhere(prior.lineage, (n) => n.leaseId === null);
  }
};
/** A lease's key moving carries its lineage rows with it (they name the lease), as the full path's foreign keys require. */
const followLease = (next: DelegationCheckpointV1, oldRow: unknown, newRow: unknown): DelegationCheckpointV1 => {
  const from = (oldRow as DelegationLeaseRow).leaseId;
  const to = (newRow as DelegationLeaseRow).leaseId;
  return { ...next, lineage: next.lineage.map((n) => (n.leaseId === from ? { ...n, leaseId: to } : n)) };
};

type Category = 'a' | 'b' | 'c' | 'd' | 'none';
const categoryOf = (spec: TableSpec, col: string): Category => {
  if (spec.field === 'leases') return spec.key.includes(col) ? 'b' : LEASE_FREE.has(col) ? 'c' : LEASE_PINNED.has(col) ? 'd' : 'none';
  if (spec.key.includes(col) || (spec.field === 'lineage' && col === 'leaseId')) return 'b';
  return 'a';
};
const TITLE: Readonly<Record<Category, string>> = {
  a: 'a non-key column writes exactly that one row (one UPDATE on its table, nothing else)',
  b: 'a key column (or lineage.leaseId) falls back: mode full',
  c: 'a lease column assertWave3Lease leaves free falls back: mode full',
  d: 'a lease column assertWave3Lease pins is refused with the full path’s code, before BEGIN',
  none: 'IS NOT CLASSIFIED: add it to the free or the pinned list with its reason',
};

describe('R16: one generated case per codec column', () => {
  it('R16: every key named here is a column of its codec', () => {
    for (const spec of TABLES) expect(spec.codec.columns, spec.codec.table).toEqual(expect.arrayContaining([...spec.key]));
    expect(TABLES.map((s) => s.codec.table)).toEqual(['delegation_sessions', 'delegation_activities', 'delegation_attempts', 'delegation_leases', 'delegation_lineage']);
    // At main the codecs hold their columns but nothing can write a delta: probe the store method itself so this case is red there.
    const w = openWorld();
    expect(changes(w.s, w.prior, w.prior), 'an identical next is a zero-row delta').toEqual({ mode: 'delta', rows: 0 });
  });

  for (const spec of TABLES) {
    for (const col of spec.codec.columns) {
      const cat = categoryOf(spec, col);
      const name = `${spec.codec.table}.${col}`;
      if (UNCHANGEABLE[name] !== undefined) continue;
      it(`R16 (${cat}): ${name} ${TITLE[cat]}`, () => {
        expect(cat, `${name} is not classified`).not.toBe('none');
        const w = openWorld();
        const wantOutcome = cat === 'd' ? (o: Outcome) => o.kind === 'refused' : (o: Outcome) => o.kind === 'ok';
        const found = findChange(w.prior, spec, rowsFor(w.prior, spec, col), col, wantOutcome, spec.field === 'leases' && col === 'leaseId' ? followLease : undefined);
        expect(found, `a ${cat === 'd' ? 'refused' : 'valid'} change of ${name} exists in the fixture (else list it in UNCHANGEABLE with its reason)`).not.toBeNull();
        const { next, outcome } = found!;
        const before = dumpAll(w.raw);
        if (cat === 'a') {
          expect(changes(w.s, w.prior, next)).toEqual({ mode: 'delta', rows: 1 });
          expect(w.t.words(), 'exactly one UPDATE, on that table, and nothing else written').toEqual([`update ${spec.codec.table}`]);
          expectParity(w.s, next);
        } else if (cat === 'b' || cat === 'c') {
          expect(diffOf(w.prior, next).applicable, 'the pure diff declines').toBe(false);
          expect(changes(w.s, w.prior, next)).toEqual({ mode: 'full' });
          expectParity(w.s, next);
        } else {
          expect(outcome.kind).toBe('refused');
          refusedWith(() => changes(w.s, w.prior, next), (outcome as { code: string }).code);
          expect(dumpAll(w.raw)).toEqual(before);
          expect(beginsOf(w.t), 'refused before BEGIN').toEqual([]);
        }
      }, 120_000);
    }
  }

  it('R16 (d\'): a lease differing in disposition alone is declined by the pure diff (the store refuses it earlier); MD8 on disposition reds it', () => {
    const w = openWorld();
    const lease = w.prior.leases[0]!;
    const other = DELEGATION_DISPOSITIONS.find((d) => d !== lease.disposition)!;
    const next = { ...w.prior, leases: w.prior.leases.map((l, i) => (i === 0 ? { ...l, disposition: other } : { ...l })) };
    expect(next.leases[0], 'the pair differs in disposition and in no other column').toEqual({ ...lease, disposition: other });
    expect(diffOf(w.prior, next).applicable, 'the pure diff declines').toBe(false);
  });

  for (const [name, reason] of Object.entries(UNCHANGEABLE)) {
    it(`R16 (e): ${name} cannot be changed validly (${reason}); a forced value falls back and the schema refuses it`, () => {
      expect(DELEGATION_CLEANUP_POPULATIONS.length, 'a larger vocabulary makes this column changeable: remove it from UNCHANGEABLE and the generated cases take it').toBe(1);
      const [table, col] = name.split('.') as [string, string];
      const spec = TABLES.find((t) => t.codec.table === table)!;
      const w = openWorld();
      expect(w.prior, 'the twin store the full path is probed on mints the same run ids as this world').toEqual(twin().prior);
      const forced = replaceRow(w.prior, spec.field, 0, { ...(rowsOf(w.prior, spec.field)[0] as object), [col]: 'other-population' });
      expect(probe(forced), 'the full path itself refuses it, in SQLite').toEqual({ kind: 'invalid' });
      const before = dumpAll(w.raw);
      expect(() => changes(w.s, w.prior, forced), 'the fallback reaches the full path, and the schema’s CHECK refuses').toThrow(/CHECK/);
      expect(dumpAll(w.raw)).toEqual(before);
    });
  }
});

// ── R17: rows written, not time ──────────────────────────────────────────────────────────────────────────────────────────

describe('R17: an intent-change shaped next writes one session row; an interval-only next writes none', () => {
  it('R17: structuredClone of prior with one session’s intent and basis changed (every reference new) is { delta, 1 } and one UPDATE', () => {
    const w = openWorld();
    const declared = declareCoordinatorIntent(w.prior, { action: 'set', sessionId: 'lane-b-demo', parentIncarnation: 'g1', declaredAt: at(30) });
    const next = structuredClone(declared);
    expect(next.sessions[2], 'every reference is new').not.toBe(w.prior.sessions[2]);
    expect(next.sessions[2]!.explicitIntentAt).toBe(at(30));
    const diff = diffOf(w.prior, next);
    expect(diff.applicable).toBe(true);
    if (diff.applicable) {
      expect(diff.updates.map((u) => u.table), 'one changed row in the diff').toEqual(['delegation_sessions']);
      expect(diff.inserts).toEqual([]);
    }
    expect(changes(w.s, w.prior, next)).toEqual({ mode: 'delta', rows: 1 });
    expect(w.t.words(), '1 session row and 0 others').toEqual(['update delegation_sessions']);
    expectParity(w.s, next);
  });

  it('R17: an interval-only next (only observationIntervals differs) is { delta, 0 } and writes no row', () => {
    const w = openWorld();
    const next = structuredClone({ ...w.prior,
      observationIntervals: [{ sessionId: 'lane-a-demo', parentIncarnation: 'g1', utcHour: at(0), state: 'measured' as const, detail: null, recordedAt: at(1) }] });
    const diff = diffOf(w.prior, next);
    expect(diff.applicable).toBe(true);
    if (diff.applicable) {
      expect(diff.updates).toEqual([]);
      expect(diff.inserts).toEqual([]);
      expect([...diff.counts].sort((p, q) => p.table.localeCompare(q.table)), 'next’s per-table lengths, five entries').toEqual([
        { table: 'delegation_activities', count: next.activities.length }, { table: 'delegation_attempts', count: next.attempts.length },
        { table: 'delegation_leases', count: next.leases.length }, { table: 'delegation_lineage', count: next.lineage.length },
        { table: 'delegation_sessions', count: next.sessions.length },
      ]);
    }
    expect(changes(w.s, w.prior, next)).toEqual({ mode: 'delta', rows: 0 });
    expect(w.t.log, 'no delegation row written').toEqual([]);
    expectParity(w.s, next);
  });
});

// ── R18: parents first ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('R18: a new session and its first activity in one delta insert the session first', () => {
  const newSession = sessionRow('lane-e-demo', 'g1', { explicitIntentAt: at(10), effective: true, effectiveBasis: ['explicit'], firstObservedAt: at(10), lastObservedAt: at(10) });
  const newActivity = activityRow(11, natural('lane-e-demo', 'g1', 'agent', 'agent-e'), { openedAt: at(10), lastEventAt: at(10) });
  it('R18: the activity INSERT follows its session’s, and parity holds', () => {
    const w = openWorld();
    const next: DelegationCheckpointV1 = { ...w.prior, sessions: [...w.prior.sessions, newSession], activities: [...w.prior.activities, newActivity] };
    const diff = diffOf(w.prior, next);
    expect(diff.applicable).toBe(true);
    if (diff.applicable) expect(diff.inserts.map((i) => i.table), 'inserts ordered parents first').toEqual(['delegation_sessions', 'delegation_activities']);
    expect(changes(w.s, w.prior, next)).toEqual({ mode: 'delta', rows: 2 });
    expect(w.t.words(), 'the trace order is the foreign-key order').toEqual(['insert delegation_sessions', 'insert delegation_activities']);
    expectParity(w.s, next);
  });

  it('R18: a new session with a new activity, attempt and activity-owned lineage row inserts sessions, activities, attempts, lineage', () => {
    const w = openWorld();
    const next: DelegationCheckpointV1 = { ...w.prior,
      // Listed child-first on purpose: the order of the trace is the delta's, not the checkpoint's.
      lineage: [lineageRow('9', 'lane-e-demo', 'g1', { activityId: newActivity.activityId }), ...w.prior.lineage],
      attempts: [attemptRow('attempt-e', 'lane-e-demo', 'g1'), ...w.prior.attempts],
      activities: [newActivity, ...w.prior.activities], sessions: [newSession, ...w.prior.sessions] };
    expect(changes(w.s, w.prior, next)).toEqual({ mode: 'delta', rows: 4 });
    expect(w.t.words()).toEqual(['insert delegation_sessions', 'insert delegation_activities', 'insert delegation_attempts', 'insert delegation_lineage']);
    expectParity(w.s, next);
  });
});

describe('R18 (ii): an update onto a parent that is new in the same delta inserts the parent first', () => {
  const newSession = sessionRow('lane-e-demo', 'g1', { explicitIntentAt: at(10), effective: true, effectiveBasis: ['explicit'], firstObservedAt: at(10), lastObservedAt: at(10) });
  it('R18 (ii): an attempt whose parent moves to a session that is new in next is a delta, the session INSERT first, and parity holds', () => {
    const w = openWorld();
    const next: DelegationCheckpointV1 = { ...w.prior, sessions: [...w.prior.sessions, newSession],
      attempts: w.prior.attempts.map((a) => (a.attemptId === 'attempt-2' ? { ...a, parentId: 'lane-e-demo', parentIncarnation: 'g1' } : a)) };
    expect(changes(w.s, w.prior, next)).toEqual({ mode: 'delta', rows: 2 });
    expect(w.t.words(), 'the new parent is inserted before the row that points at it is updated').toEqual(['insert delegation_sessions', 'update delegation_attempts']);
    expectParity(w.s, next);
  });

  it('R18 (ii): an activity-owned lineage row whose activity moves to an activity that is new in next is a delta, the activity INSERT first, and parity holds', () => {
    const w = openWorld();
    const newActivity = activityRow(13, natural('lane-a-demo', 'g1', 'agent', 'agent-13'), { openedAt: at(10), lastEventAt: at(10) });
    const next: DelegationCheckpointV1 = { ...w.prior, activities: [...w.prior.activities, newActivity],
      lineage: w.prior.lineage.map((n) => (n.activityId === w.prior.activities[0]!.activityId && n.leaseId === null ? { ...n, activityId: newActivity.activityId } : n)) };
    expect(changes(w.s, w.prior, next)).toEqual({ mode: 'delta', rows: 2 });
    expect(w.t.words()).toEqual(['insert delegation_activities', 'update delegation_lineage']);
    expectParity(w.s, next);
  });
});

// ── R21: rows written do not scale with the table ────────────────────────────────────────────────────────────────────────

describe('R21: the rows a delta writes do not scale with the table', () => {
  /** `n` activities spread over 20 sessions, a few attempts and activity-owned lineage rows, projected by the FULL path. */
  const synthetic = (n: number): DelegationCheckpointV1 => {
    const sessions = Array.from({ length: 20 }, (_, i) => sessionRow(`lane-${i}`, 'g1', { lastObservedAt: at(10) }));
    const activities = Array.from({ length: n }, (_, i) => activityRow(1, natural(`lane-${i % 20}`, 'g1', 'agent', `agent-${i}`), { activityId: `act-${i}` }));
    return { ...fixture([1, 2], 0), sessions, activities, attempts: Array.from({ length: 10 }, (_, i) => attemptRow(`attempt-${i}`, `lane-${i}`, 'g1')),
      leases: [], activityIdsByNaturalKey: {}, coordinatorIntentByParent: {},
      lineage: Array.from({ length: 5 }, (_, i) => lineageRow(`s${i}`, `lane-${i}`, 'g1', { activityId: `act-${i}` })) };
  };
  /** A FIXED set on top of any size: 5 activities and 2 sessions touched; 1 session, 3 activities, 2 attempts and 1 lineage row new. */
  const FIXED_WRITES = 5 + 2 + 1 + 3 + 2 + 1;
  const bump = (prior: DelegationCheckpointV1): DelegationCheckpointV1 => {
    const fresh = sessionRow('lane-new', 'g1', {});
    const acts = [0, 1, 2].map((i) => activityRow(1, natural('lane-new', 'g1', 'agent', `agent-new-${i}`), { activityId: `act-new-${i}` }));
    return { ...prior,
      sessions: [...prior.sessions.map((x, i) => (i < 2 ? { ...x, lastObservedAt: at(40) } : x)), fresh],
      activities: [...prior.activities.map((a, i) => (i < 5 ? { ...a, lastEventAt: at(30) } : a)), ...acts],
      attempts: [...prior.attempts, attemptRow('attempt-new-0', 'lane-new', 'g1'), attemptRow('attempt-new-1', 'lane-new', 'g1')],
      lineage: [...prior.lineage, lineageRow('new', 'lane-new', 'g1', { activityId: acts[0]!.activityId })] };
  };
  const writesAt = (n: number, clone: boolean): { writes: number; result: ChangesResult } => {
    const o = openStore();
    const prior = synthetic(n);
    o.s.projectDelegationCheckpoint(prior);
    o.t.reset();
    const next = clone ? structuredClone(bump(prior)) : bump(prior);
    const result = changes(o.s, prior, next);
    expect(canon(o.s.readDelegationProjection()), `parity at ${n}${clone ? ' (every reference new)' : ''}`).toBe(canon(model.projectionViewOfDelegationCheckpoint(next)));
    return { writes: o.t.log.length, result };
  };
  it('R21: the same fixed touched-and-new rows write the same number of statements at 1k and at 20k activities, shared references or all new', () => {
    const seen = [[1_000, false], [20_000, false], [1_000, true], [20_000, true]].map(([n, clone]) => ({ n, clone, ...writesAt(n as number, clone as boolean) }));
    for (const r of seen) expect(r.result, `${String(r.n)} activities${r.clone ? ', cloned' : ''}`).toEqual({ mode: 'delta', rows: FIXED_WRITES });
    expect(seen.map((r) => r.writes), 'identical at every size, and exactly the fixed set').toEqual(seen.map(() => FIXED_WRITES));
  }, 240_000);
});

// ── R24: a fault at each statement ───────────────────────────────────────────────────────────────────────────────────────

describe('R24: a fault at every statement of a multi-row delta leaves SQLite unchanged', () => {
  /** Updates in all four non-lease tables and an insert in each, so every statement kind and table is on the list. */
  const multi = (p: DelegationCheckpointV1): DelegationCheckpointV1 => {
    const e = sessionRow('lane-e-demo', 'g1', { firstObservedAt: at(10), lastObservedAt: at(10) });
    const a = activityRow(11, natural('lane-e-demo', 'g1', 'agent', 'agent-e'), { openedAt: at(10), lastEventAt: at(10) });
    return { ...p,
      sessions: [...p.sessions.map((x, i) => (i === 1 ? { ...x, claudeSessionIds: ['cs-new'] } : x)), e],
      activities: [...p.activities.map((x, i) => (i === 1 ? { ...x, lastEventAt: at(30) } : x)), a],
      attempts: [...p.attempts.map((x, i) => (i === 1 ? { ...x, detail: 'changed' } : x)), attemptRow('attempt-e', 'lane-e-demo', 'g1')],
      lineage: [...p.lineage.map((x, i) => (i === 3 ? { ...x, closeReason: 'changed' } : x)), lineageRow('e', 'lane-e-demo', 'g1', { activityId: a.activityId })] };
  };
  it('R24: the fault list is non-empty, covers every statement the un-faulted run executed, and each fault rolls back', () => {
    const clean = openWorld();
    const next = multi(clean.prior);
    expect(changes(clean.s, clean.prior, next)).toEqual({ mode: 'delta', rows: 8 });
    const list = clean.t.words();
    expect(list.length, 'a multi-row delta writes several statements').toBeGreaterThan(0);
    for (const word of ['update delegation_sessions', 'update delegation_activities', 'update delegation_attempts', 'update delegation_lineage',
      'insert delegation_sessions', 'insert delegation_activities', 'insert delegation_attempts', 'insert delegation_lineage']) {
      expect(list, word).toContain(word);
    }
    const w = openWorld();
    const before = dumpAll(w.raw);
    const faulted: string[] = [];
    for (let i = 0; i < list.length; i++) {
      w.t.failAt(i);
      expect(() => changes(w.s, w.prior, next), `fault at ${i} (${list[i]})`).toThrow('injected fault');
      faulted.push(w.t.words()[i]!);
      expect(dumpAll(w.raw), `rolled back after a fault at ${i} (${list[i]})`).toEqual(before);
    }
    expect(faulted, 'every statement of the un-faulted run was faulted in turn').toEqual(list);
    w.t.failAt(null);
    expect(changes(w.s, w.prior, next), 'the same delta then succeeds').toEqual({ mode: 'delta', rows: 8 });
    expect(w.t.words()).toEqual(list);
    expectParity(w.s, next);
  });
});
