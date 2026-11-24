# Capture runner PR 3b: the runner wired, and the build copy hardened (run 3657)

The task note of run 3657, wave 222 of the overlord programme (issue #2491). The spec is
`docs/superpowers/specs/2026-11-22-build-capture-runner-design.md` (§2.3 to §2.6, §5 Table 7's PR 3 row). The notes before
it are `capture-runner.md` (PR 1), `capture-runner-pr2.md` (PR 2, the copy) and `capture-runner-pr3.md` (PR 3a, whose
"PR 3b acceptance gates" this pull request meets). This note records what the ledger should learn; the coordinator folds it
into the ledger on its own pull request.

## What a merge arms

This pull request turns the runner on. Until now the test box's capture desk answered `no-runner` to every capture, so
every new Claude Code build stayed `capture-queued`. Once a box runs this release (its tool sync takes the release), a
capture the server sends is run: the build is copied to the box if the box does not hold it, driven against the stand-in
model, and its replay's verdict comes back. A pass makes the build trusted. A fault of the box is never a failed verdict.

## What this pull request delivers

- **The wiring** (spec §2.5, Table 7). The test service's entry point builds the runner and the real tmux launcher and hands
  them to the desk (`agent/src/testbox/main.ts#captureDeskFor`, `#captureRunnerFor`, `#captureDeskWith`). The capture's tmux
  directory goes under the service's temporary directory (`capture.ts#captureTmuxDir`), and a service whose temporary
  directory is too long for the socket wires no runner, so its box answers `no-runner` as before. The recorder is the
  compiled one beside the entry point, named by path and never imported (`main.ts#compiledRecorder`). The builds store is
  pruned at the service's start and after each capture, never of a build a queued capture needs (`main.ts#pruneBuilds`,
  deciding by `capture.ts#buildsToPrune`).
- **G1, one timing contract.** `capture.ts#CAPTURE_TIMINGS` now holds every bound of a capture: the step, exit and poll
  timeouts, the per-call tmux bound, PR 2's stop wait, a bound on the stand-in's close, and two allowances (the setup and
  the removal). The entry point builds the runner and the launcher from it, and the desk's late check reads the same object.
  `captureWorstCaseMs` counts the runner as wired. The gate's test (`agent/test/testbox-capture-deadline.test.ts`, "gate
  G1") composes the production desk and runner with the real launcher on a virtual clock: every tmux call takes its whole
  bound, every step's events land only at its limit, the build never exits and outlives the stop wait, and the stand-in's
  close never ends. Each of two queued captures ends at exactly the time those limits add up to (`captureWorstCaseMs` less
  its two allowances and the polls' overruns, which this clock never takes), and the second ends, with its margin, inside
  `TESTBOX_CAPTURE_DEADLINE_MS`; a build that stalls at its last step ends that step's limit later, less the exit wait.
  Measured exactly, so a bound the composition hands the runner other than the contract's shows as a difference. The
  launcher's every call is asked at the contract's bound, and the runner's stop wait and close bound are required
  dependencies, with no default of their own.
- **G2, the takeover admission gate.** The desk reads the tool sync's `admitting`. While it is closed (a takeover, or a
  drain) no capture starts: every waiting capture is ended with no verdict and `CAPTURE_CLOSED_DETAIL`. Pinned in the desk
  and through `serviceFor`'s own desk with a drain standing.
- **The full refusal order pinned** (review 3226 F9): role, build, runner, write guard, capture id, in one case that cures
  one fault at a time.
- **The transport's dropped detail logged** (F9): a reply that brings back no verdict and carries a detail (the box ended
  with none, the job went unanswered, no box or no hello) writes one server log line naming the build, the outcome and the
  detail. A refusal's detail is its word's own sentence and a verdict is kept, so neither is logged.
- **From the first containment review of PR 2 (review 3623).** The desk runs only a build file of its own: a regular file,
  not a link, with no second hard link, reached through no link below the box root's real path
  (`capture.ts#capturedBuildUsable`, read through `lstat` by `main.ts#buildFileFacts`); anything else reads as absent, so the
  lane's next pass copies a fresh one. The build's life is one of three words (`alive`, `gone`, `unknown`), and `unknown`
  is never read as `gone`: wherever the verdict turns on it, the capture answers no verdict. The launcher reads the life
  from the build's own process group (tmux prints the pane's process at creation, and the build is started by `exec` of
  its path as one quoted shell word, so the pane's process is the build), never from its terminal server; its stop kills
  the private server, then tells the group to end.
- **From the second containment review of PR 2 (review 3641).** The copy's writer keeps its four store refusals, and is
  now first asked them in a mode that changes nothing, under the same privilege drop and with no stdin, before any byte is
  streamed, so a store fault that stands costs no stream. The box root's proof gains its mode: not writable by group or
  other. A case now fails when the trailing slash is no longer stripped from the stage parent's name. The program's header
  and PR 2's note are corrected (PR 2's note: fix round 1's reversed words, the backfill among the departures, what Repair
  can and cannot cure, and the box root's mode in the "assumes" list).
- **Small points of `capture-runner.md`'s "Left, and why".** The build's path as one shell word, a launcher that cannot
  tell read as exited, the dead fallback in `readCaptureRecords`, and the desk's queue entry kind (`capture`, a fourth kind
  under the probe's one-at-a-time rule, in place of `probe`).

## Departures, by slug

- **refuse-links-not-rehash** (review 3623 offered either; the coordinator's ruling, programme call 925). The desk refuses a
  build reached through a link, or one that holds a second name, and does not hash the build again. What a pass comes to
  after that refusal, measured in both shapes: a regular file with a second name reads as absent, the next pass copies the
  build once and the writer replaces the name with a file of its own (the other name keeps its bytes), and the capture runs;
  a link at the build's name reads as absent, and the copy is refused `build-store-refused` (the lane's `copy-failed`) by
  the writer's check before any byte is streamed, on every pass. Neither the copy nor the box's Repair cures that link:
  Repair re-runs the installer, which makes the service's directories and never touches the builds store; the builds
  store's prune removes it only once three newer builds are held.
- **The limit, as a property.** A pass speaks for the bytes the box held when the build ran. The builds store is checked
  when a build is copied, and is not proof against the capture's own user. The capture as a user of its own is the spec's
  Later hardening.
- **store-checks-before-the-stream** (review 3641 offered a read-only check or a back-off). The check is the writer's own,
  in a mode that makes nothing, run as the service user with no stdin, so root never reads the service user's tree and there
  is one statement of the store's rules. The writer asks again when it writes, since that tree can change between the two.
- **unknown-life-is-no-verdict** (review 3623). A launcher that cannot tell whether the build lives answers no verdict at the
  three points the verdict turns on (after a failed type, in the exit wait, and with nothing recorded); the stop wait keeps
  waiting, to its bound, while the life is not `gone`.
- **closed-admissions-end-the-wait** (G2). A capture that waits while admissions are closed is ended at once rather than
  held: a held capture would keep a drain from ever reading the service as quiet, and the fleet agent stops waiting at its
  deadline anyway. The server reads it as `unanswered`, one attempt, never a failed verdict.
- **capture-tmux-outside-the-socket-lookup** (legitimately different: another host and another server). Every other tmux call
  in the tree goes through the fleet's one socket lookup (D-8270). The capture's tmux server is its own, on the test box,
  under its own `-L` name and tmux directory, so the lookup does not apply; the entry point's one `tmuxLauncher('tmux', …)`
  is a named exception in `server/test/tmux-socket-census.test.ts`.
- **recorder-named-not-imported**. The entry point names the compiled recorder as its own sibling rather than importing
  `captureRecord.ts`, which stays an entry point of its own (`testbox-imports.test.ts`); the compiled test pins that the name
  is where the recorder lands.
- **desk-composed-in-two** (G1's test). `captureDeskFor` checks the socket and builds the runner; `captureDeskWith` builds the
  desk around a runner. The gate's test composes the same two functions with a runner built for a virtual clock, so no test
  writes a short system temporary path.
- **left: the drive's failure line naming the step.** The replay already names every event never recorded; naming the step
  would widen the L0 replay's input, which the Desktop polish programme plans against. Left for the coordinator.
- **left: the private server's session name `cc-capture`.** The session is named and addressed only through ccrc's one tmux
  spelling (`shared/tmux-target.ts`), which prefixes every name; the server is the capture's own, so no fleet session can
  meet it.
- **left: the lane's header** already no longer names "the existing test box connection" on main.

## Mutants, each removed in turn and measured

The build copy (the box programs and the host's words), run against `server/test/testbox-admin-acts.test.ts`'s build-copy
cases:

| Guard removed | Killed by |
|---|---|
| the box root's mode check | a box root writable by its group, by others, or sticky and writable by all |
| the writer's check before the stream | each of the writer's six faults refuses before the stream, at the check |
| the check makes nothing (it made the builds directory) | a copy whose stream then fails leaves no builds directory |
| the check stops before writing | the one hand-over, and the stream's order |
| the check's empty stdin | the check is given no stdin |
| the strip of a trailing slash from the stage parent | a stage parent that is a link, named with a trailing slash |
| the writer's link check where the build goes, when it writes | each fault given to the writer itself in write mode |
| the writer's link check at `captures` and `captures/builds`, when it writes | the same |

The wiring, against the four capture test files of the agent package (and the managed-node suite for the `serviceFor` join):

| Guard removed | Killed by |
|---|---|
| the build is usable only with one hard link | a second hard link of another version (desk, and the decider) |
| ... only when it is not a link | the decider's case for a reader that follows links |
| ... only at its own real path | a link at `captures` or at `builds` on the build's path (desk, and the decider) |
| ... only when it is a regular file | a directory at the build's place; the decider |
| the desk resolves only the box root (it resolved the builds directory) | a link at `builds` |
| the desk's closed-admissions branch | G2's three cases, in the desk and through `serviceFor` |
| the prune after a capture; the prune given the builds still queued | the desk's prune cases |
| the late check reading the contract it was given | a wait the given contract fits starts where the default would end it |
| an unknown life read as gone (the throw's catch) | a `life()` that throws after a failed type |
| unknown life after a failed type; in the exit wait; with nothing recorded | the three cases, each no verdict |
| the stop wait reading unknown as gone | the stop wait polls to its bound while the life stays unknown |
| the stand-in's close bound | a close that never ends; G1 |
| the tmux directory's removal | every capture case's clean-up check |
| the runner's clock | G1 |
| the build's path as one quoted shell word | the launcher's start case |
| tmux printing the pane's process; a process 1 refused | the launcher's start and three refusal cases |
| the stop's signal to the build's group; the group read as one process | the stop case; the life case |
| `EPERM` read as alive; any other failure read as unknown | `groupLife`'s cases |
| the contract's stop wait, or step limit, in the composition (doubled) | G1's exact times, at every limit and stalled at the last step |
| the contract's tmux bound in the composition (the launcher's default) | G1: every call asked at the contract's bound |
| the contract's stand-in close bound in the composition | the runner's deps now require it, so the typecheck fails |
| the socket check in the composition | a base too long for the socket refuses `no-runner` |
| the admissions in `serviceFor`'s desk | G2 through `serviceFor`, a drain standing |
| the prune in the composition | `captureDeskWith`'s prune case |
| the worst case counting the teardown | the worst case's formula; G1 |
| the capture queue kind's one-at-a-time rule | the queue's case |

33 mutants. On the first pass 27 were killed. Five survivors became cases or a required dependency, and each was then
killed. The sixth, the close bound dropped from the composition, survived only because the runner's default equalled the
contract's. The default is gone, so the typecheck now kills it.

## What only a real box shows

- That tmux on the box prints the pane's process for `new-session -P -F '#{pane_pid}'`, makes it a group leader, and that
  `exec` keeps the build in that process. Checked once on the fleet host against a private socket in the session's
  temporary directory (a build stand-in that ignores a hangup was ended by the stop); the suite's real-tmux case runs only
  where the temporary path is short enough for the socket.
- That the service's temporary directory is private to its unit and short enough for the socket (the unit's private
  `/tmp`).
- That the box root on an installed box is not writable by group or other (the installer makes it so; the copy now refuses
  one that is).
- Everything PR 2's note lists for the copy's box step.

## How this was measured

- Local runs, through the fleet's test wrapper with its local switch, for the build copy's and the runner's files (the
  coordinator's caution: a fixture of those files must never meet a real box's layout). The wave's first run of the build
  copy's cases was routed by the wrapper to the test box, because the worktree had no packages installed yet; it ran
  fixtures only, and the coordinator ruled it the fleet's own act, not an admin act.
- The agent package's whole suite and its tests-inclusive typecheck, green. On the server, every file that reads a changed
  path or scans the tree (73 files, each run alone; the tests-inclusive typecheck is left to CI, as in PR 2, because the
  test slice's memory cap kills it here): green, except four that are red on a clean checkout of `main` in this
  environment too (the shellcheck ratchet on another file, the box package's and the installer's characterizations under
  this checkout's file mode, and the wrapper's suite run inside the wrapper), and one load flake that passed alone
  (`deviation-refs`).
