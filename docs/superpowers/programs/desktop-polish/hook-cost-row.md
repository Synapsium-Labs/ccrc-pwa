# Wave 183: the session hook's cost row that went red now and then

Task note for desktop-polish wave 183 (issue #3418). Claims are labelled **measured** (run here) or **read** (from the
code or a log, not run). Every figure is the worker's own measurement; the scratch scripts and their raw outputs are
not in the tree, and the tables below are copied from them.

## 1. In short

- **The row.** `server/test/session-hook-prune-deny.test.ts`, "quotes: deny linearity from 32 to 64 KB stays within
  the inherited-cost bound", failed in hosted full runs one to two percent over its bound, on changes that touched
  neither the hook nor the test.
- **The premise the brief started from was wrong, and the measurement says so.** The margin was NOT eaten by growth of
  the hook's program: the difference (current ratio less the original's) averaged -0.035 over 45 hosted full runs before
  #3169 and -0.029 over 104 after it (§3). The two reds in the issue were the tail of that spread.
- **This row cannot see a quadratic step,** because on this input the program is already quadratic: both programs cost
  about 0.2 s plus c·n², the n² term about 98% of the fitted cost at 32 and 64 KB, so their 64/32 ratio sits near 3.9
  whatever is added in n² (§4). The linearity rows catch growth faster than n²; the 64 KB cost rows catch a cost of any
  shape.
- **What made the reds:** one change of CPU contention inside a round. CPU time is not contention-proof on a shared
  core, and the current program's 64 KB sample was always the last of a round (§5).
- **The repair (D-9118):** the four linearity rows measure four rounds, reverse which program runs first on alternate
  rounds, and read the median of the per-round differences. FD8's margin, the sizes and the original's hash do not
  move. At ambient load the false reds fell from 2 in 26 windows to 0 in 24 (§6).
- **A second ruling folded in (D-9141, the hook owner's):** the 64 KB cost rows read a baseline of their own, the hook's
  program at the quiz row's gate (06aed21ff7), because against the original they let the deny path's cost about double
  before going red (§8).
- **The limit, measured and not removed:** a load that switches on and off with a period near one 64 KB sample still
  reds the row, before and after; on a box at load 20 to 40 the row reads red on about 1 to 3 runs in 100 with nothing
  wrong (§7). Nothing retries a red.
- **Fix round 1 (review 4009):** which baseline each of the eight rows reads is one table, `ROW_BASELINE`, and a round's
  order and cells go through `pairCells`; each is pinned by a case that measures nothing, red first, and four mutants
  of the test file read red by case name (§9). What the rows cannot see, and what D-9141 tightened and widened, are
  stated in the test's comment, the plan's entry and §8; the figures review 4009 could not reproduce are corrected
  (§3, §4, §5, §9, §10).

## 2. Where and how it was measured

- **The fleet box:** 16 cores, shared with about twenty live sessions; its load average was 6 to 49 over the day and
  never idle. Every run went through the supported runner, `ccrc test --local`, in the foreground where it fitted the
  shell's ten minutes, one process at a time.
- **jq:** the box has jq 1.8.1. The hosted runners' image is Ubuntu 24.04, whose package is jq 1.7.1 (**inferred** from
  the image, not read from a log). Most figures here use the jq 1.7.1 release binary (checksum matched against the
  release's own list) put first on PATH. A correction to the proposal: it said 1.8.1 costs about 1.7 times more; that
  came from two calibration runs made a different way (one queued through the slice, one on the remote test box). Run
  the same way, 1.8.1 costs the same as 1.7.1 here (about 3.4 s at 32 KB for both).
- **Load:** "ambient" is the box's own load; "loaded" adds CPU spinners at nice 10 for the whole run (12 in step 1, 6 in
  step 3, so as not to starve the box for hours); "bursty" switches 12 spinners on for 13 s and off for 12 s.
- **Main.** Step 1 and the first sixty step-3 runs were on main 44f2b15a3b, **before** the quiz row's gate
  (06aed21ff7, #3432). The branch then absorbed main c435573bc4, after the gate, by a merge the coordinator directed
  (mail of 2026-11-26; the probe was clean, so none of the worker skill's own absorb triggers held). The mutants and
  the thirty runs of §9 are on that tree.
- **The whole-project compile check** (`tsc -p test/tsconfig.tests.json`) was killed by the shared test slice's memory
  cap (exit 137) and so was not run here; the test file alone, through a config that extends the test project, is clean.
  The hosted run's own compile check is the measurement.

## 3. Step 1: was the margin consumed by growth? No

**Measured**, the row as it stood (faster of two, two rounds), on main 44f2b15a3b with jq 1.7.1. The difference is the
current program's 64/32 ratio less the original's; the row was red past +0.5.

```text
quiet: n=30 reds=2 mean=-0.052 sd=0.335 min=-0.775 p10=-0.547 med=+0.001 p90=+0.415 max=+0.556
loaded: n=10 reds=0 mean=-0.110 sd=0.271 min=-0.902 p10=-0.191 med=-0.005 p90=+0.028 max=+0.034
bursty: n=10 reds=2 mean=-0.238 sd=0.744 min=-1.712 p10=-0.846 med=-0.174 p90=+0.594 max=+0.896
hosted(merge_group+dispatch, attempts): n=104 reds=0 mean=-0.029 sd=0.136 min=-0.596 p10=-0.165 med=-0.024 p90=+0.136 max=+0.416
  hosted ref-small 0-3000ms: n=13 reds=0 mean=-0.017 sd=0.278 min=-0.596 p10=-0.350 med=+0.033 p90=+0.364 max=+0.416
  hosted ref-small 3000-4000ms: n=47 reds=0 mean=-0.046 sd=0.085 min=-0.265 p10=-0.145 med=-0.026 p90=-0.006 max=+0.233
  hosted ref-small 4000-9000ms: n=44 reds=0 mean=-0.015 sd=0.113 min=-0.184 p10=-0.153 med=-0.021 p90=+0.143 max=+0.292
```

The real row's fifty runs, each with its load (1-minute average at start and end) and its printed figures:

| # | series | load | original | current | diff | bound | cpu ms | result |
|---|---|---|---|---|---|---|---|---|
| 1 | quiet | 12.26..12.66 | 3.670 | 3.632 | -0.038 | 4.170 | 3815, 3712, 14001, 13482 | pass |
| 2 | quiet | 12.66..9.95 | 3.821 | 3.862 | +0.041 | 4.321 | 3559, 3450, 13599, 13325 | pass |
| 3 | quiet | 9.95..7.99 | 4.161 | 3.809 | -0.352 | 4.661 | 3337, 3486, 13884, 13277 | pass |
| 4 | quiet | 7.99..8.67 | 3.617 | 3.695 | +0.078 | 4.117 | 3492, 3368, 12630, 12445 | pass |
| 5 | quiet | 8.67..11.31 | 3.886 | 3.919 | +0.033 | 4.386 | 3293, 3259, 12797, 12772 | pass |
| 6 | quiet | 11.31..14.43 | 3.907 | 4.322 | +0.415 | 4.407 | 3279, 3297, 12810, 14249 | pass |
| 7 | quiet | 16.98..16.60 | 4.196 | 3.649 | -0.547 | 4.696 | 3321, 3638, 13936, 13275 | pass |
| 8 | quiet | 16.60..13.61 | 3.950 | 3.881 | -0.069 | 4.450 | 3415, 3405, 13489, 13216 | pass |
| 9 | quiet | 13.61..10.30 | 3.836 | 3.694 | -0.142 | 4.336 | 3309, 3373, 12694, 12461 | pass |
| 10 | quiet | 10.30..8.12 | 3.991 | 4.002 | +0.011 | 4.491 | 3141, 3215, 12536, 12866 | pass |
| 11 | quiet | 8.12..11.87 | 3.935 | 4.161 | +0.226 | 4.435 | 3404, 3539, 13394, 14725 | pass |
| 12 | quiet | 11.87..8.72 | 3.857 | 3.687 | -0.170 | 4.357 | 3325, 3503, 12826, 12917 | pass |
| 13 | quiet | 6.64..23.77 | 3.817 | 3.822 | +0.004 | 4.317 | 4148, 4458, 15834, 17037 | pass |
| 14 | quiet | 23.77..17.45 | 3.842 | 4.361 | +0.518 | 4.342 | 3756, 3542, 14432, 15446 | RED |
| 15 | quiet | 17.45..9.25 | 3.705 | 3.705 | -0.001 | 4.205 | 3653, 3774, 13536, 13982 | pass |
| 16 | quiet | 9.25..6.67 | 3.924 | 4.480 | +0.556 | 4.424 | 3550, 3542, 13929, 15868 | RED |
| 17 | quiet | 6.67..16.27 | 3.644 | 3.803 | +0.158 | 4.144 | 4299, 4113, 15667, 15640 | pass |
| 18 | quiet | 16.27..13.85 | 3.849 | 3.795 | -0.054 | 4.349 | 3601, 3633, 13861, 13787 | pass |
| 19 | quiet | 15.22..9.67 | 3.829 | 3.912 | +0.083 | 4.329 | 3486, 3735, 13348, 14610 | pass |
| 20 | quiet | 9.67..8.56 | 3.730 | 3.791 | +0.061 | 4.230 | 3393, 3291, 12656, 12476 | pass |
| 21 | quiet | 8.56..11.14 | 3.990 | 3.918 | -0.072 | 4.490 | 3186, 3247, 12713, 12722 | pass |
| 22 | quiet | 11.14..11.04 | 3.811 | 3.811 | +0.001 | 4.311 | 3372, 3249, 12850, 12383 | pass |
| 23 | quiet | 10.79..12.53 | 3.756 | 3.641 | -0.115 | 4.256 | 3995, 4189, 15004, 15252 | pass |
| 24 | quiet | 12.53..7.30 | 4.343 | 3.646 | -0.697 | 4.843 | 3402, 3785, 14775, 13801 | pass |
| 25 | quiet | 7.30..8.35 | 4.496 | 3.721 | -0.775 | 4.996 | 3521, 3713, 15832, 13817 | pass |
| 26 | quiet | 8.35..12.36 | 3.824 | 3.108 | -0.716 | 4.324 | 3773, 4283, 14428, 13313 | pass |
| 27 | quiet | 12.36..13.31 | 3.722 | 3.800 | +0.078 | 4.222 | 3620, 3609, 13474, 13715 | pass |
| 28 | quiet | 13.31..9.57 | 4.788 | 4.274 | -0.514 | 5.288 | 3331, 3509, 15949, 14997 | pass |
| 29 | quiet | 9.57..7.48 | 3.588 | 3.541 | -0.047 | 4.088 | 3707, 3753, 13300, 13289 | pass |
| 30 | quiet | 7.48..13.46 | 3.539 | 4.013 | +0.474 | 4.039 | 3663, 3555, 12964, 14266 | pass |
| 31 | loaded | 22.57..39.49 | 3.840 | 3.869 | +0.028 | 4.340 | 6400, 6361, 24579, 24610 | pass |
| 32 | loaded | 39.49..39.33 | 3.855 | 3.837 | -0.018 | 4.355 | 6438, 6434, 24819, 24688 | pass |
| 33 | loaded | 39.33..34.66 | 3.775 | 3.777 | +0.002 | 4.275 | 6471, 6521, 24426, 24630 | pass |
| 34 | loaded | 28.90..38.22 | 3.833 | 3.867 | +0.034 | 4.333 | 6390, 6393, 24493, 24719 | pass |
| 35 | loaded | 38.22..34.31 | 3.853 | 3.848 | -0.005 | 4.353 | 6409, 6407, 24696, 24655 | pass |
| 36 | loaded | 34.31..29.03 | 3.827 | 2.925 | -0.902 | 4.327 | 6451, 6443, 24691, 18846 | pass |
| 37 | loaded | 23.02..34.55 | 4.047 | 3.856 | -0.191 | 4.547 | 6099, 6409, 24683, 24714 | pass |
| 38 | loaded | 34.55..35.33 | 3.857 | 3.864 | +0.007 | 4.357 | 6397, 6430, 24673, 24848 | pass |
| 39 | loaded | 37.09..29.72 | 3.890 | 3.842 | -0.048 | 4.390 | 6430, 6456, 25011, 24802 | pass |
| 40 | loaded | 29.72..36.00 | 3.845 | 3.836 | -0.009 | 4.345 | 6467, 6481, 24865, 24858 | pass |
| 41 | bursty | 24.59..24.17 | 4.122 | 3.311 | -0.811 | 4.622 | 4140, 5040, 17064, 16686 | pass |
| 42 | bursty | 24.17..33.08 | 4.470 | 3.624 | -0.846 | 4.970 | 4486, 4980, 20054, 18049 | pass |
| 43 | bursty | 33.08..37.42 | 3.739 | 3.565 | -0.174 | 4.239 | 5385, 5866, 20137, 20915 | pass |
| 44 | bursty | 30.74..27.61 | 4.353 | 3.787 | -0.566 | 4.853 | 5051, 5498, 21989, 20823 | pass |
| 45 | bursty | 27.61..23.04 | 4.243 | 5.138 | +0.896 | 4.743 | 4295, 3410, 18223, 17522 | RED |
| 46 | bursty | 23.04..20.69 | 6.082 | 4.370 | -1.712 | 6.582 | 3603, 3900, 21912, 17042 | pass |
| 47 | bursty | 17.46..26.65 | 4.464 | 4.687 | +0.222 | 4.964 | 3973, 3739, 17737, 17524 | pass |
| 48 | bursty | 26.65..26.59 | 2.874 | 2.537 | -0.337 | 3.374 | 5301, 5647, 15237, 14327 | pass |
| 49 | bursty | 26.59..23.40 | 3.034 | 3.392 | +0.358 | 3.534 | 5163, 4441, 15666, 15063 | pass |
| 50 | bursty | 34.15..29.13 | 3.620 | 4.214 | +0.594 | 4.120 | 4802, 4270, 17381, 17992 | RED |

**Read** from the server shard logs of hosted full runs (merge queue and dispatched full runs), the row's printed line:

```text
pre-#3169                          n= 45 reds=0 diff mean -0.035 sd 0.085 min -0.502 max +0.050; current/original cpu at 32 KB 0.758, at 64 KB 0.753
  original 32 KB 0-3000 ms         n=  2 reds=0 diff mean -0.371 sd 0.130 min -0.502 max -0.241; current/original cpu at 32 KB 0.785, at 64 KB 0.714
  original 32 KB 3000-4000 ms      n= 31 reds=0 diff mean -0.012 sd 0.027 min -0.103 max +0.045; current/original cpu at 32 KB 0.756, at 64 KB 0.754
  original 32 KB 4000-9000 ms      n= 12 reds=0 diff mean -0.039 sd 0.045 min -0.110 max +0.050; current/original cpu at 32 KB 0.758, at 64 KB 0.752
post-#3169                         n=104 reds=0 diff mean -0.029 sd 0.136 min -0.596 max +0.416; current/original cpu at 32 KB 1.008, at 64 KB 1.001
  original 32 KB 0-3000 ms         n= 13 reds=0 diff mean -0.017 sd 0.278 min -0.596 max +0.416; current/original cpu at 32 KB 1.009, at 64 KB 1.026
  original 32 KB 3000-4000 ms      n= 47 reds=0 diff mean -0.046 sd 0.085 min -0.265 max +0.233; current/original cpu at 32 KB 1.008, at 64 KB 1.002
  original 32 KB 4000-9000 ms      n= 44 reds=0 diff mean -0.015 sd 0.113 min -0.184 max +0.292; current/original cpu at 32 KB 1.004, at 64 KB 0.999
issue #3418's two reds (pull request full runs, not in the sample above): diff +0.592 (cpu 2793, 2681, 9874, 11064) and +0.537 (4770, 4605, 17842, 19694)
```

**History of the program** (§3 of the brief): the forbidden program at #2692's merge and at each merge since that
changed it. The ratio did not move at any merge beyond noise; the COST did, at one: #3169 (fbbf15a03a, the replay
quiz, which ran a new matcher over the command and its normalised form) raised the deny path's cost on this input by
about 30% at both sizes. Measured locally, each program's 32 and 64 KB samples adjacent, the order rotated. The cost
column is the median of the per-round ratios, each program against the original in the same round. The proposal's
table divided two medians taken from different rounds, which the load moved (it read main at 0.85 and 0.99), and
review 4009 could not reproduce it from §4. Corrected in fix round 1; the ratio column is unchanged:

```text
base   own 64/32 ratio median 3.819 (range 3.32..3.93), minus original's +0.000; cpu vs original, median of the per-round ratios, at 32 KB 1.00, 64 KB 1.00
p2692  own 64/32 ratio median 3.834 (range 3.53..4.03), minus original's +0.015; cpu vs original, median of the per-round ratios, at 32 KB 0.77, 64 KB 0.78
p1171  own 64/32 ratio median 3.666 (range 3.39..4.37), minus original's -0.153; cpu vs original, median of the per-round ratios, at 32 KB 0.78, 64 KB 0.77
pa51a  own 64/32 ratio median 3.700 (range 3.31..3.93), minus original's -0.119; cpu vs original, median of the per-round ratios, at 32 KB 0.75, 64 KB 0.75
pfbbf  own 64/32 ratio median 3.987 (range 3.33..4.25), minus original's +0.168; cpu vs original, median of the per-round ratios, at 32 KB 0.96, 64 KB 0.98
main   own 64/32 ratio median 3.983 (range 3.38..4.35), minus original's +0.164; cpu vs original, median of the per-round ratios, at 32 KB 0.97, 64 KB 0.99
```

The other rows of the block on hosted runners after #3169 and before the gate (the 64 KB cost figures read off the samples the linearity rows print):

```text
linearity rows: headroom = bound - current ratio
  quotes/deny  original 3.81 current 3.79 bound 4.31; headroom median +0.52, worst +0.08
  quotes/class original 3.89 current 1.52 bound 4.39; headroom median +2.87, worst +2.42
  dqsub/deny   original 1.90 current 1.87 bound 2.50; headroom median +0.63, worst +0.52
  dqsub/class  original 1.69 current 1.53 bound 2.50; headroom median +0.97, worst +0.88
64 KB cost rows (current <= max(1.5 x original, original + 25 ms)), read from the 64 KB samples the linearity rows print: current / bound
  quotes/deny  pre-#3169 median 0.50 worst 0.51; post median 0.67 worst 0.73
  quotes/class pre-#3169 median 0.01 worst 0.01; post median 0.01 worst 0.01
  dqsub/deny   pre-#3169 median 0.73 worst 0.80; post median 0.86 worst 0.93
  dqsub/class  pre-#3169 median 0.74 worst 0.95; post median 0.77 worst 0.87
```

## 4. What the linearity row can and cannot see

**Measured**, median CPU ms by size (four rounds, jq 1.7.1), fitted as a + b·n + c·n² (n in KB):

```text
program      8KB     16KB     24KB     32KB     48KB     64KB
base         348     1096     2234     3868     8078    14718
pa51a        246      793     1648     2828     6144    11172
main         316     1154     2246     3930     8294    15170
main-pa51a     70    361    598   1102   2151   3998
fits: original a=219 c=3.588 (64/32 fitted 3.90); pa51a a=171 c=2.790 (3.98); main a=228 c=3.740 (3.94); the n^2 term is over 98% of the cost at 32 and 64 KB in all three.
```

"Over 98%" in the fits line is the fitted line's share, 97.8%; of the original's measured 3 868 ms at 32 KB the n²
term is about 95% (the fit has a small negative linear term). All three programs are almost pure n² on the quote-dense
deny input. #3169 multiplied c by about 1.34 and left the
exponent, so the 64/32 ratio stayed near 3.9 (the n² limit is 4.0). A ratio row therefore cannot see a quadratic step,
of any weight; it sees a step that grows faster than n². The 64 KB cost row sees any step once it is large enough.

## 5. What made the reds

- Steady extra load doubled every sample (3.4 s to 6.4 s at 32 KB). In 7 of the 10 loaded runs it moved the difference
  by at most ±0.03 (§3, loaded), because uniform contention cancels in a ratio. The other three read −0.90, −0.19 and
  −0.05; they are the next bullet's case, load that changed inside the run.
- Load that changes inside a run moves the four samples differently: bursty load gave an sd of 0.74 and 2 reds in 10;
  one loaded run whose spinners ended between samples read -0.90.
- In the old order the current program's 64 KB sample was always the fourth of a round, so contention that rose just
  before it read as worse scaling, and the faster of two rounds could not undo it when both rounds were hit.

## 6. The repair (D-9118) and the estimators compared

**Measured**, raw interleaved samples (the original, main and a cubic mutant in every round, the order reversed on odd
rounds), each estimator simulated over sliding windows of its rounds. "cube180" is main plus (n/180)³ empty loop steps,
about 18% of main's cost at 32 KB:

```text
== est-quiet.jsonl: 27 complete rounds
  min of 2 (today)             main red 2/26 diff mean -0.02 sd 0.28 max +0.60 | cube180 red 18/26 diff mean +0.65 min -0.14
  min of 3                     main red 0/25 diff mean +0.01 sd 0.18 max +0.48 | cube180 red 17/25 diff mean +0.68 min +0.11
  min of 4                     main red 0/24 diff mean +0.03 sd 0.18 max +0.44 | cube180 red 19/24 diff mean +0.68 min +0.11
  median per-round diff, 3     main red 0/25 diff mean -0.07 sd 0.14 max +0.19 | cube180 red 20/25 diff mean +0.57 min +0.05
  median per-round diff, 4     main red 0/24 diff mean -0.04 sd 0.12 max +0.15 | cube180 red 23/24 diff mean +0.61 min +0.40
  paired per-size median, 3    main red 0/25 diff mean -0.06 sd 0.15 max +0.24 | cube180 red 21/25 diff mean +0.60 min +0.05
  paired per-size median, 4    main red 0/24 diff mean -0.05 sd 0.13 max +0.18 | cube180 red 22/24 diff mean +0.63 min +0.36
== est-bursty.jsonl: 19 complete rounds
  min of 2 (today)             main red 5/18 diff mean -0.13 sd 1.02 max +1.45 | cube180 red 16/18 diff mean +1.54 min +0.25
  min of 3                     main red 5/17 diff mean -0.07 sd 0.89 max +1.28 | cube180 red 15/17 diff mean +1.60 min +0.44
  min of 4                     main red 3/16 diff mean -0.07 sd 0.69 max +1.11 | cube180 red 15/16 diff mean +1.71 min +0.44
  median per-round diff, 3     main red 4/17 diff mean +0.32 sd 0.60 max +1.62 | cube180 red 12/17 diff mean +1.29 min -1.25
  median per-round diff, 4     main red 6/16 diff mean +0.29 sd 0.42 max +0.94 | cube180 red 13/16 diff mean +1.22 min +0.06
  paired per-size median, 3    main red 6/17 diff mean +0.39 sd 0.63 max +1.77 | cube180 red 12/17 diff mean +1.76 min -1.36
  paired per-size median, 4    main red 5/16 diff mean +0.29 sd 0.46 max +1.19 | cube180 red 8/16 diff mean +0.81 min -0.57
```

The median of the four per-round differences was chosen: at ambient load no false red in 24 windows (today's 2 in 26)
and the cubic mutant caught 23 in 24 (today's 18 in 26). The windows slide over 27 and 19 rounds, so they share rounds:
about six of them are independent, and the same rounds both chose the estimator and judged it. Read the counts as a
comparison of estimators on one sample, not as rates. The detection curve, a step added to main at its own contention,
as a share of main's cost at 32 KB:

```text
cubic step (x7.7 per doubling)
  step =   5% of main at 32 KB:  today min-of-2 red 3/26 (diff +0.16)  median diff of 4 red 0/24 (diff +0.13)
  step =   8% of main at 32 KB:  today min-of-2 red 3/26 (diff +0.25)  median diff of 4 red 0/24 (diff +0.23)
  step =  10% of main at 32 KB:  today min-of-2 red 4/26 (diff +0.31)  median diff of 4 red 0/24 (diff +0.29)
  step =  12% of main at 32 KB:  today min-of-2 red 5/26 (diff +0.37)  median diff of 4 red 3/24 (diff +0.35)
  step =  15% of main at 32 KB:  today min-of-2 red 9/26 (diff +0.46)  median diff of 4 red 8/24 (diff +0.43)
  step =  20% of main at 32 KB:  today min-of-2 red 17/26 (diff +0.59)  median diff of 4 red 15/24 (diff +0.56)
  step =  30% of main at 32 KB:  today min-of-2 red 23/26 (diff +0.82)  median diff of 4 red 24/24 (diff +0.79)
  step =  50% of main at 32 KB:  today min-of-2 red 25/26 (diff +1.20)  median diff of 4 red 24/24 (diff +1.17)
  step = 100% of main at 32 KB:  today min-of-2 red 26/26 (diff +1.81)  median diff of 4 red 24/24 (diff +1.77)
quadratic step (x3.8 per doubling)
  step =   5% of main at 32 KB:  today min-of-2 red 2/26 (diff -0.03)  median diff of 4 red 0/24 (diff -0.05)
  step =   8% of main at 32 KB:  today min-of-2 red 2/26 (diff -0.03)  median diff of 4 red 0/24 (diff -0.05)
  step =  10% of main at 32 KB:  today min-of-2 red 2/26 (diff -0.03)  median diff of 4 red 0/24 (diff -0.06)
  step =  12% of main at 32 KB:  today min-of-2 red 2/26 (diff -0.04)  median diff of 4 red 0/24 (diff -0.06)
  step =  15% of main at 32 KB:  today min-of-2 red 2/26 (diff -0.04)  median diff of 4 red 0/24 (diff -0.06)
  step =  20% of main at 32 KB:  today min-of-2 red 2/26 (diff -0.05)  median diff of 4 red 0/24 (diff -0.07)
  step =  30% of main at 32 KB:  today min-of-2 red 2/26 (diff -0.06)  median diff of 4 red 0/24 (diff -0.08)
  step =  50% of main at 32 KB:  today min-of-2 red 1/26 (diff -0.07)  median diff of 4 red 0/24 (diff -0.09)
  step = 100% of main at 32 KB:  today min-of-2 red 1/26 (diff -0.10)  median diff of 4 red 0/24 (diff -0.12)
```

**The order of samples (condition 4).** `linearityOrder` puts the original first on even rounds and the current
program first on odd rounds; the second program at a size is the last of that pair. Across the four rounds each
program is last twice at each size (pinned by a case), where before the current program was last in every round.

**Pinned without a CPU measurement (condition 5).** `linearity-windows.json` holds two recorded windows (numbers only,
from the raw samples above, rounds 21 to 24 at ambient load): `ambient`, main, red under the faster of two (its first two
rounds read current 4.37 against a bound of 4.26) and green under the median (median difference -0.017);
`cubic`, the cube180 mutant on the same rounds, red under both (+1.08 and +0.62). The cases went red first on the missing
definitions.

## 7. The limit, and what a red means now

- **Bursty load** (12 spinners, 13 s on and 12 s off): 5 of 18 windows red before, 6 of 16 after. No estimator over four
  rounds survives a load whose period matches one 64 KB sample.
- **At load 20 to 40** one round's difference has an sd of about 0.4, which predicts the median of four over the margin
  on about 1% of runs (jq 1.7.1's pool) to 3% (jq 1.8.1's). That rate is for independent rounds. Where one contention
  episode spans rounds, as in run 54 below, the rounds are not independent, and the rate is a lower bound.
- **What the median and the alternation cannot do** (review 4009, computed on the recorded `ambient` window with the
  real `linearityVerdict`):
  - By design the median hides a spike in one round of four: the current program's large sample ×3 in one round left
    the median at −0.017.
  - It sees a spike in two of the four rounds only above about 1.25×: ×1.5 in two rounds read red (0.92, 1.13); ×1.25
    read 0.45 or 0.69, by which two rounds.
  - A program slowed only when it runs second is seen at half strength, because the alternation halves it: a penalty
    of 4 s on the current program's large sample in the rounds where it runs second moved the median by +0.57, and
    2 s by +0.28.
  - The 64 KB cost rows still run the baseline first and the current program second in both of their pairs, the order
    D-9118 found at fault in the linearity rows. Against a 1.5× bound and a worst loaded reading of 0.79, it is a
    limit, not a cause of reds measured here. Six rounds would give about 0.3% to 1.4% at 1.5 times the
  time, past the timeout on this box; the coordinator ruled four rounds (option a).
- **The worked example**, the one red in step 3: run 54, jq 1.8.1, load 13 to 18 with 6 spinners: original 3.594,
  current 4.298, bound 4.094; per-round differences 1.148, 0.189, 0.845, 0.563, three of the four rounds inside one
  contention episode. It is not a 1.8.1 shift: 18 interleaved rounds of raw 1.8.1 samples gave a mean difference of
  +0.05 (standard error 0.09), current over original cost 1.003 at 32 KB and 1.011 at 64 KB.
- On hosted runners the spread is smaller (sd 0.136 for the old estimator there, 0.28 here at ambient load), and the
  rate is predicted far lower; the hosted run bounds it, it does not prove it. **A red is re-run alone on a quiet box
  before it is believed.**

## 8. The cost rows' own baseline (D-9141)

After the gate the deny path costs 0.75 of the original at 64 KB, where it stood before #3169 (0.755 hosted), so the
cost rows' bound, 1.5 times the original, let the deny path's cost about double before it went red. **Measured** on
the gated program against the original (jq 1.7.1, four rounds, the faster-of-two reading over the 1.5x bound):

```text
the original             64 KB median  12256 ms, 1.00 of the original, step +34% of the gated cost; readings 0.67 and 0.67 of the bound
the gated program        64 KB median   9131 ms, 0.74 of the original, step +0% of the gated cost; readings 0.49 and 0.50 of the bound
gated + (n/7.6)^2 step   64 KB median  16426 ms, 1.34 of the original, step +80% of the gated cost; readings 0.87 and 0.89 of the bound
gated + (n/6.7)^2 step   64 KB median  18722 ms, 1.53 of the original, step +105% of the gated cost; readings 0.99 and 1.02 of the bound
gated + (n/5)^2 step     64 KB median  26142 ms, 2.13 of the original, step +186% of the gated cost; readings 1.43 and 1.42 of the bound
```
Through the real test file on the old baseline the +80% and the +105% steps both read green (the cost row printed no figures then); the line sits near +100%, as the arithmetic says (0.75 x 2 = 1.5).

The hook's owner ruled (its call 1562) that the cost rows read today's program as their baseline, with the factor
unchanged. It is vendored as `fixtures/prune-deny/forbidden-jq-06aed21ff.jq` (the program at the gate's merge,
byte-identical to main c435573bc4's), pinned by its own sha256 and held by a case; the linearity rows keep
`forbidden-jq-33e521e07.jq`. The two files answer two rulings: inherited scaling against the program the deny was
added to, and today's accepted cost; each is frozen by its own hash and named by its commit; a test cannot read a commit
through git. The file is replaced only on the owner's next ruling on accepted cost, never to turn a row green. The deny
rows keep the 25 ms floor; the class rows, whose program costs about one jq start-up, take a floor of their own, 250 ms,
which the owner made conditional on their worst loaded reading staying under half the bound (§9). Each cost row now
prints its current, baseline and bound on green. Which row reads which file is one table in the test, `ROW_BASELINE`,
and the measuring cases read their baseline only through it. A case that measures nothing pins it: the four cost rows
read the program at the gate, the four linearity rows the original (review 4009 F2, §9).

**What is pinned now, and what D-9141 changed in each bound** (review 4009 F1):

- FD8 pinned historical cost and doubling-size scaling against the original. Now the four linearity rows pin scaling
  against the original, and the four cost rows pin cost against the program at the gate. No row bounds cost against
  the original any more.
- D-9141 **tightened** two bounds (hosted figures): quotes/deny from about 27 s (1.5 × 18 104) to 20.7 s; quotes/class
  from about 6.7 s (1.5 × the original's quadratic class path, which the row read 0.01 of) to 316 ms.
- It **widened** two: dqsub/class from 81 to 318 ms, and dqsub/deny from 310.5 to 352.5 ms, because the gated program
  costs more than the original on the dqsub shape (238 against 207 ms).
- **What the class rows cannot see** (review 4009, jq 1.8.1 on the fleet box):
  - A class cost row's bound is its baseline (about 35 to 70 ms, one jq start-up) plus 250 ms. It sees a class step of
    250 ms and up and nothing under it: a fixed burn of about 180 ms, a class path 5.5 times dearer, read green on both
    class cost rows; about 250 ms read red. Hosted, the edge is about 4.8 times the class path's cost.
  - Neither quotes/class row sees a quadratic step of any weight. The original's class path is itself quadratic on the
    quotes input, so the linearity bound is 4.40×, above n²'s 4.0. A step that made the class path 6 times dearer read
    green on both quotes/class rows.
  - dqsub/class linearity does see it: 3.86× against 2.5×.
  - So what the suite does not see on the class path is a step under 250 ms, and on the quotes shape a quadratic one of
    any weight.
- **The 250 ms floor is a chosen allowance, not a measured one.** Its condition, the worst loaded reading under half
  the bound, holds for any class path under about 250 ms at this size, and a floor of 100 to 150 ms would meet it too.
  On the original with 25 ms, hosted dqsub/class read up to 0.95 of its bound (§3), which is a reason to raise the
  floor; how far is the owner's call.
- On a loaded box one program's own 64 KB CPU spread about 30% across review 4009's runs (6.9 to 10.6 s). There a
  quotes/deny step of 50 to 60% can read green when the baseline sample reads high. Hosted, the two samples agreed to
  0.3%, so the edge there is near +50%.

## 9. Step 3: the mutants and the runs

**The mutants, through the real test file** in scratch copies of the server tree (main's test file, and this branch's),
jq 1.7.1:

| program (jq 1.7.1) | row | main's test (before) | this branch (after) |
|---|---|---|---|
| main's hook, unmutated (pre-gate) | quotes/deny linearity | green (two-round runs, §3) | green, 3.870 against 4.266 |
| cubic step (n/150)^3, about a third at 32 KB, pre-gate | quotes/deny linearity | RED, 4.815 against 4.403 | RED, 4.823 against 4.254; differences 1.008, 1.219, 0.874, 1.130 |
| quadratic step (n/8)^2, about 60% at 64 KB, pre-gate | quotes/deny linearity | - | green, 3.815 against 4.377 |
| the same | quotes/deny 64 KB cost, old baseline | - | RED, 19816 against 18247.5 |
| cubic step (n/150)^3, on the gated program | quotes/deny linearity | RED, 5.330 against 4.341 | RED, 5.121 against 4.314; differences 1.536, 1.613, 1.076, 1.023 |
| quadratic step (n/8)^2, about 80% of the gated cost | quotes/deny linearity | - | green, 3.857 against 4.454 |
| the same | quotes/deny 64 KB cost, OLD baseline | - | green; the case passed, and the cost row printed no figures then: 16272 against 1.5 x 12561 = 18842 is RECONSTRUCTED from the 64 KB samples the linearity row printed (the finding of §8) |
| the same | quotes/deny 64 KB cost, NEW baseline (D-9141) | - | RED, 15545 against 13410 (the owner's red-before, green-after case) |
| quadratic steps adding about 80% and 105% of the gated cost | quotes/deny 64 KB cost, old baseline | - | green, green (§8) |

One cell in the table above is not a printed figure; it says so. Through the real test file, the case passed or
failed as shown, and the cost rows printed no figures before D-9141.

**Fix round 1: the mutants of the test file itself** (review 4009 F2). Each was applied to a scratch copy of this
branch's test file and run by name with the cases that pin the order and the baselines, all four measuring nothing:

| mutant of the test file | case that reads red | its message |
|---|---|---|
| none (the file as committed) | none: 4 passed, 31 skipped (35) | - |
| ROW_BASELINE: 'quotes/deny cost' reads the original | “each row reads the baseline its ruling names: the four cost rows the program at the gate (D-9141), the four linearity rows the original (FD8)” | quotes/deny cost: expected 'original' to be 'gate' |
| ROW_BASELINE: 'quotes/deny linearity' reads the program at the gate | “each row reads the baseline its ruling names: the four cost rows the program at the gate (D-9141), the four linearity rows the original (FD8)” | quotes/deny linearity: expected 'gate' to be 'original' |
| pairCells ignores the order (the original always first) | “runs each round's pair in that round's order and puts each sample in its own program's cell, in both orders (pairCells)” | round 1 runs current first: expected [ 'original', 'current' ] to deeply equal [ 'current', 'original' ] |
| pairCells puts the samples in run order, the wrong cells in the odd rounds | “runs each round's pair in that round's order and puts each sample in its own program's cell, in both orders (pairCells)” | round 1's cells are [original, current]: expected [ 21, 12 ] to deeply equal [ 12, 21 ] |

Before this round, the two mutants of `ROW_BASELINE` had no table to edit: a cost case reverted to read the original
stayed green, and so did a linearity case reading the cost baseline. The two mutants of `pairCells` stayed green too,
because the order case tested `linearityOrder` alone.

**Fifty consecutive runs of the repaired row under load, before the gate** (main 44f2b15a3b; ambient load plus 6
spinners), and **ten at jq 1.8.1**: 50 of 50 green at 1.7.1; 9 of 10 green at 1.8.1 (run 54, §7):

```text
jq 1.7.1: 50 runs, 0 red; difference median -0.018, max +0.407; the case took a median of 266 s, at most 416 s (timeout 600 s)
jq 1.8.1: 10 runs, 1 red; difference median -0.002, max +0.704; the case took a median of 293 s, at most 415 s (timeout 600 s)
```

| # | jq | load (1 min) start..end | case s | wall s | original | current | diff | bound | per-round differences | result |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1.7.1 | 15.31..22.86 | 201 | 202 | 3.951 | 3.855 | -0.096 | 4.451 | -0.077, -0.612, -0.115, 0.555 | pass |
| 2 | 1.7.1 | 22.86..27.05 | 171 | 172 | 3.791 | 3.807 | +0.016 | 4.291 | -0.016, -0.457, 0.048, 0.753 | pass |
| 3 | 1.7.1 | 27.05..24.22 | 223 | 224 | 3.604 | 3.577 | -0.026 | 4.104 | -0.062, 0.009, -0.314, 0.825 | pass |
| 4 | 1.7.1 | 23.64..26.10 | 285 | 285 | 4.250 | 4.467 | +0.216 | 4.750 | 0.866, 0.043, 0.214, 0.219 | pass |
| 5 | 1.7.1 | 26.10..32.57 | 276 | 277 | 4.298 | 4.049 | -0.249 | 4.798 | -0.105, -0.026, -0.393, -0.891 | pass |
| 6 | 1.7.1 | 32.57..23.38 | 152 | 153 | 3.842 | 3.658 | -0.184 | 4.342 | -0.177, -0.212, 0.379, -0.191 | pass |
| 7 | 1.7.1 | 22.95..34.27 | 230 | 230 | 4.098 | 4.263 | +0.164 | 4.598 | 0.386, 0.346, -0.017, -0.192 | pass |
| 8 | 1.7.1 | 34.27..29.08 | 273 | 274 | 4.230 | 3.845 | -0.385 | 4.730 | 0.228, -0.639, -0.132, -0.728 | pass |
| 9 | 1.7.1 | 28.19..22.24 | 246 | 246 | 3.975 | 3.634 | -0.341 | 4.475 | -0.403, -0.803, -0.279, 0.316 | pass |
| 10 | 1.7.1 | 22.24..29.05 | 228 | 230 | 3.808 | 4.026 | +0.218 | 4.308 | 0.442, -0.006, 0.519, -0.211 | pass |
| 11 | 1.7.1 | 28.56..39.09 | 266 | 268 | 3.737 | 3.676 | -0.061 | 4.237 | -0.238, -0.069, 0.066, -0.053 | pass |
| 12 | 1.7.1 | 39.09..37.22 | 306 | 307 | 3.742 | 3.829 | +0.087 | 4.242 | 0.173, 0.002, 0.049, 0.125 | pass |
| 13 | 1.7.1 | 37.22..27.06 | 245 | 246 | 3.672 | 3.695 | +0.023 | 4.172 | -0.131, -0.009, 0.054, 0.061 | pass |
| 14 | 1.7.1 | 27.06..21.88 | 353 | 354 | 3.419 | 3.459 | +0.040 | 3.919 | -0.231, 0.070, 0.009, 2.167 | pass |
| 15 | 1.7.1 | 20.12..38.19 | 304 | 305 | 3.633 | 3.868 | +0.235 | 4.133 | -0.095, 0.799, 0.565, -0.129 | pass |
| 16 | 1.7.1 | 38.19..26.39 | 240 | 241 | 3.637 | 3.580 | -0.058 | 4.137 | 0.033, -0.125, 0.010, -0.320 | pass |
| 17 | 1.7.1 | 26.39..25.38 | 224 | 225 | 3.809 | 3.911 | +0.102 | 4.309 | -0.048, 0.197, 0.007, 0.216 | pass |
| 18 | 1.7.1 | 25.38..26.63 | 192 | 192 | 4.057 | 3.867 | -0.190 | 4.557 | -0.507, -0.018, -0.362, 0.178 | pass |
| 19 | 1.7.1 | 26.63..25.64 | 184 | 185 | 3.721 | 3.488 | -0.233 | 4.221 | -0.181, 0.694, -0.890, -0.285 | pass |
| 20 | 1.7.1 | 25.64..25.85 | 257 | 258 | 4.298 | 3.871 | -0.427 | 4.798 | -0.660, -0.703, 0.035, -0.193 | pass |
| 21 | 1.7.1 | 25.85..24.19 | 238 | 239 | 4.194 | 3.768 | -0.426 | 4.694 | 0.493, -0.151, -0.702, -0.784 | pass |
| 22 | 1.7.1 | 24.19..30.07 | 235 | 236 | 4.438 | 3.800 | -0.638 | 4.938 | -0.953, -1.055, -0.035, -0.323 | pass |
| 23 | 1.7.1 | 30.07..24.36 | 269 | 270 | 3.154 | 3.288 | +0.135 | 3.654 | 0.117, 0.152, -0.121, 0.513 | pass |
| 24 | 1.7.1 | 24.36..26.47 | 224 | 225 | 3.886 | 3.772 | -0.114 | 4.386 | -0.630, 0.115, 0.283, -0.343 | pass |
| 25 | 1.7.1 | 25.31..22.95 | 258 | 259 | 3.959 | 4.056 | +0.096 | 4.459 | -0.048, 0.482, -0.333, 0.241 | pass |
| 26 | 1.7.1 | 22.95..23.69 | 224 | 225 | 3.839 | 3.864 | +0.025 | 4.339 | -0.089, 0.139, 1.020, -0.704 | pass |
| 27 | 1.7.1 | 23.69..24.38 | 287 | 288 | 3.606 | 3.276 | -0.330 | 4.106 | 0.232, -0.304, -0.513, -0.356 | pass |
| 28 | 1.7.1 | 24.38..19.74 | 311 | 312 | 3.174 | 3.425 | +0.251 | 3.674 | -0.062, 0.612, 0.119, 0.383 | pass |
| 29 | 1.7.1 | 19.12..25.07 | 290 | 291 | 4.262 | 4.300 | +0.038 | 4.762 | 0.673, -0.080, 0.155, -0.099 | pass |
| 30 | 1.7.1 | 25.07..23.06 | 334 | 334 | 3.906 | 3.816 | -0.090 | 4.406 | 0.490, 0.114, -0.293, -0.659 | pass |
| 31 | 1.7.1 | 23.06..22.09 | 227 | 228 | 3.886 | 3.980 | +0.094 | 4.386 | 0.030, -0.514, 0.158, 0.344 | pass |
| 32 | 1.7.1 | 22.09..28.05 | 265 | 265 | 3.761 | 3.639 | -0.122 | 4.261 | -0.084, -0.160, 0.213, -0.357 | pass |
| 33 | 1.7.1 | 28.05..27.93 | 308 | 310 | 4.078 | 4.102 | +0.024 | 4.578 | -0.478, 0.006, 0.353, 0.043 | pass |
| 34 | 1.7.1 | 27.93..31.59 | 325 | 326 | 4.091 | 3.885 | -0.206 | 4.591 | -0.408, -0.189, -0.223, -0.149 | pass |
| 35 | 1.7.1 | 31.59..33.04 | 307 | 309 | 4.014 | 3.780 | -0.234 | 4.514 | -0.140, -0.327, -0.073, -0.551 | pass |
| 36 | 1.7.1 | 33.04..30.07 | 373 | 375 | 3.873 | 3.870 | -0.003 | 4.373 | -0.235, 0.093, -0.100, 0.261 | pass |
| 37 | 1.7.1 | 30.07..35.51 | 331 | 332 | 4.013 | 3.940 | -0.072 | 4.513 | -0.072, -0.843, 0.022, -0.073 | pass |
| 38 | 1.7.1 | 35.51..31.25 | 304 | 312 | 3.880 | 3.825 | -0.055 | 4.380 | 0.139, -0.032, -0.077, -0.166 | pass |
| 39 | 1.7.1 | 31.25..33.29 | 380 | 382 | 3.917 | 3.848 | -0.070 | 4.417 | -0.058, -0.081, -0.087, 0.047 | pass |
| 40 | 1.7.1 | 31.34..25.07 | 304 | 305 | 3.391 | 3.364 | -0.027 | 3.891 | -0.054, 0.047, -0.029, -0.025 | pass |
| 41 | 1.7.1 | 25.07..38.29 | 416 | 417 | 4.335 | 4.504 | +0.169 | 4.835 | 0.899, 0.097, 0.114, 0.224 | pass |
| 42 | 1.7.1 | 38.29..49.44 | 356 | 357 | 4.109 | 4.098 | -0.011 | 4.609 | -0.056, 0.037, -0.034, 0.011 | pass |
| 43 | 1.7.1 | 49.44..37.99 | 315 | 317 | 3.817 | 3.913 | +0.095 | 4.317 | 0.117, 0.073, 0.413, -0.102 | pass |
| 44 | 1.7.1 | 37.99..22.80 | 267 | 268 | 3.706 | 3.845 | +0.139 | 4.206 | -0.057, 0.029, 0.250, 1.123 | pass |
| 45 | 1.7.1 | 22.80..18.80 | 216 | 217 | 3.846 | 3.775 | -0.071 | 4.346 | -0.646, 0.091, -0.232, 1.368 | pass |
| 46 | 1.7.1 | 18.25..18.18 | 226 | 226 | 3.546 | 3.953 | +0.407 | 4.046 | 0.513, 0.707, 0.302, -0.017 | pass |
| 47 | 1.7.1 | 18.18..15.53 | 197 | 197 | 4.095 | 4.052 | -0.043 | 4.595 | -0.094, 0.007, -0.430, 0.137 | pass |
| 48 | 1.7.1 | 15.53..14.29 | 231 | 232 | 3.896 | 4.017 | +0.121 | 4.396 | -0.107, 0.665, 0.157, 0.085 | pass |
| 49 | 1.7.1 | 14.29..15.56 | 234 | 235 | 3.840 | 3.884 | +0.044 | 4.340 | -0.023, 0.241, 0.112, -0.082 | pass |
| 50 | 1.7.1 | 15.56..13.65 | 266 | 267 | 3.956 | 4.076 | +0.120 | 4.456 | -0.020, 0.260, -0.223, 0.503 | pass |
| 51 | 1.8.1 | 12.79..18.51 | 296 | 296 | 4.886 | 4.878 | -0.008 | 5.386 | 0.216, -0.261, 0.148, -0.163 | pass |
| 52 | 1.8.1 | 18.51..14.57 | 158 | 158 | 3.836 | 3.460 | -0.376 | 4.336 | -0.845, -0.422, -0.121, -0.329 | pass |
| 53 | 1.8.1 | 13.24..12.62 | 147 | 148 | 3.736 | 3.911 | +0.175 | 4.236 | 0.310, -0.867, 0.040, 0.366 | pass |
| 54 | 1.8.1 | 12.62..18.01 | 180 | 181 | 3.594 | 4.298 | +0.704 | 4.094 | 1.148, 0.189, 0.845, 0.563 | RED |
| 55 | 1.8.1 | 10.47..23.76 | 282 | 283 | 3.811 | 3.816 | +0.005 | 4.311 | -0.507, 0.208, 0.149, -0.139 | pass |
| 56 | 1.8.1 | 23.76..22.30 | 320 | 322 | 3.652 | 3.967 | +0.315 | 4.152 | 0.360, 0.225, 1.238, 0.270 | pass |
| 57 | 1.8.1 | 19.61..25.26 | 331 | 332 | 3.832 | 3.924 | +0.092 | 4.332 | 0.334, 0.281, -0.098, -0.545 | pass |
| 58 | 1.8.1 | 25.26..20.61 | 379 | 380 | 3.819 | 3.751 | -0.067 | 4.319 | 0.482, -0.154, -0.195, 0.020 | pass |
| 59 | 1.8.1 | 19.52..22.05 | 415 | 417 | 3.822 | 3.666 | -0.155 | 4.322 | -0.001, -0.226, -0.085, -0.293 | pass |
| 60 | 1.8.1 | 20.60..21.13 | 290 | 293 | 3.973 | 3.616 | -0.357 | 4.473 | -0.426, -0.287, -0.568, 0.298 | pass |

**After the gate, on the new cost baseline**, the whole cost block (all eight rows), twenty runs under load (ambient
plus 6 spinners) and ten at ambient load, jq 1.7.1:

```text
loaded: 20 runs, 0 red
  quotes/deny  cost row current/bound median 0.66, worst 0.73; linearity headroom median +0.51, worst +0.16
  quotes/class cost row current/bound median 0.17, worst 0.19; linearity headroom median +2.87, worst +2.58
  dqsub/deny   cost row current/bound median 0.68, worst 0.79; linearity headroom median +0.77, worst +0.34
  dqsub/class  cost row current/bound median 0.17, worst 0.19; linearity headroom median +1.08, worst +0.50
quiet: 10 runs, 0 red
  quotes/deny  cost row current/bound median 0.67, worst 0.75; linearity headroom median +0.50, worst +0.38
  quotes/class cost row current/bound median 0.12, worst 0.17; linearity headroom median +2.98, worst +2.73
  dqsub/deny   cost row current/bound median 0.66, worst 0.67; linearity headroom median +0.72, worst +0.50
  dqsub/class  cost row current/bound median 0.12, worst 0.12; linearity headroom median +1.03, worst +0.95
```

| # | load | spinners | wall s | quotes/deny cost (cur/bound) | quotes/class cost (cur/bound) | dqsub/deny cost (cur/bound) | dqsub/class cost (cur/bound) | quotes/deny lin. headroom | quotes/class lin. headroom | dqsub/deny lin. headroom | dqsub/class lin. headroom | result |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 8.73..15.82 | 6 | 390 | 0.57 | 0.19 | 0.77 | 0.19 | +0.57 | +2.66 | +0.54 | +1.38 | pass |
| 2 | 15.20..12.57 | 6 | 388 | 0.65 | 0.18 | 0.77 | 0.19 | +0.80 | +3.38 | +0.87 | +0.97 | pass |
| 3 | 12.57..17.51 | 6 | 289 | 0.65 | 0.15 | 0.66 | 0.14 | +0.65 | +3.09 | +0.97 | +1.06 | pass |
| 4 | 16.91..14.84 | 6 | 277 | 0.67 | 0.14 | 0.65 | 0.14 | +0.39 | +3.00 | +0.34 | +1.09 | pass |
| 5 | 14.21..14.32 | 6 | 280 | 0.68 | 0.14 | 0.65 | 0.15 | +0.45 | +2.80 | +0.66 | +0.89 | pass |
| 6 | 10.54..18.75 | 6 | 378 | 0.68 | 0.16 | 0.65 | 0.19 | +0.17 | +2.81 | +0.58 | +1.09 | pass |
| 7 | 18.93..13.20 | 6 | 719 | 0.67 | 0.19 | 0.67 | 0.17 | +0.56 | +3.12 | +0.84 | +1.12 | pass |
| 8 | 11.88..18.62 | 6 | 461 | 0.73 | 0.18 | 0.72 | 0.19 | +0.51 | +2.94 | +0.92 | +1.08 | pass |
| 9 | 18.31..17.23 | 6 | 343 | 0.63 | 0.17 | 0.66 | 0.13 | +0.51 | +2.97 | +0.88 | +0.68 | pass |
| 10 | 17.23..23.75 | 6 | 402 | 0.68 | 0.13 | 0.61 | 0.18 | +0.90 | +2.73 | +0.78 | +0.69 | pass |
| 11 | 23.75..23.79 | 6 | 458 | 0.65 | 0.18 | 0.64 | 0.18 | +0.90 | +2.87 | +0.87 | +1.33 | pass |
| 12 | 23.79..29.20 | 6 | 451 | 0.65 | 0.17 | 0.70 | 0.19 | +0.64 | +2.62 | +0.66 | +1.09 | pass |
| 13 | 24.28..16.52 | 6 | 422 | 0.66 | 0.18 | 0.79 | 0.18 | +0.61 | +2.78 | +0.63 | +0.50 | pass |
| 14 | 16.52..15.86 | 6 | 457 | 0.68 | 0.18 | 0.77 | 0.17 | +0.52 | +2.79 | +0.76 | +0.51 | pass |
| 15 | 15.86..13.52 | 6 | 315 | 0.67 | 0.13 | 0.62 | 0.15 | +0.16 | +3.09 | +0.82 | +1.03 | pass |
| 16 | 13.52..17.79 | 6 | 340 | 0.70 | 0.17 | 0.74 | 0.14 | +0.19 | +2.58 | +0.56 | +1.00 | pass |
| 17 | 16.32..27.64 | 6 | 477 | 0.64 | 0.14 | 0.69 | 0.18 | +0.19 | +2.87 | +0.70 | +1.11 | pass |
| 18 | 27.64..22.67 | 6 | 450 | 0.68 | 0.19 | 0.68 | 0.15 | +0.46 | +2.80 | +0.82 | +1.28 | pass |
| 19 | 22.67..30.99 | 6 | 581 | 0.65 | 0.19 | 0.61 | 0.17 | +0.42 | +3.04 | +0.72 | +1.10 | pass |
| 20 | 30.99..18.64 | 6 | 468 | 0.66 | 0.14 | 0.74 | 0.19 | +0.47 | +2.99 | +0.78 | +1.07 | pass |
| 21 | 18.40..9.43 | 0 | 293 | 0.66 | 0.13 | 0.66 | 0.12 | +0.82 | +3.10 | +0.75 | +0.97 | pass |
| 22 | 9.43..8.66 | 0 | 364 | 0.66 | 0.12 | 0.67 | 0.12 | +0.54 | +3.06 | +0.50 | +1.14 | pass |
| 23 | 8.66..10.35 | 0 | 325 | 0.75 | 0.12 | 0.66 | 0.11 | +0.87 | +3.04 | +0.78 | +0.95 | pass |
| 24 | 10.35..9.20 | 0 | 279 | 0.69 | 0.17 | 0.67 | 0.12 | +0.39 | +2.86 | +0.75 | +1.07 | pass |
| 25 | 9.20..9.96 | 0 | 214 | 0.67 | 0.12 | 0.66 | 0.11 | +0.47 | +2.95 | +0.72 | +1.02 | pass |
| 26 | 9.32..8.24 | 0 | 268 | 0.66 | 0.12 | 0.59 | 0.12 | +0.44 | +3.10 | +0.70 | +1.01 | pass |
| 27 | 8.24..9.11 | 0 | 213 | 0.67 | 0.11 | 0.66 | 0.11 | +0.60 | +2.88 | +0.69 | +1.12 | pass |
| 28 | 9.11..13.06 | 0 | 295 | 0.69 | 0.13 | 0.67 | 0.12 | +0.42 | +3.02 | +0.71 | +1.03 | pass |
| 29 | 13.06..13.26 | 0 | 233 | 0.66 | 0.12 | 0.67 | 0.12 | +0.38 | +2.92 | +0.71 | +0.96 | pass |
| 30 | 13.26..9.00 | 0 | 275 | 0.66 | 0.14 | 0.62 | 0.12 | +0.63 | +2.73 | +0.82 | +1.27 | pass |

## 10. Time (condition 3)

The repaired quotes/deny linearity row, before the gate (§9), under ambient load plus 6 spinners (load 13 to 49): at jq 1.7.1 the case took a median of 266 s, at most 416 s (timeout 600 s); at jq 1.8.1 it took a median of 293 s, at most 415 s (timeout 600 s). The same row with two rounds took about 100 to 200 s on this box.

Each case of the block after the gate (all thirty runs), its own time against its timeout:

```text
the cost baseline is the hook's forbidden program at 06aed21ff7, held by its hash, and median    0.0 s, max    0.0 s
quotes: deny stays within the startup-adjusted 06aed21ff bound at 64 KB                median   54.2 s, max  124.5 s of 300 s
quotes: deny linearity from 32 to 64 KB stays within the inherited-cost bound          median  185.2 s, max  440.0 s of 600 s
quotes: class stays within the startup-adjusted 06aed21ff bound at 64 KB               median    0.2 s, max    0.5 s of 300 s
quotes: class linearity from 64 to 128 KB stays within the inherited-cost bound        median  101.2 s, max  227.1 s of 300 s
dqsub: deny stays within the startup-adjusted 06aed21ff bound at 64 KB                 median    0.8 s, max    1.4 s of 300 s
dqsub: deny linearity from 64 to 128 KB stays within the inherited-cost bound          median    3.9 s, max    7.4 s of 300 s
dqsub: class stays within the startup-adjusted 06aed21ff bound at 64 KB                median    0.2 s, max    0.5 s of 300 s
dqsub: class linearity from 64 to 128 KB stays within the inherited-cost bound         median    0.9 s, max    2.3 s of 300 s
```

After the gate, the row nearest its timeout is quotes/class linearity, which four rounds doubled too: at most 227 s of its 300 s under load here (0.76), about 90 s hosted (0.30 in the full run at the first head). The quotes/deny linearity row took at most 440 s of its 600 s here (0.73) and 168 s hosted (0.28). Under load both pass two thirds of their timeouts on this box; the coordinator allowed it as measured, and the timeouts are unchanged. Hosted, every row stays under a third of its timeout.

## 11. Left for the owner

- The cost suite's factor and floors are the hook owner's; this wave changed the deny rows' baseline and the class rows'
  floor only as it ruled.
- The class rows were moved to the new baseline with the 250 ms floor, as the owner allowed only if their worst loaded reading stayed under half of the bound: quotes/class worst 0.19, dqsub/class worst 0.19. The hosted run reads them too. The floor's value is a chosen allowance (review 4009: the condition holds for any class path under about 250 ms, and 100 to 150 ms would meet it too); the coordinator has put the value to the hook owner, and the floor is one constant, `COST_FLOOR_MS.class`.
- A mechanical gate on refreshing either vendored baseline (review 4009 F6): today the fixture, its hash and the
  hook's program can change together in one diff with every case green. What holds the baseline is words, the test's
  comment and D-9141's last sentence. Left for the owner's ticket, not this wave.
