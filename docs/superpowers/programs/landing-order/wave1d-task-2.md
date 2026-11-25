# Wave 1d, Task 2: a superseded queue group's jobs end when they start (D-9015)

Run 3739, plan `docs/superpowers/plans/2026-11-25-landing-order-wave1d-queue-ci.md`.

## What was built

- `.github/ci/queue-live.mjs`: `queueGroupFate` and `compareWord`, pure, to the plan's interface; and the script's
  main, which reads the queue branch with `git ls-remote --exit-code` and, only when the branch is absent, asks one
  compare call through `gh`. Each child process has a 30-second deadline. It prints
  `queue-live: <fate> (branch <word>, on main <word>)` (`not read` when the branch was not absent) and exits 1 only on
  `superseded`. It imports `node:child_process` and `node:process` only; the entry check uses the global `URL`.
- `server/test/queue-live.test.ts`: the plan's table and compare cases; five end-to-end cases on a fixture bare
  repository served as a `file://` URL, with a stub `gh` first on `PATH` that records that it ran (`live`, where the
  stub never runs; `landed`; `superseded`; `unmeasured` when the compare fails; `unmeasured` when the remote cannot be
  read); and the workflow case, which parses `ci.yml` and requires the step whole and first in each of the eleven
  jobs, once, and in no other job.
- `.github/workflows/ci.yml`: the step `queue group still live`, first in `deps`, `server-shard`, `server-typecheck`,
  `server-perf`, `mask-perf`, `test`, `pwa-shard`, `pwa-static`, `build-pwa`, `browser-pwa` and `node-floor`.

## Departure: the step's condition in a job with a leg switch (`queue-live-leg-gate`, D-TBD)

The plan gave one condition, `github.event_name == 'merge_group'`. In the six jobs that carry a `CCRC_LEG` switch
(`test`, `pwa-shard`, `pwa-static`, `build-pwa`, `browser-pwa`, `node-floor`) the step's condition is
`env.CCRC_LEG == 'run' && github.event_name == 'merge_group'`, the shape the queue's reach asks already use. Why: the
pipeline pins hold that every step of those jobs skips when the leg skips (a refresh, a rebuild, and for the node
floor a docs-only queue group), and with the plan's condition the step would run in a docs-only group's node floor,
whose every other step skips. The narrower condition changes nothing in a live group: under `merge_group` the leg is
`run` except in that docs-only node floor. The other five jobs carry the plan's condition.

## The pins that moved

- `ci-pipeline.test.ts`: its one `steps()` helper sets the liveness step aside (`withoutQueueLive`), so the pins that
  index a job's steps from its checkout, count them, or simulate which run read the job as before; and `build-pwa`'s
  whole-block `GH_TOKEN` count reads the block without that step. `queue-live.test.ts` pins the step whole instead.
  Applied by packet, approved by `ci.yml`'s holder.
- `ci-merge-queue.test.ts` (claim 7056): the required closure may not name `merge_group`, because a required leg
  skipped by `if:` reads as passing. It now admits the liveness step whole (its body can only end a job with exit 1)
  and the server shards' `QUEUE_BASE` env line (Task 3), counts each (the step once in each of the nine long jobs in
  the required closure, the env line once), and counts the browser and agent asks over the job without the step,
  whose `if:` is the same line as theirs.

## The first queue run of this pull request

The step fetches the script from the default branch. Until this wave lands, that fetch answers 404, so every long job
of this pull request's own queue run prints `queue-live: unmeasured (the script could not be fetched)` and runs on:
the fail-open arm. After it lands, a live group's jobs print `queue-live: live (branch present, on main not read)`.

## Residual

A job already running when its group is superseded runs to its end: the step cancels nothing and adds no permission.
