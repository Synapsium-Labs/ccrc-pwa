// Programme ledgers (plan PL6, spec §5): secrets pasted into the console go straight to a protected slot. Real server over a
// fixture HOME with sign-in ARMED (a passphrase, a real session cookie, the real step-up), a real `CoordStore`, a real
// `SecretMasker` and a real /ws/fleet socket, neutral names (prog-a, lane-a).
//
// THE HEADLINE IS THE LEAK SCAN. It saves `SECRET-MARK-<24 random characters>` and then looks for that mark everywhere the
// code writes or answers: every table of coord.db and the database files' own bytes, every other file under the fixture HOME
// (the slot's metadata included; only the slot's value file may hold it), every route response the flow made and the reads
// that carry item, mail, feed and ledger text, every frame the socket received (the `waiting` frame among them), and
// everything written to the console. Zero hits. A write this task adds is added to the scan.
//
// THE SCAN IS BLIND TO THE MASKER IT CHECKS (review 1391 F4): its rigs pass the server an egress that masks nothing by
// fingerprint (`egress: 'blind'`), while the save still registers the value with the real masker. So an echo of the value in
// any answer, frame or line reaches the scan as it was written, and is a hit, whatever the masker would have done.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, lstatSync, mkdirSync, promises as fsp, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { SecretMasker, fingerprintGeneration, fingerprintOf, fingerprintRow, type FingerprintAnswer } from '../src/accounts/mask.js';
import { loadConfig, reloadRoster } from '../src/config.js';
import {
  OPERATOR_SECRETS_DIR, OperatorSecretBadSlot, operatorSecretLaneId, operatorSecretPath, operatorSecretRows, readOperatorSecretMeta,
  readStoredSecrets, removeOperatorSecret, withOperatorSecretRows, writeOperatorSecret,
} from '../src/coord/ledgersSecrets.js';
import { SECRET_BODY_LIMIT, registerLedgerOperatorRoutes } from '../src/coord/ledgersRoutes.js';
import Fastify from 'fastify';
import { RUN_MIN_BYTES } from '../src/accounts/shapes.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { DEFAULT_TEST_ROSTER, seedRoster, testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { SECRET_MASK, type FleetMsg } from '../../shared/api.js';
import {
  SECRET_TAIL_MIN, SECRET_VALUE_MAX, secretAnswer, secretTailOf, type ItemView, type StoredSecretsAnswer,
} from '../../shared/ledgers.js';
import { LEDGER_ROUTE_REFUSALS, REFUSAL_STATUS } from '../../shared/refusal.js';

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'a test passphrase for the secret suite';
const ORIGIN = 'http://localhost:7788';
const TOKEN_HEADERS = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
const NOW0 = Date.UTC(2026, 10, 3, 9, 0, 0);
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** `SECRET-MARK-` and 24 random characters: a value no fixture and no code path could write by chance. */
const mark = (): string => `SECRET-MARK-${Array.from(randomBytes(24), (b) => ALNUM[b % ALNUM.length]).join('')}`;

let app: FastifyInstance | null = null;
const sockets: WebSocket[] = [];
const maskers: SecretMasker[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of sockets.splice(0)) s.close();
  for (const m of maskers.splice(0)) m.close();
  await app?.close();
  app = null;
  removeTmpFixtures();
});

interface Rig {
  app: FastifyInstance; coord: CoordStore; home: string; ccrcDir: string; cookie: string; port: number; runA: number;
  masker: SecretMasker;
  /** The box token the masker keys with; `rotate` replaces it (a rotation), as the token store does. */
  token: { value: string };
  /** Every response this rig's `send` made, for the leak scan. */
  answers: string[];
  send: (o: { method: 'GET' | 'PUT' | 'POST' | 'DELETE'; url: string; payload?: unknown; headers?: Record<string, string>; raw?: string }) => Promise<LightMyRequestResponse>;
  stepUp: () => Promise<void>;
}

/** The egress methods a blind rig answers from a masker that holds no fingerprint (shapes only): everything the server SENDS. */
const EGRESS = new Set(['maskText', 'maskTextSliced', 'maskDeep', 'maskWithCarry', 'drawer', 'version', 'fingerprintMax']);
/** The real masker for every registration (`ingestSecret`, `retireSecret`, `ingest`, …), and a blind one for every egress. */
function blindEgress(real: SecretMasker): SecretMasker {
  const blind = new SecretMasker({});
  maskers.push(blind);
  return new Proxy(real, {
    get(target, prop) {
      const src = typeof prop === 'string' && EGRESS.has(prop) ? blind : target;
      const v = Reflect.get(src, prop, src) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(src) : v;
    },
  });
}

/** An ARMED server: sign-in on, a loopback origin, a session from the passphrase login. `stepUp` takes the passphrase step.
 *  `egress: 'blind'` gives the server an egress that masks no fingerprint (the leak scan's rigs, review 1391 F4);
 *  `requestRekey` is the masker's re-key request (a rotation's race, review 1391 F1). */
async function rig(o: {
  armed?: boolean; origin?: string; masker?: boolean; egress?: 'blind'; requestRekey?: () => Promise<FingerprintAnswer | null>;
} = {}): Promise<Rig> {
  const home = mkTmp('ccrc-ledgers-secrets-');
  seedRow(home, 'lane-a');
  const ccrcDir = path.join(home, '.ccrc');
  mkdirSync(ccrcDir, { recursive: true });
  writeFileSync(path.join(ccrcDir, 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const coord = new CoordStore(openCoordDb(path.join(ccrcDir, 'coord.db')));
  const token = { value: ID_GATE_TOKEN };
  const masker = new SecretMasker({ db: coord.db, token: () => token.value, ...(o.requestRekey ? { requestRekey: o.requestRekey } : {}) });
  maskers.push(masker);
  const base = testDeps(home, recorder().run);
  const armed = o.armed ?? true;
  const deps: Deps = {
    ...base, coord, mailToken: ID_GATE_TOKEN, ...(o.masker === false ? {} : { masker: o.egress === 'blind' ? blindEgress(masker) : masker }),
    cfg: { ...base.cfg, authEnabled: armed, cookieSecure: false, rpId: 'localhost', origin: o.origin ?? ORIGIN },
  };
  app = await buildServer(deps, new Bus());
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  let cookie = '';
  if (armed) {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE }, headers: { 'user-agent': 'a test phone', origin: ORIGIN } });
    expect(login.statusCode, login.body).toBe(204);
    const set = login.headers['set-cookie'];
    const line = Array.isArray(set) ? set[0]! : String(set);
    cookie = line.slice(0, line.indexOf(';'));
  }
  const answers: string[] = [];
  const self = app;
  const send: Rig['send'] = async ({ method, url, payload, headers, raw }) => {
    const res = await self.inject({
      method, url,
      headers: { cookie, origin: o.origin ?? ORIGIN, ...(payload === undefined && raw === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(raw !== undefined ? { payload: raw } : payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
    answers.push(`${method} ${url} ${res.statusCode} ${JSON.stringify(res.headers)} ${res.body}`);
    return res;
  };
  const runA = (coord.openRun({ program: 'prog-a', title: 'PROG-A', project: 'project-a', wave: 1, waveOf: null, claimedBy: 'lane-a' }) as { id: number }).id;
  return {
    app, coord, home, ccrcDir, cookie, port, runA, masker, token, answers, send,
    stepUp: async () => {
      const r = await send({ method: 'POST', url: '/api/auth/step-up/passphrase', payload: { passphrase: PASSPHRASE } });
      expect(r.statusCode, r.body).toBeLessThan(300);
    },
  };
}

const raiseSecret = (r: Rig, slot = 'api-key', program = 'prog-a'): number => r.coord.raiseItem({
  program, runId: r.runA, raisedBy: 'lane-a', kind: 'secret', title: 'Give the service key', why: 'The wave calls the service.',
  how: ['Open the service console', 'Copy the key'], options: null, neededBy: 'blocking', soonLabel: null, secretSlot: slot,
}, NOW0);
const save = (r: Rig, id: number, value: unknown) => r.send({ method: 'PUT', url: `/api/items/${id}/secret`, payload: { value } });
const body = (res: { body: string }): Record<string, unknown> => JSON.parse(res.body) as Record<string, unknown>;
const secretDir = (r: Rig): string => path.join(r.ccrcDir, OPERATOR_SECRETS_DIR);

/** Every file under `dir`, recursively, as absolute paths (symlinks not followed). */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    const st = lstatSync(p);
    if (st.isDirectory()) out.push(...walk(p)); else if (st.isFile()) out.push(p);
  }
  return out;
}

/** A socket on /ws/fleet that keeps every raw message. */
type WaitingFrame = Extract<FleetMsg, { type: 'waiting' }>;
function listen(r: Rig): { raw: string[]; waiting: (pred: (f: WaitingFrame) => boolean) => Promise<WaitingFrame> } {
  const ws = new WebSocket(`ws://127.0.0.1:${r.port}/ws/fleet`, { headers: { cookie: r.cookie, origin: ORIGIN } });
  sockets.push(ws);
  const raw: string[] = [];
  const parsed: FleetMsg[] = [];
  const listeners: (() => void)[] = [];
  ws.on('message', (d) => { raw.push(String(d)); parsed.push(JSON.parse(String(d)) as FleetMsg); listeners.forEach((l) => l()); });
  return {
    raw,
    waiting: (pred) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no such waiting frame; got ${parsed.map((m) => m.type).join(',')}`)), 4000);
      const check = (): void => {
        const w = parsed.filter((m): m is WaitingFrame => m.type === 'waiting').find(pred);
        if (w) { clearTimeout(t); resolve(w); }
      };
      listeners.push(check);
      check();
    }),
  };
}

/** Console output, captured whole (every argument of every level) while the flow runs. */
function captureConsole(): string[] {
  const lines: string[] = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack ?? ''}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); });
  }
  return lines;
}

/** THE SCAN: every table of coord.db (seven asserted present), the database file after a WAL checkpoint, every other file
 *  under the fixture HOME (only the slot's value file may hold the value), every response the rig made, every frame the
 *  socket received and every console line. Answers the hits; a test expects none. */
function scan(r: Rig, value: string, o: { frames: string[]; out: string[]; valueFiles: string[] }): string[] {
  const hits: string[] = [];
  const db = r.coord.db;
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
  for (const t of ['mail', 'mail_deliveries', 'feed_events', 'operator_items', 'operator_item_events', 'programme_modifications', 'secret_fingerprints']) {
    expect(tables, `the scan reads ${t}`).toContain(t);
  }
  for (const t of tables) {
    const text = JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all());
    if (text.includes(value)) hits.push(`table ${t}`);
  }
  db.exec('PRAGMA wal_checkpoint(FULL)');
  const files = walk(r.home);
  expect(files, 'the scan reads the coord.db file').toContain(path.join(r.ccrcDir, 'coord.db'));
  for (const f of files) {
    if (o.valueFiles.includes(f)) continue;
    if (readFileSync(f).includes(Buffer.from(value, 'utf8'))) hits.push(`file ${path.relative(r.home, f)}`);
  }
  r.answers.forEach((a, i) => { if (a.includes(value)) hits.push(`response #${i} ${a.slice(0, 40)}`); });
  o.frames.forEach((f, i) => { if (f.includes(value)) hits.push(`frame #${i}`); });
  o.out.forEach((l, i) => { if (l.includes(value)) hits.push(`console #${i}`); });
  return hits;
}

/** The store's two directories, made private ahead of a save, so a test can plant something inside them. */
function privateStore(r: Rig | { ccrcDir: string }, program = 'prog-a'): string {
  const dir = path.join(r.ccrcDir, OPERATOR_SECRETS_DIR, program);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(path.dirname(dir), 0o700);
  chmodSync(dir, 0o700);
  return dir;
}

/** The re-key a rotation runs (`index.ts`'s `requestRekey`): the operator-secret rows under the current token, ingested. */
async function rekey(r: Rig): Promise<void> {
  const t = r.token.value;
  const rows = await operatorSecretRows(r.ccrcDir, (lane, v) => fingerprintRow(t, lane, v));
  expect(rows.unreadable).toBe(false);
  const answer = withOperatorSecretRows(null, fingerprintGeneration(t), rows.rows);
  expect(answer === null ? false : r.masker.ingest(answer)).toBe(true);
}

describe('the leak scan (plan PL6 Step 1, spec §5: no secret value anywhere but its protected file)', () => {
  it('the leak scan: a saved SECRET-MARK value appears in no table, no other file, no response, no frame and no console line', async () => {
    const out = captureConsole();
    const r = await rig({ egress: 'blind' });
    const value = mark();
    const id = raiseSecret(r);
    const sock = listen(r);
    await sock.waiting(() => true);

    // Refusals that carry the value first, each a fixed word with nothing of the body in it.
    const noStep = await save(r, id, value);
    expect(body(noStep)['error']).toBe('step-up-required');
    await r.stepUp();
    expect(body(await r.send({ method: 'PUT', url: `/api/items/${id}/secret`, raw: `{"value":"${value}` })).error).toBe('bad-request');
    expect(body(await r.send({ method: 'PUT', url: `/api/items/${id}/secret`, raw: JSON.stringify({ value: value.repeat(Math.ceil(SECRET_BODY_LIMIT / value.length) + 1) }) })).error).toBe('oversize');
    expect(body(await save(r, id, `${value}${'x'.repeat(SECRET_VALUE_MAX)}`)).error).toBe('bad-request');
    // One line (the operator's ruling on programme item 8): a value with a line break is refused before any write.
    for (const broken of [`${value}\n`, `${value}\rx`, `x\r\n${value}`]) {
      const res = await save(r, id, broken);
      expect(res.statusCode).toBe(REFUSAL_STATUS[LEDGER_ROUTE_REFUSALS.secretNotOneLine]);
      expect(body(res).error).toBe(LEDGER_ROUTE_REFUSALS.secretNotOneLine);
    }
    expect(existsSync(secretDir(r)), 'nothing was written for a refused value').toBe(false);
    expect(body(await r.send({ method: 'POST', url: `/api/items/${id}/tick`, payload: { answer: value } })).error).toBe(LEDGER_ROUTE_REFUSALS.useSecretRoute);

    // The save.
    const ok = await save(r, id, value);
    expect(ok.statusCode, ok.body).toBe(200);
    const answer = body(ok) as { secret: { setAt: number; tail: string; masked: boolean }; item: ItemView };
    expect(answer.secret).toEqual({ setAt: expect.any(Number), tail: value.slice(-4), masked: true });
    expect(answer.item.state).toBe('checking');
    expect(answer.item.answer).toBe(secretAnswer({ setAt: answer.secret.setAt, tail: value.slice(-4) }));
    expect(answer.item.secretSet).toEqual({ at: answer.secret.setAt, tail: value.slice(-4), masked: true });
    const frame = await sock.waiting((f) => f.waiting.items.some((i) => i.id === id && i.state === 'checking'));
    expect(frame.waiting.items.find((i) => i.id === id)?.secretSet).toEqual({ at: answer.secret.setAt, tail: value.slice(-4), masked: true });

    // A second save of the same item is refused: it is no longer open.
    expect(body(await save(r, id, value)).error).toBe('not-open');

    // The reads that carry item, mail, feed and ledger text, as the operator and as the coordinator.
    const mails = await r.send({ method: 'GET', url: '/api/mail?to=lane-a', headers: TOKEN_HEADERS });
    const rows = (body(mails)['mail'] as { deliveryId: number }[]);
    expect(rows.length).toBeGreaterThan(0);
    for (const m of rows) await r.send({ method: 'GET', url: `/api/mail/${m.deliveryId}`, headers: TOKEN_HEADERS });
    for (const url of [
      '/api/waiting', '/api/programmes/prog-a/goals', '/api/feed', '/api/runs', `/api/runs/${r.runA}`, '/api/fleet', '/api/digest',
      '/api/asks', '/api/ledger?project=project-a', '/api/claims', '/api/lifecycle',
    ]) await r.send({ method: 'GET', url, headers: TOKEN_HEADERS });
    const list = await r.send({ method: 'GET', url: '/api/programmes/prog-a/items?byId=lane-a&byUuid=u-lane-a', headers: TOKEN_HEADERS });
    expect(list.statusCode, list.body).toBe(200);
    expect((body(list)['items'] as ItemView[]).find((i) => i.id === id)?.secretSet?.tail).toBe(value.slice(-4));

    // The operator's stored-secrets read (programme item 9): names and records only.
    const stored = await r.send({ method: 'GET', url: '/api/programmes/prog-a/secrets' });
    expect(stored.statusCode, stored.body).toBe(200);
    expect((body(stored) as unknown as StoredSecretsAnswer).slots.map((x) => x.slot)).toEqual(['api-key']);
    expect(stored.body).not.toContain(value.slice(-4));

    // A rotation: the re-key writes the operator rows under the new token, and the scan reads what it wrote.
    r.token.value = 'f'.repeat(64);
    await rekey(r);
    expect((r.coord.db.prepare('SELECT gen FROM secret_fingerprints').all() as { gen: string }[]).map((g) => g.gen)).toEqual([fingerprintGeneration(r.token.value)]);
    expect(r.masker.maskText(`x ${value} y`)).toBe(`x ${SECRET_MASK} y`);

    // THE SCAN.
    const valueFile = operatorSecretPath(r.ccrcDir, 'prog-a', 'api-key');
    expect(walk(r.home), 'the scan reads the slot metadata').toContain(valueFile.replace(/\.secret$/, '.json'));
    expect(scan(r, value, { frames: sock.raw, out, valueFiles: [valueFile] })).toEqual([]);
    const db = r.coord.db;

    // …and the one place it is: the slot's value file, 0600, in 0700 directories, holding exactly the value.
    expect(readFileSync(valueFile, 'utf8')).toBe(value);
    expect(statSync(valueFile).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(valueFile)).mode & 0o777).toBe(0o700);
    expect(statSync(secretDir(r)).mode & 0o777).toBe(0o700);
    // The scan's own control: a planted copy in a table is found.
    db.prepare("UPDATE operator_items SET note = ? WHERE id = ?").run(`planted ${value}`, id);
    expect(JSON.stringify(db.prepare('SELECT * FROM operator_items').all()).includes(value)).toBe(true);
  });
});

describe('PUT /api/items/:id/secret: the order of its refusals (plan PL6)', () => {
  it('refused without step-up: step-up-required, and nothing is stored or ticked', async () => {
    const r = await rig();
    const id = raiseSecret(r);
    const res = await save(r, id, mark());
    expect(res.statusCode).toBe(REFUSAL_STATUS['step-up-required']);
    expect(body(res)['error']).toBe('step-up-required');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(existsSync(secretDir(r))).toBe(false);
    expect(r.coord.itemById(id)?.state).toBe('open');
  });

  it('refused auth-off: a box whose sign-in is not armed never stores a secret, not even from loopback', async () => {
    const r = await rig({ armed: false });
    const id = raiseSecret(r);
    const res = await save(r, id, mark());
    expect(body(res)['error']).toBe('auth-off');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(existsSync(secretDir(r))).toBe(false);
    expect(r.coord.itemById(id)?.state).toBe('open');
  });

  it('refused insecure-origin: a plain-HTTP public origin', async () => {
    const r = await rig({ origin: 'http://box.example.invalid' });
    const id = raiseSecret(r);
    expect(body(await save(r, id, mark()))['error']).toBe('insecure-origin');
    expect(existsSync(secretDir(r))).toBe(false);
  });

  it('a slot of ../x or A/B is refused before any path is built', async () => {
    const r = await rig();
    await r.stepUp();
    const join = vi.spyOn(path, 'join');
    for (const slot of ['../x', 'A/B']) {
      const id = raiseSecret(r, slot);
      join.mockClear();
      const res = await save(r, id, mark());
      expect(body(res)['error'], slot).toBe(LEDGER_ROUTE_REFUSALS.badSlot);
      expect(join.mock.calls.filter((c) => c.some((a) => typeof a === 'string' && a.includes(OPERATOR_SECRETS_DIR))), slot).toEqual([]);
      expect(r.coord.itemById(id)?.state).toBe('open');
    }
    expect(existsSync(secretDir(r))).toBe(false);
    // The store's own check, beside the route's: neither name builds a path when it fails its shape.
    for (const [program, slot] of [['prog-a', '../x'], ['prog-a', 'A/B'], ['../prog-a', 'x'], ['a/b', 'x'], [' prog-a', 'x'], ['prog-a', '']]) {
      join.mockClear();
      expect(() => operatorSecretPath(r.ccrcDir, program!, slot!), `${program} ${slot}`).toThrow(OperatorSecretBadSlot);
      expect(join).not.toHaveBeenCalled();
      expect(readOperatorSecretMeta(r.ccrcDir, program!, slot!)).toBeNull();
    }
  });

  it('a non-secret item is not-a-secret-item; a closed one is not-open; a value of 0 or more than the cap is bad-request', async () => {
    const r = await rig();
    await r.stepUp();
    const doItem = r.coord.raiseItem({
      program: 'prog-a', runId: r.runA, raisedBy: 'lane-a', kind: 'do', title: 'Do it', why: 'w', how: [], options: null, neededBy: 'later', soonLabel: null, secretSlot: null,
    }, NOW0);
    expect(body(await save(r, doItem, mark()))['error']).toBe(LEDGER_ROUTE_REFUSALS.notSecretItem);
    const id = raiseSecret(r);
    expect(body(await save(r, id, ''))['error']).toBe('bad-request');
    expect(body(await save(r, id, 7))['error']).toBe('bad-request');
    expect(body(await save(r, id, 'é'.repeat(SECRET_VALUE_MAX / 2 + 1)))['error']).toBe('bad-request');
    expect(existsSync(secretDir(r))).toBe(false);
    r.coord.moveItem(id, 'withdraw', 'coordinator', {}, NOW0 + 1, { programmeHasOpenRun: true });
    expect(body(await save(r, id, mark()))['error']).toBe('not-open');
  });

  it('a programme with no open run: programme-ended, checked before the write, so nothing is stored', async () => {
    const r = await rig();
    await r.stepUp();
    const id = raiseSecret(r);
    r.coord.db.prepare("UPDATE runs SET state = 'done' WHERE program = 'prog-a'").run();
    expect(body(await save(r, id, mark()))['error']).toBe(LEDGER_ROUTE_REFUSALS.programmeEnded);
    expect(existsSync(secretDir(r))).toBe(false);
  });
});

describe('masking (Review Focus 2: a short secret is stored and said to be unmasked, never a silent skip)', () => {
  it('a 12-character secret is stored with masked false and the answer says so', async () => {
    const r = await rig();
    await r.stepUp();
    const id = raiseSecret(r);
    const value = 'Short-Key-12';
    expect(value).toHaveLength(12);
    const res = await save(r, id, value);
    expect(res.statusCode, res.body).toBe(200);
    const a = body(res) as { secret: Record<string, unknown>; item: ItemView };
    expect(a.secret).toEqual({ setAt: expect.any(Number), tail: '', masked: false, why: 'too-short' });
    expect(a.item.secretSet).toEqual({ at: a.secret['setAt'], tail: '', masked: false, why: 'too-short' });
    // Under SECRET_TAIL_MIN no character of it leaves the server: the coordinator's answer carries the time alone.
    expect(12).toBeLessThan(SECRET_TAIL_MIN);
    expect(a.item.answer).toBe(secretAnswer({ setAt: a.secret['setAt'] as number, tail: '' }));
    expect(readFileSync(operatorSecretPath(r.ccrcDir, 'prog-a', 'api-key'), 'utf8')).toBe(value);
    expect(r.coord.db.prepare('SELECT COUNT(*) AS n FROM secret_fingerprints').get()).toEqual({ n: 0 });
  });

  it('a 24-character secret is masked in an outbound frame after saving', async () => {
    const r = await rig();
    await r.stepUp();
    const id = raiseSecret(r);
    const value = mark().slice(0, 24);
    expect(value).toHaveLength(24);
    const sock = listen(r);
    await sock.waiting(() => true);
    expect(body(await save(r, id, value))['secret']).toMatchObject({ masked: true, tail: value.slice(-4) });
    // A session writes the value into an item's text: every egress shows the mask in its place.
    const raised = await r.send({
      method: 'POST', url: '/api/programmes/prog-a/items', headers: TOKEN_HEADERS,
      payload: { byId: 'lane-a', byUuid: 'u-lane-a', kind: 'do', title: 'Rotate it', why: `the key is ${value} now`, how: [], neededBy: 'later' },
    });
    expect(raised.statusCode, raised.body).toBe(200);
    const frame = await sock.waiting((f) => f.waiting.items.some((i) => i.title === 'Rotate it'));
    const why = frame.waiting.items.find((i) => i.title === 'Rotate it')?.why;
    expect(why).toBe(`the key is ${SECRET_MASK} now`);
    const read = await r.send({ method: 'GET', url: '/api/waiting' });
    expect(read.body).not.toContain(value);
    expect(read.body).toContain(SECRET_MASK);
    expect(r.masker.maskText(`x ${value} y`)).toBe(`x ${SECRET_MASK} y`);
  });

  it('with no masker the save still lands and says unregistered', async () => {
    const r = await rig({ masker: false });
    await r.stepUp();
    const id = raiseSecret(r);
    const a = body(await save(r, id, mark()));
    // Unmasked, so no tail either (review 1391 F2: the tail is shown only when the masker catches the value).
    expect(a['secret']).toMatchObject({ masked: false, why: 'unregistered', tail: '' });
  });
});

describe('the masker keeps operator-secret lanes (plan PL6)', () => {
  it('a roster reload keeps operator-secret lanes', async () => {
    const home = mkTmp('ccrc-ledgers-secrets-roster-');
    seedRoster(home);
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
    mkdirSync(cfg.ccrcDir, { recursive: true });
    const db = openCoordDb(path.join(cfg.ccrcDir, 'coord.db'));
    const masker = new SecretMasker({ db, token: () => ID_GATE_TOKEN, log: () => {} });
    maskers.push(masker);
    const value = mark();
    await writeOperatorSecret(cfg.ccrcDir, 'prog-a', 'api-key', value, NOW0, (lane, v) => masker.ingestSecret(lane, v));
    const node = '11111111-2222-4333-8444-555555555555';
    const res = reloadRoster(cfg, { roster: DEFAULT_TEST_ROSTER, fleetIdentity: node, fingerprints: null }, {
      fleetIdentity: () => node, fingerprints: { offer: (f, keep) => masker.offer(f, keep) },
    });
    expect(res.ok).toBe(true);
    expect(db.prepare('SELECT laneId FROM secret_fingerprints').all()).toEqual([{ laneId: 'operator-secret:prog-a:api-key' }]);
    expect(masker.maskText(value)).toBe(SECRET_MASK);
  });

  it('a re-key after a rotation carries the operator-secret rows under the new token', async () => {
    const home = mkTmp('ccrc-ledgers-secrets-rekey-');
    const dir = path.join(home, '.ccrc');
    mkdirSync(dir, { recursive: true });
    const db = openCoordDb(path.join(dir, 'coord.db'));
    let token = 'a'.repeat(64);
    const masker = new SecretMasker({ db, token: () => token, log: () => {} });
    maskers.push(masker);
    const value = mark();
    await writeOperatorSecret(dir, 'prog-a', 'api-key', value, NOW0, (lane, v) => masker.ingestSecret(lane, v));
    token = 'b'.repeat(64);
    const rowsUnder = (t: string) => operatorSecretRows(dir, (lane, v) => fingerprintRow(t, lane, v));
    const answer = withOperatorSecretRows(null, fingerprintGeneration(token), (await rowsUnder(token)).rows);
    expect(answer?.gen).toBe(fingerprintGeneration(token));
    expect(masker.ingest(answer!)).toBe(true);
    expect((db.prepare('SELECT gen FROM secret_fingerprints').all() as { gen: string }[]).map((g) => g.gen)).toEqual([fingerprintGeneration(token)]);
    expect(masker.maskText(value)).toBe(SECRET_MASK);
    // A box answer keyed with another generation is passed on unchanged: `ingest` refuses it, as it would without rows.
    const other = { gen: fingerprintGeneration('c'.repeat(64)), rows: [] };
    expect(withOperatorSecretRows(other, fingerprintGeneration(token), (await rowsUnder(token)).rows)).toEqual(other);
    // …and one keyed with it gets the rows beside its own.
    const same = { gen: fingerprintGeneration(token), rows: [] };
    expect(withOperatorSecretRows(same, fingerprintGeneration(token), (await rowsUnder(token)).rows)?.rows.map((x) => x.laneId)).toEqual(['operator-secret:prog-a:api-key']);
  });

  it('a store directory that is a symlink, or open to others, refuses the write', async () => {
    const home = mkTmp('ccrc-ledgers-secrets-unsafe-');
    const dir = path.join(home, '.ccrc');
    mkdirSync(path.join(dir, OPERATOR_SECRETS_DIR), { recursive: true, mode: 0o755 });
    await expect(writeOperatorSecret(dir, 'prog-a', 'x', mark(), NOW0, () => 'unregistered')).rejects.toThrow(/not a private directory/);
    expect(existsSync(path.join(dir, OPERATOR_SECRETS_DIR, 'prog-a'))).toBe(false);
  });
});

const ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
const laneRows = (db: DatabaseSync, lane = operatorSecretLaneId('prog-a', 'api-key')): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM secret_fingerprints WHERE laneId = ?').get(lane) as { n: number }).n;

describe('the masker never drops an operator-secret row it did not replace (review 1389 F1)', () => {
  it('retain keeps every operator-secret row whatever the keep set says', async () => {
    const r = await rig();
    await r.stepUp();
    const value = mark();
    expect(body(await save(r, raiseSecret(r), value))['secret']).toMatchObject({ masked: true });
    r.masker.retain(new Set());
    expect(laneRows(r.coord.db)).toBe(1);
    expect(r.masker.maskText(value)).toBe(SECRET_MASK);
  });

  it.skipIf(ROOT)('a roster reload while the store cannot be listed leaves the operator rows registered', async () => {
    const home = mkTmp('ccrc-ledgers-secrets-unreadable-');
    seedRoster(home);
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' });
    mkdirSync(cfg.ccrcDir, { recursive: true });
    const db = openCoordDb(path.join(cfg.ccrcDir, 'coord.db'));
    const masker = new SecretMasker({ db, token: () => ID_GATE_TOKEN, log: () => {} });
    maskers.push(masker);
    const value = mark();
    await writeOperatorSecret(cfg.ccrcDir, 'prog-a', 'api-key', value, NOW0, (lane, v) => masker.ingestSecret(lane, v));
    const top = path.join(cfg.ccrcDir, OPERATOR_SECRETS_DIR);
    chmodSync(top, 0o000);
    try {
      // The listing reports unreadable, never "no slots".
      expect((await operatorSecretRows(cfg.ccrcDir, (lane, v) => fingerprintRow(ID_GATE_TOKEN, lane, v))).unreadable).toBe(true);
      const node = '11111111-2222-4333-8444-555555555555';
      reloadRoster(cfg, { roster: DEFAULT_TEST_ROSTER, fleetIdentity: node, fingerprints: null }, {
        fleetIdentity: () => node, fingerprints: { offer: (f, keep) => masker.offer(f, keep) },
      });
      expect(laneRows(db)).toBe(1);
      expect(masker.maskText(value)).toBe(SECRET_MASK);
    } finally {
      chmodSync(top, 0o700);
    }
    // An absent store is empty, and readable.
    expect(await operatorSecretRows(path.join(home, 'nowhere'), (lane, v) => fingerprintRow(ID_GATE_TOKEN, lane, v))).toEqual({ rows: [], unreadable: false });
  });

  it('a slot saved while an offer is held is still registered after the held retain flushes', async () => {
    const r = await rig();
    await r.stepUp();
    // A roster lane's row, so the roster's prune has something to delete and must write.
    expect(r.masker.ingest({ gen: fingerprintGeneration(r.token.value), rows: [fingerprintRow(r.token.value, 'lane-x', mark())] })).toBe(true);
    // Another connection holds coord.db's write lock: the roster's offer (a keep set with no operator lane) is held.
    const other = new DatabaseSync(path.join(r.ccrcDir, 'coord.db'));
    other.exec('BEGIN IMMEDIATE');
    r.masker.offer(null, new Set());
    expect((r.masker as unknown as { held: unknown }).held, 'the offer is held').not.toBeNull();
    other.exec('COMMIT');
    other.close();
    const value = mark();
    expect(body(await save(r, raiseSecret(r), value))['secret']).toMatchObject({ masked: true });
    // The held offer retries on its timer and lands (the roster lane's row goes); the slot's row survives it.
    await vi.waitFor(() => { expect((r.masker as unknown as { held: unknown }).held).toBeNull(); }, { timeout: 8000, interval: 100 });
    expect(laneRows(r.coord.db, 'lane-x')).toBe(0);
    expect(laneRows(r.coord.db)).toBe(1);
    expect(r.masker.maskText(value)).toBe(SECRET_MASK);
  });
});

describe('two saves of one slot at once (review 1389 F2)', () => {
  it('the second runs after the first one\'s tick: the file, the tail and the masker row are all the first\'s, and the second stores nothing', async () => {
    const r = await rig();
    await r.stepUp();
    const id = raiseSecret(r);
    const first = mark();
    const second = mark();
    const file = operatorSecretPath(r.ccrcDir, 'prog-a', 'api-key');
    // The first save's value rename waits for a gate, so the second save arrives while the first is mid-write.
    let open!: () => void;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    const rename = fsp.rename.bind(fsp);
    let gated = false;
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      if (!gated && String(to) === file) { gated = true; await gate; }
      return rename(from, to);
    });
    const a = save(r, id, first);
    await vi.waitFor(() => { expect(gated).toBe(true); });
    const b = save(r, id, second);
    await new Promise((resolve) => setTimeout(resolve, 50));
    open();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.statusCode, ra.body).toBe(200);
    expect(body(rb)['error']).toBe('not-open');
    expect(readFileSync(file, 'utf8')).toBe(first);
    expect(readOperatorSecretMeta(r.ccrcDir, 'prog-a', 'api-key')?.tail).toBe(first.slice(-4));
    expect(r.coord.itemById(id)?.answer).toContain(`ending ${first.slice(-4)}`);
    expect(r.masker.maskText(first)).toBe(SECRET_MASK);
    expect(r.masker.maskText(second)).toBe(second);
  });
});

/** One save with a failure planted after the gate, under the scan: answers the save and the scan's hits. */
async function savedUnderScan(plant: (r: Rig, id: number, value: string) => void | Promise<void>, value = mark()) {
  const out = captureConsole();
  const r = await rig({ egress: 'blind' });
  await r.stepUp();
  const id = raiseSecret(r);
  const sock = listen(r);
  await sock.waiting(() => true);
  await plant(r, id, value);
  const res = await save(r, id, value);
  // A save that ticked emits the waiting frame: the scan reads it too (review 1391 A-13).
  if (r.coord.itemById(id)?.state === 'checking') await sock.waiting((f) => f.waiting.items.some((i) => i.id === id && i.state === 'checking'));
  await r.send({ method: 'GET', url: '/api/waiting' });
  await r.send({ method: 'GET', url: '/api/mail?to=lane-a', headers: TOKEN_HEADERS });
  const valueFile = operatorSecretPath(r.ccrcDir, 'prog-a', 'api-key');
  return { r, id, value, res, valueFile, hits: () => scan(r, value, { frames: sock.raw, out, valueFiles: [valueFile] }) };
}

describe('after the value is stored, every failure says so in one word (review 1389 F3, F5)', () => {
  const STORED = LEDGER_ROUTE_REFUSALS.storedNotTicked;

  it('the metadata write fails: stored-not-ticked, the value is registered for masking, nothing leaks', async () => {
    const t = await savedUnderScan((r) => { mkdirSync(path.join(privateStore(r), 'api-key.json')); });
    expect(t.res.statusCode, t.res.body).toBe(REFUSAL_STATUS[STORED]);
    expect(body(t.res)['error']).toBe(STORED);
    expect(readFileSync(t.valueFile, 'utf8')).toBe(t.value);
    expect(t.r.masker.maskText(t.value)).toBe(SECRET_MASK);
    expect(t.r.coord.itemById(t.id)?.state).toBe('open');
    expect(t.hits()).toEqual([]);
  });

  it('the directory fsync after the rename fails: stored-not-ticked, and the masker registration still ran', async () => {
    const t = await savedUnderScan((r) => {
      const dir = privateStore(r);
      const open = fsp.open.bind(fsp);
      let failed = false;
      vi.spyOn(fsp, 'open').mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
        if (!failed && String(args[0]) === dir && args[1] === 'r') { failed = true; throw Object.assign(new Error('EIO: i/o error, fsync'), { code: 'EIO' }); }
        return open(...args);
      });
    });
    expect(body(t.res)['error']).toBe(STORED);
    expect(readFileSync(t.valueFile, 'utf8')).toBe(t.value);
    expect(t.r.masker.maskText(t.value)).toBe(SECRET_MASK);
    expect(t.hits()).toEqual([]);
  });

  it('a tick refused between the write and the tick (the run closed meanwhile): stored-not-ticked, nothing leaks', async () => {
    const t = await savedUnderScan((r) => {
      const ingest = r.masker.ingestSecret.bind(r.masker);
      vi.spyOn(r.masker, 'ingestSecret').mockImplementation((lane, v) => {
        r.coord.db.prepare("UPDATE runs SET state = 'done' WHERE program = 'prog-a'").run();
        return ingest(lane, v);
      });
    });
    expect(body(t.res)['error']).toBe(STORED);
    expect(readFileSync(t.valueFile, 'utf8')).toBe(t.value);
    expect(t.r.coord.itemById(t.id)?.state).toBe('open');
    expect(t.hits()).toEqual([]);
  });

  it('the same, with a value too short for the masker to hide: nothing of it leaks either (the egress mask cannot cover it)', async () => {
    const short = `SM-${mark().slice(-9)}`;
    expect(Buffer.byteLength(short)).toBeLessThan(RUN_MIN_BYTES);
    const t = await savedUnderScan((r) => {
      const ingest = r.masker.ingestSecret.bind(r.masker);
      vi.spyOn(r.masker, 'ingestSecret').mockImplementation((lane, v) => {
        r.coord.db.prepare("UPDATE runs SET state = 'done' WHERE program = 'prog-a'").run();
        return ingest(lane, v);
      });
    }, short);
    expect(body(t.res)['error']).toBe(STORED);
    expect(readFileSync(t.valueFile, 'utf8')).toBe(short);
    expect(t.r.masker.maskText(short)).toBe(short);
    expect(t.hits()).toEqual([]);
  });

  it('the tick throws: stored-not-ticked, never bad-request', async () => {
    const t = await savedUnderScan((r) => {
      vi.spyOn(r.coord, 'tickWithMail').mockImplementationOnce(() => { throw new Error('database is locked'); });
    });
    expect(body(t.res)['error']).toBe(STORED);
    expect(t.r.coord.itemById(t.id)?.state).toBe('open');
    expect(t.hits()).toEqual([]);
  });

  it('the answer\'s item view throws after the tick: stored-not-ticked, never bad-request', async () => {
    expect(STORED).toBe('stored-not-ticked');
    const t = await savedUnderScan((r) => {
      vi.spyOn(r.coord, 'itemHistory').mockImplementationOnce(() => { throw new Error('database is locked'); });
    });
    expect(body(t.res)['error']).toBe(STORED);
    // This arm is the one AFTER the tick: the item is ticked, only its answer's view failed (review 1391 A-5).
    expect(t.r.coord.itemById(t.id)?.state).toBe('checking');
    expect(t.hits()).toEqual([]);
  });

  it('a write refused before the rename (a programme directory open to others): write-failed, and nothing leaks', async () => {
    const t = await savedUnderScan((r) => { chmodSync(privateStore(r), 0o755); });
    expect(body(t.res)['error']).toBe('write-failed');
    expect(existsSync(t.valueFile)).toBe(false);
    expect(t.r.coord.itemById(t.id)?.state).toBe('open');
    expect(t.hits()).toEqual([]);
  });
});

describe('the store refuses a directory that is not its own (review 1389 F5)', () => {
  it('a top store directory that is a symlink to a private directory refuses the write', async () => {
    const home = mkTmp('ccrc-ledgers-secrets-link-');
    const dir = path.join(home, '.ccrc');
    const elsewhere = path.join(home, 'elsewhere');
    mkdirSync(dir, { recursive: true });
    mkdirSync(elsewhere, { mode: 0o700 });
    symlinkSync(elsewhere, path.join(dir, OPERATOR_SECRETS_DIR));
    await expect(writeOperatorSecret(dir, 'prog-a', 'x', mark(), NOW0, () => 'unregistered')).rejects.toThrow(/not a private directory/);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it('a programme directory that is a symlink refuses the write', async () => {
    const home = mkTmp('ccrc-ledgers-secrets-link2-');
    const dir = path.join(home, '.ccrc');
    const elsewhere = path.join(home, 'elsewhere');
    mkdirSync(path.join(dir, OPERATOR_SECRETS_DIR), { recursive: true, mode: 0o700 });
    mkdirSync(elsewhere, { mode: 0o700 });
    symlinkSync(elsewhere, path.join(dir, OPERATOR_SECRETS_DIR, 'prog-a'));
    await expect(writeOperatorSecret(dir, 'prog-a', 'x', mark(), NOW0, () => 'unregistered')).rejects.toThrow(/not a private directory/);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it('a store directory owned by another user refuses the write (stand-in: lstat answers another uid, since a fixture cannot chown)', async () => {
    const home = mkTmp('ccrc-ledgers-secrets-uid-');
    const dir = path.join(home, '.ccrc');
    mkdirSync(dir, { recursive: true });
    const top = path.join(dir, OPERATOR_SECRETS_DIR);
    const lstat = fsp.lstat.bind(fsp);
    vi.spyOn(fsp, 'lstat').mockImplementation(async (p, o) => {
      const st = await lstat(p, o as never);
      return String(p) === top ? Object.assign(Object.create(Object.getPrototypeOf(st) as object) as typeof st, st, { uid: st.uid + 1 }) : st;
    });
    await expect(writeOperatorSecret(dir, 'prog-a', 'x', mark(), NOW0, () => 'unregistered')).rejects.toThrow(/not a private directory/);
    expect(existsSync(path.join(top, 'prog-a'))).toBe(false);
  });
});

describe('the tail floor is the masker\'s floor, in bytes (review 1389 A1)', () => {
  it('SECRET_TAIL_MIN is the masker\'s RUN_MIN_BYTES: the floor below which no tail is shown (review 1391 F2 retitled it)', () => {
    expect(SECRET_TAIL_MIN).toBe(RUN_MIN_BYTES);
  });

  it('at the floor minus one no tail; at the floor the last four, counted in bytes after any trailing =', async () => {
    const r = await rig();
    const cases: [string, boolean][] = [
      ['a'.repeat(SECRET_TAIL_MIN - 1), false],
      ['a'.repeat(SECRET_TAIL_MIN), true],
      [`${'a'.repeat(SECRET_TAIL_MIN - 1)}=`, false],
      ['é'.repeat(SECRET_TAIL_MIN / 2 - 1) + 'a', false],
      ['é'.repeat(SECRET_TAIL_MIN / 2), true],
      // A 4-byte character at the floor (review 1391 A-13): five of them are 20 bytes, and the tail is four of the five.
      ['\u{1F600}'.repeat(SECRET_TAIL_MIN / 4 - 1) + 'abc', false],
      ['\u{1F600}'.repeat(SECRET_TAIL_MIN / 4), true],
    ];
    for (const [v, shown] of cases) {
      expect(secretTailOf(v) !== '', v).toBe(shown);
      if (shown) expect(secretTailOf(v)).toBe(Array.from(v).slice(-4).join(''));
      expect(r.masker.ingestSecret(`operator-secret:prog-a:t${cases.findIndex((c) => c[0] === v)}`, v) === 'too-short', v).toBe(!shown);
    }
  });

  it('a save at the floor minus one sends no tail, and at the floor sends the last four', async () => {
    const r = await rig();
    await r.stepUp();
    const short = body(await save(r, raiseSecret(r, 'k-short'), 'b'.repeat(SECRET_TAIL_MIN - 1))) as { secret: Record<string, unknown>; item: ItemView };
    expect(short.secret).toMatchObject({ tail: '', masked: false, why: 'too-short' });
    expect(short.item.answer).toBe(secretAnswer({ setAt: short.secret['setAt'] as number, tail: '' }));
    const long = body(await save(r, raiseSecret(r, 'k-long'), `${'c'.repeat(SECRET_TAIL_MIN - 4)}WXYZ`)) as { secret: Record<string, unknown> };
    expect(long.secret).toMatchObject({ tail: 'WXYZ', masked: true });
  });
});

describe('the slot metadata carries no digest of the value (review 1389 A2)', () => {
  it('the metadata file holds v, setAt, tail and masked, and nothing derived from the value but the tail', async () => {
    const home = mkTmp('ccrc-ledgers-secrets-meta-');
    const dir = path.join(home, '.ccrc');
    mkdirSync(dir, { recursive: true });
    await writeOperatorSecret(dir, 'prog-a', 'x', mark(), NOW0, () => 'masked');
    const meta = JSON.parse(readFileSync(path.join(dir, OPERATOR_SECRETS_DIR, 'prog-a', 'x.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(meta).sort()).toEqual(['masked', 'setAt', 'tail', 'v']);
    // With the item whose save it is (the stored-secrets read names it): one more key, a number, and still nothing of the value.
    await writeOperatorSecret(dir, 'prog-a', 'y', mark(), NOW0, () => 'masked', 7);
    const withItem = JSON.parse(readFileSync(path.join(dir, OPERATOR_SECRETS_DIR, 'prog-a', 'y.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(withItem).sort()).toEqual(['item', 'masked', 'setAt', 'tail', 'v']);
    expect(withItem['item']).toBe(7);
  });
});

// ── the PL6 follow-up ─────────────────────────────────────────────────────────────────────────────────────────

describe('a secret is one line (the operator\'s ruling on programme item 8)', () => {
  it('a value with a carriage return or a line feed is refused secret-not-one-line before anything is written', async () => {
    const r = await rig();
    await r.stepUp();
    const id = raiseSecret(r);
    for (const v of [`${mark()}\n`, `a\r${mark()}`, `${mark()}\r\nb`, '\n']) {
      const res = await save(r, id, v);
      expect(res.statusCode, JSON.stringify(v)).toBe(400);
      expect(body(res)['error']).toBe('secret-not-one-line');
      expect(String(body(res)['detail'])).toBe('a secret is one line: it holds no line break');
    }
    expect(existsSync(secretDir(r))).toBe(false);
    expect(r.coord.itemById(id)?.state).toBe('open');
    // A tab is not a line break: it is stored as given.
    expect((await save(r, id, `${mark()}\tz`)).statusCode).toBe(200);
  });
});

describe('masked is measured, not decided on byte length (review 1391 F2)', () => {
  it('a value the egress search cannot catch as one run answers not-one-run, and its tail is withheld', async () => {
    const r = await rig();
    await r.stepUp();
    const cases: [string, string][] = [
      ['k-space', `${mark()} and more`], ['k-colon', `user:${mark()}`], ['k-lead', `=${mark()}`], ['k-comma', `${mark()},x`],
    ];
    for (const [slot, v] of cases) {
      const a = body(await save(r, raiseSecret(r, slot), v)) as { secret: Record<string, unknown>; item: ItemView };
      expect(a.secret, slot).toEqual({ setAt: expect.any(Number), tail: '', masked: false, why: 'not-one-run' });
      expect(a.item.answer, slot).toBe(secretAnswer({ setAt: a.secret['setAt'] as number, tail: '' }));
      expect(readOperatorSecretMeta(r.ccrcDir, 'prog-a', slot), slot).toMatchObject({ masked: false, why: 'not-one-run', tail: '' });
      // The measurement is the truth: the egress search really does not mask it.
      expect(r.masker.maskText(`x ${v} y`), slot).toContain(v.slice(-6));
    }
  });

  it('a value the search does catch whole is masked, its tail shown: a path-like value and one ending in punctuation', async () => {
    const r = await rig();
    await r.stepUp();
    for (const [slot, v] of [['k-path', `${mark()}/sub/x`], ['k-dot', `${mark()}.`], ['k-pad', `${mark()}==`]] as const) {
      const a = body(await save(r, raiseSecret(r, slot), v)) as { secret: Record<string, unknown> };
      expect(a.secret, slot).toMatchObject({ masked: true, tail: Array.from(v).slice(-4).join('') });
      expect(r.masker.maskText(`x ${v} y`), slot).not.toContain(v.replace(/=+$/, ''));
    }
  });
});

describe('a re-key racing a save of the same slot ends as the save wrote it (review 1391 F1)', () => {
  /** Saves V1 through item 1, then rotates the token so the masker asks for its re-key; the re-key reads the slot (V1) and
   *  waits on `gate`. Answers what the test needs to land a second save (V2) before or after that re-key's answer. */
  async function rotation() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let read = false;
    let landed!: () => void;
    const settled = new Promise<void>((resolve) => { landed = resolve; });
    let r!: Rig;
    r = await rig({
      requestRekey: async () => {
        const t = r.token.value;
        const rows = await operatorSecretRows(r.ccrcDir, (lane, v) => fingerprintRow(t, lane, v));
        read = true;
        await gate;
        setTimeout(landed, 20);
        return withOperatorSecretRows(null, fingerprintGeneration(t), rows.rows);
      },
    });
    await r.stepUp();
    const v1 = mark();
    expect(body(await save(r, raiseSecret(r), v1))['secret']).toMatchObject({ masked: true });
    const id2 = raiseSecret(r);
    r.token.value = 'e'.repeat(64);
    r.masker.maskText('wake the key sync');
    await vi.waitFor(() => { expect(read).toBe(true); });
    return { r, v1, id2, release, settled };
  }
  const slotRows = (r: Rig) => r.coord.db.prepare('SELECT fp, gen FROM secret_fingerprints WHERE laneId = ?')
    .all(operatorSecretLaneId('prog-a', 'api-key')) as { fp: string; gen: string }[];

  it('the save lands while the re-key is in flight: the slot keeps the save\'s row, not the value the re-key read', async () => {
    const { r, v1, id2, release, settled } = await rotation();
    const v2 = mark();
    expect(body(await save(r, id2, v2))['secret']).toMatchObject({ masked: true });
    release();
    await settled;
    const gen = fingerprintGeneration(r.token.value);
    expect(slotRows(r)).toEqual([{ fp: fingerprintOf(r.token.value, v2), gen }]);
    expect(r.masker.maskText(v2)).toBe(SECRET_MASK);
    expect(r.masker.maskText(v1)).toBe(v1);
  });

  it('the re-key lands first and the save after: the same end, the save\'s row', async () => {
    const { r, id2, release, settled } = await rotation();
    release();
    await settled;
    const v2 = mark();
    expect(body(await save(r, id2, v2))['secret']).toMatchObject({ masked: true });
    expect(slotRows(r)).toEqual([{ fp: fingerprintOf(r.token.value, v2), gen: fingerprintGeneration(r.token.value) }]);
    expect(r.masker.maskText(v2)).toBe(SECRET_MASK);
  });
});

describe('the stored-secrets read (the operator\'s ruling on programme item 9)', () => {
  it('lists each stored slot by name, with when it was saved and the item that asked for it, and NOTHING of any value', async () => {
    const r = await rig();
    expect(body(await r.send({ method: 'GET', url: '/api/programmes/prog-a/secrets' }))).toEqual({ ok: true, program: 'prog-a', slots: [] });
    await r.stepUp();
    const value = mark();
    const id = raiseSecret(r);
    expect((await save(r, id, value)).statusCode).toBe(200);
    const shortOne = 'Short-Key-12';
    const id2 = raiseSecret(r, 'b-short');
    expect((await save(r, id2, shortOne)).statusCode).toBe(200);
    const res = await r.send({ method: 'GET', url: '/api/programmes/prog-a/secrets' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const a = body(res) as unknown as StoredSecretsAnswer;
    expect(a.slots).toEqual([
      { slot: 'api-key', setAt: expect.any(Number), item: { id, title: 'Give the service key' } },
      { slot: 'b-short', setAt: expect.any(Number), item: { id: id2, title: 'Give the service key' } },
    ]);
    // No value byte: not the value, not its tail, not the short one, not a length.
    for (const piece of [value, value.slice(-4), value.slice(0, 16), shortOne, shortOne.slice(-4)]) expect(res.body).not.toContain(piece);
    expect(Object.keys(a.slots[0]!).sort()).toEqual(['item', 'setAt', 'slot']);
  });

  it('a stored slot outlives its item: the item closed, the slot is still listed', async () => {
    const r = await rig();
    await r.stepUp();
    const id = raiseSecret(r);
    expect((await save(r, id, mark())).statusCode).toBe(200);
    r.coord.moveItem(id, 'confirm', 'coordinator', {}, NOW0 + 5, { programmeHasOpenRun: true });
    expect(r.coord.itemById(id)?.state).not.toBe('checking');
    expect((body(await r.send({ method: 'GET', url: '/api/programmes/prog-a/secrets' })) as unknown as StoredSecretsAnswer).slots.map((s) => s.slot)).toEqual(['api-key']);
    expect(readOperatorSecretMeta(r.ccrcDir, 'prog-a', 'api-key')).not.toBeNull();
  });

  it.skipIf(ROOT)('an unreadable store is secrets-unreadable, never an empty list; an absent one is empty', async () => {
    const r = await rig();
    await r.stepUp();
    expect((await save(r, raiseSecret(r), mark())).statusCode).toBe(200);
    const dir = path.join(secretDir(r), 'prog-a');
    chmodSync(dir, 0o000);
    try {
      const res = await r.send({ method: 'GET', url: '/api/programmes/prog-a/secrets' });
      expect(res.statusCode).toBe(503);
      expect(body(res)['error']).toBe('secrets-unreadable');
      expect(readStoredSecrets(r.ccrcDir, 'prog-a')).toEqual({ state: 'unreadable' });
    } finally {
      chmodSync(dir, 0o700);
    }
    // A store directory open to others is not read either.
    chmodSync(secretDir(r), 0o755);
    expect(readStoredSecrets(r.ccrcDir, 'prog-a')).toEqual({ state: 'unreadable' });
    chmodSync(secretDir(r), 0o700);
    expect(readStoredSecrets(r.ccrcDir, 'prog-b')).toEqual({ state: 'ok', slots: [] });
    expect(readStoredSecrets(path.join(r.home, 'nowhere'), 'prog-a')).toEqual({ state: 'ok', slots: [] });
  });

  it('a slot whose record is missing is listed with no time and no item; a bad programme name is bad-slot', async () => {
    const r = await rig();
    await r.stepUp();
    expect((await save(r, raiseSecret(r), mark())).statusCode).toBe(200);
    await fsp.rm(operatorSecretPath(r.ccrcDir, 'prog-a', 'api-key').replace(/\.secret$/, '.json'));
    expect((body(await r.send({ method: 'GET', url: '/api/programmes/prog-a/secrets' })) as unknown as StoredSecretsAnswer).slots)
      .toEqual([{ slot: 'api-key', setAt: null, item: null }]);
    const bad = await r.send({ method: 'GET', url: '/api/programmes/prog.a/secrets' });
    expect(body(bad)['error']).toBe(LEDGER_ROUTE_REFUSALS.badSlot);
    expect(bad.headers['cache-control'], 'a refusal is not cached either').toBe('no-store');
  });
});

/** The Remove door's URL for a slot of prog-a. */
const removeUrl = (slot: string, program = 'prog-a') => `/api/programmes/${program}/secrets/${slot}`;

describe('the Remove door (the operator\'s ruling on programme item 9)', () => {
  it('refused without step-up: step-up-required, and the slot stays', async () => {
    const r = await rig();
    const value = mark();
    await writeOperatorSecret(r.ccrcDir, 'prog-a', 'api-key', value, NOW0, (lane, v) => r.masker.ingestSecret(lane, v));
    const noStep = await r.send({ method: 'DELETE', url: removeUrl('api-key') });
    expect(noStep.statusCode).toBe(REFUSAL_STATUS['step-up-required']);
    expect(body(noStep)['error']).toBe('step-up-required');
    expect(noStep.headers['cache-control']).toBe('no-store');
    expect(readFileSync(operatorSecretPath(r.ccrcDir, 'prog-a', 'api-key'), 'utf8')).toBe(value);
    expect(laneRows(r.coord.db)).toBe(1);
  });

  it('refused auth-off: a box whose sign-in is not armed removes nothing', async () => {
    const dark = await rig({ armed: false });
    await writeOperatorSecret(dark.ccrcDir, 'prog-a', 'api-key', mark(), NOW0, () => 'unregistered');
    expect(body(await dark.send({ method: 'DELETE', url: removeUrl('api-key') }))['error']).toBe('auth-off');
    expect(existsSync(operatorSecretPath(dark.ccrcDir, 'prog-a', 'api-key'))).toBe(true);
  });

  it('a slot or programme that fails its shape is bad-slot, after the step-up and before any path is built', async () => {
    const r = await rig();
    const unstepped = await r.send({ method: 'DELETE', url: removeUrl('..%2Fx') });
    expect(body(unstepped)['error'], 'the step-up comes first').toBe('step-up-required');
    await r.stepUp();
    const join = vi.spyOn(path, 'join');
    for (const [program, slot] of [['prog-a', '..%2Fx'], ['prog-a', 'A-B'], ['prog-a', '-x'], ['prog.a', 'x'], ['prog%2Fa', 'x'], ['%20prog-a', 'x']] as const) {
      join.mockClear();
      const res = await r.send({ method: 'DELETE', url: removeUrl(slot, program) });
      expect(body(res)['error'], `${program} ${slot}`).toBe(LEDGER_ROUTE_REFUSALS.badSlot);
      expect(join.mock.calls.filter((c) => c.some((a) => typeof a === 'string' && a.includes(OPERATOR_SECRETS_DIR))), `${program} ${slot}`).toEqual([]);
    }
  });

  it('removes the value file and its record; the item shows nothing stored; the value is still masked in this process and nothing reloads it after a restart', async () => {
    const r = await rig();
    await r.stepUp();
    const value = mark();
    const id = raiseSecret(r);
    expect((await save(r, id, value)).statusCode).toBe(200);
    const file = operatorSecretPath(r.ccrcDir, 'prog-a', 'api-key');
    const sock = listen(r);
    await sock.waiting(() => true);
    const res = await r.send({ method: 'DELETE', url: removeUrl('api-key') });
    expect(res.statusCode, res.body).toBe(200);
    expect(body(res)).toEqual({ ok: true, slot: 'api-key' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(existsSync(file)).toBe(false);
    expect(existsSync(file.replace(/\.secret$/, '.json'))).toBe(false);
    expect(readOperatorSecretMeta(r.ccrcDir, 'prog-a', 'api-key')).toBeNull();
    const frame = await sock.waiting((f) => f.waiting.items.some((i) => i.id === id && i.secretSet === null));
    expect(frame.waiting.items.find((i) => i.id === id)?.secretSet).toBeNull();
    expect((body(await r.send({ method: 'GET', url: '/api/programmes/prog-a/secrets' })) as unknown as StoredSecretsAnswer).slots).toEqual([]);
    // Masked for the life of this process…
    expect(r.masker.maskText(`x ${value} y`)).toBe(`x ${SECRET_MASK} y`);
    // …its row gone from the table, so a restart (a new masker over the same database) reloads nothing.
    await vi.waitFor(() => { expect(laneRows(r.coord.db)).toBe(0); });
    const restarted = new SecretMasker({ db: r.coord.db, token: () => r.token.value, log: () => {} });
    maskers.push(restarted);
    expect(restarted.maskText(`x ${value} y`)).toBe(`x ${value} y`);
    // A second Remove: nothing stored.
    const again = await r.send({ method: 'DELETE', url: removeUrl('api-key') });
    expect(again.statusCode).toBe(404);
    expect(body(again)['error']).toBe('secret-not-stored');
  });

  it('a re-key in flight across a Remove never writes the removed slot\'s row back', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let read = false;
    let landed!: () => void;
    const settled = new Promise<void>((resolve) => { landed = resolve; });
    let r!: Rig;
    r = await rig({
      requestRekey: async () => {
        const t = r.token.value;
        const rows = await operatorSecretRows(r.ccrcDir, (lane, v) => fingerprintRow(t, lane, v));
        read = true;
        await gate;
        setTimeout(landed, 20);
        return withOperatorSecretRows(null, fingerprintGeneration(t), rows.rows);
      },
    });
    await r.stepUp();
    expect((await save(r, raiseSecret(r), mark())).statusCode).toBe(200);
    r.token.value = 'd'.repeat(64);
    r.masker.maskText('wake the key sync');
    await vi.waitFor(() => { expect(read).toBe(true); });
    expect((await r.send({ method: 'DELETE', url: removeUrl('api-key') })).statusCode).toBe(200);
    release();
    await settled;
    await vi.waitFor(() => { expect(laneRows(r.coord.db)).toBe(0); });
  });

  it.skipIf(ROOT)('a value file that cannot be removed is remove-failed, and nothing else changes; a symlinked programme directory too', async () => {
    const r = await rig();
    await r.stepUp();
    const value = mark();
    expect((await save(r, raiseSecret(r), value)).statusCode).toBe(200);
    const dir = path.join(secretDir(r), 'prog-a');
    chmodSync(dir, 0o500);
    try {
      const res = await r.send({ method: 'DELETE', url: removeUrl('api-key') });
      expect(res.statusCode).toBe(503);
      expect(body(res)['error']).toBe('remove-failed');
      expect(res.body).not.toContain(value);
    } finally {
      chmodSync(dir, 0o700);
    }
    expect(readFileSync(operatorSecretPath(r.ccrcDir, 'prog-a', 'api-key'), 'utf8')).toBe(value);
    expect(laneRows(r.coord.db)).toBe(1);
    // A programme directory that is a link: refused, and the directory it points at is untouched.
    const home = mkTmp('ccrc-ledgers-secrets-rmlink-');
    const top = path.join(home, '.ccrc', OPERATOR_SECRETS_DIR);
    const elsewhere = path.join(home, 'elsewhere');
    mkdirSync(top, { recursive: true, mode: 0o700 });
    chmodSync(top, 0o700);
    mkdirSync(elsewhere, { mode: 0o700 });
    writeFileSync(path.join(elsewhere, 'x.secret'), 'kept', { mode: 0o600 });
    symlinkSync(elsewhere, path.join(top, 'prog-a'));
    await expect(removeOperatorSecret(path.join(home, '.ccrc'), 'prog-a', 'x')).rejects.toThrow(/not a private directory/);
    expect(readFileSync(path.join(elsewhere, 'x.secret'), 'utf8')).toBe('kept');
  });

  it('the leak scan over the Remove door and the stored-secrets read: no answer, refusal, frame, file or line carries the value', async () => {
    const out = captureConsole();
    const r = await rig({ egress: 'blind' });
    const value = mark();
    const id = raiseSecret(r);
    const sock = listen(r);
    await sock.waiting(() => true);
    await r.stepUp();
    expect((await save(r, id, value)).statusCode).toBe(200);
    await r.send({ method: 'GET', url: '/api/programmes/prog-a/secrets' });
    await r.send({ method: 'DELETE', url: removeUrl('A-B') });
    expect(body(await r.send({ method: 'DELETE', url: removeUrl('api-key') }))).toEqual({ ok: true, slot: 'api-key' });
    await sock.waiting((f) => f.waiting.items.some((i) => i.id === id && i.secretSet === null));
    await r.send({ method: 'DELETE', url: removeUrl('api-key') });
    await r.send({ method: 'GET', url: '/api/programmes/prog-a/secrets' });
    await r.send({ method: 'GET', url: '/api/waiting' });
    expect(scan(r, value, { frames: sock.raw, out, valueFiles: [] })).toEqual([]);
  });
});

describe('a temp file a crash left mid-write is removed on the next write or Remove of its slot (review 1389 A4)', () => {
  it('the slot\'s own leftover temps go; another slot\'s stay', async () => {
    const r = await rig();
    await r.stepUp();
    const dir = privateStore(r);
    const mine = path.join(dir, '.api-key.secret.tmp-0123456789abcdef');
    const mineMeta = path.join(dir, '.api-key.json.tmp-fedcba9876543210');
    const other = path.join(dir, '.other.secret.tmp-0123456789abcdef');
    for (const f of [mine, mineMeta, other]) writeFileSync(f, mark(), { mode: 0o600 });
    expect((await save(r, raiseSecret(r), mark())).statusCode).toBe(200);
    expect(existsSync(mine)).toBe(false);
    expect(existsSync(mineMeta)).toBe(false);
    expect(existsSync(other)).toBe(true);
    writeFileSync(mine, mark(), { mode: 0o600 });
    expect((await r.send({ method: 'DELETE', url: removeUrl('api-key') })).statusCode).toBe(200);
    expect(existsSync(mine)).toBe(false);
    expect(existsSync(other)).toBe(true);
  });
});

describe('a box\'s roster answer never speaks for an operator-secret lane (review 1391 A-1)', () => {
  it('offer drops an operator lane the box names, and the re-key\'s composer drops it from the box\'s part', async () => {
    const r = await rig();
    await r.stepUp();
    const value = mark();
    expect((await save(r, raiseSecret(r), value)).statusCode).toBe(200);
    const gen = fingerprintGeneration(r.token.value);
    const forged = fingerprintRow(r.token.value, operatorSecretLaneId('prog-a', 'api-key'), mark());
    r.masker.offer({ gen, rows: [forged, fingerprintRow(r.token.value, 'lane-x', mark())] }, new Set(['lane-x']));
    expect(laneRows(r.coord.db, 'lane-x')).toBe(1);
    expect(r.coord.db.prepare('SELECT fp FROM secret_fingerprints WHERE laneId = ?').all(operatorSecretLaneId('prog-a', 'api-key')))
      .toEqual([{ fp: fingerprintOf(r.token.value, value) }]);
    expect(r.masker.maskText(value)).toBe(SECRET_MASK);
    expect(withOperatorSecretRows({ gen, rows: [forged] }, gen, [])).toEqual({ gen, rows: [] });
  });
});

describe('the slot\'s chain has a deadline (review 1391 A-3)', () => {
  it('an act that waits past it answers slot-busy and does nothing; the act it waited on still finishes', async () => {
    const home = mkTmp('ccrc-ledgers-secrets-busy-');
    const ccrcDir = path.join(home, '.ccrc');
    mkdirSync(ccrcDir, { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(ccrcDir, 'coord.db')));
    const runA = (coord.openRun({ program: 'prog-a', title: 'PROG-A', project: 'project-a', wave: 1, waveOf: null, claimedBy: 'lane-a' }) as { id: number }).id;
    const id = coord.raiseItem({
      program: 'prog-a', runId: runA, raisedBy: 'lane-a', kind: 'secret', title: 't', why: 'w', how: [], options: null,
      neededBy: 'blocking', soonLabel: null, secretSlot: 'api-key',
    }, NOW0);
    const bare = Fastify({ logger: false });
    registerLedgerOperatorRoutes(bare, {
      coord, bus: new Bus(), now: () => NOW0 + 1, presenceOf: () => 'alive', gate: () => ({ pass: true }) as never, ccrcDir,
      registerSecret: () => 'unregistered', retireSecret: () => {}, slotWaitMs: 100,
    });
    const file = operatorSecretPath(ccrcDir, 'prog-a', 'api-key');
    let open!: () => void;
    const held = new Promise<void>((resolve) => { open = resolve; });
    let gated = false;
    const rename = fsp.rename.bind(fsp);
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      if (!gated && String(to) === file) { gated = true; await held; }
      return rename(from, to);
    });
    const first = bare.inject({ method: 'PUT', url: `/api/items/${id}/secret`, payload: { value: mark() } });
    await vi.waitFor(() => { expect(gated).toBe(true); });
    const second = await bare.inject({ method: 'PUT', url: `/api/items/${id}/secret`, payload: { value: mark() } });
    expect(second.statusCode).toBe(503);
    expect(second.json()).toMatchObject({ error: 'slot-busy' });
    const removing = await bare.inject({ method: 'DELETE', url: '/api/programmes/prog-a/secrets/api-key' });
    expect(removing.json()).toMatchObject({ error: 'slot-busy' });
    open();
    expect((await first).statusCode).toBe(200);
    await bare.close();
  });
});

describe('the write-failed arms answer the truth (review 1391 A-4)', () => {
  it('the fsync after the rename fails and the read-back cannot read the file: stored-not-ticked, and the masker was told', async () => {
    const t = await savedUnderScan((r) => {
      const dir = privateStore(r);
      const file = operatorSecretPath(r.ccrcDir, 'prog-a', 'api-key');
      const open = fsp.open.bind(fsp);
      let failed = false;
      vi.spyOn(fsp, 'open').mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
        if (!failed && String(args[0]) === dir && args[1] === 'r') { failed = true; throw Object.assign(new Error('EIO: i/o error, fsync'), { code: 'EIO' }); }
        if (failed && String(args[0]) === file) throw Object.assign(new Error('EIO: i/o error, open'), { code: 'EIO' });
        return open(...args);
      });
    });
    expect(body(t.res)['error']).toBe(LEDGER_ROUTE_REFUSALS.storedNotTicked);
    expect(readFileSync(t.valueFile, 'utf8')).toBe(t.value);
    expect(t.r.masker.maskText(t.value)).toBe(SECRET_MASK);
    expect(t.hits()).toEqual([]);
  });

  it('a register that throws is unregistered, never a failed write', async () => {
    const home = mkTmp('ccrc-ledgers-secrets-throw-');
    const dir = path.join(home, '.ccrc');
    mkdirSync(dir, { recursive: true });
    const meta = await writeOperatorSecret(dir, 'prog-a', 'x', mark(), NOW0, () => { throw new Error('boom'); });
    expect(meta).toEqual({ setAt: NOW0, tail: '', masked: false, why: 'unregistered' });
  });

  it('a failed record write removes the previous save\'s record, so no reader shows another save\'s time beside this value', async () => {
    const home = mkTmp('ccrc-ledgers-secrets-oldmeta-');
    const dir = path.join(home, '.ccrc');
    mkdirSync(dir, { recursive: true });
    await writeOperatorSecret(dir, 'prog-a', 'x', mark(), NOW0, () => 'masked');
    expect(readOperatorSecretMeta(dir, 'prog-a', 'x')?.setAt).toBe(NOW0);
    const metaFile = operatorSecretPath(dir, 'prog-a', 'x').replace(/\.secret$/, '.json');
    const rename = fsp.rename.bind(fsp);
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === metaFile) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
      return rename(from, to);
    });
    await expect(writeOperatorSecret(dir, 'prog-a', 'x', mark(), NOW0 + 9, () => 'masked')).rejects.toThrow(/stored in its slot/);
    expect(readOperatorSecretMeta(dir, 'prog-a', 'x')).toBeNull();
    expect(readStoredSecrets(dir, 'prog-a')).toEqual({ state: 'ok', slots: [{ slot: 'x', setAt: null, item: null }] });
  });
});

describe('the scan is blind to the masker (review 1391 F4)', () => {
  it('a blind rig\'s egress shows a registered value as written, so an echo is a hit; the real masker still masks it', async () => {
    const r = await rig({ egress: 'blind' });
    await r.stepUp();
    const value = mark();
    expect(body(await save(r, raiseSecret(r), value))['secret']).toMatchObject({ masked: true });
    const raised = await r.send({
      method: 'POST', url: '/api/programmes/prog-a/items', headers: TOKEN_HEADERS,
      payload: { byId: 'lane-a', byUuid: 'u-lane-a', kind: 'do', title: 'Echo', why: `the key is ${value}`, how: [], neededBy: 'later' },
    });
    expect(raised.statusCode, raised.body).toBe(200);
    expect((await r.send({ method: 'GET', url: '/api/waiting' })).body).toContain(value);
    expect(r.masker.maskText(value)).toBe(SECRET_MASK);
  });
});

describe('a re-save after a Remove is the re-key\'s again (the PL6 follow-up\'s commit review)', () => {
  it('a re-save that writes no row (no token yet) still clears the retired mark, so a later re-key fills the lane', async () => {
    const r = await rig();
    await r.stepUp();
    expect((await save(r, raiseSecret(r), mark())).statusCode).toBe(200);
    expect((await r.send({ method: 'DELETE', url: removeUrl('api-key') })).statusCode).toBe(200);
    const retired = (r.masker as unknown as { retiredLanes: Set<string> }).retiredLanes;
    expect(retired.has(operatorSecretLaneId('prog-a', 'api-key'))).toBe(true);
    const v2 = mark();
    expect(r.masker.ingestSecret(operatorSecretLaneId('prog-a', 'api-key'), 'short')).toBe('too-short');
    expect(retired.has(operatorSecretLaneId('prog-a', 'api-key'))).toBe(false);
    await writeOperatorSecret(r.ccrcDir, 'prog-a', 'api-key', v2, NOW0, () => 'unregistered');
    const t = r.token.value;
    const rows = await operatorSecretRows(r.ccrcDir, (lane, v) => fingerprintRow(t, lane, v));
    expect(r.masker.ingest(withOperatorSecretRows(null, fingerprintGeneration(t), rows.rows)!, { rekey: true })).toBe(true);
    expect(r.masker.maskText(v2)).toBe(SECRET_MASK);
  });

  it('the stored-secrets read goes through the answer masker: an asking item\'s title a session wrote is masked', async () => {
    const r = await rig();
    await r.stepUp();
    const value = mark();
    expect((await save(r, raiseSecret(r), value)).statusCode).toBe(200);
    const id = r.coord.raiseItem({
      program: 'prog-a', runId: r.runA, raisedBy: 'lane-a', kind: 'secret', title: `the key ${value}`, why: 'w', how: [], options: null,
      neededBy: 'later', soonLabel: null, secretSlot: 'k-two',
    }, NOW0);
    expect((await save(r, id, mark())).statusCode).toBe(200);
    const res = await r.send({ method: 'GET', url: '/api/programmes/prog-a/secrets' });
    expect(res.body).not.toContain(value);
    expect(res.body).toContain(SECRET_MASK);
  });
});
