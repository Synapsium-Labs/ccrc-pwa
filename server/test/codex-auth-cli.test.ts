// codex-auth-cli.test.ts — `ccd/ccgpt-auth.py`'s device-code sign-in and its command line (codex-bridge spec
// 2026-10-15 §2.6; Stage 1 plan 2026-10-22, Task 4).
//
// Every case runs against a `fakeAuthServer` (or the closed loopback port), reached through CCRC_CODEX_AUTH_BASE, in
// a mkTmp HOME, so no case can reach a live endpoint. A case that needs a fault or a `consts` override runs the CLI
// through the driver's in-process `main` op (`runAuthDriver`); every other case runs the file itself as a command,
// spawned ASYNCHRONOUSLY (a synchronous child deadlocks against a server on this event loop). Tokens are built at
// runtime by `syntheticJwt`; no token-shaped literal is written here.
import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pythonOrSkip } from './ccgptHarness.js';
import { mkTmp } from './tmpHelpers.js';
import {
  AUTH_LIB, AUTH_ROUTES, CLOSED_AUTH_BASE, FIXTURE_ACCOUNT_ID, driverLines, fakeAuthServer, plantBackendCredential,
  runAuthDriver, syntheticJwt, type AuthAnswer, type AuthScript,
} from './codexAuthFixture.js';

const PY = pythonOrSkip();

const laneDir = (home: string): string => join(home, '.local', 'share', 'ccrc', 'codex', 'codex-a');
const credPath = (dir: string): string => join(dir, 'auth.json');
const pendingPath = (dir: string): string => join(dir, 'auth.pending.json');
const lockPath = (dir: string): string => join(dir, 'auth.json.lock');
const statusPath = (dir: string): string => join(dir, 'auth.status.json');

/** The verify page LiteLLM prints (its CHATGPT_DEVICE_VERIFY_URL), the library's AUTH_BASE + DEVICE_VERIFY_PATH. */
const VERIFY_URL = 'https://auth.openai.com/codex/device';
/** The sentence `already-signed-in` carries: the route a dead refresh token takes. */
const DEAD_TOKEN_ROUTE = "if the lane's refresh token is dead, the lane's next request records needs-signin; run this again then";
/** The pane's two rules (`ccd/ccd-account-auth`'s `_auth_user_code` and `_auth_url_of`). */
const CODE_RUN = /[A-Z0-9]{4}-[A-Z0-9]{4}/;
const URL_RUN = /https:\/\/\S+/;
/** The library's own CLIENT_ID, read off its one definition (no second literal of it is written here). */
const LIB_CLIENT_ID = /^CLIENT_ID = "([^"]+)"$/m.exec(readFileSync(AUTH_LIB, 'utf8'))?.[1];
/** The sha256 of LiteLLM 1.105.0's CHATGPT_CLIENT_ID (`litellm/llms/chatgpt/common_utils.py:21`), so the id's value
 *  is pinned with no second literal of it. */
const LITELLM_CLIENT_ID_SHA256 = '584341c2f0e88ad1f7c6856553d81dc4776ff42c43951daed3e2d8d91552eaa2';

/** The status report's keys, exactly. */
const REPORT_KEYS = [
  'authBase', 'credential', 'expiresAt', 'family', 'lastErrorCode', 'lastRefreshAt', 'lastRequestId', 'mode', 'modeOk',
  'ownerOk', 'source', 'state', 'unsaved', 'updatedAt',
];

/** Each token, and every `.`-separated segment of it long enough to be identifying. */
const secretPieces = (tokens: string[]): string[] =>
  tokens.flatMap((t) => [t, ...t.split('.').filter((s) => s.length >= 12)]);

/** The fields of a file's lstat a sign-in that writes nothing must leave alone. */
const lstatKey = (p: string): string => {
  const s = lstatSync(p, { bigint: true });
  return `${s.ino}:${s.mtimeNs}:${s.size}:${s.mode}`;
};

/** The authDir's listing with each entry's lstat. */
const dirState = (dir: string): string[] => readdirSync(dir).sort().map((n) => `${n}=${lstatKey(join(dir, n))}`);

/** Every file's bytes under the authDir, concatenated (for a leak check). */
const dirBytes = (dir: string): string =>
  existsSync(dir) ? readdirSync(dir).map((n) => { try { return readFileSync(join(dir, n), 'utf8'); } catch { return ''; } }).join('\n') : '';

/** A fresh set of tokens an exchange answers with. */
function issued(): { access: string; refresh: string; id: string } {
  const now = Math.floor(Date.now() / 1000);
  const claim = { 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-fixture-signin' } };
  return {
    access: syntheticJwt({ exp: now + 3600, iat: now, jti: randomBytes(8).toString('hex'), ...claim }),
    refresh: `rtok-fixture-${randomBytes(16).toString('hex')}`,
    id: syntheticJwt({ exp: now + 3600, iat: now, email: 'lane-a@example.invalid', ...claim }),
  };
}

const USER_CODE = 'QW7R-9KZ2';
const usercodeAnswer = (): AuthAnswer => ({ status: 200, body: { device_auth_id: 'dauth-fixture-1', user_code: USER_CODE } });
const deviceCodeAnswer = (): AuthAnswer => ({
  status: 200, body: { authorization_code: 'acode-fixture-1', code_challenge: 'cchal-fixture-1', code_verifier: 'cver-fixture-1' },
});
const exchangeAnswer = (t: { access: string; refresh: string; id: string }): AuthAnswer => ({
  status: 200, body: { access_token: t.access, refresh_token: t.refresh, id_token: t.id }, headers: { 'x-request-id': 'req-fixture-signin' },
});
/** A whole sign-in that succeeds at the first poll. */
const fullSignin = (t: { access: string; refresh: string; id: string }): AuthScript => ({
  usercode: [usercodeAnswer()], deviceToken: [deviceCodeAnswer()], token: [exchangeAnswer(t)],
});

/** LiteLLM's abandoned device-flow marker: an incomplete credential a sign-in may write over. */
function plantMarker(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const p = credPath(dir);
  writeFileSync(p, JSON.stringify({ device_code_requested_at: Math.floor(Date.now() / 1000) - 60 }), { mode: 0o600 });
  return p;
}

type CliResult = { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string };

/** Run `python3 -I ccd/ccgpt-auth.py <args>` in the fixture `home` (its cwd and HOME), ASYNCHRONOUSLY. The env is built
 *  from scratch, as `runAuthDriver` builds it: PATH and TMPDIR, CCRC_CODEX_AUTH_BASE (CLOSED_AUTH_BASE unless `env`
 *  names one), then `env`, then HOME. `onChild` sees the child as it starts, so a case can signal it. */
function runCli(
  home: string, args: string[], env: Record<string, string> = {}, onChild?: (c: ChildProcess) => void,
): Promise<CliResult> {
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: tmpdir(), CCRC_CODEX_AUTH_BASE: CLOSED_AUTH_BASE, ...env, HOME: home,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(PY as string, ['-I', AUTH_LIB, ...args], { cwd: home, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.once('error', (e) => { clearTimeout(timer); reject(e); });
    child.once('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout, stderr }); });
    onChild?.(child);
  });
}

/** Run `main(argv)` in-process through the driver, with `consts` and `faults`; answers the op's line. */
async function runMain(
  home: string, dir: string, argv: string[], o: { env?: Record<string, string>; consts?: object; faults?: string[] } = {},
): Promise<{ rc: number; stdout: string; stderr: string; ms: number }> {
  const r = await runAuthDriver(home, {
    authDir: dir, ops: [{ op: 'main', argv }], consts: o.consts ?? {}, faults: o.faults ?? [],
  }, o.env ?? {}, { timeoutMs: 15_000 });
  expect(r.timedOut, r.stderr).toBe(false);
  const lines = driverLines(r.stdout);
  expect(lines, r.stdout + r.stderr).toHaveLength(1);
  expect(lines[0].error, JSON.stringify(lines[0])).toBeUndefined();
  return { rc: lines[0].rc, stdout: lines[0].stdout, stderr: lines[0].stderr, ms: lines[0].ms };
}

const statusOf = async (home: string, dir: string, env: Record<string, string> = {}): Promise<Record<string, any>> => {
  const r = await runCli(home, ['status', '--auth-dir', dir, '--lane', 'codex-a'], env);
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as Record<string, any>;
};

/** Drive the library's own refresher once (an expired credential and one scripted token answer), so the status file
 *  it writes is the library's, not a hand-made one. */
async function refreshOnce(home: string, dir: string, base: string): Promise<Record<string, any>> {
  const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'ensure_fresh', lane: 'codex-a' }] }, { CCRC_CODEX_AUTH_BASE: base });
  expect(r.timedOut, r.stderr).toBe(false);
  return driverLines(r.stdout)[0];
}

describe.skipIf(!PY)('the device-code sign-in (codex-bridge spec §2.6)', () => {
  it("signin: prints LiteLLM's lines, polls through pending, writes 0600 and status ok", async () => {
    const home = mkTmp('codex-auth-signin-');
    const dir = laneDir(home);
    const t = issued();
    const srv = await fakeAuthServer({
      usercode: [usercodeAnswer()],
      deviceToken: [{ status: 403, body: { error: 'authorization_pending' } }, { status: 403, body: {} }, deviceCodeAnswer()],
      token: [exchangeAnswer(t)],
    });
    try {
      const r = await runMain(home, dir, ['signin', '--auth-dir', dir, '--lane', 'codex-a'], {
        env: { CCRC_CODEX_AUTH_BASE: srv.base }, consts: { DEVICE_POLL_MIN_S: 0.05 },
      });
      expect(r.rc, r.stderr).toBe(0);
      expect(r.stdout).toBe(
        'Sign in with ChatGPT using device code:\n'
        + `1) Visit ${VERIFY_URL}\n`
        + `2) Enter code: ${USER_CODE}\n`
        + 'Device codes are a common phishing target. Never share this code.\n'
        + 'ccgpt-auth: codex-a: signed-in\n',
      );
      const paths = srv.requests.map((q) => q.path);
      expect(paths).toEqual([AUTH_ROUTES.usercode, AUTH_ROUTES.deviceToken, AUTH_ROUTES.deviceToken, AUTH_ROUTES.deviceToken, AUTH_ROUTES.token]);
      expect(LIB_CLIENT_ID).toEqual(expect.any(String));
      expect(srv.requests[0].form).toEqual({ client_id: LIB_CLIENT_ID });
      // LiteLLM posts the device-code request and the poll as JSON (`json=`); the fake would parse a form as well.
      for (const q of srv.requests.slice(0, 4)) expect(q.headers['content-type']).toContain('application/json');
      for (const q of srv.requests.slice(1, 4)) expect(q.form).toEqual({ device_auth_id: 'dauth-fixture-1', user_code: USER_CODE });
      const ex = srv.requests[4];
      expect(ex.headers['content-type']).toContain('application/x-www-form-urlencoded');
      expect(ex.form).toEqual({
        grant_type: 'authorization_code', code: 'acode-fixture-1', redirect_uri: 'https://auth.openai.com/deviceauth/callback',
        client_id: LIB_CLIENT_ID, code_verifier: 'cver-fixture-1',
      });
      expect(lstatSync(credPath(dir)).mode & 0o7777).toBe(0o600);
      const cred = JSON.parse(readFileSync(credPath(dir), 'utf8')) as Record<string, unknown>;
      expect(Object.keys(cred).sort()).toEqual(['access_token', 'account_id', 'expires_at', 'id_token', 'refresh_token']);
      expect(cred).toMatchObject({ access_token: t.access, refresh_token: t.refresh, id_token: t.id, account_id: 'acct-fixture-signin' });
      const st = JSON.parse(readFileSync(statusPath(dir), 'utf8')) as Record<string, unknown>;
      expect(st).toMatchObject({ state: 'ok', lastErrorCode: null, lastRequestId: 'req-fixture-signin', unsaved: false });
      // D-TBD-signin-last-refresh (pending the controller's ruling): a sign-in records its own time as lastRefreshAt.
      expect(typeof st.lastRefreshAt).toBe('number');
      expect(lstatSync(statusPath(dir)).mode & 0o7777).toBe(0o600);
      expect(existsSync(pendingPath(dir))).toBe(false);
    } finally {
      await srv.close();
    }
  });

  it('signin: the first code-shaped and URL-shaped runs are the device code and the verify URL', async () => {
    const home = mkTmp('codex-auth-panerule-');
    const dir = laneDir(home);
    const srv = await fakeAuthServer(fullSignin(issued()));
    try {
      const r = await runCli(home, ['signin', '--auth-dir', dir, '--lane', 'codex-a'], { CCRC_CODEX_AUTH_BASE: srv.base });
      expect(r.status, r.stderr).toBe(0);
      // The pane reads stdout and stderr as one stream, in any interleaving: neither rule may match anything on
      // stderr, and on stdout the first match of each is the one the operator needs.
      expect(r.stdout.match(CODE_RUN)?.[0]).toBe(USER_CODE);
      expect(r.stdout.match(URL_RUN)?.[0]).toBe(VERIFY_URL);
      expect(r.stderr).not.toMatch(CODE_RUN);
      expect(r.stderr).not.toMatch(URL_RUN);
    } finally {
      await srv.close();
    }
  });

  it('signin: already-signed-in with no request when the credential is present and not barred, naming the dead-token route', async () => {
    const home = mkTmp('codex-auth-already-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const before = dirState(dir);
    const srv = await fakeAuthServer({});
    try {
      const r = await runCli(home, ['signin', '--auth-dir', dir, '--lane', 'codex-a'], { CCRC_CODEX_AUTH_BASE: srv.base });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('ccgpt-auth: codex-a: already-signed-in');
      expect(r.stdout).toContain(DEAD_TOKEN_ROUTE);
      expect(srv.requests).toHaveLength(0);
      expect(dirState(dir)).toEqual(before);
    } finally {
      await srv.close();
    }
  });

  it.each([
    ['needs-signin', { status: 400, body: { error: 'invalid_grant' } }],
    ['config-error', { status: 401, body: { error: 'invalid_client' } }],
  ] as Array<[string, AuthAnswer]>)('signin: a %s credential is signed in again', async (state, refusal) => {
    const home = mkTmp('codex-auth-again-');
    const dir = laneDir(home);
    const old = plantBackendCredential(dir, { expiresIn: -120 });
    const t = issued();
    const srv = await fakeAuthServer({ token: [refusal, exchangeAnswer(t)], usercode: [usercodeAnswer()], deviceToken: [deviceCodeAnswer()] });
    try {
      const refused = await refreshOnce(home, dir, srv.base);
      expect(refused.error).toBe(state);
      expect((JSON.parse(readFileSync(statusPath(dir), 'utf8')) as Record<string, unknown>).state).toBe(state);
      const r = await runCli(home, ['signin', '--auth-dir', dir, '--lane', 'codex-a'], { CCRC_CODEX_AUTH_BASE: srv.base });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('ccgpt-auth: codex-a: signed-in');
      const cred = JSON.parse(readFileSync(credPath(dir), 'utf8')) as Record<string, unknown>;
      expect(cred.refresh_token).toBe(t.refresh);
      expect(cred.refresh_token).not.toBe(old.refresh);
      expect(await statusOf(home, dir)).toMatchObject({ source: 'file', state: 'ok', credential: 'present' });
    } finally {
      await srv.close();
    }
  });

  it('an abandoned sign-in writes nothing', async () => {
    const home = mkTmp('codex-auth-abandon-');
    const dir = laneDir(home);
    plantMarker(dir);
    const before = dirState(dir);
    const pending = Array.from({ length: 20 }, () => ({ status: 403, body: { error: 'authorization_pending' } }));
    const srv = await fakeAuthServer({ usercode: [usercodeAnswer()], deviceToken: pending });
    try {
      let child: ChildProcess | undefined;
      const done = runCli(home, ['signin', '--auth-dir', dir, '--lane', 'codex-a'], { CCRC_CODEX_AUTH_BASE: srv.base }, (c) => { child = c; });
      const deadline = Date.now() + 10_000;
      while (!srv.requests.some((q) => q.path === AUTH_ROUTES.deviceToken) && Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 20));
      }
      expect(srv.requests.some((q) => q.path === AUTH_ROUTES.deviceToken)).toBe(true);
      child?.kill('SIGTERM');
      const r = await done;
      expect(r.signal).toBe('SIGTERM');
      expect(r.stdout).toContain(USER_CODE);
      expect(dirState(dir)).toEqual(before);
      expect(existsSync(lockPath(dir))).toBe(false);
      expect(existsSync(pendingPath(dir))).toBe(false);
      expect(existsSync(statusPath(dir))).toBe(false);
    } finally {
      await srv.close();
    }
  });

  it('signin: a timeout is login-failed after DEVICE_TIMEOUT_S, writing nothing', async () => {
    const home = mkTmp('codex-auth-timeout-');
    const dir = laneDir(home);
    plantMarker(dir);
    const before = dirState(dir);
    const pending = Array.from({ length: 50 }, () => ({ status: 404, body: {} }));
    const srv = await fakeAuthServer({ usercode: [usercodeAnswer()], deviceToken: pending });
    try {
      const start = Date.now();
      const r = await runMain(home, dir, ['signin', '--auth-dir', dir, '--lane', 'codex-a'], {
        env: { CCRC_CODEX_AUTH_BASE: srv.base }, consts: { DEVICE_TIMEOUT_S: 1 },
      });
      const took = Date.now() - start;
      expect(r.rc).toBe(1);
      expect(r.stderr).toMatch(/^ccgpt-auth: login-failed: .*timed out/m);
      expect(took).toBeGreaterThanOrEqual(900);
      expect(took).toBeLessThan(8_000);
      expect(srv.requests.some((q) => q.path === AUTH_ROUTES.token)).toBe(false);
      expect(dirState(dir)).toEqual(before);
    } finally {
      await srv.close();
    }
  });

  it.each(['codex-cli', 'unknown', 'unreadable'])('signin refuses %s before any device-code request, and leaves the file', async (kind) => {
    const home = mkTmp('codex-auth-refuse-');
    const dir = laneDir(home);
    mkdirSync(dir, { recursive: true });
    const content = kind === 'codex-cli'
      ? JSON.stringify({ OPENAI_API_KEY: 'x', tokens: { id_token: syntheticJwt({ sub: 'a' }), access_token: syntheticJwt({ sub: 'b' }), refresh_token: 'rtok-fixture-cli' } })
      : kind === 'unknown' ? JSON.stringify({ OPENAI_API_KEY: 'x', tokens: null }) : '{"access_token": ';
    writeFileSync(credPath(dir), content, { mode: 0o600 });
    const bytes = readFileSync(credPath(dir));
    const before = dirState(dir);
    const srv = await fakeAuthServer(fullSignin(issued()));
    try {
      const r = await runCli(home, ['signin', '--auth-dir', dir, '--lane', 'codex-a'], { CCRC_CODEX_AUTH_BASE: srv.base });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(kind === 'unreadable' ? /^ccgpt-auth: credential-unusable: /m : /^ccgpt-auth: foreign-family: /m);
      expect(srv.requests).toHaveLength(0);
      expect(readFileSync(credPath(dir)).equals(bytes)).toBe(true);
      expect(dirState(dir)).toEqual(before);
    } finally {
      await srv.close();
    }
  });

  it('signin: a checkpoint left by a crashed sign-in is promoted before the already-signed-in decision', async () => {
    const home = mkTmp('codex-auth-ckpt-');
    const dir = laneDir(home);
    plantMarker(dir);
    // The checkpoint is written after the marker, so its mtime is not older than the credential's.
    const side = join(home, 'side');
    const t = plantBackendCredential(side);
    renameSync(credPath(side), pendingPath(dir));
    const srv = await fakeAuthServer({});
    try {
      const r = await runCli(home, ['signin', '--auth-dir', dir, '--lane', 'codex-a'], { CCRC_CODEX_AUTH_BASE: srv.base });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('ccgpt-auth: codex-a: already-signed-in');
      expect(srv.requests).toHaveLength(0);
      expect(existsSync(pendingPath(dir))).toBe(false);
      expect((JSON.parse(readFileSync(credPath(dir), 'utf8')) as Record<string, unknown>).refresh_token).toBe(t.refresh);
    } finally {
      await srv.close();
    }
  });

  it('signin on a full disk is login-failed, and the old file is unchanged', async () => {
    const home = mkTmp('codex-auth-enospc-');
    const dir = laneDir(home);
    plantMarker(dir);
    const bytes = readFileSync(credPath(dir));
    const key = lstatKey(credPath(dir));
    const srv = await fakeAuthServer(fullSignin(issued()));
    try {
      // A second op in the same process reads the file's own word: the sign-in's record is not kept in memory.
      const run = await runAuthDriver(home, {
        authDir: dir, faults: ['enospc-writes:3'],
        ops: [{ op: 'main', argv: ['signin', '--auth-dir', dir, '--lane', 'codex-a'] }, { op: 'read' }],
      }, { CCRC_CODEX_AUTH_BASE: srv.base }, { timeoutMs: 15_000 });
      expect(run.timedOut, run.stderr).toBe(false);
      const [r, after] = driverLines(run.stdout);
      expect(after).toMatchObject({ op: 'read', credential: 'incomplete' });
      expect(r.rc).toBe(1);
      expect(r.stderr).toMatch(/^ccgpt-auth: login-failed: .*after 3 tries: the disk is full/m);
      expect(r.stdout).not.toContain('signed-in');
      expect(readFileSync(credPath(dir)).equals(bytes)).toBe(true);
      expect(lstatKey(credPath(dir))).toBe(key);
      expect(existsSync(pendingPath(dir))).toBe(false);
      expect(existsSync(statusPath(dir))).toBe(false);
    } finally {
      await srv.close();
    }
  });

  // Two failed writes: only the third try (SIGNIN_COMMIT_TRIES) signs in, after two SIGNIN_COMMIT_RETRY_S waits,
  // which the op's own elapsed time (the driver's `ms`) covers; the poll answers at once, so it waits nothing. The
  // bound is two-sided: at least the two 0.5 s waits, and under 2.9 s, which a spacing of 1.45 s or more reaches, so
  // a wider spacing is red too; the 1.9 s between the two is headroom for a loaded box.
  it('signin on a disk that frees after two failed writes is signed-in at the third try, 0.5 s apart', async () => {
    const home = mkTmp('codex-auth-enospc1-');
    const dir = laneDir(home);
    plantMarker(dir);
    const t = issued();
    const srv = await fakeAuthServer(fullSignin(t));
    try {
      const r = await runMain(home, dir, ['signin', '--auth-dir', dir, '--lane', 'codex-a'], {
        env: { CCRC_CODEX_AUTH_BASE: srv.base }, faults: ['enospc-writes:2'],
      });
      expect(r.rc, r.stderr).toBe(0);
      expect(r.stdout).toContain('ccgpt-auth: codex-a: signed-in');
      expect(r.ms).toBeGreaterThanOrEqual(950);
      expect(r.ms).toBeLessThan(2900);
      const cred = JSON.parse(readFileSync(credPath(dir), 'utf8')) as Record<string, unknown>;
      expect(cred).toMatchObject({ access_token: t.access, refresh_token: t.refresh, id_token: t.id });
      expect(JSON.parse(readFileSync(statusPath(dir), 'utf8'))).toMatchObject({ state: 'ok', unsaved: false });
      expect(existsSync(pendingPath(dir))).toBe(false);
    } finally {
      await srv.close();
    }
  });

  // Every try's rename lands and its directory fsync fails (enospc-fsyncdir:3): the file holds the sign-in's record,
  // so the sign-in is signed in, the status is ok with unsaved false, and nothing is kept in memory, which the second
  // op in the same process reads (D-TBD-signin-landed-rename).
  it('signin whose rename lands and whose directory fsync fails is signed-in, and keeps nothing unsaved', async () => {
    const home = mkTmp('codex-auth-enospc-dir-');
    const dir = laneDir(home);
    plantMarker(dir);
    const t = issued();
    const srv = await fakeAuthServer(fullSignin(t));
    try {
      const run = await runAuthDriver(home, {
        authDir: dir, faults: ['enospc-fsyncdir:3'],
        ops: [{ op: 'main', argv: ['signin', '--auth-dir', dir, '--lane', 'codex-a'] }, { op: 'read' }, { op: 'status' }],
      }, { CCRC_CODEX_AUTH_BASE: srv.base }, { timeoutMs: 15_000 });
      expect(run.timedOut, run.stderr).toBe(false);
      const [r, after, status] = driverLines(run.stdout);
      expect(r.rc, r.stderr).toBe(0);
      expect(r.stdout).toContain('ccgpt-auth: codex-a: signed-in');
      expect(r.stderr).not.toContain('login-failed');
      expect(r.ms).toBeGreaterThanOrEqual(950); // all three tries ran, so the fault fired at each
      const cred = JSON.parse(readFileSync(credPath(dir), 'utf8')) as Record<string, unknown>;
      expect(cred).toMatchObject({ access_token: t.access, refresh_token: t.refresh, id_token: t.id });
      expect(existsSync(pendingPath(dir))).toBe(false);
      expect(JSON.parse(readFileSync(statusPath(dir), 'utf8'))).toMatchObject({ state: 'ok', unsaved: false });
      expect(status.result).toMatchObject({ source: 'file', state: 'ok', unsaved: false, credential: 'present' });
      expect(after).toMatchObject({ op: 'read', credential: 'present', refresh_token: t.refresh.length });
      expect(String(after.detail)).not.toContain('an unsaved credential for');
    } finally {
      await srv.close();
    }
  });

  // In one process: a refresh whose commit the full disk refused leaves an unsaved record; the record's next refresh
  // meets a config-error, which bars it, so a sign-in runs; every sign-in commit then fails. The map must hold the
  // refresh's record again, not the sign-in's and not nothing. The refresh's record has a refresh token of its own
  // length; the file's and the sign-in's share one, and the detail check tells the file's apart.
  it("signin on a full disk gives back the unsaved refresh record it found", async () => {
    const home = mkTmp('codex-auth-enospc-kept-');
    const dir = laneDir(home);
    plantBackendCredential(dir, { expiresIn: -120 });
    const bytes = readFileSync(credPath(dir));
    const now = Math.floor(Date.now() / 1000);
    const claim = { 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-fixture-signin' } };
    const refreshed = {
      access_token: syntheticJwt({ exp: now + 3600, iat: now, jti: randomBytes(8).toString('hex'), ...claim }),
      refresh_token: `rtok-fixture-refreshed-${randomBytes(16).toString('hex')}`,
      id_token: syntheticJwt({ exp: now + 3600, iat: now, email: 'lane-a@example.invalid', ...claim }),
    };
    const t = issued();
    const srv = await fakeAuthServer({
      usercode: [usercodeAnswer()], deviceToken: [deviceCodeAnswer()],
      token: [{ status: 200, body: refreshed }, { status: 400, body: { error: 'invalid_client' } }, exchangeAnswer(t)],
    });
    try {
      const run = await runAuthDriver(home, {
        authDir: dir, faults: ['enospc-writes:50'],
        ops: [
          { op: 'ensure_fresh', lane: 'codex-a' },
          { op: 'ensure_fresh', lane: 'codex-a', withinS: 100000 },
          { op: 'main', argv: ['signin', '--auth-dir', dir, '--lane', 'codex-a'] },
          { op: 'read' },
        ],
      }, { CCRC_CODEX_AUTH_BASE: srv.base }, { timeoutMs: 15_000 });
      expect(run.timedOut, run.stderr).toBe(false);
      const [first, barred, r, after] = driverLines(run.stdout);
      expect(first, run.stderr).toMatchObject({ op: 'ensure_fresh', credential: 'present', refresh_token: refreshed.refresh_token.length });
      expect(barred).toMatchObject({ op: 'ensure_fresh', error: 'config-error' });
      expect(r.rc, r.stderr).toBe(1);
      expect(r.stderr).toMatch(/^ccgpt-auth: login-failed: .*after 3 tries: the disk is full/m);
      expect(srv.requests.map((q) => q.path)).toEqual([
        AUTH_ROUTES.token, AUTH_ROUTES.token, AUTH_ROUTES.usercode, AUTH_ROUTES.deviceToken, AUTH_ROUTES.token,
      ]);
      expect(after).toMatchObject({ op: 'read', credential: 'present', refresh_token: refreshed.refresh_token.length });
      expect(String(after.detail)).toContain('an unsaved credential for');
      expect(readFileSync(credPath(dir)).equals(bytes)).toBe(true);
    } finally {
      await srv.close();
    }
  });

  it.each(['usercode', 'deviceToken', 'token'] as Array<keyof AuthScript>)(
    'signin: a 302 from the %s route is login-failed, and its Location receives nothing',
    async (route) => {
      const home = mkTmp('codex-auth-redirect-');
      const dir = laneDir(home);
      plantMarker(dir);
      const before = dirState(dir);
      const elsewhere = await fakeAuthServer({});
      const script = fullSignin(issued());
      script[route] = [{ status: 302, headers: { location: `${elsewhere.base}/elsewhere` } }];
      const srv = await fakeAuthServer(script);
      try {
        const r = await runCli(home, ['signin', '--auth-dir', dir, '--lane', 'codex-a'], { CCRC_CODEX_AUTH_BASE: srv.base });
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/^ccgpt-auth: login-failed: .*redirect \(HTTP 302\)/m);
        expect(elsewhere.requests).toHaveLength(0);
        expect(srv.requests[srv.requests.length - 1]?.path).toBe(AUTH_ROUTES[route as keyof typeof AUTH_ROUTES]);
        expect(dirState(dir)).toEqual(before);
      } finally {
        await srv.close();
        await elsewhere.close();
      }
    },
  );

  // Both overrides are off the library's loopback list, yet both still lead only to this box's fake, so even a
  // library that skipped the check could reach nothing past the loopback interface.
  it.each([
    ['an IPv4-mapped IPv6 host', (port: string) => `http://[::ffff:127.0.0.1]:${port}`],
    ['an https:// URL', (port: string) => `https://127.0.0.1:${port}`],
  ] as Array<[string, (port: string) => string]>)(
    'signin with %s as CCRC_CODEX_AUTH_BASE is auth-endpoint-refused before any request',
    async (_what, url) => {
      const home = mkTmp('codex-auth-offlist-');
      const dir = laneDir(home);
      plantMarker(dir);
      const before = dirState(dir);
      const srv = await fakeAuthServer(fullSignin(issued()));
      try {
        const r = await runCli(home, ['signin', '--auth-dir', dir, '--lane', 'codex-a'], {
          CCRC_CODEX_AUTH_BASE: url(new URL(srv.base).port),
        });
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/^ccgpt-auth: auth-endpoint-refused: /m);
        expect(r.stdout).toBe('');
        expect(srv.requests).toHaveLength(0);
        expect(dirState(dir)).toEqual(before);
      } finally {
        await srv.close();
      }
    },
  );

  // The values themselves, off the library's one definition of each: LiteLLM 1.105.0's DEVICE_CODE_POLL_SLEEP_SECONDS
  // (`litellm/llms/chatgpt/authenticator.py:30`) and its CHATGPT_CLIENT_ID, compared by sha256.
  it("signin's poll floor and client id are LiteLLM 1.105.0's", () => {
    expect(readFileSync(AUTH_LIB, 'utf8')).toMatch(/^DEVICE_POLL_MIN_S = 5$/m);
    expect(LIB_CLIENT_ID).toEqual(expect.any(String));
    expect(createHash('sha256').update(LIB_CLIENT_ID as string).digest('hex')).toBe(LITELLM_CLIENT_ID_SHA256);
  });

  // The op's own elapsed time (the driver's `ms`, which leaves out the interpreter's start) covers two waits.
  it.each([
    ['an interval over the floor is waited', { DEVICE_POLL_MIN_S: 0.05 }, 0.5],
    ['an interval under the floor is raised to it', { DEVICE_POLL_MIN_S: 0.5 }, 0.01],
  ] as Array<[string, object, number]>)('signin: the poll waits max(interval, DEVICE_POLL_MIN_S): %s', async (_what, consts, interval) => {
    const home = mkTmp('codex-auth-interval-');
    const dir = laneDir(home);
    const srv = await fakeAuthServer({
      usercode: [{ status: 200, body: { device_auth_id: 'dauth-fixture-1', user_code: USER_CODE, interval } }],
      deviceToken: [{ status: 403, body: {} }, { status: 403, body: {} }, deviceCodeAnswer()],
      token: [exchangeAnswer(issued())],
    });
    try {
      const r = await runMain(home, dir, ['signin', '--auth-dir', dir, '--lane', 'codex-a'], {
        env: { CCRC_CODEX_AUTH_BASE: srv.base }, consts,
      });
      expect(r.rc, r.stderr).toBe(0);
      expect(srv.requests.filter((q) => q.path === AUTH_ROUTES.deviceToken)).toHaveLength(3);
      expect(r.ms).toBeGreaterThanOrEqual(950);
    } finally {
      await srv.close();
    }
  });

  it.each([
    ['its own refresh token', (t: { access: string; refresh: string; id: string }) => t.refresh],
    ["its access token's signature segment", (t: { access: string; refresh: string; id: string }) => t.access.split('.')[2]],
    ['the submitted code_verifier', () => 'cver-fixture-1'],
    ['the submitted authorization code', () => 'acode-fixture-1'],
    ["its id token's signature segment", (t: { access: string; refresh: string; id: string }) => t.id.split('.')[2]],
  ] as Array<[string, (t: { access: string; refresh: string; id: string }) => string]>)(
    'signin: an exchange request id that echoes %s is not stored',
    async (_what, echo) => {
      const home = mkTmp('codex-auth-ridecho-');
      const dir = laneDir(home);
      const t = issued();
      const srv = await fakeAuthServer({
        usercode: [usercodeAnswer()], deviceToken: [deviceCodeAnswer()],
        token: [{ ...exchangeAnswer(t), headers: { 'x-request-id': echo(t) } }],
      });
      try {
        const r = await runCli(home, ['signin', '--auth-dir', dir, '--lane', 'codex-a'], { CCRC_CODEX_AUTH_BASE: srv.base });
        expect(r.status, r.stderr).toBe(0);
        expect(JSON.parse(readFileSync(statusPath(dir), 'utf8'))).toMatchObject({ state: 'ok', lastRequestId: null });
        expect(readFileSync(statusPath(dir), 'utf8')).not.toContain(echo(t));
      } finally {
        await srv.close();
      }
    },
  );

  it('signin: an exchange answer without refresh_token is login-failed and leaks it nowhere', async () => {
    const home = mkTmp('codex-auth-r8-');
    const dir = laneDir(home);
    plantMarker(dir);
    const before = dirState(dir);
    const t = issued();
    const srv = await fakeAuthServer({
      usercode: [usercodeAnswer()], deviceToken: [deviceCodeAnswer()],
      token: [{ status: 200, body: { access_token: t.access, id_token: t.id } }],
    });
    try {
      const r = await runCli(home, ['signin', '--auth-dir', dir, '--lane', 'codex-a'], { CCRC_CODEX_AUTH_BASE: srv.base });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/^ccgpt-auth: login-failed: /m);
      for (const piece of secretPieces([t.access, t.id])) {
        expect(r.stdout).not.toContain(piece);
        expect(r.stderr).not.toContain(piece);
        expect(dirBytes(dir)).not.toContain(piece);
      }
      expect(dirState(dir)).toEqual(before);
    } finally {
      await srv.close();
    }
  });

  it('signin: an override is named on stderr once, and status says authBase override', async () => {
    const home = mkTmp('codex-auth-override-');
    const dir = laneDir(home);
    const srv = await fakeAuthServer(fullSignin(issued()));
    try {
      const r = await runCli(home, ['signin', '--auth-dir', dir, '--lane', 'codex-a'], { CCRC_CODEX_AUTH_BASE: srv.base });
      expect(r.status, r.stderr).toBe(0);
      const named = r.stderr.split('\n').filter((l) => l.includes('CCRC_CODEX_AUTH_BASE'));
      expect(named).toHaveLength(1);
      expect(named[0]).toContain(srv.base);
      expect((await statusOf(home, dir, { CCRC_CODEX_AUTH_BASE: srv.base })).authBase).toBe('override');
      expect((await statusOf(home, dir, { CCRC_CODEX_AUTH_BASE: '' })).authBase).toBe('default');
    } finally {
      await srv.close();
    }
  });
});

describe.skipIf(!PY)('the command line (codex-bridge spec §2.6)', () => {
  it('status: computed when no status file exists; file once one does; modeOk false for 0640 and 0000', async () => {
    const home = mkTmp('codex-auth-status-');
    const dir = laneDir(home);
    plantBackendCredential(dir, { expiresIn: -120 });
    const computed = await statusOf(home, dir);
    expect(computed).toMatchObject({
      source: 'computed', family: 'chatgpt-backend', state: 'ok', credential: 'present', lastRefreshAt: null,
      lastErrorCode: null, lastRequestId: null, unsaved: false, updatedAt: null, mode: '0600', modeOk: true, ownerOk: true,
    });
    expect(typeof computed.expiresAt).toBe('number');
    expect(existsSync(statusPath(dir))).toBe(false);
    const t = issued();
    const srv = await fakeAuthServer({ token: [exchangeAnswer(t)] });
    try {
      expect((await refreshOnce(home, dir, srv.base)).credential).toBe('present');
    } finally {
      await srv.close();
    }
    const file = await statusOf(home, dir);
    expect(file).toMatchObject({ source: 'file', state: 'ok', credential: 'present', lastRequestId: 'req-fixture-signin', modeOk: true });
    expect(typeof file.lastRefreshAt).toBe('number');
    expect(typeof file.updatedAt).toBe('number');
    chmodSync(credPath(dir), 0o640);
    expect(await statusOf(home, dir)).toMatchObject({ mode: '0640', modeOk: false });
    chmodSync(credPath(dir), 0o000);
    try {
      expect(await statusOf(home, dir)).toMatchObject({ mode: '0000', modeOk: false });
    } finally {
      chmodSync(credPath(dir), 0o600);
    }
  });

  it("status: ownerOk false when the file is not this uid's", async () => {
    const home = mkTmp('codex-auth-owner-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const uid = process.getuid ? process.getuid() : 0;
    const mine = await runMain(home, dir, ['status', '--auth-dir', dir]);
    expect(JSON.parse(mine.stdout).ownerOk).toBe(true);
    const r = await runMain(home, dir, ['status', '--auth-dir', dir], { faults: [`uid:${uid + 1}`] });
    expect(r.rc).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ownerOk: false, modeOk: true });
  });

  it('status: exactly the listed keys, never account_id', async () => {
    const home = mkTmp('codex-auth-keys-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const r = await runCli(home, ['status', '--auth-dir', dir, '--lane', 'codex-a']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(Object.keys(JSON.parse(r.stdout) as object).sort()).toEqual(REPORT_KEYS);
    expect(r.stdout).not.toContain('account_id');
    expect(r.stdout).not.toContain(FIXTURE_ACCOUNT_ID);
    const absent = await statusOf(home, laneDir(join(home, 'none')));
    expect(Object.keys(absent).sort()).toEqual(REPORT_KEYS);
    expect(absent).toMatchObject({ source: 'computed', credential: 'absent', state: null, mode: null });
  });

  it('paths names four files; secret-files names the credential and the checkpoint', async () => {
    const home = mkTmp('codex-auth-paths-');
    const dir = laneDir(home);
    const p = await runCli(home, ['paths', '--auth-dir', dir]);
    expect(p.status, p.stderr).toBe(0);
    expect(JSON.parse(p.stdout)).toEqual({
      credential: credPath(dir), pending: pendingPath(dir), lock: lockPath(dir), status: statusPath(dir), lockWaitS: 60,
    });
    const s = await runCli(home, ['secret-files', '--auth-dir', dir]);
    expect(s.status, s.stderr).toBe(0);
    expect(s.stdout).toBe(`${credPath(dir)}\n${pendingPath(dir)}\n`);
    expect(existsSync(dir)).toBe(false);
  });

  it('no verb prints a token', async () => {
    const home = mkTmp('codex-auth-noprint-');
    const dir = laneDir(home);
    const planted = plantBackendCredential(dir, { expiresIn: -120 });
    const t = issued();
    const srv = await fakeAuthServer({
      token: [{ status: 400, body: { error: 'invalid_grant' } }, exchangeAnswer(t)], usercode: [usercodeAnswer()], deviceToken: [deviceCodeAnswer()],
    });
    const outputs: string[] = [];
    try {
      await refreshOnce(home, dir, srv.base);
      for (const args of [['status', '--auth-dir', dir], ['paths', '--auth-dir', dir], ['secret-files', '--auth-dir', dir],
        ['signin', '--auth-dir', dir, '--lane', 'codex-a'], ['signin', '--auth-dir', dir, '--lane', 'codex-a'],
        ['status', '--auth-dir', dir, '--lane', 'codex-a']]) {
        const r = await runCli(home, args, { CCRC_CODEX_AUTH_BASE: srv.base });
        expect(r.status, `${args.join(' ')}: ${r.stderr}`).toBe(0);
        outputs.push(r.stdout, r.stderr);
      }
    } finally {
      await srv.close();
    }
    expect(outputs.join('\n')).toContain('signed-in');
    for (const piece of secretPieces([planted.access, planted.refresh, planted.id, t.access, t.refresh, t.id])) {
      for (const o of outputs) expect(o).not.toContain(piece);
    }
  });

  it('a relative --auth-dir and an unknown verb are usage, rc 2', async () => {
    const home = mkTmp('codex-auth-usage-');
    const dir = laneDir(home);
    for (const args of [
      ['status', '--auth-dir', 'relative/dir'], ['signin', '--auth-dir', 'relative/dir', '--lane', 'codex-a'],
      ['paths', '--auth-dir', 'relative/dir'], ['secret-files', '--auth-dir', '.'], ['refresh', '--auth-dir', dir], [],
      ['status'], ['signin', '--auth-dir', dir], ['paths', '--auth-dir', dir, '--bogus', 'x'], ['status', '--auth-dir'],
    ]) {
      const r = await runCli(home, args);
      expect(r.status, `${JSON.stringify(args)}: ${r.stderr}`).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr.trim().split('\n'), JSON.stringify(args)).toHaveLength(1);
      expect(r.stderr).toMatch(/^usage: /);
    }
    expect(existsSync(dir)).toBe(false);
  });
});
