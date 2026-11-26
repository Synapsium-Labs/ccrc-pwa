// Overlord W1, the chat, Task 2 (plan w1-chat.md; questions 3, 9, 12 and 14): the thread door, `GET /api/overlord/chat?before=<id>`,
// through `buildServer`. RED until the door exists: every case below fails today on the missing route (404), and none may fail for
// another reason. Fixture HOMEs only, neutral names, neutral text.
//
// THE HARNESS is `overlord-prompt-record.test.ts`'s `rig`, copied (not imported): the real server over a fixture HOME, a real
// `CoordStore` whose `designationRead` is spied, a real `OperatorModelStore` with a privacy-journal double, the armed account gate
// and a real sign-in. The rig adds a journal double on `deps.overlordAuthority`, so the Overlord routes' own `coord` is the real store
// the spy stands on (without it `registerOverlordRoutes` is handed the absent-store stub, which answers every designation read
// `unmeasured`).
//
// WHAT THE DOOR DOES (asserted below): the account gate with `cap: null`; the query through `readChatThreadQuery`; the designation's
// three arms (`chatDesignation`); the read runner in its operator mode, door `chat`; then the facts, each read once (`messagesPage(before
// ?? null, 100)`, `generationsOf` of the identity `overlord`, `readinessChanges` since 0), `composeChat`, and one ledger line from
// `chatThreadComposed`.
//
// A CLOSED STORE (decided by reading `overlordRead.ts`): the runner counts the ceiling BEFORE it composes, and the counter reads the
// private store, so a closed store stops the read at the runner: 502 `unmeasured`, `messagesPage` never reached, no line (the store that
// would hold it is closed). The unreadable-messages case therefore makes `messagesPage` ALONE answer `unmeasured` (a spy), which
// leaves the counter and the ledger writer working and is what `messages.kind === 'unmeasured'` on a 200 means.
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Bus } from '../src/bus.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { openCoordDb, tx } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { endOverlordGeneration, type MintInput } from '../src/continuity/continuityStore.js';
import { recordReadiness, type ReadinessWrite } from '../src/coord/overlordReadinessStore.js';
import type { OverlordAuthorityJournal } from '../src/coord/overlordAuthorityJournal.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import type { ReadLine } from '../../shared/operatorMessages.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import {
  CHAT_SERVER_LINE_MAP, CHAT_SERVER_LINE_UNMEASURED, NOT_ON_RECORD, chatTicksOf, readChatThread, type ChatEntry, type ChatThread,
} from '../../shared/overlordChat.js';
import { seedRoster } from './helpers.js';
import { fakeTime, FAKE_T0 } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

vi.setConfig({ testTimeout: 90_000 });

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
const LANE_A = 'lane-a-overlord';
const LANE_B = 'lane-b-overlord';
const BOX_TOKEN = 'box-token-fixture-0123456789';
const VIEW = {} as never;
const designated = (sessionId: string, term = 1): DesignationRead => ({ kind: 'designated', sessionId, term, row: VIEW });
const NOT_DESIGNATED: DesignationRead = { kind: 'not-designated', row: null };
const UNMEASURED: DesignationRead = { kind: 'unmeasured', why: 'fixture' };

/** A privacy journal double: issues one above the larger of the store's highest and its own. */
function issuerDouble(): PrivacyIssuer {
  const records: number[] = [];
  return { kind: 'ready', issue(storeHighest) { const id = Math.max(storeHighest ?? 0, records.at(-1) ?? 0) + 1; records.push(id); return { ok: true, id }; } };
}

let apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps) await a.close();
  apps = [];
  vi.restoreAllMocks();
  removeTmpFixtures();
});

interface Rig {
  app: FastifyInstance; coord: CoordStore; store: OperatorModelStore; cookie: string;
  /** The store's `messagesPage`, spied through to the real reader: `.mock.calls` is every read of the words. */
  messagesPage: ReturnType<typeof spyMessagesPage>;
  readinessChanges: ReturnType<typeof spyReadiness>;
}
interface RigOpts { auth?: boolean; origin?: string; designation?: DesignationRead }
const spyMessagesPage = (s: OperatorModelStore) => vi.spyOn(s, 'messagesPage');
const spyReadiness = (c: CoordStore) => vi.spyOn(c, 'readinessChanges');

async function rig(opts: RigOpts = {}): Promise<Rig> {
  const home = mkTmp('ccrc-chat-door-');
  seedRoster(home);
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const run: Runner = async () => ({ ran: true, code: 0, stdout: '', stderr: '' });
  const base = loadConfig({ CCRC_HOME: home });
  const cfg = { ...base, authEnabled: opts.auth ?? true, cookieSecure: false, ...(opts.origin === undefined ? {} : { origin: opts.origin }) };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  vi.spyOn(coord, 'designationRead').mockReturnValue(opts.designation ?? designated(LANE_A, 1));
  const readinessChanges = spyReadiness(coord);
  const store = new OperatorModelStore(openOperatorModelDb(defaultOperatorModelDbPath(home)), issuerDouble());
  const messagesPage = spyMessagesPage(store);
  const journal = { appendInTx: () => ({ ok: false, error: 'authority-unmeasured', detail: 'a fixture journal appends nothing' }) } as unknown as OverlordAuthorityJournal;
  const time = fakeTime();
  const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), time: time.ports, coord, mailToken: BOX_TOKEN,
    operatorModel: store, overlordAuthority: journal };
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
  return { app, coord, store, cookie, messagesPage, readinessChanges };
}

const get = (r: Rig, url: string) => r.app.inject({ method: 'GET', url, headers: r.cookie === '' ? {} : { cookie: r.cookie } });
const THREAD = '/api/overlord/chat';

// ── the fixture's seeds ────────────────────────────────────────────────────────────────────────────────────────────────────

const storeDb = (s: OperatorModelStore): DatabaseSync => (s as never as { db: DatabaseSync }).db;
interface LedgerRow { door: string; caller: string; scope: string; count: number; outcome: string; generation: number | null; generationRead: string; turnState: string | null }
/** Every read-ledger line, oldest first, as plain objects. */
const ledger = (r: Rig): LedgerRow[] =>
  (storeDb(r.store).prepare('SELECT door, caller, scope, count, outcome, generation, generationRead, turnState FROM read_ledger ORDER BY id').all() as unknown as LedgerRow[])
    .map((x) => ({ ...x }));

/** `n` served lines of `door`, all one second before the fake clock's now, through the store's own writer. */
function seedLines(r: Rig, n: number, over: Partial<ReadLine>): void {
  for (let i = 0; i < n; i += 1) {
    const w = r.store.recordRead({ at: FAKE_T0 - 1_000, door: 'chat', caller: 'operator', scope: `session:${LANE_A}`, count: 1, outcome: 'rows',
      generation: null, generationRead: 'not-a-session', turnState: null, ...over });
    if (!w.ok) throw new Error(`seed line ${i}: ${w.error} ${w.detail}`);
  }
}
const OVERLORD_LINE: Partial<ReadLine> = { caller: 'overlord', generation: 1, generationRead: 'measured', turnState: 'done' };

interface MessageSeed {
  id: number; at: number; text: string; term?: number; state?: string;
  queuedAt?: number | null; deliveredAt?: number | null; pickedUpAt?: number | null; settledAt?: number | null; settledBy?: string | null;
}
/** One `operator_messages` row, straight into the table (the route that records one is another suite's subject). */
function seedMessage(r: Rig, m: MessageSeed): void {
  storeDb(r.store).prepare('INSERT INTO operator_messages (id, at, sessionId, term, actor, sha256, text, cut, state, queuedAt, deliveredAt, pickedUpAt, settledAt, settledBy, spentAt) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, NULL)')
    .run(m.id, m.at, LANE_A, m.term ?? 1, 'Fixture browser abcdef01', 'a'.repeat(64), m.text, m.state ?? 'queued',
      m.queuedAt ?? null, m.deliveredAt ?? null, m.pickedUpAt ?? null, m.settledAt ?? null, m.settledBy ?? null);
}

/** A readiness change, through the readiness store's one writer. */
function seedReadiness(r: Rig, word: string, at: number): void {
  const w = recordReadiness(r.coord.db, { word, why: null, until: null, strandCause: null, restartable: false, sessionId: LANE_A } as ReadinessWrite, at);
  if (!w.ok) throw new Error(`seed readiness ${word}: ${w.why}`);
}

interface GenSeed { sessionId: string; term: number; at: number }
let reports = 0;
/** Generations of the identity `overlord`, in order, through the store's writers (`continuity-generations-of.test.ts`'s recipe): a mint in
 *  the same term ends the live row (`n` rises), a mint in a new term follows the previous body's retirement (a rebind). The LAST one is live. */
function seedGenerations(coord: CoordStore, seeds: readonly GenSeed[]): void {
  seeds.forEach((g, i) => {
    reports += 1;
    const uuid = `${String((i % 9) + 1).repeat(8)}-1111-4111-8111-1111111${String(reports).padStart(5, '0')}`;
    const start = coord.insertStart({ sessionId: g.sessionId, reportId: `r-${reports}`, uuid, source: 'clear', model: 'claude-opus-5-5', rowIncarnation: null, reportedAt: g.at, receivedAt: g.at });
    if (!start.ok) throw new Error('start not recorded');
    const live = coord.liveGenerationOfIdentity('overlord');
    if (!live.ok) throw new Error('live generation unreadable');
    const prev = i === 0 ? null : seeds[i - 1]!;
    let ended: Parameters<CoordStore['mintGeneration']>[1] = null;
    if (live.row !== null && prev !== null) {
      if (prev.term === g.term) ended = live.row;
      else tx(coord.db, () => { endOverlordGeneration(coord.db, prev.sessionId, g.at - 1); });
    }
    const input: MintInput = {
      identity: 'overlord', sessionId: g.sessionId, role: 'coordinator', term: g.term, rowIncarnation: null, startId: start.id, startReportedAt: g.at, resumed: false,
      model: 'claude-opus-5-5', lane: 'lane-a', host: null, outcome: 'crashed', mono: 1_000, proc: 'p1', now: g.at,
    };
    const m = coord.mintGeneration(input, ended, true);
    if (!m.ok) throw new Error(`mint ${m.kind}`);
  });
}

// ── reading an answer ──────────────────────────────────────────────────────────────────────────────────────────────────────

const parsed = (body: unknown): ChatThread => {
  const t = readChatThread(body);
  if (!t.ok) throw new Error(`the answer is no ChatThread: ${t.detail}`);
  expect(t.skipped, 'no entry of a kind this build does not know').toBe(0);
  return t.thread;
};
/** The thread's entries as short tags: `mN` a message, `sN:word` its server line, `dT.N` a divider (`*` current, `+` new term). */
const shape = (entries: readonly ChatEntry[]): string[] => entries.map((e) =>
  e.kind === 'message' ? `m${e.row.id}` : e.kind === 'server-line' ? `s${e.messageId}:${e.word}` : `d${e.gen.term}.${e.gen.n}${e.current ? '*' : ''}${e.newTerm ? '+' : ''}`);
const messageEntries = (t: ChatThread) => t.entries.filter((e): e is Extract<ChatEntry, { kind: 'message' }> => e.kind === 'message');

const T = FAKE_T0;
/** Fixture A: the designated Overlord at term 1, two generations, three messages (one a generation), the word `renewing` only for the second. */
function fixtureA(r: Rig): void {
  seedGenerations(r.coord, [{ sessionId: LANE_A, term: 1, at: T - 5_000 }, { sessionId: LANE_A, term: 1, at: T - 3_000 }]);
  seedReadiness(r, 'ready', T - 6_000);
  seedReadiness(r, 'renewing', T - 3_000);
  seedReadiness(r, 'ready', T - 2_000);
  seedMessage(r, { id: 1, at: T - 4_500, text: 'fixture message one', state: 'picked-up', queuedAt: T - 4_400, deliveredAt: T - 4_300, pickedUpAt: T - 4_200 });
  seedMessage(r, { id: 2, at: T - 2_500, text: 'fixture message two', state: 'queued', queuedAt: T - 2_400 });
  seedMessage(r, { id: 3, at: T - 1_500, text: 'fixture message three', state: 'recorded' });
}
const FIXTURE_A_TEXTS = ['fixture message one', 'fixture message two', 'fixture message three'];

// ── the gate, before anything is read ──────────────────────────────────────────────────────────────────────────────────────

describe('GET /api/overlord/chat: the account gate, before any read', () => {
  it('sign-in off answers auth-off (501), a plain-HTTP origin insecure-origin (403), an unsigned caller unauthenticated (401); each reads no store and writes no line', async () => {
    const off = await rig({ auth: false });
    const a = await get(off, THREAD);
    expect([a.statusCode, a.json().error]).toEqual([REFUSAL_STATUS['auth-off'], 'auth-off']);
    const insecure = await rig({ origin: 'http://example.test' });
    const b = await get(insecure, THREAD);
    expect([b.statusCode, b.json().error]).toEqual([REFUSAL_STATUS['insecure-origin'], 'insecure-origin']);
    const armed = await rig();
    armed.cookie = '';
    const c = await get(armed, THREAD);
    expect([c.statusCode, c.json().error]).toEqual([REFUSAL_STATUS['unauthenticated'], 'unauthenticated']);
    for (const r of [off, insecure, armed]) {
      expect(r.messagesPage).not.toHaveBeenCalled();
      expect(r.readinessChanges).not.toHaveBeenCalled();
      expect(ledger(r)).toEqual([]);
    }
  });
});

describe('GET /api/overlord/chat: the query', () => {
  it('a query readChatThreadQuery refuses answers bad-request (400), before any read, and writes no line', async () => {
    const r = await rig();
    for (const q of ['before=0', 'before=abc', 'before=-1', 'before=1.5', 'before=01', 'before=', 'before=1&before=2', 'after=1', 'before=1&term=1']) {
      const res = await get(r, `${THREAD}?${q}`);
      expect([res.statusCode, res.json().error], q).toEqual([REFUSAL_STATUS['bad-request'], 'bad-request']);
    }
    expect(r.messagesPage).not.toHaveBeenCalled();
    expect(ledger(r)).toEqual([]);
  });
});

describe('GET /api/overlord/chat: the designation', () => {
  it('an unreadable designation answers 502 unmeasured, reads no message, writes no line', async () => {
    const r = await rig({ designation: UNMEASURED });
    const res = await get(r, THREAD);
    expect([res.statusCode, res.json().error]).toEqual([REFUSAL_STATUS['unmeasured'], 'unmeasured']);
    expect(r.messagesPage).not.toHaveBeenCalled();
    expect(ledger(r)).toEqual([]);
  });

  it('no designation is a measured absence: 200, designation none, no session, no term, no entry, no read and no line', async () => {
    const r = await rig({ designation: NOT_DESIGNATED });
    fixtureA(r);   // a record exists; with nobody designated none of it is drawn
    const res = await get(r, THREAD);
    expect(res.statusCode, res.body).toBe(200);
    const t = parsed(res.json());
    expect([t.designation, t.sessionId, t.term, t.entries]).toEqual(['none', null, null, []]);
    expect(r.messagesPage).not.toHaveBeenCalled();
    expect(ledger(r)).toEqual([]);
  });
});

// ── the read ceiling: the console's own lines only ─────────────────────────────────────────────────────────────────────────

describe('GET /api/overlord/chat: the read ceiling (door chat, 720 an hour, the operator\'s lines only)', () => {
  it('720 served operator lines of door chat in the hour answer 429 read-ceiling with retryAfterS, read no message, and write the one ceiling line', async () => {
    const r = await rig();
    fixtureA(r);
    seedLines(r, 720, {});
    const res = await get(r, THREAD);
    expect([res.statusCode, res.json().error]).toEqual([REFUSAL_STATUS['read-ceiling'], 'read-ceiling']);
    expect(res.json().retryAfterS, 'the oldest line leaves the hour in 3599 s').toBe(3_599);
    expect(r.messagesPage).not.toHaveBeenCalled();
    const lines = ledger(r);
    expect(lines).toHaveLength(721);
    expect(lines.at(-1)).toMatchObject({ door: 'chat', caller: 'operator', count: 0, outcome: 'read-ceiling', generation: null, generationRead: 'not-a-session', turnState: null });
  });

  it('719 served operator lines still serve the read (the boundary), and the read adds its own served line', async () => {
    const r = await rig();
    fixtureA(r);
    seedLines(r, 719, {});
    const res = await get(r, THREAD);
    expect(res.statusCode, res.body).toBe(200);
    expect(ledger(r)).toHaveLength(720);
  });

  it('720 lines of the Overlord on this door and 720 of its door messages do NOT move the console\'s ceiling: the read is served', async () => {
    const r = await rig();
    fixtureA(r);
    seedLines(r, 720, { ...OVERLORD_LINE, door: 'chat', scope: 'overlord-fixture' });
    seedLines(r, 720, { ...OVERLORD_LINE, door: 'messages', scope: 'messages' });
    const res = await get(r, THREAD);
    expect(res.statusCode, res.body).toBe(200);
    expect(parsed(res.json()).designation).toBe('designated');
    expect(ledger(r).at(-1)).toMatchObject({ door: 'chat', caller: 'operator', outcome: 'rows' });
  });
});

// ── the thread ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('GET /api/overlord/chat: the thread', () => {
  it('a designated Overlord with three messages across two generations answers both dividers, the three messages in order with their ticks, and ONE server line, under the message recorded while the word was renewing', async () => {
    const r = await rig();
    fixtureA(r);
    const res = await get(r, THREAD);
    expect(res.statusCode, res.body).toBe(200);
    const t = parsed(res.json());
    expect([t.designation, t.sessionId, t.term]).toEqual(['designated', LANE_A, 1]);
    expect(shape(t.entries)).toEqual(['d1.1', 'm1', 'd1.2*', 'm2', 's2:renewing', 'm3']);
    // the dividers, by the start report's time; the one before the live generation is current; nothing pages in W1's measured arm
    expect(t.entries.filter((e) => e.kind === 'divider')).toEqual([
      { kind: 'divider', gen: { term: 1, n: 1 }, at: T - 5_000, current: false, newTerm: false, earlier: 'not-pageable' },
      { kind: 'divider', gen: { term: 1, n: 2 }, at: T - 3_000, current: true, newTerm: false, earlier: 'not-pageable' },
    ]);
    // the one server line is the renewing line, word and text
    expect(t.entries.find((e) => e.kind === 'server-line')).toEqual({ kind: 'server-line', messageId: 2, text: CHAT_SERVER_LINE_MAP.renewing, word: 'renewing' });
    // the ticks: the wire carries them as the one derivation makes them, and each row reads as stored
    const [m1, m2, m3] = messageEntries(t);
    expect(m1!.ticks.lit).toEqual({ recorded: true, delivery: true, 'picked-up': true, settled: false });
    expect(m1!.ticks.delivery).toBe('delivered');
    expect(m2!.ticks.lit).toEqual({ recorded: true, delivery: true, 'picked-up': false, settled: false });
    expect(m2!.ticks.delivery).toBe('queued');
    expect(m3!.ticks.lit).toEqual({ recorded: true, delivery: false, 'picked-up': false, settled: false });
    const raw = (res.json().entries as { kind: string; ticks?: unknown; row?: unknown }[]).filter((e) => e.kind === 'message');
    expect(raw.map((e) => e.ticks)).toEqual(messageEntries(t).map((e) => chatTicksOf(e.row)));
    expect([t.messages, t.generations, t.readiness]).toEqual([
      { kind: 'read', value: { more: false } }, { kind: 'read', value: { count: 2 } }, { kind: 'read', value: { oldest: T - 6_000 } },
    ]);
    // the facts, each read once
    expect(r.messagesPage).toHaveBeenCalledTimes(1);
    expect(r.messagesPage).toHaveBeenCalledWith(null, 100);
    // The readiness history is read from the start (since 0): the message at T - 4_500 has no server line only because the `ready` row
    // in force then (T - 6_000) was read; a narrower read would leave it `not-on-record`, with a line under it.
  });

  it('after a rebind (term 1 run by one body, term 2 by another, the second designated at term 2) both terms\' dividers are answered and the first of term 2 carries newTerm', async () => {
    const r = await rig({ designation: designated(LANE_B, 2) });
    seedGenerations(r.coord, [
      { sessionId: LANE_A, term: 1, at: T - 8_000 }, { sessionId: LANE_A, term: 1, at: T - 6_000 }, { sessionId: LANE_B, term: 2, at: T - 4_000 },
    ]);
    seedReadiness(r, 'ready', T - 9_000);
    seedMessage(r, { id: 1, at: T - 7_000, text: 'fixture message one', term: 1 });
    seedMessage(r, { id: 2, at: T - 5_000, text: 'fixture message two', term: 1 });
    seedMessage(r, { id: 3, at: T - 3_000, text: 'fixture message three', term: 2 });
    const res = await get(r, THREAD);
    expect(res.statusCode, res.body).toBe(200);
    const t = parsed(res.json());
    expect([t.designation, t.sessionId, t.term]).toEqual(['designated', LANE_B, 2]);
    expect(shape(t.entries)).toEqual(['d1.1', 'm1', 'd1.2', 'm2', 'd2.1*+', 'm3']);
    const dividers = t.entries.filter((e): e is Extract<ChatEntry, { kind: 'divider' }> => e.kind === 'divider');
    expect(dividers.map((d) => [d.gen.term, d.gen.n, d.newTerm, d.current, d.earlier])).toEqual([
      [1, 1, false, false, 'not-pageable'], [1, 2, false, false, 'not-pageable'], [2, 1, true, true, 'not-pageable'],
    ]);
    expect(t.generations).toEqual({ kind: 'read', value: { count: 3 } });
    expect(ledger(r)).toMatchObject([{ door: 'chat', caller: 'operator', scope: `session:${LANE_B}`, count: 3, outcome: 'rows' }]);
  });

  it('before pages back: 101 messages answer 100 with more true, and before=<the oldest shown id> answers the one left with more false', async () => {
    const r = await rig();
    seedReadiness(r, 'ready', T - 1_000_000);
    for (let id = 1; id <= 101; id += 1) seedMessage(r, { id, at: T - 500_000 + id * 1_000, text: `fixture message ${id}`, state: 'queued', queuedAt: T - 500_000 + id * 1_000 });
    const first = await get(r, THREAD);
    expect(first.statusCode, first.body).toBe(200);
    const page1 = parsed(first.json());
    const ids1 = messageEntries(page1).map((e) => e.row.id);
    expect(ids1).toEqual(Array.from({ length: 100 }, (_, i) => i + 2));
    expect(page1.messages).toEqual({ kind: 'read', value: { more: true } });
    expect(r.messagesPage).toHaveBeenLastCalledWith(null, 100);
    const second = await get(r, `${THREAD}?before=${ids1[0]}`);
    expect(second.statusCode, second.body).toBe(200);
    const page2 = parsed(second.json());
    expect(messageEntries(page2).map((e) => e.row.id)).toEqual([1]);
    expect(page2.messages).toEqual({ kind: 'read', value: { more: false } });
    expect(r.messagesPage).toHaveBeenLastCalledWith(ids1[0], 100);
    // each served page is one line, counting the messages it handed
    expect(ledger(r).map((l) => [l.door, l.count, l.outcome])).toEqual([['chat', 100, 'rows'], ['chat', 1, 'rows']]);
  });

  it('every message entry\'s text is one the store held, and the answer carries no other message text', async () => {
    const r = await rig();
    fixtureA(r);
    const res = await get(r, THREAD);
    expect(res.statusCode, res.body).toBe(200);
    const t = parsed(res.json());
    expect(messageEntries(t).map((e) => e.row.text)).toEqual(FIXTURE_A_TEXTS);
    // nothing in the body reads as a message text but those three: the other strings are words of the vocabulary
    const stored = new Set(FIXTURE_A_TEXTS);
    const serverText = new Set([...Object.values(CHAT_SERVER_LINE_MAP).filter((x): x is string => x !== null), CHAT_SERVER_LINE_UNMEASURED]);
    for (const e of t.entries) {
      if (e.kind === 'message') expect(stored.has(e.row.text)).toBe(true);
      if (e.kind === 'server-line') expect(serverText.has(e.text)).toBe(true);
    }
    expect(JSON.stringify(res.json())).not.toMatch(/hunter|password/);
  });
});

// ── a part that cannot be read ─────────────────────────────────────────────────────────────────────────────────────────────

describe('GET /api/overlord/chat: an unreadable part is said, never an empty one (200)', () => {
  it('messages that cannot be read answer 200 with messages.kind unmeasured and no message entry; the dividers stay, and the line records messages-unmeasured with no count', async () => {
    const r = await rig();
    fixtureA(r);
    r.messagesPage.mockReturnValue({ kind: 'unmeasured', why: 'fixture: the store could not be read' });
    const res = await get(r, THREAD);
    expect(res.statusCode, res.body).toBe(200);
    const t = parsed(res.json());
    expect(t.messages.kind).toBe('unmeasured');
    expect(t.entries.some((e) => e.kind === 'message' || e.kind === 'server-line')).toBe(false);
    expect(shape(t.entries)).toEqual(['d1.1', 'd1.2*']);
    expect(t.generations.kind).toBe('read');
    expect(ledger(r)).toMatchObject([{ door: 'chat', caller: 'operator', scope: `session:${LANE_A}`, count: 0, outcome: 'messages-unmeasured', generationRead: 'not-a-session', turnState: null }]);
  });

  it('a closed private store stops the read at the runner, which cannot count the ceiling: 502 unmeasured, no message read, nothing composed', async () => {
    const r = await rig();
    fixtureA(r);
    storeDb(r.store).close();
    const res = await get(r, THREAD);
    expect([res.statusCode, res.json().error]).toEqual([REFUSAL_STATUS['unmeasured'], 'unmeasured']);
    expect(r.messagesPage).not.toHaveBeenCalled();
  });

  it('a readiness history the reader cannot read draws the not-on-record line under EVERY message and reports readiness.kind unmeasured', async () => {
    const r = await rig();
    fixtureA(r);
    // a row whose word this build does not know fails the whole read (`readinessChanges` is all-or-failure)
    r.coord.db.prepare('INSERT INTO overlord_readiness (sessionId, word, why, untilAt, strandCause, restartable, at, seq, pushedAt) VALUES (?, ?, NULL, NULL, NULL, 0, ?, NULL, NULL)')
      .run(LANE_A, 'not-a-readiness-word', T - 1_000);
    const res = await get(r, THREAD);
    expect(res.statusCode, res.body).toBe(200);
    const t = parsed(res.json());
    expect(t.readiness.kind).toBe('unmeasured');
    expect(shape(t.entries)).toEqual(['d1.1', 'm1', `s1:${NOT_ON_RECORD}`, 'd1.2*', 'm2', `s2:${NOT_ON_RECORD}`, 'm3', `s3:${NOT_ON_RECORD}`]);
    for (const e of t.entries) if (e.kind === 'server-line') expect(e.text).toBe(CHAT_SERVER_LINE_UNMEASURED);
    expect(t.messages.kind).toBe('read');
    expect(ledger(r)).toMatchObject([{ door: 'chat', count: 3, outcome: 'rows' }]);
  });

  it('a generation row the reader cannot read draws no divider and reports generations.kind unmeasured; the messages are still answered', async () => {
    const r = await rig();
    fixtureA(r);
    r.coord.db.exec("UPDATE continuity_generations SET term = 'x' WHERE n = 2");
    const res = await get(r, THREAD);
    expect(res.statusCode, res.body).toBe(200);
    const t = parsed(res.json());
    expect(t.generations.kind).toBe('unmeasured');
    expect(t.entries.some((e) => e.kind === 'divider')).toBe(false);
    expect(shape(t.entries)).toEqual(['m1', 'm2', 's2:renewing', 'm3']);
    expect(t.messages.kind).toBe('read');
  });
});

// ── the read-ledger line ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('GET /api/overlord/chat: the read-ledger line of a served read', () => {
  it('writes exactly one line a read: door chat, caller operator, scope session:<designated id>, the number of message entries, outcome rows, generation null, not-a-session, a null turn state', async () => {
    const r = await rig();
    fixtureA(r);
    expect(ledger(r)).toEqual([]);
    const first = await get(r, THREAD);
    expect(first.statusCode, first.body).toBe(200);
    expect(ledger(r)).toEqual([
      { door: 'chat', caller: 'operator', scope: `session:${LANE_A}`, count: 3, outcome: 'rows', generation: null, generationRead: 'not-a-session', turnState: null },
    ]);
    const second = await get(r, `${THREAD}?before=3`);
    expect(second.statusCode, second.body).toBe(200);
    expect(ledger(r)).toHaveLength(2);
    expect(ledger(r)[1]).toEqual({ door: 'chat', caller: 'operator', scope: `session:${LANE_A}`, count: 2, outcome: 'rows', generation: null, generationRead: 'not-a-session', turnState: null });
  });
});
