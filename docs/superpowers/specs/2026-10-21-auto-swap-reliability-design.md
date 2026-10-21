# Auto-swap reliability (design)

**Status:** rev 0 (2026-10-21). Written after a read-only investigation and the operator's ruling of the same day, which accepted every recommended decision D1 to D7 (§6, the decision log). It defines no D-numbers; the W1/W2 plan (`docs/superpowers/plans/2026-10-21-auto-swap-reliability-w1-w2.md`) defines D-6180 to D-6185.

**The request (operator, 2026-10-20, verbatim):**

> "for accuount autoswich, if an workspace stops working due to acount lmits, it should atomatically switch to a different account. currently this is not reliably happening and workspaces wdo not resurrect with a new account automatically - switch is often manual in practice"

**The operator's ruling (2026-10-21, verbatim),** the answer to "Auto-switch fix: accept the recommended decisions D1–D7?":

> "Accept all recommended (Recommended)"

- **Citations** are to `origin/main` `d8cd47658` (session continuity wave 4b, #435, merged 2026-10-21). They name a function, constant or file in `ccd/ccd` or `ccd/ccd-telemetry-keepalive`; this document cites no line numbers. The investigation read `41a08beb0`; every symbol below was re-measured on `d8cd47658`.
- **Measurements** come from three read-only inventories of 2026-10-20 (the code path; the fleet evidence over 2026-10-13 to 2026-10-20 from the swap log, the registry, the limits files and the lifecycle journal; the prior decisions), a synthesis, and an adversarial verification that refuted two of the synthesis's framings (§2.1, §2.6). **[M]** marks a measured figure, **[I]** an inferred one, **[open]** a fact not yet measured. Accounts, lanes and sessions are never named: "an Anthropic account", "a non-Anthropic lane such as a GPT-backed lane", "account-a".

**Date:** 2026-10-21 · **Branch:** `docs/auto-swap-reliability` (cut from `origin/main` `d8cd47658`) · **Issues:** #199 (no revival on another account), #382 (an auto-swap off switch, open), #998 (a stale pool lease fails shut), #684 (auto-swap is never blocked, documented), #1050 (open: an affinity swap waits while the session has background work)

**Related:**
- `2026-10-19-ccrc-consolidation-wave-design.md`, the architecture direction: K15 (placement; `_swap_target` and `_limit_score` stay ccd's), K3/K4 (`_swap_idle_gate` is out of both), K8 (the pane grammar), K12 (switches; box markers readable with the server down), §5.13 (the swap path stays bash) and §7 (the swap pin). §4 maps this design onto it.
- `2026-09-23-session-continuity-design.md` §5.4 (the rescue's rules 1 to 3) and §6 ("No revival").
- `2026-09-04-account-pools-design.md` and `2026-09-18-account-pool-membership-design.md` (pools, `_pool_ok`; the "spend-cap billing groups" of an older ruling are not on `main`; pools replaced them).
- `2026-09-19-autoswitcher-and-compaction-defects.md` (plan; D-3097 to D-3100: the manual-swap pin, its floored note, "the pin follows the truth", the banner arm).
- `2026-09-10-limit-recovery-followups-design.md` (D-2363, D-2364: the transcript arm and the pane regex kept narrow on purpose) and `2026-08-28-limit-park-and-wake-design.md` (wave 3 never built).
- `2026-09-07-telemetry-keepalive.md` (plan) and `2026-09-07-account-health-and-provenance-design.md` (the keepalive and the limits files).
- `2026-10-13-supervisor-tick-diet-design.md` (the tick's fork budget, `ccd-tick-budget.test.ts`).
- `2026-10-16-working-state-and-interruptions-design.md` §5.11 (hibernation, D-5242; the `.woke` cooldown and the ensure-wake gate).
- `2026-10-18-accounts-connect-design.md` and its plan's Q8, amended 2026-10-19: "switching to a different account to do work shoul dnever be blocked if it prevents the auto-account swapping".

## In short

- **When ccd sees a limit, the swap works.** 16 of 16 automatic rescues completed, mostly within about 2 minutes; 69 of 69 post-swap resumes were not stalled; 0 swaps were refused; 0 sessions died at a limit and stayed dead [M]. The "manual in practice" experience comes from **where** ccd sends sessions, from **never bringing them back**, and from a minority of limits ccd **never acted on and never logged**.
- **Six causes (§2):**
  1. **A structural score asymmetry makes non-Anthropic lanes win.** A GPT-backed lane is scored on its weekly figure alone, which barely moves (2 to 11), while an Anthropic account is scored on max(5 h, 7 d) and rarely reads below that. 30 of 52 automatic moves landed on a non-Anthropic lane (11 of 16 rescues, 19 of 36 ceiling-leaves) [M]. Stale telemetry amplifies it; it does not cause it.
  2. **The return home freezes at the reset second.** When home's seven-day window ends, its figure becomes unknown, `_class_gate` answers "unmeasured", and `_swap_target` decides nothing (rc 5, `classwindow`) until something measures home, and the parked session is the one that would. Parks of 9 h 52 m and about 24 h are measured [M].
  3. **No sideways move.** While home stays blocked (most rescues are weekly blocks), the affinity arm only returns home or stays put; it never moves a session off a non-Anthropic lane to an Anthropic account with room.
  4. **Manual pins switch the return home off with no end.** 17 pins, about 1,290 `pin-hold` lines in 7 days; one pin holds a session on an account at its 5-hour ceiling [M].
  5. **Silent stand-downs.** 2 of about 18 workspace limit events were never acted on (41 min and 2 h 48 m) and wrote no log line; six verdicts and five gates return silently.
  6. **No revival on another account** for stopped, hibernated or failed-unit sessions, by ruling (#199). 0 cases measured.
- **The design (§3), one ruling each:** D5 logs every silent stand-down (first, so the rest is observable); D4 makes pins expire and never hold a session at the ceiling; D3 lets the return home take an ENDED window as servable, staggered per home account; D1 ranks non-Anthropic lanes after every Anthropic account with room (overflow only); D2 moves a session on a non-Anthropic lane sideways to an Anthropic account with **measured** room; D7 makes the keepalive produce a real measurement; D6 keeps "no revival" as it is.
- **Nothing is blocked.** Every change orders, logs or ends a stand-down; none adds a refusal to the swap path, delays a rescue, or touches `_swap_idle_gate`'s verdict table. Each change that alters a swap decision has its own off marker in the registry, read by ccd with the server down (§7).
- **Waves (§5):** W1 = D5, D4, D3, D1, one PR each, in that order. W2 = D2, D7.

## 1. The problem in numbers

### 1.1 What the operator sees

The operator's words are the requirement: when a workspace "stops working due to acount lmits", it "should atomatically switch to a different account", and today "switch is often manual in practice". Measured over 2026-10-13 to 2026-10-20 [M] unless marked:

| What | Measured | Source |
|---|---|---|
| Workspace limit events | about 18 (12 transcript rows, plus pane-detected hits) | transcripts, swap log |
| Automatic rescues (`auto-rescue`) | 16, all completed; latency 10 to 120 s where measurable | swap log, lifecycle journal |
| Automatic affinity moves (`auto-home`: return home or leave at the ceiling) | 36, about 33 completed | swap log |
| Dispatches lost before they ran | 3 of 52 (the registry row was gone, "no registry") | swap log |
| Refused swaps, rescue-cancel, rescue-backoff, requeue, dispatch failed | 0 | swap log |
| Automatic moves that landed on a non-Anthropic lane | 30 of 52: 11 of 16 rescues, 19 of 36 ceiling-leaves | swap log (verified recount) |
| Automatic moves that came back off a non-Anthropic lane | 9 | swap log |
| Manual swaps (the PWA or the API) | 15, plus 3 with no attributable caller | lifecycle journal (`cg=agent`) |
| Of the 15, moves off a non-Anthropic lane to an Anthropic account | 8, after 1.9 h to 4.4 days parked | swap log joined to the journal |
| Of those 8, a return to home | 1; the other 7 went to another Anthropic account (sideways) | verification |
| `tick-undecidable … classwindow` lines | 25; 22 on an hour boundary, at the exact reset second of the session's home | swap log, limits files |
| Manual-swap pins standing (`.swappin`) | 17; about 1,290 `pin-hold` lines in 7 days | registry, swap log |
| Pins holding a session on an account whose 5-hour figure reads 100 | 1 | registry, limits files |
| Stopped sessions parked on a non-Anthropic lane | 8, of which 3 are pinned there | registry |
| Limit events with no swap and no log line | 2: 41 min, and 2 h 48 m | transcripts, swap log |
| Narrow-pane stand-downs (`swap-skip … under 120 columns`) | 4 lines (rate-limited; episodes under-counted) | swap log |
| Keepalive outcomes `refreshed` | 0 across its 10 stored passes (149 skipped, 1 `no-render`); consecutive failures 10 to 39 per account | keepalive census and state |
| Limits files older than a day | about half; up to 66 h old | limits files |

**Not yet measured** [open], each a first step of the wave that needs it:
- Which silent verdict held each of the 2 undetected limits (§2.5). D5 makes the next one countable.
- Whether any narrow-pane stand-down overlapped a real limit. D5's evidence word answers it; the narrow-pane gate is decided after (§3.5).
- Per-account usage at each past failure: there is no usage history on the box, so "an Anthropic account had room" is inferred from the targets ccd chose and the operator's later manual targets [I]. On fresh telemetry at the time of the verification, the best fully measured Anthropic account scored 8, the rest 32 to 80, and the two GPT-backed lanes 2 and 11 [M].
- Whether a keepalive turn can produce a statusline-grade measurement at all (§3.7). D7's Step 0.

### 1.2 What the numbers say

- **Detection and the act are sound; placement and recovery are not.** Every dispatched rescue completed. The operator's manual work is correction: 8 of 15 manual swaps took a session off a non-Anthropic lane that ccd had put it on, after hours to days.
- **The magnet is structural.** Even with every account freshly measured, the GPT-backed lanes score lower than all Anthropic accounts but one. Fixing telemetry alone changes no choice ccd made in the window (§2.1).
- **Recovery deadlocks on measurement.** The return home needs home measured; only a session on home measures it; the parked session is that session. One parked session went home 7 s after the operator moved a different session onto the same home [M].
- **Manual correction makes the park permanent.** A manual move mints a pin; the pin switches the return home off until the next automatic swap. Three sessions moved sideways by hand re-froze on non-home accounts and now log `pin-hold` every 30 minutes: ccd wants them home and may not move them [M].
- **"Resurrect with a new account" is two different things.** A live session at a limit is moved (it is, when detected). A stopped or hibernated session is never moved while it has no supervisor tick; by ruling (#199) it is not revived elsewhere, and 0 such cases were measured. What the operator sees as "do not resurrect" is causes 1 to 4 acting on live sessions.

## 2. The causes, as a causal chain

The only automatic switch is `_auto_swap_check`, called by `cmd_supervise`'s loop every 5 s in its `live` arm only. The server and the agent never switch an account on their own; they relay the operator's swaps. The tick, in order:

1. `_pane_measurable` (a pane under `READER_MIN_COLS`, 120 columns) returns at once, the rescue included, with `_pane_narrow_note` at most once per `COMPACT_NOTE_FLOOR` (1800 s).
2. The `.wrapper` and `.project` reads (`_tick_undecidable` and `_tick_strand_undecidable` on failure), `_swap_pin_tick`, the pool state and the crossing record.
3. `lastswap` inside `SWAP_COOLDOWN` (900 s), then `swapblocked` inside `SWAPBLOCK_COOLDOWN` (1800 s): silent returns, **before** detection.
4. Detection: `_session_hard_blocked` (the pane arms `_pane_hard_blocked` and `_pane_limit_banner` over `tail -8` of the pane; then the transcript arm `_limit_dated`, cached for `TRANSCRIPT_ARM_INTERVAL`, 30 s; the carried-in filter, D-3526).
5. `_rescue_policy` (the near-reset wait, the turned/grace window, the chain wait).
6. `_rescue_target` → `_swap_target`: the target, or rc 1 (nowhere) or rc 2 to 5 (undecidable: crossing, project, pool, class window).
7. A hard-blocked session: `auto-rescue` and `_dispatch_swap … rescue`, **above** the pin. Otherwise: the pin (`_swap_pinned`, `pin-hold`), `.hold`, the `.woke` cooldown, `_swap_idle_gate`, then `auto-home` (or `auto-pool`) and `_dispatch_swap … affinity`.
8. `_dispatch_swap` runs `ccd swap` in a detached unit after 0 to `SWAP_JITTER` (120) s; `cmd_swap` re-checks (`_swap_rescue_act_gate` or `_swap_idle_gate`), stops, carries, rewrites the wrapper, writes `lastswap`, and, on the operator path only (`CCD_SWAP_AUTO` unset), writes the pin.

### 2.1 Cause 1: non-Anthropic lanes win the ranking (structural)

- **Where:** `_swap_target`'s candidate loop. For each candidate in `_pool_for` (not `cur`, not in `SWAP_TARGET_SKIP`), it requires `_pool_ok`, `_account_ok`, `_avail` and `_class_gate`, then `sc=$(_limit_score cand); : ${sc:=100}`, auth-dead → 101, and keeps the **lowest** score among `_is_home_able` candidates (`best`), with non-home-able ones (`obest`) only as a fallback. Nothing prefers an Anthropic account.
- **`_limit_score`** returns max(five, seven) only when both windows are measured, with one exception: a lane whose limits file says `fiveWindowMinutes` 0 (a GPT-backed lane) is scored on seven alone.
- **Why it is structural.** A weekly-only figure on a lane whose weekly percentage barely moves (2 and 11 measured) is compared against max(5 h, 7 d) on Anthropic accounts that are in use. On fresh telemetry, one Anthropic account scored 8 and the rest 32 to 80 [M]. The GPT-backed lanes win almost every comparison whatever the measurement.
- **The amplifier.** `_limit_field_to` reads a window whose `ResetAt` has passed, or whose file is older than 5 h (five) or 7 d (seven), as unknown; `_limit_score` then answers "", which ranks at 100. An idle Anthropic account, the one with the most room, therefore ranks worst. Nothing refreshes it (§2.7).
- **Refuted fix, recorded:** "score on seven when five has ended" (the symmetry quick win) would have changed no choice in the window, and contradicts `_limit_score`'s own documented rule that one known half bounds the truth only from below. It is dropped.
- **Also measured:** for a class-tagged session (75 of 77 sessions carry `opus`), pass 1 of the loop **skips** any candidate whose seven-day window has ended (`_class_gate` rc 2 → `unmeas++`, `continue`); it is not ranked last, it is invisible. If any other candidate is servable, the skipped ones are never considered.
- **Bursts leak.** The rescue's spread rule (`RESCUE_SPREAD_WINDOW`, 600 s) pushes later rescues in a burst off targets that earlier rescues took; with the asymmetry, the next-best target is a GPT-backed lane. In one burst of 7 rescues from one account, 3 went to a GPT-backed lane [M].

### 2.2 Cause 2: the return home freezes on an ended window

- **Where:** `_swap_target`, the non-forced branch for a session not on home. `_avail home` passes (an unknown figure counts as free). `_class_gate home <class>` → `_serviceable` → `_limit_field_to … seven` is "" because `sevenResetAt` has passed → `no-figure`, rc 2 → `[[ -n $force ]] || return 5`.
- **Then:** `_auto_swap_check` maps rc 5 to `_tick_undecidable classwindow`, which logs **once per episode** (`.tickstuck` compares the field word) and returns. No move and no further line follow until home is measured.
- **The deadlock:** home is measured only by a statusline render on home, and the parked session is the one that would render it. The keepalive does not (§2.7).
- **Measured:** the freeze lines sit on the exact reset second of the session's home (for example one session at 11:00:00 on its home's weekly reset, parked 9 h 52 m until a manual move home; another parked about 24 h and returned automatically 7 s after the operator moved a different session onto the same home) [M]. Three more re-froze off the hour **after** the operator moved them sideways, because their home was still unmeasured [M].
- **The herd hazard in any fix:** freezes cluster on one home's reset second (four sessions within 8 s on one boundary [M]). "Go home when the window ended" alone would dispatch all of them onto one account inside `SWAP_JITTER`: a small restart herd (SessionStart hooks; the 2026-08-14 usage-scan herd is the precedent).

### 2.3 Cause 3: no sideways move while home stays blocked

- **Where:** `_swap_target`'s same branch. When home fails `_avail` (a weekly block reads 99) and `_avail cur` plus `_class_gate cur` pass, it returns 0 with no output: stay put. The candidate loop runs only when forced or when `cur` fails.
- **Measured:** 4 of the 8 manual corrections moved a session off a GPT-backed lane to another Anthropic account while home sat at 99% weekly; one of those Anthropic accounts read five 42 and seven 32 at the time of the rescue that had chosen the GPT-backed lane [M].
- **Note:** the registry examples first cited for this cause are stopped sessions (verification); the live examples are the manual moves.

### 2.4 Cause 4: pins switch the return home off with no end

- **Where:** `cmd_swap` writes `$REG/<id>.swappin` (the target's name) on the operator path (D-3097). `_auto_swap_check` checks `_swap_pinned` **after** the rescue dispatch and before the affinity dispatch, logging `pin-hold` at most once per `ROUTE_NOTE_FLOOR` (`_route_note_floored`, D-3098). `_swap_pin_tick` clears the pin only when the session is on a different account than the pin names (D-3099), which in practice means the next automatic swap.
- **What it suppresses:** the return home **and the ceiling-leave**. `pin-hold` is written only when ccd has a target other than `cur`, so every one of the about 1,290 lines is a move ccd wanted and did not make [M].
- **Harms measured:** a session pinned on its home at a 5-hour figure of 100 cannot leave at the ceiling, so every turn there is paid overage until a hard block fires (`SWAP_CEILING`'s own comment); 3 stopped sessions are pinned to GPT-backed lanes and will restart there with the return home off [M].
- **The rescue is not affected:** the rescue arm sits above the pin (the 2026-09-19 plan: "The rescue arm is never gated by the pin").

### 2.5 Cause 5: silent stand-downs

Places where a session the transcript says is limited is not moved, and nothing is written:

| Site | What it does | Logged today |
|---|---|---|
| `SWAP_COOLDOWN` after `lastswap` | returns before detection | no |
| `SWAPBLOCK_COOLDOWN` after a refusal | returns before detection | no (the refusal itself was) |
| `_session_hard_blocked` → `HARD_BLOCK_NO=unmeasurable` | no verdict on a narrow pane | no (the tick's own narrow note is floored at 30 min) |
| `HARD_BLOCK_NO=carried-in` | a banner older than this process and the last swap | no |
| `HARD_BLOCK_NO=running` / `stalepress` | mid-turn, or a stale press within its grace | no |
| `HARD_BLOCK_NO=negative` | the cached transcript verdict says no; a carried-in transcript row also caches as `negative` | no |
| `HARD_BLOCK_NO=draft` | `_pane_box_has_content` sees text in the input box | no |
| the rescue's `_avail "$target" \|\| return 0` | a target chosen, then dropped | no |
| the affinity arm's `.hold`, `.woke` cooldown, `_swap_idle_gate` | a move ccd wanted, not made | no |
| `_tick_undecidable` | rc 2 to 5 | once per episode, never again |

- **The fingerprint of both undetected limits [M]:** the compact tick began logging `compact-skip … no-ctx-segment` at the very minute of the limit and every 30 minutes after. The footer had changed shape, which points to Claude Code's rate-limit dialog replacing the prompt and footer. Pane detection reads only `tail -8` outside the input box, so a multi-line dialog can push the "hit your limit" banner out of view; the transcript arm must then pass `_pane_box_has_content` with that dialog on screen. **A hypothesis to verify, not a finding** [I]; D5's lines carry the evidence that decides it.
- **Why it matters beyond 2 events:** the cause of each silent hold cannot be recovered after the fact, and the narrow-pane question (D5 in §6) cannot be decided without counts.

### 2.6 Cause 6: no revival on another account (by ruling)

- **Where:** `_auto_swap_check` runs only in `cmd_supervise`'s `live` arm. `claude-session@.service`'s `Restart=always` respawns the stored `.wrapper` through `cmd_ensure` with no headroom check; a hibernated session wakes on its stored account; `cmd_swap` refuses `.hibernated` ("wake it first"); a stopped or failed unit has no tick.
- **The rule:** session-continuity §6 "No revival", limit-park's non-goal and #199 ("leave it idle and count it").
- **Measured:** 0 sessions died at a limit and stayed dead; 8 stopped sessions sit on GPT-backed lanes, and 3 of those hold a manual pin there [M]. The synthesis claimed causes 1 and 2's fixes would send such a session home on its first live tick; the verification refuted that for the 3 pinned ones. With D4 their pins expire, so a restarted session takes the ordinary return home.

### 2.7 The amplifier: the keepalive measures nothing

- **Where:** `ccd/ccd-telemetry-keepalive`. Its turn is `<wrapper> -p <prompt> --output-format json`. A `-p` turn renders no statusline, and the only writer of `~/.cc-limits/<account>.json` is `ccd/statusline-command.sh` (from the statusline input's `rate_limits`). The turn exits 0 and the limits file does not move: `no-render`, counted as a failure, backed off up to 24 h.
- **And it skips accounts it should measure:** `_ka_session_on` treats a session with a supervisor heartbeat under `KA_SESSION_FRESH` (120 s) as occupied, and every supervised session heartbeats, idle or not. An idle session renders no statusline either, so its account goes unmeasured.
- **Measured:** 0 `refreshed` outcomes; one account had an rc 0 turn and its limits file was still 14.4 h old [M].
- **What it feeds:** cause 1's amplifier (idle accounts rank 100) and cause 2's deadlock (home stays unmeasured).

### 2.8 How they combine

```
cause 1: weekly-only score on GPT-backed lanes < max(5h,7d) on Anthropic accounts
         + §2.7: idle Anthropic accounts unmeasured -> rank 100
         ──▶ rescues and ceiling-leaves land on a GPT-backed lane (30 of 52)
                     │
cause 3: the affinity arm only returns home or stays ──▶ parked for the weekly block (days)
cause 2: home's window ends -> unknown -> rc 5, one line, frozen ──▶ parked past the reset (hours)
         + §2.7: nobody measures home (deadlock)
                     │
                     ▼
         the operator moves it by hand (8 of 15 manual swaps)
                     │
cause 4: the manual move mints a pin ──▶ return home and ceiling-leave off until the next auto swap
                     │                    (a sideways manual move re-freezes, then stays pinned)
                     ▼
         more manual moves ("switch is often manual in practice")

cause 5: silent verdicts and cooldowns ──▶ 2 limits never acted on, and no line says why
cause 6: stopped / hibernated / failed sessions have no tick ──▶ by ruling, not revived elsewhere
```

The common defect: **the auto-swap optimises one score and treats "unknown" two opposite ways.** Eligibility (`_avail`) reads unknown as free, ranking (`_limit_score`) reads it as worst, and the class gate (`_class_gate`) reads it as "decide nothing". A lane whose score barely moves then wins every ranking, the account with the most room loses it, and the one move that would undo the damage, the return home, is the one that waits for a measurement nobody takes.

## 3. Design

Every rule below changes one decision in ccd, at the place §2 names, and keeps the rest of the swap path byte-identical. The binding rulings hold throughout: account switching and the auto-swap are never blocked (Q8); no herd restarts or herd wakes; home-account affinity; pools (`_pool_ok`) are the spend and eligibility boundary; hibernation's ensure-wake gate; improve what exists first.

**What no rule here changes:** detection (`_session_hard_blocked`'s verdicts and the pane regexes, D-2364); the rescue's act-time gate (`_swap_rescue_act_gate`); `_rescue_policy`'s waits; `_swap_idle_gate`'s verdict table (consolidation §7's pin; #1050 is its own change); `_avail`'s eligibility, unknown read as free; `_limit_score`'s rule; `cmd_swap`'s carry and refusal set; `_pool_ok`, `_account_ok` and the crossing record; new-session placement (`_ws_least_loaded`, `_place_for_class`, the server's `projectHome`, K15's parity pin).

### 3.1 The per-home stagger, shared by D4, D3 and D2

A non-forced move that brings sessions back to one account at once is the only new herd risk in this design (§2.2). One helper guards it:

- **The rule:** an affinity move (never a rescue) whose target is a given account is taken only when no other affinity move onto that account was dispatched in the last `HOME_RETURN_SPACING` seconds. The plan sets it at 180 s, above `SWAP_JITTER` (120 s), so two dispatched moves onto one account never run inside one jitter window.
- **Atomic across supervisors:** each session has its own supervisor process, so the slot is an exclusive create (one file per target account and spacing bucket in the registry; exactly one tick wins a bucket). A tick that loses writes nothing and tries again on a later tick; the session stays on a working account meanwhile.
- **What it never does:** delay or refuse a rescue (a hard-blocked session never reads it), refuse a manual swap, or touch `cmd_swap`. It orders automatic arrivals; it blocks no switch.
- **Bound:** N sessions waiting on one home's reset go home over N × 180 s (four sessions: 12 minutes), each through the idle gate as today.

### 3.2 D5: log every silent stand-down (first)

**The rule.** Each site in §2.5's table writes **one swap-log line per episode**, re-logged at a floor, when there is evidence of a limit; nothing else changes.

- **One line form:** `stand-down <id>: <reason> [evidence=<pane|banner|transcript|carried-in|none>] [banner-outside-tail=<yes|no>]`, with the reason one of `cooldown`, `swapblocked`, `unmeasurable`, `carried-in`, `running`, `stalepress`, `draft`, `target-unavailable`, `hold`, `woke`, `idle-gate`. An episode is keyed on the reason word in a registry field beside `.tickstuck`; a decided tick clears it, as `_tick_decided` clears `.tickstuck`.
- **Evidence, cheaply:** on a silent-exit path only (never on the steady-state tick), at most once per floor per session, ccd asks the transcript arm (`_limit_dated`) whether the newest real row is a limit row of this process (`transcript`), an older one (`carried-in`) or neither (`none`). A cooldown or stand-down with `evidence=none` and no pane evidence writes nothing: the log stays about limits.
- **The dialog hypothesis:** on the same floored path, `banner-outside-tail` says whether `_pane_hard_blocked` or `_pane_limit_banner` match the **whole** visible pane while they did not match its `tail -8`. That answers §2.5's fingerprint directly.
- **The transcript cache:** a fresh scan that finds a carried-in row (`_limit_dated` rc 3) records `carried-in` as the stand-down reason instead of `negative`; the cached verdict's value (0) and its reuse are unchanged.
- **`tick-undecidable` gains a re-log floor:** the same field is logged again once the episode is older than the floor, with its age, so a frozen session stays visible in the swap log and the PWA's swap history.
- **The affinity arm's silent exits** (`.hold`, `.woke`, `_swap_idle_gate`) log only when ccd had a target other than `cur`, the same condition `pin-hold` uses.
- **The decision lines gain one word:** `auto-rescue` and `auto-home` lines end with `lane=anthropic|overflow` (from `_is_anthropic_backend` on the target), so §8 counts landings without re-deriving the roster. The measurement scripts' `auto-rescue` pattern already accepts a suffix.
- **Floors:** `COMPACT_NOTE_FLOOR` (1800 s), by reference, never a second literal.
- **What it does not change:** no decision. It is not behind a marker: switching it off would only hide lines. The steady-state tick gains no fork (the tick-diet budget fixtures pin it).
- **Then:** the narrow-pane gate (`_pane_measurable` suppressing the rescue) is decided by the operator only after a measured period of these lines (§6, D5's second half). Nothing here changes it.

### 3.3 D4: a manual pin expires, and never holds a session at the ceiling

**The rule.**
- **What `cmd_swap` records:** on the operator path, the pin records the account it names **and an expiry**: the next reset of the home window that was blocked when the pin was set (the later `ResetAt` of the home windows at or above `SWAP_CEILING`, read by `_limit_field_to`'s source), bounded by the set time plus 24 h; when no home window was blocked (a deliberate move while home served, or a pin set on home itself), the set time plus 24 h. The reading of "or after 24 h" as "whichever comes first" is recorded in §6.1; it loses nothing, because an expired pin hands the session to the affinity arm, which returns home only when home serves.
- **When a pin ends:** `_swap_pin_tick` ends a pin whose expiry has passed (`pin-expired <id>: pinned to <account> until <reset|24h>`), as it ends one the truth has left (D-3099).
- **A pin from before this change** (the account name alone) is given the set time plus 24 h from the first tick that reads it, and rewritten in the new form. The 17 standing pins therefore expire about a day after the release reaches each supervisor, and §3.1's stagger spaces their returns home.
- **The ceiling:** `_swap_pinned` no longer stands the affinity arm down when the pinned account fails `_avail` (a window at or above `SWAP_CEILING`, the condition the ceiling-leave itself reads). The ruling names the 5-hour ceiling; `_avail` is the predicate the ceiling-leave already uses for both windows, so the rule covers the 5-hour case and adds no third predicate. The pin itself stays; when the account recovers, it holds again until it expires.
- **What it does not change:** who mints a pin (D-3097: the operator path only); the rescue's place above the pin; the floored `pin-hold` note (D-3098); a pin ending when the session leaves the account (D-3099).
- **Off marker:** `$REG/swap-pin-expiry-off` restores today's pin (no expiry; held at the ceiling). The expiry field is still written, so switching back on needs no rewrite.

### 3.4 D3: the return home takes an ENDED window as servable, staggered per home

**The rule.**
- **Where:** `_swap_target`'s non-forced branch for a session not on home, at the home-recovered gate only. When `_class_gate home <class>` answers rc 2 **and** the cause is an ended window, the gate reads it as servable and returns home.
- **"Ended":** home's limits file carries a seven-day figure whose `sevenResetAt` has passed (a new read-only helper over `_limit_field_to`'s source, one definition). Nothing else counts: a missing file or field, a figure stale by age, and the fable share's staleness (`_serviceable`'s `stale`) keep rc 5 as today.
- **Why it is safe:** a window that has reset is, by definition, at or near 0; if the guess is wrong (home was used from elsewhere), the session hits a real limit on home, and the rescue arm evacuates it as it does any limit. This is home-affinity: the session goes where it belongs as soon as its home can serve.
- **The herd guard:** the move is an affinity move, so it passes `_swap_idle_gate`, `SWAP_JITTER` and §3.1's per-home stagger. Four sessions frozen on one home's reset second go home over about 12 minutes, one at a time.
- **What it does not change:** the forced (rescue) path, which keeps rc 5 when no candidate is servable and one is unmeasured; the stay-at-home branch (rc 5 there means "stay", which is what happens); the rescue loop's pass-1 skip of seven-ended candidates (§2.1; a separate question for the operator once D5's lines and D1's landings are measured, §5.3).
- **Off marker:** `$REG/swap-home-ended-off` restores rc 5.

### 3.5 D1: non-Anthropic lanes are overflow only

**The rule.** In `_swap_target`'s candidate loop, home-able candidates rank in two buckets: first every **Anthropic** candidate (`_is_anthropic_backend`) that is not auth-dead, lowest `_limit_score` first (unmeasured 100, as today); then every other home-able candidate (non-Anthropic lanes and auth-dead accounts), lowest score first (auth-dead 101, as today). Non-home-able candidates (`obest`) stay last. The rule is the same for both passes (class and the degraded class).

- **"With room"** is `_avail`, as the ruling's word and today's eligibility read it: a candidate that reached the ranking already passed `_pool_ok`, `_account_ok`, `_avail` and `_class_gate`. An Anthropic account with an unmeasured score ranks ahead of a GPT-backed lane. That is deliberate: the unmeasured Anthropic accounts are the idle ones (§2.1), and the alternative (only measured accounts beat a GPT-backed lane) would keep most of the magnet until D7 lands. If the guess is wrong, a second rescue follows, bounded by the chain rule (`RESCUE_CHAIN_COUNT`, 3 an hour) and the no-bounce skip (`RESCUE_CHAIN_WINDOW`).
- **What it reaches:** the rescue (`_rescue_target`, its spread and no-bounce passes included, so a burst spreads across Anthropic accounts before it overflows) and the ceiling-leave (the same loop, forced by `cur` failing).
- **The fallback when the roster cannot say:** `_is_anthropic_backend` reads `CCRC_ANTHROPIC_BACKEND`; when the array is not declared (an older roster projection), it falls back to `_is_home_able`, so every home-able lane reads as Anthropic and the ranking is today's. `ccrc doctor` already warns on that projection. No new reader.
- **What it does not change:** eligibility (a GPT-backed lane with room is still taken when no Anthropic account has room: switching is never blocked); the stamp that marks a non-Anthropic lane blocked after a rescue off it; `_limit_score`; new-session placement.
- **Off marker:** `$REG/swap-overflow-rank-off` restores one bucket.

### 3.6 D2: a session on a non-Anthropic lane moves sideways to an Anthropic account with measured room (W2)

**The rule.** In `_swap_target`'s non-forced branch for a session not on home, after the home-recovered gate fails and before "cur still works: stay put": when `cur` is not an Anthropic backend (and `CCRC_ANTHROPIC_BACKEND` is declared), choose the Anthropic home-able candidate with **measured** room and return it. Otherwise stay put, as today.

- **Measured room:** `_limit_score` is not empty (both windows known) and below `SWAP_CEILING`; and the candidate passes every gate the loop applies (`SWAP_TARGET_SKIP`, `_pool_ok` against the project's pool state, `_account_ok`, `_avail`, not auth-dead, `_class_gate` rc 0, never rc 2). Lowest score first. One shared candidate predicate with the loop, so the two cannot drift.
- **Home affinity:** `.home` is not changed. Once the session is on an Anthropic account the branch no longer applies, so it does not bounce between Anthropic accounts; when home serves again, the existing return home fires (with D3's ended-window reading and the stagger).
- **Pools:** `_pool_ok` is the boundary, unchanged; a candidate outside the project's pool is never offered; the crossing rules apply as in the loop.
- **The act:** it is an affinity move: the pin (as D4 leaves it), `.hold`, the `.woke` cooldown, `_swap_idle_gate`, `SWAP_JITTER` and §3.1's stagger (keyed on the target) all apply. Its swap-log verb is `auto-sideways`; `deploy/measure-working-state.py`'s `DECISION_VERBS` gains it.
- **The cost, stated:** an episode costs up to two restarts (sideways, then home), each at an idle turn boundary. The operator already pays both today, by hand.
- **Off marker:** `$REG/swap-sideways-off`.

### 3.7 D7: the keepalive produces a real measurement (W2)

**The rule.**
- **Occupancy:** `_ka_session_on` no longer counts a supervisor heartbeat as occupied. An account counts as occupied only when a session on it is mid-turn (its status reads busy), because only a turn renders a statusline. The live-pane-without-heartbeat answer and the fail-shut unmeasurable answer are unchanged.
- **The measurement:** a keepalive turn must end with the account's limits file advanced through the one writer, `statusline-command.sh`. Step 0 of the task measures which of three sources does this, smallest first: (a) a field of the `-p` JSON result that carries the rate-limit windows, fed to the writer; (b) the statusline command run against the turn's own output; (c) a short interactive turn on a private tmux socket (never the fleet's server) with the statusline configured, ended after the first write. A source that cannot produce `rate_limits` is not used; the census says `no-render` as today.
- **No herd:** the keepalive keeps its lock, its one-account-at-a-time pass, its per-account backoff and `CCRC_KEEPALIVE_FRESH`; no supervisor is touched; the credential handling (never in argv, never echoed) is unchanged.
- **Off switch:** the keepalive's existing pass-level switches. The occupancy change has its own off marker, `$REG/keepalive-heartbeat-occupied`, restoring the heartbeat rule.

### 3.8 D6: no revival on another account, kept

- **Kept as built:** a stopped, hibernated or failed-unit session at a limit is not revived on another account (#199; session-continuity §6). 0 cases were measured.
- **Why it stays:** revival elsewhere would need a supervisor-less actor that restarts sessions, which is the herd shape the fleet's outages came from, and a second path around hibernation's ensure-wake gate.
- **What changes for these sessions anyway:** they wake or restart on their stored account through `ensure`, as today, and their first live tick then runs the ordinary auto-swap. With D4, their pins have expired; with D3, D1 and D2, the tick now sends them home or to an Anthropic account. A limit on restart is rescued like any other.

### 3.9 Rejected

- Score symmetry in `_limit_score` (refuted, §2.1).
- Removing GPT-backed lanes from `CCRC_HOME_ABLE` (would block switching when no Anthropic account has room; Q8).
- A fleet-wide auto-swap off switch (#382): not needed by any ruling here; each change has its own marker.
- Reviving stopped or hibernated sessions elsewhere (D6).
- Letting the rescue run on a narrow pane now (decided after D5's counts).
- Restoring `lastswap` on `cmd_swap`'s pre-stop `die` paths (3 lost dispatches in 7 days; D5 makes the cooldown it causes visible; a later ticket if the lines show it matters).

## 4. Fit with the consolidation spec and the lanes

| This design | Owner (consolidation spec) | Reuses | New |
|---|---|---|---|
| D5 stand-down lines | ccd's tick, which stays bash (§5.13); the swap log is ccd's | `_tick_undecidable`'s episode shape, `_pane_narrow_note`'s floor, `_limit_dated`, `_pane_hard_blocked`, `_pane_limit_banner` | one note helper and its episode field; a re-log floor |
| D4 pin expiry | ccd's swap path (§7's pin covers its refusal set; unchanged) | D-3097 to D-3099, `_swap_pin_tick`, `_avail` | an expiry in the pin's value |
| D3 ended window | K15: `_swap_target` stays ccd's | `_class_gate`, `_serviceable`, `_limit_field_to`'s source | one read-only "window ended" helper |
| D1 overflow ranking | K15: `_swap_target`'s walk; `_limit_score` is the shared score and is not edited | `_is_anthropic_backend` (its roster fallback) | a second bucket in the loop |
| D2 sideways | K15, the same walk | the loop's gates, as one predicate | one branch in the non-forced arm; the `auto-sideways` word |
| Stagger | ccd's swap path | ccd's registry and its atomic-create idiom | one helper |
| D7 keepalive | the keepalive (a systemd timer; K11: timers stay systemd) | the writer `statusline-command.sh`, the census | the occupancy rule; the measured source |
| Off markers | K12's box markers ("readable with the server down") | the `reclaim-paused` idiom (`-e`/`-L` test) | five marker names |

- **Consolidation §7, held:** no rule adds a gate, refusal, node call or server dependency to `_auto_swap_check`, `_swap_idle_gate`, `_swap_target`, the pool grammar, the strand path, `cmd_swap`, `swap-self` or the swap routes. Each changes **which** account a non-blocked move picks, **when** a pin stands, or **what** is logged; the swap path's refusal set and `_swap_idle_gate`'s verdict table are unchanged, and each PR's characterization pins prove it.
- **K8 (the pane grammar):** D5 adds no pattern; it reuses `_pane_hard_blocked` and `_pane_limit_banner` over a wider capture. If D5's lines confirm the dialog hypothesis, the fix is a K8 corpus row plus a detection change, a later ruling.
- **K3/K4:** `_swap_idle_gate` stays out of both; D2 calls it as is. #1050 (open) adds a background-work wait to it; D2 rebases onto it when it lands.
- **Lanes:** W1 and D2 are **ccd only** (`ccd/ccd`, its tests, `deploy/measure-working-state.py`'s verb list); D7 is the keepalive script and its tests. No server, agent or PWA byte; no `FLEET_PROTO` bump; no restart or roll is added. Every release deploys agent lane first.
- **The tick budget:** the steady-state tick (no stand-down, no move) gains no fork in any wave; `ccd-tick-budget.test.ts` holds it.

## 5. Waves

Every PR lands its characterization pins of today's swap decisions first, keeps the behaviour change in its own commit, carries its off marker where it changes a decision, and rolls back by revert.

### 5.1 W1: observe, then unfreeze, then re-rank (four PRs, in this order)

1. **D5, stand-down logging.** Smallest and safest: no decision changes. It goes first so every later change is observable, and so the operator's narrow-pane decision rests on counts.
2. **D4, pin expiry and the ceiling.** Local to the pin. Lands the §3.1 stagger, which D4 needs first (the 17 standing pins expire within a day of each other).
3. **D3, the ended window.** One gate, one helper, reusing the stagger.
4. **D1, overflow ranking.** The widest change (every rescue and ceiling-leave), last, with D5's `lane=` word already counting its baseline.

### 5.2 W2: move and measure

5. **D2, the sideways move.** After D1, so a sideways move and a rescue rank Anthropic accounts the same way; after #1050 if it is open.
6. **D7, the keepalive's measurement.** Independent of D2's files. It makes D2's "measured room" and D3's home figure available more often, so it may land first if ready.

### 5.3 After W2: the operator's next questions (not ruled here)

- The narrow-pane gate (D5's second half), from D5's `unmeasurable` lines with evidence.
- The rescue loop's pass-1 skip of seven-ended candidates (§2.1), from D1's landings and D5's lines.
- The rate-limit dialog (§2.5), from `banner-outside-tail` counts; a detection change is a K8 row.

### 5.4 Sequencing at a glance

```
D5 ─▶ D4 (+ stagger) ─▶ D3 ─▶ D1 ─▶ D2
                                      ▲
                               #1050 merged (or line-disjoint)
D7 (independent; any time after D5)
OA: swap-log baseline before D5; a reading after each deploy
```

## 6. Operator decisions

All seven were ruled on 2026-10-21; each took its recommended option. The options are kept as asked, so the trade-off each ruling accepted stays on the record.

**D1. The role of non-Anthropic lanes in rescue and ceiling-leave ranking.** *Decided: (A).*
- (A) **Recommended.** Overflow only: rank them after every Anthropic home-able account with room. Trade-off: a rescue can land on an Anthropic account whose unmeasured 5-hour figure is near its ceiling; the chain rule bounds the second rescue.
- (B) Keep equal ranking and fix only the telemetry bias. Refuted as ineffective (§2.1).

**D2. A sideways move while home is blocked.** *Decided: (A).*
- (A) **Recommended.** A session on a non-Anthropic lane whose home is unavailable moves, at the idle gate, to an Anthropic account with measured room; `home` unchanged so the return home still fires. Trade-off: up to two restarts per episode.
- (B) Return home only (today).

**D3. An unknown class window on home after a reset.** *Decided: (A).*
- (A) **Recommended.** Treat an ended window as servable for the non-forced return home; the rescue evacuates if it is really blocked; staggered per home account. Trade-off: a wrong guess costs one rescue.
- (B) Keep it undecidable but bound the freeze (for example go home after 30 minutes unmeasured).

**D4. Manual-swap pin lifetime.** *Decided: (A).*
- (A) **Recommended.** The pin expires at the next reset of the home window that was blocked when it was set (or after 24 h), and never holds a session on an account at its 5-hour ceiling. Trade-off: an operator who wants a session kept off home for longer pins it again.
- (B) Keep it until the next automatic swap (today).

**D5. The narrow-pane gate and the rescue.** *Decided: log first, decide after.*
- Log every silent stand-down, cooldown and undecidable episode (one line per episode, a re-log floor) first; decide whether the rescue may run on a narrow pane after the lines show whether narrow panes overlap real limits.

**D6. Revival on another account for stopped, hibernated or failed-unit sessions.** *Decided: (A).*
- (A) **Recommended.** Keep the no-revival ruling (#199); 0 cases were measured.
- (B) Revive on an account with room, which needs an ensure-wake-gated, non-herd design.

**D7. The keepalive's measurement source.** *Decided: (A) pending feasibility, and the occupancy rule.*
- (A) **Recommended.** The keepalive must produce a real usage measurement (serialised, no herd), and an idle-session heartbeat is never counted as "occupied". Step 0 picks the source (§3.7).
- (B) A usage source that does not depend on a statusline.

### 6.1 Decision log

**2026-10-21, the operator's ruling.** Asked "Auto-switch fix: accept the recommended decisions D1–D7?", the operator answered, verbatim:

> "Accept all recommended (Recommended)"

| Decision | Status | Option chosen | What it binds |
|---|---|---|---|
| D1 | decided 2026-10-21 | (A) non-Anthropic lanes rank after every Anthropic home-able account with room | W1, D-6183 |
| D2 | decided 2026-10-21 | (A) sideways at the idle gate to an Anthropic account with measured room; `home` unchanged | W2, D-6184 |
| D3 | decided 2026-10-21 | (A) an ended window is servable for the non-forced return home; staggered per home account | W1, D-6182 |
| D4 | decided 2026-10-21 | (A) a pin expires at the blocked home window's next reset or after 24 h, and never holds at the ceiling | W1, D-6181 |
| D5 | decided 2026-10-21 | log first (one line per episode, a re-log floor), decide the narrow-pane gate after | W1, D-6180; the gate later |
| D6 | decided 2026-10-21 | (A) no revival on another account (#199) | nothing to build; §3.8 |
| D7 | decided 2026-10-21 | (A) a real measurement, serialised; a heartbeat is never "occupied" | W2, D-6185 |

**Readings this design records** (each is the plan's to apply, and the operator's to overturn):
- D4's "(or after 24 h)" is read as "whichever comes first" (§3.3).
- D4's "at its 5-hour ceiling" is applied through `_avail`, the ceiling-leave's own predicate, which covers both windows (§3.3).
- D1's "with room" is `_avail`, so an unmeasured Anthropic account counts (§3.5); D2's "measured room" is both windows known and below the ceiling (§3.6).
- The ruling's first wave is "D5 + D4 + D3 + D1, each its own PR, red-first, switching never blocked"; §5.1 orders them smallest and safest first.

## 7. Risks and rollback

| Risk | Guard | Rollback without a deploy | Rollback |
|---|---|---|---|
| A log flood from D5 | one line per episode; the floor; only with limit evidence; no line on the steady-state tick | — (lines only) | revert D5 |
| D5 slows the tick | the evidence probe runs only on a silent exit, once per floor per session; the tick-budget fixtures | — | revert D5 |
| A return-home herd at a reset second or a pin-expiry wave | §3.1's per-account stagger (180 s, exclusive create), `_swap_idle_gate`, `SWAP_JITTER` | `swap-home-ended-off`, `swap-pin-expiry-off` | revert D3 / D4 |
| D3 sends a session home to a real limit | the rescue arm evacuates on detection; the chain rule | `swap-home-ended-off` | revert D3 |
| D1 lands a rescue on an Anthropic account near its 5-hour ceiling | `RESCUE_CHAIN_COUNT`, the no-bounce skip, the spread rule | `swap-overflow-rank-off` | revert D1 |
| D1 misreads a GPT-backed lane as Anthropic | `_is_anthropic_backend` reads the roster projection; an older projection falls back to today's ranking, and `ccrc doctor` warns | — | — |
| D2 bounces a session | the branch applies only on a non-Anthropic `cur`; once on an Anthropic account it never fires again; measured room only; the stagger | `swap-sideways-off` | revert D2 |
| D2 crosses a pool | `_pool_ok` and the crossing rules, one shared predicate with the loop | `swap-sideways-off` | revert D2 |
| D4 drops an operator's deliberate choice too soon | expiry at the blocked window's reset; the session then returns home only when home serves; the operator can pin again | `swap-pin-expiry-off` | revert D4 |
| D7 spends more per account | the keepalive's lock, backoff, `CCRC_KEEPALIVE_FRESH`, one account at a time; only idle accounts are turned | the keepalive's pass switches; `keepalive-heartbeat-occupied` | revert D7 |
| Any change blocks a switch | none adds a refusal, a wait on a rescue, or a gate on `cmd_swap`; the characterization pins over the swap path's refusal set and `_swap_idle_gate`'s verdict table | the markers | revert |

**Markers.** Each off marker is an empty file in the registry directory, read by ccd with the `-e`/`-L` test the `reclaim-paused` reads use, on the tick, with the server down. Writing or removing one is an operator act on the box (the ccrc SAFETY rules forbid it to sessions). With no marker, the ruled behaviour is on.

**Bound rulings, kept:** account switching and the auto-swap are never blocked; no herd restarts or herd wakes; home-account affinity; pools are the spend and eligibility boundary; hibernation's ensure-wake gate; no revival elsewhere (#199); improve what exists first (every rule edits a named function in place).

## 8. Measures of success

Measured on the box before W1 and after each PR's deploy, with the same queries as §1.1 (the plan's operator acts):

| Measure | Baseline (7 days to 2026-10-20) | Target after W1 | Target after W2 |
|---|---|---|---|
| Manual swaps a week (a `swap` line with no `dispatch` before it) | 15, plus 3 unattributed | ≤ 6 | ≤ 3 |
| Of those, corrections off a non-Anthropic lane | 8 | ≤ 2 | 0 |
| Automatic moves landing on a non-Anthropic lane (`lane=overflow`) | 30 of 52 | only when no Anthropic account had room | same |
| Sessions parked on a non-Anthropic lane, and for how long (live, supervised) | parks of 1.9 h to 4.4 days | none longer than one weekly block of home | none longer than one idle turn boundary after an Anthropic account has measured room |
| `classwindow` undecidable episodes on a return home | 25 lines; parks of about 10 h and 24 h | ≤ 1 per home reset, ended within the stagger | same |
| Pins standing; `pin-hold` lines a week | 17; about 1,290 | pins ≤ the week's manual swaps; none older than 24 h; none held at the ceiling | same |
| Limit events with no action and no line | 2 of about 18 | 0 without a `stand-down` line | 0 |
| Stand-down lines by reason (incl. `unmeasurable` with evidence, `banner-outside-tail`) | unlogged | counted | counted; the narrow-pane gate decided |
| Keepalive `refreshed` outcomes | 0 | — | ≥ 1 per idle account per `CCRC_KEEPALIVE_FRESH` |
| Limits files older than a day | about half | — | none for an enabled account |
| Rescues per session per hour above the chain count | measured by the continuity script's stage 4 | no increase | no increase |

## Review log

**rev 0 (2026-10-21).** Written from the three inventories, the synthesis and the adversarial verification, after the operator's ruling; every symbol re-measured on `d8cd47658`.
