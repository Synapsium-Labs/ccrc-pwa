# Task 7 note: ownership proofs, the mutation matrix and the departure list (wave 5i)

## What changed (tests only; no source file)
- `server/test/landing-entry-census.test.ts`: `assertLandingCallerBindings(text, file)` replaces the fixed 400-character windows. It
  takes the one `advanceLanding` call inside the caller symbol the file names (`advanceAct`, `landedPass`, `landOnClose`), reads its
  argument as a whole AST node, and holds it to the caller's shape: a run arm (object literal with `runId`, no `kind`, no spread, no
  cast), a land object (`kind: 'land'` and `expect`, no spread, no cast), or an identifier whose innermost lexical binding is a
  `const` initialised by `closeLandingOf(...)` through parentheses, `satisfies`, a non-null and immutable const aliases. It refuses a
  parameter shadow, `let`, a reassignment, a second declaration, a cast, and a computed or unresolved argument. New describe: one
  statement writes `mainRedHold` (the UPSERT in `landingControlTx.ts`, no `operatorPaused` in its SET, the only write of
  `landing_projects`), `applyLandingControlTx` has one caller inside `CoordStore.applyLandingControl`'s `tx`, the terminal repair
  verdict is read inside the land arm before the one state/detail UPDATE, `terminalRepairTokens` is called once (in
  `landingFactsInner`) and `advanceLanding` still has three callers, and `landingNext.ts`, `landingReadView.ts`, `landed.ts`,
  `landingLine.ts` read no clock or filesystem, import no node builtin, reach no store and take exactly the value imports listed
  (`landingLine.ts` takes only `freshWithin` and `RADAR_PROBE_FRESH_S` from `shared/api.js`). `Date.parse` of a given string is not a
  clock read (`landed.ts#landedNoticeModeOf`), and the scan says so.
- `server/test/coord-policy-rings.test.ts`: `landingNext.ts`, `landingReadView.ts`, `landingControlTx.ts` have no runtime path to `node:sqlite`.
- `server/test/rings/watcher-store-port.test.ts`: `applyLandingControl` is reached and in the port; reach equals the port in both
  directions; no store-internal mail body is reached.

## Commands and outcomes (from `server/`, via `ccrc test --`, `--maxWorkers=2`, foreground)
- Red (Step 3, before `assertLandingCallerBindings` existed): census file `8 failed | 30 passed (38)`
  (`ReferenceError: assertLandingCallerBindings is not defined`, plus the first two pin attempts, fixed in the test).
- Green at tip bdc6581e8 plus this task's test edits: census + coord-policy-rings + watcher-store-port: 3 files, 84 passed.
- `typecheck-tests.test.ts` alone: 1 file, 12 passed (no OOM kill this time). Production `tsc --noEmit` alone: rc=0.
- `GROWTH_CHECK=1 growth-check`: 73 passed (no source file changed in this task, so no growth).
- `anchors citations deviation-refs dtbd topology-clean`: 5 files, 106 passed. `test/single-definition`: 32 files, 1331 passed.
- Privacy scanner from the repo root: rc 0, zero lines. `git diff --check 391b5c65b..HEAD`: clean. The list-based grep over changed
  files and commit messages is recorded in the report. No dependency or lockfile, canonical verdict block
  (`wave-lifecycle.md`), exec whitelist, PWA door or live-setting file is in `git diff --name-only 391b5c65b..HEAD`.
- Step 6 re-runs at this tip, in the groups the notes used:
  - G1 `landed-decide landed-lane landing-land-words landing-line-order landing-control coord-radar radar-lane`: 7 files, 334 passed.
  - G2 `landing-journal-store landing-entry-store landing-advance-route landing-land-store landing-writes landing-writes-route landing-facts-scope refusal-status`: 8 files, 324 passed.
  - G3 `landing-next-mail landing-read-route coordinator-skill coordinator-landing-verdict fleetio-contract coord-lineage landing-checks-lane mail-revive`: 8 files (advance-switches lives in `test/single-definition`, run above), 1380 passed.
  - G4 `run-routes ccd-land-probe -t 'mark that throws|lander key and its mirror'`: 2 files, 13 passed.

## Mutation matrix M1 to M27
"Owner note" is the task note that measured the row. A row was re-run only when its mutated code changed after the owner measured it. The `Re-run` column records the state at the reviewed tip; fix round 1 re-ran every row except M8-M10, see `fix-round-1.md#r2`.
| Row | Mutant | Measured red assertion | Owner note | Re-run |
|---|---|---|---|---|
| M1 | project read refusal `skip` not `stop` | `a store stop in the first project ends the pass`: expected { read: 1, ... } to match { read: 0, stopped: 'store' } | task-1 | no |
| M2 | prune ignores `complete` | `an incomplete inventory retains memory: expected false to be true` | task-1 | no |
| M3 | held mark memory write removed | 3 failed: both `held at the write` rows, `a mark held at the write is remembered at the pass start` | task-1 | no |
| M4 | mark `at` from pass start | `expected 1794398400000 to be 1794398401000` | task-1 | no |
| M5 | `isLandable` ignores projection | `expected true to be false` | task-1 | no |
| M6 | third hold word, no map entry | `landed.ts TS2741 Property '"landing-hold-third"' is missing in type ... Record` (tsc) | task-1 | no |
| M7 | `landOnClose` catch removed | `expected 500 to be 200` | task-1 | no |
| M8 | `remove_own` `real_dir` guard removed | K8 `the listing: expected [] to deeply equal [ 'enabled', 'lander' ]` | task-2 | no |
| M9 | marker chain follows a symlink | `expected { ok: true, doc: ... } to deeply equal { ok: false, reason: 'absent' }` (3 failed) | task-2 | no |
| M10 | no pre-read cap / whole-remainder range | `the oversized probe was read: expected [ Array(1) ] to deeply equal []`; `expected false to be 524288` | task-2 | no |
| M11 | probe base binding removed | `base mismatch...: expected { mode: 'ready', ... } to deeply equal { mode: 'held', ... }` | task-3 | no |
| M12 | selected head not fully compared (M12a: pinned sha dropped; M12b: binding searches a later entry) | pure: `head mismatch...: expected ready to deeply equal held`; real store and mail: `expected { kind: 'queued', mailId: 1, ... } to deeply equal { kind: 'no-send', ... }` (M12a 2 failed, M12b 6 failed) | task-3 (pure); `fix-round-1.md#r2` (real store, mail, later clean entry queues 0 mails) | yes, R2 |
| M13 | pending/unmeasured clears red (M13a); binding `health-unmeasured` arm removed (M13b) | pure: `expected { kind: 'set', value: false, ... } to deeply equal { kind: 'keep', value: true }`; real store: flag cleared (M13a), `queued` instead of `no-send` and `ready` instead of `held` (M13b) | task-3 (pure); `fix-round-1.md#r2` (real store and mail) | yes, R2 |
| M14 | health UPSERT also writes `operatorPaused = 0` | `M14: a pause standing before red to green...` and `M14: a pause placed between red and green...`: `expected { operatorPaused: false, ... } to deeply equal { operatorPaused: true, ... }` (2 failed); also pinned structurally by this task's census (`operatorPaused` absent from the UPSERT) | `fix-round-1.md#r2` (task 5 recorded no M14 mutant) | yes, R2 |
| M15 | fix jumps after/recovery/operator pause | 3 failed (`expected { paused: false, ... } to match object { paused: true, by: ['main-red'] }`) | task-3 | no |
| M16 | equal-head projection check removed | `expect(res.statusCode).toBe(503)` with the 200 success body, 4 rows | task-4 | no |
| M17 marker | quarantine exclusion removed | `expected { kind: 'eligible', ... } to deeply equal { kind: 'blocked', ... }` (3 failed) | task-4 | no |
| M17 binding | binding exclusion removed | same shape, reason `binding` (3 failed) | task-4 | no |
| M17 token | token comparison removed | `kind: 'landed'` received where `moved` expected (4 failed) | task-4 | no |
| M17 identity (invalid run id) | `!p.runIdOk` removed from the identity exclusion | `an invalid run id`: `expected { kind: 'blocked', reason: 'binding' } to deeply equal { kind: 'blocked', reason: 'identity' }`; 1 failed, 17 passed | task-7 (measured here) | n/a |
| M17 identity (blank project) | `!nonblank(row.project)` removed | Fix round 1: the first measurement (existing cases only) SURVIVED, 29 passed. After the new real-store cases `an empty project` / `a padded project is the identity exclusion, never a repair` (`landing-land-store.test.ts`; project `''` and `' project-a '`, otherwise eligible, read under that same key): 2 failed, each `AssertionError: expected { kind: 'eligible', ...(1) } to deeply equal { kind: 'blocked', reason: 'identity' }`; restored from the saved copy, 2 passed | task-7 | n/a |
| M17 retained-fields | the per-column, kind, base, afterIds, fixes, pinnedAt, ejections checks removed (only the token-absent check stays) | 7 failed: `an unreadable afterIds`, `an unreadable ejection counter`, `an unreadable pin time`, `an oversized pin time`, `an unreadable fixesMain`, `an unreadable base`, `an unreadable ejection kind`, each `expected { kind: 'eligible', ... } to deeply equal { kind: 'blocked', ... }`; restored, 18 passed | task-7 | n/a |
| M18 | ambient read caught in `readLanding` | `expected [Function] to throw error including 'fixture select fault' but got 'database is not open'` | task-4 | no |
| M19 | dedupe on outstanding mail only / unique observation | `expected { kind: 'queued', ... } to deeply equal { kind: 'duplicate', ... }` (acked, rejected rows; 4 rows for the run arm) | task-5 | no |
| M20 | base, episode or recipient omitted from the tuple | `expected { kind: 'duplicate', ... } to match object { kind: 'queued' }` (3 variants) | task-5 | no |
| M21 | episode comparison / `run-not-merging` removed | `expected { kind: 'queued', ... } to deeply equal { kind: 'no-send', ... }`; reason `episode-changed` where `run-not-merging` expected | task-5 | no |
| M22 | stamp failure ignored | `expected { kind: 'queued', ... } to match object { kind: 'failure', ... }` | task-5 | no |
| M23 | radar generation check removed | `the superseded pass cannot apply: expected [ 'proj-b', 'proj-b' ] to deeply equal [ 'proj-b' ]` | task-6 | no |
| M24 close | `land` rebound to a cast run arm | census: `Error: server/src/coord/close.ts#landOnClose: closeLandingOf: 'land' is cast, which hides what it holds` (2 failed, 36 passed); restored, 84 passed | task-7 | n/a |
| M24 pad | run arm padded past 400 characters with `kind: 'land' as const` | census: `Error: server/src/coord/routes.ts#advanceAct: the run arm must carry runId and no 'kind' member` (2 failed; the second is the probe anchor `causedBy: 'coordinator', landing })` gone); restored from the saved copy | task-7 | n/a |
| M25 | closed-row readability gate removed | `expected { ok: true, ... } to match object { ok: true, to: 'merging', ... }` (2 failed) | task-4 | no |
| M26 | bytes tagged as string / `String(v)` / omitted | `expected 2 to be 3 // Object.is equality` (x2); one-byte drift answered `landed` not `moved` | task-4 (re-run on the folded form there) | no |
| M27 | `landingFence = recovery` removed | `expected { ok: true, facts: ... } to match object { ok: false, error: 'landing-fenced' }` (6 failed) | task-5 | no |

Re-run decision: `git log` on each mutated file since its owner measured shows `landingEntry.ts` and `store.ts` changed after
task 4 (task 5 added the `creations` fact and the cue transaction). The mutated regions of M16-M18, M25 and M26 (the repair
token, the closed-row gate, the retreat refusal) were not touched by those commits, and the task 4 selections are in the
Step 6 groups at this tip and green; so they were not re-mutated. M27's guarded line and M19-M22's code were last changed by
task 5's own fix round and measured there. `landing-control.test.ts` and `landed-lane.test.ts`, the selections of M13, M14, M1-M4,
are green at this tip (G1). This paragraph records the state at the reviewed tip; fix round 1 re-ran the rows (see `fix-round-1.md#r2`).

## Departures (by slug, collected from tasks 1 to 6, then this task)
task 1: node-modules-install, gate-literal. task 2: probe-reasons, health-ancestors. task 3: shared-api-import, flag-not-gate
(and the rewrite of row C17 to the Amendment A behaviour). task 4: subjects-whole-union, tests-beyond-the-list,
no-verdict-for-terminal-rows. task 5: port-member-deferred (superseded: task 6 added the member), control-tx-takes-port,
run-absent-word, facts-literals, related-selection-substituted, control-tx-module. task 6: new-l1-view-file, shared-landing-line-untouched.
Task 7: none beyond the above; the census scan treats `Date.parse` as no clock read (`landed.ts` is unchanged).

## Limitations
- Static census: `assertLandingCallerBindings` is syntax only; a call through an alias of `advanceLanding` or a computed member
  is out of width (the census of callers counts calls by name).
- Every mutation run on this box took minutes under load; the harness moves a foreground command to the background after 180 s,
  so the Step 6 groups were waited on by a foreground poll of the run's own output file, not started twice.
- Fix round 1: the close-probe rejection rows now match each rejection's own phrase (`parameter`, `not a const`, `reassigned`, `declarations`, `cast`).

## Final review fix wave

- F1: the 5b landing reference now defines "positively opted in" in place (binding present and not `inert`, or the `lander` marker exists; not the lineage `enabled` marker), says `held` including `opt-in-unknown` stops, and a missing `binding` is the only fallback, still stopping where `lander` exists. The canonical verdict fence is untouched; the LINE pin in `coordinator-skill.test.ts` was extended by exact equality. Tests: `coordinator-skill`, `coordinator-landing-verdict` green (1050).
- F2: README landing-section text corrected (main-red pause under D-8625, re-pin condition D-8626, retreat refusal and `recovery: 'repair'` D-8627, the `lander` row), plus one paragraph on the single main-red writer, the next-to-land mail, the landed reader's retirement of damaged rows and the opt-out trap. The auth paragraph and install text are unchanged.
- F3: `currentLandingControl(project, nowMs = Date.now())` in `watch.ts` answers `undefined` once the pass that wrote the cache is older than `freshWithin(..., RADAR_PROBE_FRESH_S, ...)` allows (pass time kept in `landingControlsAt`, stamped through `iso` because a server radar reader may not build a Date, which `single-definition/core-vocab` pins). Existing getter calls in `radar-lane.test.ts` pass the pass's `NOW`. New test: "a cached control older than the radar freshness allows answers nothing, so the route holds".
  Mutant row: getter ignores age (age check replaced by `void nowMs`) -> `radar-lane.test.ts -t "older than the radar freshness"` rc=1, `AssertionError: expected { lander: { ok: true, …(1) }, …(2) } to be undefined`; restored from the saved copy, same selection rc=0.
- F4: `landingControlTx.ts` checks a missing run row for a run episode before the phase moves to `apply` and answers `no-send` `episode-changed`; no invariant throw remains. `landing-next-mail` green.
- F5: unused `LandingInfrastructureCode` import removed from `advance.ts`.
- Gates: skill/verdict, radar-lane/landing-read-route/landing-control/landing-next-mail, `single-definition` + `rings` (45 files), `GROWTH_CHECK=1 growth-check` (pass), anchors/citations/deviation-refs/dtbd/topology-clean, production `tsc --noEmit` rc=0, private-names scan rc 0 with no output, `git diff --check` clean.
- F6: `landingControlTx.ts` is added to `HANDLE_HOLDERS` in `single-definition/core-vocab.test.ts` (reason comment beside the set, at its end) and spells its access plainly as `coord.db`; the destructure is gone. This is the guard change that departure `control-tx-takes-port` rests on. Proof: with the file removed from the set, `core-vocab` is red, `AssertionError: server/src/coord/landingControlTx.ts names a database handle on a coord/store receiver: expected true to be false`; restored from the saved copy, `single-definition` + `rings` + `landing-next-mail` + `landing-control` green (46 files), `tsc --noEmit` rc=0.
- F3 stamp: kept `iso` from `continuity/card.js`; `freshWithin` takes a string, `watch.ts` may not build a Date (core-vocab), and no number-taking helper exists in the watcher's own context.
- R1-R3: README retreat refusal now states only the real cause (an unreadable projection, at any head); the 5b reference and its LINE pin say an `inert` binding stops where `lander` exists and applies the pre-5i checks only where it does not; the landing read route measures `now` once for both the control getter and the view. Gates: coordinator-skill/verdict, landing-read-route/radar-lane, growth check, `tsc --noEmit`, private-names scan and `git diff --check` all green.
