# The worktree leak: why stopped sessions' worktrees are never reclaimed, and the smallest fix

**Design note** · 2026-10-28 · Status: for the operator's ruling (§5). It builds on the fleet disk retention spec and
plan (`docs/superpowers/specs/2026-10-23-fleet-disk-retention-design.md`, `docs/superpowers/plans/2026-10-23-fleet-disk-retention.md`,
the #1119 rulings, merged as #1167) and the artifact lifecycle policy (`docs/superpowers/specs/2026-08-11-artifact-lifecycle-policy.md`).
Code citations are to `origin/main` `b9ff9d446`, by anchor (file and function), never by line.

## In short

- A fleet box measured on 2026-10-28: each new worker worktree of this repository costs about 1.1 GB, most of it
  `node_modules` (npm copies files, link count 1). Stopped workers held 41 GB in 60 worktrees, stopped coordinators
  20.7 GB in 16, and `node_modules` alone was 34 GB of the 76. Net growth was 15 to 20 GB a day.
- **Why nothing takes them (§2).** A stopped worker is a `--child` workspace that the stop-done lane put to sleep. The
  only exits for a registered child are child reclaim, at its run's close or in the sweep, and the reclaim's stale arm.
  Every other collector stays out by design: the orphan lane, stale archive, expiry, `ws-collect` and the tmp sweep.
  Child reclaim keeps a finished worker for its programme by design: the non-final close re-holds it for wave N+1, and
  it is kept while its run is parked, a sibling run is open, or the run it reviewed is open. The stale arm is the one
  mechanism that lets those keeps lapse. It ships in shadow and is armed only by `$REG/child-stale-reclaim-live`, which
  has no writer in the tree. It also has no word for a parked run (`minting-run-open`). A coordinator's workspace is
  never reclaimed automatically (rule 4). So nothing removes these trees, and nothing removes the rebuildable bytes
  inside them.
- **The fix, in two parts (§3, §4).**
  - **Part A, no code:** the operator arms the existing reaper's stale arm (act A2). Kept children idle for seven
    days are then reclaimed with their work pinned to the attic.
  - **Part B, the smallest new code:** a *deps-shed* arm. For a child that stop-done has already put to sleep, whose
    newest placed run is `done` or `failed` and closed past a configurable age, and which has never coordinated, it
    removes the git-ignored, untracked `node_modules` directories in its worktree. It keeps everything git knows about.
    The server decides, and a new server-only verb `ccd ws-shed-deps` re-proves on the box. It ships in shadow behind
    `$REG/deps-shed-live`.
- **What blocks building B in this PR (§5):** act A1. B reverses the lifecycle policy's containment spine for one
  class: §1.2 says an artifact inside a workspace "needs no retention rule, no TTL, no sweep". B also adds a destructive
  verb to CLAUDE.md's SAFETY list. Both have only ever changed on an operator ruling: #1119's four rulings, and D-6629
  for `ws-orphan`. So this PR carries this note alone, and B is built once A1 is ruled.

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
| the stale arm (`childReclaimStaleVerdict`, `coord/childReclaimStale.ts`; box half `ws-reclaim --stale`, `ccd/lib/disk-retention.sh` region 3; D-6638, D-6639) | kept children idle 7 days on both sides | **Shadow** until `$REG/child-stale-reclaim-live` exists. That marker has no writer in the tree (`shared/switches.ts`), and the box needs `reclaim-stale-v1`. It lapses `held`, `minting-run-absent`, the review words and `terminal-refusal` (`childReclaimStaleWordOf`). It has no word for `minting-run-open` or `siblings-open`, and it never takes `coordinating`. |
| stale archive, G1 (`coord/staleArchive.ts`, `staleArchiveVerdict`) | non-child, never-claimant workspaces with no pane for 14 days | It skips children (`child`) and anything that was ever a claimant (`claimant`), so it takes neither workers nor coordinators. Shadow until `$REG/stale-archive-live`. |
| expiry (`archivedExpiry.ts`, `coord/expireArchived.ts`) | archived rows, 7 days after the archive | A stopped row is not archived. |
| orphan-tree lane (`orphanTreeLane.ts`, `ws-orphan`) | linked worktrees no registry row names | A registered workdir answers `registered` at rung 4. |
| `ws-collect`, the tmp sweep | `~/.cc-tmp` entries; Claude Code scratch | Neither looks inside a worktree. |
| the lifecycle manifest (`shared/lifecycle.ts`, `child-workspaces`) | — | It records the child's collectors as above. `node_modules` has no row: the policy (§1.2, row 2) says it "dies with" its workspace. That holds only when the workspace dies. |

So a finished worker's worktree leaves the fleet only when its programme ends, its PR is proven on its own
incarnation at a close, or a person removes it. Nothing ever takes a coordinator's. In every case the 1.1 GB stays
on disk while the session sleeps, and most of it is `node_modules` that `npm ci` rebuilds.

**Not measured here.** This note did not touch a box. The 60 stopped workers' split by kept word can be read off the
child-reclaim banner and the kept feed rows (`CHILD_RECLAIM_SKIP` sentences, the `kept-many` arm). The fix below does
not depend on the split: Part B acts on any sleeping finished child, whatever kept it, and Part A covers the words the
stale arm already lapses.

## 3. Options

1. **Arm the stale arm (Part A).** No code. It takes the whole worktree of a kept child idle 7 days, with the branch,
   WIP and reflogs pinned under `refs/ccrc/attic/<id>/` first. It is limited by its 7-day floor (raise-only on the box,
   `WS_STALE_IDLE_S`) and by its missing words. **Recommended now (act A2).**
2. **Deps-shed (Part B).** Remove only rebuildable dependency directories from a sleeping finished child, after a
   configurable age, and keep the worktree and every git fact. It reaches what Part A cannot: a worker kept by
   `minting-run-open` or `siblings-open`, and the days before the 7-day floor. **Chosen design (§4), behind act A1.**
3. **Rejected:** a stale word for `minting-run-open`. It would remove a whole worktree whose run is still open, and a
   send-back would land on nothing.
4. **Rejected:** lowering the stale arm's 7 days. The box floor is raise-only by design (§2.7.3), so the server
   cannot lower it.
5. **Rejected:** touching a coordinator's worktree. Rule 4 and R37 exclude it, and the task's rule keeps it out.
   Shedding a coordinator's `node_modules` is listed as a separate question (A3) and is not in B.
6. **Rejected:** a box-local deps arm in `ccd-tmp-sweep`. The box cannot see whether a run is done or whether a row
   ever coordinated. Those are the server's facts, and deciding them on the box would be a second writer.

## 4. Part B: the deps-shed arm

**Owner.** The stop-done lane already computes the exact predicate: a dispatched child, its newest placed run
finished, never an open claimant. It also already sees the population, because a row it has put to sleep answers its
`stopped` hold. The deps-shed arm is a second verdict over the same pass's facts, in the same lane
(`sleepLane.ts`'s run-done row), and adds no lane.

**The server's rule (L1, `server/src/depsShed.ts`, pure).** A row is shed when all of these hold:
- it has a child marker (`child.kind === 'child'`), `workspace !== null`, and it is not archived;
- it is asleep: `stoppedBy !== null`, and stop-done answers it `stopped`;
- its newest placed run (`StopDoneStoreRead.last`) is `done` or `failed`, with `closedAt` older than
  `CCRC_DEPS_SHED_AFTER_HOURS` (default 24). A run parked in review, merge or close counts only when
  `CCRC_DEPS_SHED_PARKED_AFTER_HOURS` is set (default unset, which means never), measured from the turn marker as
  stop-done measures it;
- no active run names it as worker (`openWorker`), and it claims nothing (`openClaimant`, `claim`);
- it never coordinated in its own generation (`childReclaimCoordinated`, the function the sweep, the close and the stale
  arm use);
- its hold, classified as stop-done classifies it (`StopDoneHeldKind`), is `none`, `programme` or `run-terminal`. An
  operator's hold, a hold on a live run and an unreadable hold keep the row;
- it is not opted out (`$REG/<id>.no-hibernate`), and nobody has it open (`Viewers.isOpen`);
- it has not been shed since it last woke (the box's `$REG/<id>.depsshed` is older than `.woke`, or absent).

Any unread or unmeasured fact keeps the row. At most `CCRC_DEPS_SHED_PER_PASS` (default 1) acts a pass, fleet-wide, on
the session's queue, oldest close first.

**Switches.** The arm is shadow unless `$REG/deps-shed-live` exists, a new `shared/switches.ts` row with no writer in the
tree. Without it, the arm records one `kind:'coord'` feed row per row: "dependencies would be removed (<n> dirs)".
`reclaim-paused` and `stop-done-disabled` stop it. The box must advertise `shed-deps-v1` (`ccdCan`).

**The box's re-proof: `ccd ws-shed-deps --session <id> [--actor <t>] [--reason <t>]`** (new verb, in
`ccd/lib/disk-retention.sh`, behind the privileged direct-entry check). It refuses with the first word that applies:
1. `paused`: `reclaim-paused` is listed;
2. `no-such-session`, `not-a-workspace`: no row, or the row is a main checkout;
3. `not-a-child`: no readable `.child` marker. This is a second, independent fence against coordinators;
4. `not-asleep`: no `.hibernated` marker, or a tmux session or an active unit exists. This is the same test
   `ws-archive --if-no-pane` makes before it acts;
5. `asleep-too-recently`: `.hibernated` is younger than `CCD_DEPS_SHED_MIN_ASLEEP_S` (default 3600). This is the box's
   floor, and no server argument lowers it;
6. the candidates: each directory that `git -C <workdir> ls-files -z --others --ignored --exclude-standard --directory`
   lists, whose last component is one of `CCD_DEPS_SHED_NAMES` (default `node_modules`), and for which
   `git ls-files -z -- <dir>` is empty. It must be a real directory, not a link, on the workdir's filesystem, and not
   inside a nested repository. Each git call is contained as the reclaim ladder's are (`_ws_reclaim_contained`).
   No candidate answers `nothing-to-shed`;
7. `in-use`: `_ws_path_users` answers a holder for any candidate, on its literal or its physical spelling;
8. the act: each candidate is removed with `rm -rf --one-file-system`, under a `CCD_DEPS_SHED_SCAN_S` bound (default
   30). The verb writes `$REG/<id>.depsshed` (`<epoch> <bytes>`) and journals `_lc_done shed-deps` with the dirs and
   bytes. A removal that fails partway answers `shed-incomplete`. That is safe to retry, because what remains is
   still rebuildable.

There is no token. The act touches only bytes git calls ignored and untracked, all of which `npm ci` rebuilds, and each
rung is re-read at the act. This is the reasoning `ccd-tmp-sweep`'s dead arm already uses: remove after a re-check,
with no quarantine.

**On wake.** Nothing changes. `ccd ensure` (re-dispatch), mail and Restart wake the session as today. Its next test
step runs `npm ci` first, as CLAUDE.md's build section already says. A follow-up can name the shed in the wake's
kickoff line.

**Safety.**
- No git fact changes: not the index, a ref, a tracked file, or an untracked file git does not ignore. A resumable
  session's unpushed work is untouched.
- A live session is never touched. The server requires a sleeping row, and the box requires no pane and no active unit.
- A coordinator is never touched. The server checks the claims, and the box requires the child marker.
- An operator's hold keeps the row.
- Every doubt keeps.
- The act is at most once per wake and at most `CCRC_DEPS_SHED_PER_PASS` a pass, so there is no herd.

**Config keys, neutral defaults.**

| Key | Where | Default |
|---|---|---|
| `CCRC_DEPS_SHED_AFTER_HOURS` | server (`config.ts`) | 24 |
| `CCRC_DEPS_SHED_PARKED_AFTER_HOURS` | server | unset (parked runs never shed) |
| `CCRC_DEPS_SHED_PER_PASS` | server | 1 |
| `CCD_DEPS_SHED_MIN_ASLEEP_S` | box (ccd) | 3600 |
| `CCD_DEPS_SHED_NAMES` | box | `node_modules` |
| `CCD_DEPS_SHED_SCAN_S` | box | 30 |

**Wire.**
- `CCD_ARGV.wsShedDeps` and the capability `shed-deps-v1`.
- An agent grant `['ws-shed-deps','--session']`, with `'ws-shed-deps': '--session'` in `REQUIRED_VERB_FLAG`.
- `ws-shed-deps` in `FORBIDDEN_CCD_VERBS`.
- A CLAUDE.md SAFETY line: the SERVER's act on a sleeping finished child's ignored dependency directories only, never a
  session's verb, and never run against a live host from a shell or a test.
- A `shared/lifecycle.ts` row `workspace-dependency-dirs`, and an amendment to policy row 2.
- No `FLEET_PROTO` bump, and no coord.db migration.

**Tests, red first.**
- `depsShed.test.ts`: every conjunct, and every doubt keeping.
- A sleep-lane case: shadow writes the feed row, armed composes the argv, and a pause or a missing capability is inert.
- `ccd-ws-shed-deps.test.ts` on `makeCcdHarness`: each refusal word in order; a tracked file under `node_modules`
  keeps the directory; a non-ignored untracked file survives; a held directory answers `in-use`; a nested repository's
  `node_modules` is left; the floor cannot be lowered by an argument.
- The guard suites: single-definition (the marker has no writer), the approvalguard verb list, the agent whitelist, the
  ccd capability list, and the mail-routes kebab scan.

**Expected effect.** About 0.7 to 1 GB per finished worker comes back a day after its run closes, instead of weeks
later or never. At the measured rate that is most of the 15 to 20 GB a day. Part A then removes the rest of a kept
child's tree at 7 idle days.

## 5. Operator acts

- **A1, blocks Part B.** Rule whether ccrc may shed a sleeping finished child's ignored dependency directories (§4).
  This reverses the lifecycle policy's §1.2 containment spine for that one class, and it adds `ws-shed-deps` to the
  SAFETY list. **Recommended: approve,** for children only, shipped in shadow. Arm `deps-shed-live` after a week of
  "would" rows.
- **A2, independent, relieves the disk now.** Touch `$REG/child-stale-reclaim-live` on the fleet box, after checking
  that its ccd lists `reclaim-stale-v1`. **Recommended: yes.** In shadow it records a "child would be reclaimed
  (stale)" feed row for each child it would take, so the feed shows what arming it will remove.
- **A3, optional, later.** Should B extend to stopped coordinators' `node_modules`, which is rebuildable too? Rule 4
  covers the worktree, not its ignored bytes, but this note keeps coordinators out. **Recommended: not now.** Revisit
  with B's shadow numbers.
- **A4, optional.** Should parked runs count? Set `CCRC_DEPS_SHED_PARKED_AFTER_HOURS`. **Recommended: leave it unset**
  until A1's week of shadow rows shows how many parked workers there are.

## Deviations found

- **D-TBD-worktree-leak-gates.** Stopped workers' worktrees are kept by design: child reclaim keeps them for the
  programme, and the stale arm that lets those keeps lapse is unarmed and has no word for a parked run. Stopped
  coordinators' worktrees have no automatic exit (rule 4). Rebuildable `node_modules` has no collector of its own,
  because the lifecycle policy (§1.2, row 2) gives it its workspace's lifetime.
- **D-TBD-deps-shed.** The deps-shed arm of the run-done sleep lane, with the verb `ccd ws-shed-deps` (§4). It awaits
  act A1.
