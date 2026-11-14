# A run row says when its worker was last seen

- **D-8285 (2026-11-11)** — the worker heartbeat: each open run carries `workerLastSeen` (the `at` of the newest main-thread event in its worker's turn marker) and `workerLastTurn` (that marker's turn state, start and end), filled by the stall sweep's own marker read, stamped on every run answer beside the stuck verdict, and drawn on the run row and its page header as "last seen N ago", quiet past the stall watch's quiet time.

## Why

#119: nothing told a live worker from a dead one. The `.hold` file is written once at dispatch, `items` counts only
what the coordinator settled (D-5914), `state` moves only when someone advances it, and an active unit says nothing
about the session inside it. A coordinator or the operator saw the same row either way. The runs rebuild's B9 ("worker
gone") and its E4 anchor wait on this field (spec 2026-11-04 §6.2, §15).

## Change

- `server/src/coord/workerSeen.ts` (L1): `workerSeenOf(mark)` turns a turn-marker read into a heartbeat, or null for
  every read that gave no marker (`absent`, `unmeasured`, `malformed`, `foreign`, `stale`). `createWorkerSeen()` is the
  one in-memory board, swapped whole by `replace`, read by `of(runId)`.
- `watch.ts`: `judgeStall` already reads each open run's worker marker once a sweep (`stallMarkRead`). That read is the
  heartbeat's only source: it is handed to `workerSeenOf` and recorded for every run on that worker, and the sweep swaps
  the board once its workers are judged. A disabled stall watch clears the board, so a frozen value never ages into a
  false "quiet". No new read, no new lane, no new loop: the same file read the same number of times
  (`worker-seen.test.ts` counts it).
- `coord/runWire.ts`: `withWorkerSeen(reader, runs)` stamps the two fields. It rides wherever `withVerdicts` does: the
  runs frame (`emitRuns`), its cold start (`server.ts`) and `stampVerdicts` (`GET /api/runs`, `/api/runs/:id`, the
  record). A run with no entry stamps nothing.
- `shared/api.ts`: `RunSummary.workerLastSeen?` and `.workerLastTurn?` (`RunWorkerTurn`), additive; `FLEET_PROTO` is not
  bumped.
- PWA: `workerSeenNote` (`runWords.ts`) is the one reader. "last seen 5m ago"; " · in a turn" while the marker's turn is
  open (the marker does not move inside a turn, so it is never called quiet then); " · turn failed" after a
  StopFailure; " · quiet" in `.run-warn`'s amber once a finished turn is older than the frame's `stallQuietMs`, the
  threshold `lastMoveAt` already uses. `RunRow` draws it after the dispatch age, and the run page's header draws it too
  (the header is a superset of the row, D-5545). Checked in Chrome at 360, 390, 1280, 1470 and 1920, both skins, both
  themes (`programme-page.browser.test.ts`, `runs-widths.browser.test.ts`).

## Deviations found

- The ticket suggested the transcript's mtime. The ruling chose the turn marker: the server already parses and judges
  it, the stall sweep already reads it once a minute per worker, and a transcript stat would be a second poller of the
  same liveness.
- The marker is written on a prompt, a Stop, a StopFailure and a restart, never on a tool call. A long turn therefore
  reads its start, and the row says "in a turn" instead of calling it quiet. Whether the pane is alive stays the stuck
  verdict's (`runStuck.ts`), not this field's.
- The board is in memory, like the stuck verdict's: empty for one sweep after a restart. The marker on disk survives,
  so the next sweep restores every value, a gone worker's included.
- The `items` and `state` lag #119 also names is not changed here: `items` counts settled items by design (D-5914), and
  B9 is the place a run whose worker is gone gets a row.
