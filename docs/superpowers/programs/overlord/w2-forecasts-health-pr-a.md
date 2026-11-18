# Overlord W2 forecasts A: notes for the ledger

This note records what PR A of [`w2-forecasts-health.md`](../../plans/2026-11-16-overlord-w2/w2-forecasts-health.md) (Tasks 1 to 4)
built, and where it departs from the plan's text. The coordinator folds it into the programme ledger and mints any
numbers. No D-number is defined here.

## In short

- **Built:** `seededDraws` and `streamFor` (time kernel, L1); `forecastProgramme`, `forecastOutcome` and
  `forecastCalibration` (C5, L1); the rebuilt-run rule moved to `shared/programmes.ts#isRebuiltRun`; migration 94,
  `programme_forecasts`, with its two writers; the forecast lane (`forecasts`, 60 s, monotonic clock) with its seal and
  score arms.
- **Live at merge** (the index's question 20): the lane starts sealing and scoring rows that nothing serves yet.
- **Migration slot:** 94. Account organization D (#2958) landed 90, the Overlord's designation (#2950) 91, done tests
  A (#2964) 92 and the programme's phases (#2974) 93 while this was built, so the branch merged `main` four times under
  the coordinator's standing renumber license (the fourth in fix round 1, as ruled); the conflicts were the migration
  list, `coord-db.test.ts`' count comments and pins, `run-close-switch.test.ts`' undo comment and DROP list,
  `writers-map.test.ts`' table list, `mutation-floors.test.ts`' set list, `mutation-floors.json` and
  `time-ports.test.ts`' file list only. `decision-model-records.test.ts`' shared migration case is kept verbatim.
- **Fix round 1** (review 2414, ruled): forecasts are close to close (F1), a reworked wave gives one summed rework
  sample (F2), a failed wave's time is never dropped (F3), scores read the waves as they stood at `p85At` (F4), the
  watcher logs missed closes (F5), a never-started abandon is never sealed (F6), the named statement is bounded by the
  wait (F7), and calibration's window start is pinned (F8). Section 4 lists each with its tests.

## 1. Departures from the plan, by slug

| Slug | What the plan says | What this PR does, and why |
|---|---|---|
| `seal-pairing-and-lead-history-are-deciders` | The lane's pass picks the statement and the boundary, and `leadHistoryOf` (L3) measures the leads "from `runs` alone". | Both rules are decisions, so they are L1 deciders in `forecast.ts`: `sealBoundary` (question 4's wait and pairing, F19) and `leadHistoryFrom` (questions 2 and 3). The store reads rows and calls them; the lane decides nothing. Each joins `MUTANT_SETS` and `mutation-floors.json` beside the four the plan names, so the PR adds six floors, not four. |
| `rebuilt-flag-set-by-the-store-through-isRebuiltRun` | `portfolio.ts`' `rebuiltWave` asks `isRebuiltRun`, and the store selects the three columns. | The store selects `claimedBy`, `dispatchedAt` and `openedAt` and sets `PortfolioRun.rebuilt` through `isRebuiltRun`; `rebuiltWave` still reads the flag. The rule has one owner either way, and this keeps `PortfolioFacts`, every portfolio case and every portfolio mutant unchanged, so the move commit changes no test. |
| `lead-spans-the-gap-between-waves` | Question 2: "from the previous work wave's close … to this wave's close"; "a wave closed before any earlier one (two open at once) uses the later of the two starts". | Ruled in fix round 1 (F1, the reviewer's reading): "the later of the two starts" is overlap only, so a wave's lead starts at the previous counted wave's close whenever there is one, whether the wave opened before that close or after. A forecast is never early by the gap between waves. The same holds inside a wave: each later run's lead starts at the close of the run before it. A programme's first wave starts at its earliest `openedAt`. |
| `reworked-wave-splits-its-lead` | Question 3 names three sample sets, and question 2 measures a wave close to close. | A reworked wave (two or more work runs) gives its first run's lead as its done or abandoned lead, and ONE rework sample: the sum of its later runs' close-to-close leads (F2, ruled). A trial adds one rework sample at the rework share's chance, so the one-draw-per-wave model is exact for any number of runs, and a wave's samples sum to its close-to-close lead. |
| `failed-wave-is-a-boundary-not-a-sample` | Question 3 samples done and abandoned waves, and names no set for another failure. | Rewritten in fix round 1 (F3, ruled: a failed wave's time is never dropped). A wave closed `failed` for any reason but an abandon gives no sample, is not counted in `waves`, and is NO boundary: its close does not start the next lead, so the next counted wave's lead spans it (from the failed wave's earliest `openedAt` when it was the programme's first). The slug is kept so the ruling can be found by it. `abandon:never-started` is no wave at all: no sample, no boundary and never spanned. |
| `lead-history-includes-the-closing-wave` | (not stated) | The lead history as of a seal's boundary includes the closing wave itself, since it closed by `asOf`. |
| `seal-gap-count-after-the-first-seal` | "A wave closed during a gap of more than 7 days is never sealed; the count is reported on the lane's pass record." | `unsealedClosesOf` answers `missed`: the work runs closed before the 7-day window and after the first sealed close, with no seal. Closes before the lane's first seal (all history before deploy) are not a gap. The count rides the lane's returned pass record; the watcher logs only failures. |
| `never-started-abandon-is-never-sealed` | "Work runs closed `done` or `failed` in the last 7 days with no seal row" (Task 4), and "one seal per closed work run". | Ruled in fix round 1 (F6): a close `abandon:never-started` is no wave at all, so `unsealedClosesOf` neither lists it nor counts it `missed`. |
| `named-statement-bounded-by-the-wait` | Question 4: "seals once a statement naming that run exists". | Ruled in fix round 1 (F7): the statement naming the run counts only when made by `SEAL_WAIT_MINUTES` after the close, the same bound as the standing statement, so a pass after a lane outage seals what an on-time pass would have (F19). |
| `seven-day-spans-are-own-facts` | (not stated) | The seal look-back and calibration's weekly cut step are named constants (`SEAL_LOOKBACK_MS`, `CALIBRATION_CUT_STEP_MS`) and two rows of `token-shared.test.ts`' `OWN_FACTS`, each a fact of its own that only shares the number with the token interval, as remaining work A's edge exit is. |

## 2. Plan steps measured

- **Task 1 and 2 mutants:** every mutant the plan names is in `server/test/sim/forecastSets.ts`, and every mutant of
  the six sets is killed (`FP-*`, `FO-*`, `FC-*`, `SD-*`, `SB-*`, `LH-*`), measured again after fix round 1.
- **Task 3 red checks:** a second `INSERT INTO programme_forecasts` reds `writers-map`; scoring without the
  `outcome = 'open'` guard reds its store case.
- **Task 4 red checks:** sealing without the wait reds the pairing case; dates from the pass's `now` red the late-seal
  case (F19); a clock read in the lane module reds `time-ports`; the row on the wall clock reds `lane-schedule`.
- **Characterization first:** `portfolio-store.test.ts` gained a case pinning a done rebuilt wave as cycle-unmeasured
  and a claimed run whose dispatch equals its open as not rebuilt, green on the old SQL before the move commit.

## 3. Fix round 1 (review 2414), as ruled

| Finding | Ruling | What changed, and the cases that pin it |
|---|---|---|
| F1 | Leads are close to close; "the later of the two starts" is overlap only | `forecast.ts#leadHistoryFrom` starts a lead at the previous counted close whenever there is one, and a rework lead at the close of the run before it. The case "a later-opened wave from its open" is turned around; a new case forecasts 20 waves opened 2 days after the close before them at 3 days a wave. Mutant LH-2 is now the gap-dropping start, LH-15 the gap-dropping rework lead. |
| F2 | One summed rework sample per reworked wave | `leadHistoryFrom` pushes the sum of a wave's later leads; a three-run history (20 waves of three one-day runs) forecasts its measured 3 days a wave. New mutant LH-18 pushes each later lead on its own. |
| F3 | A failed wave's time is never dropped | A non-abandon failed close does not advance the boundary, and a failed first wave is spanned from its open. The alternating history (2-day failed, 1-day done) forecasts its measured 3 days a wave; a never-started first wave is not spanned. New mutants LH-16 and LH-17. |
| F4 | Fix | `programmeFactsStore.ts#outcomeFactsOf` reads work runs opened by `p85At`, a run closed after it as still open, and leaves out a wave already done at `asOf`. Two store cases (a boundary wave's re-run; a rework opened after `p85At`) each red on a83578ae6. |
| F5 | Fix | `watch.ts#sweepForecasts` warns when `pass.missed` is above zero (the one line agreed with the holder of that file's claim); the lane test pins `pass.missed`. |
| F6 | No seal for a never-started abandon | Both of `unsealedClosesOf`' queries leave out `closeDetail` `abandon:never-started`; a store case pins listed and missed. |
| F7 | Fix | The named-statement query is bounded by the close plus `SEAL_WAIT_MINUTES`; a store case and a lane case (the lane down past the wait) pin it. |
| F8 | Fix | Calibration seals at the window's start and 1 ms after it; new mutant FC-9 on the window constant is killed. |
| F9 | No change here | A duty for PR B, below. |

Every new case of F1 to F4, F6 and F7 was measured red on a83578ae6's `forecast.ts` and `programmeFactsStore.ts` (14
cases), and green on this branch.

## 4. Where things stand

**Agreed:** the plan's Tasks 1 to 4 as merged, with the departures above.

**Waiting on the coordinator:** a ruling on each departure in section 1 (each is implementation, none is the
operator's).

**Later:** PR B (health, spend and `portfolioFor`'s W2 measures) is the next wave of this plan.

**A duty for PR B (F9):** an `unforecastable` seal keeps `outcome = 'open'` for ever, because there is nothing to score.
PR B's reader must never read `open` as "pending": `open` on an unforecastable seal means "never scored", and only an
`open` seal with a date is waiting for its 85% date.
