import path from 'node:path';
import type { FleetIO } from '../io.js';

const SHA = /^[0-9a-f]{40}$/;
/** git's own rules, narrowed hard. No leading `-`, no `..` anywhere, no
 *  control characters, no absolute path — every one of which is a way to make
 *  the `path.join` below name a file outside the ref tree. This is a PATH
 *  guard, not a git validity check: `_ws_branch_valid` on the box owns that
 *  rule, and the server does not re-implement it (the standing ruling from the
 *  branch-naming build — two implementations of one rule drift). */
const BRANCH_OK = /^[A-Za-z0-9][A-Za-z0-9._\-\/]*$/;

/**
 * The commit a branch points at, read from git's own ref files through
 * `FleetIO` — because the server can NEVER run git. `EXEC_COMMANDS` is the
 * closed set `['tmux','ccd']` (`agent/src/whitelist.ts:134`) and widening it is
 * a three-edit, two-package, boot-audited change made deliberately or not at
 * all. The projects root IS readable (`whitelist.ts:82-88`), so the ref files
 * are.
 *
 * A WORKSPACE'S BRANCH LIVES IN THE MAIN REPO'S REF STORE, not in the worktree:
 * linked worktrees share `refs/` and keep only `HEAD` and their own
 * per-worktree refs under `.git/worktrees/<name>/`. So this reads
 * `<projectsRoot>/<project>/.git/refs/heads/<branch>`, then `packed-refs` —
 * loose first, which is the order git resolves in, and the reason the "prefers
 * the loose ref" case is pinned.
 *
 * `null` means UNMEASURABLE and callers must treat it as a refusal, never as a
 * mismatch and never as a pass: not knowing is not `[]` (`ccd/ccd:2018-2035`).
 *
 * A LOOSE REF, once its file is READABLE, is authoritative and SHADOWS
 * packed-refs entirely — never a fallback source, because that is what git
 * itself does: `git pack-refs` leaves the packed entry in place and the loose
 * file (written by the next commit) supersedes it. A symref (`ref: refs/…`)
 * is the one shape a readable loose file can hold that is not a SHA; this
 * function does not resolve it — a second hop it does not need for the one
 * case it serves (a workspace branch) — and answers null rather than fall
 * through to whatever packed-refs happens to say about the same name.
 *
 * A LOOSE REF THIS PROCESS CANNOT READ THE BYTES OF is not the same fact as an
 * ABSENT one, and this function does not conflate them. `FleetIO.readFile`'s
 * contract is `null = missing` (`io.ts:12`), and its `local` implementation
 * collapses every error — ENOENT, EACCES, EISDIR, a torn read, and (`remote`,
 * T3) any single failed round trip over the agent WS — to that same `null`
 * (`io.ts:41-43`); the read alone genuinely cannot tell "no loose ref exists"
 * from "a loose ref exists but its bytes could not be fetched right now".
 * Below, `io.stat` on the IDENTICAL path is independent proof of presence
 * that does not depend on the bytes being readable — `stat` only needs search
 * permission on the parent directory chain, not read permission on the leaf,
 * so it succeeds on a `chmod 000` file and on a directory (the `EISDIR`
 * trigger) alike. A loose ref that `stat` proves present is git's
 * authoritative answer for this branch, so this function refuses (`null`, UNMEASURABLE)
 * rather than let a possibly-stale `packed-refs` entry stand in for one it
 * could not read — the same fail-shut move `registry.ts` makes for
 * `HOLD_UNREADABLE` and `prhistory.ts` makes with its own listing/re-read.
 * Only when the `stat` ALSO reads absent (the ordinary "packed and never
 * re-committed" case, or the rare inability to even traverse the ref tree) is
 * `packed-refs` treated as git's honest fallback below.
 */
export async function readBranchTip(
  io: FleetIO, projectsRoot: string, project: string, branch: string,
): Promise<string | null> {
  if (!BRANCH_OK.test(branch) || branch.includes('..')) return null;
  // Same reasoning as `BRANCH_OK`, narrowed to a single path segment (no `/`
  // in the character class): `project` is joined with no separator handling
  // of its own, so the only two values that mean anything other than a
  // literal directory name are `.` and `..` — both accepted by the character
  // class, and `..` is a full escape one level above `projectsRoot`
  // (`path.join(projectsRoot, '..', '.git')` normalises to the parent's own
  // `.git`, proven end-to-end in `coord-fingerprint.test.ts`).
  if (!/^[A-Za-z0-9._-]+$/.test(project) || project === '.' || project === '..') return null;
  const gitDir = path.join(projectsRoot, project, '.git');

  // Readable loose ref -> return HERE, never fall through, whether or not the
  // content parses as a SHA (see the docstring above: this is what makes a
  // symref answer null instead of a stale packed-refs entry for the same
  // name).
  const loosePath = path.join(gitDir, 'refs', 'heads', ...branch.split('/'));
  const loose = await io.readFile(loosePath);
  if (loose !== null) {
    const v = loose.trim();
    return SHA.test(v) ? v : null;
  }
  // The read came back null: could be ENOENT (absent) or a present-but-
  // unreadable ref (EACCES/EISDIR/a transport hiccup). `stat` on the same
  // path proves presence without needing the bytes (docstring above) — if it
  // succeeds, this IS the loose ref, git's authoritative answer, and it must
  // be refused rather than silently answered from packed-refs.
  if (await io.stat(loosePath) !== null) return null;
  const packed = await io.readFile(path.join(gitDir, 'packed-refs'));
  if (packed === null) return null;
  for (const line of packed.split('\n')) {
    if (line.startsWith('#') || line.startsWith('^')) continue;
    if (line.length < 42 || line[40] !== ' ') continue;
    if (line.slice(41).trim() !== `refs/heads/${branch}`) continue;
    const sha = line.slice(0, 40);
    if (SHA.test(sha)) return sha;
  }
  return null;
}
