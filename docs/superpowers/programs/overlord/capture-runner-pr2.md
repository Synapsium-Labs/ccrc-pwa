# Capture runner, PR 2: the build copy, the not-sent words, and the runner's verdict cut (run 3237)

The task note of run 3237, wave 201 of the overlord programme (issue #2491). The spec is
`docs/superpowers/specs/2026-11-22-build-capture-runner-design.md`; this pull request builds its PR 2 row (§5, Table 7), with
review 3226's findings F1, F2 and F10 carried from PR 1 (`docs/superpowers/programs/overlord/capture-runner.md`). This note
records what the ledger should learn; the coordinator folds it into the ledger on its own pull request.

## What this pull request delivers

- **The copy** (spec §2.2, Table 2, D3, D7). A new short admin lane sub, `ccrc testbox-admin build-copy --version=<build>`, in
  its own sourced file, `ccd/testbox-build-copy`. On the fleet host it reads the build in Claude Code's versions directory,
  never writing it: the file must exist, be a regular file and not a link, and be at most 1 GiB, and it is hashed. Its bytes
  stream over the lane in one box call, whose program stages them where only root can enter, hashes them, and hands them to
  a writer that runs as the owner of `captures` (the test service's user), which places them read only at
  `<box root>/captures/builds/<version>` (fix rounds 1 and 2, below). Each refusal is its own code (`build-not-on-fleet`, `build-not-regular`, `build-too-large`,
  `build-hash-mismatch`, `build-store-refused`, `build-copy-failed`), and the stage is removed on every way out. The server's adapter, `server/src/testboxBuildCopy.ts`, runs that one sub through the one admin
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
- **migration-slot.** The rebuild takes 124 after #3275 (main at `c7f7e84bca` held 123; it was 123 at `861e10287c`, and 122
  on the earlier base at `a540d15153`). It preserves
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

## The clean branch (run 3595)

#3239's range carried, in every commit, one test fixture line holding a version-like string that the history guard reads as a
public address. The guard reads every blob a range introduces, so no commit on top could cure it. Run 3237 rebuilt the same
five commits with that line corrected and added a sixth that repairs the CI guards; run 3595 brought that candidate
(`334e93ad92`) onto a fresh branch with one ordinary merge, against `main` at `861e10287c`, and this pull request replaces
#3239. None of #3239's five commits is an ancestor of this branch.

The merge conflicted in exactly the three paths the brief named, resolved as the two read-only packets proposed:

- `server/src/coord/schema.ts`: Capture's rebuild is appended as 123 after `main`'s unchanged 122. Only the slot heading,
  the temporary table's suffix (three places) and the comment naming the base and count changed; the columns, the row copy,
  the CHECK and `fails` with its default are as built. Against `main` the file only gains lines.
- `server/test/coord-db.test.ts`: both entries kept in each historical list, and the three head-version assertions read 123.
- The architecture inventory keeps `main`'s rows byte for byte and gains `testboxBuildCopy.ts` in the C2 row.

The packets' three follow-ups outside the conflicted files: the designated-class test's post-open assertion reads
`COORD_SCHEMA_VERSION`; the run-close-switch test's commentary names 123 and seventy entries replayed (54 through 123), its
fixture already dropping `claude_builds`; and the slot statement above.

- **packet-bases-moved.** The packets were measured on older mains. The schema packet's input blob was not `main`'s at
  `861e10287c` (its hunk applied two lines lower, with its context unchanged), and neither was the architecture packet's (the
  C2 row and its neighbours were unchanged). The DB test's input blob matched. The schema packet's comment named `7e41029d65`
  as the base holding 122; it names `861e10287c` now. No line of either packet was otherwise wrong.

## The second merge of main (fix round 1)

Before fix round 1 was pushed, #3275 landed the coordinator advisor's migration in slot 123, and the branch conflicted with
`main` at `c7f7e84bca` in four files. One more ordinary merge resolved it the same way: `main`'s 123 unchanged, Capture's
rebuild appended as 124 (only its slot heading, table suffix and base comment changed again); the DB test keeps both entries
and reads 124 at the head; the run-close-switch commentary names 124 and seventy-one entries replayed (54 through 124); and
the designated-class test takes `main`'s side, which had made the same change to read the schema version constant.

## Fix round 1: the copy's box step hardened

(Fix round 2 below moves the writer's identity from the box root's owner to the owner of `captures`, and moves every check
that needs no bytes before the stream. The rest of this section stands.)

The coordinator's ruling (programme call 822) took the build copy's box side out of "as built" and set five properties. The
copy is now one box call, and its program holds them:

- **P1, the writes are the service user's own.** The program hands the checked bytes to a writer that runs with the box
  root owner's identity (util-linux's privilege drop, groups cleared), so every directory, file, mode and rename under the
  box root is that user's own act. Root changes no owner and no mode under the box root. A box root that is root's own (uid
  or group 0), a link, not a directory, or whose owner cannot be read as two numbers is never handed to.
- **P2, the stage is root's alone.** The bytes are staged in a fresh directory that only root can enter (mode 0700, made
  in root's temporary directory, refused if it would land under the box root), and removed before the hand-over and on every
  way out.
- **P3, one hash of the very bytes.** The program holds two reads of the staged file, removes its path, hashes from the
  first read and hands over from the second, in the same step. A hash that differs refuses `build-hash-mismatch` before
  anything under the box root is made.
- **P4, no link and no wrong kind.** A link or anything not a directory at `captures` or `captures/builds`, and a link or
  anything not a regular file where the build is placed, refuses with a word of its own, `build-store-refused` (a new code,
  mapped to `copy-failed` by the copy port's adapter), and changes nothing on the box.
- **P5, unchanged.** The answers, the existing codes, the verb's lock, the size bound and the host-side verify are as they
  were; the store's result is the build at its version name, mode 0555, owned by the service user. The host no longer
  removes a stage by a second call: the box removes its own.

The box programs sit in a marked box-side region of `ccd/testbox-build-copy`, which the macOS scan now cuts and pins (exactly
the two programs, and one GNU line, the hash), as it does the admin verb's own region.

**Tests, measured by mutation.** The box programs run for real against fixture roots, with shims on the search path standing
in for the privilege drop, recording which acts ran dropped, and tampering at the two moments that matter. Each guard was
removed in turn (15 mutants, applied in place and restored byte for byte) and each was killed:

| Guard removed | Killed by |
|---|---|
| the privilege drop | P1: every write under the root runs dropped; the one-call shape |
| the refusal of a root-owned box root | P1: a box root owned by root's uid, or root's group |
| the check that the owner reads as two numbers | P1: an owner that is not a number, or cannot be read |
| the refusal of a stage under the box root | P2: a stage that would land under the box root |
| the stage's removal before the hand-over | P2: already removed at the hand-over; no stage left; P3: bytes changed after the hash |
| the stage's removal on a refusal | P2: a stage that would land under the box root (removed) |
| the hand-over from the held read | the install itself, and P3 |
| the hash gate | P3: a hash that differs |
| the box root link and kind check | P4: a box root that is a link |
| the link check at `captures` and `captures/builds` | P4: a link, or a dangling link, at either |
| the kind check at `captures` and `captures/builds` | P4: a file at either |
| the link check where the build goes | P4: a link, or a dangling link, there |
| the kind check where the build goes | P4: a directory there |
| the host's word for exit 4, and for exit 5 | the host answers `build-hash-mismatch`, and `build-store-refused` |

The cases the ruling named are all there: a link planted at the stage at the hand-over; a link at `captures`; a link at
`captures/builds`; a non-regular file at the destination; bytes changed after the hash.

**What only a real box shows.** No test runs as root, so these rest on reading the program and on the box's userland:
that root's 0700 stage directory is out of the service user's reach; that the privilege drop really changes the identity
and clears the groups; that the box's sudo leaves root's temporary directory outside the box root; and that the box's
`ls` prints owner and group as numbers. The box runs the fleet host's own distribution release (the preflight's `os`
check), whose util-linux carries the privilege drop.

## Fix round 2: the identity, the store's layout, and refusals before the stream

The coordinator's ruling on review 3623 (programme call 865). On an installed box the box root is root's, and the
installer made no `captures`, so fix round 1's copy refused on every installed box. This round:

- **The layout.** `captures` is one of the service's own directories, made by the installer's run-root step
  (`deploy/testbox/box-steps`, `tbs_run_root_dirs`) beside `results`, `logs` and `out`, with their mode (0750) and owner (the
  service user). A fresh install, every reapply and every repair run that step.
- **The backfill, a second writer of one fact (programme call 868, slug `captures-backfill`).** The copy's root step makes
  `captures` itself when it is absent, only directly inside a box root it has just proved a real directory owned by root,
  with the installer's mode, owner and group. The recorded reason: the unattended tool sync never re-runs the installer,
  and the box's own updater has no driver yet, so without the backfill a box installed before this release has no
  `captures` until an operator acts. In a parent only root can write, a directory root has just made cannot be renamed or
  replaced by anyone else, so handing it over there is no race. The pin: one case reads the installer's step and the copy's
  program and fails when the name, the mode or the owner rule of `captures` differs between them.
- **The identity is the owner of `results`, read as numbers.** The admin verb does not hold the configured service user's
  name: it reads it only while pairing, and its state keeps no copy. So the copy reads the owner of the installer-made
  `results` directory instead. That is trusted because its parent is root's: the copy first requires the box root to be a
  real directory owned by root, then `results` to be a real directory, not a link, owned by a user and a group that are not
  root; and `captures`, when present, to be a real directory owned by exactly that user and group. Anything else refuses
  `build-store-refused` and changes nothing. No name has to travel to the box.
- **Every refusal that needs no bytes comes before the stream:** the box root, `captures`, the identity, and the stage's
  parent. A lasting refusal costs no stream. Only the hash check comes after the bytes.
- **Each refusal says one word** on the box's output (`box-root-kind`, `box-root-owner`, `results-absent`, `results-link`,
  `results-kind`, `results-owner`, `captures-link`, `captures-kind`, `captures-owner`, `stage-parent`, `stage-under-root`,
  `hash`, and the writer's `builds-link`,
  `builds-kind`, `target-link`, `target-kind`). The fleet host's admin log keeps it beside the verb's code, and a word off
  its grammar is logged as `unsaid`.
- **The stage's parent** (root's temporary folder) must be a real directory, owned by root or sticky. It must not be under
  the box root, compared after dropping a trailing slash from both.
- **The writer** starts in the box root (root changes into it first, since the drop tool has no working-folder flag), with
  a reset environment, groups cleared, and no inheritable capability. It holds neither of the copy's two reads.
- **The stage is removed** before the hash, and on every exit the box's shell sees: a hangup, an interrupt and a
  termination now end the shell through its exit trap. Only a kill during the stream can leave a stage: one directory
  only root can enter, in root's temporary folder, holding what had arrived of the stream.
- **The adapter's fold** (review F7). `server/src/testboxBuildCopy.ts` still folds the verb's refusals into the lane's three
  not-sent words, and now writes one server log line per typed refusal, carrying the verb's own code (a code off the word
  grammar is logged as `unreadable`). Why the fold is safe: the lane's only decision on a not-sent word is to try again
  within the hour without counting an attempt, and every word answers that the same way. What tells an operator why is
  the verb's code, which this line and the fleet host's admin log both keep.
- **The card's sentence** for `build-store-refused` says what is wrong and what cures it: the box's folders are not set up
  the way its installer makes them (a box root that is not root's, or a `results` or `captures` that is a link, a file or
  another user's), and Repair on the box's card fixes that.

**How an installed box gets `captures`:** the backfill, at the first copy; the installer's run-root step, at any install,
reapply or repair; and the box's own updater (`deploy/testbox/bin/box-update`, whose render step runs the same step) once
the managed-node design's driver runs it.

**What the code guarantees, and what it assumes of the box.**

| | |
|---|---|
| Guarantees | no write under the box root as root but the backfill of an absent `captures`; a box root that is not a real root-owned directory, a `results` that is not a real directory of a non-root owner and group, and a `captures` that is not a real directory of exactly that owner and group, are refused before any byte is read; the stage is a fresh 0700 directory in a parent that is root's or sticky and not under the box root; the hashed bytes are the handed-over bytes; no link or wrong kind in the store is followed or replaced |
| Assumes | the box root's ancestors are not writable by the service user (the installer's path policy); root's temporary folder on the box is root's or sticky (refused otherwise); the box's `ls` prints owner and group as numbers with `-n`; util-linux's privilege drop takes the flags used; nothing but a kill ends the shell untrapped |

**Tests, measured by mutation.** Every guard of the copy's box programs, the host's words, the adapter's log line and the
installer's `captures` was removed in turn (applied in place, measured, restored byte for byte). The full table is in
the section below.

**What only a real box shows**, beyond fix round 1's list: that the box root is root's and `results` and `captures` the
service user's on an installed box (the installer's run-root step makes them, and the characterization test pins the
step); the backfill on a real installed box; and that root's temporary folder is root's or sticky.

**Bookkeeping (review F11).** The spec's §2.2 describes the copy as the repair sub's three phases; the copy is one box
call (the coordinator amends the spec on the ledger's pull request). The candidate rewrote the migration case in
`server/test/decision-model-records.test.ts`: it builds the predecessor database from the historical prefix of migrations,
instead of undoing every later entry. That stays correct when a later entry rebuilds a table (Capture's does), and it also
checks the rows the later entries seed. The admin verb's remote-call helper's header no longer says stdin carries only a
secret: it carries the build copy's bytes as well.

**Carried to PR 3 (review F3, F5, F6), no code here.**
- The capture desk's "build present" is any regular file reached through links, with no hash re-check, and the store is
  the service user's. PR 3 either re-hashes a build when it is captured or refuses links, so a build under capture cannot
  change another version's bytes before that version is captured. The spec's "checked copy" means checked when copied.
- A launcher that cannot answer whether the build is alive must not read as "exited".
- The runner's bounded wait must watch the build, not its terminal server.

