# Delegation broker wave 4 (project, lean) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the operator, on each project card, the delegated work and worktrees that wave 3's lane already records, nested one level under the session that made them, with every rung-4 (`raw`) worktree marked "inferred" beside the Bash call that created it. Bound the journal, the `delegation_events` table and the checkpoint, and close five small hook, ccd, installer and doctor defects on the fleet box. Nothing in wave 4 adopts, releases, retains or removes a worktree.

**Architecture:** A pure L1 decider (`server/src/coord/delegation-projection.ts`) turns the lane's checkpoint, the census and the registry into one additive fleet frame, `{type: 'delegation'}`, which the watcher broadcasts on change and the PWA renders as new row kinds in `nestFleet`; an absent frame reads as "unavailable", never as "no delegated work". A second pure module plans a journal cut point behind a 10-day floor and the records that must be carried past it, and the durable applier performs the crash-ordered rewrite inside its serial queue, retaining `delegation_events` with it and retiring ended checkpoint rows behind the cut. The hook, ccd, installer and doctor changes are shell-side and reach the fleet box first.

**Tech Stack:** TypeScript ESM on Node.js `>=22.16.0`; synchronous `node:sqlite` `DatabaseSync`; Fastify and the `/ws/fleet` socket; the React PWA on `@ccrc/ui` tokens; Bash hooks and generated `ccd`; jq; Vitest.

**Spec:** `docs/superpowers/specs/2026-10-04-delegation-broker-design.md`, stage 3 "Project" (programme wave 4), as amended by the operator's rulings of 2026-10-26:
- §5.6: a rung-4 (`raw`) lease is never adopted automatically (D-6999);
- §5.8: the frame has no `backlog` member (D-7002). Its other departures from §5.8 (no `lineage` member; `leases`, `unowned` and `asOf` members; unowned rows narrowed to `unresolved` and `conflicting`) were ruled by the operator on 2026-10-26 (D-7023);
- §5.12: the journal's retention floor is 10 days (D-7000), and ended rows are retired behind the cut point (D-7001, amending wave-3 decision O4);
- §7: wave 4's gate is 2 days and wave 5's is 3 days; stages 5 and 6 (waves 6 and 7) are dropped (D-7002).

These amendments are recorded here. PR3 edits §5.12 with its code; the spec text of §5.6, §5.8 and §7 follows in the wave's ledger pull request, never in a feature PR.

## Rulings taken before dispatch (all ruled by the operator on 2026-10-26)

Every question the drafting raised was put to the operator before dispatch. The text of this plan is the ruled text.

| Question | Ruling | Recorded as |
|---|---|---|
| **Q1 + Q2** (PR3 "Read this first"): a pure prefix cut frees nearly nothing, so the records still needed are carried into a second durable file, `delegation-carried.log` (carry rules K1-K6), and C1 retires a row only when no RETAINED record names it | the carried-records design | D-7021 |
| **Q3** (PR3 "Read this first"): does compaction run as soon as PR3 is live, or only once the operator creates a marker | **armed on landing**: no marker; the rollback cost below is accepted | D-7022 |
| C1's scope (PR3 Task 3.5) | ended activities and their mappings only; sessions and attempts go to the rider | D-7024 |
| The frame's departures from spec §5.8 (PR1 "Shape decisions"), the R9 `via` nesting of a programme worker's raw lease, and a raw lease row kept beside its tree's unowned row on a conflict | accepted as stated | D-7023 |

The coordinator asked the soak watcher for the live count of raw leases, which sizes rule K5's carried file; the count and the estimate it gives go into PR3's dispatch brief.

## Operator rulings of 2026-10-26

These rulings bind this plan. Each is defined in "## Deviations found".

- **D-6999: rung-4 leases are shown, marked "inferred", and never adopted automatically.** A lease whose `sourceKind` is `raw` (a rung-4 link) is displayed nested under its linked session, marked "inferred", with the `toolUseId` of the Bash call that created it. Leases from the soak and later ones are treated alike: there is no date cut-off and no policy switch. Wave 5 never adopts one automatically; the operator attaches one with a tap (spec §5.14, resolve attach). This amends spec §5.6's sentence "A rung-4 (raw) lease is adopted when linked". Q-W4 (attributing main checkouts) stays off in wave 4. Compaction keeps every journal record within ±20 minutes of each raw lease on its repository, so a link can be re-audited later (identification gap 2). Implemented by PR1 (Task 1.2), PR2 (Tasks 2.2 and 2.7) and PR3 (Task 3.2, rule K5). Implementation note (confirmed by the operator on 2026-10-26, D-7023): a raw lease whose linked session is a programme worker is nested under the top coordinator by R9, labelled `via <linked session>`, because nesting it under the worker would draw it at depth 2; and a raw lease whose tree also has a `conflicting` attempt keeps its nested inferred row, beside the tree's unowned row.
- **D-7000: the journal's retention floor is 10 days,** not the 30 days spec §5.12 proposed. The floor still exceeds the lane's evidence horizon (192 hours of interval retention plus a 20-minute margin), which Task 3.2 pins. Implemented by PR3.
- **D-7001: the checkpoint is bounded by retiring ended rows behind the compaction cut point S.** A row is retired only when every journal record naming it is at or below S and no lease, lineage edge or hold names it. This amends wave-3 decision O4 beyond D-6268, which retired zero-delta Bash rows only. Implemented by PR3 (Task 3.5).
- **D-7002: the programme is reshaped.** Waves 6 and 7 (spec stages 5 and 6: lease audit and clean) are dropped. The orphan-tree lane (#1252) owns the cleanup of these trees and must skip an adopted lease; that skip is wave 5's to build. Wave 4's gate is 2 days with no displayed row the operator flags as wrong; wave 5's gate is 3 days (both amend spec §7's "7 days"). The frame's `backlog` member is dropped, because every wave-4 lease is `not-due` and it could only read 0 (amends spec §5.8).
- **D-7021: compaction carries the records still needed.** On `main` leases are never released, so a pure prefix cut frees nearly nothing. The cut point S is set by the floor and the checkpoint anchor; every record at or below S that a carry rule still needs is copied verbatim into a second durable file, `delegation-carried.log`, and C1 retires a row only when no retained record names it. Implemented by PR3 (Tasks 3.2 to 3.6).
- **D-7022: compaction is armed on landing.** The daily trigger runs from the first ready pass after PR3 is live; there is no marker. The operator accepted the rollback cost: after a compaction, a build without PR3 leaves the delegation lane `reconstructing` until a pre-compaction snapshot is restored (the snapshot `ccrc update` takes before installing PR3 is one).
- **D-7023: the frame's shape.** The departures from spec §5.8 that PR1 lists ("Shape decisions") are accepted, with D-6999's implementation note.
- **D-7024: C1 retires ended activities only.** Sessions and attempts are not retired in wave 4; they go to the rider.
- **Lean scope.** Wave 4 is exactly four pull requests:
  - **PR1**, the server's `delegation` frame: the L0 wire, the L1 decider and the L4 delivery;
  - **PR2**, the PWA's rows;
  - **PR3**, compaction: first the hourly interval-retention door that removes the hourly whole-checkpoint replace, then journal compaction behind the 10-day floor with the records still needed carried aside (D-7021, armed on landing by D-7022), chunked retention of `delegation_events`, and checkpoint retirement (C1);
  - **PR4**, hook and ccd hygiene: the two-read guards in `_hook_spool_append` and `_hook_history_scope` (the likely cause of the sixteen-hooks spool flake), the four `delegation-watch` rows that time out at 20 s, a doctor WARN when `BASH_MAX_TIMEOUT_MS` or `BASH_DEFAULT_TIMEOUT_MS` is set, the installer's `JQ_UNMANAGED` fix (option B, ruled 2026-10-15) and the absent-owner spool prune (ruled 2026-10-14), rolled out to the fleet box first.

  Everything else on wave 4's carried list, and follow-up 10's review carries, go to a later rider ("## Rider").
- **Coordinator decisions of the same day.** The conditional late-return arm (D8) is deferred to the rider. Q-W4 stays off. The null repository after a restart (B1) is deferred, because it only errs toward `unmeasured`.

## Global Constraints

- **Public repository.** Everything in these PRs is public: code, fixtures, commit messages, branch names, PR bodies and comments. Use neutral stand-ins (`project-a`, `lane-a`, `coord-a`, `the fleet box`), refer to ccrc work by its GitHub `#n`, and write no private name, host, address, absolute home path, private repository or tracker link.
- **Rings.** Ring membership is a property of a file's imports. L0 `shared/*.ts` imports nothing; L1 decides with no I/O; L3 adapters keep every distinction they receive; L4 delivers and never decides; L5 is `index.ts` alone. Decide in L1, act in L4.
- **Additive wire.** The `delegation` frame is a new inline `FleetMsg` arm. `FLEET_PROTO` and `FLEET_PROTO_MIN` stay 1. No `FleetSession` field, no change to `reviveFleetSession`, and one reader per field (the PWA store's envelope check, then `readDelegation`).
- **Single definition.** Each closed vocabulary is declared once, in `shared/api.ts`, and every list is derived from its type; `single-definition` and its vocabulary rows go red on a second spelling.
- **Mutation-table discipline.** Every new guard ships with a row that goes red when the guard is deleted or mutated, measured before and after. Mutants are applied one at a time to a saved copy and restored from it (sha checked), never with `git checkout`.
- **Growth cap.** At most 40 net code lines per growth-listed file per PR (`server/test/growth-check.test.ts`, `GROWTH_FILES`, `GROWTH_LIMIT`). No waiver file.
- **Branches.** Every wave-4 branch is cut from `main` and is the worker's workspace branch. After #1558 lands, the branch merges `main` in; it never rebases and never uses `update-branch`.
- **#1558's hunks.** Follow-up 10 (#1558, accepted and held; tip `2155e5625`, base `98fd13dad`) changes `server/src/watch.ts` at main's (`ccba6f9b6`) lines about 9985-9990, 10266-10321 and 11445-11705 (9970-9992, 10268-10339 and 11463-11751 at its tip). No wave-4 PR edits inside them. `server/test/delegation-watch.test.ts` is #1558's file too: PR1 never edits it, and PR3 and PR4 edit it outside #1558's hunks and re-point their edits by content after merging `main`.
- **Held PRs.** Every wave-4 PR body's first line reads: "Held: not to merge before the delegation broker's soak gate (2026-10-31T09:00Z), by the operator's ruling."
- **Ledger edits: one route for every PR.** No feature PR modifies an existing file under `docs/superpowers/plans/` or `docs/superpowers/programs/` (D-6926, `.github/ci/ledger-guard.mjs`). A worker records a departure, and PR3 records its W3-M38 amendment, in a NEW per-task note `docs/superpowers/plans/<this plan's basename>/prN.md` (the guard's intended route), and mails the coordinator, who folds the notes into this plan and the programme ledger in the wave's ledger pull request. No `Ledger-Edit:` trailer is used, so the merge-main commit cannot re-arm the guard.
- **D-numbers.** PR1 owns D-7003..D-7006; PR2 D-7007..D-7010; PR3 D-7011..D-7016; PR4 D-7017..D-7020, each wholly the worker's. D-7021..D-7024 are the operator's further rulings of 2026-10-26 (Q1+Q2, Q3, the frame's shape, C1's scope). A worker takes its PR's numbers in order and defines one only for an actual departure from this plan, in its per-task note; a number no departure takes stays `unused`. Never write a number that was not issued: a `D-TBD-<slug>` in this plan is the coordinator's to mint.
- **Soak load and memory gate.** Every suite runs as `RUN <cmd>`, defined below. A suite starts only while the 1-minute load (as a decimal) is at or below 40 and available memory is at least 4000 MB, inside a 4 GB memory scope at the lowest CPU and I/O priority. If the gate fails, wait and re-measure. One subagent at a time, and no Workflow fan-out.
- **Fixture HOMEs only.** Tests run on fixture HOMEs and fixture registries (`makeCcdHarness`, and the hook suites' own fixture homes); never run `ccd` against the live `$HOME`.
- **Never read live delegation files.** No worker reads the live spool, journal, carried file, checkpoint, `coord.db` or any secret file. Live readings are the coordinator's, from the server's log lines and `/api/fleet/health`.
- **Foreground suites.** Every suite runs in the foreground with a timeout of at least 600000 ms. A known load flake is re-run alone before a red is called a break.
- **Never bare `npx vitest`.** Run `./node_modules/.bin/vitest run <file>` from inside the package.

`RUN <cmd>` means:

```bash
awk '{exit !($1<=40)}' /proc/loadavg && awk '/MemAvailable/{exit !($2>=4000*1024)}' /proc/meminfo \
  && systemd-run --user --scope -p MemoryMax=4G nice -n 19 ionice -c3 <cmd>
```

## Review Focus

The five inputs most likely to break wave 4 for a user, and the rows that pin them:

1. **A dead or restarted coordinator's activity shown as live.** Task 1.2: W4-P3 (a dead parent reads `stale`) and W4-P4 (another incarnation reads `stale`, an unmeasured one `unmeasured`). Task 1.3: W4-W8 (a lane that can no longer project withdraws its frame). Task 2.1: W4-U2b (a withdrawn frame reads unavailable). Task 2.2: W4-U8 (the R9 chip counts only `live` members). Mutants W4-M07, W4-M08, W4-M20, W4-UM6 and W4-UM21.
2. **A raw lease shown without its inferred marker, anywhere.** Task 1.2: W4-P10 (every raw lease carries `inferred`, with the creating call's `toolUseId` or an `unmeasured` creator). Task 2.2: W4-U6 and W4-U7. Task 2.7: W4-U28 and W4-U29 (the chip in every placement, group and fold). Mutants W4-M06, W4-UM4 and W4-UM17.
3. **A crash in the middle of a compaction.** Task 3.3: W4-C11 (a fault before the journal rename leaves the journal byte-identical), W4-C12 (a fault at or after it re-recovers ready) and W4-C13 (a crash between the two renames). Task 3.4: W4-C18 (a crash before the SQLite delete is repaired by deleting, never by a wipe). Mutants W4-CM10 to W4-CM14 and W4-CM18.
4. **An old server with a new PWA, and a new server with an old PWA.** Task 2.1: W4-U4. Task 2.7: W4-U27 (no frame gives today's view byte for byte, with `data-delegation="unavailable"`). Task 1.4: W4-F2 (a null projection sends nothing) and W4-F5 (an old client tolerates the frame). Mutants W4-M01, W4-UM1 and W4-UM16.
5. **A restart re-parenting rows.** Task 1.2: W4-P4, W4-P5 and W4-P7 (a restarted parent's rows read `stale` under their own parent or sit in the offline group, and lineage outlives its run). Task 1.3: W4-W2 (after a server restart the frame is withheld until two reconciles). Task 2.1: W4-U3 (a reconnect clears the previous frame). Task 2.4: W4-U18 (a lease never depends on `runs`). Mutants W4-M02, W4-M12, W4-UM2 and W4-UM11.

## Landing order and rollout

1. **#1558 (follow-up 10) lands first,** after the soak gate. Each wave-4 branch then merges `main` in, re-runs its tip suites under `RUN`, and reports a new handoff commit.
2. **PR4, hook and ccd hygiene,** next, rolled out to the fleet box first. Its Task 4.1 (the two-read guards behind the sixteen-hooks spool flake) and Task 4.3 (the four `delegation-watch` rows that time out at 20 s) remove flakes that PR1's and PR3's tip suites and merge-queue runs would otherwise hit, and a queue ejection costs more calendar time than the fix (items map, "Must precede the projection"). Its Task 4.5b starts only after #1578 merges; if 4.5b is still waiting then, PR1 and PR3 do not wait for PR4, and their queue runs re-run a known flake alone before calling it a break.
3. **PR1, the frame.** It is safe dark: an older PWA drops the unknown frame.
4. **PR3, compaction,** after merging `main` with PR1 in. Both edit the delegation lane in `watch.ts`, in different places. Its Task 3.6 starts only after #1578 merges (Task 3.6).
5. **PR2, the rows,** after merging `main` with PR1 in, so that the PWA ships only once the frame exists. Its cherry-picked Task 1.1 commit merges without conflict.

Each PR lands with `gh pr merge <n> --match-head-commit <handoffCommit>`, only after its review is accepted and the soak gate has passed. Rollout is the operator's: `ccrc rollout` (fleet box first by default) or the console's one tap. Workers and the coordinator never roll a box by hand. Wave 4's 2-day gate starts when all four PRs are live on both boxes, measured by `ccrc version` or `GET /api/updates`, never inferred from a merge.

## Gate

Wave 4's gate is exactly the ruling (D-7002): it passes after 48 consecutive hours, counted from the moment all four PRs are live on both boxes, in which the operator flags no displayed row as wrong.

**No displayed row is flagged wrong.** Only the operator flags rows. A flag names the row (its `leaseId` or `activityId`, or the unowned tree's project and admin record) and what is wrong with it: a wrong parent, a wrong liveness, a missing inferred marker, a row that should not exist, or a row that is missing. Any flag counts, including one on a correctly labelled raw row whose link is wrong. The coordinator records each flag in the programme ledger with the frame's `asOf`. A flag stops the gate; after its fix lands and is live, a fresh 48 hours starts. Workers and reviewers never flag rows: they report a suspected row to the coordinator, who puts it to the operator.

**Reported beside the gate, not conditions of it** (the coordinator may propose to the operator that one becomes a condition; until the operator rules so, none holds the gate):
- **Wave 3's health.** At least once a day and once at the window's end, `/api/fleet/health`'s `delegation`: `unmeasuredRate` (`stageGate`) and `recoveryPhase`.
- **The journal's span.** The latest `delegation compaction:` line (Task 3.7), compacted or skipped: its `limited by` term, the journal's first retained record's `accepted` instant, and the carried file's bytes and lines. In steady state the journal swings between about 10 and about 13.3 days: a cut is worthwhile only once it frees 25% of the journal, that is, once about 3.3 days past the floor have accrued, so most daily attempts log `skipped (below-share …)`. Size the disk budget for about 13.3 days plus the carried file.

The coordinator takes these readings from the server's log lines and the health route, never from the live files, records them in the programme ledger, and puts the result to the operator. Wave 5 starts only after the operator accepts it.

## PR1: the server's `delegation` frame

**Goal.** The server projects what the delegation lane holds into one additive fleet frame, `{type: 'delegation', delegation: DelegationProjectionWire}` (spec §5.8, §5.13, §8.4). It sends activities, leases and unowned work, each already decided by the server. A PWA cannot render the frame until PR2 lands, and an older PWA drops it (`pwa/src/stores/fleet.ts:216-240`'s `asFleetMsg` has no `delegation` arm). So PR1 is safe to ship before anyone can see it.

**Branch and base.** Cut a fresh workspace branch from `main` (`ccba6f9b6` or later). After #1558 (follow-up 10) merges, merge `main` into the branch. Never rebase it. The PR body's first line reads: "Held: not to merge before the delegation broker's soak gate (2026-10-31T09:00Z), by the operator's ruling." Suites run under this plan's soak constraints (the `RUN` gate in Global Constraints): `nice -n 19 ionice -c3` inside `systemd-run --user --scope -p MemoryMax=4G`; start a suite only while the 1-minute load is at or below 40 and at least 4000 MB is available; one subagent at a time; fixture HOMEs only; never read the live delegation files.

**Files.**
- `shared/api.ts`: the L0 wire block and one `FleetMsg` arm.
- New `server/src/coord/delegation-projection.ts` (L1).
- `server/src/watch.ts` (L4): the lane's `projection()` and the watcher's emit.
- `server/src/coord/store.ts` (L3, growth-listed): one narrow read, `delegationRunStamps`, beside `coordPlacementStamps` (Task 1.3).
- `server/src/bus.ts`: overloads.
- `server/src/server.ts` (L4): the socket.
- Tests: new `server/test/delegation-projection.test.ts`, new `server/test/delegation-frame.test.ts`, `server/test/fleetws.test.ts`, `server/test/delegation-wave3.integration.test.ts`, `server/test/single-definition/vocabularies.test.ts`, `server/test/mail-routes.test.ts`.

**Rulings this PR implements.**
- **D-6999.** A rung-4 (`raw`) lease is shown nested under its linked session and marked `inferred`, with the creating Bash call's `toolUseId`. This applies to soak-era and later leases alike, with no date cut-off and no policy switch. Q-W4 stays off: nothing here attributes main checkouts. Per D-6999's implementation note, R9 applies to a raw lease too (a programme worker's raw lease sits under the top coordinator with `via` naming the linked worker, W4-P15), and a conflict never hides a raw lease row (W4-P12).
- **D-7002.** The frame has no `backlog` member.
- **Coordinator decisions.** D8 (the late-return arm) and B1 (the null repository after a restart) go to the rider. Neither touches the projection.

**D-numbers.** D-7003, D-7004, D-7005 and D-7006 are this PR's. Each stays `unused` until the worker defines one. Candidates the worker is likely to need are named inline as "deviation candidate".

**Shape decisions this section fixes.** Apart from `backlog` (D-7002), no ruling amends spec §5.8's frame `{type:'delegation', activities, lineage, backlog}`, so every departure below is recorded as one deviation, D-7023 (operator ruling 2026-10-26), with its reason:
- The frame replaces §5.8's `lineage` member with each lease's display parent. On `main`, the only edge is the one a lease opens (`server/src/coord/delegation-checkpoint.ts:1085-1088`), and no activity or run edges exist.
- It adds `leases`, `unowned` and `asOf`: the lease rows, the unowned group's rows and the census instant, which §5.8's rows need and its member list does not name.
- Unowned rows carry the `unresolved` and `conflicting` verdicts only. §5.8 also names "unmeasured" work, but an unmeasured tree is not unowned work (R59's one owner, `isUnownedWorkReason`, and R84 keep it out); it stays in the health's counts.
- `bash-worktree` activities are never activity rows. They are listing windows, not delegated work. About 90% of activities are of this kind (ledger `:1234`), and the stale active old-rule rows wait on the rider's `unknown` writer. Such an activity appears only as the creator of a `raw` lease.
- A lease whose workspace is measured `absent` is not a row. Spec §5.8 keeps a workspace-backed row "while the workspace or a cleanup obligation exists", and every wave-4 lease is `not-due` (`delegation-checkpoint.ts:662`).

### Task 1.1: the L0 wire block, and the scope census rewritten to wave 4's shape

**Files.**
- `shared/api.ts`: the `FleetMsg` union at `:4051-4075`; the new block goes after the wave-3 delegation vocabularies (`:11184-11264`).
- `server/test/delegation-wave3.integration.test.ts`: the scope census at `:1120-1178`.
- `server/test/single-definition/vocabularies.test.ts`: a new describe after the wave-3 block at `:568-627`.

**Interfaces produced.** These are consumed by Tasks 1.2-1.4 and by PR2:
- the types `DelegationLiveness`, `DelegationRowGroup`, `DelegationActivityPlacement`, `DelegationCreatorKind`, `DelegationCreatorWire`, `DelegationInferredWire`, `DelegationActivityWire`, `DelegationLeaseWire`, `DelegationUnownedWire` and `DelegationProjectionWire`;
- the lists `DELEGATION_LIVENESS`, `DELEGATION_ROW_GROUPS`, `DELEGATION_ACTIVITY_PLACEMENTS` and `DELEGATION_CREATOR_KINDS`;
- the guards `isDelegationLiveness`, `isDelegationRowGroup`, `isDelegationActivityPlacement` and `isDelegationCreatorKind`.

**PR2 copies this task's commit verbatim:** the L0 block and the census rewrite together, cherry-picked unchanged. Both branches then carry byte-identical text, and the later merge resolves without conflict. If PR1's review changes this block, PR1 re-commits it, and PR2 drops its copy and picks up the new one. PR2 never edits the block or the census on its own.

- [ ] **Step 1: RED, the scope census (row W4-SC1).** Rewrite the `it` at `:1121` as "the wave-4 shape: the frame union is main's seven plus `delegation`, and the broker's words appear only in PR2's named PWA files". Keep the comment-stripping rule (R80 N3) and its synthetic CONTROL rows unchanged. Add this constant:

  ```ts
  /** Wave 4 PR2's PWA files: the only ones that may name the broker. PR2 creates exactly the first and edits the rest. */
  const W4_PWA_FILES = [
    'pwa/src/fleet/delegationWords.ts',
    'pwa/src/stores/fleet.ts', 'pwa/src/fleet/nestFleet.ts', 'pwa/src/fleet/fleetTree.ts', 'pwa/src/fleet/rollup.ts',
    'pwa/src/fleet/ProjectCard.tsx', 'pwa/src/fleet/FleetCards.tsx', 'pwa/src/fleet/sessionFacts.ts',
    'pwa/src/fleet/SessionMeta.tsx', 'pwa/src/fleet/SessionLine.tsx', 'pwa/src/screens/SessionScreen.tsx',
  ] as const;
  ```

  (`SessionMeta.tsx` is listed because PR2's Task 2.8 edits it and the `NEVER` regex is a case-insensitive `/delegation/i`; an allow-list entry costs nothing if it ends up naming no broker word. `fleet.css` is not listed: its class names are neutral.)

  Then make these assertions, with allow-list semantics so that the same text is green on PR1's branch (no PWA change) and on PR2's:
  - (a) **Names.** The file-name scan (`FAMILY_NAME`) has offenders equal to `[]` once `pwa/src/fleet/delegationWords.ts` is removed from the list.
  - (b) **Content.** Split today's `NEVER` regex in two. `delegation` is allowed only in `W4_PWA_FILES`. The rest (`disposition`, `\bspool`, the `cleanup…` identifiers, `auditToken`, `explicitIntent`, `coordinatorIntent`, `stageGate`) stay allowed nowhere. A synthetic CONTROL row (as at `:1146-1154`) feeds `pwaWordOffenders` a fake `pwa/src/fleet/Other.tsx` naming `delegation` and expects it to be an offender.
  - (c) **`MAIN_HAS`.** The `lease` row's allowed list becomes main's two files plus `W4_PWA_FILES`. The `adopt`, `retain`, `carrier` and `cleanup` rows are unchanged, because those are wave 5's words.
  - (d) **Frames.** The arm list equals `['hello','fleet','notice','runs','coord','divergence','pools','delegation']`.
  - (e) **The literal.** The files in `server/src` whose code holds `type: 'delegation'` are a subset of `['server/src/server.ts']` (replacing the `not.toMatch` loop at `:1176`), so the row is green on this branch before Task 1.4 adds the literal, and on PR2's branch, which never adds it.
  - (f) **Health.** The `delegation?: DelegationObservationHealth` line is kept.

  It is red on `main` because (d) finds seven arms.

- [ ] **Step 2: RED, the vocabulary rows (W4-V1 to W4-V3)** in `vocabularies.test.ts`, as a new describe titled "delegation wave 4: the projection's closed words are declared once, in shared/api.ts". The rows check four tables: `['DELEGATION_LIVENESS_MAP','DelegationLiveness','DELEGATION_LIVENESS',['live','stale','ended','unmeasured']]`, `['DELEGATION_ROW_GROUP_MAP','DelegationRowGroup','DELEGATION_ROW_GROUPS',['parent','offline-coordinator']]`, `['DELEGATION_ACTIVITY_PLACEMENT_MAP','DelegationActivityPlacement','DELEGATION_ACTIVITY_PLACEMENTS',['row','chip']]` and `['DELEGATION_CREATOR_KIND_MAP','DelegationCreatorKind','DELEGATION_CREATOR_KINDS',['bash-call','unmeasured']]`.
  - **W4-V1.** Each map and each type is declared exactly once, and only in `shared/api.ts` (the `declaredIn` regexes at `:595` and `:602`, with `const` for the map, `type` for the union).
  - **W4-V2.** Each exported list `toEqual`s its members, in that order.
  - **W4-V3.** A union set-equal to the members is held only by `shared/api.ts`, exactly once (the `unionSets` fingerprint at `:607-611`). The type line itself is the one hand-typed copy the idiom allows.

  They are red because nothing is exported. If W4-V3 finds an existing union with the same set, say `'row' | 'chip'` (not measured), rename the colliding table's words and record a deviation candidate.

- [ ] **Step 3: run RED.**

  ```
  cd server && RUN ./node_modules/.bin/vitest run test/delegation-wave3.integration.test.ts test/single-definition/vocabularies.test.ts
  ```

  Expected: W4-SC1 fails on (d), and W4-V1 to W4-V3 fail.

- [ ] **Step 4: implement the L0 block** after `DelegationAttemptVerdict` (`shared/api.ts:11264`), in `SESSION_ROLE_MAP`'s idiom (`:76-77`; also `POOLS_ENFORCEMENT_MAP` at `:12119-12124`). Each union has a sibling `Record<X, true>`, a list derived with `Object.keys`, and a guard, so `rings/wire-totality.test.ts` passes without an exemption:

  ```ts
  // ── Delegation projection: the `delegation` frame (delegation broker wave 4, spec §5.8; D-6999, D-7002) ──────────────
  // Declared ONCE, here; the server decides every word (`server/src/coord/delegation-projection.ts`) and a reader renders
  // it. Each closed set has a sibling `Record<X, true>` map and a list derived from it. This block imports nothing (L0).

  /** How delegated work reads NOW, decided at projection time and never stored. `live`: running, and its parent is alive
   *  in the incarnation that started it. `stale`: recorded as running, but its parent is gone, dead or in another
   *  incarnation (its stop was not seen). `ended`: its terminal evidence was seen. `unmeasured`: its execution state is
   *  `unknown`, or its parent's incarnation was not measured. */
  export type DelegationLiveness = 'live' | 'stale' | 'ended' | 'unmeasured';
  const DELEGATION_LIVENESS_MAP: Record<DelegationLiveness, true> = { live: true, stale: true, ended: true, unmeasured: true };
  export const DELEGATION_LIVENESS: readonly DelegationLiveness[] = Object.keys(DELEGATION_LIVENESS_MAP) as DelegationLiveness[];
  export function isDelegationLiveness(v: unknown): v is DelegationLiveness {
    return typeof v === 'string' && (DELEGATION_LIVENESS as readonly string[]).includes(v);
  }
  /** Where a row sits: under its display parent, or in its project's "offline coordinator" group when the registry
   *  lists no session by that id (spec §5.8, "Missing parent"). */
  export type DelegationRowGroup = 'parent' | 'offline-coordinator';
  // + DELEGATION_ROW_GROUP_MAP, DELEGATION_ROW_GROUPS, isDelegationRowGroup, in the same four-line shape
  /** An activity's own row under its parent, or a chip on its parent's row when the parent is a programme worker (R9). */
  export type DelegationActivityPlacement = 'row' | 'chip';
  // + DELEGATION_ACTIVITY_PLACEMENT_MAP, DELEGATION_ACTIVITY_PLACEMENTS, isDelegationActivityPlacement
  /** Who created a rung-4 (`raw`) lease: the Bash call whose before and after listings added its record, or
   *  `unmeasured` when the checkpoint holds no activity for the lease. */
  export type DelegationCreatorKind = 'bash-call' | 'unmeasured';
  // + DELEGATION_CREATOR_KIND_MAP, DELEGATION_CREATOR_KINDS, isDelegationCreatorKind

  export type DelegationCreatorWire = { kind: 'bash-call'; toolUseId: string } | { kind: 'unmeasured' };
  /** D-6999: the marker on every rung-4 lease. A rung-4 link rests on negative evidence (no other listing window was
   *  seen), so it is shown nested and labelled, and nothing acts on it by itself. */
  export interface DelegationInferredWire { creator: DelegationCreatorWire }

  export interface DelegationActivityWire {
    activityId: string;
    /** The session that started it. Never re-parented: a programme worker's activity is a chip on the worker's row. */
    parentId: string;
    group: DelegationRowGroup;
    placement: DelegationActivityPlacement;
    sourceKind: Exclude<DelegationActivitySourceKind, 'bash-worktree'>;
    /** The agent id, or the workflow run id (a worker's is `<runId>-<index>`), so a reader can group a run's workers. */
    upstreamId: string;
    /** Free text from the session's own events: the server masks the frame. */
    displayName: string | null;
    /** Never `ended`: an ended activity is not a row (spec §5.8, one level deep). */
    liveness: Exclude<DelegationLiveness, 'ended'>;
    openedAt: string;
    lastEventAt: string;
  }

  export interface DelegationLeaseWire {
    leaseId: string;
    /** The display parent: the lease's own parent, or, for a programme worker's lease, that run's coordinator (R9). */
    parentId: string;
    /** R9: the worker the lineage belongs to when `parentId` is its coordinator; null when `parentId` is the lease's own. */
    via: string | null;
    group: DelegationRowGroup;
    project: string;
    adminRecord: string;
    canonicalPath: string;
    sourceKind: DelegationLeaseSourceKind;
    /** Never `absent`: a lease whose workspace is measured gone, with no cleanup obligation, is not a row. */
    workspace: Exclude<DelegationWorkspaceState, 'none' | 'provisioning' | 'absent'>;
    /** Its activity's; `unmeasured` when the checkpoint holds no activity for it. */
    liveness: DelegationLiveness;
    /** Non-null exactly when `sourceKind` is `raw` (D-6999). */
    inferred: DelegationInferredWire | null;
    firstObservedAt: string;
  }

  export interface DelegationUnownedWire {
    project: string;
    adminRecord: string;
    canonicalPath: string | null;
    verdict: Extract<DelegationAttemptVerdict, 'unresolved' | 'conflicting'>;
    /** The correlation reason; `isUnownedWorkReason` (server/src/coord/delegation-policy.ts:175) holds for it. */
    reason: string;
    rung: 1 | 2 | 3 | 4 | null;
    workspace: Exclude<DelegationWorkspaceState, 'none' | 'provisioning' | 'absent'>;
    attemptedAt: string;
  }

  /** The `delegation` frame's payload. ABSENCE MEANS UNAVAILABLE, never "no delegated work" (spec §5.8, §5.13).
   *  No `backlog` (D-7002). No `lineage` member: wave 4's only edges are the ones leases open, carried as each lease's
   *  display parent. `asOf` is the census instant this content was first decided from; the frame is sent only on a
   *  change, so a reader never ages it; when the lane can no longer project, the server sends `delegation: null` once
   *  (the frame is WITHDRAWN: unavailable again). */
  export interface DelegationProjectionWire {
    asOf: string;
    activities: DelegationActivityWire[];
    leases: DelegationLeaseWire[];
    unowned: DelegationUnownedWire[];
  }
  ```

  Add the `FleetMsg` arm after `pools` (move the `;` to the new last arm):

  ```ts
    /** Delegation broker wave 4 (spec §5.8). Additive on the same terms as `pools`: an already-deployed PWA drops an
     *  unknown frame type silently, so NO `FLEET_PROTO` bump. FLEET-LEVEL, never a `FleetSession` field, so
     *  `reviveFleetSession` stays the rows' only reviver. Sent only once the server holds a projection; `null` withdraws it. */
    | { type: 'delegation'; delegation: DelegationProjectionWire | null };
  ```

- [ ] **Step 5: run GREEN.** Run the Step 3 command. Then run `cd server && RUN ./node_modules/.bin/vitest run test/rings/wire-totality.test.ts test/rings/shared-imports.test.ts`, then `cd pwa && RUN npm test`. `pwa` typechecks `shared/api.ts` through its own `tsc`. The new arm needs no PWA change, because `fleet.ts:482-530` is an `if`/`else` chain with no exhaustive `never`.

- [ ] **Step 6: mutation pins.**
  - **W4-M14:** delete `'delegation'` from the census's expected arm list. W4-SC1 goes red (8 arms found).
  - **W4-M15:** add `'pwa/src/fleet/Other.tsx'` to `W4_PWA_FILES` (the guard, not the fixture). W4-SC1's CONTROL row, which expects the synthetic `Other.tsx` naming `delegation` to be an offender, goes red.

  Restore each from a saved copy and re-run green.

- [ ] **Step 7: commit.** `feat(delegation): the delegation frame's L0 wire and wave 4's scope census`, with the attribution trailer.

### Task 1.2: the pure L1 decider

**Files.** Create `server/src/coord/delegation-projection.ts` and `server/test/delegation-projection.test.ts`. Modify `server/test/mail-routes.test.ts`: add one arm at `:933`, beside `isDelegationPolicyKebab`.

**Ring.** L1. The module imports only `shared/api.js`, `./delegation-model.js` (types and `formatDelegationInstant`, `:699`), `./delegation-policy.js` (`isUnownedWorkReason`, `:175`) and `./delegation-correlation.js` (`delegationTreeKey`, `:399`). It does not import `gitref.ts`, which is L3, so the census shape is declared structurally. The `coord/**` row of the 08-10 spec's ring-context map covers the file. The worker confirms this with `rings/totality.test.ts`, which was not run here.

**Interfaces.**

```ts
export const DELEGATION_PROJECTION_CLOSED_RUNS = 200;   // how many newest closed runs the R9 mapping reads (L4 passes it)
export interface DelegationProjectionSession { id: string; status: SessionStatus; workdir?: string }
/** One run's stamp, from the narrow read `delegationRunStamps` (Task 1.3), never the full `runs()` hydration. */
export type DelegationProjectionRun = Pick<RunSummary, 'id' | 'sessionId' | 'claimedBy' | 'openedAt' | 'closedAt'>;
export interface DelegationProjectionInput {
  checkpoint: Pick<DelegationCheckpointV1, 'activities' | 'leases' | 'attempts'>;
  census: {
    measuredAt: number;
    projects: ReadonlyMap<string, { delegation: readonly DelegationCensusRecord[] | null }>;
    incarnations: ReadonlyMap<string, { kind: 'measured'; incarnation: string } | { kind: 'unmeasured' }>;
  };
  absences: readonly { project: string; adminRecord: string }[];
  sessions: readonly DelegationProjectionSession[];   // this tick's listed registry; never a partial listing (Task 1.3 gates it)
  runs: readonly DelegationProjectionRun[];           // open runs plus the newest DELEGATION_PROJECTION_CLOSED_RUNS closed ones
}
export function projectDelegation(input: DelegationProjectionInput): DelegationProjectionWire;
export const isDelegationProjectionKebab = (tok: string): boolean =>
  isDelegationLiveness(tok) || isDelegationRowGroup(tok) || isDelegationActivityPlacement(tok) || isDelegationCreatorKind(tok);
```

`DelegationCensusPass` (`server/src/coord/gitref.ts:547-551`) and the lane's `absences` values (`watch.ts:10627`) are assignable to these shapes as they are.

**The rules.** The decider reads no clock, makes no I/O and makes no durable write.
- **R9, one level, bound to the run that was live when the row's work began.** A ccd session id is a workspace name, and one id works several runs over time, sometimes for different coordinators. So `coordinatorOf(id, at)` is the `claimedBy` of the run, among runs whose `sessionId === id`, whose `claimedBy` is neither `null` nor `id`, and whose interval `[openedAt, closedAt ?? +∞]` contains the instant `at`; when several do, the greatest `id`. Its state is not read: a closed run still answers for an instant inside its interval ("lineage outlives its run"). Otherwise it is `null`. `at` is a lease's `firstObservedAt` and an activity's `openedAt`, parsed with the model's instant parser. It is applied once and never to its own answer. This is legitimately different from `foldCoordPlacements` (`coord/placement.ts`), which answers "the newest stamp for this session" for card placement; R9 asks "whose run was live at this instant", and needs the run's interval, which the placement stamps do not carry. The decider's header states that reason.
- **Liveness of an activity:**
  1. `executionState === 'ended'` gives `ended`.
  2. Otherwise, no listed session by `parentId`, or a listed one with `status === 'dead'`, gives `stale`.
  3. Otherwise, `executionState === 'unknown'`, or an incarnation that is absent or not `measured`, gives `unmeasured`.
  4. Otherwise, a measured incarnation that differs from `parentIncarnation` gives `stale`.
  5. Otherwise, `live`.
- **Group.** A display parent is in `parent` when a listed session has that id, and in `offline-coordinator` otherwise.
- **Presence of a tree `(project, adminRecord)`:**
  - The project's `delegation` is `null` or the project is missing: `unmeasured`. An unmeasured project is never absent.
  - A record with that name and `state === 'present'`: `present`.
  - The tree's key (`delegationTreeKey`) is in `absences`: `absent`.
  - Otherwise: `unmeasured`.
- **Programme ownership wins.** A tree whose `canonicalPath` equals a listed session's `workdir` is neither a lease row nor an unowned row.
- **Activity rows.** One row for each activity whose `sourceKind` is not `bash-worktree`, whose liveness is not `ended`, and which no unreleased lease names by `activityId`. An isolated activity is shown as its lease. Its `parentId` is the activity's own. Its `placement` is `chip` when `coordinatorOf(parentId, openedAt) !== null`, and `row` otherwise.
- **Lease rows.** One row for each lease with `releasedAt === null`, unless one of these holds: ownership wins; a `conflicting` attempt names the same tree and the lease is not `raw` (that tree is unowned work); or the presence is `absent`. A `raw` lease with a conflicting attempt keeps its row, marked inferred, and the tree also gets its unowned row (D-6999's implementation note: every raw lease is shown nested and marked).
  - `parentId` is `coordinatorOf(lease.parentId, lease.firstObservedAt) ?? lease.parentId`. R9 applies to a raw lease too, so a programme worker's raw lease sits under the top coordinator with `via` naming the linked worker (D-6999's implementation note).
  - `via` is `lease.parentId` when a coordinator was found, and `null` otherwise.
  - `liveness` is the liveness of its activity, or `unmeasured` when the checkpoint holds none.
  - `inferred` is `null` unless `sourceKind === 'raw'`. For a raw lease it is `{creator: {kind:'bash-call', toolUseId: activity.upstreamId}}` when its activity is a `bash-worktree` one: the activity's `upstreamId` is the Bash call's `tool_use_id` (`delegation-checkpoint.ts:501`, `delegation-correlation.ts:1404`). Otherwise it is `{creator: {kind: 'unmeasured'}}`.
- **Unowned rows.** Take the attempts with `verdict` `unresolved` or `conflicting` and `isUnownedWorkReason(detail ?? '')`. Keep the newest per tree key (by `attemptedAt`, then `attemptId`). Drop:
  - a tree an unreleased lease holds, unless the attempt is `conflicting`;
  - a tree where ownership wins;
  - a tree whose presence is `absent`.
- **Order.** The output is byte-stable for the dedupe:
  - activities are sorted by `(parentId, openedAt, activityId)`;
  - leases by `(parentId, firstObservedAt, leaseId)`;
  - unowned rows by `(project, adminRecord)`.
- **`asOf`** is `formatDelegationInstant(census.measuredAt)`.

A tree with no evidence at all files no attempt (`delegation-watch.test.ts:1015-1017`, "no parent to file an attempt under"). It is therefore not on the wire, and stays only in the health's counts. This is as the brief rules ("unowned rows from attempts").

- [ ] **Step 1: RED table rows** in `delegation-projection.test.ts`. They use plain row builders (`activity()`, `lease()`, `attempt()`, `census()`), with no fixture HOME and no IO:
  - **W4-P1.** A `live` agent activity under an alive parent in its own incarnation is one row: `liveness:'live'`, `placement:'row'`, `group:'parent'`.
  - **W4-P2.** An `ended` activity is not a row, and a `bash-worktree` activity is never one.
  - **W4-P3.** The parent's status is `dead`, so the active activity reads `stale` and never `live`.
  - **W4-P4.** The census measured another incarnation, so `stale`. An unmeasured or absent incarnation gives `unmeasured`.
  - **W4-P5.** The parent is not listed, so the activity is `stale`, and the lease is in `offline-coordinator` with its own `parentId`.
  - **W4-P6.** Presence:
    - a listed `present` record gives `present`;
    - the key in `absences` with the project measured gives no lease row;
    - the key in `absences` but the project's `delegation: null` gives `unmeasured`, never absent;
    - a project the census does not hold gives `unmeasured`.
  - **W4-P7 (lineage outlives its run).** The lease's parent `w` is the `sessionId` of run 5, which is claimed by `c` and closed (`closedAt` set). The lease was first observed inside run 5's interval. The lease row has `parentId:'c'` and `via:'w'`.
  - **W4-P8 (programme ownership wins).** A session whose `workdir` equals the lease's `canonicalPath` produces no lease row. The same holds for an unowned row on that path.
  - **W4-P9 (one level).** `w` works run 5 for `c2`, and `c2` works run 3 for `c1`. `w`'s lease gives `parentId:'c2'` and `via:'w'`, never `c1`.
  - **W4-P10 (D-6999).** A `raw` lease whose activity is `bash-worktree` with `upstreamId:'toolu_wt1'` gives `inferred: {creator: {kind:'bash-call', toolUseId:'toolu_wt1'}}`, nested under its own parent. With no activity in the checkpoint it gives `{creator:{kind:'unmeasured'}}`. An `agent` lease gives `inferred: null`.
  - **W4-P11 (R9 chip).** An activity whose parent is a run's worker gives `placement:'chip'` and the worker's own `parentId`.
  - **W4-P12.** Unowned rows:
    - an `unresolved` attempt with `no-correlating-evidence` gives a row;
    - `ccrc-birth-wait`, `ccd-workspace-not-a-lease` and `evidence-horizon` give none;
    - two attempts on one tree give the newer;
    - a `conflicting` attempt on a tree an `agent` lease holds gives an unowned row and no lease row;
    - a `conflicting` attempt on a tree a `raw` lease holds gives an unowned row AND the raw lease row, with its `inferred` marker.
  - **W4-P15 (D-6999, a programme worker's raw lease).** `w` works run 5 for `c`, and `w`'s `raw` lease was first observed inside run 5. The row has `parentId:'c'`, `via:'w'` and `inferred: {creator: {kind:'bash-call', …}}`.
  - **W4-P16 (one id, two coordinators).** `w` works run 3 for `c1` (closed), then run 5 for `c2`. A lease first observed during run 3 has `parentId:'c1'`, `via:'w'`; one first observed during run 5 has `parentId:'c2'`; one first observed after run 5 closed, outside every run, has `parentId:'w'`, `via:null`.
  - **W4-P13.** The output is byte-identical when the input arrays are permuted, and `asOf` is the census instant.
  - **W4-P14.** `isDelegationProjectionKebab` accepts the four tables' words and nothing else (`'linked'` is false).

  Each row is red because the module is absent.

- [ ] **Step 2: RED kebab census (W4-K1).** Run `cd server && RUN ./node_modules/.bin/vitest run test/mail-routes.test.ts` once the module exists with its literals. Expect the kebab-token census (`:930-933`, which reads every `server/src/coord/*.ts`) to name `offline-coordinator` or `bash-call` in `delegation-projection.ts`. If it is red, add `|| isDelegationProjectionKebab(tok)` with a comment in the style of the seventeenth union. If it is already green, record why in the per-task note and add no arm.

- [ ] **Step 3: run RED.** `cd server && RUN ./node_modules/.bin/vitest run test/delegation-projection.test.ts` is expected to fail because the module is absent.

- [ ] **Step 4: implement** the rules above as one exported function and small private helpers: `coordinatorOf`, `livenessOf`, `presenceOf` and `ownedPaths`. Everything is built once per call: maps of sessions by id, activities by id, leases by tree key, and conflicting attempts by tree key. There is no second classifier of unowned work; it is `isUnownedWorkReason`, which is R59's one owner.

- [ ] **Step 5: run GREEN.**

  ```
  cd server && RUN ./node_modules/.bin/vitest run test/delegation-projection.test.ts test/mail-routes.test.ts test/rings/totality.test.ts test/rings/outward-edges.test.ts test/rings/host-imports.test.ts
  ```

- [ ] **Step 6: mutation pins.** Each is applied alone, restored from a saved copy, and the measured `N failed | M passed` is recorded.
  - **W4-M02** (§8.4 "lineage outlives its run": *close on run close*): `coordinatorOf` skips runs whose `closedAt` is set. W4-P7 goes red.
  - **W4-M21** (D-6999): exempt `raw` leases from R9. W4-P15 goes red.
  - **W4-M22** (D-6999): a conflicting attempt suppresses a raw lease row too. W4-P12's raw case goes red.
  - **W4-M23:** go back to the greatest-id run per session, ignoring the interval. W4-P16 goes red.
  - **W4-M03** (§8.4 "programme ownership wins": *swap*): drop the `workdir` precedence. W4-P8 goes red.
  - **W4-M04** (§8.4 "nesting is one level": *recurse*): loop `coordinatorOf` to a fixed point. W4-P9 goes red.
  - **W4-M06** (D-6999): set `inferred: null` for every lease. W4-P10 goes red.
  - **W4-M07:** drop the `dead` arm of liveness. W4-P3 goes red.
  - **W4-M08:** drop the incarnation compare. W4-P4 goes red.
  - **W4-M09:** read `absent` from `absences` before checking the project's census. W4-P6's unmeasured-project case goes red.
  - **W4-M13:** drop `isUnownedWorkReason`. W4-P12 goes red.
  - **W4-M16:** let an `ended` activity through. W4-P2 goes red.

- [ ] **Step 7: commit.** `feat(delegation): decide the fleet projection in one pure module`, with the trailer.

### Task 1.3: the lane's projection and the watcher's emit (L4)

**Files.** Modify `server/src/bus.ts` (`:49-89`), `server/src/watch.ts` (`LaneSession` at `:10252` and the two places below) and `server/src/coord/store.ts` (one narrow read beside `coordPlacementStamps`, `:3423`). Create `server/test/delegation-frame.test.ts`.

**Edits in `watch.ts`** are confined to the `LaneSession` line (`:10252`) and two places, all outside follow-up 10's hunks. Measured with `git diff 98fd13dad 2155e5625 -- server/src/watch.ts`, those hunks sit at main's (`ccba6f9b6`) lines about 9985-9990, 10266-10321 and 11445-11705 (9970-9992, 10268-10339 and 11463-11751 at #1558's tip). The worker re-measures them after merging `main`.
- (1) `FleetWatcher`, next to the delegation wrappers at `:1883-1945`.
- (2) `DelegationLane`, between `health()` (`:11063-11076`) and `// ── a pass ──`, plus the 3-line body of `sweep()` (`:11080-11084`).

**Do not edit `delegation-watch.test.ts`**, which is follow-up 10's file. `delegation-frame.test.ts` copies the minimum of its rig (`world`, `setCensus`, `censusPass`, `primed`, `rawTreeWorld`, `bashPre` and `bashPost` at `delegation-watch.test.ts:111-222, 971-992`), keeping `bus` on the `World`. It states in a header comment that the rig is copied, and that folding it into one helper is a rider item.

**Interfaces.**
- `Bus.emit/on/off(event: 'delegation', …: DelegationProjectionWire | null)`: `null` is the withdrawal.
- `CoordStore.delegationRunStamps(closedLimit?: number): { ok: true; runs: DelegationProjectionRun[] } | { ok: false; kind: 'run-unreadable'; detail: string }`: a narrow read beside `coordPlacementStamps` (`store.ts:3423`), selecting only `id`, `sessionId`, `claimedBy`, `openedAt` and `closedAt` over the open runs and the newest `closedLimit` closed ones, with no `coordProject` filter. The full `runs()` hydration costs per-row statements that a periodic lane must not pay (`store.ts:3381-3392`'s docstring). It is legitimately different from `coordPlacementStamps`: it needs the run's interval and every claimed run, stamped or not. About +12 code lines.
- `LaneSession` gains `'workdir'` in its `Partial<Pick<FleetSession, …>>`, so the precedence field is typed end to end.
- `DelegationLane.sweep(...): Promise<boolean>`, which is true iff a pass ran: `lanes.run` returns `null` when it refuses (`server/src/laneRunner.ts:85`).
- `DelegationLane.projection(sessions: readonly DelegationProjectionSession[], runs: readonly DelegationProjectionRun[]): DelegationProjectionWire | null`.
- `FleetWatcher.currentDelegation(): DelegationProjectionWire | null`.
- The private `FleetWatcher.emitDelegation(sessions: readonly LaneSession[]): void`.

- [ ] **Step 1: RED rows** in `delegation-frame.test.ts`, on a fixture HOME:
  - **W4-W1 (the incident, end to end).** `rawTreeWorld()`, then three `censusPass`es over `{demo: [OLD, RAW]}`. This is the sequence of `delegation-watch.test.ts:995-1010`. Then:
    - `w.watcher.currentDelegation()!.leases` equals one row with `{parentId:'demo-a', via:null, group:'parent', sourceKind:'raw', adminRecord:'raw-tree', workspace:'present', liveness:'ended', inferred:{creator:{kind:'bash-call', toolUseId:'toolu_wt1'}}}`;
    - `activities` is `[]`;
    - the bus's `delegation` listener fired exactly twice: first an empty measured frame (`activities`, `leases` and `unowned` all `[]`) on the `at(0)` pass, because `primed`'s pass is the first reconcile and `at(0)`'s the second, so the gate opens while both trees are still inside the birth wait; then the lease frame on the `at(2)` pass. The last value equals `currentDelegation()`.
  - **W4-W2 (absent is unavailable).** A fresh `world()`, not `primed`, after ONE census pass: `currentDelegation()` is `null` and no `delegation` event fired. Also `world({coord:false})` after any pass: `null`.
  - **W4-W3 (byte-equal dedupe).** After W4-W1, a fourth `censusPass` with the same census at `at(3)`. Its `measuredAt` differs, so `asOf` would differ. No further event fires, and `currentDelegation()!.asOf` is still the third pass's instant. A fifth pass with `demo-a` dropped from `sessions` fires one event whose lease has `group:'offline-coordinator'`.
  - **W4-W4 (refused pass).** A `sweepDelegation` inside the cadence, which `lanes.run` refuses, fires no event.
  - **W4-W5 (closed runs are read, narrowly).** `vi.spyOn(w.coord, 'delegationRunStamps')` and `vi.spyOn(w.coord, 'runs')` around a pass. The emit calls `delegationRunStamps(DELEGATION_PROJECTION_CLOSED_RUNS)` and never `runs`. A closed run's stamp is among the answer (a store row). When it answers `{ok:false, kind:'run-unreadable', detail:'x'}`, there is no event, the previous value stands (one pass, D-2545's rule), and one `console.warn` names the frame.
  - **W4-W6 (§8.4 "leases consume no run slot").** After W4-W1, `w.coord.readDelegationProjection().leases` has length 1, and `capsMeasured(w.coord).usage.running` is `0` (`server/src/coord/dispatch.ts:266-273`, `server/src/coord/store.ts:4822-4824`).
  - **W4-W7.** `registryListed` is false (`w.watcher.noteDelegationRegistry(false)` before the pass) and no frame was sent before, so no event.
  - **W4-W8 (a frame is withdrawn).** After W4-W1, a pass with `noteDelegationRegistry(false)` fires exactly one event, with value `null`, and `currentDelegation()` is `null`. A second such pass fires nothing. The next pass that projects again fires the full frame, even though its content equals the last one sent before the withdrawal. Repeat with the applier made not ready (a fault that leaves it `reconstructing`): one `null` event.
  - **W4-W9 (programme ownership on the L4 path).** W4-W1's world, with one more listed session, `demo-w`, whose `workdir` equals the raw lease's `canonicalPath`: the lease frame has no lease row.

  Each row is red because `currentDelegation` does not exist.

- [ ] **Step 2: run RED.** `cd server && RUN ./node_modules/.bin/vitest run test/delegation-frame.test.ts` is expected to fail with "currentDelegation is not a function".

- [ ] **Step 3: implement.** Add three overloads in `bus.ts`, one each for `emit`, `on` and `off`, after `'pools'`. In `DelegationLane`, after `health()`:

  ```ts
  /** Wave 4: the projection as of the last pass, decided in L1 (`projectDelegation`); null while there is nothing measured to
   *  project: no applier, recovery not ready, the registry unlisted this tick, or fewer than two reconciles in this process
   *  (a measured absence needs two successful censuses, `delegation-policy.ts:422-436`). Not stored; never a durable write. */
  projection(sessions: readonly DelegationProjectionSession[], runs: readonly DelegationProjectionRun[]): DelegationProjectionWire | null {
    const census = this.census();
    if (this.durable === null || census === null || !this.registryListed || !this.reconciled || this.reconciliations < 2) return null;
    const state = this.durable.state();
    if (state.phase !== 'ready') return null;
    return projectDelegation({ checkpoint: state.checkpoint, census, absences: [...this.absences.values()], sessions, runs });
  }
  ```

  Change `sweep()` to `const run = this.lanes.run('delegation', () => this.pass(records, sessions)); if (run === null) return false; await run; return true;`, returning `false` without a coordination database. In `FleetWatcher`:

  ```ts
  private lastDelegationJson: string | null = null;
  private delegationNow: DelegationProjectionWire | null = null;
  sweepDelegation(sessions: readonly LaneSession[], records: readonly LaneRecord[]): Promise<void> {
    return this.delegationLane().sweep(sessions, records).then((ran) => { if (ran) this.emitDelegation(sessions); });
  }
  /** The last `delegation` broadcast, or null before one or after a withdrawal: null sends nothing on a cold start (`currentCoord()`'s rule). */
  currentDelegation(): DelegationProjectionWire | null { return this.delegationNow; }
  /** After a pass that ran: project, and broadcast on a CHANGE of content (`asOf` excluded, so an unchanged projection is not
   *  re-sent each minute). A refused or throwing runs read skips the frame and leaves the last one standing (`emitRuns`, D-2545).
   *  A null projection after a frame WITHDRAWS it, once: a lane that cannot project must not leave old liveness on screen. */
  private emitDelegation(sessions: readonly LaneSession[]): void {
    const coord = this.deps.coord;
    if (!coord) return;
    let wire: DelegationProjectionWire | null;
    try {
      const read = coord.delegationRunStamps(DELEGATION_PROJECTION_CLOSED_RUNS);
      if (!read.ok) { console.warn(`ccrc-server: the delegation frame skipped a pass: runs refused (${read.detail})`); return; }
      wire = this.delegationLane().projection(sessions, read.runs);
    } catch (err) { console.warn(`ccrc-server: the delegation frame skipped a pass (${err instanceof Error ? err.message : String(err)})`); return; }
    if (wire === null) {
      if (this.delegationNow === null) return;
      this.delegationNow = null;
      this.lastDelegationJson = null;
      this.bus.emit('delegation', null);
      return;
    }
    const json = JSON.stringify({ ...wire, asOf: '' });
    if (json === this.lastDelegationJson) return;
    this.lastDelegationJson = json;
    this.delegationNow = wire;
    this.bus.emit('delegation', wire);
  }
  ```

  Add `'workdir'` to `LaneSession`'s `Partial<Pick<FleetSession, …>>` (`watch.ts:10252`, one line). The tick already passes whole `FleetSession`s (`:2615`); typing the field means a later change that builds `LaneSession` literals cannot drop the precedence unseen. A rig session without `workdir` only turns precedence off for itself. In `store.ts`, add `delegationRunStamps` beside `coordPlacementStamps`, with the same `clampMailLimit`, `persistedInt` id proof and all-or-failure rule.

- [ ] **Step 4: run GREEN.**

  ```
  cd server && RUN ./node_modules/.bin/vitest run test/delegation-frame.test.ts test/growth-check.test.ts
  ```

  Then run `test/delegation-watch.test.ts` alone, under `RUN`. It is a known 20 s row family, so read any red as load first and re-run it alone.

- [ ] **Step 5: mutation pins.**
  - **W4-M05** (§8.4 "leases consume no run slot": *count them in the cap check*): append `+ (SELECT count(*) FROM delegation_leases WHERE releasedAt IS NULL)` to `capsUsage`'s `running` query (`store.ts:4822-4824`). W4-W6 goes red. This is a mutant only; PR1 does not change `capsUsage`.
  - **W4-M02b:** `delegationRunStamps` reads open runs only (drop the closed arm). W4-W5 goes red.
  - **W4-M20:** keep the last frame on a null projection (the old `if (wire === null) return;`). W4-W8 goes red.
  - **W4-M24:** drop `'workdir'` from the lane's session values (pass `{id, project, status}` only). W4-W9 goes red.
  - **W4-M10:** dedupe over `JSON.stringify(wire)`. W4-W3 goes red.
  - **W4-M12:** drop the `reconciliations < 2` gate. W4-W2 goes red.
  - **W4-M17:** drop `!this.registryListed`. W4-W7 goes red.
  - **W4-M18:** emit even when `ran` is false. W4-W4 goes red.

- [ ] **Step 6: commit.** `feat(delegation): project the lane after each pass and broadcast on change`, with the trailer.

### Task 1.4: the socket (`/ws/fleet`)

**Files.** `server/src/server.ts` (the socket at `:1500-1632`) and `server/test/fleetws.test.ts`.

**Interfaces.** This task consumes `FleetWatcher.currentDelegation()` and the bus's `'delegation'` event.

- [ ] **Step 1: RED rows** in a new `describe('the `delegation` frame')` in `fleetws.test.ts`. They stub with `vi.spyOn(watcher, 'currentDelegation').mockReturnValue(WIRE)` and `bus.emit('delegation', WIRE)`. The `collect` helper's default drop of `pools` (`:58-81`) stays, and no default drop is added for `delegation`: no existing case projects (W4-W2's gate), and the full file's green run at Step 4 measures that.
  - **W4-F1 (cold start order).** With `currentDelegation` stubbed and `keepPools: true`, the frames arrive as `hello, fleet, runs, coord, pools, delegation`, the last being `{type:'delegation', delegation: WIRE}`.
  - **W4-F2 (absent sends nothing; §8.4 server half).** With `currentDelegation()` returning `null`, no `delegation` frame arrives before a following `notice` (the `:976-987` pattern).
  - **W4-F3 (broadcast).** `bus.emit('delegation', WIRE2)` reaches a connected socket. After `close`, the listener count for `'delegation'` returns to its value before the connection.
  - **W4-F4 (masked).** A `WIRE` whose activity `displayName` holds an API-key-shaped value (the shape `secret-mask.test.ts`'s `API` constant uses) arrives with that value absent from the socket text.
  - **W4-F5 (old client).** A client that matches only `hello`/`fleet` receives the frame as an object with keys `['delegation','type']`, and the socket stays usable. Also `FLEET_PROTO` is still `1`.
  - **W4-F6 (withdrawal).** `bus.emit('delegation', null)` reaches a connected socket as exactly `{"type":"delegation","delegation":null}`.

  They are red because there is no listener and no cold-start send.

- [ ] **Step 2: run RED.** `cd server && RUN ./node_modules/.bin/vitest run test/fleetws.test.ts` is expected to fail on W4-F1 to W4-F5.

- [ ] **Step 3: implement.** These are about 10 code lines; `server.ts` is growth-listed:

  ```ts
  const onDelegation = (delegation: DelegationProjectionWire | null) =>
    socket.send(delegation === null
      ? JSON.stringify({ type: 'delegation', delegation: null } satisfies FleetMsg)   // nothing to mask; the cache keys on an object
      : maskedFrame(delegation, (mk) => mk.maskDeep({ type: 'delegation', delegation } satisfies FleetMsg)));
  ```

  It goes beside `onPools`. Inside the same `.then` after `poolsNow` (`:1617-1618`) add `const delegationNow = watcher?.currentDelegation(); if (delegationNow) onDelegation(delegationNow);`, with a one-line comment: "chained after `pools`: hello, fleet, runs, coord, pools, delegation; a null value sends NOTHING, `coord`'s rule". Add `bus.on('delegation', onDelegation)` and the matching `bus.off` in `close`. The cold value and the last broadcast are the same object, so `maskedFrame`'s cache (`:1488-1499`) serves both.

- [ ] **Step 4: run GREEN.** `cd server && RUN ./node_modules/.bin/vitest run test/fleetws.test.ts test/delegation-wave3.integration.test.ts`. The latter's (e) now finds the literal only in `server.ts`.

- [ ] **Step 5: mutation pins.**
  - **W4-M01** (§8.4 "an absent `delegation` frame reads as unavailable": *default it to empty*): on a null `currentDelegation()`, send `{asOf: new Date().toISOString(), activities: [], leases: [], unowned: []}`. W4-F2 goes red. PR2 owns the store half of this row.
  - **W4-M11:** `socket.send(JSON.stringify({ type: 'delegation', delegation }))`. W4-F4 goes red.
  - **W4-M19:** drop the cold-start send. W4-F1 goes red.
  - **W4-M25:** drop the `null` arm of `onDelegation` (send nothing on a withdrawal). W4-F6 goes red.

- [ ] **Step 6: commit.** `feat(delegation): send the delegation frame on /ws/fleet`, with the trailer.

### PR1 at its tip

**Suites to run alone**, one at a time, each as `cd server && RUN ./node_modules/.bin/vitest run <file>`:
- `server`:
  ```
  test/delegation-projection.test.ts test/delegation-frame.test.ts test/fleetws.test.ts test/delegation-wave3.integration.test.ts test/single-definition/vocabularies.test.ts test/mail-routes.test.ts test/rings/totality.test.ts test/rings/wire-totality.test.ts test/rings/outward-edges.test.ts test/rings/host-imports.test.ts test/growth-check.test.ts test/delegation-watch.test.ts test/delegation-policy.test.ts test/typecheck-tests.test.ts
  ```
  `delegation-watch` and `typecheck-tests` are known load-sensitive; re-run either alone before calling it a break.
- `pwa`: `cd pwa && RUN npm test`, which typechecks the shared block.

The PR's CI `select tests` summary must list `delegation-projection` and `delegation-frame`. They are new files, so selection picks them up per spec §8.3.

**Growth check.**
- `server/src/watch.ts`: about +38 net code lines (2 fields, `currentDelegation`, `emitDelegation` with its withdrawal arm, `projection()`, `sweep()`'s three lines; the `LaneSession` line is changed in place; comments do not count). That is under the 40 cap, narrowly: the worker measures it after each task. If review grows it, move `emitDelegation`'s body into a helper in `delegation-projection.ts`, never into a new watcher lane.
- `server/src/server.ts`: about +10.
- `server/src/coord/store.ts`: about +12 (`delegationRunStamps`); W4-M05 is a mutant only.
- `shared/api.ts` is not growth-listed.

**Review focus.** These are the inputs most likely to break PR1:
1. **The incarnation race.** The census is taken before the tick's `sessions`. A parent restarted between the two reads `stale` for one pass. That errs away from `live`, but it is a flicker the 2-day gate could flag.
2. **Path spelling in the precedence join.** `canonicalPath` is the census's measured path, while `workdir` is the registry's spelling. A symlinked projects root may never match, and then the lease row shows beside the session row. This is not verified on the fleet; a measured mismatch is a deviation candidate.
3. **A restart.** `absences` is lane memory (`watch.ts:10627`), so the frame is withheld until two reconciles. A PWA connected across a server restart has its slot cleared by the reconnect (PR2, W4-U3), and a lane that stops projecting withdraws its frame (W4-W8).
4. **The R9 read.** The narrow read of up to 200 closed runs' stamps once per pass is a few statements, not `runs()`' per-row hydration, but its bound means a worker whose run is older than that window falls back to its own row. That is a narrowing of "lineage closes only on…". Record it as a deviation candidate if review holds it. A session id that works several runs is bound by the lease's instant (W4-P16).
5. **Dedupe and cold-start parity** (`asOf` excluded), and masking of `displayName` and `reason`.

**What PR1 must not do.**
- No durable write of any kind: no `unknown` writer, journal entry, checkpoint change or SQLite write.
- No `FLEET_PROTO` bump, and no change to `FleetSession` or `reviveFleetSession` (`shared/api.ts:97`, `:3146`).
- No PWA source file.
- No edit to `delegation-watch.test.ts` or `delegation-policy.ts`, and no `store.ts` edit beyond the one narrow read.
- No `watch.ts` edit inside follow-up 10's hunks.
- No adoption, release, attach, carrier or capability.
- No `backlog`; no rung-4 hiding or policy switch; no Q-W4.
- No read of a live delegation file.

PR1's frame-side carries are listed in "## Rider", and its D-numbers (D-7003..D-7006) are defined in "## Deviations found".

## PR2: The PWA's delegation rows

**Goal.** The fleet's project cards draw what the `delegation` frame from PR1 carries:
- a parent's live activities and its worktrees, nested one level under it;
- a programme worker's live activity as a chip on the worker's row (R9);
- the worker's worktrees under the top coordinator, labelled "via <worker>";
- an "Offline coordinator" group and an "Unowned work" group on each card.

When no frame is present, the PWA renders today's view byte for byte and claims nothing (spec §5.8, §5.13). The frame's arrival is the PWA build's only switch (spec §7, stage 3).

**Branch.** Cut from `main`. The branch's first commit is PR1's Task 1.1 commit, cherry-picked unchanged: the L0 wire block and the rewrite of `server/test/delegation-wave3.integration.test.ts`'s closed scope census (`:1120-1178`) together. The rewritten census has allow-list semantics, so it is green on this branch from the start. The worker never edits the block or the census, which are PR1's (see "Contract with PR1" below). After #1558 and PR1 merge, merge `main` in; never rebase.

**PR body.** Its first line reads: "Held: not to merge before the delegation broker's soak gate (2026-10-31T09:00Z), by the operator's ruling."

**Operator rulings implemented:**
- **D-6999.** Every `raw` (rung-4) worktree row is nested under its linked parent and wears an "inferred" chip plus a chip naming the creating Bash call's `toolUseId`. This holds for soak-era links and later ones alike, and in every group the row can land in. Nothing in this PR acts on a row, and no attach control ships (that is wave 5's `resolve attach`).
- **D-7002.** The PWA reads no `backlog` member, and the frame carries none. Wave 4's gate is 2 days with no displayed row the operator flags as wrong. That is why every row this PR draws is measured, labelled and dismissable by fold.

**D-number range.** D-7007 to D-7010. Each is defined as `unused` in "## Deviations found" until the worker takes one in order.

**Files:**
- Modify:
  - `shared/api.ts`, `server/test/delegation-wave3.integration.test.ts` and `server/test/single-definition/vocabularies.test.ts`, only through PR1's Task 1.1 commit, cherry-picked unchanged;
  - `pwa/src/stores/fleet.ts`;
  - `pwa/src/fleet/nestFleet.ts`, `fleetTree.ts`, `rollup.ts`, `ProjectCard.tsx`, `FleetCards.tsx`;
  - `pwa/src/fleet/sessionFacts.ts`, `SessionMeta.tsx`, `SessionLine.tsx`;
  - `pwa/src/screens/SessionScreen.tsx`;
  - `pwa/src/fleet/fleet.css`.
- Create:
  - `pwa/src/fleet/delegationWords.ts` (L1);
  - `pwa/test/delegationFixture.ts`;
  - `pwa/test/delegation-words.test.ts`.
- Extend these tests: `pwa/test/stores.test.ts`, `nestFleet.test.ts`, `fleetTree.test.ts`, `rollup.test.ts`, `project-card.test.tsx`, `fleet-rollup-render.test.tsx`, `fleet-screen.test.tsx`, `card-header-facts.test.tsx`, `fleet-css.test.ts`.

**Rings.** Only `delegationWords.ts`, `nestFleet.ts`, `fleetTree.ts`, `rollup.ts` and the pure parts of `sessionFacts.ts` decide (L1). The store, `FleetCards`, `ProjectCard`, `SessionLine`, `SessionMeta` and `SessionScreen` are L4. They read decisions and pick no word of their own. The shared files touched are L0 and import nothing.

**Suite discipline (soak constraints).** One subagent at a time, no Workflow fan-out, fixture data only. This PR reads no live file at all. Every run below is spelled `RUN <cmd>`, the plan's soak gate (Global Constraints). If the gate fails, wait and re-measure. Never run a suite without it. First set up once: `cd ui && npm ci`, then `cd pwa && npm ci` (pwa reads ui source from `ui/node_modules`).

### Contract with PR1

1. **The wire block.** PR2's first commit is PR1's Task 1.1 commit, cherry-picked unchanged, so both branches carry byte-identical text in `shared/api.ts`: the block below after `DelegationAttemptVerdict` (origin/main `shared/api.ts:11264`), and the `FleetMsg` arm after the `pools` arm (`:4075`). PR2 is written against this text. If PR1's review changes it, PR1 re-commits it, and PR2 drops its copy and cherry-picks the new commit. If PR1's merged block still differs in any way, PR2 takes `main`'s text when it merges `main` in, adapts its readers, and records the difference as the next unused number of its range. Identical hunks merge cleanly; a difference shows up as a conflict, which is the intent.
2. **The census allow-lists.** The same commit rewrites the wave-3 scope census (row W4-SC1). It admits PR2's PWA source footprint through one constant, `W4_PWA_FILES`:
   - **File names** matching the family stem: `pwa/src/fleet/delegationWords.ts` only.
   - **Files whose code names `delegation`, `lease` or `leases`:** at most these eleven: `pwa/src/fleet/delegationWords.ts`, `pwa/src/stores/fleet.ts`, `pwa/src/fleet/nestFleet.ts`, `fleetTree.ts`, `rollup.ts`, `ProjectCard.tsx`, `FleetCards.tsx`, `sessionFacts.ts`, `SessionMeta.tsx`, `SessionLine.tsx`, and `pwa/src/screens/SessionScreen.tsx`. (`stores/fleet.ts` names `leases` in its envelope check.)
   - **The frame union:** eight arms.

   PR2 names none of `spool`, `disposition`, `adopt…`, `retain…`, `carrier…` or `cleanup[A-Z]…`. No user-facing string says "lease": the operator's word is "worktree". The worker measures the actual footprint at the tip with the census's own regexes (Task 2.8). If it needs a file outside `W4_PWA_FILES`, the worker mails the coordinator; it never edits the census.
3. **What the server has already decided.** PR1's decider settles R9, liveness, the group and precedence. A lease's `parentId` is its display parent (the top coordinator, for a programme worker's lease) and its `via` names the worker. An activity's `placement` is `row` or `chip`. `inferred` is non-null exactly for a `raw` lease. An ended activity, a `bash-worktree` activity and a lease whose workspace is measured `absent` are never on the wire. PR2 renders these words. It decides only where a row lands against the `fleet` frame it holds (Tasks 2.4 and 2.5), with two re-checks across the two frames: programme ownership (rule 7) and one level (rule 8).

**The L0 block (PR1, Task 1.1 Step 4, the same text):**

```ts
// ── Delegation projection: the `delegation` frame (delegation broker wave 4, spec §5.8; D-6999, D-7002) ──────────────
// Declared ONCE, here; the server decides every word (`server/src/coord/delegation-projection.ts`) and a reader renders
// it. Each closed set has a sibling `Record<X, true>` map and a list derived from it. This block imports nothing (L0).

/** How delegated work reads NOW, decided at projection time and never stored. `live`: running, and its parent is alive
 *  in the incarnation that started it. `stale`: recorded as running, but its parent is gone, dead or in another
 *  incarnation (its stop was not seen). `ended`: its terminal evidence was seen. `unmeasured`: its execution state is
 *  `unknown`, or its parent's incarnation was not measured. */
export type DelegationLiveness = 'live' | 'stale' | 'ended' | 'unmeasured';
const DELEGATION_LIVENESS_MAP: Record<DelegationLiveness, true> = { live: true, stale: true, ended: true, unmeasured: true };
export const DELEGATION_LIVENESS: readonly DelegationLiveness[] = Object.keys(DELEGATION_LIVENESS_MAP) as DelegationLiveness[];
export function isDelegationLiveness(v: unknown): v is DelegationLiveness {
  return typeof v === 'string' && (DELEGATION_LIVENESS as readonly string[]).includes(v);
}
/** Where a row sits: under its display parent, or in its project's "offline coordinator" group when the registry
 *  lists no session by that id (spec §5.8, "Missing parent"). */
export type DelegationRowGroup = 'parent' | 'offline-coordinator';
// + DELEGATION_ROW_GROUP_MAP, DELEGATION_ROW_GROUPS, isDelegationRowGroup, in the same four-line shape
/** An activity's own row under its parent, or a chip on its parent's row when the parent is a programme worker (R9). */
export type DelegationActivityPlacement = 'row' | 'chip';
// + DELEGATION_ACTIVITY_PLACEMENT_MAP, DELEGATION_ACTIVITY_PLACEMENTS, isDelegationActivityPlacement
/** Who created a rung-4 (`raw`) lease: the Bash call whose before and after listings added its record, or
 *  `unmeasured` when the checkpoint holds no activity for the lease. */
export type DelegationCreatorKind = 'bash-call' | 'unmeasured';
// + DELEGATION_CREATOR_KIND_MAP, DELEGATION_CREATOR_KINDS, isDelegationCreatorKind

export type DelegationCreatorWire = { kind: 'bash-call'; toolUseId: string } | { kind: 'unmeasured' };
/** D-6999: the marker on every rung-4 lease. A rung-4 link rests on negative evidence (no other listing window was
 *  seen), so it is shown nested and labelled, and nothing acts on it by itself. */
export interface DelegationInferredWire { creator: DelegationCreatorWire }

export interface DelegationActivityWire {
  activityId: string;
  /** The session that started it. Never re-parented: a programme worker's activity is a chip on the worker's row. */
  parentId: string;
  group: DelegationRowGroup;
  placement: DelegationActivityPlacement;
  sourceKind: Exclude<DelegationActivitySourceKind, 'bash-worktree'>;
  /** The agent id, or the workflow run id (a worker's is `<runId>-<index>`), so a reader can group a run's workers. */
  upstreamId: string;
  /** Free text from the session's own events: the server masks the frame. */
  displayName: string | null;
  /** Never `ended`: an ended activity is not a row (spec §5.8, one level deep). */
  liveness: Exclude<DelegationLiveness, 'ended'>;
  openedAt: string;
  lastEventAt: string;
}

export interface DelegationLeaseWire {
  leaseId: string;
  /** The display parent: the lease's own parent, or, for a programme worker's lease, that run's coordinator (R9). */
  parentId: string;
  /** R9: the worker the lineage belongs to when `parentId` is its coordinator; null when `parentId` is the lease's own. */
  via: string | null;
  group: DelegationRowGroup;
  project: string;
  adminRecord: string;
  canonicalPath: string;
  sourceKind: DelegationLeaseSourceKind;
  /** Never `absent`: a lease whose workspace is measured gone, with no cleanup obligation, is not a row. */
  workspace: Exclude<DelegationWorkspaceState, 'none' | 'provisioning' | 'absent'>;
  /** Its activity's; `unmeasured` when the checkpoint holds no activity for it. */
  liveness: DelegationLiveness;
  /** Non-null exactly when `sourceKind` is `raw` (D-6999). */
  inferred: DelegationInferredWire | null;
  firstObservedAt: string;
}

export interface DelegationUnownedWire {
  project: string;
  adminRecord: string;
  canonicalPath: string | null;
  verdict: Extract<DelegationAttemptVerdict, 'unresolved' | 'conflicting'>;
  /** The correlation reason; `isUnownedWorkReason` (server/src/coord/delegation-policy.ts:175) holds for it. */
  reason: string;
  rung: 1 | 2 | 3 | 4 | null;
  workspace: Exclude<DelegationWorkspaceState, 'none' | 'provisioning' | 'absent'>;
  attemptedAt: string;
}

/** The `delegation` frame's payload. ABSENCE MEANS UNAVAILABLE, never "no delegated work" (spec §5.8, §5.13).
 *  No `backlog` (D-7002). No `lineage` member: wave 4's only edges are the ones leases open, carried as each lease's
 *  display parent. `asOf` is the census instant this content was first decided from; the frame is sent only on a
 *  change, so a reader never ages it; when the lane can no longer project, the server sends `delegation: null` once
 *  (the frame is WITHDRAWN: unavailable again). */
export interface DelegationProjectionWire {
  asOf: string;
  activities: DelegationActivityWire[];
  leases: DelegationLeaseWire[];
  unowned: DelegationUnownedWire[];
}
```

and, inline in `FleetMsg` (`shared/api.ts:4051-4075`), after `pools`:

```ts
  /** Delegation broker wave 4 (spec §5.8). Additive on the same terms as `pools`: an already-deployed PWA drops an
   *  unknown frame type silently, so NO `FLEET_PROTO` bump. FLEET-LEVEL, never a `FleetSession` field, so
   *  `reviveFleetSession` stays the rows' only reviver. Sent only once the server holds a projection; `null` withdraws it. */
  | { type: 'delegation'; delegation: DelegationProjectionWire | null };
```

### Task 2.1: The store slot and its frame arm

**Files:**
- `shared/api.ts`: the block above, already on the branch through the cherry-picked commit; PR2 makes no edit of its own there.
- `pwa/src/stores/fleet.ts`: `FleetState` slots `:96-182`, `asFleetMsg` `:216-301`, initial state `:365-386`, frame arms `:479-531`, `onOpen` `:534`.
- `pwa/test/stores.test.ts`: the `fleet store` describe at `:1376`; the `runs` frame template is at `:1497-1547`.

**Interfaces.**
- `FleetState.delegation: DelegationProjectionWire | null`. A frame whose `delegation` is `null` (the server's withdrawal, PR1 Task 1.3) sets it back to `null`.
- No `delegationFrameSeen` boolean: `null` *is* the not-seen state. This follows the `pools` precedent (`fleet.ts:519-525`). A boolean beside a nullable would give one fact two writers, and the payload is never an empty value that could be mistaken for silence.
- The slot is per connection. `onOpen` clears it, so a reconnect to an older server (or to one whose lane has no value yet) reads "unavailable", not the last server's rows.
- The slot is never hydrated from, and never written to, `saveFleetSnapshot`, for the reason `pools` gives (`:376-378`).

- [ ] **Step 1: Write the RED rows** in a new `describe('the \`delegation\` frame')`.
  - **W4-U1.** Before any frame, `delegation === null`. After a well-formed frame it `toEqual`s the payload. Red now: the slot does not exist.
  - **W4-U2.** These are dropped silently (`not.toThrow`) and leave `null`: `{type:'delegation'}` (no `delegation` key); `delegation:[]`; a payload missing `activities`, `leases` or `unowned`, or with any of them not an array; a payload whose `asOf` is not a string. The guard is the arm's envelope check; W4-UM3 pins it. Red now: the slot does not exist, so it reads `undefined`.
  - **W4-U2b (withdrawal).** After a well-formed frame, `{type:'delegation', delegation:null}` sets the slot to `null`. Red now.
  - **W4-U3.** After a frame, a socket `close()` then `open()` reads `null` before any new frame. Red: nothing clears it today.
  - **W4-U4.** The old-server fixture: the exact frame sequence origin/main's server sends (`hello`, `fleet`, `runs`, `coord`, `pools`, `divergence`; `server/src/server.ts:1500-1618`) leaves `delegation === null`. `saveFleetSnapshot`'s stored JSON names no `delegation` key.
  - **W4-U5.** A frame carrying an extra unknown top-level key and a member with an unknown `group` word is accepted whole at the envelope. Members are the L1 reader's to tolerate (Task 2.2), never this boundary's to drop (the `divergence` idiom, `:228-233`).
- [ ] **Step 2: Run RED.** `cd pwa && RUN ./node_modules/.bin/vitest run test/stores.test.ts`. W4-U1, U2, U2b, U3, U4 and U5 all fail on the missing slot (it reads `undefined`, never `null`).
- [ ] **Step 3: Implement.**
  - Confirm the L0 block is on the branch (the cherry-picked commit); do not edit it.
  - Add the `asFleetMsg` arm. It checks the envelope only:
    ```ts
    if (t === 'delegation') {
      if (!('delegation' in m)) return null;
      const d = (m as { delegation?: unknown }).delegation;
      if (d === null) return m as FleetMsg;                                   // the server's withdrawal: unavailable again
      if (isRecord(d) && typeof d.asOf === 'string'
        && Array.isArray(d.activities) && Array.isArray(d.leases) && Array.isArray(d.unowned)) return m as FleetMsg;
      return null;
    }
    ```
  - Add the arm `else if (msg.type === 'delegation') set({ delegation: msg.delegation });`.
  - Initial state: `delegation: null`, with a docstring naming the absence rule.
  - In `onOpen`, add `set({ delegation: null })` before `askCatchUp()`.
- [ ] **Step 4: Mutation pins.** Apply each mutant alone from a saved copy, restore, and re-run green.
  - **W4-UM1** (spec §8.4, "default it to empty"): initialise `delegation` to `{asOf:'', activities:[], leases:[], unowned:[]}`. Must red: W4-U1, W4-U4, and W4-U27 (Task 2.7).
  - **W4-UM2:** drop the `onOpen` clear. Must red: W4-U3.
  - **W4-UM3:** drop the `Array.isArray(d.unowned)` clause. Must red: W4-U2.
  - **W4-UM21:** drop the `d === null` arm (a withdrawal is dropped and the old rows stay). Must red: W4-U2b.
- [ ] **Step 5: Run GREEN, then the type check.** `cd pwa && RUN ./node_modules/.bin/vitest run test/stores.test.ts`, then `cd pwa && RUN ./node_modules/.bin/tsc --noEmit`.
- [ ] **Step 6: Commit.** `feat(pwa): hold the delegation frame per connection, null when unavailable`, with the trailer.

### Task 2.2: The L1 words and the member reader

**Files:**
- Create `pwa/src/fleet/delegationWords.ts`, which imports only `shared/api` types and lists. It does not import `./fleetTree`: `fleetTree.ts` imports `readDelegation` from it (Task 2.5), so that import would be a cycle.
- Create `pwa/test/delegation-words.test.ts` and `pwa/test/delegationFixture.ts`.

**`delegationFixture.ts` builders:** `activity(over)`, `lease(over)`, `unowned(over)`, `frame(over)`.
- The defaults use neutral names only: project `project-a`; parents `coord-a`, `worker-a`; paths `/work/project-a/.claude/worktrees/agent-a1`; toolUseId `toolu_test_0001`. A `raw` lease's default `inferred` is `{creator: {kind: 'bash-call', toolUseId: 'toolu_test_0001'}}`; every other lease's is `null`, as the server sends them (PR1, Task 1.2).

**Interfaces (exact).** Every label lives here. No component spells one.

```ts
export const INFERRED_WORD = 'inferred';
export interface Chip { readonly text: string; readonly title: string }
export const GROUP_WORDS: Readonly<Record<'offline-coordinator' | 'unowned', { label: string; title: string }>>;
export const ACTIVITY_WORD: Readonly<Record<DelegationActivityWire['sourceKind'], string>>;      // agent | workflow
export const WORKTREE_WORD: Readonly<Record<DelegationLeaseSourceKind, string>>;              // agent worktree | workflow worktree | worktree | attached worktree
export const LIVENESS_WORD: Readonly<Record<DelegationLiveness, string>>;                     // live: 'running' | stale: 'stale' | ended: 'ended' | unmeasured: 'unmeasured'
export const WORKSPACE_WORD: Readonly<Record<DelegationLeaseWire['workspace'], string | null>>; // present: null | unmeasured: 'unmeasured'
export const VERDICT_WORD: Readonly<Record<DelegationUnownedWire['verdict'], string>>;         // unresolved: 'no owner found' | conflicting: 'two owners claimed it'
/** Member tolerance: a member carrying a word this build cannot name is KEPT. An unknown group is re-filed
 *  `offline-coordinator`, an unknown placement `row`, an unknown liveness or workspace `unmeasured`; any other unknown
 *  word renders with the `unrecognised` word. Never dropped, never "running". */
export function readDelegation(w: DelegationProjectionWire): DelegationProjectionWire;
export function inferredChip(l: DelegationLeaseWire): Chip | null;            // non-null iff sourceKind === 'raw' or inferred !== null (D-6999)
export function creatorChip(l: DelegationLeaseWire): Chip | null;             // non-null iff inferredChip is: `Bash call …<last 8>` for a bash-call creator, full id in title; `Bash call (id not recorded)` otherwise
export function worktreeLine(l: DelegationLeaseWire, viaLabel: string | null, sourceProject: string | null): { parts: readonly string[]; title: string; sourceProject: string | null };
export function activityLine(a: DelegationActivityWire): { parts: readonly string[]; title: string };
export function unownedLine(u: DelegationUnownedWire): { parts: readonly string[]; title: string };
export function delegatedChip(activities: readonly DelegationActivityWire[]): Chip | null;  // R9; null when none is `live`
export function liveActivitiesOf(id: string, w: DelegationProjectionWire): readonly DelegationActivityWire[]; // parentId === id, any placement (Task 2.8)
export function delegationParts(rows: readonly { kind: 'activity' | 'lease' }[]): SummaryPart[]; // `n delegated`, `n worktree(s)`
```

**Fixed wording:**
- **"inferred" title:** "linked by the worktree listing taken before and after Bash call <id>, with no other session's listing overlapping it; no upstream id confirms it, and nothing acts on it automatically".
- **Unowned group title:** "worktrees no session could be tied to; being listed here never makes one eligible for removal".
- **Offline group title:** "work whose session is not running as the one that started it, or is not on this card".
- **Cross-project label:** the caller passes `sourceProject`, computed with `workingOnCard({ project: l.project }, card)`, the one rule `fleetTree.ts:79-80` already owns (`ProjectCard`'s `rowBody` calls that L1 rule; it decides nothing of its own). There is no second spelling of "works on another project", and no import cycle.

- [ ] **Step 1: Write the RED rows.**
  - **W4-U6.** The table over every `DelegationLeaseSourceKind` × `DelegationRowGroup` × workspace {`present`, `unmeasured`} × via {null, `worker-a`} × `inferred` {a `bash-call` creator, an `unmeasured` creator, null}. `inferredChip(l)?.text === 'inferred'` holds iff `sourceKind === 'raw' || inferred !== null`. `creatorChip(l)` is non-null iff `inferredChip(l)` is, and its title contains the full id when the creator is a `bash-call`. Red: the module does not exist.
  - **W4-U7.** `readDelegation` tolerance:
    - a lease or activity with group `'future-word'` comes back with group `offline-coordinator`;
    - an activity with placement `'future-word'` comes back `row`;
    - an activity or lease with liveness `'future-word'`, or a lease with workspace `'future-word'`, comes back `unmeasured`;
    - a lease with sourceKind `'future-kind'` renders `WORKTREE_WORD`'s `unrecognised` fallback, and an inferred chip exactly when its `inferred` is non-null;
    - a `raw` lease always keeps its inferred chip, whatever its other words, even with `inferred: null` (its creator chip then reads `Bash call (id not recorded)`).

    The member count is unchanged.
  - **W4-U8.** `delegatedChip`:
    - with two `live` agents it reads `2 delegated`, and its title lists each `displayName` (or `agent` when null);
    - `stale` and `unmeasured` members are not counted;
    - an empty list gives `null`.
  - **W4-U9.** `worktreeLine`:
    - a non-null `viaLabel` gives the part `via <label>`;
    - a non-null `sourceProject` argument is returned as `sourceProject`, and a null one gives null (the card comparison is `workingOnCard`'s, pinned by its own rows);
    - `workspace:'unmeasured'` adds `unmeasured`; `present` adds nothing;
    - the title is the canonical path.
  - **W4-U10.** A census of the words. No exported string contains `lease`, `adopt`, `retain`, `clean` or `spool` (the operator's vocabulary is "worktree"). Every `Record` table is total over its L0 union. Each union is read from its exported L0 list, never re-typed: the test iterates `DELEGATION_LIVENESS`, `DELEGATION_ROW_GROUPS`, `DELEGATION_ACTIVITY_PLACEMENTS`, `DELEGATION_LEASE_SOURCE_KINDS`, and `DELEGATION_WORKSPACE_STATES` without `none`, `provisioning` and `absent`.
- [ ] **Step 2: Run RED.** `cd pwa && RUN ./node_modules/.bin/vitest run test/delegation-words.test.ts`.
- [ ] **Step 3: Implement** exactly the interfaces above, as `Record` tables keyed by the L0 types. The `unrecognised` fallbacks are the only words outside the tables.
- [ ] **Step 4: Mutation pins.**
  - **W4-UM4:** `inferredChip` returns null when `group !== 'parent'`. Must red: W4-U6.
  - **W4-UM5:** `readDelegation` drops a member with an unknown word instead of re-filing it. Must red: W4-U7.
  - **W4-UM6:** `delegatedChip` counts `stale` or `unmeasured` members. Must red: W4-U8.
- [ ] **Step 5: Run GREEN plus `tsc --noEmit`.** Commit: `feat(pwa): one words module for delegation rows, inferred on every raw worktree`.

### Task 2.3: Characterise today's tree first (its own commit)

**Files:** `pwa/test/nestFleet.test.ts`, `pwa/test/fleetTree.test.ts`, `pwa/test/rollup.test.ts`.

- [ ] **Step 1: Add W4-U0, green on `main` with no source change.**
  - For every fixture set these three files already build (the nestFleet rules 0-5 cases at `nestFleet.test.ts:50-298`, and the fleetTree and rollup cases), assert:
    - `JSON.stringify(nestFleet(s, r))`;
    - `JSON.stringify(fleetTree(s, p, r, acks))`;
    - `JSON.stringify(rollupCard(g, prefs, now, sel))`.

    Each is compared with an inline expected string captured on `main`.
  - Run: `cd pwa && RUN ./node_modules/.bin/vitest run test/nestFleet.test.ts test/fleetTree.test.ts test/rollup.test.ts`. It must be green before any source edit.
- [ ] **Step 2: Commit** `test(pwa): characterise today's fleet tree before delegation rows`. Later tasks may only add the third argument and a `null` twin of each assertion, never change an expected string.

### Task 2.4: `nestFleet`'s new row kinds, groups, one level and precedence

**Files:**
- `pwa/src/fleet/nestFleet.ts`: `FleetRow` at `:49-51`, the body at `:120-189`.
- `pwa/test/nestFleet.test.ts`.

**Interfaces (exact).**

```ts
export type DelegationGroupKind = 'offline-coordinator' | 'unowned';
/** One card's slice of the frame, routed by `fleetTree`. `null` = the projection is unavailable. */
export interface CardDelegation {
  readonly card: string;
  readonly activities: readonly DelegationActivityWire[];
  readonly leases: readonly DelegationLeaseWire[];
  readonly unowned: readonly DelegationUnownedWire[];
}
export type FleetRow =
  | { kind: 'session'; depth: RowDepth; session: FleetSession; delegated?: readonly DelegationActivityWire[] }
  | { kind: 'pending'; depth: RowDepth; run: RunSummary }
  | { kind: 'activity'; depth: 1; activity: DelegationActivityWire; group: DelegationGroupKind | null }
  | { kind: 'lease'; depth: 1; lease: DelegationLeaseWire; via: string | null; group: DelegationGroupKind | null }
  | { kind: 'unowned'; depth: 1; item: DelegationUnownedWire; group: 'unowned' }
  | { kind: 'delegation-group'; depth: 0; group: DelegationGroupKind; count: number };
export function nestFleet(sessions: readonly FleetSession[], runs: readonly RunSummary[],
  delegation: CardDelegation | null = null): FleetRow[];
```

**The rules.** Number them 6 to 11 in the docstring, after today's five.

- **Rule 6, absence permits.** When `delegation === null`, the code path is today's exactly. The new branches run only on a non-null slice, and `delegated` is set only when non-empty. This keeps W4-U0's strings.
- **Rule 7, delegation edges never shape the programme tree.** No activity or lease adds to `parents` (`:147-149`) or `placed`, so a lease can never lift a programme child to the top level or move any top-level row. *Programme ownership wins (spec §5.8).* A lease whose `canonicalPath` equals the `workdir` of any session on this list is not drawn: that workspace's session row, bracketed by its run, is the honest row (rule 5's "yields to a session row"). This is a second check beside PR1's server-side precedence, and it is legitimately different: a TOCTOU re-check across two frames that arrive separately. The `fleet` frame can carry the session before the next `delegation` frame drops the lease.
- **Rule 8, one level, as the server decided it.** PR1 has already applied R9: a lease's `parentId` is its display parent and its `via` names the worker, and an activity's `placement` is `row` or `chip`. `nestFleet` follows those words, and only keeps every row at depth 1 or less against the `fleet` frame it holds:
  - **A lease** whose parent sits at depth 0 becomes a depth-1 child under that parent, after the parent's settled and pending children, carrying the wire's `via`. A lease whose parent sits at depth 1 (the two frames skew: the server saw no coordinator for it, while `nestFleet` brackets it under a run) goes under that worker's bracket parent, with `via` set to the worker's id.
  - **An activity** whose `placement` is `chip`, or whose parent sits at depth 1, becomes no row: it is attached to its parent's session row as `delegated` (the R9 chip). Any other activity becomes a depth-1 child under its parent.
  - Activities come first (`openedAt`, then `activityId`), then leases (`firstObservedAt`, then `leaseId`). Nothing is ever drawn at depth 2.
- **Rule 9, the offline coordinator.** These rows go to the `offline-coordinator` group:
  - a row whose `group` is `offline-coordinator`;
  - a row whose `group` is `parent` but whose parent is not on this list (gone from the fleet, archived, or in the Released fold). Absence permits: two frames can skew.

  The group is one `delegation-group` header row at depth 0, followed by its members at depth 1 with `group` set.
- **Rule 10, unowned work.** Every `unowned` item of this card goes to the `unowned` group, which renders after the offline group. A lease is never in it: the server files a conflicting tree as unowned work and sends no lease row for that tree, except a `raw` lease, which keeps its nested inferred row beside the tree's unowned row (PR1, Task 1.2; D-6999's implementation note).
- **Rule 11, lineage outlives its run.** A lease row never depends on `runs`: a parent with no active run still nests its leases, and `liveness: 'ended'` or `workspace: 'unmeasured'` never hides a row. Hiding a row is the server's decision, through lineage (spec §5.8 "Lineage closes only on").

- [ ] **Step 1: Write the RED rows,** each a unit assertion over `nestFleet`. Builders come from `delegationFixture.ts`.
  - **W4-U11** (rule 6). Every W4-U0 input with `null` as the third argument gives the identical `JSON.stringify`. A slice with all three arrays empty gives the identical rows too: an empty measured card adds no group header.
  - **W4-U12** (rule 8, depth 0). Coordinator `coord-a` with one settled worker, one live activity and one `raw` lease gives `[coord-a 0, worker-a 1, activity 1, lease 1]`. The lease has `via === null` and `group === null`.
  - **W4-U13** (rule 8, one level). An activity of `worker-a` (depth 1) with `placement: 'chip'` is not a row, and `worker-a`'s row carries `delegated` with that activity; a `row` activity of `worker-a` (a skewed frame) is attached the same way. A lease with `parentId: 'coord-a', via: 'worker-a'` sits under `coord-a` with `via === 'worker-a'`, and so does a lease whose `parentId` is `worker-a` (skew). No row anywhere has depth > 1, asserted over every case in the file.
  - **W4-U14** (rule 7, programme wins). A lease whose `canonicalPath` equals `worker-a.workdir` is not drawn, and `worker-a` stays bracketed under `coord-a`.
  - **W4-U15** (rule 7, never lifts). A programme child that owns a lease stays at depth 1 under its coordinator. Its lease is the `via` row: it does not become a parent.
  - **W4-U16** (rule 9). A lease of `coord-gone`, absent from the list, and an activity whose `group` is `offline-coordinator` give `[…sessions, group(offline-coordinator, 2) 0, lease 1, activity 1]`.
  - **W4-U17** (rule 10). Three unowned items give one `unowned` group, count 3, after the offline group.
  - **W4-U18** (rule 11). W4-U12's input with `runs = []` and `liveness:'ended', workspace:'unmeasured'` still nests the lease under `coord-a`.
- [ ] **Step 2: Run RED.** `cd pwa && RUN ./node_modules/.bin/vitest run test/nestFleet.test.ts`.
- [ ] **Step 3: Implement.** Write a delegation pass after `:183`'s loop, with three small helpers: `delegationChildren`, `groupRows` and `depthOf`. The existing lines `:124-188` stay unchanged. The pass:
  1. Reads the depths the pass above already decided: `placed` = depth 1, everything else on the list = depth 0.
  2. Splices each parent's delegation children in after that parent's last existing child.
  3. Attaches `delegated` to depth-1 session rows by object spread. The existing row objects are replaced, never mutated.
  4. Appends the two groups after `orphanSpawns`.
- [ ] **Step 4: Mutation pins** (spec §8.4: "programme ownership wins; nesting is one level", mutants swap and recurse; "lineage outlives its run").
  - **W4-UM7 (recurse):** draw a depth-1 parent's lease directly under that worker, with `via:null`. Must red: W4-U13.
  - **W4-UM8 (swap):** drop the workdir check. Must red: W4-U14.
  - **W4-UM9:** add lease parents to `parents`. Must red: W4-U15 and W4-U0/U11.
  - **W4-UM10:** emit group headers when a group is empty. Must red: W4-U11.
  - **W4-UM11 (close on run close):** skip leases whose parent has no active run. Must red: W4-U18.
  - **W4-UM12:** a missing parent drops the row instead of grouping it. Must red: W4-U16.
- [ ] **Step 5: Run GREEN, then `tsc --noEmit`.** The compiler now lists every `row.kind` switch that is no longer exhaustive. These are handled in Tasks 2.6 and 2.7, and only those. `orphanWords.ts:93` and `command/commands.ts:51` already ignore non-session rows and stay unchanged. Commit: `feat(pwa): delegation rows nest one level, programme ownership first`.

### Task 2.5: `fleetTree` routes each delegation row to one card

**Files:**
- `pwa/src/fleet/fleetTree.ts`, `:120-141`.
- `pwa/test/fleetTree.test.ts`.
- `groupFleet.ts` stays unchanged: its `projects` parameter (`:193-231`) already makes an empty card for a project.

**Interfaces.** `fleetTree(sessions, projects, runs, acks = {}, delegation: DelegationProjectionWire | null = null): FleetTreeGroup[]`.

**The card rule.** A row renders on its parent's card (`cardsOf`, `:73-75`) when the fleet carries the parent (cross-repo work nests on the coordinator's card, spec §5.8); otherwise a lease renders on its own `project`. An activity whose parent the fleet does not carry goes to no card, because the wire gives an activity no project (the checkpoint's activity row holds none: `DelegationActivityRow`, `server/src/coord/delegation-model.ts`). It is counted in the screen's `data-delegation-unplaced` attribute (Task 2.7), never dropped silently; placing it on a card is a rider item. Unowned items render on their `project`. Every card a row needs is passed to `groupFleet` as an extra project, so every placed row lands on a card (`fleetTree.ts:36`, "TOTAL").

- [ ] **Step 1: Write the RED rows.**
  - **W4-U19.** `fleetTree(…, null)` equals W4-U0's strings.
  - **W4-U20.** A lease in `project-b` whose parent `coord-a` lives in `project-a` lands on `project-a`'s card, nested.
  - **W4-U21.** An unowned item for `project-c`, which no session or known project names, creates `project-c`'s card. Its rows are exactly the group.
  - **W4-U22.** The same lease never appears on two cards (a count over all groups).
  - **W4-U36.** An activity whose parent the fleet does not carry appears on no card (a count over all groups is 0).
- [ ] **Step 2: RED, then implement, then GREEN.** Run `cd pwa && RUN ./node_modules/.bin/vitest run test/fleetTree.test.ts`. The implementation: build `readDelegation(delegation)` once, route its rows into per-card `CardDelegation` slices, and pass each slice as `nestFleet`'s third argument at `:133`.
- [ ] **Step 3: Mutation pins.** W4-UM13: route a row by its own `project` even when its parent is in the fleet. Must red: W4-U20. W4-UM20: place an activity whose parent the fleet does not carry on the first card of the list. Must red: W4-U36.
- [ ] **Step 4: Commit.** `feat(pwa): route delegation rows to their parent's card`.

### Task 2.6: The rollup counts delegation rows without folding a worker away

**Files:**
- `pwa/src/fleet/rollup.ts`: `RolledRow` at `:37-48`, `childWord` and `summaryParts` at `:88-105`, `foldChildren` at `:107-129`.
- `pwa/test/rollup.test.ts`; its fixture is `pwa/test/rollupFixture.ts`.

**The rule.** Under a session head:
- **W** = its session and pending children; **D** = its activity and lease children.
- **Fold** iff `W.length >= CHILD_FOLD_MIN || D.length >= CHILD_FOLD_MIN`.
- **The summary** is `workerParts(W)` (today's parts, emitted only when W is non-empty), then `delegationParts(D)`, from the words module.
- **Folded and not expanded:**
  - W is today's filter when `W.length >= CHILD_FOLD_MIN`, otherwise all of W;
  - D is hidden.
- `childWord` is asked of W only.
- `WORD_ORDER` is unchanged: delegation parts follow it and are never sorted into it. That avoids `indexOf === -1` sorting them first.
- Group headers stay non-session heads, so their members pass through unfolded (`:118`). `rollupCard`'s `active`, `pinnedOpen` and `lastActive` never read a delegation row.

- [ ] **Step 1: Write the RED rows.**
  - **W4-U23.** With no delegation rows, every summary is W4-U0's string.
  - **W4-U24.** A coordinator with one worker and one lease is not folded: the worker stays visible, as it does today.
  - **W4-U25.** One worker and two live activities: the summary reads `1 worker · 1 working · 2 delegated`. Folded, the worker is visible and both activities are hidden.
  - **W4-U26.** A card whose only change is a live activity keeps its activity class `inactive` (no read of delegation rows in `active`).
- [ ] **Step 2: RED, then implement, then GREEN.** Run `cd pwa && RUN ./node_modules/.bin/vitest run test/rollup.test.ts`.
- [ ] **Step 3: Mutation pins.**
  - **W4-UM14:** fold on `kids.length`. Must red: W4-U24.
  - **W4-UM15:** count D in `N workers`. Must red: W4-U25.
- [ ] **Step 4: Commit.** `feat(pwa): the rollup counts delegated work beside workers`.

### Task 2.7: Rendering: `ProjectCard`, `FleetCards`, CSS and the screen's availability mark

**Files:**
- `pwa/src/fleet/ProjectCard.tsx`: props `:85-111`, `rowKey` `:266-267`, `line` `:305-320`, `rowBody` `:322-345`, the row map `:380-391`.
- `pwa/src/fleet/FleetCards.tsx`: the store reads at `:33-36`, `fleetTree` at `:65`, the fold props at `:158-164`.
- `pwa/src/fleet/fleet.css`: next to `.proj-pending`, `:2030-2074`.
- `pwa/test/project-card.test.tsx`, `fleet-rollup-render.test.tsx`, `fleet-screen.test.tsx`, `fleet-css.test.ts`.

**Interfaces.**
- `ProjectCard` gains `offlineOpen?: boolean` and `unownedOpen?: boolean`, both defaulting to `false`. They follow the inverted "presence means expanded" convention of `::archived` and `::released` (`FleetCards.tsx:158-164`), under the keys `${project}::offline-coordinator` and `${project}::unowned`.
- `rowKey` gains `activity:${activityId}`, `lease:${leaseId}`, `unowned:${project}:${adminRecord}` (the server sends one unowned row per tree) and `group:${group}`.
- `rowBody` renders:
  - **An activity:** a `.proj-work` line built from `activityLine`.
  - **A lease:** a `.proj-work` line built from `worktreeLine`, passing `workingOnCard({ project: lease.project }, card)` as its `sourceProject`, with `inferredChip` and `creatorChip` as `.proj-work-chip` spans. Each chip is a word, never colour alone. A non-null `sourceProject` adds the same folder icon and hidden lead as `.sess-workson` (`SessionLine.tsx`). The via label is resolved with `sessionLabel(coordOf(via))`, and the raw id when the fleet lacks the session.
  - **An unowned item:** a `.proj-work` line built from `unownedLine`.
  - **A group header:** a `BareRow` disclosure: `.proj-group-toggle`, `aria-expanded`, the `GROUP_WORDS` label and `(count)`, with the group title as `title`.
- Members of a closed group are not rendered.
- A session row's `delegated` goes to `line()`, then to `SessionLine`'s new `delegated` prop (Task 2.8).
- `FleetCards` reads `useStore((s) => s.delegation)`, passes it as `fleetTree`'s fifth argument, and stamps `.fleet-list` with:
  - `data-delegation={delegation === null ? 'unavailable' : 'measured'}`;
  - `data-delegation-unplaced={n}`, only when n > 0.

**CSS and theme.** New rules use existing tokens only (`--ink-secondary`, `--ink-tertiary`, `--sp-1`, `--fs-meta`, `--tap-min`). Class names are neutral (`proj-work*`, `proj-group*`), so `fleet.css` gains no broker word. There is no hard-coded colour, no new `opacity` and no `var()` fallback (`css-vars.test.ts`). The chip border is `currentColor`, as `.sess-workson` does (`fleet.css:1442-1450`), and the tap floor comes from `BareRow`. Palettes are generated, so `ui/src/styles/tokens.css` is never edited.

- [ ] **Step 1: Write the RED rows.**
  - **W4-U27** (old server, spec §5.13).
    - `fleet-screen.test.tsx` drives the store with origin/main's frame sequence only. `.fleet-list` reads `data-delegation="unavailable"`.
    - Each card's body `innerHTML` equals the same render with `fleetTree` called with no fifth argument, which is today's code path.
    - The page contains none of `inferred`, `Unowned work` or `Offline coordinator`.
  - **W4-U28.** In `project-card.test.tsx`, a `raw` lease nested under `coord-a` renders the visible text `inferred` and `Bash call …est_0001` (the last eight characters of `toolu_test_0001`). The chip's `title` holds the full toolUseId. The row has no `button` other than the card's existing ones: no attach control in wave 4.
  - **W4-U29.** The inferred label renders for every raw lease, wherever Task 2.4's rules put it: nested, via, the opened offline group and the opened unowned group. The test counts `inferred` occurrences equal to the number of raw leases in the fixture frame.
  - **W4-U30.** The group disclosure:
    - closed by default, showing `Unowned work (3)` and no member rows;
    - clicking `onToggle` with `project-a::unowned` and re-rendering with `unownedOpen` shows 3 members.
  - **W4-U31.** `fleet-rollup-render.test.tsx`: a folded coordinator with two live activities shows the summary `2 delegated` and no activity row. Expanding it shows both, each carrying the nest bracket `NEST_BRACKET`.
  - **W4-U32.** `fleet-css.test.ts`: every colour, spacing and size value in the `.proj-work*` and `.proj-group*` declarations reads a `var(--…)` token, with `currentColor` the one allowed keyword, and `.proj-work-chip` has `border` with `currentColor`.
- [ ] **Step 2: Run RED.** `cd pwa && RUN ./node_modules/.bin/vitest run test/project-card.test.tsx test/fleet-rollup-render.test.tsx test/fleet-screen.test.tsx test/fleet-css.test.ts`.
- [ ] **Step 3: Implement** the rendering exactly as above. The depth-0 `Fragment` path at `:381-384` stays byte-identical, and group headers use it.
- [ ] **Step 4: Run the contrast gate.** `cd pwa && RUN node design/contrast-check.mjs`. It must print no FAIL row. Then run `RUN ./node_modules/.bin/vitest run test/contrast.test.ts test/css-vars.test.ts`.
- [ ] **Step 5: Mutation pins.**
  - **W4-UM16:** `FleetCards` passes `delegation ?? EMPTY_WIRE`, the §8.4 "default it to empty" mutant at the render seam. Must red: W4-U27 (the attribute).
  - **W4-UM17:** `rowBody` omits the inferred chip for leases with a non-null `via`. Must red: W4-U29.
  - **W4-UM18:** groups render open by default. Must red: W4-U30.
- [ ] **Step 6: Commit.** `feat(pwa): draw delegated work, worktrees and the two groups on project cards`.

### Task 2.8: The R9 chip on a worker's row, and the header's superset

**Files:**
- `pwa/src/fleet/sessionFacts.ts`: `FactKey` `:86-90`, `FactInput` `:108-124`, `SessionFactSet` `:126-170`, `sessionFacts` `:218`, `CardFacts`/`cardFacts` `:381-399`, `headerFacts` `:401-432`, `cardWithinHeader` `:435-440`.
- `pwa/src/fleet/SessionMeta.tsx`: card mode at `:150-169`.
- `pwa/src/fleet/SessionLine.tsx`: props and the `sessionFacts` call at `:118-121`.
- `pwa/src/screens/SessionScreen.tsx`: `:280-296`.
- `pwa/test/card-header-facts.test.tsx`.

**Interfaces.**
- `FactKey` adds `'delegated'`.
- `FactInput.delegated?: readonly DelegationActivityWire[] | null`.
- `SessionFactSet.delegated: Chip | null`. It is `delegatedChip(input.delegated ?? [])`, and `null` on a dead row.
- `CardFacts.delegated: Fact | null`.
- `headerFacts` pushes `{ key: 'delegated', … }` after `subagents`.
- `cardWithinHeader` includes `card.delegated`.
- `SessionMeta`'s card mode draws it on the state line after the marker, as `.sess-meta-chip`.
- `SessionScreen` passes `delegated: liveActivitiesOf(live.id, readDelegation(delegation))`, a new L1 helper in `delegationWords.ts` that selects every activity whose `parentId === id`, whatever its placement. The header therefore always holds the card's chip with the same text, because the activity list is the same.
- The card shows the chip only when `nestFleet` attached `delegated`, that is, for a depth-1 programme worker. A depth-0 parent shows rows instead (rule 8).

- [ ] **Step 1: Write the RED rows.**
  - **W4-U33.** A worker with two live activities: `cardFacts(f).delegated.text === '2 delegated'`, and `cardWithinHeader(cardFacts(f), headerFacts(f))` is `[]`.
  - **W4-U34.** A dead worker carries no chip.
  - **W4-U35.** Rendering `SessionLine` with `delegated` shows the chip, and rendering without it gives the same `innerHTML` as today (absence permits).
- [ ] **Step 2: RED, then implement, then GREEN.** Run `cd pwa && RUN ./node_modules/.bin/vitest run test/card-header-facts.test.tsx test/project-card.test.tsx`, then `tsc --noEmit`.
- [ ] **Step 3: Mutation pin W4-UM19.** Drop `card.delegated` from `cardWithinHeader`'s `shown`, and separately drop the header push. Must red: W4-U33 (the second edit only).
- [ ] **Step 4: Measure the census footprint (read-only).** Using the regexes in `delegation-wave3.integration.test.ts:1125-1140`, list the PWA source files that match on this branch, with comments stripped. Compare the list with "Contract with PR1" and mail any difference to the coordinator. Do not edit the census.
- [ ] **Step 5: Commit.** `feat(pwa): a programme worker's live delegated work as one chip (R9)`.

### PR2 at its tip

**Suites to run alone, each under `RUN`, from `pwa/`:** `test/stores.test.ts`, `test/delegation-words.test.ts`, `test/nestFleet.test.ts`, `test/fleetTree.test.ts`, `test/rollup.test.ts`, `test/project-card.test.tsx`, `test/fleet-rollup-render.test.tsx`, `test/fleet-screen.test.tsx`, `test/card-header-facts.test.tsx`, `test/fleet-css.test.ts`, `test/contrast.test.ts` and `test/css-vars.test.ts`.

Then the whole PWA suite: `RUN ./node_modules/.bin/vitest run`. Then `RUN ./node_modules/.bin/tsc --noEmit` and `cd ui && RUN npm test`. Then the server-side ring suites that walk `pwa/src` (`rings/pwa-rings`, `rings/totality`, `rings/pwa-one-owner`): `cd server && RUN ./node_modules/.bin/vitest run test/rings`.

On the server side, only after `main` (with PR1) has been merged in:
- `cd server && RUN ./node_modules/.bin/vitest run test/delegation-wave3.integration.test.ts`;
- `cd server && RUN ./node_modules/.bin/vitest run test/single-definition`;
- `git fetch origin main`, then `RUN ./node_modules/.bin/vitest run test/deviation-refs.test.ts`.

All three must be green with PR1's census as merged.

**Growth check.** PR2 touches neither `server/src/watch.ts` nor `server/src/coord/store.ts`, so the expected growth for both is 0 net lines. Any non-zero growth reading there is a defect in the PR. The expected PWA size is about 500-700 net source lines and 600-800 test lines (projection map §5). No PWA file is growth-listed.

**Review focus:**
1. **Absent versus empty.** The store's `null`, the reset in `onOpen`, `FleetCards`' attribute, and `nestFleet`'s rule 6. Rows W4-U0, U1, U3, U11, U19 and U27; mutants UM1, UM2, UM10 and UM16.
2. **One level and programme precedence.** A worker's activity becomes a chip and never a row; a worker's worktree moves under the top coordinator with `via`; a lease never lifts or moves a programme row; a workdir match hides the lease. Rows U13 to U15; mutants UM7 to UM9.
3. **The inferred label on every raw row,** in every placement and fold, with the creating call's id. Rows U6, U28 and U29; mutants UM4 and UM17.
4. **Member tolerance on a newer server.** An unknown group is re-filed as offline-coordinator and an unknown liveness as unmeasured: never dropped, and never "running". Row U7; mutant UM5.
5. **The rollup's fold rule.** A coordinator's single worker must not disappear behind a summary because worktrees appeared beside it. Rows U24 and U25; mutant UM14.

**What PR2 must NOT do:**
- Edit `server/` or `shared/` at all, except through PR1's cherry-picked Task 1.1 commit and merges of `main`. It must not touch `delegation-wave3.integration.test.ts`, `single-definition`, or any server file on its own.
- Edit `FleetSession`, `reviveFleetSession` or the offline snapshot.
- Bump `FLEET_PROTO`.
- Read any `backlog`.
- Add any control that acts on a row: no attach, retain, promote or remove button (wave 5).
- Label a row "running" unless its `liveness` is `live`.
- Hide a lease because its run closed or its activity ended.
- Count delegation rows in a card's activity class or in `pinnedOpen`.
- Put the word "lease" or any `adopt`, `retain`, `spool` or `cleanup` identifier in PWA source.
- Edit generated palettes or add a colour.
- Run a suite outside the `RUN` gate, or read any live delegation file.

**Settled by PR1's text** (the two drafts were reconciled when this plan was assembled):
- `parentId` is a registry session id, the same id space as `FleetSession.id`: PR1's decider matches it against the listed sessions (Task 1.2), and W4-W1 pins `parentId: 'demo-a'`.
- PR1 never sends a lease whose workspace is measured `absent`, an `ended` activity or a `bash-worktree` activity (Task 1.2). PR2 still never hides a row the frame carries.
- The census allow-list is PR1's `W4_PWA_FILES` (Task 1.1): the eleven files named in "Contract with PR1".

**Not verified while drafting:** how often rule 8's cross-frame skew occurs. It is a re-check that keeps one level, never a source of rows.

## PR3: Journal compaction and the checkpoint bound

**Goal.** Bound the three things that grow without limit today: `delegation-events.log`, the `delegation_events` table and the
checkpoint. PR3 also removes the hourly whole-checkpoint replace that interval retention has caused since 2026-10-26. This is the
riskiest PR of wave 4, because it is the first production code that rewrites the journal. Every task below is written for the
crash at every edge.

- **Branch:** cut from `main`. After #1558 (follow-up 10) merges, merge `main` in; never rebase.
- **Rulings:** the operator ruled Q1+Q2 (D-7021), Q3 (D-7022, armed on landing) and C1's scope (D-7024) on 2026-10-26; the text below is the ruled text.
- **First line of the PR body** (one line, verbatim):
  `Held: not to merge before the delegation broker's soak gate (2026-10-31T09:00Z), by the operator's ruling.`
- **Rulings it implements:**
  - D-7000: the retention floor is 10 days.
  - D-7001: ended rows are retired behind the cut point S.
  - D-6999: every record within ±20 minutes of each raw lease is kept, so a raw lease can be audited again later.
  - It touches nothing of D-7002.
- **D-numbers:** D-7011..D-7016, all the worker's and all `unused` at dispatch. The rulings this PR rests on are D-7021 (Q1+Q2), D-7022 (Q3) and D-7024 (C1's scope), never a number of this range.
- **Files:**
  - new `server/src/coord/delegation-compaction.ts` (L1, pure);
  - `server/src/coord/delegation-checkpoint.ts`, `server/src/coord/delegation-journal.ts`, `server/src/coord/store.ts`
    (growth-listed), `server/src/watch.ts` (growth-listed) and `deploy/coordination-snapshot.mjs`;
  - tests: new `server/test/delegation-compaction.test.ts`, and `delegation-recovery`, `delegation-pass-timing`,
    `delegation-watch`, `delegation-wave3.integration`, `coordination-snapshot`, `mail-routes` and `single-definition`;
  - docs: spec §5.12, and a new per-task note `docs/superpowers/plans/<this plan's basename>/pr3.md` carrying the W3-M38
    amendment (Global Constraints, "Ledger edits"); the wave-3 plan itself is not edited.
- **`RUN`** in the steps below is the plan's soak gate (Global Constraints): it starts a suite only while the 1-minute
  load is ≤ 40 and available memory is ≥ 4000 MB, under `systemd-run --user --scope -p MemoryMax=4G nice -n 19 ionice -c3`.
  Run one subagent at a time, and use fixture HOMEs only.

### Read this first: three facts on origin/main that changed design A (ruled by the operator on 2026-10-26)

The operator ruled each question below on 2026-10-26; the text is the ruled design, and Tasks 3.2-3.7 are written for it.

**Q1: a prefix cut never advances (ruled: D-7021, the carried file).**
- **Leases are never released.** `releasedAt` is written `null` at creation (`delegation-checkpoint.ts:668`), and no writer ever
  sets it. Wave 4 adds none, and D-7002 drops the clean waves.
- **Their holds are therefore permanent.** `computeHolds` (`delegation-checkpoint.ts:1183-1206`) holds three things for good:
  - every lease's creating record and its correlation records (`open-lease`);
  - every lineage edge's identity record (`open-lineage`);
  - every bare `agent_id` occurrence, which "never ages" (`:966`, `identity-candidate`).
- **What that does to the prefix bound.** `planDelegationPruning`'s bound (`delegation-journal.ts:736-750`) is "before every held
  record", so its S can never pass the oldest lease of the soak. Design A as a pure prefix cut would free nearly nothing.
- **The spec forbids dropping those records** ("never drops an event an open lease or lineage edge references",
  spec §5.12 :546). D-6999 also forbids dropping the ±20-minute windows.
- **Lowering S cannot keep a Bash pair together either.** With about 20 sessions running Bash calls of up to 10 minutes, some
  PreToolUse/PostToolUse pair is open at almost every sequence point. Lowering S below each one cascades back without bound.
  This is inferred from the ledger's 5,720 events/h and the 90% `bash-worktree` share (ledger :1234, :1515); it was not measured.
- **Proposed design (A with carried records).** S is set by the floor and the anchor only. Every record at or below S that a rule
  below still needs is copied verbatim into a second file, `delegation-carried.log`. That file holds whole canonical lines in
  increasing sequence, every one of them below the journal's first sequence, with no chain between them; only the compactor
  rewrites it. The journal itself stays exactly what every reader accepts today: a strict contiguous chain that may start after 1
  (`DelegationJournalChain`, `completeFromStart` false, `delegation-checkpoint.ts:1364`).
- **The carry rules (K-rules; not to be confused with the checkpoint design C1 of Task 3.5):**
  - **K1** open-lease and open-lineage hold records;
  - **K2** every record naming an identity-candidate hold's key (not only the hold's first record), so a recovery over the
    compacted set rebuilds the same candidate (its `endedAt` and `stopOnly` come from every naming record, `foldEvidence`);
  - **K3** the identity record of every activity that has not ended (a lease may still be created for it);
  - **K4** the launch PostToolUse of every Workflow run that has not ended;
  - **K5** every record whose evidence `observedAt` lies within ±20 minutes of a raw lease's creating call (D-6999), on that
    lease's repository as the overlap check reads it (below);
  - **K6** the Pre of every Bash pair that straddles S, and the Pre/Post partner of any carried Bash record, so no PostToolUse is
    ever retained without its PreToolUse (spec §5.12 :542).
- **"On its repository" (K5) is met as a superset, across repositories.** A record carries no repository, and the checkpoint's
  session row (`DelegationSessionRow`) holds none either. A window's `repository` is lane memory (`sessionProject`, null after a
  restart, B1), and its `listedRepository` is attributed per call from its working directory (R84). `mayBeOn`
  (`delegation-correlation.ts:1272-1274`) reads a window on a repository when either is null or equal to it. The pure planner
  sees neither, so a repository filter could drop a record the overlap check reads; K5 keeps every repository's records in
  the window. Its cost is bounded by time only, so it is measured and reported instead: the compaction line carries the
  carried file's total bytes and lines (Task 3.7), the PR body states the per-raw-lease cost measured on W4-C7's fixture and
  scaled to the ledger's 5,720 events/h, and the coordinator's dispatch brief gives the live raw-lease count the soak watcher measured.
  Narrowing K5 by repository is a rider item that needs the lane's memory injected.
- **The alternative the operator declined** was a pure prefix cut that keeps everything and frees nothing until leases release,
  which is never in this programme.

**Q2: the C1 predicate must read "no RETAINED record names it" (ruled with Q1: D-7021).**
- With carried records, "at or below S" is not the same as "gone", and recovery refuses an unmapped key whose qualifying join is
  retained (`delegation-checkpoint.ts:860`, `:939`).
- **Retirement must also drop the Workflow launch index entry of a retired run.** Otherwise a late task notification refuses
  `fold-refused` ("finds no run row", `:891`) and fails the applier.
- **PR3 retires ended activities and their mappings only** (ruled: D-7024). The ruling D-7001 names
  "ended rows", and the compaction map's C1 also retires sessions and attempts that no remaining row names. The operator ruled
  that narrowing: activities are the bulk of the checkpoint, and attempts feed PR1's unowned rows, so retiring them would change
  what the gate's rows show.

**Q3: rollback, and arming (ruled: D-7022, armed on landing).**
- A build without PR3 ignores `delegation-carried.log`, so after a compaction its recovery refuses `held-evidence-missing` and
  the delegation lane stays `reconstructing`, until a snapshot restore. That includes the unattended `ccrc-update-watchdog`
  rollback and a `ccrc rollback` to a kept version. Only the delegation lane is affected; the server runs, and PR1 withdraws
  the frame (W4-W8), so the PWA reads "unavailable".
- The way back is a restore of a pre-compaction snapshot (Task 3.6), which discards everything the lane recorded since that
  snapshot. The PR body says both.
- **Ruled (D-7022): PR3 ships ARMED.** The daily trigger (Task 3.7) runs from the first ready pass after the build is live,
  with no marker and no switch. The pre-compaction restore point is the snapshot `ccrc update` takes before it installs PR3's
  build. The operator accepted the rollback cost above; the PR body and the release's notes state it.

### Task 3.1: The upkeep door: one commit instead of the hourly whole-checkpoint replace

**Files:**
- `server/src/coord/delegation-checkpoint.ts`: the builder at `:1105-1150`, `commitLocked` at `:2378-2452`, and a new entry beside
  `pruneBucketCursors` (`:2275`).
- `server/src/watch.ts`: the upkeep at `:11218-11226`, `pruneCursors` at `:11282-11299` and `retireZeroDelta` at `:11302-11308`.
- Tests: `server/test/delegation-pass-timing.test.ts` and `server/test/delegation-watch.test.ts`.

**Interfaces**
```ts
// builder (delegation-checkpoint.ts): the ONE place interval rows are replaced, decided on the builder's own rows
upkeepIntervals(nowMs: number): boolean;   // sets this.intervals from upkeepDelegationIntervals(...).intervals; true iff changed
// DelegationDurability
export interface DelegationUpkeepRequest { nowMs: number; intervals: boolean; cursors: boolean; zeroDelta: boolean }
export interface DelegationUpkeepOutcome { intervalsChanged: boolean; cursorsDropped: number; cursorsUnparseable: number; retired: number; applied: DelegationApplyOutcome | null }
upkeep(req: DelegationUpkeepRequest): Promise<DelegationUpkeepOutcome>;
// commitLocked gains: rowsChanged?: true  — the caller's door removed or replaced a row, so the no-op compare is skipped
```
The door decides read-only on the live builder (as `retireZeroDeltaBashActivities` does at `:2300`):
- If no requested part has anything to do, it returns `applied: null` and makes no clone, no build and no encode.
- Otherwise it makes ONE `commitLocked({ items: [], mutate, force: false, rowsChanged: true })`. Its `mutate` runs
  `upkeepIntervals`, `dropBucketCursors` and `retireZeroDeltaBash` in that order.
- `rowsChanged` only ever skips the compare when a door has reported a change. Like the existing `appends` skip
  (`:2400-2402`), it can only cause a write, never suppress one.
- No `verifyDecodable` and no `structuredClone`: the rows are the builder's own, as in `pruneBucketCursors`.

The lane (`watch.ts`) runs the door in the existing `prune` phase:
- The interval part runs on any pass whose `upkeepDelegationIntervals(...).changed` is true, as today, so a never-closed hour
  still turns into a gap on the pass that sees it.
- The cursor and zero-delta parts run once per UTC hour. The hour is spent before the attempt (N6), as today, and the
  `warnedUnparseableCursors` line and the `retired` size are kept.
- The `upkeep` phase keeps only the attempt collapse, which still goes through `applyCheckpointChange`.
- No interval finder is added: `upkeepDelegationIntervals` reads the whole list, and `laneIntervalOf` (#1558) is untouched.

Steps:
- [ ] **RED W4-C1** (`delegation-pass-timing.test.ts`, beside R22's encode count at `:512`). Arm a pass at the first minute of an
  hour on a fixture holding one interval row past 192 h, one cursor past 48 h with its interval on file, and one retirable
  zero-delta call.
  - Assert `encodes` delta = 1, `writes` delta = 1, and that the checkpoint revision advances by exactly 1.
  - Red today: three commits are made, the interval one through `applyCheckpointChange` (two builds, a clone, the compare's two
    encodes, the write and the verify re-encode), so `encodes` is at least 7 and `writes` is 3.
- [ ] **RED W4-C2.** On the same fixture one pass later (nothing due), assert the door is not called. The applier spy counts zero
  `upkeep` calls, and `encodes` and `writes` deltas are 0.
- [ ] **RED W4-C3** (`delegation-watch.test.ts`). A measured hour recorded before it ended becomes `unmeasured` with
  `DELEGATION_HOUR_NEVER_CLOSED` on the first pass where `closeAt <= now - 24h`, in the middle of an hour. The same pass makes no
  cursor drop: `cursorsDropped` is 0 and the cursor row is still present.
- [ ] **Re-point the existing rows.** Rows that spy on `pruneBucketCursors`, `retireZeroDeltaBashActivities` or an interval
  `applyCheckpointChange` (29 hits in `delegation-watch.test.ts` and 11 in `delegation-pass-timing.test.ts`, by grep) move to the
  door. Each keeps its assertion. List each moved row in the commit body.
- [ ] **Mutation pins:**
  - **W4-CM1:** make the door commit when nothing is due. W4-C2 must go red.
  - **W4-CM2:** drop `rowsChanged` from the door. W4-C1 must go red (`encodes` = 3).
  - **W4-CM3:** gate the interval part to once an hour. W4-C3 must go red.
- [ ] **Green:**
  `cd server && RUN ./node_modules/.bin/vitest run test/delegation-pass-timing.test.ts test/delegation-watch.test.ts test/delegation-recovery.test.ts`.
- [ ] **Commit:** `perf(delegation): one upkeep commit through a builder door, no hourly whole-checkpoint replace`.

### Task 3.2: The planner: the cut point S and the carried set (pure)

**Files:**
- new `server/src/coord/delegation-compaction.ts` and new `server/test/delegation-compaction.test.ts`;
- `server/src/coord/delegation-journal.ts:681` changes the floor to 10 days (D-7000);
- `server/src/coord/delegation-checkpoint.ts` exports `bashListingOf` (`:620`, private today);
- `server/test/mail-routes.test.ts`: one arm for the new module's kebab literals (W4-K2).

**Interfaces** (it imports types from `delegation-model.ts` and `shared/api.ts` only; the naming functions are injected, so there
is no import cycle with `delegation-checkpoint.ts` and no new outward edge):
```ts
export const DELEGATION_COMPACTION_MIN_SHARE = 0.25;
export const DELEGATION_RAW_LEASE_WINDOW_MS = 20 * 60_000;          // D-6999; a test pins it equal to DELEGATION_EVIDENCE_MARGIN_MS
export const DELEGATION_CARRY_REASONS = ['open-lease', 'open-lineage', 'identity-candidate', 'active-identity',
  'active-workflow-launch', 'raw-lease-window', 'bash-pair'] as const;
export type DelegationCarryReason = (typeof DELEGATION_CARRY_REASONS)[number];
export type DelegationCutLimit = 'floor' | 'anchor' | 'empty';
export interface DelegationRecordNaming {                            // the consumer's port; delegation-checkpoint.ts supplies it
  naturalKeysOf(e: DelegationEventEnvelopeV1): readonly { encoded: string; sourceKind: DelegationActivitySourceKind }[];
  bashListingOf(e: DelegationEventEnvelopeV1): readonly string[] | undefined;
  workflowLaunchRunId(e: DelegationEventEnvelopeV1): string | null;
}
export interface DelegationLinePosition { offset: number; length: number }   // length includes the LF
export interface DelegationCarriedLine extends DelegationLinePosition {
  sequence: number; journalId: string; source: 'carried' | 'journal'; reasons: readonly DelegationCarryReason[];
}
export interface DelegationCompactionPlan {
  enabled: boolean; disabledReason: string | null;
  cutThrough: number;              // S; 0 = nothing cut
  limitedBy: DelegationCutLimit;
  suffixOffset: number;            // byte offset of record S+1 in the journal (the file size when S is its last record)
  carried: readonly DelegationCarriedLine[];          // in sequence order, all <= S
  carriedEvidenceSequences: readonly number[];        // the evidence records among them
  cutEvidenceEventIds: readonly string[];             // evidence eventIds at or below S that are not carried
  cutRecords: number; cutBytes: number; carriedBytes: number;
  worthwhile: boolean;             // cutBytes - (carried lines whose source is 'journal') >= MIN_SHARE * journal bytes
  retirable: readonly string[];    // Task 3.5: activity ids C1 may retire after the rename
}
export class DelegationCompactionPlanner {
  constructor(input: { checkpoint: DelegationCheckpointV1; ready: boolean; nowMs: number; floorMs: number; naming: DelegationRecordNaming });
  addCarried(record: DelegationJournalRecordV1, at: DelegationLinePosition): void;   // the old carried file, first
  add(record: DelegationJournalRecordV1, at: DelegationLinePosition): void;          // the journal, in file order
  finish(journalBytes: number): DelegationCompactionPlan;
}
```

The rules, exactly:
- **Disabled while reconstructing.** If `ready` is false, `enabled` is false, `cutThrough` is 0, `carried` is empty and the
  disabled reason is the O2 one.
- **The cut point.** `S = min(F - 1, applied - 1)`, where F is the first journal record whose `acceptedAt` is after
  `now - floorMs`. When no record is inside the floor, F - 1 is the journal's last sequence.
  - `limitedBy` names whichever term bound S, or `empty` when S ≤ the journal's first sequence - 1.
  - S never reaches the checkpoint anchor, which stays the first record or later in the journal.
- **Carry candidacy is decided per record, independently of S.** The planner keeps only the candidates' positions and filters
  `<= S` in `finish`:
  - **K1** matches by `journalId` against `checkpoint.pruningHolds` (`open-lease`, `open-lineage`).
  - **K2** matches every record whose `naturalKeysOf` names the `ownerId` of an `identity-candidate` hold.
  - **K3** matches by `identityJournalId` of activities whose `executionState !== 'ended'`.
  - **K4** is the `PostToolUse` of tool `Workflow` whose `workflowLaunchRunId` and session key name a run activity that has not
    ended.
  - **K5** applies to an evidence record whose `observedAt` lies in `[start - 20 min, end + 20 min]` of any lease with
    `sourceKind === 'raw'`. The bounds are inclusive. When the lease's activity row exists, `start` is its `openedAt` and `end`
    is `endedAt ?? openedAt` (`openFromCandidate` sets `openedAt` to the Pre's `observedAt` and `endedAt` to the Post's,
    `delegation-checkpoint.ts:1012-1021`). When the checkpoint holds no activity for the lease (PR1 shows it with an
    `unmeasured` creator), `start` and `end` are both the lease's own `firstObservedAt`, which the checkpoint holds before the
    stream starts, so the planner needs no second pass; its creating and correlation records are carried by K1 anyway. So
    every raw lease has a window (D-6999 says "each").
  - **K6** works over the record's bash-worktree natural key. The planner keeps the first listing-carrying Pre per key, aged by
    `DELEGATION_BASH_PENDING_MS` on `acceptedAt` exactly as `ageBashCalls` does (`:980-986`). The next Bash record on that key
    closes the pair.
    - A pair with `pre <= S < post` carries its Pre.
    - A carried Pre carries its closing record.
    - A carried closing record carries its Pre.
- **An old carried line** is re-carried only if a rule still selects it, and keeps its `source: 'carried'` position.

Steps:
- [ ] **RED W4-C4, the floor.** Records accepted at day 0 to day 12, with `now` = day 12. `cutThrough` is the last record
  accepted at or before `now - 10 d`, and `limitedBy` is `floor`.
  - Red: the module is absent.
  - **W4-C4b:** `DELEGATION_RETENTION_FLOOR_MS > DELEGATION_INTERVAL_RETENTION_HOURS * 3_600_000 + DELEGATION_EVIDENCE_MARGIN_MS`.
    The floor must exceed the lane's evidence horizon (`watch.ts:10462-10494`); that inequality is what makes the cut evidence
    useless to the lane.
- [ ] **RED W4-C5, the anchor and reconstructing.**
  - An `applied` inside the floor gives `cutThrough = applied - 1` and `limitedBy: 'anchor'`.
  - `ready: false` gives `enabled: false`, `cutThrough: 0` and nothing carried.
- [ ] **RED W4-C6, K1 to K4.** One table row per reason. A held lease record and its correlation records, an open lineage
  identity, a bare `agent_id` occurrence, an active agent's identity record, and an active Workflow run's launch record all lie
  below S. Each appears in `carried` with exactly its reason. The ended twin of each case is not carried.
- [ ] **RED W4-C7, K5 (D-6999).** A raw lease opened at 10:00:00.000 and ended at 10:04:00.000.
  - Records observed at 09:40:00.000 and 10:24:00.000 are carried.
  - Records observed at 09:39:59.999 and 10:24:00.001 are not.
  - A record of another session, on any repository, inside the window is carried.
  - **W4-C7b:** a raw lease with NO activity row and `firstObservedAt` 10:05:00.000: records observed at 09:45:00.000 and
    10:25:00.000 are carried, and 09:44:59.999 and 10:25:00.001 are not.
- [ ] **RED W4-C8, K6.**
  - A pair with Pre ≤ S < Post carries the Pre, and S is unchanged.
  - A K5-carried Post whose Pre lies outside the window carries the Pre.
  - A K5-carried Pre whose Post is ≤ S carries the Post.
  - Two overlapping straddling pairs carry both Pres.
- [ ] **RED W4-C9, worthwhile.** A plan that cuts 24% of the bytes, net of lines carried from the journal, is not worthwhile.
  At 25% it is.
- [ ] **Mutation pins** (each red by its row):
  - W4-CM4: carry nothing for K1. W4-C6 must go red.
  - W4-CM5: drop the K4 rule. W4-C6 must go red.
  - W4-CM6: K5 with an exclusive bound. W4-C7 must go red.
  - W4-CM7: drop K6's straddle carry. W4-C8 must go red.
  - W4-CM8: ignore `ready`. W4-C5 must go red.
  - W4-CM9: floor = 7 days. W4-C4b must go red.
  - W4-CM29 (§8.4 "prune past the checkpoint"): `S = F - 1`, without the `applied - 1` term. W4-C5 must go red.
  - W4-CM30: drop K2. W4-C6's identity-candidate row must go red.
  - W4-CM31 (§8.4 "release an activity's identity event before a checkpoint holds its id"): drop K3. W4-C6's active-identity
    row must go red.
  - W4-CM32: K5 skips a raw lease with no activity row. W4-C7b must go red.
- [ ] **RED W4-K2, the kebab census.** Export `isDelegationCompactionKebab` from `delegation-compaction.ts`, derived from
  `DELEGATION_CARRY_REASONS`, the `DelegationCutLimit` table and the outcome-reason table (never re-spelled). Run
  `cd server && RUN ./node_modules/.bin/vitest run test/mail-routes.test.ts`: the census "every quoted kebab token in
  server/src/coord that looks like a code is declared" (`mail-routes.test.ts:593`, which reads every `server/src/coord/*.ts`)
  names the new literals (`raw-lease-window`, `bash-pair`, `active-identity`, …) and is red. Add
  `|| isDelegationCompactionKebab(tok)` beside the delegation arms, with a comment in the house style, and re-run it green.
  Task 3.3's journal refusal codes (`short-copy`, `carried-order`, `carried-past-journal`, `carried-past-applied`) go into
  `DELEGATION_JOURNAL_ERROR_CODES`, which `isDelegationJournalKebab` already admits.
- [ ] **Green:** `cd server && RUN ./node_modules/.bin/vitest run test/delegation-compaction.test.ts test/single-definition test/mail-routes.test.ts`.
  `test/single-definition` is a directory; check that vitest's summary counts every file in it, not zero.
- [ ] **Commit:** `feat(delegation): plan the cut point and the carried records (pure)`.

### Task 3.3: `compactJournal`: the crash-safe rewrite inside the serial queue

**Files:**
- `server/src/coord/delegation-journal.ts`:
  - a new `DELEGATION_CARRIED_FILE = 'delegation-carried.log'` beside `:42`;
  - `readDelegationJournalLines(port, path, chunkBytes?, onTail?)`, which yields `{ record, offset, length }`, with
    `readDelegationJournalRecords` (`:863-895`) delegating to it so there is one splitter;
  - `readDelegationRetainedRecords(port, carriedPath, journalPath)`: the ONE reader of the retained set, which yields the
    carried lines below the journal's first sequence, then the journal's records. Recovery, the projection repair (Task 3.4)
    and `visitRetainedRecords` all read through it, so no reader of the retained set sees the journal alone;
  - a port member `removeTemp(path)`.
- `server/src/coord/delegation-checkpoint.ts`:
  - recovery reads the carried file (`:1384-1408`, `:1474-1508`);
  - the edges (`:1690`);
  - the entry, beside `planPruning` (`:2107`), which now calls the same planner in dry-run mode.
- Tests: `server/test/delegation-compaction.test.ts`, `server/test/delegation-recovery.test.ts` and
  `server/test/delegation-wave3.integration.test.ts:1368-1420`.

**Interfaces**
```ts
export const DELEGATION_COMPACTION_EDGES = ['compact-plan', 'carried-write', 'carried-fsync', 'carried-rename', 'carried-directory-fsync',
  'writer-close', 'journal-copy', 'journal-copy-fsync', 'journal-rename', 'journal-directory-fsync', 'writer-reopen', 'memory-prune',
  'events-delete'] as const;
export type DelegationDurabilityEdge = (typeof DELEGATION_DURABILITY_EDGES)[number] | (typeof DELEGATION_COMPACTION_EDGES)[number];
export type DelegationCompactionOutcome =
  | { kind: 'skipped'; reason: 'not-ready' | 'nothing-to-cut' | 'below-share'; plan: DelegationCompactionPlan | null }
  | { kind: 'compacted'; plan: DelegationCompactionPlan; eventsDeleted: number; retired: number; ms: number };
compactJournal(nowMs: number, floorMs: number): Promise<DelegationCompactionOutcome>;   // DelegationDurability, on the queue
// DelegationRecovery: acceptCarried(record) — strictly increasing, < J (the journal's first sequence), <= applied; held.delete,
// eventIds/evidence add, observeRecord. Refusal codes: 'carried-order', 'carried-past-journal', 'carried-past-applied'.
```
**The one rule for a carried line at or above J.** Recovery first reads the journal's first record (one peek through
`readDelegationJournalLines`), so J is known before the carried file streams. A carried line below J goes to `acceptCarried`.
A carried line at or above J is not accepted: it is kept, with its bytes, in a short list (such lines exist only in the
window between the two renames of step 3 and step 6). While the journal then streams, each journal line at a listed sequence
must equal the listed carried line byte for byte; a mismatch, or a listed sequence the journal never reaches, refuses
`carried-past-journal`. The comparison happens in `readDelegationRetainedRecords`, so every reader of the retained set makes it.
`DELEGATION_DURABILITY_EDGES` itself stays unchanged: `delegation-recovery.test.ts:1095` and `:3508` pin its exact sequence for an
application. Add the new list to the vocabulary check at `delegation-checkpoint.ts:2567`.

**The order.** Every step runs inside `enqueue`, after `requireReady()`, and each is made durable before the next:
1. `compact-plan`: stream the old carried file (if present) and then the journal through the planner. Stop on `nothing-to-cut`
   or `below-share`.
2. `carried-write` and `carried-fsync`: write `delegation-carried.log.tmp`. It holds the plan's `carried` lines, copied verbatim
   from their source file by `offset` and `length`, and the bytes written must equal the sum of their lengths.
3. `carried-rename` and `carried-directory-fsync`.
4. `writer-close`: close the writer. Nothing can append, because the queue is held.
5. `journal-copy`: copy the journal's bytes `[suffixOffset, size)` to `delegation-events.log.tmp`, where `size` is measured now,
   in 256 KiB chunks. Refuse (`short-copy`) unless the bytes written equal `size - suffixOffset`, and (`torn-tail`) unless the
   last byte is LF. Then `journal-copy-fsync`.
6. `journal-rename` and `journal-directory-fsync`.
7. `memory-prune`: delete `cutEvidenceEventIds` from `eventIds`. `DelegationEvidenceIndex.dropThrough(S, carriedEvidenceSequences)`
   keeps the carried sequences and every sequence above S. The builder drops each journal-derived fact whose every source
   record was cut and not carried (a Bash call's fact, a candidate's, a launch-index entry), so the live builder equals what a
   recovery over the compacted set rebuilds (W4-C10).
8. `writer-reopen`: a new `DelegationJournalWriter` on the path.
9. `events-delete` (Task 3.4), then the retirement commit (Task 3.5).

**Why the carried file is renamed first.**
- A crash between steps 3 and 6 leaves the new carried file beside the uncut journal. Its lines at or above J are copies of
  journal lines, matched and skipped by the rule above. Its lines below J exist only from the second compaction on: the old
  carried lines a rule still selects, re-carried verbatim. Old carried lines that no rule selects any more are gone already,
  which is safe because nothing holds them; SQLite's rows for them are removed by the repair's step 0 (Task 3.4) without a
  wipe. So that state is a valid retained set, equal to the old one less records nothing holds.
- If the journal were renamed first, a crash between the renames would lose the carried records.

**Failure handling.**
- A failure before the `journal-rename` edge leaves the journal byte-identical. The compactor calls `removeTemp` on both temp
  files, best effort, replaces the writer, leaves `eventIds` and the evidence index untouched and stays `ready`. The outcome is a
  rejection.
- A failure at or after `journal-rename` calls `this.fail(err)`. The applier then re-recovers from whichever files the rename
  left, and both are valid.
- `removeTemp` deletes only the two temp names. The closed list pins it.

Steps:
- [ ] **RED W4-C10, equivalence.**
  - Setup: a fixture journal of 12 days (evidence, a raw lease, an agent lease, an active Workflow run, straddling pairs,
    zero-delta calls) and a ready applier.
  - Compact, then run a fresh `DelegationDurability.open` over the same directory.
  - Assert the checkpoint is byte-equal to the one before compaction, apart from `revision` (and apart from the rows Task 3.5
    retires, which this row runs without).
  - Assert the journal's first sequence is S+1.
  - Assert the carried file's sequences equal the plan's.
  - Assert `eventIds` after is a subset of before, and `pruning: 'enabled'`.
  - Assert the live builder's `computeHolds()`, candidate map and Workflow launch index equal the fresh recovery's.
  - Red: the entry is absent.
- [ ] **RED W4-C11, faults before the rename.** For each edge from `compact-plan` to `journal-copy-fsync`, in both phases, throw
  from `onEdge`.
  - The journal's SHA-256 is unchanged.
  - A fresh recovery is ready, with the same checkpoint.
  - The faulted applier is still ready.
  - A following `applyAccepted` appends at `head + 1` in the journal, not in a temp file and not in the old inode.
  - `eventIds.size` is unchanged.
- [ ] **RED W4-C12, faults at and after the rename.** For `journal-rename:after`, `journal-directory-fsync`, `memory-prune` and
  `writer-reopen`:
  - `failure()` is non-null and the phase is `reconstructing`.
  - `recover()` returns ready with the W4-C10 checkpoint.
  - An append after that lands in the new journal.
- [ ] **RED W4-C13, a crash between the two renames (a first compaction).** Throw at `carried-directory-fsync:after`, then run
  a fresh recovery.
  - It is ready. Every carried line is at or above J, matched byte for byte and skipped (`scanned` counts journal lines only).
  - The checkpoint is unchanged.
- [ ] **RED W4-C13b, the same crash in a second compaction.** Compact once, add three days of records, then compact again with a
  throw at `carried-directory-fsync:after`, and run a fresh recovery with the same SQLite.
  - It is ready. The re-carried old lines (below J) are accepted, and the new carries at or above J are matched and skipped.
  - The checkpoint equals the one before the second compaction.
  - The repair reports `prunedBelow` equal to the dropped old carried evidence rows, `wipedAll: false`.
- [ ] **RED W4-C14, serialization.**
  - Hold `journal-copy:before` on a promise, enqueue `applyAccepted` with one new event, then release.
    - The record is the last line of the NEW journal at sequence `head + 1`.
    - The chain from the journal's first record validates.
    - The append completed after `compactJournal` resolved.
  - Repeat with `recover()` in place of the append: it runs after the compaction and reads the compacted set as ready.
- [ ] **RED W4-C15, a short copy.** A port whose temp handle accepts n-1 bytes gives `short-copy`, a byte-identical journal, the
  temp file removed (listDir) and the applier still ready.
- [ ] **RED W4-C16, recovery's carried rules.** A carried line at or above J that equals the journal line at its sequence is
  skipped, and recovery is ready. Each of these refuses with its code: a carried line at or above J whose bytes differ from the
  journal line at its sequence (`carried-past-journal`), one whose sequence the journal never reaches (`carried-past-journal`),
  a descending carried line (`carried-order`), and a carried line below J past `applied` (`carried-past-applied`). A carried file
  with a torn tail refuses `torn-tail` (it is never healed).
- [ ] **Amend the pins.**
  - `delegation-wave3.integration.test.ts:1368`'s closed list gains `compactJournal`'s lines, each by method and regex: the
    journal read, the copy's `openRead`, the `rename` onto `journalPath`, the `removeTemp` of the two temps, and the writer
    reopen.
  - The "only the journal module and the applier name the file" check (`:1370-1371`) now covers `DELEGATION_CARRIED_FILE` too.
  - The row's title becomes "no journal rewrite except the tail heal and `compactJournal`".
  - The wave-3 plan's W3-M38 (plan :991) is to read: "Add a journal rewrite, truncate, rename or remove caller other than the
    tail heal and `compactJournal`, or drop a carry rule", with its rows this file and W4-C6..C8. PR3 does not edit the wave-3
    plan: it writes that text into its per-task note (`docs/superpowers/plans/<this plan's basename>/pr3.md`, a new file), and
    the coordinator folds it into the wave-3 plan in the wave's ledger pull request (Global Constraints, "Ledger edits").
  - Update the header of `delegation-journal.ts` (`:10-15`), which says no production caller rewrites the journal.
- [ ] **Mutation pins:**
  - W4-CM10: rename the journal before the carried file. W4-C13's sibling (a crash between the renames) refuses
    `held-evidence-missing` and must go red.
  - W4-CM11: drop the size check. W4-C15 must go red.
  - W4-CM12: prune `eventIds` before `journal-rename`. W4-C11 at `journal-rename:before` must go red (the size drops).
  - W4-CM13: skip the writer reopen. W4-C14 must go red (`writer-unusable`, or a write into the unlinked inode).
  - W4-CM14: treat a `journal-rename:after` fault as recoverable and stay ready. W4-C12 must go red.
  - W4-CM15: let recovery accept a carried line past `applied`. W4-C16 must go red.
  - W4-CM16: point `removeTemp` at the journal. The closed list must go red.
  - W4-CM35: skip the byte match of a carried line at or above J. W4-C16's mismatch row must go red.
  - W4-CM36: `memory-prune` keeps the builder's facts for cut records. W4-C10's builder-equality assertion must go red.
- [ ] **Green:**
  `cd server && RUN ./node_modules/.bin/vitest run test/delegation-compaction.test.ts test/delegation-recovery.test.ts test/delegation-wave3.integration.test.ts test/mail-routes.test.ts`.
- [ ] **Commit:** `feat(delegation): compact the journal behind S with a carried-record file (D-7000, D-6999, D-7021)`.

### Task 3.4: `delegation_events` retention, and a repair that deletes instead of wiping

**Files:**
- `server/src/coord/store.ts`: beside `delegationEventStats` (`:9424-9440`), at most +25 net code lines.
- `server/src/coord/delegation-checkpoint.ts`:
  - the port at `:1515-1545`;
  - `repairDelegationProjection` at `:1593-1682`, whose wipe is at `:1673-1680`;
  - `repairLocked` at `:2066-2075`, whose `journal: () => readDelegationJournalRecords(this.port, this.journalPath)` (`:2072`)
    becomes `journal: () => readDelegationRetainedRecords(this.port, this.carriedPath, this.journalPath)` (Task 3.3's one reader).
    Without it, every heal or wipe would delete the carried evidence rows and never replay them, the count would never match
    `evidence.total` again, and every forced full repair would wipe and replay the whole table.
- `server/src/watch.ts`: the production port at `:11017` and the timing wrapper at `:10715`, +4 lines.
- Tests: `server/test/delegation-compaction.test.ts`, and the closed list's `repairLocked` row in
  `server/test/delegation-wave3.integration.test.ts` (its `ALLOWED` regex is amended to the retained reader).

**Interfaces**
```ts
// CoordStore — indexed by the UNIQUE journalSequence (schema.ts:1591); one statement, one transaction each
countDelegationEventsAtOrBelow(sequence: number): number;
deleteDelegationEventsBetween(afterExclusive: number, throughInclusive: number, limit: number): number;   // rows deleted, <= limit
// DelegationProjectionPort gains: countEventsAtOrBelow, deleteEventsBetween (one CoordStore method each, as the four today)
// repairDelegationProjection input gains: retainedFrom: number | null  (the journal's first sequence; null = no journal)
// DelegationEvidenceCounts gains: sequencesAtOrBelow(sequence: number): readonly number[]   (the carried evidence sequences, which
//   bound step 0's gaps; small). Its existing countAtOrBelow (used by the repair today) answers step 0's count.
export const DELEGATION_EVENTS_DELETE_CHUNK = 5000;
```
**Retention.** At the `events-delete` edge, the compactor walks the gaps between `0`, each carried evidence sequence and `S`.
- In each gap it calls `deleteEventsBetween` in chunks of `DELEGATION_EVENTS_DELETE_CHUNK`, calling `yieldToEventLoop()` between
  chunks.
- A SQLite failure here marks `projectionStale` and warns. It does not fail the applier: the repair below finishes the job.

**The repair's new step 0**, before today's step 1:
- When `retainedFrom !== null` and `countEventsAtOrBelow(retainedFrom - 1) !== known.countAtOrBelow(retainedFrom - 1)`, delete
  SQLite's rows in the same gaps the same way, and count them in a new report field `prunedBelow`.
- Today's logic then runs unchanged. `wipedAll` stays the last resort for a real conflict.

Steps:
- [ ] **RED W4-C17.** After W4-C10's compaction, SQLite holds exactly the retained evidence: its count equals
  `evidence.total` and every row's sequence is either a carried evidence sequence or above S.
  - `eventsDeleted` equals the cut evidence count.
  - The test spies on `yieldToEventLoop` through the chunk size: with chunk 2 and 7 rows, it sees 4 calls.
- [ ] **RED W4-C18, a crash after the rename and before the delete.** Throw at `events-delete:before`, then
  `DelegationDurability.open` with the same SQLite.
  - The repair report has `wipedAll: false`, `fullReplay: false`, `journalPasses` ≤ 1 and `prunedBelow` = the cut evidence count.
  - SQLite equals W4-C17's state.
  - Red today: the count mismatch takes `:1648-1680` to a full replay and then a wipe.
- [ ] **RED W4-C19.** A carried evidence row is never deleted: after compaction and after a step-0 repair, its row is present.
- [ ] **RED W4-C30, heal and wipe after a compaction.** After W4-C10's compaction:
  - Mark one session that has carried evidence drifted and run a full repair: its carried rows are present afterwards, and the
    count equals `evidence.total`.
  - Force `wipedAll` (plant a conflicting row) and repair: afterwards the count equals `evidence.total`, every carried evidence
    row is present, and a second full repair reports `wipedAll: false` (a per-pass one reports `skipped`).
- [ ] **Mutation pins:**
  - W4-CM17: delete `<= S` without the carried gaps. W4-C19 must go red.
  - W4-CM18: remove step 0. W4-C18 must go red (`wipedAll`).
  - W4-CM19: no yield between chunks. W4-C17 must go red.
  - W4-CM34: the repair's `journal()` reads the journal alone (drop the carried stream). W4-C30 must go red.
- [ ] **Green:** `cd server && RUN ./node_modules/.bin/vitest run test/delegation-compaction.test.ts test/delegation-recovery.test.ts test/delegation-delta-applier.test.ts test/delegation-wave3.integration.test.ts`.
- [ ] **Commit:** `feat(delegation): retain delegation_events with the journal; repair deletes below the first retained record`.

### Task 3.5: C1, retiring ended activities behind the cut (D-7001, Q2)

**Files:** `server/src/coord/delegation-checkpoint.ts`, a builder door beside `retireZeroDeltaBash` (`:1144-1148`);
`server/src/coord/delegation-compaction.ts`; `server/test/delegation-compaction.test.ts`.

**Interfaces**
```ts
// builder: the second code that deletes from the mapping or the activities (the first is retireZeroDeltaBash, D-6268)
retireBehindCut(activityIds: readonly string[]): number;   // row, mapping entry, bashCalls fact and every workflowLaunches entry whose runEncoded it names leave together
```
**The predicate** is the planner's `retirable`, decided in `finish`. An activity is retirable only when ALL of these hold:
- `executionState === 'ended'`;
- no lease row names it, released or not;
- no lineage row names it, open or closed;
- its `identityJournalId` is in no hold;
- no retained record names its natural key, that is, every naming record is at or below S AND none is carried (D-7021);
- **a Workflow worker (`<runId>-<n>`) is retired only together with its run,** in the same `retireBehindCut` call and only when
  the run itself is retirable; and a run is never retired while a worker of it is kept. No journal record names a worker
  (`namedAgentsOf`, `delegation-checkpoint.ts:537-556`, notes `agent`, `workflow` and `bash-worktree` keys only): a worker is
  opened from a meta read while its run's key is mapped (`openWorkflowWorkerFromMeta`, `:1052`). So "no retained record names
  it" is always true for a worker, and retiring one alone would let the next rung-2 meta read reopen it with the same id,
  making the row leave and return (each time a full projection, `diffProjectionTable`).

The planner keeps a last-naming sequence only for the wanted set of ended, unnamed activities, so memory stays bounded.

**When it runs.** The door is applied by one `commitLocked` after `journal-directory-fsync`, so the records are already gone:
- A crash before that commit leaves the rows in a checkpoint whose journal no longer names them. That is valid, because O4 needs
  no hold for a mapped id.
- The next day's compaction retires them.
- Run it the other way round and a crash would leave a checkpoint without the activity while the journal still names it; recovery
  then refuses (`:860`).

Steps:
- [ ] **RED W4-C20.** On W4-C10's fixture, every ended agent and every Workflow run whose records all lie at or below S, none of
  them carried, is gone from rows and mapping. A fresh recovery is ready, and its checkpoint equals the live one byte for byte
  (nothing reopens).
- [ ] **RED W4-C21.** One table row each: an ended agent named by a K5-carried record, one named by a lease, one named by a
  lineage edge, one named by a record above S, an active one, and an ended Workflow worker whose run is kept (the run holds a
  lease). All are kept.
- [ ] **RED W4-C22.** A task notification for a retired run, arriving live after retirement, is ignored: the applier stays ready
  and nothing changes. After recovery the same holds.
- [ ] **Mutation pins:**
  - W4-CM20: retire an activity whose naming record is retained above S. W4-C20's recovery refuses `fold-refused` and must go red.
  - W4-CM21: ignore carried naming. W4-C21 must go red.
  - W4-CM22: keep the launch-index entry. W4-C22 must go red (`finds no run row`).
  - W4-CM23: run the retirement before `journal-rename`, with a fault at `journal-rename:before`. Recovery refuses, and that row
    must go red.
  - W4-CM33: retire an ended worker alone while its run is kept. W4-C21's worker row must go red, and a following meta read
    reopens the worker.
- [ ] **Green:** `cd server && RUN ./node_modules/.bin/vitest run test/delegation-compaction.test.ts test/delegation-recovery.test.ts`.
- [ ] **Commit:** `feat(delegation): retire ended activities behind the cut point (D-7001)`.

Sessions and attempts are not retired here: that narrowing of D-7001 is D-7024 (operator ruling 2026-10-26).

### Task 3.6: The snapshot helper for a compacted set

**Files:** `deploy/coordination-snapshot.mjs`: the names at `:56-75`, capture at `:655-760`, `validateSidecars` at `:612-627`,
restore and thin. Server side: `validateDelegationJournalBytes` at `delegation-journal.ts:555`, the differential's twin.
`server/test/coordination-snapshot.test.ts`.

**Claims and order.** Open #1578 changes both `deploy/coordination-snapshot.mjs` (including `thinBackups`) and
`server/test/coordination-snapshot.test.ts`, and another run holds claims on them until it lands. Start this task only after
#1578 merges, or with the claim holder's consent through the coordinator; check the open claims on both files first (worker
clause 11). After merging `main`, re-point every edit here by content (`SNAPSHOT_NAMES`, `RESTORE_SET`, the capture loop,
`thinBackups`), never by line.

**Changes**
- **Members.** `CARRIED_FILE = 'delegation-carried.log'` becomes an optional manifest member. It is additive under format
  version 1, and an absent member means none.
  - It joins `RESTORE_SET`.
  - It joins `SNAPSHOT_NAMES` (`thin` removes it, since it is the fifth name).
- **Capture.** Read the carried file before and after the journal copy, and require the two reads byte-equal; otherwise retry,
  exactly as the checkpoint A/B rule does. Validation feeds the carried lines first (skipping those at or above the journal's
  first sequence), then the journal.
- **Restore.** Restoring a snapshot without a carried member moves the live carried file to `RESTORE_FOREIGN_DIR`. It never
  deletes it.
- **The header's "unreachable in wave 3" note** about `suffixAfter` (`:14-16`) is rewritten: it is now reachable.

Steps:
- [ ] **RED W4-C23.** A compacted set captures and validates. Its manifest lists both files, and the coverage's first sequence is
  S+1. A differential row gives the server and the helper the same verdict and the same coverage.
- [ ] **RED W4-C24, `suffixAfter` reachable.** A journal whose first sequence is past `applied + 1` refuses `sequence-gap` in the
  helper and in recovery alike.
- [ ] **RED W4-C25, a capture racing compaction.** `hooks.afterJournalCopy` runs a compaction's two renames between attempts.
  Attempt 1 retries (the carried file moved), and attempt 2 captures a valid compacted set. No attempt writes a manifest for a
  mixed set.
- [ ] **RED W4-C26, a restore of a pre-compaction snapshot over a compacted live set.**
  - The live carried file goes to the foreign directory.
  - Recovery is ready, with the snapshot's checkpoint and the full journal.
  - Restoring a compacted snapshot places both files.
- [ ] **RED W4-C27.** An old manifest without the member still classifies as `v1`, and `thin` removes five names when the member
  exists.
- [ ] **Mutation pins:**
  - W4-CM24: capture reads the carried file once. W4-C25 must go red.
  - W4-CM25: restore leaves a stale carried file in place. W4-C26's recovery then still reads ready, so this mutant is NOT
    caught by recovery. The row asserts the foreign move by `listDir`; it must go red.
  - W4-CM26: the helper feeds carried lines at or above the journal's first sequence. W4-C23's differential must go red.
- [ ] **Green:** `cd server && RUN ./node_modules/.bin/vitest run test/coordination-snapshot.test.ts test/ccrc-update-flip-backups.test.ts test/ccrc-update-phases.test.ts`.
  There is no `test/ccrc-update.test.ts`; check that vitest's summary counts three files.
- [ ] **Commit:** `feat(coordination-snapshot): capture, validate and restore a compacted journal and its carried records`.

### Task 3.7: The lane's daily trigger, the slow-line keys and the docs

**Files:**
- `server/src/watch.ts`: a `compact` phase after `prune` (`:11241-11243`), and `DELEGATION_PASS_SLOW_KEYS` at `:10061-10075`.
- `server/test/delegation-watch.test.ts` and `server/test/delegation-pass-timing.test.ts`.
- Spec §5.12 (`:546`): the retention line becomes 10 days per D-7000, and the carried file and K-rules are added, along with the
  D-7001 retirement.

**Trigger.** At most once per UTC day, with the day spent before the attempt (N6):
- if the pass was not aborted and `durable.pruningEnabled()`, call
  `durable.compactJournal(pass.now, DELEGATION_RETENTION_FLOOR_MS)` (armed on landing, D-7022: no marker);
- a rejection is one warn line, `ccrc-server: delegation compaction failed: …`.
- A `compacted` outcome writes one line: `ccrc-server: delegation compaction: cut <n> records (<bytes>) through <S>, limited by
  <limit>; first retained <S+1> accepted <iso>; carried <n> (<bytes>) by reason <reason=n,…>; carried file <bytes> in <lines>
  lines; events deleted <n>; activities retired <n>; <ms> ms`.
- A `skipped` outcome with `below-share` or `nothing-to-cut` writes one line too:
  `ccrc-server: delegation compaction: skipped (<reason> <share>%); first record accepted <iso>; carried file <bytes> in <lines> lines`,
  so the journal's span and the carried file's size are readable every day from the log alone (the Gate's "reported beside").

**Slow-line keys.**
- The phase `compact` goes after `prune`.
- The sizes `cutRecords`, `cutBytes`, `carried`, `carriedBytes`, `eventsCut` and `rowsRetired` go after `cpCandidates`. They
  appear only on a pass that compacted.
- R1 and R22 are amended.

Steps:
- [ ] **RED W4-C28.**
  - Two passes on one UTC day make one `compactJournal` call. A pass on the next day makes another.
  - A reconstructing applier makes none.
  - A rejected compaction is not retried that day.
- [ ] **RED W4-C29.** The compacting pass's line carries the new keys, each equal to the outcome's own counts. A non-compacting
  pass carries none of them (R1's key set is exactly what ran). The compaction line's `first retained` instant equals the
  `acceptedAt` of record S+1, and a `below-share` skip writes its skip line with the journal's first record's `acceptedAt`.
- [ ] **Mutation pins:**
  - W4-CM27: no day gate. W4-C28 must go red.
  - W4-CM28: call while reconstructing. W4-C28 must go red.
- [ ] **Green:** `cd server && RUN ./node_modules/.bin/vitest run test/delegation-watch.test.ts test/delegation-pass-timing.test.ts`.
- [ ] **Commit:** `feat(delegation): daily journal compaction in the lane, and its slow-line keys`.

### PR3 at its tip

**Suites to run alone** (one at a time, under `RUN`, in the foreground, with a timeout of at least 600000 ms):
- `delegation-compaction`, `delegation-recovery`, `delegation-watch`, `delegation-pass-timing`,
  `delegation-wave3.integration`, `coordination-snapshot`, `delegation-delta-applier`, `ccrc-update-flip-backups`,
  `ccrc-update-phases`, `mail-routes`, `single-definition` (a directory), `growth-check`;
- the full `test/rings*` set;
- then the `pwa` suite untouched, as a sanity check that nothing in `shared/` moved.

**Growth check (40 net code lines per listed file):**
- `server/src/watch.ts`: about -10 lines from Task 3.1 (three upkeep blocks become one door call) and about +20 from Tasks 3.4
  and 3.7, so the net is about +10.
- `server/src/coord/store.ts`: about +20.
- None of it is inside #1558's hunks (main's lines about 9985-9990, 10266-10321 and 11445-11705; Global Constraints).
  The lines PR3 touches, at main's coordinates, are 10061-10075, 10715, 11017 and 11218-11310.
- `delegation-compaction.ts` is new under `server/src/coord/`.

**Review focus: the inputs most likely to break it.**
1. A crash between the two renames, and a capture between them (W4-C13, W4-C25).
2. A Bash pair that straddles S, and a K5 window edge that splits a pair (W4-C8).
3. A retired run whose task notification arrives late (W4-C22), and an activity named only by a carried record (W4-C21).
4. A repair after a crash that lands between the rename and the SQLite delete: it must delete, never wipe (W4-C18); and a
   heal or wipe after a compaction must replay the carried evidence (W4-C30).
5. An append or a recovery queued during a compaction (W4-C14).

**Non-regression, reported beside wave 4's gate** (not a gate condition; the Gate section):
- **The wave-3 health metric** must stay at `stageGate: 'eligible'`, that is, `unmeasuredRate` below 1%. That metric is
  `delegationObservationHealthOf(...).unmeasuredRate` (`delegation-model.ts:1550-1557`), read from `/api/fleet/health`'s
  `delegation`, unmeasured session-hours over the seven-day window. Also require `recoveryPhase: 'ready'`.
- **The daily line's `ms`.** A compaction blocks the queue for its full duration. This is estimated at well under a minute for
  10 days of journal, but it has not been measured. Report the first compaction's `ms`.
- **If one compaction cuts more than one pass** (at the 45 s budget), moving the plan stream out of the queue is the rider's
  work.

**What PR3 must NOT do:**
- touch the hook, the spool or ccd;
- change the journal's record grammar or add an entry kind;
- change `DELEGATION_DURABILITY_EDGES`' existing members or their order;
- add a lease release or a lineage close;
- retire sessions or attempts (D-7024);
- add an arming marker or switch for compaction (D-7022: armed on landing);
- read or write any live file under `~/.ccrc`;
- edit lines inside #1558's hunks;
- add a second interval finder;
- vacuum `coord.db`;
- run Workflow fan-outs;
- merge before the soak gate.

PR3-adjacent carries are listed in "## Rider".

**Unverified (marked for the worker):**
- the exact hit counts in Task 3.1;
- that no test counts the `upkeep` phase's commits;
- the timing-wrapper line (`watch.ts:10715`) as the only second port site;
- the helper's line ranges for restore and thin;
- the compaction's queue block on a real-size journal.

## PR4: Hook and ccd hygiene

**Goal.** Close five small fleet-side defects before wave 5 depends on the spool. Two hook guards can drop a line when
a sibling creates the file between their two reads. Four `delegation-watch` rows time out at 20 s under load. Nothing
warns when a home raises Claude Code's Bash ceiling, which rung 4's margin assumes. The installer drops a foreign
command that shares a hook group with ccrc's. Nothing removes a departed owner's spool directory.

**Branch.** A workspace branch cut from `main` at `ccba6f9b6` or later. After #1558 merges, merge `main` in (never a
rebase), and re-run the suites named at the end of this section. The PR body's first line reads (one line, verbatim):

`Held: not to merge before the delegation broker's soak gate (2026-10-31T09:00Z), by the operator's ruling.`

**Files.** `ccd/session-hook.sh`, `ccd/ccd`, `ccd/contexts.tsv`, `ccd/contexts-edges.tsv`,
`ccd/install-session-hooks.sh`, `ccd/ccrc-doctor-checks` (Task 4.5b only) and `README.md` (prose only). Test files: `server/test/delegation-spool.test.ts`, `server/test/session-hook.test.ts` (appended at the end
only), `server/test/delegation-watch.test.ts`, `server/test/install-session-hooks.test.ts`,
`server/test/ccrc-doctor-codex.test.ts`, `server/test/delegation-wave3.integration.test.ts`. New:
`server/test/hookGuardSeam.ts` and `server/test/ccd-delegation-spool-prune.test.ts`. No file under `server/src`,
`shared/` or `pwa/` changes.

**Rulings implemented.**
- The absent-owner spool prune (operator, 2026-10-14). It removes `$REG/delegation/spool/<id>/` only when the owner's
  registry row is gone and the directory's newest bucket is more than 24 hours old. Neither the hook nor the server
  deletes it (ledger, "Wave 4 owns the absent-owner spool prune").
- The installer fix, option B (operator, 2026-10-15). A per-hook sweep removes only ccrc's own command and keeps a
  backup (ledger, the 2026-10-15 rulings entry).
- The soak constraints: this PR is built now and held. It implements none of D-6999..D-7002 directly; D-7002's reshape
  leaves its scope unchanged. Rung 4's margin stays a code constant; this PR only warns.

**D-numbers.** D-7017, D-7018, D-7019 and D-7020 are this PR's. Each is `unused` until the worker defines an actual
departure, in the ledger's format (`- **D-n** — \`slug\` (context): text`), in a new per-task note
`docs/superpowers/plans/<this plan's basename>/pr4.md`, and mails the coordinator, who folds it into "## Deviations found" in
the wave's ledger pull request (Global Constraints, "Ledger edits"). Adding that note is not an edit of a plan.

**Claims and order.** Tasks 4.1 to 4.5a can start now. Task 4.5b edits `ccd/ccrc-doctor-checks`, which another run
claims until #1578 lands, so start it only after #1578 merges. Before every task, check the open claims on its files
as worker clause 11 asks. No growth-listed `server/` file changes, but `ccd/ccd` and `ccd/session-hook.sh` are on the
growth list (`server/test/growth-check.test.ts`, `GROWTH_FILES`, limit `GROWTH_LIMIT = 40` net code lines per file).

**Build constraints (the soak).** Run every suite through the plan's `RUN` gate (Global Constraints), that is, under
`systemd-run --user --scope -p MemoryMax=4G nice -n 19 ionice -c3 …`. Start one only while the 1-minute load is 40.0 or
less and available memory is at least 4000 MB. Run one subagent at a time, with no Workflow fan-out. Use fixture
HOMEs only (`makeCcdHarness`, and the fixture homes the hook suites already build). Never read the live
`~/.cc-sessions/delegation` tree, `~/.ccrc/coord.db`, or any journal or checkpoint. Added lines carry no numeric
line citation (`server/test/citations.test.ts`, D-5893): code and comments cite symbols, for example
`session-hook.sh#_hook_spool_append`.

### Task 4.1: The hook's append guards refuse only a positive non-regular type

**Files.**
- `ccd/session-hook.sh`: the guard in `_hook_spool_append` (origin/main :3644), and the guard in `_hook_history_scope`
  (:5451). Both read `[[ ! -L "$f" && ( -f "$f" || ! -e "$f" ) ]]`. The positive form to copy is
  `_hook_join_record`'s (:3385). The comment blocks above each function (:3627 header, :5418-5439) are edited too.
- New `server/test/hookGuardSeam.ts`. Rows go in `server/test/delegation-spool.test.ts`, in the describe "append: one
  complete line per write" (:1488; the sixteen-hooks row is :1496), and in a new top-level describe appended at the
  very end of `server/test/session-hook.test.ts`. That file's history describe (:10172) says it is appended to,
  never inserted into, because a citation census cites it by line.

**Why it can lose a line.** D-5434 measured this guard shape: 315 refusals in 127k checks. A first writer reads `-f`
false (no bucket yet). A sibling's `>>` then creates the bucket, so the writer's `-e` now reads true and `! -e` is
false: both arms of `( -f || ! -e )` have failed, and the guard returns 1, and the caller's `|| true` hides it (the call site is
column-0 top-level code at :3650). D-5434 fixed `_hook_join_record` only. Its plan entry names these two functions as
"Not fixed, the same shape" and sends them here.

**Interfaces.**

```ts
// server/test/hookGuardSeam.ts — L4 test support, one definition for both suites.
/** A copy of the session hook in `dir`, with ONE line changed: the first code line after `${fn}() {` that tests
 *  `-L "$${v}"`. Every `"$${v}"` operand on that line becomes `"$(_w4_seam "$${v}")"`. `reads` is the number of
 *  operands rewritten. Throws if the line is not found, or if `reads < 2` (the seam would prove nothing). */
export function seamHook(dir: string, fn: string, v: string): { file: string; reads: number };
/** A BASH_ENV file that defines `_w4_seam`. Each call counts itself in `$HOME/w4-seam-n`. On call number `at` it
 *  creates (`: >> "$1"`) or removes (`rm -f -- "$1"`) the path, then prints the path. */
export function seamEnv(home: string, at: number, move: 'create' | 'remove'): Record<string, string>;
```

The seam is deterministic because bash expands each operand of `[[ ]]` only when that operand is evaluated, left
to right with short-circuit. This was checked with bash 5.2: three `$(…)` operands in main's guard run three times,
in order. The side effect of the seam's command substitution (creating or removing the file) lands between two
reads. No sleep or race is involved, and nothing in the shipped hook changes.

- [ ] **Step 1: RED row W4-H1**, in the append describe: "a bucket created between any two of the guard's reads is
  still appended to (D-5434's race, made deterministic)". For each `k` in `1..reads`, with the owner directory present
  and the bucket absent: run `seamHook(home, '_hook_spool_append', 'f')` with `seamEnv(home, k, 'create')` on
  `pre('Agent', {}, \`toolu_c${k}\`)`. Assert that exactly one line in the bucket carries that `toolUseId`, that the
  bucket is a regular file, and that `$HOME/w4-seam-n` reads at least `k`, so the seam fired. Reset the counter and
  the bucket between iterations. At main, `reads` is 3, and `k = 3` leaves an empty bucket with no line: RED.
- [ ] **Step 2: RED row W4-H2**: "a bucket removed between any two reads is still appended to". The bucket is planted
  first with one real line (a plain `run`). Then use `seamEnv(home, k, 'remove')` for each `k`, and assert that the
  new `toolUseId` is present. At main this is green; it is the mirror race D-5434's review found. It goes red under
  W4-HM2 (below).
- [ ] **Step 3: RED row W4-H3**, a source pin modelled on D-5434's row (`session-hook-turnmark.test.ts:1434`),
  run for `_hook_spool_append`/`$f`. The guard line contains `return 1`. It contains each of `-L`, `-d`, `-p`, `-S`,
  `-b` and `-c` applied to `"$f"`. It holds no `-f "$f"`, no `! -e "$f"`, and no negated type test
  (`/! -[LdpSbc] "\$f"/`). And no code line between the opening and the `>> "$f"` append holds `-f "$f"` or
  `! -e "$f"`. RED at main.
- [ ] **Step 4: RED row W4-H4**: "a FIFO at the bucket's name is never opened: the hook exits 0 within its bound,
  writes nothing, and the FIFO is still a FIFO". `mkfifo` at the current bucket's name. `spawnSync` with a 10 s
  timeout; assert `signal` is null, `status` is 0, and `lstat(...).isFIFO()`. No FIFO row exists for the spool today:
  `mkfifo` appears nowhere in `delegation-spool.test.ts`. Green at main, because main's `-f || ! -e` already refuses
  a FIFO. It exists to pin the `-p` term (W4-HM3).
- [ ] **Step 5: RED rows W4-H6 and W4-H7**, appended at the end of `session-hook.test.ts`: W4-H1's create arm and
  W4-H3's pin, run for `_hook_history_scope`/`$f` with that function's `return 0`. The pin takes its write operator as a
  parameter: `>>` for `_hook_spool_append`, `>` for `_hook_history_scope` (which truncates: `printf … > "$f"`), and it
  throws when it does not find the guard line or the write line, as `seamHook` does, so it can never pass vacuously. The run is a main-thread PreCompact
  with `scope/` planted and `compact-card-off`, as the describe at :10183 builds it. The marker must read
  `main <psid> <ms>` for every `k`. The new describe defines its own small helpers from the module-level fixture
  (`home`, `hookEnv`, `plantSession`, `preCompact`, `tl`, `HISTORY_HOOK_SCRUB`) and adds no import line. RED at main
  for `k = 3`. The existing FIFO row (:10432) already pins the scope guard's `-p`.
- [ ] **Step 6: Run RED.**
  `cd server && RUN ./node_modules/.bin/vitest run test/delegation-spool.test.ts -t 'append'` and
  `RUN ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'W4-H'`. Expected: W4-H1 `k=3`, W4-H3, W4-H6 `k=3`
  and W4-H7 are red, and the rest are green.
- [ ] **Step 7: Implement.** Replace each guard with D-5434's positive form, and keep each function's return value:

```bash
  # (in _hook_spool_append)
  if [[ -L "$f" || -d "$f" || -p "$f" || -S "$f" || -b "$f" || -c "$f" ]]; then return 1; fi
  # (in _hook_history_scope)
  if [[ -L "$f" || -d "$f" || -p "$f" || -S "$f" || -b "$f" || -c "$f" ]]; then return 0; fi
```

  `[[ -e "$f" ]] || fresh=1` stays as it is: it decides only whether to prune, never whether to append. Rewrite both
  comment blocks to cite D-5434's reasoning by symbol (`_hook_join_record`). Leave the two `$jp` rotation guards in
  `_hook_join_record` (:3395, :3415) alone. Their refusal only skips a rotation, which is the safe direction, and
  D-5434 kept them. Do not touch the generated helpers region (its header comment, around :34-36): no restamp is
  needed.
- [ ] **Step 8: GREEN.** Re-run Step 6's commands, then the fork-count rows that must not move:
  `RUN ./node_modules/.bin/vitest run test/delegation-spool.test.ts -t 'forks nothing'` and
  `RUN ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'D-6929'`. The new guard uses only builtins.
- [ ] **Step 9: Commit** `fix(hook): the spool and scope appends refuse only a positive non-regular type (D-5434's form)`
  with the attribution trailer.

**Mutation pins** (whole-file edits, one at a time, each restored from a saved copy and checked by sha):
- **W4-HM1**: put main's two-read guard back in `_hook_spool_append`. W4-H1 (`k=3`) and W4-H3 go red.
- **W4-HM2**: reorder the guard to `[[ ! -L "$f" && ( ! -e "$f" || -f "$f" ) ]]`. W4-H2 and W4-H3 go red.
- **W4-HM3**: drop `-p "$f"`. W4-H4 goes red (the hook blocks until it is killed) and so does W4-H3.
- **W4-HM4**: drop `-L "$f"`. The existing row "a symlink or directory standing at the bucket's name…" (:1543) goes red,
  and so does W4-H3.
- **W4-HM5**: drop `-d "$f"`. Only W4-H3 goes red, because `>>` onto a directory fails anyway (as D-5434 recorded).
- **W4-HM6**: main's guard back in `_hook_history_scope`. W4-H6 (`k=3`) and W4-H7 go red.
- **W4-HM7**: drop `-p` from the scope guard. The existing scope FIFO row (:10432) goes red.

### Task 4.2: The sixteen-hooks row tells an identity skip from a lost append

**Files.** `server/test/delegation-spool.test.ts` (:1496, and the two "do not interleave" rows below it at :1510 and
:1521, which show the same "one line short" symptom as wave 4's carried item C5). `server/test/hookGuardSeam.ts`
gains the probe.

**Interfaces.**

```ts
/** A BASH_ENV file whose top-level DEBUG trap (no functrace, so it fires only for top-level commands) appends
 *  "$W4_TAG" to $HOME/w4-reached when $BASH_COMMAND is exactly `_hook_spool_append`. $? is preserved. */
export function reachProbe(home: string): string;
export type AppendFate = 'appended' | 'lost-append' | 'identity-skip';
/** For each tag: 'appended' if a line carries it; else 'lost-append' if it reached the call; else 'identity-skip'
 *  (the event ended before the spool call: D-4662's silent exits, the bounded tmux lookup included). */
export function fates(tags: string[], present: Set<string>, reached: Set<string>): Map<string, AppendFate>;
```

- [ ] **Step 1: RED control rows W4-H5a and W4-H5b** (single runs, no concurrency). W4-H5a: a directory planted at
  the current bucket's name gives the fate `lost-append`, because the call was reached and nothing was written.
  W4-H5b: a stub `tmux` that prints nothing (the identity lookup fails) gives `identity-skip`. Both are RED until the
  probe exists.
- [ ] **Step 2: Rework the concurrent rows.** Each racer gets `{ BASH_ENV: reachProbe(home), W4_TAG: <toolUseId> }`.
  Before the count assertion, compute `fates`. Assert first:
  `expect(lost, 'a hook reached the spool append and wrote nothing: a lost append').toEqual([])`, and then
  `expect(skipped, 'an event ended before the spool call (identity or parse, D-4662): not this guard').toEqual([])`.
  Keep the count, validity and uniqueness assertions after them, unchanged. Nothing is loosened: a red now names its
  cause.
- [ ] **Step 3: GREEN.** `cd server && RUN ./node_modules/.bin/vitest run test/delegation-spool.test.ts -t 'append'`.
- [ ] **Step 4: Commit** `test(spool): name a missing concurrent line as a lost append or an identity skip`.

**Mutation pin W4-HM8.** Swap the two branches in `fates` (reached to `identity-skip`). W4-H5a and W4-H5b go red.

### Task 4.3: The four slow `delegation-watch` rows get a per-test bound

**Files.** `server/test/delegation-watch.test.ts`: "R88 through X1, measured" (:4007), "R104" (:4028), "R103" (:4038),
and "R89: a pass cut before it reaches an owner it listed" (:4089). `server/vitest.config.ts:87` sets `testTimeout` to
20 000 on Linux. Only these four rows' bounds change (the lean scope); R111's fixed 20 ms wait (carried item C3) and any
`CLAUDE.md` load-flake sentence are the rider's.

- [ ] **Step 1: Measure first.** Run each of the four rows alone, three times, under the scope above. Record each wall
  time in the commit message. A bound is not a guard, so there is no RED row. The evidence is these measurements.
- [ ] **Step 2: Lift the bound.** Add one file-level constant, `const LOAD_ROW_MS = 120_000;`, and pass it as the
  third argument of the four `it(...)` calls. If the worst measured time times 4 exceeds 120 s, raise the constant
  and say why. Do not touch `vitest.config.ts`.
- [ ] **Step 3: GREEN.** `cd server && RUN ./node_modules/.bin/vitest run test/delegation-watch.test.ts -t 'R88|R89|R103|R104'`.
- [ ] **Step 4: Commit** `test(delegation-watch): a load-sized bound for the four rows that ran past 20 s`.

Conflict note: #1558 changes this file at three places: the no-op-skip row near :668, the R90 describe near :4720
("R90 (W3, coordinator 5512)…"), and an appended D-6967 block after :5358. This task's edits touch only the closing lines
of the four rows above, none of those. When main is merged in after #1558, re-point by content.

### Task 4.4: The absent-owner spool prune, an arm of ccd's spawn-time spool step

**Where it lives.** It is neither a new ccd verb nor a timer. It is an arm of the one place ccd already handles the
spool root: `_spawn_start`'s call `_delegation_spool_dir "$id" || true` (`ccd/ccd`, origin/main :24725; the function
is at :24054, and its header at :24037-24053 says "NOTHING PURGES IT in this wave").

| Option | Why not |
|---|---|
| A new `ccd` verb with a timer | It adds a unit, a schedule and a cleanup verb that a session could run. That verb would have to join `FORBIDDEN_CCD_VERBS` and `childDenyRules`. |
| An arm of `ccd-tmp-sweep` | That sweep is rooted in the per-uid temp directory, exits when that root is absent, and its record is read by the server's `tmpSweepLane`. Another concern in it would break its single responsibility. |
| **The spawn arm (chosen)** | Owner directories are created only at a spawn, so pruning at a spawn bounds their number. There is no new verb, unit or schedule, and no server change. |

Because no verb exists, nothing is added to any forbidden list. A session can trigger the arm only by spawning, which
it can already do. The arm removes only what the ruling allows.

**Files.**
- `ccd/ccd`: two new functions placed after `_delegation_spool_dir`, one call line in `_spawn_start`, and the
  rewritten header sentence.
- `ccd/contexts.tsv`: a row for each new function, `C5`, beside `_delegation_spool_dir` (:403).
- `ccd/contexts-edges.tsv`: the edge `_spawn_start -> _delegation_spool_prune_absent`, beside :149.
- New `server/test/ccd-delegation-spool-prune.test.ts`, on `makeCcdHarness` with the spawn substrate of
  `delegation-spool.test.ts` (:275-300: a recording `tmux`, `seed`, `spawn1`).

**Interfaces.**

```bash
DSP_PRUNE_MAX=8   # owner directories removed per spawn, at most; the rest wait for the next spawn
_delegation_spool_prune_absent() {   # <spawning id> -> rc 0 always; removes up to DSP_PRUNE_MAX absent owners' spool dirs
_dsp_old_absent() {   # <id> <dir> <cutoff YYYYMMDDHH> <now s> -> 0 iff the owner's row is gone and the dir holds only
                      #   regular <10 digits>.spool buckets, each older than the cutoff by name and 24 h by mtime; sets DSP_OLD=(paths)
```

**The rule, which every arm keeps.** A directory goes only if all of these hold:
1. `$REG` is a readable, searchable directory, and neither `$REG/delegation` nor the spool root is a link. Otherwise
   the whole arm returns at once: an unreadable registry never reads as "absent".
2. The id is in the spawn grammar (`^[A-Za-z0-9][A-Za-z0-9._-]*$`) and is not the spawning id.
3. **The registry row is gone**: no entry matches `$REG/<id>.*`, of any type. Any field still standing means a present
   owner: one partly purged, or an orphaned `joined` field. A dotted sibling id (`<id>.x`) also matches the glob. All of
   these err toward keeping the directory.
4. Every entry in the directory is a regular, non-link file named `<10 digits>.spool`. The newest bucket's name is
   older than the cutoff, which is the UTC hour of now minus 24 h, compared the way the hook's `_hook_spool_prune`
   compares (`10#$b < 10#$cut`). Its mtime is also 24 h old or more. A directory with no buckets goes only when its
   own mtime is 24 h old. Any other entry (a foreign file, a subdirectory, a link) keeps the directory.
5. Rename, then check again. Rename the directory to `$root/.prune.<id>.$$` (`_plat_mv_notdir`). Run rules 3 and 4
   again on the renamed directory. If either now fails, move it back when `<id>` is absent, or leave it and stop.
   Then `rm -f --` each listed bucket by name, and `rmdir --` the renamed directory. Nothing is removed through a
   variable with `-r`. A `rmdir` that fails leaves the renamed directory for the next spawn.
6. The next spawn handles a leftover `.prune.<id>.<pid>` directory under the same rules, taking the id from its name.
   A dot-leading name can never be an owner: `_delegation_spool_dir` refuses dot-leading ids.

The clock is `_now_s_to` (ccd's seam: the suites stub a `date` function). The cutoff is
`TZ=UTC0 printf -v cut '%(%Y%m%d%H)T' "$((now - 86400))"`. Mtimes come from one `_plat_mtime` call per directory
over all its buckets (one fork per directory, not one per bucket). Not verified: that `%()T` is in every bash that
ccd supports on macOS. If it is not, use the UTC formatter ccd already has.

The window that remains, stated in the header: a purged id is respawned between the rename and the move back. That
session's hook skips the events of that instant, and the census backstops them. The doctor's existing WARN (b) for a
running session with no spool directory reports it if the move back failed.

- [ ] **Step 1: RED rows** in the new file. Each plants the spool root through one real spawn of a different id.
  Bucket names are relative to `Date.now()`, and mtimes are set with `fs.utimesSync`.
  - W4-S1: the row is present (only `$REG/<id>.generation` stands) and the newest bucket is 48 h old. The directory is
    kept, byte for byte.
  - W4-S2: the row is gone, and the newest bucket is 23 h old by name and mtime. Kept.
  - W4-S3: the row is gone, and the bucket is 48 h old by name but its mtime is 1 h old. Kept.
  - W4-S4: the row is gone, the buckets are old, and there is one foreign file (`notes.txt`), or a subdirectory, or a
    link. Kept, and the link's target is untouched.
  - W4-S5: the owner directory is a link to a directory of old buckets. Kept, and the target is untouched.
  - W4-S6: two arms. (a) The registry directory is searchable but not readable (mode 0300, so `$REG/<id>.*` cannot be
    globbed; skipped as root), with an eligible old directory planted: nothing is removed, and the spawn returns rc 0.
    (b) The spool root is a link to a directory holding an eligible old absent-owner directory: nothing under the link's
    target is removed, and the spawn returns rc 0 (`_delegation_spool_dir` itself refuses a linked root and warns, so the
    spawn's own directory is not made; the row does not assert it).
  - W4-S7, the positive row: the row is gone, and every bucket is 25 h or more old by name and mtime. The directory is
    gone. A present owner's sibling directory and the spawning id's own directory are untouched.
  - W4-S8, the race: the snippet redefines `_plat_mv_notdir` after ccd is sourced, to run the real one and then
    `_reg_set <id> uuid …`. The directory is back under `<id>` with all its buckets.
  - W4-S9, the late append: the shadow adds a fresh bucket into the renamed directory. The directory is back, and
    nothing is deleted.
  - W4-S10: twelve eligible directories go eight at the first spawn and four at the next one.
  - W4-S11: a leftover `.prune.<id>.123` holding old buckets, with the row gone, is removed at the next spawn. With the
    row present, it is moved back to `<id>`.
  - W4-S12: every row's spawn reports `[rc=0]`, and the prune prints nothing on stdout.
- [ ] **Step 2: Run RED.** `cd server && RUN ./node_modules/.bin/vitest run test/ccd-delegation-spool-prune.test.ts`.
  Expected: W4-S7, S10 and S11 are red, because nothing prunes yet. The keep rows are green.
- [ ] **Step 3: Implement** in at most 34 net code lines of `ccd/ccd` (the growth check counts code lines, not
  comments). Use `local LC_ALL=C`, builtin globs with `nullglob`/`dotglob` saved and restored as
  `_hook_spool_listing` does, and every failure folded to `return 0` at the call (`… || true`). Rewrite the header
  sentence "NOTHING PURGES IT in this wave" to state the rule above and its window.
- [ ] **Step 4: Census rows.** Add the `contexts.tsv` rows and the edge. Run
  `RUN ./node_modules/.bin/vitest run test/ccd-contexts.test.ts test/macos-platform.test.ts test/ccd-spawn-split.test.ts test/delegation-spool.test.ts -t 'ccd makes'`.
  Then grep `server/test` for suites that count `_spawn_start`'s commands or forks (`ccd-cold-start-substrate`,
  `ccd-spawn-*`, `ccd-child-tmpdir`) and run each one alone.
- [ ] **Step 5: GREEN**, Step 2's command. Then run `test/growth-check.test.ts` and `test/citations.test.ts`, each under `RUN`.
- [ ] **Step 6: Commit** `feat(ccd): a spawn prunes absent owners' spool directories past their day of ingestion (ruling 2026-10-14)`.

**Mutation pins.**
- **W4-SM1**: delete the row test (rule 3). W4-S1 goes red.
- **W4-SM2**: delete the name test. W4-S2 goes red.
- **W4-SM3**: delete the mtime test. W4-S3 goes red.
- **W4-SM4**: accept any entry. W4-S4 goes red.
- **W4-SM5**: drop `! -L` on the owner directory. W4-S5 goes red.
- **W4-SM6**: drop the registry readability test. W4-S6's unreadable arm goes red.
- **W4-SM7**: skip the check after the rename. W4-S8 and W4-S9 go red.
- **W4-SM8**: ignore `DSP_PRUNE_MAX`. W4-S10 goes red.
- **W4-SM9**: drop the arm's link test on the spool root. W4-S6 (b) goes red (the target's old directory is removed).
- **W4-SM10**: the arm prints its count on stdout. W4-S12 goes red. (A dropped `|| true` at the call is not a mutant the
  rows can see: `ccd` runs with `set -uo pipefail` and no errexit, and `_spawn_start` never reads that call's rc.)

### Task 4.5a: The installer's per-hook sweep (option B)

**Files.** `ccd/install-session-hooks.sh`: `JQ_UNMANAGED` (origin/main :104), which `JQ_PROGRAM` (:105) and
`JQ_REMOVE` (:117) share, and the backup at :147. The rows go in `server/test/install-session-hooks.test.ts`.
`ccd/ccrc-doctor-checks` is not touched in this task.

**Interfaces.** `JQ_UNMANAGED` stays the one definition of "ccrc's entry" for install and `--remove`:

```jq
def own: type == "object" and ((.command // "") | tostring | contains("/session-hook.sh"));
def unmanaged: map(if type == "object" and any((.hooks // [])[]?; own)
                   then (.hooks |= map(select(own | not))) | select((.hooks | length) > 0)
                   else . end);
```

A group that held only ccrc's hook goes, as it does today. A group that mixed ccrc's hook with a foreign command keeps
its `matcher`, its other keys and the foreign hooks, in their order. A foreign group with an empty `hooks` list is
kept, because only a group this sweep emptied is dropped. A non-object hook is foreign and is kept. Today
`.command` on a string makes jq fail ("merge failed"), so this is more tolerant.

- [ ] **Step 1: RED rows.**
  - W4-I1: a `PreToolUse` group `{matcher:"Bash", hooks:[<foreign>, <ccrc>]}` and a `Stop` group
    `{hooks:[<ccrc>, <foreign>]}`. After a run, each event keeps a group holding exactly the foreign hook, with its
    matcher, and also has the one fresh managed group. Today the foreign hook is dropped: RED.
  - W4-I2: the same file under `--remove` keeps both foreign hooks in their groups. RED today.
  - W4-I3: a foreign group with `hooks: []` survives byte-identically (`jq -S` equal). Green today; it pins the
    "only a group this sweep emptied" clause.
  - W4-I4: W4-I1's run leaves `ccrc-backups/<ts>/<home>.settings.json` byte-identical to the before-file. Green
    today; it pins the backup that option B requires.
  - W4-I5: a second run is a no-op, and the file's mtime and bytes are unchanged (the idempotence the converge check
    keeps).
- [ ] **Step 2: Run RED.** `cd server && RUN ./node_modules/.bin/vitest run test/install-session-hooks.test.ts`.
- [ ] **Step 3: Implement** the predicate. Rewrite the comment above it to say "per hook, not per entry (option B,
  2026-10-15)".
- [ ] **Step 4: GREEN**, the same command, plus `test/install-census.test.ts` and
  `test/delegation-wave3.integration.test.ts`.
- [ ] **Step 5: Commit** `fix(installer): sweep ccrc's own hook command, never a foreign one sharing its group (option B)`.

**Mutation pins.**
- **W4-IM1**: main's `unmanaged`. W4-I1 and W4-I2 go red.
- **W4-IM2**: `select((.hooks|length) > 0)` applied to every group. W4-I3 goes red.
- **W4-IM3**: delete the `cp -a` backup line. W4-I4 goes red.

### Task 4.5b: Doctor — lift R55's refusal, and warn on a raised Bash ceiling (after #1578 merges)

**Files.**
- `ccd/ccrc-doctor-checks`: `_check_delegation-hooks` (origin/main :9423; its jq read starts at :9496; its verdicts are
  :9604-9660), `_dh_mixed_events` and `_fix_delegation-hooks` (:9682-9728), and the header (:9354-9405).
- `server/test/ccrc-doctor-codex.test.ts`: the describe "ccrc doctor: delegation-hooks" (:3255; the R55 rows are
  :3256, :3789 and :3971-4053).
- `server/test/delegation-wave3.integration.test.ts` (:1625).

**Why here.** `_check_delegation-hooks` already reads every rostered home's `settings.json` once with jq and never
prints it. The ceiling WARN is another output of that one read, not a second reader. `BASH_MAX_TIMEOUT_MS` is
named in `DELEGATION_EVIDENCE_MARGIN_MS`'s comment (`server/src/coord/delegation-correlation.ts:956`): the 20-minute
margin assumes Claude Code's 10-minute ceiling.

**Interfaces.**
- The jq program gains one output kind, `TIMEOUT\t<key>`. It is emitted once for each of `BASH_MAX_TIMEOUT_MS` and
  `BASH_DEFAULT_TIMEOUT_MS` that is present in `.[0].env` (an object), with a value that is neither null nor `""`.
- The check gains a `timeout_set=()` list and a WARN (d):
  `"<n> rostered home(s) set Claude Code's Bash timeout in settings.json env: <id>: <KEY>[, <KEY>]; …"`. Its remedy:
  `"remove the key from that home's env: the delegation broker's rung-4 margin (twenty minutes) assumes Claude Code's ten-minute Bash ceiling, so a raised ceiling can let rung 4 link a tree to the wrong session; raising the margin is a code change"`.
  Only key names and home ids are printed, never a value: an `env` block can hold a token.
- What it does not measure (stated in the header): a project's own `.claude/settings.json`, and the environment ccd
  spawns sessions with.

- [ ] **Step 1: RED rows.**
  - W4-D1: a home whose `env.BASH_MAX_TIMEOUT_MS` is `"1800000"` gets `WARN delegation-hooks:` naming the home and
    the key, with rc 2 and no PASS line.
  - W4-D2: the same for `BASH_DEFAULT_TIMEOUT_MS`, and both keys in one home give one line naming both.
  - W4-D3: the value (`1800000`, or a planted token-shaped string) appears on no output line.
  - W4-D4: an `env` that is not an object, or a key set to `""`, gives no TIMEOUT WARN, and the PASS line is unchanged.
  - W4-D5: the R55 rows flip. A home whose entry mixes ccrc's hook with a foreign command, under `Stop`, under
    `WorktreeCreate`, and under N4's object shapes, is now handed to the installer. The foreign command is still in
    the file afterwards, a backup exists, and the `FIX delegation-hooks: refused —` line is gone. The own-hook FAIL's
    remedy (:3256's row) no longer says that the sweep drops the whole entry.
- [ ] **Step 2: Run RED.** `cd server && RUN ./node_modules/.bin/vitest run test/ccrc-doctor-codex.test.ts -t 'delegation-hooks'`.
- [ ] **Step 3: Implement.** Add the TIMEOUT emit and the WARN (d), printed after (c), FAIL lines first as today.
  Delete `_dh_mixed_events` and the refusal block in `_fix_delegation-hooks`, because the installer from Task 4.5a now
  keeps foreign commands. Rewrite the R55 paragraph and the own-hook FAIL remedy to match. Then
  `grep -rn 'ccrc-doctor-checks:[0-9]'` across the tree (9 hits on origin/main), and re-point by symbol any citation
  of a line below the edit.
- [ ] **Step 4: GREEN**, the same command, then `test/delegation-wave3.integration.test.ts`,
  `test/docs-parity.test.ts`, `test/macos-platform.test.ts` and `test/citations.test.ts`.
- [ ] **Step 5: Commit** `feat(doctor): warn on a raised Bash ceiling, and let --fix keep a foreign hook (option B)`.

**Mutation pins.**
- **W4-DM1**: delete the TIMEOUT emit. W4-D1 and W4-D2 go red.
- **W4-DM2**: print `<KEY>=<value>`. W4-D3 goes red.
- **W4-DM3**: `_dr_fail` in place of `_dr_warn`. W4-D1 goes red (it asserts the WARN class and rc 2).
- **W4-DM4**: restore the R55 refusal. W4-D5 goes red.

### Task 4.6: Words

- [ ] Update `README.md`'s delegation spool text. Today it says a removed owner's directory keeps its last buckets;
  it should state the prune's rule, where it runs (at a spawn), and its window. Also give the installer's per-hook
  sweep and the new WARN. Run `test/docs-parity.test.ts` and `test/citations.test.ts`.
- [ ] Commit `docs: the absent-owner spool prune, the per-hook sweep, and the Bash-ceiling WARN`.

### PR4 at its tip

**Suites to run alone**, one at a time, each as `cd server && RUN ./node_modules/.bin/vitest run test/<name>.test.ts`, in the foreground with a timeout of 600 000 ms or more:
`delegation-spool`, `session-hook` (long), `session-hook-turnmark`, `hook-helpers-generated`,
`ccd-delegation-spool-prune`, `ccd-contexts`, `ccd-spawn-split`, `ccd-child-tmpdir`, `ccd-cold-start-substrate`,
`ccd-lifecycle-purge`, `install-session-hooks`, `install-census`, `ccrc-doctor-codex`,
`delegation-wave3.integration`, `delegation-watch`, `macos-platform`, `growth-check`, `citations`, `docs-parity`
and `single-definition`. Known load flakes from CLAUDE.md's list (for example `session-hook`) are re-run alone before
a red is called real.

**Growth check.** No change to `server/src/watch.ts` or `server/src/coord/store.ts`. `ccd/session-hook.sh` is at
about +0 net code lines (two guard lines replaced in place). `ccd/ccd` is at 40 net code lines or fewer (the budget
is 34). `ccd/ccrc` is untouched. No waiver file is added.

**Rollout order.** The fleet box first. Everything this PR ships runs there: the hook, ccd, the installer and the
doctor. `ccrc rollout --to <tag>` keeps its default order (fleet box, then server box). The server box gets only the
new tree and has no behaviour change. On the fleet box, `ccrc update` re-runs the installer into every home, with a
backup of each changed `settings.json`. The first prune happens at the first spawn after the update. The operator
reads the result, never the worker.

**Review focus.**
1. Registry rows that are partly present: a purge in progress, an orphaned `joined`, a dotted sibling id, and an
   unreadable `$REG`. Each must keep the directory (rule 3).
2. A purged id respawned during a prune: the rename, the check again, and the move back (W4-S8 and W4-S9).
3. Hook groups of odd shapes under install and `--remove`: object-shaped `hooks`, non-object hooks, empty foreign
   groups, and matchers. Is the converge still byte-idempotent?
4. The seam rewrites exactly the guard line, and the rows prove it fired (`reads >= 2`, and the counter reads at
   least `k`). A later refactor that moves the guard must turn the helper red, never leave it vacuously green.
5. The doctor never prints an `env` value, and the WARN never hides a FAIL.

**This PR must NOT:**
- change `server/src`, `shared/` or `pwa/`, the wire, or a capability word;
- add a ccd verb, a timer, a unit, or an entry in a forbidden or deny list;
- delete anything outside `$REG/delegation/spool/`, or any directory whose owner's registry row stands;
- delete any bucket that is less than 24 h old by name or by mtime;
- touch the generated helpers region of `session-hook.sh`;
- fix D-4662's silent whole-event exits, or register `PostToolUseFailure` (both go to the rider);
- edit the programme ledger or an existing plan (its per-task note is a new file);
- merge before the soak gate, or rebase.

PR4's carries are listed in "## Rider".

## Rider (deferred past wave 4)

Listed here, not planned: a later rider plan takes these after wave 4's gate, and nothing here is built in wave 4. Labels (A1, B1, D8 and so on) are the carried-items census's.

**Follow-up 10's review carries.** All need #1558's code on `main`; they go in one lane-fix PR after it lands, since all touch `watch.ts` and `delegation-watch.test.ts`.
- A1, review 976 F3: two batches staged under one `settledKey` (`observeHour`, then `noteGap`). The code exists only on #1558's branch.
- A2, review 976 F6: a third interval finder (`hoursOf`'s closed-row find and `gateOf` remain beside `laneIntervalOf`). It needs #1558's `laneIntervalOf`.
- A3, review 976 F7: whether the row near `delegation-watch.test.ts:666`, now capability-absent, still reds `intervalMoves`' clause. Unverified until mutants run on merged code.
- A4, the precise R106 narrowing. #1558 reverted a wait-only narrowing and recorded the residue as "a delay, never a link"; medium size, and no wrong link results.
- A5, review 994 F2: no row pins R106's close-read exit arm (`recorded >= laneCloseAt`). A test-only gap.

**Coordinator and operator decisions.**
- D8, the conditional late-return arm: deferred by the coordinator; the operator places it.
- B1, the null repository after a restart (`sessionProject` is filled only from live records): deferred, because it only errs toward `unmeasured`.
- D3, Q-W4, attributing main checkouts: off by ruling (D-6999) until the operator has seen how many raw rows the label produces. Turning it on widens rung 4's reach.
- D2's identification gaps 1, 3 and 4 (a lease keeps no lost-evidence context; hook-level drops and spool-less sessions leave no trace; the listed common dir is not recorded): D-6999's ±20-minute windows close gap 2 only, and the rest need new journal or hook fields.
- D18, a lease release for a reused raw path: wave 5's. Wave 4 only displays the conflict.

**Frame and rows (from PR1 and PR2).**
- The durable `unknown` writer for stale active activities: PR1 only displays `stale`, and a writer is a durable change wave 4 does not make.
- `native-removed` lineage closure: it needs a new journal entry kind and a loosened `assertWave3Lease`.
- A store read of runs by `sessionId`, in place of PR1's bounded read of the newest 200 closed runs: the bound narrows "lineage outlives its run" for a worker whose last run is older.
- Unowned rows for trees that filed no attempt: today such a tree appears only in the health counts.
- Narrowing K5's carried window by repository: it needs the lane's session-to-repository memory and each call's listed repository injected into the planner (PR3, Q1).
- Folding PR1's copied test rig into one helper shared with `delegation-watch.test.ts`: after #1558.
- Placing on a card an activity whose parent the fleet does not carry: the wire gives an activity no project (PR2, Task 2.5).

**Journal, checkpoint and lane (from PR3 and the census).**
- Retiring sessions and attempts behind S: D-7001's remaining rows; attempts feed PR1's unowned rows. Deferred by D-7024.
- Planning the cut outside the applier's queue: only if one compaction blocks for longer than a pass.
- Segment files (design B), and delta checkpoint writes (C3).
- B6, the O5 group: the per-record fsync, the canonical encode, the no-op compare's two encodes for appends, and bounded owner reads. The fsync order is the operator's to rule.
- A statfs preflight before the compaction's copy.
- B2, building the index and the held/lost split once per pass: about 4 ms per census tree, performance only.
- B4, review 642 F1-F4 on the pass-line formatter: not individually verified.
- D5, mark liveness and counting: marks clear only on a restart, and the rest depends on compaction having landed.
- D6, listing the spool root: only `ownerDir(id)` exists.
- D19, an agent-side realpath for the projects root: the remote `realpath()` returns null, so `projectsRoot` is unmeasured on every pass.
- C4, the D-6168 pre-BEGIN helper: due when the projection code next changes.

**Hook, ccd and installer (from PR4 and the census).**
- C3, R111's fixed 20 ms real-time wait in `delegation-watch.test.ts` (await the released cut pass's promise if the row holds one), and a `CLAUDE.md` load-flake sentence naming R111's shape: outside the lean scope's four rows (Task 4.3).
- D9, D-4662's silent whole-event exits: PR4 only names them (Task 4.2).
- D15, registering `PostToolUseFailure`: a new ingest variant, model and correlation work, hook and installer changes, and a re-capture per Claude Code version.
- D17, the listing shed on large repositories: measure first, by counting `truncated:true` lines read-only, before deciding on a fix.
- D12, hook presence as a measured input (incarnation-absent owners).
- D7, `prune_backups` full keep sets: the update mechanism's owner, not a delegation concern.
- A lifecycle-manifest row for the spool root: `shared/lifecycle.ts` holds none.
- D20, the `$paid` versus join carry; the other leftovers of reviews 578, M6, 583 and 600/617 are unverified.

**Tests and wording only.**
- B3, MC3 / D-5642 (7): no row exists; it would cost about 0.05 s a pass.
- B5, a row for a sampler restart after close (review 677 F13).
- B8, review 769 F1, F2 and F4-F7: stale "declared equivalent" comments, and a fold-alloc row.
- B9, review 770 F1-F3: a percentage in the comment of a row that is now performance-only.
- D16, review B-F3: rows X2 and X4 lack a count assertion.

**Recorded, owing no work** (listed for completeness): B10 (a refused collapse is retried each pass, by design), B11 (the `(id,null)` last reason, recorded as the safe direction), B12 (D-6471's mutant wording in the wave-3 plan), C1 (fixed by #1534) and C2 (fixed by #1206).

**Carried items wave 4 does take:** A6 and D10 (Task 4.1), C5 (Task 4.2), B13 (Task 4.3), D13 (Task 4.4), D14 (Task 4.5a), D11 (Task 4.5b), A7 (Task 3.1), B7, B14 and D4 (Tasks 3.2 to 3.7), and D1 (D-6999: Tasks 1.2, 2.2 and 2.7).

## Deviations found

The allocator issued the contiguous block D-6999..D-7022 to this wave, and D-7023..D-7024 for two further rulings. D-6999..D-7002 and D-7021..D-7024 are the operator's rulings of 2026-10-26, defined at planning time. Every other number stays `unused` until a worker defines an actual departure from this plan, in its per-task note: PR1 D-7003..D-7006, PR2 D-7007..D-7010, PR3 D-7011..D-7016, PR4 D-7017..D-7020, each range wholly its worker's. Each worker takes its numbers in order and records any it does not use as unused; no number is repurposed.

- **D-6999** — `rung-4-leases-shown-inferred-never-auto-adopted` (operator ruling 2026-10-26; spec §5.6, §5.14): a lease whose `sourceKind` is `raw` (rung 4) is displayed nested under its linked session, marked "inferred" with the creating Bash call's `toolUseId`, for soak-era and later leases alike, with no date cut-off and no policy switch. It is never adopted automatically in wave 5; the operator attaches one with a tap (spec §5.14, resolve attach). Spec §5.6's "a rung-4 (raw) lease is adopted when linked" is amended accordingly. Q-W4 (attributing main checkouts) stays off in wave 4. Compaction keeps every journal record within ±20 minutes of each raw lease on its repository, for re-audit (identification gap 2). Implemented by PR1 Task 1.2, PR2 Tasks 2.2 and 2.7, and PR3 Task 3.2 (rule K5). Implementation note (confirmed by the operator on 2026-10-26, D-7023): a programme worker's raw lease is nested by R9 under the top coordinator with `via` naming the linked worker, since nesting it under the worker would draw it at depth 2 (W4-P15); a raw lease whose tree also has a `conflicting` attempt keeps its nested inferred row beside the tree's unowned row (W4-P12); a raw lease with no activity row anchors K5's window on its own `firstObservedAt` (W4-C7b); and K5 is met across all repositories, a superset of "on its repository", because the planner cannot see a window's repository.
- **D-7000** — `journal-retention-floor-is-ten-days` (operator ruling 2026-10-26; spec §5.12): the journal's retention floor is 10 days, not the spec's proposed 30. It remains above the lane's evidence horizon (192 h of interval retention plus the 20-minute margin), which PR3 Task 3.2's W4-C4b pins. Implemented by PR3.
- **D-7001** — `checkpoint-bounded-by-retiring-ended-rows-behind-the-cut` (operator ruling 2026-10-26; wave-3 decision O4, beyond D-6268): the checkpoint is bounded by retiring ended rows behind the compaction cut point S. A row is retired only when every journal record naming it is at or below S and no lease, lineage edge or hold names it. Implemented by PR3 Task 3.5 for ended activities and their mappings (a Workflow worker only with its run); the deferral of sessions and attempts to the rider is D-7024.
- **D-7002** — `programme-reshaped-waves-6-7-dropped` (operator ruling 2026-10-26; spec §5.8, §7): waves 6 and 7 (lease audit and clean, spec stages 5 and 6) are dropped. The orphan-tree lane (#1252) owns cleanup of these trees and must skip an adopted lease, which wave 5 builds. Wave 4's gate is 2 days with no displayed row the operator flags as wrong; wave 5's gate is 3 days. The frame's `backlog` member is dropped, because it could only read 0.
- **D-7003** — `unused`
- **D-7004** — `unused`
- **D-7005** — `unused`
- **D-7006** — `unused`
- **D-7007** — `unused`
- **D-7008** — `unused`
- **D-7009** — `unused`
- **D-7010** — `unused`
- **D-7011** — `unused`
- **D-7012** — `unused`
- **D-7013** — `unused`
- **D-7014** — `unused`
- **D-7015** — `unused`
- **D-7016** — `unused`
- **D-7017** — `unused`
- **D-7018** — `unused`
- **D-7019** — `unused`
- **D-7020** — `unused`
- **D-7021** — `carried-record-compaction-and-retained-c1-predicate` (operator ruling 2026-10-26; programme ledger: a second durable file and journal compaction are the operator's): on `main` leases are never released, so their holds are permanent and a pure prefix cut frees nearly nothing. The cut point S is set by the 10-day floor and the checkpoint anchor only, and every record at or below S that a carry rule (K1-K6, PR3 Task 3.2) still needs is copied verbatim into a second durable file, `delegation-carried.log`, read before the journal by one reader of the retained set. C1 (D-7001) then retires a row only when no RETAINED record (carried or above S) names it, and drops a retired run's Workflow launch-index entry with it.
- **D-7022** — `compaction-armed-on-landing` (operator ruling 2026-10-26, against the coordinator's proposal of a marker; O3 snapshot contents are the operator's): PR3 ships armed. The daily compaction runs from the first ready pass after the build is live, with no marker or switch. A rollback past PR3 after a compaction leaves the delegation lane `reconstructing` until a pre-compaction snapshot is restored, which discards what the lane recorded since that snapshot; the snapshot `ccrc update` takes before installing PR3 is the restore point. The operator accepted that cost; PR3's body and the release's notes state it.
- **D-7023** — `delegation-frame-shape` (operator ruling 2026-10-26; spec §5.8): the frame departs from §5.8's `{type:'delegation', activities, lineage, backlog}` as PR1's "Shape decisions" state: no `lineage` member (each lease carries its display parent); `leases`, `unowned` and `asOf` members; unowned rows carry the `unresolved` and `conflicting` verdicts only, because R59 and R84 keep unmeasured work out of the unowned group (it stays in the health's counts); `bash-worktree` activities are never rows; a lease whose workspace is measured `absent` is not a row. D-6999's implementation note (R9 `via` nesting of a programme worker's raw lease; a raw lease row kept beside its tree's unowned row on a conflict) is accepted with it.
- **D-7024** — `c1-retires-ended-activities-only` (operator ruling 2026-10-26; narrows D-7001 for wave 4): C1 retires ended activities and their mappings only (a Workflow worker only with its run). Sessions and attempts are not retired in wave 4: attempts feed PR1's unowned rows, so retiring them would change what the gate's rows show. They go to the rider.
