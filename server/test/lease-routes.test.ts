// Delegation broker wave 5, PR8 (Task 5.8.2): the three lease doors over a real server, a real `CoordStore` and a real applier.
//
//   POST /api/leases/:lease/retain           a lease parent's (or its coordinator's) keep: box token, attribution, EXEMPT
//   POST /api/leases/:lease/operator-retain  the operator's keep: session-gated when armed, no box token
//   POST /api/leases/:lease/resolve          the operator's attach or "not delegated": session-gated when armed, no box token
//
// Rows W5-R9 to W5-R12d of the plan's "## PR8", under O5-8 (c). The applier is a `DelegationDurability` over the fixture home's
// coordination directory and the server's own `CoordStore` (so every door commits through the real SQLite projection); the route
// reaches it through a stand-in watcher. Every directory is a FIXTURE home: nothing reads the live `~/.ccrc` or `~/.cc-sessions`, no ccd
// verb runs, and the box token is a test constant. Fixture names: `lane-a-demo`, `lane-b-demo`, `coord-a-demo`, `project-a`.
import { afterEach, describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Bus } from '../src/bus.js';
import { buildServer, type Deps } from '../src/server.js';
import type { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  DelegationDurability,
  assertDelegationCheckpointProjectable,
  validateDelegationCheckpoint,
  type DelegationProjectionPort,
} from '../src/coord/delegation-checkpoint.js';
import { DELEGATION_JOURNAL_FILE, parseDelegationJournal, type DelegationFileHandle, type DelegationFilePort } from '../src/coord/delegation-journal.js';
import { nodeDelegationFilePort } from '../src/coord/delegation-file-port.js';
import {
  delegationSha256Hex, encodeDelegationNaturalKey, formatDelegationInstant,
  type DelegationAttemptRow, type DelegationCheckpointV1, type DelegationLeaseRow,
} from '../src/coord/delegation-model.js';
import { conflictingTreeKeys, delegationTreeTarget } from '../src/coord/delegation-conflicts.js';
import { delegationTreeKey } from '../src/coord/delegation-correlation.js';
import { projectDelegation } from '../src/coord/delegation-projection.js';
import { LEASE_MARK_CAP, LEASE_MARK_LOCK_CAP, ORPHAN_LEASE_CAP } from '../src/ccdargv.js';
import { LEASE_DOOR_REFUSALS, type DelegationEventEnvelopeV1 } from '../../shared/api.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };
const PARENT = { id: 'lane-a-demo', uuid: 'a'.repeat(36) };
const OTHER = { id: 'lane-b-demo', uuid: 'b'.repeat(36) };
const COORD = { id: 'coord-a-demo', uuid: 'c'.repeat(36) };
const INC = '0189abcd-1234-4678-9abc-0123456789ab';
const INC2 = '7f3c9a10-5555-4aaa-8bbb-0123456789cd';
const OTHER_INC = '3a3a3a3a-0000-4000-8000-0123456789ab';
const UNKNOWN = '0f8e6a8c-1b2d-4c3e-9f00-0123456789ab';
const DAY = 86_400_000;
const FULL_CAPS = ['caps', LEASE_MARK_CAP, LEASE_MARK_LOCK_CAP, ORPHAN_LEASE_CAP];

/** One registry row (uuid and generation), the shape the attribution gate and the incarnation read measure. */
const seed = (home: string, who: { id: string; uuid: string }, generation: string | null = INC): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = { wrapper: 'claude', project: 'project-a', workdir: `/w/project-a/${who.id}`, uuid: who.uuid, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${who.id}.${k}`), v);
  if (generation !== null) writeFileSync(path.join(reg, `${who.id}.generation`), generation);
};

// ── the events that open the two fixture activities (an agent that ran and stopped, a raw Bash call that made a worktree) ─────

const MIN = 60_000;
const D0 = Date.UTC(2026, 10, 1);
const iso = (ms: number): string => formatDelegationInstant(ms);
let serial = 0;
const ev = (ms: number) => {
  const n = ++serial;
  return {
    v: 1 as const, observedAt: iso(ms), sessionId: PARENT.id, parentIncarnation: INC, claudeSessionId: '11111111-2222-3333-4444-555555555555',
    eventId: delegationSha256Hex(`pr8-door-event-${n}`), bucket: '2026110100', startOffset: n * 100, endOffset: n * 100 + 99,
  };
};
const ss = (ms: number): DelegationEventEnvelopeV1 => ({ ...ev(ms), eventKind: 'SessionStart', source: 'startup' });
const sStart = (ms: number, agentId: string): DelegationEventEnvelopeV1 => ({ ...ev(ms), eventKind: 'SubagentStart', agentId, agentType: null });
const sStop = (ms: number, agentId: string): DelegationEventEnvelopeV1 =>
  ({ ...ev(ms), eventKind: 'SubagentStop', agentId, agentType: null, agentTranscriptPath: null });
const pre = (ms: number, toolUseId: string, listing: readonly string[]): DelegationEventEnvelopeV1 =>
  ({ ...ev(ms), eventKind: 'PreToolUse', toolName: 'Bash', toolUseId, listing });
const post = (ms: number, toolUseId: string, listing: readonly string[]): DelegationEventEnvelopeV1 =>
  ({ ...ev(ms), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId, outcome: 'completed', listing });

const noSync = (h: DelegationFileHandle): DelegationFileHandle => ({ write: (b) => h.write(b), sync: async () => undefined, close: () => h.close() });
const quickPort: DelegationFilePort = {
  ...nodeDelegationFilePort,
  openAppend: async (p) => noSync(await nodeDelegationFilePort.openAppend(p)),
  createTemp: async (p) => noSync(await nodeDelegationFilePort.createTemp(p)),
  fsyncDir: async () => undefined,
  fsyncFile: async () => undefined,
};

interface World {
  home: string;
  app: FastifyInstance;
  coord: CoordStore;
  durable: DelegationDurability;
  fleet: { ccdVerbs: string[] | null };
  uuids: { n: number };
  /** The agent's lease (`wt-x`) and the raw call's lease (`wt-r`), each with its carrier minted and read back at generation 1. */
  x: string;
  r: string;
  /** The applier the route reaches: the real one, or a wrapper a row puts in its place. */
  route: { applier: unknown };
}
const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((close) => close().catch(() => undefined))); });

async function world(opts: { armed?: boolean; caps?: string[] | null } = {}): Promise<World> {
  const home = mkTmp('ccrc-lease-routes-');
  seed(home, PARENT); seed(home, OTHER); seed(home, COORD);
  const base = testDeps(home);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  coord.db.exec('PRAGMA synchronous = OFF');
  const fleet = { connected: true, downSince: null, ccdVerbs: opts.caps === undefined ? FULL_CAPS : opts.caps };
  const deps: Deps = { ...base, cfg: { ...base.cfg, authEnabled: opts.armed ?? false }, mailToken: TOKEN, coord, fleetState: fleet as never };
  const projection: DelegationProjectionPort = {
    project: (cp) => coord.projectDelegationCheckpoint(cp),
    projectChanged: (prior, next) => coord.projectDelegationCheckpointChanges(prior, next),
    insertEvents: (rows) => coord.insertDelegationEvents(rows),
    eventStats: () => coord.delegationEventStats(),
    countEventsAtOrBelow: (s) => coord.countDelegationEventsAtOrBelow(s),
    deleteEventsBetween: (a, b, n) => coord.deleteDelegationEventsBetween(a, b, n),
  };
  const uuids = { n: 0 };
  const clock = { ms: D0 };
  const durable = await DelegationDurability.open({
    dir: deps.cfg.ccrcDir, projection, port: quickPort, now: () => clock.ms,
    randomUUID: () => `00000000-0000-4000-8000-${String(++uuids.n).padStart(12, '0')}`,
  });
  const route = { applier: durable as unknown };
  const standIn = { stop: () => undefined, serverCapsSettled: async () => {}, delegationApplier: () => Promise.resolve(route.applier) } as unknown as FleetWatcher;
  const app = await buildServer(deps, new Bus(), standIn);
  closers.push(() => app.close(), () => durable.close());
  // the two fixture leases
  const apply = (events: readonly DelegationEventEnvelopeV1[]) =>
    durable.applyAccepted({ accepted: events.map((event) => ({ event, acceptedAt: iso(Date.parse(event.observedAt) + 1000) })), cursor: null, interval: null });
  const activityOf = (sourceKind: 'agent' | 'bash-worktree', upstreamId: string): string =>
    durable.state().checkpoint.activityIdsByNaturalKey[encodeDelegationNaturalKey({ parentId: PARENT.id, parentIncarnation: INC, sourceKind, upstreamId })]!;
  await apply([ss(D0), sStart(D0 + MIN, 'agent-x'), sStop(D0 + 2 * MIN, 'agent-x'), pre(D0 + 10 * MIN, 'toolu_raw', ['wt-a']),
    post(D0 + 12 * MIN, 'toolu_raw', ['wt-a', 'wt-r'])]);
  const xStart = journal(home).find((rec) => rec.entry.kind === 'evidence-accepted' && rec.entry.event.eventKind === 'SubagentStart')!;
  clock.ms = D0 + 30 * MIN;
  const x = await durable.createLease({ activityId: activityOf('agent', 'agent-x'), parentId: PARENT.id, parentIncarnation: INC, project: 'project-a',
    adminRecord: 'wt-x', canonicalPath: '/work/project-a/.claude/worktrees/x', creationBase: null, sourceKind: 'agent',
    correlationJournalIds: [xStart.journalId], firstObservedAt: iso(D0 + MIN) });
  const r = await durable.createLease({ activityId: activityOf('bash-worktree', 'toolu_raw'), parentId: PARENT.id, parentIncarnation: INC, project: 'project-a',
    adminRecord: 'wt-r', canonicalPath: '/work/project-a/.claude/worktrees/r', creationBase: null, sourceKind: 'raw', correlationJournalIds: [],
    firstObservedAt: iso(D0 + 12 * MIN) });
  if (x.kind !== 'created' || r.kind !== 'created') throw new Error('the fixture leases were not created');
  for (const id of [x.leaseId, r.leaseId]) {
    await durable.transitionLease({ leaseId: id, expectGeneration: 0, reason: 'carrier', at: iso(D0 + 40 * MIN), expiresAt: null, terminalEvidenceAt: null,
      runId: null, promotedSession: null, auditEvidence: null, carrierRequired: true, resolvesThrough: null });
    await durable.noteCarrierSeen({ leaseId: id, generation: 1, at: iso(D0 + 41 * MIN) });
  }
  clock.ms = Date.now();
  return { home, app, coord, durable, fleet, uuids, x: x.leaseId, r: r.leaseId, route };
}

function journal(home: string) {
  const p = path.join(home, '.ccrc', DELEGATION_JOURNAL_FILE);
  return existsSync(p) ? parseDelegationJournal(new Uint8Array(readFileSync(p))) : [];
}
const leaseOf = (w: World, id: string): DelegationLeaseRow => w.durable.state().checkpoint.leases.find((l) => l.leaseId === id)! as DelegationLeaseRow;
const sqlLease = (w: World, id: string) =>
  w.coord.db.prepare('SELECT disposition, generation, releasedAt, sourceKind FROM delegation_leases WHERE leaseId = ?').get(id) as
    { disposition: string; generation: number; releasedAt: number | null; sourceKind: string };
const seen = (w: World, id: string) => w.durable.noteCarrierSeen({ leaseId: id, generation: leaseOf(w, id).generation, at: iso(Date.now()) });
/** A conflicting unowned-work attempt on a lease's tree, filed under the lease's parent (a checkpoint-only change). */
const conflictOn = async (w: World, id: string, attemptedAt = iso(D0 + 50 * MIN)): Promise<DelegationAttemptRow> => {
  const l = leaseOf(w, id);
  const a: DelegationAttemptRow = { attemptId: delegationSha256Hex(`pr8-conflict-${id}-${attemptedAt}`), parentId: l.parentId, parentIncarnation: l.parentIncarnation,
    project: l.project, adminRecord: l.adminRecord, canonicalPath: l.canonicalPath, attemptedAt, rung: null, verdict: 'conflicting',
    evidenceJournalIds: [], detail: 'rungs-disagree' };
  await w.durable.applyCheckpointChange((cp) => ({ ...cp, attempts: [...cp.attempts, a] }));
  return a;
};
const adopt = (w: World, id: string) => w.durable.transitionLease({ leaseId: id, expectGeneration: leaseOf(w, id).generation, reason: 'adopt',
  at: iso(D0 + DAY), expiresAt: iso(D0 + 8 * DAY), terminalEvidenceAt: iso(D0 + 2 * MIN), runId: null, promotedSession: null, auditEvidence: null,
  carrierRequired: false, resolvesThrough: null });

const retain = (w: World, lease: string, body: unknown = { byId: PARENT.id, byUuid: PARENT.uuid }, headers: Record<string, string> = tok) =>
  w.app.inject({ method: 'POST', url: `/api/leases/${lease}/retain`, payload: body as Record<string, unknown>, headers });
const operatorRetain = (w: World, lease: string, headers: Record<string, string> = {}) =>
  w.app.inject({ method: 'POST', url: `/api/leases/${lease}/operator-retain`, payload: {}, headers });
const resolve = (w: World, lease: string, body: unknown, headers: Record<string, string> = {}) =>
  w.app.inject({ method: 'POST', url: `/api/leases/${lease}/resolve`, payload: body as Record<string, unknown>, headers });
const keepsSevenDays = (expiresAt: string | null): void => {
  expect(expiresAt).not.toBeNull();
  const left = Date.parse(expiresAt!) - Date.now();
  expect(left).toBeGreaterThan(7 * DAY - 60_000);
  expect(left).toBeLessThanOrEqual(7 * DAY);
};

describe('the words', () => {
  it('every lease door word answers the status shared/api.ts gives it, which is the route table\'s', () => {
    for (const [w, status] of Object.entries(LEASE_DOOR_REFUSALS)) expect(REFUSAL_STATUS[w as keyof typeof REFUSAL_STATUS], w).toBe(status);
    expect(LEASE_DOOR_REFUSALS['registry-unmeasurable'], 'the status this word answers on every route (D-5971)').toBe(502);
  });
});

describe('W5-R9: retain\'s refusal order, by name, one request each (the intent route\'s order)', () => {
  it('token, body, path, attribution, incarnation, applier, lease, claimant, disposition, then 200', async () => {
    const w = await world();
    expect((await retain(w, w.x, undefined, {})).statusCode, 'no box token').toBe(401);
    const extra = await retain(w, w.x, { byId: PARENT.id, byUuid: PARENT.uuid, extra: 1 });
    expect([extra.statusCode, extra.json().error], 'an extra key').toEqual([400, 'bad-request']);
    const shape = await retain(w, 'not-a-lease');
    expect([shape.statusCode, shape.json().error], 'a non-UUID :lease').toEqual([400, 'bad-request']);
    const tree = await retain(w, `tree-${delegationTreeTarget('project-a', 'wt-x')}`);
    expect([tree.statusCode, tree.json().error], 'retain takes a lease id, never a tree').toEqual([400, 'bad-request']);
    const stale = await retain(w, w.x, { byId: PARENT.id, byUuid: 'z'.repeat(36) });
    expect([stale.statusCode, stale.json().error], 'a stale byUuid').toEqual([403, 'stale-uuid']);
    writeFileSync(path.join(w.home, '.cc-sessions', `${PARENT.id}.generation`), 'not-a-generation');
    const unmeasured = await retain(w, w.x);
    expect([unmeasured.statusCode, unmeasured.json().error]).toEqual([502, 'registry-unmeasurable']);
    writeFileSync(path.join(w.home, '.cc-sessions', `${PARENT.id}.generation`), INC);
    w.route.applier = null;
    const noApplier = await retain(w, w.x);
    expect([noApplier.statusCode, noApplier.json().error]).toEqual([503, 'not-ready']);
    w.route.applier = w.durable;
    const unknown = await retain(w, UNKNOWN);
    expect([unknown.statusCode, unknown.json().error]).toEqual([404, 'lease-unknown']);
    const other = await retain(w, w.x, { byId: OTHER.id, byUuid: OTHER.uuid });
    expect([other.statusCode, other.json().error]).toEqual([403, 'not-lease-parent']);
    const run = w.coord.openRun({ program: 'program-a', title: 'run-a', project: 'project-a', wave: 1, waveOf: 1, claimedBy: COORD.id });
    if (!('id' in run)) throw new Error('openRun refused');
    const at = iso(Date.now());
    const step = { at, expiresAt: null, terminalEvidenceAt: null, auditEvidence: null, carrierRequired: false, resolvesThrough: null };
    expect(await w.durable.transitionLease({ ...step, leaseId: w.r, expectGeneration: 1, reason: 'transfer', runId: run.id, promotedSession: null }))
      .toMatchObject({ kind: 'applied', state: 'transferring' });
    expect(await w.durable.transitionLease({ ...step, leaseId: w.r, expectGeneration: 2, reason: 'promote', runId: run.id, promotedSession: 'lane-c-demo' }))
      .toMatchObject({ kind: 'applied', state: 'promoted' });
    const promoted = await retain(w, w.r);
    expect([promoted.statusCode, promoted.json().error], 'a promoted lease').toEqual([409, 'wrong-disposition']);
    const ok = await retain(w, w.x);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ ok: true, lease: w.x, generation: 2, disposition: 'retained', carrier: 'pending' });
    keepsSevenDays(ok.json().expiresAt);
    expect(leaseOf(w, w.x)).toMatchObject({ disposition: 'retained', generation: 2 });
    expect(sqlLease(w, w.x)).toMatchObject({ disposition: 'retained', generation: 2 });
  });

  it('W5-R3 (O5-4 a) through the route: the coordinator whose run named the parent when the lease was first observed may retain', async () => {
    const w = await world();
    const run = w.coord.openRun({ program: 'program-a', title: 'run-a', project: 'project-a', wave: 1, waveOf: 1, claimedBy: COORD.id });
    if (!('id' in run)) throw new Error('openRun refused');
    w.coord.bindSession(run.id, PARENT.id);
    expect(w.coord.advance(run.id, 'failed', 'test-close').ok).toBe(true);
    w.coord.db.prepare('UPDATE runs SET openedAt = ?, closedAt = ? WHERE id = ?').run(D0, D0 + DAY, run.id);
    const res = await retain(w, w.x, { byId: COORD.id, byUuid: COORD.uuid });
    expect([res.statusCode, res.json().disposition]).toEqual([200, 'retained']);
    const other = await retain(w, w.r, { byId: OTHER.id, byUuid: OTHER.uuid });
    expect(other.json().error).toBe('not-lease-parent');
  });
});

describe('W5-R10: the caller\'s incarnation, re-read after the act', () => {
  it('an incarnation that moves while the transition is queued answers 409 incarnation-changed, and the lease stays retained', async () => {
    const w = await world();
    const real = w.durable;
    w.route.applier = {
      state: () => real.state(),
      transitionLease: async (req: Parameters<DelegationDurability['transitionLease']>[0]) => {
        writeFileSync(path.join(w.home, '.cc-sessions', `${PARENT.id}.generation`), INC2);
        return real.transitionLease(req);
      },
    };
    const res = await retain(w, w.x);
    expect([res.statusCode, res.json().error]).toEqual([409, 'incarnation-changed']);
    expect(leaseOf(w, w.x)).toMatchObject({ disposition: 'retained', generation: 2 });
  });
});

describe('W5-R11: the operator doors are session-gated, never box-token gated', () => {
  it('armed: operator-retain and resolve answer 401 with no session, the box token notwithstanding; retain passes the gate on its token', async () => {
    const w = await world({ armed: true });
    expect((await operatorRetain(w, w.x)).statusCode).toBe(401);
    expect((await operatorRetain(w, w.x, tok)).statusCode, 'the box token is no session').toBe(401);
    expect((await resolve(w, w.r, { action: 'foreign' }, tok)).statusCode).toBe(401);
    expect(leaseOf(w, w.r).releasedAt, 'nothing was acted').toBeNull();
    const kept = await retain(w, w.x);
    expect([kept.statusCode, kept.json().disposition], 'retain is EXEMPT: its caller has no cookie').toEqual([200, 'retained']);
  });

  it('unarmed: attach of a raw lease answers 200 retained and keeps source raw; foreign answers 200 and sets releasedAt; a wrong token is ignored', async () => {
    const w = await world();
    const attach = await resolve(w, w.r, { action: 'attach', parent: PARENT.id }, { 'x-ccrc-mail-token': 'wrong' });
    expect(attach.statusCode).toBe(200);
    expect(attach.json()).toMatchObject({ ok: true, lease: w.r, disposition: 'retained', carrier: 'pending' });
    keepsSevenDays(attach.json().expiresAt);
    expect(leaseOf(w, w.r)).toMatchObject({ sourceKind: 'raw', parentId: PARENT.id, disposition: 'retained' });
    const foreign = await resolve(w, w.x, { action: 'foreign' });
    expect(foreign.statusCode).toBe(200);
    expect(foreign.json()).toMatchObject({ ok: true, lease: w.x, disposition: 'released', expiresAt: null });
    expect(leaseOf(w, w.x).releasedAt).not.toBeNull();
    for (const bad of [{ action: 'attach' }, { action: 'foreign', parent: PARENT.id }, { action: 'attach', parent: PARENT.id, extra: 1 }, { action: 'adopt' }]) {
      const res = await resolve(w, w.r, bad);
      expect([res.statusCode, res.json().error], JSON.stringify(bad)).toEqual([400, 'bad-request']);
    }
    expect((await operatorRetain(w, 'tree-x')).json().error).toBe('bad-request');
  });
});

describe('W5-R8d: a hidden conflicting agent lease is resolved as that lease, never as a second one', () => {
  for (const by of ['tree', 'lease'] as const) {
    it(`attach by ${by}: the unowned row names the lease, the attach keeps it with the resolution mark, one lease stands, the conflict ends`, async () => {
      const w = await world();
      const a = await conflictOn(w, w.x);
      const cp = () => w.durable.state().checkpoint as DelegationCheckpointV1;
      const frame = projectDelegation({ checkpoint: cp(), census: { measuredAt: Date.now(), projects: new Map([['project-a', { delegation: null }]]),
        incarnations: new Map() }, absences: [], sessions: [{ id: PARENT.id, status: 'idle' }], runs: [] });
      expect(frame.unowned.map((u) => [u.adminRecord, u.leaseId])).toEqual([['wt-x', w.x]]);
      const target = by === 'tree' ? `tree-${delegationTreeTarget('project-a', 'wt-x')}` : w.x;
      const before = w.uuids.n;
      const res = await resolve(w, target, { action: 'attach', parent: PARENT.id });
      expect([res.statusCode, res.json().lease, res.json().disposition]).toEqual([200, w.x, 'retained']);
      expect(w.uuids.n, 'randomUUID is never called').toBe(before);
      expect(cp().leases.filter((l) => l.adminRecord === 'wt-x')).toHaveLength(1);
      expect(cp().leaseCarriers?.find((c) => c.leaseId === w.x)?.resolvedThrough).toEqual({ attemptedAt: a.attemptedAt, attemptId: a.attemptId });
      expect(conflictingTreeKeys(cp()).has(delegationTreeKey('project-a', 'wt-x'))).toBe(false);
      expect(leaseOf(w, w.x).sourceKind, 'its source is kept').toBe('agent');
    });
  }

  it('foreign by tree releases that lease with the mark; then a conflicting raw lease is attached and kept again by the operator', async () => {
    const w = await world();
    await conflictOn(w, w.x);
    const res = await resolve(w, `tree-${delegationTreeTarget('project-a', 'wt-x')}`, { action: 'foreign' });
    expect([res.statusCode, res.json().lease, res.json().disposition]).toEqual([200, w.x, 'released']);
    expect(w.durable.state().checkpoint.leaseCarriers?.find((c) => c.leaseId === w.x)).toMatchObject({ releaseReason: 'foreign' });
    expect(conflictingTreeKeys(w.durable.state().checkpoint as DelegationCheckpointV1).size).toBe(0);
    const again = await resolve(w, `tree-${delegationTreeTarget('project-a', 'wt-x')}`, { action: 'foreign' });
    expect(again.json().error, 'the tree holds no unreleased lease now').toBe('tree-unleased');
    // a conflicting raw lease: operator-retain refuses until resolve covers the conflict, then (once the carrier is read back) keeps it
    await conflictOn(w, w.r);
    expect((await operatorRetain(w, w.r)).json().error).toBe('lease-conflicting');
    expect((await resolve(w, w.r, { action: 'attach', parent: PARENT.id })).statusCode).toBe(200);
    await seen(w, w.r);
    const kept = await operatorRetain(w, w.r);
    expect([kept.statusCode, kept.json().disposition]).toEqual([200, 'retained']);
  });
});

describe('W5-R12b: each door commits through the real SQLite projection, and every committed checkpoint is projectable', () => {
  it('attach of a raw lease, attach of a conflicting agent lease, foreign of a lease, resolve of a tree that holds a lease', async () => {
    const w = await world();
    const check = () => {
      const cp = w.durable.state().checkpoint as DelegationCheckpointV1;
      expect(() => validateDelegationCheckpoint(cp, null)).not.toThrow();
      expect(() => assertDelegationCheckpointProjectable(cp)).not.toThrow();
    };
    expect((await resolve(w, w.r, { action: 'attach', parent: PARENT.id })).statusCode).toBe(200);
    expect(sqlLease(w, w.r)).toMatchObject({ disposition: 'retained', generation: 2, releasedAt: null, sourceKind: 'raw' });
    check();
    await conflictOn(w, w.x);
    expect((await resolve(w, w.x, { action: 'attach', parent: PARENT.id })).statusCode).toBe(200);
    expect(sqlLease(w, w.x)).toMatchObject({ disposition: 'retained', generation: 2, releasedAt: null, sourceKind: 'agent' });
    check();
    await seen(w, w.x);
    expect((await resolve(w, `tree-${delegationTreeTarget('project-a', 'wt-x')}`, { action: 'foreign' })).statusCode).toBe(200);
    expect(sqlLease(w, w.x)).toMatchObject({ generation: 3 });
    expect(sqlLease(w, w.x).releasedAt).not.toBeNull();
    check();
    expect((await resolve(w, w.r, { action: 'foreign' })).statusCode).toBe(200);
    expect(sqlLease(w, w.r).releasedAt).not.toBeNull();
    check();
  });

  it('CONTROL: why O5-8 (a) needs a migration: a lease naming a synthetic activity is unprojectable, and the table refuses an attached activity', async () => {
    const w = await world();
    const cp = w.durable.state().checkpoint as DelegationCheckpointV1;
    const synthetic = { ...cp, leases: [...cp.leases, { ...leaseOf(w, w.r), leaseId: UNKNOWN, adminRecord: 'wt-z', canonicalPath: '/work/project-a/z',
      creatingJournalSequence: cp.appliedJournalSequence + 1, currentJournalSequence: cp.appliedJournalSequence + 1,
      activityId: delegationSha256Hex(`attached:${delegationTreeTarget('project-a', 'wt-z')}`) }] };
    expect(() => assertDelegationCheckpointProjectable(synthetic)).toThrow(/names the activity .*which has no row/);
    const act = w.coord.db.prepare('SELECT * FROM delegation_activities LIMIT 1').get() as Record<string, unknown>;
    const cols = Object.keys(act);
    const row = { ...act, activityId: 'z'.repeat(64), upstreamId: 'attached-z', sourceKind: 'attached' };
    expect(() => w.coord.db.prepare(`INSERT INTO delegation_activities (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...cols.map((c) => row[c] as never))).toThrow(/CHECK/);
  });
});

describe('W5-R12c: a keep waits for the carrier to be read back', () => {
  it('a second retain before the lane reads the carrier back answers 409 carrier-behind and journals nothing; after the read-back, 200', async () => {
    const w = await world();
    expect((await retain(w, w.x)).statusCode).toBe(200);
    const n = journal(w.home).length;
    const behind = await retain(w, w.x);
    expect([behind.statusCode, behind.json().error]).toEqual([409, 'carrier-behind']);
    expect(journal(w.home).length, 'nothing journalled').toBe(n);
    await seen(w, w.x);
    const ok = await retain(w, w.x);
    expect([ok.statusCode, ok.json().generation]).toEqual([200, 3]);
  });
});

describe('W5-R12d: a box that cannot hold a tree takes no hold of an ephemeral lease', () => {
  const lacking = [
    ['orphan-lease-v1', [LEASE_MARK_CAP, LEASE_MARK_LOCK_CAP]],
    ['lease-mark-v1', [LEASE_MARK_LOCK_CAP, ORPHAN_LEASE_CAP]],
    // D-8040 (PR6's D-8037 carried): the carrier mark composes no held state without its orphan lock
    ['lease-mark-lock-v1', [LEASE_MARK_CAP, ORPHAN_LEASE_CAP]],
  ] as const;
  for (const [missing, caps] of lacking) {
    it(`without ${missing}: retain, operator-retain and attach of an ephemeral lease answer 503 box-unsupported; an adopted one passes; foreign passes`, async () => {
      const w = await world({ caps: ['caps', ...caps] });
      const n = journal(w.home).length;
      for (const res of [await retain(w, w.x), await operatorRetain(w, w.x), await resolve(w, w.r, { action: 'attach', parent: PARENT.id })]) {
        expect([res.statusCode, res.json().error]).toEqual([503, 'box-unsupported']);
      }
      expect(journal(w.home).length, 'nothing journalled').toBe(n);
      await adopt(w, w.x);
      if (missing !== 'lease-mark-v1') await seen(w, w.x);
      expect((await retain(w, w.x)).statusCode, 'the hold already stands').toBe(200);
      await conflictOn(w, w.x);
      if (missing !== 'lease-mark-v1') await seen(w, w.x);
      expect((await resolve(w, w.x, { action: 'attach', parent: PARENT.id })).statusCode, 'attach of a held lease').toBe(200);
      expect((await resolve(w, w.r, { action: 'foreign' })).statusCode, 'foreign is never gated').toBe(200);
    });
  }
});
