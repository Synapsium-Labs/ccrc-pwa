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
  G1") goes through the composer the entry point calls (`main.ts#captureDeskComposed`, which hands the runner and the desk's
  late check the contract; fix round 1, review 3687 F2), with the real launcher on a virtual clock: every tmux call takes
  its whole bound, every step's events land only at its limit, the build never exits and outlives the stop wait, and the stand-in's
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
  from the build's own process group (tmux prints the pane's process at creation, and the build is started with no shell
  between tmux and it, so the pane's process is the build; see fix round 1), never from its terminal server; its stop kills
  the private server, then tells the group to end.
- **From the second containment review of PR 2 (review 3641).** The copy's writer keeps its four store refusals, and is
  now first asked them in a mode that changes nothing, under the same privilege drop and with no stdin, before any byte is
  streamed, so a store fault that stands costs no stream. The box root's proof gains its mode: not writable by group or
  other. A case now fails when the trailing slash is no longer stripped from the stage parent's name. The program's header
  and PR 2's note are corrected (PR 2's note: fix round 1's reversed words, the backfill among the departures, what Repair
  can and cannot cure, and the box root's mode in the "assumes" list).
- **Small points of `capture-runner.md`'s "Left, and why".** The build's path handed to tmux as a word of its own (one
  quoted shell word at first, then no shell at all in fix round 1), a launcher that cannot tell read as exited, the dead
  fallback in `readCaptureRecords`, and the desk's queue entry kind (`capture`, a fourth kind under the probe's
  one-at-a-time rule, in place of `probe`).

## Fix round 1 (review 3687, programme call 996)

- **The build starts under the service user's shell (F1, which held the landing).** tmux runs a one-word command through the
  pane's default shell, which it takes from `SHELL` or else from the user's entry; the capture's environment carries no
  `SHELL`, and the installer gives the service user a shell that refuses logins, so on an installed box the pane would end at
  once and every pass would answer no verdict. The property now: no shell stands between tmux and the build. tmux runs a
  command of two or more words directly (its manual: "executed directly (without sh -c)"), so the pane's command is a fixed
  system program that replaces itself with what it names (`captureRunner.ts#CAPTURE_START`), then the build's absolute path,
  and no interpreter reads the build's name; the pane's process is still the build. A pane can never start the fixed
  program alone (alone, it would print the pane's whole environment into what the capture records; programme call 1003):
  the pane's command is built in one place (`captureRunner.ts#capturePaneCommand`), which refuses, before any tmux call, a
  build path that is missing, empty, blank, not absolute, or that holds an `=` (which that program would read as a variable
  to set); the runner answers such a start as no verdict.
  Measured on a private tmux 3.6 server with a login-refusing default shell: the one-word pane ended at once, the two-word
  pane lived. The service user's shell is unchanged, and no operator act is asked. A real-tmux case gives the capture's tmux
  server a shell that refuses logins (first showing that a one-word pane under it ends) and holds that the capture passes.
- **G1 through the composer (F2).** The hand-over of the contract is one function, `main.ts#captureDeskComposed` (the
  runner from `CAPTURE_TIMINGS`, and the desk around it on the same contract); `captureDeskFor` checks the socket's fit and
  calls it, and gate G1 runs through it.
- **The writer's checks at `captures` (F3).** A link and a file at `captures` join the faults given to the writer itself
  when it writes (the root program refuses them first in a whole copy, so only that path meets the writer's own check).
- **The start-up prune (F5).** The service's start calls one function, `main.ts#captureStoreAtStart` (the stale capture
  directories swept, then the builds store pruned with nothing in use), and a case pins what it removes. The one call to it
  in the entry point's `main` is, like the rest of `main`, not under test.
- **A link at the build's name is healed (the coordinator's item, from the measurement under call 925).** The desk reads a
  link at the build's name as absent, and the copy refused it on every pass, so the build stalled with a card that sent the
  operator to Repair, which cannot cure it. The property now: the next pass's one copy heals it, as it heals a second name.
  The writer, under the same dropped identity, replaces the link itself in the one rename that places the build; the rename
  never treats the name as a directory, so the link's target is never opened, followed, written or removed. The writer's
  answer, the verb's answer (`"replaced":"link"`) and one server log line say a link was replaced. Measured: a rename that
  may treat the name as a directory places the build inside a directory a link names. The directory checks stay refusals.

## Departures, by slug

- **refuse-links-not-rehash** (review 3623 offered either; the coordinator's ruling, programme call 925). The desk refuses a
  build reached through a link, or one that holds a second name, and does not hash the build again. What a pass comes to
  after that refusal, measured in both shapes: a regular file with a second name reads as absent, the next pass copies the
  build once and the writer replaces the name with a file of its own (the other name keeps its bytes), and the capture runs.
  A link at the build's name reads as absent too; until fix round 1 the copy refused it before any byte was streamed, on
  every pass, and neither the copy nor the box's Repair cured it. Since fix round 1 the next pass's one copy replaces the
  link with the build, its target untouched (above).
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
  in the tree, save the census's named exceptions, goes through the fleet's one socket lookup (D-8270). The capture's tmux server is its own, on the test box,
  under its own `-L` name and tmux directory, so the lookup does not apply; the entry point's one `tmuxLauncher('tmux', …)`
  is a named exception in `server/test/tmux-socket-census.test.ts`.
- **recorder-named-not-imported**. The entry point names the compiled recorder as its own sibling rather than importing
  `captureRecord.ts`, which stays an entry point of its own (`testbox-imports.test.ts`); the compiled test pins that the name
  is where the recorder lands.
- **desk-composed-in-two** (G1's test). `captureDeskFor` checks the socket's fit and calls `captureDeskComposed`, which
  builds the runner from the contract and the desk around it on the same contract (through `captureDeskWith`). The gate's
  test calls `captureDeskComposed` itself with the fit given, and virtual-clock seams, so no test writes a short system
  temporary path; the fit's own refusal has its case.
- **start-without-a-shell** (fix round 1, F1; the coordinator preferred it to naming a shell for the pane). The pane's
  command is two words, so tmux runs it with no shell; the service user keeps its shell.
- **link-at-the-name-healed** (fix round 1, the coordinator's item). A link at exactly the build's name is replaced by the
  build in the copy's one rename; a link or a file at `captures` or `captures/builds` still refuses.
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
| the writer's check before the stream | each of the writer's faults refuses before the stream, at the check (six in the first round; four since fix round 1 healed the two links at the build's name) |
| the check makes nothing (it made the builds directory) | a copy whose stream then fails leaves no builds directory |
| the check stops before writing | the one hand-over, and the stream's order |
| the check's empty stdin | the check is given no stdin |
| the strip of a trailing slash from the stage parent | a stage parent that is a link, named with a trailing slash |
| the writer's link check where the build goes, when it writes (first round; since fix round 1 a link there is healed) | each fault given to the writer itself in write mode |
| the writer's link check at `captures/builds`, when it writes | the same (corrected in fix round 1: the first round's row also named `captures`, which no case reached; see below) |

The wiring, against the four capture test files of the agent package (and the managed-node suite for the `serviceFor` join):

| Guard removed | Killed by |
|---|---|
| the build is usable only with one hard link | a second hard link of another version (desk, and the decider) |
| ... only when it is not a link | the decider's case for a reader that follows links |
| ... only at its own real path | a link at `captures` or at `builds` on the build's path (desk, and the decider) |
| ... only when it is a regular file | the decider's case in the paths file (in the desk, a directory at the build's place holds two or more links, so the hard-link guard refuses it first) |
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
| the build's path as one quoted shell word (first round; fix round 1 replaced it by the pane's one builder, below) | the launcher's start case |
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

The first round's counts: this wiring table's 26 rows hold 33 single guards (some rows name two or three), and the build
copy's table 8 more, 41 in all. Of the wiring's 33, 27 were killed on the first pass. Five survivors became cases or a
required dependency, and each was then killed. The sixth, the close bound dropped from the composition, survived only
because the runner's default equalled the contract's. The default is gone, so the typecheck now kills it.

Fix round 1 (review 3687), each removed in turn against the files named:

| Guard removed | Killed by |
|---|---|
| the composer hands the runner the contract (a step limit four times longer) | G1's exact times, through `captureDeskComposed` |
| the composer hands the launcher the contract's tmux bound (15 s instead) | G1: every call asked at the contract's bound |
| the desk's late check on the contract (a step limit four times longer) | G1: the second capture is ended late |
| the start-up prune; the start-up sweep | `captureStoreAtStart`'s case |
| the rename that never treats the build's name as a directory | the link to a directory: the build is not placed, and the directory's tree changes |
| the heal itself (a link at the build's name refused again) | the four link shapes, through the whole copy and in the writer alone |
| the writer saying it replaced a link | the same cases' answer word |
| the writer's check passing a link (it refused one in check mode) | the copy's link cases and the check-mode case |
| the host accepting the healed answer; the answer's `replaced` field | the host's replaced-link case |
| the writer's checks at `captures` | a link and a file at `captures`, given to the writer when it writes |
| the server's log line for a replaced link; that line only for `link` | the adapter's two cases |
| the pane builder's refusal of a missing path | the missing path's case (the refusal's own words, before any tmux call) |
| its refusal of a path that is not absolute | the empty, blank and relative paths' cases |
| its refusal of a path holding an `=` | that case |
| the launcher building the pane's command anywhere but the builder | the five refusal cases: a tmux call is made |
| the build started as one word through the default shell | the launcher's start case (the two words); on a private tmux server with a login-refusing default shell, the build gone at once |
| the start program left out of the pane's command | the launcher's start case |

All 20 were killed. The real-tmux case with a login-refusing shell skips in this session's lane (its socket path is too
long here) and runs in CI; its red without the cure was measured at the launcher, on a private tmux server with such a
shell, by a script outside the test wrapper: with the cure the build was alive a second after the start, without it gone.

## What only a real box shows

- That tmux on the box prints the pane's process for `new-session -P -F '#{pane_pid}'`, makes it a group leader, runs a
  command of two words with no shell, and that the start program keeps the build in that process. Checked on the fleet host
  (tmux 3.6, the version the box's tool sync installs to match) against a private socket in the session's temporary
  directory: a build stand-in that ignores a hangup was ended by the stop, and under a login-refusing default shell the
  two-word pane lived where a one-word pane ended. The suite's two real-tmux cases run only where the temporary path is
  short enough for the socket (CI; not this session's lane).
- That the pane starts under the service user's real entry, whose shell refuses logins (review 3687 F1): the cases stand in
  for it with `SHELL`, which tmux reads first.
- Which shell the build itself finds for its own tool calls. tmux hands the build the pane's default shell as `SHELL`,
  which on the box is the service user's, one that refuses logins; the build has to find a usable shell of its own. Only a
  real capture shows that it does; if it does not, the drive's tool step fails.
- That the box's rename tool keeps a link at the build's name as a name to replace (GNU's, as the copy's header assumes).
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
- Fix round 1: the four capture files of the agent package, the agent package's tests-inclusive typecheck, and the agent's
  whole suite; on the server, the build copy's three files (the admin acts, the copy's adapter, the macOS region pin) and
  the guards that read the tree (the test box pins, the tmux socket census, growth, anchors, citations, D-TBD), each alone.
  The shellcheck ratchet is red here as on a clean `main` (it cannot measure another file); the copy's own file has no
  warning before or after. Two hook refusals of this round matched words in a call's text, not the act they guard (a
  test-file edit script and a timer's note); each was reported, and redone on the coordinator's ruling (the edit with the
  edit tool, the note in plain words).
