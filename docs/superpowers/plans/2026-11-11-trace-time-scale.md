# Traced server tests get a scaled clock

- **D-8277 (2026-11-11)** — the dependency map's traced runs scale every server test time budget: trace-run sets `CCRC_TIME_SCALE=10` (`TRACE_TIME_SCALE`), `server/test/timeScale.ts` reads it (1 when unset), `server/vitest.config.ts` multiplies `testTimeout`/`hookTimeout` by it, and the files that failed under trace wrap their explicit budgets in `scaled()`; a failed traced run's output tail is printed to the job log.

## Why

The testmap trace job (`.github/workflows/ci.yml` `trace-shard`, `.github/ci/trace-run.mjs`) records a traced file
that exits non-zero as `unknown` (`vitest exited 1`, `FAILED_UNDER_TRACE` in `.github/ci/testmap.mjs`). An unknown
file has no dependencies in the map, so rule 2 selects it on every change. The map built by scheduled run
42952024822 (artifact `testmap`, sha `f3091a74`) holds 38 unknown records. Thirty-five say `vitest exited 1`. Among
them are the files this plan covers:

- `ccd-tick-diet-equivalence-route` and the three `-utf8-` parts (the C-locale `-limits` and `-registry` too)
- `ccrc-doctor-testbox`, and `ccrc-doctor-fleet` (in that map it is `timeout after 1560s`)
- the seven `ccrc-install-*` parts
- `ccrc-update-fetch`, `-flip-backups`, `-kept` and `-phases`

All of them pass untraced. trace-run ran each one with `stdio: 'ignore'`, so CI never saw why it failed.

## The cause, from the untraced times

Tracing costs 1.7 to 4.3 times wall-clock (ci.yml's trace-shard header), and more for these files: every one shells
out to bash, and `strace -f` follows every fork. On Linux the suite's default budget is 20 s a case and 20 s a hook.
The untraced per-case times below come from vitest's default reporter in merge-group runs 42930098552 and 42968705406.
The last column counts the cases at or over 4.65 s, which pass 20 s at a 4.3x slowdown.

| file | untraced file time | slowest case untraced | cases ≥ 4.65 s |
|---|---|---|---|
| ccrc-install-codex | 192 s | 19.2 s | 16 |
| ccrc-install-graphify | 257 s | 10.1 s | 38 |
| ccrc-install-landing | 126 s | 10.8 s | 4 |
| ccrc-install-role | 88 s | 13.2 s | 10 |
| ccrc-install-tree | 176 s | 12.8 s | 13 |
| ccrc-install-units | 146 s | 11.5 s | 21 |
| ccrc-install-versioned | 138 s | 10.6 s | 19 |
| ccrc-update-fetch | 105 s | 7.3 s | 7 |
| ccrc-update-flip-backups | 279 s | 24.3 s | 11 |
| ccrc-update-kept | 209 s | 20.1 s | 10 |
| ccrc-update-phases | 165 s | 19.9 s | 7 |
| ccrc-doctor-testbox | 25 s | 4.8 s | 1 |
| ccrc-doctor-fleet | 386 s | 6.8 s | 2 |

The tick-diet parts do their work in `beforeAll` hooks, and the reporter does not time hooks. A `runBatch` call
there is bounded by `perl alarm`: 120 s by default, and 300, 600 or 900 s per block. The route part ran 600 s
untraced against its 900 s bound, so any slowdown over 1.5x kills it. The utf8 limits part ran 282 s with two 300 s
batches. The utf8 registry part ran 60 s against 120 s bounds. In every one of these files, the budget runs out
under trace. The tests themselves are not wrong.

## Change

- `server/test/timeScale.ts` holds the one scale. `CCRC_TIME_SCALE` unset or empty reads as 1. A number at or
  above 1 is the scale. Anything else throws, so a misread can neither shorten a budget nor fall back to 1
  silently. `scaled(ms)` and `scaledSeconds(s)` round up.
- `trace-run.mjs`'s `tracedEnv` adds `CCRC_TIME_SCALE: '10'` (`TRACE_TIME_SCALE`). The scale is set well above the
  measured cost on purpose. A budget only bounds a hang. The per-file `--timeout 1560` still bounds the whole
  file. And a traced run's pass or fail is not a verdict. The variable is not `CCRC_TRACING`, so no file joins
  `SKIPS_UNDER_TRACE`: a file that reads the scale skips no cases, and its record stays complete.
- `server/vitest.config.ts` scales `testTimeout` and `hookTimeout`. The listed files and their fixtures
  (`ccdTickDietRunner.ts`, `ccrc-doctorFixture.ts`, `ccrc-installFixture.ts`, `ccrc-updateFixture.ts`) wrap each of
  these budgets in `scaled()`:
  - explicit case and hook timeouts
  - `spawnSync` `timeout`s and the `runBounded`/`perl alarm` bounds
  - wait-loop deadlines
  - upper bounds on how long a run took
  - the UTF-8 locale probe's 15 s
  
  The trickle case in `ccrc-update-fetch` divides its bytes-per-second floor by the scale, because its elapsed
  time is the whole run's. Lower bounds stay as written (a fetch must not end before its 2 s bound), and so do
  bounds a case sets on purpose (`E2c`'s 5 s hang). No assertion is removed.
- `ccrc-install-tree`'s text pin on the whole-spine cases' closing lines now reads `}, scaled(60_000));`. It reds
  on an unscaled literal bound as well as on a missing one.
- `trace-run.mjs` writes each traced run's stdout and stderr to a file in its work directory. A file has no
  reader to wait on, so the no-hang reason for `stdio: 'ignore'` still holds. When the run failed or timed out,
  the last 60 lines go to the job log, inside a `::group::` and between `::stop-commands::` markers with a
  one-off token, so a `::error` that vitest's github-actions reporter printed stays text. Records are unchanged.

## Verify

From `server/`:

- `npx vitest run test/time-scale.test.ts test/ci-trace-run.test.ts`, plus the listed files and the census, ratchet,
  single-definition and rings suites
- `npx tsc --noEmit -p .`, and `npx tsc --noEmit -p test/tsconfig.tests.json`

strace does not run on macOS, so the traced half is proven after the merge. The next scheduled refresh that
re-traces these files must record them clean, or print each failure's own last lines in the trace job's log.

## Deviations found

- **Two files can still hit the per-file deadline, which this change does not scale.** `ccd-tick-diet-equivalence-route`
  (600 s untraced) passes the 1560 s `--timeout` only below a 2.6x slowdown. `ccrc-doctor-fleet` (322 to 386 s)
  passes it only below about 4x. A file that runs over is recorded `timeout after 1560s`, a different unknown,
  with its output tail in the log. The fix for those two is a split by `describe`, as D-6767 did for their parents.
  The trace plan's per-shard budget is ci.yml's to change, not this plan's.
- **The causes above are read from untraced times, not from traced output.** CI had no traced output to read until
  this change. If the first refresh after it shows another cause (a product deadline inside bash that strace
  slows, which no test budget reaches), the log will name it.
- **The scale is applied to the listed files only.** Other files that fail under trace (session-hook,
  docs-parity, single-definition/docs-l0 and others) get the config's scaled defaults, but their explicit budgets
  are untouched until their own output says what fails.
