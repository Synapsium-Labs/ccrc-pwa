# The generation day fits its time bound

Programme `overlord`, wave 225, run 3697 (`generation-day-sim-bound`). Base: `main` at `7b0dc02ff9`.

## In short

`server/test/sim/generation-day.test.ts` ran 200 seeds in one case under a 600 s bound. Each seed costs about 0.6 s of
CPU on the dev box. Nearly all of that is the real generations lane doing its work against the real store, about
2,800 passes for each simulated day. That cost has been the same since the day first ran the real lane
(`7df3f69ca5`, #2786); it did not grow later. The bound came under pressure because slower runners take 3 to 6 times
longer for the same work: 1.9 s a seed on the test box, up to 3.7 s on CI's runners. The rig had no waste worth
removing, and product code is untouched. The 200 seeds now run as ten cases of 20 consecutive seeds, each bounded at
15 s a seed (300 s). A pin goes red if a seed is dropped or repeated, or if the count changes. "Reaches every edge" is
checked once, over the union of the ten ranges. Each mutation case keeps its assertion and gets a 300 s bound, where
before it had 600 s.

## 1. Where a seed's time goes

Measured on the dev box (a shared fleet box, load average 7 to 10 while measuring) with a probe outside the tree that
calls `simulate` seed by seed:

| Measure | Value |
|---|---|
| seeds 1 to 200 in one process | 118 s, 0.59 s a seed, no trend from the first 20 seeds to the last 20 (552 to 662 ms a seed per block of 20) |
| lines in a seed's sequence | about 9,000 |
| all twelve invariants over one finished seed | 3 to 14 ms in all (G4 the largest at 1 to 3 ms) |
| lane passes in a seed (one per beat of the renewal lane's period) | about 2,790 |
| `liveGenerations` reads in a seed | about 20,400 (7.3 a pass) |
| other store reads a pass | `seriesRows` 1.8, `bindingRunsOf`, `designationRead`, `openCoordinatorIds`, `startsSince`, `laneArmSetting`, `renewRequestsAfter` 1 each, `advanceObserved` and `setGenerationDue` 2 each, `generationsCursor` 4 |

CPU profile of 15 seeds (10.3 s sampled): `serverBeat` → `generationsPass` (product code, `server/src/continuity/`)
is 7.2 s of the 7.9 s the scenario's beat takes. The store reads under it account for most of that time:
`liveGenerations` 2.4 s, `seriesRows` 1.1 s, item reads 0.4 s, the designation read 0.35 s. The rig's own share is
small: the scenario's own reads of the live generations after a pass (`row`, `passLines`, `rowById`) take 0.42 s, about
4 %, and the invariant checks take less than 1 %.

**Verdict: the cost is the product code's honest work.** No database is opened per step: one in-memory database serves
every seed, and only its tables are emptied. The sequence is not re-read on every check: each invariant reads it once,
after the run. No invariant is quadratic. The rig's re-read after each pass is how the scenario observes what the pass
wrote, and removing it would save at most about 4 %. So nothing in the rig or in `server/src` was changed for speed.

## 2. When a seed became expensive

CPU time of the seeded case, 40 seeds, at each commit of the file's and the lane's history, two rounds on the same box
(the copies were extracted with `git archive` into a scratch directory):

| Commit | What it added | CPU, 40 seeds (round 1, round 2) |
|---|---|---|
| `3b562ef165` (#2744) | the generation day over a decider-only model | 0.6 s, 0.7 s |
| `7df3f69ca5` (#2786) | the real lane and store; the "0.3 s a seed" comment | 29.8 s, 33.2 s |
| `24ebf291eb` (#2802) | probes | 32.5 s, 30.3 s |
| `db77690cb2` (#2828) | the probes follow-up | 33.7 s, 31.2 s |
| `fb72629d88` (#2852) | the renewal act | 26.1 s, 21.2 s |
| `c6d52f92f1` (#2962) | the renewal readings' seam | 23.1 s, 21.3 s |
| `7131cb6f22` (#2950) | the designation | 27.5 s, 24.2 s |
| `18db41d63d` (#2934) | Renew now and the hand-offs | 29.2 s, 26.5 s |
| `d7e5f839aa` (#3003) | the W2 measures | 29.5 s, 26.0 s |
| `3808a931c1` (#3209) | the raised term and the latch | 30.4 s, 26.0 s |
| `7b0dc02ff9` | `main` | 38.1 s, 28.6 s |

A seed went from about 15 ms to about 0.7 s of CPU at `7df3f69ca5`, when the day began running the real lane and
store. At that same commit the bound's comment said about 0.3 s a seed, which nothing measured here supports: the
lane's first version already cost about 0.75 s a seed on this box. Since then the cost has moved within the noise
between rounds (about ±20 %, under a load that changed from run to run). The brief's 1.8 s a seed is the slower runner:
the same `main` case took 120 s on the dev box and 385 s on the test box, measured an hour apart. CI's runners are
slower still: 437 to 737 s in the merge-queue runs the brief cites.

## 3. What changed

- `server/test/sim/run.ts` (the seed convention, written once): `assertScenario` is now `runSeeds`, which runs the seeds
  and answers the edges they reached, followed by `assertCovered`, which judges a set of edges and is skipped under
  `CCRC_SIM_SEED`. `seedRanges` cuts a seed list into consecutive ranges. `assertScenario` keeps its meaning and callers
  (two other sim days and `run.test.ts`), and the convention's header names the split.
- `server/test/sim/generation-day.test.ts`:
  - `SEEDS = simSeeds(DEFAULTS)`, `RANGES = seedRanges(SEEDS, 20)`. There is one case per range, bounded at
    `seeds.length * SEED_MS`, with `SEED_MS = 15 s`, four times the worst measured seed (3.7 s on CI).
  - A pin case: `DEFAULTS` is exactly 1 to 200 (1 to 5,000 under `CCRC_SIM=full`, with the literal count written in
    the pin), the ranges' concatenation is exactly `SEEDS` with no seed twice, no range is empty, and with no replay
    variable `SEEDS` is `DEFAULTS`.
  - A last case: the seeds the range cases ran, in order, are exactly `SEEDS`, and the edges they reached together
    cover every edge (`assertCovered`).
  - The twelve mutation cases keep their loops and assertions unchanged and are bounded at `MUTATION_MS = 20 * SEED_MS`
    (300 s). Measured, each goes red on its first seed of the defaults or soon after:
    - seed 1: the six `observeTime` mutants on G4, and the hard-due feed mutant on G7;
    - seed 7: the hold-off mutant on G7;
    - seed 8: the acts' receipt mutant on G9;
    - seed 9: the card-read mutant on G1 and the cursor-first mutant on G8;
    - seed 15: the budget mutant on G2.
- Full mode (`CCRC_SIM=full`) still runs 5,000 seeds, now as 250 cases of 20 (279 cases in the file), with the same
  per-case bound, and the edges are checked over the union. The replay variables keep their meaning: `CCRC_SIM_SEED=n`
  runs one case of one seed and skips the edge check; `CCRC_SIM_SEEDS=n` adds a soak and splits it the same way.
- No invariant, scenario step, seed or product file changed. No skip, retry or flake tag was added, and the file stays
  in every run that gates a merge.

## 4. Red first: the pin and the union check

Each mutation below was applied by hand to the committed tree, one at a time. The named case was run, then the file
was restored from git. All of them went red, and the unmutated tree is green.

| # | Mutation | Case run | Result |
|---|---|---|---|
| M1 | `seedRanges` drops the last seed of each range | the pin | red: 190 seeds against 200 |
| M2 | `seedRanges` overlaps each range by one seed (a seed repeated) | the pin | red: 209 against 200 |
| M3 | `DEFAULTS` of 199 seeds | the pin | red: 199 against 200 |
| M4 | `DEFAULTS` of 4,999 under `CCRC_SIM=full` | the pin, full mode | red: 4,999 against 5,000 (green unmutated, 279 cases) |
| M5 | `RANGES` drops the first seed of the first range | the pin | red: the ranges start at seed 2 |
| M6 | each range case runs and records its seeds less the first | ranges and the last case | red: `ran` lacks seeds 1, 21, … |
| M7 | as M6, under `CCRC_SIM_SEED=1` | the range and the last case | red: `ran` is `[]` against `[1]` |
| M8 | the range cases pool no edges | ranges and the last case | red: `never reached:` all 29 edges |

(`ccrc test` does not pass the caller's environment into the slice, so a variable has to be set inside the wrapped
command, as in `ccrc test -- env CCRC_SIM=full …`. M4's first try without that passed for that reason only, and it was
re-run inside the command.)

## 5. Timings before and after

The whole file, through `ccrc test`. "Beside" is a second heavy run looping alongside it: the timer day and the
coordinator blocked-day sim files, run by `ccrc test --local` from a script. The dev box is a shared fleet box, and
its load changed from run to run (shown with each). "Before" is `main` at `7b0dc02ff9`, extracted into a scratch
directory.

| Run | Where | Load (1 min) | Seeded cases | Largest case against its bound | Mutation cases (total, largest) | File |
|---|---|---|---|---|---|---|
| before, alone | dev box | 15 | 1 case: 200 s | 200 s of 600 s (33 %) | 53 s, 14.7 s | 254 s |
| before, beside | dev box | 24 | 1 case: 453 s | 453 s of 600 s (75 %) | 120 s, 34.3 s | 574 s |
| before, alone | test box | | 1 case: 385 s | 385 s of 600 s (64 %) | not run | |
| after, alone | dev box | 17 | 10 cases: 286 s | 49.9 s of 300 s (17 %) | 62 s, 17.6 s | 350 s |
| after, beside | dev box | 11 to 13 | 10 cases: 333 s | 43.6 s of 300 s (15 %) | 103 s, 28.5 s | 438 s |
| after, alone | test box | | 10 cases: 366 s, 35 to 38 s each | 37.7 s of 300 s (13 %) | 95 s, 26.8 s | 465 s |

An earlier `main` run on the dev box at load 7 took 120 s for the seeded case. The work per seed is the same before and
after, and the file's total wall time moves only with load. What changes is how close any one case sits to its bound.
At CI's worst measured rate (3.7 s a seed), a range takes about 74 s of its 300 s and the slowest mutation case about
55 s of its 300 s. At that rate the old single case would take 737 s against its 600 s bound.

## 6. Notes for the ledger

- No deviation number was defined.
- No product code changed. The measurement found nothing in `server/src` that should change: the lane's per-pass
  store reads are its design. A coordinator who wants a faster day could ask for fewer store reads per pass, but that
  is the lane's own question, not this test's.
- A merge arms nothing.
