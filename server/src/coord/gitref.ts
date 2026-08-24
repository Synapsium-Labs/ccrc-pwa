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
 * mismatch and never as a pass: not knowing is not `[]` (`ccd/ccd:1957-1963`).
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
 * ABSENT one, and this function does not conflate them: it reads through
 * `FleetIO.readFileMeasured` (`MeasuredRead`/`ReadFailure`, `io.ts`), which
 * tells a proven ENOENT (`reason: 'absent'`) apart from every other failure —
 * EACCES, EISDIR, a torn read, and (`remote`, T3) any single failed round
 * trip over the agent WS — collapsed instead to `reason: 'unreadable'`. An
 * `absent` loose ref goes straight to `packed-refs` below with nothing left
 * to corroborate: a proven ENOENT already IS "no loose ref exists". An
 * `unreadable` loose ref is the weaker fact — it does not know whether the
 * ref exists — so it still needs independent proof before falling through.
 * Below, `io.stat` on the IDENTICAL path is that proof, independent of
 * whether the bytes are readable — `stat` only needs search permission on
 * the parent directory chain, not read permission on the leaf,
 * so it succeeds on a `chmod 000` file and on a directory (the `EISDIR`
 * trigger) alike. A loose ref that `stat` proves present is git's
 * authoritative answer for this branch, so this function refuses (`null`, UNMEASURABLE)
 * rather than let a possibly-stale `packed-refs` entry stand in for one it
 * could not read — the same fail-shut move `registry.ts` makes for
 * `HOLD_UNREADABLE` and `prhistory.ts` makes with its own listing/re-read.
 * This is the `unreadable` arm's own fallback, not the only path to it — the
 * `absent` arm above already goes straight to `packed-refs` with no `stat`
 * involved. Only when THIS arm's `stat` ALSO reads absent (the ordinary
 * "packed and never re-committed" case, or the rare inability to even
 * traverse the ref tree) is `packed-refs` treated as git's honest fallback
 * below.
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
  const loose = await io.readFileMeasured(loosePath);
  if (loose.ok) {
    const v = loose.content.trim();
    return SHA.test(v) ? v : null;
  }
  if (loose.reason === 'unreadable') {
    // A proven ENOENT (`reason === 'absent'`) already answers "no loose ref
    // exists" — nothing left to corroborate, straight to packed-refs below.
    // `unreadable` is weaker: EACCES/EISDIR/a transport hiccup — the path
    // could still be a live ref this box just can't read the bytes of, so
    // `stat` on the SAME path proves presence without needing the bytes
    // (docstring above) — if it succeeds, this IS the loose ref, git's
    // authoritative answer, and it must be refused rather than silently
    // answered from packed-refs. An older agent's every measured read
    // collapses to `unreadable`, so this arm is also what makes it take
    // today's path verbatim (THE GOVERNING RULE).
    if (await io.stat(loosePath) !== null) return null;
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
  | { ok: false; reason: 'unlistable' }
  /** There is NO GIT CHECKOUT at `<projectsRoot>/<project>` to census, and that
   *  was MEASURED rather than assumed: something further up the path answered,
   *  so the link was up when the absence below it was read. Four such project
   *  directories exist on the fleet, and this is the arm they take every sweep,
   *  for ever.
   *
   *  STANDING, like `refused-project` and unlike `unlistable`: retrying changes
   *  nothing until a human adds a checkout or stops the registry naming this
   *  project. It carries no log of its own anyway — four projects logging a
   *  normal, expected fact once a minute is a line nobody reads, which is the
   *  same argument that keeps `unlistable` quiet; `refused-project` logs because
   *  it means a project is PERMANENTLY uncensusable through a name this server
   *  refuses, which is a configuration defect rather than a shape of the box.
   *
   *  IT USED TO BE `unreachable`, and that was an overloaded value at a seam:
   *  a standing condition and a dropped socket answered the same word, and the
   *  docstring described them as different things in the same breath. Split by
   *  the technique this file already runs on — a POSITIVE answer somewhere on
   *  the chain is proof the link was up, so an absence read beside it is a
   *  measurement. Its residual is the one `readWorktreeRecords` already names
   *  and accepts below: a single dropped round trip landing on one stat and not
   *  its neighbour is read as the standing fact. Today that costs nothing (both
   *  refusals contribute nothing to the census), and the direction is the safe
   *  one — it can only ever suppress a finding, never manufacture one. */
  | { ok: false; reason: 'not-a-checkout' }
  /** NOTHING on the path answered — not the admin directory, not the project's
   *  own `.git`, not the project directory, not even `projectsRoot`. Absence was
   *  never proved and nothing was measured: the answer is not zero, and it is
   *  not "there is no checkout here" either. It is silence, and the next sweep
   *  may do better.
   *
   *  This exists because `FleetIO.stat` answers `null` for two different facts
   *  and only one of them is absence. In REMOTE mode — `CCRC_FLEET=remote`, the
   *  live standing config — `remote/io.ts` catches a dropped socket, a request
   *  timeout and an agent-side `checkPath` refusal all to `null`, exactly as it
   *  answers for a file that is not there. Without this arm a link blip turned
   *  every project into a fabricated MEASURED ZERO ("this project has no linked
   *  worktrees"), which is the strongest positive claim this function can make,
   *  minted out of two failed reads.
   *
   *  ONE FACT, NOT TWO. The standing half — a project directory that is not a
   *  git checkout — moved out to `not-a-checkout` above, so nothing here is a
   *  condition a human could fix by looking at the box: every rung came back
   *  silent, and the only honest reading of that is that this process could not
   *  see. */
  | { ok: false; reason: 'unreachable' };

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
 * type's own docstring for the facts the old `null` was carrying at once.
 * The absent admin directory is a MEASUREMENT here, not a failure: git creates
 * `.git/worktrees` when it creates the first linked worktree and not before, so
 * "not there" is git's own way of saying zero, and it answers `ok: true` with an
 * empty array. `stat` is what separates that from a directory that IS there and
 * would not list — the identical technique, for the identical reason, that
 * `readBranchTip` above uses on a loose ref: `stat` needs only search permission
 * on the parent chain, so it still proves presence when the listing itself is
 * refused.
 *
 * A FAILED `stat` IS NOT PROOF OF ABSENCE, and the second one is what makes the
 * zero a measurement rather than a guess. `FleetIO.stat` answers `null` for a
 * missing path AND for a read that failed — in remote mode, the live config,
 * that includes a dropped socket, a timeout and a whitelist refusal. So absence
 * of the admin directory only counts as zero once something else on that path
 * has been seen: `<project>/.git`, one level up, which every project the census
 * asks about has.
 *
 * THAT SAME TECHNIQUE RUNS ONE MORE RUNG, and it is what splits a STANDING
 * condition from a TRANSIENT one instead of answering both with one word. When
 * `<project>/.git` does not answer either, the walk keeps going up until
 * something DOES: `<projectsRoot>/<project>`, then `projectsRoot` itself. A
 * positive answer at either rung proves the link was up, so the absence read
 * below it is a measurement — `reason: 'not-a-checkout'`, standing, retrying is
 * pointless. Only when EVERY rung is silent, `projectsRoot` included, is the
 * answer `reason: 'unreachable'` — nothing was measured, and the next sweep may
 * do better. Cost is at most two extra `stat`s, on the rare arm only, and they
 * are the arm four fleet projects take every sweep.
 *
 * The one case this still cannot see through is a chain that `stat`s fine but
 * cannot be TRAVERSED (EACCES on `<project>/.git` itself), which reads as the
 * absent case — the same fail-direction `readBranchTip` names and accepts, and
 * the suppressing one. The rung walk inherits it exactly: a single dropped round
 * trip landing on one stat and not its neighbour reads as the standing fact.
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
    if ((await io.stat(adminRoot)) !== null) return { ok: false, reason: 'unlistable' };
    // …and a failed `stat` is not proof of absence either (see the docstring
    // above): claim the zero only when SOMETHING on this path answered. One
    // extra round trip, on the rare arm only.
    if ((await io.stat(path.join(projectsRoot, project, '.git'))) !== null) {
      return { ok: true, records: [] };
    }
    // Keep walking UP for a positive answer, because "there is no checkout
    // here" and "I could not see" are different facts and only a rung that
    // ANSWERS can tell them apart. Either of these two proves the link was up,
    // which makes the missing `.git` below a measurement rather than a
    // silence — `projectsRoot` is the last rung because it is config, not
    // fleet state: if that does not answer, nothing on this path did.
    if ((await io.stat(path.join(projectsRoot, project))) !== null
      || (await io.stat(projectsRoot)) !== null) {
      return { ok: false, reason: 'not-a-checkout' };
    }
    return { ok: false, reason: 'unreachable' };
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
