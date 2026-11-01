// Spec §14 row 8 (#1444, D-7670, R4; plan task LK2): the one rate service, every clause that needs no proxy route.
// The budgets are held against `LINEAR_QUOTA`; the lanes never borrow; a route takes its worst case and gives back the
// rest; Linear's own refusal (a 429, or `RATELIMITED` on a 200 or a 400) closes the slot until its wait and nothing
// reaches the fake until then; tokenless callers of the cookie routes spend only the request lane; an absent service
// calls Linear for nothing; and the composition root builds the one instance every caller receives. The tokenless
// and neighbour clauses that drive the proxy land with the proxy (LK9), the Settings clause with the Settings routes
// (LK11). Nothing here reaches the network: `fetch` is the injected seam, and the clock is the test's.
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerLinearRoutes } from '../src/linear/routes.js';
import { resolveTitle } from '../src/linear/resolve.js';
import { LEGACY_SLOT, type LinearSlotRef } from '../src/linear/store.js';
import { LINEAR_KEY_FILE } from '../src/linear/connection.js';
import type { FetchLike } from '../src/linear/client.js';
import {
  LINEAR_LANE_CALLS_PER_HOUR, LINEAR_QUOTA, LINEAR_RESTART_SHARE, LINEAR_SESSION_BUDGET, LINEAR_SLOT_CALLS_PER_HOUR,
  LinearRateService, type LinearRateAsk, type LinearRateTake,
} from '../src/linear/rate.js';
import type { AccountGate } from '../src/accounts/gate.js';
import { actorOf } from '../src/accounts/audit.js';
import { buildServer } from '../src/server.js';
import { WS_TITLE_CAP, WS_TITLE_VERB, WS_WRAPPER_CAP } from '../src/ccdargv.js';
import { testDeps } from './helpers.js';
import { RATELIMITED_ERRORS, linearAnswer, type LinearAnswer } from './linearFetchFake.js';
import { linearServicesFake } from './linearServicesFake.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', 'src');
const KEY = 'lin_api_ratefixture';
const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;
const SLOT_A: LinearSlotRef = { source: 'file', id: '00000000-0000-4000-8000-00000000000a' };
const SLOT_B: LinearSlotRef = { source: 'file', id: '00000000-0000-4000-8000-00000000000b' };

const issueOk = (title = 'Fix the login flow'): LinearAnswer =>
  linearAnswer({ ok: true, status: 200, json: async () => ({ data: { issue: { identifier: 'ENG-1234', title } } }) });
const viewerOk = (): LinearAnswer =>
  linearAnswer({ ok: true, status: 200, json: async () => ({ data: { viewer: { name: 'user-a' }, organization: { name: 'team-a' } } }) });

/** A service on a clock the test moves. */
const clocked = (): { rate: LinearRateService; clock: { now: number } } => {
  const clock = { now: T0 };
  return { rate: linearServicesFake({ clock: () => clock.now }).rate, clock };
};

/** Takes `ask` until the service refuses (or a bound no budget reaches), never settling: how many it granted, and the
 *  refusal that stopped it. */
const drain = (rate: LinearRateService, ask: LinearRateAsk, bound = 5_000): { n: number; stop: LinearRateTake } => {
  for (let n = 0; n < bound; n += 1) {
    const t = rate.take(ask);
    if (!t.ok) return { n, stop: t };
  }
  throw new Error(`drain: ${bound} grants and no refusal`);
};

describe('the budgets, held against LINEAR_QUOTA (spec §1.2a, §6.7)', () => {
  it("LINEAR_QUOTA is Linear's published quota for an API key", () => {
    expect(LINEAR_QUOTA).toEqual({ requestsPerHour: 2_500, complexityPerHour: 3_000_000, maxQueryComplexity: 10_000 });
  });

  it('a slot is 2,000 calls an hour, under the user\'s 2,500 with at least 500 left over', () => {
    expect(LINEAR_SLOT_CALLS_PER_HOUR).toBe(2_000);
    expect(LINEAR_QUOTA.requestsPerHour - LINEAR_SLOT_CALLS_PER_HOUR).toBeGreaterThanOrEqual(500);
  });

  it('the proxy lane, the request lane and the floor are 1,700, 100 and 200, and sum to the slot', () => {
    expect(LINEAR_LANE_CALLS_PER_HOUR).toEqual({ proxy: 1_700, request: 100, floor: 200 });
    const sum = Object.values(LINEAR_LANE_CALLS_PER_HOUR).reduce((a, b) => a + b, 0);
    expect(sum).toBe(LINEAR_SLOT_CALLS_PER_HOUR);
  });

  it('a session is 150 an hour, 20 a minute and 50 writes: under a tenth of the slot', () => {
    expect(LINEAR_SESSION_BUDGET).toEqual({ callsPerHour: 150, callsPerMinute: 20, writesPerHour: 50 });
    expect(LINEAR_SESSION_BUDGET.callsPerHour).toBeLessThan(LINEAR_SLOT_CALLS_PER_HOUR / 10);
  });

  it('after a restart each lane starts at a quarter: 425, 25 and 50, so 500 for the slot', () => {
    expect(LINEAR_RESTART_SHARE).toBe(0.25);
    const { rate } = clocked();
    const got = {
      proxy: drain(rate, { lane: 'proxy', slot: SLOT_A, calls: 1 }).n,
      request: drain(rate, { lane: 'request', slot: SLOT_A, calls: 1 }).n,
      floor: drain(rate, { lane: 'floor', slot: SLOT_A, calls: 1 }).n,
    };
    expect(got).toEqual({ proxy: 425, request: 25, floor: 50 });
    expect(got.proxy + got.request + got.floor).toBe(500);
  });
});

describe('the lanes (spec §6.7)', () => {
  it('no lane borrows from another: an empty request lane leaves the proxy lane and the floor whole', () => {
    const { rate } = clocked();
    const spent = drain(rate, { lane: 'request', slot: SLOT_A, calls: 1 });
    expect(spent.n).toBe(25);
    expect(spent.stop).toEqual({ ok: false, detail: 'workspace', retryAfterS: 36 });
    expect(drain(rate, { lane: 'proxy', slot: SLOT_A, calls: 1 }).n).toBe(425);
    expect(drain(rate, { lane: 'floor', slot: SLOT_A, calls: 1 }).n).toBe(50);
    // And the proxy lane, once empty, takes nothing from the request lane as it refills.
    expect(rate.take({ lane: 'request', slot: SLOT_A, calls: 1 }).ok).toBe(false);
  });

  it('each lane refills evenly, and never past its size: 1,700 an hour for the proxy lane', () => {
    const { rate, clock } = clocked();
    drain(rate, { lane: 'request', slot: SLOT_A, calls: 1 });
    clock.now += 36_000;   // 100 an hour is one call every 36 seconds
    expect(drain(rate, { lane: 'request', slot: SLOT_A, calls: 1 }).n).toBe(1);
    clock.now += 2 * HOUR;
    expect(drain(rate, { lane: 'request', slot: SLOT_A, calls: 1 }).n).toBe(100);
    expect(drain(rate, { lane: 'proxy', slot: SLOT_A, calls: 1 }).n).toBe(1_700);
    expect(drain(rate, { lane: 'floor', slot: SLOT_A, calls: 1 }).n).toBe(200);
  });

  it('each slot has its own buckets, the legacy slot under its own fixed key', () => {
    const { rate } = clocked();
    drain(rate, { lane: 'request', slot: SLOT_A, calls: 1 });
    expect(drain(rate, { lane: 'request', slot: SLOT_B, calls: 1 }).n).toBe(25);
    expect(drain(rate, { lane: 'request', slot: LEGACY_SLOT, calls: 1 }).n).toBe(25);
  });

  it('a route takes its worst case before its first call and gives back what it did not spend', () => {
    const { rate } = clocked();
    const t = rate.take({ lane: 'request', slot: SLOT_A, calls: 2 });
    if (!t.ok) throw new Error('refused');
    rate.settle(t.grant, { spent: 1, closeForS: null });
    expect(drain(rate, { lane: 'request', slot: SLOT_A, calls: 1 }).n).toBe(24);
  });

  it('a grant is settled once: a second settle gives nothing back', () => {
    const { rate } = clocked();
    const t = rate.take({ lane: 'request', slot: SLOT_A, calls: 2 });
    if (!t.ok) throw new Error('refused');
    rate.settle(t.grant, { spent: 0, closeForS: null });
    rate.settle(t.grant, { spent: 0, closeForS: null });
    expect(drain(rate, { lane: 'request', slot: SLOT_A, calls: 1 }).n).toBe(25);
  });

  it('a worst case larger than what is left is refused whole, and takes nothing', () => {
    const { rate } = clocked();
    for (let i = 0; i < 24; i += 1) rate.take({ lane: 'request', slot: SLOT_A, calls: 1 });
    expect(rate.take({ lane: 'request', slot: SLOT_A, calls: 2 })).toMatchObject({ ok: false, detail: 'workspace' });
    expect(drain(rate, { lane: 'request', slot: SLOT_A, calls: 1 }).n).toBe(1);
  });
});

describe('the per-session bucket (spec §6.7: fairness, not a wall)', () => {
  const proxyAs = (id: string, write = false): LinearRateAsk => ({ lane: 'proxy', slot: SLOT_A, calls: 1, session: { id, write } });

  it('twenty in a minute, then rate-limited session; another session is not charged for it', () => {
    const { rate } = clocked();
    const a = drain(rate, proxyAs('session-a'));
    expect(a.n).toBe(20);
    expect(a.stop).toMatchObject({ ok: false, detail: 'session' });
    expect(drain(rate, proxyAs('session-b')).n).toBe(20);
  });

  it('150 an hour: at a pace the minute bucket never limits, the hour stops it', () => {
    const { rate, clock } = clocked();
    let n = 0;
    let stop: LinearRateTake | null = null;
    while (stop === null && n < 1_000) {
      const t = rate.take(proxyAs('session-a'));
      if (t.ok) n += 1; else stop = t;
      clock.now += 3_000;   // one call every three seconds: the minute's twenty refill as fast as they are spent
    }
    expect(stop).toMatchObject({ ok: false, detail: 'session' });
    const elapsedS = (clock.now - T0) / 1000;
    // A full bucket of 150, plus what refilled while it was spent (150 an hour, one every 24 s), and no more.
    expect(n).toBeGreaterThanOrEqual(150);
    expect(n).toBeLessThanOrEqual(150 + Math.ceil(elapsedS / 24));
  });

  it('50 writes an hour, counted apart from the calls', () => {
    const { rate, clock } = clocked();
    let n = 0;
    let stop: LinearRateTake | null = null;
    while (stop === null && n < 1_000) {
      const t = rate.take(proxyAs('session-a', true));
      if (t.ok) n += 1; else stop = t;
      clock.now += 3_000;
    }
    expect(stop).toMatchObject({ ok: false, detail: 'session' });
    expect(n).toBeGreaterThanOrEqual(50);
    expect(n).toBeLessThanOrEqual(50 + Math.ceil((clock.now - T0) / 1000 / 72));
    // Reads by the same session still run.
    expect(rate.take(proxyAs('session-a')).ok).toBe(true);
  });

  it('ids of thirty neighbours give at most the slot\'s proxy lane, and never the request lane or the floor', () => {
    const { rate } = clocked();
    let n = 0;
    for (let s = 0; s < 30; s += 1) n += drain(rate, proxyAs(`neighbour-${s}`)).n;
    expect(n).toBe(425);
    expect(drain(rate, { lane: 'request', slot: SLOT_A, calls: 1 }).n).toBe(25);
    expect(drain(rate, { lane: 'floor', slot: SLOT_A, calls: 1 }).n).toBe(50);
  });
});

// ── THE ROUTES: the preview read, the legacy Check again and Connect, through one service ──

interface Rig {
  app: FastifyInstance;
  dir: string;
  rate: LinearRateService;
  clock: { now: number };
  calls: { n: number };
  answer: (a: LinearAnswer) => void;
}

const refusingGate: AccountGate = (_req, reply) => { void reply.code(403).send({ ok: false, error: 'auth-off' }); return { pass: false }; };
const passingGate: AccountGate = () => ({ pass: true, actor: actorOf('a test phone', '') });

let open: FastifyInstance | null = null;
afterEach(async () => { await open?.close(); open = null; });

async function rig(o: { rate?: 'absent'; gate?: AccountGate; key?: boolean } = {}): Promise<Rig> {
  const dir = mkTmp('ccrc-linear-rate-');
  if (o.key !== false) writeFileSync(path.join(dir, LINEAR_KEY_FILE), `${KEY}\n`, { mode: 0o600 });
  const { rate, clock } = clocked();
  const calls = { n: 0 };
  let next: LinearAnswer = issueOk();
  const f: FetchLike = async () => { calls.n += 1; return next; };
  const app = Fastify({ logger: false });
  registerLinearRoutes(app, {
    ccrcDir: dir, gate: o.gate ?? refusingGate, rate: o.rate === 'absent' ? null : rate, fetch: f, now: () => clock.now,
  });
  await app.ready();
  open = app;
  return { app, dir, rate, clock, calls, answer: (a) => { next = a; } };
}
const resolve = (r: Rig): Promise<LightMyRequestResponse> => r.app.inject({ method: 'GET', url: '/api/linear/resolve?ref=ENG-1234' });
const check = (r: Rig): Promise<LightMyRequestResponse> => r.app.inject({ method: 'POST', url: '/api/linear/connection/check' });
const connect = (r: Rig): Promise<LightMyRequestResponse> =>
  r.app.inject({ method: 'PUT', url: '/api/linear/connection', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ key: KEY }) });
const body = (res: { body: string }): Record<string, unknown> => JSON.parse(res.body) as Record<string, unknown>;

describe("Linear's own refusal closes the slot until its wait (spec §6.7)", () => {
  const limited = (wait: string | null): LinearAnswer[] => {
    const headers: Record<string, string> = wait === null ? {} : { 'retry-after': wait };
    return [
      linearAnswer({ ok: false, status: 429, headers, json: async () => ({}) }),
      linearAnswer({ ok: true, status: 200, headers, json: async () => ({ data: { issue: null }, ...RATELIMITED_ERRORS }) }),
      linearAnswer({ ok: false, status: 400, headers, json: async () => RATELIMITED_ERRORS }),
    ];
  };

  it('a 429, and RATELIMITED on a 200 and a 400: closed until Retry-After, and no call reaches the fake until then', async () => {
    for (const refusal of limited('120')) {
      const r = await rig();
      r.answer(refusal);
      expect(body(await resolve(r))).toMatchObject({ source: 'offline', reason: 'rate-limited' });
      expect(r.calls.n).toBe(1);
      r.answer(issueOk());
      // A title lookup and a Check again, ccrc's own calls, are refused locally while it is closed.
      expect(body(await resolve(r))).toMatchObject({ source: 'offline', reason: 'rate-limited' });
      const refused = await check(r);
      expect(refused.statusCode).toBe(429);
      expect(refused.headers['retry-after']).toBe('120');
      expect(body(refused)).toEqual({ ok: false, error: 'rate-limited', detail: 'linear', retryAfterS: 120 });
      // The floor of the same slot is closed too.
      expect(r.rate.take({ lane: 'floor', slot: LEGACY_SLOT, calls: 1 })).toMatchObject({ ok: false, detail: 'linear' });
      r.clock.now += 119_000;
      expect(body(await check(r))).toMatchObject({ error: 'rate-limited', detail: 'linear', retryAfterS: 1 });
      expect(r.calls.n).toBe(1);
      r.clock.now += 1_000;
      expect(body(await resolve(r))).toMatchObject({ source: 'linear', title: 'ENG-1234 - Fix the login flow' });
      expect(r.calls.n).toBe(2);
      await r.app.close();
      open = null;
    }
  });

  it('with no Retry-After it is closed for sixty seconds (the reset header is not read until its unit is recorded)', async () => {
    const r = await rig();
    r.answer(linearAnswer({ ok: false, status: 429, headers: { 'x-ratelimit-requests-reset': String(T0 + HOUR) }, json: async () => ({}) }));
    await resolve(r);
    r.answer(issueOk());
    r.clock.now += 59_000;
    expect(body(await resolve(r))).toMatchObject({ reason: 'rate-limited' });
    expect(r.calls.n).toBe(1);
    r.clock.now += 1_000;
    expect(body(await resolve(r))).toMatchObject({ source: 'linear' });
    expect(r.calls.n).toBe(2);
  });

  it('a Retry-After of 99,999 seconds is held to 3,600', async () => {
    const r = await rig();
    r.answer(limited('99999')[0]!);
    await resolve(r);
    r.answer(issueOk());
    r.clock.now += 3_599_000;
    expect(body(await resolve(r))).toMatchObject({ reason: 'rate-limited' });
    r.clock.now += 1_000;
    expect(body(await resolve(r))).toMatchObject({ source: 'linear' });
    expect(r.calls.n).toBe(2);
  });

  it("a Check again that Linear refuses closes the slot for the title lookups too", async () => {
    const r = await rig();
    r.answer(limited('30')[1]!);
    expect((await check(r)).statusCode).toBe(200);   // the view, stored as unreachable (row 13)
    r.answer(issueOk());
    expect(body(await resolve(r))).toMatchObject({ reason: 'rate-limited' });
    expect(r.calls.n).toBe(1);
  });

  it('a closed slot closes no other slot', () => {
    const { rate } = clocked();
    const t = rate.take({ lane: 'request', slot: SLOT_A, calls: 1 });
    if (!t.ok) throw new Error('refused');
    rate.settle(t.grant, { spent: 1, closeForS: 300 });
    expect(rate.take({ lane: 'proxy', slot: SLOT_A, calls: 1 })).toEqual({ ok: false, detail: 'linear', retryAfterS: 300 });
    expect(rate.take({ lane: 'proxy', slot: SLOT_B, calls: 1 }).ok).toBe(true);
    expect(rate.take({ lane: 'proxy', slot: LEGACY_SLOT, calls: 1 }).ok).toBe(true);
  });
});

describe('tokenless callers of the cookie routes spend only the request lane (spec §6.7, §6.9)', () => {
  it('150 previews, then 10 Check agains: past the lane the title is offline and the check is rate-limited workspace', async () => {
    // `registerLinearRoutes` alone: no sign-in gate and no cookie, as on a box whose gate is unarmed.
    const r = await rig();
    const sources: string[] = [];
    for (let i = 0; i < 150; i += 1) sources.push(String(body(await resolve(r))['source']));
    expect(sources.filter((s) => s === 'linear')).toHaveLength(25);
    expect(sources.slice(25).every((s) => s === 'offline')).toBe(true);
    expect(body(await resolve(r))).toMatchObject({ source: 'offline', reason: 'rate-limited' });
    r.answer(viewerOk());
    for (let i = 0; i < 10; i += 1) {
      const res = await check(r);
      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBe('36');
      expect(body(res)).toEqual({ ok: false, error: 'rate-limited', detail: 'workspace', retryAfterS: 36 });
    }
    expect(r.calls.n).toBe(25);
    // A background refresh's floor and the proxy's lane are untouched.
    expect(drain(r.rate, { lane: 'floor', slot: LEGACY_SLOT, calls: 1 }).n).toBe(50);
    expect(drain(r.rate, { lane: 'proxy', slot: LEGACY_SLOT, calls: 1 }).n).toBe(425);
  });

  it('twenty sessions spending the proxy lane leave a title lookup and a Check again running', async () => {
    const r = await rig();
    for (let s = 0; s < 20; s += 1) drain(r.rate, { lane: 'proxy', slot: LEGACY_SLOT, calls: 1, session: { id: `session-${s}`, write: false } });
    expect(r.rate.take({ lane: 'proxy', slot: LEGACY_SLOT, calls: 1 }).ok).toBe(true);   // 400 of 425 spent
    expect(body(await resolve(r))).toMatchObject({ source: 'linear' });
    r.answer(viewerOk());
    expect((await check(r)).statusCode).toBe(200);
    expect(r.calls.n).toBe(2);
  });

  it('the legacy Connect, account-gated, is charged to the floor and never to the request lane', async () => {
    const r = await rig({ gate: passingGate });
    drain(r.rate, { lane: 'request', slot: LEGACY_SLOT, calls: 1 });
    r.answer(viewerOk());
    expect((await connect(r)).statusCode).toBe(200);
    expect(r.calls.n).toBe(1);
    expect(drain(r.rate, { lane: 'floor', slot: LEGACY_SLOT, calls: 1 }).n).toBe(49);
    const refused = await connect(r);
    expect(body(refused)).toEqual({ ok: false, error: 'rate-limited', detail: 'workspace', retryAfterS: 18 });
    expect(r.calls.n).toBe(1);
  });
});

describe('an absent rate service calls Linear for nothing (D-7684)', () => {
  it('the preview is the offline title, Check again and Connect answer linear-unavailable, and the fake sees no call', async () => {
    const r = await rig({ rate: 'absent', gate: passingGate });
    expect(body(await resolve(r))).toEqual({ kind: 'named', slug: 'eng-1234', title: 'ENG-1234', source: 'offline', reason: 'rate-limited' });
    const c = await check(r);
    expect(c.statusCode).toBe(503);
    expect(body(c)).toEqual({ ok: false, error: 'linear-unavailable' });
    const before = readdirSync(r.dir).sort();
    const p = await connect(r);
    expect(p.statusCode).toBe(503);
    expect(body(p)).toEqual({ ok: false, error: 'linear-unavailable' });
    expect(readdirSync(r.dir).sort()).toEqual(before);
    // The two routes that never call Linear are unchanged.
    expect((await r.app.inject({ method: 'GET', url: '/api/linear/connection' })).statusCode).toBe(200);
    expect(r.calls.n).toBe(0);
  });

  it('resolveTitle with no service answers the offline title and makes no call', async () => {
    const dir = mkTmp('ccrc-linear-rate-');
    writeFileSync(path.join(dir, LINEAR_KEY_FILE), `${KEY}\n`, { mode: 0o600 });
    let n = 0;
    const f: FetchLike = async () => { n += 1; return issueOk(); };
    expect(await resolveTitle('ENG-1234', { key: 'ENG', num: '1234', titleSlug: null }, { ccrcDir: dir, rate: null, fetch: f }))
      .toEqual({ title: 'ENG-1234', source: 'offline', reason: 'rate-limited' });
    expect(n).toBe(0);
  });

  it('a box with no key asks the service nothing: not-configured, and the request lane is whole', async () => {
    const r = await rig({ key: false });
    expect(body(await resolve(r))).toMatchObject({ source: 'offline', reason: 'not-configured' });
    expect(drain(r.rate, { lane: 'request', slot: LEGACY_SLOT, calls: 1 }).n).toBe(25);
  });
});

describe('one instance (spec §6.7: "nothing else holds a bucket")', () => {
  const src = (rel: string): string => readFileSync(path.join(SRC, rel), 'utf8');
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []);

  it('the service is constructed once, in index.ts, and handed to Deps there', () => {
    const builders = walk(SRC).filter((f) => /\bnew LinearRateService\(/.test(readFileSync(f, 'utf8')));
    expect(builders.map((f) => path.relative(SRC, f))).toEqual(['index.ts']);
    expect(src('index.ts').match(/\bnew LinearRateService\(/g)).toHaveLength(1);
    expect(src('index.ts')).toMatch(/\bdeps\.linearRate\s*=\s*linearRate;/);
  });

  it('server.ts passes it through, possibly absent, to the legacy routes and both direct title calls, and builds none', () => {
    const text = src('server.ts');
    expect(text).not.toMatch(/\bLinearRateService\b/);
    expect(text.match(/\brate: deps\.linearRate \?\? null\b/g)).toHaveLength(3);
    expect(text).toMatch(/registerLinearRoutes\(app, \{[^}]*\brate: deps\.linearRate \?\? null\b/);
    expect(text.match(/resolveTitle\([^;]*?\{[^}]*\brate: deps\.linearRate \?\? null\b/g)).toHaveLength(2);
  });

  it('the preview passes the route\'s own service to resolveName, and resolve.ts builds none', () => {
    expect(src('linear/routes.ts')).toMatch(/resolveName\(ref, \{[^}]*\brate: opts\.rate\b/);
    expect(src('linear/resolve.ts')).not.toMatch(/\bnew LinearRateService\b/);
  });

  it('through buildServer, the preview, the create and the rename all spend the one service handed in Deps', async () => {
    const ID = 'project-a-quiet-basin';
    const deps = testDeps(undefined, async () => ({ ran: true, code: 0, stdout: '', stderr: '' }));
    mkdirSync(deps.cfg.ccrcDir, { recursive: true });
    writeFileSync(path.join(deps.cfg.ccrcDir, LINEAR_KEY_FILE), `${KEY}\n`, { mode: 0o600 });
    mkdirSync(deps.cfg.registryDir, { recursive: true });
    writeFileSync(path.join(deps.cfg.registryDir, `${ID}.uuid`), 'a'.repeat(36));
    const { rate } = clocked();
    let n = 0;
    const app = await buildServer({
      ...deps,
      fleetState: { connected: true, downSince: null, ccdVerbs: ['ws-add', WS_TITLE_CAP, WS_WRAPPER_CAP, WS_TITLE_VERB], rosterFp: null, build: null },
      linear: { fetch: async () => { n += 1; return issueOk(); } },
      linearRate: rate,
    });
    open = app;
    // Spend the request lane on the very instance handed in: every one of the three must now be refused locally.
    drain(rate, { lane: 'request', slot: LEGACY_SLOT, calls: 1 });
    const preview = await app.inject({ method: 'GET', url: '/api/linear/resolve?ref=ENG-1234' });
    expect(body(preview)).toMatchObject({ source: 'offline', reason: 'rate-limited' });
    const create = await app.inject({ method: 'POST', url: '/api/projects/project-a/workspaces', payload: { name: 'ENG-1234' } });
    expect(body(create)).toMatchObject({ ok: true, title: 'ENG-1234' });
    const rename = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/title`, payload: { title: 'ENG-1234' } });
    expect(body(rename)).toMatchObject({ ok: true, title: 'ENG-1234' });
    expect(n).toBe(0);
  });
});
