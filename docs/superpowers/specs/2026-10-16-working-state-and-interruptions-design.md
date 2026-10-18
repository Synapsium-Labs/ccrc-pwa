# Working-state truth and session interruptions (design)

**Status:** rev 3 (2026-10-16), after three adversarial reviews. It records the operator's rulings of 2026-10-16 (§2) and
the coordinator calls made under them. Every number in it is issued: D-5231 to D-5242, defined once in the plan's
§Deviations found. The four box acts (§5.10's verification, rollout and the tmux-server drop-in; §5.11's arming) are
operator acts under the SAFETY rules and are not authorised by this document.

**Date:** 2026-10-16 · **Branch:** `docs/working-state` (cut from `origin/main` `0b3ff2f6`, merged up to `256b25ec`)

**Plan:** `docs/superpowers/plans/2026-10-16-working-state-and-interruptions.md` (tasks, tests, mutation tables, lanes, the
measurement plan and the ledger entries).

**Citations** are to `origin/main` `256b25ec`. Its last two merges (#446, #447) touched only UI, CSS, Storybook and another
plan, so the line hints first taken on `a6b2606c` still hold. Line numbers are hints, written `≈:`, and every citation also
names its function or constant. **[M]** marks a measured figure, **[I]** an inferred one, and **[B]** a reading of Claude
Code's own hook-input schema and task code in an installed 2.1.300 binary (read-only `strings`, no execution).

**Where the numbers come from.** A read-only investigation of the fleet box on 2026-10-15 and 16: four investigators
(status from code, status live, interruptions from code, interruptions live), a diagnosis, and an adversarial verifier
whose refutations and corrections override the diagnosis wherever the two disagree. Reads were limited to the live status
files, the hookstate files, the turn markers, the user journal, `swap.log`, the history database and Claude Code's
installed binaries. No tmux, registry, unit or `ccd` action was taken. Nothing read from a transcript appears in this
document; transcripts were used only to classify events, and only counts are reported.

**Related:** #197 (session continuity: waves 5, 6 and 7 overlap §5.6, §5.9 and §5.10, see §6.3), #296 (restarts kill
background work), #358 (the tmux-server OOM), #390 (status polling cost), #119 (worker heartbeat),
`docs/superpowers/specs/2026-08-17-working-detection-defect-family-design.md` (D-75, whose §3 claim this design corrects),
`docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md` (the turn marker), and
`docs/superpowers/specs/2026-09-23-session-continuity-design.md`.

---

## In short

The fleet card is right when nothing is changing and wrong while something is. Three transitions mislead:

1. **While workflows, subagents or teammates run, the card flaps between `done` and `working`.** Each main-thread Stop
   writes a hook `done` that is newer than the live file's frozen `busy` stamp, and D-75's rung lets that `done` win. The
   next agent tool event writes `working` again. Fix: a `done` may unseat a live `busy` only when the Stop listed no
   delegated background work, and agent events never rewrite the main thread's state (D-5231, D-5232).
2. **About one Finished push in five is false.** It fires on any live busy→idle edge, so compactions, restarts and
   overload ticks push "✓ Finished". Fix: push only when a main-thread Stop falls inside the busy episode, and treat a
   failed read as unmeasured (D-5233, D-5234).
3. **The subagent chip leaks.** The roster is keyed by name, never reset, and keeps Starts whose Stop never came. Fix:
   key it by `agent_id`, reset it at SessionStart and prune it at Stop (D-5232).

Interruptions are mostly not Escapes. In seven days **102 sessions died and were restarted, 92 of them within 15 s of
an OOM kill in a pane scope** [M]. Pane scopes run `OOMPolicy=stop`, so killing any process in a pane ends the session.
Swaps are second: 5 of 45 rescues and 8 of 24 manual swaps killed a session that was still producing output [M].
Operator Escapes are about 3 a week [M], and the PWA has one unintended Escape path, on desktop [I].

The operator ruled on capacity (hibernate long-idle sessions; let a killed tool child die alone), display (`working ·
N in background` until delegated work ends), swaps (re-check, re-confirm, refuse when busy) and the status fixes. This
design builds all of it in twelve decisions and a measurement plan.

---

## 1. The problem, measured

### 1.1 How a state is shown today

- **Claude Code's live file** (`<config>/sessions/<pid>.json`) is collapsed to idle or busy by `liveSessionStatus`
  (`server/src/livestate.ts` ≈:62): every word except `idle` reads busy. On every build on the fleet, 2.1.296 to 2.1.301
  [M], the file reads `busy` while any local agent, remote agent, active in-process teammate or local workflow runs, and
  it is rewritten only when its word changes. Under delegation, `statusUpdatedAt` therefore marks the start of the first
  busy turn, not the current one [M: one session held one busy stamp for 3,734 s and another for 5,469 s across several
  main Stops; but a third session's stamp was only 26–34 s old at its flips, so the freeze is common, not universal].
  The floor in `liveStatusCoversDelegation` (≈:95, 2.1.277, no ceiling) holds on every fleet build [M].
- **The session hook** (`ccd/session-hook.sh`) writes `$REG/<id>.hookstate.json`: `working`, `waiting` or `done`, plus a
  subagent roster. The reader drops a file older than 30 minutes (`HOOKSTATE_FRESH_MS`, `server/src/hookstate.ts` ≈:9;
  the clock is the later of `updatedAt` and `aliveAt`, ≈:358).
- **`sessionBucket`** (`shared/api.ts` ≈:1444) arbitrates. Attention first (a pane menu, a hook `waiting`, a live
  `waiting`); then D-75 (≈:1502): whichever observation is newer wins, so a hook `done` newer than `statusUpdatedAt`
  unseats a live `busy` (`finishedAfterStatus`, ≈:1509); then a newer hook `working`; then hook `done`; else idle.
- **The turn marker** (`$REG/<id>.turn.json`, written by the hook for main-thread events only, read by
  `server/src/turnmark.ts`) records every main Stop's `background_tasks` count, kinds and first eight ids. Only the mail
  gate's busy modes and the stall watch read it. `sessionBucket` never does.
- **The PWA** paints the bucket on the fleet card and the session header. The chat's working pulse and the Escape gate
  read the raw live word (`pwa/src/screens/SessionScreen.tsx` ≈:198, ≈:436; `pwa/src/session/SessionHeader.tsx` ≈:201),
  so the card and the chat screen can disagree about one session.

### 1.2 Status defects

| # | Defect | Measured | Mechanism |
|---|---|---|---|
| S1 | `done` while delegated work runs | 14 flips to `done` while live was busy in 420 s, across 9 sessions; about 12 of them delegation-caused (the other 2 were a manual-compaction race and a Stop that landed 2 s before its idle write). 147 of 7,788 busy session-seconds (1.9%). A second window: 48 of 1,555 busy samples (3.1%), 77% of them from one session with six background tasks, which showed `done` for at least 8 minutes. 24 of 41 captured main Stop payloads listed at least one background task. [M] | The Stop arm writes `done` (≈:3019) and sends `background_tasks` only to the turn marker. D-75's rung then lets that `done` unseat `busy`. The 2026-08-17 spec's claim that D-75 "covers the Workflow-orchestrator case" assumed the live file read idle during delegation, which stopped being true at 2.1.277. |
| S2 | Agent events rewrite the main state | Every `done → working` flip in S1 is an agent tool event. 4 captured tool events came from internal side agents with no SubagentStart, 2 of them within 6 s of a main Stop. [M] | `PreToolUse`/`PostToolUse` write `working` whatever `$paid` says (≈:2884–2919); SubagentStart/SubagentStop write a fresh `updatedAt` over the carried state (≈:3980). Only a main-thread `waiting` is carried (D-4039, D-4041). |
| S3 | False Finished pushes | Of 469 pushes in 42 h: 289 followed a real turn end; about 77 are firmly false (68 compaction-only, 6 mid-turn, about 3 in an overload cluster), about 20% of the 385 classifiable, about 44 a day; 15–22 are uncertain; 84 could not be checked. 7 more fired when background work ended and a new turn followed: premature, not false. [M] | `watch.ts` ≈:2252 pushes on any live busy→idle edge, with no evidence that a turn ended. |
| S3a | Compactions | 43 of the 68 compaction-only pushes followed `ccd`'s own typed `/compact` (trigger `manual`). Claude Code's idle-compaction timer is in every fleet build (2.1.296 to 2.1.301) and fired 79 of 1,277 auto compactions exactly 54–55 min after the last Stop. 12 of 58 live sessions sat idle with hookstate `working/PostCompact`. [M] | PreCompact writes `working`; PostCompact writes `done` for `manual` and `working` for `auto` (≈:2908–2911). A `manual` PostCompact therefore mints a fresh `done` and an unseen badge with no turn behind it (about 20 a day [I], from about 166 auto-compacts in eight days of `swap.log`). |
| S4 | The roster leaks | 316 roster entries across 32 of 92 hookstate files. One session sits at the 32-entry cap. [M] | Entries are removed by name, the list survives SessionStart, and a Start whose Stop never comes (the agent died with its process) is never removed. **The diagnosis's mechanism was refuted:** the 32 captured SubagentStops with an empty `agent_type` all belong to side agents that never sent a Start, so nothing was there to remove; every matched pair carried the same type at both ends. `agent_id` is on every Start and Stop. [M] |
| S5 | A failed read paints idle | One cluster of 6 false Finished pushes in one tick, in 42 h, during an overload. [M] Which path fired is inferred. [I] | `fleet.ts` ≈:550: when `panePid` returns null, status stays `idle` with `statusUnmeasured` false. And Claude Code rewrites the live file in place (same inode [M]), so a torn read parses as `no-state`, which also reads idle (`livestate.ts` ≈:195). |
| S6 | Gates read the wrong status | The dispatch `/clear` gate reads only hookstate (`coord/dispatch.ts` ≈:883–894). At snapshot time one session (live busy, six background tasks, hook `done`) would have passed it. No wrong `/clear` was observed. [M] | The same gate refuses `worker-busy` for up to 30 min on a stale `working/PostCompact`. |

Not ruled in this design (§10): a stale hook `waiting` outranks a newer live idle (`shared/api.ts` ≈:1480; 0 `waiting`
words in 4,756 samples [M]); `/ws/fleet` has no heartbeat (the 2026-08-17 spec's §5.6).

### 1.3 Interruptions

| # | Cause | Measured |
|---|---|---|
| I1 | **OOM kills end whole sessions** | For 2026-10-08 22:15 to 10-15 22:15Z: 102 "session … ended; exiting for systemd restart" lines, 92 within 15 s of a pane-scope OOM kill (93 kills). 61 of those scopes logged `Failed with result 'oom-kill'`; 32 did not, and their sessions still ended (median 8 s). By day: 10-12 43, 10-14 17, 10-15 28. [M] Every pane scope runs `OOMPolicy=stop` with `MemoryHigh=8G`, `MemoryMax=12G`. The session slice's swap was at its cap. [M] |
| I1a | **The victim is chosen by size** | Every process in the session slice has `oom_score_adj` 200, inherited from Claude Code [M], so a large test child and Claude Code compete on size alone. One measured case: Claude Code survived the kill of a child, wrote its own interrupt markers 3 s later, and was then ended by `OOMPolicy=stop` 20 s after that — exactly what `continue` saves. [M] The 32 scopes with no `Failed` line most plausibly lost Claude Code itself or the pane's own shell. [I] |
| I1b | **Crash loops** | 9 of 26 re-driven restarts were followed by another restart of the same session within 10 minutes; the re-drive re-runs the step that ran out of memory. [M] |
| I1c | **Memory outside the slice** | 225 of 466 OOM kills since boot fell outside the session slice: a usage scan 48 times and a graph sweep 24 times in seven days. [M] |
| I2 | **Swaps kill working sessions** | 201 swaps in 15 days: 132 auto-home, 45 rescue, 24 manual. Killed a session still producing output: 0 of 132 auto-home, 5 distinct rescues of 45, 8 of 24 manual. [M] An auto swap checks idle once, sleeps a random 0–120 s (`SWAP_JITTER`, `ccd/ccd` ≈:1346; `_dispatch_swap` ≈:17290) and kills without re-checking. The rescue arm has no idle check by design (≈:19176). `cmd_swap`, the server's swap route and the PWA's SwapSheet check nothing, while archive refuses `409 session-busy`. [M, code] 11 of 19 rescue resumes re-drove a limit-error tail, which is the rescue working as designed (D-2227), not swap damage. [M] |
| I3 | **Background work dies with the process** | The turn marker already moves the background count into `lostBg` on a restart, and the stall watch's orphan arm mails the session about the loss about 15 min later (11 such mails in three days). [M] The resume prompt blames "an account swap or a supervisor revival" and never names OOM. [M, code] |
| I4 | **The tmux server** | One OOM kill of the tmux server's scope on 10-12 stopped every pane for two hours. The `OOMPolicy=continue` drop-in that fixed it (#358) exists only on the box: no repository ships it. [M] |
| I5 | **Transcript markers mislead** | 74 marker events in seven days: 49 are the main agent's own TaskStop and 9 a subagent's TaskStop on itself (both labelled "by user"), 12 AskUserQuestion rejections, 3 real operator Escapes on a busy main loop, 1 after an OOM. Process kills leave almost no markers. [M] |
| I6 | **Unintended Escapes** | About 3 operator Escapes a week; 2 in 15 days looked accidental. [M] On desktop, Escape that closes a sheet also interrupts the turn: Radix calls `preventDefault` without `stopPropagation`, and `SessionHeader`'s window listener (≈:209–223) ignores `defaultPrevented`. [I, code] The interrupt route Escapes any non-idle word, including an idle main loop over background work (`inject/send.ts` ≈:1708; `server.ts` ≈:2374). Nothing logs an interrupt. [M, code] |
| I7 | **API errors** | 55 turn-ending API errors in seven days, 42 of them limit banners. [M] Out of scope. |

---

## 2. The operator's rulings (2026-10-16)

**Capacity.**
1. **Hibernate long-idle sessions.** A session idle for more than N hours is stopped cleanly and resumes on demand: when
   the operator opens it in the PWA, or when a dispatch or a mail needs it.
2. **Victim policy.** A killed process no longer takes its session down (pane scopes `OOMPolicy=continue`), and tool
   children and test runners are picked before Claude Code itself (`oom_score_adj`). A fleet-box configuration change
   under the ccrc SAFETY rules, approved by the operator, verified on a throwaway transient scope first, and shipped
   through ccrc's deploy so a redeploy cannot drop it, together with the existing `ccrc-tmux-server.scope`
   `OOMPolicy=continue` drop-in.
3. No hard session cap, no bigger box.

**Display.** When the main thread has finished its turn but workflows, subagents or teammates still run, the session
shows WORKING with an "N in background" note. `done`, its badge and its Finished push come only when the delegated work
has ended too.

**Swaps.** Auto swaps re-check idle right before killing and re-queue if busy. Rescue swaps re-confirm that the lane is
still blocked and back off while the session produces output. Manual swaps, from the CLI and the PWA, refuse a busy
session unless the operator confirms "swap anyway" (`409 session-busy`, as archive does).

**Status fixes: build now, merge when green.** Background-aware `done`; `agent_id` events never rewrite the main state,
with a freshness replacement; the roster keyed by `agent_id`, reset at SessionStart and pruned at Stop; Finished only on a
real main Stop; failed reads unmeasured; desktop Escape on a sheet no longer interrupts; every interrupt and restart
cause logged and named in the resume prompt and the PWA; the dispatch `/clear` gate also requires live idle, with the
verifier's teammate caveat; compactions, automatic and `ccd`'s typed `/compact` alike, carry the prior state and never
mint a fresh `done` badge.

**Coordinator calls, made under those rulings.** The interrupt route on a session whose main loop is idle over background
work (delegated work under a live `busy`, or a shell or monitor under the live word `shell`) warns instead of sending
Escape, with a separate explicit "stop background tasks" only if Claude Code exposes one (otherwise it only warns). A turn
ended by Escape or a kill no longer pushes Finished.

---

## 3. Goals and non-goals

**Goals.**
- Every surface (card, header, chat pulse, push, badge) tells one story: a session is `working` while its main turn or
  its delegated work runs, and `done` only when both have ended.
- A push or a badge says something happened only when a main turn really ended.
- An interruption has a recorded cause: which source sent an Escape, and why a process ended.
- A tool child's OOM kill costs the child, not the session.
- Long-idle sessions stop holding memory, and come back without the operator noticing more than a short wait.
- Every change ships with a red test, a mutation table and a before/after measurement.

**Non-goals.** A hard session cap; a bigger box; new buckets on the wire; a new `FLEET_PROTO`; any change to who decides
placement (`ccd` stays the authority); stopping background tasks from the PWA (unless Claude Code exposes a way, §5.5);
the stale-`waiting` rung and the `/ws/fleet` heartbeat (§10).

---

## 4. Contracts this design keeps

- **D-75's wedge protection.** A live file that is wedged `busy` with no delegated work is still unseated by a newer hook
  `done`. Only a Stop that listed delegated work stops being "evidence the turn finished".
- **F1.** A SessionStart `done` proves "never started", not "finished" (`hookEvent === 'SessionStart'`).
- **D-115.** An unreadable status is `unmeasured`, painted `busy` on the card and never a push; `liveStatus()` keeps its
  opposite answer for the interrupt route, deliberately (`fleet.ts` ≈:324).
- **D-4039 and D-4041.** A main-thread wait is carried through agent events with its own stamp; `aliveAt` keeps it fresh.
- **The stall watch's clocks** (`docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md`). Subagent activity holds
  `delegates` and resets the `frozen` clock, and plumbing (SessionStart, PreCompact, PostCompact) never refreshes either.
  §5.2 moves subagent activity off `updatedAt` and onto `aliveAt`, so both clocks read `aliveAt` from then on, and §5.8
  stops compactions writing anything, so `aliveAt` stays subagent activity only.
- **Wire discipline.** Every new field is additive, read through a single reader, absent means the old behaviour, and
  `reviveFleetSession` computes it. **No new `SessionBucket` member** (README, "The attention bucket": the live frame is
  cast, so an unknown bucket crashes a deployed PWA). No new `SessionLifecycle` member.
- **The hook's shape.** Nothing new above `ccd/session-hook.sh:2900` (README anchors it; D-3615 put all new logic in the
  tail). The PostToolUse hot path stays under its pinned budget (p95 of 20 runs under 150 ms).
- **SAFETY.** No session, test or script touches the fleet's tmux, `~/.cc-sessions`, `~/.cc-limits` or
  `claude-session@*` units. Box configuration changes are operator acts that name the rule they are taken under.
- **`ccd` is the authority on the box.** The server refuses, forecasts and composes; `ccd` re-measures at every act that
  kills a process.
- **Deploy order is a mechanism, not a sentence.** Where a fleet-side change is safe only behind a server-side one (§6.1),
  the fleet half gates itself on the server it talks to: the hook engages a changed meaning only while that server's
  `/health` advertises the word for it, as the fleet box last measured it. Every mover is then safe in any order: `ccrc
  rollout` with or without `--server-first`, the PWA's one-tap, the update control plane's unattended `auto` dispatcher
  (which always moves fleet nodes first, `planDispatch`'s `waiting-for-fleet` hold, `server/src/update/dispatch.ts`
  ≈:269–308), `deploy.sh`, and a server rolled back below the release that brought the word.

---

## 5. Design

### 5.1 Background-aware working (D-5231)

**What a Stop carries.** The committed captures (`server/test/fixtures/delegation/2.1.280/*.json` and later builds) show
the real Stop payload: `stop_hook_active`, `last_assistant_message`, `background_tasks` and `session_crons` beside the
common keys, and every task as `{id, type, status, description}` plus one type-specific key (`agent_type` for a subagent,
`name` for a workflow) [M]. Claude Code's schema describes `background_tasks` as "in-flight background work
(running/pending + backgrounded)" and `session_crons` as "session-scoped cron tasks (CronCreate, ScheduleWakeup, /loop)
that will wake this session later" [B]. Its builder lists a task only when its status is `running` or `pending` and it
is backgrounded, and labels each type through a fixed map: `subagent`, `workflow`, `shell`, `monitor`, `MCP task`,
`teammate`, `dream`, `auto-mode scan`, `memory import` and `cloud session`, falling back to the raw type name for any
other [B]. The live file's own delegation set is four of those: local agents, local workflows, in-process teammates and
remote agents (`liveStatusCoversDelegation`'s docstring, `livestate.ts` ≈:66, measured there on 2.1.277 to 2.1.283) [B].

**What the hook records.** The Stop arm already parses `background_tasks` (≈:3024). Its one `jq` gains two more output
lines: the number of listed tasks that are **delegated and not finished**, and their kinds, unique and comma-joined. The
measured types in fleet Stop payloads are `workflow`, `subagent`, `shell`, `monitor` and `teammate` [M]; the hook's
existing cleaning turns the other labels into `mcp-task`, `auto-mode-scan`, `memory-import`, `dream` and `cloud-session`.
- **The kind rule:** every kind except the six labels whose work never holds the live file `busy`: `shell`, `monitor`,
  `mcp-task`, `dream`, `auto-mode-scan` and `memory-import`. An idle main loop over only shells or monitors writes
  `shell` (a shell task, the shell Monitor included) or `idle` (an MCP monitor), never `busy` [M, B; stall-watch spec
  §3.1], and the other four are outside the live file's delegation set too [B]; a Stop listing only those still settles
  `done`, which is the case D-75 was written for. `subagent`, `workflow`, `teammate` and
  `cloud-session` count, and so does a raw type name no build has shown yet: it only matters while the live file reads
  `busy`, and after a Stop that word means delegated work or a wedge, so an unknown kind is likelier the former.
- **The status rule:** a task counts unless its status is one of the terminal words in Claude Code's task code,
  `completed`, `failed` or `killed` [B]; `running`, `pending` and any status no build has shown count as running. The
  builder already leaves finished tasks out [B], so the rule is a second wall: a finished task listed by some later build
  must not keep a wedged `busy` on `working` and so switch off D-75's recovery.

The hookstate gains `bgDelegated` (an integer) and `bgDelegatedKinds` (a string), written on a main Stop whose
`background_tasks` is an array, and absent everywhere else. A new main turn's first write leaves them out.

**What the server reads.** `hookstate.ts` parses the pair into `HookState.background` (`{count, kinds}`). A malformed value
is absent and never condemns the file (the `aliveAt` rule). `fleet.ts` sets the new wire field
`FleetSession.background: {count, kinds} | null` from it **only when** the live file's build covers delegation
(`liveCoversWorkflows`, already computed at ≈:574), the hook state is `done` from a `Stop`, and the count is above zero.
Below the floor the field is null and D-75 answers as before.

**The ladder.** `BucketInput` gains `background`. In `sessionBucket`:

```ts
const delegated = s.background !== null && s.background.count > 0;
const finishedAfterStatus = hookNewer && s.hookState === 'done' && hookEvent !== 'SessionStart' && !delegated;
// …busy and not finishedAfterStatus → working, as before…
if (s.hookState === 'done') {
  if (hookEvent === 'SessionStart') return { bucket: 'idle', bucketSince: s.statusUpdatedAt };
  const since = delegated ? Math.max(hookUpdatedAt ?? 0, s.statusUpdatedAt ?? 0) || null : hookUpdatedAt ?? s.statusUpdatedAt;
  return { bucket: 'done', bucketSince: since };
}
```

So a Stop that leaves delegated work running keeps a live `busy` on `working`. When the delegated work ends, Claude Code
rewrites the live file `idle`, the hook's `done` is no longer newer, and the row reads `done` **dated from that idle
write**, so its badge fires then and not at the Stop the operator may already have seen. Teammates are safe by
construction: idle teammates do not hold the live file busy, so a Stop that lists 21 idle teammates still settles `done`.

**The display.** Card and header read `working · N in background` (with the kinds in the title) when the bucket is
`working` and `background` is set. The chat pulse reads the bucket when a snapshot row exists and the live word only
before the first frame, so card, header and chat cannot disagree. The wedge qualifier (`SessionMeta.tsx` ≈:248, D-2016)
stands down while `background` is set: a long busy age there is delegated time, not a wedge. N is "as listed at the last
Stop" and can only overstate between that Stop and the next main event; it is never shown once the live file reads idle.

**The Finished push** follows from §5.3: the live busy→idle edge at the end of the delegated work has a main Stop inside
its busy episode, so it pushes then, once.

### 5.2 Agent events and the roster (D-5232)

**Agent events never rewrite the main state.** An event whose payload carries an `agent_id` (`$paid`): PreToolUse,
PostToolUse, SubagentStart, SubagentStop. It keeps the file's `state`, `event`, `updatedAt`, `ask`, `interrupted`,
`waitBy`, `waitPrev` and the two background fields, read by the one fresh read the hook already takes
(`_hook_fresh_read`, ≈:3954), and writes `aliveAt` = now. That is D-4041's carry generalised from a main-thread wait to
every main state. An agent event with no hookstate file yet writes no hookstate, but it is not a silent exit: it still
reaches the tail's one print, so a subagent's PreToolUse keeps its deny or nudge (`pre_json`, ≈:4061) on a session that
has no file.

**The freshness replacement, for every reader.** Agent events used to be what kept a long foreground Agent call's
hookstate fresh, and what told the stall watch that subagents were working. Both readers move to `aliveAt`:
- the aged read: `hookstate.ts`'s age clock already reads the later of `updatedAt` and `aliveAt` (≈:358), so nothing
  changes there;
- the stall watch: its raw fact (`HookRawFact`, `coord/stall.ts` ≈:455, built by `watch.ts`'s `stallHookFactOf` ≈:333)
  gains `aliveAt`, and its two clocks read the newest non-plumbing activity, which is `updatedAt` unless the event behind
  it is plumbing, maxed with `aliveAt`: `stallFrozenSince` (≈:460, the `frozen` arm's 60-minute clock, so a foreground
  Agent call whose subagents keep working never reads frozen) and `stallHookFresh` (≈:883, the `delegates` hold, so a
  worker idle over working subagents keeps its hold). Without this, the hook change alone would mail stall checks to
  every worker idle over background agents and call a 70-minute foreground Agent call frozen;
- every other reader of the hookstate's `updatedAt` keeps reading it, and is right to: the bucket ladder compares the
  main thread's last word with the live file's (D-75 needs the main stamp, not agent liveness); the ask stamps
  (`stallHookAskOf`, the ask rows' `askAt`, the child ask in `registry.ts`) date a question, which agent events never
  move; and the mail lane's UserPromptSubmit edge (`watch.ts` ≈:6582) now survives the agent events that used to overwrite
  that event within seconds. The plan's Task 2 carries the audit as a table.

`aliveAt` stays agent activity only, because §5.8 stops compactions writing the file at all; that is what lets the stall
watch read it without breaking its own rule that plumbing never refreshes a hold.

**One exception: a subagent's own wait.** A subagent's AskUserQuestion or PermissionRequest still writes `waiting` with
`waitBy: "subagent"` and a fresh stamp (attention needs it), and now also stores `waitPrev`: the state, event, stamp, ask
and `interrupted` flag it replaced. The next agent tool event over that wait restores `waitPrev` (plus `aliveAt`) instead
of writing `working`. A file with no `waitPrev` (written by an older hook) falls back to today's `working`. A main event
ends any wait, as now.

**The roster.** Entries gain `id` (the payload's `agent_id`, cleaned to `[A-Za-z0-9_-]{1,64}`). A SubagentStart adds an
entry unless that id is already listed; a SubagentStop removes the entry with its id, and is a no-op when none matches
(the side agents' Stops). SessionStart `startup`, `clear` and `resume` empty the list; `compact` keeps it (its arm exits
first, ≈:3017, and a compaction kills no agent). At a main Stop: a measured `bg` of 0 (Claude Code lists every running
or pending backgrounded task [B], so nothing delegated runs) empties the list; a `bg` of 1 to 8 (every listed id known:
the hook keeps at most eight) prunes to the listed ids, but only under the rule below; anything else, `bg` −1 included,
leaves the list alone. **The bounded prune runs only for the kind whose ids are measured:** a background subagent's task
id equals its SubagentStart `agent_id` on 2.1.280 (in the committed capture `agent-iso-bg.json`, the Stop lists task
`a73ff…` and the SubagentStart before it carries the same `agent_id` [M]), and no capture shows a teammate's or a cloud
session's, while workflow agents are not listed individually at all. So the list is cut to the listed ids only when every
delegated task the Stop lists is a `subagent`; a listed `workflow`, `teammate`, `cloud-session` or unseen kind leaves the
list alone, until the plan's re-measure on the fleet's current builds (2.1.296 to 2.1.301) shows that kind's ids match
too. If even the subagent match no longer holds there, only the `bg = 0` rule ships. Entries without an `id` (written by
an older hook) are dropped at the first prune.

**Order.** The carry must not engage before §5.1's server half, §5.7 and this section's own stall-clock change are on the
server the fleet talks to. With agent events no longer writing `working`, a Stop's `done` would otherwise stand unopposed
over the whole delegated run, which is worse than today's flap; the dispatch gate, which today reads only the hookstate,
would see that `done` and type `/clear` into a session whose delegated work still runs; and a stall watch still reading
`updatedAt` would mail stall checks to workers idle over working subagents and call long foreground Agent calls frozen.
So the carry (the keep-the-main-state write and the `waitPrev` restore) runs only while the server advertises
`hook-main-state-v1` (§6.1); otherwise an agent event writes exactly what it writes today. The word is added to the
server's list in the same change as the stall clocks, and that change is cut after §5.1's and §5.7's, so no server can
advertise it without all three. The roster rules and the no-file print change no existing field's meaning and are not
gated.

### 5.3 Finished means a main Stop (D-5233)

At a live busy→idle edge the watcher pushes "✓ Finished" only when a main-thread Stop falls inside that busy episode.
The episode starts at the busy row's `statusUpdatedAt` (the live file writes on change, so that stamp is the episode's
start), kept per id while the row stays busy. The evidence is the turn marker, read for that id only, at the edge:
`ok`, state `done`, `stopAt` not before `turnAt`, and `stopAt` at or after the episode start less 2 s. An `absent` marker
(an older hook, or a row ccd did not create) falls back to the hookstate: `done` from a `Stop` at or after the episode
start. Every other reading (`unmeasured`, `malformed`, `foreign`, `stale`) pushes nothing.

That removes compaction-only episodes (no Stop), restarts (the marker is stale against the new process), overload
ticks, and Escape-ended turns (no Stop is written; ruled acceptable). It keeps the push at the end of delegated work
(§5.1), and a turn's push still fires exactly once.

### 5.4 A failed read is unmeasured (D-5234)

- `assembleFleet`: a pane `hasSession` says is alive whose `panePid` comes back null is `statusUnmeasured`, painted `busy`
  (D-115's shape). `liveStatus()` keeps answering `idle` on the same reading, so the interrupt route still refuses.
- `readLiveStateMeasured`: a file that is read but empty or not JSON is read once more after 50 ms; if it is still torn,
  the answer is `unmeasured`, not `no-state`. An absent file and a well-formed file naming no session stay `no-state`
  (the seconds after `ccd ws-add`).

The watcher already skips unmeasured rows and keeps their previous status, so a fail-shut tick cannot create a
busy→idle edge later [M, code].

### 5.5 Interrupts (D-5235, D-5236, and D-5237's first half)

- **Desktop Escape on a sheet (D-5235).** `SessionHeader`'s window listener returns when `e.defaultPrevented` is set
  (Radix's dismiss has already handled the key, in its document capture listener) or when an open dialog or sheet is in
  the document. Escape with nothing open still interrupts, as today. **The terminal drawer is already ruled** (operator
  ruling P4, 2026-10-15, pinned by `drawer-view.test.tsx`'s P4 describe): with the drawer's live terminal focused, a
  physical Escape goes to Claude Code as `\x1b` and the drawer stays open (`TerminalDrawer`'s `keepEscapeInTerminal`
  cancels the dismissal); with focus anywhere else in the drawer, Escape closes it and sends nothing. The header's
  listener skips a focused textarea already, so the drawer's Escape is never sent twice; after D-5235 the
  focus-elsewhere case no longer reaches the header's interrupt either. Task 5 pins both.
- **Escape over background-only work warns (D-5236).** The interrupt route reads the one row it is asked about (as
  archive does) and the raw live word, not `liveStatus()`'s collapse. It answers `409 background-only` and sends no key
  in two cases, each with no pane menu pending:
  - the live word is `busy`, the hook says the main turn ended (`done` from a `Stop` whose stamp is newer than the live
    file's `statusUpdatedAt`, the same comparison D-75 makes) and `background` is set: the body carries the count and
    kinds. "Newer" is load-bearing: a main turn that began after that Stop without a hook event (a task-notification turn
    with no tool call) re-stamps the live file, and Escape then interrupts it, as it should;
  - the live word is `shell`: an idle main loop over a background shell or monitor, the word Claude Code writes only when
    no main turn runs [M, stall-watch spec §3.1]. The body carries no count.

  Escape there interrupts nothing and stops none of the background work. The PWA says so: "The main turn has finished;
  N background tasks (kinds) are still running. Escape would not stop them." (for `shell`: "a background shell or
  monitor is still running"). A menu that is up (a Deny) is never background-only, and live `waiting` still sends
  Escape. **Measured first:** whether the fleet's Claude Code build exposes an operator command that stops background
  tasks and can be driven and proved by pane captures. If it does, its route is a separate decision, named by slug in
  the plan; if not, the route only warns.
- **Every interrupt is logged with its source (D-5237).** The route takes an optional `source` (`keycap`, `escape-key`,
  `deny`; anything else or absent is `unknown`) and records a feed event of a new kind, `interrupt`, with source and
  outcome (`sent`, `not-busy`, `background-only`, `not-alive`). It is recorded, never pushed. An older client degrades the
  kind to `unknown`. The terminal drawer's raw input is logged too: a frame that is exactly ESC or exactly Ctrl-C records
  `drawer-escape` or `drawer-ctrl-c` (at most one per session every 2 s). `ccd`'s `_route_escape` (≈:20447) writes a
  `route-escape` line to `swap.log` for every Escape it presses.

### 5.6 Restart causes (D-5237's second half)

- **Recorded by `ccd`.** `_spawn_start` records the pane's scope unit once the pane exists (`$REG/<id>.panescope`: one
  `/proc` read per spawn, nothing per tick). When tmux pronounces the session gone (≈:24643), `ccd` classifies the end:
  `tmux-server` when the tmux server itself is gone; `oom` when the scope's own journal shows an OOM kill in the last
  120 s (`journalctl --user -u <scope>`, bounded by `timeout 5`); `exited` otherwise; `unknown` when the journal read
  fails. `cmd_swap` records `swap-auto-home`, `swap-auto-rescue` or `swap-manual` once its act-time gates (§5.9) have
  passed and before it stops the unit, so a refused or re-queued swap records no end. The cause goes
  to `$REG/<id>.lastend` (`<epoch> <cause>`) and to a `swap.log` line, `ended <id>: <cause>`.
- **Named in the resume prompt.** `_resume_env` composes the prompt per spawn from a `lastend` at most 10 minutes old. It
  keeps Claude Code's own first sentence (the PWA's `RESUME_PROMPT_PREFIX`) and replaces "an account swap or a supervisor
  revival" with the cause: for `oom`, that the pane ran out of memory and a process in it was killed, how many such
  restarts the last 10 minutes held, and that the step that was running must not be re-run at the same parallelism. No
  composed prompt contains a single quote (the tmux command line quotes it). `_redrive_after_spawn` types the same
  composed prompt.
- **Named in the PWA.** `FleetSession.lastEnd: {at, cause} | null` (additive; an unrecognised cause degrades to
  `unknown`). The header and the card's qualifier show "restarted · out of memory · 3m ago" for an hour.

### 5.7 The dispatch `/clear` gate requires live idle (D-5238)

After the hookstate gate, the resume arm asks the same fail-closed question archive asks: what turn would this act lose?
`stopVerdictFor` (`server.ts` ≈:3056, over `stopVerdict`, `coord/archiveDoor.ts` ≈:143) moves out of `server.ts` into a
module both callers import. `idle` proceeds; `busy` refuses `worker-busy`; `unmeasured` refuses a new code,
`status-unmeasurable`. **The teammate caveat:** the gate reads the live word and never a background count. A Stop that
lists idle teammates leaves the live file `idle`, and gating on the count would refuse that session for ever.

Two refinements. **A pane this dispatch just started is waited for, but never under the coordination mutex.** The
dispatch route runs `dispatchRun` inside `coordMutex` (`coord/routes.ts` ≈:1605), the one serialiser that also covers
close, reclaim, settle and the abandon arms the dead-coordinator lane uses. So when an `ensure` that started the pane (its
answer is not `alive: <id>`, ≈:748) is followed by an `unmeasured` verdict, because the new pane has not yet published its
live file, `dispatchRun` returns at once with a new retryable refusal, `worker-starting`, having done nothing after the
`ensure` (no hold, no route write, no transition, no `/clear`). The route then leaves the mutex and polls the verdict
every 2 s, bounded at 15 s. Only a poll that ends on a measured verdict re-enters the mutex, once, to run the whole
decision again from the top; that second run's `ensure` answers `alive:`, and its verdict decides. A poll that ends with
the verdict still `unmeasured` answers `409 worker-starting` at once and never re-runs `dispatchRun` (a re-run would
read the same `unmeasured` after an `alive:` ensure and answer `status-unmeasurable`, which is not retryable); a re-run
whose `ensure` started the pane again answers `409 worker-starting` as it stands. Either way the coordinator dispatches
again. The bound has a basis in code: the coordinator's only client, `ccrc-api`, caps every request at 30 s (`curl -m
30`, `ccd/ccrc-api` ≈:444), and a dispatch the server completed after its caller had given up would read to the
coordinator as a transport failure. So the wait is at most half that cap; that the other half covers the two decisions
around it (ensure, the registry and field reads, the hold, and `sendPrompt`'s `/clear` with its echo polling, plus any
queueing behind other dispatches on the mutex) is measured before the PR, as today's dispatch-route latency at p95 and
maximum, and if the worst case does not fit, the wait is lowered until it does; a test holds the two numbers together.
How long a resumed pane takes to come up is measured before the PR too (the plan's Task 9), to say how often the retry
path is the common one. And the verdict is read again immediately before the `/clear` is typed, since the hold and the route
write sit between the gate and the act (the existing comment at ≈:911 names that window).

**The hooks of §5.8 and §5.2 engage only behind this gate** (§6.1 says how). With the compaction carry alone, an idle
compaction leaves hook `done` standing while the pane compacts, and the hook-only gate would type `/clear` into it; with
§5.2 alone, a Stop's `done` stands through a whole delegated run, which agent events used to overwrite with `working`
every few seconds. The server that carries this gate advertises the word `dispatch-live-gate-v1`.

### 5.8 Compactions carry the prior state (D-5239)

PreCompact and PostCompact, `auto` and `manual` alike, **write no hookstate at all**: the file stays byte for byte as it
was. That carries the whole field set by construction — `state`, `event`, `updatedAt`, `ask`, `interrupted`, `waitBy`,
`waitPrev`, the background pair (§5.1), the roster and `aliveAt` — where a partial carry would have dropped the
background pair, and a compaction during a delegated run (Claude Code's idle-compaction timer fires 54–55 minutes after
the last Stop [M]) would then have let D-75 paint `done` over the live `busy` again. It writes no `aliveAt` either, so the
stall watch's rule that plumbing never refreshes a hold survives §5.2's move to `aliveAt`. An idle compaction therefore
leaves `done` (or `idle`) exactly as it was, with no fresh `bucketSince` and no badge; a compaction in mid-turn leaves
`working`. The tail's compaction helpers (`_hook_compact_pre`, `_hook_compact_post`, ≈:4066) still run: only the
hookstate write is skipped. The turn marker is untouched (it never recorded compactions). During the compaction the live
file reads `busy` [M], which is what the mail gate and §5.7's gate act on. **Gated like §5.2's carry:** the skip (and the
`/compact` arm below) runs only while the server advertises `dispatch-live-gate-v1` (§6.1); otherwise a compaction writes
what it writes today.

**Measured first:** whether a typed `/compact` (the operator's or `ccd`'s auto-compact) fires UserPromptSubmit, and with
what `prompt`. If it does, the tail treats a main UserPromptSubmit whose prompt is `/compact` or starts with `/compact `
as the start of a compaction: it writes no state and opens no turn in the marker. That arm lives in the tail, below
`:2900`.

### 5.9 Swap guards (D-5240)

**Where the gates sit in `cmd_swap`.** Every act-time gate runs before the first write the stop path makes:
before `_operator_choice_keep` (≈:27208), which leaves `$REG/<id>.choicekept` behind and would make the next stop or
spawn skip reading the operator's model choice, and before `_svc_stop`. **The degrade stamp moves to the act.** Both
automatic arms stamp `degraded` at the decision today (`_route_degrade_at_move`, ≈:17599, called at ≈:19147 and ≈:19245),
whose own doctrine is that "the stamp belongs to the move, not to the decision" (≈:17578), because a standing stamp makes
a later settle compose `--model <rung>` for a degrade that never happened. With act-time gates the decision is no longer
the move, so `_dispatch_swap` passes the rung (`from` and `to`) into the transient unit instead, and `cmd_swap` stamps it
after its act-time gates pass, immediately before `_operator_choice_keep`; a stamp that cannot be written stands still
there (ruling S3-R5). Standing still at the act is no longer free, as it was at the decision, where the stamp came
first so that a failure cost nothing (≈:19144): by then a rescue decision has written the `five:100` limits row and
perhaps the `authdead` marker. So that arm undoes what a `rescue-cancel` undoes, the limits row restored by compare,
and leaves what a cancel leaves, the `authdead` marker. A gate that refuses therefore leaves the row exactly as the decision
found it, `lastswap` aside (restored below).

- **Auto, non-rescue.** `_dispatch_swap` passes the arm, the row's previous `lastswap` and the decision's epoch into the
  transient unit. `cmd_swap`, for an automatic affinity swap, runs the same idle gate the decision ran (`_auto_swap_check`'s
  non-blocked arm, ≈:19217–19241: no `esc to interrupt`, a prompt, live `idle`, `SWAP_CEIL_QUIET` of quiet, extracted
  into one function both call). Busy: it writes `requeue <id>: busy after jitter`, restores `lastswap`, and stops nothing.
  The next tick decides again.
- **Rescue.** At the act, `cmd_swap` re-runs the decision's own detector, `_session_hard_blocked` (≈:18299), on a fresh
  pane capture. Its `rc 1` is not one answer: its own comment calls it "what no verdict has to look like", and it returns
  1 for an unmeasurable pane (≈:18367), a carried-in banner (≈:18370, ≈:18378), a running turn (≈:18379), a fresh
  stale-press (≈:18381), a negative transcript verdict, fresh or cached for 30 s (≈:18382–18392), and a draft in the box
  (≈:18396). So the function also names why it said no, in a global beside `HARD_BLOCK_VIA` (≈:18356), the predicate's
  established shape: `HARD_BLOCK_NO` = `unmeasurable`, `carried-in`, `running`, `stalepress`, `negative` or `draft`. The
  act reads it in three ways:
  - **measured not blocked** (`negative` or `carried-in` on a measurable pane, no stand-down fired): `rescue-cancel`;
  - **the session is moving** (`running`, or a transcript that gained, since the byte offset recorded at the decision, an
    assistant entry that is not an API-error message): `rescue-backoff`;
  - **undecidable** (`draft`, `stalepress`): `rescue-backoff` too, because a human typing or a continuation Claude Code
    has just resumed is exactly what a swap would discard; `unmeasurable` proceeds as decided, today's behaviour.
  A still-blocked verdict proceeds unless the transcript shows output (`rescue-backoff`). Cancel and back-off both restore
  `lastswap`, stamp no `degraded` and stop nothing; a lane that is still blocked is re-decided on the next tick. A draft
  meets the transcript arm only: a banner on screen still answers blocked whatever the box holds, which is the pane rung's
  standing contract, so the decision and the act cannot disagree about it and re-decide in a loop. **The decision's
  account writes.** The rescue arm writes two account-level facts at the decision (≈:19152–19167): the `five:100` limits
  row for a non-Anthropic lane, and the `<wrapper>-authdead` marker after a fresh 401. A `rescue-cancel` restores the first
  and never touches the second: the decision saves the limits file's prior bytes (or that it was absent) beside the row
  before it overwrites them, and the cancel restores those bytes **only while the file is still the decision's own row** (its `ts`
  the decision's epoch), leaving any newer write by another session or by the lane's own usage poller alone. The
  `authdead` marker is never undone on a pane reading: it is a verdict on a credential, not on this pane, and its other
  writer, `ccd-account-health`, is systemd-only and silent for an account it cannot probe, so removing it would send
  sessions straight back to a dead credential through `_swap_target`'s home-recovered arm. It clears the way it clears
  today. A `rescue-backoff` undoes nothing: the lane may still be blocked, and the session is merely producing output
  past it.
- **Manual.** `cmd_swap` without `CCD_SWAP_AUTO` reads the status the way `ws-archive` does, through `_ws_status`
  (≈:5115): `busy` refuses `ccd: session-busy …` unless `--interrupt` is passed, and a status it cannot read refuses
  `ccd: status-unknown …` **whatever the flags**, `--interrupt` included: consent covers a measured turn only, the archive
  rule. There is no override flag; an operator who must move a session whose status cannot be read stops it first (`ccd
  stop`), after which there is no pane and `_ws_status` answers `idle`. The refusal runs **before the detach branch**
  (≈:27147), so a session swapping itself without consent is refused synchronously, on its own stderr, rather than being
  told "detached: will restart" and then refused by a process nobody is waiting for. `swap-self` passes `--interrupt`,
  because a session asking for its own move is busy by definition, and the detach branch's re-run (≈:27163) passes
  `--interrupt` through beside `--force` and `--cross-pool`; inside that re-run (`CCD_SWAP_DETACHED=1`) the same gate runs
  again (a turn can start in the 2 s before it), and a refusal there is recorded on two channels, a `swap-refused-status
  <id>: <reason>` line in `swap.log` and `notify.sh`, **never through `_swap_refuse`**: that function stamps
  `swapblocked`, which holds auto-rescue for `SWAPBLOCK_COOLDOWN` (and would trip hibernation's `swap-blocked` hold), and
  clears `lastswap`, and the detach arm's own comment already rejects it for a failure that has nothing to do with
  carrying the conversation (≈:27156). `ccd caps` advertises `swap-busy-v1`.
- **The server and the PWA.** The swap route reads the same fail-closed verdict as archive. Without consent: `busy` is
  `409 session-busy`, `unmeasured` `409 status-unknown`. With `{interrupt: true}`: `busy` proceeds, `unmeasured` is still
  refused. The argv carries `--interrupt` when the fleet's `ccd` advertises `swap-busy-v1`, else the old argv (an old
  `ccd` refuses nothing). Because `ccd` refuses an unreadable status whatever the flag, a status that becomes unreadable
  between the server's read and `ccd`'s act is refused too. The route maps `ccd`'s own two refusals, `ccd: session-busy:`
  and `ccd: status-unknown:`, to the same two 409s rather than to the generic 502 every other `ccd` failure gets
  (`server.ts` ≈:3285), so a turn that starts without consent between the route's read and `ccd`'s act still reaches the
  operator as `session-busy`, with its "swap anyway". SwapSheet answers `session-busy` with "It's working — swap anyway?
  The turn in progress and its background tasks are lost."
- **What it does not subsume.** `--interrupt` consents to losing what is running now: a measured busy turn, delegated work
  included, because a live word over delegated work is `busy`. #197's wave 7 refusal is wider: it also refuses on
  `stopped-agent` manifest items younger than two hours, which never read busy, and its override is a distinct flag,
  `--cut-delegated`. That refusal and its flag stay wave 7's; the two consents are separate and neither implies the
  other. The diagnosis's "a pending swap holds auto-compact" is covered: a compaction makes the live word `busy`, and the
  re-check then re-queues the swap.

### 5.10 Victim policy (D-5241)

**What ships.**
- `deploy/systemd/tmux-spawn-.scope.d/50-oom-continue.conf` (a prefix drop-in, `[Scope] OOMPolicy=continue`) and
  `deploy/systemd/ccrc-tmux-server.scope.d/50-oom-continue.conf`, placed by the install spine (`_inst_units`,
  `ccd/ccrc` ≈:14854) and by `deploy.sh`'s fallback, so every `ccrc update` and a rebuilt box carry both.
- A tool-child priority: Claude Code runs every Bash tool command through `CLAUDE_CODE_SHELL_PREFIX`. `_spawn_start` sets
  it (Linux only) to a small shipped script, `ccd-tool-adj`, that raises its own `oom_score_adj` to 800 and execs the
  command. Children inherit it; Claude Code stays at 200. Raising one's own score needs no privilege.
- A doctor check, `oom-policy`, that reads both units' `OOMPolicy` and one live pane scope's, read-only.

**Verified first, on throwaway transient scopes only, without risking the fleet** (an operator act; the plan lists the
steps). The investigation measured the user manager's tree **at its cap** (the user-level cgroup at its `MemoryMax`, tens
of thousands of OOM events there, and about half of all OOM kills outside the session slice) [M]. A probe slice is a
child of that tree, so a slice-local cap does not keep a probe's allocation from tipping an ancestor into its own OOM,
and an ancestor's OOM picks its victim across the whole fleet by size. So:
- **Step 0 reads before anything allocates.** `memory.current`, `memory.max`, `memory.swap.current` and
  `memory.swap.max` of the user manager's service and of every slice between it and the probe, and whether
  `systemd-oomd` watches any of them, and the highest `oom_score_adj` among the user manager's processes (`/proc`, read
  only; the investigation measured 200 throughout the session slice [M]). Every ancestor must have at least 1 GiB of
  headroom, or nothing allocating runs. It is read again immediately before each allocating step.
- **Allocating steps run off the fleet box when possible**: on a non-fleet Linux host with the same systemd version and
  cgroup v2. Only the allocation-free steps (the drop-in reaching a scope, a reload reaching a running scope,
  `set-property`, the prefix script) must run on the fleet box itself, because they measure its systemd.
- **If the allocating steps must run on the fleet box**: the probe slice is capped at 64M with no swap, and every probe
  process raises its own `oom_score_adj` to 900 or more, and above step 0's highest reading, before it allocates
  (raising one's own score needs no privilege), so an OOM at any ancestor level picks a probe first. Within the probe,
  the one meant to die scores 1000 and the other 900.

The questions:
1. a prefix drop-in for `ccrc-oomprobe-` applies to a new transient scope (`OOMPolicy` reads `continue`), and whether a
   `daemon-reload` applies it to one already running (allocation-free);
2. with `continue`: the child (the higher score) is killed, the scope stays active, the parent survives; the journal
   signature is recorded;
3. with `stop` (a name the drop-in does not match): the scope fails with `oom-kill`; signature recorded;
4. the parent as the victim (the parent larger and scored higher than the child, the child exiting when its parent
   does, as a pane's processes do when tmux closes the pane), under `stop` and under `continue`: the signature of "the
   main process died", which is what the 32 no-`Failed` deaths look like;
5. whether `systemctl set-property --runtime … OOMPolicy=` is accepted on a running scope (allocation-free).

The shell prefix's argument convention is measured separately, on a workstation, with Claude Code in a throwaway local
`tmux -L` server (the way `2026-10-15-ask-server-half.md` measured AskUserQuestion), and the variable's name is checked
in every fleet build's binary, read-only.

**Rollout and rollback** are operator acts. Rollout is the ordinary `ccrc rollout`, fleet box first. Existing panes
gain `OOMPolicy=continue` only if step 1 shows `daemon-reload` reaches running transient scopes; tool children gain 800
at each session's next spawn. Rollback is explicit, because the install spine never deletes a file an older release does
not know: remove the two drop-in files, `daemon-reload`, and roll `ccd` back (the prefix leaves with the next spawn).

**The trade.** A test run that outgrows memory now fails as a test run; the session stays and is told why. A half-killed
pane (a dead MCP server) can linger; the doctor check and the session's own errors surface it.

### 5.11 Hibernation (D-5242)

**Who decides.** The server. Only it sees every fact the ruling names (open runs, claims, outstanding mail, a viewer with
the session open), and it already assembles the rest every tick. It acts through a new `ccd hibernate <id>`, which
re-measures box-local idle at the act and refuses `session-busy` otherwise, the archive pattern. The verb is whitelisted
by prefix in the agent and gated on `verbSupported`.

**What "idle" means.** All of these, on one assembled row (`server/src/coord/hibernate.ts`, a pure L1 verdict whose every
hold has a name):
- the pane is alive and its status measured; the live word is `idle` (not `busy`, `waiting` or `shell`); no pane menu;
- the bucket is `idle` (hold `bucket` otherwise, `done` included); `background` is null; the roster is empty. **Why not
  `done`:** `done` is a badged bucket (`pwa/src/lib/seen.ts`'s `BADGED` ≈:10) and a dead row never is, so sleeping a
  `done` row could hide a result nobody has read. Holding it costs nothing in practice: the bucket reads `done` only
  while the hookstate is fresh, which is 30 minutes after its newest stamp (`HOOKSTATE_FRESH_MS`, `hookstate.ts` ≈:9 and
  the age cut ≈:358), and N is at least an hour, so a quiet row has already fallen from `done` to `idle`, and lost its
  badge, long before the verdict's clock runs out. That 30-minute lapse is today's behaviour, not this design's (§9);
- the turn marker reads `done` (a StopFailure tail is left alone), its last Stop listed no background task of any kind
  (`bg` exactly 0: shells and monitors would die too, and a `bg` of −1, a Stop whose `background_tasks` was absent or not
  an array, says nothing about them, so it holds as `marker-background`), and its latest of `turnAt`, `stopAt` and
  `restartAt` is more than N hours ago. Compactions do not move that clock, so a session that Claude Code compacts while
  it idles still ages;
- **nothing is scheduled** (hold `scheduled`): the last Stop's `session_crons` was an empty array. Claude Code's crons and
  wakeups (CronCreate, ScheduleWakeup, `/loop`) are session-scoped and are not tasks [B; stall-watch spec §3.1], so no
  live word, background list or roster shows them, and a hibernated session's process is gone when they fall due:
  nothing would ever wake it. The Stop arm records the array's length in the turn marker as `crons` (−1 when the key is
  absent or not an array), and the verdict holds unless it reads exactly 0, so an older hook's marker, which has no
  `crons`, holds as `scheduled` too;
- no hold (`.hold`); **no open run** naming it as worker (`openRunsForSession`) or as claimant (`openRunsClaimedBy`), where
  open is every `RunState` outside `TERMINAL_RUN_STATES` — `planned`, `dispatched`, `working`, `awaiting-review`,
  `merging`, `closing` and `unknown`. That is the `state NOT IN` the terminal set predicate both store reads already use
  (`coord/store.ts` ≈:3185 and ≈:3228; the archive door's `coordinator-has-open-runs` refusal reads the first), and the
  population the dead-coordinator lane sweeps, so a coordinator whose runs wait at `awaiting-review` or `merging` is never
  put to sleep. A run read that fails holds (`runs-unreadable`); no claim it holds; no queued mail to it;
- nobody has it open (hold `viewer`), under this **presence contract**. `Presence` (`server/src/presence.ts`) keeps,
  beside today's visible claim, an *open* claim per `/ws/session/:id` connection: stamped when the socket connects
  (`server.ts` ≈:1734) and re-stamped by every frame the client sends, visible or not, dropped when the socket closes,
  and believed for `PRESENCE_OPEN_TTL_MS` (10 minutes, beside `PRESENCE_TTL_MS` in `shared/api.ts` ≈:4166) after its last
  frame; `isOpen(id)` answers whether any such claim stands. The PWA's heartbeat (`pwa/src/stores/session.ts`'s `beat`
  ≈:682) today re-states the claim only while visible, so a hidden tab sends one `visible:false` and then nothing, and an
  open claim on the visible TTL would lapse in 45 s; it now re-states every `PRESENCE_REFRESH_MS` whatever the
  visibility, sending `visible:false` while hidden, which `isVisible` reads exactly as today (a hidden tab still gets its
  notifications). A browser throttles a hidden tab's timers to about once a minute at the most [I, browser documentation],
  inside the 10-minute TTL, so **a hidden but open tab holds its session**. A page the browser has frozen or the OS has
  suspended runs no timer and sends nothing; its claim lapses after the TTL, and that is the case the wake trigger below
  covers when the operator returns. Presence is never persisted (`presence.ts`: "a server that just restarted
  correctly believes nobody is watching"), so for `PRESENCE_OPEN_TTL_MS` after the server starts every candidate holds
  as `viewer`: a hidden tab that has not yet reconnected after a deploy is not taken for an empty screen;
- not stranded, swap-blocked, under a substrate fault, archived or expiring; no opt-out marker `$REG/<id>.no-hibernate`.

`ccd hibernate` re-measures the box-local half at the act: live `idle`, no `esc to interrupt`, a prompt with an empty box,
60 s of quiet, the marker `done` with `bg` and `crons` both exactly 0 (−1, unknown, refuses in both), no `.hold`, no `.no-hibernate`, no fresh `lastswap`, and
**nobody attached**: tmux's `#{session_attached}` reads 0. That last hold (`attached`) is the one the server cannot see —
an operator in a terminal attach or `cc`, or the PWA's own terminal drawer, which attaches a pty through `tmux attach`
(`server/src/pty.ts` ≈:22, `agent/src/pty.ts` ≈:39) — and it lives in `ccd` because only the box can read it.

N defaults to 6 hours and is read from `$REG/hibernate-after-hours` when the operator writes one (1 to 168). Six hours is
past Claude Code's one-hour prompt-cache lifetime, so a wake costs no cache that idling would have kept; the measurement
plan reports the idle-age distribution before the operator arms it.

**Shadow first.** Without `$REG/hibernate-live` the sweep only logs `hibernate-shadow <id> idle=<h>h` lines. With
`$REG/hibernate-disabled` it does nothing. Neither marker has a writer in the tree (`single-definition.test.ts` pins that,
as it does the stall-watch markers). The sweep runs on its own clock, every 5 minutes, at most 3 hibernations a sweep.

**The act, journalled as a deliberate one.** `cmd_hibernate` journals a new lifecycle act, `hibernate` (`_lc_done
hibernate`, added to `_LC_ACTS` and to `LifecycleAct` together, as `lifecycle-vocabulary.test.ts` requires), then keeps
the operator's model choice (`_operator_choice_keep`), writes `$REG/<id>.hibernated` (`<epoch> <idle-hours>`),
unsupervises through `_ws_unsupervise` (a `stopped` stamp) and kills the pane. The lifecycle reads `stopped`, honestly:
hibernation is a deliberate stop, and no new lifecycle word is needed on the wire. **What the journal row protects.**
While the row reads `stopped`, the dead-coordinator lane never counts it: `deadCoordinatorCrash` answers `stopped` before
it reads the journal at all (`deadCoordinator.ts` ≈:248). The row matters after a wake that failed: `cmd_ensure` has
removed `.stopped` and `.hibernated`, the spawn failed, and the row reads `orphan`, a dead cause the lane does count. The
lane then reads the journal since the last successful start, where `_ws_unsupervise`'s own row carries the surface `none`
when `ccd` acts on its own account, which `isDeliberate` reads as a crash; the `hibernate` row before it is what makes
that history deliberate, so `hibernate` joins `DEAD_COORDINATOR_DELIBERATE_ACTS`. A server older than the act parses it
as `unknown`, which that clause already counts as deliberate ("doubt never reads as a crash"), so the version skew is safe
in both directions. Every other deliberate stop ends a hibernation: `ccd stop` and `ccd ws-archive` remove `.hibernated`
with their own stamp, so an archived or stopped row is never woken by mail.

**What the server shows.** `FleetSession.hibernatedAt` (additive). Its presence comes from the registry listing the reader
already takes, so it costs no read per tick; the bytes are read only when it is listed. The bucket stays `dead` (no new
bucket member); the PWA words a dead row with `hibernatedAt` as `hibernated · 6h` with a calm dot, never as a death, and
never badges it.

**Every reader that treats a session as dead for good** consults `hibernatedAt` first. A census test derives the readers
and fails on one that does not state its stance. Not every such reader calls `lifecycleIsDead`, so the derivation takes
five sources, by scanning `server/src`, `shared` and `pwa/src`: every reader of `lifecycleIsDead` or `DEAD_LIFECYCLES`;
every total `Record<SessionLifecycle, …>` table (`coord/peers.ts`'s `LIFECYCLE_RUNG` ≈:38 and `ARCHIVE_CONTRADICTS` ≈:69
among them); every comparison of a lifecycle or a claimant cause with `'stopped'`; and every reader of the tmux verdict,
which can call a session gone without any lifecycle (`tmux.sessionVerdict(` calls, a probe field typed from it such as
`PeerProbe.tmux`, and `coord/claims.ts`'s `LivenessVerdict`); and every comparison of `status`, `bucket` or
`effectiveStatus` with `'dead'`, which calls a row dead with no lifecycle word at all (the session's own header,
`pwa/src/session/SessionHeader.tsx` ≈:192 and ≈:251–259, paints such a row "✕ not running"; it reads `hibernatedAt` and
words it `hibernated`, so a sleeping session's screen never shows "not running" above "Waking…"). The census covers the
server tree; the box-side sweeps keyed on a live process were audited by hand, and `ccd-tmp-sweep`, the only one today,
counts a hibernated row as live (below). A hit whose word means something else (the collector's own
`stopped` lane state) states that as its stance. Each stance is argued from what the reader actually reads, not only from
the verdict's holds (a run can be opened naming a sleeping session: `POST /api/runs` takes `claimedBy` from its body):
- the mail lane (`watch.ts` ≈:6826) wakes the recipient instead of backing off and parking: `ensure`, at most once per id
  per 10 minutes, only for a delivery that would otherwise be sent (mail not disabled), and only inside the fleet-wide
  **wake budget**: hibernation turns mail, dispatch and opens into cold `--resume` spawns on a box measured at its memory
  cap, and `ccd`'s spawn path has no concurrency control of its own (the swap path needed `SWAP_JITTER` for exactly this
  herd). So the server starts at most 2 automatic wakes in any 60 s, fleet-wide, oldest delivery first; the rest stay
  outstanding under gate `hibernated`, not counted toward parking, until the window has room. A wake an operator or a
  coordinator asks for (the PWA's open or Wake, a dispatch) is never refused for the budget, but it counts in the window,
  so it pushes automatic wakes back. A kickoff is mail: the kickoff route queues system mail (`queueProgramKickoff` →
  `queueSystemMail`, `coord/kickoff.ts` ≈:146) and never refuses a dead session, so it wakes through this lane and needs
  no change of its own;
- `GET /api/peers` (`coord/peers.ts`'s `peerDeliverable` ≈:51), which worker-skill clause 11 names as discovery, answers
  `no:session-gone` from the tmux rung before it reaches `LIFECYCLE_RUNG`. Its probe gains `hibernated`, read from the same
  registry listing, and a hibernated peer answers `yes`, because mail to it is delivered once the lane has woken it;
  `PeerSummary` gains an additive `hibernatedAt` so the reader can tell why its lifecycle reads `stopped`.
  `deliverability-parity.test.ts`, which holds `sweepMail` and `peerDeliverable` to one decision, gains a hibernated row
  on both sides;
- `inArchivedFold` (`shared/api.ts` ≈:9472): its second clause (a stopped main checkout) leaves a hibernated row at the
  top level; an archived row stays in the fold by its first clause;
- `coord/claims.ts`'s `claimExpiry` lapses a claim whose holder is `gone`: it meets no hibernated holder, because the
  verdict holds `claim` and a sleeping session takes none;
- `measureClaimant` (`coord/reclaim.ts` ≈:125), which both the reclaim door and the dead-coordinator lane read, answers a
  hibernated claimant `alive` (why: `hibernated`): the reclaim door then refuses as it does for any live claimant, and the
  PWA offers Wake; the dead-coordinator lane releases it, and after a wake that failed (the row then `orphan`, no longer
  hibernated) it reads the `hibernate` journal row as deliberate (above);
- the stall watch (`coord/stall.ts` ≈:1061) meets none through a run the verdict let it sleep under; a run opened later
  dispatches through `ensure`, which wakes it;
- `ccd forget` refuses a hibernated row (`hibernated`: wake it, or stop it first), and the PWA's Forget, offered for any
  dead non-workspace row today, is hidden on one and replaced by Wake. `ccd stop` on a hibernated row turns it into an
  ordinary stop and `ccd ws-archive` into an archive (each removes `.hibernated`), after which Forget works as before;
- the PWA's `coordWords.ts` words it `hibernated`.

**What sleep keeps.** A sleeping session has no process, and `ccd-tmp-sweep` reaps the Claude Code temp directory
(scratchpad and task outputs) of a session with no live process once nothing in it has changed for its maximum age
(7 days by default; liveness is a `sessions/<pid>.json` whose pid runs, or a running `--resume <uuid>`). Left as it is,
a session asleep past that age would wake, resuming the same uuid, into an empty directory. So the sweep counts every
registry row with `.hibernated` as live, its uuid read from `.uuid`, and refuses the pass when such a row's uuid cannot
be read, its own fail-closed rule.

**Waking.** `cmd_ensure` and `cmd_start` remove `.hibernated` with `.stopped`. The paths:
- **the PWA, whenever a screen shows a sleeping session.** A mounted SessionScreen wakes its session once whenever its
  row reads hibernated (`dead` with `hibernatedAt`) while the page is visible: at mount, when the page becomes visible
  again (an operator returning to a background tab or a resumed phone), and when a frame turns the row hibernated while it
  is in view. One `POST /api/sessions/:id/ensure` is in flight per screen at a time, re-armed only once the row reads
  alive or the call fails. The screen shows "Waking…" and a Wake control, and the composer is disabled while the row is
  hibernated, so nothing is typed toward a pane that does not exist;
- a dispatch: the resume arm already calls `ensure` (≈:748); §5.7's `worker-starting` answer and its wait outside the
  mutex cover the spawn;
- mail, and with it a kickoff (above), inside the wake budget.

The spawn is the ordinary `--resume`; a hibernated session's tail is a finished turn, so nothing is re-driven.

**Interactions.**
- *Swaps.* A hibernated session has no supervisor, so no auto swap or rescue runs. A manual swap of one is refused
  `409 hibernated` (SwapSheet offers Wake instead; `cmd_swap` refuses `ccd: hibernated`). A woken session is not swapped
  cosmetically for `SWAP_COOLDOWN`, so a wake is never followed at once by a second cold start.
- *Route.* A `/model` or effort route written while it sleeps is applied by the wake's spawn, which reads the route
  record, as `ccd start` already does.
- *Auto-compact.* No tick, no compaction while asleep. The verdict requires the live word `idle`, so it never fires
  during a compaction, and compactions do not reset its clock.
- *Stall watch.* Covered by the census above.
- *Scheduled work.* Held, never hibernated (the `scheduled` hold above). A session with a recurring cron therefore never
  hibernates; the operator removes the cron, or accepts that.
- *Remote control.* A hibernated `--remote-control` session disappears from Claude Code's own app until ccrc wakes it. The
  opt-out marker is the remedy for a session the operator drives from there.

---

## 6. Ordering, lanes and other programmes

### 6.1 Order, and how it is enforced

1. §5.2's carry engages on the fleet only behind §5.1's server half, §5.7 and §5.2's own stall clocks on the server the
   fleet talks to (§5.2's "Order").
2. §5.8's skip engages on the fleet only behind §5.7 on that server.
3. §5.9's `ccd` half before its server half (the server needs `swap-busy-v1`; `capSupported` enforces it).
4. §5.10's verification before its shipping PR; its rollout after both.
5. §5.11's `ccd` half, then server, then PWA, then a shadow week, then arming. It depends on §5.2 (an empty roster must
   mean something) and benefits from §5.10. `verbSupported` enforces the first step; nothing can hibernate until the
   server half that carries the wake paths is live (the plan's Task 17b).

Items 1 and 2 are the two places where a fleet-side change is safe only behind a server-side one. Every way a node moves
has the fleet first, or no order at all: `ccrc rollout`'s default (the fleet box, then the server box), the PWA's one-tap
and the update control plane's dispatcher, which with `auto` on moves a node to its desired tag with nobody involved and
holds a server-role node `waiting-for-fleet` until the fleet nodes have moved (`planDispatch`, `server/src/update/
dispatch.ts` ≈:269–308); `deploy.sh`'s fallback and a hand-run `ccrc update` on one box have none. A rollout form cannot
reach all of them, and a server rolled back below its release, or a server leg that fails its health gate and restores
the old build, would leave the fleet ahead of it with nothing to notice. So **the fleet half gates itself on the server
it talks to**, and the order becomes a property of what is merged rather than of who moves the boxes:

- **The server advertises its capabilities as words.** `/health` (`server.ts` ≈:1182, exempt from the auth gate,
  `auth/gate.ts` ≈:211) gains an additive `caps`, the list `SERVER_CAPS` defined once in `shared/api.ts`. A word is added
  by the change that builds what it names, or, for what was built before the list existed, by the change that creates
  the list; either way that change is cut after everything the word promises (it edits test files those changes create),
  so a server cannot advertise a word without everything behind it. `dispatch-live-gate-v1` names §5.7 and seeds the
  list; `hook-main-state-v1` names §5.1's rung, §5.7 and §5.2's stall clocks together, because §5.2's change, which adds
  it, is cut after the other two.
- **The fleet box records what its server advertises** in `~/.ccrc/server-caps`, three lines (`at <unix seconds>`, `caps
  <word> …`, `end`), written tmp-then-rename by the box's own clock: on a `fleet`-role node by `ccd-update-sync`, which
  already pulls from the same server every minute (`OnUnitActiveSec=60s`; armed on that role alone, `ccd/ccrc` ≈:15353),
  in a second request of its own to `/health` whose failure writes nothing and never stops the intent pull, placed right
  after the server URL is read and before the node-id and box-token checks, each of which exits; on a `server` or `both`
  node by the server process itself, once at boot and then on a minute beat of its own. That beat is deliberately not
  the inventory lane's, which runs only with a coordination database (`watch.ts` ≈:2003): tied to it, a coord-less
  server's file would lapse after boot and its fleet would never engage the arms. A `/health` with no `caps` (an older server) is written as an empty list:
  the whole answer arrived and it names nothing.
- **The hook reads it with builtins only** (one `read` of a three-line file, no fork, inside the PostToolUse budget) and
  engages a gated arm only when the file is whole, its `at` is no more than 180 s old by the hook's own clock (three sync
  periods) and not in the future, and the arm's word is listed. Absent, stale, torn or not listed reads as not
  advertised, and the arm writes exactly what it writes today, which every server reads correctly; that is the fail-safe
  direction.

What each mover does then:
- **Fleet first, by any route** (the default rollout, the one-tap, `auto`): the new hook runs with its gated arms off
  until the server moves and the next sync lists the word, at most a minute later. A server leg that fails and restores
  the old build keeps the arms off indefinitely, which is today's behaviour.
- **Server first** (`--server-first`): the word is listed before the hook arrives; `--server-first` is now a way to shorten
  the window above, never a requirement.
- **A server rolled back below the word's release:** on a `fleet` node, the next sync, at most a minute after the old
  server answers, lists no such word, and the arms go off. On a `server` or `both` node the file is the server's own,
  and an older server never rewrites it, so the arms go off when it ages out, within the 180 s lease. A rolled-back
  server is never asked to read the new meanings for longer than that (about a minute behind a fleet node, at most
  180 s on a `server` or `both` node), and a server that stays unreachable ages the file out in 180 s. A server rolled back between the two words'
  releases keeps §5.8's skip and turns §5.2's carry off, which is exactly what it can read.
- **A box whose sync is not armed** (a fleet box moved by `deploy.sh`, or one with no recorded role) never engages the
  arms; doctor's `server-caps` check says so, and the remedy is the box's ordinary first move onto the release lane.

### 6.2 Lanes

- **Fleet first** (hook or `ccd`): §5.1, §5.6, §5.9's `ccd` half, §5.10, §5.11's `ccd` half. Every server reader of a
  new hook or registry field treats its absence as the old behaviour, so the default `rollout` order (fleet box, then
  server box) is safe for them.
- **Fleet, self-gated** (hook): §5.2's carry and §5.8's skip. They add no field the server must read; they change what an
  existing field means (a hook `done` now stands through delegated work and through a compaction), so they engage only
  while the server advertises their word (§6.1), and every mover's order is then safe. §5.2's server half (the stall
  clocks) and the word ride the same change.
- **Server lane** (server and PWA bundle): §5.3, §5.4, §5.5, §5.7, §5.9's server half, §5.11's server and PWA halves, and
  the server's half of §6.1's words (`/health`'s `caps` and the server-written file), whose fleet half (`ccd-update-sync`'s
  pull) is safe in either order: a puller ahead of its server records an empty list, and a server ahead of its puller is
  simply not yet recorded.

### 6.3 Session continuity (#197)

This design overlaps three items of that programme, and **proposes** to take them; the take-over is conditional on that
programme's coordinator agreeing, and the operator's ruling of 2026-10-16 does not decide it. The items: wave 5's third
(`OOMPolicy=continue` on a scratch pane scope, done here on throwaway scopes with no scratch account needed); the cause
clause of wave 6's composed redrive prompt (§5.6 composes only the cause; wave 6 builds on it); and, partly, wave 7's swap
refusal: `--interrupt` (§5.9) covers a measured busy turn, delegated work included, while wave 7's refusal on
`stopped-agent` manifest items and its `--cut-delegated` override stay wave 7's. Until the coordinator agrees, those
items stay in both programmes and whichever lands second merges onto the first. Wave 4b's spawn-environment variable and
this design's shell prefix both compose at `_spawn_start`; the same rule applies.

---

## 7. Invariants

1. A hook `done` unseats a live `busy` only when the Stop listed no delegated work or the build's live word does not
   cover delegation.
2. An event with an `agent_id` changes no main `state`, `event` or `updatedAt`, except a subagent's own wait and its
   restoration.
3. A Finished push has a main Stop inside its busy episode.
4. A status this tick could not read is never painted as a measured idle.
5. No path the console drives sends Escape to a session whose only activity is background work: delegated work under
   a live `busy` after a newer main Stop, or the live word `shell`. (The terminal drawer is a terminal: a physical
   Escape typed into its focused pane goes to Claude Code by ruling P4, and is recorded as `drawer-escape`.)
6. Every Escape the server or `ccd` sends, and every process end `ccd` observes, leaves a record naming its source or cause.
7. The dispatch `/clear` is typed only into a pane whose live word was measured `idle`, twice: at the gate and at the act;
   and waiting for a pane the dispatch started never holds the coordination mutex.
8. A compaction never moves `bucketSince` and never mints a `done`.
9. Every swap that kills a process re-measures at the act, before any write of the stop path, `degraded` included; a
   manual one needs consent to kill a measured turn and never kills an unmeasured one, from any surface; a cancelled
   rescue undoes only the decision's own limits row, only on a measured not-blocked answer, and never a credential
   verdict.
10. A tool child is a likelier OOM victim than its Claude Code, and its death does not end the pane.
11. A hibernated session is never worded, badged, parked, reclaimed, forgotten, reported undeliverable or ended as dead,
    and every path that needs it wakes it, a screen already showing it included; automatic wakes are bounded fleet-wide.
    Nothing is hibernated while it has scheduled work, an unknown background list, an open run in any non-terminal state,
    a `done` bucket, an open screen (visible or hidden) or an attached terminal.
12. The stall watch reads subagent activity wherever it lives: `delegates` and `frozen` read `aliveAt` beside
    `updatedAt`, and a compaction refreshes neither.
13. A hook arm that changes what an existing field means engages only while the server the fleet talks to advertises
    the word for it, as measured within the last 180 s; absent, stale or unreadable reads as not advertised, and the arm
    then writes what it writes today.

---

## 8. Measurement plan

**Instrument.** A read-only, box-local sampler (`deploy/measure-working-state.py`), in the shape of
`deploy/measure-continuity.py`: it reads live files, hookstate files, turn markers, the user journal, `swap.log` and the
server's feed; it runs no tmux, writes nothing outside its own output, and reports counts only. The transcript reads it
needs to classify a push stay on the box; no text leaves it.

| Metric | Baseline [M] | After |
|---|---|---|
| `done` while the live file is busy and the last Stop listed delegated work: episodes per hour, and share of busy session-seconds | 14 episodes in 420 s, about 12 of them delegation-caused; 1.9% | 0 delegation-caused (the two race shapes may remain) |
| False Finished pushes: compaction-only, mid-turn, restart, overload | about 77 of 385 classifiable in 42 h (20%, about 44 a day) | at most 2% of classifiable |
| Fresh `done` badges with no turn (after a `manual` PostCompact) | about 20 a day [I] | 0 |
| Delegated episodes that end with no `done`: the live file goes `busy`→`idle` after a Stop that listed delegated work, the turn marker reads `done`, and the row reads `idle` because the hookstate aged out (§9) | not measured | reported; a fix is ruled on if it is not rare |
| Stall-watch notices to workers idle over background agents, and `frozen` notices during a foreground Agent call (the §5.2 regression guard) | baseline from the week before Task 2 | no increase |
| Roster entries older than their session's process | 316 entries across 32 of 92 files | 0 |
| Idle rows with hookstate `working/PostCompact` | 12 of 58 | 0 |
| Session deaths per day; of them within 15 s of a pane OOM kill; by journal signature (child victim, main victim) | 102 in 7 days (about 14.6 a day); 92 OOM-associated; 61 with a `Failed` line | OOM-associated deaths with a child victim: 0; the rest reported, not targeted |
| Re-driven restarts followed by another within 10 min | 9 of 26 | reported |
| Swaps that killed output | auto-home 0/132, rescue 5/45, manual 8/24 (15 days) | 0 without consent |
| Interrupts by source per week | not measurable (nothing logged) | reported |
| Hibernations and wakes per day, by wake path; memory freed (slice `memory.current`) | about 40 idle processes at about 0.24 GB anonymous memory each [M, verifier's correction] | reported |
| Memory around wakes: the session slice's and the user tree's peak anon memory (`memory.stat` `anon`, not page cache), `memory.events` `oom`/`oom_kill` deltas and `memory.pressure` in the 2 minutes after each wake and each wake burst, and OOM kills within 120 s of a wake | the same window after each cold `--resume` restart in the shadow week (a restart is the same spawn) | reported; Task 19's stop rule disarms on it |
| Gated hook arms engaged: fleet boxes whose `server-caps` is current and lists each word | not applicable | every fleet box within a minute of its server's move |

**Windows.** The investigation's figures (2026-10-08 to 10-15) are the baseline of record. If the instrument lands before
the first deploy it re-captures them and must reproduce them within tolerance, which validates it; no status fix waits for
it. Each lane is measured again seven days after it deploys. Results are recorded in the plan, by a docs PR.

---

## 9. What this does not claim

- That the 6-session overload cluster came from a null `panePid` rather than a torn read: either is now unmeasured.
- That `oom_score_adj` makes Claude Code safe: a Claude Code process larger than every child is still the likelier victim.
  The 32 deaths with no `Failed` line are reported by signature after rollout, not promised away.
- That N, the hibernation threshold, is right: the shadow week and the idle-age distribution decide it.
- That a rolled-back server never reads a gated arm's meaning: after the old server first answers, the hook may still
  have the arm on for about one sync period (a minute) on a `fleet` node, and for up to the 180 s lease on a `server`
  or `both` node, whose file the older server never rewrites (§6.1).
- That a hibernated row keeps a badge: the verdict never sleeps a `done` row, but a `done` row already lapses to `idle`,
  and loses its badge, 30 minutes after its newest hookstate stamp, today, before any hibernation.
- That "N in background" counts only what is running: it counts what the last Stop listed.
- **That `done` always survives a long delegated run.** The badge and the bucket read the hookstate, which ages out
  30 minutes after its newest stamp. Under §5.2 agent events keep it fresh through `aliveAt`, and the common ends write
  one more: a subagent's end fires a SubagentStop (an agent event), and Claude Code then runs a notification turn that
  ends in a fresh main Stop [M, verifier]. A delegated kind whose end fires no hook event after more than 30 minutes of
  agent silence (one long command inside a subagent, then a teammate or cloud session finishing) leaves the row `idle`
  with no `done`, while §5.3's marker-based push still fires. That is a known limit, counted by §8's row, not fixed:
  feeding the turn marker into the bucket would add a read per busy row per tick (#390).
- That session crons survive a restart. They are session-scoped [B], so an OOM restart or a swap may lose them as a
  hibernation would; §5.11 holds hibernation on them, and the restart case is not addressed here.
- That Claude Code will keep its delegation set, its task-type labels, its task statuses or the Stop payload's
  `background_tasks` and `session_crons`: every build bump re-runs the read-only binary check the plan names (Task 13,
  step 7), extended to those four.

---

## 10. Open and later (not ruled)

- **Stale `waiting`** outranks a newer live idle (`shared/api.ts` ≈:1480). Recommendation: apply the freshness comparison
  to the attention rung when no pane menu is showing.
- **`/ws/fleet` heartbeat** (the 2026-08-17 spec's §5.6). Recommendation: an inactivity watchdog in `pwa/src/lib/ws.ts`.
- **A crash-loop back-off** for OOM re-drives (§1.3, I1b). Recommendation: a second OOM end within 10 minutes spawns with
  no re-drive and pushes the operator.
- **`_route_escape` re-check** before each Escape, before D-5009's drawer adds more Escape sends.
- **Memory outside the slice** (I1c): the usage scan and the graph sweep need their own caps or schedule.
- **A ceiling** on `liveStatusCoversDelegation`, re-measured on every Claude Code bump.
- **An upstream report** that Claude Code labels a model's own TaskStop "interrupted by user".

---

## 11. Deviation numbers (issued 2026-10-16)

Defined once, in the plan's §Deviations found.

| Number | Slug | Section |
|---|---|---|
| D-5231 | `background-aware-working` | §5.1 |
| D-5232 | `agent-events-keep-the-main-state` | §5.2 |
| D-5233 | `finished-needs-a-main-stop` | §5.3 |
| D-5234 | `failed-reads-are-unmeasured` | §5.4 |
| D-5235 | `sheet-escape-never-interrupts` | §5.5 |
| D-5236 | `background-only-interrupt-warns` | §5.5 |
| D-5237 | `interrupt-and-restart-causes-recorded` | §5.5, §5.6 |
| D-5238 | `dispatch-clear-needs-live-idle` | §5.7 |
| D-5239 | `compaction-carries-the-prior-state` | §5.8 |
| D-5240 | `swap-guards` | §5.9 |
| D-5241 | `oom-victim-policy` | §5.10 |
| D-5242 | `hibernate-long-idle-sessions` | §5.11 |
