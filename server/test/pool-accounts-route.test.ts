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
import { buildServer, resolvePoolLeaseMs, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { PoolEdgeLog } from '../src/coord/pooledgelog.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { ACCOUNT_ID_RE } from '../../shared/roster.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { execFileSync } from 'node:child_process';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { POOLS_DIR_NAME } from '../src/pools.js';

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

const get = async (a: FastifyInstance, headers: Record<string, string> = {}) =>
  a.inject({ method: 'GET', url: '/api/pools/epoch', headers });

beforeEach(() => { coord = undefined; });

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  // `store.db.close()` — the convention `pool-edges-store.test.ts` sets
  // (review round 1, Minor 10): checkpoints WAL into the main file and
  // releases the handle rather than leaking one per test.
  if (coord) coord.db.close();
  coord = undefined;
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

  it('refuses an :id off the pool-epoch document\'s account-id grammar with 400 bad-account-id (review round 1, I5)', async () => {
    // Measured: an id off `ACCOUNT_ID_RE` stored verbatim becomes a key in
    // the epoch document, and `ccd-pool-sync`'s renderer refuses the WHOLE
    // document on ANY bad key — not just the bad row — so every node then
    // keeps its stale projection and retries every 60s. One request stops
    // fleet-wide convergence. This is a CHARSET refusal, distinct from the
    // MEMBERSHIP warning below: an id ON the grammar that no rostered
    // account carries still only warns.
    app = await open();
    // Each of these is one path SEGMENT once decoded (no `/`, no control
    // characters) — `encodeURIComponent` on the raw id is exactly what a real
    // client sends for "acct a" and the reviewer's own measured `acct%20a`
    // repro, and `a`.repeat(65) needs no encoding at all.
    for (const id of ['acct a', ' ', 'a'.repeat(65)]) {
      const r = await post(app, encodeURIComponent(id), { pools: ['pool-a'] });
      expect(r.statusCode, JSON.stringify(id)).toBe(400);
      expect(r.json()).toMatchObject({ error: 'bad-account-id' });
    }
    expect(coord!.accountPoolEdges().size).toBe(0);
  });

  it('accepts an :id on the grammar the roster does not have, as a WARNING — charset and membership are different questions', async () => {
    app = await open();
    const r = await post(app, 'not.a_real-Account99', { pools: ['pool-a'] });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, warning: 'unknown-account' });
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
    //
    // NO ROUTE-LEVEL PRE-CHECK (review round 1, Minor 7 — dropped): this
    // refusal is now the STORE's own (`multi-pool-not-supported`,
    // `SET_ACCOUNT_POOLS_REFUSE_CODES`), reached only if the route actually
    // binds and discriminates `setAccountPools`'s result — a pre-check that
    // re-spelled the same rule under `one-pool-per-account` used to make this
    // exact test pass without ever exercising that discrimination.
    app = await open();
    const r = await post(app, 'acct-a', { pools: ['pool-a', 'pool-b'] });
    expect(r.statusCode).not.toBe(200);
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ ok: false, error: 'multi-pool-not-supported', pools: ['pool-a', 'pool-b'] });
    // Nothing was written — a refused call must not leave a partial edge.
    expect(coord!.accountPoolEdges().has('acct-a')).toBe(false);
  });

  it('a SINGLE-pool POST is still refused when the STORE itself refuses — extra regression cover beyond the two-pool case', async () => {
    // Now that the two-pool test above exercises the store's REAL refusal
    // (Minor 7), this is belt-and-braces: it proves the route's `written.ok`
    // discrimination generalises to ANY store refusal, not just today's one
    // reason, by making the store refuse an input its own rule would allow.
    // Measured (mutation): deleting the `if (!written.ok)` branch and
    // replacing it with `void written` now REDS on the two-pool test above
    // too — this second test is no longer the only thing standing between
    // the route and a silent lie, but it still closes the "what if a future
    // rule adds a second refusal reason this route's own mirror doesn't
    // know about" gap.
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

  it('501 not-configured when coord is present but poolEdgeLog is absent (review round 1, Minor 10)', async () => {
    // Ruling P2: T6 constructs `PoolEdgeLog` beside `coord` in `index.ts` — a
    // box could still reach this handler with one and not the other only
    // through a test that builds `Deps` by hand, but the route's own guard
    // (`!deps.coord || !deps.poolEdgeLog`) must refuse THIS half too, not
    // only the half every other test exercises.
    home = mkTmp('ccrc-pool-accounts-route-noedgelog-');
    seedRoster(home, ROSTER);
    const cfg = loadConfig({ CCRC_HOME: home });
    coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    app = await buildServer({
      cfg, runCcd: ccdRunner(failingRunner, cfg), tmux: new Tmux(failingRunner),
      io: localIO, queue: new KeyedQueue(), coord,
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

describe('ACCOUNT_ID_RE parity — the one TypeScript spelling against the two fleet-side ones', () => {
  // Lighter-weight than `pool-name-parity.test.ts`'s "exactly one occurrence"
  // machinery (that file's own precedent for why hand-kept copies across
  // languages must be held equal HERE: neither `ccd/ccd` nor
  // `ccd/ccd-pool-sync` can import a TypeScript constant) — this extracts the
  // FIRST literal match rather than proving there is exactly one, which is
  // enough to catch the drift this review round is about: a THIRD spelling
  // (this route's own validation) disagreeing with either of the first two.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..', '..');

  it('equals ccd/ccd-pool-sync\'s python ID regex', () => {
    const src = readFileSync(path.join(repoRoot, 'ccd', 'ccd-pool-sync'), 'utf8');
    const m = /ID = re\.compile\(r"(\^\[A-Za-z0-9\._-\]\{1,64\}\$)"\)/.exec(src);
    expect(m, 'ccd-pool-sync\'s ID literal moved or was not found — this parity check is over nothing')
      .not.toBeNull();
    expect(ACCOUNT_ID_RE.source).toBe(m![1]);
  });

  it('equals ccd/ccd\'s bash account-id check', () => {
    // `CCD` (`ccdWsHelpers.js`) — the ONE path to `ccd/ccd`,
    // `single-definition.test.ts`'s own canonical holder, not re-derived here.
    const src = readFileSync(CCD, 'utf8');
    const m = /\[\[ "\$v" =~ (\^\[A-Za-z0-9\._-\]\{1,64\}\$) \]\]/.exec(src);
    expect(m, 'ccd\'s bash account-id literal moved or was not found — this parity check is over nothing')
      .not.toBeNull();
    expect(ACCOUNT_ID_RE.source).toBe(m![1]);
  });
});

/**
 * C1 (CRITICAL, review round 1) — `leaseUntil`/`issuedAt` were emitted in
 * MILLISECONDS while every reader in the tree (`ccd/ccd:2366-2367`'s
 * `now=$(date +%s)`) compares in UNIX SECONDS, pinning the `stale` arm
 * unreachable for ~56,700 years — a control plane that dies would have left
 * every node enforcing its last projection FOREVER, exactly the hazard spec
 * §5.8 exists to bound. Nothing reds this by construction: every ccd-side
 * fixture is hand-written in seconds and the server-side test asserted only
 * `typeof leaseUntil === 'number'` — two sides, each internally consistent,
 * each green against its OWN fixtures, disagreeing at the seam.
 *
 * So this suite feeds the WRITER'S OWN, LIVE output — `GET /api/pools/epoch`'s
 * real JSON response, from a real running server — through the REAL fleet-side
 * pipeline: `ccd/ccd-pool-sync`'s python renderer (via a stubbed `curl`, the
 * same technique `ccd-pool-sync.test.ts` uses) writing directly into a real
 * `CcdHarness`'s `$REG/pool-epoch`, then `ccd/ccd`'s own `_acct_pool_state`
 * reading that exact file. Neither side's OWN fixtures can see this defect —
 * only a body built by ONE side and read by the OTHER can.
 */
describe('C1 — the writer\'s output through the REAL renderer and the REAL reader', () => {
  let h: CcdHarness | undefined;
  afterEach(() => { if (h) h.cleanup(); h = undefined; });

  const repoRootForSync = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const CCD_POOL_SYNC = path.join(repoRootForSync, 'ccd', 'ccd-pool-sync');

  /** Run the REAL `ccd-pool-sync` against `home`, with a stubbed `curl` that
   *  answers `body` — writing directly to `home/.cc-sessions/pool-epoch`, the
   *  exact file `_acct_pool_state` reads, so no hand-copy of the rendered text
   *  can drift from what the real python renderer actually produced. */
  const syncInto = (home: string, body: string): void => {
    const bin = path.join(home, 'bin');
    mkdirSync(bin, { recursive: true });
    const escaped = body.replace(/'/g, `'\\''`);
    writeFileSync(path.join(bin, 'curl'),
      `#!/usr/bin/env bash\ncat > /dev/null\nprintf '%s\\n%s' '${escaped}' '200'\n`, { mode: 0o755 });
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'agent.env'), 'CCRC_SERVER_URL=https://example.invalid\n', 'utf8');
    mkdirSync(path.join(home, '.cc-secrets'), { recursive: true });
    writeFileSync(path.join(home, '.cc-secrets', 'ccrc-mail.token'), 'tok\n', 'utf8');
    const env = ghContainedEnv(
      home, { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` },
      { systemd: true, tmux: true });
    execFileSync('bash', [CCD_POOL_SYNC], { encoding: 'utf8', env });
  };

  it('the LIVE writer\'s fresh output reads as current, not stale', async () => {
    app = await open();
    await post(app, 'acct-a', { pools: ['pool-a'] });
    const body = (await get(app, { 'x-ccrc-mail-token': TOKEN })).body;
    h = makeCcdHarness('pools-cross-side-fresh');
    syncInto(h.home, body);
    expect(h.sh('_acct_pool_state acct-a')).toBe('named pool-a');
  });

  it('the writer\'s own output, with an ALREADY-ELAPSED lease, reads as stale — the exact regression C1 found', async () => {
    app = await open();
    await post(app, 'acct-a', { pools: ['pool-a'] });
    const real = (await get(app, { 'x-ccrc-mail-token': TOKEN })).json() as { leaseUntil: number };
    // The WRITER'S OWN OUTPUT, ONE FIELD PERTURBED to simulate an elapsed
    // lease deterministically (waiting out a real 15-minute lease is not a
    // test) — `epoch`/`issuedAt`/`accounts`, and crucially the UNITS every
    // field is in, are exactly what the route emitted.
    //
    // MUTATION-PROVABLE: reverting `leaseUntil` to milliseconds
    // (`Date.now() + POOL_LEASE_MS`) leaves this value roughly 1000x larger
    // than `now` in seconds — subtracting 100000 barely dents it, so the
    // reader would still answer `named pool-a`, not `stale`, and this test
    // reds on exactly the regression C1 measured.
    const stale = { ...real, leaseUntil: real.leaseUntil - 100_000 };
    h = makeCcdHarness('pools-cross-side-stale');
    syncInto(h.home, JSON.stringify(stale));
    expect(h.sh('_acct_pool_state acct-a')).toBe('stale');
  });
});

describe('resolvePoolLeaseMs (review round 1, Minor 8)', () => {
  it('a valid positive number is used as-is, no warning', () => {
    expect(resolvePoolLeaseMs({ CCRC_POOL_LEASE_MS: '5000' })).toEqual({ value: 5000, warning: null });
  });

  it('absent or empty falls back to the default SILENTLY — nobody set anything', () => {
    expect(resolvePoolLeaseMs({}).warning).toBeNull();
    expect(resolvePoolLeaseMs({ CCRC_POOL_LEASE_MS: '' }).warning).toBeNull();
  });

  it('a typo\'d value falls back to the default and WARNS, naming the bad value', () => {
    // The regression this closes: `Number('abc')` is `NaN`, and
    // `Date.now() + NaN` is `NaN` — a `leaseUntil` the wire could not carry,
    // silently stopping every node's sync with no boot complaint anywhere.
    const r = resolvePoolLeaseMs({ CCRC_POOL_LEASE_MS: 'abc' });
    expect(r.value).toBeGreaterThan(0);
    expect(r.warning).toContain('abc');
    expect(r.warning).toContain('CCRC_POOL_LEASE_MS');
  });

  it('zero and negative values are refused too — not merely non-numeric ones', () => {
    expect(resolvePoolLeaseMs({ CCRC_POOL_LEASE_MS: '0' }).warning).not.toBeNull();
    expect(resolvePoolLeaseMs({ CCRC_POOL_LEASE_MS: '-1000' }).warning).not.toBeNull();
  });
});

describe('refusePool guards a throwing coord.db (review round 1, Minor 9)', () => {
  let app2: FastifyInstance | undefined;
  afterEach(async () => { if (app2) await app2.close(); app2 = undefined; });

  it('a throwing accountPoolEdges() answers 503 pool-unreadable, never an uncaught 500', async () => {
    const home = mkTmp('ccrc-pool-refusepool-throw-');
    seedRoster(home, ROSTER);
    const cfg = loadConfig({ CCRC_HOME: home });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    coord.accountPoolEdges = () => { throw new Error('simulated DatabaseSync failure'); };
    app2 = await buildServer({
      cfg, runCcd: ccdRunner(failingRunner, cfg), tmux: new Tmux(failingRunner),
      io: localIO, queue: new KeyedQueue(), coord,
    } as Deps);
    await app2.ready();
    // `POST /api/sessions` is a `refusePool` caller for a NEW (non-revival)
    // session — the project has no pool tag written, so the ONLY thing that
    // can turn this into anything but a clean pass is the throwing read.
    const r = await app2.inject({
      method: 'POST', url: '/api/sessions', payload: { wrapper: 'acct-a', project: 'demo' },
    });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ ok: false, error: 'pool-unreadable', state: 'unreadable' });
  });
});

/**
 * Ruling T7-R3 (review round 2) — CLOSES THE FORECAST/REFUSAL DIVERGENCE.
 * The reviewer's exact repro: `acct-a` untagged in the ROSTER, centrally
 * tagged `pool-b`, project tagged `pool-a`. Before this ruling,
 * `GET /api/projects`'s forecast read only the DECLARED roster (via
 * `poolEligible(roster, pool)` with no `edges`) and would have offered
 * `acct-a` as placeable, while `POST /api/sessions`'s `refusePool` already
 * read the central edge and refused it — a project card offering a lane the
 * server then refuses, live the first time an operator uses both halves of
 * the feature. This is the assertion whose absence let that sit open.
 */
describe('T7-R3 — GET /api/projects\' forecast and POST /api/sessions\' refusal now AGREE', () => {
  let app3: FastifyInstance | undefined;
  let coord3: CoordStore | undefined;
  afterEach(async () => {
    if (app3) await app3.close();
    app3 = undefined;
    if (coord3) coord3.db.close();
    coord3 = undefined;
  });

  it('an account untagged in the roster but centrally tagged elsewhere is excluded from the forecast AND refused at placement', async () => {
    const home = mkTmp('ccrc-pool-t7r3-');
    seedRoster(home, ROSTER); // acct-a: homeAble, no `pool` key — declared UNTAGGED
    mkdirSync(path.join(home, 'projects', 'demo'), { recursive: true });
    mkdirSync(path.join(home, '.cc-sessions', POOLS_DIR_NAME), { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', POOLS_DIR_NAME, 'demo'), 'pool-a');
    const cfg = loadConfig({ CCRC_HOME: home });
    coord3 = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const poolEdgeLog = new PoolEdgeLog(path.join(home, '.ccrc', 'pool-edges.log'));
    // The CENTRAL edge the declared roster does not carry.
    coord3.setAccountPools({ accountId: 'acct-a', pools: ['pool-b'], addedBy: null }, poolEdgeLog);
    app3 = await buildServer({
      cfg, runCcd: ccdRunner(failingRunner, cfg), tmux: new Tmux(failingRunner),
      io: localIO, queue: new KeyedQueue(), coord: coord3, poolEdgeLog,
    } as Deps);
    await app3.ready();

    // 1. THE FORECAST: `demo` (pool-a) must NOT offer `acct-a` (centrally
    // pool-b) — before T7-R3 this answered `{ kind: 'projected', wrapper:
    // 'acct-a', ... }`, because the declared roster alone says untagged =
    // unconstrained. With `acct-a` the ONLY account, excluding it empties
    // the pool entirely.
    const projects = await app3.inject({ method: 'GET', url: '/api/projects' });
    expect(projects.statusCode).toBe(200);
    const demo = (projects.json().projects as { name: string; placement: { kind: string; pool?: string | null } }[])
      .find((p) => p.name === 'demo');
    expect(demo, 'the demo project was not listed — fixture setup is wrong, not the assertion').toBeDefined();
    expect(demo!.placement).toEqual({ kind: 'none', pool: 'pool-a' });

    // 2. THE REFUSAL: `POST /api/sessions` must still 409 the very placement
    // the forecast now (correctly) declines to offer.
    const session = await app3.inject({
      method: 'POST', url: '/api/sessions', payload: { wrapper: 'acct-a', project: 'demo' },
    });
    expect(session.statusCode).toBe(409);
    expect(session.json()).toMatchObject({
      ok: false, error: 'pool-mismatch', accountPool: 'pool-b', projectPool: 'pool-a',
    });
  });
});
