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
 * A `.git` this process CANNOT read is a different case, and an honest one:
 * `FleetIO.readFile`'s contract is `null = missing` (`io.ts:12`), and its
 * `local` implementation collapses every error — ENOENT, EACCES, a torn
 * read — to that same `null` (`io.ts:41-43`). This function cannot tell "no
 * loose ref exists" from "a loose ref exists but could not be read", and does
 * not pretend to: both read as "no loose ref", so both fall through to
 * packed-refs, which may answer a stale entry for the same branch. That is a
 * real, accepted gap in `FleetIO`'s contract, not a deliberate choice made
 * here — do not read the packed-refs fallback below as proof this case was
 * handled.
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
  const loose = await io.readFile(path.join(gitDir, 'refs', 'heads', ...branch.split('/')));
  if (loose !== null) {
    const v = loose.trim();
    return SHA.test(v) ? v : null;
  }
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
