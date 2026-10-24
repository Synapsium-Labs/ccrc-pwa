# CI throughput: merge as fast as PRs arrive, with no loss of safety

Operator ruling 2026-10-24. Measured over about 7 hours of ccrc-pwa CI (2026-10-23 23:57Z to 2026-10-24 06:46Z):
- **Queue throughput:** the merge queue tested 3.9 groups an hour but landed 1.9 merges an hour. 11 of its 12 failures were flakes, 10 of them the trickle case that #1256 fixed.
- **Critical path:** every group's critical path is its slowest server shard, about 12 min, held by one of five test files of 412–661 s, each alone on a shard.
- **Next ceiling:** `test (pwa)` runs unsharded at about 11 min.
- **Runner contention:** at peak, 83 Linux jobs competed for a 60-job cap.
- **Trace refresh:** the per-push refresh holds 8–15 of those slots for 25–60 min and gates nothing.

Each change keeps every test and every required check. None of them narrows test selection.

## Deviations found

The ledger issued D-6767 to D-6771 for this work, one number per change.

- **D-6767** — `ci-split-giant-test-files`: these five server test files are each split by `describe` block into files of at most about 4 min, sharing their fixtures through a helper module. The five are `ccrc-doctor`, `ccd-tick-diet-equivalence-utf8`, `ccd-tick-diet-equivalence`, `ccrc-install` and `ccrc-update`. Every test keeps its title and body, and the case count across a family is unchanged. Two reasons: one file runs on one worker, so the planner's 2-worker division left a worker idle on each giant's shard; and the giants timed out under trace, so test selection marked them unknown and picked all five on every run.
- **D-6768** — `ci-shard-pwa-tests`: `test (pwa)` runs as N shards packed by measured duration, behind one aggregate job that keeps the name `test (pwa)`. That job is the required check. It fails when any shard fails, is cancelled or is skipped.
- **D-6769** — `ci-trace-refresh-coalesced`: the test-map trace refresh no longer runs on every push to main. It runs on a schedule, and each run covers every merge since the last one. A map build that reports news writes a summary and does not fail its job. This is safe because selection diffs from the map's sha: a staler map only selects more tests.
- **D-6770** — `ci-deps-once-per-run`: each CI run installs its dependencies once, keyed only on the lockfile hashes and the runner image, and hands the installed trees to its jobs instead of each job running `npm ci`. The duplicate `pwa` typecheck between `test (pwa)` and `build-pwa` runs once. The installed tree is the one `npm ci` gives for that lockfile; nothing is keyed on a branch.
- **D-6771** — `ci-node-floor-gated-on-inputs`: on `pull_request`, `node floor` runs only when its inputs change: the package manifests and lockfiles, `.nvmrc` and the `engines` fields, `ccd/history/**`, and the tests and config it runs. It still runs on every `merge_group` and on the daily schedule, so every merge is checked against the floor.
