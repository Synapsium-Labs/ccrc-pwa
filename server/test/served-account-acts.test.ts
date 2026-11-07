// Console speed S2, fix round 1 (F1, ruling 15676 pt 1): an operator's own act is never undone by a served read. After an
// account act (enable, Check, and every other route under `/api/accounts/`), the next `GET /api/accounts` reads the limits
// for itself until a watcher tick that BEGAN after the act lands; only then is the watcher's tick served again. The act
// here is a fake `AccountOps` that moves the box's markers the way the real verbs do (`enable` removes
// `<id>-disabled`, `check` clears `<id>-authdead`), so the answer's `disabled` and `authDead` are read off the files.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { FastifyInstance } from 'fastify';
import type { AccountsResponse } from '../../shared/api.js';
import { buildServer, type Deps } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { localIO, type FleetIO } from '../src/io.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import type { AccountOps, AccountOpResult } from '../src/accounts/ops.js';
import type { FleetState } from '../src/fleetstate.js';
import type { PtyLike } from '../src/pty.js';
import { operatorActRoute, takenAfter } from '../src/servedRead.js';
import type { CcdResult } from '../src/coord/ports.js';
import { testDeps, withFakeClock } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
const LANE = 'claude-a';
const stubPty = (): PtyLike => ({ onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {} });

let app: FastifyInstance | null = null;
/** While set, the fake account op waits on it: an act held in flight. */
let held: Promise<void> | null = null;
let watcher: FleetWatcher | null = null;
afterEach(async () => { held = null; await app?.close(); app = null; watcher?.stop(); watcher = null; });

interface Rig {
  home: string; reg: string; acts: string[]; requests: string[]; w: FleetWatcher; cookie: string;
  accounts: () => Promise<AccountsResponse>;
  post: (sub: string) => Promise<number>;
}

/** The server over a fixture HOME whose lane is off and measured dead, with a watcher that has ticked ONCE, before
 *  any act. Every io call is logged, so a read the route makes for itself is the thing measured. */
async function rig(): Promise<Rig> {
  const home = mkTmp('ccrc-served-acts-');
  const base = testDeps(home);
  const reg = base.cfg.registryDir;
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const limits = path.join(home, '.cc-limits');
  mkdirSync(limits, { recursive: true });
  const t = Math.floor(Date.now() / 1000);
  writeFileSync(path.join(limits, `${LANE}.json`), JSON.stringify({ five: 12, seven: 34, ts: t - 30, fiveResetAt: t + 3600, sevenResetAt: t + 200000 }));
  mkdirSync(reg, { recursive: true });
  mkdirSync(path.join(home, 'projects', 'project-a', '.git'), { recursive: true });
  writeFileSync(path.join(reg, `${LANE}-disabled`), '');
  writeFileSync(path.join(reg, `${LANE}-authdead`), `${t - 60} 401\n`);
  const acts: string[] = [];
  const ops: AccountOps = {
    arm: 'local',
    run: async (sub, id): Promise<AccountOpResult> => {
      acts.push(`${sub} ${id}`);
      if (held) await held;
      if (sub === 'enable') rmSync(path.join(reg, `${id}-disabled`), { force: true });
      if (sub === 'check') {
        rmSync(path.join(reg, `${id}-authdead`), { force: true });
        const measuredAt = '2026-11-06T12:00:00Z';
        mkdirSync(path.join(reg, '.accounts'), { recursive: true });
        writeFileSync(path.join(reg, '.accounts', `${id}.json`), JSON.stringify({ check: { verdict: 'ok', at: measuredAt } }));
        return { kind: 'exited', code: 0, stdout: JSON.stringify({ ok: true, health: { verdict: 'ok', measuredAt } }) };
      }
      return { kind: 'exited', code: 0, stdout: '{}' };
    },
  };
  const requests: string[] = [];
  const io = { ...localIO } as Record<string, unknown>;
  for (const [op, fn] of Object.entries(localIO)) {
    if (typeof fn !== 'function') continue;
    io[op] = (...args: unknown[]) => { requests.push(`${op} ${String(args[0])}`); return (fn as (...a: unknown[]) => unknown).apply(localIO, args); };
  }
  const deps: Deps = withFakeClock({
    ...base, io: io as unknown as FleetIO,
    cfg: { ...base.cfg, authEnabled: true, cookieSecure: false, rpId: 'localhost', origin: 'http://localhost:7788' },
    spawnPty: stubPty,
    fleetState: { ccdVerbs: ['account-v2', 'project-pool'] } as unknown as FleetState,
    accountOps: ops,
    // The project-pool write's ccd verb, faked: it writes the pool marker the way `ccd project-pool` does.
    runCcd: async (argv) => {
      const at = argv.indexOf('--project');
      const pool = argv.indexOf('--pool');
      if (argv[0] === 'project-pool' && at >= 0 && pool >= 0) {
        mkdirSync(path.join(reg, 'pools'), { recursive: true });
        writeFileSync(path.join(reg, 'pools', argv[at + 1]!), `${argv[pool + 1]}\n`);
        acts.push(`project-pool ${argv[at + 1]} ${argv[pool + 1]}`);
      }
      return { ran: true, ok: true, code: 0, stdout: '', stderr: '' } as unknown as CcdResult;
    },
  });
  const bus = new Bus();
  const w = new FleetWatcher(deps, bus, 2000);
  watcher = w;
  await w.tick();
  const a = await buildServer(deps, bus, w);
  await a.ready();
  app = a;
  const login = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
  expect(login.statusCode, login.body).toBe(204);
  const set = login.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  const cookie = line.slice(0, line.indexOf(';'));
  return {
    home, reg, acts, requests, w, cookie,
    accounts: async () => {
      const res = await a.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } });
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as AccountsResponse;
    },
    post: async (sub) => (await a.inject({ method: 'POST', url: `/api/accounts/${LANE}/${sub}`, headers: { cookie } })).statusCode,
  };
}

const lane = (body: AccountsResponse): { disabled: boolean; authDead: boolean } => {
  const row = body.accounts.find((x) => x.wrapper === LANE);
  if (row === undefined) throw new Error(`no ${LANE} row`);
  return { disabled: row.disabled, authDead: row.authDead };
};
/** What `readLimits` reads: the telemetry directory, a plain listing of the registry and the auth-dead marker. (A session
 *  reader's answer also reads the lane-state files, `readLaneStates`, on every request, served or not.) */
const limitReads = (requests: string[]): string[] => requests.filter((q) => /\.cc-limits|-authdead/.test(q) || /^readdir \S*\.cc-sessions$/.test(q));
/** A wait long enough for `Date.now()` to move past the act's stamp, so a tick after it is strictly later. */
const nextMs = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

describe('an account act is never undone by a served GET /api/accounts (console speed S2, F1)', () => {
  it('control: with no act, the watcher\'s tick is served and the route reads nothing', async () => {
    const r = await rig();
    await r.accounts();
    r.requests.length = 0;
    const body = await r.accounts();
    expect(typeof body.ageMs).toBe('number');
    expect(lane(body)).toEqual({ disabled: true, authDead: true });
    expect(limitReads(r.requests)).toEqual([]);
  });

  it('enable: the next GET reads for itself and says the lane is on; a tick after the act is served again', async () => {
    const r = await rig();
    expect(lane(await r.accounts()), 'the tick saw the lane off').toMatchObject({ disabled: true });
    expect(await r.post('enable')).toBe(200);
    expect(r.acts).toEqual([`enable ${LANE}`]);
    expect(existsSync(path.join(r.reg, `${LANE}-disabled`))).toBe(false);
    r.requests.length = 0;
    const after = await r.accounts();
    expect('ageMs' in after, 'not served from the tick taken before the act').toBe(false);
    expect(lane(after).disabled).toBe(false);
    expect(limitReads(r.requests).length, 'the route read the limits and markers itself').toBeGreaterThan(0);
    await nextMs();
    await r.w.tick();
    r.requests.length = 0;
    const later = await r.accounts();
    expect(typeof later.ageMs, 'a tick that began after the act is served').toBe('number');
    expect(lane(later).disabled).toBe(false);
    expect(limitReads(r.requests)).toEqual([]);
  });

  it('Check: the next GET reads for itself and no longer says the lane is dead', async () => {
    const r = await rig();
    expect(lane(await r.accounts()), 'the tick saw the lane dead').toMatchObject({ authDead: true });
    expect(await r.post('check')).toBe(200);
    r.requests.length = 0;
    const after = await r.accounts();
    expect('ageMs' in after).toBe(false);
    expect(lane(after).authDead).toBe(false);
    expect(limitReads(r.requests).length).toBeGreaterThan(0);
  });

  it('a GET while an act is still in flight is not served either', async () => {
    const r = await rig();
    expect(typeof (await r.accounts()).ageMs, 'control: served before the act').toBe('number');
    let release: () => void = () => undefined;
    held = new Promise<void>((res) => { release = res; });
    const act = r.post('enable');                                   // the act starts and waits in its op
    await new Promise((res) => setTimeout(res, 20));
    expect(r.acts).toEqual([`enable ${LANE}`]);
    expect('ageMs' in (await r.accounts()), 'an act in flight counts as ending now').toBe(false);
    held = null; release();
    expect(await act).toBe(200);
  });

  it('an act the client aborts stays in flight until its handler settles; a tick in the gap is not served (fix round 2, F1)', async () => {
    const r = await rig();
    expect(lane(await r.accounts()), 'control: served, the lane off').toMatchObject({ disabled: true });
    await app!.listen({ host: '127.0.0.1', port: 0 });
    const addr = app!.server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
    let release: () => void = () => undefined;
    held = new Promise<void>((res) => { release = res; });
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: `/api/accounts/${LANE}/enable`, headers: { cookie: r.cookie } });
    req.on('error', () => undefined);
    req.end();
    await vi.waitFor(() => expect(r.acts).toEqual([`enable ${LANE}`]));   // the handler waits in its op
    req.destroy();                                                        // the phone drops the connection
    await new Promise((res) => setTimeout(res, 50));                      // the server sees the close
    await nextMs();
    await r.w.tick();                                                     // a tick in the gap: the marker not yet written
    expect('ageMs' in (await r.accounts()), 'an aborted act whose handler still runs is in flight').toBe(false);
    held = null; release();                                               // the box writes, the handler settles
    await vi.waitFor(() => expect(existsSync(path.join(r.reg, `${LANE}-disabled`))).toBe(false));
    await new Promise((res) => setTimeout(res, 50));
    const after = await r.accounts();
    expect('ageMs' in after, 'the gap tick began before the act ended').toBe(false);
    expect(lane(after).disabled).toBe(false);
  });

  it('GET /api/projects, which places on the same limits, is not served from before the act either', async () => {
    const r = await rig();
    const get = async (): Promise<Record<string, unknown>> =>
      (await app!.inject({ method: 'GET', url: '/api/projects', headers: { cookie: r.cookie } })).json() as Record<string, unknown>;
    expect(typeof (await get()).ageMs, 'control: served before the act').toBe('number');
    expect(await r.post('enable')).toBe(200);
    expect('ageMs' in (await get())).toBe(false);
  });

  it('a project-pool write: the next GET /api/projects and /api/fleet read for themselves (fix round 2, F2)', async () => {
    const r = await rig();
    const get = async (url: string): Promise<Record<string, unknown>> =>
      (await app!.inject({ method: 'GET', url, headers: { cookie: r.cookie } })).json() as Record<string, unknown>;
    const projects = await get('/api/projects');
    expect(typeof projects.ageMs, 'control: served before the write').toBe('number');
    expect((projects.projects as { name: string; pool: unknown }[]).find((p) => p.name === 'project-a')?.pool).toEqual({ state: 'untagged' });
    expect(typeof (await get('/api/fleet')).ageMs, 'control: /api/fleet served before the write').toBe('number');
    const res = await app!.inject({ method: 'POST', url: '/api/projects/project-a/pool', headers: { cookie: r.cookie }, payload: { pool: 'pool-a' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(r.acts).toEqual(['project-pool project-a pool-a']);
    const after = await get('/api/projects');
    expect('ageMs' in after, 'the pools half is not served from before the write').toBe(false);
    expect((after.projects as { name: string; pool: unknown }[]).find((p) => p.name === 'project-a')?.pool).toEqual({ state: 'tagged', name: 'pool-a' });
    expect('ageMs' in (await get('/api/fleet')), '/api/fleet\'s pools are not served from before the write').toBe(false);
  });

  it('a refused act also stops the served read until the next tick (the box may have acted)', async () => {
    const r = await rig();
    await r.accounts();
    const res = await app!.inject({ method: 'POST', url: '/api/accounts/a%20b/check', headers: { cookie: r.cookie } });
    expect(res.statusCode).not.toBe(200);
    r.requests.length = 0;
    expect('ageMs' in (await r.accounts())).toBe(false);
  });
});

describe('the act deciders (console speed S2, F1)', () => {
  it('operatorActRoute: every route under /api/accounts/, every write to /api/accounts, and the project-pool write', () => {
    expect(operatorActRoute('GET', '/api/accounts')).toBe(false);
    expect(operatorActRoute('HEAD', '/api/accounts')).toBe(false);
    expect(operatorActRoute('POST', '/api/accounts')).toBe(true);
    for (const sub of ['check', 'enable', 'disable', 'credential', 'set', 'remove', 'auth/start', 'auth/code', 'auth/cancel']) {
      expect(operatorActRoute('POST', `/api/accounts/:id/${sub}`), sub).toBe(true);
    }
    expect(operatorActRoute('POST', '/api/accounts/revoke-ack')).toBe(true);
    expect(operatorActRoute('GET', '/api/accounts/:id/auth'), 'the sign-in status read observes its end').toBe(true);
    expect(operatorActRoute('GET', '/api/fleet')).toBe(false);
    expect(operatorActRoute('POST', '/api/accountsx')).toBe(false);
    expect(operatorActRoute('GET', undefined)).toBe(false);
    expect(operatorActRoute('POST', '/api/projects/:project/pool')).toBe(true);
    expect(operatorActRoute('GET', '/api/projects')).toBe(false);
    expect(operatorActRoute('POST', '/api/projects'), 'no other project route in this round').toBe(false);
  });

  it('takenAfter: a measurement whose tick began at or before the last act is not handed over', () => {
    const m = { listedAt: 1_000 };
    expect(takenAfter(m, null)).toBe(m);
    expect(takenAfter(m, 999)).toBe(m);
    expect(takenAfter(m, 1_000)).toBeNull();
    expect(takenAfter(m, 1_001)).toBeNull();
    expect(takenAfter(null, 5)).toBeNull();
  });
});
