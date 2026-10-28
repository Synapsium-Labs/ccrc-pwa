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
   any work happens. A per-lockfile cache with hardlinks makes a new tree cost little more than its source files.
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
(`ccd/reviewer-skill/SKILL.md`, step 7). So `review-report-live` keeps the tree for two other reasons: the
coordinator's fix-round mail cites the report by path, and the next round needs a reviewer to resume (capacity spec
§3.2). The report path is outside the tree, so the first reason does not need the tree.

**Recommendation (R-1), in three parts.**

- **R-1a. One reviewer per work run, resumed per round.** Build the capacity spec's W2 as ruled on 2026-10-20: a fix
  round's review run opens bound to the previous reviewer's `sessionId` when that reviewer reviewed the same work run.
  Dispatch resumes it, waking it if it is asleep, with `/clear`, through the resume arm that workers already use.
  This turns `-rev`, `-rev2` and `-rev3` into one tree. It is the largest structural saving: in the census it would
  remove most of the 59.
- **R-1b. A review checkout without its own dependencies.** A reviewer reads a branch tip and runs lenses. It may run
  tests, so it needs dependencies, but it does not need its own copy. With §4's cache, a review tree gets its
  dependencies by hardlink in seconds and for almost no space. Without the cache (the cache is off, or the lockfile
  is missing from it), the review keeps today's behaviour. A separate "lite" checkout kind, with no dependencies at
  all, is **rejected**: lenses that run the suite would fail in ways that look like findings.
- **R-1c. Release at the verdict, not at the reviewed run's close.** When a review run closes `done`, the review
  child is released once both of these hold: (i) the report path named in its `review-done` mail stats readable
  through the agent, and (ii) no open review run of the same work run is bound to it. Its worktree goes through
  normal child reclaim. Its `.cc-clips` directory, which holds the report, is kept until the reviewed work run
  closes, under the existing clips rules. With R-1a, the session row stays resumable: the next round's dispatch
  re-adds a tree for the same session (one `ws-add`, light with §4's cache). This makes `review-report-live` a
  keep on the clips directory, not on the worktree. It ships in shadow behind its own marker
  (`review-release-at-verdict-live`), with "would release" rows first.

**What this changes in existing rules.** The capacity plan's Rejected list says "no report copy (W2-1 dropped)".
R-1c does not copy the report. It only stops the report's location from keeping a tree that does not contain it.

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
| (d) Hardlink copy from a read-only per-lockfile cache | near zero; a file written in place is detected | an in-place write to a hardlinked file changes the cache | **recommended**, with (c) preferred where available |

**Recommendation (R-2): `ccd ws-deps`, a box verb that hydrates dependencies from a cache.**

- **Key.** The sha256 of the lockfile, plus the runtime's major version, platform and architecture, plus the install
  command. Entries live under `CCD_DEPS_CACHE_ROOT` (default unset, which means the cache is off and behaviour is
  unchanged). Only lockfile kinds listed in `CCD_DEPS_CACHE_LOCKFILES` are cached (default `package-lock.json`).
- **Fill.** On a miss, the verb runs the install once in a scratch tree, under the session's `TMPDIR`. It then marks
  every file in the result read-only and renames it into place, so a half-built entry is never visible.
- **Hydrate.** Reflink when the filesystem supports it, else `cp -al` (a hardlink tree), into the worktree's
  `node_modules`. A tree whose lockfile is not in the cache gets today's behaviour: the session runs its own install.
- **Detect writes.** The cache files are read-only, so a tool that tries to write one in place fails, and the
  failure is loud. If a project's postinstall needs to write, that lockfile key is marked `copy-only` in the cache
  and later hydrations use a full copy. The cache is never repaired from a tree.
- **Who calls it.** `ws-add --child` calls it after the checkout when the cache is configured. A coordinator or
  manual session can run it itself. It does not belong on the SAFETY list, because it only writes inside the
  session's own tree and the cache root.
- **Eviction.** An entry with no remaining links outside the cache (link count 1 on a sample of files) and unused for
  `CCD_DEPS_CACHE_IDLE_DAYS` (default 14) is removed, oldest first, until the cache is under
  `CCD_DEPS_CACHE_MAX_GB` (default 20). This rides the existing `ccd-tmp-sweep` timer as one more arm, not as a new
  timer.
- **Accounting.** With hardlinks, a per-tree `du` counts shared bytes in every tree. The disk alarm (retention spec,
  ruling 4) already reads `statfs`, which is correct. Tree-size figures in the UI and in reclaim feed rows say
  "unique bytes" when they come from `du -l` and say nothing more precise than that.

**What it saves.** In the census, `node_modules` was 34.7 GB in about 120 trees, and most of those trees share a
handful of lockfiles. With the cache, that is about one copy per lockfile, a few GB in total. A new worker costs its
source files, which is about 0.1 GB for this repository.

**Interaction with deps-shed (§8).** Removing a hardlinked `node_modules` frees almost nothing, because the cache
holds the same inodes, and that is fine. Waking a shed tree is then a hydrate, which takes seconds, rather than an
`npm ci`. The shed arm and the cache are complementary. Deps-shed handles trees made before the cache existed and
lockfiles the cache does not cover.

## 5. Finished work released promptly

### 5.1 The stale floor becomes deployment config

**Today.** The stale arm of child reclaim waits seven idle days on both sides. On the server it is
`CHILD_STALE_IDLE_MS = 7 * 24 * 3_600_000` (`server/src/childReclaimSweep.ts`). On the box it is
`WS_STALE_IDLE_S=604800` (`ccd/lib/disk-retention.sh`), which can only be raised. The banner and feed text say
"seven days" as a literal.

**Recommendation (R-3a).**

- Server: `CCRC_CHILD_STALE_IDLE_HOURS`, default 168, which is today's value.
- Box: `CCD_WS_STALE_IDLE_S`, default 604800. It can be lowered, but never below a box floor
  `CCD_WS_STALE_IDLE_FLOOR_S` (default 86400). The box keeps the last word: it acts on
  `max(server's figure, box floor)`, so a server misconfiguration cannot make the box reclaim a tree it would
  refuse today.
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
   operator-actions-in-the-UI rule. It names what it will release before it is pressed. Abandoning leaves any open PR
   alone and closes the run; the normal close-time reclaim then runs, with its attic rescue, as it does for any
   failed close today.
3. **Auto-abandon is off by default.** `CCRC_PARKED_RUN_AUTO_ABANDON_HOURS` (default unset) would let the server
   abandon a parked run with no open PR and no activity on either side after that age. It exists only if the
   operator overturns the Rejected-list rule (§10, Q4). Even then it ships in shadow behind its own marker.

## 6. Idle coordinators and manual sessions: auto-archive

**Measured.** 12 manual sessions are asleep (6.0 GB), 9 of them idle 8 to 11 days. All 10 coordinators are live,
and their cost is mostly `node_modules` (16.9 of 20.2 GB), which deps-shed and §4 address.

**Today.** The stale-archive lane (G1, `staleArchiveVerdict` in `server/src/coord/staleArchive.ts`) archives a
non-child workspace that was never a claimant and has had no pane for 14 days. Expiry then removes it 7 days later.
It is built, but `$REG/stale-archive-live` is **not armed** on the measured box. That is why the manual sessions stay.
Rule 4, "a coordinator's workspace is never reclaimed automatically", keeps coordinators out on purpose: it skips
anything that was ever a claimant.

**Recommendation (R-4).**

- **R-4a. Arm G1 for manual sessions.** No code change. The operator reads the lane's "would archive" shadow rows
  and arms `stale-archive-live`. Its 14 days becomes `CCRC_STALE_ARCHIVE_IDLE_DAYS` (default 14), as in §5.1.
- **R-4b. Coordinators: a second arm of the same lane, not a new lane.** A coordinator qualifies when all of these
  hold:
  - it claims no non-terminal run;
  - its last chair ended more than `CCRC_COORDINATOR_ARCHIVE_IDLE_DAYS` ago (default unset, which means off);
  - it has had no pane for the same period;
  - it has no pinned or held marker, and no unanswered operator-facing question (the fleet-rollup rule: a question
    is never hidden).

  It is archived through the same act as G1, so expiry follows by the same path and the same safety checks: clean
  tree, HEAD on a remote or rescued into the attic, no holder. It ships in shadow behind
  `coordinator-archive-live`. This changes rule 4 from "never automatically" to "never while it has work, and never
  without a recorded idle age". The operator rules on it (§10, Q5).
- **R-4c. Visible and overridable in the UI.** Every session row that either arm will archive shows "archives in N
  days" in the PWA, with **Keep** (it writes the existing hold marker through a whitelisted act) and **Archive now**.
  The settings screen shows both idle ages as read-only facts, taken from the server's config.

## 7. Coordinator durability: what remains of D4, D6 and D7

**How it ties in.** A run whose coordinator forgot it after a compaction never closes. An open run keeps its
programme's hold, and the hold keeps the worker, its siblings and its review copies. So durability is a disk issue as
well as a correctness one. In today's census it matters less than §2, but it is what stops §5 from draining the
tail. Measured state, 2026-10-28:

| Item | Built and merged | Not done | Gate to finish |
|---|---|---|---|
| **D4** roster card (#757) | #1357: on compact, resume and clear, the session hook reads `ccrc-api runs list` once (4 s, fail open) and re-injects the coordinator's open runs plus an "awaiting you" line, capped at 2048 characters | (1) **unarmed**: `coordinator-roster-card-live` is absent, so the card goes only to a shadow log; (2) **wake is not covered**: Claude Code's idle compaction resumes without any of the three events | operator reads the shadow log and arms it; then the wake arm (below); then #757 closes |
| **D6** parent by birth, release on archive (#758) | the parent half: #1405 (`coord/runBinding.ts`, incarnation-bound parent), #1406, #1430, #1530, #1573 | #1407 (record the bound incarnation at `bindSession`); release-on-archive runs only in **shadow**: `dead-coordinator-lane-live` is absent, so runs whose coordinator is archived or dead are never released | land #1407; operator compares the dead-coordinator lane's shadow record with D7's `claimant-gone` findings and arms it; #758 closes |
| **D7** drift reconciler (#760) | DT1 decider (#884), DT2 lane and findings (#1355, #1362), DT3 digest server side (#1367), DT5 held asks re-seeded after restart (#890) | DT4, the PWA digest's "Out of step" section (no PWA code yet); the lane only **records**, because `drift-push-live` is absent | build DT4; operator arms `drift-push-live`; #760 closes |
| **D8** claim carries the coordinator's uuid (#761) | none | DT6 and DT7 (uuid on the claim, attributed reclaim after an id-changing revive) | after W6's #1407, per the tail spec |

**The wake arm for D4 (R-5a).** Idle compaction runs about an hour after a turn ends and starts no turn. The card's
three events do not fire, so the coordinator next wakes on mail with a compacted context and no roster. The fix stays
inside the card's existing owner: the server's mail-wake path already knows when it wakes a coordinator. When the
recipient is a coordinator with open runs and its transcript shows a compaction since its last card, the wake mail
carries the same card body, built by the same code as the hook, as its first block. No second roster builder is
added. The card text gets one shared builder, and the hook and the wake path both call it. It ships behind the same
`coordinator-roster-card-live` marker.

**Order (R-5b).** Arm D4 first: it is the cheapest and directly prevents forgotten runs. Then land #1407 and arm
OA-D6, which releases runs held by dead coordinators and so frees their workers. Then build DT4 and arm the drift
push. D8 comes last. The programme ledger `docs/superpowers/programs/coordinator-durability.md` is stale: it still
lists D3 and D4 as "to spec" and DT1 as "in review". Bring it up to date in the plan's first PR.

## 8. How this fits with deps-shed and the existing lanes

**Deps-shed (#1772, #1781; worktree-leak note).** It removes git-ignored, untracked `node_modules` from a sleeping
worker or coordinator whose work finished more than `CCRC_DEPS_SHED_AFTER_HOURS` ago (default 24), in shadow behind
`deps-shed-live`. This spec depends on it and does not duplicate it:

- §2 relies on it to make the reclaim probe's ignored-directory scan cheap on sleeping trees.
- §4 makes its removal nearly free and its undo (a hydrate) fast. The shed arm needs one change: after a hydrate
  from the cache, the tree's `node_modules` is read-only hardlinks, and the shed's removal must not try to make
  cache files writable. `rm` on a read-only file inside a writable directory already works, so this is a test, not a
  code change.
- §6's coordinator arm uses deps-shed's coordinator test ("claims no open run and its last chair ended past the age")
  as its first condition, from the same pure decider (`server/src/depsShed.ts`), not a copy.

**Existing lanes, and who owns what.**

| Lane | Owner | This spec |
|---|---|---|
| Child reclaim at close and the sweep (`coord/childReclaim.ts`, `childReclaimSweep.ts`) | Workspace & PR Lifecycle | §2 fixes its outage; R-1c adds a release-at-verdict case to the sweep's decider (a row in its table, not a new lane) |
| Stale and superseded arms (`coord/childReclaimStale.ts`) | same | R-3a makes the floor config |
| Stop-done and hibernation (`stopDone.ts`, `coord/hibernate.ts`) | same (sleep, not disk) | unchanged |
| Stale archive and expiry (`coord/staleArchive.ts`, `archivedExpiry.ts`) | same | R-4a arms it; R-4b adds the coordinator arm to the same decider |
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
2. **Arm what is built.** These are operator acts, each after reading its shadow record:
   `coordinator-roster-card-live` (D4), `stale-archive-live` (G1), and `deps-shed-live` once #1772 lands. No code.
3. **R-1a** one reviewer per work run (the capacity spec's W2).
4. **R-2** the dependency cache, the `ws-deps` verb and the `ws-add --child` hook, with cache eviction in the tmp
   sweep. The cache is off until `CCD_DEPS_CACHE_ROOT` is set.
5. **R-1c** release a review tree at its verdict, in shadow.
6. **R-3a** ages as config: the stale floor, the review ceiling and stale archive's 14 days.
7. **R-5a** the D4 wake arm and its shared card builder; **#1407**; arm OA-D6.
8. **R-3b** the parked-run nudge and the Abandon control in the PWA.
9. **DT4** the PWA "Out of step" section; arm `drift-push-live`.
10. **R-4b and R-4c** the coordinator archive arm in shadow, and the UI countdown with Keep and Archive now.
11. D8 (DT6, DT7) per the tail spec.

Steps 3 and 4 can be built in parallel. Step 5 needs step 3. Step 10 needs step 6.

## 10. Operator decisions

Each comes with a recommended option.

- **Q1. Diagnose the reclaim outage now?** Approve one `ws-audit --reclaim` on one stuck id (a SAFETY-list verb).
  **Recommended: yes.** It is read-only, and it is the cheapest step to the largest saving.
- **Q2. Release a review tree at its verdict (R-1c)?** (a) Yes, keep only the clips directory until the reviewed run
  closes. (b) No, keep today's rule. **Recommended: (a).** The report is already outside the tree.
- **Q3. The dependency cache (R-2).** (a) Hardlink, with reflink where the filesystem supports it, and a read-only
  cache. (b) A symlinked shared directory. (c) No cache: rely on deps-shed alone. **Recommended: (a).** Defaults:
  cache off until a root is set, 20 GB maximum, 14 days idle.
- **Q4. Parked runs (R-3b).** (a) Nudge at 48 h, Abandon offered in the UI at 7 days, never automatic. (b) As (a),
  plus auto-abandon of a parked run with no open PR after N days, which overturns the capacity plan's
  Rejected-list rule. **Recommended: (a).** Revisit (b) once the nudge has been measured for two weeks.
- **Q5. Coordinators (R-4b).** (a) Auto-archive a coordinator with no open claim, no pane and an idle chair for N
  days, with the UI countdown and Keep. (b) Never: keep rule 4 and rely on deps-shed for their disk. **Recommended:
  (a) with N = 14 days.** In the census, deps-shed already addresses most of a coordinator's bytes, so (a) is about
  the count, not the size.
- **Q6. Stale floor for this deployment (R-3a).** The neutral default stays 7 days. **Recommended: set 2 days in this
  deployment's config once §2 to §4 have landed**, not before, because the census shows lowering it earlier would
  mainly catch manual sessions, which G1 covers.
- **Q7. Arm order for durability.** **Recommended:** D4's card now (after reading its shadow log), OA-D6 after #1407,
  `drift-push-live` after DT4.

## Rejected

- **A symlinked shared `node_modules`.** One tree's install changes every tree.
- **A "lite" review checkout with no dependencies.** Lenses that run the suite would fail in ways that look like
  findings.
- **Teaching the reclaim probe to skip `node_modules`.** The scan exists to find work hidden inside ignored
  directories.
- **A new disk collector beside the existing lanes.** Every change in this spec is a row or an arm in a lane that
  already owns the class.
- **Machine-specific defaults.** Every age, count, size and path is config with a neutral default. The figures in
  §1 are one box's measurements, not defaults.
