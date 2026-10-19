// spawnSyncGroup — `spawnSync` for a child that can FORK, in its own process group, so a timeout takes the whole
// tree with it (#172, D-5894).
//
// `spawnSync(…, { timeout })` signals only its direct child. A `bash -c` that is waiting on a `flock`, a `sleep`
// or a `git` it started dies, and the grandchild runs on: reparented, in the suite's process group, holding
// whatever it held. Measured: the reentrant-lock case in `ccrc-account.test.ts` left one `flock` per red run, each
// alive for days and holding a lock under a fixture directory the test had already deleted.
//
// The child starts with `detached: true`, which is libuv's setsid(): it leads a new session and process group
// whose id is its pid. (macOS has no setsid(1), which is why this is not `setsid timeout -k …`.) After the call:
//   * TIMED OUT (`error.code === 'ETIMEDOUT'`): the whole group is SIGKILLed. The timeout itself is still the
//     caller's to assert, through the returned `error`, exactly as with `spawnSync`.
//   * RETURNED ON ITS OWN with members of its group still alive: they are SIGKILLed and this THROWS, naming the
//     count. A child that means a process to outlive it starts that process in a session of its own; one left in
//     the group is a leak, and this helper is the leak check for the groups it creates, which
//     `proc-leak.globalsetup.mjs` cannot see (it watches the suite's own group).
// Converted so far: every timed spawn in `ccrc-account.test.ts`. The suite's other timed spawns move here as their
// files are next touched, not in one sweep (D-5895); until then the run-level check in `proc-leak.globalsetup.mjs`
// still reds a grandchild one of them leaves in the suite's group.
// A detached child also leaves the suite's controlling terminal, so a Ctrl-C to vitest no longer reaches it; the
// timeout is what bounds it, and every call here should carry one.
import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from 'node:child_process';

/** How long a returned child's leftover group members get to exit before they are a leak. */
export const GROUP_GRACE_MS = 500;
const PAUSE = new Int32Array(new SharedArrayBuffer(4));

/** True while any process is in group `pgid`. */
export function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (e) {
    // EPERM: a member exists that this uid cannot signal. It is still alive.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** SIGKILLs every process in group `pgid`; a group that is already empty is not an error. */
export function killGroup(pgid: number): void {
  try { process.kill(-pgid, 'SIGKILL'); } catch { /* the group is already empty */ }
}

/** `spawnSync` with a string encoding (every caller here reads text), in a process group of the child's own. */
export function spawnSyncGroup(command: string, args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string> {
  // `detached` is honoured by spawnSync at runtime (node's spawn_sync reads it, and the child's pid comes back as
  // its own pgid: measured) but @types/node leaves it out of SpawnSyncOptions, hence the widened type.
  const opts: SpawnSyncOptionsWithStringEncoding & { detached: boolean } = { ...options, detached: true };
  const r = spawnSync(command, args, opts);
  const pgid = r.pid;
  if (!pgid || !groupAlive(pgid)) return r;
  if ((r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') {
    killGroup(pgid);
    return r;
  }
  // A member already on its way out (a backgrounded `sleep 0.1`) gets GROUP_GRACE_MS before it is called a leak.
  const deadline = Date.now() + GROUP_GRACE_MS;
  while (groupAlive(pgid) && Date.now() < deadline) Atomics.wait(PAUSE, 0, 0, 25);
  if (!groupAlive(pgid)) return r;
  killGroup(pgid);
  throw new Error(`spawnSyncGroup: ${command} returned but left processes in its group ${pgid}; they were killed`);
}
