# The session hook's wall-clock budgets run on a quiet runner, and the required suite pins its fork count

**Size:** S. **Deploy class:** CI and server tests only (`.github/workflows/ci.yml`, `server/test/session-hook.test.ts`, `server/test/ci-pipeline.test.ts`); no `ccd/`, `agent/`, `pwa/` or wire change. One task.

## Problem

Three absolute p95 < 150 ms pins and the 4.2x and 1.5x ratio rows of `session-hook.test.ts` time a `spawnSync` of the hook with a clock. They ran in a server shard beside twelve workers of fork-heavy suites, and the old "p95" was the second-largest of twenty samples with no warm-up discarded, so two scheduler stalls failed it. It was the most frequent flake signature: 24 flaky jobs from 10-18 to 10-24, two of them queue ejections.

## Task 1: move the budgets to a perf job, pin the fork count (D-6929)

**Files:** `server/test/session-hook.test.ts`, `.github/workflows/ci.yml` (job `server-perf`, check name `perf (server)`), `server/test/ci-pipeline.test.ts`.

**Steps:** the budget rows run only under `CCRC_PERF=1`, each discarding one warm-up and taking 40 samples (p95 = `times[37]`), with the 150 ms, 4.2x and 1.5x thresholds unchanged. The `perf (server)` job sets it and runs only that file's budget rows, `--maxWorkers=1 --no-file-parallelism`, with the server shards' select gating. The required suite keeps a load-independent pin: the whole-run fork census of the cheap PostToolUse arm under strace, with a mutant copy that adds one subshell going red on it.

**Date rule (operator ruling 2026-10-25):** `perf (server)` starts NON-required. It becomes required on `merge_group` after two weeks with zero flakes, counted by the flaky-job method from the job's first green run on `main`.

**Verify:** `session-hook` (and, with `CCRC_PERF=1`, its budget rows), `ci-pipeline`, `oss-metadata`, `deviation-refs`, `single-definition`.

## Deviations found

- **D-6929** — `session-hook-perf-job`: the hook's wall-clock budget rows (three absolute 150 ms p95 pins, the 4.2x ratio and the 1.5x ratio) are gated on `CCRC_PERF=1` and run in the non-required `perf (server)` job, one worker, one warm-up discarded, n=40, p95 = `times[37]`, thresholds byte-identical. The required suite pins the cheap PostToolUse arm's fork census instead. The job becomes required on `merge_group` after two weeks with zero flakes (operator ruling 2026-10-25).
