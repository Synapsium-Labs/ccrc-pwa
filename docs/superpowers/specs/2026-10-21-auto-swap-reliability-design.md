# Auto-swap reliability (design)

**Status:** rev 1 (2026-10-21; rev 0 plus three read-only reviews, each finding and its outcome in the plan's Review log). Written after a read-only investigation and the operator's ruling of the same day, which accepted every recommended decision D1 to D7 (§6, the decision log). It defines no D-numbers; the W1/W2 plan (`docs/superpowers/plans/2026-10-21-auto-swap-reliability-w1-w2.md`) defines D-6180 to D-6185.

**The request (operator, 2026-10-20, verbatim):**

> "for accuount autoswich, if an workspace stops working due to acount lmits, it should atomatically switch to a different account. currently this is not reliably happening and workspaces wdo not resurrect with a new account automatically - switch is often manual in practice"

**The operator's ruling (2026-10-21, verbatim),** the answer to "Auto-switch fix: accept the recommended decisions D1–D7?":

> "Accept all recommended (Recommended)"

- **Citations** are to `origin/main` `d8cd47658` (session continuity wave 4b, #435, merged 2026-10-21); #1038, merged after it (`27755979e`), touches only `_plat_timeout` in `ccd/ccd`, so every citation holds there. They name a function, constant or file in `ccd/ccd` or `ccd/ccd-telemetry-keepalive`; this document cites no line numbers. The investigation read `41a08beb0`; every symbol below was re-measured on `d8cd47658`.
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
- **Nothing is blocked.** Every change orders, logs or ends a stand-down; none adds a refusal to the swap path, delays a rescue or a ceiling-leave, or touches `_swap_idle_gate`'s verdict table. The only new waits (§3.1) space non-forced moves while the session's account still serves, and fail open. Each change that alters a swap decision has its own off marker in the registry, read by ccd with the server down (§7).
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
- **Bursts leak.** The rescue's spread rule (`RESCUE_SPREAD_WINDOW`, 600 s) pushes later rescues in a burst off targets that earlier rescues took: `_rescue_target`'s spread pass re-calls `_swap_target` with the recent targets in `SWAP_TARGET_SKIP` and takes any rc 0 answer. Once the Anthropic accounts with room are all recent, the next-best target is a GPT-backed lane, whatever the ranking. In one burst of 7 rescues from one account, 3 went to a GPT-backed lane [M].

### 2.2 Cause 2: the return home freezes on an ended window

- **Where:** `_swap_target`, the non-forced branch for a session not on home. `_avail home` passes (an unknown figure counts as free). `_class_gate home <class>` → `_serviceable` → `_limit_field_to … seven` is "" because `sevenResetAt` has passed → `no-figure`, rc 2 → `[[ -n $force ]] || return 5`.
- **Then:** `_auto_swap_check` maps rc 5 to `_tick_undecidable classwindow`, which logs **once per episode** (`.tickstuck` compares the field word) and returns. No move and no further line follow until home is measured.
- **The deadlock:** home is measured only by a statusline render on home, and the parked session is the one that would render it. The keepalive does not (§2.7).
- **Measured:** the freeze lines sit on the exact reset second of the session's home (for example one session at 11:00:00 on its home's weekly reset, parked 9 h 52 m until a manual move home; another parked about 24 h and returned automatically 7 s after the operator moved a different session onto the same home) [M]. Three more re-froze off the hour **after** the operator moved them sideways, because their home was still unmeasured [M].
- **The herd hazard in any fix:** freezes cluster on one home's reset second (four sessions within 8 s on one boundary [M]). "Go home when the window ended" alone would dispatch all of them onto one account inside `SWAP_JITTER`: a small restart herd (SessionStart hooks; the 2026-08-14 usage-scan herd is the precedent).

### 2.3 Cause 3: no sideways move while home stays blocked

- **Where:** `_swap_target`'s same branch. When home fails `_avail` (a weekly block reads 99) and `_avail cur` plus `_class_gate cur` pass, it returns 0 with no output: stay put. The candidate loop runs only when forced or when `cur` fails.
- **Measured:** 4 of the 8 manual corrections moved a session off a GPT-backed lane to another Anthropic account while home sat at 99% weekly; one of those Anthropic accounts read five 42 and seven 32 at the time of the investigation [M]; its figure at the rescue is not recorded [open].
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
| `_pane_measurable` (the tick's narrow-pane return; `HARD_BLOCK_NO=unmeasurable` is not reachable from the tick, which returns first) | no verdict on a narrow pane | floored at 30 min by `_pane_narrow_note`, with no evidence |
| `HARD_BLOCK_NO=carried-in` | a banner older than this process and the last swap | no |
| `HARD_BLOCK_NO=running` / `stalepress` | mid-turn, or a stale press within its grace | no |
| `HARD_BLOCK_NO=negative` | the cached transcript verdict says no; a carried-in transcript row also caches as `negative` | no |
| `HARD_BLOCK_NO=draft` | `_pane_box_has_content` sees text in the input box | no |
| the shared `_avail "$target" \|\| return 0` (rescue and affinity, before the `hard_blocked` split) | a target chosen, then dropped | no |
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
- **Why it skips them, as written:** the script's header refuses "a turn on an account a registered session is sitting on — two `claude` processes under one CLAUDE_CONFIG_DIR is a hazard this script will not take", and `_ka_session_on`'s rationale says the heartbeat half also covers `restarting` (a dead pane whose supervisor is about to respawn `claude`). The skip is a deliberate safety rule, not an oversight; any change to it must answer that hazard (§3.7).
- **And a `-p` turn carries no figures today:** `--output-format json` returns only the final result object, and this repo's account-health work records that the read-only usage endpoint answers 403 for setup tokens. Whether a streamed `-p` turn carries both windows is not measured [open].
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

### 3.1 The affinity guards, shared by D4, D3 and D2: a per-account and a fleet-wide stagger, and the draft

A non-forced move that brings sessions back at once is the only new herd risk in this design (§2.2), and the new moves land on idle sessions, where a half-typed message is most likely. The guards apply to one class of move only.

- **Which moves:** a non-forced move while `cur` still serves: the return home (D4's pin-expiry release, D3's ended window, today's return), and the sideways move (D2). In ccd's words, `cur_serves` holds: `_avail` passes on `cur`, `_class_gate` on `cur` answers rc 0, the move is not `auto-pool`, and the session is not hard-blocked. **Never a rescue, never a ceiling-leave**: a session whose `cur` fails `_avail` pays overage on every turn while it waits, so a leave is never delayed (switching is never blocked).
- **The per-account slot:** such a move onto a given account is taken only when no other such move onto that account was granted in the last `HOME_RETURN_SPACING` seconds (180 s, above `SWAP_JITTER`'s 120 s, so two moves onto one account never run inside one jitter window). The slot is one file per target holding the last grant's epoch, read and written under ccd's existing `flock` primitive; the test is `now − last ≥ HOME_RETURN_SPACING`, a sliding rule, so no two grants are ever closer than the spacing.
- **The fleet-wide slot:** beside it, one fleet-wide file under the same lock, `AFFINITY_FLEET_SPACING` (30 s: at most two such dispatches a minute across the fleet), taken only after the per-account slot is won. It bounds the cross-account burst: a deploy that makes every frozen or parked session eligible at once, legacy pins expiring together, or a keepalive pass that measures several homes in one minute.
- **The draft:** after `_swap_idle_gate` passes, such a move stands down when `_pane_box_has_content` sees text in the input box (one `capture-pane -e`, on the dispatch path only). `_swap_idle_gate`'s verdict table is unchanged (consolidation §7). A draft typed during the jitter, at the act, is an operator question that goes with #1050's change to the idle gate (§5.3).
- **Atomic across supervisors, and fail open:** each session has its own supervisor process, so the slots are taken under the lock. A tick that loses writes D5's floored `stand-down stagger` and tries again later; the session stays on a working account meanwhile. If the lock or the write fails with anything other than "held" (a full volume, a missing directory), the move is taken and one floored `stand-down stagger-unwritable` line is written: a broken slot never freezes the return home.
- **What it never does:** delay or refuse a rescue or a ceiling-leave (neither reads the slots), refuse a manual swap, or touch `cmd_swap`. It orders automatic arrivals; it blocks no switch.
- **Bound:** N waiting moves leave over at least N × `AFFINITY_FLEET_SPACING` fleet-wide, and over at least N × `HOME_RETURN_SPACING` onto one account (four sessions on one home: 12 minutes), each through the idle gate as today.
- **Off marker:** `$REG/swap-stagger-off` restores today's undelayed dispatch (both slots and the draft stand-down).

### 3.2 D5: log every silent stand-down (first)

**The rule.** Each site in §2.5's table, except `negative`, writes **one swap-log line per episode**, re-logged at a floor, when its trigger holds; nothing else changes.

- **One line form:** `stand-down <id>: <reason> [evidence=<pane|banner|transcript|carried-in|none>] [banner-outside-tail=<yes|no>]`, with the reason one of `cooldown`, `swapblocked`, `carried-in`, `running`, `stalepress`, `draft`, `target-unavailable`, `hold`, `woke`, `idle-gate`, `stagger`, `stagger-unwritable`. `negative` is not logged: it carries no limit evidence, and its carried-in case is relabelled `carried-in` (below). The narrow pane keeps its own line, `_pane_narrow_note`, which gains the `evidence=` word.
- **Two triggers, by arm.** Limit-arm sites (the two cooldowns, the `HARD_BLOCK_NO` words, `target-unavailable` when `hard_blocked` is set) log only with evidence other than `none`; at the cooldown and `swapblocked` sites only `transcript` counts. Affinity-arm sites (`.hold`, `.woke`, the idle gate, the stagger, `target-unavailable` on the affinity path) log only when ccd had a target other than `cur`, the condition `pin-hold` uses; evidence is not asked.
- **The episode:** keyed on the reason word in a registry field `standdown` (`<epoch> <reason>`). It is **not** cleared by `_tick_decided`, which runs on the very cooldown and policy returns that write these lines. It ends when the reason word changes or when a tick reaches `_dispatch_swap`; it is re-logged once older than the floor. `.tickstuck` keeps `_tick_decided`. The steady-state tick writes nothing.
- **Evidence, cheaply:** on a limit-arm silent exit only (never on the steady-state tick, never on `running`, which has its own answer), ccd asks the transcript reader `_limit_read` (cached by the transcript's date, and writing no `carried-in` note, unlike `_limit_dated`) whether the newest real row is a limit row of this process (`transcript`), an older one (`carried-in`) or neither (`none`). The answer, `none` included, is cached in its own field `standdownprobe` (`<epoch> <answer>`) for `TRANSCRIPT_ARM_INTERVAL`, so a limit that arrives five minutes into a cooldown is logged within 30 s, and the probe runs at most once per interval per session. Only the log line is floored.
- **The dialog hypothesis:** on the same path, once per episode, `banner-outside-tail` says whether `_pane_hard_blocked` or `_pane_limit_banner` match the **whole** visible pane while they did not match its `tail -8`. The tick keeps no whole-pane capture (its read is `capture-pane … | tail -8` in one pipeline), so this is the draft check's `-p -e` capture where `_session_hard_blocked` already made it, otherwise one extra `capture-pane -p` on this floored path only, counted in the budget (§4). That answers §2.5's fingerprint directly.
- **The transcript cache:** a fresh scan that finds a carried-in row (`_limit_dated` rc 3) records `carried-in` as the stand-down reason instead of `negative`; the cached verdict's value (0) and its reuse are unchanged. `cmd_swap`'s act-time rescue gate already handles `negative|carried-in` in one arm, so the cancel and its restore are unchanged; only the `rescue-cancel` line's word changes.
- **`tick-undecidable` gains a re-log floor:** the same field is logged again once the episode is older than the floor, with its age, so a frozen session stays visible in the swap log and the PWA's swap history.
- **The decision lines gain one word:** `auto-rescue` and `auto-home` lines end with `lane=anthropic|other` (`anthropic` when `_is_anthropic_backend` holds for the target, `other` otherwise; "other" is not `_swap_target`'s non-home-able "overflow" bracket), so §8 counts landings without re-deriving the roster. The measurement scripts' `auto-rescue` pattern already accepts a suffix.
- **Floors:** `COMPACT_NOTE_FLOOR` (1800 s) for the lines, `TRANSCRIPT_ARM_INTERVAL` (30 s) for the probe, by reference, never a second literal.
- **What it does not change:** no decision. It is not behind a marker: switching it off would only hide lines. The steady-state tick gains no fork (the tick-diet budget fixtures pin it); the `busy`, `cooldown` and `narrow` fixtures, which are these silent exits, gain at most one probe per `TRANSCRIPT_ARM_INTERVAL`, and each PR names their measured delta.
- **Then:** the narrow-pane gate (`_pane_measurable` suppressing the rescue) is decided by the operator only after a measured period of these lines (§6, D5's second half). Nothing here changes it.

### 3.3 D4: a manual pin expires, and never holds a session at the ceiling

**The rule.**
- **What `cmd_swap` records:** on the operator path, the pin `$REG/<id>.swappin` stays **byte-identical** (the account name alone), and a separate registry field `swappinexp` records its expiry as `<epoch> <reset|ttl>`: the next reset of the home window that was blocked when the pin was set (the later raw `ResetAt` of the home windows at or above `SWAP_CEILING`, read by a raw reset reader over `_limit_field_to`'s source, since `_limit_field_to` blanks a passed reset), bounded by the set time plus 24 h; when no home window was blocked (a deliberate move while home served, or a pin set on home itself), the set time plus 24 h. Keeping the pin's value means every older reader (`_swap_pinned` and `_swap_pin_tick` compare the whole value), a supervisor still on the older code during a deploy, and a revert all keep holding new pins; a revert leaves only a stray field. The reading of "or after 24 h" as "whichever comes first" is recorded in §6.1; it loses nothing, because an expired pin hands the session to the affinity arm, which returns home only when home serves.
- **When a pin ends:** `_swap_pin_tick` ends a pin whose expiry has passed (`pin-expired <id>: pinned to <account> until <reset|ttl>`), as it ends one the truth has left (D-3099). Every site that removes the pin removes `swappinexp` with it: `_swap_pin_tick`, `cmd_swap`'s automatic-path clear, and `cmd_prefer`'s "an explicit home supersedes a pin" clear.
- **A pin from before this change** (no `swappinexp`) is given an expiry on the first tick that reads it: that time plus 24 h plus an offset from 0 to 24 h derived deterministically from the session id (a hash computed in bash). The deploy sweep restarts every supervisor on one tick, so without the offset all 17 standing pins would expire on one tick a day later, onto many homes at once; with it their releases spread over a further day, and §3.1's fleet-wide slot spaces any that still meet.
- **The ceiling:** `_swap_pinned` no longer stands the affinity arm down when the pinned account fails `_avail` (a window at or above `SWAP_CEILING`, the condition the ceiling-leave itself reads). The ruling names the 5-hour ceiling; `_avail` is the predicate the ceiling-leave already uses for both windows, so the rule covers the 5-hour case and adds no third predicate. The ceiling-leave then runs; landing elsewhere ends the pin (D-3097's automatic clear); if no account can take the session, the pin holds again once its account recovers, until it expires.
- **What it does not change:** who mints a pin (D-3097: the operator path only); the rescue's place above the pin; the floored `pin-hold` note (D-3098); a pin ending when the session leaves the account (D-3099).
- **Off marker:** `$REG/swap-pin-expiry-off` restores today's pin (no expiry; held at the ceiling) by ignoring `swappinexp`. The field is still written, so switching back on needs no rewrite.

### 3.4 D3: the return home takes an ENDED window as servable, staggered per home

**The rule.**
- **Where:** `_swap_target`'s non-forced branch for a session not on home, at the home-recovered gate only. When `_class_gate home <class>` answers rc 2 **and** the cause is an ended window, the gate reads it as servable and returns home.
- **"Ended":** home's limits file carries a seven-day figure whose `sevenResetAt` has passed (a read-only helper built on D4's raw reset reader, one definition). Nothing else counts: a missing file or field, a figure stale by age, and the fable share's staleness (`_serviceable`'s `stale`) keep rc 5 as today.
- **Why it is safe:** a window that has reset is, by definition, at or near 0; if the guess is wrong (home was used from elsewhere), the session hits a real limit on home, and the rescue arm evacuates it as it does any limit. This is home-affinity: the session goes where it belongs as soon as its home can serve.
- **No ping-pong:** the ended reading applies only when home is not in the session's no-bounce list (`_rescue_history`'s `RESCUE_SKIP_LEFT`: accounts it left blocked within `RESCUE_CHAIN_WINDOW`). A home whose file still reads "ended" after the session hit a real limit there (a limit that wrote no statusline row, a spend limit, use from outside the fleet) keeps rc 5, today's answer, until the window passes; without this the session would bounce home and back every `SWAP_COOLDOWN`. One record, reused.
- **The herd guard:** the move is a return home while `cur` serves, so it passes `_swap_idle_gate`, `SWAP_JITTER` and §3.1's guards. Four sessions frozen on one home's reset second go home over about 12 minutes, one at a time.
- **What it does not change:** the forced (rescue) path, which keeps rc 5 when no candidate is servable and one is unmeasured; the stay-at-home branch (rc 5 there means "stay", which is what happens). The rescue loop's pass-1 skip of seven-ended candidates is D1's (§3.5), not D3's.
- **Off marker:** `$REG/swap-home-ended-off` restores rc 5.

### 3.5 D1: non-Anthropic lanes are overflow only

**The rule.** In `_swap_target`'s candidate loop, home-able candidates rank in two buckets: first every **Anthropic** candidate (`_is_anthropic_backend`) that is not auth-dead, lowest `_limit_score` first (unmeasured 100, as today); then every other home-able candidate (non-Anthropic lanes and auth-dead accounts), lowest score first (auth-dead 101, as today). Non-home-able candidates (`obest`) stay last. The rule is the same for both passes (class and the degraded class).

- **"With room"** is `_avail`, as the ruling's word and today's eligibility read it: a candidate that reached the ranking already passed `_pool_ok`, `_account_ok`, `_avail` and `_class_gate`. An Anthropic account with an unmeasured score ranks ahead of a GPT-backed lane. That is deliberate: the unmeasured Anthropic accounts are the idle ones (§2.1), and the alternative (only measured accounts beat a GPT-backed lane) would keep most of the magnet until D7 lands. If the guess is wrong on a rescue, a second rescue follows, bounded by the chain rule (`RESCUE_CHAIN_COUNT`, 3 an hour) and the no-bounce skip (`RESCUE_CHAIN_WINDOW`). The ceiling-leave has its own bound, not the chain rule: one hop per `SWAP_COOLDOWN`, each landing then measured by the session itself.
- **Pass 1's seven-ended skip, within the same reading.** For a class-tagged session (75 of 77), pass 1 skips a candidate whose class gate answers rc 2 (§2.1), so an idle Anthropic account whose seven-day window has ended would never count as having room while a GPT-backed lane with a measured seven passes. Such an account passes `_avail`, so under the reading above it has room: in pass 1 an **Anthropic** candidate whose rc 2 comes from an ended seven-day window (D3's helper), for a non-`fable` class, is ranked in the Anthropic bucket at score 100 instead of skipped. Every other rc 2 (a missing file, a stale figure, a fable share) still skips. It is recorded in §6.1 for the operator to overturn; the same marker restores the skip.
- **Bursts:** `_rescue_target`'s spread pass takes its answer only when `_is_anthropic_backend` holds for it, or when the unspread answer is itself not Anthropic; otherwise it falls through to the unspread answer. A burst then reuses an Anthropic account with room before it overflows, rather than preferring a GPT-backed lane over a recently taken Anthropic account.
- **What it reaches:** the rescue (`_rescue_target`, its spread and no-bounce passes included) and the ceiling-leave (the same loop, forced by `cur` failing).
- **The fallback when the roster cannot say:** `_is_anthropic_backend` reads `CCRC_ANTHROPIC_BACKEND`; when the array is not declared (an older roster projection), it falls back to `_is_home_able`, so every home-able lane reads as Anthropic and the ranking is today's. `ccrc doctor` already warns on that projection. No new reader.
- **What it does not change:** eligibility (a GPT-backed lane with room is still taken when no Anthropic account has room: switching is never blocked); the stamp that marks a non-Anthropic lane blocked after a rescue off it; `_limit_score`; new-session placement.
- **Off marker:** `$REG/swap-overflow-rank-off` restores one bucket, pass 1's skip and the spread pass's first answer.

### 3.6 D2: a session on a non-Anthropic lane moves sideways to an Anthropic account with measured room (W2)

**The rule.** In `_swap_target`'s non-forced branch for a session not on home, after the home-recovered gate fails and before "cur still works: stay put": when `cur` is not an Anthropic backend (and `CCRC_ANTHROPIC_BACKEND` is declared), choose the Anthropic home-able candidate with **measured** room and return it. Otherwise stay put, as today.

- **Measured room:** `_limit_score` is not empty (both windows known) and at most `SIDEWAYS_MAX_SCORE` (80: it leaves at least `SWAP_CEILING` − 80 points before a ceiling-leave would undo the move; a candidate at 95 would cross 98 within a turn or two and cost two restarts for no lasting room); and the candidate passes every gate the loop applies (`SWAP_TARGET_SKIP`, `_pool_ok` against the project's pool state, `_account_ok`, `_avail`, not auth-dead, `_class_gate` rc 0, never rc 2). Lowest score first. One shared candidate predicate with the loop, so the two cannot drift.
- **Home affinity:** `.home` is not changed. Once the session is on an Anthropic account the branch no longer applies, so it does not bounce between Anthropic accounts; when home serves again, the existing return home fires (with D3's ended-window reading and the stagger).
- **Pools:** `_pool_ok` is the boundary, unchanged; a candidate outside the project's pool is never offered; the crossing rules apply as in the loop.
- **Telling it apart:** `_swap_target`'s new branch answers rc 7 ("a name, sideways"), which `_rescue_target` passes through and `_auto_swap_check` maps to rc 0 with the verb `auto-sideways`, before its undecidable branch, as it maps rc 6. A ceiling-leave or pool leave to a non-home account keeps `auto-home`/`auto-pool`: a flag set inside `_swap_target` could not tell them apart, because the tick reads its answer through a command substitution.
- **The act:** it is an affinity move: the pin (as D4 leaves it), `.hold`, the `.woke` cooldown, `_swap_idle_gate`, `SWAP_JITTER` and §3.1's guards (keyed on the target) all apply. The dispatch keeps `CCD_SWAP_ARM=affinity`, so the act-time re-check in `cmd_swap` (D-5240: `_swap_idle_gate` again after the jitter, a requeue if busy) applies unchanged; its cause rides a separate dispatch word, `CCD_SWAP_WHY=sideways`, read only by `_swap_end_cause` (`swap-auto-sideways`) and `_resume_prompt_for`. No new `CCD_SWAP_ARM` value exists. Its swap-log verb is `auto-sideways`; `deploy/measure-working-state.py` gains it in `DECISION_VERBS` and a `sideways` kind, and `shared/api.ts`'s end-cause map gains one additive word, `swap-auto-sideways` (server lane, deployed after the agent lane).
- **The cost, stated:** an episode costs up to two restarts (sideways, then home), each at an idle turn boundary. The operator already pays both today, by hand.
- **Off marker:** `$REG/swap-sideways-off`.

### 3.7 D7: the keepalive produces a real measurement (W2)

**The rule.**
- **The measurement comes first.** A keepalive turn must end with the account's limits file advanced through the one writer, `statusline-command.sh`, which needs `rate_limits.five_hour` and `rate_limits.seven_day` (utilisation and reset) as input. One operator-measured yes/no decides the source: on one idle setup-token lane, does `-p --output-format stream-json --verbose` emit a rate-limit event carrying utilisation and a reset epoch for **both** windows? If yes, the keepalive builds `{"rate_limits":{"five_hour":{…},"seven_day":{…}}}` from that event and pipes it to `statusline-command.sh` under the account's `CLAUDE_CONFIG_DIR` (still one writer). If no, D7's measurement is parked under a departure, and a short interactive turn (a full Claude Code start per account: hooks, onboarding and trust prompts) goes back to the operator as its own design question. Running the statusline command against a `-p` turn's output is not a source (that output has no `rate_limits`), and the read-only usage endpoint is ruled out (403 for setup tokens, §2.7).
- **Occupancy, and the one-config-dir hazard.** The keepalive refuses a second `claude` under one `CLAUDE_CONFIG_DIR` (§2.7). D7's "a heartbeat is never occupied" meets that refusal, so the rule is: an account is occupied iff some session on it is mid-turn (a parity copy of `_ws_status`'s busy reading, pinned by the freshness-parity suite), or its pane is dead while its heartbeat is fresh (`restarting`: `claude` is about to respawn), or liveness is unmeasurable (fail shut). A live idle pane, supervised or not, reads clear **only** after the task's Step 0 has measured that a turn beside an idle interactive session under one config dir is safe (credential refresh and rotation on setup-token lanes; the shared config and history files; how many fleet sessions already share a config dir), the operator has confirmed it, and the keepalive's header rule is amended in the same commit. Until then every live pane stays occupied, as today.
- **They land together or not at all.** The occupancy change adds turns; without a source that yields `rate_limits` those turns would end `no-render`, spend with no measurement. So neither behaviour commit lands without the other.
- **No herd:** the keepalive keeps its lock, its one-account-at-a-time pass, its per-account backoff and `CCRC_KEEPALIVE_FRESH`; no supervisor is touched; the credential handling (never in argv, never echoed) is unchanged. A pass that measures several homes in one minute makes their sessions eligible together; §3.1's fleet-wide slot spaces them.
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
| D4 pin expiry | ccd's swap path (§7's pin covers its refusal set; unchanged) | D-3097 to D-3099, `_swap_pin_tick`, `_avail`, `_limit_pick_to` | a `swappinexp` field beside an unchanged pin; one raw reset reader |
| D3 ended window | K15: `_swap_target` stays ccd's | `_class_gate`, `_serviceable`, D4's raw reset reader, `_rescue_history` | one read-only "window ended" helper |
| D1 overflow ranking | K15: `_swap_target`'s walk; `_limit_score` is the shared score and is not edited | `_is_anthropic_backend` (its roster fallback), D3's helper | a second bucket in the loop; the spread pass's Anthropic preference |
| D2 sideways | K15, the same walk | the loop's gates, as one predicate | one branch in the non-forced arm (rc 7); `auto-sideways`; `CCD_SWAP_WHY` |
| Affinity guards | ccd's swap path | ccd's registry, its `flock` primitive, `_pane_box_has_content` | one helper, two slots, the draft stand-down |
| D7 keepalive | the keepalive (a systemd timer; K11: timers stay systemd) | the writer `statusline-command.sh`, the census | the occupancy rule; the measured source |
| Off markers | K12's box markers ("readable with the server down") | the `reclaim-paused` idiom (`-e`/`-L` test) | six marker names |

- **Consolidation §7, held:** no rule adds a refusal, node call or server dependency to `_auto_swap_check`, `_swap_idle_gate`, `_swap_target`, the pool grammar, the strand path, `cmd_swap`, `swap-self` or the swap routes, and no rule adds a gate to the rescue or the ceiling-leave. The only new waits are §3.1's affinity guards, which order non-forced moves while `cur` still serves, have their own off marker, and fail open. Each rule changes **which** account a non-blocked move picks, **when** a pin stands or a return is taken, or **what** is logged; the swap path's refusal set and `_swap_idle_gate`'s verdict table are unchanged, and each PR's characterization pins prove it.
- **K8 (the pane grammar):** D5 adds no pattern; it reuses `_pane_hard_blocked` and `_pane_limit_banner` over a wider capture. If D5's lines confirm the dialog hypothesis, the fix is a K8 corpus row plus a detection change, a later ruling.
- **K3/K4:** `_swap_idle_gate` stays out of both; D2 calls it as is. #1050 (open) adds a background-work wait to it; D2 rebases onto it when it lands.
- **Lanes:** W1 is **ccd only** (`ccd/ccd` and its tests). D2 is ccd plus `deploy/measure-working-state.py`'s verb list and kind, and one additive end-cause word, `swap-auto-sideways`, in `shared/api.ts` (server lane, deployed after the agent lane). D7 is the keepalive script and its tests. No other server, agent or PWA byte; no `FLEET_PROTO` bump; no restart or roll is added. Every release deploys agent lane first.
- **The tick budget:** the steady-state tick (no stand-down, no move) gains no fork in any wave; `ccd-tick-budget.test.ts` holds it. D5's silent-exit fixtures (`busy`, `cooldown`, `narrow`) gain at most one probe per `TRANSCRIPT_ARM_INTERVAL` and the floored whole-pane capture, each delta measured and named in the PR body.

## 5. Waves

Every PR lands its characterization pins of today's swap decisions first, keeps the behaviour change in its own commit, carries its off marker where it changes a decision, and rolls back by revert.

### 5.1 W1: observe, then unfreeze, then re-rank (four PRs, in this order)

1. **D5, stand-down logging.** Smallest and safest: no decision changes. It goes first so every later change is observable, and so the operator's narrow-pane decision rests on counts.
2. **D4, pin expiry and the ceiling.** Local to the pin. Lands §3.1's guards, which D4 needs first: the deploy sweep reads every legacy pin on one tick, so without the hashed offset and the fleet-wide slot all 17 would release on one tick a day later.
3. **D3, the ended window.** One gate, one helper, reusing the guards and the no-bounce record.
4. **D1, overflow ranking.** The widest change (every rescue and ceiling-leave), last, with D5's `lane=` word already counting its baseline.

### 5.2 W2: move and measure

5. **D2, the sideways move.** After D1, so a sideways move and a rescue rank Anthropic accounts the same way; after #1050 if it is open.
6. **D7, the keepalive's measurement.** Independent of D2's files. It makes D2's "measured room" and D3's home figure available more often, so it may land first if ready. Its first step is one operator measurement (§3.7); with a "no", the measurement is parked and nothing in D7 lands.

### 5.3 After W2: the operator's next questions (not ruled here)

- The narrow-pane gate (D5's second half), from `_pane_narrow_note`'s lines with evidence.
- The rate-limit dialog (§2.5), from `banner-outside-tail` counts; a detection change is a K8 row.
- A draft typed during the jitter, at the act (§3.1): whether `cmd_swap`'s act-time affinity re-check should also stand down on a draft, decided with #1050's change to the idle gate.
- D7's interactive source, if the stream-json measurement answers no (§3.7).
- Whether a turn beside an idle interactive session under one config dir is acceptable (§3.7), from D7's Step 0.

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
- D1's "with room" is `_avail`, so an unmeasured Anthropic account counts (§3.5); for a class-tagged session, an Anthropic account whose seven-day window has ended is ranked (at 100) in pass 1 rather than skipped, so it counts too; and the spread pass never prefers a non-Anthropic lane over a recently taken Anthropic account with room (§3.5).
- D2's "measured room" is both windows known and a score at most `SIDEWAYS_MAX_SCORE` (80), not merely below the ceiling (§3.6).
- D3's ended window is not read as servable for a home the session left blocked within `RESCUE_CHAIN_WINDOW` (§3.4).
- D4's pin is kept unchanged and its expiry lives in a separate field, so a revert or a mixed-version deploy never drops a pin (§3.3); a legacy pin's expiry is spread by a hashed offset (§3.3).
- The ruling's "no herd" is applied to the new affinity moves through §3.1's per-account and fleet-wide slots and the draft stand-down; ceiling-leaves and rescues are exempt because switching is never blocked.
- D7's "a heartbeat is never occupied" meets the keepalive's refusal of a second `claude` under one `CLAUDE_CONFIG_DIR`. The design keeps every live pane and every restarting row occupied until D7's Step 0 measures that a concurrent turn beside an idle interactive session under one config dir is safe (credential refresh and the shared config and history files) and the operator confirms it; the occupancy commit is gated on that measurement and lands only together with a source that yields `rate_limits` (§3.7).
- The ruling's first wave is "D5 + D4 + D3 + D1, each its own PR, red-first, switching never blocked"; §5.1 orders them smallest and safest first.

## 7. Risks and rollback

| Risk | Guard | Rollback without a deploy | Rollback |
|---|---|---|---|
| A log flood from D5 | one line per episode, not cleared by `_tick_decided`; the floor; only with a trigger; no line on the steady-state tick | — (lines only) | revert D5 |
| D5 slows the tick | the evidence probe runs only on a limit-arm silent exit, its answer cached for `TRANSCRIPT_ARM_INTERVAL` whatever it is; the tick-budget fixtures, deltas named | — | revert D5 |
| A return-home herd at a reset second, a pin-expiry wave, or a deploy that makes many sessions eligible | §3.1's per-account slot (180 s) and fleet-wide slot (30 s) under the lock; the legacy pins' hashed offset; `_swap_idle_gate`, `SWAP_JITTER` | `swap-home-ended-off`, `swap-pin-expiry-off` (removing a marker is itself spaced by the fleet slot) | revert D3 / D4 |
| The stagger freezes the return home (a full volume) | it fails open, with one `stagger-unwritable` line | `swap-stagger-off` | revert D4's stagger commit |
| An affinity move kills a draft | the draft stand-down after the idle gate (§3.1) | `swap-stagger-off` | revert D4 |
| D3 sends a session home to a real limit | the rescue arm evacuates on detection; the chain rule | `swap-home-ended-off` | revert D3 |
| D3 returns a session to a home it just left blocked | the no-bounce list (`RESCUE_SKIP_LEFT`) keeps rc 5 for `RESCUE_CHAIN_WINDOW` | `swap-home-ended-off` | revert D3 |
| D1 lands a rescue on an Anthropic account near its 5-hour ceiling | `RESCUE_CHAIN_COUNT`, the no-bounce skip, the spread rule; a ceiling-leave's own bound is one hop per `SWAP_COOLDOWN` | `swap-overflow-rank-off` | revert D1 |
| D1 misreads a GPT-backed lane as Anthropic | `_is_anthropic_backend` reads the roster projection; an older projection falls back to today's ranking, and `ccrc doctor` warns | — | — |
| D2 bounces a session | the branch applies only on a non-Anthropic `cur`; once on an Anthropic account it never fires again; measured room at most `SIDEWAYS_MAX_SCORE`; the guards | `swap-sideways-off` | revert D2 |
| D2 stops a session that turned busy during the jitter | the dispatch keeps `CCD_SWAP_ARM=affinity`, so `cmd_swap`'s act-time idle re-check (D-5240) requeues it | `swap-sideways-off` | revert D2 |
| D4 releases every pin at once after a revert or mid-deploy | the pin's value is unchanged; the expiry is a separate field older readers ignore | `swap-pin-expiry-off` | revert D4 (the field stays, unread) |
| D2 crosses a pool | `_pool_ok` and the crossing rules, one shared predicate with the loop | `swap-sideways-off` | revert D2 |
| D4 drops an operator's deliberate choice too soon | expiry at the blocked window's reset; the session then returns home only when home serves; the operator can pin again | `swap-pin-expiry-off` | revert D4 |
| D7 spends more per account | the keepalive's lock, backoff, `CCRC_KEEPALIVE_FRESH`, one account at a time; the occupancy change lands only with a source that yields `rate_limits` | the keepalive's pass switches; `keepalive-heartbeat-occupied` | revert D7 |
| D7 runs a second `claude` under one config dir | live panes and restarting rows stay occupied until Step 0's concurrency measurement passes and the operator confirms | `keepalive-heartbeat-occupied` | revert D7 |
| Any change blocks a switch | none adds a refusal, a wait on a rescue, or a gate on `cmd_swap`; the characterization pins over the swap path's refusal set and `_swap_idle_gate`'s verdict table | the markers | revert |

**Markers.** Each off marker is an empty file in the registry directory, read by ccd with the `-e`/`-L` test the `reclaim-paused` reads use, on the tick, with the server down. Writing or removing one is an operator act on the box (the ccrc SAFETY rules forbid it to sessions). With no marker, the ruled behaviour is on.

**Bound rulings, kept:** account switching and the auto-swap are never blocked; no herd restarts or herd wakes; home-account affinity; pools are the spend and eligibility boundary; hibernation's ensure-wake gate; no revival elsewhere (#199); improve what exists first (every rule edits a named function in place).

## 8. Measures of success

Measured on the box before W1 and after each PR's deploy, with the same queries as §1.1 (the plan's operator acts):

| Measure | Baseline (7 days to 2026-10-20) | Target after W1 | Target after W2 |
|---|---|---|---|
| Manual swaps a week (a `swap` line with no `dispatch` before it) | 15, plus 3 unattributed | ≤ 6 | ≤ 3 |
| Of those, corrections off a non-Anthropic lane | 8 | ≤ 2 | 0 |
| Automatic moves landing on a non-Anthropic lane (`lane=other`) | 30 of 52 | only when no Anthropic account passed the gates (an ended seven-day window counting as passing, §3.5) | same |
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

**rev 1 (2026-10-21).** Three read-only reviews of rev 0 (a ccd-code review, a swap-safety review, a feasibility and gates review) found 7 high, 21 medium and 15 low defects, many shared. Every finding and its outcome is in the plan's Review log. The design changes: D2 keeps the `affinity` arm and carries its cause in `CCD_SWAP_WHY`, and is told apart by rc 7 (§3.6); the pin is unchanged and its expiry is a separate field, legacy expiries hashed apart (§3.3); the stagger becomes a sliding per-account slot plus a fleet-wide slot under the lock, fails open, applies only while `cur` serves, carries a draft stand-down and has its own marker (§3.1); D5's episode is not cleared by `_tick_decided`, its probe is cached whatever it answers, and its triggers are split by arm (§3.2); D3 honours the no-bounce list (§3.4); D1 ranks seven-ended Anthropic candidates in pass 1 and fixes the spread pass's leak (§3.5); D2's room is capped at `SIDEWAYS_MAX_SCORE` (§3.6); D7 names the one-config-dir hazard, keeps live panes occupied until it is measured, takes one stream-json yes/no as its source, and lands both halves together or not at all (§3.7). Symbols re-checked on `27755979e`.
