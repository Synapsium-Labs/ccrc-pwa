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
// SENSITIVITY CONTROLS are included deliberately (not just a "does it pass"
// assertion): they spawn COPIES of index.ts that wait before listen (the
// fix reverted, and a wait that kills nothing) and assert the SAME verdict
// the real row uses goes red on each — proof the real row's clean verdict
// is evidence of the property holding, not merely evidence the harness
// cannot tell a boot that waited from one that did not.
//
// CLEANUP IS ITS OWN CONCERN HERE, deliberately over-engineered relative to
// most test files in this suite: the server under test spawns its OWN
// detached grandchild (`localcaps.ts`'s probe, in its own process GROUP by
// design — see that file's "two residuals" doc comment). Killing the
// server process does NOT reach it; every stub `ccd` this file writes
// therefore records its own PID first, and `afterEach` kills both the
// server and every recorded probe PID's whole group.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
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

/** True while `pid` is a live process. A zombie (exited, not yet reaped by its parent) counts as gone: `kill(pid, 0)`
 *  alone would still succeed on it. */
const isRunning = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    const stat = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    return stat !== '' && !stat.startsWith('Z');
  } catch {
    return false; // ps exits non-zero when no such process exists
  }
};

let child: ChildProcess | undefined;
/** Every home booted in the current test: `afterEach` kills each one's recorded probe pids. A test may boot more than
 *  once (the hung-ccd verdict below boots a reference first), so this is a list, not one slot. */
let bootedHomes: string[] = [];

const killGroup = (pid: number, signal: NodeJS.Signals): void => {
  try { process.kill(-pid, signal); } catch { /* already gone, or never a group leader */ }
  try { process.kill(pid, signal); } catch { /* already gone */ }
};

const probePids = (home: string): number[] => {
  const pidFile = path.join(home, PID_FILE_NAME);
  if (!existsSync(pidFile)) return [];
  return readFileSync(pidFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
};

/** Stops the booted server and every probe it spawned, in every home this test booted. */
const stopBoots = async (): Promise<void> => {
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
  for (const home of bootedHomes) for (const pid of probePids(home)) killGroup(pid, 'SIGKILL');
  bootedHomes = [];
  // Let the OS actually release the port before the next boot claims one —
  // cheap insurance against EADDRINUSE flakiness between boots in this file.
  await new Promise((r) => setTimeout(r, 50));
};

afterEach(stopBoots);

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
  bootedHomes.push(home);
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

/** The pure hang guard for a boot against a hung `ccd`: `/health` not answering by then is a failure in its own
 *  right. It is NOT what judges "boot did not wait" — `hungBootVerdict` below does that — so it is wide on purpose:
 *  past the 10s `LOCAL_CAPS_TIMEOUT_MS`, so the awaited-caps mutant still answers inside it and is judged by the same
 *  signals as the real file, and far enough past that a loaded runner cannot turn it into a timeout flake. */
const HANG_GUARD_MS = 20_000;

/** How much slower than the reference boot (same runner, same test, a moment earlier) the hung-ccd boot may be.
 *  Written reason for this number: the smallest wait this row must catch without a kill to show for it (an awaited
 *  race against a 4s sleep) adds about 4000 ms, and the hung boot ran at most 266 ms over its reference in 20 runs on a
 *  busy laptop and at most 745 ms over it in 20 runs under 28 extra busy loops (references 2033-4196 ms there). Half
 *  the smallest caught wait leaves room on both sides; a wider margin would let a 2s-3s wait pass, a narrower one
 *  would start judging runner noise. */
const BOOT_MARGIN_MS = 2_000;

/** What the hung-ccd row judges, as a list of failures (empty means boot did not wait). Shared by the real row and
 *  the sensitivity controls so the controls prove THESE signals go red, not some other harness.
 *
 *  1. Every ccd call boot made is still running when `/health` answers. The stub records one pid per invocation and
 *     sleeps 600 s, so any call that was awaited and ended by a timeout kill (the caps read's own 10s bound, or an
 *     `execFile(..., { timeout })` of any length) is dead by the time listen could follow it. This holds however
 *     slow or fast the box is.
 *  2. Boot took at most `BOOT_MARGIN_MS` longer than a reference boot of the real `index.ts` against an instant ccd,
 *     measured just before on the same runner. This catches the await that kills nothing (a race against a sleep),
 *     which signal 1 cannot see, without a fixed wall clock that a loaded runner breaks.
 *  3. The caps read was started at all, so signal 1 is not vacuously true. */
async function hungBootVerdict(entry: string): Promise<{ failures: string[]; referenceMs: number | null; hungMs: number | null }> {
  const failures: string[] = [];

  const instantBoot = async (): Promise<number | null> => {
    const refHome = mkTmp('ccrc-boot-');
    writeRoster(refHome);
    writeStubCcd(refHome, 'echo start\necho stop\necho stop-surface\nexit 0');
    const ms = await timeToHealth(refHome, indexTs, freshPort(), HANG_GUARD_MS);
    await stopBoots();
    return ms;
  };
  // The reference boots twice and keeps the second: the first boot in a fresh worker pays for `tsx` transforming
  // every source file (measured 4183 ms against ~1300 ms warm), which would widen the bound by the same amount.
  await instantBoot();
  const referenceMs = await instantBoot();
  if (referenceMs === null) return { failures: ['the reference boot (instant ccd) never answered'], referenceMs, hungMs: null };

  const home = mkTmp('ccrc-boot-');
  writeRoster(home);
  // The stub also names the pid of its `caps` read, so signal 3 can tell the read was started. It inherits the
  // server's env, so the path comes from `CCRC_HOME`.
  writeStubCcd(home, 'if [ "$1" = caps ]; then echo $$ > "$CCRC_HOME/.caps-pid"; fi\nsleep 600');
  const hungMs = await timeToHealth(home, entry, freshPort(), HANG_GUARD_MS);
  if (hungMs === null) return { failures: [`/health never answered within the ${HANG_GUARD_MS} ms hang guard`], referenceMs, hungMs };

  // Signal 1, taken the moment /health answered.
  const dead = probePids(home).filter((pid) => !isRunning(pid));
  if (dead.length > 0) failures.push(`listen followed a ccd call that was killed: pid(s) ${dead.join(', ')} no longer running when /health answered`);

  // Signal 2.
  if (hungMs > referenceMs + BOOT_MARGIN_MS) {
    failures.push(`boot took ${hungMs} ms against a hung ccd, more than the ${referenceMs} ms reference + ${BOOT_MARGIN_MS} ms margin`);
  }

  // Signal 3.
  const capsPidFile = path.join(home, '.caps-pid');
  const startedBy = Date.now() + 5_000;
  while (!existsSync(capsPidFile) && Date.now() < startedBy) await new Promise((r) => setTimeout(r, 50));
  if (!existsSync(capsPidFile)) failures.push('the local-mode caps read was never started');

  return { failures, referenceMs, hungMs };
}

/** Writes a mutated copy of `index.ts` beside it (its sibling imports are relative, so a temp-dir copy would not
 *  resolve), runs `fn` against it and always removes it. The name is fixed and gitignored, and other suites skip it
 *  by that name while it exists. */
async function withMutant<T>(find: string, replace: string, fn: (mutantPath: string) => Promise<T>): Promise<T> {
  const original = readFileSync(indexTs, 'utf8');
  expect(original, 'the exact text this control mutates must still be present').toContain(find);
  const mutated = original.replace(find, replace);
  expect(mutated, 'the replace must have actually changed something').not.toBe(original);
  const mutantPath = path.join(serverRoot, 'src', '__boot_control_mutant__.ts');
  writeFileSync(mutantPath, mutated);
  try {
    return await fn(mutantPath);
  } finally {
    rmSync(mutantPath, { force: true });
  }
}

/** Three times the guard (two reference boots + the hung boot), the 5s caps-start wait, and slack for cleanup. */
const HUNG_ROW_TIMEOUT_MS = 3 * HANG_GUARD_MS + 10_000;

describe('the real composition root — boot never blocks on the local-caps probe', () => {
  it('a hung ccd (sleep 600, the reviewer\'s own reproduction) does not delay listen', async () => {
    // The row used to assert a fixed 3s wall clock, which loaded shared runners missed (3092 ms, 3570 ms) while boot
    // was fine. `hungBootVerdict` judges the same property with signals a slow box does not break: see its comment.
    const { failures } = await hungBootVerdict(indexTs);
    expect(failures).toEqual([]);
  }, HUNG_ROW_TIMEOUT_MS);

  it('a valid, instant ccd also boots fast — the hung case above is not fast merely by refusing connections', async () => {
    const home = mkTmp('ccrc-boot-');
    writeRoster(home);
    writeStubCcd(home, 'echo start\necho stop\necho stop-surface\nexit 0');
    const elapsed = await timeToHealth(home, indexTs, freshPort(), 8_000);
    expect(elapsed).not.toBeNull();
    expect(elapsed!).toBeLessThan(3_000);
  }, 15_000);

  // THE SENSITIVITY CONTROLS. Without them, "the verdict is clean" could mean either "the property holds" or "these
  // signals cannot see a boot that waited". Each control runs a MUTATED copy of index.ts through the SAME
  // `hungBootVerdict` the real row uses and asserts it goes red on the signal that mutant should trip. The first is the
  // exact round-4 regression (`await` restored), which the reviewer measured by hand at 10953 ms; it trips the
  // killed-call signal, since the caps read only settles when its 10s timeout kills it. The second waits without
  // killing anything (an awaited race between the caps read and a 4s sleep): only the reference-relative time signal
  // can see it, so it proves that signal goes red too.
  it('SENSITIVITY CONTROL: the verdict goes red when the caps read IS awaited', async () => {
    const { failures } = await withMutant(
      'void readLocalCcdCaps(cfg.ccdBin).then((verbs) => {',
      'await readLocalCcdCaps(cfg.ccdBin).then((verbs) => {',
      (mutant) => hungBootVerdict(mutant),
    );
    expect(failures.some((f) => f.startsWith('listen followed a ccd call that was killed')), failures.join('\n')).toBe(true);
  }, HUNG_ROW_TIMEOUT_MS);

  it('SENSITIVITY CONTROL: the verdict goes red when boot awaits a race with a 4s sleep (nothing killed)', async () => {
    const { failures } = await withMutant(
      'await app.listen({ host: cfg.host, port: cfg.port });',
      'await Promise.race([readLocalCcdCaps(cfg.ccdBin), new Promise((r) => setTimeout(r, 4_000))]);\n'
        + 'await app.listen({ host: cfg.host, port: cfg.port });',
      (mutant) => hungBootVerdict(mutant),
    );
    expect(failures.some((f) => f.startsWith('boot took')), failures.join('\n')).toBe(true);
  }, HUNG_ROW_TIMEOUT_MS);
});

/** Polls `/api/fleet/health` on the booted server until its `projectPools` answer equals `want` or the budget runs
 *  out, and returns the last answer seen (`undefined` if none was read). Local mode derives `projectPools` from
 *  `fleetState.ccdVerbs` (`poolsEnforcement`), so this is the one wire answer that reads the field the local-mode read
 *  writes, without importing `index.ts`. */
async function projectPoolsWithin(port: number, want: string, budgetMs: number): Promise<string | undefined> {
  const start = Date.now();
  let last: string | undefined;
  while (Date.now() - start < budgetMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/fleet/health`);
      if (res.status === 200) {
        last = (await res.json() as { projectPools?: string }).projectPools;
        if (last === want) return last;
      }
    } catch {
      // Not listening yet — keep polling.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return last;
}

// The local-mode writer itself (D-7079): `index.ts`'s `readLocalCcdCaps(...).then(...)` closure records what this
// box's own `ccd caps` answered into `fleetState.ccdVerbs`. Only a booted composition root runs that closure, so these
// rows boot it in local mode against a stub ccd and read the field back through `/api/fleet/health`.
describe('the real composition root — local mode records its own ccd caps', () => {
  it('a ccd whose caps list the project-pool verb is recorded: projectPools turns enforced', async () => {
    const home = mkTmp('ccrc-boot-');
    writeRoster(home);
    writeStubCcd(home, 'echo start\necho stop\necho project-pool\nexit 0');
    const port = freshPort();
    expect(await timeToHealth(home, indexTs, port, 8_000)).not.toBeNull();
    expect(await projectPoolsWithin(port, 'enforced', 5_000)).toBe('enforced');
  }, 20_000);

  it('a ccd whose caps lack the verb is recorded too: projectPools turns unavailable, not left unknown', async () => {
    const home = mkTmp('ccrc-boot-');
    writeRoster(home);
    writeStubCcd(home, 'echo start\necho stop\nexit 0');
    const port = freshPort();
    expect(await timeToHealth(home, indexTs, port, 8_000)).not.toBeNull();
    expect(await projectPoolsWithin(port, 'unavailable', 5_000)).toBe('unavailable');
  }, 20_000);

  // The measured rule writes only a non-null list (D-7079): a failed read is "no evidence", so the field stays
  // unwritten and `projectPools` stays 'unknown'. Recording it as `[]` would answer 'unavailable', a false fact.
  // The stub touches a marker when asked `caps` (it inherits the server's env, so the path comes from
  // `CCRC_HOME`, not from this file), so the row waits until the read has demonstrably run, then holds a grace
  // window in which an 'unavailable' answer would end the poll early and fail the assertion.
  it('a ccd whose caps fails is not recorded: projectPools stays unknown after the read ran', async () => {
    const home = mkTmp('ccrc-boot-');
    writeRoster(home);
    writeStubCcd(home, 'if [ "$1" = caps ]; then touch "$CCRC_HOME/.caps-asked"; fi\nexit 1');
    const port = freshPort();
    expect(await timeToHealth(home, indexTs, port, 8_000)).not.toBeNull();
    const marker = path.join(home, '.caps-asked');
    const askedBy = Date.now() + 5_000;
    while (!existsSync(marker) && Date.now() < askedBy) await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(marker), 'the local-mode caps read must have run').toBe(true);
    expect(await projectPoolsWithin(port, 'unavailable', 1_500)).toBe('unknown');
  }, 20_000);
});
