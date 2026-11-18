// D-8183 (Linear hierarchy plan, Task 4.2): the drift pass (`linear/driftPass.ts`, L4) over a real coord.db and a real Linear store
// on a tmp dir, Linear faked at the `call` port (a scripted answer per op) and, end to end, at `FetchLike` through `runCcrcOp`.
// The programme is synced first by the real plan sync (every object bound, fingerprints current), a test-inserted
// `linear_migrations` row `applied` makes team AAA managed, and Linear's copy is whatever `lin.over` says it is.
import { LINEAR_DESCRIPTION_MAX_CHARS } from '../src/linear/planSyncPolicy.js';
import { withoutRestoredLines } from '../src/linear/driftPolicy.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { CoordStore } from '../src/coord/store.js';
import {
  NO_PLAN_CHANGES, applyPlanChanges, driftEventsOf, planStorePort, type PlanChanges, type PlanStorePort,
} from '../src/coord/planStore.js';
import { runCcrcOp, type CcrcOpAsk, type CcrcOpOutcome } from '../src/linear/ccrcCall.js';
import type { FetchLike } from '../src/linear/client.js';
import { DriftPass, DRIFT_MAX_PAGES, prMergedOfFrom } from '../src/linear/driftPass.js';
import type { FleetSession } from '../../shared/api.js';
import { DRIFT_PASS_MS, LINEAR_TEXT_PREFACE } from '../src/linear/driftPolicy.js';
import { LINEAR_DOCUMENTS, LINEAR_HIERARCHY_DOCUMENTS, type LinearDirectoryEntries } from '../src/linear/ops.js';
import { PLAN_SYNC_DEBOUNCE_MS, PlanSync } from '../src/linear/planSync.js';
import { readLinearStore } from '../src/linear/store.js';
import { LINEAR_SYNC_PROGRAMME } from '../../shared/plan.js';
import { recordedAnswer } from './linearRecorded.js';
import { linearServicesFake, memCoordDb } from './linearServicesFake.js';
import { seedSlot, WS } from './linearProxyRig.js';
import { mkTmp } from './tmpHelpers.js';

const T = 1_800_000_000_000;
const DAY = 86_400_000;
const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OTHER = U(777);
const OWNER = 'coord-a';
const SLUG = 'prog-a';

const DIRECTORY: LinearDirectoryEntries = {
  viewerId: U(900), labels: [], projects: [], users: [], initiatives: 'on',
  states: [
    { id: U(21), name: 'Todo', type: 'unstarted', teamKey: 'AAA' }, { id: U(22), name: 'Doing', type: 'started', teamKey: 'AAA' },
    { id: U(23), name: 'Done', type: 'completed', teamKey: 'AAA' }, { id: U(24), name: 'Nope', type: 'canceled', teamKey: 'AAA' },
  ],
  projectStatuses: [{ id: U(31), name: 'P', type: 'planned' }, { id: U(32), name: 'S', type: 'started' },
    { id: U(33), name: 'C', type: 'completed' }, { id: U(34), name: 'X', type: 'canceled' }],
};
const changes = (over: Partial<PlanChanges>): PlanChanges => ({ ...NO_PLAN_CHANGES(), ...over });
const ok = (value: Record<string, unknown> = {}, created: string | null = null): CcrcOpOutcome => ({ ok: true, value, created });
const fail = (word: Extract<CcrcOpOutcome, { ok: false; maybeSent: boolean }>['word'], maybeSent = false): CcrcOpOutcome => ({ ok: false, word, maybeSent });

type Kind = 'initiative' | 'project' | 'milestone' | 'issue';
type Respond = (ask: CcrcOpAsk) => CcrcOpOutcome | Promise<CcrcOpOutcome>;
interface Rig {
  db: DatabaseSync; coord: CoordStore; plan: PlanStorePort; ccrcDir: string; t: { now: number };
  asks: CcrcOpAsk[]; respond: { current: Respond };
  /** What Linear holds differently from the plan, per kind (a node is the planned fields plus these). */
  lin: { over: Partial<Record<Kind, Record<string, unknown>>>; extra: Partial<Record<Kind, Record<string, unknown>[]>>; at: Partial<Record<Kind, number>> };
  merged: { runs: Set<number> }; hold: { when: ((a: CcrcOpAsk) => boolean) | null; gate: Promise<void> | null; held: number };
  /** The plan's owned fields as the sync computes them, taken before any test spies on `sync.plannedOwned`. */
  plannedNow: PlanSync['plannedOwned'];
  sync: PlanSync; drift: DriftPass; build: (o?: { prMergedOf?: (runId: number) => boolean; call?: (a: CcrcOpAsk) => Promise<CcrcOpOutcome> }) => DriftPass;
}

let counter = 2000;
const iso = (ms: number): string => new Date(ms).toISOString();
let dirs: string[] = [];

async function rig(): Promise<Rig> {
  const dir = mkTmp('ccrc-drift-pass-');
  dirs.push(dir);
  const ccrcDir = path.join(dir, '.ccrc');
  await seedSlot(ccrcDir, 'a');
  const db = memCoordDb();
  const coord = new CoordStore(db);
  db.prepare('INSERT INTO project_linking (project, teamKey, override) VALUES (?, ?, ?)').run('project-a', 'AAA', 'private');
  applyPlanChanges(db, SLUG, changes({
    epics: { insert: [{ key: 'e1', project: 'project-a', waves: [1], ordinal: 0, title: 'Epic one', summary: 'Summary' }], update: [], drop: [] },
    checkpoints: { insert: [{ epicKey: 'e1', key: 'c1', ordinal: 0, title: 'Checkpoint one', kind: 'acceptance', proves: [], itemId: null }], update: [], drop: [] },
    tickets: { insert: [{ program: SLUG, epicKey: 'e1', checkpointKey: 'c1', key: 't1', kind: 'work', title: 'Ticket t1', body: 'Do it', project: 'project-a', source: 'plan' }], update: [], drop: [] },
  }), OWNER, T, { home: 'project-a', title: 'Programme A' });
  const plan = planStorePort(db);
  const r = {
    db, coord, plan, ccrcDir, t: { now: T }, asks: [] as CcrcOpAsk[], respond: { current: undefined as unknown as Respond },
    lin: { over: {}, extra: {}, at: {} }, merged: { runs: new Set<number>() }, hold: { when: null, gate: null, held: 0 },
  } as Rig;
  const call = async (ask: CcrcOpAsk): Promise<CcrcOpOutcome> => {
    r.asks.push(ask);
    if (r.hold.when !== null && r.hold.when(ask) && r.hold.gate !== null) { r.hold.held += 1; await r.hold.gate; }
    return r.respond.current(ask);
  };
  r.sync = new PlanSync({
    coord, plan, ccrcDir, readLinearStore: () => readLinearStore(ccrcDir), call,
    directory: { get: () => DIRECTORY, filledAt: () => T - 1000, projectStatusesRead: () => 'read' },
    directoryMiss: () => undefined, markSlotRejected: async () => undefined, now: () => r.t.now, privateTrackerKeys: [],
  });
  r.plannedNow = r.sync.plannedOwned.bind(r.sync);
  r.build = (o = {}) => new DriftPass({
    coord, plan, planSync: r.sync, readLinearStore: () => readLinearStore(ccrcDir), call: o.call ?? call, now: () => r.t.now,
    presenceOf: () => 'alive', viaFleet: () => new Set<string>(), prMergedOf: o.prMergedOf ?? ((runId) => r.merged.runs.has(runId)),
  });
  r.drift = r.build();
  r.respond.current = async (ask) => {
    if (ask.op.startsWith('changed')) return changedAnswer(r, ask);
    if (ask.op === 'issueOwned') {
      const node = (await nodesOf(r, 'issue')).find((n) => n['id'] === ask.input['id']);
      return node === undefined ? fail('not-found') : ok({ issue: node });
    }
    if (ask.op.endsWith('Create') || ask.op.endsWith('Comment')) {
      const id = U(counter++);
      return ok(ask.op === 'issueCreate' ? { id, identifier: `AAA-${counter}` } : { id }, id);
    }
    if (ask.op.endsWith('Update')) return ok({ id: ask.target });
    if (ask.op === 'initiativesByName' || ask.op === 'projectsByName') return ok({ nodes: [] });
    return fail('not-found');
  };
  return r;
}
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* the reaper */ } } dirs = []; });

/** Linear's changed* answer, as Linear filters it: only the nodes whose `updatedAt` is after the ask's `since` (review 2386 F1).
 *  A node's `updatedAt` is `lin.at[kind]` (when the test says Linear last changed it), else now (it changed this very moment). */
async function changedAnswer(r: Rig, ask: CcrcOpAsk): Promise<CcrcOpOutcome> {
  const kind: Kind = ask.op === 'changedInitiatives' ? 'initiative' : ask.op === 'changedProjects' ? 'project' : ask.op === 'changedMilestones' ? 'milestone' : 'issue';
  const since = String(ask.input['since']);
  const nodes = [...await nodesOf(r, kind), ...(r.lin.extra[kind] ?? [])];
  return ok({ nodes: nodes.filter((n) => typeof n['updatedAt'] !== 'string' || n['updatedAt'] > since), next: null });
}

/** Every bound object of a kind as Linear holds it: as the plan says it is, with the test's overrides. */
async function nodesOf(r: Rig, kind: Kind): Promise<Record<string, unknown>[]> {
  const p = await r.plannedNow(SLUG);
  const updatedAt = iso(r.lin.at[kind] ?? r.t.now);
  const nodes = (p?.owned ?? []).filter((o) => o.kind === kind).map((o) => {
    const b = p!.bindings.find((x) => x.id === o.bindingId)!;
    const f = o.owned as Record<string, unknown>;
    const base: Record<string, unknown> = kind === 'project'
      ? { id: b.linearId, name: f['name'], description: f['description'], statusType: f['statusType'], teamKeys: f['teamKeys'], initiativeIds: f['initiativeIds'],
        milestones: (f['milestoneIds'] as string[]).map((id) => ({ id })), updatedAt }
      : kind === 'issue' ? { id: b.linearId, identifier: b.identifier, ...f, parentId: null, labelIds: [], updatedAt }
        : { id: b.linearId, ...f, targetDate: f['targetDate'] ?? null, updatedAt };
    return { ...base, ...(r.lin.over[kind] ?? {}) };
  });
  return nodes;
}

/** Sync the programme with the default answers: every object bound, every fingerprint current. */
async function synced(r: Rig, migrate = true): Promise<Rig> {
  await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS);
  r.t.now += PLAN_SYNC_DEBOUNCE_MS;
  expect(r.plan.bindingsOf(SLUG).map((b) => b.state)).toEqual(['bound', 'bound', 'bound', 'bound']);
  if (migrate) manage(r, 'AAA');
  r.asks.length = 0;
  return r;
}
const manage = (r: Rig, team: string, state = 'applied'): void => {
  r.db.prepare('INSERT INTO linear_migrations (workspaceId, teamKey, state, createdAt, updatedAt, appliedAt) VALUES (?, ?, ?, 1, 1, ?)')
    .run(WS.a.id, team, state, T - 1000);
};
const passAt = async (r: Rig, at: number): Promise<void> => { r.t.now = at; await r.drift.tick(at); };
const bindingOf = (r: Rig, kind: string) => r.plan.bindingsOf(SLUG).find((b) => b.localKind === kind)!;
const opsOf = (r: Rig, pass?: string): string[] => r.asks.filter((a) => pass === undefined || a.pass === pass).map((a) => a.op);
const sent = (r: Rig, op: string) => r.asks.filter((a) => a.op === op && a.pass === 'drift-restore');
const items = (r: Rig) => r.db.prepare('SELECT id, kind, title, why, state, action, options, recommended, recommendedWhy, program, raisedBy, neededBy, closedAt FROM operator_items WHERE program = ? ORDER BY id')
  .all(LINEAR_SYNC_PROGRAMME) as { id: number; kind: string; title: string; why: string; state: string; action: string; options: string; recommended: number; recommendedWhy: string; program: string; raisedBy: string; neededBy: string; closedAt: number | null }[];
const mails = (r: Rig) => r.db.prepare("SELECT subject, body, toId FROM mail WHERE subject LIKE 'Linear sync%' ORDER BY id").all() as { subject: string; body: string; toId: string }[];
const dueAt = (r: Rig): number | null => ((r.db.prepare('SELECT dueAt FROM plan_sync_due WHERE program = ?').get(SLUG) as { dueAt: number } | undefined)?.dueAt ?? null);

describe('the drift pass (D-8183)', () => {
  it('a moved issue is restored with one comment', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { projectId: OTHER };
    await passAt(r, r.t.now + 1);
    expect(sent(r, 'issueUpdate')).toHaveLength(1);
    expect(sent(r, 'issueUpdate')[0]!.input).toMatchObject({ projectId: bindingOf(r, 'epic').linearId });
    const comments = sent(r, 'issueComment');
    expect(comments).toHaveLength(1);
    expect(comments[0]!.input['body']).toEqual(expect.stringContaining("ccrc restored this issue's project"));
    expect(comments[0]!.fields).toEqual(['body']);
    const ev = driftEventsOf(r.db, bindingOf(r, 'ticket').id, 0);
    expect(ev).toEqual([expect.objectContaining({ field: 'projectId', value: OTHER, actor: 'not read', restored: true, commentedAt: r.t.now })]);
    expect(r.plan.driftMarkOf(WS.a.id)).toMatchObject({ passAt: r.t.now });
  });

  it('a current fingerprint with a differing owned value is drift', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { title: 'Edited in Linear' };
    await passAt(r, r.t.now + 1);
    expect(sent(r, 'issueUpdate')[0]!.input).toMatchObject({ title: 'Ticket t1' });
    expect(sent(r, 'issueComment')).toHaveLength(1);
    expect(dueAt(r)).toBeNull();                              // drift, not catch-up: the programme is not marked due
  });

  it('a renamed project is restored with a comment', async () => {
    const r = await synced(await rig());
    r.lin.over.project = { name: 'Renamed in Linear' };
    await passAt(r, r.t.now + 1);
    expect(sent(r, 'projectUpdate')).toHaveLength(1);
    expect(sent(r, 'projectUpdate')[0]!.input).toMatchObject({ id: bindingOf(r, 'epic').linearId, name: 'Epic one' });
    expect(sent(r, 'initiativeToProjectCreate')).toHaveLength(0);          // only a drifted link is made again
    const c = sent(r, 'projectComment');
    expect(c).toHaveLength(1);
    expect(c[0]!.input).toMatchObject({ projectId: bindingOf(r, 'epic').linearId, body: expect.stringContaining("ccrc restored this project's name to *Epic one*") });
    expect(c[0]!.target).toBe(bindingOf(r, 'epic').linearId);
  });

  it('a renamed milestone gets a Restored line, three kept', async () => {
    const r = await synced(await rig());
    const planned = String((await r.sync.plannedOwned(SLUG))!.owned.find((o) => o.kind === 'milestone')!.owned['description']);
    const held = ['2026-11-01', '2026-11-02', '2026-11-03'].map((d) => `Restored on ${d}: ccrc put back this milestone's name.`);
    r.lin.over.milestone = { name: 'Renamed in Linear', description: `${planned}\n\n${held.join('\n')}` };
    await passAt(r, r.t.now + 1);
    const upd = sent(r, 'projectMilestoneUpdate');
    expect(upd).toHaveLength(1);
    const lines = String(upd[0]!.input['description']).split('\n').filter((l) => l.startsWith('Restored on '));
    expect(lines).toHaveLength(3);
    // Newest first, so the 255 cap's cut at the end never takes it; the oldest is dropped.
    expect(lines[0]).toBe(`Restored on ${new Date(r.t.now).toISOString().slice(0, 10)}: ccrc put back this milestone's name.`);
    expect(lines.slice(1)).toEqual([held[2], held[1]]);
    const desc = String(upd[0]!.input['description']);
    expect(desc.length).toBeLessThanOrEqual(LINEAR_DESCRIPTION_MAX_CHARS);
    expect(withoutRestoredLines(desc)).toBe(planned);                      // the planned text follows, whole when it fits
    expect(opsOf(r, 'drift-restore').filter((o) => /Comment$/.test(o))).toEqual([]);   // no comment op: a milestone takes none
    expect(driftEventsOf(r.db, bindingOf(r, 'checkpoint').id, 0)).toEqual([expect.objectContaining({ field: 'name', restored: true, commentedAt: null })]);
  });

  it('the third restore in a week raises the item', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { title: 'Edited in Linear' };
    await passAt(r, r.t.now + 1);
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(items(r)).toEqual([]);
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    const [it] = items(r);
    expect(items(r)).toHaveLength(1);
    expect(it).toMatchObject({
      kind: 'decide', state: 'open', program: LINEAR_SYNC_PROGRAMME, raisedBy: 'ccrc', neededBy: 'later', recommended: 0,
      title: 'Linear keeps changing ticket t1',
    });
    expect(JSON.parse(it!.action)).toEqual({ verb: 'linear-drift', bindingId: bindingOf(r, 'ticket').id });
    expect(JSON.parse(it!.options)).toEqual(['Hand to the coordinator', 'Keep the plan']);
    expect(it!.recommendedWhy).toEqual(expect.stringContaining('coordinator'));
    expect(bindingOf(r, 'ticket').heldItemId).toBe(it!.id);
    // the record sits inside the untrusted block, with the actor unread
    expect(it!.why).toContain(LINEAR_TEXT_PREFACE);
    expect(it!.why).toContain('who: not read by ccrc');
    expect(it!.why.indexOf('Edited in Linear')).toBeGreaterThan(it!.why.indexOf(LINEAR_TEXT_PREFACE));
    expect(it!.title).not.toContain('Edited');
    await passAt(r, r.t.now + DRIFT_PASS_MS);                                // a fourth restore raises no second item
    expect(items(r)).toHaveLength(1);
  });

  it('with the item open, two edits in one pass restore once and comment once a day', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { title: 'Edited in Linear' };
    for (let i = 0; i < 3; i += 1) await passAt(r, r.t.now + (i === 0 ? 1 : DRIFT_PASS_MS));
    expect(items(r)).toHaveLength(1);
    r.asks.length = 0;
    r.lin.over.issue = { title: 'Edited in Linear', description: 'Also edited' };
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(sent(r, 'issueUpdate')).toHaveLength(1);                          // two fields, one update
    expect(sent(r, 'issueComment')).toHaveLength(0);                          // the item is open and a comment was made inside the day
    expect(driftEventsOf(r.db, bindingOf(r, 'ticket').id, r.t.now).map((e) => e.field)).toEqual(['title', 'description']);
    await passAt(r, r.t.now + DAY);
    const c = sent(r, 'issueComment');
    expect(c).toHaveLength(1);                                                // a day later, one comment naming both fields
    expect(c[0]!.input['body']).toEqual(expect.stringContaining("this issue's title"));
    expect(c[0]!.input['body']).toEqual(expect.stringContaining("this issue's description"));
    expect(items(r)).toHaveLength(1);
  });

  it('a restore refused linear-forbidden raises the item at once', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { title: 'Edited in Linear' };
    const base = r.respond.current;
    r.respond.current = (ask) => (ask.op === 'issueUpdate' ? fail('linear-forbidden') : base(ask));
    await passAt(r, r.t.now + 1);
    expect(bindingOf(r, 'ticket')).toMatchObject({ state: 'failed', failedWord: 'linear-forbidden' });
    expect(mails(r).filter((m) => m.subject.includes('linear-forbidden'))).toHaveLength(1);
    expect(mails(r)[0]!.toId).toBe(OWNER);
    const [it] = items(r);
    expect(items(r)).toHaveLength(1);
    expect(it!.why).toContain('linear-forbidden');
    expect(driftEventsOf(r.db, bindingOf(r, 'ticket').id, 0)).toEqual([expect.objectContaining({ field: 'title', restored: false })]);
    expect(sent(r, 'issueComment')).toHaveLength(0);
    r.asks.length = 0;
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(sent(r, 'issueUpdate')).toHaveLength(0);                          // the lane is not spent again on a failed binding
    expect(items(r)).toHaveLength(1);
  });

  it('an unmanaged team is never read, and with no managed team no call is made', async () => {
    const r = await synced(await rig(), false);
    await passAt(r, r.t.now + 1);
    expect(r.asks).toEqual([]);                                               // nothing managed: not one call
    expect(r.plan.driftMarkOf(WS.a.id)).toBeNull();
    manage(r, 'AAA'); manage(r, 'CCC', 'proposed'); manage(r, 'DDD', 'put-back');
    await passAt(r, r.t.now + 1);
    const issues = r.asks.filter((a) => a.op === 'changedIssues');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.input['teams']).toEqual(['AAA']);
    expect(issues[0]!).toMatchObject({ pass: 'drift-restore', lane: 'sync', target: null });
    expect(JSON.stringify(r.asks)).not.toMatch(/CCC|DDD/);
  });

  it('a project of an unmanaged team is not compared', async () => {
    const r = await synced(await rig(), false);
    manage(r, 'BBB');                                                         // another team is managed; the programme's project is AAA
    r.lin.over.project = { name: 'Renamed in Linear' };
    await passAt(r, r.t.now + 1);
    expect(sent(r, 'projectUpdate')).toHaveLength(0);
  });

  it('hand mails the coordinator and settles the item; keep settles it and the next drift is restored again', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { title: 'Edited in Linear' };
    for (let i = 0; i < 3; i += 1) await passAt(r, r.t.now + (i === 0 ? 1 : DRIFT_PASS_MS));
    const [it] = items(r);
    const bindingId = bindingOf(r, 'ticket').id;
    expect(r.drift.act(999, 'hand', bindingId)).toEqual({ ok: false, word: 'not-found' });
    expect(r.drift.act(it!.id, 'hand', bindingId + 1)).toEqual({ ok: false, word: 'not-found' });
    expect(r.drift.act(it!.id, 'hand', bindingId)).toEqual({ ok: true });
    const m = mails(r).filter((x) => x.subject.includes('drift on'));
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ toId: OWNER, subject: `Linear sync: drift on ticket t1 handed (${SLUG})` });
    expect(m[0]!.body).toContain(LINEAR_TEXT_PREFACE);
    expect(m[0]!.body).toContain('who: not read by ccrc');
    expect(items(r)[0]!.state).toBe('done');
    expect(r.drift.act(it!.id, 'hand', bindingId)).toEqual({ ok: false, word: 'not-open' });
    expect(mails(r).filter((x) => x.subject.includes('drift on'))).toHaveLength(1);
  });

  it('keep settles the item, ccrc goes on restoring, and a kept plan is not asked about again for a week', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { title: 'Edited in Linear' };
    for (let i = 0; i < 3; i += 1) await passAt(r, r.t.now + (i === 0 ? 1 : DRIFT_PASS_MS));
    const [it] = items(r);
    expect(r.drift.act(it!.id, 'keep', bindingOf(r, 'ticket').id)).toEqual({ ok: true });
    expect(items(r)[0]!.state).toBe('done');
    expect(mails(r).filter((x) => x.subject.includes('drift on'))).toEqual([]);
    r.asks.length = 0;
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(sent(r, 'issueUpdate')).toHaveLength(1);                           // the next drift is restored again
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(items(r)).toHaveLength(1);                                         // three more restores, no second item inside the week
    await passAt(r, r.t.now + 7 * DAY);
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(items(r)).toHaveLength(2);                                         // past it, three more restores ask again
  });

  it('hand on a programme with no coordinator says so in the item note and settles', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { title: 'Edited in Linear' };
    for (let i = 0; i < 3; i += 1) await passAt(r, r.t.now + (i === 0 ? 1 : DRIFT_PASS_MS));
    r.db.prepare('UPDATE programs SET planBy = NULL WHERE slug = ?').run(SLUG);
    const [it] = items(r);
    expect(r.drift.act(it!.id, 'hand', bindingOf(r, 'ticket').id)).toEqual({ ok: true });
    expect(mails(r).filter((x) => x.subject.includes('drift on'))).toEqual([]);
    const ev = r.db.prepare('SELECT note FROM operator_item_events WHERE itemId = ? ORDER BY id DESC LIMIT 1').get(it!.id) as { note: string } | undefined;
    expect(ev?.note).toContain('no coordinator');
  });

  it('a restore waits for the sync pass in flight and, when that pass wrote the newer planned value, writes nothing and raises no drift', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { title: 'Edited in Linear' };
    const ticket = r.plan.planOf(SLUG).epics[0]!.tickets[0]!;
    let release: () => void = () => undefined;
    r.hold.gate = new Promise<void>((resolve) => { release = resolve; });
    r.hold.when = (a) => a.pass === 'plan-sync' && a.op === 'issueOwned';
    // After the drift pass has read the plan, the plan changes and a sync pass starts, held mid-flight at its issue read.
    const real = r.sync.plannedOwned.bind(r.sync);
    let started = false;
    r.sync.plannedOwned = async (key) => {
      const out = await real(key);
      if (!started) {
        started = true;
        applyPlanChanges(r.db, SLUG, changes({ tickets: { insert: [], update: [{ id: ticket.id, title: 'The newer planned title' }], drop: [] } }), OWNER, r.t.now, null);
        void r.sync.passFor(SLUG, r.t.now + 60_000);
      }
      return out;
    };
    r.t.now += 1;
    const ticking = r.drift.tick(r.t.now);
    // Bounded by time, not by turns: the pass reads the Linear store from disk, which a loaded box can take many turns to answer.
    for (const until = Date.now() + 10_000; Date.now() < until && r.hold.held === 0;) await new Promise((res) => setTimeout(res, 5));
    expect(r.hold.held).toBe(1);
    expect(opsOf(r, 'drift-restore').filter((o) => o === 'issueUpdate')).toEqual([]);   // the restore waits behind the flight
    release();
    await ticking;
    expect(r.asks.filter((a) => a.pass === 'plan-sync' && a.op === 'issueUpdate')).toHaveLength(1);   // the sync wrote the newer value
    expect(r.asks.filter((a) => a.pass === 'plan-sync' && a.op === 'issueUpdate')[0]!.input).toMatchObject({ title: 'The newer planned title' });
    expect(sent(r, 'issueUpdate')).toHaveLength(0);                           // the restore is moot: nothing sent
    expect(sent(r, 'issueComment')).toHaveLength(0);
    expect(driftEventsOf(r.db, bindingOf(r, 'ticket').id, 0)).toEqual([]);
    expect(items(r)).toEqual([]);
  });

  it('a value ccrc wrote is catch-up: the programme is marked due and nothing is sent', async () => {
    const r = await synced(await rig());
    const ticket = r.plan.planOf(SLUG).epics[0]!.tickets[0]!;
    applyPlanChanges(r.db, SLUG, changes({ tickets: { insert: [], update: [{ id: ticket.id, title: 'A newer planned title' }], drop: [] } }), OWNER, r.t.now, null);
    r.lin.over.issue = { title: 'Ticket t1' };                                // Linear still holds what the sync wrote last
    r.db.prepare('DELETE FROM plan_sync_due').run();                          // the plan write's own due mark is not what is measured
    await passAt(r, r.t.now + 1);
    expect(opsOf(r, 'drift-restore').filter((o) => /Update|Comment/.test(o))).toEqual([]);
    expect(dueAt(r)).toBe(r.t.now);
    expect(driftEventsOf(r.db, bindingOf(r, 'ticket').id, 0)).toEqual([]);
  });

  it('a programme held by a failure stays held when the drift pass reads a catch-up', async () => {
    const r = await synced(await rig());
    const ticket = r.plan.planOf(SLUG).epics[0]!.tickets[0]!;
    applyPlanChanges(r.db, SLUG, changes({ tickets: { insert: [], update: [{ id: ticket.id, title: 'A newer planned title' }], drop: [] } }), OWNER, r.t.now, null);
    r.lin.over.issue = { title: 'Ticket t1' };
    const heldUntil = r.t.now + 600_000;
    r.plan.markSyncDue(SLUG, heldUntil);
    r.plan.deferSync(SLUG, heldUntil, 'failure');
    await passAt(r, r.t.now + 1);
    expect(dueAt(r)).toBe(heldUntil);                                         // markSyncDue only: a failure's backoff is not shortened
  });

  // F1: the fake honours `since`, so the second pass's changed read does not return the issue (it did not change again); the grace
  // ends only because the pass re-reads a graced issue by id.
  it('an issue completed with no merge waits one pass, then is restored', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { stateType: 'completed' };
    r.lin.at.issue = r.t.now;                                                 // a person completed it now, and touches it no more
    await passAt(r, r.t.now + 1);
    expect(sent(r, 'issueUpdate')).toHaveLength(0);
    expect(bindingOf(r, 'ticket').driftSince).toBe(r.t.now);
    expect(driftEventsOf(r.db, bindingOf(r, 'ticket').id, 0)).toEqual([]);
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(sent(r, 'issueUpdate')).toHaveLength(1);
    expect(sent(r, 'issueUpdate')[0]!.input).toMatchObject({ stateId: U(21) });
    expect(sent(r, 'issueOwned').length).toBeGreaterThan(0);                  // the second look read it by id
    expect(r.asks.filter((a) => a.op === 'changedIssues').at(-1)!.input['since']).toBe(iso(r.lin.at.issue));
    expect(driftEventsOf(r.db, bindingOf(r, 'ticket').id, 0).map((e) => [e.field, e.restored])).toEqual([['stateType', true]]);
    r.lin.over.issue = {};                                                    // put back: the next re-read ends the grace
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(bindingOf(r, 'ticket').driftSince).toBeNull();
    r.asks.length = 0;
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(sent(r, 'issueOwned')).toEqual([]);                                 // no grace, no re-read
  });

  // A5: §7.3's one pass holds the state even when another field is put back in the same pass.
  it('a grace-pass issue with another drifted field has that field restored and its state held, then the state restored', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { stateType: 'completed', title: 'Edited in Linear' };
    r.lin.at.issue = r.t.now;
    await passAt(r, r.t.now + 1);
    const first = sent(r, 'issueUpdate');
    expect(first).toHaveLength(1);
    expect(first[0]!.input).toMatchObject({ title: 'Ticket t1' });
    expect(first[0]!.input).not.toHaveProperty('stateId');
    expect(first[0]!.fields).not.toContain('state');
    expect(bindingOf(r, 'ticket').driftSince).toBe(r.t.now);
    r.lin.over.issue = { stateType: 'completed' };                            // the title is back; the state still differs
    r.asks.length = 0;
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(sent(r, 'issueUpdate')).toHaveLength(1);
    expect(sent(r, 'issueUpdate')[0]!.input).toMatchObject({ stateId: U(21) });
  });

  it('an issue completed with the merge recorded is left', async () => {
    const r = await synced(await rig());
    const ticket = r.plan.planOf(SLUG).epics[0]!.tickets[0]!;
    r.db.prepare('UPDATE plan_tickets SET runId = 41 WHERE id = ?').run(ticket.id);
    r.merged.runs.add(41);
    r.lin.over.issue = { stateType: 'completed' };
    await passAt(r, r.t.now + 1);
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(sent(r, 'issueUpdate')).toHaveLength(0);
    expect(bindingOf(r, 'ticket').driftSince).toBeNull();
    expect(driftEventsOf(r.db, bindingOf(r, 'ticket').id, 0)).toEqual([]);
  });

  it('a node with nothing left clears the grace', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { stateType: 'completed' };
    r.lin.at.issue = r.t.now;
    await passAt(r, r.t.now + 1);
    expect(bindingOf(r, 'ticket').driftSince).not.toBeNull();
    r.lin.over.issue = {};
    r.lin.at.issue = r.t.now + 10;                                            // a person reopened it
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(bindingOf(r, 'ticket').driftSince).toBeNull();
  });

  it('a read that fails keeps the watermark and tries again after the pass period', async () => {
    const r = await synced(await rig());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const base = r.respond.current;
    let broken = true;
    r.respond.current = (ask) => (broken && ask.op === 'changedProjects' ? fail('unreachable') : base(ask));
    await passAt(r, r.t.now + 1);
    expect(warn).toHaveBeenCalledWith('ccrc-server: linear drift pass read failed: unreachable');
    const first = iso(T - 1000);                                             // the watermarks: the migration's own time
    expect(r.plan.driftMarkOf(WS.a.id)).toEqual({ watermarks: { initiative: first, project: first, milestone: first, issue: first }, passAt: r.t.now });
    const calls = r.asks.length;
    await passAt(r, r.t.now + DRIFT_PASS_MS - 1);
    expect(r.asks).toHaveLength(calls);                                       // inside the period: no call
    broken = false;
    await passAt(r, r.t.now + 1);
    expect(r.asks.length).toBeGreaterThan(calls);
    expect(r.asks.filter((a) => a.op === 'changedProjects').at(-1)!.input['since']).toBe(iso(T - 1000));
    expect(r.plan.driftMarkOf(WS.a.id)!.watermarks.project).not.toBe(iso(T - 1000));   // a clean pass moves each to the newest updatedAt read
  });

  it('a page cap keeps the old watermark and warns once', async () => {
    const r = await synced(await rig());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const base = r.respond.current;
    r.respond.current = async (ask) => {
      if (ask.op !== 'changedIssues') return base(ask);
      return ok({ nodes: [], next: 'cursor' });
    };
    await passAt(r, r.t.now + 1);
    expect(r.asks.filter((a) => a.op === 'changedIssues')).toHaveLength(DRIFT_MAX_PAGES);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(r.plan.driftMarkOf(WS.a.id)!.watermarks.issue).toBe(iso(T - 1000));          // the capped kind keeps its own
    expect(r.plan.driftMarkOf(WS.a.id)!.watermarks.project).not.toBe(iso(T - 1000));    // the others move (A3)
  });

  // A2: the drift pass's read of what the plan says is read-only: it advances no D-8701 episode streak and asks for no fill.
  it('plannedOwned reads an unsettled directory without observing an episode or asking for a fill', async () => {
    const r = await synced(await rig());
    const miss = vi.fn();
    const unsettled = new PlanSync({
      coord: r.coord, plan: r.plan, ccrcDir: r.ccrcDir, readLinearStore: () => readLinearStore(r.ccrcDir), call: async () => ok(),
      directory: { get: () => ({ ...DIRECTORY, initiatives: 'unknown' }), filledAt: () => T - 1000, projectStatusesRead: () => 'unread' },
      directoryMiss: miss, markSlotRejected: async () => undefined, now: () => r.t.now, privateTrackerKeys: [],
    });
    expect(await unsettled.plannedOwned(SLUG)).not.toBeNull();
    expect(miss).not.toHaveBeenCalled();
    expect([...r.plan.streaksOf().keys()]).toEqual([]);
  });

  // A3: one watermark per kind. An initiative edited after the initiatives were read, but before the issues' read returned a newer
  // updatedAt, is read at the next pass; one shared watermark moved past it and never saw it.
  it('a change made between two kinds\' reads is read at the next pass', async () => {
    const r = await synced(await rig());
    r.lin.at.initiative = T - 2000; r.lin.at.project = T - 2000; r.lin.at.milestone = T - 2000;   // unchanged since before managing
    const at = r.t.now + 1;
    r.lin.over.issue = { title: 'Edited in Linear' };
    r.lin.at.issue = at - 5;
    const base = r.respond.current;
    r.respond.current = (ask) => {
      if (ask.op === 'changedIssues' && r.lin.over.initiative === undefined) {
        r.lin.over.initiative = { name: 'Renamed in Linear' };                // edited while the pass read the other kinds
        r.lin.at.initiative = at - 10;
      }
      return base(ask);
    };
    await passAt(r, at);
    expect(sent(r, 'initiativeUpdate')).toHaveLength(0);
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(sent(r, 'initiativeUpdate')).toHaveLength(1);
    expect(sent(r, 'initiativeUpdate')[0]!.input).toMatchObject({ name: 'Programme A' });
  });

  // A4: a deferred restore keeps its kind's watermark, so the project is read again; its missing milestone is one change.
  it('a difference no update can put back is recorded once, however often a deferral re-reads it', async () => {
    const r = await synced(await rig());
    r.lin.over.project = { name: 'Renamed in Linear', milestones: [] };
    r.lin.at.project = r.t.now;
    const base = r.respond.current;
    r.respond.current = (ask) => (ask.op === 'projectUpdate' && ask.pass === 'drift-restore' ? fail('rate-limited') : base(ask));
    await passAt(r, r.t.now + 1);
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(r.asks.filter((a) => a.op === 'changedProjects').at(-1)!.input['since']).toBe(iso(T - 1000));   // still read again
    expect(driftEventsOf(r.db, bindingOf(r, 'epic').id, 0).filter((e) => e.field === 'milestoneIds')).toHaveLength(1);
  });

  // A1: a project link the sync has not sent yet (the project's own binding is not current) is a catch-up, never drift.
  it('an initiative missing the link of a project the sync has yet to update is a catch-up', async () => {
    const r = await synced(await rig());
    const epic = r.plan.planOf(SLUG).epics[0]!;
    applyPlanChanges(r.db, SLUG, changes({ epics: { insert: [], update: [{ id: epic.id, title: 'A newer epic title' }], drop: [] } }), OWNER, r.t.now, null);
    r.db.prepare('DELETE FROM plan_sync_due').run();
    r.lin.over.initiative = { projectIds: [] };
    await passAt(r, r.t.now + 1);
    expect(sent(r, 'initiativeToProjectCreate')).toHaveLength(0);
    expect(driftEventsOf(r.db, bindingOf(r, 'programme').id, 0)).toEqual([]);
    expect(dueAt(r)).toBe(r.t.now);
  });

  // N2: an initiative's missing link rides on its project's restore; when that restore is deferred, the initiative's watermark must
  // be kept too, or the unchanged initiative is never read again and the link stays missing.
  it('a deferred link restore keeps its initiative\'s watermark, and the next pass sends the link', async () => {
    const r = await synced(await rig());
    r.lin.over.initiative = { projectIds: [] };
    r.lin.at.initiative = r.t.now;
    r.lin.at.project = T - 2000; r.lin.at.milestone = T - 2000; r.lin.at.issue = T - 2000;
    const base = r.respond.current;
    let refuse = true;
    r.respond.current = (ask) => (refuse && ask.op === 'initiativeToProjectCreate' ? fail('rate-limited') : base(ask));
    await passAt(r, r.t.now + 1);
    expect(sent(r, 'initiativeToProjectCreate')).toHaveLength(1);         // sent, refused: deferred
    refuse = false;
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(r.asks.filter((a) => a.op === 'changedInitiatives').at(-1)!.input['since']).toBe(iso(T - 1000));
    expect(sent(r, 'initiativeToProjectCreate')).toHaveLength(2);         // read again, and the link is sent
  });

  // A-1: only Keep the plan quiets persistence (D-8720); after Hand to the coordinator, persistent drift raises the item again (§7.4).
  it('after Hand, three restores in seven days raise the item again', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { title: 'Edited in Linear' };
    for (let i = 0; i < 3; i += 1) await passAt(r, r.t.now + (i === 0 ? 1 : DRIFT_PASS_MS));
    const [it] = items(r);
    expect(r.drift.act(it!.id, 'hand', bindingOf(r, 'ticket').id)).toEqual({ ok: true });
    expect(bindingOf(r, 'ticket').heldItemId).toBeNull();
    for (let i = 0; i < 3; i += 1) await passAt(r, r.t.now + DAY);
    expect(items(r)).toHaveLength(2);
    expect(items(r)[1]).toMatchObject({ state: 'open', title: 'Linear keeps changing ticket t1' });
  });

  // Review 2408 F4: the Handed-to-nobody arm (a programme with no coordinator) ends the binding's hold on the item too, so
  // persistence that goes on is raised again.
  it('after Hand on a binding with no coordinator, three restores in seven days raise the item again (review 2408 F4)', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { title: 'Edited in Linear' };
    for (let i = 0; i < 3; i += 1) await passAt(r, r.t.now + (i === 0 ? 1 : DRIFT_PASS_MS));
    r.db.prepare('UPDATE programs SET planBy = NULL WHERE slug = ?').run(SLUG);
    const [it] = items(r);
    expect(r.drift.act(it!.id, 'hand', bindingOf(r, 'ticket').id)).toEqual({ ok: true });
    expect(bindingOf(r, 'ticket').heldItemId).toBeNull();
    for (let i = 0; i < 3; i += 1) await passAt(r, r.t.now + DAY);
    expect(items(r)).toHaveLength(2);
    expect(items(r)[1]).toMatchObject({ state: 'open', title: 'Linear keeps changing ticket t1' });
  });

  // F3 (D-8720): the week's quiet after Keep covers persistence only; a restore Linear refuses raises the item at once (§7.4).
  it('a restore refused the day after Keep raises the item at once', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { title: 'Edited in Linear' };
    for (let i = 0; i < 3; i += 1) await passAt(r, r.t.now + (i === 0 ? 1 : DRIFT_PASS_MS));
    const [it] = items(r);
    expect(r.drift.act(it!.id, 'keep', bindingOf(r, 'ticket').id)).toEqual({ ok: true });
    const base = r.respond.current;
    r.respond.current = (ask) => (ask.op === 'issueUpdate' ? fail('linear-forbidden') : base(ask));
    await passAt(r, r.t.now + DAY);
    expect(items(r)).toHaveLength(2);
    expect(items(r)[1]).toMatchObject({ state: 'open' });
    expect(items(r)[1]!.why).toContain('linear-forbidden');
  });

  // F6 (D-8721): one comment a day on an object, whether or not its item is open.
  it('after Keep, restores within a day comment once', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { title: 'Edited in Linear' };
    for (let i = 0; i < 3; i += 1) await passAt(r, r.t.now + (i === 0 ? 1 : DRIFT_PASS_MS));
    const [it] = items(r);
    expect(r.drift.act(it!.id, 'keep', bindingOf(r, 'ticket').id)).toEqual({ ok: true });
    r.asks.length = 0;
    await passAt(r, r.t.now + DAY);
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(sent(r, 'issueUpdate')).toHaveLength(3);
    expect(sent(r, 'issueComment')).toHaveLength(1);
  });

  it('a lane restarted while a tick runs does nothing and the oldest workspace goes first', async () => {
    const r = await synced(await rig());
    let release: () => void = () => undefined;
    r.hold.gate = new Promise<void>((resolve) => { release = resolve; });
    r.hold.when = (a) => a.op === 'changedInitiatives';
    r.t.now += 1;
    const first = r.drift.tick(r.t.now);
    for (const until = Date.now() + 10_000; Date.now() < until && r.hold.held === 0;) await new Promise((res) => setTimeout(res, 5));
    const n = r.asks.length;
    await r.drift.tick(r.t.now);
    expect(r.asks).toHaveLength(n);
    release();
    await first;
  });
});

describe('the drift pass at FetchLike, through runCcrcOp (recorded and constructed answers)', () => {
  const D = LINEAR_HIERARCHY_DOCUMENTS;
  it('a renamed project is read from the constructed answer, restored through the real journal and commented', async () => {
    const r = await synced(await rig(), false);
    // The constructed changed-projects answer holds one project: bind the plan's epic to it, at the plan's current fingerprint.
    const fixture = (recordedAnswer('read-changed-projects-constructed').json as () => Promise<{ data: { projects: { nodes: { id: string }[] } } }>);
    const projectId = (await fixture()).data.projects.nodes[0]!.id;
    const epic = bindingOf(r, 'epic');
    r.db.prepare('UPDATE linear_bindings SET linearId = ? WHERE id = ?').run(projectId, epic.id);
    manage(r, 'AAA');
    const fx = linearServicesFake({ clock: () => r.t.now, db: r.db });
    const docs: string[] = [];
    const fetch: FetchLike = async (_u, init) => {
      const q = (JSON.parse(init.body) as { query: string }).query;
      docs.push(q);
      const name = new Map<string, string>([
        [D.changedInitiatives, 'read-changed-initiatives'], [D.changedProjects, 'read-changed-projects-constructed'],
        [D.changedMilestones, 'read-changed-milestones-constructed'], [D.changedIssues, 'read-changed-issues-constructed'],
        [D.projectUpdate, 'mutation-project-update-constructed'], [D.initiativeToProjectCreate, 'mutation-initiative-to-project-create'], [LINEAR_DOCUMENTS.comment, 'mutation-comment-create-on-project'],
      ]).get(q);
      if (name === undefined) throw new Error('no answer for this document');
      return recordedAnswer(name);
    };
    const call = (ask: CcrcOpAsk): Promise<CcrcOpOutcome> => runCcrcOp({ ccrcDir: r.ccrcDir, rate: fx.rate, journal: fx.journal, policy: fx.policy, fetch, now: () => r.t.now }, ask);
    // The sync that restores sends through the same stand-in: a restore is the sync's write.
    const planSync = new PlanSync({
      coord: r.coord, plan: r.plan, ccrcDir: r.ccrcDir, readLinearStore: () => readLinearStore(r.ccrcDir), call,
      directory: { get: () => DIRECTORY, filledAt: () => T - 1000, projectStatusesRead: () => 'read' },
      directoryMiss: () => undefined, markSlotRejected: async () => undefined, now: () => r.t.now, privateTrackerKeys: [],
    });
    const drift = new DriftPass({
      coord: r.coord, plan: r.plan, planSync, readLinearStore: () => readLinearStore(r.ccrcDir), call, now: () => r.t.now,
      presenceOf: () => 'alive', viaFleet: () => new Set<string>(),
    });
    r.t.now += 1;
    await drift.tick(r.t.now);
    expect(docs.filter((d) => d === D.changedIssues)).toHaveLength(1);
    expect(docs.filter((d) => d === D.projectUpdate)).toHaveLength(1);
    expect(docs.filter((d) => d === D.initiativeToProjectCreate)).toHaveLength(1);   // the link drifted: made again
    expect(docs.filter((d) => d === LINEAR_DOCUMENTS.comment)).toHaveLength(1);
    const ev = driftEventsOf(r.db, epic.id, 0);
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.every((e) => e.actor === 'not read')).toBe(true);
    expect(ev.filter((e) => e.restored).map((e) => e.field)).toEqual(['name', 'description', 'statusType', 'initiativeIds']);
    // The plan's milestone is missing from the fixture's project (which holds another one, a person's, and that extra one is
    // not drift: nothing deletes): no update can make the missing one again, so it is recorded, not restored, and asked about.
    expect(ev.filter((e) => !e.restored).map((e) => e.field)).toEqual(['milestoneIds']);
    expect(items(r)).toHaveLength(1);
    expect(ev.some((e) => e.field === 'name' && e.commentedAt !== null)).toBe(true);
    // The journal took the comment as a ccrc `comment` row on the project's UUID, under the restore pass, and settled it ok.
    const rows = r.db.prepare("SELECT op, actor, target, outcome FROM linear_events WHERE op IN ('comment', 'project-update', 'initiative-link') ORDER BY id").all() as { op: string; actor: string; target: string; outcome: string }[];
    expect(rows).toEqual([
      { op: 'project-update', actor: 'ccrc:drift-restore', target: projectId, outcome: 'ok' },
      { op: 'initiative-link', actor: 'ccrc:drift-restore', target: projectId, outcome: 'ok' },
      { op: 'comment', actor: 'ccrc:drift-restore', target: projectId, outcome: 'ok' },
    ]);
  });
});

describe('prMergedOfFrom (D-8183)', () => {
  const run = (o: { lineage?: { phase: string }[]; sessionId?: string | null; branch?: string | null }) => ({
    ok: true, run: { prLineage: o.lineage ?? [], sessionId: o.sessionId ?? null, branch: o.branch ?? null },
  });
  const coordOf = (r: ReturnType<typeof run> | { ok: false }): CoordStore => ({ run: () => r }) as unknown as CoordStore;
  const session = (branch: string | null, phase: string): FleetSession => ({ id: 's1', branch, pr: { phase } }) as unknown as FleetSession;

  it('a merged phase in the folded lineage, or the run\'s own session\'s merged PR, is merged', () => {
    expect(prMergedOfFrom(coordOf(run({ lineage: [{ phase: 'open' }, { phase: 'merged' }] })), () => null)(1)).toBe(true);
    expect(prMergedOfFrom(coordOf(run({ sessionId: 's1', branch: 'ws/a' })), () => [session('ws/a', 'merged')])(1)).toBe(true);
  });
  it('anything else is not: an open PR, another branch, no listing, an unknown run', () => {
    expect(prMergedOfFrom(coordOf(run({ lineage: [{ phase: 'open' }] })), () => null)(1)).toBe(false);
    expect(prMergedOfFrom(coordOf(run({ sessionId: 's1', branch: 'ws/a' })), () => [session('ws/b', 'merged')])(1)).toBe(false);
    expect(prMergedOfFrom(coordOf(run({ sessionId: 's1', branch: 'ws/a' })), () => [session('ws/a', 'open')])(1)).toBe(false);
    expect(prMergedOfFrom(coordOf(run({ sessionId: 's1', branch: 'ws/a' })), () => null)(1)).toBe(false);
    expect(prMergedOfFrom(coordOf(run({ sessionId: 's1', branch: null })), () => [session(null, 'merged')])(1)).toBe(false);
    expect(prMergedOfFrom(coordOf({ ok: false }), () => null)(1)).toBe(false);
  });
});

// Round 6 P3 (follow-up item 1): a restore honours every hold the sync keeps, and the drift pass's own reads honour the key hold.
describe('restores and drift reads honour every hold (round 6 P3)', () => {
  const targetOf = (r: Rig): { bindingId: number; seen: string | null; tag: string } => {
    const b = bindingOf(r, 'ticket');
    return { bindingId: b.id, seen: b.fingerprint, tag: 'x' };
  };
  const slotOf = async (r: Rig) => (await import('../src/linear/planSync.js')).slotsOf(await readLinearStore(r.ccrcDir)).get(WS.a.id)!;

  it('a restore while the programme row is failure-held sends nothing and answers deferred', async () => {
    const r = await synced(await rig());
    const until = r.t.now + 600_000;
    r.plan.markSyncDue(SLUG, until);
    r.plan.deferSync(SLUG, until, 'failure');
    const out = await r.sync.restore(SLUG, [targetOf(r)], 'drift-restore');
    expect(out).toEqual([expect.objectContaining({ outcome: 'deferred' })]);
    expect(r.asks).toEqual([]);
  });

  it('a restore while its workspace is held by a deferring answer sends nothing', async () => {
    const r = await synced(await rig());
    const ticket = r.plan.planOf(SLUG).epics[0]!.tickets[0]!;
    applyPlanChanges(r.db, SLUG, changes({ tickets: { insert: [], update: [{ id: ticket.id, title: 'A newer planned title' }], drop: [] } }), OWNER, r.t.now, null);
    const real = r.respond.current;
    r.respond.current = (a) => (a.pass === 'plan-sync' && a.op === 'issueOwned' ? fail('unreachable') : real(a));
    r.t.now += PLAN_SYNC_DEBOUNCE_MS;
    await r.sync.tick(r.t.now);
    r.respond.current = real;
    r.db.prepare('DELETE FROM plan_sync_due').run();           // only the workspace's own hold is measured, not the programme row's
    r.asks.length = 0;
    const b = bindingOf(r, 'ticket');
    const out = await r.sync.restore(SLUG, [{ bindingId: b.id, seen: b.fingerprint, tag: 'x' }], 'drift-restore');
    expect(out).toEqual([expect.objectContaining({ outcome: 'deferred' })]);
    expect(r.asks).toEqual([]);
  });

  it('a restore while the workspace key is refused sends nothing', async () => {
    const r = await synced(await rig());
    r.sync.keyRefused(WS.a.id, await slotOf(r), r.t.now + 600_000);
    const out = await r.sync.restore(SLUG, [targetOf(r)], 'drift-restore');
    expect(out).toEqual([expect.objectContaining({ outcome: 'deferred' })]);
    expect(r.asks).toEqual([]);
  });

  it('a drift read answered 401 blocks the workspace for the plan sync, and the next drift tick reads again only after the hold', async () => {
    const r = await synced(await rig());
    const real = r.respond.current;
    r.respond.current = (a) => (a.op === 'changedInitiatives' ? fail('linear-unauthorised') : real(a));
    await passAt(r, r.t.now + 1);
    const at = r.t.now;
    expect(r.sync.keyBlockedUntil(WS.a.id)).toBeGreaterThan(at);
    r.respond.current = real;
    r.asks.length = 0;
    // The period has passed but the hold, on the plan sync's schedule, has not: lift the period by hand so only the hold is measured.
    r.sync.keyRefused(WS.a.id, await slotOf(r), at + 2 * DRIFT_PASS_MS);
    await passAt(r, at + DRIFT_PASS_MS + 1);
    expect(r.asks).toEqual([]);
    await passAt(r, at + 2 * DRIFT_PASS_MS + 1);
    expect(opsOf(r)).toContain('changedInitiatives');
  });

  it('a drift read answered 401 holds on the plan sync\'s own schedule, not a schedule of the pass\'s', async () => {
    const r = await synced(await rig());
    const real = r.respond.current;
    r.respond.current = (a) => (a.op === 'changedProjects' ? fail('linear-unauthorised') : real(a));
    await passAt(r, r.t.now + 1);
    expect(r.sync.keyBlockedUntil(WS.a.id)).toBe(r.t.now + 30_000);      // the first step of PLAN_SYNC_BACKOFF_MS
  });

  it('another workspace still gets its pass while one is blocked', async () => {
    const r = await synced(await rig());
    await seedSlot(r.ccrcDir, 'b');
    r.db.prepare('INSERT INTO linear_migrations (workspaceId, teamKey, state, createdAt, updatedAt, appliedAt) VALUES (?, ?, ?, 1, 1, ?)')
      .run(WS.b.id, 'BBB', 'applied', T - 1000);
    r.sync.keyRefused(WS.a.id, await slotOf(r), r.t.now + 5 * DRIFT_PASS_MS);
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(r.asks.length).toBeGreaterThan(0);
    expect([...new Set(r.asks.map((a) => a.workspaceId))]).toEqual([WS.b.id]);
  });
});

// Round 5 F1 (follow-up item 4): the pass reads ccrc's own record BEFORE Linear, so a sync write landing between the two is never
// read as drift.
describe('the pass reads ccrc\'s record before Linear (round 5 F1)', () => {
  /** A pass whose changed-issues read is followed by a sync write: the plan changes and the real sync pass writes it. */
  const withSyncWriteAfterRead = (r: Rig, title: string): DriftPass => {
    const ticket = r.plan.planOf(SLUG).epics[0]!.tickets[0]!;
    return r.build({
      call: async (ask) => {
        r.asks.push(ask);
        const out = await r.respond.current(ask);
        if (ask.op === 'changedIssues') {
          applyPlanChanges(r.db, SLUG, changes({ tickets: { insert: [], update: [{ id: ticket.id, title }], drop: [] } }), OWNER, r.t.now, null);
          await r.sync.passFor(SLUG, r.t.now + 60_000);
        }
        return out;
      },
    });
  };

  it('a sync write landing after the Linear read is skipped: no comment, no restore, no event, no item', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { title: 'Edited in Linear' };
    r.drift = withSyncWriteAfterRead(r, 'The newer planned title');
    await passAt(r, r.t.now + 1);
    expect(r.asks.filter((a) => a.pass === 'plan-sync' && a.op === 'issueUpdate')).toHaveLength(1);    // the sync did write
    expect(sent(r, 'issueUpdate')).toEqual([]);
    expect(sent(r, 'issueComment')).toEqual([]);
    expect(driftEventsOf(r.db, bindingOf(r, 'ticket').id, 0)).toEqual([]);
    expect(items(r)).toEqual([]);
  });

  it('a stale project node missing a milestone the sync just made does not raise the item', async () => {
    const r = await synced(await rig());
    const milestone = bindingOf(r, 'checkpoint');
    // The milestone was bound only after the pass read ccrc's record: the pre-read list lacks it, and Linear's project node too.
    const real = r.plan.bindingsInWorkspace.bind(r.plan);
    vi.spyOn(r.plan, 'bindingsInWorkspace').mockImplementation((ws) => real(ws).filter((b) => b.id !== milestone.id));
    r.lin.over.project = { milestones: [] };
    await passAt(r, r.t.now + 1);
    expect(driftEventsOf(r.db, bindingOf(r, 'epic').id, 0)).toEqual([]);
    expect(items(r)).toEqual([]);
  });
});

// Round 6 P2 (follow-up item 5) and D-8733: the scope follows the binding, and what no binding or managed team names is dropped.
describe('drift scope follows the binding (round 6 P2, D-8733)', () => {
  it('an issue moved from a managed team to an unmanaged one is read and restored, the update carrying the planned team', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { teamKey: 'ZZZ' };
    await passAt(r, r.t.now + 1);
    const up = sent(r, 'issueUpdate');
    expect(up).toHaveLength(1);
    expect(up[0]!.destinationTeamKey).toBe('AAA');
    expect(driftEventsOf(r.db, bindingOf(r, 'ticket').id, 0).map((e) => [e.field, e.restored])).toEqual([['teamKey', true]]);
  });

  it('changedIssues is asked with every team key the slot lists, not only the managed ones', async () => {
    const r = await synced(await rig());
    await seedSlot(r.ccrcDir, 'a', { teams: [...WS.a.teams, { id: U(60), key: 'CCC', name: 'Team C' }] });
    await passAt(r, r.t.now + 1);
    expect(r.asks.find((a) => a.op === 'changedIssues')!.input['teams']).toEqual(['AAA', 'CCC']);
  });

  it('a milestone moved into a project ccrc does not bind raises the unrestorable item at once', async () => {
    const r = await synced(await rig());
    r.lin.over.milestone = { projectId: OTHER };
    await passAt(r, r.t.now + 1);
    expect(sent(r, 'projectMilestoneUpdate')).toEqual([]);
    expect(driftEventsOf(r.db, bindingOf(r, 'checkpoint').id, 0).map((e) => [e.field, e.restored])).toEqual([['projectId', false]]);
    expect(items(r)).toHaveLength(1);
  });

  it('a graced issue moved out of a managed team is compared, so its grace is decided and the by-id re-read stops', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { stateType: 'completed', teamKey: 'ZZZ' };
    r.lin.at.issue = r.t.now;
    await passAt(r, r.t.now + 1);
    expect(sent(r, 'issueUpdate')).toHaveLength(1);                           // the move is put back at once, the state held
    expect(sent(r, 'issueUpdate')[0]!.input).not.toHaveProperty('stateId');
    expect(bindingOf(r, 'ticket').driftSince).toBe(r.t.now);
    r.lin.over.issue = { stateType: 'completed' };                            // back in its team, still completed, untouched since
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(sent(r, 'issueOwned').length).toBeGreaterThan(0);
    expect(sent(r, 'issueUpdate')).toHaveLength(2);                           // the grace's second look restores the state
    r.lin.over.issue = {};
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(bindingOf(r, 'ticket').driftSince).toBeNull();
    r.asks.length = 0;
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(sent(r, 'issueOwned')).toEqual([]);
  });

  it('an issue of an unmanaged team that no binding names is dropped at the read: no row, no event, no mail, no look by the lanes (D-8733)', async () => {
    const r = await synced(await rig());
    const seen: string[] = [];
    r.drift = new DriftPass({
      coord: r.coord, plan: r.plan, planSync: r.sync, readLinearStore: () => readLinearStore(r.ccrcDir), call: (a) => { r.asks.push(a); return Promise.resolve(r.respond.current(a)); },
      now: () => r.t.now, presenceOf: () => 'alive', viaFleet: (ids) => { seen.push(...ids); return new Set<string>(); }, prMergedOf: () => false,
    });
    await seedSlot(r.ccrcDir, 'a', { teams: [...WS.a.teams, { id: U(60), key: 'ZZZ', name: 'Team Z' }] });
    r.lin.extra.issue = [{ id: U(555), identifier: 'ZZZ-1', title: 'Foreign', description: '', teamKey: 'ZZZ', stateType: 'started', projectId: null, milestoneId: null, parentId: null, updatedAt: iso(r.t.now + 1) }];
    await passAt(r, r.t.now + 1);
    expect(seen).not.toContain('ZZZ-1');
    expect(r.db.prepare('SELECT COUNT(*) AS n FROM linear_inbound').get()).toEqual({ n: 0 });
    expect(r.db.prepare('SELECT COUNT(*) AS n FROM linear_drift_events').get()).toEqual({ n: 0 });
    expect(mails(r)).toEqual([]);
    expect(items(r)).toEqual([]);
  });
});

// A-4 and round 5 A1, A2 (follow-up item 9): the comment names ccrc's own values and, of Linear's, only what ccrc's directory holds;
// a restore is recorded only when something was written.
describe('restore comments name values, and a restore is recorded only when written (A-4)', () => {
  const withDirectory = (r: Rig, projects: { id: string; name: string }[]): DriftPass => new DriftPass({
    coord: r.coord, plan: r.plan, planSync: r.sync, readLinearStore: () => readLinearStore(r.ccrcDir),
    call: (a) => { r.asks.push(a); return Promise.resolve(r.respond.current(a)); }, now: () => r.t.now, presenceOf: () => 'alive',
    viaFleet: () => new Set<string>(), prMergedOf: () => false,
    directory: { get: () => ({ ...DIRECTORY, projects }), filledAt: () => T - 1000, projectStatusesRead: () => 'read' },
  });

  it('a moved issue names the plan\'s project, and Linear\'s only when the directory holds it', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { projectId: OTHER };
    await passAt(r, r.t.now + 1);
    const body = String(sent(r, 'issueComment')[0]!.input['body']);
    expect(body).toContain("ccrc restored this issue's project to *Epic one*. It had been moved elsewhere on ");
    expect(body).not.toContain(OTHER);
    const q = await synced(await rig());
    q.lin.over.issue = { projectId: OTHER };
    q.drift = withDirectory(q, [{ id: OTHER, name: 'Backlog' }]);
    await passAt(q, q.t.now + 1);
    expect(String(sent(q, 'issueComment')[0]!.input['body'])).toContain("ccrc restored this issue's project to *Epic one*. It had been moved to *Backlog* on ");
  });

  it('a renamed project names the plan\'s name and never Linear\'s free text', async () => {
    const r = await synced(await rig());
    r.lin.over.project = { name: 'Renamed in Linear' };
    await passAt(r, r.t.now + 1);
    const body = String(sent(r, 'projectComment')[0]!.input['body']);
    expect(body).toContain("ccrc restored this project's name to *Epic one*. It had been changed on ");
    expect(body).not.toContain('Renamed in Linear');
  });

  it('a milestone restore\'s Restored line names every field put back', async () => {
    const r = await synced(await rig());
    r.lin.over.milestone = { name: 'Renamed in Linear', description: 'Edited in Linear' };
    await passAt(r, r.t.now + 1);
    const line = String(sent(r, 'projectMilestoneUpdate')[0]!.input['description']).split('\n').find((l) => l.startsWith('Restored on '));
    expect(line).toBe(`Restored on ${new Date(r.t.now).toISOString().slice(0, 10)}: ccrc put back this milestone's name and description.`);
  });

  it('nothing sent because the key is not configured is deferred: no comment, no record, the read comes again', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { title: 'Edited in Linear' };
    const base = r.respond.current;
    r.respond.current = (ask) => (ask.op === 'issueOwned' && ask.pass === 'drift-restore' ? fail('not-configured') : base(ask));
    await passAt(r, r.t.now + 1);
    expect(sent(r, 'issueUpdate')).toEqual([]);
    expect(sent(r, 'issueComment')).toEqual([]);
    expect(driftEventsOf(r.db, bindingOf(r, 'ticket').id, 0)).toEqual([]);
    expect(r.asks.filter((a) => a.op === 'changedIssues').length).toBe(1);
    r.respond.current = base;
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(r.asks.filter((a) => a.op === 'changedIssues').at(-1)!.input['since']).toBe(iso(T - 1000));   // the watermark was kept
    expect(sent(r, 'issueUpdate')).toHaveLength(1);
  });

  it('nothing sent because Linear already holds the plan is moot: no comment, no record', async () => {
    const r = await synced(await rig());
    r.lin.over.issue = { title: 'Edited in Linear' };
    const base = r.respond.current;
    // The changed read showed the edit; by the restore's own read of the issue it is back.
    r.respond.current = async (ask) => {
      if (ask.op !== 'issueOwned' || ask.pass !== 'drift-restore') return base(ask);
      const saved = r.lin.over.issue;
      r.lin.over.issue = {};
      try { return await base(ask); } finally { r.lin.over.issue = saved; }
    };
    await passAt(r, r.t.now + 1);
    expect(sent(r, 'issueUpdate')).toEqual([]);
    expect(sent(r, 'issueComment')).toEqual([]);
    expect(driftEventsOf(r.db, bindingOf(r, 'ticket').id, 0)).toEqual([]);
  });
});

// Round 5 A3 (follow-up item 11): a milestone a person adds does not raise a kept item again.
describe('a person\'s own milestone is not a new difference (round 5 A3)', () => {
  it('after Keep, a milestone a person adds records nothing, and a further planned milestone going missing is a new event', async () => {
    const r = await synced(await rig());
    r.lin.over.project = { milestones: [] };
    await passAt(r, r.t.now + 1);
    expect(items(r)).toHaveLength(1);
    expect(r.drift.act(items(r)[0]!.id, 'keep', bindingOf(r, 'epic').id)).toEqual({ ok: true });
    r.lin.over.project = { milestones: [{ id: U(888) }] };                   // a person added their own milestone; the plan's is still missing
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(driftEventsOf(r.db, bindingOf(r, 'epic').id, 0).filter((e) => e.field === 'milestoneIds')).toHaveLength(1);
    expect(items(r)).toHaveLength(1);
    // The plan gains a second checkpoint; its milestone is made and is missing from Linear's project too.
    const epic = r.plan.planOf(SLUG).epics[0]!;
    applyPlanChanges(r.db, SLUG, changes({ checkpoints: { insert: [{ epicKey: epic.key, key: 'c2', ordinal: 1, title: 'Checkpoint two', kind: 'acceptance', proves: [], itemId: null }], update: [], drop: [] } }), OWNER, r.t.now, null);
    await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS);
    r.t.now += PLAN_SYNC_DEBOUNCE_MS;
    await passAt(r, r.t.now + DRIFT_PASS_MS);
    expect(driftEventsOf(r.db, bindingOf(r, 'epic').id, 0).filter((e) => e.field === 'milestoneIds')).toHaveLength(2);
    expect(items(r)).toHaveLength(2);
  });
});
