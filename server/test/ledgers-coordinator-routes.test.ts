// Programme ledgers (plan PL3): the coordinator's routes for operator items and goals. Real server over a fixture
// HOME (`buildServer`, a real `CoordStore`, a recording push sink and a counting bus), neutral names (prog-a, lane-a).
// The order the routes keep is part of what is pinned: box token before the body, body shape, attribution, ownership
// (`claimsProgramme`), the decider, the write, the emit, the answer.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { PushPayload } from '../src/push.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const HEADERS = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
const as = (who = 'lane-a'): { byId: string; byUuid: string } => ({ byId: who, byUuid: `u-${who}` });

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
  removeTmpFixtures();
});

interface Rig {
  app: FastifyInstance; coord: CoordStore; sent: PushPayload[]; waiting: () => number; runA: number; runB: number;
}

/** prog-a is claimed by lane-a, prog-b by lane-b; both sessions are in the registry. */
async function rig(): Promise<Rig> {
  const home = mkTmp('ccrc-ledgers-coord-routes-');
  seedRow(home, 'lane-a');
  seedRow(home, 'lane-b');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const sent: PushPayload[] = [];
  const bus = new Bus();
  let waiting = 0;
  bus.on('waiting', () => { waiting += 1; });
  app = await buildServer(
    { ...testDeps(home, recorder().run), mailToken: ID_GATE_TOKEN, coord, push: { notify: async (p: PushPayload) => { sent.push(p); } } as never },
    bus,
  );
  const open = (program: string, claimedBy: string): number =>
    (coord.openRun({ program, title: program.toUpperCase(), project: 'project-a', wave: 1, waveOf: null, claimedBy }) as { id: number }).id;
  return { app, coord, sent, waiting: () => waiting, runA: open('prog-a', 'lane-a'), runB: open('prog-b', 'lane-b') };
}

const post = (r: Rig, url: string, payload: unknown, headers: Record<string, string> = HEADERS) =>
  r.app.inject({ method: 'POST', url, headers, payload: payload as never });
const get = (r: Rig, url: string, headers: Record<string, string> = HEADERS) => r.app.inject({ method: 'GET', url, headers });

const RAISE = {
  kind: 'do', title: 'Turn on the setting', why: 'The wave needs it.', how: ['Open Settings', 'Switch it on'],
  neededBy: 'soon', soonLabel: 'before wave 6',
};
const raise = async (r: Rig, over: Record<string, unknown> = {}, who = 'lane-a', slug = 'prog-a'): Promise<number> => {
  const res = await post(r, `/api/programmes/${slug}/items`, { ...as(who), ...RAISE, ...over });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { id: number }).id;
};
const stateOf = (r: Rig, id: number): string | undefined => r.coord.itemById(id)?.state;

describe('the box token comes first, before the body and before any await (plan PL3 Step 3)', () => {
  const DOORS: readonly (readonly ['GET' | 'POST', string])[] = [
    ['POST', '/api/programmes/prog-a/items'], ['GET', '/api/programmes/prog-a/items?byId=lane-a&byUuid=u-lane-a'],
    ['POST', '/api/items/1/confirm'], ['POST', '/api/items/1/return'], ['POST', '/api/items/1/withdraw'],
    ['POST', '/api/items/1/blocking'], ['POST', '/api/programmes/prog-a/spec'],
    ['POST', '/api/programmes/prog-a/modifications'], ['POST', '/api/programmes/prog-a/modifications/merged'],
  ];
  it.each(DOORS)('%s %s refuses 401 without the token, whatever the body says', async (method, url) => {
    const r = await rig();
    const res = await r.app.inject({ method, url, payload: method === 'POST' ? { nonsense: true } as never : undefined as never });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
    expect(r.waiting()).toBe(0);
  });

  it('a wrong token refuses 401 too', async () => {
    const r = await rig();
    const res = await post(r, '/api/programmes/prog-a/items', { ...as(), ...RAISE }, { 'x-ccrc-mail-token': 'e'.repeat(64) });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/programmes/:slug/items (plan PL3)', () => {
  it('raises an open item for the programme and says so on the bus once', async () => {
    const r = await rig();
    const id = await raise(r, { runId: r.runA });
    expect(r.coord.itemById(id)).toMatchObject({
      program: 'prog-a', runId: r.runA, raisedBy: 'lane-a', kind: 'do', state: 'open', neededBy: 'soon', soonLabel: 'before wave 6',
      how: ['Open Settings', 'Switch it on'], options: null, secretSlot: null,
    });
    expect(r.waiting()).toBe(1);
    expect(r.sent).toEqual([]);   // soon does not push
  });

  it('refuses stale-uuid after the body is checked, and writes nothing', async () => {
    const r = await rig();
    const res = await post(r, '/api/programmes/prog-a/items', { byId: 'lane-a', byUuid: 'u-someone-else', ...RAISE });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'stale-uuid' });
    expect(r.coord.itemsFor('prog-a', Date.now()).open).toEqual([]);
    expect(r.waiting()).toBe(0);
  });

  it('refuses not-your-programme for a session that claims another programme (Review Focus 4), before any write', async () => {
    const r = await rig();
    const res = await post(r, '/api/programmes/prog-a/items', { ...as('lane-b'), ...RAISE });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-your-programme' });
    expect(r.coord.itemsFor(null, Date.now()).open).toEqual([]);
    expect(r.waiting()).toBe(0);
  });

  it('refuses not-your-programme for a programme nobody has a run of', async () => {
    const r = await rig();
    const res = await post(r, '/api/programmes/prog-z/items', { ...as(), ...RAISE });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'not-your-programme' });
  });

  it('an unrepresentable open run claimed by the caller answers 503 run-unreadable, never a bare 500 (review 1328 F3)', async () => {
    const r = await rig();
    r.coord.db.prepare(
      'INSERT INTO runs (id, program, wave, waveOf, project, state, claimedBy, openedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(4242, 'prog-a', BigInt(Number.MAX_SAFE_INTEGER) + 1n, 3, 'project-a', 'planned', 'lane-a', Date.now());
    const res = await post(r, '/api/programmes/prog-a/items', { ...as(), ...RAISE });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'run-unreadable', detail: expect.stringMatching(/\S/) });
    expect(r.coord.db.prepare('SELECT COUNT(*) AS n FROM operator_items').get()).toEqual({ n: 0 });
    expect(r.waiting()).toBe(0);
  });

  it('a blocking raise pushes once, tagged item-<id> (plan PL3)', async () => {
    const r = await rig();
    const id = await raise(r, { neededBy: 'blocking', soonLabel: null, runId: r.runA });
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ title: 'Waiting on you', body: 'Turn on the setting', tag: `item-${id}` });
  });

  it.each([
    ['a decide item with one option', { kind: 'decide', options: ['only'] }],
    ['a decide item with seven options', { kind: 'decide', options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }],
    ['a decide item with no options', { kind: 'decide' }],
    ['options on a do item', { options: ['a', 'b'] }],
    ['a secret item with no slot', { kind: 'secret' }],
    ['a secret item with a path as its slot', { kind: 'secret', secretSlot: '../x' }],
    ['a secret item with options', { kind: 'secret', secretSlot: 'npm-token', options: ['a', 'b'] }],
    ['a slot on a do item', { secretSlot: 'npm-token' }],
    ['a kind outside the vocabulary', { kind: 'ask' }],
    ['a level outside the vocabulary', { neededBy: 'someday' }],
    ['a soon label over 40 characters', { soonLabel: 'x'.repeat(41) }],
    ['a title over 140 characters', { title: 'x'.repeat(141) }],
    ['an empty title', { title: '' }],
    ['a why over 2000 characters', { why: 'x'.repeat(2001) }],
    ['thirteen steps', { how: Array.from({ length: 13 }, (_, i) => `step ${i}`) }],
    ['how that is not a list', { how: 'open settings' }],
    ['a runId that is not a number', { runId: 'one' }],
  ])('refuses %s with bad-request and writes nothing', async (_name, over) => {
    const r = await rig();
    const res = await post(r, '/api/programmes/prog-a/items', { ...as(), ...RAISE, ...over });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request', detail: expect.stringMatching(/\S/) });
    expect(r.coord.itemsFor('prog-a', Date.now()).open).toEqual([]);
    expect(r.waiting()).toBe(0);
  });

  it('refuses a runId that belongs to another programme', async () => {
    const r = await rig();
    const res = await post(r, '/api/programmes/prog-a/items', { ...as(), ...RAISE, runId: r.runB });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad-request' });
  });

  it('accepts a decide item with two to six options, and a secret item with a slot', async () => {
    const r = await rig();
    const d = await raise(r, { kind: 'decide', options: ['yes', 'no'] });
    const s = await raise(r, { kind: 'secret', secretSlot: 'npm-token' });
    expect(r.coord.itemById(d)).toMatchObject({ kind: 'decide', options: ['yes', 'no'] });
    expect(r.coord.itemById(s)).toMatchObject({ kind: 'secret', secretSlot: 'npm-token', options: null });
  });
});

describe('the item routes act on the caller\'s own programme\'s items (plan PL3)', () => {
  it('refuses a coordinator acting on another programme\'s item with not-your-programme, and moves nothing', async () => {
    const r = await rig();
    const id = await raise(r);
    r.coord.moveItem(id, 'tick', 'operator', { answer: null }, Date.now(), { programmeHasOpenRun: true });
    for (const [verb, body] of [['confirm', {}], ['return', { note: 'no' }], ['withdraw', {}], ['blocking', { blocking: true }]] as const) {
      const res = await post(r, `/api/items/${id}/${verb}`, { ...as('lane-b'), ...body });
      expect(res.statusCode, verb).toBe(403);
      expect(res.json(), verb).toMatchObject({ error: 'not-your-programme' });
    }
    expect(stateOf(r, id)).toBe('checking');
    expect(r.waiting()).toBe(1);   // the raise only
  });

  it('refuses an item that does not exist with unknown-item (404)', async () => {
    const r = await rig();
    const res = await post(r, '/api/items/999/confirm', as());
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'unknown-item' });
  });

  it('a non-numeric item id is a bad-request', async () => {
    const r = await rig();
    const res = await post(r, '/api/items/abc/confirm', as());
    expect(res.statusCode).toBe(400);
  });

  it('an item route answers 503 run-unreadable when the caller\'s run series is unreadable', async () => {
    const r = await rig();
    const id = await raise(r);
    r.coord.db.prepare(
      'INSERT INTO runs (id, program, wave, waveOf, project, state, claimedBy, openedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(4242, 'prog-a', BigInt(Number.MAX_SAFE_INTEGER) + 1n, 3, 'project-a', 'planned', 'lane-a', Date.now());
    const res = await post(r, `/api/items/${id}/withdraw`, as());
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'run-unreadable' });
    expect(stateOf(r, id)).toBe('open');
  });

  it('confirm on an open item is refused not-open (409)', async () => {
    const r = await rig();
    const id = await raise(r);
    const res = await post(r, `/api/items/${id}/confirm`, as());
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'not-open' });
    expect(stateOf(r, id)).toBe('open');
    expect(r.waiting()).toBe(1);
  });

  it('confirm closes a ticked item as done and says so on the bus', async () => {
    const r = await rig();
    const id = await raise(r);
    r.coord.moveItem(id, 'tick', 'operator', { answer: null }, Date.now(), { programmeHasOpenRun: true });
    const res = await post(r, `/api/items/${id}/confirm`, as());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(stateOf(r, id)).toBe('done');
    expect(r.waiting()).toBe(2);
  });

  it('return without a note, with a blank note or with a note over 600 characters is refused', async () => {
    const r = await rig();
    const id = await raise(r);
    r.coord.moveItem(id, 'tick', 'operator', { answer: null }, Date.now(), { programmeHasOpenRun: true });
    for (const note of [undefined, '', '   ', 'x'.repeat(601), 7]) {
      const res = await post(r, `/api/items/${id}/return`, { ...as(), ...(note === undefined ? {} : { note }) });
      expect(res.statusCode, String(note)).toBe(400);
      expect(res.json()).toMatchObject({ error: 'bad-request' });
    }
    expect(stateOf(r, id)).toBe('checking');
  });

  it('return sends a ticked item back open with the coordinator\'s note', async () => {
    const r = await rig();
    const id = await raise(r);
    r.coord.moveItem(id, 'tick', 'operator', { answer: null }, Date.now(), { programmeHasOpenRun: true });
    const res = await post(r, `/api/items/${id}/return`, { ...as(), note: 'The setting still reads off.' });
    expect(res.statusCode).toBe(200);
    expect(r.coord.itemById(id)).toMatchObject({ state: 'open', note: 'The setting still reads off.' });
  });

  it('return on an open item is refused not-open', async () => {
    const r = await rig();
    const id = await raise(r);
    const res = await post(r, `/api/items/${id}/return`, { ...as(), note: 'x' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'not-open' });
  });

  it('withdraw closes an open item as withdrawn, and a second withdraw is refused not-open', async () => {
    const r = await rig();
    const id = await raise(r);
    expect((await post(r, `/api/items/${id}/withdraw`, as())).statusCode).toBe(200);
    expect(stateOf(r, id)).toBe('withdrawn');
    const again = await post(r, `/api/items/${id}/withdraw`, as());
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'not-open' });
  });
});

describe('POST /api/items/:id/blocking (plan PL3, review 1329 F1)', () => {
  it('pushes only on a change to true', async () => {
    const r = await rig();
    const id = await raise(r, { runId: r.runA });
    expect((await post(r, `/api/items/${id}/blocking`, { ...as(), blocking: true })).statusCode).toBe(200);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ title: 'Waiting on you', body: 'Turn on the setting', tag: `item-${id}` });
    // already blocking: ok, no second push
    expect((await post(r, `/api/items/${id}/blocking`, { ...as(), blocking: true })).statusCode).toBe(200);
    expect(r.sent).toHaveLength(1);
    // lowering never pushes
    expect((await post(r, `/api/items/${id}/blocking`, { ...as(), blocking: false })).statusCode).toBe(200);
    expect(r.sent).toHaveLength(1);
    expect(r.coord.itemById(id)?.neededBy).toBe('soon');
  });

  it('a push is not made when the item was raised blocking and blocking:true repeats', async () => {
    const r = await rig();
    const id = await raise(r, { neededBy: 'blocking', soonLabel: null });
    expect(r.sent).toHaveLength(1);
    await post(r, `/api/items/${id}/blocking`, { ...as(), blocking: true });
    expect(r.sent).toHaveLength(1);
  });

  it('block, tick, unblock restores a label-less soon item to soon', async () => {
    const r = await rig();
    const id = await raise(r, { neededBy: 'soon', soonLabel: null });
    expect((await post(r, `/api/items/${id}/blocking`, { ...as(), blocking: true })).statusCode).toBe(200);
    expect(r.coord.itemById(id)?.neededBy).toBe('blocking');
    // the operator's tick lands between: its event is the newest on the item
    const ticked = r.coord.moveItem(id, 'tick', 'operator', { answer: null }, Date.now() + 1, { programmeHasOpenRun: true });
    expect(ticked.ok).toBe(true);
    expect((await post(r, `/api/items/${id}/blocking`, { ...as(), blocking: false })).statusCode).toBe(200);
    expect(r.coord.itemById(id)).toMatchObject({ neededBy: 'soon', state: 'checking' });
  });

  it('refuses a blocking value that is not a boolean, and a closed item (not-open)', async () => {
    const r = await rig();
    const id = await raise(r);
    const bad = await post(r, `/api/items/${id}/blocking`, { ...as(), blocking: 'yes' });
    expect(bad.statusCode).toBe(400);
    await post(r, `/api/items/${id}/withdraw`, as());
    const closed = await post(r, `/api/items/${id}/blocking`, { ...as(), blocking: true });
    expect(closed.statusCode).toBe(409);
    expect(closed.json()).toMatchObject({ error: 'not-open' });
    expect(r.sent).toEqual([]);
  });
});

describe('GET /api/programmes/:slug/items (plan PL3)', () => {
  it('lists the programme\'s waiting and recently cleared items as ItemViews, with their history', async () => {
    const r = await rig();
    const a = await raise(r, { title: 'First' });
    const b = await raise(r, { title: 'Second' });
    await raise(r, { title: 'Other programme' }, 'lane-b', 'prog-b');
    r.coord.moveItem(b, 'tick', 'operator', { answer: null }, Date.now(), { programmeHasOpenRun: true });
    await post(r, `/api/items/${b}/confirm`, as());
    const res = await get(r, '/api/programmes/prog-a/items?byId=lane-a&byUuid=u-lane-a');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true; items: { id: number; title: string; state: string; stale: boolean; secretSet: unknown; history: { act: string }[] }[] };
    expect(body.items.map((i) => [i.id, i.title, i.state])).toEqual([[a, 'First', 'open'], [b, 'Second', 'done']]);
    expect(body.items[0]).toMatchObject({ stale: false, secretSet: null });
    expect(body.items[1]!.history.map((h) => h.act)).toEqual(['raise', 'tick', 'confirm']);
  });

  it('refuses a missing identity (400), a stale uuid (403) and another programme (403)', async () => {
    const r = await rig();
    expect((await get(r, '/api/programmes/prog-a/items')).statusCode).toBe(400);
    const stale = await get(r, '/api/programmes/prog-a/items?byId=lane-a&byUuid=u-someone-else');
    expect(stale.statusCode).toBe(403);
    expect(stale.json()).toMatchObject({ error: 'stale-uuid' });
    const other = await get(r, '/api/programmes/prog-a/items?byId=lane-b&byUuid=u-lane-b');
    expect(other.statusCode).toBe(403);
    expect(other.json()).toMatchObject({ error: 'not-your-programme' });
  });

  it('emits nothing: a read is not a write', async () => {
    const r = await rig();
    await get(r, '/api/programmes/prog-a/items?byId=lane-a&byUuid=u-lane-a');
    expect(r.waiting()).toBe(0);
  });
});

describe('POST /api/programmes/:slug/spec (plan PL3, Review Focus 5)', () => {
  const SPEC = 'docs/superpowers/specs/2026-10-31-x-design.md';
  it('pins the spec with the copy of its In short, and Goals reads it back', async () => {
    const r = await rig();
    const res = await post(r, '/api/programmes/prog-a/spec', { ...as(), specPath: SPEC, inShort: 'What the programme builds.' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(r.coord.goalsFor('prog-a')).toMatchObject({ specPath: SPEC, inShort: 'What the programme builds.' });
    expect(r.waiting()).toBe(1);
  });

  it.each([
    ['a path with ..', 'docs/superpowers/specs/../x.md'],
    ['a plans path', 'docs/superpowers/plans/x.md'],
    ['a leading slash', `/${SPEC}`],
    ['an html file', 'docs/superpowers/specs/x.html'],
    ['no path', undefined],
  ])('refuses %s with bad-spec-path and pins nothing', async (_name, specPath) => {
    const r = await rig();
    const res = await post(r, '/api/programmes/prog-a/spec', { ...as(), ...(specPath === undefined ? {} : { specPath }), inShort: 'ok' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-spec-path' });
    expect(r.coord.goalsFor('prog-a').specPath).toBeNull();
    expect(r.waiting()).toBe(0);
  });

  it.each([['empty', ''], ['blank', '   '], ['over 1200 characters', 'x'.repeat(1201)], ['not a string', 7]])(
    'refuses an In short that is %s with bad-in-short', async (_name, inShort) => {
      const r = await rig();
      const res = await post(r, '/api/programmes/prog-a/spec', { ...as(), specPath: SPEC, inShort });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'bad-in-short' });
      expect(r.coord.goalsFor('prog-a').specPath).toBeNull();
    });

  it('accepts an In short of exactly 1200 characters', async () => {
    const r = await rig();
    expect((await post(r, '/api/programmes/prog-a/spec', { ...as(), specPath: SPEC, inShort: 'x'.repeat(1200) })).statusCode).toBe(200);
  });

  it('refuses a session that does not claim the programme', async () => {
    const r = await rig();
    const res = await post(r, '/api/programmes/prog-a/spec', { ...as('lane-b'), specPath: SPEC, inShort: 'ok' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'not-your-programme' });
    expect(r.coord.goalsFor('prog-a').specPath).toBeNull();
  });
});

describe('modifications (plan PL3)', () => {
  it('records a modification, pending until merged, then marks it merged once', async () => {
    const r = await rig();
    const res = await post(r, '/api/programmes/prog-a/modifications', { ...as(), text: 'Narrowed the scope.', ruling: 'ledger entry 12', pr: 77 });
    expect(res.statusCode).toBe(200);
    const id = (res.json() as { id: number }).id;
    expect(r.coord.goalsFor('prog-a').modifications).toEqual([
      expect.objectContaining({ id, text: 'Narrowed the scope.', ruling: 'ledger entry 12', pr: 77, merged: false }),
    ]);
    const done = await post(r, '/api/programmes/prog-a/modifications/merged', { ...as(), pr: 77 });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({ ok: true, marked: 1 });
    expect(r.coord.goalsFor('prog-a').modifications[0]!.merged).toBe(true);
    const again = await post(r, '/api/programmes/prog-a/modifications/merged', { ...as(), pr: 77 });
    expect(again.json()).toEqual({ ok: true, marked: 0 });
    // the modification and the first merge changed something; the repeat wrote nothing and says nothing
    expect(r.waiting()).toBe(2);
  });

  it('links a modification to an item of the same programme only', async () => {
    const r = await rig();
    const mine = await raise(r);
    const theirs = await raise(r, {}, 'lane-b', 'prog-b');
    const ok = await post(r, '/api/programmes/prog-a/modifications', { ...as(), text: 'Changed.', itemId: mine });
    expect(ok.statusCode).toBe(200);
    const foreign = await post(r, '/api/programmes/prog-a/modifications', { ...as(), text: 'Changed.', itemId: theirs });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json()).toMatchObject({ error: 'not-your-programme' });
    const missing = await post(r, '/api/programmes/prog-a/modifications', { ...as(), text: 'Changed.', itemId: 999 });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: 'unknown-item' });
  });

  it.each([
    ['no text', { text: undefined }], ['blank text', { text: '  ' }], ['text over 2000', { text: 'x'.repeat(2001) }],
    ['a ruling that is not a string', { text: 'ok', ruling: 4 }], ['a ruling over 600', { text: 'ok', ruling: 'x'.repeat(601) }],
    ['a pr of zero', { text: 'ok', pr: 0 }], ['a pr that is not an integer', { text: 'ok', pr: 1.5 }],
    ['an itemId of zero', { text: 'ok', itemId: 0 }],
  ])('refuses %s with bad-request', async (_name, over) => {
    const r = await rig();
    const res = await post(r, '/api/programmes/prog-a/modifications', { ...as(), ...over });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad-request' });
    expect(r.coord.goalsFor('prog-a').modifications).toEqual([]);
    expect(r.waiting()).toBe(0);
  });

  it('merged needs a positive integer pr, and a claimed programme', async () => {
    const r = await rig();
    expect((await post(r, '/api/programmes/prog-a/modifications/merged', { ...as() })).statusCode).toBe(400);
    expect((await post(r, '/api/programmes/prog-a/modifications/merged', { ...as(), pr: -3 })).statusCode).toBe(400);
    const other = await post(r, '/api/programmes/prog-a/modifications/merged', { ...as('lane-b'), pr: 3 });
    expect(other.statusCode).toBe(403);
    expect(other.json()).toMatchObject({ error: 'not-your-programme' });
  });

  it('a modification from a session that does not claim the programme is refused', async () => {
    const r = await rig();
    const res = await post(r, '/api/programmes/prog-a/modifications', { ...as('lane-b'), text: 'Changed.' });
    expect(res.statusCode).toBe(403);
    expect(r.coord.goalsFor('prog-a').modifications).toEqual([]);
  });
});
