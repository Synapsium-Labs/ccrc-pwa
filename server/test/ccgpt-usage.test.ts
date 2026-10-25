// server/test/ccgpt-usage.test.ts
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type IncomingMessage, type IncomingHttpHeaders, type ServerResponse, type Server } from 'node:http';
import {
  writeFileSync, mkdirSync, chmodSync, readFileSync, existsSync, lstatSync, copyFileSync, readdirSync, renameSync, symlinkSync,
  openSync, writeSync, closeSync, unlinkSync, constants as fsConstants,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { pythonOrSkip, runPy, runPyAsync, ccgptFile, PYSTUB_DIR } from './ccgptHarness.js';
import { mkTmp } from './tmpHelpers.js';
import { codexAuthDir } from './codexLaneFixture.js';
import {
  AUTH_LIB, CLOSED_AUTH_BASE, driverLines, fakeAuthServer, plantBackendCredential, runAuthDriver,
} from './codexAuthFixture.js';
import { BRIDGE_FILES, runBridgeDriver } from './codexBridgeFixture.js';

// Probed once at module scope — same shape as ccgpt-harness.test.ts and
// ccgpt-proxy.test.ts (task-10-rulings.md (commit af7cc0bc) §5): a missing interpreter must be
// a visible skip, not every case below quietly `return`ing and vitest
// reporting a green suite for work that never ran.
const PY = pythonOrSkip();

it('this box has a usable python3', () => {
  if (process.env.CI) expect(PY).toBeTruthy();
});

// task-10 fix round 3 (task-10-fix-rulings-3.md item 2, re-review V-3,
// commit 467e9552): the
// atomicity case's read-only-target discriminator holds only because
// `euid !== 0` — root bypasses the file write bit entirely, so under root
// the guard would prove nothing even though the subject still succeeds. It
// used to hard-FAIL there instead of skipping, so a root CI container went
// red for a non-defect — "a false red is worse than an unpinned claim
// [...] it trains the next reader to ignore the suite." Computed once,
// matching `PY`'s own shape, but DELIBERATELY not a CI hard-assert the way
// the python sentinel above is: CI containers legitimately run as root
// often enough that asserting non-root under CI would recreate the exact
// false-red failure this fix removes. A genuine, visible skip is the right
// signal in EITHER environment, not only outside CI.
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

// task-10 fix round 3 (task-10-fix-rulings-3.md item 1, fix round 2's own
// concern 1, commit 467e9552): the task-10 M-4 case below needs `litellm` to be genuinely
// UNIMPORTABLE under a fixture HOME with no `PYTHONPATH`, or it is
// vacuous. On a box where `litellm` is installed SYSTEM-WIDE rather than
// under this operator's user-site, overriding `HOME` hides nothing — the
// import would succeed, and the case would still pass (`CCGPT_ACCOUNT_ID`
// is still unset either way) without ever exercising the import ORDERING
// it exists to pin, silently. Probed once, synchronously via `runPy` —
// matching `PY`'s own memoised-sync shape — by actually running `import
// litellm` under the SAME containment the real task-10 M-4 case uses, rather than
// trusting the design spec's claim about a box this one might not be.
const NO_AMBIENT_LITELLM: boolean = (() => {
  if (!PY) return false;
  const home = mkTmp('ccgpt-usage-m4-precondition-');
  const probe = join(home, 'litellm-probe.py');
  writeFileSync(probe, 'import litellm\n');
  const r = runPy(probe, { home }); // no PYTHONPATH: the real litellm, or nothing
  return r.status !== 0;
})();

it('this box hides litellm from a fixture HOME with no PYTHONPATH (task-10 M-4 precondition)', () => {
  // Unlike IS_ROOT above, this DOES hard-assert under CI: a public-repo CI
  // image is not expected to carry litellm at all (this suite's own stub
  // package exists precisely because the box it was written on doesn't
  // either), so this precondition failing in CI signals a real environment
  // change worth knowing about, not a common, legitimate state the way a
  // root container is.
  if (process.env.CI) expect(NO_AMBIENT_LITELLM).toBe(true);
});

// task-12 fix round 1: the `::1` acceptance case below needs the IPv6
// loopback interface to actually exist — `server.listen(PORT, '::1')`
// errors on a box without one, which would red that ONE case for a
// non-defect: `_is_loopback` never ran, nothing about the allowlist is
// wrong, the environment just cannot exercise this spelling. Checked via
// `os.networkInterfaces()` — a static read, no bind attempt, no socket —
// so this computes synchronously at module scope like `IS_ROOT` above, not
// via a spawned probe like `NO_AMBIENT_LITELLM`. Same policy as `IS_ROOT`,
// for the same reason: DELIBERATELY not a CI hard-assert. A CI container
// lacking IPv6 loopback is a legitimate, common state (unlike the
// litellm-absence NO_AMBIENT_LITELLM's own precondition test DOES assert
// on, where absence is the expected, load-bearing case for this public
// repo) — asserting its presence under CI would recreate exactly the
// false-red-for-a-non-defect failure task-10 fix round 3 removed. The
// `::1` entry in `_LOOPBACK_HOSTS` is therefore pinned by this suite only
// where IPv6 loopback exists — stated here so that limitation is visible
// at the site, not inferred by a future reader from the skip alone.
const HAS_IPV6_LOOPBACK = Object.values(os.networkInterfaces()).some(
  (addrs) => addrs?.some((i) => i.family === 'IPv6' && i.internal && i.address === '::1'),
);

// task-10-rulings.md (commit af7cc0bc) §5: "Ports: 45020 for this suite. 45010/45011 belong to
// the proxy suite and the two cannot run at once." A fixed port, not an
// OS-assigned one, matching the proxy suite's own convention.
const USAGE_PORT = 45020;

/** lane.json's one writer (spec §5.4), resolved from this file's path the way
 *  `ccgptFile` resolves the publisher — see the task-6 case below. */
const MODELS_OP = fileURLToPath(new URL('../../deploy/models-op.mjs', import.meta.url));

// Minted, never shared (task-10-rulings.md (commit 4893935a) §5). Each case gets its own lane
// id, so two cases can never collide over a leftover row.
let mintedIdCount = 0;
function mintId(): string {
  mintedIdCount += 1;
  return `codex-a-${process.pid}-${mintedIdCount}`;
}

/** Plants `~/.ccrc/codex/<id>/lane.json` with `probeModel` and `authDir`
 *  fields — the two things this wave's ccgpt-usage.py reads from it
 *  (lane.json had no writer until Plan 2b, task-10-brief.md (commit 4893935a);
 *  it has one now, `deploy/models-op.mjs`, and the task-6 case below reads
 *  what that writer produced instead of calling this helper). By default
 *  also plants a signed-in credential at that `authDir`:
 *  `plantBackendCredential`'s synthetic backend credential, fresh, its account
 *  id `acct-<id>` (codex-bridge Stage 1, Task 7: the publisher reads it through
 *  the auth library now, so an empty object would read `absent`). Every case
 *  is "logged in" unless it opts out via `{ loggedIn: false }` (the I-3
 *  refusal case). Returns the lane.json authDir's planted credential (null
 *  when none was planted), so a case can compare the bearer it sent.
 *
 *  Measured while writing the fix-round mutations: planting auth.json ONLY
 *  at the lane.json-declared authDir made mutation 4 (task-10 I-2 — re-deriving the
 *  token dir by a naming convention instead of reading lane.json) cascade
 *  into 9 of 14 cases, including all five of the brief's OWN property
 *  cases, because every one of them logs in through THIS helper and none of
 *  them is testing task-10 I-2 at all. So `loggedIn: true` now plants auth.json at
 *  BOTH the lane.json path and the legacy convention-derived path
 *  (`$HOME/.handoff/chatgpt-auth-<id>`) — every case using the default stays
 *  green regardless of which derivation `_token_dir` uses, and task-10 I-2 gets its
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
): ReturnType<typeof plantBackendCredential> | null {
  const { loggedIn = true } = opts;
  const dir = join(home, '.ccrc', 'codex', id);
  mkdirSync(dir, { recursive: true });
  const authDir = `.local/share/ccrc/codex/${id}`;
  writeFileSync(join(dir, 'lane.json'), JSON.stringify({ probeModel: model, authDir }));
  if (!loggedIn) return null;
  const planted = plantBackendCredential(join(home, authDir), { accountId: `acct-${id}` });
  plantBackendCredential(join(home, `.handoff/chatgpt-auth-${id}`), { accountId: `acct-${id}` });
  return planted;
}

/** The lane's authDir, absolute, as `plantLane` lays it out. */
const laneAuthDir = (home: string, id: string): string => join(home, codexAuthDir(id));

/** The credential compared by lstat (size, mtime, inode), never read by a test. */
function credentialStat(dir: string): { size: number; mtimeMs: number; ino: number } {
  const st = lstatSync(join(dir, 'auth.json'));
  return { size: st.size, mtimeMs: st.mtimeMs, ino: st.ino };
}

/** The tier's refresher meets a refusal (codex-bridge Stage 1, Task 7): the library's own `ensure_fresh`, run by the
 *  driver against a fake token endpoint, writes the status file the publisher then reads (needs-signin for
 *  invalid_grant, config-error for invalid_client). The credential it refreshes is re-planted expiring, unless `o`
 *  plants it fresh and has the driver refresh it early (`withinS`). `o.consts` are set on the driver's copy of the
 *  library only (its "NOTHING BINDS A CONSTANT EARLY" rule), so a status recorded under another `CLIENT_ID` carries
 *  another `configHash` than the publisher's library computes. */
async function recordRefusal(
  home: string, dir: string, error: string, word: string,
  o: { expiresIn?: number; withinS?: number; consts?: Record<string, unknown> } = {},
): Promise<void> {
  plantBackendCredential(dir, { expiresIn: o.expiresIn ?? 30 });
  const srv = await fakeAuthServer({ token: [{ status: 400, body: { error } }] });
  try {
    const op = { op: 'ensure_fresh', lane: 'codex-a', ...(o.withinS === undefined ? {} : { withinS: o.withinS }) };
    const r = await runAuthDriver(home, { authDir: dir, ops: [op], ...(o.consts ? { consts: o.consts } : {}) },
      { CCRC_CODEX_AUTH_BASE: srv.base });
    expect(driverLines(r.stdout)[0]?.['error'], r.stderr).toBe(word);
    expect(srv.requests).toHaveLength(1);
  } finally {
    await srv.close();
  }
}

function limitsPath(home: string, id: string): string {
  return join(home, '.cc-limits', `${id}.json`);
}

function readRow(home: string, id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(limitsPath(home, id), 'utf8'));
}

/** Task 6: renders `~/.ccrc/codex/<id>/lane.json` with the REAL writer
 *  (`deploy/models-op.mjs`), never by hand — a codex-kind roster row, `init
 *  codex`, then each of `mutations` (the argv after `--id`) — and plants
 *  `auth.json` ONLY at the roster's `authDir`, a path that shares nothing with
 *  any naming convention, so a publisher that re-derived its token directory
 *  instead of reading the manifest finds nothing there.
 *
 *  Synchronous (`spawnSync`), so a caller runs it BEFORE binding its endpoint:
 *  the materialiser opens no socket, so blocking the event loop here starves
 *  nothing (D-3157 is about a mock that must answer mid-run). */
function materialiseLane(home: string, id: string, mutations: string[][]): void {
  const authDir = `.${id}-oauth-fixture`;
  const roster = join(home, '.ccrc', 'accounts.json');
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(roster, `${JSON.stringify({
    version: 1,
    accounts: [
      { id: 'claude', label: 'claude', configDirSuffix: '.claude',
        exec: { kind: 'upstream' }, homeAble: true, telemetry: 'anthropic' },
      { id, label: id, configDirSuffix: `.claude-${id}`,
        exec: { kind: 'codex', provider: 'openai', proxyPort: 45010, litellmPort: 45011, authDir },
        homeAble: false, telemetry: 'codex' },
    ],
  }, null, 2)}\n`);
  for (const [verb, ...rest] of [['init', '--probe', 'codex'], ...mutations]) {
    const m = spawnSync(process.execPath, [MODELS_OP, verb!, '--file', roster, '--id', id, ...rest],
      { cwd: home, env: { ...process.env, HOME: home }, encoding: 'utf8' });
    expect(m.status, `models-op ${verb}: ${m.stdout}${m.stderr}`).toBe(0);
  }
  // A signed-in credential, read through the auth library (codex-bridge Stage 1, Task 7).
  plantBackendCredential(join(home, authDir), { accountId: `acct-${id}` });
}

/** The registry FILE's haiku class — the oracle a materialised lane.json's
 *  `probeModel` is checked against, rather than a literal. */
function haikuOf(home: string, id: string): unknown {
  const registry = JSON.parse(readFileSync(join(home, '.ccrc', 'models', `${id}.classes.json`), 'utf8'));
  return (registry as { classes: { haiku: unknown } }).classes.haiku;
}

type CapturedRequest = { headers: IncomingHttpHeaders; body: unknown };

/** Binds a one-shot HTTP server on the fixed usage port, records every
 *  request it receives (headers + parsed JSON body, when the body parses)
 *  into `requests`, then runs `handler` to answer it — the loopback
 *  stand-in for the real Codex usage endpoint that `CCGPT_USAGE_ENDPOINT`
 *  points the subject at.
 *
 *  `requests` is what closes task-10 M-7 (task-10-fix-rulings.md,
 *  commit 4893935a): every case below
 *  that expects the publisher to refuse WITHOUT ever reaching the network
 *  now binds this and asserts `requests.length === 0` — "never contacted"
 *  measured, not merely argued from the refusal's exit code. It is also
 *  what task-10 C-2/C-3's capturing case needs to assert the request the publisher
 *  actually sent, and what the task-10 C-1 redirect cases need to assert a second
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
 *  `x-codex-plan-type` (M-6, task-10 fix round 1) was dropped: nothing in this
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

// task-10-fix-rulings-2.md, S-5: every case in this file uses `runPyAsync`
// EXCEPT the non-loopback-endpoint refusal below, which is the only one
// whose bound server is never pointed at even under its own mutation (its
// own comment explains why plain `runPy` is safe there specifically). See
// `runPy`'s own docstring in `ccgptHarness.ts` for the same-process-mock
// deadlock (D-3157) that rules `runPy` out for every case whose mock must
// answer while the child runs.

/** Composes the env a "happy path" or lane-scoped case passes to the
 *  publisher: the lane id and the endpoint to poll. `extra` lets a caller add
 *  or override one key without hand-writing the other two. No PYTHONPATH
 *  (codex-bridge Stage 1, Task 7): the publisher imports nothing of LiteLLM
 *  now, and loads the auth library from beside itself. It runs through
 *  `containedSpawnOptions`, so its CCRC_CODEX_AUTH_BASE is CLOSED_AUTH_BASE
 *  unless `extra` names a `fakeAuthServer`. */
function publisherEnv(id: string, endpoint: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
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
      // task-10-rulings.md (commit af7cc0bc) §3: the brief's negative regex over the WHOLE
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

  it.skipIf(IS_ROOT)('task-10: the write is atomic — a read-only existing row is still updated', async () => {
    // task-10-fix-rulings.md I-5 / task-10-fix-rulings-3.md item 2
    // (commit 467e9552): the
    // discriminator holds only because `euid !== 0` — root bypasses the
    // write bit entirely, so the direct-write mutation (Step 5, #5) would
    // go green under root with no signal that the guard proved nothing.
    // Skipped visibly (`IS_ROOT`, module scope) rather than hard-failing —
    // failing here would red a root CI container for a non-defect.
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

  it('task-10, settled by Plan 3a Task 8: refuses when lane.json is absent, naming the two acts that render it', async () => {
    // Deliberately no plantLane() call. A reachable endpoint IS running
    // (never contacted) so the refusal can only be explained by lane.json,
    // not by a coincidental network failure. Uses `runPyAsync`, not the
    // plain synchronous `runPy`, even though the FIXED code refuses before
    // any network attempt: measured while writing this fix round (see the
    // task-10 I-3 case below), a mutation that removes the very refusal this case
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
      expect(r.stderr).toMatch(/lane\.json does not exist; run `ccrc doctor --fix` \(no class registry yet: /);
      // A lane with no class registry has nothing `--fix` can render from:
      // the act that renders its lane.json then is `init`, named with THIS id.
      expect(r.stderr).toContain(`(no class registry yet: \`ccrc models ${id} init codex\`)`);
      expect(existsSync(limitsPath(home, id))).toBe(false);
      expect(requests.length).toBe(0); // task-10 M-7 (task-10-fix-rulings.md, commit 4893935a): never contacted, measured
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
      // codex-bridge Stage 1, Task 7: the word and its remedy come first.
      expect(r.stderr.startsWith(`ccgpt-usage: not-logged-in: run ccrc codex login ${id} — `), r.stderr).toBe(true);
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
    // I-2, commit 4893935a), the login check looks in the wrong place — nothing is planted
    // there — and refuses even though a real, valid credential sits exactly
    // where lane.json said it would.
    const home = mkTmp('ccgpt-usage-authdir-');
    const id = mintId();
    const distinctiveAuthDir = `.distinctive-oauth-home-${id}`;
    const dir = join(home, '.ccrc', 'codex', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'lane.json'), JSON.stringify({ probeModel: 'gpt-5.6-luna', authDir: distinctiveAuthDir }));
    plantBackendCredential(join(home, distinctiveAuthDir));
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

  it.skipIf(!NO_AMBIENT_LITELLM)('task-10 fix round 2 (M-4): refuses on unset CCGPT_ACCOUNT_ID even with no litellm importable — never an ImportError', async () => {
    // task-10 M-1 (task-10-fix-rulings-2.md, commit f813102e): fix round 1 moved the `from litellm...`
    // import past the CCGPT_ACCOUNT_ID/CCGPT_USAGE_ENDPOINT refusals so an
    // unset id on a box with no litellm still gets the named refusal rather
    // than a raw ImportError — but every OTHER case in this file puts the
    // stub package on PYTHONPATH, so that ordering was never exercised:
    // reverting it left 15/15 green (re-review, task-10 V-2).
    //
    // This case constructs the actual absence rather than merely asserting
    // it cannot be constructed: deliberately NO `PYTHONPATH` (so the litellm
    // stub is not on `sys.path`) and NO `CCGPT_ACCOUNT_ID`. Gated on
    // `NO_AMBIENT_LITELLM` (task-10-fix-rulings-3.md item 1, commit 467e9552): without that
    // gate, a box where `litellm` is importable even under a fixture HOME
    // (installed somewhere `HOME`-independent) would make this case pass
    // vacuously — the refusal still fires because `CCGPT_ACCOUNT_ID` is
    // unset, but the import-ordering property it exists to pin would never
    // actually be exercised, silently.
    const home = mkTmp('ccgpt-usage-noid-nolitellm-');
    const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), {
      home,
      env: {
        // CCGPT_ACCOUNT_ID and PYTHONPATH both deliberately omitted.
        CCGPT_USAGE_ENDPOINT: `http://127.0.0.1:${USAGE_PORT}`,
      },
    });
    expect(r.timedOut).toBe(false);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/CCGPT_ACCOUNT_ID/);
    // The regression this case exists to catch answers with a traceback
    // naming the import machinery instead — assert its absence explicitly,
    // not just the presence of the real message above.
    expect(r.stderr).not.toMatch(/ImportError/);
    expect(r.stderr).not.toMatch(/ModuleNotFoundError/);
  });

  it('task-10: refuses a non-loopback CCGPT_USAGE_ENDPOINT rather than falling through to it', async () => {
    // task-10-rulings.md (commit af7cc0bc) §1: the plan's draft text asked for this override
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
    // task-10 C-2: captures the outgoing request and asserts the constant header
    // block (originator/user-agent/session_id) this repo's own
    // ccd/ccrc-models-probe documents as what the backend expects, plus
    // Authorization. (ChatGPT-Account-Id was asserted ABSENT here until
    // codex-bridge Stage 1 Task 7, D-6373: the publisher now sends it from the
    // auth library's reading, and its own case below pins that, so this case
    // no longer names it.) task-10-fix-rulings-3.md (commit 4893935a) item 3
    // (re-review V-1): the three Codex-CLI header VALUES are asserted
    // exactly, not merely their presence — `ccd/ccrc-models-probe` ships
    // these as fixed literals the backend is documented to expect from "a
    // real Codex CLI caller", so a silently changed value is the same class
    // of failure task-10 C-2 closed (the backend answers with no usage headers and
    // nothing says why).
    // task-10 C-3: asserts body.model equals the PLANTED probeModel, with two
    // different planted values (below) so the match cannot be coincidental
    // — the reviewer's own mutation (hard-coding the model) left the old
    // suite green at 10/10 because nothing checked this.
    const home1 = mkTmp('ccgpt-usage-request1-');
    const id1 = mintId();
    const model1 = 'gpt-5.6-terra';
    const planted1 = plantLane(home1, id1, model1);
    const ep1 = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home: home1, env: publisherEnv(id1, ep1.url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).toBe(0);
      expect(ep1.requests.length).toBe(1);
      const captured = ep1.requests[0];
      expect(captured.headers['originator']).toBe('codex_cli_rs');
      expect(captured.headers['user-agent']).toBe('codex_cli_rs/0.0.0 (Unknown 0; unknown) unknown');
      expect(captured.headers['session_id']).toBe('00000000-0000-0000-0000-000000000000');
      // The lane's own credential, read through the auth library (codex-bridge Stage 1, Task 7). A boolean: a
      // failing `toBe` would print the synthetic token. ChatGPT-Account-Id is pinned by its own case below.
      expect(captured.headers['authorization'] === `Bearer ${planted1!.access}`, 'the bearer is the credential\'s').toBe(true);
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

  // -------------------------------------------------------------------
  // Task 6 of the 2b1 plan — D-3158's real gap. Every case above reads a
  // lane.json `plantLane` wrote BY HAND, and so did the reader's own pins:
  // a fixture and a reader written together agree with each other, and would
  // agree just as well with a producer that spelled the key differently or
  // put the wrong value in it. This case plants nothing: the REAL materialiser
  // (`deploy/models-op.mjs`, the one writer spec §5.4 names) renders lane.json
  // from a codex-kind roster row and a class registry, and the REAL publisher
  // reads it — so the two agree through the writer, or this reds.
  //
  // The materialiser runs through `spawnSync`, deliberately, and BEFORE the
  // endpoint is bound: it opens no socket, so blocking the event loop there
  // can starve nothing. The publisher runs through `runPyAsync` (D-3157), and
  // that holds under a mutation too — a producer that dropped or renamed
  // `probeModel` makes the publisher REFUSE, and a refusal needs no answer from
  // the mock, so this case reds on its assertions rather than on a deadlock.
  it('task-6 (D-3158): publishes from a lane.json the REAL materialiser wrote, not a hand-planted one', async () => {
    const home = mkTmp('ccgpt-usage-materialised-');
    const id = mintId();
    // `init` plants the seed; `set-class` then moves haiku onto an id the seed
    // does not carry, so the value can only have come from the registry this
    // lane has NOW — the one an operator's reclassification leaves behind.
    materialiseLane(home, id, [['set-class', '--class', 'haiku', '--model', 'gpt-x-mini']]);
    expect(existsSync(join(home, '.ccrc', 'codex', id, 'lane.json'))).toBe(true);
    // The oracle is the registry FILE, not a literal; the next line is the
    // control that it holds the reclassified id rather than the seed's.
    const probeModel = haikuOf(home, id);
    expect(probeModel).toBe('gpt-x-mini');
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status, r.stderr).toBe(0);
      expect(requests.length).toBe(1);
      expect((requests[0].body as { model?: unknown }).model).toBe(probeModel);
      expect(readRow(home, id)).toMatchObject({ five: 17, seven: 42 });
    } finally {
      await close();
    }
  });

  // The writer's OTHER output, through the same two real programs: haiku
  // unassigned, so lane.json carries no `probeModel` at all (the writer omits
  // it rather than choosing a fallback). The refusal must name the act that
  // cures it. `ccrc doctor --fix` does not — its lane.json arm re-renders,
  // and a re-render would read the same null — so this pins the remedy the
  // publisher now names, and that the old one is gone. A mutation that let the
  // publisher proceed would reach a mock that answers, so `runPyAsync` keeps
  // that red an assertion rather than a deadlock (D-3157).
  it('task-6 fix round 1 (T2): refuses a materialised lane.json with haiku unassigned, naming set-class haiku', async () => {
    const home = mkTmp('ccgpt-usage-materialised-nohaiku-');
    const id = mintId();
    materialiseLane(home, id, [['set-class', '--class', 'haiku', '--model', 'none']]);
    expect(haikuOf(home, id)).toBeNull();
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/carries no usable probeModel/);
      expect(r.stderr).toContain(`ccrc models ${id} set-class haiku <modelId>`);
      expect(r.stderr).not.toMatch(/doctor --fix/);
      expect(requests.length).toBe(0);
      expect(existsSync(limitsPath(home, id))).toBe(false);
    } finally {
      await close();
    }
  });

  // Final review F-7: the authDir refusal named `ccrc doctor --fix`, which
  // then rendered no lane.json. It now names a `ccrc models` mutation, and this case
  // proves that remedy WORKS rather than pinning its text alone: the real
  // materialiser writes the manifest, `authDir` is then stripped from it (a
  // hand edit, or a writer that predates the field), the publisher refuses,
  // one mutation through the real writer re-renders it, and the publisher then
  // publishes. The ABSENT-file refusal's remedy above is Plan 3a Task 8's:
  // `ccrc doctor --fix`, whose lane.json arm renders a missing manifest.
  it('final review F-7: a lane.json with no authDir is refused naming a models mutation, and that mutation cures it', async () => {
    const home = mkTmp('ccgpt-usage-no-authdir-');
    const id = mintId();
    materialiseLane(home, id, [['set-class', '--class', 'haiku', '--model', 'gpt-x-mini']]);
    const lanePath = join(home, '.ccrc', 'codex', id, 'lane.json');
    const manifest = JSON.parse(readFileSync(lanePath, 'utf8')) as Record<string, unknown>;
    expect(typeof manifest['authDir'], 'the real writer wrote no authDir to strip').toBe('string');
    delete manifest['authDir'];
    writeFileSync(lanePath, `${JSON.stringify(manifest, null, 2)}\n`);
    let ep = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, ep.url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/carries no usable authDir/);
      expect(r.stderr).toContain(`ccrc models ${id} set-class haiku <modelId>`);
      expect(r.stderr).not.toMatch(/doctor --fix/);
      expect(ep.requests.length).toBe(0);
    } finally {
      await ep.close();
    }
    // The remedy, through the real writer — the same verb and flags the
    // refusal names — then the same publisher, unchanged.
    const roster = join(home, '.ccrc', 'accounts.json');
    const m = spawnSync(process.execPath,
      [MODELS_OP, 'set-class', '--file', roster, '--id', id, '--class', 'haiku', '--model', 'gpt-x-mini'],
      { cwd: home, env: { ...process.env, HOME: home }, encoding: 'utf8' });
    expect(m.status, `models-op set-class: ${m.stdout}${m.stderr}`).toBe(0);
    expect(typeof (JSON.parse(readFileSync(lanePath, 'utf8')) as Record<string, unknown>)['authDir'],
      'the mutation did not re-render authDir').toBe('string');
    ep = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, ep.url) });
      expect(r.timedOut).toBe(false);
      expect(r.status, r.stderr).toBe(0);
      expect(ep.requests.length).toBe(1);
    } finally {
      await ep.close();
    }
  });

  // -------------------------------------------------------------------
  // Task 11 — the pinned default endpoint, and the seam's own guard.
  //
  // task-10's review (task-10-review.md (commit fa59cdbe), "SECOND JOB") measured
  // `_is_loopback` correctly refusing eleven look-alike spellings, but the
  // shipped suite (through fix round 3) pinned only one of them — the
  // `http://example.invalid/usage` case above. A measurement taken once by
  // a reviewer who is gone is not a mechanism: a later "simplification" of
  // the check to a substring test would red some of the spellings below
  // (whichever carry the literal text `127.0.0.1`), pass the rest, and
  // look like a clean refactor while leaking a bearer token off-box.
  // Pinning the table — and the compiled-in default nothing else asserts —
  // is this task's whole scope (task-11-rulings.md §1).

  it('task-11: the compiled-in default endpoint is the production URL (import-only, no network)', () => {
    // task-11-rulings.md (commit fa59cdbe) §3: importing the module runs `_usage_endpoint()`
    // at module scope and then STOPS — `main()` sits behind
    // `if __name__ == "__main__"`, so importing the file opens no socket
    // and needs no mock server. `CCGPT_USAGE_ENDPOINT` is deliberately
    // absent from env below (not merely empty), so `_usage_endpoint()`
    // resolves to `DEFAULT_USAGE_ENDPOINT` unchanged. The filename has a
    // hyphen and cannot be imported by module name, so the runner script
    // below uses `importlib.util.spec_from_file_location` (rulings' own
    // instruction) and prints both resolved constants as JSON. Plain
    // synchronous `runPy` is safe here — no mock server is bound at all,
    // matching the NO_AMBIENT_LITELLM precondition probe above, the file's
    // other no-server case.
    const home = mkTmp('ccgpt-usage-default-');
    const id = mintId();
    const runner = join(home, 'import-default-endpoint.py');
    writeFileSync(runner, [
      'import importlib.util',
      'import json',
      'import sys',
      '',
      'spec = importlib.util.spec_from_file_location("ccgpt_usage_under_test", sys.argv[1])',
      'module = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(module)',
      'print(json.dumps({',
      '    "default": module.DEFAULT_USAGE_ENDPOINT,',
      '    "resolved": module.USAGE_ENDPOINT,',
      '}))',
      '',
    ].join('\n'));
    const r = runPy(runner, {
      home,
      args: [ccgptFile('ccgpt-usage.py')],
      // CCGPT_USAGE_ENDPOINT deliberately omitted — never set at all, not
      // merely empty, so os.environ.get(...) sees a true absence.
      env: { PYTHONPATH: PYSTUB_DIR, CCGPT_ACCOUNT_ID: id },
    });
    expect(r.timedOut).toBe(false);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    // Pin the VALUE (task-11-rulings.md §3), not merely the presence of a
    // literal in source — this is the resolved runtime constant, read back
    // off the imported module.
    expect(parsed.default).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(parsed.resolved).toBe(parsed.default);
  });

  // The eleven look-alike spellings task-10's review measured refused
  // (task-10-review.md (commit fa59cdbe)'s "SECOND JOB" section), pinned as a table rather
  // than resting on that one-time measurement. The genuinely-loopback
  // spellings the same review measured ACCEPTED (`LOCALHOST`, `[::1]`,
  // bare `127.0.0.1`) are exercised elsewhere in this file already — every
  // happy-path case above points CCGPT_USAGE_ENDPOINT at a bound
  // `127.0.0.1` mock and succeeds — and acceptance is out of this table's
  // scope, which is refusal only.
  const LOOKALIKE_LOOPBACK_ENDPOINTS: Array<{ label: string; url: string }> = [
    { label: 'prefix lookalike', url: 'https://127.0.0.1.evil.test/usage' },
    { label: 'userinfo', url: 'http://127.0.0.1@evil.test/usage' },
    { label: 'userinfo, localhost spelling', url: 'http://localhost@evil.test/usage' },
    { label: 'suffix lookalike', url: 'http://localhost.evil.test/usage' },
    { label: 'userinfo + port + prefix', url: 'https://127.0.0.1.evil.test:443@evil.test/usage' },
    { label: 'adjacent-character', url: 'http://127.0.0.1x.test/usage' },
    { label: 'IPv4-as-integer', url: 'http://2130706433/usage' },
    { label: 'IPv4 shorthand', url: 'http://127.1/usage' },
    { label: 'IPv4-mapped IPv6', url: 'http://[::ffff:127.0.0.1]/usage' },
    { label: 'trailing dot', url: 'http://127.0.0.1./usage' },
    { label: 'uppercase suffix lookalike', url: 'http://LOCALHOST.EVIL.TEST/usage' },
  ];

  it.each(LOOKALIKE_LOOPBACK_ENDPOINTS)('task-11: refuses look-alike loopback host — $label ($url)', async ({ url }) => {
    const home = mkTmp('ccgpt-usage-lookalike-');
    const id = mintId();
    plantLane(home, id);
    // A real loopback server IS bound (never pointed at) — the same task-11 M-7
    // discipline the existing non-loopback case above uses: proves the
    // refusal reached neither the (unreachable-by-design) host the
    // override names nor this suite's own mock.
    const { close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/CCGPT_USAGE_ENDPOINT/);
      expect(r.stderr).toMatch(/loopback/);
      expect(existsSync(limitsPath(home, id))).toBe(false);
      expect(requests.length).toBe(0); // task-10 M-7 (task-10-fix-rulings.md, commit 4893935a): never contacted, measured
    } finally {
      await close();
    }
  });

  // task-12 E: Task 11 pinned the loopback allowlist eleven ways on the
  // REFUSAL side and once on the accept side (bare `127.0.0.1`, exercised
  // implicitly by every happy-path case above via `startEndpoint`).
  // `_LOOPBACK_HOSTS` is `{"127.0.0.1", "localhost", "::1"}` — deleting
  // `localhost` or `::1` from that set reds nothing in the suite as it
  // stood, so a legitimate loopback spelling could silently start being
  // refused with no test noticing. These two cases mirror the existing
  // happy-path shape (bind a real mock, point `CCGPT_USAGE_ENDPOINT` at a
  // loopback spelling, assert the row gets written) for the two spellings
  // that were accept-side-unpinned.
  it('task-12: accepts a non-numeric loopback spelling — localhost', async () => {
    const home = mkTmp('ccgpt-usage-loopback-localhost-');
    const id = mintId();
    plantLane(home, id);
    // Bound on 127.0.0.1 only, like every other happy-path case — `localhost`
    // resolves to `::1` first in this environment (confirmed: `::1
    // localhost` precedes `127.0.0.1 localhost` in /etc/hosts), but
    // `socket.create_connection` (under `urlopen`) falls through to the
    // NEXT address `getaddrinfo` returns when the first refuses the
    // connection, so the request still lands here. What this case pins is
    // `_is_loopback` treating the HOSTNAME `localhost` as loopback at all —
    // deleting it from `_LOOPBACK_HOSTS` reds this with the SAME refusal
    // shape the look-alike table above asserts, not a connection error.
    const { url, close, requests } = await startEndpoint(fullHeaders());
    const endpoint = url.replace('127.0.0.1', 'localhost');
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, endpoint) });
      expect(r.timedOut).toBe(false);
      expect(r.status).toBe(0);
      expect(requests.length).toBe(1);
      const row = readRow(home, id);
      expect(row).toMatchObject({ five: 17, seven: 42 });
    } finally {
      await close();
    }
  });

  it.skipIf(!HAS_IPV6_LOOPBACK)('task-12: accepts a non-numeric loopback spelling — ::1', async () => {
    // Skipped visibly (`HAS_IPV6_LOOPBACK`, module scope, no CI hard-assert
    // — see that const's own comment) on a box with no IPv6 loopback
    // interface: this suite pins `::1` in `_LOOPBACK_HOSTS` only where
    // that interface exists to prove it against.
    const home = mkTmp('ccgpt-usage-loopback-ipv6-');
    const id = mintId();
    plantLane(home, id);
    // `startEndpoint` binds 127.0.0.1 only (module-scoped, shared with
    // every other case in this file), so `::1` needs its own bind on the
    // IPv6 loopback interface specifically — the property under test is
    // whether `_is_loopback` accepts the HOSTNAME `::1`, which a server
    // reachable only over IPv4 could not exercise.
    const requests: CapturedRequest[] = [];
    const server: Server = createServer((req, res) => {
      requests.push({ headers: req.headers, body: null });
      fullHeaders()(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.on('error', reject);
      server.listen(USAGE_PORT, '::1', () => resolve());
    });
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), {
        home,
        env: publisherEnv(id, `http://[::1]:${USAGE_PORT}`),
      });
      expect(r.timedOut).toBe(false);
      expect(r.status).toBe(0);
      expect(requests.length).toBe(1);
      const row = readRow(home, id);
      expect(row).toMatchObject({ five: 17, seven: 42 });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // codex-bridge Stage 1, Task 7: the publisher only READS the lane's credential, through the auth library loaded
  // from beside it. It never refreshes (in litellm mode only the lane's tier does) and never signs in; each reading
  // it cannot use is one refusal line, remedy first, and nothing is published. Every case below that could reach a
  // token endpoint runs against a `fakeAuthServer` and asserts it saw no request.
  it('a dead credential: login-required at once, no token request, nothing published', async () => {
    const home = mkTmp('ccgpt-usage-dead-');
    const id = mintId();
    plantLane(home, id);
    // The marker an abandoned device sign-in leaves: backend family, no tokens. The library reads it `incomplete`.
    const dir = laneAuthDir(home, id);
    writeFileSync(join(dir, 'auth.json'), JSON.stringify({ device_code_requested_at: 1 }));
    const before = credentialStat(dir);
    const files = readdirSync(dir).sort();
    const srv = await fakeAuthServer({});
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), {
        home, env: publisherEnv(id, url, { CCRC_CODEX_AUTH_BASE: srv.base }),
      });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr.startsWith(`ccgpt-usage: login-required: run ccrc codex login ${id} — `), r.stderr).toBe(true);
      expect(srv.requests, 'a token request was made').toHaveLength(0);
      expect(credentialStat(dir), 'auth.json was written').toEqual(before);
      expect(readdirSync(dir).sort(), 'the reader wrote into the authDir').toEqual(files);
      expect(existsSync(limitsPath(home, id))).toBe(false);
      expect(requests.length).toBe(0);
    } finally {
      await close();
      await srv.close();
    }
  });

  it('a needs-signin the tier recorded for this credential is login-required FIRST on stderr, never token-expired; nothing published', async () => {
    const home = mkTmp('ccgpt-usage-needs-signin-');
    const id = mintId();
    plantLane(home, id);
    await recordRefusal(home, laneAuthDir(home, id), 'invalid_grant', 'needs-signin');
    const srv = await fakeAuthServer({});
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), {
        home, env: publisherEnv(id, url, { CCRC_CODEX_AUTH_BASE: srv.base }),
      });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr.startsWith(`ccgpt-usage: login-required: run ccrc codex login ${id} — `), r.stderr).toBe(true);
      expect(r.stderr).not.toContain('token-expired');
      expect(srv.requests).toHaveLength(0);
      expect(existsSync(limitsPath(home, id))).toBe(false);
      expect(requests.length).toBe(0);
    } finally {
      await close();
      await srv.close();
    }
  });

  it('another family\'s file is credential-unusable, naming ccrc doctor; nothing published', async () => {
    const home = mkTmp('ccgpt-usage-foreign-');
    const id = mintId();
    plantLane(home, id);
    // The Codex CLI's own shape: a `tokens` object. The library reads it `foreign-family`.
    writeFileSync(join(laneAuthDir(home, id), 'auth.json'), JSON.stringify({ tokens: {} }));
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr.startsWith('ccgpt-usage: credential-unusable: run ccrc doctor — '), r.stderr).toBe(true);
      expect(existsSync(limitsPath(home, id))).toBe(false);
      expect(requests.length).toBe(0);
    } finally {
      await close();
    }
  });

  it('a config-error the tier recorded is credential-unusable, naming ccrc update, then ccrc codex login; nothing published', async () => {
    const home = mkTmp('ccgpt-usage-config-error-');
    const id = mintId();
    plantLane(home, id);
    await recordRefusal(home, laneAuthDir(home, id), 'invalid_client', 'config-error');
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr.startsWith(`ccgpt-usage: credential-unusable: run ccrc update, then ccrc codex login ${id} — `),
        r.stderr).toBe(true);
      expect(existsSync(limitsPath(home, id))).toBe(false);
      expect(requests.length).toBe(0);
    } finally {
      await close();
    }
  });

  // The library's own `_bars` rule, which the publisher asks through `bars` (D-6692): a config-error measured under
  // another OAuth configuration is stale (a `ccrc update` that fixed the client cures it), so it bars nothing.
  it('a config-error recorded under another OAuth configuration bars nothing: the poll publishes', async () => {
    const home = mkTmp('ccgpt-usage-config-error-stale-');
    const id = mintId();
    plantLane(home, id);
    // A fresh credential, refreshed early by a library whose CLIENT_ID is another one.
    await recordRefusal(home, laneAuthDir(home, id), 'invalid_client', 'config-error',
      { expiresIn: 3600, withinS: 7200, consts: { CLIENT_ID: 'app_fixture_older_client' } });
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).not.toContain('credential-unusable');
      expect(requests.length).toBe(1);
      expect(readRow(home, id)).toMatchObject({ five: 17, seven: 42 });
    } finally {
      await close();
    }
  });

  // Review Focus 1: a torn or unparseable credential is never answered with a sign-in.
  it('an unparseable credential is credential-unusable, naming ccrc doctor, never login-required; nothing published', async () => {
    const home = mkTmp('ccgpt-usage-unreadable-');
    const id = mintId();
    plantLane(home, id);
    const dir = laneAuthDir(home, id);
    // Torn JSON: the library re-reads it, then reads it `unreadable`.
    writeFileSync(join(dir, 'auth.json'), '{"access_token":', { mode: 0o600 });
    const before = credentialStat(dir);
    const files = readdirSync(dir).sort();
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr.startsWith('ccgpt-usage: credential-unusable: run ccrc doctor — '), r.stderr).toBe(true);
      expect(r.stderr).not.toContain('login-required');
      expect(credentialStat(dir), 'auth.json was written').toEqual(before);
      expect(readdirSync(dir).sort(), 'the reader wrote into the authDir').toEqual(files);
      expect(existsSync(limitsPath(home, id))).toBe(false);
      expect(requests.length).toBe(0);
    } finally {
      await close();
    }
  });

  // Review Focus 3: an idle lane whose access token expired. In litellm mode only the tier refreshes, on its next
  // request; a reader that refreshed would spend the single-use refresh token outside the tier's lock.
  it('an expired token is never refreshed by a reader: token-expired, no request, nothing published', async () => {
    const home = mkTmp('ccgpt-usage-expired-');
    const id = mintId();
    plantLane(home, id);
    const dir = laneAuthDir(home, id);
    plantBackendCredential(dir, { accountId: `acct-${id}`, expiresIn: -600 });
    const before = credentialStat(dir);
    // A fake that WOULD answer a refresh, so a reader that asked would be seen asking, and would succeed.
    const srv = await fakeAuthServer({ token: [{ status: 200, body: { access_token: 'x', id_token: 'y', refresh_token: 'z' } }] });
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), {
        home, env: publisherEnv(id, url, { CCRC_CODEX_AUTH_BASE: srv.base }),
      });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('ccgpt-usage: token-expired: none needed — the lane\'s tier refreshes it on its next '
        + 'request; if its refresh token is dead, that request records needs-signin');
      expect(srv.requests.length, 'a token request was made').toBe(0);
      expect(credentialStat(dir), 'the reader wrote the credential').toEqual(before);
      expect(existsSync(limitsPath(home, id))).toBe(false);
      expect(requests.length).toBe(0);
    } finally {
      await close();
      await srv.close();
    }
  });

  // D-6373: the account id the library reads (the file's, else the tokens' claim) rides as ChatGPT-Account-Id, and
  // the identity block stays the Codex CLI's (`originator: ccrc` waits for the bridge).
  it('sends ChatGPT-Account-Id, and originator stays codex_cli_rs', async () => {
    const home = mkTmp('ccgpt-usage-account-id-');
    const id = mintId();
    plantLane(home, id);
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status, r.stderr).toBe(0);
      expect(requests.length).toBe(1);
      expect(requests[0].headers['chatgpt-account-id']).toBe(`acct-${id}`);
      expect(requests[0].headers['originator']).toBe('codex_cli_rs');
    } finally {
      await close();
    }
  });

  it('no library beside the publisher: auth-library-absent, naming ccrc update; nothing published', async () => {
    const home = mkTmp('ccgpt-usage-nolib-');
    const id = mintId();
    plantLane(home, id);
    // The publisher alone, as a box whose update placed it without the library would have it.
    const bin = join(home, 'lone-bin');
    mkdirSync(bin, { recursive: true });
    copyFileSync(ccgptFile('ccgpt-usage.py'), join(bin, 'ccgpt-usage.py'));
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(join(bin, 'ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr.startsWith('ccgpt-usage: auth-library-absent: run ccrc update — '), r.stderr).toBe(true);
      expect(existsSync(limitsPath(home, id))).toBe(false);
      expect(requests.length).toBe(0);
    } finally {
      await close();
    }
  });

  // A library beside the publisher that is there but cannot serve: one that raises on import, and one that defines
  // `read` only. Each is the one refusal, FIRST on stderr, naming the exception's class and never its arguments
  // (the library's load failure may carry text it was handed), and no traceback.
  it('a library that does not import, or lacks a reader: auth-library-absent naming only the class; nothing published', async () => {
    const shapes = {
      'raises-on-import': { src: 'raise RuntimeError("arg-text-the-refusal-never-prints")\n', cls: 'RuntimeError' },
      'read-only': {
        src: 'class _R:\n    credential = "present"\n    detail = ""\n    access_token = "x"\n'
          + '    account_id = None\n    expires_at = None\n\n\ndef read(auth_dir):\n    return _R()\n',
        cls: 'AttributeError',
      },
    } as const;
    for (const [shape, { src, cls }] of Object.entries(shapes)) {
      const home = mkTmp(`ccgpt-usage-badlib-${shape}-`);
      const id = mintId();
      plantLane(home, id);
      const bin = join(home, 'bad-lib-bin');
      mkdirSync(bin, { recursive: true });
      copyFileSync(ccgptFile('ccgpt-usage.py'), join(bin, 'ccgpt-usage.py'));
      writeFileSync(join(bin, 'ccgpt-auth.py'), src);
      const { url, close, requests } = await startEndpoint(fullHeaders());
      try {
        const r = await runPyAsync(join(bin, 'ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
        expect(r.timedOut, shape).toBe(false);
        expect(r.status, shape).not.toBe(0);
        expect(r.stderr.startsWith('ccgpt-usage: auth-library-absent: run ccrc update — '), `${shape}: ${r.stderr}`).toBe(true);
        expect(r.stderr.includes(`(${cls})`), `${shape}: the class is named`).toBe(true);
        expect(r.stderr.includes('arg-text-the-refusal-never-prints'), `${shape}: the exception's argument printed`).toBe(false);
        expect(r.stderr.includes('Traceback'), `${shape}: a traceback`).toBe(false);
        expect(existsSync(limitsPath(home, id)), shape).toBe(false);
        expect(requests.length, shape).toBe(0);
      } finally {
        await close();
      }
    }
  });

  // The unit runs `<runtime python> -I ~/.local/bin/ccgpt-usage.py` (deploy/systemd/ccrc-codex-usage@.service): under
  // `-I` neither the script's directory nor PYTHONPATH is on sys.path, so the library is loaded by its path, beside
  // the publisher's own real path. `runPy`'s runs use no `-I`, so this case spawns the interpreter itself.
  it('loads the library the way production does: a copy beside it, under -I, with no PYTHONPATH', async () => {
    const home = mkTmp('ccgpt-usage-installed-');
    const id = mintId();
    plantLane(home, id);
    const bin = join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    copyFileSync(ccgptFile('ccgpt-usage.py'), join(bin, 'ccgpt-usage.py'));
    copyFileSync(AUTH_LIB, join(bin, 'ccgpt-auth.py'));
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
        const child = spawn(PY!, ['-I', join(bin, 'ccgpt-usage.py')], {
          cwd: home,
          env: {
            PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, CCGPT_ACCOUNT_ID: id, CCGPT_USAGE_ENDPOINT: url,
            CCRC_CODEX_AUTH_BASE: CLOSED_AUTH_BASE,
          },
          stdio: ['ignore', 'ignore', 'pipe'],
        });
        let stderr = '';
        const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
        child.stderr!.on('data', (c: Buffer) => { stderr += c.toString(); });
        child.once('error', (e) => { clearTimeout(timer); reject(e); });
        child.once('close', (code) => { clearTimeout(timer); resolve({ code, stderr }); });
      });
      expect(r.code, r.stderr).toBe(0);
      expect(requests.length).toBe(1);
      expect(readRow(home, id)).toMatchObject({ five: 17, seven: 42 });
      expect(existsSync(join(bin, '__pycache__')), 'loading the library wrote bytecode beside it').toBe(false);
    } finally {
      await close();
    }
  });
});

// ── codex bridge Stage 2, Task 14: the poller's direct arm (spec 2026-10-15 §2.6's table: "in `direct` mode reads the
// usage the bridge saw on real traffic and asks upstream only when the lane is idle; sends the account id and
// `originator: ccrc`"). The bridge keeps the `x-codex-` values of its last upstream response in its stats file
// (`usageHeaders`, `ccd/codexbridge/stats.py`); these cases write that file with the bridge's own writer, through the
// driver, never by hand, so the shape the poller reads is the shape the bridge writes.

/** The values the bridge saw, distinct from `fullHeaders`' 42/17, so a row says which source it came from. */
const BRIDGE_VALUES = {
  'x-codex-primary-used-percent': '61',
  'x-codex-secondary-used-percent': '23',
  'x-codex-secondary-window-minutes': '300',
  'x-codex-primary-reset-at': '4102444800',
  'x-codex-secondary-reset-at': '4102358400',
};

/** `plantLane`'s lane, with lane.json carrying the mode word and the bridge's file names as `laneManifest` renders
 *  them (`deploy/models-op.mjs`). `bridge` is any word: a word other than the two this build knows is a case too. */
function plantModeLane(home: string, id: string, bridge: string): void {
  plantLane(home, id);
  const lane = join(home, '.ccrc', 'codex', id, 'lane.json');
  const doc = JSON.parse(readFileSync(lane, 'utf8')) as Record<string, unknown>;
  writeFileSync(lane, JSON.stringify({ ...doc, id, bridge, upstream: 'backend', bridgeFiles: BRIDGE_FILES }));
}

const statsPath = (home: string, id: string): string => join(home, '.ccrc', 'codex', id, BRIDGE_FILES.stats);

/** The bridge's stats file for lane `id`, written by `codexbridge.stats.Stats` itself: one response's headers seen
 *  at `atS` (epoch seconds), then a forced flush. */
async function bridgeSaw(home: string, id: string, headers: Record<string, string>, atS: number): Promise<void> {
  const ops = [
    { op: 'stats-open', path: statsPath(home, id), lane: id },
    { op: 'stats-call', method: 'usage_headers', args: [headers], kwargs: { now: atS } },
    { op: 'stats-call', method: 'flush', args: [], kwargs: { force: true } },
  ];
  const r = await runBridgeDriver(home, { ops }, {}, { timeoutMs: 30_000 });
  expect(r.timedOut, r.stderr).toBe(false);
  const lines = driverLines(r.stdout);
  expect(lines.map((l) => l['op']), `${r.stdout}\n${r.stderr}`).toEqual(ops.map((o) => o.op));
  for (const l of lines) expect(l['raised'], JSON.stringify(l)).toBeUndefined();
  const doc = JSON.parse(readFileSync(statsPath(home, id), 'utf8')) as { usageHeaders: { values: unknown } | null };
  expect(doc.usageHeaders?.values).toEqual(headers);
}

const nowS = (): number => Math.floor(Date.now() / 1000);

describe.skipIf(!PY)('ccgpt-usage.py: the direct arm (codex bridge Stage 2, Task 14)', () => {
  it('a direct lane with fresh bridge headers publishes with no request', async () => {
    const home = mkTmp('ccgpt-usage-direct-fresh-');
    const id = mintId();
    plantModeLane(home, id, 'direct');
    const at = nowS() - 60;
    await bridgeSaw(home, id, BRIDGE_VALUES, at);
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status, r.stderr).toBe(0);
      expect(requests.length, 'the poller asked upstream though the bridge\'s headers were fresh').toBe(0);
      // `ts` is when the bridge measured them, not when this poll ran (fix round 1, M1): a row is never younger
      // than its measurement.
      expect(readRow(home, id)).toEqual({
        five: 23, seven: 61, ts: at, fiveResetAt: 4102358400, sevenResetAt: 4102444800, fiveWindowMinutes: 300,
      });
      expect(r.stdout).toContain(`ccgpt-usage: ${id} 23%/5h 61%/7d (from the bridge's headers)`);
    } finally {
      await close();
    }
  });

  it('stale headers fall back to one request, originator ccrc', async () => {
    const home = mkTmp('ccgpt-usage-direct-stale-');
    const id = mintId();
    plantModeLane(home, id, 'direct');
    // 901 s: one second past BRIDGE_FRESH_S = 900.
    await bridgeSaw(home, id, BRIDGE_VALUES, nowS() - 901);
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status, r.stderr).toBe(0);
      expect(requests.length).toBe(1);
      expect(requests[0].headers['originator']).toBe('ccrc');
      expect(requests[0].headers['chatgpt-account-id']).toBe(`acct-${id}`);
      // D-TBD-usage-direct-arm-keeps-codex-ua (fix round 1, T14-SPEC-4): the fallback request keeps the one
      // user-agent this file sends on both modes, so a direct lane's poll pairs `originator: ccrc` with it, not
      // with the bridge's ccrc user-agent. Pinned, so the pair a first live check measures is the pair it ships.
      expect(requests[0].headers['user-agent']).toBe('codex_cli_rs/0.0.0 (Unknown 0; unknown) unknown');
      expect(readRow(home, id)).toMatchObject({ five: 17, seven: 42 });
    } finally {
      await close();
    }
  });

  // Fix round 1, M2: the lower side of the bound. 880 s leaves the poll 20 s to start before the stamp passes 900.
  it('headers 880 s old still publish with no request', async () => {
    const home = mkTmp('ccgpt-usage-direct-near-bound-');
    const id = mintId();
    plantModeLane(home, id, 'direct');
    const at = nowS() - 880;
    await bridgeSaw(home, id, BRIDGE_VALUES, at);
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status, r.stderr).toBe(0);
      expect(requests.length, 'a snapshot inside BRIDGE_FRESH_S was not taken').toBe(0);
      expect(readRow(home, id)).toMatchObject({ five: 23, seven: 61, ts: at });
    } finally {
      await close();
    }
  });

  // Fix round 1, M4: D-TBD-usage-direct-arm-reads-no-credential, pinned. A fresh snapshot is published before the
  // poll reads `probeModel` or the credential, so a lane.json with neither and no credential still publishes.
  it('a direct lane with fresh headers publishes without a probe model or a credential', async () => {
    const home = mkTmp('ccgpt-usage-direct-no-cred-');
    const id = mintId();
    const dir = join(home, '.ccrc', 'codex', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'lane.json'), JSON.stringify({
      id, bridge: 'direct', upstream: 'backend', bridgeFiles: BRIDGE_FILES, authDir: `.local/share/ccrc/codex/${id}`,
    }));
    await bridgeSaw(home, id, BRIDGE_VALUES, nowS() - 60);
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status, r.stderr).toBe(0);
      expect(requests.length).toBe(0);
      expect(readRow(home, id)).toMatchObject({ five: 23, seven: 61 });
    } finally {
      await close();
    }
  });

  // Fix round 1, T14-SPEC-2: D-TBD-usage-mode-word-default, pinned. Only the exact word `direct` reads the stats file.
  it('a mode word this build does not know polls as litellm', async () => {
    const home = mkTmp('ccgpt-usage-unknown-mode-');
    const id = mintId();
    plantModeLane(home, id, 'other-word');
    await bridgeSaw(home, id, BRIDGE_VALUES, nowS() - 60);
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status, r.stderr).toBe(0);
      expect(requests.length).toBe(1);
      expect(requests[0].headers['originator']).toBe('codex_cli_rs');
      expect(readRow(home, id)).toMatchObject({ five: 17, seven: 42 });
    } finally {
      await close();
    }
  });

  // Fix round 1, M3: the poller runs from `~/.local/bin` under `-I` and cannot import the bridge's package, so it
  // spells three of its values a second time. This reads both sides' values as python holds them, so a change to
  // one side is a red suite here, not a comment that asks for a second edit.
  it('the poller\'s copies of the bridge\'s values equal the bridge\'s', () => {
    const home = mkTmp('ccgpt-usage-bridge-parity-');
    const script = join(home, 'parity.py');
    writeFileSync(script, [
      'import sys',
      'sys.dont_write_bytecode = True',
      'import importlib.util, json',
      'ccd = sys.argv[1]',
      'sys.path.insert(0, ccd)',
      'from codexbridge import backend, server, stats',
      'spec = importlib.util.spec_from_file_location("ccgpt_usage", ccd + "/ccgpt-usage.py")',
      'u = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(u)',
      'print(json.dumps({',
      '  "originator": [backend.ORIGINATOR, u._ORIGINATOR["direct"]],',
      '  "fileNameRe": [server.FILE_NAME_RE.pattern, u._FILE_NAME_RE.pattern],',
      '  "readMax": [stats.READ_MAX, u._STATS_READ_MAX],',
      '}))',
      '',
    ].join('\n'));
    const r = runPy(script, { home, args: [dirname(ccgptFile('ccgpt-usage.py'))], env: { CCGPT_ACCOUNT_ID: mintId() } });
    expect(r.status, r.stderr).toBe(0);
    const pairs = JSON.parse(r.stdout) as Record<string, [unknown, unknown]>;
    expect(Object.keys(pairs).sort()).toEqual(['fileNameRe', 'originator', 'readMax']);
    for (const [name, [bridge, poller]] of Object.entries(pairs)) expect(poller, name).toEqual(bridge);
  });

  it('a litellm lane is unchanged', async () => {
    const home = mkTmp('ccgpt-usage-litellm-mode-');
    const id = mintId();
    plantModeLane(home, id, 'litellm');
    // Fresh headers in a stats file a litellm lane never reads (one left behind by a switch back from direct).
    await bridgeSaw(home, id, BRIDGE_VALUES, nowS() - 60);
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status, r.stderr).toBe(0);
      expect(requests.length).toBe(1);
      expect(requests[0].headers['originator']).toBe('codex_cli_rs');
      expect(requests[0].headers['chatgpt-account-id']).toBe(`acct-${id}`);
      expect(readRow(home, id)).toMatchObject({ five: 17, seven: 42 });
      expect(r.stdout).not.toContain('bridge');
    } finally {
      await close();
    }
  });

  // Each shape is a stats file the poller cannot take a measurement from; each falls back to today's request (on a
  // direct lane, so `originator: ccrc`), never to a refusal and never to a number nobody measured.
  // Fix round 1 (T14-SPEC-1, I2) added the shapes from `a-path-name` on: each is the one shape that goes red when its
  // guard in `_bridge_headers` is removed, because each holds a document the poller WOULD take without that guard.
  // A shape may answer a cleanup, run once the poll has ended (the FIFO's held ends).
  it('an unreadable stats file falls back to the request', async () => {
    /** A valid, fresh document for lane `id`, written by the bridge, moved out of the stats name; answers its path. */
    const elsewhere = async (home: string, id: string): Promise<string> => {
      await bridgeSaw(home, id, BRIDGE_VALUES, nowS() - 60);
      const other = join(home, '.ccrc', 'codex', `${id}-elsewhere`);
      mkdirSync(other, { recursive: true });
      renameSync(statsPath(home, id), join(other, BRIDGE_FILES.stats));
      return join(other, BRIDGE_FILES.stats);
    };
    const shapes: Record<string, (home: string, id: string) => Promise<void | (() => void)>> = {
      'not-json': async (home, id) => { writeFileSync(statsPath(home, id), '{"version": 1, "lane"', { mode: 0o600 }); },
      absent: async () => { /* the bridge never flushed one */ },
      'a-directory': async (home, id) => { mkdirSync(statsPath(home, id)); },
      'another-lane': async (home, id) => {
        await bridgeSaw(home, id, BRIDGE_VALUES, nowS() - 60);
        const doc = JSON.parse(readFileSync(statsPath(home, id), 'utf8')) as Record<string, unknown>;
        writeFileSync(statsPath(home, id), JSON.stringify({ ...doc, lane: `${id}-other` }), { mode: 0o600 });
      },
      'another-version': async (home, id) => {
        await bridgeSaw(home, id, BRIDGE_VALUES, nowS() - 60);
        const doc = JSON.parse(readFileSync(statsPath(home, id), 'utf8')) as Record<string, unknown>;
        writeFileSync(statsPath(home, id), JSON.stringify({ ...doc, version: 2 }), { mode: 0o600 });
      },
      'a-bad-stamp': async (home, id) => {
        await bridgeSaw(home, id, BRIDGE_VALUES, nowS() - 60);
        const doc = JSON.parse(readFileSync(statsPath(home, id), 'utf8')) as { usageHeaders: Record<string, unknown> };
        writeFileSync(statsPath(home, id), JSON.stringify({ ...doc, usageHeaders: { ...doc.usageHeaders, at: 'soon' } }),
          { mode: 0o600 });
      },
      'a-future-stamp': async (home, id) => { await bridgeSaw(home, id, BRIDGE_VALUES, nowS() + 3600); },
      'no-primary-figure': async (home, id) => {
        const rest: Record<string, string> = { ...BRIDGE_VALUES };
        delete rest['x-codex-primary-used-percent'];
        await bridgeSaw(home, id, rest, nowS() - 60);
      },
      // `_FILE_NAME_RE`: lane.json names a path out of the lane directory, to a valid document of this lane.
      'a-path-name': async (home, id) => {
        await elsewhere(home, id);
        const lane = join(home, '.ccrc', 'codex', id, 'lane.json');
        const doc = JSON.parse(readFileSync(lane, 'utf8')) as Record<string, unknown>;
        writeFileSync(lane, JSON.stringify({
          ...doc, bridgeFiles: { ...BRIDGE_FILES, stats: `../${id}-elsewhere/${BRIDGE_FILES.stats}` },
        }));
      },
      // `O_NOFOLLOW`: the stats name is a symlink to a valid document of this lane.
      'a-symlink': async (home, id) => { symlinkSync(await elsewhere(home, id), statsPath(home, id)); },
      // `O_NONBLOCK`: a FIFO nothing writes to; a blocking open waits for a writer for good.
      'a-fifo-with-no-writer': async (home, id) => {
        const made = spawnSync('mkfifo', [statsPath(home, id)], { encoding: 'utf8' });
        expect(made.status, made.stderr).toBe(0);
      },
      // `S_ISREG`: a FIFO whose buffer holds a valid document of this lane, its write end held open, so a read takes
      // the document and never sees an end of file.
      'a-fifo-with-a-stats-document': async (home, id) => {
        await bridgeSaw(home, id, BRIDGE_VALUES, nowS() - 60);
        const text = readFileSync(statsPath(home, id));
        unlinkSync(statsPath(home, id));
        const made = spawnSync('mkfifo', [statsPath(home, id)], { encoding: 'utf8' });
        expect(made.status, made.stderr).toBe(0);
        const nb = fsConstants.O_NONBLOCK;
        const readEnd = openSync(statsPath(home, id), fsConstants.O_RDONLY | nb);
        const writeEnd = openSync(statsPath(home, id), fsConstants.O_WRONLY | nb);
        expect(writeSync(writeEnd, text)).toBe(text.length);
        return () => { closeSync(writeEnd); closeSync(readEnd); };
      },
      // `_STATS_READ_MAX`: a valid document of this lane padded past 16 MiB with trailing whitespace, which JSON
      // allows, so even the first `_STATS_READ_MAX + 1` bytes parse.
      'over-the-read-cap': async (home, id) => {
        await bridgeSaw(home, id, BRIDGE_VALUES, nowS() - 60);
        const text = readFileSync(statsPath(home, id), 'utf8');
        writeFileSync(statsPath(home, id), text + ' '.repeat(16 * 2 ** 20), { mode: 0o600 });
      },
      // The string-values check: the primary figure is a JSON number, which `_num` would read as 61.
      'a-numeric-value': async (home, id) => {
        await bridgeSaw(home, id, BRIDGE_VALUES, nowS() - 60);
        const doc = JSON.parse(readFileSync(statsPath(home, id), 'utf8')) as { usageHeaders: { values: object } };
        const values = { ...doc.usageHeaders.values, 'x-codex-primary-used-percent': 61 };
        writeFileSync(statsPath(home, id), JSON.stringify({ ...doc, usageHeaders: { ...doc.usageHeaders, values } }),
          { mode: 0o600 });
      },
      // Fix round 2 (R1): each shape below is the one shape that goes red when its guard in `_bridge_headers` is
      // removed, because without the guard the poll raises outside its try and publishes nothing.
      // The `usageHeaders` dict check: the bridge's own document before its first upstream response, which writes
      // `usageHeaders: null` (D-6821) — an idle lane's ordinary state.
      'no-usage-yet': async (home, id) => {
        const ops = [
          { op: 'stats-open', path: statsPath(home, id), lane: id },
          { op: 'stats-call', method: 'flush', args: [], kwargs: { force: true } },
        ];
        const r = await runBridgeDriver(home, { ops }, {}, { timeoutMs: 30_000 });
        expect(r.timedOut, r.stderr).toBe(false);
        expect(driverLines(r.stdout).map((l) => l['op']), `${r.stdout}\n${r.stderr}`).toEqual(ops.map((o) => o.op));
        const doc = JSON.parse(readFileSync(statsPath(home, id), 'utf8')) as Record<string, unknown>;
        expect(doc['lane']).toBe(id);
        expect(doc['usageHeaders']).toBeNull();
      },
      // The document dict check: a JSON array, which has no `.get`.
      'not-an-object': async (home, id) => { writeFileSync(statsPath(home, id), '[]', { mode: 0o600 }); },
      // The `at` string check: a numeric stamp, which `strptime` refuses with a TypeError its except does not name.
      'a-numeric-stamp': async (home, id) => {
        await bridgeSaw(home, id, BRIDGE_VALUES, nowS() - 60);
        const doc = JSON.parse(readFileSync(statsPath(home, id), 'utf8')) as { usageHeaders: Record<string, unknown> };
        writeFileSync(statsPath(home, id), JSON.stringify({ ...doc, usageHeaders: { ...doc.usageHeaders, at: nowS() - 60 } }),
          { mode: 0o600 });
      },
      // The `values` dict check: a fresh stamp over a list of values, which has no `.items`.
      'values-not-an-object': async (home, id) => {
        await bridgeSaw(home, id, BRIDGE_VALUES, nowS() - 60);
        const doc = JSON.parse(readFileSync(statsPath(home, id), 'utf8')) as { usageHeaders: { values: object } };
        const values = Object.entries(doc.usageHeaders.values);
        writeFileSync(statsPath(home, id), JSON.stringify({ ...doc, usageHeaders: { ...doc.usageHeaders, values } }),
          { mode: 0o600 });
      },
      // The `RecursionError` in the read's except: nesting deeper than the parser's recursion limit.
      'deep-nesting': async (home, id) => { writeFileSync(statsPath(home, id), '['.repeat(100_000), { mode: 0o600 }); },
    };
    for (const [shape, plant] of Object.entries(shapes)) {
      const home = mkTmp(`ccgpt-usage-direct-${shape}-`);
      const id = mintId();
      plantModeLane(home, id, 'direct');
      const cleanup = await plant(home, id);
      const { url, close, requests } = await startEndpoint(fullHeaders());
      try {
        const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url), timeoutMs: 10_000 });
        expect(r.timedOut, shape).toBe(false);
        expect(r.status, `${shape}: ${r.stderr}`).toBe(0);
        expect(r.stderr.includes('Traceback'), `${shape}: a traceback`).toBe(false);
        expect(requests.length, shape).toBe(1);
        expect(requests[0].headers['originator'], shape).toBe('ccrc');
        expect(readRow(home, id), shape).toMatchObject({ five: 17, seven: 42 });
      } finally {
        await close();
        if (cleanup) cleanup();
      }
    }
  }, 120_000);
});
