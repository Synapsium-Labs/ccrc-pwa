# Task 2 note: one bounded, coherent control bundle (wave 5i)

## What changed
- `radar.ts`: `ProbeDoc.baseSha` (from the validated `base.sha`), `ControlFailure`, `LanderDoc/LanderRead`, `MainHealthDoc/MainHealthRead`,
  `LandingControlRead`, `parseLander`, `parseMainHealth`. New parsers say `malformed` (foreign project included) before `stale`; the legacy
  probe parser keeps its `unreadable` for a malformed probe.
- `lineageRead.ts`: the sized `readRegular` overload is now the bounded read (stat after the kind check and before any byte, `oversize` with the
  measured size, ranges of at most `READ_FROM_MAX_BYTES` through `readFileFromBytesMeasured`, same size on every answer, second stat compared on
  size and mtime, one strict UTF-8 decode). `readLandingControl` consumes the probe already read; the marker's ancestors (`landing`,
  `landing/<project>`) are proved real directories by lstat plus a successful listing before the read and again after it. `readRadarPass` takes
  `controlsWanted` and returns `controls` beside `reads`; the unbounded legacy overload is unchanged.
- Tests: `landing-control.test.ts` (new), `coord-radar`, `radar-lane`, `ccd-land-probe` (K8, K8b), `fleetio-contract`, `landingFixture.ts`
  (`controlRead`, `CONTROL_NOW`).

## Evidence
- Red (before the readers): `vitest run test/coord-radar.test.ts test/radar-lane.test.ts test/landing-control.test.ts` gave 26 failed / 123 passed
  (`readLandingControl`/`readRegular` bounded overload missing, `controls` undefined). The producer case K8/K8b is test-only and passes on the
  unchanged producer by design; its red is mutation M8.
- Green: the same three files plus `fleetio-contract`, `coord-lineage`, `single-definition/core-vocab`: 6 files, 368 tests pass.
  `ccd-land-probe -t 'lander key and its mirror'`: 12 pass. Production `tsc --noEmit` alone: rc 0. `test/tsconfig.tests.json` project: no
  error under `server/` (8 errors, all `agent/` imports of `ws`, whose node_modules are not installed here). `typecheck-tests.test.ts` itself cannot
  run in this checkout (pwa's `typescript` is not installed): environment, not this change.

## Mutation rows (measured, sequential, restored from a saved copy, re-run green)
| Row | Mutant | Selection | Result |
|---|---|---|---|
| M8 | remove only `remove_own`'s `real_dir(dirpath)` | `ccd-land-probe -t 'lander key and its mirror'` | rc 1; K8 `AssertionError: lander=none: the listing: expected [] to deeply equal [ 'enabled', 'lander' ]`, K8b the same with `missing conf` (the planted files were deleted; the listing assertion precedes the byte assertion) |
| M9 | marker chain follows a symlink (drop the `symlink` arm of `realDirectory`) | `radar-lane` + `landing-control` | rc 1, 3 failed: `expected { ok: true, doc: { …(3) } } to deeply equal { ok: false, reason: 'absent' }` (radar-lane M9 and both landing-control ancestor cases) |
| M10a | remove the pre-read cap | same | rc 1, 4 failed, e.g. `the oversized probe was read: expected [ Array(1) ] to deeply equal []` and `expected { ok: true, …(1) } to deeply equal { ok: false, reason: 'oversize', …(1) }` |
| M10b | request the whole remainder in one range | same | rc 1, 3 failed, e.g. radar-lane M10 `expected false to be true` and landing-control `expected false to be 524288` |

## Departures
- `departure: probe-reasons`: `readRadarProbe`/`RadarPassRead` now carry `ControlFailure` reasons (`oversize`, `unmeasured` from an old peer)
  where the legacy reader folded them into `unreadable`; the lane only prints the reason, so behaviour is unchanged. A probe now costs a second
  `statMeasured`; `radar-lane`'s per-project call census says `lstat, read, stat, stat`.
- `departure: health-ancestors`: the ancestor proof covers the lander marker only, as the brief says. `main-health` and `probe` keep the
  existing regular-file rule (their file is lstat-checked, their directories are not).

## Residual (Step 7)
Metadata rechecks (size, mtime, and the chain proof before and after) cannot prove inode identity across remote range calls. The bundle is a
cue snapshot, not merge permission. `landing` is listed once per project bundle for the directory proof; a pass of many projects repeats that listing.
