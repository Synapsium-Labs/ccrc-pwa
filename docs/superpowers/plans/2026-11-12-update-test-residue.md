# Updates: the test residue carried past the programme's close

- **D-8387 (2026-11-12)** — the centralised-update programme's test residue R29, R42, R51 and R52: the heir-guard differential in `update-store-nodes.test.ts` becomes one case per state and detail, so no single case carries 27 store migrations against one timeout; the codex tier-restart spine describe in `ccrc-install-codex.test.ts` reaps every unit its fake user manager started and waits out each supervisor before its fixture HOME goes (`reapFakeUnits`, `codexLaneFixture.ts`); `ccd-update-sync.test.ts`'s invalid-byte userinfo row runs for the scheme arm as well, and under C.UTF-8 where en_US.UTF-8 is missing; `deploy/ccrc.env.example`'s freshness sentence names the reading stamped in the future; the settings-reader test header names L5 and L6.

Refs #2083 (the centralised-update programme's carried residue: R29, R42, R51 and R52 of
`docs/superpowers/programs/centralised-update-management.md`).

## Why

- **R29.** "The heir guard IS `isHalting`" built a whole migrated store for each of 3 states times 9 details, 27
  schema migrations in one case. It waits on no event: the time is CPU and fsync, so it is load alone that reds it
  (20375 ms on main against the 20 s bound, and 38.5 s at load 30, in the wave-19 and session-continuity plans'
  measurements). No bound is inherent to it, so none is widened: split, each row does one store's work under its own
  timeout, as every other case in the file does, and a red names its state and detail.
- **R42.** The tier-restart describe ends each lane through the product's own stop (`killLaneProcesses`). A unit that
  stop left running, or a supervisor still in its 3-second linger after it, outlived the file. The run-tmp teardown then
  removed its HOME and the leak check named a Python supervisor under that deleted HOME, exit 1 with every case passing.
- **R51 and R52.** Wave 29's review notes, minor and still owed.

## What changes

- `server/test/update-store-nodes.test.ts`: the differential is `it.each` over the same 27 rows, with the same
  assertions in each.
- `server/test/codexLaneFixture.ts`: `reapFakeUnits(home)` writes each spawned unit's `stop-request` (the fake
  manager's own stop channel, which its supervisor polls; no signal) and waits until no pid in `fake-systemd/spawned`
  still runs that HOME's `supervisor.py`, bounded by `FAKE_UNIT_REAP_MS`. A unit seeded by `fakeUnit` has no supervisor
  and is left alone.
- `server/test/ccrc-install-codex.test.ts`: the tier-restart describe's `afterEach` calls it after `killLaneProcesses`.
- `server/test/ccd-update-sync.test.ts`: W29-Y6 is two rows, the scheme-less arm and the `https://` arm, and takes
  C.UTF-8 when en_US.UTF-8 is not installed.
- `deploy/ccrc.env.example`: "0 disables the freshness skip" says that a reading stamped later than the box's clock is
  still skipped (its age is negative, still under 0).
- `server/test/ccrc-settings-lib.test.ts`: the header names L5 and L6.

## Tests

- `server/test/ccrc-codex-lifecycle.test.ts`, L0a `reapFakeUnits`: a running unit and one already stopped (its
  supervisor lingering) both end with their supervisors gone, and a seeded unit's stranger keeps running. Red before
  the helper existed (`reapFakeUnits is not a function`); red when the reap does not wait (a supervisor outlived it)
  and red when it sends no stop request (the tier ran out on its own, `WAIT:0` and no `TERM`).
- R29, loaded repeat on a 14-core Mac with 28 `yes` processes running (started and ended by exact pid), the bound
  tightened to 1500 ms to stand in for a slower runner's 20 s: the old single case red 5 of 5 (2276 to 3345 ms); the 27
  rows green 20 of 20, the slowest row 127 to 700 ms per run.
- W29-Y6: both rows are red against a redactor with its `LC_ALL=C` pin removed (each prints the userinfo whole).

## Deviations found

- R42's uninstall half, `ccrc-uninstall.test.ts`'s codex-namesake row, was already fixed on `main` by D-6941 (#1549,
  2026-10-26): its `finally` stops the namesake unit through the fake manager and waits for its supervisor.
- R51's first item, the sync redactor's extglob save and restore, was already gone: #1946 (D-7078, D-7289) replaced
  the script's own mask with the generated copy of ccd/ccrc's `_upd_redact`, which sets no shell option.
- The tier-restart describe and the uninstall describe are Linux-only (`describeLinux`: on Darwin the codex lane
  takes the nohup arm, not the user manager), so this Mac runs `reapFakeUnits` itself through its lifecycle row, and
  the install describe's afterEach first runs on the Linux shards.
