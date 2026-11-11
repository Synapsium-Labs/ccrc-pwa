# tick-refused-lanes quiets its watcher

## Goal

A merge-group shard (server 5/12) failed with every test passing: vitest reported `EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending`, from `server/test/tick-refused-lanes.test.ts`. The file's rig builds a `FleetWatcher` and primes it with one `tick()`, which fires writers it never awaits (the server-caps beat, the inventory run, a delegation pass whose compaction line is the most common late writer). The file was exempt from the watcher-quiet census (D-8140) as measured quiet on 2026-11-09, so nothing stopped one of those writers from logging after the file's last test. The fix is the D-8140 pattern `hibernate-sweep.test.ts` uses.

## What was read first

- `server/test/laneQuiet.ts` (`quietAtTestEnd`, `quietWatcher`), `server/test/watcherTeardown.ts` and `server/test/watcher-quiet-census.test.ts`, the D-8140 remedy and its ratchet.
- `server/test/hibernate-sweep.test.ts`, which wraps its watcher in `quietAtTestEnd`.
- `server/test/tick-refused-lanes.test.ts`: one builder, `rig()`, called inside every case, so `quietAtTestEnd` registers on the case that built it.

## Deviations found

- **D-8269 (2026-11-11)** — tick-refused-lanes quiets its watcher: the rig's watcher is wrapped in `quietAtTestEnd`, so the priming tick's writers settle (and the delegation lane closes) inside the case; the file leaves the census's `EXEMPT` list and `EXEMPT_CEILING` falls from 103 to 102. The rig's io also answers the disk read as unmeasured: `localIO.statfsMeasured` measures the real home's filesystem, and on a host over the disk alarm's warn line the priming tick's disk pass put a `disk` push in `sent`, failing six cases that assert no push (seen on a developer machine at 90% full; CI's runners sit below the line, so the merge group never saw it).

## Tasks

- [x] T1. Test first, red: remove `tick-refused-lanes.test.ts` from the census's `EXEMPT` and lower `EXEMPT_CEILING` to 102; the census names the file as a builder that quiets nothing.
- [x] T2. Wrap the rig's watcher in `quietAtTestEnd` and stub the rig io's `statfsMeasured`; the census and the file pass.
- [x] T3. The file run 25 times in a row: 25 green, no teardown error, no log attributed to the file after its last case. Before the change one run wrote 5 delegation compaction lines from watchers nothing awaited; after it, none.
