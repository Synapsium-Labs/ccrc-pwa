// The server suite's process-leak check (#172, D-5894): a run FAILS when a process one of its tests started is
// still alive at teardown, so a leaked child is a red run today instead of a wedged box eleven days later.
//
// WHY. `spawnSync(…, { timeout })` kills only its DIRECT child. Whatever that child forked keeps running, in the
// suite's process group, reparented away from everything that could reap it. Measured before this file: seven
// `flock` processes from seven red runs of the reentrant-lock case in `ccrc-account.test.ts`, each about 11 days
// old, each holding a lock under a fixture directory the test had already deleted, and between them pinning a
// workspace nobody could reclaim. Nothing in the suite noticed.
//
// HOW IT SEES A LEAK. vitest's workers are forked without `detached`, and so is every child a test spawns without
// it, so all of them share THIS process's process group, and an orphan keeps that group when it is reparented.
// Setup records the group's members; teardown lists them again. A member that is not in the record, is not this
// process, and whose parent is neither this process (vitest's own helpers) nor a recorded one (a job the launching
// shell started beside vitest) is a leak: a test's child whose parent was a worker, or an orphan reparented to init
// or a subreaper. Teardown waits
// `LEAK_GRACE_MS` for stragglers that are already dying, then names each survivor (pid, age, command and working
// directory: the cwd is often a fixture directory, which names the test file that started it, though a spawn
// that set no cwd shows the package directory instead) and sets
// `process.exitCode = 1`. It never signals what it names: a PID it OBSERVED is an observation, not a handle this run
// holds, and a globalSetup carries no signal authority (D-3533, pinned in `ccrc-uninstall.test.ts`). The run is
// red; the leak runs out its own bound or is ended by whoever reads the report. It does not throw: measured against the vitest 4 this repo pins, an error
// thrown from a globalSetup teardown is printed as "error during close" and the run still EXITS 0.
//
// THE RECORD, NOT A PID OR A START TIME, keeps it off things the run did not start: `npm test | tee log` puts
// `tee` (and npm, and its shell) in this group before setup runs, so they are in the record.
//
// WHAT IT DOES NOT SEE (by design). A child that leaves the group — `detached: true` (libuv's setsid()), `setsid`,
// a daemon that double-forks into its own session, a tmux server — is in another group, invisible here. Nor is an
// orphan whose new parent is itself a recorded member (a container whose init is the shell that launched vitest). That is
// why `spawnGroup.ts`'s `spawnSyncGroup` ends the WHOLE group of a detached child it timed out, and refuses
// (throws) when a detached child it did not time out left members behind: the helper is the check for the
// children it starts. A run killed by a signal skips teardown, so it is not checked either.
//
// WHY A `.mjs` THAT IMPORTS ONLY `node:` BUILTINS: `proc-leak.test.ts` imports it into a bare-node child, and the
// node floor cannot strip types (`run-tmp.globalsetup.mjs` is the precedent).
import { spawnSync } from 'node:child_process';
import { readlinkSync } from 'node:fs';

/** How long teardown waits for a member that is already exiting before calling it a leak. */
export const LEAK_GRACE_MS = 2_000;

/** Every process in process group `pgid`, from one `ps` (macOS and procps both spell these columns so). */
export function groupMembers(pgid) {
  const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ps failed (${r.status}): ${r.stderr}`);
  const out = [];
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s?(.*)$/);
    if (m && Number(m[3]) === pgid) out.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[4] });
  }
  return out;
}

/** This process's process group: node exposes none, so `ps` answers it. */
export function ownGroup(pid = process.pid) {
  const r = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' });
  const g = Number(r.stdout.trim());
  if (!Number.isInteger(g) || g <= 0) throw new Error(`cannot read the process group of ${pid}: ${r.stderr}`);
  return g;
}

/** The members of `pgid` that are leaks: not in `baseline`, not `self`, and whose parent is neither `self` nor
 *  in `baseline` (a child of a recorded process is that process's business, never this run's). */
export function findLeaks(pgid, baseline, self = process.pid) {
  return groupMembers(pgid).filter((p) => !baseline.has(p.pid) && p.pid !== self
    && p.ppid !== self && !baseline.has(p.ppid));
}

const sleep = (ms) => new Promise((res) => { setTimeout(res, ms); });

/** Waits up to `graceMs` for leaks to exit and returns whatever is still alive then. It signals nothing (D-3533). */
export async function collectLeaks(pgid, baseline, { self = process.pid, graceMs = LEAK_GRACE_MS } = {}) {
  const deadline = Date.now() + graceMs;
  let leaks = findLeaks(pgid, baseline, self);
  while (leaks.length > 0 && Date.now() < deadline) {
    await sleep(100);
    leaks = findLeaks(pgid, baseline, self);
  }
  return leaks;
}

/** A leak's working directory: `/proc` where there is one, `lsof` (macOS) otherwise; '?' when neither answers. */
export function cwdOf(pid) {
  try { return readlinkSync(`/proc/${pid}/cwd`); } catch { /* no procfs, or the process is gone */ }
  const r = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
  const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('n'));
  return line ? line.slice(1) : '?';
}

/** A leak's elapsed time as `ps` spells it ([[dd-]hh:]mm:ss); '?' when the process is gone. */
export function ageOf(pid) {
  const r = spawnSync('ps', ['-o', 'etime=', '-p', String(pid)], { encoding: 'utf8' });
  return (r.stdout ?? '').trim() || '?';
}

/** The report for `leaks`, one line per process. */
export function leakReport(leaks) {
  return `ccrc-test: ${leaks.length} process(es) a test started outlived the run and are still running`
    + ' (this check names them and never signals them: D-3533):\n'
    + leaks.map((p) => `  pid ${p.pid}, up ${ageOf(p.pid)}: ${p.command}\n    cwd ${cwdOf(p.pid)}\n`).join('');
}

export default async function setup() {
  const pgid = ownGroup();
  const baseline = new Set(groupMembers(pgid).map((p) => p.pid));
  return async () => {
    const leaks = await collectLeaks(pgid, baseline);
    if (leaks.length === 0) return;
    process.stderr.write(leakReport(leaks));
    process.exitCode = 1;
  };
}
