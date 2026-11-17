# Overlord W2 forecasts A: notes for the ledger

This note records what PR A of [`w2-forecasts-health.md`](w2-forecasts-health.md) (Tasks 1 to 4)
built, and where it departs from the plan's text. The coordinator folds it into the programme ledger and mints any
numbers. No D-number is defined here.

## In short

- **Built:** `seededDraws` and `streamFor` (time kernel, L1); `forecastProgramme`, `forecastOutcome` and
  `forecastCalibration` (C5, L1); the rebuilt-run rule moved to `shared/programmes.ts#isRebuiltRun`; migration 93,
  `programme_forecasts`, with its two writers; the forecast lane (`forecasts`, 60 s, monotonic clock) with its seal and
  score arms.
- **Live at merge** (the index's question 20): the lane starts sealing and scoring rows that nothing serves yet.
- **Migration slot:** 93. Account organization D (#2958) landed 90, the Overlord's designation (#2950) 91 and done
  tests A (#2964) 92 while this was built, so the branch merged `main` three times under the coordinator's standing
  renumber license; the conflicts were the migration list, `coord-db.test.ts`' count comments, `run-close-switch.test.ts`'
  undo comment, `writers-map.test.ts`' table list, `mutation-floors.test.ts`' set list and `time-ports.test.ts`' file
  list only. `decision-model-records.test.ts`' shared migration case is kept verbatim.

## 1. Departures from the plan, by slug

| Slug | What the plan says | What this PR does, and why |
|---|---|---|
| `seal-pairing-and-lead-history-are-deciders` | The lane's pass picks the statement and the boundary, and `leadHistoryOf` (L3) measures the leads "from `runs` alone". | Both rules are decisions, so they are L1 deciders in `forecast.ts`: `sealBoundary` (question 4's wait and pairing, F19) and `leadHistoryFrom` (questions 2 and 3). The store reads rows and calls them; the lane decides nothing. Each joins `MUTANT_SETS` and `mutation-floors.json` beside the four the plan names, so the PR adds six floors, not four. |
| `rebuilt-flag-set-by-the-store-through-isRebuiltRun` | `portfolio.ts`' `rebuiltWave` asks `isRebuiltRun`, and the store selects the three columns. | The store selects `claimedBy`, `dispatchedAt` and `openedAt` and sets `PortfolioRun.rebuilt` through `isRebuiltRun`; `rebuiltWave` still reads the flag. The rule has one owner either way, and this keeps `PortfolioFacts`, every portfolio case and every portfolio mutant unchanged, so the move commit changes no test. |
| `reworked-wave-splits-its-lead` | Question 3 names three sample sets, and question 2 measures a wave close to close. | A reworked wave (two or more work runs) gives its first run's lead as its done or abandoned lead, and each later run's lead, from the run before it, as a rework lead. Its samples then sum to its close-to-close lead, so a trial that adds a rework lead does not count the rework twice. |
| `failed-wave-is-a-boundary-not-a-sample` | Question 3 samples done and abandoned waves. | A wave closed `failed` for any other reason gives no sample and is not counted in `waves`, but its close still starts the next wave's lead. `abandon:never-started` is no wave at all: no sample and no boundary. |
| `lead-history-includes-the-closing-wave` | (not stated) | The lead history as of a seal's boundary includes the closing wave itself, since it closed by `asOf`. |
| `seal-gap-count-after-the-first-seal` | "A wave closed during a gap of more than 7 days is never sealed; the count is reported on the lane's pass record." | `unsealedClosesOf` answers `missed`: the work runs closed before the 7-day window and after the first sealed close, with no seal. Closes before the lane's first seal (all history before deploy) are not a gap. The count rides the lane's returned pass record; the watcher logs only failures. |
| `seven-day-spans-are-own-facts` | (not stated) | The seal look-back and calibration's weekly cut step are named constants (`SEAL_LOOKBACK_MS`, `CALIBRATION_CUT_STEP_MS`) and two rows of `token-shared.test.ts`' `OWN_FACTS`, each a fact of its own that only shares the number with the token interval, as remaining work A's edge exit is. |

## 2. Plan steps measured

- **Task 1 and 2 mutants:** every mutant the plan names is in `server/test/sim/forecastSets.ts`, and every mutant of
  the six sets is killed (`FP-*`, `FO-*`, `FC-*`, `SD-*`, `SB-*`, `LH-*`).
- **Task 3 red checks:** a second `INSERT INTO programme_forecasts` reds `writers-map`; scoring without the
  `outcome = 'open'` guard reds its store case.
- **Task 4 red checks:** sealing without the wait reds the pairing case; dates from the pass's `now` red the late-seal
  case (F19); a clock read in the lane module reds `time-ports`; the row on the wall clock reds `lane-schedule`.
- **Characterization first:** `portfolio-store.test.ts` gained a case pinning a done rebuilt wave as cycle-unmeasured
  and a claimed run whose dispatch equals its open as not rebuilt, green on the old SQL before the move commit.

## 3. Where things stand

**Agreed:** the plan's Tasks 1 to 4 as merged, with the departures above.

**Waiting on the coordinator:** a ruling on each departure in section 1 (each is implementation, none is the
operator's).

**Later:** PR B (health, spend and `portfolioFor`'s W2 measures) is the next wave of this plan.
