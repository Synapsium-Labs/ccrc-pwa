// Fix round 5 (task 14 follow-up, Important #1 — rated Minor but the round's
// own "most important" item): the property everyone agrees is the point —
// local mode's boot never blocks on the local-caps probe — was guarded by
// NOTHING that runs the real composition root. `lifecycle.test.ts`'s
// non-blocking test MIRRORS `index.ts`'s shape by hand; `readme-holds.test.ts`
// gained a fast TEXT pin against the literal `await` regression the reviewer
// constructed, but a text pin proves the source was not reverted, not that
// the PROPERTY holds at runtime. This file is the slow, real, authoritative
// half: it spawns THIS EXACT FILE (`server/src/index.ts`, via the same `tsx`
// command `package.json`'s own `dev` script runs) as a genuine child process,
// against a genuinely hung `ccd` stub, and measures how long `/health` takes
// to answer — the same methodology the reviewer used live, made permanent.
//
// A SENSITIVITY CONTROL is included deliberately (not just a "does it pass"
// assertion): one test temporarily re-awaits the read (by spawning against a
// COPY of index.ts with the fix reverted) and asserts the SAME harness
// detects the resulting slow boot — proof the fast-boot assertions above it
// are evidence of the property holding, not merely evidence the harness
// cannot tell a fast boot from a slow one.
//
// CLEANUP IS ITS OWN CONCERN HERE, deliberately over-engineered relative to
// most test files in this suite: the server under test spawns its OWN
// detached grandchild (`localcaps.ts`'s probe, in its own process GROUP by
// design — see that file's "two residuals" doc comment). Killing the
// server process does NOT reach it; every stub `ccd` this file writes
// therefore records its own PID first, and `afterEach` kills both the
// server and every recorded probe PID's whole group.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const tsx = path.join(serverRoot, 'node_modules', '.bin', 'tsx');
const indexTs = path.join(serverRoot, 'src', 'index.ts');

const PID_FILE_NAME = '.probe-pids';

/** Every invocation of the stub records its OWN pid before doing anything
 *  else — a detached process-group leader, per `localcaps.ts`'s own
 *  `spawn(..., { detached: true })` — so `killEverything` below can reach
 *  it even after the server process that spawned it is gone. */
const writeStubCcd = (home: string, body: string): void => {
  const dir = path.join(home, '.local', 'bin');
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'ccd');
  writeFileSync(p, `#!/bin/sh\necho $$ >> '${path.join(home, PID_FILE_NAME)}'\n${body}\n`);
  chmodSync(p, 0o755);
};

/** A minimal, real `~/.ccrc/accounts.json` — `loadConfig` refuses to boot
 *  without one, by design. */
const writeRoster = (home: string): void => {
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'accounts.json'), JSON.stringify({
    version: 1,
    accounts: [{
      id: 'claude', label: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
    }],
  }));
};

/** A port unlikely to collide across parallel test files — derived from
 *  this process's own pid, which is unique per vitest worker. */
let portCounter = 0;
const freshPort = (): number => 21000 + (process.pid % 4000) + (portCounter++) * 7;

let child: ChildProcess | undefined;
let currentHome: string | undefined;

const killGroup = (pid: number, signal: NodeJS.Signals): void => {
  try { process.kill(-pid, signal); } catch { /* already gone, or never a group leader */ }
  try { process.kill(pid, signal); } catch { /* already gone */ }
};

afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null && typeof child.pid === 'number') {
    // `tsx` (node_modules/.bin/tsx -> tsx/dist/cli.mjs) does NOT exec-replace
    // itself into the node process that actually runs `entry` — it spawns a
    // genuine child (`node --require preflight.cjs --import loader.mjs
    // <entry>`) and stays alive as a supervisor. A plain `child.kill()` only
    // reaches that supervisor; killing it orphans the real server process,
    // which then keeps listening. Measured live: after a plain SIGKILL, the
    // inner node process survived, reparented to PID 1 (systemd --user).
    // Exactly the ccd/grandchild shape already fixed in localcaps.ts (round
    // 4) — same fix, same reason: `detached: true` below makes `child.pid`
    // a process-GROUP leader whose own children inherit that group, so a
    // group kill here reaches both the wrapper and the real server.
    killGroup(child.pid, 'SIGKILL');
  }
  child = undefined;
  if (currentHome) {
    const pidFile = path.join(currentHome, PID_FILE_NAME);
    if (existsSync(pidFile)) {
      const pids = readFileSync(pidFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map(Number);
      for (const pid of pids) if (Number.isFinite(pid)) killGroup(pid, 'SIGKILL');
    }
  }
  currentHome = undefined;
  // Let the OS actually release the port before the next test claims one —
  // cheap insurance against EADDRINUSE flakiness between tests in this file.
  await new Promise((r) => setTimeout(r, 50));
});

/** Boots `entry` (a real file path — `index.ts` or a mutated copy of it) as
 *  a genuine child process and polls `/health` until it answers or the
 *  overall budget runs out. Returns the elapsed ms to a successful answer,
 *  or `null` if the budget was exhausted first. `budgetMs` is generous by
 *  design (this proves an UPPER bound on real boot time, not a tight one) —
 *  the assertions in the tests below are what make it meaningful, not the
 *  budget itself. */
async function timeToHealth(
  home: string, entry: string, port: number, budgetMs: number,
): Promise<number | null> {
  currentHome = home;
  const start = Date.now();
  child = spawn(tsx, [entry], {
    cwd: serverRoot,
    env: {
      ...process.env,
      CCRC_HOME: home, CCRC_HOST: '127.0.0.1', CCRC_PORT: String(port),
      // Neither push nor a mail token is configured — both are optional,
      // and the warnings they print on stderr are expected noise here.
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    // See `afterEach`: `tsx` spawns its own child node process rather than
    // exec-replacing itself, so this process must lead its own group for a
    // cleanup kill to reach that child too.
    detached: true,
  });
  // Drain stdio so a full pipe buffer can never itself stall the child.
  child.stdout?.on('data', () => undefined);
  child.stderr?.on('data', () => undefined);

  while (Date.now() - start < budgetMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.status === 200) {
        const body = await res.json() as { ok?: boolean };
        if (body.ok === true) return Date.now() - start;
      }
    } catch {
      // Connection refused (not listening yet) or the process hasn't
      // bound the port — keep polling.
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

describe('the real composition root — boot never blocks on the local-caps probe', () => {
  it('a hung ccd (sleep 600, the reviewer\'s own reproduction) does not delay listen', async () => {
    const home = mkTmp('ccrc-boot-');
    writeRoster(home);
    writeStubCcd(home, 'sleep 600');
    const elapsed = await timeToHealth(home, indexTs, freshPort(), 8_000);
    expect(elapsed, '/health must answer well within the 8s budget, not time out').not.toBeNull();
    // Generous relative to the reviewer's own measured baseline (~700-800ms)
    // but tight relative to the 10s LOCAL_CAPS_TIMEOUT_MS bound this test
    // exists to prove boot does not wait on — a regression that reintroduced
    // the block would land at or past that ceiling, not merely a bit slower.
    expect(elapsed, 'boot took long enough to suggest it waited on the probe').toBeLessThan(3_000);
  }, 15_000);

  it('a valid, instant ccd also boots fast — the hung case above is not fast merely by refusing connections', async () => {
    const home = mkTmp('ccrc-boot-');
    writeRoster(home);
    writeStubCcd(home, 'echo start\necho stop\necho stop-surface\nexit 0');
    const elapsed = await timeToHealth(home, indexTs, freshPort(), 8_000);
    expect(elapsed).not.toBeNull();
    expect(elapsed!).toBeLessThan(3_000);
  }, 15_000);

  // THE SENSITIVITY CONTROL. Without this, "boot is fast" could mean either
  // "the property holds" or "this harness cannot detect a slow boot at
  // all" (a stuck /health poll racing a generous budget, a fetch that
  // silently retries forever, …). Proven apart: a MUTATED copy of index.ts
  // with the exact round-4 regression (`await` restored) run through the
  // IDENTICAL harness must measure a slow boot — and did, live, when the
  // reviewer did this by hand (10953ms). This test reproduces that
  // methodology automatically rather than trusting the one-off measurement
  // to still be true.
  it('SENSITIVITY CONTROL: the harness itself detects a slow boot when the read IS awaited', async () => {
    const home = mkTmp('ccrc-boot-');
    writeRoster(home);
    writeStubCcd(home, 'sleep 600');

    const original = readFileSync(indexTs, 'utf8');
    expect(original, 'the exact call this control mutates must still be present').toContain(
      'void readLocalCcdCaps(cfg.ccdBin).then((verbs) => {',
    );
    const blocked = original.replace(
      'void readLocalCcdCaps(cfg.ccdBin).then((verbs) => {',
      'await readLocalCcdCaps(cfg.ccdBin).then((verbs) => {',
    );
    expect(blocked, 'the replace must have actually changed something').not.toBe(original);

    // The mutant imports its sibling modules by RELATIVE path (`./server.js`
    // etc.), so it has to live BESIDE them — a temp-dir copy would not
    // resolve. Distinctive name, always removed in `finally`, never written
    // back over the real file (also gitignored as a backstop).
    const mutantPath = path.join(serverRoot, 'src', '__boot_control_mutant__.ts');
    writeFileSync(mutantPath, blocked);
    try {
      // A short budget on purpose: the mutant blocks for the full 10s
      // `LOCAL_CAPS_TIMEOUT_MS` against a `sleep 600` stub, so a 3s budget
      // (the same ceiling the real tests above must beat) proves the
      // control fails to answer in time — i.e. the harness DOES tell the
      // two cases apart.
      const elapsed = await timeToHealth(home, mutantPath, freshPort(), 3_000);
      expect(elapsed, 'the control must NOT answer within the same 3s budget the real file beats').toBeNull();
    } finally {
      rmSync(mutantPath, { force: true });
    }
  }, 15_000);
});
