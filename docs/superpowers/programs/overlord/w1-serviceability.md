# Overlord W1 serviceability, PR B: what the ledger should learn

Run 3296, worker `ccrc-pwa-overlord-w1-svc-b`, plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-serviceability.md`
Tasks 4 to 7, with the W1 index's row "Serviceability and limits" (B adds the runway read `GET /api/pools/runway`). Built
against `main` at `b33a9ae137`. The coordinator mints the numbers; each departure is named by its slug.

## What shipped

- `shared/loadLines.ts` (L0): the three lines (70, 85, 95), `LOAD_FRESH_S`, the sampler's beat and keep, the runway's fit
  bounds, and the wire words: `Crossing`, `EarliestReset`, `PoolRunwayAnswer`, `LineState` and `PoolRunwayWire`.
- `server/src/poolRunway.ts` (L1): `sampleRolled`, `windowCrossing`, `accountCrossing`, `poolCrossing`, `earliestReset`,
  `poolRunway`, and the read's helpers `runwayPoolKeys`, `runwayPools` and `runwayByPool`.
- `server/src/accountLoad.ts` (L1): `overlordLoadCandidates`, `loadLines`, `classUnservableReading`,
  `accountLoadMoveReading`, the ladder's `loadLineReading` and `loadFactsOf`.
- `limit_samples` (migration 126 on the first named base) behind `server/src/coord/limitSamplesStore.ts` (L3), with three
  `CoordStore` delegates.
- `server/src/limitSampler.ts`: the pass, run by the new `limitSamples` lane row every five minutes over the listed tick's own
  reading.
- `GET /api/pools/runway` in `server/src/poolRunwayRoute.ts` (L4): each pool's `PoolRunwayAnswer`, masked.
- The ladder's `load-past-95` row and its input.

## Departures, by slug

- **`a-stored-sample-rolls-at-read`** (review 3330 F1, the coordinator's ruling in its fix round). **Plan correction:** the
  plan's rules (Task 4, "One fact the rules lean on" and "A window's crossing") test only the stored `rolled` flag, and Task 5
  stores it with `INSERT OR IGNORE`. An idle account offers the same reading beat after beat, so its row keeps the first
  beat's `rolled = false` long after the window reset, and the runway read a 99% reading from a window that reset an hour ago
  as `at` every line and as exhausted until a reset already past. Stored samples stay immutable; the runway decides at read
  time (`poolRunway.ts#sampleRolled`) that a window has reset, by `limits.ts#readLimits`' own two rules: its reset time at or
  before now, or, for a reading with no reset time, an age past its own window (`FIVE_WINDOW`, `SEVEN_WINDOW`, now exported).
  A reset window is `rolled` for the crossings and for the earliest reset. A prior window is never fitted (the newest's
  reset decides first), and a past reset is never offered as capacity to come. `EarliestReset`'s `unmeasured` gains the word
  `rolled`, so a missing sample (`no-sample`) and a window that reset stay apart, as the crossings already kept them. The
  one-window rule is unchanged: a lane with no five-hour window is its weekly window alone, and a five-hour window that
  reset beside a weekly one still past leaves that `at` standing. `windowCrossing` takes a window name (`'five'` or
  `'seven'`), not the plan's `fitS: number`: it needs the window's full width for rollover and derives its fit span from
  the same name (review 3382 F8).
- **`the-first-reset-ends-the-proof`** (review 3330 F2). **Plan correction:** the plan's account rule says
  "`not-before-reset` only when every window it has says so (the later reset)". A window's `not-before-reset` proves nothing
  past its own reset, so an account whose windows all prove it is bounded by the FIRST reset (a flat five-hour window
  resetting within the hour beside a flat weekly one resetting in six days now answers the hour, not six days). The same
  bound applies beside an `at`: a reset before an account's earliest `at` ends the proof there, and the account is
  `not-before-reset` at that reset; an `at` on or before the first reset stands. The pool rule is unchanged (a carrying
  account's reset, the soonest such), so the account's first reset is what reaches the pool.
- **`ts-mutants-ride-mutant-sets`.** The plan says mutants are built with `mutation-run.py`. That helper runs Python modules
  only, so the TypeScript deciders' mutants are `MUTANT_SETS` entries (`server/test/sim/accountLoadSets.ts`), which
  `mutate.ts` builds in a temp directory it removes: the runway set has 26 mutants and the load set has 18 (A14 to A18
  cover the 95% reading's mappings in `loadLineReading`), all killed at their floors. Removing only `current.length < 2`
  is equivalent because the minimum-span check still rejects a single sample's zero span; the reverse is not equivalent
  (R26). A flat rate on its own projects to Infinity, but the guard also rejects falling rates, so removing that whole
  guard is not equivalent (R27). Guards outside a pure decider have focused tests and reproducible hand mutations below.
- **`an-unmeasured-window-voids-a-future-crossing`.** The plan's account rule says "the earlier window's `at`". A window that
  could not be projected might cross sooner than the other's future `at`, so a future `at` beside an unmeasured window reads
  `unmeasured`; only an observed `at` at or before now stands. This is the plan's "under needs proof" rule applied to a
  projection.
- **`a-projection-is-never-past`** (review 3382 F1). **Plan correction:** a sample at or above the line proves a crossing
  at its own time. If the newest sample is still under the line, a projection at or before now is `unmeasured: stale`,
  not proof that the line was crossed. A projection can only give an `at` strictly after now and before the reset.
- **`an-unknown-window-withholds-regain`** (review 3382 F4). **Plan correction:** one exhausted window cannot establish
  an account's regain time if any other window is missing, rolled or stale. The account is unknown with that window's
  reason. With all windows known, capacity returns after the latest reset among the exhausted windows as before.
- **`one-window-proves-past`.** A load line reads `past` from the larger of a candidate's read, unrolled windows even when the
  other window is unread, because one known window bounds `max(five, seven)` from below. "Under" still needs `measured()`
  (both windows) on a fresh reading. This keeps F1 true for an account at the ceiling whose five-hour figure is unread.
- **`load-lines-read-no-share`.** The ladder's input is synchronous and the Fable share is an async file read, so the facts the
  lines read carry no share. No line can read differently: a share decides only Fable's answer, and Fable serves where `opus`
  does not only when the seven-day figure is at the ceiling (98, past every line) or unread (no fresh load, so no "under").
- **`runway-read-lists-enabled-anthropic-accounts-by-pool`.** The home plan's question 6 names the read but not its accounts. It
  counts every enabled Anthropic roster account (the only accounts sampled, F14) by its resolved pool, an account in two pools
  in each, untagged accounts under `pool: null`. An account whose pool is undecidable (`malformed`, `unreadable`, `stale`) is in
  no pool, never folded into `null` (`runwayPoolKeys`, one test row per word; review 3330 F4). Samples are read back over the
  weekly window (`RUNWAY_READ_S`), past which every reading has rolled over. A read that throws answers 503 `unavailable`, never
  an empty list, and its `detail` is a fixed word naming the read that failed (`RUNWAY_READ_FAILED`), never the thrown text,
  which can carry a path or a file name (review 3330 F6).
- **`sampler-store-is-its-own-port`.** Task 5 names `WatcherCoordMember` for the sampler's two store members. The store reaches
  the watcher as its own optional deps port, `deps.limitSamples` (the forecast lane's shape), so `coord/ports.ts` and the store
  port census do not move.
- **`sample-selection-stays-in-the-lane`.** `limitSampleRows` selects the rostered Anthropic accounts with a reading time
  in `limitSampler.ts`, the L4 lane file where Task 6 places it. This bends decide-in-L1: the pure row selection remains
  beside the delivery pass this round (review 3382 F10).
- **`departures-in-the-programme-note`** (review 3330 F8). The plan names
  `docs/superpowers/plans/2026-11-14-overlord-w1/w1-serviceability/departures.md` as the departures' home. A new file nested
  under `plans/` never takes the review judge's layout, and the ledger guard's layout arm (`.github/ci/ledger-guard.mjs`,
  `layoutViolations`) refuses it, while the worker skill puts a task's notes in a new file under
  `docs/superpowers/programs/<programme>/`. So they are here, and the plan's "Deviations found" is the coordinator's to fold.
- **`the-runway-read-is-the-index-fold`.** `GET /api/pools/runway` is not in the plan's Tasks 4 to 7 or its PR split table; the
  W1 index's row "Serviceability and limits" folds it into B (the home plan's question 6), which this PR follows.

## Hand mutations (review 3330 F7)

Each one, on this branch at the fix round's commit: replace the text once, run the named file alone from `server/`
(`ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/<file>.test.ts`), restore the saved copy, and check git sees
the file unchanged. Every one turned its file red on a failed assertion or the store's own refusal, and every restore was clean.

| Id | File | Mutation | Red file |
|---|---|---|---|
| H1 | `coord/limitSamplesStore.ts` | `INSERT OR IGNORE` to `INSERT` | `limit-samples-store` (2 cases) |
| H2 | `coord/limitSamplesStore.ts` | prune `ts < ?` to `ts <= ?` | `limit-samples-store` |
| H3 | `coord/limitSamplesStore.ts` | read bound `ts >= ?` to `ts > ?` | `limit-samples-store` |
| H4 | `coord/limitSamplesStore.ts` | `ORDER BY account, ts` to `… ts DESC` | `limit-samples-store` (2) |
| H5 | `limitSampler.ts` | the `telemetry !== 'anthropic'` test dropped | `limit-sampler` |
| H6 | `limitSampler.ts` | the `ts === null` guard dropped | `limit-sampler` |
| H7 | `limitSampler.ts` | the prune replaced by `0` | `limit-sampler` |
| H8 | `laneSchedule.ts` | the `limitSamples` cadence `LIMIT_SAMPLE_MS` to `1` | `limit-sampler` (2) |
| H9 | `coord/overlordLadderRead.ts` | the 95% input's `catch` to `'lifted'` (F3) | `overlord-ladder-load` |
| H10 | `coord/overlordLadderRead.ts` | the 95% input reads `'hard'` for `'chat'` | `overlord-ladder-load` (2) |
| H11 | `poolRunwayRoute.ts` | the 503 answered as an empty list | `pool-runway-route` |
| H12 | `poolRunwayRoute.ts` | the thrown text as the 503's `detail` (F6) | `pool-runway-route` |
| H13 | `poolRunwayRoute.ts` | the read window `RUNWAY_READ_S` to a day | `pool-runway-route` |
| H14 | `poolRunwayRoute.ts` | the 501 arm dropped | `pool-runway-route` |
| H15 | `poolRunwayRoute.ts` | the `samples` step label dropped | `pool-runway-route` |

## Fix round 2 (review 3382)

The runway suite went red in five assertions on the previous code, then passed all 41 cases with the crossing and regain
fixes. The idle projection fixture (70 to 80 over an hour, newest reading 40 minutes old, no weekly sample) reads
`unmeasured: stale` at window, account and pool. An exact-now observation stands; an exact-now projection is stale; a
projection one second later is still valid at window level. The regain cases pin stale, missing and rolled peer windows,
a fresh peer window, and a sample exactly at the freshness bound.

The runway and load floors passed their baselines and killed all 44 set mutants. H16–H21 were run one at a time in a
scratch copy of the fix round, with the named focused test red on the mutation and green after an exact restore.

| Id | Finding | Mutation | Red on mutation → green on restore |
|---|---|---|---|
| R22 | F1 | Drop the projected `atS <= nowS` refusal | Idle projection is reported as `at` → `stale` |
| R23 | F1 | Change `atS <= nowS` to `atS < nowS` | An exact-now projection is reported as `at` → `stale` |
| R24 | F4 | Consider unknown only when no window is exhausted | Regain offered with a stale peer → `unmeasured` |
| R25 | F6 | Change regain freshness `>` to `>=` | At the freshness bound: `unmeasured` → `none-exhausted` |
| R26 | F7 | Drop the minimum-span clause, keep the sample-count clause | A rising pair 899 seconds apart projects → `thin` |
| R27 | F7 | Drop the non-positive-rate guard | A falling rate reports `stale` → `not-before-reset` |
| H16 | F2 | Drop `/ 1000` from `watch.ts#sweepLimitSamples` | Prune receives a millisecond-scale bound → a seconds bound |
| H17 | F3 | Replace the server's ladder `accountFacts` closure with `() => null` | The composed ladder reads `unmeasured` → `standing` for 96%; at 94% it reads `lifted` |
| H18 | F5 | Register the runway with `coord: undefined` | The composed runway answers 501 → 200 with the stored sample's regain time |
| H19 | F11 | Drop the `if (store)` guard on the sampler pass | An absent store warns of a lane failure → no sampler warning |
| H20 | F11 | In the lane runner, permanently throttle `limitSamples` after a failure | The next beat inserts zero batches → one batch and one prune |
| H21 | F11 | Keep six days instead of 30 | The retention bound falls below the seven-day read → covers the read |

The window-name signature (F8) and the lane's row selection (F10) are noted above. F9 (remaining mutant-floor gaps)
and F12 (future-dated observations under clock skew, and the live ladder cap with stale or absent limits) are carries,
not behavior changes in this round.

## Review 3330, finding by finding

- F1 and F2: the two plan corrections above, with fixture rows for an idle account's stale row, the exact reset, one window,
  differing resets, an `at` beside a reset, the age fallback and the propagation to the pool (`pool-runway.test.ts`), and
  runway mutants R13 to R21.
- F3: a facts read that throws, and a designation read that throws, read `unmeasured` and cap at `chat`
  (`overlord-ladder-load.test.ts`; H9). F4: `runwayPoolKeys`, a row per word (R20). F5: an `at` exactly now is past, pinned
  beside an unmeasured window and a second later voided (R19).
- F6: fixed words for the 503. F7: the sets and the table above. F8: `departures-in-the-programme-note`. F9: the exclusion row
  is now on a rostered codex lane, and the same row on an Anthropic lane is written, so the telemetry test alone leaves it out.
  F10: the `Crossing` comment says an `at` is either already past or a projection before the reset.
- The plan's F15 rows the PR lacked: a file at the version before is migrated, never opened empty, and gains the table and its
  index; a file at a higher version opens as it is, with the build's warning, and its samples read
  (`limit-samples-store.test.ts`).

## Notes for the ledger

- The `soft` line's pin against ccd's `FRESH_PICK_SOFT_PCT` lands here: the ccd arms' C1 is on `main`.
- `LOAD_FRESH_S` (3,600 s) is pinned greater than the keepalive's default window plus its timer, both harvested from the tree.
- The 95% row's notice is `none`. An unmeasured line caps at `chat` by the ladder's rule (F3), and nobody designated lifts it.
- Behaviour at merge: the sampler writes rows every five minutes, at most one per Anthropic account per reading; nothing reads
  them but the runway read; the 95% row reads `lifted` until an Overlord exists.
- Migration 121 was provisional in the first fix round. Main subsequently used it for `coordinator_state.capMode`. On the
  first named base (`7e1f9752fe`), sequence retention is 125 and the samples migration and both database test pins move to
  126. Re-check that position against the final named landing base.
- Load-sensitive suites, measured rather than labelled: the three `coord-db` cases review 3330 saw time out (the delegation
  tables' "a failure at ANY statement", portfolio B's and the programme phases' "reaches a database ALREADY at the version
  before it") time out the same way at the merge base `b33a9ae137` (about 170 s, 28 s and 25 s there, 173 s, 26 s and 24 s on
  this branch, load 14 to 20), and secret-mask's keystroke-latency case fails at both. CI's fast run on the previous tip
  ran `coord-db`, `secret-mask`, `run-close-switch`, `typecheck-tests` and the mutation floors among its 1014 files, all
  green.
- Spec fixes for the spec-fixes run (from the plan, unchanged): Table 11.5b's 95% row and `LOAD_FRESH_S`; §6.8's "caps no rung",
  which the ladder's rule overrides for the 95% row.
