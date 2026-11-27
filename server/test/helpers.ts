import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { statSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { isExecAllowed } from '../../agent/src/whitelist.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIOFor } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { wireCmd } from '../src/remote/runner.js';
import type { Deps } from '../src/server.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { mkTmp } from './tmpHelpers.js';
import { fakeTime } from './fakeTime.js';
// Re-exported from the leaf module so ccdWsHelpers.ts (and anything else that
// only needs the roster) does not transitively pull in config.ts → shared/api.ts.
export { DEFAULT_TEST_ROSTER } from './helpers/roster.js';
import { DEFAULT_TEST_ROSTER } from './helpers/roster.js';

/**
 * The TEST default roster lives in `./helpers/roster.ts` — a leaf module that
 * imports nothing from server/src, so test files that only need the roster
 * (ccdWsHelpers.ts) do not transitively reach shared/api.ts. Re-exported
 * above. The full docblock is in the leaf.
 */

/** Every `loadConfig({ CCRC_HOME: home })` needs this first — `loadConfig`
 *  refuses to boot without a roster, by design (`RosterError`, naming the
 *  remedy, rather than an empty or partial fleet). */
export function seedRoster(home: string, roster: unknown = DEFAULT_TEST_ROSTER): void {
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'accounts.json'), JSON.stringify(roster, null, 2));
}

/**
 * Layer 1: every runner used in a server test crosses the agent's real
 * whitelist first. Applying `wireCmd` is load-bearing — call sites pass
 * `cfg.ccdBin`, an absolute path, and `isExecAllowed` rejects any cmd
 * containing '/'. Free coverage on every existing route test.
 */
export const guardRunner = (inner: Runner): Runner => async (cmd, args) => {
  const wire = wireCmd(cmd);
  if (!isExecAllowed(wire, args)) {
    throw new Error(`argv not in the agent EXEC_WHITELIST: ${wire} ${args.join(' ')}`);
  }
  return inner(cmd, args);
};

/** Puts a suite's fake wall clock on `Deps.monotonicMs`, in place. Since OA-C4 (#803) every lane throttles on the monotonic
 *  clock, so a suite that moves time with `vi.setSystemTime` or a mocked `Date.now` must hand the watcher a monotonic clock that
 *  moves with it, or the throttle never elapses. A suite that already injects its own `monotonicMs` keeps it. */
export function withFakeClock<T extends object>(deps: T): T {
  const d = deps as { monotonicMs?: () => number };
  d.monotonicMs ??= () => Date.now();
  return deps;
}

/** Deps against a throwaway fixture home; default runner fails every exec (all sessions dead).
 *
 *  Both capabilities `Deps` carries are built from the SAME guarded runner:
 *  `runCcd` composes it through `ccdRunner`, `Tmux` gets it by constructor
 *  injection. Guarding at the `Runner` level rather than at `CcdRunner`'s is
 *  what lets one guard cover both paths — `routes.test.ts`'s two wiring tests
 *  pin each use site independently. */
export function testDeps(
  home: string = mkTmp('ccrc-'),
  run: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: '' }),
): Deps {
  const guarded = guardRunner(run);
  seedRoster(home);
  const cfg = loadConfig({ CCRC_HOME: home });
  return { cfg, runCcd: ccdRunner(guarded, cfg), tmux: new Tmux(guarded), io: localIOFor(cfg.home), queue: new KeyedQueue(),
    time: fakeTime().ports };
}

/**
 * `command -v <name>`, answered as a path THIS process can spawn.
 *
 * Every sibling suite resolves bash (and tar, rsync, sha256sum) absolutely for
 * the same stated reason: libuv looks the executable up in the CHILD's
 * environment, and several runners hand the child a PATH with no system
 * directory on it, where a bare name is ENOENT — a spawn failure rather than
 * anything the test is about.
 *
 * On Windows there is a second translation, and it is not cosmetic. Under MSYS2
 * `command -v bash` answers `/usr/bin/bash`, which is a path in MSYS2's mount
 * table and nowhere in the Windows filesystem. Native Node cannot open it:
 * `spawnSync` gives ENOENT, and node-pty's ConPTY path gives the emptiest error
 * in this port — `Error: File not found: ` with nothing after the colon.
 * Measured: it failed all 58 tests in `ccrc-expose.test.ts`. `cygpath -w` is
 * MSYS2's own answer to the question, and it appends `.exe` itself, so the
 * result is spawnable as-is.
 */
export function realPath(name: string): string {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (p === '') throw new Error(`this box has no ${name} — the fixture needs it`);
  if (process.platform !== 'win32' || /^[A-Za-z]:[\/]/.test(p)) return p;
  const w = spawnSync('cygpath', ['-w', p], { encoding: 'utf8' });
  const win = (w.stdout ?? '').trim();
  if (win === '') {
    throw new Error(
      `cannot translate ${p} into a path this process can spawn — cygpath is missing, `
      + 'and a POSIX path from an MSYS2 shell is not one Windows can open',
    );
  }
  return win;
}

/**
 * A path bash can do ARITHMETIC on, not merely open.
 *
 * MSYS2's bash accepts `C:\dir\script` as an argument and runs it — which is
 * why this looks like it works. What breaks is everything a script then does
 * with its own name: `ccd/ccrc` computes its tree root as
 * `CCRC_HERE="${BASH_SOURCE[0]}"` followed by `${CCRC_HERE%/*}`, and a string
 * with no forward slash in it has no directory part to strip. The guard on the
 * next line then reads it as a bare name, `cd .` lands in the CALLER's
 * directory, and the script looks for its own `deploy/systemd/` beside the
 * fixture home instead of inside the tree. It does not fail loudly; it fails as
 * "the shipped tree has no …/../deploy/systemd/ccrc-ddns.service — is this a
 * complete ccrc tree?", which reads like a broken fixture and is not.
 *
 * `cygpath -u` is MSYS2's own answer, and it knows the mount table: `C:\msys64
 * \tmp\x` is `/tmp/x` to every process inside that shell, not `/c/msys64/tmp/x`.
 * Hand-rolling the drive-letter rewrite gets that case wrong.
 */
export function posixPath(p: string): string {
  if (process.platform !== 'win32') return p;
  const r = spawnSync('cygpath', ['-u', p], { encoding: 'utf8' });
  const out = (r.stdout ?? '').trim();
  if (out === '') throw new Error(`cygpath could not translate ${p} for the shell`);
  return out;
}

/**
 * A WHOLE `PATH` list in the spelling a POSIX shell splits correctly.
 *
 * A Windows PATH is `;`-separated and every entry carries a drive colon, so
 * handed to bash as-is — or `:`-joined onto a POSIX entry, which is what every
 * harness here does — the shell splits `C:\msys64\usr\bin` into `C` and
 * `\msys64\usr\bin`, and the tools in it vanish. Measured through the ccd
 * harness: its PATH read `…/.local/bin`, `C`, `/msys64/usr/bin`, and `flock`
 * (which lives in exactly that directory) answered not-found.
 *
 * ONE `cygpath -u -p` for the whole list, memoized per input: the harness asks
 * on every `sh()`, and the inherited PATH does not change within a worker. A
 * list that is already POSIX (no `;`) is returned untouched, on every platform.
 */
const posixListMemo = new Map<string, string>();
export function posixPathList(list: string): string {
  if (process.platform !== 'win32' || !list.includes(';')) return list;
  const hit = posixListMemo.get(list);
  if (hit !== undefined) return hit;
  const r = spawnSync('cygpath', ['-u', '-p', list], { encoding: 'utf8' });
  const out = (r.stdout ?? '').trim();
  if (out === '') throw new Error('cygpath could not translate the inherited PATH for the shell');
  posixListMemo.set(list, out);
  return out;
}

/**
 * Is this file readable by its owner and NOBODY ELSE — asked the way the
 * platform actually enforces it.
 *
 * `statSync(f).mode & 0o777 === 0o600` is that question on POSIX and a
 * different question on Windows, where it is unanswerable: there are no mode
 * bits, `chmod 600` changes nothing a security check can see, and the number
 * that comes back is 0o666 for a locked file and an open one alike. Asserting
 * it there does not measure a weaker property — it measures none, while reading
 * like the strongest one in the suite.
 *
 * So on Windows this reads the ACL, which is what `_ccrc_lock_file` (ccd/ccrc)
 * writes: owner-only means exactly one principal holds a grant, and it is this
 * user.
 */
export function ownerOnly(file: string): boolean {
  if (process.platform !== 'win32') return (statSync(file).mode & 0o777) === 0o600;
  const out = spawnSync('icacls', [file], {
    encoding: 'utf8',
    env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*' },
  }).stdout ?? '';
  const holders = [...out.matchAll(/([^\s:]+(?:[ \t][^\s:]+)*):\(/g)].map((m) => m[1] ?? '');
  const me = (spawnSync('whoami', { encoding: 'utf8' }).stdout ?? '').trim().toLowerCase();
  const bare = me.split('\\').pop() ?? me;
  return holders.length === 1 && (holders[0] ?? '').toLowerCase().includes(bare);
}

/** The other half of the same question, for the files that are SUPPOSED to be
 *  readable by another account — a Caddyfile is read by caddy, running as
 *  root. On POSIX that is a mode; on Windows it is "more than one principal
 *  holds a grant", which is what inherited permissions leave behind. */
export function readableByOthers(file: string): boolean {
  if (process.platform !== 'win32') return (statSync(file).mode & 0o044) !== 0;
  return !ownerOnly(file);
}

/**
 * Put a fixture file in the state `_ccrc_lock_file` (ccd/ccrc) leaves a real
 * one in: owner-only, by whatever means the platform has.
 *
 * A fixture that writes `mode: 0o600` and stops is fine on POSIX and WRONG on
 * Windows — not because the file is insecure there (it is, but that is the
 * product's problem) but because it no longer resembles what the subject under
 * test will actually meet. Doctor's exposure check then reports a real gap in
 * the fixture and the test reads it as a broken check.
 */
export function lockOwnerOnly(file: string): void {
  if (process.platform !== 'win32') { chmodSync(file, 0o600); return; }
  spawnSync('icacls', [file, '/inheritance:r', '/grant:r', `${currentUser()}:(R,W,D)`], {
    encoding: 'utf8',
    env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*' },
  });
}

function currentUser(): string {
  return (spawnSync('whoami', { encoding: 'utf8' }).stdout ?? '').trim();
}

/**
 * Make `file` UNREADABLE to this process — the thing `chmodSync(f, 0o000)`
 * means, and does not do, on a box with no file modes.
 *
 * On Windows `chmod 000` is a no-op, so a test that relied on it to produce an
 * EACCES read the file perfectly well and asserted against a success — the same
 * trap the root-skip beside such tests exists for ("`chmod 000` denies root
 * nothing, so an unguarded case would quietly assert the OPPOSITE of its own
 * name"). An explicit DENY on read for the current user is the Windows
 * spelling of it: a deny ACE outranks every allow, including the owner's.
 * `restoreReadable` is the inverse and must run before fixture cleanup.
 */
export function denyRead(file: string): void {
  if (process.platform !== 'win32') { chmodSync(file, 0o000); return; }
  spawnSync('icacls', [file, '/deny', `${currentUser()}:(R)`], {
    encoding: 'utf8',
    env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*' },
  });
}

export function restoreReadable(file: string): void {
  if (process.platform !== 'win32') { chmodSync(file, 0o644); return; }
  spawnSync('icacls', [file, '/remove:d', currentUser()], {
    encoding: 'utf8',
    env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*' },
  });
}

/**
 * The inverse of `lockOwnerOnly`: put the file back in the state an ordinary
 * write leaves it in — inherited permissions, readable by other accounts.
 *
 * Needed because on Windows the fixture's `chmodSync(f, 0o644)` is a NO-OP, and
 * a test that locks a file first and then "opens" it with a mode would be
 * asserting against a file that is still locked. That is a false negative in
 * the one direction that matters: the check would look like it cannot spot an
 * open file, when in truth it was never shown one.
 */
export function unlockShared(file: string): void {
  if (process.platform !== 'win32') { chmodSync(file, 0o644); return; }
  spawnSync('icacls', [file, '/reset'], {
    encoding: 'utf8',
    env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*' },
  });
}
