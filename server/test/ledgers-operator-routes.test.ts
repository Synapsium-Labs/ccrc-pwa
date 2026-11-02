// Programme ledgers (plan PL4): the operator's routes (tick, dismiss, the waiting list, a programme's goals), the
// tick's mail to the coordinator and the stale label. Real server over a fixture HOME (`buildServer`, a real `CoordStore`,
// a counting bus), neutral names (prog-a, lane-a). The operator's routes take the session gate only: no box token.
//
// Review 1333 F1's carry lives here too: the item routes of `ledgersRoutes.ts` decide ownership (or read the item) and write
// with NO await between, held by a call-order test that goes red when an await is inserted.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { itemMailBody, itemMailSubject } from '../src/coord/ledgersMail.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import {
  ANSWER_MAX, TICK_UNANSWERED_MS, coordinatorPresenceIn, itemIsStale, type CoordinatorPresence, type ItemView, type WaitingView,
} from '../../shared/ledgers.js';
import { LEDGER_ROUTE_REFUSALS, REFUSAL_STATUS } from '../../shared/refusal.js';

let app: FastifyInstance | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
  app = null;
  removeTmpFixtures();
});

interface Rig { app: FastifyInstance; coord: CoordStore; waiting: () => number; runA: number }

/** prog-a is claimed by lane-a (open run), prog-b by lane-b; both sessions are in the registry. */
async function rig(): Promise<Rig> {
  const home = mkTmp('ccrc-ledgers-operator-routes-');
  seedRow(home, 'lane-a');
  seedRow(home, 'lane-b');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const bus = new Bus();
  let waiting = 0;
  bus.on('waiting', () => { waiting += 1; });
  app = await buildServer({ ...testDeps(home, recorder().run), mailToken: ID_GATE_TOKEN, coord }, bus);
  const open = (program: string, claimedBy: string): number =>
    (coord.openRun({ program, title: program.toUpperCase(), project: 'project-a', wave: 1, waveOf: null, claimedBy }) as { id: number }).id;
  const runA = open('prog-a', 'lane-a');
  open('prog-b', 'lane-b');
  return { app, coord, waiting: () => waiting, runA };
}

const NOW0 = Date.UTC(2026, 10, 2, 9, 0, 0);
const raise = (r: Rig, over: Partial<Parameters<CoordStore['raiseItem']>[0]> = {}): number =>
  r.coord.raiseItem({
    program: 'prog-a', runId: r.runA, raisedBy: 'lane-a', kind: 'do', title: 'Turn on the setting', why: 'The wave needs it.',
    how: ['Open Settings', 'Switch it on'], options: null, neededBy: 'soon', soonLabel: 'before wave 6', secretSlot: null, ...over,
  }, NOW0);
const tick = (r: Rig, id: number | string, body?: unknown) =>
  r.app.inject({ method: 'POST', url: `/api/items/${id}/tick`, payload: (body ?? {}) as never });
const dismiss = (r: Rig, id: number | string) => r.app.inject({ method: 'POST', url: `/api/items/${id}/dismiss`, payload: {} as never });
const mailRows = (r: Rig): { fromId: string; toId: string; runId: number | null; kind: string; subject: string; body: string }[] =>
  r.coord.db.prepare(
    "SELECT m.fromId, d.toId, m.runId, m.kind, m.subject, m.body FROM mail m JOIN mail_deliveries d ON d.mailId = m.id WHERE m.fromId = 'operator' ORDER BY m.id",
  ).all() as never;
const closeRuns = (r: Rig, program: string): void => { r.coord.db.prepare("UPDATE runs SET state = 'done' WHERE program = ?").run(program); };
const stateOf = (r: Rig, id: number): string | undefined => r.coord.itemById(id)?.state;

describe('POST /api/items/:id/tick (plan PL4)', () => {
  it('queues exactly one mail to the programme\'s coordinator and moves the item to checking', async () => {
    const r = await rig();
    const id = raise(r);
    const res = await tick(r, id);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { ok: true; item: ItemView };
    expect(body.item).toMatchObject({ id, state: 'checking', stale: false });
    expect(stateOf(r, id)).toBe('checking');
    const mail = mailRows(r);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ fromId: 'operator', toId: 'lane-a', runId: r.runA, kind: 'answer', subject: itemMailSubject(r.coord.itemById(id)!) });
    expect(mail[0]!.body).toContain('no answer: this item takes none');
    expect(mail[0]!.body).toContain(`ccrc-api items confirm|return ${id}`);
    expect(r.waiting()).toBe(1);
  });

  it('a decide tick carries the operator\'s answer in the mail, and keeps it on the item', async () => {
    const r = await rig();
    const id = raise(r, { kind: 'decide', title: 'Which branch', options: ['main', 'release'] });
    const res = await tick(r, id, { answer: 'release' });
    expect(res.statusCode, res.body).toBe(200);
    expect(r.coord.itemById(id)!.answer).toBe('release');
    expect(mailRows(r)[0]!.body).toContain('release');
  });

  it('a second tick is refused not-open and queues nothing (Review Focus 3)', async () => {
    const r = await rig();
    const id = raise(r);
    expect((await tick(r, id)).statusCode).toBe(200);
    const again = await tick(r, id);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ ok: false, error: 'not-open' });
    expect(mailRows(r)).toHaveLength(1);
    expect(r.waiting()).toBe(1);
  });

  it('a tick of a sent-back item whose first mail is still undelivered is refused duplicate, and queues nothing', async () => {
    const r = await rig();
    const id = raise(r);
    expect((await tick(r, id)).statusCode).toBe(200);
    expect(r.coord.moveItem(id, 'return', 'coordinator', { note: 'Not yet.' }, NOW0 + 1, { programmeHasOpenRun: true }).ok).toBe(true);
    const again = await tick(r, id);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ ok: false, error: 'duplicate' });
    expect(stateOf(r, id)).toBe('open');
    expect(mailRows(r)).toHaveLength(1);
  });

  it('a tick after the programme\'s last run closed is refused programme-ended and the item stays open (Review Focus 1)', async () => {
    const r = await rig();
    const id = raise(r);
    closeRuns(r, 'prog-a');
    const res = await tick(r, id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: LEDGER_ROUTE_REFUSALS.programmeEnded });
    expect((res.json() as { detail: string }).detail).toMatch(/dismiss/i);
    expect(stateOf(r, id)).toBe('open');
    expect(mailRows(r)).toEqual([]);
    expect(r.waiting()).toBe(0);
  });

  it('a tick while the programme\'s only open run is unclaimed is refused programme-unclaimed, not programme-ended (review 1328 F2)', async () => {
    const r = await rig();
    const id = raise(r);
    r.coord.db.prepare('UPDATE runs SET claimedBy = NULL WHERE program = ?').run('prog-a');
    const res = await tick(r, id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: LEDGER_ROUTE_REFUSALS.programmeUnclaimed });
    const detail = (res.json() as { detail: string }).detail;
    expect(detail).toMatch(/abandon/i);
    expect(detail).not.toMatch(/dismiss instead/i);
    expect(stateOf(r, id)).toBe('open');
    expect(mailRows(r)).toEqual([]);
  });

  it('a secret item refuses the tick route and nothing is written', async () => {
    const r = await rig();
    const id = raise(r, { kind: 'secret', title: 'Give the key', secretSlot: 'project-a-key' });
    const res = await tick(r, id, { answer: 'anything' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: LEDGER_ROUTE_REFUSALS.useSecretRoute });
    expect(stateOf(r, id)).toBe('open');
    expect(r.coord.itemById(id)!.answer).toBeNull();
    expect(mailRows(r)).toEqual([]);
  });

  it('an answer outside the rules is refused 400 bad-request: over ANSWER_MAX, empty, missing on a value item, given to a do item', async () => {
    const r = await rig();
    const dec = raise(r, { kind: 'decide', title: 'Which branch', options: ['main', 'release'] });
    const val = raise(r, { kind: 'value', title: 'What is the limit' });
    const doo = raise(r, { kind: 'do', title: 'Flip it' });
    const cases: readonly (readonly [number, unknown])[] = [
      [dec, { answer: 'x'.repeat(ANSWER_MAX + 1) }], [dec, {}], [dec, { answer: '   ' }], [val, {}], [val, { answer: 7 }], [doo, { answer: 'yes' }],
    ];
    for (const [id, body] of cases) {
      const res = await tick(r, id, body);
      expect(res.statusCode, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
      expect(stateOf(r, id)).toBe('open');
    }
    expect(mailRows(r)).toEqual([]);
    expect(r.waiting()).toBe(0);
  });

  it('a decide tick takes an answer outside the options when it is a free answer of 1 to ANSWER_MAX characters', async () => {
    const r = await rig();
    const id = raise(r, { kind: 'decide', title: 'Which branch', options: ['main', 'release'] });
    expect((await tick(r, id, { answer: 'x'.repeat(ANSWER_MAX) })).statusCode).toBe(200);
  });

  it('an item that is not there is 404 unknown-item and a bad id is 400', async () => {
    const r = await rig();
    expect((await tick(r, 99999)).statusCode).toBe(404);
    expect((await tick(r, 99999)).json()).toMatchObject({ error: 'unknown-item' });
    expect((await tick(r, 'abc')).statusCode).toBe(400);
  });

  it('takes no box token: a call with none is not refused for the want of one', async () => {
    const r = await rig();
    const id = raise(r);
    const res = await r.app.inject({ method: 'POST', url: `/api/items/${id}/tick`, payload: {} as never });
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /api/items/:id/dismiss (plan PL4)', () => {
  it('is refused programme-live while a run is open, and the item is unchanged', async () => {
    const r = await rig();
    const id = raise(r);
    const res = await dismiss(r, id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'programme-live' });
    expect(stateOf(r, id)).toBe('open');
    expect(r.waiting()).toBe(0);
  });

  it('dismisses an open item once the programme has no open run, and says so on the bus', async () => {
    const r = await rig();
    const id = raise(r);
    closeRuns(r, 'prog-a');
    const res = await dismiss(r, id);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { item: ItemView }).item).toMatchObject({ id, state: 'dismissed' });
    expect(r.waiting()).toBe(1);
    expect((await dismiss(r, id)).json()).toMatchObject({ error: 'not-open' });
  });

  it('a planned run counts as open: the programme is live until it too is closed', async () => {
    const r = await rig();
    const id = raise(r);
    r.coord.db.prepare("UPDATE runs SET state = 'planned' WHERE program = 'prog-a'").run();
    expect((await dismiss(r, id)).statusCode).toBe(409);
  });

  it('an item that is not there is 404', async () => {
    const r = await rig();
    expect((await dismiss(r, 424242)).statusCode).toBe(404);
  });
});

describe('GET /api/waiting and GET /api/programmes/:slug/goals (plan PL4)', () => {
  it('answers every programme\'s open and checking items, the cleared trail and goals for each pinned or itemised programme', async () => {
    const r = await rig();
    const a = raise(r);
    const b = raise(r, { program: 'prog-b', runId: null, raisedBy: 'lane-b', title: 'Pick one' });
    expect((await tick(r, a)).statusCode).toBe(200);
    const res = await r.app.inject({ method: 'GET', url: '/api/waiting' });
    expect(res.statusCode, res.body).toBe(200);
    const w = (res.json() as { ok: true; waiting: WaitingView }).waiting;
    expect(w.items.map((i) => [i.id, i.state]).sort()).toEqual([[a, 'checking'], [b, 'open']]);
    expect(w.cleared).toEqual([]);
    expect(w.goals.map((g) => g.program).sort()).toEqual(['prog-a', 'prog-b']);
  });

  it('a pinned programme with no item still has its goals in the list', async () => {
    const r = await rig();
    r.coord.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-c', 'C', 0, 'active')").run();
    r.coord.setSpecPin('prog-c', 'docs/superpowers/specs/2026-11-01-x-design.md', 'What it builds.', NOW0);
    const w = ((await r.app.inject({ method: 'GET', url: '/api/waiting' })).json() as { waiting: WaitingView }).waiting;
    expect(w.goals.map((g) => g.program)).toContain('prog-c');
  });

  it('serves one programme\'s goals', async () => {
    const r = await rig();
    r.coord.setSpecPin('prog-a', 'docs/superpowers/specs/2026-11-01-x-design.md', 'What it builds.', NOW0);
    const res = await r.app.inject({ method: 'GET', url: '/api/programmes/prog-a/goals' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, goals: { program: 'prog-a', specPath: 'docs/superpowers/specs/2026-11-01-x-design.md', inShort: 'What it builds.' } });
  });

  it('a shaped secret in an item title is masked in the answer (the read joins the masked GET routes)', async () => {
    const r = await rig();
    const key = ['sk', 'ant', 'api03', createHash('sha256').update('x').digest('base64url').repeat(3).slice(0, 95)].join('-');
    raise(r, { title: `Use ${key} now` });
    const res = await r.app.inject({ method: 'GET', url: '/api/waiting' });
    expect(res.body).not.toContain(key.slice(8, 40));
  });
});

describe('the tick mail (plan PL4)', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    id: 7, program: 'prog-a', runId: 3, raisedBy: 'lane-a', kind: 'do', title: 'T'.repeat(200), why: 'w', how: [], options: null,
    neededBy: 'soon', soonLabel: null, secretSlot: null, state: 'checking', answer: null, note: null, raisedAt: 1, tickedAt: 2, closedAt: null, ...over,
  }) as never;
  it('the subject is "done: item <id>: " and the title cut to 80 characters', () => {
    expect(itemMailSubject(item())).toBe(`done: item 7: ${'T'.repeat(80)}`);
  });
  it('the body names the item, the answer or that none is taken, and the re-measure line', () => {
    const none = itemMailBody(item(), null);
    expect(none).toContain('no answer: this item takes none');
    expect(none).toContain('Re-measure before you confirm; return it with what you found if it does not hold. ccrc-api items confirm|return 7');
    expect(itemMailBody(item({ kind: 'value', answer: 'forty' }), 'forty')).toContain('forty');
  });
});

describe('ItemView.stale: a pure decider in the shared vocabulary (plan PL4, review 1331 A3)', () => {
  const base = { state: 'checking', tickedAt: NOW0, now: NOW0 + TICK_UNANSWERED_MS, mail: 'queued', coordinator: 'alive' } as const;
  it('thirty minutes is the named constant', () => { expect(TICK_UNANSWERED_MS).toBe(30 * 60 * 1000); });
  it('a freshly ticked item with its mail still queued is not stale', () => {
    expect(itemIsStale({ ...base, now: NOW0 + TICK_UNANSWERED_MS - 1 })).toBe(false);
  });
  it('a tick whose mail is still undelivered thirty minutes on is stale', () => {
    expect(itemIsStale(base)).toBe(true);
    expect(itemIsStale({ ...base, mail: 'rejected' })).toBe(true);
  });
  it('a delivered, acked or unknown mail is not stale on its own', () => {
    for (const mail of ['delivered', 'acked', 'unknown', 'none'] as const) expect(itemIsStale({ ...base, mail })).toBe(false);
  });
  it('a dead or absent coordinator is stale at once, with the mail delivered', () => {
    for (const coordinator of ['dead', 'absent'] as const) {
      expect(itemIsStale({ ...base, now: NOW0 + 1, mail: 'delivered', coordinator })).toBe(true);
    }
  });
  it('a coordinator that could not be measured says nothing', () => {
    expect(itemIsStale({ ...base, now: NOW0 + 1, mail: 'delivered', coordinator: 'unmeasured' })).toBe(false);
  });
  it('an open item is never stale, whatever the rest says', () => {
    for (const state of ['open', 'done', 'withdrawn', 'dismissed'] as const) {
      expect(itemIsStale({ ...base, state, coordinator: 'dead' })).toBe(false);
    }
  });
  it('reads the coordinator\'s presence from the fleet: absent when not listed, dead when presence says so, unmeasured with no fleet', () => {
    const fleet = [{ id: 'lane-a', presence: 'alive' }, { id: 'lane-b', presence: 'dead' }, { id: 'lane-c', presence: 'asleep' }, { id: 'lane-d', presence: 'unknown' }, { id: 'lane-e' }] as never;
    const read = (id: string): CoordinatorPresence => coordinatorPresenceIn(fleet, id);
    expect([read('lane-a'), read('lane-b'), read('lane-c'), read('lane-d'), read('lane-e'), read('lane-z')])
      .toEqual(['alive', 'dead', 'alive', 'unmeasured', 'unmeasured', 'absent']);
    expect(coordinatorPresenceIn(null, 'lane-a')).toBe('unmeasured');
  });
  it('a route labels a checking item stale when its tick\'s mail is still queued thirty minutes on', async () => {
    const r = await rig();
    const id = raise(r);
    vi.spyOn(Date, 'now').mockReturnValue(NOW0);
    expect((await tick(r, id)).statusCode).toBe(200);
    const read = async (): Promise<ItemView> =>
      ((await r.app.inject({ method: 'GET', url: '/api/waiting' })).json() as { waiting: WaitingView }).waiting.items[0]!;
    expect((await read()).stale).toBe(false);
    vi.spyOn(Date, 'now').mockReturnValue(NOW0 + TICK_UNANSWERED_MS);
    expect((await read()).stale).toBe(true);
  });
});

describe('the operator\'s statuses are declared once, in the refusal table (plan PL4)', () => {
  it('programme-ended and programme-unclaimed are 409, use-secret-route is declared', () => {
    expect(REFUSAL_STATUS[LEDGER_ROUTE_REFUSALS.programmeEnded]).toBe(409);
    expect(REFUSAL_STATUS[LEDGER_ROUTE_REFUSALS.programmeUnclaimed]).toBe(409);
    expect(REFUSAL_STATUS[LEDGER_ROUTE_REFUSALS.useSecretRoute]).toBe(409);
  });
});

describe('review 1333 F1: no await between the item read and the write, in each item route (plan PL4)', () => {
  // A call-order pin, not a text scan: the first read of the item queues a microtask, and the route's write must run BEFORE it.
  // An `await` anywhere between the read and the write lets the queued microtask in first, so the order flips.
  const HEADERS = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
  const by = { byId: 'lane-a', byUuid: 'u-lane-a' };
  type Door = readonly [string, (id: number) => { url: string; payload: Record<string, unknown>; headers?: Record<string, string> }];
  const DOORS: readonly Door[] = [
    ['confirm (coordinator)', (id) => ({ url: `/api/items/${id}/confirm`, payload: by, headers: HEADERS })],
    ['return (coordinator)', (id) => ({ url: `/api/items/${id}/return`, payload: { ...by, note: 'Not yet.' }, headers: HEADERS })],
    ['withdraw (coordinator)', (id) => ({ url: `/api/items/${id}/withdraw`, payload: by, headers: HEADERS })],
    ['blocking (coordinator)', (id) => ({ url: `/api/items/${id}/blocking`, payload: { ...by, blocking: true }, headers: HEADERS })],
    ['tick (operator)', (id) => ({ url: `/api/items/${id}/tick`, payload: {} })],
    ['dismiss (operator)', (id) => ({ url: `/api/items/${id}/dismiss`, payload: {} })],
  ];
  it.each(DOORS)('%s writes before a microtask queued at its first item read', async (name, door) => {
    const r = await rig();
    const id = raise(r);
    // The confirm and return routes need a checking item; the rest take an open one. The dismiss needs no open run.
    if (name.startsWith('confirm') || name.startsWith('return')) {
      expect(r.coord.moveItem(id, 'tick', 'operator', { answer: null }, NOW0, { programmeHasOpenRun: true }).ok).toBe(true);
    }
    if (name.startsWith('dismiss')) closeRuns(r, 'prog-a');
    const order: string[] = [];
    const store = r.coord as unknown as Record<string, (...a: unknown[]) => unknown>;
    let queued = false;
    const read = store['itemById']!.bind(r.coord);
    vi.spyOn(r.coord, 'itemById').mockImplementation(((...a: unknown[]) => {
      if (!queued) { queued = true; queueMicrotask(() => { order.push('microtask'); }); }
      return read(...a);
    }) as never);
    for (const write of ['moveItem', 'setBlocking', 'tickWithMail'] as const) {
      const real = store[write]!.bind(r.coord);
      vi.spyOn(r.coord, write).mockImplementation(((...a: unknown[]) => { order.push('write'); return real(...a); }) as never);
    }
    const { url, payload, headers } = door(id);
    const res = await r.app.inject({ method: 'POST', url, payload: payload as never, ...(headers ? { headers } : {}) });
    expect(res.statusCode, res.body).toBe(200);
    expect(order.filter((x) => x === 'write'), `${name} made one write`).toHaveLength(1);
    expect(order[0], `${name}: an await sits between the item read and the write (the microtask ran first: ${order.join(', ')})`).toBe('write');
  });
});
