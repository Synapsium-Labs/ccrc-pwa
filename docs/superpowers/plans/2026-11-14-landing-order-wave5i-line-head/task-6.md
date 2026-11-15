# Task 6 note: compose the radar sweep, the binding read and the coordinator instruction

## What changed
- `server/src/watch.ts#sweepRadar`: the store inventory (`landingReadProjects`) joins the registry's projects in the one pass
  (`readRadarPass(..., controlsWanted)`); the generation check stays right after the await, then one synchronous
  `applyLandingControl` per project. `FleetWatcher.currentLandingControl(project)` is a defensive copy, `undefined` on a remote box
  whose agent link is down. A failed listing caches explicit unavailable evidence per wanted project; a failed inventory applies nothing.
  No watcher without a store reads control documents (old behaviour kept).
- `server/src/coord/landingReadView.ts` (new, L1, C4): `landingReadView` applies the pure `mainRedNext` to the persisted hold and the
  snapshot; the order's flags and the binding come from that one value. `routes.ts` only hands facts, snapshot and its own now.
- `ports.ts`: `applyLandingControl` added to `WatcherCoordMember`, sorted.
- Skill prose outside the canonical fence, README landing paragraph; `coordinator-skill.test.ts` LINE pin extended.

## Commands and outcomes
- Red: `radar-lane`, `landing-read-route`, `landing-control` failed (15 tests) before the source change.
- Green: same three files, 149 tests pass (the two fenced-store route cases timed out once under load, 25/25 alone).
- `coordinator-landing-verdict` + `coordinator-skill`: 1050 pass. `test/rings` + landing-next-mail + landing-line-order + landed-lane: pass.
- `test/single-definition`: 32 files, 1331 pass. Growth check armed: 73 pass (watch.ts +46/-12, routes.ts +7/-4 on this branch).
- Production `tsc --noEmit`: rc=0. `tsc -p test/tsconfig.tests.json`: rc=137, killed by the slice memory cap (known OOM); not measured.

## M23 (remove the radar generation check)
Mutant: replace `if (gen !== this.radarGen) return;` after the pass await. `radar-lane.test.ts` exit 1:
- `the radar lane composes the control bundle and the store apply > a superseded pass cannot apply or cache: only the newer pass speaks`:
  `AssertionError: the superseded pass cannot apply: expected [ 'proj-b', 'proj-b' ] to deeply equal [ 'proj-b' ]`
- also `an abandoned pass released after a newer one started never overwrites its map (4b F9 (4))`.
Restored from the saved copy; file green again.

## Departures
- `departure: new-l1-view-file`: the shared order-and-binding view lives in a new `coord/landingReadView.ts`, outside the brief's file list, so the route decides nothing and holds one hold value.
- `departure: shared-landing-line-untouched`: `shared/landingLine.ts` already carried `binding` (Task 3); no edit.

## Limitations
- The route's freshness uses the route's `Date.now()`; the snapshot itself is not re-aged, the decider rechecks each document's age.
- A registry project with no entry is also applied (a no-op unless health moves its hold).
