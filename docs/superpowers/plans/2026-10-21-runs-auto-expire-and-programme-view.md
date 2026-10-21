# Runs close themselves, and the runs page becomes a programme view: W0 to W5 — Implementation Plan

> **For agentic workers:** one PR per task, in the order of §Landing order, each dispatched only when its row in §Gates is all green. To execute a task, REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Steps use checkbox (`- [ ]`) syntax. Workers do not edit §Deviations and decisions. A departure is named by slug in the task's report; the coordinator enters it from this plan's issued block (§Deviations), never the worker. Workers never touch the fleet box or the controller box: every box reading, and every marker that arms a lane row, is an operator act (§Operator acts).

**Spec:** `docs/superpowers/specs/2026-10-20-runs-auto-expire-and-programme-view-design.md` (rev 2, ruled). §3.1 (the rows, rules R1 to R8, the warning, what the close records, what it must never do, telling the coordinator), §3.2 (the card, the counts, the header, the doors, every width), §3.3 (the wire), §3.4 (observability), §4 (one owner per job), §5 (the waves), §6.1 (the decision log) and §7 bind every task. Read them before Step 0.

**Status:** rev 0 (2026-10-21). Written after the operator ruled every decision of the spec's §6 on 2026-10-21, verbatim: "Accept all recommended (Recommended)" (spec §6.1). The rulings this plan carries: **G1 (a)** 72 h of programme quiet, the warning at 48 h (W1); **G2 (a)** a recorded removal 1 h, a person's stop 24 h, a stop by a swap, a supervisor, an OOM policy or maintenance, or hibernation, never; an absent claimant with no lifecycle history listed under needs you and never closed (W2); **G3 (a)** 24 h after the worker reads dead with no activity, from the #119 heartbeat (W5); **G4 (a)** shadow for 3 days, then the operator creates each group's marker after reading its would-close list, three markers (OA-M1 to OA-M3); **G5 (a)** manual Abandon stays under Advanced, on open rows only, with "ccrc would close this itself <when>", plus "Close anyway" as a needs-you door for unpushed commits under a gone coordinator (W0, W3, W4); **G6 (a)** `/runs` lands on the programme list, and a programme with no open run sits in a collapsed Finished group for 7 days, then only in the ledger (W3).

**Inputs.** The operator's ruling of 2026-10-20 ("Auto-expire + programme view (Recommended)", quoted in the spec's head), which supersedes for E1 to E5 only the fleet-capacity spec's no-auto-close sentences (§3.1's retirement paragraph, §3.4, R11) and the durability tail's rejected alternative (b). The dead-coordinator lane and its departures (`deadCoordinatorCrash`, `deadCoordinatorBreaker`, the gap rule, OA-D6's marker). D-5828 (`runBelongsTo`). D-5545 (a card is a glance, its header a superset). D-5587, D-5588, D-5589, D-5592 and D-5650 (the skins W3 runs tasks). D-6088 (the fleet rollup: an unanswered operator question is never hidden). D-6091 and D-6092 (finished workers, `failed` ones included, sleep at run close). D-5855, D-5856 (`SWITCHES`, `readSwitches`), D-5857 to D-5859 (the `notify` funnel, its writer set pinned at two), D-5863 (`readRegistryMeasured` on mail ingress). D-5915 (the worker heartbeat, mail-and-run P1f). D-5921 (the drift decider). D-282 (the Abandon door stays ungated).

**Base:** `origin/main` `d8cd47658` (2026-10-21). Code is cited by file and by function, constant, type or `describe` title, never by line number. Step 0 of each task re-grounds every citation by content on the tree it starts from.

**Symbols measured at the base.** Present:
- the lane: `deadCoordinatorCrash`, `DEAD_COORDINATOR_DELIBERATE_ACTS`, `DEAD_COORDINATOR_AFTER_MS` (1 h), `DEAD_COORDINATOR_GAP_MS` (10 min), `DEAD_COORDINATOR_BREAKER_WINDOW_MS`, `deadCoordinatorBreaker` (its `fleetDoubt` argument), `deadAnchorNext`, `deadCoordinatorAttention`, `CLAIMANT_CHANGED`, `SWEEP_FLEET_ACTS` in `server/src/deadCoordinator.ts`; `stillCrashed`, `endDeadCoordinator`, `deadCoordinatorLaneArmed`, `recordDeadCoordinatorFeed` in `server/src/coord/endDeadCoordinator.ts`; `sweepDeadCoordinators` in `server/src/watch.ts`; `dead_claimants` in `server/src/coord/schema.ts` and `server/src/coord/store.ts`;
- the close: `CloseCause` (`'coordinator' | 'operator' | 'sweep'`), `SweepCloseGuard` (`claimedBy`, `stillCrashed`), `closeRun`'s guarded `'sweep'` overload, `abandonMove`, `handOffChildReclaim` in `server/src/coord/close.ts`; `expectClaimedBy` in `close.ts` and `store.ts`;
- the verdicts: `ClaimantVerdict` and `claimantMeasuredDead` in `server/src/coord/reclaim.ts`;
- drift (DT1, #884): `driftFindings`, `DriftRunRow`, `RUN_QUIET_MS` (72 h), the `run-quiet`, `claimant-gone` and `review-waiting` findings, and the store's `lastClaimantMailAt` read, in `server/src/coord/drift.ts`;
- mail and pushes: `insertSystemMailTx`, `queueStallNotice`, `queueSystemMail`, `cancelOutstandingDeliveries`, `MAIL_RUN_CLOSED_ERROR`, `requeueAbandonedMail`, `MAIL_MAX_ATTEMPTS`; `admitWake`, `WAKE_BURST`, `WAKE_WINDOW_MS` (`server/src/coord/wakeBudget.ts`), `MAIL_WAKE_FLOOR_MS`; `FleetWatcher`'s private `pushNewMail` and `pushNewRuns`, and its `recordOnly` push mode; `sweepStalls`, `sweepBriefs`, `sweepDigest`;
- the funnel and switches (consolidation W1a): `notify`, `NOTICE_MODES` (`push`, `record-always`, `record-only`) in `server/src/notice.ts`; `SWITCHES`, `SWITCH_OWNER_MAP`, `readSwitches`, `COORDINATOR_PAUSE_MARKER`, `DEAD_COORDINATOR_LANE_LIVE_MARKER` (owner `C5`) in `shared/switches.ts`;
- dispatch: `dispatchRun`, `markDispatchStarted`, `capsMeasured`, `readRegistryMeasured` (`server/src/coord/dispatch.ts`); `holdAndBindSession` and `openRun`'s route in `server/src/coord/routes.ts`; `CCD_ARGV.prStateSession` in `server/src/ccdargv.ts`; `ACTIVE_RUN_STATES`, `IDLE_RUN_STATES`, `RunSummary` (with `programTitle`, `claimedBy`, `openedAt`, `dispatchStartedAt`, `dispatchedAt`, `closedAt`, `kind`, `reviews`) in `shared/api.ts`; `runEvents` in the store; `MIGRATIONS` in `schema.ts`;
- the PWA: `RunsScreen`, `RunRow` (its name cell `run.workspace ?? run.branch ?? String(run.id)`; its `abandonButton` on every row; `aria-label` "Abandon run <id>"), `runsByProgram` and the group head printing the slug in `RunsScreen`; `RUN_GROUP` (`'needs' | 'running' | 'finished'`, `awaiting-review` → `needs`), `groupRuns`, `NeedsRow` in `pwa/src/fleet/runGroups.ts` (no consumer outside `pwa/test/run-groups.test.ts`); `programWave`, `programmeWave` (it prints `r.program`, the **slug**), `programmeWaveTail`, `runBelongsTo`, `isRunClosed`, `waveLabel`, `SPAWN_STALL_MS` in `pwa/src/fleet/runWords.ts`; `operatorAsk` (`s.bucket === 'attention'`) in `pwa/src/fleet/rollup.ts`; `sessionFacts` (`needsYou: !dead && session.bucket === 'attention' && !heldAsk`); `inboxTarget` (its run kinds answer `{ kind: 'runs', path: '/runs' }`); `useColdRuns`; `AbandonSheet`, `abandonChildOf`, `ResumeSheet`, `CapsControl`, `ChildReclaimBanner`, `CoordBanner`, `DeadCoordinatorAttention`, `AttentionList`; `useFolded` (`pwa/src/fleet/foldState.ts`); the session header's "Open the run board" links (`SessionMeta`, `SessionDetails`'s `CoordLink`), both to `/runs`; `FleetScreen`'s runs line ("Runs · <runsLabel>"); the `runs` row of `pwa/src/lib/routes.ts` (`/^\/runs\/?$/`).

**Absent at the base:** `sweepDrift` and `drift_findings` (durability tail DT2), `LANE_SCHEDULE` and `runLane` (consolidation W1b C1h), `dedupeKey` (W1a C1f), `changeLatch`, `FleetReadModel`, `ccdCan`, `decideRetire` and `AttentionRow` (consolidation K1), `SessionReading` (K3), `workerLastSeen` and `workerTurn` (mail-and-run P1f, D-5915), `programmeSpread` (fleet-operations FP9), any maintenance switch or `ccd maintenance` verb (fleet-operations FM1, FM3), `lastDispatchAttemptAt`, `programmeCurrentWave`, `usePrograms`, `GET /api/programs`, a `Stepper` primitive in `ui/src/primitives`, `RunsList`, `RunsColumn` and any list column (skins W3 P1a).

**Also measured, because the tasks depend on it.**
- **#435 merged** at the base as session continuity wave 4b. Its body names no refusal of release, reap or purge while an open run binds the workspace id, and no slug picker skip; `ccd/ccd` carries neither. The reused-name root fix is still unbuilt, so R1 and E5 are needed as specced.
- **Capacity W1-1 and W1-1b merged** (#1024, D-6091; #1048, D-6092): a worker whose run closes `done` or `failed` sleeps about 10 minutes after close through the `run-done` policy. A lane close therefore needs no sleep act of its own; its worker sleeps by that policy.
- **The fleet rollup merged** (#984, D-6088): `operatorAsk` is `bucket === 'attention'`, and the server files a held ask outside `attention` (the rollup module's head comment), so `operatorAsk` already excludes an ask the coordinator holds. `sessionFacts`' `needsYou` adds `!dead` and `!heldAsk` on top.
- **Skins W3 P5a merged** (#712, #727, D-5587, D-5650); P5 (D-5588), P6 (D-5589), P9 (D-5592) and P1a (D-5581) have no PR.

**Deploy class.** W0, W4: **PWA lane only** (no server byte). W1, W2 and W5: **server lane**, plus the move of `runBelongsTo` to `shared/` in W1 (the PWA re-imports it, one import line, byte-for-byte the same behaviour); each adds coord.db `MIGRATIONS` entries that are additive (new tables, nullable columns). W3: server lane (its first commit, the read and the optional fields) and then PWA lane, server deployed first. No task touches `ccd/`, `agent/` or `deploy/`, adds a restart, or bumps `FLEET_PROTO`.

**Names.** This plan's tasks are **W0** to **W5**, the spec's §5 waves. Another plan's wave is always qualified: capacity W1-3, consolidation W1b C1h, skins W3 P5, durability tail DT2, mail-and-run P1f, fleet-operations FM10. The run-close rows keep the spec's names (E1, E1r, E2, E3, E3s, E4, E5). Operator acts are **OA-R0** to **OA-R4** (readings) and **OA-M1** to **OA-M3** (the three markers).

**Goal, PR by PR.**

| After | The operator sees | Underneath |
|---|---|---|
| `main` | a ledger of run rows by slug, a run number on rows with no workspace, Abandon on every row (finished ones included) | nothing ever closes a `planned` run; the dead-coordinator lane counts crashes only and is shadow |
| W0 | each row named programme · wave, the head the programme's title, Abandon only on open rows | PWA only; `RUN_GROUP` files `awaiting-review` as waiting |
| W1 | (shadow) "would close" feed rows for never-started waves; then, armed, a warning to the coordinator at 48 h and a close at 72 h, told to the coordinator | the run-close lane: rules R1 to R8, rows E1 and E1r, `lastDispatchAttemptAt`, the `untold` rows and the notice drain, record-only pushes |
| W2 | (shadow, then armed) a programme whose coordinator was archived or removed closes after 1 h, one stopped by a person after 24 h; refused closes listed with a push | rows E3, E3s and E5, per-row breakers, the heir drain on Resume, `refusedClose?` on the run summary |
| W3 | `/runs` is a programme list: "programme A · wave 3 of 5", wave counts, needs you, "closes in <when>", a programme screen with its doors, a Finished group | `GET /api/programs`, three optional `RunSummary` fields, `usePrograms`, the stepper |
| W4 | the run ledger behind "Advanced"; Abandon says when ccrc would close the run itself | `/runs/ledger`; Resume, `CapsControl`, `ChildReclaimBanner` and the lane's counters move there |
| W5 | (shadow, then armed) a run whose worker is gone a day closes itself | rows E2 and E4 over the #119 heartbeat |

---

## Gates: what each task waits for, stated honestly

Measured on 2026-10-21 at `d8cd47658` with `gh pr list -R Synapsium-Labs/ccrc-pwa --state open --json number,title,headRefName,files` (29 open PRs) and `gh pr diff <n>` for each PR that holds a file this plan edits.

**The PRs the orchestrator named, measured.**
- **Skins W3 P5, P6, P9: no PR.** P5a merged (#712, #727). No branch, no open PR, and no `Stepper`, `RunsList` or list column on main. Their disposition is §Deviations' "Absorbed and re-scoped" list: W3 supersedes P5's board and builds its stepper under D-5588's ink rules; W0 supersedes P6's run-row half (D-5589's rule, the run number only in the controls' accessible names and the row's title); P9 is re-scoped to place W3's programme list and programme screen in Instrument's columns and still waits for P1a. No screen is built twice: W3 builds each component once, and P9 places it.
- **Capacity W1-2, W1-3, W1-4, W1-4b, W1-5: no PR.** W1-1 and W1-1b merged. W1-3's stale-run filter (`capsMeasured`) and W5's E4 read one session reading and keep their two predicates (spec §4); W1-4 stamps `admissionWaitSince` and `lastRefusedAt` on cap refusals in `dispatchRun`, and W1 here stamps `lastDispatchAttemptAt` on every dispatch answer: the two series share `coord/dispatch.ts`, `coord/store.ts` and `MIGRATIONS` (rule 6, and the next free `MIGRATIONS` slot measured at Step 0 and again before merge).
- **Consolidation W1b: C1i merged** (#1041, D-5863). **C1g, C1h, C1j, C1k, C1l: no PR.** The lane keeps its cadence (every registry pass, as `sweepDeadCoordinators` runs today); if C1h lands first, the lane's one `LANE_SCHEDULE` row is that cadence and no task adds a second clock. C1j's `FleetReadModel` and C1k's `ccdCan` edit `watch.ts` and `dispatch.ts`: rule 6.
- **Durability tail DT2: no PR.** DT1 merged (#884). W1 moves drift's `run-quiet` and `claimant-gone` predicates into the run-close lane's L1 module (spec §3.1, "one owner"), and `driftFindings` imports them, so its suite stays green byte-for-byte. If DT2 opens first, its lane reads the predicates through `driftFindings` as today and is unaffected; its `watch.ts` hunks and W1's stay line-disjoint (rule 6), or the later one waits.

**Open PRs that hold a file this plan edits.**
- **#1054** (named workspaces) holds `server/src/watch.ts` (one hunk inside `FleetWatcher`, an added block in the workspace-naming area, far from `sweepDeadCoordinators`, `pushNewMail` and `pushNewRuns`), `pwa/src/lib/api.ts` (four hunks adding its own client calls inside `createApi`) and `pwa/src/screens/FleetScreen.tsx` (one hunk). W1, W2 and W5 re-measure `watch.ts`; W3 re-measures `api.ts` (its `programs()` call is a new method beside them) and `FleetScreen.tsx`.
- **#960** (skins W2 S2c, the fleet pieces both shells place) holds `pwa/src/screens/FleetScreen.tsx` with hunks near the runs line. W3's runs-line edit waits for #960 or stays line-disjoint.
- **#1010** (history wave 5h-2) holds `server/test/single-definition.test.ts` (two edits in the history blocks). W1's appended block is line-disjoint.
- **No open PR** holds `server/src/deadCoordinator.ts`, `server/src/coord/endDeadCoordinator.ts`, `server/src/coord/close.ts`, `server/src/coord/drift.ts`, `server/src/coord/store.ts`, `server/src/coord/schema.ts`, `server/src/coord/dispatch.ts`, `server/src/coord/reclaim.ts`, `server/src/coord/routes.ts`, `server/src/notice.ts`, `shared/api.ts`, `shared/switches.ts`, `pwa/src/screens/RunsScreen.tsx`, `pwa/src/screens/RunRow.tsx`, `pwa/src/fleet/runGroups.ts`, `pwa/src/fleet/runWords.ts`, `pwa/src/fleet/AbandonSheet.tsx`, `pwa/src/fleet/ResumeSheet.tsx`, `pwa/src/fleet/inboxTarget.ts`, `pwa/src/lib/routes.ts` or `ui/src/primitives`.

**Planned work with no PR yet that will hold the same files** (each task's Step 0 re-runs `gh pr list` and keeps its hunks line-disjoint from any such PR, or waits for it):
- **Mail and run truth P1e, P1f, P1g** (`store.ts`, migrations, `watch.ts`'s `sweepMail` and `sweepStalls`, `shared/api.ts`, the advance route). **P1f (D-5915) gates W5**: E4 reads `workerLastSeen`, never process counts.
- **Fleet operations FM1, FM3, FM6** (the maintenance switch, `ccd maintenance on`, the server's switch reader) and **FP9, FM10** (`spread`, the spread line). Rule R3's maintenance half reads FM1's switch through `readSwitches` once FM1 defines it; until then no maintenance mode exists, so no maintenance stop can happen, and the pause half (`COORDINATOR_PAUSE_MARKER`) is the whole of R3. FM6's start-lane holds gain the run-close lane (coordinator follow-up, §Deviations). W3 renders the spread line only when the wire carries the optional `spread` (FP9).
- **Consolidation K1, K3, W6** (`decideRetire`, `AttentionRow`, `SessionReading`, `RunBinding`): none planned. W2 ships the interim `refusedClose?` field the spec names; E4 reads `liveStatus` and the turn verdict; E5 reads the `.child` marker. Each is replaced by its K-row when that lands (spec §3.3, §3.1).
- **Skins P1a** (W3-LC, the list column): gates P9's re-scoped placement, not W3.

| Task | Rulings | Operator acts | Open PRs, rule 6 at Step 0 | Other |
|---|---|---|---|---|
| W0 today's page stops inviting the act | G5 (a) (open rows only) **ruled** | OA-R0 in the PR body | #960, #1054 (`FleetScreen.tsx`, untouched by W0; re-measure) | — |
| W1 never-started runs (E1, E1r), shadow | G1 (a), G4 (a) **ruled** | OA-R1 in the PR body before merge; OA-M1 after deploy and 3 days of shadow | #1054 (`watch.ts`), #1010 (`single-definition.test.ts`); DT2, C1h, C1j, C1k, capacity W1-4, P1e to P1g if opened | W0 merged (the ledger's names are the words the notice uses) |
| W2 coordinator gone (E3, E3s, E5), shadow | G2 (a), G4 (a) **ruled** | OA-R2 in the PR body before merge; OA-M2 after deploy and 3 days of shadow | as W1 | W1 merged |
| W3 the programme view | G6 (a), G5 (a) (the needs-you doors) **ruled** | OA-R4 at Step 0 | #960 and #1054 (`FleetScreen.tsx`, `api.ts`); FP9 if opened | W0 and W1 merged (`lastActAt` is R4's reading); W2 merged or its `refusedClose?` field taken optional-absent |
| W4 the ledger under Advanced | G5 (a) **ruled** | — | as W3 | W1, W2 and W3 merged |
| W5 worker gone (E2, E4), shadow | G3 (a), G4 (a) **ruled** | OA-R3 in the PR body before merge; OA-M3 after deploy and 3 days of shadow | as W1 | W2 merged; **mail-and-run P1f merged and deployed** (D-5915) |

## Landing order

```
spec §6 ruled (2026-10-21)
   │
   ▼
W0 (PWA) ──▶ W1 (server, shadow) ──▶ W2 (server, shadow) ──────────────────────────▶ W5 (server, shadow)
   │            │  OA-M1 after 3 days    │  OA-M2 after 3 days                          ▲   OA-M3 after 3 days
   │            ▼                        ▼                                              │
   └──────────▶ W3 (server read, then PWA) ──▶ W4 (PWA)                        mail-and-run P1f (D-5915)
```

One server series: W1, W2 and W5 edit the same lane files (`runClose.ts`, `endDeadCoordinator.ts`, `close.ts`, `watch.ts`, `store.ts`, `schema.ts`) and never sit in the queue together. W3's server commit (the read and the optional fields) follows W1 because `lastActAt` is R4's reading and `closedBy` reads the `causedBy` W1 writes; W3 does not wait for W2 (its `refusedClose?` is optional, read when present). W0 lands first and alone (spec §5: the cheapest fix first). W4 follows W1 to W3: its Abandon sentence reads the lane's pending close, and its pin needs W3's doors. Arming is never in a PR: each marker is an operator act after its wave's shadow window (G4 (a)), and arming one group never arms another.

## Global constraints

- **Public repository.** Every word in code, tests, commits and PR bodies is publishable: no host, address, account or lane name, project name, home path, email, private tracker id or run id from the box. Fixtures are neutral (`s-aaaa`, `programme-a`, run 7). Cite D-numbers, ARCH-NN and GitHub `#n`; never a private tracker id.
- **Account switching and the auto-swap are never blocked.** The lane reads no account figure and writes no swap marker; no task edits `_auto_swap_check`, `_swap_idle_gate`, `_swap_target`, `cmd_swap`, `swap-self` or the swap routes. A stop written by a swap is never E3s, and a swap's respawn never makes E5 or E4 (pinned in W2 and W5).
- **No herd restarts, no herd wakes.** R7: at most 3 programmes acted on per pass across every row together, and at most one E1 warning per pass; the warning asks a wake through `admitWake` under `WAKE_BURST` per `WAKE_WINDOW_MS` (read by reference, never a second literal); a close notice never asks a wake. No row restarts, resumes or wakes a session; a closed run's worker sleeps through the merged `run-done` policy (D-6092), never through this lane.
- **Coordinator-first routing.** Every close is told to the run's `claimedBy` first, through `insertSystemMailTx` from the `operator` role (the stall watch's pattern); a gone claimant's `untold` rows wait for its heir. "Needs you" counts only operator-facing asks (`operatorAsk`, D-6088) and the lane's refused closes, never an ask the coordinator holds.
- **A card is a glance; its header is a superset; user words.** No card, header or row string is a run number, a workspace id, a branch or a state-machine word; programme · wave always, with the programme's title, never its slug alone. The run number stays only in the accessible names of Abandon and Resume and in the ledger row's title (D-5589).
- **Every width, both skins, both themes.** W0, W3 and W4 are judged at 360, 390, 1280 and 1920 px × Refined and Instrument × dark and light, with the screenshots' matrix in the PR body; the title and the needs-you chip wrap and never ellipsize; nothing scrolls sideways; colours come only from skin tokens; the needs-you chip and the muted lines meet 4.5:1.
- **Improve what exists first.** The lane is the dead-coordinator lane widened (no parallel expiry lane); the detectors are drift's predicates moved, never copied; the actor is `closeRun`'s `'sweep'` arm; the notice is `insertSystemMailTx`; the feed is `notify`; the switches are `SWITCHES` rows; the grouping is `groupRuns` corrected; the needs-you predicate is `operatorAsk`; the folding is `useFolded`. A diff that adds a second definition of any of them is refused.
- **The ccrc SAFETY rules.** No task adds a `ws-*` verb, a unit or tmux touch, or widens what a reclaim deletes; the lane never calls `ws-expire`, `ws-reclaim` or `ws-reap`. Its only fleet act is the abandon arm's existing `ws-release` or `ws-hold` handoff and `closeRun`'s existing child reclaim, and R1 **removes** even those for a reused name or an unreadable marker. Workspaces are released, never removed.
- **The lane is shadow until its marker exists, and no writer exists.** Each group's marker is a `SWITCHES` row (owner `C5`) that no code in the tree writes; `single-definition.test.ts` pins "no writer" for each, as it does for `dead-coordinator-lane-live`. In shadow a row records "would close" through `notify` (`record-only`), sends no mail, asks no wake and acts on nothing.
- **Characterization first.** Every behaviour change is preceded, in the same PR, by a characterization commit that pins today's answer and is green on the base. The behaviour commit is its own commit, flips exactly the rows the task names, and the PR body lists every before/after row and cites the ruling.
- **Red first, then a mutation table, RUN.** Every new test is shown red on the base (or on the characterization commit) before the code that greens it. Each mutation table runs on a `git archive` copy of the PR's tip under the scratch directory, never in the worktree, and each row's red test name is printed in the PR body.
- **Wire discipline.** Additive and optional only: `closedBy?`, `closeDetail?`, `lastActAt?` and `refusedClose?` on `RunSummary`, one cold read `GET /api/programs`, an old-server/new-PWA and new-server/old-PWA skew test. Migrations add tables and nullable columns with no `NOT NULL` and no `CHECK` on an existing table, so a rollback stays bootable. No frame is renamed or removed; no `FLEET_PROTO` bump.
- **Counts measured, not assumed.** Every figure in a PR body is measured by an operator act or a suite, never typed from the spec.
- **Test discipline.** vitest always `--maxWorkers=2`, one suite at a time; never the full server suite locally.
- **Deviation ledger.** This plan defines D-6170 to D-6175, one per task, and never allocates. 6176 and 6177 are issued and unused, held for departures and entered by the coordinator only.

## Review focus (the failure modes most likely to bite)

1. **A close of a live run.** E1 requires every open run of the programme to be `planned`, the programme quiet for 72 h on R4's full activity list, and a warning delivered at least 24 h earlier; E4 requires a `dead` verdict, not hibernated, and a stale heartbeat. Any reading that cannot be taken answers "not this pass" (R2). A diff where an unmeasured input acts is refused.
2. **The lane's own rows resetting its clock, or a gap counted as quiet.** R4 excludes `causedBy 'sweep'` rows; R5's anchors restart on a gap above `DEAD_COORDINATOR_GAP_MS`, a pause, maintenance or a backward clock step, so a restart after days closes nothing on its first pass.
3. **A fleet act on the wrong session.** R1 for every row: a `.child` marker naming a later run (`run.id < mark.runId`), or an unreadable or unrecognised marker, gives `fleetAct: 'none'` (no `ccd` call, no `handOffChildReclaim`); a null `sessionId` gives `'none'`. The act re-reads the marker inside the mutex.
4. **A late start lost.** The act runs on the one coordination mutex `dispatchRun`, `advance` and `closeRun` share, and `stillStuck(row)` re-checks state, `dispatchStartedAt`, `claimedBy` and activity there, before and after the fleet act. No `gh` call and no sleep runs inside the mutex (R6).
5. **Lost work.** An open PR or unpushed commits (`pr-state`, the ws-audit `unpushed-commits` check, each read before the mutex and at most 5 minutes old at the act) refuse the close and list the run; an unmeasured reading refuses too.
6. **A storm.** One warning a pass; close notices never wake and never push; `expired:*` transitions and the lane's mail are record-only in `pushNewMail` and `pushNewRuns`; one feed row per programme per pass; the only new push is one needs-you push per refused close under a gone coordinator.
7. **A coordinator never told, or told twice.** `untold` rows are written in the close transaction and deleted in the notice's insert transaction; a crash between them still yields exactly one notice; a gone claimant gets no mail (nothing parks `undeliverable`), and its rows drain to the heir when Resume or the reclaim door rewrites `claimedBy`.
8. **A deliberate stop read as death.** E3s counts only a `stop` the journal attributes to a person's stop verb; a swap's, a supervisor's, an OOM policy's, a lane's or a maintenance stop never counts; hibernation is never "gone" for any row.
9. **A screen built twice, or a word that leaks.** W3 builds the programme card, screen and stepper once; P9 only places them. No card or header string equals `session.branch`, `session.workspace`, a slug when a title exists, or a run id, at every width and in both skins; every card string appears in the header.
10. **A ratchet broken across the hall.** The feed's writer set stays two (`notify` and its archive pair, D-5859): the lane's rows go through `notify`, never a new `recordFeedEvent` site. `SWITCHES` gains marker rows only, each with no writer. `driftFindings`' suite is green unchanged after the move.

## Tasks

### Task W0: today's page stops inviting the act — programme · wave names, the programme's title, Abandon on open rows only, `awaiting-review` is waiting (D-6170; spec §2.2, §3.2, §5 W0, §6 G5 (a)) — GATED: G5 (a) ruled; OA-R0 in the PR body

**Routing:** **band 2** (spec-able PWA; the orchestrator reviews the diff). One reviewer reads Review focus 9 and the width matrix. **Lane:** PWA. **Needs:** nothing merged.

**Files:**
- Modify `pwa/src/fleet/runWords.ts`: one pure `runRowName(run)` returning the programme's title (`programTitle`, the slug only when the title is empty) and `programmeWaveTail`'s wave words, plus " · review" for a review run (`runKindChip`'s reading). `programmeWave` keeps printing the slug for its fleet-row callers (its D-5528 truncation contract); no second spelling of the wave words exists (`programmeWaveTail` is the one).
- Modify `pwa/src/screens/RunRow.tsx`: the name cell reads `runRowName(run)` and never `run.workspace`, `run.branch` or `String(run.id)`; the workspace and the run number move to the row's `title` attribute (D-5589). `abandonButton` renders only when `!isRunClosed(run)`; its accessible name keeps "Abandon run <id>" (D-5589). The resume door is unchanged (its D-1146 condition stands).
- Modify `pwa/src/screens/RunsScreen.tsx`: the group head's `runs-program` prints the group's `programTitle` (the slug only when empty), and its `aria-label` names the title.
- Modify `pwa/src/fleet/runGroups.ts`: `RunGroup` becomes `'waiting' | 'running' | 'finished'`; `RUN_GROUP['awaiting-review']` is `'waiting'` (reversing D-5587's map row, "the one state that waits on the operator"); `RunGroups.needs` and `NeedsRow` become `waiting` and `WaitingRow`. The module comment says no run state waits on the operator: "needs you" is read from sessions and the lane's refusals (W3).
- Modify `pwa/test/run-groups.test.ts`, `pwa/test/runs-screen.test.tsx`, `pwa/test/abandon-sheet.test.tsx`; add `pwa/test/runs-glance.test.tsx`.

- [ ] **Step 0: Re-ground** every symbol above; confirm `groupRuns`, `RUN_GROUP` and `NeedsRow` have no consumer outside `run-groups.test.ts` (`git grep -w`); rule 6 for each file; name the `abandon-sheet.test.tsx` pin on the inert planned row (it must stay green: a planned run is open).
- [ ] **Step 1: Characterization commit** (green on the base). "today:" (a) a `done` row and a `failed` row each render Abandon; (b) a run with no workspace and no branch renders its run number as its name; (c) a run with a workspace renders the workspace as its name; (d) the group head of `programme-a` titled "Programme A" prints `programme-a`; (e) `RUN_GROUP['awaiting-review']` is `needs`. "kept:" an open `planned` run with no session renders Abandon (the wedge door, D-282); the resume door's rows (a dead claimant on an open run; an all-terminal programme); Abandon's accessible name carries the run number; the Finished group's order (#727's pin).
- [ ] **Step 2: Red.** "no closed row renders Abandon"; "no row's visible name equals its run id, its workspace or its branch"; "a row is named by its programme's title and wave"; "a review run's name ends in review"; "the group head prints the title, and the slug only when the title is empty"; "awaiting-review is waiting, and no run state is needs"; "the run number survives in Abandon's and Resume's accessible names and the row's title".
- [ ] **Step 3: Green, in commits.** (1) `runRowName`; (2) **the behaviour commit**, the row's name and the head; (3) **the behaviour commit**, Abandon on open rows only; (4) **the behaviour commit**, `RUN_GROUP`. The PR body lists the before/after rows, cites G5 (a), U9 and D-5545, and names D-5587's reversed map row.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `abandonButton` rendered on every row | runs-glance | "no closed row renders Abandon" |
  | `abandonButton` gated on `run.sessionId !== null` | abandon-sheet | "kept: an open planned run with no session renders Abandon" |
  | the name falls back to `String(run.id)` | runs-glance | "no row's visible name equals its run id …" |
  | the name prefers `run.workspace` | runs-glance | "a row is named by its programme's title and wave" |
  | the head prints `program` | runs-glance | "the group head prints the title …" |
  | `RUN_GROUP['awaiting-review']` back to `needs` | run-groups | "awaiting-review is waiting …" |
  | Abandon's `aria-label` drops the id | abandon-sheet | "the run number survives in … accessible names" |

- [ ] **Step 5: Verify.**

      cd pwa && ./node_modules/.bin/tsc --noEmit
      cd pwa && ./node_modules/.bin/vitest run test/runs-glance.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/run-groups.test.ts --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/abandon-sheet.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/runs-screen-cold-order.test.tsx --maxWorkers=2

  plus the width matrix: `/runs` at 360, 390, 1280 and 1920 × Refined and Instrument × dark and light, screenshots in the PR body, a long programme title wrapping.

**Exit (GATES):** no closed row offers Abandon; no visible run number, workspace or branch as a row's name; the head is the title; `awaiting-review` is waiting; OA-R0's baseline in the PR body. **Rollback:** `git revert` (PWA only).

### Task W1: never-started runs close themselves — the run-close lane, rules R1 to R8, rows E1 and E1r, the warning, the `untold` rows and the notice, in shadow behind `runs-expire-never-started` (D-6171; spec §3.1, §3.4, §5 W1, §6 G1 (a), G4 (a)) — GATED: after W0; OA-R1 in the PR body before merge

**Routing:** **band 3, native** (a lane that closes runs; judgment-heavy). Two reviewers: one reads only Review focus 1 to 4 and 7; one reads Review focus 5, 6 and 10 and the shadow contract. **Lane:** server (plus `runBelongsTo`'s one-line PWA re-import). **Needs:** W0 merged; OA-R1 measured.

**Files:**
- Create `server/src/runClose.ts` (L1, pure, imports L0 alone): the run-close lane's decider.
  - `RunCloseRow`: the row names (`never-started`, `review-orphaned`, and the kept `claimant-crashed`; W2 and W5 add theirs); `RUN_CLOSE_GRACE_MS` per row (`never-started` reads `RUN_QUIET_MS` by reference, G1 (a); `review-orphaned` 1 h); `RUN_CLOSE_WARN_LEAD_MS` (24 h); `RUN_CLOSE_PROGRAMMES_PER_PASS` (3) and `RUN_CLOSE_WARNINGS_PER_PASS` (1) (R7); `RUN_CLOSE_FACT_MAX_AGE_MS` (5 min, R6).
  - `programmeLastActivity(input)` and `runLastActivity(input)` (R4): the newest of the act rows with drift's definition minus `causedBy 'sweep'` rows, every `openedAt`, every `lastDispatchAttemptAt`, `lastClaimantMailAt` for the programme's runs, and the claimant's last busy turn.
  - `graceAnchorNext(prev, now, held)` (R5): `deadAnchorNext`'s rule (one definition, reused), restarting on a gap above `DEAD_COORDINATOR_GAP_MS`, on `held` (pause or maintenance) and on a backward step.
  - `fleetActFor(run, childMark)` (R1): `'none'` for a null `sessionId`, a marker naming a later run (`runBelongsTo`), or a `none`, `unreadable` or `unrecognised` marker read as unreadable (the run is listed, not closed); `'release'` otherwise.
  - `neverStartedVerdict(programme, now)` (E1) and `reviewOrphanedVerdict(run, target, laterReview)` (E1r), each answering `close`, `warn`, `would-close` (shadow), `list` (a needs-you reason with its word) or `hold` (with its word); `runCloseBudget(candidates)` (R7, oldest activity first).
  - drift's `run-quiet` and `claimant-gone` predicates, moved from `server/src/coord/drift.ts` (spec §3.1: "move to the L1 module both read"); `driftFindings` imports them.
- Create `shared/runBelongs.ts`: `runBelongsTo`, moved from `pwa/src/fleet/runWords.ts` byte-for-byte; `runWords.ts` re-exports it (one definition, `single-definition.test.ts` pins one definer).
- Modify `server/src/coord/close.ts`: `SweepCloseGuard` gains `fleetAct: 'release' | 'none'` and `row: RunCloseRow`, and `stillCrashed` becomes `stillStuck` (the departure slug the spec names, `the-sweep-re-measures-inside-the-arm`, is the existing guard's contract widened: asked inside the mutex before and after the fleet act). On `fleetAct: 'none'` the abandon arm commits the transition with no `ccd` call and no `handOffChildReclaim`. A `'sweep'` close records `detail` `expired:<row>` plus the measured fact (the crash row keeps its detail). Every `'sweep'` and `'operator'` close, and the archive door's `programme:'end'`, write one `untold` row per closed run in the close transaction.
- Modify `server/src/coord/endDeadCoordinator.ts`: the executor takes a row; `stillStuck(row)` re-checks the row's store facts and cheap liveness reading; the crash row's path is byte-for-byte today's behaviour (characterization below).
- Modify `server/src/coord/schema.ts` (`MIGRATIONS`, the next free slots measured at Step 0 and before merge): `runs.lastDispatchAttemptAt` (nullable); `run_close_anchors` (row, key, first and last pass stamps); `run_close_warnings` (programme, claimant, `warnedAt`, the delivery id); `run_close_untold` (run id, programme, claimant, row, fact, at).
- Modify `server/src/coord/store.ts`: the reads and writes of those tables; `lastDispatchAttemptAt`; the planned-programme read (programmes whose every open run is `planned`, with each run's `reviews` target state); the warning's `deliveredAt` read; the `untold` drain (`insertSystemMailTx` and the delete in one transaction, the `queueStallNotice` pattern).
- Modify `server/src/coord/dispatch.ts` `dispatchRun`: every answer (proceed, `paused`, `mail-disabled`, a cap, the daily brake, `worker-starting`, unmeasurable) writes `lastDispatchAttemptAt` in one small transaction outside any `gh` or fleet call; no refusal changes its answer or its order.
- Modify `server/src/watch.ts`: `sweepDeadCoordinators` drives the new rows on the same pass (no new clock; C1h's row if it has landed); R3 holds the whole lane while `COORDINATOR_PAUSE_MARKER` (and FM1's maintenance switch once it exists) is set; the shadow arm records through `notify` `record-only`; `pushNewMail` classifies `runs closing:` and `runs closed:` system mail as record-only (the stall mail's test, extended); `pushNewRuns` treats a transition with `causedBy 'sweep'` and an `expired:*` detail as record-only.
- Modify `shared/switches.ts`: one `SWITCHES` row, `runs-expire-never-started` (owner `C5`; "The run-close lane closes never-started waves in a quiet programme"), with no writer.
- Modify `pwa/src/fleet/runWords.ts` (the re-export only).
- Add `server/test/run-close-policy.test.ts`, `server/test/run-close-lane.test.ts`; modify `server/test/dead-coordinator-lane.test.ts`, `server/test/end-dead-coordinator.test.ts`, `server/test/coord-abandon.test.ts`, `server/test/drift-findings.test.ts` (imports only), `server/test/switches.test.ts`, `server/test/single-definition.test.ts` (one appended block), and the `pushNewMail` / `pushNewRuns` suite Step 0 names.

- [ ] **Step 0: Re-ground** every symbol; rule 6 (`watch.ts` against #1054 and any DT2, C1h, C1j or P1e to P1g PR; `dispatch.ts` against capacity W1-2 to W1-4 and C1k; `single-definition.test.ts` against #1010); name the store read of a run's act rows that drift uses, the journal reader that answers `untrusted`, and the `pushNewMail` record-only test. **OA-R1's answers are in hand** (the E1 replay over today's planned runs and §1.3's review-run question); if the replay would close a run whose programme the operator calls live, stop and report.
- [ ] **Step 1: Characterization commit** (green on the base). "today:" a programme with only `planned` runs quiet 200 h → nothing closes it and no finding names it; a refused dispatch writes no row; an operator Abandon of a `planned` run writes `failed`, `causedBy 'operator'`, and no mail; `pushNewRuns` pushes a `failed` transition that has a `sessionId`; `pushNewMail` pushes a system mail to a coordinator. "kept:" every `dead-coordinator-lane.test.ts` and `end-dead-coordinator.test.ts` row (the crash row's decision, breaker, gap rule, backoff, feed rows, `claimant-changed`); `closeRun('sweep')` without a guard is a type error; `driftFindings`' rows.
- [ ] **Step 2: Red.** Policy rows (`run-close-policy.test.ts`): "a queued wave behind a dispatched, working, awaiting-review or merging wave is never E1"; "a planned review of an awaiting-review work run is never E1"; "a programme quiet 71 h is not a candidate"; "quiet 72 h with a warning delivered 24 h ago closes"; "quiet 72 h with a warning delivered 23 h ago holds"; "an undelivered warning blocks E1 and lists the programme as coordinator not reached"; "a refused dispatch, an openedAt, a mail about a run and a busy coordinator turn each reset the clock"; "the lane's own sweep rows never reset the clock"; "a gap above DEAD_COORDINATOR_GAP_MS restarts the grace"; "a pause restarts the grace"; "a backward clock step restarts the grace"; "a review run of an open work run is never E1r"; "a review run whose target closed is E1r after 1 h"; "fleetAct is none for a null sessionId, and for a marker naming a later run"; "an unreadable child marker lists the run and never closes it"; "the budget acts on at most 3 programmes and warns at most once a pass"; "an unmeasured reading answers not this pass". Lane rows (`run-close-lane.test.ts`): "shadow records would-close and sends no mail"; "unarmed, the warning is never sent"; "armed, the warning is queued at 48 h with runId null and asks a wake within the budget"; "a dispatch between the pass and the act skips the close"; "an E1 close of a planned wave-2 run with a sessionId releases or hands off its hold"; "an E1 close of a reused name makes no ccd call"; "the close records sweep with expired:never-started"; "the notice survives the closes it reports"; "a crash between the close and the notice yields exactly one notice"; "the close notice never asks a wake"; "neither the warning nor the notice pushes, and no expired transition pushes"; "nothing acts while the pause is set"; "a restart after 3 days of downtime closes nothing on its first pass"; "a 21-run backlog drains over several passes and never acts on more than 3 programmes in one"; "an operator Abandon writes an untold row and its live claimant is told"; "the shadow feed row goes through notify, record-only". Dispatch: "every dispatch answer stamps lastDispatchAttemptAt, refusals included". Switches: "runs-expire-never-started has no writer".
- [ ] **Step 3: Green, in commits.** (1) the migrations and store reads; (2) `runBelongsTo` to `shared/`; (3) the predicates moved into `runClose.ts`, `driftFindings` green unchanged; (4) `runClose.ts`'s new deciders, unused; (5) `SweepCloseGuard`'s `fleetAct`, `row` and `stillStuck`, with the crash row still answering today's words; (6) **the behaviour commit**, `lastDispatchAttemptAt` on every dispatch answer; (7) **the behaviour commit**, the `untold` rows on every `'sweep'` and `'operator'` close and the notice drain; (8) **the behaviour commit**, the push classification; (9) **the behaviour commit**, the lane's E1 and E1r rows in shadow behind the marker. The PR body lists the before/after rows and cites G1 (a) and G4 (a) (2026-10-21) and the 2026-10-20 ruling.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | E1 counts only `planned`-and-old runs, not the programme | run-close-policy | "a queued wave behind a dispatched … wave is never E1" |
  | `sweep` rows counted as activity | run-close-policy | "the lane's own sweep rows never reset the clock" |
  | `lastDispatchAttemptAt` left out of R4 | run-close-policy | "a refused dispatch … each reset the clock" |
  | the warning's `deliveredAt` read as its queue time | run-close-policy | "an undelivered warning blocks E1 …" |
  | the gap rule skipped | run-close-policy | "a gap above DEAD_COORDINATOR_GAP_MS restarts the grace" |
  | `fleetActFor` answers `release` on an unreadable marker | run-close-policy | "an unreadable child marker lists the run …" |
  | the budget per row instead of lane-wide | run-close-policy | "the budget acts on at most 3 programmes …" |
  | `stillStuck` skipped inside the mutex | run-close-lane | "a dispatch between the pass and the act skips the close" |
  | `fleetAct: 'none'` still calls `handOffChildReclaim` | run-close-lane | "an E1 close of a reused name makes no ccd call" |
  | the `untold` delete in a separate transaction | run-close-lane | "a crash between the close and the notice yields exactly one notice" |
  | the close notice asks `admitWake` | run-close-lane | "the close notice never asks a wake" |
  | `pushNewRuns` pushes `expired:*` | run-close-lane | "neither the warning nor the notice pushes …" |
  | shadow sends the warning | run-close-lane | "shadow records would-close and sends no mail" |
  | R3 ignores the pause | run-close-lane | "nothing acts while the pause is set" |
  | the crash row reads the new grace | dead-coordinator-lane | its existing rows |
  | a second `recordFeedEvent` call site | single-definition | the feed writer-set pin (D-5859) |

- [ ] **Step 5: Verify.**

      cd server && ./node_modules/.bin/tsc --noEmit
      cd server && ./node_modules/.bin/vitest run test/run-close-policy.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/run-close-lane.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/dead-coordinator-lane.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/dead-coordinator-policy.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/end-dead-coordinator.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/coord-abandon.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/drift-findings.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/switches.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/notice.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/stale-run-attribution.test.tsx --maxWorkers=2

  plus the `pushNewMail` and `pushNewRuns` suites and the dispatch suites Step 0 names, one at a time.

**Exit (GATES):** E1 and E1r decide in shadow and record "would close" through `notify`; the crash row is unchanged; every dispatch answer stamps `lastDispatchAttemptAt`; every lane and operator close writes `untold` rows, drained to a live claimant in one notice; the lane's mail and transitions never push; OA-R1 in the PR body. **After deploy:** 3 days of shadow, then OA-M1. **Rollback:** no marker means shadow; removing `runs-expire-never-started` disarms; `git revert` of the PR's behaviour commits restores today (the migrations are additive and stay).

### Task W2: runs whose coordinator is gone close themselves — rows E3, E3s and E5, per-row breakers, the heir drain, refused closes listed, in shadow behind `runs-expire-coordinator-gone` (D-6172; spec §3.1, §5 W2, §6 G2 (a), G4 (a)) — GATED: after W1; OA-R2 in the PR body before merge

**Routing:** **band 3, native.** Two reviewers: one reads only Review focus 3, 5 and 8 (with the swap rows); one reads the breaker and the heir drain against spec §3.1's "Telling the coordinator". **Lane:** server. **Needs:** W1 merged; OA-R2 measured.

**Files:**
- Modify `server/src/runClose.ts`: rows `claimant-gone` (E3, 1 h), `claimant-stopped` (E3s, 24 h) and `name-reused` (E5, the next pass), G2 (a) exactly: E3 on a `ClaimantVerdict` that `claimantMeasuredDead` reads dead **by a removal act the trusted journal records** (archive, forget, purge, destroy, reap, expire); E3s on a `stop` the journal attributes to a person's stop verb; a stop by a swap, a supervisor, an OOM stop policy, any lane or maintenance, and every `hibernate`, never; an absent claimant with no lifecycle history, or one never started with no successful spawn, answers `list` ("would close", needs you) and never `close` (`deadCoordinatorCrash`'s `unmeasured` rule kept). E5 is `runBelongsTo`'s predicate alone on a marker of kind `child`, run ids only, with no generation test. A per-row breaker on **transitions** (two or more claimants newly measured gone within `DEAD_COORDINATOR_BREAKER_WINDOW_MS` trip that row), reusing `deadCoordinatorBreaker`'s shape and its `fleetDoubt` arm lane-wide; the backlog present at arming is snapshotted, exempt from clustering, and drained by R7's budget.
- Modify `server/src/coord/endDeadCoordinator.ts` and `server/src/watch.ts`: the rows on the same pass; R6's reads (`CCD_ARGV.prStateSession`, the ws-audit `unpushed-commits` check) before the mutex for every run with a `sessionId`; an E3 programme with a live, busy worker leaves that run open and lists it; no mail to a claimant measured gone (its `untold` rows stay).
- Modify `server/src/coord/reclaim.ts`: when Resume or the reclaim door rewrites a programme's `claimedBy`, the programme's `untold` rows drain to the heir in the same transaction's follow-up notice (one notice, the W1 drain).
- Modify `server/src/coord/schema.ts`, `store.ts`: `run_close_refused` (run id, row, reason, first and last seen, `pushedAt`), the durable dedupe for the one needs-you push (C1f's `dedupeKey` replaces it when it lands).
- Modify `shared/api.ts`: `RunSummary.refusedClose?: { row, reason, since } | null` (optional, the spec's interim for K1's `AttentionRow`).
- Modify `shared/switches.ts`: `runs-expire-coordinator-gone` (owner `C5`), no writer.
- Modify `server/test/run-close-policy.test.ts`, `server/test/run-close-lane.test.ts`, `server/test/dead-coordinator-lane.test.ts`, a reclaim suite Step 0 names, `server/test/switches.test.ts`, `server/test/single-definition.test.ts`; the skew test for `refusedClose?`.

- [ ] **Step 0: Re-ground**; rule 6; name the journal field that attributes a `stop` to a person's verb versus a swap, a supervisor, an OOM policy or a lane, and stop if no such attribution exists (report, never infer it from timing). **OA-R2's answers are in hand** (hibernated versus gone for the measured claimants; the breaker's feed row; why `dead_claimants` read empty).
- [ ] **Step 1: Characterization commit** (green on W1's tip). "today:" an archived claimant's programme stays open after 2 h; a hand-stopped claimant's programme stays open after 25 h; a run whose `sessionId` is held by a later run's child stays open; an absent claimant with no history is `unmeasured` and never acted on. "kept:" the crash row (OA-D6's marker); a hibernated claimant is never dead; Resume rewrites `claimedBy` on every run of the programme.
- [ ] **Step 2: Red.** "an archived claimant's programme closes after 1 h"; "a hibernated claimant's programme never closes"; "a person's stop closes after 24 h"; "a stop by a swap, a supervisor, an OOM policy or maintenance never closes"; "an absent claimant with no history is listed, never closed"; "a Resume that rewrote claimedBy ends the act with claimant-changed"; "a run with an open PR is refused and listed"; "a run with unpushed commits is refused and listed, and one push is raised once"; "an unmeasured pr-state refuses"; "a busy worker under a gone coordinator is left open and listed"; "an E3 close of a run held by a later run's child makes no ccd call"; "an E3 close creates no parked delivery"; "the notice reaches the heir after a Resume, once"; "a worker restarted by a swap after dispatch is never E5"; "the first armed pass on 3 old gone claimants acts"; "two claimants newly gone within the window trip E3 only"; "a simulated all-panes-stopped burst acts on nothing"; "runs-expire-coordinator-gone has no writer"; "an old PWA ignores refusedClose and a new PWA reads its absence as none".
- [ ] **Step 3: Green, in commits.** (1) the migration and store; (2) `refusedClose?` on the wire, unread; (3) the deciders, unused; (4) **the behaviour commit**, the heir drain; (5) **the behaviour commit**, the rows in shadow behind the marker, with the refused-close listing and its push. The PR body lists the before/after rows and cites G2 (a), G4 (a) and the 2026-10-20 ruling.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `hibernate` counted as a removal | run-close-policy | "a hibernated claimant's programme never closes" |
  | any `stop` counts for E3s | run-close-policy | "a stop by a swap, a supervisor … never closes" |
  | absent with no history closes | run-close-policy | "an absent claimant with no history is listed, never closed" |
  | E5 adds a generation test | run-close-policy | "a worker restarted by a swap after dispatch is never E5" |
  | `expectClaimedBy` dropped from the guard | run-close-lane | "a Resume that rewrote claimedBy ends the act …" |
  | R6 reads `pr-state` inside the mutex | run-close-lane | "an unmeasured pr-state refuses" (and the no-`gh`-in-mutex probe) |
  | mail queued to a gone claimant | run-close-lane | "an E3 close creates no parked delivery" |
  | the heir drain runs twice | run-close-lane | "the notice reaches the heir after a Resume, once" |
  | the breaker counts states, not transitions | run-close-lane | "the first armed pass on 3 old gone claimants acts" |
  | `fleetDoubt` ignored by the new rows | run-close-lane | "a simulated all-panes-stopped burst acts on nothing" |
  | the refused-close push sent every pass | run-close-lane | "… one push is raised once" |

- [ ] **Step 5: Verify** as W1's Step 5, plus the reclaim suite and the skew test, one at a time.

**Exit (GATES):** E3, E3s and E5 decide in shadow per G2 (a); refused closes are listed with one push; the heir is told; nothing acts on a hibernated, swapped, supervised, OOM-stopped or maintenance-stopped claimant; OA-R2 in the PR body. **After deploy:** 3 days of shadow, then OA-M2. This closes the 3 runs of the 2026-10-19 history once armed. **Rollback:** remove `runs-expire-coordinator-gone`; `git revert`.

### Task W3: the programme view — `GET /api/programs`, the card, the programme screen and its doors, the Finished group, the fleet line, the entry points (D-6173; spec §3.2, §3.3, §3.4, §5 W3, §6 G5 (a), G6 (a)) — GATED: after W0 and W1; OA-R4 at Step 0

**Routing:** **band 3, native** for the server commit and the counts model (it decides what "needs you" means); **band 2** for the components once the model's pins are green. Two reviewers: one reads Review focus 9 and the width matrix; one reads the counts and the needs-you join against spec §3.2. **Lane:** server (first commit, deployed first), then PWA. **Needs:** W0 and W1 merged; W2's `refusedClose?` read when present.

**Files:**
- Create `shared/programmes.ts`: `programmeCurrentWave(runs)` (the highest wave whose work run has left `planned`, or closed `done`; else the lowest planned wave, worded "wave N queued"), `programmeWaveCounts(runs)` (each wave in exactly one of working, waiting, queued, done; reviews nest under their wave; `failed` waves counted apart), and `programmeEnding(closes)` (the Finished card's words from `closedBy` and `closeDetail`). One definition, read by the server and the PWA.
- Modify `server/src/coord/store.ts` and `server/src/coord/routes.ts`: `GET /api/programs`, a cold read aggregated in SQL over `runs` and `run_events` (open derived from runs, never from `programs.state`), answering `{ programmes: [{ slug, title, currentWave, waveOf, claimedBy, waves, lastActAt, closedBy, ending, pendingClose, spread? }], lane?: { closesByRow, refusalsByReason, warningsSent, warningsUndelivered, wouldClose } }`; `pendingClose` is the lane's own decider answer for the programme (armed or shadow), never re-derived; `spread` only when FP9's `programmeSpread` exists.
- Modify `shared/api.ts`: `RunSummary.closedBy?`, `closeDetail?` (redacted through the existing profile), `lastActAt?`; the programmes response type.
- Create `pwa/src/fleet/usePrograms.ts` (K14: the one programme reader; it folds the live `{type:'runs'}` frame into the cold list and refetches once on a close, as `useColdRuns` does after an Abandon), `pwa/src/fleet/programmeView.ts` (pure: the card and header models, the needs-you join, the order), `pwa/src/fleet/ProgrammeCard.tsx`, `pwa/src/screens/ProgrammeScreen.tsx` (`/runs/p/<slug>`), `ui/src/primitives/stepper.tsx` with its story (D-5588's inks: done on the tertiary ink, the current on the primary, the rest a hairline; its word "wave 3 of 5" always rendered and its accessible name; more than twelve steps compact; wraps, never scrolls; its inks join the contrast gate's non-text pairs).
- Modify `pwa/src/screens/RunsScreen.tsx`: the programme list on top (needs you first, then open programmes by last activity, then a collapsed "Finished" group through `useFolded`, each finished programme for 7 days after its last close, G6 (a)); today's ledger stays the lower half until W4. `CoordBanner` (only while paused) and "Start a program" stay above the list.
- Modify `pwa/src/lib/routes.ts` (the `runs-programme` row), `pwa/src/app.tsx` (its screen), `pwa/src/fleet/inboxTarget.ts` (run kinds open the run's programme screen), `pwa/src/fleet/SessionMeta.tsx` and `pwa/src/session/SessionDetails.tsx` ("Open the run board" opens that programme's screen), `pwa/src/screens/FleetScreen.tsx` (the runs line reads "4 programmes · 1 needs you"), `pwa/src/lib/api.ts` (`programs()`).
- The needs-you join (`programmeView.ts`): `operatorAsk` (D-6088) on the wave's worker or the coordinator, plus `refusedClose` (an open PR, unpushed commits or a busy worker under a gone coordinator; an unreadable marker; an `unknown` run; an absent claimant with no history), plus an E1 warning undelivered 24 h. `sessionFacts`' `needsYou` is not read here: on the fleet frame the server already files a held ask outside `attention`, and Step 0 pins that the two answer alike on every row the frame can carry, so the view has one predicate, the rollup's.
- The header's doors (G5 (a)): "Open the session" (an operator question); "Open the PR"; "Hand to a coordinator" (`ResumeSheet`, recommended) and "Close anyway (the branch stays on disk)" (`AbandonSheet`) for unpushed commits under a gone coordinator; "Open the worker"; "Open the coordinator" (a warning not delivered). The coordinator is named as the session header names it (Step 0 names that function), never through `sessionLabel`'s fallback, with one state word from `sessionFacts` (working, idle, asleep, gone).
- Add `pwa/test/programme-view.test.ts`, `pwa/test/programme-screen.test.tsx`, `server/test/programs-route.test.ts`, the skew test, the stepper's story test; modify `pwa/test/inbox-target.test.ts`, `pwa/test/fleet-screen.test.tsx`, `pwa/test/runs-screen.test.tsx`.

- [ ] **Step 0: Re-ground**; rule 6 (#960 and #1054 on `FleetScreen.tsx` and `api.ts`; FP9 if open); name the session header's name function and the state word's reading. **OA-R4's answer is in hand** (how open runs sit under a `done` or `abandoned` programme row), and the view's "open" never reads `programs.state` either way. Pin "`operatorAsk` and `sessionFacts`' `needsYou` agree on every frame row" (a held ask, a dead pane, a live ask); if they differ on any row, stop and report.
- [ ] **Step 1: Characterization commit** (green on the base). "today:" `/runs` lists run rows by programme; `inboxTarget`'s run kinds open `/runs`; the session header's link opens `/runs`; the fleet runs line reads today's `runsLabel`. "kept:" `CoordBanner` while paused; "Start a program"; the cold read's error states (I6).
- [ ] **Step 2: Red.** Model rows: "wave 3 working plus waves 4 and 5 planned reads wave 3 of 5"; "a programme with only planned waves reads wave 1 queued"; "counts are waves, and reviews nest"; "awaiting-review and a planned review are waiting"; "a failed wave is not counted on an open card"; "a held child ask is never needs you"; "a refused close under a gone coordinator is needs you with its door"; "an undelivered warning after 24 h is needs you"; "needs-you cards sort first, then by last activity, never by slug"; "a programme with no open run is Finished for 7 days, then gone from the list"; "the Finished card says how it ended". Screen rows: "no card or header string equals a branch, a workspace, a slug with a title, or a run id, at every width including Instrument 1920"; "every card string appears in the header"; "the needs-you doors are the only Resume and Abandon on the programme screen"; "the pending-close line reads closes in <when> from the wire". Route rows: "GET /api/programs derives open from runs, never from programs.state"; "it answers done counts without shipping closed rows"; "spread is absent without FP9". Skew: "an old PWA ignores the new fields; a new PWA reads their absence". Entry points: "a run record opens its programme screen"; "the fleet line reads programmes and needs you".
- [ ] **Step 3: Green, in commits.** (1) **server**: `shared/programmes.ts`, the route, the optional fields, the skew test (deployed before any PWA commit); (2) the stepper primitive; (3) `usePrograms` and `programmeView.ts`; (4) **the behaviour commit**, the programme list on `/runs` with the ledger below; (5) **the behaviour commit**, the programme screen and its doors; (6) **the behaviour commit**, the entry points and the fleet line. The PR body cites G6 (a), G5 (a), D-5545 and D-6088, and lists the absorbed tasks (§Deviations).
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `programmeCurrentWave` is `programWave` (planned waves counted) | programme-view | "wave 3 working plus waves 4 and 5 planned reads wave 3 of 5" |
  | review runs counted as waves | programme-view | "counts are waves, and reviews nest" |
  | needs you reads `bucket` without the held ask's filing | programme-view | "a held child ask is never needs you" |
  | `refusedClose` dropped from the join | programme-view | "a refused close under a gone coordinator is needs you …" |
  | Finished kept forever | programme-view | "… Finished for 7 days, then gone from the list" |
  | the card falls back to the slug with a title present | programme-screen | "no card or header string equals …" |
  | the header omits the pending-close line | programme-screen | "every card string appears in the header" |
  | the route reads `programs.state` | programs-route | "derives open from runs …" |
  | the PWA re-derives `pendingClose` | programme-screen | "the pending-close line reads closes in <when> from the wire" |

- [ ] **Step 5: Verify** `tsc --noEmit` in `server`, `pwa` and `ui`; then `programs-route.test.ts`, the skew test, `programme-view.test.ts`, `programme-screen.test.tsx`, `inbox-target.test.ts`, `fleet-screen.test.tsx`, `runs-screen.test.tsx`, `rollup.test.ts`, `session-facts.test.ts` and the stepper's story test, one at a time, `--maxWorkers=2`; plus the width matrix for `/runs` and `/runs/p/<slug>` (360, 390, 1280, 1920 × Refined and Instrument × dark and light). Until skins P1a lands, Instrument draws the same page layout at 1280 and 1920 as today's `/runs`; P9 (re-scoped) places these components in its columns.

**Exit (GATES):** `/runs` answers "does anything need me", "will ccrc handle it" and "how far along" at a glance; the ledger is still reachable below; one programme reader; no leaked id at any width or skin. **Rollback:** `git revert` of the PWA commits restores the ledger as the page; the server read and the optional fields stay (unread).

### Task W4: the ledger moves under Advanced — `/runs/ledger`, Abandon says when ccrc would close the run, Resume, the caps control, the reclaim banner and the lane's counters move there (D-6174; spec §3.2 "Advanced: the run ledger", §3.4, §5 W4, §6 G5 (a)) — GATED: after W1, W2 and W3

**Routing:** **band 2.** One reviewer reads the width matrix and the doors pin. **Lane:** PWA. **Needs:** W1, W2 and W3 merged.

**Files:**
- Modify `pwa/src/lib/routes.ts` (a `runs-ledger` row), `pwa/src/app.tsx`: `/runs/ledger` renders today's ledger (`RunsScreen`'s list, with W0's names, `causedBy` and `detail` on every closed row from `closedBy` and `closeDetail`), reached from an "Advanced" link at the foot of `/runs` at every width.
- Modify `pwa/src/screens/RunsScreen.tsx`: the programme list alone; the ledger, `CapsControl` (until capacity W6's glance takes it), `ChildReclaimBanner` and Resume move to the ledger; the lane's counters (`lane` from `GET /api/programs`) head the ledger.
- Modify `pwa/src/fleet/AbandonSheet.tsx`: the confirm line gains "ccrc would close this itself <when>" when the run's programme carries a `pendingClose`; Abandon is drawn on open ledger rows only (W0's rule kept).
- Add `pwa/test/runs-ledger.test.tsx`; modify `pwa/test/abandon-sheet.test.tsx`, `pwa/test/runs-screen.test.tsx`, `pwa/test/resume-sheet.test.tsx`.

- [ ] **Step 0: Re-ground**; rule 6; confirm the archive door's `programme:'end'` still shares the abandon arm (D-282) and is untouched.
- [ ] **Step 1: Characterization commit.** "today:" `/runs` renders the ledger below the programmes; `CapsControl` and `ChildReclaimBanner` render on `/runs`. "kept:" Abandon's arm and its refusals; Resume's sheet and its `coordPresence` rule (D-1129, D-1146).
- [ ] **Step 2: Red.** "the needs-you doors are the only Resume and Abandon outside Advanced"; "the ledger is reachable from Advanced at every width"; "Abandon's confirm says when ccrc would close the run, and says nothing when no row applies"; "the lane's counters head the ledger"; "a closed ledger row names who closed it".
- [ ] **Step 3: Green: the behaviour commit(s)**, the ledger's move, then the Abandon sentence. The PR body cites G5 (a) and lists P5, P6's run-row half, P9 and FM10 as absorbed (the coordinator closes them, §Deviations).
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `ResumeSheet`'s opener left on `/runs` | runs-ledger | "the needs-you doors are the only Resume and Abandon outside Advanced" |
  | the Advanced link hidden below 900 | runs-ledger | "the ledger is reachable from Advanced at every width" |
  | the sentence drawn with no pending close | abandon-sheet | "… says nothing when no row applies" |

- [ ] **Step 5: Verify** `tsc --noEmit`, `runs-ledger.test.tsx`, `abandon-sheet.test.tsx`, `resume-sheet.test.tsx`, `runs-screen.test.tsx`, one at a time; the width matrix for `/runs` and `/runs/ledger`.

**Exit (GATES):** the default page invites no manual act; the overrides live under Advanced with the system's own timing beside them. **Rollback:** `git revert` (the ledger returns to the default page's lower half).

### Task W5: runs whose worker is gone close themselves — rows E2 and E4 over the #119 heartbeat, in shadow behind `runs-expire-worker-gone` (D-6175; spec §3.1, §5 W5, §6 G3 (a), G4 (a)) — GATED: after W2; mail-and-run P1f (D-5915) merged and deployed; OA-R3 in the PR body before merge

**Routing:** **band 3, native.** Two reviewers: one reads only Review focus 1, 5 and 8; one reads the late-child path against the child reclaim. **Lane:** server. **Needs:** W2 merged; P1f merged and deployed; OA-R3 measured.

**Files:**
- Modify `server/src/runClose.ts`: `dispatch-stalled` (E2: `planned`, `dispatchStartedAt` older than 1 h, no session bound, the registry whole, no record naming the run in its `.child` marker; fleet act none) and `worker-gone` (E4: `dispatched` or `working`; the worker `dead` on the `ClaimantVerdict` ladder (`stopped` by no lane, `orphan`, `never-started`, or `absent` with history), not hibernated; `workerLastSeen` older than 24 h (G3 (a)); no run activity in 24 h; R6 passes). An `unknown` run is listed, never E4 (`abandonMove` refuses it). E4 reads the same session reading capacity W1-3 reads, when that has landed, and keeps its own predicate.
- Modify `server/src/coord/endDeadCoordinator.ts`, `server/src/watch.ts`: the rows on the same pass, their breaker on workers newly gone within the window.
- Modify `shared/switches.ts`: `runs-expire-worker-gone` (owner `C5`), no writer.
- Modify `server/test/run-close-policy.test.ts`, `server/test/run-close-lane.test.ts`, `server/test/switches.test.ts`, `server/test/single-definition.test.ts`, and the child reclaim suite Step 0 names.

- [ ] **Step 0: Re-ground** `workerLastSeen` and `workerTurn` as P1f landed them; rule 6; **OA-R3's trace is in hand** (whether the stall watch's coordinator rung reached the two quiet dispatched runs' coordinators, and what they did).
- [ ] **Step 1: Characterization commit.** "today:" a dispatched run whose worker reads dead with `workerLastSeen` 30 h old stays open; a `planned` run with `dispatchStartedAt` 2 h old stays open (display only, `SPAWN_STALL_MS`). "kept:" the stall ladder's mails; `sweepBriefs`' retry and its "brief not taken" mail; the child reclaim's `child-spent` retirement and its refusals.
- [ ] **Step 2: Red.** "a hibernated worker is never gone"; "a busy worker blocks"; "a worker with a fresh heartbeat blocks"; "unpushed commits and an open PR refuse"; "an unknown run is listed, never closed"; "a stale heartbeat after a controller outage closes nothing on the first pass"; "a worker restarted by a swap is never gone"; "an E2 close makes no fleet act, and the late child is retired by the child reclaim with its checks"; "two workers newly gone within the window trip E4 only"; "runs-expire-worker-gone has no writer".
- [ ] **Step 3: Green: the behaviour commit**, the rows in shadow. The PR body cites G3 (a) and G4 (a).
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | E4 reads process counts, not `workerLastSeen` | run-close-policy | "a worker with a fresh heartbeat blocks" |
  | `hibernated` read as gone | run-close-policy | "a hibernated worker is never gone" |
  | `unknown` admitted to E4 | run-close-policy | "an unknown run is listed, never closed" |
  | the gap rule skipped for E4 | run-close-lane | "a stale heartbeat after a controller outage …" |
  | E2 releases the late child itself | run-close-lane | "an E2 close makes no fleet act …" |

- [ ] **Step 5: Verify** as W1's Step 5, plus the child reclaim suite, one at a time.

**Exit (GATES):** E2 and E4 decide in shadow per G3 (a); nothing closes a run whose worker is alive, asleep or holding work. **After deploy:** 3 days of shadow, then OA-M3. **Rollback:** remove `runs-expire-worker-gone`; `git revert`.

## Operator acts in this wave

Every act below reads or changes the controller or the fleet box; none is done by a worker. Readings are read-only and go in the named PR body as counts, never as ids from the box.

- **OA-R0 (before W0 merges): the baseline.** The spec §8 measures with §1.1's queries on `coord.db`: manual Abandons in the last 7 days, open runs by state and age, planned runs older than 7 days, runs with a gone coordinator, rows on the default page showing a run number.
- **OA-R1 (before W1 merges): the E1 replay.** Replay E1's condition (every open run of the programme `planned`, R4's activity, 72 h) over today's planned runs, and answer §1.3's review-run question (why each planned review run exists: the reviewer never dispatched, or dropped). The counts of "would warn" and "would close" go in W1's PR body.
- **OA-R2 (before W2 merges): hibernated versus gone.** For the claimants and workers §1.1 read as "no agent" or "no pane", the server's own `ClaimantVerdict` and `liveStatus`, and `.hibernated`; which claimants tripped the dead-coordinator breaker and why `dead_claimants` read empty.
- **OA-R3 (before W5 merges): the stall-rung trace.** Whether the stall watch's coordinator rung reached the coordinators of the quiet dispatched runs, and what they did.
- **OA-R4 (W3's Step 0): stale programme rows.** How the open runs under a programme row reading `done` or `abandoned` arose (a run opened under a finished slug, `CoordStore`'s programme upsert).
- **OA-M1 (W1 deployed, 3 days of shadow): arm never-started.** Read the lane's "would close" list for `runs-expire-never-started` (the feed's record-only rows, and from W4 the ledger's counters). If every entry is a programme the operator agrees is stuck, create `$REG/runs-expire-never-started`. Removing it disarms the group.
- **OA-M2 (W2 deployed, 3 days of shadow): arm coordinator-gone.** The same for `runs-expire-coordinator-gone` (E3, E3s, E5).
- **OA-M3 (W5 deployed, 3 days of shadow): arm worker-gone.** The same for `runs-expire-worker-gone` (E2, E4).
- **Not this plan's:** OA-D6 (the crash row's `dead-coordinator-lane-live`) stays the durability tail's act; arming one group never arms another.
- **Deploys** follow the standing rule: from a fresh `origin/main` worktree as a detached unit, verified from its log; W3's server half before its PWA half. No session restarts.

## Acceptance

Every PR body carries: the characterization commit's name; the before/after rows of each behaviour commit with its ruling cited (G1 to G6 of 2026-10-21, the 2026-10-20 ruling); the mutation table's red test names; the rule 6 check (each edited file, each open PR holding it, its hunks); the operator act's figures where its task names one (W0: OA-R0; W1: OA-R1; W2: OA-R2; W5: OA-R3); for W0, W3 and W4, the width matrix. Band 3 PRs carry both reviewers' verdicts. Spec §8's columns are measured after W2 is armed (manual Abandons per week ≤ 1, once W0 and W3 have landed; 0 planned runs older than 7 days; 0 runs with a gone coordinator beyond G2's grace except those listed; every lane close told to a live coordinator; 0 wakes from close notices and ≤ 1 warning a pass; 0 pushes from lane closes or notices; 0 run numbers on the default page) and again after W5 is armed.

## Rollback

Each task is a revert of its PR, newest first. Zero-deploy brakes: remove a group's marker (its rows return to shadow); `coordinator-paused` holds the whole lane (R3). Migrations are additive and stay after a revert. A revert of W3 or W4 restores the ledger as the page; the server read and the optional fields stay, unread.

## Deviations and decisions

### Issued for this work and defined here

The orchestrator issued this plan the block 6170 to 6177. This plan defines D-6170 to D-6175, one per task.

- **D-6170** — `runs-page-stops-inviting` (Task W0; spec §5 W0, G5 (a)): the runs ledger names every row by its programme's title and wave in words (`runRowName`, over `programmeWaveTail`), never a workspace, a branch or a run number, which stay only in the row's title and the accessible names of Abandon and Resume (D-5589's rule, taken over from skins P6's run-row half); the group head prints the programme's title; Abandon is drawn only on open rows; `RUN_GROUP` files `awaiting-review` as `waiting`, reversing D-5587's map row, and no run state is "needs you".
- **D-6171** — `runs-never-started-close` (Task W1; spec §3.1, G1 (a), G4 (a)): the dead-coordinator lane becomes the run-close lane, one row per cause on one pass, one budget and one executor; every row obeys rules R1 to R8 (no fleet act on a reused name or an unreadable marker, uncertain means not this pass, the pause and maintenance hold the lane, activity excludes the lane's own rows, graces restart on any gap, branch and PR facts read before the mutex, 3 programmes and one warning a pass, per-row breakers with a fleet-doubt arm). E1 closes a programme's planned waves after 72 h of quiet and a warning delivered 24 h earlier; E1r closes a review run whose target closed. Every dispatch answer stamps `lastDispatchAttemptAt`. Every lane and operator close writes `untold` rows, drained in one notice to a live claimant that never asks a wake; the warning wakes within the budget; neither pushes. Shadow until `runs-expire-never-started` exists.
- **D-6172** — `runs-coordinator-gone-close` (Task W2; G2 (a), G4 (a)): E3 closes a programme whose claimant a recorded removal ended after 1 h, E3s one a person stopped after 24 h, and E5 a run whose workspace name a later run's child holds, with no fleet act; hibernation and stops by a swap, a supervisor, an OOM policy, a lane or maintenance never count; an absent claimant with no lifecycle history is listed and never closed. A run with an open PR, unpushed commits or a busy worker is refused, listed with one push, and carried on the wire as `refusedClose?`. A gone claimant gets no mail; its `untold` rows go to the heir on Resume. Shadow until `runs-expire-coordinator-gone` exists.
- **D-6173** — `runs-programme-view` (Task W3; spec §3.2, §3.3, G5 (a), G6 (a)): `/runs` is a programme list read from one cold `GET /api/programs` (open derived from runs) through one `usePrograms` hook; a card reads title · current wave, wave counts, a needs-you chip, the pending close, the last activity and the coordinator with one state word; the programme screen at `/runs/p/<slug>` is the card's superset with a stepper and the needs-you doors, the only Resume and Abandon outside Advanced. "Needs you" is the rollup's `operatorAsk` (D-6088) plus the lane's refused closes and undelivered warnings. A programme with no open run sits in a collapsed Finished group for 7 days with its ending in words. Skins P5's board and stepper are superseded, P9 is re-scoped onto these components, and FM10's spread line is drawn from the optional `spread`.
- **D-6174** — `runs-ledger-under-advanced` (Task W4; G5 (a)): the run ledger moves to `/runs/ledger` behind an "Advanced" link with Resume, the caps control, the reclaim banner and the lane's counters; Abandon stays there on open rows only, and its confirm says when ccrc would close the run itself.
- **D-6175** — `runs-worker-gone-close` (Task W5; G3 (a), G4 (a)): E2 closes a planned run whose dispatch stalled for an hour, with no fleet act (a late child is retired by the child reclaim); E4 closes a dispatched or working run whose worker reads dead, not hibernated, with a heartbeat (`workerLastSeen`, D-5915) older than 24 h and no activity; an `unknown` run is listed, never closed. Shadow until `runs-expire-worker-gone` exists.

Issued and unused: 6176, 6177. They are held for this plan's departures, entered by the coordinator only, and never defined outside this plan.

### Absorbed and re-scoped (decisions, no new number)

- **Skins W3 P5 (D-5588)** is superseded by W3: the board grouped by state becomes the programme list; its `Stepper` is built once in W3 under D-5588's ink rules. **P5a (D-5587, D-5650)** stays merged; W0 reverses its `awaiting-review` row.
- **Skins W3 P6 (D-5589):** its run-row half is done by W0 under D-5589's own rule; its archive-row half (U13) stays P6's.
- **Skins W3 P9 (D-5592)** is re-scoped: Instrument's list column holds W3's programme list (needs you first) and its detail the programme screen; it still waits for P1a and builds no second list.
- **Fleet operations FM10 (D-5959):** its spread line belongs to the programme header and reads the wire's `spread`; it still waits for FP9.
- **Coordinator follow-ups (not tasks here):** (1) enter in the skins W3 plan and the fleet-operations plan that P5, P6's run-row half and P9, and FM10's runs-screen placement, are absorbed or re-scoped by D-6173 and D-6174; (2) add the run-close lane to FM6's start-lane holds, so maintenance holds it once FM1 defines the switch; (3) tell DT2's author that `run-quiet` and `claimant-gone` live in `server/src/runClose.ts` after W1.

## Out of scope

The reused-name root fix in `ccd` (release, reap and purge refusing while an open run binds the id; the slug picker skipping bound names) and consolidation W6's `RunBinding`, which later replaces E5's marker read; D4 #757 (the roster re-injected on compaction); D6 #758 beyond what E3 answers; K1's `AttentionRow` (W2's `refusedClose?` is its interim); capacity W6's caps glance; the daily brake (fleet-capacity F3, untouched); any change to the crash row's arming (OA-D6); any `ccd/`, `agent/` or `deploy/` file.

## Review log

**rev 0 (2026-10-21).** Written from the spec's rev 2 after the operator's 2026-10-21 ruling of G1 to G6, and measured on `origin/main` `d8cd47658` with 29 open PRs. Measured since the spec: #435 merged without the reused-name root fix; capacity W1-1 and W1-1b, the fleet rollup, consolidation W1a and W1b's C1i, and durability DT1 merged; skins W3 P5, P6, P9, capacity W1-2 to W1-5, consolidation W1b's C1h, durability DT2, mail-and-run P1f and every fleet-operations task have no PR. `programmeWave` prints the slug, so W0 names rows with the title and `programmeWaveTail`; `RUN_GROUP` has no `waiting` value, so W0 adds it; no maintenance mode exists, so R3's maintenance half waits for FM1's switch.
