// Delegation broker wave 5, PR5 (Tasks 5.5.2 and 5.5.3): the lease kinds held, carried and freed by the durability layer.
//
// PR5a (reader only) owns W5-J8: `computeHolds` holds every record of an unreleased lease, and a release frees them all and
// closes the lease's opening lineage with the release reason; its records are built by the journal's own record builder. PR5b adds
// W5-J9 to W5-J14 below, driven through the doors themselves.
import { afterEach, describe, it, expect } from 'vitest';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import {
  canonicalDelegationJson,
  delegationSha256Hex,
  deriveDelegationLineageId,
  deriveDelegationRunLineageId,
  encodeDelegationNaturalKey,
  formatDelegationInstant,
  type DelegationCheckpointV1,
  type DelegationJournalEntryV1,
  type DelegationJournalRecordV1,
  type DelegationLeaseRow,
} from '../src/coord/delegation-model.js';
import {
  DELEGATION_CARRIED_FILE,
  DELEGATION_JOURNAL_FILE,
  DELEGATION_RETENTION_FLOOR_MS,
  buildDelegationJournalRecord,
  decodeDelegationJournalLine,
  parseDelegationJournal,
  type DelegationFileHandle,
  type DelegationFilePort,
} from '../src/coord/delegation-journal.js';
import {
  DelegationDurability,
  decodeDelegationCheckpoint,
  encodeDelegationCheckpoint,
  recoverDelegation,
  validateDelegationCheckpoint,
  type DelegationDurabilityDeps,
  type DelegationLeaseTransitionRequest,
  type DelegationProjectionPort,
} from '../src/coord/delegation-checkpoint.js';
import { nodeDelegationFilePort } from '../src/coord/delegation-file-port.js';
import { promoteRunMismatch } from '../src/coord/delegation-lease-state.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PARENT = 'lane-a-demo';
const INC = 'g1';
const T = (s: number): string => formatDelegationInstant(Date.UTC(2026, 10, 10) + s * 1000);
const plus7d = (at: string): string => formatDelegationInstant(Date.parse(at) + 7 * 86_400_000);

const eid = (n: number): string => delegationSha256Hex(`fixture-event-${n}`);
const base = (n: number) => ({
  v: 1 as const, observedAt: T(n), sessionId: PARENT, parentIncarnation: INC, claudeSessionId: '11111111-2222-3333-4444-555555555555',
  eventId: eid(n), bucket: '2026111000', startOffset: n * 100, endOffset: n * 100 + 99,
});
const sessionStart = (n: number): DelegationEventEnvelopeV1 => ({ ...base(n), eventKind: 'SessionStart', source: 'startup' });
const subagentStart = (n: number, agentId: string): DelegationEventEnvelopeV1 => ({ ...base(n), eventKind: 'SubagentStart', agentId, agentType: null });

function chain(entries: readonly DelegationJournalEntryV1[]): DelegationJournalRecordV1[] {
  const out: DelegationJournalRecordV1[] = [];
  let prev: string | null = null;
  entries.forEach((entry, i) => {
    const r = buildDelegationJournalRecord({ sequence: i + 1, acceptedAt: T(1000 + i), previousDigest: prev, entry });
    out.push(r);
    prev = r.digest;
  });
  return out;
}

describe('W5-J8: computeHolds holds an open lease\'s every record, and a release frees them', () => {
  const events = [sessionStart(1), subagentStart(2, 'agent-abc123')];
  const base = chain(events.map((event) => ({ kind: 'evidence-accepted' as const, event })));
  const activityId = recoverDelegation(null, base).state.checkpoint.activities[0]!.activityId;
  const lineageId = deriveDelegationLineageId({ leaseId: 'lease-1', parentId: PARENT, parentIncarnation: INC, activityId });
  const created: DelegationJournalEntryV1 = {
    kind: 'lease-created', leaseId: 'lease-1', generation: 0, activityId, parentId: PARENT, parentIncarnation: INC, project: 'project-a',
    adminRecord: 'wt-1', canonicalPath: '/work/project-a/wt-1', creationBase: null, sourceKind: 'agent', correlationJournalIds: [base[1]!.journalId],
    firstObservedAt: T(3), lineageId,
  };
  const tr = (generation: number, reason: string, to: string, at: string, expiresAt: string | null = null): DelegationJournalEntryV1 => ({
    kind: 'lease-transition', leaseId: 'lease-1', generation, reason, to, at, expiresAt, terminalEvidenceAt: null, runId: null, promotedSession: null,
    auditEvidence: null, lineageClose: null, lineageOpenRun: null, resolvesThrough: null,
  } as DelegationJournalEntryV1);
  const open = [created, tr(1, 'carrier', 'ephemeral', T(4)), { kind: 'lease-carrier-seen', leaseId: 'lease-1', generation: 1, at: T(5) } as DelegationJournalEntryV1,
    tr(2, 'retain', 'retained', T(6), plus7d(T(6)))];
  const released: DelegationJournalEntryV1 = { kind: 'lease-released', leaseId: 'lease-1', generation: 3, releaseReason: 'native-removed', at: T(9), lastHeadSha: null, resolvesThrough: null };

  it('an unreleased lease holds its creating record, its evidence and every transition record, as open-lease and open-lineage', () => {
    const records = chain([...base.map((r) => r.entry), ...open]);
    const report = recoverDelegation(null, records);
    expect(report.failure).toBeNull();
    const held = (reason: string) => report.state.checkpoint.pruningHolds.filter((h) => h.reason === reason).map((h) => h.journalId).sort();
    const want = [base[1]!.journalId, ...records.slice(2).map((r) => r.journalId)].sort();
    expect(held('open-lease')).toEqual(want);
    expect(held('open-lineage')).toEqual(want);
  });

  it('after lease-released no record of that lease is held, and its opening lineage is closed with the release reason', () => {
    const records = chain([...base.map((r) => r.entry), ...open, released]);
    const report = recoverDelegation(null, records);
    expect(report.failure).toBeNull();
    const cp = report.state.checkpoint;
    expect(cp.pruningHolds.filter((h) => h.reason === 'open-lease' || h.reason === 'open-lineage')).toEqual([]);
    expect(cp.lineage.find((n) => n.lineageId === lineageId)).toMatchObject({ closedAt: T(9), closeReason: 'native-removed' });
    expect(cp.leases[0]).toMatchObject({ releasedAt: T(9), generation: 3, disposition: 'retained' });
    expect(cp.leaseCarriers).toEqual([{ leaseId: 'lease-1', transferringSince: null, transferRun: null, promotedRun: null, promotedSession: null,
      releaseReason: 'native-removed', resolvedThrough: null }]);
  });
});

describe('F6: a checkpoint main\'s code wrote reads back byte-identical on this build (the reader-only floor changes no bytes)', () => {
  // `fixtures/delegation-checkpoint-main.json` was built by main's own fold at the PR5a merge base (a520aaace), from fixture data only:
  // three evidence records and one `lease-created`, so it holds sessions, activities, a lease, its lineage and the pruning holds.
  const bytes = new Uint8Array(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'delegation-checkpoint-main.json')));

  it('decodes, validates, and re-encodes to the same bytes, with no leaseCarriers member', () => {
    const cp = decodeDelegationCheckpoint(bytes);
    expect(cp.leases).toHaveLength(1);
    expect(Object.keys(cp)).not.toContain('leaseCarriers');
    expect(() => validateDelegationCheckpoint(cp, null)).not.toThrow();
    expect(Buffer.from(encodeDelegationCheckpoint(cp)).equals(Buffer.from(bytes))).toBe(true);
  });
});

// ── PR5b (Task 5.5.3): the doors, on a real store ───────────────────────────────────────────────────────────────────────────
//
// An applier over a fixture directory and a real `CoordStore` (`openCoordDb` on an `mkTmp` path), its projection port the store's own
// with every `projectChanged` mode logged, a fault seam on the durability edges, and a counted `randomUUID`. Fixture data only: a parent
// session, an agent that ran and stopped (its lease `wt-x`), a raw Bash call that made `wt-r` (its lease), evidence inside that call's
// ±20-minute window, and filler, all on day 0 and day 1, so a compaction at day 12 with the 10-day floor puts them below the cut.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const D0 = Date.UTC(2026, 10, 1);
const iso = (ms: number): string => formatDelegationInstant(ms);
let serial = 0;
const at = (ms: number) => {
  const n = ++serial;
  return {
    v: 1 as const, observedAt: iso(ms), sessionId: PARENT, parentIncarnation: INC, claudeSessionId: '11111111-2222-3333-4444-555555555555',
    eventId: delegationSha256Hex(`pr5b-door-event-${n}`), bucket: '2026110100', startOffset: n * 100, endOffset: n * 100 + 99,
  };
};
const ss = (ms: number): DelegationEventEnvelopeV1 => ({ ...at(ms), eventKind: 'SessionStart', source: 'startup' });
const sStart = (ms: number, agentId: string): DelegationEventEnvelopeV1 => ({ ...at(ms), eventKind: 'SubagentStart', agentId, agentType: null });
const sStop = (ms: number, agentId: string): DelegationEventEnvelopeV1 =>
  ({ ...at(ms), eventKind: 'SubagentStop', agentId, agentType: null, agentTranscriptPath: null });
const pre = (ms: number, toolUseId: string, listing: readonly string[]): DelegationEventEnvelopeV1 =>
  ({ ...at(ms), eventKind: 'PreToolUse', toolName: 'Bash', toolUseId, listing });
const post = (ms: number, toolUseId: string, listing: readonly string[]): DelegationEventEnvelopeV1 =>
  ({ ...at(ms), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId, outcome: 'completed', listing });

class InjectedFault extends Error {}
const noSync = (h: DelegationFileHandle): DelegationFileHandle => ({ write: (b) => h.write(b), sync: async () => undefined, close: () => h.close() });
const quickPort: DelegationFilePort = {
  ...nodeDelegationFilePort,
  openAppend: async (p) => noSync(await nodeDelegationFilePort.openAppend(p)),
  createTemp: async (p) => noSync(await nodeDelegationFilePort.createTemp(p)),
  fsyncDir: async () => undefined,
  fsyncFile: async () => undefined,
};
const opened: DelegationDurability[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map((d) => d.close().catch(() => undefined))); });

interface Rig {
  dir: string;
  store: CoordStore;
  clock: { ms: number };
  ctl: { fault: string | null };
  /** The mode of every `projectChanged` call, in order, and a `project` entry for every full projection. */
  modes: string[];
  uuids: { n: number };
  open: () => Promise<DelegationDurability>;
}
function rig(): Rig {
  const dir = mkTmp('ccrc-deleg-lease-doors-');
  const store = new CoordStore(openCoordDb(path.join(dir, 'coord.db')));
  store.db.exec('PRAGMA synchronous = OFF');
  const clock = { ms: D0 };
  const ctl: Rig['ctl'] = { fault: null };
  const modes: string[] = [];
  const uuids = { n: 0 };
  const projection: DelegationProjectionPort = {
    project: (cp) => { modes.push('project'); store.projectDelegationCheckpoint(cp); },
    projectChanged: (prior, next) => { const r = store.projectDelegationCheckpointChanges(prior, next); modes.push(r.mode); return r; },
    insertEvents: (rows) => store.insertDelegationEvents(rows),
    eventStats: () => store.delegationEventStats(),
    countEventsAtOrBelow: (s) => store.countDelegationEventsAtOrBelow(s),
    deleteEventsBetween: (a, b, n) => store.deleteDelegationEventsBetween(a, b, n),
  };
  const deps: DelegationDurabilityDeps = {
    dir, projection, port: quickPort, now: () => clock.ms,
    randomUUID: () => `00000000-0000-4000-8000-${String(++uuids.n).padStart(12, '0')}`,
    onEdge: (edge, when) => { if (ctl.fault === `${edge}:${when}`) { ctl.fault = null; throw new InjectedFault(`injected at ${edge}:${when}`); } },
  };
  return { dir, store, clock, ctl, modes, uuids, open: async () => { const d = await DelegationDurability.open(deps); opened.push(d); return d; } };
}

const apply = (dur: DelegationDurability, events: readonly DelegationEventEnvelopeV1[]) =>
  dur.applyAccepted({ accepted: events.map((event) => ({ event, acceptedAt: iso(Date.parse(event.observedAt) + 1000) })), cursor: null, interval: null });
const activityOf = (dur: DelegationDurability, sourceKind: 'agent' | 'bash-worktree', upstreamId: string): string => {
  const id = dur.state().checkpoint.activityIdsByNaturalKey[encodeDelegationNaturalKey({ parentId: PARENT, parentIncarnation: INC, sourceKind, upstreamId })];
  if (id === undefined) throw new Error(`no activity for ${sourceKind} ${upstreamId}`);
  return id;
};
const leaseOf = (dur: DelegationDurability, leaseId: string): DelegationLeaseRow => {
  const l = dur.state().checkpoint.leases.find((x) => x.leaseId === leaseId);
  if (l === undefined) throw new Error(`no lease ${leaseId}`);
  return l as DelegationLeaseRow;
};
const sqlLease = (r: Rig, leaseId: string) =>
  r.store.db.prepare('SELECT disposition, generation, releasedAt FROM delegation_leases WHERE leaseId = ?').get(leaseId) as { disposition: string; generation: number; releasedAt: number | null };
const journalRecords = (dir: string): DelegationJournalRecordV1[] => {
  const p = path.join(dir, DELEGATION_JOURNAL_FILE);
  return existsSync(p) ? parseDelegationJournal(new Uint8Array(readFileSync(p))) : [];
};
const carriedRecords = (dir: string): DelegationJournalRecordV1[] => {
  const p = path.join(dir, DELEGATION_CARRIED_FILE);
  if (!existsSync(p)) return [];
  return new TextDecoder().decode(readFileSync(p)).split('\n').filter((l) => l !== '').map((l) => decodeDelegationJournalLine(new TextEncoder().encode(l)));
};
const withoutRevision = (cp: unknown): string => canonicalDelegationJson({ ...(cp as DelegationCheckpointV1), revision: 0 });

const transition = (over: Partial<DelegationLeaseTransitionRequest> & Pick<DelegationLeaseTransitionRequest, 'leaseId' | 'reason' | 'expectGeneration'>): DelegationLeaseTransitionRequest => ({
  at: iso(D0 + DAY + 3 * HOUR), expiresAt: null, terminalEvidenceAt: null, runId: null, promotedSession: null, auditEvidence: null,
  carrierRequired: false, resolvesThrough: null, ...over,
});
const adoptAt = (leaseId: string, expectGeneration: number, ms: number): DelegationLeaseTransitionRequest => transition({
  leaseId, reason: 'adopt', expectGeneration, at: iso(ms), expiresAt: iso(ms + 7 * DAY), terminalEvidenceAt: iso(D0 + 2 * MIN),
});

/** The fixture: two leases on day 0/1 (`x` an agent's, `r` a raw call's), no transition yet, every record accepted before day 2. */
async function leased(r: Rig = rig()): Promise<{ r: Rig; dur: DelegationDurability; x: string; r1: string; windowIds: string[] }> {
  const dur = await r.open();
  await apply(dur, [ss(D0), sStart(D0 + MIN, 'agent-x'), sStop(D0 + 2 * MIN, 'agent-x'), ...Array.from({ length: 120 }, (_, i) => ss(D0 + HOUR + i * 10_000))]);
  const xStart = journalRecords(r.dir).find((rec) => rec.entry.kind === 'evidence-accepted' && rec.entry.event.eventKind === 'SubagentStart')!;
  r.clock.ms = D0 + 30 * MIN;
  const x = await dur.createLease({ activityId: activityOf(dur, 'agent', 'agent-x'), parentId: PARENT, parentIncarnation: INC, project: 'project-a',
    adminRecord: 'wt-x', canonicalPath: '/work/project-a/.claude/worktrees/x', creationBase: null, sourceKind: 'agent',
    correlationJournalIds: [xStart.journalId], firstObservedAt: iso(D0 + MIN) });
  const D1 = D0 + DAY;
  // The raw call at D1+10..12 min; `agent-window` and one SessionStart lie inside its ±20-minute window and nothing else holds them.
  const inWindow = [sStart(D1 + 15 * MIN, 'agent-window'), sStop(D1 + 16 * MIN, 'agent-window'), ss(D1 + 25 * MIN)];
  await apply(dur, [pre(D1 + 10 * MIN, 'toolu_raw', ['wt-a']), post(D1 + 12 * MIN, 'toolu_raw', ['wt-a', 'wt-r']), ...inWindow,
    ...Array.from({ length: 120 }, (_, i) => ss(D1 + 2 * HOUR + i * 10_000))]);
  r.clock.ms = D1 + 50 * MIN;
  const raw = await dur.createLease({ activityId: activityOf(dur, 'bash-worktree', 'toolu_raw'), parentId: PARENT, parentIncarnation: INC, project: 'project-a',
    adminRecord: 'wt-r', canonicalPath: '/work/project-a/.claude/worktrees/r', creationBase: null, sourceKind: 'raw', correlationJournalIds: [],
    firstObservedAt: iso(D1 + 12 * MIN) });
  if (x.kind !== 'created' || raw.kind !== 'created') throw new Error('the fixture leases were not created');
  r.clock.ms = D1 + 2 * HOUR;
  const windowIds = inWindow.map((e) => journalRecords(r.dir).find((rec) => rec.entry.kind === 'evidence-accepted' && rec.entry.event.eventId === e.eventId)!.journalId);
  return { r, dur, x: x.leaseId, r1: raw.leaseId, windowIds };
}

describe('PR5b Task 5.5.3: the lease doors beside createLease', () => {
  it('W5-J9: adopt appends one record, checkpoints and projects by delta; the same request again answers unchanged and appends nothing', async () => {
    const { r, dur, x } = await leased();
    expect(await dur.transitionLease(transition({ leaseId: x, reason: 'carrier', expectGeneration: 0 }))).toMatchObject({ kind: 'applied', generation: 1, state: 'ephemeral' });
    const before = journalRecords(r.dir).length;
    r.modes.length = 0;
    const out = await dur.transitionLease(adoptAt(x, 1, D0 + DAY + 3 * HOUR));
    expect(out).toMatchObject({ kind: 'applied', leaseId: x, generation: 2, state: 'adopted' });
    expect(journalRecords(r.dir).length, 'one record appended').toBe(before + 1);
    expect(out.kind === 'applied' && out.sequence).toBe(journalRecords(r.dir).at(-1)!.sequence);
    expect(out.kind === 'applied' && out.applied.projection.status).toBe('projected');
    expect(r.modes, 'the projection ran in delta mode').toEqual(['delta']);
    expect(sqlLease(r, x)).toMatchObject({ disposition: 'adopted', generation: 2 });
    expect(leaseOf(dur, x)).toMatchObject({ disposition: 'adopted', generation: 2, currentJournalSequence: journalRecords(r.dir).at(-1)!.sequence });
    const again = await dur.transitionLease(adoptAt(x, 1, D0 + DAY + 4 * HOUR));
    expect(again).toEqual({ kind: 'unchanged', leaseId: x, generation: 2, state: 'adopted' });
    expect(journalRecords(r.dir).length, 'the replay appends nothing').toBe(before + 1);
  });

  it('W5-J9b: the door honours carrierRequired; recovery folds the applied entry with carrierRequired false', async () => {
    const { r, dur, x } = await leased();
    await dur.transitionLease(transition({ leaseId: x, reason: 'carrier', expectGeneration: 0 }));
    expect(await dur.noteCarrierSeen({ leaseId: x, generation: 1, at: iso(D0 + DAY + 2 * HOUR) })).toMatchObject({ kind: 'applied' });
    const keep = (expectGeneration: number, carrierRequired: boolean) => transition({ leaseId: x, reason: 'retain', expectGeneration, carrierRequired,
      at: iso(D0 + DAY + 3 * HOUR), expiresAt: iso(D0 + 8 * DAY + 3 * HOUR) });
    expect(await dur.transitionLease(keep(1, true))).toMatchObject({ kind: 'applied', generation: 2, state: 'retained' });
    expect(await dur.transitionLease(keep(2, false))).toMatchObject({ kind: 'applied', generation: 3, state: 'retained' });
    expect(leaseOf(dur, x)).toMatchObject({ generation: 3, carrierGenerationSeen: 1 });
    expect(await dur.noteCarrierSeen({ leaseId: x, generation: 2, at: iso(D0 + DAY + 4 * HOUR) })).toMatchObject({ kind: 'applied' });
    const n = journalRecords(r.dir).length;
    const refused = await dur.transitionLease(keep(3, true));
    expect(refused).toMatchObject({ kind: 'refused', refusal: 'carrier-behind' });
    expect(journalRecords(r.dir).length, 'a refusal appends nothing').toBe(n);
    expect(await dur.transitionLease(keep(3, false))).toMatchObject({ kind: 'applied', generation: 4 });
    const fresh = recoverDelegation(null, journalRecords(r.dir));
    expect(fresh.failure).toBeNull();
    expect(fresh.state.checkpoint.leases.find((l) => l.leaseId === x)).toMatchObject({ generation: 4, carrierGenerationSeen: 2, disposition: 'retained' });
  });

  it('W5-J9c: promote on a transferring lease closes its lineage with transfer and opens a run-owned row for the request\'s run', async () => {
    const { dur, x } = await leased();
    await dur.transitionLease(transition({ leaseId: x, reason: 'carrier', expectGeneration: 0 }));
    expect(await dur.transitionLease(transition({ leaseId: x, reason: 'transfer', expectGeneration: 1, runId: 11 }))).toMatchObject({ kind: 'applied', state: 'transferring' });
    const out = await dur.transitionLease(transition({ leaseId: x, reason: 'promote', expectGeneration: 2, runId: 11, promotedSession: 'lane-a-demo-child', at: iso(D0 + DAY + 5 * HOUR) }));
    expect(out).toMatchObject({ kind: 'applied', generation: 3, state: 'promoted' });
    const cp = dur.state().checkpoint;
    const opening = deriveDelegationLineageId({ leaseId: x, parentId: PARENT, parentIncarnation: INC, activityId: leaseOf(dur, x).activityId });
    expect(cp.lineage.find((n) => n.lineageId === opening)).toMatchObject({ closedAt: iso(D0 + DAY + 5 * HOUR), closeReason: 'transfer' });
    const runRow = cp.lineage.find((n) => n.runId === 11);
    expect(runRow).toMatchObject({ lineageId: deriveDelegationRunLineageId({ leaseId: x, parentId: PARENT, parentIncarnation: INC, runId: 11 }),
      parentId: PARENT, parentIncarnation: INC, leaseId: null, activityId: null, openedAt: iso(D0 + DAY + 5 * HOUR), closedAt: null });
    expect(cp.leaseCarriers?.find((c) => c.leaseId === x)).toMatchObject({ transferringSince: null, transferRun: null, promotedRun: 11, promotedSession: 'lane-a-demo-child' });
  });

  it('W5-J9c (D-8024): the door refuses a promote whose runId is not the transfer\'s run, appending nothing; replay\'s fold stays as PR5a left it', async () => {
    const { r, dur, x } = await leased();
    await dur.transitionLease(transition({ leaseId: x, reason: 'carrier', expectGeneration: 0 }));
    await dur.transitionLease(transition({ leaseId: x, reason: 'transfer', expectGeneration: 1, runId: 11 }));
    const n = journalRecords(r.dir).length;
    const out = await dur.transitionLease(transition({ leaseId: x, reason: 'promote', expectGeneration: 2, runId: 12, promotedSession: 'lane-a-demo-child' }));
    expect(out).toMatchObject({ kind: 'refused', refusal: 'wrong-disposition', detail: expect.stringContaining('run 11, not run 12') });
    expect(journalRecords(r.dir).length, 'nothing appended').toBe(n);
    expect(leaseOf(dur, x).generation).toBe(2);
    // The missing-carrier and null-transferRun arms (states no fold can build) fail shut too, through the door's one check.
    expect(promoteRunMismatch(undefined, 11)).toContain('no carrier row');
    expect(promoteRunMismatch({ leaseId: x, transferringSince: iso(D0), transferRun: null, promotedRun: null, promotedSession: null, releaseReason: null, resolvedThrough: null }, 11))
      .toContain('names no transfer run');
    expect(promoteRunMismatch({ leaseId: x, transferringSince: iso(D0), transferRun: 11, promotedRun: null, promotedSession: null, releaseReason: null, resolvedThrough: null }, 11)).toBeNull();
  });

  it('W5-J10: compaction carries an open lease\'s creating and transition records, recovers byte-equal, and carries none once it is released', async () => {
    const { r, dur, x } = await leased();
    await dur.transitionLease(transition({ leaseId: x, reason: 'carrier', expectGeneration: 0, at: iso(D0 + DAY + 3 * HOUR) }));
    await dur.noteCarrierSeen({ leaseId: x, generation: 1, at: iso(D0 + DAY + 3 * HOUR) });
    await dur.transitionLease(adoptAt(x, 1, D0 + DAY + 4 * HOUR));
    const own = journalRecords(r.dir).filter((rec) => rec.entry.kind !== 'evidence-accepted' && rec.entry.leaseId === x).map((rec) => rec.journalId);
    expect(own).toHaveLength(4);
    r.clock.ms = D0 + 12 * DAY;
    await apply(dur, Array.from({ length: 20 }, (_, i) => ss(D0 + 12 * DAY - HOUR + i * 1000)));
    const before = withoutRevision(dur.state().checkpoint);
    const out = await dur.compactJournal(D0 + 12 * DAY, DELEGATION_RETENTION_FLOOR_MS);
    expect(out.kind).toBe('compacted');
    const carried = new Set(carriedRecords(r.dir).map((rec) => rec.journalId));
    for (const id of own) expect(carried.has(id), `carried ${id}`).toBe(true);
    const fresh = await r.open();
    expect(fresh.failure()).toBeNull();
    expect(withoutRevision(fresh.state().checkpoint), 'recovery from the compacted pair').toBe(before);
    await fresh.close();
    const rel = await dur.releaseLease({ leaseId: x, expectGeneration: 2, releaseReason: 'native-removed', at: iso(D0 + 12 * DAY + MIN), lastHeadSha: null, resolvesThrough: null });
    expect(rel).toMatchObject({ kind: 'applied', generation: 3, state: 'released' });
    r.clock.ms = D0 + 13 * DAY;
    await apply(dur, Array.from({ length: 200 }, (_, i) => ss(D0 + 12 * DAY + HOUR + i * 1000)));
    expect((await dur.compactJournal(D0 + 24 * DAY, DELEGATION_RETENTION_FLOOR_MS)).kind).toBe('compacted');
    const after = new Set(carriedRecords(r.dir).map((rec) => rec.journalId));
    for (const id of own) expect(after.has(id), `no longer carried ${id}`).toBe(false);
  });

  it('W5-J10b: an unreleased raw lease carries the evidence in its ±20-minute window (K5); once released, none of it is carried on its account', async () => {
    const { r, dur, r1, windowIds } = await leased();
    r.clock.ms = D0 + 12 * DAY;
    await apply(dur, Array.from({ length: 20 }, (_, i) => ss(D0 + 12 * DAY - HOUR + i * 1000)));
    const first = await dur.compactJournal(D0 + 12 * DAY, DELEGATION_RETENTION_FLOOR_MS);
    if (first.kind !== 'compacted') throw new Error(`expected a compaction, got ${first.kind}`);
    for (const id of windowIds) expect(first.plan.carried.find((l) => l.journalId === id)?.reasons, `carried ${id}`).toContain('raw-lease-window');
    const rel = await dur.releaseLease({ leaseId: r1, expectGeneration: 0, releaseReason: 'native-removed', at: iso(D0 + 12 * DAY + MIN), lastHeadSha: null, resolvesThrough: null });
    expect(rel).toMatchObject({ kind: 'applied', generation: 1, state: 'released' });
    r.clock.ms = D0 + 13 * DAY;
    await apply(dur, Array.from({ length: 200 }, (_, i) => ss(D0 + 12 * DAY + HOUR + i * 1000)));
    const second = await dur.compactJournal(D0 + 24 * DAY, DELEGATION_RETENTION_FLOOR_MS);
    if (second.kind !== 'compacted') throw new Error(`expected a compaction, got ${second.kind}`);
    for (const id of windowIds) expect(second.plan.carried.find((l) => l.journalId === id)?.reasons ?? [], `not carried for the window ${id}`).not.toContain('raw-lease-window');
  });

  it('W5-J11: a fault after the journal fsync and before the checkpoint rename replays the transition once on recover', async () => {
    const { r, dur, x } = await leased();
    await dur.transitionLease(transition({ leaseId: x, reason: 'carrier', expectGeneration: 0 }));
    r.ctl.fault = 'checkpoint-rename:before';
    await expect(dur.transitionLease(adoptAt(x, 1, D0 + DAY + 3 * HOUR))).rejects.toBeInstanceOf(InjectedFault);
    const n = journalRecords(r.dir).length;
    await dur.recover();
    expect(dur.failure()).toBeNull();
    expect(leaseOf(dur, x)).toMatchObject({ disposition: 'adopted', generation: 2 });
    expect(await dur.transitionLease(adoptAt(x, 1, D0 + DAY + 3 * HOUR)), 'the caller\'s retry is the replay').toMatchObject({ kind: 'unchanged', generation: 2 });
    expect(journalRecords(r.dir).length).toBe(n);
  });

  it('W5-J12: releaseLease frees the canonical path for a new lease (D18)', async () => {
    const { r, dur, x } = await leased();
    await apply(dur, [sStart(D0 + DAY + 3 * HOUR, 'agent-y'), sStop(D0 + DAY + 3 * HOUR + MIN, 'agent-y')]);
    const request = { activityId: activityOf(dur, 'agent', 'agent-y'), parentId: PARENT, parentIncarnation: INC, project: 'project-a', adminRecord: 'wt-x2',
      canonicalPath: '/work/project-a/.claude/worktrees/x', creationBase: null, sourceKind: 'agent' as const, correlationJournalIds: [], firstObservedAt: iso(D0 + DAY + 3 * HOUR) };
    expect(await dur.createLease(request)).toMatchObject({ kind: 'refused', reason: 'canonical-path-held', heldBy: x });
    r.clock.ms = D0 + DAY + 4 * HOUR;
    expect(await dur.releaseLease({ leaseId: x, expectGeneration: 0, releaseReason: 'native-removed', at: iso(D0 + DAY + 4 * HOUR), lastHeadSha: null, resolvesThrough: null }))
      .toMatchObject({ kind: 'applied', state: 'released' });
    expect(leaseOf(dur, x).releasedAt).toBe(iso(D0 + DAY + 4 * HOUR));
    expect(sqlLease(r, x).releasedAt, 'SQLite holds the instant as epoch ms').toBe(D0 + DAY + 4 * HOUR);
    expect(await dur.createLease(request)).toMatchObject({ kind: 'created' });
    expect(await dur.releaseLease({ leaseId: x, expectGeneration: 0, releaseReason: 'native-removed', at: iso(D0 + DAY + 5 * HOUR), lastHeadSha: null, resolvesThrough: null }),
      'the release again is its replay').toEqual({ kind: 'unchanged', leaseId: x, generation: 1, state: 'released' });
  });

  it('W5-J13: noteCarrierSeen refuses a generation above the lease\'s, and otherwise moves neither the generation nor the current sequence', async () => {
    const { r, dur, x } = await leased();
    await dur.transitionLease(transition({ leaseId: x, reason: 'carrier', expectGeneration: 0 }));
    const lease = leaseOf(dur, x);
    expect(await dur.noteCarrierSeen({ leaseId: x, generation: 2, at: iso(D0 + DAY + 3 * HOUR) })).toMatchObject({ kind: 'refused', refusal: 'stale-generation' });
    const out = await dur.noteCarrierSeen({ leaseId: x, generation: 1, at: iso(D0 + DAY + 3 * HOUR) });
    expect(out).toMatchObject({ kind: 'applied', generation: 1, state: 'ephemeral' });
    expect(leaseOf(dur, x)).toMatchObject({ carrierGenerationSeen: 1, generation: 1, currentJournalSequence: lease.currentJournalSequence });
    const n = journalRecords(r.dir).length;
    expect(await dur.noteCarrierSeen({ leaseId: x, generation: 1, at: iso(D0 + DAY + 4 * HOUR) })).toEqual({ kind: 'unchanged', leaseId: x, generation: 1, state: 'ephemeral' });
    expect(journalRecords(r.dir).length).toBe(n);
    // review 1451 F9: a released lease's carrier is still read back, through the replay fold's own decision.
    await dur.releaseLease({ leaseId: x, expectGeneration: 1, releaseReason: 'native-removed', at: iso(D0 + DAY + 5 * HOUR), lastHeadSha: null, resolvesThrough: null });
    expect(await dur.noteCarrierSeen({ leaseId: x, generation: 2, at: iso(D0 + DAY + 6 * HOUR) })).toMatchObject({ kind: 'applied', generation: 2, state: 'released' });
    expect(recoverDelegation(null, journalRecords(r.dir)).state.checkpoint.leases.find((l) => l.leaseId === x)).toMatchObject({ carrierGenerationSeen: 2 });
  });

  it('W5-J14: the three doors never call randomUUID', async () => {
    const { r, dur, x, r1 } = await leased();
    const minted = r.uuids.n;
    await dur.transitionLease(transition({ leaseId: x, reason: 'carrier', expectGeneration: 0 }));
    await dur.noteCarrierSeen({ leaseId: x, generation: 1, at: iso(D0 + DAY + 3 * HOUR) });
    await dur.transitionLease(adoptAt(x, 1, D0 + DAY + 4 * HOUR));
    await dur.releaseLease({ leaseId: r1, expectGeneration: 0, releaseReason: 'native-removed', at: iso(D0 + DAY + 5 * HOUR), lastHeadSha: null, resolvesThrough: null });
    expect(r.uuids.n).toBe(minted);
  });

  it('a door on an applier that is not ready answers not-ready and writes nothing', async () => {
    const { r, dur, x } = await leased();
    r.ctl.fault = 'checkpoint-rename:before';
    await expect(dur.transitionLease(transition({ leaseId: x, reason: 'carrier', expectGeneration: 0 }))).rejects.toBeInstanceOf(InjectedFault);
    const n = journalRecords(r.dir).length;
    expect(await dur.releaseLease({ leaseId: x, expectGeneration: 0, releaseReason: 'native-removed', at: iso(D0 + DAY + 5 * HOUR), lastHeadSha: null, resolvesThrough: null }))
      .toMatchObject({ kind: 'refused', refusal: 'not-ready' });
    expect(await dur.noteCarrierSeen({ leaseId: x, generation: 1, at: iso(D0 + DAY + 3 * HOUR) })).toMatchObject({ kind: 'refused', refusal: 'not-ready' });
    expect(journalRecords(r.dir).length).toBe(n);
  });
});
