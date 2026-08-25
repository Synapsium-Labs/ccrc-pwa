// Build 4, Task 3 — `POST /api/runs/:id/items`, the coordinator's settle.
//
// Spec §3.2: the COORDINATOR is the writer at both ends. It declares the items
// at dispatch and settles them when it processes a `wave-done` — AFTER
// `verifyDone` re-measured, "which is the moment ccrc is allowed to believe a
// worker". This route therefore performs no fleet act and re-measures nothing:
// the authorisation happened one call earlier, at `/advance` (or `/close`).
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const PROJECT = 'demo';

const open = async (home: string) => {
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home), mailToken: TOKEN, coord });
  return { app, coord };
};

const postItems = (app: FastifyInstance, id: number, body: unknown, token: string | null = TOKEN) =>
  app.inject({ method: 'POST', url: `/api/runs/${id}/items`,
    headers: token === null ? {} : { 'x-ccrc-mail-token': token },
    payload: body as Record<string, unknown> });

/** A run with `titles.length` pending items, straight through the store —
 *  this suite is about the SETTLE, and driving the dispatch route for its
 *  fixture would drag ccd, the registry diff and the hold in with it. */
const runWith = (coord: CoordStore, titles: readonly string[], over: { wave?: number } = {}) => {
  const r = coord.openRun({ program: 'build4', title: 'Ledger', project: PROJECT,
    wave: over.wave ?? 1, waveOf: 4, claimedBy: 'ccrc-pwa-coordinator' }) as { id: number };
  const ids = titles.map((t) => coord.addWorkItem(r.id, t, []).id);
  return { runId: r.id, ids };
};

describe('POST /api/runs/:id/items', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('401s without the box token, like every other coordination write route', async () => {
    const home = mkTmp('ccrc-items-');
    const w = await open(home); app = w.app;
    const { runId, ids } = runWith(w.coord, ['one']);
    const res = await postItems(app, runId, { items: [{ id: ids[0], state: 'done' }] }, null);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
    expect(w.coord.itemTally(runId)).toEqual({ done: 0, total: 1 });
  });

  it('401s on the WRONG box token', async () => {
    const home = mkTmp('ccrc-items-');
    const w = await open(home); app = w.app;
    const { runId, ids } = runWith(w.coord, ['one']);
    const res = await postItems(app, runId, { items: [{ id: ids[0], state: 'done' }] }, 'e'.repeat(64));
    expect(res.statusCode).toBe(401);
    expect(w.coord.itemTally(runId)).toEqual({ done: 0, total: 1 });
  });

  it('501 not-configured without a coord store', async () => {
    const home = mkTmp('ccrc-items-');
    app = await buildServer(testDeps(home));   // no `coord` key at all
    const res = await postItems(app, 1, { items: [{ id: 1, state: 'done' }] });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
  });

  it('marks the named items and answers the fresh tally', async () => {
    const home = mkTmp('ccrc-items-');
    const w = await open(home); app = w.app;
    const { runId, ids } = runWith(w.coord, ['one', 'two', 'three']);
    const res = await postItems(app, runId, { items: [
      { id: ids[0], state: 'done', claimedBy: 'ccrc-pwa-amber-harbor' },
      { id: ids[1], state: 'claimed' },
    ] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, id: runId, items: { done: 1, total: 3 } });
    expect(w.coord.workItems(runId).map((i) => [i.state, i.claimedBy])).toEqual([
      ['done', 'ccrc-pwa-amber-harbor'], ['claimed', null], ['pending', null],
    ]);
  });

  it('404 unknown-run', async () => {
    const home = mkTmp('ccrc-items-');
    const w = await open(home); app = w.app;
    const res = await postItems(app, 4242, { items: [{ id: 1, state: 'done' }] });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: 'unknown-run' });
  });

  it('400 bad-request on a non-integer :id', async () => {
    const home = mkTmp('ccrc-items-');
    const w = await open(home); app = w.app;
    const res = await app.inject({ method: 'POST', url: '/api/runs/not-a-number/items',
      headers: { 'x-ccrc-mail-token': TOKEN }, payload: { items: [{ id: 1, state: 'done' }] } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
  });

  it('404 unknown-item, naming the id, for an item of a DIFFERENT run', async () => {
    const home = mkTmp('ccrc-items-');
    const w = await open(home); app = w.app;
    const mine = runWith(w.coord, ['one']);
    const theirs = runWith(w.coord, ['not yours'], { wave: 2 });
    const res = await postItems(app, mine.runId, { items: [{ id: theirs.ids[0], state: 'done' }] });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, refused: 'unknown-item', itemId: theirs.ids[0] });
    // The other run is UNTOUCHED — the whole point of the run-scoped signature.
    expect(w.coord.itemTally(theirs.runId)).toEqual({ done: 0, total: 1 });
    expect(w.coord.workItems(theirs.runId)[0]).toMatchObject({ state: 'pending' });
  });

  it('409 item-terminal, naming the id and the state it is already in', async () => {
    const home = mkTmp('ccrc-items-');
    const w = await open(home); app = w.app;
    const { runId, ids } = runWith(w.coord, ['one', 'two']);
    w.coord.setWorkItemState(runId, ids[0]!, 'failed', null);
    const res = await postItems(app, runId, { items: [{ id: ids[0], state: 'done' }] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'item-terminal', itemId: ids[0], state: 'failed' });
    expect(w.coord.workItems(runId)[0]).toMatchObject({ state: 'failed' });
  });

  it('settles NOTHING when one id in the batch is bad — all-or-nothing', async () => {
    const home = mkTmp('ccrc-items-');
    const w = await open(home); app = w.app;
    const { runId, ids } = runWith(w.coord, ['one', 'two', 'three']);
    const res = await postItems(app, runId, { items: [
      { id: ids[0], state: 'done' },
      { id: 9999, state: 'done' },
      { id: ids[1], state: 'done' },
    ] });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ refused: 'unknown-item', itemId: 9999 });
    expect(w.coord.itemTally(runId)).toEqual({ done: 0, total: 3 });
    expect(w.coord.workItems(runId).every((i) => i.state === 'pending')).toBe(true);
  });

  it('settles nothing when the same id appears twice and the first settle is terminal', async () => {
    const home = mkTmp('ccrc-items-');
    const w = await open(home); app = w.app;
    const { runId, ids } = runWith(w.coord, ['one', 'two']);
    const res = await postItems(app, runId, { items: [
      { id: ids[0], state: 'done' },
      { id: ids[0], state: 'failed' },
    ] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ refused: 'item-terminal', itemId: ids[0], state: 'done' });
    expect(w.coord.itemTally(runId)).toEqual({ done: 0, total: 2 });
    expect(w.coord.workItems(runId).every((i) => i.state === 'pending')).toBe(true);
  });

  it('400 bad-request on a missing items array, a non-integer id, or an unknown state', async () => {
    const home = mkTmp('ccrc-items-');
    const w = await open(home); app = w.app;
    const { runId, ids } = runWith(w.coord, ['one']);
    const bodies: unknown[] = [
      {},                                                    // no items at all
      { items: 'done' },                                     // not an array
      { items: [] },                                         // an empty settle asks for nothing
      { items: [{ id: ids[0] }] },                           // no state
      { items: [{ state: 'done' }] },                        // no id
      { items: [{ id: '1', state: 'done' }] },               // a string id
      { items: [{ id: 1.5, state: 'done' }] },               // a non-integer id
      { items: [{ id: ids[0], state: 'finished' }] },        // not a WorkItemState
      { items: [{ id: ids[0], state: 'done', claimedBy: 7 }] },   // claimedBy is a string or nothing
      { items: Array.from({ length: 33 }, () => ({ id: ids[0], state: 'done' })) },   // past WORK_ITEM_MAX
    ];
    for (const body of bodies) {
      const res = await postItems(app, runId, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
    }
    expect(w.coord.workItems(runId)[0]).toMatchObject({ state: 'pending' });
  });

  it('refuses "unknown" as a settle target — a caller cannot ask for the we-do-not-know bucket', async () => {
    // `isWorkItemState` accepts `'unknown'`: it is the READ-side degradation
    // member. A WRITER may not name it, exactly as `isSendableMailKind`
    // refuses it at the mail ingress.
    const home = mkTmp('ccrc-items-');
    const w = await open(home); app = w.app;
    const { runId, ids } = runWith(w.coord, ['one']);
    const res = await postItems(app, runId, { items: [{ id: ids[0], state: 'unknown' }] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
    expect(w.coord.workItems(runId)[0]).toMatchObject({ state: 'pending' });
  });

  it('leaves an ABANDONED run\'s items exactly where they were: 3/7 stays 3/7', async () => {
    // Spec §3.4: closing a run leaves its items exactly as they were — the
    // record is the point. The route neither reads the run's state nor
    // rewrites its ledger on close.
    const home = mkTmp('ccrc-items-');
    const w = await open(home); app = w.app;
    const { runId, ids } = runWith(w.coord, ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    const settled = await postItems(app, runId, {
      items: ids.slice(0, 3).map((id) => ({ id, state: 'done' })),
    });
    expect(settled.statusCode).toBe(200);
    expect(settled.json()).toMatchObject({ items: { done: 3, total: 7 } });
    w.coord.advance(runId, 'failed', 'operator');            // planned -> failed, an abandon
    expect(w.coord.run(runId)).toMatchObject({ state: 'failed', items: { done: 3, total: 7 } });
  });
});

describe('items.ts is a decision, not an adapter', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, '..', 'src', 'coord', 'items.ts'), 'utf8');

  it('imports neither ./db.js nor node:sqlite, and never names `coord.db`', () => {
    // D-289 (was D-B4-16): the all-or-nothing COMMIT belongs to the ring that owns
    // `DatabaseSync`'s synchrony invariant. `architecture:78-81` puts
    // `store.ts`/`coord/db.ts` at L3 and allows L1 to import L2 as types
    // only, with "no `node:sqlite`" — every other L1 decision file in this
    // directory (`dispatch.ts`, `close.ts`, `fingerprint.ts`, `prhistory.ts`,
    // `gitref.ts`) already obeys this, and `single-definition.test.ts` scans
    // the whole directory for it.
    expect(src).not.toMatch(/from\s+'\.\/db\.js'/);
    expect(src).not.toMatch(/from\s+'node:sqlite'/);
    expect(src).not.toMatch(/\btx\s*\(/);
    expect(src).not.toMatch(/\bcoord\.db\b/);
  });

  it('performs no fleet act and re-measures nothing — the authorisation happened at /advance', () => {
    expect(src).not.toMatch(/runCcd|verifyDone|CCD_ARGV/);
  });
});
