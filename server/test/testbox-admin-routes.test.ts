// Test box connect plan TC12 (spec §2.1, §2.6, §2.10, §2.11, C14, T3, T10, D-8166): `GET /api/testbox/admin` and
// `POST /api/testbox/admin/:sub`, on the real server, through the real account gate and step-up, the real `TestboxAudit`
// over a real coord.db, and (unless a case says otherwise) the REAL local `TestboxAdminOps` arm over a stub `ccrc` launcher at
// `<home>/.local/bin/ccrc` that records its argv and prints what `<home>/stub/<sub>.{out,code}` say. So "the local arm and the
// agent arm send the same argv" and "no secret reaches a response, a log line or a row" are read off what actually ran.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { TESTBOX_ADMIN_CAP } from '../../shared/api.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import {
  TESTBOX_ADMIN_SUBS, TESTBOX_ADMIN_SUB_MAP, TESTBOX_ACTS, TESTBOX_ACT_OUTCOMES, TESTBOX_ADMIN_CODES, buildTestboxAdminArgv,
  type TestboxAdminSub,
} from '../../shared/testbox-admin.js';
import { testboxAdminSpawnArgv } from '../../agent/src/testboxAdminOp.js';
import { buildServer, type Deps } from '../src/server.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { openCoordDb } from '../src/coord/db.js';
import { MAIL_TOKEN_HEADER } from '../src/coord/token.js';
import type { FleetIdentityCell } from '../src/fleetidentity.js';
import type { FleetState } from '../src/fleetstate.js';
import type { PtyLike } from '../src/pty.js';
import { TestboxAudit } from '../src/testboxAudit.js';
import { agentTestboxAdminOps, localTestboxAdminOps, testboxAdminOpsFor, type TestboxAdminOps, type TestboxAdminOutcome } from '../src/testboxAdmin.js';
import { createIo } from '../src/remote/io.js';
import type { FleetClient } from '../src/remote/client.js';
import { AgentOpError, LinkNotSentError } from '../src/remote/errors.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
const BOX_TOKEN = 'box-token-for-the-testbox-admin-routes-suite';
const NODE = '0a17a17a-0000-4000-8000-0000000012c1';
const FP = `SHA256:${'A'.repeat(43)}`;
const FP2 = `SHA256:${'B'.repeat(43)}`;
const ACT_ID = 'c'.repeat(32);
const stubPty = (): PtyLike => ({ onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {} });

const ROW = {
  name: 'project-a', fetchUrl: 'https://testbox.invalid/project-a.git', mirrorPath: '/srv/mirror/project-a.git',
  packages: [{ name: 'server', installInputs: ['server/package.json'], commands: ['./node_modules/.bin/vitest'] }],
  buildOutputs: [], systemTools: [],
};

/** Valid fields for each sub, the smallest call that builds. */
const MIN: Record<TestboxAdminSub, Record<string, unknown>> = {
  'status': {}, 'read': {}, 'key': { address: '192.0.2.10' }, 'probe': {}, 'pin': { fingerprint: FP },
  'preflight': {}, 'connect': { settings: { CCRC_TESTBOX_WORKERS: '3' }, repos: [ROW] },
  'settings-fleet': { settings: { CCRC_TESTBOX_POLL: '1m' } }, 'settings-box': { settings: { CCRC_TESTBOX_WORKERS: '3' } },
  'cancel': {}, 'parity': {}, 'repair': {}, 'apply-release': {}, 'disconnect': {},
};
const POST_SUBS = (Object.keys(TESTBOX_ADMIN_SUB_MAP) as TestboxAdminSub[]).filter((s) => s !== 'status');
const STEP_UP_SUBS = POST_SUBS.filter((s) => TESTBOX_ADMIN_SUBS[s].stepUp);
const SESSION_SUBS = POST_SUBS.filter((s) => !TESTBOX_ADMIN_SUBS[s].stepUp);

/** The status document, as `ccrc testbox-admin status` prints it, for a box that is not connected. */
const STATUS = {
  v: 1, connected: false, addressSet: false, login: null, fingerprint: null, hostKey: 'none', boxFileSha256: null, act: null,
  boxSettings: null, boxSettingsAt: null, installedTag: null, parity: null,
};
const CONNECTED = { ...STATUS, connected: true, addressSet: true, login: 'root', fingerprint: FP, hostKey: 'pinned' };

/** The stub launcher: argv to a log, then its control files' output and exit. `$1` is `testbox-admin`, `$2` the sub. */
const STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/argv.log"
d="$HOME/stub"
[ -f "$d/$2.out" ] && cat "$d/$2.out"
if [ -f "$d/$2.code" ]; then exit "$(cat "$d/$2.code")"; fi
exit 0
`;

interface Rig {
  app: FastifyInstance; home: string; calls: { sub: TestboxAdminSub; fields: unknown }[];
  argv: () => string[]; stub: (sub: string, o: { out?: unknown; code?: number }) => void;
  rows: () => Record<string, unknown>[];
}

let app: FastifyInstance | undefined;
afterEach(async () => { vi.restoreAllMocks(); if (app) await app.close(); app = undefined; });

interface Opts { enabled?: boolean; origin?: string; caps?: string[]; ops?: TestboxAdminOps; noAudit?: boolean; breakAudit?: boolean }

async function openApp(o: Opts = {}): Promise<Rig> {
  const home = mkTmp('ccrc-testbox-admin-routes-');
  const base = testDeps(home);
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const bin = path.join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'ccrc'), STUB);
  chmodSync(path.join(bin, 'ccrc'), 0o755);
  mkdirSync(path.join(home, 'stub'), { recursive: true });
  const db = openCoordDb(path.join(home, '.ccrc', 'coord.db'));
  const audit = new TestboxAudit(db);
  if (o.breakAudit === true) db.exec('DROP TABLE testbox_events');
  const inner = o.ops ?? localTestboxAdminOps({ home, killGraceMs: 100 });
  const calls: Rig['calls'] = [];
  const ops: TestboxAdminOps = { arm: inner.arm, run: (sub, fields) => { calls.push({ sub, fields }); return inner.run(sub, fields); } };
  const deps: Deps = {
    ...base,
    cfg: { ...base.cfg, authEnabled: o.enabled ?? true, cookieSecure: false, rpId: 'localhost', origin: o.origin ?? 'http://localhost:7788' },
    mailToken: BOX_TOKEN, spawnPty: stubPty,
    fleetState: { ccdVerbs: o.caps ?? [TESTBOX_ADMIN_CAP] } as unknown as FleetState,
    fleetIdentity: { current: () => ({ kind: 'known', connectionEpoch: 1, nodeId: NODE, measuredAt: 0 }) } as unknown as FleetIdentityCell,
    testboxAdmin: ops,
    ...(o.noAudit === true ? {} : { testboxAudit: audit }),
  };
  const a = await buildServer(deps);
  await a.ready();
  app = a;
  const log = path.join(home, 'argv.log');
  const rig: Rig = {
    app: a, home, calls,
    argv: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l !== '') : []),
    stub: (sub, s) => {
      const d = path.join(home, 'stub');
      if (s.out !== undefined) writeFileSync(path.join(d, `${sub}.out`), typeof s.out === 'string' ? s.out : `${JSON.stringify(s.out)}\n`);
      if (s.code !== undefined) writeFileSync(path.join(d, `${sub}.code`), String(s.code));
    },
    rows: () => (o.breakAudit === true ? [] : db.prepare('SELECT * FROM testbox_events ORDER BY id').all() as Record<string, unknown>[]),
  };
  rig.stub('status', { out: STATUS });
  return rig;
}

const login = async (a: FastifyInstance): Promise<string> => {
  const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(204);
  const set = res.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  return line.slice(0, line.indexOf(';'));
};
const stepUp = async (a: FastifyInstance, cookie: string): Promise<void> => {
  const res = await a.inject({ method: 'POST', url: '/api/auth/step-up/passphrase', headers: { cookie }, payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(200);
};
const fresh = async (a: FastifyInstance): Promise<string> => { const c = await login(a); await stepUp(a, c); return c; };

const post = (r: Rig, sub: string, body: unknown, cookie?: string, extra: Record<string, string> = {}) =>
  r.app.inject({
    method: 'POST', url: `/api/testbox/admin/${sub}`, headers: { ...(cookie ? { cookie } : {}), ...extra },
    ...(body === undefined ? {} : { payload: body as object }),
  });
const get = (r: Rig, cookie?: string, extra: Record<string, string> = {}) =>
  r.app.inject({ method: 'GET', url: '/api/testbox/admin', headers: { ...(cookie ? { cookie } : {}), ...extra } });

describe('every admin route is session-only and takes the account gate first (D-8166, C14)', () => {
  it('every admin route is session-only and refuses the box token', async () => {
    const r = await openApp();
    const g = await get(r, undefined, { [MAIL_TOKEN_HEADER]: BOX_TOKEN });
    expect(g.statusCode).toBe(401);
    for (const sub of POST_SUBS) {
      const res = await post(r, sub, { fields: MIN[sub] }, undefined, { [MAIL_TOKEN_HEADER]: BOX_TOKEN });
      expect(res.statusCode, sub).toBe(401);
    }
    expect(r.calls).toEqual([]);
    expect(r.argv()).toEqual([]);
  });

  it('auth off answers auth-off, no-store, and runs nothing', async () => {
    const r = await openApp({ enabled: false });
    for (const res of [await get(r), await post(r, 'probe', { fields: {} })]) {
      expect(res.statusCode).toBe(REFUSAL_STATUS['auth-off']);
      expect(res.json()).toMatchObject({ ok: false, error: 'auth-off' });
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect(r.calls).toEqual([]);
  });

  it('an insecure origin answers insecure-origin, and runs nothing', async () => {
    const r = await openApp({ origin: 'http://ccrc.example.invalid:7788' });
    const cookie = await fresh(r.app);
    expect((await get(r, cookie)).json()).toMatchObject({ ok: false, error: 'insecure-origin' });
    expect((await post(r, 'probe', { fields: {} }, cookie)).json()).toMatchObject({ ok: false, error: 'insecure-origin' });
    expect(r.calls).toEqual([]);
  });

  it('a fleet without testbox-admin-v1 answers unsupported, and runs nothing', async () => {
    const r = await openApp({ caps: ['account-v2'] });
    const cookie = await fresh(r.app);
    expect((await get(r, cookie)).json()).toMatchObject({ ok: false, error: 'unsupported' });
    expect((await post(r, 'probe', { fields: {} }, cookie)).json()).toMatchObject({ ok: false, error: 'unsupported' });
    expect(r.calls).toEqual([]);
    expect(r.rows()).toEqual([]);
  });

  it('key, pin, connect and disconnect need a recent step-up; the rest need a session only', async () => {
    expect(STEP_UP_SUBS.sort()).toEqual(['connect', 'disconnect', 'key', 'pin']);
    const r = await openApp();
    const stale = await login(r.app);
    await fresh(r.app);   // a step-up on ANOTHER session counts for nothing here
    for (const sub of STEP_UP_SUBS) {
      const res = await post(r, sub, { fields: MIN[sub] }, stale);
      expect(res.statusCode, sub).toBe(REFUSAL_STATUS['step-up-required']);
      expect(res.json(), sub).toMatchObject({ ok: false, error: 'step-up-required' });
    }
    expect(r.calls).toEqual([]);
    expect(r.rows()).toEqual([]);
    for (const sub of SESSION_SUBS) {
      r.stub(sub, { out: { ok: true } });
      const res = await post(r, sub, { fields: MIN[sub] }, stale);
      expect(res.statusCode, `${sub}: ${res.body}`).toBe(200);
    }
  });
});

describe('the body is {fields} only and passes the builder before any op (T3)', () => {
  it('a field off its grammar is 400 and runs no op', async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    const bad: [string, unknown][] = [
      ['key', { address: 'not an address' }], ['key', { address: '192.0.2.10', extra: 'x' }], ['pin', { fingerprint: 'SHA256:x' }],
      ['key', {}], ['connect', { settings: { CCRC_TESTBOX_URL: 'https://testbox.invalid' }, repos: [ROW] }],
      ['settings-fleet', { settings: { CCRC_TESTBOX_POLL: 'soon' } }], ['probe', { address: '192.0.2.10' }],
      ['parity', { prs: ['x'] }], ['disconnect', { replace: 'yes' }],
    ];
    for (const [sub, fields] of bad) {
      const res = await post(r, sub, { fields }, cookie);
      expect(res.statusCode, `${sub} ${JSON.stringify(fields)}`).toBe(400);
      expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
    }
    expect(r.calls).toEqual([]);
    expect(r.argv()).toEqual([]);
  });

  it('a body with anything beside fields is 400, and so is a non-object body', async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    for (const body of [{ fields: {}, from: 'cli' }, { sub: 'probe' }, [1], 'text']) {
      const res = await post(r, 'probe', body, cookie);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(r.calls).toEqual([]);
  });

  it('status is not a POST sub, and an unknown sub is 400 behind the gate', async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    expect((await post(r, 'status', { fields: {} }, cookie)).statusCode).toBe(400);
    expect((await post(r, 'nonsense', { fields: {} }, cookie)).statusCode).toBe(400);
    expect((await post(r, 'nonsense', { fields: {} })).statusCode).toBe(401);
    expect(r.calls).toEqual([]);
  });

  it('a sub with no fields takes no body at all', async () => {
    const r = await openApp();
    const cookie = await login(r.app);
    r.stub('probe', { out: { ok: true, fingerprint: FP } });
    const res = await post(r, 'probe', undefined, cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, result: { fingerprint: FP } });
  });
});

describe('the answer is the re-read status, never the request (spec §2.1)', () => {
  it('GET answers the status and the ten newest events', async () => {
    const r = await openApp();
    r.stub('status', { out: CONNECTED });
    const cookie = await fresh(r.app);
    for (let i = 0; i < 12; i++) await post(r, 'key', { fields: { address: '192.0.2.10' } }, cookie);
    const res = await get(r, cookie);
    expect(res.statusCode).toBe(200);
    const j = res.json() as { ok: boolean; status: unknown; events: { id: number; act: string }[] };
    expect(j.ok).toBe(true);
    expect(j.status).toEqual(CONNECTED);
    expect(j.events).toHaveLength(10);
    expect(j.events.map((e) => e.id)).toEqual([...j.events.map((e) => e.id)].sort((a, b) => b - a));
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('a POST answers the status read AFTER the act, not what the act printed or the caller sent', async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    r.stub('key', { out: { ok: true, line: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPUBLICKEYLINE ccrc-testbox' } });
    r.stub('status', { out: CONNECTED });
    const res = await post(r, 'key', { fields: { address: '192.0.2.10', port: 2222, user: 'root' } }, cookie);
    expect(res.statusCode, res.body).toBe(200);
    const j = res.json() as { status: unknown; result: { line: string } };
    expect(j.status).toEqual(CONNECTED);
    expect(j.result.line).toBe('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPUBLICKEYLINE ccrc-testbox');
    expect(JSON.stringify(j)).not.toContain('2222');
    // the act ran first, the status read after it
    expect(r.calls.map((c) => c.sub)).toEqual(['key', 'status']);
  });

  it('a status the one reader refuses is a fleet failure, never a guess', async () => {
    const r = await openApp();
    r.stub('status', { out: { ...STATUS, extra: 'field' } });
    const cookie = await login(r.app);
    const res = await get(r, cookie);
    expect(res.statusCode).toBe(REFUSAL_STATUS['fleetFailed']);
    expect(res.json()).toMatchObject({ ok: false, error: 'fleetFailed' });
  });

  it('the result carries only what each sub is allowed to say', async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    r.stub('preflight', { out: { ok: true, pass: false, checks: [
      { check: 'address', ok: true, code: null }, { check: 'from', ok: false, code: 'from-mismatch' },
    ], line: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFIXED ccrc-testbox', surprise: '/etc/shadow' } });
    const res = await post(r, 'preflight', { fields: {} }, cookie);
    expect(res.json()).toMatchObject({ ok: true, result: { pass: false, checks: [
      { check: 'address', ok: true, code: null }, { check: 'from', ok: false, code: 'from-mismatch' },
    ], fixLine: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFIXED ccrc-testbox' } });
    expect(res.body).not.toContain('shadow');
    // a long act answers its id
    r.stub('connect', { out: { ok: true, act: ACT_ID } });
    const c = await post(r, 'connect', { fields: MIN['connect'] }, cookie);
    expect(c.json()).toMatchObject({ ok: true, result: { act: ACT_ID } });
  });
});

describe('a refusal is a word, and a lost answer is said so (spec §2.1, D-5518)', () => {
  it("the verb's closed code rides testbox-admin-refused, with the settings it names", async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    r.stub('settings-box', { out: { ok: false, code: 'box-value-refused', keys: ['CCRC_TESTBOX_WORKERS'] } });
    const res = await post(r, 'settings-box', { fields: MIN['settings-box'] }, cookie);
    expect(res.statusCode).toBe(REFUSAL_STATUS['testbox-admin-refused']);
    expect(res.json()).toEqual({ ok: false, error: 'testbox-admin-refused', code: 'box-value-refused', keys: ['CCRC_TESTBOX_WORKERS'] });
    // a code off the closed list never crosses
    r.stub('probe', { out: { ok: false, code: 'rm -rf /' } });
    const bad = await post(r, 'probe', { fields: {} }, cookie);
    expect(bad.json()).toMatchObject({ ok: false, error: 'fleetFailed' });
    expect(bad.body).not.toContain('rm -rf');
  });

  it('a timeout, a lost answer and an output past its cap answer outcome-unknown, and the route never retries', async () => {
    for (const kind of ['timeout', 'lost', 'too-large'] as const) {
      let n = 0;
      const ops: TestboxAdminOps = { arm: 'remote', run: async () => { n += 1; return { kind } as TestboxAdminOutcome; } };
      const r = await openApp({ ops });
      const cookie = await fresh(r.app);
      const res = await post(r, 'key', { fields: MIN['key'] }, cookie);
      expect(res.json(), kind).toMatchObject({ ok: false, error: 'outcome-unknown' });
      expect(n, kind).toBe(1);
      expect(r.rows().map((x) => [x['act'], x['outcome'], x['code']]), kind).toEqual([['connect', 'unknown', 'outcome-unknown']]);
      await app!.close(); app = undefined;
    }
  });

  it('an agent without the op answers unsupported, and a launcher that did not start answers fleetFailed', async () => {
    const r1 = await openApp({ ops: { arm: 'remote', run: async () => ({ kind: 'unsupported' }) } });
    const c1 = await fresh(r1.app);
    expect((await post(r1, 'key', { fields: MIN['key'] }, c1)).json()).toMatchObject({ ok: false, error: 'unsupported' });
    await app!.close(); app = undefined;
    const r2 = await openApp({ ops: { arm: 'remote', run: async () => ({ kind: 'not-started' }) } });
    const c2 = await fresh(r2.app);
    expect((await post(r2, 'key', { fields: MIN['key'] }, c2)).json()).toMatchObject({ ok: false, error: 'fleetFailed' });
    expect(r2.rows().map((x) => [x['outcome'], x['code']])).toEqual([['failed', 'fleetFailed']]);
  });

  it('a server with no ops at all answers once the gate passes, and runs nothing', async () => {
    const home = mkTmp('ccrc-testbox-admin-noops-');
    const base = testDeps(home);
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
    const a = await buildServer({
      ...base, cfg: { ...base.cfg, authEnabled: true, cookieSecure: false, rpId: 'localhost', origin: 'http://localhost:7788' },
      mailToken: BOX_TOKEN, spawnPty: stubPty, fleetState: { ccdVerbs: [TESTBOX_ADMIN_CAP] } as unknown as FleetState,
    });
    await a.ready();
    app = a;
    const cookie = await login(a);
    const res = await a.inject({ method: 'GET', url: '/api/testbox/admin', headers: { cookie } });
    expect(res.statusCode).toBe(REFUSAL_STATUS['fleetFailed']);
  });
});

describe('the ledger: one closed row per short act (spec §2.10, T10)', () => {
  it('every short act writes one testbox_events row with a closed act, outcome and code', async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    r.stub('key', { out: { ok: true, line: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPUBLICKEYLINE ccrc-testbox' } });
    r.stub('pin', { out: { ok: true, fingerprint: FP } });
    r.stub('settings-fleet', { out: { ok: true, settings: [] } });
    r.stub('settings-box', { out: { ok: false, code: 'runs-in-progress' } });
    r.stub('cancel', { out: { ok: true, cancelled: false } });
    r.stub('disconnect', { out: { ok: true } });
    const asked: [TestboxAdminSub, unknown][] = [
      ['key', MIN['key']], ['pin', MIN['pin']], ['settings-fleet', MIN['settings-fleet']], ['settings-box', MIN['settings-box']],
      ['cancel', {}], ['disconnect', {}], ['disconnect', { replace: true }],
    ];
    for (const [sub, fields] of asked) await post(r, sub, { fields }, cookie);
    const rows = r.rows();
    expect(rows.map((x) => [x['act'], x['outcome'], x['code'], x['fingerprint']])).toEqual([
      ['connect', 'ok', null, null], ['confirm-host-key', 'ok', null, FP], ['settings-fleet', 'ok', null, null],
      ['settings-box', 'refused', 'runs-in-progress', null], ['cancel', 'ok', null, null], ['disconnect', 'ok', null, null],
      ['replace', 'ok', null, null],
    ]);
    for (const row of rows) {
      expect(TESTBOX_ACTS).toContain(row['act']);
      expect(TESTBOX_ACT_OUTCOMES).toContain(row['outcome']);
      expect(row['code'] === null || (TESTBOX_ADMIN_CODES as readonly string[]).includes(row['code'] as string)).toBe(true);
      expect(String(row['actor'])).toMatch(/ [0-9a-f]{8}$/);
      expect(row['fleetIdentity']).toBe(NODE);
      expect(row['actId']).toBeNull();
    }
  });

  it('a long act that never started writes a refused row, and one that started writes none', async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    r.stub('connect', { out: { ok: false, code: 'busy' } });
    r.stub('parity', { out: { ok: true, act: ACT_ID } });
    await post(r, 'connect', { fields: MIN['connect'] }, cookie);
    await post(r, 'parity', { fields: {} }, cookie);
    expect(r.rows().map((x) => [x['act'], x['outcome'], x['code']])).toEqual([['connect', 'refused', 'busy']]);
  });

  it('a failed ledger write still answers the act', async () => {
    const r = await openApp({ breakAudit: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cookie = await fresh(r.app);
    r.stub('key', { out: { ok: true, line: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPUBLICKEYLINE ccrc-testbox' } });
    const res = await post(r, 'key', { fields: MIN['key'] }, cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(warn).toHaveBeenCalled();
  });

  it('the ledger writer refuses what is off its vocabularies, and a repeated act id', async () => {
    const home = mkTmp('ccrc-testbox-audit-');
    const db = openCoordDb(path.join(home, '.ccrc', 'coord.db'));
    const audit = new TestboxAudit(db);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { actorOf } = await import('../src/accounts/audit.js');
    const actor = actorOf('a test phone', 'ab'.repeat(32));
    const good = { act: 'connect', outcome: 'ok', fleetIdentity: NODE, actor } as const;
    expect(audit.write({ ...good }).ok).toBe(true);
    const refusals = [
      { ...good, act: 'format-disk' }, { ...good, outcome: 'maybe' }, { ...good, outcome: 'ok', code: 'busy' },
      { ...good, outcome: 'failed', code: 'a free sentence' }, { ...good, fingerprint: 'SHA256:short' },
      { ...good, fleetIdentity: '192.0.2.10' }, { ...good, actor: { toString: () => 'x 00000000' } }, { ...good, actId: 'not-an-id' },
    ];
    for (const row of refusals) expect(audit.write(row as never).ok, JSON.stringify(row)).toBe(false);
    expect(audit.write({ ...good, actId: ACT_ID }).ok).toBe(true);
    expect(audit.write({ ...good, actId: ACT_ID })).toEqual({ ok: false, why: 'duplicate' });
    expect((db.prepare('SELECT COUNT(*) AS n FROM testbox_events').get() as { n: number }).n).toBe(2);
  });

  it('no row holds an address, a path, a secret or free text', async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    r.stub('key', { out: { ok: true, line: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPUBLICKEYLINE ccrc-testbox' } });
    r.stub('pin', { out: { ok: false, code: 'fingerprint-mismatch' } });
    await post(r, 'key', { fields: { address: '192.0.2.10', port: 22, user: 'root' } }, cookie);
    await post(r, 'pin', { fields: { fingerprint: FP2 } }, cookie);
    const blob = JSON.stringify(r.rows());
    for (const leak of ['192.0.2.10', 'ssh-ed25519', 'AAAAC3', '/', 'root', 'testbox.invalid']) expect(blob, leak).not.toContain(leak);
    // the one string a row may carry beside its vocabularies is the pin's fingerprint
    expect(blob).toContain(FP2);
  });
});

describe('the local arm and the agent arm send the same argv (spec §2.11)', () => {
  it('the launcher is given the builder argv then --from pwa, and the agent adds --from agent to the same words', async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    for (const sub of POST_SUBS) r.stub(sub, { out: { ok: true } });
    r.stub('connect', { out: { ok: true, act: ACT_ID } });
    for (const sub of POST_SUBS) await post(r, sub, { fields: MIN[sub] }, cookie);
    const seen = r.argv().filter((l) => !l.startsWith('testbox-admin status'));
    expect(seen).toHaveLength(POST_SUBS.length);
    for (const [i, sub] of POST_SUBS.entries()) {
      const built = buildTestboxAdminArgv(sub, MIN[sub]);
      expect(built.ok).toBe(true);
      const words = built.ok ? built.argv : [];
      expect(seen[i], sub).toBe([...words, '--from', 'pwa'].join(' '));
      const agent = testboxAdminSpawnArgv(sub, MIN[sub]);
      expect(agent.ok && agent.argv.slice(0, -2), sub).toEqual(words);
      expect(agent.ok && agent.argv.slice(-2), sub).toEqual(['--from', 'agent']);
    }
  });

  it('the status read after an act is the same status call the GET makes', async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    r.stub('probe', { out: { ok: true, fingerprint: FP } });
    await post(r, 'probe', { fields: {} }, cookie);
    await get(r, cookie);
    expect(r.argv().filter((l) => l.startsWith('testbox-admin status'))).toEqual(
      ['testbox-admin status --from pwa', 'testbox-admin status --from pwa'],
    );
  });
});

describe('no secret reaches a response, a log line or a row (T3)', () => {
  it('the token, the push key and the access key never appear anywhere the server writes', async () => {
    const r = await openApp();
    // The fake verb's private files hold sentinels. Nothing the verb prints names them; the server never opens them.
    const SENTINELS = ['TOKEN-SENTINEL-7f3a91', 'PUSHKEY-SENTINEL-2c8e44', 'ACCESSKEY-SENTINEL-95d0b1'];
    const priv = path.join(r.home, '.ccrc');
    writeFileSync(path.join(priv, 'testbox-token'), SENTINELS[0]!, { mode: 0o600 });
    writeFileSync(path.join(priv, 'testbox-push-key'), SENTINELS[1]!, { mode: 0o600 });
    writeFileSync(path.join(priv, 'testbox-admin-key'), SENTINELS[2]!, { mode: 0o600 });
    const logs: string[] = [];
    for (const m of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
    }
    const cookie = await fresh(r.app);
    r.stub('status', { out: CONNECTED });
    r.stub('key', { out: { ok: true, line: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPUBLICKEYLINE ccrc-testbox' } });
    r.stub('settings-box', { out: { ok: false, code: 'key-in-ccrc-env', keys: ['CCRC_TESTBOX_WORKERS'] } });
    r.stub('connect', { out: { ok: true, act: ACT_ID } });
    const bodies = [
      (await get(r, cookie)).body,
      (await post(r, 'key', { fields: MIN['key'] }, cookie)).body,
      (await post(r, 'settings-box', { fields: MIN['settings-box'] }, cookie)).body,
      (await post(r, 'connect', { fields: MIN['connect'] }, cookie)).body,
      (await post(r, 'pin', { fields: MIN['pin'] })).body,
    ];
    const everything = [...bodies, ...logs, JSON.stringify(r.rows()), r.argv().join('\n')].join('\n');
    for (const s of SENTINELS) expect(everything, s).not.toContain(s);
    // and no route answer names a private file
    for (const word of ['testbox-token', 'testbox-push-key', 'testbox-admin-key', 'BEGIN OPENSSH PRIVATE KEY']) {
      expect(everything, word).not.toContain(word);
    }
  });
});

describe('the agent arm: FleetIO.testboxAdmin over the link (spec §2.11)', () => {
  /** A client that records the frames it is handed and answers what `answer` says, or throws. */
  const clientOf = (agentOps: string[] | undefined, answer: () => unknown) => {
    const sent: { payload: Record<string, unknown>; timeoutMs: number | undefined }[] = [];
    const client = {
      state: { agentOps },
      request: async (payload: Record<string, unknown>, timeoutMs?: number) => { sent.push({ payload, timeoutMs }); return answer(); },
    } as unknown as FleetClient;
    return { io: createIo(client), sent };
  };
  const EXITED = { kind: 'exited', code: 0, stdout: '{"ok":true}\n', fleetIdentity: NODE };

  it('sends the typed frame, with the builder-checked fields unchanged, and answers the node outcome without its identity', async () => {
    const { io, sent } = clientOf(['testbox-admin'], () => EXITED);
    const out = await io.testboxAdmin('key', MIN['key'] as never);
    expect(out).toEqual({ kind: 'exited', code: 0, stdout: '{"ok":true}\n' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toEqual({ t: 'req', op: 'testbox-admin', sub: 'key', fields: MIN['key'] });
    // a long sub gets the long bound plus the grace, the drain and a margin; a short one the short bound
    await io.testboxAdmin('connect', MIN['connect'] as never);
    expect(sent[1]!.timeoutMs).toBeLessThan(sent[0]!.timeoutMs!);
  });

  it('never sends a call the builder refuses, or to an agent that does not list the op', async () => {
    const a = clientOf(['testbox-admin'], () => EXITED);
    expect(await a.io.testboxAdmin('key', { address: 'not an address' } as never)).toEqual({ kind: 'refused', why: 'bad-field' });
    expect(await a.io.testboxAdmin('nonsense' as never, {})).toEqual({ kind: 'refused', why: 'bad-sub' });
    expect(a.sent).toEqual([]);
    for (const ops of [undefined, [], ['account']]) {
      const b = clientOf(ops, () => EXITED);
      expect(await b.io.testboxAdmin('probe', {})).toEqual({ kind: 'unsupported' });
      expect(b.sent).toEqual([]);
    }
  });

  it('an older agent answering bad-request is unsupported, a frame that never left is not-started, anything else is lost', async () => {
    const cases: [() => unknown, unknown][] = [
      [() => { throw new AgentOpError('bad-request', null); }, { kind: 'unsupported' }],
      [() => { throw new LinkNotSentError('not connected'); }, { kind: 'not-started' }],
      [() => { throw new Error('timeout'); }, { kind: 'lost' }],
      [() => ({ kind: 'exited', code: 0 }), { kind: 'lost' }],
      [() => 'garbage', { kind: 'lost' }],
    ];
    for (const [answer, want] of cases) {
      const { io } = clientOf(['testbox-admin'], answer);
      expect(await io.testboxAdmin('probe', {})).toEqual(want);
    }
  });

  it('the arm is chosen by fleetMode alone: a remote fleet never gets the local spawner', async () => {
    const home = mkTmp('ccrc-testbox-arm-');
    const { io } = clientOf(['testbox-admin'], () => EXITED);
    expect(testboxAdminOpsFor({ fleetMode: 'remote', home }, io).arm).toBe('remote');
    expect(testboxAdminOpsFor({ fleetMode: 'local', home }, io).arm).toBe('local');
    expect(await agentTestboxAdminOps({ testboxAdmin: async () => { throw new Error('boom'); } }).run('probe', {})).toEqual({ kind: 'lost' });
  });
});
