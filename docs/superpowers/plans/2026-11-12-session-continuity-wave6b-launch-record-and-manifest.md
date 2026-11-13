# Session continuity, wave 6b: the launch record and the manifest, written in shadow and read by nothing (implementation plan)

> **COORDINATOR notes from drafting.** Each note was measured on `origin/main` (drafted at `2d50be1af`, revised for
> the plan review at `58bd5591b`). Each one names a ruling in `decisions-6b` (the coordinator's calls 1 to 12) whose
> premise the code does not bear out, or which the code makes the plan carry out differently. The plan follows the
> code, as described below.
> 1. **COORDINATOR: call G's count cannot be read from the wait rows that call 4 names.** Call 4 (and call 8's last
>    count) reads the waits "from what ccd already records (the limit-wait and the no-room/rescue rows)". On main the
>    `limit-wait <id>: choice=wait …` line carries no reset (`ccd/ccd#_limitwait_choose`), and a no-room rescue wait
>    records `reset=-` for every block that is not `five_hour` (`ccd/ccd#_rescuewait_open`). So no wait row says how far
>    off a weekly reset is. (An `auto-rescue` line does carry a dated block's ` reset=` and ` type=`,
>    `ccd/ccd#_rescue_line_extra`, but that is a rescue, not a wait.) The one record of a wait's distance to its reset is
>    the registry record `$REG/<id>.limitwait` (`since=`, `reset=`, `account=`, written by `ccd/ccd#_limitwait_open`),
>    which each episode overwrites. So the manifest reads that record when it writes, under the recency rules of Task 3
>    step 2, and carries the span as `wait=<seconds>` in the file and in its swap.log line. `--stage 3` counts no-room
>    rescue waits apart, as `noroom_reset_unknown`, never as days out (D-8375).
> 2. **COORDINATOR: a run's journal holds no terminal record.** Call 5 offers "a terminal record in the run's journal".
>    The journal has none. `journal.jsonl` holds `launched`, `started`, `result` and `failed` lines, with no line for the
>    run's end and no timestamps (the measured source in `server/src/workflows/model.ts`, D-5561). A run's terminal
>    record is its summary file, `workflows/<runId>.json`. The server's rule (`server/src/workflows/model.ts#decideRun`,
>    fed by `server/src/workflows/read.ts`) takes mtimes only: any summary FILE whose mtime is at or after the journal's
>    reads finished, whatever it holds, because `read.ts` sets `summaryMtime` from a stat and calls `parseSummary` only
>    later, for the row's view. The manifest is stricter in two ways: it needs the summary to parse with `status`
>    `completed` or `failed`, so a `killed`, non-final or unparseable summary reads as in flight
>    (D-8370). For an agent, "finished" means its transcript's newest real row is an
>    assistant row with `stop_reason` `end_turn`. `ccd/lib/transcript.jq#complete` is NOT that test: it accepts any
>    string `stop_reason`, `tool_use` included, which is the newest row of an agent stopped mid-tool. A new entry point,
>    `agent_end`, reads it. The launch record holds no completion rows.
> 3. **COORDINATOR: `holed` can be computed.** Call 3 gives `holed` as its example of a class that may not be
>    computable ("needs agents' last rows"). Those rows are on the box: each workflow agent's transcript is in the
>    session's sidecar, at `subagents/workflows/<runId>/agent-<id>.jsonl`. So `holed` is computed, from the latest attempt
>    for each journal key. Every class in the spec's table ships. What is carried is named under "What this does not
>    claim".
> 4. **COORDINATOR: the launch record's two constants cannot be spelled only once.** Call 6 asks for each budget to be
>    "stated once as constants beside the carry's (`ccd/ccd`)". The launch record's writer is the hook, which cannot
>    source `ccd/ccd`. So the record's two constants are defined in `ccd/ccd` beside `CARRY_MERGE_BUDGET` (Task 3, where
>    they are first read: `_inflight_write` passes their sum to the program, which reads no more of `.deleg` than that),
>    the hook spells them again (Task 1), and a test pins the two spellings equal. This is how the spool's
>    `DELEGATION_SPOOL_BOUNDS` works. They are not added in Task 1, because shellcheck counts an unread global as SC2034
>    and `server/test/shellcheck-baseline.json` pins `ccd/ccd + ccd/lib` at 23 of them. So in 6b-1 (note 8) the hook's
>    `LRC_MAX_BYTES` and `LRC_DROP_RESERVE` are the only spelling, pinned by nothing; `ccd/ccd`'s spelling and the
>    equality pin arrive with Task 3 in 6b-2. The record's append takes no slot: each line is one `write(2)` (a pair
>    is two, D-8401), the spool's rule. The record is compacted inside the manifest's own slot (`$REG/.inflight.lock`,
>    R-A), from 6b-2 on.
> 5. **COORDINATOR: unmeasured has two more reasons, and an all-unread manifest has a verdict of its own.** Call 8 splits
>    `unmeasured` into lock-busy and over-budget. Two more words stand beside them, because their remedies differ:
>    - `why=error`, as the carry's `(kept: error)` is: no `flock`, no `python3`, the program missing or failing, an
>      unwritable file, a record that is not a regular file, no uuid or config root, and a config root or `projects/`
>      directory that cannot be listed;
>    - `why=time`: the program outran `INFLIGHT_TIME_S` (`_plat_timeout`'s 124).
>
>    A manifest that finds items but can read none of them gets a verdict of its own, `unread`, and never `none`. A
>    manifest with items is `listed`, the spec's word (§5.5).
> 6. **COORDINATOR: only one of the expected waivers is likely to be used.** Call 10 asks for a waiver for each file
>    that grows. The new program, `ccd/lib/inflight-manifest.py`, is not held by the growth check. The check
>    (`server/test/growthCheck.ts#CCD_LIBRARY`) holds `.sh` libraries only: "The `.jq` and `.py` programs beside them
>    are not libraries". `ccd/lib/transcript.jq` is not held either. `ccd/session-hook.sh` is expected to grow by about
>    35 net code lines in 6b-1's PR, under the limit of 40, so its waiver is named but may go unused. `ccd/ccd` is
>    expected to grow by about 92 in 6b-2's PR, about 8 of them the manifest's own slot helper (R-A); 6b-1's one purge
>    line is edited in place, in 6b-1's diff. So its waiver will be used. Growth is measured per PR against its merge
>    base, and a waiver counts only in the diff that adds it, so each run's PR carries its own waiver.
> 7. **COORDINATOR: one parser, as call 9 rules, needs four changes to the parse.**
>    - **The `lrec` def goes inside `DSP_DEFS`.** The launch record's jq (`def lrec`) goes inside the spool's own
>      `DSP_DEFS` text, ahead of `def spool:`. `session-hook-merge-deny.test.ts` reads a kept jq program only from an
>      upper-case `NAME='…'` that opens its line. The parse's two lines must stay two physical lines, because nothing
>      may be added above them.
>    - **`lrec` reads the raw response, not the spool's launch object.** The spool builds a launch only when every one
>      of `taskId`, `runId`, `taskType`, `workflowName`, `transcriptDir` and `scriptPath` passes (`agentId` for an
>      Agent), so a launch with a bad id or a long name looks like no launch at all there. `lrec` shares the spool's
>      defs (`isid`, `outcome`, `obj`, `fits`) and decides from the raw fields itself, so a bad id is a counted `drop`
>      and `def spool` stays byte-identical. This is the legitimately-different reason (D-8363).
>    - **The generation read no longer needs the spool directory.** The spool's gate reads the row's generation only
>      when the closed broker's spool directory exists. The launch record must not depend on that directory. So the
>      gate reads the generation without it, and the directory stays the spool's own condition.
>    - **The prefilter gains `SendMessage`, and the compile stays selective.** The spool directory is not gone with
>      the broker: every ccd spawn still makes `$REG/delegation/spool/<id>` (`ccd/ccd#_delegation_spool_dir`, called
>      once per spawn from `_spawn_start`'s path; `delegation-spool.test.ts`'s `'a spawn makes
>      $REG/delegation/spool/<id> at mode 0700 …'`). So on the fleet the common path is `dsp_sp` set: the prefilter is
>      the spool's list plus `"SendMessage"`, and every payload that quotes `"SendMessage"` now compiles `DSP_DEFS` there
>      too (about 11 ms of CPU, measured in the spool's header). The no-directory arm covers a row whose directory could
>      not be made, or a session ccd did not spawn: there `dsp_defs` is compiled only for a payload that quotes
>      `"PostToolUse"` and one of `"Agent"`, `"Task"`, `"Workflow"` and `"SendMessage"`, so a Bash event or a session
>      event still compiles the parse alone.
> 8. **COORDINATOR (RULED): two runs on this one plan (call 11).** The drafter proposed one worker-wave; the coordinator
>    ruled a split at the seam after Task 1. **6b-1 is Task 1** (the launch record), with its own gate, PR and wave-done
>    (Task 1 Step 8). **6b-2 is Tasks 2 to 5** (the program, `_inflight_write` and its sites, the reading, and Task 5's
>    gate, PR and wave-done). Why:
>    - **review size.** Five tasks at the top of a wave's size, larger than 6a, read as two reviewable PRs: the hook's
>      second sink alone, then the manifest that reads it;
>    - **the record collects from 6b-1's deploy.** The launch record starts collecting rows when 6b-1 deploys, so 6b-2's
>      first manifests already have launches to join, and call F's shadow week starts with a record in place.
>
>    Task 1 is self-contained: its code (the hook block, the gate, the `_reg_purge` operand), its tests, its census
>    half (`.deleg`), its mutation rows and its growth need nothing from Tasks 2 to 4. Its costs in the interval are
>    named under "What this does not claim" (6b-1 alone): nothing compacts `.deleg` until 6b-2, and its first
>    manifests read a backlog, which `--stage 3` reports apart (`first_manifests`, Task 4). Which deviation each run's
>    PR carries is listed under "Deviations found".
> 9. **COORDINATOR (RULED, R-A): no arming marker is needed (call 1), and no existing act changes.** No write here
>    changes what a session or the server reads. The draft found one existing act the manifest could change: taking
>    `$REG/.carry.lock`, the box's one carry slot, as call I (D-8332) ruled, it would make a concurrent swap's carry
>    for another session log `(kept: busy)` and leave that sidecar unmerged (`ccd/ccd#_swap_carry_sidecars`), the
>    stage-1 continuity loss, caused by a file nothing reads in 6b. The coordinator ruled (R-A) that the manifest takes
>    its OWN box-wide slot, `$REG/.inflight.lock`, non-blocking, one manifest at a time on the box, and never touches
>    `$REG/.carry.lock` (`_inflight_slot_take`, Task 3; D-8362, which amends call I). So a shadow
>    manifest never refuses a carry, and the daily carry-dedupe (#317) never makes a manifest busy. Only three timings
>    change, each bounded by `INFLIGHT_TIME_S` and named under "What this does not claim". The manifest is written:
>    - in the swap's window between the stop and the start;
>    - between the limit-resume's `supervised` stamp and its `cmd_ensure`;
>    - before a dead session's supervisor exits for its restart.
> 10. **COORDINATOR: R-A's facts, checked on `origin/main` at `0c91b860a`; one name is wrong, and one consequence was
>     not in the ruling.**
>     - **True.** A carry touches one session's sidecars: `ccd/ccd#_swap_carry_sidecars` takes the slot for ONE uuid's
>       sidecars, and it and `#_swap_carry_jsonl` are called from `ccd/ccd#cmd_swap` alone. `#_watchdog_resume_run`
>       (stop, `sleep 1`, `supervised`, `cmd_ensure`) and `#_end_note_gone` carry nothing. At the swap the manifest
>       follows its own session's carry in the same `cmd_swap` call (its body's subshell is a fork of that process).
>       `#_carry_slot_take` is `command -v flock` (else rc 2), `exec {fd}>>"$REG/.carry.lock"` (else rc 2), `flock -n`
>       (exit 1 alone is rc 1, any other failure rc 2, the descriptor closed either way), then the caller's
>       `CARRY_SLOT_FD`; `_inflight_slot_take` mirrors it line for line on `$REG/.inflight.lock` (Task 3).
>     - **Precision, not a contradiction.** Besides budgeting, the carry slot keeps a merge walk and the daily dedupe
>       apart on one uuid (`ccd/lib/carry-dedupe.py#one` returns `locked` while it is held). That is a lock between two
>       actors on one session's copies, not between sessions, and the manifest, which only reads, is in neither.
>     - **False: `INFLIGHT_READ_BUDGET` does not exist.** The manifest's priced read budget is this plan's
>       `INFLIGHT_SCAN_BUDGET` (64 MiB, provisional; Task 3's constants, D-8376). The plan
>       keeps `INFLIGHT_SCAN_BUDGET` everywhere, D-8362 included.
>     - **Not in the ruling: a new dot-prefixed registry file has a census.** `$REG/.inflight.lock` is a new
>       `$REG/.<name>` literal, so `_reg_purge`'s R-3 paragraph in `ccd/ccd` (TWENTY-TWO, "these fourteen") and
>       `server/test/ccd-account-auth.test.ts`'s `CARDINAL` (which stops at TWENTY-TWO) both change in Task 3; that test
>       file joins Task 3's list. The session hook's account arm (`ccd/session-hook.sh#APPROVAL_FORBIDDEN_JQ`, its
>       `AAUTH` def) refuses a Bash command holding the verb's name as a bare token: at the start of the text or after
>       whitespace, `;&|()`, a backtick, a quote, `=` or `/.local/bin/`, and not followed by `[A-Za-z0-9_.-]`. So a
>       grep pattern of the bare name is refused, while the test file's path (`…/ccd-account-auth.test.ts`: a `/`
>       before it, a `.` after it) is not, and the worker runs and stages the file by its path.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Execution status:** Drafted 2026-11-12 for run 1845 (wave 8 of the run record) at base
> `2d50be1af11a438e0b86730ba4e44c1eacc1829c`, and revised the same day for the plan review's findings, re-measured at
> `58bd5591b`, revised again for the second review pass at `0c91b860a` (no `ccd/`, `deploy/` or `server/` change
> since `58bd5591b`), and revised a third time for the coordinator's rulings R-A and R-B on its "Waiting on you"
> (2026-11-12), checked against `origin/main` at `0c91b860a`. Not yet approved. Once it lands, it is dispatched as **two worker runs on this one plan**
> (COORDINATOR note 8, as ruled): **6b-1 = Task 1**, through Task 1 Step 8's own gate, PR and wave-done, on run 1845;
> then **6b-2 = Tasks 2 to 5**, a new run, dispatched after 6b-1 merges (Task 2's round trip runs Task 1's hook from
> `main`), with Task 5 as its gate, PR and wave-done.

**Goal:** The wave records, from deploy, what is in flight at every restart ccrc makes itself, so that §9's stage-3
baseline can be re-cut from a shadow week (call F, D-8329). It ships two writers and one reader:
- **The launch record.** Each background launch or continuation a session makes is one row in `$REG/<id>.deleg`.
- **The manifest.** At each such restart, the record is joined with the session's sidecar, and the result is written
  as `$REG/<id>.inflight`.
- **The reading.** `--stage 3` reads the manifests' counts.

Nothing reads either file but the instrument and the tests.

**Architecture:**
- **Task 1 (`ccd/session-hook.sh`, and one line of `ccd/ccd`).** The hook's one payload parse gains a second output,
  `def lrec` inside `DSP_DEFS`, which always prints exactly one line: empty, one launch-record row, or a `drop` row and
  a row joined by a TAB. A row is due for a background Workflow launch, a background Agent, a `resumeFromRunId` call
  or a `SendMessage`. A new tail function, `_hook_launch_record_append`, beside `_hook_spool_append`, appends it under a
  byte budget, for the main thread only (the join file's rule), and removes the record when the row was purged
  meanwhile. `_reg_purge` removes `.deleg` once more after the generation, as it does `.joined`. Task 1 is run 6b-1,
  and its Step 8 is 6b-1's own gate, PR and wave-done.
- **Task 2 (`ccd/lib/inflight-manifest.py`, new, and one jq entry point).** A read-only program joins the launch record
  with the session's sidecar under the current config root. It reads regular files only, prices its reads before it
  starts, and classifies each item. It prints the items and the record's kept rows. Each agent transcript's newest row
  is read by `agent_end`, new in `ccd/lib/transcript.jq` (the ccd side's one transcript reader), in one `jq` call per
  manifest.
- **Task 3 (`ccd/ccd`).** `_inflight_write` is the one writer of the manifest and the record's one compactor. It
  takes its own box-wide slot, `$REG/.inflight.lock`, non-blocking through `_inflight_slot_take` (R-A,
  D-8362, amending call I), and never `$REG/.carry.lock`. It runs the program under `_plat_timeout`,
  and writes both files through `_reg_set`. Every restart it reaches rewrites `$REG/<id>.inflight`, as a header alone when nothing was measured. Its
  one swap.log line is `manifest <id>: …`. It is called at three sites: the swap after its carry, the limit-resume
  after its stop, and the supervise loop's gone exit.
- **Task 4.** `deploy/measure-continuity.py --stage 3` gains a `manifest` section, and four swap.log readers read an
  unreadable log as unmeasured (D-8353). README and the spec each gain an as-built paragraph.
- **Task 5.** 6b-2's gate, PR and wave-done (Tasks 2 to 4).

**Tech Stack:** Bash (ccd, the session hook), jq (no regex builtins), Python 3 standard library under `python3 -I` (the
manifest program and the instrument), and vitest in `server/` with fixture HOMEs.

**Spec:** `docs/superpowers/specs/2026-09-23-session-continuity-design.md`. Read §5.3 first: "The launch record", "The
manifest", "Deferred, not relaunched into the wall" and "Design calls for 6b and 6c". Then read §1.2, §6, §8, §9
(stage 3), §10 and §11. The ledger is `docs/superpowers/programs/session-continuity.md`: its Decisions of 2026-11-11
16:20 and 2026-11-12 05:26, and its carried constraints "From wave 6a" and "From wave 5". Wave 5's results are in
`docs/superpowers/plans/2026-11-07-session-continuity-wave5-spike-results.md` (§2.3 to §2.5). 6a's departures are in
`docs/superpowers/plans/2026-11-11-session-continuity-wave6a-departures.md`.

**Prerequisite:** 6a (#2687) on `main`. Deploy class: **AGENT-FIRST**. Only `ccd/ccd`, the hook, `ccd/lib/` and the
instrument ship. No `server/src` or `shared/` file changes.

## What main does today (measured at `2d50be1af`, re-measured at `58bd5591b`)

| Fact | Where | Bearing |
|---|---|---|
| The hook runs one `jq` per event. Its program is the parse, plus `DSP_DEFS` (the spool's defs), spliced in only when the payload names a delegation tool or event. The parse is two single physical lines, which three suites read as text. | `ccd/session-hook.sh#DSP_DEFS`; `session-hook-turnmark.test.ts` (the `between` literals), `session-hook-merge-deny.test.ts` (kept programs open their line), `delegation-spool.test.ts` (`CAP_STMT`, the prefilter list) | Task 1 edits in place, and moves exactly those pins. |
| The spool's gate reads `$REG/<id>.generation` only when `$REG/delegation/spool/<id>` exists. The prefilter names `Bash`, `Agent`, `Task`, `Workflow`, the four session events and `task-notification>`, but not `SendMessage`. | the statement before the parse | COORDINATOR note 7. |
| The spool keeps about 24 h of hourly buckets and keeps subagent lines. It records no `resumeFromRunId` and no `SendMessage`, and bounds `scriptPath` by length only (`req(maxpath)`). | `ccd/session-hook.sh#_hook_spool_prune`, `DSP_DEFS` | Why D-8324 puts the record in its own file. |
| No registry spelling of either file exists: no line in `ccd`, `deploy/measure-continuity.py`, `server/src`, `shared` or `pwa/src` has `.inflight` or `.deleg` directly followed by a quote or a backtick (Task 3's pattern). The bare tokens do occur, unrelated: `this.inflight` in four `server/src` lanes (`backupLane.ts`, `buildCaptureLane.ts`, `sessionFeed.ts`, `testboxLane.ts`), and `.deleg` as a prefix of `.delegation…` in `ccd/ccd` and nine `pwa/src` files. | grep | Both files are new. Task 3's census matches the registry spellings only. |
| The parse ends `\|\| exit 0`, and `\|\|` tests only its last `read`. A sink that prints no line, or two, drops the whole event: no turn mark, no hookstate, no spool line (the broker's wave-3 plan says so). The spool always prints its four lines. | the parse line; `docs/superpowers/plans/2026-10-08-delegation-broker-wave3-observe.md` | `lrec` prints exactly one line on every event. |
| The spool's PostToolUse arms build a `launch` only when every id passes `isid` and, for a Workflow, `taskType`, `workflowName`, `transcriptDir` and `scriptPath` all pass their bounds; otherwise `launch: null`, the same as no launch. | `ccd/session-hook.sh#DSP_DEFS` (`def spool`) | `lrec` reads the raw fields (COORDINATOR note 7). |
| A subagent's event is told by the join file, not by `agent_id`: real lanes sent main-thread tool events with an `agent_id` nothing ever joined. The hook's `tmsub` is that test, computed before the spool block. | `ccd/session-hook.sh`, the WHO WRITES comment and THE MEMBERSHIP TEST; amendment `tool-agent-id-alone-is-unjoined-evidence` | Task 1's main-thread rule. |
| `_reg_purge` removes the dot-free fields while `generation` stands, and `.joined`/`.joinedprev` once more after it, because the hook appends `.joined` without a lock; an orphaned dot-free field holds the slug for ever (`_ws_slug_free`). | `ccd/ccd#_reg_purge`, `#_ws_slug_free`; `ccd-lifecycle-purge.test.ts` | Task 1 does the same for `.deleg`. |
| `_reg_set` writes its value with `printf '%s'`: no trailing newline is added. | `ccd/ccd#_reg_set` | The compacted record is written with its own final LF. |
| `_transcript_matches` always returns rc 0 and prints nothing for no transcript, an unlistable `projects/` and a missing root alike. | `ccd/ccd#_transcript_matches` | Task 3 tells the three apart before `not-applicable`. |
| `ccd-python-reader-census.test.ts` (D-8070) reds on any `.py` under `ccd/` whose code names `.jsonl` or `transcript`, and on any ccd function that runs `python3 -…` and names `transcript`, unless a row with a defined D-number allows it. `lib/carry-dedupe.py` and `cmd_carry_dedupe` are its precedents. | `server/test/ccd-python-reader-census.test.ts` (`ROWS`, `judge`) | Tasks 2 and 3 each add a row. |
| shellcheck's warning count for `ccd/ccd + ccd/lib` is pinned (63, of which SC2034 23); an unread global is SC2034. | `server/test/shellcheck-ratchet.test.ts`, `server/test/shellcheck-baseline.json` | COORDINATOR note 4. |
| `_plat_timeout` bounds a call and answers GNU's 124 on expiry, with or without coreutils. | `ccd/ccd#_plat_timeout` | The program's time bound. |
| The carry's slot and budget: `_carry_slot_take` (rc 1 contended, rc 2 no mechanism) and `CARRY_MERGE_BUDGET`. It returns 2 without `flock`, opens `$REG/.carry.lock` for append on a new descriptor (rc 2 if it cannot), runs `flock -n` on it (exit 1 alone is a conflict, rc 1; any other failure closes the descriptor, rc 2) and sets the caller's local `CARRY_SLOT_FD`; the file is never unlinked. `_swap_carry_sidecars` takes it at the first existing destination of ONE uuid's sidecars and holds it to the loop's end; it and `_swap_carry_jsonl` are called from `cmd_swap` alone, so `_watchdog_resume_run` (stop, `sleep 1`, `supervised`, `cmd_ensure`) and `_end_note_gone` carry nothing. `ccd/lib/carry-dedupe.py#one` takes the same `.carry.lock` with `LOCK_EX`/`LOCK_NB`, once per uuid, skips a uuid a swap.log line named in its window, and re-checks that after the lock. | `ccd/ccd#_carry_slot_take`, `#_swap_carry_sidecars`, `#cmd_swap`, `#_watchdog_resume_run`, `#_end_note_gone` | R-A: the manifest's own slot mirrors `_carry_slot_take` on `$REG/.inflight.lock` (D-8362). |
| `_reg_purge`'s R-3 paragraph names every dot-prefixed artifact under `$REG` ("TWENTY-TWO …; the eight above are reachable, these fourteen are not"), and `ccd-account-auth.test.ts`'s `'names every dot-prefixed artifact the shipped bash actually writes'` derives the count from every `$REG/.<name>` literal in ccd's bash and reds on a paragraph that disagrees. Its `CARDINAL` list stops at `'TWENTY-TWO'`. `.carry.lock` is among the unreachable: "no id is the dash-free `.carry`". | `ccd/ccd` (the R-3 block before `_ws_project_valid`); `server/test/ccd-account-auth.test.ts` | `$REG/.inflight.lock` is a new one: Task 3 amends the paragraph and the list. |
| The swap runs, in order: `_end_record`, stop, graceful stop, kill, `sleep 1`, the beat, `_ci_resume_follow`, the uuid re-read, `_swap_carry_jsonl`, `_swap_carry_sidecars`, the task-list copy, `_swap_beat_stop`, the roster re-check, the flip, and at the tail `_limitwait_close … swap`. Two arms after `_end_record` stop the swap and restart the session on the source account (`_swap_refuse … 1`, logged `swap-refused <id>: …`): a failed carry without `--force`, and a target that left the roster at the re-check. | `ccd/ccd#cmd_swap`, `#_swap_refuse` | The swap site, and the reading's `refused_restart`. |
| `_watchdog_resume_here` writes `_end_record … limit-resume` and dispatches `_watchdog_resume_run` in a transient unit. It then closes the limit-wait record `end=resume` at once. The unit's body is: stop, graceful stop, kill, `sleep 1`, `supervised`, `cmd_ensure`. A closed record is never removed: it stands until the next episode overwrites it. `_limitwait_open` keeps a `HARD_BLOCK_RESET` even when it has passed, so `reset` can be before `since`. | `ccd/ccd#_watchdog_resume_here`, `#_watchdog_resume_run`, `#_limitwait_close`, `#_limitwait_open` | The limit-resume site, and its `wait=` read. |
| The supervise loop's only exit is `gone`. It calls `_end_note_gone`, which keeps a swap end of the last 60 s, then exits 1 for systemd's restart. | `ccd/ccd#cmd_supervise`, `#_end_note_gone` | The revival site. |
| `_end_record` is called at exactly the three sites above. A hibernate writes no `ended` line, and refuses unless the turn marker reads `done` with `bg` and `crons` exactly 0. | `ccd/ccd#_end_record`'s callers, `#cmd_hibernate` | Why the hibernate writes no manifest, and why `ended` lines are the instrument's restarts. |
| The sidecar's layout and the finished rule (D-5561): `S/subagents/workflows/<runId>/journal.jsonl` (no timestamps), `agent-<id>.jsonl` and `agent-<id>.meta.json` (written once, at its start); `S/workflows/<runId>.json`, the summary (final statuses `completed`, `failed`, `killed`); and `S/workflows/scripts/<name>-<runId>.js` for an inline-script launch. A retry writes a new `started` with the same key and a new agent id. `decideRun` takes mtimes only; `read.ts` feeds it `summaryMtime` from a stat of the summary file, whatever the file holds. | `server/src/workflows/model.ts#foldJournal`, `#decideRun`, `#parseSummary`; `server/src/workflows/read.ts` | Task 2's join, and its parity test. |
| A background Agent's transcript is `S/subagents/agent-<agentId>.jsonl`. | `server/test/fixtures/delegation/*/` (`agent_transcript_path`) | Task 2. |
| The ccd side's one transcript reader is `ccd/lib/transcript.jq`. Its `complete` accepts any non-error assistant row whose `stop_reason` is a string, `tool_use` included: it is the continued-in follow rule, not "the turn finished". Its `limit_banner` reads the newest real row, stepping over chatter, takes a rate-limit row as top-level `isApiErrorMessage:true` with `error:"rate_limit"`, and CLEARS its candidate on a line that does not parse (fail closed); `last_turn_ts` steps over such a line. | `ccd/lib/transcript.jq#complete`, `#limit_banner`, `#last_turn_ts`; `ccd/ccd#TRANSCRIPT_JQ_LIB` | `agent_end` extends it, and tests `end_turn` itself. |
| The response shapes, from the 2.1.319 corpus. Agent: `status: async_launched`, `isAsync`, `agentId`. Workflow: `runId`, `taskId`, `scriptPath`, `transcriptDir`, `status`. No captured payload carries `resumeFromRunId` or `SendMessage`. `SendMessage`'s input keys are `to`, `message`, `summary` and `notify_when_idle` (the tool's schema). | `server/test/fixtures/delegation/2.1.319/` | Task 1 reads only `to`. |
| `limitwait` records: `state=open since= reset= account= sign=[ choice=wait at=[ by=auto]]`, or `state=closed … end=<word> until=`. | `ccd/ccd#_limitwait_open`, `#_limitwait_close` | The `wait=` token. |
| `deploy/measure-continuity.py`'s `carry_section`, `stage3`, `stage4` and `stage7` each open swap.log and catch only `FileNotFoundError`. | `deploy/measure-continuity.py#stage3` and the others | D-8353. |
| `carry-dedupe.py` ships through `ccd/ccrc` (install, backup, uninstall), `deploy/deploy.sh` (install, backup) and `server/test/installTreeFixture.ts`. `ccd-carry-dedupe.test.ts` pins this. | those files | Task 2 adds a twin. |
| Growth: `GROWTH_LIMIT` 40, over `ccd/ccd`, `ccd/ccrc`, `ccd/session-hook.sh` and `ccd/lib/*.sh` only. | `server/test/growthCheck.ts` | COORDINATOR note 6. |

## What this does not claim

- **Nothing reads either file.** There is no prompt item: `ccd/ccd#_resume_prompt_for` is unchanged. There is no
  session-start subject, no server route, no FleetIO read and no stall-watch arm. Those are 6c's. The only readers are
  `--stage 3`, which reads swap.log lines, never the files themselves, and the tests.
- **No arming marker, and no switch to turn the writers off.** A bad manifest is bounded by its priced read budget
  and its time bound, and never ends the verb. Removing it takes a deploy.
- **No manifest at a hibernate, a stop or an archive** (D-8361).
  - **Hibernate.** It refuses unless the turn marker reads exactly 0 background tasks, so nothing it stops is in flight.
    The wake that follows is a spawn, and spec §8 rules out the spawn path as a site.
  - **Stop and archive.** `cmd_stop` and `ws-archive` are restarted by the operator only (D-8327).
- **Each restart a site reaches rewrites `.inflight`, and only those.** A measured write holds its items; an
  `unmeasured` or `not-applicable` write holds its header alone; a write that cannot write the file removes it. So the
  file never shows an earlier site-reached restart's items as the latest site-reached restart's, and its absence means
  no manifest was written at the latest restart a site reached (D-8374).
  Restarts no site reaches write no `ended` line and no manifest, so the previous manifest, items included, still
  stands as the file: a box reboot or any `_svc_stop` (the supervisor dies by SIGTERM, `cmd_supervise` sets no trap,
  so it never reaches `_end_note_gone`), a hibernate's wake, a `cmd_stop` then `ensure`, and an archive restore. 6b
  reads only swap.log, so nothing here is misread; **6c, which reads the file, must compare the header's `at=` (and
  `gen=`) against the session's latest spawn before trusting its items.** One case is not closed: a path that is
  neither writable nor removable (a directory at `$REG/<id>.inflight`) keeps what stands there, and the log line says
  `why=error`.
- **Script paths are kept only for inline-script launches.** A row keeps the path only when it lies in this
  session's sidecar under `workflows/scripts/` (D-8365). This covers an inline-script launch and
  wave 5's R5 resume. A launch by a file path, and wave 5's R3 resume (a working-directory copy), keep their row but no
  path. Write time checks the path lexically. Read time checks it by `realpath`.
- **The resume row's response shape is inferred, not captured.** No hook capture carries `resumeFromRunId`. Wave 5's
  text results show a resume returning the same fields as a launch. A resume whose response is not `async-launched`
  writes a counted `drop` row (`why=shape`), so a shape that differs is read as drops, never as zero resumes.
  - A refused call (`tool_use_error`) fires no PostToolUse, so it writes no row.
  - `SendMessage`'s PostToolUse payload is not captured either. Its row reads `to` alone.
- **What 6b can count of resume attempts (call 4).** It counts `resume` and `send` rows, and the `resumed=` token
  counts items with one. A session can make these by hand, or on its own after Claude Code's stopped-task
  notification, which suggests `Workflow({scriptPath, resumeFromRunId})`. It cannot count:
  - refused calls;
  - a subagent's calls;
  - a SendMessage to a name rather than an agent id (a name inside the id grammar writes a `send` row that joins no
    agent, which the manifest retires; one outside it writes nothing; D-8402).

  `deferred-until-reset`'s `reset` is the deciding rate-limit row's own `quotaLimits.resetsAt` (spec §5.3's
  `<resetsAt>`), read by `agent_end`; where no deciding row carries one, the session's limit-wait reset when Task 3
  step 2 accepts the record; otherwise `-`.
- **A subagent is told by the join file.** A launch whose `agent_id` the session's `$REG/<id>.joined` names is a
  subagent's and writes nothing; any other is the main thread's, as for the turn marker. A subagent whose
  SubagentStart was never joined (a lost join, a non-plain id) therefore has its launches recorded as the main
  thread's (D-8364).
- **Rows of another uuid retire.** A `/clear` or a continued-in chain changes the session's uuid, and rows from before
  the change retire uncounted as items (counted as `retired`).
- **A sidecar-only run is seen only while its journal changed in the last day.** A background Agent that the record
  missed is not seen at all.
- **The record's cap is 1 MiB, about 3,000 rows** (D-8366). A session that makes more background
  launches than that between restarts loses the rest. They are counted (`drop-budget`) only until the 4 KiB reserve
  is spent, about 90 drop rows; beyond it, launches are lost uncounted until the next manifest compacts the record.
  Parallel PostToolUse appends that each passed the size check can carry the file past `MAX + RESERVE`; the manifest
  reads no further and counts what lies past it once in `drop-budget`. An append that races the compaction can be
  lost. By then the stop has ended Claude Code, so the window is a hook child that outlived it.
- **6b-1 alone (between 6b-1's deploy and 6b-2's).** Nothing compacts `.deleg` until 6b-2 ships `_inflight_write`, so
  each session's record only grows in that interval, bounded by its budget alone. A session that reaches
  `LRC_MAX_BYTES + LRC_DROP_RESERVE` in the interval loses its later launches uncounted until its first 6b-2
  manifest. Each session's first 6b-2 manifest then classes the whole backlog: older unfinished items arrive at once
  as `abandoned`, and runs killed on purpose meanwhile read `in-flight` (D-8370). That
  first manifest per session inflates `restarts_with_items` and `items_by_class` in the week call F re-cuts §9 from,
  so `--stage 3` reports it apart (`first_manifests`, Task 4), and the re-cut subtracts it. Keep the gap between the
  two deploys short.
- **One manifest at a time on the box, in a slot of its own** (R-A, D-8362, amending call I). The
  manifest holds `$REG/.inflight.lock`, never the carry's `$REG/.carry.lock`, for its program run, at most
  `INFLIGHT_TIME_S` plus the grace. So no carry is ever refused by a manifest and no existing act changes; only the
  three timings below do. The cost stays inside the shadow: a second manifest anywhere on the box in that time (a
  mass rescue's swaps, say) writes `unmeasured why=busy`, which `--stage 3` counts in `unmeasured_by_why.busy`. The
  daily carry-dedupe (#317) no longer makes a manifest busy, and a manifest no longer makes the dedupe answer
  `locked`. The manifest reads beside a carry or a dedupe without a lock between them, which needs none: a carry
  touches one session's sidecars and is called from `cmd_swap` alone, where the manifest follows its own session's
  carry in the same process, and the limit-resume and revival sites carry nothing. The dedupe changes only copies on
  an account other than its keeper (`carry-dedupe.py#keeper`: the live row's account, else the registry rows'
  wrapper, which is the root those two sites read), and skips a uuid a swap.log line named in its window, re-checked
  after its lock, so a swap's fresh carry is skipped. What is left is a race the manifest only reads through: a
  file that changes under its read is read as it stands, or as `unread`.
- **A run the manifest cannot prove finished reads as in flight.** A `killed`, non-final or unparseable summary is not
  finished here, where the server reads any summary file no older than the journal as finished. So a run the operator
  killed on purpose is listed too (D-8370). The `killed=` token counts them, which measures
  whether the stop writes `killed` summaries at all.
- **The swap's roster refusal restarts on the source account after its manifest.** The manifest is written at the
  destination root before `cmd_swap`'s roster re-check. When the target leaves the roster there, the session restarts
  on the source account, and the manifest already written names the destination root's copies of its paths. The
  reading counts that restart in `refused_restart`. A failed carry without `--force` refuses before the manifest, and
  is counted there too.
- **A forced swap whose transcript copy failed reads `not-applicable`.** The manifest looks under the destination
  root, where the restarted session has no transcript to resume into; the source root's items are not listed.
- **§9's split between stalled and not-stalled restarts is not read** (D-8378). The
  redrive's `not-stalled` word cannot tell a session that Claude Code redrove from an idle one. 6c's wake reads the
  split.
- **Not pinned or edited here:**
  - **The Workflow resume strings.** 6b relies on none of them, so 6c pins them (call A).
  - **Review 1458's minors B1 to B4** stay carried: stage 6 is not touched.
  - **The live arm's residuals** (D-8350, D-8351, D-8352 and the start-time anchor) are still owed before
    `graceful-stop-live` is armed.
  - **The comment owed to review 729** is in `_spawn_settle`, which this wave does not touch.
- **The wake after a swap.** Wave 5's idle-session case is recorded (its in-flight items are listed like any other),
  and 6c acts on it.
- **Background shells are not listed in the manifest** (D-8377). Spec §5.3 lists the
  shells the stop kills. They already have one writer: the hook carries a stopped session's background shells across
  its restart in the turn marker (`lostBg`, `lostKinds`, `lostIds`, from the stop's `bg`/`bgIds`, across a `failed`
  turn since D-8316). A copy in the manifest would be a second writer of that fact. 6c's composer, which re-arms the
  watchers, reads the marker.
- **Exec kinds are not split.** `not-applicable` is keyed on the measured transcript (call H, D-8331).
- **Timing costs, each bounded:**
  - one `python3` run (bounded by `INFLIGHT_SCAN_BUDGET` and `INFLIGHT_TIME_S`) and one `jq` run per manifest. It runs
    inside the swap's restarting window (`_swap_beat` keeps the row `restarting`), between the limit-resume's
    `supervised` stamp and its `cmd_ensure` (after the stamp, so the row's freshness against `SUPERVISED_FRESH_MS`,
    120 s, is not spent on the manifest: that site has no `_swap_beat`), and before the supervisor's `exit 1`;
  - **the manual swap's 300 s exec kill.** A swap the PWA drives runs under the agent's exec deadline
    (`server/src/remote/runner.ts#CCD_VERB_TIMEOUT_MS`, `swap: 300_000`), whose own comment names a kill in that window
    as leaving a session down, its registry naming the old account, and no marker. The carry before the manifest has
    no bash-side bound. The manifest adds up to `INFLIGHT_TIME_S` plus `_plat_timeout`'s grace (about 33 s with the
    provisional 30 s, about 11% of that deadline), plus its unbounded pre-slot reads (the registry, `.limitwait`, the
    transcript listing). The provisional 30 s is weighed against that budget: it is not raised without re-measuring
    the swap's slack;
  - in the hook, one `wc -c` fork for each append once the record exists (a pair is one append), and over budget one
    subshell for the drop row's time (D-8403);
  - in the hook, the `DSP_DEFS` compile (about 11 ms of CPU) on every payload quoting `"SendMessage"` where the spool
    directory exists (every ccd-spawned session, note 7), and, where it is absent, on a PostToolUse of Agent, Task,
    Workflow or SendMessage. Every other event compiles the parse alone, as on main;
  - in the hook, one bounded builtin read of `$REG/<id>.wrapper` and the `lrec` evaluation on each of those
    PostToolUse events, and, where the spool directory exists, on every event the prefilter matches, Bash included,
    where the `DSP_DEFS` compile is also longer by the launch record's defs (together about +1.2 to +1.5 ms on a Bash
    PostToolUse, D-8400); the generation read on every event of a session with a generation file; and the `.deleg`
    type tests on every event.

## Global Constraints

- **Public repository.** Fixtures and text use `lane-a`, `project-a`, `lane-a-project-a` and `the fleet box`, and
  run ids of the measured shape (`wf_0123abcd-0ab`). Run the private-name scan before every push.
- **Read the readers first.** Before editing a file, run `grep -ln '<its name>' server/test` and run each reader alone.
  Ask the coordinator for any file outside this plan's lists in one mail, before building.
- **Fixture HOMEs only** (`makeCcdHarness`). Never run `ccd` against the live HOME, and never write `.deleg`,
  `.inflight`, `.inflight.lock` or `.carry.lock` outside a fixture. A test that spawns `bash` with a timeout uses
  `server/test/spawnGroup.ts#spawnSyncGroup`.
- **Privacy.** Rows, items, headers and log lines hold ids, paths, times, class words and counts only. They never hold a
  prompt, a message, a script's text, a tool result or an agent's text. Each writer's suite plants sentinels.
- **The hook.**
  - The parse stays two physical lines, edited in place.
  - Nothing is added above `ccd/session-hook.sh#@compact-arm-emit-call`.
  - New code goes in a `# >>> launch-record` block directly after `# <<< delegation-spool`.
  - No jq regex builtin, because jq may be built without Oniguruma.
  - The spool's lines stay byte-identical: `delegation-spool.test.ts` passes with only its prefilter row changed.
- **`ccd/ccd`.**
  - No restamp: `grep -c '^# ccrc:generated' ccd/ccd` prints 0.
  - Every new function has one `ccd/contexts.tsv` row, and every new cross-context call is one sorted line in
    `ccd/contexts-edges.tsv`.
  - No new function `die`s.
  - No new `_reg_get` call: use `_reg_get_to` and `_reg_read_to`.
  - A `# shellcheck` directive directly above an existing function stays directly above it.
- **The program** runs as `python3 -I` under `_plat_timeout`, uses the standard library only, and writes nothing. It
  opens a path only after `os.lstat` says `S_ISREG`, and opens it with `O_NOFOLLOW | O_NONBLOCK`, so a FIFO, a device
  or a link at any path it reads is never opened (`ccd/lib/carry-dedupe.py`'s `S_ISREG` checks are the precedent). ccd
  writes both files through `_reg_set`, the registry's one writer.
- **Growth.** Run `git fetch origin main`, then `growth-check` with `GROWTH_CHECK=1`, and report each file's net delta.
  A file over 40 gets the waiver its task names.
- **Tests.**
  - Run each from `server/` as `"$HOME/.local/bin/ccrc" test -- ./node_modules/.bin/vitest run --maxWorkers=2
    test/<file>.test.ts`, in the foreground, with a timeout of at least 600000 ms, one at a time.
  - Run `typecheck-tests` alone.
  - Run `npm ci` in `server/` first.
- **Mutations.**
  - Each new guard has a row, measured red when mutated and green when restored.
  - Rows run one at a time, under `timeout -k` and a measured `ulimit -u`.
  - Restore from a saved copy with its sha256 checked, never `git checkout`.
  - Logs go under `.superpowers/sdd/`.
- **Files this wave does not edit:** `CLAUDE.md`, the ledger, `server/src`, `shared/`, `pwa/` and `.github/`.
- **Words.**
  - Write "launch record" and "manifest".
  - Do not use the broker's `stale`, `adopt` or `delegation` for this wave's things. `delegation-spool` is the existing
    block's name.
  - Use `abandoned` only as the manifest class, never for the run abandon door.
  - Do not use the wave-done's `handoffCommit`.
- **Commits** go on the workspace's own branch. No rebase, force-push or update-branch. A departure found during
  execution is named by slug in the wave-done.

## Review Focus

Each item is tagged with the run whose reviewer reads it: **[6b-1]** is Task 1's PR, **[6b-2]** is Tasks 2 to 4's.

1. **[6b-2] Work the stop cut short is never retired as finished.** Each of these reads `in-flight` or
   `stopped-agent`:
   - a `killed`, non-final or unparseable summary;
   - no summary;
   - a journal newer than its summary (a run resumed in place);
   - an agent whose newest row is an assistant `tool_use` row with no tool result after it, or whose window ends in a
     torn line (`agent_end` answers `open`, never `finished`: `finished` is `end_turn` alone, not `complete`, and a
     torn final line is evidence the agent was still writing).

   Task 2: `'a killed summary reads in flight …'`, `'stopped-agent: …'`, `'a torn last line …'`, `'agent_end: …'`, and
   the parity table's pinned differences.
2. **A row the hook should not trust never becomes an item.** That covers a joined subagent's own hook input, an id
   (the payload's `session_id` included) outside the grammar, and a script path outside this session's sidecar.
   - **[6b-1]** checked lexically at write. Task 1: the subagent, unjoined, id, uuid and path rows.
   - **[6b-2]** checked again by `realpath` at read, which catches a symlink out. Task 2: `'validation at read …'`.
3. **[6b-2] An answer that measured nothing never reads as `none`, and no class is computed from absent evidence.**
   `busy`, `budget`, `time`, `error`, `unread` and `not-applicable` are each their own word; an unlistable `projects/`
   is `error`, not `not-applicable`; an item whose deciding files cannot be read is `unread` before any class is
   tried, and ages out as `unread-expired`, never as `abandoned`; and a restart that wrote no manifest, or was refused
   back to its source account, is told apart in the reading. Task 2: `'unread: …'`. Task 3: the busy, budget, time,
   error, unread and not-applicable rows. Task 4: `never_written_by_cause` and `refused_restart`.
4. **The restart is never broken or held by the manifest, and the hook never drops an event.**
   - **[6b-2]** `_inflight_write`'s body runs in a subshell, so no `exit`, `die` or `set -u` abort inside it ends
     the caller; it releases its own slot explicitly on every way out, before its log line, and the subshell's exit
     closes the descriptor too. Since that exit hides a missing release from any probe after the call returns,
     `'releases the slot …'` probes from inside the subshell (an `_inflight_note` override), and IF-RELEASE is
     measured red there.
   - **[6b-2]** It never takes, waits on or names the carry's slot: it takes `$REG/.inflight.lock` alone, so no carry
     is ever refused by a manifest (R-A, D-8362).
   - **[6b-2]** Its read is priced before it starts, bounded in time, and opens regular files only: a FIFO at any
     path it reads holds nothing.
   - **[6b-2]** The swap still lands, the limit-resume still runs `cmd_ensure`, and the supervisor still exits 1.
   - **[6b-1]** `lrec` prints exactly one line on every event, so the parse's last `read` never fails on its account;
     every launch event (a Workflow, an Agent, a path failure, a full record, a spent reserve, an orphan removal) still
     writes its hookstate; and the hook's new per-event reads on the hot path of every Agent, Task, Workflow and
     SendMessage PostToolUse (and, where the spool directory exists, on every event the prefilter matches, D-8400),
     `$REG/<id>.wrapper` and the generation read made without the spool directory, are builtin, bounded and
     regular-file-only, so a FIFO or a link to `/dev/zero` there never blocks.

   Task 1: `'every event still writes its turn marker and hookstate …'`, `'every launch event still writes its
   hookstate …'` and the wrapper row. Task 3: `'never dies …'`, `'releases the slot …'`, `'its own slot …'`,
   `'a FIFO …'`, the three end-to-end rows, and IF-OWNSLOT.
5. **Nothing grows without bound, and nothing is dropped uncounted until the reserve is spent.**
   - **[6b-1]** The record has a budget, plus a reserve that only drop rows may use; each drop says why (`id`, `path`,
     `budget`, `shape`). Past the reserve, launches are lost uncounted until the next manifest compacts (named under
     "What this does not claim"; in 6b-1 alone nothing compacts).
   - **[6b-1]** A purge that races an append leaves no `.deleg` behind.
   - **[6b-2]** The compacted record ends in a newline, so the next append never joins a kept row.
   - **[6b-2]** Items past the file's budget are counted and kept for the next write.
   - **[6b-2]** An `abandoned` item is reported once, then retired, and only after its last activity, not its launch,
     is older than the window; an `unread` item past the window retires as `unread-expired`.

   Task 1: the budget, purge and drop rows. Task 2: the item budget, abandoned and unread rows. Task 3: the
   compact-then-append row.
6. **[6b-2] Call G's count reads only the record this restart stands in.** The `.limitwait` read behind `wait=`: the
   account match; open, or closed `end=resume` within `INFLIGHT_WAIT_CLOSED_S` at the limit-resume only; a passed reset
   clamped to 0; an open wait with no dated reset written `undated`, never `-`; and `?` on unreadable. A wrong
   acceptance rule double-counts or misses weekly waits silently. Task 3: IF-WAIT, IF-RECENT, IF-WAITAGE, IF-CLAMP and
   IF-UNDATED, and the four `'wait: …'` cases.

**Task order:** 1 (run 6b-1, merged first), then 2, 3, 4, 5 (run 6b-2).
- Task 2's round trip reads rows that Task 1's hook wrote.
- Task 3 runs Task 2's program.
- Task 4's real-writer row needs Task 3's `_inflight_note`.

---

### Task 1: The launch record: one parse, a second output, an append under a budget

**Files:**
- Modify `ccd/session-hook.sh`.
  - **The statement before the parse (in place).** `DSP_DEFS` gains `def lrec` ahead of `def spool:`. `def spool` and
    every def it reads are unchanged, so the spool's lines stay byte-identical. `lrec` reuses `isid`, `fits`, `obj` and
    `outcome`, and reads the raw response itself (COORDINATOR note 7).

    The defaults gain `lrc_out=', ""' lrc_w="" lrc_ok=""`. The gate changes:
    - it reads the generation when the id is sane and `$REG/$id.generation` is a regular file and not a link, without
      requiring the spool directory;
    - it keeps the directory tests as the spool's own condition, in a flag (`dsp_sp=1`);
    - it sets `lrc_ok` when `$REG/$id.deleg` is absent, or a regular file and not a link. The absence test comes first
      (D-7448's order).

    The prefilter's word list gains `*'"SendMessage"'*`. Its arm:
    - compiles `dsp_defs` when `dsp_sp` is set, or when `lrc_ok` is set and the payload also quotes `"PostToolUse"`
      and one of `"Agent"`, `"Task"`, `"Workflow"` and `"SendMessage"` (a nested `case`, builtins only);
    - sets `dsp_out` only when `dsp_sp` is set;
    - when `lrc_ok` is set and `dsp_defs` was compiled, sets
      `lrc_out=', ([try lrec catch ""] | if length == 1 and (.[0] | type) == "string" then .[0] else "" end)'` and
      reads `$REG/$id.wrapper` into `lrc_w`, using a builtin bounded read (`read -r -N 65`) behind `-f` and `! -L`
      (absence first, as for `.deleg`), so a FIFO, a link or a device there is never opened. `lrec` writes `w` only
      when `$wr` passes the wrapper class (checked with `explode`), else `null`.

    Keep `DSP_DEFS='…'; dsp_dir=` adjacent, and keep the `CAP_STMT` span intact.
  - **The parse line (in place).** It gains ` read -r lrc_line;` after ` read -r dsp_line;`, `--arg wr "$lrc_w"` after
    `--arg ver "$dsp_ver"`, and `"$dsp_out$lrc_out"` where `"$dsp_out"` stood. Its trailing comment says the last line
    is the launch record's and is always exactly one line.
  - **A new `# >>> launch-record` block** directly after `# <<< delegation-spool`. It holds a header comment,
    `LRC_MAX_BYTES=1048576 LRC_DROP_RESERVE=4096` (D-8366; in 6b-1 the only spelling, and
    `ccd/ccd`'s spelling and the equality pin arrive with Task 3), `_hook_launch_record_append`, and its call
    `[[ -n "$lrc_line" && -z "$tmsub" ]] && { _hook_launch_record_append || true; }`. The `|| true` guards an rc, not
    a `set -u` abort (the hook runs under `set -uo pipefail`), so every variable the append expands is set first or
    expanded with a default; `'every launch event still writes its hookstate …'` and LR-ABORT hold that.
- Modify `ccd/ccd`, `_reg_purge` only (D-8367): its post-generation
  `rm -f "$REG/$id.joined" "$REG/$id.joinedprev"` gains `"$REG/$id.deleg"` as a third operand, and its refusal branch
  names `.deleg` too. The comment's field list gains `deleg` (53, by addition), and the paragraph on the two-sided
  purge names the launch record beside the join record. No constant is added to `ccd/ccd` in this task (COORDINATOR
  note 4).
- Create (test) `server/test/session-hook-launch-record.test.ts`, modelled on `delegation-spool.test.ts`'s fixture:
  the hook run for real, a stub tmux, the row's generation and the pane's `CCRC_SESSION_GENERATION`.
- Modify (test) `server/test/delegation-spool.test.ts`: the prefilter row's expected word list gains `SendMessage`, and
  its title adds ", and the launch record's continuation tool (session-continuity 6b)".
- Modify (test) `server/test/session-hook-turnmark.test.ts`, in the three-pieces case:
  - the `between` open literal gains the additions above;
  - `endsWith` becomes `else "" end)'"$dsp_out$lrc_out`;
  - it adds `lrcOut = between("lrc_out=', (", ")'")` with `toContain('try lrec catch')`;
  - `regexCalls(lrcOut)` equals `[]`.
- Modify (test) `server/test/ccd-lifecycle-purge.test.ts`, measured before the change. In `'it is the LAST unlink, ONE
  rm call for both names …'` two expectations move, both naming the last call's string:
  - the last-call pin, `` `${id}.joined ${id}.joinedprev ` `` becomes `` `${id}.joined ${id}.joinedprev ${id}.deleg ` ``;
  - the filtered list `'the loop took each first, one call apiece'`: its third element becomes the same string (the
    first two stay, because the loop's `rm -f "$f"` of `.deleg` names neither `.joined ` nor `.joinedprev `);
  - the title's "for both names" becomes "for the three names" (the join record's two and the launch record).

  Plus the appended describe below.
- Modify (test) `server/test/single-definition/switches-history.test.ts`, with one APPENDED `describe('the launch
  record: one appender, one purge, and no reader in the tree (session-continuity 6b)')`. It matches the registry
  spelling only, never the bare word (`.delegation…` already stands on main): in bash, `"$REG/$id.deleg"`-shaped
  paths and the field word after `_reg_set "$id" ` (`deleg`, with a word boundary after it); in Python and TypeScript,
  `.deleg` directly followed by a quote or a backtick. It checks four things:
  - a positive control: a planted fixture line of each spelling is matched;
  - in `ccd/session-hook.sh`, every code line naming `.deleg` is the gate statement before the parse (the one physical
    line holding `DSP_DEFS=`) or a line inside `_hook_launch_record_append` (its type test, its size read, its append
    and its orphan removal), a closed set of sites, never a count of lines;
  - in `ccd/ccd`, the only code line naming it is `_reg_purge`'s post-generation `rm` (Task 3 adds one more, its one
    `_reg_set "$id" deleg` line, to this set);
  - no file under `server/src`, `shared` or `pwa/src`, and not `deploy/measure-continuity.py`, names it, measured green
    on `origin/main` first.

**Interfaces:**
- **Produces the row grammar** that Task 2 validates. Each row is one JSON line, `{"v":1,"t":<epoch ms>,"k":<kind>,…}`,
  with exactly these further keys:
  - `workflow` and `resume`: `w`, `uuid`, `run`, `task`, `script`;
  - `agent` and `send`: `w`, `uuid`, `agent`;
  - `drop`: `why` (`id`, `path`, `budget` or `shape`).

  The values:
  - `w` is the registry wrapper when it matches `[A-Za-z0-9._-]{1,64}`, else `null`.
  - `uuid` is the payload's `session_id`, which must pass `isid` for every due row, as the spool requires of `$cs`
    before it writes any line (`ccd/session-hook.sh#DSP_DEFS`, `def spool`). One that fails prints the `why=id` drop
    row and no row, so no row reaches the file whose bytes are not ASCII or whose length passes `DSP_LINE_BELOW`
    uncounted.
  - Ids match the parse's `isid` (`[A-Za-z0-9_-]{1,64}`).
  - `script` is a path or `null`. `null` means only one thing: the path failed the write-time check (absent, over 512
    bytes, or outside this session's sidecar).

  Every byte of a row is ASCII (ids, the uuid, the wrapper and the path byte class are ASCII), so `${#line}` is its byte length.
- **What `lrec` prints.** Exactly one string on every event, which `jq -r` prints as exactly one line:
  - `""` when no row is due (every event but the PostToolUse cases below, and every one of those that is not a launch);
  - one row;
  - for a path failure only, a `drop` row (`why=path`), one TAB, then the row with `script: null`. A TAB never occurs
    inside `tojson`'s output, which escapes control characters.

  The wrapper in `lrc_out` turns an `empty`, a second output or a non-string into `""`, so the parse's last `read`
  always gets its line (the parse ends `|| exit 0`, and a missing line would drop the whole event).
- **When a row is due.** Only on PostToolUse, with the generation gate passed. `lrec` decides from the raw fields, never
  from the spool's `launch`:
  - `workflow`: a Workflow whose raw `tool_response.status` reads `async-launched` through `outcome`, with no
    `tool_input.resumeFromRunId`;
  - `resume`: the same with `tool_input.resumeFromRunId` present, which becomes `run`;
  - `agent`: an Agent or Task whose outcome is `async-launched` and whose raw `isAsync` is `true` or absent (the spool's
    normalisation rule, applied to the raw field);
  - `send`: a `SendMessage` whose `tool_input.to` is id-shaped.

  `taskType`, `workflowName` and `transcriptDir` are never read: a 129-byte `workflowName` still writes its row. The
  drop and skip rules:
  - A row due whose `uuid` (the payload's `session_id`), `run` (the response's `runId`, or for a resume the input's
    `resumeFromRunId`), `task` or `agent` fails `isid`, or is absent, prints one `{"v":1,"t":…,"k":"drop","why":"id"}`
    and no row.
  - A row due whose `scriptPath` fails the check below prints the `drop` row (`why=path`), a TAB, and the row with
    `script: null`. So each failure is counted once, by a `drop` row that the next manifest sums and removes.
  - A Workflow with `tool_input.resumeFromRunId` present whose outcome is not `async-launched` prints one `drop` row
    (`why=shape`): a resume response of another shape is counted, not lost.
  - A `to` outside the grammar prints `""`: it names a peer, not an agent.
  - Every `as` in the new def is parenthesised on its own (`session-hook-merge-deny.test.ts`'s `jqAmbiguousAs`).
- **The main thread.** `lrec` never reads `agent_id`. The append runs only when `tmsub` is empty: the hook's join test,
  the turn marker's rule, sets it when the payload's `agent_id` is a line of `$REG/<id>.joined` or `.joinedprev`. An
  event with no `agent_id`, or with one nothing joined, is the main thread's (amendment
  `tool-agent-id-alone-is-unjoined-evidence`, D-8364).
- **The write-time path check.** `script` is kept only when all of these hold:
  - `transcript_path` is absolute and ends `/<session_id>.jsonl`;
  - the path equals `<that path minus .jsonl>/workflows/scripts/<name>`;
  - `<name>` matches `[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}\.js`;
  - every byte is in `[A-Za-z0-9._/@+-]`;
  - no `.` or `..` segment and no `//`;
  - at most 512 bytes.

  Checks use `explode`, not `test()`.
- **`_hook_launch_record_append`.** Always rc 0. The caller's `|| true` is a guard. It splits `lrc_line` at its first
  TAB by parameter expansion (no fork) into one or two lines. It writes `"$REG/$id.deleg"` only when all of these hold:
  - the file is absent or regular, and not a link (absence first);
  - `$REG/$id.generation` re-read equals `dsp_gen`;
  - each line is under the parse's `DSP_LINE_BELOW`;
  - the size (one `wc -c <` when the file exists) plus every line plus one newline each is at most `LRC_MAX_BYTES`.

  Both lines go out in one `printf '%s\n%s\n'` (one line: `printf '%s\n'`), one `write(2)` per line (D-8401). Over
  budget, it appends one budget `drop` row instead, timed by `_hook_epoch_ms` (never a bare `$EPOCHREALTIME`: it is
  bash 5.0+, the hook's floor is 4.4, and a bare expansion under `set -u` aborts the hook, as the comment at
  `_hook_timeout` warns), only
  when the size plus that row plus its newline is at most `LRC_MAX_BYTES + LRC_DROP_RESERVE`, so a sequence of appends
  never passes that sum (parallel PostToolUse appends that each passed the check can; Task 2 counts what lies past it).
  AFTER the write it tests `$REG/$id.generation` once more and, if the row is gone, removes
  `$REG/$id.deleg`: with `_reg_purge`'s post-generation unlink, whichever side of the generation's removal the append
  lands on, one of the two sees it (the join record's rule).

- [ ] **Step 1: Write the failing tests** in `session-hook-launch-record.test.ts`. `rows()` parses the record.
  - `'a background Workflow launch appends one workflow row: time, wrapper, uuid, run, task and script, and nothing else of the payload'`.
    `rows()` toEqual `[{ v: 1, t: expect.any(Number), k: 'workflow', w: 'lane-a', uuid: SID, run: 'wf_0123abcd-0ab',
    task: 't1', script: `${SIDECAR}/workflows/scripts/x-wf_0123abcd-0ab.js` }]`.
  - `'a launch whose workflowName or taskType is 129 bytes, or whose transcriptDir is absent, still appends its row'`.
  - `'a resumeFromRunId call appends a resume row naming the resumed run'`: `k: 'resume'`, and `run` is the input's id.
  - `'a resumeFromRunId call whose response is not async-launched appends one drop row, why shape'`.
  - `'a background Agent appends an agent row; a completed one, or one whose isAsync is false, appends none'`.
  - `'a SendMessage to an id-shaped target appends a send row; a target such as "worker [3fa9c1]" appends nothing'`.
  - `'a joined subagent\'s own PostToolUse appends nothing, for every kind'`: the payload's `agent_id` is a line of
    `$REG/<id>.joined`.
  - `'a main-thread launch carrying an agent_id nothing joined appends its row'`.
  - `'a launch whose run, task or agent id is outside the grammar, or absent, appends one drop row, why id, and no launch row'`.
  - `'a launch whose session_id fails isid (a non-ASCII byte, 65 bytes, absent) appends one drop row, why id, and no launch row'`.
  - `'a FIFO, a link, a directory, an over-long or an out-of-class value at $REG/<id>.wrapper writes w null and never blocks'`,
    under `spawnSyncGroup` with a timeout; a well-formed `lane-a` writes `w: 'lane-a'`.
  - `'a script path outside this session\'s sidecar keeps the row with script null, after one drop row with why path, both lines in the file and both parsing'`.
    Use `it.each` over:
    - a working-directory copy;
    - a `..` segment;
    - another uuid's sidecar;
    - a name ending `.sh`;
    - a space in the path;
    - a 513-byte path;
    - no `scriptPath` at all.
  - `'every event still writes its turn marker and hookstate with the record on: a PostToolUse Bash, a PreToolUse Agent, a non-launch PostToolUse Workflow, a SessionStart and a Read'`.
    With `lrc_ok` set and no spool directory, each event's `$REG/<id>.turn.json` and hookstate are written as on main,
    and the record is unchanged.
  - `'every launch event still writes its hookstate with the record on: a background Workflow, a background Agent, a path failure, a launch against a full record, a launch against a spent reserve, and an orphan removal'`.
    These are the events that run the append (its TAB split, its `wc -c` fork, its budget and reserve arms, its orphan
    `rm`), which sits between the spool block and the hookstate write. Each event's `$REG/<id>.hookstate.json` is
    written as on main, so an abort in the append (a `set -u` expansion, which `|| true` does not catch) reds here.
  - `'the budget: past LRC_MAX_BYTES no row is written and one budget drop row is, until LRC_DROP_RESERVE is spent; every line in the file parses'`.
    Plant a record at `LRC_MAX_BYTES - 10` bytes. One launch then adds exactly one drop row. A record planted at
    `LRC_MAX_BYTES + LRC_DROP_RESERVE` gains nothing, and so does one planted at `LRC_MAX_BYTES + LRC_DROP_RESERVE - 1`
    (the drop row and its newline do not fit, so the file never passes the sum). A path failure whose two lines do not
    both fit adds one budget drop row and neither line.
  - `'a symlink, a directory or a FIFO at $REG/<id>.deleg is never written through'`. The FIFO case runs under
    `spawnSyncGroup` with a timeout, and nothing blocks.
  - `'a generation that changed between the parse and the append, or a pane generation that is not the row\'s, writes nothing'`.
  - `'an append that lands after the row was purged leaves no .deleg behind'`: plant a one-row `$REG/<id>.deleg` first,
    so the append forks its `wc -c` (it forks one only when the file exists); a `wc` stub on PATH removes
    `$REG/<id>.generation` (the purge's window) and then answers; afterwards `$REG/<id>.deleg` does not exist.
  - `'the launch record needs no spool directory, and the spool still needs its own'`. With no spool directory, the
    record gains its row and no spool bucket exists. With the directory present, both are written.
  - `'one parse: the same events fork jq exactly as often with the launch record as without it, and only an event that writes a row forks wc'`.
    A PATH stub `wc` logs its calls. A Read PostToolUse and a Bash PostToolUse fork no `wc`.
  - `'with no spool directory, only a PostToolUse quoting Agent, Task, Workflow or SendMessage compiles DSP_DEFS'`. A
    PATH stub `jq` logs the length of its program argument: a Bash PostToolUse, a PreToolUse Agent and a SessionStart
    log the parse's length alone, and a PostToolUse Workflow logs a longer one.
  - `'sentinels in the prompt, the message, the script text and the response never reach the record'`.

  Append to `ccd-lifecycle-purge.test.ts`: `describe('the launch record goes with the row (session-continuity 6b)')`,
  with `'_reg_purge removes <id>.deleg after the generation, and one appended in the window does not survive'`, in the
  shape of the join record's `APPEND_IN_THE_WINDOW` case.
  Append to `single-definition/switches-history.test.ts` the `.deleg` describe under Files.
- [ ] **Step 2: Run the new file, the purge file and `switches-history`, and confirm what fails.** Expected: FAIL,
  because no record is written and the purge's last call names two files. The switches-history block passes on
  `origin/main` (no `.deleg` spelling stands there yet) and is held by LR-DELEG instead. The pin edits are not made
  yet.
- [ ] **Step 3: Implement** the edits under Files, then make the pin edits.
- [ ] **Step 4: Run** the new file, then `delegation-spool`, `session-hook-turnmark`, `session-hook-merge-deny`,
  `session-hook-append-race`, `ccd-lifecycle-purge`, `ccd-workspaces`, `switches-history`, `hook-helpers-generated`
  and `shellcheck-ratchet`. Then run every other
  `test/session-hook*.test.ts` and `delegation-wave3.integration`, one at a time: `for f in test/session-hook*.test.ts
  test/delegation-spool.test.ts test/delegation-wave3.integration.test.ts; do "$HOME/.local/bin/ccrc" test --
  ./node_modules/.bin/vitest run --maxWorkers=2 "$f" || echo "RED $f"; done`. Expected: no `RED` line, and
  `shellcheck-ratchet` green with no baseline change. `session-hook` is a known load flake, so re-run a red one alone
  before calling it a break.
- [ ] **Step 5: Measure the mutation rows.**

| Row | Mutation | Expected red |
|---|---|---|
| LR-ONELINE | the `lrc_out` wrapper removed, and `lrec` yields `empty` for a non-launch | `'every event still writes its turn marker and hookstate …'` |
| LR-SUBAGENT | the append ignores `tmsub` | `'a joined subagent\'s own PostToolUse …'` |
| LR-UNJOINED | the append refuses any non-empty `agent_id` | `'a main-thread launch carrying an agent_id nothing joined …'` |
| LR-ID | `lrec` decides due-ness from the spool's `launch` | `'a launch whose run, task or agent id …'` (no drop row) |
| LR-LABEL | `lrec` requires `workflowName` | `'a launch whose workflowName or taskType is 129 bytes …'` |
| LR-SHAPE | the shape drop removed | `'a resumeFromRunId call whose response is not async-launched …'` |
| LR-PATH | the sidecar-prefix check dropped | `'a script path outside …'` (a working-directory copy keeps its path) |
| LR-TWO | only the first TAB-separated line written | `'a script path outside …'` (the row with `script: null` is missing) |
| LR-SYNC | `agent` rows for `isAsync` false | `'a background Agent …'` |
| LR-BUDGET | the size check skipped | `'the budget …'` |
| LR-RESERVE | drop rows written past the reserve | `'the budget …'` (the full record gains a row) |
| LR-LINK | `[[ ! -L … ]]` dropped from the append | `'a symlink, a directory or a FIFO …'` |
| LR-GEN | the generation re-read skipped | `'a generation that changed …'` |
| LR-ORPHAN | the post-append generation test removed | `'an append that lands after the row was purged …'` |
| LR-PURGE | `.deleg` removed from `_reg_purge`'s post-generation `rm` | the appended purge describe |
| LR-SPOOLDIR | `lrc_ok` also requires the spool directory | `'the launch record needs no spool directory …'` |
| LR-FORK | `wc -c` run before the row test | `'one parse …'` (a Read event forks `wc`) |
| LR-COMPILE | the nested `case` removed, so any prefilter match compiles | `'with no spool directory, only a PostToolUse …'` |
| LR-UUID | `lrec` drops the `session_id \| isid` test | `'a launch whose session_id fails isid …'` (a row is written) |
| LR-WRAPTYPE | `-f` and `! -L` dropped from the wrapper read | `'a FIFO, a link, a directory … at $REG/<id>.wrapper …'` (the FIFO case times out) |
| LR-WRAPCLASS | `lrec` writes `$wr` without the class check | `'a FIFO, a link, a directory … at $REG/<id>.wrapper …'` (the out-of-class value is written) |
| LR-RESERVEFIT | the reserve check tests the size alone, not size plus the drop row | `'the budget …'` (the record at `MAX + RESERVE - 1` gains a row) |
| LR-ABORT | an unset variable expanded bare in `_hook_launch_record_append`'s budget arm | `'every launch event still writes its hookstate …'` (the full-record event's hookstate is missing) |
| LR-DELEG | a second `printf … >> "$REG/$id.deleg"` added outside `_hook_launch_record_append` | the switches-history `.deleg` describe |

- [ ] **Step 6: Growth.** Run `git fetch origin main`, then `growth-check` with `GROWTH_CHECK=1`. Growth is measured
  per PR against its merge base (`server/test/growthCheck.ts`), and a waiver counts only when the same diff adds it
  (`#waiversAdded`), so 6b-1's PR carries its own. The expected net delta is about +35 for `ccd/session-hook.sh` (the
  new block's code lines and the gate's), and about +0 to +1 for `ccd/ccd` (the purge line is edited in place; it is
  6b-1's line, not 6b-2's). If the hook is over 40, add
  `server/test/growth-waivers/D-8379-ccd-session-hook-sh.json`, with `maxDelta` the measured
  value rounded up to 5, `d` that number (D-8379), and its reason. Report the delta either way.
- [ ] **Step 7: Commit.**

```bash
git add ccd/session-hook.sh ccd/ccd server/test/session-hook-launch-record.test.ts server/test/delegation-spool.test.ts server/test/session-hook-turnmark.test.ts server/test/ccd-lifecycle-purge.test.ts server/test/single-definition/switches-history.test.ts
# plus server/test/growth-waivers/<n>-ccd-session-hook-sh.json if Step 6 added it
git commit -m "feat(hook): the launch record, a second output of the one payload parse (session-continuity 6b)"
```
- [ ] **Step 8: 6b-1's gate, PR and wave-done.** Run Task 5 Steps 1 to 6 limited to Task 1, with these differences:
  - **Step 1 (stamp and tree):** as written: `grep -c '^# ccrc:generated' ccd/ccd` prints 0, `hook-helpers-generated`
    passes (the hook is edited, and that suite reads it as text), and the `git diff origin/main` of the untouched paths
    is empty.
  - **Step 2 (suites):** every file Task 1 named; `single-definition/*`, `census-w5/*`, `ownership`,
    `shellcheck-ratchet`, `citations`, `anchors`, `docs-parity`, `topology-clean`, `private-names`, `dtbd` and
    `ccd-harness-integrity`; then `git fetch origin main` and `deviation-refs`; `growth-check` with `GROWTH_CHECK=1`;
    and `typecheck-tests` alone (Task 1 adds a `.ts` test file). Not `ccd-contexts` (no ccd function is added) and not
    `ccd-python-reader-census` (no program yet): 6b-1 has no row or edge for either.
  - **Step 3 (mutations):** the LR-* rows only.
  - **Step 4:** the private-name scan on every added line and every commit message, before the push.
  - **Step 5 (the PR):** one PR from the workspace's branch to `main`. Its body holds the durable GitHub links to this
    plan and the spec; the deviation block of 6b-1's entries (listed under "Deviations found": the two straddling
    entries with their write and hook halves only); the LR table and the suites; and the hook's and `ccd/ccd`'s growth
    deltas, with the waiver if Step 6 added one. No context edges and no census rows: 6b-1 has none.
  - **Step 6 (the wave-done):** wait for the PR's fast run on the exact tip, read its selection and run any selected
    server file the list missed, then send one wave-done at that tip with its `suite:` and `failure:` lines, the LR
    table, the commits and the PR number.

---

### Task 2: The manifest program, `agent_end`, and their shipping

**Files:**
- Create `ccd/lib/inflight-manifest.py` (D-8368). Its header states the rules below,
  in `carry-dedupe.py`'s shape.
- Modify `ccd/lib/transcript.jq`: add `def agent_end:`, and add it to the header's list of entry points. Factor the
  rate-limit row test and the reset read that `limit_banner` spells inline into two defs both use
  (`def lb_ratelimit:` for `.type == "assistant" and .isApiErrorMessage == true and .error == "rate_limit"`, and
  `def lb_reset:` for `limit_banner`'s `$q.resetsAt` rule), so the two readers cannot disagree on a row; `limit_banner`'s
  answers are unchanged (`ccd-limit-banner` and `ccd-limit-banner-corpus` hold that).
- Modify `ccd/ccrc`:
  - add `_inst_atomic "$tree/ccd/lib/inflight-manifest.py" "$HOME/.cc-sessions/lib/inflight-manifest.py" 644` after
    `carry-dedupe.py`'s;
  - add `_upd_backup_copy "$HOME/.cc-sessions/lib/inflight-manifest.py" inflight-manifest.py` after its backup;
  - add `"$reg/lib/inflight-manifest.py"` to the uninstall `rm -f` list, in place.
- Modify `deploy/deploy.sh`: add `install_atomic ccd/lib/inflight-manifest.py .cc-sessions/lib/inflight-manifest.py 644`
  after `carry-dedupe.py`'s, and add its backup clause to the backup line, in place.
- Modify `server/test/installTreeFixture.ts`: add a row after `'ccd/lib/carry-dedupe.py'`.
- Modify (test) `server/test/ccd-python-reader-census.test.ts`: one `ROWS` entry, after `lib/carry-dedupe.py`'s:
  `{ name: 'lib/inflight-manifest.py', kind: 'no-read', d: 'D-8369', why:
  'parses Claude Code\'s workflow journals and summaries, which are not transcripts; an agent transcript\'s tail is read
  as bytes and handed to agent_end in ccd/lib/transcript.jq, which parses it' }`. The program names `.jsonl`, which
  `PROGRAM_NAMES_TRANSCRIPT` matches, so without the row the census is red. If the reviewer rules that reading a
  tail's bytes is a read, the kind becomes `reader` with the same D-number; nothing else changes.
- Create (test) `server/test/inflight-manifest.test.ts` and `server/test/inflight-manifest-parity.test.ts`.

**Interfaces:**
- **The invocation.** `python3 -I inflight-manifest.py <reg> <id> <cfg> <uuid> <site> <now> <scan-budget> <max-bytes>
  <tail-bytes> <recent-s> <abandon-s> <reset|-> <jq-lib> <log|-> <log-from|-> <record-max>`. All 16 are required. A
  malformed one is rc 2, and so is a `<site>` not in `MANIFEST_SITES`. `<record-max>` is ccd's
  `LAUNCH_RECORD_MAX_BYTES + LAUNCH_RECORD_DROP_RESERVE`: the most of `.deleg` a sequence of the hook's appends can
  write (Task 1's reserve check). Parallel PostToolUse appends that each passed the size check can pass it; what lies
  past it is the budget's overflow, counted once in `drop-budget` and removed (Validation at read).
- **What it reads, and what it writes.** It reads only:
  - `<reg>/<id>.deleg`, at most its first `<record-max>` bytes;
  - under every `<cfg>/projects/*/<uuid>/` (the session's sidecars): `workflows/<run>.json`, `workflows/scripts/`,
    `subagents/workflows/<run>/{journal.jsonl,agent-*.meta.json,agent-*.jsonl}` and `subagents/agent-<id>.jsonl`.
    Agent transcripts are read as their last `<tail-bytes>`;
  - the swap log from `<log-from>`.

  Every path is `os.lstat`ed first and opened only when `S_ISREG`, with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`. A record
  that is present and not a regular file is rc 4 with `record <type>` on stdout. Any other path that is not a regular
  file makes its item `unread`. It writes nothing.
- **The one `jq` call.** It runs `jq -L <jq-lib> -c 'include "transcript"; map(agent_end)'` once, over every tail it
  needs, with a JSON array of strings on stdin. If `jq` is missing or fails, those items are `unread`.
- **The pricing.** Before reading anything, it prices from `lstat`:
  - the smaller of `.deleg`'s size and `<record-max>`;
  - each candidate run's journal and summary sizes;
  - for each `agent-*.jsonl` in its run directory, and each agent item's transcript, the smaller of its size and
    `<tail-bytes>`;
  - the swap log past `<log-from>`.

  If the total exceeds `<scan-budget>`, it exits rc 3 and prints `budget <bytes>`. Mtimes come from the same `lstat`s
  and cost nothing to read.
- **The vocabularies**, each spelled once in the program, and once more in `deploy/measure-continuity.py` as a named
  second spelling that Task 4's test holds equal to these by reading both texts (D-8376). The
  instrument does not import the program: it runs from the tree on any box, the program ships to `~/.cc-sessions/lib/`,
  and a hyphenated file loaded by path through `importlib` would tie a measuring tool to an installed layout:
  - `MANIFEST_CLASSES = ('in-flight', 'holed', 'stopped-agent', 'diverged', 'deferred-until-reset', 'abandoned')`, the
    spec's table order;
  - `MANIFEST_VERDICTS = ('listed', 'none', 'unread', 'not-applicable', 'unmeasured')`, the spec's words (§5.5) with
    `unread` added (D-8371). The program emits the first three, and ccd the last two;
  - `MANIFEST_WHY = ('busy', 'budget', 'time', 'error')`, the reasons ccd writes beside `unmeasured`. The program writes
    none of them; Task 3's census and Task 4's grammar are held to this tuple;
  - `MANIFEST_SITES = ('swap', 'limit-resume', 'revival')`, the three `<site>` words ccd passes. The program refuses
    any other (rc 2); Task 3's site census literal and Task 4's `S3_MANIFEST` are held equal to it;
  - `MANIFEST_DROP_WHY = ('id', 'path', 'budget', 'shape')`, the hook's drop words. A `drop` row whose `why` is not one
    of them is an invalid line (`drop-read`), so a hook word the program does not know reds the round trip, never
    passing as a silent `drop-read`.
- **stdout at rc 0.** One line `summary verdict=<listed|none|unread> items=N in-flight=N holed=N stopped-agent=N
  diverged=N deferred-until-reset=N abandoned=N unread=N unread-expired=N killed=N resumed=N drop-id=N drop-path=N
  drop-budget=N drop-shape=N drop-read=N drop-readpath=N drop-over=N retired=N`, then the item lines, then the record's
  kept rows as `row <json>` lines, in file order.
  - Each item line is `item class=<c> kind=<workflow|agent> run=<id|-> task=<id|-> agent=<id|-> script=<path|->
    attempts=<n> since=<epoch> reset=<epoch|-> longer=<path|-> src=<record|sidecar>`.
  - `items` and the six class counts count every item found. `drop-over` says how many of those the file could not
    hold, and it is per write: an item over the budget at two writes counts at both.
  - `killed` counts the `in-flight` items whose summary parses with `status` `killed` (does the stop write them?).
  - `resumed` counts the items found at this write, listed, over budget or retired as finished, with `attempts` of at
    least 1: the numerator half of §9's "resumed the exact run".
  - `drop-id`, `drop-path`, `drop-budget` and `drop-shape` count the record's `drop` rows by their `why`;
    `drop-budget` also counts 1 when the record's size passes `<record-max>` (the overflow parallel appends left).
  - `unread` counts the unread items kept; `unread-expired` counts the unread items retired at this write because
    their newest row is older than `<abandon-s>` (never listed, never `abandoned`).
  - `drop-read` counts lines removed as invalid; `drop-readpath` counts script paths that failed the read check.
  - `retired` counts rows removed for a finished or reported item, another uuid, or an unjoined send.
  - Items are written in this order, newest `since` first within each class: in-flight, stopped-agent, holed,
    deferred-until-reset, diverged, abandoned.
  - The order stops where the next whole line would take the item text past `<max-bytes>`. The items left are counted
    in `drop-over`, and their rows are kept.
  - The verdict is `listed` when `items` is at least 1. It is `none` only when items and unread are both 0, and
    `unread` when items is 0 and unread is not.
- **Items.**
  - Workflow items are the `workflow` and `resume` rows grouped by `run`. `attempts` is the number of `resume` rows
    after the earliest `workflow` row.
  - Agent items are `agent` rows. Their `attempts` is the number of `send` rows with the same `agent` after it.
  - A `send` that joins no `agent` row is removed, and counted in `retired`.
  - Every `subagents/workflows/<run>/` whose journal changed within `<recent-s>`, and that no row names, is an item with
    `src=sidecar`. Its script is the single `workflows/scripts/*-<run>.js`, else `-`.
  - `since` is the item's last activity, in seconds: the newest of its row times and the mtimes of its journal, its
    summary, its run directory's `agent-*.jsonl` and, for an agent item, its transcript.
- **Validation at read** (D-8324's "again at compose").
  - A line that is not a row of the grammar above (exact keys per kind, `v` 1, ids and `uuid` in the grammar, a `drop`
    row's `why` in `MANIFEST_DROP_WHY`) is removed and counted in `drop-read`.
  - Bytes past `<record-max>` are not read; when the record's `lstat` size passes it, the cut line and everything past
    it are removed at compaction and counted once in `drop-budget`, never in `drop-read` (they are budget overflow, not
    invalid lines).
  - A row whose `uuid` is not `<uuid>` is removed and counted in `retired`.
  - A script path keeps its tail after its **last** `/projects/` (a config root may itself lie under a directory
    named `projects`; `<pdir>` holds no slash, so only the last occurrence is unambiguous), and that tail must be
    exactly `<pdir>/<uuid>/workflows/scripts/<name>`. It is re-rooted at `<cfg>/projects/`, and must then pass four
    checks:
    `os.path.realpath` lies under `realpath(<cfg>/projects/<pdir>/<uuid>)/workflows/scripts/`; the name passes the hook's
    class; it is a regular file; and the uuid segment is `<uuid>`. Otherwise the item is written with `script=-` and
    `drop-readpath` gains 1. The item stays, and its kept row is rewritten with `script: null`, so a later write does
    not count it again (D-8365).
- **Unread first.** Before any class is tried, an item whose deciding files cannot be read is `unread`, so no class
  is computed from absent evidence (call 3): for a workflow item, no journal under any of the session's sidecars, a
  path that is not a regular file, or a read that failed; for an agent item, no transcript, a transcript that is not
  a regular file, `agent_end` answering `none`, or `jq` failing. An unread item is counted and its rows kept, until
  its newest row is older than `<abandon-s>` (`INFLIGHT_ABANDON_S`): then it is retired at that write and counted in
  `unread-expired`, never listed and never `abandoned` (it was never proved unfinished). So a launch whose run
  directory never appeared, or was cleaned up by Claude Code, leaves the record within the window, and the session's
  verdict returns to `none`.
- **The classes**, decided for readable items in precedence order. The first that holds is the item's class.

| Class | Workflow item | Agent item |
|---|---|---|
| `abandoned` | `since` (its last activity) older than `<now> − <abandon-s>`, and not finished | the same, and not `finished` |
| `diverged` | a `sidecar <uuid> diverged <kept> longer <longer>` line after `<log-from>` whose kept path is this run's (`subagents/workflows/<run>/…` or `workflows/<run>.json`); `longer=` the longer path when it passes the path byte class, else `-` | the same, for `subagents/agent-<agent>.jsonl` |
| `deferred-until-reset` | attempts ≥ 1, not finished, and an agent whose `.meta.json` mtime is at or after the newest `resume` row ends `rate-limit`; `reset=` the newest such agent's row reset | attempts ≥ 1 (a `send` after its launch) and `agent_end` is `rate-limit`; `reset=` its row reset |
| `holed` | finished, and the latest attempt of some journal key ends `rate-limit` | — |
| `stopped-agent` | — | `agent_end` is `rate-limit` or `open` |
| `in-flight` | not finished | — |
| retired (not listed) | finished, and no key's latest attempt ends `rate-limit` | `agent_end` is `finished` |

  `reset=` on a `deferred-until-reset` item is the deciding rate-limit row's own `quotaLimits.resetsAt`, as `agent_end`
  returns it (spec §5.3's `<resetsAt>`); where that row carries none, the `<reset>` argument (the session's accepted
  limit-wait reset, Task 3 step 2); otherwise `-`. Every other class writes `reset=-`.

- **"Finished"** is D-5561's rule made stricter. A run is finished when its summary is a regular file that parses with
  `status` `completed` or `failed`, and its journal's mtime is at or before the summary's. A `killed`, non-final or
  unparseable summary, no summary, or a newer journal is not finished (D-8370). The server
  reads any summary file no older than the journal as finished (COORDINATOR note 2). The journal fold is
  `server/src/workflows/model.ts#foldJournal`'s: for each key, the agent id of its latest `started`, and its last
  state. Its line reader mirrors `parseLine`'s: a line that does not parse as JSON is searched, as `parseLine`'s
  `catch` does, for `"type"` (`started`, `result` or `failed`), `"key"` (`v<digits>:<64 hex>`) and `"agentId"`, and
  counts only when all three are found; Python's `re` spells the same three patterns.
- **Compaction** (D-8373). Kept rows are the rows of listed items, of `drop-over` items
  and of unread items not yet expired. Everything else is removed:
  - finished items;
  - `abandoned` items, removed by the write that reports them, so each is reported once;
  - expired unread items (`unread-expired`);
  - other uuids;
  - unjoined sends;
  - invalid lines, and anything past `<record-max>`;
  - `drop` rows, which the four `drop-<why>` counts sum.
- **`agent_end`** (`ccd/lib/transcript.jq`). It takes a raw tail window of whole lines as a string. The program cuts
  the window's partial first line (the bytes up to and including the first LF) when it read from mid-file, so every
  line `agent_end` sees was written whole or is the file's last write. A torn final line is evidence the agent was
  still writing (after an `end_turn` row it would be a continuation, a SendMessage's user row and the turn it starts),
  so `agent_end` does not step over it: a final field with no terminating newline that does not parse to an object
  answers `"open"`, fail-closed, as `limit_banner` clears on one. In the `reduce` over the lines, any unparseable
  line sets the candidate to `open`, and a later whole row replaces it. It steps over a row that is not user or
  assistant, and a chatter user row. The newest row left decides:
  - a rate-limit row (`lb_ratelimit`, the def `limit_banner` now shares, assistant condition included) answers
    `"rate-limit"`, or `"rate-limit <resetsAt>"` when `lb_reset` reads an integer reset from its `quotaLimits`;
  - an assistant row that is not an API error and whose `message.stop_reason` is `"end_turn"` answers `"finished"`;
  - any other user or assistant row answers `"open"`: an assistant `tool_use` row with no tool result after it (an
    agent stopped mid-tool), a user tool result, an API error that is not a rate limit, any other `stop_reason`;
  - no row left answers `"none"`.

  It uses `lb_row`, `lb_ratelimit`, `lb_reset` and `chatter`, never `complete` (which accepts `tool_use`), no regex
  builtin, and none of the builtins jq 1.6 builds on label/break (`first`, `limit`, `isempty`, `any`, `all`, `IN`,
  `nth`, `label`), which `continued-in-parity.test.ts` reds on anywhere in the module (D-4940): "the newest row left"
  is a `reduce` over the split lines, as `limit_banner`'s is, never `first`. Each parse's `try` sits inside its own
  array constructor.

- [ ] **Step 1: Write the failing tests.** `inflight-manifest.test.ts` builds sidecar trees in `mkTmp` fixtures,
  using D-5561's shapes: journal lines `{type, key: 'v1:<64 hex>', agentId}`, summaries `{status}`, rate-limit rows
  `{type: 'assistant', isApiErrorMessage: true, error: 'rate_limit'}`, finished rows `{type: 'assistant', message:
  {stop_reason: 'end_turn'}}` and mid-tool rows `{type: 'assistant', message: {stop_reason: 'tool_use', content:
  [{type: 'tool_use', …}]}}`.
  - `'an in-flight run: a launch row and a journal with no summary is one in-flight item with its script re-rooted at the current root'`.
    The item line equals `item class=in-flight kind=workflow run=wf_0123abcd-0ab task=t1
    script=<cfg>/projects/-p/<uuid>/workflows/scripts/x-wf_0123abcd-0ab.js attempts=0 since=<t> reset=- longer=-
    src=record`.
  - `'a killed summary reads in flight and counts in killed; a non-final or unparseable summary reads in flight; a completed one retires the run and its rows; a failed one retires too'`.
  - `'a journal newer than its summary (resumed in place) reads in flight'`.
  - `'holed: a completed run whose latest attempt for a key ends on a rate-limit row; a key whose limited attempt was retried under a new agent id does not hole it'`.
  - `'stopped-agent: an agent ending on a rate-limit row, one ending on a tool result, and one whose newest row is an assistant tool_use with no result after it; one ending on an end_turn retires'`.
  - `'a torn last line reads open: after a rate-limit row, after a tool result and after an end_turn, the agent is stopped-agent, never retired'`.
  - `'a window read from mid-file drops its cut first line: with only chatter after it, agent_end answers none'`.
  - `'deferred-until-reset: a resume row, then an agent whose meta is newer than it ends on the limit: attempts=1 reset=<the row\'s resetsAt>; with no resetsAt on the row, reset=<reset>; an agent older than the resume does not count; resumed counts it'`.
  - `'abandoned: an item whose last activity is older than abandon-s is listed once, and its rows are gone from the kept rows'`.
  - `'not abandoned across a weekly wait: a run launched nine days ago whose journal last changed six and a half days ago, at a limit-resume, is in-flight'`.
  - `'diverged: a diverged line after log-from that names the run\'s journal; one before log-from is not read'`.
  - `'a sidecar-only run changed within recent-s is listed with src=sidecar; an older one is not'`.
  - `'validation at read: a malformed line and a bad id each add one to drop-read, a script symlinked out of the sidecar adds one to drop-readpath; the item stays, with script=-, and a second write over the kept rows counts none of them again'`.
  - `'a record longer than record-max is read to record-max: the overflow counts once in drop-budget, not drop-read, and is not kept'`.
  - `'a script path is re-rooted at its last /projects/: a config root under a directory named projects re-roots right; a tail that is not <pdir>/<uuid>/workflows/scripts/<name> is script=-'`.
  - `'a row whose uuid fails isid counts in drop-read, not retired'`.
  - `'a FIFO at the record is rc 4 "record fifo"; a FIFO at a journal or an agent transcript makes that item unread; neither blocks'`,
    under `spawnSyncGroup` with a timeout.
  - `'over the scan budget: rc 3, "budget <n>", and no summary line'`.
  - `'the item budget: items past max-bytes are counted in drop-over, no line is cut, and their rows are kept'`.
  - `'unread: a launch row whose run directory is absent is not listed and is counted; its rows are kept; with no other item the verdict is unread, never none'`.
  - `'unread is decided before any class: a workflow item with no journal and a launch nine days old is unread, never in-flight or abandoned'`.
  - `'an unread item past abandon-s retires into unread-expired, is never listed as abandoned, and its rows go; the next write is none'`.
  - `'none: an empty record and no recent sidecar run'`.
  - `'other-uuid rows and unjoined sends are removed and counted in retired; drop rows are summed by why into drop-id, drop-path, drop-budget and drop-shape'`.
  - `'every line of every case fullmatches its grammar, and no output holds a planted sentinel'`.
  - `'every row the hook writes reads clean: drop-read 0'`. Run Task 1's hook for one row of each kind, and one drop of
    each `why`: a path failure (its two lines), a bad id, a shape drop and a budget drop (a record planted near
    `LRC_MAX_BYTES`), then run the program. Expected: `drop-id`, `drop-path`, `drop-budget` and `drop-shape` 1 each,
    and `drop-read` 0.
  - `'agent_end: rate-limit (with and without its resetsAt), finished, open and none; a tool_use row is open; a torn final line is open; a chatter user row after a rate-limit row is stepped over; a user row with isApiErrorMessage and rate_limit is not a rate-limit row, for agent_end and limit_banner alike'`.
    Run jq on the tree's `ccd/lib`.
  - `'MANIFEST_CLASSES, MANIFEST_VERDICTS, MANIFEST_WHY, MANIFEST_SITES and MANIFEST_DROP_WHY are spelled once, and the program names a class, verdict, site or drop word only through them; a site outside MANIFEST_SITES is rc 2'`.
  - `'ships where ccd looks for it: deploy.sh and ccrc install it, back it up and remove it'`, in the shape of
    `ccd-carry-dedupe.test.ts`'s row.

  `inflight-manifest-parity.test.ts`:
  - `'the journal fold and the finished rule agree with server/src/workflows/model.ts over one table, except a summary that is killed, non-final or unparseable, which the server reads finished and the manifest reads in flight'`.
    The table has these rows:
    - no summary;
    - `completed` with an older journal;
    - `completed` with a newer journal;
    - `failed`;
    - `killed`;
    - a summary whose `status` is not final;
    - a summary that does not parse;
    - a key retried under a new agent id;
    - a journal line that is not JSON and carries none of the three fields (both readers drop it);
    - a journal line cut mid-JSON whose head carries `type`, `key` and `agentId` (both readers count it, the program
      by its mirror of `parseLine`'s head search).

    The TypeScript side is `server/src/workflows/read.ts`'s composition: `decideRun` with `proc: { kind: 'gone' }`,
    `summaryMtime` the summary file's mtime whenever the file exists (never gated on `parseSummary`), and
    `foldJournal` for the keys. The program's side is its item or retirement for the same tree. The three pinned
    differences are listed by name, so a fourth reds.
- [ ] **Step 2: Run both files, and confirm they fail.** Expected: FAIL, because the program does not exist. (The
  census reds once the program exists without its row; MP-CENSUS measures that.)
- [ ] **Step 3: Implement** the program, `agent_end`, the shipping lines and the census row.
- [ ] **Step 4: Run** both new files, then `ccd-python-reader-census`, `ccd-carry-dedupe`, `ccd-limit-banner`,
  `ccd-limit-banner-corpus`, `continued-in-parity`, `workflows-read`, `shellcheck-ratchet`, and every file
  `grep -ln 'installTreeFixture\|_inst_atomic\|deploy.sh' test/*.test.ts` prints, one at a time. Expected: PASS.
- [ ] **Step 5: Measure the mutation rows.**

| Row | Mutation | Expected red |
|---|---|---|
| MP-KILLED | `killed` counted as finished | `'a killed summary reads in flight …'` and the parity row |
| MP-PARSE | any summary file no older than the journal is finished (the server's rule) | `'a killed summary …'` (the unparseable one retires) and the parity row |
| MP-KEY | holed by any attempt, not the latest per key | `'holed: …'` (the retried key holes) |
| MP-TOOLUSE | `agent_end` answers `finished` for `complete` | `'stopped-agent: …'` (the `tool_use` agent retires) and `'agent_end: …'` |
| MP-TORN | `agent_end` steps over a torn final line | `'a torn last line reads open …'` (the end_turn agent retires) |
| MP-HEADCUT | the program hands a mid-file window uncut | `'a window read from mid-file drops its cut first line …'` (open, not none) |
| MP-RATELIMIT | `agent_end` spells its own rate-limit test without the assistant condition | `'agent_end: …'` (the user row reads rate-limit) |
| MP-RESETROW | `reset=` taken from the `<reset>` argument only | `'deferred-until-reset: …'` (the row's resetsAt is not written) |
| MP-UNREADFIRST | unread decided last, after the classes | `'unread is decided before any class …'` (the item reads abandoned) |
| MP-UNREADEXPIRE | unread rows kept past `<abandon-s>` | `'an unread item past abandon-s …'` (its rows stay, the verdict stays unread) |
| MP-RECORDMAX | the record read whole, past `<record-max>` | `'a record longer than record-max …'` (the overflow is kept) |
| MP-UUID | rows of another uuid kept as items | `'other-uuid rows and unjoined sends …'` (`retired` short, an item listed) |
| MP-RECENT | the `<recent-s>` cutoff dropped for sidecar-only runs | `'a sidecar-only run changed within recent-s …'` (the older one is listed) |
| MP-LASTPROJ | the script path re-rooted at its first `/projects/` | `'a script path is re-rooted at its last /projects/ …'` |
| MP-JOURNALHEAD | the program's line reader drops every non-JSON line | the parity row for the cut journal line |
| MP-DEFER | no `.meta.json` mtime cut | `'deferred-until-reset: …'` (the older agent counts) |
| MP-ABANDON | abandoned rows kept | `'abandoned: …'` |
| MP-ACTIVITY | `since` is the newest row time only | `'not abandoned across a weekly wait …'` |
| MP-REALPATH | the read-time check made lexical | `'validation at read …'` (the symlink passes) |
| MP-FIFO | the `S_ISREG` test removed before an open | `'a FIFO at the record …'` (the case times out) |
| MP-BUDGET | the pricing skipped | `'over the scan budget …'` |
| MP-OVER | over-budget items' rows removed | `'the item budget …'` |
| MP-LOGFROM | the log read from 0 | `'diverged: …'` |
| MP-UNREAD | `none` when `unread > 0` | `'unread: …'` |
| MP-CHATTER | `agent_end` does not step over chatter | `'agent_end: …'` |
| MP-CENSUS | the census row removed | `ccd-python-reader-census` |

- [ ] **Step 6: Commit.**

```bash
git add ccd/lib/inflight-manifest.py ccd/lib/transcript.jq ccd/ccrc deploy/deploy.sh server/test/installTreeFixture.ts server/test/ccd-python-reader-census.test.ts server/test/inflight-manifest.test.ts server/test/inflight-manifest-parity.test.ts
git commit -m "feat(ccd): the manifest program and agent_end, read-only, shipped beside carry-dedupe (session-continuity 6b)"
```

---

### Task 3: `_inflight_write` and its three sites

**Files:**
- Modify `ccd/ccd`.
  - **Constants**, directly after the `CARRY_MERGE_BUDGET=` line, each with its trailing comment:
    - `LAUNCH_RECORD_MAX_BYTES=1048576` and `LAUNCH_RECORD_DROP_RESERVE=4096`, each comment naming the hook's spelling
      (`LRC_MAX_BYTES`, `LRC_DROP_RESERVE`); `_inflight_write` reads both, as the program's `<record-max>`
      (D-8366, its 6b-2 half: this spelling and the equality pin);
    - `INFLIGHT_SCAN_BUDGET=67108864`: bytes one manifest may read, priced first;
    - `INFLIGHT_MAX_BYTES=65536`: the size of `$REG/<id>.inflight`'s item lines;
    - `INFLIGHT_TAIL_BYTES=65536`: the tail of one agent transcript, D-5561's `TAIL_BYTES`;
    - `INFLIGHT_RECENT_S=86400`: "sidecar files changed in the last day";
    - `INFLIGHT_ABANDON_S=691200`: eight days of no activity, provisional (D-8372);
    - `INFLIGHT_TIME_S=30`: the program's time bound, provisional (D-8376);
    - `INFLIGHT_WAIT_CLOSED_S=600`: how recently a limit-wait closed `end=resume` may have closed for the limit-resume
      to read it (D-8375).
  - **A new block, directly after `_carry_slot_take`'s closing brace:** a header comment, then `_inflight_slot_take`,
    `_inflight_note` and `_inflight_write`. The header says the slot is the manifest's own, `$REG/.inflight.lock`,
    never the carry's, and why, in two sentences citing D-8362: the carry slot is a box-wide budget
    for the carry's heavy reads and writes, not a lock between sessions, and a shadow manifest must never refuse a
    carry. The block sits beside `_carry_slot_take` because the helper mirrors it.
  - **The sites, one statement line each** (D-8361):
    - `cmd_swap`:
      - `local mlog=""; mlog=$(_plat_size "$REG/swap.log" 2>/dev/null) || mlog=""` directly before
        `_swap_carry_sidecars "$srccfg" "$dstcfg" "$uuid"`;
      - `_inflight_write "$id" swap "$dstcfg" "$uuid" "$mlog"` directly after the task-list block and before the
        success path's `_swap_beat_stop "$beat"`.
    - `_watchdog_resume_run`: `_inflight_write "$id" limit-resume` directly after the `_reg_set "$id" supervised …`
      stamp that follows `sleep 1`, and before `cmd_ensure`. After the stamp, not before it: the stop has already ended
      the supervisor, this site has no `_swap_beat`, and the row's freshness against `SUPERVISED_FRESH_MS` (120 s,
      `shared/api.ts`) rests on that one stamp, so the manifest's up to 33 s is not spent between the last beat and it.
    - `_end_note_gone`: `_inflight_write "$id" revival` after its `_end_record` line, so a swap end that it keeps
      returns before it.
  - **The purge comment's field list** gains `inflight` (54, by addition; Task 1 added `deleg`).
  - **`_reg_purge`'s R-3 paragraph** (the dot-prefixed registry inventory, before `_ws_project_valid`), comment lines
    only: `TWENTY-TWO` becomes `TWENTY-THREE`, "these fourteen are not" becomes "these fifteen are not", "The
    fourteen:" becomes "The fifteen:", and `$REG/.inflight.lock` is named directly after `$REG/.carry.lock`, for the
    same reason: "(the manifest's own slot, D-8362; no id is the dash-free `.inflight`)". Measure the
    test's printed total first: if it does not read 23, take its number and report the difference.
- Modify `ccd/contexts.tsv`: `_inflight_slot_take C1`, `_inflight_note C1` and `_inflight_write C1`, after
  `_carry_slot_take`'s row. C1, beside the slot helper it mirrors (`_carry_slot_take`) and the carry it follows at the
  swap (`_swap_carry_sidecars` and `_transcript_matches` are C1), and beside two of the three callers (`cmd_swap`,
  `_watchdog_resume_run`). In C3 the three would add about ten cross-context edges (seven callees in C1, and three
  callers), against a count `ccd-contexts.test.ts` lets only shrink without an edges row each.
- Modify `ccd/contexts-edges.tsv`: add exactly what `ccd-contexts.test.ts` prints. The expected line is one:
  - `_end_note_gone -> _inflight_write` (`_end_note_gone` is C2).

  Every callee is C1 or K (`_plat_timeout`, `_now_s_to`, `_plat_size`), and a call into K is not an edge
  (`'a cross-context edge joins two contexts, a call into K is not one …'`). Take the test's list over this one. The PR
  states the edge's reason: the supervise loop's gone exit is the revival site the spec names.
- Create (test) `server/test/ccd-inflight.test.ts`.
- Modify (test) `server/test/ccd-account-auth.test.ts`: `'TWENTY-THREE'` appended to `CARDINAL` in
  `'the dot-prefixed registry inventory is a census, not a memory'`, the one change; the test derives `.inflight`
  from the new `"$REG/.inflight.lock"` literal itself. **The session hook's account arm refuses the verb's bare name in
  Bash text** (COORDINATOR note 10: a bare `ccd-account-auth` token, such as a grep pattern, is refused; the test
  file's path is not). Name the file by its path in the test run and in `git add`; to search it, use a pattern that
  is not the bare token (for example `CARDINAL`).
- Modify (test) `server/test/single-definition/switches-history.test.ts`: add `_inflight_write`'s one
  `_reg_set "$id" deleg` line to Task 1's `.deleg` describe's closed set, and `ccd/lib/inflight-manifest.py` as the
  record's one reader, and append one `describe` for `.inflight` (Step 1).
- Modify (test) `server/test/ccd-python-reader-census.test.ts`: one `ROWS` entry, after `cmd_carry_dedupe`'s:
  `{ name: '_inflight_write', kind: 'no-read', d: 'D-8369', why: 'hands
  lib/inflight-manifest.py its arguments, and that program has its own row; _transcript_matches only lists file
  names' }`. The function runs `python3 -I` and names `_transcript_matches`, which `TRANSCRIPT_GRAMMAR` matches.
- Modify (test), as measured: every pin of an exact swap.log content or call list that the three sites reach. Find them
  with `grep -lE 'cmd_swap|ccd swap|_watchdog_resume_run|_end_note_gone|cmd_supervise' test/ccd-*.test.ts`.
  Extend each by exactly the `manifest` line or the calls `_inflight_write` makes, and report each.
- Create, only if Step 7 measures a net delta over 40:
  `server/test/growth-waivers/D-8380-ccd-ccd.json`.

**Interfaces:**
- Consumes:
  - `LAUNCH_RECORD_MAX_BYTES + LAUNCH_RECORD_DROP_RESERVE`, passed as the program's `<record-max>`;
  - Task 2's program, its 16 arguments, its stdout grammar and its `MANIFEST_WHY` and `MANIFEST_SITES` tuples;
  - `TRANSCRIPT_JQ_LIB`;
  - `_carry_slot_take`'s shape, mirrored, never called: the manifest does not consume the carry's slot (R-A);
  - `_plat_timeout` (rc 124 on expiry);
  - `_transcript_matches`, `_reg_generation_read`, `_reg_read_to`, `_rw_field`, `_cfg_dir_to`, `_now_s_to` and
    `_plat_size`.
- Produces:
  - **`_inflight_slot_take`** (D-8362), `_carry_slot_take` line for line on another file:
    `# -> 0 and the CALLER's local INFLIGHT_SLOT_FD set | 1 contended | 2 no mechanism (no flock, the lock file, any
    other flock failure)`. It returns 2 when `command -v flock` fails; opens `$REG/.inflight.lock` for append on a new
    descriptor, `{ exec {fd}>>"$REG/.inflight.lock"; } 2>/dev/null || return 2`; runs `flock -n "$fd"`, where exit 1
    alone is a conflict (rc 1) and any other failure is rc 2, closing the descriptor either way; and on success sets
    the caller's `INFLIGHT_SLOT_FD`. The caller releases it with `exec {INFLIGHT_SLOT_FD}>&-`. Non-blocking: it never
    waits. The file is never unlinked (`.rotate.lock`'s rule, as for `.carry.lock`), and no code line in ccd names
    `$REG/.inflight.lock` but this function's. It never opens, names or locks `$REG/.carry.lock`. Not a parameter of
    `_carry_slot_take`: a shared helper would edit the carry's own function, which this wave leaves byte-identical
    (call 1: no existing act changes).
  - **`_inflight_note id site rest`.** The one writer of `manifest` lines: `<%F %T> manifest <id>: site=<site> <rest>`.
    Always rc 0.
  - **`_inflight_write id site [cfg uuid [log-from]]`.** `site` is one of `swap`, `limit-resume`, `revival`. This is the
    one writer of `$REG/<id>.inflight`, and the launch record's one compactor. It is always rc 0. It never dies, and
    never waits on its slot. **Its body is one subshell:** `_inflight_write() {` (the form every ccd function
    parser in `server/test` reads), then `( … ) || true` around the whole body, then `return 0`. Its three sites run
    between a session's stop and its restart, in a shell under `set -uo pipefail` (set at the top of `ccd/ccd`), where an
    unbound-variable expansion ends the shell and no rc check or `|| true` catches it; `_swap_carry_sidecars` names this
    very hazard for its own `rows` read. In a subshell, an `exit`, a `die` or a `set -u` abort ends the subshell alone,
    the swap still flips its wrapper and runs `_swap_beat_stop`, and the slot's descriptor closes with it. Every
    variable the steps below set is the subshell's own, so nothing leaks to the caller, and `_inflight_slot_take`'s
    `INFLIGHT_SLOT_FD` is a local of the subshell.
    1. **Inputs.** Without `cfg` and `uuid`, it reads the registry `wrapper` (through `_reg_read_to`), its root (through
       `_cfg_dir_to`) and `uuid` (through `_reg_get_to`). `gen` is `REG_GENERATION` when `_reg_generation_read`
       answers rc 0, else `-`. `now` comes from `_now_s_to`.
    2. **The wait.** It reads `$REG/<id>.limitwait` through `_reg_read_to`: rc 1 (absent) gives `wait=-`, and rc 2
       (unreadable) gives `wait=?`. A record read is accepted only when all of these hold:
       - its `account` is the registry wrapper;
       - `since` is numeric, and `reset` is numeric or `-`;
       - it is `state=open`; or the site is `limit-resume` and it is closed with `end=resume` and a numeric `until` with
         `0 ≤ now − until ≤ INFLIGHT_WAIT_CLOSED_S` (the close `_watchdog_resume_here` made as it dispatched this very
         unit). A closed record at any other site, or an older close, is a wait already counted, and gives `-`.

       When accepted, `wait` is `reset − since`, or `0` when the reset was already past at the record's opening
       (`_limitwait_open` keeps a passed reset), and the reset goes to the program. An accepted record whose `reset` is
       `-` (an open wait `_limitwait_open` could not date: no `HARD_BLOCK_RESET` and nothing ahead in the limits file)
       gives `wait=undated`: an unmeasured span, never folded into `-`, which means no wait this restart stands in.
       Otherwise the reset is `-`.
    3. **No cfg or uuid.** The result is `unmeasured`, `why=error`.
    4. **No transcript.** A `cfg` that is not a directory, or a `cfg/projects` that exists and is not a directory that
       can be listed and searched (`-d`, `-r`, `-x`), is `unmeasured why=error`: `_transcript_matches` prints nothing
       for those too, and they are not the measured absence call H names. When `cfg/projects` is absent, or
       `_transcript_matches cfg uuid` prints nothing, the result is `not-applicable`. No slot is taken, the program
       never runs, and the record is untouched.
    5. **The slot.** `_inflight_slot_take`, the manifest's own slot (`$REG/.inflight.lock`, never `.carry.lock`):
       rc 1 is `why=busy` (another manifest on the box holds it), and rc 2 is `why=error`. The program is looked for at
       `${BASH_SOURCE[0]%/*}/lib/inflight-manifest.py`, then at `$HOME/.cc-sessions/lib/`. A missing program, or no
       `python3`, is `why=error`.
    6. **The run.** `_plat_timeout "$INFLIGHT_TIME_S" python3 -I <program> …`, with stderr discarded.
       - rc 124 is `why=time`.
       - rc 3 is `why=budget`.
       - Any other non-zero rc (rc 4 included: a record that is not a regular file), or a first line that is not the
         summary grammar, is `why=error`.
       - On rc 0, it writes the **listed write**, `_reg_set "$id" inflight "<header>"$'\n'"<item lines>"`, with each
         item line's `item ` prefix stripped. Only after that succeeds does it write the compacted record, the one
         `_reg_set "$id" deleg "${kept:+$kept$'\n'}"` line (D-8373), with each `row `
         prefix stripped: the kept rows joined by newlines, and one more newline after the last when there is any, so
         the hook's next `printf '%s\n'` starts a line of its own.
       - When the record's write fails, the result becomes `unmeasured why=error`, and falls through to step 7's one
         header-only write, so the file and the log line agree. The record is then not compacted, and an `abandoned`
         item this write would have reported is reported by the next one.
    7. **Every other result** (unmeasured, not-applicable, and step 6's failed record write) reaches the **header-only
       write**, `_reg_set "$id" inflight "<header>"`, one code line that every such path shares. When a write of
       `.inflight` fails, it runs `rm -f -- "$REG/$id.inflight"`, so no earlier restart's items stand as this one's
       (D-8374). So `.inflight` is written on exactly two code lines, the
       listed write and the header-only write, both in `_inflight_write`, and removed on one; the census names them.
    8. **The end.** On every way out after step 5 took the slot (listed, none, unread, budget, time, error, a failed
       write), it releases the slot with `exec {INFLIGHT_SLOT_FD}>&-`, so the slot is free before the log line is
       written. Then it calls `_inflight_note` once, still inside the subshell. The subshell's exit closes the
       descriptor too, on any way out the steps did not foresee, so after `_inflight_write` returns the slot is free
       whether or not the explicit release ran: the explicit release is observable only from inside the subshell,
       which is where Step 1's `'releases the slot …'` probes it (from an `_inflight_note` override).
  - **The header** is the file's first line: `v=1 at=<now> gen=<gen|-> site=<site> uuid=<uuid|-> <tokens>`. `<tokens>`
    is `verdict=<v> why=<busy|budget|time|error|-> wait=<n|-|?|undated> items=… in-flight=… holed=… stopped-agent=…
    diverged=… deferred-until-reset=… abandoned=… unread=… unread-expired=… killed=… resumed=… drop-id=… drop-path=…
    drop-budget=… drop-shape=… drop-read=… drop-readpath=… drop-over=… retired=…`. Every count is `-` for `unmeasured` and
    `not-applicable`. A `manifest` line's `rest` is the same `<tokens>`, computed once, after the last write: the file
    and the log line cannot disagree.

- [ ] **Step 1: Write the failing tests** in `ccd-inflight.test.ts`, on fixture HOMEs with `flock` and `python3`, each
  through `makeCcdHarness`.
  - `'not-applicable: no transcript for the uuid under the config root, or no projects directory; the program never runs and the record is untouched; the file holds the header alone'`.
    A PATH stub `python3` logs and is never called.
  - `'an unlistable projects directory, or a config root that is not a directory, is unmeasured why=error, never not-applicable'`.
  - `'busy: another holder of .inflight.lock gives verdict=unmeasured why=busy, and the record is not compacted'`. The
    holder is a `flock` started inside the snippet and killed in `afterEach`.
  - `'its own slot: with .carry.lock held by another process and .inflight.lock free, the manifest still writes listed and compacts the record'`
    (R-A). A fixture with items and a `flock` holder on `$REG/.carry.lock` alone.
  - `'its own slot: with .inflight.lock held by another process and .carry.lock free, the manifest writes unmeasured why=busy'`
    (R-A). The same fixture, in a case of its own, with a holder on `$REG/.inflight.lock` alone. The halves are two
    cases, never two runs in one, so no `.carry.lock` holder from the first is alive in the second: each holder is
    started inside its own case's snippet and killed in `afterEach`, as above. Under IF-OWNSLOT each case goes red on
    its own: the first reads `busy` (the carry's holder contends), the second reads `listed` (nothing holds the file
    the mutation locks).
  - `'a busy write after a listed write leaves the header alone in the file, and no items'`.
  - `'budget: a record priced over INFLIGHT_SCAN_BUDGET gives unmeasured why=budget'`, with the constant set low for
    the case.
  - `'time: a program that outruns INFLIGHT_TIME_S gives unmeasured why=time'`, with a stub program that sleeps and
    the constant set to 1.
  - `'error: a missing program, python3 off PATH, rc 4 or a malformed first line gives unmeasured why=error'`.
  - `'listed: the header, the items, the compacted record and one manifest line, each fullmatching its grammar'`.
  - `'unread is its own verdict, never none'`.
  - `'the compacted record ends in a newline: the real hook\'s next append is a line of its own, and every line parses'`.
    `_inflight_write` compacts a record with kept rows, then Task 1's hook appends one row.
  - `'a failed record write (a directory at .deleg) rewrites the file to unmeasured why=error, and the file and the manifest line agree'`.
  - `'releases the slot on every way out: listed, none, budget, time, error and a failed write'`. The probe runs
    INSIDE the subshell, after the release and before the subshell exits: the snippet overrides `_inflight_note`
    (defined after ccd's functions are loaded, so the subshell, a fork, calls the override), and the override opens a
    new descriptor on `$REG/.inflight.lock`, runs `flock -n` on it, appends `SLOT-FREE` or `SLOT-HELD` to a file in the
    fixture HOME, and closes the descriptor. The case expects `SLOT-FREE` for each way out, and exactly one probe word
    per call (one `_inflight_note` per call). A probe after `_inflight_write` returns, as
    `ccd-swap-carry-merge.test.ts`'s `'releases the slot on the way out …'` does for `.carry.lock`, cannot tell a
    missing release here: `_swap_carry_sidecars` releases in its caller's own shell, while `_inflight_write`'s
    subshell exit closes the descriptor anyway. `flock -n` on a new open file description conflicts with a lock the
    same process holds (flock(2) treats two `open`s as two holders, as that file's slot-once case notes), so the
    override reads `SLOT-HELD` when the release was skipped.
  - `'a FIFO at .deleg or at a journal holds nothing: the swap still lands and the limit-resume still runs cmd_ensure'`,
    under `spawnSyncGroup` with a timeout.
  - `'wait: an open limit-wait on the session\'s account gives wait=reset−since, as does one closed end=resume moments ago at the limit-resume; another account\'s, or reset=-, gives wait=-'`.
  - `'wait: a revival a day after a limit-resume (the record closed end=resume) gives wait=-, and so does a limit-resume whose close is older than INFLIGHT_WAIT_CLOSED_S'`.
  - `'wait: a reset already past at the opening gives wait=0; an unreadable record gives wait=?; neither is a malformed line'`.
  - `'wait: an open limit-wait on the session\'s account with reset=- gives wait=undated, not -'`.
  - `'never dies: a directory at $REG/<id>.inflight gives unmeasured why=error, and the caller\'s next line runs'`.
  - `'an abort inside the body ends only its subshell: the swap still lands and the limit-resume still runs cmd_ensure'`.
    A test-only copy of `ccd/ccd` (the harness's own, never the tree's) plants an unbound-variable expansion as the
    body's first statement.
  - `'the swap writes it at the destination root after the carry'`. The `manifest` line follows the `sidecar` lines and
    precedes the `swap` line. A `diverged` line from this carry is read, and one already in the log is not. The swap
    completes as before.
  - `'limit-resume writes it after the stop and the supervised stamp, and before cmd_ensure'`, through
    `_watchdog_resume_run` with logging stubs. Expected order: `svc-stop` < `kill-session` < `supervised` < `manifest` <
    `ensure` (the `supervised` stamp is logged by a `_reg_set` wrapper in the snippet).
  - `'a revival writes it after its ended line; a swap end of the last 60 s writes neither'`, through `_end_note_gone`.
  - `'the hook\'s LRC_MAX_BYTES and LRC_DROP_RESERVE equal ccd/ccd\'s LAUNCH_RECORD_MAX_BYTES and LAUNCH_RECORD_DROP_RESERVE, and _inflight_write passes their sum'`.
  - `'the manifest sites: _inflight_write is called in cmd_swap, _watchdog_resume_run and _end_note_gone, where the plan places it, and nowhere else'`.
    A static census over `ccdSource()`. It checks four things:
    - the holders equal `{cmd_swap: 'swap', _watchdog_resume_run: 'limit-resume', _end_note_gone: 'revival'}`, and the
      literal's values equal the program's `MANIFEST_SITES`, read from its text;
    - each site's neighbours are as placed: in `cmd_swap`, after the `_swap_carry_sidecars` line and before the success
      path's `_swap_beat_stop "$beat"`; in `_watchdog_resume_run`, after `sleep 1` and the `supervised` stamp, and before
      `cmd_ensure`; in `_end_note_gone`, after `_end_record`;
    - `cmd_hibernate`, `cmd_stop`, `cmd_ws_archive`, `cmd_ensure` and `_spawn_start` never reach it;
    - the code lines (comment lines dropped) of `_inflight_write` and `_inflight_slot_take` never name `.carry.lock`,
      `_carry_slot_take` or `CARRY_SLOT_FD`, `_inflight_slot_take` names `"$REG/.inflight.lock"`, and
      `_inflight_write` calls `_inflight_slot_take` exactly once (R-A).

  `switches-history.test.ts`: two edits.
  - **Task 1's `.deleg` describe** gains two sites in its closed sets: `_inflight_write`'s one `_reg_set "$id" deleg`
    line in `ccd/ccd`, and `ccd/lib/inflight-manifest.py` as the record's one reader (its Python spelling is allowed
    there and nowhere else; `deploy/measure-continuity.py` still names neither file).
  - **An APPENDED `describe('the manifest: one writer, and no reader in the tree but the program\'s caller
    (session-continuity 6b)')`.** It matches the registry spellings only, never the bare word (`this.inflight` already
    stands in four `server/src` lanes): in bash, `"$REG/$id.inflight"`-shaped paths and the field word after
    `_reg_set "$id" ` (`inflight`, with a word boundary after it); in Python and TypeScript, `.inflight` directly
    followed by a quote or a backtick. It checks four things:
    - a positive control: a planted fixture line of each spelling is matched, and a negative one: a planted
      `"$REG/.inflight.lock"` line (the manifest's own slot, R-A) is not, so the slot never counts as a site;
    - every code line naming the `inflight` field is inside `_inflight_write`, and they are exactly its listed write,
      its header-only write (both `_reg_set "$id" inflight …`) and its `rm -f -- "$REG/$id.inflight"`: a closed set
      of three named sites;
    - no file under `server/src`, `shared` or `pwa/src` names it, measured green on `origin/main` first;
    - `deploy/measure-continuity.py` names it nowhere (it reads swap.log only).
- [ ] **Step 2: Run, and confirm what fails.** Every new case fails, because the function does not exist. The census
  and the switches-history block fail too (except their positive controls).
- [ ] **Step 3: Implement** the constants, the three functions, the four site lines, the census row, the R-3
  paragraph's amendment, and the `contexts` rows and edges.
- [ ] **Step 4: Move the existing pins**, measuring each test before changing it. Never widen a pin. Add exactly the
  `manifest` line or the calls `_inflight_write` makes.
- [ ] **Step 5: Run** the new file, `switches-history`, `ccd-python-reader-census`, `ccd-contexts`,
  `ccd-die-containment`, `ccd-reg-get-census`, `ccd-operator-choice`, `ccd-graceful-stop`, `ccd-limit-no-keys`,
  `ccd-tick-diet-seams`, `ccd-supervise-roster-reread`, `ccd-swap-carry-merge`, `ccd-carry-dedupe`,
  `test/ccd-account-auth.test.ts` (by its path, above), `shellcheck-ratchet`, and every file
  Step 4's grep printed, each in its own process. Expected: PASS, and `shellcheck-ratchet` with no baseline change.
- [ ] **Step 6: Measure the mutation rows.**

| Row | Mutation | Expected red |
|---|---|---|
| IF-NA | the transcript test removed | `'not-applicable: …'` (the program runs) |
| IF-NAERR | the `projects/` listability test removed | `'an unlistable projects directory …'` (it reads `not-applicable`) |
| IF-BUSY | rc 1 read as `none` | `'busy: …'` |
| IF-STALE | step 7's header-only write removed | `'a busy write after a listed write …'` (the old items stand) |
| IF-BUDGET | rc 3 read as `error` | `'budget: …'` |
| IF-TIME | the call made without `_plat_timeout` | `'time: …'` (the case times out) |
| IF-COMPACT | the record compacted on an unmeasured write | `'busy: …'` (the record changes) |
| IF-LF | the kept rows written without their final newline | `'the compacted record ends in a newline …'` |
| IF-AGREE | a failed record write leaves the `listed` file | `'a failed record write …'` |
| IF-RELEASE | the release removed from the budget arm | `'releases the slot on every way out …'` (the in-subshell probe reads `SLOT-HELD` on the budget arm) |
| IF-OWNSLOT | `_inflight_slot_take` opens `$REG/.carry.lock` (the manifest takes the carry's slot) | both `'its own slot: …'` cases (busy under a `.carry.lock` holder alone; listed under an `.inflight.lock` holder alone), and the site census |
| IF-WAIT | the `account` test dropped | `'wait: an open limit-wait …'` (another account's span counted) |
| IF-RECENT | a closed `end=resume` record accepted at any site | `'wait: a revival a day after a limit-resume …'` |
| IF-WAITAGE | the `≤ INFLIGHT_WAIT_CLOSED_S` bound dropped at the limit-resume | `'wait: a revival a day after …'` (the old close at the limit-resume counts) |
| IF-CLAMP | a negative span written as is | `'wait: a reset already past …'` |
| IF-UNDATED | an accepted record with `reset=-` gives `wait=-` | `'wait: … reset=- gives wait=undated …'` |
| IF-NODIE | `die` on a failed `_reg_set` | `'never dies: …'` |
| IF-UNBOUND | the body's subshell removed (a plain `{ … }` body) | `'an abort inside the body ends only its subshell …'` (the swap does not land) |
| IF-STAMP | the limit-resume call moved above the `supervised` stamp | `'limit-resume writes it after the stop and the supervised stamp …'` |
| IF-ORDER | the `cmd_swap` call moved above `_swap_carry_sidecars` | the census, and `'the swap writes it … after the carry'` |
| IF-SITES | a call added to `cmd_hibernate` | the census |
| IF-KEEP | the `_end_note_gone` call moved above its early return | `'a revival writes it …'` (a swap end writes one) |
| IF-WRITER | a third `_reg_set "$id" inflight` line, in `_inflight_write` or another function | the switches-history `.inflight` describe |
| IF-CENSUS | the `_inflight_write` census row removed | `ccd-python-reader-census` |

- [ ] **Step 7: Growth.** Run `git fetch origin main`, then `GROWTH_CHECK=1` with `test/growth-check.test.ts`. The
  expected net delta for `ccd/ccd` is about +92 (about 8 of it `_inflight_slot_take`). Task 1's purge line is not counted here: growth is measured per PR
  against its merge base, and that line is 6b-1's, merged before 6b-2 branches. Over 40, add the waiver file
  named under Files: `{file: 'ccd/ccd', maxDelta: <measured, rounded up to the next 5>, d: '<that D-number>', reason:
  'the manifest in shadow (session-continuity 6b): its writer, its log line and its own slot beside the carry slot it
  mirrors, its nine constants and four site lines', added: '<today>'}`. `ccd/ccrc` is expected at +2. Report every delta.
- [ ] **Step 8: Commit.**

```bash
git add ccd/ccd ccd/contexts.tsv ccd/contexts-edges.tsv server/test/ccd-inflight.test.ts server/test/single-definition/switches-history.test.ts server/test/ccd-python-reader-census.test.ts server/test/ccd-account-auth.test.ts
# plus every pin Step 4 moved, and server/test/growth-waivers/<n>-ccd-ccd.json if Step 7 added it
git commit -m "feat(ccd): the manifest in shadow at the swap, the limit-resume and a revival (session-continuity 6b)"
```

---

### Task 4: `--stage 3` reads the manifests; an unreadable swap.log is unmeasured (D-8353); README and the spec

**Files:**
- Modify `deploy/measure-continuity.py`.
  - **`swap_log_lines(ctx)`**, under the header helpers. `carry_section`, `stage3`, `stage4` and `stage7` each call it
    instead of their own open.
  - **The stage-3 block gains:**
    - `S3_ENDED`, `S3_MANIFEST`, `S3_NOROOM`, `S3_DISPATCH_FAILED`, `S3_SWAP_REFUSED` and `S3_SWAP_DONE`;
    - `S3_DAYS_OUT_S = 86400`;
    - the named second spelling of the program's tuples, `MANIFEST_CLASSES`, `MANIFEST_VERDICTS`, `MANIFEST_WHY` and
      `MANIFEST_SITES` (Task 2, D-8376), held equal to the program's by Step 1's test;
    - `s3_manifest(lines, ctx)`.

    `stage3` returns `{"graceful_stop": …, "manifest": …}`.
- Modify (test):
  - `server/test/measure-continuity-stage3.test.ts`, with new describes;
  - `server/test/measure-continuity.test.ts`, with the carry section's unreadable row;
  - `server/test/measure-continuity-stage4.test.ts` and `server/test/measure-continuity-stage7.test.ts`, with one
    unreadable row each.
- Modify `README.md`: a paragraph after the 6a section, headed `### What was in flight at a restart is recorded, and
  read by nothing yet (session-continuity stage 3, wave 6b)`. It names:
  - the record, its four row kinds and its budget;
  - the three sites, and why the hibernate has none;
  - the file and its verdicts, and that every restart a site reaches rewrites it;
  - that it takes a slot of its own, `$REG/.inflight.lock`, never the carry's, so it never holds up a carry;
  - the `manifest` line;
  - that nothing reads either file before 6c;
  - that `--stage 3`'s `manifest` section is the shadow week's reading.
- Modify `docs/superpowers/specs/2026-09-23-session-continuity-design.md`. Add an `*(As built, wave 6b, 2026-11-12; an
  as-built annotation, not a new ruling.)*` note under §5.3's manifest paragraph, of at most eight lines. It names:
  - the three sites, and the hibernate's absence;
  - the classes as computed, citing `ccd/lib/inflight-manifest.py` and `ccd/ccd#_inflight_write`;
  - the `unread` verdict, and `listed` as the verdict with items;
  - the realpath-at-read rule;
  - that background shells stay in the turn marker;
  - `wait=`;
  - that the slot it takes is its own (the call-I amendment below);
  - this plan's D-numbers.

  Add, directly under the **Call I (D-8332)** bullet of §5.3's rev-12 amendment, an `*(As built, wave 6b, 2026-11-12:
  call I amended by D-8362, ruled by the coordinator and approved with the 6b plan.)*` note of at
  most five lines (R-A). It says:
  - the manifest takes its own box-wide slot, `$REG/.inflight.lock`, non-blocking, one manifest at a time on the box,
    and never `$REG/.carry.lock`, so the dedupe no longer makes a manifest `unmeasured` and a busy manifest means
    another manifest held that slot;
  - why: the carry slot is a box-wide budget for heavy reads and writes, not a lock between sessions; a carry touches
    one session's sidecars, the swap's manifest follows its own session's carry in the same process, and the
    limit-resume and revival carry nothing; the manifest is bounded on its own (`INFLIGHT_SCAN_BUDGET`, priced
    first, and `_plat_timeout`);
  - so a shadow manifest never refuses a carry, and no existing act changes.

  The bullet's own words stay as ruled; the note is the amendment, citing `ccd/ccd#_inflight_slot_take`. In the
  "Design calls for 6b and 6c (rev 12)" table, row I's title stays as ruled, and its Number cell gains the pointer:
  `| I. The carry lock is shared with the dedupe | D-8332 (amended by D-8362) | 6b |`, so a reader
  of the table is sent to the amendment. The manifest paragraph's "It takes the same slot" is covered by the as-built
  note under it (above). The programme ledger (`docs/superpowers/programs/session-continuity.md`), whose 2026-11-11
  decision still says the manifest shares the carry's slot (D-8332), is not this wave's to edit; the coordinator's
  acceptance entry for 6b-2 records the amendment there (Where things stand, Later).

  Add one dated sentence under §9's rev-12 note: the shadow week's counts are `--stage 3`'s `manifest` section.

**Interfaces:**
- **`swap_log_lines(ctx) -> tuple`.** It returns one of three answers:
  - `(lines, None)`;
  - `(None, {"swap_log": "absent"})` on `FileNotFoundError`;
  - `(None, {"swap_log": "unmeasured", "error": <the exception's class name>})` on any other `OSError`.

  Each caller returns the dict where it returned `{"swap_log": "absent"}` before. Nothing else in the file opens
  swap.log.
- **The patterns.** Each is a `fullmatch` with no trailing `$`:
  - `S3_ENDED = TS + r" ended (\S+): ([a-z][a-z-]*)"`;
  - `S3_MANIFEST` matches Task 3's `manifest` line exactly (the `unread-expired=` token included), its alternations
    built from the instrument's spelling of the four tuples (`MANIFEST_CLASSES`, `MANIFEST_VERDICTS`, `MANIFEST_WHY`,
    `MANIFEST_SITES`), and `wait=(\d+|-|\?|undated)`;
  - `S3_NOROOM = TS + r" rescuewait (\S+): kind=noroom on \S+ reset=-"`;
  - `S3_DISPATCH_FAILED = TS + r" dispatch FAILED for (\S+) -> \S+ \(resume\)"`;
  - `S3_SWAP_REFUSED = TS + r" swap-refused (\S+): .*"` (`ccd/ccd#_swap_refuse`'s line);
  - `S3_SWAP_DONE = TS + r" swap (\S+): \S+ -> \S+ \(uuid \S+\)"` (`cmd_swap`'s success line).
- **Pairing.** Each `ended <id>` line in the window pairs with the next `manifest <id>` line before that id's next
  `ended` line. The search reads past `--until`. Two lines in that span change what the restart is:
  - a `dispatch FAILED … (resume)` line marks it `not_restarted`;
  - for an `ended` line whose cause starts `swap-`, a `swap-refused <id>:` line before that id's next `swap <id>:`
    success line marks it `refused_restart`: ccrc restarted it on the source account (`_swap_refuse … 1`). A manifest
    paired with it (the roster arm writes one first) is still counted under its site and verdict, and the restart is
    never counted in `never_written_by_cause`.
- **Forward pairing.** For each restart with items, the same id's next paired manifest is read for `resumed`: a value of
  at least 1 there counts the restart in `restarts_with_items_later_resumed`, the numerator §9's "rescues with live
  work that resumed the exact run" needs once 6c resumes. In 6b it counts resumes made by hand.
- **`s3_manifest` returns `{"swap_log": …}`, or these keys:**
  - `restarts`, `restarts_by_cause`;
  - `manifests_by_site_verdict` (`"<site>/<verdict>"`);
  - `restarts_with_items` (call F's count), `restarts_with_items_by_site` and `restarts_with_items_by_class` (each
    restart counted once under every class its manifest lists, call 8's "by class");
  - `restarts_with_resumable_items`: restarts whose manifest lists at least one `in-flight`, `holed`, `stopped-agent`
    or `deferred-until-reset` item, so a restart with only `abandoned` or `diverged` items is not counted;
  - `restarts_with_items_later_resumed`, and `resumed_items` (the sum of `resumed`);
  - `items_by_class`, and `killed_in_flight` (the sum of `killed`);
  - `first_manifests`: `{restarts, restarts_with_items, items_by_class}` over the restarts whose paired manifest is its
    id's first `manifest` line in swap.log (the log is not rotated, so that is its first since 6b-2 deployed). They are
    the backlog 6b-1's interval left (What this does not claim, "6b-1 alone"). They stay in the main counts too, and
    call F's re-cut subtracts this key;
  - `unread_expired` (the sum of `unread-expired`);
  - `unmeasured_by_why` (`busy`, `budget`, `time`, `error`). `busy` counts manifests that found another manifest in
    their own slot (`$REG/.inflight.lock`, R-A); the section reads no `(kept: busy)` line, because no manifest holds
    the carry's slot (D-8362);
  - `not_applicable`, `unread_manifests`;
  - `never_written_by_cause`, `not_restarted`, `refused_restart`;
  - `drops` (`id`, `path`, `budget`, `shape`, `read`, `readpath`, `over`), summed over paired manifests. Every key but
    `over` counts each failure once; `over` is per write (Task 2). `path` plus `readpath` is how often a launch's
    script lay outside the sidecar;
  - `weekly_waits`, per restart, not per wait: `days_out` (restarts whose paired manifest carries `wait` of at least
    `S3_DAYS_OUT_S`), `days_out_with_items`, `days_out_deferred` (of those, the ones listing a `deferred-until-reset`
    item: call G's own wording), `wait_unreadable` (`wait=?`), `limitwait_reset_unknown` (`wait=undated`: an open wait
    with no dated reset, among the likeliest weekly ones, kept apart rather than folded into no wait), and
    `noroom_reset_unknown` (S3_NOROOM lines in the window). A weekly wait that ends `clear`, with no restart, is not
    counted: no restart cut its work;
  - `malformed_lines`: a line in the window that holds ` manifest ` and does not fullmatch.

  It reports, and sets no target.

- [ ] **Step 1: Write the failing tests.**
  - `'stage 3 reads the manifest lines: restarts by cause, verdicts by site, restarts with items, items by class'`. The
    log is hand-built, with `TZ=UTC`, and holds these restarts:

    | `ended` line | What follows it | Read as |
    |---|---|---|
    | `swap-auto-rescue` | a manifest `items=3 in-flight=2 holed=1` | a restart with items |
    | `limit-resume` | a manifest `none` | `limit-resume/none` |
    | `oom` | a manifest `unmeasured why=busy` | unmeasured, busy |
    | `exited` | a manifest `not-applicable` | not-applicable |
    | `swap-manual` | no manifest | never written |
    | `limit-resume` | `dispatch FAILED … (resume)` | not restarted |
    | `swap-auto-rescue` | `swap-refused` (a failed carry), no manifest | refused, not never written |
    | `swap-manual` | a manifest `listed items=1 abandoned=1`, then `swap-refused` (the roster arm) | refused, with a manifest |

    The log also holds one malformed manifest line, and one `ended` line before `--since`. Expected:
    - `restarts` 8;
    - `restarts_with_items` 2, `restarts_with_resumable_items` 1;
    - `restarts_with_items_by_class` `{'in-flight': 1, holed: 1, abandoned: 1, …zeros}`;
    - `items_by_class` `{'in-flight': 2, holed: 1, abandoned: 1, …zeros}`;
    - `unmeasured_by_why.busy` 1;
    - `not_applicable` 1;
    - `never_written_by_cause` `{'swap-manual': 1}`;
    - `not_restarted` 1;
    - `refused_restart` 2;
    - `malformed_lines` 1.
  - `'a manifest line written after --until pairs with its ended line inside the window'`.
  - `'weekly waits: wait=604800 with a deferred-until-reset item, wait=90000 with none, wait=86400 with none, wait=3600, wait=?, wait=undated, and two noroom reset=- lines'`.
    Expected: `{ days_out: 3, days_out_with_items: 1, days_out_deferred: 1, wait_unreadable: 1,
    limitwait_reset_unknown: 1, noroom_reset_unknown: 2 }`. The `wait=86400` restart sits on the `≥` boundary.
  - `'first_manifests: a restart whose manifest is its id\'s first manifest line is counted there, and a later one of the same id is not'`.
  - `'a restart with items whose id\'s next manifest has resumed=1 counts in restarts_with_items_later_resumed'`.
  - `'drops by why: drop-id, drop-path, drop-budget, drop-shape, drop-read and drop-readpath sum into their own keys; killed sums into killed_in_flight; unread-expired sums into unread_expired'`.
  - `'the instrument\'s MANIFEST_CLASSES, MANIFEST_VERDICTS, MANIFEST_WHY and MANIFEST_SITES equal the program\'s, and S3_MANIFEST\'s alternations are built from them'`.
    It reads the four tuples from both files' text and asserts each pair equal, and every `why=` word in
    `ccd/ccd#_inflight_write` is in `MANIFEST_WHY`.
  - `'a line the real _inflight_note wrote is read, for every site'`. `it.each` over `MANIFEST_SITES`: run
    `h.sh('_inflight_note lane-a-project-a <site> "<tokens>"')`, and the section reads it under that site.
  - `'an unreadable swap.log (a directory at its path) is unmeasured, never a traceback'`. Add one row in each of the
    four files: carry section, stage 3 (both sections), stage 4 and stage 7. Each expects exit 0 and `{ swap_log:
    'unmeasured', error: 'IsADirectoryError' }`.
- [ ] **Step 2: Run, and confirm what fails.** The manifest rows fail, because the section is absent. The four
  unreadable rows fail with a traceback.
- [ ] **Step 3: Implement** the helper, the four call changes, the section, the README paragraph and the spec
  note.
- [ ] **Step 4: Run** the four instrument files, `measure-continuity-stage6`, `measure-continuity-pressure-kills`,
  `docs-parity`, `readme-holds`, `anchors`, `citations`, `dtbd`, `topology-clean` and `oss-metadata`, each alone.
  Expected: PASS.
- [ ] **Step 5: Measure the mutation rows.**

| Row | Mutation | Expected red |
|---|---|---|
| S3M-PAIR | a manifest pairs with any later line, past the id's next `ended` | the hand-built case (`never_written_by_cause` empty) |
| S3M-GRAMMAR | `match` (a prefix) for `S3_MANIFEST` | the hand-built case (`malformed_lines` 0) |
| S3M-DISPATCH | the dispatch-failed test dropped | the hand-built case (`not_restarted` 0, never-written gains a `limit-resume`) |
| S3M-REFUSED | the swap-refused test dropped | the hand-built case (`refused_restart` 0, never-written gains a `swap-auto-rescue`) |
| S3M-RESUMABLE | `restarts_with_resumable_items` counts any item | the hand-built case (2, not 1) |
| S3M-FORWARD | the forward pairing reads the same manifest | `'a restart with items whose id\'s next manifest …'` |
| S3M-DAYS | `>` for `≥`, the constant left at 86400 | `'weekly waits …'` (`days_out` 2: the 86400 restart drops) |
| S3M-UNDATED | `wait=undated` folded into no wait | `'weekly waits …'` (`limitwait_reset_unknown` 0) |
| S3M-FIRST | `first_manifests` counts every manifest | `'first_manifests: …'` |
| S3M-SITES | the instrument's `MANIFEST_SITES` loses `revival` | `'the instrument\'s MANIFEST_CLASSES … equal the program\'s …'` and the `revival` row of `'a line the real _inflight_note wrote …'` |
| D8353-CARRY | `carry_section` back to its own `open` | its unreadable row |
| D8353-S3 | `stage3` back to its own `open` | its unreadable row |
| D8353-S4 | `stage4` back to its own `open` | its unreadable row |
| D8353-S7 | `stage7` back to its own `open` | its unreadable row |

- [ ] **Step 6: Commit.**

```bash
git add deploy/measure-continuity.py server/test/measure-continuity-stage3.test.ts server/test/measure-continuity.test.ts server/test/measure-continuity-stage4.test.ts server/test/measure-continuity-stage7.test.ts README.md docs/superpowers/specs/2026-09-23-session-continuity-design.md
git commit -m "feat(measure): --stage 3 reads the manifests, and an unreadable swap.log is unmeasured (session-continuity 6b, D-8353)"
```

---

### Task 5: 6b-2's gate, PR and wave-done

This is run 6b-2's gate, over Tasks 2 to 4, on a branch cut from `main` after 6b-1 merged. 6b-1's own gate is Task 1
Step 8, which runs these steps limited to Task 1.

- [ ] **Step 1: The stamp and the tree.**
  - `grep -c '^# ccrc:generated' ccd/ccd` prints 0.
  - `hook-helpers-generated` passes.
  - `git diff origin/main -- CLAUDE.md docs/superpowers/programs/ server/src shared pwa .github` is empty.
- [ ] **Step 2: The suites**, each in its own foreground `ccrc test` process:
  - every file Tasks 2 to 4 named, and Task 1's `session-hook-launch-record` (Task 2's round trip runs its hook);
  - `single-definition/*`, `census-w5/*`, `ccd-contexts`, `ccd-python-reader-census`, `ownership`,
    `shellcheck-ratchet`, `citations`, `anchors`, `docs-parity`, `topology-clean`, `private-names`, `dtbd` and
    `ccd-harness-integrity`;
  - then `git fetch origin main` and `deviation-refs`;
  - `growth-check` with `GROWTH_CHECK=1`;
  - `typecheck-tests`, alone.

  Re-run a known load flake alone before calling it a break.
- [ ] **Step 3: The mutation table.** Every row of Tasks 2 to 4 (MP-*, IF-*, S3M-* and D8353-*) is measured red when
  mutated and green when restored from its saved copy. The LR-* rows were 6b-1's.
- [ ] **Step 4: The private-name scan** runs on every added line and every commit message before the push.
- [ ] **Step 5: The PR.** Push, and open one PR from the workspace's branch to `main`. Its body holds:
  - the durable GitHub links to this plan and the spec;
  - the deviation block of 6b-2's entries (listed under "Deviations found": the two straddling entries with their read
    and `ccd/ccd` halves);
  - the mutation table and the suites;
  - the context edge `ccd-contexts` printed, with its reason;
  - the two `ccd-python-reader-census` rows, with their kind and why;
  - each file's growth delta.
- [ ] **Step 6: The wave-done.** Wait for the PR's fast run on the exact tip. Read its selection, and run any selected
  server file your list missed. Then send one wave-done at that tip with:
  - its `suite:` and `failure:` lines;
  - the mutation table;
  - the commits;
  - the PR number.

---

## Deviations found

Rulings D-8323 to D-8332 stand as the operator approved them (item 174), call I (D-8332) as amended by
D-8362 (R-A). The coordinator substitutes an allocated number for each entry below. Every
provisional value stands as provisional in its own entry (R-B): the record's 1 MiB and 4 KiB reserve
(D-8366); the manifest's 64 MiB read and 30 s bound (D-8376) and its
64 KiB file (D-8371); the eight-day abandon window, which also expires unread items
(D-8372); and the 600 s within which a closed limit-wait still counts at the limit-resume
(D-8375). The shadow week's reading is where each is revisited. A departure found during execution is named by slug in the wave-done.

**Which run each belongs to (note 8, as ruled).** Every entry is defined here, in this one plan, before either run
is dispatched; each run's PR carries, and its source comments cite, only its own:
- **6b-1 (Task 1)** carries six: D-8363, D-8364,
  D-8365 (its write half), D-8366 (its hook half),
  D-8367 and D-8379 (its waiver file, if Task 1 Step 6
  needs one, is in 6b-1's diff, because a waiver counts only in the diff that adds it).
- **6b-2 (Tasks 2 to 5)** carries the other fourteen (D-8362, R-A's, among them), and the read half
  of D-8365 and the `ccd/ccd` half of D-8366.

- **D-8361 (2026-11-12)** — manifest-writer-sites: the manifest is written at three sites.
  - **The swap**, in `cmd_swap` after its carry and the task-list copy, before `_swap_beat_stop`. This is the spec's
    first site.
  - **A supervisor revival**, in `_end_note_gone` at the supervise loop's gone exit, before `exit 1`. This is the spec's
    second site. A swap end that `_end_note_gone` keeps writes none, because the swap wrote its own.
  - **#2603's limit-resume**, in `_watchdog_resume_run` after its stop and `sleep 1`, before `cmd_ensure`. This site is
    added: the spec names neither the limit-resume nor the hibernate. It is the stop-then-restart after a wait to a
    reset, and the case where a limit-ended turn's work is lost (D-8316).

  It is not written at a hibernate. A hibernate refuses unless the turn marker reads exactly 0 background tasks, and the
  wake that follows is a spawn, which §8 rules out as a site. It is not written at `cmd_stop` or `ws-archive` either,
  because only the operator restarts those (D-8327). Of 6a's three graceful-stop sites, the swap and the limit-resume
  get a manifest and the hibernate does not.

  Every site writes one `manifest <id>:` line, and `ended` lines come from these three sites (`_end_record`'s callers).
  Two swap arms after `_end_record` restart the session on its source account instead (`_swap_refuse … 1`): a failed
  carry without `--force`, before the manifest, and a target that left the roster at the re-check, after it. The
  reading counts both as `refused_restart`, so it tells a restart that wrote no manifest (`never_written_by_cause`)
  from one refused back to its source and from one whose manifest is `none`. At the limit-resume the call sits after
  the `supervised` stamp, so the row's freshness is not spent on the manifest. Named costs:
  - the roster arm's manifest names the destination root's copies of its paths, though the session restarts on the
    source account;
  - each site's manifest holds its own slot, `$REG/.inflight.lock`, never the carry's (D-8362), so
    a site's manifest never refuses a carry; a second manifest on the box in that time writes `unmeasured why=busy`;
  - restarts no site reaches (a reboot, `_svc_stop`, a hibernate's wake, a stop then `ensure`, an archive restore)
    write no manifest and leave the previous one standing (D-8374).
- **D-8362 (2026-11-12)** — manifest-own-slot: amends call I (D-8332), ruled by the coordinator
  (R-A, after the plan's second review pass); the operator's approval of this plan approves the amendment. Call I has
  the manifest take `$REG/.carry.lock` non-blocking, as the carry does. As built, the manifest takes its OWN box-wide
  slot, `$REG/.inflight.lock`, non-blocking (`flock -n`), one manifest at a time on the box, through
  `_inflight_slot_take`, and never opens, names or locks `$REG/.carry.lock`. Holding the carry's slot for up to
  `INFLIGHT_TIME_S` plus the grace at each restart would make a concurrent swap's carry for another session log
  `(kept: busy)` and leave that sidecar unmerged, so the resumed session would read a stale sidecar: the stage-1 loss
  this programme removes, caused by a file nothing reads in 6b, against coordinator call 1 (a shadow write that
  changes an existing act does not ship on the default path). The reasons, measured on `origin/main`:
  - the carry slot is a box-wide budget for heavy reads and writes, not a correctness lock between sessions:
    `_swap_carry_sidecars` takes it for ONE uuid's sidecars, and it and `_swap_carry_jsonl` are called from `cmd_swap`
    alone. The manifest reads its own session's sidecar; at the swap site it runs after its own session's carry, in
    the same process; `_watchdog_resume_run` and `_end_note_gone` carry nothing. The dedupe, the slot's other taker,
    changes only copies on an account other than its keeper and skips a uuid a swap.log line named in its window.
    The slot also keeps a merge walk and the dedupe apart on one uuid: a lock between two actors on one session's
    copies, in which the manifest, which only reads, has no part (COORDINATOR note 10);
  - the manifest is bounded on its own: `INFLIGHT_SCAN_BUDGET` prices its reads before it starts, and `_plat_timeout`
    bounds its time;
  - so a shadow manifest never refuses a carry, and no existing act changes; only the three named timings do.

  `_inflight_slot_take` mirrors `_carry_slot_take` (rc 0 with the caller's local `INFLIGHT_SLOT_FD` set, 1
  contended, 2 no mechanism; the file never unlinked). It is a second slot helper, legitimately different under the
  consolidation rule: a separate budget whose whole point is never to contend with the carry's, and a shared helper
  would edit `_carry_slot_take`, the carry's own code, which this wave leaves byte-identical. `why=busy` now means
  another manifest held this slot; the dedupe (#317) never makes a manifest busy. The record's compaction runs inside
  this slot. `$REG/.inflight.lock` is a new dot-prefixed registry artifact, unreachable by an aliasing id for
  `.carry.lock`'s reason (no id is the dash-free `.inflight`), so `_reg_purge`'s R-3 paragraph counts it
  (TWENTY-THREE) and `ccd-account-auth.test.ts`'s `CARDINAL` gains `'TWENTY-THREE'`. The plan's earlier
  `carry_kept_busy_near_manifest` reading, its test and S3M-NEAR are removed: there is nothing left to measure.
  Pinned by `'its own slot: …'` and IF-OWNSLOT (Task 3). Named cost, inside the shadow only: one manifest at a time
  on the box, so a mass rescue's later manifests may read `unmeasured why=busy`, counted in
  `unmeasured_by_why.busy`. The spec's call-I bullet gains an as-built note, and its calls table's row I a pointer
  to this amendment (Task 4); the programme ledger's record of it is the coordinator's acceptance entry.
- **D-8363 (2026-11-12)** — launch-record-one-parse: the launch record's jq, `def lrec`, sits
  inside `DSP_DEFS`, the hook's one parse. It shares the spool's id, bound and outcome defs (`isid`, `fits`, `obj`,
  `outcome`), and `def spool` is byte-identical. It does NOT reuse the spool's launch object, and that is the
  legitimately-different reason under the consolidation rule: the spool builds a launch only when every id and the
  four labels and paths pass, so a launch with a bad id or a 129-byte name reads as no launch there, while the record
  must count a bad id (`drop`, `why=id`) and needs none of the labels. The parse gains a ninth output line, and its
  `lrc_out` wrapper makes it exactly one line on every event, because the parse ends `|| exit 0` and a missing line
  would drop the whole event. Four things change in the gate:
  - the row's generation is read without the spool directory;
  - the directory stays the spool's own condition;
  - the prefilter gains `"SendMessage"`, which the spool's definitions compile for and then ignore;
  - without the spool directory, `DSP_DEFS` is compiled only for a PostToolUse that quotes `"Agent"`, `"Task"`,
    `"Workflow"` or `"SendMessage"`, so every other event still compiles the parse alone.

  The launch record therefore works whether or not the closed broker's directory exists.
- **D-8364 (2026-11-12)** — launch-record-subagent-by-join: D-8324 drops "rows from a
  subagent's own hook input". The hook tells a subagent's event by its join file, as the turn marker does (`tmsub`: an
  `agent_id` named in `$REG/<id>.joined` or `.joinedprev`), never by the presence of an `agent_id`, because real lanes
  sent main-thread tool events with an `agent_id` nothing joined (amendment `tool-agent-id-alone-is-unjoined-evidence`).
  Named cost: a subagent whose SubagentStart was never joined (a lost join, or an id outside `isid`) has its launches
  recorded as the main thread's.
- **D-8365 (2026-11-12)** — launch-record-path-checks: spec §5.3 asks for a script path to
  resolve, by `realpath`, under this session's current-root sidecar, at write and again at compose. **Write half
  (6b-1):** the hook does not fork for `realpath`, so the write-time check is lexical: the path's presence, its length
  (512 bytes), its prefix, its name class and its byte class. **Read half (6b-2):** the `realpath` check runs at the
  manifest's read, against the current root, after re-rooting the path at its last `/projects/`.
  - A path that fails either check is dropped from its row or item, never the row or item itself. At write it becomes
    `script: null`, after one `drop` row (`why=path`) on the same output line. At read it becomes `script=-`, the kept
    row is rewritten with `script: null`, and `drop-readpath` counts it. Either way it is counted once. The item's
    class comes from the journal, which the path does not touch.
  - A row whose ids fail is still dropped whole, and counted (`drop` row, `why=id`).
  - A launch by a file path, and wave 5's R3 resume (a working-directory copy), therefore keep their rows but no path.
- **D-8366 (2026-11-12)** — launch-record-budget: `$REG/<id>.deleg` holds at most
  `LRC_MAX_BYTES`, 1 MiB (about 3,000 rows), provisional.
  - A row that would pass it is not written. A `drop` row (`why=budget`) is written instead, but only while the size
    plus that row and its newline fit in `LRC_MAX_BYTES + LRC_DROP_RESERVE` (4 KiB of reserve, provisional), so a
    sequence of appends never passes the sum. A path failure's two lines are written both or neither.
  - Named cost: past the reserve (about 90 drop rows), launches are lost uncounted until the next manifest compacts the
    record; in 6b-1 alone nothing compacts. Parallel appends that each passed the size check can pass the sum; the
    manifest counts that overflow once in `drop-budget` and removes it.
  - The hook forks one `wc -c` for each row it writes, and for nothing else (corrected by D-8403: one per append once
    the record exists, none for a session's first append, and over budget one subshell for the drop row's time).
  - **Hook half (6b-1):** the constants are spelled in the hook (`LRC_MAX_BYTES`, `LRC_DROP_RESERVE`), alone and
    pinned by nothing until 6b-2. **`ccd/ccd` half (6b-2):** `LAUNCH_RECORD_MAX_BYTES` and `LAUNCH_RECORD_DROP_RESERVE`
    are defined in `ccd/ccd` (Task 3, where `_inflight_write` reads them as the program's `<record-max>`), and a Task 3
    test pins the two spellings equal (COORDINATOR note 4).
  - The append takes no slot: each append is one `printf`, one `write(2)` per line (D-8401), the spool's rule.
- **D-8367 (2026-11-12)** — launch-record-purged-after-generation: the hook
  appends `$REG/<id>.deleg` without a lock, so a purge can run between its generation test and its append, and an
  orphaned dot-free field holds the slug for ever (`_ws_slug_free`). The join record's two-sided rule is copied:
  after the append the hook tests the generation once more and removes `.deleg` if the row is gone, and `_reg_purge`'s
  post-generation `rm` takes `.deleg` beside `.joined` and `.joinedprev` (a one-line `ccd/ccd` edit in Task 1, which
  moves two expectations of `ccd-lifecycle-purge.test.ts`'s last-unlink case: the last-call pin and the filtered
  list's third element). Not closed, as for the join record: a hook killed between its append and its re-check, after
  a purge that had already finished.
- **D-8368 (2026-11-12)** — manifest-program-is-a-ccd-library: the join runs in
  `ccd/lib/inflight-manifest.py`. It is read-only, opens regular files only, is called by `_inflight_write` alone under
  `_plat_timeout`, and is shipped, backed up and removed beside `carry-dedupe.py`. It is not embedded in `ccd/ccd`, so
  the listed file grows by its call sites only. As a `.py` program it is not held by the growth check.
- **D-8369 (2026-11-12)** — manifest-reads-journals-beside-the-server: the
  program is a second reader of Claude Code's workflow journal and summary formats, beside the server's
  `server/src/workflows/model.ts`. It is legitimately different under the consolidation rule: another process, on
  another box, at stop time, with no FleetIO between them.
  - `inflight-manifest-parity.test.ts` pins the two readers to one table. The program's journal line reader mirrors
    `parseLine`'s head search for a line that does not parse, so a cut line counts the same in both.
  - An agent transcript's newest row is not parsed in Python. It is read by `agent_end`, a new entry point of
    `ccd/lib/transcript.jq` (the ccd side's one transcript reader), called once per manifest over every tail.
  - This number is the D-number of the two `ccd-python-reader-census.test.ts` rows (D-8070's census):
    `lib/inflight-manifest.py` and `_inflight_write`, each `no-read`.
- **D-8370 (2026-11-12)** — killed-summary-is-in-flight: the manifest's "finished" needs a
  summary that parses with `status` `completed` or `failed` and is no older than the journal. The server's
  `server/src/workflows/model.ts#decideRun`, as `server/src/workflows/read.ts` feeds it, takes mtimes only and reads
  any summary file no older than the journal as finished. So the manifest reads three summaries as in flight that the
  server reads as finished: `killed`, a non-final status, and one that does not parse. The reason is a precaution: a
  `killed` summary may come from the stop the manifest follows, which is unmeasured (the `killed=` token measures it),
  while D-5561's measured orphans of dead or swapped sessions had no summary at all; and a torn or non-final summary
  proves nothing finished. Its named cost: a run the operator killed on purpose is listed too. The parity test pins
  the three differences by name.
- **D-8371 (2026-11-12)** — manifest-classes-in-shadow: every class in the spec's table is
  computed in shadow, by the precedence and the reads of Task 2's class table. `holed` uses the latest attempt per
  journal key. `deferred-until-reset` is, for a workflow item, attempts ≥ 1 and a run agent whose `.meta.json` is at or
  after the newest resume row ending on the limit; for an agent item, a send after its launch and `agent_end`
  `rate-limit`. Its `reset=` is the deciding rate-limit row's own `quotaLimits.resetsAt` (spec §5.3's `<resetsAt>`),
  falling back to the session's accepted limit-wait reset, else `-`. `diverged` is read at the swap only, from this
  carry's own `diverged` lines. An agent is finished only when its newest real row is a non-error assistant row with
  `stop_reason` `end_turn`; `ccd/lib/transcript.jq#complete`, which accepts `tool_use`, is not used for it, and a torn
  final line answers `open`, never stepped over to an `end_turn` before it. `agent_end` and `limit_banner` share one
  rate-limit row test. There are three additions:
  - **Recent sidecar runs.** A run in the sidecar whose journal changed in the last day, and that no row names, joins
    the items as `src=sidecar`. This reads the spec's "joined with sidecar files changed in the last day".
  - **The `unread` verdict.** An item whose files cannot be read, or are not regular files, is counted as `unread`
    before any class is tried, never given a class. A manifest with no item but some unread ones has a verdict of its
    own, `unread`, never `none`. A manifest with items is `listed`, the spec's word. An unread item whose newest row is
    older than `INFLIGHT_ABANDON_S` is retired and counted in `unread-expired`, never listed as `abandoned`, so a run
    directory that never appeared does not hold the session's verdict at `unread` for ever.
  - **Two counts for the shadow week.** `killed` (in-flight items with a `killed` summary) and `resumed` (items with a
    resume or send after their launch).

  Items are written in action order (in-flight, stopped-agent, holed, deferred-until-reset, diverged, abandoned) under
  `INFLIGHT_MAX_BYTES` (64 KiB, provisional). Items past that are counted in `drop-over`, and their rows are kept.
- **D-8372 (2026-11-12)** — manifest-abandon-window: an item whose last activity is older than
  `INFLIGHT_ABANDON_S` (eight days, provisional), with no terminal record, is `abandoned`. Its last activity is the
  newest of its row times and the mtimes of its journal, summary and agent transcripts, never its launch alone. The
  window is the longest wait to a weekly reset (seven days, call G) plus a day, so work the limit stopped at the start
  of a weekly wait is still in flight at the limit-resume that ends it. The item is reported once, by the write that
  first finds it, and that write removes its rows, so it is counted and never dropped silently. The same window also
  expires unread items (`unread-expired`, D-8371).
- **D-8373 (2026-11-12)** — manifest-retires-and-compacts: each successful manifest
  rewrites `$REG/<id>.deleg` through `_reg_set`, after `.inflight` is written, with a newline after its last kept row.
  It keeps the rows of listed, over-budget and unread items, and removes the rest, counted:
  - finished items;
  - reported `abandoned` items;
  - expired unread items (`unread-expired`);
  - rows of another uuid;
  - sends that join no launched agent;
  - invalid lines (`drop-read`), and anything past `<record-max>` (once in `drop-budget`);
  - the summed `drop` rows.

  An unmeasured or not-applicable write leaves the record alone. A record write that fails turns the manifest into
  `unmeasured why=error`, file and line alike, so nothing it would have retired is lost unreported. Named costs:
  - a hook append that races the rewrite is lost, though the stop has ended Claude Code by then;
  - a `/clear` or a continued-in chain retires the old uuid's launches.
- **D-8374 (2026-11-12)** — manifest-file-is-rewritten-at-every-restart:
  spec §5.3 says a busy or over-budget write "writes `unmeasured`", and the file's absence means `never-written`. Every
  `_inflight_write` therefore writes `$REG/<id>.inflight`: the header and items when measured, the header alone for
  `unmeasured` and `not-applicable`. A write of the file that fails removes it. So the file holds the answer of the
  latest restart a site reached, or is absent, and never an earlier site-reached restart's items. Not closed:
  - a path that is neither writable nor removable (a directory) keeps what stands there; the log line still says
    `why=error`;
  - a restart no site reaches (a reboot or `_svc_stop`, whose SIGTERM the supervisor does not trap; a hibernate's
    wake; a stop then `ensure`; an archive restore) leaves the previous manifest standing, items included. 6b reads
    swap.log only; 6c, which reads the file, compares its header's `at=` and `gen=` against the session's latest spawn
    before trusting its items.
- **D-8375 (2026-11-12)** — weekly-wait-read-from-the-record: call G's count of waits
  with a reset days out is read from `$REG/<id>.limitwait` at the manifest's write (COORDINATOR note 1). No wait row in
  swap.log carries the reset: the `limit-wait` line has none, and a no-room rescue wait records `reset=-` on any block
  that is not `five_hour`.
  - **The record that counts.** One on the session's account with a numeric `since` and a numeric or `-` `reset`, and
    either open, or (at the limit-resume only) closed `end=resume` within `INFLIGHT_WAIT_CLOSED_S` (600 s,
    provisional) of the write. A closed record is never removed, so without that bound one wait would be counted again
    at every later restart.
  - **The span.** `reset − since` rides the manifest as `wait=`, `0` when the reset had already passed at the opening,
    `undated` when the accepted record's reset is `-` (an open wait `_limitwait_open` could not date, an unmeasured
    span that `--stage 3` counts as `limitwait_reset_unknown`), `?` when the record is unreadable, and `-` otherwise.
    The same reset is `deferred-until-reset`'s `reset=` only where the deciding rate-limit row carries none of its own.
  - **The count.** `--stage 3` counts restarts, not waits: restarts whose manifest carries `wait` of at least one day,
    those of them with items, and those with a `deferred-until-reset` item (call G's own wording). A weekly wait that
    ends `clear`, with no restart, is not counted. No-room rescue waits are counted apart, as `noroom_reset_unknown`.
- **D-8376 (2026-11-12)** — manifest-unmeasured-words: `unmeasured` carries `why=busy`
  (another manifest holds the manifest's own slot, `$REG/.inflight.lock`: call I as amended by
  D-8362), `why=budget` (the read priced over `INFLIGHT_SCAN_BUDGET`, 64 MiB, provisional),
  `why=time` (the program outran `INFLIGHT_TIME_S`, 30 s, provisional) or `why=error`. `error` covers no `flock`, no
  `python3`, the program missing or failing, a record that is not a regular file, an unwritable file, no uuid or
  config root, and a config root or `projects/` directory that cannot be listed. `time` and `error` are their own words
  because their remedies differ, as the carry's `(kept: error)` is. Call 8's split of busy from over-budget stands,
  with these words beside it (COORDINATOR note 5). The four words are `MANIFEST_WHY`, spelled once in the program,
  beside `MANIFEST_CLASSES`, `MANIFEST_VERDICTS`, `MANIFEST_SITES` and `MANIFEST_DROP_WHY`. Named second spelling:
  `deploy/measure-continuity.py` re-spells the first four, because the instrument runs from the tree on any box and does
  not import a program shipped to `~/.cc-sessions/lib/`; Task 4's test reads both texts and holds each pair equal, as
  note 4's constants are held.
- **D-8377 (2026-11-12)** — shells-stay-in-the-turn-marker: spec §5.3 lists the
  background shells the stop kills in the manifest. 6b does not: the hook already carries them across the restart in
  the turn marker (`lostBg`, `lostKinds`, `lostIds`, from the stopped turn's `bg` and `bgIds`, across a `failed` turn
  since D-8316), and a second copy in the manifest would be a second writer of one fact. Nothing in 6b re-arms a
  watcher, so nothing reads them in shadow. 6c, which composes the redrive and re-arms the watchers, reads them from the
  marker; if 6c finds the marker's copy insufficient, it takes the listing with a deviation of its own.
- **D-8378 (2026-11-12)** — stalled-split-not-read-in-6b: §9's stage-3 row reports
  "stalled vs not-stalled restarts with a non-empty manifest". 6b's reading does not split them: the redrive's
  `not-stalled` word cannot tell a session that Claude Code redrove from an idle one, and the not-stalled wake that
  tells them apart is 6c's. The shadow week's reading reports restarts with items by site, cause and class instead,
  and 6c's plan adds the split.
- **D-8379 (2026-11-12)** — launch-record-hook-growth: the waiver for `ccd/session-hook.sh`'s
  net growth past 40 code lines, for the launch-record block and the gate's changes, kept in the hook because the hook
  loads no library. It is used only if Task 1 Step 6 measures over 40 (about +35 expected). Otherwise it is reported
  unused.
- **D-8380 (2026-11-12)** — manifest-ccd-growth: the waiver for `ccd/ccd`'s net growth past 40
  code lines, in 6b-2's PR. It covers `_inflight_write`, `_inflight_note`, `_inflight_slot_take`
  (D-8362), the nine constants beside `CARRY_MERGE_BUDGET` and the four site lines, kept beside the
  carry slot the helper mirrors. The purge's one changed line is 6b-1's
  (D-8367), in 6b-1's diff, not here. It is used only if Task 3 Step 7
  measures over 40, which is expected (about +92).

D-8353 (the unreadable swap.log in `--stage 3`, stage 4, stage 7 and the carry section) is carried from 6a and taken
here by Task 4. It needs no new number.

## Where things stand

**Agreed:**
- calls B, F, G, H and I (D-8324, D-8329 to D-8332) and E (D-8328), as the operator approved them (item 174), call I
  as amended by D-8362;
- this coordinator's calls 1 to 12 for 6b, as ruled, with the departures in the COORDINATOR notes and the deviations
  above; the coordinator accepted notes 1 to 7, and note 9 as R-A amends it;
- R-A, ruled by the coordinator: the manifest takes its own box-wide slot, `$REG/.inflight.lock`, non-blocking, and
  never `$REG/.carry.lock`, so no carry is refused by a manifest and no existing act changes
  (D-8362, amending call I, D-8332; 6b-2's). The operator's approval of this plan approves that
  amendment;
- R-B, ruled by the coordinator: the provisional values stand as provisional, each in its numbered deviation (the
  record's 1 MiB and 4 KiB reserve, the manifest's 64 MiB read, 64 KiB file and 30 s bound, the eight-day abandon
  window that also expires unread items, and the 600 s for a closed limit-wait at the limit-resume), revisited from
  the shadow week's reading; and `lib/inflight-manifest.py`'s census kind is `no-read`;
- note 8, as ruled: two runs on this one plan, 6b-1 = Task 1 (its gate, PR and wave-done in Task 1 Step 8) and
  6b-2 = Tasks 2 to 5, for review size and so the record collects from 6b-1's deploy;
- D-8353, taken by Task 4.

**Waiting on you:**
- Nothing for the coordinator: it ruled the slot (R-A) and the rest (R-B).
- For the operator: the approval of this plan, which also approves D-8362's amendment of call I
  (D-8332).

**Later:**
- The coordinator's acceptance ledger entry for 6b-2 records D-8362's amendment of call I (D-8332),
  so the programme ledger's 2026-11-11 decision ("the manifest shares the carry's slot with the daily dedupe timer")
  is no longer the last word there; the wave itself does not edit the ledger.
- After 6b-2 deploys, one shadow week of `--stage 3`'s `manifest` section re-cuts §9's stage-3 baseline (call F),
  less `first_manifests` (6b-1's backlog). Its `weekly_waits` count goes to wave 7's proposal for any bound (call G).
  The same reading revisits each provisional value (R-B).
- 6c's plan reads the manifest: the composed prompt (call A), the session-start subject under its ceiling, the
  server's FleetIO read and the wake (call C). 6c also takes:
  - the pins of the Workflow resume strings;
  - the stall mails' wording after a `failed` turn;
  - SendMessage after a restart;
  - the stalled and not-stalled split (D-8378);
  - the background shells, read from the turn marker (D-8377);
  - trusting `.inflight` only when its header's `at=` and `gen=` are no older than the session's latest spawn
    (D-8374);
  - the comment owed to review 729.
- Before `graceful-stop-live` is armed: D-8350, D-8351, D-8352 and the start-time anchor.
- Still open, and measured from the shadow week by what this plan adds:
  - whether a resume's hook payload has the shape the record expects: `drops.shape` and `drops.id` against the
    `resume` rows;
  - whether the stop writes `killed` summaries: `killed_in_flight`;
  - how often a launch's script lies outside the sidecar: `drops.path` plus `drops.readpath`;
  - how often a restart's items were later resumed: `restarts_with_items_later_resumed`, by hand only until 6c;
  - how often one manifest at a time on the box costs a measurement: `unmeasured_by_why.busy` (R-A).
