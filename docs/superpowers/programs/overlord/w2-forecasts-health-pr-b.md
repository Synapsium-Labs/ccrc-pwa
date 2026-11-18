# Overlord W2 forecasts B: notes for the ledger

This note records what PR B of [`w2-forecasts-health.md`](../../plans/2026-11-16-overlord-w2/w2-forecasts-health.md) (Tasks 5 to 8)
built, and where it departs from the plan's text. The coordinator folds it into the programme ledger and mints any
numbers. No D-number is defined here.

## In short

- **Built:** the health words, worst first, and their limits (`shared/programmeFacts.ts`); the `health` kind of the
  trigger table; `programmeHealth`, `healthFactsOf`, `healthExtrasFrom`, `criticalPath` and `healthChangeVerdict`
  (`server/src/coord/programmeHealth.ts`, L1); `waveSpend`, `doneCycles` and `runSpendVerdict` beside the wave rule
  (`server/src/coord/programmeMeasures.ts`, L1); migration 95, `programme_health` and `run_spend`, each with one writer;
  the forecast lane's spend and health arms; and `portfolioFor`'s W2 measures: the newest health row, the newest seal,
  the edges, the spend read, the critical path and the fleet's calibration.
- **Live at merge** (the index's question 20): the health arm records rows and record-only notices (none on a
  programme's first row, at most one per programme and word a day); the spend arm records rows for runs closed from its
  first pass on; the portfolio read gains optional fields. Nothing pushes.
- **Migration slot:** 96. Built at 95, the next free on `main` at `5d8d3d0d3` (forecasts A took 94); the Linear
  hierarchy's wave 4 (#2982) landed 95 first, so the one absorption of `main` (the coordinator's ruling) renumbered this
  to 96. Gates A also aims at 96; whoever lands second renumbers at its landing merge.

## 1. Departures from the plan, by slug

| Slug | What the plan says | What this PR does, and why |
|---|---|---|
| `clear-restarts-cost-by-session-id` | Task 7 Step 1: measure whether a worker's `SessionUsage.cost` restarts at its wave's `/clear`, from the statusline documentation and two sidecar readings of one test-box worker across a `/clear`; stop and ask if it cannot be measured. | Asked (asks 544 and 545), ruled: proceed with `startCost` NULL. The evidence is the source: Claude Code 2.1.327 keeps its cost state in a map keyed by session id (`costStates`), and a `/clear` mints a new session id (D-4943), so a cleared conversation starts with no cost state. The coordinator made the evidence a guard: `runSpendVerdict` counts a reading only when the usage sidecar's `session_id` equals the registry's current conversation id for the session; a reading under another id, or under none, is `outside` (unmeasured). The sidecar's id reaches the arm beside `SessionUsage` (`usage.ts`' `UsageRead.reading.uuid`), so the fleet wire's `SessionUsage` is unchanged. **Carried:** the plan's direct check (two sidecar readings of one test-box worker across a `/clear`) is held by the coordinator for the spend arm's first live wave; a reading that contradicts it stops the arm. |
| `health-arms-match-on-their-own-inputs` | "A row whose inputs include an unmeasured one does not match, and the input joins `evidence.unmeasured`." | Each row is a disjunction of arms (`slipping` has three: `fixed-date`, `missed`, `moved`), and an arm matches only when every input IT reads is measured. An unmeasured input of one arm does not stop another arm of the same row whose inputs are measured. Both monotonicity properties hold and are tested; every row is evaluated, so `evidence.unmeasured` names every unmeasured input whichever row matched. |
| `health-notice-marked-on-its-row` | `programme_health` (program, at, word, evidence); a notice "unless one for that programme and word was recorded in the last 24 hours". | The table carries one more column, `noticed` (0 or 1), set on the row whose change recorded the notice. The once-a-day read (`healthNoticedSince`) asks the table, so the rule has one table and one writer and never scans the feed archive. |
| `health-change-is-a-decider` | The health arm compares the word with `newestHealthOf` and decides the notice. | Whether a change appends and whether it notices is `programmeHealth.ts#healthChangeVerdict` (L1), so the lane decides nothing. Its own mutant set and floor. |
| `health-extras-from-the-portfolio-facts` | "Read the portfolio's facts and its entry (`portfolioFacts`, `portfolioFor`, the same functions the read door uses), build `HealthFacts` with `healthFactsOf`." | The lane's extra facts (seals, statements in the window, the last move, the edges, the items shown, the fleet's cycle reference, the spend rows) come from the same facts read, through `programmeHealth.ts#healthExtrasFrom` (L1). `portfolioFacts` therefore reads the statements in the health window and each programme's last move too. |
| `stalled-counts-the-open-as-a-move` | `lastMoveAt`: the newest state change (`run_events` with `fromState` unlike `toState`) of any open work run. | Opening a run writes no `run_events` row, so a work run that has not changed state since it opened reads its `openedAt` as its last move. Without it a just-opened run with no event would have no last move at all. A statement never counts (ruled). |
| `aging-fleet-reference-over-listed-programmes` | `aging`'s reference: the programme's own 85th percentile cycle from 5 done waves, else the fleet's. | The fleet's reference is over every programme the portfolio lists (the facts read's programmes), through the same `doneCycles` rule the portfolio's cycle uses. |
| `wave-rule-and-cycles-moved-to-programme-measures` | (not stated) | `portfolio.ts`' private `wavesOf`, `Wave`, `isOpenRun`, `bucketOf`, `earliestDispatch`, `rebuiltWave` and the done-wave cycle loop move unchanged to `programmeMeasures.ts`, which the health decider also reads, so there is no import cycle and no second copy. Every portfolio case is unchanged. The seven portfolio mutants that named the moved text (P-FOR-2, -9, -12, -19, -28, -31, -33) move with it, as WV-1 to WV-3 and DC-1 to DC-4 against the new home. |
| `critical-path-visit-budget` | `criticalPath`: cycle-safe, at most 10 deep. | Branches multiply with depth (up to 20 open edges per programme), so the walk also stops after `CRITICAL_PATH_VISITS_MAX` (500) chains and answers `cut: true`. The answer carries `cut`, which the plan's shape does not name. `criticalPath` takes `programOfRun` and `clearingShipped` as arguments beside the plan's three. |
| `health-limits-in-days-and-hours` | `HEALTH_SLIP_MS` (7 days), `HEALTH_STALLED_MS` (48 hours). | `HEALTH_SLIP_DAYS` and `HEALTH_STALLED_HOURS`, as the file's other durations are counted, so no new millisecond spelling of seven days enters the tree (`token-shared.test.ts`' census). `HEALTH_WINDOW_DAYS` (28) names the window churn, scope and spend read over. |
| `spend-reading-without-cost-is-absent` | `absent` when the session has no reading, or the run has no session. | A reading whose cost figure is null is `absent` too: there is no cost reading. Its class and time are kept as evidence. |
| `spend-read-counts-work-and-review-runs` | "A closed run with an `absent` or `outside` row, or with no row … count in `runsUnmeasured`." | Only work and review runs count (the kinds the spend arm records). Every closed one with no `measured` row counts in `runsUnmeasured`, including runs closed before the arm's first pass: they were never measured, and they are never read as 0. |
| `spend-open-run-without-a-session` | "an open run with no fresh reading" counts in `runsUnmeasured`. | A dispatched open work or review run with no session counts in `runsUnmeasured` (no reading can speak for it); an open run never dispatched has run no session and spent nothing, so it is not counted. A live reading of a run of another kind is not the programme's spend. Mutants P-FOR-W7 to P-FOR-W9 and P-FOR-W12. |
| `tasks-7-and-8-one-commit` | One commit per task. | Task 7's health arm reads the portfolio's facts (`portfolioFacts`, `portfolioFor`) that Task 8 widens, so the two land as one commit that typechecks, with both subjects in its message. |
| `edge-cases-rewritten-for-clearing-shipped` | The F1 cases: with `EDGE_CLEARING_SHIPPED` false, every edge is listed as "clearing not shipped" and none blocks or enters the critical path. | Remaining work B (#3002) shipped clearing while this was built, and the one absorption of `main` brought the flag in as true (the coordinator's ruling: the rewrites in a commit of their own after the merge). Rewritten: the W2 characterization case and the target-ended and target-unmeasurable case now read `clearingShipped: true`, and the second still shows those edges never block or walk. The F1 case became "with clearing shipped, an open needs-landed edge enters the critical path and a needs-decision edge does not"; the entry's W1 `blocking` stays items and asks. Added: a health-arm case where an open needs-decision edge on a shown, non-blocking item makes the word `blocked-on-you` through its edges arm. The deciders take the flag as an argument and were already tested both ways, so their cases are unchanged. Red checks: P-FOR-W13 (the entry's flag) and P-FOR-W14 (the critical path's flag) join `portfolioFor`'s set, both killed, and the lane's flag forced false fails the new health-arm case. No production code changed. |
| `portfolio-w2-facts-optional` | `PortfolioEntry` and `PortfolioView` gain optional fields. | `PortfolioFacts` gains an optional `w2`, which the facts read always sets; a caller that builds W1's facts alone (the existing portfolio cases) gets W1's entry unchanged. |
| `unforecastable-seal-has-its-own-reading` | Carried from forecasts A (review 2414 F9): an unforecastable seal stays `outcome = 'open'` for ever. | The entry's `forecast` is `unforecastable` with its reason and no date, never "pending"; `healthFactsOf`'s newest scored seal skips every `open` seal, so an unforecastable one is never read as a seal waiting for its date. Both tested. |

## 2. Plan steps measured

- **Task 5:** the trigger cases red on the old reader (3 of 5), green after; two mutants join the `parseSignature` set (T5
  the health branch dropped, T6 any key under health), both killed.
- **Task 6 mutants:** `programmeHealth` (PH-1 to PH-10), `healthFactsOf` (HF-1 to HF-9), `criticalPath` (CP-1 to CP-6, CP-6
  the visit budget), `healthChangeVerdict` (HC-1 to HC-3), `waveSpend` (WS-1 to WS-5), `wavesOf` (WV-1 to WV-5),
  `doneCycles` (DC-1 to DC-4): every mutant killed.
- **Task 7 Step 1:** asked and ruled, above (`clear-restarts-cost-by-session-id`).
- **Task 7:** `runSpendVerdict` (RS-1 to RS-11, among them the window, staleness, re-dispatch, same-conversation and
  null-sidecar tests and `absent` as cost 0): every mutant killed. Red checks, each restored from a saved copy: a second
  `INSERT INTO run_spend` reds `writers-map`; the boot guard dropped (`!live.usage.ready()`) reds its lane case; a notice
  on a first row or on a better word (`healthChangeVerdict`) reds the health-arm cases.
- **Task 8:** `portfolioFor`'s W2 measures join its mutant set (P-FOR-W1 to P-FOR-W12): every mutant killed. Red checks:
  `programmeHealth` called in `portfolioFor` instead of showing the row reds the F7 case; `absent` folded into 0, or a
  shared session counted twice, reds the spend cases.

## 3. Where things stand

**Agreed:** the plan's Tasks 5 to 8 as merged, with the departures above, and the coordinator's conditions on Step 1.

**Waiting on the coordinator:** a ruling on each departure in section 1 (each is implementation, none is the
operator's).

**Later:** the two-reading check of a worker's cost across a `/clear`, at the spend arm's first live wave (the
coordinator holds it). Remaining work B's edge arm joins this lane and flips `EDGE_CLEARING_SHIPPED`, which turns on the
edges' part of `blocked-on-you` and the critical path.
