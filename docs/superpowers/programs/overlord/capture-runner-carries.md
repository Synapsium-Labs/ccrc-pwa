# Capture runner: the wiring's review carries (overlord wave 231, run 3774)

The capture runner's wiring (#3347) merged with ten smaller points from its last review (review 3765) carried by the
coordinator (programme call 1116). This run closes them, built to the coordinator's rulings (call 1127, and call 1134 for
how F3 and F4 are measured). Spec: `docs/superpowers/specs/2026-11-22-build-capture-runner-design.md`; the wiring's notes:
`capture-runner-pr3b.md` and `capture-runner-pr2.md` beside this one. No deviation number was allocated for this run;
departures are named by slug below. Nothing here changes the verdict, the trust record, a frame's shape, the desk's
refusal order, a timing value, a route, a setting, an op or an egress.

## Each point

| Point | What was done | The red shown for it |
|---|---|---|
| F1, the copy's exit clean-up | `ccd/testbox-build-copy`'s root program forgets the stage's name as soon as it removes the stage on purpose (one assignment), so the clean-up names the stage and nothing else at every instant. The header's sentence now says so. | Without the assignment: a new behavioural case (a later exit, the hash refusal, after a directory is made again under the freed name, leaves that directory and its file untouched) and the order's text pin (the name forgotten right after the removal, never used after) both go red. The behavioural case runs as an ordinary user on fixtures. |
| F2, gate G1 | The composer hands the desk the very timings object it builds the runner from (`captureDeskWith` takes it as a parameter, no second reference to the constant). G1 now queues a third capture, late by the contract and ended with no verdict; pins the desk's late limit exactly from both sides (a capture that waited the last instant the contract leaves runs, one that waited a millisecond more is ended late); and pins the interval the runner sleeps between polls. | A desk on a looser contract (a step limit 1 ms shorter) and on a stricter one (1 ms longer): the late-limit case goes red each way. A runner polling every 1000 ms or every 250 ms: the three-capture case goes red on the poll (`[1000, 2000]` against `[500, 2000]`). |
| F3, the real-tmux case | The case now reads how tmux reports the pane was started (`#{pane_start_command}`) and holds that it is the two words, the start program then the build's path, which tmux runs with no shell (its manual). The reading is a pure helper (`paneStartReading` in the runner's test file) with unit cases; an empty, missing or other report reads as "cannot tell", never as a pass. The case's title and comment say what it proves. The fake-tmux argument-tail case stays. | At unit level: a one-word report and a joined, quoted one read as "through a shell", so the real case's assertion fails for a one-word pane. Helper mutants: accepting any report that holds the build's path goes red on two cases; reading an empty report as a pass goes red. The real case's own red for a one-word pane was NOT measured locally (see the limits). |
| F4, reading the pane's environment | The case waits, bounded (10 s), until the pane's process is no longer the multiplexer's own image and lists an environment, then reads `SHELL`. The wait is a pure helper over a reader (`environOnceExecuted`), with unit cases on a virtual clock. No product change. | A helper that takes the first read: both unit cases red. A helper with no bound: the never-changing case ends at its 5 s case timeout, red, instead of hanging (its fake sleep yields to the event loop so the timeout can fire). The ten runs of the real case were NOT made locally (see the limits). |
| F5, the pane command's path | The builder (`captureRunner.ts#capturePaneCommand`) accepts only an absolute path of letters, digits, `.`, `_`, `/` and `-` (departure `plain-path-set`). Any other path is refused before any tmux call, as a fault of the box with no verdict; a runner case shows a refused path ends the capture with no verdict and no tmux call. No gate on tmux's version. | The check removed: ten refusal cases and the no-verdict case red. An endings-only check (trailing `;`): seven refusal cases and the no-verdict case red. |
| F6, a case's title | `server/test/testbox-admin-acts.test.ts`: the case for a stage that cannot be made is retitled to what it holds (an inherited path under the stage's name untouched), and its comment says the clearing itself is held only by the text pin. | None owed: a retitle. |
| F7, termination words | The copy's header and the PR 3b note say the measured property: a hangup or termination delivered to the copy's shell leaves no stage; a kill, or a signal that also reaches the tool making the stage, can leave one empty directory only root can enter. | None owed: words. |
| F8, the answer word | The header, the writer's comment and both notes say the writer's answer reports what its check saw before the stream, not what the rename replaced. No code change. | None owed: words. |
| F9, a departure's sentence | The PR 3b note's `capture-shell-fixed` now says the pane already had `SHELL` and this fixes its value, and that §2.3's list was already short of the capture's environment. The spec is the coordinator's to fold. | None owed: words. |
| F10, stale words | (a) the PR 2 note: the retired link refusal, the count of store refusals, "followed or replaced", and the macOS pin's GNU lines. (b) the copy program's success word. (c) the start program's comment in `captureRunner.ts`. (d) the runner test's describe-level comment. (f) the PR 3b note's mutant table rendered as one table. (g) the PR 3b note's run ids: the first tip's run and the later head's run, each named. | None owed: words. |

The PR 3b note's other passages that F3 named (the real case's description, the mutant row, the measurement under a
login-refusing default shell, and "the cases stand in for it with `SHELL`") now say they predate the fixed default shell
and point here.

## The measurement behind F3's fixtures

On tmux 3.6, on a private server under this session's own temporary directory, with the default shell set as the
launcher sets it: a pane started from two words was reported as the two plain words; a pane started from one word as that
one word; and a pane started from the two joined into one word as one double-quoted word. The unit cases use those three
shapes with a neutral path in place of the measured one.

## Departures, by slug

- **plain-path-set** (F5; the coordinator offered either). The builder allows a plain character set for the whole path
  rather than refusing particular endings. The root part of a build's path is the box root, which the fleet's copy accepts
  only in the same set (`ccd/testbox-build-copy` refuses any other root before it reaches the box), and the rest is
  `captures/builds/` and a version of digits and dots, so every build the copy can place still passes. Nothing in the set is
  read specially by tmux's argument parser or by a shell, so the property holds without knowing every reading a tmux
  version makes. A box whose configured root holds another character could never receive a copied build anyway.
- **desk-timings-parameter** (F2). `main.ts#captureDeskWith` takes the timings as a required parameter, so the one caller
  outside the composer (the desk test's prune case) names the contract it hands over.
- **late-limit-both-sides** (F2). Beyond the third queued capture the report suggested, G1 pins the desk's late limit at
  its exact value from both sides, by moving the virtual clock as the first capture ends: the third capture alone goes red
  only for a much looser desk contract.
- **pane-start-helpers** (F3, F4; call 1134). The two helpers and their unit cases live in the runner's test file beside the
  real-tmux case that feeds them; no product code was added for them.

## Known limits

- The two real-tmux cases skip in this session's lane: the test run's directory is made under the real path of the
  session's temporary directory, and a capture socket under it is past the 100-byte limit the cases check. On the
  coordinator's ruling (call 1134) nothing ran with a temporary root outside the session's own. So the real case's red for
  a one-word pane and the ten runs of the F4 case were not measured locally; the pull request's agent test job is where
  both cases run (its log is read in the wave-done).
- The start-command report was measured on tmux 3.6 only. CI's agent job runs the image's own tmux; whether that version
  reports the same shape is read from that job's log, not measured here. No gate on tmux's version (a known limit, as
  ruled).
- The exact late-limit cases rely on the desk deciding the next capture's lateness in the same turn as the previous one's
  end frame, which is how the desk is written today; a desk that deferred that decision would make the cases read a later
  clock.
- A kill of the copy, or a signal that also reaches the tool making the stage, can leave one empty directory only root can
  enter, in root's temporary folder (F7, unchanged).
- The server's tests-inclusive typecheck is killed by the test slice's memory cap in this lane, as in PR 2; CI is its
  arbiter. The server's source typecheck and both of the agent's typechecks are green here.

## How this was measured

Each file alone, through the fleet's test wrapper, locally, fixtures only. Agent: the capture runner (60 passed, the two
real-tmux cases skipped), desk (40), deadline (15), paths (16), managed-node (77) and imports (7) files; the agent's source
and tests-inclusive typechecks. Server: the admin acts (161), the copy's adapter (28), the macOS platform pin (130 passed,
11 skipped on Linux) and the tmux socket census (19) files; the server's source typecheck. Shellcheck of the copy program is
clean before and after. The reds in the table above were each made by changing one guard in place, running the file (or
its named cases) through the wrapper, and restoring the file's bytes.
