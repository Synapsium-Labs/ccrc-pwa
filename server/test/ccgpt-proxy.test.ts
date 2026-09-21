// server/test/ccgpt-proxy.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { type ChildProcess } from 'node:child_process';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { connect as netConnect } from 'node:net';
import { writeFileSync, mkdirSync, utimesSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { gzipSync, gunzipSync, deflateSync, inflateSync } from 'node:zlib';
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

/** Sends a hand-framed `Transfer-Encoding: chunked` POST over a raw
 *  `node:net` socket — `fetch` cannot produce malformed chunk framing
 *  (bad hex size, negative size, missing CRLF, a short chunk), it can only
 *  produce well-formed chunked bodies (task-7a-rulings.md's interface
 *  note). Writes the request head, then the raw (possibly malformed) body
 *  bytes verbatim, then half-closes (`socket.end()`) — every framing this
 *  file sends either raises inside `_read_chunked_body` on bytes already
 *  in flight, or (the short-chunk case) needs the half-close's EOF to turn
 *  a would-be-indefinite `rfile.read(size)` into a short, immediate read.
 *  Resolves once the server closes its end, with whatever bytes arrived —
 *  including zero bytes, the shape a dropped connection with no HTTP
 *  response produces, so a caller can tell "refused with a real response"
 *  from "connection dropped" by parsing what comes back rather than by
 *  racing a timeout. */
function rawChunkedPost(port: number, path: string, rawBody: Buffer): Promise<{ status: number | null; body: string }> {
  return new Promise((resolve, reject) => {
    const sock = netConnect(port, '127.0.0.1', () => {
      const head =
        `POST ${path} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        `Content-Type: application/json\r\n` +
        `Transfer-Encoding: chunked\r\n` +
        `Connection: close\r\n` +
        `\r\n`;
      sock.write(head, 'latin1');
      sock.write(rawBody);
      sock.end();
    });
    const chunks: Buffer[] = [];
    sock.on('data', (c) => chunks.push(c));
    sock.on('end', () => {
      const raw = Buffer.concat(chunks).toString('latin1');
      const sep = raw.indexOf('\r\n\r\n');
      if (sep === -1) { resolve({ status: null, body: '' }); return; }
      const statusLine = raw.slice(0, sep).split('\r\n')[0];
      const status = Number(statusLine.split(' ')[1]);
      resolve({ status: Number.isFinite(status) ? status : null, body: raw.slice(sep + 4) });
    });
    sock.on('error', reject);
    const guard = setTimeout(() => reject(new Error('rawChunkedPost timed out')), 5_000);
    sock.on('close', () => clearTimeout(guard));
  });
}

/** General-purpose raw-socket request (fix round 1: M-1's bad
 *  `Content-Length` and M-3's HEAD-suppression case both need a method
 *  and/or headers `rawChunkedPost` doesn't expose — an arbitrary method,
 *  arbitrary headers, and no forced `Transfer-Encoding: chunked`). Returns
 *  the parsed status line's headers too, not only the body, because M-3
 *  needs to see `Content-Length` while asserting the body bytes are empty.
 *  Same "resolve on close, even with zero bytes" shape as `rawChunkedPost`
 *  — a dropped connection with no response parses to `status: null` rather
 *  than hanging on a timeout. */
function rawRequest(
  port: number, method: string, path: string, headers: string[], body: Buffer,
): Promise<{ status: number | null; headers: string[]; body: string }> {
  return new Promise((resolve, reject) => {
    const sock = netConnect(port, '127.0.0.1', () => {
      const head =
        `${method} ${path} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        headers.map((h) => `${h}\r\n`).join('') +
        `Connection: close\r\n` +
        `\r\n`;
      sock.write(head, 'latin1');
      if (body.length) sock.write(body);
      sock.end();
    });
    const chunks: Buffer[] = [];
    sock.on('data', (c) => chunks.push(c));
    sock.on('end', () => {
      const raw = Buffer.concat(chunks).toString('latin1');
      const sep = raw.indexOf('\r\n\r\n');
      if (sep === -1) { resolve({ status: null, headers: [], body: '' }); return; }
      const headLines = raw.slice(0, sep).split('\r\n');
      const status = Number(headLines[0].split(' ')[1]);
      resolve({ status: Number.isFinite(status) ? status : null, headers: headLines.slice(1), body: raw.slice(sep + 4) });
    });
    sock.on('error', reject);
    const guard = setTimeout(() => reject(new Error('rawRequest timed out')), 5_000);
    sock.on('close', () => clearTimeout(guard));
  });
}

/** Frames arbitrary bytes as a single well-formed HTTP/1.1 chunk (RFC 7230
 *  §4.1), for the task-7b cases that need a hand-built chunked body but,
 *  unlike `rawChunkedPost`'s malformed-framing cases, still want it to
 *  PARSE correctly — `fetch` cannot combine a raw-socket header shape
 *  (split/list `Transfer-Encoding`, an extra trailer line) with a
 *  chunked-encoded body of its own choosing, so this is sent through
 *  `rawRequest` instead, which sends its `body` argument verbatim. `ext`,
 *  when given, reproduces a chunk-extension (`size;ext\r\n...`, M15) —
 *  RFC 7230 §4.1.1 syntax, ignored by every real recipient that doesn't
 *  define it, including this shim, which is the point of M15's guard. */
function chunkEncode(data: Buffer, ext?: string): Buffer {
  const sizeLine = `${data.length.toString(16)}${ext ? `;${ext}` : ''}\r\n`;
  return Buffer.concat([
    Buffer.from(sizeLine, 'latin1'), data, Buffer.from('\r\n'),
    Buffer.from('0\r\n\r\n'),
  ]);
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

/** The lane's own effort file path — `~/.ccrc/models/<id>.effort.json`, the
 *  same path `deploy/models-op.mjs`'s `effortPath` and the materialiser
 *  (`effortFile`, `shared/modelenv.mjs`) write, keyed by ACCOUNT id (here,
 *  the fixture's own minted `lane`), never by model: one lane, one file,
 *  holding every model that lane can reach. */
function effortFilePath(home: string, lane: string): string {
  return join(home, '.ccrc', 'models', `${lane}.effort.json`);
}

/** Writes `{"byModel": byModel}` to the lane's own effort file, creating
 *  `~/.ccrc/models` first (`writeFileSync` does not create parent
 *  directories). When `mtimeSeconds` is given, the file's mtime is pinned
 *  EXACTLY via `fs.utimesSync` rather than left to whatever the write
 *  itself produces (task-8-rulings.md §2): a same-second rewrite may not
 *  move mtime at all on some filesystems, and both halves of the cache case
 *  below depend on mtime being precisely what the test intends, not
 *  incidental to when it happened to run on a box carrying ~20 live
 *  sessions. */
function writeEffortFile(
  home: string, lane: string, byModel: Record<string, string>, mtimeSeconds?: number,
): void {
  const p = effortFilePath(home, lane);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ byModel }));
  if (mtimeSeconds !== undefined) utimesSync(p, mtimeSeconds, mtimeSeconds);
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
  // unit's journal, `RemoteDisconnected` at the client). Depth chosen to
  // reliably exceed Python's default recursion limit (measured: 2000 is not
  // enough, 20000 is) without depending on the exact crossover, which is an
  // interpreter default and therefore not something to pin exactly.
  //
  // Task 7a (D-3151, arms 1+2 of 3, CLOSED): this body used to be pure
  // passthrough — forwarded unrewritten, `system` intact had there been
  // one — and is now refused explicitly instead. The assertion this case
  // exists for is unchanged (the connection is not dropped, the client
  // gets a real HTTP response); only WHICH response changed, from a 200
  // passthrough to a 400 refusal.
  it('a deeply-nested body does not drop the connection — it is refused explicitly, not forwarded', async () => {
    const home = mkTmp('ccgpt-proxy-deepnest-');
    let reached = false;
    await startPair(home, (_req, _body, res) => {
      reached = true;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const depth = 20_000;
    const deeplyNested = '['.repeat(depth) + ']'.repeat(depth);
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: deeplyNested,
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/malformed json/i);
    expect(reached).toBe(false);                                 // upstream never saw it
  });

  // D-3151, arm 2 of 3, CLOSED: valid JSON whose top level is not an
  // object (a bare array carries no `messages` key and cannot be routed as
  // an Anthropic request either) used to forward unrewritten; now refused.
  it('refuses a body whose top-level JSON value is not an object', async () => {
    const home = mkTmp('ccgpt-proxy-nonobject-');
    let reached = false;
    await startPair(home, (_req, _body, res) => {
      reached = true;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify([1, 2, 3]),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/not an object/i);
    expect(reached).toBe(false);
  });

  // D-3151, arm 3 of 3, CLOSED (`_fold_midturn_system`'s own guard): a
  // `messages` field present but not a list — e.g. a dict — used to
  // forward `data` unmodified, leaving any `role: "system"`-shaped entry
  // nested inside it untouched. Now refused. A `grep` for `return body`
  // alone would not have found this arm (it returns `data`); this case is
  // the behavioural proof the plan's D-3151 entry asked for.
  it('refuses a body whose messages field is present but not a list', async () => {
    const home = mkTmp('ccgpt-proxy-messagesnotlist-');
    let reached = false;
    await startPair(home, (_req, _body, res) => {
      reached = true;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-x', messages: { role: 'system', content: 'not a list' } }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/messages.*not a list/i);
    expect(reached).toBe(false);
  });

  // task-7a-rulings.md §6, the over-correction guard (durable version:
  // spec §6.4, "what does not change" — byte-identical forwarding of
  // non-`/messages` paths): an over-broad refusal breaking the lane is a
  // worse failure than the one this task fixes. A malformed JSON body on a
  // NON-`/messages` path is not this task's subject at all — it must still
  // forward untouched and still
  // reach upstream, exactly as every other non-`/messages` body always has.
  it('still forwards a malformed JSON body untouched on a non-/messages path (regression)', async () => {
    const home = mkTmp('ccgpt-proxy-nonmessages-malformed-');
    let seen: Buffer | null = null;
    await startPair(home, (_req, body, res) => {
      seen = body;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const notJson = 'this is not json at all {{{';
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/models`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: notJson,
    });
    expect(r.status).toBe(200);                                  // forwarded, not refused
    expect(seen!.toString('utf8')).toBe(notJson);                 // byte-identical
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

describe.skipIf(!PY)('ccgpt-proxy: the top-level system door', () => {
  // Fix round 1 (D-3152): the plan's original test asserted an INSERT-only
  // fold — two separate messages. Measurement (task-4-commutativity.md)
  // showed insert-only makes the two folds commute on every tested input,
  // so no order mutation could ever bind against it. Production's real
  // `_fold_system` MERGES into an existing leading `user` message instead of
  // always inserting, and that merge branch is what makes order genuinely
  // load-bearing: mid-turn conversion must run FIRST so a leading
  // `role: "system"` entry has already become `user` by the time this fold
  // looks — landing the top-level text first, folded INTO that turn. Run
  // reversed, `messages[0].role` is still `"system"`, the merge branch's own
  // check is false, and the INSERT branch fires instead — a structurally
  // different body, not a cosmetic reordering.
  it('merges the top-level system into a converted first turn, top-level text first', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-top-');
    let seen: any = null;
    await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-x',
        system: 'TOP LEVEL',
        messages: [{ role: 'system', content: 'WAS MID TURN' }],
      }),
    });
    expect('system' in seen).toBe(false);                       // the key is gone, not emptied
    // ONE message, not two: the top-level text folds INTO the converted
    // first turn rather than becoming a sibling entry.
    expect(seen.messages.map((m: any) => m.role)).toEqual(['user']);
    expect(seen.messages[0].content).toBe('TOP LEVEL\n\nWAS MID TURN');
  });

  // The other half of the hybrid: when the conversation's own first message
  // is NOT already `user` (no mid-turn system entry converted it, or there
  // simply isn't one), `_fold_system` inserts a new leading turn instead of
  // merging into something it must not silently absorb (an `assistant`
  // turn's own words are not the sender's system instruction).
  it('inserts a new leading turn when the first message is not user', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-top-insert-');
    let seen: any = null;
    await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-x',
        system: 'TOP LEVEL',
        messages: [{ role: 'assistant', content: 'hi' }],
      }),
    });
    expect('system' in seen).toBe(false);
    expect(seen.messages).toEqual([
      { role: 'user', content: 'TOP LEVEL' },
      { role: 'assistant', content: 'hi' },
    ]);
  });

  // Insert branch's other trigger: no first message to merge into at all.
  it('inserts a new leading turn when messages is empty', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-top-insert-empty-');
    let seen: any = null;
    await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-x', system: 'TOP LEVEL', messages: [] }),
    });
    expect('system' in seen).toBe(false);
    expect(seen.messages).toEqual([{ role: 'user', content: 'TOP LEVEL' }]);
  });

  // Fix round 1, C-1 (Critical): `messages` ABSENT entirely — not the same
  // condition as `messages: []` above (a present, empty list) — used to be
  // swallowed by `_fold_midturn_system`'s `not isinstance(msgs, list)`
  // check (`data.get("messages")` returns `None` for an absent key) and
  // refused 400 with a message that said "'messages' is present but not a
  // list" about a key that was not there at all. This is the exact
  // over-refusal task-7a-rulings.md §6 exists to prevent: the shim knows
  // exactly how to fold this body (spec §6.1 item 2), and a `messages` key
  // that does not exist cannot hide an unfolded mid-turn `system` entry
  // either, so refusing it bought nothing.
  it('folds a body with only a top-level system and no messages key at all', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-top-nomessages-');
    let seen: any = null;
    await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-x', system: 'TOP LEVEL' }),
    });
    expect(r.status).toBe(200);
    expect('system' in seen).toBe(false);
    expect(seen.messages).toEqual([{ role: 'user', content: 'TOP LEVEL' }]);
  });

  // The other half of C-1: an EXPLICIT `messages: null` is the same
  // `data.get("messages") is None` condition as absent, and must fold
  // identically, not refuse.
  it('folds a body with a top-level system and an explicit null messages', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-top-nullmessages-');
    let seen: any = null;
    await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-x', system: 'TOP LEVEL', messages: null }),
    });
    expect(r.status).toBe(200);
    expect('system' in seen).toBe(false);
    expect(seen.messages).toEqual([{ role: 'user', content: 'TOP LEVEL' }]);
  });

  // Binds the design decision the brief asks to be made deliberately:
  // `system` may be absent, null, an empty string, or a content-block list
  // with no usable text. Codex refuses the FIELD itself, not merely a
  // non-empty value of it, so the key must still be dropped — but an empty
  // instruction carries nothing to place ahead of the conversation, and
  // inventing a leading empty user turn would be a message the sender never
  // wrote.
  it('drops an empty or null system without inventing a leading turn', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-top-empty-');
    let seen: any = null;
    await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-x',
        system: null,
        messages: [{ role: 'user', content: 'only turn' }],
      }),
    });
    expect('system' in seen).toBe(false);
    expect(seen.messages).toEqual([{ role: 'user', content: 'only turn' }]);
  });

  // Both `system` content shapes fold (plain string or content-block list,
  // the same contract as a mid-turn entry's content), and the MERGE branch
  // itself has two content shapes on the receiving end: a string first turn
  // (covered above) and a content-block-list first turn, covered here — the
  // folded text becomes a new leading block rather than a string concat.
  it('merges a block-shaped top-level system into an existing block-content leading user turn', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-top-blocks-');
    let seen: any = null;
    await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-x',
        system: [{ type: 'text', text: 'BLOCK INSTRUCTION' }],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'existing block' }] }],
      }),
    });
    expect('system' in seen).toBe(false);
    expect(seen.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'BLOCK INSTRUCTION' },
          { type: 'text', text: 'existing block' },
        ],
      },
    ]);
  });
});

describe.skipIf(!PY)('ccgpt-proxy: chunked request bodies', () => {
  // Task 5: `_relay` used to read Content-Length only. A request arriving
  // with `Transfer-Encoding: chunked` (no Content-Length at all) forwarded
  // with NO body — measured: the upstream received 0 bytes. Node's `fetch`
  // sends a `ReadableStream` body chunked, which is how this case produces
  // the shape without hand-framing; `duplex: 'half'` is what Node requires
  // for a stream body.
  it('decodes a chunked body, rewrites it, and forwards a correct length', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-chunked-');
    let seen: Buffer | null = null; let seenTE = ''; let seenCL = '';
    await startPair(home, (req, body, res) => {
      seen = body;
      seenTE = String(req.headers['transfer-encoding'] ?? '');
      seenCL = String(req.headers['content-length'] ?? '');
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const payload = JSON.stringify({ model: 'gpt-x', system: 'TOP', messages: [{ role: 'system', content: 'MID' }] });
    const stream = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(payload.slice(0, 20)));
                 c.enqueue(new TextEncoder().encode(payload.slice(20))); c.close(); },
    });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: stream, duplex: 'half',
    } as any);
    expect(r.status).toBe(200);
    expect(seen!.length).toBeGreaterThan(0);                    // the hole: this was 0
    const got = JSON.parse(seen!.toString('utf8'));
    expect('system' in got).toBe(false);                        // it was rewritten, not just relayed
    expect(got.messages.every((m: any) => m.role !== 'system')).toBe(true);
    // M1 (task-7b-rulings.md §4): `expect(seenCL).toBe(String(seen!.length))`
    // cannot fail — Node's HTTP server reads EXACTLY `Content-Length` body
    // bytes, so `seen.length` and the received `Content-Length` are equal
    // by construction whenever this line is even reached; the review
    // measured both directions (inflating the header times the case out,
    // deflating it reds on `seen` being `null`) and neither makes THIS
    // assertion itself fire. Replaced with the rewritten payload's byte
    // length computed INDEPENDENTLY here — not derived from `seen` — so a
    // wrong `Content-Length` (one that doesn't match what `_rewrite_
    // messages_body` actually produces for this exact input) has something
    // to red against. Verified directly against this box's own
    // `_rewrite_messages_body` while writing this case, not hand-derived:
    // `{"model": "gpt-x", "messages": [{"role": "user", "content":
    // "TOP\n\nMID"}]}`, 75 bytes — `json.dumps`'s default `', '`/`': '`
    // separators (not JSON.stringify's compact ones), the top-level
    // `system`->leading-`user`-turn merge, and `\n\n` appearing as the
    // two-character escape `\n` twice, not a literal newline byte.
    const expectedRewritten = '{"model": "gpt-x", "messages": [{"role": "user", "content": "TOP\\n\\nMID"}]}';
    expect(Buffer.byteLength(expectedRewritten, 'utf8')).toBe(75);
    expect(seenCL).toBe(String(Buffer.byteLength(expectedRewritten, 'utf8')));
    expect(seenTE).toBe('');                                    // re-framed, not re-chunked
  });
});

describe.skipIf(!PY)('ccgpt-proxy: malformed chunked framing is refused explicitly (Task 7a §4)', () => {
  // Task 7a: `_read_chunked_body` raising `ValueError` used to escape
  // `_relay` uncaught and drop the connection with no HTTP response — the
  // shape Task 5's own module note originally argued was correct for this
  // different failure surface. That design is superseded here: every one
  // of these four framings — the three `raise ValueError` sites the
  // paired Tasks 5+6 review measured as pinned by nothing, plus the
  // short-chunk guard — now earns an explicit 400, and the invariant
  // (upstream is never reached) is asserted in every case, not only the
  // status code.
  //
  // `fetch` cannot produce any of these — it only ever sends well-formed
  // chunked bodies — so each is hand-framed over a raw `node:net` socket
  // (`rawChunkedPost` above).

  it('refuses a chunk-size line that is not valid hex', async () => {
    const home = mkTmp('ccgpt-proxy-chunk-badhex-');
    let reached = false;
    await startPair(home, (_req, _body, res) => {
      reached = true;
      res.writeHead(200); res.end('{}');
    });
    const { status, body } = await rawChunkedPost(PROXY_PORT, '/v1/models', Buffer.from('zz\r\nhello\r\n0\r\n\r\n', 'latin1'));
    expect(status).toBe(400);
    expect(JSON.parse(body).error).toMatch(/hex/i);
    expect(reached).toBe(false);                                 // the invariant, not just the status
  });

  it('refuses a negative declared chunk size', async () => {
    const home = mkTmp('ccgpt-proxy-chunk-negsize-');
    let reached = false;
    await startPair(home, (_req, _body, res) => {
      reached = true;
      res.writeHead(200); res.end('{}');
    });
    const { status, body } = await rawChunkedPost(PROXY_PORT, '/v1/models', Buffer.from('-1\r\nhello\r\n0\r\n\r\n', 'latin1'));
    expect(status).toBe(400);
    expect(JSON.parse(body).error).toMatch(/negative/i);
    expect(reached).toBe(false);
  });

  it('refuses a chunk missing its terminating CRLF', async () => {
    const home = mkTmp('ccgpt-proxy-chunk-nocrlf-');
    let reached = false;
    await startPair(home, (_req, _body, res) => {
      reached = true;
      res.writeHead(200); res.end('{}');
    });
    // "5\r\n" declares 5 bytes; "hello" supplies exactly 5; "XX" stands
    // where the mandatory CRLF must be.
    const { status, body } = await rawChunkedPost(PROXY_PORT, '/v1/models', Buffer.from('5\r\nhelloXX0\r\n\r\n', 'latin1'));
    expect(status).toBe(400);
    expect(JSON.parse(body).error).toMatch(/crlf/i);
    expect(reached).toBe(false);
  });

  it('refuses a chunk declared longer than what was actually sent', async () => {
    const home = mkTmp('ccgpt-proxy-chunk-short-');
    let reached = false;
    await startPair(home, (_req, _body, res) => {
      reached = true;
      res.writeHead(200); res.end('{}');
    });
    // "a" (hex) declares 10 bytes; only 3 ("abc") are ever sent, and
    // `rawChunkedPost` half-closes right after — the EOF is what turns
    // `rfile.read(10)` into an immediate short read instead of an
    // indefinite hang waiting for the other 7 bytes.
    const { status, body } = await rawChunkedPost(PROXY_PORT, '/v1/models', Buffer.from('a\r\nabc', 'latin1'));
    expect(status).toBe(400);
    expect(JSON.parse(body).error).toMatch(/truncated/i);
    expect(reached).toBe(false);
  });

  // Fix round 1, M-1: `_read_request_body` raises `ValueError` from a
  // SECOND site too, on the non-chunked path — `int(Content-Length)`. The
  // fix wraps it with a `ccgpt-proxy:`-prefixed message (it was the only
  // refusal in the file that didn't name the shim) and corrects the
  // docstring's "from `_read_chunked_body`" claim, which named only the
  // first of its two raisers.
  it('refuses a non-numeric Content-Length with a named, ccgpt-proxy-prefixed message', async () => {
    const home = mkTmp('ccgpt-proxy-badcl-');
    let reached = false;
    await startPair(home, (_req, _body, res) => {
      reached = true;
      res.writeHead(200); res.end('{}');
    });
    const { status, body } = await rawRequest(PROXY_PORT, 'POST', '/v1/models', [
      'Content-Type: application/json',
      'Content-Length: abc',
    ], Buffer.alloc(0));
    expect(status).toBe(400);
    const parsed = JSON.parse(body);
    expect(parsed.error).toMatch(/^ccgpt-proxy:/);
    expect(parsed.error).toMatch(/content-length/i);
    expect(reached).toBe(false);
  });

  // Fix round 1, M-3: `_refuse` used to write the JSON body unconditionally,
  // unlike `send_error` (which suppresses the body — but not the headers
  // describing it — for a HEAD request, per RFC 7231 §4.3.2). `do_HEAD =
  // _relay`, so a HEAD request can reach a refusal (malformed chunked
  // framing is the easiest to reproduce over a raw socket). Harmless in
  // practice (`Connection: close`), but a protocol wart worth pinning.
  it('suppresses the refusal body on a HEAD request but still sends a matching Content-Length', async () => {
    const home = mkTmp('ccgpt-proxy-head-refuse-');
    let reached = false;
    await startPair(home, (_req, _body, res) => {
      reached = true;
      res.writeHead(200); res.end('{}');
    });
    const { status, headers, body } = await rawRequest(PROXY_PORT, 'HEAD', '/v1/models', [
      'Content-Type: application/json',
      'Transfer-Encoding: chunked',
    ], Buffer.from('zz\r\nhello\r\n0\r\n\r\n', 'latin1'));
    expect(status).toBe(400);
    const cl = headers.find((h) => /^content-length:/i.test(h));
    expect(cl).toBeDefined();
    expect(Number(cl!.split(':')[1].trim())).toBeGreaterThan(0);   // headers still describe the real body
    expect(body).toBe('');                                          // but HEAD gets no body bytes
    expect(reached).toBe(false);
  });
});

describe.skipIf(!PY)('ccgpt-proxy: gzip/deflate request bodies', () => {
  // Task 6: on a gzip body, the OLD code's `json.loads` raised
  // `UnicodeDecodeError` (a `ValueError` subclass), and the
  // `except ValueError: return body` arm forwarded the body UNREWRITTEN —
  // the compressed bytes still contain `"system"`. Unlike the chunked
  // defect (Task 5, which lost the body entirely), this is the ORIGINAL
  // sticky-replay hazard reaching the Codex backend, still correctly
  // labelled `Content-Encoding: gzip` so upstream's own decode finds
  // `system` right there. `deflate` shares the identical shape through the
  // same except arm.
  const ENCODINGS: [string, (b: Buffer) => Buffer, (b: Buffer) => Buffer][] = [
    ['gzip', gzipSync, gunzipSync],
    ['deflate', deflateSync, inflateSync],
  ];

  it.each(ENCODINGS)('decodes a %s body, rewrites it, and re-encodes it', async (enc, pack, unpack) => {
    if (!pythonOrSkip()) return;
    const home = mkTmp(`ccgpt-proxy-${enc}-`);
    let seen: Buffer | null = null; let seenEnc = '';
    await startPair(home, (req, body, res) => {
      seen = body; seenEnc = String(req.headers['content-encoding'] ?? '');
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const body = pack(Buffer.from(JSON.stringify({
      model: 'gpt-x', system: 'TOP', messages: [{ role: 'system', content: 'MID' }],
    })));
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': enc },
      body,
    });
    expect(r.status).toBe(200);
    expect(seenEnc).toBe(enc);                                  // re-encoded, not silently decompressed
    const got = JSON.parse(unpack(seen!).toString('utf8'));
    expect('system' in got).toBe(false);                        // the hole: this used to survive
    expect(got.messages.every((m: any) => m.role !== 'system')).toBe(true);
  });

  // `_is_chunked` (Task 5) deliberately checks the LAST comma-separated
  // token of `Transfer-Encoding` per RFC 7230 §3.3.1, so `Transfer-Encoding:
  // chunked` and `Content-Encoding: gzip` can arrive on the SAME request —
  // transport framing (chunked) is the OUTER layer, content encoding (gzip)
  // the INNER one. `_read_request_body` peels the chunked framing off
  // first, handing `_relay` the complete, still gzip-compressed bytes;
  // only then does the `/messages` branch's gzip decode run. Reversed, the
  // chunk reader would be handed compressed bytes it cannot parse as chunk
  // framing, or the gzip decoder would be handed a body that still has
  // chunk framing embedded in it — either way garbage. This proves the two
  // decodes compose correctly end to end, not just that each works alone.
  it('decodes a gzip body sent with Transfer-Encoding: chunked, in the right order', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-gzip-chunked-');
    let seen: Buffer | null = null; let seenEnc = ''; let seenTE = '';
    await startPair(home, (req, body, res) => {
      seen = body;
      seenEnc = String(req.headers['content-encoding'] ?? '');
      seenTE = String(req.headers['transfer-encoding'] ?? '');
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const gz = gzipSync(Buffer.from(JSON.stringify({
      model: 'gpt-x', system: 'TOP', messages: [{ role: 'system', content: 'MID' }],
    })));
    const mid = Math.floor(gz.length / 2);
    const stream = new ReadableStream({
      start(c) { c.enqueue(gz.subarray(0, mid)); c.enqueue(gz.subarray(mid)); c.close(); },
    });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body: stream, duplex: 'half',
    } as any);
    expect(r.status).toBe(200);
    expect(seenEnc).toBe('gzip');
    expect(seenTE).toBe('');                                    // re-framed, not re-chunked
    const got = JSON.parse(gunzipSync(seen!).toString('utf8'));
    expect('system' in got).toBe(false);
    expect(got.messages.every((m: any) => m.role !== 'system')).toBe(true);
  });

  // A body that CLAIMS `Content-Encoding: gzip` but is not actually gzip at
  // all (bad header) must not repeat either of this shim's two other
  // "could not use the body" shapes: forwarding it silently still-labelled
  // gzip (a fourth D-3151-style arm, and the exact hazard this task
  // closes — the client's real `system` would still be sitting inside
  // those bytes), or dropping the connection the way a malformed chunked
  // frame does (Task 5's known, carried gap). It gets an explicit refusal
  // instead, and the upstream must never see the request at all.
  //
  // D-3153 (task-7a-rulings.md §7): this case used to assert only
  // `400 <= status < 500` with no body check, which is exactly why Task 6's
  // `send_error`-shaped divergence (an HTML body, the exception text in the
  // status-line reason phrase) was invisible. Replaced with the exact code
  // and a body assertion — the "other change" the rulings asked to be
  // reported: yes, both existing cases needed exactly this, nothing else;
  // both were still measured 29/29 and their own mutations re-measured
  // (see the report).
  it('answers an explicit 400, never reaching upstream, when the gzip body has a bad header', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-gzip-badheader-');
    let upstreamHit = false;
    await startPair(home, (_req, _body, res) => {
      upstreamHit = true;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body: Buffer.from('this is not gzip at all'),
    });
    expect(r.status).toBe(400);
    expect(r.headers.get('content-type')).toBe('application/json');
    expect((await r.json()).error).toMatch(/gzip/i);
    expect(upstreamHit).toBe(false);                             // refused here, never reached upstream
  });

  // The bad-header case above exercises `gzip.BadGzipFile` (an `OSError`
  // subclass). A body with a VALID gzip header that is simply cut short —
  // compressed data ending before the stream's own end-of-stream marker —
  // raises `EOFError` instead, which is NOT an `OSError` subclass. Measured
  // directly against Python's own `gzip` module while implementing this
  // task: an `except OSError` alone does not catch it, and an uncaught
  // `EOFError` would propagate out of `_relay` and drop the connection —
  // reproducing, for this one case, the exact shape the task said not to
  // replicate. A dedicated case because the bad-header case above cannot
  // exercise this branch at all.
  it('answers an explicit 400, never reaching upstream, when the gzip body is truncated (EOFError, not OSError)', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-gzip-truncated-');
    let upstreamHit = false;
    await startPair(home, (_req, _body, res) => {
      upstreamHit = true;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const full = gzipSync(Buffer.from(JSON.stringify({
      model: 'gpt-x', system: 'TOP', messages: [{ role: 'user', content: 'hi' }],
    })));
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body: full.subarray(0, Math.floor(full.length / 2)),      // valid header, cut mid-stream
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/gzip/i);
    expect(upstreamHit).toBe(false);
  });

  // C1 (tasks-5-6-review.md): the two cases above exercise
  // `gzip.BadGzipFile` (bad header) and `EOFError` (cut short) — both
  // `OSError`/`EOFError`. A THIRD shape neither reaches: a VALID gzip
  // header wrapping a CORRUPTED deflate payload, with the trailing
  // CRC32/ISIZE footer left intact. That raises `zlib.error` — an
  // `Exception` subclass, neither `OSError` nor `EOFError` — which used to
  // escape `_decode_body` uncaught, propagate out of `_relay`, and drop the
  // connection with no HTTP response (measured twice at the wire by the
  // review: `UND_ERR_SOCKET | other side closed`, `upstreamHit=false`).
  // Constructed the same way the review measured it: flip every payload
  // byte between the fixed 10-byte gzip header and the fixed 8-byte
  // CRC32+ISIZE trailer, leaving both intact — verified directly against
  // this box's own `gzip.decompress` while writing this case: the flipped
  // bytes raise `zlib.error` ("invalid distance too far back"), never a
  // successful-but-CRC-mismatched decode (which would be `BadGzipFile`,
  // not this branch).
  it('answers an explicit 400, never reaching upstream, when the gzip payload is corrupt but the header and CRC/ISIZE footer are intact (C1)', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-gzip-corruptpayload-');
    let upstreamHit = false;
    await startPair(home, (_req, _body, res) => {
      upstreamHit = true;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const good = gzipSync(Buffer.from(JSON.stringify({
      model: 'gpt-x', system: 'TOP', messages: [{ role: 'user', content: 'hi' }],
    })));
    const bad = Buffer.from(good);
    for (let i = 10; i < bad.length - 8; i++) bad[i] = bad[i] ^ 0xff;   // header (10B) and footer (8B) untouched
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body: bad,
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/gzip/i);
    expect(upstreamHit).toBe(false);
  });

  // Fix round 1, I-2: arm 1 (`_rewrite_messages_body`'s malformed-JSON
  // refusal) was previously pinned by ONLY the deep-nesting `RecursionError`
  // case — its rarest of three triggers. An ordinary truncated/malformed
  // JSON body had no case at all: mutating `except (TypeError, ValueError,
  // RecursionError)` down to `except RecursionError` left the suite fully
  // green (42/42), and under that mutation an ordinary malformed body drops
  // the connection with no HTTP response — precisely the failure shape this
  // whole wave exists to close.
  //
  // Sent gzip-WRAPPED deliberately (not plain), because this closes a
  // second, separately-unpinned gap in the same act: task-7a-rulings.md §2's
  // second rider (durable version: spec §6.3's gzip transport hole) said
  // an arm-1 hit on the gzip path used to decompress,
  // fail to parse, and RE-COMPRESS before forwarding, and that this path
  // must disappear. It does (probed, never pinned before this case): the
  // shim raises `_UnusableBody` before any re-encode is attempted, so the
  // gzip round trip never happens for an unparseable body.
  it('refuses a gzip-wrapped truncated JSON body via arm 1, never reaching upstream', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-gzip-truncatedjson-');
    let reached = false;
    await startPair(home, (_req, _body, res) => {
      reached = true;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const truncated = gzipSync(Buffer.from('{"model":"gpt-x","messages":[{'));
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body: truncated,
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/malformed json/i);
    expect(reached).toBe(false);
  });
});

describe.skipIf(!PY)('ccgpt-proxy: an unimplemented content-encoding earns a 415 (Task 7a §3)', () => {
  // The brief's own case (task-7-brief.md, embedded verbatim in the plan's
  // "### Task 7" section, `docs/superpowers/plans/
  // 2026-09-21-gpt-lane-ownership-2a-request-path.md`), verbatim status
  // and assertion shape. `br` used to fall into D-3151 arm 1 (`json.loads` on the raw
  // compressed bytes fails, and the old arm forwarded them unrewritten,
  // still labelled `Content-Encoding: br` — the exact sticky-replay
  // hazard this whole wave exists to close). Now refused by name before
  // any attempt to parse it as JSON.
  it('refuses an undecodable encoding instead of forwarding it unexamined', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-badenc-');
    let reached = false;
    await startPair(home, (_req, _body, res) => {
      reached = true; res.writeHead(200); res.end('{}');
    });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'br' },
      body: Buffer.from([0x1b, 0x00, 0x00, 0x00]),
    });
    expect(r.status).toBe(415);
    expect((await r.json()).error).toMatch(/content-encoding/i);
    expect(reached).toBe(false);                                // upstream never saw it
  });

  // task-7a-rulings.md §3 and §6 of the paired review (durable version:
  // spec §6.3): `_content_encoding`
  // does not split on commas, so a list-form or trailing-comma
  // `Content-Encoding` never equals the bare token `"gzip"` and never hit
  // the decode branch — it fell into D-3151 arm 1 instead (measured by the
  // review: `upstreamHit=true`, still gzip-compressed, `system` intact).
  // Both forms now earn the same explicit 415 as `br`.
  it.each(['gzip, br', 'gzip,'])('refuses the list/trailing-comma content-encoding %s instead of forwarding it unexamined', async (enc) => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-badenc-list-');
    let reached = false;
    await startPair(home, (_req, _body, res) => {
      reached = true; res.writeHead(200); res.end('{}');
    });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': enc },
      body: gzipSync(Buffer.from(JSON.stringify({ model: 'gpt-x', messages: [{ role: 'system', content: 'MID' }] }))),
    });
    expect(r.status).toBe(415);
    expect((await r.json()).error).toMatch(/content-encoding/i);
    expect(reached).toBe(false);
  });

  // §3's other half: two values must keep working, and both are easy to
  // break. Absent `Content-Encoding` is already covered by every
  // unencoded-body case above; `identity` — which explicitly means "no
  // encoding" — has no dedicated case anywhere else, so refusing it would
  // be a regression nothing else here would catch.
  it('folds and forwards normally when Content-Encoding is explicitly identity', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-identity-');
    let seen: any = null;
    await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'identity' },
      body: JSON.stringify({ model: 'gpt-x', messages: [{ role: 'system', content: 'MID' }] }),
    });
    expect(r.status).toBe(200);
    expect(seen.messages[0].role).toBe('user');                  // folded, not refused
  });

  // The three cases above all use a body that is not valid JSON on its
  // face (real `br`/gzip-list-form bytes), so a mutation collapsing the
  // 415 guard to a passthrough would still be caught by the ALSO-CLOSED
  // D-3151 arm 1 (json.loads fails regardless) — redding the case, but not
  // through the invariant the mutation table names ("`reached` becomes
  // `true`"). This case isolates the 415 guard from arm 1: the body IS
  // valid JSON, so nothing else in the file would refuse it — only the
  // encoding check stands between it and upstream, and this is what
  // actually reaches upstream if that check is ever removed.
  it('refuses an unimplemented content-encoding even when the body is otherwise valid JSON', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-badenc-validjson-');
    let reached = false;
    await startPair(home, (_req, _body, res) => {
      reached = true; res.writeHead(200); res.end('{}');
    });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'br' },
      body: JSON.stringify({ model: 'gpt-x', messages: [{ role: 'system', content: 'MID' }] }),
    });
    expect(r.status).toBe(415);
    expect((await r.json()).error).toMatch(/content-encoding/i);
    expect(reached).toBe(false);
  });

  // Fix round 1, M-4: nothing pinned the 415 guard to the `/messages`
  // path — measured correct today (probed at the wire by the review), but
  // hoisting the encoding check above the path-suffix check in `_relay`
  // left the whole suite green. Every other path is forwarded byte-for-byte
  // regardless of `Content-Encoding` (module docstring); this binds it for
  // an encoding this shim does not implement specifically, the case most
  // likely to tempt a future edit into checking it too early.
  it('does not apply the 415 guard outside the /messages path (M-4)', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-415-scoped-');
    let seen: Buffer | null = null;
    await startPair(home, (_req, body, res) => {
      seen = body;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const payload = Buffer.from([0x1b, 0x00, 0x00, 0x00]);
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/models`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'br' },
      body: payload,
    });
    expect(r.status).toBe(200);                     // forwarded, not refused
    expect(seen!.equals(payload)).toBe(true);        // byte-identical
  });
});

describe.skipIf(!PY)('ccgpt-proxy: upstream unreachable answers the same refusal shape (502)', () => {
  // Fix round 1, I-1: `_refuse`'s docstring used to claim, UNIVERSALLY,
  // that reaching this method means upstream was never contacted — false
  // at the 502 call site, which fires AFTER `urlopen`, i.e. the request
  // body WAS already offered upstream by the time this refusal is chosen.
  // Pinned here, both halves the review asked for: the 502 JSON shape
  // itself (the one wire shape this task changed with zero coverage before
  // this round — a silent revert to `send_error`'s HTML shape would have
  // gone unnoticed), and that `reached` is `true`, the documented exception
  // to the body-refusal invariant, not a violation of it.
  it('answers the 502 upstream-unreachable refusal in the same JSON shape as every other refusal', async () => {
    if (!pythonOrSkip()) return;
    const home = mkTmp('ccgpt-proxy-upstream-down-');
    let reached = false;
    await startPair(home, (req, _body, _res) => {
      reached = true;
      req.socket.destroy();                          // upstream saw the request, then vanished
    });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/models`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(r.status).toBe(502);
    expect(r.headers.get('content-type')).toBe('application/json');
    expect((await r.json()).error).toMatch(/upstream unreachable/i);
    expect(reached).toBe(true);                       // the documented exception: upstream WAS reached
  });
});

describe.skipIf(!PY)('ccgpt-proxy: header-read and chunk-framing guards pinned by nothing (Task 7b)', () => {
  // task-7b-rulings.md §1/I4: `headers.get(name)` on an
  // `http.client.HTTPMessage` returns only the FIRST occurrence of a
  // header name; RFC 7230 §3.2.2 permits a comma-list header to be sent as
  // repeated lines instead of one line, and `fetch` never emits that shape
  // — every case in this block is a raw socket for exactly that reason.
  it('recognizes chunked framing when Transfer-Encoding is split across two header lines (I4)', async () => {
    const home = mkTmp('ccgpt-proxy-te-split-');
    let seen: Buffer | null = null;
    await startPair(home, (_req, body, res) => {
      seen = body;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const payload = Buffer.from(JSON.stringify({
      model: 'gpt-x', system: 'TOP', messages: [{ role: 'system', content: 'MID' }],
    }));
    const { status } = await rawRequest(PROXY_PORT, 'POST', '/v1/messages', [
      'Content-Type: application/json',
      'Transfer-Encoding: gzip',      // first line: NOT "chunked" alone
      'Transfer-Encoding: chunked',   // second line: the flag a get()-only read would miss entirely
    ], chunkEncode(payload));
    expect(status).toBe(200);
    // The invariant, not just the status (task-7b-rulings.md §1's own
    // instruction): a get()-only read sees 'gzip' alone, _is_chunked
    // answers False, _read_request_body falls to Content-Length (absent on
    // a chunked request -> 0), and this reaches upstream with an EMPTY
    // body — the Task 5 symptom verbatim, still 200 because an empty POST
    // isn't itself an error.
    expect(seen).not.toBeNull();
    const got = JSON.parse(seen!.toString('utf8'));
    expect('system' in got).toBe(false);
    expect(got.messages.every((m: any) => m.role !== 'system')).toBe(true);
  });

  // Same defect class, `_content_encoding`'s own single-line read
  // (task-7b-rulings.md §1/I4, "same fix"). A split Content-Encoding
  // cannot join back into a bare recognised codec token (joining always
  // inserts a comma), so the OBSERVABLE difference this fix makes is: a
  // get()-only read sees only 'identity' (the first line) and forwards the
  // plain, unencoded body normally (200); the fixed read sees the full
  // 'identity,gzip' and correctly refuses it as an encoding this shim does
  // not implement (415) rather than silently keying off whichever line
  // happened to arrive first.
  it('reads Content-Encoding split across two header lines instead of only the first (I4)', async () => {
    const home = mkTmp('ccgpt-proxy-ce-split-');
    let reached = false;
    await startPair(home, (_req, _body, res) => {
      reached = true; res.writeHead(200); res.end('{}');
    });
    const payload = Buffer.from(JSON.stringify({ model: 'gpt-x', messages: [{ role: 'system', content: 'MID' }] }));
    const { status, body } = await rawRequest(PROXY_PORT, 'POST', '/v1/messages', [
      'Content-Type: application/json',
      'Content-Encoding: identity',
      'Content-Encoding: gzip',
      `Content-Length: ${payload.length}`,
    ], payload);
    expect(status).toBe(415);
    expect(JSON.parse(body).error).toMatch(/content-encoding/i);
    expect(reached).toBe(false);
  });

  // M9 (task-7b-rulings.md §3): `_content_encoding` lower-cases before
  // comparing against `_CODECS`'s keys and the `''`/`identity` exemption.
  // Content-coding values are case-insensitive per RFC 7231's Content-Coding
  // section; without
  // `.lower()`, this mixed-case spelling would fail every membership check
  // and earn a 415 instead of folding normally.
  it('folds a gzip body whose Content-Encoding is spelled in mixed case (M9)', async () => {
    const home = mkTmp('ccgpt-proxy-ce-case-');
    let seen: Buffer | null = null;
    await startPair(home, (_req, body, res) => {
      seen = body;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const gz = gzipSync(Buffer.from(JSON.stringify({
      model: 'gpt-x', system: 'TOP', messages: [{ role: 'system', content: 'MID' }],
    })));
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'GZIP' },
      body: gz,
    });
    expect(r.status).toBe(200);
    const got = JSON.parse(gunzipSync(seen!).toString('utf8'));
    expect('system' in got).toBe(false);
  });

  // M6 (task-7b-rulings.md §3): `_is_chunked` already reads the LAST
  // comma-separated token (its own docstring cites RFC 7230 §3.3.1 for
  // it), but nothing exercises a Transfer-Encoding value where the first
  // token is something OTHER than "chunked" — every existing case sends
  // "chunked" alone, where "first token" and "last token" are the same
  // token and a first-token mutation would not be visible. RFC 7230
  // §3.3.1's own worked example is exactly this shape: "gzip, chunked"
  // meaning the entity was gzip-compressed, THEN chunk-framed.
  // M-5 (task-7b-fix-rulings.md): this fixture is deliberately NOT a
  // self-consistent HTTP message — the `Transfer-Encoding: gzip, chunked`
  // header names a `gzip` TRANSFER-coding layer this shim never applies
  // (or reverses; it isn't implemented at all), over a body that was
  // gzip-compressed exactly once, at the CONTENT level, matching the
  // separate `Content-Encoding: gzip` header instead. Left this way on
  // purpose rather than "fixed": the property this case exists to pin is
  // that `_is_chunked` reads the LAST Transfer-Encoding token and ignores
  // every token ahead of it — it does not, and must not, try to interpret
  // or apply any of those earlier tokens, `gzip` among them. Building a
  // truly self-consistent message would require this shim to actually
  // decode a `gzip` TRANSFER-coding, which does not exist anywhere in this
  // file and is out of scope; the unapplied token is exactly as
  // uninterpreted here as it is on the wire.
  it('recognizes chunked framing as the LAST token when another encoding is named first (M6)', async () => {
    const home = mkTmp('ccgpt-proxy-te-lasttoken-');
    let seen: Buffer | null = null;
    await startPair(home, (_req, body, res) => {
      seen = body;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const gz = gzipSync(Buffer.from(JSON.stringify({
      model: 'gpt-x', system: 'TOP', messages: [{ role: 'system', content: 'MID' }],
    })));
    const { status } = await rawRequest(PROXY_PORT, 'POST', '/v1/messages', [
      'Content-Type: application/json',
      'Content-Encoding: gzip',
      'Transfer-Encoding: gzip, chunked',   // one line, two tokens — "chunked" is last, not first
    ], chunkEncode(gz));
    expect(status).toBe(200);
    expect(seen).not.toBeNull();
    const got = JSON.parse(gunzipSync(seen!).toString('utf8'));
    expect('system' in got).toBe(false);
    expect(got.messages.every((m: any) => m.role !== 'system')).toBe(true);
  });

  // M15 (task-7b-rulings.md §3): the chunk-extension strip
  // (`size_line.split(b";", 1)[0]`) is correctness-verified already (the
  // paired review measured it working end to end) but pinned by nothing —
  // no case sends a chunk-size line carrying one. RFC 7230 §4.1.1 permits
  // `chunk-ext` after the size and before the CRLF; a real intermediary can
  // add one, and this shim must ignore it rather than fail to parse the
  // size.
  it('strips a chunk-extension from the size line instead of failing to parse it (M15)', async () => {
    const home = mkTmp('ccgpt-proxy-chunk-ext-');
    let seen: Buffer | null = null;
    await startPair(home, (_req, body, res) => {
      seen = body;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const payload = Buffer.from(JSON.stringify({ model: 'gpt-x', messages: [{ role: 'system', content: 'MID' }] }));
    const { status } = await rawRequest(PROXY_PORT, 'POST', '/v1/messages', [
      'Content-Type: application/json',
      'Transfer-Encoding: chunked',
    ], chunkEncode(payload, 'ext=1'));
    expect(status).toBe(200);
    expect(seen).not.toBeNull();
    const got = JSON.parse(seen!.toString('utf8'));
    expect(got.messages[0].role).toBe('user');
  });

  // M11 (task-7b-rulings.md §3): the trailer-drain loop is
  // correctness-verified already (a well-formed trailer costs nothing to
  // skip draining — nothing else in `_relay` reads `rfile` again, and the
  // shim always answers `Connection: close`, so leftover unread bytes are
  // never observed) but pinned by nothing. The one place removing it IS
  // observable: a connection that closes mid-trailer. With the loop, that
  // is caught (`rfile.readline()` returns `b''` at EOF) and refused
  // explicitly, matching every other truncated-framing case in this file;
  // without it, the terminating zero-size chunk alone is enough to `break`
  // out and return the chunks already read, successfully, with the
  // truncated trailer bytes never even inspected.
  it('refuses a chunked body whose connection closes mid-trailer, never reaching upstream (M11)', async () => {
    const home = mkTmp('ccgpt-proxy-trailer-trunc-');
    let reached = false;
    await startPair(home, (_req, _body, res) => {
      reached = true;
      res.writeHead(200); res.end('{}');
    });
    // "5\r\nhello\r\n" is one complete 5-byte chunk; "0\r\n" is the
    // terminating chunk; "trailer-nam" is a trailer header line with
    // neither its own CRLF nor the final blank line that would close the
    // body — the socket half-closes right there.
    const raw = Buffer.from('5\r\nhello\r\n0\r\ntrailer-nam', 'latin1');
    const { status, body } = await rawRequest(PROXY_PORT, 'POST', '/v1/models', [
      'Content-Type: application/json',
      'Transfer-Encoding: chunked',
    ], raw);
    expect(status).toBe(400);
    expect(JSON.parse(body).error).toMatch(/trailer/i);
    expect(reached).toBe(false);
  });
});

describe.skipIf(!PY)('ccgpt-proxy: 7b fix round 1 — chunked named but not final earns 400 (I-2)', () => {
  // task-7b-fix-rulings.md I-2 / task-7b-review.md I-2: RFC 7230 §3.3.3
  // item 3 — when `chunked` appears in Transfer-Encoding but is not the
  // FINAL token, the message length cannot be determined by any means this
  // shim implements, and it MUST be refused. Before this, both spellings
  // below fell through `_is_chunked` (correctly False — chunked is not
  // what this shim should decode as chunked framing) straight to
  // Content-Length, which a Transfer-Encoding-bearing request is
  // RFC-forbidden from also carrying reliably, and forwarded ZERO bytes —
  // the exact silent-empty-body symptom this whole wave exists to kill,
  // reached by a spelling the I4 join fix did not close.
  it('refuses Transfer-Encoding naming chunked but not final, single line', async () => {
    const home = mkTmp('ccgpt-proxy-te-notfinal-oneline-');
    let reached = false;
    await startPair(home, (_req, _body, res) => {
      reached = true; res.writeHead(200); res.end('{}');
    });
    const { status, body } = await rawRequest(PROXY_PORT, 'POST', '/v1/models', [
      'Content-Type: application/json',
      'Transfer-Encoding: chunked, gzip',   // one line, chunked NOT last
    ], Buffer.alloc(0));
    expect(status).toBe(400);
    const parsed = JSON.parse(body);
    expect(parsed.error).toMatch(/^ccgpt-proxy:/);
    expect(parsed.error).toMatch(/transfer-encoding/i);
    expect(parsed.error).toMatch(/chunked/i);
    expect(reached).toBe(false);
  });

  // Same shape, but the two tokens arrive as two separate header LINES —
  // this is the row the I4 join fix newly REACHES (row 3 of the review's
  // table): joining split lines made this spelling agree with the
  // single-line one above, which was already answering 200 with an empty
  // body before this round.
  it('refuses Transfer-Encoding naming chunked but not final, split across two lines', async () => {
    const home = mkTmp('ccgpt-proxy-te-notfinal-split-');
    let reached = false;
    await startPair(home, (_req, _body, res) => {
      reached = true; res.writeHead(200); res.end('{}');
    });
    const { status, body } = await rawRequest(PROXY_PORT, 'POST', '/v1/models', [
      'Content-Type: application/json',
      'Transfer-Encoding: chunked',
      'Transfer-Encoding: gzip',            // second line — chunked (line 1) is NOT the final token
    ], Buffer.alloc(0));
    expect(status).toBe(400);
    const parsed = JSON.parse(body);
    expect(parsed.error).toMatch(/^ccgpt-proxy:/);
    expect(parsed.error).toMatch(/transfer-encoding/i);
    expect(parsed.error).toMatch(/chunked/i);
    expect(reached).toBe(false);
  });

  // The regression control the ruling asks for by name: a Transfer-Encoding
  // that never mentions "chunked" at all must keep falling through to
  // Content-Length and forwarding normally — refusing this would be
  // refusing a request this shim already handles correctly today, the
  // over-refusal hazard every guard in this file is written against.
  it('still forwards via Content-Length when Transfer-Encoding never mentions chunked (regression control)', async () => {
    const home = mkTmp('ccgpt-proxy-te-nochunked-');
    let seen: Buffer | null = null;
    await startPair(home, (_req, body, res) => {
      seen = body;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const payload = Buffer.from(JSON.stringify({ model: 'gpt-x', messages: [{ role: 'system', content: 'MID' }] }));
    const { status } = await rawRequest(PROXY_PORT, 'POST', '/v1/messages', [
      'Content-Type: application/json',
      'Transfer-Encoding: gzip',            // names an encoding, but never "chunked"
      `Content-Length: ${payload.length}`,
    ], payload);
    expect(status).toBe(200);
    expect(seen).not.toBeNull();
    const got = JSON.parse(seen!.toString('utf8'));
    expect(got.messages[0].role).toBe('user');   // folded and forwarded, not refused
  });
});

describe.skipIf(!PY)('ccgpt-proxy: effort precedence and the single-slot cache (Task 8)', () => {
  // Case 1 (task-8-brief.md): an explicit client `output_config.effort`
  // wins outright over the lane default, even when a default for this
  // exact model is on file.
  it('an explicit output_config.effort wins over the lane default', async () => {
    const home = mkTmp('ccgpt-proxy-effort-explicit-');
    let seen: any = null;
    const { lane } = await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    writeEffortFile(home, lane, { 'gpt-x': 'low' });
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-x',
        output_config: { effort: 'high' },
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(seen.reasoning).toEqual({ effort: 'high' });          // explicit, not the file's 'low'
    expect('output_config' in seen).toBe(false);
  });

  // Case 2: with no explicit effort, the lane default for THIS request's
  // own model applies.
  it('applies the lane default for this model when no explicit effort is sent', async () => {
    const home = mkTmp('ccgpt-proxy-effort-default-');
    let seen: any = null;
    const { lane } = await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    writeEffortFile(home, lane, { 'gpt-x': 'low' });
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(seen.reasoning).toEqual({ effort: 'low' });
  });

  // C-1 (fix round 1, Critical): `output_config.effort: "auto"` must be
  // treated as ABSENT, not as an explicit choice — `auto` is a first-class
  // word in ccrc's own routing vocabulary meaning "the lane decides"
  // (`ccd/ccd`'s `ROUTE_EFFORTS`, its own exclusion from the spawn argv's
  // `--effort`, `/effort auto`'s documented behaviour), and the
  // model-class-registry design says so explicitly (§6.4 "when present and
  // not `auto`"; §12's acceptance criterion "`auto` and absent → the lane
  // default for that model"). Measured by the review: an unhandled `auto`
  // is not merely inert — the literal string is written into
  // `reasoning.effort` and forwarded, and Codex has no `auto` level, so the
  // live consequence is a provider 400 on every turn. Both halves of §12's
  // acceptance criterion, pinned as their own cases:
  it('treats an explicit auto as absent and applies the lane default instead (C-1)', async () => {
    const home = mkTmp('ccgpt-proxy-effort-auto-default-');
    let seen: any = null;
    const { lane } = await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    writeEffortFile(home, lane, { 'gpt-x': 'low' });
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-x',
        output_config: { effort: 'auto' },
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(seen.reasoning).toEqual({ effort: 'low' });   // the lane default, never the literal 'auto'
  });

  it('treats an explicit auto as absent and omits reasoning entirely when there is no lane default (C-1)', async () => {
    const home = mkTmp('ccgpt-proxy-effort-auto-nodefault-');
    let seen: any = null;
    await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    // No effort file at all — nothing for 'auto' to fall through TO.
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-x',
        output_config: { effort: 'auto' },
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect('reasoning' in seen).toBe(false);             // never the literal 'auto', never invented
    expect('output_config' in seen).toBe(false);
  });

  // M-4 (fix round 1, Minor): a resolved level is set as `.effort` on an
  // EXISTING client-sent `reasoning` object, never by replacing it
  // wholesale — a sibling key (`reasoning.summary`, unreachable from Claude
  // Code today but not this shim's business to discard) must survive.
  it('merges a resolved effort into an existing client-sent reasoning object rather than replacing it (M-4)', async () => {
    const home = mkTmp('ccgpt-proxy-effort-merge-reasoning-');
    let seen: any = null;
    await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-x',
        reasoning: { summary: 'detailed', effort: 'low' },
        output_config: { effort: 'high' },
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(seen.reasoning).toEqual({ summary: 'detailed', effort: 'high' });   // sibling survives
  });

  // Case 3 (brief): output_config and thinking are both absent from the
  // forwarded body when an explicit effort was sent.
  it('strips both output_config and thinking when an explicit effort is sent', async () => {
    const home = mkTmp('ccgpt-proxy-effort-stripped-explicit-');
    let seen: any = null;
    await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-x',
        output_config: { effort: 'high' },
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect('output_config' in seen).toBe(false);
    expect('thinking' in seen).toBe(false);
  });

  // task-8-rulings.md §5: bind the `thinking` strip INDEPENDENTLY of the
  // effort path — a body carrying `thinking` and no `output_config` at all
  // (and no lane default either) must still come out with `thinking` gone,
  // so a mutation that stops stripping `thinking` cannot hide behind
  // `output_config`'s own removal.
  it('strips thinking even when output_config is absent entirely and no lane default applies (ruling §5)', async () => {
    const home = mkTmp('ccgpt-proxy-effort-stripped-thinking-only-');
    let seen: any = null;
    await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    // No effort file at all — nothing to default to, either.
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-x',
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect('thinking' in seen).toBe(false);
    expect('output_config' in seen).toBe(false);       // never present; trivially true
    expect('reasoning' in seen).toBe(false);            // nothing to apply — provider default
  });

  // Case 4, REPLACED per task-8-rulings.md §1 — the brief's own second half
  // ("rewriting identical bytes at the same mtime does not [re-read]") is
  // UNFALSIFIABLE: identical bytes produce an identical applied default
  // whether the cache re-read them or not, so that assertion passes under
  // every implementation, including one with no cache at all — a control
  // derived from the measurement, a shape this project has a standing rule
  // against.
  //
  // Split into two INDEPENDENT tests, deliberately, rather than one
  // three-step sequence: the mutation-2 measurement below (drop mtime from
  // the cache key) must red the first and stay green on the second, and a
  // shared sequence can't show that cleanly — under a path-only cache key,
  // the "changed mtime" read never lands either, so a combined test's third
  // assertion (hard-coded to the value the SECOND read would have produced)
  // would go red too, for the wrong reason. Split, the control below
  // establishes and re-checks its OWN baseline, so it is genuinely a no-op
  // under both the correct implementation and the mutation — not merely
  // lucky to still pass.
  //
  // Both halves depend on mtime being EXACTLY what this test intends
  // (task-8-rulings.md §2) — `fs.utimesSync`, not a wall-clock rewrite,
  // which may not move mtime at all inside the same second on some
  // filesystems.
  it('re-reads the effort file when its mtime changes (case 4, the bind)', async () => {
    const home = mkTmp('ccgpt-proxy-effort-cache-bind-');
    let seen: any = null;
    const { lane } = await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const T1 = 1_700_000_000;
    const T2 = 1_700_000_100;            // deliberately far apart — never ambiguous with T1

    // Cold read: byModel['gpt-x'] = 'low', at T1.
    writeEffortFile(home, lane, { 'gpt-x': 'low' }, T1);
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(seen.reasoning).toEqual({ effort: 'low' });

    // NEW mtime, different bytes (byModel['gpt-x'] = 'high') — the cache
    // must re-read.
    writeEffortFile(home, lane, { 'gpt-x': 'high' }, T2);
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(seen.reasoning).toEqual({ effort: 'high' });
  });

  // The observable replacement for the brief's unfalsifiable half: write
  // DIFFERENT bytes at the SAME mtime as an already-cached read, and assert
  // the OLD default still applies. That fails if the cache key is wrong in
  // the OTHER direction (re-reading when it must not), and pins the real,
  // accepted consequence of keying on `(path, mtime)` — a same-mtime
  // content change is invisible to this cache. That is sound in practice,
  // not merely convenient: the materialiser (`effortFile`/`models-op.mjs`)
  // writes a FRESH TMP FILE — carrying a new mtime of its own — and renames
  // THAT over the target, so this shim never sees a same-mtime content
  // change outside a test deliberately forcing one (task-8-fix-rulings.md
  // M-7: `rename(2)` itself PRESERVES the renamed file's mtime — it is the
  // freshness of the tmp file, not the rename call, that makes this sound;
  // said again, correctly this time, in a comment at the Python site).
  //
  // FIX ROUND 1 CORRECTION (task-8-fix-rulings.md, "Where I was wrong"):
  // the original ruling called this case "a control, not a pin". The
  // review's own mutation (delete the cache-hit check entirely, so every
  // call re-reads) found this is the ONLY one of 68 cases that reds under
  // that mutation — it is the SOLE pin for the cache existing at all, not
  // merely a control on the opposite direction. Under mutation 2 (drop
  // mtime from the cache key, tested separately) this case stays green FOR
  // A DIFFERENT REASON: a path-only cache never re-reads at all, so "the
  // same-mtime rewrite is not picked up" holds trivially there too — that
  // half of the framing survives, the "not a pin" half does not.
  it('does not re-read the effort file for a same-mtime content change (case 4, the control)', async () => {
    const home = mkTmp('ccgpt-proxy-effort-cache-control-');
    let seen: any = null;
    const { lane } = await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const T = 1_700_000_000;

    // Establish a cached baseline of this test's own: byModel['gpt-x'] = 'alpha'.
    writeEffortFile(home, lane, { 'gpt-x': 'alpha' }, T);
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(seen.reasoning).toEqual({ effort: 'alpha' });

    // SAME mtime, DIFFERENT bytes (byModel['gpt-x'] = 'beta') — must not be
    // picked up; the applied default stays this test's own baseline.
    writeEffortFile(home, lane, { 'gpt-x': 'beta' }, T);
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(seen.reasoning).toEqual({ effort: 'alpha' });   // stale — the same mtime hid the rewrite
  });
});

describe.skipIf(!PY)('ccgpt-proxy: the effort file itself — absent, malformed, valid (ruling §3)', () => {
  // Ruling: this is ccrc's OWN config, not client input — a broken effort
  // file must not break the lane. All three conditions fall through to the
  // provider default identically; none of them is refused.
  it('falls through to the provider default when the effort file is absent', async () => {
    const home = mkTmp('ccgpt-proxy-effort-absent-');
    let seen: any = null;
    await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    // Deliberately no ~/.ccrc/models directory at all.
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(r.status).toBe(200);
    expect('reasoning' in seen).toBe(false);
  });

  it('falls through to the provider default when the effort file is malformed, not raising (ruling §3)', async () => {
    const home = mkTmp('ccgpt-proxy-effort-malformed-');
    let seen: any = null;
    const { lane } = await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const p = effortFilePath(home, lane);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, 'this is not json at all {{{');
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(r.status).toBe(200);                 // our own broken config never breaks the lane
    expect('reasoning' in seen).toBe(false);
  });

  it('applies the lane default when the effort file is valid (ruling §3)', async () => {
    const home = mkTmp('ccgpt-proxy-effort-valid-');
    let seen: any = null;
    const { lane } = await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    writeEffortFile(home, lane, { 'gpt-x': 'xhigh' });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(r.status).toBe(200);
    expect(seen.reasoning).toEqual({ effort: 'xhigh' });
  });

  // M-1 (fix round 1, Minor): the ruling's own §3 pin sentence named only
  // "absent, malformed, valid" and omitted `unreadable`, which its OWN
  // prose arm required handling — the ruling's gap, not a gap in the work.
  // `chmod 000` denies even the owning user (this process) read access, so
  // `open()` raises `PermissionError`, an `OSError` subclass — the same
  // guard the malformed case exercises via `json.JSONDecodeError`.
  it('falls through to the provider default when the effort file is unreadable (M-1)', async () => {
    const home = mkTmp('ccgpt-proxy-effort-unreadable-');
    let seen: any = null;
    const { lane } = await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    writeEffortFile(home, lane, { 'gpt-x': 'high' });
    chmodSync(effortFilePath(home, lane), 0o000);
    try {
      const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(r.status).toBe(200);
      expect('reasoning' in seen).toBe(false);
    } finally {
      chmodSync(effortFilePath(home, lane), 0o600);   // let mkTmp's afterAll rmSync remove it
    }
  });

  // M-2 (fix round 1, Minor — a real caching bug the first round shipped):
  // a read/parse FAILURE must not be written into the cache slot. The
  // original implementation cached the empty map under the file's real
  // `(path, mtime)`, so a fix applied WITHOUT the file's mtime moving (a
  // permission repair — `chmod` moves ctime, not mtime — or simply losing
  // a race with a transient EMFILE/ENOMEM) would stay latched to "no lane
  // default" forever, with nothing able to clear it. Pinned at the SAME
  // mtime throughout, deliberately: this is exactly the shape a
  // successful read's cache WOULD stay stale under (case 4's control,
  // above) — the point of this case is that a FAILED read must not get
  // that same stickiness.
  it('picks up a fixed effort file immediately, even at the same mtime as the failure it replaces (M-2)', async () => {
    const home = mkTmp('ccgpt-proxy-effort-fixed-samemtime-');
    let seen: any = null;
    const { lane } = await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const T = 1_700_000_000;
    const p = effortFilePath(home, lane);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, 'this is not json at all {{{');
    utimesSync(p, T, T);
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect('reasoning' in seen).toBe(false);           // the failure — no lane default

    // Fix the content WITHOUT moving mtime at all.
    writeFileSync(p, JSON.stringify({ byModel: { 'gpt-x': 'high' } }));
    utimesSync(p, T, T);
    await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(seen.reasoning).toEqual({ effort: 'high' });   // picked up immediately, not latched
  });
});

describe.skipIf(!PY)('ccgpt-proxy: effort resolution is scoped to /messages, like the folds (ruling §4)', () => {
  // Ship a case proving a non-/messages body is untouched by any of this —
  // must not run outside the same path the folds run on, and must not open
  // a new way for a body to be forwarded unexamined (every existing "cannot
  // use this body" condition already has exactly one shape; this adds none).
  it('does not touch output_config/thinking on a non-/messages path', async () => {
    const home = mkTmp('ccgpt-proxy-effort-scoped-');
    let seen: Buffer | null = null;
    await startPair(home, (_req, body, res) => {
      seen = body;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const payloadText = JSON.stringify({
      model: 'gpt-x', output_config: { effort: 'high' }, thinking: { type: 'adaptive' },
    });
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/models`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: payloadText,
    });
    expect(r.status).toBe(200);
    expect(seen!.toString('utf8')).toBe(payloadText);     // byte-identical: untouched
  });
});

describe.skipIf(!PY)('ccgpt-proxy: SSE responses stream through incrementally, not buffered whole (Task 9 §1)', () => {
  // task-9 — THE MAIN EVENT (task-9-rulings.md §1). `_relay` used to read
  // the upstream response via `resp.read(8192)`, which BLOCKS until 8 KB
  // has accumulated or the stream ends — measured (task-7b-review.md), an
  // 18-byte SSE event written by upstream at t=0 reached the client only at
  // t=40.2s, when the stream itself closed; `git log -S 'resp.read(8192)'`
  // places the defect at `85f97a4d`, this wave's own Task 2. A case that
  // only checks the frames eventually arrive intact — the brief's own
  // wording — WOULD PASS under that defect: content survives buffering,
  // just late (task-9-rulings.md §1's own point, and the reason this file
  // does not simply copy the brief's Step 1.1 verbatim).
  //
  // This case binds on ORDERING instead of content or a wall-clock
  // threshold. The upstream handler writes one `data:` frame and flushes,
  // then waits (a flag, `secondWritten`, flips only once the wait ends and
  // the second frame is written and the response ends). The assertion is
  // that the client's FIRST observed byte arrives while `secondWritten` is
  // still `false`. Node is single-threaded, so this is a genuine ordering
  // proof, not a race dressed as one: the client's `data` handler and the
  // delayed write are both callbacks on the same event loop, and one of
  // them runs to completion (recording its own observation) before the
  // other can even begin — "immune to a loaded box", per the ruling, since
  // nothing here depends on how LONG either side takes, only on which
  // fires first. Under the restored defect (mutation 1, task-9-rulings.md
  // "Mutations required"), the shim forwards nothing until upstream's
  // `res.end()`, which happens strictly after `secondWritten` flips — so
  // this case reds exactly when it should.
  it('task-9 forwards the first SSE frame before the second is written upstream', async () => {
    const home = mkTmp('ccgpt-proxy-sse-');
    let secondWritten = false;
    await startPair(home, (_req, _body, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"first":true}\n\n');
      setTimeout(() => {
        secondWritten = true;
        res.write('data: {"second":true}\n\n');
        res.end();
      }, 1_000);
    });

    const firstFrameBeforeSecondWrite = await new Promise<boolean>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1', port: PROXY_PORT, path: '/v1/messages', method: 'POST',
          headers: { 'content-type': 'application/json' },
        },
        (res) => {
          res.once('data', () => { resolve(!secondWritten); res.resume(); });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end('{}');
    });
    expect(firstFrameBeforeSecondWrite).toBe(true);
  });
});

describe.skipIf(!PY)('ccgpt-proxy: tools and tool_result content blocks forward intact (Task 9 §2)', () => {
  it('task-9 forwards tools and a tool_result content block with both intact', async () => {
    const home = mkTmp('ccgpt-proxy-tools-');
    let seen: any = null;
    await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const payload = {
      model: 'gpt-x',
      tools: [{
        name: 'get_weather', description: 'Look up the weather',
        input_schema: { type: 'object', properties: { city: { type: 'string' } } },
      }],
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Berlin' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'sunny, 21C' }] },
      ],
    };
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    expect(r.status).toBe(200);
    expect(seen.tools).toEqual(payload.tools);
    expect(seen.messages[0].content[0]).toEqual({ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Berlin' } });
    expect(seen.messages[1].content[0]).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'sunny, 21C' });
  });

  // task-9 I-1 — MEASUREMENT, not a value judgment (task-9-rulings.md §2:
  // "do not assume it is a defect and do not 'fix' it on your own
  // judgement"). `_fold_system` merges a non-empty top-level `system` into
  // `messages[0]` when that message is already `role: "user"`; for a
  // content-block-list it unconditionally PREPENDS a new `{"type": "text",
  // ...}` block ahead of whatever content was already there
  // (`[{"type": "text", "text": sys_text}] + content`), with no check on
  // what the existing first block's own `type` is. So when `messages[0]`'s
  // content begins with a `tool_result` block, the system text block lands
  // AHEAD of it — and the Anthropic API requires `tool_result` blocks to
  // come first in a user message. Measured and reported exactly as the
  // shim already behaves; left alone, per the ruling, pending the
  // controller's own reading of this measurement.
  it('task-9 I-1 (measurement, ruling §2): the system fold prepends ahead of a leading tool_result block', async () => {
    const home = mkTmp('ccgpt-proxy-tools-system-order-');
    let seen: any = null;
    await startPair(home, (_req, body, res) => {
      seen = JSON.parse(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    const payload = {
      model: 'gpt-x',
      system: 'be concise',
      messages: [
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'sunny, 21C' }] },
      ],
    };
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    expect(r.status).toBe(200);
    expect(seen.system).toBeUndefined();
    // Measured: the folded system text is content[0] and the tool_result —
    // the block the client itself put first — is pushed to content[1].
    expect(seen.messages[0].content[0]).toEqual({ type: 'text', text: 'be concise' });
    expect(seen.messages[0].content[1]).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'sunny, 21C' });
  });
});

describe.skipIf(!PY)('ccgpt-proxy: hop-by-hop headers dropped from the forwarded request (Task 9 §3/§4/§5)', () => {
  // ruling §5, "do not re-pin what is already pinned": `connection` is
  // already pinned on the RESPONSE side by "sends exactly one Connection
  // header on the response, never a duplicate of the upstream's own" above
  // (fix round 2, finding 2) — the REQUEST side is not independently
  // observable (`urllib.request` forces `Connection: close` on the outgoing
  // request regardless of what HOP_BY_HOP strips, ruling §4). And
  // `transfer-encoding` is already pinned dropped from a real chunked
  // `/messages` request by "decodes a chunked body, rewrites it, and
  // forwards a correct length" above (`expect(seenTE).toBe('')`). Neither
  // is re-pinned here.
  //
  // `fetch` cannot even SEND the five headers below — undici refuses to
  // construct the request at all (measured directly against this box's
  // Node: `InvalidArgumentError: invalid keep-alive header`, and the same
  // shape for upgrade/te/trailer/proxy-authorization), so these go over
  // `rawRequest`'s raw socket, exactly as this file's own chunked-framing
  // cases already do for a shape `fetch` cannot produce.
  it.each([
    ['Keep-Alive', 'timeout=5'],
    ['Upgrade', 'websocket'],
    ['Proxy-Authorization', 'Basic dGVzdA=='],
    ['TE', 'trailers'],
    // task-9 M-1 (ruling §3): the header NAME under test here is `Trailer`
    // (RFC 7230 §4.4) — `trailers` (plural, the case directly above) is a
    // VALUE of the `TE` header (§4.3), never a header name, so this is a
    // distinct condition, not a second spelling of the same case. This is
    // the one row that RED before this task's HOP_BY_HOP fix (the shipped
    // set carried `"trailers"`, which never matches a `Trailer:` header at
    // all) and is the case named in "Mutations required" §3.
    ['Trailer', 'X-Checksum'],
  ] as const)('task-9 drops %s from the forwarded request', async (headerName, value) => {
    const home = mkTmp(`ccgpt-proxy-hopbyhop-${headerName}-`);
    let seenHeaders: Record<string, unknown> = {};
    let seenAuth = '';
    await startPair(home, (req, _body, res) => {
      seenHeaders = req.headers;
      seenAuth = String(req.headers['authorization'] ?? '');
      res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok');
    });
    const { status } = await rawRequest(
      PROXY_PORT, 'GET', '/v1/models',
      [`${headerName}: ${value}`, 'Authorization: Bearer test-token-not-a-secret'],
      Buffer.alloc(0),
    );
    expect(status).toBe(200);
    expect(seenHeaders[headerName.toLowerCase()]).toBeUndefined();
    // End-to-end, on the SAME request: proves the absence above is
    // HOP_BY_HOP filtering doing its job, not an empty/dropped header set.
    expect(seenAuth).toBe('Bearer test-token-not-a-secret');
  });
});
