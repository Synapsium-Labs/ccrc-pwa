// Overlord W1, private store B, Task 5 (plan w1-private-store.md; spec §3.8 H7): the console's prompt to the designated session is
// RECORDED in the private store, then NUDGED through the mail lane, and nothing is typed. Three parts: the route over a real
// `CoordStore`, a real `OperatorModelStore` (an issuer double for the privacy journal) and the real account gate, armed, with a
// real sign-in; the mail lane's operator-message branch (`sweepMail`), driven the way `mail-sweep.test.ts` drives it; and the
// pure deciders' cases (`sim/operatorModelSets.ts`, the same cases the mutation floors judge). Fixture HOMEs only; neutral names.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { FleetWatcher } from '../src/watch.js';
import { renderMailNudge, renderOperatorMessageNudge, mailNudgeOf, resumeRuleOf } from '../src/coord/envelope.js';
import * as deciders from '../src/operatorModel/messages.js';
import { OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { settleOperatorNudge } from '../src/operatorModel/nudgeLane.js';
import { isOperatorMessageMail, isSendKey, operatorMessageSubject } from '../../shared/operatorMessages.js';
import { INBOX_WAKE_SUBJECT, readInboxWakeBody, renderInboxWakeBody, renderInboxWakeLine, renderSpotProbeLine } from '../../shared/overlordInbox.js';
import { SPOT_PROBE_SUBJECT } from '../src/continuity/renewalFeed.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import * as bodyDeciders from '../src/operatorModel/promptBody.js';
import { settlementMarkCases, promptTargetCases, promptBodyCases } from './sim/operatorModelSets.js';
import { seedRoster, testDeps, withFakeClock } from './helpers.js';
import { fakeTime, FAKE_T0, type FakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { quietAtTestEnd } from './laneQuiet.js';
import { sendPrompt } from '../src/inject/send.js';
import { MAIL_TOKEN_HEADER } from '../src/coord/token.js';

// ── the deciders' cases, against the real module ───────────────────────────────────────────────────────────────────────

vi.setConfig({ testTimeout: 90_000 });

describe('settlementMarkOf (open question 8)', () => {
  for (const [name, fn] of Object.entries(settlementMarkCases(deciders))) it(name, fn);
});
describe('promptTargetVerdict (open questions 16 and 18)', () => {
  for (const [name, fn] of Object.entries(promptTargetCases(deciders))) it(name, fn);
});
describe('promptBodyVerdict (review 2550 F6)', () => {
  for (const [name, fn] of Object.entries(promptBodyCases(bodyDeciders))) it(name, fn);
});
describe('isSendKey (open question 17)', () => {
  it('16 to 64 characters of A-Z a-z 0-9 _ -, nothing else', () => {
    expect(isSendKey('a'.repeat(16))).toBe(true);
    expect(isSendKey('A-b_9'.repeat(12) + 'abcd')).toBe(true);   // 64
    expect(isSendKey('a'.repeat(15))).toBe(false);
    expect(isSendKey('a'.repeat(65))).toBe(false);
    for (const bad of ['a'.repeat(15) + ' ', 'a'.repeat(15) + '.', 'a'.repeat(15) + '\n', 'a'.repeat(15) + 'é', '', 7, null, undefined, {}]) {
      expect(isSendKey(bad), String(bad)).toBe(false);
    }
  });
});

// ── the route ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
const OVERLORD = 'lane-a-project-a';
const OTHER = 'lane-b-project-a';
const KEY = 'send-key-0123456789abcdef';
const BOX_TOKEN = 'box-token-fixture-0123456789';
const VIEW = {} as never;
const designated = (sessionId: string, term = 1): DesignationRead => ({ kind: 'designated', sessionId, term, row: VIEW });
const NOT_DESIGNATED: DesignationRead = { kind: 'not-designated', row: null };

/** A privacy journal double: issues one above the larger of the store's highest and its own, and counts its records. */
function issuerDouble(): PrivacyIssuer & { records: number[] } {
  const records: number[] = [];
  return { kind: 'ready', records, issue(storeHighest) { const id = Math.max(storeHighest ?? 0, records.at(-1) ?? 0) + 1; records.push(id); return { ok: true, id }; } };
}

let apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps) await a.close();
  apps = [];
  vi.restoreAllMocks();
  removeTmpFixtures();
});

interface Rig {
  app: FastifyInstance; coord: CoordStore; store: OperatorModelStore; journal: ReturnType<typeof issuerDouble>;
  calls: string[][]; time: FakeTime; cookie: string; order: string[];
}
interface RigOpts { auth?: boolean; origin?: string; privacy?: 'ready' | 'refused'; noStore?: boolean; designation?: DesignationRead }

/** The server over a two-session registry (the Overlord's and another), a real coord.db, a real private store and the armed
 *  account gate. The pane answers an empty box, the echo of `hello`, then the emptied box, so a typed prompt submits. */
async function rig(opts: RigOpts = {}): Promise<Rig> {
  const home = mkTmp('ccrc-prompt-record-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const id of [OVERLORD, OTHER]) {
    for (const [k, v] of Object.entries({ wrapper: 'claude-a', project: id, workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1' })) {
      writeFileSync(path.join(reg, `${id}.${k}`), v);
    }
  }
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const panes = ['scrollback\n❯ \n', 'scrollback\n❯ hello\n', 'scrollback\n❯ \n'];
  const calls: string[][] = [];
  let capIdx = 0;
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'capture-pane') { const pane = panes[Math.min(capIdx, panes.length - 1)]!; capIdx += 1; return { ran: true, code: 0, stdout: pane, stderr: '' }; }
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: '4242\n', stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const base = loadConfig({ CCRC_HOME: home });
  const cfg = { ...base, authEnabled: opts.auth ?? true, cookieSecure: false, ...(opts.origin === undefined ? {} : { origin: opts.origin }) };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  vi.spyOn(coord, 'designationRead').mockReturnValue(opts.designation ?? designated(OVERLORD, 1));
  const journal = issuerDouble();
  const store = new OperatorModelStore(openOperatorModelDb(defaultOperatorModelDbPath(home)),
    opts.privacy === 'refused' ? { kind: 'refused', code: 'malformed', detail: 'fixture' } : journal);
  const order: string[] = [];
  const recordMessage = store.recordMessage.bind(store);
  vi.spyOn(store, 'recordMessage').mockImplementation((m) => { order.push('record'); return recordMessage(m); });
  const moveMessage = store.moveMessage.bind(store);
  vi.spyOn(store, 'moveMessage').mockImplementation((...a) => { order.push(`move:${a[1]}`); return moveMessage(...a); });
  const insertMail = coord.insertMail.bind(coord);
  vi.spyOn(coord, 'insertMail').mockImplementation((m) => { order.push('mail'); return insertMail(m); });
  const time = fakeTime();
  const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), time: time.ports, coord, mailToken: BOX_TOKEN,
    ...(opts.noStore === true ? {} : { operatorModel: store }) };
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
  return { app, coord, store, journal, calls, time, cookie, order };
}

const post = (r: Rig, id: string, payload: Record<string, unknown>) =>
  r.app.inject({ method: 'POST', url: `/api/sessions/${id}/prompt`, payload, headers: r.cookie === '' ? {} : { cookie: r.cookie } });
const typed = (r: Rig): string[][] => r.calls.filter((c) => c.includes('send-keys'));
const mails = (r: Rig): { fromId: string; toId: string; kind: string; subject: string; body: string }[] =>
  r.coord.db.prepare('SELECT fromId, toId, kind, subject, body FROM mail ORDER BY id').all() as never;
const deliveries = (r: Rig): { state: string }[] => r.coord.db.prepare('SELECT state FROM mail_deliveries ORDER BY id').all() as never;
const marks = (r: Rig) => r.coord.operatorMarks();
const rowOf = (r: Rig, id: number) => { const m = r.store.messageById(id); return m.kind === 'measured' && m.value !== 'absent' ? m.value : null; };
/** The stored actor column, read straight off the table. */
const actorOf = (r: Rig, id: number): string => (r.store as never as { db: { prepare(s: string): { get(i: number): { actor: string } } } }).db.prepare('SELECT actor FROM operator_messages WHERE id = ?').get(id).actor;

describe('the prompt route, to the designated session', () => {
  it('records one row and one journal record, queues one mail naming the id and no word of the text, writes the @overlord mark, moves the row to queued, and types nothing', async () => {
    const r = await rig();
    const res = await post(r, OVERLORD, { text: 'move the portfolio forward, password hunter2hunter2' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true, messageId: 1, cut: false, state: 'queued', replay: false });
    expect(r.journal.records).toEqual([1]);
    expect(rowOf(r, 1)).toMatchObject({ id: 1, at: FAKE_T0, term: 1, state: 'queued', queuedAt: FAKE_T0, cut: false });
    expect(actorOf(r, 1)).toMatch(/ [0-9a-f]{8}$/);
    const m = mails(r);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ fromId: 'operator', toId: OVERLORD, kind: 'status', subject: operatorMessageSubject(1) });
    expect(m[0]!.body).toContain('1');
    expect(m[0]!.body).not.toMatch(/portfolio|forward|password|hunter/);
    expect(JSON.stringify(r.coord.db.prepare('SELECT envelope FROM mail_deliveries').all())).not.toMatch(/portfolio|forward|hunter/);
    expect(deliveries(r)).toEqual([{ state: 'queued' }]);
    expect(marks(r)).toEqual({ ok: true, rows: [{ programme: '@overlord', at: FAKE_T0, quiet: null }] });
    expect(typed(r)).toEqual([]);
  });

  it('records BEFORE the mail is queued, and moves to queued only after it (the order)', async () => {
    const r = await rig();
    expect((await post(r, OVERLORD, { text: 'hello' })).statusCode).toBe(200);
    expect(r.order).toEqual(['record', 'mail', 'move:queue']);
  });

  it('a failed record (the journal refused at boot) answers journal-unreadable 503, queues nothing and writes no mark', async () => {
    const r = await rig({ privacy: 'refused' });
    const res = await post(r, OVERLORD, { text: 'hello' });
    expect([res.statusCode, res.json().error]).toEqual([503, 'journal-unreadable']);
    expect(mails(r)).toEqual([]);
    expect(deliveries(r)).toEqual([]);
    expect(marks(r)).toEqual({ ok: true, rows: [] });
    expect(r.order).toEqual(['record']);
    expect(typed(r)).toEqual([]);
  });

  it('a route with no private store answers unavailable 503 and queues nothing', async () => {
    const r = await rig({ noStore: true });
    const res = await post(r, OVERLORD, { text: 'hello' });
    expect([res.statusCode, res.json().error]).toEqual([503, 'unavailable']);
    expect(mails(r)).toEqual([]);
  });

  it('a throw after the record leaves the row recorded, still answers ok, and the warning names the id and not the words', async () => {
    const r = await rig();
    vi.spyOn(r.coord, 'insertMail').mockImplementation(() => { throw new Error('disk full, secret words'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post(r, OVERLORD, { text: 'my private words' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, messageId: 1, state: 'recorded', replay: false });
    expect(rowOf(r, 1)).toMatchObject({ state: 'recorded', queuedAt: null });
    expect(mails(r)).toEqual([]);
    expect(marks(r)).toEqual({ ok: true, rows: [] });   // the transaction rolled back whole
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('message 1'))).toBe(true);
    expect(lines.join('\n')).not.toMatch(/private words|secret words|disk full/);
  });

  it('a prompt that names an attachment answers bad-attachment, before any record', async () => {
    const r = await rig();
    const res = await post(r, OVERLORD, { text: 'hello', attachments: ['/data/clips/x.png'] });
    expect([res.statusCode, res.json().error]).toEqual([400, 'bad-attachment']);
    expect(r.order).toEqual([]);
    expect(mails(r)).toEqual([]);
    // an empty array is no attachment
    expect((await post(r, OVERLORD, { text: 'hello', attachments: [] })).statusCode).toBe(200);
  });

  it('empty text answers bad-request, before any record', async () => {
    const r = await rig();
    for (const body of [{ text: '' }, {}, { text: 7 }]) {
      const res = await post(r, OVERLORD, body);
      expect([res.statusCode, res.json().error], JSON.stringify(body)).toEqual([400, 'bad-request']);
    }
    expect(r.order).toEqual([]);
  });

  it('a secret in the text is stored masked, and its hash is of the masked text', async () => {
    const r = await rig();
    const secret = 'sk-ant-api03-' + 'A1b2C3d4'.repeat(8);
    expect((await post(r, OVERLORD, { text: `use ${secret} please` })).statusCode).toBe(200);
    const row = rowOf(r, 1)!;
    expect(row.text).not.toContain(secret);
    expect(row.text).not.toContain('A1b2C3d4A1b2C3d4');
    const { createHash } = await import('node:crypto');
    expect(row.sha256).toBe(createHash('sha256').update(row.text, 'utf8').digest('hex'));
    expect(row.sha256).not.toBe(createHash('sha256').update(`use ${secret} please`, 'utf8').digest('hex'));
  });

  it('a marked message is settled by mark and still nudged; a message that merely contains the words is ordinary', async () => {
    const r = await rig();
    expect((await post(r, OVERLORD, { text: ' I command ' })).json()).toMatchObject({ messageId: 1, state: 'settled' });
    expect(rowOf(r, 1)).toMatchObject({ state: 'settled', settledBy: 'mark', settledAt: FAKE_T0, queuedAt: FAKE_T0 });
    expect(mails(r)).toHaveLength(1);
    expect((await post(r, OVERLORD, { text: 'I command you' })).json()).toMatchObject({ messageId: 2, state: 'queued' });
    expect(rowOf(r, 2)).toMatchObject({ state: 'queued', settledBy: null });
  });

  it('a renewing generation does not refuse the designated session\'s prompt (slug renewing-is-for-typed-prompts)', async () => {
    const r = await rig();
    const s = r.coord.insertStart({ sessionId: OVERLORD, reportId: 'r-1', uuid: '1'.repeat(36), source: 'startup', model: null, rowIncarnation: 'inc', reportedAt: 1, receivedAt: 1 });
    if (!s.ok) throw new Error('start');
    const w = r.coord.mintGeneration({ identity: OVERLORD, sessionId: OVERLORD, role: 'coordinator', term: 1, rowIncarnation: 'inc', startId: s.id, startReportedAt: 1,
      resumed: false, model: null, lane: 'claude-a', host: null, outcome: 'woken', mono: 1, proc: 'p1', now: 1 }, null, true);
    if (!w.ok) throw new Error('mint');
    r.coord.db.prepare("UPDATE continuity_generations SET state = 'clearing' WHERE id = ?").run(w.id);
    expect((await post(r, OVERLORD, { text: 'hello' })).statusCode).toBe(200);
    expect(rowOf(r, 1)).toMatchObject({ state: 'queued' });
    // …while another session keeps `renewing` as W1a builds it: not this test's subject, so it is not asserted here.
  });

  it('the same sendKey sent twice records one row and queues one nudge; the second answer carries the first id, replay: true and the current state', async () => {
    const r = await rig();
    const first = await post(r, OVERLORD, { text: 'hello', sendKey: KEY });
    expect(first.json()).toEqual({ ok: true, messageId: 1, cut: false, state: 'queued', replay: false });
    r.order.length = 0;
    const second = await post(r, OVERLORD, { text: 'hello', sendKey: KEY });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ ok: true, messageId: 1, cut: false, state: 'queued', replay: true });
    expect(r.order).toEqual(['record']);                 // no mail, no move
    expect(r.journal.records).toEqual([1]);
    expect(mails(r)).toHaveLength(1);
    expect(deliveries(r)).toHaveLength(1);
    // no second mark: the mark is still the first record's
    r.time.advance(5_000);
    await post(r, OVERLORD, { text: 'hello', sendKey: KEY });
    expect(marks(r)).toEqual({ ok: true, rows: [{ programme: '@overlord', at: FAKE_T0, quiet: null }] });
  });

  it('a malformed sendKey answers bad-request before any record; the same key with other text answers bad-request send-key-reused', async () => {
    const r = await rig();
    for (const sendKey of ['short', 'a'.repeat(65), 'has space 0123456789abcdef', 12345678901234567, null]) {
      const res = await post(r, OVERLORD, { text: 'hello', sendKey });
      expect([res.statusCode, res.json().error], String(sendKey)).toEqual([400, 'bad-request']);
    }
    expect(r.order).toEqual([]);
    expect((await post(r, OVERLORD, { text: 'hello', sendKey: KEY })).statusCode).toBe(200);
    const reused = await post(r, OVERLORD, { text: 'a different message', sendKey: KEY });
    expect([reused.statusCode, reused.json().error, reused.json().detail]).toEqual([400, 'bad-request', 'send-key-reused']);
    expect(mails(r)).toHaveLength(1);
  });

  it('the operator mark is the generations lane\'s to age: a prompt, then the marks before the next pass, show @overlord with quiet null', async () => {
    const r = await rig();
    await post(r, OVERLORD, { text: 'hello' });
    const read = marks(r);
    expect(read.ok && read.rows.map((x) => [x.programme, x.at, x.quiet])).toEqual([['@overlord', FAKE_T0, null]]);
    // a later prompt moves `at` and leaves `quiet` null: the reset has one owner
    r.time.advance(60_000);
    await post(r, OVERLORD, { text: 'again' });
    expect(marks(r)).toEqual({ ok: true, rows: [{ programme: '@overlord', at: FAKE_T0 + 60_000, quiet: null }] });
  });
});

describe('the gate, before anything is recorded', () => {
  it('auth off answers auth-off, a plain-HTTP origin insecure-origin, an unsigned caller unauthenticated; each writes nothing', async () => {
    const off = await rig({ auth: false });
    const a = await post(off, OVERLORD, { text: 'hello' });
    expect([a.statusCode, a.json().error]).toEqual([501, 'auth-off']);
    const insecure = await rig({ origin: 'http://example.test' });
    const b = await post(insecure, OVERLORD, { text: 'hello' });
    expect([b.statusCode, b.json().error]).toEqual([403, 'insecure-origin']);
    const armed = await rig();
    armed.cookie = '';
    const c = await post(armed, OVERLORD, { text: 'hello' });
    expect([c.statusCode, c.json().error]).toEqual([401, 'unauthenticated']);
    for (const r of [off, insecure, armed]) { expect(r.order).toEqual([]); expect(mails(r)).toEqual([]); expect(typed(r)).toEqual([]); }
  });
});

describe('the prompt route, to any other session or on another arm of the designation', () => {
  it('a prompt to any other session types as today and writes no row, no mail and no mark', async () => {
    const r = await rig();
    const res = await post(r, OTHER, { text: 'hello' });
    expect(res.statusCode, res.body).toBe(200);
    expect(typed(r).length).toBeGreaterThan(0);
    expect(r.order).toEqual([]);
    expect(mails(r)).toEqual([]);
    expect(marks(r)).toEqual({ ok: true, rows: [] });
  });

  it('nobody designated: every session is typed to, as before the Overlord existed', async () => {
    const r = await rig({ designation: NOT_DESIGNATED });
    expect((await post(r, OVERLORD, { text: 'hello' })).statusCode).toBe(200);
    expect(typed(r).length).toBeGreaterThan(0);
    expect(r.order).toEqual([]);
  });

  it('an unmeasured designation answers 502 unmeasured for the Overlord\'s id AND for any other session, and types nothing', async () => {
    const r = await rig({ designation: { kind: 'unmeasured', why: 'the designation row could not be read: fixture' } });
    for (const id of [OVERLORD, OTHER]) {
      const res = await post(r, id, { text: 'hello' });
      expect([res.statusCode, res.json().error], id).toEqual([502, 'unmeasured']);
    }
    expect(typed(r)).toEqual([]);
    expect(r.order).toEqual([]);
  });

  it('an overlordTerm to the designated session at another term, to a retired designation\'s old session, and to a rebound one\'s old session each answer 409 stale-designation, typing and recording nothing', async () => {
    const cases: [string, DesignationRead, string][] = [
      ['another term', designated(OVERLORD, 2), OVERLORD],
      ['retired', NOT_DESIGNATED, OVERLORD],
      ['rebound', designated(OTHER, 1), OVERLORD],
    ];
    for (const [label, designation, id] of cases) {
      const r = await rig({ designation });
      const res = await post(r, id, { text: 'hello', overlordTerm: 1 });
      expect([res.statusCode, res.json().error], label).toEqual([409, 'stale-designation']);
      expect(typed(r), label).toEqual([]);
      expect(r.order, label).toEqual([]);
      expect(mails(r), label).toEqual([]);
    }
  });

  it('with no overlordTerm the old session of a rebound designation is typed to, as today; a malformed overlordTerm is bad-request', async () => {
    const r = await rig({ designation: designated(OTHER, 1) });
    expect((await post(r, OVERLORD, { text: 'hello' })).statusCode).toBe(200);
    expect(typed(r).length).toBeGreaterThan(0);
    const bad = await post(r, OTHER, { text: 'hello', overlordTerm: -1 });
    expect([bad.statusCode, bad.json().error]).toEqual([400, 'bad-request']);
    expect(r.order).toEqual([]);
  });
});

describe('the prompt route, while the designation is pending or moves under a waiting send (review 2550 F1)', () => {
  const pending = (sessionId: string, kind: 'designate' | 'rebind') => ({ sessionId, kind, deadlineAt: 9, since: 1, actor: 'x', generation: null });
  const pendingOnly = (sessionId: string): DesignationRead => ({ kind: 'not-designated', row: { bound: null, pending: pending(sessionId, 'designate'), term: 1 } as never });
  const reads = (r: Rig) => r.coord.designationRead as unknown as { mockReturnValueOnce(v: DesignationRead): { mockReturnValue(v: DesignationRead): void } };

  it('a prompt with no term to a PENDING designate body, or a rebind\'s new body, answers 409 renewing and types and records nothing', async () => {
    const rebind: DesignationRead = { kind: 'designated', sessionId: OTHER, term: 2, row: { bound: { sessionId: OTHER, generation: 'g' }, pending: pending(OVERLORD, 'rebind'), term: 2 } as never };
    for (const [label, designation] of [['designate', pendingOnly(OVERLORD)], ['rebind', rebind]] as const) {
      const r = await rig({ designation });
      const res = await post(r, OVERLORD, { text: 'hello' });
      expect([res.statusCode, res.json().error], label).toEqual([409, 'renewing']);
      expect(typed(r), label).toEqual([]);
      expect(r.order, label).toEqual([]);
      expect(mails(r), label).toEqual([]);
    }
  });

  it('a goLive while the send waits for its queue slot records the prompt and types nothing', async () => {
    const r = await rig({ designation: NOT_DESIGNATED });
    reads(r).mockReturnValueOnce(NOT_DESIGNATED).mockReturnValue(designated(OVERLORD, 1));   // the verdict, then the slot's re-ask, then the route's
    const res = await post(r, OVERLORD, { text: 'hello' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, messageId: 1, replay: false });
    expect(typed(r)).toEqual([]);
    expect(r.order).toEqual(['record', 'mail', 'move:queue']);
    expect(mails(r)).toHaveLength(1);
  });

  it('a designation that turns unmeasured while the send waits refuses unmeasured and types nothing', async () => {
    const r = await rig({ designation: NOT_DESIGNATED });
    reads(r).mockReturnValueOnce(NOT_DESIGNATED).mockReturnValue({ kind: 'unmeasured', why: 'fixture' });
    const res = await post(r, OTHER, { text: 'hello' });
    expect([res.statusCode, res.json().error]).toEqual([502, 'unmeasured']);
    expect(typed(r)).toEqual([]);
  });

  it('a designation that stays put while the send waits is typed to as before', async () => {
    const r = await rig({ designation: NOT_DESIGNATED });
    expect((await post(r, OTHER, { text: 'hello' })).statusCode).toBe(200);
    expect(typed(r).length).toBeGreaterThan(0);
    expect(r.order).toEqual([]);
  });
});

describe('the slot re-ask sits INSIDE the queue slot (review 2627 F-3)', () => {
  it('a designation that moves while another send holds the session\'s slot answers target-moved, and nothing is typed', async () => {
    const calls: string[][] = [];
    const run: Runner = async (_cmd, args) => { calls.push([...args]); return { ran: true, code: 0, stdout: '❯ \n', stderr: '' }; };
    const queue = new KeyedQueue();
    let release!: () => void;
    let held!: Promise<void>;
    await new Promise<void>((started) => {
      held = queue.run(OVERLORD, () => new Promise<void>((resolve) => { release = resolve; started(); }));
    });
    let target: 'go' | 'stop' = 'go';
    const pending = sendPrompt({ tmux: new Tmux(run), queue, sleep: async () => {} }, OVERLORD, 'hello', { recheck: () => target });
    target = 'stop';   // the designation moved while the call waited for its turn
    release();
    await held;
    expect(await pending).toEqual({ ok: false, error: 'target-moved' });
    expect(calls.filter((c) => c[0] === 'send-keys')).toEqual([]);
  });
});

describe('a session that acks its own operator-message nudge (review 2627 F-1)', () => {
  const ack = (r: Rig, deliveryId: number) => r.app.inject({ method: 'POST', url: `/api/mail/${deliveryId}/ack`,
    payload: { fromId: OVERLORD, fromUuid: '1'.repeat(36) }, headers: { [MAIL_TOKEN_HEADER]: BOX_TOKEN } });
  const stateOfRow = (r: Rig, id: number) => { const s = r.store.messageStateOf(id); return s.kind === 'measured' ? s.value : 'unmeasured'; };
  const firstDelivery = (r: Rig): number => (r.coord.db.prepare('SELECT id FROM mail_deliveries ORDER BY id').get() as { id: number }).id;

  it('the session acks the nudge before the lane types it: the row moves to delivered at the ack, not at the next boot', async () => {
    const r = await rig();
    expect((await post(r, OVERLORD, { text: 'hello' })).statusCode).toBe(200);
    expect(stateOfRow(r, 1)).toBe('queued');
    const res = await ack(r, firstDelivery(r));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, already: false });
    expect(stateOfRow(r, 1)).toBe('delivered');
    expect(r.order).toEqual(['record', 'mail', 'move:queue', 'move:deliver']);
    // A second ack is `already`, and moves nothing again.
    expect((await ack(r, firstDelivery(r))).json()).toMatchObject({ already: true });
    expect(r.order.filter((o) => o === 'move:deliver')).toHaveLength(1);
  });

  it('an ack of any other mail leaves the operator message queued', async () => {
    const r = await rig();
    expect((await post(r, OVERLORD, { text: 'hello' })).statusCode).toBe(200);
    const mail = r.coord.insertMail({ fromId: OTHER, fromUuid: OTHER, toId: OVERLORD, runId: null, kind: 'status', subject: 'unrelated', body: 'b', artifacts: [] });
    const other = r.coord.queueDelivery(mail.id, OVERLORD, 'ccrc-mail test payload').id;
    expect((await ack(r, other)).statusCode).toBe(200);
    expect(stateOfRow(r, 1)).toBe('queued');
    expect(r.order.filter((o) => o.startsWith('move:'))).toEqual(['move:queue']);
  });
});

// ── the mail lane's operator-message branch ───────────────────────────────────────────────────────────────────────────

const ID = 'lane-a-project-a';
const UUID = 'a'.repeat(36);
const PID = 4242;
const NOW = 1_800_000_000_000;
const MAIL_QUIET_MS = 60_000;
const MAIL_REPLAY_MS = 600_000;
const emptyBox = '❯ \n';
const echoedBox = (text: string): string => `❯ ${text}\n`;
/** A box with its closing rule, the shape `resumeIfOwn: 'whole'` reads whole (`boxRows` needs the rule under the box). */
const framedBox = (text: string): string => `❯ ${text}\n${'─'.repeat(40)}\n`;
const LINE = renderOperatorMessageNudge(7);
/** An operator nudge's delivery reads the box once BEFORE `sendPrompt` (slug `whole-mode-never-types`), so each script below starts
 *  with that read. */

const seedRegistry = (home: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid: UUID, started: '1' })) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  writeFileSync(path.join(reg, `${ID}.hookstate.json`), JSON.stringify({ v: 1, state: 'done', sessionId: UUID, pid: PID, event: null, updatedAt: NOW - 61_000, ask: null, subagents: [] }));
  const dir = path.join(home, '.claude', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${PID}.json`), JSON.stringify({ pid: PID, sessionId: UUID, cwd: '/w/demo', name: null, nameSource: null, status: 'idle', statusUpdatedAt: NOW - MAIL_QUIET_MS - 1_000, version: '2.1.220' }));
};

const lane = (opts: { panes?: string[]; emptyAfterEnter?: boolean } = {}) => {
  const home = mkTmp('ccrc-prompt-record-lane-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const calls: string[][] = [];
  let capIdx = 0;
  const panes = opts.panes ?? [];
  const run: Runner = async (_cmd, args) => {
    calls.push([...args]);
    if (args[0] === 'has-session') return { ran: true, code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
    if (args[0] === 'capture-pane' && opts.emptyAfterEnter === true && calls.some((c) => c[0] === 'send-keys' && c[3] === 'Enter')) return { ran: true, code: 0, stdout: framedBox(''), stderr: '' };
    if (args[0] === 'capture-pane') { const pane = panes[Math.min(capIdx, panes.length - 1)] ?? null; capIdx++; return pane === null ? { ran: true, code: 1, stdout: '', stderr: '' } : { ran: true, code: 0, stdout: pane, stderr: '' }; }
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  return { home, calls, run };
};
const literalSends = (calls: string[][]): string[] => calls.filter((a) => a[0] === 'send-keys' && a[3] === '-l').map((a) => a[5]!);
const keyPresses = (calls: string[][]): string[] => calls.filter((a) => a[0] === 'send-keys' && a[3] !== '-l').map((a) => a[3]!);
const queue = (coord: CoordStore, fromId: string, subject: string): { mailId: number; id: number } => {
  const mail = coord.insertMail({ fromId, fromUuid: fromId, toId: ID, runId: null, kind: 'status', subject, body: 'b', artifacts: [] });
  return { mailId: mail.id, id: coord.queueDelivery(mail.id, ID, 'ccrc-mail test payload').id };
};
const stateOf = (coord: CoordStore, id: number): string => (coord.db.prepare('SELECT state FROM mail_deliveries WHERE id = ?').get(id) as { state: string }).state;

describe('sweepMail: the operator-message branch (open question 3)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  const primed = async (panes: string[], operatorModel?: Pick<OperatorModelStore, 'moveMessage'>, over: Partial<Deps> = {}, emptyAfterEnter = false) => {
    const h = lane({ panes, emptyAfterEnter });
    const coord = new CoordStore(openCoordDb(path.join(h.home, '.ccrc', 'coord.db')));
    const deps = { ...testDeps(h.home, h.run), coord, ...(operatorModel === undefined ? {} : { operatorModel: operatorModel as OperatorModelStore }), ...over } as Deps;
    const w = quietAtTestEnd(new FleetWatcher(withFakeClock(deps), new Bus(), 2000));
    await w.tick();
    seedRegistry(h.home);
    return { h, coord, w };
  };
  const store = (state: 'recorded' | 'queued' | 'delivered' | 'picked-up' = 'delivered') => ({
    moveMessage: vi.fn(() => ({ ok: true as const, value: { changed: true, state: 'delivered' as const } })),
    messageStateOf: vi.fn(() => ({ kind: 'measured' as const, value: state })),
  });

  it('the first delivery types the fixed line (the id, the door, no ccrc-api), moves the row to delivered, acks the delivery, and never replays it', async () => {
    const om = store();
    const { h, coord, w } = await primed([emptyBox, emptyBox, echoedBox(LINE), emptyBox], om);
    const { id } = queue(coord, 'operator', operatorMessageSubject(7));
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([LINE]);
    expect(LINE).toContain('Operator message 7');
    expect(LINE).toContain('messages door');
    expect(LINE).not.toContain('ccrc-api');
    expect(LINE.startsWith(renderMailNudge(ID).slice(0, 24))).toBe(true);
    expect(om.moveMessage).toHaveBeenCalledTimes(1);
    expect(om.moveMessage).toHaveBeenCalledWith(7, 'deliver', 'mail-lane', NOW);
    expect(stateOf(coord, id)).toBe('acked');
    // far past the replay window, and past the cooldown: an acked delivery is never due again
    vi.setSystemTime(NOW + MAIL_REPLAY_MS * 3);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([LINE]);
    expect(om.moveMessage).toHaveBeenCalledTimes(1);
  });

  it('a box holding THIS delivery\'s own line is resumed (Enter, no retype); a box holding another message\'s line is held as a draft', async () => {
    const own = store();
    const a = await primed([framedBox(LINE)], own, {}, true);
    const { id } = queue(a.coord, 'operator', operatorMessageSubject(7));
    await a.w.sweepMail();
    expect(keyPresses(a.h.calls)).toEqual(['Enter']);
    expect(literalSends(a.h.calls)).toEqual([]);
    expect(stateOf(a.coord, id)).toBe('acked');
    expect(own.moveMessage).toHaveBeenCalledWith(7, 'deliver', 'mail-lane', NOW);

    const other = store();
    const b = await primed([framedBox(renderOperatorMessageNudge(8))], other);
    const queued = queue(b.coord, 'operator', operatorMessageSubject(7));
    await b.w.sweepMail();
    expect(keyPresses(b.h.calls)).toEqual(['C-s']);          // the stash of a draft, never an Enter
    expect(literalSends(b.h.calls)).toEqual([]);
    expect(stateOf(b.coord, queued.id)).toBe('queued');
    expect(other.moveMessage).not.toHaveBeenCalled();
  });

  it('a GENERIC nudge never presses Enter on an operator message\'s line left in the box: it holds the line as a draft (review 2550 F2)', async () => {
    const om = store();
    const a = await primed([framedBox(LINE)], om);
    const generic = queue(a.coord, 'lane-b-project-a', 'hi');
    await a.w.sweepMail();
    expect(keyPresses(a.h.calls)).toEqual(['C-s']);          // the stash of a draft, never an Enter on message 7's line
    expect(literalSends(a.h.calls)).toEqual([]);              // and message 7's line is not typed a second time
    expect(stateOf(a.coord, generic.id)).toBe('queued');
    expect(om.moveMessage).not.toHaveBeenCalled();
    // the same box under a generic nudge that left its OWN line is still resumed (the generic resume is unchanged)
    const own = await primed([framedBox(renderMailNudge(ID))], undefined, {}, true);
    const second = queue(own.coord, 'lane-b-project-a', 'hi');
    await own.w.sweepMail();
    expect(keyPresses(own.h.calls)).toEqual(['Enter']);
    expect(stateOf(own.coord, second.id)).toBe('delivered');
  });

  it('a box that wrapped THIS delivery\'s own line over two rows is still resumed with one Enter and nothing typed (review 2550 F4)', async () => {
    const own = store();
    const wrapped = `❯ ${LINE.slice(0, 40)}\n  ${LINE.slice(40)}\n${'─'.repeat(40)}\n`;
    const a = await primed([wrapped], own, {}, true);
    const { id } = queue(a.coord, 'operator', operatorMessageSubject(7));
    await a.w.sweepMail();
    expect(keyPresses(a.h.calls)).toEqual(['Enter']);
    expect(literalSends(a.h.calls)).toEqual([]);
    expect(stateOf(a.coord, id)).toBe('acked');
    const op = mailNudgeOf(ID, { fromId: 'operator', subject: 'operator-message:7' });
    expect(resumeRuleOf(op, `${LINE.slice(0, 40)}\n${LINE.slice(40)}`)).toEqual({ resumeIfOwn: 'whole' });
    expect(resumeRuleOf(op, `${LINE.slice(0, 40)}\n${renderOperatorMessageNudge(8).slice(40)}`)).toEqual({});
  });

  it('a delivery of any other mail types renderMailNudge and calls nothing on the store', async () => {
    const om = store();
    const nudge = renderMailNudge(ID);
    const { h, coord, w } = await primed([emptyBox, echoedBox(nudge), emptyBox], om);
    const { id } = queue(coord, 'lane-b-project-a', 'hi');
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([nudge]);
    expect(stateOf(coord, id)).toBe('delivered');
    expect(om.moveMessage).not.toHaveBeenCalled();
    // an operator-sent mail that is not an operator-message subject is an ordinary mail too
    const second = queue(coord, 'operator', 'operator-message:not-a-number');
    expect(second.id).toBeGreaterThan(id);
    expect(isOperatorMessageMail({ fromId: 'operator', subject: 'operator-message:not-a-number' })).toBe(false);
    const op = mailNudgeOf(ID, { fromId: 'operator', subject: 'operator-message:7' });
    expect(op).toEqual({ line: LINE, operatorMessageId: 7 });
    expect(resumeRuleOf(op, LINE)).toEqual({ resumeIfOwn: 'whole' });                       // only this delivery's own line is resumed
    expect(resumeRuleOf(op, renderOperatorMessageNudge(8))).toEqual({});                    // another message's line is a draft
    expect(resumeRuleOf(op, '')).toEqual({});                                               // an empty box is typed into
    expect(resumeRuleOf(op, null)).toEqual({});
    const generic = mailNudgeOf(ID, { fromId: 'lane-b-project-a', subject: 'operator-message:7' });
    expect(generic).toEqual({ line: renderMailNudge(ID), operatorMessageId: null });
    expect(resumeRuleOf(generic, null)).toEqual({ resumeIfOwn: true });
  });

  it('with no store in the watcher\'s deps the branch still types its line and acks, and moves nothing', async () => {
    const { h, coord, w } = await primed([emptyBox, emptyBox, echoedBox(LINE), emptyBox]);
    const { id } = queue(coord, 'operator', operatorMessageSubject(7));
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([LINE]);
    expect(stateOf(coord, id)).toBe('acked');
  });

  it('a refused move is logged and does not stop the ack (each answer is read, nothing after it assumes it)', async () => {
    const om = { moveMessage: vi.fn(() => ({ ok: false as const, error: 'refused' as const, detail: 'fixture' })), messageStateOf: vi.fn(() => ({ kind: 'measured' as const, value: 'queued' as const })) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { coord, w } = await primed([emptyBox, emptyBox, echoedBox(LINE), emptyBox], om);
    const { id } = queue(coord, 'operator', operatorMessageSubject(7));
    await w.sweepMail();
    expect(stateOf(coord, id)).toBe('acked');
    expect(warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes('operator message 7') && l.includes('refused'))).toBe(true);
  });

  // The table's other two rows (question 8): a wake and the spot-probe notice, each typed to the designated session as its own fixed line.
  describe('the fixed-line table\'s other rows', () => {
    const WAKE_BODY = renderInboxWakeBody({ keys: ['probe-round:r1'], waiting: 2, firstDue: { kind: 'by', at: NOW + 140_000 } });
    const WAKE_LINE = renderInboxWakeLine(readInboxWakeBody(WAKE_BODY), NOW);
    const SPOT_LINE = renderSpotProbeLine();
    const designate = (coord: CoordStore, id: string): void => {
      coord.designationRead = () => ({ kind: 'designated', sessionId: id, term: 1,
        row: { bound: { sessionId: id, generation: 'inc-1' }, pending: null, term: 1, designatedTerm: 1 } }) as unknown as DesignationRead;
    };
    const queueBody = (coord: CoordStore, fromId: string, subject: string, body: string): { id: number } => {
      const mail = coord.insertMail({ fromId, fromUuid: fromId, toId: ID, runId: null, kind: 'status', subject, body, artifacts: [] });
      return { id: coord.queueDelivery(mail.id, ID, 'ccrc-mail test payload').id };
    };

    it('a wake to the designated session types its line (the time left at the mail pass clock), moves nothing in the private store, acks on its first delivery and is never replayed', async () => {
      const om = store();
      const { h, coord, w } = await primed([emptyBox, emptyBox, echoedBox(WAKE_LINE), emptyBox], om);
      designate(coord, ID);
      const { id } = queueBody(coord, 'operator', INBOX_WAKE_SUBJECT, WAKE_BODY);
      await w.sweepMail();
      expect(literalSends(h.calls)).toEqual([WAKE_LINE]);
      expect(WAKE_LINE).toContain('the first lapses in 140 s');
      expect(WAKE_LINE).not.toContain('ccrc-api');
      expect(stateOf(coord, id)).toBe('acked');
      expect(om.moveMessage).not.toHaveBeenCalled();
      vi.setSystemTime(NOW + MAIL_REPLAY_MS * 3);
      await w.sweepMail();
      expect(literalSends(h.calls)).toEqual([WAKE_LINE]);
    });

    it('a spot-probe notice to the designated session types the probe door\'s line, not the notice\'s body, and acks on its first delivery', async () => {
      const om = store();
      const { h, coord, w } = await primed([emptyBox, emptyBox, echoedBox(SPOT_LINE), emptyBox], om);
      designate(coord, ID);
      const { id } = queueBody(coord, 'operator', SPOT_PROBE_SUBJECT, 'A probe round is open for you. Answer it with `ccrc-api probe`.');
      await w.sweepMail();
      expect(literalSends(h.calls)).toEqual([SPOT_LINE]);
      expect(stateOf(coord, id)).toBe('acked');
      expect(om.moveMessage).not.toHaveBeenCalled();
    });

    it('a box holding the wake\'s own line is resumed (Enter, no retype); a box holding a message\'s line is held as a draft', async () => {
      const a = await primed([framedBox(WAKE_LINE)], store(), {}, true);
      designate(a.coord, ID);
      const own = queueBody(a.coord, 'operator', INBOX_WAKE_SUBJECT, WAKE_BODY);
      await a.w.sweepMail();
      expect(keyPresses(a.h.calls)).toEqual(['Enter']);
      expect(literalSends(a.h.calls)).toEqual([]);
      expect(stateOf(a.coord, own.id)).toBe('acked');

      const b = await primed([framedBox(LINE)], store());
      designate(b.coord, ID);
      const draft = queueBody(b.coord, 'operator', INBOX_WAKE_SUBJECT, WAKE_BODY);
      await b.w.sweepMail();
      expect(keyPresses(b.h.calls)).toEqual(['C-s']);          // the stash of a draft, never an Enter
      expect(literalSends(b.h.calls)).toEqual([]);
      expect(stateOf(b.coord, draft.id)).toBe('queued');
    });

    it('the same notice to a coordinator keeps its generic nudge and its own ack, and a wake to a session that is not designated is generic too', async () => {
      const om = store();
      const nudge = renderMailNudge(ID);
      const a = await primed([emptyBox, echoedBox(nudge), emptyBox], om);
      designate(a.coord, 'lane-z-overlord');                   // some other session is the Overlord
      const spot = queueBody(a.coord, 'operator', SPOT_PROBE_SUBJECT, 'A probe round is open for you.');
      await a.w.sweepMail();
      expect(literalSends(a.h.calls)).toEqual([nudge]);
      expect(stateOf(a.coord, spot.id)).toBe('delivered');     // the recipient's own ack, as the renewal act builds it
      const b = await primed([emptyBox, echoedBox(nudge), emptyBox], om);
      const wake = queueBody(b.coord, 'operator', INBOX_WAKE_SUBJECT, WAKE_BODY);   // nobody designated
      await b.w.sweepMail();
      expect(literalSends(b.h.calls)).toEqual([nudge]);
      expect(stateOf(b.coord, wake.id)).toBe('delivered');
      expect(om.moveMessage).not.toHaveBeenCalled();
    });

    it('a refused ack of a wake\'s first delivery is logged and leaves the delivery delivered, never moving anything in the private store', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { coord, w } = await primed([emptyBox, emptyBox, echoedBox(WAKE_LINE), emptyBox], store());
      designate(coord, ID);
      const { id } = queueBody(coord, 'operator', INBOX_WAKE_SUBJECT, WAKE_BODY);
      vi.spyOn(coord, 'markAcked').mockReturnValue({ ok: false, why: 'fixture' } as never);
      await w.sweepMail();
      expect(stateOf(coord, id)).toBe('delivered');
      expect(warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes(`delivery ${id}`) && l.includes('ack refused'))).toBe(true);
    });

    // Review 3506 F1: the recovery measured end to end on the real pass, not by call order. A fixed line whose first delivery moves
    // nothing (the wake, the spot-probe notice) was delivered once and its ack never landed (the process stopped between
    // `markDelivered` and the ack). Past the replay window the row is due again; the pass must ack it and type nothing, no line and
    // no key. Red when the pass's early exit after `finishFixedLineAck` is removed: the row is acked, then the line is typed again.
    it.each([
      ['a wake', INBOX_WAKE_SUBJECT, WAKE_BODY],
      ['a spot-probe notice', SPOT_PROBE_SUBJECT, 'A probe round is open for you. Answer it with `ccrc-api probe`.'],
    ])('%s delivered once and never acked is replayed past the replay window: acked, and nothing is typed again', async (_what, subject, body) => {
      const { h, coord, w } = await primed([emptyBox], store());
      designate(coord, ID);
      const { id } = queueBody(coord, 'operator', subject, body);
      expect(coord.markDelivered(id, NOW)).toMatchObject({ changed: true, state: 'delivered' });
      vi.setSystemTime(NOW + MAIL_REPLAY_MS * 3);
      await w.sweepMail();
      expect(stateOf(coord, id)).toBe('acked');
      expect(literalSends(h.calls)).toEqual([]);
      expect(keyPresses(h.calls)).toEqual([]);
    });
  });

  it('settleOperatorNudge: a replay (the ack was refused earlier) moves nothing and tries the ack again', () => {
    const om = store();
    const ack = vi.fn(() => ({ ok: true as const, state: 'acked' as const }));
    settleOperatorNudge({ coord: { markAcked: ack }, operatorModel: om, now: 5, warn: () => {} }, { id: 3, deliveredAt: 4 }, 7);
    expect(om.moveMessage).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith(3, 5);
    settleOperatorNudge({ coord: { markAcked: ack }, operatorModel: om, now: 5, warn: () => {} }, { id: 3, deliveredAt: null }, 7);
    expect(om.moveMessage).toHaveBeenCalledTimes(1);
  });

  it('settleOperatorNudge: a replay over a row still queued (the earlier move was refused) moves it to delivered; an unreadable state moves nothing and warns', () => {
    const ack = vi.fn(() => ({ ok: true as const, state: 'acked' as const }));
    const queued = store('queued');
    settleOperatorNudge({ coord: { markAcked: ack }, operatorModel: queued, now: 5, warn: () => {} }, { id: 3, deliveredAt: 4 }, 7);
    expect(queued.moveMessage).toHaveBeenCalledWith(7, 'deliver', 'mail-lane', 5);
    expect(ack).toHaveBeenCalledWith(3, 5);
    const lines: string[] = [];
    const unread = { ...store(), messageStateOf: vi.fn(() => ({ kind: 'unmeasured' as const, why: 'fixture' })) };
    settleOperatorNudge({ coord: { markAcked: ack }, operatorModel: unread, now: 6, warn: (l) => lines.push(l) }, { id: 4, deliveredAt: 4 }, 8);
    expect(unread.moveMessage).not.toHaveBeenCalled();
    expect(lines.some((l) => l.includes('message 8') && l.includes('unmeasured'))).toBe(true);
    expect(ack).toHaveBeenCalledWith(4, 6);
  });

  it('pushNewMail records the nudge and pushes nothing, where an ordinary mail pushes', async () => {
    const sent: { title: string; body: string }[] = [];
    const push = { notify: async (p: { title: string; body: string }) => { sent.push(p); } };
    const { coord, w } = await primed([emptyBox], undefined, { push: push as never });
    const ordinary = coord.insertMail({ fromId: 'lane-b-project-a', fromUuid: 'u', toId: ID, runId: null, kind: 'status', subject: 'ordinary news', body: 'b', artifacts: [] });
    coord.queueDelivery(ordinary.id, ID, 'e');
    await w.tick();
    expect(sent.map((p) => p.body)).toEqual(['ordinary news']);
    sent.length = 0;
    const nudge = coord.insertMail({ fromId: 'operator', fromUuid: 'operator', toId: ID, runId: null, kind: 'status', subject: operatorMessageSubject(9), body: 'b', artifacts: [] });
    coord.queueDelivery(nudge.id, ID, 'e');
    await w.tick();
    expect(sent).toEqual([]);
  });

  it('pushNewMail records the inbox wake and pushes nothing', async () => {
    const sent: { title: string; body: string }[] = [];
    const push = { notify: async (p: { title: string; body: string }) => { sent.push(p); } };
    const { coord, w } = await primed([emptyBox], undefined, { push: push as never });
    const wake = coord.insertMail({ fromId: 'operator', fromUuid: 'operator', toId: ID, runId: null, kind: 'status', subject: INBOX_WAKE_SUBJECT, body: 'inbox-wake v1\nwaiting: 1\nfirst-due: none', artifacts: [] });
    coord.queueDelivery(wake.id, ID, 'e');
    const ordinary = coord.insertMail({ fromId: 'lane-b-project-a', fromUuid: 'u', toId: ID, runId: null, kind: 'status', subject: 'ordinary news', body: 'b', artifacts: [] });
    coord.queueDelivery(ordinary.id, ID, 'e');
    await w.tick();
    // The control: the ordinary mail beside it is pushed, so the tick read both; the wake is not (a host-pressure push, if the disk is full, is not this test's).
    expect(sent.map((p) => p.body)).toContain('ordinary news');
    expect(sent.map((p) => p.body)).not.toContain(INBOX_WAKE_SUBJECT);
  });
});
