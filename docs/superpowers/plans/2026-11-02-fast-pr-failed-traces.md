# CI: the fast pull request judges a test that failed under the trace by what it recorded

**Why.** The CI share target (CI at most 10% of delivery time; operator ruling 2026-10-28). A fast pull-request run
averaged 98 runner-minutes over 2026-10-30 to 11-02, 79 of them in the server shards. This change narrows what the
fast run's server shards select, and nothing else. Number issued by the ledger on 2026-11-02.

- **D-7780 (2026-11-02)** — the fast run's untraced half judges a test that failed under the trace by its recorded reads, not always

## Measured

From the logs of eight fast runs of 2026-11-02 (each server shard's job log prints its `FILES`; the fast-plan job
prints its counts) and the 309 fast runs of 2026-10-30 to 11-02 replayed against the newest map and durations:

| part of the fast selection | files | file time | when |
| --- | --- | --- | --- |
| guard suites (censuses, single-definition, rings, pins, tree readers and scanners) | 195 | 795 s | every run |
| tests outside the guards that read `.git` (map rule 2), 13 of them also `unknown` | 22 | about 2,160 s | a run that changes a path vitest cannot follow |
| tests that FAILED under the trace and do not read `.git` (map rule 2, `unknown`) | 10, 9 outside the guards | about 1,880 s | the same runs |
| the rest of the map's untraced selection, and vitest's related tests | varies | varies | per change |

- Guards alone pack into 4 shards, about 9 runner-minutes (run 41488445818, an all-TypeScript change). They are the
  PR-time value of the fast run and stay as they are.
- 268 of the 309 fast runs (87%) changed a path vitest's import graph cannot follow: a doc, `CLAUDE.md`, a skill file,
  a PWA file, a JSON fixture. For each, select's `untraced` output carried every test whose map record is `unknown`,
  through rule 2 ("always"), whatever the path was.
- Ten of those records are `unknown` because the test failed under the trace (`vitest exited 1`, or `timeout after
  1560s`), not because the trace saw nothing: the five tick-diet equivalence suites (route, utf8-route, utf8-limits,
  rows, utf8-registry; about 1,730 s, two of them ten-minute shards of their own), `tmp-sweep-live`,
  `session-hook-approval-wait`, `ccrc-codex`, `linear-route` and the `census-w5/redactors` guard. Their records still
  hold what the trace saw them read: the tick-diet suites read `ccd/ccd`, `ccd/lib/*` and their agent, server and
  shared modules.
- An all-TypeScript change (the other 13%) already leaves these suites to the merge queue unless vitest relates them.

## The change

`untracedSelection` (`.github/ci/select.mjs`) asks `selectIgnoringUncertainty` with `unknownByRecord: true`. In
`selectAmong` (`.github/ci/select-tests.mjs`), a record that is `unknown` because it failed under the trace
(`FAILED_UNDER_TRACE` in `testmap.mjs`) and does not read `.git` is then judged by rules 3 to 6 over what it recorded
(read, probed, listed, linked subtree), as an uncertain record is on a pull request. Rule 2 still selects:

- every test that reads `.git` (the installer, updater and doctor suites copy the tracked tree, so any path can
  matter to them);
- every other `unknown`: the floor's `FLOOR_GIT` and `FLOOR_WALK`, a missing trace, cases skipped under the trace.

Only the fast run's `untraced` output changes. select's own selection (the fallback, and a full-run pull request),
the merge queue's and main's full runs, and the refresh's retrace still select every unknown record on every change.

## Why PR-time feedback for the moved suites is not needed

The merge queue runs the full suite on every pull request before it lands, so nothing lands unchecked. What the fast
run gives up is feedback on a change that the suite never recorded reading:

- **The tick-diet equivalence suites** compare the ccd tick's output, old against new, over fixtures. A change to
  `ccd/ccd` or a `ccd/lib` file they read still selects them (rule 3), and so does a TypeScript module they import
  (vitest). A doc, a PWA file or another test's fixture is none of their inputs. Two of the five timed out under the
  trace, so their records stop early, but all five read the same 87 paths: they share one fixture setup.
- **`tmp-sweep-live`** reads `ccd/ccd-tmp-sweep` and the ccd libraries; a change there still selects it.
- **`session-hook-approval-wait`** reads `ccd/session-hook.sh` and its installer; fast-plan.mjs also adds every
  `session-hook*` suite when `ccd/ccd`, `ccd/session-hook.sh` or `shared/api.ts` changes.
- **`ccrc-codex`** linked `deploy/` and `shared/` whole: a change under either still selects it (rule 6).
- **`linear-route`** is about a second; vitest relates it to its routes.
- **`census-w5/redactors`** is a guard suite and runs on every fast run regardless.

## Expected

Replayed with the shard planner (`planShards`, `PROFILES.linuxFast`) and a per-shard cost of the longer of its
longest file and half its file time, plus setup. The model gives 67 to 117 runner-minutes for the eight measured runs
against 66 to 123 measured.

| run | server shards before (measured) | before (model) | after (model) | longest shard before → after |
| --- | --- | --- | --- | --- |
| 41488445818 (TypeScript only) | 9 | 9.0 | 9.0 | 2.3 → 2.3 min |
| 41478505330 (two docs) | 76 | 71.3 | 49.7 | 10.7 → 6.5 min |
| 41473226821 (fixtures and a plan) | 73 | 71.4 | 49.8 | 10.7 → 6.5 min |
| 41458003408 (PWA) | 79 | 72.1 | 50.4 | 10.7 → 6.5 min |
| 41484413897 (a skill and docs) | 83 | 77.2 | 56.7 | 10.7 → 6.5 min |
| 41439847000 (one PWA module) | 66 | 67.4 | 45.2 | 10.7 → 5.5 min |
| 41424252769 (routes and a plan) | 84 | 81.5 | 60.6 | 10.7 → 6.0 min |
| 41445846560 (a large change) | 123 | 117.1 | 99.5 | 10.7 → 8.3 min |

Over the 309 runs the selection loses a mean of 1,466 s of file time (1,880 s median on the 268 runs it applies to):
about 21 server runner-minutes on such a run, about 18 on the average fast run. A fast run is then about 80
runner-minutes (from 98), its server shards about 61 (from 79), and the server leg's wall time about 6.5 minutes
(from about 10.7). The next daily rebuild, now in more trace shards (D-7748), may also turn some of these records
into real ones; this change does not depend on it.
