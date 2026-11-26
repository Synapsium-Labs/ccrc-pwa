// D-8182 (Linear hierarchy plan, Task 3.2): the plan sync, the L4 pass around Task 3.1's deciders. A real coord.db, the real
// Linear store on a tmp dir, and Linear faked either at the `call` port (a scripted `CcrcOpOutcome` per op, where the test is
// about the pass's decisions) or, end to end through `runCcrcOp`, at `FetchLike` with the recorded fixtures.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { CoordStore } from '../src/coord/store.js';
import {
  NO_PLAN_CHANGES, applyPlanChanges, ensureUpkeepEpicInTx, markSyncDue, planStorePort, type NewTicket, type PlanChanges, type PlanStorePort,
} from '../src/coord/planStore.js';
import { planViewOf } from '../src/coord/planRoutes.js';
import { runCcrcOp, type CcrcOpAsk, type CcrcOpOutcome } from '../src/linear/ccrcCall.js';
import type { FetchLike } from '../src/linear/client.js';
import { LinearDirectory } from '../src/linear/directory.js';
import { LINEAR_HIERARCHY_DOCUMENTS, LINEAR_DOCUMENTS, type LinearDirectoryEntries } from '../src/linear/ops.js';
import {
  PLAN_SYNC_BACKOFF_MS, PLAN_SYNC_CALL_TIMEOUT_MS, PLAN_SYNC_DEBOUNCE_MS, PLAN_SYNC_TICK_DEADLINE_MS, PlanSync, planSyncFor, type PlanSyncDeps,
} from '../src/linear/planSync.js';
import { PLAN_SYNC_BEAT_MS, laneRow } from '../src/laneSchedule.js';
import { requestIdOf } from '../src/linear/planSyncPolicy.js';
import { readLinearStore } from '../src/linear/store.js';
import { valueDigestHex } from '../src/token/files.js';
import { linearAnswer } from './linearFetchFake.js';
import { linearRecord, recordedAnswer } from './linearRecorded.js';
import { linearServicesFake, memCoordDb } from './linearServicesFake.js';
import { seedSlot, WS } from './linearProxyRig.js';
import { mkTmp } from './tmpHelpers.js';

const T = 1_800_000_000_000;
const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const VIEWER = U(900);
const SLOT = { source: 'file', id: WS.a.id } as const;
const DIGEST = valueDigestHex(WS.a.key);
const OWNER = 'coord-a';
const SLUG = 'prog-a';

const DIRECTORY: LinearDirectoryEntries = {
  viewerId: VIEWER, labels: [], projects: [], users: [], initiatives: 'on',
  states: [
    { id: U(21), name: 'Todo', type: 'unstarted', teamKey: 'AAA' }, { id: U(22), name: 'Doing', type: 'started', teamKey: 'AAA' },
    { id: U(23), name: 'Done', type: 'completed', teamKey: 'AAA' }, { id: U(24), name: 'Nope', type: 'canceled', teamKey: 'AAA' },
  ],
  projectStatuses: [{ id: U(31), name: 'P', type: 'planned' }, { id: U(32), name: 'S', type: 'started' },
    { id: U(33), name: 'C', type: 'completed' }, { id: U(34), name: 'X', type: 'canceled' }],
};

const changes = (over: Partial<PlanChanges>): PlanChanges => ({ ...NO_PLAN_CHANGES(), ...over });
const tk = (key: string, over: Partial<NewTicket> = {}): NewTicket => ({
  program: SLUG, epicKey: 'e1', checkpointKey: 'c1', key, kind: 'work', title: `Ticket ${key}`, body: 'Do it', project: 'project-a', source: 'plan', ...over,
});

type Respond = (ask: CcrcOpAsk, n: number) => CcrcOpOutcome | Promise<CcrcOpOutcome>;
interface Rig {
  db: DatabaseSync; coord: CoordStore; plan: PlanStorePort; ccrcDir: string; t: { now: number };
  asks: CcrcOpAsk[]; respond: { current: Respond }; dir: { entries: LinearDirectoryEntries | null; filledAt: number | null; statuses: 'read' | 'unread' };
  rejected: { slot: unknown; digest: string }[]; misses: number[];
  sync: PlanSync; build: (over?: Partial<PlanSyncDeps>) => PlanSync;
}
const ok = (value: Record<string, unknown> = {}, created: string | null = null): CcrcOpOutcome => ({ ok: true, value, created });
describe('Linear hierarchy wave 8 (D-8808): a project row pinned to a workspace resolves its key there', () => {
  it('a key two workspaces share is routed to the workspace the row names, and routes nowhere without it', async () => {
    const r = await rig();
    await seedSlot(r.ccrcDir, 'b', { teams: [{ id: 'bbbbbbbb-1111-4000-8000-00000000000b', key: 'AAA', name: 'Team A in B' }] });
    r.dir.entries = DIRECTORY;
    await r.sync.tick(afterDebounce(r));
    expect(r.asks).toEqual([]);   // team-ambiguous: neither workspace is chosen for the project
    r.db.prepare('UPDATE project_linking SET teamWorkspace = ? WHERE project = ?').run(WS.b.id, 'project-a');
    r.plan.markSyncDue(SLUG, r.t.now);
    await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS + 1);
    expect(r.asks.length).toBeGreaterThan(0);
    expect(r.asks.every((a) => a.workspaceId === WS.b.id)).toBe(true);
  });
});

const fail = (word: Extract<CcrcOpOutcome, { ok: false; maybeSent: boolean }>['word'], maybeSent = false): CcrcOpOutcome => ({ ok: false, word, maybeSent });

let counter = 1000;
/** The default: a create answers a fresh id, an update answers ok, a by-name read answers no node. */
const defaultRespond: Respond = (ask) => {
  if (ask.op.endsWith('Create')) {
    const id = U(counter++);
    return ok(ask.op === 'issueCreate' ? { id, identifier: `AAA-${counter}` } : { id }, id);
  }
  if (ask.op.endsWith('Update')) return ok({ id: ask.target });
  if (ask.op === 'initiativesByName' || ask.op === 'projectsByName') return ok({ nodes: [] });
  return fail('not-found');
};

let dirs: string[] = [];
async function rig(o: { mode?: 'private' | 'public'; teamKey?: string; epicTitle?: string; directory?: LinearDirectoryEntries | null } = {}): Promise<Rig> {
  const dir = mkTmp('ccrc-plan-sync-');
  dirs.push(dir);
  const ccrcDir = path.join(dir, '.ccrc');
  await seedSlot(ccrcDir, 'a');
  const db = memCoordDb();
  const coord = new CoordStore(db);
  db.prepare('INSERT INTO project_linking (project, teamKey, override) VALUES (?, ?, ?)').run('project-a', o.teamKey ?? 'AAA', o.mode ?? 'private');
  applyPlanChanges(db, SLUG, changes({
    epics: { insert: [{ key: 'e1', project: 'project-a', waves: [1], ordinal: 0, title: o.epicTitle ?? 'Epic one', summary: 'Summary' }], update: [], drop: [] },
    checkpoints: { insert: [{ epicKey: 'e1', key: 'c1', ordinal: 0, title: 'Checkpoint one', kind: 'acceptance', proves: [], itemId: null }], update: [], drop: [] },
    tickets: { insert: [tk('t1')], update: [], drop: [] },
  }), OWNER, T, { home: 'project-a', title: 'Programme A' });
  const plan = planStorePort(db);
  const r = {
    db, coord, plan, ccrcDir, t: { now: T }, asks: [] as CcrcOpAsk[], respond: { current: defaultRespond },
    dir: { entries: o.directory === undefined ? DIRECTORY : o.directory, filledAt: T - 1000, statuses: 'read' },
    rejected: [] as Rig['rejected'], misses: [] as number[],
  } as Rig;
  r.build = (over = {}) => new PlanSync({
    coord, plan, ccrcDir, readLinearStore: () => readLinearStore(ccrcDir),
    call: async (ask) => { r.asks.push(ask); return r.respond.current(ask, r.asks.length); },
    directory: { get: () => r.dir.entries, filledAt: () => r.dir.filledAt, projectStatusesRead: () => (r.dir.entries === null ? null : r.dir.statuses) },
    directoryMiss: () => { r.misses.push(r.t.now); },
    markSlotRejected: async (slot, digest) => { r.rejected.push({ slot, digest }); },
    now: () => r.t.now, privateTrackerKeys: [], ...over,
  });
  r.sync = r.build();
  return r;
}
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* the reaper */ } } dirs = []; });

const opsOf = (r: Rig): string[] => r.asks.map((a) => a.op);
const bindingsOf = (r: Rig) => r.plan.bindingsOf(SLUG);
const bindingOfKind = (r: Rig, kind: string) => bindingsOf(r).find((b) => b.localKind === kind);
const dueAt = (r: Rig): number | null => ((r.db.prepare('SELECT dueAt FROM plan_sync_due WHERE program = ?').get(SLUG) as { dueAt: number } | undefined)?.dueAt ?? null);
const mails = (r: Rig): { subject: string; body: string; toId: string }[] =>
  r.db.prepare("SELECT subject, body, toId FROM mail WHERE subject LIKE 'Linear sync%' ORDER BY id").all() as { subject: string; body: string; toId: string }[];
const afterDebounce = (r: Rig): number => { r.t.now = Math.max(r.t.now, T + PLAN_SYNC_DEBOUNCE_MS); return r.t.now; };

describe('Upkeep notification routing', () => {
  it.each([false, true])('uses measured ownership for Upkeep notices (another slot unreadable: %s)', async (partial) => {
    const r = await rig();
    if (partial) await seedSlot(r.ccrcDir, 'b');
    r.db.prepare('UPDATE project_linking SET linearOwner = ? WHERE project = ?').run('coord-first', 'project-a');
    r.db.prepare('INSERT INTO project_linking (project, teamKey, teamWorkspace, override, linearOwner) VALUES (?, ?, ?, ?, ?)')
      .run('project-b', 'AAA', WS.a.id, 'private', 'coord-pinned');
    ensureUpkeepEpicInTx(r.db, 'project-b', T);
    const fx = linearServicesFake({ db: r.db, ccrcDir: r.ccrcDir });
    const directory = new LinearDirectory();
    directory.put(SLOT, DIGEST, { ...DIRECTORY, projectStatuses: [] }, T, 'read');
    vi.spyOn(fx.refresher, 'directory', 'get').mockReturnValue(directory);
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network request'));
    const sync = planSyncFor({
      coord: r.coord, plan: r.plan, ccrcDir: r.ccrcDir, rate: fx.rate, journal: fx.journal,
      policy: async () => ({ allow: false, why: 'denied', decisionId: null }),
      refresher: fx.refresher, privateTrackerKeys: [], readLinearStore: async () => {
        const store = await readLinearStore(r.ccrcDir);
        if (!partial || store.kind !== 'listed') return store;
        return { ...store, slots: store.slots.map((slot) => slot.id === WS.b.id ? { ...slot, record: { kind: 'unreadable', code: 'EIO' } } : slot) };
      },
      presenceOf: () => 'alive',
    });
    await sync.passFor('upkeep:project-b', Date.now() + 60_000);
    expect(fetch).not.toHaveBeenCalled();
    expect(r.plan.bindingsOf('upkeep:project-b')).toEqual([expect.objectContaining({ state: 'failed', failedWord: 'status-missing' })]);
    expect(mails(r).map((m) => [m.toId, m.subject])).toEqual(partial ? [] : [
      ['coord-first', 'Linear sync: epic upkeep status-missing (upkeep:project-b)'],
    ]);
  });
});

describe('the plan sync (D-8182)', () => {
  it('a due programme is synced once after the debounce, objects bound in order', async () => {
    const r = await rig();
    await r.sync.tick(T + PLAN_SYNC_DEBOUNCE_MS - 1);
    expect(r.asks).toHaveLength(0);                       // inside the debounce
    await r.sync.tick(afterDebounce(r));
    expect(opsOf(r)).toEqual(['initiativeCreate', 'projectCreate', 'projectMilestoneCreate', 'issueCreate', 'initiativeToProjectCreate']);
    expect(bindingsOf(r).map((b) => [b.localKind, b.state])).toEqual([['programme', 'bound'], ['epic', 'bound'], ['checkpoint', 'bound'], ['ticket', 'bound']]);
    expect(dueAt(r)).toBeNull();
    const before = r.asks.length;
    await r.sync.tick(r.t.now + 10_000);
    expect(r.asks).toHaveLength(before);                  // nothing due, nothing sent
  });

  it('a pass sends the create with its requestId as the object id and passes the pass and lane', async () => {
    const r = await rig();
    await r.sync.tick(afterDebounce(r));
    const first = r.asks[0]!;
    expect(first).toMatchObject({ op: 'initiativeCreate', pass: 'plan-sync', lane: 'sync', slot: SLOT, workspaceId: WS.a.id, target: null });
    expect(first.input['requestId']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
    expect(JSON.stringify(first)).not.toContain(WS.a.key);
  });

  const mineNode = (id: unknown, creatorId: string = VIEWER) => ({ id, name: 'Programme A', createdAt: '2026-01-01T00:00:00.000Z', creatorId });

  it('a create answered conflict-on-insert binds the existing object made by this key, with the adopted fingerprint', async () => {
    const r = await rig();
    let id: unknown = null;
    r.respond.current = (ask) => {
      if (ask.op === 'initiativeCreate') { id = ask.input['requestId']; return { ok: false, word: 'linear-invalid', maybeSent: false, detail: 'conflict' }; }
      if (ask.op === 'initiativeById') return ok({ initiative: { id, name: 'Programme A' } });
      if (ask.op === 'initiativesByName') return ok({ nodes: [mineNode(id)] });
      return defaultRespond(ask, 0);
    };
    await r.sync.tick(afterDebounce(r));
    expect(r.asks.find((a) => a.op === 'initiativeById')!.input).toEqual({ id });
    expect(r.asks.find((a) => a.op === 'initiativesByName')!.input).toEqual({ name: 'Programme A' });
    expect(bindingOfKind(r, 'programme')).toMatchObject({ state: 'bound', linearId: id });
    expect(opsOf(r).filter((o) => o === 'initiativeCreate')).toHaveLength(1);   // never a second create
    expect(opsOf(r)).toContain('initiativeUpdate');       // the adopted object is then sent the current inputs once
  });

  it('a conflict whose same-id object has another creator fails the binding and mails once (C11)', async () => {
    const r = await rig();
    let id: unknown = null;
    r.respond.current = (ask) => {
      if (ask.op === 'initiativeCreate') { id = ask.input['requestId']; return { ok: false, word: 'linear-invalid', maybeSent: false, detail: 'conflict' }; }
      if (ask.op === 'initiativeById') return ok({ initiative: { id, name: 'Programme A' } });
      if (ask.op === 'initiativesByName') return ok({ nodes: [mineNode(id, U(901))] });
      return defaultRespond(ask, 0);
    };
    await r.sync.tick(afterDebounce(r));
    expect(bindingOfKind(r, 'programme')).toMatchObject({ state: 'failed', failedWord: 'linear-invalid' });
    expect(opsOf(r).filter((o) => o === 'initiativeCreate')).toHaveLength(1);
    expect(mails(r).filter((m) => m.subject.includes('programme'))).toHaveLength(1);
  });

  it('A11: a conflict whose issue is in another team than planned adopts it with its own team, and the update moves it', async () => {
    const r = await rig();
    r.respond.current = (ask) => {
      if (ask.op === 'issueCreate') return { ok: false, word: 'linear-invalid', maybeSent: false, detail: 'conflict' };
      if (ask.op === 'issueOwned') return ok({ issue: { id: ask.input['id'], identifier: 'BBB-1', teamKey: 'BBB', stateType: 'unstarted' } });
      return defaultRespond(ask, 0);
    };
    await r.sync.tick(afterDebounce(r));
    expect(bindingOfKind(r, 'ticket')).toMatchObject({ state: 'bound', teamKey: 'AAA' });     // the move's ok records the planned team
    expect(opsOf(r).filter((o) => o === 'issueCreate')).toHaveLength(1);
    expect(r.asks.find((a) => a.op === 'issueUpdate')).toMatchObject({ teamKey: 'BBB', destinationTeamKey: 'AAA' });   // C15's move, asked of the policy
    expect(mails(r).filter((m) => m.subject.includes('ticket'))).toHaveLength(0);
  });

  it('a conflict whose issue answers no team key is adopted with the planned team (A11)', async () => {
    const r = await rig();
    r.respond.current = (ask) => {
      if (ask.op === 'issueCreate') return { ok: false, word: 'linear-invalid', maybeSent: false, detail: 'conflict' };
      if (ask.op === 'issueOwned') return ok({ issue: { id: ask.input['id'], identifier: 'AAA-7' } });
      return defaultRespond(ask, 0);
    };
    await r.sync.tick(afterDebounce(r));
    expect(bindingOfKind(r, 'ticket')).toMatchObject({ state: 'bound', teamKey: 'AAA', identifier: 'AAA-7' });
    expect(mails(r).filter((m) => m.subject.includes('ticket'))).toHaveLength(0);
  });

  it('a conflict whose issue is in the planned team binds it', async () => {
    const r = await rig();
    r.respond.current = (ask) => {
      if (ask.op === 'issueCreate') return { ok: false, word: 'linear-invalid', maybeSent: false, detail: 'conflict' };
      if (ask.op === 'issueOwned') return ok({ issue: { id: ask.input['id'], identifier: 'AAA-7', teamKey: 'AAA' } });
      return defaultRespond(ask, 0);
    };
    await r.sync.tick(afterDebounce(r));
    expect(bindingOfKind(r, 'ticket')).toMatchObject({ state: 'bound', identifier: 'AAA-7' });
  });

  it('a create times out, the plan is renamed: the retry conflicts, adopts the object by its own old name, then sends one update with the new name', async () => {
    const r = await rig();
    const existing = { name: 'Programme A', creatorId: VIEWER };   // the object in Linear carries the OLD name and ccrc's id
    let id: unknown = null;
    r.respond.current = (ask) => {
      if (ask.op === 'initiativeCreate') { id = ask.input['requestId']; return fail('timeout', true); }
      return defaultRespond(ask, 0);
    };
    await r.sync.tick(afterDebounce(r));
    r.asks.length = 0;
    r.db.prepare("UPDATE programs SET title = 'Programme renamed' WHERE slug = ?").run(SLUG);
    r.respond.current = (ask) => {
      if (ask.op === 'initiativeCreate') return { ok: false, word: 'linear-invalid', maybeSent: false, detail: 'conflict' };
      if (ask.op === 'initiativeById') return ok({ initiative: { id, name: existing.name } });
      if (ask.op === 'initiativesByName') {   // answers from the name actually passed
        return ok({ nodes: ask.input['name'] === existing.name ? [mineNode(id, existing.creatorId)] : [] });
      }
      return defaultRespond(ask, 0);
    };
    r.db.prepare('UPDATE plan_sync_due SET dueAt = 0').run();
    r.t.now += 60_000;                                    // past the workspace's hold (D-8183)
    await r.sync.tick(r.t.now);
    expect(bindingOfKind(r, 'programme')).toMatchObject({ state: 'bound', linearId: id });
    const updates = r.asks.filter((a) => a.op === 'initiativeUpdate');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.input['name']).toBe('Programme renamed');
    expect(opsOf(r).filter((o) => o === 'initiativeCreate')).toHaveLength(1);
    expect(bindingOfKind(r, 'programme')!.fingerprint).not.toBe('adopted');   // the update wrote the real one
  });

  it('a milestone created twice (name not unique) binds the milestone whose id is the requestId, else fails and mails once', async () => {
    const r = await rig();
    r.respond.current = (ask) => {
      if (ask.op === 'projectMilestoneCreate') return { ok: false, word: 'linear-invalid', maybeSent: false, detail: 'name-taken' };
      if (ask.op === 'projectById') return ok({ project: { id: ask.input['id'], milestones: [{ id: U(5), name: 'Checkpoint one' }] } });
      return defaultRespond(ask, 0);
    };
    await r.sync.tick(afterDebounce(r));
    expect(bindingOfKind(r, 'checkpoint')).toMatchObject({ state: 'failed', failedWord: 'linear-invalid' });
    expect(mails(r)).toHaveLength(1);
    expect(mails(r)[0]!.toId).toBe(OWNER);
  });

  it('a server restart between call and bind sends the same requestId', async () => {
    const r = await rig();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    r.respond.current = (ask) => { if (ask.op === 'initiativeCreate') throw new Error('the server died'); return defaultRespond(ask, 0); };
    await r.sync.tick(afterDebounce(r));
    const first = r.asks.find((a) => a.op === 'initiativeCreate')!;
    expect(bindingOfKind(r, 'programme')).toMatchObject({ state: 'pending', linearId: null });
    // A fresh PlanSync over the same store: the pending row is a create that may have been sent.
    r.asks.length = 0;
    r.respond.current = defaultRespond;
    const again = r.build();
    r.t.now += 2 * PLAN_SYNC_BACKOFF_MS[0];
    await again.passFor(SLUG, r.t.now + 60_000);
    const creates = r.asks.filter((a) => a.op === 'initiativeCreate');
    expect(r.asks[0]!.op).toBe('initiativesByName');      // C2: read by name and creator first
    expect(creates).toHaveLength(1);
    expect(creates[0]!.input['requestId']).toBe(first.input['requestId']);
  });

  it('a plan put during a pass is carried by the next pass', async () => {
    const r = await rig();
    let put = false;
    r.respond.current = (ask) => {
      if (ask.op === 'initiativeCreate' && !put) {
        put = true;
        applyPlanChanges(r.db, SLUG, changes({ tickets: { insert: [tk('t2')], update: [], drop: [] } }), OWNER, r.t.now, null);
      }
      return defaultRespond(ask, 0);
    };
    await r.sync.tick(afterDebounce(r));
    await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS + 1);
    expect(opsOf(r).filter((o) => o === 'issueCreate')).toHaveLength(2);
    expect(bindingsOf(r).filter((b) => b.localKind === 'ticket').every((b) => b.state === 'bound')).toBe(true);
    expect(dueAt(r)).toBeNull();
  });

  it('linear-forbidden marks the binding failed and mails the coordinator once', async () => {
    const r = await rig();
    r.respond.current = (ask) => (ask.op === 'projectCreate' ? fail('linear-forbidden') : defaultRespond(ask, 0));
    await r.sync.tick(afterDebounce(r));
    expect(bindingOfKind(r, 'epic')).toMatchObject({ state: 'failed', failedWord: 'linear-forbidden' });
    expect(bindingOfKind(r, 'programme')?.state).toBe('bound');         // the pass goes on with other objects
    expect(mails(r)).toHaveLength(1);
    expect(mails(r)[0]).toMatchObject({ toId: OWNER });
    expect(mails(r)[0]!.subject).toContain('e1');
    expect(mails(r)[0]!.subject).toContain('linear-forbidden');
  });

  it('rate-limited defers by 30 s, then 2 min', async () => {
    const r = await rig();
    r.respond.current = () => ({ ok: false, word: 'rate-limited', retryAfterS: 1 });
    await r.sync.tick(afterDebounce(r));
    expect(dueAt(r)).toBe(r.t.now + 30_000);
    r.t.now += 30_000 + PLAN_SYNC_DEBOUNCE_MS;
    await r.sync.tick(r.t.now);
    expect(dueAt(r)).toBe(r.t.now + 120_000);
    expect(r.asks).toHaveLength(2);
  });

  it('a retryAfterS beyond the backoff step defers by the longer wait', async () => {
    const r = await rig();
    r.respond.current = () => ({ ok: false, word: 'rate-limited', retryAfterS: 90 });
    await r.sync.tick(afterDebounce(r));
    expect(dueAt(r)).toBe(r.t.now + 90_000);
  });

  it('a pass never runs past its deadline', async () => {
    const r = await rig();
    r.respond.current = (ask) => { r.t.now += 1000; return defaultRespond(ask, 0); };
    const out = await r.sync.passFor(SLUG, r.t.now + 1);
    expect(out).toBe('deferred');
    expect(r.asks).toHaveLength(1);
    expect(dueAt(r)).not.toBeNull();                      // still due: the next tick carries on
  });

  it("C2': same-named objects made by this key at other ids are never adopted: the create is sent with its id", async () => {
    const r = await rig();
    r.plan.ensurePending('programme', r.plan.programmeRowId(SLUG)!, WS.a.id, null);
    const node = (n: number) => ({ id: U(n), name: 'Programme A', createdAt: '2026-01-01T00:00:00.000Z', creatorId: VIEWER });
    r.respond.current = (ask) => (ask.op === 'initiativesByName' ? ok({ nodes: [node(11), node(12)] }) : defaultRespond(ask, 0));
    await r.sync.tick(afterDebounce(r));
    const sent = r.asks.filter((a) => a.op === 'initiativeCreate');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.input['requestId']).toBe(requestIdOf('programme', r.plan.programmeRowId(SLUG)!, WS.a.id));
    expect(bindingOfKind(r, 'programme')?.linearId).not.toBe(U(11));
    expect(bindingOfKind(r, 'programme')?.linearId).not.toBe(U(12));
    expect(mails(r)).toHaveLength(0);
  });

  it('a crash with the journal row still pending binds its own object (requestId and creator), and sends no second create', async () => {
    const r = await rig();
    r.plan.ensurePending('programme', r.plan.programmeRowId(SLUG)!, WS.a.id, null);
    const rid = requestIdOf('programme', r.plan.programmeRowId(SLUG)!, WS.a.id);
    r.respond.current = (ask) => (ask.op === 'initiativesByName'
      ? ok({ nodes: [{ id: rid, name: 'Programme A', createdAt: '2026-01-01T00:00:00.000Z', creatorId: VIEWER }] }) : defaultRespond(ask, 0));
    await r.sync.tick(afterDebounce(r));
    expect(bindingOfKind(r, 'programme')).toMatchObject({ state: 'bound', linearId: rid });
    expect(opsOf(r)).not.toContain('initiativeCreate');
    expect(r.asks[0]).toMatchObject({ op: 'initiativesByName', input: { name: 'Programme A' }, pass: 'plan-sync' });
  });

  it('an object of the same name made by another creator, or already bound, is not taken', async () => {
    const r = await rig();
    r.plan.ensurePending('programme', r.plan.programmeRowId(SLUG)!, WS.a.id, null);
    // Another binding of this programme already holds U(14).
    const held = r.plan.ensurePending('epic', r.plan.planOf(SLUG).epics[0]!.id, WS.a.id, 'AAA');
    r.plan.markBound(held.id, U(14), null, 'fp', T);
    r.respond.current = (ask) => (ask.op === 'initiativesByName' ? ok({ nodes: [
      { id: U(13), name: 'Programme A', createdAt: '2026-01-01T00:00:00.000Z', creatorId: U(901) },     // another creator
      { id: U(14), name: 'Programme A', createdAt: '2026-01-01T00:00:00.000Z', creatorId: VIEWER },     // held by a binding
    ] }) : defaultRespond(ask, 0));
    await r.sync.tick(afterDebounce(r));
    expect(opsOf(r)).toContain('initiativeCreate');
    expect(bindingOfKind(r, 'programme')?.linearId).not.toBe(U(13));
    expect(bindingOfKind(r, 'programme')?.linearId).not.toBe(U(14));
  });

  it('a text refused by the public-text guard fails its binding, mails once, and the pass goes on', async () => {
    const r = await rig({ mode: 'public', epicTitle: 'Fix AAA-123 now' });
    await r.sync.tick(afterDebounce(r));
    expect(bindingOfKind(r, 'epic')).toMatchObject({ state: 'failed', failedWord: 'text-public' });
    expect(opsOf(r)).toContain('initiativeCreate');       // the pass went on
    expect(mails(r)).toHaveLength(1);
    expect(JSON.stringify(mails(r))).not.toContain('AAA-123');   // never the text itself
    await r.sync.tick(r.t.now + 10_000);
    expect(mails(r)).toHaveLength(1);
  });

  it('two concurrent passFor calls on a name-and-creator create send exactly one create', async () => {
    const r = await rig();
    r.plan.ensurePending('programme', r.plan.programmeRowId(SLUG)!, WS.a.id, null);
    r.respond.current = async (ask) => { await new Promise((res) => setTimeout(res, 15)); return defaultRespond(ask, 0); };
    const deadline = r.t.now + 60_000;
    await Promise.all([r.sync.passFor(SLUG, deadline), r.sync.passFor(SLUG, deadline)]);
    expect(opsOf(r).filter((o) => o === 'initiativeCreate')).toHaveLength(1);
    expect(opsOf(r).filter((o) => o === 'initiativesByName')).toHaveLength(1);
  });

  it('a tick the lane runner restarts as stuck joins the pass in flight', async () => {
    const r = await rig();
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => { release = res; });
    r.respond.current = async (ask) => { if (ask.op === 'initiativeCreate') await gate; return defaultRespond(ask, 0); };
    const now = afterDebounce(r);
    const first = r.sync.tick(now);
    for (let i = 0; i < 300 && !opsOf(r).includes('initiativeCreate'); i += 1) await new Promise((res) => setTimeout(res, 10));
    const second = r.sync.tick(now);                      // the runner's restart, while the first still waits on Linear
    await new Promise((res) => setTimeout(res, 50));
    expect(opsOf(r).filter((o) => o === 'initiativeCreate')).toHaveLength(1);
    release();
    await Promise.all([first, second]);
    expect(opsOf(r).filter((o) => o === 'initiativeCreate')).toHaveLength(1);
    expect(bindingOfKind(r, 'programme')?.state).toBe('bound');
  });

  it('tick deadline plus one call timeout is below the row staleAfterMs', () => {
    const row = laneRow('linearPlanSync');
    expect(row).toMatchObject({ cadenceMs: PLAN_SYNC_BEAT_MS, derivedFrom: null, clock: 'mono', flight: 'skip', staleAfterMs: 120_000, warnKey: 'ccrc-server: linear plan sync failed' });
    expect(PLAN_SYNC_BEAT_MS).toBe(5_000);
    expect(PLAN_SYNC_TICK_DEADLINE_MS).toBe(60_000);
    expect(PLAN_SYNC_CALL_TIMEOUT_MS).toBe(15_000);
    expect(PLAN_SYNC_TICK_DEADLINE_MS + PLAN_SYNC_CALL_TIMEOUT_MS).toBeLessThan(row.staleAfterMs!);
    expect(PLAN_SYNC_BACKOFF_MS).toEqual([30_000, 120_000, 600_000, 1_800_000]);
  });
});

describe('every outcome has one handling', () => {
  const ROWS: { name: string; out: CcrcOpOutcome; binding: 'pending' | 'failed'; word?: string; defers: boolean; mails: number }[] = [
    { name: 'rate-limited', out: { ok: false, word: 'rate-limited', retryAfterS: 1 }, binding: 'pending', defers: true, mails: 0 },
    { name: 'unreachable', out: fail('unreachable'), binding: 'pending', defers: true, mails: 0 },
    { name: 'timeout, not sent', out: fail('timeout'), binding: 'pending', defers: true, mails: 0 },
    { name: 'timeout, maybe sent', out: fail('timeout', true), binding: 'pending', defers: true, mails: 0 },
    { name: 'malformed', out: fail('malformed', true), binding: 'pending', defers: true, mails: 0 },
    { name: 'not-configured', out: fail('not-configured'), binding: 'pending', defers: false, mails: 0 },
    { name: 'policy-unavailable', out: fail('policy-unavailable'), binding: 'pending', defers: true, mails: 0 },
    { name: 'journal-unavailable', out: fail('journal-unavailable'), binding: 'pending', defers: true, mails: 0 },
    { name: 'policy-denied', out: fail('policy-denied'), binding: 'failed', word: 'policy-denied', defers: false, mails: 1 },
    { name: 'linear-forbidden', out: fail('linear-forbidden'), binding: 'failed', word: 'linear-forbidden', defers: false, mails: 1 },
    { name: 'linear-invalid', out: fail('linear-invalid'), binding: 'failed', word: 'linear-invalid', defers: false, mails: 1 },
  ];
  it.each(ROWS)('outcome $name: binding, programme and mail as the table says', async (row) => {
    const r = await rig();
    r.respond.current = (ask) => (ask.op === 'initiativeCreate' ? row.out : defaultRespond(ask, 0));
    await r.sync.tick(afterDebounce(r));
    const b = bindingOfKind(r, 'programme')!;
    expect(b.state).toBe(row.binding);
    if (row.word !== undefined) expect(b.failedWord).toBe(row.word);
    if (row.defers) expect(dueAt(r)).toBeGreaterThanOrEqual(r.t.now + 30_000);
    else if (row.binding === 'pending') expect(dueAt(r)).toBe(T);                        // due stays
    expect(mails(r).filter((m) => m.subject.includes('programme'))).toHaveLength(row.mails);
  });

  // D-9132: a plain `unreachable` (a transport failure, nothing answered) only holds: it never fails the binding, however many
  // passes run. The same word with `outsideTable` (Linear answered, outside the closed table) is the malformed row's.
  it('D-9132: a plain unreachable, maybe sent, only holds however many passes run, and mails nothing', async () => {
    const r = await rig();
    r.respond.current = (ask) => (ask.op === 'initiativeCreate' ? fail('unreachable', true) : defaultRespond(ask, 0));
    for (let i = 0; i < PLAN_SYNC_BACKOFF_MS.length + 3; i += 1) {
      await r.sync.passFor(SLUG, r.t.now + 60_000);
      r.db.prepare('UPDATE plan_sync_due SET dueAt = 0').run();
      r.t.now += PLAN_SYNC_BACKOFF_MS[PLAN_SYNC_BACKOFF_MS.length - 1]! + 1;
    }
    expect(bindingOfKind(r, 'programme')).toMatchObject({ state: 'pending', failedWord: null });
    expect(mails(r)).toEqual([]);
  });

  it('D-9132: unreachable outside the closed table is failed malformed after the last backoff step, mailed once', async () => {
    const r = await rig();
    r.respond.current = (ask) => (ask.op === 'initiativeCreate' ? { ok: false, word: 'unreachable', maybeSent: true, outsideTable: true } : defaultRespond(ask, 0));
    for (let i = 0; i < PLAN_SYNC_BACKOFF_MS.length + 2; i += 1) {
      await r.sync.passFor(SLUG, r.t.now + 60_000);
      r.db.prepare('UPDATE plan_sync_due SET dueAt = 0').run();
      r.t.now += PLAN_SYNC_BACKOFF_MS[PLAN_SYNC_BACKOFF_MS.length - 1]! + 1;
    }
    expect(bindingOfKind(r, 'programme')).toMatchObject({ state: 'failed', failedWord: 'malformed' });
    expect(mails(r).filter((m) => m.subject.includes('malformed'))).toHaveLength(1);
  });

  it('the first outcome that defers ends the pass: no later step is sent', async () => {
    const r = await rig();
    r.respond.current = () => fail('unreachable');
    await r.sync.tick(afterDebounce(r));
    expect(r.asks).toHaveLength(1);
  });

  it('malformed is failed after the last backoff step, mailed once', async () => {
    const r = await rig();
    r.respond.current = (ask) => (ask.op === 'initiativeCreate' ? fail('malformed', true) : defaultRespond(ask, 0));
    for (let i = 0; i < PLAN_SYNC_BACKOFF_MS.length + 2; i += 1) {
      await r.sync.passFor(SLUG, r.t.now + 60_000);
      r.db.prepare('UPDATE plan_sync_due SET dueAt = 0').run();
      r.t.now += PLAN_SYNC_BACKOFF_MS[PLAN_SYNC_BACKOFF_MS.length - 1]! + 1;   // past the workspace's hold (D-8183)
      // A pending row is a create that may have been sent: the next pass reads by name first, which answers no node.
    }
    expect(bindingOfKind(r, 'programme')).toMatchObject({ state: 'failed', failedWord: 'malformed' });
    expect(mails(r).filter((m) => m.subject.includes('malformed'))).toHaveLength(1);
  });

  it('not-found on an update of a bound object fails the binding with the word and mails once', async () => {
    const r = await rig();
    await r.sync.tick(afterDebounce(r));
    r.respond.current = (ask) => (ask.op === 'projectUpdate' ? fail('not-found') : defaultRespond(ask, 0));
    applyPlanChanges(r.db, SLUG, changes({ epics: { insert: [], update: [{ id: r.plan.planOf(SLUG).epics[0]!.id, title: 'Renamed epic' }], drop: [] } }), OWNER, r.t.now, null);
    await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS + 1);
    expect(bindingOfKind(r, 'epic')).toMatchObject({ state: 'failed', failedWord: 'not-found' });
    expect(mails(r)).toHaveLength(1);
  });

  it('a skip (status-missing) fails the binding with the reason and mails once', async () => {
    const r = await rig({ directory: { ...DIRECTORY, projectStatuses: [] } });
    await r.sync.tick(afterDebounce(r));
    expect(bindingOfKind(r, 'epic')).toMatchObject({ state: 'failed', failedWord: 'status-missing' });
    expect(mails(r)).toHaveLength(1);
  });

  it('linear-unauthorised marks the slot rejected, defers the workspace and mails nothing', async () => {
    const r = await rig();
    r.respond.current = () => fail('linear-unauthorised');
    await r.sync.tick(afterDebounce(r));
    expect(r.rejected).toEqual([{ slot: SLOT, digest: DIGEST }]);
    expect(dueAt(r)).toBeGreaterThan(r.t.now);
    expect(mails(r)).toHaveLength(0);
    expect(r.asks).toHaveLength(1);
    // another programme in the same workspace is deferred without a call
    r.db.prepare("INSERT INTO programs (slug, title, createdAt, state, homeProject, planRequired) VALUES ('prog-b', 'B', 1, 'active', 'project-a', 1)").run();
    applyPlanChanges(r.db, 'prog-b', changes({ epics: { insert: [{ key: 'e1', project: 'project-a', waves: [1], ordinal: 0, title: 'E', summary: 's' }], update: [], drop: [] } }), OWNER, T, null);
    const before = r.asks.length;
    await r.sync.passFor('prog-b', r.t.now + 60_000);
    expect(r.asks).toHaveLength(before);
  });

  it('a create that times out after send stays pending and the next pass binds it by name, at its requestId', async () => {
    const r = await rig();
    r.respond.current = (ask) => (ask.op === 'initiativeCreate' ? fail('timeout', true) : defaultRespond(ask, 0));
    await r.sync.tick(afterDebounce(r));
    expect(bindingOfKind(r, 'programme')?.state).toBe('pending');
    r.asks.length = 0;
    const rid = requestIdOf('programme', r.plan.programmeRowId(SLUG)!, WS.a.id);
    r.respond.current = (ask) => (ask.op === 'initiativesByName'
      ? ok({ nodes: [{ id: rid, name: 'Programme A', createdAt: '2026-01-01T00:00:00.000Z', creatorId: VIEWER }] }) : defaultRespond(ask, 0));
    r.t.now += 30_000 + PLAN_SYNC_DEBOUNCE_MS;
    await r.sync.tick(r.t.now);
    expect(bindingOfKind(r, 'programme')).toMatchObject({ state: 'bound', linearId: rid });
    expect(opsOf(r)).not.toContain('initiativeCreate');
  });

  it('an update that may have been sent is re-sent (updates set absolute values)', async () => {
    const r = await rig();
    await r.sync.tick(afterDebounce(r));
    r.asks.length = 0;
    applyPlanChanges(r.db, SLUG, changes({ epics: { insert: [], update: [{ id: r.plan.planOf(SLUG).epics[0]!.id, title: 'Renamed epic' }], drop: [] } }), OWNER, r.t.now, null);
    r.respond.current = (ask) => (ask.op === 'projectUpdate' ? fail('timeout', true) : defaultRespond(ask, 0));
    await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS + 1);
    const stale = bindingOfKind(r, 'epic')!.fingerprint;
    r.respond.current = defaultRespond;
    r.t.now += 31_000 + PLAN_SYNC_DEBOUNCE_MS;
    await r.sync.tick(r.t.now);
    expect(opsOf(r).filter((o) => o === 'projectUpdate')).toHaveLength(2);
    expect(bindingOfKind(r, 'epic')!.fingerprint).not.toBe(stale);
  });
});

describe('D-8701 episodes: the bounded waits (coordinator ruling, mail 22220; I1)', () => {
  const episodeMails = (r: Rig, word: string) => mails(r).filter((m) => m.subject.includes(word));
  /** One directory refill (a new `filledAt` for the slot's key), then a tick once the programme is due. */
  async function refill(r: Rig): Promise<void> {
    r.dir.filledAt = r.t.now + 1;
    r.t.now = Math.max(r.t.now + 2, dueAt(r) ?? 0) + PLAN_SYNC_DEBOUNCE_MS;
    await r.sync.tick(r.t.now);
  }
  async function unknownStreak(): Promise<Rig> {
    const r = await rig({ directory: { ...DIRECTORY, initiatives: 'unknown' } });
    await r.sync.tick(afterDebounce(r));                    // refill 1 (the fill the pass first sees)
    await refill(r); await refill(r);                       // refills 2 and 3: the bound
    return r;
  }

  it('the probe: after 3 refills that all read unknown the pass settles without the initiative, and asks no more refills', async () => {
    const r = await rig({ directory: { ...DIRECTORY, initiatives: 'unknown' } });
    await r.sync.tick(afterDebounce(r));
    expect(dueAt(r)).not.toBeNull();
    await refill(r);
    expect(dueAt(r)).not.toBeNull();                       // two refills: still waiting
    await refill(r);
    expect(dueAt(r)).toBeNull();                           // the third: settled
    expect(opsOf(r)).toEqual(['projectCreate', 'projectMilestoneCreate', 'issueCreate']);
    const asked = r.misses.length;
    r.plan.markSyncDue(SLUG, r.t.now);
    await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS + 1);
    expect(r.misses).toHaveLength(asked);                   // past the bound the probe asks no refill
    expect(dueAt(r)).toBeNull();
  });

  it('the probe: one mail per episode, not one per pass; a later unknown streak is a new episode', async () => {
    const r = await unknownStreak();
    expect(episodeMails(r, 'initiatives-unknown')).toHaveLength(1);
    const m = episodeMails(r, 'initiatives-unknown')[0]!;
    expect(m.toId).toBe(OWNER);
    expect(m.body).toContain('cannot tell whether initiatives are on');
    for (let i = 0; i < 3; i += 1) { r.plan.markSyncDue(SLUG, r.t.now); r.t.now += PLAN_SYNC_DEBOUNCE_MS + 1; await r.sync.tick(r.t.now); }
    await refill(r);
    expect(episodeMails(r, 'initiatives-unknown')).toHaveLength(1);
    r.dir.entries = DIRECTORY;                               // on: the episode ends (the initiative is created and linked)
    await refill(r);
    await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS + 1);
    expect(opsOf(r)).toContain('initiativeCreate');
    r.dir.entries = { ...DIRECTORY, initiatives: 'unknown' };   // unknown again, and the initiative has an update waiting
    r.db.prepare('UPDATE programs SET title = ? WHERE slug = ?').run('Programme A renamed', SLUG);
    r.plan.markSyncDue(SLUG, r.t.now);
    await refill(r); await refill(r);
    expect(episodeMails(r, 'initiatives-unknown')).toHaveLength(1);
    await refill(r);
    expect(episodeMails(r, 'initiatives-unknown')).toHaveLength(2);    // a new episode: its own mail
  });

  it('the probe: on after the streak creates the initiative and links the projects, with no plan change', async () => {
    const r = await unknownStreak();
    expect(dueAt(r)).toBeNull();
    const from = r.asks.length;
    r.dir.entries = DIRECTORY;                               // the next refill reads on
    await refill(r);
    await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS + 1);
    expect(opsOf(r).slice(from)).toEqual(['initiativeCreate', 'initiativeToProjectCreate']);
    expect(dueAt(r)).toBeNull();
  });

  it('the probe: a restart keeps the settled mark, so the refill reading on creates the initiative (D-8183, carried item 1)', async () => {
    const r = await unknownStreak();
    expect(dueAt(r)).toBeNull();                             // settled without its initiative
    const from = r.asks.length;
    const restarted = r.build();                             // a restart: a new PlanSync over the same coord.db
    r.dir.entries = DIRECTORY;                               // the next refill reads on
    r.dir.filledAt = r.t.now + 1;
    r.t.now += 2 * PLAN_SYNC_DEBOUNCE_MS;
    await restarted.tick(r.t.now);
    await restarted.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS + 1);
    expect(opsOf(r).slice(from)).toEqual(['initiativeCreate', 'initiativeToProjectCreate']);
  });

  it('the probe: a streak at 2 refills survives a restart, and the episode sends one mail however often it restarts (D-8183, carried item 6)', async () => {
    const r = await rig({ directory: { ...DIRECTORY, initiatives: 'unknown' } });
    await r.sync.tick(afterDebounce(r));                    // refill 1
    await refill(r);                                        // refill 2
    expect(episodeMails(r, 'initiatives-unknown')).toHaveLength(0);
    r.sync = r.build();                                     // a restart: the streak is the store's
    await refill(r);                                        // refill 3: the bound, in the new process
    expect(dueAt(r)).toBeNull();
    expect(episodeMails(r, 'initiatives-unknown')).toHaveLength(1);
    r.sync = r.build();                                     // another restart, and more passes of the same episode
    r.plan.markSyncDue(SLUG, r.t.now);
    await refill(r);
    expect(episodeMails(r, 'initiatives-unknown')).toHaveLength(1);
  });

  it('unread statuses: a restart keeps the streak too, so the bound mails once', async () => {
    const r = await rig({ directory: { ...DIRECTORY, projectStatuses: [] } });
    r.dir.statuses = 'unread';
    await r.sync.tick(afterDebounce(r));
    await refill(r);
    r.sync = r.build();
    await refill(r);
    expect(episodeMails(r, 'statuses-unread')).toHaveLength(1);
    r.sync = r.build();
    await refill(r);
    expect(episodeMails(r, 'statuses-unread')).toHaveLength(1);
  });

  describe('D-8183 carried item 10: the probe mail says what waits', () => {
    /** A synced programme (initiative bound), then the probe reads unknown and the initiative has an update waiting. */
    async function boundThenUnknown(end: boolean): Promise<Rig> {
      const r = await rig();
      await r.sync.tick(afterDebounce(r));
      expect(bindingOfKind(r, 'programme')).toMatchObject({ state: 'bound' });
      r.dir.entries = { ...DIRECTORY, initiatives: 'unknown' };
      if (end) r.plan.closePlan(SLUG, 'done', null, r.t.now);
      else r.db.prepare('UPDATE programs SET title = ? WHERE slug = ?').run('Programme A renamed', SLUG);
      r.plan.markSyncDue(SLUG, r.t.now);
      await refill(r); await refill(r); await refill(r);
      return r;
    }
    it('a bound initiative whose update waits: its projects stay linked as they are', async () => {
      const m = episodeMails(await boundThenUnknown(false), 'initiatives-unknown');
      expect(m).toHaveLength(1);
      expect(m[0]!.body).toContain("the initiative's update waits; its projects stay linked as they are");
      expect(m[0]!.body).not.toContain('not linked to an initiative');
      expect(m[0]!.body).not.toContain('closed once ccrc can tell');
    });
    it("a bound initiative at the programme's end stays unclosed until ccrc can tell", async () => {
      const m = episodeMails(await boundThenUnknown(true), 'initiatives-unknown');
      expect(m).toHaveLength(1);
      expect(m[0]!.body).toContain('closed once ccrc can tell');
    });
    it('an initiative never created reads as before', async () => {
      const m = episodeMails(await unknownStreak(), 'initiatives-unknown');
      expect(m[0]!.body).toContain('the initiative of prog-a there is waiting');
    });
  });

  it('the probe: no operator item is raised on unknown', async () => {
    const r = await unknownStreak();
    expect(r.db.prepare('SELECT COUNT(*) AS n FROM operator_items').get()).toEqual({ n: 0 });
  });

  it('unread statuses: the wait escalates on the backoff rather than repeating every 10 s', async () => {
    const r = await rig({ directory: { ...DIRECTORY, projectStatuses: [] } });
    r.dir.statuses = 'unread';
    await r.sync.tick(afterDebounce(r));
    expect(dueAt(r)! - r.t.now).toBe(PLAN_SYNC_BACKOFF_MS[0]);
    r.t.now = dueAt(r)! + PLAN_SYNC_DEBOUNCE_MS;
    await r.sync.tick(r.t.now);
    expect(dueAt(r)! - r.t.now).toBe(PLAN_SYNC_BACKOFF_MS[1]);
    expect(r.asks).toEqual([]);
  });

  it('unread statuses: one mail per episode after 3 unread refills; the programme keeps waiting', async () => {
    const r = await rig({ directory: { ...DIRECTORY, projectStatuses: [] } });
    r.dir.statuses = 'unread';
    await r.sync.tick(afterDebounce(r));
    await refill(r);
    expect(episodeMails(r, 'statuses-unread')).toHaveLength(0);
    await refill(r);
    expect(episodeMails(r, 'statuses-unread')).toHaveLength(1);
    expect(episodeMails(r, 'statuses-unread')[0]!.body).toContain('could not read the project statuses');
    await refill(r); await refill(r);
    expect(episodeMails(r, 'statuses-unread')).toHaveLength(1);
    expect(dueAt(r)).not.toBeNull();
    expect(r.asks).toEqual([]);
    expect(bindingsOf(r).filter((b) => b.state === 'failed')).toEqual([]);
  });

  it('unread statuses: a refill that reads them ends the episode and the workspace syncs', async () => {
    const r = await rig({ directory: { ...DIRECTORY, projectStatuses: [] } });
    r.dir.statuses = 'unread';
    await r.sync.tick(afterDebounce(r));
    await refill(r); await refill(r);
    r.dir.entries = DIRECTORY;
    r.dir.statuses = 'read';
    await refill(r);
    expect(bindingOfKind(r, 'epic')?.state).toBe('bound');
    expect(dueAt(r)).toBeNull();
    r.dir.entries = { ...DIRECTORY, projectStatuses: [] };   // a later unread streak is a new episode
    r.dir.statuses = 'unread';
    applyPlanChanges(r.db, SLUG, changes({ epics: { insert: [], update: [{ id: r.plan.planOf(SLUG).epics[0]!.id, title: 'Renamed epic' }], drop: [] } }), OWNER, r.t.now, null);
    await refill(r); await refill(r); await refill(r);
    expect(episodeMails(r, 'statuses-unread')).toHaveLength(2);
  });
});

describe('A7/A12: a deferring failure holds its backoff', () => {
  it('a plan write, a run transition or an attach never pulls a programme deferred for a failure back to now', async () => {
    const r = await rig();
    r.respond.current = () => fail('unreachable');
    await r.sync.tick(afterDebounce(r));
    const held = dueAt(r)!;
    expect(held).toBeGreaterThanOrEqual(r.t.now + PLAN_SYNC_BACKOFF_MS[0]);
    applyPlanChanges(r.db, SLUG, changes({ epics: { insert: [], update: [{ id: r.plan.planOf(SLUG).epics[0]!.id, title: 'Renamed epic' }], drop: [] } }), OWNER, r.t.now, null);
    r.plan.markSyncDue(SLUG, r.t.now);                     // what a run transition, an attach or ensureTicketBound writes
    expect(dueAt(r)).toBe(held);
    const n = r.asks.length;
    await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS + 1);
    expect(r.asks).toHaveLength(n);                        // no pass inside the backoff
    r.respond.current = defaultRespond;
    r.t.now = held + PLAN_SYNC_DEBOUNCE_MS;
    await r.sync.tick(r.t.now);
    expect(bindingOfKind(r, 'epic')?.state).toBe('bound');
  });

  it('an ordinary deferral (a directory wait) is pulled to now by the next mark', async () => {
    const r = await rig({ directory: null });
    await r.sync.tick(afterDebounce(r));
    expect(dueAt(r)).toBeGreaterThan(r.t.now);
    r.plan.markSyncDue(SLUG, r.t.now);
    expect(dueAt(r)).toBe(r.t.now);
  });
});

describe('D-8183 carried item 2: a failing workspace holds only its own steps (D-8702)', () => {
  /** Epic one in project-a (workspace a, team AAA) and epic two in project-b (workspace b, team BBB). */
  async function twoWorkspaces(): Promise<Rig> {
    const r = await rig();
    await seedSlot(r.ccrcDir, 'b');
    r.db.prepare('INSERT INTO project_linking (project, teamKey, override) VALUES (?, ?, ?)').run('project-b', 'BBB', 'private');
    applyPlanChanges(r.db, SLUG, changes({ epics: { insert: [{ key: 'e2', project: 'project-b', waves: [1], ordinal: 1, title: 'Epic two', summary: 'Summary two' }], update: [], drop: [] } }), OWNER, T, null);
    return r;
  }
  const epicIn = (r: Rig, ws: string) => bindingsOf(r).find((b) => b.localKind === 'epic' && b.workspaceId === ws);
  const aFails = (r: Rig, word: Extract<CcrcOpOutcome, { ok: false; maybeSent: boolean }>['word'] = 'unreachable'): void => {
    r.respond.current = (ask, n) => (ask.op === 'projectCreate' && ask.workspaceId === WS.a.id ? fail(word) : defaultRespond(ask, n));
  };

  it('workspace a unreachable: workspace b\'s project is created in the same tick, and the row is deferred only after', async () => {
    const r = await twoWorkspaces();
    aFails(r);
    await r.sync.tick(afterDebounce(r));
    expect(epicIn(r, WS.b.id)).toMatchObject({ state: 'bound' });
    expect(epicIn(r, WS.a.id)?.state).not.toBe('bound');
    expect(opsOf(r).filter((o) => o === 'projectCreate')).toHaveLength(2);
    expect(dueAt(r)! - r.t.now).toBe(PLAN_SYNC_BACKOFF_MS[0]);               // the earliest workspace hold
    expect(r.plan.heldSyncUntil(SLUG, r.t.now)).toBe(dueAt(r));               // a failure (D-8702): no mark shortens it
  });

  it('a held workspace is not called again until its hold passes, and it escalates on its own step counter', async () => {
    const r = await twoWorkspaces();
    aFails(r);
    await r.sync.tick(afterDebounce(r));
    const calls = r.asks.length;
    await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS + 1);                   // inside the hold: nothing sent
    expect(r.asks).toHaveLength(calls);
    r.t.now = dueAt(r)! + PLAN_SYNC_DEBOUNCE_MS;
    await r.sync.tick(r.t.now);
    expect(opsOf(r).filter((o) => o === 'projectCreate')).toHaveLength(3);   // a again (b is bound)
    expect(dueAt(r)! - r.t.now).toBe(PLAN_SYNC_BACKOFF_MS[1]);
  });

  it('the hold is per workspace: a workspace that failed once does not make another\'s next failure a later step', async () => {
    const r = await twoWorkspaces();
    aFails(r);
    await r.sync.tick(afterDebounce(r));
    r.respond.current = (ask, n) => (ask.op === 'projectCreate' ? fail('unreachable') : defaultRespond(ask, n));
    r.t.now = dueAt(r)! + PLAN_SYNC_DEBOUNCE_MS;
    await r.sync.tick(r.t.now);                                               // a: its second failure (step 1)
    expect(dueAt(r)! - r.t.now).toBe(PLAN_SYNC_BACKOFF_MS[1]);
  });

  it('a cause that is not one workspace\'s (an unreadable store) still holds the programme', async () => {
    const r = await twoWorkspaces();
    const sync = r.build({ readLinearStore: async () => ({ kind: 'unreadable', code: 'unreadable' }) });
    await sync.tick(afterDebounce(r));
    expect(r.asks).toHaveLength(0);
    expect(dueAt(r)! - r.t.now).toBe(PLAN_SYNC_BACKOFF_MS[0]);
    expect(r.plan.heldSyncUntil(SLUG, r.t.now)).toBe(dueAt(r));
  });
});

describe('D-8707: a project write carries every team it puts the project in', () => {
  it('a project with a second team\'s ticket asks the policy with both keys, on create and on update', async () => {
    const r = await rig();
    await seedSlot(r.ccrcDir, 'a', { teams: [...WS.a.teams, { id: 'aaaaaaaa-2222-4000-8000-00000000000a', key: 'CCC', name: 'Team C' }] });
    r.dir.entries = { ...DIRECTORY, states: [...DIRECTORY.states, ...DIRECTORY.states.map((x, i) => ({ ...x, id: U(60 + i), teamKey: 'CCC' }))] };
    r.db.prepare('INSERT INTO project_linking (project, teamKey, override) VALUES (?, ?, ?)').run('project-c', 'CCC', 'private');
    applyPlanChanges(r.db, SLUG, changes({ tickets: { insert: [tk('t2', { project: 'project-c' })], update: [], drop: [] } }), OWNER, T, null);
    await r.sync.tick(afterDebounce(r));
    const create = r.asks.find((a) => a.op === 'projectCreate')!;
    expect(create.teamKey).toBe('AAA');
    expect(create.teamKeys).toEqual(['AAA', 'CCC']);
    applyPlanChanges(r.db, SLUG, changes({ epics: { insert: [], update: [{ id: r.plan.planOf(SLUG).epics[0]!.id, title: 'Renamed epic' }], drop: [] } }), OWNER, r.t.now, null);
    await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS + 1);
    expect(r.asks.find((a) => a.op === 'projectUpdate')!.teamKeys).toEqual(['AAA', 'CCC']);
    expect(r.asks.filter((a) => a.op !== 'projectCreate' && a.op !== 'projectUpdate').every((a) => a.teamKeys === undefined)).toBe(true);   // absent on every other write
  });
});

describe('review 2918 F5 (2): the pass hands its snapshot the tickets put back (wave 3 F3/F5, carried to wave 7)', () => {
  it("a bound ticket put back keeps its team on its epic's project through the sync's own pass", async () => {
    const r = await rig();
    await seedSlot(r.ccrcDir, 'a', { teams: [...WS.a.teams, { id: 'aaaaaaaa-2222-4000-8000-00000000000a', key: 'CCC', name: 'Team C' }] });
    r.dir.entries = { ...DIRECTORY, states: [...DIRECTORY.states, ...DIRECTORY.states.map((x, i) => ({ ...x, id: U(60 + i), teamKey: 'CCC' }))] };
    r.db.prepare('INSERT INTO project_linking (project, teamKey, override) VALUES (?, ?, ?)').run('project-c', 'CCC', 'private');
    applyPlanChanges(r.db, SLUG, changes({ tickets: { insert: [tk('t2', { project: 'project-c' })], update: [], drop: [] } }), OWNER, T, null);
    await r.sync.tick(afterDebounce(r));
    const t2 = r.plan.planOf(SLUG).epics[0]!.tickets.find((t) => t.key === 't2')!;
    expect(r.plan.bindingOf('ticket', t2.id, WS.a.id)?.state).toBe('bound');
    // put back, its binding kept (the issue still sits in team CCC): the project keeps CCC
    r.db.prepare('UPDATE plan_tickets SET putBackAt = ? WHERE id = ?').run(r.t.now, t2.id);
    applyPlanChanges(r.db, SLUG, changes({ epics: { insert: [], update: [{ id: r.plan.planOf(SLUG).epics[0]!.id, title: 'Renamed epic' }], drop: [] } }), OWNER, r.t.now, null);
    await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS + 1);
    expect(r.asks.filter((a) => a.op === 'projectUpdate').map((a) => a.teamKeys)).toEqual([['AAA', 'CCC']]);
  });
});

describe('a failed binding is not terminal', () => {
  it('returns to pending when a plan put changes its inputs', async () => {
    const r = await rig({ mode: 'public', epicTitle: 'Fix AAA-123 now' });
    await r.sync.tick(afterDebounce(r));
    expect(bindingOfKind(r, 'epic')?.state).toBe('failed');
    applyPlanChanges(r.db, SLUG, changes({ epics: { insert: [], update: [{ id: r.plan.planOf(SLUG).epics[0]!.id, title: 'A fine title' }], drop: [] } }), OWNER, r.t.now, null);
    await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS + 1);
    expect(bindingOfKind(r, 'epic')).toMatchObject({ state: 'bound' });
  });

  it('A6: a binding first made by a skip, created on its requeue, records its team key (§5.5)', async () => {
    const r = await rig({ mode: 'public' });
    const t1 = r.plan.planOf(SLUG).epics[0]!.tickets[0]!;
    r.db.prepare("UPDATE plan_tickets SET title = 'Fix AAA-123 now' WHERE id = ?").run(t1.id);
    await r.sync.tick(afterDebounce(r));
    expect(bindingOfKind(r, 'ticket')).toMatchObject({ state: 'failed', failedWord: 'text-public', teamKey: null });
    applyPlanChanges(r.db, SLUG, changes({ tickets: { insert: [], update: [{ id: t1.id, title: 'A fine title' }], drop: [] } }), OWNER, r.t.now, null);
    await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS + 1);
    expect(bindingOfKind(r, 'ticket')).toMatchObject({ state: 'bound', teamKey: 'AAA' });
  });

  it('returns to pending when the directory refresh adds the status type', async () => {
    const r = await rig({ directory: { ...DIRECTORY, projectStatuses: [] } });
    await r.sync.tick(afterDebounce(r));
    expect(bindingOfKind(r, 'epic')?.state).toBe('failed');
    r.dir.entries = DIRECTORY;
    r.dir.filledAt = r.t.now + 1000;                      // refreshed after the failure
    r.t.now += 2000;
    await r.sync.tick(r.t.now);
    await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS + 1);
    expect(bindingOfKind(r, 'epic')?.state).toBe('bound');
  });

  it('retried after the ceiling and refused again mails nothing more', async () => {
    const r = await rig();
    r.respond.current = (ask) => (ask.op === 'projectCreate' ? fail('linear-forbidden') : defaultRespond(ask, 0));
    await r.sync.tick(afterDebounce(r));
    expect(mails(r)).toHaveLength(1);
    r.dir.filledAt = T - 1000;
    r.t.now += PLAN_SYNC_BACKOFF_MS[PLAN_SYNC_BACKOFF_MS.length - 1] + 1000;
    await r.sync.tick(r.t.now);
    await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS + 1);
    expect(r.asks.filter((a) => a.op === 'projectCreate')).toHaveLength(2);   // it was retried
    expect(bindingOfKind(r, 'epic')?.state).toBe('failed');
    expect(mails(r)).toHaveLength(1);
  });

  it('plan show names a failed binding and its word', async () => {
    const r = await rig();
    r.respond.current = (ask) => (ask.op === 'projectCreate' ? fail('linear-forbidden') : defaultRespond(ask, 0));
    await r.sync.tick(afterDebounce(r));
    const view = planViewOf(r.plan.planOf(SLUG), r.coord.goalsFor(SLUG).doneWhen ?? [], r.plan.bindingsOf(SLUG));
    expect(view.epics[0]).toMatchObject({ sync: 'failed', syncWord: 'linear-forbidden' });
  });
});

describe('the pass around the edges', () => {
  it('waits for a directory not yet filled: no call, the miss asked, the programme deferred', async () => {
    const r = await rig({ directory: null });
    await r.sync.tick(afterDebounce(r));
    expect(r.asks).toHaveLength(0);
    expect(r.misses).toHaveLength(1);
    expect(dueAt(r)).toBeGreaterThan(r.t.now);
    expect(bindingsOf(r).every((b) => b.state !== 'failed')).toBe(true);
  });

  it('D-8701: project statuses never read are a directory miss: the refill is asked, the programme waits, no epic is failed status-missing', async () => {
    const r = await rig({ directory: { ...DIRECTORY, projectStatuses: [] } });
    r.dir.statuses = 'unread';
    await r.sync.tick(afterDebounce(r));
    expect(r.asks).toHaveLength(0);
    expect(r.misses).toHaveLength(1);
    expect(dueAt(r)).toBeGreaterThan(r.t.now);
    expect(bindingsOf(r).filter((b) => b.state === 'failed')).toEqual([]);
    expect(mails(r)).toEqual([]);
    r.dir.entries = DIRECTORY;                             // the refill read them
    r.dir.statuses = 'read';
    r.t.now = dueAt(r)! + PLAN_SYNC_DEBOUNCE_MS;
    await r.sync.tick(r.t.now);
    expect(bindingOfKind(r, 'epic')?.state).toBe('bound');
  });

  it('a probe answering unknown defers the initiative step: the rest is sent, the refill is asked and the programme stays due', async () => {
    const r = await rig({ directory: { ...DIRECTORY, initiatives: 'unknown' } });
    await r.sync.tick(afterDebounce(r));
    expect(opsOf(r)).toEqual(['projectCreate', 'projectMilestoneCreate', 'issueCreate']);
    expect(r.misses.length).toBeGreaterThan(0);
    expect(dueAt(r)).toBeGreaterThan(r.t.now);                    // not settled without its initiative
    r.dir.entries = DIRECTORY;                                      // the refill's probe answered on
    r.t.now = dueAt(r)! + PLAN_SYNC_DEBOUNCE_MS;
    await r.sync.tick(r.t.now);
    expect(opsOf(r).slice(3)).toEqual(['initiativeCreate', 'initiativeToProjectCreate']);
    expect(dueAt(r)).toBeNull();
  });

  it('F5: the snapshot leaves out every record whose putBackAt is set: no step for a put-back checkpoint, ticket or epic', async () => {
    const r = await rig();
    const e1 = r.plan.planOf(SLUG).epics[0]!;
    r.db.prepare('UPDATE plan_checkpoints SET putBackAt = ? WHERE id = ?').run(T, e1.checkpoints[0]!.id);
    r.db.prepare('UPDATE plan_tickets SET putBackAt = ? WHERE id = ?').run(T, e1.tickets[0]!.id);
    await r.sync.tick(afterDebounce(r));
    expect(opsOf(r)).toEqual(['initiativeCreate', 'projectCreate', 'initiativeToProjectCreate']);
    const r2 = await rig();
    r2.db.prepare('UPDATE plan_epics SET putBackAt = ? WHERE id = ?').run(T, r2.plan.planOf(SLUG).epics[0]!.id);
    await r2.sync.tick(afterDebounce(r2));
    expect(r2.asks).toEqual([]);
    expect(dueAt(r2)).toBeNull();
  });

  it('an upkeep key clears its due row and answers done, sending nothing (C9)', async () => {
    const r = await rig();
    markSyncDue(r.db, 'upkeep:project-a', T);
    expect(await r.sync.passFor('upkeep:project-a', T + 60_000)).toBe('done');
    expect(r.asks).toHaveLength(0);
    expect(r.db.prepare("SELECT 1 FROM plan_sync_due WHERE program = 'upkeep:project-a'").get()).toBeUndefined();
  });

  it('withFlight runs after the pass in flight, and restore updates the binding fingerprint', async () => {
    const r = await rig();
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => { release = res; });
    r.respond.current = async (ask) => { if (ask.op === 'initiativeCreate') await gate; return defaultRespond(ask, 0); };
    const pass = r.sync.passFor(SLUG, r.t.now + 60_000);
    for (let i = 0; i < 300 && !opsOf(r).includes('initiativeCreate'); i += 1) await new Promise((res) => setTimeout(res, 10));
    const order: string[] = [];
    const flown = r.sync.withFlight(SLUG, async () => { order.push('flight'); });
    await new Promise((res) => setTimeout(res, 10));
    expect(order).toEqual([]);
    release();
    await pass;
    await flown;
    expect(order).toEqual(['flight']);
    expect(bindingOfKind(r, 'epic')?.state).toBe('bound');
  });
});

describe('end to end through runCcrcOp, Linear faked at FetchLike (recorded answers)', () => {
  const D = LINEAR_HIERARCHY_DOCUMENTS;
  const ANSWERS = new Map<string, string>([
    [D.initiativeCreate, 'mutation-initiative-create'], [D.projectCreate, 'mutation-project-create'],
    [D.projectMilestoneCreate, 'mutation-project-milestone-create'], [LINEAR_DOCUMENTS.create, 'mutation-issue-create'],
    [D.initiativeToProjectCreate, 'mutation-initiative-to-project-create'], [D.initiativeById, 'read-initiative-by-id'],
  ]);
  async function e2e(override: (doc: string) => string | undefined = () => undefined) {
    const r = await rig();
    const fx = linearServicesFake({ clock: () => r.t.now, db: r.db });
    const docs: string[] = [];
    const fetch: FetchLike = async (_u, init) => {
      const q = (JSON.parse(init.body) as { query: string }).query;
      docs.push(q);
      const name = override(q) ?? ANSWERS.get(q);
      if (name === undefined) throw new Error('no recorded answer for this document');
      return recordedAnswer(name);
    };
    const sync = r.build({ call: (ask) => runCcrcOp({ ccrcDir: r.ccrcDir, rate: fx.rate, journal: fx.journal, policy: fx.policy, fetch, now: () => r.t.now }, ask) });
    return { r, sync, docs };
  }

  it('the happy path binds each object to the id Linear recorded', async () => {
    const { r, sync, docs } = await e2e();
    await sync.tick(afterDebounce(r));
    expect(docs.filter((d) => d === D.initiativeCreate)).toHaveLength(1);
    expect(bindingsOf(r).map((b) => b.state)).toEqual(['bound', 'bound', 'bound', 'bound']);
    const created = (n: string) => (linearRecord(n).body as { data: Record<string, { initiative?: { id: string } }> }).data;
    expect(bindingOfKind(r, 'programme')?.linearId).toBe(created('mutation-initiative-create')['initiativeCreate']!.initiative!.id);
    expect(bindingOfKind(r, 'ticket')?.identifier).toMatch(/^[A-Za-z]+-\d+$/);
    expect(dueAt(r)).toBeNull();
  });

  it('conflict on insert reads the object by name and binds the one at the requestId made by this key', async () => {
    const r = await rig();
    const fx = linearServicesFake({ clock: () => r.t.now, db: r.db });
    let requestId = '';
    const docs: string[] = [];
    const fetch: FetchLike = async (_u, init) => {
      const b = JSON.parse(init.body) as { query: string; variables?: { input?: { id?: string } } };
      docs.push(b.query);
      if (b.query === D.initiativeCreate) { requestId = b.variables?.input?.id ?? ''; return recordedAnswer('mutation-initiative-create-same-id'); }
      if (b.query === D.initiativeById) {
        return linearAnswer({ ok: true, status: 200, json: async () => ({ data: { initiative: { id: requestId, name: 'Programme A', description: null, status: 'Planned', updatedAt: '2026-01-01T00:00:00.000Z', projects: { nodes: [] } } } }) });
      }
      if (b.query === D.initiativesByName) {
        return linearAnswer({ ok: true, status: 200, json: async () => ({ data: { initiatives: { nodes: [{ id: requestId, name: 'Programme A', createdAt: '2026-01-01T00:00:00.000Z', creator: { id: VIEWER } }] } } }) });
      }
      const name = ANSWERS.get(b.query);
      if (name === undefined) throw new Error('no recorded answer for this document');
      return recordedAnswer(name);
    };
    const sync = r.build({ call: (ask) => runCcrcOp({ ccrcDir: r.ccrcDir, rate: fx.rate, journal: fx.journal, policy: fx.policy, fetch, now: () => r.t.now }, ask) });
    await sync.tick(afterDebounce(r));
    expect(docs.filter((d) => d === D.initiativeCreate)).toHaveLength(1);
    expect(bindingOfKind(r, 'programme')).toMatchObject({ state: 'bound', linearId: requestId });
  });

  // D-9132: CONSTRUCTED, not recorded (no live answer of this kind was recorded): an errors body whose code no row of the closed
  // table knows. runCcrcOp answers it `unreachable` with `outsideTable`, and the plan sync must not hold on it for ever.
  it("D-9132: an initiative create refused with an error outside the closed table every time: its binding fails malformed, mailed once, and the other objects are written", async () => {
    const r = await rig();
    const fx = linearServicesFake({ clock: () => r.t.now, db: r.db });
    let sentInitiative = 0;
    const fetch: FetchLike = async (_u, init) => {
      const q = (JSON.parse(init.body) as { query: string }).query;
      if (q === D.initiativeCreate) {
        sentInitiative += 1;
        return linearAnswer({ ok: true, status: 200, json: async () => ({ data: null, errors: [{ message: 'something new', extensions: { code: 'SOMETHING_NEW' } }] }) });
      }
      const name = ANSWERS.get(q);
      if (name === undefined) throw new Error('no recorded answer for this document');
      return recordedAnswer(name);
    };
    const sync = r.build({ call: (ask) => runCcrcOp({ ccrcDir: r.ccrcDir, rate: fx.rate, journal: fx.journal, policy: fx.policy, fetch, now: () => r.t.now }, ask) });
    for (let i = 0; i < PLAN_SYNC_BACKOFF_MS.length + 3; i += 1) {
      await sync.passFor(SLUG, r.t.now + 60_000);
      r.db.prepare('UPDATE plan_sync_due SET dueAt = 0').run();
      r.t.now += PLAN_SYNC_BACKOFF_MS[PLAN_SYNC_BACKOFF_MS.length - 1]! + 1;   // past the workspace's hold
    }
    expect(sentInitiative).toBeGreaterThan(0);
    expect(bindingOfKind(r, 'programme')).toMatchObject({ state: 'failed', failedWord: 'malformed' });
    expect(mails(r).filter((m) => m.subject.includes('malformed'))).toHaveLength(1);
    for (const kind of ['epic', 'checkpoint', 'ticket']) expect(bindingOfKind(r, kind)?.state, kind).toBe('bound');
  });
});

describe('final-review fixes (D-8182)', () => {
  const LAST = PLAN_SYNC_BACKOFF_MS[PLAN_SYNC_BACKOFF_MS.length - 1];
  const conflict: CcrcOpOutcome = { ok: false, word: 'linear-invalid', maybeSent: false, detail: 'conflict' };

  it("C-2 (C2'): after prog-a's rate-limited project create, prog-a never adopts prog-b's same-titled project", async () => {
    const r = await rig();
    applyPlanChanges(r.db, 'prog-b', changes({ epics: { insert: [{ key: 'e1', project: 'project-a', waves: [1], ordinal: 0, title: 'Epic one', summary: 'Summary' }], update: [], drop: [] } }),
      'coord-b', T, { home: 'project-a', title: 'Programme B' });
    const linear: { id: string; name: string; createdAt: string; creatorId: string; teamKeys: string[] }[] = [];
    let limited = false;
    r.respond.current = (ask) => {
      if (ask.op === 'projectCreate') {
        if (!limited) { limited = true; return { ok: false, word: 'rate-limited', retryAfterS: 1 }; }   // refused locally: never sent
        const id = String(ask.input['requestId']);
        linear.push({ id, name: String(ask.input['name']), createdAt: '2026-01-01T00:00:00.000Z', creatorId: VIEWER, teamKeys: ['AAA'] });
        return ok({ id }, id);
      }
      if (ask.op === 'projectsByName') return ok({ nodes: linear.filter((n) => n.name === ask.input['name']) });
      return defaultRespond(ask, 0);
    };
    await r.sync.passFor(SLUG, r.t.now + 60_000);
    expect(bindingOfKind(r, 'epic')).toMatchObject({ state: 'pending', linearId: null });
    await r.sync.passFor('prog-b', r.t.now + 60_000);
    const bProject = r.plan.bindingsOf('prog-b').find((b) => b.localKind === 'epic')!;
    expect(bProject.state).toBe('bound');
    r.t.now += 60_000;                                                    // past prog-a's workspace hold (D-8183)
    await r.sync.passFor(SLUG, r.t.now + 60_000);
    const aProject = bindingOfKind(r, 'epic')!;
    expect(aProject.state).toBe('bound');
    expect(aProject.linearId).not.toBe(bProject.linearId);
    expect(aProject.linearId).toBe(requestIdOf('epic', r.plan.planOf(SLUG).epics[0]!.id, WS.a.id));
    expect(linear).toHaveLength(2);                                       // each programme its own project
  });

  it("I-1 (C2'): an object at the requestId made by another creator is never adopted: send, conflict, failed, also after a requeue", async () => {
    const r = await rig();
    const rowid = r.plan.programmeRowId(SLUG)!;
    r.plan.ensurePending('programme', rowid, WS.a.id, null);
    const rid = requestIdOf('programme', rowid, WS.a.id);
    const foreign = { id: rid, name: 'Programme A', createdAt: '2026-01-01T00:00:00.000Z', creatorId: U(901) };
    r.respond.current = (ask) => {
      if (ask.op === 'initiativesByName') return ok({ nodes: [foreign] });
      if (ask.op === 'initiativeCreate') return conflict;
      if (ask.op === 'initiativeById') return ok({ initiative: { id: rid, name: 'Programme A' } });
      return defaultRespond(ask, 0);
    };
    await r.sync.tick(afterDebounce(r));
    expect(opsOf(r).slice(0, 4)).toEqual(['initiativesByName', 'initiativeCreate', 'initiativeById', 'initiativesByName']);
    expect(bindingOfKind(r, 'programme')).toMatchObject({ state: 'failed', failedWord: 'linear-invalid', linearId: null });
    r.asks.length = 0;
    r.t.now += LAST + 1_000;                                              // C10: the 30 min requeue
    await r.sync.tick(r.t.now);
    expect(opsOf(r).slice(0, 4)).toEqual(['initiativesByName', 'initiativeCreate', 'initiativeById', 'initiativesByName']);
    expect(bindingOfKind(r, 'programme')).toMatchObject({ state: 'failed', failedWord: 'linear-invalid', linearId: null });
    expect(opsOf(r)).not.toContain('initiativeUpdate');                   // nothing of ccrc's plan written into it
    expect(mails(r).filter((m) => m.subject.includes('programme'))).toHaveLength(1);
  });

  it('F4 measured (D-8699 stays a follow-up): an own object off the by-name first page fails the binding and mails once per binding and word, not once per requeue', async () => {
    const r = await rig();
    const rowid = r.plan.programmeRowId(SLUG)!;
    const rid = requestIdOf('programme', rowid, WS.a.id);
    // ten same-named initiatives made by this key, none at ccrc's id: its own fell off the first page of the listing
    const page = Array.from({ length: 10 }, (_, i) => ({ id: U(950 + i), name: 'Programme A', createdAt: '2026-01-01T00:00:00.000Z', creatorId: VIEWER }));
    r.respond.current = (ask) => {
      if (ask.op === 'initiativesByName') return ok({ nodes: page });
      if (ask.op === 'initiativeCreate') return conflict;
      if (ask.op === 'initiativeById') return ok({ initiative: { id: rid, name: 'Programme A' } });
      return defaultRespond(ask, 0);
    };
    const programmeMails = () => mails(r).filter((m) => m.subject.includes('programme'));
    await r.sync.tick(afterDebounce(r));
    expect(bindingOfKind(r, 'programme')).toMatchObject({ state: 'failed', failedWord: 'linear-invalid' });
    expect(programmeMails()).toHaveLength(1);
    r.t.now += LAST + 1_000; await r.sync.tick(r.t.now);              // the time requeue
    r.dir.filledAt = r.t.now + 1; r.t.now += 2_000; await r.sync.tick(r.t.now);   // a directory refill
    await r.sync.tick(r.t.now + PLAN_SYNC_DEBOUNCE_MS + 1);
    r.db.prepare('UPDATE programs SET title = ? WHERE slug = ?').run('Programme A renamed', SLUG);   // the inputs trigger
    r.plan.markSyncDue(SLUG, r.t.now); r.t.now += PLAN_SYNC_DEBOUNCE_MS + 1; await r.sync.tick(r.t.now);
    expect(r.asks.filter((a) => a.op === 'initiativeCreate').length).toBeGreaterThanOrEqual(3);    // it was retried each time
    expect(bindingOfKind(r, 'programme')).toMatchObject({ state: 'failed', failedWord: 'linear-invalid' });
    expect(programmeMails()).toHaveLength(1);
  });

  it("I-2 (C17): a bound project's refused update, requeued, sends one projectUpdate and no create", async () => {
    const r = await rig();
    await r.sync.tick(afterDebounce(r));
    const before = bindingOfKind(r, 'epic')!;
    applyPlanChanges(r.db, SLUG, changes({ epics: { insert: [], update: [{ id: r.plan.planOf(SLUG).epics[0]!.id, title: 'Renamed epic' }], drop: [] } }), OWNER, r.t.now, null);
    r.respond.current = (ask) => (ask.op === 'projectUpdate' ? fail('linear-forbidden') : defaultRespond(ask, 0));
    r.t.now += PLAN_SYNC_DEBOUNCE_MS + 1;
    await r.sync.tick(r.t.now);
    expect(bindingOfKind(r, 'epic')).toMatchObject({ state: 'failed', failedWord: 'linear-forbidden' });
    r.asks.length = 0;
    r.respond.current = defaultRespond;
    r.t.now += LAST + 1_000;
    await r.sync.tick(r.t.now);
    expect(opsOf(r).filter((o) => o === 'projectUpdate')).toHaveLength(1);
    expect(opsOf(r)).not.toContain('projectCreate');
    expect(opsOf(r)).not.toContain('projectsByName');
    expect(bindingOfKind(r, 'epic')).toMatchObject({ state: 'bound', linearId: before.linearId });
  });

  it('I-3 (C18): an unreadable Linear store defers the pass with the backoff and keeps the due row', async () => {
    const r = await rig();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unreadable = r.build({ readLinearStore: async () => ({ kind: 'unreadable', code: 'unreadable' }) });
    await unreadable.tick(afterDebounce(r));
    expect(r.asks).toHaveLength(0);
    expect(dueAt(r)).toBe(r.t.now + PLAN_SYNC_BACKOFF_MS[0]);
    r.db.prepare('UPDATE plan_sync_due SET dueAt = 0').run();
    const throwing = r.build({ readLinearStore: async () => { throw new Error('the store cannot be read'); } });
    await throwing.tick(r.t.now);
    expect(r.asks).toHaveLength(0);
    expect(dueAt(r)).toBe(r.t.now + PLAN_SYNC_BACKOFF_MS[0]);
    expect(bindingsOf(r)).toEqual([]);
  });
});
