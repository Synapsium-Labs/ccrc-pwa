# Working-state truth and session interruptions (design)

**Status:** rev 0 (2026-10-16). It records the operator's rulings of 2026-10-16 (§2) and the coordinator calls made
under them. Every number in it is issued: D-5231 to D-5242, defined once in the plan's §Deviations found. The four box
acts (§5.10's verification, rollout and the tmux-server drop-in; §5.11's arming) are operator acts under the SAFETY rules
and are not authorised by this document.

**Date:** 2026-10-16 · **Branch:** `docs/working-state` (from `origin/main` `0b3ff2f6`)

**Plan:** `docs/superpowers/plans/2026-10-16-working-state-and-interruptions.md` (tasks, tests, mutation tables, lanes, the
measurement plan and the ledger entries).

**Citations** are to `origin/main` `0b3ff2f6`. Line numbers are hints, written `≈:`, and every citation also names its
function or constant. **[M]** marks a measured figure and **[I]** an inferred one.

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

**Coordinator calls, made under those rulings.** The interrupt route on a session idle over delegated work warns instead
of sending Escape, with a separate explicit "stop background tasks" only if Claude Code exposes one (otherwise it only
warns). A turn ended by Escape or a kill no longer pushes Finished.

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
- **Wire discipline.** Every new field is additive, read through a single reader, absent means the old behaviour, and
  `reviveFleetSession` computes it. **No new `SessionBucket` member** (README, "The attention bucket": the live frame is
  cast, so an unknown bucket crashes a deployed PWA). No new `SessionLifecycle` member.
- **The hook's shape.** Nothing new above `ccd/session-hook.sh:2900` (README anchors it; D-3615 put all new logic in the
  tail). The PostToolUse hot path stays under its pinned budget (p95 of 20 runs under 150 ms).
- **SAFETY.** No session, test or script touches the fleet's tmux, `~/.cc-sessions`, `~/.cc-limits` or
  `claude-session@*` units. Box configuration changes are operator acts that name the rule they are taken under.
- **`ccd` is the authority on the box.** The server refuses, forecasts and composes; `ccd` re-measures at every act that
  kills a process.

---

## 5. Design

### 5.1 Background-aware working (D-5231)

**What the hook records.** The Stop arm already parses `background_tasks` (≈:3024). Its one `jq` gains two more output
lines: the number of listed tasks whose cleaned `type` is neither `shell` nor `monitor`, and those kinds, unique and
comma-joined. The measured types in Stop payloads are `workflow`, `subagent`, `shell`, `monitor` and `teammate` [M]. The
rule is **every kind except `shell` and `monitor`**, which mirrors Claude Code's own delegation set: an idle main loop
over only a shell or a monitor writes the word `shell`, not `busy` [M, binary], and that is the case D-75 was written for,
so a Stop listing only those still settles `done`. A kind no build has shown yet counts as delegated: it only matters while the live file
reads `busy`, and after a Stop that word means delegated work or a wedge, so an unknown kind is likelier the former. The
hookstate gains `bgDelegated` (an integer) and `bgDelegatedKinds` (a string), written on a main Stop whose
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
`waitBy` and the two background fields, read by the one fresh read the hook already takes (`_hook_fresh_read`, ≈:3954),
and writes `aliveAt` = now. That is D-4041's carry generalised from a main-thread wait to every main state, and it is the
**freshness replacement** the verifier required: agent events used to be what kept a long foreground Agent call's
hookstate inside the 30-minute cut, and `hookstate.ts`'s age clock already reads the later of `updatedAt` and `aliveAt`
(≈:358), so they still do. An agent event with no hookstate file yet is inert.

**One exception: a subagent's own wait.** A subagent's AskUserQuestion or PermissionRequest still writes `waiting` with
`waitBy: "subagent"` and a fresh stamp (attention needs it), and now also stores `waitPrev`: the state, event and stamp
it replaced. The next agent tool event over that wait restores `waitPrev` (plus `aliveAt`) instead of writing `working`.
A file with no `waitPrev` (written by an older hook) falls back to today's `working`. A main event ends any wait, as now.

**The roster.** Entries gain `id` (the payload's `agent_id`, cleaned to `[A-Za-z0-9_-]{1,64}`). A SubagentStart adds an
entry unless that id is already listed; a SubagentStop removes the entry with its id, and is a no-op when none matches
(the side agents' Stops). SessionStart `startup`, `clear` and `resume` empty the list; `compact` keeps it (its arm exits
first, ≈:3017, and a compaction kills no agent). At a main Stop: a measured `bg` of 0 empties the list; a `bg` of 1 to 8
with no `workflow` kind keeps only entries whose id is among the Stop's background ids; anything else leaves the list
alone (workflow agents are not listed individually, and the hook keeps at most eight ids). Entries without an `id`
(written by an older hook) are dropped at the first prune. **Measured first:** that a background subagent's task id
equals its SubagentStart `agent_id`. If it does not, only the `bg = 0` rule ships.

**Order.** This must not reach the fleet before §5.1. With agent events no longer writing `working`, a Stop's `done`
would otherwise stand unopposed over the whole delegated run, which is worse than today's flap.

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
  the document. Escape with nothing open still interrupts, as today.
- **Escape over delegated work warns (D-5236).** The interrupt route assembles the one row it is asked about (as archive
  does). When the live word is `busy`, the hook says the main turn ended (`done` from a Stop, newer than the live stamp),
  `background` is set and no menu is pending, it answers `409 background-only` with the count and kinds and sends no key.
  Escape there interrupts nothing and stops none of the background work. The PWA says so: "The main turn has finished;
  N background tasks (kinds) are still running. Escape would not stop them." A menu that is up (a Deny) is never
  background-only. **Measured first:** whether the fleet's Claude Code build exposes an operator command that stops
  background tasks and can be driven and proved by pane captures. If it does, its route is a separate decision, named by
  slug in the plan; if not, the route only warns.
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
  fails. `cmd_swap` records `swap-auto-home`, `swap-auto-rescue` or `swap-manual` before it stops the unit. The cause goes
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

Two refinements. An `ensure` that just started the pane (its answer is not `alive: <id>`) is polled, bounded at 60 s,
until the verdict is `idle`, because a pane that has not yet published its live file reads `unmeasured`. And the verdict
is read again immediately before the `/clear` is typed, since the hold and the route write sit between the gate and the
act (the existing comment at ≈:911 names that window).

**This lands before §5.8, and is on the server box before §5.8 reaches the fleet.** With the compaction carry alone, an
idle compaction leaves hook `done` standing while the pane compacts, and the hook-only gate would type `/clear` into it.

### 5.8 Compactions carry the prior state (D-5239)

PreCompact and PostCompact, `auto` and `manual` alike, keep the file's `state`, `event`, `updatedAt` and `ask`, and write
`aliveAt`. An idle compaction therefore leaves `done` (or `idle`) exactly as it was, with no fresh `bucketSince` and no
badge; a compaction in mid-turn leaves `working`. A compaction with no hookstate file writes nothing. The turn marker is
untouched (it never recorded compactions). During the compaction the live file reads `busy` [M], which is what the mail
gate and §5.7's gate act on.

**Measured first:** whether a typed `/compact` (the operator's or `ccd`'s auto-compact) fires UserPromptSubmit, and with
what `prompt`. If it does, the tail treats a main UserPromptSubmit whose prompt is `/compact` or starts with `/compact `
as the start of a compaction: it writes no state and opens no turn in the marker. That arm lives in the tail, below
`:2900`.

### 5.9 Swap guards (D-5240)

- **Auto, non-rescue.** `_dispatch_swap` passes the arm and the row's previous `lastswap` into the transient unit.
  `cmd_swap`, for an automatic affinity swap, runs the same idle gate the decision ran (`_auto_swap_check`'s non-blocked
  arm, ≈:19217–19241: no `esc to interrupt`, a prompt, live `idle`, `SWAP_CEIL_QUIET` of quiet) immediately before
  `_svc_stop`. Busy: it writes `requeue <id>: busy after jitter`, restores `lastswap`, and stops nothing. The next tick
  decides again.
- **Rescue.** At the act, `cmd_swap` re-runs the blocked verdict for the current lane; not blocked any more:
  `rescue-cancel`. And it reads the transcript from the byte offset recorded at the decision: an appended assistant entry
  that is not an API-error message means the session is working: `rescue-backoff`. Both restore `lastswap` and stop
  nothing; a lane that is still blocked is re-decided on the next tick.
- **Manual.** `cmd_swap` without `CCD_SWAP_AUTO` refuses a busy session (live word not `idle`, or `esc to interrupt` on the
  pane, or a turn marker `working`) with `ccd: session-busy …` unless `--interrupt` is passed. An unreadable status refuses
  `status-unknown` unless `--interrupt`. `swap-self` passes `--interrupt`, because a session asking for its own move is
  busy by definition. `ccd caps` advertises `swap-busy-v1`.
- **The server and the PWA.** The swap route reads the same fail-closed verdict as archive. Without consent: `busy` is
  `409 session-busy`, `unmeasured` `409 status-unknown`. With `{interrupt: true}`: `busy` proceeds, `unmeasured` is still
  refused (the archive rule: consent covers a measured turn only). The argv carries `--interrupt` when the fleet's `ccd`
  advertises `swap-busy-v1`, else the old argv (an old `ccd` refuses nothing). SwapSheet answers `session-busy` with
  "It's working — swap anyway? The turn in progress and its background tasks are lost."
- **What this subsumes.** #197's wave 7 planned `--cut-delegated`; one consent word, `--interrupt`, already covers
  delegated work, because a live word over delegated work is `busy`. The diagnosis's "a pending swap holds auto-compact"
  is subsumed too: a compaction makes the live word `busy`, and the re-check then re-queues the swap.

### 5.10 Victim policy (D-5241)

**What ships.**
- `deploy/systemd/tmux-spawn-.scope.d/50-oom-continue.conf` (a prefix drop-in, `[Scope] OOMPolicy=continue`) and
  `deploy/systemd/ccrc-tmux-server.scope.d/50-oom-continue.conf`, placed by the install spine (`_inst_units`,
  `ccd/ccrc` ≈:14854) and by `deploy.sh`'s fallback, so every `ccrc update` and a rebuilt box carry both.
- A tool-child priority: Claude Code runs every Bash tool command through `CLAUDE_CODE_SHELL_PREFIX`. `_spawn_start` sets
  it (Linux only) to a small shipped script, `ccd-tool-adj`, that raises its own `oom_score_adj` to 800 and execs the
  command. Children inherit it; Claude Code stays at 200. Raising one's own score needs no privilege.
- A doctor check, `oom-policy`, that reads both units' `OOMPolicy` and one live pane scope's, read-only.

**Verified first, on the fleet box, on throwaway transient scopes only** (an operator act; the plan lists the steps). A
scope named `ccrc-oomprobe-<n>.scope` in a throwaway slice capped at a few hundred megabytes, so its OOM is cgroup-local
and cannot reach the fleet:
1. a prefix drop-in for `ccrc-oomprobe-` applies to a new transient scope (`OOMPolicy` reads `continue`), and whether a
   `daemon-reload` applies it to one already running;
2. with `continue`: the child (at 800) is killed, the scope stays active, the parent survives; the journal signature is
   recorded;
3. with `stop` (a name the drop-in does not match): the scope fails with `oom-kill`; signature recorded;
4. the parent as the victim (child smaller): the signature of "the main process died", which is what the 32 no-`Failed`
   deaths look like;
5. whether `systemctl set-property --runtime … OOMPolicy=` is accepted on a running scope.

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
- the bucket is `idle` or `done`; `background` is null; the roster is empty;
- the turn marker reads `done` (a StopFailure tail is left alone), its last Stop listed no background task of any kind
  (shells and monitors would die too), and its latest of `turnAt`, `stopAt` and `restartAt` is more than N hours ago.
  Compactions do not move that clock, so a session that Claude Code compacts while it idles still ages;
- no hold (`.hold`), no open run naming it as worker or claimant, no claim it holds, no queued mail to it;
- nobody has it open: no `/ws/session` socket for it;
- not stranded, swap-blocked, under a substrate fault, archived or expiring; no opt-out marker `$REG/<id>.no-hibernate`.

N defaults to 6 hours and is read from `$REG/hibernate-after-hours` when the operator writes one (1 to 168). Six hours is
past Claude Code's one-hour prompt-cache lifetime, so a wake costs no cache that idling would have kept; the measurement
plan reports the idle-age distribution before the operator arms it.

**Shadow first.** Without `$REG/hibernate-live` the sweep only logs `hibernate-shadow <id> idle=<h>h` lines. With
`$REG/hibernate-disabled` it does nothing. Neither marker has a writer in the tree (`single-definition.test.ts` pins that,
as it does the stall-watch markers). The sweep runs on its own clock, every 5 minutes, at most 3 hibernations a sweep.

**The act.** `cmd_hibernate` keeps the operator's model choice (`_operator_choice_keep`), writes
`$REG/<id>.hibernated` (`<epoch> <idle-hours>`), unsupervises through `_ws_unsupervise` (a `stopped` stamp, surface
`ccd`) and kills the pane. The lifecycle reads `stopped`, honestly: hibernation is a deliberate stop, and no new
lifecycle word is needed on the wire.

**What the server shows.** `FleetSession.hibernatedAt` (additive). Its presence comes from the registry listing the reader
already takes, so it costs no read per tick; the bytes are read only when it is listed. The bucket stays `dead` (no new
bucket member); the PWA words a dead row with `hibernatedAt` as `hibernated · 6h` with a calm dot, never as a death, and
never badges it.

**Every reader that treats `stopped` as dead for good** consults `hibernatedAt` first. A census test derives the readers
from `lifecycleIsDead` and `DEAD_LIFECYCLES` and fails on one that does not state its stance:
- the mail lane (`watch.ts` ≈:6826) wakes the recipient instead of backing off and parking: `ensure`, at most once per id
  per 10 minutes, and only for a delivery that would otherwise be sent (mail not disabled);
- `inArchivedFold` (`shared/api.ts` ≈:9472) leaves a hibernated main checkout at the top level;
- the stall watch (`coord/stall.ts` ≈:1061), the reclaim door (`coord/reclaim.ts`) and the dead-coordinator path
  (`deadCoordinator.ts`) never meet one, because the verdict excludes runs and claims; the census records that argument;
- the PWA's `coordWords.ts` words it `hibernated`.

**Waking.** `cmd_ensure` and `cmd_start` remove `.hibernated` with `.stopped`. The paths: the PWA opening the session
(SessionScreen calls `POST /api/sessions/:id/ensure` once, shows "Waking…", and enables the composer when the row is
alive); a dispatch (the resume arm already calls `ensure`, ≈:748, and §5.7's bounded wait then covers the spawn); mail
(above); a kickoff (it wakes and then types, like the mail lane). The spawn is the ordinary `--resume`; a hibernated
session's tail is a finished turn, so nothing is re-driven.

**Interactions.**
- *Swaps.* A hibernated session has no supervisor, so no auto swap or rescue runs. A manual swap of one is refused
  `409 hibernated` (SwapSheet offers Wake instead; `cmd_swap` refuses `ccd: hibernated`). A woken session is not swapped
  cosmetically for `SWAP_COOLDOWN`, so a wake is never followed at once by a second cold start.
- *Route.* A `/model` or effort route written while it sleeps is applied by the wake's spawn, which reads the route
  record, as `ccd start` already does.
- *Auto-compact.* No tick, no compaction while asleep. The verdict requires the live word `idle`, so it never fires
  during a compaction, and compactions do not reset its clock.
- *Stall watch.* Covered by the census above.
- *Remote control.* A hibernated `--remote-control` session disappears from Claude Code's own app until ccrc wakes it. The
  opt-out marker is the remedy for a session the operator drives from there.

---

## 6. Ordering, lanes and other programmes

### 6.1 Order

1. §5.1 before §5.2 reaches the fleet (they may ride one release).
2. §5.7 merged and on the server box before §5.8's hook ships (the plan gates on `/health`'s version).
3. §5.9's `ccd` half before its server half (the server needs `swap-busy-v1`).
4. §5.10's verification before its shipping PR; its rollout after both.
5. §5.11's `ccd` half, then server, then PWA, then a shadow week, then arming. It depends on §5.2 (an empty roster must
   mean something) and benefits from §5.10.

### 6.2 Lanes

- **Fleet first** (hook or `ccd`): §5.1, §5.2, §5.6, §5.8, §5.9's `ccd` half, §5.10, §5.11's `ccd` half. Every server
  reader of a new hook or registry field treats its absence as the old behaviour, so the default `rollout` order (fleet
  box, then server box) is safe.
- **Server lane** (server and PWA bundle): §5.3, §5.4, §5.5, §5.7, §5.9's server half, §5.11's server and PWA halves.

### 6.3 Session continuity (#197)

This design takes, by the operator's ruling of 2026-10-16: wave 5's third item (`OOMPolicy=continue` on a scratch pane
scope, done here on throwaway scopes with no scratch account needed); wave 7's refusal (one consent word, `--interrupt`,
instead of `--cut-delegated`); and the cause clause of wave 6's composed redrive prompt (§5.6 composes only the cause;
wave 6 builds on it). Wave 4b's spawn-environment variable and this design's shell prefix both compose at
`_spawn_start`; whichever lands second merges onto the first. The programme's coordinator re-scopes waves 5 to 7.

---

## 7. Invariants

1. A hook `done` unseats a live `busy` only when the Stop listed no delegated work or the build's live word does not
   cover delegation.
2. An event with an `agent_id` changes no main `state`, `event` or `updatedAt`, except a subagent's own wait and its
   restoration.
3. A Finished push has a main Stop inside its busy episode.
4. A status this tick could not read is never painted as a measured idle.
5. No path sends Escape to a session whose only activity is background work.
6. Every Escape the server or `ccd` sends, and every process end `ccd` observes, leaves a record naming its source or cause.
7. The dispatch `/clear` is typed only into a pane whose live word was measured `idle`, twice: at the gate and at the act.
8. A compaction never moves `bucketSince` and never mints a `done`.
9. Every swap that kills a process re-measures at the act; a manual one needs consent to kill a measured turn and never
   kills an unmeasured one from the PWA.
10. A tool child is a likelier OOM victim than its Claude Code, and its death does not end the pane.
11. A hibernated session is never worded, badged, parked or reclaimed as dead, and every path that needs it wakes it.

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
| Roster entries older than their session's process | 316 entries across 32 of 92 files | 0 |
| Idle rows with hookstate `working/PostCompact` | 12 of 58 | 0 |
| Session deaths per day; of them within 15 s of a pane OOM kill; by journal signature (child victim, main victim) | 102 in 7 days (about 14.6 a day); 92 OOM-associated; 61 with a `Failed` line | OOM-associated deaths with a child victim: 0; the rest reported, not targeted |
| Re-driven restarts followed by another within 10 min | 9 of 26 | reported |
| Swaps that killed output | auto-home 0/132, rescue 5/45, manual 8/24 (15 days) | 0 without consent |
| Interrupts by source per week | not measurable (nothing logged) | reported |
| Hibernations and wakes per day, by wake path; memory freed (slice `memory.current`) | about 40 idle processes at about 0.24 GB anonymous memory each [M, verifier's correction] | reported |

**Windows.** The investigation's figures (2026-10-08 to 10-15) are the baseline of record. If the instrument lands before
the first deploy it re-captures them and must reproduce them within tolerance, which validates it; no status fix waits for
it. Each lane is measured again seven days after it deploys. Results are recorded in the plan, by a docs PR.

---

## 9. What this does not claim

- That the 6-session overload cluster came from a null `panePid` rather than a torn read: either is now unmeasured.
- That `oom_score_adj` makes Claude Code safe: a Claude Code process larger than every child is still the likelier victim.
  The 32 deaths with no `Failed` line are reported by signature after rollout, not promised away.
- That N, the hibernation threshold, is right: the shadow week and the idle-age distribution decide it.
- That "N in background" counts only what is running: it counts what the last Stop listed.
- That Claude Code will keep its delegation set: every build bump re-runs the binary check the plan names.

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
