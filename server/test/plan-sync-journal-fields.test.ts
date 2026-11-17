// The plan sync's asks against the REAL journal's closed field lists (D-8182's pass; found live beside D-8708). Each ask the
// pass sends goes through the real `runCcrcOp`, with the real `LinearJournal` over a migrated coord.db, before the pass
// reads its scripted answer: Linear itself is a stand-in that never answers (no network), so an ask the journal accepts
// comes back `unreachable` from past the journal, and one it refuses comes back `journal-unavailable` before any call.
// The cancel comment journalled `['comment']`, which the `comment` op's list refuses; the pass then held the programme
// on the backoff and retried the same refused comment for ever. Fixtures use neutral names only.
import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { CoordStore } from '../src/coord/store.js';
import { recordReading } from '../src/coord/linkingStore.js';
import { NO_PLAN_CHANGES, applyPlanChanges, planStorePort, type NewTicket, type PlanChanges, type PlanStorePort } from '../src/coord/planStore.js';
import { runCcrcOp, type CcrcOpAsk, type CcrcOpOutcome } from '../src/linear/ccrcCall.js';
import type { FetchLike } from '../src/linear/client.js';
import { LINEAR_CCRC_OPS } from '../src/linear/hierarchyOps.js';
import { LINEAR_JOURNAL_FIELDS, type LinearWriteOp } from '../src/linear/journal.js';
import type { LinearDirectoryEntries } from '../src/linear/ops.js';
import { PLAN_SYNC_DEBOUNCE_MS, PlanSync } from '../src/linear/planSync.js';
import { readLinearStore } from '../src/linear/store.js';
import { linearServicesFake, memCoordDb } from './linearServicesFake.js';
import { seedSlot } from './linearProxyRig.js';
import { mkTmp } from './tmpHelpers.js';

const T = 1_800_000_000_000;
const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SLUG = 'prog-a';
const OWNER = 'coord-a';
const DIR: LinearDirectoryEntries = {
  viewerId: U(900), labels: [], projects: [], users: [], initiatives: 'on',
  states: [{ id: U(21), name: 'Todo', type: 'unstarted', teamKey: 'AAA' }, { id: U(22), name: 'Doing', type: 'started', teamKey: 'AAA' },
    { id: U(23), name: 'Done', type: 'completed', teamKey: 'AAA' }, { id: U(24), name: 'Nope', type: 'canceled', teamKey: 'AAA' }],
  projectStatuses: [{ id: U(31), name: 'P', type: 'planned' }, { id: U(32), name: 'S', type: 'started' },
    { id: U(33), name: 'C', type: 'completed' }, { id: U(34), name: 'X', type: 'canceled' }],
};
const changes = (over: Partial<PlanChanges>): PlanChanges => ({ ...NO_PLAN_CHANGES(), ...over });
const ticket = (key: string): NewTicket => ({
  program: SLUG, epicKey: 'e1', checkpointKey: 'c1', key, kind: 'work', title: `Ticket ${key}`, body: 'Do it', project: 'project-a', source: 'plan',
});
const ok = (value: Record<string, unknown> = {}, created: string | null = null): CcrcOpOutcome => ({ ok: true, value, created });

let counter = 3000;
/** The pass's scripted Linear: a create answers a fresh id, an update or a comment ok, a by-name read no node. */
const scripted = (ask: CcrcOpAsk): CcrcOpOutcome => {
  if (ask.op.endsWith('Create')) {
    const id = U(counter++);
    return ok(ask.op === 'issueCreate' ? { id, identifier: `AAA-${counter}` } : { id }, id);
  }
  if (ask.op === 'issueComment') return ok({ id: U(counter++) });
  if (ask.op.endsWith('Update')) return ok(ask.op === 'issueUpdate' ? { id: ask.target, identifier: String(ask.target) } : { id: ask.target });
  if (ask.op === 'initiativesByName' || ask.op === 'projectsByName') return ok({ nodes: [] });
  return { ok: false, word: 'not-found', maybeSent: false };
};

interface Rig {
  plan: PlanStorePort; coord: CoordStore; t: { now: number }; sync: PlanSync; fx: ReturnType<typeof linearServicesFake>;
  /** The pull request each run opened, as `prOfRun` answers it (A4: the PR link). */
  prs: Map<number, number>;
  /** Every ask the pass sent, with the real `runCcrcOp`'s answer to it. */
  sent: { ask: CcrcOpAsk; real: CcrcOpOutcome }[];
}
let dirs: string[] = [];
async function rig(): Promise<Rig> {
  const dir = mkTmp('ccrc-plan-journal-');
  dirs.push(dir);
  const ccrcDir = path.join(dir, '.ccrc');
  await seedSlot(ccrcDir, 'a');
  const db = memCoordDb();
  const coord = new CoordStore(db);
  db.prepare('INSERT INTO project_linking (project, teamKey, override) VALUES (?, ?, ?)').run('project-a', 'AAA', 'private');
  // A measured repository, so a run's pull request gives the issue a PR link (§5.6).
  recordReading(db, 'project-a', { state: 'measured', visibility: 'private', slug: 'owner/repo', template: 'absent', at: T });
  applyPlanChanges(db, SLUG, changes({
    epics: { insert: [{ key: 'e1', project: 'project-a', waves: [1], ordinal: 0, title: 'Epic one', summary: 'Summary' }], update: [], drop: [] },
    checkpoints: { insert: [{ epicKey: 'e1', key: 'c1', ordinal: 0, title: 'Checkpoint one', kind: 'acceptance', proves: [], itemId: null }], update: [], drop: [] },
    tickets: { insert: [ticket('t1'), ticket('t2')], update: [], drop: [] },
  }), OWNER, T, { home: 'project-a', title: 'Programme A' });
  const t = { now: T };
  // The journal's own coord.db, apart from the plan's: what is measured is the journal's acceptance, not the pass's rows.
  const fx = linearServicesFake({ clock: () => t.now });
  const offline: FetchLike = async () => { throw new Error('no network in this test'); };
  const r = { plan: planStorePort(db), coord, t, fx, sent: [], prs: new Map<number, number>() } as unknown as Rig;
  r.sync = new PlanSync({
    coord, plan: r.plan, ccrcDir, readLinearStore: () => readLinearStore(ccrcDir),
    call: async (ask) => {
      const real = await runCcrcOp({ ccrcDir, rate: fx.rate, journal: fx.journal, policy: fx.policy, fetch: offline, now: () => t.now }, ask);
      r.sent.push({ ask, real });
      // A refusal from before the call is the pass's answer; past it, the scripted Linear answers.
      return !real.ok && real.word === 'journal-unavailable' ? real : scripted(ask);
    },
    directory: { get: () => DIR, filledAt: () => T - 1000, projectStatusesRead: () => 'read' },
    directoryMiss: () => undefined, markSlotRejected: async () => undefined,
    now: () => t.now, privateTrackerKeys: [],
    prOfRun: (runId) => { const n = r.prs.get(runId); return n === undefined ? null : { number: n, branch: null }; },
  });
  return r;
}
afterEach(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* the reaper */ } } dirs = []; });

async function tick(r: Rig): Promise<void> { r.t.now += PLAN_SYNC_DEBOUNCE_MS + 1_000; await r.sync.tick(r.t.now); }
const journalRows = (r: Rig): { op: string; fields: string | null }[] =>
  r.fx.db.prepare('SELECT op, fields FROM linear_events ORDER BY id').all() as { op: string; fields: string | null }[];

describe('the plan sync\'s asks against the real journal', () => {
  it('a dropped ticket\'s cancel comment is journalled as `body`, and its cancel follows', async () => {
    const r = await rig();
    await tick(r);
    const t1 = r.plan.planOf(SLUG).epics[0]!.tickets.find((x) => x.key === 't1')!;
    const from = r.sent.length;
    r.plan.applyPlanChanges(SLUG, changes({ tickets: { insert: [], update: [], drop: [{ id: t1.id, why: 'duplicates the other ticket' }] } }), OWNER, r.t.now, null);
    await tick(r);
    const after = r.sent.slice(from);
    const comment = after.find((s) => s.ask.op === 'issueComment');
    expect(comment?.real).toMatchObject({ ok: false, word: 'unreachable' });        // past the journal, at the stand-in
    expect(comment?.ask.fields).toEqual(['body']);
    expect(after.some((s) => s.ask.op === 'issueUpdate' && s.ask.input['stateId'] === U(24))).toBe(true);
    expect(journalRows(r)).toContainEqual({ op: 'comment', fields: 'body' });
  });

  it('every write the pass sends, through creation, a dropped ticket, a PR, a met checkpoint and an abandoned programme, passes the journal', async () => {
    const r = await rig();
    await tick(r);
    const t1 = r.plan.planOf(SLUG).epics[0]!.tickets.find((x) => x.key === 't1')!;
    r.plan.applyPlanChanges(SLUG, changes({ tickets: { insert: [], update: [], drop: [{ id: t1.id, why: 'not needed' }] } }), OWNER, r.t.now, null);
    await tick(r);
    // A4: a run on the other ticket opens a pull request (the PR link), and the checkpoint is met (the milestone update).
    const e1 = r.plan.planOf(SLUG).epics[0]!;
    const t2 = e1.tickets.find((x) => x.key === 't2')!;
    const run = r.coord.openRun({ program: SLUG, title: 'Wave 1', project: 'project-a', wave: 1, waveOf: 1, claimedBy: OWNER, homeProject: 'project-a',
      ticket: { kind: 'existing', id: t2.id, epicId: e1.id, reproject: null } });
    if ('refused' in run) throw new Error(`open refused ${String(run.refused)}`);
    r.prs.set((run as { id: number }).id, 7);
    r.plan.markCheckpointMet(e1.checkpoints[0]!.id, { pr: 7 }, r.t.now);
    await tick(r);
    r.plan.closePlan(SLUG, 'abandoned', 'the work moved elsewhere', r.t.now);
    await tick(r);
    const writes = r.sent.filter((s) => LINEAR_CCRC_OPS[s.ask.op]?.class === 'write');
    expect(new Set(writes.map((s) => s.ask.op))).toEqual(new Set([
      'initiativeCreate', 'projectCreate', 'projectMilestoneCreate', 'issueCreate', 'initiativeToProjectCreate',
      'issueComment', 'issueUpdate', 'initiativeUpdate', 'projectUpdate', 'issueLink', 'projectMilestoneUpdate',
    ]));
    expect(writes.filter((s) => !s.real.ok && s.real.word === 'journal-unavailable').map((s) => `${s.ask.op}:${s.ask.fields.join(',')}`)).toEqual([]);
    // And, as a list check, every field each ask names is on its op's closed list.
    for (const { ask } of writes) {
      const allowed = LINEAR_JOURNAL_FIELDS[LINEAR_CCRC_OPS[ask.op]!.journalOp as LinearWriteOp];
      expect(ask.fields.filter((f) => !allowed.includes(f)), ask.op).toEqual([]);
    }
  });
});
