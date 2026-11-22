# Capture runner PR 3: the wiring (run 3291)

The task note of run 3291, wave 202 of the overlord programme (issue #2491). The spec is
`docs/superpowers/specs/2026-11-22-build-capture-runner-design.md` (§2.4 to §2.6, §5 Table 7's PR 3 row); the first two
pull requests' note is `capture-runner.md` beside this one. This note records what the ledger should learn; the coordinator
folds it into the ledger on its own pull request.

## What this pull request delivers

Review run 3226's findings carried to PR 3, then the runner wired to the desk.

- **F5, the `cwd` proof.** The replay (`shared/claudeBuildCapture.ts#replayCapture`) proves `cwd` only by the
  PermissionRequest whose Bash command is the drive's write, `CAPTURE_WRITE_COMMAND`, which moved from
  `agent/src/testbox/capture.ts` to `shared/claudeBuildCapture.ts` so the L0 replay can read it. Any other prompt naming the
  `cd` directory proves nothing.
- **F7's gap, the approval wait's output side (spec §2.6).** The recorder's PermissionRequest line carries the answer it
  printed (`answer`, `allow`), and a pass needs that answer on the write's prompt and the write's PostToolUse after it, so
  the replay sees the build obey the hook's answer.
- **F8, the deadline arithmetic.** `capture.ts` carries the production timings (`CAPTURE_TIMINGS`) and the worst case one
  capture can take (`captureWorstCaseMs`). A pin holds two worst cases and the margin within `TESTBOX_CAPTURE_DEADLINE_MS`,
  so a capture with one capture ahead of it in the queue still answers before the fleet agent stops waiting. A capture that
  has waited too long to answer in time is ended by the desk with no verdict and `CAPTURE_LATE_DETAIL`, never run for an
  answer nobody hears (`captureStartsLate`).
- **F8, the takeover.** The test service's `idle()`, which a tool sync's takeover waits on, waits for the capture desk too,
  so the release the recorder runs from is never replaced under a running capture.
- **F8, the socket path.** The capture's private tmux server's socket lives in a directory of its own under the service's
  temporary directory (`captureTmuxDir`, `/tmp`, private to the unit), not under `<CCRC_TESTBOX_ROOT>/captures/<id>`, so no
  root is too long for a unix socket path. `captureSocketFits` tells a base that cannot fit.
- **F8, the builds store.** `buildsToPrune` keeps the newest builds and every build a capture still needs.
- **The compiled recorder.** `agent/test/testbox-capture-compiled.test.ts` emits the agent package with its own `tsc` into
  a release-shaped tree and runs the emitted recorder under plain `node`.

## Departures, by slug

- **pr3-waits-for-pr2-files** (coordinator's brief: start now, wire last). PR 2 (run 3237) edits the runner, the desk's
  refusal order, the service's start sweep, the transport and the capture paths. This pull request left those hunks to PR 2
  and does the parts of F8 and F9 that sit in them after PR 2 lands: the socket directory and the prune wired in, the full
  desk order pinned, the transport's dropped detail logged.
- **late-capture-ends-with-a-word** (F8: "a capture that always outruns the deadline ends as a no-verdict word"). The
  runner's timings make it end within the deadline by construction (the pin), so the case left is a capture that waited in
  the box's queue behind another. The desk ends it with no verdict and `CAPTURE_LATE_DETAIL`, an `ended` state the frame
  family already carries: no new refusal word, no wire change. The server reads it as `unanswered` and counts one attempt.
- **socket-under-service-tmp** (F8's socket-path guard, the first of the review's two remedies). The socket directory is
  short and outside `captures/<id>`, under the service's own `/tmp`, which the unit makes private and clears at each start,
  so a crashed capture leaves nothing there for long. A service whose temporary directory is too long wires no runner, so
  the box answers `no-runner` (nothing sent, no attempt counted) rather than failing every start.
- **takeover-waits-for-captures-only** (F8). `idle()` now waits for captures. The probe desk has no runner wired yet
  (D-8290), so it is not counted; the day a probe runner is wired, `idle()` counts it the same way.
- **replay-order-is-the-loop** (mutation pass). The first form compared the PostToolUse's index with the allowed prompt's;
  a mutant removing the comparison survived, because the recording is read in order. The check is now the loop's own order.
