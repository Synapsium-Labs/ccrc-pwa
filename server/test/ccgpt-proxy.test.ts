// server/test/ccgpt-proxy.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pythonOrSkip, spawnPy, ccgptFile, PYSTUB_DIR } from './ccgptHarness';
import { mkTmp } from './tmpHelpers';

const LANE = 'codex-a';
const PROXY_PORT = 45010;
const UPSTREAM_PORT = 45011;

// Probed once at module scope, same shape as ccgpt-harness.test.ts: a
// missing interpreter must be a visible skip, not every case below quietly
// `return`ing and vitest reporting a green checkmark for work that never ran.
const PY = pythonOrSkip();

it('this box has a usable python3', () => {
  if (process.env.CI) expect(PY).toBeTruthy();
});

let proc: ChildProcess | null = null;
let upstream: Server | null = null;

afterEach(async () => {
  // Fix round 1, C-2 part 3: await the child's own `'close'` after
  // signalling, rather than firing SIGKILL and moving on. A fire-and-forget
  // kill let the very next case's readiness poll start while this one's
  // child (and its port) were still alive for a few more milliseconds —
  // ordinarily harmless, but it is also what made the vacuous-suite failure
  // mode possible in the first place (see `startPair`'s comment below).
  if (proc) {
    const p = proc;
    proc = null;
    await new Promise<void>((resolve) => {
      if (p.exitCode !== null || p.signalCode !== null) { resolve(); return; }
      p.once('close', () => resolve());
      p.kill('SIGKILL');
    });
  }
  if (upstream) { await new Promise<void>((r) => upstream!.close(() => r())); upstream = null; }
});

type SpawnOutcome = { kind: 'exited'; code: number | null } | { kind: 'still-serving' };

/** Bounds a wait for a spawned child's exit against a fixed deadline,
 *  producing a DISCRIMINATED outcome instead of letting a stuck child turn
 *  into vitest's own `testTimeout` (fix round 1, I-3). This repo already
 *  fights a load-flake class where a slow box sheds tests at exactly the
 *  deadline (`vitest.config.ts`), so a red that IS a timeout cannot tell "the
 *  guard is gone" from "the box is loaded" — and a loaded box would red the
 *  *unmutated* case too. 3s is roughly 1000x the measured real refusal
 *  (which exits before any socket is touched), so it cannot be starved by
 *  ordinary load the way a 20s deadline racing a `spawn` can. Listens for
 *  `'close'`, not `'exit'`: `'exit'` can fire before the last `data` chunk on
 *  `stderr` has been delivered, which would make the caller's captured
 *  stderr a race against its own assertion. */
function raceExitOrDeadline(child: ChildProcess, ms = 3_000): Promise<SpawnOutcome> {
  return Promise.race([
    new Promise<SpawnOutcome>((resolve) =>
      child.once('close', (code) => resolve({ kind: 'exited', code }))),
    new Promise<SpawnOutcome>((resolve) =>
      setTimeout(() => resolve({ kind: 'still-serving' }), ms)),
  ]);
}

/** Starts a recording upstream plus the shim. `env` overrides/extends the
 *  three required variables — a later task's case can omit one to test a
 *  refusal, or (as here) give the shim a lane id distinct from every other
 *  case's, which the readiness race below needs (C-2 part 2). Returns once
 *  the shim has answered /ccgpt/lane as THIS lane, or throws with the
 *  child's own captured stderr if it dies first. */
async function startPair(
  home: string,
  handler: (req: any, body: Buffer, res: any) => void,
  env: Record<string, string> = {},
): Promise<{ child: ChildProcess; lane: string }> {
  upstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => handler(req, Buffer.concat(chunks), res));
  });
  await new Promise<void>((r) => upstream!.listen(UPSTREAM_PORT, '127.0.0.1', () => r()));

  const lane = env.CCGPT_ACCOUNT_ID ?? LANE;
  const { child } = spawnPy(ccgptFile('ccgpt-proxy.py'), {
    home,
    env: {
      PYTHONPATH: PYSTUB_DIR,
      CCGPT_ACCOUNT_ID: lane,
      CCGPT_PROXY_PORT: String(PROXY_PORT),
      CCGPT_LITELLM_PORT: String(UPSTREAM_PORT),
      ...env,
    },
  });
  proc = child;

  let stderr = '';
  child.stderr?.on('data', (c) => { stderr += c.toString(); });
  let closed: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  child.once('close', (code, signal) => { closed = { code, signal }; });

  // Poll the lane endpoint rather than sleeping: a fixed sleep is a flake.
  //
  // Fix round 1, C-2: this used to accept the first `r.ok`, full stop — a
  // port answering was treated as proof this child was alive and correct.
  // Measured by the reviewer: pre-bind an unrelated listener on 45010 and
  // the whole suite reports "4 passed" in under a second while every one of
  // its own children died `EADDRINUSE` — a green suite that tested nothing.
  // Two fixes, both here: (1) race the poll against the child's own
  // `'close'`, so a child that dies (bind failure, crash) fails fast with
  // its captured stderr instead of a silent stall to the 5s bound; (2)
  // require the answer's `lane` field to equal the id THIS child was given,
  // so a foreign listener — or a stale sibling from a prior case that has
  // not released the port yet — cannot satisfy the poll merely by answering
  // *something*. The spec's own §7.4 refuses to adopt a listener that
  // answers another lane's id for exactly this reason; the harness that
  // tests that behaviour needs the same discipline.
  for (let i = 0; i < 100; i++) {
    if (closed) {
      const c: { code: number | null; signal: NodeJS.Signals | null } = closed;
      throw new Error(
        `ccgpt-proxy exited before answering its own /ccgpt/lane as ${JSON.stringify(lane)} ` +
        `(code=${c.code} signal=${c.signal}): ${stderr || '(no stderr)'}`,
      );
    }
    try {
      const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/ccgpt/lane`);
      if (r.ok) {
        const body: unknown = await r.json();
        if (body && typeof body === 'object' && (body as { lane?: unknown }).lane === lane) {
          return { child, lane };
        }
        // Answered, but not as THIS lane — a foreign or stale listener owns
        // the port right now. Keep polling rather than accepting an answer
        // that is not provably ours.
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`shim did not come up as lane ${JSON.stringify(lane)} (stderr: ${stderr || '(none)'})`);
}

describe.skipIf(!PY)('ccgpt-proxy: identity and passthrough', () => {
  it('answers /ccgpt/lane with its own lane id', async () => {
    const home = mkTmp('ccgpt-proxy-lane-');
    const lane = 'codex-a-identity';
    await startPair(home, (_req, _body, res) => { res.writeHead(200); res.end('{}'); }, { CCGPT_ACCOUNT_ID: lane });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/ccgpt/lane`);
    expect(await r.json()).toEqual({ lane });
  });

  it('forwards a non-/messages request byte-identically and returns the upstream response unchanged', async () => {
    const home = mkTmp('ccgpt-proxy-pass-');
    const lane = 'codex-a-passthrough';
    let seen: Buffer | null = null;
    let seenPath = '';
    await startPair(home, (req, body, res) => {
      seen = body; seenPath = req.url;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    }, { CCGPT_ACCOUNT_ID: lane });
    // Fix round 1, M-1: real non-ASCII bytes, not the pure-ASCII string this
    // case originally sent under a "weird bytes" comment that measured
    // false. `é`/` `/`ü` each encode to 2 UTF-8 bytes, so a
    // json.loads/json.dumps round trip inside the shim (there isn't one on
    // this path, but a regression could add one) would corrupt this payload
    // where a pure-ASCII one could not catch it.
    const payloadText = '{"weird":"é ü bytes","n":1}';
    const payload = Buffer.from(payloadText, 'utf8');
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/models`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: payload,
    });
    expect(r.status).toBe(200);
    expect(seenPath).toBe('/v1/models');
    expect(seen!.toString('utf8')).toBe(payloadText);   // byte-identical, not re-serialised

    // Fix round 1, M-6: passthrough is bidirectional — the request direction
    // was covered above, but the upstream's own response body and headers
    // coming back unchanged is the other half and was previously asserted
    // only by status code.
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(await r.text()).toBe('{"ok":true}');
  });

  it('drops hop-by-hop headers from the forwarded request while end-to-end headers survive', async () => {
    // Fix round 1, I-4: HOP_BY_HOP is a shipped guard with no test — deleting
    // the whole set, or dropping just `accept-encoding` (the member Task 6's
    // gzip/deflate handling depends on), left the suite 4/4 green.
    //
    // These three headers are never literally ABSENT on the wire — measured
    // directly against `urllib.request` (the shim's own HTTP client):
    // `http.client` always fills `Accept-Encoding` and `Host` with its own
    // neutral values whenever the shim does not forward an explicit one, and
    // forces `Connection: close` unconditionally regardless of what is
    // forwarded (an explicit `Connection: keep-alive` added to the outgoing
    // request is silently overridden to `close` either way — so `connection`
    // membership in HOP_BY_HOP is not independently observable at this
    // boundary and is not asserted here). So the meaningful assertion is not
    // "absent" but "not the client's chosen value":
    //   - `accept-encoding` must read Python's own default `identity`, not
    //     the client's requested `gzip, deflate` — if HOP_BY_HOP stopped
    //     excluding it, the client's value would reach upstream instead
    //     (measured: an explicitly-added Accept-Encoding header suppresses
    //     http.client's own default and wins outright).
    //   - `host` must read the actual upstream authority
    //     (127.0.0.1:<UPSTREAM_PORT>), not the address the CLIENT connected
    //     to (127.0.0.1:<PROXY_PORT>) — if HOP_BY_HOP stopped excluding it,
    //     the client's Host would be forwarded verbatim (measured: an
    //     explicitly-added Host header is NOT overridden by http.client, so
    //     a forwarded client Host would silently misdirect a real
    //     vhost-routing upstream).
    const home = mkTmp('ccgpt-proxy-hopbyhop-');
    const lane = 'codex-a-hopbyhop';
    let seenHeaders: Record<string, string | string[] | undefined> = {};
    await startPair(home, (req, _body, res) => {
      seenHeaders = req.headers;
      res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok');
    }, { CCGPT_ACCOUNT_ID: lane });
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/models`, {
      headers: {
        authorization: 'Bearer test-token-not-a-secret',
        'accept-encoding': 'gzip, deflate',
      },
    });
    // End-to-end: describes the MESSAGE, must survive unchanged.
    expect(seenHeaders['authorization']).toBe('Bearer test-token-not-a-secret');
    // Hop-by-hop: the client's own value must not reach upstream.
    expect(seenHeaders['accept-encoding']).toBe('identity');
    expect(seenHeaders['host']).toBe(`127.0.0.1:${UPSTREAM_PORT}`);
  });

  // Fix round 1, Question 2's rider: the hoisted `spawnPy` ships with its own
  // pin in THIS file too, not only in ccgpt-harness.test.ts — a child started
  // through it, by the shim's own real spawn site in `startPair`'s shape,
  // must see the fixture HOME even when the caller spreads `process.env`.
  it('a child spawned through spawnPy keeps the fixture HOME even when the caller spreads process.env', async () => {
    const home = mkTmp('ccgpt-proxy-spawnpy-home-');
    const probe = join(home, 'probe.py');
    writeFileSync(probe, 'import os\nprint(os.environ["HOME"])\n');
    const { child } = spawnPy(probe, { home, env: { ...process.env, FOO: '1' } });
    proc = child;
    let stdout = '';
    child.stdout?.on('data', (c) => { stdout += c.toString(); });
    await new Promise<void>((resolve) => child.once('close', () => resolve()));
    proc = null;
    expect(stdout.trim()).toBe(home);
  });

  // Fix round 1, M-3 (second half): only CCGPT_LITELLM_PORT's refusal was
  // pinned; the docstring's actual claim is that all three are required.
  it.each(['CCGPT_ACCOUNT_ID', 'CCGPT_PROXY_PORT', 'CCGPT_LITELLM_PORT'] as const)(
    'refuses to start when %s is unset, naming the missing variable',
    async (missing) => {
      const home = mkTmp(`ccgpt-proxy-nodefault-${missing}-`);
      const fullEnv: Record<string, string> = {
        PYTHONPATH: PYSTUB_DIR,
        CCGPT_ACCOUNT_ID: 'codex-a-nodefault',
        CCGPT_PROXY_PORT: String(PROXY_PORT),
        CCGPT_LITELLM_PORT: String(UPSTREAM_PORT),
      };
      delete fullEnv[missing];
      const { child } = spawnPy(ccgptFile('ccgpt-proxy.py'), { home, env: fullEnv });
      proc = child;
      let stderr = '';
      child.stderr?.on('data', (c) => { stderr += c.toString(); });

      const outcome = await raceExitOrDeadline(child);
      if (outcome.kind === 'exited') proc = null; // else: still alive — afterEach kills+awaits it.
      expect(outcome.kind).toBe('exited');
      expect(outcome.kind === 'exited' ? outcome.code : null).not.toBe(0);
      expect(stderr).toMatch(new RegExp(missing));
    },
  );

  // Fix round 1, M-3 (first half): a non-numeric port used to escape as a
  // bare `ValueError` traceback rather than the shim's own named refusal.
  it('refuses to start with a named message when CCGPT_PROXY_PORT is not a valid port number', async () => {
    const home = mkTmp('ccgpt-proxy-badport-');
    const { child } = spawnPy(ccgptFile('ccgpt-proxy.py'), {
      home,
      env: {
        PYTHONPATH: PYSTUB_DIR,
        CCGPT_ACCOUNT_ID: 'codex-a-badport',
        CCGPT_PROXY_PORT: 'not-a-port',
        CCGPT_LITELLM_PORT: String(UPSTREAM_PORT),
      },
    });
    proc = child;
    let stderr = '';
    child.stderr?.on('data', (c) => { stderr += c.toString(); });

    const outcome = await raceExitOrDeadline(child);
    if (outcome.kind === 'exited') proc = null;
    expect(outcome.kind).toBe('exited');
    expect(outcome.kind === 'exited' ? outcome.code : null).not.toBe(0);
    expect(stderr).toMatch(/CCGPT_PROXY_PORT/);
    expect(stderr).not.toMatch(/Traceback/);
  });
});
