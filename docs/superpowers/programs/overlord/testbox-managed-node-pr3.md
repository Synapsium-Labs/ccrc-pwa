# Test box as a managed node, PR 3: the test service's additions

The task note of PR 3 of `docs/superpowers/specs/2026-11-22-test-box-managed-node-design.md` (§9, Table 20: "the
service's two files"). The plan is `docs/superpowers/plans/2026-11-22-test-box-managed-node.md`, which defines the
numbers cited here. This note records what the ledger should learn; the coordinator folds it into the plan on its own
pull request.

## What this pull request delivers

Nothing calls the new code yet: no updater writes a drain request or node files until PR 4. On a box as it is today
(no node files, no request file) no run, sync or status answer changes. Four small things do change there, and they
are listed under "What changes on a box as it is today" below.

- **The drain (spec §2.5, D-8907).** The service polls `/run/ccrc-testbox-drain/request` every two seconds, and once
  before it starts. While a request stands, no waiting run starts. When no run, pristine build or capture is in
  progress, the queue is written to `<root>/handover/` and the service answers in `/run/ccrc-testbox/drain`. It stays
  up. When the request is withdrawn or its deadline passes, the service queues the handed-over runs again, in their
  order, each to the connection that submitted it. A next service started while the request still stands leaves the
  runs on disk until the request ends.
- **The ready file (spec §2.7).** After it has bound its address, the service writes `/run/ccrc-testbox/ready`: the
  release tag of the tree it runs from and its process id. A stop removes it and the drain answer.
- **Measured versions (spec §2.6).** On a managed box the status answer's six `tools` cells are read from
  `<tools>/node-state/tools.json`, never from the tool set's `versions` file, which is a copy of a spec.
- **One mover (spec §2.8, D-8913).** On a managed box a `tools.sync` frame starts nothing, keeps nothing and is not
  refused, and a failed sync is never retried. A box is managed when `<tools>/node-state/node-id` is there.
- **One mover during a drain, too (spec §2.5, §2.8).** A box no act has adopted yet is still the tool sync's to move,
  and its first act asks this service to drain. While the request stands the tool sync starts nothing: a `tools.sync`
  is kept in the service's memory and a failed sync is not retried. A sync or a takeover already in flight ends as it
  would have, and the answer says `draining` until it has. When the request is over, the kept frame runs once.
- **The runtime directory.** `ccrc-testbox.service` now declares `RuntimeDirectory=ccrc-testbox`, so systemd makes
  `/run/ccrc-testbox` for the service user at each start and removes it at each stop. Without it the service could
  write neither file on a real box. A test pins the unit's line against `boxFiles.ts#RUNTIME_DIR`.
- **The wire rule (D-8912).** No frame gained a field. All ten readers of the test box's frame family are exact, the
  status answer's included, so the new facts are files on the box. The node files do not ride the status answer: the
  spec rejects that (§7), and the carrier reads them (PR 4, PR 5).

## The file formats

PR 2's updater writes the first three of these and reads the last two. They are stated once, in
`agent/src/testbox/boxFiles.ts`. The request, the answer and the ready file are lines of `key<TAB>value`, the form of
the tools unit's report, so root's shell reads and writes them with no JSON tool. Every reader ignores a key it does not
name.

| File | Writer | Text |
|---|---|---|
| `<tools>/node-state/node-id` | the updater | Any non-empty text. Its presence is what "managed" means to the service. |
| `<tools>/node-state/tools.json` | the updater | One JSON object keyed by tool name (`node`, `npm`, `tmux`, `git`, `python3`, `chrome`), each value the version as a frame carries it (`22.11.0`, never `v22.11.0`). |
| `/run/ccrc-testbox-drain/request` | the updater | `act<TAB><id>` and `deadline<TAB><seconds since the epoch>`. The id is 1 to 64 characters of letters, digits, `.`, `_` and `-`, starting with a letter or digit. |
| `/run/ccrc-testbox/drain` | the service | `act<TAB><id>`, then `state<TAB>draining` with `running<TAB><n>`, or `state<TAB>idle` with `queued<TAB><n>`. |
| `/run/ccrc-testbox/ready` | the service | `release<TAB><tag>` and `pid<TAB><process id>`. |

*Table 1. The five files. Each is at most 4096 bytes. The service reads root's files without following a link at the
file's name, without blocking, and only when they are regular files.*

The same text is stated once more as data, in `agent/test/fixtures/testbox-box-files.json`: the paths, the size bound,
the act id's pattern and one example of each file. `agent/test/testbox-managed-node.test.ts` pins `boxFiles.ts` to it.
The updater is root's shell and cannot import `boxFiles.ts`, so its suite pins the shell to the same file (see "Left
for other pull requests").

## What changes on a box as it is today

No box has node files or a drain request before PR 4, so the drain and the managed arms never run there. These do:

- **The ready file.** A box whose unit was rendered from this release has the runtime directory, and its service
  writes `/run/ccrc-testbox/ready` after it binds. Nothing reads it yet.
- **One line in the journal.** A box whose unit was rendered before this release has no runtime directory. Its
  service says `no ready file (ENOENT ...)` once at each start and goes on. Only an installer re-run renders the unit
  again; the tool sync does not.
- **A cancel reaches the hand-over directory.** A `run.cancel` for a run the service does not hold now removes that
  run's file under `<root>/handover/`. Before, such a file (a takeover's, waiting for the timer to queue it) stayed
  and the run was queued and ran. Run ids are 32 hex characters, so the match cannot reach another run's file.
- **A run id on disk is used.** A submission whose id names a file under `<root>/handover/` is refused as a used id.
  Before, it was accepted, and the file was later moved to `handover/dropped/` when it was queued.

## Departures, by slug

None of these takes a number here. Each is a choice the spec left to the plan, or a case the spec does not name.

- **status-answer-carries-no-node-files.** The task brief asked for the node files and the measured tools "in the
  status answer". The spec forbids a new field there (D-8912) and rejects the node files in that answer (§7). So the
  measured versions are the values of the existing `tools` field, and the node files stay on the box for the carrier.
- **tab-lines-not-json.** The request, the answer and the ready file are `key<TAB>value` lines. `tools.json` is JSON,
  as the spec names it.
- **draining-answer.** The spec's answer is the act's id, `idle` and a count. The service also answers `draining` with
  the number of runs in progress, so the updater can tell "the service saw the request" from "the service never
  answered". An updater that looks only for `state<TAB>idle` is unaffected.
- **unreadable-is-no-information.** An absent request is a withdrawal. A request that cannot be read, or does not
  parse, starts no drain and ends none early: a lease already held stands until its own deadline.
- **lease-ceiling.** A lease stands at most 60 minutes from when the service first saw its act, whatever deadline the
  request names (spec §2.9: the longest act). An act ended by that ceiling does not close the box again while its
  request stays on disk.
- **submissions-during-a-drain.** A run submitted while a request stands is accepted, as during a takeover. Once the
  queue is on disk, a later submission is written there in the same turn and the answer's count is rewritten.
- **queue-depth-counts-the-disk.** While a request stands, the status answer's `queueDepth` includes the runs on disk.
  The field is one the answer always carried.
- **cancel-reaches-the-disk.** A `run.cancel` for a run the service no longer holds removes that run's hand-over file,
  and its id is free again.
- **run-id-on-disk-is-used.** A run that waits on disk keeps its id: a second submission under it is refused at the
  door (`service.ts#runIdUsed`, the one owner of "two runs never share one id", asks the hand-over's driver). Without
  it, a second submitter's connection took the first run's frames when the runs were queued again.
- **no-old-mover-under-a-lease.** While a drain request stands on a box the tool sync still moves, a `tools.sync` is
  kept and a failed sync is not retried; the answer is never `idle` over a tools unit or a takeover in flight. The
  kept frame lives in the service's memory, so it is lost when the updater stops the service. The act then goes on,
  and the box is managed after it, where the frame would start nothing.
- **drain-hands-over-runs-only.** A takeover writes a waiting `tools.sync` to `handover/tools.sync` for the next
  service. A drain does not: the service stays up and keeps the frame itself, so the frame has one holder and runs
  once.
- **installs-keyed-on-the-running-node.** On a managed box the pristine store's node is the node the service runs
  on, never `tools.json`'s: the updater writes that file after it starts the service (spec §2.5, steps 7 and 8), so
  at a start it names the node before. `tools.json` is read for the status answer alone, as spec §2.6 says.
- **second-timer.** The drain's poll has its own timer in `main()`, beside the service's. The request is a file, so it
  is seen only by looking, and the updater waits on the answer, so the service looks every two seconds. The service's
  timer runs at `CCRC_TESTBOX_FETCH_EVERY`, minutes apart, and a tick waits for the last one's fetches to end.
- **unmeasured-tool-alone.** A tool `tools.json` does not carry, or carries off its shape, reads as not measured by
  itself: its cell is the placeholder `0`, the reason names it, and the fleet host's version row differs on it, so runs
  fall back to local runs. The other five stand.
- **unreadable-node-id-starts-nothing.** When the node id is there but cannot be read, the tool sync starts nothing and
  the versions come from `tools.json`: the box may be managed, and the old mover must not run on a managed box.
- **poll-and-ceiling-are-constants.** The poll interval (2 s), the lease ceiling (60 min) and the files' size bound
  (4096 bytes) are constants in the service, not box settings: the spec names no setting for them, and a box setting
  is added through the settings table, which this pull request does not touch.
- **handover-stays-in-the-tool-sync-driver.** The hand-over directory keeps its one writer and reader, `toolsync.ts`.
  The drain calls it. When PR 8 deletes the tool sync, the hand-over moves out with characterization tests first.

## Left for other pull requests

- **The request's directory.** `/run/ccrc-testbox-drain` is root's, and the updater makes it (PR 2). The service's own
  directory is declared by its unit here.
- **PR 2's golden file.** PR 2's characterization fixture records the rendered `ccrc-testbox.service` by its digest.
  The unit gained one line here, so whichever of the two lands second regenerates that digest.
- **The shell side of the file formats (tracked, for the pull request that lands second of PR 2 and PR 3).** One test
  in the updater's suite reads `agent/test/fixtures/testbox-box-files.json` and pins `deploy/testbox/bin/box-update`
  to it: the request it writes, with the fixture's act and deadline, is the fixture's `request.text`; its field
  reader and its gate read the fixture's `answerIdle`, `answerDraining` and `ready` texts; `TBU_RE_ACT` is the
  fixture's `actId`; its size bound is `maxBytes`; and the `tools.json` it writes reads as the fixture's does. The two
  sides were compared by hand on 2026-11-22 and agree.
- **The tools unit in the updater's own measurement.** The updater goes on only when no run, prepare or install unit
  is active. A service from before this pull request cannot be asked to drain and may have its tools unit running,
  so the updater's list must name `ccrc-testbox-tools.service` too (PR 2's `_tbu_busy_units`).
- **O2, O4, O5, O6, O7.** Nothing here depends on any of them.
- **Probes and captures during a drain.** The drain waits for captures in progress, as the takeover does. It does not
  refuse a probe or a capture submitted while a request stands. The capture runner's gate G2 (the desk starts no
  capture while admissions are closed) covers a drain too once it lands, because the drain closes the same
  `ToolSync.admitting`.

## Proof

`agent/test/testbox-managed-node.test.ts`, 76 cases, all on fixture directories with a fake system manager and the
test's clock. Guards were removed or weakened in turn and the suite went red each time, in two tables:

- The first table: 60 mutants, none survived. One more was measured outside the suite, because it hangs the test
  process: without `O_NONBLOCK` the open of a FIFO never returns. Three guards that no test could turn red were
  removed as redundant while it was run.
- The review found three guards that table had missed. Two now have a case each: a waiting pristine build stays in
  the queue through a hand-over, and a failed write leaves no temporary file. The third had no effect a test could
  see (a map entry cleared on a cancel) and was removed.
- The second table, over the review's fixes: 27 mutants, none survived. It covers the kept frame and the retry under
  a request, the answer over a sync and over a takeover in flight, the hand-over without the frame, the installs'
  node, the used id and its exception for the run being queued again, the two guards above, the unit's line, and the
  fixture's pins.

- **Older peers, both ways.** The released frame types, status keys and `tools.sync` keys are frozen in the test. The
  fleet agent's own call, which this pull request does not touch, reads a new box unmanaged, managed, draining and
  drained, and its `tools.sync` is taken. The same call reads a released box's answer and sends the released frame.
- **The drain.** An updater killed in mid-drain: admission reopens at the deadline and the runs are queued again in
  order. A next service under a standing request starts nothing. A hand-over that cannot be written never answers
  `idle`.
- **The old mover under a request.** A `tools.sync` and a retry start no tools unit while a request stands. A sync in
  flight, and a takeover, keep the answer at `draining`. A frame that waited runs once after the request.

## Unverified

- No real box, system manager or root. Whether `/run/ccrc-testbox` under `RuntimeDirectory=` is removed on a restart
  before the updater reads the answer was not measured; the updater reads the answer before it stops the service.
- The formats in Table 1 were chosen here while PR 2 was being built in parallel. The two trees agree today by a
  hand comparison. No test in this pull request runs the updater's shell: that pin is the tracked item above.
- `RuntimeDirectory=` was not run under systemd. That systemd makes the directory for the unit's user, with the
  drop-in's `User=`, and removes it at every stop, an automatic restart included, is read from its documentation.
- A takeover's exit leaves the ready file and a `draining` answer to systemd's removal of the directory. The service
  does not remove them itself on that exit.
