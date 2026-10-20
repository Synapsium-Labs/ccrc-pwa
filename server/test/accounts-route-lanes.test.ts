// `GET /api/accounts` gains `lanes` and `connect` for the session verdict only (D-5511, D-5517; spec §3.4, §13.1;
// accounts plan Task A12). Each lane's state is read from `~/.cc-sessions/.accounts/<id>.json` in the `readLimits`
// pass, every field held to its grammar and masked (D-5755 (11)), the file opened with `O_NOFOLLOW` and taken only
// when it is a regular file (D-5755 (13d)). A box-token reader, and anyone while the gate is dark, gets today's
// three fields byte for byte.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { SECRET_MASK, type AccountsResponse } from '../../shared/api.js';
import { buildServer, type Deps } from '../src/server.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import type { PtyLike } from '../src/pty.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
const BOX_TOKEN = 'box-token-for-the-accounts-lanes-suite';
const IDENTITY = 'someone@example.invalid';
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const stubPty = (): PtyLike => ({ onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {} });

let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

/** A home with lane-state files: `claude-a` read, `claude-b` absent, `claude-d` a symlink, `gpt` a FIFO. */
function seedLanes(home: string): void {
  const dir = path.join(home, '.cc-sessions', '.accounts');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const now = Date.now();
  writeFileSync(path.join(dir, 'claude-a.json'), JSON.stringify({
    check: { verdict: 'ok', at: iso(now - 4 * 60_000) }, identity: IDENTITY, identitySource: 'stated',
    mintedAt: iso(now - 30 * 86_400_000), keyHash: 'kh-never-on-the-wire', retiredKeyHash: 'rkh-never-on-the-wire',
    fleetIdentity: '11111111-2222-4333-8444-555555555555', planted: 'a field the spec does not name',
  }), { mode: 0o600 });
  const target = path.join(home, '.cc-sessions', 'claude-d.target');
  writeFileSync(target, JSON.stringify({ check: { verdict: 'ok', at: iso(now) }, identity: 'the-target-identity' }));
  symlinkSync(target, path.join(dir, 'claude-d.json'));
  execFileSync('mkfifo', [path.join(dir, 'gpt.json')]);
}

async function openApp(o: { enabled: boolean; origin?: string; lanes?: boolean }): Promise<{ app: FastifyInstance; home: string }> {
  const home = mkTmp('ccrc-accounts-lanes-');
  const base = testDeps(home);
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  if (o.lanes !== false) seedLanes(home);
  const deps: Deps = {
    ...base,
    cfg: { ...base.cfg, authEnabled: o.enabled, cookieSecure: false, rpId: 'localhost', origin: o.origin ?? 'http://localhost:7788' },
    mailToken: BOX_TOKEN,
    spawnPty: stubPty,
  };
  const a = await buildServer(deps);
  await a.ready();
  return { app: a, home };
}

const login = async (a: FastifyInstance): Promise<string> => {
  const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(204);
  const set = res.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  return line.slice(0, line.indexOf(';'));
};

describe('GET /api/accounts: lanes and connect (D-5511, D-5517)', () => {
  it('a session reader gets `lanes` and `connect`', async () => {
    const w = await openApp({ enabled: true }); app = w.app;
    const cookie = await login(app);
    const t0 = Date.now();
    const res = await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } });
    expect(Date.now() - t0).toBeLessThan(2_000);   // the FIFO at gpt's name is never waited on
    expect(res.statusCode).toBe(200);
    const body = res.json() as AccountsResponse;
    expect(body.connect).toEqual({ accountOps: 'unsupported', gate: 'armed', origin: 'loopback' });
    const lanes = body.lanes!;
    // One lane per rostered account, whatever its file says.
    expect(Object.keys(lanes).sort()).toEqual(body.roster.map((r) => r.id).sort());
    const a = lanes['claude-a']!;
    expect(a.state.word).toBe('signed-in');
    expect(a.state.source).toBe('checked 4m ago');
    expect(a.check?.verdict).toBe('ok');
    expect(a.identity).toBe(IDENTITY);
    expect(a.identitySource).toBe('stated');
    expect(typeof a.mintedAt).toBe('number');
    expect(a.ready).toBe(false);
    expect(a.notReadyReason).toBe('seed-unverified');
    // Absent and unreadable stay two answers, and neither is ever Signed in.
    expect(lanes['claude-b']!.state).toEqual({ word: 'not-checked', source: 'no check recorded yet' });
    expect(lanes['claude-b']!.notReadyReason).toBe('no-lane-state');
    expect(lanes['claude-d']!.state).toEqual({ word: 'inconclusive', source: 'lane state unreadable' });
    expect(lanes['claude-d']!.identity).toBeUndefined();
    expect(lanes['gpt']!.state).toEqual({ word: 'inconclusive', source: 'lane state unreadable' });
    // What the file holds beyond the wire's fields never reaches it.
    for (const never of ['kh-never-on-the-wire', 'rkh-never-on-the-wire', 'planted', 'the-target-identity', 'fleetIdentity']) {
      expect(res.body, never).not.toContain(never);
    }
  });

  it('every field read from the lane state is masked: a planted credential in `identity` arrives as the mask', async () => {
    const w = await openApp({ enabled: true, lanes: false }); app = w.app;
    const dir = path.join(w.home, '.cc-sessions', '.accounts');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const planted = 'sk-' + 'ant-oat01-' + 'x'.repeat(80);
    writeFileSync(path.join(dir, 'claude-a.json'), JSON.stringify({
      check: { verdict: 'ok', at: iso(Date.now()) }, identity: planted, keyHint: 'sk-or-v1-…a3f9',
    }));
    const cookie = await login(app);
    const res = await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } });
    const a = (res.json() as AccountsResponse).lanes!['claude-a']!;
    expect(res.body).not.toContain('oat01');
    expect(a.identity).toBe(SECRET_MASK);
    // A key hint is a prefix, an ellipsis and four characters: it passes as written.
    expect(a.keyHint).toBe('sk-or-v1-…a3f9');
  });

  it('a box-token reader and a dark-gate reader get neither, and today\'s fields byte-for-byte', async () => {
    const armed = await openApp({ enabled: true });
    const dark = await openApp({ enabled: false });
    try {
      const cookie = await login(armed.app);
      const session = (await armed.app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } })).json() as AccountsResponse;
      const today = JSON.stringify({ accounts: session.accounts, projected: session.projected, roster: session.roster });
      for (const headers of [{}, { 'x-ccrc-mail-token': BOX_TOKEN }]) {
        const res = await dark.app.inject({ method: 'GET', url: '/api/accounts', headers });
        expect(res.statusCode).toBe(200);
        expect(Object.keys(res.json() as object)).toEqual(['accounts', 'projected', 'roster']);
        expect(res.body).toBe(today);
      }
      // An armed gate never lets a box token reach the handler at all.
      const box = await armed.app.inject({ method: 'GET', url: '/api/accounts', headers: { 'x-ccrc-mail-token': BOX_TOKEN } });
      expect(box.statusCode).toBe(401);
      expect(box.body).not.toContain('lanes');
      expect(box.body).not.toContain(IDENTITY);
    } finally {
      await armed.app.close();
      await dark.app.close();
    }
  });

  it('`connect.origin` is `insecure` for an `http://` non-loopback `cfg.origin`', async () => {
    const w = await openApp({ enabled: true, origin: 'http://fleet.example.invalid:7788' }); app = w.app;
    const cookie = await login(app);
    const body = (await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } })).json() as AccountsResponse;
    expect(body.connect?.origin).toBe('insecure');
  });

  it('the answer is `no-store`', async () => {
    for (const enabled of [true, false]) {
      const w = await openApp({ enabled });
      try {
        const headers = enabled ? { cookie: await login(w.app) } : {};
        const res = await w.app.inject({ method: 'GET', url: '/api/accounts', headers });
        expect(res.headers['cache-control'], String(enabled)).toBe('no-store');
      } finally {
        await w.app.close();
      }
    }
  });
});
