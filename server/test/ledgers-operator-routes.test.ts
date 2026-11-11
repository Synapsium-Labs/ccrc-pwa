// Programme ledgers (plan PL4): the operator's routes (tick, dismiss, the waiting list, a programme's goals), the
// tick's mail to the coordinator and the stale label. Real server over a fixture HOME (`buildServer`, a real `CoordStore`,
// a counting bus), neutral names (prog-a, lane-a). The operator's routes take the session gate only: no box token.
//
// Review 1333 F1's carry lives here too: the item routes of `ledgersRoutes.ts` decide ownership (or read the item) and write
// with NO await between, held by a call-order test that goes red when an await is inserted.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { goalsReadOf } from '../src/coord/ledgersRoutes.js';
import { itemMailBody, itemMailSubject, tickMail } from '../src/coord/ledgersMail.js';
import { FleetWatcher } from '../src/watch.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import {
  ANSWER_MAX, TICK_UNANSWERED_MS, coordinatorPresenceIn, itemIsStale, type CoordinatorPresence, type ItemView, type WaitingView,
} from '../../shared/ledgers.js';
import { LEDGER_ROUTE_REFUSALS, REFUSAL_STATUS } from '../../shared/refusal.js';
import type { GoalsRead } from '../../shared/ledgers.js';
import { MAIL_BODY_MAX_BYTES, MAIL_SUBJECT_MAX_BYTES, SECRET_MASK } from '../../shared/api.js';

let app: FastifyInstance | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
  app = null;
  removeTmpFixtures();
});

interface Rig { app: FastifyInstance; coord: CoordStore; waiting: () => number; runA: number; bus: Bus }

/** What the server's watcher last measured, for the stale label's presence input: the fleet frame it last broadcast (`null`
 *  before the first) and the registry ids of its last good listing, refused ids included (`null` before one). A stub with
 *  only these two readers, over the real class's prototype, so a method the server calls on it that the stub lacks fails loudly. */
interface Watched { fleet: { id: string; presence?: string }[] | null; registryIds: string[] | null }
const stubWatcher = (w: Watched): FleetWatcher => Object.assign(Object.create(FleetWatcher.prototype) as FleetWatcher, {
  currentFleet: () => w.fleet, currentRegistryIds: () => (w.registryIds === null ? null : new Set(w.registryIds)),
  currentCoord: () => null, currentPools: () => null, currentDelegation: () => null, currentStallQuietMs: () => null, inFlight: () => null, serverCapsSettled: async () => undefined, stop: () => undefined,
}) as FleetWatcher;

/** prog-a is claimed by lane-a (open run), prog-b by lane-b; both sessions are in the registry. */
async function rig(watched?: Watched): Promise<Rig> {
  const home = mkTmp('ccrc-ledgers-operator-routes-');
  seedRow(home, 'lane-a');
  seedRow(home, 'lane-b');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const bus = new Bus();
  let waiting = 0;
  bus.on('waiting', () => { waiting += 1; });
  app = await buildServer({ ...testDeps(home, recorder().run), mailToken: ID_GATE_TOKEN, coord }, bus, watched === undefined ? undefined : stubWatcher(watched));
  const open = (program: string, claimedBy: string): number =>
    (coord.openRun({ program, title: program.toUpperCase(), project: 'project-a', wave: 1, waveOf: null, claimedBy }) as { id: number }).id;
  const runA = open('prog-a', 'lane-a');
  open('prog-b', 'lane-b');
  return { app, coord, waiting: () => waiting, runA, bus };
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
    expect(mail[0]).toMatchObject({ fromId: 'operator', toId: 'lane-a', runId: null, kind: 'answer', subject: itemMailSubject(r.coord.itemById(id)!) });
    expect(mail[0]!.body).toContain('no answer: this item takes none');
    expect(mail[0]!.body).toContain(`ccrc-api items confirm|return ${id}`);
    expect(r.waiting()).toBe(1);
  });

  it('a decide tick carries the operator\'s answer in the mail, and keeps it on the item', async () => {
    const r = await rig();
    const id = raise(r, { kind: 'decide', title: 'Which branch', options: ['main', 'release'], recommended: 0, recommendedWhy: 'Main is what ships.' });
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
    const dec = raise(r, { kind: 'decide', title: 'Which branch', options: ['main', 'release'], recommended: 0, recommendedWhy: 'Main is what ships.' });
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
    const id = raise(r, { kind: 'decide', title: 'Which branch', options: ['main', 'release'], recommended: 0, recommendedWhy: 'Main is what ships.' });
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
    r.coord.setSpecPin('prog-c', 'docs/superpowers/specs/2026-11-01-x-design.md', 'What it builds.', NOW0, null);
    const w = ((await r.app.inject({ method: 'GET', url: '/api/waiting' })).json() as { waiting: WaitingView }).waiting;
    expect(w.goals.map((g) => g.program)).toContain('prog-c');
  });

  it('serves one programme\'s goals', async () => {
    const r = await rig();
    r.coord.setSpecPin('prog-a', 'docs/superpowers/specs/2026-11-01-x-design.md', 'What it builds.', NOW0, null);
    const res = await r.app.inject({ method: 'GET', url: '/api/programmes/prog-a/goals' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, goals: { program: 'prog-a', specPath: 'docs/superpowers/specs/2026-11-01-x-design.md', inShort: 'What it builds.' } });
  });

  it('the read answers the goals and the programme\'s open items, and nothing else of an item (the goals-read-v1 shape)', async () => {
    const r = await rig();
    r.coord.setSpecPin('prog-a', 'docs/superpowers/specs/2026-11-01-x-design.md', 'What it builds.', NOW0, ['It ships.']);
    const open = raise(r, { kind: 'decide', title: 'Which branch', options: ['main', 'release'], recommended: 0, recommendedWhy: 'Main ships.', neededBy: 'blocking' });
    raise(r, { program: 'prog-b', runId: null, raisedBy: 'lane-b', title: 'Another programme' });
    const body = (await r.app.inject({ method: 'GET', url: '/api/programmes/prog-a/goals' })).json() as { ok: true; goals: unknown } & GoalsRead;
    expect(Object.keys(body).sort()).toEqual(['goals', 'ok', 'openItems']);
    expect(body.goals).toMatchObject({ program: 'prog-a', doneWhen: ['It ships.'] });
    expect(body.openItems).toEqual([{ id: open, kind: 'decide', title: 'Which branch', neededBy: 'blocking' }]);
    expect(Object.keys(body.openItems[0]!).sort()).toEqual(['id', 'kind', 'neededBy', 'title']);
  });

  it('an item that is cleared, or belongs to another programme, is not an open item', async () => {
    const r = await rig();
    const id = raise(r);
    expect(r.coord.moveItem(id, 'withdraw', 'coordinator', {}, NOW0 + 1, { programmeHasOpenRun: true }).ok).toBe(true);
    const body = (await r.app.inject({ method: 'GET', url: '/api/programmes/prog-a/goals' })).json() as GoalsRead;
    expect(body.openItems).toEqual([]);
  });

  it('goalsReadOf carries only goals and openItems; a secret item shows no slot and no why/how/answer/note (F1)', async () => {
    const r = await rig();
    raise(r, { kind: 'secret', title: 'A key', secretSlot: 'slot-a', why: 'private why', how: ['private how'] });
    const read = goalsReadOf(r.coord, 'prog-a', NOW0);
    expect(Object.keys(read).sort()).toEqual(['goals', 'openItems']);
    const text = JSON.stringify(read);
    for (const word of ['private why', 'private how', 'slot-a', 'secretSlot', 'answer', 'note']) expect(text).not.toContain(word);
  });
  it('a shaped secret in an item title is masked in the answer (the read joins the masked GET routes)', async () => {
    const r = await rig();
    const key = ['sk', 'ant', 'api03', createHash('sha256').update('x').digest('base64url').repeat(3).slice(0, 95)].join('-');
    raise(r, { title: `Use ${key} now` });
    const res = await r.app.inject({ method: 'GET', url: '/api/waiting' });
    expect(res.body).not.toContain(key.slice(8, 40));
    expect(res.body).toContain(SECRET_MASK);
  });
});

const PASS = 'correct horse battery staple';
const FAST: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const BOX = 'e'.repeat(64);

async function armed(): Promise<{ app: FastifyInstance; coord: CoordStore }> {
  const home = mkTmp('ccrc-ledgers-goals-armed-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASS, FAST, 1)}\n`, { mode: 0o600 });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, recorder().run);
  app = await buildServer({ ...base, cfg: { ...base.cfg, authEnabled: true }, mailToken: BOX, coord });
  coord.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 'A', 0, 'active')").run();
  coord.setSpecPin('prog-a', 'docs/superpowers/specs/2026-11-01-x-design.md', 'What it builds.', NOW0, ['It ships.']);
  return { app, coord };
}

// D-8194: an item opened by its id (a link in another item's text, a page kept open) still opens after it has left the 48-hour
// Recently cleared window, read-only, because the console can read it by its id whatever its state and age.
describe('GET /api/items/:id (D-8194)', () => {
  const read = (r: Rig, id: number | string) => r.app.inject({ method: 'GET', url: `/api/items/${id}` });

  it('answers an item that left the Recently cleared window, with its state and history', async () => {
    const r = await rig();
    const id = raise(r);
    expect(r.coord.moveItem(id, 'tick', 'operator', { answer: null }, NOW0 + 1, { programmeHasOpenRun: true }).ok).toBe(true);
    expect(r.coord.moveItem(id, 'confirm', 'coordinator', {}, NOW0 + 2, { programmeHasOpenRun: true }).ok).toBe(true);
    // Cleared days before the server's clock: the list no longer carries it.
    const w = ((await r.app.inject({ method: 'GET', url: '/api/waiting' })).json() as { waiting: WaitingView }).waiting;
    expect(w.cleared.map((i) => i.id)).not.toContain(id);
    const res = await read(r, id);
    expect(res.statusCode, res.body).toBe(200);
    const item = (res.json() as { ok: true; item: ItemView }).item;
    expect(item).toMatchObject({ id, state: 'done', title: 'Turn on the setting', closedAt: NOW0 + 2 });
    expect(item.history.map((h) => h.act)).toEqual(['raise', 'tick', 'confirm']);
  });

  it('answers an open item and a withdrawn one alike', async () => {
    const r = await rig();
    const open = raise(r);
    const gone = raise(r, { title: 'Withdrawn' });
    expect(r.coord.moveItem(gone, 'withdraw', 'coordinator', {}, NOW0 + 1, { programmeHasOpenRun: true }).ok).toBe(true);
    expect((await read(r, open)).json()).toMatchObject({ ok: true, item: { id: open, state: 'open' } });
    expect((await read(r, gone)).json()).toMatchObject({ ok: true, item: { id: gone, state: 'withdrawn' } });
  });

  it('an item the operator was never shown (held) is unknown-item, as is a number no item has', async () => {
    const r = await rig();
    const held = raise(r, { heldUntil: Date.now() + 3_600_000 });
    for (const id of [held, 9999]) {
      const res = await read(r, id);
      expect(res.statusCode, res.body).toBe(404);
      expect(res.json()).toMatchObject({ ok: false, error: 'unknown-item' });
    }
  });

  it('a malformed id is a bad request', async () => {
    const r = await rig();
    for (const id of ['0', 'abc', '-1', '01']) expect((await read(r, id)).statusCode).toBe(400);
  });
});

describe('GET /api/programmes/:slug/goals takes a session or the box token (EXEMPT-BUT-AUTHENTICATED, D-149\'s pattern)', () => {
  const url = '/api/programmes/prog-a/goals';
  const cookieOf = async (a: FastifyInstance): Promise<string> => {
    const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASS } });
    expect(res.statusCode, res.body).toBe(204);
    const set = res.headers['set-cookie'];
    const line = Array.isArray(set) ? set[0]! : String(set);
    return line.slice(0, line.indexOf(';'));
  };

  it('armed: no cookie and no token is 401 unauthenticated; a wrong token is 401', async () => {
    const { app: a } = await armed();
    const none = await a.inject({ method: 'GET', url });
    expect(none.statusCode).toBe(401);
    expect(none.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
    const wrong = await a.inject({ method: 'GET', url, headers: { 'x-ccrc-mail-token': 'f'.repeat(64) } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
  });

  it('armed: the box token alone is 200, a session alone is 200, and the two answers are deep-equal', async () => {
    const { app: a } = await armed();
    const viaToken = await a.inject({ method: 'GET', url, headers: { 'x-ccrc-mail-token': BOX } });
    const viaSession = await a.inject({ method: 'GET', url, headers: { cookie: await cookieOf(a) } });
    expect(viaToken.statusCode, viaToken.body).toBe(200);
    expect(viaSession.statusCode, viaSession.body).toBe(200);
    expect(viaToken.json()).toEqual(viaSession.json());
    expect(viaToken.json()).toMatchObject({ ok: true, goals: { program: 'prog-a', doneWhen: ['It ships.'] }, openItems: [] });
  });

  it('auth off: 200 with neither credential (today\'s behaviour)', async () => {
    const r = await rig();
    expect((await r.app.inject({ method: 'GET', url })).statusCode).toBe(200);
  });

  it('a coordinator reads another programme\'s pin: no ownership check on the read (C9)', async () => {
    const { app: a } = await armed();
    const res = await a.inject({ method: 'GET', url: '/api/programmes/prog-zzz/goals', headers: { 'x-ccrc-mail-token': BOX } });
    expect(res.statusCode).toBe(200);
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
  it('the subject stays inside MAIL_SUBJECT_MAX_BYTES and is cut on a code-point boundary (review 1335 F6)', () => {
    for (const unit of ['€', '😀', 'T']) {
      const subject = itemMailSubject(item({ title: unit.repeat(140) }));
      expect(Buffer.byteLength(subject, 'utf8'), unit).toBeLessThanOrEqual(MAIL_SUBJECT_MAX_BYTES);
      expect(Buffer.from(subject, 'utf8').toString('utf8'), unit).toBe(subject);
      expect(subject, unit).not.toContain('\uFFFD');
    }
    expect(itemMailSubject(item({ title: '€'.repeat(140) }))).toMatch(/^done: item 7: €+$/);
  });
  it('tickMail refuses a body past MAIL_BODY_MAX_BYTES with the measured size, and builds a fitting one', () => {
    const big = tickMail(item({ title: '€'.repeat(3000) }), null);
    expect(big).toMatchObject({ ok: false, limit: MAIL_BODY_MAX_BYTES });
    expect((big as { bytes: number }).bytes).toBeGreaterThan(MAIL_BODY_MAX_BYTES);
    const fits = tickMail(item({ title: 'Short' }), 'yes');
    expect(fits).toMatchObject({ ok: true, subject: 'done: item 7: Short' });
  });
  it('a tick whose body would pass the cap is refused too-large and writes nothing (review 1335 F6)', async () => {
    const r = await rig();
    const id = raise(r, { title: '€'.repeat(3000) });
    const res = await tick(r, id);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ ok: false, error: 'too-large' });
    expect(stateOf(r, id)).toBe('open');
    expect(mailRows(r)).toEqual([]);
  });
});

describe('ItemView.stale: a pure decider in the shared vocabulary (plan PL4, review 1331 A3)', () => {
  const base = { state: 'checking', tickedAt: NOW0, now: NOW0 + TICK_UNANSWERED_MS, mail: 'queued', coordinator: 'alive' } as const;
  it('thirty minutes is the named constant', () => { expect(TICK_UNANSWERED_MS).toBe(30 * 60 * 1000); });
  it('a freshly ticked item with its mail still unacknowledged is not stale', () => {
    expect(itemIsStale({ ...base, now: NOW0 + TICK_UNANSWERED_MS - 1 })).toBe(false);
  });
  it('a tick whose mail is not acknowledged thirty minutes on is stale, whatever else its delivery says (review 1335 F2)', () => {
    for (const mail of ['queued', 'delivered', 'rejected', 'unknown', 'none'] as const) {
      expect(itemIsStale({ ...base, mail }), mail).toBe(true);
    }
  });
  it('an acknowledged mail is not stale on its own', () => {
    expect(itemIsStale({ ...base, mail: 'acked' })).toBe(false);
  });
  it('a dead or absent coordinator is stale at once, whatever the mail says', () => {
    for (const coordinator of ['dead', 'absent'] as const) {
      expect(itemIsStale({ ...base, now: NOW0 + 1, mail: 'acked', coordinator })).toBe(true);
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
  it('reads the coordinator\'s presence from the fleet frame and the registry ids: a refused id is a doubt, never absent (review 1335 F4)', () => {
    const fleet = [{ id: 'lane-a', presence: 'alive' }, { id: 'lane-b', presence: 'dead' }, { id: 'lane-c', presence: 'asleep' }, { id: 'lane-d', presence: 'unknown' }, { id: 'lane-e' }] as never;
    const registry = new Set(['lane-a', 'lane-b', 'lane-c', 'lane-d', 'lane-e', 'lane-refused']);
    const read = (id: string): CoordinatorPresence => coordinatorPresenceIn(fleet, registry, id);
    expect(['lane-a', 'lane-b', 'lane-c', 'lane-d', 'lane-e', 'lane-refused', 'lane-z'].map(read))
      .toEqual(['alive', 'dead', 'alive', 'unmeasured', 'unmeasured', 'unmeasured', 'absent']);
    expect(coordinatorPresenceIn(fleet, null, 'lane-z'), 'no registry listing yet: nothing is known about an id the frame lacks').toBe('unmeasured');
    expect(coordinatorPresenceIn(null, registry, 'lane-a')).toBe('unmeasured');
  });
  it('a listed row the registry could not assemble is in the listing\'s ids and reads unmeasured, an unlisted id absent (review 1336 F2)', () => {
    const fleet = [{ id: 'lane-a', presence: 'alive' }] as never;
    // The ids are the listing's raw `*.uuid` names (`listedIds`), so a torn row is in the set though no fleet row carries it.
    const listed = new Set(['lane-a', 'lane-torn']);
    expect(coordinatorPresenceIn(fleet, listed, 'lane-torn')).toBe('unmeasured');
    expect(coordinatorPresenceIn(fleet, listed, 'lane-gone')).toBe('absent');
  });
  it('a route labels a checking item stale when its tick\'s mail is not acknowledged thirty minutes on', async () => {
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

describe('the tick mail and its label across the run and the coordinator\'s life (review 1335 F1, F2)', () => {
  const ALIVE: Watched = { fleet: [{ id: 'lane-a', presence: 'alive' }, { id: 'lane-b', presence: 'alive' }], registryIds: ['lane-a', 'lane-b'] };
  const labelOf = async (r: Rig, id: number): Promise<boolean> =>
    ((await r.app.inject({ method: 'GET', url: '/api/waiting' })).json() as { waiting: WaitingView }).waiting.items.find((i) => i.id === id)!.stale;

  it('F1: the tick mail survives the close of the run the item was raised under, through the real close path', async () => {
    const r = await rig(ALIVE);
    const id = raise(r);
    expect((await tick(r, id)).statusCode).toBe(200);
    // The coordinator opens the next wave BEFORE closing the last (its own rule), then closes wave 1 through the store's close.
    r.coord.openRun({ program: 'prog-a', title: 'PROG-A', project: 'project-a', wave: 2, waveOf: null, claimedBy: 'lane-a' });
    // Wave 1's run was never dispatched, so it closes as an abandon (`planned` to `failed`): the same `closeRun`, the same cancel of the run's mail.
    const closed = r.coord.closeRun({ runId: r.runA, finalState: 'failed', causedBy: 'coordinator', handoffCommit: null, program: 'prog-a', viaClosing: false });
    expect(closed.ok, JSON.stringify(closed)).toBe(true);
    const mail = r.coord.newestTickMail(itemMailSubject(r.coord.itemById(id)!));
    expect(mail, 'the tick mail was parked by the run close (rejected, undeliverable)').toMatchObject({ toId: 'lane-a', state: 'queued' });
  });

  it('F2: a takeover with the mail unacknowledged reads stale after thirty minutes, though the new coordinator is alive', async () => {
    const r = await rig(ALIVE);
    const id = raise(r);
    vi.spyOn(Date, 'now').mockReturnValue(NOW0);
    expect((await tick(r, id)).statusCode).toBe(200);
    r.coord.db.prepare("UPDATE runs SET claimedBy = 'lane-b' WHERE program = 'prog-a'").run();
    expect(r.coord.programmeCoordinator('prog-a')).toBe('lane-b');
    expect(await labelOf(r, id), 'inside the window').toBe(false);
    vi.spyOn(Date, 'now').mockReturnValue(NOW0 + TICK_UNANSWERED_MS);
    expect(await labelOf(r, id), 'the mail went to a coordinator that is no longer the programme\'s').toBe(true);
  });

  it('F2: the duplicate guard finds the newest tick mail whoever it went to, so a takeover does not allow a second mail', async () => {
    const r = await rig(ALIVE);
    const id = raise(r);
    expect((await tick(r, id)).statusCode).toBe(200);
    r.coord.db.prepare("UPDATE runs SET claimedBy = 'lane-b' WHERE program = 'prog-a'").run();
    expect(r.coord.moveItem(id, 'return', 'coordinator', { note: 'Not yet.' }, NOW0 + 1, { programmeHasOpenRun: true }).ok).toBe(true);
    const again = await tick(r, id);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'duplicate' });
    expect(mailRows(r)).toHaveLength(1);
  });

  it('F2: an acknowledged mail clears the duplicate guard and the label', async () => {
    const r = await rig(ALIVE);
    const id = raise(r);
    vi.spyOn(Date, 'now').mockReturnValue(NOW0);
    expect((await tick(r, id)).statusCode).toBe(200);
    r.coord.db.prepare("UPDATE mail_deliveries SET state = 'acked'").run();
    vi.spyOn(Date, 'now').mockReturnValue(NOW0 + TICK_UNANSWERED_MS);
    expect(await labelOf(r, id)).toBe(false);
  });

  // Review 1336 F3: the guards pinned in the direction the last round changed them.
  const markDeliveries = (r: Rig, state: string): void => {
    r.coord.db.prepare("UPDATE mail_deliveries SET state = ? WHERE mailId IN (SELECT id FROM mail WHERE fromId = 'operator')").run(state);
  };
  const sendBack = (r: Rig, id: number): void => {
    expect(r.coord.moveItem(id, 'return', 'coordinator', { note: 'Not yet.' }, NOW0 + 1, { programmeHasOpenRun: true }).ok).toBe(true);
  };

  it('F3: return, acknowledge, tick again answers 200 and queues the second mail', async () => {
    const r = await rig(ALIVE);
    const id = raise(r);
    expect((await tick(r, id)).statusCode).toBe(200);
    markDeliveries(r, 'acked');
    sendBack(r, id);
    const again = await tick(r, id);
    expect(again.statusCode, again.body).toBe(200);
    expect(mailRows(r)).toHaveLength(2);
  });

  it('F3: an earlier delivery that is delivered but not acknowledged still refuses the tick duplicate', async () => {
    const r = await rig(ALIVE);
    const id = raise(r);
    expect((await tick(r, id)).statusCode).toBe(200);
    markDeliveries(r, 'delivered');
    sendBack(r, id);
    const again = await tick(r, id);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'duplicate' });
    expect(mailRows(r)).toHaveLength(1);
  });

  it('F3: a delivered mail is not heard: the route labels the item stale thirty minutes on', async () => {
    const r = await rig(ALIVE);
    const id = raise(r);
    vi.spyOn(Date, 'now').mockReturnValue(NOW0);
    expect((await tick(r, id)).statusCode).toBe(200);
    markDeliveries(r, 'delivered');
    vi.spyOn(Date, 'now').mockReturnValue(NOW0 + TICK_UNANSWERED_MS);
    expect(await labelOf(r, id)).toBe(true);
  });

  it('F3: a takeover after the old coordinator acknowledged the mail is not stale, though the new coordinator never saw it', async () => {
    const r = await rig(ALIVE);
    const id = raise(r);
    vi.spyOn(Date, 'now').mockReturnValue(NOW0);
    expect((await tick(r, id)).statusCode).toBe(200);
    markDeliveries(r, 'acked');
    r.coord.db.prepare("UPDATE runs SET claimedBy = 'lane-b' WHERE program = 'prog-a'").run();
    vi.spyOn(Date, 'now').mockReturnValue(NOW0 + TICK_UNANSWERED_MS);
    expect(await labelOf(r, id)).toBe(false);
  });

  // Review 1336 F1: an outstanding tick mail to a coordinator that is no longer the programme's, and is gone, blocks nothing.
  const takeover = async (w: Watched, lane: { id: string; presence?: string }[] | null) => {
    const r = await rig(w);
    const id = raise(r);
    expect((await tick(r, id)).statusCode).toBe(200);
    markDeliveries(r, 'delivered');
    r.coord.db.prepare("UPDATE runs SET claimedBy = 'lane-b' WHERE program = 'prog-a'").run();
    w.fleet = lane;
    sendBack(r, id);
    return { r, id };
  };
  it('F1: after a takeover from a coordinator the fleet reads dead, the re-tick succeeds with one new mail, to the new coordinator', async () => {
    const w: Watched = { fleet: [{ id: 'lane-a', presence: 'alive' }, { id: 'lane-b', presence: 'alive' }], registryIds: ['lane-a', 'lane-b'] };
    const { r, id } = await takeover(w, [{ id: 'lane-a', presence: 'dead' }, { id: 'lane-b', presence: 'alive' }]);
    const again = await tick(r, id);
    expect(again.statusCode, again.body).toBe(200);
    expect(mailRows(r).map((m) => m.toId)).toEqual(['lane-a', 'lane-b']);
  });
  it('F1: after a takeover from a coordinator the registry no longer lists, the re-tick succeeds too', async () => {
    const w: Watched = { fleet: [{ id: 'lane-a', presence: 'alive' }, { id: 'lane-b', presence: 'alive' }], registryIds: ['lane-a', 'lane-b'] };
    const { r, id } = await takeover(w, [{ id: 'lane-b', presence: 'alive' }]);
    w.registryIds = ['lane-b'];
    const again = await tick(r, id);
    expect(again.statusCode, again.body).toBe(200);
    expect(mailRows(r).map((m) => m.toId)).toEqual(['lane-a', 'lane-b']);
  });
  it('F1: with the displaced coordinator alive, the re-tick is still refused duplicate and the sentence names it', async () => {
    const w: Watched = { fleet: [{ id: 'lane-a', presence: 'alive' }, { id: 'lane-b', presence: 'alive' }], registryIds: ['lane-a', 'lane-b'] };
    const { r, id } = await takeover(w, [{ id: 'lane-a', presence: 'alive' }, { id: 'lane-b', presence: 'alive' }]);
    const again = await tick(r, id);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'duplicate', detail: expect.stringContaining('lane-a') });
    expect(mailRows(r)).toHaveLength(1);
  });
  it('F1: with the displaced coordinator unmeasured (the registry lists it, the frame lacks it), the re-tick is still refused', async () => {
    const w: Watched = { fleet: [{ id: 'lane-a', presence: 'alive' }, { id: 'lane-b', presence: 'alive' }], registryIds: ['lane-a', 'lane-b'] };
    const { r, id } = await takeover(w, [{ id: 'lane-b', presence: 'alive' }]);
    expect((await tick(r, id)).statusCode).toBe(409);
    expect(mailRows(r)).toHaveLength(1);
  });
  it('F1: the recipient that is still the programme\'s coordinator blocks, though it reads dead (its mail waits for its return)', async () => {
    const w: Watched = { fleet: [{ id: 'lane-a', presence: 'alive' }, { id: 'lane-b', presence: 'alive' }], registryIds: ['lane-a', 'lane-b'] };
    const r = await rig(w);
    const id = raise(r);
    expect((await tick(r, id)).statusCode).toBe(200);
    markDeliveries(r, 'delivered');
    w.fleet = [{ id: 'lane-a', presence: 'dead' }, { id: 'lane-b', presence: 'alive' }];
    sendBack(r, id);
    expect((await tick(r, id)).statusCode).toBe(409);
    expect(mailRows(r)).toHaveLength(1);
  });
});

describe('the coordinator\'s presence reaches the label through the route and the server\'s own reading (review 1335 F4, F5)', () => {
  const stateOf2 = async (watched: Watched): Promise<boolean> => {
    const r = await rig(watched);
    const id = raise(r);
    expect((await tick(r, id)).statusCode).toBe(200);
    return ((await r.app.inject({ method: 'GET', url: '/api/waiting' })).json() as { waiting: WaitingView }).waiting.items.find((i) => i.id === id)!.stale;
  };
  it('a coordinator the fleet frame reads dead labels the item at once', async () => {
    expect(await stateOf2({ fleet: [{ id: 'lane-a', presence: 'dead' }], registryIds: ['lane-a'] })).toBe(true);
  });
  it('a coordinator the fleet frame lacks and the registry lacks too reads absent: the item is labelled', async () => {
    expect(await stateOf2({ fleet: [{ id: 'lane-other', presence: 'alive' }], registryIds: ['lane-other'] })).toBe(true);
  });
  it('a coordinator the registry lists but the fleet frame lacks (a refused id) is a doubt: the item is not labelled', async () => {
    expect(await stateOf2({ fleet: [{ id: 'lane-other', presence: 'alive' }], registryIds: ['lane-other', 'lane-a'] })).toBe(false);
  });
  it('an alive coordinator does not label the item', async () => {
    expect(await stateOf2({ fleet: [{ id: 'lane-a', presence: 'alive' }], registryIds: ['lane-a'] })).toBe(false);
  });
  it('before the watcher has broadcast anything, nothing is labelled', async () => {
    expect(await stateOf2({ fleet: null, registryIds: null })).toBe(false);
  });
  it('the coordinator\'s own list (the box-token lane) reads the same presence', async () => {
    const r = await rig({ fleet: [{ id: 'lane-a', presence: 'dead' }], registryIds: ['lane-a'] });
    const id = raise(r);
    expect((await tick(r, id)).statusCode).toBe(200);
    const res = await r.app.inject({ method: 'GET', url: '/api/programmes/prog-a/items?byId=lane-a&byUuid=u-lane-a', headers: { 'x-ccrc-mail-token': ID_GATE_TOKEN } });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { items: ItemView[] }).items.find((i) => i.id === id)!.stale).toBe(true);
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
    // Exactly the write, then the microtask queued at the first read: an await between them flips the pair, and a route
    // whose first read moved off `itemById` (so no microtask was queued) fails here rather than passing unobserved.
    expect(order, `${name}: an await sits between the item read and the write, or the first read is not itemById`).toEqual(['write', 'microtask']);
  });
});
