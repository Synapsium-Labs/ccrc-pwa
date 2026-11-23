# Capture runner PR 3a: review 3226's carried findings (run 3291)

The task note of run 3291, wave 202 of the overlord programme (issue #2491). The spec is
`docs/superpowers/specs/2026-11-22-build-capture-runner-design.md` (§2.4 to §2.6, §5 Table 7's PR 3 row); the first two
pull requests' note is `capture-runner.md` beside this one. This note records what the ledger should learn; the coordinator
folds it into the ledger on its own pull request.

## What this pull request delivers

PR 3 lands in two parts by the coordinator's ruling (mail 30773): this pull request, PR 3a, carries review run 3226's
findings that are independent of PR 2, and PR 3b wires the runner to the desk once PR 2 (run 3237) lands. The runner is
still not wired here, so the desk still answers `no-runner` and no verdict changes.

- **F5, the `cwd` proof.** The replay (`shared/claudeBuildCapture.ts#replayCapture`) proves `cwd` only by the
  PermissionRequest whose Bash command is the drive's write, `CAPTURE_WRITE_COMMAND`, which moved from
  `agent/src/testbox/capture.ts` to `shared/claudeBuildCapture.ts` so the L0 replay can read it. Any other prompt naming the
  `cd` directory proves nothing.
- **F7's gap, the approval wait's output side (spec §2.6).** The recorder's PermissionRequest line carries the answer it
  printed (`answer`, `allow`; an optional key, so the record contract stays additive). A pass needs ONE write to carry all
  of its evidence (review 3316 A1, A2; `shared/claudeBuildCapture.ts#writeEvidence`): exactly one permission prompt for the
  write, that prompt's own line answered `allow`, and the write's one PreToolUse before it and one PostToolUse after it
  naming the same `tool_use_id` (the prompt carries none). `cwd` is that same prompt's. An allow on another prompt, a
  second write prompt, a completion of another call or a missing id fails closed, each with its own line.
- **F8, the timing target.** `capture.ts` carries a TARGET (`CAPTURE_TIMINGS`) and the worst case of one capture by the
  runner as it stands on main, if it ran under that target (`captureWorstCaseMs`, each tmux call at its target bound plus
  the spawner's drain). A pin holds two such worst cases and the margin within `TESTBOX_CAPTURE_DEADLINE_MS`. It proves the
  target, not the runner (review 3316 F1): nothing passes the target to the runner or the launcher yet, the launcher's
  bound defaults to 15 s against the target's 5 s, and the runner's step, exit and poll timeouts are unset deps until PR 3b.
  What the worst case does not bound: the setup is an allowance; the stand-in's close and the scratch removal are not
  counted, and a hung stand-in can outlast them; PR 2's stop wait and any liveness call it adds are not counted. A capture
  that has waited, by the target, too long to answer in time is ended by the desk with no verdict and
  `CAPTURE_LATE_DETAIL`, never run (`captureStartsLate`).
- **F8, the takeover.** The test service's `idle()`, which a tool sync's takeover waits on, waits for the capture desk too,
  so the release the recorder runs from is never replaced under a running capture.
- **F8, the socket path (decided here, wired in PR 3b).** The capture's private tmux server's socket lives in a directory of its own under the service's
  temporary directory (`captureTmuxDir`, `/tmp`, private to the unit), not under `<CCRC_TESTBOX_ROOT>/captures/<id>`, so no
  root is too long for a unix socket path. `captureSocketFits` tells a base that cannot fit.
- **F8, the builds store (decided here, wired in PR 3b).** `buildsToPrune` keeps the newest builds and every build a capture still needs.
- **The compiled recorder.** `agent/test/testbox-capture-compiled.test.ts` emits the agent package with its own `tsc` into
  a release-shaped tree and runs the emitted recorder under plain `node`.

## Departures, by slug

- **pr3-split-around-pr2** (coordinator's brief, then mail 30773). PR 2 (run 3237) edits the runner, the desk's refusal
  order, the service's start sweep, the transport and the capture paths. PR 3a leaves those hunks to PR 2; PR 3b does the
  parts of F8 and F9 that sit in them once PR 2 lands: the socket directory and the prune wired in, the full desk order
  pinned (F9), the transport's dropped detail logged (F9), then the runner wiring and the end-to-end fixtures.
- **late-capture-ends-with-a-word** (F8: "a capture that always outruns the deadline ends as a no-verdict word"). Once
  PR 3b binds the runner to the target (gate G1 below), a capture ends within the deadline by construction, so the case
  left is a capture that waited in the box's queue behind another. In PR 3a the pin holds the target only, not the runner
  (review 3316 F1). The desk ends it with no verdict and `CAPTURE_LATE_DETAIL`, an `ended` state the frame
  family already carries: no new refusal word, no wire change. The server reads it as `unanswered` and counts one attempt.
- **socket-under-service-tmp** (F8's socket-path guard, the first of the review's two remedies). The socket directory is
  short and outside `captures/<id>`, under the service's own `/tmp`, which the unit makes private and clears at each start,
  so a crashed capture leaves nothing there for long. A service whose temporary directory is too long wires no runner, so
  the box answers `no-runner` (nothing sent, no attempt counted) rather than failing every start.
- **takeover-waits-for-captures-only** (F8). `idle()` now waits for captures. The probe desk has no runner wired yet
  (D-8290), so it is not counted; the day a probe runner is wired, `idle()` counts it the same way.
- **replay-order-is-the-loop** (mutation pass), then **one-write-carries-the-evidence** (review 3316 A1, A2). The first
  form compared indexes in the loop; the fix round replaced the loop's flags with `writeEvidence`, which ties the prompt,
  its answer and the completion to one tool call. One mutant survives there and is equivalent: taking the last write prompt
  instead of the first, which the guard before it leaves only one of.
- **step-budget-holds-b2s-step** (the coordinator's ruling on door B2's model-switch step, mail 30767). Door B2 (run 3301)
  adds a typed drive step, `/model haiku`, in its own pull request. The target's step budget is 35 s, and a case keeps one
  more typed step than today's drive inside the TARGET's pin. That is not a claim that door B2's step fits the real
  end-to-end deadline: the runner does not read the target yet, and at the launcher's default 15 s bound it would not fit
  (review 3316 F1). Gate G1 below measures it.

## PR 3b acceptance gates (review 3316, the coordinator's ruling)

PR 3b does not land without these, each a test that goes red when it fails:

- **G1, one timing contract.** The desk's late check, `tmuxLauncher`'s bound and the runner's step, exit and poll timeouts
  and PR 2's stop wait all read one timing contract, and a test through the production composition (the desk and the
  runner that `agent/src/testbox/main.ts` builds, with the real launcher) goes red when the launched capture, counting its
  queue wait, its teardown (the kill, PR 2's stop wait, the scratch removal) and door B2's model-switch step, no longer
  fits `TESTBOX_CAPTURE_DEADLINE_MS`. No live wiring or real box test in 3a.
- **G2, the takeover admission gate.** The desk starts no capture while the tool sync's takeover has admissions closed
  (`toolsync.ts#ToolSync.admitting`), so a capture submitted while a failed hand-over is retried is never started only to
  be cut off by the service's exit (review 3316 A4). Pinned beside the `idle()` wait and PR 2's cleanup.

## Fix round 1 (review 3316)

F1 and A3 (the timing table described a runner that does not exist): the comments and claims now call it a target, the
worst case models only the runner on main and names what it does not bound, the launcher's default is named apart from
the target bound, and gate G1 carries the binding to PR 3b. `capture.ts` is under door B2's claim, so its hunks went to
B2 as a packet first. A1 and A2: `writeEvidence`, with isolated negative fixtures; the review's surviving mutant (an allow
on any prompt counts) now dies. A4: gate G2. A5: no change.
