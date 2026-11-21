# Capture runner: the design and its first pull request (run 3214)

The task note of run 3214, wave 200 of the overlord programme (issue #2491). The spec is
`docs/superpowers/specs/2026-11-22-build-capture-runner-design.md`. This note records what the ledger should learn; the
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
  the build answers none. Otherwise a broken contract would sit `capture-queued` for ever.
- **capture-refusals-fold-to-no-runner** (a rule bent on purpose, said here as CLAUDE.md asks). The record's not-sent
  words are `no-test-box` and `no-runner` (`shared/claudeBuildTrust.ts#BuildCaptureNotSent`, and a CHECK constraint on
  `claude_builds.notSent`). Two box refusals, `build-absent` and `path-refused`, have no word of their own there, so the
  transport (`server/src/testboxCapture.ts`) folds them into `no-runner` and logs the real refusal. Neither can happen in
  PR 1, because the desk answers `no-runner` before it looks at the build. The follow-up widens the words, with a
  migration, before PR 3 wires the runner. Those files are held by run 3213 today.
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

## Follow-ups

- PR 2: the admin lane's copy sub (`ccrc testbox-admin`), composed by the server before each job. It touches
  `ccd/ccrc-testbox-admin` and `shared/testbox-admin.ts`, both under run 3211's claim today and the first under a growth
  cap.
- PR 3: the runner wired to the desk, the not-sent words widened, and the service's idle check counting the capture desk
  (the tool sync's takeover must wait for a running capture).
- The README's test box section names the capture once PR 3 lands; `README.md` is held by run 1850 today.
