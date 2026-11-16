# The prune deny's cost cases measure CPU, not wall time

- **D-8334 (2026-11-11)** — `session-hook-prune-deny.test.ts`'s cost cases read each jq run's own CPU time (user plus system, from bash's `times` for the child it waited on) instead of its wall time; one invocation, startup included, the faster of two interleaved measurements, and the FD8 bounds unchanged. Mirror issue #2445.

## Why

A merge-group run ejected an unrelated pull request on "quotes: deny linearity from 32 to 64 KB stays within the
inherited-cost bound":

`quotes/deny: original 3.54x, current 4.18x, bound 4.04x; ms 3125, 2163, 11052, 9046`

The current program was faster than the original at both sizes. The ratio tripped only because the small run was
relatively quicker on a loaded shard. Wall time counts the time a process waits for a CPU, and on a shared runner that
wait swings by seconds between two runs a minute apart. Every ejection costs a full queue re-run.

## What was measured

The same four runs (original and current, at 32 and 64 KB), on one development machine, wall time beside the child CPU
time `times` reports, three rounds each:

| condition | wall-time ratios (original, current) | CPU-time ratios (original, current) |
|---|---|---|
| idle | 3.80 / 3.83, 3.85 / 3.77, 3.79 / 3.84 | 3.81 / 3.84, 3.85 / 3.78, 3.79 / 3.84 |
| 24 busy loops oversubscribing the CPUs | 5.30 / 4.46, 3.76 / 5.15, 3.41 / 3.36 | 4.00 / 3.77, 3.98 / 3.85, 3.99 / 3.91 |

Under load the wall-time ratio ranged from 3.36x to 5.30x. The CPU-time ratio stayed between 3.77x and 4.00x, which is
inside the ruled 0.5 margin.

## Change

- `childCpu(argv, input)` in the test file runs one command under `bash -c '"$@"; s=$?; times >&2; exit $s'` with
  `LC_ALL=C`. It returns the command's status, stdout and own stderr, and its CPU milliseconds from the last `times`
  line. Two cases pin it. A `sleep 0.5` reads under 100 ms while its wall time holds the wait. A computing jq reads its
  compute and passes its output and a failing status through.
- The cost cases (`… bound at 64 KB` and `… linearity …`) time each run with it. Everything else is unchanged: one
  invocation per mode, shape and size, jq startup included, the faster of two interleaved measurements, the `1.5x` or
  `+25 ms` cost bound, and the linearity bound of 2.5x or the original's ratio plus 0.5. So the FD8 ruling's shape
  holds (no amortized stream comparison). Only the clock changed.
- The cases' explicit budgets and the run bound go through `scaled()` (D-8277).

## Deviations found

- The ticket offered three ways out: the median of several runs, counting steps, or a margin proportional to the
  ratio. jq has no step counter. More rounds would add wall time to a file that already runs for minutes on a slow
  runner, and they would still read the queueing. A proportional margin changes a ruled bound. CPU time is the
  per-invocation work measure that leaves the ruled bounds as they were.
- CPU time still rises a little on a busy machine (shared caches, frequency): about 15% here at 24 busy loops. It
  rises for both programs alike, so the ratios hold.

## Stability

The whole file ran 24 times, in batches of four runs in parallel, beside 8 to 10 busy loops on a 14-core machine, so
every run competed for CPU. All 24 passed all 26 cases. The quotes/deny linearity reading ranged from 3.74x to 4.01x
against bounds of 4.29x to 4.52x.
