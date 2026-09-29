# Worker stall watch — the server notices a silent session, delivers mail past background work, and escalates — design

**Status:** draft for the operator, 2026-09-29. Nothing here is approved or planned yet. §11 lists the decisions
owed.
- **Citations** were mapped read-only at `48af1426` and spot-checked at `af5a29f8`. Line numbers are hints; each
  citation names its function or constant, so the text can be found after `main` moves.
- **Measurements** come from two read-only workflows on the fleet box, `wf_d1aa4db3-c58` (8 agents: forensics,
  fleet census, two mechanism maps, each refuter-checked) and `wf_a4d11fd0-513` (8 agents: two binary/transcript
  measurers, three competing designs, three lens judges). Every number below comes from one of them; none is
  estimated here.

**Date:** 2026-09-29 · **Branch:** `ws/stall-prevention-with-worker-stop-hook` (from `origin/main` `af5a29f8`)
**Related:**
- `2026-09-23-session-continuity-design.md`. Its §5 "Not-stalled restarts … nothing types" is amended by wave 3
  (§6.3). Its stage-3 in-flight manifest, once shipped, can replace this spec's restart-orphan signal.
- `2026-09-24-workspace-lifecycle-design.md` §5.4, the dead-coordinator lane. This spec watches WORKERS and never
  closes a run; that lane owns a dead coordinator.
- `2026-08-17-working-detection-defect-family-design.md` (D-75, D-76). This spec keeps D-76's refusal of `waiting`
  at the mail gate and corrects that spec's reading of `shell` (§3.1).

## 1. The problem, measured

**The ask.** On 2026-09-28 the MekWarLive programme coordinator reported: "Stall prevention is still missing, and
it's the most urgent. The only stop hook on this machine is the fleet's session-state recorder; nothing checks that a
report mail went out. The worker has gone silent for days three times this wave. The fix is either a stop hook in the
worker's workspace that refuses to end a turn when no mail was sent that turn, or a ccrc watchdog that mails me when a
working session sits idle for hours."

**Run 67 (battlescape-operational wave 9/9, worker `MekWarLive-swift-harbor`) — four silences, all UTC.**

| # | Began | Ran | How it began | What prolonged it | What ended it |
|---|---|---|---|---|---|
| S1 | 09-16 20:00:04 | 71.4 h | turn ended mid-Task-3, pane summary, no mail | both lanes then limit-locked | operator typed "Resume" |
| S2 | 09-19 21:13:35 | 157.5 h | turn ended mid-fix-round, "then the mail carrying F9's SHA…", no mail — one hour after the worker mailed "I am not ending a turn without one again" | nothing woke either side | operator asked the coordinator "where are we?" |
| S3 | 09-26 13:03:15 | 48.9 h | turn ended after a push, no mail | coordinator mails 2443/2445 gated `not-idle` for 2 days: an orphaned background wait loop (a `pgrep -f` self-match) held the live status at `shell` | the memory-pressure reaper killed the loop; its task-notification woke the worker |
| S4 | 09-28 21:52:51 | 8.3 h | turn ended on "The implementer is still running: it's waiting on `typecheck`", no mail | the notice it waited for was queued under a finished subagent's id and never drained (§3.2) | this spec's author mailed the coordinator by hand (mail 2524, 06:14) |

On 09-28 between 14:02 and about 19:40, five coordinator rulings (2448, 2450, 2458, 2463, 2464, one a D-number
correction) also sat `queued`, gate `not-idle`, while the worker kept working: its background subagents held the live
status at `busy` between its own turns. Its `gateCount` of 1,526 was read by both parties as "1,500 delivery
attempts"; `gateCount` counts gate hits, and `attempts` was 0.

**Case D — the design session itself, 09-28.** This spec's own session ended a turn at 16:12:59 to wait for a
background design workflow. At 16:20:14 the kernel OOM killer hit its pane scope. The scope peaked at 4.3 G against its
own 12 G cap, so the trigger was the shared `app-claude-session.slice` (MemoryMax 24 G, `oom_kill` 79, six pane
OOM kills that day). `OOMPolicy=stop` took the pane down, and ccd respawned it with `--resume` at 16:20:29. The workflow's
agents ran inside the killed process. Claude Code wrote the loss as a task-notification with `shouldQuery:false`,
which starts no turn. ccd's redrive logged `redrive-skip … not-stalled` at the 20:13 and 22:51 swaps. Nothing else
watches a session that is not a run worker, so it sat idle 13.8 h until the operator typed "Progress?". The same
shape was live on `ccrc-pwa-soft-basin` (idle 16.9 h after a 14:04 restart with two orphaned workflows).

**The fleet census** (143 runs dispatched 09-01..09-28: 74 work, 69 review; worker activity = assistant output and
tool results, deduplicated across carried transcript copies):

| Worker-activity gaps while a run was active | ≥1 h | ≥2 h | ≥4 h | ≥8 h | ≥24 h |
|---|---|---|---|---|---|
| gaps | 221 | 145 | 101 | 66 | 18 |
| hours | 2,149 | 2,047 | 1,918 | 1,724 | 1,063 |

Of the 145 gaps of 2 h or more, work runs hold 140. By cause:

| Cause | Gaps / hours | Stall or legit |
|---|---|---|
| waiting on the coordinator | 56 / 1,020 | 23 hand-offs and 15 declared-idle legit; 18 ambiguous, the heavy tail all MekWarLive and called stalls in that coordinator's own mail |
| usage limit or swap | 26 / 142 | 19 limit waits legit; 5 post-swap idle and 2 Fable-consent blocks are stalls |
| ended turn, other | 21 / 374 | all stalls |
| background task | 17 / 180 | 6 confirmed legit, 10 unconfirmed, 1 never returned |
| mail undelivered | 7 / 167 | stalls; 3 with `lastError` registry-unmeasurable, up to 84.2 h (run 129) |
| ended turn waiting on CI | 6 / 101 | stalls |
| AskUserQuestion pending | 5 / 18 | legit |
| API error aborted the turn | 5 / 36 | stalls; Claude Code fires StopFailure, not Stop |
| frozen mid-turn | 1 / 4.6 | stall |

Strict stalls of 2 h or more ran a median 6.7 h (p90 45 h, max 84 h; the loose view reaches 161.7 h, run 31). They
ended by a mail nudge 21 times, an operator 9, a task-notification 7, run close 4, a restart 2 (attribution
approximate: a verifier found one "mail" ending that an operator prompt preceded).

## 2. What was asked, and what this spec does instead

The coordinator offered two fixes. This spec builds the second, widened, and does not build the first.

**A blocking Stop hook is not built.** Replaying the census against every variant:
- "No mail this turn" fires on 79% of 3,478 worker turn-ends inside active runs. 2,199 of the 2,758 no-mail
  turn-ends had background work outstanding: workers orchestrate through subagents, and a turn that ends while an
  Agent runs is the normal shape.
- The tightest variant (no background task, no AskUserQuestion, not operator-opened, last mail not an outbound
  hand-off, no idle declaration) still fires 36 times a day, and 87% of those fires are followed by activity within
  30 minutes anyway. It catches 23-25 of the 36 strict stalls that begin at a clean turn-end.
- It cannot see the 13 strict stalls that begin mid-turn: post-swap idle, API-error aborts (StopFailure), the consent
  gate, a frozen tool. It cannot see Case D (no turn runs, so no Stop fires) or undelivered mail.
- It has no backstop. It blocks once per turn (`stop_hook_active` is sticky per query), so a model that ends the turn
  again, or satisfies it with a status mail, stalls unbounded. S2 began an hour after the worker promised compliance.
- Its remedy is a mail that wakes the coordinator, at a measured p50 of 2.9 M tokens per coordinator mail turn. At
  36 bounces a day that cost scales with activity, not with stalls.
- It breaks `ccd/session-hook.sh`'s pinned contract (the THREE ENVELOPES comment; `session-hook.test.ts` "prints
  NOTHING on every other event", which includes Stop; "waits on nothing"). The Stop path's latency tail is the
  environment, not the script: a 432 s Stop on 2026-08-15 was the pane scope being reclaim-throttled, and any
  synchronous check added there inherits it.

**A server watch is built, and widened three ways.** The coordinator asked for "a watchdog that mails me when a
working session sits idle for hours". The measurements add three things it did not name:
1. **Delivery.** Two of the four silences, and the live five-ruling pile-up, were mail that could not land. The gate
   is fixed first (§4.1, §5.1).
2. **Sessions, not only runs.** Case D had no run. A restart that finds in-flight work dead is an unsatisfiable wait
   on any session (§5.2).
3. **The worker first.** The first rung mails the stalled worker itself, which is what ended 21 of the census stalls;
   the coordinator is told one hour later, and the operator one hour after that (§4.2).

## 3. The mechanics this design rests on (binary-confirmed or measured)

### 3.1 Claude Code's live status

`<configDir>/sessions/<pid>.json`'s `status` is computed the same way in every installed version (2.1.277–2.1.284):
- `waiting` when a dialog or elicitation needs a human. A background subagent's permission prompt raises it too.
- else `busy` when the main query runs **or** any `local_agent`, `remote_agent`, `in_process_teammate` or
  `local_workflow` task is not terminal (`delegatedActive`);
- else `idle`, relabelled `shell` when any `local_bash` task runs. A shell Monitor is a `local_bash` task. Cron and
  ScheduleWakeup are not tasks.

So **`shell` only ever comes from an idle main loop.** `busy` is ambiguous: a turn in flight, or a main loop idling
over background agents. The file is rewritten only on a change, so `statusUpdatedAt` is the time of the last change,
not of the last turn end. `server/src/livestate.ts`'s docstring, "a Bash tool command is running", is wrong, and so
was the 2026-08-17 spec's reading of `shell` as a wedge.

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
  subagent reports to that subagent. If the subagent has finished, nobody drains it. That is S4: the implementer's
  Monitor `b989ocn62` expired at 21:56:31, was queued under the implementer's id, and sat there. A 3-day census found
  58 such notices never drained, and 11 idle episodes of 10 minutes or more plus 3 still open (up to 122 h) in 7 days.

A background agent resumed with SendMessage does emit its completion, with a note that it "may resume on its own"
while its own children run. In S4 that promised resume never happened.

### 3.3 The hook file is shared with subagents

Hooks run in the parent process, and `session-hook.sh` picks the file by the pane's tmux session name. Every
subagent's and Workflow agent's PreToolUse/PostToolUse writes `working` and a fresh `updatedAt` into the parent's
`hookstate.json`, milliseconds after the main Stop wrote `done`. The payload carries `agent_id` in a subagent context;
the script never reads it. The file is a last-writer-wins read-modify-write with no lock, so its counters also lose
updates, and `subagents[]` never shrinks (swift-harbor lists 12 names back to August).

### 3.4 No existing signal separates a stall from a wait

At +2 h into each of S1–S4 and Case D, every candidate signal read 1.9–2.7 h old, which is also what a legitimate wait
reads. Hook `updatedAt`, transcript mtime and `statusUpdatedAt` are restamped by plumbing inside a silence (respawn,
swap, ccd auto-compact, harness bookkeeping lines); only the worker's own mail and acks are immune, and they go stale
in every legitimate wait. So the watch keeps **its own episode, keyed on the worker's mail**, and classifies silence
by **whose turn it is on the run** (§4.2).

## 4. Wave 1 — server only

No hook, ccd, skill, route, migration or wire change. The fleet box is untouched.

### 4.1 The mail gate delivers on `shell`

**Where:** a new L1 predicate `mailTurnIdle(live, now, quietMs)` in `server/src/turnidle.ts` (imports L0 types
only), called from `sweepMail`'s `not-idle` and `not-quiet` gates in `server/src/watch.ts` (~3483–3495).

- `idle`: today's rule, quiet measured from `statusUpdatedAt`.
- `shell`: deliverable, quiet from `statusUpdatedAt` (`MAIL_QUIET_MS` 60 s, `COORD_QUIET_MS` 15 s, unchanged).
- `busy`, `waiting`, `''` and any unknown word: `not-idle`, as today. `waiting` stays refused under every mode
  (D-76).
- `liveSessionStatus` (`livestate.ts` ~52) and its collapse pin are **not** changed; the PWA and the per-session
  socket read it. Only its docstring is corrected.

**Pane guard.** On the `shell` branch, `sendPrompt` gains `refuseIfTurnRunning`: refuse when the last 8 captured rows
match `pane/dialog.ts`'s `BUSY_RE` (`esc to interrupt`). It guards against a future Claude Code build drifting from
§3.1. The refusal is a **new `SendResult` member handled like `auto-continue-armed`**: a non-counting back-off.
Falling through to the attempts ceiling would park the mail as `undeliverable` after `MAIL_MAX_ATTEMPTS` (6).

**Kill switch.** A hand-touched `$REG/mail-gate-strict`, read from the listing `sweepMail` already takes (the
`mail-disabled` precedent, fail-shut on an unlistable registry), restores the affirmative-`idle` rule. No code writes it.

**Effect.** S3's mails 2443/2445 land about a minute after the turn ended, not 48.9 h later.

### 4.2 The run-worker stall lane

**Where:** pure L1 `server/src/coord/stall.ts` (the claim-lease shape, `claims.ts`'s `claimExpiry`; the coord-ring
scan in `single-definition.test.ts` already forbids it `./db.js` and `node:sqlite`), and an L4 lane `sweepStalls` in
`watch.ts` beside `renewClaims`/`lapseClaims`, on its own 60 s clock (`CLAIM_SWEEP_MS`), gated on `primed`, skipped
with no coord store, after `assembleFleet` so it sees this tick's `FleetSession` rows. The lane applies the verdict and
decides nothing.

**Candidates.** Runs in `ACTIVE_RUN_STATES` with a `sessionId`, work and review kinds. The SQL list is derived from
the constant (the `INACTIVE_RUN_STATES_SQL` idiom), never hand-listed; a run in `unknown` is a hold.

**Whose turn it is (the ball).** From the newest mail on the run between the worker and anyone except the watch:
- **The coordinator's** when that mail is the worker's kind `question`, its subject begins `WAVE_DONE_SUBJECT` or
  `review-done` (a new exported `REVIEW_DONE_SUBJECT` beside it), or the coordinator's subject begins `wait:`.
- **The worker's** otherwise, including after the worker's own `status` mail. This is what catches "status mail, then
  silence": run 31's 161.7 h, runs 87/88's 40 h. A rule keyed only on "newest mail is inbound" misses those until 24 h.
- The census replay: "ball with the worker" plus the holds below fires rung 1 on 47 of the 53 stalls of 2 h or more.
  Declared-idle waits with an inbound ruling as the newest mail are its weak spot; a `question` or `wait:` mail closes
  them, and the rung-1 body says so.

**Quiet, without a fleet marker (wave 1).** The worker's live status reads `idle` or `shell`, and quiet = now −
max(`statusUpdatedAt`, the worker's last mail on the run, `dispatchedAt`). A worker at `busy` is not judged in wave 1:
it cannot yet be told apart from a turn in flight (wave 2).

**Holds** (each is `hold`, never `none` and never `notify`):
1. any input unmeasured (`FleetSession.unmeasured`, `statusUnmeasured`, a failed store read);
2. `dialogPending`, live `waiting`, a fresh hookstate `ask`, or an asks row `held`/`answering`;
3. measured 5 h or 7 d usage at or above 100, `stranded`, `swapBlocked`, or a delivery gated `auto-continue-armed`
   within 10 min. A limit hold is capped at 12.5 h (the longest of 19 legit limit waits); past it, one `limit-cap`
   operator push;
4. lifecycle not `running` (wave 2's dead arm owns it);
5. `$REG/coordinator-paused` present, for the coordinator rung only.

**Background work is never an exemption.** S3's live `shell` was an orphaned wait loop; S4's outstanding Monitor
reported to nobody. An exemption would have lost 9–17 census stalls.

**The ladder** (per episode; an episode opens at the first rung-1 notice newer than the worker's last mail on the run,
and closes when the worker mails):
- **r1 at 2 h** — a stall-check mail from `operator` to the worker, recorded but **not pushed**.
- **r2 at r1 + 1 h** with no worker mail on the run since r1 — a `stall:` mail from `operator` to
  `resolveCoordinator(run)`, pushed with a distinct `⚠ stall › <worker workspace>` title. A dead, absent or paused
  coordinator skips to r3 and the push names `POST /api/runs/:id/reclaim`.
- **r3 at r2 + 1 h** with still no worker mail — one operator push `⚠ stalled › <worker workspace>`, once per episode.

Thresholds come from the census replay: at 2 h, 97 rung-1 fires in 27.6 days (3.5 a day), 47 of 53 stalls; below 2 h
the 1–2 h band is almost all legitimate (background 27, coordinator 26, limit 12, about 10 stalls); 3 h saves 0.4
fires a day and loses 5 stalls. The +1 h rungs follow coordinator reply latency (792 replies: p50 8 min, p90 1.56 h,
85% within 1 h).

**The r1 body** carries its own protocol, so no skill must be installed first. Measured facts only, ids matching
`^[A-Za-z0-9_-]+$`, never transcript text. For S4 it would read:

> stall-check from the ccrc stall watch (server), run 67 — battlescape-operational wave 9/9.
> Your main loop has been idle since 2026-09-28T21:56:31Z (2h 0m). Your last mail on this run: #2509 status at
> 21:17:43Z. Newest mail to you on this run: #2510 answer at 21:19:17Z (acked).
> Background work you ended your turn to wait for may have finished or died without a notice that can wake you: a task
> a subagent started reports to that subagent, and a background shell has no deadline.
> Before anything else, send ONE mail on run 67 to toId 'coordinator', subject starting "re stall-check:":
> still working — kind status, what you are doing and when you report next; waiting on the coordinator — kind question,
> what you wait for (this stops these checks); blocked — kind question, the blocker.
> No mail from you on run 67 by 00:56Z: the coordinator is told. By 01:56Z: the operator.

The reply is the report the worker owed, so the coordinator turn it costs is the one the protocol always meant to
spend. `pushNewMail` records the `re stall-check:` reply without pushing it.

**Durable dedupe, no migration.** A new store writer `queueStallNotice(run, notice)` does, in one transaction, the
dedupe check against a `run_events` observation row with the same detail (`stall:<arm>:<rung>:<episodeKeyMs>`),
writes that row (`pushNewRuns` already skips `fromState === toState`), and inserts the mail through the body of
`queueSystemMail` extracted as `insertSystemMailTx`. It returns
`{queued:true, mailId, deliveryId} | {queued:false, why:'duplicate'|'run-gone'}` — not `void` (the open writer
defect class on `main`). A restart or deploy therefore cannot re-send a rung. `queueSystemMail`'s docstring, which
enumerates its callers, gains the new one.

**Spelled once.** The prefixes `stall-check:`, `stall:`, `re stall-check:` and `wait:` and the observation-detail
pair `stallDetail`/`parseStallDetail` live in `stall.ts`/`rundefs.ts` beside `askNudgeSubject`/`isAskNudgeMail`;
`single-definition.test.ts` reds on a second literal. `SYSTEM_MAIL_SENDER_MAP`'s gloss for `operator` names the watch.

**Markers** (none has a writer in the tree; read from one registry listing; an unlistable registry fails shut):
- `$REG/stall-watch-disabled` — the lane returns.
- `$REG/stall-watch-live` absent — **shadow**: `stall-shadow:*` observation rows and one
  `console.warn('ccrc-server: stall-watch shadow …')` per fire, nothing sent. §11 decision 3 asks whether r1 ships
  armed.

**Effect on the recorded silences** (lane ≤ 60 s, mail sweep ≤ 10 s):

| Silence | Rung 1 lands | Instead of | Escalation if the worker stays silent |
|---|---|---|---|
| S1 | 09-16 ~22:01 | 71.4 h (operator) | coordinator ~23:01, operator ~00:01; if the lane is already limit-held, the 12.5 h cap pushes the operator 09-17 ~08:30, about 59 h before the operator's own "Resume" |
| S2 | 09-19 ~23:14 | 157.5 h (operator) | coordinator ~00:14, operator ~01:14 |
| S3 | the gate delivers 2443/2445 ~13:04:15 | 48.9 h | — |
| S4 | 09-28 ~23:57 | 8.3 h (by hand) | wave 2 moves it to ~22:07 (§5.2) |
| run 31 | at 2 h | 161.7 h | — |

**Residual after wave 1:** a worker held at `busy` by background agents (the live five-ruling state), restart
orphans (Case D), API-error aborts, frozen and dead workers, and registry-unmeasurable mail. Wave 2 closes them.

## 5. Wave 2 — a main-thread marker on the fleet box, and the arms it enables

### 5.1 The marker and the `busy` arm

**Writer** (`ccd/session-hook.sh`; its header contract holds: exit 0, no network, no lock on the hot path, prints
nothing on Stop). The one `jq` call at the payload parse (~2767) becomes one program emitting `hook_event_name`,
`session_id` and `agent_id`, so the fork count does not change. A helper `_hook_turn_mark` writes one JSON line with
`printf` and tmp+`mv` to `$REG/<id>.turn`:

`{v:1, sessionId, state:'working'|'done'|'failed', event, at, turnAt, stopAt, bg, crons, bgKinds, err, restartAt, lostBg}`

- A payload with a non-empty top-level `agent_id` never touches the marker. Only main-thread events write it, and
  they run in sequence, so the shared file's lost-update race cannot happen here.
- The first main event after `done`/`failed` (UserPromptSubmit, or a main Pre/PostToolUse) writes `working`,
  `turnAt`, `lostBg 0`. Later main tool events while already `working` do not write: a builtin `read`, no fork.
- **Stop:** `done`, `stopAt`; `bg`/`crons` are the lengths of the payload's `background_tasks`/`session_crons`, or
  **−1 when the field is absent (unmeasured, never 0)**; `bgKinds` the display aliases clipped to `^[a-z_ :,-]+$` and
  200 bytes. It replaces today's `.is_interrupt` fork; `is_interrupt` is not on any installed version's Stop payload
  and is dropped.
- **StopFailure** (added to `install-session-hooks.sh`'s `EVENTS_JSON`; present in the oldest lane, 2.1.277):
  `failed`, `err` clipped the same way. It prints nothing and leaves `hookstate.json` alone.
- **SessionStart** `startup`/`resume`: `done`, `restartAt`, `bg 0`; when the previous line was `done` for the same
  `sessionId`, `lostBg = prev.lostBg + max(prev.bg, 0)` — the old process's tasks died with it. `clear`: a fresh line.
  `compact`: untouched (a compact SessionStart fires mid-turn; D-306's rule).
- **Name and liveness.** `.turn` has one dot, so `_reg_purge`'s suffix loop removes it with its row (a `.turn.json`
  name would hit the two-dot skip at `ccd/ccd` ~3786). A dot-free name counts toward `_ws_slug_free`, so the write is
  guarded on `-e $REG/$id.generation` (the D-2605 discipline at `session-hook.sh` ~1184); a late hook write after a
  purge cannot recreate a slug-holding residue. `ccd/ccd` itself is not edited.

**Reader** `readTurnMarkMeasured` (L3, `server/src/turnmark.ts`) returns the mark or one of five reasons, never
folded: `absent` (proven ENOENT; an older fleet build), `unmeasured` (the read failed), `malformed`, `foreign`
(`sessionId` ≠ registry uuid), `stale` (`at` and `restartAt` older than the live process's `startedAt`, which the live
reader gains as an additive field). There is no freshness window: the marker changes only on main events, so a
days-old `done` is still true. `absent`/`foreign`/`stale` take the wave-1 path; `unmeasured`/`malformed` never deliver
on `busy` and make the stall lane hold.

**`busy` delivery.** `mailTurnIdle` gains the marker: `busy` is deliverable when the marker is measured, current and
`done` or `failed`; quiet is measured from `stopAt` (never `statusUpdatedAt`, which does not move at a turn end under
`busy`). `shell` also refuses when a current marker says `working`. It arrives in two steps behind hand-touched
markers: `$REG/mail-gate-busy-shadow` logs "would deliver" for a measured period; `$REG/mail-gate-busy` arms it. The
five live rulings of 09-28 would have landed at 14:34 and 14:51, the worker's next Stops.

**Quiet with the marker.** The stall lane's clock becomes `stopAt`, maxed with the worker's last mail and
`dispatchedAt`, so respawns and swaps no longer reset it, and `busy` workers are judged too. A `delegates` hold covers
a main loop idle over genuinely active subagents: raw hookstate `updatedAt` within 30 min (the longest foreground call
measured was 28.3 min), capped at 4 h of main silence (at 4 h, subagent activity covered 1 of 101 gaps).

### 5.2 The arms the marker enables

| Arm | Who | Fires when | Rung | Basis |
|---|---|---|---|---|
| **orphan (D)** | any session | marker `done`, `lostBg > 0`, `restartAt > stopAt`, no main event since, live `idle` for 15 min, episode began within 24 h | a mail to the session itself | 21 orphaned restarts: all 13 self-heals within 2.4 min; 8 waited 15 min or more (0.4 a day) |
| **orphan (E)** | run workers and coordinators | a wake-bearing kind at the Stop (`subagent`, `workflow`, `shell`), `statusUpdatedAt ≥ stopAt`, live `idle` 10 min, no main event since | a mail to the session itself | S4 at ~22:07 instead of 23:57; operator-interactive sessions excluded (their E-rate is ~2.8 a day) |
| **failed** | run workers and coordinators | marker `failed` for 10 min, live idle, `err` in `server_error`/`overloaded`/unknown | self; a second within 2 h → coordinator | 5 census stalls, 36 h (run 40: 19 h after "Connection refused") |
| **failed (limit)** | — | `err` is `rate_limit`/`billing`/`authentication` | hold | the limit and swap machinery owns them |
| **frozen** | run workers | marker `working`, live `busy`, no hook event of any kind for 60 min | coordinator + push `⚠ frozen` | longest legit call 28.3 min; the 08-27 memory.high freeze (18 h 51 m) and a 4.6 h Bash |
| **dead** | run workers | lifecycle dead 10 min | coordinator + push | respawn measured at 9 s |
| **coordinator deaf** | run coordinators | the worker's `question`, wave-done or review-done to the coordinator unacked 1 h | push `⚠ coordinator deaf` | acks precede replies; 85% of 792 coordinator replies came within 1 h |
| **mail stuck** | run participants | a delivery on the run undelivered 1.2 h after its recipient's main loop went idle, or carrying a non-gate `lastError` | push, once per deliveryId | p90 mail-to-first-read 1.22 h over 1,206 worker mails; run 129's 84.2 h registry-unmeasurable |

**Escalation on proof** replaces wave 1's clock where the marker allows it: r2 fires when the worker's first Stop after
a delivered stall-check shows no wake-bearing background task and no worker mail since the check, or when the check
is still undelivered 2 h after it was queued. Wave 1's r1 + 1 h rule stays as the fallback when the marker is absent.

**The orphan mail** names only ids: "orphaned: workflow `<runId>` did not survive the `<hh:mm>`Z restart", listing
each stopped item (`<task id>`, kind, run id) and one instruction: report what was lost to whoever you owe a report,
and resume a workflow only when that is cheap — never relaunch an expensive or Fable-heavy workflow by default. It is
recorded, and pushed as `⚠ orphaned` only if still unanswered 30 min later. The orphan pass reads the marker, never
the transcript.

### 5.3 What stays out of the hook and the pane

- Nothing but the server mail lane types into a pane. ccd's redrive is not extended: a second typing actor into
  operator-interactive panes is refused, and the mail lane already has the draft, menu, auto-continue and new
  turn-running guards.
- Nothing in the hook waits, locks, prints on Stop, or reads a transcript.

## 6. Wave 3 — skills, docs, the continuity amendment

### 6.1 Coordinator clause 15 (pinned)

Proposed text, for the operator to rule on:

> 15. A mail from `operator` whose subject begins `stall:` is the server's stall watch reporting your worker, not the
> worker itself; it wakes you, and answering it is not polling. Ack it, re-measure the run and the worker's last mail,
> then act once: mail the worker a resume that names its last mail and what it owes; or, if the silence is yours
> because you told it to wait, mail it a subject beginning `wait:` that names what it waits for, which the watch reads
> as the run waiting on you until your next mail; or, if the worker is dead or cannot be woken, re-dispatch a dead
> one as 'When something is wrong' says and say which in this turn's text for the operator. A stall mail never
> licenses re-dispatching a live worker.

Pin impact: `coordinator-skill.test.ts`'s verbatim array and every "fourteen" become fifteen (SKILL.md's count word,
CLAUDE.md, README.md); a new row pins that the quoted `stall:`/`wait:` equal the exported constants; inserting after
the current clause 14 shifts every later cited SKILL.md line, and the citation sweep re-proves each in the same commit.

### 6.2 Worker clause 16 (pinned)

> 16. End a turn only on a wake you can name: a mail you sent that asks for an answer, a background task you launched
> from your main thread yourself, or a structured ask. A task a subagent started reports to that subagent, a
> background shell has no deadline, and a restart kills every background task. When none of those holds, mail the
> coordinator what you did and what wakes you next before the turn ends.

It must not name a background Bash as a sufficient wake (S3). `worker-skill.test.ts`'s count word becomes sixteen.
Until `_inst_skills` has run in every home, coordinators may repeat its first sentence in briefs (the
branch-discipline precedent). The watch does not depend on either clause: the stall-check body carries its protocol.

### 6.3 Docs

- `2026-09-23-session-continuity-design.md` §5 "Not-stalled restarts": "… and nothing types" becomes "… and nothing
  types at spawn. If the restart orphaned in-flight work (the marker's `lostBg`), the server's stall watch mails the
  session itself once, 15 minutes after the restart." Its stage-3 manifest may later replace `lostBg` as the source.
- `livestate.ts`'s `shell` docstring (wave 1) and the 2026-08-17 spec's `shell` reading.
- README's mail-gate and watcher-lane sections; CLAUDE.md's coordination invariants gain one line on the stall lane.

## 7. Noise and cost

| Item | Per day | Operator effect |
|---|---|---|
| r1 stall-checks | 3.5 (97 in 27.6 days) | none: recorded, not pushed |
| r1 false positives on legit waits | ~1.1 | one worker turn and one reply each |
| r2 coordinator mails | 1–2 (55% of nudge-started turns send no mail) | `⚠ stall` push, presence-gated |
| r3 | ~0.1–0.3 | `⚠ stalled` push |
| orphan (D) | ~0.4 | `⚠ orphaned` only if unanswered after 30 min |
| frozen, dead, limit-cap | ~0.04 each | push |
| mail stuck | ≤ 0.3 | push |
| gate change | 0 new mail | none; mail lands hours earlier |

**Tokens.** A worker's mail-started turn measured p50 23 requests and 6.4 M context tokens; a coordinator's, p50 10
requests and 2.9 M. An r1 plus its reply and the coordinator's read is about 5–9 M; the whole lane is about 17 M tokens a
day fleet-wide, about 5 M of it on legit-wait false positives. The shadow period measures the real figure before r2/r3
arm. **Server load:** at most two agent reads per ACTIVE run per minute; wave 2 adds one marker read per held delivery
per sweep.

## 8. What is not done, and why

- **A blocking Stop hook** — §2. The Stop predicate may later run as a zero-cost journal line (no bounce) if the armed
  lane's data shows turn-end stalls still getting through.
- **ccd typing an orphan prompt at respawn** — a second typing actor into operator panes, and it races the 13 of 21
  restarts that self-heal within 2.4 min.
- **"Background work outstanding" as an exemption** — §4.2.
- **Transcript mtime, hookstate `updatedAt`/`state`, or `statusUpdatedAt` under `busy` as signs of life** — §3.3, §3.4.
- **A coordinator rung on an acked question.** Legit coordinator-ball waits run median 10.8 h, p90 18.6 h, max 28.7 h;
  only an unacked worker question (1 h) is flagged. §11 asks whether to add one.
- **The memory ceiling that killed Case D's pane** — the continuity programme's (its §11 item 5). This spec shortens
  the damage from 13.8 h to about 16 min; it does not prevent the OOM.
- **Upstream.** A finished subagent's Monitor notice queued under its own id and never drained (S4; 58 in 3 days) is a
  Claude Code defect. The watch caps its damage; it does not fix it.

## 9. Failure modes named

1. **Wave 2 not on the fleet box.** The marker reads `absent`; the gate and the lane keep wave 1's rules; nothing fires
   on a guess.
2. **A lost or stale marker write.** The hook exits 0 even when its write fails. A stale `working` under a live `idle`
   or `shell`: the live status wins. A stale `done` during a turn: a nudge is typed mid-turn and folded in at the next
   tool boundary (§3.1).
3. **A Claude Code build that omits `agent_id` on subagent payloads.** Subagent events would count as main-thread
   ones; behaviour degrades to wave 1's, never misfires. Wave 2's first task captures real Stop, StopFailure and
   subagent payloads from every live lane.
4. **A build where `shell` stops meaning idle.** The pane guard refuses; the refusal is non-counting.
5. **The agent link down, or the registry unlistable.** `tick()` returns before registry-sourced lanes; the markers
   fail shut; nothing fires. The durable episodes resume afterwards.
6. **`coord.db` throws synchronously.** Store calls are wrapped as the claim lanes' are; one sweep is lost.
7. **Server restart or deploy.** Dedupe lives in `run_events` and mail rows; no storm.
8. **The coordinator is dead, absent, paused or limit-locked.** Dead, absent or paused: r2 is skipped and r3 names the
   reclaim door. Limit-locked: r2 sits unacked, r3 goes out 1 h later. A mail from a role sender gets no "blocked"
   push (`senderId` resolves to null), so r3 is the only escalation, by design.
9. **The worker acks and goes silent again.** The episode stays open; r2 and r3 each fire once; nothing repeats until
   the worker mails.
10. **A legit wait with no `question`/`wait:` mail.** At most one stall-check per episode; the body tells the worker
    how to stop further checks.
11. **The monthly spend limit.** `FleetSession.limits` does not measure it (S1's worker hit one); it escalates as a
    stall at r3. §11 decision 6.
12. **Injection.** Bodies carry only server-computed facts and ids matching `^[A-Za-z0-9_-]+$`; no transcript text.
13. **Clock skew.** Fleet-box epoch ms against the server's `Date.now()`, the exposure `HOOKSTATE_FRESH_MS` already
    has; every threshold is 10 min or more.
14. **The markers.** No code writes `stall-watch-disabled`, `stall-watch-live`, `mail-gate-strict`,
    `mail-gate-busy-shadow` or `mail-gate-busy`; a test pins that no source path writes them.

## 10. Measurement, targets, and sequencing

**Shadow and targets.** Each shadow period is compared with the census: about 3.5 r1 fires and 0.4 orphan fires a
day; every shadow fire is hand-classified stall or legit against its transcript, which settles the census's circular
precision (strict 0.48, loose 0.69 at 2 h). The kill rule (proposed, not measured): if armed r1 fires exceed 10 a day for two days, or more
than half of a week's r2 mails are answered "was waiting legitimately", disarm (`rm stall-watch-live`) and re-derive.

**Tests.** Every guard ships with the test that reds when it is deleted, measured before and after (mutation-table
discipline). The golden fixtures are the measured timestamps: S1–S4, Case D, run 129's stuck mail, the 4.6 h frozen
Bash, a declared-idle legit wait, a hand-off. A property test: every input slot set to unmeasured gives `hold`.
Fixture HOMEs only; the marker writer's tests use `makeCcdHarness`.

**Order.**
- **Wave 1** — server only, about one to two days, tests about 60% of it. Ships with one server rollout.
- **Wave 2** — fleet box first (the hook writes the marker; the reader tolerates its absence), then the server. The
  `busy` gate goes through its shadow marker before arming.
- **Wave 3** — skills through `ccrc update`'s `_inst_skills`; doctor's `skills` check green in every rostered home
  before r2's `stall:` mail relies on clause 15 (r2 carries its own instruction until then).
- **Optional** — `RunHealth.stallNoticedAt` (a stored timestamp, never an age) and a `stalled since HH:MM` run warning.

Deviation numbers are minted at run-open (`POST /api/ledger/deviations`); this spec defines none.

**Relations.** Landing-order and continuity waves 1 are independent of this. Continuity wave 2 rewrites the rescue
path; the stall lane's limit hold reads the same `limits` fields and must not wait on a rescue it cannot see (it
holds, capped at 12.5 h). The workspace-lifecycle stage-4 lane closes runs of a dead COORDINATOR; this lane only
reports a dead WORKER and never closes anything.

## 11. Decisions for the operator

1. **No blocking Stop hook** (§2). The coordinator proposed one; the census says it fires 36 times a day, misses a
   third of stalls, and has no backstop. Confirm.
2. **Who hears first.** Recommended: the worker at 2 h, the coordinator at 3 h, the phone at 4 h. The coordinator asked
   to be mailed; an FYI copy on every r1 costs about 3.5 more coordinator turns a day (~10 M tokens).
3. **Arming.** Recommended: r1 armed at deploy (it only mails the worker and never pushes); r2/r3 in shadow for 48 h,
   then armed by `touch stall-watch-live`. A 7-day shadow would give up about 190–370 stall-hours at the census rate.
4. **Orphan wakes on non-run sessions** (Case D, `soft-basin`). Recommended: the D shape on any session within a 24 h
   horizon, at 15 min; the E shape only on run workers and coordinators.
5. **`shell` delivery on by default** (§4.1), with `mail-gate-strict` as the way back.
6. **The monthly spend limit** escalates as a stall (§9.11). Accept, or add a measure first.
7. **Clause texts** in §6.1 and §6.2.
8. **Side findings for separate tickets:** `runs signals` reports swaps 0 despite a swap; on 09-17 one session's pane
   stopped and unsupervised another session's unit during a rolling relaunch; the S4 queue defect for upstream.
