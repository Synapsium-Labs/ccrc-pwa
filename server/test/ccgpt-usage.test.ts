// server/test/ccgpt-usage.test.ts
import { describe, it, expect } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { writeFileSync, mkdirSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { pythonOrSkip, runPy, spawnPy, ccgptFile, PYSTUB_DIR } from './ccgptHarness';
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
// OS-assigned one, matching the proxy suite's own convention — the port
// list itself is the guard against colliding with a real lane's listener on
// a box carrying ~20 live sessions.
const USAGE_PORT = 45020;

// Minted, never shared (task-10-rulings.md §5: "mint anything that must be
// unique per invocation" — the lesson that cost Task 2 two fix rounds when a
// shared lane id let a stale orphan be adopted silently). Each case gets its
// own lane id, so two cases can never collide over a leftover row.
let mintedIdCount = 0;
function mintId(): string {
  mintedIdCount += 1;
  return `codex-a-${process.pid}-${mintedIdCount}`;
}

/** Plants `~/.ccrc/codex/<id>/lane.json` with a `probeModel` field — the one
 *  thing this wave's ccgpt-usage.py reads from it (lane.json has no writer
 *  until Plan 2b, task-10-brief.md). `gpt-5.6-luna` is this repo's own
 *  established fixture model id (server/test/models-op.test.ts and
 *  siblings), never a real OpenAI model name. */
function plantLane(home: string, id: string, model = 'gpt-5.6-luna'): void {
  const dir = join(home, '.ccrc', 'codex', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'lane.json'), JSON.stringify({ probeModel: model }));
}

function limitsPath(home: string, id: string): string {
  return join(home, '.cc-limits', `${id}.json`);
}

function readRow(home: string, id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(limitsPath(home, id), 'utf8'));
}

/** Binds a one-shot HTTP server on the fixed usage port and answers every
 *  request with `handler` — the loopback stand-in for the real Codex usage
 *  endpoint that `CCGPT_USAGE_ENDPOINT` points the subject at. */
function startEndpoint(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer(handler);
    server.on('error', reject);
    server.listen(USAGE_PORT, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${USAGE_PORT}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function drain(req: IncomingMessage): Promise<void> {
  return new Promise((resolve) => {
    req.on('data', () => {});
    req.on('end', () => resolve());
  });
}

/** A 200 (or `status`) answering the full `x-codex-*` header set a real
 *  Codex `/responses` call carries — the happy-path shape every property
 *  case starts from unless it is deliberately varying one header. */
function fullHeaders(status = 200): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    drain(req).then(() => {
      res.writeHead(status, {
        'x-codex-primary-used-percent': '42',
        'x-codex-secondary-used-percent': '17',
        'x-codex-secondary-window-minutes': '300',
        'x-codex-primary-reset-at': '4102444800',   // 2100-01-01, far future
        'x-codex-secondary-reset-at': '4102358400', // one day earlier
        'x-codex-plan-type': 'pro',
      });
      res.end();
    });
  };
}

/** The async sibling `runPy` cannot be for this file's own cases (finding
 *  recorded in the report — not something either rulings file flagged):
 *  `runPy` drives the subject through `spawnSync`, which blocks the WHOLE
 *  Node event loop until the child exits. A case whose mock endpoint is a
 *  `node:http` server living in this SAME test process needs that event
 *  loop free to accept the child's connection and write its response —
 *  under `spawnSync` it never gets the chance, and the child sits waiting
 *  for a response the parent can never send until the parent is done
 *  waiting for the child. Measured directly (see the report): every case
 *  below that needs its mock server to actually answer mid-flight timed
 *  out under `runPy`/`spawnSync` and passed instantly once switched to
 *  `spawnPy`'s async child plus this wrapper. The three cases that refuse
 *  BEFORE any network attempt (unset `CCGPT_ACCOUNT_ID`, absent
 *  `lane.json`, a non-loopback `CCGPT_USAGE_ENDPOINT`) have no such
 *  dependency and use the ordinary synchronous `runPy` — see each case for
 *  which helper it uses and why.
 *
 *  Same discriminated-result shape as `runPy` (`ccgptHarness.ts`): a caller
 *  can tell a clean exit from a harness-enforced kill. `timedOut` here is
 *  this wrapper's OWN timer (mirroring `runPy`'s `err.code === 'ETIMEDOUT'`
 *  derivation) since `spawnPy` itself enforces no deadline — a subject that
 *  never exits is exactly the hazard a one-shot script like ccgpt-usage.py
 *  should never trigger, so the bound exists to fail the CASE loudly rather
 *  than hang the suite. */
function runPyAsync(
  file: string,
  opts: { home: string; env?: Record<string, string>; timeoutMs?: number },
): Promise<{ status: number | null; signal: NodeJS.Signals | null; timedOut: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const { child }: { child: ChildProcess } = spawnPy(file, { home: opts.home, env: opts.env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs ?? 10_000);
    child.stdout?.on('data', (c) => { stdout += c.toString(); });
    child.stderr?.on('data', (c) => { stderr += c.toString(); });
    child.once('error', (err) => { clearTimeout(timer); reject(err); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ status: code, signal: signal ?? null, timedOut, stdout, stderr });
    });
  });
}

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
      expect(raw).toMatch(/": /);            // the separator ccd's grep depends on
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
      drain(req).then(() => {
        res.writeHead(200, { 'x-codex-primary-used-percent': '55' });
        res.end();
      });
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
      drain(req).then(() => {
        // No x-codex-secondary-window-minutes header at all.
        res.writeHead(200, { 'x-codex-primary-used-percent': '10' });
        res.end();
      });
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
      drain(req).then(() => {
        res.writeHead(200, {
          'x-codex-primary-used-percent': '10',
          'x-codex-secondary-window-minutes': '0',
        });
        res.end();
      });
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
    // poll rather than publishing zeros. Doubles as this suite's control
    // for mutation 4 (`server/test/ccgpt-usage.test.ts` docstring below) —
    // it must stay green under every mutation except that one.
    const home = mkTmp('ccgpt-usage-5xx-');
    const id = mintId();
    plantLane(home, id);
    const { url, close } = await startEndpoint((req, res) => {
      drain(req).then(() => {
        res.writeHead(503, {});
        res.end('upstream down');
      });
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
    // task-10-rulings.md §2's deterministic discriminator (verified
    // empirically before relying on it, per the rulings' own instruction —
    // see the report): os.replace(tmp, target) succeeds over a read-only
    // target because permission to replace a directory ENTRY comes from the
    // directory, not the file, while a direct open(target, "w") needs write
    // permission on the file itself and raises PermissionError. So this
    // case reds under the direct-write mutation with a real error, never a
    // timing artefact.
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
    // not by a coincidental network failure — and because the refusal
    // fires before any network attempt, the plain synchronous `runPy` is
    // safe here (see runPyAsync's own docstring for why the cases above
    // cannot use it).
    const home = mkTmp('ccgpt-usage-nolane-');
    const id = mintId();
    const { url, close } = await startEndpoint(fullHeaders());
    try {
      const r = runPy(ccgptFile('ccgpt-usage.py'), { home, timeoutMs: 5_000, env: publisherEnv(id, url) });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/lane\.json/);
      expect(r.stderr).toMatch(/ccrc doctor --fix/);
      expect(existsSync(limitsPath(home, id))).toBe(false);
    } finally {
      await close();
    }
  });

  it('task-10: refuses when CCGPT_ACCOUNT_ID is unset — no first-lane default', () => {
    const home = mkTmp('ccgpt-usage-noid-');
    const r = runPy(ccgptFile('ccgpt-usage.py'), {
      home,
      timeoutMs: 5_000,
      env: {
        PYTHONPATH: PYSTUB_DIR,
        // CCGPT_ACCOUNT_ID deliberately omitted.
        CCGPT_USAGE_ENDPOINT: `http://127.0.0.1:${USAGE_PORT}`,
      },
    });
    expect(r.timedOut).toBe(false);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/CCGPT_ACCOUNT_ID/);
  });

  it('task-10: refuses a non-loopback CCGPT_USAGE_ENDPOINT rather than falling through to it', () => {
    // task-10-rulings.md §1: the plan's draft text asked for this override
    // to be "ignored" when non-loopback, which would mean falling through
    // to the real production endpoint — this suite would then make a live
    // call to the Codex usage API. Overruled: refuse instead, loudly.
    //
    // `.invalid` is reserved by RFC 2606 to never resolve — chosen so that
    // even a REGRESSION in the loopback check cannot make this case reach
    // a real host: the worst case is a fast, local DNS failure, not a
    // network connection anywhere. The refusal fires before any network
    // attempt, so the plain synchronous `runPy` is safe here.
    const home = mkTmp('ccgpt-usage-nonloopback-');
    const id = mintId();
    plantLane(home, id);
    const r = runPy(ccgptFile('ccgpt-usage.py'), {
      home, timeoutMs: 5_000, env: publisherEnv(id, 'http://example.invalid/usage'),
    });
    expect(r.timedOut).toBe(false);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/CCGPT_USAGE_ENDPOINT/);
    expect(r.stderr).toMatch(/loopback/);
    expect(existsSync(limitsPath(home, id))).toBe(false);
  });
});
