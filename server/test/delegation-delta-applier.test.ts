// The delta projection, APPLIER side: `DelegationDurability` with a projection port that has a FOURTH member, `projectChanged(prior, next)`.
// `projectLocked` calls it when its witness holds (`projectedRevision === prior.revision`), AFTER its unchanged stale branch, and keeps
// `project(checkpoint)` for the stale branch's repair, the per-session heal, the wipe, recovery and a bare `repairProjection()`. The store
// side (the pure diff and `CoordStore.projectDelegationCheckpointChanges`) is pinned in `delegation-delta-projection.test.ts`.
//
// WHAT THIS FILE PINS (the row ids are this file's own; "the next pass" is the lane's per-pass repair, `repairProjection({ perPass: true })`,
// whose FIRST call after open or recover is always full, so a row that wants to see `skipped: true` consumes that call before its steps)
//   R2   stale with NO revision change: the next application takes the stale branch's full repair and never calls `projectChanged`
//   R3   an `insertEvents` conflict leaves the session drifted: the next application's stale branch heals it from the journal
//   R4   the first application after `open`, and after a successful `recover()`, DOES delta
//   R5   recovery's `project: false` save, then recovery's own repair fails: stale, so the next application is the stale branch's full repair
//   R6   an attempt leaving through `applyCheckpointChange`: `projectChanged` answers `full`, parity at once
//   R8   an out-of-band delete of X plus an insert of a stray Y in one parent (equal counts), then an application that updates X
//   R9   a stray out-of-band attempt, then (i) an application that updates a session, (ii) an interval-only application
//   R10  SQLite holding another value on a row the delta updates
//        (R8 to R10: the application reports `failed` naming `projection-delta-mismatch`, the projection is stale, the next pass is FULL)
//   R11  an out-of-band value edit on a row no delta touches survives every delta and heals at the forced full
//   R12  the heal and the wipe call `project`, never `projectChanged`      (GREEN AT MAIN BY DESIGN; a heal routed to the delta reds it)
//   R13  a bare `repairProjection()` takes the full path                  (GREEN AT MAIN BY DESIGN; a bare repair routed to the delta reds it)
//   R14  a fault at the `project` durability edge, before and after, with the delta active: stale, then healed by a full repair
//   R20  twin applier + store pairs, one always full and one through the real delta, driven by a seeded generator; the five tables match
//   R23  the single-writer census: the only server code that writes the five tables is the full projection and the delta method
//
// THE NEW THINGS ARE REACHED THROUGH CASTS. At main the port has three members and the applier only ever calls `project`; the port built
// here is the real store's plus logging, handed to `DelegationDurability.open` through a cast, and its `projectChanged` reaches the store
// method through a cast of the store. So this file type-checks against main and loads, and each row that expects `projectChanged` to be
// called then fails on its own assertion. A row whose OWN claim is a negative ("never calls `projectChanged`") also asserts a positive
// that main cannot meet: the application AFTER the repair is a delta (`projectChanged` once, `delta`, `project` not called), which is also
// what proves the repair set the witness.
//
// Every store is a fixture store in a temp directory (`mkTmp`), SQLite and the applier's files run without fsync (durability is not
// under test here), ids are generated and neutral, and the clocks are virtual: no `Math.random`, no `Date.now()`.
import { afterEach, describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import {
  canonicalDelegationJson,
  declareCoordinatorIntent,
  delegationActivityCodec,
  delegationAttemptCodec,
  delegationSha256Hex,
  formatDelegationInstant,
  projectionViewOfDelegationCheckpoint,
  type DelegationAttemptRow,
  type DelegationCheckpointV1,
} from '../src/coord/delegation-model.js';
import {
  DELEGATION_CHECKPOINT_FILE,
  DELEGATION_REPAIR_FULL_MS,
  DelegationDurability,
  type DelegationApplyOutcome,
  type DelegationDurabilityDeps,
  type DelegationDurabilityEdge,
  type DelegationProjectionPort,
  type DelegationProjectionRepairReport,
} from '../src/coord/delegation-checkpoint.js';
import { nodeDelegationFilePort, type DelegationFileHandle, type DelegationFilePort } from '../src/coord/delegation-journal.js';

// ── fixtures, copied in shape from delegation-recovery.test.ts ────────────────────────────────────────────────────────────

const PARENT = 'lane-a-demo';
const INC = 'g1';
const CLAUDE = '11111111-2222-3333-4444-555555555555';
const X = 'agent-abc123';
const T = (s: number): string => formatDelegationInstant(Date.UTC(2026, 9, 14) + s * 1000);
const eid = (n: number): string => delegationSha256Hex(`fixture-event-${n}`);
type Over = { sessionId?: string; parentIncarnation?: string };
const base = (n: number, over: Over = {}) => ({
  v: 1 as const, observedAt: T(n), sessionId: over.sessionId ?? PARENT, parentIncarnation: over.parentIncarnation ?? INC, claudeSessionId: CLAUDE,
  eventId: eid(n), bucket: '2026101400', startOffset: n * 100, endOffset: n * 100 + 99,
});
const sessionStart = (n: number, over: Over = {}): DelegationEventEnvelopeV1 => ({ ...base(n, over), eventKind: 'SessionStart', source: 'startup' });
const subagentStart = (n: number, agentId: string, over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'SubagentStart', agentId, agentType: null });
const subagentStop = (n: number, agentId: string, over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'SubagentStop', agentId, agentType: null, agentTranscriptPath: null });

type Batch = Parameters<DelegationDurability['applyAccepted']>[0];
const batch = (events: readonly DelegationEventEnvelopeV1[], extra: { cursor?: Batch['cursor']; interval?: Batch['interval'] } = {}): Batch =>
  ({ accepted: events.map((event) => ({ event })), cursor: extra.cursor ?? null, interval: extra.interval ?? null });
const cursorFor = (bucket: string, cursor: number) => ({ sessionId: PARENT, parentIncarnation: INC, bucket, cursor, lastSize: cursor, lastCompleteAt: T(9), intervalState: 'measured' as const, detail: null, anchor: cursor > 0 ? { start: 0, sha256: 'a'.repeat(64) } : null, replaced: false });
const intervalFor = (utcHour: string, state: 'measured' | 'unmeasured', recordedAt: string, over: Over = {}) =>
  ({ sessionId: over.sessionId ?? PARENT, parentIncarnation: over.parentIncarnation ?? INC, utcHour, state, detail: null, recordedAt });
const NOW_MS = Date.UTC(2026, 9, 15, 10, 30);
const NOW_HOUR_MS = Date.UTC(2026, 9, 15, 10);
const HOUR = 3_600_000;
const bucketBack = (back: number): string => formatDelegationInstant(NOW_HOUR_MS - back * HOUR).replace(/[-:T]/g, '').slice(0, 10);
const hourBack = (back: number): string => formatDelegationInstant(NOW_HOUR_MS - back * HOUR);

class SimulatedCrash extends Error {}

/** The port's file side without fsync: the real filesystem, every sync a no-op (the O5 ordering is delegation-recovery.test.ts's). */
const noSync = (h: DelegationFileHandle): DelegationFileHandle => ({ write: (b) => h.write(b), sync: async () => undefined, close: () => h.close() });
const quickPort: DelegationFilePort = {
  ...nodeDelegationFilePort,
  openAppend: async (p) => noSync(await nodeDelegationFilePort.openAppend(p)),
  createTemp: async (p) => noSync(await nodeDelegationFilePort.createTemp(p)),
  fsyncDir: async () => undefined,
  fsyncFile: async () => undefined,
};

// ── the rig: an applier over a real store, with a LOGGING FOUR-MEMBER port ───────────────────────────────────────────────────

type ChangesResult = { mode: 'delta'; rows: number } | { mode: 'full' };
type PerPassReport = DelegationProjectionRepairReport | null;
type PortKind = 'real' | 'always-full';

interface Rig {
  dir: string;
  store: CoordStore;
  /** Every port call, in order: `project`, `projectChanged:delta`, `projectChanged:full`, `projectChanged:threw`, `insertEvents:<n>`. */
  calls: string[];
  /** The mode of every `projectChanged` call that returned, in order. */
  modes: string[];
  /** `failProject` makes the NEXT `project` (or `projectChanged`: the same control) throw once; `failEdge` throws a crash at `<edge>:<when>` once. */
  ctl: { failProject: number; failEdge: string | null };
  clock: { ms: number };
  /** The lane's monotonic clock, handed to the applier as `monotonicMs` (the forced-full clock). */
  vclock: { ms: number };
  dur: DelegationDurability;
}

const NOW0 = Date.UTC(2026, 9, 15);
const opened: DelegationDurability[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.close().catch(() => undefined)));
});

/** The port the rows hand the applier. `real`: `project` is the store's full projection and `projectChanged` the store's delta method
 *  (reached through a cast, so this file loads at main). `always-full`: `projectChanged` is the full projection and answers `full`. */
function makePort(store: CoordStore, calls: string[], modes: string[], ctl: Rig['ctl'], kind: PortKind): DelegationProjectionPort {
  const trip = (): void => { if (ctl.failProject > 0) { ctl.failProject--; throw new Error('the projection port failed (fixture)'); } };
  const port = {
    project: (cp: DelegationCheckpointV1): void => { calls.push('project'); trip(); store.projectDelegationCheckpoint(cp); },
    projectChanged: (prior: DelegationCheckpointV1, next: DelegationCheckpointV1): ChangesResult => {
      try { trip(); } catch (err) { calls.push('projectChanged:threw'); throw err; }
      let r: ChangesResult;
      if (kind === 'always-full') {
        store.projectDelegationCheckpoint(next);
        r = { mode: 'full' };
      } else {
        try {
          r = (store as unknown as { projectDelegationCheckpointChanges(p: DelegationCheckpointV1, n: DelegationCheckpointV1): ChangesResult }).projectDelegationCheckpointChanges(prior, next);
        } catch (err) { calls.push('projectChanged:threw'); throw err; }
      }
      calls.push(`projectChanged:${r.mode}`);
      modes.push(r.mode);
      return r;
    },
    insertEvents: (rows: Parameters<CoordStore['insertDelegationEvents']>[0]) => { calls.push(`insertEvents:${rows.length}`); return store.insertDelegationEvents(rows); },
    eventStats: () => store.delegationEventStats(),
    countEventsAtOrBelow: (s: number) => store.countDelegationEventsAtOrBelow(s),
    deleteEventsBetween: (a: number, b: number, n: number) => store.deleteDelegationEventsBetween(a, b, n),
  };
  return port as unknown as DelegationProjectionPort;
}

interface RigOpts { dir?: string; storeDir?: string; failProject?: number; kind?: PortKind }
/** A directory, a store (in `storeDir` when given: a lost coord.db), and an applier OPENED on them. */
async function rig(o: RigOpts = {}): Promise<Rig> {
  const dir = o.dir ?? mkTmp('ccrc-deleg-applier-');
  const store = new CoordStore(openCoordDb(path.join(o.storeDir ?? dir, 'coord.db')));
  store.db.exec('PRAGMA synchronous = OFF');
  const calls: string[] = [];
  const modes: string[] = [];
  const ctl = { failProject: o.failProject ?? 0, failEdge: null as string | null };
  const clock = { ms: NOW0 };
  const vclock = { ms: 1_000_000 };
  let uuids = 0;
  const deps = {
    dir, projection: makePort(store, calls, modes, ctl, o.kind ?? 'real'), port: quickPort, now: () => clock.ms, monotonicMs: () => vclock.ms,
    randomUUID: () => `generated-${++uuids}`,
    onEdge: (e: DelegationDurabilityEdge, w: 'before' | 'after') => { if (ctl.failEdge === `${e}:${w}`) { ctl.failEdge = null; throw new SimulatedCrash(`${e}:${w}`); } },
  } satisfies DelegationDurabilityDeps;
  const dur = await DelegationDurability.open(deps);
  opened.push(dur);
  return { dir, store, calls, modes, ctl, clock, vclock, dur };
}

/** A rig with one batch applied (a session and an agent's activity), its log cleared. */
async function lane(o: RigOpts = {}): Promise<Rig> {
  const r = await rig(o);
  await r.dur.applyAccepted(batch([sessionStart(1), subagentStart(2, X)]));
  r.calls.length = 0;
  return r;
}

const perPass = (r: Rig): Promise<PerPassReport> => r.dur.repairProjection({ perPass: true });
const statsOf = (r: Rig) => r.store.delegationEventStats();
const cpOf = (r: Rig): DelegationCheckpointV1 => r.dur.state().checkpoint as DelegationCheckpointV1;
const canon = (v: unknown): string => canonicalDelegationJson(v as never);
/** SQLite says what the applier's checkpoint says. */
const parity = (r: Rig, label: string): void => {
  expect(canon(r.store.readDelegationProjection()), `${label}: parity of the five tables with the checkpoint`).toBe(canon(projectionViewOfDelegationCheckpoint(cpOf(r))));
};
const changedCalls = (r: Rig): string[] => r.calls.filter((c) => c.startsWith('projectChanged'));

/** One per-pass repair; the port calls it made are `r.calls`. */
async function pass(r: Rig): Promise<{ report: PerPassReport; projected: boolean }> {
  r.calls.length = 0;
  const report = await perPass(r);
  return { report, projected: r.calls.includes('project') };
}
/** A per-pass repair that takes the SHORT path: nothing projected, `skipped: true`. */
async function expectSkipped(r: Rig, label: string): Promise<void> {
  const p = await pass(r);
  expect(p.projected, `${label}: a short per-pass repair makes no port project call`).toBe(false);
  expect(p.report, `${label}: a short per-pass repair reports skipped`).toMatchObject({ skipped: true, inserted: 0, healedSessions: 0, journalPasses: 0 });
}
/** A per-pass repair that takes the FULL path. */
async function expectFull(r: Rig, label: string): Promise<DelegationProjectionRepairReport> {
  const p = await pass(r);
  expect(p.projected, `${label}: the full path calls the port's project`).toBe(true);
  expect(p.report, `${label}: the repair completed`).not.toBeNull();
  expect(p.report?.skipped, `${label}: the full path reports skipped:false`).toBe(false);
  return p.report!;
}
/** The first per-pass repair after open or recover is full; the second is the first control. */
async function settle(r: Rig): Promise<void> {
  await expectFull(r, 'the first per-pass repair after open');
  await expectSkipped(r, 'control (the second per-pass repair)');
}
/** The next application is a DELTA: `projectChanged` once, answering `delta`, and the port's `project` not called for it. */
async function expectDeltaApplication(r: Rig, label: string, n: number): Promise<DelegationApplyOutcome> {
  r.calls.length = 0;
  const out = await r.dur.applyAccepted(batch([sessionStart(n)]));
  expect(out.projection.status, `${label}: projected`).toBe('projected');
  expect(changedCalls(r), `${label}: the witness holds, so the application calls projectChanged exactly once and it deltas`).toEqual(['projectChanged:delta']);
  expect(r.calls.includes('project'), `${label}: the application made no full projection`).toBe(false);
  return out;
}
/** An application refused by the delta: the journal and checkpoint are done, the projection is `failed` naming the mismatch refusal. */
function expectMismatch(out: DelegationApplyOutcome, label: string): void {
  expect(out.durable, `${label}: the journal and the checkpoint are authoritative and done`).toBe(true);
  expect(out.projection, `${label}: the projection failed with the delta's refusal`).toMatchObject({ status: 'failed', error: expect.stringContaining('projection-delta-mismatch') });
}
const DELEGATION_TABLES = ['delegation_lineage', 'delegation_leases', 'delegation_events', 'delegation_attempts', 'delegation_activities', 'delegation_sessions'] as const;
const dumpAll = (raw: DatabaseSync): Record<string, unknown[]> =>
  Object.fromEntries(DELEGATION_TABLES.map((t) => [t, raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const countOf = (r: Rig, table: string): number => Number((r.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
const attemptOf = (id: string, over: Partial<DelegationAttemptRow> = {}): DelegationAttemptRow => ({
  attemptId: id, parentId: PARENT, parentIncarnation: INC, project: 'project-a', adminRecord: `wt-${id}`, canonicalPath: null, attemptedAt: T(5),
  rung: null, verdict: 'unresolved', evidenceJournalIds: [], detail: null, ...over,
});

// ── R2, R3, R5: the stale branch is first, and always the FULL repair ────────────────────────────────────────────────────

describe('R2 / R3 / R5: a stale projection takes the stale branch\'s full repair, never projectChanged, and the witness it sets makes the NEXT application a delta', () => {
  it('R2: stale with NO revision change (a bare repair whose project threw once): the next application repairs in full, the projection is current, and the one after deltas', async () => {
    const r = await lane();
    await settle(r);
    r.ctl.failProject = 1;
    const revision = cpOf(r).revision;
    expect(await r.dur.repairProjection(), 'the bare repair failed: it returns null and marks the projection stale').toBeNull();
    expect(cpOf(r).revision, 'a failed repair moves no revision').toBe(revision);

    r.calls.length = 0;
    const out = await r.dur.applyAccepted(batch([sessionStart(3)]));
    expect(out.durable).toBe(true);
    expect(out.projection.status, 'the stale branch\'s repair completed').toBe('projected');
    expect(changedCalls(r), 'a stale projection NEVER takes the delta').toEqual([]);
    expect(r.calls.includes('project'), 'the repair ran: its port project call is logged').toBe(true);
    expect(statsOf(r), 'the repair replayed the journal, this application\'s event included').toEqual({ count: 3, maxSequence: 3 });
    parity(r, 'after the stale branch\'s repair');
    await expectSkipped(r, 'the next per-pass repair: the repair cleared the stale mark and set the witness');

    await expectDeltaApplication(r, 'the application after the repair', 4);
    parity(r, 'after the delta');
  });

  it('R3: an insertEvents conflict leaves the session drifted; the next application\'s stale branch heals it from the journal, and the one after deltas', async () => {
    const r = await lane();
    await settle(r);
    // a row SQLite holds for the event about to be journaled, but with another kind: drift the journal must win over
    r.store.db.prepare(`INSERT INTO delegation_events (eventId, journalSequence, journalDigest, acceptedAt, sessionId, parentIncarnation, claudeSessionId, eventKind, observedAt, payloadJson)
      VALUES (?, 3, ?, 1, ?, ?, 'c', 'SessionEnd', 1, '{}')`).run(eid(3), '0'.repeat(64), PARENT, INC);
    r.calls.length = 0;
    const conflicting = await r.dur.applyAccepted(batch([sessionStart(3)]));
    expect(conflicting.projection.status, 'the application meets the conflicting row').toBe('failed');
    expect(changedCalls(r), 'the witness held, so the conflicting application itself was a delta').toEqual(['projectChanged:delta']);

    r.calls.length = 0;
    const healing = await r.dur.applyAccepted(batch([sessionStart(4)]));
    expect(healing.projection.status, 'the stale branch healed the drift').toBe('projected');
    expect(changedCalls(r), 'a drifted session NEVER takes the delta').toEqual([]);
    expect(r.calls.filter((c) => c === 'project').length, 'the repair projected, and the drifted session left and re-entered (three projections)').toBeGreaterThanOrEqual(3);
    expect(r.store.db.prepare('SELECT eventKind FROM delegation_events WHERE eventId = ?').get(eid(3))?.['eventKind'], 'the journal won: the drifted event row is the journal\'s').toBe('SessionStart');
    expect(statsOf(r)).toEqual({ count: 4, maxSequence: 4 });
    parity(r, 'after the heal');
    await expectSkipped(r, 'the next per-pass repair: the heal cleared the drift');

    await expectDeltaApplication(r, 'the application after the heal', 5);
  });

  it('R5: recovery\'s project:false save, then its own repair failing: the next application is the stale branch\'s full repair, and the one after deltas', async () => {
    const a = await rig();
    await a.dur.applyAccepted(batch([sessionStart(1), subagentStart(2, X)]));
    const checkpointPath = path.join(a.dir, DELEGATION_CHECKPOINT_FILE);
    const earlier = readFileSync(checkpointPath);                                   // the checkpoint after the first batch
    await a.dur.applyAccepted(batch([sessionStart(3)]));
    await a.dur.close();
    writeFileSync(checkpointPath, earlier);                                         // rolled back: the journal now holds a suffix recovery replays and SAVES
    // a lost coord.db too, so the failed repair leaves SQLite empty and only a full repair can make it say anything
    const b = await rig({ dir: a.dir, storeDir: mkTmp('ccrc-deleg-applier-lost-'), failProject: 1 });
    expect(b.dur.failure(), 'recovery completed').toBeNull();
    expect(cpOf(b).appliedJournalSequence, 'the replayed suffix is in the checkpoint').toBe(3);
    expect(b.calls, 'recovery\'s save projected nothing; the only port call is its own failing repair').toEqual(['project']);
    expect(countOf(b, 'delegation_sessions'), 'the failed repair wrote nothing').toBe(0);

    b.calls.length = 0;
    const out = await b.dur.applyAccepted(batch([sessionStart(4)]));
    expect(out.projection.status, 'the stale branch\'s repair completed').toBe('projected');
    expect(changedCalls(b), 'a stale projection NEVER takes the delta').toEqual([]);
    expect(b.calls.includes('project'), 'the repair ran: its port project call is logged').toBe(true);
    expect(statsOf(b), 'the repair rebuilt SQLite from the journal, the whole of it').toEqual({ count: 4, maxSequence: 4 });
    parity(b, 'after the stale branch\'s repair');

    await expectDeltaApplication(b, 'the application after the repair', 5);
    // the first per-pass repair after a recover is full whatever the state, so the control is the delta above and parity, then this pair
    await expectFull(b, 'the first per-pass repair after recover()');
    await expectSkipped(b, 'the second per-pass repair');
  });
});

// ── R4: the first application after open and after recover() DOES delta ──────────────────────────────────────────────────

describe('R4: the first application after open, and after a successful recover(), is a delta (recovery\'s own full repair set the witness)', () => {
  it('R4: after open on an empty directory', async () => {
    const r = await rig();
    expect(r.calls, 'open projected once, in full').toEqual(['project']);
    await expectDeltaApplication(r, 'the first application after open', 1);
    parity(r, 'after the first application');
  });

  it('R4: after open on a populated directory', async () => {
    const a = await lane();
    await a.dur.close();
    const b = await rig({ dir: a.dir, storeDir: a.dir });
    expect(b.dur.failure()).toBeNull();
    await expectDeltaApplication(b, 'the first application after a re-open', 3);
    parity(b, 'after the first application');
  });

  it('R4: after a successful recover()', async () => {
    const r = await lane();
    const recovered = await r.dur.recover();
    expect(recovered.failure).toBeNull();
    await expectDeltaApplication(r, 'the first application after recover()', 3);
    parity(r, 'after the first application');
  });
});

// ── R6: an attempt leaving falls back, through the applier ───────────────────────────────────────────────────────────────

describe('R6: an attempt removed through applyCheckpointChange makes projectChanged answer full, and parity holds at once', () => {
  it('R6: adding an attempt deltas; removing it answers mode full (the fallback is the store\'s, inside the same call)', async () => {
    const r = await lane();
    await settle(r);
    r.calls.length = 0;
    const added = await r.dur.applyCheckpointChange((cp) => ({ ...cp, attempts: [...cp.attempts, attemptOf('attempt-1', { verdict: 'linked', rung: 2, canonicalPath: '/work/project-a/wt-1', detail: 'ok' })] }));
    expect(added.projection.status).toBe('projected');
    expect(changedCalls(r), 'a new attempt is an insert: a delta').toEqual(['projectChanged:delta']);
    expect(countOf(r, 'delegation_attempts')).toBe(1);
    parity(r, 'after the attempt was added');

    r.calls.length = 0;
    const removed = await r.dur.applyCheckpointChange((cp) => ({ ...cp, attempts: [] }));
    expect(removed.projection.status).toBe('projected');
    expect(changedCalls(r), 'a row leaving is the full fallback, answered by projectChanged').toEqual(['projectChanged:full']);
    expect(r.calls.includes('project'), 'the fallback is inside the store\'s call: the port\'s project is not called').toBe(false);
    expect(countOf(r, 'delegation_attempts'), 'the attempt is gone from SQLite').toBe(0);
    parity(r, 'at once, after the attempt left');
    await expectSkipped(r, 'a fallback to full leaves the projection current');
  });
});

// ── R8, R9, R10: what the compare-and-swap and the count tripwire catch, seen from the applier ───────────────────────────

describe('R8 / R9 / R10: out-of-band damage the delta refuses: the application reports failed naming projection-delta-mismatch, the projection is stale, the next pass is FULL and heals', () => {
  /** After a refused application: stale, so the next per-pass repair is full, and afterwards parity holds and a further one is short. */
  async function expectHealsOnNextPass(r: Rig, label: string, events: number): Promise<void> {
    const report = await expectFull(r, `${label}: the next per-pass repair`);
    expect(report.skipped).toBe(false);
    expect(statsOf(r), `${label}: the repair replayed the application's event from the journal`).toEqual({ count: events, maxSequence: events });
    parity(r, `${label}: after the full repair`);
    await expectSkipped(r, `${label}: a further per-pass repair`);
    await expectDeltaApplication(r, `${label}: the application after the repair`, 40);
  }

  it('R8: a delete of activity X plus an insert of a stray Y in one parent keeps the counts equal; the application that updates X is refused and the next pass heals', async () => {
    const r = await lane();
    await settle(r);
    const x = cpOf(r).activities[0]!;
    r.store.db.prepare('DELETE FROM delegation_activities WHERE activityId = ?').run(x.activityId);
    const stray = delegationActivityCodec.toDb({ ...x, activityId: delegationSha256Hex('stray-activity'), upstreamId: 'agent-stray' });
    r.store.db.prepare(`INSERT INTO delegation_activities (${delegationActivityCodec.columns.join(', ')}) VALUES (${delegationActivityCodec.columns.map(() => '?').join(', ')})`)
      .run(...delegationActivityCodec.columns.map((c) => stray[c]!));
    expect(countOf(r, 'delegation_activities'), 'the counts are equal').toBe(cpOf(r).activities.length);
    r.calls.length = 0;
    const dumped = dumpAll(r.store.db);
    const out = await r.dur.applyCheckpointChange((cp) => ({ ...cp, activities: cp.activities.map((a) => ({ ...a, displayName: 'reviewer' })) }));
    expect(changedCalls(r), 'the application went through the delta').toEqual(['projectChanged:threw']);
    expectMismatch(out, 'R8');
    expect(dumpAll(r.store.db), 'R8: the refused delta rolled back: SQLite is as the damage left it').toEqual(dumped);
    const refusal = (out.projection as { error: string }).error;
    expect(refusal, 'the refusal names the compare-and-swap miss on the table').toContain('delegation_activities');
    expect(refusal, 'and the key of the row that did not match').toContain(x.activityId);
    expect(refusal, 'a compare-and-swap miss').toMatch(/compare-and-swap changed/);
    expect(refusal, 'not the count tripwire\'s message').not.toMatch(/after the delta, expected/);
    await expectHealsOnNextPass(r, 'R8', 2);
    expect(r.store.db.prepare('SELECT displayName FROM delegation_activities WHERE activityId = ?').get(x.activityId)?.['displayName'], 'X is back, with the update').toBe('reviewer');
  });

  it('R9 (i): a stray out-of-band attempt, then an application that updates a session: the count trips', async () => {
    const r = await lane();
    await settle(r);
    const s = delegationAttemptCodec.toDb(attemptOf('attempt-stray'));
    r.store.db.prepare(`INSERT INTO delegation_attempts (${delegationAttemptCodec.columns.join(', ')}) VALUES (${delegationAttemptCodec.columns.map(() => '?').join(', ')})`)
      .run(...delegationAttemptCodec.columns.map((c) => s[c]!));
    r.calls.length = 0;
    const dumped = dumpAll(r.store.db);
    const out = await r.dur.applyAccepted(batch([sessionStart(3)]));
    expect(changedCalls(r)).toEqual(['projectChanged:threw']);
    expectMismatch(out, 'R9 (i)');
    expect(dumpAll(r.store.db), 'R9 (i): the refused delta rolled back: SQLite is as the damage left it').toEqual(dumped);
    expect((out.projection as { error: string }).error).toContain('delegation_attempts');
    await expectHealsOnNextPass(r, 'R9 (i)', 3);
    expect(countOf(r, 'delegation_attempts'), 'the full repair removed the stray row').toBe(0);
  });

  it('R9 (ii): a stray out-of-band attempt, then an interval-only application (zero rows): the count trips', async () => {
    const r = await lane();
    await settle(r);
    const s = delegationAttemptCodec.toDb(attemptOf('attempt-stray'));
    r.store.db.prepare(`INSERT INTO delegation_attempts (${delegationAttemptCodec.columns.join(', ')}) VALUES (${delegationAttemptCodec.columns.map(() => '?').join(', ')})`)
      .run(...delegationAttemptCodec.columns.map((c) => s[c]!));
    r.calls.length = 0;
    const dumped = dumpAll(r.store.db);
    const out = await r.dur.applyAccepted(batch([], { interval: intervalFor('2026101400', 'measured', T(5)) }));
    expect(changedCalls(r), 'a zero-row delta still ran the tripwire').toEqual(['projectChanged:threw']);
    expectMismatch(out, 'R9 (ii)');
    expect(dumpAll(r.store.db), 'R9 (ii): the refused delta rolled back: SQLite is as the damage left it').toEqual(dumped);
    expect((out.projection as { error: string }).error).toContain('delegation_attempts');
    await expectHealsOnNextPass(r, 'R9 (ii)', 2);
    expect(countOf(r, 'delegation_attempts'), 'the full repair removed the stray row').toBe(0);
  });

  it('R10: SQLite holding another value on a row the delta updates is a compare-and-swap miss; stale, then healed', async () => {
    const r = await lane();
    await settle(r);
    r.store.db.prepare('UPDATE delegation_sessions SET effective = 1 - effective WHERE sessionId = ? AND parentIncarnation = ?').run(PARENT, INC);
    r.calls.length = 0;
    const dumped = dumpAll(r.store.db);
    const out = await r.dur.applyAccepted(batch([sessionStart(3)]));
    expect(changedCalls(r)).toEqual(['projectChanged:threw']);
    expectMismatch(out, 'R10');
    expect(dumpAll(r.store.db), 'R10: the refused delta rolled back: SQLite is as the damage left it').toEqual(dumped);
    expect((out.projection as { error: string }).error).toContain('delegation_sessions');
    await expectHealsOnNextPass(r, 'R10', 3);
    expect(Number(r.store.db.prepare('SELECT effective FROM delegation_sessions WHERE sessionId = ?').get(PARENT)?.['effective']), 'the full repair restored the session\'s value').toBe(cpOf(r).sessions[0]!.effective ? 1 : 0);
  });
});

// ── R11: the widened residual ────────────────────────────────────────────────────────────────────────────────────────────

describe('R11: an out-of-band value edit on a row no delta touches survives every delta and per-pass repair, and heals at the forced full', () => {
  it('R11: an old activity\'s displayName edited out of band outlives several deltas, then the virtual clock past DELEGATION_REPAIR_FULL_MS heals it', async () => {
    const r = await lane();
    await settle(r);
    const x = cpOf(r).activities[0]!;
    r.store.db.prepare("UPDATE delegation_activities SET displayName = 'tampered-name' WHERE activityId = ?").run(x.activityId);
    const shown = (): unknown => r.store.db.prepare('SELECT displayName FROM delegation_activities WHERE activityId = ?').get(x.activityId)?.['displayName'];
    for (const n of [3, 4, 5]) {
      await expectDeltaApplication(r, `delta application ${n}`, n);
      expect(shown(), `SQLite still shows the edit after the delta application ${n}`).toBe('tampered-name');
      await expectSkipped(r, `the per-pass repair after the delta application ${n}`);
      expect(shown(), `SQLite still shows the edit after the per-pass repair ${n}`).toBe('tampered-name');
    }
    r.vclock.ms += DELEGATION_REPAIR_FULL_MS + 1000;
    await expectFull(r, 'the forced full, past DELEGATION_REPAIR_FULL_MS on the virtual clock');
    expect(shown(), 'the forced full healed the edit').toBe(x.displayName);
    parity(r, 'after the forced full');
    await expectSkipped(r, 'right after the forced full');
  });
});

// ── R12, R13: what stays FULL (green at main by design) ──────────────────────────────────────────────────────────────────

describe('R12 / R13: the heal, the wipe and a bare repairProjection() take the FULL path (green at main by design; a heal routed to projectChanged reds R12, a bare repair routed to it reds R13)', () => {
  const stray = (r: Rig): void => {
    r.store.db.prepare(`INSERT INTO delegation_events (eventId, journalSequence, journalDigest, acceptedAt, sessionId, parentIncarnation, claudeSessionId, eventKind, observedAt, payloadJson)
      VALUES ('stray', 2000, ?, 1, ?, ?, 'c', 'SessionStart', 1, '{}')`).run('0'.repeat(64), PARENT, INC);
  };
  async function withTwoSessions(): Promise<Rig> {
    const r = await lane();
    await r.dur.applyAccepted(batch([sessionStart(3), sessionStart(4, { sessionId: 'lane-b-demo' }), sessionStart(5, { sessionId: 'lane-b-demo' })]));
    await settle(r);
    return r;
  }
  const idsOf = (r: Rig): Record<number, number> =>
    Object.fromEntries((r.store.db.prepare('SELECT id, journalSequence AS s FROM delegation_events').all() as Array<{ id: number; s: number }>).map((x) => [x.s, x.id]));

  it('R12 (green by design; MD11 reds it): the heal of a drifted session projects in full, never projectChanged, and the session\'s events are deleted and replayed', async () => {
    const r = await withTwoSessions();
    const before = idsOf(r);
    // seq 1 is gone (the count disagrees, so the replay covers everything) and seq 3 holds another kind: the conflict heals PARENT only
    r.store.db.prepare('DELETE FROM delegation_events WHERE journalSequence = 1').run();
    r.store.db.prepare("UPDATE delegation_events SET eventKind = 'SessionEnd' WHERE journalSequence = 3").run();
    r.calls.length = 0;
    const report = await r.dur.repairProjection();
    expect(report, 'one drifted session healed, no wipe').toMatchObject({ healedSessions: 1, wipedAll: false, skipped: false });
    expect(changedCalls(r), 'the heal never takes the delta').toEqual([]);
    expect(r.calls.filter((c) => c === 'project').length, 'the repair projected, and the drifted session left and re-entered').toBeGreaterThanOrEqual(3);
    expect(r.store.db.prepare('SELECT eventKind FROM delegation_events WHERE journalSequence = 3').get()?.['eventKind'], 'the replayed row is the journal\'s').toBe('SessionStart');
    expect(statsOf(r)).toEqual({ count: 5, maxSequence: 5 });
    const after = idsOf(r);
    expect([after[4], after[5]], 'the staying session\'s event rows were not touched').toEqual([before[4], before[5]]);
    expect([after[1]!, after[2]!, after[3]!].every((id) => id > Math.max(...Object.values(before))), 'the drifted session\'s events were deleted and re-inserted').toBe(true);
    parity(r, 'after the heal');
  });

  it('R12 (green by design; MD11 reds it): the wipe (stray rows the journal does not hold) projects in full, never projectChanged, and the events end up exactly the journal\'s', async () => {
    const r = await withTwoSessions();
    stray(r);
    r.calls.length = 0;
    const report = await r.dur.repairProjection();
    expect(report?.wipedAll, 'the last resort').toBe(true);
    expect(changedCalls(r), 'the wipe never takes the delta').toEqual([]);
    expect(r.calls.filter((c) => c === 'project').length, 'the repair projected, and the wipe emptied and refilled').toBeGreaterThanOrEqual(3);
    expect(statsOf(r)).toEqual({ count: 5, maxSequence: 5 });
    expect(countOf(r, 'delegation_events')).toBe(5);
    parity(r, 'after the wipe');
  });

  it('R13 (green by design; MD22 reds it): a bare repairProjection() after a delta takes the full path: project called, projectChanged not', async () => {
    const r = await lane();
    await settle(r);
    await r.dur.applyAccepted(batch([sessionStart(3)]));                       // the witness holds: a delta would be available
    r.calls.length = 0;
    const report = await r.dur.repairProjection();
    expect(report, 'a bare repair is never a short one').toMatchObject({ skipped: false });
    expect(r.calls.includes('project'), 'a bare repair is always the full path').toBe(true);
    expect(changedCalls(r), 'and never the delta').toEqual([]);
    parity(r, 'after the bare repair');
  });
});

// ── R14: a fault at the project edge, with the delta active ─────────────────────────────────────────────────────────────

describe('R14: a fault at the project durability edge, with the delta active: the projection is stale and the next per-pass repair heals it in full', () => {
  it.each(['before', 'after'] as const)('R14: the project edge throws %s the projection', async (when) => {
    const r = await lane();
    await settle(r);
    await expectDeltaApplication(r, 'control: the delta is active before the fault', 3);
    const dumpBefore = dumpAll(r.store.db);
    r.ctl.failEdge = `project:${when}`;
    r.calls.length = 0;
    const out = await r.dur.applyAccepted(batch([sessionStart(4)]));
    expect(out.durable, 'the journal and the checkpoint are done').toBe(true);
    expect(out.projection.status, 'the projection failed').toBe('failed');
    if (when === 'before') {
      expect(r.calls, 'the fault precedes the port: nothing was called').toEqual([]);
      expect(dumpAll(r.store.db), 'SQLite is unchanged').toEqual(dumpBefore);
    } else {
      expect(r.calls, 'the delta and the event insert ran inside the edge, then the fault').toEqual(['projectChanged:delta', 'insertEvents:1']);
      expect(dumpAll(r.store.db), 'the edge\'s work is in SQLite').not.toEqual(dumpBefore);
      parity(r, 'the work done before the after-edge fault');
    }
    const report = await expectFull(r, `the next per-pass repair after the ${when} fault`);
    expect(report.skipped).toBe(false);
    expect(statsOf(r), 'every event is in SQLite after the repair').toEqual({ count: 4, maxSequence: 4 });
    parity(r, 'after the full repair');
    await expectSkipped(r, 'after the full repair');
    await expectDeltaApplication(r, 'the application after the repair', 5);
  });
});

// ── R20: twins, one always full, one through the real delta ─────────────────────────────────────────────────────────────

/** mulberry32: a small deterministic generator, so a seed names a run. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickOf = <T>(xs: readonly T[], rand: () => number): T => xs[Math.floor(rand() * xs.length)]!;

const STEP_KINDS = [
  'new-session', 'touch-session', 'open-activity', 'touch-activity', 'end-activity', 'add-attempt', 'remove-attempt', 'lease', 'set-intent', 'clear-intent',
  'interval-only', 'cursor-drop', 'heal', 'per-pass',
] as const;
type StepKind = (typeof STEP_KINDS)[number];
type Step = (r: Rig) => Promise<DelegationApplyOutcome[]>;

/** One step of a run, decided from the checkpoint the two twins share; `null` when the kind has no target yet. */
function planStep(kind: StepKind, n: number, rand: () => number, cp: DelegationCheckpointV1, events: number): Step | null {
  const sess = cp.sessions;
  const keyOf = (s: { sessionId: string; parentIncarnation: string }): Over => ({ sessionId: s.sessionId, parentIncarnation: s.parentIncarnation });
  const one = (f: (r: Rig) => Promise<DelegationApplyOutcome>): Step => async (r) => [await f(r)];
  switch (kind) {
    case 'new-session': {
      // half the time the session arrives WITH its first activity, so a delta can carry a new session and a new child together (parents first)
      const withActivity = rand() < 0.5;
      const over: Over = { sessionId: `lane-${n}-demo` };
      return one((r) => r.dur.applyAccepted(batch(withActivity ? [sessionStart(n, over), subagentStart(n + 1, `agent-${n}`, over)] : [sessionStart(n, over)])));
    }
    case 'touch-session': {
      if (sess.length === 0) return null;
      const s = pickOf(sess, rand);
      return one((r) => r.dur.applyAccepted(batch([sessionStart(n, keyOf(s))])));
    }
    case 'open-activity': {
      if (sess.length === 0) return null;
      const s = pickOf(sess, rand);
      return one((r) => r.dur.applyAccepted(batch([subagentStart(n, `agent-${n}`, keyOf(s))])));
    }
    case 'touch-activity': {
      if (cp.activities.length === 0) return null;
      const a = pickOf(cp.activities, rand);
      return one((r) => r.dur.applyCheckpointChange((c) => ({ ...c, activities: c.activities.map((x) => (x.activityId === a.activityId ? { ...x, displayName: `name-${n}` } : x)) })));
    }
    case 'end-activity': {
      const live = cp.activities.filter((a) => a.sourceKind === 'agent' && a.executionState !== 'ended');
      if (live.length === 0) return null;
      const a = pickOf(live, rand);
      return one((r) => r.dur.applyAccepted(batch([subagentStop(n, a.upstreamId, { sessionId: a.parentId, parentIncarnation: a.parentIncarnation })])));
    }
    case 'add-attempt': {
      if (sess.length === 0) return null;
      const s = pickOf(sess, rand);
      return one((r) => r.dur.applyCheckpointChange((c) => ({ ...c, attempts: [...c.attempts, attemptOf(`attempt-${n}`, { parentId: s.sessionId, parentIncarnation: s.parentIncarnation, attemptedAt: T(n), detail: `detail-${n}` })] })));
    }
    case 'remove-attempt': {
      if (cp.attempts.length === 0) return null;
      const a = pickOf(cp.attempts, rand);
      return one((r) => r.dur.applyCheckpointChange((c) => ({ ...c, attempts: c.attempts.filter((x) => x.attemptId !== a.attemptId) })));
    }
    case 'lease': {
      const free = cp.activities.filter((a) => a.sourceKind === 'agent' && cp.leases.every((l) => l.activityId !== a.activityId));
      if (free.length === 0) return null;
      const a = pickOf(free, rand);
      return async (r) => {
        const out = await r.dur.createLease({
          activityId: a.activityId, parentId: a.parentId, parentIncarnation: a.parentIncarnation, project: 'project-a', adminRecord: `wt-${n}`,
          canonicalPath: `/work/project-a/wt-${n}`, creationBase: null, sourceKind: 'agent', correlationJournalIds: [], firstObservedAt: T(n),
        });
        expect(out.kind, `step ${n}: a lease on an activity that holds none is created`).toBe('created');
        return out.kind === 'created' ? [out.applied] : [];
      };
    }
    case 'set-intent': {
      if (sess.length === 0) return null;
      const s = pickOf(sess, rand);
      return one((r) => r.dur.applyCheckpointChange((c) => declareCoordinatorIntent(c, { action: 'set', ...keyOf(s) as { sessionId: string; parentIncarnation: string }, declaredAt: T(n) })));
    }
    case 'clear-intent': {
      const declared = sess.filter((s) => s.explicitIntentAt !== null);
      if (declared.length === 0) return null;
      const s = pickOf(declared, rand);
      return one((r) => r.dur.applyCheckpointChange((c) => declareCoordinatorIntent(c, { action: 'clear', ...keyOf(s) as { sessionId: string; parentIncarnation: string }, declaredAt: T(n) })));
    }
    case 'interval-only': {
      if (sess.length === 0) return null;
      const s = pickOf(sess, rand);
      const hour = formatDelegationInstant(Date.UTC(2026, 9, 14, n % 24));
      return one((r) => r.dur.applyAccepted(batch([], { interval: intervalFor(hour, 'measured', T(n), keyOf(s)) })));
    }
    case 'cursor-drop': {
      const back = 49 + (n % 40);
      return async (r) => {
        const put = await r.dur.applyAccepted(batch([], { cursor: cursorFor(bucketBack(back), 10), interval: intervalFor(hourBack(back), 'measured', T(1)) }));
        const pruned = await r.dur.pruneBucketCursors(NOW_MS);
        return [put, pruned.applied];
      };
    }
    case 'heal': {
      if (events < 2) return null;
      return async (r) => {
        const db = r.store.db;
        const lo = Number((db.prepare('SELECT MIN(journalSequence) AS s FROM delegation_events').get() as { s: number }).s);
        const hi = Number((db.prepare('SELECT MAX(journalSequence) AS s FROM delegation_events').get() as { s: number }).s);
        db.prepare('DELETE FROM delegation_events WHERE journalSequence = ?').run(lo);            // the count disagrees, so the replay covers everything
        db.prepare("UPDATE delegation_events SET eventKind = 'SessionEnd' WHERE journalSequence = ?").run(hi);       // a conflict: that session leaves and re-enters
        const report = await r.dur.repairProjection();
        expect(report?.healedSessions, `step ${n}: the drifted session was healed`).toBeGreaterThan(0);
        return [];
      };
    }
    case 'per-pass': {
      const forced = rand() < 0.3;
      return async (r) => {
        if (forced) r.vclock.ms += DELEGATION_REPAIR_FULL_MS + 1;
        await perPass(r);
        return [];
      };
    }
  }
}

const PRIMARY_KEYS: Readonly<Record<string, string>> = {
  delegation_sessions: 'sessionId, parentIncarnation', delegation_activities: 'activityId', delegation_attempts: 'attemptId',
  delegation_leases: 'leaseId', delegation_lineage: 'lineageId',
};
/** The five tables by primary key, and the events by their columns WITHOUT `id` (the autoincrement is no part of what a row says). */
function tablesOf(raw: DatabaseSync): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const [t, pk] of Object.entries(PRIMARY_KEYS)) out[t] = raw.prepare(`SELECT * FROM ${t} ORDER BY ${pk}`).all();
  const cols = (raw.prepare('PRAGMA table_info(delegation_events)').all() as Array<{ name: string }>).map((c) => c.name).filter((c) => c !== 'id');
  out['delegation_events'] = raw.prepare(`SELECT ${cols.join(', ')} FROM delegation_events ORDER BY journalSequence`).all();
  return out;
}

const SEEDS = [11, 23, 37, 41, 59, 73] as const;
const STEPS = 100;
describe(`R20: twin appliers and stores, one ALWAYS FULL and one through the real delta, stay equal after every step of a seeded run (${SEEDS.length} seeds, ${STEPS} steps each)`, () => {
  it.each(SEEDS)(`R20: seed %i: ${STEPS} steps from the fixed generator; five tables by primary key and events without id match after every step; the delta twin deltas`, async (seed) => {
    const full = await rig({ kind: 'always-full' });
    const delta = await rig({ kind: 'real' });
    const rand = prng(seed);
    const ran = new Map<StepKind, number>();
    for (let i = 0; i < STEPS; i++) {
      const n = 10 + i * 3;
      let kind: StepKind = i === 0 ? 'new-session' : pickOf(STEP_KINDS, rand);
      const events = Number((delta.store.db.prepare('SELECT COUNT(*) AS n FROM delegation_events').get() as { n: number }).n);
      let step = planStep(kind, n, rand, cpOf(delta), events);
      if (step === null) { kind = 'new-session'; step = planStep(kind, n, rand, cpOf(delta), events)!; }
      const label = `seed ${seed} step ${i} (${kind})`;
      ran.set(kind, (ran.get(kind) ?? 0) + 1);
      for (const r of [full, delta]) r.clock.ms = NOW0 + i * 1000;
      const outs = [...await step(full), ...await step(delta)];
      for (const o of outs) expect(o.projection.status, `${label}: no application's projection failed`).not.toBe('failed');
      const a = tablesOf(full.store.db);
      const b = tablesOf(delta.store.db);
      for (const t of Object.keys(a)) expect(b[t], `${label}: ${t} differs between the always-full twin and the delta twin`).toEqual(a[t]);
      expect(cpOf(delta), `${label}: both twins hold the same checkpoint`).toEqual(cpOf(full));
      parity(delta, `${label} (delta twin)`);
      parity(full, `${label} (full twin)`);
    }
    expect(STEP_KINDS.filter((k) => (ran.get(k) ?? 0) === 0), `seed ${seed}: every kind of step ran at least once in its ${STEPS} steps (a kind with no target yet falls back to a new session)`).toEqual([]);
    expect(delta.modes.includes('delta'), `seed ${seed}: the delta twin's projectChanged returned mode 'delta' at least once (the applier calls it)`).toBe(true);
    expect(full.modes.includes('delta'), `seed ${seed}: the always-full twin never deltas`).toBe(false);
  }, 180_000);
});

// ── R23: the single-writer census ───────────────────────────────────────────────────────────────────────────────────────

describe('R23: the only server code that writes the five delegation tables is the full projection and the delta method, and only the adapters and the delta\'s fallback call them', () => {
  const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
  function filesUnder(rel: string, ext: RegExp): string[] {
    const out: string[] = [];
    const rec = (d: string): void => {
      for (const e of readdirSync(path.join(REPO_ROOT, d), { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) rec(p); else if (ext.test(e.name)) out.push(p);
      }
    };
    if (existsSync(path.join(REPO_ROOT, rel))) rec(rel);
    return out.sort();
  }
  /** Drops comment-only lines (TypeScript and shell). */
  const code = (src: string): string => src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*|#)/.test(l)).join('\n');
  /** The enclosing method of each code line: the method tracker of delegation-wave3.integration.test.ts. */
  function linesWithMethod(file: string): Array<{ method: string; line: string }> {
    let inMethod = '';
    const out: Array<{ method: string; line: string }> = [];
    for (const l of code(read(file)).split('\n')) {
      const m = /^ {2}(?:(?:private|public|static|async|readonly)\s+)*([A-Za-z_]\w*)\(/.exec(l) ?? /^(?:export )?(?:async )?function\*? ([A-Za-z_]\w*)/.exec(l);
      if (m !== null && !/^(?:if|for|while|switch|return|catch)$/.test(m[1]!)) inMethod = m[1]!;
      out.push({ method: inMethod, line: l.trim() });
    }
    return out;
  }
  const FILES = filesUnder('server/src', /\.ts$/);
  const WRITE = /\b(INSERT|UPDATE|DELETE)\b[^;]*\bdelegation_(sessions|activities|attempts|leases|lineage)\b/;
  const SQL_CALL = /delegation(Insert|Upsert)Sql\(delegation(Session|Activity|Attempt|Lease|Lineage)Codec/;
  const STORE = 'server/src/coord/store.ts';
  const FULL = 'projectDelegationCheckpoint';
  const DELTA = 'projectDelegationCheckpointChanges';

  it('R23 (1): every code line that writes the five tables, or builds their INSERT or upsert from a codec, sits in the full projection or the delta method', () => {
    const groups: Record<string, string[]> = {};
    for (const f of FILES) for (const { method, line } of linesWithMethod(f)) {
      if (WRITE.test(line) || SQL_CALL.test(line)) (groups[`${f} ${method}`] ??= []).push(line);
    }
    expect(Object.keys(groups).sort(), 'the only methods anywhere in server/src that write the five tables').toEqual([`${STORE} ${FULL}`, `${STORE} ${DELTA}`].sort());
    // the full projection is unchanged: its ten statements, as they stand
    expect(groups[`${STORE} ${FULL}`], 'the full projection\'s statements').toEqual([
      "this.db.prepare('DELETE FROM delegation_lineage').run();",
      "this.db.prepare('DELETE FROM delegation_leases').run();",
      "this.db.prepare('DELETE FROM delegation_attempts').run();",
      "this.db.prepare('DELETE FROM delegation_activities').run();",
      "const deleteSession = this.db.prepare('DELETE FROM delegation_sessions WHERE sessionId = ? AND parentIncarnation = ?');",
      "run(delegationUpsertSql(delegationSessionCodec, ['sessionId', 'parentIncarnation']), delegationSessionCodec, sessions);",
      'run(delegationInsertSql(delegationActivityCodec), delegationActivityCodec, activities);',
      'run(delegationInsertSql(delegationAttemptCodec), delegationAttemptCodec, attempts);',
      'run(delegationInsertSql(delegationLeaseCodec), delegationLeaseCodec, leases);',
      'run(delegationInsertSql(delegationLineageCodec), delegationLineageCodec, lineage);',
    ]);
    // THE DELTA METHOD, structurally (the code task makes the lines concrete; this is what they must add up to): exactly one
    // compare-and-swap UPDATE per table of sessions, activities, attempts and lineage, exactly one `delegationInsertSql` per codec of those
    // four, and NOTHING else that writes the tables: no DELETE, no literal INSERT, no upsert, no lease (a lease never changes in a delta).
    const delta = groups[`${STORE} ${DELTA}`]!;
    const updates = delta.filter((l) => /\bUPDATE\b/.test(l)).flatMap((l) => [...l.matchAll(/\bUPDATE\s+(delegation_\w+)/g)].map((m) => m[1]!)).sort();
    expect(updates, 'the compare-and-swap UPDATEs, one per table, none on delegation_leases').toEqual(['delegation_activities', 'delegation_attempts', 'delegation_lineage', 'delegation_sessions']);
    const inserts = delta.filter((l) => SQL_CALL.test(l)).flatMap((l) => [...l.matchAll(/delegation(Insert|Upsert)Sql\((delegation\w+Codec)/g)].map((m) => `${m[1]!} ${m[2]!}`)).sort();
    expect(inserts, 'the delta\'s statement builders: plain INSERTs for the four, never an upsert, never the lease codec').toEqual([
      'Insert delegationActivityCodec', 'Insert delegationAttemptCodec', 'Insert delegationLineageCodec', 'Insert delegationSessionCodec',
    ]);
    const rest = delta.filter((l) => !/\bUPDATE\b/.test(l) && !SQL_CALL.test(l));
    expect(rest, 'no other write of the five tables in the delta method').toEqual([]);
  });

  it('R23 (3): the only code line under server/src that builds an INSERT or a DELETE by interpolating its table is the codec-built INSERT of delegationInsertSql', () => {
    // a statement that names its table through a template has no `delegation_*` spelling for the census above to find, so every such line is listed
    const interpolated = FILES.flatMap((f) => linesWithMethod(f).filter(({ line }) => /(INSERT INTO|DELETE FROM)\s+\$\{/.test(line)).map(({ method, line }) => `${f} ${method}: ${line}`));
    expect(interpolated, 'every code line that interpolates the table into an INSERT or a DELETE').toEqual([
      "server/src/coord/store.ts delegationInsertSql: return `INSERT INTO ${codec.table} (${codec.columns.join(', ')}) VALUES (${codec.columns.map(() => '?').join(', ')})`;",
    ]);
  });

  it('R23 (2): the callers of the two methods are the watcher\'s adapters and the delta\'s own fallback, nothing else', () => {
    const OLD = /\bprojectDelegationCheckpoint\b/;
    const NEW = /\bprojectDelegationCheckpointChanges\b/;
    const DEFINITION = /^projectDelegationCheckpoint(?:Changes)?\(/;
    const callers: string[] = [];
    for (const f of FILES) for (const { method, line } of linesWithMethod(f)) {
      if (DEFINITION.test(line)) continue;
      if (OLD.test(line)) callers.push(`${f} ${method} calls ${FULL}`);
      if (NEW.test(line)) callers.push(`${f} ${method} calls ${DELTA}`);
    }
    expect(callers.sort(), 'every call site under server/src (the old name is a prefix of the new: word-bounded)').toEqual([
      `${STORE} ${DELTA} calls ${FULL}`,
      `server/src/watch.ts applier calls ${DELTA}`,
      `server/src/watch.ts applier calls ${FULL}`,
    ].sort());
  });
});
