// D-8182 (Linear hierarchy plan, Task 3.4; design §5.6): the dispatch waits for its ticket's issue, the issue's identifier
// names the workspace in a private project, and the sync links the pull request in the other cases. A real coord.db and
// Linear store on a tmp dir; Linear is faked at the sync's `call` port. Neutral names only: AAA, project-a, owner/repo.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { CoordStore } from '../src/coord/store.js';
import { NO_PLAN_CHANGES, applyPlanChanges, planStorePort, type PlanChanges, type PlanStorePort } from '../src/coord/planStore.js';
import type { CcrcOpAsk, CcrcOpOutcome } from '../src/linear/ccrcCall.js';
import type { LinearDirectoryEntries } from '../src/linear/ops.js';
import { PLAN_SYNC_DEBOUNCE_MS, PLAN_SYNC_DISPATCH_WAIT_MS, PlanSync } from '../src/linear/planSync.js';
import { readLinearStore } from '../src/linear/store.js';
import { memCoordDb } from './linearServicesFake.js';
import { seedSlot, WS } from './linearProxyRig.js';
import { mkTmp } from './tmpHelpers.js';

const T = 1_800_000_000_000;
const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SLUG = 'prog-a';
const OWNER = 'coord-a';
const DIR: LinearDirectoryEntries = {
  viewerId: U(900), labels: [], projects: [], users: [], initiatives: 'on',
  states: [
    { id: U(21), name: 'Todo', type: 'unstarted', teamKey: 'AAA' }, { id: U(22), name: 'Doing', type: 'started', teamKey: 'AAA' },
    { id: U(23), name: 'Done', type: 'completed', teamKey: 'AAA' }, { id: U(24), name: 'Nope', type: 'canceled', teamKey: 'AAA' },
  ],
  projectStatuses: [{ id: U(31), name: 'P', type: 'planned' }, { id: U(32), name: 'S', type: 'started' },
    { id: U(33), name: 'C', type: 'completed' }, { id: U(34), name: 'X', type: 'canceled' }],
};
const ok = (value: Record<string, unknown> = {}, created: string | null = null): CcrcOpOutcome => ({ ok: true, value, created });

interface Rig {
  db: DatabaseSync; coord: CoordStore; plan: PlanStorePort; t: { now: number }; asks: CcrcOpAsk[];
  respond: { current: (ask: CcrcOpAsk) => CcrcOpOutcome | Promise<CcrcOpOutcome> };
  prs: Map<number, { number: number; branch: string | null }>; sync: PlanSync; runs: number[]; epicId: number;
}
let dirs: string[] = [];
let counter = 100;
async function rig(o: { mode?: 'private' | 'public'; runs?: number } = {}): Promise<Rig> {
  const dir = mkTmp('ccrc-plan-dwait-');
  dirs.push(dir);
  const ccrcDir = path.join(dir, '.ccrc');
  await seedSlot(ccrcDir, 'a');
  const db = memCoordDb();
  const coord = new CoordStore(db);
  db.prepare("INSERT INTO project_linking (project, teamKey, override, visibility, slug, template, measuredAt) VALUES ('project-a', 'AAA', ?, ?, 'owner/repo', 'absent', ?)")
    .run(o.mode ?? 'private', o.mode === 'public' ? 'public' : 'private', T);
  applyPlanChanges(db, SLUG, { ...NO_PLAN_CHANGES(), epics: { insert: [{ key: 'e1', project: 'project-a', waves: [1, 2, 3], ordinal: 0, title: 'Epic one', summary: 'Summary' }], update: [], drop: [] } } as PlanChanges,
    OWNER, T, { home: 'project-a', title: 'Programme A' });
  const plan = planStorePort(db);
  const epicId = plan.planOf(SLUG).epics[0]!.id;
  const r = { db, coord, plan, t: { now: T }, asks: [] as CcrcOpAsk[], prs: new Map(), runs: [] as number[], epicId, respond: { current: (ask: CcrcOpAsk): CcrcOpOutcome => {
    if (ask.op.endsWith('Create')) { const id = U(counter++); return ok(ask.op === 'issueCreate' ? { id, identifier: `AAA-${counter}` } : { id }, id); }
    if (ask.op.endsWith('Update') || ask.op === 'issueLink') return ok({ id: ask.target });
    if (ask.op === 'initiativesByName' || ask.op === 'projectsByName') return ok({ nodes: [] });
    return { ok: false, word: 'not-found', maybeSent: false };
  } } } as Rig;
  r.sync = new PlanSync({
    coord, plan, ccrcDir, readLinearStore: () => readLinearStore(ccrcDir),
    call: async (ask) => { r.asks.push(ask); return r.respond.current(ask); },
    directory: { get: () => DIR, filledAt: () => T - 1000 },
    directoryMiss: () => undefined, markSlotRejected: async () => undefined,
    now: () => r.t.now, privateTrackerKeys: [], prOfRun: (id) => r.prs.get(id) ?? null,
  });
  for (let w = 1; w <= (o.runs ?? 1); w++) {
    const res = coord.openRun({ program: SLUG, title: `Wave ${w}`, project: 'project-a', wave: w, waveOf: 3, claimedBy: OWNER, homeProject: 'project-a',
      ticket: { kind: 'new', epicId, project: 'project-a', title: `Wave ${w}` } });
    if ('refused' in res) throw new Error(`open refused ${String(res.refused)}`);
    r.runs.push((res as { id: number }).id);
  }
  return r;
}
afterEach(() => { vi.useRealTimers(); for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* the reaper */ } } dirs = []; });

const ops = (r: Rig): string[] => r.asks.map((a) => a.op);
async function tick(r: Rig): Promise<void> { r.t.now += PLAN_SYNC_DEBOUNCE_MS + 1_000; r.plan.markSyncDue(SLUG, r.t.now - PLAN_SYNC_DEBOUNCE_MS - 1); await r.sync.tick(r.t.now); }
const links = (r: Rig): CcrcOpAsk[] => r.asks.filter((a) => a.op === 'issueLink');
const ticketBinding = (r: Rig) => r.plan.bindingsOf(SLUG).find((b) => b.localKind === 'ticket');

describe('the dispatch wait (D-8182, §5.6)', () => {
  it('a bound ticket in a private project names the workspace key-123-…', async () => {
    const r = await rig();
    const slug = await r.sync.dispatchSlug(r.runs[0]!, undefined);
    expect(slug).toMatch(/^aaa-\d+-wave-1$/);
    expect(ticketBinding(r)).toMatchObject({ state: 'bound', identifier: expect.stringMatching(/^AAA-\d+$/) });
    expect(ops(r)).toContain('issueCreate');
  });

  it('a given slug is kept after the identifier, and a non-string slug is left to the dispatch', async () => {
    const r = await rig({ runs: 2 });
    expect(await r.sync.dispatchSlug(r.runs[0]!, 'custom')).toMatch(/^aaa-\d+-custom$/);
    expect(await r.sync.dispatchSlug(r.runs[1]!, 42)).toBeUndefined();
  });

  it('a public project\'s slug never carries the identifier, and the sync links the PR', async () => {
    const r = await rig({ mode: 'public' });
    expect(await r.sync.dispatchSlug(r.runs[0]!, undefined)).toBeUndefined();
    expect(r.asks).toHaveLength(0);                                      // no wait, no call
    await tick(r);
    expect(ticketBinding(r)).toMatchObject({ state: 'bound' });
    expect(links(r)).toHaveLength(0);                                    // no PR yet
    r.prs.set(r.runs[0]!, { number: 7, branch: 'ws/wave-1' });
    await tick(r);
    expect(links(r)).toHaveLength(1);
    expect(links(r)[0]).toMatchObject({ op: 'issueLink', fields: ['url', 'title'], input: { url: 'https://github.com/owner/repo/pull/7', title: 'PR #7' } });
    expect(links(r)[0]!.target).toBe(ticketBinding(r)!.identifier);
    await tick(r); await tick(r);
    expect(links(r)).toHaveLength(1);                                    // sent once
  });

  it('a link answered conflict counts as made, and is not sent again', async () => {
    const r = await rig({ mode: 'public' });
    await tick(r);
    r.prs.set(r.runs[0]!, { number: 7, branch: null });
    const base = r.respond.current;
    r.respond.current = (ask) => (ask.op === 'issueLink' ? { ok: false, word: 'linear-invalid', maybeSent: false, detail: 'conflict' } : base(ask));
    await tick(r); await tick(r);
    expect(links(r)).toHaveLength(1);
  });

  it('a resumed work run in a private project with a bound ticket dispatches with no slug and gets the attachment link', async () => {
    const r = await rig();
    r.db.prepare("UPDATE runs SET sessionId = 'sess-a' WHERE id = ?").run(r.runs[0]!);
    expect(await r.sync.dispatchSlug(r.runs[0]!, undefined)).toBeUndefined();
    expect(r.asks).toHaveLength(0);
    await tick(r);
    r.prs.set(r.runs[0]!, { number: 9, branch: 'ws/some-earlier-ticket' });
    await tick(r);
    expect(links(r)).toHaveLength(1);
    expect(links(r)[0]!.input['url']).toBe('https://github.com/owner/repo/pull/9');
  });

  it('a branch that carries the identifier is linked by Linear itself: no attachment', async () => {
    const r = await rig();
    const slug = await r.sync.dispatchSlug(r.runs[0]!, undefined);
    r.prs.set(r.runs[0]!, { number: 7, branch: `ws/${slug}` });
    await tick(r); await tick(r);
    expect(links(r)).toHaveLength(0);
  });

  it('a private dispatch that was not bound in time is linked by the sync once the issue appears', async () => {
    const r = await rig();
    r.prs.set(r.runs[0]!, { number: 7, branch: 'ws/wave-1' });
    await tick(r); await tick(r);
    expect(links(r)).toHaveLength(1);
  });

  it('Linear slow: dispatch goes after the budget with today\'s slug', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const r = await rig();
    let release: (o: CcrcOpOutcome) => void = () => undefined;
    r.respond.current = () => new Promise<CcrcOpOutcome>((res) => { release = res; });
    const p = r.sync.dispatchSlug(r.runs[0]!, 'mine');
    let done = false; void p.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(PLAN_SYNC_DISPATCH_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toBeUndefined();
    expect(PLAN_SYNC_DISPATCH_WAIT_MS).toBe(12_000);
    release({ ok: false, word: 'unreachable', maybeSent: false });
    await vi.advanceTimersByTimeAsync(0);
  });

  it('a dispatch during a lane pass joins that pass and sends no create of its own', async () => {
    const r = await rig();
    let open: () => void = () => undefined;
    const gate = new Promise<void>((res) => { open = res; });
    const base = r.respond.current;
    r.respond.current = async (ask) => { if (ask.op === 'initiativeCreate') await gate; return base(ask); };
    const lane = r.sync.passFor(SLUG, T + 60_000);
    await vi.waitFor(() => expect(ops(r)).toEqual(['initiativeCreate']));
    const d = r.sync.dispatchSlug(r.runs[0]!, undefined);
    open();
    expect(await d).toMatch(/^aaa-\d+-wave-1$/);
    await lane;
    expect(ops(r).filter((o) => o === 'initiativeCreate')).toHaveLength(1);
    expect(ops(r).filter((o) => o === 'issueCreate')).toHaveLength(1);
  });

  it('three parallel dispatches of one wave start one pass', async () => {
    const r = await rig({ runs: 3 });
    const slugs = await Promise.all(r.runs.map((id) => r.sync.dispatchSlug(id, undefined)));
    expect(slugs.map((s) => /^aaa-\d+-wave-[123]$/.test(s ?? ''))).toEqual([true, true, true]);
    expect(new Set(slugs).size).toBe(3);
    expect(ops(r).filter((o) => o === 'initiativeCreate')).toHaveLength(1);
    expect(ops(r).filter((o) => o === 'projectCreate')).toHaveLength(1);
    expect(ops(r).filter((o) => o === 'issueCreate')).toHaveLength(3);
  });

  it('an unknown run, or a throw anywhere, answers no slug and never throws', async () => {
    const r = await rig();
    expect(await r.sync.dispatchSlug(99_999, undefined)).toBeUndefined();
    r.respond.current = () => { throw new Error('boom'); };
    expect(await r.sync.dispatchSlug(r.runs[0]!, undefined)).toBeUndefined();
  });

  it('ensureTicketBound answers the binding as it stands on a timeout, and clears its timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const r = await rig();
    r.respond.current = () => new Promise<CcrcOpOutcome>(() => undefined);
    const p = r.sync.ensureTicketBound(r.runs[0]!, 50);
    await vi.advanceTimersByTimeAsync(60);
    expect(await p).toEqual({ identifier: null });
    const r2 = await rig();
    expect(await r2.sync.ensureTicketBound(r2.runs[0]!, 50)).toEqual({ identifier: expect.stringMatching(/^AAA-\d+$/) });
    expect(vi.getTimerCount()).toBe(0);        // neither call left its timer behind
  });
});
