// Programme ledgers (plan PL6, spec §5): secrets pasted into the console go straight to a protected slot. Real server over a
// fixture HOME with sign-in ARMED (a passphrase, a real session cookie, the real step-up), a real `CoordStore`, a real
// `SecretMasker` and a real /ws/fleet socket, neutral names (prog-a, lane-a).
//
// THE HEADLINE IS THE LEAK SCAN. It saves `SECRET-MARK-<24 random characters>` and then looks for that mark everywhere the
// code writes or answers: every table of coord.db and the database files' own bytes, every other file under the fixture HOME
// (the slot's metadata included; only the slot's value file may hold it), every route response the flow made and the reads
// that carry item, mail, feed and ledger text, every frame the socket received (the `waiting` frame among them), and
// everything written to the console. Zero hits. A write this task adds is added to the scan.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { SecretMasker, fingerprintGeneration, fingerprintRow } from '../src/accounts/mask.js';
import { loadConfig, reloadRoster } from '../src/config.js';
import {
  OPERATOR_SECRETS_DIR, OperatorSecretBadSlot, operatorSecretLanes, operatorSecretPath, operatorSecretRows, readOperatorSecretMeta,
  withOperatorSecretRows, writeOperatorSecret,
} from '../src/coord/ledgersSecrets.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { DEFAULT_TEST_ROSTER, seedRoster, testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { SECRET_MASK, type FleetMsg } from '../../shared/api.js';
import { SECRET_TAIL_MIN, SECRET_VALUE_MAX, secretAnswer, type ItemView } from '../../shared/ledgers.js';
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
  /** Every response this rig's `send` made, for the leak scan. */
  answers: string[];
  send: (o: { method: 'GET' | 'PUT' | 'POST'; url: string; payload?: unknown; headers?: Record<string, string>; raw?: string }) => Promise<LightMyRequestResponse>;
  stepUp: () => Promise<void>;
}

/** An ARMED server: sign-in on, a loopback origin, a session from the passphrase login. `stepUp` takes the passphrase step. */
async function rig(o: { armed?: boolean; origin?: string; masker?: boolean } = {}): Promise<Rig> {
  const home = mkTmp('ccrc-ledgers-secrets-');
  seedRow(home, 'lane-a');
  const ccrcDir = path.join(home, '.ccrc');
  mkdirSync(ccrcDir, { recursive: true });
  writeFileSync(path.join(ccrcDir, 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const coord = new CoordStore(openCoordDb(path.join(ccrcDir, 'coord.db')));
  const masker = new SecretMasker({ db: coord.db, token: () => ID_GATE_TOKEN });
  maskers.push(masker);
  const base = testDeps(home, recorder().run);
  const armed = o.armed ?? true;
  const deps: Deps = {
    ...base, coord, mailToken: ID_GATE_TOKEN, ...(o.masker === false ? {} : { masker }),
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
    app, coord, home, ccrcDir, cookie, port, runA, masker, answers, send,
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

describe('the leak scan (plan PL6 Step 1, spec §5: no secret value anywhere but its protected file)', () => {
  it('the leak scan: a saved SECRET-MARK value appears in no table, no other file, no response, no frame and no console line', async () => {
    const out = captureConsole();
    const r = await rig();
    const value = mark();
    const id = raiseSecret(r);
    const sock = listen(r);
    await sock.waiting(() => true);

    // Refusals that carry the value first, each a fixed word with nothing of the body in it.
    const noStep = await save(r, id, value);
    expect(body(noStep)['error']).toBe('step-up-required');
    await r.stepUp();
    expect(body(await r.send({ method: 'PUT', url: `/api/items/${id}/secret`, raw: `{"value":"${value}` })).error).toBe('bad-request');
    expect(body(await r.send({ method: 'PUT', url: `/api/items/${id}/secret`, raw: JSON.stringify({ value: value.repeat(800) }) })).error).toBe('oversize');
    expect(body(await save(r, id, `${value}${'x'.repeat(SECRET_VALUE_MAX)}`)).error).toBe('bad-request');
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

    // THE SCAN.
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
    const valueFile = operatorSecretPath(r.ccrcDir, 'prog-a', 'api-key');
    const files = walk(r.home);
    expect(files, 'the scan reads the coord.db file').toContain(path.join(r.ccrcDir, 'coord.db'));
    expect(files, 'the scan reads the slot metadata').toContain(valueFile.replace(/\.secret$/, '.json'));
    for (const f of files) {
      if (f === valueFile) continue;
      const bytes = readFileSync(f);
      if (bytes.includes(Buffer.from(value, 'utf8'))) hits.push(`file ${path.relative(r.home, f)}`);
    }
    r.answers.forEach((a, i) => { if (a.includes(value)) hits.push(`response #${i} ${a.slice(0, 40)}`); });
    sock.raw.forEach((f, i) => { if (f.includes(value)) hits.push(`frame #${i}`); });
    out.forEach((l, i) => { if (l.includes(value)) hits.push(`console #${i}`); });
    expect(hits).toEqual([]);

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
    expect(a['secret']).toMatchObject({ masked: false, why: 'unregistered' });
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
    expect(operatorSecretLanes(cfg.ccrcDir)).toEqual(['operator-secret:prog-a:api-key']);
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
    const answer = withOperatorSecretRows(null, fingerprintGeneration(token), await rowsUnder(token));
    expect(answer?.gen).toBe(fingerprintGeneration(token));
    expect(masker.ingest(answer!)).toBe(true);
    expect((db.prepare('SELECT gen FROM secret_fingerprints').all() as { gen: string }[]).map((g) => g.gen)).toEqual([fingerprintGeneration(token)]);
    expect(masker.maskText(value)).toBe(SECRET_MASK);
    // A box answer keyed with another generation is passed on unchanged: `ingest` refuses it, as it would without rows.
    const other = { gen: fingerprintGeneration('c'.repeat(64)), rows: [] };
    expect(withOperatorSecretRows(other, fingerprintGeneration(token), await rowsUnder(token))).toBe(other);
    // …and one keyed with it gets the rows beside its own.
    const same = { gen: fingerprintGeneration(token), rows: [] };
    expect(withOperatorSecretRows(same, fingerprintGeneration(token), await rowsUnder(token))?.rows.map((x) => x.laneId)).toEqual(['operator-secret:prog-a:api-key']);
  });

  it('a store directory that is a symlink, or open to others, refuses the write', async () => {
    const home = mkTmp('ccrc-ledgers-secrets-unsafe-');
    const dir = path.join(home, '.ccrc');
    mkdirSync(path.join(dir, OPERATOR_SECRETS_DIR), { recursive: true, mode: 0o755 });
    await expect(writeOperatorSecret(dir, 'prog-a', 'x', mark(), NOW0, () => 'unregistered')).rejects.toThrow(/not a private directory/);
    expect(existsSync(path.join(dir, OPERATOR_SECRETS_DIR, 'prog-a'))).toBe(false);
  });
});
