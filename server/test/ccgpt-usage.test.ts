// server/test/ccgpt-usage.test.ts
import { describe, it, expect } from 'vitest';
import { createServer, type IncomingMessage, type IncomingHttpHeaders, type ServerResponse, type Server } from 'node:http';
import { writeFileSync, mkdirSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pythonOrSkip, runPy, runPyAsync, ccgptFile, PYSTUB_DIR } from './ccgptHarness';
import { mkTmp } from './tmpHelpers';

// Probed once at module scope — same shape as ccgpt-harness.test.ts and
// ccgpt-proxy.test.ts (task-10-rulings.md §5): a missing interpreter must be
// a visible skip, not every case below quietly `return`ing and vitest
// reporting a green suite for work that never ran.
const PY = pythonOrSkip();

it('this box has a usable python3', () => {
  if (process.env.CI) expect(PY).toBeTruthy();
});

// task-10-rulings.md §5: "Ports: 45020 for this suite. 45010/45011 belong to
// the proxy suite and the two cannot run at once." A fixed port, not an
// OS-assigned one, matching the proxy suite's own convention.
const USAGE_PORT = 45020;

// Minted, never shared (task-10-rulings.md §5). Each case gets its own lane
// id, so two cases can never collide over a leftover row.
let mintedIdCount = 0;
function mintId(): string {
  mintedIdCount += 1;
  return `codex-a-${process.pid}-${mintedIdCount}`;
}

/** Plants `~/.ccrc/codex/<id>/lane.json` with `probeModel` and `authDir`
 *  fields — the two things this wave's ccgpt-usage.py reads from it
 *  (lane.json has no writer until Plan 2b, task-10-brief.md). By default
 *  also plants a stub `auth.json` (empty object; its CONTENTS are never
 *  read by the publisher, only its existence — task-10-fix-rulings.md I-3)
 *  at that `authDir`, so every case is "logged in" unless it opts out via
 *  `{ loggedIn: false }` (the I-3 refusal case).
 *
 *  Measured while writing the fix-round mutations: planting auth.json ONLY
 *  at the lane.json-declared authDir made mutation 4 (I-2 — re-deriving the
 *  token dir by a naming convention instead of reading lane.json) cascade
 *  into 9 of 14 cases, including all five of the brief's OWN property
 *  cases, because every one of them logs in through THIS helper and none of
 *  them is testing I-2 at all. So `loggedIn: true` now plants auth.json at
 *  BOTH the lane.json path and the legacy convention-derived path
 *  (`$HOME/.handoff/chatgpt-auth-<id>`) — every case using the default stays
 *  green regardless of which derivation `_token_dir` uses, and I-2 gets its
 *  OWN dedicated, narrowly-isolated case below instead (which plants auth.json
 *  at ONLY the lane.json path, deliberately, so it is the one thing that
 *  distinguishes the two derivations).
 *
 *  `.local/share/ccrc/codex/<id>` matches the spec's own illustrative
 *  roster example (§4.1) for `exec.authDir`. `gpt-5.6-luna` is this repo's
 *  own established fixture model id (server/test/models-op.test.ts and
 *  siblings), never a real OpenAI model name. */
function plantLane(
  home: string, id: string, model = 'gpt-5.6-luna', opts: { loggedIn?: boolean } = {},
): void {
  const { loggedIn = true } = opts;
  const dir = join(home, '.ccrc', 'codex', id);
  mkdirSync(dir, { recursive: true });
  const authDir = `.local/share/ccrc/codex/${id}`;
  writeFileSync(join(dir, 'lane.json'), JSON.stringify({ probeModel: model, authDir }));
  if (loggedIn) {
    for (const rel of [authDir, `.handoff/chatgpt-auth-${id}`]) {
      const abs = join(home, rel);
      mkdirSync(abs, { recursive: true });
      writeFileSync(join(abs, 'auth.json'), '{}');
    }
  }
}

function limitsPath(home: string, id: string): string {
  return join(home, '.cc-limits', `${id}.json`);
}

function readRow(home: string, id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(limitsPath(home, id), 'utf8'));
}

type CapturedRequest = { headers: IncomingHttpHeaders; body: unknown };

/** Binds a one-shot HTTP server on the fixed usage port, records every
 *  request it receives (headers + parsed JSON body, when the body parses)
 *  into `requests`, then runs `handler` to answer it — the loopback
 *  stand-in for the real Codex usage endpoint that `CCGPT_USAGE_ENDPOINT`
 *  points the subject at.
 *
 *  `requests` is what closes task-10-fix-rulings.md M-7: every case below
 *  that expects the publisher to refuse WITHOUT ever reaching the network
 *  now binds this and asserts `requests.length === 0` — "never contacted"
 *  measured, not merely argued from the refusal's exit code. It is also
 *  what C-2/C-3's capturing case needs to assert the request the publisher
 *  actually sent, and what the C-1 redirect cases need to assert a second
 *  hop was never reached. */
function startEndpoint(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void>; requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = [];
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: unknown = null;
        try { body = raw ? JSON.parse(raw) : null; } catch { /* not JSON — leave null */ }
        requests.push({ headers: req.headers, body });
        handler(req, res);
      });
    });
    server.on('error', reject);
    server.listen(USAGE_PORT, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${USAGE_PORT}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
        requests,
      });
    });
  });
}

/** A 200 (or `status`) answering the full `x-codex-*` header set a real
 *  Codex `/responses` call carries — the happy-path shape every property
 *  case starts from unless it is deliberately varying one header.
 *  `x-codex-plan-type` (M-6, fix round 1) was dropped: nothing in this
 *  publisher reads it, so sending it asserted nothing and cost a line. */
function fullHeaders(status = 200): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    res.writeHead(status, {
      'x-codex-primary-used-percent': '42',
      'x-codex-secondary-used-percent': '17',
      'x-codex-secondary-window-minutes': '300',
      'x-codex-primary-reset-at': '4102444800',   // 2100-01-01, far future
      'x-codex-secondary-reset-at': '4102358400', // one day earlier
    });
    res.end();
  };
}

/** `runPyAsync` (`ccgptHarness.ts`, hoisted here in fix round 1 —
 *  task-10-fix-rulings.md's D-3157 audit) for the cases whose mock endpoint
 *  must answer WHILE the child runs: `runPy` drives its child through
 *  `spawnSync`, which blocks the whole Node event loop, so a `node:http`
 *  server living in this same test process could never accept or answer a
 *  connection while `runPy` is blocking on it — see `runPy`'s own
 *  docstring in the harness for the measured deadlock. The three refusal
 *  cases that exit BEFORE any network attempt (absent `lane.json`, unset
 *  `CCGPT_ACCOUNT_ID`, non-loopback endpoint, not-logged-in) have no such
 *  dependency and use plain `runPy`. */
function publisherEnv(id: string, endpoint: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PYTHONPATH: PYSTUB_DIR,
    CCGPT_ACCOUNT_ID: id,
    CCGPT_USAGE_ENDPOINT: endpoint,
    ...extra,
  };
}

describe.skipIf(!PY)('ccgpt-usage.py', () => {
  it('task-10: writes a limits row with json.dump default separators', async () => {
    const home = mkTmp('ccgpt-usage-sep-');
    const id = mintId();
    plantLane(home, id);
    const { url, close } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).toBe(0);
      const raw = readFileSync(limitsPath(home, id), 'utf8');
      expect(raw).toMatch(/": /);            // the separator ccd's grep tolerates, byte-for-byte with the reference
      expect(raw).not.toMatch(/":[^ ]/);     // the brief's own literal check
      // task-10-rulings.md §3: the brief's negative regex over the WHOLE
      // document could false-positive on a string VALUE containing `":`.
      // Assert the structure directly too, so the property is pinned on
      // something a payload value can never fire spuriously.
      const parsed = JSON.parse(raw);
      expect(parsed).toMatchObject({ five: 17, seven: 42 });
      expect(typeof parsed.ts).toBe('number');
    } finally {
      await close();
    }
  });

  it('task-10: fiveResetAt and sevenResetAt are present on every poll, null included', async () => {
    const home = mkTmp('ccgpt-usage-nullkeys-');
    const id = mintId();
    plantLane(home, id);
    // No secondary-window-minutes and no reset headers at all: both
    // five/fiveResetAt and sevenResetAt should read null, but the KEYS must
    // still be written — that presence is what _limit_has_key depends on.
    const { url, close } = await startEndpoint((req, res) => {
      res.writeHead(200, { 'x-codex-primary-used-percent': '55' });
      res.end();
    });
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).toBe(0);
      const parsed = readRow(home, id);
      expect(Object.prototype.hasOwnProperty.call(parsed, 'fiveResetAt')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(parsed, 'sevenResetAt')).toBe(true);
      expect(parsed.fiveResetAt).toBeNull();
      expect(parsed.sevenResetAt).toBeNull();
      expect(parsed.five).toBeNull();
      expect(parsed.seven).toBe(55);
    } finally {
      await close();
    }
  });

  it('task-10: absent secondary-window-minutes is not the same as an explicit zero', async () => {
    const homeAbsent = mkTmp('ccgpt-usage-winabsent-');
    const idAbsent = mintId();
    plantLane(homeAbsent, idAbsent);
    const absentEndpoint = await startEndpoint((req, res) => {
      // No x-codex-secondary-window-minutes header at all.
      res.writeHead(200, { 'x-codex-primary-used-percent': '10' });
      res.end();
    });
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), {
        home: homeAbsent, env: publisherEnv(idAbsent, absentEndpoint.url),
      });
      expect(r.timedOut).toBe(false);
      expect(r.status).toBe(0);
      const row = readRow(homeAbsent, idAbsent);
      expect(Object.prototype.hasOwnProperty.call(row, 'fiveWindowMinutes')).toBe(false);
    } finally {
      await absentEndpoint.close();
    }

    const homeZero = mkTmp('ccgpt-usage-winzero-');
    const idZero = mintId();
    plantLane(homeZero, idZero);
    const zeroEndpoint = await startEndpoint((req, res) => {
      res.writeHead(200, {
        'x-codex-primary-used-percent': '10',
        'x-codex-secondary-window-minutes': '0',
      });
      res.end();
    });
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), {
        home: homeZero, env: publisherEnv(idZero, zeroEndpoint.url),
      });
      expect(r.timedOut).toBe(false);
      expect(r.status).toBe(0);
      const row = readRow(homeZero, idZero);
      expect(Object.prototype.hasOwnProperty.call(row, 'fiveWindowMinutes')).toBe(true);
      expect(row.fiveWindowMinutes).toBe(0);
    } finally {
      await zeroEndpoint.close();
    }
  });

  it('task-10: a 429 carrying the rate-limit headers is a valid measurement', async () => {
    const home = mkTmp('ccgpt-usage-429-');
    const id = mintId();
    plantLane(home, id);
    const { url, close } = await startEndpoint(fullHeaders(429));
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).toBe(0);
      const row = readRow(home, id);
      expect(row).toMatchObject({ five: 17, seven: 42 });
    } finally {
      await close();
    }
  });

  it('task-10: a 5xx with no usage headers is a failed poll, not a measurement (control)', async () => {
    // Not one of the brief's five properties or two refusals — an extra
    // case that gives property 4 (the 429 case above) a real contrast: a
    // failure response carrying NO x-codex-* headers must still fail the
    // poll rather than publishing zeros.
    const home = mkTmp('ccgpt-usage-5xx-');
    const id = mintId();
    plantLane(home, id);
    const { url, close } = await startEndpoint((req, res) => {
      res.writeHead(503, {});
      res.end('upstream down');
    });
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(existsSync(limitsPath(home, id))).toBe(false);
    } finally {
      await close();
    }
  });

  it('task-10: the write is atomic — a read-only existing row is still updated', async () => {
    // task-10-fix-rulings.md I-5: the discriminator holds ONLY because
    // euid != 0 — root bypasses the write bit entirely, so the
    // direct-write mutation (Step 5, #5) would go green under root with no
    // signal that the guard proved nothing. Skip loudly rather than pass
    // silently in that case.
    if (process.getuid && process.getuid() === 0) {
      expect(process.getuid()).not.toBe(0); // fails loudly and visibly, never a silent pass
      return;
    }
    const home = mkTmp('ccgpt-usage-atomic-');
    const id = mintId();
    plantLane(home, id);
    const limitsDir = join(home, '.cc-limits');
    mkdirSync(limitsDir, { recursive: true });
    const target = limitsPath(home, id);
    writeFileSync(target, JSON.stringify({ five: 0, seven: 0, ts: 1, fiveResetAt: null, sevenResetAt: null }));
    chmodSync(target, 0o444);
    const { url, close } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).toBe(0);
      const row = readRow(home, id);
      expect(row).toMatchObject({ five: 17, seven: 42 });
    } finally {
      await close();
      chmodSync(target, 0o644);
    }
  });

  it('task-10: refuses when lane.json is absent, naming the remedy', async () => {
    // Deliberately no plantLane() call. A reachable endpoint IS running
    // (never contacted) so the refusal can only be explained by lane.json,
    // not by a coincidental network failure. Uses `runPyAsync`, not the
    // plain synchronous `runPy`, even though the FIXED code refuses before
    // any network attempt: measured while writing this fix round (see the
    // I-3 case below), a mutation that removes the very refusal this case
    // pins would make the subject proceed to the bound endpoint, and
    // `runPy`'s `spawnSync` deadlocks against a same-process server exactly
    // as D-3157 describes — turning a clean red into a timeout artefact.
    // `runPyAsync` gives a correct, non-timeout signal either way.
    const home = mkTmp('ccgpt-usage-nolane-');
    const id = mintId();
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/lane\.json/);
      expect(r.stderr).toMatch(/ccrc doctor --fix/);
      expect(existsSync(limitsPath(home, id))).toBe(false);
      expect(requests.length).toBe(0); // task-10-fix-rulings.md M-7: never contacted, measured
    } finally {
      await close();
    }
  });

  it('task-10 fix round 1 (I-3): refuses when the lane is not logged in, naming the token directory', async () => {
    // `runPyAsync`, not `runPy` — MEASURED, not assumed: mutation 5's own
    // spot-check (this case's mutation) showed why. Removing
    // `_require_logged_in` makes the subject proceed all the way to the
    // bound endpoint below; under the plain synchronous `runPy` that
    // deadlocks against this same-process server (D-3157) instead of
    // giving a clean red — the mutation still "worked" (the case failed)
    // but for the wrong reason, a 5s timeout rather than a real assertion.
    // `runPyAsync` resolves fast and correctly either way.
    const home = mkTmp('ccgpt-usage-notloggedin-');
    const id = mintId();
    plantLane(home, id, 'gpt-5.6-luna', { loggedIn: false }); // lane.json present; no auth.json planted
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/is not logged in/);
      expect(r.stderr).toContain(id);
      // The message names the TOKEN DIRECTORY this run computed — proving
      // it is the publisher's own derivation, not a bare Authenticator
      // failure (task-10-fix-rulings.md I-3).
      expect(r.stderr).toMatch(/\.local\/share\/ccrc\/codex\//);
      expect(existsSync(limitsPath(home, id))).toBe(false);
      expect(requests.length).toBe(0);
    } finally {
      await close();
    }
  });

  it('task-10 fix round 1 (I-2): reads the OAuth directory from lane.json\'s authDir, not a naming convention', async () => {
    // Isolated from every other case, deliberately: auth.json is planted
    // ONLY at the lane.json-declared authDir, at a path that shares NOTHING
    // with the legacy convention ($HOME/.handoff/chatgpt-auth-<id>) this
    // file's OWN prior draft re-derived. If _token_dir ever regresses to
    // that convention instead of reading lane.json (task-10-fix-rulings.md
    // I-2), the login check looks in the wrong place — nothing is planted
    // there — and refuses even though a real, valid credential sits exactly
    // where lane.json said it would.
    const home = mkTmp('ccgpt-usage-authdir-');
    const id = mintId();
    const distinctiveAuthDir = `.distinctive-oauth-home-${id}`;
    const dir = join(home, '.ccrc', 'codex', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'lane.json'), JSON.stringify({ probeModel: 'gpt-5.6-luna', authDir: distinctiveAuthDir }));
    mkdirSync(join(home, distinctiveAuthDir), { recursive: true });
    writeFileSync(join(home, distinctiveAuthDir, 'auth.json'), '{}');
    // Deliberately no $HOME/.handoff/chatgpt-auth-<id> at all.
    const { url, close } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).toBe(0); // succeeds only if authDir came from lane.json, not a convention
    } finally {
      await close();
    }
  });

  it('task-10: refuses when CCGPT_ACCOUNT_ID is unset — no first-lane default', async () => {
    // `runPyAsync`: this case's own endpoint is bound and pointed-at (to
    // measure zero contact below), so the same same-process-deadlock
    // reasoning as the two cases above applies if a future mutation ever
    // let an unset id fall through further than it does today.
    const home = mkTmp('ccgpt-usage-noid-');
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), {
        home,
        env: {
          PYTHONPATH: PYSTUB_DIR,
          // CCGPT_ACCOUNT_ID deliberately omitted.
          CCGPT_USAGE_ENDPOINT: url,
        },
      });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/CCGPT_ACCOUNT_ID/);
      expect(requests.length).toBe(0);
    } finally {
      await close();
    }
  });

  it('task-10: refuses a non-loopback CCGPT_USAGE_ENDPOINT rather than falling through to it', async () => {
    // task-10-rulings.md §1: the plan's draft text asked for this override
    // to be "ignored" when non-loopback, which would mean falling through
    // to the real production endpoint — this suite would then make a live
    // call to the Codex usage API. Overruled: refuse instead, loudly.
    //
    // `.invalid` is reserved by RFC 2606 to never resolve — chosen so that
    // even a REGRESSION in the loopback check cannot make this case reach
    // a real host: the worst case is a fast, local DNS failure, not a
    // network connection anywhere. The refusal fires before any network
    // attempt, so the plain synchronous `runPy` is safe here. A real
    // loopback server IS bound (but never pointed at) so this case also
    // proves the refusal did not accidentally reach THIS box's own mock
    // either (task-10-fix-rulings.md M-7).
    const home = mkTmp('ccgpt-usage-nonloopback-');
    const id = mintId();
    plantLane(home, id);
    const { close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = runPy(ccgptFile('ccgpt-usage.py'), {
        home, timeoutMs: 5_000, env: publisherEnv(id, 'http://example.invalid/usage'),
      });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/CCGPT_USAGE_ENDPOINT/);
      expect(r.stderr).toMatch(/loopback/);
      expect(existsSync(limitsPath(home, id))).toBe(false);
      expect(requests.length).toBe(0);
    } finally {
      await close();
    }
  });

  it('task-10 fix round 1 (C-1): refuses to follow a redirect — a second hop is never reached', async () => {
    // Reviewer's Probe B, reproduced: the mock answers 302 pointing at a
    // SECOND path on the SAME bound port (staying inside this suite's
    // single reserved port, 45020, rather than opening a second one) —
    // reaching /second-hop would only be possible if the publisher
    // followed the redirect. It answers /second-hop with forged, valid-
    // looking usage headers, so a code path that DID follow would publish
    // a real-looking row instead of merely erroring, if the refusal fails.
    const home = mkTmp('ccgpt-usage-redirect-');
    const id = mintId();
    plantLane(home, id);
    const { url, close, requests } = await startEndpoint((req, res) => {
      if (req.url === '/second-hop') {
        res.writeHead(200, {
          'x-codex-primary-used-percent': '99',
          'x-codex-secondary-used-percent': '99',
          'x-codex-secondary-window-minutes': '300',
        });
        res.end();
        return;
      }
      res.writeHead(302, { Location: `http://127.0.0.1:${USAGE_PORT}/second-hop` });
      res.end();
    });
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(existsSync(limitsPath(home, id))).toBe(false);
      expect(requests.length).toBe(1);          // the first hop only — /second-hop was never reached
      expect(requests[0].headers['authorization']).toBeTruthy(); // the vetted first hop legitimately carries it
    } finally {
      await close();
    }
  });

  it('task-10 fix round 1 (C-1): a redirect status carrying usage headers is still refused, never published', async () => {
    // The "widens the hazard" half: even with the second hop unreachable,
    // an HTTPError for the 302 ITSELF carries whatever headers the FIRST
    // hop's own response set. If those happen to include
    // x-codex-primary-used-percent, the broad "any HTTPError with the
    // usage header is valid" carve-out would otherwise publish a redirect
    // response as if it were a real measurement, with no second hop
    // needing to be followed at all.
    const home = mkTmp('ccgpt-usage-redirect-headers-');
    const id = mintId();
    plantLane(home, id);
    const { url, close, requests } = await startEndpoint((req, res) => {
      res.writeHead(302, {
        Location: 'http://example.invalid/steal',
        'x-codex-primary-used-percent': '13', // forged directly on the 302
      });
      res.end();
    });
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(existsSync(limitsPath(home, id))).toBe(false);
      expect(requests.length).toBe(1);
    } finally {
      await close();
    }
  });

  it('task-10 fix round 1 (C-2/C-3): sends the Codex-CLI header block and the lane\'s own probeModel', async () => {
    // C-2: captures the outgoing request and asserts the constant header
    // block (originator/user-agent/session_id) this repo's own
    // ccd/ccrc-models-probe documents as what the backend expects, plus
    // Authorization — and asserts ChatGPT-Account-Id is deliberately ABSENT
    // (see ccd/ccgpt-usage.py's own docstring for why it is dropped, not
    // merely missing by omission).
    // C-3: asserts body.model equals the PLANTED probeModel, with two
    // different planted values (below) so the match cannot be coincidental
    // — the reviewer's own mutation (hard-coding the model) left the old
    // suite green at 10/10 because nothing checked this.
    const home1 = mkTmp('ccgpt-usage-request1-');
    const id1 = mintId();
    const model1 = 'gpt-5.6-terra';
    plantLane(home1, id1, model1);
    const ep1 = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home: home1, env: publisherEnv(id1, ep1.url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).toBe(0);
      expect(ep1.requests.length).toBe(1);
      const captured = ep1.requests[0];
      expect(captured.headers['originator']).toBe('codex_cli_rs');
      expect(captured.headers['user-agent']).toMatch(/^codex_cli_rs\//);
      expect(captured.headers['session_id']).toBeTruthy();
      expect(captured.headers['authorization']).toBe('Bearer stub-token-not-a-secret');
      expect(captured.headers['chatgpt-account-id']).toBeUndefined();
      expect((captured.body as { model?: unknown }).model).toBe(model1);
    } finally {
      await ep1.close();
    }

    // Second, differently-planted value — proves the match above was not
    // coincidental (e.g. a stray hard-coded string that happened to equal
    // model1).
    const home2 = mkTmp('ccgpt-usage-request2-');
    const id2 = mintId();
    const model2 = 'gpt-5.6-sol';
    plantLane(home2, id2, model2);
    const ep2 = await startEndpoint(fullHeaders());
    try {
      const r2 = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home: home2, env: publisherEnv(id2, ep2.url) });
      expect(r2.timedOut).toBe(false);
      expect(r2.status).toBe(0);
      expect(ep2.requests.length).toBe(1);
      expect((ep2.requests[0].body as { model?: unknown }).model).toBe(model2);
    } finally {
      await ep2.close();
    }
  });
});
