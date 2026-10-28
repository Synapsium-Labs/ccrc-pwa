# The worktree economy: fewer, cheaper, shorter-lived workspaces, and the rest of coordinator durability

**Spec** · 2026-10-28 · Status: draft for the operator's rulings (§10). It defines no D-numbers; the plan that builds
it allocates them when the rulings land · Owner: the ccrc coordinator · Epic: #752 (durability, items #757, #758,
#760, #761) · Related work in flight: #1772 and #1781 (the deps-shed arm, Part B of the worktree-leak note)

**Builds on (read these first):**
`2026-10-23-fleet-disk-retention-design.md` (the four disk rulings and the lifecycle exits G1 to G4),
`docs/superpowers/plans/2026-10-28-worktree-leak-design.md` on #1772's branch (why a sleeping registered worktree has
no exit, and the deps-shed fix),
`2026-10-20-fleet-capacity-and-worker-lifecycle-design.md` (§3.2: one reviewer per work run, ruled and unbuilt as its
W2; the plan's Rejected list),
`2026-10-20-coordinator-durability-tail-epic-ledger-d7-recon-design.md` (D7 and D8),
`2026-09-22-child-workspace-reclamation-design.md` (child reclaim and its sweep),
`2026-08-11-artifact-lifecycle-policy.md` (the containment spine).

**The request (operator, 2026-10-28, verbatim):**

> "can we fix coordinator durability ... One of the real problems we have is having so many throwway worktrees all
> sitting on disk in parallel"

## In short

A read-only census of one fleet box on 2026-10-28 found 124 worktrees using 69 GB. Half of that, 34.7 GB, was
`node_modules`. Most trees were less than a day old. The pile has four causes, and only one of them is about age:

1. **Child reclaim has failed on every attempt for about eight hours (§2).** 56 trees whose runs are closed, 45% of
   all trees, are stuck behind `probe-unmeasured`. This is an outage, not a policy gap, and it comes first.
2. **Every review round gets a full checkout (§3).** 59 of the 124 trees are review or fix-round copies. The capacity
   spec already ruled "one reviewer per work run, resumed per round" (its W2), but nobody built it. A review round
   also does not need its own dependencies.
3. **Every worktree pays for its own dependencies (§4).** npm copies each file, so every tree costs about 1 GB before
   any work happens. A per-package cache with hardlinks, verified against a manifest, makes a new tree cost little
   more than its source files, once sessions stop running a blanket `npm ci`.
4. **Some runs never close, and some sessions never leave (§5, §6).** Runs parked in review or merge keep their
   workers. Manual sessions and coordinators are never reclaimed automatically. The lanes that would release these
   either do not exist, are hard-coded at 7 or 14 days, or are built but not armed.

Coordinator durability (§7) feeds point 4 indirectly: a run its coordinator has forgotten is a run that never
closes, and it keeps its worker. D4, D6 and D7 are mostly built but switched off. What remains is small: arm three
markers after their shadow records are read, cover "wake" in D4, build D7's PWA section, and land W6's #1407.

Every age, count, size and path below is deployment config with a neutral default. Every new destructive arm ships
in shadow behind a marker with no writer in the tree.

## 1. The census

Read-only on one fleet box, about 15:25Z on 2026-10-28, at idle IO priority. Figures are a snapshot. Measure again
before quoting them.

- **124 directories** under the ccd worktree root, **69.0 GB**, of which **34.7 GB is `node_modules`**.
- **Runs:** 547 in total, 47 not terminal: 29 planned, 8 awaiting review, 5 working, 3 dispatched, 2 merging.

| Kind | Trees | GB | GB without `node_modules` | State |
|---|---:|---:|---:|---|
| Review or fix-round copies (run kind `review`) | 59 | 12.9 | 10.2 | 53 asleep, 3 live, 3 ccd-orphan |
| Run workers | 35 | 17.1 | 10.2 | 25 asleep, 7 live, 3 ccd-orphan |
| Coordinators | 10 | 20.2 | 3.3 | all live; one alone is 14 GB, 12.8 GB of it `node_modules` |
| Manual sessions | 14 | 15.2 | 8.3 | 2 live, 12 asleep (9 of them idle 8 to 11 days) |
| No registry row (another project's deliberately kept, unpushed trees) | 5 | 1.5 | | kept on purpose |
| Worker whose run is missing from the list | 1 | 2.2 | | |

**By age** (newest of last commit, end, stop or run close): 64 under 1 day, 19 at 1 to 2 days, 14 at 2 to 7 days,
17 at 7 to 14 days, none past 14 days, 5 unknown.

**By reason kept:**

| Reason | Trees | GB |
|---|---:|---:|
| Run closed, reclaim deferred, `probe-unmeasured` | 56 (44 review copies, 12 workers) | 11.4 |
| Live session | 22 | 38.9 |
| Manual session, never auto-reclaimed | 12 | 6.0 |
| Review kept until the reviewed run closes (`review-report-live`) | 12 | 3.0 |
| Run still open under a programme hold | 10 | 5.4 |
| Deliberately kept trees with no row | 5 | 1.5 |
| Marked reclaimed, but an empty or near-empty directory remains | 4 | 0.3 |
| Reclaim refused (path proof) | 1 | 0.4 |
| Missing run | 1 | 2.2 |

**Switches on that box.** Armed: `child-stale-reclaim`, `child-superseded-reclaim`, `collect`, `collect-loose`,
`expire-child`, `expire-lane`, `hibernate`, `nested-rescue`, `orphan-tree`, `scope-sweep`, `stall-watch`. Not armed:
`coordinator-roster-card-live`, `drift-push-live`, `dead-coordinator-lane-live`, `stale-archive-live`.

**What the census rules out.** Lowering the stale floor alone does little now. Only 17 trees are older than 7 days,
and 12 of those are manual sessions. The pile is fresh, so the fix is to make trees cheaper and to release them at
the event that finishes them, not to wait less.

## 2. First: the reclaim outage (the largest driver)

**Measured.** In the box's lifecycle journal, the last reclaim `done` was at about 07:07Z. Every attempt since then
has failed with `probe-unmeasured`, in roughly hourly passes, until the census at 15:25Z. 350 of those journal lines
carry `"truncated":true` and no readable detail, so the journal does not say which check failed. Earlier failures
that were not truncated named three bounded walks that timed out:

- the scan inside ignored directories, `REAP_SCAN_SECONDS` (30 s, `ccd/ccd`). Its own message says "remove or move
  the largest ignored directory and reap again";
- the permission pass (`_ws_leaf_why_line`, same bound);
- the process-table walk, `WS_PATH_USERS_SCAN_S` (10 s).

The failures began after the fleet moved to a new box, and ccd was rebuilt the same day.

**Hypothesis, not yet proven.** On a slower or busier box, the scan inside ignored directories runs past its 30 s
bound on trees with a large `node_modules`, so the audit measures nothing and the reclaim fails closed. That would
explain why review copies, which hold full dependency trees, make up most of the stuck set.

**Recommendation (R-0).**

1. **Diagnose.** Run `ws-audit --reclaim` on one stuck id. This is on the CLAUDE.md SAFETY list, so it needs the
   operator's approval, and the approval request names the rule. Record which walk timed out and how long it took.
2. **Make the failing check visible.** The journal encoder drops `reason`, `cgraw` and `meas` to fit its 2048-byte
   cap. The probe that failed must survive that cap. Add a short, fixed-vocabulary `probe` field to the event (for
   example `ignored-scan`, `perm-pass`, `proc-walk` or `id-walk`), placed before every dropped field. Then a
   truncated line still says what failed. A characterization test pins today's lines first.
3. **Make the bounds deployment config.** `REAP_SCAN_SECONDS`, `WS_PATH_USERS_SCAN_S` and `WS_RECLAIM_WALK_S` become
   box env knobs (`CCD_REAP_SCAN_S`, `CCD_PATH_USERS_SCAN_S`, `CCD_RECLAIM_WALK_S`), with today's values as the
   defaults. They are bounded both ways: a floor so a misconfiguration cannot turn a bound off, and a ceiling under
   the verb's runner row in `CCD_VERB_TIMEOUT_MS`, which a budget test already checks for `ws-shed-deps`.
4. **Skip what is rebuildable.** Once deps-shed (§8) has run on a tree, its `node_modules` is gone and the scan is
   cheap. Run order should follow from that: a sleeping tree is shed first and reclaimed later. The reclaim probe
   itself does not learn to skip `node_modules`. The scan exists to find work hidden inside ignored directories, and
   a nested checkout inside `node_modules` is exactly what it must catch.
5. **Alert on a failing lane.** When a lane fails on every attempt for longer than `CCRC_LANE_FAILING_ALERT_HOURS`
   (default 4), the server raises a banner and an operator notification. It goes through the existing attention
   path, not a new notifier. Eight hours of silent failure is the real defect here.

**Why first.** It touches no policy. It frees 11.4 GB and 56 trees as soon as the cause is fixed, and every later
section assumes reclaim works.

## 3. Review and fix rounds: one reviewer, one light checkout, released at the verdict

**Measured.** 59 of 124 trees are review or fix-round copies. One work run produces a `-review` copy, then `-rev`,
`-rev2` and `-rev3`, and each is a fresh `ws-add` on the run's project (`dispatchRun` → `CCD_ARGV.wsAddWorker`,
`server/src/coord/dispatch.ts`), so each is a full checkout. Its session then installs dependencies. 12 more are kept
on purpose as `review-report-live` until the reviewed work run closes (`childReclaimSweepVerdict`,
`server/src/childReclaimSweep.ts`).

**What is already true.** The reviewer's report does not live in its worktree. The reviewer skill writes it under
`$HOME/.cc-clips/<session id>/`, because the agent's read allowlist excludes worktrees
(`ccd/reviewer-skill/SKILL.md`, step 7). But `review-report-live` still has to keep the whole child, not only the
tree. Child reclaim is one act: the reclamation spec (2026-09-22, Definitions) defines it as destroying "the worktree,
the branch, the clips, the per-session temp root, the pane, the unit and the registry row". Reclaiming a review child
deletes its `.cc-clips`, and with them the report that the coordinator's fix-round mail cites by path. It also
deletes the registry row, so the session cannot be resumed afterwards.

**The choice this spec makes.** A review tree can either stay across rounds, so the next round resumes it (R-1a), or
be released at its verdict, so the next round starts a fresh reviewer. It cannot do both: releasing it is a reclaim,
and a reclaim leaves nothing to resume. No `ws-add` revives a purged session id. Reusing one would also collide with
the generation, tombstone and birth-event fences in `coord/childReclaim.ts`, the same class of failure as the stale-run
name-reuse bug. **This spec chooses to keep the tree across rounds (R-1a)** and to make it cheap while it waits
(R-1b, R-1c). Release at the verdict is rejected (see Rejected).

**Recommendation (R-1), in three parts.**

- **R-1a. One reviewer per work run, resumed per round.** Build the capacity spec's W2 as ruled on 2026-10-20: a fix
  round's review run opens bound to the previous reviewer's `sessionId` when that reviewer reviewed the same work run.
  Dispatch resumes it, waking it if it is asleep, with `/clear`, through the resume arm that workers already use. The
  tree, the clips and the registry row all stay, so the report the fix-round mail cites stays readable. This turns
  `-review`, `-rev`, `-rev2` and `-rev3` into one tree per work run. It is the largest structural saving: in the census
  it would remove most of the 59.

  **A re-bound reviewer is never reclaimed under the next round.** Today a review child is kept only by the review
  words (`review-report-live`, `review-report-stale`) and `REVIEW_CHILD_CEILING_MS`, all keyed on the run that minted
  it, and the stale arm already lapses those words. Once round N+1 resumes round N's session, a close-time reclaim of
  round N's review run, the stale arm or the ceiling could remove a reviewer that round N+1 is using. R-3a also makes
  that ceiling configurable and lowerable. So R-1a requires:
  - **(a) The earlier review run is terminal before the session is re-bound.** Dispatch binds round N+1's review run
    to the session only after round N's review run reads terminal, through the single-writer binding pin of #1405
    (`coord/runBinding.ts`). A session is bound to at most one non-terminal run at a time. If round N's run is not
    terminal, or its state cannot be read, the re-bind refuses and the round opens a fresh reviewer, as today.
  - **(b) Every verdict keeps a session bound to any non-terminal run.** Close-time child reclaim, the sweep, the stale
    and superseded arms, the review ceiling (`review-report-stale`), deps-shed's decider rows and every shed or
    hibernate verdict first ask whether the session is bound to a non-terminal run, whichever run minted it, and keep
    it (a kept verdict, for example `bound-to-open-run`) when it is. An unreadable binding is doubt, and doubt keeps.
    The plan adds one test per verdict: a reviewer minted by a terminal round-N run and re-bound to an open round-N+1
    run is kept by each of them, including after the ceiling and the stale floor have passed.

  **Moving the resumed tree to the fix round's tip.** A resume with `/clear` does not move the tree. Before the
  kickoff, dispatch runs a box verb (named in the plan, for example `ccd ws-advance`) that does exactly this, each git
  call contained as the reclaim ladder's are (`_ws_reclaim_contained`):
  1. `git status --porcelain=v1 -z --untracked-files=all`. Anything listed, staged, modified or untracked (a repro
     test, a scratch file), makes the verb **refuse** with `dirty-tree`, touching nothing;
  2. a contained `git fetch` of the work run's branch from the remote;
  3. `git checkout --detach <tip>` (never `reset --hard`, `stash`, `clean` or `--force`). Git itself refuses a
     checkout that would overwrite a local change, and the verb passes that refusal on.

  On any refusal, the reviewer is not resumed. The round opens a fresh reviewer, as today, and the old one stays under
  its existing review words until its reviewed work run closes, with its files intact. The refusal is journaled and
  shown on the round's run card.
- **R-1b. A review checkout without its own dependencies.** A reviewer reads a branch tip and runs lenses. It may run
  tests, so it needs dependencies, but it does not need its own copy. With §4's cache, and once the reviewer skill
  stops running a blanket `npm ci` (§4, "Who installs"), a review tree gets its dependencies by hydrate in seconds and
  for almost no space. Without the cache (the cache is off, or the key is missing from it), the review keeps today's
  behaviour. A separate "lite" checkout kind, with no dependencies at all, is **rejected**: lenses that run the suite
  would fail in ways that look like findings.
- **R-1c. Between rounds, shed rather than reclaim.** A reviewer that has posted its verdict and sleeps is kept, as
  today, until the reviewed work run closes (`review-report-live`, unchanged). While it waits, deps-shed (§8) may
  remove its `node_modules` after the same age as any other sleeping child; this needs one row in the shed decider
  for review children, in shadow behind the existing `deps-shed-live` marker, with a test that a shed review child
  keeps its tree, clips and registry row. On resume, R-1b's hydrate (or the session's own install, without the cache)
  restores the dependencies. When the reviewed work run closes, normal child reclaim removes the reviewer whole, clips
  included, exactly as it does today. Nothing is deleted earlier than today, and no reclaim variant is needed.

**What this changes in existing rules.** None. The capacity plan's Rejected list says "no report copy (W2-1
dropped)", and this spec copies no report. `review-report-live` keeps its meaning.

## 4. Shared dependencies: a per-lockfile cache

**Measured.** About half of every tree is `node_modules`: 34.7 of 69 GB fleet-wide, and 12.8 of one coordinator's 14
GB. npm writes a full copy per tree, with a link count of 1 (worktree-leak note §1). ccd already lists `node_modules`
and `cdk.out` in each repository's `info/exclude`, without a trailing slash, so a symlinked `node_modules` is
ignored (`ccd/ccd`, the `ws-add` exclude block). The fleet has used that shape before.

**Options.**

| Option | Space | Risk | Verdict |
|---|---|---|---|
| (a) Symlink `node_modules` to a shared directory | near zero | one tree's `npm install` or postinstall changes every tree's copy; tools that resolve real paths escape the worktree | rejected |
| (b) A package-manager content store (pnpm or similar) | near zero | changes the project's package manager; ccrc does not own projects' tooling | rejected for ccrc; a project may choose it itself |
| (c) Reflink copy (`cp --reflink`) from a cache | near zero until written | needs a copy-on-write filesystem, which a generic deployment may not have | used when the filesystem supports it |
| (d) Hardlink copy from a read-only per-lockfile cache | near zero; a chmod or an in-place write is caught by the entry's manifest | a chmod plus an in-place write to a hardlinked file changes the cache for every tree | **recommended**, with (c) preferred where available |

**Recommendation (R-2): `ccd ws-deps`, a box verb that hydrates dependencies from a cache.**

- **Package directories.** A tree can hold several packages, each with its own lockfile and `node_modules`. This
  repository has four (`server`, `agent`, `ui`, `pwa`). The verb finds them with `git ls-files`, matching the basenames
  in `CCD_DEPS_CACHE_LOCKFILES` (default `package-lock.json`) and skipping anything under a `node_modules`. Each
  package directory is its own cache entry, with its own key, filled and hydrated on its own.
- **Linked siblings and order.** A lockfile entry with `"link": true` (a `file:` dependency) is a symlink to a sibling
  package in the same tree. Here `server` links `../agent` and `pwa` links `../ui`, and `pwa` also resolves `ui`'s
  source through `ui/node_modules`. The verb reads the link targets from each lockfile and processes the package
  directories in dependency order (targets first: `agent` before `server`, `ui` before `pwa`). A cycle, a target
  outside the tree, or an npm workspaces root makes the verb skip the cache for every package in that group, and the
  session installs them itself. The cache stores links as relative symlinks. A hydrate checks that each one resolves
  inside the worktree, and if any does not, it falls back to a private install for that package.
- **Key.** The sha256 of every input that changes what the install writes: the lockfile, the package's
  `package.json` (scripts, overrides), the project's `.npmrc` files on the package's path, the runtime's and the
  package manager's versions, platform and architecture, the install command, and the values of the environment
  variables in `CCD_DEPS_CACHE_ENV_KEYS` (default: the package manager's registry and script variables). A
  user-level `.npmrc` is not read during a fill (see Fill), so it is not part of the key. Entries live under
  `CCD_DEPS_CACHE_ROOT` (default unset, which means the cache is off and behaviour is unchanged).
- **Fill: only from shared, reviewed inputs.** An entry is shared with every other tree, so one session must not be
  able to fill it from its own modified repository. A miss is filled only when the lockfile and `package.json` blobs
  appear at the tip of the project's default branch on its remote. The verb fills from that commit, not from the
  session's working copy. It runs the install with a scrubbed environment and a user config file owned by the cache.
  A tree whose inputs are not on the default branch (a branch that changes dependencies) installs privately, as
  today, and does not touch the cache.
- **Fill: what is staged.** The lockfile and `package.json` alone cannot be installed. `server` depends on
  `file:../agent` and `pwa` on `file:../ui`, so `npm ci` needs the link targets on disk to resolve them, and
  `server`'s `postinstall` runs a script from its own source (`scripts/fix-node-pty-helper.mjs`). So the fill exports,
  from the one default-branch commit, the package's directory and the directory of every link target in its link
  closure (`git archive <commit> -- <pkg> <targets…>`), at their relative paths inside the staging directory, and runs
  the install there. Then:
  - **Key.** The key adds, for each link target, its `package.json` and lockfile blobs. A package whose own
    `package.json` declares a root lifecycle script (`preinstall`, `install`, `postinstall` or `prepare`) adds the git
    tree id of its whole directory at that commit, because the script reads source the key cannot otherwise see. That
    is correct but misses on every source change to that package. A deployment may name narrower key paths per
    package in `CCD_DEPS_CACHE_KEY_PATHS` (for example the scripts directory the hook runs); default unset.
  - **Only `node_modules` is cached.** The export is not a repository, so before the install the verb records every
    staged path with its size, mode and mtime, and after it walks the staging tree outside the package's own
    `node_modules` and compares. If the install wrote anywhere outside the package's
    own `node_modules`, for example into a link target's `node_modules` or into a build output under the package, the
    key is marked `no-cache`: a hydrate cannot restore those writes, so that package always installs privately. The
    plan measures the four packages here before it claims a saving for any of them.
  - The staging copy is removed after the entry is renamed into place. Only the package's `node_modules` (with its
    links stored as relative symlinks, below) becomes the entry.
- **Fill: staging and the filesystem.** The entry is built in a staging directory **inside** `CCD_DEPS_CACHE_ROOT`,
  not under the session's `TMPDIR`. The session's temp root can be a different filesystem (a tmpfs, or another mount),
  and a rename across filesystems fails. The finished entry is renamed into place within one directory, so a
  half-built entry is never visible. A per-key lock stops two fills of one key from racing. The loser waits, then
  hydrates.
- **Hydrate: same filesystem, proven per tree.** A hardlink needs the cache and the worktree on one mount. A bind
  mount of the same filesystem is still a different mount, and `link()` across it fails. Before each hydrate, the verb
  compares device ids and makes one probe link (or one probe reflink) from the cache into the worktree. If the
  reflink works, it reflinks: no shared inodes, so the integrity concerns below do not apply. If only the hardlink
  works, it hardlinks (`cp -al`). If neither works, it makes a full copy, or the session installs, and the reason is
  logged once per tree. The verb then writes a stamp, `node_modules/.ccd-deps-key`, that holds the entry's key.
- **Integrity of a hardlinked entry.** File modes do not protect a shared inode on their own. Every session runs as
  the uid that owns the cache, so a `chmod u+w` (by an agent, a tool's `chmod -R` or a postinstall) changes the cache
  inode's mode for every tree, and a later in-place write then changes the bytes for every tree. Detection does not
  rely on modes:
  - At fill, the verb writes a manifest beside the entry: path, file type, inode, mode, size, mtime and sha256 for
    every file, and the target of every symlink. It records **no ctime and no link count**. Under hardlinks both
    drift on every legitimate use: `link()` and `unlink()` change the shared inode's link count, which is inode
    metadata, so the first `cp -al` hydrate and every shed or reclaim of a hydrated tree change the ctime of every
    cache file. A ctime compare would quarantine every entry on its second hydrate.
  - **Every hydrate** compares, per file, the `lstat` fields the manifest holds: inode, type, **mode compared
    directly** (that is the chmod signal, in place of ctime), size and mtime, and each symlink's target. A write
    changes size or mtime. A chmod changes mode. Hashes are checked for a sample of files
    (`CCD_DEPS_CACHE_HASH_SAMPLE`, default 2%). What a stat compare cannot see is a chmod, an in-place write of the
    same size, a chmod back and an mtime reset. The sample and the full re-hash below catch that, later, and the
    quarantine then marks every tree hydrated from the entry since its last clean re-hash.
  - **Cost.** An entry set for this repository is on the order of 300k files (a reviewer's estimate; the plan measures
    it). The compare is one `lstat` per file, done in the same walk that links or reflinks it, so it adds no second
    walk: roughly a second or two warm and several seconds cold, plus reading the 2% sample. The walk is bounded by
    `CCD_DEPS_CACHE_HYDRATE_S` (default 120, under the verb's runner row). A walk that does not finish is not a
    mismatch: the verb removes the partial target it made, does not quarantine, and the session installs privately.
    The plan measures the walk on a real box before the default is fixed.
  - **The tmp-sweep arm** (see Eviction) re-hashes every entry in full, at most once per
    `CCD_DEPS_CACHE_VERIFY_HOURS` (default 24).
  - A mismatch **quarantines** the entry. It is renamed aside, never served again and never repaired, and the next
    miss refills it from the default branch. The verb records which trees it hydrated from each entry. On quarantine,
    those trees get a `deps-suspect` mark, and their next `ws-deps` call replaces their `node_modules`. The worker and
    reviewer skills treat a `deps-suspect` mark as "rehydrate before testing".
  - **Hydrate only into an empty target; every replace is fenced.** A hydrate writes a package's `node_modules` only
    when it does not exist. Every path that would remove or replace an existing one (a `deps-suspect` replace, a stamp
    that does not match the current key, a stamp that is missing, a wake after a shed that left something behind, and
    the cleanup of a partial hydrate) goes through deps-shed's fences, by calling the same shared ccd functions as
    `ws-shed-deps` (#1772's rungs 7, 8, 9 and 11), not a copy:
    - the target is a real directory on the workdir's filesystem, resolves inside the workdir, and is ignored and
      untracked (`git ls-files -- <dir>` empty);
    - it holds no `.git` (directory, file or link) at any depth, by one bounded `find`; a walk that does not finish
      answers `unmeasured`;
    - no process holds a file under it (`_ws_path_users_many` on its physical spelling), other than the verb's own
      process tree; unmeasured answers `unmeasured`;
    - a contained `git status --porcelain=v1 -z --untracked-files=all` digest is read before the removal and again
      after it, and a difference answers `git-state-changed`.

    Ignored trees can hold a nested checkout or a hand-patched package that git cannot see, and these fences exist for
    that. Only deps-shed's asleep rungs do not apply, because the session running `ws-deps` is the tree's owner. Any
    refusal leaves the existing `node_modules` exactly as it is, keeps the `deps-suspect` mark, and reports the word,
    so the session can look and decide. It never falls back to an unfenced `rm`. Tests: one per fence on each replace
    path.
  - Where a deployment can run the cache under its own uid (`CCD_DEPS_CACHE_OWNER`, default unset), the cache files
    belong to that uid and a session cannot chmod them at all. The manifest checks stay on either way.
  - A key whose postinstall must write into its own files is marked `copy-only` at fill (the fill sees the write fail
    on the read-only staging copy), and later hydrations make a full copy.
- **Who installs: the instructions must change, or nothing is saved.** `npm ci` deletes `node_modules` before it
  installs. This repository's CLAUDE.md tells every session to run `npm ci` in `server`, `agent`, `ui` and `pwa`. Under
  those instructions, a hydrated tree is wiped and refilled with a private copy on its first test run, and the cache
  saves nothing. (The wipe is safe, because removing hardlinks never changes the cache, but it is wasted.) So the same
  step that ships the verb also changes the instructions:
  - `ccd ws-deps --check` exits 0 when every package directory's stamp matches its current key and the entry is not
    quarantined.
  - The worker and reviewer skills (`ccd/worker-skill`, `ccd/reviewer-skill`) and this repository's CLAUDE.md say:
    when `ccd ws-deps` exists, run `ccd ws-deps` (which hydrates, or does nothing when `--check` would pass) in place
    of `npm ci`, and run `npm ci` in a package only when `ws-deps` reports it installed nothing for that package.
  - A project that keeps a blanket `npm ci` in its own instructions still works correctly. It just gets no saving.
  - The saving claimed below is conditional on this change, and the plan measures it after the change, not before.
- **Who calls it.** `ws-add --child` calls it after the checkout when the cache is configured. A coordinator or
  manual session can run it itself, and wake after a shed calls it again.
- **The SAFETY list.** The cache root is shared state, so the verb's forms are split by what they write. A hydrate
  writes only the session's own tree, and its only reads of shared state are checked against the manifest. A fill
  writes the shared cache, but only from default-branch inputs, under a lock, into staging and then a rename, so a
  session cannot choose what it writes. Neither form is on the SAFETY list. The forms that remove or replace shared
  entries by hand (`ws-deps --purge`, `--quarantine`, `--evict`) **are** added to the CLAUDE.md SAFETY list. The
  sweep's own eviction and quarantine run on the box timer, not from a session.
- **Eviction.** An entry with no hydrations recorded from a live tree, and unused for `CCD_DEPS_CACHE_IDLE_DAYS`
  (default 14), is removed, oldest first, until the cache is under `CCD_DEPS_CACHE_MAX_GB` (default 20). A sampled
  link count of 1 is a second check, not the main one. This rides the existing `ccd-tmp-sweep` timer as one more arm
  (together with the full re-hash above), not as a new timer.
- **Accounting.** With hardlinks, a per-tree `du` counts shared bytes in every tree. The disk alarm (retention spec,
  ruling 4) already reads `statfs`, which is correct. Tree-size figures in the UI and in reclaim feed rows say
  "unique bytes" when they come from `du -l` and say nothing more precise than that.

**What it saves, and when.** In the census, `node_modules` was 34.7 GB in about 120 trees, and most of those trees
share a handful of keys (four package directories per tree in this repository, so a handful of entries per
default-branch lockfile set). Once the instructions change above has landed, that is about one copy per entry, a few
GB in total, and a new worker costs its source files, about 0.1 GB for this repository. Trees on branches that change
dependencies still install privately. Before the instructions change, the saving is zero, and the plan does not
claim it.

**Interaction with deps-shed (§8).** Removing a hardlinked `node_modules` frees almost nothing, because the cache
holds the same inodes, and that is fine. Waking a shed tree is then a hydrate, which takes seconds, rather than an
`npm ci`. The shed arm and the cache are complementary. Deps-shed handles trees made before the cache existed, and
keys the cache does not cover.

## 5. Finished work released promptly

### 5.1 The stale floor becomes deployment config

**Today.** The stale arm of child reclaim waits seven idle days on both sides. On the server it is
`CHILD_STALE_IDLE_MS = 7 * 24 * 3_600_000` (`server/src/childReclaimSweep.ts`). On the box it is
`WS_STALE_IDLE_S=604800` (`ccd/lib/disk-retention.sh`), which can only be raised. The banner and feed text say
"seven days" as a literal.

**Recommendation (R-3a).**

- Server: `CCRC_CHILD_STALE_IDLE_HOURS`, default 168, which is today's value.
- Box: `CCD_WS_STALE_IDLE_S`, default 604800. It can be lowered, but the box clamps it to at least a box floor
  `CCD_WS_STALE_IDLE_FLOOR_S` (default 86400): a value below the floor is read as the floor and logged once. The box
  keeps the last word: it acts on `max(server's figure, CCD_WS_STALE_IDLE_S)`, with `CCD_WS_STALE_IDLE_S` already
  clamped. The floor is never a term of that `max` on its own. So a server-only change, such as
  `CCRC_CHILD_STALE_IDLE_HOURS=24` set by mistake, still leaves the box at its own 604800 and changes nothing it
  reclaims. Lowering the age takes a change on both sides: the server's hours and the box's `CCD_WS_STALE_IDLE_S`.
  A server misconfiguration therefore cannot make the box reclaim a tree it would refuse today. Tests: a server figure
  below the box's value acts at the box's value; a box value below the floor acts at the floor; both lowered acts at
  the larger of the two.
- The idle wording in banners and feed rows is formatted from the configured value.
- The same treatment applies to the other hard-coded ages this spec touches: `REVIEW_CHILD_CEILING_MS` (7 days) and
  the stale-archive lane's 14 days (`server/src/coord/staleArchive.ts`, §6).

The census shows that this alone does little now. It matters once §2 to §4 have removed the fresh pile and the tail
that remains is what ages out.

### 5.2 Runs parked in review, merge or close: a nudge, then an abandon offer

**Measured.** 10 trees (5.4 GB) belong to runs still open under a programme hold: 3 working, 6 awaiting review and 1
merging. A programme hold stands while the programme has any open run, so one parked run also keeps its siblings and
earlier waves. Stop-done already puts these workers to sleep 30 minutes after they park
(`STOP_DONE_PARKED_IDLE_MS`, `server/src/stopDone.ts`). Nothing ever closes the run.

**A binding rejection.** The capacity plan's Rejected list says "no automatic close of a stale run (that stays the
coordinator's act, prompted by the run-quiet banner of W1-3)". This spec keeps that rule. The close stays a person's
or a coordinator's act. What changes is that the act becomes easy to reach and hard to miss.

**Recommendation (R-3b).**

1. **Nudge.** A run that stays in `awaiting-review`, `merging` or `closing` longer than
   `CCRC_PARKED_RUN_NUDGE_HOURS` (default 48) gets one system mail to its coordinator, naming the run, its state, its
   age and what it keeps (trees, holds and siblings). It is repeated at most once per nudge period. The mail goes
   through the existing system-mail path (`queueSystemMail`) and the run-quiet banner's facts, not a second notifier.
2. **Abandon offer.** Past `CCRC_PARKED_RUN_ABANDON_OFFER_HOURS` (default 168), the run's card in the PWA shows an
   **Abandon** control. It is the existing abandon act (`POST /api/runs/:id/abandon`), reached from the UI, per the
   operator-actions-in-the-UI rule. Before it is pressed, it names what it will release. Abandoning closes the run and
   leaves any open PR alone. The normal close-time reclaim then removes the worker, with its attic rescue, as it does
   for any failed close today. That leaves an open PR with no worker and no run to carry a fix round, so the offer
   depends on the PR's state:
   - **Not offered** while the run's PR is in the merge queue, or has required checks pending. The card says why
     ("PR in the merge queue" or "required checks running") instead of showing the control. A run in `merging` with
     its PR enqueued is the normal case for this.
   - **Offered with a loud warning** while the run's PR is open but not enqueued and not pending: "PR #n stays open
     with no worker. A later fix needs a new run on its branch." The branch on the remote is untouched, so a new run
     can pick it up.
   - **Offered plainly** when the run has no PR, or its PR is closed or merged.
   - **The server re-checks at the press.** The card's state is only a rendering. `POST /api/runs/:id/abandon` reads
     the run's PR state from GitHub again when it is called, and applies the same rules: it **refuses** (409, with
     the word, for example `pr-enqueued` or `checks-pending`) while the PR is in the merge queue or has required
     checks pending, and it **refuses** (`pr-state-unreadable`) when the PR state cannot be read, fail closed, the
     same rule as the auto-abandon decider. An open PR that is neither needs the request to carry the warning's
     acknowledgement, which the card sends only after showing it. A stale card, a race with an enqueue, or a GitHub
     read failure therefore cannot release the worker or the programme hold of a run whose PR is about to merge.
     This applies to every caller of the act, the coordinator's `ccrc-api` included, not only the PWA; a run with no
     PR recorded needs no GitHub read and is not refused for one. The change to the coordinator's path is called out
     in the plan's PR, since it can now refuse an abandon it accepts today. Tests: one per
     refusal word, and one for an enqueue that lands between the card's read and the press.
   - **If a PR merges or fails after its run was abandoned** (for example, the queue ejects it), the server raises
     one attention item to the programme's coordinator, or to the operator when there is no live coordinator. The
     item names the PR and the abandoned run and offers "open a run on this branch". It goes through the existing
     attention path. Nothing reopens the abandoned run.
3. **Auto-abandon is off by default.** `CCRC_PARKED_RUN_AUTO_ABANDON_HOURS` (default unset) would let the server
   abandon a parked run with no PR, or only a closed one, and no activity on either side after that age. It exists
   only if the operator overturns the Rejected-list rule (§10, Q4). Even then it ships in shadow behind its own
   marker. **"No activity on either side"** means none of these, within the period:
   - a run state change;
   - a push to the run's branch on the remote;
   - a PR event (push, review, comment or check run);
   - mail to or from the run's worker about the run;
   - mail from its coordinator naming the run;
   - a turn by the worker's session;
   - a coordinator turn whose roster card (§7) listed the run.

   The decider reads each of these from its existing source. If any source cannot be read, it does not act.

## 6. Idle coordinators and manual sessions: auto-archive

**Measured.** 12 manual sessions are asleep (6.0 GB), 9 of them idle 8 to 11 days. All 10 coordinators are live,
and their cost is mostly `node_modules` (16.9 of 20.2 GB), which deps-shed and §4 address.

**Today.** The stale-archive lane (G1, `staleArchiveVerdict` in `server/src/coord/staleArchive.ts`) archives a
non-child workspace that was never a claimant and has had no pane for 14 days. Expiry then removes it 7 days later.
It is built, but `$REG/stale-archive-live` is **not armed** on the measured box. That is why the manual sessions stay.
Rule 4, "a coordinator's workspace is never reclaimed automatically", keeps coordinators out on purpose: it skips
anything that was ever a claimant.

**Recommendation (R-4).**

- **R-4a. Arm G1 for manual sessions, after its UI.** The lane's code is built. The operator reads its "would
  archive" shadow rows and arms `stale-archive-live`, but **only after R-4c's G1 half has shipped**: arming archives
  manual sessions, and expiry removes them 7 days later, so until the countdown, Keep and Archive now exist there is
  no in-UI warning and no way to keep a parked but resumable session from the app (the operator-actions-in-the-UI
  rule). Its 14 days becomes `CCRC_STALE_ARCHIVE_IDLE_DAYS` (default 14), as in §5.1.
- **R-4b. Coordinators: a second arm of the same lane, not a new lane.** A coordinator qualifies when all of these
  hold:
  - it claims no non-terminal run;
  - its last chair ended more than `CCRC_COORDINATOR_ARCHIVE_IDLE_DAYS` ago (default unset, which means off);
  - it has had no pane for the same period;
  - it has no pinned or held marker, and no unanswered operator-facing question (the fleet-rollup rule: a question
    is never hidden);
  - nothing is waiting on it: no parked, held or undelivered mail addressed to it, no child ask routed to it and not
    yet answered, and no coordinator-routed permission prompt pending for it. Once it is archived, and later expired,
    each of these would have no recipient. Each is read from its existing source (the mail queue's parked and held
    rows, the ask and permission routing records), and a source that cannot be read is a refusal
    (`pending-unmeasured`), as is any pending item (`pending-for-coordinator`). The same condition is re-read just
    before the archive act.

  **"Claims no non-terminal run" must be proven, not read.** Claim attribution is incomplete today (§7). #1407 (the
  unborn and dup-arm gaps at `bindSession`) is open, and D8 (the coordinator's uuid on the claim, and DT7's
  claimant-revived after an id-changing revive) is unbuilt. A coordinator whose claim sits under a reused name, or
  under the id it had before a revive, would read as "claims nothing". So the arm is built only after #1407 and D8's
  DT6 and DT7 have landed (§9). The decider also **refuses**, as a kept verdict with the reason
  `claim-attribution-unproven`, for any coordinator that has an id-changing revive in its history, or whose name was
  used by another session, unless every run that ever named that name or a prior id is terminal.

  It is archived through the same act as G1, so expiry follows by the same path and the same safety checks: clean
  tree, HEAD on a remote or rescued into the attic, no holder. It ships in shadow behind
  `coordinator-archive-live`. This changes rule 4 from "never automatically" to "never while it has work, and never
  without a recorded idle age". The operator rules on it (§10, Q5).
- **R-4c. Visible and overridable in the UI, in two halves.** The G1 half (manual sessions) ships before G1 is armed
  (§9 step 3); the coordinator half ships with R-4b. Every session row that either arm will archive shows "archives
  in N days" in the PWA, with **Keep** (it writes the existing hold marker through a whitelisted act) and **Archive now**.
  The settings screen shows both idle ages as read-only facts, taken from the server's config.

## 7. Coordinator durability: what remains of D4, D6 and D7

**How it ties in.** A run whose coordinator forgot it after a compaction never closes. An open run keeps its
programme's hold, and the hold keeps the worker, its siblings and its review copies. So durability is a disk issue as
well as a correctness one. In today's census it matters less than §2, but it is what stops §5 from draining the
tail. Measured state, 2026-10-28:

| Item | Built and merged | Not done | Gate to finish |
|---|---|---|---|
| **D4** roster card (#757) | #1357: on compact, resume and clear, the session hook reads `ccrc-api runs list` once (4 s, fail open) and re-injects the coordinator's open runs plus an "awaiting you" line, capped at 2048 characters | (1) **unarmed**: `coordinator-roster-card-live` is absent, so the card goes only to a shadow log; (2) **wake is not covered**: Claude Code's idle compaction resumes without any of the three events | operator reads the shadow log and arms it; then the wake arm (below); then #757 closes |
| **D6** parent by birth, release on archive (#758) | the parent half: #1405 (`coord/runBinding.ts`, incarnation-bound parent), #1406, #1430, #1530, #1573 | #1407 (record the bound incarnation at `bindSession`); release-on-archive runs only in **shadow**: `dead-coordinator-lane-live` is absent, so runs whose coordinator is archived or dead are never released | land #1407; operator compares the dead-coordinator lane's shadow record with D7's `claimant-gone` findings, and arms it only after D8's DT7 (R-5b); #758 closes |
| **D7** drift reconciler (#760) | DT1 decider (#884), DT2 lane and findings (#1355, #1362), DT3 digest server side (#1367), DT5 held asks re-seeded after restart (#890) | DT4, the PWA digest's "Out of step" section (no PWA code yet); the lane only **records**, because `drift-push-live` is absent | build DT4; operator arms `drift-push-live`; #760 closes |
| **D8** claim carries the coordinator's uuid (#761) | none | DT6 and DT7 (uuid on the claim, attributed reclaim after an id-changing revive) | after W6's #1407, per the tail spec |

**The wake arm for D4 (R-5a).** Idle compaction runs about an hour after a turn ends and starts no turn. The card's
three events do not fire, so the coordinator next wakes on mail with a compacted context and no roster. The fix stays
inside the card's existing owner: the server's mail-wake path already knows when it wakes a coordinator. When the
recipient is a coordinator with open runs and its transcript shows a compaction since its last card, the wake mail
carries the same card body, built by the same code as the hook, as its first block. No second roster builder is
added. The card text gets one shared builder, and the hook and the wake path both call it. It ships behind the same
`coordinator-roster-card-live` marker.

**Order (R-5b).** Arm D4 first: it is the cheapest and directly prevents forgotten runs. Then land #1407. Then build
DT4 and arm the drift push. Then build D8 (DT6, DT7). **Arm OA-D6 only after DT7.** OA-D6, the dead-coordinator lane,
ends or releases a programme's runs. Until DT7's claimant-revived lands, a coordinator revived under a new id (an
account swap or a respawn) cannot be told apart from a dead one. So reading the lane's shadow record against D7's
`claimant-gone` findings cannot rule out a false "dead" verdict, and arming earlier could release runs that are still
needed. The shadow record is still read before then, as evidence. There is **no early-arm path**. A hand check of
the shadow rows covers only the rows that exist when it is done: once the lane is armed, a coordinator revived later
under a new id still reads as dead, and its runs are released, which is exactly what DT7 prevents. A one-time audit
cannot stand in for it, so OA-D6 stays in shadow until DT7 has landed.

The programme ledger `docs/superpowers/programs/coordinator-durability.md` is stale: it still
lists D3 and D4 as "to spec" and DT1 as "in review". Bring it up to date in the plan's first PR.

## 8. How this fits with deps-shed and the existing lanes

**Deps-shed (#1772, #1781; worktree-leak note).** It removes git-ignored, untracked `node_modules` from a sleeping
worker or coordinator whose work finished more than `CCRC_DEPS_SHED_AFTER_HOURS` ago (default 24), in shadow behind
`deps-shed-live`. This spec depends on it and does not duplicate it:

- §2 relies on it to make the reclaim probe's ignored-directory scan cheap on sleeping trees.
- §3's R-1c adds review children that sleep between rounds to its decider, as one row in shadow behind the same
  marker.
- §4 makes its removal nearly free and its undo (a hydrate) fast. The shed arm needs one change: after a hydrate
  from the cache, the tree's `node_modules` is read-only hardlinks, and the shed's removal must not try to make
  cache files writable. `rm` on a read-only file inside a writable directory already works, so this is a test, not a
  code change.
- §6's coordinator arm uses deps-shed's coordinator test ("claims no open run and its last chair ended past the age")
  as its first condition, from the same pure decider (`server/src/depsShed.ts`), not a copy.

**Existing lanes, and who owns what.**

| Lane | Owner | This spec |
|---|---|---|
| Child reclaim at close and the sweep (`coord/childReclaim.ts`, `childReclaimSweep.ts`) | Workspace & PR Lifecycle | §2 fixes its outage; `review-report-live` is unchanged (R-1c) |
| Deps-shed (`server/src/depsShed.ts`) | same | R-1c adds a row for sleeping review children between rounds |
| Stale and superseded arms (`coord/childReclaimStale.ts`) | same | R-3a makes the floor config |
| Stop-done and hibernation (`stopDone.ts`, `coord/hibernate.ts`) | same (sleep, not disk) | unchanged |
| Stale archive and expiry (`coord/staleArchive.ts`, `archivedExpiry.ts`) | same | R-4a arms it; R-4b adds the coordinator arm to the same decider, after D8 |
| Orphan tree, `ws-collect`, tmp sweep | same | the tmp sweep gains the cache-eviction arm (§4) |
| Dispatch's resume arm (`coord/dispatch.ts`) | Coordination | R-1a uses it for reviewers |
| Run-quiet banner, system mail | Coordination; Attention & Notification | R-3b's nudge uses both |
| Session hook's roster card (`ccd/session-hook.sh`) | Coordination | R-5a moves its builder into one shared place, and the wake path calls it |

**Also found by the census, for the plan's backlog.** Four "reclaimed" runs leave an empty or near-empty directory,
which ccd lists as `orphan`; the orphan-tree lane should take these. One 2.2 GB worker's run is missing from the run
list. That is `run-absent`, which the armed stale arm takes after its floor. One reclaim was refused on the path
proof (#1132's area).

## 9. Build order

Each step is one PR. Every destructive arm ships in shadow first.

1. **R-0 diagnosis and visibility.** The `probe` journal field, the bounds as config, and the failing-lane alert.
   Then the fix the diagnosis points to. Nothing else waits on this except the measurements that follow it.
2. **Arm what is built and already visible.** Operator acts, each after reading its shadow record:
   `coordinator-roster-card-live` (D4), and `deps-shed-live` once #1772 lands. No code. `stale-archive-live` is
   **not** armed here (step 3).
3. **R-4c's G1 half, then arm G1.** The "archives in N days" countdown, Keep and Archive now for every session G1
   would archive, read from G1's own decider, and the stale-archive age shown in settings. Only then the operator
   arms `stale-archive-live` (R-4a), after reading its shadow rows.
4. **R-1a** one reviewer per work run (the capacity spec's W2), with the re-bind rules, the per-verdict keep tests and
   the fenced tree advance.
5. **R-2** the dependency cache: the `ws-deps` verb with its manifest, quarantine, fenced replace and `--check`, the
   `ws-add --child` hook, cache eviction and re-hash in the tmp sweep, the SAFETY-list entries, and **in the same
   PR** the CLAUDE.md and worker and reviewer skill changes that replace the blanket `npm ci`. The cache is off until
   `CCD_DEPS_CACHE_ROOT` is set.
6. **R-1c** the deps-shed row for review children between rounds, in shadow.
7. **R-3a** ages as config: the stale floor, the review ceiling and stale archive's 14 days.
8. **R-5a** the D4 wake arm and its shared card builder; **#1407**.
9. **R-3b** the parked-run nudge, the Abandon control in the PWA with its PR-state rules and the server's re-check at
   the press, and the ejected-PR attention item.
10. **DT4** the PWA "Out of step" section; arm `drift-push-live`.
11. D8 (DT6, DT7) per the tail spec.
12. **Arm OA-D6** (`dead-coordinator-lane-live`), an operator act after reading its shadow record. Never before step
    11.
13. **R-4b and R-4c's coordinator half** the coordinator archive arm in shadow, and its countdown with Keep and
    Archive now.

Steps 4 and 5 can be built in parallel. Step 3's arming waits on its own UI half. Step 6 needs steps 4 and #1772.
Step 7's lowered review ceiling needs step 4's per-verdict keep (a re-bound reviewer must not age out). Step 11 needs
step 8 (#1407). Step 12 needs step 11 (DT7). Step 13 needs steps 7, 8 and 11.

## 10. Operator decisions

Each comes with a recommended option.

- **Q1. Diagnose the reclaim outage now?** Approve one `ws-audit --reclaim` on one stuck id (a SAFETY-list verb).
  **Recommended: yes.** It is read-only, and it is the cheapest step to the largest saving.
- **Q2. Review trees between rounds (R-1).** (a) Keep the reviewer's tree across rounds (R-1a), shed its
  dependencies while it sleeps (R-1c), and reclaim it whole when the reviewed run closes, as today. (b) Release it at
  each verdict and spawn a fresh reviewer per round. That needs a new reclaim variant that keeps the clips, and it
  gives up W2's resume. **Recommended: (a).** It needs no new reclaim variant, deletes nothing earlier than today, and
  is the ruled W2.
- **Q3. The dependency cache (R-2).** (a) Reflink where the filesystem supports it, else hardlink, from a
  read-only cache with a stat-and-hash manifest, filled only from default-branch inputs, with the instructions
  change that replaces the blanket `npm ci`. (b) A symlinked shared directory. (c) No cache: rely on deps-shed alone.
  **Recommended: (a).** Defaults: cache off until a root is set, 20 GB maximum, 14 days idle.
- **Q4. Parked runs (R-3b).** (a) Nudge at 48 h, Abandon offered in the UI at 7 days, never automatic. (b) As (a),
  plus auto-abandon of a parked run with no open PR after N days, which overturns the capacity plan's
  Rejected-list rule. **Recommended: (a).** Revisit (b) once the nudge has been measured for two weeks.
- **Q5. Coordinators (R-4b).** (a) Auto-archive a coordinator with no open claim, no pane and an idle chair for N
  days, with the UI countdown and Keep, built after D8, refusing when claim attribution is unproven or when mail, an
  ask or a permission prompt is waiting on it. (b) Never:
  keep rule 4 and rely on deps-shed for their disk. **Recommended: (a) with N = 14 days.** In the
  census, deps-shed already addresses most of a coordinator's bytes, so (a) is about the count, not the size.
- **Q6. Stale floor for this deployment (R-3a).** The neutral default stays 7 days. **Recommended: set 2 days in this
  deployment's config once §2 to §4 have landed**, not before, because the census shows lowering it earlier would
  mainly catch manual sessions, which G1 covers. Lowering it is two settings, the server's hours and the box's
  `CCD_WS_STALE_IDLE_S`, and the box's floor (1 day by default) still bounds it.
- **Q7. Arm order for durability.** **Recommended:** D4's card now (after reading its shadow log), `drift-push-live`
  after DT4, OA-D6 after D8's DT7 and not before: a hand check of today's shadow rows says nothing about a
  coordinator revived under a new id after arming.

## Rejected

- **A symlinked shared `node_modules`.** One tree's install changes every tree.
- **Filling the shared cache from a session's working copy.** One session's modified lockfile, `package.json` or
  config would be served to every other tree.
- **Relying on file modes alone to protect hardlinked entries.** Every session runs as the cache's uid, so a chmod
  undoes them.
- **Releasing a review tree at its verdict.** Child reclaim deletes the clips, which hold the report the fix-round
  mail cites, and it removes the registry row, so nothing is left to resume. Doing it safely needs a new reclaim
  variant that keeps the clips, and it gives up W2. Keeping the tree and shedding its dependencies gets most of the
  bytes back without either cost.
- **ctime or link count in the cache manifest.** Every hardlink and unlink changes both, so every entry would be
  quarantined on its second hydrate. Mode is compared directly instead.
- **An early arm of OA-D6 after a hand audit of its shadow rows.** The audit cannot cover a coordinator revived
  under a new id after arming.
- **`reset --hard` or `clean` to move a resumed reviewer to the fix round's tip.** Either can discard a reviewer's
  uncommitted files. The advance refuses on a dirty tree and the round gets a fresh reviewer.
- **A "lite" review checkout with no dependencies.** Lenses that run the suite would fail in ways that look like
  findings.
- **Teaching the reclaim probe to skip `node_modules`.** The scan exists to find work hidden inside ignored
  directories.
- **A new disk collector beside the existing lanes.** Every change in this spec is a row or an arm in a lane that
  already owns the class.
- **Machine-specific defaults.** Every age, count, size and path is config with a neutral default. The figures in
  §1 are one box's measurements, not defaults.
