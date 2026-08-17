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

/** One linked worktree, as GIT records it. */
export interface WorktreeRecord {
  readonly name: string;
  readonly path: string;
  readonly headBranch: string | null;
}

/**
 * What `readWorktreeRecords` answers, and the reason it is a union rather than
 * `WorktreeRecord[] | null` (§1.7).
 *
 * The old `null` carried THREE facts at once, and two of them are opposites:
 * the project name was REFUSED by the path guard (this server will never read a
 * census for that project — a standing condition, not a transient one), the
 * admin directory could not be listed (a read that failed; try again next
 * sweep), and the project simply has NO LINKED WORKTREES (a complete, correct
 * measurement — the answer is zero). "Refused" and "none exist" are not
 * degrees of the same thing.
 *
 * Today's ONE consumer (`watch.ts`'s census) contributes nothing for all three,
 * so the union changes no behaviour on its own. That is exactly why the
 * distinction has to live in the TYPE rather than in a comment saying the
 * consumer does not need it: the next consumer is the one that does, and it
 * must not inherit a value that has already thrown the answer away. `ok: true`
 * with an EMPTY array is now a measurement a caller may act on — the previous
 * shape could not spell it, because `[]` and "we could not look" were the same
 * `null`.
 */
export type WorktreeRead =
  | { ok: true; records: WorktreeRecord[] }
  /** The project name never named a path this server would read: the
   *  single-segment guard rejected it. STANDING, not transient — retrying is
   *  pointless, and a registry that keeps naming this project keeps being
   *  uncensusable. */
  | { ok: false; reason: 'refused-project' }
  /** The admin directory EXISTS (proved by `stat`, which needs only search
   *  permission on the parent chain) and could not be listed. Unmeasured; the
   *  next sweep may do better. */
  | { ok: false; reason: 'unlistable' };

/**
 * Every linked worktree of `<projectsRoot>/<project>`, read out of git's own
 * admin directory `<project>/.git/worktrees/<name>/` — `gitdir` names the
 * worktree's path, `HEAD` names its branch.
 *
 * READ FROM THE MAIN REPO, NOT FROM `~/worktrees`, and that is structural rather
 * than stylistic. `agent/src/whitelist.ts`'s read set is `.cc-sessions`,
 * `.cc-limits`, `.cc-clips`, `$HOME/.claude*` and `projectsRoot`; `~/worktrees`
 * is NOT in it, and ccd's own `pr-open` comment says so in as many words. Reading
 * git's record instead needs no widening, catches the FLAT
 * `~/worktrees/<project>-<slug>` layout a directory glob would miss, and is
 * immune to the `~/worktrees -> /data/worktrees` symlink (ccd writes the
 * registry's `workdir` unresolved, git resolves it, and `FleetIO.realpath`
 * answers null unconditionally in remote mode — so absolute-path comparison
 * would report the whole fleet as unregistered).
 *
 * THE ANSWER IS A `WorktreeRead`, NOT `WorktreeRecord[] | null` (§1.7) — see that
 * type's own docstring for the three facts the old `null` was carrying at once.
 * The absent admin directory is a MEASUREMENT here, not a failure: git creates
 * `.git/worktrees` when it creates the first linked worktree and not before, so
 * "not there" is git's own way of saying zero, and it answers `ok: true` with an
 * empty array. `stat` is what separates that from a directory that IS there and
 * would not list — the identical technique, for the identical reason, that
 * `readBranchTip` above uses on a loose ref: `stat` needs only search permission
 * on the parent chain, so it still proves presence when the listing itself is
 * refused. The one case it cannot see through is a chain this process cannot
 * TRAVERSE at all (EACCES on `<project>/.git`), which reads as the absent case —
 * the same fail-direction `readBranchTip` names and accepts, and the suppressing
 * one.
 *
 * A DETACHED HEAD gives `headBranch: null`, never a fabricated name.
 */
export async function readWorktreeRecords(
  io: FleetIO, projectsRoot: string, project: string,
): Promise<WorktreeRead> {
  // Same single-segment guard `readBranchTip` applies to `project`: the only two
  // values that mean anything but a literal directory name are `.` and `..`.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project) || project.includes('..')) {
    return { ok: false, reason: 'refused-project' };
  }
  const adminRoot = path.join(projectsRoot, project, '.git', 'worktrees');
  const names = await io.readdir(adminRoot);
  if (names === null) {
    // Present-but-unlistable, or genuinely absent? `readdir` collapses both to
    // `null` (`io.ts`), so ask the question `readdir` cannot answer.
    return (await io.stat(adminRoot)) !== null
      ? { ok: false, reason: 'unlistable' }
      : { ok: true, records: [] };
  }
  const out: WorktreeRecord[] = [];
  for (const name of names) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) continue;
    const gitdir = await io.readFile(path.join(adminRoot, name, 'gitdir'));
    if (gitdir === null) continue;
    // `gitdir` names the worktree's `.git` FILE; the worktree is its parent.
    const wt = path.dirname(gitdir.trim());
    if (wt === '' || wt === '.') continue;
    const head = await io.readFile(path.join(adminRoot, name, 'HEAD'));
    const m = head === null ? null : /^ref:\s*refs\/heads\/(\S+)\s*$/.exec(head.trim());
    const branch = m?.[1] ?? null;
    out.push({ name, path: wt, headBranch: branch !== null && BRANCH_OK.test(branch) ? branch : null });
  }
  return { ok: true, records: out };
}
