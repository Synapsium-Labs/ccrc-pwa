# Delegation broker wave 5 (Adopt) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the worktrees that delegated work leaves behind when they hold real work, and give their owner a way to keep them or turn them into a real run. Each linked lease gets a box-side carrier file, written only by a new server-composed ccd verb (`ws-lease-mark`). A read-only ccd verb (`ws-lease-audit`) measures whether a tree changed. The server adopts a changed `agent`/`workflow` tree after its activity's terminal evidence, mails the parent one digest, and lets the parent keep the tree (Retain) or promote it into an ordinary run that starts at the tree's tip (`ws-add --base`). The orphan-tree lane skips a held tree on the box and on the server. The operator can keep, attach or disown a tree from the PWA. Nothing in wave 5 removes a worktree, repairs an activity, writes an `unknown` execution state, or adopts a rung-4 (`raw`) lease by itself.

**Architecture:** Every lease fact stays journal-first. Three new journal entry kinds (`lease-transition`, `lease-released`, `lease-carrier-seen`) are applied by new `DelegationDurability` doors beside `createLease`, checked by ONE L1 transition table (`server/src/coord/delegation-lease-state.ts`) and a loosened `assertLease`. Pure L1 deciders plan carrier marks (`delegation-carrier.ts`), adoption and reminders (`delegation-adoption.ts`), the operator and parent acts (`delegation-lease-acts.ts`) and the orphan-lane hold (`delegation-orphan-hold.ts`); the `DelegationLane` in `watch.ts` (L4) runs them and composes `CcdArgv` through new `CCD_ARGV` keys, each behind a capability the box reports (`lease-mark-v1`, `lease-audit-v1`, `ws-add-base-v1`; refuse on no evidence). The fleet side is a new ccd library, `ccd/lib/delegation-lease.sh`, with the carrier writer and reader, the box-side fingerprint and both verbs; `ws-add --base` is a start point only; the orphan ladder gains a lease rung that fails shut. Wire additions are optional fields on `DelegationLeaseWire`, each with one reader, absence permits.

**Tech Stack:** TypeScript ESM on Node.js `>=22.16.0`; synchronous `node:sqlite` `DatabaseSync`; Fastify and the `/ws/fleet` socket; the React PWA on `@ccrc/ui` tokens; Bash `ccd` and its libraries, python3 for JSON on the fleet box (as `_json_str` already requires); jq in the hook; Vitest.

**Approved by the operator on 2026-11-04**, with every recommendation on O5-1..O5-8 (ruled as D-7840..D-7847, below). Approving the plan approves its thresholds (`D-7794`) and its departures from the spec.

**Operator amendment — 2026-10-28: soaks waived.** "All remaining elapsed-time soak gates in this programme are **waived**, not passed: ... and wave 5's three-day window. No replacement T0, restart or wait-until date is required." "Exact-tip independent review, required CI and the native merge queue, implementation completeness, ownership and dependency clearance, rollout verification and truthful run closure remain required. ... a soak waiver is not blanket edit, sync, push, deployment or closure authority." No text of this wave says that a soak, a window or an elapsed time passed or qualified anything.

**Scope decision — 2026-11-02 (binding on every PR).** "ship honest helper/workspace visibility while unqualified automatic-end/reopening capabilities remain explicitly unsupported or not confirmed. A live parent, silence, a missing view or an incomplete roster is not execution or completion proof. Automatic repair remains outstanding programme work." The banner adds: "This scope decision does not approve the follow-up's final architecture, time defaults, durable migration, written spec or implementation plan; their ordinary approval gates remain. It does not release existing worker holds or authorize a safety-refused inspection." So wave 5 is not repair and not programme completion; its thresholds (5 minutes, two stable passes, 7 days, 24 hours) are approved, if at all, by approving this plan.

**Spec:** `docs/superpowers/specs/2026-10-04-delegation-broker-design.md`, stage 4 "Adopt" (§5.6 adoption, §5.7 promotion, §5.10 carrier, §5.11 the read-only audit, §5.12 journal, §5.14 operator resolution, §6 routes, §7 stage 4), and the programme ledger `docs/superpowers/programs/delegation-broker.md`. Amended by:
- D-6999 (2026-10-26): §5.6's "a rung-4 (raw) lease is adopted when linked" no longer holds. A raw lease is never adopted automatically; the operator attaches one.
- D-7002 (2026-10-26): waves 6 and 7 (`ws-lease-clean`, audit tokens spent by a deleter, `lease-clean-v1`) are dropped. The orphan-tree lane (#1252) owns removal and must skip an adopted lease. Every §5.6, §5.7 and §5.11 sentence that assumes the lease cleaner is read without it.
- D-7000: the journal's retention floor is 10 days.
- D-7023: the frame's shape (no `lineage`, no `backlog`; unowned rows `unresolved|conflicting` only).
- This plan's own departures, D-7794..D-7848 and D-7850..D-7856, in "## Deviations found".

Feature PRs edit no spec text. The spec text of §5.6, §5.7, §5.10, §5.11, §5.14, §6 and §8.5 follows in the wave's ledger pull request, which the coordinator writes after the operator rules the O5 questions.

**Read first: what wave 5 depends on.** Wave 4 PR1 (#1614, the server's `delegation` frame) and PR2 (#1627, the PWA's rows) are merged. Wave 4 PR3 (journal compaction, `delegation-carried.log`, the K1 carry rules, `readDelegationRetainedRecords`, the 10-day floor) and PR4 (hook and ccd hygiene, the absent-owner spool prune) were NOT merged when this plan was written; both have since merged (PR4 #1619 as `27cd78962` and PR3 #2191 as `30b270d19`, 2026-11-03). Their interfaces below come from the wave-4 plan text (`docs/superpowers/plans/2026-10-26-delegation-broker-wave4-project.md`) only, so every worker re-points them by content after merging `main`. The PWA-only visibility release (spec `docs/superpowers/specs/2026-11-02-delegation-visibility-design.md`, plan `docs/superpowers/plans/2026-11-02-delegation-visibility.md`) was approved on 2026-11-04 and is not yet merged; PR10 of this plan is written against its names and waits for it.

## Global Constraints

- **Verbatim rulings that bind this wave.** Spec §2:
  - 3. "**Durable work started outside `runs dispatch` is auto-adopted and guided** toward promotion into a real run; never silently ignored, never forcibly converted."
  - 5. "**Durable nesting lasts until the workspace is reclaimed**, not until a run closes."
  - 7. "**The new ccd verbs are workspace-lifecycle verbs, not coordination mutation** (2026-10-04). They sit beside `ws-reclaim`: server-composed, capability-gated, on the SAFETY list, named in no skill."
  - 8. "... the lease carrier is written by a ccd verb, not the fleet agent (§5.10) ..."

  Spec §2.1 (approved 2026-10-05): R1 "Promotion **dispatches an ordinary child workspace starting at the lease's tip** (`ws-add --base`) ..."; R2 "**The server journal alone creates a lease.** A carrier corroborates; a carrier with no journal entry is shown as unowned work, never cleanup-eligible"; R5 "A separate read-only verb **`ws-lease-audit`**, its own capability"; R8 "**Carriers (`ws-lease-mark`) and the read-only `ws-lease-audit` ship with adoption in stage 4**; a carrier is written when a lease is linked, not when it is adopted"; R9 "a programme worker's durable leases nest under the top coordinator labelled "via <worker>"".

  D-6999: "a lease whose `sourceKind` is `raw` (rung 4) is displayed nested under its linked session, marked "inferred" with the creating Bash call's `toolUseId`, for soak-era and later leases alike, with no date cut-off and no policy switch. It is never adopted automatically in wave 5; the operator attaches one with a tap (spec §5.14, resolve attach)."

  D-7002: "waves 6 and 7 (lease audit and clean, spec stages 5 and 6) are dropped. The orphan-tree lane (#1252) owns cleanup of these trees and must skip an adopted lease, which wave 5 builds."

  2026-10-15/16 lane-ruling bounds: "A second durable file, journal compaction, the O5 order and the O3 snapshot contents stay the operator's." No PR adds a durable file; the new journal entry kinds ride the existing journal and the applier's O5 order unchanged.
- **Zero new ccd verbs for coordination mutation, reconciled as the spec argues it.** `ws-lease-mark`, `ws-lease-audit` and `ws-add --base` act on workspaces, not on coordination state (ruling 7). They are composed only by the server through `CCD_ARGV`, each behind its own capability; `ws-lease-mark` is forbidden to every session (SAFETY list, `FORBIDDEN_CCD_VERBS`, child deny, the hook's deny lists, the installer's child-deny loop); `ws-lease-audit` is read-only and, like `ws-audit`, is not on those lists; no skill names any of them (`coordinator-skill.test.ts`). The coordination mutations of this wave (Retain, operator-retain, resolve, promote) are server routes, never ccd verbs. PR1 adds the CLAUDE.md sentence the spec's §13 asks for, with the verb that ships it, never earlier.
- **The agent's write allowlist is not widened.** The carrier's only writer is `ccd ws-lease-mark`, reached through `EXEC_COMMANDS = ['tmux','ccd']`. The server reads carriers through the agent's read ops (`.cc-sessions/` is readable).
- **Public repository.** Everything in these PRs is public: code, fixtures, commit messages, branch names, PR bodies and comments. Use neutral stand-ins (`project-a`, `lane-a`, `coord-a`, `the fleet box`, `<projects-root>`), refer to ccrc work by its GitHub `#n`, and write no private name, host, address, absolute home path, private repository or tracker link. Test fixtures use `demo`, `lane-a-demo`, `coord-a-demo`.
- **Rings.** Ring membership is a property of a file's imports. L0 `shared/*.ts` imports nothing; L1 decides with no I/O, no `fs`, no fastify, no clock (it is fed `now`); L2 ports are declared by the consumer; L3 adapters keep every distinction they receive (an absent carrier, an unreadable one and a malformed one are three answers); L4 delivers and never decides; L5 is `index.ts` alone. Every new `server/src/coord/*.ts` file is C5 by the `coord/**` row of the ring-context table and is checked by `server/test/rings/totality.test.ts`.
- **Additive wire.** `FLEET_PROTO` and `FLEET_PROTO_MIN` stay 1. New fields are optional members of `DelegationLeaseWire` (and an optional `carriers` member of the delegation health block), each with one reader, absence permits. No `FleetSession` field, no `reviveFleetSession` change, no frame arm. W4-U27's older-server render (`pwa/test/older-server-render.test.tsx`) stays byte-for-byte.
- **Single definition.** Each new closed vocabulary is declared once, in `shared/api.ts` or beside its one L1 owner, and every list is derived; `server/test/single-definition/vocabularies.test.ts` gains a row per vocabulary. `DELEGATION_CARRIER_STATES` is derived from `DELEGATION_DISPOSITIONS`, never a second spelling.
- **Stage marker with no writer.** `$REG/delegation-adopt` (`DELEGATION_ADOPT_MARKER`) has no writer in the tree; the operator touches it by hand. A row in `single-definition` pins that.
- **Mutation-table discipline.** Every new guard ships with a row that goes red when the guard is deleted or mutated, measured before and after. Mutants are applied one at a time to a saved copy and restored from it (sha checked), never with `git checkout`. A mutation run is bounded by time and a measured process cap.
- **Characterisation first when a behaviour moves.** PR4 pins today's orphan ladder, green on `main`, in its own commit, before the lease rung lands.
- **Growth cap.** At most 40 net code lines per growth-listed file per PR (`server/test/growth-check.test.ts#GROWTH_FILES`, `server/test/growthCheck.ts#GROWTH_LIMIT`). A PR that adds a new file under `server/src/coord/` or `shared/` waives every listed file for that PR (`server/test/growthCheck.ts#growthOver`), and each such PR still aims at 40. Every gate that grows `ccd/ccd`, `ccd/session-hook.sh` or a server growth-listed file runs `GROWTH_CHECK=1` growth-check. `ccd/lib/*.sh` is not growth-listed.
- **Branches.** Each PR's branch is the worker's workspace branch, cut from `main`. It merges `main` in, never rebases, never uses `update-branch`.
- **Hunks owned by in-flight PRs.** Until they merge: wave-4 PR3 owns the delegation lane's `upkeep`, `prune` and `compact` phases in `server/src/watch.ts`, the compaction rows of `server/src/coord/delegation-checkpoint.ts` and `server/src/coord/delegation-journal.ts`, and `deploy/coordination-snapshot.mjs`'s carried-file entries. Wave-4 PR4 owns `ccd/ccd#_spawn_start`'s spool call and the functions after `ccd/ccd#_delegation_spool_dir`, the spool rows of `ccd/contexts.tsv` and `ccd/contexts-edges.tsv`, `ccd/install-session-hooks.sh`'s `JQ_UNMANAGED`, and `ccd/ccrc-doctor-checks`'s delegation-hooks check. The visibility release owns `pwa/src/fleet/delegationWords.ts`, `WorkLine.tsx`, the comments of `shared/api.ts#DelegationLiveness` and `DelegationActivityWire.upstreamId`, and its §8 census edits. No wave-5 PR edits inside them; each re-points by content after merging `main`.
- **Claims.** Before each task a worker lists open claims on every file the task touches, and claims before a subagent edits. A task that touches a file another run holds starts only after that PR merges, or with consent through the coordinator. PR4 is a behaviour change on the orphan lane's files and needs that lane owner's consent through the coordinator before Task 5.4.2.
- **PR-body first line.** "Soaks waived by the operator on 2026-10-28; merge only after accepted exact-tip review, required CI and the programme's dependency/landing order."
- **Ledger edits: one route.** No feature PR modifies an existing file under `docs/superpowers/plans/` or `docs/superpowers/programs/` (D-6926, `.github/ci/ledger-guard.mjs`). A worker records a departure in a NEW note `docs/superpowers/plans/2026-11-03-delegation-broker-wave5-adopt/prN.md`, as prose, and mails the coordinator, who folds it in the wave's ledger PR.
- **D-numbers.** This plan holds D-7794..D-7848 and D-7850..D-7856 (issued 2026-11-03). Each PR's implementation departures get their own block, minted at that PR's run-open; a worker never invents one. A worker never writes a number it was not issued.
- **Tests: only through `ccrc test`, in the foreground, on fixture HOMEs.** Every suite runs from inside its package as `~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/<file>`, one file per run, in the foreground, with a tool timeout of at least 600000 ms. Typecheck is `~/.local/bin/ccrc test -- ./node_modules/.bin/tsc --noEmit`. The client is always spelled by that path, because `~/.local/bin` is not on a fleet session unit's `PATH` (a bare `ccrc test` fails `command not found` before any RED or GREEN is measured). Never bare `npx vitest`, never your own `systemd-run`. Every ccd test runs on `makeCcdHarness` (`server/test/ccdWsHelpers.ts`) fixture HOMEs; never run `ccd` against the live `$HOME`, `~/.cc-sessions`, `~/.ccrc`, tmux or systemd. A known load flake (repo `CLAUDE.md`) is re-run alone before a red is called a break.
- **Never read live delegation files.** No worker reads the live spool, journal, carried file, checkpoint, carriers, `coord.db` or any secret file. Live readings are the coordinator's, from server log lines, `/api/fleet/health` and `GET /api/updates`.
- **Citations.** Added lines carry no numeric `file:line` citation (`server/test/citations.test.ts`, D-5893). Cite `path#symbol` or `path#@anchor`; put `# @anchor name` on a cited shell line that has no symbol.
- **Words.** No delegation word says `running`. No exported PWA string contains `lease`, `adopt`, `retain`, `clean` or `spool` (W4-U10) unless the operator rules otherwise (O5-6). Adoption and promotion are never described as repair, and wave 5 is never described as the programme's completion.

## Open operator questions

The operator ruled all eight on 2026-11-04 and took every recommendation: O5-1 (a), O5-2 (b), O5-3 (a), O5-4 (a), O5-5 (a), O5-6 (a), O5-7 (a), O5-8 (c). Each ruling is recorded under its own number, D-7840..D-7847 for O5-1..O5-8 (see Deviations found). The questions stay as they were asked. A row, step, file or mutant that names an option the operator did not choose (for example "O5-8 (a) only" or "under O5-8 (a)/(b)") is not built in wave 5.

**O5-1. What the orphan-tree lane skips, and for how long.** D-7002 says only "must skip an adopted lease". With the cleaner gone, nothing says what happens when an adopted lease's 7 days end, or whether retained, transferring or foreign trees are skipped.
- (a) Skip `adopted`, `retained` and `transferring` until `expiresAt` (reset by every Retain), then stop skipping and let the orphan ladder's own rungs decide. The ladder still refuses a dirty tree and anything not quiet for its idle floor (7 days, or 3 days under disk pressure once `_disk_pressure` exists on the box: `ccd/lib/disk-retention.sh#WS_ORPHAN_FLOOR_PRESSURE_S`). A head on no remote is refused unless the operator has armed the rescue switch: then rung 9's `--rescue` path pins those commits as attic refs and removes the tree (`ccd/lib/disk-retention.sh#cmd_ws_orphan`, `server/src/orphanTreeLane.ts#orphanRescueArmed`). A tree released `foreign` is not skipped: it means "not delegation's".
- (b) As (a), but `foreign` is skipped forever.
- (c) Skip adopted, retained and transferring forever, until released.
- **Recommended: (a).** It gives the 7-day clock and the 24-hour reminder a real meaning ("after this date the worktree is no longer held back from the disk sweep"), and the orphan ladder never removes uncommitted changes; commits on no remote are saved as attic refs before a rescue removes the tree. If (a) is wrong, a clean tree whose owner never kept it is removed after its idle floor; its commits are on a remote or, under an armed rescue, in an attic ref, so the loss is the checkout (and, for rescued commits, their place on a branch). If (c) were chosen and wrong, adopted trees pile up on a box whose disk has filled before.
- **Ruled 2026-11-04: (a)** (`D-7840`).
- **Blocks:** Task 5.4.2 (the rung's state set and expiry), Task 5.4.3 (the server hold), Task 5.7.4 (the reminder's text), Task 5.8.1 (whether `foreign` ends the hold), Task 5.10.1 (the expiry words).

**O5-2. Promotion when the linked activity has no terminal event.** Spec §5.7 refuses a linked activity that is `active` or `unknown`. The durable `unknown` writer is deferred, so orphaned work, the population this programme exists for, could never be promoted, and work whose stop event was lost stays `active` forever.
- (a) The spec as written: refuse both. The operator's only path is attach, then Retain.
- (b) Refuse `active` under a live parent. Allow `unknown`, or `active` under a parent proved dead (spec §5.11's terminal evidence), only when the audit measures no process holding or sitting in the tree (`holders` empty). Unmeasured refuses.
- (c) Add an operator act, "the operator says this ended", journalled.
- **Recommended: (b).** It measures a physical fact, never infers an end from silence or a live parent, and writes no "ended". If (b) is wrong, a promotion runs while a detached process the `/proc` probe cannot see still writes the old tree; those writes stay in the old tree and the parent's mail says untracked work does not travel.
- **Ruled 2026-11-04: (b)** (`D-7841`).
- **Blocks:** Task 5.2.1's `holders` field and its runner budget row, Task 5.9.3's measure step.

**O5-3. Locked trees and carriers.** Every tree left by an agent still running when its parent died carries a git `locked` file (27 of 27, ledger amendment `orphaned-agent-tree-is-locked`). Spec §5.10 refuses to mark a locked tree, so these trees get no carrier and stay journal-only and `unmeasured`.
- (a) Keep the refusal. A locked tree is shown and never adopted or promoted. The orphan ladder already refuses locked trees, so nothing removes it. It becomes eligible the pass after the lock is gone.
- (b) Mark locked trees anyway: the carrier is a file under `$REG`, not a write into the tree.
- **Recommended: (a).** Nothing is lost and safety holds on both lanes. Changing it later is one refusal row.
- **Ruled 2026-11-04: (a)** (`D-7842`).
- **Blocks:** Task 5.1.3's row W5-L8, Task 5.7.2's eligibility rule 6.

**O5-4. Programme-worker parents: digest recipient and Retain caller.** §5.7 lets a worker's coordinator promote the worker's lease; §6 lets only the parent Retain; R9 nests the lease under the coordinator; the worker skill forbids a worker to dispatch.
- (a) The digest goes to the coordinator, carrying the Retain and promote lines; the worker gets none. Retain is allowed for the parent or that coordinator, the same rule as promote (amends §6 row 3). "That coordinator" is decided by ONE L1 function, `server/src/coord/delegation-lease-acts.ts#leaseCoordinatorOf(lease, runs)` = `claimantAt(runs, lease.parentId, parseDelegationInstant(lease.firstObservedAt))` (`server/src/coord/runBinding.ts#claimantAt`), the rule the frame's R9 nesting already shows the operator (`server/src/coord/delegation-projection.ts#projectDelegation`'s `coordinatorOf`). It answers inside a closed run's interval, so a worker whose run closed before adoption still names its coordinator; it never uses `bindingOf`, the worker's CURRENT binding, which is null or another run once the worker's run closes or its row is re-created. The digest recipient, Retain and promotion all call it, so the coordinator shown as the row's owner is the one that may keep and promote it. Its `runs` are never `CoordStore#delegationRunStamps()`, which holds the open runs and only the newest 500 closed ones (`closedLimit ?? 500`): a lease Retain keeps for weeks outlives that window on a busy fleet, and the rule would then silently answer null. The acts feed it `CoordStore#delegationRunStampsNaming(parentId)` (PR8), the same five columns over EVERY run, open or closed, whose `sessionId` is the lease's parent, with no limit (the rows one session ever named), so the answer does not depend on how many runs closed since (`D-7818`). The frame's R9 nesting keeps its bounded read; inside the window the two agree (W5-R3b), and past it the acts still name the coordinator (W5-R3c).
- (b) The digest goes to the worker with Retain only, and a second one to the coordinator with promote.
- (c) The spec as written: the worker gets everything, and only the worker may Retain.
- **Recommended: (a).** One claimant rule for both acts, and the worker skill's clauses stay untouched. If it is wrong, a worker has to ask its coordinator by mail to keep its own tree.
- **Ruled 2026-11-04: (a)** (`D-7843`).
- **Blocks:** Task 5.7.3 (addressing), Task 5.8.1 (the Retain claimant rule), Task 5.9.2 (the promote claimant rule).

**O5-5. Where `executionOrigin` and `promotedLeaseId` live.** Spec §5.2's "one coord.db migration; later waves ship code only" was written about the `delegation_*` tables, and the scope decision "does not approve ... durable migration". `runs` has no column for either field, and crash recovery needs a read of runs by lease.
- (a) One additive nullable column `runs.promotedLeaseId` (the next free `server/src/coord/schema.ts#MIGRATIONS` slot, re-measured; 38 on `0c95592bc`), with `executionOrigin` derived from it. An older server reads a higher `user_version` as is (`server/src/coord/db.ts`: a rollback may only refuse to migrate, never to read).
- (b) No column: a `run_events` row at open time plus the promotion journal entry, read back by `hydrateRun`.
- **Recommended: (a).** `runs` is the runs authority and the projection gets one reader. (b) makes every run summary depend on event scans and on the delegation lane being ready.
- **Ruled 2026-11-04: (a)** (`D-7844`).
- **Blocks:** Tasks 5.9.1 and 5.9.4.

**O5-6. Words for the PWA controls.** W4-U10 forbids exported strings containing `lease`, `adopt`, `retain`, `clean` or `spool`; "the operator's word is worktree".
- (a) Keep the census closed: "Keep worktree" (operator-retain), "Attach to…" (attach), "Not delegated" (foreign), "kept until <date>" (expiry), "worktree kept" (the adopted disposition), "moved to a run" (promoted).
- (b) Open `retain` (and `adopt`) on purpose and amend W4-U10.
- **Recommended: (a).** If it is wrong, the cost is copy edits later; (b) reopens a vocabulary the operator set.
- **Ruled 2026-11-04: (a)** (`D-7845`).
- **Blocks:** Task 5.10.1.

**O5-7. The stage-4 gate's surviving condition, "0 adoptions the independent reader classifies wrong".** The soak is waived, so no reader is named. "Adoption only for fixture-proven correlation classes" stays a CI corpus condition either way.
- (a) While `$REG/delegation-adopt` is absent, the lane computes decisions and records "would adopt" observations in health counts and one lane log line per lease, with no carrier change, no mail and no feed row. The operator reads them, then touches the marker; that hand touch is the gate.
- (b) Marker absent means nothing is computed; the operator's touch alone is the gate.
- **Recommended: (a).** It gives the independent reading without a timed soak and is never presented as one.
- **Ruled 2026-11-04: (a)** (`D-7846`).
- **Blocks:** Task 5.7.3's marker-absent arm and the "## Gate" text.

**O5-8. How an UNOWNED tree with NO lease is attached or disowned (spec §5.14).** On `main`, `delegation_leases.activityId` is `TEXT NOT NULL REFERENCES delegation_activities(activityId)` and `parentId`/`parentIncarnation` are `NOT NULL` (`server/src/coord/schema.ts`), and `server/src/coord/delegation-checkpoint.ts#assertDelegationCheckpointProjectable` refuses a lease whose activity has no row and, through its `needSession`, a lease whose (parent, incarnation) has no session row. A lease whose activity id names no activity, or a lease with no parent, is therefore unprojectable, and the commit that writes it fails. Spec §5.2 rules out a migration on `delegation_*`. A synthetic activity does not escape this, measured on `main`: (1) `delegation_activities.sourceKind` is `TEXT NOT NULL CHECK (sourceKind IN ('agent', 'workflow', 'bash-worktree'))` in `server/src/coord/schema.ts` (only the LEASE table admits `attached`), so the SQLite projection inside `commitLocked` refuses an `attached` activity row, which `validateDelegationCheckpoint` and `assertDelegationCheckpointProjectable` never see; (2) `shared/api.ts#DELEGATION_ACTIVITY_SOURCE_KINDS` is closed, read as a member check by `delegation-checkpoint.ts`'s activity codec (`f.member('sourceKind', DELEGATION_ACTIVITY_SOURCE_KINDS)`), by `delegation-model.ts` (which refuses any other source) and by `encodeDelegationNaturalKey`; (3) `delegation-model.ts#WAVE3_LEASE_SOURCE_KINDS` keeps `attached` out of `validateLeaseRequest`, and `leaseSourceKindOfActivity` maps no activity source to `attached`; (4) activities are folded only from `evidence-accepted` entries, so a synthetic activity needs a new journal entry kind, and `tree-resolved` is another. Every one of these is grammar a server from PR5a to PR7 refuses ("not in the closed grammar"), so any rollback below the PR that writes them, the server box's unattended `ccrc-update-watchdog` rollback of a failed update included, leaves the applier `reconstructing` for good (the wedge `D-7809` exists to prevent). This touches the checkpoint's identity invariants and the durable schema, so it is the operator's.
- (a) **Attach** mints, in the same commit, a synthetic activity row (a new activity source `attached`, natural key `attached:<treeKey>`), the parent's session row when it has none, the lease (source `attached`) and its move to `retained`; **foreign** journals a tree-keyed `tree-resolved {treeKey, project, adminRecord, action:'foreign', at}`. Needs: a `delegation_activities` CHECK migration (against §5.2 and the scope decision's "does not approve ... durable migration"), `attached` added to `DELEGATION_ACTIVITY_SOURCE_KINDS` and `leaseSourceKindOfActivity`, a new journal kind for the synthetic activity, the `tree-resolved` kind, and a reader-only PR8a carrying every one of them, rolled out a release ahead of PR8b's writers (the Gate's rollback floor moves to PR8a).
- (b) Both acts as tree-keyed `tree-resolved` entries (`action: 'attach' | 'foreign'`, `parentId`/`parentIncarnation` for attach), with no lease for either; an attached tree is then held and shown from that entry, so the orphan hold and the frame each gain a second, tree-keyed reader. Needs no migration, but needs the `tree-resolved` kind in a reader-only PR8a a release ahead of its writer, as (a) does.
- (c) Defer both tree doors past wave 5. Wave 5 acts on LEASES only: a lease is kept, attached (raw) or released `foreign`; an unowned row whose tree holds an unreleased lease the projection hid for a conflict carries that lease's id (`DelegationUnownedWire.leaseId?`, PR8) and offers that lease's resolve; an unowned row with no lease shows no control.
- **Recommended: (c).** It needs no migration and no new journal kind, entry or source word, so the rollback floor stays PR5a and every PR8 write is grammar PR5a already folds. (a) cannot be built without that migration (the CHECK constraint refuses its activity row), and both (a) and (b) add a reader-first release. If (c) is wrong, an unowned tree with no lease stays shown with no control until a later wave, and the orphan ladder's own rungs decide it, as on `main`.
- **Ruled 2026-11-04: (c)** (`D-7847`).
- **Blocks:** under (a) or (b) only: the tree arms of Task 5.8.1 (`attach-tree`, `disown-tree`), Task 5.8.2 (`attachTree`, `disownTree`, W5-R7's tree cases, W5-R8's unowned case, W5-R12, W5-R12f), PR8a, and PR10's no-lease unowned-row controls. Under (c) none of these is built; the lease arms, the hidden-lease resolve (W5-R8d) and PR10's `leaseId` controls proceed either way.

## Review Focus

1. **Carrier and index files that are absent, unreadable, malformed, symlinked or a generation behind** each map to their own answer: a proven ENOENT is "no lease", anything else is `unmeasured` and the orphan rung refuses; one corrupt carrier blocks one tree, never the lane (W5-L14, W5-L15, W5-O3, W5-O4, W5-K6; mutants W5-LM9, W5-OM2, W5-KM3).
2. **Tree identity inputs:** admin record names that start with `-` or hold `@+`, a symlink anywhere on the path, a reused path with a new fingerprint, the containing-checkout carve-out (a direct `.claude/worktrees/<name>` or `.superpowers/worktrees/<name>` child of the main checkout or of any linked checkout, a ccd workspace included) against every other containment, nested worktrees both ways, a locked tree, `CLAUDE_BASE` absent or disagreeing with the first `logs/HEAD` line, a SHA-256 repository (W5-L4 to W5-L13, W5-AU4, W5-B3; mutants W5-LM1 to W5-LM8).
3. **Terminal evidence and parent death:** a missing `SessionEnd`, a SubagentStop alone, a paused workflow, an `unknown` status, an absent `.generation`, a bulk incarnation change (the breaker trips and adoption only waits), a supervisor inside its restart window; none of these ends an activity, writes `unknown` or adopts (W5-D3 to W5-D9; mutants W5-DM2 to W5-DM5).
4. **Crash and replay at every durable edge:** journal, checkpoint, mark and read-back with a lost answer (an identical rewrite answers `unchanged`); a carrier two or more generations behind the journal catching up; the index written before the carrier; promotion killed between each pair of its four steps, and a child that exists while its run names no session; compaction after a transition; a digest owed across a restart, a crash between the transition and the mail, and a lifted `mail-disabled` (W5-L17, W5-L3, W5-L23, W5-J9, W5-J10, W5-K4, W5-K3b, W5-Q3, W5-Q3b, W5-Q4, W5-P8 to W5-P11, W5-P14b, W5-P14d; mutants W5-LM11, W5-LM19, W5-JM5, W5-PM5, W5-PM6).
5. **Mixed versions and capabilities:** a fleet box without `lease-mark-v1`, `lease-audit-v1`, `ws-add-base-v1` or `orphan-lease-v1` defers as `unsupported`, a server rolled back to the reader-only build (PR5a, or PR8a under O5-8 (a)/(b)) recovers a journal holding every kind, entry field and source word a later PR writes to `ready`, a missing audit counts as changed, promotion refuses and never falls back to a plain `ws-add`, PR9a's build refuses every promoting fresh spawn (a bound session still resumes) and still recovers a crashed transfer; an old server with a new fleet writes no carrier and the orphan rung stays inert; an older PWA given the new fields renders byte for byte (W5-K2, W5-D10, W5-P6, W5-O7, W5-U1; mutants W5-KM1, W5-PM3, W5-UM1).

## Landing order and rollout

1. **PR1 (F1, the lease library and `ws-lease-mark`)**, after wave-4 PR4 merges (the same `ccd/contexts.tsv`, `ccd/contexts-edges.tsv` and installer neighbourhood), or after merging `main` and re-pointing by content.
2. **PR2 (F2, `ws-lease-audit`)** after PR1 (it reads carriers through PR1's reader); **PR3 (F3, `ws-add --base`)** in parallel with PR2, after wave-4 PR4 and after PR1 merges (`D-7848`).
3. **PR4 (F4, the orphan-lane skip)** after PR1, with the orphan lane owner's consent. It must merge AND roll out before any server PR can move a carrier off `ephemeral` (PR7, PR8, PR9).
4. **Fleet rollout.** The operator runs `ccrc rollout` (fleet box first by default) or the console's tap. The coordinator measures it with `ccrc version` or `GET /api/updates`, and reads the box's capability words from `/api/fleet/health`; a merge is never deployment proof. The server learns `lease-mark-v1`, `lease-audit-v1` and `ws-add-base-v1` from the agent's cached `ccd caps` at boot.
5. **PR5a (S1a, the reader-only journal kinds)** after wave-4 PR3 merges and after PR1 merges (`D-7848`: PR5a imports PR1's `DELEGATION_CARRIER_STATES`): the server parses the three new kinds and folds them, but no door writes them. It merges AND rolls out to the server box, and stays there for at least one release, before **PR5b (S1b, the doors, transitions and release)** may merge. From PR5b on, the server floor for any rollback (`ccrc rollback`, the server box's unattended `ccrc-update-watchdog` rollback, a hand flip to a kept version) is the PR5a build: an older server refuses the journal's closed grammar and stays `reconstructing` for good. **PR6 (S2, carriers)** after PR5b. **PR8 (S4, Retain and resolve)** after PR6; it ships `ccd/ccrc-api` too, so it rolls out fleet box first. Under O5-8 (c) (recommended) PR8 writes only grammar PR5a folds (the `lease-transition` and `lease-released` kinds with their `resolvesThrough` field), so the floor stays PR5a. Under O5-8 (a) or (b), PR8 splits like PR5: a reader-only **PR8a** (every new kind, entry field, source word and checkpoint member PR8 writes, with no writer) merges and rolls out to the server box and stays a release before **PR8b** (the tree doors) may merge, and the floor becomes PR8a. **PR7 (S3, adoption and digest)** after PR8, because its digest names the Retain command. **PR9 (S5, promotion)** is wave 5b (`D-7940`): it is dispatched after the rest of wave 5 has landed and been used, when the operator says so, and still after PR7 and PR8, split like PR5 (`D-7808`): a reader-and-recovery **PR9a** (the `runs.promotedLeaseId` column and its readers, transfer recovery, and a `base-unsupported` refusal of a fresh-spawn dispatch of a run carrying the field, the resume of a bound session proceeding) merges, rolls out to the server box and stays there a release before **PR9b** (the `promotesLease` gate at `POST /api/runs` and the dispatch arm) may merge. Once any run carries `promotedLeaseId` or any lease has been transferred, the server floor is PR9a: an older server would dispatch a planned promoting run as a plain `ws-add --child` at origin's base, and would leave a crashed transfer `transferring` for good. **PR10 (P1, the PWA controls)** after the visibility release, PR7 and PR8.

Every server PR is safe dark: its act needs a capability the box reports (`capSupported`, refuse on no evidence) or the hand-touched marker. Every server act that moves a lease off `ephemeral` (PR7's adopt, PR8's doors, PR9's transfer) also needs `orphan-lease-v1`, the word PR4's box rung prints, so a fleet box that went back below PR4 stops new holds instead of leaving adopted trees to the server skip alone. Reverts go in reverse order, and never take the server box below the newest reader build (PR5a, or PR8a under O5-8 (a)/(b), or PR9a once a run carries `promotedLeaseId` or a lease has been transferred) once a writer after it has written what it reads. PR4 is never reverted while any carrier stands off `ephemeral`: disabling it is the wrong safety direction, which is why it has no marker. Each PR lands with `gh pr merge <n> --match-head-commit <handoffCommit>` after accepted exact-tip review, required CI and dependency clearance; the native merge queue stays required; never an admin bypass. Rollout is the operator's; workers and the coordinator never roll a box.

**Task 0 (the coordinator's, before PR7 is dispatched).** Re-read the fleet's Claude Code lane versions and capture any the correlation corpus lacks, on the fleet box only (spec §8.1; real-lane captures never leave the fleet box). Name the then-current wave-4 PR3 and PR4 hunks in each brief as owned until they merge.

## Gate

**Soak status: waived on 2026-10-28, not passed.** There is no window, T0 or restart.

**Rollback floor: the newest reader build.** Once PR5b's doors have journalled a `lease-transition`, `lease-released` or `lease-carrier-seen`, no server box may run a build older than PR5a. Under O5-8 (c) PR8 adds no grammar, so PR5a stays the floor. Under O5-8 (a) or (b), once PR8b has journalled a tree-door entry, no server box may run a build older than PR8a. Once PR9b has opened a run carrying `promotedLeaseId` (or journalled a `transfer`), no server box may run a build older than PR9a (`D-7808`): below it a planned promoting run dispatches as a plain `ws-add` and a crashed transfer has no recovery. This floor holds for the server box's unattended `ccrc-update-watchdog` rollback too, so PR9a must stay a kept version on that box. The coordinator measures the server box's version before each writer PR merges (`GET /api/updates`), and that PR's release notes and body say so. A rule for every later PR: a new journal kind, entry field, source word, checkpoint member, or a run field an older dispatch would ignore, ships first in a reader-only build that is rolled out and kept a release, and that build becomes the floor.

What still verifies: implementation completeness, dependency and ownership clearance, accepted exact-tip review, required CI and the full native merge queue, release and both-box rollout verification, and truthful run closure. "Adoption only for fixture-proven correlation classes" is a CI condition: Task 5.7.2's corpus row (W5-D12) refuses a source kind or Claude Code version the corpus does not cover. Under O5-7's recommendation, the operator reads the lane's "would adopt" observations (health counts and log lines) and touches `$REG/delegation-adopt` by hand; that touch is the gate, and it is never described as a soak. An operator report of a wrong adoption names the lease and is routed through normal correction; its correction starts no observation clock.

## PR1: F1, the lease library, the carrier and `ws-lease-mark`

**Goal.** The fleet box can write and read one carrier per lease at `$REG/delegation/leases/<leaseId>.json` through one server-composed verb, `ccd ws-lease-mark`, which refuses every tree spec §5.10 refuses and is generation-strict, flocked and atomic. The server gets only the argv builder and its capability row; nothing calls it yet.

**Branch and base.** A fresh workspace branch from `main`, after wave-4 PR4 merges (or `main` merged in and PR4's `contexts.tsv`, `contexts-edges.tsv` and installer hunks re-pointed by content). PR-body first line as in Global Constraints.

**Deploy class.** FLEET (ccd, its new library, the hook's deny lists, the installer, the agent's grant). The server side is dark: a builder and a `CCD_CAN` row with no caller.

**Files.**
- Create `ccd/lib/delegation-lease.sh` (region `@ccd-lib:lease`): the leases-directory maker, the carrier reader and writer, the per-tree index, the tree resolver, the creation-base reader, the fingerprint and `cmd_ws_lease_mark`.
- `ccd/ccd`: the pin line `__CCD_LIB_LEASE_SHA256=stamp-at-install`; `ccd/ccd#_ccd_lib_load`'s file and pin arrays and its every-pin-a-placeholder test; the `ws-lease-mark)` dispatch arm and its `usage:` entry; `ccd/ccd#cmd_caps` (`echo lease-mark-v1; echo ws-lease-mark`); the direct-entry guard at the top of `ccd/ccd` (one more `"${1-}" == ws-lease-mark` alternative on the existing line).
- The library's arrival sites (the #1897 recipe): `ccd/ccd-entry-install.py`, `ccd/ccd-entry.py` (the `folds_to` tuple and its header table), `ccd/ccrc`, `deploy/deploy.sh`, `ccd/contexts.tsv`, `ccd/contexts-edges.tsv`; tests `server/test/ccdWsHelpers.ts`, `server/test/installTreeFixture.ts`, `server/test/ccd-lib-load.test.ts`, `server/test/ccd-entry-install.test.ts`, `server/test/ccd-install-stamp.test.ts`, `server/test/ccd-harness-integrity.test.ts`, `server/test/ownership.test.ts`, `server/test/build-release.test.ts`, `server/test/ccrc-uninstall.test.ts`, `server/test/consolidationCensus.ts`, `server/test/install-census.test.ts`, `agent/test/deploy-verify.test.ts`, `agent/test/ccd-entry-exec.test.ts`. (The list is `git grep -l -e CCD_TRAIN_LIB -e __CCD_LIB_TRAIN_SHA256 -e 'train-proof\.sh' origin/main -- . ':!docs'` on `0c95592bc`; re-run it at dispatch and add the lease twin at every site it prints, `README.md` included.)
- `agent/src/whitelist.ts`: `EXEC_WHITELIST`'s `ccd:` list gains `['ws-lease-mark','--lease']`; `REQUIRED_VERB_FLAG` gains `'ws-lease-mark': '--lease'`. Create `agent/test/types/bypasses/g25-ws-lease-mark-without-lease.ts`. Modify `agent/test/whitelist-structural.test.ts` and `agent/CLAUDE.md`.
- `shared/api.ts`: the carrier vocabulary block (Task 5.1.1), placed after `DelegationProjectionWire`; `CHILD_DENY_CCD_VERBS` gains `ws-lease-mark`.
- `server/src/ccdargv.ts`: `LEASE_MARK_CAP`, `CCD_ARGV.leaseMark`, `CCD_CAN.leaseMark`.
- `server/src/coord/approvalguard.ts#FORBIDDEN_CCD_VERBS` gains `ws-lease-mark`; `ccd/session-hook.sh` `APPROVAL_FORBIDDEN_JQ`'s two verb lists gain it (in place on their lines, no growth); `ccd/install-session-hooks.sh`'s child-deny loop gains it.
- `CLAUDE.md`: a SAFETY entry for `ws-lease-mark` beside `ws-reclaim`, and the coordination-invariant sentence of spec §13 naming `ws-lease-mark` (PR2 and PR3 add their verbs to it).
- Tests: create `server/test/ccd-ws-lease-mark.test.ts`; modify `server/test/ccdCapTokens.ts#CCD_CAPABILITY_TOKENS`, `server/test/verb-gate.test.ts`, `server/test/whitelist-subset.test.ts`, `server/test/id-argv-census.test.ts`, `server/test/ccd-spawn-child-settings.test.ts`, `server/test/delegation-wave3.integration.test.ts` (§8), `server/test/single-definition/vocabularies.test.ts`.

**Why here.** Carriers are the box-side record the orphan rung (PR4), the audit (PR2) and every server act read. Nothing on the server writes a carrier until PR6, so PR1 can ship and roll out with no behaviour change: a box that advertises `lease-mark-v1` to a server that never asks for it.

**Interfaces.**
- **Consumes** (on `main`): `ccd/ccd#_ws_path_ident`, `#_ws_common_dir`, `#_ws_reclaim_gitdir_own`, `#_ws_reclaim_contained`, `#_ws_reclaim_fingerprint`, `#_json_str`, `#_plat_mv_notdir`, `#_reg_get`; `ccd/ccd#_ws_reclaim_plain_path`; `ccd/lib/disk-retention.sh#_ws_orphan_stanzas`, `#_ws_orphan_registered`, `#_ws_orphan_class`; `server/src/ccdargv.ts#capSupported`, `#capRow`, `#argv`; `shared/api.ts#DELEGATION_DISPOSITIONS`, `#DelegationLeaseSourceKind`.
- **Produces**, consumed by PR2, PR4, PR6, PR7, PR8, PR9:

  ```ts
  // shared/api.ts
  export const DELEGATION_CARRIER_STATES = [...DELEGATION_DISPOSITIONS, 'transferring', 'released'] as const;
  export type DelegationCarrierState = (typeof DELEGATION_CARRIER_STATES)[number];
  export function isDelegationCarrierState(v: unknown): v is DelegationCarrierState;
  export const DELEGATION_LEASE_RELEASE_REASONS = ['native-removed', 'transferred', 'foreign'] as const;
  export type DelegationLeaseReleaseReason = (typeof DELEGATION_LEASE_RELEASE_REASONS)[number];
  export function isDelegationLeaseReleaseReason(v: unknown): v is DelegationLeaseReleaseReason;
  /** `ws-lease-mark`'s refusal words, the server's one reader of them. */
  export const LEASE_MARK_REFUSALS = ['usage', 'unmeasured', 'busy', 'bad-carrier', 'stale-generation', 'generation-conflict',
    'not-under-projects-root', 'no-tree', 'symlink', 'main-worktree', 'locked', 'registered', 'nested', 'tree-held',
    'fingerprint-mismatch'] as const;
  export type LeaseMarkRefusal = (typeof LEASE_MARK_REFUSALS)[number];

  // server/src/ccdargv.ts
  export const LEASE_MARK_CAP = 'lease-mark-v1';
  export interface LeaseMarkArgs {
    leaseId: string; generation: number; project: string; adminRecord: string; parentId: string; parentIncarnation: string;
    activityId: string; source: DelegationLeaseSourceKind; state: DelegationCarrierState; journalSeq: number;
    expiresAtMs: number | null; releaseReason: DelegationLeaseReleaseReason | null;
    promoted: { runId: number; sessionId: string } | null;
  }
  // CCD_ARGV.leaseMark: (a: LeaseMarkArgs) => CcdArgv   (throws on a value the verb would refuse as usage)
  // CCD_CAN.leaseMark: capRow(LEASE_MARK_CAP)
  ```

  ```bash
  # ccd/lib/delegation-lease.sh
  __DL_LEASE_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  __DL_CARRIER_MAX=16384      # bytes; a larger carrier is malformed, never read
  _dl_leases_dir()        # -> prints $REG/delegation/leases after making it, .locks/ and by-tree/ (0700); rc 1, nothing made, when
                          #    $REG/delegation or any of the three is a link or a non-directory
  _dl_carrier_read()      # <leaseId> -> rc 0 with DL_C_<field> set (DL_C_generation, DL_C_state, DL_C_fingerprint, DL_C_expiresAt,
                          #    DL_C_canonicalPath, DL_C_journalSeq, DL_C_parentId, DL_C_parentIncarnation, DL_C_body);
                          #    rc 3 PROVEN absent (no entry, no link); rc 4 anything else (link, non-regular, oversize, unreadable,
                          #    malformed JSON, a field out of grammar), DL_WHY set
  _dl_tree_key()          # <common-dir ident> <admin record> -> prints the 64-hex by-tree key (sha256 of the two, length-prefixed)
  _dl_tree_owner()        # <key> -> rc 0 DL_OWNER=<leaseId>; rc 3 proven absent; rc 4 unreadable/malformed/link
  _dl_tree_of_record()    # <main> <admin record> -> rc 0 DL_TREE (physical) DL_ADMIN DL_COMMON; rc 3 no record or no gitdir; rc 4 unreadable
  _dl_creation_base()     # <admin dir> -> prints CLAUDE_BASE's id if it is one 40/64-hex line, else the new id of logs/HEAD's first line; rc 4
  _dl_fingerprint()       # <common> <record> <admin> <tree> <base> -> prints 64 hex over named lines (mode=lease-mark first); rc 4 unmeasured
  cmd_ws_lease_mark()     # the verb -> ONE JSON line on stdout; rc 0 written|unchanged, 1 refused, 2 usage
  ```

**Rulings this PR implements.** Spec §2 ruling 7 and 8, R8; D-7002 (no `.reaped/` tombstones, no `lease-clean*` word). O5-3 decides row W5-L8.

**Shape decisions (each a deviation, defined in "## Deviations found").** The library, not `ccd/ccd` (`D-7798`); the per-tree index (`D-7799`); `--admin-record-hex` (`D-7800`); the containing-checkout carve-out (`D-7801`); a generation above the stored one is accepted (`D-7802`); the by-tree index written before the carrier (`D-7803`); `expiresAt` and `releaseReason` carrier fields and no `branchCreatedByLease` (`D-7823`); an identical same-generation rewrite answers `unchanged` (`D-7824`); a `released` mark whose admin record is gone skips the tree checks (`D-7825`); a by-tree entry is re-pointed only from an absent or non-holding carrier, and a `released` mark with no carrier clears the entry naming its lease (`D-7804`, `D-7805`).

### Task 5.1.1: The carrier vocabulary, and the scope census rewritten to wave 5's allow-list shape

**Files.** `shared/api.ts` (new block after `DelegationProjectionWire`, never in the comments the visibility release edits); `server/test/single-definition/vocabularies.test.ts`; `server/test/delegation-wave3.integration.test.ts`, describe "8. the closed scope census".

**Interfaces produced.** The `shared/api.ts` block above, consumed by every later PR. The census constants `W5_OPEN`, `STILL_CLOSED`, `W5_FLEET_LEASES` below, which every later PR edits by adding file names to a row (never a pattern).

- [ ] **Step 1: RED, the vocabulary rows (W5-V1, W5-V2).** In the wave-3 describe "delegation wave 3: the closed vocabularies are declared once, in shared/api.ts", add two entries to its table in that table's own shape: `DELEGATION_CARRIER_STATES` with members `['ephemeral','adopted','retained','promoted','transferring','released']`, and `DELEGATION_LEASE_RELEASE_REASONS` with `['native-removed','transferred','foreign']`; bump the length assertion from 11 to 13. Add one row:

  ```ts
  it('W5-V2: the carrier states are derived from the dispositions, never a second spelling of them', () => {
    const src = read('shared/api.ts');
    expect(src).toMatch(/DELEGATION_CARRIER_STATES = \[\.\.\.DELEGATION_DISPOSITIONS, 'transferring', 'released'\] as const;/);
    expect(DELEGATION_CARRIER_STATES.slice(0, DELEGATION_DISPOSITIONS.length)).toEqual([...DELEGATION_DISPOSITIONS]);
    expect(src.match(/'ephemeral', 'adopted', 'retained', 'promoted'/g) ?? []).toHaveLength(1);
  });
  ```

- [ ] **Step 2: RED, the census rewrite (W5-SC1).** Replace `LATER_WAVE` with an allow-list table and a closed remainder, so the same text is green on every wave-5 branch:

  ```ts
  /** Wave 5's opened words, each with the ONLY shipped files that may hold it (allow-list: a listed file need not hold it).
   *  A wave-5 PR adds files to a row; it never adds or widens a pattern. Wave 6 and 7's words stay in STILL_CLOSED (D-7002). */
  const W5_OPEN: readonly (readonly [string, RegExp, readonly string[]])[] = [
    ['ws-lease-mark', /\bws-lease-mark\b|\bcmd_ws_lease_mark\b|\blease-mark-v1\b/, [
      'ccd/ccd', 'ccd/lib/delegation-lease.sh', 'ccd/ccd-entry.py', 'ccd/session-hook.sh', 'ccd/install-session-hooks.sh',
      'agent/src/whitelist.ts', 'server/src/ccdargv.ts', 'server/src/coord/approvalguard.ts', 'shared/api.ts']],
    ['ws-lease-audit', /\bws-lease-audit\b|\bcmd_ws_lease_audit\b|\blease-audit-v1\b/, []],
    ['ws-add --base', /\bws-add-base(?:-v1)?\b|ws-add\s+--base/, []],
    ['delegation/leases', /delegation\/leases/, ['ccd/lib/delegation-lease.sh']],
    ['delegation-adopt', /delegation-adopt/, []],
    ['promotesLease', /\bpromotesLease\b/, []],
  ];
  const STILL_CLOSED = /\bws-lease-clean\b|\bcmd_ws_lease_clean\b|\blease-clean(?:-v1|-live)?\b|cleanup-queue/i;
  /** The fleet-side files allowed to hold the bare word `leases` (a path composed from parts has no token for W5_OPEN). */
  const W5_FLEET_LEASES = ['ccd/lib/delegation-lease.sh'];
  ```

  Widen `SHIPPED` and `FLEET_SIDE` with `...filesUnder('ccd/lib')` (today a lease door in a library would be invisible). The row becomes: for each `W5_OPEN` entry, the files of `SHIPPED` that match it are a subset of its list; no `SHIPPED` file matches `STILL_CLOSED`; the `FLEET_SIDE` files holding `\bleases\b` are a subset of `W5_FLEET_LEASES`; `_delegation_spool_dir demo-quiet-mesa` still leaves `$REG/delegation` holding exactly `['spool']` (the leases directory is made by the verb only, never at a spawn); `LATER_WAVE_NAME` is replaced by `STILL_CLOSED` for the registry walk; and the `cmd_caps` family row (its filter `/(^|-)lease|delegation|adopt|carrier/i` matches the verb words `cmd_caps` prints beside the cap words) expects a subset of `['delegation-events-v1','lease-mark-v1','ws-lease-mark','lease-audit-v1','ws-lease-audit','ws-add-base-v1','orphan-lease-v1']` that contains `delegation-events-v1`. The row "no cleanup or audit token, queue or executor" keeps its `CLEANUP` pattern unchanged: no wave-5 identifier matches it (the promotion's evidence field is `auditEvidence`, never `auditToken`, PR5b; the audit's JSON key is `token`, PR2).

  The RED is a behaviour of the shipped-tree scan, not a missing helper. First, before any rewrite, add W5-SC0: a fixture tree (a temp copy of the scan's inputs, `ccd/lib/` included) holding a synthetic `ccd/lib/other.sh` that names `ws-lease-mark`; run `main`'s census over it: it reports no offender, because `main`'s `SHIPPED` and `FLEET_SIDE` never list `ccd/lib` (the row records that miss as the RED). Then the rewritten census over the same fixture names `ccd/lib/other.sh` as an offender of the first `W5_OPEN` entry (the CONTROL row), and stays green on the real tree while each opened word appears only in its listed files.

- [ ] **Step 3: Run RED.**

  ```
  cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/single-definition/vocabularies.test.ts
  cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/delegation-wave3.integration.test.ts
  ```

  Expected: W5-V1 fails (13 expected, 11 found) and W5-V2 fails (no `DELEGATION_CARRIER_STATES` export); W5-SC1's CONTROL row fails because `main`'s census does not scan `ccd/lib` (W5-SC0's miss). Mutant W5-SCM1: drop `...filesUnder('ccd/lib')` from the rewritten `SHIPPED`; the CONTROL row turns red again (measured on a saved copy, restored by sha).

- [ ] **Step 4: Implement** the `shared/api.ts` block in the shape of Interfaces, each list with its guard (`typeof v === 'string' && (LIST as readonly string[]).includes(v)`), and the census table and helper as written.

- [ ] **Step 5: Run GREEN**, Step 3's commands, then `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/rings/wire-totality.test.ts` and `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/rings/shared-imports.test.ts`. Expected: all green.

- [ ] **Step 6: Commit** `feat(delegation): the carrier vocabulary and wave 5's scope census allow-lists`, with the attribution trailer.

### Task 5.1.2: The lease library arrives, empty but loaded, installed and pinned

**Files.** Create `ccd/lib/delegation-lease.sh` with its header (what it holds, that it is a library of `ccd` and is loaded only by `ccd/ccd#_ccd_lib_load`, and that it carries the workspace-lifecycle verbs of the delegation broker, server-composed only) and `_dl_leases_dir`. Every arrival site in this PR's file list.

- [ ] **Step 1: RED rows.**
  - **W5-A1** (`server/test/ccd-ws-lease-mark.test.ts`, its first describe): a source checkout loads the library.

    ```ts
    it('W5-A1: a source checkout loads the lease library beside the other two', () => {
      expect(h.sh('declare -F _dl_leases_dir >/dev/null && echo defined').trim()).toBe('defined');
    });
    it('W5-A1b: the leases directory is made 0700 with .locks and by-tree, and refused through a link', () => {
      const reg = path.join(h.home, '.cc-sessions');
      expect(h.sh('_dl_leases_dir; echo "rc=$?"').trim().split('\n').pop()).toBe('rc=0');
      expect(fs.readdirSync(path.join(reg, 'delegation', 'leases')).sort()).toEqual(['.locks', 'by-tree']);
      expect(fs.statSync(path.join(reg, 'delegation', 'leases')).mode & 0o777).toBe(0o700);
      fs.rmSync(path.join(reg, 'delegation'), { recursive: true });
      const elsewhere = fs.mkdtempSync(path.join(h.home, 'elsewhere-'));
      fs.symlinkSync(elsewhere, path.join(reg, 'delegation'));
      expect(h.sh('_dl_leases_dir; echo "rc=$?"').trim().split('\n').pop()).toBe('rc=1');
      expect(fs.readdirSync(elsewhere)).toEqual([]);
    });
    ```

  - **W5-A2** (`server/test/ccd-lib-load.test.ts`): in the file's missing-library and digest cases, one row each for `lib/delegation-lease.sh`: absent refuses `lib-missing`; a rendered pin with a tampered body refuses `lib-digest`; a body with every pin a placeholder and line 2 the placeholder is `source`.
  - **W5-A3** (`server/test/ccd-entry-install.test.ts`, `server/test/ccd-install-stamp.test.ts`): the installer renders `__CCD_LIB_LEASE_SHA256` to the sha256 of the shipped library, and leaves no placeholder.
  - **W5-A4** (`server/test/install-census.test.ts`, `server/test/build-release.test.ts`, `agent/test/deploy-verify.test.ts`, `server/test/ccrc-uninstall.test.ts`): the release tree, the install and the uninstall name `ccd/lib/delegation-lease.sh` exactly as they name `ccd/lib/train-proof.sh`.

- [ ] **Step 2: Run RED.**

  ```
  cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/ccd-ws-lease-mark.test.ts
  cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/ccd-lib-load.test.ts
  ```

  Expected: W5-A1 fails (`_dl_leases_dir` undefined) and W5-A2 fails (no third library in the arrays).

- [ ] **Step 3: Implement.** Add the pin line next to `__CCD_LIB_TRAIN_SHA256`, the third entries of `__ccd_lib_files` and `__ccd_lib_pins` in `ccd/ccd#_ccd_lib_load`, and `&& "$__CCD_LIB_LEASE_SHA256" == stamp-at-install` in its source-checkout test. Add the twin at every arrival site. `_dl_leases_dir` makes each level with `mkdir -m 0700` only after `[[ ! -L "$d" ]]` and, when it exists, `[[ -d "$d" && ! -L "$d" ]]`, exactly as `ccd/ccd#_delegation_spool_dir` refuses a link at `$REG/delegation` (the same no-link rules; the spool maker itself is unchanged).

- [ ] **Step 4: Run GREEN**, Step 2's commands, then each of `ccd-entry-install`, `ccd-install-stamp`, `ccd-harness-integrity`, `ownership`, `install-census`, `build-release`, `ccrc-uninstall` alone in `server`, and `cd agent && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/deploy-verify.test.ts`. Expected: all green.

- [ ] **Step 5: Commit** `feat(ccd): the delegation lease library arrives, pinned and installed beside the other two`.

### Task 5.1.3: The carrier, the box-side fingerprint and `ws-lease-mark`

**Files.** `ccd/lib/delegation-lease.sh`; `ccd/contexts.tsv` (one `C4` row per new function, in definition order: spec §2 ruling 7 makes these workspace-lifecycle verbs, `ccd/contexts.tsv`'s C4 is "Workspace Lifecycle", and every helper they call, `_ws_path_ident`, `_ws_common_dir`, `_ws_reclaim_gitdir_own`, `_ws_reclaim_contained`, `_ws_reclaim_fingerprint`, `_ws_reclaim_plain_path`, `_ws_gc_dirty`, `_ws_path_users_many`, `_ws_cwd_users` and the orphan helpers, is C4 on `main`); `ccd/contexts-edges.tsv` (only the true cross-context calls: `_reg_get` (C1) and `_child_runid_valid` (C5), each from the lease function that makes it, re-measured with `ccd-contexts.test.ts`'s own edge walk; `K` helpers such as `_json_str` and `_plat_mv_notdir` need no row); `server/test/ccd-ws-lease-mark.test.ts`.

**The argv grammar.** `ws-lease-mark --lease <uuid> --generation <n> --project <p> --admin-record-hex <hex> --parent <id> --parent-incarnation <uuid> --activity <id> --source agent|workflow|raw|attached --state <carrier state> --journal-seq <n> [--expires-at <epoch-ms>] [--release-reason native-removed|transferred|foreign] [--promoted-run <id> --promoted-session <id>]`. Every flag at most once, each with exactly one value, an explicit arity check before every `shift 2`; the tree is never in argv.

**The rules, in order.** The verb answers the first that fails:
1. **Usage** (rc 2, refusal `usage`): an unknown flag, a repeated flag, a missing value, or a value out of grammar: `--lease` matches `__DL_LEASE_RE`; `--generation` and `--journal-seq` match `^[1-9][0-9]{0,9}$`; `--project` is a single path segment not starting with `-` or `.`; `--admin-record-hex` is even-length lowercase hex whose decoding matches `^[A-Za-z0-9._@+-]{1,255}$` and is not `.` or `..`; `--parent` is a registry id (the shape `ccd/ccd#_reg_id_cap` bounds); `--parent-incarnation` matches `__DL_LEASE_RE`; `--activity` matches `^[A-Za-z0-9._:-]{1,200}$`; `--source` and `--state` are their closed words; `--expires-at` matches `^[1-9][0-9]{0,15}$`; `--release-reason` appears iff `--state released`; `--promoted-run` (`ccd/ccd#_child_runid_valid`) and `--promoted-session` (a registry id) appear together iff `--state promoted`.
2. **Unmeasured** (`unmeasured`): python3 is missing (the `_json_str` probe), or `_dl_leases_dir` fails.
3. **Busy** (`busy`): `flock -n` on `$REG/delegation/leases/.locks/<lease>.lock` (the lock file is never removed). Every later rule runs inside the lock.
4. **The stored carrier** (`_dl_carrier_read`): rc 4 refuses `bad-carrier` and writes nothing. Absent requires `--generation 1`, else `stale-generation`, except a `--state released` request, which rule 5 answers. Stored generation g: a request at g whose body, `markedAt` excepted, is byte-equal to the stored one answers `unchanged`, rc 0, and writes nothing (after rule 12's index check); a request at g with any other body refuses `generation-conflict`; a generation below g refuses `stale-generation`; ANY generation above g is written (`D-7802`). The server marks only at the journal's current generation and the journal alone advances it, so a carrier that missed one or more generations (a refused or lost mark, two transitions in one pass) catches up in one write, and never moves backwards. `generation-conflict` still holds (two bodies at one generation) and `unchanged` still answers a lost reply (the same body at the stored generation).
5. **The tree.** The main checkout is `$PROJECTS_ROOT/<project>`; it must be a directory, not a link, whose physical path is under the physical projects root, else `not-under-projects-root`. `_dl_tree_of_record` reads `<common>/worktrees/<record>/gitdir`. A `released` request with NO stored carrier, tree or no tree, reads the by-tree entry for (common dir, record) inside the lock: when it names this lease (the W5-L23 half-write, then a release before any re-drive), the verb removes that entry, writes no carrier, and answers `index-cleared`, rc 0 (`D-7805`); otherwise it refuses `no-tree` (PR6 composes it only when an entry names the lease); an unreadable entry refuses `unmeasured`. No record or no `gitdir`: a `released` request with a stored carrier skips rules 6-10 and keeps the stored fingerprint (`D-7825`); anything else refuses `no-tree`. Unreadable refuses `unmeasured`.
6. **Symlink** (`symlink`): any component of the tree's path below the root that holds it is a link (`ccd/ccd#_ws_reclaim_plain_path`). That root is the physical projects root for a tree under it (a main checkout's `.claude/worktrees/<name>`), or the physical ccd worktrees root for a tree under it (a ccd workspace's `.claude/worktrees/<name>`); a tree under neither refuses `not-under-projects-root`.
7. **Main worktree** (`main-worktree`): the tree is the main checkout.
8. **Locked** (`locked`): `<admin>/locked` exists (O5-3, recommended (a)). A `released` request skips this rule.
9. **Registered** (`registered`): a registry row's workdir is at, inside or through the tree, or a `.child`-marked row's workdir is (`_ws_orphan_registered`). **Nested** (`nested`): a registry workdir that CONTAINS the tree; another LINKED worktree's root (from `_ws_orphan_stanzas`, keyed on common dir and admin record) inside or containing the tree; another unreleased carrier's `canonicalPath` inside or containing it. The one carve-out is the orphan ladder's own location rule (`ccd/lib/disk-retention.sh#_ws_orphan_class`, fed the stanza checkouts): a containing registry workdir, or a containing linked worktree, passes when the tree is a direct `.claude/worktrees/<name>` or `.superpowers/worktrees/<name>` child of that checkout, which is the main checkout or any linked checkout of the same repository, a ccd workspace included (`D-7801`). Every other containment refuses `nested`. A `released` request skips this rule.
10. **Tree held** (`tree-held`): the by-tree index names another lease whose carrier is in a HOLDING state (`adopted`, `retained`, `transferring`). An entry naming another lease whose carrier is proven absent (`_dl_carrier_read` rc 3: a half-write) or in a non-holding state (`ephemeral`, `promoted`, `released`) is re-pointed at this lease by rule 12, so a reused admin record, or a half-written lease released before its re-drive, never refuses a new lease for good (`D-7804`). An index entry, or the other lease's carrier, that is unreadable or malformed refuses `unmeasured`.
11. **Fingerprint** (`fingerprint-mismatch`): `_dl_fingerprint` over `mode=lease-mark`, `common=<_ws_path_ident of the common dir>`, `record=<name>`, `admin=<_ws_path_ident of the admin dir>`, `root=<_ws_path_ident of the tree>`, `gitfile=<the tree's .git file names the admin dir>`, `gitdir=<_ws_reclaim_gitdir_own>`, `base=<_dl_creation_base>`; a stored carrier with a different fingerprint refuses. An unmeasurable input refuses `unmeasured`.
12. **Write.** The body (`v`, `leaseId`, `generation`, `state`, `journalSeq`, `parentId`, `parentIncarnation`, `activityId`, `source`, `project`, `adminRecord`, `canonicalPath`, `fingerprint`, `claudeBase`, `branch` (the tree's `symbolic-ref --short HEAD`, or null when detached), `expiresAt`, `releaseReason`, `promotedRun`, `promotedSession`, `markedAt`), each string through `_json_str`. The by-tree entry is written FIRST (`.<key>.<pid>.tmp` in `by-tree/`, then `_plat_mv_notdir` over `by-tree/<key>`), and the carrier after it (`.<lease>.<pid>.tmp` in the leases directory, then `_plat_mv_notdir` over `<lease>.json`), so a verb that dies between the two renames leaves an index entry with no carrier, which every reader already reads as `unmeasured` (fail-shut, PR4 rung rule 3), never a carrier with no index entry (`D-7803`). On every mark, `unchanged` included, the verb checks inside the lock that the by-tree entry names this lease and repairs it when it is missing; an entry naming ANOTHER lease is overwritten only when rule 10 found that lease's carrier absent or non-holding, and is otherwise rule 10's `tree-held`. Git reads run under `_ws_reclaim_contained`. The answer is `{"ok":true,"answer":"written"|"unchanged"|"index-cleared","lease":…,"generation":…,"state":…,"fingerprint":…,"claudeBase":…,"tip":…}` or `{"ok":false,"refusal":<word>,"detail":…}`, one line, nothing else on stdout.

- [ ] **Step 1: RED rows** in `server/test/ccd-ws-lease-mark.test.ts`, every case on a fixture HOME:

  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import fs from 'node:fs';
  import path from 'node:path';
  import { spawn } from 'node:child_process';
  import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-lease-mark-'); h.makeRepo('demo'); });
  afterEach(() => { h.cleanup(); });

  const LEASE = '0f8e6a8c-1b2d-4c3e-9f00-0123456789ab';
  const OTHER = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';
  const INC = '11111111-2222-4333-8444-555555555555';
  const hex = (s: string): string => Buffer.from(s).toString('hex');
  const reg = (): string => path.join(h.home, '.cc-sessions');
  const main = (): string => path.join(h.home, 'projects', 'demo');
  const agentTree = (name = 'agent-a'): string => {
    const at = path.join(main(), '.claude', 'worktrees', name);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    h.git(main(), 'worktree', 'add', '-b', `claude/${name}`, '--', at);
    return fs.realpathSync(at);
  };
  type Flags = Record<string, string | null>;
  const BASE: Flags = { lease: LEASE, generation: '1', project: 'demo', 'admin-record-hex': hex('agent-a'),
    parent: 'lane-a-demo', 'parent-incarnation': INC, activity: 'act-1', source: 'agent', state: 'ephemeral', 'journal-seq': '7' };
  interface Out { code: number; doc: Record<string, unknown>; lines: string[] }
  const mark = (over: Flags = {}, pre = ''): Out => {
    const argv = Object.entries({ ...BASE, ...over }).filter(([, v]) => v !== null).map(([k, v]) => `--${k} ${v}`).join(' ');
    const out = h.sh(`${pre} cmd_ws_lease_mark ${argv}; echo "rc=$?"`).trim().split('\n');
    const code = Number(/^rc=(\d+)$/.exec(out.pop()!)![1]);
    return { code, lines: out, doc: JSON.parse(out[out.length - 1] ?? '{}') as Record<string, unknown> };
  };
  const carrier = (id = LEASE): Record<string, unknown> =>
    JSON.parse(fs.readFileSync(path.join(reg(), 'delegation', 'leases', `${id}.json`), 'utf8')) as Record<string, unknown>;

  describe('ws-lease-mark writes one carrier, generation-strict', () => {
    it('W5-L1: a clean agent tree at generation 1 gets a carrier and a by-tree entry', () => {
      const t = agentTree();
      const r = mark();
      expect(r.code, JSON.stringify(r.doc)).toBe(0);
      expect(r.doc).toMatchObject({ ok: true, answer: 'written', lease: LEASE, generation: 1, state: 'ephemeral' });
      expect(carrier()).toMatchObject({ v: 1, leaseId: LEASE, generation: 1, state: 'ephemeral', journalSeq: 7,
        adminRecord: 'agent-a', canonicalPath: t, source: 'agent', branch: 'claude/agent-a', expiresAt: null });
      expect(carrier().fingerprint).toMatch(/^[0-9a-f]{64}$/);
      const byTree = fs.readdirSync(path.join(reg(), 'delegation', 'leases', 'by-tree'));
      expect(byTree).toHaveLength(1);
      expect(fs.readFileSync(path.join(reg(), 'delegation', 'leases', 'by-tree', byTree[0]!), 'utf8').trim()).toBe(LEASE);
      expect(r.lines).toHaveLength(1);
    }, 60_000);

    it('W5-L2: the same generation with the same body answers unchanged and rewrites nothing', () => {
      agentTree(); mark();
      const before = fs.readFileSync(path.join(reg(), 'delegation', 'leases', `${LEASE}.json`));
      const r = mark();
      expect(r.code).toBe(0);
      expect(r.doc).toMatchObject({ ok: true, answer: 'unchanged' });
      expect(fs.readFileSync(path.join(reg(), 'delegation', 'leases', `${LEASE}.json`))).toEqual(before);
    }, 60_000);

    it('W5-L3: stored + 1 is written; a different body at the same generation refuses; a carrier two behind catches up; below refuses', () => {
      agentTree(); mark();
      expect(mark({ generation: '2', state: 'adopted', 'expires-at': '1767225600000', 'journal-seq': '9' }).doc)
        .toMatchObject({ ok: true, answer: 'written', generation: 2, state: 'adopted' });
      expect(mark({ generation: '2', state: 'retained', 'journal-seq': '9' }).doc).toMatchObject({ ok: false, refusal: 'generation-conflict' });
      expect(mark({ generation: '4', state: 'retained', 'expires-at': '1767830400000', 'journal-seq': '12' }).doc)
        .toMatchObject({ ok: true, answer: 'written', generation: 4, state: 'retained' });
      expect(mark({ generation: '3', state: 'adopted', 'expires-at': '1767225600000', 'journal-seq': '10' }).doc)
        .toMatchObject({ ok: false, refusal: 'stale-generation' });
      expect(carrier()).toMatchObject({ generation: 4, state: 'retained', expiresAt: 1767830400000 });
    }, 60_000);

    it('W5-L4: a new lease at a generation other than 1 refuses stale-generation and writes nothing', () => {
      agentTree();
      expect(mark({ generation: '2' }).doc).toMatchObject({ ok: false, refusal: 'stale-generation' });
      expect(fs.existsSync(path.join(reg(), 'delegation', 'leases', `${LEASE}.json`))).toBe(false);
    }, 60_000);
  });
  ```

  And, in the same file, one `it` per remaining row, each asserting the refusal word, rc 1 (rc 2 for usage), that the carrier is absent or byte-unchanged, and that stdout is one line:
  - **W5-L5** usage: a worktree named `-dash` marks through `--admin-record-hex` (`hex('-dash')`) and is written; `--admin-record agent-a` (the spec's raw spelling), a repeated `--lease`, a trailing `--lease` with no value, `--release-reason foreign` with `--state adopted`, and `--state promoted` without `--promoted-session` each refuse `usage` with rc 2.
  - **W5-L6** `not-under-projects-root`: `projects/demo` replaced by a link to a repository elsewhere.
  - **W5-L7** `symlink`: `.claude/worktrees` is a link to a directory holding the tree.
  - **W5-L8** `locked` (O5-3): `git worktree lock` on the tree; after `git worktree unlock`, the same call is written.
  - **W5-L9** `main-worktree`: an admin record whose `gitdir` names `<main>/.git`.
  - **W5-L10** `registered`: `_reg_set demo-quiet-cove workdir <tree>`; and a row `demo-quiet-cove` with `workdir` inside the tree and `child 5`.
  - **W5-L11** the carve-out: `_reg_set lane-a-demo workdir <main>` and the mark is written; a row whose workdir is an outer directory containing the tree, of which the tree is not a direct `.claude/worktrees/<name>` child, refuses `nested`.
  - **W5-L12** `nested`: a second linked worktree created inside the tree, and the tree created inside another linked worktree at any place other than that worktree's `.claude/worktrees/<name>` or `.superpowers/worktrees/<name>`.
  - **W5-L24** a workspace-hosted agent tree is written: a ccd workspace (a linked worktree of `demo` under the fixture's worktrees root, `<worktrees-root>/demo/quiet-mesa`, with `_reg_set demo-quiet-mesa workdir <it>`) and an Agent tree at `<workspace>/.claude/worktrees/agent-x` whose admin record sits in the main checkout's common dir; the mark is written with `canonicalPath` the physical tree. The same workspace holding a tree at `<workspace>/sub/agent-y` refuses `nested`.
  - **W5-L13** `tree-held`: `OTHER` marked on the same tree and moved to `adopted` (generation 2); then `LEASE` refuses `tree-held`. After `OTHER` is marked `released` (generation 3, `--release-reason foreign`), `LEASE` at generation 1 is written and the by-tree entry names `LEASE`. With `OTHER` only `ephemeral`, and again with the entry naming a lease that has no carrier, `LEASE` is written and the entry re-pointed at it; with `OTHER`'s carrier malformed, `LEASE` refuses `unmeasured`.
  - **W5-L23b** the heal: after W5-L23's half-write (the entry names `LEASE`, no carrier), `--generation 2 --state released --release-reason foreign` answers `index-cleared`, rc 0, removes the entry and writes no carrier (`_dl_tree_owner` then answers rc 3); the same request with no entry naming `LEASE` refuses `no-tree`.
  - **W5-L14** `bad-carrier`: the stored carrier is `{` (malformed), then a link to a valid carrier elsewhere, then 20000 bytes: each refuses, and the target and the file are unchanged.
  - **W5-L15** `unmeasured`: `$REG/delegation/leases` is a link; nothing is made at its target.
  - **W5-L16** `fingerprint-mismatch`: the tree is marked, then removed (`git worktree remove`) and re-added at the same path with the same name; generation 2 refuses.
  - **W5-L17** the lost answer: generation 2 sent twice with the same body; the second answers `unchanged`, rc 0.
  - **W5-L18** `busy`: a background `flock` on `.locks/<lease>.lock` held for 5 s (spawned with `spawn('flock', [lockPath, 'sleep', '5'])`, killed in `finally`).
  - **W5-L19** release without a tree: marked, then the tree removed with `git worktree remove` and `git worktree prune`; `--generation 2 --state released --release-reason native-removed` is written and keeps the stored fingerprint; the same request with no stored carrier refuses `no-tree`.
  - **W5-L20** the creation base: with `CLAUDE_BASE` (a 40-hex line) in the admin dir the carrier's `claudeBase` is it; without it, the first `logs/HEAD` line's new id; with neither readable (`logs/HEAD` mode 0000, skipped as root), `unmeasured`.
  - **W5-L21** promoted: `--state promoted --promoted-run 12 --promoted-session demo-bright-fern` writes `promotedRun: 12` and `promotedSession`.
  - **W5-L22** no stdout but the one line, and nothing under the tree changes: `git status --porcelain`, and a recursive listing with sizes and mtimes of the tree, of its admin dir (`<common>/worktrees/<name>/`, where git keeps the tree's index and lock files) and of the common dir's `worktrees/<name>` entry, each equal before and after.
  - **W5-L23** the index is written first: `_plat_mv_notdir` stubbed to fail on its second call; the verb answers a refusal, the by-tree entry names `LEASE`, and no `<lease>.json` and no partial temp file remains (`_dl_tree_owner` answers rc 0 and `_dl_carrier_read` rc 3: PR4's W5-O4b pins that the orphan rung refuses `unmeasured` in this state). A re-drive at the same generation writes the carrier, and the index still names `LEASE`. Then the by-tree entry is removed by hand and an identical re-drive answers `unchanged` and repairs it.
  - **W5-L25** a failed rename leaves the stored carrier byte-identical: with a generation-1 carrier stored, `_plat_mv_notdir` stubbed to fail on the carrier's rename for a generation-2 mark; the stored bytes and inode are unchanged and no `<lease>.json` other than the stored one, and no `.<lease>.*.tmp`, remains.

- [ ] **Step 2: Run RED.**

  ```
  cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/ccd-ws-lease-mark.test.ts
  ```

  Expected: every W5-L row fails with `cmd_ws_lease_mark: command not found`.

- [ ] **Step 3: Implement** the functions of Interfaces and the rules above in `ccd/lib/delegation-lease.sh`. `_dl_carrier_read` refuses a link or non-regular file before opening it, reads at most `__DL_CARRIER_MAX + 1` bytes, and parses with `python3 -I -c` from a fixed program string (no file argument other than the carrier), printing NUL-separated `field=value` pairs; any key outside the body list, a missing key, or a value out of grammar is rc 4. Strict mode inside the verb: `local LC_ALL=C`, `set -uo pipefail` as ccd runs, every failure folded to a refusal, never a bare exit.

- [ ] **Step 4: Run GREEN**, Step 2's command. Then `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/ccd-contexts.test.ts` and `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/macos-platform.test.ts`. Expected: green.

- [ ] **Step 5: Commit** `feat(ccd): ws-lease-mark writes a lease's carrier, generation-strict, flocked and atomic`.

### Task 5.1.4: The verb's surface: caps, grant, flag gate, entry boundary, builder, forbidden lists and prose

**Files.** As listed in this PR's Files for `ccd/ccd`, `ccd/ccd-entry.py`, `agent/`, `server/src/ccdargv.ts`, `server/src/coord/approvalguard.ts`, `shared/api.ts#CHILD_DENY_CCD_VERBS`, `ccd/session-hook.sh`, `ccd/install-session-hooks.sh`, `CLAUDE.md`, and their tests.

- [ ] **Step 1: RED rows.**
  - **W5-G1** (`server/test/ccdCapTokens.ts`, held by `ccd-archive.test.ts` and `ccd-verb-sets.test.ts`): `CCD_CAPABILITY_TOKENS` gains `'lease-mark-v1'`; red until `cmd_caps` prints it.
  - **W5-G2** (`agent/test/whitelist-structural.test.ts`): the grant `['ws-lease-mark','--lease']` exists and `REQUIRED_VERB_FLAG['ws-lease-mark'] === '--lease'`.
  - **W5-G3** (`agent/test/types/bypasses/g25-ws-lease-mark-without-lease.ts`): a table granting `['ws-lease-mark']` must not compile, in g22's shape:

    ```ts
    // BYPASS FIXTURE — MUST NOT COMPILE.
    //
    // DELEGATION BROKER WAVE 5: `['ws-lease-mark', '--lease']` -> `['ws-lease-mark']`, a grant that keeps the carrier
    // writer and drops the flag that names the one lease it may write. `isExecAllowed` is PREFIX-matching, so the bare
    // grant admits every argv `CCD_ARGV.leaseMark` builds; the ENROLMENT in `REQUIRED_VERB_FLAG` makes this a TS2322 on
    // the proof line and a boot refusal at module load.
    import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

    const table = {
      tmux: [['has-session']],
      ccd: [['start'], ['ws-lease-mark']],
    } as const satisfies ExecWhitelist;

    export const proven: LawfulGrants<typeof table> = table;
    ```

  - **W5-G4** (`agent/test/ccd-entry-exec.test.ts`): `ws-lease-mark` run directly (not through the installed entry) refuses `entry-unprivileged`, in both the `ccd/ccd` guard and `ccd/ccd-entry.py`'s classifier, from the one table the file runs against both.
  - **W5-G5** (`server/test/verb-gate.test.ts`, `server/test/whitelist-subset.test.ts`): `CCD_CAN.leaseMark` is `capRow('lease-mark-v1')`, and layer 3 finds the grant built and the build granted.
  - **W5-G6** (`server/test/ccd-ws-lease-mark-argv.test.ts`, new): the builder's argv and refusals.

    ```ts
    import { describe, it, expect } from 'vitest';
    import { CCD_ARGV, capSupported, LEASE_MARK_CAP } from '../src/ccdargv.js';

    const A = { leaseId: '0f8e6a8c-1b2d-4c3e-9f00-0123456789ab', generation: 2, project: 'demo', adminRecord: '-dash',
      parentId: 'lane-a-demo', parentIncarnation: '11111111-2222-4333-8444-555555555555', activityId: 'act-1',
      source: 'agent' as const, state: 'adopted' as const, journalSeq: 9, expiresAtMs: 1767225600000, releaseReason: null,
      promoted: null };

    describe('CCD_ARGV.leaseMark', () => {
      it('W5-G6: leads with --lease, carries the record as hex and never a path', () => {
        const a = [...CCD_ARGV.leaseMark(A)];
        expect(a.slice(0, 3)).toEqual(['ws-lease-mark', '--lease', A.leaseId]);
        expect(a).toContain('--admin-record-hex');
        expect(a[a.indexOf('--admin-record-hex') + 1]).toBe(Buffer.from('-dash').toString('hex'));
        expect(a.join(' ')).not.toMatch(/\/|-dash\b/);
        expect(a.slice(a.indexOf('--expires-at'), a.indexOf('--expires-at') + 2)).toEqual(['--expires-at', '1767225600000']);
      });
      it('W5-G6b: refuses what the verb would refuse as usage', () => {
        expect(() => CCD_ARGV.leaseMark({ ...A, leaseId: 'not-a-uuid' })).toThrow();
        expect(() => CCD_ARGV.leaseMark({ ...A, generation: 0 })).toThrow();
        expect(() => CCD_ARGV.leaseMark({ ...A, project: '-p' })).toThrow();
        expect(() => CCD_ARGV.leaseMark({ ...A, state: 'released', releaseReason: null })).toThrow();
        expect(() => CCD_ARGV.leaseMark({ ...A, state: 'adopted', releaseReason: 'foreign' })).toThrow();
        expect(() => CCD_ARGV.leaseMark({ ...A, state: 'promoted', promoted: null })).toThrow();
      });
      it('W5-G6c: no evidence refuses', () => {
        expect(capSupported({ ccdVerbs: null }, LEASE_MARK_CAP)).toBe(false);
        expect(capSupported({ ccdVerbs: ['lease-mark-v1'] }, LEASE_MARK_CAP)).toBe(true);
      });
    });
    ```

  - **W5-G7** (`server/test/id-argv-census.test.ts`): the lease id, the parent id and the promoted session reaching this argv are each checked once (the census's own registration shape).
  - **W5-G8** (`server/test/ccd-spawn-child-settings.test.ts`, and the approval guard's tests): `ws-lease-mark` is in `FORBIDDEN_CCD_VERBS` and in `CHILD_DENY_CCD_VERBS`, the two held equal; the hook's `APPROVAL_FORBIDDEN_JQ` refuses `ccd ws-lease-mark …` in its existing deny-row shape; the installer's child-deny loop writes the rule.
  - **W5-G9** (`server/test/coordinator-skill.test.ts`, kept): no skill text names `ws-lease-mark`; re-run, no edit.

- [ ] **Step 2: Run RED.**

  ```
  cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/ccd-ws-lease-mark-argv.test.ts
  cd agent && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/whitelist-structural.test.ts
  ```

  Expected: W5-G6 fails (no `leaseMark`), W5-G2 fails (no grant).

- [ ] **Step 3: Implement.** The dispatch arm `ws-lease-mark) shift; cmd_ws_lease_mark "$@" ;;` beside `ws-shed-deps)`; `echo lease-mark-v1; echo ws-lease-mark` on `cmd_caps`'s delegation line; the entry guard alternative and the `folds_to` tuple; the grant, flag and g25; the builder (hex-encodes `adminRecord`, validates every field with the verb's grammar, and composes `--lease` first); `CCD_CAN.leaseMark: capRow(LEASE_MARK_CAP)`; the forbidden lists; the CLAUDE.md SAFETY bullet:

  > **`ws-lease-mark` is forbidden to every session too**: it is the SERVER's act on a delegation lease's carrier only (`ccd ws-lease-mark --lease <id> …`), composed after the server has journalled the generation it writes, behind `lease-mark-v1` and the installed direct entry — never a session's verb, and never run against the live host from a shell or a test.

  and, after "Zero new ccd verbs for coordination mutation", the sentence: "Workspace-lifecycle verbs and flags (`ws-reclaim`, `ws-expire`, `ws-lease-mark`) act on workspaces, not on coordination state, are server-composed only, and are not covered by that rule."

- [ ] **Step 4: Run GREEN**, Step 2's commands, then alone in `server`: `ccd-archive`, `ccd-verb-sets`, `verb-gate`, `whitelist-subset`, `id-argv-census`, `ccd-spawn-child-settings`, `session-hook` (a known load flake: re-run alone), `install-session-hooks`, `coordinator-skill`, `delegation-wave3.integration`, `docs-parity`; in `agent`: `ccd-entry-exec`, and `cd agent && ~/.local/bin/ccrc test -- ./node_modules/.bin/tsc --noEmit` (g25 must fail to compile inside its own harness, which the bypass suite runs). Expected: green.

- [ ] **Step 5: Commit** `feat(ccd): ws-lease-mark's surface: lease-mark-v1, its grant and flag gate, the entry boundary and every forbidden list`.

### PR1 mutation table

Each row: the mutant, applied alone to a saved copy, and the row that must go RED.

| Mutant | Edit | Goes red |
|---|---|---|
| W5-LM1 | drop rule 6's link test | W5-L7 |
| W5-LM2 | drop the `locked` test | W5-L8 |
| W5-LM3 | drop the main-worktree test | W5-L9 |
| W5-LM4 | drop `_ws_orphan_registered` from rule 9 | W5-L10 |
| W5-LM5 | refuse every containing registry workdir (no carve-out) | W5-L11 (the main checkout case), W5-L24 |
| W5-LM5b | carve out the main checkout only (the original main-only rule) | W5-L24 (the workspace-hosted tree refuses `nested`) |
| W5-LM6 | check containment one direction only (inside, not containing) | W5-L12 (the outer case) |
| W5-LM7 | ignore the by-tree index | W5-L13 |
| W5-LM8 | skip the fingerprint compare | W5-L16 |
| W5-LM9 | read a carrier through a link (drop `! -L`) | W5-L14 (the link case) |
| W5-LM10 | accept any generation (drop rule 4's arithmetic) | W5-L3 (the below-stored case), W5-L4 |
| W5-LM10b | accept only stored + 1 (the strict rule) | W5-L3 (the two-behind catch-up) |
| W5-LM11 | rewrite on an equal body instead of answering `unchanged` | W5-L2 (bytes differ by `markedAt`) |
| W5-LM12 | `flock` without `-n` | W5-L18 (the case times out at its 10 s bound instead of answering `busy`) |
| W5-LM13 | write in place (no temp file and rename) | W5-L25 (the failed write changes the stored bytes and leaves a partial `<lease>.json`) |
| W5-LM19 | write the carrier before the by-tree entry | W5-L23 (the carrier stands with no index entry) |
| W5-LM20 | skip the index repair on `unchanged` | W5-L23 (the hand-removed entry stays missing) |
| W5-LM21 | refuse `tree-held` for any other lease's entry, whatever its carrier | W5-L13 (the `ephemeral` and no-carrier cases) |
| W5-LM22 | drop the `index-cleared` heal (a released request with no carrier always `no-tree`) | W5-L23b, W5-O4b (its second half) |
| W5-LM21 | run the verb's git reads outside `_ws_reclaim_contained` (no `GIT_OPTIONAL_LOCKS=0`) | W5-L22 (the admin dir's index changes) |
| W5-LM14 | read `--admin-record` raw as well as hex | W5-L5 |
| W5-LM15 | drop `ws-lease-mark` from `REQUIRED_VERB_FLAG` | W5-G3 (g25 compiles) |
| W5-LM16 | drop it from the entry guard | W5-G4 |
| W5-LM17 | drop it from `CHILD_DENY_CCD_VERBS` | W5-G8 |
| W5-LM18 | `capRow` default `'permit'` | W5-G5, W5-G6c |

### PR1 at its tip

**Suites to run alone**, one per run, in the foreground: in `server`, `ccd-ws-lease-mark`, `ccd-ws-lease-mark-argv`, `ccd-lib-load`, `ccd-entry-install`, `ccd-install-stamp`, `ccd-harness-integrity`, `ownership`, `install-census`, `build-release`, `ccrc-uninstall`, `ccd-archive`, `ccd-verb-sets`, `ccd-contexts`, `verb-gate`, `whitelist-subset`, `id-argv-census`, `ccd-spawn-child-settings`, `session-hook`, `install-session-hooks`, `coordinator-skill`, `delegation-wave3.integration`, `single-definition/vocabularies`, `docs-parity`, `anchors`, `citations`, `topology-clean`, `growth-check` (with `GROWTH_CHECK=1`), and `deviation-refs` after `git fetch origin main`; in `agent`, `whitelist-structural`, `ccd-entry-exec`, `deploy-verify` and the typecheck. The PR's CI `select tests` summary must list `ccd-ws-lease-mark` and `ccd-ws-lease-mark-argv`.

**Growth check.** `ccd/ccd` about +4 net code lines (the pin line, the dispatch arm, the caps words; the array and guard edits are in place). `ccd/session-hook.sh` +0 (words added on existing lines). No server growth-listed file changes. No waiver.

**Rollout order.** Fleet box first (`ccrc rollout`'s default). After it, `GET /api/fleet/health`'s capability list shows `lease-mark-v1`; nothing on the server composes the verb yet.

**Review focus.**
1. Every refusal runs before the first write, and inside the lock where it reads stored state (rules 4-11).
2. The carve-out is the orphan ladder's location rule (`_ws_orphan_class` over the stanza checkouts): a containing registry workdir or linked worktree passes only when the tree is a direct `.claude/worktrees/<name>` or `.superpowers/worktrees/<name>` child of that checkout (main or linked, a ccd workspace included); every other containment refuses `nested`. Rule 6 measures links below whichever root holds the tree.
6. The by-tree entry is written before the carrier, repaired on every mark, re-pointed only from an absent or non-holding carrier, and cleared only by a `released` mark of a lease with no carrier (`index-cleared`); a generation above the stored one catches the carrier up; nothing ever moves a carrier backwards.
3. A name beginning with `-`, holding `@` or `+`, or decoding to `.`/`..` never reaches a path or a flag position.
4. The carrier reader keeps absent, unreadable and malformed apart (rc 3 versus rc 4), and nothing reads a carrier through a link.
5. The verb is on every forbidden list and named by no skill; the agent's write allowlist is unchanged.

**This PR must NOT:** compose the verb from any server code; write a carrier from a spawn or any other ccd verb; add `.reaped/` or any `lease-clean*` word; touch the hook's generated helpers region; widen the agent's write allowlist; edit an existing plan or the programme ledger.

## PR2: F2, the read-only `ws-lease-audit`

**Goal.** A server can ask the box whether a leased tree changed, and at which tip, without the box writing anything. Adoption reads `changed`; promotion reads `tip` and `dirty` (and `holders` under O5-2's recommendation).

**Branch and base.** From `main` with PR1 merged. **Deploy class.** FLEET; the server gets only the builder.

**Files.**
- `ccd/lib/delegation-lease.sh`: `_dl_audit_ladder`, `cmd_ws_lease_audit`.
- `ccd/ccd`: the `ws-lease-audit)` arm and usage; `cmd_caps` `echo lease-audit-v1; echo ws-lease-audit`; the entry guard alternative. `ccd/ccd-entry.py`'s tuple. `ccd/contexts.tsv` (C4 rows, as PR1's), `ccd/contexts-edges.tsv` (only a true cross-context call, if any).
- `agent/src/whitelist.ts` (`['ws-lease-audit','--lease']`, `REQUIRED_VERB_FLAG`), `agent/test/types/bypasses/g26-ws-lease-audit-without-lease.ts`, `agent/test/whitelist-structural.test.ts`, `agent/test/ccd-entry-exec.test.ts`, `agent/CLAUDE.md`.
- `server/src/ccdargv.ts`: `LEASE_AUDIT_CAP`, `CCD_ARGV.leaseAudit`, `CCD_CAN.leaseAudit`. `server/src/remote/runner.ts#CCD_VERB_TIMEOUT_MS`: a `ws-lease-audit` row (only if O5-2 (b) adds `holders`), and, because that table and `server/src/remote/runner.ts#timeoutMsFor` are module-private, `timeoutMsFor` becomes exported, unchanged (the one lookup W5-G15 asserts through; no second table, no copy of the map).
- `shared/api.ts`: `LeaseAuditAnswer` and `LEASE_AUDIT_REFUSALS` beside PR1's block.
- `CLAUDE.md`: `ws-lease-audit` added to PR1's coordination-invariant sentence (it is not on the SAFETY list: it writes nothing).
- Tests: create `server/test/ccd-ws-lease-audit.test.ts`; modify `ccdCapTokens.ts`, `verb-gate`, `whitelist-subset`, `id-argv-census`, `ccd-ws-lease-mark-argv` (a second describe), `delegation-wave3.integration` (the `ws-lease-audit` row of `W5_OPEN` gains its files).

**Why here.** It reads carriers, so it follows PR1; it must be on the box before PR7 can adopt (a box without it makes every tree count as changed) and before PR9 can promote (a box without it refuses).

**Interfaces.**
- **Consumes:** PR1's `_dl_carrier_read`, `_dl_tree_of_record`, `_dl_creation_base`, `_dl_fingerprint`; `ccd/ccd#_ws_gc_dirty`, `#_ws_reclaim_contained`, `#_ws_reclaim_fingerprint`, `#_ws_path_users_many`, `#_ws_cwd_users`.
- **Produces**, consumed by PR7 and PR9:

  ```ts
  // shared/api.ts
  export const LEASE_AUDIT_REFUSALS = ['usage', 'unmeasured', 'no-carrier', 'bad-carrier', 'stale-generation', 'no-tree',
    'fingerprint-mismatch'] as const;
  export type LeaseAuditRefusal = (typeof LEASE_AUDIT_REFUSALS)[number];
  export type LeaseAuditAnswer =
    | { ok: true; lease: string; generation: number; tip: string; dirty: boolean | 'unmeasured';
        aheadOfBase: number | 'unmeasured'; changed: boolean | 'unmeasured';
        holders?: readonly number[] | 'unmeasured'; token: string }
    | { ok: false; refusal: LeaseAuditRefusal; detail: string };
  // server/src/ccdargv.ts
  export const LEASE_AUDIT_CAP = 'lease-audit-v1';
  // CCD_ARGV.leaseAudit: (leaseId: string, generation: number, withHolders: boolean) => CcdArgv
  // CCD_CAN.leaseAudit: capRow(LEASE_AUDIT_CAP)
  ```

  ```bash
  cmd_ws_lease_audit()   # --lease <uuid> --generation <n> [--holders] -> ONE JSON document; rc 0 measured, 1 unmeasured or refused, 2 usage
  ```

**Shape decision.** The token is evidence, not authority (`D-7826`): `_ws_reclaim_fingerprint mode=lease-audit lease= generation= incarnation= fingerprint= tip= dirty= ahead= base=` over named inputs, binding the carrier's generation and parent incarnation. No verb consumes it; PR9 writes it into the promotion's journal entry as the record of what was measured.

### Task 5.2.1: The audit ladder and the verb

**The rules.** Parse strictly (rc 2 `usage`). Read the carrier without any lock (`no-carrier` on rc 3, `bad-carrier` on rc 4), refuse `stale-generation` when its generation differs from `--generation`, resolve the tree from the carrier's project and record (`no-tree`), recompute the fingerprint and refuse `fingerprint-mismatch`. Then, in a contained git (`_ws_reclaim_contained`): `tip` = `rev-parse HEAD`; `dirty` = `_ws_gc_dirty` (untracked included); `aheadOfBase` = `rev-list --count <claudeBase>..HEAD`; `changed = dirty || aheadOfBase > 0`. A `claudeBase` that differs from `_dl_creation_base`'s reading, or any fact that does not read, makes that fact and `changed` `"unmeasured"` (never `false`). With `--holders`, `holders` lists the pids `_ws_path_users_many` and `_ws_cwd_users` report for the tree, or `"unmeasured"`. It writes nothing anywhere: no carrier, no index, no lock file, no journal line.

- [ ] **Step 1: RED rows** in `server/test/ccd-ws-lease-audit.test.ts`, reusing PR1's fixture helpers through a small shared `server/test/leaseFixture.ts` that this task extracts from `ccd-ws-lease-mark.test.ts` in a move commit of its own, changing only imports: it exports `LEASE`, `OTHER`, `INC`, `hex`, `agentTree(h, name?)`, `mark(h, over?, pre?)` and `carrier(h, id?)`, the same bodies with the harness passed in. `STUBS` is `ccd-ws-orphan-verb.test.ts`'s probe-stub string, copied into the fixture:

  ```ts
  const audit = (gen = 1, extra = ''): { code: number; doc: Record<string, unknown> } => {
    const out = h.sh(`${STUBS} cmd_ws_lease_audit --lease ${LEASE} --generation ${gen} ${extra}; echo "rc=$?"`).trim().split('\n');
    const code = Number(/^rc=(\d+)$/.exec(out.pop()!)![1]);
    return { code, doc: JSON.parse(out.pop() ?? '{}') as Record<string, unknown> };
  };

  it('W5-AU1: a tree with no commit and no dirt is unchanged, at its tip', () => {
    const t = agentTree(h); mark(h);
    const r = audit();
    expect(r.code).toBe(0);
    expect(r.doc).toMatchObject({ ok: true, generation: 1, dirty: false, aheadOfBase: 0, changed: false });
    expect(r.doc.tip).toBe(h.git(t, 'rev-parse', 'HEAD').trim());
    expect(r.doc.token).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);

  it('W5-AU2: one commit beyond the base is changed; an untracked file alone is changed', () => {
    const t = agentTree(h); mark(h);
    fs.writeFileSync(path.join(t, 'u.txt'), 'u\n');
    expect(audit().doc).toMatchObject({ dirty: true, changed: true });
    h.git(t, 'add', 'u.txt'); h.git(t, 'commit', '-m', 'w');
    expect(audit().doc).toMatchObject({ dirty: false, aheadOfBase: 1, changed: true });
  }, 60_000);
  ```

  Remaining rows, one `it` each:
  - **W5-AU3** a carrier at generation 2 asked at 1 refuses `stale-generation`.
  - **W5-AU4** `CLAUDE_BASE` rewritten in the admin dir to another commit: the recomputed fingerprint (which binds `base=<_dl_creation_base>`) differs from the carrier's, so the answer is `{ok:false, refusal:'fingerprint-mismatch'}`, rc 1, before any fact is computed. The base stays a fingerprint input: a moved base is a different tree identity, never a measurement.
  - **W5-AU4b** the base cannot be counted: a `git` wrapper first on the fixture's `PATH` exits 128 for `rev-list` and passes every other subcommand through; `aheadOfBase` and `changed` are `"unmeasured"` (never 0, never `false`), `dirty` is still measured, rc 1.
  - **W5-AU5** an unreadable index (`.git/index` mode 0000, skipped as root): `dirty` and `changed` `"unmeasured"`.
  - **W5-AU6** the tree removed: `no-tree`; a malformed carrier: `bad-carrier`; no carrier: `no-carrier`.
  - **W5-AU7** writes nothing: a recursive listing with sizes and mtimes of `$REG`, of the tree, of its admin dir (`<common>/worktrees/<name>/`, where git keeps the tree's index and lock files) and of the common dir's `worktrees/<name>` entry are equal before and after three audits.
  - **W5-AU8** the token changes when the carrier's generation or parent incarnation changes, and when one commit is added; it is equal across two audits of an unchanged state.
  - **W5-AU9** (O5-2 (b)) with `--holders` and the probes stubbed as `ccd-ws-orphan-verb.test.ts` stubs them, `holders: []`; with `_ws_cwd_users` stubbed to report pid 4242, `holders: [4242]`; with it failing, `"unmeasured"`.

- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/ccd-ws-lease-audit.test.ts`. Expected: every row fails, `cmd_ws_lease_audit: command not found`.
- [ ] **Step 3: Implement** `_dl_audit_ladder` and `cmd_ws_lease_audit` by the rules.
- [ ] **Step 4: Run GREEN**, Step 2's command, and `ccd-ws-lease-mark` and `ccd-contexts` alone. Expected: green.
- [ ] **Step 5: Commit** `feat(ccd): ws-lease-audit, the read-only measure of a leased tree`.

### Task 5.2.2: The audit's surface

- [ ] **Step 1: RED rows.** **W5-G10** caps token `lease-audit-v1`; **W5-G11** grant, flag and g26: `agent/test/types/bypasses/g26-ws-lease-audit-without-lease.ts` holds the table `{ tmux: [['has-session']], ccd: [['start'], ['ws-lease-audit']] } as const satisfies ExecWhitelist` and the proof line `export const proven: LawfulGrants<typeof table> = table;`, with a header saying the bare grant admits an audit of any lease the server was talked into naming; **W5-G12** entry boundary row; **W5-G13** `CCD_ARGV.leaseAudit` leads with `--lease`, adds `--holders` only when asked, and refuses a malformed id or a generation below 1; `CCD_CAN.leaseAudit` is `capRow('lease-audit-v1')`; **W5-G14** `ws-lease-audit` is in NO forbidden list (`FORBIDDEN_CCD_VERBS`, `CHILD_DENY_CCD_VERBS`, the hook's lists) and no skill names it; **W5-G15** (O5-2 (b) only) `timeoutMsFor('ccd', ['ws-lease-audit', '--lease', LEASE, '--generation', '1', '--holders'])` (the exported lookup that reads `CCD_VERB_TIMEOUT_MS[args[0]]`) is at least the `/proc` walk's 10 s bound times two plus the git reads, and at most the agent's maximum.
- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/ccd-ws-lease-mark-argv.test.ts`. Expected: W5-G13 fails.
- [ ] **Step 3: Implement** the dispatch arm `ws-lease-audit) shift; cmd_ws_lease_audit "$@" ;;` and its `usage:` entry; `echo lease-audit-v1; echo ws-lease-audit` on `cmd_caps`'s delegation line; the `"${1-}" == ws-lease-audit` alternative in the entry guard at the top of `ccd/ccd` and `ws-lease-audit` in `ccd/ccd-entry.py`'s `folds_to` tuple; the grant `['ws-lease-audit','--lease']` and `REQUIRED_VERB_FLAG['ws-lease-audit'] = '--lease'`; the fixture g26; `LEASE_AUDIT_CAP`, the builder (`['ws-lease-audit','--lease', id, '--generation', String(gen), ...(withHolders ? ['--holders'] : [])]`, the id checked against the lease UUID shape and the generation a positive safe integer) and `CCD_CAN.leaseAudit: capRow(LEASE_AUDIT_CAP)`; and, under O5-2 (b), the `CCD_VERB_TIMEOUT_MS` row. It joins none of the forbidden lists.
- [ ] **Step 4: Run GREEN**: Step 2's command, then `ccd-archive`, `ccd-verb-sets`, `verb-gate`, `whitelist-subset`, `id-argv-census`, `delegation-wave3.integration` in `server`, and `whitelist-structural`, `ccd-entry-exec` and the typecheck in `agent`.
- [ ] **Step 5: Commit** `feat(ccd): lease-audit-v1, its grant, flag gate and entry boundary`.

### PR2 mutation table

| Mutant | Edit | Goes red |
|---|---|---|
| W5-AUM1 | count `dirty` without untracked files | W5-AU2 (the untracked case) |
| W5-AUM2 | fold an unmeasured `aheadOfBase` to 0 | W5-AU4b |
| W5-AUM2b | drop `base` from the fingerprint's inputs | W5-AU4 (answers `ok` instead of `fingerprint-mismatch`) |
| W5-AUM3 | skip the generation compare | W5-AU3 |
| W5-AUM4 | drop the generation from the token's inputs | W5-AU8 |
| W5-AUM5 | `touch` the lock file as the mark does | W5-AU7 |
| W5-AUM6 | fold `holders` unmeasured to `[]` | W5-AU9 |
| W5-AUM7 | put `ws-lease-audit` in `FORBIDDEN_CCD_VERBS` | W5-G14 |
| W5-AUM8 | run the git reads outside `_ws_reclaim_contained` (no `GIT_OPTIONAL_LOCKS=0`, so `git status` refreshes the index) | W5-AU7 (the admin dir's index changes) |

### PR2 at its tip

**Suites alone:** `ccd-ws-lease-audit`, `ccd-ws-lease-mark`, `ccd-ws-lease-mark-argv`, `ccd-archive`, `ccd-verb-sets`, `ccd-contexts`, `verb-gate`, `whitelist-subset`, `id-argv-census`, `delegation-wave3.integration`, `coordinator-skill`, `docs-parity`, `citations`, `growth-check` (`GROWTH_CHECK=1`) and `deviation-refs` in `server`; `whitelist-structural`, `ccd-entry-exec` and the typecheck in `agent`. **Growth check:** `ccd/ccd` about +3; nothing else listed. **Rollout:** fleet box first. **Review focus:** (1) nothing is written, by any path; (2) unmeasured never reads as unchanged; (3) the token binds the generation and the incarnation and spends nowhere; (4) `holders`' budget fits `CCD_VERB_TIMEOUT_MS`; (5) the verb is not forbidden and not named by a skill. **Must NOT:** mint a token any verb consumes; take a lock; walk `/proc` without `--holders`.

## PR3: F3, `ws-add --base`, a start point only

**Goal.** A promoting dispatch can start an ordinary child workspace at a lease's tip. `--base <full commit id>` changes only the `git worktree add` start point; the workspace's recorded base, its branch name, its PR target and every reader of `$REG/<id>.base` stay as they are.

**Branch and base.** From `main`, after wave-4 PR4 merges; parallel with PR2. **Deploy class.** FLEET (`ccd/ccd`); the server gets only the builder.

**Files.**
- `ccd/ccd#cmd_ws_add`: the strip loop's `--base` arm (both `--base <id>` and `--base=<id>`), its value check above the project positional, the object check against the main checkout before the disk floor, the add lock, the worktree and the row, and the start point in the `git worktree add` line; the lifecycle create row's new `meas.startpoint` key; the usage string. `ccd/ccd#cmd_caps`: `echo ws-add-base-v1`.
- `server/src/ccdargv.ts`: `WS_ADD_BASE_CAP`, `CCD_ARGV.wsAddWorkerBase`, `CCD_CAN.wsAddWorkerBase`.
- `CLAUDE.md`: `ws-add --base` added to PR1's coordination-invariant sentence.
- Tests: create `server/test/ccd-ws-add-base.test.ts`; modify `server/test/ccd-lifecycle-contain.test.ts` (the declared `meas.*` key count +1), `server/test/ccdCapTokens.ts`, `server/test/verb-gate.test.ts`, `server/test/whitelist-subset.test.ts`, `server/test/ccd-ws-lease-mark-argv.test.ts` (a third describe), `server/test/delegation-wave3.integration.test.ts` (the `ws-add --base` row of `W5_OPEN` gains `ccd/ccd`, `server/src/ccdargv.ts` and `CLAUDE.md` is not shipped).

**Why here.** `cmd_ws_add` is in `ccd/ccd` (growth-listed) beside PR4's spawn hunks, so it lands after wave-4 PR4; it must be on the box before PR9 can promote, and PR9 refuses on a box without it.

**Interfaces.**
- **Consumes:** `ccd/ccd#cmd_ws_add`'s strip loop and `--child` arm; `#_lc_emit`; `server/src/ccdargv.ts#CCD_ARGV.wsAddWorker`'s flag helpers (`childFlags`, `routeFlags`, `routeDefaultFlags`, `decFlags`).
- **Produces**, consumed by PR9:

  ```ts
  export const WS_ADD_BASE_CAP = 'ws-add-base-v1';
  /** A NEW key, never a widened `wsAddWorker` (`wsAddNamed`'s rule): `--base` LEADS beside `--child`, so an older ccd binds it as
   *  the project and refuses (D-6164). Composed only by a promoting dispatch; `--child` is required by the verb. */
  // CCD_ARGV.wsAddWorkerBase: (p: string, dec: ActorFlags | null, route: RouteFields | null, child: number, base: string,
  //                            slug: string | null, routeDefault: boolean) => CcdArgv
  // CCD_CAN.wsAddWorkerBase: capRow(WS_ADD_BASE_CAP)
  ```

**Shape decision.** The start point is recorded only as the journal key `meas.startpoint`, never in `$REG/<id>.base` (`D-7827`), because `cmd_pr_open`, `cmd_ws_archive`, `_ws_archive_manifest`, `_pr_bind_facts`, `_ws_reap_eval`, `cmd_ws_audit` and `server/src/registry.ts` read `.base` as a ref name.

### Task 5.3.1: `--base` on `cmd_ws_add`

**The rules.**
1. `--base` takes exactly one value (an explicit arity check; a missing value is `usage`). Given twice: `usage`.
2. Before the project positional binds: the value matches `^[0-9a-f]{40}$` or `^[0-9a-f]{64}$`, and `--child` is present; else `die` with the usage line. A refusal leaves no row, worktree, marker or pane.
3. After the main checkout is resolved and BEFORE the disk floor, the placement read, the add lock, the worktree and the row: `git -C "$main" cat-file -e "<id>^{commit}"`, contained (`_ws_reclaim_contained`), else `die "ws-add: --base <id> is not a commit of <project>"`.
4. The existing fetch and `origin/HEAD` read still run; `base` stays the ref (`origin/<default>`) and is written to `$REG/<id>.base` exactly as today. Only the `git worktree add` start point becomes `<id>`.
5. The lifecycle create row carries `meas.startpoint "<id>"` beside `meas.base`; without `--base` it carries no such key.

- [ ] **Step 1: RED rows** in `server/test/ccd-ws-add-base.test.ts`, in `ccd-ws-add-child.test.ts`'s idiom (`shStatus`, `wsAdd`, `nothingCreated`, `WS_ADD_REAL_SPAWN`, `CCD_WS_SLUG=quiet-mesa`), copied into the new file:

  ```ts
  const tipOf = (): string => {
    const at = path.join(h.home, 'projects', 'demo');
    fs.writeFileSync(path.join(at, 'lease-work.txt'), 'w\n');
    h.git(at, 'checkout', '-b', 'claude/agent-a');
    h.git(at, 'add', 'lease-work.txt'); h.git(at, 'commit', '-m', 'lease work');
    const tip = h.git(at, 'rev-parse', 'HEAD').trim();
    h.git(at, 'checkout', '-');
    return tip;
  };

  it('W5-B1: --base starts the worktree at the tip, and .base stays the origin ref', () => {
    const tip = tipOf();
    const r = wsAdd(`--no-rc --child 7 --base ${tip} demo`);
    expect(r.status, r.out).toBe(0);
    const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-mesa');
    expect(h.git(wt, 'rev-parse', 'HEAD').trim()).toBe(tip);
    expect(h.reg(ID, 'base')).toMatch(/^origin\//);
    expect(h.reg(ID, 'branch')).toBe('ws/quiet-mesa');
    expect(h.reg(ID, 'child')).toBe('7');
  });

  it('W5-B2: --base without --child is refused before anything exists', () => {
    const r = wsAdd(`--no-rc --base ${tipOf()} demo`);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/usage/);
    nothingCreated();
  });
  ```

  - **W5-B3** a short id (`abc123`), an upper-case id, a 41-hex id and a 64-hex id that is no object each refuse with nothing created; a 64-hex id in a SHA-256 fixture repository (`git init --object-format=sha256`, skipped when the fixture git lacks it) is accepted.
  - **W5-B4** a 40-hex id that is a blob, not a commit, refuses at rule 3 with nothing created (`nothingCreated`), and the add lock file is not taken (no lock file appears under the project's lock directory).
  - **W5-B5** `--base` with no value, and `--base` twice, refuse `usage`.
  - **W5-B6** the equals form `--base=<tip>` binds the same row as W5-B1.
  - **W5-B7** the lifecycle journal's create row carries `meas.startpoint` equal to the tip (`readJournal` from `lifecycleHelpers.ts`); a plain `ws-add --child 7 demo` carries none.
  - **W5-B8** an older-shaped argv: `cmd_ws_add` run from a `ccd` copy with the `--base` arm removed (a saved copy, sha checked) binds the leading `--base` as the project and refuses (`D-6164`'s safety), with nothing created.

- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/ccd-ws-add-base.test.ts`. Expected: W5-B1, W5-B6 and W5-B7 fail (`--base` is bound as the project); W5-B8 passes already (it pins today's refusal).
- [ ] **Step 3: Implement** the rules in `cmd_ws_add` in at most 25 net code lines of `ccd/ccd`, and `meas.startpoint` in its create row. Bump `ccd-lifecycle-contain.test.ts`'s declared key count by one, with the key named in its list.
- [ ] **Step 4: Run GREEN** Step 2's command, then alone: `ccd-ws-add-child`, `ccd-lifecycle-contain`, `ccd-lifecycle-emit`, `ccd-ws-add` (every file `git ls-files 'server/test/ccd-ws-add*'` lists), `ccd-pr-open` if present, `ccd-ws-archive`. Expected: green.
- [ ] **Step 5: Commit** `feat(ccd): ws-add --base starts a child workspace at a given commit, a start point only`.

### Task 5.3.2: `ws-add-base-v1` and the server's builder

- [ ] **Step 1: RED rows.** **W5-G16** caps token `ws-add-base-v1` in `CCD_CAPABILITY_TOKENS`. **W5-G17** in `ccd-ws-lease-mark-argv.test.ts`:

  ```ts
  it('W5-G17: wsAddWorkerBase leads with --child and --base, refuses a short id, and is a separate key', () => {
    const tip = 'a'.repeat(40);
    const a = [...CCD_ARGV.wsAddWorkerBase('demo', null, null, 12, tip, null, false)];
    expect(a.slice(0, 6)).toEqual(['ws-add', '--no-rc', '--child', '12', '--base', tip]);
    expect(a.indexOf('demo')).toBeGreaterThan(a.indexOf(tip));
    expect(() => CCD_ARGV.wsAddWorkerBase('demo', null, null, 12, 'abc', null, false)).toThrow();
    expect(() => CCD_ARGV.wsAddWorkerBase('demo', null, null, 12, 'A'.repeat(40), null, false)).toThrow();
    expect(CCD_CAN.wsAddWorkerBase).toEqual({ token: 'ws-add-base-v1', default: 'refuse' });
    expect(CCD_CAN.wsAddWorker).toBe('none');
  });
  ```

  **W5-G18** `whitelist-subset` layer 3: the one-token `['ws-add']` grant covers the new key (no agent change).
- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/ccd-ws-lease-mark-argv.test.ts`. Expected: W5-G17 fails.
- [ ] **Step 3: Implement** the cap word in `cmd_caps`, the constant, the builder (`['ws-add','--no-rc', ...childFlags(child), '--base', base, ...routeFlags(route), ...routeDefaultFlags(routeDefault, route), p, ...(slug === null ? [] : [slug]), ...decFlags(dec)]`, `base` checked with the verb's regex) and the `CCD_CAN` row.
- [ ] **Step 4: Run GREEN** Step 2's command, then `ccd-archive`, `ccd-verb-sets`, `verb-gate`, `whitelist-subset`, `delegation-wave3.integration` alone.
- [ ] **Step 5: Commit** `feat(ccdargv): wsAddWorkerBase behind ws-add-base-v1`.

### PR3 mutation table

| Mutant | Edit | Goes red |
|---|---|---|
| W5-BM1 | write the tip into `$REG/<id>.base` | W5-B1 |
| W5-BM2 | drop the `--child` requirement | W5-B2 |
| W5-BM3 | drop the 40/64-hex check | W5-B3 |
| W5-BM4 | move the object check after the add lock | W5-B4 (the lock file appears) |
| W5-BM5 | drop the arity check (`shift 2` bare) | W5-B5 |
| W5-BM6 | drop `meas.startpoint` | W5-B7 |
| W5-BM7 | `CCD_CAN.wsAddWorkerBase` as `'none'` | W5-G17 |

### PR3 at its tip

**Suites alone:** `ccd-ws-add-base`, `ccd-ws-add-child`, every `ccd-ws-add*`, `ccd-lifecycle-contain`, `ccd-lifecycle-emit`, `ccd-ws-archive`, `ccd-archive`, `ccd-verb-sets`, `verb-gate`, `whitelist-subset`, `ccd-ws-lease-mark-argv`, `delegation-wave3.integration`, `docs-parity`, `citations`, `growth-check` (`GROWTH_CHECK=1`), `deviation-refs`. **Growth check:** `ccd/ccd` at most +27 net code lines (this is the one `ccd/ccd` PR with a real delta); under 40, so no waiver. **Rollout:** fleet box first. **Review focus:** (1) every refusal precedes the row, the worktree, the marker, the lock and the pane; (2) `.base` and every reader of it are unchanged; (3) the start point is a full commit id of the same repository; (4) an older ccd refuses the leading flag instead of dropping it; (5) the flag is unreachable without `--child`. **Must NOT:** change the branch name, the PR target, `cmd_pr_open` or any `.base` reader; add an agent grant.

## PR4: F4, the orphan-tree lane skips a held tree, on the box and on the server

**Goal.** D-7002's "must skip an adopted lease": the orphan ladder refuses a tree whose carrier holds it, and the server's orphan lane composes no removal for a tree the delegation checkpoint holds. Both fail shut, and both are scoped to trees delegation could hold: the box rung is inert for a tree with no by-tree index entry (every tree while no carrier exists), and the server skip consults a READY checkpoint for every class the orphan lane composes (`ORPHAN_AUDITED_CLASSES`: `ccd-root`, `claude`, `superpowers`), while its `not-ready` answer stops only `claude`/`superpowers`-class trees, so a `ccd-root` tree holding no lease is composed exactly as on `main` whatever the delegation applier's phase. A `ccd-root` tree can be leased: a Bash `git worktree add ../x` run from a ccd workspace (`<worktrees-root>/<project>/<slug>`) puts the tree at `<worktrees-root>/<project>/x`, which no registry row owns, which correlation can lease as raw, which PR1's rule 6 admits (it is under the ccd worktrees root), and which `_ws_orphan_class` names `ccd-root`. The box advertises the rung as `orphan-lease-v1`.

**Branch and base.** From `main` with PR1 merged. **Consent.** The orphan lane (#1252) is another programme's lane: the coordinator obtains its owner's consent, or its claim, before Task 5.4.2 starts. **Deploy class.** FLEET first (the rung), then the server (the skip); both halves are required before PR7, PR8 or PR9 can move a carrier off `ephemeral`.

**Files.**
- `ccd/lib/disk-retention.sh#_ws_orphan_ladder` (one new rung after the registry rung, and three named token inputs), `#_ws_orphan_locked` (unchanged: it re-runs the ladder, so the rung re-runs inside the lock).
- `ccd/ccd#cmd_caps`: `echo orphan-lease-v1` (the rung's capability word); `server/test/ccdCapTokens.ts#CCD_CAPABILITY_TOKENS` gains it, and the scope census's `cmd_caps` family row already allows it (Task 5.1.1).
- `ccd/contexts.tsv`: `_dl_orphan_rung` is C4 like the rest of the lease library, so the ladder's calls into it are inside C4 and add no `ccd/contexts-edges.tsv` line.
- Create `server/src/coord/delegation-orphan-hold.ts` (L1).
- `server/src/coord/collectOrphanTree.ts` (`CollectOrphanDeps` gains `leaseHold`; `collectOrphanTree` asks it before the act, and its signature gains the census row's class: `collectOrphanTree(deps, hex, cls, obs, nowMono, epoch)`, because on `main` it receives only the tree's hex and the class lives only on the sweep's candidate row, `D-7850`), `server/src/orphanTreeLane.ts` (`OrphanJobOutcome`'s `stopped` gains `'leased' | 'lease-unready'`), `server/src/orphanTreeBeat.ts` (wires `leaseHold` from the watcher's delegation applier), `server/src/orphanTreeSweep.ts` (`OrphanTreeSweep#actOn` passes the row's `cls`, `this.memory.get(hex)?.cls`, into `collectOrphanTree`; it folds the two new `why`s as "composed nothing", and counts `lease-unready` in the orphan lane's health through `orphanTreesHealth`, so a stuck delegation applier is visible on the orphan lane's own row rather than as silence).
- Tests: create `server/test/ccd-orphan-ladder-characterise.test.ts` (Task 5.4.1) and `server/test/ccd-orphan-lease-rung.test.ts`; create `server/test/delegation-orphan-hold.test.ts`; create `server/test/delegationLeaseFixture.ts`, exporting `leaseRow(over)` (moved from `server/test/delegation-model.test.ts`'s private `lease` builder in a move commit that changes only imports) and `checkpointWithLease(over)` (an empty wave-3 checkpoint holding that one lease and its lease-owned opening lineage row, `appliedJournalSequence` at the lease's sequence), which PR5 to PR9 reuse; modify `server/test/ccd-ws-orphan-verb.test.ts`, `server/test/ccd-orphan-audit.test.ts`, `server/test/orphan-tree-lane.test.ts`, `server/test/ccd-orphan-argv.test.ts`.

**Why here.** It is the only removal path for these trees, so it must hold before anything is adopted. The box rung survives a lost checkpoint or `coord.db`; the server skip closes the window between "the journal says adopted" and "the carrier says adopted" (PR7 journals first, then marks).

**Interfaces.**
- **Consumes:** PR1's `_dl_tree_key`, `_dl_tree_owner`, `_dl_carrier_read`; `ccd/ccd#_now_s_to`; `server/src/coord/delegation-model.ts#DelegationCheckpointV1`; PR1's `DelegationCarrierState` (in `shared/api.ts`).
- **Produces**, consumed by PR5 (which widens `heldStateOf` with `transferring`):

  ```bash
  __DL_HOLD_MARGIN_S=3600     # the box keeps skipping for one hour past expiresAt (clock skew)
  _dl_orphan_rung()           # <main> <tree> -> rc 0 not held (DL_HOLD_LEASE=none); rc 1 held (refusal `leased`, DL_HOLD_* set);
                              #    rc 4 unmeasured (refusal `unmeasured`); sets DL_HOLD_LEASE DL_HOLD_GEN DL_HOLD_STATE for the token
  ```

  ```ts
  // server/src/coord/delegation-orphan-hold.ts (L1)
  export const DELEGATION_ORPHAN_HOLD_MARGIN_MS = 3_600_000;
  /** O5-1 (a): the carrier states that hold a tree back from the orphan lane; `transferring` holds without an expiry. */
  export const DELEGATION_ORPHAN_HELD_STATES = ['adopted', 'retained', 'transferring'] as const satisfies readonly DelegationCarrierState[];
  export type OrphanLeaseHold =
    | { kind: 'free' }
    | { kind: 'held'; leaseId: string; state: DelegationCarrierState; until: string | null }
    | { kind: 'not-ready'; detail: string };
  /** The orphan classes (`_ws_orphan_class`'s words) whose tree WAITS while the checkpoint is not ready. Every audited class, `ccd-root`
   *  included, is looked up in a READY checkpoint (a raw lease can sit at a `ccd-root` path); only this set's `not-ready` stops. */
  export const DELEGATION_UNREADY_HOLD_CLASSES = ['claude', 'superpowers'] as const;
  export function orphanLeaseHold(input: {
    checkpoint: DelegationCheckpointV1 | null;            // null: no applier, or not ready
    heldStateOf: (lease: DelegationLeaseRow, cp: DelegationCheckpointV1) => DelegationCarrierState;
    path: string; orphanClass: string; nowMs: number;     // orphanClass: the census row's `cls` (`OrphanClass`)
  }): OrphanLeaseHold;
  // CollectOrphanDeps.leaseHold: (path: string, orphanClass: string) => Promise<OrphanLeaseHold>
  // collectOrphanTree(deps: CollectOrphanDeps, hex: string, cls: OrphanClass, obs: OrphanObservation | null,
  //                   nowMono: () => number, epoch: number)   // `cls` is new; orphanTreeSweep.ts passes the row's class
  // The path `collectOrphanTree` hands `leaseHold` is the EXACT decode `Buffer.from(hex, 'hex').toString('utf8')`, never
  // `orphanPathOfHex` (a display helper: it collapses control characters, trims, and cuts at 300 characters).
  ```

**Rulings this PR implements.** D-7002; O5-1 (recommended (a): `adopted` and `retained` until `expiresAt`, `transferring` always, `foreign`/`released` never). Shape: both halves (`D-7828`); no marker, never switched off on its own.

### Task 5.4.1: Characterise today's orphan ladder (its own commit, green on `main`)

- [ ] **Step 1: Pin rows** in `server/test/ccd-orphan-ladder-characterise.test.ts`, on the fixtures and stubs of `ccd-ws-orphan-verb.test.ts`: for each of a clean `claude` tree, a clean `ccd-root` tree, a dirty tree, a locked tree, a tree with a registry row inside it, and a tree whose head is on no remote, record `_ws_orphan_audit`'s `verdict`, `refusal` and the NAMES of the token's input lines (print them by running `_ws_orphan_ladder` with `_ws_reclaim_fingerprint` redefined to echo its arguments). **W5-O0**: the six documents equal a committed fixture `server/test/fixtures/orphan-ladder/characterise.json`, written by this step on `main`.
- [ ] **Step 2: Run** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/ccd-orphan-ladder-characterise.test.ts`. Expected: green on `main` (it pins, it does not drive).
- [ ] **Step 3: Commit** `test(orphan): characterise the orphan ladder's verdicts and token inputs before the lease rung`.

### Task 5.4.2: The box rung

**The rules.** After the registry rung and before the locked rung of `_ws_orphan_ladder`: derive the admin record from the tree's `.git` file (`gitdir: <common>/worktrees/<name>`) and the common dir's identity (`_ws_path_ident`); `_dl_tree_owner <key>`:
1. rc 3 (proven absent, which includes "`$REG/delegation/leases/by-tree` does not exist" and "`$REG/delegation` does not exist"): not held; `DL_HOLD_LEASE=none`.
2. rc 4: refuse `unmeasured` ("the lease index entry for this tree could not be read").
3. rc 0: `_dl_carrier_read <owner>`: rc 3 or 4 refuses `unmeasured` (an index entry without a readable carrier is never "free"; the half-write of W5-L23 ends through the verb's `index-cleared` heal, PR1 rule 5, never by the rung reading it free). Then the STATE first, and only then the path (`D-7804`): a carrier in a state that cannot hold (`ephemeral`, `promoted`, `released`) is not held, whatever its `canonicalPath`, because git reuses an admin record name once the old one is pruned (and `git worktree move` keeps it), and nothing deletes a by-tree entry, so a later unleased tree on a once-leased record must never be answered `unmeasured` on every pass. A carrier in a holding state (`adopted`, `retained`, `transferring`) whose `canonicalPath` is not this tree is `unmeasured` (it may be the held tree, moved). A carrier in `transferring` at this tree refuses `leased`. A carrier in `adopted` or `retained` at this tree refuses `leased` while `now_s * 1000 <= expiresAt + __DL_HOLD_MARGIN_S * 1000`, and is not held after (O5-1 (a)); `expiresAt` null on those states is `unmeasured`.
4. The token's inputs gain `lease=<id|none>`, `leasegen=<generation|none>` and `leasestate=<state|none>`, so a carrier written between the audit and the act changes the recomputed token and the act refuses `state-changed`.

- [ ] **Step 1: RED rows** in `server/test/ccd-orphan-lease-rung.test.ts` (fixtures from `leaseFixture.ts` and `ccd-ws-orphan-verb.test.ts`'s `audit`/`orphan` helpers, copied):

  ```ts
  it('W5-O1: a tree whose carrier is adopted and unexpired is refused `leased`, and the act removes nothing', () => {
    const t = agentTree(h); mark(h);
    mark(h, { generation: '2', state: 'adopted', 'expires-at': String(Date.now() + 7 * 86_400_000), 'journal-seq': '9' });
    const a = audit(t);
    expect(a).toMatchObject({ verdict: 'refused', refusal: 'leased' });
    expect(a.token).toBeNull();
    expect(fs.existsSync(t)).toBe(true);
  }, 60_000);

  it('W5-O2: a token minted before the carrier moved is refused state-changed at the act', () => {
    const t = agentTree(h); mark(h);                                       // ephemeral: not held
    const token = tokenOf(t);
    mark(h, { generation: '2', state: 'adopted', 'expires-at': String(Date.now() + 86_400_000), 'journal-seq': '9' });
    const r = orphan(t, token);
    expect(r.doc).toMatchObject({ removed: false, refusal: 'state-changed' });
    expect(fs.existsSync(t)).toBe(true);
  }, 60_000);
  ```

  - **W5-O3** the by-tree entry is a link, a directory, or unreadable (mode 0000, skipped as root): `unmeasured`, tree kept.
  - **W5-O4** the entry names a lease whose carrier is missing, malformed, or `adopted`, `retained` or `transferring` at another path: `unmeasured`, tree kept.
  - **W5-O4b** the half-written mark of W5-L23 (the by-tree entry written, the carrier rename failed): the rung refuses `unmeasured`, no token is minted, and the tree is kept; after the verb's `index-cleared` heal (a `released` mark for that lease, W5-L23b), the same tree is not held and the ladder's later rungs decide.
  - **W5-O4c** a reused admin record: the entry names a lease whose carrier is `released` (and, separately, `ephemeral` and `promoted`) with `canonicalPath` another path; a new, unleased tree on that record at this path is not held, and a clean, pushed, quiet one yields a token.
  - **W5-O5** `retained` with `expiresAt` 30 minutes ago is still `leased` (inside the margin); 2 hours ago is not held, and the ladder's own later rungs decide (a clean, pushed, quiet tree yields a token).
  - **W5-O6** `transferring` with no `expiresAt` is `leased`.
  - **W5-O7** no `$REG/delegation` at all, and an `ephemeral`, `promoted` or `released` carrier: not held, and the six W5-O0 documents are unchanged except for the three new token input names.
  - **W5-O8** the rung runs inside the lock: `_ws_orphan_locked` with the carrier moved to `adopted` between the ladder's first run and the lock (redefine `_ws_path_users_many` to call `mark` once) refuses.
  - **W5-O2b** the token binds the generation alone: a carrier `adopted` at generation g whose `expiresAt` is 2 hours past (free); `tokenOf(t)`; then marks at g + 1 (`transferring`) and g + 2 (`adopted`, the same past `expiresAt`), so lease id and state are as they were and only `leasegen` differs; the act refuses `state-changed` because the recomputed token differs (the in-lock ladder passes, so the refusal comes from the token compare, not from the rung).
  - **W5-O9b** `cmd_caps` prints `orphan-lease-v1` (W5-G1's token list gains it).

- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/ccd-orphan-lease-rung.test.ts`. Expected: W5-O1, O2, O3, O4, O4b's first half, O5's first half, O6 and O8 fail (nothing reads a carrier); W5-O4c passes vacuously until the rung lands and is then the row W5-OM12 reds.
- [ ] **Step 3: Implement** `_dl_orphan_rung` in `ccd/lib/delegation-lease.sh` and its one call and three token lines in `_ws_orphan_ladder`. Update `server/test/fixtures/orphan-ladder/characterise.json` for the three new input names only, in its own commit, and say so in the PR body.
- [ ] **Step 4: Run GREEN** Step 2's command, then alone: `ccd-orphan-ladder-characterise`, `ccd-ws-orphan-verb`, `ccd-orphan-audit`, `ccd-orphan-argv`, `ccd-contexts`. Expected: green.
- [ ] **Step 5: Commit** `feat(orphan): the orphan ladder refuses a tree its delegation carrier holds, and fails shut`.

### Task 5.4.3: The server skip, from the checkpoint

**The rules (`orphanLeaseHold`).** `checkpoint === null` (the applier is not ready): a tree whose `orphanClass` is in `DELEGATION_UNREADY_HOLD_CLASSES` answers `not-ready`; any other class (`ccd-root`) answers `free`, so the orphan lane, another programme's lane, keeps composing those trees exactly as on `main` while the delegation applier is unready (before its first recovery, or on a server rolled back past PR5b), and the box rung still refuses any of them independently while its by-tree entry stands. A READY checkpoint is consulted for EVERY class, before any class test: a `retained` raw lease at a `ccd-root` path is `held` like any other, so the window between PR8's journalled `retained` and the lane's next mark (the carrier still reads `ephemeral`, so the box rung does not hold yet) is closed by the server skip for that tree too (`D-7811`). With the checkpoint ready, find the unreleased lease (`releasedAt === null`) whose `canonicalPath` equals `path` exactly; none answers `free`. Its state is `heldStateOf(lease, cp)` (in this PR: the lease's `disposition`, PR5 widens it to `transferring`). A state outside `DELEGATION_ORPHAN_HELD_STATES` is `free`. `transferring` is `held` with `until: null`. `adopted` or `retained` is `held` while `nowMs <= parse(cleanupDueAt) + DELEGATION_ORPHAN_HOLD_MARGIN_MS` (the expiry, `D-7829`), else `free`; a null `cleanupDueAt` on those states answers `not-ready` with a detail. `collectOrphanTree` asks `deps.leaseHold(path, cls)` (`cls` the census row's `OrphanClass`, `server/src/orphanTreeLane.ts`, now passed in by `orphanTreeSweep.ts`; `path` the exact `Buffer.from(hex, 'hex').toString('utf8')`, compared byte for byte with `canonicalPath`, never `orphanPathOfHex`'s cleaned and 300-character display form, which would answer `free` for a held tree with a long or unusual path and reopen `D-7811`'s window while the carrier still reads `ephemeral`, `D-7850`) after the audit and before the license check: `held` returns `{kind:'stopped', why:'leased'}`, `not-ready` returns `{kind:'stopped', why:'lease-unready'}`; both compose nothing. A path the server does not match while the box does is still refused by the box rung.

- [ ] **Step 1: RED rows** in `server/test/delegation-orphan-hold.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { orphanLeaseHold } from '../src/coord/delegation-orphan-hold.js';
  import { checkpointWithLease } from './delegationLeaseFixture.js';

  const NOW = Date.parse('2026-11-10T12:00:00Z');
  const byDisposition = (l: { disposition: string }) => l.disposition as never;

  describe('orphanLeaseHold', () => {
    it('W5-O9: no checkpoint is not-ready, never free', () => {
      expect(orphanLeaseHold({ checkpoint: null, heldStateOf: byDisposition, orphanClass: 'claude', path: '/p/demo/.claude/worktrees/agent-a', nowMs: NOW }).kind)
        .toBe('not-ready');
    });
    it('W5-O10: an adopted lease is held until its expiry plus the margin, then free', () => {
      const cp = checkpointWithLease({ canonicalPath: '/p/t', disposition: 'adopted', cleanupDueAt: '2026-11-10T11:30:00.000Z' });
      expect(orphanLeaseHold({ checkpoint: cp, heldStateOf: byDisposition, orphanClass: 'claude', path: '/p/t', nowMs: NOW }))
        .toMatchObject({ kind: 'held', state: 'adopted' });
      expect(orphanLeaseHold({ checkpoint: cp, heldStateOf: byDisposition, orphanClass: 'claude', path: '/p/t', nowMs: NOW + 2 * 3_600_000 }).kind).toBe('free');
    });
    it('W5-O11: an ephemeral, promoted or released lease is free; another path is free', () => {
      for (const disposition of ['ephemeral', 'promoted'] as const) {
        const cp = checkpointWithLease({ canonicalPath: '/p/t', disposition, cleanupDueAt: null });
        expect(orphanLeaseHold({ checkpoint: cp, heldStateOf: byDisposition, orphanClass: 'claude', path: '/p/t', nowMs: NOW }).kind).toBe('free');
      }
      const released = checkpointWithLease({ canonicalPath: '/p/t', disposition: 'retained', cleanupDueAt: '2026-12-01T00:00:00.000Z', releasedAt: '2026-11-09T00:00:00.000Z' });
      expect(orphanLeaseHold({ checkpoint: released, heldStateOf: byDisposition, orphanClass: 'claude', path: '/p/t', nowMs: NOW }).kind).toBe('free');
    });
    it('W5-O12: a held disposition with no expiry is not-ready', () => {
      const cp = checkpointWithLease({ canonicalPath: '/p/t', disposition: 'retained', cleanupDueAt: null });
      expect(orphanLeaseHold({ checkpoint: cp, heldStateOf: byDisposition, orphanClass: 'claude', path: '/p/t', nowMs: NOW }).kind).toBe('not-ready');
    });
    it('W5-O12b: a ccd-root or other tree is free even with no checkpoint', () => {
      for (const orphanClass of ['ccd-root', 'other']) {
        expect(orphanLeaseHold({ checkpoint: null, heldStateOf: byDisposition, orphanClass, path: '/w/demo/quiet-mesa', nowMs: NOW }).kind).toBe('free');
      }
    });
    it('W5-O12c: a ready checkpoint holds a retained lease at a ccd-root path', () => {
      const cp = checkpointWithLease({ canonicalPath: '/w/demo/x', sourceKind: 'raw', disposition: 'retained', cleanupDueAt: '2026-11-17T12:00:00.000Z' });
      expect(orphanLeaseHold({ checkpoint: cp, heldStateOf: byDisposition, orphanClass: 'ccd-root', path: '/w/demo/x', nowMs: NOW }))
        .toMatchObject({ kind: 'held', state: 'retained' });
    });
  });
  ```

  - **W5-O13** (`orphan-tree-lane.test.ts`): with `leaseHold` answering `held`, the live lane composes no `ws-orphan` argv for that tree (the recorded `runCcd` calls hold no `ws-orphan`); with `free` it composes exactly what `main` composes. A second case drives the real `orphanLeaseHold` over a ready checkpoint holding a `retained` lease whose `canonicalPath` is over 300 characters (and, separately, one holding a tab): the sweep's act passes the row's class and the exact decoded path, the answer is `held`, and no `ws-orphan` argv is composed for that tree.
  - **W5-O13b** (`orphan-tree-lane.test.ts`): with the real `orphanLeaseHold` and `delegationCheckpointIfReady()` answering null (`not-ready`), a pass over one `claude` tree and one `ccd-root` tree composes no `ws-orphan` for the `claude` tree and composes the `ccd-root` tree's argv exactly as on `main`; the orphan lane's health counts `lease-unready: 1`.
- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/delegation-orphan-hold.test.ts`, then `test/orphan-tree-lane.test.ts`. Expected: import fails; W5-O13 fails (no `leaseHold` dep).
- [ ] **Step 3: Implement** the module (imports only `shared/api.js` and `./delegation-model.js`), the dep, the two `why`s, and the beat's wiring: `leaseHold: async (p, cls) => { const cp = await watcher.delegationCheckpointIfReady(); return orphanLeaseHold({ checkpoint: cp, heldStateOf: (l) => l.disposition, path: p, orphanClass: cls, nowMs: Date.now() }); }`, where `delegationCheckpointIfReady()` is a new `FleetWatcher` method returning the applier's current checkpoint when its phase is `ready`, else null (a read, no write).
- [ ] **Step 4: Run GREEN** Step 2's commands, then `rings/totality`, `rings/watcher-store-port`, `coord-policy-rings`, `ccd-orphan-argv`, `single-definition/kernel-tail-journal`, `single-definition/advance-switches` alone.
- [ ] **Step 5: Commit** `feat(orphan): the orphan lane composes no removal for a tree the delegation checkpoint holds`.

### PR4 mutation table

| Mutant | Edit | Goes red |
|---|---|---|
| W5-OM1 | delete the rung's call | W5-O1 |
| W5-OM2 | fold the index's rc 4 to "not held" | W5-O3 |
| W5-OM3 | fold a missing carrier behind an index entry to "not held" | W5-O4, W5-O4b (its first half) |
| W5-OM12 | move the `canonicalPath` compare back ahead of the state test | W5-O4c (the reused record answers `unmeasured`) |
| W5-OM4 | drop the margin | W5-O5 (the 30-minute case) |
| W5-OM5 | drop `transferring` from the held states | W5-O6 |
| W5-OM6 | drop `leasegen` from the token's inputs | W5-O2b (W5-O2 survives it: the in-lock rung refuses `leased` whatever the token) |
| W5-OM7 | answer `free` on a null checkpoint | W5-O9, W5-O13b |
| W5-OM8 | skip the `leaseHold` ask in `collectOrphanTree` | W5-O13 |
| W5-OM13 | hand `leaseHold` `orphanPathOfHex(hex)` instead of the exact decode | W5-O13 (the over-300-character and tab cases answer `free`) |
| W5-OM9 | answer `not-ready` for every class on a null checkpoint | W5-O12b, W5-O13b (the `ccd-root` tree is not composed) |
| W5-OM11 | answer `free` for a `ccd-root` tree before consulting a ready checkpoint | W5-O12c |
| W5-OM10 | drop `orphan-lease-v1` from `cmd_caps` | W5-O9b, W5-G1 |

### PR4 at its tip

**Suites alone:** `ccd-orphan-ladder-characterise`, `ccd-orphan-lease-rung`, `ccd-ws-orphan-verb`, `ccd-orphan-audit`, `ccd-orphan-argv`, `orphan-tree-lane`, `delegation-orphan-hold`, `ccd-contexts`, `rings/totality`, `rings/watcher-store-port`, `coord-policy-rings`, `single-definition` (each file alone), `delegation-wave3.integration`, `docs-parity`, `citations`, `growth-check` (`GROWTH_CHECK=1`), `deviation-refs`. **Growth check:** `ccd/ccd` +1 (the cap word); `server/src/watch.ts` at most +6 (the `delegationCheckpointIfReady` read), waived anyway by the new coord file. **Rollout:** fleet box first (the rung), then the server box; the coordinator measures both before PR7, PR8 or PR9 dispatches, and reads `orphan-lease-v1` in the box's capability list. **Review focus:** (1) every unreadable answer refuses; (2) the rung runs inside the lock and changes the token; (3) the expiry margin and the held set are O5-1's; (4) the server skip composes nothing for a `claude`/`superpowers` tree when not ready, composes an unleased `ccd-root` tree as `main` does, holds a leased tree of any class when ready, and counts `lease-unready`; (5) characterisation shows the ladder unchanged apart from three named inputs. **Must NOT:** add a marker or switch for the skip; remove or rescue anything new; change any other rung's order or words.

## PR5: S1, lease transitions and release in the journal (two pull requests: PR5a reader, PR5b writers)

**Goal.** A lease can change state durably: three new journal entry kinds, applied by new `DelegationDurability` doors in O5's order, checked by one L1 transition table and a loosened `assertLease`, projected to SQLite by a delta arm, carried by wave-4 PR3's compaction while the lease is open, and freed when it is released. The first writer of `releasedAt` is the native-removed release.

**Expand, then contract (`D-7809`).** The journal grammar is closed: `server/src/coord/delegation-journal.ts` refuses an unknown kind ("entry kind … is not in the closed grammar"), so once one new kind is journalled, any older server the box returns to (`ccrc rollback`, the server box's unattended `ccrc-update-watchdog` rollback) stays `reconstructing` for good, and PR4's server skip then stops the orphan lane's leasable trees. So this PR ships as two:
- **PR5a (S1a, reader only):** Tasks 5.5.1 and 5.5.2: the L1 table, the three kinds in the grammar, the loosened guard and the builder's folds, `computeHolds` and the delta arms that apply them. No door, no lane phase and no other code writes a new kind. It merges and rolls out to the server box and stays there for at least one release before PR5b merges. PR5a's grammar also carries every field a later wave-5 writer fills under O5-8 (c), so no later PR adds grammar: the `resolvesThrough` field of `lease-transition` and `lease-released` (PR8's resolve writes it, PR5b's doors write null) and the carrier row's `resolvedThrough` and `releaseReason` (which PR8's conflict and disown derivations read). Row **W5-J7b** (`delegation-recovery.test.ts`'s rig, on the PR5a build): a journal holding `lease-transition`, `lease-carrier-seen` and `lease-released` entries, written by the rig's raw appender (as PR5b's and PR8's doors would), including an `attach` transition and a `foreign` release each with `resolvesThrough` set, recovers to `ready` and folds each (the carrier row's `resolvedThrough` and `releaseReason` read back). Under O5-8 (a) or (b), PR8a carries its own W5-J7b twin for `tree-resolved` and the attach entry.
- **PR5b (S1b, writers):** Tasks 5.5.3 and 5.5.4: the doors, the lane phase and native-removed release. Its body's first lines after the soak line state the rollback floor: "From this PR on, the server box never runs a build older than PR5a."

**Branch and base.** PR5a from `main` after wave-4 PR3 merges (this PR's holds feed PR3's K1); PR5b from `main` with PR5a merged and measured on the server box. Independent of PR1-PR4. **Deploy class.** SERVER, twice.

**Files.**
- Create `server/src/coord/delegation-lease-state.ts` (L1): the transition table, the carrier-state derivation, the native-removed planner.
- `server/src/coord/delegation-model.ts`: the three entry kinds in `DelegationJournalEntryV1` and `DELEGATION_JOURNAL_ENTRY_KINDS`; `assertWave3Lease` and `assertWave3Leases` renamed `assertLease` and `assertLeases` and loosened; two refusals in `DELEGATION_MODEL_REFUSALS`; the checkpoint's optional `leaseCarriers` member and its row type; `isDelegationModelKebab` reads the new tables.
- `server/src/coord/delegation-checkpoint.ts`: the builder folds the new kinds (`leaseFacts` gains the transition records), `computeHolds`, `validateDelegationCheckpoint`, and the doors `transitionLease`, `releaseLease`, `noteCarrierSeen` beside `createLease`; the `DelegationDurabilityDeps#randomUUID` docstring stays true (no new caller).
- `server/src/coord/store.ts`: `CoordStore#projectDelegationCheckpointChanges`' delta gains a `delegation_leases` arm and a `delegation_lineage` arm.
- `server/src/watch.ts`: a `leaseActs` phase after `reconcile` in `DelegationLane#run` (native-removed only in this PR), its key in `DELEGATION_PASS_SLOW_KEYS`, and the lane memory `absentListings`.
- `shared/api.ts` (PR5b): an optional `uncensusedLeases?: number` member of `DelegationObservationHealth` (unreleased leases whose project the pass did not census, so native-removed neither counted nor released them), one reader, absence permits.
- `server/src/orphanTreeBeat.ts`: PR4's `heldStateOf` becomes `(l, cp) => delegationCarrierStateOf(l, cp.leaseCarriers?.find((c) => c.leaseId === l.leaseId))`, so a `transferring` lease is held on the server too (row W5-O14 in `delegation-orphan-hold.test.ts`: a lease with a `transferringSince` carrier row is `held` with `until: null`).
- Tests: create `server/test/delegation-lease-state.test.ts` and `server/test/delegation-lease-durability.test.ts`; modify `server/test/delegation-model.test.ts` (the renamed guard), `server/test/delegation-delta-applier.test.ts`, `server/test/delegation-recovery.test.ts`, wave-4 PR3's compaction test file (named by PR3's plan text `server/test/delegation-compaction.test.ts`; re-point by content), `server/test/single-definition/kernel-tail-journal.test.ts`, `server/test/single-definition/advance-switches.test.ts`, `server/test/mail-routes.test.ts`, `server/test/delegation-wave3.integration.test.ts` (the "future-facing columns" row now allows the wave-5 writers), `server/test/delegationLeaseFixture.ts`.

**Why here.** Every later server PR writes through these doors. It needs PR3's retained reader and carry rules, because a transition record must survive compaction while its lease is open.

**Interfaces.**
- **Consumes:** `DelegationDurability#createLease`'s queue and `commitLocked`; `deriveDelegationLineageId`; wave-4 PR3's `readDelegationRetainedRecords`, `DelegationDurability#compactJournal` and K1 (`open-lease`, `open-lineage` holds), by its plan text; `server/src/coord/gitref.ts#readWorktreeCensus`'s rows through the lane's `passCensus`.
- **Produces**, consumed by PR6-PR9:

  ```ts
  // delegation-model.ts — the journal grammar (additive kinds; the record envelope is unchanged)
  | { kind: 'lease-transition'; leaseId: string; generation: number; reason: DelegationLeaseTransitionReason;
      to: DelegationCarrierState; at: string; expiresAt: string | null; runId: number | null; promotedSession: string | null;
      auditEvidence: string | null; lineageClose: DelegationLineageCloseReason | null; lineageOpenRun: number | null;
      resolvesThrough: DelegationAttemptMark | null }
  | { kind: 'lease-released'; leaseId: string; generation: number; releaseReason: DelegationLeaseReleaseReason; at: string;
      lastHeadSha: string | null; resolvesThrough: DelegationAttemptMark | null }
  | { kind: 'lease-carrier-seen'; leaseId: string; generation: number; at: string }
  /** The operator's resolution of a conflict (spec §5.4): the newest attempt on the lease's tree when resolve acted, by the
   *  projection's own ordering (`attemptedAt`, then `attemptId`). An attempt ordered at or below it is resolved. */
  export interface DelegationAttemptMark { attemptedAt: string; attemptId: string }
  export interface DelegationLeaseCarrierRow {        // checkpoint-only, one per lease that has any non-null field
    leaseId: string; transferringSince: string | null; transferRun: number | null;
    promotedRun: number | null; promotedSession: string | null; releaseReason: DelegationLeaseReleaseReason | null;
    resolvedThrough: DelegationAttemptMark | null;
  }
  // DelegationCheckpointV1 gains `leaseCarriers?: readonly DelegationLeaseCarrierRow[]`, ABSENT when empty
  export function assertLease(lease: DelegationLeaseRow, carrier: DelegationLeaseCarrierRow | undefined, applied: number): void;
  export function assertLeases(cp: DelegationCheckpointV1): void;

  // delegation-lease-state.ts (L1)
  export const DELEGATION_LEASE_TRANSITION_REASONS = ['carrier', 'adopt', 'retain', 'operator-retain', 'attach', 'transfer',
    'transfer-refused', 'transfer-recovered', 'promote'] as const;
  export type DelegationLeaseTransitionReason = (typeof DELEGATION_LEASE_TRANSITION_REASONS)[number];
  export const DELEGATION_LINEAGE_CLOSE_REASONS = ['native-removed', 'transferred', 'foreign', 'transfer'] as const;
  export type DelegationLineageCloseReason = (typeof DELEGATION_LINEAGE_CLOSE_REASONS)[number];
  export const DELEGATION_LEASE_ACT_REFUSALS = ['lease-unknown', 'lease-released', 'stale-generation', 'wrong-disposition',
    'not-ready', 'carrier-behind'] as const;
  /** The reasons that start a new step from a settled state, and so refuse `carrier-behind` while the box's carrier has not caught
   *  up (`carrierGenerationSeen < generation`) on a box that reports `lease-mark-v1`. `carrier` mints the first carrier, and
   *  `transfer-refused`, `transfer-recovered` and `promote` finish a transfer whose marks PR9 drives synchronously. */
  export const DELEGATION_CARRIER_GATED_REASONS = ['adopt', 'retain', 'operator-retain', 'attach', 'transfer'] as const
    satisfies readonly DelegationLeaseTransitionReason[];
  export type DelegationLeaseActRefusal = (typeof DELEGATION_LEASE_ACT_REFUSALS)[number];
  export const DELEGATION_LEASE_EXPIRY_MS = 7 * 86_400_000;                 // A3: approved with this plan
  /** One row per reason: the states it may start from, and where it goes ('prior' = the lease's disposition). */
  export const DELEGATION_LEASE_TRANSITIONS: Readonly<Record<DelegationLeaseTransitionReason,
    { from: readonly DelegationCarrierState[]; to: DelegationCarrierState | 'prior' }>>;
  export function delegationCarrierStateOf(lease: DelegationLeaseRow, carrier: DelegationLeaseCarrierRow | undefined): DelegationCarrierState;
  export function decideLeaseTransition(lease: DelegationLeaseRow | undefined, carrier: DelegationLeaseCarrierRow | undefined,
    req: { reason: DelegationLeaseTransitionReason; expectGeneration: number; carrierRequired: boolean }):
    | { ok: true; to: DelegationCarrierState; generation: number }
    | { ok: false; refusal: DelegationLeaseActRefusal; detail: string };
  export interface NativeRemovedInput { checkpoint: DelegationCheckpointV1;
    censused: ReadonlySet<string>;        // the projects whose census THIS pass is a measured success (`laneFlatCensus`'s `censused`)
    listed: ReadonlySet<string>;          // delegationTreeKey(project, adminRecord) of every record a censused project's listing names
    absent: ReadonlySet<string>;          // the listed keys whose census `state` is `absent` (gitdir, HEAD and locked each ENOENT)
    unreadable: ReadonlySet<string>;      // the listed keys whose census `state` is `unreadable`; all three by `delegationTreeKey`
    absentListings: ReadonlyMap<string, number> }                       // leaseId -> consecutive successful listings absent
  export function planNativeRemoved(input: NativeRemovedInput): {
    release: readonly { leaseId: string; expectGeneration: number; releaseReason: 'native-removed' | 'transferred' }[];
    absentListings: Map<string, number> };

  // delegation-checkpoint.ts — DelegationDurability, beside createLease
  transitionLease(req: DelegationLeaseTransitionRequest): Promise<DelegationLeaseActOutcome>;
  releaseLease(req: DelegationLeaseReleaseRequest): Promise<DelegationLeaseActOutcome>;
  noteCarrierSeen(req: { leaseId: string; generation: number; at: string }): Promise<DelegationLeaseActOutcome>;
  export interface DelegationLeaseTransitionRequest { leaseId: string; expectGeneration: number;
    reason: DelegationLeaseTransitionReason; at: string; expiresAt: string | null; runId: number | null;
    promotedSession: string | null; auditEvidence: string | null;
    /** The caller measured `lease-mark-v1` on the box (`capSupported`); the door passes it into `decideLeaseTransition`. The
     *  durability layer knows no capability, so it never derives this itself; the replay fold passes `false`. */
    carrierRequired: boolean;
    resolvesThrough: DelegationAttemptMark | null }                   // PR8's resolve of a conflicting tree; null elsewhere
  export interface DelegationLeaseReleaseRequest { leaseId: string; expectGeneration: number;
    releaseReason: DelegationLeaseReleaseReason; at: string; lastHeadSha: string | null;
    resolvesThrough: DelegationAttemptMark | null }
  export type DelegationLeaseActOutcome =
    | { kind: 'applied'; leaseId: string; generation: number; state: DelegationCarrierState; sequence: number; applied: DelegationApplyOutcome }
    | { kind: 'unchanged'; leaseId: string; generation: number; state: DelegationCarrierState }
    | { kind: 'refused'; refusal: DelegationLeaseActRefusal; detail: string };
  ```

**The transition table (`DELEGATION_LEASE_TRANSITIONS`).**

| Reason | From | To | Writes |
|---|---|---|---|
| `carrier` | `ephemeral` at generation 0 only | `ephemeral` | generation 1, the lease's first carrier (`D-7830`) |
| `adopt` | `ephemeral` | `adopted` | `adoptedAt`, `terminalEvidenceAt`, `cleanupDueAt = at + 7 d` (the expiry, `D-7829`) |
| `retain`, `operator-retain`, `attach` | `ephemeral`, `adopted`, `retained` | `retained` | `retainedAt`, `cleanupDueAt = at + 7 d` |
| `transfer` | `ephemeral`, `adopted`, `retained` | `transferring` | carrier row `transferringSince`, `transferRun` |
| `transfer-refused`, `transfer-recovered` | `transferring` | prior | carrier row `transferringSince = null`, `transferRun = null` |
| `promote` | `transferring` | `promoted` | `promotedAt`; carrier row `promotedRun`, `promotedSession`; the lease's open lineage closes `transfer` and a run-owned lineage row for `runId` opens under the same parent |
| `lease-released` (its own kind) | any unreleased state but `transferring` | `released` | `releasedAt`; carrier row `releaseReason`; the lease's open lineage closes with the release reason |

An entry whose `resolvesThrough` is non-null (only PR8's resolve writes one: `attach` and a `foreign` release of a conflicting lease) also sets the carrier row's `resolvedThrough` to it; a later `resolvesThrough` replaces it only when ordered above it. Every applied generation-writing entry (`lease-transition` and `lease-released`) sets `generation = expectGeneration + 1` and `currentJournalSequence` to its own sequence; `lease-carrier-seen` writes neither (below), so a lease's `currentJournalSequence` is always the sequence of the transition that wrote its current generation, and a carrier's `journalSeq` (written from the lease at mark time) is that same sequence (`D-7851`). `cleanupState` stays `not-due` and the cleanup clocks stay null: wave 5 has no cleaner (D-7002). Adoption opens no second lineage edge: the lease's own opening edge is already open and nests the row (`D-7831`). A request whose reason and `expectGeneration + 1` are already the lease's last applied transition answers `unchanged` (idempotent replay, spec §5.12). `lease-carrier-seen` sets `carrierGenerationSeen` and changes neither the generation nor `currentJournalSequence`: if it moved the sequence, the carrier's `journalSeq` would stop equalling the lease's after every `seen`, PR6's rule 4 would never match again, rule 5 would count the lease `mismatched` for good, and a same-generation re-drive would carry a different `journalSeq`, which the verb refuses `generation-conflict` (a standing refusal).

**`carrier-behind` (`D-7806`).** With `carrierRequired` true (the caller measured `lease-mark-v1` on the box through `capSupported`), a reason in `DELEGATION_CARRIER_GATED_REASONS` refuses `carrier-behind` while `carrierGenerationSeen === null || carrierGenerationSeen < generation`; the replay fold passes `carrierRequired: false` (the journal already holds the decision). So a second Retain, or a Retain racing an adoption, answers 409 instead of moving the journal a second step ahead of a carrier that has not been read back; together with the verb's monotonic rule (`D-7802`) a carrier behind the journal always catches up on the next mark.

**`assertLease` (loosened).** `generation >= 0`; `creatingJournalSequence <= currentJournalSequence <= appliedJournalSequence`; generation 0 iff the two sequences are equal; `disposition` per the carrier state; `adopted` and `retained` have a non-null `cleanupDueAt` (refusal `lease-expiry`); `promoted` has `promotedAt` and a carrier row with `promotedRun`; `cleanupState === 'not-due'` and `cleanupStartedAt`, `cleanupFinishedAt`, `cleanupEvidenceJson` null; `carrierGenerationSeen` null or in `1..generation`; `releasedAt` null or not before `firstObservedAt`; a carrier row whose lease is absent, or that is all-null, refuses `lease-carrier-row`; the opening lineage row rule of `assertWave3Leases` holds.

### Task 5.5.1: The L1 transition table and the carrier-state derivation

- [ ] **Step 1: RED rows** in `server/test/delegation-lease-state.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { DELEGATION_CARRIER_STATES } from '../../shared/api.js';
  import { DELEGATION_LEASE_TRANSITIONS, decideLeaseTransition, delegationCarrierStateOf } from '../src/coord/delegation-lease-state.js';
  import { leaseRow } from './delegationLeaseFixture.js';

  describe('the one lease transition table', () => {
    it('W5-J1: every row starts and ends in carrier states, and no row starts from released or promoted', () => {
      for (const [reason, row] of Object.entries(DELEGATION_LEASE_TRANSITIONS)) {
        for (const f of row.from) expect(DELEGATION_CARRIER_STATES, reason).toContain(f);
        expect(row.from, reason).not.toContain('released');
        expect(row.from, reason).not.toContain('promoted');
      }
    });
    it('W5-J2: adopt only from ephemeral; retain from ephemeral, adopted or retained; promote only from transferring', () => {
      const l = (disposition: 'ephemeral' | 'adopted' | 'retained' | 'promoted', generation = 1) => leaseRow({ disposition, generation });
      expect(decideLeaseTransition(l('ephemeral'), undefined, { reason: 'adopt', expectGeneration: 1 })).toEqual({ ok: true, to: 'adopted', generation: 2 });
      expect(decideLeaseTransition(l('adopted'), undefined, { reason: 'adopt', expectGeneration: 1 })).toMatchObject({ ok: false, refusal: 'wrong-disposition' });
      expect(decideLeaseTransition(l('retained'), undefined, { reason: 'retain', expectGeneration: 1 })).toMatchObject({ ok: true, to: 'retained' });
      expect(decideLeaseTransition(l('promoted'), undefined, { reason: 'retain', expectGeneration: 1 })).toMatchObject({ ok: false, refusal: 'wrong-disposition' });
      expect(decideLeaseTransition(l('retained'), undefined, { reason: 'promote', expectGeneration: 1 })).toMatchObject({ ok: false, refusal: 'wrong-disposition' });
    });
    it('W5-J3: a transfer goes back to the prior disposition, never to ephemeral by default', () => {
      const lease = leaseRow({ disposition: 'adopted', generation: 3 });
      const carrier = { leaseId: lease.leaseId, transferringSince: '2026-11-10T12:00:00.000Z', transferRun: 12,
        promotedRun: null, promotedSession: null, releaseReason: null };
      expect(delegationCarrierStateOf(lease, carrier)).toBe('transferring');
      expect(decideLeaseTransition(lease, carrier, { reason: 'transfer-refused', expectGeneration: 3 })).toEqual({ ok: true, to: 'adopted', generation: 4 });
      expect(decideLeaseTransition(lease, carrier, { reason: 'retain', expectGeneration: 3 })).toMatchObject({ ok: false, refusal: 'wrong-disposition' });
    });
    it('W5-J4: a stale generation, an unknown lease and a released lease each refuse with their own word', () => {
      expect(decideLeaseTransition(leaseRow({ generation: 2 }), undefined, { reason: 'retain', expectGeneration: 1 })).toMatchObject({ refusal: 'stale-generation' });
      expect(decideLeaseTransition(undefined, undefined, { reason: 'retain', expectGeneration: 1 })).toMatchObject({ refusal: 'lease-unknown' });
      expect(decideLeaseTransition(leaseRow({ releasedAt: '2026-11-09T00:00:00.000Z' }), undefined, { reason: 'retain', expectGeneration: 1 })).toMatchObject({ refusal: 'lease-released' });
    });
    it('W5-J5: carrier is only the first transition', () => {
      expect(decideLeaseTransition(leaseRow({ generation: 0 }), undefined, { reason: 'carrier', expectGeneration: 0 })).toEqual({ ok: true, to: 'ephemeral', generation: 1 });
      expect(decideLeaseTransition(leaseRow({ generation: 1 }), undefined, { reason: 'carrier', expectGeneration: 1 })).toMatchObject({ ok: false });
    });
  });
  ```

  (The literal requests above omit `carrierRequired`; each passes `carrierRequired: false`, written out in the file.) Plus **W5-J5b**: a `retained` lease at generation 3 with `carrierGenerationSeen: 2` refuses `retain` `carrier-behind` with `carrierRequired: true` and passes with `false`; with `carrierGenerationSeen: 3` it passes either way; `transfer-refused` and `promote` from `transferring` never refuse `carrier-behind`; `carrier` at generation 0 with `carrierGenerationSeen: null` passes. Plus **W5-V3** in `vocabularies.test.ts`: `DELEGATION_LEASE_TRANSITION_REASONS`, `DELEGATION_LINEAGE_CLOSE_REASONS` and `DELEGATION_LEASE_ACT_REFUSALS` are each declared once, in `delegation-lease-state.ts`, with the members above, and `mail-routes.test.ts` admits `isDelegationLeaseStateKebab` (derived from the three tables).
- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/delegation-lease-state.test.ts`. Expected: the module does not exist.
- [ ] **Step 3: Implement** the module; it imports only `shared/api.js` and `./delegation-model.js` (types).
- [ ] **Step 4: Run GREEN** Step 2's command, then `rings/totality`, `coord-policy-rings`, `single-definition/vocabularies`, `single-definition/kernel-tail-journal`, `mail-routes` alone.
- [ ] **Step 5: Commit** `feat(delegation): the one lease transition table, in L1`.

### Task 5.5.2: The journal kinds, the loosened guard and the builder's fold

- [ ] **Step 1: RED rows.**
  - **W5-J6** (`delegation-model.test.ts`): `assertLease` accepts each legal shape of the table (one lease per row, built by `leaseRow` and a carrier row) and refuses: `adopted` without `cleanupDueAt` (`lease-expiry`), `cleanupState: 'pending'` (`lease-cleanup-state`), `carrierGenerationSeen` above `generation`, a carrier row with no lease (`lease-carrier-row`), `currentJournalSequence` past the applied sequence (`lease-without-journal-entry`). The rename leaves no `assertWave3Lease` text in `server/src` (`git grep`).
  - **W5-J7** (`delegation-recovery.test.ts`'s rig): a journal of `lease-created`, `lease-transition` (`carrier`), `lease-transition` (`adopt`), `lease-carrier-seen` and `lease-transition` (`retain`) recovers to a checkpoint whose lease is `retained` at generation 3 with `carrierGenerationSeen` 2; a `lease-transition` whose `generation` skips one, or names an unknown lease, refuses recovery (the lane stays `reconstructing`) rather than folding it.
  - **W5-J8** (`delegation-lease-durability.test.ts`): `computeHolds` holds every transition record of an unreleased lease as `open-lease`; after `lease-released` none of that lease's records is held, and its opening lineage row is closed with the release reason.
- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/delegation-model.test.ts`, then `test/delegation-recovery.test.ts`. Expected: the kinds do not exist; `assertLease` is not exported.
- [ ] **Step 3: Implement** the union arms and table entries, the rename at all three call sites (`prepareDelegationProjectionChanges`, `CoordStore#projectDelegationCheckpoint`, `validateDelegationCheckpoint`), the guard, the builder's folds (each through `decideLeaseTransition`, so replay and the live door share one decision), `leaseFacts`' transition records and `computeHolds`. The checkpoint encoder omits `leaseCarriers` when it is empty, so a checkpoint with no transition is byte-identical to `main`'s.
- [ ] **Step 4: Run GREEN** Step 2's commands, then `delegation-checkpoint`, `delegation-delta-applier`, `delegation-wave3.integration` and PR3's compaction suite alone.
- [ ] **Step 5: Commit** `feat(delegation): lease-transition, lease-released and lease-carrier-seen, folded through one decision`.

### Task 5.5.3: The doors, the delta projection and compaction

- [ ] **Step 1: RED rows** in `delegation-lease-durability.test.ts`, on the recovery rig with a real `CoordStore` (`openCoordDb` on an `mkTmp` path):
  - **W5-J9** `transitionLease({reason:'adopt', expectGeneration:1, ...})` appends one record, checkpoints and projects: the `delegation_leases` row reads `adopted`, generation 2, and the projection ran in `delta` mode (the outcome's `projection.mode`). The same request again answers `unchanged` and appends nothing.
  - **W5-J9b** the door honours `carrierRequired`: a `retained` lease at generation 3 with `carrierGenerationSeen: 2`, `transitionLease({reason:'retain', expectGeneration:3, carrierRequired:true, ...})` answers `refused` `carrier-behind` and appends nothing; the same request with `carrierRequired:false` is `applied`; recovery of a journal holding that applied entry folds it (the replay fold passes `false`).
  - **W5-J10** compaction after a transition (PR3's `compactJournal` with a floor that puts every record below the cut): the carried file holds the lease's `lease-created` and every transition record; recovery from the compacted pair gives a checkpoint byte-equal to the uncompacted one; after `releaseLease`, a second compaction carries none of them.
  - **W5-J10b** (D-6999's ±20-minute window, wave-4 PR3's rule K5, pinned now that `releasedAt` has writers): compaction with an UNRELEASED raw lease carries every evidence record whose `observedAt` lies within ±20 minutes of that lease's creating call (wave-4 PR3's K5, by its plan text), beside the lease's own records; after the raw lease is released by `releaseLease` (`native-removed`), a second compaction no longer carries those K5 records on that lease's account.
  - **W5-J11** a fault injected after the journal fsync and before the checkpoint rename (the function-override seam the recovery rig uses): `recover()` replays the transition once; the lease reads `adopted` at generation 2, not 3.
  - **W5-J12** `releaseLease` frees the canonical path: `createLease` for a new lease on the same path, which was refused `canonical-path-held` before, is `created` after (D18).
  - **W5-J13** `noteCarrierSeen` for a generation above the lease's refuses `stale-generation`; for the current one sets `carrierGenerationSeen` and leaves `generation` and `currentJournalSequence` unchanged (the sequence still names the transition that wrote the generation, not the `seen` record).
  - **W5-J14** `randomUUID` is never called by the three doors (a spy).
- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/delegation-lease-durability.test.ts`. Expected: the doors do not exist.
- [ ] **Step 3: Implement** the doors in `createLease`'s shape (enqueue, `requireReady`, decide with the request's own `carrierRequired`, build the entry, `commitLocked`, answer with the record's sequence), and the store's delta arms (`delegation_leases` updated by `leaseId`; `delegation_lineage` inserted or closed by `lineageId`), each inside the existing delta transaction. Every new store method the lane calls joins `server/src/coord/ports.ts#WatcherCoordMember`.
- [ ] **Step 4: Run GREEN** Step 2's command, then `delegation-delta-projection`, `delegation-delta-applier`, `rings/watcher-store-port`, `coord-db` alone.
- [ ] **Step 5: Commit** `feat(delegation): lease doors beside createLease, with delta projection and compaction carry`.

### Task 5.5.4: Native-removed release

**The rules (`planNativeRemoved`).** For each unreleased lease that is not `transferring`, keyed by `delegationTreeKey(lease.project, lease.adminRecord)` (a bare record name collides across projects): if its project is not in `censused`, its count is unchanged and it is never counted absent, nor released. The lane's census is not a listing of every project: `watch.ts#divergencesPass` censuses only the projects the registry names (`[...new Set(records.map((r) => r.project))]`; its docstring: "a project whose every session has been reaped contributes no rows"), and a listed project can answer unmeasured (`delegation: null`, a `read.ok: false` `unreachable` or `unlistable`), which `laneFlatCensus` already leaves out of `censused` because "an empty list would read as every tree is gone" (hand-off 12). So a project that dropped out of the registry, or whose census failed, releases nothing however long it lasts; the lease stays as it is and is counted in the lane's health as `uncensused` (`D-7852`). Its count goes up by one ONLY when its project is censused and its key is missing from that listing (not in `listed`) or is listed with census `state: 'absent'` (in `absent`), which is spec §5.5's "the admin record is absent". Any other listed record resets the count to 0: one that is `unreadable`, one that is `present`, and one whose admin record stands while its tree directory is gone (never in the census's `present` trees, but its record is not absent), which is kept in its own set and never counted toward release. At 2 the lease is released: reason `transferred` when its disposition is `promoted`, else `native-removed`. `lastHeadSha` is the head the lane's previous census saw for that record, or null. The spec's "no `lease-clean:<phase>` breadcrumb" clause has no writer after D-7002 and is not implemented (`D-7795`); no branch is pinned, because nothing in this programme deletes the branch (`D-7796`).

- [ ] **Step 1: RED rows** in `delegation-lease-state.test.ts`: **W5-J15** absent from two consecutive successful listings releases; **W5-J16** absent, then a pass where the lease's project is not in `censused`, then absent releases at the second censused one; absent, then `unreadable`, then absent does not; **W5-J16c** a lease whose project drops out of the registry-named census (not in `census.projects` at all) for three passes, and separately one whose project is listed with `delegation: null` (`unreachable`) for three passes, releases nothing and keeps its count, and the lane's health counts it `uncensused`; **W5-J16d** two leases on the same admin record name in two projects: the record missing from project A's successful listing while project B lists it counts only A's lease absent; **W5-J16b** an admin record that stays listed (census `present` for the record) while its tree directory is gone, over three successful listings, is never released and its count stays 0; the same record then missing from two listings releases; **W5-J17** a `promoted` lease releases `transferred`; a `transferring` lease never releases. In `delegation-watch.test.ts`'s rig (outside wave-4 PR3's owned hunks): **W5-J18** two passes with the record gone release the lease through `releaseLease`, and the `leaseActs` phase key appears in the pass's slow line.
- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/delegation-lease-state.test.ts`. Expected: W5-J15 to W5-J17 fail.
- [ ] **Step 3: Implement** the planner and the lane phase: after `reconcile`, read `passCensus`, build `censused`, `listed`, `absent` and `unreadable` from `laneFlatCensus` (its `censused` and its flat records, keyed by `delegationTreeKey`), call `planNativeRemoved`, keep the returned map as lane memory (a counter, not a clock), call `releaseLease` for each request, and count the unreleased leases of uncensused projects as `uncensused` in the lane's health.
- [ ] **Step 4: Run GREEN** Step 2's command, then `delegation-watch` (run alone; it is slow), `delegation-pass-timing`, `single-definition/advance-switches` (the lane keeps no clock) alone.
- [ ] **Step 5: Commit** `feat(delegation): a lease whose tree is gone from two successful listings is released`.

### PR5 mutation table

| Mutant | Edit | Goes red |
|---|---|---|
| W5-JM1 | allow `adopt` from `retained` | W5-J2 |
| W5-JM2 | send `transfer-refused` to `ephemeral` | W5-J3 |
| W5-JM3 | skip the generation compare | W5-J4, W5-J7 |
| W5-JM4 | drop the transition records from `computeHolds` | W5-J8, W5-J10 |
| W5-JM5 | append on an `unchanged` replay | W5-J9, W5-J11 |
| W5-JM6 | leave `releasedAt` null on release | W5-J12 |
| W5-JM7 | count an `unreadable` record as absent | W5-J16 |
| W5-JM7b | count any record not in the census's present trees as absent | W5-J16b |
| W5-JM8 | release after one listing | W5-J15 |
| W5-JM9 | write `cleanupState: 'pending'` on adopt | W5-J6 |
| W5-JM10 | drop the `carrier-behind` check | W5-J5b |
| W5-JM10b | the door passes `carrierRequired: false` to `decideLeaseTransition` whatever the request says | W5-J9b |
| W5-JM11b | drop `resolvesThrough` from PR5a's grammar (a new field later) | W5-J7b (the resolve entries refuse) |
| W5-JM11 | let PR5a's build refuse a new kind (drop its arm from the grammar) | W5-J7b |
| W5-JM12 | drop the K5 hold for an unreleased raw lease | W5-J10b |
| W5-JM13 | count a lease whose project is not in `censused` as absent | W5-J16c (both cases release) |
| W5-JM14 | key `listed`/`absent` by the bare admin record | W5-J16d (the other project's record keeps the lease) |
| W5-KM12 | (PR6) let `lease-carrier-seen` set `currentJournalSequence` | W5-J13, W5-K4 (the second pass counts `mismatched: 1`) |

### PR5 at its tip

PR5a's suites are those of Tasks 5.5.1 and 5.5.2 (`delegation-lease-state`, `delegation-model`, `delegation-recovery` with W5-J7b, `delegation-checkpoint`, `delegation-delta-applier`, PR3's compaction suite) plus the guards below; PR5b's are the whole list.

**Suites alone** (in `server`): `delegation-lease-state`, `delegation-lease-durability`, `delegation-model`, `delegation-recovery`, `delegation-checkpoint` (if present), `delegation-delta-applier`, `delegation-delta-projection`, PR3's compaction suite, `delegation-watch`, `delegation-pass-timing`, `delegation-wave3.integration`, `rings/totality`, `rings/watcher-store-port`, `coord-policy-rings`, `coord-db`, `mail-routes`, every `single-definition` file, `citations`, `anchors`, `growth-check` (`GROWTH_CHECK=1`), `deviation-refs`; `fleet-health` and `delegation-health` (PR5b's `uncensusedLeases` member, an older-shape fixture still parsing), and `cd pwa && ~/.local/bin/ccrc test -- ./node_modules/.bin/tsc --noEmit` (PR5b's one optional `shared/api.ts` member). **Growth check:** waived by the new coord file; aim `watch.ts` at most +30, `store.ts` at most +35. **Rollout:** PR5a to the server box, measured, and kept there for at least one release; then PR5b to the server box. Once PR5b has journalled a new kind, the server floor for every rollback is the PR5a build (it folds the kinds); a build older than PR5a refuses the closed grammar and its lane stays `reconstructing` for good. The Gate's rollback floor, the PR5b body and its release notes say so. **Review focus:** (1) one decision for live and replay; (2) holds end exactly at release; (3) a checkpoint with no transition is byte-identical to `main`'s; (4) unreadable is never absence, a listed record is never absent, and a project the pass did not census (dropped from the registry-named census, or `delegation: null`) is never absence; (5) no cleanup state or clock is written; (6) PR5a writes no new kind by any path, and PR5b states the rollback floor. **Must NOT:** add a durable file, change the O5 order, write `unknown`, close an activity, or retire anything a lease names.

## PR6: S2, a carrier for every linked lease

**Goal.** Every linked, unreleased lease, raw included, gets a carrier from the pass after it is linked, and every later generation reaches its carrier; the server reads carriers back as measurement, and a carrier no journal lease owns is counted, never acted on.

**Branch and base.** From `main` with PR5b merged. Composes `ws-lease-mark` only on a box that advertises `lease-mark-v1` (PR1 rolled out); elsewhere the lane counts `unsupported`. **Deploy class.** SERVER.

**Files.**
- Create `server/src/coord/delegation-carrier.ts` (L1): the mark planner, the carrier parser and the read-back comparison.
- `server/src/watch.ts`: the `leaseActs` phase gains the carrier step; lane health counts.
- Create `server/src/coord/delegationCarrierMark.ts` (L4, no fastify): `markLeaseCarrier`, the one composer of `CCD_ARGV.leaseMark` (compose from the checkpoint's lease, run, read the one carrier back through `readFileMeasured`, journal `seen` from the read-back), called by the lane's `mark` step and, from PR9, by the promoting dispatch.
- `shared/api.ts`: an optional `carriers?: DelegationCarrierHealth` member of `DelegationObservationHealth`, and its type.
- `server/src/coord/delegation-model.ts`: the health kebab words if any are spelled.
- Tests: create `server/test/delegation-carrier.test.ts` and `server/test/delegation-carrier-lane.test.ts`; modify `server/test/fleet-health.test.ts`, `server/test/delegation-health.test.ts`, `server/test/delegation-wave3.integration.test.ts` (the effect census of "the closed six" now names the lane's lease acts on purpose: the six policy effects stay six, and a new row pins that only the `leaseActs` phase composes `ws-lease-mark`).

**Why here.** PR7 refuses to adopt a lease whose carrier read-back does not equal the journal's generation, so carriers must exist first; backfill gives the leases linked since wave 3 their carrier.

**Interfaces.**
- **Consumes:** PR1's `CCD_ARGV.leaseMark`, `LEASE_MARK_CAP`, `LEASE_MARK_REFUSALS`; PR5's doors and `delegationCarrierStateOf`; `server/src/io.ts#readFileMeasured`, `#readdirMeasured`; `capSupported`.
- **Produces**, consumed by PR7-PR9:

  ```ts
  // delegation-carrier.ts (L1)
  export const DELEGATION_CARRIER_MARKS_PER_PASS = 8;
  export interface DelegationCarrierBody { v: 1; leaseId: string; generation: number; state: DelegationCarrierState; journalSeq: number;
    parentId: string; parentIncarnation: string; activityId: string; source: DelegationLeaseSourceKind; project: string;
    adminRecord: string; canonicalPath: string; fingerprint: string; claudeBase: string | null; branch: string | null;
    expiresAt: number | null; releaseReason: DelegationLeaseReleaseReason | null; promotedRun: number | null;
    promotedSession: string | null; markedAt: number }
  export type ParsedCarrier = { kind: 'carrier'; body: DelegationCarrierBody } | { kind: 'malformed'; detail: string };
  export function parseDelegationCarrier(text: string): ParsedCarrier;
  export type CarrierStep =
    | { kind: 'mint'; leaseId: string; expectGeneration: 0 }                  // journal `carrier`, then mark at generation 1
    | { kind: 'mark'; args: LeaseMarkArgs }                                   // compose the verb at the lease's generation
    | { kind: 'seen'; leaseId: string; generation: number };                 // journal `lease-carrier-seen`
  export function planCarrierSteps(input: { checkpoint: DelegationCheckpointV1; readBack: ReadonlyMap<string, CarrierReadBack>;
    supported: boolean; nowMs: number;
    refused: ReadonlyMap<string, StandingMarkRefusal>;    // lane memory: leaseId -> the standing refusal of its last mark
    censusRow: ReadonlyMap<string, string>;               // delegationTreeKey -> a digest of that tree's census row this pass
    indexed: ReadonlySet<string> | 'unmeasured' }):        // the lease ids the by-tree entries name (rule 3's heal)
    { steps: readonly CarrierStep[]; health: DelegationCarrierHealth };
  /** A mark refusal that will answer the same until something changes: every `LeaseMarkRefusal` but `busy` and `unmeasured`. */
  export interface StandingMarkRefusal { generation: number; censusRow: string | null; word: LeaseMarkRefusal }
  export type CarrierReadBack = { kind: 'absent' } | { kind: 'unreadable'; detail: string } | ParsedCarrier;

  // shared/api.ts
  export interface DelegationCarrierHealth { marked: number; pending: number; unsupported: number; mismatched: number;
    unmeasured: number; unowned: number; refused: number }
  ```

**The rules (`planCarrierSteps`).**
1. `supported` false: no step; every lease that lacks an up-to-date carrier counts `unsupported`.
2. Every unreleased lease (raw included) at generation 0 gets `mint`; after it is applied the next pass marks it.
3. An unreleased lease whose read-back is `absent`, or a `carrier` whose generation is below the lease's, gets `mark` at the lease's generation and state, however many generations behind the carrier is: the verb writes any generation above the stored one (`D-7802`), so a carrier two or more behind (a refused mark, two transitions inside one pass) catches up in one write. The server never invents a generation; A11's `unchanged` answers a lost reply. A released lease whose read-back is a `carrier` in any state but `released` gets `mark` with `state: 'released'` and its reason. A released lease whose read-back is `absent` gets NO step: no carrier was ever written, so none is needed, and the verb would refuse it `no-tree` every pass (rule 5: no stored carrier, and the tree is gone). This is the population PR5b's native-removed release leaves before PR6 exists (released at generation 1 with no carrier), large because Claude Code removes unchanged agent trees itself, and holding the oldest leases. The one exception is the heal (`D-7805`): a released lease whose read-back is `absent` while a by-tree entry NAMES it (W5-L23's half-write, then a release before any re-drive) gets one `mark` with `state: 'released'` and its reason, which the verb answers `index-cleared` by removing that entry, so the orphan rung stops reading the tree `unmeasured`; after it no entry names the lease and rule 3 gives it no step again. The lane learns which leases an entry names from a `readdirMeasured` of `$REG/delegation/leases/by-tree` and a `readFileMeasured` of each entry (a lease id, one line), fed to the planner as `indexed: ReadonlySet<string> | 'unmeasured'`; an unmeasured listing composes no heal that pass. A heal step counts against `DELEGATION_CARRIER_MARKS_PER_PASS` and follows rule 6's standing refusals like any mark.
4. A read-back `carrier` whose generation, state and `journalSeq` equal the lease's, with `carrierGenerationSeen` below it, gets `seen`.
5. A read-back `carrier` whose generation is ABOVE the lease's, or whose `journalSeq` the checkpoint does not hold, or whose identity fields differ, counts `mismatched` and gets no step (never overwritten: rule 4 of the verb would refuse it anyway). `unreadable` or `malformed` counts `unmeasured` and gets no step.
6. **Standing refusals.** A lease whose `refused` entry has the lease's current generation and its tree's current `censusRow` digest gets no `mark` and counts `refused`: the verb would answer the same word again (`locked`, which O5-3 (a) keeps for the 27 of 27 orphaned agent trees of the ledger amendment `orphaned-agent-tree-is-locked`, `registered`, `nested`, `symlink`, `fingerprint-mismatch`, `no-tree`, and every other word but `busy` and `unmeasured`). It is composed again only when the lease's generation or that tree's census row changes (a lock removed, a registry row gone, a new head), which O5-3 (a)'s "eligible the pass after the lock is gone" needs.
7. At most `DELEGATION_CARRIER_MARKS_PER_PASS` `mint` and `mark` steps a pass, oldest lease first among the leases with no standing refusal, so a refused lease never takes the budget from one that can be marked; the rest count `pending`. The pass's budget (`DELEGATION_PASS_BUDGET_MS`) cuts the loop like every other phase.
8. A carrier file whose lease the checkpoint does not hold (from a `readdirMeasured` of `$REG/delegation/leases`) counts `unowned` unless its state is `released`; it is never read for anything else.

**Order in the lane.** For each step: `mint`/`seen` through PR5b's doors; `mark` only after the journal holds the generation (it always does: the planner reads the checkpoint), then `runCcd(CCD_ARGV.leaseMark(args))`, then a read-back of that one carrier in the same pass, and `seen` only from that read-back (never from the verb's answer). The lane's pass is the catch-up path for every carrier; the acts that must not wait a pass (PR9's transfer, whose audit reads the carrier at the new generation, and its later transitions) compose the same mark synchronously through one shared L4 helper, `markLeaseCarrier(lease, cp)` in `server/src/coord/delegationCarrierMark.ts` (compose, run, read back, `noteCarrierSeen`), which this PR creates and the lane's `mark` step calls too. A mark that answers a refusal is logged once per lease and generation (`ccrc-server: delegation: carrier <lease> generation <n> refused <word>`) and never changes the journal. `busy` and `unmeasured` are retried next pass; any other word is recorded in the lane memory `refused` with the generation and the tree's census-row digest, and is not composed again until one of them changes (rule 6, `D-7807`). The memory is lost on a restart, which retries each standing refusal once.

### Task 5.6.1: The L1 planner and parser

- [ ] **Step 1: RED rows** in `server/test/delegation-carrier.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { planCarrierSteps, parseDelegationCarrier } from '../src/coord/delegation-carrier.js';
  import { checkpointWithLease } from './delegationLeaseFixture.js';

  const NOW = Date.parse('2026-11-10T12:00:00Z');
  describe('planCarrierSteps', () => {
    it('W5-K1: a generation-0 lease is minted, raw included', () => {
      for (const sourceKind of ['agent', 'raw'] as const) {
        const cp = checkpointWithLease({ generation: 0, sourceKind });
        expect(planCarrierSteps({ checkpoint: cp, readBack: new Map(), supported: true, nowMs: NOW, refused: new Map(), censusRow: new Map(), indexed: new Set<string>() }).steps)
          .toEqual([{ kind: 'mint', leaseId: cp.leases[0]!.leaseId, expectGeneration: 0 }]);
      }
    });
    it('W5-K2: an unsupported box gets no step and counts unsupported', () => {
      const cp = checkpointWithLease({ generation: 0 });
      const r = planCarrierSteps({ checkpoint: cp, readBack: new Map(), supported: false, nowMs: NOW, refused: new Map(), censusRow: new Map(), indexed: new Set<string>() });
      expect(r.steps).toEqual([]);
      expect(r.health.unsupported).toBe(1);
    });
    it('W5-K3: a carrier behind the journal is re-marked at the journal generation; an equal one is seen', () => {
      const cp = checkpointWithLease({ generation: 2, disposition: 'adopted', cleanupDueAt: '2026-11-17T12:00:00.000Z', carrierGenerationSeen: 1 });
      const id = cp.leases[0]!.leaseId;
      const behind = planCarrierSteps({ checkpoint: cp, readBack: new Map([[id, { kind: 'carrier', body: { generation: 1 } as never }]]), supported: true, nowMs: NOW, refused: new Map(), censusRow: new Map(), indexed: new Set<string>() });
      expect(behind.steps).toMatchObject([{ kind: 'mark', args: { leaseId: id, generation: 2, state: 'adopted' } }]);
    });
    it('W5-K3b: a carrier two generations behind is marked once at the journal generation', () => {
      const cp = checkpointWithLease({ generation: 3, disposition: 'retained', cleanupDueAt: '2026-11-17T12:00:00.000Z', carrierGenerationSeen: 1 });
      const id = cp.leases[0]!.leaseId;
      const r = planCarrierSteps({ checkpoint: cp, readBack: new Map([[id, { kind: 'carrier', body: { generation: 1 } as never }]]), supported: true, nowMs: NOW, refused: new Map(), censusRow: new Map(), indexed: new Set<string>() });
      expect(r.steps).toMatchObject([{ kind: 'mark', args: { leaseId: id, generation: 3, state: 'retained' } }]);
      expect(r.health.mismatched).toBe(0);
    });
  });
  ```

  Remaining rows: **W5-K4** a carrier equal to the journal with `carrierGenerationSeen` below it gets `seen`, and one with it equal gets nothing; and a second pass after the `seen` is applied through PR5b's `noteCarrierSeen` (the checkpoint re-read, the same carrier read back) plans no step and counts `mismatched: 0` (the carrier's `journalSeq` still equals the lease's `currentJournalSequence`); **W5-K5** a carrier AHEAD of the journal, or naming a `journalSeq` the checkpoint does not hold, counts `mismatched` and gets no step; **W5-K6** `unreadable` and `malformed` count `unmeasured`, no step; **W5-K7** twelve leases at generation 0 give eight `mint` steps and `pending: 4`; **W5-K7b** nine released leases with an `absent` read-back (older than every other lease) plus one new lease at generation 0: the steps are exactly that lease's `mint`, the nine get no step and count nothing as `pending`, and the next pass (the mint applied) marks the new lease; **W5-K7c** nine leases whose `refused` entry is `locked` at their current generation and census-row digest, plus one new lease: the new lease's `mint` is in the first pass's steps and its `mark` in the next, no locked lease is composed, and `refused: 9`; the same nine with a changed census-row digest (the lock removed) are composed again, oldest first, within the budget; **W5-K8** a released lease whose carrier reads `adopted` gets a `released` mark with its reason, and a released lease whose read-back is `absent` gets none; **W5-K8b** the heal: a released lease whose read-back is `absent` and whose id is in `indexed` gets exactly one `released` mark; the same with `indexed: 'unmeasured'` gets none; in the lane rig over a real-verb fixture box, W5-L23's half-write followed by the lease's release ends, after one pass, with no by-tree entry naming the lease and the orphan rung answering not held (W5-O4b's second half); **W5-K9** `parseDelegationCarrier` refuses a missing key, an extra key, a generation of 0, a state outside the vocabulary, and a body over 16384 bytes, each as `malformed`; **W5-K10** an unowned carrier (no lease in the checkpoint) counts `unowned`, and a released unowned one does not.
- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/delegation-carrier.test.ts`. Expected: the module does not exist.
- [ ] **Step 3: Implement** the module; it imports `shared/api.js`, `../ccdargv.js` (types only: `LeaseMarkArgs`), `./delegation-model.js` and `./delegation-lease-state.js`.
- [ ] **Step 4: Run GREEN** Step 2's command, `rings/totality`, `coord-policy-rings`, `single-definition/kernel-tail-journal` alone.
- [ ] **Step 5: Commit** `feat(delegation): plan a carrier for every linked lease, and read it back as measurement`.

### Task 5.6.2: The lane's carrier step and health

- [ ] **Step 1: RED rows** in `server/test/delegation-carrier-lane.test.ts`, on `delegation-watch.test.ts`'s rig with a recording `runCcd` and a fixture registry directory as the read root:
  - **W5-K11** with `lease-mark-v1` in `ccdVerbs`, a linked lease gets `mint` journalled, then one `ws-lease-mark --lease <id> --generation 1 …` argv, then (after the fixture writes the carrier the argv describes) `carrierGenerationSeen` 1 on the next pass.
  - **W5-K12** without the capability, no argv is composed and the health's `carriers.unsupported` is 1; `ccdVerbs: null` (no evidence) composes none either.
  - **W5-K13** a refused mark (`{"ok":false,"refusal":"locked",…}` answered by the recorded runner) leaves the journal unchanged and logs one line; the next pass composes no mark for it and counts `carriers.refused: 1`; once the fixture removes the tree's `locked` file (its census row changes), the pass after composes it once. A `busy` refusal is retried on the very next pass.
  - **W5-K13b** the wedge row: nine leases on locked trees and nine released leases with no carrier, all older than one new linked lease, over three passes: the new lease is minted in the first pass, marked in the second and `seen` in the third, and no argv names any of the eighteen after the first refusal of each locked one.
  - **W5-K14** the fleet health frame carries `delegation.carriers`; an older reader without the member (the health test's older-shape fixture) still parses.
  - **W5-K11b** the verb answers `{"ok":true,"answer":"written",…}` but the fixture writes no carrier file: `carrierGenerationSeen` stays null on the next pass (no `seen` is journalled), and the planner marks again.
  - **W5-K11c** (the lane, a carrier two behind): a lease journalled at generation 3 whose fixture carrier reads generation 1 gets one `ws-lease-mark … --generation 3` argv, a real-verb fixture box (the harness's `cmd_ws_lease_mark`) writes it, and the next pass journals `seen` 3.
  - **W5-K15** (`delegation-wave3.integration`): `ws-lease-mark` is composed only through `markLeaseCarrier` (a text census of `server/src` for `CCD_ARGV.leaseMark(`: exactly `server/src/coord/delegationCarrierMark.ts`), and `markLeaseCarrier(` is called only from the `leaseActs` phase of `DelegationLane` and, after PR9, `server/src/coord/dispatch.ts` (PR9 adds that file to the row; PR8 adds none: its doors leave the mark to the lane).
- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/delegation-carrier-lane.test.ts`. Expected: no argv is composed.
- [ ] **Step 3: Implement** the step in the `leaseActs` phase, the read-back through `readFileMeasured` (absent, unreadable and found kept apart), the directory listing through `readdirMeasured`, the by-tree entries' lease ids for rule 3's heal (`readdirMeasured` of `by-tree/` and `readFileMeasured` of each entry, `indexed`), the `refused` lane memory and the per-tree census-row digest (over the pass's `passCensus` row for the tree, its state, head and locked flag, and the registry workdirs at or inside the tree, so a `registered` or `nested` refusal is retried when a row goes), and the health member.
- [ ] **Step 4: Run GREEN** Step 2's command, then `fleet-health`, `delegation-health`, `delegation-watch`, `delegation-wave3.integration` alone, and `cd pwa && ~/.local/bin/ccrc test -- ./node_modules/.bin/tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(delegation): the lane marks carriers, reads them back, and counts what it cannot`.

### PR6 mutation table

| Mutant | Edit | Goes red |
|---|---|---|
| W5-KM1 | ignore `supported` | W5-K2, W5-K12 |
| W5-KM2 | mark at `carrier.generation + 1` instead of the journal's | W5-K3b, W5-K11c (W5-K3 survives it: there the two agree) |
| W5-KM3 | treat `unreadable` as `absent` (re-mark) | W5-K6 |
| W5-KM4 | overwrite a carrier ahead of the journal | W5-K5 |
| W5-KM5 | drop the per-pass bound | W5-K7 |
| W5-KM6 | advance `carrierGenerationSeen` on the verb's answer instead of the read-back | W5-K11b |
| W5-KM7 | skip raw leases | W5-K1 |
| W5-KM8 | retry a standing refusal every pass | W5-K7c, W5-K13, W5-K13b |
| W5-KM9 | mark a released lease whose read-back is `absent` (ignoring `indexed`) | W5-K7b, W5-K8, W5-K13b |
| W5-KM11 | skip the heal (no mark for a released, absent lease an entry names) | W5-K8b |
| W5-KM10 | treat `busy` as standing | W5-K13 (the `busy` case) |

### PR6 at its tip

**Suites alone:** `delegation-carrier`, `delegation-carrier-lane`, `delegation-lease-durability`, `delegation-watch`, `fleet-health`, `delegation-health`, `delegation-wave3.integration`, `rings/totality`, `rings/watcher-store-port`, `coord-policy-rings`, `single-definition` files, `citations`, `growth-check` (`GROWTH_CHECK=1`), `deviation-refs` in `server`; the `pwa` typecheck. **Growth check:** waived by the new coord file; aim `watch.ts` at most +35. **Rollout:** server box, after PR1 is measured on the fleet box. **Review focus:** (1) journal first, then mark, then read-back; (2) `carrierGenerationSeen` moves only on a read-back; (3) unowned, mismatched and unmeasured carriers are counted and never acted on; (4) no capability, no argv; (5) the per-pass bound and the pass budget, which a standing refusal or a released lease with no carrier never consumes. **Must NOT:** create a lease from a carrier; mark a carrier off `ephemeral` (PR7-PR9 do that); widen the agent's write allowlist.

## PR7: S3, adoption, the digest and the reminder

**Goal.** A changed `agent` or `workflow` tree whose activity has terminal evidence (spec §5.11: an ended activity, or a parent proved dead, which under the ledger amendment `orphaned-background-agent-has-no-terminal-event` is NOT proof that the activity's work ended and is never presented as completion) is adopted: its lease moves to `adopted` with a 7-day expiry, its carrier follows, the parent's identity is kept alive with provenance `retained-lineage`, the parent's coordinator or the parent is owed one digest notice per adoption until it is queued, and a reminder 24 hours before expiry. The breaker, a passed expiry and a conflict raise attention items. While `$REG/delegation-adopt` is absent the lane only records what it would adopt (O5-7 (a)). A raw lease is never adopted by this lane (D-6999).

**Branch and base.** From `main` with PR6 and PR8 merged, and with PR2 and PR4 measured on the fleet box. Task 0 (the corpus re-read) is done before dispatch. **Deploy class.** SERVER.

**Files.**
- Create `server/src/coord/delegation-adoption.ts` (L1): the decider, the stable-pass memory fold, the digest and reminder builders.
- `shared/switches.ts`: `DELEGATION_ADOPT_MARKER` and its `SWITCHES` row.
- `server/src/coord/rundefsTx.ts`: `queueRunlessNotice`, extracted from `queueStallNotice`'s run-less arm (a move commit first, characterised by the stall suites, then the digest's call).
- `server/src/watch.ts`: the `leaseActs` phase's adopt step (between native-removed and carriers), the audit calls, the feed row, the mail, the attention items, the marker read and the health member.
- `server/src/coord/delegation-checkpoint.ts`: the `adopt` fold adds `retained-lineage` to the effective basis of the lease's parent session row (the parent's (id, incarnation), in `DELEGATION_INTENT_SOURCES`' order, `declareCoordinatorIntent`'s basis rule), and makes that row effective; nothing removes it (spec §5.1 provenance: "every transition records `explicit`, `run-owner`, `delegation-inferred` or `retained-lineage`").
- `shared/api.ts`: `DelegationLeaseWire` gains optional `disposition?` and `expiresAt?` as the last members of `DelegationLeaseWire`'s body (Task 5.7.4), never in the comments the visibility release edits; `DelegationObservationHealth` gains optional `adoption?: DelegationAdoptionHealth`.
- `server/src/coord/delegation-projection.ts`: fills the two wire fields.
- Tests: create `server/test/delegation-adoption.test.ts`, `server/test/delegation-adoption-corpus.test.ts`, `server/test/delegation-adoption-lane.test.ts`; modify `server/test/single-definition/switches-history.test.ts`, `late-census.test.ts`, `advance-switches.test.ts`, `server/test/delegation-projection.test.ts`, `pwa/test/older-server-render.test.tsx` (re-run only: it must stay byte-for-byte), `server/test/delegation-wave3.integration.test.ts` (the `delegation-adopt` row of `W5_OPEN` gains `shared/switches.ts`; the "DelegationLane must not match `sendMail`" row is re-pointed: the lane may call `queueRunlessNotice` from the adopt step only), `server/test/coord-policy-rings.test.ts`, `server/test/stall-*.test.ts` (re-run for the move).

**Why here.** Everything adoption reads exists by now: carriers (PR6), the audit (PR2 on the box), the transition doors (PR5), the orphan skip (PR4), and Retain (PR8), which the digest names.

**Interfaces.**
- **Consumes:** PR5b's `transitionLease`, `delegationCarrierStateOf`; PR6's `CarrierReadBack`; PR2's `CCD_ARGV.leaseAudit`, `LeaseAuditAnswer`; PR8's `leaseCoordinatorOf` (O5-4's one claimant rule), `conflictingTreeKeys` and `CoordStore#delegationRunStampsNaming`; PR4's `orphan-lease-v1` through `capSupported`; `server/src/coord/delegation-policy.ts#delegationCircuitBreaker`; `server/src/coord/rundefsTx.ts#insertSystemMailTx`; `CoordStore#hasMailWithSubject`; `server/src/notice.ts`'s funnel; `shared/switches.ts#MAIL_DISABLED_MARKER`.
- **Produces**, consumed by PR9 and PR10:

  ```ts
  // shared/switches.ts
  /** `$REG/delegation-adopt`: arms the delegation lane's adoption (spec §5.6). No writer in the tree. */
  export const DELEGATION_ADOPT_MARKER = 'delegation-adopt';
  // SWITCHES row: { storage: { marker }, default: 'absent: shadow, the lane records what it would adopt', owner: 'C5',
  //                 meaning: 'The delegation lane adopts a changed worktree whose delegated activity has terminal evidence, and mails its owner.',
  //                 writer: 'hand-only' }

  // delegation-adoption.ts (L1)
  export const DELEGATION_ADOPT_SETTLE_MS = 5 * 60_000;          // A3
  export const DELEGATION_ADOPT_STABLE_PASSES = 2;               // A3
  export const DELEGATION_REMINDER_LEAD_MS = 24 * 3_600_000;     // A3
  export const DELEGATION_AUDITS_PER_PASS = 4;
  export const DELEGATION_ADOPTABLE_SOURCES = ['agent', 'workflow'] as const satisfies readonly DelegationLeaseSourceKind[];
  export interface ParentFact { registry: 'present' | 'absent' | 'unmeasured'; incarnation: string | null;
    deadSince: string | null; ccd: boolean }
  /** Who is owed a lease's notices (O5-4 (a)): `leaseCoordinatorOf(lease, runs)` when it names a coordinator; else the parent itself
   *  only while its measured incarnation is the lease's (`parentIncarnation`); else null (feed row only, the operator's Keep control
   *  on the row). A re-created parent row is never mailed a Retain line it cannot use (W5-R2). */
  export function leaseRecipient(lease: DelegationLeaseRow, parent: ParentFact | undefined, coordinator: string | null): string | null;
  export interface AdoptionInput {
    now: string; checkpoint: DelegationCheckpointV1;
    carriers: ReadonlyMap<string, CarrierReadBack>;
    treePresent: ReadonlySet<string>;                                         // census `present` trees, by delegationTreeKey
    censused: ReadonlySet<string>;                                            // projects whose census this pass is a measured success
    audits: ReadonlyMap<string, LeaseAuditAnswer | 'unsupported' | 'not-asked'>;
    watch: ReadonlyMap<string, AdoptWatch>;                                   // lane memory
    parents: ReadonlyMap<string, ParentFact>;
    conflicting: ReadonlySet<string>;                                         // conflictingTreeKeys(checkpoint)
    boxHolds: boolean;                                                        // capSupported(fleetState, 'orphan-lease-v1') && lease-mark-v1
    breaker: DelegationCircuitBreakerState; marker: 'present' | 'absent' | 'unmeasured';
  }
  export interface AdoptWatch { generation: number; terminalAt: string; passes: number }
  export type AdoptionDecision =
    | { kind: 'adopt'; leaseId: string; expectGeneration: number; terminalAt: string; expiresAt: string }
    | { kind: 'would-adopt'; leaseId: string; why: 'marker-absent' | 'marker-unmeasured' }
    | { kind: 'audit'; leaseId: string; generation: number }
    | { kind: 'remind'; leaseId: string; generation: number; expiresAt: string }
    | { kind: 'attention'; key: string; title: string; body: string };   // breaker suspended, an expiry passed, a conflicting lease
  export function decideAdoption(input: AdoptionInput): { decisions: readonly AdoptionDecision[];
    watch: Map<string, AdoptWatch>; health: DelegationAdoptionHealth };
  /** The notices owed, from durable state only: every unreleased lease whose disposition is `adopted` at the generation its `adopt`
   *  transition wrote, with a recipient, whose notice subject has no mail yet (the caller asks `hasMailWithSubject` inside
   *  `queueRunlessNotice`'s transaction). Never built from this pass's decisions. */
  export function owedLeaseNotices(checkpoint: DelegationCheckpointV1, recipientOf: (l: DelegationLeaseRow) => string | null):
    readonly { recipient: string; item: LeaseDigestItem }[];
  export function buildLeaseDigest(recipient: string, item: LeaseDigestItem, doors: LeaseDigestDoors):
    { subject: string; body: string };
  export function buildLeaseReminder(item: LeaseDigestItem, doors: LeaseDigestDoors): { subject: string; body: string };
  export interface LeaseDigestItem { leaseId: string; generation: number; canonicalPath: string; parentId: string; expiresAt: string }
  export interface LeaseDigestDoors { retain: true; promote: boolean }       // PR9 sets promote

  // shared/api.ts
  // DelegationLeaseWire gains: disposition?: Exclude<DelegationCarrierState, 'released'>; expiresAt?: string | null;
  export interface DelegationAdoptionHealth { mode: 'live' | 'shadow' | 'suspended' | 'unmeasured'; adopted: number;
    wouldAdopt: number; waiting: number; unchanged: number; unaudited: number; conflicting: number; unsupported: number;
    uncensused: number;                                                       // waiting: the lease's project was not censused
    owed: number }                                                            // owed: notices derived but not yet queued

  // rundefsTx.ts
  export function queueRunlessNotice(coord: WatcherCoordPort, n: { toId: string; kind: MailKind; subject: string; body: string }): StallNoticeQueued;
  ```

**The rules (`decideAdoption`).** For each unreleased lease, in order; the first that fails leaves it `ephemeral` and drops its watch entry, unless the rule says "wait":
1. Its source is in `DELEGATION_ADOPTABLE_SOURCES` (a `raw` or `attached` lease is never adopted here, D-6999).
2. Its carrier state is `ephemeral`, and its tree key is not in `conflicting` (spec §5.4: "`conflicting` at any rung is final until" the operator resolves it; the frame already shows it as an unowned row, D-7003): a conflicting lease WAITS, keeps its watch entry, counts `conflicting` and raises one attention item per lease and generation.
3. Its carrier read-back is a `carrier` at the lease's generation and `carrierGenerationSeen` equals it (else wait: PR6 marks and reads it back; `transitionLease` would refuse `carrier-behind` anyway). `boxHolds` is true (the box reports `lease-mark-v1` and `orphan-lease-v1`), else count `unsupported` and wait: an adoption on a box without PR4's rung would leave the tree to the server skip alone.
4. Terminal evidence, exactly spec §5.11's (evidence that the lane may stop waiting, never a statement that the work completed: a dead parent does not prove a background agent stopped, ledger amendment `orphaned-background-agent-has-no-terminal-event`): its activity's `executionState` is `ended` with `endedAt` (the builder sets that only from a stop or completion event, or a `wf_*` task notification with a terminal status, never from a missing `SessionEnd`, a SubagentStop alone, a paused workflow or an `unknown` status); or its parent is proved dead: the registry row measured `absent`, or `deadSince` set (a supervisor measured dead outside its restart window for two passes, as reconciliation's `firstDeadParents` already requires), or a measured incarnation other than the lease's. `unmeasured` registry or incarnation is not evidence. `terminalAt` is `endedAt`, or the first pass this rule held.
5. `now - terminalAt >= DELEGATION_ADOPT_SETTLE_MS` and the watch entry has `passes >= DELEGATION_ADOPT_STABLE_PASSES` at the same generation (else wait, and count the pass).
6. The census says the tree is `present` (an admin record without its tree is never present; a locked tree has no carrier under O5-3 (a), so rule 3 already waits). A lease whose project is not in `censused` WAITS, keeps its watch entry and counts `uncensused`: the lane's census covers only the projects the registry names (`watch.ts#divergencesPass`), so a tree in a project with no live session, or whose census failed this pass, is unmeasured here, never absent. This is a stated limit, not a widening: a project whose every session has been reaped adopts nothing until a session runs there again, and its `ephemeral` leases stay where the orphan lane's own rungs decide them (`D-7852`). Widening the census to every project holding an unreleased lease is a per-pass cost (one `readWorktreeCensus` per such project) the operator may choose later (Where things stand).
7. The audit: no answer yet emits `audit` (at most `DELEGATION_AUDITS_PER_PASS` a pass) and waits; `unsupported` or `changed: 'unmeasured'` or a refused answer counts as CHANGED; `changed: false` counts `unchanged` and stays `ephemeral` (the orphan ladder decides it).
8. The breaker is `clear` (else count `suspended`, wait, and emit one `attention` for the episode: spec §5.5 "suspends adoption … and raises one attention item").
9. The marker: `present` emits `adopt` with `expiresAt = now + DELEGATION_LEASE_EXPIRY_MS`; `absent` or `unmeasured` emits `would-adopt`.

Separately, for each `adopted` or `retained` lease whose `expiresAt - now <= DELEGATION_REMINDER_LEAD_MS`, emit `remind` once per lease and generation (the subject carries both, and the mail store's dedupe makes it once); and for each whose `expiresAt` has passed (the orphan hold's margin included), emit one `attention` per lease and generation ("worktree no longer held back from the disk sweep", spec §9 "leases past expiry").

**The effects (the lane, L4).** `adopt`: `transitionLease({reason:'adopt', expectGeneration, at: now, expiresAt, carrierRequired: true, ...})`; on `applied`, a feed row (`notify(..., 'record-only')`, the idiom `server/src/orphanTreeBeat.ts` uses) naming the tree and the expiry, then the carrier step marks it in the same pass. A `refused` or `unchanged` answer is logged once and changes nothing. `would-adopt`: one lane log line per lease and generation, `ccrc-server: delegation: adoption shadow: would adopt <leaseId> (<project>/<adminRecord>, terminal <terminalAt>)`, and a health count; no journal, no carrier, no mail, no feed. `attention`: one `notify(…, 'push')` through the same funnel per `key`, remembered in lane memory so a pass never repeats it (a restart may raise a standing one once more, never once per pass).

**What is owed, and when it is queued (`D-7812`).** Notices are never built from this pass's decisions. Every pass derives `owedLeaseNotices(checkpoint, recipientOf)`: each `adopted` lease at its adopt generation with a recipient. For each, `queueRunlessNotice` runs `hasMailWithSubject` and the insert in ONE transaction (`queueStallNotice`'s run-less arm), keyed on the notice's subject, which names the lease and its generation and never a pass instant; so a crash, restart or lost lane between the `adopt` commit and the mail leaves the notice owed, and the next pass queues it exactly once. While `mail-disabled` stands the lane queues nothing (the marker's meaning in `shared/switches.ts#SWITCHES` is "queued mail waits", so queueing would also be consistent; holding is chosen so that a reminder whose date passed while the marker stood is not queued late); the notices stay owed, and the first pass after the marker is lifted queues each exactly once. Reminders are derived the same way (owed while `expiresAt - now <= DELEGATION_REMINDER_LEAD_MS` and no mail has the reminder's subject). `recipientOf` is `leaseRecipient(lease, parents.get(lease.parentId), leaseCoordinatorOf(lease, runs))`; a null recipient (no registry row, a non-ccd parent, or a parent row re-created under the same id with no coordinator) gets no mail, and its feed row and the operator's Keep control stand.

**The digest's text.** One notice per adopted lease and generation (`D-7813`: spec §5.6's "one digest per parent per pass" becomes one notice per adoption, all queued in the pass that finds them owed, because a subject that names a pass or a set cannot be deduped durably per lease). Subject: `delegation: worktree kept for <recipient> (<leaseId>, generation <n>)`. Body: the tree's path, "kept until <expiresAt, UTC>", the line `~/.local/bin/ccrc-api leases retain <leaseId> --json '{"byId":"<your id>","byUuid":"<your uuid>"}'` to keep it for another 7 days, and (once PR9 sets `promote`) the promote line. The closing sentence under O5-1 (a): "After that date the worktree is no longer held back from the disk sweep, which never removes uncommitted work, and removes a worktree with unpushed commits only after saving them to a rescue ref." The reminder carries the same sentence. Words: worktree, kept; never `running`, never "repaired", never "finished" or "completed".

### Task 5.7.1: The marker

- [ ] **Step 1: RED rows.** **W5-X1** (`switches-history.test.ts` and `late-census.test.ts`): `DELEGATION_ADOPT_MARKER` is declared once in `shared/switches.ts` with a `hand-only` row; **W5-X2** (`advance-switches.test.ts`): no file in `server/src`, `shared`, `ccd`, `agent/src` or `deploy` writes the marker (the file's existing no-writer scan, with the new constant added to its list).
- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/single-definition/switches-history.test.ts`. Expected: the constant is missing.
- [ ] **Step 3: Implement** the constant and row. **Step 4: Run GREEN** the three files alone. **Step 5: Commit** `feat(switches): delegation-adopt, a hand-only marker`.

### Task 5.7.2: The decider

- [ ] **Step 1: RED rows** in `server/test/delegation-adoption.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { decideAdoption, DELEGATION_ADOPT_SETTLE_MS } from '../src/coord/delegation-adoption.js';
  import { delegationTreeKey } from '../src/coord/delegation-correlation.js';
  import { checkpointWithLease } from './delegationLeaseFixture.js';

  const T0 = Date.parse('2026-11-10T12:00:00Z');
  const iso = (ms: number): string => new Date(ms).toISOString();
  const ended = (over = {}) => checkpointWithLease({ generation: 1, sourceKind: 'agent', carrierGenerationSeen: 1, ...over },
    { activity: { executionState: 'ended', endedAt: iso(T0) } });
  const base = (cp: ReturnType<typeof ended>, nowMs: number, over: Record<string, unknown> = {}) => {
    const l = cp.leases[0]!;
    return { now: iso(nowMs), checkpoint: cp,
      carriers: new Map([[l.leaseId, { kind: 'carrier', body: { generation: 1, state: 'ephemeral' } } as never]]),
      treePresent: new Set([delegationTreeKey(l.project, l.adminRecord)]), censused: new Set([l.project]),
      audits: new Map([[l.leaseId, { ok: true, changed: true } as never]]),
      watch: new Map([[l.leaseId, { generation: 1, terminalAt: iso(T0), passes: 2 }]]),
      parents: new Map([[l.parentId, { registry: 'present', incarnation: l.parentIncarnation, deadSince: null, ccd: true }]]),
      conflicting: new Set<string>(), boxHolds: true,
      breaker: 'clear' as const, marker: 'present' as const, ...over };
  };

  describe('decideAdoption', () => {
    it('W5-D1: an ended agent lease, changed, settled for two passes, is adopted with a 7-day expiry', () => {
      const cp = ended();
      const r = decideAdoption(base(cp, T0 + DELEGATION_ADOPT_SETTLE_MS) as never);
      expect(r.decisions).toEqual([{ kind: 'adopt', leaseId: cp.leases[0]!.leaseId, expectGeneration: 1, terminalAt: iso(T0),
        expiresAt: iso(T0 + DELEGATION_ADOPT_SETTLE_MS + 7 * 86_400_000) }]);
    });
    it('W5-D2: a raw or attached lease is never adopted', () => {
      for (const sourceKind of ['raw', 'attached'] as const) {
        const cp = ended({ sourceKind });
        expect(decideAdoption(base(cp, T0 + DELEGATION_ADOPT_SETTLE_MS) as never).decisions).toEqual([]);
      }
    });
    it('W5-D3: an active activity under a live parent is never adopted, however long it is silent', () => {
      const cp = checkpointWithLease({ generation: 1, sourceKind: 'agent', carrierGenerationSeen: 1 },
        { activity: { executionState: 'active', endedAt: null } });
      expect(decideAdoption(base(cp, T0 + 30 * 86_400_000) as never).decisions).toEqual([]);
    });
  });
  ```

  Remaining rows:
  - **W5-D4** an `unknown` activity under a live parent: no decision.
  - **W5-D5** an active activity whose parent's registry is measured `absent`: `terminalAt` is the first pass, and adoption comes only after the settle and two passes; `unmeasured` registry: no decision.
  - **W5-D6** a changed incarnation is terminal; an absent `.generation` (incarnation `null`, registry present) is not.
  - **W5-D7** one pass short, or one minute short of the settle: no `adopt`, and the watch's `passes` goes up by one.
  - **W5-D8** the breaker `suspended`: no `adopt`, `health.mode === 'suspended'`; the next clear pass adopts.
  - **W5-D9** a generation change between passes resets the watch.
  - **W5-D10** audit `unsupported`, `changed: 'unmeasured'`, and a refused audit each adopt (the safe direction); `changed: false` does not, and counts `unchanged`.
  - **W5-D11** marker `absent` and `unmeasured` give `would-adopt` and `mode: 'shadow'` / `'unmeasured'`, never `adopt`.
  - **W5-D13** no carrier read-back, or one a generation behind: wait (no decision, watch kept).
  - **W5-D14** an admin record without its tree (not in `treePresent`): no decision.
  - **W5-D14b** an otherwise adoptable lease whose project is not in `censused` (its parent's project has no registry row this pass): no decision, its watch entry is kept, `health.uncensused` is 1; the next pass with the project censused and the tree `present` continues from that watch entry.
  - **W5-D15** five candidates with no audit answer give four `audit` decisions and `unaudited: 1`.
  - **W5-D16** an `adopted` lease 23 hours from expiry gives one `remind`; at 25 hours, none; a `retained` one likewise.
  - **W5-D18** a lease whose tree key is in `conflicting`: no `adopt`, the watch entry kept, `health.conflicting === 1`, and one `attention`. The key leaves the set only through the derivation (`conflictingTreeKeys`, PR8), and only by the operator's resolve: correlation records no newer attempt on a tree once any `conflicting` attempt is recorded there (`finalConflicts`, `D-7821`), so no attempt can supersede the conflict. Fed one in which the operator's resolve covers the attempt (PR8's `resolvedThrough`), the lease is `retained` (attach) or released (foreign) and is never adopted, because adoption starts only from `ephemeral`.
  - **W5-D19** `boxHolds: false` (no `orphan-lease-v1`, or no `lease-mark-v1`): no `adopt`, `health.unsupported === 1`.
  - **W5-D20** `leaseRecipient`: a worker parent whose run closed before adoption (its run's interval holds `firstObservedAt`) names the coordinator through `leaseCoordinatorOf`; a non-programme parent at the lease's incarnation names itself; the same id at another measured incarnation names null; an absent registry row names null.
  - **W5-D21** the breaker suspended for three passes emits one `attention` for the episode, not three.
  - **W5-D17** the decider reads no clock: `Date.now` stubbed to throw, every row still passes (it is fed `now`).
- [ ] **Step 2: RED, the corpus row (W5-D12)** in `server/test/delegation-adoption-corpus.test.ts`: for every version in `server/test/fixtures/delegation/matrix.json`, replay its `agent-iso-changed`, `agent-iso-dirty` and `agent-iso-unchanged` scenarios through the wave-3 rig (`server/test/delegation-rig`) to a checkpoint, give the decider the audit answer the scenario's name states (`changed: true`, `true`, `false`) and a settled watch, and assert: `adopt` exactly once for the first two, never for the third; `raw-worktree` never adopts; `wf-iso` adopts only when its run's terminal notification is in the replay, and `wf-limit-pause` (a paused workflow) never. And `DELEGATION_ADOPTABLE_SOURCES` equals `['agent','workflow']`. This is the "fixture-proven correlation classes" condition (`D-7832`); Task 0 adds any lane version the fleet runs that the matrix lacks.
- [ ] **Step 3: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/delegation-adoption.test.ts`, then `test/delegation-adoption-corpus.test.ts`. Expected: the module does not exist.
- [ ] **Step 4: Implement** the module; it imports `shared/api.js`, `./delegation-model.js`, `./delegation-lease-state.js`, `./delegation-carrier.js` (types) and `./delegation-policy.js` (types).
- [ ] **Step 5: Run GREEN** Step 3's commands, `rings/totality`, `coord-policy-rings`, `single-definition/kernel-tail-journal`, `single-definition/advance-switches` alone.
- [ ] **Step 6: Commit** `feat(delegation): the adoption decider, fed now, fixture-proven for agent and workflow trees`.

### Task 5.7.3: The lane's adopt step, shadow and live

- [ ] **Step 1: Move commit.** Extract `queueRunlessNotice` from `queueStallNotice`'s run-less arm; `queueStallNotice` calls it. Run every `server/test/stall-*.test.ts` and `server/test/mail-hardening.test.ts` alone, green, before and after. Commit `refactor(mail): the run-less notice arm, shared` (no behaviour change).
- [ ] **Step 2: RED rows** in `server/test/delegation-adoption-lane.test.ts` (the `delegation-watch.test.ts` rig, a fixture registry, a recording `runCcd` that answers `ws-lease-audit` from a table, a real `CoordStore`):
  - **W5-Q1** marker absent: after the settle, the lease stays `ephemeral`, the health shows `adoption.mode: 'shadow'` and `wouldAdopt: 1`, the log holds one shadow line, and the mail table, the feed and the carrier are unchanged.
  - **W5-Q2** marker present (`touch` in the fixture registry): the lease is `adopted` at generation 2 with `cleanupDueAt`, the carrier argv for generation 2 `--state adopted --expires-at <ms>` is composed in the same pass, one feed row is written, one mail to the parent with the subject `delegation: worktree kept for <parent> (<leaseId>, generation 2)` is queued, its body holds the Retain line and the exact closing sentence "After that date the worktree is no longer held back from the disk sweep, which never removes uncommitted work, and removes a worktree with unpushed commits only after saving them to a rescue ref.", and the parent's session row's effective basis now includes `retained-lineage`.
  - **W5-Q3** a server restart (a new lane over the same journal and store) does not queue the notice again (the subject dedupe, across every delivery state: the first mail is acked before the restart).
  - **W5-Q3b** a crash between the transition and the mail: the lane's `queueRunlessNotice` call is faulted once (a seam that throws after the `adopt` commit and before the transaction); a new lane over the same journal and store queues the notice on its first ready pass, exactly once, and the pass after queues none.
  - **W5-Q4** `mail-disabled` standing: the adoption happens, no mail is queued, and `adoption.owed` is 1; once the marker is removed, the next pass queues that notice exactly once, and the pass after queues none.
  - **W5-Q4b** a second lease adopted in a later pass for the same recipient gets its own notice; the first is not queued again.
  - **W5-Q5** a programme worker's lease (O5-4 (a)): the notice goes to the coordinator `leaseCoordinatorOf` names, and the worker gets none; also when the worker's run CLOSED before the adoption (its interval still holds the lease's `firstObservedAt`), and when 501 later closed runs push that run out of `delegationRunStamps()`' window (the recipient is read through `delegationRunStampsNaming`).
  - **W5-Q6** a parent with no registry row: adopted, feed row, no mail.
  - **W5-Q6b** an adoption on a changed incarnation (the parent's row re-created under the same id, rule 4's terminal evidence) of a non-programme parent: adopted, feed row, and NO mail carrying a Retain line the new incarnation could not use (W5-R2); the operator's Keep control is the path.
  - **W5-Q9** attention: the breaker suspended over two passes raises one push notice; a lease past its expiry raises one; a conflicting lease raises one; none repeats on the next pass.
  - **W5-Q7** the reminder: an adopted lease with `cleanupDueAt` 23 hours away queues one reminder; the next pass queues none.
  - **W5-Q8** no `lease-audit-v1`: the decider sees `unsupported` and adopts (counts changed), and no `ws-lease-audit` argv is composed.
- [ ] **Step 3: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/delegation-adoption-lane.test.ts`. Expected: nothing adopts.
- [ ] **Step 4: Implement** the step: build `AdoptionInput` from the pass's checkpoint, `passCensus`, PR6's read-backs, the audit answers gathered this pass (`runCcd(CCD_ARGV.leaseAudit(id, gen, false))` for each `audit` decision of the previous pass, only behind `capSupported(fleetState, LEASE_AUDIT_CAP)`), the registry facts reconciliation already measures, the run stamps of each owed lease's parent (`CoordStore#delegationRunStampsNaming(parentId)`, for `leaseCoordinatorOf`; never the bounded `delegationRunStamps()`), `conflictingTreeKeys(checkpoint)`, `boxHolds` from `capSupported` on `lease-mark-v1` and `orphan-lease-v1`, `delegationCircuitBreaker`, and the marker read with `readdirMeasured` (absent, present and unmeasured kept apart); keep `watch` and the raised attention keys as lane memory; act on the decisions as "The effects" says, and queue every owed notice as "What is owed" says.
- [ ] **Step 5: Run GREEN** Step 3's command, then `delegation-watch`, `delegation-carrier-lane`, `delegation-wave3.integration`, `mail-hardening`, `mail-routes`, `rings/watcher-store-port` alone.
- [ ] **Step 6: Commit** `feat(delegation): the lane adopts a changed worktree with terminal evidence behind delegation-adopt, and owes its owner one notice`.

### Task 5.7.4: The wire's disposition and expiry

- [ ] **Step 1: RED rows** in `delegation-projection.test.ts`: **W5-W1** an adopted lease's row carries `disposition: 'adopted'` and `expiresAt` equal to its `cleanupDueAt`; an ephemeral one `disposition: 'ephemeral'`, `expiresAt: null`; a transferring one `disposition: 'transferring'`; **W5-W2** the frame stays additive: `isDelegationProjectionKebab` admits the new words, and `FLEET_PROTO` is 1.
- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/delegation-projection.test.ts`. Expected: W5-W1 fails (no `disposition` on the row). **Step 3: Implement** the fields: add the two optional members as the last lines of `DelegationLeaseWire`'s body in `shared/api.ts`, each with its own comment, touching none of the comment lines the visibility release edits; and fill them in `projectDelegation` from `delegationCarrierStateOf` and `cleanupDueAt`. **Step 4: Run GREEN** Step 2's command, `cd pwa && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/older-server-render.test.tsx` (unchanged, byte-for-byte), and the `pwa` typecheck. **Step 5: Commit** `feat(delegation): the lease row carries its disposition and expiry, additively`.

### PR7 mutation table

| Mutant | Edit | Goes red |
|---|---|---|
| W5-DM1 | drop rule 1 | W5-D2, W5-D12 (`raw-worktree`) |
| W5-DM2 | treat `unknown` as ended | W5-D4 |
| W5-DM3 | treat an `unmeasured` registry as absent | W5-D5 |
| W5-DM4 | treat a null incarnation as changed | W5-D6 |
| W5-DM5 | drop the stable-pass count | W5-D7 |
| W5-DM6 | ignore the breaker | W5-D8 |
| W5-DM7 | fold an unmeasured audit to unchanged | W5-D10 |
| W5-DM8 | adopt on an absent marker | W5-D11, W5-Q1 |
| W5-DM9 | dedupe the digest on outstanding mail only | W5-Q3 |
| W5-DM9b | build the notices from this pass's `adopt` decisions instead of `owedLeaseNotices` | W5-Q3b, W5-Q4 |
| W5-DM10 | send while `mail-disabled` stands | W5-Q4 (the mail is queued while the marker stands) |
| W5-DM11 | address a worker's digest to the worker | W5-Q5 (under O5-4 (a)) |
| W5-DM11b | resolve the coordinator with `bindingOf` (the current binding) instead of `leaseCoordinatorOf` | W5-Q5 (the closed-run case), W5-D20 |
| W5-DM11d | feed `leaseCoordinatorOf` the bounded `delegationRunStamps()` | W5-Q5 (the 501-run case) |
| W5-DM11c | address the parent id whatever its measured incarnation | W5-Q6b, W5-D20 |
| W5-DM13 | drop the `conflicting` rule | W5-D18 |
| W5-DM14 | drop the `boxHolds` rule | W5-D19 |
| W5-DM16 | treat a lease of an uncensused project as not present (drop its watch entry) | W5-D14b |
| W5-DM15 | drop the `retained-lineage` fold | W5-Q2 |
| W5-DM12 | read `Date.now()` in the decider | W5-D17 |

### PR7 at its tip

**Suites alone:** `delegation-adoption`, `delegation-adoption-corpus`, `delegation-adoption-lane`, `delegation-carrier-lane`, `delegation-projection`, `delegation-watch`, `delegation-wave3.integration`, every `stall-*` suite, `mail-hardening`, `mail-routes`, `fleet-health`, `rings/totality`, `rings/watcher-store-port`, `coord-policy-rings`, every `single-definition` file, `citations`, `growth-check` (`GROWTH_CHECK=1`), `deviation-refs` in `server`; `older-server-render` and the typecheck in `pwa`. **Growth check:** waived by the new coord file; aim `watch.ts` at most +40. **Rollout:** server box; the operator reads `adoption.wouldAdopt` and the shadow lines, then touches `$REG/delegation-adopt` on the fleet box by hand (the gate; never a soak). **Review focus:** (1) no end is inferred from silence, a live parent, a missing `SessionEnd` or an unmeasured read, and terminal evidence is never worded as completion; (2) raw never adopts, and a conflicting tree never does; (3) shadow writes nothing durable; (4) a notice is owed from durable state: a restart never resends and a crash or `mail-disabled` never loses one; (5) the thresholds are constants fed `now`; (6) one claimant rule (`leaseCoordinatorOf`) for the recipient. **Must NOT:** write `unknown`; end, close or retire an activity; mark a carrier directly (PR6's step does); describe adoption as repair.

## PR8: S4, Retain and resolve

**Goal.** A lease's parent (or, under O5-4 (a), its coordinator) keeps a tree for another 7 days with `POST /api/leases/:lease/retain`; the operator keeps a tree (`operator-retain`), attaches one to a live session, or says it is not delegated (`resolve`), from the PWA. Resolve ENDS a conflict (spec §5.4: `conflicting` is final "until" the operator resolves it) through a durable resolution mark, and "not delegated" is final for that tree. Under O5-8 (c) (recommended) every act here is on a lease and writes only grammar PR5a folds; the no-lease tree doors exist only under (a)/(b), as PR8a then PR8b.

**Branch and base.** From `main` with PR6 merged and PR4 measured on both boxes; under O5-8 (a)/(b), PR8b from `main` with PR8a merged and measured on the server box. **Deploy class.** BOTH: `ccd/ccrc-api` and the coordinator skill's reference ship on the fleet box first, then the server.

**Files.**
- Create `server/src/coord/delegation-lease-acts.ts` (L1): refusal order and transition choice for the three doors, and `leaseCoordinatorOf`, O5-4's ONE claimant rule, which PR7's recipient and PR9's promote gate import.
- Create `server/src/coord/delegation-conflicts.ts` (L1): `newestUnownedAttempts(checkpoint)` (the newest unowned-work attempt per tree, by `attemptedAt` then `attemptId`), moved out of `server/src/coord/delegation-projection.ts#projectDelegation` (a move commit first, characterised by `delegation-projection.test.ts`, changing only imports); then `conflictingTreeKeys(checkpoint)`, the tree keys whose newest attempt is `conflicting` and NOT covered by a resolution (an attempt is covered when some lease on that tree has a carrier row `resolvedThrough` ordered at or above it); `resolvedAttemptCovered(checkpoint, attempt)`; `disownedTreeKeys(checkpoint)`, the (project, admin record, creation base) of every lease released `foreign` (carrier row `releaseReason`); and `delegationTreeTarget(project, adminRecord)` = `delegationSha256Hex(delegationTreeKey(project, adminRecord))` (`server/src/coord/delegation-model.ts#delegationSha256Hex`, `server/src/coord/delegation-correlation.ts#delegationTreeKey`), the ONE spelling of a tree in a URL (`tree-<64 hex>`), which `parseLeaseTarget`'s resolver matches against the checkpoint's leases and attempts; every set and map of trees in this wave is keyed by `delegationTreeKey` itself (`JSON.stringify([project, adminRecord])`), never by a hand-rolled spelling. The projection and every wave-5 decider (PR7's adoption, this PR's doors, PR9's gates) read these ONE derivations (`D-7820`, `D-7822`). Correlation does not: it keeps `server/src/coord/delegation-policy.ts#groundOf`'s `finalConflicts` (every tree with ANY `conflicting` attempt ever recorded), for which `planRecord` returns no effect on `linked`, `unresolved` and `conflicting` verdicts. That is recorded as legitimately different (`D-7821`, the opposite safety direction): `finalConflicts` is correlation's input guard, which never records another attempt or requests a lease on a tree once seen conflicting, while `conflictingTreeKeys` is the act gate the operator's resolve opens. Because correlation records nothing more on such a tree, its newest attempt never changes after the conflict, so a resolve is final for that tree.
- `server/src/coord/delegation-projection.ts`: reads the moved derivation; drops an unowned row whose newest attempt a resolution covers; fills `DelegationUnownedWire.leaseId?` with the unreleased lease it hid for a conflict on that tree (`conflicting.has(k) && l.sourceKind !== 'raw'`), so that lease has a control.
- `server/src/coord/delegation-policy.ts` (`Ground` gains `disownedTrees`, built from `disownedTreeKeys`; `finalConflicts` is unchanged; the dispatch beside `finalConflicts` returns no effect for a census record whose (project, admin record, `claudeBase`) is disowned): a lease released `foreign` is final for its tree, so `planLinked` never requests a new lease for it once `holdersOf` (open leases only) finds none, and no attempt is recorded for it. A tree re-created with another creation base is a new tree.
- `server/src/coord/store.ts` and `server/src/coord/ports.ts#WatcherCoordMember`: `CoordStore#delegationRunStampsNaming(sessionId)`, `delegationRunStamps`' five columns over every run, open or closed, whose `sessionId` is the given session, with no limit, all-or-failure like its sibling (`D-7818`).
- Create `server/src/coord/delegationLeaseDoor.ts` (L4, no fastify): the shared body of the three handlers (incarnation reads, applier, transition, re-read, mark request), returning `{status, body}`.
- `server/src/coord/routes.ts`: three thin handlers, `requireMailToken` in the retain handler itself.
- `server/src/coord/delegation-checkpoint.ts`: under O5-8 (c), nothing beyond PR5b's doors (resolve is `transitionLease` and `releaseLease` with `resolvesThrough`). Under O5-8 (a) or (b) only, the tree doors, in two PRs: **PR8a** (reader only) adds every new journal kind, entry field, source word and checkpoint member the tree doors write (under (a): the synthetic-activity entry kind, `tree-resolved`, `attached` in `shared/api.ts#DELEGATION_ACTIVITY_SOURCE_KINDS`, `delegation-model.ts#leaseSourceKindOfActivity`, `WAVE3_LEASE_SOURCE_KINDS` and the codecs, and the `server/src/coord/schema.ts#MIGRATIONS` entry that rebuilds `delegation_activities` with `attached` in its CHECK, which is the operator's ruling against §5.2; under (b): `tree-resolved` and its tree-keyed checkpoint member), folds them, and writes none, with its own W5-J7b twin; **PR8b** adds `attachTree`/`disownTree`, with `createLease`'s minting moved into one private `mintLease` that every lease-creating door calls (the `randomUUID` docstring names `mintLease`). Each door's result passes `validateDelegationCheckpoint` and `assertDelegationCheckpointProjectable` before commit, AND commits through the real SQLite projection inside `commitLocked`, whose CHECK constraints those two never run (row W5-R12f).
- `shared/api.ts`, beside PR1's block: `DelegationUnownedWire` gains optional `leaseId?` (the hidden lease, above) and, under O5-8 (a)/(b) only, optional `treeKey?` (filled with `delegationTreeTarget`, the form the `tree-` target parses); `LEASE_DOOR_REFUSALS`, `LeaseDoorRefusal` and `LeaseDoorAnswer`, declared ONCE here (the PWA cannot import a `server/src/coord` module), each with a `single-definition/vocabularies` row; `delegation-lease-acts.ts` imports them.
- `server/src/auth/gate.ts` (one EXEMPT entry with its reason; the two prose counts), `README.md` (the auth paragraph's counts), `CLAUDE.md` (the box-token bullet names `POST /api/leases/:lease/retain`; the session-only clause names `POST /api/leases/:lease/operator-retain` and `POST /api/leases/:lease/resolve`, and its stale "The other eight" count is corrected to the measured `SESSION_ONLY` size).
- `ccd/ccrc-api`: the `[leases.retain]` row of its hand-kept `ROUTES` table and the header's "fifty-five rows" words, edited directly in that file (`ccrc restamp` regenerates only the file's `ccrc:generated` server-cap reader region and its marks, never the routes; run it only if a generated region changed).
- Create `ccd/coordinator-skill/references/delegated-worktrees.md` (a REFERENCE, not a clause; the nineteen clauses stay verbatim), and its one list line in `ccd/coordinator-skill/SKILL.md`'s references list if the skill keeps one outside its clauses.
- Tests: create `server/test/delegation-lease-acts.test.ts` and `server/test/lease-routes.test.ts`; modify `server/test/delegation-projection.test.ts` (the move, the covered unowned row, `leaseId`), `server/test/delegation-policy.test.ts` (the disowned tree), `server/test/box-token-census.test.ts` (`WORDS` gains `'fifty-nine'`), `server/test/auth-gate.test.ts` (`ROUTES.length` +3 with its history comment, gated +2, exempt +1, the title line), `server/test/coord-pause-route.test.ts` (`SESSION_ONLY` +2 with their arguments; a by-name refusal-order describe for retain), `server/test/routes.test.ts` (the named `:lease` parameter), `server/test/mail-routes.test.ts` (the kebab census admits `isDelegationLeaseActsKebab`), `server/test/ccrc-api.test.ts`, `server/test/ccrc-api-closed.test.ts`, `server/test/coordinator-skill.test.ts`, `server/test/delegation-wave3.integration.test.ts` (the routes row: retain, operator-retain and resolve opened by name; `W5_FLEET_LEASES` gains `ccd/ccrc-api`).

**Why here.** Retain is the digest's first line (PR7), and the operator doors are what D-6999 promised for raw leases and what spec §5.14 promised for unowned trees.

**Interfaces.**
- **Consumes:** PR5b's `transitionLease`, `releaseLease`, `decideLeaseTransition`, `delegationCarrierStateOf`; `server/src/coord/routes.ts`'s intent route helpers (`notConfigured`, `requireMailToken`, `refuseRoute`, `requireAttribution`, `childReclaimGenerationRead`, `readParentGenerations`, `settleParentIncarnations`); `server/src/coord/runBinding.ts#claimantAt`; `server/src/coord/delegation-correlation.ts#delegationTreeKey`; `capSupported` for `lease-mark-v1` and `orphan-lease-v1`.
- **Produces**, consumed by PR7, PR9 and PR10:

  ```ts
  // shared/api.ts (L0), beside PR1's block
  export const LEASE_DOOR_REFUSALS = { 'lease-unknown': 404, 'lease-released': 409, 'not-lease-parent': 403,
    'wrong-disposition': 409, 'not-ready': 503, 'incarnation-changed': 409, 'registry-unmeasurable': 503,
    'not-live-parent': 409, 'tree-not-unowned': 409, 'bad-request': 400, 'lease-conflicting': 409,
    'carrier-behind': 409, 'box-unsupported': 503, 'tree-unleased': 409 } as const;   // tree-unleased: O5-8 (c), no lease on the tree
  export type LeaseDoorRefusal = keyof typeof LEASE_DOOR_REFUSALS;
  export type LeaseDoorAnswer =
    | { ok: true; lease: string; generation: number; disposition: DelegationCarrierState;
        expiresAt: string | null; carrier: 'pending' }
    | { ok: false; error: LeaseDoorRefusal; detail: string };

  // delegation-lease-acts.ts (L1)
  /** O5-4 (a)'s ONE claimant rule: the coordinator the lease's parent worked for when the lease was first observed, exactly the
   *  frame's R9 (`claimantAt`, `delegation-projection.ts#projectDelegation`). Used by PR7's recipient, Retain and PR9's promote.
   *  `runs` is `CoordStore#delegationRunStampsNaming(lease.parentId)`, every run that ever named the parent, never the bounded
   *  `delegationRunStamps()` (whose newest-500-closed window a long-kept lease outlives). */
  export function leaseCoordinatorOf(lease: DelegationLeaseRow, runs: readonly StampedRun[]): string | null;
  // store.ts, joined to WatcherCoordMember
  delegationRunStampsNaming(sessionId: string): DelegationRunStampsResult;
  export type LeaseDoorTarget = { kind: 'lease'; leaseId: string } | { kind: 'tree'; treeKey: string };
  export function parseLeaseTarget(param: string): LeaseDoorTarget | null;  // a UUID, or `tree-<64 hex>` (`delegationTreeTarget`)
  export function decideRetain(input: { lease: DelegationLeaseRow | undefined; carrier: DelegationLeaseCarrierRow | undefined;
    byId: string; byIncarnation: string; coordinator: string | null;      // leaseCoordinatorOf(lease, runs), resolved by the caller
    conflicting: ReadonlySet<string>; boxHolds: boolean; carrierRequired: boolean }):
    { ok: true; reason: 'retain'; expectGeneration: number } | { ok: false; refusal: LeaseDoorRefusal; detail: string };
  export function decideResolve(input: { target: LeaseDoorTarget; action: 'attach' | 'foreign'; parent: string | null;
    checkpoint: DelegationCheckpointV1; conflicting: ReadonlySet<string>;   // conflictingTreeKeys(checkpoint)
    boxHolds: boolean;            // the box reports lease-mark-v1 AND orphan-lease-v1 (capSupported), as decideRetain's
    liveParent: (id: string) => { incarnation: string } | null }):
    // `resolvesThrough`: the tree's newest unowned-work attempt (`newestUnownedAttempts`), or null when the tree has none
    | { ok: true; act: 'transition'; leaseId: string; reason: 'attach'; expectGeneration: number; resolvesThrough: DelegationAttemptMark | null }
    | { ok: true; act: 'release'; leaseId: string; expectGeneration: number; resolvesThrough: DelegationAttemptMark | null }
    // O5-8 (a)/(b) only (PR8b); under (c) a tree target with no unreleased lease refuses `tree-unleased`
    | { ok: true; act: 'attach-tree'; treeKey: string; project: string; adminRecord: string; canonicalPath: string; parentId: string; parentIncarnation: string }
    | { ok: true; act: 'disown-tree'; treeKey: string; project: string; adminRecord: string; canonicalPath: string }
    | { ok: false; refusal: LeaseDoorRefusal; detail: string };
  // delegation-conflicts.ts (L1)
  export function newestUnownedAttempts(cp: DelegationCheckpointV1): ReadonlyMap<string, DelegationAttemptRow>;
  export function conflictingTreeKeys(cp: DelegationCheckpointV1): ReadonlySet<string>;   // newest conflicting AND not covered
  export function resolvedAttemptCovered(cp: DelegationCheckpointV1, a: DelegationAttemptRow): boolean;
  export function disownedTreeKeys(cp: DelegationCheckpointV1): ReadonlySet<string>;     // project, adminRecord, creationBase
  export function delegationTreeTarget(project: string, adminRecord: string): string;   // sha256 hex of delegationTreeKey: the `tree-` URL form
  ```

  Routes (each answers a `LeaseDoorAnswer`):
  - `POST /api/leases/:lease/retain`, box token, body exactly `{byId, byUuid}`.
  - `POST /api/leases/:lease/operator-retain`, session only, body `{}`.
  - `POST /api/leases/:lease/resolve`, session only, body `{action:'attach', parent}` or `{action:'foreign'}`; `:lease` is a lease id or `tree-<treeKey>` for an unowned tree, `<treeKey>` being `delegationTreeTarget(project, adminRecord)` (`D-7837`). A `tree-<treeKey>` whose tree holds an unreleased lease is resolved AS THAT LEASE (the lease the projection hid for a conflict), never as a no-lease tree, so it never mints a second lease on a path an unreleased lease holds (`canonical-path-held`, D18).

**The rules.**
- **Retain's order** (the intent route's): `notConfigured`; `requireMailToken`; the body is exactly `{byId, byUuid}` (else `bad-request`); `:lease` parses as a lease id (else `bad-request`); `requireAttribution(byId, byUuid)`; the caller's incarnation measured (`registry-unmeasurable` 503 otherwise); the applier open and ready (`not-ready` 503); the run stamps of the lease's parent read (`CoordStore#delegationRunStampsNaming(lease.parentId)`, unbounded; unreadable answers `not-ready`; a lease id the checkpoint does not hold skips the read and answers 404 below); `decideRetain`: unknown lease, released lease, then the claimant (the caller is the lease's parent at the lease's incarnation, or, O5-4 (a), `leaseCoordinatorOf(lease, runs)` names the caller; else `not-lease-parent`), then `lease-conflicting` (the lease's tree key is in `conflictingTreeKeys(checkpoint)`: a conflicted tree is final until the operator resolves it, spec §5.4), then `box-unsupported` when the box lacks `lease-mark-v1` or `orphan-lease-v1` and the lease is `ephemeral` (a hold the box rung cannot honour), then the transition (`wrong-disposition` from `transferring` or `promoted`; `carrier-behind` while the carrier has not been read back at the lease's generation); `transitionLease({reason:'retain', expiresAt: now + 7 d, carrierRequired: capSupported(fleetState, 'lease-mark-v1'), resolvesThrough: null})`; the caller's incarnation re-read (`incarnation-changed` 409 on a proven move, the transition standing); the carrier is marked by PR6's step on the next pass (the response says `carrier: 'pending'`). Branch writes renew nothing.
- **Operator-retain**: session-gated (behind the auth gate when armed), `operator-retain` from `ephemeral`, `adopted` or `retained`, expiry reset; it refuses `lease-conflicting`, `box-unsupported` and `carrier-behind` exactly as Retain does. On a conflicted tree only resolve acts; once resolve has covered the conflict, the key leaves `conflictingTreeKeys` and Retain, operator-retain and promotion are open again.
- **The resolution mark (`D-7820`).** Every resolve of a lease writes `resolvesThrough` = the tree's newest unowned-work attempt (`newestUnownedAttempts`, by `attemptedAt` then `attemptId`), or null when the tree has none, in the same `lease-transition` (`attach`) or `lease-released` (`foreign`) entry, so the carrier row's `resolvedThrough` records it (PR5a's grammar; no new kind). `conflictingTreeKeys` drops a key whose newest attempt is covered (ordered at or below some lease's `resolvedThrough` on that tree), and the projection drops that tree's unowned row. A resolve is final for the tree: correlation records no attempt on a tree once any `conflicting` attempt is recorded there (`finalConflicts`, unchanged, `D-7821`), so no newer attempt can follow the one the mark covers, and a later disagreement on the tree is neither recorded nor reopens it.
- **Resolve attach** of a lease: `parent` must equal the lease's parent and be a live ccd registry row with a measured incarnation (`not-live-parent`); re-parenting is never offered. A non-conflicting lease must be `raw` (a non-conflicting linked agent or workflow lease is kept with operator-retain: `wrong-disposition` naming it); a CONFLICTING lease of any source is admitted, because resolve is the one act a conflict admits. An attach of an `ephemeral` lease refuses `box-unsupported` when the box lacks `lease-mark-v1` or `orphan-lease-v1` (`boxHolds` false), exactly as Retain does, because it takes the lease off `ephemeral` and the box rung could not honour the hold (for a `ccd-root` tree, the class a raw lease typically sits at, the server skip answers `free` whenever the applier is not ready); an attach of a lease already `adopted` or `retained` passes (the hold already stands), and foreign, a release, is not gated. The lease moves to `retained` (the `attach` transition, carrier-gated like Retain) and keeps its source and parent (`D-7833`), with the resolution mark.
- **Resolve of a `tree-<key>`.** When the tree holds an unreleased lease (the lease the projection hid for a conflict, or any other), the act is resolve of THAT lease, by the two rules here, and never mints a lease. Under O5-8 (c) a tree with no unreleased lease refuses `tree-unleased`. Under O5-8 (a)/(b) only (PR8b): attach of a no-lease tree needs its newest attempt `unresolved` or `conflicting` (else `tree-not-unowned`) and `parent` a live ccd session of the same project with a measured incarnation; under (a) `attachTree` writes, in one commit, the synthetic activity row (source `attached`, natural key `attached:<treeKey>`), the parent's session row if it has none, and the lease (source `attached`), moved to `retained` (`D-7834`), and the commit is proved through the real SQLite projection (W5-R12f), not only the two in-memory guards; foreign of a no-lease tree journals `tree-resolved` (`D-7836`).
- **Resolve foreign** of a lease: released with reason `foreign` (from any state but `transferring`), with the resolution mark (`D-7835`). It is final for that tree (`D-7822`): correlation reads `disownedTreeKeys` and requests no new lease and records no attempt for a census record with the same project, admin record and creation base, though `holdersOf` (open leases only) no longer finds a holder and `planLinked` would otherwise re-request the lease on the next pass, adopt it again after the settle and mail the parent again. A tree re-created with another creation base is a new tree. Under O5-1 (a) a foreign tree is not held back from the orphan lane. A server rolled back below PR8 loses only the suppression (it re-links a disowned tree), never the journal: PR8 adds no grammar.
- Every handler is at most 15 code lines in `routes.ts`; the body lives in `delegationLeaseDoor.ts`.

### Task 5.8.1: The L1 decisions

- [ ] **Step 1: RED rows** in `server/test/delegation-lease-acts.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { decideRetain, parseLeaseTarget } from '../src/coord/delegation-lease-acts.js';
  import { delegationTreeKey } from '../src/coord/delegation-correlation.js';
  import { leaseRow } from './delegationLeaseFixture.js';

  const lease = leaseRow({ parentId: 'lane-a-demo', parentIncarnation: 'inc-1', disposition: 'adopted', generation: 2,
    cleanupDueAt: '2026-11-17T12:00:00.000Z', carrierGenerationSeen: 2 });
  const noCoordinator = null;
  const ok = { conflicting: new Set<string>(), boxHolds: true, carrierRequired: true };

  describe('decideRetain', () => {
    it('W5-R1: the parent at its incarnation may retain an adopted lease', () => {
      expect(decideRetain({ lease, carrier: undefined, byId: 'lane-a-demo', byIncarnation: 'inc-1', coordinator: noCoordinator, ...ok }))
        .toEqual({ ok: true, reason: 'retain', expectGeneration: 2 });
    });
    it('W5-R2: another session, or the parent in a later incarnation, is not the lease parent', () => {
      expect(decideRetain({ lease, carrier: undefined, byId: 'lane-b-demo', byIncarnation: 'inc-9', coordinator: noCoordinator, ...ok }))
        .toMatchObject({ ok: false, refusal: 'not-lease-parent' });
      expect(decideRetain({ lease, carrier: undefined, byId: 'lane-a-demo', byIncarnation: 'inc-2', coordinator: noCoordinator, ...ok }))
        .toMatchObject({ ok: false, refusal: 'not-lease-parent' });
    });
    it('W5-R3 (O5-4 a): the coordinator that bound the worker parent may retain', () => {
      expect(decideRetain({ lease, carrier: undefined, byId: 'coord-a-demo', byIncarnation: 'inc-c',
        coordinator: 'coord-a-demo', ...ok })).toMatchObject({ ok: true });
    });
    it('W5-R4: a transferring or promoted lease refuses wrong-disposition; a released one lease-released', () => {
      const transferring = { leaseId: lease.leaseId, transferringSince: '2026-11-10T12:00:00.000Z', transferRun: 4,
        promotedRun: null, promotedSession: null, releaseReason: null };
      expect(decideRetain({ lease, carrier: transferring, byId: 'lane-a-demo', byIncarnation: 'inc-1', coordinator: noCoordinator, ...ok }))
        .toMatchObject({ ok: false, refusal: 'wrong-disposition' });
      expect(decideRetain({ lease: { ...lease, releasedAt: '2026-11-11T00:00:00.000Z' }, carrier: undefined, byId: 'lane-a-demo',
        byIncarnation: 'inc-1', coordinator: noCoordinator, ...ok })).toMatchObject({ ok: false, refusal: 'lease-released' });
    });
    it('W5-R5: a target is a UUID or tree-<64 hex>, nothing else', () => {
      expect(parseLeaseTarget('0f8e6a8c-1b2d-4c3e-9f00-0123456789ab')).toEqual({ kind: 'lease', leaseId: '0f8e6a8c-1b2d-4c3e-9f00-0123456789ab' });
      expect(parseLeaseTarget(`tree-${'a'.repeat(64)}`)).toEqual({ kind: 'tree', treeKey: 'a'.repeat(64) });
      for (const bad of ['12', 'tree-xyz', '../x', '0F8E6A8C-1B2D-4C3E-9F00-0123456789AB']) expect(parseLeaseTarget(bad)).toBeNull();
    });
    it('W5-R5b: a conflicting tree, a box without the rung, and a carrier not yet read back each refuse', () => {
      const key = delegationTreeKey(lease.project, lease.adminRecord);
      const base = { lease, carrier: undefined, byId: 'lane-a-demo', byIncarnation: 'inc-1', coordinator: noCoordinator, ...ok };
      expect(decideRetain({ ...base, conflicting: new Set([key]) })).toMatchObject({ ok: false, refusal: 'lease-conflicting' });
      expect(decideRetain({ ...base, lease: { ...lease, disposition: 'ephemeral', cleanupDueAt: null }, boxHolds: false }))
        .toMatchObject({ ok: false, refusal: 'box-unsupported' });
      expect(decideRetain({ ...base, lease: { ...lease, carrierGenerationSeen: 1 } })).toMatchObject({ ok: false, refusal: 'carrier-behind' });
    });
  });
  ```

  And `leaseCoordinatorOf` rows: **W5-R3b** a worker parent whose run closed after the lease's `firstObservedAt` still names that run's coordinator (the run's interval holds the instant); a run opened after `firstObservedAt` does not; a coordinator lease (no run names the parent as worker) names null; it agrees with `projectDelegation`'s row `parentId`/`via` for the same lease and runs (one fixture, both functions). **W5-R3c** fed the store's `delegationRunStampsNaming(parentId)` (a real `CoordStore` with the worker's run followed by 501 closed runs of other sessions), `leaseCoordinatorOf` still names the worker's coordinator, while the same rule fed `delegationRunStamps()` answers null (the control that shows why the read is unbounded).

  And **W5-R5c** (`delegation-projection.test.ts`, beside the `delegation-conflicts.ts` rows): `delegationTreeTarget('demo', 'agent-a')` is 64 lowercase hex and equals `delegationSha256Hex(delegationTreeKey('demo', 'agent-a'))`; `parseLeaseTarget(`tree-${delegationTreeTarget('demo', 'agent-a')}`)` round-trips, and `decideResolve` given that target finds the checkpoint's lease on (`demo`, `agent-a`); `tree-` followed by `delegationTreeKey` itself, or by any other spelling, parses as null or resolves to no tree.

  And `decideResolve` rows: **W5-R6** attach of a raw lease to its own live parent moves it to `retained`; with `boxHolds: false`, attach of an `ephemeral` raw lease refuses `box-unsupported` and attach of an `adopted` conflicting lease passes; to another session refuses `not-lease-parent`; of a NON-conflicting agent lease refuses `wrong-disposition` with a detail naming operator-retain; of a CONFLICTING agent lease to its own parent gives `transition` `attach` with `resolvesThrough` the tree's newest attempt; **W5-R7** a `tree-<key>` whose tree holds an unreleased lease resolves as that lease (`transition` or `release` naming its id, never `attach-tree`); under O5-8 (c) one with no unreleased lease refuses `tree-unleased`; under (a)/(b) only: attach of an unowned `unresolved` tree to a live session of the same project gives `attach-tree`; of a tree with no attempt, or a `linked` one, refuses `tree-not-unowned`; to a dead or unmeasured session refuses `not-live-parent`; **W5-R8** foreign of a lease gives `release` with `resolvesThrough` (null when the tree has no unowned attempt); of a `transferring` lease refuses `wrong-disposition`; under (a)/(b) only, of a no-lease unowned tree gives `disown-tree`; **W5-R8b** resolve is the one act a conflicting lease admits: attach or foreign of a lease whose tree key is conflicting passes the conflict check.

  And `delegation-conflicts.ts` rows (`delegation-projection.test.ts`): **W5-R8e** a tree whose newest attempt is `conflicting` is in `conflictingTreeKeys`; after a raw lease on it carries `resolvedThrough` equal to that attempt it is not, and `decideRetain` and operator-retain of that lease pass the conflict check, and the projection shows no unowned row for the tree; **W5-R8g** (`delegation-policy.test.ts`, a characterisation row committed green on `main` before PR8's policy edit): a census record on a tree with any recorded `conflicting` attempt gets no effect for a `linked`, `unresolved` or `conflicting` verdict, and the same holds after a lease on that tree carries a `resolvedThrough` covering the attempt (correlation keeps `finalConflicts`, so a resolved tree stays out of `conflictingTreeKeys` for good); **W5-R8f** `disownedTreeKeys` holds a lease released `foreign` keyed with its creation base, and not one released `native-removed`.
- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/delegation-lease-acts.test.ts`. Expected: the module does not exist. **Step 3: Implement** both deciders and `parseLeaseTarget`; the module imports only `shared/api.js`, `./delegation-model.js`, `./delegation-lease-state.js` and `./delegation-conflicts.js`. Then `delegation-conflicts.ts` (after its move commit), the projection's covered-row drop and `leaseId`, `delegation-policy.ts`'s `disownedTrees`, and `CoordStore#delegationRunStampsNaming`; run `delegation-projection`, `delegation-policy`, `delegation-correlation` and `rings/watcher-store-port` alone. **Step 4: Run GREEN** Step 2's command, then `rings/totality`, `coord-policy-rings`, `mail-routes` alone. **Step 5: Commit** `feat(delegation): the decisions behind Retain and resolve, in L1`.

### Task 5.8.2: The routes and the doors

- [ ] **Step 1: RED rows** in `server/test/lease-routes.test.ts` (the `coord-pause-route.test.ts` app factory with a real store, a fixture registry and the delegation rig's applier):
  - **W5-R9** retain's refusal order, by name, one request each, in the intent describe's shape: no token 401; a body with an extra key 400 `bad-request`; a non-UUID `:lease` 400; a stale `byUuid` (attribution) refused; an unmeasured incarnation 503 `registry-unmeasurable`; no applier 503 `not-ready`; an unknown lease 404; another session 403 `not-lease-parent`; a promoted lease 409; then 200 with `disposition: 'retained'` and `expiresAt` 7 days on.
  - **W5-R10** an incarnation that moves while the transition is queued answers 409 `incarnation-changed`, and the lease stays `retained` (the transition stands).
  - **W5-R11** operator-retain and resolve need a session (401 without, armed) and ignore the box token; with a session, attach of a raw lease answers 200 `retained`, `sourceKind` still `raw` in the checkpoint; foreign answers 200 and the lease's `releasedAt` is set.
  - **W5-R8c** (`delegation-watch.test.ts`'s rig, the lane over the same store) foreign is final: a linked agent lease with terminal evidence and changes is released `foreign`; over the two passes after, correlation requests no new lease, the lane adopts nothing and queues no mail, and the projection shows neither a lease row nor an unowned row for the tree; the same tree re-created with another creation base is linked as a new lease.
  - **W5-R8d** a hidden conflicting agent lease: the projection's unowned row for its tree carries `leaseId`; resolve attach of `tree-<key>` (or of that `leaseId`) moves THAT lease to `retained` with the resolution mark, and resolve foreign releases it; in both cases the checkpoint holds exactly one lease for the tree (`randomUUID` never called), and the tree leaves `conflictingTreeKeys`. Then resolve-attach of a conflicting raw lease followed by operator-retain answers 200.
  - **W5-R12b** each door commits through the rig's REAL `openCoordDb` store, and the test reads the `delegation_leases` row back from SQLite (generation, disposition, `releasedAt`), for attach of a raw lease, attach of a conflicting agent lease, foreign of a lease and resolve of a `tree-<key>` that holds a lease; each committed checkpoint also passes `validateDelegationCheckpoint` and `assertDelegationCheckpointProjectable`. A CONTROL: a lease built with activity `attached:<key>` and no activity row is refused by `assertDelegationCheckpointProjectable` ("names the activity …, which has no row"), and an activity row with source `attached` inserted into `delegation_activities` is refused by the table's CHECK, which is why O5-8 (a) needs a migration.
  - **W5-R12** (O5-8 (a) only, PR8b) resolve attach of a no-lease `tree-<key>` creates one lease (`randomUUID` called once, through `mintLease`) with source `attached`, disposition `retained`, generation 1, its synthetic activity row and, for a parent incarnation with no session row, that row, all in one journal commit; a second identical request answers 409 `tree-not-unowned` (the tree is linked now).
  - **W5-R12f** (O5-8 (a) or (b) only, PR8b) each tree door commits through a real `openCoordDb` store, and the test reads back the `delegation_activities` row (under (a): source `attached`, after PR8a's migration) and the `delegation_leases` row from SQLite, so the CHECK constraints run; on a store at the pre-PR8a `user_version` the same commit is refused, and that refusal is the row's control.
  - **W5-R12c** a second Retain while the first's carrier has not been read back answers 409 `carrier-behind` and journals nothing; after the lane's next pass reads the carrier back, it answers 200.
  - **W5-R12e** (O5-8 (a) only, PR8b; `delegation-lease-durability.test.ts`) the minting site is one: in `server/src/coord/delegation-checkpoint.ts` with comments stripped, `randomUUID(` appears only inside `mintLease`'s body.
  - **W5-R12d** a box without `orphan-lease-v1` (and, separately, without `lease-mark-v1`): Retain, operator-retain and resolve attach of an `ephemeral` lease answer 503 `box-unsupported` and journal nothing; of an `adopted` one they pass (the hold already stands); resolve foreign passes either way.
  - **W5-R13** the routes use `:lease`, never `:id` (`routes.test.ts`'s integer pin stays green and names the new parameter).
- [ ] **Step 2: RED, the censuses (W5-R14).** `box-token-census` (fifty-nine lanes; CLAUDE.md names retain), `auth-gate` (counts and title), `coord-pause-route` (`SESSION_ONLY` holds the two operator doors with their arguments; neither is EXEMPT), `delegation-wave3.integration`'s routes row (opened by name), each red until the route and prose land.
- [ ] **Step 3: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/lease-routes.test.ts`, then each census file alone. Expected: 404 on every route; the census counts differ.
- [ ] **Step 4: Implement** the doors, the L4 helper, the handlers, the EXEMPT entry ("the caller is a fleet-host session through `ccrc-api` and has no cookie jar", as the intent route's), the prose and counts.
- [ ] **Step 5: Run GREEN** Step 3's commands, then `routes`, `mail-routes`, `rings/fastify-l4` (no new fastify file), `rings/totality`, `delegation-lease-durability` alone.
- [ ] **Step 6: Commit** `feat(delegation): Retain for a lease's parent, and the operator's keep, attach and not-delegated doors`.

### Task 5.8.3: `ccrc-api`, the coordinator skill's reference, and the words

- [ ] **Step 1: RED rows.** **W5-R15** (`ccrc-api.test.ts`): the table holds `[leases.retain]` (`POST /api/leases/<id>/retain`, `--json` body, the id checked against `SAFE_RE`), and the header's row count matches; **W5-R16** (`ccrc-api-closed.test.ts`): the corpus parity finds the reference file's `ccrc-api leases retain` call and the row; **W5-R17** (`coordinator-skill.test.ts`): the nineteen clauses are byte-unchanged; the reference file exists, says "worktree", names the `ccrc-api` op, names NO ccd lease verb and no `ws-add --base`, and disambiguates "adopted" from `wave-lifecycle.md`'s `spawn-adopted` in one sentence.
- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/ccrc-api.test.ts`. Expected: W5-R15 fails (no `[leases.retain]` row; the count reads fifty-five). **Step 3: Implement** the `[leases.retain]` row directly in `ccd/ccrc-api`'s hand-kept `ROUTES` table and the header's row-count words ("fifty-five rows" becomes "fifty-six rows"); `ccrc restamp` is not run, because no `ccrc:generated` region changes. Write the reference: what an adopted worktree is, how long it is kept, the Retain line, that promotion is a `runs open` with `promotesLease` (PR9), and that unowned worktrees are the operator's to attach or disown. **Step 4: Run GREEN** the three files alone and `delegation-wave3.integration`. **Step 5: Commit** `feat(ccrc-api): leases retain, and the coordinator's reference on delegated worktrees`.

### PR8 mutation table

| Mutant | Edit | Goes red |
|---|---|---|
| W5-RM1 | accept the parent at any incarnation | W5-R2 |
| W5-RM2 | retain a promoted lease | W5-R4 |
| W5-RM3 | move `requireMailToken` after the body check | W5-R9 (the 401 row answers 400) |
| W5-RM4 | accept `:lease` of any shape | W5-R5, W5-R13 |
| W5-RM5 | attach a raw lease with source changed to `attached` | W5-R11 |
| W5-RM6 | (O5-8 (a) only) call `randomUUID` outside `mintLease` | W5-R12e: a text census of `server/src/coord/delegation-checkpoint.ts` (comments stripped) in which `randomUUID(` appears only inside `mintLease`'s body (a call-count spy cannot see the site: it still counts one call) |
| W5-RM9 | drop the `lease-conflicting` check | W5-R5b |
| W5-RM10 | drop the `carrier-behind` check (`carrierRequired: false` in the door) | W5-R5b, W5-R12c |
| W5-RM11 | drop the `box-unsupported` check (in `decideRetain`, and separately in `decideResolve`'s attach arm) | W5-R5b, W5-R6 (the `boxHolds: false` case), W5-R12d (the attach case) |
| W5-RM18 | build a tree set with a hand-rolled spelling instead of `delegationTreeKey`, or parse `tree-` against anything but `delegationTreeTarget` | W5-R5b, W5-R5c |
| W5-RM19 | replace `finalConflicts` with `conflictingTreeKeys` in correlation | W5-R8g (an attempt or lease request is recorded on the resolved tree) |
| W5-RM12 | resolve the coordinator with `bindingOf` instead of `leaseCoordinatorOf` | W5-R3b |
| W5-RM13 | feed `leaseCoordinatorOf` the bounded `delegationRunStamps()` in the doors | W5-R3c |
| W5-RM14 | resolve writes `resolvesThrough: null` | W5-R8d, W5-R8e (the key stays conflicting; operator-retain refuses) |
| W5-RM15 | correlation ignores `disownedTreeKeys` | W5-R8c (a new lease is requested and adopted again) |
| W5-RM16 | resolve of a `tree-<key>` that holds a lease mints a new lease | W5-R7, W5-R8d |
| W5-RM17 | admit resolve attach of a non-conflicting agent lease | W5-R6 |
| W5-RM7 | remove an operator door from `SESSION_ONLY` | W5-R14 |
| W5-RM8 | name `ws-lease-mark` in the reference | W5-R17 |

### PR8 at its tip

**Suites alone:** `delegation-lease-acts`, `lease-routes`, `delegation-projection`, `delegation-policy`, `delegation-correlation`, `delegation-watch`, `delegation-recovery` (W5-J7b on this build), `box-token-census`, `auth-gate`, `coord-pause-route`, `routes`, `mail-routes`, `ccrc-api`, `ccrc-api-closed`, `coordinator-skill`, `delegation-lease-durability`, `delegation-wave3.integration`, `rings/totality`, `rings/fastify-l4`, `single-definition` files, `docs-parity`, `citations`, `growth-check` (`GROWTH_CHECK=1`), `deviation-refs`; the `pwa` typecheck. **Growth check:** `routes.ts` at most +40 (three handlers of at most 15 lines; waived anyway by the new coord files); `ccd/ccrc` unchanged. **Rollout:** fleet box first (`ccrc-api`, the reference), then the server; under O5-8 (a)/(b), PR8a to the server box, measured and kept a release, before PR8b merges (it then becomes the rollback floor). **Review focus:** (1) retain's refusal order is the intent route's; (2) the claimant rule is one rule (O5-4: `leaseCoordinatorOf`, R9's own), and a conflicting tree admits only resolve; (3) the operator doors are session-only and never EXEMPT; (4) resolve ends a conflict through the resolution mark, a `tree-<key>` holding a lease is resolved as that lease, and foreign is final for the tree; under O5-8 (c) PR8 adds no journal kind, entry field, source word or checkpoint member that PR5a does not fold, and under (a)/(b) PR8a ships every one of them a release ahead of PR8b, whose tree doors are each one commit proved through the real SQLite projection; (5) every count and census moved by exactly the routes added; (6) the claimant read is unbounded. **Must NOT:** add a lane file the census cannot see; journal grammar the floor build does not fold; renew on a branch write; re-parent a linked lease; describe any act as repair.

## PR9: S5, promotion through `ws-add --base`

**Wave 5b (`D-7940`).** The operator split promotion out of wave 5 on 2026-11-04. This section is unchanged, but it is dispatched as wave 5b, once the rest of wave 5 has landed and been used, and only when the operator says so.

**Goal.** A lease's parent, or a worker parent's coordinator, opens an ordinary run with `promotesLease`; its dispatch moves the lease to `transferring`, measures the tree, starts the run's child workspace at the tree's tip with `ws-add --child <run> --base <tip>`, and records the lease `promoted`. A crash at any edge resolves on a measured outcome: the first ready pass that can prove it, or after a composed `ws-add`'s kill bound. Nothing is promoted automatically, and the old tree is then left to the orphan ladder's own rungs.

**Branch and base.** PR9a from `main` with PR7 and PR8 merged; PR9b from `main` with PR9a merged and measured on the server box, and PR2 and PR3 measured on the fleet box. **Deploy class.** SERVER (and one coord.db migration under O5-5 (a), in PR9a).

**Two pull requests, reader first (`D-7808`).** A server rolled back below PR9 fails open: it ignores `promotedLeaseId`, so its `spawnFresh` dispatches a planned promoting run (a re-dispatch after `lease-tree-dirty`, say) as a plain `ws-add --child` at origin's base, the fallback this PR forbids, and it has no recovery for a lease a crash left `transferring` (held with no expiry, Retain `wrong-disposition`, resolve refused), so that lease is wedged until the server moves up again. So PR9 ships as two PRs, like PR5. **PR9a (reader and recovery):** the migration, `RunRow`, `RUN_ROW_COLUMNS`, `hydrateRun`, `toRunSummary`, `runsByPromotedLease`, the optional wire fields and their PWA readers, `planTransferRecovery` and its lane call (Task 5.9.4's recovery rows), `base-unsupported` in `RunRefuseCode`, and one dispatch refusal, on the fresh-spawn arm only: a dispatch of a run carrying `promotedLeaseId` whose `sessionId` is null answers `base-unsupported` before any transition, composing no `ws-add` of any shape (row W5-P6d), while the resume of a bound session proceeds as on `main` (it composes no `ws-add`, so it never needed the refusal; refusing it would wedge a bound promoting run whose lease is already `promoted` on a server rolled back to PR9a, `D-7853`); `POST /api/runs` still has no `promotesLease` gate, so a body naming it answers `bad-request`. **PR9b (writers):** the two open-run gate rows (Task 5.9.2), the dispatch arm's four steps in place of PR9a's refusal (Task 5.9.3), the `lease-already-promoted` refusal, the carrier step's skip of a `transferring` lease (row W5-P14g), the recovery rows that need a live or crashed promoting dispatch (W5-P14f, W5-P15's step-3/4 half; mutants W5-PM14 and W5-PM16), and the digest's promote line (W5-P17). PR9a merges, rolls out to the server box and stays there a release before PR9b may merge; once any run carries `promotedLeaseId` or any lease has been transferred, PR9a is the server's rollback floor (the Gate).

**Files.**
- `server/src/coord/schema.ts#MIGRATIONS`: one entry at the next free slot (38 on `0c95592bc`; re-measure by the header's recipe), `ALTER TABLE runs ADD COLUMN promotedLeaseId TEXT` and a partial index on it where not null (O5-5 (a)).
- `server/src/coord/store.ts`: `RunRow`, `RUN_ROW_COLUMNS`, `CoordStore#openRun` (stores the field), `toRunSummary`, `hydrateRun`, and `CoordStore#runsByPromotedLease` (a narrow read beside `delegationRunStamps`, joined to `server/src/coord/ports.ts#WatcherCoordMember`), which also answers, per run, its `dispatchStartedAt`, the sessions its `session-unbound:` events name (through `server/src/coord/runSpend.ts#unboundSessionOf`, the reader the dead-dispatch pass uses), its newest `promotion-ws-add-composed` run event (`at` and the transfer generation its detail names) and whether a dispatch refusal was recorded after it. The event is written through the existing `CoordStore#recordRunEvent` (the non-transition `run_events` writer), so no table or column is added for it.
- `shared/api.ts`: `RUN_EXECUTION_ORIGINS = ['dispatch', 'promoted-lease'] as const` and `RunExecutionOrigin = (typeof RUN_EXECUTION_ORIGINS)[number]`, declared once beside `RunSummary` with a `single-definition/vocabularies` row; `RunSummary` gains OPTIONAL `executionOrigin?: RunExecutionOrigin` and `promotedLeaseId?: string | null` (wire discipline: an older server omits both, so each has ONE PWA reader that reads absence as `'dispatch'` and null, and `older-server-render.test.tsx` stays byte-for-byte), while `hydrateRun` always computes both; `RunRefuseCode` gains `lease-unknown`, `lease-unavailable`, `not-lease-claimant`, `lease-not-promotable`, `lease-project-mismatch`, `lease-already-promoting`, `lease-already-promoted` (PR9b), `lease-conflicting`, `lease-tree-dirty`, `lease-tree-busy`, `base-unsupported`; `DelegationLeaseWire` gains optional `promotedRun?: number | null` as the last member of `DelegationLeaseWire`'s body (after PR7's two), never in the comments the visibility release edits; `DelegationObservationHealth` gains optional `transfers?: DelegationTransferHealth` (PR9a), one reader, absence permits.
- `pwa/src/fleet/runWords.ts` (or the file that reads `RunSummary` today, re-measured): the two readers `executionOriginOf(r)` and `promotedLeaseIdOf(r)`, absence permits.
- `server/src/coord/openRun.ts#OPEN_RUN_GATES`: two rows.
- `server/src/coord/dispatchDecide.ts#decideDispatch` and `server/src/coord/dispatch.ts` (`spawnFresh`): the promoting arm, which marks the carrier synchronously through PR6's `markLeaseCarrier` after each transition, re-checks before step 3 that the lease is still `transferring` at g + 1, and records the `promotion-ws-add-composed` run event before it composes `ws-add`. No in-process in-flight set is created: crash recovery reads only that durable event and box measurements, so it means the same before and after a restart. What keeps recovery from acting on a LIVE dispatch is the coordination serialiser, not process memory: the dispatch route runs `dispatchRun` inside `coordMutex` across all four steps (`server/src/coord/routes.ts`: `coordMutex.run(() => dispatchRun(...))`), and every recovery act runs inside that same mutex (below).
- `server/src/coord/runBinding.ts#BINDING_WRITER_VERBS`' callers: unchanged. PR9 adds no binder: a returned child of a promoting run is bound by the dead-dispatch pass (D-7563, `server/src/coord/abandonDeadDispatch.ts`, through `childBindGate` then `bindReturnedChild`), the one binder of that fact on `main` (row W5-P14c pins that no PR9 file calls `bindSession`).
- Create `server/src/coord/delegation-promotion.ts` (L1): the measure verdict and the recovery planner.
- `server/src/watch.ts`: recovery as the LAST step of the `leaseActs` phase, after native-removed, adopt and carriers, so a long hold of the serialiser by another route never costs those steps their pass (`D-7855`). Every recovery act (`recover`, `record`) runs on the coordination serialiser: `DelegationLane` holds no serialiser handle on `main`, so `buildServer` hands it `registerCoordRoutes`' `serial` the way `FleetWatcher#useStopDoneSerialiser` hands the stop-done lane its own. The step takes `serial` ONLY when the pass's checkpoint, read before the hold, holds a `transferring` lease, so a pass with nothing to recover never queues behind a dispatch's `ws-add` (the route holds the `CoordMutex` across it, up to the runner's 300 s ceiling, and so do close, reclaim, settle and the dead-dispatch and stop-done lanes). Inside the hold the lane checks `pass.signal.aborted` first (`DELEGATION_PASS_BUDGET_MS`, 45 s, raced in `DelegationLane#pass`, cuts a pass and releases its latch while its queued work keeps unwinding, so a cut pass's callback can run long after its budget), re-reads the checkpoint, `runsByPromotedLease` and the registry listing, reads the dispatch-abandon switch through `dispatchAbandonViewOf`, plans, and checks `pass.signal.aborted` again before each journal write: a cut pass plans or journals nothing late, and the next pass recovers or records. With no serialiser wired (before `buildServer` hands it over, or in a rig that supplies none, the stop-done lane's null-`serial` rule), the step plans nothing and counts the `transferring` leases `unserialised` in the lane's health. The lane's carrier step skips a `transferring` lease (PR9b, row W5-P14g): the promoting dispatch marks it synchronously, and a lane mark beside the dispatch's would collide on the verb's `flock -n` (`busy`, which step 1 reads as `transfer-refused`). A transfer whose step-1 mark never ran is the crash between steps 1 and 3, which recovery resolves on its first pass, after which the lease is no longer `transferring` and the lane catches its carrier up.
- `server/src/coord/delegation-adoption.ts`: `LeaseDigestDoors.promote` true; the promote line.
- `server/src/coord/delegation-projection.ts`: `promotedRun`.
- `deploy/coordination-snapshot.mjs`: only if it pins `user_version` (measure first).
- Tests: create `server/test/delegation-promotion.test.ts` and `server/test/promotion-dispatch.test.ts`; modify `server/test/open-run-preconditions.test.ts` (the gate-order table), `server/test/coord-db.test.ts` (`COORD_SCHEMA_VERSION` and `MIGRATIONS.length` from 37 to 38), `server/test/mail-routes.test.ts` (every new `RunRefuseCode` quoted in `server/src/coord`), `server/test/id-argv-census.test.ts` (the lease id and the tip reaching `wsAddWorkerBase`), `server/test/run-states.test.ts` (re-run: no state added), `server/test/delegation-wave3.integration.test.ts` (the `promotesLease` row of `W5_OPEN` gains `server/src/coord/openRun.ts`, `server/src/coord/dispatch.ts`, `server/src/coord/dispatchDecide.ts`, `shared/api.ts`; the `ws-add --base` row gains `server/src/coord/dispatch.ts`).

**Why here.** Last of the server PRs: it needs the doors (PR5), carriers (PR6), the digest (PR7), the claimant rule (PR8), and on the box the audit (PR2) and `--base` (PR3).

**Interfaces.**
- **Consumes:** `CCD_ARGV.wsAddWorkerBase`, `WS_ADD_BASE_CAP` (PR3); `CCD_ARGV.leaseAudit`, `LEASE_AUDIT_CAP`, `LeaseAuditAnswer` (PR2); `transitionLease`, `noteCarrierSeen` (PR5b); `markLeaseCarrier` (PR6); `leaseCoordinatorOf`, `conflictingTreeKeys` and `CoordStore#delegationRunStampsNaming` (PR8); the coordination serialiser (`registerCoordRoutes`' `serial`, the `CoordMutex` the dispatch route holds); the dead-dispatch pass's bind of a returned child (D-7563, `abandonDeadDispatch.ts`, read only through the run's `sessionId`, never called), and the facts that pass decides on, read the same way it reads them: `server/src/coord/deadDispatch.ts#dispatchAbandonViewOf`, `server/src/coord/runSpend.ts#unboundSessionOf`, `cfg.dispatchAbandonMs`, and the `deadCoordinator` row's cadence in `server/src/laneSchedule.ts`; `server/src/remote/runner.ts`'s `CCD_VERB_TIMEOUT_MS['ws-add']` (300 s, the bound the agent's `execFile` applies as its `timeout`); `queueRunlessNotice` (PR7); `orphan-lease-v1` and `lease-mark-v1` through `capSupported`.
- **Produces**, consumed by PR10:

  ```ts
  // delegation-promotion.ts (L1)
  export function decidePromotionMeasure(a: LeaseAuditAnswer | 'unsupported', activity: { executionState: DelegationExecutionState;
    parentDead: boolean } | null): { ok: true; tip: string; token: string } | { ok: false; code: 'lease-tree-dirty' | 'lease-tree-busy' | 'lease-unavailable'; detail: string };
  export const DELEGATION_TRANSFER_KILL_MARGIN_MS = 60_000;   // past the verb's kill bound, before an empty listing proves it ended
  export function planTransferRecovery(input: { checkpoint: DelegationCheckpointV1; runs: ReadonlyMap<string, { id: number;
    state: RunState; project: string; sessionId: string | null;
    dispatchStartedAt: number | null;                         // the run's column, which the dead-dispatch pass's population reads
    unboundSessions: readonly string[];                       // `runSpend.ts#unboundSessionOf` over the run's events (`session-unbound:`)
    composed: { at: number; generation: number } | null;      // the newest `promotion-ws-add-composed` run event, durable
    dispatchRefused: boolean }>;                              // a dispatch refusal recorded after that event
    children: { ok: true; listedAtMs: number; rows: readonly { id: string; project: string; childRunId: number }[] } | { ok: false };
    abandonArmed: boolean;                                    // dispatchAbandonViewOf(coord.dispatchAbandonSetting(), cfg.dispatchAbandonMs).armed
    dispatchAbandonMs: number;                                // cfg.dispatchAbandonMs, the dead-dispatch pass's own bound
    deadDispatchCadenceMs: number;                            // laneSchedule.ts's `deadCoordinator` row cadence (CHILD_RECLAIM_SWEEP_MS)
    nowMs: number;                                            // read inside the hold, after the reads above
    wsAddKillMs: number }):                                   // CCD_VERB_TIMEOUT_MS['ws-add'], fed in
    readonly ({ kind: 'recover'; leaseId: string; expectGeneration: number }
      | { kind: 'record'; leaseId: string; expectGeneration: number; runId: number; sessionId: string }
      | { kind: 'wait'; leaseId: string; why: string; attention: boolean })[];   // no bind arm: D-7563's pass binds a returned child
  // store.ts
  runsByPromotedLease(): Map<string, { id: number; state: RunState; project: string; sessionId: string | null;
    dispatchStartedAt: number | null; unboundSessions: readonly string[];
    composed: { at: number; generation: number } | null; dispatchRefused: boolean }>;
  // shared/api.ts (PR9a): DelegationObservationHealth gains optional `transfers?: DelegationTransferHealth`
  export interface DelegationTransferHealth { transferring: number; waiting: number; attention: number;
    unserialised: number }                                    // unserialised: transferring leases a pass could not plan (no serialiser wired)
  ```

**The open-run gates.** `promotesLease` shape: absent, or a lease UUID, and only with `kind: 'work'` (row `promotesLeaseShape`, right after `shape`). After `attribution` and before any other store-reading gate (row `leaseClaimant`): the lease is read from the delegation checkpoint (`watcher.delegationCheckpointIfReady()`, PR4): not ready `lease-unavailable`; no such lease `lease-unknown`; released, `promoted` or `transferring` `lease-not-promotable`; its tree key in `conflictingTreeKeys(checkpoint)` `lease-conflicting` (only resolve acts on a conflicted tree, spec §5.4); its project differs from the run's `lease-project-mismatch`; the run stamps of the lease's parent read (`CoordStore#delegationRunStampsNaming(lease.parentId)`, unbounded, unreadable `lease-unavailable`); the claimant is not the lease's parent, nor `leaseCoordinatorOf(lease, runs)` (O5-4's one rule, R9's own; never the current binding `bindingOf`), `not-lease-claimant`. After the store reads, an open run already carrying this `promotedLeaseId` answers `lease-already-promoting`. A lease consumes no slot; the run consumes one at dispatch like any run (`ACTIVE_RUN_STATES` unchanged).

**The dispatch arm (four steps, in `spawnFresh` for a run with `promotedLeaseId`).**
Spec §5.7's shape: `ws-lease-mark` advances the carrier as part of each step, so the carrier is never two transitions behind and the audit reads the generation it is asked about (`D-7814`). Every transition below passes `carrierRequired: true` where its reason is gated.
0. **A lease already promoted.** Before any capability test or transition, read the lease from the ready checkpoint: `promoted` with its carrier row's `promotedRun === run.id` refuses `lease-already-promoted`, detail "this run's lease was already promoted to a child that has since been spent; abandon this run and open a fresh run", composing no `ws-add` of any shape and journalling nothing (row W5-P6e). That state is reachable: the dead-dispatch pass binds the returned child, recovery `record`s the lease `promoted`, the run stays `planned`, the resume arm then finds the child spent and `CoordStore#clearSession` unbinds it ("the next dispatch takes the fresh-spawn arm and mints a new child"), and a `transfer` from `promoted` would be refused `wrong-disposition` on every re-dispatch with nothing telling the coordinator why. A lease that is released, or `promoted` to another run, refuses `lease-not-promotable` the same way, and a checkpoint that is not ready refuses `lease-unavailable`. A plain-child re-spawn is not offered: it would be the `ws-add` fallback this PR forbids (`D-7854`).
1. **Transfer.** No `lease-mark-v1` or `orphan-lease-v1`: refuse `base-unsupported` before any transition. `transitionLease({reason:'transfer', runId})` (g to g + 1; refused `carrier-behind` while the carrier has not been read back at g); then, synchronously, `markLeaseCarrier` at g + 1 with `--state transferring`, its read-back and `noteCarrierSeen(g + 1)`. A refused mark, or a read-back whose generation or state is not (g + 1, `transferring`), runs `transfer-refused` (step 2's refusal arm). The orphan skip (PR4) holds the tree from the journal at once, and the box rung from the carrier. Every audit token minted before g + 1 is stale by its generation, and step 2 audits at exactly g + 1.
2. **Measure.** No `lease-audit-v1`: refuse `lease-unavailable`. `runCcd(CCD_ARGV.leaseAudit(id, g + 1, withHolders))`; `decidePromotionMeasure`: dirty or any unmeasured fact refuses `lease-tree-dirty` ("commit or discard in the worktree first"); under O5-2 (b) an `active` activity under a live parent refuses `lease-tree-busy`, and `unknown` or an `active` one under a dead parent passes only with `holders` empty (unmeasured refuses). On any refusal: `transitionLease({reason:'transfer-refused'})` (g + 1 to g + 2), then `markLeaseCarrier` at g + 2 with the prior disposition, synchronously (a refused mark is left to the lane's catch-up, which the verb's monotonic rule makes possible), and the run's dispatch is refused with the code.
3. **Dispatch.** No `ws-add-base-v1`: refuse `base-unsupported` (and `transfer-refused`); never a plain `ws-add`. Then re-read the checkpoint: a lease no longer `transferring` at g + 1 refuses `lease-unavailable` and composes no event and no `ws-add` (row W5-P14h; under the serialiser no recovery can have moved it, so this is a second wall, not the first). Otherwise record the durable `promotion-ws-add-composed` run event first (`CoordStore#recordRunEvent`, detail `promotion-ws-add-composed lease=<id> generation=<g + 1>`, `at` the server's now), then `CCD_ARGV.wsAddWorkerBase(run.project, dec, route, run.id, tip, slug, defaultOk)`, the ordinary child path (`.child` minted by the verb, never forged). A crash after the event and before `runCcd` is treated by recovery exactly like a `ws-add` that may still be running. A refusal from the verb: `transfer-refused`, marked as in step 2.
4. **Record.** `transitionLease({reason:'promote', runId, promotedSession: <the child's id>, auditEvidence: token})` (g + 1 to g + 2): the lease's lineage closes `transfer` and a run-owned lineage row opens; then, synchronously, `markLeaseCarrier` at g + 2 with `--state promoted --promoted-run <id> --promoted-session <child>` (a refused mark is left to the lane's catch-up). Then a feed row (`notify(…, 'record-only')`, the `server/src/orphanTreeBeat.ts` idiom, spec §9 "feed rows per … promotion") naming the tree, the run and the tip; and one `queueRunlessNotice` to the parent (and to the coordinator when it is not the parent), subject `delegation: worktree moved to run <id>`, body: "Your worktree <path> moved to run <id>, starting at <tip>. Untracked and ignored files did not travel; they stay in the old worktree, which the disk sweep may remove once it is clean (unpushed commits are saved to a rescue ref first)."

**Crash recovery (`planTransferRecovery`, in `leaseActs`), on measured outcomes only, inside the coordination serialiser (`D-7815`).** No outcome is inferred from silence (the 2026-11-02 scope decision). The step runs last in `leaseActs`, and only when the checkpoint the pass read before any hold holds a `transferring` lease; it then takes the coordination serialiser (`registerCoordRoutes`' `serial`, the `CoordMutex` the dispatch route holds across all four steps), checks `pass.signal.aborted`, re-reads the checkpoint, `runsByPromotedLease`, the registry listing and the dispatch-abandon switch inside that hold, plans, and journals every `recover` and `record` before it lets go, checking `pass.signal.aborted` before each journal write, so a pass the budget cut while it queued journals nothing when its callback finally runs. With no serialiser wired it plans nothing and counts the leases `unserialised`. So a recovery never interleaves with a live promoting dispatch: it sees a lease before step 1, after step 4, or after a refusal, never one a live dispatch has transferred and not yet finished (row W5-P14f). Without that hold, a pass during step 2's audit (about 20 s with `--holders`, W5-G15) would see a `transferring` lease, no composed event and no `.child`, and journal `transfer-recovered`; the dispatch would then compose `ws-add` at the tip, bind the child, and have its step-4 `promote` refused `stale-generation`, leaving a bound child at the lease's tip while the lease read `adopted` and could be promoted again. Three facts on `main` shape the rest. Spawn adoption (`server/src/coord/dispatchDecide.ts#decideBind`, `adopted` on `cutShort`) runs inside the dispatch call that composed the `ws-add`; after a restart, a returned child of a planned run with no session is bound only by the dead-dispatch pass (D-7563, `server/src/coord/abandonDeadDispatch.ts`, on the coordination serialiser, under the operator's dispatch-abandon switch and its bound `dispatchAbandonMs`, which `server/src/config.ts#dispatchAbandonMsOf` keeps at or above `SPAWN_STALL_MS`, outside the `ws-add` ceiling), through `childBindGate` (`server/src/coord/childBind.ts`, "THE ONE GATE every door that binds an existing workspace to a run calls") then `bindReturnedChild`, only for a live pane with no hold, and never for a session the resume arm unbound (`session-unbound:`). The same pass abandons a planned run whose dispatch never came back (D-7319), which closes it `failed`. Recovery binds nothing itself: a second binder of the same fact would skip `childBindGate` and the `session-unbound` refusal and could bind a spent child back onto the run (`D-7816`). And the agent kills only its ptys and tails when the link closes (`agent/src/server.ts`'s `ws.on('close')`), never an exec: a `ws-add --child <run> --base <tip>` a dead server composed keeps running on the fleet box until it exits or the agent's `execFile` `timeout` kills it (`CCD_VERB_TIMEOUT_MS['ws-add']`, 300 s), and `cmd_ws_add` writes `$REG/<id>.child` late, after `git fetch` and `git worktree add`. So, for each `transferring` lease, whose run is `transferRun`, in order: (1) the run's `sessionId` is set and a registry row's `.child` names `transferRun`: `record` it `promoted` with that session. (2) A successful listing shows one or more `.child` rows naming `transferRun` while the run names no session: `wait`. The dead-dispatch pass binds a lone returned child once its own bound has passed and `childBindGate` admits it, and the next pass then takes (1); until then the lease stays `transferring` and is counted in health. The `wait` carries one attention item naming the run (`attention: true`), never a pick and never a bind, on any of these causes, each a fact the planner's input carries (`D-7856`): (a) `abandonArmed` is false (the switch off; the dead-dispatch pass binds nothing then); (b) two or more such rows; (c) the lone child's id is in the run's `unboundSessions` (the resume arm unbound it, which `childBindGate`'s `session-unbound` refusal keeps unbound); (d) the run is not `planned`, or its `dispatchStartedAt` is null, so the dead-dispatch pass's population (`CoordStore#stalledDispatchRunIds`: `planned`, no session, a stamp) never reaches it; (e) the lone child has been listed while the run stays unbound past `dispatchStartedAt + dispatchAbandonMs + deadDispatchCadenceMs`, measured at `nowMs`: the pass's own bound has passed and a whole cadence of that pass has run since without binding it, which is how the gate's refusal (spent or unmeasured) shows to a lane that never calls `childBindGate`. Before (e)'s instant, with none of (a) to (d), the `wait` carries no attention item. The operator's paths are the switch, or abandoning the run: a terminal run's late child is taken by the child reclaim lane under its existing rule, after which (3) recovers. (3) A successful listing proves that no `.child` row names `transferRun`, AND one of: the run is terminal or abandoned (the dead-dispatch pass's abandon arm included); a dispatch refusal was recorded after its newest `promotion-ws-add-composed` event; the run has NO such event at the lease's transfer generation (no `ws-add` was ever composed: a crash between steps 1 and 3, which recovers on the first ready pass, as spec §5.7 says; a live dispatch in steps 1 and 2 is in the same durable state, which is why this arm is only ever read inside the serialiser the dispatch holds); or the listing was taken at or after that event's `at + wsAddKillMs + DELEGATION_TRANSFER_KILL_MARGIN_MS`, when the composed verb has exited or been killed: `recover` (`transfer-recovered`). (4) Anything else, a listing taken inside that bound, an unmeasured or failed listing included: `wait`, counted in health. The kill bound is a measured property of the exec, never a guess about the dispatch, and row W5-P14e pins its premise: a `ws-add` killed by the agent's timeout signal leaves no `.child` written afterwards; if the fixture shows otherwise, the bound arm is dropped and (3) recovers only on a terminal run or a recorded refusal. Spec §5.7's "exactly one owner throughout" holds: the lease never returns to `adopted` while a child at its tip carries `.child` naming the run or a live dispatch may still compose one, and none can appear after a recovery. The promoted child lands in rung 1 of correlation within two passes and is never leased (spec §5.4).

### Task 5.9.1: The run fields and their storage (PR9a)

- [ ] **Step 1: RED rows.** **W5-P1** (`coord-db.test.ts`): `COORD_SCHEMA_VERSION` and `MIGRATIONS.length` are 38, and a database migrated from 37 has `runs.promotedLeaseId` nullable with every old row null; **W5-P2** (a new describe in `promotion-dispatch.test.ts`): `openRun` with `promotedLeaseId` stores it; `hydrateRun` answers `executionOrigin: 'promoted-lease'` and the id; a run without it answers `'dispatch'` and null; `runsByPromotedLease` returns exactly the open and closed runs that carry one; **W5-P2b** (`pwa`): `executionOriginOf` and `promotedLeaseIdOf` read a `RunSummary` without either field as `'dispatch'` and null, and `older-server-render.test.tsx` stays byte-for-byte; `RUN_EXECUTION_ORIGINS` is declared once (`single-definition/vocabularies`).
- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/coord-db.test.ts`. Expected: W5-P1 fails (37 found). **Step 3: Implement** the migration (the `unattributed` entry's `ALTER TABLE` shape), the row, columns, summary and read. **Step 4: Run GREEN** with `run-states`, `rings/watcher-store-port`, `coord-store` (every `server/test/coord-*.test.ts` that reads `RunSummary`) alone, and the `pwa` typecheck. **Step 5: Commit** `feat(runs): promotedLeaseId on runs, executionOrigin derived (O5-5)`.

### Task 5.9.2: The open-run gates (PR9b)

- [ ] **Step 1: RED rows** in `open-run-preconditions.test.ts`: **W5-P3** the gate-order table lists `promotesLeaseShape` right after `shape` and `leaseClaimant` after `attribution` and its own run-stamps read, before any other store-reading gate; **W5-P4** one row per refusal, each the first to fire for its input (`promotesLease: 'x'` → `bad-request`; with `kind: 'review'` → `bad-request`; checkpoint not ready → `lease-unavailable`; unknown → `lease-unknown`; promoted → `lease-not-promotable`; another project → `lease-project-mismatch`; another session → `not-lease-claimant`; a conflicting tree → `lease-conflicting`; the coordinator `leaseCoordinatorOf` names → passes, also when the worker's run closed before the open (its interval holds `firstObservedAt`) and when the worker's row was re-created under the same id; a coordinator of a LATER run of that worker, which `bindingOf` would name but R9 does not → `not-lease-claimant`; the coordinator of a worker run followed by 501 closed runs (outside `delegationRunStamps()`' window) → passes, read through `delegationRunStampsNaming`; a second open run for the lease → `lease-already-promoting`).
- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/open-run-preconditions.test.ts`. Expected: W5-P3 fails (the table has no `promotesLeaseShape` row) and every W5-P4 row answers 201. **Step 3: Implement** the two rows, the codes in `RunRefuseCode`, and the checkpoint dep on the gate context. **Step 4: Run GREEN** with `mail-routes` and `routes` alone. **Step 5: Commit** `feat(runs): POST /api/runs takes promotesLease, for the lease's parent or its coordinator`.

### Task 5.9.3: The dispatch arm (PR9b; PR9a ships only its refusal, W5-P6d)

- [ ] **Step 1: RED rows** in `server/test/promotion-dispatch.test.ts` (the dispatch suites' fake fleet: a recording `runCcd`, `fleetState.ccdVerbs` set per row, the delegation rig's applier):

  ```ts
  it('W5-P5: a clean adopted tree is transferred, measured, dispatched at its tip and recorded promoted', async () => {
    const w = await promotionWorld({ caps: ['lease-audit-v1', 'ws-add-base-v1', 'lease-mark-v1', 'orphan-lease-v1'], disposition: 'adopted',
      audit: { ok: true, tip: 'c'.repeat(40), dirty: false, aheadOfBase: 2, changed: true, token: 'd'.repeat(64) } });
    const run = await w.openPromotingRun();
    await w.dispatch(run.id);
    const argv = w.calls().find((a) => a[0] === 'ws-add')!;
    expect(argv.slice(0, 6)).toEqual(['ws-add', '--no-rc', '--child', String(run.id), '--base', 'c'.repeat(40)]);
    expect(w.leaseState()).toMatchObject({ state: 'promoted', promotedRun: run.id });
    expect(w.journalReasons()).toEqual(['carrier', 'adopt', 'transfer', 'promote']);
    // the carrier is marked in step 1 before the audit, and the audit is asked at the marked generation
    const marks = w.calls().filter((a) => a[0] === 'ws-lease-mark');
    const audit = w.calls().find((a) => a[0] === 'ws-lease-audit')!;
    const transferMark = marks.find((a) => a[a.indexOf('--state') + 1] === 'transferring')!;
    expect(w.calls().indexOf(transferMark)).toBeLessThan(w.calls().indexOf(audit));
    expect(audit[audit.indexOf('--generation') + 1]).toBe(transferMark[transferMark.indexOf('--generation') + 1]);
    expect(marks.some((a) => a[a.indexOf('--state') + 1] === 'promoted')).toBe(true);
    expect(w.mailTo(w.parentId).map((m) => m.subject)).toContain(`delegation: worktree moved to run ${run.id}`);
  });
  ```

  (`promotionWorld` is this file's builder over the dispatch suites' fixtures; it seeds a lease through PR5's doors, never by writing rows. Every world that expects a transfer, W5-P5b's included, passes all four capability words, `orphan-lease-v1` among them; a row that omits one is a refusal row naming the word it omits.) Remaining rows:
  - **W5-P6** no `ws-add-base-v1`: refused `base-unsupported`, no `ws-add` argv of any shape, and the lease back to `adopted` (`transfer-refused`).
  - **W5-P7** no `lease-audit-v1`: refused `lease-unavailable`, no `ws-add` argv.
  - **W5-P8** a dirty audit: refused `lease-tree-dirty` with the "commit or discard in the worktree first" detail; `transfer-refused`; the run is not dispatched.
  - **W5-P9** (O5-2 (b)) an `active` activity under a live parent: `lease-tree-busy`; an `unknown` activity with `holders: []`: dispatched; with `holders: 'unmeasured'`: refused.
  - **W5-P10** the verb refuses (`ws-add` exits non-zero): `transfer-refused`, the run's dispatch fails as any failed spawn does.
  - **W5-P11** a crash between step 1 and step 3 (the applier's fault seam after the transfer commit): no `ws-add` was composed; the lease reads `transferring`.
  - **W5-P12** the run consumes one dispatch slot; the lease consumes none (`ACTIVE_RUN_STATES` counts unchanged by an adopted lease).
  - **W5-P5b** the real verbs: `promotionWorld({ realBox: true, caps: ['lease-audit-v1', 'ws-add-base-v1', 'lease-mark-v1', 'orphan-lease-v1'] })` runs `ws-lease-mark` and `ws-lease-audit` through the ccd harness on a fixture HOME (`makeCcdHarness`, the lease fixture's tree) and only `ws-add` through the recording runner; the promotion completes with the carrier at `promoted` and the audit answering `ok: true`. With the step-1 mark deferred to the lane (the mutant W5-PM8), the real audit refuses `stale-generation` and the promotion is refused, so this row goes red.
  - **W5-P5c** a carrier two generations behind before the dispatch (a refused mark left it at g - 1): `transfer` refuses `carrier-behind`, the run's dispatch is refused with `lease-unavailable` and its detail, and nothing is journalled; after the lane's catch-up pass, the same dispatch succeeds.
  - **W5-P6b** the step-1 mark refused (the runner answers `{"ok":false,"refusal":"locked",…}`): `transfer-refused` is journalled, a mark at its generation with the prior state is composed, no `ws-lease-audit` and no `ws-add` argv is composed.
  - **W5-P6c** no `orphan-lease-v1` (the other three words present): refused `base-unsupported` before any transition; nothing journalled.
  - **W5-P6e** a run whose lease is already `promoted` with `promotedRun` this run, unbound by the resume arm (drive `CoordStore#clearSession` on it, the spent child's path, so the run is `planned` with `sessionId` null): a re-dispatch refuses `lease-already-promoted` before any transition, its detail naming abandon and a fresh run, composes no `ws-add` of any shape and journals nothing; a lease `promoted` to ANOTHER run answers `lease-not-promotable` the same way.
  - **W5-P6d** (PR9a, kept green on PR9b's build by its PR9a commit's fixture): on the reader build, a dispatch of a run carrying `promotedLeaseId` with `sessionId` null (seeded through `openRun`, not through `POST /api/runs`) refuses `base-unsupported` with every capability present, composes no `ws-add` argv of any shape and journals no lease entry; `POST /api/runs` with `promotesLease` answers `bad-request`. A second case: a planned run carrying `promotedLeaseId` and bound to a live session (the dead-dispatch pass's bind, its lease seeded `promoted` with `promotedRun` the run) resumes that session on the reader build, composes no `ws-add` and journals no lease entry.
  - **W5-P14h** step 3's re-check: the lease moved off `transferring` at g + 1 between steps 2 and 3 (the test drives `transitionLease` through the rig's fault seam after the audit answers): the dispatch refuses `lease-unavailable`, records no `promotion-ws-add-composed` event and composes no `ws-add`.
  - **W5-P5d** a promotion writes one feed row naming the tree, the run and the tip.
- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/promotion-dispatch.test.ts`. Expected: W5-P5 fails (a plain `ws-add` argv, no `--base`), and W5-P6 to W5-P12 fail with it. **Step 3: Implement** the arm in `decideDispatch` (an `ActPlan` member naming the lease) and `spawnFresh` (the four steps, each awaited in order, the transition doors' answers checked, every refusal journalled before the run's refusal is answered). **Step 4: Run GREEN** with every `server/test/dispatch*.test.ts` alone, `id-argv-census`, `verb-gate`. **Step 5: Commit** `feat(dispatch): a promoting run transfers its lease, measures it and starts at its tip`.

### Task 5.9.4: Crash recovery, the wire and the digest's promote line (PR9a; in PR9b: the promote line W5-P17, the carrier-step skip W5-P14g, W5-P14f, W5-P15's step-3/4 half, and mutants W5-PM14 and W5-PM16, each needing PR9b's dispatch arm)

- [ ] **Step 1: RED rows** in `server/test/delegation-promotion.test.ts` (`K` = `wsAddKillMs + DELEGATION_TRANSFER_KILL_MARGIN_MS`): **W5-P13** a `transferring` lease whose run has a bound child session is `record`ed with it; **W5-P14** with a successful listing showing no `.child` naming the run: a terminal or abandoned run, a refusal recorded after the composed event, or NO composed event at the transfer generation is `recover`ed; a composed event with the listing taken before `at + K` is `wait`, however old `transferringSince` is; the same listing taken at `at + K` is `recover`ed; any of these with the listing failed is `wait`; **W5-P14b** a `.child` row names the run while the run's `sessionId` is unset (the box finished a spawn the server did not bind), inside or past `at + K`: `wait`, never `recover` and never a bind; one row per attention cause against the declared input, each with every other cause absent: (a) `abandonArmed: false`; (b) two such rows; (c) the lone child's id in the run's `unboundSessions`; (d) the run's `dispatchStartedAt` null, and separately its state not `planned`; (e) `nowMs` at `dispatchStartedAt + dispatchAbandonMs + deadDispatchCadenceMs` with the lone child listed and the run unbound; each answers `attention: true`, and the same world with `nowMs` one millisecond before (e)'s instant and no other cause answers `attention: false`; **W5-P14c** (lane rig, a real `CoordStore`, the dead-dispatch pass ENABLED with its switch armed) the bind arm: after W5-P14b's state and past `dispatchAbandonMs`, the dead-dispatch pass binds the run to the row through `childBindGate` and `bindReturnedChild`, and the next delegation pass `record`s the lease `promoted` with that session; a dispatch of the run then resumes that session and composes no `ws-add`; with the child spent (the gate refuses `workspace-spent`) or a `session-unbound:` event journalled on the run, the run stays unbound and the lease stays `transferring` with one attention item; the abandon arm: a promoting run with no returned child past `dispatchAbandonMs` is abandoned `failed`, and the next pass with a successful listing `recover`s the lease. A census in the same file: no PR9 file (`delegation-promotion.ts`, `watch.ts`'s recovery, `dispatch.ts`'s promoting arm) calls `bindSession` or `bindReturnedChild`; **W5-P14d** (lane rig) a restart while the composed `ws-add` is still running (the composed event written, the recording runner holding the `ws-add` open, no `.child` yet): every ready pass inside the bound is `wait`, the lease stays `transferring`; the runner then finishes and the fixture writes the `.child`: the passes after are `wait` until the dead-dispatch pass binds it, then `record`, and the lease never read `adopted`; **W5-P14f** (PR9b; lane rig, the real route's `CoordMutex`, the pass budget at its real `DELEGATION_PASS_BUDGET_MS`) a live promoting dispatch held inside step 2 (the recording runner holding `ws-lease-audit` open for 5 s, well inside the 45 s pass budget, no composed event yet): a delegation pass fired then queues behind the mutex and journals nothing while the dispatch holds it, and once the dispatch finishes, inside the budget, the same pass reads `promoted` and acts on nothing; at no point does the lease read `adopted` while a child at its tip exists (a hold past the budget is W5-P14j's); **W5-P14g** (PR9b; lane rig) the carrier step skips a `transferring` lease: with the same live dispatch held in step 2, the pass's carrier step composes no `ws-lease-mark` for that lease (the dispatch's own step-1 mark is the only one), and once the lease leaves `transferring` the next pass's carrier step catches it up; **W5-P14i** (PR9a; lane rig with a spy on `serial`) a pass whose checkpoint holds no `transferring` lease never calls `serial`, and its native-removed, adopt and carrier steps run while a test holds the `CoordMutex` for longer than the pass budget; **W5-P14j** (PR9a; lane rig, the pass budget shortened through the rig's seam) a pass with a `transferring` lease that is recoverable (no composed event, no child) queues behind a `CoordMutex` a test holds past the budget: the pass is cut, and when its callback finally runs inside the released mutex it plans nothing and journals nothing (the lease still `transferring`); the next pass recovers it; and with no serialiser wired the step plans nothing and the health counts `transfers.unserialised: 1`; **W5-P14e** (ccd harness, fixture HOME) `ws-add --child <run> --base <tip>` killed with the agent's timeout signal (SIGTERM to the verb's process) at each of its late steps leaves no `$REG/<id>.child` written afterwards (the premise of the kill-bound arm; if it is red, the arm is removed, not the row); **W5-P15** in the lane rig, a restart after W5-P11's crash (no composed event, no child, the state seeded through the doors on PR9a) recovers the lease to `adopted` on the first ready pass; and (PR9b, driving the dispatch arm) after a crash between step 3 and step 4 (a `.child` and no binding), with the dead-dispatch pass armed, ends `promoted` with the run bound by that pass; **W5-P16** the projection's lease row carries `promotedRun`; **W5-P17** the digest's body carries the promote line `~/.local/bin/ccrc-api runs open --json '{"program":…,"promotesLease":"<leaseId>",…}'` with every field a `runs open` needs named.
- [ ] **Step 2: Run RED** `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/delegation-promotion.test.ts`. Expected: the module does not exist. **Step 3: Implement** `decidePromotionMeasure` and `planTransferRecovery`, the recovery call as the last step of `leaseActs` (taking the coordination serialiser handed over by `buildServer` only when the pre-hold checkpoint holds a `transferring` lease; inside the hold, `pass.signal.aborted` checked first and before each journal write, then the checkpoint, `CoordStore#runsByPromotedLease`, the listing and `dispatchAbandonViewOf` re-read; no bind; with no serialiser wired, nothing planned and `transfers.unserialised` counted), the `transfers` health member, and `promotedRun` in the projection (PR9a); the carrier step's skip of a `transferring` lease and `promote: true` with its line in the digest (PR9b). **Step 4: Run GREEN** with `delegation-adoption`, `delegation-projection`, `delegation-watch` alone, and `older-server-render` in `pwa`. **Step 5: Commit** `feat(delegation): recover a transfer a crash left, and name promotion in the digest`.

### PR9 mutation table

| Mutant | Edit | Goes red |
|---|---|---|
| W5-PM1 | move `leaseClaimant` after a store-reading gate | W5-P3 |
| W5-PM2 | use `bindingOf` (the worker's current binding) instead of `leaseCoordinatorOf` | W5-P4 (the closed-run row and the later-run row) |
| W5-PM3 | fall back to `wsAddWorker` without `ws-add-base-v1` | W5-P6 |
| W5-PM4 | dispatch on a dirty audit | W5-P8 |
| W5-PM5 | skip `transfer-refused` on a verb refusal | W5-P10 |
| W5-PM6 | recover a transfer on elapsed time with no listing (the old 15-minute rule) | W5-P14 (the failed-listing case), W5-P14b |
| W5-PM10 | recover when no `.child` is listed, ignoring the composed event's kill bound | W5-P14 (the inside-the-bound case), W5-P14d |
| W5-PM11 | recovery binds a returned child itself (`bindSession` from the lane, past the kill bound) | W5-P14b (a bind instead of `wait`), W5-P14c (the spent-child and `session-unbound` cases bind; the census names a PR9 file) |
| W5-PM14 | (PR9b) run recovery outside the coordination serialiser (the lane's own pass, no `serial`) | W5-P14f (the pass recovers the lease during step 2; step 4 is refused `stale-generation`) |
| W5-PM15 | drop step 3's re-check of the lease | W5-P14h |
| W5-PM16 | (PR9b) let the lane's carrier step mark a `transferring` lease | W5-P14g (the lane composes a `ws-lease-mark` for it) |
| W5-PM17 | (PR9a) drop the refusal of a fresh-spawn dispatch carrying `promotedLeaseId` | W5-P6d (a plain `ws-add --child` argv is composed) |
| W5-PM17b | (PR9a) refuse every dispatch carrying `promotedLeaseId`, the resume arm included | W5-P6d (the bound-session case refuses), W5-P14c (the resume after the bind refuses) |
| W5-PM18 | drop the `orphan-lease-v1` check from step 1 | W5-P6c (a `transfer` is journalled on a box without the rung) |
| W5-PM19 | (PR9b) journal `transfer` for a lease already `promoted` to this run, mapping its `wrong-disposition` to a generic refusal | W5-P6e (the code is not `lease-already-promoted`) |
| W5-PM20 | (PR9a) take `serial` on every pass, whatever the checkpoint holds | W5-P14i |
| W5-PM21 | (PR9a) drop the `pass.signal.aborted` checks inside the hold | W5-P14j (the cut pass journals `transfer-recovered` late) |
| W5-PM22 | (PR9a) answer `attention: false` on every `wait` of clause (2) | W5-P14b (each attention cause) |
| W5-PM12 | compose `ws-add` before recording the composed event | W5-P14d (a crash after the verb reads as never composed and recovers) |
| W5-PM13 | feed the claimant gate the bounded `delegationRunStamps()` | W5-P4 (the 501-run case) |
| W5-PM8 | defer the step-1 mark to the lane's next pass | W5-P5b |
| W5-PM9 | drop the `lease-conflicting` gate | W5-P4 |
| W5-PM7 | count the lease as an active slot | W5-P12 |

### PR9 at its tip

**Suites alone:** `delegation-promotion`, `promotion-dispatch`, `fleet-health` and `delegation-health` (the `transfers` member), `open-run-preconditions`, `coord-db`, every `dispatch*`, `run-states`, `mail-routes`, `routes`, `id-argv-census`, `verb-gate`, `delegation-adoption`, `delegation-projection`, `delegation-watch`, `delegation-wave3.integration`, `rings/*`, `single-definition` files, `citations`, `growth-check` (`GROWTH_CHECK=1`), `deviation-refs` in `server`; `older-server-render` and the typecheck in `pwa`. **Growth check:** waived by the new coord file; aim `store.ts` at most +30, `watch.ts` at most +20. **Rollout:** PR9a to the server box, measured and kept a release, before PR9b merges; then PR9b to the server box. `ccrc update`'s snapshot is the restore point for the migration; a server older than PR9a reads the higher `user_version` as is but ignores `promotedLeaseId` and recovers no transfer, so once PR9b has opened a promoting run, PR9a is the floor (the Gate). **Review focus:** (1) promotion is explicit only; (2) never a plain `ws-add` fallback, on PR9a's build too; (3) every refusal returns the lease to its prior disposition, and the carrier is marked after each transition; (4) recovery acts only on a measured outcome, inside the coordination serialiser the dispatch holds, reads the durable composed event (never process memory), waits out a composed `ws-add`'s kill bound, and binds nothing: a returned child is bound by the dead-dispatch pass through `childBindGate` (D-7563); (5) the claimant rule is `leaseCoordinatorOf`, R9's own; (6) the recovery step runs last in `leaseActs`, takes the serialiser only for a `transferring` lease, and a pass the budget cut journals nothing when its queued callback runs; (7) every attention cause of clause (2) is a fact in the planner's input; (8) PR9a refuses only the fresh-spawn arm of a promoting run, and PR9b refuses a lease already promoted to the run with its own code. **Must NOT:** promote automatically; delete or move the old tree; carry untracked files; add a run state; keep an in-process in-flight set as recovery's evidence; bind a run to a workspace outside `childBindGate`; run a recovery act outside the coordination serialiser.

## PR10: P1, the PWA's worktree controls

**Goal.** On the rows the visibility release draws, the operator can keep a worktree, attach an unowned or inferred worktree to a live session, or say a worktree is not delegated work, and can read each worktree's disposition and expiry. There is no promote control: promotion is a run open.

**Branch and base.** From `main` with the visibility release, PR7 and PR8 merged. Written against the visibility release's names (`activitiesStartedBy`, `DelegatedSummary`, `WorkLine`, `labelOf`, `unplacedActivities` returning entries), never PR2-of-wave-4's. **Deploy class.** PWA (server box).

**Files.**
- `pwa/src/fleet/delegationWords.ts`: the readers `dispositionOf(l)`, `expiryOf(l)`, `promotedRunOf(l)`, `hiddenLeaseOf(u)` and, under O5-8 (a)/(b) only, `treeKeyOf(u)` (one reader per wire field, absence permits) and the control words.
- `pwa/src/lib/api.ts` (growth-listed): `operatorRetainLease(id)`, `resolveLease(target, body)`.
- `pwa/src/fleet/WorkLine.tsx` and `pwa/src/fleet/ProjectCard.tsx`: the controls, receiving words and handlers as props, so `WorkLine.tsx` names no broker word in code (or it joins both `W4_PWA_FILES` copies on purpose).
- `pwa/src/fleet/fleet.css`: one rule for the control row, tokens only.
- Tests: `pwa/test/delegation-words.test.ts` (W4-U10 kept closed under O5-6 (a)), `pwa/test/project-card.test.tsx`, `pwa/test/leaseCardFixture.tsx` (new), `pwa/test/control-census.test.ts`, `pwa/test/contrast.test.ts` and `pwa/test/role-census.test.ts` (for the new rule, through `pwa/design/audit.mjs`), `pwa/test/older-server-render.test.tsx` (unchanged), `pwa/browser/delegation-rows.browser.test.ts` (390, 1280, 1920).

**Why here.** The rows exist only after the visibility release, and the doors only after PR8; disposition and expiry exist only after PR7.

**Interfaces.**
- **Consumes:** `DelegationLeaseWire.disposition?`, `.expiresAt?` (PR7), `.promotedRun?` (PR9); `DelegationUnownedWire.leaseId?` (PR8) and, under O5-8 (a)/(b), `.treeKey?` (PR8b); `POST /api/leases/:lease/operator-retain`, `POST /api/leases/:lease/resolve` (PR8); `LeaseDoorAnswer` and `LeaseDoorRefusal` from `shared/api.ts` (PR8 declares them there, in L0, so this PWA module imports no `server/src` file).
- **Produces:**

  ```ts
  // delegationWords.ts (O5-6 (a); no exported string contains lease, adopt, retain, clean, spool or running)
  export const KEEP_WORD = 'Keep worktree';
  export const ATTACH_WORD = 'Attach to…';
  export const NOT_DELEGATED_WORD = 'Not delegated';
  export const DISPOSITION_WORD: Readonly<Record<'ephemeral' | 'adopted' | 'retained' | 'transferring' | 'promoted', string | null>> =
    { ephemeral: null, adopted: 'worktree kept', retained: 'worktree kept', transferring: 'moving to a run', promoted: 'moved to a run' };
  export function keptUntilWord(expiresAt: string, now: number): string;   // 'kept until 17 Nov'
  export function dispositionOf(l: DelegationLeaseWire): keyof typeof DISPOSITION_WORD | null;   // absent -> null
  export function expiryOf(l: DelegationLeaseWire): string | null;
  export function hiddenLeaseOf(u: DelegationUnownedWire): string | null;   // the lease the projection hid for a conflict
  export function treeKeyOf(u: DelegationUnownedWire): string | null;       // O5-8 (a)/(b) only
  // api.ts
  export function operatorRetainLease(leaseId: string): Promise<LeaseDoorAnswer>;
  export function resolveLease(target: string, body: { action: 'attach'; parent: string } | { action: 'foreign' }): Promise<LeaseDoorAnswer>;
  ```

**The rules.** Keep shows on a lease row whose disposition is `ephemeral`, `adopted` or `retained`. Attach shows on an inferred (raw) lease row and on an unowned row that carries a hidden lease (`hiddenLeaseOf(u)`), each with the lease's own parent preselected and the only choice (re-parenting is never offered), posting to `/api/leases/<leaseId>/resolve`; under O5-8 (a)/(b) only, also on an unowned row with a `treeKey` and no hidden lease (a picker of the project's live sessions, posting to `/api/leases/tree-<key>/resolve`). Not delegated shows on every lease row but `transferring`, on every unowned row with a hidden lease, and under (a)/(b) on an unowned row with a `treeKey`; an unowned row with neither shows no control (O5-8 (c)). It asks for confirmation ("This worktree is not delegated work. It will no longer be shown here, and it is not held back from the disk sweep."), which is true because PR8 makes `foreign` final for the tree (correlation never re-links it, the projection shows no row for it: W5-R8c). A row from an older server (no `disposition`, no `treeKey`) shows no control and renders byte for byte as before. A refused answer shows its detail on the row; nothing is retried by itself. No control implies the work is live or done.

### Task 5.10.1: The words and readers

- [ ] **Step 1: RED rows** in `delegation-words.test.ts`: **W5-U1** every reader returns null for a wire without the field; **W5-U2** `keptUntilWord` formats a UTC date and never says "expires"; **W5-U3** W4-U10's census (no exported string matches `/lease|adopt|retain|clean|spool/i`) and the visibility release's `running` ban stay green with the new exports.
- [ ] **Step 2: Run RED** `cd pwa && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/delegation-words.test.ts`. Expected: W5-U1 and W5-U2 fail (the readers are not exported). **Step 3: Implement** the words and readers of Interfaces in `delegationWords.ts`, below the visibility release's exports. **Step 4: Run GREEN** Step 2's command and the `pwa` typecheck. **Step 5: Commit** `feat(pwa): words and readers for a worktree's keep, attach and disposition`.

### Task 5.10.2: The client calls and the controls

- [ ] **Step 1: RED rows** in `project-card.test.tsx`:

  ```tsx
  it('W5-U4: an adopted worktree row shows its kept-until date and a Keep worktree control that calls operator-retain', async () => {
    const calls: string[] = [];
    const { getByRole, getByText } = renderCard(worldWithLease({ disposition: 'adopted', expiresAt: '2026-11-17T12:00:00.000Z' }),
      { fetch: (url: string) => { calls.push(url); return okJson({ ok: true, disposition: 'retained', expiresAt: '2026-11-24T12:00:00.000Z' }); } });
    expect(getByText('kept until 17 Nov')).toBeTruthy();
    await userEvent.click(getByRole('button', { name: 'Keep worktree' }));
    expect(calls).toEqual([expect.stringMatching(/\/api\/leases\/[0-9a-f-]{36}\/operator-retain$/)]);
  });
  ```

  (`renderCard`, `worldWithLease` and `okJson` exist neither on `main`'s `pwa/test/project-card.test.tsx` nor in the visibility plan, so this task creates them, in a new `pwa/test/leaseCardFixture.tsx`: `renderCard(world, { fetch })` renders `ProjectCard` over `groupFleet` and `withRunBinding` as the file's existing renders do, with `fetch` stubbed; `worldWithLease(over)` builds a group whose `DelegationProjectionWire` holds one lease row with `over` applied; `okJson(body)` is a `Response` with status 200 and that JSON. If the visibility release has merged helpers of its own by dispatch, the worker uses those by their real names and drops the duplicates.) Remaining rows: **W5-U5** an inferred row's Attach offers only its own parent and posts `{action:'attach', parent}` to `/resolve`; **W5-U6** an unowned row with a hidden lease offers only that lease's parent and posts to `/api/leases/<leaseId>/resolve`; an unowned row with no hidden lease shows no control; under O5-8 (a)/(b) only, one with a `treeKey` posts to `/api/leases/tree-<key>/resolve`, and the picker lists only live sessions of the project; **W5-U7** Not delegated asks for confirmation and posts `{action:'foreign'}` only after it; **W5-U8** a `transferring` row shows "moving to a run" and no control; **W5-U9** a refusal's detail shows on the row; **W5-U10** an older-server world renders byte for byte (`older-server-render.test.tsx`, unchanged); **W5-U11** `control-census.test.ts` lists the three controls with their roles and names.
- [ ] **Step 2: Run RED** `cd pwa && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run test/project-card.test.tsx`. Expected: W5-U4 to W5-U9 fail (no control is drawn). **Step 3: Implement** the two client calls in `pwa/src/lib/api.ts` (at most 20 net code lines), the controls in `WorkLine.tsx`/`ProjectCard.tsx`, and the CSS rule. **Step 4: Run GREEN** Step 2's command, `delegation-words`, `control-census`, `contrast`, `role-census`, `older-server-render`, `fleet-screen` alone, the typecheck, and `cd pwa && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/delegation-rows.browser.test.ts` (the visibility plan's browser command; use its exact spelling). **Step 5: Commit** `feat(pwa): keep, attach and not-delegated controls on worktree rows`.

### PR10 mutation table

| Mutant | Edit | Goes red |
|---|---|---|
| W5-UM1 | default `dispositionOf` to `'ephemeral'` when absent | W5-U1, W5-U10 |
| W5-UM2 | label the control "Retain" | W5-U3 |
| W5-UM3 | post foreign without the confirmation | W5-U7 |
| W5-UM4 | show Keep on a transferring row | W5-U8 |
| W5-UM5 | list every session in the attach picker | W5-U6 |
| W5-UM6 | show Attach on an unowned row with no hidden lease under O5-8 (c) | W5-U6 |

### PR10 at its tip

**Suites alone** (in `pwa`): `delegation-words`, `project-card`, `fleet-screen`, `control-census`, `contrast`, `role-census`, `older-server-render`, `w7-storage-keys`, the browser `delegation-rows` suite, the typecheck; in `server`, `delegation-wave3.integration` and `fleet-health` (the `W4_PWA_FILES` mirror, if `WorkLine.tsx` joined it). **Growth check:** `pwa/src/lib/api.ts` at most +20. **Rollout:** server box (the PWA ships with it). **Review focus:** (1) one reader per wire field, absence permits; (2) the words keep W4-U10 and never say `running`; (3) an older server renders as before; (4) a destructive-sounding act asks first; (5) no new storage owner. **Must NOT:** add a promote control; add a `localStorage` key; touch the visibility release's comments in `shared/api.ts`.

## Rider (deferred past wave 5)

Listed, not planned.
- The durable `unknown` writer for stale active activities, and any reopen or repair act (the 2026-11-02 scope decision keeps automatic repair outstanding).
- An `unmeasured` tree's resolve door (D-7023 keeps unmeasured trees out of the unowned rows).
- Under O5-8 (c): attach and disown of an unowned tree that holds no lease (`attachTree`, `disownTree`, `tree-resolved`), with the `delegation_activities` migration or tree-keyed reader it needs and its own reader-first release.
- O5-2 (c), an operator act saying an activity ended, if the operator prefers it later.
- Re-parenting a linked lease to another session.
- A per-lease Claude Code version gate for adoption (wave 5 gates the corpus in CI and Task 0, `D-7832`).
- Widening the delegation census to every project holding an unreleased lease, so native-removed and adoption reach a project with no live session (`D-7852`).
- Wave-4 rider items not taken here: D8, B1, D2's gaps 1, 3 and 4, Q-W4, retiring sessions and attempts (D-7024), the store read of runs by `sessionId`.
- Never planned (D-7002, and rejected outright): `ws-lease-clean`, audit tokens spent by a deleter, `lease-clean-v1`, `lease-clean-live`, a cleanup queue or executor, stage-6 `reclaim-paused` lease semantics, a `backlog` or `lineage` frame member, a `FLEET_PROTO` bump, a writer of `$REG/delegation-adopt`, auto-adoption of a raw lease.

## Deviations found

The allocator issued D-7794..D-7848 to this plan (2026-11-03). D-7794..D-7839 are the planning-time departures below, in order; D-7840..D-7847 are the operator's rulings on O5-1..O5-8, ruled on 2026-11-04; D-7848 is the coordinator's dispatch-order ruling of 2026-11-04. D-7850..D-7856, issued the same day, are the departures review round 4 found after that block. D-7940, issued on 2026-11-04, records the operator's split of promotion into wave 5b. Each PR's implementation departures get a block of their own, minted at that PR's run-open and named in its brief. Never invent a number.

- **D-7794** — `stage4-thresholds` (plan approval; spec §5.6, §5.11): 5 minutes after terminal evidence, two stable passes, a 7-day expiry reset by every Retain, a 24-hour reminder, and a 1-hour orphan-hold margin, as constants beside their deciders, fed `now`. The 2026-11-02 decision approved no time default; approving this plan approves these.
- **D-7795** — `native-removed-in-wave5` (coordinator; wave-4 rider, spec §5.5, §5.10, D18): `native-removed` release moves from the wave-4 rider into wave 5 (PR5), because without it no lease ever closes and a reused raw path stays `conflicting`. The spec's "no `lease-clean:<phase>` breadcrumb" clause has no writer after D-7002 and is not implemented.
- **D-7796** — `native-removed-no-branch-pin` (spec §5.5): the release records the last head the census saw and pins no branch; nothing in this programme deletes the lease's branch.
- **D-7797** — `transferred-is-native-removed-of-promoted` (spec §5.10): `transferred` is the release reason of a `promoted` lease whose tree is gone; one detector serves both reasons.
- **D-7798** — `lease-library` (spec §8.5): the lease verbs live in `ccd/lib/delegation-lease.sh`, a pinned library on the train-proof library's recipe, not in `ccd/ccd`; spec §8.5's "`ccd/ccd` re-stamped" is stale (the installer stamps).
- **D-7799** — `carrier-tree-index` (spec §5.10): `ws-lease-mark` keeps `$REG/delegation/leases/by-tree/<key>` naming one lease per tree, so the orphan rung's failure scope is one tree.
- **D-7800** — `admin-record-hex` (spec §5.10): `--admin-record` is spelled `--admin-record-hex`, because a hook-listed name may begin with `-` (the `--tree-hex` precedent).
- **D-7801** — `mark-checkout-containment` (spec §5.10): a containing registry workdir, or a containing linked worktree, does not refuse `nested` when the tree is a direct `.claude/worktrees/<name>` or `.superpowers/worktrees/<name>` child of that checkout (the main checkout or any linked checkout of the same repository, a ccd workspace included), which is the orphan ladder's location rule (`ccd/lib/disk-retention.sh#_ws_orphan_class` over the stanza checkouts); every other containment refuses. A literal §5.10 would refuse every Agent and Workflow tree, and a main-only carve-out would refuse every tree an Agent leaves inside a ccd workspace, which the census leases and the orphan lane can remove. The symlink rule is measured below whichever root holds the tree (the projects root or the ccd worktrees root).
- **D-7802** — `mark-monotonic-generation` (spec §5.10): `ws-lease-mark` writes any generation above the stored one, not only stored + 1, so a carrier that missed generations (a refused or lost mark, two transitions in one pass, a promotion's refusal after a refused mark) catches up in one write; `unchanged` (the same body at the stored generation) and `generation-conflict` (another body at it) are kept, and a lower generation still refuses `stale-generation`. The server marks only at the journal's current generation, so the journal stays the one source of generations.
- **D-7803** — `index-before-carrier` (spec §5.10): the by-tree entry is written before the carrier and repaired on every mark, so a verb that dies between the two renames leaves a fail-shut index entry with no carrier, never a carrier the orphan rung cannot find.
- **D-7804** — `orphan-rung-state-first` (spec §5.10, D-7002): the orphan rung reads a carrier's state before its path, and only a holding state (`adopted`, `retained`, `transferring`) compares `canonicalPath` and can hold; the verb's `tree-held` likewise fires only for another lease whose carrier holds, and otherwise re-points the entry. Git reuses an admin record name once the old one is pruned, and nothing else deletes a by-tree entry, so a path-first rung would fail the orphan lane shut for good on an unleased tree that reuses a once-leased record.
- **D-7805** — `index-entry-heal` (spec §5.10): a `released` mark of a lease with no stored carrier, whose by-tree entry names it (the index-before-carrier half-write, then a release before any re-drive), removes that entry and answers `index-cleared`; the carrier planner composes it only for such a lease. Without it the entry names a lease with no carrier for ever and the rung reads that tree `unmeasured` on every pass.
- **D-7806** — `carrier-behind-refusal` (spec §5.12): a transition that starts a new step from a settled state (`adopt`, `retain`, `operator-retain`, `attach`, `transfer`) refuses `carrier-behind` while the box's carrier has not been read back at the lease's generation, on a box that reports `lease-mark-v1`; a door answers 409. The caller states that capability as `carrierRequired` on `DelegationLeaseTransitionRequest` (the durability layer knows no capability), the door passes it into `decideLeaseTransition`, and the replay fold passes `false`.
- **D-7807** — `carrier-standing-refusal` (spec §5.10): the carrier planner marks no released lease whose carrier was never written (the verb would refuse it `no-tree` every pass), and treats every `ws-lease-mark` refusal but `busy` and `unmeasured` as standing for that lease, generation and census row: counted as `refused`, not composed again until one of them changes, and never charged to the per-pass budget, so released-without-carrier and locked trees (27 of 27 orphaned agent trees) cannot hold every live lease out of a carrier.
- **D-7808** — `promotion-reader-first` (spec §5.7, rollout): PR9 ships as a reader-and-recovery PR9a (the `runs.promotedLeaseId` column and its readers, transfer recovery, and a `base-unsupported` refusal of a fresh-spawn dispatch of a run carrying the field; the resume of a bound session proceeds, `D-7853`), rolled out and kept a release, before PR9b opens `promotesLease` at `POST /api/runs` and the dispatch arm. A server below PR9a ignores the field, so it would dispatch a planned promoting run as a plain `ws-add --child` at origin's base and would leave a crashed transfer `transferring` for good; PR9a is the rollback floor once any run carries the field or any lease has been transferred.
- **D-7809** — `journal-kinds-reader-first` (spec §5.12, rollout): PR5 ships as a reader-only PR5a, rolled out and kept for a release, before PR5b's writers, because the journal's closed grammar makes any pre-PR5a server a durable `reconstructing` wedge once a new kind is journalled. PR5a also carries every entry field and checkpoint member a later wave-5 writer fills under O5-8 (c) (`resolvesThrough`, `resolvedThrough`), so no later PR adds grammar. The rule for the wave: the rollback floor is the newest reader build, PR5a, or a reader-only PR8a shipped a release ahead of PR8b under O5-8 (a)/(b).
- **D-7810** — `orphan-lease-capability` (D-7002): the box rung prints `orphan-lease-v1`, and every server act that moves a lease off `ephemeral` requires it (adoption, Retain, operator-retain, resolve attach through `decideResolve`'s `boxHolds`, and the transfer), so a fleet box below PR4 stops new holds visibly instead of leaving them to the server skip alone. The server skip's `not-ready` is scoped to the `claude`/`superpowers` classes, so the orphan lane's unleased `ccd-root` trees never wait on the delegation applier.
- **D-7811** — `orphan-hold-every-class-when-ready` (D-7002): a READY checkpoint is consulted for every class the orphan lane composes, `ccd-root` included, because a raw lease can sit at a `ccd-root` path (a Bash `git worktree add ../x` from a ccd workspace); only the `not-ready` answer is scoped by class. Otherwise a kept or attached `ccd-root` tree is free to the server skip while its carrier still reads `ephemeral`.
- **D-7812** — `digest-owed-from-durable-state` (spec §5.6): the notices are derived each pass from the checkpoint's adopted leases and deduped on a lease-and-generation subject inside `queueRunlessNotice`'s transaction, so a crash between the transition and the mail, a restart or a standing `mail-disabled` never loses one and never sends one twice.
- **D-7813** — `digest-per-lease-notice` (spec §5.6): "one digest mail per parent per pass" becomes one notice per adopted lease and generation, all queued in the pass that finds them owed, because a subject that names a pass or a set of leases cannot be deduped durably per lease. A changed parent incarnation with no coordinator is mailed nothing (its Retain line would be refused); the operator's Keep control is the path.
- **D-7814** — `promotion-marks-synchronously` (spec §5.7): the promoting dispatch marks the carrier itself after each of its transitions (through PR6's `markLeaseCarrier`) and audits at the marked generation; the lane's carrier pass remains the catch-up for every other case.
- **D-7815** — `transfer-recovery-measured` (spec §5.5, §5.7): a `transferring` lease returns to its prior disposition only on a measured outcome, read inside the coordination serialiser the promoting dispatch holds across its four steps (`coordMutex`), so a recovery never interleaves with a live dispatch: a successful registry listing showing no `.child` naming the run, with the run terminal or abandoned, its dispatch refusal recorded, no durable `promotion-ws-add-composed` run event (no `ws-add` was composed), or the listing taken after that event plus the verb's exec kill bound (`CCD_VERB_TIMEOUT_MS['ws-add']` and a margin), because the agent keeps an exec running across a lost link and `cmd_ws_add` writes `.child` late. Step 3 re-checks the lease before it records the event, and the lane's carrier step skips a `transferring` lease, which the dispatch marks itself. No in-process in-flight set is evidence, and no silence infers that a dispatch did not happen.
- **D-7816** — `returned-child-bound-by-dead-dispatch-pass` (spec §5.7; D-7563, D-7319): recovery binds no workspace. A lone `.child` naming a transferring run that names no session is bound by the dead-dispatch pass (`server/src/coord/abandonDeadDispatch.ts`, through `childBindGate` then `bindReturnedChild`, under the operator's dispatch-abandon switch and its `dispatchAbandonMs` bound), and the lease is then recorded `promoted`; that pass's abandon arm closes a promoting run whose dispatch never came back, and the lease is then recovered. Until one of them acts, the lease waits, with an attention item when the switch is off, the child is refused by the gate, or two children name the run (each cause read from a fact the planner's input carries, `D-7856`). A second binder in the delegation lane would skip `childBindGate` and the `session-unbound` refusal and could bind a spent child back onto the run. (It replaces an earlier draft rule, written before D-7563's pass was measured.)
- **D-7817** — `one-claimant-rule` (spec §5.7, §6, O5-4): the digest recipient, Retain and promotion all decide "the worker's coordinator" with `leaseCoordinatorOf(lease, runs)` = `claimantAt(runs, parentId, firstObservedAt)`, R9's own nesting rule, never the worker's current binding.
- **D-7818** — `claimant-read-unbounded` (O5-4): `leaseCoordinatorOf`'s runs come from `CoordStore#delegationRunStampsNaming(parentId)`, every run that ever named the parent, not from `delegationRunStamps()`, whose newest-500-closed window a lease kept for weeks outlives (the rule would silently answer null: the coordinator refused `not-lease-parent`, the notices sent to the worker).
- **D-7819** — `conflicting-halts-acts` (spec §5.4, D-7003): a lease whose tree's newest attempt is `conflicting` and not covered by a resolution is not adopted, mailed, retained or promoted (`lease-conflicting`); only resolve acts on it. One derivation (`conflictingTreeKeys`) serves the projection and every wave-5 decider; correlation keeps its own `finalConflicts` (`D-7821`).
- **D-7820** — `resolve-ends-conflict` (spec §5.4, §5.14): resolve writes a resolution mark (`resolvesThrough`, the tree's newest unowned-work attempt) in its own `lease-transition` or `lease-released` entry, and `conflictingTreeKeys` drops a key whose newest attempt the mark covers, so a resolved tree can be kept, renewed and promoted again. The resolution is final for the tree: correlation records no attempt after a conflict (`finalConflicts`), so nothing newer can reopen it. A conflicting lease of any source may be attached (kept, never re-parented), and a `tree-<key>` holding an unreleased lease, the lease the projection hid included, is resolved as that lease, never by minting a second one.
- **D-7821** — `correlation-conflict-stays-final` (spec §5.4; consolidation, legitimately different): correlation keeps `server/src/coord/delegation-policy.ts#groundOf`'s `finalConflicts`, every tree with ANY `conflicting` attempt ever recorded, for which it records no further attempt and requests no lease, while the acts read `conflictingTreeKeys`, the newest uncovered conflict. The two answer different questions in opposite safety directions: correlation's guard keeps a once-conflicted tree out of every new lease and attempt (fail-safe), and the act gate is what the operator's resolve opens. A consequence, stated rather than built around: a disagreement after a resolution is not recorded and does not reopen the tree. Replacing `finalConflicts` would be a correlation behaviour change of its own, with a characterisation row first; wave 5 does not make it (W5-R8g pins today's rule).
- **D-7822** — `foreign-is-final-for-the-tree` (spec §5.14): a lease released `foreign` keeps its tree (project, admin record, creation base) out of correlation: no new lease is requested and no attempt recorded, and the projection shows no row for it. Without it `planLinked` re-requests the lease on the next pass, adoption keeps it again and the parent is mailed again.
- **D-7823** — `carrier-fields` (spec §5.10): the carrier adds `expiresAt`, `releaseReason` and `markedAt`, and omits `branchCreatedByLease`, whose only consumer (the cleaner) was dropped.
- **D-7824** — `same-generation-unchanged` (spec §5.10): a request at the stored generation with an identical body answers `unchanged`, rc 0, so a lost answer can be re-driven; a different body at that generation refuses.
- **D-7825** — `released-mark-without-tree` (spec §5.10): a `released` mark whose admin record is gone skips the tree checks and keeps the stored fingerprint.
- **D-7826** — `audit-token-evidence-only` (spec §5.11, D-7002): the audit's token is recorded as evidence in the promotion's journal entry and is spent by no verb.
- **D-7827** — `startpoint-journal-only` (spec §5.7): `ws-add --base` records its start point only as `meas.startpoint`; `$REG/<id>.base` stays the origin ref every reader expects.
- **D-7828** — `orphan-skip-box-and-server` (D-7002): the skip is a fail-shut box rung plus a server skip from the checkpoint, with no marker; disabling it is the wrong safety direction.
- **D-7829** — `expiry-is-cleanup-due-at` (spec §5.2, §5.11): the expiry is stored in the existing `cleanupDueAt` column (no schema change on `delegation_*`); `cleanupState` stays `not-due`.
- **D-7830** — `carrier-mint-transition` (spec §5.10): a linked lease's first carrier is journalled as a `carrier` transition, `ephemeral` to `ephemeral`, generation 0 to 1, so the carrier's "1 when new" has a journal entry behind it.
- **D-7831** — `adoption-keeps-opening-lineage` (spec §5.6, §5.8): adoption opens no second lineage edge; the lease's own opening edge is open and already nests the row. Promotion closes it (`transfer`) and opens a run-owned edge.
- **D-7832** — `corpus-gate-is-ci` (spec §7 stage 4): "adoption only for fixture-proven correlation classes" is the corpus row W5-D12 plus the coordinator's Task 0, not a per-lease version check.
- **D-7833** — `raw-attach-keeps-source` (D-6999, spec §5.14): attaching a linked raw lease, or a conflicting lease of any source, moves it to `retained`, keeps its source and keeps its parent; re-parenting is not offered.
- **D-7834** — `attached-lease-synthetic-activity` (spec §5.14, O5-8 (a) only, not recommended): a no-lease unowned tree attached by the operator becomes a lease with source `attached` whose activity is a synthetic row minted in the same commit (source `attached`, natural key `attached:<treeKey>`, an immutable mapping), beside the parent's session row when it had none. It is buildable only with a `delegation_activities` CHECK migration (the table admits `agent`, `workflow` and `bash-worktree` only, and the two in-memory guards never run that constraint), `attached` added to `DELEGATION_ACTIVITY_SOURCE_KINDS` and `leaseSourceKindOfActivity`, and a new journal kind for the synthetic activity, all in a reader-only PR8a; W5-R12f proves the commit through the real SQLite projection.
- **D-7835** — `foreign-is-release-reason` (spec §5.14): "foreign" is a release reason, not a state, for a LEASE.
- **D-7836** — `unowned-foreign-is-tree-resolved` (spec §5.14, O5-8 (a) or (b) only): a no-lease unowned tree marked foreign gets a tree-keyed `tree-resolved` journal entry and no lease, since a lease with no parent cannot satisfy `delegation_leases`' `NOT NULL` parent or the session reference; `tree-resolved` is a new kind, so it ships first in PR8a.
- **D-7837** — `resolve-addresses-unowned-by-tree-key` (spec §6): `:lease` on `/resolve` is a lease id or `tree-<key>`, where `<key>` is `delegationTreeTarget(project, adminRecord)`, the SHA-256 hex of `delegationTreeKey` (one L1 function in `delegation-conflicts.ts`; the box's `_dl_tree_key`, which hashes the common-dir identity, is a different key the server cannot compute and is never the URL form); a `tree-<key>` holding an unreleased lease resolves as that lease. The unowned wire row carries `leaseId` when the projection hid a lease on its tree, and `treeKey` under O5-8 (a)/(b) only.
- **D-7838** — `lease-routes-named-param` (spec §6): the routes use `:lease`, not `:id`, because every `:id` in `routes.ts` is an integer (`routes.test.ts`).
- **D-7839** — `runless-notice-shared` (consolidation): the digest reuses the stall watch's run-less arm, extracted as `queueRunlessNotice`, rather than a second deduping writer.
- **D-7840** — `o5-1-orphan-skip-scope` (operator ruling on O5-1, 2026-11-04: (a)): the orphan-tree lane skips a tree whose lease is `adopted`, `retained` or `transferring` until the lease's `expiresAt`, which every Retain resets. After that the orphan ladder's own rungs decide: a dirty tree, a tree not quiet for its idle floor and, unless the rescue switch is armed, a head on no remote are still refused. A lease released `foreign` ends the hold, because it means "not delegation's". Governs Tasks 5.4.2, 5.4.3, 5.7.4, 5.8.1 and 5.10.1.
- **D-7841** — `o5-2-promotion-without-terminal-event` (operator ruling on O5-2, 2026-11-04: (b)): promotion refuses an `active` activity under a live parent. It allows `unknown`, or `active` under a parent proved dead by spec §5.11's terminal evidence, only when the audit measures no process holding or sitting in the tree (`holders` empty); an unmeasured answer refuses. Nothing writes "ended", and no end is inferred from silence or a live parent. Governs Task 5.2.1's `holders` field and its runner budget row, and Task 5.9.3's measure step.
- **D-7842** — `o5-3-locked-trees` (operator ruling on O5-3, 2026-11-04: (a)): spec §5.10's refusal stands. A git-locked tree gets no carrier and is never adopted or promoted; it is shown, the orphan ladder already refuses it, and it becomes eligible the pass after its lock is gone. Governs Task 5.1.3's row W5-L8 and Task 5.7.2's eligibility rule 6.
- **D-7843** — `o5-4-worker-parent-recipient` (operator ruling on O5-4, 2026-11-04: (a)): for a programme worker's lease, the digest with its Retain and promote lines goes to the coordinator that `server/src/coord/delegation-lease-acts.ts#leaseCoordinatorOf(lease, runs)` names, fed `CoordStore#delegationRunStampsNaming(parentId)` (`D-7818`), and the worker gets none. Retain is allowed for the parent or that coordinator, the same claimant rule as promotion; this amends spec §6 row 3. Governs Tasks 5.7.3, 5.8.1 and 5.9.2.
- **D-7844** — `o5-5-run-field-storage` (operator ruling on O5-5, 2026-11-04: (a)): one additive nullable column, `runs.promotedLeaseId`, at the next free `server/src/coord/schema.ts#MIGRATIONS` slot (re-measured when PR9a is cut), with `executionOrigin` derived from it. This is the one durable migration wave 5 adds; approving the plan approves it. Governs Tasks 5.9.1 and 5.9.4.
- **D-7845** — `o5-6-control-words` (operator ruling on O5-6, 2026-11-04: (a)): the W4-U10 census stays closed. The PWA controls read "Keep worktree" (operator Retain), "Attach to…" (attach), "Not delegated" (foreign), "kept until <date>" (expiry), "worktree kept" (the adopted disposition) and "moved to a run" (promoted). Governs Task 5.10.1.
- **D-7846** — `o5-7-adoption-gate` (operator ruling on O5-7, 2026-11-04: (a)): while `$REG/delegation-adopt` is absent, the lane computes adoption decisions and records "would adopt" observations, in health counts and one lane log line per lease, with no carrier change, no mail and no feed row. The operator reads them and touches the marker by hand; that touch is the gate, and it is never presented as a soak. Governs Task 5.7.3's marker-absent arm and "## Gate".
- **D-7847** — `o5-8-unowned-tree-doors` (operator ruling on O5-8, 2026-11-04: (c)): attaching or disowning an unowned tree that holds no lease is deferred past wave 5 ("## Rider"). Wave 5 acts on leases only: a lease is kept, attached (raw) or released `foreign`; an unowned row whose tree holds a lease the projection hid for a conflict carries that lease's id (`DelegationUnownedWire.leaseId?`, PR8) and offers that lease's resolve; an unowned row with no lease shows no control. No migration on `delegation_*`, no new journal kind, entry or source word, and no PR8a: PR8 writes only grammar PR5a folds, so the rollback floor stays PR5a. Not built: the tree arms of Task 5.8.1 (`attach-tree`, `disown-tree`), Task 5.8.2's `attachTree` and `disownTree` with W5-R7's tree cases, W5-R8's unowned case, W5-R12, W5-R12e, W5-R12f and mutant W5-RM6, PR8a, and PR10's controls for a no-lease unowned row.
- **D-7848** — `pr3-and-pr5a-wait-for-pr1` (coordinator ruling, 2026-11-04; "Landing order and rollout" items 2 and 5): PR3 and PR5a are dispatched only after PR1 merges. PR5a is not independent of PR1: Task 5.5.1's transition table imports `DELEGATION_CARRIER_STATES` from `shared/api.ts`, which PR1's Task 5.1.1 defines and `main` does not hold. PR3 shares most of PR1's files (`ccd/ccd`, `server/src/ccdargv.ts`, `server/test/ccdCapTokens.ts`, `server/test/verb-gate.test.ts`, `server/test/whitelist-subset.test.ts`, `server/test/delegation-wave3.integration.test.ts`), and two runs are never dispatched onto overlapping claims. Wave 5's first dispatch is therefore PR1 alone, beside the visibility release. When PR1 merges, PR2, PR3 and PR5a may go out together, with PR2's and PR3's own overlap ruled at that dispatch. If this is wrong, the cost is one PR's head start.
- **D-7850** — `orphan-hold-exact-path` (PR4; D-7811): `collectOrphanTree` gains the census row's class as a parameter (`orphanTreeSweep.ts` passes `this.memory.get(hex)?.cls`), because on `main` it receives only the tree's hex, and the path it hands `leaseHold` is the exact `Buffer.from(hex, 'hex').toString('utf8')`, compared byte for byte with `canonicalPath`. `orphanPathOfHex` is a display helper (control characters collapsed, trimmed, cut at 300 characters); used for the compare it would answer `free` for a held tree with a long or unusual path while its carrier still reads `ephemeral`, so neither the server skip nor the box rung would hold it (W5-O13's long-path case, W5-OM13).
- **D-7851** — `carrier-seen-keeps-sequence` (PR5, PR6; spec §5.10, §5.12): `lease-carrier-seen` changes neither the lease's generation nor its `currentJournalSequence`, so the sequence always names the transition that wrote the current generation and a carrier's `journalSeq` equals it. If `seen` moved the sequence, PR6's rule 4 would never match after it, rule 5 would count the lease `mismatched` for good, and a same-generation re-drive would be refused `generation-conflict` (W5-J13, W5-K4, W5-KM12).
- **D-7852** — `native-removed-censused-projects-only` (PR5, PR7; spec §5.5, hand-off 12): native-removed release, and adoption's "tree present" rule, act only on a lease whose project the pass censused as a measured success (`laneFlatCensus`'s `censused`), keyed by `delegationTreeKey(project, adminRecord)`. The lane's census covers only the projects the registry names (`watch.ts#divergencesPass`), and a listed project can answer unmeasured, so a global "listing ok" and bare record names would release every lease of a project whose last session was reaped, or whose census failed twice, while its tree still stands, and would collide record names across projects. A lease of an uncensused project keeps its count and its watch entry and is counted `uncensused`; it is neither released nor adopted until its project is censused again. Widening the census to every project holding an unreleased lease is not taken in wave 5 (a per-pass cost, one `readWorktreeCensus` per such project); the limit is stated and counted (W5-J16c, W5-J16d, W5-D14b; W5-JM13, W5-JM14, W5-DM16).
- **D-7853** — `pr9a-refuses-fresh-spawn-only` (PR9a; D-7808): PR9a's `base-unsupported` refusal applies only to the fresh-spawn arm (a run carrying `promotedLeaseId` with `sessionId` null); the resume of a bound session proceeds, because it composes no `ws-add`. Refusing every dispatch of such a run would turn W5-P14c's resume red on PR9a's own build and wedge a bound promoting run whose lease is already `promoted` on a server rolled back to PR9a (W5-P6d's second case, W5-PM17b). The rows that need PR9b's dispatch arm (W5-P14f, W5-P14g, W5-P15's step-3/4 half; W5-PM14, W5-PM16) land with PR9b.
- **D-7854** — `lease-already-promoted-refusal` (PR9b; spec §5.7): a dispatch of a run whose lease is already `promoted` with `promotedRun` that run refuses `lease-already-promoted` before any transition, its detail naming abandon and a fresh run; a lease released or promoted to another run refuses `lease-not-promotable`. The state is reachable on `main`'s paths (the dead-dispatch pass binds the returned child, recovery records it, the resume arm finds the child spent and `CoordStore#clearSession` unbinds the run), and a `transfer` from `promoted` would otherwise be refused `wrong-disposition` on every re-dispatch with nothing telling the coordinator why. No plain-child re-spawn is offered (W5-P6e, W5-PM19).
- **D-7855** — `recovery-serial-last-and-conditional` (PR9a; D-7815): the recovery step runs last in `leaseActs` (after native-removed, adopt and carriers) and takes the coordination serialiser only when the pass's pre-hold checkpoint holds a `transferring` lease; inside the hold it checks `pass.signal.aborted` before planning and before each journal write; with no serialiser wired it plans nothing and counts the leases `unserialised`. The `CoordMutex` is held by every dispatch across its `ws-add` (up to the runner's 300 s ceiling) and by close, reclaim, settle and the dead-dispatch and stop-done lanes, while `DELEGATION_PASS_BUDGET_MS` (45 s) cuts a pass and releases its latch as its queued work keeps unwinding: an unconditional hold ahead of the other steps would starve adoption and carrier marks fleet-wide, and a cut pass's late callback would journal under a stale plan (W5-P14i, W5-P14j; W5-PM20, W5-PM21).
- **D-7856** — `transfer-attention-measured-causes` (PR9a; D-7816): `planTransferRecovery`'s input carries every fact clause (2)'s attention item reads: `abandonArmed` (`dispatchAbandonViewOf`, the dead-dispatch pass's own reading), `dispatchAbandonMs`, the dead-dispatch lane's cadence, `nowMs`, and per run `dispatchStartedAt` and `unboundSessions` (`runSpend.ts#unboundSessionOf`). "Refused by the gate" becomes a condition the planner can measure without calling `childBindGate`: the lone child has been listed while the run stays unbound past `dispatchStartedAt + dispatchAbandonMs` plus one cadence of that pass. A run the dead-dispatch pass's population cannot reach (not `planned`, or no `dispatchStartedAt`) raises one too (W5-P14b's per-cause rows, W5-PM22).
- **D-7940** — `promotion-is-wave-5b` (operator ruling, 2026-11-04): promotion, PR9 (PR9a and PR9b), is split out of wave 5 into its own wave, 5b. The operator chose it from the coordinator's question, whose reasoning was that promotion is the largest PR and the only one that dispatches work by itself, so marking, audit, adoption, Retain and resolve, and the console controls land and are used first, and each wave's review load stays reasonable. Wave 5 is PR1 to PR8 and PR10. PR9's text, its order after PR7 and PR8, its own reader-first split (`D-7808`) and the PR9a rollback floor are unchanged. The coordinator asks the operator before wave 5b is dispatched. PR3 (`ws-add --base`, whose only caller is PR9's dispatch arm) stays in wave 5 and ships dark behind `ws-add-base-v1`.
- **D-7980** — `startpoint-is-a-declared-meas-key` (PR3, Task 5.3.1 rule 5; the coordinator's consent of 2026-11-04): PR3's file list gains `shared/api.ts` (two lines: the `startpoint` member of `LifecycleMeas` and its `LIFECYCLE_MEAS_KEY_MAP` entry), `server/src/coord/journalparse.ts`, `server/test/journalparse.test.ts` and `server/test/lifecycle-wire.test.ts` (whose two `LifecycleMeas` literals and key list the new member reaches), because `ccd-lifecycle-contain.test.ts` checks every `meas.<key>` ccd emits against `LIFECYCLE_MEAS_KEYS`, derived from `LifecycleMeas`, and `reviveMeas` returns that interface as a literal; without them `meas.startpoint` would be dropped at ingest with nothing saying so. The member is `string | null`, read by `reviveMeas` alone, and a line from a ccd that does not write it reads null (the `childRun` precedent, D-7278); no `FLEET_PROTO` change.
- **D-7981** — `base-object-type-not-peel` (PR3, Task 5.3.1 rule 3; the coordinator's ruling of 2026-11-04): the object check asks `git cat-file -t <id>` equal to `commit`, under `_ws_reclaim_contained` and before the disk floor, the placement read, the add lock, the worktree and the row, rather than `git cat-file -e "<id>^{commit}"`. The peel accepts an annotated tag's id, and `git worktree add` would then start the tree at the tagged commit, not the id named and journalled as `meas.startpoint` (Review Focus 3); row W5-B4c and mutant W5-BM8 pin it.

## Where things stand

**Agreed** (settled by rulings already made, or by the spec as amended):
- Carriers and the read-only audit ship with adoption; a carrier is written when a lease is linked (R8).
- The journal alone creates a lease; a carrier with no journal entry is unowned and never eligible (R2).
- A raw lease is never adopted automatically; the operator attaches one (D-6999).
- Waves 6 and 7 are dropped; the orphan-tree lane owns removal and must skip a held tree (D-7002).
- Soaks are waived, not passed; review, CI, the merge queue, rollout verification and truthful closure remain (2026-10-28).
- The new verbs are workspace-lifecycle verbs, server-composed, capability-gated, on the SAFETY list where they write, named in no skill (ruling 7).
- Fleet box first, then server; every server act behind a capability or the hand-touched marker.
- Measured on `main` while revising this plan: `delegation_activities.sourceKind`'s CHECK admits only `agent`, `workflow` and `bash-worktree`; `delegationRunStamps()` holds the newest 500 closed runs only; spawn adoption (`decideBind`) runs inside the composing dispatch call, and after a restart a returned child of a planned run with no session is bound only by the dead-dispatch pass (D-7563, `server/src/coord/abandonDeadDispatch.ts`, through `childBindGate` then `bindReturnedChild`, under the dispatch-abandon switch, on the coordination serialiser), which also abandons a run whose dispatch never came back (D-7319); the dispatch route runs `dispatchRun` inside `coordMutex`, while `DelegationLane` holds no serialiser handle; `delegation-policy.ts#groundOf`'s `finalConflicts` holds every tree with any `conflicting` attempt ever recorded, and `planRecord` records nothing more on it; `delegationTreeKey` is `JSON.stringify([project, adminRecord])`, not hex; the agent kills ptys and tails, not execs, when its link closes; `planLinked` re-requests a lease once `holdersOf` (open leases only) finds none; `_ws_orphan_class` names a tree directly under `<worktrees-root>/<project>/` `ccd-root`; `watch.ts#divergencesPass` censuses only the projects the registry names, and `laneFlatCensus` leaves an unmeasured project out of `censused`; `collectOrphanTree` receives only the tree's hex (the class is on the sweep's row) and `orphanPathOfHex` is a 300-character display form; `DELEGATION_PASS_BUDGET_MS` (45 s) cuts a delegation pass while its queued work keeps unwinding, and the `CoordMutex` is held across a dispatch's `ws-add`; `CoordStore#clearSession` unbinds a `planned` run whose child the resume arm found spent, so its next dispatch takes the fresh-spawn arm. The plan's O5-8 recommendation, PR4's class rule, PR6's planner, PR8's resolve and conflict rules, and PR9's recovery (serialised, binding nothing) and its PR9a/PR9b split are written against these facts.
- The operator approved this plan on 2026-11-04 and ruled O5-1 to O5-8 with every recommendation: (a), (b), (a), (a), (a), (a), (a), (c) (`D-7840`..`D-7847`). That approves the wave's thresholds (`D-7794`) and its departures from the spec, among them that a returned child of a promoting run waits for the dead-dispatch pass (so with the dispatch-abandon switch off it waits for the operator, with an attention item), that a resolve is final for its tree (`D-7821`), and that a lease in a project the registry names no session of is neither released nor adopted until a session runs there again, counted `uncensused` (`D-7852`).
- The allocator issued this wave's D-number block (D-7794..D-7848, and D-7850..D-7856 for review round 4).
- Promotion (PR9) is wave 5b, by the operator's ruling of 2026-11-04 (`D-7940`); wave 5 is PR1 to PR8 and PR10.
- Consent for PR4 (2026-11-04): the orphan-tree lane has no programme owner, so the operator's approval of this plan covers it, and the last coordinator to change the lane consented on three conditions, recorded in the programme ledger and carried by PR4's brief.

**Waiting on you:**
- Rolling the fleet box after PR1-PR4, rolling the server box to PR5a and keeping it there a release before PR5b (and, under O5-8 (a)/(b), to PR8a a release before PR8b, and to PR9a a release before PR9b, which then becomes the floor, the unattended watchdog rollback included), and touching `$REG/delegation-adopt` by hand once the shadow counts read right.

**Later:**
- The visibility release (dispatched 2026-11-04) merging and rolling out (PR10 waits on it). Wave-4 PR3 and PR4, which PR5a, PR1 and PR3 waited on, merged on 2026-11-03.
- The wave's closing ledger PR, folding each PR's notes. The spec amendments that follow from the O5 rulings landed in the wave's first ledger PR on 2026-11-04.
- Everything in "## Rider".
- If `uncensused` leases turn out common: widening the delegation census to every project holding an unreleased lease, at one `readWorktreeCensus` per such project per pass (`D-7852`).
- Under O5-8 (c): attaching or disowning an unowned tree that holds no lease (a later wave, with its own reader-first release).
