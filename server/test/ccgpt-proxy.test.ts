// server/test/ccgpt-proxy.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { type ChildProcess } from 'node:child_process';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pythonOrSkip, spawnPy, ccgptFile, PYSTUB_DIR } from './ccgptHarness';
import { mkTmp } from './tmpHelpers';

const PROXY_PORT = 45010;
const UPSTREAM_PORT = 45011;

// Fix round 2, finding 1: C-2's identity check ("the answer's lane must equal
// what THIS call expects") is necessary but not sufficient when "what this
// call expects" is a hardcoded shared string — the re-review demonstrated
// that a same-lane orphan left by an EARLIER run is then silently adopted (7
// passed where 9 should fail). "Give each case a distinct id" is a
// convention, and conventions get skipped: Tasks 3-9 will copy the plan's own
// two-argument `startPair(home, handler)` shape, and none of their six
// authors will be thinking about orphan adoption. So `startPair` below MINTS
// its own lane id and returns it — a caller cannot get this wrong because it
// never supplies one. `process.pid` (this vitest worker) plus a
// monotonically-increasing per-process counter is unique across every
// invocation within one run AND across runs on one box (a different run is a
// different pid): a leftover orphan can never coincide with the CURRENT
// process's own pid+counter pair, no matter what string it happens to
// answer.
let mintedLaneCount = 0;
function mintLane(): string {
  mintedLaneCount += 1;
  return `codex-a-${process.pid}-${mintedLaneCount}`;
}

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

/** A raw GET that preserves duplicate response headers exactly as received.
 *  Fix round 2, finding 2: `fetch`'s parsed `Headers` normalises/hides
 *  hop-by-hop duplication (the HTTP client manages `Connection` itself
 *  rather than exposing it faithfully), so proving "exactly one `Connection`
 *  line, not two" needs `node:http`'s `rawHeaders` — a flat [key, value,
 *  key, value, ...] array in receipt order, duplicates included. */
function rawGet(port: number, path: string): Promise<{ status: number | undefined; rawHeaders: string[] }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, rawHeaders: res.rawHeaders }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

/** Starts a recording upstream plus the shim. `env` extends the child's
 *  environment for whatever ELSE a later task's case needs — it can no
 *  longer set `CCGPT_ACCOUNT_ID`, `CCGPT_PROXY_PORT` or `CCGPT_LITELLM_PORT`
 *  (fix round 2, finding 1): those three are applied AFTER `...env`, the same
 *  "spread last, cannot be overridden by accident" shape `containedSpawnOptions`
 *  itself uses for HOME. The lane id specifically is MINTED here, not read
 *  from any argument, and returned to the caller — see `mintLane` above for
 *  why a convention was not enough. Returns once the shim has answered
 *  /ccgpt/lane as THIS lane, or throws with the child's own captured stderr
 *  if it dies first. */
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

  const lane = mintLane();
  const { child } = spawnPy(ccgptFile('ccgpt-proxy.py'), {
    home,
    env: {
      PYTHONPATH: PYSTUB_DIR,
      ...env,
      // Applied LAST, deliberately: a caller's own `env` — even one that
      // (by mistake or by copying an older example) sets `CCGPT_ACCOUNT_ID`
      // — cannot override the minted lane or the fixed port pair this file
      // owns.
      CCGPT_ACCOUNT_ID: lane,
      CCGPT_PROXY_PORT: String(PROXY_PORT),
      CCGPT_LITELLM_PORT: String(UPSTREAM_PORT),
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
    const { lane } = await startPair(home, (_req, _body, res) => { res.writeHead(200); res.end('{}'); });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/ccgpt/lane`);
    expect(await r.json()).toEqual({ lane });
  });

  // Fix round 2, finding 1, pin (a): the simple half of the ask — two
  // invocations, even back to back, never mint the same lane.
  it('mints a distinct lane id for every startPair invocation, even back to back', async () => {
    const home1 = mkTmp('ccgpt-proxy-mint-1-');
    const first = await startPair(home1, (_req, _body, res) => { res.writeHead(200); res.end('{}'); });
    const firstLane = first.lane;

    // Tear this child (and its upstream) down before starting the second —
    // both share the same PROXY_PORT/UPSTREAM_PORT pair, and the whole point
    // of minting is that reusing the pair back to back must still never
    // repeat an id.
    await new Promise<void>((resolve) => {
      const c = first.child;
      if (c.exitCode !== null || c.signalCode !== null) { resolve(); return; }
      c.once('close', () => resolve());
      c.kill('SIGKILL');
    });
    proc = null;
    if (upstream) { await new Promise<void>((r) => upstream!.close(() => r())); upstream = null; }

    const home2 = mkTmp('ccgpt-proxy-mint-2-');
    const second = await startPair(home2, (_req, _body, res) => { res.writeHead(200); res.end('{}'); });
    expect(second.lane).not.toBe(firstLane);
    expect(second.lane).toMatch(/^codex-a-\d+-\d+$/);
  });

  // Fix round 2, finding 1, pin (b): the re-review's own defeat, reproduced
  // with the REALISTIC version of the threat — not a hand-typed guess, but a
  // genuine orphan still answering an EARLIER call's own real, legitimately
  // minted lane id (standing in for a process the OS hasn't finished
  // reaping — round 1 measured an 8ms port-release window on an idle box —
  // or a supervisor that restarted it under stale state). Round 1's fix
  // ("require the answer's lane to equal what THIS call expects") was
  // defeated because a shared hardcoded lane made every call's "expects" the
  // same string; minting removes that, because each call's own expectation
  // is fresh every time, so an earlier call's real answer can never satisfy
  // a later one's poll.
  it('a stale orphan still answering an earlier call\'s own real lane id is never adopted by a later call', async () => {
    const home1 = mkTmp('ccgpt-proxy-mint-orphan-1-');
    const first = await startPair(home1, (_req, _body, res) => { res.writeHead(200); res.end('{}'); });
    const earlierLane = first.lane;

    await new Promise<void>((resolve) => {
      const c = first.child;
      if (c.exitCode !== null || c.signalCode !== null) { resolve(); return; }
      c.once('close', () => resolve());
      c.kill('SIGKILL');
    });
    proc = null;
    if (upstream) { await new Promise<void>((r) => upstream!.close(() => r())); upstream = null; }

    // Stand in for the orphan: a plain listener, still bound to the shim's
    // own port, still answering the FIRST call's genuine lane id.
    const orphan = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ lane: earlierLane }));
    });
    await new Promise<void>((r) => orphan.listen(PROXY_PORT, '127.0.0.1', () => r()));
    try {
      const home2 = mkTmp('ccgpt-proxy-mint-orphan-2-');
      await expect(
        startPair(home2, (_req, _body, res) => { res.writeHead(200); res.end('{}'); }),
      ).rejects.toThrow();
    } finally {
      await new Promise<void>((r) => orphan.close(() => r()));
    }
  });

  it('forwards a non-/messages request byte-identically and returns the upstream response unchanged', async () => {
    const home = mkTmp('ccgpt-proxy-pass-');
    let seen: Buffer | null = null;
    let seenPath = '';
    await startPair(home, (req, body, res) => {
      seen = body; seenPath = req.url;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
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
    let seenHeaders: Record<string, string | string[] | undefined> = {};
    await startPair(home, (req, _body, res) => {
      seenHeaders = req.headers;
      res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok');
    });
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

  // Fix round 2, finding 2 — my own error from round 1, corrected by the
  // re-review: I argued `connection` couldn't be pinned because
  // `urllib.request` forces `Connection: close` on the REQUEST regardless of
  // what the shim strips (true, and still true — see the previous test's
  // comment). What I hadn't checked is the RESPONSE: an upstream answers
  // with its OWN `Connection` header (a real HTTP/1.1 server does this by
  // default — measured directly against Node's own `http.createServer`,
  // this suite's own upstream shape, which defaults to `Connection:
  // keep-alive` and answers `Connection: close` once it sees a
  // closed-connection request, exactly what the shim's own forced-closed
  // request produces). If `HOP_BY_HOP` ever stopped excluding `connection`
  // on the response-copying loop, that upstream header would be forwarded
  // IN ADDITION to the shim's own explicit
  // `self.send_header("Connection", "close")` a few lines later — two lines
  // on the wire, not one. `fetch`'s parsed `Headers` hides this (the HTTP
  // client manages `Connection` itself), so this reads `rawHeaders` via
  // `node:http` directly, which preserves duplicates exactly as received.
  it('sends exactly one Connection header on the response, never a duplicate of the upstream\'s own', async () => {
    const home = mkTmp('ccgpt-proxy-connection-response-');
    await startPair(home, (_req, _body, res) => {
      // Deliberately NOT setting `connection` here — Node's own http server
      // supplies a real one on its own (measured), which is exactly the
      // realistic shape: the shim must not simply trust that upstream never
      // sends one.
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    const { status, rawHeaders } = await rawGet(PROXY_PORT, '/v1/models');
    expect(status).toBe(200);
    const connectionLines = rawHeaders
      .filter((_, i) => i % 2 === 0)
      .filter((key) => key.toLowerCase() === 'connection');
    expect(connectionLines.length).toBe(1);
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

  // Fix round 2, finding 5 — M-5 shipped code-only in round 1. HEAD/OPTIONS
  // used to answer a bare 501 from `BaseHTTPRequestHandler`'s own default,
  // which made "everything else forwarded untouched" not literally true.
  it.each(['HEAD', 'OPTIONS'] as const)('forwards a %s request instead of answering a bare 501', async (method) => {
    const home = mkTmp(`ccgpt-proxy-verb-${method}-`);
    let seenMethod = '';
    await startPair(home, (req, _body, res) => {
      seenMethod = req.method;
      res.writeHead(204); res.end();
    });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/models`, { method });
    expect(r.status).not.toBe(501);
    expect(seenMethod).toBe(method);
  });

  // Fix round 2, finding 5 — M-4 shipped code-only in round 1: a bind
  // failure now prints a named ccrc-shaped message instead of a bare
  // socketserver traceback. Reproduced the same way C-2's foreign-listener
  // scenario is: pre-bind the port, then start a second shim on it.
  it('names the bind failure instead of a bare traceback when the port is already taken', async () => {
    const home1 = mkTmp('ccgpt-proxy-bindfail-holder-');
    const first = await startPair(home1, (_req, _body, res) => { res.writeHead(200); res.end('{}'); });
    void first; // keep the first shim alive, still holding PROXY_PORT

    const home2 = mkTmp('ccgpt-proxy-bindfail-second-');
    const { child: second } = spawnPy(ccgptFile('ccgpt-proxy.py'), {
      home: home2,
      env: {
        PYTHONPATH: PYSTUB_DIR,
        CCGPT_ACCOUNT_ID: mintLane(),
        CCGPT_PROXY_PORT: String(PROXY_PORT),
        CCGPT_LITELLM_PORT: String(UPSTREAM_PORT),
      },
    });
    let stderr = '';
    second.stderr?.on('data', (c) => { stderr += c.toString(); });
    const outcome = await raceExitOrDeadline(second);
    expect(outcome.kind).toBe('exited');
    expect(outcome.kind === 'exited' ? outcome.code : null).not.toBe(0);
    expect(stderr).toMatch(/ccgpt-proxy: failed to bind 127\.0\.0\.1:\d+/);
    expect(stderr).not.toMatch(/Traceback/);
    // `proc`/`upstream` (module-level) still point at the FIRST shim, so
    // `afterEach` tears that one down as usual; the second already exited.
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

describe.skipIf(!PY)('ccgpt-proxy: the mid-conversation system door', () => {
  it('converts a mid-conversation system turn to user, in place, both content shapes', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-mid-');
    let seen: any = null;
    await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-x', messages: [
          { role: 'user', content: 'first' },
          { role: 'system', content: 'a plain string instruction' },
          { role: 'assistant', content: 'ok' },
          { role: 'system', content: [{ type: 'text', text: 'a block instruction' }] },
        ],
      }),
    });
    expect(seen.messages.map((m: any) => m.role)).toEqual(['user', 'user', 'assistant', 'user']);
    expect(seen.messages[1].content).toBe('a plain string instruction');          // content untouched
    expect(seen.messages[3].content).toEqual([{ type: 'text', text: 'a block instruction' }]);
    expect(JSON.stringify(seen).includes('"role":"system"')).toBe(false);
  });

  // Fix round 1, I-1: `json.loads` on a sufficiently deep-nested body raises
  // `RecursionError`, which is a `RuntimeError` subclass — neither
  // `TypeError` nor `ValueError` — so it used to escape
  // `_rewrite_messages_body`'s except arm entirely and kill the connection
  // with no HTTP response at all (a full `socketserver` traceback in the
  // unit's journal, `RemoteDisconnected` at the client). This diff
  // introduced the regression: before it, the identical body was pure
  // passthrough and answered 200. Depth chosen to reliably exceed Python's
  // default recursion limit (measured: 2000 is not enough, 20000 is) without
  // depending on the exact crossover, which is an interpreter default and
  // therefore not something to pin exactly.
  it('a deeply-nested body does not drop the connection — the client still gets an HTTP response', async () => {
    const home = mkTmp('ccgpt-proxy-deepnest-');
    let seen: Buffer | null = null;
    await startPair(home, (_req, body, res) => {
      seen = body;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const depth = 20_000;
    const deeplyNested = '['.repeat(depth) + ']'.repeat(depth);
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: deeplyNested,
    });
    expect(r.status).toBe(200);
    // Unparseable (here: too deep to parse at all) — the arm returns the
    // body unrewritten, so it reaches upstream exactly as sent.
    expect(seen!.toString('utf8')).toBe(deeplyNested);
  });

  // Fix round 1, M-4: the rewrite predicate matched only the exact literal
  // `/v1/messages`, narrower than spec §6.4's "non-/messages paths" wording
  // and the reference implementation's `endswith("/messages")`. Measured by
  // the reviewer: a prefixed mount (`/gpt/v1/messages`) forwarded
  // `role:"system"` intact. Nothing in THIS repo pins the generated
  // launcher's base URL to an empty path, so this is not merely
  // hypothetical here.
  it('folds a mid-conversation system turn on a prefixed /messages path too', async () => {
    const home = mkTmp('ccgpt-proxy-mid-prefixed-');
    let seen: any = null;
    await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    await fetch(`http://127.0.0.1:${PROXY_PORT}/gpt/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-x', messages: [{ role: 'system', content: 'prefixed' }] }),
    });
    expect(seen.messages[0].role).toBe('user');
    expect(seen.messages[0].content).toBe('prefixed');
  });
});
