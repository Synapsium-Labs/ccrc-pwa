# Event-gated fleet observer: one tmux control client decides when each supervisor ticks (design)

**Status:** APPROVED by the operator on 2026-10-13 (#393). Every open decision listed below takes its recommendation unless the operator rules otherwise; stage 3b's attach to a fleet's tmux server and each flip still need their own operator approval under the SAFETY rules. Build is gated on the diet (plan D).
- **Citations** are to `origin/main` `0d0ea592`. Every code citation names its function, constant or file. Line
  numbers are hints and are written `≈:N`.
- **Measurements** come from the read-only #387 investigation:
  - a live sampler of the fleet box's supervisor cgroups and `/proc`, built from shell builtins;
  - container replays of the real `cmd_supervise` loop under `strace -f`;
  - three container spikes of tmux 3.4 control mode with bash 5.2.21, the versions the fleet box runs. Each spike
    used 55 synthetic sessions at 200×50 on an unloaded 14-vCPU aarch64 VM.

  Nothing in this design has been run against the fleet's tmux server. **[M]** means measured and **[I]** means
  inferred. Container CPU figures are relative to each other. Forks on the fleet box cost 2–4× what they cost in the
  container [M].
- **Corrections applied.** The event-gated proposal was judged against plan A (the diet alone) and plan D (the diet,
  then this). This revision applies every correction the judgement made; §3.3 lists them.

**Date:** 2026-10-13 · **Branch:** `ws/supervisor-tick-diet` (from `origin/main` `0d0ea592`)

**Related:**
- #387, the issue. The operator's decisions on it are in §3.1.
- `2026-10-13-supervisor-tick-diet-design.md`, the diet. It is plan D's stages 1–2, and this spec is stage 3. The two
  share the D-4967 literal set (§5), the `_now_s` clock seam (D-4961) and the loop lines of `cmd_supervise`.
- #189, open. It rewrites `_sync_uuid` and keeps its walk's state per process. Here a walk that is still pending
  counts as armed (§7.2). A stall found in that walk is reported on the PR and is not designed here.
- #358, the loop's `unknown` arm. Also the 2026-10-12 out-of-memory kill in the tmux server's scope, which stopped
  every pane on the box. This observer attaches to that server (§6).
- #390, the FleetWatcher's per-row polling. It is a possible consumer of the observer's state, not a committed one
  (§3.3).
- #270 (the supervision backend), #382 (an auto-swap off switch, which becomes a trigger once it lands) and #388
  (`CPUWeight`, complementary).
- `2026-08-12-swap-transcript-defect-family-design.md` §4.2. The heartbeat proves that the checks run.
- `2026-08-19-substrate-unreachable-design.md`. D-310's verdict-driven loop, and D-514/D-515's cold start.
- D-2444 (the transcript arm's 30 s cache) and D-3525 (exact tmux targets and their census).

## In short

- **What it is.** One new user unit, `ccd-observe.service`. It is a Python 3 standard-library process that holds one
  tmux control client and a few directory watches, and it decides **when** each `ccd supervise <id>` tick runs. The 55
  per-session units still decide **what** to do, and they run today's tick byte for byte. No rule moves out of bash.
- **How it works.**
  - Each supervisor replaces `sleep "$tick"` with a wait on its own FIFO, which costs no forks.
  - The observer writes a one-line wake when something the tick reads has changed.
  - A quiet row still ticks at least every 30 s (the safety tick), so the heartbeat still proves the checks ran.
  - A wake carries no authority. It can only bring a tick sooner.
- **How it fails safe.**
  - A supervisor waits longer than 5 s only while the observer's heartbeat is fresh.
  - That heartbeat is written only when the observer has earned it.
  - Once it goes stale, every supervisor is back on `sleep 5` within 15 s, at a jittered moment.
- **What it buys [I].**
  - Lower latency. Death, a stale-Enter banner, a route change and a uuid rotation reach the tick in about 1 s
    instead of up to 6.8 s.
  - Fewer tmux requests. Supervisors would make about 7 tmux client requests per second, against about 32 after the
    diet alone and about 83 today.
  - A little more CPU saving. Supervisor CPU falls by about 0.1 core beyond what the diet and its transcript-arm gate
    save.
  - One fleet view that #390, #358 or #270 could read later.
- **What it costs.**
  - About 12–15 agent-days, plus 3–7 calendar days of shadow running.
  - A new client attached to the fleet's tmux server. That server is the single point of failure whose
    out-of-memory kill stopped every pane on 2026-10-12. `-N`, no `%output`, a bounded backlog, a watchdog and a
    24–72 h off-fleet soak keep the risk small. They do not make it zero.
- **When.** After the diet, as plan D orders it.
  - 3a builds and soaks the observer off the fleet while diet W4 is measured.
  - 3b runs it in shadow on the fleet, with the operator's approval.
  - 3c enrols idle rows (Flip-1). It enrols busy rows (Flip-2) only if the shadow shows zero late pane-rung actions.
  - Once W4 is measured, the operator decides whether to go past 3a (the stop rule, §13.4).

## 1. Purpose, and what this is not

### 1.1 Purpose

The supervisor's CPU goes on making processes, not on deciding anything (§2.1). The cost is evaluations per second
times forks per evaluation:
- The diet cuts the second factor: what one tick costs.
- This design cuts the first factor, how often a tick runs. It also cuts how late a tick sees the change it exists to
  act on.

It does that by replacing one line, the `sleep "$tick"` at the bottom of `cmd_supervise`'s loop (≈:23089). The
replacement is a wait that a fleet-wide observer can end early. Every tick that does run is today's tick:
- `_session_probe`;
- then `_sync_uuid; _auto_stale_check; _auto_swap_check; _auto_compact_check; _route_apply_check` on one line
  (≈:23070), with every input read directly.

**This design decides when a session's bash tick runs. It never decides what that tick does.**

### 1.2 What this is not

| Not this | Why |
|---|---|
| **A port of the rules** (the "node daemon with rules ported", option C) | It would duplicate about 1,700 lines of rules [M, counted], while `cmd_swap`, `_alive`'s callers, `cmd_ls` and the doctor keep the bash copies. It would get the lowest CPU, about 0.02–0.05 cores [I], at the price of two implementations of every rule. Rejected. |
| **A fold** of the 55 loops into one process (U0) | Before the diet, one serial pass costs about 9.4 CPU-s [I]. Route apply holds a row for 20–30 s (the comment above the loop, ≈:23041–23055), so a pass has no upper bound, and one hang stalls all 55 heartbeats. Its one unique win, about 0.69 GB of RSS [M], belongs on #270. Rejected. |
| **`ccd supervise --once <id>` per trigger** (U1) | Each run pays the launcher (9–10 ms) plus a bash parse of the 2.4 MB body (49–57 ms) [M] before any check runs, which is about 0.15–0.26 cores of pure parsing [I]. It would also lose per-process state such as #189's walk arrays, and re-implement systemd's isolation of blocking actions. Rejected. |
| **Per-check gating** ("run only the check whose inputs changed") | The checks' inputs overlap: the pane feeds stale, swap and compact, and the status file feeds uuid, affinity, compact and route. The checks must also run in their order within one tick (`ccd-limit-stale.test.ts` ≈:84–87, `ccd-route-tick.test.ts` ≈:172–174). Gating one check at a time would be a partial port of the rules. Rejected. |
| **A source of authority** | The observer never says `gone`, never authorizes an action and never writes a registry field. Only each supervisor's own `_session_probe` decides death (D-310, unchanged). A wake means "check now", nothing more. |
| **A replacement for the diet** | Busy, armed and safety ticks still run the full tick. Without the diet the observer's failure mode is a cliff: about 4 cores within 15 s (§3.2). |
| **A shared snapshot that ticks decide from** | No tick reads anything the observer wrote except its own wake and the beat's freshness. A fleet `state.json` is stage 4, in a separate spec (§13.5). |
| **A change for any row that is not enrolled** | Every row that is not enrolled, every `unknown`-arm tick and every darwin box runs `sleep "$tick"` byte for byte. The 5→30 s back-off pin `['5','5','30','30','5','5']` (`ccd-substrate.test.ts` ≈:149) is untouched. |

## 2. The measured basis

### 2.1 Where the supervisor CPU goes [M; live on the fleet box unless the row says otherwise]

| Fact | Value |
|---|---|
| Supervisor CPU, 55 active units, two windows (23.5 s, 29.7 s) | **3.84–4.10 cores**, 24–25.6% of a 16-vCPU box |
| Share of each unit's CPU spent in child processes | 92–95% |
| Kernel share of supervisor CPU | 83–88% |
| Forks / execs per idle tick (container replay of the real loop) | **179 / 85**; busy 175; away from home with home over its ceiling 207 |
| Per-unit cores by session state | idle 0.0649, busy 0.0658, shell 0.0705; one row searching for a swap target 0.301 |
| Real tick period; CPU per tick | 5.7–6.8 s (not 5); 0.35–0.50 CPU-s |
| Cost of a bare fork, `$(:)` | 1.33 ms at the supervisor's 16–20 MB heap on the saturated box; 0.48 ms in an unloaded container |
| Supervisor RSS | 16.1–17.0 MB each; RssAnon 12.6 MB × 55 ≈ 0.69 GB |
| Box memory | 30.6 GiB RAM, 8.9 GiB available, 9.5 of 16 GiB swap in use |

**What follows [I].** A supervisor blocked in a builtin `read` costs nothing. So the cost is evaluations per second
times forks per evaluation, and the observer can only reduce the first of those factors.

### 2.2 What one control client can see [M, container, tmux 3.4]

| Mechanism | Covers other sessions? | Measured |
|---|---|---|
| `%output` | **No** | A client attached to its own session got 0 `%output` lines in 60 s while 4 other sessions were busy. |
| Pane- or window-scoped subscriptions (`%*`, `@*`, or another session's `%N`/`@N`) | **No** | They fired only for the client's own pane and window, or never. |
| One **session-scoped** subscription with a `#{S:…#{P:…}}` loop | **Yes** | It covers every session's active-window panes. tmux re-evaluates it on a fixed 1 s timer (intervals 0.998–1.010 s) and emits a value only when it changed. A change reaches the reader in 24 ms–1.0 s, depending on the timer's phase. The first value arrives about 1 s after registering. |
| With a quiet fleet (55 idle panes) | — | 0 notifications in 13.5 s |
| With 12 busy panes and 43 idle | — | 1 notification/s, carrying exactly the 12 sessions that changed; 2,686 bytes per message |
| `%sessions-changed`, `%unlinked-window-add/-close/-renamed`, `%session-renamed`, `%client-session-changed`, `%client-detached` | Yes (global) | Rename 2 ms, pane exit 4.5 ms, kill-session 5 ms, kill-pane 8 ms, new-session 9 ms. 3.4 has no `%session-closed`: a session kill gives `%sessions-changed` plus `%unlinked-window-close`. |
| `respawn-pane`, or a pane dying under `remain-on-exit` | **No notification** | Seen only through the subscription, as a `pane_pid` or `pane_dead` change |
| `%exit` | Own client | Sent on `kill-server` or when the client's own session is destroyed |
| `#{window_activity}` | — | Changes on any pane output, including a 1-character overwrite with the cursor restored. It has 1 s resolution, and an idle pane's value stays constant. 3.4 has no `#{pane_activity}`. |
| `#{C:pat}`, `#{C/r:re}`, `#{C/ri:re}` | — | Searched inside the server, over the **visible screen only** (not history). They return the first matching row counted from 1, or 0. UTF-8 works (`limit reached ∙ resets` matched). |
| `capture-pane -p -t %N -S <h-8> -E <h-1>` sent over the channel | — | Byte-identical to `capture-pane -p \| tail -8` (`cmp`, 8 rows including blank ones), with zero forks. A pane shorter than 8 rows needs `-S 0`. |
| `has-session -t '=cc-nope'` sent over the channel | — | `%error` with `can't find session: cc-nope`, the exact text `_session_probe` keys on |
| Effect on the observed sessions | — | `list-clients -t =cc-s01` stays empty; `session_attached=0`; a 200×50 window stays 200×50, even under `window-size latest` with the client attached there |

### 2.3 What observing costs [M, container]

| Scenario (55 sessions, 4 busy, 60 s windows) | tmux server cores | Container cores |
|---|---|---|
| Baseline, no observer | 0.0238 | 0.035 |
| One control client, one fleet subscription (8 fields × 55 panes at 1 Hz) | +0.0014 | +0.002 |
| The same, plus 3 `#{C/r:…}` searches per pane | +0.0095 | +0.009 |
| The same, plus captures over the channel for changed sessions (at most every 5 s each) and a full sweep every 30 s | +0.0005 | ≈0 |
| 55 per-session filtered subscriptions instead of one | +0.0127 | +0.013 |
| 55 lean bash loops making today's tmux call mix per tick, for comparison | +0.037 | **+0.234** |

- **The control client and the observer process.** The `tmux -C` client used 0.00 CPU-s in every run. The Python
  reader used 0.05 s per 65 s. A ~90-line prototype observer used 0.030 CPU-s over 30 s (about 0.001 cores) with
  11.8 MB RSS while it routed 330 wakes, and idle sessions got 0 wakes.
- **At 150 sessions.** The single fleet subscription adds 0.0073 server cores. Per-session subscriptions add 0.041,
  because each one loops over every session, which is O(N²).
- **Output volume.** The fleet subscription re-sends the whole fleet on any change: about 2–2.8 KB/s while anything
  is busy, and nothing while everything is idle.

### 2.4 How it fails [M, container]

| Case | Result |
|---|---|
| **The observer stops reading** (SIGSTOP for 360 s; `no-output`; padded subscription at 110 KB/s) | Server RSS grew linearly from 9.6 MB to **50.0 MB**, at the output rate. The client was **never disconnected**. After it resumed, all 369 notifications arrived and none were dropped, and **RSS stayed at 47 MB**. tmux applies no backpressure to notifications. In a second run with an unpadded subscription and 12 busy panes, a stalled reader grew the server by about 4.5 kB/s (about 16 MB/h). |
| `kill -9` of the control client | The server dropped the client, and all 56 sessions were untouched. Reattaching, re-subscribing and a full resync (`list-panes -a` plus 56 captures over the channel) took **3–4 ms**. |
| `kill-server` | `%exit`, then EOF. The client re-attached 0.12 s after the observer's session reappeared and resynced in 2 ms. Sessions created after the attach showed up through `%sessions-changed`. |
| The tmux server under SIGSTOP | A `display-message -p` sent over the channel got no reply within 1.5 s. Replies arrived after SIGCONT. Silence can therefore be detected. |
| The observer's own session destroyed | With `detach-on-destroy on` (tmux's default) the client got `%exit`. With `off` it was **silently moved into another session**, and that session's `list-clients` then listed it. |
| A control client with no session | `tmux -C start-server` exits at once (`%exit`). The observer has to own a session. |
| `tmux -N` with no server running | rc 1, "error connecting … (No such file or directory)". `-N` never starts a server. |
| A 150 MB burst in one pane | The server was pinned at 1.0 core for 9.2 s. Subscription intervals stayed at 1.00 s, and another session's banner change was still delivered within 0.21 s. |
| Malformed input | A malformed `#{` gives an empty value with no `%error`. `-B 'nocolon'` is silently ignored. Re-registering a name replaces it. 5,000 subscriptions were accepted, and a 1.1 MB value was delivered intact. The observer must validate its first values itself. |
| Command output inside `%begin`/`%end` | It is not escaped, so a pane line can literally read `%end …`. |
| Observer session cleanup | `destroy-unattached on` removed the session within 2 s of the control client being SIGKILLed. A pane running `tail --pid=<observer> -f /dev/null` also ends the session when the observer dies. |

### 2.5 The supervisor-side mechanics [M, container]

- **A bash FIFO waiter** (`exec {fd}<>fifo; read -t N -u fd`) made **0 forks and 0 execs** while waiting, when woken
  and while draining (strace).
- **Writer side, opened `O_WRONLY|O_NONBLOCK`.**
  - With no live reader, the open fails with `ENXIO`.
  - A live supervisor that is not reading takes 8,192 wakes (64 KiB), then `EAGAIN`.
  - Neither case ever blocks the observer.
- **The drain gotcha.** Draining with `read -t 0.001` split a wake line: "status" was read as "st", then "atus".
  `read -t 0` followed by a blocking `read` does not split lines.

### 2.6 Code facts this design rests on [M, code at `0d0ea592`]

- **The loop.** It is `cmd_supervise` ≈:23061–23089. `sleep "$tick"` is at ≈:23089, the five checks are on one line
  at ≈:23070, and the heartbeat line is `beat=$((beat + tick + spent))`, with a stamp once `beat >= 30`
  (≈:23071–23073).
- **Nothing in the tick counts ticks.** Every window compares wall-clock timestamps; the only counter is a per-call
  `drift++` (≈:19826). So a later tick sees fresh state under the same rules, and gating can delay a decision but
  never change one. The one exception is #189's "equal samples one tick apart" (§7.2).
- **What the tick reads of Claude Code's state.** The five tick functions read neither `hookstate.json` nor
  `turn.json`. From `<cfg>/sessions/<pid>.json` they read only `sessionId`, whether `status` is `idle`, and
  `statusUpdatedAt`.
- **The transcript arm's cache test.** It is `$((now - scan_ts)) -lt "$TRANSCRIPT_ARM_INTERVAL"` (30) in
  `_session_hard_blocked` (≈:17040). A tick that runs exactly every 30 s therefore always misses the cache.
- **Registry writes.** `_reg_set` writes a dot-named `.tmp` file and then `mv -T`s it into place, so a watch has to
  be on the directory.
- **Who lists `$REG`.** The server lists only `*.uuid` names (`readRegistryMeasured`, `server/src/registry.ts`
  ≈:1119). ccd never sets `dotglob` (the comment at ≈:3028–3034).
- **The agent's generic read.** `readWhole` (`agent/src/fileops.ts`) opens with `readFile` and has no regular-file
  gate, and the agent may read under `~/.cc-sessions/` (`agent/src/whitelist.ts` ≈:143).
- **Who lists tmux clients and sessions.**
  - `cmd_clip` with no id takes the `list-clients` entry with the newest `client_activity` (≈:26318).
  - `_ws_reclaim_ladder`'s attached check lists the clients of one `cc-` session (≈:27655).
  - `_acct_live` (`ccd/ccrc` ≈:8173) matches `cc-<sid>` exactly.
  - `_lc_obs` (≈:4523) and `ccd-scope-sweep` read pane pids only.
- **Creating sessions.** `_tmux_new_session`'s fast path (≈:20869) runs a plain `new-session` when a server is
  already up. `_ws_reclaim_tail` carries the exit-empty exception (≈:30528–30540).
- **`ccd/tmux.conf`** sets only `default-terminal` and `terminal-features`, so `detach-on-destroy` stays `on`.
- **The constants the windows use:** `SWAP_CEIL_QUIET=30`, `STALE_PRESS_COOLDOWN=120`, `STALE_RESUME_GRACE=30`,
  `TRANSCRIPT_ARM_INTERVAL=30`, `COMPACT_QUIET=60`, `ROUTE_COMPACT_QUIET=30`, `SUBSTRATE_PROBE_DEADLINE_S=8` and
  `ROUTE_FIELDS=(class effort subagent workflow compact degraded inert)`.

### 2.7 Not measured: every figure that depends on these is [I]

- **The cost of a tick after the diet,** estimated at 0.03–0.05 CPU-s. Every fleet-total CPU figure in this spec rests
  on it, and diet W4 replaces it with a measurement.
- **Tick rates under event mode:** 2.1–2.4 ticks/min for idle rows, and 2–4/min for busy rows under Flip-2.
- **How Claude Code writes its status file:** how often a busy session writes `sessions/<pid>.json`, whether every
  `sessionId` rotation writes it, and whether it writes in place or by rename. A directory watch covers both write
  styles.
- **Whether an idle Claude Code pane ever repaints.**
- **Whether inotify delivers events** for a registry or config directory that sits on a bind mount.
- **Every latency figure on the real fleet,** and the cost of the observer and its subscription on the fleet box
  itself.
- **Whether a `read-only` control client may run `capture-pane` on 3.4.**
- **Whether the tmux server returns a dropped client's buffer to the OS.** After a resumed stall its RSS stayed at
  47 MB [M], so this design treats any growth as permanent until tmux restarts.
- **The 150-session case.** The box runs out of RAM first, so the fleet probably cannot reach 150 sessions there, and
  that scaling argument is weak.

## 3. Why build it, and why after the diet

### 3.1 The operator's decisions (2026-10-13)

- "Also do the structural supervisor rework, that seems pretty key."
- **Plan D:** "Diet now + observer staged (Recommended)". In order:
  1. Diet W1–W3, then W4, then 2a.
  2. This spec, written now, so the literal set and the loop change are each defined once.
  3. The observer built and soaked off the fleet while W4 is measured.
  4. Shadow on the fleet, then Flip-1. Flip-2 only if the shadow data support it.
  5. The stop rule after W4 (§13.4).
- **The diet's tick memo is accepted as behaviour-unchanged, with `TICK_MEMO_MAX_MS=1000`.** That decision belongs to
  the diet; this design reads no memo.
- Everything else is open (§16).

### 3.2 The numbers

**Supervisor cores at 55 sessions.** Every row except today's is [I] and rests on the unmeasured post-diet tick
(§2.7):

| Variant | Supervisor cores | If the observer goes down |
|---|---|---|
| Today | **3.84–4.10 [M]** | — |
| Observer only, Flip-1 (busy rows still every 5 s) | 1.79–2.10 | back to about 4 within 15 s |
| Observer only, Flip-2 | 1.05–1.69 | back to about 4 within 15 s |
| Diet only (W1–W4) | 0.3–0.5 | — |
| Diet + 2a (transcript-arm gate, D-4966) | 0.16–0.27 | — |
| **Diet + 2a + observer, Flip-2 (plan D's end state)** | **0.08–0.19** | back to 0.16–0.27 within 15 s |

- **The arithmetic.** Under Flip-2 without the diet, the 39 idle rows cost
  39 × (2.1–2.4 ticks/60 s) × (0.41–0.56 CPU-s), which is 0.56–0.87 cores. A quiet tick misses the transcript-arm
  cache, so it costs more than an average tick. The 14 busy and shell rows cost 0.19–0.52, and the one searching row
  0.30. With the diet and 2a, the same rows cost 0.04–0.08, 0.014–0.047 and 0.02–0.06. The live state mix is
  measured; the tick rates are not.
- **The observer's own cost.** About 0.001 cores and 11.8 MB in the process [M, container], plus about
  +0.0014–0.0095 tmux-server cores for the subscription and its searches [M, container].
- **tmux client requests per second from the supervisors [I].** About 83 today (55 × 9.5 requests per tick ÷ 6.3 s),
  about 32 after the diet alone, and about 7 with the observer. The FleetWatcher makes about 55 more (2 per row every
  2 s); removing those is #390's to decide.
- **Forks per second from the supervisors [I].** About 1,500–1,570 today, about 180 after the diet, and about 30 for
  diet + 2a + observer.

### 3.3 Corrections applied to the event-gated proposal

1. **#390 is a possible consumer, not a committed one.** #390 is open and asks for status as events on the agent.
   Its largest items need no observer: a live-line frame, one-exec sends, and a single agent op for the registry
   snapshot. Nothing here is justified by #390.
2. **Shadow mode is not free of risk.** It leaves the supervisors alone, but it attaches a new client to the fleet's
   tmux server, the single point of failure whose out-of-memory kill stopped every pane on 2026-10-12 (#358). `-N`,
   the backlog guard, the watchdog and the soak keep the risk small. They do not make it zero. Attaching is therefore
   a stage that needs its own approval (§13.2).
3. **Every fleet-total CPU figure is [I]**, and so is every tick rate under event mode. The same goes for every
   behaviour nobody has observed (§2.7) and every latency on the real fleet. Only the container figures and the live
   baseline are [M].
4. **The case for the observer is latency and a shared fleet view, not CPU.** After the diet and 2a, its extra
   saving at 55 sessions is about 0.1 cores [I].
5. **Build it after the diet, not in parallel with it.** The observer's failure modes are cheap only once the diet
   has landed. Before it, an observer outage sends the fleet back to about 4 cores within 15 s; after it, back to
   0.3–0.5. Build and soak can overlap diet stage 2, but nothing attaches to the fleet before the diet is measured.
6. **Under event mode, every quiet safety tick misses the transcript-arm cache** (the `-lt 30` test, §2.6). That
   makes the diet's 2a (D-4966) more valuable, not less.
7. **Plan A (the diet alone) scored 52 of 70, and plan D scored 51.** D was recommended only because the operator
   asked for the structural rework. If latency and #390 turn out not to matter, the stop rule parks this design after
   3a.

## 4. Components

### 4.1 Shape

```
tmux server ── one control client: -N, own session "ccrc-observe", no-output ──┐
<cfg>/sessions/ (one per config dir in use) ────────────────────── inotify ────┤
$REG (trigger names only), $REG/.observe/{mode,flip2,on/,reg/} ─── inotify ────┘
        │
   ccd-observe.service   (python3, standard library only, one event loop)
        ├─► $REG/.observe/wake/<id>     FIFO; one line "v1 <reason>\n"; no authority (D-4972)
        ├─► $REG/.observe/beat          "v1 <epoch> <pid>", written only when earned (D-4971)
        └─► $REG/.observe/events.jsonl  rotating; would-wake lines, the shadow comparator, drift
claude-session@<id> → ccd supervise <id>:  probe + 5 checks (unchanged) → _ev_wait | sleep "$tick"
```

### 4.2 The observer process, and where it runs

**Recommended placement:** a standalone user unit `ccd-observe.service`, running Python 3 with the standard library
only. It is an open decision (§16).
- The script is `ccd/ccd-observe.py`, installed to `~/.local/libexec/ccrc/`.
- The unit is `deploy/systemd/ccd-observe.service`.
- It is installed for the roles that run sessions (`both`, `fleet`), following the installer's existing
  `[ "$INST_ROLE" = server ] ||` gate (`ccd/ccrc` ≈:14215).
- It is Linux only.

| Option | Verdict | Why |
|---|---|---|
| **(a1) Standalone unit, Python 3 standard library** | **Recommended** | Python 3 is already a hard ccd dependency: the installed `ccd` entry is standard-library Python run `-IS` (`ccd/ccd-entry.py`). Long-running Python already ships (`ccd/ccgpt-proxy.py`) and has a vitest harness (`spawnPy`/`pythonOrSkip`, `server/test/ccgptHarness.ts`). Non-blocking FIFO writes, inotify through `ctypes` and `sd_notify` over a datagram socket need no third-party package. The prototype measured 0.001 cores and 11.8 MB [M]. |
| (a2) Standalone unit, node | Workable second choice | It costs 40–60 MB, and the dist build exists only where `agent/` or `server/` is built, so every role's installer would need a new build. The observer needs no shared TypeScript: each supervisor declares its own tmux name and config dir (§4.7). |
| (a3) A bash coprocess on `tmux -C` | Reject | bash cannot open a FIFO non-blocking, so one stuck supervisor would block the whole observer. It has no inotify (`inotifywait` is not a ccd dependency), and stat-polling costs forks. Sourcing ccd would also bring a 16 MB heap. |
| (b) Inside `ccrc-agent` | Reject as host; it may be a consumer later | Only `fleet` boxes run the agent, so a `both` box would have no observer. The agent's write and exec whitelists are frozen by doctrine (`agent/CLAUDE.md`), and wake FIFOs plus a long-lived control client break both. It restarts on every deploy. It runs at `CPUWeight=5000` with `MemoryMin` (`deploy/systemd/ccrc-agent.service.d/protect.conf`), so a hot loop there would starve the sessions. And it would share a crash domain with the PWA's only path to the fleet. |
| (c) In the server | Reject | The server runs on the other box, away from the tmux server. |
| (d) Per-session units as thin waiters | **Yes, as the execution model**, combined with (a1) | Keeps every per-unit contract: `Restart=always` → `cmd_ensure`; StartLimit → `orphan`; `cmd_swap` stopping the unit first (≈:25625); `_ws_unsupervise` (≈:4156); the doctor's unit census; the heartbeat written by the row's own supervisor; blocking actions isolated per session; #189's per-process walk state. |

**Unit settings:**
- `Type=notify`, `WatchdogSec=20`, `TimeoutAbortSec=5`.
- `Restart=on-failure`, `RestartSec=2`, `RestartPreventExitStatus=` the RETIRED status (§15).
- The default `KillMode=control-group`, so the `tmux -C` child dies with the observer.
- `MemoryMax=128M` and a moderate `CPUWeight`.
- It runs in the default user slice, **not** in `app-claude-session.slice`.

`TimeoutAbortSec=5` bounds how long a stopped or wedged observer survives its watchdog [I]: systemd's default abort
timeout is the stop timeout.

### 4.3 `ccd observe-spec`: the observer carries no rule knowledge

`ccd observe-spec` is a new read-only ccd subcommand. It prints one JSON object, and the observer runs it once at
start. That is one exec of ccd, about 60–65 ms [M: the launcher's 9–10 ms plus the body's 49–57 ms parse].

| Key | Content | Single definition it reads |
|---|---|---|
| `v` | Spec version, `1` | — |
| `dir` | `$REG/.observe` | `REG` (≈:1229) |
| `subscription` | The format string of §4.4, with the literals substituted | §4.4 and D-4967 |
| `literals` | `PANE_LIT`, the 14 lowercase literals | D-4967 (§5) |
| `triggers.row` | `ROUTE_FIELDS` plus `hold` | `ROUTE_FIELDS` (≈:1575) |
| `triggers.global` | The basenames of the fleet-wide kill switches the tick reads: `autocompact-disabled` today, and #382's switch once it lands | `AUTOCOMPACT_DISABLE_FILE` (≈:1326) |
| `census` | Every registry field and file the five tick functions read, each classed `trigger`, `self` (written by the tick itself) or `safety` (left to the safety tick) | §14.2, pin 1 |
| `constants` | `SUPERVISE_TICK_S` (5), `SAFETY_S` (30), `OBS_FRESH_S` (10), `SWAP_CEIL_QUIET`, `COMPACT_QUIET`, `STALE_PRESS_COOLDOWN`, `SUBSTRATE_PROBE_DEADLINE_S` | the constants block |
| `tmux.proved` | The tmux versions the real-tmux suite and the soak have proved; `["3.4"]` at first | §6.5 |

- **`SUPERVISE_TICK_S=5` is a new constant beside `SUBSTRATE_BACKOFF_S`.** The loop's three literal `tick=5`
  (≈:23061, 23069, 23086) become `tick=$SUPERVISE_TICK_S`, with identical behaviour, so that `observe-spec` prints the
  value the loop actually runs. No test pins the `tick=5` spelling [M, grep].
- **When ccd changes.** The observer records the identity of ccd's installed body (device, inode, size, mtime, one
  `stat` with no fork) and re-checks it at each reconciliation (§8). If the body changed, the observer exits with
  RESPEC, and systemd restarts it on the new spec.
- **When ccd no longer knows `observe-spec`** (a rollback, §15), the observer exits with RETIRED, and systemd does not
  restart it.

### 4.4 Event sources

**tmux, over one control client** (attach mode is §6):

| Source | What the observer does with it | Used for |
|---|---|---|
| Structural notifications: `%sessions-changed`, `%unlinked-window-add/-close`, `%session-renamed`, `%client-session-changed`, `%exit` | On any but `%exit`, re-list with `list-sessions -F '#{session_id} #{session_name}'` over the channel (0 forks). On `%exit`, stop beating and re-attach (F11). | A session appeared or went away (2–9 ms [M]); server exit; the guard against being moved into another session (§6.3) |
| One session-scoped subscription (below) | Diff each value against the last one, per pane. | Pane pid, dead, active or width changes; the literal gate (§5); `window_activity` for the shadow measurement |
| `display-message -p <nonce>` every 5 s, with an 8 s deadline (as `SUBSTRATE_PROBE_DEADLINE_S`) | Count a round trip only when the reply carries the nonce. | Liveness. A wedged server is silent, so silence must be measured (§8) |
| `capture-pane -p -t %N -S <h-8> -E <h-1>` | Run only when a pane's `C` field is non-zero above its last 8 rows. Parse by the exact row count, never by scanning for `%end` (§2.4). | Confirming a literal in the rows the classifiers read |
| `list-panes -a -F …` | On attach, on resync, and at every 60 s reconciliation | State rebuild; drift detection (§8) |

**The subscription,** built by `ccd observe-spec` and registered once per attach:

```
refresh-client -B 'ccd-fleet::#{S:#{session_id}=#{P:#{pane_id}/#{pane_pid}/#{pane_dead}/#{pane_active}/#{pane_width}x#{pane_height}/#{window_activity}/#{C/ri:LITERALS};} }'
```

- **`LITERALS`** is `PANE_LIT` (§5) joined with `|`. The D-4967 census refuses a literal that contains a regex
  metacharacter, or one of tmux's format metacharacters `#`, `,` or `}`.
- **Sessions are identified by `#{session_id}` (`$N`), never by name inside the value.** That way no session name can
  collide with the separators `=`, `/`, `;` and space. `$N` is mapped to a name by the `list-sessions` re-list above.
  The spike used `#{session_name}` here; the `session_id` form is [I] and is pinned by a real-tmux row (§14.4).
- **The loop body has no bare comma.** A `#{S:…}` or `#{P:…}` loop reads a top-level comma as the start of the
  separate format it uses for the current item [I, from tmux's format grammar; pinned by a real-tmux row].
- **`#{P:…}` inside `#{S:…}` iterates the panes of each session's current window** [M]. That is the same window the
  tick reads: `list-panes -t "$t"` and `capture-pane -t "$t"` on the session target.
- **The first value after an attach is validated before anything uses it.** A malformed format gives an empty value
  and no `%error` (§2.4). The check: every live registered session is present, and every field parses.

**File watches** use inotify on **directories**, with `IN_CLOSE_WRITE | IN_MOVED_TO`. Directory watches cover both
in-place writes and `_reg_set`'s rename.

| Directory | Names that matter | Used for |
|---|---|---|
| `<cfg>/sessions/`, once for each distinct config dir among the live registrations | `<pid>.json` where `<pid>` is a row's first pane pid | `sessionId`; idle or not-idle; `statusUpdatedAt` |
| `$REG` | `<id>.<f>` for `f` in `triggers.row`, and `triggers.global` | Route apply, hold, kill switches |
| `$REG/.observe/` and its `on/` and `reg/` | `mode`, `flip2`, `on/<id>`, `reg/<id>` | Arming, enrolment, registration |

That is about 20 watches on the measured fleet [I], against the 130–200 that an earlier, wider watch set needed.
`IN_Q_OVERFLOW` wakes every row, spread over 5 s (§9.3).

**Timers.** These are all inside the observer's one loop, with no extra threads:
- the 5 s ping;
- the 5 s beat;
- the 60 s reconciliation;
- the per-row rungs of §7.3;
- the 5 s re-wake of armed-pane rows, and of busy rows under Flip-1.

### 4.5 Deliberately not watched

The principle: watch an input only if a change to it can make an action due sooner than the 30 s safety tick allows.
Everything else rides the safety tick.

- **`~/.cc-limits/*`, `pool-epoch`, `$REG/pools`, the usage sweep, credentials, the wrapper dir and the systemd user
  dir.**
  - Every statusline render rewrites the account's limits file, so a watch there would be a constant stream of
    events.
  - These inputs only steer target choice and affinity, which already tolerate tens of seconds: `SWAP_COOLDOWN` 900,
    `SWAPBLOCK_COOLDOWN` 1800, and 0–120 s of jitter (`SWAP_JITTER`).
  - Armed rows tick every 5 s anyway.
  - An affinity move driven by a limits change is up to about 25 s later than today (§11). Watching these files,
    projected per account, is the alternative left open in §16.
- **Transcripts.** The transcript arm is already a 30 s cache (D-2444). #189's walk is handled by counting it as
  armed (§7.2). Not watching transcripts also avoids per-row watches on the work volume.
- **`hookstate.json` and `turn.json`.** No tick function reads them (§2.6).

### 4.6 Files under `$REG/.observe/`

| Path | Writer | Content | Notes |
|---|---|---|---|
| `mode` | **The operator only** (no writer in the tree) | `off`, `shadow` or `on`. Absent means `off`. | The observer attaches to tmux only while this reads `shadow` or `on` (§6.1) |
| `flip2` | **The operator only** | Empty marker | Present: busy rows lose the 5 s re-wake (§7.1) |
| `on/<id>` | **The operator only** | Empty marker | Enrols one row while the mode is `shadow` |
| `reg/<id>` | The row's supervisor, once per life | `v1 <pid> <tmux-name> <cfg-dir> <start-epoch>` | Atomic (dot-named tmp, then `mv -T`) |
| `wake/<id>` | Created by the row's supervisor; written by the observer | FIFO of `v1 <reason>\n` lines | §9 |
| `beat` | The observer | `v1 <epoch> <pid>` | Atomic; §8 |
| `events.jsonl` | The observer | One JSON object per line; rotated at a size cap | Would-wake lines, the shadow comparator, drift. It has no reader in the tree; humans read it. |

**Why under `$REG` and not `$XDG_RUNTIME_DIR`:**
- The path derives from HOME, so a fixture HOME isolates it. A path under `XDG_RUNTIME_DIR` would leak a live beat
  into ccd tests that sessions run on the fleet box.
- The server lists only `*.uuid` names, and ccd never globs a dot-directory (§2.6).

**What must change in the agent:**
- The agent's generic read reaches `~/.cc-sessions/`, and `readWhole` has no regular-file gate (§2.6). A read of a
  wake FIFO would block a thread of the agent's pool, and it could consume a supervisor's wakes.
- 3a therefore gives the agent's whitelisted reads, and its `tail` opens, the gate the agent's update-report read
  already uses (`agent/src/server.ts` ≈:1033–1039): open `O_RDONLY|O_NONBLOCK`, `fstat`, and refuse anything that is
  not a regular file.
- That is an agent change, and AGENT-FIRST ships it with the rest (§15).

**The three operator files** (`mode`, `flip2` and `on/<id>`) have no writer in the tree. `single-definition.test.ts`
pins that, as it does for the stall-watch arming markers. Each is an operator act on the fleet box, never a session's,
under the SAFETY rules.

### 4.7 The supervisor side

**Registration** happens once per supervisor life, after the entry stamp. It costs a few forks, once.
- `mkdir -p` the `.observe/{wake,reg}` dirs, and create `wake/<id>` with `mkfifo` if it is absent.
- If `wake/<id>` exists but `[[ -p ]]` fails, the row stays legacy for this life and says so once on stderr.
- `exec {EV_FD}<>"$OBS/wake/$id"`. Opening `O_RDWR` does not block, and the descriptor holds a writer open, so reads
  never see EOF (the waiter of §2.5 [M]; Linux FIFO semantics for an `O_RDWR` holder [I]).
- Write `reg/<id>` atomically: `v1 <pid> <tmux-name> <cfg-dir> <start-epoch>`.
  - `<tmux-name>` is `_tmux "$id"` (the name, not a `-t` target).
  - `<cfg-dir>` is `_cfg_dir` of the row's wrapper.
  - The supervisor declares these two itself, so the observer needs no naming or roster logic. ccd's single
    definitions stay single, and D-3525's census is untouched (§16).
- Compute `EV_JIT`, a jitter in `0..4` s derived from the id, once. It is used by the fallback (§9.4).

**The loop change** is the only edit inside the loop. The `sleep "$tick"` line (≈:23089) becomes:

```bash
if [[ $PROBE_VERDICT == live ]] && _ev_usable "$id"; then _ev_wait "$id"; else EV_WAITED=; sleep "$tick"; fi
```

The heartbeat counts real seconds in both modes:
- `beat` adds `${EV_WAITED:-$tick}` where it added `tick`, so a legacy row's arithmetic is unchanged.
- The `unknown` arm keeps `sleep "$tick"` and its back-off.
- Nothing in the five tick functions changes.

**`_ev_usable`** decides whether this row may wait on the observer. It makes 0 forks and uses only builtin tests and
`read`:

```bash
_ev_usable() {   # id -> 0 iff this row may wait on the observer
  local m=off v ts _p now
  [[ -n ${EV_FD:-} ]] || return 1
  [[ -f $OBS/mode && ! -L $OBS/mode ]] && read -r m < "$OBS/mode"   # -f BEFORE read: the FIFO-hang guard _reg_read keeps
  [[ $m == on || ( $m == shadow && -e $OBS/on/$1 ) ]] || return 1
  [[ -f $OBS/beat && ! -L $OBS/beat ]] || return 1
  read -r v ts _p < "$OBS/beat" && [[ $v == v1 && $ts =~ ^[0-9]+$ ]] || return 1
  _now_s_to now                                                     # D-4961: honours the suites' `date` stubs
  (( now - ts <= OBS_FRESH_S && ts <= now + 5 ))                    # stale, or dated in the future: legacy
}
```

**`_ev_wait`** returns when a full tick is due. A sketch; the plan fixes the spelling:

```bash
_ev_wait() {   # id -> returns when a full tick is due; never sooner than EV_END + tick
  local now floor due cap line fell=0
  _now_s_to now
  floor=$((EV_END + tick)); due=$((EV_START + SAFETY_S))           # D-4969: the safety tick
  (( EV_STAMP + SAFETY_S < due )) && due=$((EV_STAMP + SAFETY_S))   # ...which is also the stamp deadline
  _ev_armed "$1" && due=$floor                                      # armed rows tick at the floor (§7.2)
  (( due < floor )) && due=$floor                                   # a long tick never shortens the next wait below today's
  while (( now < due )); do
    cap=$((due - now)); (( cap > 5 )) && cap=5                      # re-check usability every 5 s at most...
    (( fell )) || _ev_beat_left cap                                 # ...and exactly when the beat goes stale
    (( cap < 1 )) && cap=1                                          # never a zero-timeout spin
    if read -r -t "$cap" -u "$EV_FD" line; then                     # a wake (D-4972)
      while read -r -t 0 -u "$EV_FD"; do read -r -u "$EV_FD" line; done   # drain; never `-t 0.001` (§2.5)
      (( fell || floor >= due )) || due=$floor                      # a wake brings the tick to the floor, never sooner
    fi
    _now_s_to now
    if (( ! fell )) && ! _ev_usable "$1"; then fell=1; due=$((now + EV_JIT)); fi   # §9.4
  done
  EV_WAITED=$((now - EV_END))
}
```

- `EV_START`, `EV_END` and `EV_STAMP` are the loop's own tick start, tick end and last stamp, all read through
  `_now_s`.
- `_ev_armed` makes only builtin `-e` tests and `read`s (§7.2).
- **Never more ticks than today.** A tick never starts sooner than `tick` seconds after the previous one ended, and
  today's period is `tick` plus the tick's own duration.
- **Existing suites stay green.** Their fixture HOMEs have no beat file, so every existing suite takes the legacy
  path unchanged. That covers `ccd-substrate`'s sleep sequence, `ccd-session-state`'s 2 stamps in 8 ticks and
  `ccd-route-tick`'s real-seconds beat (≈:361–391).

**`cmd_clip` filter.** `cmd_clip` with no id must skip control-mode clients and any session outside `cc-`. Today it
takes the client with the newest `client_activity` (≈:26318). With only the observer attached the spike picked the
observer [M], and the observer's commands did not move its `client_activity` [M]. The filter adds
`#{client_control_mode}` to the format and drops rows where it is `1` or where the session name does not start with
`cc-`. It lands in the same PR as the loop change.

## 5. The shared literal set (D-4967)

**Purpose.** One set of 14 lowercase literals. Every alternative of each of the four banner classifiers contains at
least one of them. The set is defined once, as one array in ccd, and read by two consumers:
- **The diet's prefilters** (D-4965, W4). Before its grep, each of the four classifiers asks one fork-free helper
  whether any literal of the set is a substring of its input, lowercased with `${s,,}`. A miss answers "no match"
  without running grep; a hit runs today's `grep -qiE`, unchanged, which decides.
  - Each classifier consults the whole set, not only the literals derived from its own regex. That is sound, because
    the set contains every classifier's necessary literals.
- **The observer.** The literals go into the subscription's `#{C/ri:…}` search, and into the confirm step over a
  last-8-rows capture.

The set is a prefilter, never a classifier (§16, inherited). A literal match never decides anything; it only lets
today's regex run, or brings a tick forward.

**Where it lives.** It goes in `ccd/ccd`'s tuning constants, directly after `TRANSCRIPT_ARM_INTERVAL` (≈:1490), as one
array under one header comment naming D-4967. Each literal's trailing comment names the classifier it was derived
from:

```bash
# ── banner literals (D-4967) — one necessary literal for each alternative of the four pane-banner classifiers ──
PANE_LIT=(
  'usage limit has reset'       # _pane_limit_stale
  'limit reached'               # _pane_hard_blocked
  'reached your '               # _pane_hard_blocked
  'out of usage'                # _pane_hard_blocked
  'out of credits'              # _pane_hard_blocked
  'monthly spend limit'         # _pane_hard_blocked
  'hit your '                   # _pane_hard_blocked, _pane_limit_banner
  'api error: 429'              # _pane_hard_blocked
  'too many requests'           # _pane_hard_blocked
  'rate limit'                  # _pane_hard_blocked
  'invalid api key'             # _pane_hard_blocked
  'please run /login'           # _pane_hard_blocked
  'continuing automatically'    # _pane_auto_continue_armed
  'continuing shortly'          # _pane_auto_continue_armed
)
```

`observe-spec` prints `PANE_LIT` as its `literals` (§4.3). No other file in the tree carries a copy of the set, and the
observer reads it only through `observe-spec`. (The four classifiers' own regexes still spell their alternatives;
that is the text the literals are derived from, not a copy of the set.) If this text and the ccd array ever disagree, the array is the truth,
and this text and the diet spec's table are both corrected.

**How each literal is derived from its classifier's regex** (the regexes at `0d0ea592`):

| Classifier (regex at) | Alternative | Literal | Derivation |
|---|---|---|---|
| `_pane_limit_stale` (≈:17064) | `usage limit has reset.*press enter to continue` | `usage limit has reset` | The fixed run before `.*` |
| `_pane_hard_blocked` (≈:17129) | `limit reached` | `limit reached` | The whole alternative |
| | `reached your .*limit` | `reached your ` | The fixed run before `.*` |
| | `out of (usage\|credits)` | `out of usage`, `out of credits` | A two-branch group at the end, expanded |
| | `monthly spend limit` | `monthly spend limit` | The whole alternative |
| | `hit your .*spend` | `hit your ` | The fixed run before `.*` |
| | `API Error: 429` | `api error: 429` | The whole alternative, lowercased |
| | `Too Many Requests` | `too many requests` | The whole alternative, lowercased |
| | `rate limit(ed\| exceeded\| reached)` | `rate limit` | The fixed run before the group |
| | `Invalid API key` | `invalid api key` | The whole alternative, lowercased |
| | `Please run /login` | `please run /login` | The whole alternative, lowercased |
| `_pane_limit_banner` (≈:17181) | `hit your ([a-z0-9]+ )*limit ·` | `hit your ` | The fixed run before the starred group |
| `_pane_auto_continue_armed` (≈:16943) | `continuing automatically` | `continuing automatically` | The whole alternative |
| | `continuing shortly` | `continuing shortly` | The whole alternative |

**The derivation rule.**
- A literal is admissible for an alternative only if every string the alternative matches contains it, after
  folding to lowercase.
- Take the alternative's leading fixed run, up to the first metacharacter. Expand a final group of at most two fixed
  branches.
- **There is no bare `limit`.** It appears in ordinary prose and in statusline text, so a prefilter keyed on it would
  almost never say "no", and an observer keyed on it would wake rows all the time.
- **Every literal is necessary.** Each one is the only literal in the set that some alternative contains, so dropping
  any one of them turns that alternative's corpus row red. `hit your ` serves two classifiers and is listed once.

**Why searching the raw pane is sound.** `_pane_hard_blocked` and `_pane_limit_banner` read their input through
`_pane_outside_box`, which only removes lines (the prompt box's rows). A literal search over the raw pane is therefore
a superset: it can wake a row for a human's draft (an extra tick, counted as a false positive in the shadow), but it
cannot miss a banner the classifier would match.

**The case-fold residual is the same one the diet carries (D-4965).** Under a UTF-8 locale `grep -i` also matches
characters whose fold reaches an ASCII letter only through uppercasing, such as `ſ` (to `s`) and `ı` (to `i`);
`${s,,}` does not [I]. (The Kelvin sign lowercases to `k`, so `${s,,}` folds it as grep does [I].) The observer
matches its confirm step with Python's `str.casefold()`, and tmux's `C/ri` search uses the server's case-insensitive
POSIX regex [I]. A banner spelled with such characters may get no wake, and the safety tick catches it within 30 s.

**Census (pinned in §14.2, shared with diet W4).**
1. Every top-level alternative of each of the four regexes, extracted from ccd by function name, has a
   minimal-matching string in the corpus (one for each branch of a final group), and that string contains at least
   one literal of `PANE_LIT`.
2. No literal is the bare word `limit`.
3. No literal contains a regex metacharacter, `#`, `,` or `}`.
4. `PANE_LIT` is assigned exactly once in `ccd/ccd`, inside the D-4967 block, and no other tracked file outside the
   docs and the test corpus carries a copy of the set as a list.
5. `observe-spec`'s `literals` equals `PANE_LIT`.

The mutation row: drop any single literal, and that alternative's corpus row turns red.

**Who writes it first.** Diet W4 writes the array into ccd in plan D's order, unless the 3a observer PR lands first.
Whichever lands second consumes the existing array and adds no copy. W4 does not merge until this spec's set is
approved.

## 6. Attach mode and the backlog guard (D-4968)

### 6.1 When the observer attaches

- **Only while `$REG/.observe/mode` reads `shadow` or `on`.** With `off`, or no mode file, the observer holds no tmux
  client, writes no beat and watches only `.observe/`.
- **That file has no writer in the tree**, so the first attach is always an operator act (§13.2).
- **The mode gate is also the test boundary.** A fixture HOME has no live mode file, and every observer suite runs
  behind a tmux shim (§14.3).

### 6.2 How it attaches

- **The command.** `tmux -N -C new-session -s ccrc-observe -x 80 -y 24 'exec tail --pid=<observer pid> -f
  /dev/null'`, with `TMUX` unset.
  - **`-N` on every tmux argv the observer runs.** It never starts a server [M], so D-514 (ccd places the server) is
    kept by construction, and the observer's `new-session` is `_tmux_new_session`'s fast path by definition.
  - **No server means no attach.** The observer stays in `NO_SERVER`, writes no beat, and retries on a back-off.
    Supervisors meanwhile take today's `unknown` arm.
- **The session name.** `ccrc-observe` is outside `_tmux`'s `cc-` space. If the name is taken (a previous life's
  session that has not been removed yet; that takes at most 2 s [M]), the observer waits and retries. It never
  attaches to a session it did not create.
- **The first commands on the channel:**
  - `set-option -t =ccrc-observe destroy-unattached on`;
  - `refresh-client -f no-output,ignore-size`;
  - `refresh-client -f read-only`, but only if the real-tmux suite shows that 3.4 still allows `capture-pane` for a
    read-only client (§2.7);
  - the subscription (§4.4).
- **No `%output`, ever.** `no-output` is set before the subscription, and `pause-after` is not used.

### 6.3 The command whitelist and the session guard

- **The whitelist.** The observer sends only these commands:
  - `refresh-client` with `-B` or `-f`;
  - `display-message -p`;
  - `capture-pane -p`;
  - `list-panes`;
  - `list-sessions`;
  - `set-option` and `detach-client`, each only on its own session.

  `send-keys`, `kill-*`, `respawn-*`, `new-window`, `select-*`, `resize-*` and every other mutator are absent, and a
  census pins that (§14.2).
- **The session guard.** If the client is ever moved into another session, the observer detaches immediately and
  re-attaches to its own. That shows as `%client-session-changed` naming its client, or `%session-changed` to a
  session it does not own.
  - The reason: a control client sitting in a `cc-` session shows in that session's `list-clients`, and
    `_ws_reclaim_ladder` then refuses to reap it as "attached" (≈:27655).
  - This happens only if `detach-on-destroy` is turned `off` (§2.4). `ccd/tmux.conf` leaves it `on`, and the guard
    covers a future configuration change.

### 6.4 The backlog guard

The tmux server buffers without limit for a control client that stops reading. It never disconnects the client and
never drops anything [M]. Its RSS stayed up after the stall ended [M], so growth must be kept small, not just
reversible. Five layers do that.

1. **A small payload.**
   - No `%output`, and one subscription with short fields.
   - The rate is about 2–2.8 KB/s while any pane is busy and nothing while all are idle [M, container]. The stalled
     reader with 12 busy panes grew the server by about 4.5 kB/s [M].
2. **A loop that drains first.**
   - One event loop (`select`/`epoll`) drains the control pipe completely on every pass, before any other work.
   - The work done per pass is bounded.
   - Parsing a subscription value takes microseconds [I].
3. **An in-process cap.** The observer stops beating and kills its own `tmux -C` child when either of these happens:
   - the unparsed input it holds passes a cap (1 MiB proposed);
   - a ping goes unanswered past its 8 s deadline.

   The server drops a client that has gone away [M], and the observer re-attaches after a back-off. A slow observer
   therefore detaches rather than accumulating a backlog in the server.
4. **The systemd watchdog.**
   - The loop sends `sd_notify WATCHDOG=1` only after a full drain.
   - With `WatchdogSec=20`, a hung or stopped observer is aborted, and `TimeoutAbortSec=5` bounds the abort.
   - `KillMode=control-group` kills the `tmux -C` child too, so the server drops the client.
5. **The soak.** 24–72 h at 55 synthetic sessions, with flat tmux-server RSS, before any fleet attach (§13.1).

**Worst case [I, from measured rates].** About 20–25 s (`WatchdogSec` plus `TimeoutAbortSec`) × 2.8–4.5 KB/s, roughly
56–113 KB of server heap, plus the client pipe's 64 KiB. Without layers 3 and 4 the growth would be about 16 MB/h for
as long as the hang lasted [M rate].

### 6.5 The version gate

- **Before attaching.** The observer reads `tmux -V`, one exec at start.
- **After attaching.** It reads `#{version}` over the channel.
- **A version outside `tmux.proved`** (§4.3) means the observer detaches, enters `UNSUPPORTED` and writes no beat. Every
  row stays legacy.
- **Adding a version** means re-running the real-tmux suite and the soak on it.

## 7. Scheduling: row states, triggers, rungs and the safety tick (D-4969)

### 7.1 Row states

| State | Who decides | Next full tick |
|---|---|---|
| **legacy** | The supervisor: the mode is `off`, the row is not enrolled, there is no fresh v1 beat, the arm is `unknown`, the box is darwin, or there is no FIFO | `sleep "$tick"`, byte for byte, with today's back-off |
| **quiet** | The default for an enrolled row | The last tick's **start** + `SAFETY_S` (30), and never later than the last stamp + 30 |
| **triggered** | An observer wake | max(now, the last tick's **end** + 5) |
| **armed-pane** | The observer: a literal is visible in the last 8 rows | A wake now, then every 5 s while it stays visible |
| **armed-file** | The supervisor, with builtin tests only (§7.2) | The last tick's end + 5 |
| **busy, under Flip-1** | The observer: the status file says not idle, or the row cannot be mapped to a status file | A wake every 5 s |
| **busy, under Flip-2** (`flip2` present) | The observer | Only the triggers below, and the safety tick |

### 7.2 Armed rows, decided by the supervisor (`_ev_armed`)

`_ev_armed` makes builtin `-e`/`-f` tests and `read`s only, with no forks. A row is armed when any of these holds:
- `$REG/<id>.rescuewait` exists;
- `$REG/<id>.stranded` exists;
- `$REG/<id>.stalepress` holds an epoch younger than `STALE_PRESS_COOLDOWN`;
- #189's walk is pending.

**#189's walk.** Its quiescence rule is "equal samples one tick apart", and its walk state lives in the supervisor's
own shell (the `_CI_*` arrays on its branch). So "pending" is an in-process predicate. #189 exports it, and
`_ev_armed` calls it.

Flip-1 may not start while #189 is merged without that predicate wired in. Either #189 is unmerged, or its pending
walk is armed. A census over per-process state in the tick functions reds otherwise (§14.2, pin 6). The stall found
in #189's walk (`_CI_DONE` set before the empty-successor check) is reported on #189 and is not designed here.

### 7.3 Triggers: the observer's wakes

| Trigger | Wakes |
|---|---|
| A registration appears or changes (a new supervisor life) | That row, now |
| A registered session appears or disappears; its pane's pid, dead flag, width or active flag changes | That row, now |
| The `C` field's first matching row lands in the last 8 rows, or it is non-zero above them and a capture finds a literal in the last 8 | That row, now; then every 5 s while the literal stays visible (armed-pane) |
| A status-file write in which `sessionId` changed or the idle/not-idle state flipped. A busy↔shell flip is projected away, because the tick only asks "idle?". | That row, now. If it became idle, also the rungs below. |
| A trigger field in `triggers.row` written | That row, now |
| A global switch written | Every row, spread over 5 s |
| Reconciliation drift (§8.3) | The rows affected |
| `IN_Q_OVERFLOW` | Every row, spread over 5 s |
| The mode changes to `off` | One wake to every FIFO, so waits end at once (§13.3) |

**Not a trigger:**
- `window_activity` on its own. A spinner or repaint must not cost a tick. The observer still logs it during the
  shadow, to measure whether idle panes repaint.
- A field the tick itself writes (`supervised`, `uuid`, `tscan`, `tdate`, `routeapplied`, notes, `swap.log`).
  Without this rule, each tick would wake its own row (the self-trigger guard, §14.3).

**Rungs.** When a row becomes idle, the observer schedules wakes at:
- `ceil(statusUpdatedAt) + SWAP_CEIL_QUIET + 1`;
- `ceil(statusUpdatedAt) + COMPACT_QUIET + 1`.

These keep affinity at about +31 s and compaction at about +61 s after the turn ends, as today. The windows are
anchored on Claude Code's own `statusUpdatedAt`, which is the same write that produced the wake. The 600, 900 and
1800 s windows (`ROUTE_RETRY_BACKOFF`, `SWAP_COOLDOWN`, `COMPACT_COOLDOWN`, `SWAPBLOCK_COOLDOWN`) are left to the
safety tick, at most 30 s late.

**The rate limit.** The observer sends at most one wake per row per second. The supervisor enforces at most one tick
per `tick` seconds from the last tick's end.

### 7.4 The safety tick (D-4969)

**The rule.** An enrolled quiet row runs a full tick no later than `SAFETY_S` (30) seconds after its last tick
started, and no later than 30 s after its last stamp.
- `SAFETY_S` is declared once in ccd's constants beside `SUBSTRATE_BACKOFF_S`, and printed by `observe-spec`.
- **Why 30.** The 2026-08-12 heartbeat contract says a stamp lands at least every 30 s plus one tick, and that a stamp
  proves "auto-swap, uuid-sync and auto-compact are actually running for this row". At 30 the stamp code stays as it
  is. Each quiet row stamps on each safety tick, and only a tick that ran the checks stamps. §4.2 of that contract
  stays literally true.
- **What it costs.** At 30 s, every safety tick misses the transcript arm's 30 s cache (§2.6) and runs the arm: about
  27 forks plus `python3` before the diet [M]. 2a (D-4966) is the remedy.
- **The alternative.** `SAFETY_S=60` would save about 0.02–0.04 cores after the diet [I], and it needs a §4.2
  amendment. It is an open decision (§16).
- **Readers that keep their windows.** `SUPERVISED_FRESH_MS` (120 s, `shared/api.ts` ≈:2294), `_session_state`'s
  `< 120`, the hook's `CCRC_FRESH_S` and `DEAD_GRACE_MS` (10 min) all still hold. So does #351's reader, which assumes
  a stamp "every 30 s and at every supervisor start".

## 8. The earned beat (D-4971)

### 8.1 When the beat is written

The observer writes `$REG/.observe/beat` (`v1 <epoch> <pid>`, atomic) every 5 s, and only while **every** one of
these holds:
1. Its state is `LIVE`: attached, subscribed, and the first subscription value has passed validation (§4.4).
2. A control-channel round trip (`display-message -p <nonce>`) answered within the last 10 s.
3. Every inotify watch it needs is present: the descriptors are valid and the directories exist.
4. The last 60 s reconciliation passed, with fewer than three consecutive drifts (§8.3).
5. The drain loop is keeping up: the unparsed input is below the cap (§6.4).
6. The mode reads `shadow` or `on`.

The same loop, and only that loop, sends `sd_notify WATCHDOG=1`.

### 8.2 What a beat means

- **It is the only thing that lets a supervisor wait longer than 5 s.**
- **It says nothing about any session.** It is not a liveness claim and not an authorization.
- **A missing, stale or future-dated beat, or one with the wrong version, puts every row on the legacy path** (§4.7).
- **A wedged tmux server stops the beat.** The pings go unanswered, the beat stops within 10 s, and every supervisor
  probes on its own, through its `unknown` arm if need be. Silence is never read as "nothing changed".

### 8.3 Reconciliation: "beating but blind"

Every 60 s the observer does four things:
1. It sends `list-panes -a` over the channel and compares the result with the state it built from events.
2. It re-checks every watch.
3. It checks each registration's pid against `/proc`, comparing the start time with the registration's epoch so that
   a reused pid does not count.
4. It re-checks ccd's body identity (§4.3).

Any drift wakes the rows affected and is logged. Three drifts in a row stop the beat until a clean pass. A watch that
cannot be restored stops the beat.

The safety tick bounds any miss: in the worst case an action is 30 s late, and it is never lost.

## 9. Wake routing and the fallback (D-4972)

### 9.1 One FIFO for each supervisor

- **The path.** `$REG/.observe/wake/<id>`. The supervisor creates it and holds it open `O_RDWR` for its whole life
  (§4.7).
- **The line.** One line per wake, `v1 <reason>\n`, always shorter than `PIPE_BUF`, so each write is atomic.
- **The reason** is one word, for example `session`, `pane`, `literal`, `status`, `route`, `switch`, `rung`,
  `reconcile`, `overflow` or `off`. It is informational only: the supervisor never branches on it.

### 9.2 The writer (the observer)

Each wake opens the FIFO `O_WRONLY|O_NONBLOCK`, writes one line and closes it. It never blocks [M]:
- **`ENXIO`** means no reader: the supervisor has died. The observer marks the registration stale and re-checks it at
  the next reconciliation.
- **`EAGAIN`** means the FIFO is full: 64 KiB, about 8,192 wakes [M]. The observer drops the wake. A full FIFO already
  guarantees one.

Under `shadow`, the observer writes wakes only to enrolled rows (`on/<id>`). For every other row it logs a
`would-wake` line.

### 9.3 The reader (the supervisor)

- A wake ends the current `read -t` early.
- The supervisor drains the FIFO with `read -t 0` followed by a blocking `read` per line, and never with
  `read -t 0.001` (§2.5).
- A drained wake brings the next tick to the floor (the last end + `tick`), never sooner.
- Wakes carry no authority. An injected wake from any local writer only causes a tick that reads everything directly
  and decides as today, and the floor bounds the rate.
- Spreading. When every row is woken (a global switch, an overflow, reconciliation), the observer spreads the writes
  across 5 s by `hash(id) mod 5`, so 55 supervisors never tick in the same second.

### 9.4 The fallback

**What triggers it.** On any lap of `_ev_wait`, `_ev_usable` fails: the mode changed, the row was unenrolled, or the
beat is stale, future-dated or of the wrong version.

**What happens.** The supervisor takes one jittered step back to today's loop:
- the current wait ends at `now + EV_JIT` (0–4 s, fixed per id);
- the next pass finds `_ev_usable` false and runs `sleep "$tick"`, with today's cadence and back-off.

**The bound.** The wait cap includes the beat's staleness deadline (`ts + OBS_FRESH_S`), so a supervisor notices a
stale beat when it goes stale, not up to 5 s later. A supervisor is therefore back on `sleep 5` **within 15 s of the
observer's last earned beat** (10 s of freshness plus at most 4 s of jitter, plus one second of rounding).

**Why the jitter.** All 55 supervisors read the same beat, so their deadlines line up. The jitter keeps those
deadlines from becoming one burst of 55 ticks.

## 10. The empty-server rule (D-4970)

**The situation.** The observer's own session is a session like any other to the tmux server. When the last `cc-`
session ends, the server is no longer empty, so it does not exit.

**Option A, recommended: the server stays alive.**
- `_ws_reclaim_tail`'s exit-empty exception (≈:30528–30540) becomes unreachable on a box running the observer. That
  exception applies when this attempt's own kill exited 0 and the probe then found `no server running`. Its ordinary
  path still passes: the probe finds the session gone and reads `gone` [I].
- The next spawn takes `_tmux_new_session`'s fast path (≈:20869) into the server ccd placed, so D-514's placement
  holds.
- The idle server costs about 10 MB (9.6 MB in the spike's baseline [M]).
- The observer itself never creates a server (§6.2).

**Option B: detach when last.**
- When `ccrc-observe` is the only session left, the observer ends its own session, so the server exits.
- The observer then watches for a new server and re-attaches once ccd has created one.
- **This reopens a race [I].** A spawn's `_tmux_new_session` can see the server up (`list-sessions` succeeds), the
  server can exit as the observer leaves, and the plain `new-session` then creates a server outside ccd's placement.
  That is the hazard D-514 exists to prevent.

**Recommendation: A.** Whichever option is ruled (§16), a census pins the rule. Under A, a real-tmux row shows that
the last `cc-` session ending leaves the server up and that the next spawn takes the fast path. Under B, a row shows
the detach and the re-attach.

## 11. Latency, per check

Every fleet figure here is [I]. The notification and subscription timings are [M] in the container.

| Check | Today | Enrolled row, event mode | Change |
|---|---|---|---|
| Death → revival starts | ≤ 5–6.8 s to detect, then `RestartSec=3` | Notification in 2–9 ms [M], then a wake, the row's own probe and its exit, then 3 s | **Better.** The respawn that `stall.ts` measures at about 9 s becomes about 3–4 s. |
| uuid after `/clear` or a resume | ≤ 5.7–6.8 s, plus the server's 2 s poll | A status-file write wakes the row within ms; at worst 5 s (the floor) | **Better.** **Worse (≤ 30 s)** if a rotation ever happens without a status-file write; this is unverified, and the shadow measures it. |
| Stale Enter | ≤ 6.8 s after the banner | ≤ 1 s subscription timer, plus a capture | **Better** |
| Rescue, pane rung (429 or a limit banner, including mid-turn) | ≤ 6.8 s | ≤ 1–2 s; for busy rows only after Flip-2 | **Better** |
| Rescue, transcript arm | ≤ 30 s cache + 6.8 s | ≤ 31 s (every safety tick misses the cache) | Same |
| Rescue waits (the five windows from `RESCUE_WAIT_BOUND` on) | 5 s cadence | Armed, 5 s | Same |
| Affinity after idle (`SWAP_CEIL_QUIET` 30) | 30–37 s after idle | About 31–32 s (rung) | Same |
| Affinity on a limits change (home recovered, or over its ceiling) | ≤ 6.8 s, then 0–120 s of jitter | ≤ 30 s, then the same jitter | **Worse by up to about 25 s.** Dominated by the jitter and by the 900/1800 s cooldowns. |
| Compaction (`COMPACT_QUIET` 60) | 60–67 s after idle | About 61–62 s (rung) | Same or better |
| Route apply after an operator change, row idle | ≤ 6.8 s | ms to 5 s | **Better** |
| Route apply waiting for idle | ≤ 6.8 s after idle | ≤ 1 s after idle | **Better** |
| `ROUTE_RETRY_BACKOFF` (600 s) | ≤ 6.8 s late | ≤ 30 s late | Worse, harmless |
| Heartbeat | ≤ 30 s + spent | ≤ 30 s + spent | Same |
| Strand, substrate or tickstuck chips clearing | Within one tick | On the resolving event, otherwise ≤ 30 s | Worse for quiet rows |
| Undecidable notes, pool lease, sweep age, a `ResetAt` passing | ≤ 6.8 s | ≤ 30 s | Worse, not urgent: these only ever make a row *more* available |
| tmux wedge (the `unknown` arm) | 5→30 s back-off | Unchanged: the legacy path | Same |
| The observer goes stale or down | — | At most 15 s more, once, then exactly today | — |

## 12. Failure modes

| # | Failure | What happens | Worst case |
|---|---|---|---|
| F1 | The observer crashes | No beat. Each supervisor falls back within 15 s, jittered (§9.4), and systemd restarts the observer. No wake-all is needed when it returns: the rows were polling in the meantime. | ≤ 15 s more latency, once; then today's cadence and cost. Before the diet, that cost is about 4 cores. |
| F2 | **The observer hangs** while the tmux server keeps buffering | The beat stops (F1). The watchdog aborts the observer at 20 s, plus at most 5 s of abort timeout; the control-group kill takes the `tmux -C` child, and the server drops the client (§6.4). | About 56–113 KB of server heap [I], which may stay allocated until tmux restarts (§2.7) |
| F3 | Beating but blind: a lost watch, a stalled subscription, a bug | The 60 s reconciliation (§8.3). Three drifts stop the beat. | Any action ≤ 30 s late, never lost |
| F4 | A new rule reads an input nobody watches | The safety tick bounds it, and the input census reds until the input is classified (§14.2, pin 1) | ≤ 30 s late |
| F5 | A wake storm | ≤ 1 wake per row per second (observer); ≤ 1 tick per 5 s (supervisor); a full FIFO answers `EAGAIN` | Today's cadence |
| F6 | Route apply holds a row for 20–30 s | Wakes queue in that row's FIFO and drain afterwards. Other rows are unaffected, because nothing is serialized across the fleet. | Same as today |
| F7 | A stale FIFO or registration from a dead supervisor | `ENXIO` [M]; the registration's pid and start time are checked at reconciliation | None |
| F8 | No tmux server (D-514 cold start, #358) | `-N` never creates one [M]. The observer is in `NO_SERVER` with no beat, so supervisors run today's `unknown` arm. A census pins `-N` on every observer argv. | Today |
| F9 | The observer's session keeps an otherwise empty server alive | The D-4970 rule (§10) | None under A; the D-514 race under B |
| F10 | `ccrc-observe` shows up as a client or a session | The `cmd_clip` filter (§4.7). `_ws_reclaim_ladder` lists clients per `cc-` session; `_acct_live` matches `cc-<sid>` exactly; `_lc_obs` and `ccd-scope-sweep` read pane pids only (§2.6). The session guard (§6.3). | A `ccd clip` regression if the filter is missing; a reap refused as "attached" if the client is ever moved into a `cc-` session |
| F11 | The tmux server is restarted | `%exit`, then EOF [M]. The observer re-attaches, re-subscribes and resyncs in a few ms [M]. The beat stops until the first value is validated again. | Same as today |
| F12 | Version skew or a clock step | Old supervisors don't register, so the observer wakes nobody. New supervisors with no observer see no beat and stay legacy. A future-dated beat counts as stale. A tmux version outside the proved set means no attach (§6.5). A partial sweep is still correct unit by unit. | None |
| F13 | An injected wake from a local writer | No authority. The tick reads everything directly, and the floor bounds the rate. | Extra ticks |
| F14 | A FIFO read by something other than its supervisor | The agent's reads gain a regular-file gate (§4.6). ccd never globs a dot-directory, and the server lists only `*.uuid`. | None once the gate lands; until then 3b may not start |
| F15 | A literal-set gap under Flip-2 | The census (§5), the shadow's late-action counts and the safety tick | A pane rung ≤ 30 s late |
| F16 | Darwin | No observer is installed, there is no beat, and every row is legacy | Today |

**Revival stays fleet-safe.** Death is decided only by each supervisor's own `_session_probe`, with D-310's polarity
and the 8 s deadline. The observer only decides when that probe runs, so it can never say `gone`.

## 13. Stages, gates and the stop rule

### 13.1 Stage 3a: build and soak off the fleet

**Before it starts:**
- This spec is approved, and the decisions in §16 are ruled, except the 3b attach (decision 8), which is asked for at
  the time.
- Diet W1 has merged. 3a's loop PR shares the loop lines and reads time through `_now_s` (D-4961).
- The D-4967 block has landed, or it lands in 3a's ccd PR.

3a overlaps diet stage 2. **It makes no contact with the fleet's tmux server.** Its code ships dormant: the observer
attaches only while the mode reads `shadow` or `on`, nothing in the tree writes the mode, and the installer installs
the unit without enabling it.

**What it builds:**
- `ccd observe-spec`, `SUPERVISE_TICK_S`, `SAFETY_S`, `OBS_FRESH_S`, and the input census.
- The observer core: the attach state machine (`NO_SERVER` → `ATTACHING` → `LIVE`, plus `UNSUPPORTED`); subscription
  parsing and validation; the literal gate with its capture confirm; wake routing and rate limits; the rungs; the
  earned beat; reconciliation; the backlog guard; the version gate; the shadow comparator.
- The observer's plumbing: `ctypes` inotify, `sd_notify`, and the `events.jsonl` writer with rotation.
- The supervisor side: registration, `_ev_usable`, `_ev_wait`, `_ev_armed`, the real-seconds beat, the jittered
  fallback, and the `cmd_clip` filter.
- The agent's regular-file gate (§4.6).
- The unit, the role-gated install with no enable, the retire path, the uninstall, and a doctor check. The doctor
  check reports the unit's state, the mode, the beat's age, and registrations against active `claude-session@` units.
- The suites in §14: a fake control-mode tmux, real-tmux CI, the soak fixture, the supervisor mutation rows and the
  censuses.

**Effort.** About 8–9 agent-days. Roughly 45% is mechanical and handed off with every diff reviewed: the plumbing,
the fake-tmux and soak fixtures, the mutation rows, and the unit and installer lines. The observer core and the loop
change stay native: they are judgement work on the fleet's single point of failure.

**Exit gate:**
- Every suite in §14 is green.
- **The soak passes:** 24–72 h, 55 synthetic sessions, in a container. tmux-server and observer RSS stay flat, and a
  polling oracle finds zero missed wakes.
- Within the soak, a SIGSTOPped observer is aborted within `WatchdogSec` + `TimeoutAbortSec`, after which the server
  has dropped the client and its RSS stops growing.

### 13.2 Stage 3b: shadow on the fleet

**Before it starts:**
- 3a's exit gate is met.
- The stop rule (§13.4) has been applied after W4 was measured, and the operator chose to go on.
- **The operator approves the attach under the SAFETY rules.** Attaching a client to the fleet's tmux server is a
  direct tmux touch ("NEVER touch tmux … directly"), and the approval request names that rule. No session arms the
  observer.

**Arming takes two operator acts:** enable `ccd-observe.service`, and write `shadow` to `$REG/.observe/mode`. Nobody is
enrolled, so every supervisor stays on `sleep 5`.

**It runs for 3–7 calendar days and measures:**
- `late <id> <class> <Δs>` for every supervisor action, against the event-mode schedule model. The actions are the
  `swap.log` classes `auto-rescue`, `auto-home`, `auto-pool`, `auto-compact` and `stale-resume`, and writes of
  `.uuid`, `.routeapplied`, `.lastcompact`, `.lastswap`, `.stalepress`, `.typed` and `.home`.
- Status-file write rates by transition, and whether every `sessionId` rotation wrote the file.
- Whether idle panes repaint: the `window_activity` changes on idle rows.
- The literal false-positive rate: wakes that the tick then declined.
- Wakes per hour by row state.
- Whether inotify delivers on every watched directory: reconciliation drift counts.
- Observer CPU and RSS; tmux-server CPU and RSS on the real box.

**Exit gate:**
- 3 or more days in which no action class is later than its tolerance:

  | Action | Tolerance |
  |---|---|
  | Stale Enter, uuid, route apply | 5 s |
  | Rescue, compaction | 30 s |

- tmux-server RSS shows no upward trend beyond the variation of its pre-shadow baseline.

**When to abort.** If tmux-server RSS trends upward, the observer's CPU exceeds the budget, the attach loops, or
reconciliation drifts persistently: mode `off` (§13.3), then stop the unit. Nothing about the supervisors needs
undoing.

### 13.3 Stage 3c: the flips

- **Flip-1, idle rows gated.** Busy rows are still woken every 5 s.
  - **The steps:** enrol 1–2 low-stakes rows (`on/<id>` under `shadow`) and hold for at least 24 h; then about 10% of
    rows, held for at least 24 h; then mode `on`.
  - **No restarts.** Each step is a builtin test on the supervisor's next wait.
  - **The canary at each step**, compared with the day before:
    - `swap.log` counts for `auto-compact`, `compact-skip` by reason, `stale-resume`, `auto-home`, `auto-pool`,
      `auto-rescue`, `tickstuck` and `unstranded`;
    - `routeskip`/`routenote` reasons;
    - no active unit's stamp older than 120 s;
    - no `unsupervised` flaps on the board;
    - the comparator's `late` counts.
  - **Before it starts:** #189's pending walk is wired (§7.2) if #189 has merged.
- **Flip-2, busy rows gated too.** Only if the shadow and the Flip-1 data together show **zero late pane-rung
  actions**. The operator places `flip2`, with the same staging. If the data show any late pane-rung action, the fleet
  stays at Flip-1.
- **Exit:** supervisor CPU is re-measured with the same sampler as the diet; the target is 0.08–0.19 cores [I], and the
  latency gains of §11 are confirmed by the comparator.
- **The levers,** the operator's only, under the SAFETY rules:
  - **Mode `off`.** The observer writes one wake to every FIFO and detaches, so every row is legacy at once.
  - **Stop the unit.** Every row is back on `sleep 5` within 15 s (§9.4).

  Both levers are independent of the diet's.

### 13.4 The stop rule (ruled with plan D)

Once diet W4 is deployed and measured, the operator decides whether the observer goes past stage 3a.
- If neither its latency gains nor a fleet view for #390 is wanted, the observer parks after 3a (its off-fleet build
  and soak), with its code dormant.
- CPU alone, about 0.1 cores at 55 sessions [I], does not justify attaching a new client to the fleet's tmux server.
  That server is the single point of failure whose out-of-memory kill on 2026-10-12 stopped every pane (#358).

The diet spec's §3.6 states the same rule in the same words.

The decision uses:
- W4's measured per-tick cost, which replaces §3.2's inferred 0.03–0.05 CPU-s and re-derives that table;
- the soak's results;
- #390's state at that time.

### 13.5 Stage 4, in a separate spec

Issue #390 could read an observer `state.json`, beside its own registry-snapshot agent op, which needs no observer.
That needs its own spec: about 3–4 days, mostly native, with a skew rule that a missing, stale or wrong-version file means
polling per row as today. This spec writes no `state.json`.

### 13.6 Effort and calendar

| Stage | Agent-days | Route | Calendar [I] |
|---|---|---|---|
| 0: this spec, the decisions, the D-numbers | (with the diet's stage 0) | native | now |
| 3a | 8–9 | about 45% handed off; the core stays native | overlaps diet stage 2; about 1.5–2 weeks out |
| 3b | 1 | native operations | 3–7 days |
| 3c | 1 | native operations | about 1–2 weeks |
| **Observer total** | **about 12–15**, plus the shadow's calendar time | | Flip-1 about 3–4 weeks out |

## 14. Proof

### 14.1 The supervisor side

These use `makeCcdHarness` in a fixture HOME with a real FIFO. Each guard has a row that turns red when the guard is
removed:

| Guard removed or broken | Red result |
|---|---|
| The beat-freshness check | A stale beat must still give `sleep 5` |
| The future-dated check | A beat 60 s in the future must fall back |
| The v1 check | A `v2` beat must fall back |
| `-f` before `read`, on `beat` and on `mode` | A FIFO planted at either name must not hang (`runBounded`) |
| The mode and enrolment test | `off`, or `shadow` without `on/<id>`, must give `sleep` |
| The drain spelling | With `read -t 0.001`, the wake-line corpus must stay unsplit |
| The 5 s floor | 10 wakes inside 1 s must give 1 tick |
| The safety cap | 10 minutes with no wake must give full ticks ≤ 30 s apart and stamps ≤ 30 s + spent apart |
| The stamp deadline in the cap | A tick that ran long must not push the next stamp past 30 s |
| The armed-file cap | A present `.rescuewait`, `.stranded` or young `.stalepress` must give ticks 5 s apart |
| The beat deadline in the cap | A beat going stale mid-wait must end the wait at staleness + jitter, not up to 5 s later |
| The jittered fallback | The fallback moment must differ across two ids, and land ≤ 15 s after the last beat |
| `[[ -p ]]` before `exec` | A regular file at `wake/<id>` must leave the row legacy |
| The real-seconds beat | Event mode over 4 waits of 25 s must give a stamp at every safety tick |
| Registration ≠ `_tmux "$id"` | A census pin |
| The fork budget | Event mode must make 0 forks between ticks (xtrace `BASHPID` count, portable to the macOS legs) |
| The `cmd_clip` filter | With a control-mode client newest, `ccd clip` must pick the `cc-` client |

**Existing suites that must stay green, unchanged:** `ccd-substrate` (`['5','5','30','30','5','5']`),
`ccd-session-state`, `ccd-route-tick`, `ccd-limit-stale`, `ccd-cold-start-substrate`, `ccd-supervised-start`,
`ccd-tmux-anchor` and `macos-platform`. They have no beat file, so they run the legacy path.

### 14.2 Census pins

1. **Inputs.** The tick's input census, built from a static walk of ccd's call graph out of the five tick functions,
   lists every `_reg_get`/`_reg_read` field and every file path read. Each must be classed in `observe-spec` as
   `trigger`, `self` or `safety`. A new read reds until it is classed.
2. **The D-4967 census.** The five checks of §5.
3. **`-N` everywhere.** Every tmux argv in `ccd-observe.py` carries `-N`.
4. **The command whitelist.** The control-channel commands the observer can send match the whitelist in §6.3. It
   contains no mutator outside the observer's own session.
5. **Writes stay under `.observe/`.** The observer writes only under `$REG/.observe/`, and the three operator files
   have no writer in the tree (`single-definition.test.ts`).
6. **Per-process state.** Every per-process state array that a tick function reads or writes is classed by
   `_ev_armed` as armed-when-pending, or as not cadence-sensitive. This pins #189's walk (§7.2).

### 14.3 The observer side

- **A fake control-mode `tmux` first on `PATH`.** It reads commands on stdin and plays scripted transcripts:
  `%begin`/`%end`/`%error`, `%subscription-changed`, `%sessions-changed`, `%unlinked-window-close`,
  `%client-session-changed`, `%exit`, malformed and oversized lines, a pane line reading `%end`, a stall, and a reply
  that never comes.
- **The facts in §2.2–§2.4 are its specification.**
- **It is driven from vitest through `spawnPy`,** as the long-running Python precedent is
  (`server/test/ccgptHarness.ts`).
- **The harness refuses to spawn the observer without the shim first on `PATH` and `TMUX` unset**, in the spirit of
  `ghContainedEnv()`. A mutation row removes the shim and expects the refusal.

The assertions:
- **Wakes:** which FIFOs got which wakes; `ENXIO` and `EAGAIN` handling; the rate limits; the busy↔shell projection
  (no wake); the rungs at +31 s and +61 s; the 5 s re-wake while a literal is visible.
- **The self-trigger guard:** one tick's own writes produce 0 wakes.
- **The beat:** none before the first validated value; none while a ping is unanswered; it stops at `%exit` and
  resumes after a resync; none while the mode is `off`.
- **The backlog cap:** a flood past the cap stops the beat and kills the client.
- **The watchdog:** no `WATCHDOG=1` while the loop is blocked.
- **Validation:** a malformed first value means no beat.
- **The session guard:** being moved into another session means a detach.
- **The version gate:** an unproved version means `UNSUPPORTED`.
- **Reconciliation:** drift wakes the affected rows, and three drifts stop the beat.
- **Overflow:** every row is woken, spread over 5 s.
- **Retirement:** RESPEC when ccd's body changes; RETIRED when `observe-spec` is unknown.

### 14.4 Real tmux

This runs on Linux CI on an isolated `-L` socket, through `ccd-tmux-anchor.test.ts`'s shim pattern, and never on the
default socket. It covers:
- kill-session, kill-pane, resize, and pane exit with and without `remain-on-exit`;
- a banner literal appearing gives a wake within 2 s;
- an idle pane gives 0 wakes over 60 s;
- `#{C/ri:…}` with the D-4967 set on 3.4, including the `/` in `please run /login` and the `:` in `api error: 429`;
- the `#{session_id}` form of the subscription, and the no-bare-comma rule (§4.4);
- whether a `read-only` client may still run `capture-pane` (§6.2);
- `-N` with no server: rc 1, and no server created;
- the D-4970 rule's own row (§10);
- the `destroy-unattached` and `tail --pid` cleanup.

### 14.5 The soak and the shadow

- **The soak:** §13.1's exit gate. It is a fixture run off the fleet, not a CI job.
- **The shadow comparator on the fleet is the end-to-end proof** (§13.2). It is a measurement, not a unit test.

## 15. Deploy and rollback

**Deploy class: AGENT-FIRST** (`ccrc rollout`, or `ccrc update` on the fleet box first). What ships:
- **In `ccd/ccd`:** the constants, `observe-spec`, registration, the `_ev_*` functions, the D-4967 block if it is not
  already there, and the `cmd_clip` filter.
- **New files:** `ccd/ccd-observe.py`, installed to `~/.local/libexec/ccrc/`, and `deploy/systemd/ccd-observe.service`.
- **In `ccd/ccrc`:**
  - `_inst_units` installs the unit for the `both` and `fleet` roles on Linux, and does not enable it.
  - The installer runs `try-restart ccd-observe` only when the script's hash changed. `try-restart` leaves a unit that
    is not running alone.
  - `cmd_uninstall` (≈:22765) removes the unit beside the existing removals.
  - The doctor gains the check from §13.1.
- **In the agent:** the regular-file gate (§4.6).

**How it reaches the supervisors.** They pick up the loop change at `_upd_sweep`'s `try-restart claude-session@*`
(`ccd/ccrc` ≈:21261), behind its `KillMode=process` preflight, as today. They re-register at start. The observer
neither changes the sweep nor depends on it.

**Mixed versions are safe unit by unit (F12).**
- Old supervisors ignore `.observe/`.
- New supervisors with no beat stay legacy.
- A ccd body change makes a running observer exit RESPEC and come back on the new spec.

**Rollback** is `ccrc update --to <prev>` or `ccrc rollback`:
- The old supervisors ignore `.observe/`.
- The leftover observer finds ccd's body changed and runs `observe-spec`. The old ccd does not know the subcommand,
  so the observer exits RETIRED, which is in `RestartPreventExitStatus`, and systemd leaves it stopped.
- Its tmux session ends through `destroy-unattached` and the `tail --pid` pane [M].
- What remains is an inactive unit and a directory, both harmless.

**The levers** (mode `off`, or stopping the unit) are the operator's alone, and each returns every row to `sleep 5`
(§13.3).

## 16. Open operator decisions

| # | Decision | Recommendation |
|---|---|---|
| 1 | **Placement.** A standalone Python standard-library `ccd-observe.service` on the roles that run sessions (`both`, `fleet`), Linux only, with thin per-session waiters; or node; or the agent (§4.2) | The Python unit |
| 2 | **`SAFETY_S`.** 30, which keeps §4.2 of the heartbeat contract literally true; or 60 with an amendment to it (§7.4) | 30 |
| 3 | **The empty-server rule (F9, D-4970).** A: the observer's session keeps an otherwise empty server alive. B: detach when it is the last session (§10). | A |
| 4 | **Flip-2.** Gate busy rows only after the shadow and Flip-1 show zero late pane-rung actions; otherwise stay at Flip-1 | As stated |
| 5 | **The shadow gate.** The tolerances in §13.2, over 3 or more days, plus flat tmux-server RSS | As stated |
| 6 | **The limits files.** Not watched, so an affinity move on a limits change is up to about 25 s later. Or watched per account, waking that account's rows at most once per 30 s (§4.5). | Not watched |
| 7 | **Arming.** It takes two operator acts (enable the unit; write the mode). `mode`, `flip2` and `on/<id>` have no writer in the tree (§4.6). | As stated |
| 8 | **The 3b attach.** Asked for at the time, naming the SAFETY rule (§13.2) | — |
| 9 | **The D-4967 literal set** (§5): the 14 literals, with no bare `limit`. Diet W4 consumes it and does not merge until it is approved. | The set as drafted |

**Open in the diet spec, with the same recommendations** (its §12 O1–O5). They are restated because they bind this
design:
- **The cadence stays 5 s (O3).** That holds for every legacy row, as the floor of event mode, and as the busy-row re-wake
  under Flip-1. This design changes cadence only for rows the operator enrols.
- **D-3525's census is untouched (O1).** The observer targets panes by `%N` and sessions by `$N` mapped from exact names.
  The supervisor declares its name with `_tmux "$id"`. No `-t` site is added to ccd.
- **Prefilters, not regex ports (O2).** D-4967 is a prefilter, never a classifier.
- **The landing order with #189 (O4).** Diet W1–W3 land first, and W4 lands after #189. This design's loop PR lands after
  diet W1, and Flip-1 waits on #189's pending walk being wired (§7.2).
- **Follow-ups are separate specs (O5).** 2a (D-4966) is the diet's. #390's consumer is stage 4.

**Already ruled (2026-10-13):** the structural rework is wanted; plan D, with the stop rule (§13.4). The diet's tick
memo and `TICK_MEMO_MAX_MS=1000` are also ruled, but they do not bind this design.

## 17. Deviations

D-4960..D-4972 were ISSUED by `POST /api/ledger/deviations` on 2026-10-13. D-4960..D-4966 belong to the diet and are
defined in its spec. This spec defines the observer's six:

- **D-4967** — `shared-literal-set`: one array, `PANE_LIT`, in `ccd/ccd`'s constants: 14 lowercase literals,
  at least one in every alternative of `_pane_limit_stale`, `_pane_hard_blocked`, `_pane_limit_banner` and
  `_pane_auto_continue_armed`, with no bare `limit`. The diet's prefilters (D-4965) and the observer both consume it,
  the observer through `observe-spec`. The census in §5 pins it.
- **D-4968** — `observer-attach-mode`: the observer runs one control client: `-N` on every argv, its own `ccrc-observe`
  session, `no-output`, no `%output`, one session-scoped subscription, a command whitelist and a session guard. The
  backlog guard is in five layers (payload, drain-first loop, in-process cap, watchdog, soak), because tmux buffers
  without limit for a client that stops reading. It attaches only to a proved tmux version.
- **D-4969** — `safety-tick`: with `SAFETY_S=30`, an enrolled quiet row runs a full tick no later than 30 s after
  its last tick started, and no later than 30 s after its last stamp. In event mode the heartbeat counts real seconds,
  and only a tick that ran the checks stamps, so §4.2 of the 2026-08-12 spec stays literally true. `SAFETY_S` itself
  is an open decision (§16, 2).
- **D-4970** — `empty-server-rule`: F9. Whether the observer's session may keep an otherwise empty tmux server
  alive (recommended), or detaches when it is the last session. It is an open decision (§16, 3).
- **D-4971** — `earned-beat`: `$REG/.observe/beat` is written only while the observer is `LIVE`, a ping has answered
  within 10 s, every watch is present, reconciliation is clean, the drain keeps up, and the mode is `shadow` or `on`.
  It is the only thing that lets a supervisor wait longer than 5 s, and it says nothing about any session.
- **D-4972** — `wake-routing`: there is one FIFO per supervisor, opened `O_RDWR` by the supervisor and written
  `O_WRONLY|O_NONBLOCK` by the observer. Lines are `v1 <reason>`, with no authority, drained with `read -t 0`, rate
  limited at both ends and spread on fleet-wide wakes. The fallback is jittered and lands on `sleep "$tick"` within
  15 s of the last earned beat.

**Where the ledger entries go.**
- **The constraint.** `deviation-refs.test.ts`'s floor case reds while any tracked text names a number above the
  highest one that a plan's `## Deviations found` defines. This spec names numbers up to D-4972, so the branch that
  lands it must also carry a plan that defines D-4967..D-4972 in entry form. The stage-3a plan is weeks away.
- **So the entries go in a plan on this spec's landing branch:** the first plan, written with the two specs at
  stage 0, `2026-10-13-supervisor-tick-diet-w1-w3.md`. Its entries use the definitions above, with the same slugs.
- **Later plans cite these entries and never redefine them.** That covers the stage-3a plan and the diet W4 plan,
  which writes D-4967's array. A number defined in two plans is a collision, and `deviation-refs.test.ts` reds on it.
