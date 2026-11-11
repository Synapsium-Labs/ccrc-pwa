# A dispatched full run: once per accepted tip

## Goal

An agent that needs CI's full mode on a branch dispatches it once per accepted tip (after review, never per push or fix round), cancels a superseded dispatched run on the same branch first, and reads only the Linux legs as the arbiter. `ci.yml` does not change.

## What was read first

- Between 2026-11-03 and 2026-11-06 fleet workers dispatched about 51 full `ci.yml` runs (`gh workflow run ci.yml --ref <branch> -f mode=full`) on workspace branches, one per push or fix round, costing about 23k runner-minutes. All 51 concluded red: a dispatched full run calls the macOS legs, and `full-suite` needs them. The Linux legs were green in 30 of the 51.
- The macOS legs are advisory and off the merge path (operator rulings 2026-10-28 and 2026-11-02, cited at the `macos` job in `ci.yml`).
- The instruction reached agents from three places: CLAUDE.md's load-flake bullet (the full-run arbiter), the over-budget line `ccrc test` prints (`agent/src/testbox/client.ts`, pinned in `server/test/testbox-wrapper.test.ts`, the fallback rows and the refusals), and the CI step of `docs/superpowers/plans/2026-11-04-box-settings-view-w2.md`.

## Deviations found

- **D-8266 (2026-11-11)** — a dispatched full run goes out once per accepted tip (after review, never per push or fix round), a superseded dispatched run on the same branch is cancelled first, and only its Linux legs arbitrate; the macOS legs stay advisory.

## Design

- `ccrc test`'s over-budget line stays one line. It names the cancel (`gh run list --workflow ci.yml --branch <b> --event workflow_dispatch --status in_progress`, then `gh run cancel <id>`), then the dispatch, and says only the Linux legs arbitrate.
- CLAUDE.md's full-run arbiter sentence carries the same three rules.
- The box-settings wave 2 plan is a historical plan: it gets a short dated note under its CI step, not a rewrite (`Ledger-Edit: D-8266` on that commit).

## Tasks

- [x] T1. Tests first, red: the over-budget fallback row and refusal pin the new one-line CI line.
- [x] T2. The client's line, CLAUDE.md, and the plan note.
- [x] T3. `testbox-wrapper.test.ts`, the agent and server typechecks, `deviation-refs` and `dtbd`.
