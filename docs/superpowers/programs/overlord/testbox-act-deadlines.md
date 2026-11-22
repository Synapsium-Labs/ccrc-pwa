# Test box admin acts: deadlines and the lock (PR 1 of the managed-node design)

The task note of PR 1 of `docs/superpowers/specs/2026-11-22-test-box-managed-node-design.md` (its section 2.9 and
the PR 1 row of section 9). The spec is in its own pull request and is not in this branch. Every departure and
decision below is recorded under one placeholder, `D-TBD-<slug>` with the slug `testbox-act-deadlines`. No number
was issued, so the `dtbd` suite is red on this branch until one is.

## What happened

On a real deployment one `ccrc testbox-admin parity` act ran for 23 hours: a local test leg never ended. The act
runs in a detached unit that holds the admin lock for its whole life. For those 23 hours every other act answered
`busy`, with nothing saying which act held the lock or until when. `ccrc testbox-admin cancel` answered
`cancelled:false`. A box that needed a repair could not get one until a person stopped the unit by hand.

## What changed

1. **One deadline table.** `TBA_DEADLINE_S` in `ccd/ccrc-testbox-admin`, with its twin `TESTBOX_ADMIN_DEADLINE_S`
   in `shared/testbox-admin.ts`. `_tba_detach` passes a sub's row to the unit as `RuntimeMaxSec`, and `unit/stop`
   as `TimeoutStopSec`, so the system manager ends an act that outlives its row. A sub is long because it has a row
   (`_tba_is_long` reads the table), so no sub can detach without one. `_tba_detach` also refuses to start a unit
   when the call's row is missing (an Apply when idle with no `/idle` row).
2. **A bound on each parity step, and a time for the act to end by.** `ccd/testbox-parity` takes three flags, and
   the verb always passes all three from the table:
   - `--leg-deadline <seconds>` bounds each step: a lockfile install, or one leg (one run of one snapshot on one
     side). A step that does not end is stopped, said to have not ended and counted as a leg that could not run,
     and the tool goes on.
   - `--leg-kill <seconds>` is the time between a stopped step's TERM and its KILL. The tool holds no default for
     it: a bound with no kill behind it is refused.
   - `--until <epoch seconds>` is the time after which the tool starts nothing more. A step that begins near it
     gets only what is left. The verb passes the act's recorded start, plus the `parity` row, less `parity/tail`.

   So a parity run that is only slow ends by itself, with a record and the reason in the log, and the act ends
   `parity-differs`. The unit's ceiling is left for a real hang. The verb also runs the tool under `timeout`, half
   the tail after that time, for a tool that does not end by itself. Run by hand without the flags, the tool has
   no bound, as before.
3. **`busy` names the holder, and the status says the same.** The `busy` answer gains
   `holder: {sub, startedAt, deadlineAt}` (epoch milliseconds) when the state holds a running long act. It is
   additive and read by one reader, `readTestboxBusyHolder`. The status's running act carries the same
   `deadlineAt`, read from the same state line (`act_deadline`). The server passes the holder on in the route's
   refusal. The card's refusal line says it in the card's own words, and a running act shows "It ends by ... at the
   latest". A short act that holds the lock (under a minute) is not recorded, so `busy` then names nobody.
4. **`cancel` ends a parity act.** It answered `cancelled:false` for two reasons: `_tba_run_cancel` wrote the
   cancel mark only for a waiting `settings-box`, and the parity unit never looked for a mark. Now the mark is also
   written for a parity act in its `legs` phase, and the unit's shell looks for it (`_tba_cancel_asked`, the same
   look the idle wait uses) while the tool runs beside it. On a cancel it stops the tool and every leg it started,
   ends the act `cancelled` and writes no record. An act that is writing its record is past cancelling.
5. **An act whose unit is gone reads ended.** `_tba_reap` already ended an act `interrupted` when its lock was
   free. It now also ends one whose latest end passed one `unit/stop` ago when the lock cannot be taken or measured
   (a process the unit left behind holds it, or the host has no `flock`). `_tba_detach` runs it before a new act
   begins, so an act stopped at its ceiling is kept as an ended act, and gets its ledger row, even when no status
   was read in between. No second code was added: `interrupted` is the code, and its sentence now also says "or
   it reached its time limit".

Smaller changes that came with these:

- **The lock is on descriptor 9.** `_tba_lock` held it on a descriptor bash picked. It is now a fixed number, so
  the parity tool is started with `9>&-`: no leg, and no process a leg leaves behind, carries the act's lock.
- **The tool writes to a file, and the unit reads it.** The unit's shell reads the tool's new lines into the log at
  each look and once more after the tool is gone. There is no reader process to wait for, so no line is lost when
  the unit ends and no process that keeps a pipe open can keep the act. A line written in two parts is one line.
- **The record's merge moved to the tool.** `_tba_pr_merge` is now `ccd/testbox-parity --merge`, unchanged, so
  both writers of the record's shape are in one file. The verb's existing record tests are its characterization:
  they pass unchanged before and after the move.

## The deadline table

| Row | Seconds | What it bounds | Enforced by |
|---|---|---|---|
| `connect` | 3480 (58 min) | The Connect unit | `RuntimeMaxSec` |
| `repair` | 1800 (30 min) | The Repair unit | `RuntimeMaxSec` |
| `apply-release` | 1800 (30 min) | The Apply release unit | `RuntimeMaxSec` |
| `settings-box` | 1800 (30 min) | A box settings edit that does not wait | `RuntimeMaxSec` |
| `settings-box/idle` | 23520 (6 h 32 min) | An Apply when idle, wait and edit | `RuntimeMaxSec` |
| `parity` | 3600 (60 min) | The parity unit | `RuntimeMaxSec` |
| `parity/leg` | 900 (15 min) | One step of the parity tool | `timeout` in the tool |
| `parity/kill` | 30 | From a stopped step's TERM to its KILL | `timeout -k` |
| `parity/tail` | 300 (5 min) | The end of a parity act kept back from its legs | `--until`, `timeout` |
| `unit/stop` | 90 | From the unit's TERM at its ceiling to its KILL | `TimeoutStopSec` |

Why each number:

- `connect`: the design's bound for a first install (its Table 12). The release is fetched, verified and copied,
  the box's packages and tools are installed, then pairing and the check. The install phase alone took about five
  minutes on a real box.
- `repair`: a fetch, a verify and a copy of the release, then one re-run of the box's installer (about five
  minutes on a real box). The design gives no number; 30 minutes is this pull request's choice.
- `apply-release`: a read and a manifest check on the box, then one re-run of the installer. Same choice.
- `settings-box`: a read and a write of the box file, then one re-run of the installer. Same choice.
- `settings-box/idle`: the 6-hour wait for no run in progress (`TBA_IDLE_DEADLINE_DEFAULT`, unchanged), then the
  `settings-box` row, then two minutes for the wait's last look. A test holds the sum.
- `parity`: the design's bound (Table 12).
- `parity/leg`: the design's bound, and the test box's default run budget (`CCRC_TESTBOX_BUDGET`).
- `parity/kill`: long enough for a local leg to stop its scope, short against a leg.
- `parity/tail`: half for the tool to stop its last step and remove its worktrees, half for the record. The tool
  is told to start nothing after start + 55 minutes, is itself stopped at start + 57.5 minutes, and the unit's
  ceiling is at 60.
- `unit/stop`: systemd's default stop timeout, now stated on the unit.

Tests hold that every long sub has a row, that a row named for a sub is a long sub, that the bash table equals the
TypeScript one, that two full steps fit before the tail, and that a step's kill fits inside half the tail.

## Roll this build out server first

`deadlineAt` on the status's running act is a new field. `readTestboxAdminStatus` refuses a whole document for one
field it does not name, so a server older than this build cannot read the status of a newer fleet host while a long
act runs there. The card then shows the status as unread and the switch's parity gate refuses, until the server
is updated. `ccrc rollout --server-first` avoids it. The verb prints the field only for a running act with a
recorded deadline, so an idle box's status reads on any server. A page that still runs an older bundle has the
same limit until it reloads. The three earlier fields of the status were added the same way.

## What the review round changed

Fixed:

- A slow parity run could only end `interrupted`: the tool's bound equalled the unit's ceiling. See item 2.
- `--foreground` on a step's `timeout` had no test. A test now runs the real tool under an outer `timeout`,
  sends it TERM and checks that the leg's process is gone.
- A step was said to have run out of time on its exit status alone (124 or 137). It is now said only when the
  step also ran for its whole bound.
- The tool's log reader could be cut off when the unit ended. See "The tool writes to a file".
- The holder's `deadlineAt` was not the latest time the lock can be held. It is now the start, the row and
  `unit/stop`, and the card rounds it up to the next minute.
- `readTestboxBusyHolder` let through a time no `Date` can format. Both times are now at most fifteen digits, in
  the verb and in the reader (`TESTBOX_ACT_TIME_MAX_MS`).
- The status did not show the latest end. See item 3. `testboxActLatestEnd` and `TESTBOX_IDLE_WAIT_S`, which gave
  a second and different answer, are gone.
- The holder's sentence was built in `shared/` from the raw sub. It is now `busyHolderSentence` in
  `pwa/src/fleet/testboxAdminWords.ts`, from `actWord` and the card's own minute formatter.
- The 30-second kill grace was written in three places outside the table. It is the `parity/kill` row.
- This note's long lines.
- The verb's packed lines: three added code lines are over 140 characters, down from eight. The room came from
  moving the merge out of the file.

Not changed, and why:

- **An Apply when idle keeps one ceiling for its wait and its edit.** The design's Table 12 gives it one
  `RuntimeMaxSec`, and a second bound inside the unit would be the act's own care, which section 2.9 rules out. A
  re-stamped deadline that nothing enforces would be wrong in the other direction: the reap would end an act whose
  unit still runs. So an edit that hangs after a short wait holds the lock until the whole row ends, and `busy`
  names that end. It is recorded here and in the README as an accepted limit; the design's PR 4 runs a settings
  edit through the update act, with that act's own bounds.
- **The times are UTC, not the viewer's local time.** Every time on the card is a UTC minute from one formatter.

## Other departures

- **No new closed code.** An act stopped at its ceiling reads `interrupted`, and a parity run that ran out of time
  ends `parity-differs`: its record is a fail and the log names the steps that did not run. The code's sentence
  ("gave different results") does not say that time ran out.
- **More files than the task named.** `server/src/testboxAdmin.ts` (the holder passes through `decisionOf`),
  `pwa/src/lib/refusalWords.ts` (the refusal's text) and `pwa/src/fleet/TestBoxManage.tsx` (one line).
- **The growth cap did not rise.** `ccd/ccrc-testbox-admin` is capped at 1885 code lines and stood at 1873. It is
  now 1884, by `growthCheck.ts`'s own count. `ccd/testbox-parity`, which has no cap, went from 251 to 297.

## Not verified on a real box

Everything was run on fixtures: a fake `systemd-run`, a fake `ssh`, a fake parity tool and fixture homes. So:

- **`RuntimeMaxSec` and `TimeoutStopSec` on a real user manager.** The tests hold that the two properties reach
  `systemd-run` with the table's values. That systemd stops the unit at the bound, and that the stop frees the
  lock, was not run.
- **How long a real parity takes.** No duration was measured. 60 minutes in all, 15 minutes a step and the
  5-minute tail are not measured numbers. If the default five pull requests need more than 55 minutes, the run ends
  `parity-differs` with a fail record; fewer pull requests can be named (`--pr`), and each number is one row.
- **The real parity legs under `timeout`.** The local leg is `ccrc test --local`, which runs the command in a scope
  of the tests slice and stops that scope when it is sent TERM. That was read in `ccd/ccrc-test`, not run: the
  tests use a stand-in that sleeps. With `--foreground`, a step's `timeout` signals the step's own process only,
  so a local leg that had to be KILLed leaves its scope running until the scope's own end.
- **A real cancel.** The stop reaches the tool and its legs through `timeout`'s process group. A leg whose
  processes left that group and ignore the scope's stop would run on until their own bound.
- **The latest end is the parent's clock.** `act_deadline` is stamped before `systemd-run` is called, and the
  unit's ceiling counts from the unit's start, a moment later. The reap waits one more `unit/stop`.
- **The read of a growing file.** The unit reads the tool's output through an open descriptor, which was run on
  bash 5.3 here. The fleet host's bash was not run.

## Left for later

- The card offers **Cancel** only for a waiting settings edit. A Cancel button for a running parity act is not in
  this pull request; the route (`POST /api/testbox/admin/cancel`) and the shell reach it.
- A short act that holds the lock is still not named by `busy`.
- A cancel that arrives after the last look of the last row is answered `cancelled:true` and the act still ends
  as it would have. The same narrow window exists for a settings edit whose wait has just ended.
- A line the tool had not ended when it was killed is not logged.
