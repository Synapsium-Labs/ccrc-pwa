// codexAuthFixture.ts — the codex auth library's test fixtures (codex-bridge Stage 1, Task 1; spec 2026-10-15 §2.6, §5).
//
// What is here, and the one rule they share: NO TEST CAN REACH A LIVE ENDPOINT. Every token, device-code and exchange
// request a test makes goes to `fakeAuthServer`, an in-process node server on 127.0.0.1:0, reached through
// CCRC_CODEX_AUTH_BASE, which the library accepts only for a loopback http:// URL. `runAuthDriver` sets that variable
// on every spawn, to CLOSED_AUTH_BASE unless the caller's env names one, and builds the child's env from scratch, so
// neither an operator's override nor any other variable of the vitest process reaches the library.
//
// No token-shaped literal is written in this tree: `syntheticJwt` BUILDS each token at runtime from JSON claims, with
// a random signature segment, so two plantings never collide and nothing here is a real credential.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pythonOrSkip } from './ccgptHarness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

/** The library under test, in this tree. */
export const AUTH_LIB = path.join(REPO, 'ccd', 'ccgpt-auth.py');
/** The driver that runs a sequence of library operations in one process. */
export const AUTH_DRIVER = path.join(here, 'fixtures', 'codexauth', 'driver.py');

/** A loopback URL nothing answers: port 1 is privileged, so no non-root process (no fake) can bind it, and a
 *  request there is refused at once. The default for every spawn that needs no answer. */
export const CLOSED_AUTH_BASE = 'http://127.0.0.1:1';

/** The ChatGPT account id the planted tokens' claims carry unless a case names another. */
export const FIXTURE_ACCOUNT_ID = 'acct-fixture-0';

/** The JWT claim that carries the account id (the library's ACCOUNT_CLAIM). */
export const ACCOUNT_CLAIM = 'https://api.openai.com/auth';

const b64url = (b: Buffer): string => b.toString('base64url');

/** An unsigned JWT built from `claims`, with a random signature segment (never verified: spec §2.6 trusts an ID
 *  token through TLS). */
export function syntheticJwt(claims: object): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })));
  const payload = b64url(Buffer.from(JSON.stringify(claims)));
  return `${header}.${payload}.${b64url(randomBytes(24))}`;
}

const accountClaim = (id: string | null): object => (id === null ? {} : { [ACCOUNT_CLAIM]: { chatgpt_account_id: id } });

/** Plant a backend-format credential (LiteLLM's five keys) at `<dir>/auth.json`, creating `dir`.
 *  - `expiresIn` (default 3600): the access token's `exp`, seconds from now; a planted credential is fresh unless a
 *    case says otherwise.
 *  - `accountId`: the FILE's `account_id`. Left out, it is the claims' id; `null` stores null while the tokens'
 *    claims still carry `claimAccountId` (default FIXTURE_ACCOUNT_ID), so the id can only be derived.
 *  - `claimAccountId`: the id in both tokens' claims (`null`: no account claim at all).
 *  - `idClaims`, `accessClaims`: merged over each token's default claims, so a case can make the two tokens differ.
 *  - `storedExpiresAt`: overrides the file's `expires_at` (`null` stores null) without changing the token's `exp`.
 *  - `refresh`: the refresh token (default: a random opaque string). `mode` (default 0600). `extra`: merged into the
 *    file's object last. */
export function plantBackendCredential(
  dir: string,
  o: {
    expiresIn?: number; accountId?: string | null; claimAccountId?: string | null; refresh?: string; mode?: number;
    extra?: object; storedExpiresAt?: number | null; idClaims?: object; accessClaims?: object;
  } = {},
): { access: string; refresh: string; id: string } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (o.expiresIn ?? 3600);
  const claimId = o.claimAccountId === undefined ? (o.accountId ?? FIXTURE_ACCOUNT_ID) : o.claimAccountId;
  const access = syntheticJwt({ exp, iat: now, jti: b64url(randomBytes(8)), ...accountClaim(claimId), ...(o.accessClaims ?? {}) });
  const id = syntheticJwt({ exp: now + 3600, iat: now, email: 'lane-a@example.invalid', ...accountClaim(claimId), ...(o.idClaims ?? {}) });
  const refresh = o.refresh ?? `rtok-fixture-${randomBytes(16).toString('hex')}`;
  const record = {
    access_token: access,
    refresh_token: refresh,
    id_token: id,
    expires_at: o.storedExpiresAt === undefined ? exp : o.storedExpiresAt,
    account_id: o.accountId === undefined ? claimId : o.accountId,
    ...(o.extra ?? {}),
  };
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'auth.json');
  writeFileSync(file, JSON.stringify(record));
  chmodSync(file, o.mode ?? 0o600);
  return { access, refresh, id };
}

// ── the fake auth server ─────────────────────────────────────────────────────────────────────────────────────────

/** One scripted answer. `body` is sent as JSON unless it is a string (sent as is). `drop` destroys the connection
 *  without an answer. */
export type AuthAnswer = { status: number; body?: unknown; delayMs?: number; headers?: Record<string, string>; drop?: boolean };

/** A queue of answers per route; each request takes the next one. An unscripted request is answered 500. */
export type AuthScript = { token?: AuthAnswer[]; usercode?: AuthAnswer[]; deviceToken?: AuthAnswer[] };

/** Every request the server saw, in arrival order. `form` is the body parsed as JSON or as a form, whichever it
 *  is; null when it is neither. */
export type AuthRequest = {
  method: string; path: string; headers: IncomingHttpHeaders; body: string; form: Record<string, unknown> | null;
};

export const AUTH_ROUTES = {
  token: '/oauth/token',
  usercode: '/api/accounts/deviceauth/usercode',
  deviceToken: '/api/accounts/deviceauth/token',
} as const;

function parseBody(body: string, contentType: string | undefined): Record<string, unknown> | null {
  if (body === '') return null;
  if ((contentType ?? '').includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(body));
  }
  try {
    const v: unknown = JSON.parse(body);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** An in-process token endpoint on 127.0.0.1:0. Routes `/oauth/token`, the device-code `usercode` and device
 *  `token` routes, each answering from its queue in `script`. The token route also behaves as the real one does for a
 *  single-use refresh token: a refresh token it already redeemed (a 2xx answer to a `refresh_token` grant) is
 *  rejected `400 {"error": "refresh_token_reused"}` without taking a queued answer. Any other path is a 404. */
export async function fakeAuthServer(
  script: AuthScript,
): Promise<{ base: string; requests: AuthRequest[]; close(): Promise<void> }> {
  const queues: Record<keyof AuthScript, AuthAnswer[]> = {
    token: [...(script.token ?? [])],
    usercode: [...(script.usercode ?? [])],
    deviceToken: [...(script.deviceToken ?? [])],
  };
  const redeemed = new Set<string>();
  const requests: AuthRequest[] = [];
  const send = (res: ServerResponse, a: AuthAnswer): void => {
    const text = typeof a.body === 'string' ? a.body : a.body === undefined ? '' : JSON.stringify(a.body);
    res.writeHead(a.status, { 'content-type': 'application/json', ...(a.headers ?? {}) });
    res.end(text);
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const urlPath = (req.url ?? '/').split('?')[0];
      const form = parseBody(body, req.headers['content-type']);
      requests.push({ method: req.method ?? '', path: urlPath, headers: req.headers, body, form });
      const route = (Object.keys(AUTH_ROUTES) as Array<keyof typeof AUTH_ROUTES>).find((k) => AUTH_ROUTES[k] === urlPath);
      if (!route) {
        send(res, { status: 404, body: { error: 'not_found' } });
        return;
      }
      const refresh = route === 'token' && form?.grant_type === 'refresh_token' && typeof form.refresh_token === 'string'
        ? form.refresh_token : null;
      if (refresh !== null && redeemed.has(refresh)) {
        send(res, { status: 400, body: { error: 'refresh_token_reused' } });
        return;
      }
      const answer = queues[route].shift() ?? { status: 500, body: { error: 'fake_auth_server_unscripted' } };
      if (refresh !== null && answer.status >= 200 && answer.status < 300 && !answer.drop) redeemed.add(refresh);
      const reply = (): void => {
        if (answer.drop) req.socket.destroy();
        else send(res, answer);
      };
      if (answer.delayMs) setTimeout(reply, answer.delayMs);
      else reply();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

// ── the driver ───────────────────────────────────────────────────────────────────────────────────────────────────

const TMP_ROOT = (() => {
  try { return realpathSync(tmpdir()); } catch { return tmpdir(); }
})();

/** Spawn `python3 -I driver.py <action>` ASYNCHRONOUSLY (a synchronous child deadlocks against a server on this
 *  event loop), in the fixture `home`, which is its cwd and its HOME. `action.lib` defaults to this tree's library.
 *  The env is built from scratch: PATH and TMPDIR (this run's temp parent, so a temp file the library makes stays
 *  inside it), then the caller's `env`, then HOME; and CCRC_CODEX_AUTH_BASE is CLOSED_AUTH_BASE unless `env` names
 *  one. No PYTHON* variable is set: `-I` implies `-E`, which ignores them all, so the driver's own
 *  `sys.dont_write_bytecode = True` is what keeps a `.pyc` out of the tree. `onLine` is called with each JSON line as
 *  the driver prints it (one per op, flushed), so a case can act between two ops. Past `timeoutMs` (default 10000)
 *  the child is killed with SIGKILL and `timedOut` is true; `status` is then null (a child a signal ended has no
 *  exit code). */
export function runAuthDriver(
  home: string,
  action: object,
  env: Record<string, string> = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  o: { timeoutMs?: number; onLine?: (line: Record<string, any>) => void } = {},
): Promise<{ status: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  const resolved = path.resolve(home);
  if (!resolved.startsWith(TMP_ROOT + path.sep)) {
    throw new Error(`runAuthDriver: home must be a fixture directory under ${TMP_ROOT} (use mkTmp) — got ${JSON.stringify(home)}`);
  }
  if ('HOME' in env) throw new Error('runAuthDriver: env must not set HOME (the fixture owns it)');
  const py = pythonOrSkip();
  if (!py) throw new Error('runAuthDriver called with no python3 — guard with pythonOrSkip() first');
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    TMPDIR: tmpdir(),
    CCRC_CODEX_AUTH_BASE: CLOSED_AUTH_BASE,
    ...env,
    HOME: resolved,
  };
  const full = { lib: AUTH_LIB, ...action };
  return new Promise((resolve, reject) => {
    const child = spawn(py, ['-I', AUTH_DRIVER, JSON.stringify(full)], {
      cwd: resolved, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 10_000);
    let seen = 0;
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString();
      if (!o.onLine) return;
      for (let nl = stdout.indexOf('\n', seen); nl !== -1; nl = stdout.indexOf('\n', seen)) {
        const text = stdout.slice(seen, nl);
        seen = nl + 1;
        if (text.trim() !== '') o.onLine(JSON.parse(text) as Record<string, unknown>);
      }
    });
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.once('error', (err) => { clearTimeout(timer); reject(err); });
    child.once('close', (code) => { clearTimeout(timer); resolve({ status: code, stdout, stderr, timedOut }); });
  });
}

/** The driver's JSON lines, one per op, in order. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function driverLines(stdout: string): Array<Record<string, any>> {
  return stdout.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Record<string, unknown>);
}
