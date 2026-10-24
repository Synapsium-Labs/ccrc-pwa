// codexBridgeFixture.ts — the codex bridge's test fixtures (codex-bridge Stage 2, Task 1; spec 2026-10-15 §2, §5).
//
// What is here, and the one rule they share with Stage 1's `codexAuthFixture.ts`: NO TEST CAN REACH A LIVE ENDPOINT.
// Every bridge process a test starts gets CCGPT_BRIDGE_UPSTREAM_BASE (the only upstream override the backend adapter
// accepts, loopback http:// only) and CCRC_CODEX_AUTH_BASE (Stage 1's), each set to CLOSED_AUTH_BASE unless the
// caller's env names a non-empty one, and its env is built from scratch, so neither an operator's override nor any
// other variable of the vitest process reaches the package.
//
// `runBridgeDriver` runs `server/test/fixtures/codexbridge/driver.py`, which loads the package from this tree's
// `ccd/` directory (first on `sys.path`, as the shim's direct entry does) and runs a list of ops in ONE process.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pythonOrSkip } from './ccgptHarness.js';
import { CLOSED_AUTH_BASE } from './codexAuthFixture.js';

export { driverLines } from './codexAuthFixture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

/** This tree's `ccd` directory: the driver's `pkg`, the directory put first on `sys.path`. */
export const CCD_DIR = path.join(REPO, 'ccd');
/** The package under test, in this tree. */
export const BRIDGE_DIR = path.join(CCD_DIR, 'codexbridge');
/** The driver that runs a sequence of package operations in one process. */
export const BRIDGE_DRIVER = path.join(here, 'fixtures', 'codexbridge', 'driver.py');

const TMP_ROOT = (() => {
  try { return realpathSync(tmpdir()); } catch { return tmpdir(); }
})();

/** The longest action, in UTF-8 BYTES, passed inline in argv; a longer one goes through a file (below). */
const ARG_INLINE_MAX = 64 * 1024;
/** A per-process counter, so two calls sharing one HOME never write the same action file. */
let actionFiles = 0;

/** Spawn `python3 -I driver.py <action>` ASYNCHRONOUSLY (a synchronous child deadlocks against a fake server on this
 *  event loop), in the fixture `home`, which is its cwd and its HOME. `action.pkg` defaults to this tree's `ccd`
 *  directory. The env is built from scratch: PATH and TMPDIR, then the caller's `env`, then the two endpoint
 *  variables (each CLOSED_AUTH_BASE unless `env` names a non-empty value: an empty one would read as unset, which is
 *  a live endpoint), then HOME. No PYTHON* variable is set: `-I` implies `-E`, so the driver's own
 *  `sys.dont_write_bytecode = True` is what keeps a `__pycache__` out of the tree. Past `timeoutMs` (default 10000)
 *  the child is killed with SIGKILL and `timedOut` is true; `status` is then null. An action longer than
 *  ARG_INLINE_MAX UTF-8 bytes is written to `<home>/.driver-action-<n>.json` (0600, `n` unique per call) and passed
 *  as `@<path>`: Linux refuses one argument past 128 KiB in bytes (E2BIG), and a case such as a 700,000-character
 *  tool result needs more. */
export function runBridgeDriver(
  home: string,
  action: object,
  env: Record<string, string> = {},
  o: { timeoutMs?: number } = {},
): Promise<{ status: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  const resolved = path.resolve(home);
  if (!resolved.startsWith(TMP_ROOT + path.sep)) {
    throw new Error(`runBridgeDriver: home must be a fixture directory under ${TMP_ROOT} (use mkTmp) — got ${JSON.stringify(home)}`);
  }
  if ('HOME' in env) throw new Error('runBridgeDriver: env must not set HOME (the fixture owns it)');
  const py = pythonOrSkip();
  if (!py) throw new Error('runBridgeDriver called with no python3 — guard with pythonOrSkip() first');
  const named = (k: string): string => {
    const v = env[k];
    return typeof v === 'string' && v !== '' ? v : CLOSED_AUTH_BASE;
  };
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    TMPDIR: tmpdir(),
    ...env,
    CCGPT_BRIDGE_UPSTREAM_BASE: named('CCGPT_BRIDGE_UPSTREAM_BASE'),
    CCRC_CODEX_AUTH_BASE: named('CCRC_CODEX_AUTH_BASE'),
    HOME: resolved,
  };
  const full = JSON.stringify({ pkg: CCD_DIR, ...action });
  let arg = full;
  if (Buffer.byteLength(full, 'utf8') > ARG_INLINE_MAX) {
    actionFiles += 1;
    const file = path.join(resolved, `.driver-action-${actionFiles}.json`);
    writeFileSync(file, full, { mode: 0o600 });
    arg = '@' + file;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(py, ['-I', BRIDGE_DRIVER, arg], {
      cwd: resolved, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 10_000);
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.once('error', (err) => { clearTimeout(timer); reject(err); });
    child.once('close', (code) => { clearTimeout(timer); resolve({ status: code, stdout, stderr, timedOut }); });
  });
}

// ── the fake Responses backend (Task 7) ──────────────────────────────────────────────────────────────────────────

/** One scripted answer of `fakeResponses`, taken in order by each `POST /responses`.
 *  - `status`, `headers`: the response head (`content-type` defaults to `text/event-stream` for an `sse` answer and to
 *    `application/json` otherwise).
 *  - `sse`: the stream. A string is written at once and the response ended; `{chunks, delayMs, holdOpenMs}` writes
 *    each chunk `delayMs` apart (default 0), then holds the connection open, writing nothing, for `holdOpenMs`
 *    (default 0) before it ends it: a silent upstream.
 *  - `body`: a JSON body (a string is sent as it is), for an error answer.
 *  - `holdHeadMs`: the request is read and NOTHING is written for this long, the head included: an upstream that
 *    accepted the connection and never answers. The answer then follows as scripted. */
export type ResponsesAnswer = {
  status: number;
  headers?: Record<string, string>;
  sse?: string | { chunks: string[]; delayMs?: number; holdOpenMs?: number };
  body?: unknown;
  holdHeadMs?: number;
};

/** The queue `fakeResponses` answers from; an unscripted request is answered 500 with a JSON error body. */
export type ResponsesScript = ResponsesAnswer[];

/** The request header names whose VALUES the fake records; every other value (the bearer token above all) is never
 *  kept. The authorization value is recorded only as its sha256, so a case can tell which token was sent. */
export const RESPONSES_HEADER_VALUES = [
  'originator', 'user-agent', 'session-id', 'chatgpt-account-id', 'content-type', 'accept', 'accept-encoding',
] as const;

/** One request `fakeResponses` saw: the method and path; `headers`, every header NAME, lower-cased, in the order
 *  sent; `values`, the value of each name in RESPONSES_HEADER_VALUES that was sent; `authorizationSha256`, the sha256
 *  hex of the authorization value (null when none was sent); and `body`, the body parsed as JSON (null when it is not
 *  an object). JSON.parse keeps a body's key order, so `Object.keys(body)` is the order the bridge wrote. */
export type ResponsesRequest = {
  method: string;
  path: string;
  headers: string[];
  values: Record<string, string>;
  authorizationSha256: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any> | null;
};

/** The path the fake answers, the backend adapter's RESPONSES_PATH under a base with no path of its own. */
export const RESPONSES_ROUTE = '/responses';

/** An in-process Responses backend on 127.0.0.1:0, for the backend adapter and the bridge's server (Tasks 7, 8).
 *  `POST /responses` takes the next answer of `script`; any other method or path is a 404 that takes none. Its
 *  `base` is what a test passes as CCGPT_BRIDGE_UPSTREAM_BASE. `close()` cancels every pending write and drops every
 *  open connection. */
export async function fakeResponses(
  script: ResponsesScript,
): Promise<{ base: string; requests: ResponsesRequest[]; close(): Promise<void> }> {
  const queue = [...script];
  const requests: ResponsesRequest[] = [];
  const timers = new Set<NodeJS.Timeout>();
  const later = (ms: number, fn: () => void): void => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
  };
  const answer = (res: ServerResponse, a: ResponsesAnswer): void => {
    if (a.sse !== undefined) {
      res.writeHead(a.status, { 'content-type': 'text/event-stream', ...(a.headers ?? {}) });
      if (typeof a.sse === 'string') {
        res.end(a.sse);
        return;
      }
      const { chunks, delayMs = 0, holdOpenMs = 0 } = a.sse;
      const step = (i: number): void => {
        if (res.destroyed) return;
        if (i < chunks.length) {
          res.write(chunks[i]);
          later(delayMs, () => step(i + 1));
          return;
        }
        later(holdOpenMs, () => { if (!res.destroyed) res.end(); });
      };
      step(0);
      return;
    }
    const text = typeof a.body === 'string' ? a.body : a.body === undefined ? '' : JSON.stringify(a.body);
    res.writeHead(a.status, { 'content-type': 'application/json', ...(a.headers ?? {}) });
    res.end(text);
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const urlPath = (req.url ?? '/').split('?')[0];
      const names: string[] = [];
      for (let i = 0; i < req.rawHeaders.length; i += 2) names.push(req.rawHeaders[i].toLowerCase());
      const values: Record<string, string> = {};
      for (const n of RESPONSES_HEADER_VALUES) {
        const v = req.headers[n];
        if (typeof v === 'string') values[n] = v;
      }
      const auth = req.headers.authorization;
      let body: ResponsesRequest['body'] = null;
      try {
        const v: unknown = JSON.parse(text);
        body = v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
      } catch {
        body = null;
      }
      requests.push({
        method: req.method ?? '', path: urlPath, headers: names, values,
        authorizationSha256: typeof auth === 'string' ? createHash('sha256').update(auth).digest('hex') : null, body,
      });
      if (req.method !== 'POST' || urlPath !== RESPONSES_ROUTE) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'not_found' } }));
        return;
      }
      const a = queue.shift() ?? { status: 500, body: { error: { type: 'server_error', code: 'fake_responses_unscripted' } } };
      if (a.holdHeadMs) later(a.holdHeadMs, () => { if (!res.destroyed) answer(res, a); });
      else answer(res, a);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
