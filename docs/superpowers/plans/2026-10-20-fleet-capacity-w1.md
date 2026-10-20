# Fleet capacity, W1: finished workers sleep at run close, live resumes and stale runs stop charging the cap, refused coordinators are woken, the in-place bind, and the do-it-yourself ruling in words — Implementation Plan

> **For agentic workers:** one PR per task, in the order of §Landing order, each dispatched only when its row in §Gates is all green. To execute a task, REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Steps use checkbox (`- [ ]`) syntax. Workers do not edit §Deviations and decisions. A departure is named by slug in the task's report; the coordinator enters it from this plan's issued block (§Deviations), never the worker. Workers never touch the fleet box or the controller box: every box reading in this plan is an operator act (§Operator acts).

**Spec:** `docs/superpowers/specs/2026-10-20-fleet-capacity-and-worker-lifecycle-design.md` (rev 1.1). §3.0, §3.1, §3.4 ("Stale runs never hold capacity", "What is free and what is charged"), §3.5, §5.1, §5.7, §6.1 and §7 bind every task. Read them before Step 0.

**Status:** rev 0 (2026-10-20). Written after the operator ruled every decision of the spec's §6 on 2026-10-20, in their words: "Accept all recommended (Recommended)" (spec §6.1). F5 (0) and (b) are this wave's rulings; F1's N = 2 h and hibernation's arming (2026-10-20 13:49 UTC) are operator acts already done; F2, F3, F4 and F7 bind later waves; F6 (i) binds the sleep-decider merge (consolidation K1), and W1-1 and W1-1b write the `run-done` split in its shape.

**Inputs.** The operator's ruling of 2026-10-17 (working-state plan Task 15b, D-5370: "stop workers at run close"), and its confirmation of 2026-10-20 (F5 (0)). D-5427 and D-5428 (stop-done composes `ccd hibernate`; the act-time re-measure). D-5426 (the `mail` hold). D-5242's presence contract and the wake budget (`server/src/coord/wakeBudget.ts`). D-2803 and D-2805 (idle run states give their slot back; `capsMeasured` is the one caps reader). D-3012 (a self-claimed run is admitted at open). D-5238 (the resume arm's live gate). The consolidation W1a and W1b plans for `SWITCHES`, the `notify` funnel, `dedupeKey`, `LANE_SCHEDULE` and `runLane`.

**Base:** `origin/main` `3cc6e5fce`. Code is cited by file and by function, constant, type or `describe` title, never by line number. Step 0 of each task re-grounds every citation by content on the tree it starts from.

**Symbols measured at the base.** Present: `stopDoneVerdict`, `StopDoneInput` (with `afterMs`), `STOP_DONE_HOLD_MAP` (with `recent` and `reviewing`), `STOP_DONE_GRACE_MS` (10 minutes), `STOP_DONE_PER_PASS` (3) in `server/src/stopDone.ts`; `stopDonePass`, `storeReadFor`, `StopDoneSweepDeps.serial` in `server/src/stopDoneSweep.ts` (which reads `hibernateAfterMs` and `expiryReviewing` for the lane); `hibernateVerdict`, `HIBERNATE_HOLD_MAP`, `hibernateAfterMs` in `server/src/coord/hibernate.ts`; `CoordStore.lastRunBySession` (`last`, `openWorkers`, `openClaimants`; its other readers are `server/src/fleet.ts` and `server/src/watch.ts`) and `CoordStore.capsUsage` in `server/src/coord/store.ts`; `capsMeasured` and `dispatchRun` in `server/src/coord/dispatch.ts` (step 1 the pause and `mail-disabled` listing, step 2 the caps, then the `run.sessionId === null` fresh-versus-resume branch, `childBindGate` and `refuseSpentChild` on the resume arm); the advance route `POST /api/runs/:id/advance` in `server/src/coord/routes.ts`, whose `IDLE_RUN_STATES` → `working` edge calls `capsMeasured`; the dispatch route `POST /api/runs/:id/dispatch` (body `brief`, `items`, `route`, `slug`; no caller identity) and `attributionVerdict` in the same file; `ACTIVE_RUN_STATES`, `IDLE_RUN_STATES`, `TERMINAL_RUN_STATES`, `RunRefuseCode` and `RUN_REFUSE_CODE_MAP` in `shared/api.ts`; `HOLD_REASON_PATTERN` (private) and `holdReasonVerdict` in `server/src/coord/rundefs.ts`; `wakeAdmit`, `WAKE_BURST`, `WAKE_WINDOW_MS` in `server/src/coord/wakeBudget.ts`; `queueSystemMail`; the `cap-concurrency` and `cap-daily` frames (`limit` and `running`, `limit` and `used`; no `detail`). **Absent at the base:** `decideSleep` (consolidation K1, no plan yet), `LANE_SCHEDULE` and `runLane` (consolidation W1b Task C1h, no PR yet), `dedupeKey` (W1a Task C1f, no PR yet), `admissionWaitSince`, `inPlace`, `self-dispatch`. `ccd/coordinator-skill/SKILL.md`'s "When something is wrong" entry and its crossing paragraph ("When a wave crosses into another project") both say "wait to be woken"; `ccd/coordinator-skill/references/wave-lifecycle.md`'s refusal table says "stop, name the cap, wait" for both caps.

**Deploy class.** W1-1, W1-1b, W1-2, W1-3, W1-4 and W1-4b are **server lane only**: no `ccd/`, `agent/`, `deploy/` or `pwa/` byte, no session restart, no `FLEET_PROTO` bump. W1-4 and W1-4b each add one nullable coord.db column. W1-5 is server lane (an additive `detail` on two refusal frames) plus the skills lane (`ccd/coordinator-skill/`, installed by `ccd/install-coordinator-skill.sh`); its skill text is installed only after its server half is deployed. No task adds a restart, a wake herd or a sleep herd (§Global constraints).

**Names.** Tasks are **W1-1**, **W1-1b**, **W1-2**, **W1-3**, **W1-4**, **W1-4b** and **W1-5**, the spec's §5.1 names. Operator acts are **OA-F1** to **OA-F4**.

**Goal, PR by PR.**

| After | The operator sees | Underneath |
|---|---|---|
| `main` | finished children awake for at least 6 h after close, most of them indefinitely; a refused coordinator stalls silently | stop-done holds `recent` (N), `reviewing`, every `held`, and `not-done` for a planned run; the caps charge live resumes and stale rows |
| W1-1 | finished children asleep about 10 minutes after their run reads `done`; mail-held children counted on the lane's feed | `stopDoneVerdict`'s clock is the run's close plus 10 minutes of turn-marker quiet; `reviewing`, programme holds, terminal-run holds and planned runs stop holding sleep for this policy |
| W1-1b | `failed` runs' workers, and producers parked at `awaiting-review`, `merging` or `closing` for 30 minutes, asleep too | the `run-done` policy's "finished" widened per F5 (b) |
| W1-2 | a live resume or a send-back is never refused `cap-concurrency` | `dispatchRun` and the advance route skip the concurrency check when nothing would start |
| W1-3 | runs whose worker is dead, asleep or long idle stop filling the concurrency cap | `capsMeasured` counts a run only while its worker is busy or was dispatched within 2 h (temporary; deleted at W3-4) |
| W1-4 | a refused coordinator is mailed when the cap frees; each refusal and wake is a feed row | `admissionWaitSince`; one `LANE_SCHEDULE` row; round-robin by programme, at most `WAKE_BURST` per `WAKE_WINDOW_MS` |
| W1-4b | a coordinator can take its own refused wave as the run's worker | the `inPlace` dispatch variant; the `self-dispatch` refusal; the additive `inPlace` flag |
| W1-5 | the refusal says "do this wave yourself unless a named reason applies" | the frames' `detail`; the coordinator skill's words, the tree rule, the in-place bind and the seven reasons |

---

## Gates: what each task waits for, stated honestly

Measured on 2026-10-20 at `3cc6e5fce` with `gh pr list -R Synapsium-Labs/ccrc-pwa --state open --json number,title,files` (28 open PRs) and `gh pr diff <n>` for each PR that holds a file this plan edits.

**Open PRs that hold a file this plan edits.**
- **#950** (accounts A12) holds `server/src/coord/routes.ts` (two hunks inside `registerCoordRoutes`'s account routes, far from the dispatch and advance routes), `server/src/server.ts`, `shared/api.ts` (the accounts types and `ACCOUNT_ACTS`, away from `RunRefuseCode`) and `server/test/single-definition.test.ts` (one appended block, "the account gate, the audit and the AccountOps …"). Line-disjoint from every hunk below today; each task re-measures at Step 0.
- **#832** (delegation flush) holds `server/src/watch.ts`, every hunk inside `DelegationLane` and the delegation constants. Disjoint from W1-1's `stopDonePass` wiring and W1-4's lane; W1-4 re-measures (only one series edits `watch.ts` at a time).
- **#962** (skins W2 S2d) holds `server/test/single-definition.test.ts` (one line in the tmux-sentence block). Disjoint.
- The skins chain (#960, #956), Settings R2b2 (#983) and the rest hold no file this plan edits. **No open PR** holds `server/src/stopDone.ts`, `server/src/stopDoneSweep.ts`, `server/src/coord/hibernate.ts`, `server/src/hibernateSweep.ts`, `server/src/coord/dispatch.ts`, `server/src/coord/caps.ts`, `server/src/coord/store.ts`, `server/src/coord/schema.ts`, `server/src/coord/rundefs.ts`, `server/src/coord/wakeBudget.ts` or `ccd/coordinator-skill/`.

**Planned work with no PR yet that will hold the same files** (each task's Step 0 re-runs `gh pr list` and keeps its hunks line-disjoint from any such PR, or waits for it):
- **Consolidation W1a** (`2026-10-19-consolidation-w1a-switches-notify.md`): C1a (#949), C1c (#945) and C1d (#961) **merged**. **C1b** (`watch.ts` and the executors' `reclaim-paused` reads; its ratchet keeps exactly one private parse site, `stopDoneSweep.ts`'s), **C1e** (the executors' feed writers; its ratchet pins the feed archive's writers at `notice.ts`'s `notify` and `stopDoneSweep.ts`'s pair) and **C1f** (`dedupeKey`, a coord.db `MIGRATIONS` entry, `watch.ts`) have no PR. W1-1 and W1-1b must leave `stopDoneSweep.ts`'s `reclaim-paused` read and its feed pair byte-identical, so both ratchets hold on either side. W1-4 needs C1f (the wake mail and the feed rows carry a `dedupeKey`).
- **Consolidation W1b** (`2026-10-20-consolidation-w1b-schedule-listing-redactor.md`): **C1h** (`LANE_SCHEDULE` in `server/src/laneSchedule.ts`, `runLane` in `watch.ts`; its ratchet leaves no hand-rolled lane clock but stop-done's and hibernation's) has no PR. W1-4's lane is a `LANE_SCHEDULE` row, so W1-4 waits for C1h. **C1k** (`ccdCan` sites in `coord/dispatch.ts` and `coord/routes.ts`) has no PR; rule 6 at Step 0 for W1-2, W1-3, W1-4b and W1-5.
- **Consolidation W4** (K1, `decideSleep`; it owns `stopDone.ts`, `stopDoneSweep.ts`, `hibernate.ts` and `hibernateSweep.ts`) has no plan. Spec §4 rules the order either way: if W4 lands first, W1-1 is one row's clock in `decideSleep`; if W1-1 lands first, W4's characterization pins the restored timing. A W4 PR open at W1-1's Step 0 makes W1-1 wait for it.
- **Mail and run truth, P1** (`2026-10-20-mail-and-run-truth-draft-never-blocks-rejected-m.md`): P1a to P1c merged. **P1d** (verbatim skill pins in `server/test/coordinator-skill.test.ts`; `ccd/worker-skill/`, `ccd/reviewer-skill/`, `mail-envelope.md`), **P1e** (`store.ts`, a migration, `watch.ts`'s `sweepMail`), **P1f** (a migration, `store.ts`, `shared/api.ts`, `watch.ts`'s `sweepStalls`) and **P1g** (the advance route's `{"to":"working"}` arm, `store.ts`'s `advanceFrom`, `wave-lifecycle.md` §4) have no PR. P1g gates W1-2's advance-route commit and W1-5's `wave-lifecycle.md` edit (line-disjoint, or after it). P1d gates W1-5's pin edits the same way. Every migration in this plan takes the next free `MIGRATIONS` slot measured at Step 0 and again before merge.
- **Coordinator durability tail** (`2026-10-20-coordinator-durability-tail-epic-ledger-d7-recon.md`): **DT2** (a `LANE_SCHEDULE` row, `sweepDrift` in `watch.ts`) has no PR; its `run-quiet` and `claimant-gone` findings are the words W1-3 points stale runs at. Rule 6 for W1-4's `watch.ts` commit.
- **Fleet operations** (`2026-10-20-fleet-operations-maintenance-mode-and-programme-.md`): **FP9** (`coord/dispatch.ts`, the `programme-v1` pass) and **FM6** (`watch.ts`, the refusal vocabulary in `shared/api.ts`) have no PR. Rule 6 for W1-2, W1-3, W1-4b and W1-5.

**Rulings and operator acts.** F5 (0) and (b) are ruled (spec §6.1). Hibernation is armed and N = 2 h (operator acts of 2026-10-20). The remaining operator acts are §Operator acts' OA-F1 to OA-F4.

| Task | Rulings | Operator acts | Open PRs, rule 6 at Step 0 | Other |
|---|---|---|---|---|
| W1-1 run-close timing | F5 (0) **ruled** | OA-F1 in the PR body before merge | no W4 (K1) PR open; C1b, C1e ratchets kept | — |
| W1-1b "finished" per F5 (b) | F5 (b) **ruled** | — | as W1-1 | W1-1 merged |
| W1-2 live resumes free | — | OA-F2 met (W1-1's gate); hibernation armed (**done**) | P1g (advance route), C1k, FP9 | W1-1 merged |
| W1-3 stale runs uncounted | — | OA-F2 met; OA-F3 in the PR body | C1k, FP9 | W1-2 merged |
| W1-4 wake refused coordinators | — | — | #832, DT2, P1e, P1f (`watch.ts`, migrations) | W1-3 merged; C1h merged; C1f merged |
| W1-4b in-place bind | — | — | #950, FM6 (`shared/api.ts`), C1k, FP9 | W1-4 merged |
| W1-5 the ruling in words | — | OA-F4 after deploy | P1d, P1g | W1-4 and W1-4b merged |

## Landing order

```
spec §6 ruled (F5) ─▶ W1-1 (sleep side) ─▶ W1-1b
                       │
                       └─ OA-F2 met (finished children asleep within 15 min), hibernation armed (done)
                              │
                              ▼
                      W1-2 ─▶ W1-3 ─▶ W1-4 ─▶ W1-4b ─▶ W1-5 (dispatch side)
                                       ▲
                                C1h and C1f merged
```

Two series, each one file series at a time. The **sleep side** (W1-1, W1-1b) edits `stopDone.ts`, `stopDoneSweep.ts`, `coord/store.ts`'s `lastRunBySession` and `coord/rundefs.ts`. The **dispatch side** (W1-2 to W1-5) edits `coord/dispatch.ts`, `coord/routes.ts` and, from W1-3, `coord/store.ts`. The two sides share `coord/store.ts`: W1-1's `lastRunBySession` commit and W1-3's store read never sit in the queue together. W1-2 and W1-3 wait for W1-1's gate (OA-F2) and hibernation's arming (done), because they loosen the only bound before memory frees otherwise (spec §7). W1-5 lands last, so the words never promise a wake or a bind that does not exist.

## Global constraints

- **Public repository.** Every word in code, tests, commits and PR bodies is publishable: no host, address, account or lane name, project name, home path, email, private tracker id or run id from the box. Fixtures are neutral (`s-aaaa`, `programme-a`, run 7). Never a private tracker id: cite D-numbers, ARCH-NN and GitHub `#n`.
- **Account switching and the auto-swap are never blocked.** No task reads a capacity figure on the swap path: `_auto_swap_check`, `_swap_idle_gate`, `_swap_target`, `cmd_swap`, `swap-self` and the swap routes are untouched, and no new refusal can reach them. A swap is never refused, delayed or reordered by anything here.
- **No herd restarts, no herd wakes, no sleep herd.** The `run-done` policy keeps `STOP_DONE_PER_PASS` (3 a pass) and its 60 s cadence. W1-3's freed slots and W1-4's wake mails are each bounded by the wake budget's `WAKE_BURST` per `WAKE_WINDOW_MS` (read by reference, never a second literal). No task adds a restart, a supervisor bounce or an `ensure` loop.
- **Hibernation's contract.** A sleeping session wakes only through `ensure` (mail under the wake budget, a dispatch's resume, an open screen, the operator's Wake); an asked wake is never refused (D-5242). W1-1 and W1-1b change only **when** the `run-done` policy sleeps a worker, never **how**: it still composes `ccd hibernate`, re-measures at the act on the coordination serialiser (D-5428), and keeps every use-hold (viewer, attached, menu, bucket, background, roster, marker, marker-background, scheduled, opted-out, claim, `mail`). The `idle-hours` policy (`hibernateVerdict`) is not edited by this plan: F6 (i) reaches it through the sleep-decider merge (consolidation K1).
- **Sleep versus retire** (spec §3.0). A hold that guards a **workspace** (a programme hold, a terminal run's hold, a cited review report, a planned run naming it) guards retirement only and stops holding sleep for the `run-done` policy. A **use** (a turn, background work, a viewer, a terminal, crons, unacknowledged mail, an active run) always holds sleep. A `.hold` written by the operator by hand (any text outside the programme-hold grammar) stays a sleep hold. Nothing here changes `decideRetire`'s reasons or evidence, `childReclaimSweepVerdict`'s `review-report-live`, or close-time reclaim.
- **Coordinator-first routing.** Wake mail to a refused coordinator goes through `queueSystemMail` (the kickoff path) to the run's `claimedBy`; nothing here sends to the operator in a coordinator's place, and no ask or permission prompt changes route.
- **The ccrc SAFETY rules.** No task adds or edits a `ws-*` destructive verb, a unit or tmux touch, or what a reclaim deletes. W1-1 and W1-1b only stop holding **sleep**; retirement keeps its bar.
- **The spec's Rejected list binds.** No `maxResidentSessions` cap and no live-session cap (#456 stays unbuilt; F7 (a)); no cgroup cap; no in-request sleep or settle inside `dispatchRun` (`coordMutex` is non-reentrant; spec §3.4); no automatic close of a stale run (that stays the coordinator's act); no report copy (W2-1 dropped); no inline review by a coordinator (reason 1; clause 14); no per-account cap (placement is a key, W5); no change to what the daily brake counts before W3-5 (F3).
- **Characterization first.** Every behaviour change is preceded, in the same PR, by a characterization commit that pins today's answer and is green on the base. The **behaviour commit** is its own commit, never squashed with a refactor, flips exactly the pinned rows the task names, and the PR body lists every before/after row and cites the ruling (W1-1: the operator's 2026-10-17 ruling and F5 (0); W1-1b: F5 (b); W1-2 and W1-3: spec §3.4 and §5.1, ruled through §6.1; W1-4, W1-4b, W1-5: spec §3.5).
- **Red first, then a mutation table, RUN.** Every new test is shown red on the base (or on the characterization commit) before the code that greens it. Each mutation table is run on a `git archive` copy of the PR's tip under the scratch directory, never in the worktree, and each row's red test name is printed in the PR body.
- **Wire discipline.** Additive only: new optional fields (`detail`, `inPlace`), one new `RunRefuseCode` member (`self-dispatch`), nullable columns with no `NOT NULL` and no `CHECK`, so a rollback stays bootable (`db.ts` rule 3). No frame is renamed or removed; no `FLEET_PROTO` bump.
- **Counts measured, not assumed.** Every figure in a PR body (finished children held only by `mail`, stale runs, refusals) is measured by an operator act (§Operator acts) or by a suite, never typed from this plan.
- **Test discipline.** vitest always `--maxWorkers=2`, one suite at a time; never the full server suite locally.
- **Deviation ledger.** This plan defines D-6091 to D-6097, one per task, and never allocates. 6098, 6099 and 6100 are issued and unused, held for departures and entered by the coordinator only.

## Review focus (the failure modes most likely to bite)

1. **A use that stopped holding.** W1-1 and W1-1b move exactly the holds the spec names (`reviewing`; a programme hold; a terminal run's hold; `not-done` and `run-worker` for a `planned` run; in W1-1b, `failed` and the idle run states after 30 minutes). Every other hold returns exactly as before, in the same order. A diff that touches `mail`, `viewer`, `claim`, `opted-out`, `scheduled`, `marker`, `marker-background` or the act-time re-measure is refused.
2. **An operator hold read as a programme hold.** The programme-hold grammar is read by the one pattern that validates it (`HOLD_REASON_PATTERN`), never re-spelled. Text it does not match, or a `run:` suffix whose run state cannot be read, holds sleep (fail closed).
3. **An unmeasured read that acts.** Every new input (the hold's run state, the newest placed run, a worker's liveness in W1-2 and W1-3, the claimant's project in W1-4b) answers "hold" or "counted" or "refused" when it cannot be read, never "free".
4. **A loosening that starts a process.** W1-2's free path is only for a session that reads **live** (registry row present, not `.hibernated`, not stopped, not archived, pane alive). A hibernated worker's resume starts a process and keeps today's check. W1-3's predicate frees slots no faster than the wake budget's rate.
5. **A lock taken twice.** Nothing new runs inside `coordMutex` that also takes it: no sleep, no wait, no settle in `dispatchRun`; W1-4's lane takes the serialiser once per pass, outside any request.
6. **A wake herd.** W1-4 sends at most `WAKE_BURST` mails per `WAKE_WINDOW_MS`, one per programme per round, oldest refusal first, each with its `dedupeKey`; a coordinator already mailed for a refusal is not mailed again for the same stamp.
7. **A bind that touches the fleet.** W1-4b's in-place arm runs no `ensure`, no `ws-hold`, no `ccd route`, no brief mail and no `/clear`. A non-claimant, a uuid mismatch or a project mismatch is refused before any write. A plain dispatch onto the claimant is refused `self-dispatch` before any fleet act.
8. **Words that promise what does not exist.** W1-5's text names only the in-place bind (W1-4b), the wake-on-free mail (W1-4) and the seven reasons of spec §3.5, exactly; `capacity` is described as a later refusal and never returned by this wave.
9. **A ratchet broken across the hall.** `stopDoneSweep.ts`'s `reclaim-paused` read and its `recordFeedEvent` pair are byte-identical across W1-1 and W1-1b (W1a C1b's and C1e's ratchets count them).

## Tasks

### Task W1-1: finished workers sleep at run close — the `run-done` policy's clock is the close, and the holds that guard a workspace stop holding sleep (D-6091; spec §3.1, §5.1 W1-1, §6 F5 (0)) — GATED: F5 (0) ruled; OA-F1 in the PR body before merge; no consolidation W4 PR open

**Routing:** **band 3, native** (a lane that acts on live sessions; the behaviour commit restores an operator ruling). Two reviewers: one reads only Review focus 1 to 3 and 9; one checks the before/after rows against the 2026-10-17 ruling and F5 (0). **Lane:** server. **Needs:** nothing merged; OA-F1 measured before merge.

**Files:**
- Modify `server/src/stopDone.ts`:
  - `StopDoneInput`: `afterMs` is removed (the lane no longer reads N); `heldKind: 'none' | 'operator' | 'programme' | 'run-terminal' | 'run-open' | 'unreadable'` is added, classified by the sweep (L4), so this L1 file still imports L0 alone.
  - `StopDoneStoreRead` (`ok: true`): `last` becomes the session's newest **placed** run (newest run whose state is not `planned`); `openWorker` becomes "a run outside the terminal set **and** outside `planned` names it"; `reviewing` is removed.
  - `stopDoneVerdict`: `held` holds only for `heldKind` `operator`, `run-open` or `unreadable`; `programme` and `run-terminal` pass. The `reviewing` arm is deleted. The `recent` arm is replaced by `quiet`: the newest of the marker's `turnAt`, `stopAt`, `restartAt` must be at least `graceMs` old, and no stamp holds. Every other arm, its word and its order are unchanged.
  - `STOP_DONE_HOLD_MAP`: `reviewing` and `recent` leave; `quiet` joins with its meaning ("its last main event is less than the grace old, or the marker carries no stamp to age"). The module docstring's D-5427 paragraph is rewritten to say which of hibernation's holds the lane keeps (`opted-out`, `scheduled`, `attached` at the act) and that its clock is the run's close (D-6091).
- Modify `server/src/stopDoneSweep.ts`: `stopDonePass` stops reading `hibernate-after-hours` for this lane; `storeReadFor` builds the new `last` and `openWorker` from `lastRunBySession`'s additive fields and drops `expiryReviewing`; the row's `held` text is classified with the programme-hold reader (below), and a `run:` suffix's run state is read through the store's run read (Step 0 names it; unreadable → `unreadable`). The act-time re-read (the serialiser's second `storeReadFor`) classifies the same way. **Byte-identical:** the `reclaim-paused` read and the `recordFeed` pair (Review focus 9).
- Modify `server/src/coord/rundefs.ts`: export one reader over `HOLD_REASON_PATTERN`, `programmeHoldOf(text) → { program, wave, runId } | null`, so no second spelling of the grammar exists (`single-definition.test.ts` keeps one definer).
- Modify `server/src/coord/store.ts` `lastRunBySession`: two additive fields, `lastPlaced: LastRun[]` (each asked session's newest run whose state is not `planned`) and `openPlacedWorkers: string[]` (the asked sessions a run outside the terminal set and outside `planned` names), inside the same synchronous call. `last`, `openWorkers` and `openClaimants` are byte-identical for `fleet.ts` and `watch.ts`'s archived-row reader.
- Modify `server/test/stop-done-verdict.test.ts`, `server/test/stop-done-sweep.test.ts`; the `single-definition.test.ts` stop-done block ("the stop-done lane's kill switch has no writer, and its constants one home") only if its constant list names a removed word.

- [ ] **Step 0: Re-ground** every symbol above on the tree; confirm no consolidation W4 PR is open (`gh pr list --search decideSleep` and the W4 plan's absence); rule 6 for every file. Name the store's run read used for a `run:` suffix's state.
- [ ] **Step 1: Characterization commit** (green on the base). In `stop-done-verdict.test.ts`, today's answers for every row the behaviour commit will flip, each named "today:": (a) a `done` child, 11 minutes after close, marker quiet 11 minutes, `afterMs` 6 h → `recent`; (b) the same child with a programme hold `program:programme-a wave:3` → `held`; (c) with `program:programme-a wave:2 run:7` and run 7 `done` → `held`; (d) reviewing an open run → `reviewing`; (e) a `planned` run naming it as its newest run → `not-done`; (f) the same planned run as an open worker run → `run-worker`. And the rows that must **not** flip, named "kept:": an operator `.hold` text (`keep: debugging`) → `held`; outstanding mail → `mail`; a viewer → `viewer`; `crons` 1 → `scheduled`; `opted-out`; an `awaiting-review` newest run → `not-done` (W1-1b's, not this task's); grace not passed → `grace`. In `stop-done-sweep.test.ts`: the lane reads `hibernate-after-hours` today, and the act-time re-read holds a hold raised between pass and act.
- [ ] **Step 2: Red.** `programmeHoldOf` rows (a programme hold, one with `run:`, an operator text, an empty string, an oversize text) — red (no export). `lastRunBySession`'s two fields over a store with a planned newest run and a placed older one — red. The verdict's new rows: "a programme-held finished child sleeps at 10 min"; "a terminal run's hold does not hold sleep"; "a `run:` hold whose run is open holds"; "a `run:` hold whose run state is unreadable holds"; "a planned run naming the child does not hold sleep"; "a reviewer of an open run sleeps at 10 min"; "no marker stamp holds `quiet`"; "a marker that moved 9 minutes ago holds `quiet`" — red on the characterization commit.
- [ ] **Step 3: Green, in commits.** (1) `programmeHoldOf`; (2) `lastRunBySession`'s additive fields; (3) the sweep's classification and new store read, with the verdict still answering today's words (the input carries both); (4) **the behaviour commit**: the verdict's clock, the moved holds and the hold-map words, flipping exactly Step 1's "today:" rows (a) to (f) and no "kept:" row. The PR body lists each before/after row and cites the operator's 2026-10-17 ruling ("stop workers at run close") and F5 (0) of 2026-10-20.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `held` passes for `heldKind` `operator` | stop-done-verdict | "kept: an operator .hold holds" |
  | `held` passes for `unreadable` | stop-done-verdict | "a `run:` hold whose run state is unreadable holds" |
  | the `mail` arm deleted | stop-done-verdict | "kept: outstanding mail holds" |
  | `quiet` compares against 6 h (the old N) | stop-done-verdict | "a programme-held finished child sleeps at 10 min" |
  | `quiet` with no stamp acts | stop-done-verdict | "no marker stamp holds `quiet`" |
  | `lastPlaced` includes `planned` rows | coord-store or stop-done-sweep | "a planned run naming the child does not hold sleep" |
  | `programmeHoldOf` accepts any text starting `program:` | stop-done-verdict / rundefs rows | the oversize and malformed rows |
  | the act-time re-read skips classification | stop-done-sweep | "a hold raised between pass and act holds" |
  | `last` (not `lastPlaced`) changed for `fleet.ts` | the fleet `releasedFrom` suite Step 0 names | its existing rows |

- [ ] **Step 5: Verify.**

      cd server && ./node_modules/.bin/tsc --noEmit
      cd server && ./node_modules/.bin/vitest run test/stop-done-verdict.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/stop-done-sweep.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/hibernate-verdict.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/hibernate-sweep.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2

  plus the store and fleet suites that read `lastRunBySession` (Step 0 names them), one at a time.

**Exit (GATES):** the `run-done` policy reads no N; `reviewing`, programme holds, terminal-run holds and planned runs hold no sleep for it; every use-hold and the act-time re-measure unchanged; `idle-hours` untouched; OA-F1's counts in the PR body. **After deploy:** OA-F2. **Rollback:** `git revert` of the behaviour commit restores today's timing; `stop-done-disabled` stops the lane with no deploy.

### Task W1-1b: "finished" per F5 (b) — `failed` runs, and producers parked at `awaiting-review`, `merging` or `closing` after 30 minutes idle (D-6092; spec §3.1, §5.1 W1-1b, §6 F5 (b)) — GATED: after W1-1; F5 (b) ruled

**Routing:** **band 3, native.** Two reviewers, one reading only Review focus 1 and 3. **Lane:** server. **Needs:** W1-1.

**Files:**
- Modify `server/src/stopDone.ts`: a run is **finished** for this policy when its state is `done` or `failed` (closed, `closedAt` set; `close-unplaced` keeps holding a finished run with no close time), or when it is a producer's run parked in `awaiting-review`, `merging` or `closing` (the idle members of `IDLE_RUN_STATES` other than `planned`) and the marker has been quiet for `STOP_DONE_PARKED_IDLE_MS` (30 minutes; a new constant beside `STOP_DONE_GRACE_MS`). `openWorker` (W1-1's "outside the terminal set and outside `planned`") narrows to "a run in `ACTIVE_RUN_STATES` names it", for this policy only. The `not-done` word's meaning is reworded to the new set.
- Modify `server/src/stopDoneSweep.ts`: `storeReadFor` reads the active-only worker set from `lastRunBySession` (W1-1's additive field narrowed, or a third additive field; Step 0 chooses the smaller diff).
- Modify `server/src/coord/store.ts` only if the active-only set needs its own field.
- Modify `server/test/stop-done-verdict.test.ts`, `server/test/stop-done-sweep.test.ts`.

- [ ] **Step 0: Re-ground**; confirm a `failed` close stamps `closedAt` (the store's `advanceInner` `closedAt` rule) and that a send-back (advance `awaiting-review` → `working`) and a merge step reach a sleeping producer through mail or `ensure`; rule 6.
- [ ] **Step 1: Characterization commit** (green on W1-1's tip): "today:" a `failed` newest run → `not-done`; an `awaiting-review` newest run, marker quiet 31 minutes → `not-done`; the same at `merging` and at `closing` → `not-done`; "kept:" an `awaiting-review` run, marker quiet 29 minutes → holds; a `working` run → holds; a `dispatched` run → holds; an `unknown` run → holds.
- [ ] **Step 2: Red.** "a failed run's worker sleeps 10 minutes after close"; "a producer parked at awaiting-review sleeps after 30 minutes quiet"; "… at merging"; "… at closing"; "a parked producer quiet 29 minutes holds"; "an active run holds".
- [ ] **Step 3: Green: the behaviour commit**, flipping exactly the "today:" rows; the PR body lists them and cites F5 (b) (2026-10-20), naming `failed` as a change from D-5370.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `STOP_DONE_PARKED_IDLE_MS` read as `STOP_DONE_GRACE_MS` | stop-done-verdict | "a parked producer quiet 29 minutes holds" |
  | `unknown` dropped from the active set | stop-done-verdict | "kept: an unknown run holds" |
  | `failed` with `closedAt` null acts | stop-done-verdict | "close-unplaced holds" |
  | `planned` counted as parked | stop-done-verdict | W1-1's planned-run row |

- [ ] **Step 5: Verify** as W1-1's Step 5.

**Exit (GATES):** finished = `done` or `failed`, or parked 30 minutes; active runs and every use-hold still hold. **Rollback:** `git revert` (W1-1's timing stays).

### Task W1-2: a live resume and a send-back of a live worker skip the concurrency check (D-6093; spec §3.4 "What is free and what is charged", §5.1 W1-2) — GATED: after W1-1; OA-F2 met; hibernation armed (done)

**Routing:** **band 3, native** (it loosens the fleet's only bound). Two reviewers, one reading only Review focus 3 to 5. **Lane:** server. **Needs:** W1-1 merged and OA-F2 met.

**Files:**
- Modify `server/src/coord/dispatch.ts` `dispatchRun`: the resume-versus-fresh question (`run.sessionId === null`) and the target's liveness are read **before** step 2. Liveness is measured from the listing step 1 already took and the registry row: listed, not `<id>.hibernated`, not stopped, not archived, its pane alive (the same reads D-5238's live gate and the `admitWake` branch use; Step 0 names them). A resume of a session that reads live skips the concurrency check only; the daily check (`dispatchedIn24h`) is unchanged (F3 is W3-5). Unreadable liveness, a hibernated, stopped, archived or dead session, and every fresh spawn take today's check.
- Modify `server/src/coord/routes.ts`, the advance route's `IDLE_RUN_STATES` → `working` edge: the `capsMeasured` check is skipped when the run's worker reads live (the same predicate, one definition, exported from `dispatch.ts` beside `capsMeasured`), and kept otherwise. `review-in-flight` stays ahead of it.
- Modify `server/test/run-routes.test.ts` (the advance cap pin) and add `server/test/caps-live-resume.test.ts`.

- [ ] **Step 0: Re-ground**; rule 6: P1g's advance-route hunk (if its PR is open, this task's advance commit waits unless line-disjoint), C1k's and FP9's `dispatch.ts` hunks.
- [ ] **Step 1: Characterization commit** (green on the base): "today:" a resume of a live idle worker at `running == maxConcurrentWorkers` → `cap-concurrency` with `limit` and `running`; a send-back of a live worker at a full cap → `409 cap-concurrency`. "kept:" a fresh spawn at a full cap → `cap-concurrency`; a resume of a hibernated worker at a full cap → `cap-concurrency`; a resume at a full daily brake → `cap-daily`; `paused` and `mail-disabled` still refuse first.
- [ ] **Step 2: Red.** "a live resume at a full concurrency cap dispatches"; "a send-back of a live worker at a full cap advances"; "an unmeasurable liveness is charged".
- [ ] **Step 3: Green.** (1) the liveness predicate, unused; (2) **the behaviour commit**, `dispatchRun`; (3) **the behaviour commit**, the advance route. The PR body lists the before/after rows and cites spec §3.4 and §5.1 (W1-2), ruled through §6.1.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | a hibernated session reads live | caps-live-resume | "kept: a hibernated resume at a full cap refuses" |
  | unmeasurable liveness reads live | caps-live-resume | "an unmeasurable liveness is charged" |
  | the daily check skipped too | caps-live-resume | "kept: a resume at a full daily brake refuses" |
  | the fresh branch skips the check | caps-live-resume | "kept: a fresh spawn at a full cap refuses" |
  | the liveness read moved ahead of the pause check | dispatch-route or run-routes | "paused refuses first" |

- [ ] **Step 5: Verify** `caps-live-resume.test.ts`, `run-routes.test.ts`, `dispatch-route.test.ts`, `dispatch-live-gate.test.ts`, `dispatch-mutex-gate.test.ts`, `coord-caps-route.test.ts`, one at a time, then `tsc --noEmit`.

**Exit (GATES):** live resumes and live send-backs never refused `cap-concurrency`; every process-starting dispatch charged as today; `dispatchedIn24h` unchanged. **Rollback:** `git revert`; the operator's concurrency dial is the zero-deploy brake.

### Task W1-3: stale runs are not counted (temporary) — `capsMeasured` counts a run only while its worker is busy or was dispatched within 2 hours (D-6094; spec §3.4 "Stale runs never hold capacity", §5.1 W1-3) — GATED: after W1-2; OA-F2 met; OA-F3 in the PR body

**Routing:** **band 3, native.** Two reviewers, one reading only Review focus 3 and 4. **Lane:** server. **Needs:** W1-2.

**Files:**
- Modify `server/src/coord/store.ts`: one read, `activeRunWorkers()` → `{ runId, sessionId, dispatchedAt }[]` for every run in `ACTIVE_RUN_STATES` (`capsUsage` stays a plain SQL count, unchanged, for the caps view).
- Modify `server/src/coord/dispatch.ts` `capsMeasured`: it takes a liveness port (`workerReading(sessionId) → 'busy' | 'idle' | 'gone' | 'unmeasured'`, built from today's `liveStatus` and turn verdict, the source K3 will replace; `gone` covers dead, stopped, hibernated and archived) and counts a run only while its worker reads `busy` or `unmeasured`, or it was dispatched within `STALE_RUN_COUNTED_MS` (2 hours, a constant with its reason). A row with no `sessionId` is counted. `overConcurrency` carries the filtered count as `running`. **The rate:** when the raw count is at the limit and the filtered count is below it (a slot the predicate freed), the admit takes the wake budget's window with `wakeAdmit(…, 'auto')`; a full window refuses `cap-concurrency` as today, so freed slots go out at most `WAKE_BURST` per `WAKE_WINDOW_MS`. The predicate and the rate carry a comment that W3-4 deletes them.
- Modify `server/src/coord/routes.ts`: the advance route and the dispatch route pass the same port (one builder).
- Add `server/test/caps-stale-runs.test.ts`; modify `server/test/coord-caps-route.test.ts` only if its view pin reads `capsMeasured`.

- [ ] **Step 0: Re-ground**; read OA-F3's measurement (are the stale runs' workers busy?) into the PR body; rule 6 for C1k and FP9.
- [ ] **Step 1: Characterization commit** (green on W1-2's tip): "today:" a 6-day `dispatched` run whose worker is dead counts toward `running`; a run whose worker has been idle 3 h counts. "kept:" a busy worker's run counts; a run dispatched 1 h ago with an idle worker counts; a row with no `sessionId` counts.
- [ ] **Step 2: Red.** "a 6-day dispatched run with a dead worker is not counted"; "a busy one is"; "an idle, not hibernated, not dead worker is counted for its first 2 h"; "a hibernated worker's run is not counted"; "an unmeasured worker is counted"; "slots freed by the predicate are handed out no faster than WAKE_BURST a window"; "the advance route and dispatch agree on one reading".
- [ ] **Step 3: Green.** (1) `activeRunWorkers`; (2) the port, wired, predicate off; (3) **the behaviour commit**: the predicate and the rate. The PR body lists the before/after rows and cites spec §3.4 and §5.1 (W1-3).
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `unmeasured` read as not counted | caps-stale-runs | "an unmeasured worker is counted" |
  | `STALE_RUN_COUNTED_MS` set to 0 | caps-stale-runs | "counted for its first 2 h" |
  | the freed-slot admit skips `wakeAdmit` | caps-stale-runs | "no faster than WAKE_BURST a window" |
  | the freed-slot admit uses `'asked'` | caps-stale-runs | the same row |
  | `capsUsage` changed to the filtered count | coord-caps-route | its plain-count pin |

- [ ] **Step 5: Verify** `caps-stale-runs.test.ts`, `caps-live-resume.test.ts`, `run-routes.test.ts`, `dispatch-route.test.ts`, `coord-caps-route.test.ts`, `wake-budget.test.ts`, one at a time, then `tsc --noEmit`.

**Exit (GATES):** stale rows free their slot; freed slots rate-limited; the predicate marked for deletion at W3-4. **Rollback:** `git revert`; the zero-code fallback is the operator raising the concurrency dial (spec §5.1).

### Task W1-4: refused coordinators are woken — `admissionWaitSince`, one `LANE_SCHEDULE` row, round-robin by programme, every refusal and wake logged (D-6095; spec §3.5 "The server wakes waiting coordinators", §5.1 W1-4) — GATED: after W1-3; consolidation C1h and C1f merged

**Routing:** **band 3, native** (a new lane that mails coordinators; wake-herd risk). Two reviewers, one reading only Review focus 5 and 6. **Lane:** server (one nullable coord.db column).

**Files:**
- Modify `server/src/coord/schema.ts` / `db.ts` `MIGRATIONS` (the next free slot, measured at Step 0 and before merge): `ALTER TABLE runs ADD COLUMN admissionWaitSince INTEGER` (nullable, no `CHECK`).
- Modify `server/src/coord/store.ts`: `stampAdmissionWait(runId, at)` (writes only when null, so the oldest refusal is kept), `clearAdmissionWait(runId)` (on dispatch, abandon or close), and `admissionWaiters()` → `{ runId, program, claimedBy, since }[]` for `planned` runs with a stamp.
- Modify `server/src/coord/dispatch.ts` `dispatchRun`: on `cap-concurrency` and `cap-daily`, stamp the run inside the mutex (one store write; the run stays `planned`); a successful dispatch clears it.
- Create `server/src/coord/admissionWake.ts` (L1): `admissionWakeChoice(waiters, room, recentWakes, now)`, pure: whether the cap has room (a free concurrency slot by `capsMeasured`, and for a `cap-daily` waiter `dispatchedIn24h < maxSessionsPerDay`), then the oldest waiter per programme, programmes served round-robin from the one served longest ago, at most what `wakeAdmit` admits in the window (`WAKE_BURST`, `WAKE_WINDOW_MS`, by reference).
- Modify `server/src/laneSchedule.ts`: one row, `admission-wake`, cadence by reference to `WAKE_WINDOW_MS`, `flight: 'skip'`.
- Modify `server/src/watch.ts`: the lane's body through `runLane`: read waiters, decide, and for each chosen waiter `queueSystemMail` to `claimedBy` (subject `capacity: room for run <id>`), one journal line and one feed row through `notify` with `dedupeKey` `admission-wake:<runId>:<since>`. The lane does nothing while `coordinator-paused` or `mail-disabled` is set or the listing is unreadable (`readSwitches`, fail shut).
- Modify `server/src/coord/routes.ts`, the dispatch route, after the mutex: a `cap-concurrency` or `cap-daily` outcome writes one journal line and one feed row (`dedupeKey` `admission-refused:<runId>:<since>`).
- Create `server/test/admission-wake.test.ts`.

- [ ] **Step 0: Re-ground** C1h's row shape and `runLane`, C1f's `dedupeKey`, the `MIGRATIONS` slot; rule 6 for `watch.ts` (#832, DT2, P1e, P1f) and the migration slot.
- [ ] **Step 1: Characterization commit** (green on the base): a refused dispatch writes nothing today and the run stays `planned`; a refusal sends no mail and no feed row.
- [ ] **Step 2: Red.** "a refusal followed by a freed slot sends one mail"; "two programmes waiting are served alternately"; "the oldest refusal in a programme goes first"; "a third wake inside one window waits for the next"; "a run dispatched or abandoned since its refusal is not mailed"; "the same refusal stamp is mailed once" (the key); "paused, mail-disabled or an unlistable registry sends nothing"; "a cap-daily waiter waits for the rolling window"; "the stamp keeps the oldest refusal"; "the migration is nullable".
- [ ] **Step 3: Green**, in commits: the column; the store calls; the stamp in `dispatchRun`; the decider; the row and the lane body; the route's refusal log.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the decider ignores `wakeAdmit` | admission-wake | "a third wake inside one window waits" |
  | round-robin replaced by oldest-overall | admission-wake | "two programmes are served alternately" |
  | the lane runs while `coordinator-paused` is set | admission-wake | "paused sends nothing" |
  | the mail sent without its `dedupeKey` | admission-wake | "the same refusal stamp is mailed once" |
  | `stampAdmissionWait` overwrites | admission-wake | "the stamp keeps the oldest refusal" |
  | the migration adds `NOT NULL` | the migration suite | the rollback-bootable row |

- [ ] **Step 5: Verify** `admission-wake.test.ts`, `run-routes.test.ts`, `dispatch-route.test.ts`, `wake-budget.test.ts`, the migration and `coord-store` suites, `single-definition.test.ts` (C1h's lane-clock ratchet), one at a time, then `tsc --noEmit`.

**Exit (GATES):** every refusal and every wake is a journal line and a feed row; wakes bounded by the wake budget's rate; one schedule row, no hand clock. **Rollback:** `git revert`; the column stays, unused and harmless.

### Task W1-4b: the in-place bind — a coordinator takes its own refused wave as the run's worker; a plain dispatch onto the claimant is refused `self-dispatch` (D-6096; spec §3.5 "The binding", §5.1 W1-4b) — GATED: after W1-4

**Routing:** **band 3, native** (the run state machine and an identity check). Two reviewers, one reading only Review focus 3 and 7. **Lane:** server (one nullable coord.db column).

**Files:**
- Modify `shared/api.ts`: `self-dispatch` joins `RunRefuseCode` and `RUN_REFUSE_CODE_MAP`, with its docstring; the run read carries an optional `inPlace: boolean`.
- Modify `server/src/coord/schema.ts` / `db.ts` `MIGRATIONS` (next free slot): `ALTER TABLE runs ADD COLUMN inPlace INTEGER` (nullable).
- Modify `server/src/coord/store.ts`: `bindInPlace(runId, sessionId, at)`: `planned` → `working` in one transaction, `sessionId` = the claimant, `inPlace` = 1, `resumed` = 0, one `run_events` row (`causedBy` `coordinator`, detail `in-place`), the admission stamp cleared.
- Modify `server/src/coord/dispatch.ts`: (a) `dispatchRun` refuses `self-dispatch` when `run.sessionId` equals `run.claimedBy`, right after the stored-session-id check and before the pause listing, so it composes nothing; (b) a new `bindRunInPlace(deps, id, by, byUuid)` inside `coordMutex`: the pause and `mail-disabled` listing (fail shut, as dispatch's step 1: the operator's stop binds every path), then `run.state === 'planned'`, `run.claimedBy === by`, the caller's uuid verified, the claimant's measured project equal to the run's project (the measure `project-mismatch` uses), then `bindInPlace`. No caps, no admission, no `ensure`, no `ws-hold`, no `ccd route`, no brief mail, no `/clear`.
- Modify `server/src/coord/routes.ts`, the dispatch route: a body with `inPlace: true` requires `by` and `byUuid`, verifies them with `attributionVerdict` (`claimedByUuid`) and calls `bindRunInPlace`; any other `inPlace` value is `bad-request`.
- Create `server/test/dispatch-in-place.test.ts`.

- [ ] **Step 0: Re-ground**; confirm whether any live caller plain-dispatches a self-claimed run (D-3012 admits one at open; kickoff and `dispatchAgain` included) and report it; rule 6 for `shared/api.ts` (#950, FM6) and the migration slot.
- [ ] **Step 1: Characterization commit** (green on the base): today's dispatch of a fresh run (spawn, hold, brief), of a resume (ensure, `/clear`, route) and of a self-claimed run whose `sessionId` is its claimant (today: the resume arm runs, `ensure` on the coordinator), each recorded as the fleet acts it composes.
- [ ] **Step 2: Red.** "an in-place bind moves planned to working with no fleet act"; "a non-claimant inPlace is refused"; "a uuid mismatch is refused"; "a project mismatch is refused"; "a run not planned is refused"; "paused refuses an in-place bind"; "a plain dispatch to the claimant is refused self-dispatch and composes nothing"; "an in-place run reaches awaiting-review and opens a review run"; "an in-place run closes as any run does"; "the migration is nullable".
- [ ] **Step 3: Green**, in commits: the column and the store call; the refusal code; `bindRunInPlace`; the route; **the behaviour commit**: the `self-dispatch` refusal (it flips Step 1's self-claimed row; the PR body says so and cites spec §3.5).
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `bindRunInPlace` calls `ensure` | dispatch-in-place | "with no fleet act" |
  | the claimant check skipped | dispatch-in-place | "a non-claimant inPlace is refused" |
  | the uuid not verified | dispatch-in-place | "a uuid mismatch is refused" |
  | the pause listing skipped | dispatch-in-place | "paused refuses an in-place bind" |
  | `self-dispatch` checked after `ensure` | dispatch-in-place | "composes nothing" |
  | `inPlace` binds a `working` run | dispatch-in-place | "a run not planned is refused" |

- [ ] **Step 5: Verify** `dispatch-in-place.test.ts`, `dispatch-route.test.ts`, `run-routes.test.ts`, `open-run-preconditions.test.ts`, `dispatch-hold-order.test.ts`, `coordinator-skill.test.ts` (it harvests refusal frames), the migration suite, one at a time, then `tsc --noEmit`.

**Exit (GATES):** a coordinator can bind its own run without any fleet act; the unsafe path refuses before it acts. **Rollback:** `git revert`; the column stays, unused.

### Task W1-5: the do-it-yourself ruling in words — refusal details and the coordinator skill (D-6097; spec §3.5 "The refusal words say so", §5.1 W1-5) — GATED: after W1-4 and W1-4b; P1d and P1g line-disjoint or merged

**Routing:** band 2. The edits are literal text plus their pins; a `/handoff` worker with `--runner opencode` may do the text, and the orchestrator reviews the diff against spec §3.5 word for word. **Lane:** server (the frames' `detail`), then skills (`ccd/coordinator-skill/`, installed after the server deploy). **Needs:** W1-4, W1-4b.

**Files:**
- Modify `server/src/coord/dispatch.ts` and the advance route in `server/src/coord/routes.ts`: the `cap-concurrency` and `cap-daily` frames gain an additive `detail` with spec §3.5's text in substance for a cap ("No room under the <cap> (<numbers>). Do this wave in your own workspace now (an in-place bind and a sibling worktree), unless one of the reasons in the coordinator skill applies; if one does, end your turn and the server will mail you when there is room."), built once from the frame's own numbers. The `limit`, `running` and `used` fields are unchanged.
- Modify `shared/api.ts`: the two frames' optional `detail`.
- Modify `ccd/coordinator-skill/SKILL.md`: "When something is wrong"'s cap entry and the crossing paragraph's "wait to be woken" sentence are rewritten to the operator's 2026-10-20 ruling (quoted verbatim from spec), the tree rule (a sibling `git worktree add` from `origin/main` inside the coordinator's workspace; its own checkout and programme ledger never switched or committed), the in-place bind (`inPlace: true` with `by` and `byUuid`), routed asks while self-working, and the seven reasons of spec §3.5, each in one line.
- Modify `ccd/coordinator-skill/references/wave-lifecycle.md`: the refusal table's two cap rows ("stop, name the cap, wait" → "do it yourself unless a named reason applies; otherwise end the turn and wait for the server's mail").
- Modify `server/test/coordinator-skill.test.ts` and `server/test/crossrepo-prose.test.ts`: their pins over the rewritten text.

- [ ] **Step 0: Re-locate** every passage (`git grep -n "wait to be woken\|name the cap" ccd/`) and every suite that reads them; rule 6 for P1d's pins and P1g's `wave-lifecycle.md` §4.
- [ ] **Step 1: Red.** Pins: the cap entry names the ruling, the tree rule, the in-place bind and all seven reasons; no "wait to be woken" remains in `ccd/coordinator-skill/`; both frames carry a `detail` that names the in-place bind and the wake mail; `detail` never appears on a non-cap refusal. Red on the base.
- [ ] **Step 2: Green**, in commits: the frames; the skill text; the reference table; the pins.
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | one reason dropped from the skill | coordinator-skill | "all seven reasons" |
  | "wait to be woken" left in the crossing paragraph | coordinator-skill or crossrepo-prose | "no wait-to-be-woken remains" |
  | `detail` on `paused` | dispatch-route | "detail only on the cap refusals" |
  | `running` renamed in the frame | coordinator-skill | its frame-field harvest |

- [ ] **Step 4: Verify** `coordinator-skill.test.ts`, `crossrepo-prose.test.ts`, `install-coordinator-skill.test.ts`, `dispatch-route.test.ts`, `run-routes.test.ts`, one at a time, then `tsc --noEmit`.

**Exit (GATES):** no coordinator-facing text says "wait to be woken" for a cap; the frames and the skill say the same thing. **After deploy:** OA-F4. **Rollback:** `git revert`, then the skill installer re-run.

## Operator acts in this wave

Every act below reads or changes the fleet box; none is done by a worker.

- **OA-F1 (before W1-1 merges): the baseline.** Read-only. Count (a) finished children (newest run `done`) held only by `mail` (D-5426: queued or delivered mail never acknowledged), and (b) idle coordinators with an open run (F6's baseline). The counts go in W1-1's PR body. If (a) is material, the coordinator proposes a bound on `mail` to the operator (spec §3.1); W1-1 does not change D-5426.
- **OA-F2 (after W1-1 deploys): W1-1's gate.** The `run-done` lane's feed shows finished children asleep within 15 minutes of close, with mail-held children reported as an excluded row with their count. W1-2 and W1-3 dispatch only after this reads green.
- **OA-F3 (before W1-3 merges): the stale-run measurement.** Read-only. Join each run in `ACTIVE_RUN_STATES` older than 24 h to its worker's `<configDir>/sessions/<pid>.json` status (busy, idle, absent). The table goes in W1-3's PR body.
- **OA-F4 (after W1-5 deploys): the words on the box.** The coordinator skill installed on the fleet's homes carries the new text (`ccd/install-coordinator-skill.sh`), after the server deploy.
- **Already done (2026-10-20):** N = 2 h through `$REG/hibernate-after-hours` (F1); hibernation armed at 13:49 UTC through `$REG/hibernate-live` (working-state Task 19).
- **The wave's deploys** follow the standing rule: from a fresh `origin/main` worktree as a detached unit, verified from its log, agent lane before server lane where both apply (only W1-5 has a skills half). No session restarts.

## Acceptance

Every PR body carries: the characterization commit's name; the before/after rows of each behaviour commit with its ruling cited; the mutation table's red test names; the rule 6 check (each edited file, each open PR holding it, its hunks); and the operator act's figures where its task names one (W1-1: OA-F1; W1-3: OA-F3). Band 3 PRs carry both reviewers' verdicts. Spec §8's "Target after W1" column is measured after W1-1, W1-1b and W1-4 deploy: live children idle with no binding ≤ 5 not held by `mail`, none older than 30 minutes after close; reviewers awake per closed review 0 after 15 minutes; refusals logged, none without self-work or a wake within 1 h.

## Rollback

Each task is a revert of its PR, newest first. The two migrations are additive and nullable and stay after a revert. Zero-deploy brakes: `stop-done-disabled` and `hibernate-disabled` (sleep), the concurrency and daily dials (`POST /api/coord/caps`), `coordinator-paused` (dispatch and W1-4's lane).

## Deviations and decisions

### Issued for this work and defined here

The allocator issued this wave the block 6091 to 6100. This plan defines D-6091 to D-6097, one per task.

- **D-6091** — `run-done-sleeps-at-close` (Task W1-1; spec §3.1, F5 (0)): the `run-done` policy (the stop-done lane) puts a finished worker to sleep once its newest placed run has been `done` for `STOP_DONE_GRACE_MS` and its turn marker has been quiet as long, restoring the operator's 2026-10-17 ruling (D-5370) over D-5427's six-hour `recent` hold, confirmed on 2026-10-20. For this policy a programme hold, a terminal run's hold, a planned run naming the worker and a review of an open run guard retirement only, never sleep; an operator's hand-written hold, an open run's hold and every use-hold still hold sleep. It keeps D-5427's act (`ccd hibernate`), D-5428's act-time re-measure and D-5426's `mail` hold unchanged.
- **D-6092** — `run-done-finished-widened` (Task W1-1b; F5 (b)): for the `run-done` policy a run is finished when it is `done` or `failed`, or when it is a producer's run parked at `awaiting-review`, `merging` or `closing` and the worker has been quiet for 30 minutes; only a run in `ACTIVE_RUN_STATES` keeps its worker awake.
- **D-6093** — `live-resume-is-free` (Task W1-2; spec §3.4): a resume of a session that reads live, and a send-back of a live worker, skip the concurrency check, because neither starts a process; every dispatch that starts or wakes a process, and the daily brake, are charged as before.
- **D-6094** — `stale-run-uncounted` (Task W1-3; spec §3.4): until W3-4 deletes it, the concurrency cap counts an active run only while its worker reads busy or unmeasured or it was dispatched within two hours; slots the predicate frees are admitted no faster than the wake budget's rate.
- **D-6095** — `refused-coordinator-woken` (Task W1-4; spec §3.5): a dispatch refused by a cap stamps its run (`admissionWaitSince`), and one schedule row mails the oldest waiting coordinator per programme, round-robin, when the cap has room, at most the wake budget's rate; each refusal and each wake is one journal line and one feed row with a `dedupeKey`.
- **D-6096** — `in-place-bind` (Task W1-4b; spec §3.5): a coordinator binds its own planned run as its worker through `inPlace: true`, verified as the run's claimant by id and uuid in the run's project, with no admission, caps, `ensure`, hold, route, brief or `/clear`; the operator's pause still binds it. A plain dispatch whose worker is the run's claimant is refused `self-dispatch` before any fleet act.
- **D-6097** — `do-it-yourself-words` (Task W1-5; spec §3.5): the cap refusals carry a `detail` that tells the coordinator to do the wave in its own workspace unless a named reason applies, and the coordinator skill states the operator's ruling, the tree rule, the in-place bind and the seven reasons in place of "wait to be woken".

Issued and unused: 6098, 6099, 6100. They are held for this wave's departures, entered by the coordinator only, and never defined outside this plan.

## Out of scope

W2 (one reviewer per work run), W3 (memory admission, the `pressure` policy, `ccd claude mem --json`, the floor in `ws-add --child`, the daily brake's count per F3), W4 (reuse per F2 (b)), W5 (placement), W6 (PWA); the sleep-decider merge and F6 (i)'s hold set for `idle-hours` (consolidation K1); any bound on the `mail` hold (proposed only if OA-F1's count is material); any `pwa/` file.

## Review log

**rev 0 (2026-10-20).** Written from the spec's rev 1.1 after the operator's 2026-10-20 ruling, and measured on `origin/main` `3cc6e5fce` with 28 open PRs.
