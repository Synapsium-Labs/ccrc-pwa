# The fake-manager supervisor's unit files are never read half-written

**Size:** S. **Deploy class:** one server test fixture (`server/test/codexLaneFixture.ts`); no `ccd/`, `agent/`, `pwa/` or wire change. One task.

## Problem

L0a, "a fake-manager supervisor self-expires", polls the unit's `state` file for `inactive` and then reads `pid`, expecting `0\n`. Sometimes it read `''`. The fixture's supervisor wrote `state` before `pid`, and it wrote each one with `open(path, "w")`, which truncates the file before filling it. A reader polling at the wrong moment saw an empty file.

## Task 1: whole-file writes, pid before state (D-6788)

**Files:** `server/test/codexLaneFixture.ts` (the supervisor's `write` and `complete_inactive`).

**Steps:** `write` writes a temp file and `os.replace`s it over the target. `complete_inactive` writes `pid` before `state`. Nothing else changes.

**Verify:** the codex-lane suites, `dtbd`, `deviation-refs`, `single-definition`, `ci-shards`.

## Deviations found

- **D-6788** — `flake-codex-l0a-unit-files-whole`: the fake-manager supervisor in the codex-lane test fixture writes each unit file by temp file and rename, so a reader never sees one truncated and unfilled, and it writes `pid` before `state`, so a test that has seen `state` go `inactive` reads the final `pid`.
- **D-6789** — unused (issued as a reserve for this fix).
