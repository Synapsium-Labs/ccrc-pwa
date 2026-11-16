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
//   * RETURNED with members left, from a caller that passed `{ strays: 'end' }`: a case that strands a process ON
//     PURPOSE (a fixture that removes a deadline to prove a backstop) declares it, and the helper ends the
//     leftovers through the group it created and returns normally. That is a handle this run holds, never a PID
//     read back from a file or a listing (D-3533), which is why it lives here and not in the case.
// Converted so far: every timed spawn in `ccrc-account.test.ts`, and the runners whose leaks the run-level check
// found on its first CI run (`ccd-account-auth.test.ts`'s `drive`, `ccgpt-runtime.test.ts`'s `runOpts`,
// `platform-hazards.test.ts`'s `bash`). The suite's other timed spawns of a shell or a script move here one file
// at a time (#896; D-5895 had left them until their files were next touched): `spawn-group-pin.test.ts` reds a new
// one, and `spawnGroupAllowlist.ts` lists those not yet moved and may only shrink. Until a file moves, the run-level
// check in `proc-leak.globalsetup.mjs` still reds a grandchild one of its spawns leaves in the suite's group.
// A detached child also leaves the suite's controlling terminal, so a Ctrl-C to vitest no longer reaches it; the
// timeout is what bounds it, and every call here should carry one.
//
// An `input` reaches the child from a REGULAR FILE, never through `spawnSync`'s own `input` (D-8381). Node hands a
// child its `input` through a Unix-domain socket it writes and then shuts down, and on a hosted macOS runner a
// DETACHED `spawnSync` doing that now and then delivers every byte and never the end of input: the child sits in
// read(2) on its stdin and node in kevent until the timeout (13 of 12,000 runs with a 128 KB input in C29's probes,
// none attached and none from a file; C30's note has this helper's own figures by input size). So the input is
// written to a file in a directory of its own under the run's temp root, the file is opened for reading, the
// directory is removed at once, and the open descriptor is the child's stdin. A regular file ends where it ends,
// and nothing is left on disk whatever happens next: a timeout, a throw, or this process killed.
import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns, type StdioOptions }
  from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

/** The prefix of the directory an `input` is written into, under `os.tmpdir()`, for the moment before it is opened. */
export const INPUT_DIR_PREFIX = 'ccrc-spawngroup-input-';

/** `input` as a descriptor open for reading on a regular file that no longer has a name (D-8381). */
function inputFile(input: string | NodeJS.ArrayBufferView): number {
  const dir = mkdtempSync(path.join(tmpdir(), INPUT_DIR_PREFIX));
  try {
    const file = path.join(dir, 'stdin');
    writeFileSync(file, input);
    // Opened afresh for reading, so the child starts at offset 0 of what was written.
    return openSync(file, 'r');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `stdio` with its stdin replaced by `fd`; the caller's stdout, stderr and any further entries are kept. */
function withStdin(stdio: StdioOptions | undefined, fd: number): StdioOptions {
  if (Array.isArray(stdio)) return [fd, ...stdio.slice(1)];
  const each = stdio ?? 'pipe';
  return [fd, each, each];
}

/** `spawnSync` with a string encoding (every caller here reads text), in a process group of the child's own. An
 *  `input` is the child's stdin from a regular file (D-8381); every other option is passed as given. */
export function spawnSyncGroup(command: string, args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding, { strays = 'throw' }: { strays?: 'throw' | 'end' } = {}):
  SpawnSyncReturns<string> {
  const { input, ...rest } = options;
  const fd = input === undefined ? undefined : inputFile(input);
  // `detached` is honoured by spawnSync at runtime (node's spawn_sync reads it, and the child's pid comes back as
  // its own pgid: measured) but @types/node leaves it out of SpawnSyncOptions, hence the widened type.
  const opts: SpawnSyncOptionsWithStringEncoding & { detached: boolean } =
    { ...rest, ...(fd === undefined ? {} : { stdio: withStdin(rest.stdio, fd) }), detached: true };
  let r: SpawnSyncReturns<string>;
  try {
    r = spawnSync(command, args, opts);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
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
  if (strays === 'end') return r;
  // The child's status and output ride along (D-6112): a nested vitest's own leak report, naming the test that
  // leaked, is on its stderr, and without it the failure says only that something was left.
  throw new Error(`spawnSyncGroup: ${command} returned but left processes in its group ${pgid}; they were killed`
    + ` (status ${r.status}):\n${r.stdout ?? ''}${r.stderr ?? ''}`);
}
