# Capture runner: the design and its first pull request (run 3214)

The task note of run 3214, wave 200 of the overlord programme (issue #2491). The spec is
`docs/superpowers/specs/2026-11-22-build-capture-runner-design.md`, in its own pull request (#3171) by the coordinator's
ruling, landing just before this one or with it. This note records what the ledger should learn; the
coordinator folds it into the ledger on its own pull request.

## What this pull request delivers

- The spec: each new Claude Code build is captured on the test box with no operator act, no credentials, no new egress
  and no model spend, by driving the build against a scripted stand-in model on the capture's own loopback.
- PR 1 of the spec's three (§5): the capture contract and replay (`shared/claudeBuildCapture.ts`), the two capture frames
  in the test box frame family, the box-side runner (stand-in model, recorder, drive, tmux launcher), the capture desk with
  its runner not yet wired, the fleet agent's `testbox-capture` op, and the server's transport sending a real job.

## Departures, by slug

- **build-source-is-the-fleet** (coordinator's direction, mail 30048). ccrc has no path that fetches a Claude Code build,
  measured on `main` by the coordinator. The capture never downloads one: the build's bytes come from the fleet's own copy
  of that version, copied read-only over the test box admin lane and checked by hash at both ends (spec §2.2, PR 2).
- **capture-runs-in-service** (spec D4). The capture runs as a child of the test service, on its own tmux socket and in
  its own scratch home, not in a systemd unit of its own, so the box takes it with the tool sync alone and no installer
  re-run. A unit with no network is later hardening.
- **capture-is-its-own-job-kind** (spec D5). A capture is not a probe: it needs no scratch account, no probe config
  directory and no budget, and it returns a verdict, not an exit status. It reuses the probe desk's role check and write
  guard (`agent/src/testbox/probes.ts#probeRole`, `#writeRefusal`).
- **stalled-build-fails** (spec §2.4). A build that started but did not raise a step's events within the step's deadline
  fails, its output naming what was never recorded, instead of answering no verdict; only a runner that could not start
  the build answers none. Otherwise a broken contract would sit `capture-queued` for ever. Narrowed by the coordinator's
  ruling on review 3226's F2: a fault of the box is not a fault of the build and never pushes the operator, so at the
  SessionStart deadline a build that is not alive and recorded nothing answers no verdict; a live build with events
  missing still fails, and run 3213's retry ceiling covers the rest. Built in PR 2 with F1 and F10.
- **capture-refusals-fold-to-no-runner** (a rule bent on purpose, said here as CLAUDE.md asks). The record's not-sent
  words are `no-test-box` and `no-runner` (`shared/claudeBuildTrust.ts#BuildCaptureNotSent`, and a CHECK constraint on
  `claude_builds.notSent`). Two box refusals, `build-absent` and `path-refused`, have no word of their own there, so the
  transport (`server/src/testboxCapture.ts`) folds them into `no-runner` and logs the real refusal. Neither can happen in
  PR 1, because the desk answers `no-runner` before it looks at the build. The follow-up widens the words, with a
  migration, in PR 2 (coordinator's ruling, fix round 1). Those files are held by run 3213 today. Fix round 1 (review
  3226, F3) adds two seam answers to the same fold: a frame that never left the server (`not-started`, the agent link down)
  becomes `no-test-box`, and the fleet agent's held capture gate (`busy`) becomes `no-runner`, each with a log line naming
  the seam's word. The seam keeps them apart (`server/src/io.ts#CaptureAsked`), so PR 2's widening needs no seam change.
- **recorder-runs-from-source-in-tests** (coordinator's ruling, mail 30078, after a hook refusal of a heredoc that wrote a
  test). Nothing is compiled at test time. The recorder (`agent/src/testbox/captureRecord.ts`) imports no local module
  and uses only syntax Node's type stripping erases. Its tests run its source as a process with
  `--experimental-strip-types` passed explicitly, which the Node floor (22.16.0) needs, and every spawn has a timeout. So
  the recorder repeats `entry.ts#startedAsProgram`'s three-line check instead of importing it: a process boundary the
  import cannot cross without a build step. `capture.ts#captureSettings` takes the recorder's command as argv for the same
  reason.
- **dead-adapter-deleted** (coordinator's ruling, mail 30056). The stub `testboxCaptureTransport` in
  `server/src/buildCaptureLane.ts`, under run 3213's claim, is deleted by this pull request: the function, its doc comment
  and the `TestboxBlock` import, nothing else.

## Fix round 1 (review 3226)

Fixed in this PR: F3 (the remote arm keeps a frame that never left and the agent's busy refusal apart from a lost job),
F6 (the local arm runs against the configured home, `server/src/io.ts#localIOFor`), F12 (the state-for-another-build
refusal, the per-step event count and `captureEnv`'s three guards are pinned, each measured red when removed), and F11's
code nits. Fixed in the spec's PR: F4, F7 and F11's spec nits.

Left, and why:
- `server/src/buildCaptureLane.ts`'s header still says the job goes "over the existing test box connection" (F11). The
  file is under run 3213's claim, and a one-line comment is not worth a packet; the next PR that touches it fixes it.
- F11's remaining code nits are PR 3's, beside the code they touch: the drive's failure line naming the step, the build
  path passed to `new-session` as one shell word, `alive()` reading a timed-out `has-session` as exited, the dead fallback
  in `readCaptureRecords`, the desk's copy of the probe desk's queue (and its `kind: 'probe'` enqueue), and the private
  server's `cc-capture` session name.

## Follow-ups

- PR 2: the admin lane's copy sub (`ccrc testbox-admin`), sent only after a `build-absent` refusal as the decider in
  `shared/claudeBuildTrust.ts` rules (spec §2.2, D7); the not-sent words widened with their migration; the runner's verdict
  cut (F1, F2) and cleanup (F10). The copy touches `ccd/ccrc-testbox-admin` and `shared/testbox-admin.ts`, both under run
  3211's claim today and the first under a growth cap.
- PR 3: the runner wired to the desk, after F5 (the `cwd` proof by the write's PermissionRequest, its constant in
  `shared/`), F8 (the deadline arithmetic, the tool sync's takeover counting captures, sweeps, the socket-path guard), F9
  (the desk's refusal order pinned, the dropped detail logged), a test of the compiled recorder, and the replay tying the
  write's PostToolUse to the hook's `allow` (spec §2.6).
- The README's test box section names the capture once PR 3 lands; `README.md` is held by run 1850 today.
