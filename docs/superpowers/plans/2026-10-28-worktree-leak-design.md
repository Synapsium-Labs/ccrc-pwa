# The worktree leak: why stopped sessions' worktrees are never reclaimed, and the smallest fix

**Design note** · 2026-10-28 · Status: **ruled 2026-10-28** (§5): A1 approved and extended to coordinators (D-7278),
the gates recorded (D-7279), the stale arm's arming recorded as a fact (D-7280). Part B is built in this PR, in shadow.
It builds on the fleet disk retention spec and plan (`docs/superpowers/specs/2026-10-23-fleet-disk-retention-design.md`,
`docs/superpowers/plans/2026-10-23-fleet-disk-retention.md`, the #1119 rulings, merged as #1167) and the artifact
lifecycle policy (`docs/superpowers/specs/2026-08-11-artifact-lifecycle-policy.md`). Code citations are to `origin/main`
`b9ff9d446`, by anchor (file and function), never by line.

## In short

- A fleet box measured on 2026-10-28: each new worker worktree of this repository costs about 1.1 GB, most of it
  `node_modules` (npm copies files, link count 1). Stopped workers held 41 GB in 60 worktrees, stopped coordinators
  20.7 GB in 16, and `node_modules` alone was 34 GB of the 76. Net growth was 15 to 20 GB a day.
- **Why nothing takes them (§2).** A stopped worker is a `--child` workspace that the stop-done lane put to sleep. The
  only exits for a registered child are child reclaim, at its run's close or in the sweep, and the reclaim's stale arm.
  Every other collector stays out by design: the orphan lane, stale archive, expiry, `ws-collect` and the tmp sweep.
  Child reclaim keeps a finished worker for its programme by design: the non-final close re-holds it for wave N+1, and
  it is kept while its run is parked, a sibling run is open, or the run it reviewed is open. The stale arm is the one
  mechanism that lets those keeps lapse, and it is **armed on the fleet box** (`$REG/child-stale-reclaim-live` stands
  there since 2026-10-25, on the operator's ruling of that day; D-7280). It does not reach the measured leak: most
  stopped workers are younger than its 7-day floor, and a run that never closes (`minting-run-open`) or has an open
  sibling (`siblings-open`) is outside its cases. A coordinator's workspace is never reclaimed automatically (rule 4).
  So nothing removes these trees, and nothing removes the rebuildable bytes inside them.
- **The fix (§3, §4), ruled 2026-10-28 (D-7278).** A *deps-shed* arm of the stop-done lane's run-done row. For a
  sleeping session whose work is finished past a configurable age, it removes the git-ignored, untracked
  `node_modules` directories in its worktree and keeps everything git knows about. It covers **workers and
  coordinators**: a worker whose newest placed run is `done` or `failed` and closed past the age and which never
  coordinated in its own generation; a coordinator that claims no open run and whose last chair ended past the age.
  The server decides, and a new server-only verb `ccd ws-shed-deps` re-proves on the box. It ships in **shadow**
  behind `$REG/deps-shed-live` (no writer in the tree; the operator arms it), and every threshold is deployment config
  with a neutral default (§4, the config keys).
- **What the ruling changed.** The lifecycle policy's containment spine (§1.2: an artifact inside a workspace "needs no
  retention rule, no TTL, no sweep") is reversed for this one class, `node_modules` inside a sleeping session's
  worktree, and `ws-shed-deps` joins CLAUDE.md's SAFETY list (sessions never run it; the server lane does). Both are
  recorded with D-7278.

## 1. The population

"Stopped" here means a registry row whose session has no pane: a row with a stop stamp (`FleetSession.stoppedBy`) or a
hibernation marker (`$REG/<id>.hibernated`). Its worktree is still registered, so it is not an orphan.

- **Stopped workers** are dispatched children (`$REG/<id>.child` names their minting run). The stop-done lane
  (`server/src/stopDone.ts`, `RUN_DONE_POLICY`; D-5370, D-6091, D-6092) puts a child to sleep about ten minutes after
  its run closes `done` or `failed`. It also puts one to sleep 30 minutes after its run parks in `awaiting-review`,
  `merging` or `closing`. It composes `ccd hibernate`. The header says why: child reclamation "removes the workspace
  only once the programme has finished with it". Stop-done frees memory and was never meant to free disk.
- **Stopped coordinators** are rows that hold or held a run's `claimedBy`. Most carry no child marker.

## 2. Why each existing mechanism leaves them

| Mechanism | Population | Why a stopped registered session is not in it |
|---|---|---|
| child reclaim at close (`coord/close.ts`, `childReclaimDecision` in `coord/childReclaim.ts`) | the closing run's child | It reclaims only when the close is final, failed or retires the programme, or when the child is *spent* (a PR on its branch, dated to this incarnation). An ordinary non-final close re-holds the child for wave N+1 instead (`close.ts`'s claim note, case 2). |
| child reclaim sweep (`childReclaimSweepVerdict` in `childReclaimSweep.ts`) | every row with a child marker | It keeps a child on `held` (a programme hold stands while the programme has any open run), `minting-run-open` (a parked run never closed), `siblings-open`, `review-report-live` or `-stale`, `reviewed-run-absent`, `minting-run-absent`, `terminal-refusal` and `coordinating`. None of these lapses on its own. |
| the stale arm (`childReclaimStaleVerdict`, `coord/childReclaimStale.ts`; box half `ws-reclaim --stale`, `ccd/lib/disk-retention.sh` region 3; D-6638, D-6639) | kept children idle 7 days on both sides | **Armed on the fleet box** since 2026-10-25 (`$REG/child-stale-reclaim-live`, the operator's ruling of that day; D-7280); the marker has no writer in the tree (`shared/switches.ts`), and the box needs `reclaim-stale-v1`. It lapses `held`, `minting-run-absent`, the review words and `terminal-refusal` (`childReclaimStaleWordOf`). It has no word for `minting-run-open` or `siblings-open`, it never takes `coordinating`, and nothing younger than its 7-day floor. |
| stale archive, G1 (`coord/staleArchive.ts`, `staleArchiveVerdict`) | non-child, never-claimant workspaces with no pane for 14 days | It skips children (`child`) and anything that was ever a claimant (`claimant`), so it takes neither workers nor coordinators. Shadow until `$REG/stale-archive-live`. |
| expiry (`archivedExpiry.ts`, `coord/expireArchived.ts`) | archived rows, 7 days after the archive | A stopped row is not archived. |
| orphan-tree lane (`orphanTreeLane.ts`, `ws-orphan`) | linked worktrees no registry row names | A registered workdir answers `registered` at rung 4. |
| `ws-collect`, the tmp sweep | `~/.cc-tmp` entries; Claude Code scratch | Neither looks inside a worktree. |
| the lifecycle manifest (`shared/lifecycle.ts`, `child-workspaces`) | — | It records the child's collectors as above. `node_modules` has no row: the policy (§1.2, row 2) says it "dies with" its workspace. That holds only when the workspace dies. |

So a finished worker's worktree leaves the fleet only when its programme ends, its PR is proven on its own
incarnation at a close, or a person removes it. Nothing ever takes a coordinator's. In every case the 1.1 GB stays
on disk while the session sleeps, and most of it is `node_modules` that `npm ci` rebuilds.

**Why the armed stale arm does not reach the measured leak (D-7280).** Three populations are outside it. Most stopped
workers are younger than its floor: stop-done puts a worker to sleep about ten minutes after its run closes, and the
stale arm waits 7 idle days on both sides, so a fleet that finishes a wave a day carries about a week of finished
workers it cannot touch. A worker whose run never closes (parked at review, merge or close: `minting-run-open`) or has
an open sibling (`siblings-open`) is outside its cases by design, because removing the whole tree would leave a
send-back nothing to land on. And a coordinator is never taken (rule 4). So the arm stays armed, and the leak needs
Part B.

**Not measured here.** This note did not touch a box. The stopped workers' split by kept word can be read off the
child-reclaim banner and the kept feed rows (`CHILD_RECLAIM_SKIP` sentences, the `kept-many` arm). The fix below does
not depend on the split: Part B acts on any sleeping finished worker, whatever kept it, and on any sleeping
coordinator with no open claimed run.

## 3. Options

1. **The stale arm (formerly Part A).** No code, and already armed on the fleet box (D-7280). It takes the whole worktree
   of a kept child idle 7 days, with the branch, WIP and reflogs pinned under `refs/ccrc/attic/<id>/` first. It is
   limited by its 7-day floor (raise-only on the box, `WS_STALE_IDLE_S`) and by its missing words (§2).
2. **Deps-shed (Part B).** Remove only rebuildable dependency directories from a sleeping session whose work is
   finished, after a configurable age, and keep the worktree and every git fact. It reaches what the stale arm cannot:
   a worker kept by `minting-run-open` or `siblings-open`, the days before the 7-day floor, and a coordinator's
   worktree. **Chosen design (§4), ruled (D-7278).**
3. **Rejected:** a stale word for `minting-run-open`. It would remove a whole worktree whose run is still open, and a
   send-back would land on nothing.
4. **Rejected:** lowering the stale arm's 7 days. The box floor is raise-only by design (§2.7.3), so the server
   cannot lower it.
5. **Rejected:** removing a coordinator's worktree. Rule 4 and R37 still exclude it. What the operator took (A3,
   D-7278) is narrower: shedding a sleeping coordinator's ignored `node_modules`, which keeps the worktree, its branch
   and every git fact.
6. **Rejected:** a box-local deps arm in `ccd-tmp-sweep`. The box cannot see whether a run is done or whether a row
   ever coordinated. Those are the server's facts, and deciding them on the box would be a second writer.

## 4. Part B: the deps-shed arm

**Owner.** The stop-done lane's run-done row (`sleepLane.ts`'s `RUN_DONE_LANE`, run by `FleetWatcher.sleepRunDone`). It
already reads the store's facts the rule needs (the newest placed run, the open workers, the claimants, the live claims)
and owns the coordination serialiser every unattended act takes. The deps-shed arm is a second pass in the same body,
after `stopDonePass`, on the same tick's rows and listing, the same `sleepRunDone` cadence row and single flight, and
the same kill switches. It adds no `LANE_SCHEDULE` row. It is a second pass rather than a second `SLEEP_LANES` row
because its population is the one the sleep ladder skips (a row with a stop stamp answers `stopped` there) and its act
is not `ccd hibernate`: a legitimately different job beside the sleep, not a copy of it.

**The server's rule (L1, `server/src/depsShed.ts`, pure: `depsShedVerdict`).** A row is shed when all of these hold, and
the first that fails is its hold word:
- `workspace !== null` (never a main checkout), not archived, and its identity and status measured;
- it is asleep: `stoppedBy !== null` (the stop stamp both `ccd hibernate` and `ccd stop` write);
- its class is decided by the store's coordinator claims (`childReclaimCoordinatorClaims`, the one reader the sweep,
  the close and the stale arm use), read as follows:
  - `'open'` (it claims a run that is not terminal) holds `claims-open-run`; `'unplaced'` holds `claim-unplaced`;
  - a child (`child.kind === 'child'`) that never coordinated in its own generation (`childReclaimCoordinated`, with
    its birth) is a **worker**: its newest placed run (`StopDoneStoreRead.last`) must be `done` or `failed`, with
    `closedAt` at least `CCRC_DEPS_SHED_AFTER_HOURS` (default 24) old. A run parked at review, merge or close counts
    only when `CCRC_DEPS_SHED_PARKED_AFTER_HOURS` is set (default unset, which means never; A4 is left unset), and its
    clock is then the sleep's own instant (`stoppedBy.at`), because a parked run has no close;
  - a row with a numeric claim that is not a worker (a non-child that held a chair, or a child that coordinated in its
    own generation) is a **coordinator**: the latest instant it held a chair must be at least
    `CCRC_DEPS_SHED_AFTER_HOURS` old;
  - a non-child that never held a chair is the operator's own workspace and holds `not-coordinated`;
- no active run names it as worker (`openWorker`), and it holds no live claim (`claim`);
- its hold, classified as stop-done classifies it (`StopDoneHeldKind`), is `none`, `programme` or `run-terminal`. An
  operator's hold, a hold on a live run and an unreadable hold keep the row;
- it is not opted out (`$REG/<id>.no-hibernate`), nobody has it open (`Viewers.isOpen`), and the server has run for at
  least one presence TTL;
- it has not been shed during this sleep: `$REG/<id>.depsshed` (`<epoch> <bytes>`, the box's stamp) is absent or older
  than the stop stamp. A stamp that cannot be read keeps the row;
- the box's ccd lists `ws-shed-deps` (`shed-deps-v1`).

Any unread or unmeasured fact keeps the row. At most `CCRC_DEPS_SHED_PER_PASS` (default 1) rows are asked a pass,
fleet-wide, oldest clock first.

**The act (L4, `server/src/depsShedPass.ts`).** On the coordination serialiser and then the session's queue, as the sleep
lanes' act: the registry row is assembled again (`rowAtAct`), the store, presence and the stamp are read again, the hold
is classified again and the verdict asked again; then the kill and arming switches are read over a fresh registry
listing. Only then is `ccd ws-shed-deps --session <id> --class child|coordinator` composed (`child` for a worker)
(`CCD_ARGV.wsShedDeps`, the lane's actor `sweep:deps-shed`). A refusal or failure is not asked again for an hour (in
memory), doubled for each further one in the same sleep up to a day, and the row then sorts after every row the box has
not refused this sleep, so rows that keep refusing never starve a fresh one of the per-pass slot; `nothing-to-shed` and
`already-shed` settle the row for its sleep. Only the armed act holds the coordination serialiser (a dispatch or claim
must not land between the verdict's re-read and the removal); the shadow's dry run runs on the session's queue alone. A shed writes one `kind:'coord'` feed row, "Dependencies removed".

**Switches.** The act is shadow unless `$REG/deps-shed-live` exists, a new `shared/switches.ts` row with no writer in the
tree. In shadow the arm composes the same verb with `--dry-run`, which runs every rung and removes nothing, and records
one `kind:'coord'` feed row per row per sleep: "Dependencies would be removed: <id>, <n> dirs, <bytes>". The run-done
row's kill switches stop it (`stop-done-disabled`, `reclaim-paused`, `hibernate-disabled`). The box must advertise
`shed-deps-v1` (`ccdCan`).

**The box's re-proof: `ccd ws-shed-deps --session <id> --class child|coordinator [--dry-run] [--surface <w>] [--actor <t>]
[--reason <t>]`** (new verb, in `ccd/lib/disk-retention.sh`, behind the privileged direct-entry check). It answers one
JSON line, `ws-orphan`'s convention: a refusal `{"refused":<word>}` at exit 0, touching nothing, with the first word that
applies:
1. `paused`: `reclaim-paused` is listed;
2. `no-such-session`, `in-progress`, `not-a-workspace`: no row; or, for a real shed (never `--dry-run`, which takes
   no lock and makes no lock file), `$REG/.reap-<id>.lock` (the lock every verb that removes anything of the id takes)
   and then the shed's own `$REG/.shed-<id>.lock`, both taken `-n` in that order once the row stands, and either one
   held; or the row is a main checkout. The box re-proves the last with git itself before any candidate is listed:
   the workdir must be a LINKED worktree (`git rev-parse --git-dir` differs from `--git-common-dir`) and `-ef` no
   entry of `$PROJECTS_ROOT` nor its repository's own checkout;
3. `not-a-child`, `run-open`: `--class child` and no readable `.child` marker. This is a second, independent fence:
   the server's worker class needs the marker, and the box checks it itself. `--class coordinator` is not taken on
   the server's word either: a `.child` marker that stands must read (`not-a-child`), and while another standing row
   marked a child of the same run holds no stop stamp the box can see that run is still going (`run-open`). Every
   journal line names the marker (`meas.childRun`) beside the class (`meas.mode`);
4. `not-asleep`: the stop stamp (`$REG/<id>.stopped`, `<epoch> <surface>`) is absent or unreadable, or a tmux session
   answers, or the unit is not `inactive` or `failed`. This is the test `ws-archive --if-no-pane` makes before it acts;
5. `asleep-too-recently`: the stop stamp is younger than `CCD_DEPS_SHED_MIN_ASLEEP_S` (default 3600). This is the box's
   floor, and no argument lowers it;
6. `already-shed`: `$REG/<id>.depsshed` is at least as new as the stop stamp (at most once a sleep); `unmeasured` when it
   stands but cannot be read;
7. the candidates: each directory that `git -C <workdir> ls-files -z --others --ignored --exclude-standard --directory`
   lists, whose last component is one of `CCD_DEPS_SHED_NAMES` (default `node_modules`, space-separated), and for
   which `git ls-files -z -- <dir>` is empty. It must be a real directory, not a link, on the workdir's file system,
   resolve inside the workdir, and hold no `.git` (directory, file or link) at ANY depth: one bounded `find` over every
   candidate, and a walk that does not finish answers `unmeasured`. This keeps a nested repository and a git-ignored
   worktree, uncommitted work included, whatever `CCD_DEPS_SHED_NAMES` says, because the before/after `git status`
   cannot see inside an ignored tree. Each git call is contained as the reclaim ladder's are (`_ws_reclaim_contained`).
   No candidate answers `nothing-to-shed`;
8. the git state: `git status --porcelain=v1 -z --untracked-files=all` is read and digested before the act, after the
   size (`du`);
9. THE LAST FACTS, after every walk and just before the act, because a wake can start a pane while the walks run (the
   PWA's ensure route and the mail lane's wake of a hibernated row reach `ccd ensure` through no server queue the arm
   uses): `in-use` when `_ws_path_users_many` answers a holder for any candidate, on its physical spelling (an
   unmeasured answer is `unmeasured`); then `not-asleep` again when the stop stamp no longer reads as rung 4 read it (a
   wake clears it first), a tmux session answers, or the unit is not `inactive` or `failed`;
10. `--dry-run` stops here and answers `would-shed` with the candidates' count and bytes, exit 0;
11. the act: ONE removal of every candidate (`rm -rf --one-file-system`, `rm -rfx` on Darwin) under a
    `CCD_DEPS_SHED_SCAN_S` bound (default 30, lower-only). The git state is read again: a digest that differs answers
    `git-state-changed` (`{"failed":<word>}`, exit 1, journaled as a failure), and so does a removal that fails partway (`shed-incomplete`).
    Both are safe to retry, because what remains is still rebuildable. On success the verb writes
    `$REG/<id>.depsshed` (`<epoch> <bytes>`), journals `_lc_done shed-deps` with the class, dirs and bytes, and
    answers `{"shed":true}`, exit 0.

**Bounds.** Every call that walks a tree is bounded, and their number does not grow with the candidates: the ignored
listing, the repository walk, the size (`du`), two `git status` reads and the one `rm`, six at `CCD_DEPS_SHED_SCAN_S`;
the toplevel and index reads at 10 s each; the process walk at 10 s. With two TERM-to-KILL graces that is 226 s, under
the verb's runner row `CCD_VERB_TIMEOUT_MS['ws-shed-deps']` (240 s, ws-reap's), and `deps-shed-budget.test.ts` holds the
sum. A size that cannot be measured answers `bytes: null` and the act goes on.

There is no token. The act touches only bytes git calls ignored and untracked, all of which `npm ci` rebuilds, and each
rung is re-read at the act. This is the reasoning `ccd-tmp-sweep`'s dead arm already uses: remove after a re-check,
with no quarantine.

**On wake.** `ccd ensure` (re-dispatch), mail and Restart wake the session as today; the wake removes the stop stamp,
so the next sleep may shed again. A wake and a shed exclude each other: every path that creates a pane passes
`_ws_expire_spawn_gate`, which for a row that is not archived asks the shed's OWN lock, which only a real shed holds,
from rung 2 to its last removal (read-only, never creating the file, let go at once) and refuses, never waits, while it
is held. The gate never asks the reap lock of a row that is not archived, so ws-restore (which holds it across its own
`_spawn_start`), a reclaim of a kept child and a collect spawn exactly as they did, and a shadow dry run delays nothing. A wake
that asked before the verb took the lock has cleared the stop stamp, which rung 4 or the last facts (rung 9) read. Its next test step runs `npm ci` first, as CLAUDE.md's build section
already says. A follow-up can name the shed in the wake's kickoff line.

**Safety.**
- No git fact changes: not the index, a ref, a tracked file, or an untracked file git does not ignore, and the box
  proves it by reading `git status` before and after. A resumable session's unpushed work is untouched.
- A live session is never touched. The server requires a stop stamp and no viewer, and the box requires a stop stamp,
  no tmux session and an inactive unit, at rung 4 and again just before the act; a wake refuses while a real shed
  holds its shed lock.
- A coordinator is touched only asleep, claiming no open run, past the age, and re-proved at the act (D-7278). Its
  worktree, branch and attic are never touched; rule 4 stands for them.
- A worker that coordinated in its own generation is a coordinator here, never a worker.
- An operator's hold keeps the row, and so does the opt-out marker.
- Every doubt keeps.
- The act is at most once a sleep and at most `CCRC_DEPS_SHED_PER_PASS` a pass, so there is no herd.

**Config keys, neutral defaults.** Every threshold is deployment config (the operator rule of 2026-10-28: ccrc code is
never machine-specific). The server keys are read once by `loadConfig` (`server/src/config.ts`) and documented in
`deploy/ccrc.env.example`; the box keys are read by ccd at the act and documented in `deploy/ccrc-agent.env.example`.
A value that is not a positive integer falls back to the default, with one boot warning on the server.

| Key | Where | Default |
|---|---|---|
| `CCRC_DEPS_SHED_AFTER_HOURS` | server | 24 |
| `CCRC_DEPS_SHED_PARKED_AFTER_HOURS` | server | unset (parked runs never shed) |
| `CCRC_DEPS_SHED_PER_PASS` | server | 1 |
| `CCD_DEPS_SHED_MIN_ASLEEP_S` | box (ccd) | 3600 |
| `CCD_DEPS_SHED_NAMES` | box | `node_modules` |
| `CCD_DEPS_SHED_SCAN_S` | box | 30 (lower-only) |

**Wire.**
- `CCD_ARGV.wsShedDeps` and the capability `shed-deps-v1`.
- An agent grant `['ws-shed-deps','--session']`, with `'ws-shed-deps': '--session'` in `REQUIRED_VERB_FLAG`.
- `ws-shed-deps` in `FORBIDDEN_CCD_VERBS`, the session hook's forbidden verbs and a child's deny list.
- The direct-entry boundary: `ws-shed-deps <any tail>` starts under `bash -p` (`ccd/ccd`'s guard and `ccd/ccd-entry.py`).
- A CLAUDE.md SAFETY line: the SERVER's act on a sleeping finished worker's or coordinator's ignored dependency
  directories only, never a session's verb, and never run against a live host from a shell or a test.
- The lifecycle act `shed-deps` (`LifecycleAct`, ccd's `_LC_ACTS`).
- A `shared/lifecycle.ts` row `workspace-dependency-dirs`, and an amendment to policy row 2 (D-7278).
- No `FLEET_PROTO` bump, and no coord.db migration.

**Tests, red first.**
- Characterization, green on `main` before the arm: the run-done pass leaves a sleeping worker and a sleeping
  coordinator alone (no ccd call, no outcome), and the lifecycle manifest's class list and `child-workspaces` row.
- `deps-shed-verdict.test.ts`: every conjunct, both classes, and every doubt keeping.
- `deps-shed-pass.test.ts`: shadow composes `--dry-run` and writes the feed row once a sleep, armed composes the act,
  a kill switch, a missing capability or a switch dropped at the act is inert, and the act re-reads the verdict.
- `ccd-ws-shed-deps.test.ts` on the child fixture: each refusal word in order; a tracked file under `node_modules`
  keeps the directory; a non-ignored untracked file survives; a held directory answers `in-use`; a nested
  repository's `node_modules` is left; the floor cannot be lowered by an argument; the git state is unchanged.
- The guard suites: single-definition (the marker has no writer), the approvalguard verb list, the agent whitelist, the
  ccd capability list, the verb-set census and the lifecycle act vocabulary.

**Expected effect.** About 0.7 to 1 GB per finished worker comes back a day after its run closes, instead of weeks
later or never, and about as much per sleeping coordinator a day after its last chair. At the measured rate that is
most of the 15 to 20 GB a day. The stale arm then removes the rest of a kept child's tree at 7 idle days.

## 5. Operator acts (ruled 2026-10-28)

- **A1, ruled: approved and extended (D-7278).** ccrc may shed a sleeping finished session's ignored dependency
  directories (§4), for workers AND coordinators, shipped in shadow behind `$REG/deps-shed-live`, with every threshold
  deployment config. For a coordinator the act requires it asleep, no open run it claims, never a live session, and
  the same re-proof at the act. This reverses the lifecycle policy's §1.2 containment spine for that one class and adds
  `ws-shed-deps` to the SAFETY list. Arming `deps-shed-live` is the operator's act, after the shadow rows.
- **A2, a fact, not an act (D-7280).** `$REG/child-stale-reclaim-live` has stood on the fleet box since 2026-10-25, on
  the operator's ruling of that day. The stale arm is armed; it does not reach the measured leak (§2).
- **A3, ruled with A1: taken (D-7278).** Coordinators' `node_modules` are shed as above. Their worktrees stay rule 4's.
- **A4, left unset as recommended.** `CCRC_DEPS_SHED_PARKED_AFTER_HOURS` stays unset until the shadow rows show how
  many parked workers there are.

## Mutation table (measured 2026-10-28, on this branch)

Each guard was deleted or weakened alone, its suite run alone (`vitest --maxWorkers=2`, one file), and restored.

| # | Mutation | Suite | Result |
|---|---|---|---|
| M1 | `depsShedVerdict`: drop the `awake` hold | `deps-shed-verdict` | red (2) |
| M2 | drop `claims-open-run` | `deps-shed-verdict` | red (2) |
| M3 | a chair from an earlier generation makes a coordinator | `deps-shed-verdict` | red (1) |
| M4 | the age boundary `>=` to `>` | `deps-shed-verdict` | red (1) |
| M5 | drop the once-a-sleep stamp hold | `deps-shed-verdict` | red (1) |
| M6 | drop the `viewer` hold | `deps-shed-verdict` | red (2) |
| M7 | `ws-shed-deps`: drop the `not-a-child` fence | `ccd-ws-shed-deps` | red (1) |
| M8 | let the environment lower the box floor | `ccd-ws-shed-deps` | red (1) |
| M9 | drop the index check (`git ls-files -- <dir>`) | `ccd-ws-shed-deps` | red (1), after a widened listing was added; green before |
| M10 | drop the `git status` before/after comparison | `ccd-ws-shed-deps` | red (1) |
| M11 | `not-asleep` reads the pane only, not the unit | `ccd-ws-shed-deps` | red (1) |
| — | the separate leaf-link test | `ccd-ws-shed-deps` | green: redundant with M30's re-proof, so removed from the code |
| M13 | drop `already-shed` | `ccd-ws-shed-deps` | red (1) |
| M14 | `--dry-run` acts | `ccd-ws-shed-deps` | red (1) |
| M15 | an in-use answer passes | `ccd-ws-shed-deps` | red (1) |
| M29 | drop the own-`.git` fence | `ccd-ws-shed-deps` | red (1) |
| M30 | drop the physical-path re-proof | `ccd-ws-shed-deps` | red (1), after a widened listing was added; green before |
| M31 | drop the last facts' asleep re-check (rung 9) | `ccd-ws-shed-deps` | red (1) |
| M32 | the spawn gate never refuses on the shed lock of a row that is not archived | `ccd-ws-shed-deps`, `ccd-ws-expire-spawn` | red (2, 1) |
| M33 | the spawn gate asks the reap lock instead of the shed lock (the review's blocker: ws-restore died half-done) | `ccd-ws-shed-deps`, `ccd-ws-expire-spawn` | red (1 each) |
| M34 | `--dry-run` takes the two locks | `ccd-ws-shed-deps` | red (1) |
| M35 | drop the box's git-dir-differs-from-git-common-dir proof | `ccd-ws-shed-deps` | red (1), after a `--separate-git-dir` checkout was added; green before |
| M36 | drop the `-ef` against every `$PROJECTS_ROOT` entry | `ccd-ws-shed-deps` | red (1) |
| M37 | a coordinator-class ask passes a child marker whose run has an awake worker (`run-open`) | `ccd-ws-shed-deps` | red (1) |
| M38 | a coordinator-class ask passes an unreadable child marker | `ccd-ws-shed-deps` | red (1) |
| M39 | a real shed takes no shed lock | `ccd-ws-shed-deps` | red (2) |
| M16 | the pass never composes `--dry-run` | `deps-shed-pass` | red (4) |
| M17 | drop the kill switches at the act | `deps-shed-pass` | red (3) |
| M18 | drop the once-a-sleep shadow memory | `deps-shed-pass` | red (1) |
| M19 | drop the per-pass bound | `deps-shed-pass` | red (1) |
| M20 | an arming switch gone at the act still acts | `deps-shed-pass` | red (1) |
| M21 | the act does not re-ask the verdict | `deps-shed-pass` | red (1) |
| M22 | `'ws-shed-deps': '--session'` out of `REQUIRED_VERB_FLAG` | agent `whitelist-structural` | red (2) |
| M23 | `ws-shed-deps` out of `ccd-entry.py`'s protected verbs | `ccd-ws-shed-deps-reach` | red (3) |
| M24 | `ws-shed-deps` out of the body's entry guard | `ccd-ws-shed-deps-reach` | red (1) |
| M25 | `ws-shed-deps` out of `FORBIDDEN_CCD_VERBS` | `ccd-spawn-child-settings` | red (1) |
| M26 | `ws-shed-deps` out of the session hook's two verb arms | `session-hook-approval-deny` | red (2) |
| M27 | a config value of `0` or any digits accepted | `config` | red (1) |
| M28 | the watcher hands the pass a fixed age, not the config | `deps-shed-watcher` | red (1) |

## Deviations found

- **D-7279.** The gates (replaces the gates placeholder of the first draft). Stopped workers' worktrees are kept by design: child
  reclaim keeps them for the programme, and the stale arm that lets those keeps lapse has no word for a parked run or
  an open sibling and waits 7 idle days. Stopped coordinators' worktrees have no automatic exit (rule 4). Rebuildable
  `node_modules` had no collector of its own, because the lifecycle policy (§1.2, row 2) gave it its workspace's
  lifetime.
- **D-7278.** The operator's A1 ruling of 2026-10-28, extended to coordinators (A3): the deps-shed arm of the run-done
  row with the verb `ccd ws-shed-deps` (§4), in shadow behind `deps-shed-live`; the lifecycle policy's row 2 changes
  for this one class; the verb joins the SAFETY list. Two choices of the as-built arm are recorded under this number,
  not as deviations of their own: the shadow composes the verb's `--dry-run`, so a "would" row carries the box's own
  count and bytes (the note's earlier draft wrote the row with no box ask); and the box's asleep test and floor read the
  stop stamp (`.stopped`), which both `ccd hibernate` and `ccd stop` write, rather than `.hibernated` alone, so a
  coordinator stopped by hand is covered, and "once a sleep" compares `.depsshed` with the stop stamp rather than with
  `.woke`.
- **D-7280.** The fact record for A2: the stale arm is armed on the fleet box since 2026-10-25, and why it does not
  reach the measured leak.
