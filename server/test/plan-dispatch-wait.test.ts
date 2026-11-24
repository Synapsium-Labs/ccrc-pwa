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
import { PLAN_SYNC_BACKOFF_MS, PLAN_SYNC_DEBOUNCE_MS, PLAN_SYNC_DISPATCH_WAIT_MS, PlanSync, prOfRunFrom } from '../src/linear/planSync.js';
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
  prs: Map<number, { number: number; branch: string | null }>; sync: PlanSync; runs: number[]; epicId: number; ccrcDir: string;
}
let dirs: string[] = [];
let counter = 100;
async function rig(o: { mode?: 'private' | 'public'; runs?: number; noSlot?: boolean; noDirectory?: boolean; fleet?: () => never[] | unknown[] } = {}): Promise<Rig> {
  const dir = mkTmp('ccrc-plan-dwait-');
  dirs.push(dir);
  const ccrcDir = path.join(dir, '.ccrc');
  if (o.noSlot !== true) await seedSlot(ccrcDir, 'a');
  const db = memCoordDb();
  const coord = new CoordStore(db);
  db.prepare("INSERT INTO project_linking (project, teamKey, override, visibility, slug, template, measuredAt) VALUES ('project-a', 'AAA', ?, ?, 'owner/repo', 'absent', ?)")
    .run(o.mode ?? 'private', o.mode === 'public' ? 'public' : 'private', T);
  applyPlanChanges(db, SLUG, { ...NO_PLAN_CHANGES(), epics: { insert: [{ key: 'e1', project: 'project-a', waves: [1, 2, 3], ordinal: 0, title: 'Epic one', summary: 'Summary' }], update: [], drop: [] } } as PlanChanges,
    OWNER, T, { home: 'project-a', title: 'Programme A' });
  const plan = planStorePort(db);
  const epicId = plan.planOf(SLUG).epics[0]!.id;
  const r = { db, coord, plan, ccrcDir, t: { now: T }, asks: [] as CcrcOpAsk[], prs: new Map(), runs: [] as number[], epicId, respond: { current: (ask: CcrcOpAsk): CcrcOpOutcome => {
    if (ask.op.endsWith('Create')) { const id = U(counter++); return ok(ask.op === 'issueCreate' ? { id, identifier: `AAA-${counter}` } : { id }, id); }
    if (ask.op.endsWith('Update') || ask.op === 'issueLink') return ok({ id: ask.target });
    if (ask.op === 'initiativesByName' || ask.op === 'projectsByName') return ok({ nodes: [] });
    return { ok: false, word: 'not-found', maybeSent: false };
  } } } as Rig;
  r.sync = new PlanSync({
    coord, plan, ccrcDir, readLinearStore: () => readLinearStore(ccrcDir),
    call: async (ask) => { r.asks.push(ask); return r.respond.current(ask); },
    directory: { get: () => (o.noDirectory === true ? null : DIR), filledAt: () => T - 1000, projectStatusesRead: () => (o.noDirectory === true ? null : 'read') },
    directoryMiss: () => undefined, markSlotRejected: async () => undefined,
    now: () => r.t.now, privateTrackerKeys: [], prOfRun: o.fleet === undefined ? (id) => r.prs.get(id) ?? null : prOfRunFrom(coord, o.fleet as never),
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

  it('D-8183 (round 1 A4): a pass with no PR known sends no update and no second link; a new URL is linked once', async () => {
    const r = await rig({ mode: 'public' });
    await tick(r);
    const updates = (): number => ops(r).filter((o) => o === 'issueUpdate').length;
    r.prs.set(r.runs[0]!, { number: 7, branch: null });
    await tick(r);
    expect(links(r)).toHaveLength(1);
    const n = updates();
    r.prs.delete(r.runs[0]!);                                            // a pass where no PR is known (the fleet listing has moved on)
    await tick(r); await tick(r);
    expect(updates()).toBe(n);                                           // no update
    r.prs.set(r.runs[0]!, { number: 7, branch: null });
    await tick(r); await tick(r);
    expect(links(r)).toHaveLength(1);                                    // and no second link when it is known again
    expect(updates()).toBe(n);
    r.prs.set(r.runs[0]!, { number: 8, branch: null });                  // a new URL is linked once
    await tick(r); await tick(r);
    expect(links(r).map((a) => a.input['url'])).toEqual(['https://github.com/owner/repo/pull/7', 'https://github.com/owner/repo/pull/8']);
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

  it('a session PR is the run\'s only when its branch is the run\'s own branch (no lineage yet)', async () => {
    let fleet: unknown[] = [];
    const r = await rig({ mode: 'public', fleet: () => fleet });
    r.db.prepare("UPDATE runs SET sessionId = 'sess-a', branch = 'ws/mine' WHERE id = ?").run(r.runs[0]!);
    await tick(r);
    fleet = [{ id: 'sess-a', branch: 'ws/earlier-wave', pr: { number: 3 } }];
    await tick(r); await tick(r);
    expect(links(r)).toHaveLength(0);                                   // another branch's PR: no link, and nothing recorded
    fleet = [{ id: 'sess-a', branch: 'ws/mine', pr: { number: 4 } }];
    await tick(r);
    expect(links(r)).toHaveLength(1);
    expect(links(r)[0]!.input['url']).toBe('https://github.com/owner/repo/pull/4');
    fleet = [{ id: 'sess-a', branch: null, pr: { number: 5 } }];       // an unreadable branch is no PR either
    const r2 = await rig({ mode: 'public', fleet: () => fleet });
    r2.db.prepare("UPDATE runs SET sessionId = 'sess-a', branch = 'ws/mine' WHERE id = ?").run(r2.runs[0]!);
    await tick(r2); await tick(r2);
    expect(links(r2)).toHaveLength(0);
  });

  it('a private project with no usable Linear slot or directory answers at once, not after the budget', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    for (const o of [{ noSlot: true }, { noDirectory: true }]) {
      const r = await rig(o);
      const t0 = Date.now();
      expect(await r.sync.dispatchSlug(r.runs[0]!, undefined)).toBeUndefined();   // no timer advance: it settled by itself
      expect(Date.now() - t0).toBeLessThan(PLAN_SYNC_DISPATCH_WAIT_MS);
      expect(r.asks).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    }
  });
});

describe('final-review fixes (D-8182)', () => {
  const mails = (r: Rig): { subject: string; body: string }[] =>
    r.db.prepare("SELECT subject, body FROM mail WHERE subject LIKE 'Linear sync%' ORDER BY id").all() as { subject: string; body: string }[];

  it('C-1 (C16): a PR link refused policy-denied is given up: one issueLink, no issueCreate, one mail, the issue stays bound, nothing on the next tick', async () => {
    const r = await rig({ mode: 'public' });
    await tick(r);
    const bound = ticketBinding(r)!;
    r.prs.set(r.runs[0]!, { number: 7, branch: null });
    const base = r.respond.current;
    r.respond.current = (ask) => (ask.op === 'issueLink' ? { ok: false, word: 'policy-denied', maybeSent: false } : base(ask));
    const from = r.asks.length;
    await tick(r);
    expect(ops(r).slice(from)).toEqual(['issueLink']);
    expect(ticketBinding(r)).toMatchObject({ state: 'bound', linearId: bound.linearId, identifier: bound.identifier });
    expect(mails(r)).toHaveLength(1);
    expect(mails(r)[0]!.subject).toContain('policy-denied');
    expect(mails(r)[0]!.body).not.toContain('github.com');             // a fixed sentence, never the URL
    const after = r.asks.length;
    await tick(r);
    await tick(r);
    expect(r.asks).toHaveLength(after);                                 // given up: no further call
    expect(mails(r)).toHaveLength(1);
    r.prs.set(r.runs[0]!, { number: 8, branch: null });                 // a new URL is tried again
    await tick(r); await tick(r);
    expect(links(r).map((a) => a.input['url'])).toEqual(['https://github.com/owner/repo/pull/7', 'https://github.com/owner/repo/pull/8']);
    expect(ops(r).filter((o) => o === 'issueCreate')).toHaveLength(1);   // the first tick's, never another
  });

  it('A7/A12: a dispatch while the programme is held by a failure backoff starts no pass and answers at once', async () => {
    const r = await rig();
    r.respond.current = () => ({ ok: false, word: 'unreachable', maybeSent: false });
    await tick(r);
    const held = (r.db.prepare('SELECT dueAt FROM plan_sync_due WHERE program = ?').get(SLUG) as { dueAt: number }).dueAt;
    expect(held).toBeGreaterThan(r.t.now);
    const n = r.asks.length;
    expect(await r.sync.ensureTicketBound(r.runs[0]!, 5_000)).toEqual({ identifier: null });
    expect(await r.sync.dispatchSlug(r.runs[0]!, undefined)).toBeUndefined();
    expect(r.asks).toHaveLength(n);
    expect((r.db.prepare('SELECT dueAt FROM plan_sync_due WHERE program = ?').get(SLUG) as { dueAt: number }).dueAt).toBe(held);
  });

  it('D-8183: a dispatch whose ticket\'s workspace is held starts no pass, though the programme\'s own row is due again', async () => {
    const r = await rig();
    await seedSlot(r.ccrcDir, 'b');
    r.db.prepare("INSERT INTO project_linking (project, teamKey, override) VALUES ('project-b', 'BBB', 'private')").run();
    applyPlanChanges(r.db, SLUG, { ...NO_PLAN_CHANGES(), epics: { insert: [{ key: 'e2', project: 'project-b', waves: [1], ordinal: 1, title: 'Epic two', summary: 'Summary two' }], update: [], drop: [] } } as PlanChanges, OWNER, T, null);
    // workspace a answers rate-limited with a long wait (its hold is long), workspace b unreachable (its hold is the short backoff)
    r.respond.current = (ask) => {
      if (ask.op === 'projectCreate' && ask.workspaceId === WS.a.id) return { ok: false, word: 'rate-limited', retryAfterS: 300 };
      if (ask.op === 'projectCreate') return { ok: false, word: 'unreachable', maybeSent: false };
      if (ask.op.endsWith('Create')) { const id = U(counter++); return ok({ id }, id); }
      return { ok: false, word: 'not-found', maybeSent: false };
    };
    await tick(r);
    const due = (r.db.prepare('SELECT dueAt FROM plan_sync_due WHERE program = ?').get(SLUG) as { dueAt: number }).dueAt;
    expect(due - r.t.now).toBe(PLAN_SYNC_BACKOFF_MS[0]);                 // the earliest hold: workspace b's
    r.t.now = due + 1_000;                                              // b's hold has passed, a's has not
    expect(r.plan.heldSyncUntil(SLUG, r.t.now)).toBeNull();            // the row itself is not held any more
    const n = r.asks.length;
    expect(await r.sync.ensureTicketBound(r.runs[0]!, 5_000)).toEqual({ identifier: null });
    expect(await r.sync.dispatchSlug(r.runs[0]!, undefined)).toBeUndefined();
    expect(r.asks).toHaveLength(n);                                     // no pass started for it
  });

  it('M-5: ensureTicketBound answers at once for a ticket already bound with an identifier, sending nothing', async () => {
    const r = await rig();
    await tick(r);
    const bound = ticketBinding(r)!;
    expect(bound.identifier).not.toBeNull();
    r.db.prepare("UPDATE plan_tickets SET title = 'Renamed' WHERE runId = ?").run(r.runs[0]!);   // a pass would have work to send
    r.plan.markSyncDue(SLUG, r.t.now - PLAN_SYNC_DEBOUNCE_MS - 1);
    r.respond.current = () => new Promise<CcrcOpOutcome>(() => undefined);
    const from = r.asks.length;
    expect(await r.sync.ensureTicketBound(r.runs[0]!, 200)).toEqual({ identifier: bound.identifier });
    expect(r.asks).toHaveLength(from);
  });
});
