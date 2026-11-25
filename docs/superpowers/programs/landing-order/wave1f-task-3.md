# Wave 1f, Task 3: the queue's own CI, its last guards (wave 1d)

Plan: `docs/superpowers/plans/2026-11-25-landing-order-wave1f-known-limits.md`, Task 3 (D-9067).

## What changed

- **The base's two unpinned links (review 3762 F1).**
  - `server/test/growth-check.test.ts`: the one-line wrapper `resolveBase` is gone; its call site is
    `const resolved = armedBase(process.env, ROOT);`, with the wrapper's comment above it. A new case in the
    stacked-entry `describe` reads the suite's own source and finds that line exactly once, as a whole line (so the
    needle inside the case does not count itself). A text pin, on purpose, and its comment says why: the line runs
    once at module load, from the real environment.
  - `server/test/ci-merge-queue.test.ts`: a new case reads `server-shard`'s steps (from one six-space `- ` line to
    the next, as `ci-pipeline.test.ts#steps` reads them) and requires exactly one step to hold `QUEUE_BASE_ENV_LINE`,
    that step's first line to be `- name: Test`, and its `run: |` script to run `./node_modules/.bin/vitest run `.
    Renamed, it reds on the name with "no longer the one named Test"; split so the env line and the vitest line sit in
    two steps, it reds on "does not run the server suite with vitest" (Review Focus 4).
  - Both cases were green at once, as the plan expected; rows 1F-05 and 1F-06 below are their proof.
- **The closure case's end (review 3762 F2).** `QUEUE_LIVE_STEP` now ends with `(?!(?:[ \t]*\n)* {10})`: after the
  script's last line, the next non-blank line is not a deeper script line. The plan asked for a lookahead for ten
  spaces; this one also skips blank lines first, because a YAML block scalar runs on across a blank line, so
  `<blank>` then a ten-space line is still part of the script. The hole was measured first: with a third script line
  (`echo "a third script line"`) in `server-shard`'s liveness step, `ci-merge-queue` stayed green, 7/7; anchored, the
  same mutation is red (1F-07).
- **A failed script is not a superseded group (review 3762 F7, D-9067).**
  - `.github/ci/queue-live.mjs` exports `SUPERSEDED_EXIT = 64` and exits with it on `superseded`, 0 on every other
    fate. Its header says so, and why 64.
  - The step's second script line, in all eleven jobs, is now exactly
    `node "$RUNNER_TEMP/queue-live.mjs" || { rc=$?; [ "$rc" -eq 64 ] && exit 1; echo "queue-live: unmeasured (the script failed, exit $rc)"; exit 0; }`
    (eleven occurrences replaced, measured before the replace). The job still ends with exit 1 on a superseded group.
  - `server/test/queue-live.test.ts`: the superseded case expects 64 (and `SUPERSEDED_EXIT` to be 64); two new
    end-to-end cases run the step's own `run:` text, read from the parsed workflow (job `deps`), under
    `bash --noprofile --norc -eo pipefail`, as a runner runs it, with a stub `gh` that serves a script for the
    fetch and a word for the compare: the real script on the superseded fixture ends with 1 and prints no
    "script failed" line; a script that throws at load ends with 0 and prints
    `queue-live: unmeasured (the script failed, exit 1)`. The whole-step pin's second line and `QUEUE_LIVE_RUN` in
    `ci-merge-queue.test.ts` follow the new line.
  - Red first: before the code, `queue-live` was red in three cases (the 64, the failed-script case, the whole-step
    pin) and `ci-merge-queue` in the closure case; the superseded-through-the-step case was green on the old step
    too, which is right (the old bare line also ended a superseded job with exit 1).
- **The deadline's comment and the README (review 3762 F3, F5).** Above `server-shard`'s `timeout-minutes: 45`, the
  comment now ends "The key and the 60-minute ceiling are pinned by server/test/oss-metadata.test.ts; nothing pins 45
  itself, which D-9014 allows." (re-wrapped at 77 columns; `oss-metadata` caps every job at 60). The README sentence
  now reads "A server shard's deadline is 45 minutes on every run, not 30"; the old line occurred once.

## Why 64 (Review Focus 3)

The codes Node documents for its own exits are 1 to 14 (an uncaught exception is 1, and 14 is a failed snapshot build:
this note said 1 to 13 until fix round 1's R2), and a process killed by a signal reads in the shell as 128 plus the
signal's number (129 and up); the step's shell gives 126 or 127 to a command it could not start. 64
is none of those, so only the script's own `process.exit(SUPERSEDED_EXIT)` reads as superseded. Measured with the new
step line under `bash --noprofile --norc -eo pipefail`:

| script | step's exit | printed |
|---|---|---|
| exits 64 | 1 | nothing more |
| exits 0 | 0 | nothing more |
| exits 1 | 0 | `queue-live: unmeasured (the script failed, exit 1)` |
| killed by SIGKILL | 0 | `queue-live: unmeasured (the script failed, exit 137)` |
| killed by SIGTERM | 0 | `queue-live: unmeasured (the script failed, exit 143)` |
| a syntax error | 0 | Node's error, then `queue-live: unmeasured (the script failed, exit 1)` |

## The two mixed orders (Review Focus 2)

The step's text comes from the group's own commit, and the script it runs is fetched from the default branch, so for
one landing the two can disagree.

- **An old step with the new script on `main`** (a group built before this wave lands, run after it): the old step
  runs the script bare. On `superseded` the script exits 64, which the old step's shell takes as a failed step, so
  the job ends exactly as it ended on 1 (measured: the old line with a script exiting 64 exits 64; with one exiting 0,
  0). A live or a landed group exits 0 there, as before.
- **The new step with the old script on `main`** (this wave's own queue group, whose step is new while `main` still
  serves wave 1d's script): the old script exits 1 on `superseded`, which the new step reads as a failed script, so it
  prints `queue-live: unmeasured (the script failed, exit 1)` and lets the job run (measured: exit 0). That costs a
  superseded group a runner for one landing and ends no live or landed job: on `live` and `landed` the old script
  exits 0 (measured: exit 0, nothing printed).

So this pull request's own queue run should print, in each long job's first step,
`queue-live: live (branch present, on main not read)`, and exit 0. If its group is superseded while its jobs still
start, it prints the superseded line and its notice, then `queue-live: unmeasured (the script failed, exit 1)`, and the
job runs on.

## Suites (each through `ccrc test`, one file per process, on the test box)

From `server/`: `queue-live` 10/10, `ci-merge-queue` 7/7, `ci-pipeline` 132/132, `oss-metadata` 29/29,
`workflow-yaml-parses` 23/23, `growth-caps` 12/12, and `growth-check` armed (`env GROWTH_CHECK=1`, after
`git fetch origin main`) 100/100 with none skipped (unarmed it reads 63 passed, 3 skipped). The growth check's own
files are touched (`growth-check.test.ts` is in `GROWTH_MACHINERY`), so no exemption applies to this pull request; the
armed run is green without one.

## Mutation rows

Each: the target saved, its sha256 taken, the mutation applied, the suite run (red), the saved copy restored and its
sha256 checked, the suite run again (green). Command: `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2
test/<suite>.test.ts` from `server/`.

| Row | Mutation | Red assertion | sha256 restored | Green after |
|---|---|---|---|---|
| 1F-05 | `const resolved = armedBase(process.env, ROOT);` becomes `const resolved = { base: gitRead(['merge-base', 'HEAD', 'origin/main'], ROOT).trim(), from: 'merge-base' as const };` | `growth-check`, the text-pin case: `growth-check.test.ts resolves its base once, through armedBase: expected [] to have a length of 1`, 1 failed of 100 | `71ba6416…1c94d`, matched | 63 passed, 3 skipped |
| 1F-06 | the `QUEUE_BASE` env line moves from the `Test` step to the `server-deps` step before it (under a new `env:`) | `ci-merge-queue`, the placement case: `the step that carries the queue base is no longer the one named Test`, 1 failed of 7 | `5672aa81…bc6c8` (the workflow before Task 3 Step 3), matched | 7/7 |
| 1F-07 | a third script line, `echo "a third script line"`, after `server-shard`'s liveness step's last line | `ci-merge-queue`, the closure case: `` `server-shard` mentions merge_group ``, 1 failed of 7 (before the anchor: 7/7 green) | `5672aa81…bc6c8`, matched | 7/7 |
| 1F-08 | the script exits 1 on `superseded` again | `queue-live`: the superseded case `expected 1 to be 64`, and the case through the step's lines (`not to contain 'the script failed'`), 2 failed of 10 | `3c968154…4c753`, matched | 10/10 |
| 1F-09 | the step's line, in all eleven jobs, loses its `\|\|` arm and is the bare `node` line again | `queue-live`: the whole-step pin, the failed-script case (`expected '' to contain 'queue-live: unmeasured (the script fa…'`), and the superseded case through the step's lines (`expected 64 to be 1`), 3 failed of 10 | `0d2fdd1b…05094`, matched | 10/10 |

## What differed from the plan

- The closure anchor skips blank lines before it looks for a deeper line (above, and why).
- `queue-live.test.ts`'s header names this note beside wave 1d's mutation table.
- The step's comment in the eleven jobs ("any read that fails lets the job run") is not edited: it stays true, and
  editing eleven copies was not asked for.
