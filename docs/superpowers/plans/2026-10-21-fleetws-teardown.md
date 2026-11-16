# fleetws removes its fixture home while the watcher is still writing into it

**Size:** S. **Deploy class:** `server/` (one new public method on `FleetWatcher`, no caller in production) plus test files; no `agent/`, `ccd/`, `pwa/` or wire change. One task.

## Problem

`server/test/fleetws.test.ts` failed in CI with `ENOTEMPTY: directory not empty, rmdir …/.ccrc`, raised by its `afterEach` `rmSync`. The case named most often was 'the coord frame › reports unmeasurable for BOTH markers when the registry cannot be listed' (the job attempts of #956's run on 2026-10-20, and #987's server shard 2 of 12 the same day). #1046 then made the server's `onClose` hook await an in-flight server-caps write, and gave the `afterEach` `maxRetries: 5, retryDelay: 50` for the cases that build a bare watcher with no server to close. The retry makes the race less likely to fail. It does not remove the race.

**Measured: which writes land after the teardown starts.** `tick()` fires three writers under `<ccrcDir>` and never awaits them. The measurement wrapped `node:fs/promises` to timestamp each write against the moment `app.close()` returned, and delayed only the tmp-file `writeFile` of one lane at a time:

1. **The server-caps beat** (`serverCapsNow`, `.server-caps.*.tmp`, then `server-caps`). In the 11 bare-watcher cases (`new FleetWatcher(deps, new Bus())`, no server), the write landed up to 147 ms after the teardown began, with a 150 ms delay. Nothing awaits it there, because no server close exists to run #1046's hook. In the server-backed cases, close does await it, and on today's `main` that covers the case CI named.
2. **The inventory run** (`dispatchInventorySweep`, the projection's `.update-intent.*.tmp`, then `update-intent`). It runs in the 6 cases that wire a coord store. With a 300 ms delay, the write landed 262 to 293 ms after `app.close()` returned, because close awaits only the server-caps write.
3. **The dispatch run that every inventory run ends in** (`runDispatch`). It writes the coord store, so SQLite creates and deletes journal files beside `coord.db` in the same directory. Nothing awaits this run either.

If any of these lands while `rmSync` is emptying `.ccrc`, the removal fails with `ENOTEMPTY`. If it lands after, it writes into a home the test has already removed. `FleetWatcher` had no way to await the second and third writers. `inventoryNow()` starts a run when none is in flight, so it cannot be used just to wait.

## Gate: none

#1046 (merged) carries the `onClose` hook and the retry this replaces. No open PR touches `fleetws.test.ts`. #1054's hunks in `watch.ts` (near line 3740) and `server.ts` (near line 3857) are line-disjoint from this change.

## Task 1: the teardown awaits the watcher's writers, then removes the home (D-6179)

**Files:** `server/src/watch.ts` (`FleetWatcher.settled()`, beside `serverCapsSettled()`), `server/test/watcherTeardown.ts` (new: the teardown), `server/test/watcherTeardown.test.ts` (new: its red cases), `server/test/fleetws.test.ts` (every watcher built through `mkWatcher`, and the `afterEach` through the teardown).

**Steps:**

1. Red: `watcherTeardown.test.ts` holds one writer behind a gate. It mocks `node:fs/promises`' `writeFile` for the two tmp-file names and `runDispatch` in `update/converge.ts`, so the test decides the race and the clock does not. Each case builds the watcher it needs, ticks it, and starts the teardown. It waits until the gate really holds a write, so no case can pass vacuously, then watches for 300 ms. It asserts that the teardown has not finished and the home still exists. It then releases the gate, lets every held write land, and asserts that the home is gone. There are four cases: a bare watcher's server-caps write; a server-backed watcher's inventory projection; the dispatch run that the inventory run ends in; and a dispatch run that starts only after the teardown is already waiting on the inventory run. With the teardown in its `origin/main` shape (close the server, then the retried `rmSync`), all four fail with `{ finished: true, homeExists: false }` while the write is held.
2. Fix, production: `FleetWatcher.settled()` resolves once `serverCapsRun`, `inventoryRun` and `dispatchRun` are all null. It awaits whatever is in flight with `Promise.allSettled` and looks again, because a run that settles can start the next one: the inventory tail starts a dispatch run, and a dispatch run can start its own follow-up. It never rejects, since each lane warns on its own. Nothing in production calls it. The `onClose` hook still awaits only the server-caps write, because making a production close wait out an inventory sweep or a dispatch run is a separate decision that this task does not take.
3. Fix, test: `watcherTeardown()` returns `track(watcher)` and `remove(home, app?)`. `remove` closes the server if there is one, then calls `stop()` on each tracked watcher and awaits its `settled()`, and only then runs `rmSync(home, { recursive: true, force: true })` with no retry. In `fleetws.test.ts`, all 28 constructions go through `mkWatcher` (`teardown.track(new FleetWatcher(…))`), and the `afterEach` calls `teardown.remove(home, app)`. The `maxRetries` comment and option are gone.
4. Nothing else changes. No case body or assertion in `fleetws.test.ts` moves, and the server's `onClose` hook is untouched.

**Mutation table** (each run against `watcherTeardown.test.ts`, on a `git archive` copy):

| # | Mutation | Result |
|---|---|---|
| H0 | the teardown in its `origin/main` shape: no settle, `rmSync` with `maxRetries: 5` | red: all 4 |
| M1 | `settled()` returns at once | red: all 4 |
| M2 | `settled()` leaves out `serverCapsRun` | red: the bare-watcher server-caps case |
| M3 | `settled()` leaves out `inventoryRun` | red: the inventory case and both dispatch cases |
| M4 | `settled()` leaves out `dispatchRun` | red: both dispatch cases |
| M5 | `settled()` takes one snapshot and does not loop | red: both dispatch cases |
| M6 | the teardown does not await `settled()` (`void`) | red: all 4 |
| M7 | the teardown does not call `stop()` | green: not pinned. No case in these files starts a watcher's interval, so `stop()` is a no-op here. It is kept so that a later case that calls `start()` cannot tick into a removed home. |
| M8 | the teardown removes the home before it settles the watchers | red: all 4 |

**Verify:** `cd server && ./node_modules/.bin/vitest run test/watcherTeardown.test.ts --maxWorkers=2` (4 pass), then `test/fleetws.test.ts` (54 pass, twice), `tsc --noEmit`, and the doc suites (`deviation-refs` after `git fetch origin main`, `dtbd`, `topology-clean`, `single-definition`, `docs-grammar`).

**Routing:** native. The fix is about ordering asynchronous lanes, which needs judgment rather than a literal edit.

**Needs:** nothing. **Gates:** none.

## Deviations and decisions

### Issued for this work and defined here

- **D-6179** — `watcher-teardown-settles`: a test that removes a fixture home must first await every write that its `FleetWatcher`s still have in flight. `tick()` fires the server-caps beat, the inventory run and the dispatch run without awaiting them, and each one writes under `<ccrcDir>`. A server's close awaits only the first, and a bare watcher has no close at all. `FleetWatcher.settled()` resolves once none of the three is in flight, and loops, because one run can start the next. `server/test/watcherTeardown.ts` closes the server, stops and settles each tracked watcher, and only then removes the home, with no retry. `fleetws.test.ts` builds every watcher through it. `watcherTeardown.test.ts` pins the order by holding each writer behind a gate.

### Issued and unused

None.
