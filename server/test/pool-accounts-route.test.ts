// Account-pool membership (design 2026-09-18 §5.5), wave 1 task 7: the write
// path the operator uses and the read `ccd-pool-sync` pulls.
//
// `POST /api/pools/accounts/:id` is the FIRST production caller of
// `CoordStore.setAccountPools` (Task 6). Its own docstring names the exact
// hazard this route must not fall into: `SetAccountPoolsResult` is a
// discriminated union, reading `.epoch` without narrowing `.ok` is a compile
// error, but DISCARDING the whole result compiles clean and silent — a
// refusal would then read as a success at the call site. The route binds and
// discriminates the result; this file's two-pool test is what stands between
// that and a silent lie.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { PoolEdgeLog } from '../src/coord/pooledgelog.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);

/** Cheap-cost scrypt params, the `asks-routes.test.ts`/`peers-route.test.ts`
 *  ARMED fixture: a real passphrase file, at a cost factor that does not pay
 *  scrypt's real ~100ms per test. Needed because an armed gate with NO
 *  readable secret fails SHUT (D-39 inversion, `auth/gate.ts`) regardless of
 *  the box token — so proving the box-token fallback actually works when
 *  armed needs a real, readable secret behind it. */
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';

/** One account, `acct-a`, so "tag a real account" and "tag an unrostered id"
 *  are two different, deliberate inputs rather than one accidental miss. */
const ROSTER = {
  version: 1,
  accounts: [{
    id: 'acct-a', label: 'acct-a', configDirSuffix: '.acct-a',
    exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
  }],
};

const failingRunner: Runner = async () => ({ code: 1, stdout: '', stderr: '' });

let home: string;
let app: FastifyInstance | undefined;
let coord: CoordStore | undefined;

const open = async (
  over: Partial<Deps> = {}, authEnabled = false,
): Promise<FastifyInstance> => {
  home = mkTmp('ccrc-pool-accounts-route-');
  seedRoster(home, ROSTER);
  const cfg = { ...loadConfig({ CCRC_HOME: home }), authEnabled };
  if (authEnabled) {
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'),
      `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  }
  coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const poolEdgeLog = new PoolEdgeLog(path.join(home, '.ccrc', 'pool-edges.log'));
  const a = await buildServer({
    cfg, runCcd: ccdRunner(failingRunner, cfg), tmux: new Tmux(failingRunner),
    io: localIO, queue: new KeyedQueue(), coord, poolEdgeLog, mailToken: TOKEN,
    ...over,
  } as Deps);
  await a.ready();
  return a;
};

const post = async (a: FastifyInstance, id: string, body: unknown) =>
  a.inject({ method: 'POST', url: `/api/pools/accounts/${id}`, payload: body as never });

beforeEach(() => { coord = undefined; });

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('POST /api/pools/accounts/:id', () => {
  it('tags an account and answers the MEASURED epoch, not the request', async () => {
    app = await open();
    const r = await post(app, 'acct-a', { pools: ['pool-a'] });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, epoch: 1 });
    // MEASURED: the reply's epoch is re-read from the store, not echoed.
    expect(coord!.poolEpoch().epoch).toBe(1);
    expect(coord!.accountPoolEdges().get('acct-a')).toEqual(['pool-a']);
  });

  it('answers the epoch it RE-MEASURES from the store, not whatever setAccountPools returned', async () => {
    // Mutation table row: "return `epoch: written.epoch` instead of
    // re-reading" must RED here. Within one synchronous handler (no `await`
    // between the write and the re-read) `written.epoch` and a fresh
    // `poolEpoch()` read can never genuinely diverge on their own — the only
    // way to PROVE the route re-reads rather than trusting the write's return
    // value is to make the write's return value WRONG on purpose and check
    // the reply still reports the truth.
    app = await open();
    const real = coord!.setAccountPools.bind(coord!);
    coord!.setAccountPools = (input, log) => {
      const r = real(input, log);
      // Fabricate a wrong epoch on the `ok` arm only — the caller must never
      // see this value if the route re-measures.
      return r.ok ? { ok: true as const, epoch: r.epoch + 999 } : r;
    };
    const r = await post(app, 'acct-a', { pools: ['pool-a'] });
    expect(r.statusCode).toBe(200);
    expect(r.json().epoch).toBe(1); // the TRUE, re-measured epoch — never 1000
    expect(coord!.poolEpoch().epoch).toBe(1);
  });

  it('refuses a pool name off the grammar with 400 bad-pool-name', async () => {
    app = await open();
    const r = await post(app, 'acct-a', { pools: ['Pool_A'] });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: 'bad-pool-name' });
  });

  it('400 bad-request when `pools` is missing or not an array of strings', async () => {
    app = await open();
    for (const payload of [{}, { pools: 'pool-a' }, { pools: [7] }, { pools: [null] }]) {
      const r = await post(app, 'acct-a', payload);
      expect(r.statusCode, JSON.stringify(payload)).toBe(400);
      expect(r.json()).toMatchObject({ error: 'bad-request' });
    }
  });

  it('answers a STRUCTURED refusal for a two-pool POST, never a 200 — the store is never silently discarded', async () => {
    // The obligation the type system will not enforce: a caller that
    // discards `setAccountPools`'s result compiles clean and a refusal reads
    // as a success. Wave 1 is one-pool-per-account (a partial unique index),
    // and this is the one input shape that exercises it end to end.
    app = await open();
    const r = await post(app, 'acct-a', { pools: ['pool-a', 'pool-b'] });
    expect(r.statusCode).not.toBe(200);
    expect(r.statusCode).toBe(400);
    expect(r.json().ok).toBe(false);
    expect(typeof r.json().error).toBe('string');
    // Nothing was written — a refused call must not leave a partial edge.
    expect(coord!.accountPoolEdges().has('acct-a')).toBe(false);
  });

  it('a SINGLE-pool POST is still refused when the STORE itself refuses — the route does not rely only on its own pre-check', async () => {
    // The two-pool test above is satisfied by this route's OWN `pools.length
    // > 1` pre-check alone, before `setAccountPools` is ever called — so it
    // cannot, by itself, prove the route actually DISCRIMINATES the store's
    // return value rather than discarding it. Measured (mutation): deleting
    // the `if (!written.ok)` branch and replacing it with `void written`
    // stays GREEN on every other test in this file, because nothing else
    // makes the store refuse. This test closes that gap by making the STORE
    // refuse a request the route's own pre-check would have let through — a
    // single pool — so only genuine discrimination of `written.ok` can pass
    // it.
    app = await open();
    const real = coord!.setAccountPools.bind(coord!);
    coord!.setAccountPools = (input, log) => {
      void real; void log;
      return { ok: false as const, error: 'multi-pool-not-supported' as const, pools: input.pools };
    };
    const r = await post(app, 'acct-a', { pools: ['pool-a'] });
    expect(r.statusCode).not.toBe(200);
    expect(r.json().ok).toBe(false);
    expect(coord!.accountPoolEdges().has('acct-a')).toBe(false);
  });

  it('an empty pools array CLEARS membership — legitimate, not a refusal', async () => {
    app = await open();
    await post(app, 'acct-a', { pools: ['pool-a'] });
    const r = await post(app, 'acct-a', { pools: [] });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true });
    expect(coord!.accountPoolEdges().has('acct-a')).toBe(false);
  });

  it('WARNS, never refuses, for an id no rostered account carries', async () => {
    app = await open();
    const r = await post(app, 'not-a-real-account', { pools: ['pool-a'] });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, warning: 'unknown-account' });
  });

  it('does NOT warn for an id the roster carries', async () => {
    app = await open();
    const r = await post(app, 'acct-a', { pools: ['pool-a'] });
    expect(Object.keys(r.json())).not.toContain('warning');
  });

  it('501 not-configured when the box has no coordination database', async () => {
    home = mkTmp('ccrc-pool-accounts-route-nocoord-');
    seedRoster(home, ROSTER);
    const cfg = loadConfig({ CCRC_HOME: home });
    app = await buildServer({
      cfg, runCcd: ccdRunner(failingRunner, cfg), tmux: new Tmux(failingRunner),
      io: localIO, queue: new KeyedQueue(),
    } as Deps);
    await app.ready();
    const r = await post(app, 'acct-a', { pools: ['pool-a'] });
    expect(r.statusCode).toBe(501);
    expect(r.json()).toMatchObject({ ok: false, error: 'not-configured' });
  });

  it('carries NO box token — it is fleet control, like the project-pool route', async () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.ts'), 'utf8');
    const route = src.slice(src.indexOf("app.post('/api/pools/accounts/:id'"));
    expect(route.slice(0, 1200)).not.toMatch(/requireMailToken|checkMailToken/);
  });
});

describe('GET /api/pools/epoch', () => {
  const get = async (a: FastifyInstance, headers: Record<string, string> = {}) =>
    a.inject({ method: 'GET', url: '/api/pools/epoch', headers });

  it('renders what ccd-pool-sync parses', async () => {
    app = await open();
    await post(app, 'acct-a', { pools: ['pool-a'] });
    const r = await get(app, { 'x-ccrc-mail-token': TOKEN });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      epoch: 1, accounts: { 'acct-a': { pools: ['pool-a'] } },
    });
    expect(typeof r.json().leaseUntil).toBe('number');
    expect(typeof r.json().issuedAt).toBe('number');
  });

  it('the epoch document is ALWAYS emitted, even with nothing tagged — empty is not absent', async () => {
    app = await open();
    const r = await get(app, { 'x-ccrc-mail-token': TOKEN });
    expect(r.statusCode).toBe(200);
    expect(r.json().accounts).toEqual({});
  });

  it('501 not-configured when the box has no coordination database', async () => {
    home = mkTmp('ccrc-pool-epoch-nocoord-');
    seedRoster(home, ROSTER);
    const cfg = loadConfig({ CCRC_HOME: home });
    app = await buildServer({
      cfg, runCcd: ccdRunner(failingRunner, cfg), tmux: new Tmux(failingRunner),
      io: localIO, queue: new KeyedQueue(),
    } as Deps);
    await app.ready();
    const r = await get(app);
    expect(r.statusCode).toBe(501);
  });

  it('dark (auth off): served with no credential at all', async () => {
    app = await open();
    const r = await get(app);
    expect(r.statusCode).toBe(200);
  });

  it('armed: a session OR the box token — neither means 401', async () => {
    app = await open({}, true);
    const withToken = await get(app, { 'x-ccrc-mail-token': TOKEN });
    expect(withToken.statusCode).toBe(200);
    const withNeither = await get(app);
    expect(withNeither.statusCode).toBe(401);
    expect(withNeither.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
  });
});
