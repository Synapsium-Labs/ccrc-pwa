// Overlord W2, the label cards' two doors (plan w2-label-queue.md Task 5; LQ9, LQ10, LQ12, LQ13; index F14; the coordinator's
// ruling on the gap, call 1913, and its points b and 7), through `buildServer` with the armed account gate and a real sign-in, a
// real coord.db and a real private store. Fixture HOMEs only, neutral names, neutral text. The answer's compare-and-set retry is
// driven through the routes file alone, with a store double, because a row cannot be moved between two statements of one request.
import type { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DECISION_QUESTIONS, type DecisionRowId } from '../../shared/decisionModel.js';
import type { LabelCardsAnswer } from '../../shared/labelQueue.js';
import { gateActorOf } from '../src/accounts/audit.js';
import type { AccountGate } from '../src/accounts/gate.js';
import { SecretMasker } from '../src/accounts/mask.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { openCoordDb } from '../src/coord/db.js';
import { recordDecision } from '../src/coord/decisionModelStore.js';
import { registerLabelCardRoutes, type LabelCardMail, type LabelCardMessages, type LabelCardStore } from '../src/coord/labelCardRoutes.js';
import { runLabelQueueLane } from '../src/coord/labelQueueLane.js';
import type { LabelRefFacts, MeasuredLabels } from '../src/coord/labelQueuePorts.js';
import { labelLaneReadsOf, openLabelCards, pickLabelCardsInTx } from '../src/coord/labelQueueStore.js';
import { CoordStore } from '../src/coord/store.js';
import { Tmux, type Runner } from '../src/exec.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import { buildServer, type Deps } from '../src/server.js';
import { fakeTime } from './fakeTime.js';
import { seedRoster } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

vi.setConfig({ testTimeout: 90_000 });

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
const BOX_TOKEN = 'box-token-fixture-0123456789';
const MARK_P = 0.8642;   // a probability no card may carry
const WEEK = '2026-W48';

let apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps) await a.close();
  apps = [];
  vi.restoreAllMocks();
  removeTmpFixtures();
});

function issuerDouble(): PrivacyIssuer {
  let n = 0;
  return { kind: 'ready', issue: (high) => { n = Math.max(n, high ?? 0) + 1; return { ok: true, id: n }; } };
}
const ACTOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('Fixture browser', 'abcdef0123456789'));

interface Rig { app: FastifyInstance; coord: CoordStore; store: OperatorModelStore; cookie: string; db: DatabaseSync }
async function rig(opts: { auth?: boolean; origin?: string; masker?: SecretMasker } = {}): Promise<Rig> {
  const home = mkTmp('ccrc-label-doors-');
  seedRoster(home);
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const run: Runner = async () => ({ ran: true, code: 0, stdout: '', stderr: '' });
  const base = loadConfig({ CCRC_HOME: home });
  const cfg = { ...base, authEnabled: opts.auth ?? true, cookieSecure: false, ...(opts.origin === undefined ? {} : { origin: opts.origin }) };
  const db = openCoordDb(path.join(home, '.ccrc', 'coord.db'));
  const coord = new CoordStore(db);
  const store = new OperatorModelStore(openOperatorModelDb(defaultOperatorModelDbPath(home)), issuerDouble());
  const time = fakeTime();
  const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), time: time.ports, coord,
    mailToken: BOX_TOKEN, operatorModel: store, ...(opts.masker === undefined ? {} : { masker: opts.masker }) };
  const app = await buildServer(deps, new Bus());
  await app.ready();
  apps.push(app);
  let cookie = '';
  if (cfg.authEnabled) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
    expect(res.statusCode, res.body).toBe(204);
    const set = res.headers['set-cookie'];
    const line = Array.isArray(set) ? set[0]! : String(set);
    cookie = line.slice(0, line.indexOf(';'));
  }
  return { app, coord, store, cookie, db };
}
const get = (r: Rig, headers: Record<string, string> = {}) =>
  r.app.inject({ method: 'GET', url: '/api/labels', headers: { ...(r.cookie === '' ? {} : { cookie: r.cookie }), ...headers } });
const post = (r: Rig, id: number | string, answer: unknown, headers: Record<string, string> = {}) =>
  r.app.inject({ method: 'POST', url: `/api/labels/${id}`, payload: { answer }, headers: { ...(r.cookie === '' ? {} : { cookie: r.cookie }), ...headers } });

function setMode(db: DatabaseSync, row: DecisionRowId, mode: 'off' | 'shadow' | 'armed'): void {
  db.prepare(`INSERT INTO decision_rows (row, mode, ceiling, updatedAt, actor) VALUES (?, ?, 600, 1, 'test')
    ON CONFLICT (row) DO UPDATE SET mode = excluded.mode`).run(row, mode);
}
let seq = 0;
/** A record and its card. */
function card(db: DatabaseSync, row: DecisionRowId, stateHash: string, refs: Record<string, string | string[]>, inline: Record<string, string> | null): number {
  const q = DECISION_QUESTIONS[row];
  const rec = recordDecision(db, { row, revision: q.revision, modelId: 'model-a', hostKind: 'local', origin: 'http://127.0.0.1:1',
    stateHash, lineGen: 0, verdict: 'yes', p: MARK_P, band: 'very-likely', ms: 5, refs, inline, at: (seq += 1000) });
  pickLabelCardsInTx(db, WEEK, [{ row, revision: q.revision, stateHash, recordId: rec.id }], seq, () => 1);
  return openLabelCards(db).find((c) => c.stateHash === stateHash)!.id;
}
function message(store: OperatorModelStore, text: string): number {
  const r = store.recordMessage({ at: 1_000, sessionId: 'lane-a-overlord', term: 1, actor: ACTOR, text, mark: false, composedKey: null, offRecord: false });
  if (!r.ok) throw new Error(`${r.error}: ${r.detail}`);
  return r.value.id;
}
const mail = (db: DatabaseSync, body: string): number =>
  (db.prepare("INSERT INTO mail (fromId, fromUuid, toId, kind, subject, body, artifacts, at) VALUES ('lane-b', 'u', 'overlord', 'status', 's', ?, '[]', 1) RETURNING id")
    .get(body) as { id: number }).id;

describe('the gate (index F14, LQ9)', () => {
  it('dark: both doors answer auth-off and read nothing', async () => {
    const r = await rig({ auth: false });
    for (const res of [await get(r), await post(r, 1, 'yes')]) {
      expect(res.statusCode, res.body).toBe(501);
      expect(res.json()).toMatchObject({ ok: false, error: 'auth-off' });
    }
  });

  it('no session answers unauthenticated, and the box token alone is refused', async () => {
    const r = await rig();
    const anon = { ...r, cookie: '' };
    for (const res of [await get(anon), await post(anon, 1, 'yes'), await get(anon, { 'x-ccrc-mail-token': BOX_TOKEN }),
      await post(anon, 1, 'yes', { 'x-ccrc-mail-token': BOX_TOKEN })]) {
      expect(res.statusCode, res.body).toBe(401);
      expect(res.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
    }
  });

  it('a plain-HTTP origin off loopback answers insecure-origin', async () => {
    const r = await rig({ origin: 'http://ccrc.example.invalid:7788' });
    for (const res of [await get(r), await post(r, 1, 'yes')]) expect(res.json()).toMatchObject({ ok: false, error: 'insecure-origin' });
  });

  it('each door asks its own gate before any read: a refusing gate leaves the store, the messages and the mail untouched', async () => {
    // Through the routes file alone, so the app-level gate cannot answer first (review 4185, C6 and mutant 1).
    const refuse: AccountGate = (_req, reply) => { void reply.code(501).send({ ok: false, error: 'auth-off' }); return { pass: false }; };
    const store = vi.fn(() => undefined);
    const messages = vi.fn(() => undefined);
    const mailRead = vi.fn(() => undefined);
    const app = Fastify({ logger: false });
    registerLabelCardRoutes(app, { gate: refuse, store, messages, mail: mailRead, now: () => 5 });
    await app.ready();
    apps.push(app);
    for (const res of [await app.inject({ method: 'GET', url: '/api/labels' }),
      await app.inject({ method: 'POST', url: '/api/labels/1', payload: { answer: 'yes' } })]) {
      expect(res.statusCode, res.body).toBe(501);
      expect(res.json()).toMatchObject({ ok: false, error: 'auth-off' });
    }
    expect(store).not.toHaveBeenCalled();
    expect(messages).not.toHaveBeenCalled();
    expect(mailRead).not.toHaveBeenCalled();
  });
});

describe('GET /api/labels', () => {
  it('no row in shadow: an empty list (point 7)', async () => {
    const r = await rig();
    const res = await get(r);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true, cards: [], open: 0, heldBack: 0, pickedThisWeek: 0, week: expect.stringMatching(/^\d{4}-W\d{2}$/),
      skipped: { absent: 0, unmeasured: 0, noReader: 0 } });
  });

  it('rebuilds each open card from its record, in the order picked, with the model\'s answer hidden', async () => {
    const r = await rig();
    setMode(r.db, 'relay.method', 'shadow');
    setMode(r.db, 'readback.omits', 'armed');
    const a = card(r.db, 'relay.method', 'a', {}, { part: 'Use the old route first.' });
    const m = message(r.store, 'Please add the export button.');
    const ml = mail(r.db, 'I will add the export button and a menu.');
    const b = card(r.db, 'readback.omits', 'b', { request: String(m), readback: String(ml) }, null);
    const res = await get(r);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as LabelCardsAnswer;
    expect(body.cards.map((c) => c.id)).toEqual([a, b]);
    expect(body.cards[0]).toMatchObject({ row: 'relay.method', question: DECISION_QUESTIONS['relay.method'].instructions,
      fields: [{ name: 'part', quoted: true, text: 'Use the old route first.' }], answers: ['yes', 'no', 'not-sure'] });
    expect(body.cards[1]!.fields).toEqual([
      { name: 'request', quoted: false, text: 'Please add the export button.' },
      { name: 'readback', quoted: true, text: 'I will add the export button and a menu.' },
    ]);
    expect(body).toMatchObject({ open: 2, pickedThisWeek: 0, skipped: { absent: 0, unmeasured: 0, noReader: 0 } });
    expect(res.body).not.toContain(String(MARK_P));
    expect(res.body).not.toContain('very-likely');
    expect(res.body).not.toMatch(/"(verdict|p|band|line|probability)"/);
  });

  it('a card whose row is off or changed is left out and not counted open', async () => {
    const r = await rig();
    setMode(r.db, 'relay.method', 'off');
    card(r.db, 'relay.method', 'a', {}, { part: 'x' });
    const q = DECISION_QUESTIONS['readback.omits'];
    setMode(r.db, 'readback.omits', 'shadow');
    pickLabelCardsInTx(r.db, WEEK, [{ row: 'readback.omits', revision: 'ffffffffffffffff', stateHash: 'old', recordId: 1 }], 1, () => 1);
    expect(q.revision).not.toBe('ffffffffffffffff');
    expect((await get(r)).json()).toMatchObject({ cards: [], open: 0, skipped: { absent: 0, unmeasured: 0, noReader: 0 } });
  });

  it('a state that does not resolve is skipped and counted under its own word: absent, unmeasured, no-reader', async () => {
    const r = await rig();
    setMode(r.db, 'readback.omits', 'shadow');
    setMode(r.db, 'scope.widens', 'shadow');
    setMode(r.db, 'readback.adds', 'shadow');
    const ml = mail(r.db, 'readback');
    card(r.db, 'readback.omits', 'gone', { request: '999', readback: String(ml) }, null);
    card(r.db, 'scope.widens', 'goals', { cited: '1', goals: 'prog-a/pin/5' }, null);
    card(r.db, 'readback.adds', 'unread', { request: '1', readback: String(ml) }, null);
    r.db.prepare('UPDATE decision_rows SET ceiling = 1 WHERE row = ?').run('readback.adds');
    const body = (await get(r)).json() as LabelCardsAnswer;
    expect(body.cards).toEqual([]);
    expect(body.skipped).toEqual({ absent: 1, unmeasured: 1, noReader: 1 });
  });

  it('a secret-shaped value in a mail body is masked on the card (point b); the store holds it raw', async () => {
    const SECRET = 'Zq7'.repeat(12);
    const mdb = openCoordDb(path.join(mkTmp('ccrc-label-doors-mask-'), '.ccrc', 'coord.db'));
    const masker = new SecretMasker({ db: mdb, token: () => BOX_TOKEN, log: () => {} });
    try {
      expect(masker.ingestSecret('lane-a', SECRET)).toBe('masked');
      const r = await rig({ masker });
      setMode(r.db, 'readback.omits', 'shadow');
      const m = message(r.store, 'Add the button.');
      const ml = mail(r.db, `I will use the key ${SECRET} and add it.`);
      card(r.db, 'readback.omits', 'b', { request: String(m), readback: String(ml) }, null);
      expect((r.db.prepare('SELECT body FROM mail WHERE id = ?').get(ml) as { body: string }).body).toContain(SECRET);
      const res = await get(r);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body).not.toContain(SECRET);
      expect(res.body).toContain('I will use the key');
    } finally { mdb.close(); }
  });
});

describe('at most ten cards are handed over (the coordinator\'s ruling C1, call 1975)', () => {
  const MON = Date.UTC(2026, 10, 23, 9);   // Monday of 2026-W48
  const DAY = 86_400_000;
  const NO_MEASURED: MeasuredLabels = { labelsFor: () => [] };
  const ALL_PRESENT: LabelRefFacts = { found: () => 'present' };
  const recordOnly = (db: DatabaseSync, row: DecisionRowId, stateHash: string, refs: Record<string, string>, inline: Record<string, string> | null): number =>
    recordDecision(db, { row, revision: DECISION_QUESTIONS[row].revision, modelId: 'model-a', hostKind: 'local', origin: 'http://127.0.0.1:1',
      stateHash, lineGen: 0, verdict: 'yes', p: MARK_P, band: 'very-likely', ms: 5, refs, inline, at: (seq += 1000) }).id;
  const lanePass = (db: DatabaseSync, at: number) =>
    runLabelQueueLane({ reads: labelLaneReadsOf(db, NO_MEASURED), refs: ALL_PRESENT, wall: () => at, warn: () => {} });
  const idsOf = (db: DatabaseSync, row: DecisionRowId): number[] => openLabelCards(db).filter((c) => c.row === row).map((c) => c.id);

  it('ten of A, A off, ten of B, A back: ten drawn, ten held back, the budget zero; one answered draws the next', async () => {
    const r = await rig();
    setMode(r.db, 'relay.method', 'shadow');
    for (let i = 0; i < 10; i++) recordOnly(r.db, 'relay.method', `a${i}`, {}, { part: `Part ${i}.` });
    expect(lanePass(r.db, MON).picked).toBe(10);
    setMode(r.db, 'relay.method', 'off');
    setMode(r.db, 'readback.omits', 'shadow');
    const m = message(r.store, 'Add the button.');
    const ml = mail(r.db, 'I will add the button.');
    for (let i = 0; i < 10; i++) recordOnly(r.db, 'readback.omits', `b${i}`, { request: String(m), readback: String(ml) }, null);
    expect(lanePass(r.db, MON + 7 * DAY).picked).toBe(10);
    setMode(r.db, 'relay.method', 'shadow');
    const a = idsOf(r.db, 'relay.method');
    const b = idsOf(r.db, 'readback.omits');
    let body = (await get(r)).json() as LabelCardsAnswer;
    expect(body.cards.map((c) => c.id)).toEqual(a);
    expect(body).toMatchObject({ open: 20, heldBack: 10, skipped: { absent: 0, unmeasured: 0, noReader: 0 } });
    recordOnly(r.db, 'relay.method', 'late', {}, { part: 'Late.' });
    expect(lanePass(r.db, MON + 14 * DAY).picked).toBe(0);
    expect((await post(r, a[0]!, 'yes')).json()).toEqual({ ok: true, changed: true });
    body = (await get(r)).json() as LabelCardsAnswer;
    expect(body.cards.map((c) => c.id)).toEqual([...a.slice(1), b[0]]);
    expect(body).toMatchObject({ open: 19, heldBack: 9 });
  });

  it('the same after a revision rollback: the returning revision\'s cards show again, and only the ten oldest are drawn', async () => {
    const r = await rig();
    setMode(r.db, 'relay.method', 'shadow');
    setMode(r.db, 'readback.omits', 'shadow');
    const m = message(r.store, 'Add the button.');
    const ml = mail(r.db, 'I will add the button.');
    // While a build at another relay.method revision ran (this revision's cards hidden then), ten readback.omits cards were picked
    // in W49, and three at that other revision. Back on this build: this revision's ten W48 cards show again, the other's are
    // hidden. Inserted newest week first, so the store's id order is not the order the read hands them over in.
    for (let i = 0; i < 10; i++) {
      const rec = recordOnly(r.db, 'readback.omits', `b${i}`, { request: String(m), readback: String(ml) }, null);
      pickLabelCardsInTx(r.db, '2026-W49', [{ row: 'readback.omits', revision: DECISION_QUESTIONS['readback.omits'].revision, stateHash: `b${i}`, recordId: rec }], 1, () => 1);
    }
    for (let i = 0; i < 3; i++) {
      pickLabelCardsInTx(r.db, '2026-W49', [{ row: 'relay.method', revision: 'ffffffffffffffff', stateHash: `x${i}`, recordId: 1 }], 1, () => 1);
    }
    for (let i = 0; i < 10; i++) {
      const rec = recordOnly(r.db, 'relay.method', `a${i}`, {}, { part: `Part ${i}.` });
      pickLabelCardsInTx(r.db, '2026-W48', [{ row: 'relay.method', revision: DECISION_QUESTIONS['relay.method'].revision, stateHash: `a${i}`, recordId: rec }], 1, () => 1);
    }
    const a = idsOf(r.db, 'relay.method').filter((id) => openLabelCards(r.db).find((c) => c.id === id)!.revision !== 'ffffffffffffffff');
    const b = idsOf(r.db, 'readback.omits');
    expect(Math.max(...b)).toBeLessThan(Math.min(...a));
    let body = (await get(r)).json() as LabelCardsAnswer;
    expect(body.cards.map((c) => c.id)).toEqual(a);
    expect(body).toMatchObject({ open: 20, heldBack: 10 });
    recordOnly(r.db, 'relay.method', 'late', {}, { part: 'Late.' });
    expect(lanePass(r.db, MON + 14 * DAY).picked).toBe(0);
    expect((await post(r, a[0]!, 'not-sure')).json()).toEqual({ ok: true, changed: true });
    body = (await get(r)).json() as LabelCardsAnswer;
    expect(body.cards.map((c) => c.id)).toEqual([...a.slice(1), b[0]]);
    expect(body).toMatchObject({ open: 19, heldBack: 9 });
  });
});

describe('POST /api/labels/:id', () => {
  it('yes writes one label with the gate\'s actor; a second answer is changed: false', async () => {
    const r = await rig();
    setMode(r.db, 'relay.method', 'shadow');
    const id = card(r.db, 'relay.method', 'a', {}, { part: 'x' });
    const res = await post(r, id, 'yes');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true, changed: true });
    const labels = r.db.prepare('SELECT label, source, cardId, actor FROM decision_labels').all() as { label: string; source: string; cardId: number; actor: string }[];
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ label: 'yes', source: 'label-queue', cardId: id });
    expect(labels[0]!.actor).not.toBe('');
    expect((await post(r, id, 'no')).json()).toEqual({ ok: true, changed: false });
    expect(r.db.prepare('SELECT COUNT(*) AS n FROM decision_labels').get()).toEqual({ n: 1 });
  });

  it('not-sure closes the card and writes no label (LQ12)', async () => {
    const r = await rig();
    setMode(r.db, 'relay.method', 'shadow');
    const id = card(r.db, 'relay.method', 'a', {}, { part: 'x' });
    expect((await post(r, id, 'not-sure')).json()).toEqual({ ok: true, changed: true });
    expect(r.db.prepare('SELECT COUNT(*) AS n FROM decision_labels').get()).toEqual({ n: 0 });
    expect(openLabelCards(r.db)).toEqual([]);
  });

  it('an off row answers 409 row-changed; an unknown id 404; an answer the row does not allow 400', async () => {
    const r = await rig();
    setMode(r.db, 'relay.method', 'shadow');
    const id = card(r.db, 'relay.method', 'a', {}, { part: 'x' });
    expect((await post(r, id, 'none')).statusCode).toBe(400);
    expect((await post(r, id, { option: 'x' })).json()).toMatchObject({ ok: false, error: 'bad-request' });
    expect((await post(r, 999, 'yes')).json()).toMatchObject({ ok: false, error: 'not-found' });
    expect((await post(r, 'abc', 'yes')).statusCode).toBe(400);
    setMode(r.db, 'relay.method', 'off');
    const off = await post(r, id, 'yes');
    expect(off.statusCode).toBe(409);
    expect(off.json()).toMatchObject({ ok: false, error: 'row-changed' });
    expect(r.db.prepare('SELECT COUNT(*) AS n FROM decision_labels').get()).toEqual({ n: 0 });
  });
});

describe('the answer\'s compare-and-set retry (F13), through the routes file with a store double', () => {
  const passGate: AccountGate = () => ({ pass: true, actor: gateActorOf('Fixture browser', 'abcdef0123456789'), sessionIdHash: 'h' });
  const q = DECISION_QUESTIONS['relay.method'];
  const theCard = { id: 1, week: WEEK, row: 'relay.method' as DecisionRowId, revision: q.revision, stateHash: 's', recordId: 1, pickedAt: 1,
    closedAt: null, closedBy: null, outcome: null };
  async function appWith(store: LabelCardStore): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });
    registerLabelCardRoutes(app, { gate: passGate, store: () => store, messages: () => undefined, mail: () => undefined, now: () => 5 });
    await app.ready();
    apps.push(app);
    return app;
  }
  const base = (over: Partial<LabelCardStore>): LabelCardStore => ({
    openCards: () => [], card: () => theCard, rowMode: () => 'shadow', record: () => ({ refs: {}, inline: { part: 'x' } }),
    pickedThisWeek: () => 0, close: () => 'closed', ...over,
  });

  it('a row that goes off between the read and the close (moved) answers 409 row-changed after the one re-read', async () => {
    let modes: ('shadow' | 'off')[] = ['shadow', 'off'];
    const close = vi.fn(() => 'moved' as const);
    const app = await appWith(base({ rowMode: () => modes.shift() ?? 'off', close }));
    const res = await app.inject({ method: 'POST', url: '/api/labels/1', payload: { answer: 'yes' } });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'row-changed' });
    expect(close).toHaveBeenCalledTimes(1);
    modes = [];
  });

  it('a moved close whose re-read still allows the answer closes on the second try; two moves are row-changed', async () => {
    const close = vi.fn().mockReturnValueOnce('moved').mockReturnValueOnce('closed');
    const app = await appWith(base({ close }));
    expect((await app.inject({ method: 'POST', url: '/api/labels/1', payload: { answer: 'no' } })).json()).toEqual({ ok: true, changed: true });
    expect(close).toHaveBeenCalledTimes(2);
    expect(close.mock.calls[0]![1]).toMatchObject({ outcome: 'labelled', label: 'no', expect: { mode: 'shadow', revision: q.revision } });
    const always = await appWith(base({ close: () => 'moved' }));
    expect((await always.inject({ method: 'POST', url: '/api/labels/1', payload: { answer: 'no' } })).statusCode).toBe(409);
  });

  it('a close that throws answers 503 write-failed', async () => {
    const app = await appWith(base({ close: () => { throw new Error('locked'); } }));
    const res = await app.inject({ method: 'POST', url: '/api/labels/1', payload: { answer: 'yes' } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'write-failed' });
  });
});

describe('the read\'s own unmeasured mappings for a ref, through the routes file with doubles (review 4185, C7)', () => {
  const passGate: AccountGate = () => ({ pass: true, actor: gateActorOf('Fixture browser', 'abcdef0123456789'), sessionIdHash: 'h' });
  const rb = DECISION_QUESTIONS['readback.omits'];
  const rbCard = { id: 2, week: WEEK, row: 'readback.omits' as DecisionRowId, revision: rb.revision, stateHash: 'r', recordId: 2, pickedAt: 1,
    closedAt: null, closedBy: null, outcome: null };
  const store: LabelCardStore = {
    openCards: () => [rbCard], card: () => rbCard, rowMode: () => 'shadow', record: () => ({ refs: { request: '5', readback: '7' }, inline: null }),
    pickedThisWeek: () => 0, close: () => 'closed',
  };
  const TEXT: LabelCardMessages = { messageById: () => ({ kind: 'measured', value: { text: 'Add the button.' } }) };
  const MAIL: LabelCardMail = { mailOrigin: () => ({ body: 'I will add it.' }) };
  async function read(messages: LabelCardMessages | undefined, mailRead: LabelCardMail | undefined): Promise<LabelCardsAnswer> {
    const app = Fastify({ logger: false });
    registerLabelCardRoutes(app, { gate: passGate, store: () => store, messages: () => messages, mail: () => mailRead, now: () => 5 });
    await app.ready();
    apps.push(app);
    const res = await app.inject({ method: 'GET', url: '/api/labels' });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as LabelCardsAnswer;
  }
  const UNMEASURED = { absent: 0, unmeasured: 1, noReader: 0 };

  it('both reads answering: the card is drawn (the control)', async () => {
    const body = await read(TEXT, MAIL);
    expect(body.cards.map((c) => c.id)).toEqual([2]);
    expect(body.skipped).toEqual({ absent: 0, unmeasured: 0, noReader: 0 });
  });
  it('no private store wired: unmeasured, never absent', async () => {
    expect(await read(undefined, MAIL)).toMatchObject({ cards: [], skipped: UNMEASURED });
  });
  it('a message read answering unmeasured: unmeasured, never absent', async () => {
    expect(await read({ messageById: () => ({ kind: 'unmeasured', why: 'locked' }) }, MAIL)).toMatchObject({ cards: [], skipped: UNMEASURED });
  });
  it('a mail read that throws: unmeasured, never absent', async () => {
    expect(await read(TEXT, { mailOrigin: () => { throw new Error('busy'); } })).toMatchObject({ cards: [], skipped: UNMEASURED });
  });
});
