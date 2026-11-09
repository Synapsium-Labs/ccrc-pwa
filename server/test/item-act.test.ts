// D-8076 (spec 2026-11-04 §10, A23): `POST /api/items/:id/act` and `/decline`, the operator's two controls on an end-run item.
// Real server over a fixture HOME and a real store; neutral names (prog-a, lane-a, worker-a). The act runs the abandon arm
// inside the coordMutex hold and answers as the abandon route does; the decline keeps the run and tells the asker.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const HEADERS = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
const as = (who: string): { byId: string; byUuid: string } => ({ byId: who, byUuid: `u-${who}` });

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
  removeTmpFixtures();
});

interface Rig { app: FastifyInstance; coord: CoordStore; run: number; planned: number; calls: string[][] }

/** prog-a is claimed by lane-a. Run `run` is working with worker-a; `planned` is a second, planned run with no session. */
async function rig(): Promise<Rig> {
  const home = mkTmp('ccrc-item-act-');
  for (const id of ['lane-a', 'worker-a']) seedRow(home, id, { project: 'project-a' });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const rec = recorder();
  app = await buildServer({ ...testDeps(home, rec.run), mailToken: ID_GATE_TOKEN, coord }, new Bus());
  const open = (wave: number): number =>
    (coord.openRun({ program: 'prog-a', title: 'Prog A', project: 'project-a', wave, waveOf: 3, claimedBy: 'lane-a' }) as { id: number }).id;
  const run = open(1);
  coord.markDispatched(run, 'worker-a', 'worker-a', 'ws/worker-a', false);
  coord.advance(run, 'dispatched', 'coordinator');
  coord.advance(run, 'working', 'coordinator');
  const planned = open(2);
  return { app, coord, run, planned, calls: rec.calls as string[][] };
}

const ask = async (r: Rig, runId: number, who: string): Promise<number> => {
  const res = await r.app.inject({ method: 'POST', url: `/api/runs/${runId}/end-request`, headers: HEADERS, payload: { ...as(who), why: 'It can never finish.' } });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { id: number }).id;
};
const act = (r: Rig, id: number | string, body?: unknown) =>
  r.app.inject({ method: 'POST', url: `/api/items/${id}/act`, ...(body === undefined ? {} : { payload: body as never }) });
const decline = (r: Rig, id: number | string) => r.app.inject({ method: 'POST', url: `/api/items/${id}/decline` });
const eventsOf = (r: Rig, runId: number) =>
  r.coord.db.prepare('SELECT fromState, toState, causedBy, detail FROM run_events WHERE runId = ? ORDER BY id').all(runId) as
    { fromState: string; toState: string; causedBy: string; detail: string | null }[];
const mailsTo = (r: Rig, to: string) =>
  r.coord.db.prepare('SELECT fromId, toId, subject, body FROM mail WHERE toId = ? ORDER BY id').all(to) as { fromId: string; toId: string; subject: string; body: string }[];

describe('POST /api/items/:id/act', () => {
  it('runs inside the coordMutex hold: the handler reaches the abandon arm only through withAbandon', () => {
    const src = readFileSync(path.resolve(__dirname, '../src/coord/ledgersRoutes.ts'), 'utf8');
    const at = src.indexOf("app.post('/api/items/:id/act'");
    expect(at, 'the act route moved or was renamed').toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf("app.post('/api/items/:id/decline'", at));
    expect(body).toContain('withAbandon(');
    expect(body).not.toContain('requireMailToken');
  });

  it('writes abandon:requested:<item> as the operator, and closes the item', async () => {
    const r = await rig();
    const id = await ask(r, r.planned, 'lane-a');
    const res = await act(r, id);
    expect(res.statusCode, res.body).toBe(200);
    const last = eventsOf(r, r.planned).at(-1)!;
    expect(last).toMatchObject({ toState: 'failed', causedBy: 'operator', detail: `abandon:requested:${id}` });
    expect(r.coord.itemById(id)!.state).toBe('done');
    expect(r.coord.itemHistory(id).at(-1)).toMatchObject({ act: 'act', actor: 'operator' });
  });

  it('answers as the abandon route does, childReclaim included', async () => {
    const r = await rig();
    const id = await ask(r, r.run, 'lane-a');
    const sibling = (await r.app.inject({ method: 'POST', url: `/api/runs/${r.planned}/abandon` })).json() as Record<string, unknown>;
    const res = await act(r, id);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(Object.keys(sibling).sort());
    expect(body).toMatchObject({ ok: true, id: r.run, childReclaim: expect.stringMatching(/queued|not-queued/) });
    expect(r.coord.itemById(id)!.state).toBe('done');
  });

  it("abandoning a programme's last open run closes its own item (the tick would have been refused)", async () => {
    const r = await rig();
    expect((await r.app.inject({ method: 'POST', url: `/api/runs/${r.run}/abandon` })).statusCode).toBe(200);
    r.coord.db.prepare("UPDATE runs SET state = 'failed' WHERE id = ?").run(r.run);
    const id = await ask(r, r.planned, 'lane-a');
    expect(r.coord.programmeHasOpenRun('prog-a')).toBe(true);
    expect((await act(r, id)).statusCode).toBe(200);
    expect(r.coord.programmeHasOpenRun('prog-a')).toBe(false);
    expect(r.coord.itemById(id)!.state).toBe('done');
  });

  it('an already-closed run closes the item with its note and is success', async () => {
    const r = await rig();
    const id = await ask(r, r.planned, 'lane-a');
    r.coord.db.prepare("UPDATE runs SET state = 'failed' WHERE id = ?").run(r.planned);
    const res = await act(r, id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, id: r.planned, state: 'failed' });
    const item = r.coord.itemById(id)!;
    expect(item.state).toBe('done');
    expect(r.coord.itemHistory(id).at(-1)!.note).toBe('The run had already closed.');
  });

  it('a death between the two steps is mended on the next read', async () => {
    const r = await rig();
    const id = await ask(r, r.planned, 'lane-a');
    // The abandon committed, the server died before the item moved.
    r.coord.advance(r.planned, 'failed', 'operator', `abandon:requested:${id}`);
    expect(r.coord.itemById(id)!.state).toBe('open');
    const read = await r.app.inject({ method: 'GET', url: '/api/waiting' });
    expect(read.statusCode).toBe(200);
    expect(r.coord.itemById(id)!.state).toBe('done');
    expect((read.json() as { waiting: { items: { id: number }[] } }).waiting.items.map((i) => i.id)).not.toContain(id);
  });

  it('refuses an item that is not open, an unknown item, an item with no action, and a held item', async () => {
    const r = await rig();
    expect((await act(r, 99999)).statusCode).toBe(404);
    expect((await act(r, 'abc')).statusCode).toBe(400);
    const plain = r.coord.raiseItem({
      program: 'prog-a', runId: r.run, raisedBy: 'lane-a', kind: 'do', title: 'Plain', why: 'Why.', how: ['Do it'], options: null,
      neededBy: 'soon', soonLabel: null, secretSlot: null,
    }, Date.now());
    const noAction = await act(r, plain);
    expect(noAction.statusCode).toBe(409);
    expect(noAction.json()).toMatchObject({ ok: false, error: 'not-open' });
    expect(r.coord.itemById(plain)!.state).toBe('open');
    const held = await ask(r, r.run, 'worker-a');
    expect(r.coord.itemById(held)!.heldUntil).not.toBeNull();
    expect((await act(r, held)).statusCode).toBe(409);
    expect(r.coord.run(r.run)).toMatchObject({ run: { state: 'working' } });
    const id = await ask(r, r.planned, 'lane-a');
    expect((await act(r, id)).statusCode).toBe(200);
    const again = await act(r, id);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'not-open' });
  });

  it('an act-time refusal leaves the item raised', async () => {
    const r = await rig();
    const id = await ask(r, r.planned, 'lane-a');
    r.coord.db.prepare("UPDATE runs SET state = 'closing' WHERE id = ?").run(r.planned);
    const res = await act(r, id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-transition' });
    expect(r.coord.itemById(id)!.state).toBe('open');
  });

  it('reads no body, and is not a box-token lane', async () => {
    const r = await rig();
    const id = await ask(r, r.planned, 'lane-a');
    // A body naming another run, an intent or an archive is not read.
    const res = await act(r, id, { runId: r.run, intent: 'archive', archive: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(r.coord.run(r.run)).toMatchObject({ run: { state: 'working' } });
  });
});

describe('POST /api/items/:id/decline', () => {
  it("moves the item to dismissed, keeps the run, and mails the asker in the move's transaction", async () => {
    const r = await rig();
    const id = await ask(r, r.run, 'worker-a');
    r.coord.db.prepare('UPDATE operator_items SET heldUntil = NULL WHERE id = ?').run(id);
    const res = await decline(r, id);
    expect(res.statusCode, res.body).toBe(200);
    expect(r.coord.itemById(id)!.state).toBe('dismissed');
    expect(r.coord.itemHistory(id).at(-1)).toMatchObject({ act: 'decline', actor: 'operator' });
    expect(r.coord.run(r.run)).toMatchObject({ run: { state: 'working' } });
    const told = mailsTo(r, 'worker-a');
    expect(told).toHaveLength(1);
    expect(told[0]!.body).toContain('declined');
  });

  it("a coordinator's own request is declined and the coordinator, as the asker, is told", async () => {
    const r = await rig();
    const id = await ask(r, r.planned, 'lane-a');
    expect((await decline(r, id)).statusCode).toBe(200);
    expect(mailsTo(r, 'lane-a')).toHaveLength(1);
  });

  it('refuses a held item, a plain item, an unknown one and a second decline', async () => {
    const r = await rig();
    const held = await ask(r, r.run, 'worker-a');
    expect((await decline(r, held)).statusCode).toBe(409);
    const plain = r.coord.raiseItem({
      program: 'prog-a', runId: r.run, raisedBy: 'lane-a', kind: 'do', title: 'Plain', why: 'Why.', how: ['Do it'], options: null,
      neededBy: 'soon', soonLabel: null, secretSlot: null,
    }, Date.now());
    expect((await decline(r, plain)).statusCode).toBe(409);
    expect((await decline(r, 99999)).statusCode).toBe(404);
    const id = await ask(r, r.planned, 'lane-a');
    expect((await decline(r, id)).statusCode).toBe(200);
    expect((await decline(r, id)).json()).toMatchObject({ error: 'not-open' });
  });
});
