// Overlord W1, the push outbox, Task 5 (plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox.md): an item reaches
// the operator with its reach stamp and its one outbox row, written in the transaction that raises it, arms it (a toggle to
// blocking) or, for a held item, in the drain's per-item transaction at `heldUntil`. The raise and blocking routes run over a
// real server and store (the harness of `ledgers-coordinator-routes.test.ts`, with a recording push double and fake time); the
// store, the three `ccrc` raisers and the held drain are driven directly. Neutral names (prog-a, lane-a).
import { describe, it, expect, afterEach, vi, type Mock } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { abandonRefusal } from '../src/coord/close.js';
import { endRequestRun } from '../src/coord/endRequest.js';
import { routeReviewReleases } from '../src/coord/reviewRelease.js';
import { routeRefusals, type RefusedClose } from '../src/coord/runCloseRefusals.js';
import { insertBoundRowInTx } from '../src/coord/pushOutboxStore.js';
import { tx } from '../src/coord/tx.js';
import { ASK_GRACE_MS } from '../src/askwindow.js';
import { itemBoundOf, outboxSettledOf, senderFor, type SenderDeps } from '../src/pushSender.js';
import type { PushPayload } from '../src/push.js';
import type { ChildReclaimSweepVerdict } from '../src/childReclaimSweep.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { pushSeam, type PushSeam } from './pushSeam.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const HEADERS = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
const as = (who = 'lane-a'): { byId: string; byUuid: string } => ({ byId: who, byUuid: `u-${who}` });
const T = 1_800_000_000_000;
const ACCEPTED = { kind: 'sent', subs: [{ endpointHash: 'ab', verdict: 'accepted', status: 201 }] };

let app: FastifyInstance | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
  app = null;
  removeTmpFixtures();
});

interface Rig {
  app: FastifyInstance; coord: CoordStore; seam: PushSeam; sdeps: SenderDeps; home: string;
}

/** prog-a is claimed by lane-a. `push` is the recording double (or a caller's), absent for a box with no push service. */
async function rig(o: { service?: boolean; push?: { notify(p: PushPayload): Promise<unknown> } } = {}): Promise<Rig> {
  const home = mkTmp('ccrc-outbox-items-');
  seedRow(home, 'lane-a');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const seam = pushSeam();
  const base = testDeps(home, recorder().run);
  const push = o.service === false ? undefined : (o.push ?? seam.push);
  const deps = { ...base, mailToken: ID_GATE_TOKEN, coord, ...(push === undefined ? {} : { push: push as never }) };
  app = await buildServer(deps, new Bus());
  coord.openRun({ program: 'prog-a', title: 'PROG-A', project: 'project-a', wave: 1, waveOf: null, claimedBy: 'lane-a' });
  return { app, coord, seam, home, sdeps: { ...(push === undefined ? {} : { push }), coord, time: base.time } };
}

const post = (r: Rig, url: string, payload: unknown) => r.app.inject({ method: 'POST', url, headers: HEADERS, payload: payload as never });
const RAISE = { kind: 'do', title: 'Turn on the setting', why: 'The wave needs it.', how: ['Open Settings', 'Switch it on'],
  neededBy: 'soon', soonLabel: 'before wave 6' };
const raise = async (r: Rig, over: Record<string, unknown> = {}): Promise<number> => {
  const res = await post(r, '/api/programmes/prog-a/items', { ...as(), ...RAISE, ...over });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { id: number }).id;
};
const toggle = async (r: Rig, id: number, blocking: boolean): Promise<void> => {
  const res = await post(r, `/api/items/${id}/blocking`, { ...as(), blocking });
  expect(res.statusCode, res.body).toBe(200);
};
/** An item written straight to the store with no bound row: how an item raised before this build looks. */
const plainItem = (r: Rig, over: { heldUntil?: number | null; neededBy?: 'blocking' | 'soon' | 'later'; raisedAt?: number } = {}): number =>
  r.coord.raiseItem({ program: 'prog-a', runId: null, raisedBy: 'lane-a', kind: 'do', title: 'Do it', why: 'because', how: ['step'],
    options: null, neededBy: over.neededBy ?? 'soon', soonLabel: null, secretSlot: null, heldUntil: over.heldUntil ?? null }, over.raisedAt ?? T);

const outboxRows = (c: CoordStore): Record<string, unknown>[] =>
  c.db.prepare('SELECT id, pushId, sourceKind, sourceId, payload, tag, state, silentWhy, claimSeq, attempts, pushedAt FROM push_outbox ORDER BY id')
    .all() as Record<string, unknown>[];
const rowsOfItem = (c: CoordStore, id: number): Record<string, unknown>[] => outboxRows(c).filter((x) => x.sourceKind === 'item' && x.sourceId === id);
const reached = (c: CoordStore, id: number): number | null =>
  (c.db.prepare('SELECT reachedOperatorAt AS r FROM operator_items WHERE id = ?').get(id) as { r: number | null }).r;
const drain = async (r: Rig, now: number): Promise<void> => {
  const sender = senderFor(r.sdeps);
  await sender.drain(now, outboxSettledOf({ askSettled: () => null }, r.coord));
  await sender.idle();
};
const idle = (r: Rig): Promise<void> => senderFor(r.sdeps).idle();
const blockingBound = (r: Rig, title = 'Do it') => itemBoundOf(r.sdeps, { title, neededBy: 'blocking' }, 'arm');
const reachBound = (r: Rig, item: { title: string; neededBy: 'blocking' | 'soon' | 'later' }) => itemBoundOf(r.sdeps, item, 'reach');

describe('the raise route', () => {
  it('a blocking raise writes its row and pushes once, with the item\'s copy', async () => {
    const r = await rig();
    const id = await raise(r, { neededBy: 'blocking', soonLabel: null });
    expect(r.seam.sent).toHaveLength(1);
    expect(r.seam.sent[0]).toMatchObject({ title: 'Waiting on you', body: 'Turn on the setting', tag: `item-${id}`, url: '/waiting' });
    expect(rowsOfItem(r.coord, id)).toHaveLength(1);
    expect(reached(r.coord, id)).not.toBeNull();
    await idle(r);
    expect(rowsOfItem(r.coord, id)).toMatchObject([{ state: 'sent', tag: `item-${id}`, attempts: 1, payload: null }]);
    expect(r.seam.sent).toHaveLength(1);
  });

  it('the row is written pending by the raise\'s own transaction (the store, before any send)', async () => {
    const r = await rig();
    const out = r.coord.raiseItemReached({ program: 'prog-a', runId: null, raisedBy: 'lane-a', kind: 'do', title: 'Do it', why: 'because',
      how: ['step'], options: null, neededBy: 'blocking', soonLabel: null, secretSlot: null, heldUntil: null }, T, 'coordinator',
    reachBound(r, { title: 'Do it', neededBy: 'blocking' }));
    expect(out.row).toMatchObject({ due: { due: 'now' } });
    expect(rowsOfItem(r.coord, out.id)).toMatchObject([{ state: 'pending', tag: `item-${out.id}` }]);
    expect(reached(r.coord, out.id)).toBe(T);
    expect(r.seam.sent).toEqual([]);
  });

  it('a blocking raise held at its raise sends nothing now; the held drain stamps it at heldUntil (review 2150 F9)', async () => {
    const r = await rig();
    const real = r.coord.raiseItemReached.bind(r.coord);
    // The route never parses `heldUntil` today, so the store is handed a held item the way a W3 hold arm would.
    vi.spyOn(r.coord, 'raiseItemReached').mockImplementation((input, now, actor, bound) =>
      real({ ...input, heldUntil: now + 60_000 }, now, actor, bound));
    const id = await raise(r, { neededBy: 'blocking' });
    await idle(r);
    expect(r.seam.sent).toEqual([]);
    expect(rowsOfItem(r.coord, id)).toEqual([]);
    expect(reached(r.coord, id)).toBeNull();
  });

  it('a soon raise writes a silent row, why level, and pushes nothing', async () => {
    const r = await rig();
    const id = await raise(r);
    expect(rowsOfItem(r.coord, id)).toMatchObject([{ state: 'silent', silentWhy: 'level', payload: null }]);
    expect(reached(r.coord, id)).not.toBeNull();
    await idle(r);
    expect(r.seam.sent).toEqual([]);
  });
});

describe('a bound item\'s retry re-reads the item (review 2150 F2)', () => {
  const REFUSED = { kind: 'sent', subs: [{ endpointHash: 'ab', verdict: 'refused', status: 429 }] };
  /** A blocking raise whose push every subscription refused: its row is `retrying`. Answers the item and the retry's time. */
  const refusedRaise = async (): Promise<{ r: Rig; id: number; due: number; notify: Mock }> => {
    const notify = vi.fn(async (): Promise<unknown> => REFUSED);
    const r = await rig({ push: { notify } });
    const id = await raise(r, { neededBy: 'blocking' });
    await idle(r);
    const row = r.coord.db.prepare('SELECT state, armedAt FROM push_outbox WHERE sourceId = ?').get(id) as { state: string; armedAt: number };
    expect(row.state).toBe('retrying');
    // The route stamps by its own `now`, and the sender's fake clock stands still: the retry is made due at the sender's.
    r.coord.db.prepare('UPDATE push_outbox SET nextAttemptAt = ? WHERE sourceId = ?').run(r.sdeps.time!.clock.wall(), id);
    return { r, id, due: row.armedAt, notify };
  };

  it('an item lowered from blocking before its retry is silenced, why level, and never pushed again', async () => {
    const { r, id, due, notify } = await refusedRaise();
    await toggle(r, id, false);
    await drain(r, due);
    expect(rowsOfItem(r.coord, id)).toMatchObject([{ state: 'silent', silentWhy: 'level', payload: null }]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('an item the operator ticked (checking) before its retry is silenced, why settled, and never pushed again', async () => {
    const { r, id, due, notify } = await refusedRaise();
    expect(r.coord.moveItem(id, 'tick', 'operator', { answer: 'done' }, T, { programmeHasOpenRun: true })).toMatchObject({ ok: true });
    await drain(r, due);
    expect(rowsOfItem(r.coord, id)).toMatchObject([{ state: 'silent', silentWhy: 'settled', payload: null }]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('an item still open and blocking is retried', async () => {
    const { r, id, due, notify } = await refusedRaise();
    await drain(r, due);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(rowsOfItem(r.coord, id)).toMatchObject([{ state: 'retrying', attempts: 2 }]);
  });
});

describe('the toggle to blocking', () => {
  it('re-arms the row and pushes once, with the same push id and tag', async () => {
    const r = await rig();
    const id = await raise(r);
    const [before] = rowsOfItem(r.coord, id);
    expect(before).toMatchObject({ state: 'silent' });
    await toggle(r, id, true);
    expect(r.seam.sent).toHaveLength(1);
    expect(r.seam.sent[0]).toMatchObject({ title: 'Waiting on you', tag: `item-${id}`, url: '/waiting' });
    await idle(r);
    const rows = rowsOfItem(r.coord, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pushId: before!.pushId, tag: `item-${id}`, state: 'sent' });
  });

  it('while the row is sending, the arm sets it pending and the in-flight verdict changes nothing (the store)', async () => {
    const r = await rig();
    const input = { program: 'prog-a', runId: null, raisedBy: 'lane-a', kind: 'do' as const, title: 'Do it', why: 'because', how: ['step'],
      options: null, neededBy: 'soon' as const, soonLabel: null, secretSlot: null, heldUntil: null };
    const { id } = r.coord.raiseItemReached(input, T, 'coordinator', reachBound(r, { title: 'Do it', neededBy: 'soon' }));
    const armed = r.coord.setBlocking(id, true, T + 1, blockingBound(r));
    const armedRow = 'row' in armed ? armed.row : null;
    expect(armedRow).not.toBeNull();
    const rowId = armedRow!.id;
    const claim = r.coord.claimOutboxRow(rowId, T + 2);
    expect(claim).toMatchObject({ changed: true, claimSeq: 1 });
    expect(rowsOfItem(r.coord, id)).toMatchObject([{ state: 'sending', claimSeq: 1 }]);
    r.coord.setBlocking(id, false, T + 3);
    r.coord.setBlocking(id, true, T + 4, blockingBound(r));
    expect(rowsOfItem(r.coord, id)).toMatchObject([{ state: 'pending', claimSeq: 1 }]);
    const verdict = r.coord.markOutboxVerdict(rowId, 1, { to: 'sent', verdict: ACCEPTED as never }, T + 5);
    expect(verdict).toEqual({ changed: false });
    expect(rowsOfItem(r.coord, id)).toMatchObject([{ state: 'pending', pushedAt: null }]);
  });

  it('while the row is sending, through the route: the first attempt\'s late verdict is dropped by claimSeq', async () => {
    const calls: { payload: PushPayload; resolve: (v: unknown) => void }[] = [];
    const push = { notify: (payload: PushPayload): Promise<unknown> => new Promise((resolve) => { calls.push({ payload, resolve }); }) };
    const r = await rig({ push });
    const id = await raise(r);
    await toggle(r, id, true);
    expect(calls).toHaveLength(1);
    expect(rowsOfItem(r.coord, id)).toMatchObject([{ state: 'sending', claimSeq: 1 }]);
    await toggle(r, id, false);
    await toggle(r, id, true);
    expect(calls).toHaveLength(2);
    expect(rowsOfItem(r.coord, id)).toMatchObject([{ state: 'sending', claimSeq: 2 }]);
    calls[0]!.resolve(ACCEPTED);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(rowsOfItem(r.coord, id)).toMatchObject([{ state: 'sending', claimSeq: 2, pushedAt: null }]);
    calls[1]!.resolve(ACCEPTED);
    await idle(r);
    expect(rowsOfItem(r.coord, id)).toMatchObject([{ state: 'sent', claimSeq: 2 }]);
    expect(rowsOfItem(r.coord, id)[0]!.pushedAt).not.toBeNull();
  });

  it('on an item with no row (raised before this build) writes the row and the stamp and pushes once', async () => {
    const r = await rig();
    const id = plainItem(r);
    expect(rowsOfItem(r.coord, id)).toEqual([]);
    expect(reached(r.coord, id)).toBeNull();
    await toggle(r, id, true);
    expect(rowsOfItem(r.coord, id)).toHaveLength(1);
    expect(reached(r.coord, id)).not.toBeNull();
    expect(r.seam.sent).toHaveLength(1);
    expect(r.seam.sent[0]).toMatchObject({ tag: `item-${id}` });
    await idle(r);
    expect(rowsOfItem(r.coord, id)).toMatchObject([{ state: 'sent' }]);
  });

  it('on a held item with no row, inside its hold, writes the row and the stamp and pushes once', async () => {
    const r = await rig();
    const id = plainItem(r, { heldUntil: Date.now() + ASK_GRACE_MS, raisedAt: Date.now() });
    expect(rowsOfItem(r.coord, id)).toEqual([]);
    await toggle(r, id, true);
    expect(rowsOfItem(r.coord, id)).toHaveLength(1);
    expect(reached(r.coord, id)).not.toBeNull();
    expect(r.seam.sent).toHaveLength(1);
    await idle(r);
    expect(rowsOfItem(r.coord, id)).toMatchObject([{ state: 'sent' }]);
  });
});

describe('the held drain (an end-request item reaches the operator at heldUntil)', () => {
  const openWorkerRun = (r: Rig, wave: number, worker: string): number => {
    const run = (r.coord.openRun({ program: 'prog-a', title: 'PROG-A', project: 'project-a', wave, waveOf: 3, claimedBy: 'lane-a' }) as { id: number }).id;
    r.coord.markDispatched(run, worker, worker, `ws/${worker}`, false);
    r.coord.advance(run, 'dispatched', 'coordinator');
    r.coord.advance(run, 'working', 'coordinator');
    return run;
  };
  const endDeps = (r: Rig) => ({ coord: r.coord, now: () => T, verdictOf: () => null, itemReach: (item: { title: string; neededBy: 'blocking' | 'soon' | 'later' }) => reachBound(r, item) });

  it('gets no stamp before heldUntil, one stamp and one silent row at it, and none when it closed first', async () => {
    const r = await rig();
    const keep = openWorkerRun(r, 2, 'worker-a');
    const closed = openWorkerRun(r, 3, 'worker-b');
    const a = endRequestRun(endDeps(r), keep, 'worker-a', 'It can never finish.');
    const b = endRequestRun(endDeps(r), closed, 'worker-b', 'It can never finish.');
    if (!a.ok || !b.ok) throw new Error(`end request refused: ${JSON.stringify([a, b])}`);
    expect(a.heldUntil).toBe(T + ASK_GRACE_MS);
    expect([rowsOfItem(r.coord, a.id), rowsOfItem(r.coord, b.id)]).toEqual([[], []]);
    expect([reached(r.coord, a.id), reached(r.coord, b.id)]).toEqual([null, null]);
    r.coord.markFirstBoot(T - 1_000);
    // The coordinator settles the second item inside the hold: the operator is never shown it.
    expect(r.coord.moveItem(b.id, 'withdraw', 'coordinator', {}, T + 5, { programmeHasOpenRun: true }).ok).toBe(true);
    await drain(r, T + ASK_GRACE_MS - 1);
    expect([reached(r.coord, a.id), reached(r.coord, b.id)]).toEqual([null, null]);
    expect(outboxRows(r.coord)).toEqual([]);
    await drain(r, T + ASK_GRACE_MS);
    expect(reached(r.coord, a.id)).toBe(T + ASK_GRACE_MS);
    expect(reached(r.coord, b.id)).toBeNull();
    expect(rowsOfItem(r.coord, a.id)).toMatchObject([{ state: 'silent', silentWhy: 'level', payload: null }]);
    expect(rowsOfItem(r.coord, b.id)).toEqual([]);
    await drain(r, T + ASK_GRACE_MS + 60_000);
    expect(rowsOfItem(r.coord, a.id)).toHaveLength(1);
    expect(reached(r.coord, a.id)).toBe(T + ASK_GRACE_MS);
    expect(r.seam.sent).toEqual([]);
  });

  it('a held item made blocking with no row (an older build\'s toggle) gets a silent older-build row and no push', async () => {
    const r = await rig();
    const id = plainItem(r, { heldUntil: T + ASK_GRACE_MS });
    r.coord.db.prepare("UPDATE operator_items SET neededBy = 'blocking' WHERE id = ?").run(id);
    r.coord.markFirstBoot(T - 1_000);
    await drain(r, T + ASK_GRACE_MS + 1);
    expect(reached(r.coord, id), 'the stamp is heldUntil, not the drain\'s time (review 2150 F3)').toBe(T + ASK_GRACE_MS);
    expect(rowsOfItem(r.coord, id)).toMatchObject([{ state: 'silent', silentWhy: 'older-build', payload: null }]);
    expect(r.seam.sent).toEqual([]);
  });
});

describe('the three ccrc raisers: shown at the raise, silent, no push', () => {
  it('an end-request item raised with a null heldUntil (its coordinator asks)', async () => {
    const r = await rig();
    const run = (r.coord.openRun({ program: 'prog-a', title: 'PROG-A', project: 'project-a', wave: 2, waveOf: 3, claimedBy: 'lane-a' }) as { id: number }).id;
    const out = endRequestRun({ coord: r.coord, now: () => T, verdictOf: () => null, itemReach: (item) => reachBound(r, item) }, run, 'lane-a', 'Done.');
    if (!out.ok) throw new Error(JSON.stringify(out));
    expect(out.heldUntil).toBeNull();
    expect(reached(r.coord, out.id)).toBe(T);
    expect(rowsOfItem(r.coord, out.id)).toMatchObject([{ state: 'silent', silentWhy: 'level' }]);
    await idle(r);
    expect(r.seam.sent).toEqual([]);
  });

  it('a review-release item with no coordinator', async () => {
    const r = await rig();
    const open = (kind: 'work' | 'review', reviews: number | null): number => {
      const o = r.coord.openRun({ program: 'prog-a', title: 'PROG-A', project: 'project-a', wave: 4, waveOf: null, claimedBy: 'lane-a', kind, reviews });
      if (!('id' in o)) throw new Error(`openRun refused: ${JSON.stringify(o)}`);
      r.coord.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(o.id);   // an ownerless run
      return o.id;
    };
    const work = open('work', null);
    const review = open('review', work);
    r.coord.markDispatched(review, 'demo-rv', 'demo-rv', 'ws/demo-rv', false);
    for (const to of ['dispatched', 'working', 'done'] as const) expect(r.coord.advance(review, to, 'test').ok).toBe(true);
    const stale: ChildReclaimSweepVerdict = { eligible: false, why: 'review-report-stale', runId: review };
    const out = routeReviewReleases({ coord: r.coord, itemReach: (item) => reachBound(r, item) },
      [{ sessionId: 'demo-rv', reviewRunId: review, reviewedRunId: work }], new Map([['demo-rv', stale]]), T);
    expect(out.raised).toHaveLength(1);
    const id = out.raised[0]!;
    expect(r.coord.itemById(id)!.heldUntil).toBeNull();
    expect(reached(r.coord, id)).toBe(T);
    expect(rowsOfItem(r.coord, id)).toMatchObject([{ state: 'silent', silentWhy: 'level' }]);
    await idle(r);
    expect(r.seam.sent).toEqual([]);
  });

  it('a run-close refusal that is not tell-and-hold; a tell-and-hold one is held, with no stamp and no row', async () => {
    const r = await rig();
    // Programme lifecycle W1 (R11, D-8993): one coordinator owns one programme, so each programme has its own claimant.
    const fixtureRun = (program: string, claimedBy: string): number => {
      const o = r.coord.openRun({ program, title: program, project: 'project-a', wave: 1, waveOf: 2, claimedBy });
      if (!('id' in o)) throw new Error(`openRun refused: ${JSON.stringify(o)}`);
      return o.id;
    };
    const refuse = (id: number, reason: RefusedClose['reason'], lives: boolean): number[] => {
      const run = r.coord.runCloseRuns().find((x) => x.id === id)!;
      const refused: RefusedClose = { run, row: 'never-started', reason, claimant: run.claimedBy!, lives, held: lives };
      return [...routeRefusals({ coord: r.coord, abandonRefusal: (i) => abandonRefusal(r.coord, i),
        itemReach: (item) => reachBound(r, item) }, [refused], T).raised];
    };
    const [shown] = refuse(fixtureRun('prog-x', 'lane-gone'), 'open-pr', false);
    expect(shown).toBeDefined();
    expect(r.coord.itemById(shown!)!.heldUntil).toBeNull();
    expect(reached(r.coord, shown!)).toBe(T);
    expect(rowsOfItem(r.coord, shown!)).toMatchObject([{ state: 'silent', silentWhy: 'level' }]);
    const [held] = refuse(fixtureRun('prog-y', 'lane-gone-b'), 'child-marker-unreadable', true);
    expect(r.coord.itemById(held!)!.heldUntil).toBe(T + ASK_GRACE_MS);
    expect(reached(r.coord, held!)).toBeNull();
    expect(rowsOfItem(r.coord, held!)).toEqual([]);
    await idle(r);
    expect(r.seam.sent).toEqual([]);
  });
});

describe('with no push service', () => {
  it('a blocking raise writes the stamp and one silent no-service row with a null payload, and sends nothing', async () => {
    const r = await rig({ service: false });
    const id = await raise(r, { neededBy: 'blocking', soonLabel: null });
    expect(reached(r.coord, id)).not.toBeNull();
    expect(rowsOfItem(r.coord, id)).toMatchObject([{ state: 'silent', silentWhy: 'no-service', payload: null, tag: null }]);
    expect(r.seam.sent).toEqual([]);
  });

  it('a toggle on an item with no row writes the stamp and one silent no-service row, and sends nothing', async () => {
    const r = await rig({ service: false });
    const id = plainItem(r);
    await toggle(r, id, true);
    expect(reached(r.coord, id)).not.toBeNull();
    expect(rowsOfItem(r.coord, id)).toMatchObject([{ state: 'silent', silentWhy: 'no-service', payload: null, tag: null }]);
    expect(r.seam.sent).toEqual([]);
  });
});

describe('a bound insert that throws rolls the move back', () => {
  /** A tag-less payload: `reachInTx` and `armInTx` refuse it, inside the move's transaction. */
  const tagless = () => ({ prepared: { payload: { title: 'Waiting on you', body: 'Do it' }, pushId: 'd'.repeat(32), service: true },
    due: { due: 'now' as const }, viewing: false });
  const input = { program: 'prog-a', runId: null, raisedBy: 'lane-a', kind: 'do' as const, title: 'Do it', why: 'because', how: ['step'],
    options: null, neededBy: 'blocking' as const, soonLabel: null, secretSlot: null, heldUntil: null };

  it('the item raise lands no item, no event, no stamp and no row', async () => {
    const r = await rig();
    expect(() => r.coord.raiseItemReached(input, T, 'coordinator', tagless)).toThrow(/no tag/);
    expect(r.coord.db.prepare('SELECT COUNT(*) AS n FROM operator_items').get()).toEqual({ n: 0 });
    expect(r.coord.db.prepare('SELECT COUNT(*) AS n FROM operator_item_events').get()).toEqual({ n: 0 });
    expect(outboxRows(r.coord)).toEqual([]);
  });

  it('a raise whose source already has a row (the unique index) lands no item either, and the route answers an error', async () => {
    const r = await rig();
    const next = (r.coord.db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM operator_items").get() as { n: number }).n;
    tx(r.coord.db, () => insertBoundRowInTx(r.coord.db, { source: 'item', sourceId: next, pushId: 'e'.repeat(32), state: 'silent',
      silentWhy: 'level', payload: null, at: T }));
    const res = await post(r, '/api/programmes/prog-a/items', { ...as(), ...RAISE, neededBy: 'blocking', soonLabel: null });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(r.coord.db.prepare('SELECT COUNT(*) AS n FROM operator_items').get()).toEqual({ n: 0 });
    expect(r.seam.sent).toEqual([]);
  });

  it('the toggle leaves the level, the events and the stamp as they were', async () => {
    const r = await rig();
    const id = plainItem(r);
    const eventsBefore = r.coord.itemHistory(id).length;
    expect(() => r.coord.setBlocking(id, true, T + 1, tagless)).toThrow(/no tag|has no tagged payload/);
    expect(r.coord.itemById(id)!.neededBy).toBe('soon');
    expect(r.coord.itemHistory(id)).toHaveLength(eventsBefore);
    expect(reached(r.coord, id)).toBeNull();
    expect(outboxRows(r.coord)).toEqual([]);
  });
});
