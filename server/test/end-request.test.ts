// D-8076 (spec 2026-11-04 §10, A22, A24): `POST /api/runs/:id/end-request`. The decider is pinned alone (`endRequestDecide`), then
// the route over a real server and store: who may ask, who is told, what shows at once and what is held, the repeat rule, and
// the settle that handles an item when its run starts or ends. Neutral names (prog-a, lane-a, worker-a).
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { PushPayload } from '../src/push.js';
import { ASK_GRACE_MS } from '../src/askwindow.js';
import {
  END_REQUEST_REPEAT_MS, endRequestDecide, endRequestTitle, type EndRequestFacts,
} from '../src/coord/endRequest.js';
import { endRequestEndedMail } from '../src/coord/ledgersMail.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { watcherTeardown } from './watcherTeardown.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import type { StuckReason } from '../../shared/api.js';

const HEADERS = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
const as = (who: string): { byId: string; byUuid: string } => ({ byId: who, byUuid: `u-${who}` });
const HOUR = 3_600_000;

const facts = (over: Partial<EndRequestFacts> = {}): EndRequestFacts => ({
  now: 1_000_000, askerId: 'worker-a',
  run: { state: 'working', claimedBy: 'lane-a', sessionId: 'worker-a' },
  reviewWorkers: [], coordinatorGone: false, openItem: null, lastEnded: null, stuckReason: null, ...over,
});

describe('endRequestDecide', () => {
  it("a coordinator's own request shows at once", () => {
    expect(endRequestDecide(facts({ askerId: 'lane-a' }))).toEqual({ kind: 'raise', heldUntil: null, line: 'Raised by its coordinator' });
  });
  it("a gone coordinator's run shows at once", () => {
    expect(endRequestDecide(facts({ coordinatorGone: true }))).toEqual({ kind: 'raise', heldUntil: null, line: 'Its coordinator is gone' });
  });
  it("a worker's request is held ASK_GRACE_MS", () => {
    expect(endRequestDecide(facts())).toEqual({ kind: 'raise', heldUntil: 1_000_000 + ASK_GRACE_MS, line: 'Its coordinator did not answer' });
  });
  it('a review run worker may ask for the run it reviews', () => {
    expect(endRequestDecide(facts({ askerId: 'reviewer-a', reviewWorkers: ['reviewer-a'] })).kind).toBe('raise');
  });
  it('anyone else is not-yours', () => {
    expect(endRequestDecide(facts({ askerId: 'stranger' }))).toEqual({ kind: 'refuse', why: 'not-yours' });
  });
  it('run-closed', () => {
    expect(endRequestDecide(facts({ run: { state: 'done', claimedBy: 'lane-a', sessionId: 'worker-a' } }))).toEqual({ kind: 'refuse', why: 'run-closed' });
    expect(endRequestDecide(facts({ run: { state: 'failed', claimedBy: 'lane-a', sessionId: 'worker-a' } })).kind).toBe('refuse');
  });
  it('already-asked', () => {
    expect(endRequestDecide(facts({ openItem: { id: 4 } }))).toEqual({ kind: 'refuse', why: 'already-asked' });
  });
  it('recently-asked for 24 hours after a decline or a withdraw, unless the stuck reason changed', () => {
    const lastEnded = { askerId: 'worker-a', at: 1_000_000 - HOUR, stuckReason: 'never-started' as StuckReason | null };
    expect(endRequestDecide(facts({ lastEnded, stuckReason: 'never-started' }))).toEqual({ kind: 'refuse', why: 'recently-asked' });
    expect(endRequestDecide(facts({ lastEnded, stuckReason: 'owner-gone' })).kind).toBe('raise');
    expect(endRequestDecide(facts({ lastEnded: { ...lastEnded, at: 1_000_000 - END_REQUEST_REPEAT_MS - 1 }, stuckReason: 'never-started' })).kind).toBe('raise');
    expect(endRequestDecide(facts({ lastEnded: { ...lastEnded, askerId: 'lane-a' }, stuckReason: 'never-started' })).kind).toBe('raise');
  });
});

let app: FastifyInstance | null = null;
const teardown = watcherTeardown();
afterEach(async () => {
  await app?.close();
  app = null;
  removeTmpFixtures();
});

interface Rig {
  app: FastifyInstance; coord: CoordStore; watcher: FleetWatcher; sent: PushPayload[]; run: number; planned: number;
}

/** prog-a (project-a) is claimed by lane-a. Run `run` is working with worker-a; `planned` is a second, planned run with no session. */
async function rig(): Promise<Rig> {
  const home = mkTmp('ccrc-end-request-');
  for (const id of ['lane-a', 'worker-a', 'reviewer-a', 'stranger']) seedRow(home, id, { project: 'project-a' });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const sent: PushPayload[] = [];
  const deps = { ...testDeps(home, recorder().run), mailToken: ID_GATE_TOKEN, coord, push: { notify: async (p: PushPayload) => { sent.push(p); } } as never };
  const bus = new Bus();
  const watcher = teardown.track(new FleetWatcher(deps, bus, 10_000));
  app = await buildServer(deps, bus, watcher);
  const open = (wave: number, extra: Record<string, unknown> = {}): number =>
    (coord.openRun({ program: 'prog-a', title: 'Prog A', project: 'project-a', wave, waveOf: 3, claimedBy: 'lane-a', ...extra }) as { id: number }).id;
  const run = open(1);
  coord.markDispatched(run, 'worker-a', 'worker-a', 'ws/worker-a', false);
  coord.advance(run, 'dispatched', 'coordinator');
  coord.advance(run, 'working', 'coordinator');
  const planned = open(2);
  return { app, coord, watcher, sent, run, planned };
}

const ask = (r: Rig, runId: number, who: string, why = 'It can never finish.', headers = HEADERS) =>
  r.app.inject({ method: 'POST', url: `/api/runs/${runId}/end-request`, headers, payload: { ...as(who), why } });
const withdraw = (r: Rig, itemId: number, who = 'lane-a') =>
  r.app.inject({ method: 'POST', url: `/api/items/${itemId}/withdraw`, headers: HEADERS, payload: as(who) });
const mailsTo = (r: Rig, to: string) =>
  r.coord.db.prepare('SELECT fromId, toId, subject, body FROM mail WHERE toId = ? ORDER BY id').all(to) as { fromId: string; toId: string; subject: string; body: string }[];
const idOf = (res: { json(): unknown }): number => (res.json() as { id: number }).id;
const gone = (r: Rig, runId: number, reason: StuckReason | null = null, coordinatorGone = true): void => {
  r.watcher.runVerdicts.replace(new Map([[runId, {
    stuck: reason === null ? null : { reason, cause: null, since: 1, closes: null }, blockedBy: null, coordinatorGone,
  }]]), new Map());
};

describe('POST /api/runs/:id/end-request', () => {
  it("a coordinator's own request shows at once", async () => {
    const r = await rig();
    const res = await ask(r, r.planned, 'lane-a');
    expect(res.statusCode, res.body).toBe(200);
    const item = r.coord.itemById(idOf(res))!;
    expect(item).toMatchObject({
      kind: 'do', program: 'prog-a', runId: r.planned, raisedBy: 'lane-a', heldUntil: null, neededBy: 'soon', soonLabel: null,
      action: { verb: 'end-run', runId: r.planned, stuckReason: null },
    });
    expect(item.title.startsWith('End run: ')).toBe(true);
    expect(item.how).toEqual(['Read why it asked.', 'Abandon the run, or keep it.']);
    expect(item.why).toBe('It can never finish.\nRaised by its coordinator');
    expect(r.coord.itemsFor(null, Date.now()).open.map((i) => i.id)).toEqual([item.id]);
    expect(r.coord.itemHistory(item.id)[0]).toMatchObject({ act: 'raise', actor: 'coordinator' });
    expect(mailsTo(r, 'lane-a')).toEqual([]);
  });

  it("a gone coordinator's run shows at once", async () => {
    const r = await rig();
    gone(r, r.run);
    const res = await ask(r, r.run, 'worker-a');
    expect(res.statusCode, res.body).toBe(200);
    const item = r.coord.itemById(idOf(res))!;
    expect(item.heldUntil).toBeNull();
    expect(item.why.endsWith('\nIts coordinator is gone')).toBe(true);
    expect(r.coord.itemHistory(item.id)[0]).toMatchObject({ act: 'raise', actor: 'ccrc' });
    expect(r.coord.itemsFor(null, Date.now()).open).toHaveLength(1);
    expect(mailsTo(r, 'lane-a')).toEqual([]);
  });

  it("a worker's request is held ASK_GRACE_MS and the coordinator is mailed", async () => {
    const r = await rig();
    const res = await ask(r, r.run, 'worker-a', 'Stuck in a loop.');
    expect(res.statusCode, res.body).toBe(200);
    const item = r.coord.itemById(idOf(res))!;
    expect(item.heldUntil).toBe(item.raisedAt + ASK_GRACE_MS);
    expect(item.why.endsWith('\nIts coordinator did not answer')).toBe(true);
    expect(r.coord.itemsFor(null, item.raisedAt).open).toEqual([]);
    expect(r.coord.itemsFor(null, item.raisedAt + ASK_GRACE_MS).open.map((i) => i.id)).toEqual([item.id]);
    const mail = mailsTo(r, 'lane-a');
    expect(mail).toHaveLength(1);
    expect(mail[0]!.subject).toContain(`item ${item.id}`);
    expect(mail[0]!.body).toContain('Stuck in a loop.');
    expect(mail[0]!.body).toContain(`ccrc-api items withdraw ${item.id}`);
    expect(r.coord.itemHistory(item.id)[0]).toMatchObject({ act: 'raise', actor: 'ccrc' });
  });

  it('a review run worker may ask for the run it reviews', async () => {
    const r = await rig();
    const rev = (r.coord.openRun({ program: 'prog-a', title: 'Prog A review', project: 'project-a', wave: 1, waveOf: 3, claimedBy: 'lane-a', kind: 'review', reviews: r.run }) as { id: number }).id;
    r.coord.setSession(rev, 'reviewer-a');
    expect((await ask(r, r.run, 'reviewer-a')).statusCode).toBe(200);
  });

  it("a coordinator's withdraw inside the hold means the operator sees nothing and the asker is told", async () => {
    const r = await rig();
    const id = idOf(await ask(r, r.run, 'worker-a'));
    const res = await withdraw(r, id);
    expect(res.statusCode, res.body).toBe(200);
    expect(r.coord.itemById(id)!.state).toBe('withdrawn');
    expect(r.coord.itemsFor(null, Date.now() + 10 * ASK_GRACE_MS)).toEqual({ open: [], cleared: [] });
    const told = mailsTo(r, 'worker-a');
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ fromId: 'coordinator' });
    expect(told[0]!.subject).toContain(`item ${id}`);
    expect(told[0]!.body).toContain('withdrawn');
  });

  it('a late withdraw wins until the operator has acted', async () => {
    const r = await rig();
    const id = idOf(await ask(r, r.run, 'worker-a'));
    r.coord.db.prepare('UPDATE operator_items SET heldUntil = ? WHERE id = ?').run(Date.now() - 1, id);
    expect(r.coord.itemsFor(null, Date.now()).open).toHaveLength(1);
    expect((await withdraw(r, id)).statusCode).toBe(200);
    // After the operator has acted, a withdraw changes nothing.
    const again = idOf(await ask(r, r.planned, 'lane-a'));
    expect(r.coord.moveItem(again, 'act', 'operator', {}, Date.now(), { programmeHasOpenRun: true }).ok).toBe(true);
    const late = await withdraw(r, again);
    expect(late.statusCode).toBe(409);
    expect(late.json()).toMatchObject({ error: 'not-open' });
  });

  it("a coordinator's withdraw of its own request tells nobody", async () => {
    const r = await rig();
    const id = idOf(await ask(r, r.planned, 'lane-a'));
    expect((await withdraw(r, id)).statusCode).toBe(200);
    expect(mailsTo(r, 'lane-a')).toEqual([]);
  });

  it('anyone else is not-yours, by the attributed claimant and never by project', async () => {
    const r = await rig();
    // `stranger` shares the run's project and is a live registry row: the project decides nothing (D-5530).
    const res = await ask(r, r.run, 'stranger');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-yours' });
    expect(r.coord.openEndRequestOf(r.run)).toBeNull();
  });

  it('already-asked names the item', async () => {
    const r = await rig();
    const id = idOf(await ask(r, r.run, 'worker-a'));
    const res = await ask(r, r.run, 'lane-a');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'already-asked', itemId: id });
    expect((res.json() as { detail: string }).detail).toContain(`item ${id}`);
  });

  it('recently-asked for 24 hours after a decline or a withdraw, unless the stuck reason changed', async () => {
    const r = await rig();
    gone(r, r.run, 'never-started', false);
    const id = idOf(await ask(r, r.run, 'worker-a'));
    expect(r.coord.itemById(id)!.action).toMatchObject({ stuckReason: 'never-started' });
    expect((await withdraw(r, id)).statusCode).toBe(200);
    const again = await ask(r, r.run, 'worker-a');
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'recently-asked' });
    // Another asker is not caught by it, and neither is the same asker under a changed reason.
    gone(r, r.run, 'owner-gone', false);
    expect((await ask(r, r.run, 'worker-a')).statusCode).toBe(200);
  });

  it('a repeat is allowed once 24 hours have passed', async () => {
    const r = await rig();
    const id = idOf(await ask(r, r.run, 'worker-a'));
    expect((await withdraw(r, id)).statusCode).toBe(200);
    r.coord.db.prepare('UPDATE operator_items SET closedAt = ? WHERE id = ?').run(Date.now() - END_REQUEST_REPEAT_MS - HOUR, id);
    expect((await ask(r, r.run, 'worker-a')).statusCode).toBe(200);
  });

  it('run-closed', async () => {
    const r = await rig();
    r.coord.advance(r.planned, 'failed', 'coordinator');
    const res = await ask(r, r.planned, 'lane-a');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'run-closed' });
  });

  it('refuses an unknown run, a missing why and a missing token, and writes nothing', async () => {
    const r = await rig();
    expect((await ask(r, 9999, 'lane-a')).statusCode).toBe(404);
    expect((await ask(r, r.run, 'lane-a', '')).statusCode).toBe(400);
    expect((await ask(r, r.run, 'lane-a', 'x', {} as never)).statusCode).toBe(401);
    expect(r.coord.itemsFor(null, Date.now()).open).toEqual([]);
  });

  it('refuses a stale uuid and writes nothing', async () => {
    const r = await rig();
    const res = await r.app.inject({ method: 'POST', url: `/api/runs/${r.run}/end-request`, headers: HEADERS, payload: { byId: 'lane-a', byUuid: 'wrong', why: 'x' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'stale-uuid' });
    expect(r.coord.openEndRequestOf(r.run)).toBeNull();
  });

  it('neededBy soon sends no push, at raise or when the hold ends', async () => {
    const r = await rig();
    await ask(r, r.run, 'worker-a');
    await ask(r, r.planned, 'lane-a');
    expect(r.sent).toEqual([]);
  });

  it('the title is the run row name, and is cut to the title bound', () => {
    const base = { program: 'prog-a', programTitle: 'Prog A', runTitle: null, wave: 2, waveOf: 3, kind: 'work' as const };
    expect(endRequestTitle(base)).toBe('End run: Prog A · wave 2 of 3');
    expect(endRequestTitle({ ...base, runTitle: 'Own title', waveOf: null })).toBe('End run: Own title · wave 2');
    expect(endRequestTitle({ ...base, kind: 'review' })).toBe('End run: Prog A · review of wave 2');
    expect([...endRequestTitle({ ...base, runTitle: 'x'.repeat(500) })].length).toBe(140);
  });
});

describe('a run starting or ending handles its open end request', () => {
  it('a planned run starting settles the item, with its note', async () => {
    const r = await rig();
    const id = idOf(await ask(r, r.planned, 'lane-a'));
    expect(r.coord.advance(r.planned, 'dispatched', 'coordinator').ok).toBe(true);
    expect(r.coord.itemById(id)!.state).toBe('done');
    expect(r.coord.itemHistory(id).at(-1)).toMatchObject({ act: 'settle', actor: 'ccrc', note: 'Handled by its coordinator.' });
  });

  it('any run closing settles the item, and the note says who closed it', async () => {
    const r = await rig();
    const a = idOf(await ask(r, r.planned, 'lane-a'));
    r.coord.advance(r.planned, 'failed', 'operator');
    expect(r.coord.itemById(a)!.state).toBe('done');
    expect(r.coord.itemHistory(a).at(-1)).toMatchObject({ act: 'settle', note: 'The run was closed by you.' });
    const b = idOf(await ask(r, r.run, 'worker-a'));
    r.coord.advance(r.run, 'closing', 'coordinator');
    expect(r.coord.itemById(b)!.state).toBe('open');
    r.coord.advance(r.run, 'done', 'coordinator');
    expect(r.coord.itemById(b)!.state).toBe('done');
    expect(r.coord.itemHistory(b).at(-1)).toMatchObject({ act: 'settle', note: 'Handled by its coordinator.' });
  });

  it('a held item is settled too, and the operator never sees it', async () => {
    const r = await rig();
    const id = idOf(await ask(r, r.run, 'worker-a'));
    r.coord.advance(r.run, 'failed', 'coordinator');
    expect(r.coord.itemById(id)!.state).toBe('done');
  });

  it("the operator's own act closes its item itself, so the abandon it asked for leaves it alone", async () => {
    const r = await rig();
    const id = idOf(await ask(r, r.planned, 'lane-a'));
    r.coord.advance(r.planned, 'failed', 'operator', `abandon:requested:${id}`);
    expect(r.coord.itemById(id)!.state).toBe('open');
  });

  it('leaves another run, and an ordinary item, alone', async () => {
    const r = await rig();
    const id = idOf(await ask(r, r.planned, 'lane-a'));
    r.coord.advance(r.run, 'awaiting-review', 'coordinator');
    expect(r.coord.itemById(id)!.state).toBe('open');
  });
});

describe('the asker is told, in the move\'s own transaction (A22)', () => {
  it('the words for a decline and for a withdraw name the item and the run', () => {
    const declined = endRequestEndedMail({ id: 7 }, 12, 'declined');
    expect(declined.subject).toBe('end request: item 7: run 12 declined');
    expect(declined.body).toContain('The operator kept the run.');
    const withdrawn = endRequestEndedMail({ id: 7 }, 12, 'withdrawn');
    expect(withdrawn.body).toContain('Its coordinator withdrew it');
    expect(`${declined.body}${withdrawn.body}`).not.toMatch(/abandon/i);
  });

  it('a mail that fails to queue rolls the move back, so the item stays open', async () => {
    const r = await rig();
    const id = idOf(await ask(r, r.run, 'worker-a'));
    expect(() => r.coord.moveItemWithMail(id, 'withdraw', 'coordinator', {}, Date.now(), { programmeHasOpenRun: true }, () => { throw new Error('mail failed'); })).toThrow('mail failed');
    expect(r.coord.itemById(id)!.state).toBe('open');
    expect(r.coord.itemHistory(id)).toHaveLength(1);
  });

  it('a refused move never queues the mail', async () => {
    const r = await rig();
    const id = idOf(await ask(r, r.planned, 'lane-a'));
    r.coord.moveItem(id, 'act', 'operator', {}, Date.now(), { programmeHasOpenRun: true });
    let queued = 0;
    const res = r.coord.moveItemWithMail(id, 'decline', 'operator', {}, Date.now(), { programmeHasOpenRun: true }, () => { queued += 1; });
    expect(res.ok).toBe(false);
    expect(queued).toBe(0);
  });

  it('a request raised with a failing notice leaves no item behind', async () => {
    const r = await rig();
    expect(() => r.coord.raiseItemWithMail({
      program: 'prog-a', runId: r.run, raisedBy: 'worker-a', kind: 'do', title: 'End run: x', why: 'x', how: ['a'], options: null,
      neededBy: 'soon', soonLabel: null, secretSlot: null,
    }, Date.now(), 'ccrc', () => { throw new Error('mail failed'); })).toThrow('mail failed');
    expect(r.coord.db.prepare('SELECT COUNT(*) AS n FROM operator_items').get()).toEqual({ n: 0 });
  });
});
