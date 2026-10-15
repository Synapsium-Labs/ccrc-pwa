import path from 'node:path';
import type { FleetIO, ReadFailure } from '../io.js';
import type { ChildReclaimGeneration } from '../../../shared/api.js';
import type { DelegationCensusRecord } from './delegation-model.js';

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
 * mismatch and never as a pass: not knowing is not `[]` (`ccd/ccd:2080-2086`).
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
 * Below, `io.statMeasured` on the IDENTICAL path is that proof, independent of
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
 * involved. Only when THIS arm's `stat` reads a PROVEN absent (the ordinary
 * "packed and never re-committed" case) is `packed-refs` treated as git's honest
 * fallback below. The parenthetical here used to add "or the rare inability to
 * even traverse the ref tree"; D-1400 made that false in this very function and
 * left the sentence standing (D-1446). An untraversable ref tree answers
 * `unreadable`, not `absent`, and takes the refuse arm.
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
    // (docstring above). THREE answers now, where this used to see two:
    //   ok         — this IS the loose ref, git's authoritative answer, and
    //                it must be refused rather than answered from packed-refs;
    //   unreadable — the stat could not be TAKEN. Not proof of anything, and
    //                this function's whole contract is to refuse what it
    //                cannot prove rather than let a stale packed tip settle a
    //                wave close. Until D-114 was closed this arrived wearing
    //                `{missing:true}`, i.e. indistinguishable from proof;
    //   absent     — proven no loose ref: packed-refs is the honest fallback.
    // AGENT SKEW: an OLDER agent's every measured read is `unreadable`, so a
    // PACKED branch reads `tip-unmeasurable` against one until the agent is
    // deployed. That is the fail-shut direction (refusing a close, never
    // settling one on a stale SHA) and the reason this ships AGENT-FIRST.
    const st = await io.statMeasured(loosePath);
    if (st.ok) return null;                  // the ref IS there — refuse, as before
    if (st.reason !== 'absent') return null;  // could not be measured — refuse (D-1400)
    // Only a PROVEN absence reaches packed-refs below.
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
 * absent case. `readBranchTip` above took that same direction UNTIL D-1400; it now
 * proves with `statMeasured` and refuses anything but a proven `absent`, so citing
 * it as precedent here has been false since (D-1446). This census is the last
 * reader in this file that still lets an unmeasurable `stat` read as absence, and
 * deliberately: the direction is the SUPPRESSING one — it can only hide a record,
 * never manufacture one — and `io.stat` has no measured form at these rungs. The rung walk inherits it exactly: a single dropped round
 * trip landing on one stat and not its neighbour reads as the standing fact.
 *
 * A DETACHED HEAD gives `headBranch: null`, never a fabricated name.
 */
export async function readWorktreeRecords(
  io: FleetIO, projectsRoot: string, project: string,
): Promise<WorktreeRead> {
  return (await censusProject(io, projectsRoot, project, false)).read;
}

/**
 * THE SAME CENSUS, EXTENDED ADDITIVELY (delegation broker wave 3, spec §5.5): the `WorktreeRead` `readWorktreeRecords` answers,
 * arm for arm, and — from the SAME listing of the admin directory, never a second one — one `DelegationCensusRecord` per admin
 * record. `delegation` is `null` for every `WorktreeRead` refusal: a project that was not censused has NO delegation census, which
 * is not an empty one (`ok: true` with `delegation: []` is the measured zero). The watcher's once-a-minute divergence sweep is the
 * only caller; this adds no schedule and no second read of the admin directory.
 *
 * Per record it adds at most one bounded measured read of each of `HEAD`, `CLAUDE_BASE`, the first 128 bytes of `logs/HEAD`, a `stat`
 * of `locked`, and the `gitdir` the legacy view already read. A record that cannot be read is KEPT as a row of its own instead of
 * skipped (`state: 'unreadable'`, a diagnostic naming what failed), and a record whose `gitdir` is proven absent is `state:
 * 'absent'`. Three folds are wave 1's D-4008 known limits and are pinned: a failed lock stat reads `locked: false`, an unreadable
 * first log reads `baseAgreesFirstLog: null`, and an unreadable `gitdir` reads as no canonical path. Each carries a diagnostic, and
 * the observe stage treats none of them as positive evidence of anything: the row an unreadable `gitdir` leaves is `unreadable`,
 * never `absent`, so it can neither start nor feed a measured absence.
 */
export async function readWorktreeCensus(
  io: FleetIO, projectsRoot: string, project: string,
): Promise<WorktreeCensus> {
  return censusProject(io, projectsRoot, project, true);
}

/** `readWorktreeRecords` plus, from the same pass, what the delegation lane reads (see `readWorktreeCensus`). `delegation` is `null`
 *  whenever THIS PASS did not MEASURE a delegation census, and that includes an `ok: true` read: the legacy view's zero rests on
 *  convenience reads that fold a failed read to "nothing there" (see `WorktreeRead`), a fold argued safe only because it can hide a
 *  record, while an empty delegation census would read as a measured absence of every record. `[]` is minted from measured reads only. */
export interface WorktreeCensus {
  read: WorktreeRead;
  delegation: DelegationCensusRecord[] | null;
}

/**
 * Every diagnostic the census can put on a `DelegationCensusRecord`, declared ONCE. `diagnostic` is these words joined by `,` in the
 * order below (the plan fixes it as `string | null`); `null` when none applies. Each names a condition that was MEASURED, so a reader
 * can tell a record that failed to read from one that read as nothing, and none of them is positive evidence of anything.
 */
export const DELEGATION_CENSUS_DIAGNOSTICS = [
  'gitdir-absent', 'gitdir-unreadable', 'gitdir-malformed', 'gitdir-relative',
  'head-absent', 'head-unreadable', 'head-malformed',
  'first-log-unreadable', 'first-log-malformed',
  'claude-base-malformed', 'claude-base-unreadable',
  'lock-unreadable', 'name-refused', 'record-initializing',
] as const;
export type DelegationCensusDiagnostic = (typeof DELEGATION_CENSUS_DIAGNOSTICS)[number];

/** The path guard for one admin record NAME, as the legacy view always applied it. */
const ADMIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** `logs/HEAD`'s first line starts `<40 hex> <40 hex> `: the second field is the commit the worktree was created at. */
const FIRST_LOG_BYTES = 128;
const FIRST_LOG_SHA = /^[0-9a-f]{40} ([0-9a-f]{40}) /;
/** git's null object id: what `git worktree add` writes to HEAD before the checkout. Not a commit. */
const NULL_OID = '0'.repeat(40);

async function censusProject(
  io: FleetIO, projectsRoot: string, project: string, extended: boolean,
): Promise<WorktreeCensus> {
  // Same single-segment guard `readBranchTip` applies to `project`: the only two
  // values that mean anything but a literal directory name are `.` and `..`.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project) || project.includes('..')) {
    return { read: { ok: false, reason: 'refused-project' }, delegation: null };
  }
  const adminRoot = path.join(projectsRoot, project, '.git', 'worktrees');
  // MEASURED reads, from which the legacy `null`/non-`null` answers below are derived: `readdir` and `stat` are themselves the
  // measured read with its reason dropped, so this takes no read the legacy view did not, and keeps the reason the delegation view
  // needs for its own zero.
  const listing = await io.readdirMeasured(adminRoot);
  if (!listing.ok) {
    // Present-but-unlistable, or genuinely absent? The listing collapses both to
    // `null` for the legacy view, so ask the question it cannot answer.
    const adminStat = await io.statMeasured(adminRoot);
    if (adminStat.ok) return { read: { ok: false, reason: 'unlistable' }, delegation: null };
    // …and a failed `stat` is not proof of absence either (see the docstring
    // above): claim the zero only when SOMETHING on this path answered. One
    // extra round trip, on the rare arm only.
    const dotGit = await io.statMeasured(path.join(projectsRoot, project, '.git'));
    if (dotGit.ok) {
      // The legacy zero stands as it always did. THE DELEGATION ZERO needs more: the listing PROVED the directory absent (an
      // ENOENT, not an EACCES or a dropped round trip) and `<project>/.git` answered. Anything else is no census at all.
      return { read: { ok: true, records: [] }, delegation: listing.reason === 'absent' ? [] : null };
    }
    // Keep walking UP for a positive answer, because "there is no checkout
    // here" and "I could not see" are different facts and only a rung that
    // ANSWERS can tell them apart. Either of these two proves the link was up,
    // which makes the missing `.git` below a measurement rather than a
    // silence — `projectsRoot` is the last rung because it is config, not
    // fleet state: if that does not answer, nothing on this path did.
    if ((await io.statMeasured(path.join(projectsRoot, project))).ok
      || (await io.statMeasured(projectsRoot)).ok) {
      return { read: { ok: false, reason: 'not-a-checkout' }, delegation: null };
    }
    return { read: { ok: false, reason: 'unreachable' }, delegation: null };
  }
  const out: WorktreeRecord[] = [];
  const delegation: DelegationCensusRecord[] = [];
  for (const name of listing.entries) {
    if (!ADMIN_NAME.test(name)) {
      // The legacy view skipped a name the guard refuses, silently. The delegation view keeps a row: a record this server will not
      // read is NOT a record that is not there, and nothing of it is joined into a path.
      if (extended) delegation.push(censusRow(project, name, 'unreadable', null, null, null, null, false, null, ['name-refused']));
      continue;
    }
    const dir = path.join(adminRoot, name);
    // ONE body for both views: `extended` only gates the three extra reads. The two always-read files are issued together, which
    // costs the legacy view a HEAD read for a record whose `gitdir` fails, a record it then skips as before.
    const [gitdir, head, base, log, lock] = await Promise.all([
      io.readFileMeasured(path.join(dir, 'gitdir')),
      io.readFileMeasured(path.join(dir, 'HEAD')),
      extended ? io.readFileMeasured(path.join(dir, 'CLAUDE_BASE')) : null,
      extended ? io.readFileFromBytesMeasured(path.join(dir, 'logs', 'HEAD'), 0, FIRST_LOG_BYTES) : null,
      extended ? io.statMeasured(path.join(dir, 'locked')) : null,
    ]);
    // The legacy record, exactly as before: a readable `gitdir` naming a worktree, and whatever branch HEAD gave.
    const wt = gitdir.ok ? worktreeOf(gitdir.content) : null;
    if (wt !== null) out.push({ name, path: wt, headBranch: head.ok ? headOf(head.content).branch : null });
    if (!extended || base === null || log === null || lock === null) continue;

    const diag: DelegationCensusDiagnostic[] = [];
    let canonical: string | null = null;
    if (gitdir.ok) {
      const t = gitdir.content.trim();
      if (wt === null) diag.push('gitdir-malformed');
      else if (!path.isAbsolute(t)) diag.push('gitdir-relative');
      else canonical = wt;
    } else diag.push(gitdir.reason === 'absent' ? 'gitdir-absent' : 'gitdir-unreadable');

    let branch: string | null = null;
    let sha: string | null = null;
    if (head.ok) {
      const h = headOf(head.content);
      branch = h.branch;
      sha = h.sha;
      if (branch === null && sha === null) diag.push('head-malformed');
    } else diag.push(head.reason === 'absent' ? 'head-absent' : 'head-unreadable');

    let firstLog: string | null = null;
    if (log.ok) {
      firstLog = FIRST_LOG_SHA.exec(Buffer.from(log.bytes).toString('latin1'))?.[1] ?? null;
      if (firstLog === null) diag.push('first-log-malformed');
    } else if (log.reason === 'unreadable') diag.push('first-log-unreadable');

    // CLAUDE_BASE, else the first `logs/HEAD` line (spec §5.5). The fallback is for an ABSENT CLAUDE_BASE only: a malformed or
    // unreadable one may be a base this process cannot see, and is never papered over with a guess.
    let claudeBase: string | null = null;
    let fileBase: string | null = null;
    if (base.ok) {
      const t = base.content.trim();
      if (SHA.test(t)) fileBase = t;
      else diag.push('claude-base-malformed');
      claudeBase = fileBase;
    } else if (base.reason === 'absent') claudeBase = firstLog;
    else diag.push('claude-base-unreadable');
    const agrees = fileBase !== null && firstLog !== null ? fileBase === firstLog : null;

    // D-4008: a failed stat of `locked` reads false (named), a proven absence reads false (the ordinary case).
    if (!lock.ok && lock.reason === 'unreadable') diag.push('lock-unreadable');

    // THE STATE (ruling R46). `absent` is the REMOVAL race and nothing else: the `gitdir` proven ENOENT, HEAD proven ENOENT and
    // `locked` proven ENOENT — a listed directory with nothing left in it. A `gitdir` ENOENT beside a present `locked` is
    // `git worktree add` mid-initialisation (it creates the directory and `locked` first): a record being BORN, `unreadable` and
    // named. Whatever else this process could not read is `unreadable` too, kept as a row and never folded into `absent`: only a
    // measured absence may count toward an absence.
    const gitdirAbsent = !gitdir.ok && gitdir.reason === 'absent';
    const removed = gitdirAbsent && !head.ok && head.reason === 'absent' && !lock.ok && lock.reason === 'absent';
    if (gitdirAbsent && lock.ok) diag.push('record-initializing');
    const state: DelegationCensusRecord['state'] = removed ? 'absent'
      : (!gitdir.ok || (!head.ok && head.reason === 'unreadable')) ? 'unreadable'
      : 'present';
    delegation.push(censusRow(project, name, state, canonical, branch, sha, claudeBase, lock.ok, agrees, diag));
  }
  return { read: { ok: true, records: out }, delegation: extended ? delegation : null };
}

function censusRow(
  project: string, adminRecord: string, state: DelegationCensusRecord['state'], canonicalPath: string | null,
  headBranch: string | null, headSha: string | null, claudeBase: string | null, locked: boolean,
  baseAgreesFirstLog: boolean | null, diagnostics: readonly DelegationCensusDiagnostic[],
): DelegationCensusRecord {
  return {
    project, adminRecord, canonicalPath, headBranch, headSha, claudeBase, locked, baseAgreesFirstLog, state,
    diagnostic: diagnostics.length === 0 ? null : diagnostics.join(','),
  };
}

/** The worktree a `gitdir` file names: its `.git` FILE's parent. `null` when that names nothing. */
function worktreeOf(gitdirText: string): string | null {
  const wt = path.dirname(gitdirText.trim());
  return wt === '' || wt === '.' ? null : wt;
}

/** What HEAD says: `ref: refs/heads/<branch>` is a branch (when the path guard passes it); a bare sha is a detached HEAD. */
function headOf(text: string): { branch: string | null; sha: string | null } {
  const t = text.trim();
  const m = /^ref:\s*refs\/heads\/(\S+)\s*$/.exec(t);
  const branch = m?.[1] ?? null;
  return {
    branch: branch !== null && BRANCH_OK.test(branch) ? branch : null,
    // The null object id is what `git worktree add` writes before the checkout: not a commit, so never a detached HEAD's sha.
    sha: SHA.test(t) && t !== NULL_OID ? t : null,
  };
}

// ── The parent's incarnation (delegation broker wave 3, ruling R38) ───────────────────────────────────────────────────────────────

/**
 * A parent's incarnation, `$REG/<id>.generation`, as the census pass measured it. MEASURED only when the id read as a value before
 * the pass used it and as the SAME value after: an absent, unreadable (the one read cannot tell a malformed file from an unreadable
 * one) or changing generation is `unmeasured`, with the reason named.
 */
export type ParentIncarnation =
  | { readonly kind: 'measured'; readonly incarnation: string }
  | { readonly kind: 'unmeasured'; readonly reason: ReadFailure | 'changing' };

/** THE ONE READ of a registry generation (`childReclaimGenerationRead`), curried over the registry and the port by the caller. */
export type ParentGenerationRead = (id: string) => Promise<ChildReclaimGeneration>;

const generationOf = async (read: ParentGenerationRead, id: string): Promise<ChildReclaimGeneration> => {
  // A port that REJECTS is not caught by the one read; it is a read that failed, and says so.
  try { return await read(id); } catch { return { kind: 'unreadable' }; }
};

/** The first read, taken BEFORE the pass uses the ids. CONCURRENT: one round trip however many ids, and a read never rejects. */
export async function readParentGenerations(
  read: ParentGenerationRead, ids: Iterable<string>,
): Promise<ReadonlyMap<string, ChildReclaimGeneration>> {
  const distinct = [...new Set(ids)];
  const reads = await Promise.all(distinct.map((id) => generationOf(read, id)));
  return new Map(distinct.map((id, i): [string, ChildReclaimGeneration] => [id, reads[i]!]));
}

/** The second read, AFTER the pass: only an id whose first read was a value is read again, never a whole extra scan. Concurrent. */
export async function settleParentIncarnations(
  read: ParentGenerationRead, before: ReadonlyMap<string, ChildReclaimGeneration>,
): Promise<ReadonlyMap<string, ParentIncarnation>> {
  const settled = await Promise.all([...before].map(async ([id, first]): Promise<[string, ParentIncarnation]> => {
    if (first.kind !== 'value') return [id, { kind: 'unmeasured', reason: first.kind }];
    const second = await generationOf(read, id);
    return [id, second.kind === 'value' && second.v === first.v ? { kind: 'measured', incarnation: first.v }
      : second.kind === 'unreadable' ? { kind: 'unmeasured', reason: 'unreadable' }
      : { kind: 'unmeasured', reason: 'changing' }];
  }));
  return new Map(settled);
}

/**
 * What the watcher's once-a-minute census pass prepares for the delegation lane (nothing consumes it before wave 3's watcher lane):
 * every censused project's answer, a refusal included, so a project that was not read is never mistaken for one that was empty, and
 * the incarnation of every id the pass used.
 */
export interface DelegationCensusPass {
  readonly measuredAt: number;
  readonly projects: ReadonlyMap<string, WorktreeCensus>;
  readonly incarnations: ReadonlyMap<string, ParentIncarnation>;
}
