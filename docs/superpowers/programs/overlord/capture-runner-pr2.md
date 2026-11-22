# Capture runner, PR 2: the build copy, the not-sent words, and the runner's verdict cut (run 3237)

The task note of run 3237, wave 201 of the overlord programme (issue #2491). The spec is
`docs/superpowers/specs/2026-11-22-build-capture-runner-design.md`; this pull request builds its PR 2 row (§5, Table 7), with
review 3226's findings F1, F2 and F10 carried from PR 1 (`docs/superpowers/programs/overlord/capture-runner.md`). This note
records what the ledger should learn; the coordinator folds it into the ledger on its own pull request.

## What this pull request delivers

- **The copy** (spec §2.2, Table 2, D3, D7). A new short admin lane sub, `ccrc testbox-admin build-copy --version=<build>`, in
  its own sourced file, `ccd/testbox-build-copy`. On the fleet host it reads the build in Claude Code's versions directory,
  never writing it: the file must exist, be a regular file and not a link, and be at most 1 GiB, and it is hashed. Its bytes
  stream over the lane into a stage beside the box's capture store, the box hashes them, and the checked stage is installed
  read only at `<box root>/captures/builds/<version>`, owned by the box root's owner. Each refusal is its own code
  (`build-not-on-fleet`, `build-not-regular`, `build-too-large`, `build-hash-mismatch`, `build-copy-failed`), and a hash that
  differs removes the stage. The server's adapter, `server/src/testboxBuildCopy.ts`, runs that one sub through the one admin
  lane arm and maps it onto the lane's copy port.
- **The copy rule, in L1.** `shared/claudeBuildTrust.ts#captureNextAct` names each act of a capture pass: send; copy only
  after a `build-absent` refusal, once a pass; send again; stop. `#captureTryOf` names what the pass records. The lane
  (`server/src/buildCaptureLane.ts`) carries the acts out and decides nothing; no adapter sequences two ops.
- **The not-sent words widen** (spec §2.5, Table 6). `BuildCaptureNotSent` holds nine words: `no-test-box`, `no-runner`,
  `build-absent`, `path-refused`, `not-started`, `busy`, and the copy's `copy-refused`, `copy-failed` and `no-admin-lane`. The
  transport (`server/src/testboxCapture.ts`) answers each refusal and seam answer as itself, where PR 1 folded four into
  `no-test-box` or `no-runner` with a log line. A not-sent word counts no attempt and never counts toward a failed verdict.
  `claude_builds.notSent`'s CHECK takes the nine by a table rebuild (one migration). The Test box card says each word.
- **The verdict cut** (F1, F2). A build whose `type` fails because it is gone fails, naming the events never recorded; a
  launcher that cannot type into a live build answers no verdict. At any unfinished stop, a build that is not alive and
  recorded nothing answers no verdict (a box fault); a live build with events missing fails. A launcher that could not start
  answers no verdict, as before.
- **The cleanup** (F10). The runner waits, bounded, for the build to be gone after `stop`, then removes the capture
  directory in a try of its own, so a failed removal never replaces the answer. A failed `new-session` runs `kill-server` on
  the capture's socket before it throws, and `stop` runs once. The build's `TMPDIR` is `<capture>/tmp`, under the write guard.
  The test service removes stale `captures/<id>/` directories (a capture id only, never `builds`) once at start.

## Departures, by slug

- **build-absent-before-no-runner.** The capture desk's refusal order becomes role, build, runner, write guard (it was role,
  runner, build, write guard). Without it a box with no runner (this PR wires none) never answers `build-absent`, so the copy
  never runs and the spec's "after it lands, the box holds the build's bytes" cannot hold. PR 3 pins the whole order (F9).
- **build-copy-own-file.** `ccd/ccrc-testbox-admin` sits near its growth cap, so the sub's body lives in
  `ccd/testbox-build-copy`. The timeout changes in #3225 brought the combined file above the cap. Move the Bash field table
  unchanged into `ccd/testbox-admin-fields` rather than raising the cap; the Bash/TypeScript parity tests still read the
  table through the same verb.
- **build-copy-recorded-on-its-row.** The sub's spec row records no ledger act (`act: null`, as the reads do): the server
  composes it unattended, and the build's own `claude_builds` row records what it came to. It is reachable from the console's
  admin route like every other sub (account gate, no step-up: it puts no credential or pin).
- **copy-in-the-short-bound.** The copy is a short sub, so the agent's 60 s bound for a short `testbox-admin` call covers
  verify, stream, hash and install (a build is about 380 MB). A slow link that outruns it loses the answer, which the
  adapter reads as `copy-failed`; the copy may have landed, and the next pass finds out, because the box answers
  `build-absent` only for a build it does not hold. A detached copy is later work if a box's link needs it.
- **copy-words.** A failed copy leaves one of three words: `copy-refused` (the fleet's copy is not one ccrc sends: absent,
  not a regular file, over the cap), `no-admin-lane` (no lane: not connected, no access key, an arm or agent without the op)
  and `copy-failed` (everything else, a lost answer included).
- **not-sent-words-widen-the-wire.** The wire list's reader (`readClaudeBuildRecords`) refuses a row whose `notSent` it does
  not know, so a console tab loaded before this release reads the list as unreadable until it reloads, once a new word is
  recorded. Server and console ship together, so only a stale tab sees it.
- **capture-memory-limit-not-allowed.** The test service's unit (`deploy/testbox/systemd/ccrc-testbox.service`) has no
  `MemoryMax=` and no `Delegate=`, so a capture that runs as its child cannot get a memory limit of its own. The spec's Later
  list already holds the capture in a unit of its own; the limit goes there.
- **migration-slot.** The rebuild takes 122 after #3170, #3169 and #3224 (main at `a540d15153` held 121). It preserves
  #3170's `fails INTEGER NOT NULL DEFAULT 0` in the new table and copies the existing values. A migration test covers
  nonzero counters on both a queued retry and a failed build.

## Peer agreements

- Run 3213 (claims 6415, 6416) agreed to the packet against `main` b288654746 for `shared/claudeBuildTrust.ts`,
  `server/src/buildCaptureLane.ts`, `server/src/coord/schema.ts` and `pwa/src/fleet/TestBoxBuilds.tsx`, with one wording
  change, made: the card says ccrc tries again "within the hour", since a try that sends nothing stamps the retry clock.
  Its terms: keep "that gives up" in the lane's header on merging #3170; a not-sent word never counts toward `fails`.

## Follow-ups

- PR 3, as the spec's Table 7 says, and the desk's whole refusal order pinned there (F9).
- A detached copy, if a box's link cannot carry a build inside the short bound.
