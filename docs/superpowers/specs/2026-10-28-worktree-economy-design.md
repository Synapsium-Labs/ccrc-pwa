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
closes, and it keeps its worker. D4, D6 and D7 are mostly built but switched off. What remains is small: give their
switches a control in Settings (§8, R-6) and set them live there after their shadow records are read, cover "wake" in
D4, build D7's PWA section, and land W6's #1407.

The operator's own **Abandon** always has a way through (§5.2, R-3b.4): the server's PR check refuses the automatic
and agent paths when it cannot prove the release is safe, but the operator's sheet offers a bounded wait or an
immediate abandon behind a second confirmation that names what is unproven. The archive door's programme end, the
other operator act on the same abandon arm, reads every claimed run's PR before it ends any, and offers the same
unproven confirm for the whole programme.

The stale age stays raise-only, as the retention spec ruled (§5.1, R-3a): the Settings row can raise it and never
lower it below the box's floor. Whether to overturn that is the operator's call (§10, Q11; recommended no). The box
does not report that floor today (`ccd caps` prints only verb and capability tokens), so reporting it is its own build
step (§9 step 5, in both fleet modes). Until it lands, the row is read-only and shows the box floor as unknown, never
a guess.

Every age, count, size and path below has a neutral default. Every new destructive arm ships in shadow. **Every
operator act is one control in Settings › Automation backed by one stored value on the server (R-6, R-7).** When a box
process needs that value, the server hands it to the box through the path it already uses to change box state (a
`CCD_ARGV` call: the server's own ccd runner in local mode, the agent's ccd grant in remote mode). No box env var, and
no `$REG` marker, is a second way to set it. What stays in install config is only what the operator is never asked to
decide: paths, walk and timeout bounds, and the safety floors that cap a row (§8, "One control, one source").

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
   box install-config knobs (`CCD_REAP_SCAN_S`, `CCD_PATH_USERS_SCAN_S`, `CCD_RECLAIM_WALK_S`), with today's values as
   the defaults. They are bounded both ways: a floor so a misconfiguration cannot turn a bound off, and a ceiling under
   the verb's runner row in `CCD_VERB_TIMEOUT_MS`, which a budget test on #1772's branch checks for `ws-shed-deps`
   (`deps-shed-budget.test.ts`; neither the row nor the test is on `main` yet). These are
   walk bounds, not operator decisions: no §10 question asks for one, they exist only on the box, and a change to one
   is a deploy change. If the diagnosis shows a bound is wrong for every box, the fix is a new default in code.
4. **Skip what is rebuildable.** Once deps-shed (§8) has run on a tree, its `node_modules` is gone and the scan is
   cheap. Run order should follow from that: a sleeping tree is shed first and reclaimed later. The reclaim probe
   itself does not learn to skip `node_modules`. The scan exists to find work hidden inside ignored directories, and
   a nested checkout inside `node_modules` is exactly what it must catch.
5. **Alert on a failing lane.** When a lane fails on every attempt for longer than the **Failing-lane alert** age
   (default 4 hours, a row on the Ages card, R-7; server only), the server raises a banner and an operator
   notification. It goes through the existing attention
   path, not a new notifier. Eight hours of silent failure is the real defect here.

**Why first.** It touches no policy. It frees 11.4 GB and 56 trees as soon as the cause is fixed, and every later
section assumes reclaim works.

## 3. Review and fix rounds: one reviewer per work run, kept across rounds, with its dependencies shed between them

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
  for almost no space. Without the cache (its row is Off, or the key is missing from it), the review keeps today's
  behaviour. A separate "lite" checkout kind, with no dependencies at all, is **rejected**: lenses that run the suite
  would fail in ways that look like findings.
- **R-1c. Between rounds, shed rather than reclaim.** A reviewer that has posted its verdict and sleeps is kept, as
  today, until the reviewed work run closes (`review-report-live`, unchanged). While it waits, deps-shed (§8) may
  remove its `node_modules` after the same age as any other sleeping child; this needs one row in the shed decider
  for review children, in shadow under deps-shed's own switch (its Settings row, R-6), with a test that a shed review
  child keeps its tree, clips and registry row. On resume, R-1b's hydrate (or the session's own install, without the
  cache) restores the dependencies. When the reviewed work run closes, normal child reclaim removes the reviewer whole,
  clips included, exactly as it does today. Nothing is deleted earlier than today, and no reclaim variant is needed.

**What this changes in existing rules.** None. The capacity plan's Rejected list says "no report copy (W2-1
dropped)", and this spec copies no report. `review-report-live` keeps its meaning.

## 4. Shared dependencies: a per-package cache

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
  `CCD_DEPS_CACHE_ROOT`, an install-config path (default unset). The path says only where a cache may live; it does
  not turn the cache on.
- **On, off and its limits: one Settings row (R-7).** Whether the cache is used, and its size cap and idle age, are
  the operator's, on the **Dependency cache** row in Settings › Automation: Off or On, a size cap (default 20 GB) and
  an idle age (default 14 days), stored once in coord.db and seeded Off. The server hands the three values to the box
  with `ccd box-setting` (§8, "One control, one source"), and `ws-deps` and the tmp-sweep arm read only that copy. A
  copy that is missing or unreadable reads as Off, which is today's behaviour. On is refused with `cache-root-unset`
  when the box reports `CCD_DEPS_CACHE_ROOT` as unset, and the row says so. The box does not report it today: that
  report is §9 step 5's `limit deps-cache-root` line. While the box reports nothing (before step 5, or an older agent
  or ccd), the row shows the cache root as unknown, and On is refused with `cache-root-unmeasured`, never assumed.
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
  - A package that writes into its own installed files at run time (not at install, which only the fill runs) would
    trip the manifest on every tree. So a key whose entry is quarantined twice within one
    `CCD_DEPS_CACHE_VERIFY_HOURS` period is marked `copy-only`, and later hydrations of it make a full copy, or a
    reflink where the filesystem has one. The mark is journaled with the key, so the plan can name the package.
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
- **Who calls it.** `ws-add --child` calls it after the checkout when the cache is on. A coordinator or
  manual session can run it itself, and wake after a shed calls it again.
- **The SAFETY list.** The cache root is shared state, so the verb's forms are split by what they write. A hydrate
  writes only the session's own tree, and its only reads of shared state are checked against the manifest. A fill
  writes the shared cache, but only from default-branch inputs, under a lock, into staging and then a rename, so a
  session cannot choose what it writes. Neither form is on the SAFETY list. The forms that remove or replace shared
  entries by hand (`ws-deps --purge`, `--quarantine`, `--evict`) **are** added to the CLAUDE.md SAFETY list. The
  sweep's own eviction and quarantine run on the box timer, not from a session.
- **Eviction.** An entry with no hydrations recorded from a live tree, and unused for the row's idle age (default 14
  days), is removed, oldest first, until the cache is under the row's size cap (default 20 GB). A sampled
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

### 5.1 The stale floor becomes one Settings row

**Today.** The stale arm of child reclaim waits seven idle days on both sides, as two separate constants. On the
server it is `CHILD_STALE_IDLE_MS = 7 * 24 * 3_600_000` (`server/src/childReclaimSweep.ts`). On the box it is
`WS_STALE_IDLE_S=604800` (`ccd/lib/disk-retention.sh`), checked again inside `ws-audit --reclaim` and `ws-reclaim`
when the server's call carries `--stale` (`staleFlags`, `server/src/ccdargv.ts`). The banner and feed text say
"seven days" as a literal.

**A ruled property this section keeps.** The retention spec (2026-10-23, §2.5.1) rules that "a sweep's age floor is a
safety property, so the server can never lower one", and its G2 rule (§2.7.3) makes the box's half of "idle",
`WS_STALE_IDLE_S`, raise-only. ccd carries the same rule beside the constant (`ccd/lib/disk-retention.sh`, "raise-only,
nothing lowers it"). The box measures idle on its own evidence (transcript, end, spawn, wake and pane activity), so
its floor is the last guard against a server that measured idle wrongly. R-3a therefore lets the operator **raise**
the stale age from Settings and never lower it below the box's floor. Lowering that floor would overturn the ruling,
so it is the operator's call, not this spec's: §10, Q11.

**Recommendation (R-3a).** One value, set in one place, used on both sides, and raise-only.

- **The one source.** A **Stale reclaim after** row on the Ages card in Settings › Automation (R-7), in hours,
  default 168 (today's value), stored once in coord.db and written only by the Ages card's route. There is no
  `CCRC_CHILD_STALE_IDLE_HOURS` and no `CCD_WS_STALE_IDLE_S`: neither side has a second knob for it.
- **Raise-only.** The row's lower bound is the box's floor, `WS_STALE_IDLE_S` (604800 s, 168 hours, today). **The
  box does not report it today.** `cmd_caps` (`ccd/ccd`) prints only verb and capability tokens, and the shared parser
  (`parseCcdCaps`, `shared/agent-protocol.ts`) keeps only identifier-shaped lines, so no value reaches the server in
  either fleet mode: not through the local reader (`readLocalCcdCaps`, `server/src/localcaps.ts`, the default
  `CCRC_FLEET=local`), and not through the agent's ready frame or `caps` reply (remote mode). Reporting it is a build
  step of its own (§9 step 5: `ccd caps` prints `limit stale-idle-s <n>`, read by the one parser on both paths, with
  tests for both modes). Once the box reports it, the Ages route refuses a value below it with `out-of-bounds`, and
  the row shows "not below 168 hours (the box's floor)". The server's own idle check (`CHILD_STALE_IDLE_MS`, the
  server half of G2) reads the row, so the server half can be raised with the box half and never falls below 168
  hours either.
- **Until the box reports its floor, the row is read-only.** In either fleet mode, while the server's caps record
  carries no `stale-idle-s` limit (before §9 step 5 lands, a failed probe, or an older agent or ccd), or carries one
  the parser rejects, the row shows its stored value (seeded 168 hours) and "box floor: unknown (this box does not
  report it)", and the Ages route refuses every edit with `floor-unmeasured`. The server never guesses the floor, not
  even as today's 168 hours. It keeps sending the stored value as `--stale-idle-s`, and the box's own check below
  stays the guard.
- **How the box gets it.** The stale arm already calls the box with `--stale <word>` on `ws-audit --reclaim` and
  `ws-reclaim`. `staleFlags` adds `--stale-idle-s <n>`, the row's value in seconds, to those same two calls, so the
  box checks the figure the server decided on, in the same call, and nothing has to be kept in step. This is the
  existing path: a `CCD_ARGV` builder, run by the server's own ccd runner in local mode and through the agent's
  existing `ccd` grant for those verbs in remote mode, whose new shape `whitelist-subset.test.ts` enumerates; the
  builder and the box's check are the same in both modes. A call without the flag (an older server) acts at the box's
  floor, today's value.
- **The box still refuses anything lower than its own floor.** `WS_STALE_IDLE_S` stays ccd's constant, raise-only, and
  becomes the floor that the flag can only raise. A figure below it is refused with `stale-idle-below-floor`, touching
  nothing, rather than acting early or silently acting at the floor. No install-config knob and no flag lowers it.
  So the row never shows a value the box would not use, and a server bug that sends a low figure reclaims nothing.
  Tests: a flag at the floor or above acts at the flag; a flag below the floor refuses and reclaims nothing; no flag
  acts at the floor; the route refuses a value below the reported floor; the route refuses every edit with
  `floor-unmeasured`, and the row reads unknown, when the caps reply carries no floor. The test that pins the
  reported floor to `WS_STALE_IDLE_S` is §9 step 5's.
- The idle wording in banners, feed rows and ccd's `not-idle` refusal is formatted from the value actually used.
- The same treatment applies to the other hard-coded ages this spec touches, each a row on the Ages card and each
  read only by the server, so nothing is handed to the box: `REVIEW_CHILD_CEILING_MS` (7 days) and the stale-archive
  lane's 14 days (`server/src/coord/staleArchive.ts`, §6).

The census shows that this alone does little now. It matters once §2 to §4 have removed the fresh pile and the tail
that remains is what ages out.

### 5.2 Runs parked in review, merge or close: a nudge, and the existing Abandon made safe to press

**Measured.** 10 trees (5.4 GB) belong to runs still open under a programme hold: 3 working, 6 awaiting review and 1
merging. A programme hold stands while the programme has any open run, so one parked run also keeps its siblings and
earlier waves. Stop-done already puts these workers to sleep 30 minutes after they park
(`STOP_DONE_PARKED_IDLE_MS`, `server/src/stopDone.ts`). Nothing ever closes the run.

**What already exists.** Every open run row on the Runs screen has an **Abandon** button (`pwa/src/screens/RunRow.tsx`,
drawn on open rows only). It opens `AbandonSheet` (`pwa/src/fleet/AbandonSheet.tsx`), whose confirm sends
`POST /api/runs/:id/abandon`. The sheet already says what the release does (`abandonConsequence`: a release of a
workspace that is not a child destroys nothing, and a child is reclaimed once nothing keeps it). The route never reads
its request body, by design, so a caller cannot add an archive flag. The act is therefore already reachable from the UI,
at any age. Two things are missing: nothing tells the operator that a run is parked and what it keeps, and nothing stops
an abandon of a run whose PR is about to merge. Today the sheet would release that worker and the programme hold.

**A binding rejection.** The capacity plan's Rejected list says "no automatic close of a stale run (that stays the
coordinator's act, prompted by the run-quiet banner of W1-3)". This spec keeps that rule. The close stays a person's
or a coordinator's act, through the control that exists. No new control is added outside the existing sheet.

**Recommendation (R-3b).**

1. **Nudge.** A run that stays in `awaiting-review`, `merging` or `closing` longer than the **Parked-run nudge** age
   (default 48 hours, a row on the Ages card, R-7; server only) gets one system mail to its coordinator, naming the
   run, its state, its age and what it keeps (trees, holds and siblings). It is repeated at most once per nudge
   period. The mail goes through the existing system-mail path (`queueSystemMail`) and the run-quiet banner's facts,
   not a second notifier.
2. **The row says it is parked.** Past the **Parked-run line** age (default 168 hours, a row on the Ages card, R-7;
   server only), the run's existing row
   gains one context line, from the server's view of the run: "Parked in awaiting review for 8 days · keeps 2 trees and
   holds its programme". The Abandon button next to it is the same button, unchanged. Before that age the row is
   exactly as today. That is all the hours decide: when the row says the run is parked, not whether Abandon exists.
3. **The sheet names the PR.** `abandonConsequence` gains one sentence, from the run's PR state as the server last
   read it. This applies at every age, because the risk exists today:
   - no PR, or a closed or merged one: nothing is added;
   - an open PR that is not in the merge queue and has no required checks pending: "PR #n stays open with no worker. A
     later fix needs a new run on its branch." The branch on the remote is untouched, so a new run can pick it up;
   - a PR in the merge queue, with required checks pending, or whose state the server could not read: the sheet
     shows the "unproven" block of item 4 in place of its single confirm. Abandon is never disabled.
4. **The server re-checks at the press, and the operator always has a way through (R-3b.4).** The sheet is only a
   rendering. The abandon arm of `closeRun` reads the run's PR state again, through the box reads the server already
   makes (it has no GitHub client of its own for PRs): `ccd pr-state --project` for the merge-queue word (`queueFor`,
   `server/src/prstate.ts`) and `ccd pr-landing` for the required checks. It answers with one of three
   words when it cannot prove the release is safe: `pr-enqueued`, `checks-pending`, or `pr-state-unreadable` when it
   cannot read the state. A run with no PR recorded needs no read, and never gets a word. What a word does depends on
   who pressed:
   - **Automatic and agent paths fail closed, with no way through.** The coordinator's abandon close (the box-token
     `runs` route), the parked-run auto-abandon of item 6 if it is ever built, and every other automatic or agent lane
     that reaches the abandon arm get 409 and the word, and nothing is released. They have no override parameter. The plan's PR says
     so, because the coordinator can now be refused an abandon it is allowed today, and the refusal text tells it the
     operator can abandon the run from its row. The dead-coordinator lane's abandon is not changed here. Its arm
     waits on DT7 (§7).
   - **The operator's Abandon always goes through, by one of two routes it chooses.** (The archive door's
     programme end is the other operator act on this arm; it has its own way through, below.) `POST /api/runs/:id/abandon`
     keeps its rule of reading no body. On a word it answers 409 with the word, the facts it read (PR number, the queue
     word or the pending required checks by name, or the read's error), and a single-use **confirm key** the
     server mints, bound to the run id, the word and a digest of those facts, and valid for 10 minutes. Two new
     operator doors take only that key (a strict body of `{ "key" }` and nothing else), sit beside the abandon door
     with its auth (ungated by the box token, session-gated when sign-in is armed, listed in
     `coord-pause-route.test.ts`'s `UNGATED` set), and are forbidden to the coordinator, worker and reviewer skills:
     - `POST /api/runs/:id/abandon/when-settled` **waits, bounded.** The server records a pending abandon and re-reads
       the PR state once a minute. It abandons as soon as the word clears (the PR leaves the queue, the checks finish,
       or the read succeeds and shows neither), and in any case when the **Abandon settle wait** has passed (default
       30 minutes, a row on the Ages card, R-7; server only; bounded 5 to 240 minutes). The run row shows "Abandon
       pending · waits for PR #n until 14:32" with **Cancel**, which removes the pending record. A restart keeps the
       record in coord.db and resumes the wait.
     - `POST /api/runs/:id/abandon/unproven` **abandons now.** The server re-reads once more. If the word has cleared,
       it abandons as the ordinary door would. If a word still stands, it abandons anyway and journals the override
       with the word and the facts. If the facts changed since the key was minted (for example, the PR entered the
       queue), it refuses with `facts-changed` and a fresh key, so the second confirmation always names what is true
       at the press.
   - **What the sheet shows.** On a word, the sheet replaces its confirm with an **unproven** block:
     - a title per word: "PR #n is in the merge queue", "PR #n has required checks still running:
       <names>", or "ccrc could not read PR #n from GitHub: <reason>";
     - one line of what is unproven: "Not proven: that releasing this worker leaves nothing PR #n still needs. If
       the PR merges or fails after the abandon, its coordinator (or you) gets an attention item to open a run on its
       branch." The PR and its branch are never touched;
     - the release consequence that `abandonConsequence` already gives (worker released, programme hold lifted);
     - two buttons. **Abandon when it settles (at most N min)**, N being the settle wait, is the primary and sends
       `when-settled`. **Abandon now** opens a second step that repeats the title and the "Not proven" line and has
       **Back** and **Abandon now, unproven** (destructive style). Only that second tap sends `unproven`.
     The sheet has no disabled state for these words. `ABANDON_COPY` gains one sentence per word and one for
     `facts-changed`.
   - **The archive door's programme end is the same operator act, and gets the same check and the same way
     through.** `POST /api/sessions/:id/archive` with `{programme:'end'}` (`ArchiveSheet`) ends every run its
     coordinator claims through the same abandon arm, `withAbandon` (`server/src/coord/routes.ts`), with
     `causedBy:'operator'`, inside `coordMutex`. `decideArchive` (`server/src/coord/archiveDoor.ts`) first asks
     `abandonRefusal` of every claimed run and ends nothing unless every one passes, so a programme is never left
     partly ended by run id order. The PR check keeps that rule:
     - **Every PR read before the first end.** `withAbandon` hands the door a third function beside `abandon` and
       `abandonRefusal`: the arm's PR check alone (`abandonPrCheck(runId)`, the same reader the arm uses, returning the
       word and its facts, or none). The door's existing pre-loop calls it for every claimed run after
       `abandonRefusal` passes, still inside `coordMutex`, and still ends nothing. `abandonRefusal` itself stays a
       synchronous, row-only read.
     - **A word refuses the whole archive, with one key for all of it.** When any claimed run has a word, the door
       answers 409 `programme-pr-unproven`, ends nothing, stops nothing and archives nothing. The answer lists every
       run with a word (run id, the word and its facts, as item 4's abandon answer gives them), the runs with none,
       and one single-use confirm key, bound to the session id, the archive flags of the refused request (`force`,
       `interrupt`, `programme`), and a digest of every listed run's id, word and facts, valid for 10 minutes.
     - **The operator's way through.** One new operator door, `POST /api/sessions/:id/archive/unproven`, takes only
       that key (strict body `{ "key" }`), sits beside the archive door with its auth (no box token, session-gated
       when sign-in is armed, named in `box-token-census.test.ts` beside it), and is forbidden to the coordinator,
       worker and reviewer skills. It runs the archive door again with the key's bound flags: every check of
       `decideArchive` and `admitArchive` re-runs, and every PR is read again. A run with a word the key did not bind,
       a bound run whose facts changed, or a different set of claimed runs, refuses with `facts-changed` and a fresh
       key, so the second confirmation always names what is true at the press. A bound word that has cleared is not a
       change that refuses: that run ends as an ordinary abandon. Otherwise it ends each claimed run through the arm
       with the override for exactly the bound words, journals one override line per run with its word and facts,
       then stops and archives as the door does today.
     - **What `ArchiveSheet` shows.** On `programme-pr-unproven` the sheet replaces its confirm with item 4's unproven
       block, with one title line per run that has a word, the same "Not proven" line naming each PR, and what the
       archive does (programme ended, session stopped and archived). Its buttons are **Back** and **Archive now,
       unproven**, behind the same second step that repeats the titles. It has no disabled state. Item 5's attention
       item covers each PR that later merges or fails.
     - **No bounded wait here.** The archive door also reads the session's turn and stops it. A deferred archive
       would stop and archive on reads made up to the settle wait earlier, so the programme end offers only the
       unproven confirm; the operator who wants to wait taps Back and archives again later.
     - **A word that appears during the ends.** Between the pre-loop and an end, the arm reads the PR again. A word
       that the key did not bind (or any word, without a key) refuses that end, and the door answers
       `programme-partly-ended` as it does today for any arm refusal after the pre-loop, naming the runs it ended and
       the ones it did not, with the word. It never stops or archives after a partial end. The sheet then shows the
       remaining runs, and a retry gets a fresh key.
   Tests: one per word on each path (the coordinator's close refused; the operator's `when-settled` acting on clear
   and at the bound; `unproven` acting with the word journaled); a key reused, expired, or minted for another run
   refused; an enqueue that lands between the sheet's read and the press answering `facts-changed`; Cancel removing a
   pending abandon; a restart resuming one. For the programme end: a word on any one claimed run refuses the archive
   with nothing ended, stopped or archived; `archive/unproven` with a valid key ends every run, journals each override
   and archives; a key minted for other flags, another session or another set of words refused; a word that appears
   between the key and the press answering `facts-changed`; a word that appears between the pre-loop and an end
   answering `programme-partly-ended` with nothing stopped or archived; the archive door with no claimed runs, or
   with claimed runs and no PRs, unchanged.
5. **If a PR merges or fails after its run was abandoned** (for example, the queue ejects it), the server raises one
   attention item to the programme's coordinator, or to the operator when there is no live coordinator. The item names
   the PR and the abandoned run and offers "open a run on this branch". It goes through the existing attention path.
   Nothing reopens the abandoned run.
6. **Auto-abandon is off, and stays unbuilt unless Q4 is (b).** It would let the server abandon a parked run that has
   no PR, or only a closed one, and no activity on either side after an age. It exists only if the operator overturns
   the Rejected-list rule (§10, Q4). Even then it ships in shadow, and its switch and its age (default 168 hours) are
   one row on the Shadow lanes card (R-6), with no env var and no marker. It goes through the same abandon arm and its
   PR check as an automatic path, so a word refuses it and it has no override (item 4). **"No activity on
   either side"** means none of these, within the period:
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
  archive" shadow rows and sets its Settings row (R-6) to Live, but **only after R-4c's G1 half has shipped**: arming
  archives manual sessions, and expiry removes them 7 days later, so until the countdown, Keep and Archive now exist
  there is no in-UI warning and no way to keep a parked but resumable session from the app (the
  operator-actions-in-the-UI rule). Its 14 days becomes the **Stale archive after** row on the Ages card (default 14
  days, R-7; server only), as in §5.1.
- **R-4b. Coordinators: a second arm of the same lane, not a new lane.** A coordinator qualifies when all of these
  hold:
  - it claims no non-terminal run;
  - its last chair ended more than the arm's idle age ago (default 14 days, set on the arm's own Shadow lanes row,
    R-6, which is also its only switch; there is no env var for either);
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
  tree, HEAD on a remote or rescued into the attic, no holder. It ships in shadow, and its Settings row (R-6) is its
  only switch: it is a new arm, so it has no marker. This changes rule 4 from "never automatically" to "never while it
  has work, and never without a recorded idle age". The operator rules on it (§10, Q5).
- **R-4c. Visible and overridable in the UI, in two halves.** The G1 half (manual sessions) ships before G1 is armed
  (§9 step 3); the coordinator half ships with R-4b. Every session row that either arm will archive shows "archives
  in N days" in the PWA, with **Keep** (it writes the existing hold marker through a whitelisted act) and **Archive now**.
  The countdown is computed from the same stored ages the deciders read: the Ages card's Stale archive row for G1 and
  the coordinator arm's row for R-4b, each editable there and nowhere else.

## 7. Coordinator durability: what remains of D4, D6 and D7

**How it ties in.** A run whose coordinator forgot it after a compaction never closes. An open run keeps its
programme's hold, and the hold keeps the worker, its siblings and its review copies. So durability is a disk issue as
well as a correctness one. In today's census it matters less than §2, but it is what stops §5 from draining the
tail. Measured state, 2026-10-28:

| Item | Built and merged | Not done | Gate to finish |
|---|---|---|---|
| **D4** roster card (#757) | #1357: on compact, resume and clear, the session hook reads `ccrc-api runs list` once (4 s, fail open) and re-injects the coordinator's open runs plus an "awaiting you" line, capped at 2048 characters | (1) **unarmed**: `coordinator-roster-card-live` is absent, so the card goes only to a shadow log; (2) **wake is not covered**: Claude Code's idle compaction resumes without any of the three events | its Settings row (R-6); operator reads the shadow log and sets it live there; then the wake arm (below); then #757 closes |
| **D6** parent by birth, release on archive (#758) | the parent half: #1405 (`coord/runBinding.ts`, incarnation-bound parent), #1406, #1430, #1530, #1573 | #1407 (record the bound incarnation at `bindSession`); release-on-archive runs only in **shadow**: `dead-coordinator-lane-live` is absent, so runs whose coordinator is archived or dead are never released | land #1407; operator compares the dead-coordinator lane's shadow record with D7's `claimant-gone` findings, and sets its Settings row (R-6) live only after D8's DT7 (R-5b); #758 closes |
| **D7** drift reconciler (#760) | DT1 decider (#884), DT2 lane and findings (#1355, #1362), DT3 digest server side (#1367), DT5 held asks re-seeded after restart (#890) | DT4, the PWA digest's "Out of step" section (no PWA code yet); the lane only **records**, because `drift-push-live` is absent | build DT4; operator sets the drift push's Settings row (R-6) live; #760 closes |
| **D8** claim carries the coordinator's uuid (#761) | none | DT6 and DT7 (uuid on the claim, attributed reclaim after an id-changing revive) | after W6's #1407, per the tail spec |

**The wake arm for D4 (R-5a).** Idle compaction runs about an hour after a turn ends and starts no turn. The card's
three events do not fire, so the coordinator next wakes on mail with a compacted context and no roster. The fix stays
inside the card's existing owner: the server's mail-wake path already knows when it wakes a coordinator. When the
recipient is a coordinator with open runs and its transcript shows a compaction since its last card, the wake mail
carries the same card body, built by the same code as the hook, as its first block. No second roster builder is
added. The card text gets one shared builder, and the hook and the wake path both call it. It ships behind the same
switch as the card (its Settings row, R-6).

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
worker or coordinator whose work finished more than an age ago (default 24 hours), in shadow behind `deps-shed-live`.
On #1772 both are terminal knobs: the age is `CCRC_DEPS_SHED_AFTER_HOURS` and the switch a hand-only marker. R-6
and R-7 move both onto deps-shed's one Shadow lanes row (switch and age), and the plan's PR removes the env read.
This spec depends on it and does not duplicate it:

- §2 relies on it to make the reclaim probe's ignored-directory scan cheap on sleeping trees.
- §3's R-1c adds review children that sleep between rounds to its decider, as one row in shadow under the same
  switch.
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
| Stale and superseded arms (`coord/childReclaimStale.ts`) | same | R-3a makes the stale age one raise-only Ages row; the box's floor stays ccd's constant |
| Stop-done and hibernation (`stopDone.ts`, `coord/hibernate.ts`) | same (sleep, not disk) | unchanged |
| Stale archive and expiry (`coord/staleArchive.ts`, `archivedExpiry.ts`) | same | R-4a arms it; R-4b adds the coordinator arm to the same decider, after D8 |
| Orphan tree, `ws-collect`, tmp sweep | same | the tmp sweep gains the cache-eviction arm (§4) |
| Dispatch's resume arm (`coord/dispatch.ts`) | Coordination | R-1a uses it for reviewers |
| Run-quiet banner, system mail | Coordination; Attention & Notification | R-3b's nudge uses both |
| Session hook's roster card (`ccd/session-hook.sh`) | Coordination | R-5a moves its builder into one shared place, and the wake path calls it |

**Arming: a Settings row for every switch this spec arms (R-6).** Today each of these lanes goes live only when the
operator touches `$REG/<name>` at a terminal on the fleet box. Its row in `shared/switches.ts` says `writer:
'hand-only'`. The operator-actions rule says that anything the operator must action needs a ccrc UI control. The
Settings switch rows that exist are in Settings › Automation (`pwa/src/screens/settings/AutomationSection.tsx`):
Stall watch (a level), Temp root collector (Off or Live) and Cleanup pause. None of the durability or disk switches
below has one, so this spec adds them. It reuses the collector's control and does not invent a new pattern:

- **One card, one row per switch.** A new Automation card, **Shadow lanes**, mounted after Temp root collector. Each row
  shows Now (Shadow or Live), the row's own value where it has one (an age), the counts from the lane's shadow record
  over the evidence window (§10), and **Go live** or **Back to shadow**.
- **One store and one route.** A coord.db settings row per switch, choice `shadow` or `live`, seeded `shadow`, written
  only by `POST /api/coord/lane-arm` (read by `GET` on the same path). Each switch's row in `SWITCHES` names that route
  as its writer. As with the collector: the server decides the confirm (409 `confirm-required` with the facts it
  measured, and Set sends the server's key); Live is refused while sign-in is dark (`sign-in-unarmed`); the checked
  choice is the stored one the server read, never the tap; and the coordinator, worker and reviewer skills are
  forbidden to name the route.
- **A gate per row.** The server refuses Live with `gate-unmet` until the row's precondition is in the build (table
  below), and the row says what it waits for.
- **The row is the only switch; the marker is retired.** A lane is live when, and only when, its Settings row is
  Live. For the switches that have a marker today, the PR that adds the row imports it once: on the first start after
  upgrade, a standing marker sets the row Live, with a journal line and a feed row naming the file, and from then on
  the marker is not read. `ccrc doctor` reports a marker that still stands as left over, with the line that removes
  it. Nothing in the tree writes one. The Now column therefore shows only Shadow or Live, and both buttons always
  work. The existing `-disabled` kill switches are outside this spec and keep winning over the row.
- **Readers.** The server's lanes read the row through one helper beside `readSwitches`. The session hook (D4) reads
  it from one field in the `ccrc-api runs list` reply it already makes. That reply carries no such field today (the
  hook tests the `$REG/coordinator-roster-card-live` marker), so the roster card's row adds the field to the reply,
  with a test. When the hook cannot read that field (an older server, or a failed read), it injects no card, as
  today. No box process reads a marker for these switches.

| Switch | Marker imported once at upgrade, then retired | Gate before Live |
|---|---|---|
| Roster card (D4, and its wake arm, R-5a) | `coordinator-roster-card-live` | none |
| Deps-shed (with R-1c's review row), with its age | `deps-shed-live` | #1772 merged |
| Stale archive (G1, R-4a) | `stale-archive-live` | R-4c's G1 half |
| Drift push (D7) | `drift-push-live` | DT4 |
| Dead-coordinator lane (OA-D6) | `dead-coordinator-lane-live` | D8's DT7 |
| Coordinator archive (R-4b), with its idle age | none (new arm) | R-4b, R-4c's coordinator half and D8 |
| Parked-run auto-abandon (R-3b.6), with its age | none (new arm) | Q4 ruled (b) |

The already-armed switches in §1 keep their markers. Moving them onto the card is a later choice, outside this spec.

**One control, one source (R-7).** Every operator act in this spec is one control in Settings › Automation, backed by
one stored value on the server. The rule has three parts.

- **Where the value lives.** One coord.db settings row per value, seeded with the neutral default below, written only
  by its card's route and read only through the helper beside `readSwitches`. No env var shadows it and no marker is a
  second way to set it. The rows that are not switches go on one new card, **Ages**, mounted after Shadow lanes, which
  follows the same pattern: one route (`POST /api/coord/ages`, read by `GET`), the server decides the confirm
  (409 `confirm-required` for a lowered age, with the trees or runs it would now reach), the stored value is what the
  row shows, a value outside the row's bounds is refused with `out-of-bounds`, and the skills are forbidden to name the
  route.
- **How the box gets a value it needs.** Through the path the server already uses to change box state: a `CCD_ARGV`
  builder (`server/src/ccdargv.ts`), run by the server's own ccd runner in local mode and through the agent's `ccd`
  grant in remote mode, as the Cleanup pause card does today
  (`POST /api/coord/reclaim-pause` → `CCD_ARGV.reclaimPause` → `ccd reclaim-pause --state`). There are two shapes:
  - **On the call itself**, when only verbs the server calls read the value: the server adds it as a flag to the call
    it already makes. The stale floor uses this (`--stale-idle-s`, §5.1).
  - **A box copy**, when a box timer or a session-run verb reads it (the dependency cache: `ws-deps` and the tmp-sweep
    arm). This is a new, small verb, `ccd box-setting --set <name> <value>`, in `reclaim-pause`'s shape: a fixed name
    vocabulary in ccd (`deps-cache`, `deps-cache-max-gb`, `deps-cache-idle-days`), each value checked against bounds
    in ccd, written atomically to one file per name under `$REG/box-settings/`, and echoed back. The server sends it
    after every write of the row and again whenever it starts talking to the box (each agent connect in remote mode;
    server start in local mode, where there is no agent), so the box converges on the server's value. `ccd box-setting
    --get` returns the box's copy, and the row shows "On the box: <value>" or "not yet on the box". It is a
    disk-config verb, not a coordination mutation. It is added to the agent's grant for remote mode
    (`whitelist-subset.test.ts`) and to the CLAUDE.md SAFETY list, so only the server writes the box copy. A missing
    or unreadable copy reads as the default that is today's behaviour (cache Off).
- **What stays in install config.** Only what the operator is never asked to decide and that limits rather than sets
  a row: paths, walk and timeout bounds, sample rates and safety floors. Each exists on one side only. Where one caps
  or gates a row, the box reports it in `ccd caps` and the row shows it read-only and will not go past it. **The box
  reports no such value today**: `ccd caps` prints verb and capability tokens only. §9 step 5 adds the report. Until
  it lands, and with any box that does not report a given value, the row it caps is read-only and shows that value
  as unknown; nothing on the server assumes it.

Every value and switch in this spec, under that rule:

| Value | The one control | Default | Read by | Handed to the box by |
|---|---|---|---|---|
| Stale reclaim after (R-3a), raise-only | Ages › Stale reclaim after | 168 h, also its floor | server's stale arm; box's stale check | `--stale-idle-s` on `ws-audit --reclaim` and `ws-reclaim` |
| Review ceiling (R-3a) | Ages › Review ceiling | 168 h | server | not needed |
| Stale archive after (R-4a) | Ages › Stale archive after | 14 days | server (G1) | not needed |
| Parked-run nudge (R-3b.1) | Ages › Parked-run nudge | 48 h | server | not needed |
| Parked-run line (R-3b.2) | Ages › Parked-run line | 168 h | server | not needed |
| Abandon settle wait (R-3b.4) | Ages › Abandon settle wait | 30 min | server | not needed |
| Failing-lane alert (R-0.5) | Ages › Failing-lane alert | 4 h | server | not needed |
| Dependency cache: on, size cap, idle age (R-2) | Automation › Dependency cache | Off, 20 GB, 14 days | box (`ws-deps`, tmp sweep) | `ccd box-setting`, after each write and each agent connect (remote) or server start (local) |
| Each switch and its age in the Shadow lanes table above | its Shadow lanes row | Shadow; ages as listed | server; D4's hook through the `runs list` reply | not needed |

| Install config, one side only, never an operator act | Side | Why it is not a setting |
|---|---|---|
| `CCD_REAP_SCAN_S`, `CCD_PATH_USERS_SCAN_S`, `CCD_RECLAIM_WALK_S` (R-0.3) | box | walk bounds; a wrong one is fixed by a new default in code |
| `WS_STALE_IDLE_S`, ccd's constant, not install config (R-3a) | box | the ruled raise-only floor under the Stale reclaim row; reported by `ccd caps` once §9 step 5 lands and shown on the row, read-only (unknown, and the row read-only, until then); lowering it is §10, Q11 |
| `CCD_DEPS_CACHE_ROOT`, `_LOCKFILES`, `_ENV_KEYS`, `_KEY_PATHS`, `_OWNER` (R-2) | box | where the cache may live and how a key is built; the root's absence refuses the row's On. Whether the root is set (never its path) is reported by `ccd caps` once §9 step 5 lands; unknown until then, and On is refused |
| `CCD_DEPS_CACHE_HASH_SAMPLE`, `_HYDRATE_S`, `_VERIFY_HOURS` (R-2) | box | integrity and walk bounds |

**Also found by the census, for the plan's backlog.** Four "reclaimed" runs leave an empty or near-empty directory,
which ccd lists as `orphan`; the orphan-tree lane should take these. One 2.2 GB worker's run is missing from the run
list. That is `run-absent`, which the armed stale arm takes after its floor. One reclaim was refused on the path
proof (#1132's area).

## 9. Build order

Each step is one PR. Every destructive arm ships in shadow first.

1. **R-0 diagnosis and visibility.** The `probe` journal field, the bounds as install config, and the failing-lane
   alert (its 4 hours a constant until step 2 gives it its Ages row).
   Then the fix the diagnosis points to. Nothing else waits on this except the measurements that follow it.
2. **R-6 and R-7, the Shadow lanes and Ages cards, then arm what is built.** Both cards, their store and routes, the
   gates, the one-time marker import with its `ccrc doctor` check, and the Failing-lane alert row. Each later step
   adds its own rows. Then the operator sets two rows live, each after reading its shadow record: the roster card (D4),
   and deps-shed once #1772 lands. Stale archive is **not** set live here (step 3).
3. **R-4c's G1 half, then arm G1.** The "archives in N days" countdown, Keep and Archive now for every session G1
   would archive, read from G1's own decider, and the stale-archive age shown in settings. Only then the operator
   sets the Stale archive row live (R-4a), after reading its shadow rows.
4. **R-1a** one reviewer per work run (the capacity spec's W2), with the re-bind rules, the per-verdict keep tests and
   the fenced tree advance.
5. **`ccd caps` reports the box's limits, in both fleet modes.** Today `cmd_caps` (`ccd/ccd`) prints one verb or
   capability token per line and no value, and `parseCcdCaps` (`shared/agent-protocol.ts`) keeps only lines shaped
   like `/^[a-z][a-z0-9-]*$/` and returns `string[]`. It has two callers, and the server reaches the box's caps by two
   paths, one per fleet mode:
   - **Local mode** (`CCRC_FLEET=local`, the default deployment in `deploy/ccrc.env.example`). There is no agent. The
     server runs its own box's `ccd caps` once at boot with `readLocalCcdCaps` (`server/src/localcaps.ts`), which
     returns `parseCcdCaps`'s `string[]`, or `null` when the probe failed, and `index.ts` records it with
     `recordCcdVerbs`. Nothing re-reads it before the next server restart.
   - **Remote mode.** The agent runs `ccd caps` (`readCcdVerbs`, `agent/src/server.ts`, cached by `refreshVerbs`)
     and sends the tokens in its ready frame (`ccdVerbs`) and its `caps` reply (`verbs`).

   This step makes the box report each value that caps or gates a Settings row, through the one parser, so both paths
   carry it:
   - **ccd.** `cmd_caps` prints one `limit <name> <value>` line per value, from a fixed vocabulary in ccd:
     `limit stale-idle-s <n>` from `WS_STALE_IDLE_S`, and `limit deps-cache-root set|unset` (whether
     `CCD_DEPS_CACHE_ROOT` is configured; never the path). The line holds a space, so today's `parseCcdCaps`, every
     older agent and every older server drop it, and their token lists are unchanged.
   - **The parser: one result shape, changed once.** `parseCcdCaps` itself grows its result from `string[]` to
     `CcdCaps = { verbs: string[]; limits: CcdLimits }`, where `CcdLimits` holds one field per vocabulary name
     (`staleIdleS: number | null`, `depsCacheRoot: 'set' | 'unset' | null`). `verbs` is exactly today's list. It reads
     `limit` lines in the same function, so the `single-definition.test.ts` scan still finds one definition and both
     readers still import it. An unknown name is ignored; a malformed value, or a name given twice, reads as `null`
     (unknown) for that name, never as a default. There is no second parser for either mode.
   - **Both readers return that shape.** `readLocalCcdCaps` returns `CcdCaps | null` and the agent's `readCcdVerbs`
     returns `CcdCaps | null`; `null` (no evidence) still means every verb check behaves as today and every limit is
     unknown. The caps cache key, today the `ccd` entry and body in `refreshVerbs`, also covers every file a limit is
     read from (`ccd/lib/disk-retention.sh`, and any install-config file ccd sources). That file list is one constant
     beside `parseCcdCaps`, used by the agent's cache and the local reader alike, or a changed floor would never be
     re-read.
   - **The server, one field for both modes.** `FleetState` gains `ccdLimits: CcdLimits | null` beside `ccdVerbs`,
     written by the same `recordCcdVerbs` call and the same measured rule (a `null` answer writes nothing). In local
     mode `index.ts` records the boot read's `limits`, and the local reader re-runs, inside its existing bound, when
     the Ages or Dependency cache card is read and the key above has changed since the last read, so a changed floor
     is seen without a restart. In remote mode the agent adds `limits` as one optional field to its ready frame and to
     its `caps` reply (additive; an older agent omits it, which the server reads as `null`). The Ages and Dependency
     cache rows read only `fleetState.ccdLimits`, never the mode, so the hand-off is one code path. A name with no
     value is unknown.
   - **Order.** In remote mode the agent lane ships before the server lane (agent first), so the server never reads a
     field no deployed agent sends; until then it reads unknown. In local mode ccd and the server are on one box: a
     server whose ccd predates this step reads `null` for every name until ccd is updated, and the key change then
     triggers the re-read.
   - **Tests.** A test that reads the bash pins the reported `stale-idle-s` to `WS_STALE_IDLE_S`; `deps-cache-root`
     reads `set` and `unset` from the install config. The parser: verbs unchanged by `limit` lines; the unknown,
     malformed and repeated cases; an old-shape output gives `null` for every name and an unchanged token list.
     **Local mode:** `readLocalCcdCaps` against a ccd stub that prints `limit` lines returns them; against an
     old-shape stub returns unknown limits and the same verbs; a failed or timed-out probe still returns `null`; the
     boot wiring sets `fleetState.ccdLimits`; a changed limit file re-reads on the next card read and an unchanged
     one does not; the Ages route, with the server in local mode, accepts a value at or above the stub's floor,
     refuses one below with `out-of-bounds`, and refuses every edit with `floor-unmeasured` when the stub reports no
     floor. **Remote mode:** the ready frame and the `caps` reply carry the field; an older agent's frame reads
     unknown; a change to the lib file re-reads caps in the agent; the same three Ages route cases with the limits
     arriving from the agent. The Dependency cache row's `cache-root-unset` and `cache-root-unmeasured` cases run in
     both modes too.

   **Until this step lands**, in either mode, the Stale reclaim row is read-only and shows the box floor as unknown,
   with edits refused `floor-unmeasured` (§5.1), and the Dependency cache row shows the cache root as unknown, with On
   refused `cache-root-unmeasured` (§4). Neither value is guessed.
6. **R-2** the dependency cache: the `ws-deps` verb with its manifest, quarantine, fenced replace and `--check`, the
   `ws-add --child` hook, cache eviction and re-hash in the tmp sweep, the SAFETY-list entries, the Dependency cache
   row with `ccd box-setting` and its re-send on agent connect (remote) or server start (local), and **in the same
   PR** the CLAUDE.md and worker and reviewer skill changes that replace the blanket `npm ci`. The cache is off until
   its row is set On, which needs `CCD_DEPS_CACHE_ROOT` in the box's install config.
7. **R-1c** the deps-shed row for review children between rounds, in shadow.
8. **R-3a** ages as Ages rows: the stale age, raise-only (with `--stale-idle-s`, the box's floor `WS_STALE_IDLE_S` in
   `ccd caps` from step 5, kept as ccd's constant, and `stale-idle-below-floor`), the review ceiling and stale archive's
   14 days.
9. **R-5a** the D4 wake arm and its shared card builder; **#1407**.
10. **R-3b** the parked-run nudge, the parked line on the existing run row, the PR sentence and the unproven block in
   `AbandonSheet`, the PR-state re-check in the abandon arm, the confirm key with the `when-settled` and `unproven`
   doors and the pending-abandon record, their three Ages rows, and the ejected-PR attention item; and, in the same
   PR, the archive door's programme end: `abandonPrCheck` in its pre-loop, `programme-pr-unproven` with its key, the
   `archive/unproven` door and `ArchiveSheet`'s unproven block.
11. **DT4** the PWA "Out of step" section; the operator then sets the drift push's row live.
12. D8 (DT6, DT7) per the tail spec.
13. **Arm OA-D6**: the operator sets the dead-coordinator lane's row live after reading its shadow record. Its gate
    refuses it before step 12.
14. **R-4b and R-4c's coordinator half** the coordinator archive arm in shadow, its countdown with Keep and Archive
    now, and its Settings row.

Steps 4, 5 and 6 can be built in parallel. Every arming step needs step 2's card. Step 3's arming waits on its own UI
half. Step 6's Dependency cache row can be set On only once step 5 reports the cache root, and step 8's stale row is
editable only once step 5 reports the floor. Step 7 needs steps 4 and #1772.
Step 8's lowered review ceiling needs step 4's per-verdict keep (a re-bound reviewer must not age out). Step 12 needs
step 9 (#1407). Step 13 needs step 12 (DT7). Step 14 needs steps 8, 9 and 12.

## 10. Operator decisions

Each is a real choice, with a recommendation and why. The last column names where the operator acts on it, under
R-7's rule: a design ruling is made once, in this spec, and leaves nothing to act on later; everything the operator
sets or changes afterwards is one control in Settings › Automation backed by one stored value on the server, with no
env var or marker beside it. Every switch is set live from its Shadow lanes row (R-6), and only after its shadow
record shows the evidence named below.

| # | Decision | Recommended | Why | Where the operator acts |
|---|---|---|---|---|
| Q1 | Approve one `ws-audit --reclaim` on one stuck id (a SAFETY-list verb) to diagnose §2 | **Yes, now** | Read-only, and the cheapest step to the largest saving | the session's permission prompt in ccrc, the existing approval control; the request names the SAFETY rule. Nothing to build |
| Q2 | Review trees between rounds: (a) keep one per work run and shed its dependencies (R-1), or (b) release at each verdict | **(a)** | It is the ruled W2, deletes nothing earlier than today, and needs no new reclaim variant | a design ruling; its shed row is armed with deps-shed's Shadow lanes row |
| Q3 | Dependencies: (a) the read-only cache with manifest and the `npm ci` instructions change (R-2), (b) a symlinked shared directory, or (c) deps-shed alone | **(a)**, seeded Off; 20 GB, 14 days idle | Removes the per-tree copy without letting one tree change another's | a design ruling; then the Dependency cache row (On, size cap, idle age), handed to the box by `ccd box-setting`. The cache root is install config and only makes On possible |
| Q4 | Parked runs: (a) nudge at 48 h, mark the existing run row "parked" at 7 days, add the PR check to the existing Abandon with the operator's bounded wait or unproven confirm, and to the archive door's programme end with its unproven confirm (R-3b.4); never automatic. Or (b) also auto-abandon | **(a)**; revisit (b) after two weeks of nudges | No new control outside the existing sheet. Keeps the Rejected-list rule that a close is a person's or a coordinator's act, and never locks the operator out of it | the Ages rows Parked-run nudge, Parked-run line and Abandon settle wait; the run row's Abandon. Under (b), one Shadow lanes row holds auto-abandon's switch and age |
| Q5 | Coordinators: (a) auto-archive after N idle days with countdown and Keep, built after D8, or (b) never | **(a), N = 14** | Deps-shed already takes their bytes; this takes the count, and only once claims are proven | a design ruling; then the coordinator archive's Shadow lanes row (switch and N), and Keep or Archive now on each session row |
| Q6 | Stale reclaim age in this deployment (R-3a) | **Keep 168 h**, the floor | The row can only raise it (Q11), and raising it keeps trees longer, which the census does not call for | the Ages row Stale reclaim after, editable once the box reports its floor (§9 step 5, local and remote mode alike) and read-only until then; the box takes it on each stale call (`--stale-idle-s`) and refuses a figure below its own floor |
| Q7 | Set the Roster card row live (D4) | **Yes, as soon as** its existing log shows the evidence below | It only adds context, fails open, and directly prevents forgotten runs | its Shadow lanes row; the hook reads it from the `runs list` reply |
| Q8 | Set the Drift push row live (D7) | **After DT4 lands**, on the evidence below | A push must land on a PWA section the operator can act from | its Shadow lanes row |
| Q9 | Set the Dead-coordinator lane row live (OA-D6) | **Only after D8's DT7**, then on the evidence below | Until DT7 a coordinator revived under a new id reads as dead, and no hand check of today's rows covers a later revive | its Shadow lanes row; its gate refuses Live before DT7 |
| Q10 | Arming and ages: (a) the Shadow lanes and Ages cards as the one source, with today's markers imported once and retired (R-6, R-7), or (b) hand-touched markers and env vars, as today | **(a)** | The operator acts from the app, and a value has one place to be read and changed. It is the collector's and the Cleanup pause's existing pattern, not a new one | the two cards |
| Q11 | Allow the operator to LOWER the stale-idle floor from Settings (overturns the 2026-10-23 raise-only ruling)? | **No, not now**; revisit once §2 to §4 have landed and the census is taken again | The census shows lowering does little: 17 trees are past 7 days and 12 of them are manual sessions, which G1 takes (§1, §6). A stale reclaim destroys the tree, branch, clips and registry row, and the box's own idle measurement, behind a floor the server cannot lower, is what catches a server that measured idle wrongly. The saving is in §2 to §4, not in waiting less. If the operator rules yes, the floor becomes install config with a hard minimum in ccd (24 hours), the row may go down to it behind a confirm that names the trees it would now reach, and the retention spec's §2.5.1 and §2.7.3 are amended in the same PR | a design ruling, made once here. Under no, nothing changes on the box. Under yes, the same Ages row, whose lower bound becomes the box's reported minimum (reported through §9 step 5's `limit` line in either fleet mode; unknown, and the row read-only, until the box reports it) |

Stale archive (R-4a) and deps-shed are not separate choices. The operator sets Stale archive's row live once R-4c's
G1 half ships and its "would archive" rows name only manual sessions they would let go, and sets deps-shed's row live
once #1772 lands and its shadow rows name only finished, sleeping sessions.

**What each shadow record must show before its switch is armed.**

- **D4, the roster card.** Unarmed, the session hook appends each card it would have injected to the coordinator's
  `~/.ccrc/roster-card-shadow.log` (timestamp, session id, event, card). Arm when, over at least a week and at least
  ten compact, resume or clear events across more than one coordinator: every logged card lists exactly that
  coordinator's non-terminal runs at that time (checked against `ccrc-api runs list` or the run history: no other
  coordinator's run, no terminal run, none missing beyond the "+N more" line); its "awaiting you" line matches the
  runs in `awaiting-review` and with parked mail; and no expected event is missing from the log while the server was
  up (a gap means the 4 s read is failing open too often to rely on).
- **D7, the drift push.** Unarmed, the lane records its findings and one record-only `drift-shadow` notice per key,
  naming what it would have pushed. Arm when, over at least a week: every shadowed finding the operator samples
  (at least twenty, or all of them if fewer) is a real out-of-step state when checked against the run and its
  worker, with no false finding; the would-push count per day stays within the push budget (`driftPush.ts`) without
  hitting it; and DT4's "Out of step" section shows each of those findings.
- **D6, the dead-coordinator lane.** Unarmed, a due claimant is recorded as "would end programme <slug> (<n> runs)",
  with a feed row and an attention entry, and the breaker and anchors run in shadow too. Arm, after DT7 has landed,
  when over at least two weeks: every would-end row names a coordinator that D7's `claimant-gone` findings and the
  lifecycle journal agree crashed and had no successor; no row names a coordinator that later came back under the
  same id or, through DT7's claimant-revived, under a new one; and the breaker never tripped. One false row is a
  reason not to arm.

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
- **A second Abandon control for parked runs.** Every open run row already has one. R-3b marks the row and makes the
  existing act check the PR.
- **Arming by hand-touched markers, alone or as a terminal override.** The operator acts from the app, and a second
  way to arm is a second source of truth. Today's markers are imported once and retired (R-6).
- **A box env var beside a server setting** (for example a box-side stale age next to the server's). Two knobs for
  one value drift apart, and a row that the box can silently overrule does nothing on its own. The server's row is
  the one source and the box is handed its value (R-7).
- **Disabling the operator's Abandon while a PR's state is unproven.** It closes the operator's last-resort release.
  The automatic and agent paths fail closed; the operator gets a bounded wait or an explicit unproven confirm
  (R-3b.4).
- **Leaving the archive door's programme end outside the PR check.** It runs the same abandon arm, so it would
  release a worker whose PR is in the queue without saying so. Checking only inside the arm, run by run, would leave
  a programme partly ended by run id order. The door reads every PR first and offers one unproven confirm (R-3b.4).
- **A bounded wait on the programme end.** It would stop and archive the session on turn and claim reads made up to
  the settle wait earlier.
- **Lowering the stale floor from Settings without a ruling.** The retention spec ruled the floor raise-only; this
  spec keeps it and asks (Q11).
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
