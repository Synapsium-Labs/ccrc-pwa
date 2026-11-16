# CI: main's map-build red on single-definition under trace

**One task.** CI hygiene only: no ccrc behaviour changes.

## Problem

`main`'s post-merge `map-build` job failed on 11 of the 12 main CI runs that completed on 2026-10-20. On the last one
(head `1128d3ab6`), `testmap.mjs` exited 3 with one new failure: `server/test/single-definition.test.ts newly fails
under trace (vitest exited 1)`. Ten other files were still failing under trace, but because they were already
`unknown` in the base map they were only reported as warnings. Exit 3 means a traced test failed now and was not
`unknown` in the map the refresh started from (spec 2026-09-23 §5.4): either a semantic merge conflict, or a test that
tracing has newly perturbed. The file passes in the normal suite.

## Measured cause

- `trace-run.mjs` runs each file with `stdio: 'ignore'`, so CI records only "vitest exited 1". single-definition is
  byte-identical between the run where it traced clean (`b37cc30f0`) and the run where it failed (`1128d3ab6`), which
  only touched `citations.test.ts` and a plan. The failure is therefore environmental, not a ratchet that depends on
  git or `origin/main`. It does not read the merge-base, `CI` or `CCRC_TRACING`.
- In CI's own untraced Linux run (artifact `times-5` of run 39463359525), one case, `literal source pins over W1a's
  files may only shrink (D-5854)`, takes **9.9 s**. Every other case in the file takes at most 1.2 s. Linux's
  `testTimeout` is 20 s, and strace costs 1.7-4.3x (the trace shard's own header). With two traced vitest processes
  sharing a runner, that case lands on either side of 20 s. This explains single-definition only. It does not explain
  why other files have also newly failed under trace on main: two of them (citations, secret-mask) have no case near
  the budget (see the follow-ups).
- The case's time goes into `literalSourcePinCounts`, which parses every one of the 981 `server/test/*.ts` files with
  the TypeScript parser. Only 167 of them spell a W1a file's basename, and only those can hold a pin.
- Reproduced on Linux under the exact strace argv `trace-run.mjs` uses, with the container throttled to 0.5 CPU to
  approximate the runner's slower, shared cores. This machine's cores measured about 1.5x faster than CI's:
  6.5 s untraced here against 9.9 s there.

## Change

`literalSourcePins` returns `[]` without parsing when the text spells no W1a basename (D-6111). This is exact, not an
approximation: every target it counts comes from `namesW1aFile` over a substring of that same text, and
`namesW1aFile` answers nothing unless the substring spells a W1a basename. The scan is memoised and shared, and a
guard case asserts that it parses fewer than a third of the files it lists. The ratchet's ceilings, its corpus
(tracked plus untracked-not-ignored) and its counting rule are unchanged.

## Red evidence

| run | where | ratchet case |
|---|---|---|
| CI 39462019199 (head `1128d3ab6`), trace 7/8 | ubuntu-latest, under strace, 2 jobs | `vitest exited 1`, so `map-build` exits 3 |
| `origin/main` `afd71583d`, traced, 0.5 CPU | Linux container | **red**: `Error: Test timed out in 20000ms.` (20309 ms) |
| this branch, traced, 0.5 CPU | same container | green: the scan takes 7897 ms |
| this branch, traced, whole file, 4 CPU | same container | 809 of 809 pass |

Counts with and without the prefilter are identical: 981 files listed, 167 parsed against 981, and every W1a row
equal (watch 114, server 31, routes 40, childReclaim 6, endDeadCoordinator 5, the rest 0).

## Mutation table

These ran on a git-archive copy of the branch. Each mutant is caught by at least one case.

| mutant | D-6111 guard | CONTROL (fixture) | D-5854 ratchet |
|---|---|---|---|
| M0: the prefilter removed (parses 981) | **red** | green | green |
| M1: the prefilter skips every text | **red** | **red** | green |
| M2: the prefilter checks only the first W1a file | green | **red** | green |
| M3: a new untracked test file pins `watch.ts` with `indexOf` | green | green | **red** (115 > 114) |

## Verify

From `server/`: `vitest run test/single-definition.test.ts --maxWorkers=2`, plus the doc suites (deviation-refs,
dtbd, topology-clean, docs-grammar), `citations.test.ts`, `tsc --noEmit` and `typecheck-tests.test.ts`. Then run the file once under
`trace-run.mjs`'s strace argv on Linux. After the merge, the next `map-build` on main must no longer name
single-definition. **`map-build` is expected to keep going red after D-6111** whenever one of the other flaky files
below newly fails under trace: this task fixes single-definition's cause, not theirs.

## Follow-ups (measured, not fixed here)

- **The ten files that still fail under trace do not share Ubuntu 26 as a cause.** They were already failing under
  trace on 2026-10-18 (run 39177378398), before the `ubuntu-latest` migration began.
  - Four time out at 1560 s: ccrc-update, ccrc-install, ccrc-doctor and ccd-tick-diet-equivalence. All four spawn
    bash, which `strace -f` slows most. Raising their trace budget or putting them on `SKIPS_UNDER_TRACE` is a
    choice for whoever owns trace-run.
  - Six exit 1: ccrc-uninstall, ccrc-models-lock, ccrc-install-graphify, ccrc-codex, ccd-swap and boot. trace-run
    discards stdio, so their cause cannot be read from CI.
- **trace-run should keep the tail of a failed run's output** in the record's `why`, or as an artifact. Without it,
  every "newly fails" needs a local Linux replay like this one.
- **Other files have also flaked into exit 3 under trace on main** (runs 39454270698, 39445580416, 39437225576). By
  their slowest case in CI's untraced times (artifact of run 39463359525), they split in two:
  - (a) Timeout-shaped, slowest case about 4-8.5 s untraced: update-spawn, ccd-ws-audit, ccd-workspaces and
    session-hook-approval-wait (4.3 s). The same mechanism as single-definition can apply.
  - (b) Not a timeout, cause unknown: citations (slowest case 0.2 s) and secret-mask (0.7 s). boot's 3.1 s case is
    borderline. For citations, check the git and merge-base dependence of its added-lines rule under the trace
    checkout.
- **The traced budget does not scale.** `vitest.config.ts` keeps `testTimeout` and `hookTimeout` at 20 s on Linux even
  when trace-run sets `CCRC_TRACING=1`, although strace slows every case 1.7-4.3x. Every case that takes about 5 s or
  more untraced is a candidate for exit 3. Scaling the timeouts when `CCRC_TRACING=1` (or passing `--testTimeout` from
  trace-run) would cover group (a); trace-run's own 1560 s per-file timeout still bounds hangs, and the normal suite is
  unaffected.
- **The leak check on PR runs (D-3533)**: ccd-swap's swap-heartbeat cases leave a `sleep 20`, and ci-shards' nested
  `times` vitest shares the parent's test-run temp root, so it names the parent shard's processes. These are separate
  tasks.

## Deviations and decisions

- **D-6111 (2026-10-20)**: the D-5854 pin scan parses only the test files that spell a W1a basename, so the
  single-definition suite fits the 20 s Linux budget under the map's trace. The prefilter is exact: every pin target
  comes from `namesW1aFile` over the file's own text, which needs a basename. The counts are unchanged (measured equal
  over all 981 files), and a guard case keeps the scan from going back to parsing every file.

Issued and unused: none.
