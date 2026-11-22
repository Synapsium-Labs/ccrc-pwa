// Overlord W2, private names B (plan w2-private-names.md, Task 6): the upload door `PUT /api/overlord/private-names` and the
// status read `GET /api/overlord/private-names`. A real server over a fixture HOME with sign-in ARMED (a passphrase, a real
// session cookie, the real step-up), a real private store, synthetic names only (`zz-alpha`, `zq-bravo-x9`, `zz-delta`).
//
// THE HEADLINE IS THAT NO NAME LEAVES THE HANDLER: every response this file's rig received, and every console line written
// while it ran, is searched for every synthetic name it sent, refusals included.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs, { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import { OPERATOR_SECRETS_DIR, SERVER_SECRETS_DIR, readServerSecretValue, serverSecretPath } from '../src/coord/ledgersSecrets.js';
import { CANARY, entriesOf, entryOf } from '../../shared/private-names.mjs';
import { NAME_LIST_BODY_MAX, NAME_LIST_KEY_SLOT, NAME_LIST_MAX_CHARS, NAME_LIST_MAX_ROWS, NAME_LIST_ROW_REFUSALS } from '../../shared/privateNames.js';
import { recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import * as callerIdentity from '../src/auth/attributionIdentity.js';

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'a test passphrase for the name list suite';
const ORIGIN = 'http://localhost:7788';
const URL_ = '/api/overlord/private-names';
/** Every synthetic name any test here sends: the leak scan looks for each in every answer and console line. */
const NAMES = ['zz-alpha', 'zq-bravo-x9', 'zz-delta', 'zz-echo-q4', 'zz-oversize-marker', 'zz-m\u00fcq', 'zz-e\u0301q', 'zz-\u03b6\u03ae', 'zz-\u0663q'];
const BOX_TOKEN = 'box-token-for-the-name-list-suite';
const issuer: PrivacyIssuer = { kind: 'ready', issue: () => ({ ok: true, id: 1 }) };

let app: FastifyInstance | null = null;
const dbs: DatabaseSync[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
  app = null;
  for (const db of dbs.splice(0)) if (db.isOpen) db.close();
  removeTmpFixtures();
});

interface Rig {
  ccrcDir: string; home: string; db: DatabaseSync; store: OperatorModelStore; answers: string[]; console: string[];
  send: (o: { method: 'GET' | 'PUT'; payload?: unknown; raw?: string; cookie?: boolean; headers?: Record<string, string> }) => Promise<LightMyRequestResponse>;
  stepUp: () => Promise<void>;
}

async function rig(o: { armed?: boolean; store?: boolean } = {}): Promise<Rig> {
  const lines: string[] = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a) ?? String(a))).join(' ')); });
  }
  const home = mkTmp('ccrc-names-routes-');
  seedRow(home, 'lane-a');
  const ccrcDir = path.join(home, '.ccrc');
  mkdirSync(ccrcDir, { recursive: true });
  writeFileSync(path.join(ccrcDir, 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const db = openOperatorModelDb(defaultOperatorModelDbPath(home));
  dbs.push(db);
  const store = new OperatorModelStore(db, issuer);
  const base = testDeps(home, recorder().run);
  const armed = o.armed ?? true;
  const deps: Deps = {
    ...base, mailToken: BOX_TOKEN, ...(o.store === false ? { operatorModel: undefined } : { operatorModel: store }),
    cfg: { ...base.cfg, ccrcDir, authEnabled: armed, cookieSecure: false, rpId: 'localhost', origin: ORIGIN },
  };
  app = await buildServer(deps, new Bus());
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
  const send: Rig['send'] = async ({ method, payload, raw, cookie: withCookie = true, headers = {} }) => {
    const res = await self.inject({
      method, url: URL_,
      headers: { ...headers, ...(withCookie ? { cookie } : {}), origin: ORIGIN, ...(payload === undefined && raw === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(raw !== undefined ? { payload: raw } : payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
    answers.push(`${method} ${res.statusCode} ${JSON.stringify(res.headers)} ${res.body}`);
    return res;
  };
  return {
    ccrcDir, home, db, store, answers, console: lines, send,
    stepUp: async () => {
      const r = await self.inject({ method: 'POST', url: '/api/auth/step-up/passphrase', payload: { passphrase: PASSPHRASE }, headers: { cookie, origin: ORIGIN } });
      expect(r.statusCode, r.body).toBeLessThan(300);
    },
  };
}

const put = (r: Rig, payload: unknown) => r.send({ method: 'PUT', payload });
const get = (r: Rig) => r.send({ method: 'GET' });
const json = (res: { body: string }): Record<string, unknown> => JSON.parse(res.body) as Record<string, unknown>;
const ROWS = [{ text: 'zz-alpha', mode: 'part' }, { text: 'zq-bravo-x9', mode: 'exact' }] as const;
const keyOf = (r: Rig): string => {
  const k = readServerSecretValue(r.ccrcDir, NAME_LIST_KEY_SLOT);
  if (k.state !== 'value') throw new Error(`no key: ${k.state}`);
  return k.value;
};
const listOf = (r: Rig) => r.store.privateNamesRead();
/** No synthetic name in any answer or console line this rig saw. */
function expectNoLeak(r: Rig): void {
  for (const n of NAMES) {
    r.answers.forEach((a, i) => expect(a.includes(n), `answer #${i} holds ${n}`).toBe(false));
    r.console.forEach((l, i) => expect(l.includes(n), `console #${i} holds ${n}`).toBe(false));
  }
}

describe('PUT /api/overlord/private-names: the gate, before the body is used', () => {
  it('a refused identity actor stops before any key or list write (gates A)', async () => {
    const real = callerIdentity.attributionIdentity;
    vi.spyOn(callerIdentity, 'attributionIdentity').mockImplementation((deps) => ({
      ...real(deps), operator: () => { throw new Error('the test identity port refused the actor'); },
    }));
    const r = await rig();
    await r.stepUp();
    const res = await put(r, { rows: ROWS });
    // The existing credential-body error handler maps thrown errors to a fixed bad-request, never their text.
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ error: 'bad-request' });
    expect(listOf(r)).toEqual({ kind: 'measured', value: { kind: 'none' } });
    expect(readServerSecretValue(r.ccrcDir, NAME_LIST_KEY_SLOT)).toEqual({ state: 'absent' });
    expectNoLeak(r);
  });
  it('no session: refused by the session gate, and nothing is written', async () => {
    const r = await rig();
    const res = await r.send({ method: 'PUT', payload: { rows: ROWS }, cookie: false });
    expect(res.statusCode).toBe(401);
    expect(listOf(r)).toEqual({ kind: 'measured', value: { kind: 'none' } });
    expect(readServerSecretValue(r.ccrcDir, NAME_LIST_KEY_SLOT)).toEqual({ state: 'absent' });
    expectNoLeak(r);
  });

  it('no recent step-up: step-up-required, no-store, no key minted and nothing stored', async () => {
    const r = await rig();
    const res = await put(r, { rows: ROWS });
    expect(json(res)).toMatchObject({ error: 'step-up-required' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(listOf(r)).toEqual({ kind: 'measured', value: { kind: 'none' } });
    expect(readServerSecretValue(r.ccrcDir, NAME_LIST_KEY_SLOT)).toEqual({ state: 'absent' });
    expectNoLeak(r);
  });

  it('sign-in dark: auth-off, no-store, nothing written', async () => {
    const r = await rig({ armed: false });
    const res = await put(r, { rows: ROWS });
    expect(json(res)).toMatchObject({ error: 'auth-off' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(listOf(r)).toEqual({ kind: 'measured', value: { kind: 'none' } });
    expectNoLeak(r);
  });
});

describe('PUT: the body, checked against the caps and the tokenizer, never echoed', () => {
  it('malformed JSON is bad-request, and the body is not echoed', async () => {
    const r = await rig();
    await r.stepUp();
    const res = await r.send({ method: 'PUT', raw: '{"rows":[{"text":"zz-alpha","mode":' });
    expect(json(res)).toMatchObject({ error: 'bad-request' });
    expect(res.headers['cache-control']).toBe('no-store');
    expectNoLeak(r);
  });

  it('a body over NAME_LIST_BODY_MAX is oversize, and is not echoed', async () => {
    const r = await rig();
    await r.stepUp();
    const res = await r.send({ method: 'PUT', raw: JSON.stringify({ rows: [{ text: `zz-oversize-marker ${'x'.repeat(NAME_LIST_BODY_MAX)}`, mode: 'part' }] }) });
    expect(json(res)).toMatchObject({ error: 'oversize' });
    expect(res.headers['cache-control']).toBe('no-store');
    expectNoLeak(r);
  });

  it('each bad body is bad-request whose detail names the row by index, never any row\'s text, and nothing is written', async () => {
    const r = await rig();
    await r.stepUp();
    const good = { text: 'zz-delta', mode: 'part' };
    const cases: [unknown, RegExp][] = [
      [{ rows: Array.from({ length: NAME_LIST_MAX_ROWS + 1 }, () => good) }, /at most 1000 rows/],
      [{ rows: [good, { text: `zz-echo-q4${'y'.repeat(NAME_LIST_MAX_CHARS)}`, mode: 'part' }] }, /^row 1: text is 1 to 120/],
      [{ rows: [good, good, { text: 'ζήτα', mode: 'part' }] }, /^row 2: a letter or digit outside a-z/],
      [{ rows: [{ text: '—', mode: 'exact' }] }, /^row 0: no letter or digit/],
      [{ rows: [good, { text: 'zz-echo-q4', mode: 'loose' }] }, /^row 1: mode is/],
      [{ rows: [{ text: 'zz-echo-q4', mode: 'part', note: 'zz-alpha' }] }, /^row 0: text and mode only/],
      [{ rows: [good], extra: 1 }, /rows and clear only/],
      [{ rows: [] }, /send clear: true to clear it/],
      [{ rows: [good], clear: true }, /send it with no rows/],
      [{ rows: [], clear: false }, /clear is true or absent/],
      [{ rows: 'zz-alpha' }, /rows is an array/],
      [[good], /the body is/],
      [{ rows: [{ text: '', mode: 'part' }] }, /^row 0: text is 1 to/],
      [{ rows: [null] }, /^row 0: not/],
    ];
    const reasons = new Set<unknown>();
    for (const [body, detail] of cases) {
      const res = await put(r, body);
      expect(json(res), JSON.stringify(body).slice(0, 60)).toMatchObject({ error: 'bad-request' });
      expect(String(json(res)['detail'])).toMatch(detail);
      expect(res.headers['cache-control']).toBe('no-store');
      const m = /^row (\d+):/.exec(String(json(res)['detail']));
      // A row refusal carries its position and a reason word; a refusal of the whole body carries neither.
      if (m === null) expect(Object.keys(json(res)).sort()).toEqual(['detail', 'error', 'ok']);
      else { expect(json(res)['row']).toBe(Number(m[1])); reasons.add(json(res)['reason']); }
    }
    expect([...reasons].sort()).toEqual([...NAME_LIST_ROW_REFUSALS].sort());
    expect(listOf(r)).toEqual({ kind: 'measured', value: { kind: 'none' } });
    expect(readServerSecretValue(r.ccrcDir, NAME_LIST_KEY_SLOT)).toEqual({ state: 'absent' });
    expectNoLeak(r);
  });
});

describe('PUT: a row with a letter or digit outside ASCII is refused, never half guarded (review 2344 F3, non-ascii-row-is-refused)', () => {
  it('refused with the reason word non-ascii and the row\'s position, after NFKC; nothing is written and no text is echoed', async () => {
    const r = await rig();
    await r.stepUp();
    const good = { text: 'zz-delta', mode: 'part' };
    // ü (a precomposed letter), e + U+0301 (NFKC composes it to é), Greek, and an Arabic-Indic digit three.
    for (const text of ['zz-m\u00fcq', 'zz-e\u0301q', 'zz-\u03b6\u03ae', 'zz-\u0663q']) {
      const res = await put(r, { rows: [good, { text, mode: 'part' }] });
      expect(res.headers['cache-control']).toBe('no-store');
      const body = json(res);
      expect(body, JSON.stringify(text.length)).toMatchObject({ ok: false, error: 'bad-request', reason: 'non-ascii', row: 1 });
      expect(String(body['detail'])).toMatch(/^row 1: a letter or digit outside a-z and 0-9/);
    }
    expect(listOf(r)).toEqual({ kind: 'measured', value: { kind: 'none' } });
    expect(readServerSecretValue(r.ccrcDir, NAME_LIST_KEY_SLOT)).toEqual({ state: 'absent' });
    expectNoLeak(r);
  });

  it('a row NFKC folds to ASCII (fullwidth letters) is accepted, and a row with no letter or digit at all keeps its own word', async () => {
    const r = await rig();
    await r.stepUp();
    expect((await put(r, { rows: [{ text: '\uff5a\uff5a-\uff51\uff58', mode: 'part' }] })).statusCode).toBe(200);
    expect(json(await put(r, { rows: [{ text: '\u2014', mode: 'exact' }] }))).toMatchObject({ error: 'bad-request', reason: 'no-token', row: 0 });
    expect(json(await put(r, { rows: [{ text: 'zz-echo-q4', mode: 'loose' }] }))).toMatchObject({ error: 'bad-request', reason: 'mode', row: 0 });
    expectNoLeak(r);
  });
});

describe('PUT: the upload, its key and its order', () => {
  it('a good body answers ok, rows, entries and uploadedAt; the store holds the canary first and every row\'s entries under the slot\'s key', async () => {
    const r = await rig();
    await r.stepUp();
    const res = await put(r, { rows: ROWS });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const key = keyOf(r);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    const want = [entryOf(CANARY, 'part', key), ...entriesOf('zz-alpha', 'part', key), ...entriesOf('zq-bravo-x9', 'exact', key)];
    const body = json(res);
    expect(Object.keys(body).sort()).toEqual(['entries', 'ok', 'rows', 'uploadedAt']);
    expect(body).toMatchObject({ ok: true, rows: 2, entries: want.length });
    expect(listOf(r)).toEqual({ kind: 'measured', value: { kind: 'list', uploadedAt: body['uploadedAt'], rows: 2, generation: 1, entries: want } });
    expectNoLeak(r);
  });

  it('the first upload mints the key; a second keeps it and raises the generation', async () => {
    const r = await rig();
    await r.stepUp();
    await put(r, { rows: ROWS });
    const first = keyOf(r);
    const res = await put(r, { rows: [{ text: 'zz-delta', mode: 'run' }] });
    expect(res.statusCode, res.body).toBe(200);
    expect(keyOf(r)).toBe(first);
    expect(listOf(r)).toMatchObject({ value: { kind: 'list', rows: 1, generation: 2, entries: [entryOf(CANARY, 'part', first), ...entriesOf('zz-delta', 'run', first)] } });
    expectNoLeak(r);
  });

  it('the slot removed under a stored list: the next upload mints a new key and replaces the list under it', async () => {
    const r = await rig();
    await r.stepUp();
    await put(r, { rows: ROWS });
    const first = keyOf(r);
    rmSync(serverSecretPath(r.ccrcDir, NAME_LIST_KEY_SLOT));
    expect(json(await get(r))).toEqual({ state: 'unreadable', reason: 'key-missing' });
    expect((await put(r, { rows: ROWS })).statusCode).toBe(200);
    const second = keyOf(r);
    expect(second).not.toBe(first);
    expect(listOf(r)).toMatchObject({ value: { kind: 'list', generation: 2 } });
    const after = listOf(r);
    expect(after.kind === 'measured' && after.value.kind === 'list' && after.value.entries[0]).toEqual(entryOf(CANARY, 'part', second));
    expect(json(await get(r))).toMatchObject({ state: 'list', rows: 2 });
    expectNoLeak(r);
  });

  it.skipIf(process.getuid?.() === 0)('an unreadable slot answers write-failed, mints nothing and leaves the store as it was', async () => {
    const r = await rig();
    await r.stepUp();
    await put(r, { rows: ROWS });
    const before = listOf(r);
    const file = serverSecretPath(r.ccrcDir, NAME_LIST_KEY_SLOT);
    chmodSync(file, 0o000);
    try {
      const res = await put(r, { rows: [{ text: 'zz-delta', mode: 'part' }] });
      expect(json(res)).toMatchObject({ error: 'write-failed' });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(listOf(r)).toEqual(before);
    } finally { chmodSync(file, 0o600); }
    expect(readServerSecretValue(r.ccrcDir, NAME_LIST_KEY_SLOT).state).toBe('value');
    expectNoLeak(r);
  });

  it('two uploads started together finish one after the other: one key in the slot, one list under it', async () => {
    const r = await rig();
    await r.stepUp();
    const [a, b] = await Promise.all([put(r, { rows: ROWS }), put(r, { rows: [{ text: 'zz-delta', mode: 'part' }] })]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    const key = keyOf(r);
    const read = listOf(r);
    expect(read).toMatchObject({ value: { kind: 'list', generation: 2 } });
    if (read.kind !== 'measured' || read.value.kind !== 'list') throw new Error('no list');
    expect(read.value.entries[0]).toEqual(entryOf(CANARY, 'part', key));
    expect(json(await get(r))).toMatchObject({ state: 'list' });
    expectNoLeak(r);
  });

  it('the second upload waits for the first: held inside the first\'s key write, it touches neither the slot nor the store', async () => {
    const r = await rig();
    await r.stepUp();
    const realRename = fs.promises.rename;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let held!: () => void;
    const reached = new Promise<void>((resolve) => { held = resolve; });
    let first = true;
    const spy = vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (first && String(to).endsWith(`${NAME_LIST_KEY_SLOT}.secret`)) { first = false; held(); await gate; }
      return realRename(from, to);
    });
    try {
      const a = put(r, { rows: ROWS });
      await reached;
      let bDone = false;
      const b = put(r, { rows: [{ text: 'zz-delta', mode: 'part' }] }).then((res) => { bDone = true; return res; });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(bDone).toBe(false);
      expect(listOf(r)).toEqual({ kind: 'measured', value: { kind: 'none' } });
      expect(readServerSecretValue(r.ccrcDir, NAME_LIST_KEY_SLOT)).toEqual({ state: 'absent' });
      release();
      const [ra, rb] = await Promise.all([a, b]);
      expect([ra.statusCode, rb.statusCode]).toEqual([200, 200]);
    } finally { spy.mockRestore(); }
    const key = keyOf(r);
    expect(listOf(r)).toMatchObject({ value: { kind: 'list', rows: 1, generation: 2, entries: [entryOf(CANARY, 'part', key), ...entriesOf('zz-delta', 'part', key)] } });
    expectNoLeak(r);
  });

  it.skipIf(process.getuid?.() === 0)('a key write that fails answers write-failed with the store untouched', async () => {
    const r = await rig();
    await r.stepUp();
    const top = path.join(r.ccrcDir, OPERATOR_SECRETS_DIR);
    mkdirSync(top, { mode: 0o700 });
    chmodSync(top, 0o500);
    try {
      const res = await put(r, { rows: ROWS });
      expect(json(res)).toMatchObject({ error: 'write-failed' });
      expect(listOf(r)).toEqual({ kind: 'measured', value: { kind: 'none' } });
      expect(json(await get(r))).toEqual({ state: 'none' });
    } finally { chmodSync(top, 0o700); }
    expect(readServerSecretValue(r.ccrcDir, NAME_LIST_KEY_SLOT)).toEqual({ state: 'absent' });
    expectNoLeak(r);
  });

  it('a store write that fails answers write-failed, and the status then reads unreadable, never none', async () => {
    const r = await rig();
    await r.stepUp();
    r.db.exec("CREATE TRIGGER stop_list BEFORE INSERT ON private_name_list BEGIN SELECT RAISE(ABORT, 'stopped'); END");
    const res = await put(r, { rows: ROWS });
    expect(json(res)).toMatchObject({ error: 'write-failed' });
    expect(String(json(res)['detail'])).not.toMatch(/stopped/);
    expect(json(await get(r))).toEqual({ state: 'unreadable', reason: 'list-missing' });
    r.db.exec('DROP TRIGGER stop_list');
    expect((await put(r, { rows: ROWS })).statusCode).toBe(200);
    expect(json(await get(r))).toMatchObject({ state: 'list', rows: 2 });
    expectNoLeak(r);
  });

  it('a minted key whose record fails after it reached the slot: the slot is re-read, holds the key, and the list is stored under it', async () => {
    const r = await rig();
    await r.stepUp();
    const file = serverSecretPath(r.ccrcDir, NAME_LIST_KEY_SLOT);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    chmodSync(path.join(r.ccrcDir, OPERATOR_SECRETS_DIR), 0o700);
    const record = `${file.slice(0, -'.secret'.length)}.json`;
    mkdirSync(path.join(record, 'blocker'), { recursive: true });  // the record cannot be renamed over a non-empty directory
    const res = await put(r, { rows: ROWS });
    expect(res.statusCode, res.body).toBe(200);
    const key = keyOf(r);
    expect(listOf(r)).toMatchObject({ value: { kind: 'list', rows: 2, generation: 1 } });
    const read = listOf(r);
    expect(read.kind === 'measured' && read.value.kind === 'list' && read.value.entries[0]).toEqual(entryOf(CANARY, 'part', key));
    expect(json(await get(r))).toMatchObject({ state: 'list', rows: 2 });
    expectNoLeak(r);
  });

  it('a minted key that may not have reached the slot (its write failed, the read-back could not read): write-failed, the store untouched', async () => {
    const r = await rig();
    await r.stepUp();
    const file = serverSecretPath(r.ccrcDir, NAME_LIST_KEY_SLOT);
    const realOpen = fs.promises.open;
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (_from, to) => {
      if (String(to) === file) throw Object.assign(new Error('EIO: injected'), { code: 'EIO' });
      throw new Error(`unexpected rename to ${String(to)}`);
    });
    vi.spyOn(fs.promises, 'open').mockImplementation((async (p: fs.PathLike, flags?: unknown, mode?: unknown) => {
      if (String(p) === file) throw Object.assign(new Error('EACCES: injected'), { code: 'EACCES' });
      return realOpen(p, flags as never, mode as never);
    }) as typeof fs.promises.open);
    const res = await put(r, { rows: ROWS });
    vi.restoreAllMocks();
    expect(json(res)).toMatchObject({ error: 'write-failed' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(listOf(r)).toEqual({ kind: 'measured', value: { kind: 'none' } });
    expect(readServerSecretValue(r.ccrcDir, NAME_LIST_KEY_SLOT)).toEqual({ state: 'absent' });
    expect(json(await get(r))).toEqual({ state: 'none' });
  });

  it('a slot value that is not a minted key: the status reads key-unreadable, never list, and an upload answers write-failed and builds nothing under it (review 2344 F2)', async () => {
    const r = await rig();
    await r.stepUp();
    await put(r, { rows: ROWS });
    const before = listOf(r);
    const file = serverSecretPath(r.ccrcDir, NAME_LIST_KEY_SLOT);
    for (const value of ['', 'c3'.repeat(16), 'A1'.repeat(32)]) {
      writeFileSync(file, value, { mode: 0o600 });
      expect(json(await get(r))).toEqual({ state: 'unreadable', reason: 'key-unreadable' });
      expect(json(await put(r, { rows: ROWS }))).toMatchObject({ error: 'write-failed' });
      expect(listOf(r)).toEqual(before);
      expect(json(await get(r))).toEqual({ state: 'unreadable', reason: 'key-unreadable' });
    }
    expectNoLeak(r);
  });

  it('a server with no private store: not-configured, and no key is minted', async () => {
    const r = await rig({ store: false });
    await r.stepUp();
    const res = await put(r, { rows: ROWS });
    expect(json(res)).toMatchObject({ error: 'not-configured' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(readServerSecretValue(r.ccrcDir, NAME_LIST_KEY_SLOT)).toEqual({ state: 'absent' });
    expect(json(await get(r))).toEqual({ state: 'unreadable', reason: 'store' });
    expectNoLeak(r);
  });

  it('the box token without a cookie opens neither door: refused by the session gate, nothing written', async () => {
    const r = await rig();
    for (const method of ['PUT', 'GET'] as const) {
      const res = await r.send({ method, ...(method === 'PUT' ? { payload: { rows: ROWS } } : {}), cookie: false, headers: { 'x-ccrc-mail-token': BOX_TOKEN } });
      expect(res.statusCode, `${method} ${res.body}`).toBe(401);
    }
    expect(listOf(r)).toEqual({ kind: 'measured', value: { kind: 'none' } });
    expect(readServerSecretValue(r.ccrcDir, NAME_LIST_KEY_SLOT)).toEqual({ state: 'absent' });
    expectNoLeak(r);
  });

  it('the confirmed clear stores the canary alone: a list of zero rows, never none', async () => {
    const r = await rig();
    await r.stepUp();
    await put(r, { rows: ROWS });
    const res = await put(r, { rows: [], clear: true });
    expect(json(res)).toMatchObject({ ok: true, rows: 0, entries: 1 });
    expect(json(await get(r))).toMatchObject({ state: 'list', rows: 0 });
    expectNoLeak(r);
  });
});

describe('GET /api/overlord/private-names: whether a list is stored, never what is in it', () => {
  it('none before any upload; list with rows and uploadedAt after one; key-missing; list-missing; always no-store and never an entry or hash', async () => {
    const r = await rig();
    await r.stepUp();
    const g0 = await get(r);
    expect(g0.headers['cache-control']).toBe('no-store');
    expect(json(g0)).toEqual({ state: 'none' });
    const up = json(await put(r, { rows: ROWS }));
    const g1 = await get(r);
    expect(g1.headers['cache-control']).toBe('no-store');
    expect(json(g1)).toEqual({ state: 'list', rows: 2, uploadedAt: up['uploadedAt'] });
    const key = keyOf(r);
    const stored = listOf(r);
    if (stored.kind !== 'measured' || stored.value.kind !== 'list') throw new Error('no list');
    for (const e of stored.value.entries) { expect(g1.body).not.toContain(e.h); expect(g1.body).not.toContain(e.f); expect(g1.body).not.toContain(e.h.slice(0, 8)); }
    expect(g1.body).not.toContain(key);
    r.db.exec('DELETE FROM private_name_list');
    expect(json(await get(r))).toEqual({ state: 'unreadable', reason: 'list-missing' });
    rmSync(serverSecretPath(r.ccrcDir, NAME_LIST_KEY_SLOT));
    expect(json(await get(r))).toEqual({ state: 'none' });
    expect(path.dirname(serverSecretPath(r.ccrcDir, NAME_LIST_KEY_SLOT))).toBe(path.join(r.ccrcDir, OPERATOR_SECRETS_DIR, SERVER_SECRETS_DIR));
    expectNoLeak(r);
  });

  it('no session: refused by the session gate', async () => {
    const r = await rig();
    expect((await r.send({ method: 'GET', cookie: false })).statusCode).toBe(401);
  });
});
