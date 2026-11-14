# Session continuity, wave 6a — the graceful stop in shadow, lost background work across a failed turn, and stage 3's spec revision Implementation Plan

> **COORDINATOR notes from drafting.** Each was measured on `origin/main` at `520b11c0d`; the review revision re-read
> them at `e40c3ebc8`, where `ccd/ccd`, `ccd/session-hook.sh` and `server/src/coord/stall.ts` are unchanged. The
> coordinator accepted all eight on 2026-11-11, and ruled the two left open: note 7's narrowing stands, and call H is
> keyed as note 8 says. The operator's approval of the plan covers them.
> 1. **No restamp.** The design calls say `ccd/ccd` is generated and must be restamped. That is false on main.
>    `ccd/ccd` carries no committed stamp: its line 2 is `# ccrc:stamp-at-install`, `ccd/ccrc restamp` refuses it,
>    and worker clause 16 says so. `ccd/session-hook.sh`'s stamp covers only its generated helper region, which this wave
>    does not touch. So the plan has no restamp step. Task 5 checks that `grep -c '^# ccrc:generated' ccd/ccd` prints
>    0 and runs `hook-helpers-generated`.
> 2. **"If a real measurement needs the signal."** Today's `tmux kill-session` already hangs up Claude Code's
>    terminal. Claude Code's SIGHUP handler calls the same `shutdown()` as its SIGTERM handler: exit 129 against 143,
>    on the interactive (non-daemon) path. This was read in the installed bundles of builds 2.1.314 and 2.1.322, and
>    ccd assumes the hang-up too (`ccd/ccd#_pane_scope_reap`, "a process that exits on the hang-up"). So the shadow
>    sends no new signal. It times that same shutdown after today's kill, with the terminal already gone, from a
>    detached observer. The operator-armed marker `$REG/graceful-stop-live` is still needed, because it measures the
>    one thing the shadow cannot: the shutdown with its terminal still open, which is what SIGTERM before the kill
>    gives. Both arms are built as ruled. With the marker absent, the stop's acts and their order are today's, but the
>    stop is not today's byte for byte (note 7).
> 3. **Call C contradicts two spec sentences.** Call C (the stall watch mails the session its composed list) conflicts
>    with spec §4 ("The server … never mails a resume list") and with §12, which puts "server mail carrying resume
>    lists" out of scope. Task 4 amends both as part of C, through a new §3 row (C15), and the operator's choice C
>    says so. §4's "never types beyond the existing redrive fallback's constant text" has been false since D-5237,
>    and is corrected with the other stale neighbours.
> 4. **Call A cites its basis slightly wrong.** It names "a current-root scriptPath and the carry's copy" as refused.
>    In wave 5 those are one row: R1, the current-root path, *is* the carry's hard link. The other refused row is R2,
>    the path the tool returned before the swap, under the old root. The spec text in Task 4 says so.
> 5. **Ruling (ii) is built as written, with one limit.** It says to carry `bg` into `lost*` from a `failed` marker.
>    The `bg` that a `failed` line carries is the count at the last Stop *before* the failed turn
>    (`TURN_MARK_PROGRAM` carries it through `working` into `failed`). StopFailure's payload is not read for
>    `background_tasks`. So tasks launched during the failed turn are not counted, and tasks that finished after that
>    Stop are. The limit is recorded as part of D-8316. Counting a turn's own launches is 6b's
>    launch record. `_swap_bg_hold` still does not hold on `failed`, so a limit-resume still ends that work; it is
>    now recorded as lost.
> 6. **Hibernate's stop has a different shape.** Reading 0 said all three stops "stop the unit, kill tmux and
>    sleep 1 s". Hibernate's stop runs through `_ws_unsupervise`, not `_svc_stop`, and has no `sleep 1`. A plain
>    hibernate also runs while holding the coordination serialiser (D-7541). So in shadow it adds no wait (the
>    observer is detached), and the live arm's wait of at most 10 s holds the serialiser for that time. Both are
>    named below. Hibernate also reads the pane already (D-7902's `_pane_scope_of`, whose four `PANE_SCOPE_*` globals
>    `_pane_scope_stop` acts on after the kill), so the graceful stop reuses that read there and never re-reads
>    (Task 2): a second read would overwrite the one D-7902 acts on, and a wedge on it would turn the scope stop into
>    `held: tmux did not answer …`.
> 7. **Ruling (i)'s "absent = today's stop byte for byte" is narrowed to "the same acts in the same order".** It
>    cannot be kept byte for byte and still measure anything. With the marker absent the shadow adds, before the kill
>    at swap and at limit-resume, one bounded tmux pane read, which a wedged tmux stretches to
>    `SUBSTRATE_PROBE_DEADLINE_S` (8 s) before the kill. At all three sites it adds, after the kill, one synchronous
>    `systemd-run --user --collect --quiet` call (`ccd/ccd#_svc_run_detached`, through `_pane_scope_detach`) that
>    starts the observer's transient unit, and one swap.log line. At hibernate that `systemd-run` call runs while the
>    coordination serialiser is held (D-7541); hibernate adds no pane read (note 6). No signal is sent and nothing is
>    waited on. Approval rules on this narrowing; D-8317 records it.
> 8. **Call H's premise is false on main, so Task 4 does not restate it.** Call H says a lane of exec kind `codex` has
>    no Claude Code transcript. On main a codex lane runs Claude Code itself: `ccd/ccrc-codex`'s header step 7 "execs
>    the roster's upstream Claude Code binary IN PLACE, argv untouched", after it exports `ANTHROPIC_BASE_URL` at a
>    local shim (`shared/roster.ts#CODEX_BRIDGE_MODES`: `direct` is "one ccrc process answering Claude Code itself").
>    So a codex lane writes Claude Code transcripts like any other, and a `not-applicable` keyed on the exec kind would
>    hide its in-flight work. The plan keeps call H's rule (a session with no Claude Code transcript answers
>    `not-applicable`) and keys it on the measured fact, not on the exec kind; spec §6's "(the Codex lane)" carries the
>    same false premise and Task 4 corrects it. **The coordinator rules on this before approval:** keep the re-key, or
>    restate call H.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Execution status:** Drafted 2026-11-11 for run 1777 at base `520b11c0d1d09230c20ea1751c6bc225bc47cf7b`. The inputs
> were three read-only readings of `main`, a critic's pass over them, and the coordinator's design calls. It is not yet
> approved. Once it lands, it is dispatched as one worker run, recorded in the programme ledger.

**Goal:** This wave does three things:
- it measures how long Claude Code takes to stop at each ccd stop that ccrc itself resumes (shadow), with SIGTERM
  behind an operator-armed marker. With the marker absent no session sees a change;
- it makes a restart after a failed turn record the background work it ended. That one change does reach sessions:
  a restart after a limit-ended (or otherwise failed) turn now becomes Orphan D's candidate and the D5 `restarted`
  arm's, so the session, and for a run worker its coordinator, get mail that never fired before, wherever the
  wave-2 arms are armed (`stall-watch-w2-live`, or the stall watch's Settings level `all`);
- it revises spec §5.3 into stage 3's three waves, with the design calls for 6b and 6c.

**Architecture:**
- **Task 1 (`ccd/session-hook.sh`).** One clause of `TURN_MARK_PROGRAM`'s restart branch widens from a `done` line to
  a `done` or `failed` line. The edit is in place.
- **Task 2 (`ccd/ccd`).** Five C2 functions sit beside the pane-scope stop, `_graceful_stop_before`,
  `_graceful_stop_after`, `_graceful_stop_observe`, `_graceful_stop_same` and `_graceful_stop_note`, with three
  constants. The three
  stop-then-resume sites call the first two around their `tmux kill-session`. Each stop writes one `graceful-stop`
  line to swap.log. The functions reuse:
  - the bounded pane read, `_pane_scope_of`;
  - the start-time reader, `_ci_proc_start` (the identity check, `_graceful_stop_same`, keeps "gone" and "start time
    unreadable" two answers, which `_ci_hold_live` folds into one rc 1);
  - the transient-unit seam, `_pane_scope_detach`.
- **Task 3.** `deploy/measure-continuity.py --stage 3` gains a `graceful_stop` section that reads those lines, and
  README gains a paragraph.
- **Task 4.** The spec revision (rev 12).
- **Task 5.** The gate, the PR and the wave-done.

**Tech Stack:** Bash (ccd, the session hook), jq, Python 3 standard library under `python3 -I` (the instrument), and
vitest in `server/` with fixture HOMEs.

**Spec:** `docs/superpowers/specs/2026-09-23-session-continuity-design.md`: §5.3 above all, then §4, §6, §8, §9, §10,
§11 and §12. The ledger is `docs/superpowers/programs/session-continuity.md`: the wave table's row 6, the carried
constraints "Wave 6 (stage 3): this coordinator's proposals" and "From wave 5 … for wave 6's plan", and Decisions from
2026-11-10 17:59 to 2026-11-11 01:41. Wave 5's results are in
`docs/superpowers/plans/2026-11-07-session-continuity-wave5-spike-results.md` (§2.3 to §2.5). Wave 5's departures,
D-8252 and D-8260 among them, are in `docs/superpowers/plans/2026-11-07-session-continuity-wave5-departures.md`.

**Prerequisite:** wave 5 (#2602) and #2603 (D-8123's in-place restart, made automatic by D-8173's ruling (a)) are on
`main`. Deploy class: **AGENT-FIRST**. Only `ccd/ccd`, the hook and the instrument ship, and no `server/src` file
changes.

## What main does today (measured at `520b11c0d`)

| Fact | Where | Bearing |
|---|---|---|
| Three stops that a resume follows: stop the unit, kill the pane, then sleep one second for the swap and the limit-resume. Hibernate disables the unit with `_ws_unsupervise` and has no sleep. | `ccd/ccd#cmd_swap`, `ccd/ccd#_watchdog_resume_run`, `ccd/ccd#cmd_hibernate` | Task 2's three sites. |
| No ccd stop sends SIGTERM to Claude Code. The kill hangs up the terminal, and Claude Code handles SIGHUP and SIGTERM with one `shutdown()`. | the stop lines above; Claude Code 2.1.314 and 2.1.322 bundles | COORDINATOR note 2. |
| The pane's pid *is* Claude Code's pid: the wrapper `exec`s, and Claude Code writes `sessions/<pid>.json` under that pid. | `ccd/ccd#_swap_idle_gate` (`$cfg/sessions/$spid.json`) | What the stop signals and times. |
| A bounded pane read, a start-time reader and a transient-unit seam already exist. `_pane_scope_of` resets and sets four globals that `_pane_scope_stop` acts on after hibernate's kill. `_ci_hold_live` answers rc 1 both for a gone process and for a live one whose stat cannot be read. | `ccd/ccd#_pane_scope_of`, `#_pane_scope_stop`, `#_ci_proc_start`, `#_ci_hold_live`, `#_pane_scope_detach`, `#_pane_scope_sleep` | Reused, not copied; hibernate's read is reused, not repeated; the identity check is written out. |
| After `cmd_stop` and `ws-archive`, only the operator respawns the session. A stop ends a hibernation into "an ordinary stopped row, which mail never wakes"; `ccd start`/`enable` respawn it. An archive's spawn is `ws-restore`. A hibernated session is woken by ccrc's own acts: mail, an open screen, `ccd ensure`, or a roll's wake in the same verb. | `ccd/ccd#cmd_stop` (the `.hibernated` removal), `#cmd_hibernate`'s header, `#cmd_ws_restore` | Why call D's three sites are the ones ccrc resumes itself. |
| The stall mails name `stopAt` as the time of the counted tasks: "At your last turn end before it (`<stopAt>`), N background task(s) were running". A `failed` line sets `stopAt` to the StopFailure's time and carries `bg` from the earlier Stop. | `server/src/coord/stall.ts#stallOrphanDMail`, `#stallRestartedMail`; `ccd/session-hook.sh` `TURN_MARK_PROGRAM` | Task 1's limit, named and carried. |
| The census pins each stop's lines: in `cmd_swap` and `_watchdog_resume_run`, the unit stop is followed at once by the kill. | `server/test/ccd-operator-choice.test.ts`, "every stop in ccd is classified" | Task 2 moves its offsets. |
| A restart moves `bg*` into `lost*` only from a same-session `done` line. A `failed` line's tasks are dropped, and a test pins that. | `ccd/session-hook.sh` `TURN_MARK_PROGRAM`; `server/test/session-hook-turnmark.test.ts` | Task 1. |
| Orphan D and the D5 restarted arm need `lostBg > 0`. | `server/src/coord/stall.ts#stallOrphanDCandidate` | Why Task 1 matters. |
| Every ccd function has a context row, and every cross-context call is a line in a manifest. | `ccd/contexts.tsv`, `ccd/contexts-edges.tsv`, `server/test/ccd-contexts.test.ts` | Task 2's rows. |
| `ccd/ccd` may grow by 40 net code lines before a waiver is needed. | `server/test/growthCheck.ts#GROWTH_LIMIT`, `server/test/growth-waivers/` | Task 2's gate. |

## The operator's choices (approving this plan rules them)

**6a, written in full below.**
- The graceful stop in shadow at the three sites.
- `graceful-stop-live`: hand-only, with no writer in the tree.
- `lostBg` across a `failed` marker.
- The spec corrections that wave 5 carried.
- The `--stage 3` reading.

**6b and 6c are planned later, but their design calls are fixed now**, so the operator rules once. Task 4 writes each
into §5.3 under its number.
- **6b** (planned after 6a lands): the launch record and the manifest, written in shadow, with nothing reading them.
- **6c** (planned after 6b's shadow week): delivery. That is the composed redrive prompt, the session-start subject,
  the server's read of the manifest and the not-stalled wake, armed by the operator.

The design calls:

- **A. The resume call is read, then passed inline** (D-8323).
  - The composed prompt names the script's current-root path, and tells the session to read the file and pass its
    text inline: `Workflow({script: <the file's text>, resumeFromRunId: "<id>"})`.
  - That form (row R5) was accepted after a swap on 2.1.314. Two forms were refused: the old root's returned path
    (R2), and the current-root path (R1), which is the carry's hard link.
  - ccd writes no file into the workspace. The manifest holds ids and paths only.
  - Open, and measured in 6c's shadow: whether a Read of the current root (not only `cat`) works on every lane.
  - The ledger's carried proposal to pin the Workflow resume strings this relies on goes to 6c with the prompt that
    relies on them: 6c pins in a test the R1/R2 refusal text (`scriptPath must be a script path this tool returned
    …`), `No journal found for workflow run …`, and the accepted R5 shape, so a Claude Code update that changes them
    fails a suite rather than the fleet. 6a builds nothing that reads them ("Later").
- **B. The launch record is ccd's own `$REG/<id>.deleg`, as the spec says** (D-8324). It is
  not the closed delegation broker's spool, which is legitimately different under the consolidation rule:
  - **retention:** until the manifest retires the item. The spool keeps about 24 h (`($s - 86400)` in `DSP_DEFS`),
    while #2603's waits to a weekly reset last days;
  - **consumer:** ccd on the box at stop time, not the server's ingest;
  - **drop rule:** subagent rows are dropped, where the spool keeps them.

  There is still one parser: the hook's existing delegation-spool jq parse gains a second sink. It adds
  `resumeFromRunId` and `SendMessage` rows. The spool's ownerless CI red stays outside this programme.

  This settles, and reverses, the ledger's carried proposal ("Wave 6 (stage 3): this coordinator's proposals", first
  bullet) to extend the broker's spool and server projection rather than add a second writer: it is settled the
  spec's way, and the spool is not extended.
- **C. The wake keys on the manifest** (D-8325).
  - The not-stalled wake keys on a non-empty manifest, not on `lostBg` alone, so limit-ended sessions are covered.
  - The server reads `$REG/<id>.inflight` through a new FleetIO read. The stall watch mails the session its composed
    list once, as soon as its live status reads idle after the restart. This is D5's immediate rung, extended to every
    session class.
  - It is armed by stage 3's own switch, not by the optional wave-2 markers. Nothing types at spawn.
  - This amends spec §4 and §12 (C15; COORDINATOR note 3).
- **D. The graceful stop is at every site** (D-8326). The sites are `cmd_swap`,
  `_watchdog_resume_run` and `cmd_hibernate`, delivered in shadow by 6a: the stops after which ccrc itself starts the
  next spawn (the swap and the limit-resume in the same verb, a hibernate by mail, an open screen, `ccd ensure` or a
  roll's wake). `cmd_stop` and `ws-archive` are stops a spawn follows too, and every spawn composes a resume prompt
  (`ccd/ccd#_resume_env`, `#_resume_prompt_for`), but their next spawn is only ever the operator's: a stopped row is
  one "which mail never wakes", respawned by `ccd start`/`enable`, and an archive by `ws-restore`. They are left out
  of 6a, and that narrows spec §5.3's "Every ccd stop that will be followed by a resume" to the stops ccrc resumes
  itself (D-8327).
- **E. No step needs the operator in a session's pane** (D-8328). No live step needs the
  operator's go-ahead typed in a session's pane (D-8260). 6a and 6b are shadow measurements on the real fleet, and 6c's
  arming is the operator's switch.
- **F. The stage-3 baseline is re-cut** (D-8329). §9's stage-3 baseline (11 of 30) comes from a
  window now past retention. It is re-cut from 6b's shadow week, which counts restarts with a non-empty manifest.
- **G. Waits to a weekly reset stay unbounded for now** (D-8330). #2603's
  automatic wait and the operator's limit-wait are not bounded on a weekly-only lane in stage 3. 6b's manifest counts
  such waits (`deferred-until-reset` with a reset days out). The bound, if any, is wave 7's to propose from that count.
  The ledger asked which of stage 4's reset-based rules can still fire on such a lane, read from the code at
  `520b11c0d`:
  - **Cannot fire.** Each of these is gated on `HARD_BLOCK_TYPE == five_hour` (`ccd/ccd#_rescue_policy`), or needs a
    numeric recorded reset that `ccd/ccd#_rescuewait_open` writes only for `five_hour`:
    - the near wait;
    - the end in place at the reset, and its grace;
    - the hold until `RESCUE_CHAIN_WAIT` past the reset;
    - the no-room wait's `stale` end;
    - the chain wait's early end at its reset.
  - **Can still fire:**
    - the carried-in rule (D-3526);
    - the no-room wait, recorded with `reset=-`;
    - the chain wait, which then always runs its full 30 minutes;
    - do-not-bounce, which then lasts its whole window;
    - spread;
    - the limit watchdog's forced rescue and its automatic wait (D-8173 ruling (a)), and the operator's limit-wait,
      both of which run to the weekly reset;
    - `_watchdog_resume_here`, which restarts the session once that reset has passed.
  - Unmeasured: which `rateLimitType` a plan with no five-hour window writes on its block (wave 5's Task 4 did not run).
- **H. A session with no Claude Code transcript is `not-applicable`** (D-8331). It answers
  `not-applicable` in the manifest, the prompt and the session-start subject (spec §6). That answer is distinct from
  `never-written`, `none` and `unmeasured`. **As ruled, the call named exec kind `codex` as that lane; on main that is
  false (COORDINATOR note 8)**: a codex lane execs Claude Code in place and writes its transcripts. So the plan keys
  `not-applicable` on a measured fact, never on the exec kind: the session's config root holds no Claude Code
  transcript for its uuid (6b's manifest measures it). The coordinator confirms or restates this before approval.
- **I. The carry lock is shared with the dedupe** (D-8332). The manifest takes
  `$REG/.carry.lock` non-blocking, as the carry does. The daily carry-dedupe timer (#317, a dry run) holds it too:
  `ccd/lib/carry-dedupe.py` takes it with `flock(LOCK_EX | LOCK_NB)`. So a manifest written in that window is
  `unmeasured`, and §9 counts it. #317 is not changed.

## What this does not claim

- **No launch record, manifest, composed prompt, session-start subject or new wake.** Those are 6b and 6c.
  `_resume_prompt_for`, `_redrive_after_spawn` and the stall watch's arms and timings do not change.
- **The graceful stop is not armed.** `graceful-stop-live` has no writer in the tree, and nothing in this wave creates
  it on any box. `GRACEFUL_STOP_TERM_WAIT_S` (10 s) is provisional. Arming it, and the bound it keeps, are the
  operator's, after the `--stage 3` reading.
- **The two arms do not measure the same quantity.**
  - The shadow's time runs from the kill's return to the process's exit, after the hang-up, with the terminal
    already gone. It is an upper bound: the true exit may be earlier by up to the detach's latency plus one poll
    (100 ms).
  - The live arm's time runs from SIGTERM to exit, with the terminal still open.
- **Not every stop is graceful.** `cmd_stop` and `ws-archive` get no graceful stop. A spawn does follow them, with a
  composed resume prompt like any other, but only the operator starts it (`ccd start`/`enable`, `ws-restore`; mail
  never wakes a stopped row), so they are not stops ccrc resumes itself (call D,
  D-8327). A supervisor revival has no ccd stop to make graceful.
- **A shadow stop is not today's stop byte for byte** (COORDINATOR note 7). The acts and their order are today's, but
  at swap and limit-resume the pane read costs up to `SUBSTRATE_PROBE_DEADLINE_S` (8 s) before the kill when tmux is
  wedged, and at every site one synchronous `systemd-run` starts the observer after the kill (under hibernate's
  serialiser there). Hibernate pays no new pane read: it reuses D-7902's.
- **The live arm costs time while it waits:**
  - its wait holds hibernate's coordination serialiser, for at most 10 s (D-7541);
  - it lengthens a swap's window between the stop and the registry flip by the same amount.

  Neither applies while the marker is absent.
- **Shadow stops cost one transient unit each** (`_svc_run_detached`). In a mass rescue, that is one short-lived bash
  per stop for at most 30 s.
- **Exec kinds are not told apart, and the bound read in 6a includes every pane at the three sites.** ccd has no
  exec-kind reader, so the `graceful-stop` line carries none and `--stage 3` cannot split by it. A codex-kind pane is
  Claude Code itself (COORDINATOR note 8), so its exit time is Claude Code's. An `external` lane's launcher is the
  operator's, not ccrc's, and its pane may run another program, whose exits then enter the same percentiles. The
  operator reads the bound knowing that; splitting by kind is 6b's or 6c's, with call H.
- **A `no-pid` is not split by why tmux answered nothing.** `_pane_scope_of` (D-7902's reader, not changed here) reads
  every tmux failure but its timeout's rc 124 as "no pane", and tmux answers both a missing session and other
  refusals with rc 1, so `no-pid` covers both.
- **`lostBg` across a failed marker** counts what COORDINATOR note 5 says it counts. Three things are left as they are:
  - a mid-turn restart (`working`) still adds nothing;
  - `_swap_bg_hold` still does not hold on `failed`;
  - whether Claude Code 2.1.31x fires StopFailure on a usage-limit block stays unmeasured, as the critic noted.
- **New mail reaches sessions, and one of its sentences is inaccurate for a failed-sourced count.** Wherever the
  wave-2 arms are armed (`stall-watch-w2-live`, or the Settings level `all`), a restart after a failed turn with a
  carried `bg > 0` now draws Orphan D's mail to the session and the D5 `restarted` rungs (the run worker's re-check
  notice and its coordinator's heads-up). Those bodies say "At your last turn end before it (`<stopAt>`), N
  background task(s) were running". After a `failed` line, `stopAt` is the StopFailure's time while N, the kinds and
  the ids are the earlier Stop's, so tasks that finished during the failed turn are reported as lost at the wrong
  time. The marker cannot tell the two provenances apart afterwards (`done` and `working` carry `err` forward too).
  6a does not change the mail text or add a provenance field; the rewording is owed to the wave that next edits the
  stall mail text, 6c ("Later").
- **The Workflow resume strings are not pinned here.** The ledger's carried proposal goes to 6c (call A), because 6a
  builds nothing that relies on them.
- **The comment owed to review 729 stays carried.** Its correction, above `_redrive_after_spawn`'s call in
  `_spawn_settle`, waits for the next edit to that region, which is 6c's.
- **SendMessage after a restart** is unmeasured. So is the fact that a resumed agent comes back under a new agent id.
  6b's retire rule and 6c's shadow own both.

## Global Constraints

- **Public repository.** Fixtures and text use `lane-a-project-a`, `project-a`, `the fleet box`. Private-name scan
  before every push.
- **Fixture HOMEs only** (`makeCcdHarness`).
  - A test signals only a process the test itself started, and the stub tmux answers only those pids.
  - Never run `ccd` against the live HOME.
  - Never create `graceful-stop-live` outside a fixture HOME.
- **No restamp** (COORDINATOR note 1). `grep -c '^# ccrc:generated' ccd/ccd` prints 0 before and after. The hook's
  generated region is not edited.
- **Edits are line-neutral where they can be.** `ccd/session-hook.sh`'s edits are in place and line-neutral. Added
  lines carry no numeric line citation (`citations.test.ts`'s ratchet). Code is cited as `file#symbol` or
  `file#@anchor`.
- **Every new `ccd/ccd` function:**
  - has one `ccd/contexts.tsv` row (C2, in definition order);
  - has every new cross-context call as one sorted line in `ccd/contexts-edges.tsv`, with its reason in the PR;
  - never `die`s, so `ccd-die-containment.test.ts`'s fatal set is unchanged, and answers rc 0, except the predicate
    `_graceful_stop_same`, whose rc (0, 1, 2) is its answer;
  - adds no `_reg_get` call.
- **Growth.** After `git fetch origin main`, run `growth-check` with `GROWTH_CHECK=1`. Report `ccd/ccd`'s net delta.
  Over 40, add the waiver named in Task 2.
- **Tests.**
  - Each runs from `server/` as `"$HOME/.local/bin/ccrc" test -- ./node_modules/.bin/vitest run --maxWorkers=2
    test/<file>.test.ts`, in the foreground, with a timeout of at least 600000 ms, and one at a time.
  - `typecheck-tests` runs alone.
  - Run `npm ci` in `server/` first.
- **Mutations.**
  - Each new guard ships with a row, measured red when mutated and green when restored.
  - Rows run sequentially, bounded by `timeout -k` and a measured `ulimit -u`.
  - Restore from a saved copy with its sha256 checked, never `git checkout`.
  - Logs go under `.superpowers/sdd/`.
- **Files this wave does not edit:**
  - `CLAUDE.md`;
  - the ledger (`docs/superpowers/programs/session-continuity.md`), which is the coordinator's;
  - the delegation spool;
  - `server/src`.
- **Words.**
  - Write "launch record" and "manifest".
  - Avoid the broker's `stale`, `adopt` and `delegation`, and the wave-done's `handoffCommit`, or say which is meant.
  - The manifest class `abandoned` is named as that class, never as the run abandon door.
- **Commits** go on the workspace's own branch. No rebase, force-push or update-branch.
- **Deviation numbers** are the coordinator's. A departure found during execution is named by slug in the wave-done.

## Review Focus

1. **A shadow stop changes nothing a session sees.** No signal is sent. The acts are the same, in the same order, and
   the pause after the kill is not shortened; what it adds is COORDINATOR note 7's read and `systemd-run`. Hibernate
   does not wait for the observer, and it reuses D-7902's pane read, so `_pane_scope_stop` acts on the same read as
   on main. Pinned by Task 2's `shadow: no marker sends no signal`, `shadow: the observer is detached; the stop does
   not wait for it`, `hibernate: the graceful stop reuses D-7902's read, and the scope stop is unchanged`,
   `ccd-swap.test.ts`'s updated call list and `ccd-stop-pane-scope.test.ts`'s reworded swap pin.
2. **Nothing is signalled but the pane's own process,** proved by its start time at the moment of the signal. A
   recycled or vanished pid, or one with no readable start time, gets nothing, and each says which it was. Task 2:
   `live: a recycled or vanished pid is never signalled`, `live: a start time unreadable at the signal sends nothing`,
   `no start time: unmeasured=no-start-time, and live sends nothing`.
3. **A live stop always ends in today's kill, within its bound.** A process that ignores SIGTERM is waited
   `GRACEFUL_STOP_TERM_WAIT_S` and then hung up. Task 2: `live: a process that ignores SIGTERM is waited
   GRACEFUL_STOP_TERM_WAIT_S, then killed as today`.
4. **A failed turn's tasks move into `lost*` once.**
   - A second restart adds nothing.
   - An unmeasured `bg -1` adds 0.
   - A `working` line still adds none.

   Task 1's four cases, and its round trip to `stallOrphanDCandidate`. This is the wave's one change a session sees:
   behind the wave-2 arming, such a restart now draws Orphan D's and the `restarted` arm's mail, whose "at your last
   turn end (`<stopAt>`)" sentence names the StopFailure's time for a count taken at the earlier Stop (named, owed to
   6c).
5. **The instrument reports only what it can read.** A malformed `graceful-stop` line is counted apart. A censored
   stop (`alive=`) never enters the exit percentiles, and neither does a watch whose start time became unreadable
   (`unmeasured=stat-unreadable`). Task 3: `a malformed line is counted apart`, `alive is censored, never an exit
   time`.

**Task order:** 1, 2, 3, 4, 5. Task 3's real-writer case needs Task 2's `_graceful_stop_note`. Task 4 cites Task 2's
and Task 3's symbols.

---

### Task 1: A restart after a failed turn records the background work it ended

**Files:**
- Modify: `ccd/session-hook.sh`: in `TURN_MARK_PROGRAM`'s `restart` branch, the condition
  `$same and $p.state == "done"` becomes `$same and ($p.state == "done" or $p.state == "failed")`. The comment line
  above the program that begins `# restart: a same-session done moves bg* into lost*` names `done or failed`. Both
  edits are in place, so net 0 lines.
- Modify (test): `server/test/session-hook-turnmark.test.ts`. Besides the cases below, the header comment of
  `describe('the turn marker across a restart (§5.1, SessionStart)')` ("so a same-session `done` moves
  bg/bgKinds/bgIds into lost*") names `done` or `failed`, in place, with the hook's comment.
- Modify (doc): `docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md` §5.1, the SessionStart bullet. Add one
  dated sentence: "(Amended 2026-11-11, session-continuity wave 6a, D-8316: a same-session `failed`
  line's `bg*` moves into `lost*` too.)"

**Interfaces:**
- Produces: a restart line after a same-session `failed` line carries `lostBg = prev.lostBg + max(prev.bg, 0)`.
  `lostKinds` and `lostIds` take the union exactly as after `done`. `state`, `err`, `turnAt` and `stopAt` are as today.
  Server code is unchanged, but what it sends is not: `stallOrphanDCandidate` now answers true for such a line when
  `lostBg > 0`, and it gates both `stallOrphanDInner` (Orphan D's mail to the session) and `stallRestartedRungs` (the
  D5 re-check mail to a run worker and its coordinator's heads-up). So, wherever the wave-2 arms are armed
  (`stall-watch-w2-live`, or `server/src/coord/stallsettings.ts#STALL_LADDER`'s `all`), those mails now fire after a
  failed turn's restart, and their "At your last turn end before it (`<stopAt>`)" sentence names the StopFailure's
  time for a count taken at the earlier Stop ("What this does not claim").

- [ ] **Step 1: Rewrite the pinned case and add three more.** In `describe('the turn marker across a restart (§5.1,
  SessionStart)')`, replace `'a resume after a failed line flips it to done, keeps err, turnAt and stopAt, and moves no
  tasks into lost*'` with:

```ts
it.each(['rate_limit', 'server_error'])('a resume after a failed line (%s) moves its tasks into lost*, keeping err, turnAt and stopAt (lost-bg-across-failed)', (error) => {
  stopWith(THREE);
  run({ hook_event_name: 'UserPromptSubmit' });
  run({ hook_event_name: 'StopFailure', error });
  const failed = turnMark();
  expect(failed).toMatchObject({ state: 'failed', err: error, bg: 3, bgKinds: 'shell,subagent', bgIds: 'b1,b2,b3' });
  run({ hook_event_name: 'SessionStart', source: 'resume' });
  const m = turnMark();
  expect(m).toEqual({ ...failed, state: 'done', event: 'SessionStart', at: m.at, restartAt: m.at, bg: 0, bgKinds: '',
    bgIds: '', lostBg: 3, lostKinds: 'shell,subagent', lostIds: 'b1,b2,b3' });
});
it('a SECOND resume after a failed line keeps lost* and adds nothing', () => {
  // the same three events, then two resumes: lostBg 3, lostKinds 'shell,subagent', lostIds 'b1,b2,b3', bg 0
});
it('a failed line whose bg is -1 (unmeasured) adds 0 to lostBg, never subtracts', () => {
  // plantTurn a failed line: bg -1, lostBg 2, lostKinds 'shell', lostIds 'b1'; resume -> lostBg 2, kinds and ids kept
});
```

  In `describe('the turn marker round trip …')`, add (importing `stallOrphanDCandidate` from `../src/coord/stall.js`):

```ts
it('a hook-written restart after a rate_limit StopFailure is orphan D\'s candidate; with no tasks it is not', async () => {
  // Stop with two tasks, UserPromptSubmit, StopFailure {error:'rate_limit'}, SessionStart resume -> readBack():
  // r.ok true, r.lostBg 2, stallOrphanDCandidate(r) true.
  // CONTROL, on a fresh marker: Stop with [] instead -> r.lostBg 0, stallOrphanDCandidate(r) false.
});
```

- [ ] **Step 2: Run, and confirm what fails.** Run `test/session-hook-turnmark.test.ts`. Expected: FAIL. Both
  `it.each` rows read `lostBg 0`, the second-resume case reads 0, and the round trip's candidate is false. The `-1`
  case passes at the base, and that is expected: it guards the edit's arithmetic.
- [ ] **Step 3: Make the two in-place edits** named under Files.
- [ ] **Step 4: Run** `session-hook-turnmark`, then every `test/session-hook*.test.ts` and every `test/stall-*.test.ts`,
  one file at a time: `for f in test/session-hook*.test.ts test/stall-*.test.ts; do "$HOME/.local/bin/ccrc" test --
  ./node_modules/.bin/vitest run --maxWorkers=2 "$f" || echo "RED $f"; done`. Expected: no `RED` line.
  `session-hook` is a known load flake, so re-run a red one alone before calling it a break.
- [ ] **Step 5: Measure the mutation rows.**

| Row | Mutation | Expected red |
|---|---|---|
| LB-FAILED | the condition back to `$p.state == "done"` | the `it.each` rows and the round trip |
| LB-WORKING | the condition widened to `$p.state != "clear"` | `'a resume after a working line keeps turnAt > stopAt and adds no lost'` |

- [ ] **Step 6: Commit.**

```bash
git add ccd/session-hook.sh server/test/session-hook-turnmark.test.ts docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md
git commit -m "fix(hook): a restart after a failed turn records the background work it ended (session-continuity 6a, D-8316)"
```

---

### Task 2: The graceful stop, in shadow, at the three stop-then-resume sites

**Files:**
- Modify: `ccd/ccd`:
  - the new block goes immediately after `_pane_scope_reap`'s closing brace, ABOVE the
    `# shellcheck disable=SC2128,SC2178  # scope is a local string here; …` line, which belongs to `_end_cause` and
    must stay directly above it (inserted between the two, the directive would cover the first new function and
    `_end_cause` would lose it, and `shellcheck-ratchet` reds on SC2128/SC2178 there);
  - three call sites change: `cmd_swap`, `_watchdog_resume_run` and `cmd_hibernate`.
- Modify: `ccd/contexts.tsv`, with five C2 rows after `_pane_scope_reap`'s. Modify: `ccd/contexts-edges.tsv`.
- Create (test): `server/test/ccd-graceful-stop.test.ts`
- Modify (test):
  - `server/test/ccd-operator-choice.test.ts`, the stop census's offsets;
  - `server/test/ccd-swap.test.ts`, `'stops the unit before killing the pane …'`'s call list;
  - `server/test/ccd-stop-pane-scope.test.ts`, `'the swap is not a stop: cmd_swap and the swap dispatch never reach
    the pane-scope stop'`, reworded to its real invariant (Step 4);
  - `server/test/single-definition/switches-history.test.ts`, with one APPENDED `describe`.
- Create, only if Step 7 measures a net delta over 40: `server/test/growth-waivers/<the D-number allocated for
  D-8320>-ccd-ccd.json`.

**Interfaces:**
- Consumes these existing functions:
  - `_pane_scope_of id`, which resets and sets `PANE_SCOPE_PID`, `PANE_SCOPE_CG`, `PANE_SCOPE_UNIT` and
    `PANE_SCOPE_WEDGED`, bounded by `SUBSTRATE_PROBE_DEADLINE_S`;
  - `_ci_proc_start pid`, which sets `_CI_PSTART` from `$_CI_PROC/<pid>/stat`, rc 1 when it cannot be read;
  - `_pane_scope_detach fn args…`, which runs a function in its own transient unit (the seam tests run inline);
  - `_pane_scope_sleep s`;
  - `_plat_epoch_ms`.
- Produces, in `ccd/ccd`:
  - `GRACEFUL_STOP_TERM_WAIT_S=10`: live only, how long the stop waits for Claude Code to exit after SIGTERM, before
    the kill. Chosen and provisional, after `PANE_SCOPE_EXIT_WAIT_S`'s 10 s.
  - `GRACEFUL_STOP_OBSERVE_S=30`: shadow only, how long the detached observer watches the process after the kill.
  - `GRACEFUL_STOP_POLL_S=0.1`.
  - `GRACEFUL_STOP_PID="" GRACEFUL_STOP_PSTART="" GRACEFUL_STOP_SITE="" GRACEFUL_STOP_MODE=""`: initialised at file
    scope, as `PANE_SCOPE_*` are, for `set -u`.
  - `_graceful_stop_note id site mode outcome`: the one writer of `graceful-stop` lines, appending
    `<%F %T> graceful-stop <id>: site=<site> mode=<mode> <outcome>` to swap.log. Always rc 0.
  - `_graceful_stop_same pid pstart`: the one identity check, asked at step 5's signal and by both poll loops, so
    that three answers stay three: rc 1 **gone** when `kill -0 pid` fails; else rc 2 **stat unreadable** when
    `_ci_proc_start pid` fails; else rc 1 **gone** when `_CI_PSTART` differs from `pstart` (the pid was recycled
    after the exit); else rc 0 **the same process**. Builtins only, as `_ci_proc_start` is. `_ci_hold_live` is not
    used, because it answers rc 1 for both "gone" and "alive but stat unreadable". A poll that reads **stat
    unreadable** notes `unmeasured=stat-unreadable` and stops polling; it never writes an `exited=` time for it.
  - `_graceful_stop_before id site [read]`. `site` is one of `swap`, `limit-resume`, `hibernate`. It runs before the
    pane kill. Always rc 0; it never dies.
    1. Reset the four `GRACEFUL_STOP_*` globals and set `SITE`. `MODE` is `live` iff
       `[[ -f "$REG/graceful-stop-live" ]]`, the marker's one reader, written on exactly that one line. Otherwise
       `MODE` is `shadow`.
    2. Take the pane. With a third argument `read` (hibernate's call), the caller has just run `_pane_scope_of`, and
       the function reads `PANE_SCOPE_PID` and `PANE_SCOPE_WEDGED` as they stand and does not call `_pane_scope_of`
       again, so the four `PANE_SCOPE_*` globals that `_pane_scope_stop` acts on after the kill are D-7902's own read,
       untouched. Without it (swap, limit-resume, where no pane-scope stop follows), it calls `_pane_scope_of`.
       - If the read was wedged, note `unmeasured=wedged` and return.
       - If there is no pid, note `no-pid` (no pane process at the read) and return.
    3. If `_ci_proc_start` fails, note `unmeasured=no-start-time` and return. Nothing is ever sent without a start
       time.
    4. In `shadow`, keep the pid and the start time for `_graceful_stop_after`, and return.
    5. In `live`, ask `_graceful_stop_same` once more, at the signal:
       - **gone**: note `gone-before-signal` and return with nothing sent;
       - **stat unreadable**: note `unmeasured=stat-unreadable` and return with nothing sent;
       - **the same process**: `kill -TERM` the pid, poll `_graceful_stop_same` every `GRACEFUL_STOP_POLL_S` for up
         to `GRACEFUL_STOP_TERM_WAIT_S`, and note `exited=<ms>` (ms from the signal),
         `alive=<GRACEFUL_STOP_TERM_WAIT_S*1000>` or `unmeasured=stat-unreadable`;
       - clear the pid, so `_graceful_stop_after` does nothing.
  - `_graceful_stop_after id`: runs after the pane kill. In `shadow`, with a pid kept, it takes `t0` from
    `_plat_epoch_ms`, then calls `_pane_scope_detach _graceful_stop_observe "$id" "$SITE" "$pid" "$pstart" "$t0"`. A
    failed detach notes `unmeasured=detach-failed`. It then clears the globals. It never waits. Always rc 0.
  - `_graceful_stop_observe id site pid pstart t0`: runs in its own unit. It polls `_graceful_stop_same` every
    `GRACEFUL_STOP_POLL_S` for up to `GRACEFUL_STOP_OBSERVE_S`, then notes `mode=shadow` with `exited=<now−t0>`,
    `alive=<GRACEFUL_STOP_OBSERVE_S*1000>` or `unmeasured=stat-unreadable`. Always rc 0.
- The outcome grammar is what Task 3 reads, exactly: `(exited|alive)=(0|[1-9][0-9]{0,8})`, `no-pid`,
  `gone-before-signal`, or `unmeasured=(wedged|no-start-time|stat-unreadable|detach-failed)`. Each word is one
  condition: `no-pid` is only "the pane read found no process", and `gone-before-signal` (live only) is only "the
  process the read found was gone or recycled at the signal".
- The call sites, one statement per line. Each `kill-session` line is the existing UNMARK line, unchanged:
  - `cmd_swap`: `_svc_stop …`, then `_graceful_stop_before "$id" swap`, then the kill, then
    `_graceful_stop_after "$id"`, then `sleep 1`.
  - `_watchdog_resume_run`: the same, with `limit-resume`.
  - `cmd_hibernate`: `_pane_scope_of "$id"` (D-7902, unchanged), then `_graceful_stop_before "$id" hibernate read`,
    then the kill, then `_graceful_stop_after "$id"`, then the roll's live check. `_pane_scope_stop "$id"` later
    acts on the one read, as on main.
- The `contexts-edges.tsv` lines this adds are expected to be exactly eight:
  - `_graceful_stop_before -> _ci_proc_start`
  - `_graceful_stop_same -> _ci_proc_start`
  - `_watchdog_resume_run -> _graceful_stop_after`
  - `_watchdog_resume_run -> _graceful_stop_before`
  - `cmd_hibernate -> _graceful_stop_after`
  - `cmd_hibernate -> _graceful_stop_before`
  - `cmd_swap -> _graceful_stop_after`
  - `cmd_swap -> _graceful_stop_before`

  Add exactly what `ccd-contexts.test.ts` prints. The reason for the C2 to C3 edges: one start-time reader,
  `_ci_proc_start`, rather than a second parser of `/proc/<pid>/stat`.
- Legitimately different, recorded as D-8319: on a hibernate, the observer and
  `_pane_scope_reap` both wait on the same pid. The reap's wait is the precondition of an act, at 0.5 s for 10 s. The
  observer's is a measurement, at 0.1 s for 30 s, and runs at three sites the reap never runs at. Folding one into the
  other would change D-7902's timing.

- [ ] **Step 1: Write the failing tests.** The `ccd-graceful-stop.test.ts` fixture, Linux only
  (`describe.skipIf(process.platform !== 'linux')`):
  - The pane process is a real `bash -c` process started **inside each case's `h.sh` snippet, before the verb runs**
    (`bash -c '<traps…>; while :; do sleep 0.05; done' & echo $! > "$HOME/fx/pane-pid"`), never by the test file's
    Node process. It traps TERM and HUP, appends the signal's name to `<home>/fx/signals`, then runs the case's
    handler (default `exit 0`). Why: `h.sh` is `execFileSync`, so while the verb runs Node's event loop is blocked
    and a child Node started would stay a zombie after it exits; `kill -0` succeeds on a zombie and its
    `/proc/<pid>/stat` keeps its start time, so every exit would read `alive=` (measured by the review: `alive Z` for
    2 s from a Node child, `gone` within 0.1 s from a `&` job of the snippet's bash, which reaps its own job).
  - `tmux` is a shell function in each `h.sh` script. It logs to `ccd-calls`, answers `list-panes -t … -F
    #{pane_pid}` with the pid read from `$HOME/fx/pane-pid`, and on `kill-session` sends that pid SIGHUP, as the
    terminal's hang-up does.
  - `_svc_stop`, `cmd_ensure` and `_operator_choice_keep` log.
  - `_pane_scope_detach() { "$@"; }` runs the observer inline, except in the detach cases.
  - `GRACEFUL_STOP_OBSERVE_S` and `GRACEFUL_STOP_TERM_WAIT_S` are set per case (1 to 3 s).
  - Every pane process is killed in `afterEach`, from the pid recorded in `$HOME/fx/pane-pid` (a pane process that
    outlived its snippet's bash is an orphan the test still owns).
  - Helpers: `signals()` returns the file's lines, and `gs()` returns swap.log's `graceful-stop` lines with the
    timestamp cut.

  The cases:
  - `'shadow: no marker sends no signal; the pane process sees only the kill\'s hang-up'`. Run through
    `_watchdog_resume_run`. Expect:
    - `signals()` toEqual `['HUP']`;
    - in `ccd-calls`, `svc-stop` < `tmux list-panes -t` < `tmux kill-session` < `ensure`;
    - `gs()` toEqual `[expect.stringMatching(/^graceful-stop lane-a-project-a: site=limit-resume mode=shadow exited=\d+$/)]`.
  - `'shadow: a pane process that outlives the window is alive=<window>'`. The HUP handler is `:`, and
    `GRACEFUL_STOP_OBSERVE_S=1`. Expect `… mode=shadow alive=1000`.
  - `'shadow: the observer is detached; the stop does not wait for it'`. Use the real `_pane_scope_detach` against a
    recording `_svc_run_detached`. Expect:
    - one recorded command naming `'_graceful_stop_observe' 'lane-a-project-a' 'hibernate' '<pid>' '<pstart>' '<t0>'`;
    - `_graceful_stop_after` returned in under 1000 ms while the pane process (HUP ignored) still runs.
  - `'shadow: a failed detach is unmeasured=detach-failed'`.
  - `'live: graceful-stop-live sends SIGTERM before the kill and times the exit'`. The TERM handler is
    `sleep 0.3; exit 0`. Expect `signals()` toEqual `['TERM']` (the later hang-up finds no process), and one line
    `mode=live exited=N` with `300 <= N < 10000`.
  - `'live: a process that ignores SIGTERM is waited GRACEFUL_STOP_TERM_WAIT_S, then killed as today'`. The TERM
    handler is `:`, with `GRACEFUL_STOP_TERM_WAIT_S=1` and `GRACEFUL_STOP_OBSERVE_S=3`, so the two bounds differ.
    Expect `… mode=live alive=1000`, and `signals()` toEqual `['TERM', 'HUP']`.
  - `'live: a recycled or vanished pid is never signalled'`. The marker stands, and `_ci_proc_start` is wrapped so
    that its first call (step 3) answers the real start time and its second (step 5) answers a different one, as a
    recycled pid does. Expect `signals()` toEqual `[]`, `… mode=live gone-before-signal`, and `kill-session` still
    called.
  - `'live: a start time unreadable at the signal sends nothing'`. The marker stands; the wrapped `_ci_proc_start`
    answers on its first call and returns 1 on its second while the process runs. Expect `signals()` toEqual `[]`,
    `… mode=live unmeasured=stat-unreadable`, never `gone-before-signal` or `no-pid`.
  - `'shadow: a start time that becomes unreadable mid-watch is unmeasured, never an exit time'`. No marker; the
    wrapped `_ci_proc_start` answers on its first call and returns 1 from then on, and the HUP handler is `:` so the
    process runs. Expect `… mode=shadow unmeasured=stat-unreadable`, and no `exited=`.
  - `'no start time: unmeasured=no-start-time, and live sends nothing'`. `_CI_PROC` names an empty directory, and the
    marker stands. Expect `signals()` toEqual `[]`.
  - `'no pane: no-pid, and the stop goes on'`. tmux answers nothing.
  - `'a wedged pane read: unmeasured=wedged'`. Run with `_pane_scope_of() { PANE_SCOPE_PID=''; PANE_SCOPE_WEDGED=1; }`.
  - `'hibernate: the graceful stop reuses D-7902\'s read, and the scope stop is unchanged'`. Through `cmd_hibernate`,
    driven as `ccd-stop-pane-scope.test.ts` drives it, with `_pane_scope_of` replaced by a counting stub: its first
    call sets `PANE_SCOPE_PID` to the pane's pid, `PANE_SCOPE_CG` to `<root>/$PANE_SCOPE_SLICE/tmux-spawn-a.scope` and
    `PANE_SCOPE_UNIT` to `tmux-spawn-a.scope`, and any later call sets `PANE_SCOPE_PID=''` and `PANE_SCOPE_WEDGED=1`,
    as a wedge would. `_pane_scope_reap` and `_pane_scope_note` are recording stubs. Expect
    one `_pane_scope_of` call, `_pane_scope_reap` handed the first read's pid and cgroup, no `held: tmux did not
    answer` note, and `… site=hibernate mode=shadow exited=N`. (CONTROL in the same case: the same stubs with
    `_pane_scope_of` called twice by hand before `_pane_scope_stop` give the `held:` note, so the stub's wedge is
    real.)
  - `'graceful-stop-live is a regular file or nothing: a directory there reads as shadow'`. Expect `signals()` toEqual
    `['HUP']`, and `mode=shadow`.
  - `'the graceful stop sits at the three stop-then-resume sites, around the kill'`. A static census over
    `ccdSource()`:
    - the functions holding `_graceful_stop_before "$id"` are exactly `{cmd_swap: 'swap', _watchdog_resume_run:
      'limit-resume', cmd_hibernate: 'hibernate read'}` (the site word and, at hibernate only, `read`);
    - at `cmd_hibernate`, the code line before it is `_pane_scope_of "$id"`;
    - at each, the next code line is the UNMARK kill line, and the one after is `_graceful_stop_after "$id"`.
  - `'every stop a spawn follows is graceful or named'`. The operator-choice census's KEEPS
    (`cmd_stop`, `cmd_swap`, `cmd_ws_archive`, `cmd_hibernate`, `_watchdog_resume_run`) equal the three sites plus
    `{cmd_stop: 'a stopped row: only the operator respawns it (ccd start or enable), and mail never wakes it',
    cmd_ws_archive: 'an archive: only the operator\'s ws-restore respawns it'}`.

  `switches-history.test.ts`, APPENDED `describe('the graceful stop: its arming file has one reader and no writer in
  the tree (D-8318)')`, modelled on the carry-dedupe block:
  - `holdersOf('graceful-stop-live')` toEqual `['ccd/ccd']`;
  - its one code line is `[[ -f "$REG/graceful-stop-live" ]] && GRACEFUL_STOP_MODE=live`;
  - no TypeScript, and no other file under `ccd/` or `deploy/`, names it on a code line.

- [ ] **Step 2: Run them, and confirm what fails.** Every new case fails, because the functions do not exist. The
  census case fails, and so does the switches-history block (no holder).
- [ ] **Step 3: Implement** the constants, the five functions and the three call sites, as the Interfaces say. Then
  add the `contexts.tsv` rows and the `contexts-edges.tsv` lines.
- [ ] **Step 4: Move the existing pins.**
  - `ccd-operator-choice.test.ts`'s stop census:
    - for `cmd_swap` and `_watchdog_resume_run`, `src[i + 2]` becomes `^ {2}_graceful_stop_before "\$id" ` and
      UNMARK moves to `src[i + 3]`;
    - for `cmd_hibernate`, `next` takes five lines, with `_graceful_stop_before "$id" hibernate read` at `next[3]`
      and UNMARK at `next[4]`.
  - `ccd-stop-pane-scope.test.ts`'s `'the swap is not a stop: cmd_swap and the swap dispatch never reach the
    pane-scope stop'`. After Task 2, `cmd_swap` reaches `_pane_scope_of` through `_graceful_stop_before`; `type`
    prints only the two named bodies, so the pin would stay green while its name stopped being true. Reword it to its
    real invariant, `'the swap is not a stop: it never reaches the pane-scope stop or its reap, and reads the pane
    only through the graceful stop'`: keep `not.toContain('_pane_scope_stop')` and `not.toContain('_pane_scope_reap')`
    on `type cmd_swap; type _dispatch_swap; type _graceful_stop_before; type _graceful_stop_after; type
    _graceful_stop_observe`; keep `not.toContain('_pane_scope_of')` on `type cmd_swap; type _dispatch_swap` alone;
    and add `expect(h.sh('type cmd_swap')).toContain('_graceful_stop_before "$id" swap')`. The PR says why
    `_pane_scope_of` left the wide body's list.
  - `ccd-swap.test.ts`'s `'stops the unit before killing the pane …'` gains
    `'tmux list-panes -t =cc-claude-demo: -F #{pane_pid}'` right after `'systemctl --user stop
    claude-session@claude-demo'`. Its NO_PANE stub answers no pid, so nothing else is added.
  - Measure each test before you change it. Never widen a pin; add exactly the calls the graceful step makes.
- [ ] **Step 5: Run** the new file, `ccd-operator-choice`, `ccd-swap`, `ccd-limit-watchdog`, `ccd-limit-wait`,
  `ccd-stop-pane-scope`, `ccd-die-containment`, `ccd-contexts`, `ccd-limit-no-keys` and `ccd-reg-get-census`, each in
  its own process. Then run every other file the verbs reach, one at a time, from the list `grep -lE
  'cmd_swap|ccd swap|_watchdog_resume_run|cmd_hibernate|ccd hibernate' test/ccd-*.test.ts test/*hibernate*.test.ts
  test/*swap*.test.ts` prints. Expected: PASS. A failure that pins an exact call list or swap.log content is extended
  by exactly the graceful step's calls and lines, and reported.
- [ ] **Step 6: Measure the mutation rows.**

| Row | Mutation | Expected red |
|---|---|---|
| GS-SHADOW-NOSIG | the shadow branch also sends `kill -TERM` | `shadow: no marker sends no signal …` |
| GS-MARKER-FILE | the marker read `-f` becomes `-e` | `… a directory there reads as shadow` |
| GS-IDENTITY | `kill -TERM` without step 5's identity check | `live: a recycled or vanished pid is never signalled` |
| GS-GONE-WORD | step 5's **gone** notes `no-pid` | `live: a recycled or vanished pid …` (`gone-before-signal`) |
| GS-STAT-FOLD | `_graceful_stop_same` answers rc 1 when `_ci_proc_start` fails (stat unreadable reads as gone) | `shadow: a start time that becomes unreadable mid-watch …` (`exited=`) |
| GS-REREAD | `cmd_hibernate`'s call drops `read` (the graceful stop re-reads the pane) | `hibernate: the graceful stop reuses D-7902's read …` (two reads, the `held:` note) |
| GS-NO-PSTART | step 3 skipped (a pid with no start time is signalled) | `no start time: … live sends nothing` |
| GS-BOUND | the live wait reads `GRACEFUL_STOP_OBSERVE_S` | `live: a process that ignores SIGTERM …` (`alive=3000`, not `1000`) |
| GS-DETACH | `_graceful_stop_after` calls `_graceful_stop_observe` inline | `shadow: the observer is detached …` |
| GS-ORDER | `_graceful_stop_before` moved below the kill in `cmd_swap` | the three-sites census |
| GS-SITES | `cmd_hibernate`'s call removed | the three-sites census |
| GS-NO-WRITER | `touch "$REG/graceful-stop-live"` added to any ccd function | the switches-history block |

- [ ] **Step 7: Growth.** Run `git fetch origin main`, then `GROWTH_CHECK=1` with `test/growth-check.test.ts`. If
  `ccd/ccd`'s net delta is over 40, add the waiver file named under Files:
  `{file: 'ccd/ccd', maxDelta: <measured, rounded up to the next 5>, d: '<that D-number>', reason: 'the graceful stop
  in shadow (session-continuity 6a): five C2 functions beside the pane-scope stop and their six call lines', added:
  '<today>'}`. Report the delta either way.
- [ ] **Step 8: Commit.**

```bash
git add ccd/ccd ccd/contexts.tsv ccd/contexts-edges.tsv server/test/ccd-graceful-stop.test.ts server/test/ccd-operator-choice.test.ts server/test/ccd-swap.test.ts server/test/ccd-stop-pane-scope.test.ts server/test/single-definition/switches-history.test.ts
# plus server/test/growth-waivers/<n>-ccd-ccd.json if Step 7 added it
git commit -m "feat(ccd): the graceful stop in shadow at swap, limit-resume and hibernate; SIGTERM only behind graceful-stop-live (session-continuity 6a)"
```

---

### Task 3: `--stage 3` reads the stop's time, and README says what it is

**Files:**
- Modify: `deploy/measure-continuity.py`:
  - a `# ── stage 3 (wave 6a): the graceful stop's time ──` block with `S3_GSTOP` and `stage3(ctx)`;
  - `STAGES = {1: stage1, 3: stage3, 4: stage4, 6: stage6, 7: stage7}`.
- Create (test): `server/test/measure-continuity-stage3.test.ts`, in the shape of `measure-continuity-stage7.test.ts`.
- Modify: `README.md`, with one short paragraph after the stage-7 section: `### The stop's grace is measured before it
  is armed (session-continuity stage 3, wave 6a)`. It names:
  - the three sites;
  - the shadow default and the one line per stop;
  - `$REG/graceful-stop-live` (hand-only, SIGTERM first, a 10 s provisional wait);
  - that `--stage 3` reads the lines;
  - that a restart after a failed turn now records its background tasks as lost.

**Interfaces:**
- Consumes: Task 2's line grammar.
- Produces:
  - `S3_GSTOP = re.compile(TS + r" graceful-stop (\S+): site=(swap|limit-resume|hibernate) mode=(shadow|live) (?:(exited|alive)=(0|[1-9][0-9]{0,8})|(no-pid)|(gone-before-signal)|unmeasured=(wedged|no-start-time|stat-unreadable|detach-failed))")`,
    with no trailing `$`, used with `fullmatch` only, so the anchor is the call's.
  - `stage3(ctx) -> {"graceful_stop": {...}}`. With no swap.log, the section is `{"swap_log": "absent"}`. Otherwise,
    over lines in the window:
    - `stops` (well-formed lines);
    - `by_site_mode` (`"<site>/<mode>"` mapped to `{exited, alive, no_pid, gone_before_signal, unmeasured}`; `no_pid` and `gone_before_signal` are
      counted apart, never summed);
    - `exit_ms` (`"<site>/<mode>"` mapped to `{n, p50, p90, p99, max}`, over `exited` only, nearest rank);
    - `censored` (`"<site>/<mode>"` mapped to its `alive` count);
    - `unmeasured_by_why`;
    - `malformed_lines`: a line whose leading stamp is in the window, that holds ` graceful-stop `, and that the
      pattern does not fullmatch.
  - It reports and sets no target. The bound is the operator's.

- [ ] **Step 1: Write the failing tests.**

```ts
it('stage 3 reads the graceful-stop lines by site and mode (TZ=UTC, hand-built log)', () => {
  // in the window: swap/shadow exited=120, 340, 900 and alive=30000; limit-resume/live exited=2500;
  // hibernate/shadow no-pid and unmeasured=no-start-time; limit-resume/live gone-before-signal; one malformed `… site=swap mode=shadow exited=12ms`;
  // one well-formed line before --since.
  expect(r.stops).toBe(8);
  expect(r.by_site_mode).toEqual({
    'swap/shadow': { exited: 3, alive: 1, no_pid: 0, gone_before_signal: 0, unmeasured: 0 },
    'limit-resume/live': { exited: 1, alive: 0, no_pid: 0, gone_before_signal: 1, unmeasured: 0 },
    'hibernate/shadow': { exited: 0, alive: 0, no_pid: 1, gone_before_signal: 0, unmeasured: 1 } });
  expect(r.exit_ms).toEqual({ 'swap/shadow': { n: 3, p50: 340, p90: 900, p99: 900, max: 900 },
    'limit-resume/live': { n: 1, p50: 2500, p90: 2500, p99: 2500, max: 2500 } });
  expect(r.censored).toEqual({ 'swap/shadow': 1 });
  expect(r.unmeasured_by_why).toEqual({ 'no-start-time': 1 });
  expect(r.malformed_lines).toBe(1);
});
it('alive is censored, never an exit time', () => { /* only alive=30000 and unmeasured=stat-unreadable lines: exit_ms {},
  censored counts the alive ones, unmeasured_by_why { 'stat-unreadable': n } */ });
it('a line the real _graceful_stop_note wrote is read', () => {
  // h.sh('_graceful_stop_note lane-a-project-a swap shadow exited=42', { TZ: 'UTC' }); the tool on h.home, TZ=UTC:
  // exit_ms['swap/shadow'] equals { n: 1, p50: 42, p90: 42, p99: 42, max: 42 }
});
it('no swap.log: the section says absent', () => { /* { swap_log: 'absent' } */ });
```

- [ ] **Step 2: Run, and confirm what fails.** `argparse` refuses `--stage 3`.
- [ ] **Step 3: Implement** `stage3`, the registry entry, and the README paragraph.
- [ ] **Step 4: Run** this file, then `measure-continuity`, `measure-continuity-stage4`, `measure-continuity-stage6`,
  `measure-continuity-stage7`, `measure-continuity-pressure-kills`, `docs-parity`, `readme-holds` and
  `oss-metadata`, each alone. Expected: PASS.
- [ ] **Step 5: Measure the mutation rows.**

| Row | Mutation | Expected red |
|---|---|---|
| S3-GRAMMAR | `S3_GSTOP.match` (a prefix) instead of `fullmatch` | the hand-built case: `exited=12ms` reads as a stop, so `malformed_lines` is 0 |
| S3-GONE | `gone-before-signal` counted into `no_pid` | the hand-built case (`limit-resume/live` reads `no_pid: 1`) |
| S3-WINDOW | the window check dropped | the hand-built case (`stops` 9) |
| S3-CENSOR | `alive` values enter `exit_ms` | `alive is censored, never an exit time` |

- [ ] **Step 6: Commit.**

```bash
git add deploy/measure-continuity.py server/test/measure-continuity-stage3.test.ts README.md
git commit -m "feat(measure): --stage 3 reads the graceful stop's time by site and mode (session-continuity 6a)"
```

---

### Task 4: The spec, rev 12: wave 5's stale neighbours, and stage 3 in three waves

**Files:**
- Modify: `docs/superpowers/specs/2026-09-23-session-continuity-design.md`

**Interfaces:** none. This task is documentation. It cites Task 2's and Task 3's symbols by `file#symbol`, and the
design calls by their numbers below.

- [ ] **Step 1: The status line.** Append a rev-12 clause, dated 2026-11-11. It says rev 12:
  - corrects the stale neighbours that wave 5 and #2603 left (the §1 lead-in, §1.2 mechanism 2, §5.2, §5.3, §6, §8,
    §11 item 7);
  - records stage 3 as waves 6a to 6c, with the design calls for 6b and 6c;
  - amends §4 and §12 for the not-stalled wake (C15).

  Rev 11's own clause stays as written: it is history.
- [ ] **Step 2: §1.2 mechanism 2.** Add a "(History, dated: …)" note, in the shape of mechanism 1's. It says three
  things:
  - Since D-5237, the prompt is composed per spawn from the end's cause (`ccd/ccd#_resume_prompt_for`), and the typed
    fallback types that composed prompt.
  - Since 2026-10-22, a config-root script path passed after a swap was refused 17 of 17 times on disk. On 2.1.314,
    after one swap, R2 (the old root's returned path) and R1 (the current-root path, the carry's hard link) were both
    refused. A working-directory copy and the inline script resumed (§5.2, "As measured").
  - The five September refusals are past retention and remain unexplained.
- [ ] **Step 3: The lent account (D-8252).** Correct three places to say the lent account was a real one, not a
  scratch one:
  - §5.2's "Steps 5 and 6 run on the lent scratch account";
  - §11's lead-in, "when the operator offered a scratch account";
  - §11 item 7's heading.

  §5.2's "steps as first written" stay as written.
- [ ] **Step 4: §3, a row C15.** "AMENDS §4's 'never mails a resume list' and §12's 'server mail carrying resume lists':
  the stall watch mails a restarted session its composed list once (wake-keys-on-the-manifest)." It fixes stage 3's
  not-stalled restarts. Slug `wake-keys-on-the-manifest`, cited by its number.
- [ ] **Step 5: §4 and §12.** Make three dated corrections:
  - §4's ccd bullet: the typed fallback types D-5237's composed prompt, not a constant;
  - §4's server bullet: C15;
  - §12: drop "server mail carrying resume lists", and "typing anything but the fallback's constant" becomes
    "anything but the fallback's composed prompt".
- [ ] **Step 6: §6, §1's lead-in and §8.** Each gains a dated "(Amended 2026-11-11, rev 12: …)" note; the sentence it
  amends stays as written.
  - §6's "No revival" bullet: "superseded in part by the operator's Q4 ruling (a), built by #2603 (D-8123, D-8173).
    ccd restarts a no-room session in place after a stated reset (`ccd/ccd#_watchdog_resume_run`, cause
    `limit-resume`). The typed fallback types D-5237's composed prompt."
  - The same bullet's "The one new stop behaviour is a graceful signal before the existing kill": "in 6a the stop's
    default sends no signal; it adds a bounded pane read before the kill (at swap and limit-resume) and a detached
    observer unit after it, and SIGTERM before the kill only behind `graceful-stop-live`
    (D-8317)."
  - §6's "Per exec kind" bullet, whose "(the Codex lane)" is false on main: "a codex lane runs Claude Code itself
    (`ccd/ccrc-codex` execs the upstream Claude Code binary in place) and writes its transcripts; `not-applicable` is
    keyed on a session whose config root holds no Claude Code transcript for its uuid, not on the exec kind (call H,
    COORDINATOR note 8)."
  - §1's lead-in, "It adds no revival: the swap stays the one sanctioned restart": "since #2603, the limit watchdog's
    in-place restart after a stated reset (`ccd/ccd#_watchdog_resume_run`, cause `limit-resume`) is a second
    sanctioned restart (D-8123, D-8173 ruling (a))."
  - §8's "A stalled session idles on a reset account" bullet, "a stalled session's waits end in a swap, never in
    place": "since #2603, a session waiting on the rate-limit menu with no account to move to is restarted in place
    on its own account once its stated reset has passed and the account measures room (`ccd/ccd#_watchdog_resume_here`,
    then `_watchdog_resume_run`)."

- [ ] **Step 7: §5.3, rewritten.** It opens with "**Amended 2026-11-11 (rev 12): delivered in three waves.**", naming
  6a, 6b and 6c as in this plan's choices. Then:
  - **The graceful stop** (as built in 6a):
    - The three sites, and why `cmd_stop` and `ws-archive` are not among them (D): they are stops a spawn follows,
      but only the operator starts that spawn. The section's opening sentence, "Every ccd stop that will be followed by
      a resume", gains a dated note narrowing it to the stops ccrc resumes itself
      (D-8327).
    - The shadow: today's stop, timed after the kill by a detached observer.
    - The hang-up is the same shutdown (COORDINATOR note 2's reading, with the builds named).
    - `graceful-stop-live`: hand-only, SIGTERM to the proven pane process, a wait of up to
      `GRACEFUL_STOP_TERM_WAIT_S` (10 s, provisional), then today's kill.
    - The bound is set from `--stage 3`'s `graceful_stop` reading, and arming is the operator's (D-8104).
    - The unit is still stopped first.
  - **The launch record:** call B. The validation sentence stays. Add the drop rule's reason, and that a resumed agent
    comes back under a new agent id (wave 5 §2.5), which 6b's retire rule expects.
  - **The manifest.** Keep the class table, and name `abandoned` as this class, not the run abandon door. The
    writer-site sentence ("In the swap body, right after the carry …, and at a supervisor revival from the launch
    record alone") stays as written: no design call fixes the writer sites, so 6b's plan settles them, with a
    numbered deviation if it adds any. Add one dated sentence naming the open question it inherits: #2603's
    `_watchdog_resume_run` restarts with no carry and is neither of the two sites, and neither is a hibernate's stop.

    6b writes it in shadow. Calls I and H, and G's count, belong here.
  - **Delivery:**
    - call A replaces the literal;
    - "byte-identical to today's" means today's *composed* prompt;
    - the typed fallback types the composed prompt (as built since D-5237);
    - SendMessage is unmeasured and 6c measures it;
    - 6c pins the Workflow resume strings the prompt relies on (call A);
    - call H, keyed as COORDINATOR note 8 says.
  - **Not-stalled restarts.** The paragraph stays as written, its timings included (15 minutes of idle, within 24
    hours of the restart, the push 30 minutes after delivery); these are added beside it, dated:
    - a stall-watch Settings level arms these arms without any marker (review 1770 F1;
      `server/src/coord/stallsettings.ts#STALL_LADDER`). `all` arms the wave-2 arms as `stall-watch-w2-live` does.
      `alert`, `deliver` and `all` arm the operator push as `stall-watch-escalate` does;
    - since 6a, `lostBg` includes a `failed` line's tasks;
    - call C, from 6c;
    - wave 5's measured 15.5 minutes stays as the case it answers.
  - **Deferred.** The deferred-until-reset rule stays as written (the per-run resume-attempt count, and the prompt's
    "resume once; if agents stop on the limit again, stop and leave it listed"). Call G, with the list of stage-4
    rules from this plan's choices, is added beside it, dated.
  - **Background shells:** unchanged.
  - Close with a table, "Design calls for 6b and 6c": call | number | wave, for A to I.
- [ ] **Step 8: §9 and §10.**
  - §9: under the table, a dated note. The stage-3 baseline is re-cut from 6b's shadow week (F). The graceful stop's
    bound is read by `--stage 3`'s `graceful_stop` section; it sets the bound and is not a target.
  - §10: stage 3 ships as 6a, then 6b once 6a lands, then 6c after 6b's shadow week. Waves 7 to 9 still depend on wave
    6; which sub-wave each needs is settled when each is planned.
- [ ] **Step 9: Run** `anchors`, `citations`, `docs-parity`, `dtbd` and `topology-clean`, then `git fetch origin main`
  and `deviation-refs`, each alone. Expected: PASS.
- [ ] **Step 10: Commit.**

```bash
git add docs/superpowers/specs/2026-09-23-session-continuity-design.md
git commit -m "docs(continuity): spec rev 12: wave 5's stale neighbours, and stage 3 as waves 6a to 6c with the design calls for 6b and 6c"
```

---

### Task 5: The gate, the PR and the wave-done

- [ ] **Step 1: The stamp and the tree.** Check three things:
  - `grep -c '^# ccrc:generated' ccd/ccd` prints 0;
  - `hook-helpers-generated` passes;
  - `git diff origin/main -- CLAUDE.md docs/superpowers/programs/` is empty.
- [ ] **Step 2: The suites, each in its own foreground `ccrc test` process:**
  - every file the tasks named;
  - `single-definition/*`, `census-w5/*`, `ccd-contexts`, `ownership`, `shellcheck-ratchet`, `citations`, `anchors`,
    `docs-parity`, `topology-clean`, `private-names` and `dtbd`;
  - then `git fetch origin main` and `deviation-refs`;
  - `growth-check` with `GROWTH_CHECK=1`;
  - `typecheck-tests` alone.

  Re-run a known load flake alone before calling it a break.
- [ ] **Step 3: The mutation table.** Every row of Tasks 1 to 3 is measured red when mutated and green when restored
  from its saved copy.
- [ ] **Step 4: The private-name scan,** on every added line and commit message, before the push.
- [ ] **Step 5: The PR.** Push, and open one PR from the workspace's branch to `main`. Its body holds:
  - the durable GitHub links to this plan and the spec;
  - the deviation block;
  - the mutation table and the suites;
  - the eight context edges with their reason;
  - the growth delta.
- [ ] **Step 6: The wave-done.** Wait for the PR's fast run on the exact tip, read its selection, and run any selected
  server file your list missed. Then send one wave-done at that tip, with its `suite:` and `failure:` lines, the
  mutation table, the commits and the PR number.

---

## Deviations found

D-8316 to D-8332 were issued by the allocator to the coordinator on 2026-11-11. A departure found during
execution is named by slug in the wave-done.

- **D-8316 (2026-11-11)** — lost-bg-across-failed: a restart after a same-session `failed` turn
  marker moves its `bg*` into `lost*`, exactly as after a `done` one (Task 1). It used to drop them. So a session whose
  turn ended on a usage limit and was restarted by a swap or by #2603's limit-resume now records the lost tasks, and
  Orphan D and the restarted arm can see them.
  - So sessions, and run workers' coordinators, now get mail they never got before: Orphan D's mail to the session,
    and the D5 `restarted` re-check mail and coordinator heads-up, behind the same arming as before
    (`stall-watch-w2-live`, or the Settings level `all`). No server code changes.
  - The count is the one the `failed` line carries: the last Stop's, before the failed turn. Tasks launched during
    that turn are not in it, and tasks that finished after that Stop are.
  - The mails tie that count to the wrong time: "At your last turn end before it (`<stopAt>`)" names the
    StopFailure's time, which the `failed` line writes into `stopAt`, while the count is the earlier Stop's. The
    marker keeps no provenance for it. The rewording is owed to the wave that next edits the stall mail text (6c).
  - `_swap_bg_hold` still does not hold on `failed`.
  - A `working` line still adds nothing.
- **D-8317 (2026-11-11)** — graceful-stop-shadow: at each stop a resume follows, ccd reads the
  pane's process and its start time before the kill, and adds nothing to the kill.
  - A detached observer times the process's exit after the kill. It runs in its own unit, through
    `_pane_scope_detach`, and watches for up to 30 s at 0.1 s.
  - Each stop writes one `graceful-stop <id>: site= mode= <outcome>` line to swap.log.
  - The kill already hangs up Claude Code, whose SIGHUP and SIGTERM handlers are one `shutdown()` (builds 2.1.314 and
    2.1.322). So the shadow times that shutdown, with the terminal gone, and sends no new signal.
  - With the marker absent, the stop's acts and their order are today's, but it is not today's stop byte for byte, as
    ruling (i) worded it (COORDINATOR note 7): at swap and limit-resume one bounded tmux read before the kill (up to
    `SUBSTRATE_PROBE_DEADLINE_S`, 8 s, on a wedged tmux), and at every site one synchronous `systemd-run` after the
    kill, under the coordination serialiser at hibernate (D-7541), and one swap.log line.
  - At hibernate the graceful stop reuses D-7902's pane read (`_graceful_stop_before … read`), so
    `_pane_scope_stop` acts on the same read as on main; a second read could overwrite it.
  - Each outcome word is one condition: `no-pid` (the read found no process), `gone-before-signal` (live: gone or
    recycled at the signal), `unmeasured=stat-unreadable` (alive, but its start time could not be read, never an
    exit time).
- **D-8318 (2026-11-11)** — graceful-stop-live-marker: `$REG/graceful-stop-live`, read as a
  regular file on one line of `ccd/ccd` and written by nothing in the tree, arms SIGTERM before the kill.
  - The signal goes only to the pane's process, proved by its start time at the moment of the signal.
  - The stop waits up to `GRACEFUL_STOP_TERM_WAIT_S` (10 s, provisional), then kills as today.
  - It times the shutdown with its terminal open.
  - Its wait holds a plain hibernate's coordination serialiser for that long (D-7541).
- **D-8319 (2026-11-11)** — graceful-stop-observer-beside-the-reap: at a
  hibernate, the shadow's observer and D-7902's `_pane_scope_reap` both wait on the pane's pid. This is legitimately
  different under the consolidation rule:
  - the reap's wait is an act's precondition, at 0.5 s for 10 s, in the session slice only;
  - the observer's is a measurement, at 0.1 s for 30 s, at three sites, two of which the reap never reaches;
  - folding them together would change D-7902's timing.
- **D-8320 (2026-11-11)** — graceful-stop-ccd-growth: the waiver for `ccd/ccd`'s net growth
  over 40 code lines, for Task 2's five functions and six call lines, kept beside the pane-scope stop that they reuse.
  It is used only if Task 2 Step 7 measures over 40. Otherwise it is reported unused.
- **D-8321 (2026-11-11)** — stage3-graceful-stop-reading: `deploy/measure-continuity.py
  --stage 3` gains `graceful_stop`. It reports, by site and mode:
  - the exit-time percentiles over measured exits;
  - censored, `no-pid`, `gone-before-signal` and unmeasured stops apart;
  - malformed lines apart.

  It cannot split by exec kind: ccd has no exec-kind reader, so the line carries none, and an `external` lane's pane,
  which may not be Claude Code, enters the same percentiles.

  It sets no target. The bound and its arming are the operator's.
- **D-8322 (2026-11-11)** — spec-wave5-stale-neighbours: spec rev 12 corrects what wave 5
  made stale:
  - §1.2 mechanism 2 (the composed prompt, and the refusals after a swap since 2026-10-22);
  - the lent account was a real one (D-8252), in §5.2 and §11;
  - §5.3's Delivery literal (call A);
  - §5.3's arming sentence, which also names the stall watch's Settings level;
  - §6's no-revival wording after #2603, and its "one new stop behaviour" sentence after 6a's shadow;
  - §6's "(the Codex lane)", false on main (COORDINATOR note 8);
  - §1's lead-in ("the swap stays the one sanctioned restart") and §8's stalled-session bullet ("never in place"),
    both false since #2603's in-place restart;
  - §4's and §12's constant-prompt wording.
- **D-8323 (2026-11-11)** — resume-call-is-read-then-inline: as call A of this plan's
  choices. 6c's composed prompt names the script's current-root path and has the session read it and pass it as
  `Workflow({script: <the file's text>, resumeFromRunId: "<id>"})`, the form R5 measured accepted after a swap on
  2.1.314. R2 and R1 were refused. ccd writes no file into the workspace. Whether a Read of the current root works on
  every lane is measured in 6c's shadow. The ledger's carried proposal to pin the Workflow resume strings
  (`scriptPath must be a script path …`, `No journal found for workflow run …`) is taken by 6c, which pins them and
  R5's accepted shape in a test.
- **D-8324 (2026-11-11)** — launch-record-is-ccds-own: as call B. The launch record is
  `$REG/<id>.deleg`, written by the hook's existing delegation-spool parse through a second sink. It is not the closed
  broker's spool, and differs from it in retention, consumer and drop rule. It adds `resumeFromRunId` and `SendMessage`
  rows. The spool's ownerless CI red stays outside this programme. This settles the ledger's carried proposal (extend
  the broker's spool and server projection rather than add a second writer) the spec's way, reversing it: the spool
  is not extended.
- **D-8325 (2026-11-11)** — wake-keys-on-the-manifest: as call C.
  - 6c's not-stalled wake keys on a non-empty manifest.
  - The server reads `$REG/<id>.inflight` through a new FleetIO read.
  - The stall watch mails the session its composed list once, as soon as it reads idle after the restart, for every
    session class.
  - It is armed by stage 3's own switch. Nothing types at spawn.
  - It amends spec §4 and §12 (C15).
- **D-8326 (2026-11-11)** — graceful-stop-at-every-site: as call D. The graceful stop
  covers `cmd_swap`, `_watchdog_resume_run` and `cmd_hibernate`, delivered in shadow in 6a, and a census pins the three
  sites. `cmd_stop` and `ws-archive` are named as not graceful (D-8327).
- **D-8327 (2026-11-11)** — graceful-stop-not-at-operator-stops: spec §5.3's
  "Every ccd stop that will be followed by a resume sends `SIGTERM`" is narrowed to the stops ccrc resumes itself:
  the swap and the limit-resume (the spawn follows in the same verb) and the hibernate (woken by mail, an open screen,
  `ccd ensure` or a roll's wake). `cmd_stop` and `ws-archive` are stops a spawn follows too, with the same composed
  resume prompt, but only the operator starts it: a stopped row "which mail never wakes" is respawned by `ccd
  start`/`enable`, an archive by `ws-restore`. The operator-choice census's KEEPS lists all five, and the
  graceful-stop census names the two with that reason.
- **D-8328 (2026-11-11)** — no-operator-pane-step: as call E. No step of 6a, 6b or 6c needs the
  operator's go-ahead in a session's pane (D-8260). 6a and 6b are shadow measurements on the real fleet, and 6c's arming
  is the operator's switch.
- **D-8329 (2026-11-11)** — stage-3-baseline-recut: as call F. §9's stage-3 baseline is re-cut
  from 6b's shadow week, counting restarts with a non-empty manifest. The old window is past retention.
- **D-8330 (2026-11-11)** — weekly-reset-waits-unbounded-for-now: as call G.
  #2603's automatic wait and the operator's limit-wait stay unbounded on a weekly-only lane in stage 3, and 6b's
  manifest counts such waits. Any bound is wave 7's to propose. The stage-4 rules that can and cannot fire on such a lane
  are listed in call G.
- **D-8331 (2026-11-11)** — codex-not-applicable: as call H. A session with no Claude Code
  transcript answers `not-applicable` in the manifest, the prompt and the session-start subject, distinct from
  `never-written`, `none` and `unmeasured`. The call named exec kind `codex` as that lane, which is false on main: a
  codex lane execs Claude Code in place and writes its transcripts (COORDINATOR note 8). So the answer is keyed on the
  measured fact (no transcript for the session's uuid under its config root), never on the exec kind, and spec §6's
  "(the Codex lane)" is corrected. The coordinator confirms this re-key, or restates the call, before approval.
- **D-8332 (2026-11-11)** — carry-lock-shared-with-dedupe: as call I. The manifest takes
  `$REG/.carry.lock` non-blocking, as the carry does. The daily carry-dedupe timer (#317) holds it too, so a manifest
  written then is `unmeasured`, and §9 counts it. #317 is not changed.

## Where things stand

**Agreed:**
- the programme's stage 3 is manifest-primary (D-8102);
- the bound is measured behind a shadow arm before it is armed (D-8104);
- the coordinator's split into 6a, 6b and 6c, with its design calls A to I, is written into this plan.

**Waiting on you:**
- The plan's approval. That approval rules 6a as written, and calls A to I for 6b and 6c. Call C amends spec §4 and
  §12.
- COORDINATOR notes 7 and 8, which the coordinator ruled and the approval covers: the shadow narrows ruling (i)'s
  "byte for byte" to "the same acts in the same order", and call H is keyed on a measured transcript fact, not exec
  kind `codex`.
- After 6a deploys, whether to arm `graceful-stop-live`. Arming lets the live arm measure the shutdown with the
  terminal open. Until you choose, the shadow alone is read.

**Later:**
- 6b's plan, after 6a lands. 6c's plan, after 6b's shadow week. Both carry these open items:
  - which bound to arm, from `--stage 3`;
  - Read of the current root (call A);
  - SendMessage after a restart;
  - the manifest subject's ceiling against the session-start spill. About 1,549 characters remain under today's
    pinned sum (`server/test/session-hook.test.ts`), and §2's cite of the card ceiling is stale;
  - whether StopFailure carries `background_tasks`, which a `-hookcap` capture could answer;
  - the comment owed to review 729 in `_spawn_settle`;
  - 6b: the manifest's writer sites, including #2603's `_watchdog_resume_run` and the hibernate, which the spec's two
    sites do not cover;
  - 6c: pinning the Workflow resume strings in a test (the R1/R2 refusal text, `No journal found for workflow run …`,
    and R5's accepted shape), carried from the ledger;
  - 6c: rewording the Orphan D and `restarted` mails' "at your last turn end (`<stopAt>`)" sentence for a count
    carried across a `failed` line;
  - 6b or 6c: splitting the stop's bound by exec kind, with call H.
- Stage 4's no-room re-read (item 140), the coordinator's: #2603 reached the fleet box in v0.0.1124 on 2026-11-11, so
  it is read with the weekly reading due 2026-11-18. Item 146 (the loan's undo) is done (confirmed 2026-11-11).
