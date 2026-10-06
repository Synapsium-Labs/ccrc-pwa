# Worker stall watch — the server notices a silent session, delivers mail past background work, and escalates — design

**Status:** rev 3.1, APPROVED by the operator 2026-09-29 11:58 UTC (§11 records the rulings). Wave 1 is being planned. Amended by the operator 2026-10-04: §6.1's coordinator clause only (§11 decision 13).
- **Rev 3.1** applies the MekWarLive coordinator's read-back of S4 (mail 2526), checked against the worker's and the
  implementer's transcripts. §3.2 gains the measured self-resume contrast. §6.2's clause stops counting an agent whose
  completion says it may resume on its own as a wake; rev 3's text would have allowed S4's last turn-end. §2 prices the
  coordinator's proposed Stop-hook variant, and the S4 row gains what the silence left exposed. Nothing else changed,
  and these edits have not been re-reviewed.
- **Rev 3** applies a two-agent verification of rev 2 (`wf_16d73a3d-58d`: application and consistency, code truth of the
  new text): 33 findings (9 major), all applied; §12 gains the conflicts rev 2 settled silently.
- **Rev 2** applies a four-lens adversarial review (`wf_5461f658-6a0`: code truth, binding rules and safety,
  effectiveness, plan-readiness; each lens refuted by a second agent). It filed 96 findings: 60 confirmed, 33 partly
  confirmed, 3 refuted. Every surviving finding is applied here. Where two findings prescribed different fixes, §12
  records the choice.
- **Citations** were mapped read-only at `48af1426`; the `watch.ts` and `ccd/ccd` anchors were re-read at `af5a29f8`.
  Line numbers are hints; each citation names its function or constant, so the text can be found after `main` moves.
- **Measurements** come from two read-only workflows on the fleet box: `wf_d1aa4db3-c58` (forensics, fleet census,
  two mechanism maps, each refuter-checked) and `wf_a4d11fd0-513` (binary and transcript measurements, three competing
  designs, three lens judges). Every number below is from one of them, or is marked *chosen*.

**Date:** 2026-09-29 · **Branch:** `ws/stall-prevention-with-worker-stop-hook` (from `origin/main` `af5a29f8`)
**Related:**
- `2026-09-23-session-continuity-design.md`. Its §5 "Not-stalled restarts … nothing types" is amended by wave 3
  (§6.3). Its stage-3 launch record edits the same `session-hook.sh` surfaces as wave 2 (§10).
- `2026-09-24-workspace-lifecycle-design.md` §5.4, the dead-coordinator lane. This spec reports a dead coordinator to
  the operator but never acts on one, and it closes nothing.
- `2026-08-17-working-detection-defect-family-design.md` (D-75, D-76). This spec keeps D-76's refusal of `waiting`
  at the mail gate and corrects that spec's reading of `shell` (§3.1).
- `2026-09-23-landing-order-and-main-churn-design.md`. Its waves add coordinator and worker clauses too, so the clause
  numbers in §6 are "the next free" ones (§10).

## 1. The problem, measured

**The ask.** On 2026-09-28 the MekWarLive programme coordinator reported: "Stall prevention is still missing, and
it's the most urgent. The only stop hook on this machine is the fleet's session-state recorder; nothing checks that a
report mail went out. The worker has gone silent for days three times this wave. The fix is either a stop hook in the
worker's workspace that refuses to end a turn when no mail was sent that turn, or a ccrc watchdog that mails me when a
working session sits idle for hours."

**Run 67 (battlescape-operational wave 9/9, worker `MekWarLive-swift-harbor`) — four silences, all UTC.**

| # | Began | Ran | How it began | What prolonged it | What ended it |
|---|---|---|---|---|---|
| S1 | 09-16 20:00:04 | 71.4 h | turn ended mid-Task-3, pane summary, no mail | the coordinator was idle, then weekly-limit-locked; the worker's account later hit its monthly spend limit | operator typed "Resume" |
| S2 | 09-19 21:13:35 | 157.5 h | turn ended mid-fix-round ("then the mail carrying F9's SHA…"), no mail — one hour after the worker mailed "I am not ending a turn without one again" | nothing woke either side | operator asked the coordinator "where are we?" |
| S3 | 09-26 13:03:15 | 48.9 h | turn ended after a push, no mail | coordinator mails 2443/2445 gated `not-idle` for 2 days: an orphaned background wait loop (a `pgrep -f` self-match) held the live status at `shell`. Mail 2445's `gateCount` of 1,526 was read by both parties as "1,500 delivery attempts"; `gateCount` counts gate hits, and `attempts` was 0 | the memory-pressure reaper killed the loop; its task-notification woke the worker |
| S4 | 09-28 21:52:51 | 8.3 h | turn ended on "The implementer is still running: it's waiting on `typecheck`", no mail; a faithful reading of the implementer's completion note (§3.2) | the notice it waited for was queued under a finished subagent's id and never drained (§3.2); for 8.3 h the implementer's work sat in 7 uncommitted files, beside 5 local commits held unpushed by design (coordinator's count, mail 2526) | this spec's author mailed the coordinator by hand (mail 2524, 06:14) |

On 09-28, from 14:02 to about 19:40, five coordinator rulings (2448, 2450, 2458, 2463, 2464; one a D-number
correction) also sat `queued`, gate `not-idle` (gate counts 369, 340, 275, 105, 105), while the worker kept working:
its background subagents held the live status at `busy` between its own turns.

**Case D — the design session itself, 09-28.** This spec's own session ended a turn at 16:12:59 to wait for a
background design workflow. At 16:20:14 the kernel OOM killer hit its pane scope. The scope peaked at 4.3 G against its
own 12 G cap, so the trigger was the shared `app-claude-session.slice` (MemoryMax 24 G, `oom_kill` 79; six pane OOM
kills that day). `OOMPolicy=stop` took the pane down, and ccd respawned it with `--resume` at 16:20:29. The workflow's
agents ran inside the killed process. Claude Code wrote the loss as a task-notification with `shouldQuery:false`,
which starts no turn. ccd's redrive logged `redrive-skip … not-stalled` at the 20:13 and 22:51 swaps. Nothing watches
a session that is not a run worker, so it sat idle 13.8 h until the operator typed "Progress?". The same shape was live
on `ccrc-pwa-soft-basin` (idle 16.9 h after a 14:04 restart with two orphaned workflows).

**The fleet census** (143 runs dispatched 09-01..09-28: 74 work, 69 review; worker activity = assistant output and
tool results, deduplicated across carried transcript copies):

| Worker-activity gaps while a run was active | ≥1 h | ≥2 h | ≥4 h | ≥8 h | ≥24 h |
|---|---|---|---|---|---|
| gaps | 221 | 145 | 101 | 66 | 18 |
| hours | 2,149 | 2,047 | 1,918 | 1,724 | 1,063 |

Work runs hold 140 of the 145 gaps of 2 h or more. By cause:

| Cause | Gaps / hours | Stall or legit |
|---|---|---|
| waiting on the coordinator | 56 / 1,020 | 23 hand-offs and 15 declared-idle legit; 18 ambiguous, the heavy tail all MekWarLive and called stalls in that coordinator's own mail |
| usage limit or swap | 26 / 142 | 19 limit waits legit; 5 post-swap idle and 2 Fable-consent blocks are stalls |
| ended turn, other | 21 / 374 | all stalls |
| background task | 17 / 180 | 6 confirmed legit, 10 unconfirmed, 1 never returned |
| mail undelivered | 7 / 167 | stalls. The census classed 3 by a `registry-unmeasurable` `lastError`, but `lastError` is sticky: it keeps the last back-off's text after the gate changes. The two longest were gated `not-idle` behind an orphaned background shell, S3's shape: run 129's 2407 (83.5 h; gap 84.2 h; `lastGate` not-idle, `gateCount` 1,528) behind a subagent's `pgrep` wait loop, and run 82's 1778 (52.3 h) behind its CI watcher |
| ended turn waiting on CI | 6 / 101 | stalls |
| AskUserQuestion pending | 5 / 18 | legit |
| API error aborted the turn | 5 / 36 | stalls; Claude Code fires StopFailure, not Stop |
| session dead or killed | 1 / 4.7 | stall |
| frozen mid-turn | 1 / 4.6 | stall |

Strict stalls of 2 h or more ran a median 6.7 h (p90 45 h, max 84 h; the loose view reaches 161.7 h, run 31). They
ended by a mail nudge 21 times, an operator 9, a task-notification 7, run close 4, a restart 2, other 6 (attribution
approximate: a verifier found one "mail" ending that an operator prompt preceded).

"The 53 stalls" below means the 49 census-strict stalls of 2 h or more plus the 4 MekWarLive gaps its coordinator's
own mail calls stalls.

## 2. What was asked, and what this spec does instead

The coordinator offered two fixes. This spec builds the second, widened, and does not build the first.

**A blocking Stop hook is not built.** Replaying the census:
- "No mail this turn" fires on 79% of 3,478 worker turn-ends inside active runs. 2,199 of the 2,758 no-mail turn-ends
  had background work outstanding: workers orchestrate through subagents.
- The tightest census variant (no background task, no AskUserQuestion, not operator-opened, last mail not an outbound
  hand-off, no idle declaration) still fires about 17 times a day (458 in 27.6 days), 84% of them followed by activity
  within 30 minutes anyway. It catches 23 of the 36 strict stalls that begin at a clean turn-end. Its background-task
  exemption loses 9–17 census stalls.
- The design-grade gate built for this review (held turn-ends, exempting only waits on a main-launched Agent, Workflow,
  Monitor or cron) fires 36 times a day (992 in 27.6 days), 87% followed by activity within 30 minutes, and catches 25
  of the 36.
- After S4 the MekWarLive coordinator proposed a third variant (mail 2526): refuse a turn-end with no mail while a
  background agent or Monitor is registered, or while the tree is dirty. That condition is the complement of the
  tightest variant's exemption. 2,199 of the no-mail turn-ends had background work outstanding, about 80 a day before
  the dirty-tree term is added. It reaches the 9–17 stalls that exemption loses, plus whatever the dirty-tree term
  adds (unmeasured). In S4 it would have fired on all three of the worker's no-mail turn-ends in under four minutes
  (21:49:06, 21:50:24, 21:52:51). Each one ended on the implementer, and the worker was actively steering it in each.
  §5.2's E arm reaches S4's shape 10 minutes after the awaited task ends, and fires only then.
- Every variant misses all 13 strict stalls that begin mid-turn (post-swap idle, API-error aborts, the consent gate, a
  frozen tool), so none reaches more than 36 of the 49, and the two measured ones reach about half. None can see Case
  D (no turn runs, so no Stop fires) or undelivered mail.
- It has no backstop. It blocks once per turn (`stop_hook_active` is sticky per query), so a model that ends the turn
  again, or satisfies it with any mail, stalls unbounded. S2 began an hour after the worker promised compliance.
- Its remedy is a mail that wakes the coordinator, at a measured p50 of 2.9 M tokens per coordinator mail turn, so its
  cost scales with activity, not with stalls.
- It breaks `ccd/session-hook.sh`'s pinned contract: the THREE ENVELOPES header says SessionStart and PreToolUse are the
  only printing events, `session-hook.test.ts`'s "prints NOTHING on every other event" includes Stop, and the header
  says Stop "waits on nothing". The Stop path is cheap today (p99 309 ms since 09-17); its one 432 s outlier, on
  2026-08-15, fits the pane scope being reclaim-throttled (inferred; no PSI history survives), and anything
  synchronous added there inherits that.

**A server watch is built, and widened three ways.** The coordinator asked for "a watchdog that mails me when a
working session sits idle for hours". The measurements add three things it did not name:
1. **Delivery.** Two of the four silences, the live five-ruling pile-up, and the census's two longest "undelivered"
   stalls were mail that could not land. The gate is fixed first (§4.1, §5.1).
2. **Sessions, not only runs.** Case D had no run. A restart that finds in-flight work dead is an unsatisfiable wait
   on any session (§5.2).
3. **The worker first.** The first rung mails the stalled worker itself, which is how 21 of the census stalls ended;
   the coordinator is told one hour later, and the operator one hour after that (§4.2).

## 3. The mechanics this design rests on (binary-confirmed or measured)

### 3.1 Claude Code's live status

`<configDir>/sessions/<pid>.json`'s `status` is computed the same way in every installed version (seven, 2.1.277–2.1.284):
- `waiting` when a dialog or elicitation needs a human. A background subagent's permission prompt raises it too.
- else `busy` when the main query runs **or** any `local_agent`, `remote_agent`, `in_process_teammate` or
  `local_workflow` task is not terminal (`delegatedActive`);
- else `idle`, relabelled `shell` when any `local_bash` task runs. A shell Monitor is a `local_bash` task. Cron and
  ScheduleWakeup are not tasks.

So **`shell` only ever comes from an idle main loop.** `busy` is ambiguous: a turn in flight, or a main loop idling
over background agents. The file is rewritten only on a change, so `statusUpdatedAt` is the time of the last change,
not of the last turn end.

Four shipped docstrings state otherwise and are corrected in wave 1 (§6.3): `livestate.ts`'s ("a Bash tool command is
running"), `LiveStateRead`'s ("the mail gate requires an AFFIRMATIVE idle") and `readLiveState`'s caller census ("Its
four callers … both of `watch.ts`'s already-fail-shut gates": there are three, one of them in `watch.ts`), `sweepMail`'s
conjunct 5 ("the SOLE idle authority"), and D-2016's `turnStall` in `shared/api.ts`, which takes now −
`statusUpdatedAt` on a `busy` row as the current turn's age.

**Typed input is not held by background work.** The queue processor checks only the main query and open dialogs. In a
7-day census, 63 operator prompts typed directly and 67 through the queue while the main loop was idle over background
work all started a turn at once. Text typed while a turn runs is folded in at the next tool boundary as a
`queued_command` attachment (measured 06:11:11 → 06:11:16). Only 2 of 787 ccrc-mail nudges ever landed in the
"idle with background work" state, because the gate refuses it.

### 3.2 The queue, and notices that start nothing

Queue priorities are `now` 0, `next` 1, `later` 2. An idle main loop starts a turn from the first queued item addressed
to the main agent that is neither passive nor a poll event. Three kinds of item start nothing:
- `shouldQuery:false` items are written to the transcript with no model query. Every resume-time "didn't finish before
  the previous session ended" note is one (six call sites, identical in 2.1.277, 2.1.283 and 2.1.284). That is Case D.
- Passive items wait for the next turn.
- **Items addressed to a subagent's id** are taken only by that subagent's loop. A Monitor or background Bash armed by a
  subagent reports to that subagent; if the subagent has finished, nobody drains it. That is S4: the implementer's
  Monitor `b989ocn62` expired at 21:56:31, was queued under the implementer's id, and sat there. A 3-day census found
  58 such notices never drained; a 7-day one found 11 idle episodes of 10 minutes or more plus 3 still open (up to 122 h).

A background agent that stops while background work of its own still runs emits its completion with a note: it "may
resume on its own when that work completes or reports … the result below may be interim". In S4 that promise held once
and then failed:
- The implementer's Monitor `bdao1etsu` expired at 21:49:51. It was drained into the stopped implementer within a
  second and resumed it, and the implementer stopped again at 21:50:08.
- The worker resumed it with SendMessage at 21:50:21. It armed Monitor `b989ocn62` and stopped at 21:52:48 with the same
  note. That Monitor expired at 21:56:31 and was never drained.
The worker's last sentence ("still running: it's waiting on `typecheck`") was a faithful reading of that note, not a
stale belief. One contrast is not a mechanism: whether the SendMessage resume is what cost the self-resume is
unmeasured.

### 3.3 The hook file is shared with subagents

Hooks run in the parent process, and `session-hook.sh` picks the file by the pane's tmux session name. Every
subagent's and Workflow agent's PreToolUse/PostToolUse writes `working` and a fresh `updatedAt` into the parent's
`hookstate.json`, milliseconds after the main Stop wrote `done`. The payload carries `agent_id` in a subagent context;
the script never reads it. The file is a last-writer-wins read-modify-write with no lock, so its counters lose updates.
`subagents[]` did not shrink in the measured sample (swift-harbor lists 12 names back to August) although
`SubagentStop` has a remove-by-name arm; the cause is unmeasured.

### 3.4 No existing signal separates a stall from a wait

At +2 h into each of S1–S4 and Case D, every candidate signal read 1.9–2.7 h old, which is also what a legitimate wait
reads. Hook `updatedAt`, transcript mtime and `statusUpdatedAt` are restamped by plumbing inside a silence (respawn,
swap, ccd auto-compact, harness bookkeeping lines); only the worker's own mail and acks are immune, and they go stale
in every legitimate wait. So the watch keeps **its own episode, keyed on the worker's mail**, and classifies silence
by **whose turn it is on the run** (§4.2).

## 4. Wave 1 — server only

No hook, ccd, skill, route, migration or wire change. The fleet box is untouched.

### 4.1 The mail gate delivers on `shell`

**Where:** a new L1 module `server/src/turnidle.ts`. It declares its own structural input and imports no L3 type
(never `LiveState` from `livestate.ts`, which imports `FleetIO`):

`mailTurnIdle(live: {status: string; statusUpdatedAt: number | null}, mark, now, quietMs, mode)
 → {deliver: true, since} | {deliver: false, gate: 'not-idle' | 'not-quiet'}`

`mode: MailTurnMode = 'strict' | 'shell' | 'busy-shadow' | 'busy'` is enumerated once in `turnidle.ts`. `mark` is
wave 2's marker read and is `{ok:false, reason:'absent'}` in wave 1. It is called from `sweepMail`'s `not-idle` and
`not-quiet` gates in `server/src/watch.ts` (~3552–3564 at `af5a29f8`), which it replaces with one call.

- `idle`: today's rule, quiet measured from `statusUpdatedAt`.
- `shell`: deliverable unless the mode is `strict`; quiet from `statusUpdatedAt` (`MAIL_QUIET_MS` 60 s,
  `COORD_QUIET_MS` 15 s, unchanged).
- `busy`, `waiting`, `''` and any unknown word: `not-idle`, as today. `waiting` stays refused under every mode (D-76).
- `liveSessionStatus` (`livestate.ts` ~52) and its collapse pin are **not** changed: `assembleFleet` (the PWA),
  `liveStatus` (the interrupt route) and the per-session socket still read it. Its docstring is corrected on `shell`
  and on its consumer list, since the mail gate now reads `mailTurnIdle`.

**The mode** comes from one registry listing, the one `sweepMail` already takes: `mail-gate-strict` gives `strict` and
wins over the others; else `mail-gate-busy` gives `busy`; else `mail-gate-busy-shadow` gives `busy-shadow`; else
`shell`. The two `busy` markers do nothing until wave 2. An unlistable registry fails shut, as `mail-disabled` does.
Like §4.2's markers, these live in the fleet box's `~/.cc-sessions` and are touched and removed by hand there:
`ssh <fleet-host> 'touch ~/.cc-sessions/mail-gate-strict'`, and `rm -f` to remove; the next mail sweep reads them.

**Pane guard.** On the `shell` branch, and on wave 2's `busy` branch (never on `idle`), `sendPrompt` gains
`refuseIfTurnRunning`. It refuses when the last 8 captured rows match `BUSY_RE` (`esc to interrupt`), which
`pane/dialog.ts` exports for this as `turnRunning(window)` (following `autoContinueArmed`; the constant is
module-private today). It is best-effort, and the spec says so. `READER_MIN_COLS`'s docstring (`shared/api.ts` ~8284)
records that a phrase match is blind below 120 columns, where the line wraps; `interrupt`'s docstring (`inject/send.ts`
~1008) and README (~3430) record that a `--remote-control` pane never renders `esc to interrupt`. So the
guard is a drift tripwire behind §3.1's binary-confirmed rule, not a second proof of idleness, and it adds no width
condition: `shell` delivery stays width-independent, as `idle` delivery is today.

The refusal is a new `SendResult` member, `turn-running`, placed before the attempts ceiling as `auto-continue-armed`
is (~3703): `backOff(d.id, 'turn-running', now + MAIL_TURN_HOLD_MS, false)`, where `MAIL_TURN_HOLD_MS` is 60 s
(*chosen*: a turn may end in seconds; `MAIL_ARMED_HOLD_MS` is sized for a limit reset). Unlike that arm it calls no
`tellSender`, because a running turn is not a blocked recipient. Falling through would count an attempt: a
never-delivered row parks `undeliverable` at `MAIL_MAX_ATTEMPTS` (6), and a delivered one backs off toward the 15-minute
ceiling. `backOff`'s `countsAsAttempt` docstring (`store.ts` ~4331, "three refusal paths") names `turn-running` as the
fourth: like `auto-continue-armed`, it reaches `sendPrompt` and refuses before any keystroke. The PWA's
`SEND_ERROR_TEXT` gains its row, as `auto-continue-armed`'s did.

**Effect.** S3's mails 2443/2445 land about a minute after the turn ended, not 48.9 h later. Run 129's 2407 lands
about a minute after it was queued (09-25 02:28), not 83.5 h later. Run 82's 1778 is expected to behave the same (it
ran on Claude Code 2.1.274, where `shell` was not measured).

### 4.2 The run-worker stall lane

**Where:** a pure L1 module `server/src/coord/stall.ts`, in the claim-lease shape (`claims.ts`'s `claimExpiry`). The
coord-ring scan in `single-definition.test.ts` already forbids it `./db.js` and `node:sqlite`. Its input shapes are
L2 ports declared by this consumer, as `claims.ts`'s `LivenessProbe` is.

An L4 lane, `sweepStalls(sessions)` in `watch.ts`, is dispatched from `tick()` after the claim lanes as
`void this.sweepStalls(sessions).catch(…)` with its own in-flight guard, on its own clock (`STALL_SWEEP_MS =
CLAIM_SWEEP_MS`, 60 s), gated on `primed`, skipped with no coord store. Its reads are async, so it does not run inside
the claim pair's synchronous try-block.

- It takes identity, lifecycle, `limits`, `dialogPending`, `stranded`, `swapBlocked` and the unmeasured flags from this
  tick's `FleetSession` rows.
- It never reads `FleetSession.status`. That is `liveSessionStatus`'s collapse (`shell` and `waiting` read `busy`), and
  `assembleFleet` paints a pane with no live file `idle` with a null `statusUpdatedAt`. Instead the lane reads each
  candidate worker's raw word itself: `tmux.panePid`, `configDirFor`, then `readLiveStateMeasured`. A null pid (which
  folds a gone pane and a tmux that did not answer), an unresolvable config dir, and the read's `no-state` and
  `unmeasured` are holds (hold 1).
- It applies the verdict and decides nothing.

`stallVerdict(input: StallInput, now: number): StallVerdict`, where
`StallVerdict = {act:'none'} | {act:'hold', why: StallHold} | {act:'notify', arm: StallArm, rung: 1|2|3, key: number}`.
`StallHold` and `StallArm` (`'quiet' | 'orphan-d' | 'orphan-e' | 'failed' | 'frozen' | 'dead' | 'coord-deaf' |
'mail-stuck' | 'limit-cap' | 'dialog-cap' | 'coord-ball' | 'marker-unreadable'`) are derived from total `Record`s. Wave 1
uses `quiet`, `limit-cap`, `dialog-cap` and `coord-ball`; the rest are wave 2's.

**Candidates.** Runs with `state NOT IN ${INACTIVE_RUN_STATES_SQL}` (the existing fragment, reused, never a new list)
and a `sessionId`, of both work and review kinds. A run in `unknown`, or in any state this build cannot name, is a hold.

When one session is the worker of two or more such runs (runs 29 and 31 overlapped 8.3 h on swift-harbor), the lane
judges it once, on the most recently dispatched run. The worker's last mail is its newest mail on any of those runs,
the ball is read across all of them, and the older runs hold. The candidate read itself supplies the siblings: one
`store.ts` query (where `INACTIVE_RUN_STATES_SQL` is module-private) returning `id`, `kind`, `state`, `sessionId`,
`claimedBy` and `dispatchedAt`, grouped by `sessionId`. `openRunsForSession` is not reused: its predicate is
`NOT IN ${TERMINAL_RUN_STATES_SQL}`, which also returns a wave N+1 run opened `planned` and runs at
`awaiting-review`/`merging`/`closing`, and it carries no `state` or `dispatchedAt`.

**Whose turn it is (the ball).** From the newest mail on the run between the worker and anyone except the watch
(the watch's own notices: `stallMailClass` answers `check`, `report` or `self-wake`; a `reply` is the worker's mail and
counts):
- **The coordinator's** when that mail is the worker's own (`fromId = runs.sessionId`) and is kind `question`; or kind
  `status` with a subject EQUAL to `WAVE_DONE_SUBJECT` or `REVIEW_DONE_SUBJECT` (`'review-done'`, a new export beside
  it in `shared/api.ts`); or a subject beginning `re stall-check: waiting`. It is also the coordinator's when the mail is
  from the coordinator (the role id `coordinator` or `resolveCoordinator(run.id)`) with a subject beginning `wait:`.
  The lane always passes the run's id, never `resolveCoordinator(null)`, whose single-active-programme fallback is a
  guess.
- **The worker's** otherwise, including after the worker's own ordinary `status` mail. This catches "status mail, then
  silence": run 31's 161.7 h and runs 87/88's 40 h. A rule keyed only on "the newest mail is inbound" misses those
  until 24 h.
- A mail TO the worker never gives the coordinator the ball through its subject. The match is equality, not a prefix,
  because the server's own `wave-done-rejected`, `review-done-rejected` and `wave-advance-rejected` go from the role
  `coordinator` to the worker and mean the worker owes a new claim (`runSignals`' `subject = ?` idiom).

**Quiet, without a fleet marker (wave 1).** The worker's raw live word is `idle` or `shell`, and quiet = now −
max(`statusUpdatedAt`, the worker's last mail on the run(s), the newest non-watch mail TO the worker on the run(s),
`dispatchedAt`). The ball passes to the worker when that inbound mail is queued, and the clock starts there, so a worker
just handed an answer is not checked at once. S1–S4 and run 31 are unchanged by that term, because their newest
inbound mail precedes their Stop.

Two costs of this clock are accepted until wave 2:
- A worker at `busy` is not judged. It cannot yet be told apart from a turn in flight, so wave 1 treats background
  agents or workflows as an exemption, uncapped. From wave 2, background work is never an exemption (below).
- Before r1, plumbing resets the clock: a respawn, a swap or ccd's auto-compact each restamp `statusUpdatedAt`, which
  delays r1 by up to 2 h (run 87: ccd's `/compact` 9 min into a 40.5 h stall). An open episode is not reset.

**Background work is never an exemption** from wave 2. S3's live `shell` was an orphaned wait loop; S4's outstanding
Monitor reported to nobody; an exemption would have lost 9–17 census stalls. Wave 2's `delegates` hold is the one
bounded exception (§5.1).

**Holds** (each is `hold`, never `none`; only the limit hold turns into a notify, at its cap). The numbers name them;
they are evaluated in §10's order, where lifecycle (hold 4) comes before holds 2 and 3, so a dead worker reaches wave 2's
dead arm even while it is asking or limit-held:
1. any input unmeasured: `FleetSession.unmeasured`, `statusUnmeasured`, a null pane pid, a null config dir, the
   live-state read's `unmeasured` or `no-state`, a failed store read.
2. a) a question the worker asked: a fresh hookstate `ask`, or an asks row `held`/`answering`. Uncapped; the asks lane
   owns it (5 legit AskUserQuestion waits ran at most 6.6 h).
   b) `dialogPending` or live `waiting` with no ask behind it: a harness menu such as the Fable consent fallback, or a
   background subagent's permission prompt. Capped by §11 item 8's ruling: after 2 h of quiet under this hold, one
   `dialog-cap` operator push per episode, `⚠ stalled › <run workspace> (dialog)`, and no worker or coordinator mail,
   since neither can land on `waiting`.
3. measured 5 h or 7 d usage at or above 100, `stranded`, `swapBlocked`, or a delivery to the worker whose `lastError`
   is `auto-continue-armed` (a `backOff` reason, never a `MailGate`) and whose `nextAttemptAt` is later than now −
   10 min + `MAIL_ARMED_HOLD_MS` (`backOff` stores no time of its own, and wave 1 adds no column). A null `limits`, or
   a null window, is neither at the ceiling nor unmeasured for this hold, so a wrapper with no telemetry is judged. The
   hold is capped at 12.5 h of quiet (the longest of 19 legit limit waits); past it, one `limit-cap` operator push per
   episode. The lane computes the auto-continue hold's start (`nextAttemptAt − MAIL_ARMED_HOLD_MS`) in `watch.ts`, where
   that constant is module-private, and passes it in `StallInput`; `stall.ts` compares it with
   `AUTO_CONTINUE_RECENT_MS` and never names `MAIL_ARMED_HOLD_MS`.
4. lifecycle `restarting`, `null` or `unmeasurable`. The dead words (`lifecycleIsDead`: `stopped`, `orphan`,
   `never-started`) hold in wave 1 and are wave 2's dead arm. `unsupervised` and `unclaimed` are alive panes
   (`sessionLifecycle`'s `input.alive` arm) and are judged as `running`.

**The ladder.** The episode key is `episodeKeyMs = max(the worker's newest mail on the run(s), the coordinator's
newest `wait:` mail to the worker on the run(s), dispatchedAt)`. It is computed before any rung. It changes only when
the worker mails or the coordinator sends `wait:`, and either one closes the episode. It keys every observation of the
episode, `limit-cap` included.
- **r1 at 2 h of quiet** — a stall-check mail from `operator` to the worker, recorded but not pushed.
- **r2 at r1 + 1 h** with no worker mail on the run since r1 — a `stall:` mail from `operator` to the coordinator,
  pushed as `⚠ stall › <run workspace>`.
- **r3 at r2 + 1 h** with still no worker mail — one operator push, `⚠ stalled › <run workspace>`.

Every rung re-runs the verdict when it falls due, on r1's inputs except quiet, and fires only while the ball is still
the worker's and no hold applies; a hold defers a rung and never cancels it. In wave 1 a worker that reads `busy` when r2
or r3 falls due defers the rung, and the rung's hour then runs from the moment the raw word reads `idle` or `shell`
again. A coordinator `wait:` mail closes the episode, so it cancels the remaining rungs; a silence after the ball
returns opens a new episode at r1.

**The coordinator's state at r2** is `measureClaimant`'s verdict (`coord/reclaim.ts`) on `resolveCoordinator(run.id)`, the
same re-measurement the reclaim door runs:
- `alive`: r2 is sent.
- `unmeasurable`: r2 is deferred.
- `dead`, which includes a registry row absent from a cleanly listed directory: r2 is skipped, and r3 fires at r1 + 1 h
  naming `POST /api/runs/:id/reclaim`.
- no claimant (`resolveCoordinator` null; reclaim would answer `no-claimant`): r2 is skipped, and r3 fires at r1 + 1 h
  saying the run has no coordinator, naming no door.
- `$REG/coordinator-paused` present: r2 is skipped, and r3 fires at r1 + 1 h saying coordination is paused (lifted by
  `POST /api/coord/pause`). The reclaim door is never named for a paused coordinator: it is alive, and reclaim refuses
  it with `claimant-alive`. §11 decision 2 asks the operator to confirm this.

**The coordinator's ball has a cap** (§11 decision 9): when the ball has been the coordinator's for 30 h (above the
28.7 h legit maximum) with no mail on the run from either side, one operator push per episode, `⚠ waiting › <run
workspace>` (arm `coord-ball`). Without it, a worker's `re stall-check: waiting` or a coordinator's `wait:` would
silence the watch for good.

**Thresholds.** The census replay fires rung 1 97 times in 27.6 days (3.5 a day) and reaches 47 of the 53 stalls. That
replay ran the FULL rule: the main-thread clock, wave 2's `delegates` hold, `busy` workers judged, and no dialog hold.
With hold 2b the two Fable-consent stalls are held, so the figure is 45 of 53. Wave 1's own rule (raw `idle`/`shell`,
the `statusUpdatedAt` clock, `busy` not judged) was not replayed. It reaches fewer, and its first 48 h of r1 rows
measure how many. Below 2 h the 1–2 h band is almost all legitimate (background 27, coordinator 26, limit 12, about 10
stalls); 3 h saves 0.4 fires a day and loses 5 stalls. The +1 h rungs follow coordinator reply latency (792 replies:
p50 8 min, p90 1.56 h, 85% within 1 h).

**Mail bodies** carry measured facts only: session and workspace ids matching `^[A-Za-z0-9._-]+$`, the run's `program`
slug (never `programTitle`), integers, mail kinds and server-formatted UTC times. Never transcript text, a mail subject
or a task description. A value that fails its pattern is replaced by `(unprintable)`, never quoted or escaped. The r1
body carries its own protocol, so no skill must be installed first. For S4 it would read:

> stall-check from the ccrc stall watch (server), run 67 — battlescape-operational wave 9/9.
> Your main loop has been idle since 2026-09-28T21:56:31Z (2h 0m). Your last mail on this run: #2509 status at
> 21:17:43Z. Newest mail to you on this run: #2510 answer at 21:19:17Z.
> Background work you ended your turn to wait for may have finished or died without a notice that can wake you: a task
> a subagent started reports to that subagent, and a background shell has no deadline.
> Before anything else, send ONE mail on run 67 to toId 'coordinator', kind status:
> still working — subject beginning "re stall-check: working", what you are doing and when you report next;
> waiting on the coordinator — subject beginning "re stall-check: waiting", what you wait for (this hands the run to the
> coordinator and stops these checks);
> blocked on a decision — ask it with AskUserQuestion (your skill's question clause); these checks hold while it is open.
> No mail from you on run 67 by 00:57Z: the coordinator is told. By 01:57Z: the operator.

With a current wave-2 marker (§5.1) the last line reads: "No mail from you on run 67: the coordinator is told when your
next turn ends without one, and by 02:57Z at the latest; the operator 1 h after that."

Its subject is `stall-check: run 67 — quiet 2h 0m, owed: reply to #2510`. The "owed" part is "first report" when no
worker mail exists since dispatch, and "next report" when the newest mail is the worker's own status. The reply is the
report the worker owed, so the coordinator turn it costs is the one the protocol always meant to spend.

The r2 body gives the run, wave and state, the worker's last mail and its newest inbound mail, and r1's id with its
queued, delivered and acked times, then: "Ack this, re-measure the run and the worker's last mail, and act once: mail
the worker a resume, mail it a subject beginning `wait:` naming what it waits for, or re-dispatch a dead worker. A
stall mail never licenses re-dispatching a live worker." It carries its own instruction until wave 3's clause reaches
every home.

**Push shape.** `stall.ts` exports one classifier, `stallMailClass(m, bind?) → 'check' | 'reply' | 'report' |
'self-wake' | null`, where `bind` is `{runSessionId, runId, firstCheckId: number | null}`: `pushNewMail` reads it from the
store (the lowest id of a `stall-check:` mail from `operator` to that session on that run) for rows whose subject begins
`re stall-check:`, so `stall.ts` stays pure. `pushNewMail` consults it beside `isAskNudgeMail`:
- `check` (a `stall-check:` mail from `operator`) and `self-wake` (`orphaned:` or `failed:` from `operator`, wave 2)
  are recorded, not pushed.
- `reply` is recorded, not pushed, but only when it is bound: `fromId === bind.runSessionId`, `runId === bind.runId`,
  a subject beginning `re stall-check:`, and `bind.firstCheckId` lower than `m.id`. Any other mail with that subject is
  pushed as ordinary mail, so no box-token holder can use the prefix to keep a mail off the phone.
- `report` (a `stall:` mail from `operator`) is pushed with a title by its arm: `⚠ stall`, `⚠ frozen`, `⚠ dead` or
  `⚠ failed` `› <run workspace>`. The frozen, dead and failed arms' coordinator notices are `stall:` mails, so none of
  them is pushed a second time through `pushOne`.

Pushes with no mail row (r3, `limit-cap`, `dialog-cap`, `coord-ball`, and wave 2's coord-deaf, mail-stuck, marker-unreadable and
delayed orphan pushes) go through `pushOne` with an existing kind (`run` for run arms, `mail` for a run-less orphan),
`recordAlways: true`, and the tag `stall-<runId|sessionId>-<arm>-<rung>-<key>` (the `key` below), except the delayed
orphan push, whose tag is `orphaned-<toId>-<restartAt>` (§5.2). No `NotifyEvent` kind is added; a new kind is a wire
change.

**Spelled once.** The prefixes `stall-check:`, `re stall-check:`, `re stall-check: waiting`, `stall:`, `orphaned:`,
`failed:` and `wait:`, and the observation-detail pair `stallDetail`/`parseStallDetail`
(`stall:<arm>:<rung>:<key>`, and `stall-shadow:…` in shadow), live in `stall.ts`. `key` is the arm's own event:
`episodeKeyMs` for `quiet`, `limit-cap`, `dialog-cap`, `coord-ball`, `frozen`, `dead`, `coord-deaf` and `marker-unreadable`; the
marker's `restartAt` for `orphan-d`; its `stopAt` for `orphan-e` and `failed`; the `deliveryId` for `mail-stuck`. A notice
to a coordinator with no run to record it on is keyed on its own mail row, as §5.2's run-less D notice is.
`single-definition.test.ts` reds on a second literal. `SYSTEM_MAIL_SENDER_MAP`'s gloss for `operator` names the watch.

**Durable dedupe, no migration.**
- `queueStallNotice(run: RunRow | null, notice) → {queued:true, mailId, deliveryId} | {queued:false,
  why:'duplicate'|'run-gone'}`, one transaction. For a run notice it checks for a `run_events` observation row with the
  same detail, writes that row (`pushNewRuns` already skips `fromState === toState` rows), and inserts the mail through
  the body of `queueSystemMail` extracted as `insertSystemMailTx`. The run-less orphan notice uses its own mail row
  (§5.2).
- `recordStallObservation(runId, detail, at) → {recorded:true, eventId} | {recorded:false, why:'duplicate'|'run-gone'}`
  serves shadow rows and every push-only rung, with the same one-transaction dedupe. A push-only rung is recorded first,
  then pushed.
- `stallNotices(runId) → {detail, at}[]` over `run_events` gives the lane each rung's time.
- None returns `void`, which is the open writer-defect class on `main`. A restart or deploy therefore cannot re-send a
  rung.
- The caller census in `queueSystemMail`'s in-transaction comment ("all five of its callers") moves with the body into
  `insertSystemMailTx`, where it names that function's two callers (`queueSystemMail`, and through it the five, and
  `queueStallNotice`). `queueSystemMail`'s docstring gains the ask nudge it already omits.

**Markers** (none has a writer in the tree; read from one registry listing; an unlistable registry fails shut; the
registry is the fleet box's `~/.cc-sessions`, which the server lists through the agent):
- `stall-watch-disabled`: the lane returns; nothing is recorded or sent.
- `stall-watch-live` absent: **shadow** for every arm: `stall-shadow:*` observation rows and one
  `console.warn('ccrc-server: stall-watch shadow …')` per fire, nothing sent. Present: the notices addressed to the
  stalled session itself are sent (r1, and wave 2's orphan and failed self-mails).
- `stall-watch-escalate` absent: every notice addressed to a coordinator (r2, and the frozen, dead and failed
  coordinator mails) and every operator push stay shadow even with `stall-watch-live` present. Present: they are sent.
- `stall-watch-w2-live` absent: the lane treats every turn-marker read as `absent` for its verdicts. It keeps wave 1's
  clock, leaves `busy` workers unjudged, holds on no marker read and keeps wave 1's r1 + 1 h rungs. Every wave-2 arm
  and every wave-2 rule (the marker clock, the `delegates` hold, restart grace, escalation on proof) is recorded as
  `stall-shadow:` rows only, whatever the other markers say. Present: they take effect under `stall-watch-live` and
  `stall-watch-escalate` as above. So wave 2 is armed only after 48 h of its own shadow rows have been hand-classified,
  and no marker read can hold the lane while `marker-unreadable` is shadowed.

Every marker is touched and removed by hand on the fleet box, the `mail-disabled` precedent:
`ssh <fleet-host> 'touch ~/.cc-sessions/stall-watch-live'`, and `rm -f` to remove. The lane reads it at its next 60 s
tick.

**Effect on the recorded silences** (lane ≤ 60 s, mail sweep ≤ 10 s):

| Silence | Wave 1 | Instead of | If the worker stays silent |
|---|---|---|---|
| S1 | r1 lands 09-16 ~22:01 (idle status inferred) | 71.4 h (operator) | coordinator ~23:01, operator ~00:01. If the worker's account had read at or above 100 in `limits`, the 12.5 h cap would push the operator 09-17 ~08:30; the monthly spend limit that refused the operator's first prompt on 09-19 is not measured (§9.11) |
| S2 | r1 lands 09-19 ~23:14 (idle status inferred) | 157.5 h (operator) | coordinator ~00:14, operator ~01:14 |
| S3 | the gate delivers 2443/2445 ~13:04:15 | 48.9 h | — |
| S4 | r1 lands 09-28 ~23:57 | 8.3 h (by hand) | wave 2 moves it to ~22:07 (§5.2) |
| run 31 | r1 at 2 h | 161.7 h | — |
| run 129 | the gate delivers 2407 ~09-25 02:28 | 84.2 h | — |
| run 82 | expected as run 129 (2.1.274, `shell` unmeasured there) | 57.3 h | — |

**Residual after wave 1:** a worker held at `busy` by background agents (the live five-ruling state), restart orphans
(Case D), frozen and dead workers. API-error aborts leave the live status `idle`, so wave 1 reaches them at 2 h; wave
2's failed arm shortens that to 10 min.

## 5. Wave 2 — a main-thread marker on the fleet box, and the arms it enables

### 5.1 The marker, its readers, and the `busy` arm

**First task.** Capture each installed lane's Stop, StopFailure and subagent payloads in ONE scratch session per lane.
The capture is a `session-hook.sh` arm gated on that session's tmux name, shipped with `StopFailure` added to
`EVENTS_JSON` and given its case arm (the pair `install-session-hooks.test.ts` enforces), and placed by the install spine
(`_inst_hooks`), which registers one command in every rostered home and has no per-session scope. Never hand-edit a
rostered home's `settings.json`, and never type into a live pane. Reduce each payload to its key set, its value types and the
`background_tasks[].type` aliases before anything is committed, because the repo is public and raw payloads carry
`last_assistant_message` and `transcript_path`.

**Writer** (`ccd/session-hook.sh`). Its header contract holds: exit 0, no network, no lock on the hot path, prints
nothing on Stop. The one `jq` call at the payload parse (~2767) becomes one program emitting `hook_event_name`,
`session_id` and `agent_id`, so the fork count does not change. A helper `_hook_turn_mark` writes one JSON line through
`_hook_write_atomic` to `$REG/<id>.turn.json`:

`{v:1, sessionId, state:'working'|'done'|'failed', event, at, turnAt, stopAt, bg, bgKinds, bgIds, err, restartAt,
lostBg, lostKinds, lostIds}`

- Every write rewrites the whole line and carries forward every field it does not set.
- A payload with a non-empty top-level `agent_id` never touches the marker. Only main-thread events write it, and they
  run in sequence, so the shared file's lost-update race cannot happen here.
- The first main event after `done`/`failed` (UserPromptSubmit, or a main Pre/PostToolUse) writes `working`, `turnAt`,
  and clears `lostBg`/`lostKinds`/`lostIds`. Later main tool events while already `working` do not write: a builtin
  `read`, no fork.
- **Stop:** `done`, `stopAt`. `bg` is the length of the payload's `background_tasks`, or **−1 when the field is absent
  (unmeasured, never 0)**. `bgKinds` is the comma-joined, de-duplicated `background_tasks[].type` display aliases
  (2.1.284: `subagent`, `workflow`, `shell`, `monitor`, `MCP task`, `teammate`, `dream`, `auto-mode scan`,
  `cloud session`); each is lower-cased and each space turned into `-` before characters outside `[a-z_,-]` are
  deleted; the value is then cut at 200 bytes. `bgIds`
  is the `background_tasks[].id` values matching `^[A-Za-z0-9_-]{1,64}$`, at most 8, comma-joined. The payload's
  `session_crons` is not read: a scheduled wake does not stop the checks, and clause 16 does not count it as a wake.
- **`is_interrupt`.** No installed version's Stop payload carries it, so the Stop arm stops reading it and stops writing
  `interrupted`. `session-hook.test.ts`'s "interrupted survives when the payload says so" row is rewritten to assert
  that a Stop carrying `is_interrupt` writes no `interrupted` key. `HookState.interrupted`, read only inside
  `hookstate.ts`, stays as an always-false field for older files.
- **StopFailure** (added to `install-session-hooks.sh`'s `EVENTS_JSON`; present in the oldest lane, 2.1.277):
  `failed`, `stopAt`; `err` has characters outside `[a-z_]` deleted and is cut at 64 bytes. It prints nothing and
  leaves `hookstate.json` alone.
- **SessionStart** `startup`/`resume`, or an absent or unknown `source` (D-1248's rule): `done`, `restartAt`, `bg 0`,
  keeping `stopAt` and `turnAt`. When the previous line was `done` for the same `sessionId`, `lostBg = prev.lostBg +
  max(prev.bg, 0)`, and `lostKinds`/`lostIds` take `prev.bgKinds`/`prev.bgIds`: the old process's tasks died with it.
  When the previous line was `working` (a mid-turn death that ccd's redrive re-prompts), the stall lane and the `busy`
  gate hold for `RESTART_GRACE_MS` (5 min, *chosen*) after `restartAt`. `clear`: a fresh line. `compact`: untouched
  (a compact SessionStart fires mid-turn; D-306's rule).
- **Name and liveness.** The marker is `$REG/<id>.turn.json`: two dots after the id, the `hookstate.json` precedent, so
  `_ws_slug_free` never counts it and no late write can hold a slug. The write is skipped when
  `$REG/<id>.generation` is absent. `_reg_purge` removes it under the lock it already holds, line-neutral, by replacing
  the `hookstate.json` removal line (`ccd/ccd` ~3818) with
  `for f in "$REG/$id.hookstate.json" "$REG/$id.turn.json"; do rm -f "$f" || _reg_purge_unremoved "$f"; done`,
  and the field inventory above it names the new file. No glob: `_hook_write_atomic` stages through the dot-leading
  `.<id>.turn.json.<pid>.<nonce>.hook-write.tmp`, which no `$REG/$id.*` pattern reaches, and a trailing `*` would match
  another row's `<id>.turn.json-<slug>.uuid` — the cross-id deletion `_reg_purge`'s F3 note exists to prevent. The
  `_ws_slug_free` header note (`ccd/ccd` ~6143, "one named two-dot file") is edited, line-neutral, to name both
  files. This edits generated `ccd/ccd` and pays its restamp. A write that
  lands after a purge leaves a file that holds no slug and that the reader answers `foreign` or `stale`; the next row
  of that id overwrites it at its first SessionStart. A leftover `_hook_write_atomic` tmp is dot-leading and holds no
  slug either.
- **Citation tax.** `session-hook.sh` is cited by README.md (`:2900`) and by the two frozen compaction-card documents,
  and `session-hook.test.ts` resolves each citation. Every edit above the last anchor (the payload parse and the
  SessionStart arm) is line-neutral in place; `_hook_turn_mark`, the Stop change and the StopFailure arm land below it.
  The citation instrument is run before and after.

**Readers** (L3, each a union with no folded arm):
- `readTurnMarkMeasured(io, reg, id, currentUuid, live)` in `server/src/turnmark.ts` returns the mark or one of five
  reasons: `absent` (proven ENOENT; an older fleet build), `unmeasured` (the read failed), `malformed` (bad JSON, wrong
  `v`, unknown state word, over 4 KiB), `foreign` (`sessionId` ≠ registry uuid), `stale` (`at` and `restartAt` both
  older than the live process's `startedAt`, which `livestate.ts`'s reader gains as an additive field). There is no
  freshness window: the marker changes only on main events, so a days-old `done` is still true. `bg` −1 stays −1.
- `readHookStateRawMeasured(io, reg, id, currentUuid)` in `hookstate.ts` returns `{ok:true, state: HookState,
  sessionId, identity:'current'|'foreign'|'unregistered'}`. It validates every field today's reader validates (the
  64 KiB cap, `v`, `state`, `updatedAt`, `interrupted`, `event`, `ask`, `subagents`, the graph counters) and applies no
  identity or freshness cut. Otherwise it returns `{ok:false, reason:'absent'|'unmeasured'|'malformed'}`.
  `readHookStateMeasured` becomes the fold over it that maps `malformed`, `foreign`, `unregistered` and an `updatedAt`
  older than `HOOKSTATE_FRESH_MS` to `no-state` in one place ("derived, not duplicated"), so its existing suite stays
  green unchanged.

**How consumers branch on the marker read.** `absent`, `foreign` and `stale` take the wave-1 path. `unmeasured` never
delivers on `busy` and makes the stall lane hold. `malformed` never delivers on `busy`; for the stall lane it takes the
wave-1 path. Either one persisting for 1 h on a candidate raises one operator push per episode naming the marker (arm
`marker-unreadable`), so a wave-2 defect never disarms wave 1's lane silently. Wave 2 also adds a third gate token,
`turn-mark-unreadable`, as an additive `MailGate` member with its `MailStrip` phrase, so a fleet fault never hides
behind `not-idle`.

**An interrupted turn.** Stop does not fire on an interrupt, so every Esc leaves the marker `working`. A `working`
marker whose `at` is older than the live file's `statusUpdatedAt`, under live `idle` or `shell`, is read by the gate
and the lane as `done` at `statusUpdatedAt`. `shell` refuses only on a `working` marker at least as new as
`statusUpdatedAt`.

**`busy` delivery.** `mailTurnIdle` delivers on `busy` when the mode is `busy` and the marker is measured, current and
`done` or `failed`. Quiet is measured from `stopAt`, never from `statusUpdatedAt`, which does not move at a turn end
under `busy`. The pane guard applies. The mode `busy-shadow` logs "would deliver" instead. It is armed in two steps by
hand: `mail-gate-busy-shadow` for 48 h, with every "would deliver" line checked against its transcript, then
`mail-gate-busy`. The five live rulings of 09-28 would have landed at 14:34 and 14:51, the worker's next Stops.

**Quiet with the marker.** The stall lane's clock becomes `stopAt`, maxed with the worker's last mail, the newest
non-watch mail to the worker, and `dispatchedAt`. Respawns and swaps no longer reset it, and `busy` workers are judged.

**The one bounded exception.** The `delegates` hold and the frozen arm read subagent activity, which §3.3, §3.4 and
§8 otherwise exclude as a sign of MAIN-thread life. They read it through `readHookStateRawMeasured` only:
- An `event` of SessionStart, PreCompact or PostCompact is plumbing and never refreshes the hold or the frozen clock.
- The `delegates` hold applies when the main loop is idle and the raw `updatedAt` (non-plumbing event, identity
  `current`) is within 30 min (the longest foreground call measured was 28.3 min). It is capped at 4 h of main
  silence (at 4 h, subagent activity covered 1 of 101 gaps). It applies to the quiet arm only; the failed, mail-stuck
  and orphan arms do not consult it.
- Any other reason (`absent`, `unmeasured`, `malformed`, `foreign`) is a hold for the frozen arm and no hold for the
  quiet arm. `no-state` is never read as elapsed time.

**Escalation on proof, bounded by a clock.** With a current marker, r2 fires at the first of:
- (a) the worker's first Stop after a delivered stall-check carries a measured `bg` (not −1), no `subagent` or
  `workflow` in `bgKinds` (a `shell` is not a wake, clause 16's rule), and no worker mail since the check;
- (b) a second `orphan-e` row (a later `stopAt`) is recorded inside the episode: the worker re-armed and ended again
  without mail;
- (c) the check is still undelivered `CHECK_UNDELIVERED_MS` (2 h) after it was queued;
- (d) `STALL_BOUND_MS` has passed since r1 with no worker mail on the run, whatever the Stops showed (§11 decision 7;
  recommended 3 h).

With no marker, wave 1's r1 + 1 h rule applies. r3 follows r2 by 1 h in every case. (d) wakes a coordinator on a timer
while a worker may be legitimately re-ending over a live task; that is the price of a bound.

### 5.2 The arms the marker enables

All wave-2 arms are gated by `stall-watch-w2-live` as well as the markers in §4.2.

| Arm | Who | Fires when | Rung | Basis |
|---|---|---|---|---|
| **orphan (D)** | any session | marker `done`, `lostBg > 0`, `restartAt > stopAt`, no main event since, live `idle` for 15 min, episode began within 24 h | a mail to the session itself | 21 orphaned restarts: all 13 self-heals within 2.4 min, earliest human pick-up 37 min; 8 waited 15 min or more (0.4 a day) |
| **orphan (E)** | run workers and coordinators | a wake-bearing kind at the Stop (`subagent`, `workflow`, `shell`; here `shell` counts: E detects a task that could have woken the session and did not), `statusUpdatedAt ≥ stopAt`, live `idle` for 10 min, no main event since | a mail to the session itself | S4 at ~22:07 instead of 23:57. Operator-interactive sessions are excluded: D and E together, at 10 min on every session, measured about 2.8 a day, mostly operator panes, against about 0.4 for D alone at 15 min |
| **failed** | run workers and coordinators | marker `failed` for 10 min, live `idle`; `err` classified by `STOP_FAILURE_ERRORS` below | per class | 5 census stalls, 36 h (run 40: 19 h after "Connection refused"; one was "Prompt is too long") |
| **frozen** | run workers | marker `working`, live `busy`, and the raw hookstate `updatedAt` (non-plumbing, current) older than 60 min | coordinator mail + push `⚠ frozen` | longest legit call 28.3 min; the 08-27 memory.high freeze (18 h 51 m) and a 4.6 h Bash |
| **dead** | run workers | lifecycle `stopped`, `orphan` or `never-started` for 10 min | coordinator mail + push | respawn measured at 9 s; 10 min = 5 × `SUPERVISED_FRESH_MS`. §11 decision 10 asks whether a deliberate `stopped` is excluded |
| **coordinator deaf** | run coordinators | the worker's `question`, wave-done or review-done to the coordinator unacked 1 h | push `⚠ coordinator deaf` | acks precede replies; 85% of 792 coordinator replies came within 1 h |
| **mail stuck** | run workers and coordinators | a delivery addressed to them (on the run, or run-less) still undelivered 1.2 h after its recipient's main loop went idle (live `idle`/`shell`, or a current marker `done`), whatever its gate; or whose `lastGate` has read `registry-unmeasurable` continuously for 1.2 h (now − `gateSince`). `lastError` is never read: it is sticky text that outlives the transient it records (2445, 2463, 2464, 1778) | push, once per deliveryId | p90 mail-to-first-read 1.22 h over 1,206 worker mails. No measured census case survives waves 1–2's gate changes; the arm is a backstop whose rate the shadow measures |

**`STOP_FAILURE_ERRORS`** is one total `Record` in `stall.ts` over StopFailure's documented values:
- **retry:** `server_error`, `overloaded`, `max_output_tokens`, `unknown` — a `failed:` self-mail at 10 min; a second
  failure within `FAILED_REPEAT_MS` (2 h) goes to the coordinator.
- **account:** `rate_limit`, `billing_error`, `authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`
  (listed by the binary only behind a feature gate), `verification_required`, `cloud_credential_error` — hold; the
  limit, swap and authdead machinery owns them.
- **request:** `invalid_request`, `model_not_found` — a coordinator mail and push at 10 min, no self-mail, because a
  retry fails the same way.
- any other token (a newer build): hold, plus one `console.warn('ccrc-server: stall-watch unknown StopFailure
  <err>')`. It is never guessed into a self-wake; wave 1's ladder remains the backstop, because the live status is idle.

The thirteen values are 2.1.277–2.1.284's own StopFailure matcher list, identical in every installed lane.

**The orphan mail** names only what the marker carries: `orphaned: <lostBg> background task(s) (<lostKinds>) did not
survive the <yyyy-mm-ddThh:mm>Z restart`, listing each id in `lostIds` (and, once continuity's `$REG/<id>.inflight`
exists, its validated ids), plus one instruction: report what was lost to whoever you owe a report, and resume a
workflow only when that is cheap — never relaunch an expensive or Fable-heavy workflow by default. It never names a
task's `name`, `description` or `command`, and the orphan pass never reads the transcript. The E self-mail's subject is
`orphaned: your background <kind> ended at <hh:mm>Z without waking you`; the failed self-mail's is `failed: your turn
ended on an API error (<err>) at <hh:mm>Z`. All three are class `self-wake`: recorded, not pushed.

**Dedupe for run-less notices.** A session that is no ACTIVE run's worker or coordinator has no `run_events` row to key
on (`run_events.runId` references `runs(id)`, and `recordRunEvent` does nothing for an unknown run). Its D notice is
keyed on its own mail row: `queueStallNotice(null, notice)` answers `{queued:false, why:'duplicate'}` when any mail row
in any delivery state (acked, rejected and parked included, not only `hasOutstandingMail`'s outstanding set) has
`fromId 'operator'`, `runId` null, the same `toId` and the same deterministic subject, checked in the same transaction
as the insert. The read is landing-order wave 2's `CoordStore.hasMailWithSubject(fromId, runId, toId, subject)` (every
delivery state, `runId IS ?`); whichever programme lands first adds it. The `⚠ orphaned` push fires once, when that row's delivery is still unacked 30 min after `deliveredAt`
(or still undelivered 30 min after queueing), with the tag `orphaned-<toId>-<restartAt>`; its latch is in memory, so a
server restart inside that window may push once more, and the tag collapses the two on the phone. Candidates are the
registry rows whose marker reads `done` with `lostBg > 0`: one marker read per row per lane tick.

### 5.3 What stays out of the hook and the pane

- Nothing but the server mail lane types into a pane. ccd's redrive is not extended: a second typing actor into
  operator-interactive panes is refused, and the mail lane already has the draft, menu, auto-continue and turn-running
  guards.
- Nothing in the hook waits, locks, prints on Stop, or reads a transcript.

## 6. Wave 3 — skills, docs, the continuity amendment

### 6.1 The next free coordinator clause (pinned)

Proposed text, typed in the typographic-apostrophe style of clauses 3–12, for the operator to rule on:

> A mail from `operator` whose subject begins `stall:` is the server’s stall watch reporting your worker, not the
> worker itself; it wakes you, and answering it is not polling. Ack it, re-measure the run and the worker’s last mail,
> then act once: mail the worker a resume that names its last mail and what it owes; or, if the silence is yours
> because you told it to wait, mail it a subject beginning `wait:` that names what it waits for, which the watch reads
> as the run waiting on you until your next mail; or, if the worker is dead or cannot be woken, re-dispatch a dead one
> as ‘When something is wrong’ says and say which in this turn’s text for the operator. A stall mail never licenses
> re-dispatching a live worker.

Pin impact: `coordinator-skill.test.ts`'s verbatim array gains the clause, and every coordinator count word moves by
one (SKILL.md's, CLAUDE.md's, README.md's). A new row pins that the quoted `stall:` and `wait:` equal the constants
exported from `stall.ts`. The insertion shifts every later cited SKILL.md line; the citation sweep re-proves each in the
same commit. It is numbered after landing-order's and continuity's clauses if those land first (§10).

**Amended 2026-10-04 (the operator; ledger R2 and R17 F1; `coordinator-wait-widened-ball-truthful` (D-3805)).** The
text above shipped as coordinator clause 16. Two things in it needed changing. Its "until your next mail" was false
against §4.2's ball rule, which this spec chose: the worker's own next ordinary mail hands the ball back too. And the
shadow review (2026-10-02) found three episodes where a coordinator told a `working` worker to wait, behind another
programme or until a time, in an ordinary mail with no `wait:` subject, so the ball stayed with the worker. The
operator approved one amendment, and the clause ships as:

> A mail from `operator` whose subject begins `stall:` is the server’s stall watch reporting your worker, not the
> worker itself; it wakes you, and answering it is not polling. Ack it, re-measure the run and the worker’s last mail,
> then act once: mail the worker a resume that names its last mail and what it owes; or, if the silence is yours
> because you told it to wait, mail it a subject beginning `wait:` that names what it waits for; or, if the worker is
> dead or cannot be woken, re-dispatch a dead one as ‘When something is wrong’ says and say which in this turn’s text
> for the operator. A stall mail never licenses re-dispatching a live worker. Send that `wait:` mail unasked as well,
> whenever you tell a `working` worker to wait, behind another run or programme or until a time. The watch reads a
> `wait:` as the run waiting on you only until the next mail to or from the worker, its own notices aside: that mail
> hands the run back to the worker unless it is another `wait:` from you or, from the worker, a question, an exact
> `wave-done` or `review-done` claim, or a reply beginning `re stall-check: waiting`.

What this holds and what it does not. The ball sentence is now true. The widening gives every park a `wait:`, but by
the same §4.2 rule the ball it passes lasts only until the worker's next ordinary mail, and §6.2's clause ends by
prompting exactly that mail ("mail the coordinator what you did and what wakes you next before the turn ends"). So a
worker that answers a `wait:` with an ordinary `status` mail hands the ball straight back, as in the three episodes
above (which predate §6.2's clause). The widening holds mainly when the worker stays silent after the `wait:`; if r1
reaches it anyway, its `re stall-check: waiting` reply passes the ball (ledger R12). Keeping the ball through the
worker's turn-end mail is a separate operator ruling, not part of this amendment. Two words are read narrowly:
`working` is the run state (an idle pane on a `working` run is the case the widening exists for), so a parked
`dispatched` worker is not named; and "a question" is a mail of kind `question`, as §4.2 reads it, while a structured
ask is the separate `ask` hold and passes no ball.

The clause count, its number and the server are unchanged. The verbatim pin moves with the text, and three new rows
hold what a co-edit of SKILL.md and the pin could lose: the `wait:` sent past a stall mail, the ball's hand-back
exceptions as `stall.ts` and `shared/api.ts` spell them, and every quoted token being one of the constants the clause
relies on.

### 6.2 The next free worker clause (pinned)

> End a turn only on a wake you can name: a mail you sent that asks for an answer, a background agent or workflow you
> launched from your main thread yourself that has not yet reported, or a structured ask. A background shell or Monitor
> is never that wake: it has no deadline and may never report. A task a subagent started reports to that subagent, so an
> agent whose completion says it may resume on its own has reported, and is not that wake either. A restart kills every
> background task. When none of those holds, mail the coordinator what you did and what wakes you next before the turn
> ends.

It must not name a background Bash as a sufficient wake (S3). Nor may it count an agent's interim completion as one
(S4). Rev 3's text named "a background agent … you launched from your main thread yourself" without qualification, and
the S4 worker's last turn-end satisfied it word for word (§3.2). Pin impact: `worker-skill.test.ts`'s verbatim array gains
the clause and its derived count word moves by one; the same test checks that word in SKILL.md ("These fifteen
clauses" and the D-104 note's "these fifteen lines"), in CLAUDE.md, and at every README occurrence of
`ccd/worker-skill/SKILL.md` (three occurrences: `:1769`, `:2123`, and the dated R2 changelog line `:2487`, whose "now
carries fifteen clauses" is the first `<word> clauses` after the path and is checked too; its count word moves, its
parenthetical gains "the stall watch added 16", and the rest of that dated line stays as written). Until
`_inst_skills` has run in every home, coordinators may repeat its first sentence in briefs (the branch-discipline
precedent). The watch does not depend on either clause: the stall-check and `stall:` bodies carry their own protocol.

### 6.3 Docs

- `2026-09-23-session-continuity-design.md` §5 "Not-stalled restarts": "… and nothing types" becomes "… and nothing
  types at spawn. If the restart orphaned in-flight work (the marker's `lostBg`), the server's stall watch mails the
  session itself once, 15 minutes after the restart."
- Wave 1 corrects the docstrings named in §3.1 (`livestate.ts`'s `shell` gloss and consumer list, `LiveStateRead`'s
  "affirmative idle", `readLiveState`'s caller census, `sweepMail`'s conjunct 5, D-2016's `turnStall`) and the
  2026-08-17 spec's `shell` reading.
- README's mail-gate and watcher-lane sections; CLAUDE.md's coordination invariants gain one line on the stall lane.

## 7. Noise and cost

| Item | Per day | Operator effect |
|---|---|---|
| r1 stall-checks | 3.5 (97 in 27.6 days, full rule) | none: recorded, not pushed |
| r1 false positives on legit waits | ~1.1 | one worker turn and one reply each |
| r2 coordinator mails | 1–2 (55% of nudge-started turns send no mail) | `⚠ stall` push, presence-gated |
| r3 | ~0.1–0.3 | `⚠ stalled` push |
| orphan (D) | ~0.4 | `⚠ orphaned` only if unacked 30 min after delivery |
| orphan (E), run participants | ≤ 2 (14 E episodes on all sessions in 7 days; the run share is unmeasured) | none: recorded |
| failed | unmeasured (StopFailure was never counted; the census floor is 5 stalls in 27.6 days) | none; a coordinator mail on a repeat or a request error |
| frozen, dead, limit-cap, coord-ball | ~0.04 each | push |
| coordinator deaf | rare (85% of 792 replies arrive within 1 h) | push |
| mail stuck | unmeasured after waves 1–2 | push |
| gate change | 0 new mail | none; mail lands hours earlier |

**Tokens.** A worker's mail-started turn measured p50 23 requests and 6.4 M context tokens; a coordinator's, p50 10
requests and 2.9 M. An r1 costs about 4.5–9 M: the worker's reply turn (1.5–2 M for a bare reply, up to 6.4 M) plus the
coordinator's mail turn. At 3.5 a day the lane costs about 16–33 M tokens a day, plus 3–6 M for r2; 5–10 M of that falls
on legit-wait false positives. The shadow periods measure the real figure before the escalations arm.

**Server load.** Wave 1: two agent reads (pane pid, live file) per candidate run per minute. Wave 2 adds one marker read
per run worker and coordinator per minute, one per registry row per minute for the orphan pass (about 20 rows today),
and one per held delivery per mail sweep.

## 8. What is not done, and why

- **A blocking Stop hook** — §2. The Stop predicate may later run as a zero-cost journal line (no bounce) if the armed
  lane's data shows turn-end stalls still getting through.
- **ccd typing an orphan prompt at respawn** — a second typing actor into operator panes, and it races the 13 of 21
  restarts that self-heal within 2.4 min.
- **"Background work outstanding" as an exemption** — from wave 2 (§4.2); wave 1's `busy` exemption is temporary.
- **Transcript mtime, hookstate `updatedAt`/`state`, or `statusUpdatedAt` under `busy` as signs of MAIN-thread life** —
  §3.3, §3.4. Raw hookstate `updatedAt` is read only as evidence that SOME thread is alive (the bounded `delegates`
  hold) and, measured older than 60 min, as the frozen arm (§5.1).
- **A coordinator rung on an acked question.** Legit coordinator-ball waits run a median 10.8 h (p90 18.6 h, max
  28.7 h); only an unacked worker question (1 h) is flagged, plus decision 9's 30 h cap on the coordinator's ball.
- **The memory ceiling that killed Case D's pane** — the continuity programme's (its §11 item 5). This spec shortens
  the damage from 13.8 h to about 16 min; it does not prevent the OOM.
- **Upstream.** A finished subagent's Monitor notice queued under its own id and never drained (S4; 58 in 3 days) is a
  Claude Code defect. The watch caps its damage; it does not fix it.

## 9. Failure modes named

1. **Wave 2 not on the fleet box.** The marker reads `absent`; the gate and the lane keep wave 1's rules; nothing fires
   on a guess.
2. **A lost or stale marker write.** The hook exits 0 even when its write fails. A stale `working` (a lost write, or any
   interrupt) under live `idle` or `shell` that changed after it reads as `done` at `statusUpdatedAt` (§5.1). A stale
   `done` during a turn: the pane guard refuses while `esc to interrupt` shows; a nudge that passes it is folded in at
   the next tool boundary (§3.1).
3. **A Claude Code build that omits `agent_id` on subagent payloads.** Subagent events would count as main-thread ones;
   behaviour degrades to wave 1's, never misfires. Wave 2's first task captures real payloads from every installed lane,
   in one scratch session per lane whose capture hook `_inst_hooks` places (§5.1).
4. **A build where `shell` stops meaning idle.** On a wide, non-RC pane the guard refuses, and the refusal is
   non-counting. On a narrow or RC pane the guard cannot see a running turn: the nudge is typed and folded in at the next
   tool boundary. `mail-gate-strict` is the way back. The stall lane has no such guard: a long busy turn would read as
   `shell` and draw r1 after 2 h; on a wide, non-RC pane the pane guard refuses r1's delivery and r2 reaches the
   coordinator, who re-measures; on a narrow or RC pane r1 is typed and folded in at the next tool boundary (§3.1). The
   shadow period is where this shows first. §11 decision 11 asks about a doctor probe.
5. **The agent link down, or the registry unlistable.** `tick()` returns before registry-sourced lanes; the markers fail
   shut; nothing fires. The durable episodes resume afterwards.
6. **`coord.db` throws synchronously.** Store calls are wrapped as the claim lanes' are; one sweep is lost.
7. **Server restart or deploy.** Dedupe lives in `run_events` observation rows for run notices and in the notice's own
   mail row, over every delivery state, for run-less orphan notices; no storm. Only the delayed orphan push's latch is
   in memory, and its tag collapses a repeat on the phone.
8. **The coordinator is dead, absent, paused or limit-locked.** Dead or absent: r2 is skipped and r3 names the reclaim
   door (dead) or says there is no coordinator (absent). Paused: r2 is skipped and r3 names the pause, never the
   reclaim door. Limit-locked: r2 sits unacked, and r3 goes out 1 h later. A mail from a role sender gets no "blocked"
   push (`senderId` resolves to null), so r3 is the only escalation, by design.
9. **The worker acks and goes silent again.** The episode stays open; r2 and r3 each fire once; nothing repeats until the
   worker mails.
10. **A legit wait with no ball-passing mail.** At most one stall-check per episode; the body tells the worker how to
    hand the run to the coordinator.
11. **The monthly spend limit.** `FleetSession.limits` does not measure it (S1's worker hit one); it escalates as a
    stall at r3. §11 decision 6.
12. **Injection.** Bodies carry only server-computed facts and ids matching their patterns (§4.2), with `(unprintable)`
    for anything else; no transcript text, subject or task description. The hook clips `bgKinds`, `bgIds` and `err`
    before writing, and the reader answers `malformed` on anything else.
13. **Clock skew.** Fleet-box epoch ms against the server's `Date.now()`. Every stall threshold is 10 min or more except
    `RESTART_GRACE_MS` (5 min from the fleet-box `restartAt`), where skew shortens or lengthens the grace by its own size; the
    mail gate's 60 s / 15 s quiet from `stopAt` carries the same exposure `statusUpdatedAt` carries today.
14. **The markers.** No code writes `stall-watch-disabled`, `stall-watch-live`, `stall-watch-escalate`,
    `stall-watch-w2-live`, `mail-gate-strict`, `mail-gate-busy-shadow` or `mail-gate-busy`; a test pins that no source
    path writes them.

## 10. Measurement, targets, and sequencing

**Constants** (all in `stall.ts`, L1, except `STALL_SWEEP_MS` in `watch.ts` and `MAIL_TURN_HOLD_MS` beside
`MAIL_ARMED_HOLD_MS`; the PWA renders none):

| Constant | Value | Basis |
|---|---|---|
| `STALL_QUIET_MS` | 2 h | census replay; the 1–2 h band is almost all legit |
| `STALL_ESCALATE_MS`, `STALL_OPERATOR_MS` | 1 h, 1 h | coordinator reply latency, p90 1.56 h, 85% within 1 h |
| `STALL_BOUND_MS` | 3 h (§11 decision 7) | *chosen*: bounds every episode at r1 + 4 h |
| `LIMIT_HOLD_CAP_MS` | 12.5 h | the longest of 19 legit limit waits |
| `AUTO_CONTINUE_RECENT_MS` | 10 min | *chosen*: `MAIL_REPLAY_MS`'s cadence |
| `DELEGATE_WINDOW_MS`, `DELEGATE_CAP_MS` | 30 min, 4 h | longest foreground call 28.3 min; at 4 h subagent activity covered 1 of 101 gaps |
| `FROZEN_NO_EVENT_MS` | 60 min | more than 2 × the longest legit call |
| `DEAD_GRACE_MS` | 10 min | respawn measured at 9 s; 5 × `SUPERVISED_FRESH_MS` |
| `COORD_DEAF_MS` | 1 h | acks precede replies; 85% within 1 h |
| `COORD_BALL_CAP_MS` | 30 h (§11 decision 9) | above the 28.7 h legit maximum |
| `MAIL_STUCK_MS` | 1.2 h | p90 mail-to-first-read over 1,206 worker mails |
| `ORPHAN_D_IDLE_MS` | 15 min | 13 of 21 restarts self-healed within 2.4 min; earliest human pick-up 37 min |
| `ORPHAN_E_IDLE_MS`, `FAILED_IDLE_MS` | 10 min | *chosen* |
| `FAILED_REPEAT_MS` | 2 h | *chosen*: a second retry-class StopFailure inside it goes to the coordinator |
| `CHECK_UNDELIVERED_MS` | 2 h | *chosen*: §5.1 (c) |
| `RESTART_GRACE_MS` | 5 min | *chosen*: covers ccd's redrive after a mid-turn death |
| `BACKLOG_HORIZON_MS` | 24 h | *chosen*: first enable must not wake long-abandoned sessions |
| `ORPHAN_PUSH_MS`, `MARKER_UNREADABLE_MS` | 30 min, 1 h | *chosen* |
| `MAIL_TURN_HOLD_MS` | 60 s | *chosen* |
| `STALL_SWEEP_MS` | 60 s | `CLAIM_SWEEP_MS` precedent |

**Evaluation order** for a run worker is the spec: (1) run `unknown` or unnamed: hold; (2) wave 2's `marker-unreadable`
(a turn-marker read `unmeasured` or `malformed` for `MARKER_UNREADABLE_MS`, once per episode), then any unmeasured input,
the marker's `unmeasured` included: hold;
(3) lifecycle: hold, or wave 2's dead arm; (4) hold 2a, then 2b; (5) the limit hold, becoming `limit-cap` at its cap;
(6) wave 2's restart grace; (7) wave 2's frozen arm; (8) wave 2's `delegates` hold; (9) ball with the coordinator:
coord-deaf, the coord-ball cap, or none; (10) ball with the worker: the ladder. The D, E and failed arms are separate
pure verdicts over the marker and apply holds 1, 2 and the limit hold only; mail-stuck is evaluated per delivery.

**Shadow and targets.** Each shadow period is compared with the census: about 3.5 r1 fires and 0.4 orphan fires a day;
every shadow fire is hand-classified stall or legit against its transcript, which settles the census's circular
precision (strict 0.48, loose 0.69 at 2 h). The kill rules (proposed, not measured, §11 decision 12): if armed r1 fires
exceed 10 a day for two days, `rm stall-watch-live`; if more than half of a week's hand-classified r2 fires are
legitimate waits, `rm stall-watch-escalate`; then re-derive.

**Tests.** Every guard ships with the test that reds when it is deleted, measured before and after (mutation-table
discipline). The golden fixtures are the measured timestamps: S1–S4, Case D, run 129's shell-gated mail 2407, the 4.6 h
frozen Bash, a declared-idle legit wait, a hand-off, a rejected wave-done, two overlapping runs on one session. A
property test sets each unmeasured slot in turn (`unmeasured`, `statusUnmeasured`, a null pane pid, a null config dir,
the live-state read's `unmeasured` and `no-state`, lifecycle `unmeasurable`/`null`, a failed store read) and requires
`hold`; its slots exclude `limits`,
and one row pins that a null `limits` fires exactly as a measured 0 does. Fixture HOMEs only; the marker writer's tests
use `makeCcdHarness`.

**Order.**
- **Wave 1** — server only, about one to two days, tests about 60% of it. Ships with one server rollout.
- **Wave 2** — its first task is the payload capture (§5.1). Then the fleet box (the hook writes the marker; the
  reader tolerates its absence), then the server. The `busy` gate and every wave-2 arm go through their shadow markers
  before arming.
- **Wave 3** — skills through `ccrc update`'s `_inst_skills`; doctor's `skills` check green in every rostered home. The
  watch does not wait for it: r1 and r2 carry their own protocol (§11 decision 3).
- **Optional** — `RunHealth.stallNoticedAt` (a stored timestamp, never an age) and a `stalled since HH:MM` run warning.

Deviation numbers are minted at run-open (`POST /api/ledger/deviations`); this spec defines none.

**Relations.** No wave here depends on the landing-order waves or on continuity waves 1–2, but they edit the same files.
- **Skills and pins.** Landing-order and continuity add coordinator and worker clauses too, so §6's clauses take the
  next free numbers, and whichever programme lands second moves the count words and pins in the same commit.
- **`session-hook.sh`.** Continuity stage 3's launch record (PostToolUse, subagent rows dropped by `agent_id`) and its
  manifest subject (SessionStart), and landing-order's PreToolUse deny, edit the same surfaces. Wave 2 and continuity
  stage 3 share ONE payload-parse program emitting `agent_id`; whichever lands second rebases onto it.
- **The in-flight manifest.** When continuity's `$REG/<id>.inflight` exists, the orphan mail lists its validated ids;
  the marker's `lostBg` stays the trigger.
- **The mail-subject read.** Landing-order wave 2's `hasMailWithSubject` is the every-state read that §5.2's run-less
  dedupe needs. It has one definition, added by whichever programme lands first.
- **The rescue path.** Continuity wave 2 rewrites it. The stall lane's limit hold reads the same `limits` fields and
  must not act on a rescue it cannot see; it holds, capped at 12.5 h.
- **Workspace lifecycle stage 4** abandons a dead coordinator's programme at first-dead + 1 h under a stricter
  crash-only rule. This lane reports a dead worker and reports, but never acts on, a dead coordinator; it closes nothing
  and does not claim that lane's verdict.

## 11. Decisions for the operator

**Ruled 2026-09-29 11:58 UTC: "design looks good".** Every recommendation below is approved as written. Two items had
only a leaning, and each takes it; the operator can reverse either:
- item 8 takes the cap: one `⚠ stalled › <workspace> (dialog)` operator push per episode after 2 h under hold 2b, arm
  `dialog-cap`, keyed and recorded as `limit-cap` is. It is wave 1 scope.
- item 10 excludes a deliberate stop from the dead arm's push if ccd leaves a record that tells it apart. That is
  wave 2's to measure; wave 1 holds on every dead word.
Where item 14's first two tickets are filed is still open.

1. **No blocking Stop hook** (§2). The coordinator proposed one; the census says it fires 17–36 times a day, misses
   11–13 of the 36 turn-end stalls and all 13 mid-turn ones (about half of the 49), and has no backstop. Confirm.
2. **Who hears first, and when coordination is paused.** Recommended: the worker at 2 h, the coordinator at 3 h, the
   phone at 4 h (wave 1's ladder; with the wave-2 marker r2 fires on proof, at the latest r1 + `STALL_BOUND_MS`, so the
   phone hears at the latest at 6 h, §5.1). A paused coordinator is skipped and the phone is told at 3 h, naming the
   pause. The coordinator asked to be mailed; an FYI copy on every r1 costs about 3.5 more coordinator turns a day
   (~10 M tokens).
3. **Arming.** Recommended: `stall-watch-live` touched at deploy (r1 only mails the worker and never pushes), and
   `stall-watch-escalate` after 48 h of shadow. A 7-day shadow would give up about 190–370 stall-hours at the census
   rate. The safety judge forbade arming before the clauses reach every home; this spec departs from that because r1
   and r2 carry their own protocol. Confirm the departure.
4. **Orphan wakes on non-run sessions** (Case D, `soft-basin`). Recommended: the D shape on any session within a 24 h
   horizon, at 15 min; the E shape only on run workers and coordinators.
5. **`shell` delivery on by default** (§4.1), with `mail-gate-strict` as the way back. An alternative is a width gate:
   deliver on `shell` only on a pane measured at `READER_MIN_COLS` or wider. Its cost: S3's fix does not apply on
   narrow or unmeasured panes.
6. **The monthly spend limit** escalates as a stall (§9.11). Accept, or add a measure first.
7. **The escalation bound** (§5.1 (d)). Recommended: 3 h after r1, which bounds every episode at r1 + 4 h and costs r2
   turns on legit wake-bearing waits. The alternative, 24 h of silence, is cheaper and leaves a day unbounded.
8. **Cap on a dialog with no ask** (hold 2b). Options: none (as written), or after 2 h one `⚠ stalled › <workspace>
   (dialog)` operator push per episode, with no worker or coordinator mail since neither can land on `waiting`. The
   census has 2 consent stalls (5.8 h and 2.8 h) and no measurement that a second push would have ended either.
9. **A cap on the coordinator's ball.** Recommended: one `⚠ waiting` push after 30 h with no mail on the run. Without
   it, a worker's `re stall-check: waiting` or a coordinator's `wait:` silences the watch for good.
10. **A deliberate `stopped` and the dead arm.** Should a worker stopped by `ws-archive` or `ccd stop` be excluded from
    the dead arm's push?
11. **A doctor probe for `shell`.** Whether wave 2 adds a doctor check that greps each installed lane binary for the
    idle-derived `shell` relabel, and treats a lane without it as `busy`. Seven installed lanes (2.1.277–2.1.284; 2.1.279 is not installed) shipped in about
    four weeks.
12. **The kill rules and the shadow periods** (§10, §5.1), as proposed: 48 h for the escalations, the `busy` gate and
    the wave-2 arms.
13. **Clause texts** in §6.1 and §6.2.
    **Amended 2026-10-04:** the operator approved one amendment to §6.1's clause (ledger R2 and R17 F1): it sends
    `wait:` past a stall mail, and states the ball as §4.2 reads it. §6.1 carries the amended text. The 2026-09-29
    approval of §6.2's text stands unchanged.
14. **Side findings for separate tickets:** `runs signals` reports swaps 0 despite a swap; on 09-17 one session's pane
    stopped and unsupervised another session's unit during a rolling relaunch; the S4 queue defect for upstream.

## 12. Review resolutions (rev 2 and rev 3)

Where two findings prescribed different fixes, this is the choice made:
- **The marker's name.** `.turn` (one dot) with an accepted check-then-act residue, or `.turn.json` (two dots) with a
  line-neutral `_reg_purge` edit. Chosen: `.turn.json`, because containment by construction beats a documented race; it
  costs a `ccd/ccd` restamp.
- **Arming markers.** One marker, an r1-only marker, or a live/escalate pair. Chosen: `stall-watch-live` for the
  session's own notices and `stall-watch-escalate` for coordinator and operator ones, plus `stall-watch-w2-live` for
  wave 2's arms, so the recommended split and the kill rules can both be expressed.
- **A paused coordinator.** Hold r2 and r3 until the pause lifts, or skip r2 and tell the operator. Chosen: skip r2 and
  push at r1 + 1 h naming the pause, because a fleet-wide pause must not silence every stall; §11 decision 2 confirms.
- **Unrecognised StopFailure tokens.** Coordinator at once, or hold. Chosen: hold plus a log line, with wave 1's ladder
  as the backstop, because a guess from an unknown word is exactly what the injection rule forbids.
- **Ids in the orphan mail.** Counts and kinds only, or clipped task ids. Chosen: `bgIds`/`lostIds` clipped to
  `^[A-Za-z0-9_-]{1,64}$`, at most 8, because a count-only notice gives the woken session nothing to act on.
- **Session crons in the marker.** A new hold, or not read. Chosen: not read.
- **What a coordinator `wait:` does to an open episode.** Keep the episode open with the ball moved, or close it.
  Chosen: close it. With the episode kept open, a second silence after the ball returns reuses the spent rungs' key and
  draws no r1.
- **The delayed `⚠ orphaned` push.** A second durable mail row (`orphaned-unanswered:`), or an in-memory latch with a
  collapsing tag. Chosen: the latch. A restart inside the 30 min window may push once more, and the tag collapses the
  two (§9.7); a second mail row would type into the session again.
- **A Monitor in clause 16.** A Monitor with a timeout as a wake, or not a wake. Chosen: not a wake, because a shell
  Monitor is a `local_bash` task (§3.1) and S4's was armed by a subagent. The clause says "A background shell or Monitor
  is never that wake".
- **StopFailure request errors.** Leave them to wave 1's ladder, or a coordinator mail and push at 10 min. Chosen: the
  coordinator at 10 min, because a self-wake re-fails the same way.
- **The push classifier's home and kind.** `rundefs.ts` with kind `mail`, or `stall.ts` with kind `run` for run arms.
  Chosen: `stall.ts`, pure, with its store facts passed in, and `run` (`mail` only for a run-less orphan), so every
  stall literal is spelled in one module.
- **`HookState.interrupted`.** Retire it, or keep it as an always-false field. Chosen: keep it, so no reader narrows.
