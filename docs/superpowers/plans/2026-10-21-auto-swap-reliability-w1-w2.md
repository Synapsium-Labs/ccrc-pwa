# Auto-swap reliability, W1 and W2: every stand-down logged, pins expire, the return home survives a reset, non-Anthropic lanes overflow only, the sideways move, and a keepalive that measures — Implementation Plan

> **For agentic workers:** one PR per task, in the order of §Landing order, each dispatched only when its row in §Gates is all green. To execute a task, REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Steps use checkbox (`- [ ]`) syntax. Workers do not edit §Deviations and decisions. A departure is named by slug in the task's report; the coordinator enters it from this plan's issued block (§Deviations), never the worker. Workers never touch the fleet box: every box reading and every marker in this plan is an operator act (§Operator acts).

**Spec:** `docs/superpowers/specs/2026-10-21-auto-swap-reliability-design.md` (rev 0). §2 (the causal chain), §3 (the rules, §3.1's stagger included), §4, §5, §6.1 (the ruling and the readings it records) and §7 bind every task. Read them before Step 0.

**Status:** rev 0 (2026-10-21). Written after the operator ruled D1 to D7 on 2026-10-21, in their words: "Accept all recommended (Recommended)" (spec §6.1). The first wave is the ruling's own: "D5 + D4 + D3 + D1, each its own PR, red-first, switching never blocked". D6 builds nothing (spec §3.8).

**Inputs.** D-3097, D-3098 and D-3099 (the manual-swap pin, its floored note, "the pin follows the truth"). D-3526 (the carried-in filter). D-2363 and D-2364 (the transcript arm; the pane regex kept narrow on purpose). D-5240 (`_swap_idle_gate`, "ONE GATE, TWO CALLERS"), D-5349 (the narrow-pane stand-down). D-5242 (hibernation; the `.woke` cooldown). D-4961, D-4962 and D-4963 (the tick-diet seams: the clock, the limits reader, builtin registry reads). Session continuity §5.4 (`_rescue_policy`'s rules 1 to 3) and §6 (no revival, #199). The consolidation spec's §7 swap pin and K15.

**Base:** `origin/main` `d8cd47658` (#435 merged 2026-10-21). Code is cited by file and by function, constant or `describe` title, never by line number. Step 0 of each task re-grounds every citation by content on the tree it starts from.

**Symbols measured at the base (`ccd/ccd`).** Present, each defined once: `_auto_swap_check`, `_session_hard_blocked` (its `HARD_BLOCK_NO` words `unmeasurable`, `carried-in`, `running`, `stalepress`, `negative`, `draft`), `_pane_measurable`, `_pane_narrow_note`, `_pane_hard_blocked`, `_pane_limit_banner`, `_pane_carried_in`, `_limit_dated`, `_never_came_up`, `_pane_box_has_content`, `_rescue_policy`, `_rescue_target`, `_swap_target`, `_limit_score`, `_limit_field_to`, `_avail`, `_class_gate`, `_serviceable`, `_pool_for`, `_default_pool`, `_pool_ok`, `_account_ok`, `_is_home_able`, `_is_anthropic_backend` (it falls back to `_is_home_able` when `CCRC_ANTHROPIC_BACKEND` is not declared), `_swap_pin_tick`, `_swap_pinned`, `_route_note_floored`, `_tick_undecidable`, `_tick_decided`, `_tick_strand_undecidable`, `_strand_mark`, `_rescue_strand_cause`, `_rescuewait_open`, `_swap_idle_gate`, `_dispatch_swap`, `cmd_swap` (the pin write under `CCD_SWAP_AUTO`), `_swap_rescue_act_gate`, `_swap_refuse`, `_swap_lastswap_restore`, `_swap_end_cause` (`swap-manual`, `swap-auto-home`, `swap-auto-rescue`, `swap-auto`), `_resume_prompt_for`, `cmd_supervise`, `cmd_ensure`, `cmd_caps`. Constants: `SWAP_COOLDOWN` 900, `SWAPBLOCK_COOLDOWN` 1800, `SWAP_CEILING` 98, `SWAP_JITTER` 120, `READER_MIN_COLS` 120, `TRANSCRIPT_ARM_INTERVAL` 30, `COMPACT_NOTE_FLOOR` 1800, `ROUTE_NOTE_FLOOR` 1800, `STALE_RESUME_GRACE` 30, `SHARE_FRESH_S` 28800, `RESCUE_WAIT_BOUND`, `RESCUE_CHAIN_WAIT`, `RESCUE_CHAIN_COUNT` 3, `RESCUE_CHAIN_WINDOW` 3600, `RESCUE_SPREAD_WINDOW` 600. **In `ccd/ccd-telemetry-keepalive`:** `_ka_session_on` (three answers; a supervisor heartbeat under `KA_SESSION_FRESH`, 120 s, reads occupied), `_ka_pane_probe`, `_ka_turn` (`<wrapper> -p <prompt> --model … --output-format json`), `_ka_row` (outcomes `refreshed`, `no-render`, `skipped`), `_ka_backoff_window`, `_ka_state_get`/`_ka_state_set`. **The one limits writer:** `ccd/statusline-command.sh`, from its input's `.rate_limits.five_hour` and `.rate_limits.seven_day`. **Absent at the base:** a stand-down note, a pin expiry, a "window ended" reader, a second ranking bucket, a sideways branch, `HOME_RETURN_SPACING`, `swap-auto-sideways`, and any of this plan's five markers.

**Also measured at the base, because the tasks depend on them.** `_auto_swap_check` runs the cooldown and `swapblocked` returns **before** `_session_hard_blocked`; the rescue dispatch sits above `_swap_pinned`; `.hold`, `.woke` and `_swap_idle_gate` follow the pin, silently. On a hard-blocked session leaving a non-Anthropic lane, the tick stamps that lane's limits file `five` 100 (`_rescue_prev_save` first); D1 leaves it. `_swap_target`'s loop keeps `best` (home-able) and `obest` (others) by lowest score, unmeasured 100, auth-dead 101; pass 1 skips a class-gate rc 2 candidate (`unmeas`) and returns 5 only when nothing was found. `_tick_undecidable` logs once per field word (`.tickstuck`). `_swap_pinned` compares the pin's whole value to the account. `deploy/measure-continuity.py`'s `S4_RESCUE` pattern ends `\[home=[^\]]*\](.*)$`, so a suffix on the `auto-rescue` line parses; `deploy/measure-working-state.py`'s `DECISION_VERBS` lists `auto-home`, `auto-pool`, `auto-rescue`. `shared/api.ts` maps the end causes `swap-auto-home` and `swap-auto-rescue` to words. The swap suites: `ccd-swap.test.ts`, `ccd-swap-pin.test.ts` (D-3097 to D-3099), `ccd-swap-target-class.test.ts` ("away from home: the home-recovered gate and the cur-still-works gate", "the tick spends rc 5 and rc 6"), `ccd-rescue-policy.test.ts` (rules 2 and 3, spread, no bounce), `ccd-auto-swap-hold.test.ts`, `ccd-auto-swap-pool.test.ts`, `ccd-swap-guards.test.ts`, `ccd-swap-refuse.test.ts`, `ccd-backend-vs-placement.test.ts`, `ccd-serviceable.test.ts`, `ccd-limits.test.ts`, `ccd-limit-stale.test.ts`, `ccd-limit-banner.test.ts`, `ccd-reader-standdown.test.ts`, `ccd-tick-budget.test.ts` (with `tickBudgetHarness.ts`, `tickDietCorpus.ts`), `telemetry-keepalive.test.ts` ("the three skips"), `keepalive-freshness-parity.test.ts`, `measure-continuity-stage4.test.ts`.

**Deploy class.** W1 and D-6184 are **ccd** (`ccd/ccd` and its tests; D-6184 also one additive word in `shared/api.ts` and one in `deploy/measure-working-state.py`). D-6185 is the keepalive script and its tests. Each rides an ordinary release, agent lane first, verified from the deploy log; no task adds a restart, a roll, a herd wake or a `FLEET_PROTO` bump. Step 0 of D-6180 records how a supervisor adopts a new `ccd` (so the operator acts know when a change is live on each session).

**Names.** Tasks are named by their D-numbers: **D-6180** (D5), **D-6181** (D4), **D-6182** (D3), **D-6183** (D1), **D-6184** (D2), **D-6185** (D7). Operator acts are **OA-S1** to **OA-S5**.

**Goal, PR by PR.**

| After | The operator sees | Underneath |
|---|---|---|
| `main` | sessions parked for hours to days on a GPT-backed lane; manual corrections that then stick; 2 limits in a week with no action and no line | §2's six causes |
| D-6180 | a `stand-down` line for every held limit, and a re-logged `tick-undecidable`; `lane=` on every decision line | one note helper, episode-keyed and floored; an evidence probe on silent exits only |
| D-6181 | pins end at the blocked home window's reset (or 24 h); a pinned session at the ceiling leaves | the pin's value carries an expiry; `_swap_pinned` reads `_avail`; the per-account stagger |
| D-6182 | sessions go home after their home's weekly reset, one at a time | the home-recovered gate reads an ended window as servable |
| D-6183 | rescues and ceiling-leaves land on an Anthropic account whenever one has room | two buckets in `_swap_target`'s loop |
| D-6184 | a session on a GPT-backed lane moves to an Anthropic account with measured room at its next idle boundary | one branch in the non-forced arm; `auto-sideways` |
| D-6185 | idle accounts are measured; the census shows `refreshed` | the occupancy rule; a measured source for the keepalive turn |

---

## Gates: what each task waits for, stated honestly

Measured on 2026-10-21 at `d8cd47658` with `gh pr list -R Synapsium-Labs/ccrc-pwa --state open --json number,title,files` (29 open PRs) and `gh pr diff <n>` for each PR that holds a file this plan edits.

**#435 has merged** (session continuity wave 4b, `d8cd47658`, 2026-10-21); it is the base, and nothing here waits for it.

**Open PRs that hold a file this plan edits.**
- **#1050** (`fix(ccd): an affinity swap waits while the session has background work`) holds `ccd/ccd` (one hunk growing `_swap_idle_gate`'s body, and the generated-stamp header) and `server/test/ccd-swap-guards.test.ts` (one appended block after "a woken row takes no affinity swap for SWAP_COOLDOWN (D-5242)"). It is **in the swap region**: it changes `_swap_idle_gate`'s verdict table, which D-6184 calls. D-6180's affinity-arm notes sit after `_swap_idle_gate`'s call, not in its body; rule 6 at Step 0. D-6184 waits for #1050 to merge or close.
- **#1054** (named workspaces) holds `ccd/ccd` in `cmd_ws_add`, `_ws_disk_free_gb`, the dispatch table and the generated-stamp header. Line-disjoint from every hunk below today.
- **#1038** (the pure-bash timeout watcher, D-6123) holds `ccd/ccd` in `_plat_timeout` and the generated-stamp header, and `ccd/ccd-account-auth`. Line-disjoint.
- **#960** (skins, the fleet pieces) holds `server/test/ccd-swap.test.ts` (one hunk in "the swap heartbeats WHILE it carries, not just around the carry"). D-6181's characterization rows go in `ccd-swap-pin.test.ts`; if any task edits `ccd-swap.test.ts`, it stays line-disjoint from that `describe`.
- **Every `ccd/ccd` PR touches the generated-stamp header** (`ccrc restamp`). Whichever lands second rebases and restamps; that is a conflict in the header only, never a reason to merge two ccd PRs as one.
- **No open PR** holds `ccd/ccd-telemetry-keepalive`, `ccd/statusline-command.sh`, `server/test/ccd-swap-pin.test.ts`, `ccd-swap-target-class.test.ts`, `ccd-rescue-policy.test.ts`, `ccd-backend-vs-placement.test.ts`, `ccd-tick-budget.test.ts`, `telemetry-keepalive.test.ts`, `deploy/measure-working-state.py` or `shared/api.ts`'s end-cause map.

**Planned work with no PR yet that may hold the same region** (each task's Step 0 re-runs `gh pr list` and keeps its hunks line-disjoint, or waits):
- **Consolidation W5** (K2, K16, K18, K4's ccd half: ccd in place) touches the auth-dead write on the swap path with a behaviour-identical primitive; its §7 pin asserts the swap path's refusal set and `_swap_idle_gate`'s verdict table. No PR yet. If its pin lands first, every task here keeps it green (none changes either); if a W5 PR is open at a task's Step 0 in `_auto_swap_check`, rule 6.
- **#998** (a stale pool lease fails shut on tagged projects) will edit `_pool_ok`'s callers; no PR. D-6184 reuses the loop's `_pool_ok` predicate and must stay line-disjoint from it.
- **#382** (an auto-swap off switch) is open as an issue, unplanned; nothing here builds it (spec §3.9).

| Task | Rulings | Operator acts | Open PRs, rule 6 at Step 0 | Other |
|---|---|---|---|---|
| D-6180 stand-down logging | D5 **ruled** | OA-S1 before merge | #1050, #1054, #1038 (`ccd/ccd`) | — |
| D-6181 pin expiry + stagger | D4 **ruled** | OA-S2 after D-6180 deploys | as D-6180 | D-6180 merged |
| D-6182 ended window | D3 **ruled** | OA-S2 after D-6181 deploys | as D-6180 | D-6181 merged (the stagger) |
| D-6183 overflow ranking | D1 **ruled** | OA-S2 after D-6182 deploys; OA-S3 (the roster projection declares `CCRC_ANTHROPIC_BACKEND`) | as D-6180 | D-6182 merged |
| D-6184 sideways | D2 **ruled** | OA-S2 after W1 | #1050 **merged or closed**; #998 if open | D-6183 merged |
| D-6185 keepalive | D7 **ruled** | OA-S4 (the source measurement) before the behaviour commit | none today | D-6180 merged |

## Landing order

```
spec §6 ruled (D1..D7)
   │
   ▼
D-6180 (D5, logging) ─▶ D-6181 (D4, pins + stagger) ─▶ D-6182 (D3, ended window) ─▶ D-6183 (D1, overflow)   [W1]
   │                                                                                    │
   │                                                                     #1050 merged ──┤
   │                                                                                    ▼
   └──────────────────────────────▶ D-6185 (D7, keepalive)                       D-6184 (D2, sideways)    [W2]
```

One ccd series at a time: D-6180 to D-6184 all edit `_auto_swap_check` or `_swap_target`, so each waits for the previous one to merge (they are line-adjacent, not line-disjoint). D-6185 edits only the keepalive and may land beside them once D-6180 has merged (its `stand-down` and `lane=` lines are the baseline D-6185's measures read). Each W1 PR deploys, and OA-S2 reads the swap log, before the next W1 PR is dispatched: the order exists so each change is observed alone.

## Global constraints

- **Public repository.** Every word in code, tests, commits and PR bodies is publishable: no host, address, account or lane name, project name, home path, email, private tracker id or session slug from the box. Fixtures are neutral (`account-a`, `account-b`, `lane-x` for a non-Anthropic lane, `s-aaaa`, `home-a`). Never a private tracker id: cite D-numbers, ARCH-NN and GitHub `#n`.
- **Account switching and the auto-swap are never blocked (Q8).** No task adds a refusal, a wait, a gate or a server dependency to `_auto_swap_check`'s rescue arm, `_swap_rescue_act_gate`, `cmd_swap`, `swap-self` or the swap routes. A rescue is never delayed by the stagger, a pin, a marker or a log write. The swap path's refusal set and `_swap_idle_gate`'s verdict table are byte-identical after every task (consolidation §7); each task's characterization commit pins the rows it relies on.
- **No herd restarts, no herd wakes.** Every new automatic move is an affinity move: `_swap_idle_gate`, `SWAP_JITTER` and the per-account stagger (`HOME_RETURN_SPACING`, D-6181) apply. No task adds a restart, a supervisor bounce, an `ensure` loop, a roll, or a keepalive pass that turns more than one account at a time.
- **Home-account affinity.** No task writes `.home`. The return home keeps its place and its conditions; D-6182 widens only what "home can serve" reads for an ended window; D-6184's move is temporary by construction.
- **Pools.** `_pool_ok` is the spend and eligibility boundary; every candidate any task offers passes it (and the crossing rules) exactly as the loop does today. The "spend-cap billing groups" of an older ruling are not on `main` and are not referenced.
- **Hibernation's ensure-wake gate.** No task wakes, starts or swaps a hibernated, stopped or failed-unit session; D6 builds nothing (#199).
- **The ccrc SAFETY rules.** No task adds a `ws-*` destructive verb, a unit or tmux touch by a session, or widens what `cmd_swap` stops or carries. The five markers are written and removed by the operator only (§Operator acts), never by a worker or a session. D-6185's interactive source, if chosen, runs on a private tmux socket that the fleet's server and `ccd ls` never see.
- **Markers.** `$REG/swap-pin-expiry-off` (D-6181), `$REG/swap-home-ended-off` (D-6182), `$REG/swap-overflow-rank-off` (D-6183), `$REG/swap-sideways-off` (D-6184), `$REG/keepalive-heartbeat-occupied` (D-6185). Each is read with the `-e`/`-L` test the `reclaim-paused` reads use, by ccd alone, with the server down. Absent means the ruled behaviour. Each has a "marker present → today's answer" pin.
- **The tick budget.** The steady-state tick (no stand-down, no move, no marker) gains no fork and no subshell: `ccd-tick-budget.test.ts` and its corpus stay green unmodified, or a task's PR body justifies each new budget row against spec §4. New reads of registry fields use the builtin readers (`_reg_get_to`, `_reg_read_to`, D-4963) and the clock seam (`_now_s_to`, D-4961).
- **Characterization first.** Every behaviour change is preceded, in the same PR, by a characterization commit that pins today's swap decisions over the rows the task touches, green on the base, named "today:" (rows the behaviour commit flips) and "kept:" (rows it must not). The behaviour commit is its own commit, flips exactly the named "today:" rows, and the PR body lists every before/after row and cites the ruling (spec §6.1, the operator's 2026-10-21 answer).
- **Red first, then a mutation table, RUN.** Every new test is shown red on the characterization commit before the code that greens it. Each mutation table is run on a `git archive` copy of the PR's tip under the scratch directory, never in the worktree, and each row's red test name is printed in the PR body.
- **One definition.** A rule that two places need (the candidate gates for D-6184 and the loop; the "window ended" read; the stagger; the floors) has one definition, and a `single-definition`-style pin where the repo already pins its siblings. Constants are read by reference, never a second literal.
- **Test discipline.** vitest always `--maxWorkers=2`, one suite at a time; never the full server suite locally.
- **Counts measured, not assumed.** Every figure in a PR body (pins standing, `pin-hold` lines, landings by lane, stand-downs by reason) is measured by an operator act or a suite, never typed from this plan or the spec.
- **Deviation ledger.** This plan defines D-6180 to D-6185, one per task, and never allocates. 6186 to 6189 are issued and unused, held for departures and entered by the coordinator only.

## Review focus (the failure modes most likely to bite)

1. **A rescue delayed or refused.** Nothing new runs on the hard-blocked path before `_dispatch_swap … rescue` except D-6180's note on the silent exits that already return; the stagger, the pin and the markers are never read when `hard_blocked` is set. A diff that moves any read above the rescue dispatch, or adds a `return` on it, is refused.
2. **A herd.** Every new automatic move goes through the per-account stagger and `_swap_idle_gate`; the stagger's slot is an exclusive create (two ticks in one second for one account: exactly one dispatches); legacy pins expire relative to the first tick that reads them, not their mtime.
3. **An unmeasured read that moves a session.** D-6182 reads "ended" only from a present figure whose `ResetAt` has passed (a missing file, field or clock answers "not ended"). D-6184 takes only a candidate with both windows measured and class gate rc 0. D-6183 falls back to today's ranking when `CCRC_ANTHROPIC_BACKEND` is not declared.
4. **A pool crossed.** D-6184's candidate passes the same `_pool_ok` and crossing rule as the loop, through one shared predicate.
5. **A decision changed outside the ruled rows.** Each behaviour commit flips only its named "today:" rows; the swap path's refusal set, `_swap_idle_gate`'s verdict table, `_limit_score`, `_avail` and `_rescue_policy` are byte-identical.
6. **The tick slowed.** No fork on the steady-state tick; the evidence probe runs only on a silent exit, at most once per `COMPACT_NOTE_FLOOR` per session.
7. **A log that floods or lies.** One line per episode and a re-log floor; a stand-down with no limit evidence writes nothing; `lane=` names the target's backend through `_is_anthropic_backend`, never a second list.
8. **A marker that does not switch it off.** Each marker's "present → today's answer" pin; the marker is read on the tick, not cached across ticks.

## Tasks

### Task D-6180: every silent stand-down logged, once per episode, with a re-log floor (spec §3.2; D5) — GATED: OA-S1 before merge

**Routing:** **band 3, native** (the swap tick; the evidence probe is on the rescue's doorstep). Two reviewers: one reads only Review focus 1, 6 and 7 (the swap-safety focus); one checks every site against spec §2.5's table. **Lane:** ccd. **Needs:** nothing merged; OA-S1's baseline in the PR body.

**Files:**
- Modify `ccd/ccd`:
  - A helper `_standdown_note <id> <reason> [<evidence>] [<outside-tail>]`: one swap-log line per episode (`stand-down <id>: <reason> [evidence=…] [banner-outside-tail=…]`), the episode keyed on the reason word in a registry field `standdown` (the `.tickstuck` shape: `<epoch> <reason>`), re-logged once the episode is older than `COMPACT_NOTE_FLOOR` (by reference). `_tick_decided`'s clearing gains the `standdown` field.
  - A helper `_standdown_evidence <id>` → `transcript | carried-in | none`, from `_limit_dated "$id" transcript "$(_pane_born "$id")"` (rc 0, rc 3, other), run only from a silent exit and at most once per floor per session (its answer cached in the same field's episode).
  - `_auto_swap_check`: at the `SWAP_COOLDOWN` and `SWAPBLOCK_COOLDOWN` returns, the note `cooldown` / `swapblocked` when `_standdown_evidence` is not `none`; after `_session_hard_blocked` stands down with `HARD_BLOCK_NO` in `unmeasurable`, `carried-in`, `running`, `stalepress`, `draft`, the note with that word when there is pane, banner or transcript evidence; at the rescue's `_avail "$target" || return 0`, the note `target-unavailable` (always: a target was chosen for a blocked session); at `.hold`, the `.woke` cooldown and `_swap_idle_gate`'s failure, the note `hold` / `woke` / `idle-gate` when ccd had a target other than `cur` (the `pin-hold` condition). `_pane_narrow_note`'s line gains `evidence=` from the same probe (its own floor kept).
  - `banner-outside-tail`: on the same floored path only, `_pane_hard_blocked` and `_pane_limit_banner` over the whole visible pane capture (one `tmux capture-pane`, the read the tick already makes, without `tail -8`); `yes` when either matches there and neither matched the tail.
  - `_session_hard_blocked`: a fresh scan whose `_limit_dated` answers rc 3 sets `HARD_BLOCK_NO=carried-in` instead of `negative`; the cached value (`0`) and its reuse within `TRANSCRIPT_ARM_INTERVAL` are unchanged.
  - `_tick_undecidable`: the same field word is logged again once the `.tickstuck` stamp is older than `COMPACT_NOTE_FLOOR`, with `(still, <age>)`, and the stamp refreshed.
  - The `auto-rescue` and `auto-home`/`auto-pool` lines end with ` lane=anthropic` or ` lane=overflow` (`_is_anthropic_backend "$target"`).
- Modify or add tests: `server/test/ccd-standdown-notes.test.ts` (new), `ccd-swap-target-class.test.ts` ("the tick spends rc 5 and rc 6", for the re-log), `ccd-rescue-policy.test.ts` (only if a pinned line text gains `lane=`), `ccd-tick-budget.test.ts` (unmodified, run), `measure-continuity-stage4.test.ts` (run: the suffix parses).

- [ ] **Step 0: Re-ground** every symbol; rule 6 against #1050, #1054 and #1038; record how a supervisor adopts a new `ccd` (for the operator acts); confirm the tick-budget corpus has no silent-exit row that would now fork.
- [ ] **Step 1: Characterization commit** (green on the base): "today:" a session in `SWAP_COOLDOWN` whose transcript's newest row is this process's limit row writes nothing; the same in `SWAPBLOCK_COOLDOWN`; a `draft` stand-down over a limit row writes nothing; a carried-in transcript row caches and reads `negative`; a `classwindow` episode logs once and never again after 31 minutes; the rescue's dropped target writes nothing; an affinity move held by `.hold` writes nothing; an `auto-rescue` line ends at its `[home=…]`/`via=` suffix. "kept:" a session in cooldown with no limit row writes nothing; the rescue dispatches on the same tick it detects; `pin-hold`'s floored note unchanged; `_pane_narrow_note` at most once per floor.
- [ ] **Step 2: Red.** "a cooldown over a limit row writes one stand-down line"; "a second tick in the same episode writes nothing"; "the episode is re-logged after the floor"; "a decided tick clears the episode"; "a cooldown with no limit evidence writes nothing"; "draft over a limit row is logged with evidence=transcript"; "a carried-in transcript row reads carried-in, not negative"; "the cached verdict is reused unchanged"; "target-unavailable is logged"; "an affinity move held by .hold is logged only when ccd had a target"; "tick-undecidable re-logs the same field after the floor"; "banner-outside-tail is yes when only the whole pane shows the banner"; "auto-rescue and auto-home lines carry lane="; "the steady-state tick forks no more than before" (the budget suite); "the rescue still dispatches on the tick it detects, with no line before it".
- [ ] **Step 3: Green, in commits.** (1) the helpers, unused; (2) the call sites; (3) the `carried-in` word; (4) the re-log floor; (5) `lane=`. D-6180 changes no decision, so it has no behaviour commit; the PR body still lists before/after lines and cites D5's ruling.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the episode key ignored (a line every tick) | ccd-standdown-notes | "a second tick in the same episode writes nothing" |
  | the floor read as 0 | ccd-standdown-notes | the same row |
  | evidence skipped (a line with none) | ccd-standdown-notes | "a cooldown with no limit evidence writes nothing" |
  | the probe run on the steady-state tick | ccd-tick-budget | its fork budget |
  | the probe moved above the rescue dispatch | ccd-standdown-notes | "the rescue still dispatches … with no line before it" |
  | `carried-in` cached as `1` | ccd-standdown-notes | "the cached verdict is reused unchanged" |
  | `_tick_undecidable` re-logs without the floor | ccd-swap-target-class / ccd-standdown-notes | "re-logs the same field after the floor" |
  | `lane=` from `_is_home_able` | ccd-standdown-notes | "auto-rescue and auto-home lines carry lane=" (a home-able non-Anthropic fixture) |

- [ ] **Step 5: Verify.**

      cd server && ./node_modules/.bin/vitest run test/ccd-standdown-notes.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-swap-target-class.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-rescue-policy.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-swap-pin.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-auto-swap-hold.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-reader-standdown.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-tick-budget.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/measure-continuity-stage4.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/citations.test.ts --maxWorkers=2

**Exit (GATES):** every row of spec §2.5's table writes one line per episode with evidence; the steady-state tick is unchanged; no decision changed. **After deploy:** OA-S2. **Rollback:** `git revert` (lines only).

### Task D-6181: a manual pin expires, never holds a session at the ceiling, and returns are staggered per account (spec §3.1, §3.3; D4) — GATED: after D-6180; OA-S2 read

**Routing:** **band 3, native.** Two reviewers: one reads only Review focus 1, 2 and 8 (the swap-safety focus); one checks the before/after rows against D-3097 to D-3099 and D4's ruling. **Lane:** ccd. **Needs:** D-6180 merged and deployed; OA-S2's reading.

**Files:**
- Modify `ccd/ccd`:
  - `cmd_swap`, the operator-path pin write: the value becomes `<account> <expires-epoch> <why>`, `why` one of `reset` (the later `ResetAt` of home's windows at or above `SWAP_CEILING`, bounded by the set time plus `SWAP_PIN_TTL`) or `ttl` (no home window blocked, or a pin set on home: the set time plus `SWAP_PIN_TTL`). `SWAP_PIN_TTL` is a new constant, 86400, with its reason (the ruling's 24 h). The automatic path still clears the pin (D-3097).
  - `_swap_pinned`: compares the value's **first word** to the account (a legacy one-word value still matches); answers "not pinned" when the expiry has passed or when `_avail "$2"` fails (the account is at its ceiling); `$REG/swap-pin-expiry-off` restores today's answer (first word only, no expiry, no ceiling read).
  - `_swap_pin_tick`: ends an expired pin with `pin-expired <id>: pinned to <account> until <reset|ttl>` (clearing `swappinnote`, as D-3099's arm does); rewrites a legacy one-word pin to `<account> <now + SWAP_PIN_TTL> ttl` on the first tick that reads it; both skipped while the off marker stands.
  - **The stagger:** `HOME_RETURN_SPACING` (180, with its reason: above `SWAP_JITTER`) and `_affinity_slot_take <target> <now>` → rc 0 for exactly one caller per target and `floor(now / HOME_RETURN_SPACING)` bucket, by an exclusive create (`set -C`, or ccd's existing lock primitive, Step 0 names it) of a registry file named for the target and bucket; buckets older than two windows are removed by the winner. `_auto_swap_check` calls it just before an affinity dispatch **whose target is the session's home** (D-6184 widens the key to any affinity target); a lost slot returns with D-6180's note `stagger`. The rescue arm never reaches it.
- Modify tests: `server/test/ccd-swap-pin.test.ts` (new `describe` blocks after "D-3097: cmd_swap mints the pin, and only on the operator path"), `server/test/ccd-affinity-stagger.test.ts` (new).

- [ ] **Step 0: Re-ground**; rule 6; count, through OA-S2, the pins standing and their value shapes (all one-word today); name the lock primitive.
- [ ] **Step 1: Characterization commit** (green on D-6180's tip): "today:" a pin minted 25 h ago, home recovered → `pin-hold`, no move; a pin on an account whose five reads 100 → `pin-hold`; a pin minted while home's seven read 99 with `sevenResetAt` passed → `pin-hold`; four sessions with one home, home recovered on one tick → four affinity dispatches. "kept:" a hard-blocked pinned session is rescued on that tick (D-3097); an automatic swap clears the pin; a pin naming another account ends with `pin-ended` (D-3099); the `pin-hold` note is floored (D-3098); a non-home affinity move (ceiling-leave) is not staggered.
- [ ] **Step 2: Red.** "the operator path writes the account, an expiry and why"; "the expiry is home's blocked window's reset when sooner than 24 h"; "the expiry is 24 h when no home window was blocked"; "a pin past its expiry ends with pin-expired and the session goes home"; "a pinned account at its ceiling lets the ceiling-leave run, and the pin holds again once the account recovers"; "a legacy one-word pin is rewritten with a 24 h expiry from the first read"; "the off marker restores pin-hold at 25 h and at the ceiling"; "of four sessions returning to one home on one tick, exactly one dispatches"; "the next return to that home waits HOME_RETURN_SPACING"; "two ticks racing for one bucket: exactly one wins"; "a rescue never reads the slot"; "a lost slot logs stand-down stagger".
- [ ] **Step 3: Green, in commits.** (1) the constants and the slot helper, unused; (2) the pin's value written by `cmd_swap` (no reader change: `_swap_pinned` compares the first word); (3) **the behaviour commit**: `_swap_pinned`'s expiry and ceiling, `_swap_pin_tick`'s end and rewrite, the marker; (4) **the behaviour commit**: the stagger before a return home. The PR body lists the before/after rows and cites D4's ruling (spec §6.1) and the herd guard (spec §3.1).
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the expiry ignored | ccd-swap-pin | "a pin past its expiry ends with pin-expired …" |
  | `_avail` not read by `_swap_pinned` | ccd-swap-pin | "a pinned account at its ceiling lets the ceiling-leave run …" |
  | the pin cleared (not kept) at the ceiling | ccd-swap-pin | "… and the pin holds again once the account recovers" |
  | a legacy pin expired by mtime | ccd-swap-pin | "a legacy one-word pin is rewritten with a 24 h expiry from the first read" |
  | the marker read once and cached | ccd-swap-pin | "the off marker restores pin-hold …" |
  | the expiry checked above the rescue | ccd-swap-pin | "kept: a hard-blocked pinned session is rescued on that tick" |
  | the slot taken without exclusive create | ccd-affinity-stagger | "two ticks racing for one bucket: exactly one wins" |
  | the slot read on the rescue arm | ccd-affinity-stagger | "a rescue never reads the slot" |
  | `HOME_RETURN_SPACING` below `SWAP_JITTER` | ccd-affinity-stagger | a constant-relation row |

- [ ] **Step 5: Verify** `ccd-swap-pin.test.ts`, `ccd-affinity-stagger.test.ts`, `ccd-standdown-notes.test.ts`, `ccd-swap.test.ts`, `ccd-swap-guards.test.ts`, `ccd-swap-refuse.test.ts`, `ccd-auto-swap-hold.test.ts`, `ccd-tick-budget.test.ts`, one at a time, `--maxWorkers=2`.

**Exit (GATES):** no pin outlives its blocked window's reset or 24 h; no pin holds a session at the ceiling; at most one automatic return per home per 180 s; the rescue untouched. **After deploy:** OA-S2, with the pin count and the `pin-expired` and `stand-down stagger` lines. **Rollback:** `$REG/swap-pin-expiry-off` (no deploy); `git revert` of the behaviour commits (the new pin values stay readable: the first word still matches).

### Task D-6182: the return home reads an ENDED window as servable (spec §3.4; D3) — GATED: after D-6181

**Routing:** **band 3, native.** Two reviewers: one reads only Review focus 1, 2, 3 and 5 (the swap-safety focus); one checks the before/after rows against D3's ruling and that the forced path is untouched. **Lane:** ccd. **Needs:** D-6181 merged and deployed (the stagger).

**Files:**
- Modify `ccd/ccd`:
  - A read-only helper `_limit_window_ended <wrapper> <five|seven>` → rc 0 iff the limits file has a value for that field **and** its `<field>ResetAt` is at or before now (the clock seam), read through `_limit_field_to`'s own reader for the raw value and reset (one definition; Step 0 names the raw-read seam, `_limit_pick_to` or its caller). A missing file, field or reset, or an unreadable file, answers rc 1.
  - `_swap_target`, the non-forced branch for a session not on home, at the home-recovered gate only: when `_class_gate "$home" "$cls"` answers 2, the class is not `fable`, `_limit_window_ended "$home" seven` answers 0, and `$REG/swap-home-ended-off` is absent, the gate echoes home and returns 0. Every other rc 2 keeps `[[ -n $force ]] || return 5`.
  - No other branch changes: the stay-at-home branch's `return 5`, the cur-still-works branch, and the loop's pass-1 `unmeas` skip.
- Modify tests: `server/test/ccd-swap-target-class.test.ts` (new rows beside "away from home: the home-recovered gate and the cur-still-works gate"), `server/test/ccd-limits.test.ts` (the helper's rows beside "_limit_field rollover").

- [ ] **Step 0: Re-ground**; rule 6; confirm that a fable share's staleness reaches the gate as `_serviceable`'s `stale` (rc 2) and that a five-hour-ended home with a measured seven already reads servable (no change needed).
- [ ] **Step 1: Characterization commit** (green on D-6181's tip): "today:" an `opus` session on lane-x, home's seven 40 with `sevenResetAt` passed → rc 5 (`classwindow`); the same with home's five also ended → rc 5. "kept:" home's seven 40 and reset in the future → home; home's seven 99 → stays on lane-x; home's limits file missing → rc 5; home's seven present with no `sevenResetAt` and older than 7 d → rc 5; a `fable` session with a stale share → rc 5; a forced (rescue) call with every candidate unmeasured → rc 5; a session on home whose seven ended → rc 5 (stay); no class → today's byte-identical answers ("no class: byte-identical to today").
- [ ] **Step 2: Red.** "_limit_window_ended answers 0 only for a present value past its reset"; "a missing file, field or reset answers 1"; "an opus session parked off home goes home once home's weekly window has ended"; "the move is an affinity move through the stagger" (the tick-level row: four parked sessions, one home reset, one dispatch); "a fable session with a stale share stays undecidable"; "the forced path is unchanged"; "the off marker restores rc 5".
- [ ] **Step 3: Green, in commits.** (1) the helper, unused; (2) **the behaviour commit**: the gate. The PR body lists the before/after rows and cites D3's ruling.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | "ended" true when the reset is missing | ccd-limits | "a missing file, field or reset answers 1" |
  | the ended reading applied on the forced path | ccd-swap-target-class | "kept: a forced call with every candidate unmeasured → rc 5" |
  | the ended reading applied to `fable` | ccd-swap-target-class | "a fable session with a stale share stays undecidable" |
  | the ended reading applied to the stay-at-home branch | ccd-swap-target-class | "kept: a session on home whose seven ended → rc 5" |
  | the move bypasses the stagger | ccd-affinity-stagger | "four parked sessions, one home reset, one dispatch" |
  | the marker ignored | ccd-swap-target-class | "the off marker restores rc 5" |

- [ ] **Step 5: Verify** `ccd-swap-target-class.test.ts`, `ccd-limits.test.ts`, `ccd-limit-stale.test.ts`, `ccd-serviceable.test.ts`, `ccd-affinity-stagger.test.ts`, `ccd-rescue-policy.test.ts`, `ccd-tick-budget.test.ts`, one at a time.

**Exit (GATES):** an ended home window no longer freezes the return home; every other unmeasured case still decides nothing; returns staggered. **After deploy:** OA-S2 (`classwindow` episodes on a return home, and their length). **Rollback:** `$REG/swap-home-ended-off`; `git revert`.

### Task D-6183: non-Anthropic lanes rank after every Anthropic account with room (spec §3.5; D1) — GATED: after D-6182; OA-S3

**Routing:** **band 3, native** (it changes where every rescue and ceiling-leave lands). Two reviewers: one reads only Review focus 1, 3, 4 and 5 (the swap-safety focus); one checks the before/after rows against D1's ruling and the readings in spec §6.1. **Lane:** ccd. **Needs:** D-6182 merged and deployed; OA-S3 green.

**Files:**
- Modify `ccd/ccd` `_swap_target`'s candidate loop: home-able candidates split into `best` (`_is_anthropic_backend "$cand"` and not auth-dead) and a new `nbest` (every other home-able candidate: non-Anthropic lanes, and auth-dead accounts at 101), each by lowest score as today; the answer is `best`, else `nbest`, else `obest`, else rc 1. Both passes use the buckets; the `break` after a pass that found anything reads all three. With `$REG/swap-overflow-rank-off` present, `nbest` folds into `best` (today's single bucket, by score).
- No change to `_rescue_target` (its spread and no-bounce passes call `_swap_target` and inherit the buckets), `_limit_score`, `_avail`, `_is_anthropic_backend` or the non-Anthropic `five` 100 stamp.
- Modify tests: `server/test/ccd-swap-overflow-rank.test.ts` (new), `ccd-rescue-policy.test.ts` (rows under "rule 3: spread, no bounce, and the chain wait"), `ccd-backend-vs-placement.test.ts` (one row: the roster fallback).

- [ ] **Step 0: Re-ground**; rule 6; confirm `_ws_least_loaded`, `_place_for_class` and `projectHome` are untouched (K15's `projected-home.test` stays green unmodified).
- [ ] **Step 1: Characterization commit** (green on D-6182's tip): "today:" a rescue with lane-x (home-able, non-Anthropic, seven 2, `fiveWindowMinutes` 0) and account-a (Anthropic, five 30, seven 40) → lane-x; the same with account-a unmeasured (100) → lane-x; a ceiling-leave from home at five 98 with the same candidates → lane-x; a burst of three rescues with spread → lane-x on the second or third. "kept:" only lane-x has room → lane-x; account-a auth-dead and lane-x → lane-x; a non-home-able candidate is taken only when no home-able one is; a class session with only seven-ended Anthropic candidates and lane-x servable → lane-x (pass 1's skip unchanged); no candidate → rc 1 and the strand.
- [ ] **Step 2: Red.** "an Anthropic candidate with room beats a lower-scored non-Anthropic lane"; "an unmeasured Anthropic candidate beats a non-Anthropic lane"; "an auth-dead Anthropic account ranks after a non-Anthropic lane"; "the ceiling-leave ranks the same way"; "a burst spreads across Anthropic accounts before it overflows"; "with no CCRC_ANTHROPIC_BACKEND declared the ranking is today's"; "the off marker restores one bucket"; "the auto-rescue line says lane=anthropic".
- [ ] **Step 3: Green, in commits.** (1) **the behaviour commit**: the buckets and the marker. The PR body lists the before/after rows and cites D1's ruling and spec §6.1's reading of "with room".
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `_is_home_able` used for the bucket | ccd-swap-overflow-rank | "an Anthropic candidate with room beats …" |
  | auth-dead kept in `best` | ccd-swap-overflow-rank | "an auth-dead Anthropic account ranks after a non-Anthropic lane" |
  | only measured Anthropic candidates in `best` | ccd-swap-overflow-rank | "an unmeasured Anthropic candidate beats a non-Anthropic lane" |
  | `nbest` dropped (non-Anthropic never chosen) | ccd-swap-overflow-rank | "kept: only lane-x has room → lane-x" |
  | pass 2 without buckets | ccd-swap-overflow-rank | a degraded-class row |
  | the fallback inverted (undeclared → non-Anthropic) | ccd-backend-vs-placement | "with no CCRC_ANTHROPIC_BACKEND declared the ranking is today's" |

- [ ] **Step 5: Verify** `ccd-swap-overflow-rank.test.ts`, `ccd-rescue-policy.test.ts`, `ccd-swap-target-class.test.ts`, `ccd-backend-vs-placement.test.ts`, `ccd-auto-swap-pool.test.ts`, `ccd-authdead.test.ts`, `projected-home.test.ts`, `ccd-tick-budget.test.ts`, one at a time.

**Exit (GATES):** a non-Anthropic lane is chosen only when no Anthropic home-able account passes the gates; eligibility unchanged; placement unchanged. **After deploy:** OA-S2 (landings by `lane=`; rescues per session per hour). **Rollback:** `$REG/swap-overflow-rank-off`; `git revert`.

### Task D-6184: a session on a non-Anthropic lane moves sideways to an Anthropic account with measured room (spec §3.6; D2) — GATED: after D-6183; #1050 merged or closed

**Routing:** **band 3, native.** Two reviewers: one reads only Review focus 1 to 5 (the swap-safety focus); one checks home affinity and the pool rule. **Lane:** ccd, plus one additive word in `shared/api.ts` (server lane, deployed after the agent lane as every release) and one in `deploy/measure-working-state.py`. **Needs:** D-6183 merged; #1050 merged or closed; W1's OA-S2 readings.

**Files:**
- Modify `ccd/ccd`:
  - Extract the loop's per-candidate gates into one predicate `_swap_cand_ok <cand> <cur> <pps> <cls>` (skip list, `_pool_ok`, `_account_ok`, `_avail`, `_class_gate` rc), used by the loop unchanged (a refactor commit, byte-identical answers).
  - `_swap_target`, the non-forced branch for a session not on home, after the home-recovered gate and before the cur-still-works gate: when `CCRC_ANTHROPIC_BACKEND` is declared, `_is_anthropic_backend "$cur"` fails, `$REG/swap-sideways-off` is absent, and some home-able Anthropic candidate passes `_swap_cand_ok` with class gate rc 0, is not auth-dead, and has a non-empty `_limit_score` below `SWAP_CEILING`, echo the lowest-scored one and return 0. `.home` is never written.
  - `_auto_swap_check`: the affinity dispatch whose target is neither home nor chosen by a forced pass logs `auto-sideways` (not `auto-home`) and passes the arm word `sideways` to `_dispatch_swap`; the stagger (D-6181) is keyed on the target for this move too.
  - `_swap_end_cause` maps `sideways` to `swap-auto-sideways`; `_resume_prompt_for` gains its words ("an automatic account swap to an account with room; its home account is unchanged").
- Modify `shared/api.ts`: the end-cause word map gains `'swap-auto-sideways'` (additive; Step 0 measures how an unknown cause renders today, so the order of deploys is safe either way).
- Modify `deploy/measure-working-state.py` `DECISION_VERBS`: `auto-sideways`.
- Add `server/test/ccd-swap-sideways.test.ts`; modify `ccd-swap-target-class.test.ts` (the away-from-home rows) and the end-cause and resume-prompt suites Step 0 names.

- [ ] **Step 0: Re-ground** on #1050's merged `_swap_idle_gate`; rule 6 for #998; name the end-cause and resume-prompt suites; measure an unknown cause's rendering.
- [ ] **Step 1: Characterization commit** (green on the base of this PR): "today:" a session on lane-x, home at seven 99, account-a (Anthropic, five 20, seven 30, both measured) → stays on lane-x. "kept:" home recovered → home; the session on account-b (Anthropic), home blocked → stays; on lane-x with only unmeasured Anthropic candidates → stays; a candidate outside the project's pool → not offered; a pinned session → `pin-hold`; `.hold` → no move; mid-turn → no move (`_swap_idle_gate`); a hard-blocked session → the rescue as today.
- [ ] **Step 2: Red.** "the refactored loop answers byte-identically" (the whole of `ccd-swap-target-class` and `ccd-swap-overflow-rank` green); "a session on lane-x with home blocked moves to the Anthropic account with measured room"; "the lowest measured score wins"; "an unmeasured or class-unmeasured candidate is never chosen"; "a candidate outside the pool is never chosen"; "home is unchanged after the move"; "once on an Anthropic account the session does not move sideways again"; "the return home fires when home recovers"; "the move logs auto-sideways and ends swap-auto-sideways"; "the resume prompt names the sideways cause"; "the stagger is keyed on the target"; "the off marker restores staying put"; "with no CCRC_ANTHROPIC_BACKEND declared nothing moves sideways".
- [ ] **Step 3: Green, in commits.** (1) `_swap_cand_ok` (refactor, no behaviour change); (2) the end-cause word, the resume words and the measurement verb; (3) **the behaviour commit**: the branch and the dispatch word. The PR body lists the before/after rows and cites D2's ruling.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `.home` rewritten to the target | ccd-swap-sideways | "home is unchanged after the move" |
  | the branch fires on an Anthropic `cur` | ccd-swap-sideways | "once on an Anthropic account the session does not move sideways again" |
  | an empty score accepted | ccd-swap-sideways | "an unmeasured … candidate is never chosen" |
  | class gate rc 2 accepted | ccd-swap-sideways | the same row |
  | `_pool_ok` skipped | ccd-swap-sideways | "a candidate outside the pool is never chosen" |
  | the branch placed before the home-recovered gate | ccd-swap-sideways | "the return home fires when home recovers" |
  | the dispatch skips `_swap_idle_gate` | ccd-swap-sideways | "kept: mid-turn → no move" |
  | the refactor reorders a gate | ccd-swap-target-class | its existing rows |

- [ ] **Step 5: Verify** `ccd-swap-sideways.test.ts`, `ccd-swap-target-class.test.ts`, `ccd-swap-overflow-rank.test.ts`, `ccd-swap-pin.test.ts`, `ccd-swap-guards.test.ts`, `ccd-auto-swap-pool.test.ts`, `ccd-affinity-stagger.test.ts`, `ccd-tick-budget.test.ts`, the end-cause and resume-prompt suites, one at a time; then `cd server && ./node_modules/.bin/tsc --noEmit`.

**Exit (GATES):** no live supervised session stays on a non-Anthropic lane past an idle boundary while an Anthropic account in its pool has measured room; home unchanged; no bounce. **After deploy:** OA-S2 (`auto-sideways` lines; parks on non-Anthropic lanes). **Rollback:** `$REG/swap-sideways-off`; `git revert` (the end-cause word stays, unused).

### Task D-6185: the keepalive produces a real measurement, and a heartbeat is never "occupied" (spec §3.7; D7) — GATED: after D-6180; OA-S4 before the behaviour commit

**Routing:** **band 3, native** (a credentialed spend path). Two reviewers: one reads only the credential and herd rules (Global constraints: no herd; the keepalive's lock; credentials never in argv or echoed); one checks the occupancy change against D7's ruling. **Lane:** the keepalive (agent lane: `ccd/ccd-telemetry-keepalive`, installed with ccd). **Needs:** D-6180 merged; OA-S4's source measurement in the PR body.

**Files:**
- Modify `ccd/ccd-telemetry-keepalive`:
  - `_ka_session_on`: the supervisor-heartbeat answer no longer returns "occupied". An account reads occupied when a session on it is mid-turn (its Claude Code status reads busy; Step 0 names the reader ccd uses for that, e.g. the status file under the session's config dir), or when its pane is live with no fresh supervisor (unchanged), or unmeasurable (unchanged, fail shut). `$REG/keepalive-heartbeat-occupied` restores the heartbeat rule.
  - `_ka_turn` and the re-measurement after it: the source OA-S4 found (spec §3.7 (a), (b) or (c), smallest first). Whatever it is, the account's limits file is written only through `ccd/statusline-command.sh`'s own path (never a second writer), and a turn that yields no `rate_limits` is `no-render` as today. Source (c), if chosen, runs on a private tmux socket and is torn down before the pass moves to the next account.
- Modify tests: `server/test/telemetry-keepalive.test.ts` (rows under "the three skips — a keepalive is for the idle case only" and "the turn, and the re-measurement that judges it"), `keepalive-freshness-parity.test.ts` (the occupancy parity with `_session_state`).

- [ ] **Step 0: Re-ground**; read OA-S4's result into the PR body; if no source yields `rate_limits`, **stop before the behaviour commit** and report (the occupancy change may still land alone, as its own PR, with the coordinator's departure from 6186).
- [ ] **Step 1: Characterization commit:** "today:" an account whose only session is idle with a fresh heartbeat → `skipped` (occupied); a turn that exits 0 → `no-render`. "kept:" an account whose limits file is fresher than `CCRC_KEEPALIVE_FRESH` → `skipped`; a live pane with no heartbeat → `skipped`; an unmeasurable pane → `skipped` (fail shut); the backoff after failures; one account per pass at a time under the lock; the credential never in argv.
- [ ] **Step 2: Red.** "an idle session's heartbeat does not make its account occupied"; "a mid-turn session does"; "the off marker restores the heartbeat rule"; "a turn through the measured source advances the limits file through the statusline writer and reads refreshed"; "a source with no rate_limits reads no-render"; "two accounts are never turned at once"; "the private socket is not the fleet's tmux server" (source c only).
- [ ] **Step 3: Green, in commits.** (1) **the behaviour commit**: occupancy; (2) **the behaviour commit**: the source. The PR body lists the before/after rows and cites D7's ruling.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the heartbeat still read as occupied | telemetry-keepalive | "an idle session's heartbeat does not make its account occupied" |
  | busy not read | telemetry-keepalive | "a mid-turn session does" |
  | the limits file written directly | telemetry-keepalive | "… through the statusline writer …" |
  | the lock skipped | telemetry-keepalive | "two accounts are never turned at once" |
  | the unmeasurable pane read as clear | telemetry-keepalive | "kept: an unmeasurable pane → skipped" |

- [ ] **Step 5: Verify** `telemetry-keepalive.test.ts`, `keepalive-freshness-parity.test.ts`, `ccd-limits.test.ts`, one at a time.

**Exit (GATES):** idle accounts are turned and measured; no heartbeat skip; one account at a time; one writer. **After deploy:** OA-S5. **Rollback:** `$REG/keepalive-heartbeat-occupied` (occupancy); the keepalive's pass switches; `git revert`.

## Operator acts in this programme

Every act below reads or changes the fleet box; none is done by a worker or a session.

- **OA-S1 (before D-6180 merges): the baseline.** Read-only, over the last 7 days of the swap log, the registry, the lifecycle journal and the limits files, with the same queries as spec §1.1: manual swaps (a `swap` line with no `dispatch` before it, and the journal's `cg`), of those the moves off a non-Anthropic lane; automatic moves by target backend; `classwindow` lines; pins standing and `pin-hold` lines; limit rows in transcripts with no swap-log line within 10 minutes; keepalive outcomes. Aggregate counts only go in the PR body.
- **OA-S2 (after each W1 deploy, and after D-6184): the reading.** The same queries after 48 hours of the change, plus that change's new lines (`stand-down` by reason and evidence; `pin-expired`, `stand-down stagger`; `classwindow` episodes on a return home and their length; `lane=` landings; `auto-sideways`). The next W1 PR is dispatched only after this reads as spec §8 expects, or the operator says otherwise.
- **OA-S3 (before D-6183 merges): the roster projection.** `ccrc doctor`'s routing check passes on the fleet box (the projection declares `CCRC_ANTHROPIC_BACKEND`, and every GPT-backed lane is outside it). If it does not, the projection is regenerated first; otherwise D-6183 changes nothing on that box.
- **OA-S4 (before D-6185's behaviour commit): the source measurement.** On one idle account, run each candidate source of spec §3.7 once by hand and record whether it yields `rate_limits` (yes or no only; no credential, account name or figure leaves the box).
- **OA-S5 (after D-6185 deploys): the census.** The keepalive census shows `refreshed` for idle accounts within `CCRC_KEEPALIVE_FRESH`, and no limits file of an enabled account is older than a day.
- **Markers (any time):** writing or removing `$REG/swap-pin-expiry-off`, `$REG/swap-home-ended-off`, `$REG/swap-overflow-rank-off`, `$REG/swap-sideways-off` or `$REG/keepalive-heartbeat-occupied` is the operator's no-deploy rollback. The ccrc SAFETY rules forbid sessions these writes; a coordinator names that rule when it asks the operator to do one.
- **The deploys** follow the standing rule: from a fresh `origin/main` worktree as a detached unit, verified from its log, agent lane before server lane. No session restarts.

## Acceptance

Every PR body carries: the characterization commit's name; the before/after rows of each behaviour commit with its ruling cited (spec §6.1); the mutation table's red test names; the rule 6 check (each edited file, each open PR holding it, its hunks; #1050 named for every `ccd/ccd` task); the tick-budget suite's result; the off marker and its pin (D-6181 to D-6185); and the operator act's figures where its task names one (D-6180: OA-S1; D-6183: OA-S3; D-6185: OA-S4). Band 3 PRs carry both reviewers' verdicts. Spec §8's "Target after W1" column is measured by OA-S2 after D-6183 has run 7 days; "after W2" after D-6184 and D-6185 have.

## Rollback

Each task is a revert of its PR, newest first. Zero-deploy brakes: the five markers (§Operator acts). D-6180 has no marker (it changes no decision). After a revert of D-6181, pin values in the new form still match (the first word); after a revert of D-6184, the end-cause word stays, unused.

## Deviations and decisions

### Issued for this work and defined here

The orchestrator issued this programme the block 6180 to 6189 from the ledger. This plan defines D-6180 to D-6185, one per task.

- **D-6180** — `swap-standdown-logged` (Task D-6180; spec §3.2, D5): every place the auto-swap holds a session that has evidence of a limit (the two cooldowns, the hard-block stand-down words, the rescue's dropped target, and the affinity arm's `.hold`, `.woke` and idle-gate exits when ccd had a target) writes one `stand-down` swap-log line per episode with its evidence and whether the banner was visible only outside the pane's tail, re-logged after `COMPACT_NOTE_FLOOR`; a carried-in transcript row reads `carried-in`, not `negative`; `tick-undecidable` re-logs at the same floor; decision lines carry `lane=anthropic|overflow`. No decision changes, and the steady-state tick gains no fork.
- **D-6181** — `swap-pin-expires` (Task D-6181; spec §3.1, §3.3, D4): a manual-swap pin records an expiry, the next reset of the home window that was blocked when it was set, bounded by `SWAP_PIN_TTL` (24 h), or 24 h when none was; it ends at that expiry (`pin-expired`), never holds a session on an account that fails `_avail`, and a legacy pin expires 24 h after the first tick that reads it. An automatic return to a session's home is taken at most once per `HOME_RETURN_SPACING` (180 s) per home account, by an exclusive create; the rescue never reads it. Off marker `swap-pin-expiry-off`.
- **D-6182** — `swap-home-ended-servable` (Task D-6182; spec §3.4, D3): on the non-forced return home only, a home whose seven-day figure is present and past its `sevenResetAt` is servable for a non-`fable` class, so the session goes home through the idle gate and D-6181's stagger instead of freezing at `classwindow`; every other unmeasured case, and the forced path, decide as before. Off marker `swap-home-ended-off`.
- **D-6183** — `swap-overflow-rank` (Task D-6183; spec §3.5, D1): in `_swap_target`'s candidate loop an Anthropic home-able candidate that is not auth-dead and passes every gate ranks ahead of every non-Anthropic home-able lane and every auth-dead account, each bucket by `_limit_score` as before (unmeasured 100); with `CCRC_ANTHROPIC_BACKEND` undeclared the ranking is today's. Off marker `swap-overflow-rank-off`.
- **D-6184** — `swap-sideways` (Task D-6184; spec §3.6, D2): a session on a non-Anthropic lane whose home cannot take it moves, as an affinity move (pin, hold, wake cooldown, idle gate, jitter and the per-target stagger), to the home-able Anthropic account with the lowest fully measured score below `SWAP_CEILING` that passes the loop's gates through one shared predicate; `.home` is unchanged, the move logs `auto-sideways` and ends `swap-auto-sideways`. Off marker `swap-sideways-off`.
- **D-6185** — `keepalive-measures` (Task D-6185; spec §3.7, D7): the keepalive counts an account occupied only when a session on it is mid-turn (or its pane is live with no supervisor, or unmeasurable), never for a supervisor heartbeat alone, and its turn advances the limits file through the statusline writer from the source OA-S4 measured, one account at a time under its lock. Off marker `keepalive-heartbeat-occupied` for the occupancy rule.

Issued and unused: 6186, 6187, 6188, 6189. They are held for this programme's departures, entered by the coordinator only, and never defined outside this plan.

## Out of scope

D6 (no revival on another account; #199 stands); the narrow-pane gate (decided after D-6180's counts, spec §5.3); the rescue loop's pass-1 skip of seven-ended candidates (a later question, spec §5.3); a detection change for the rate-limit dialog (a K8 corpus row, after D-6180's `banner-outside-tail` counts); restoring `lastswap` on `cmd_swap`'s pre-stop `die` paths; #382's off switch; #998's stale pool lease; new-session placement (`_ws_least_loaded`, `_place_for_class`, `projectHome`); any server, agent or PWA change beyond D-6184's one end-cause word.

## Review log

**rev 0 (2026-10-21).** Written from the spec's rev 0 after the operator's 2026-10-21 ruling, measured on `origin/main` `d8cd47658` with 29 open PRs (#1050, #1054 and #1038 hold `ccd/ccd`; #960 holds `ccd-swap.test.ts`; #435 merged).
