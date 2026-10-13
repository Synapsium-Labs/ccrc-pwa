# Supervisor tick diet: one observation per tick, no subshell on the hot path (design)

**Status:** DRAFT rev 1 — for operator review on #387. No review lens has read it yet. The issue promises that the design is posted there before any code lands.
- **Rev 1 (2026-10-13)** does four things to the rev 0 draft written for #387, which is not in the tree:
  - it replaces every placeholder with a number the ledger issued, and defines each one (D-4960 to D-4966, §13);
  - it records the operator's three rulings of 2026-10-13, among them the tick memo, which is ruled behaviour-unchanged with `TICK_MEMO_MAX_MS=1000` (§2);
  - it places this diet as stages 1 and 2 of plan D, with the event-gated fleet observer staged behind it under its own spec and a stop rule after W4 (§3);
  - it takes W4's prefilter literals from the single shared set, D-4967, which the observer spec defines and W4 depends on (§6.6). Rev 0's bare `limit` is gone.
  - it folds in the measured refinements of the W1–W3 plan (`docs/superpowers/plans/2026-10-13-supervisor-tick-diet-w1-w3.md`, P1–P9), which land with this spec: D-4960 primes the `-k` cache through `_plat_timeout` itself (§6.2); the builtin reads run under a scoped `LC_ALL=C` and the limits fast path also needs a regular, readable file under 64 KiB (§6.3, §6.4); three swap-path reads stay as they are and the route chain gains a fifth out-var form (§6.4); an eighth budget fixture (§9); and the plan, not each wave's, is the ledger home of all thirteen numbers (§13). The operator confirms them with the plan (§12).
- **Citations** are to `origin/main` `0d0ea592`. `ccd/ccd` and `ccd/ccrc` there are byte-identical to `6b939bd4`, where the investigations measured (measured: `git diff --stat 6b939bd4 0d0ea592 -- ccd/ccd ccd/ccrc` is empty). Line numbers are hints, written `≈:`. Every citation also names its function or constant.
- **Measurements** come from read-only investigations of #387:
  - a container replay with real tmux 3.4 and bash 5.2.21 under `strace -f`;
  - a live sampler on the fleet box that used shell builtins only, reading cgroup `cpu.stat` and `/proc`;
  - a replay of real registry rows;
  - for §3, a tmux 3.4 control-mode spike and a prototype observer, both in a container and never on the fleet box.

  **[M]** marks a measured figure and **[I]** an inferred one.

**Date:** 2026-10-13 · **Branch:** `ws/supervisor-tick-diet` (from `origin/main` `0d0ea592`)

**Related:**
- #387, the issue.
- `docs/superpowers/specs/2026-10-13-event-gated-fleet-observer-design.md`, the fleet observer: stage 3 of plan D, written in parallel with this spec. It defines D-4967 to D-4972.
- `docs/superpowers/plans/2026-10-13-supervisor-tick-diet-w1-w3.md`, stage 1's plan. It carries the ledger entries of all thirteen numbers (§13).
- #189, open. It rewrites `_sync_uuid` and keeps its walk state per process (§11, §12 O4).
- #358, the loop's `unknown` arm; not touched here.
- #382, an off-switch read in `_auto_swap_check`; one line.
- #388, `CPUWeight` for the session slice; complementary.
- #390, the server's per-row fleet polling. It could consume the observer's output; it does not consume this diet's.
- #270, the supervision backend; still compatible.
- `2026-08-12-swap-transcript-defect-family-design.md` §4.2, the heartbeat contract.
- `2026-08-19-substrate-unreachable-design.md`, D-310's verdict-driven loop.
- `2026-09-10-limit-recovery-followups-design.md`: D-2443 (the stale check runs before swap) and D-2444 (the transcript arm's 30 s cache).

## In short

- **Every `claude-session@<id>` unit runs `ccd supervise <id>`, which loops every 5 s.**
  - On a 16-vCPU fleet box with 55 sessions, those loops use 3.84–4.10 cores, 83–88% of it kernel time [M].
  - The cost is process creation: about 179 forks and 85 execs per idle tick, and each fork copies a 16 MB bash [M].
  - Deciding what to do costs almost nothing.
- **This design keeps:**
  - the unit model;
  - the loop, with `tick=5`;
  - every gate, in its order;
  - every on-disk format.
- **It changes how each tick reads its inputs:**
  - shell builtins replace `$(cat|grep|head|cut)`, `$(date)` and `$(func)`;
  - each tick makes one `list-panes` and one `capture-pane` instead of five and three;
  - a builtin fast path answers only where it provably equals today's pipeline, and today's code answers everywhere else.
- **Target:** at most 12 forks and 5 execs per idle tick. That is about 0.3–0.5 cores for the fleet [I]. With the transcript-arm gate (stage 2a) it is about 0.16–0.27 [I].
- **Where it sits.** The operator chose plan D on 2026-10-13: this diet now, as stages 1 (W1–W3) and 2 (W4, then 2a), and the event-gated fleet observer staged right behind it under its own spec.
  - The diet cuts what one evaluation costs. The observer cuts how often one runs. Neither replaces the other (§3).
  - Once W4 is measured, a stop rule decides whether the observer goes past its off-fleet build.

## 1. The problem, measured

**Fleet cost [M]** (55 active units, two windows of 23.5 s and 29.7 s):

| | Run 1 | Run 2 |
|---|---|---|
| Supervisor cores, all units | 4.10 (25.6% of the box) | 3.84 (24.0%) |
| Kernel share of supervisor CPU | 83–88% | 83–88% |
| Box forks/s (`/proc/stat processes`) | 2,227 | 2,316 |
| Box idle | 0.5% | 1.1% |

- Children account for 92–95% of each unit's CPU. The main bash process itself used 0.08–0.19 s per 23.5 s window.
- The real tick period is 5.7–6.8 s, not 5.
- CPU per tick is 0.35–0.50 s.
- Idle and busy sessions cost the same: 0.065 and 0.066 cores.
- A session searching for a swap target cost about 2.6 CPU-s per tick, about 5× a normal tick.
- Supervisors never re-exec. The 2.4 MB body is parsed once per supervisor start (about 55 ms) and never again per tick.

**Forks per tick [M]** (container replay; real tmux; an idle session at home, outside cooldowns):

| Function (≈ line) | Forks / execs | Main sources |
|---|---|---|
| loop (≈:23061–23089) | 3 / 3 | `date` ×2, `sleep` |
| `_session_probe` (≈:2905) | 9 / 4 | `$(type -t tmux)`; `$(_tmux_t)` is 2 forks; the `_plat_timeout` `-k` probe re-run every tick (3 forks), because its cache (≈:576–580) is set inside the `$( )` at ≈:2926 and dies with it (D-4960) |
| `_sync_uuid` (≈:15849) | 14 / 7 | `$(_cfg_dir "$(_reg_get …)")`, `list-panes\|head`, `grep\|head\|cut` |
| `_auto_stale_check` (≈:17067) | 12 / 5 | `_pane_measurable`, `capture\|tail`, two greps |
| `_auto_swap_check` (≈:17318) | **96 / 53** | `_swap_target` deciding to "stay home": 9 `_limit_json_num` calls (`grep\|head\|grep`), 3 `date` |
| `_auto_compact_check` (≈:18539) | 26 / 11 | `_pane_measurable`, `_pane_for_keystroke`, `_pane_ctx_pct` (awk + 3 greps) |
| `_route_apply_check` (≈:20232) | 19 / 4 | 15 nested subshells in `_route_peek`, `_route_wanted` and `_route_pending_word` |
| **Total** | **179 / 85** | 94 of these forks never exec anything |

Other measured cases: a busy session costs 175 forks; away from home with home over the ceiling, 207; inside `SWAP_COOLDOWN`, 103.

**Execs by purpose [M]:**

| Purpose | Execs |
|---|---|
| Limits JSON | 30 |
| Pane classifiers | 22 |
| Registry `cat` | 15 |
| tmux and `timeout` | 12 |
| `date` | 5 |

**Redundant work in one tick [M]:**
- `_pane_measurable` runs 4× for one `#{pane_active} #{pane_width}` answer.
- The same pane is captured 3×: in `_auto_stale_check` (≈:17078), `_auto_swap_check` (≈:17621) and `_pane_for_keystroke` (≈:18435).
- `list-panes` runs 5×.
- `_tmux_t` is called about 9×, at 2 forks each, for a constant string.
- `date +%s` runs 8×.

**Fork cost on the box [M]** (CPU per operation, bash heap of 16–20 MB):

| Operation | CPU |
|---|---|
| `$(:)` | 1.33 ms |
| `$(/bin/true)` | 1.96 ms |
| `$(echo x\|head -1)` | 4.43 ms |

At a 3.5 MB heap, `$(:)` costs 0.58 ms on the box; in an unloaded container, with ccd sourced, it costs 0.48 ms. Model check [I]: 98 × 1.33 + 86 × 2.0 ≈ 0.30 CPU-s per tick, which matches the measured 0.35–0.50.

**Why it matters.** CPU pressure on the box sat at 40–80% (`some`). The units share `app-claude-session.slice` with the panes they supervise.

## 2. The operator's rulings (dated)

| Date | Words | What it settles |
|---|---|---|
| 2026-10-13 | "Also do the structural supervisor rework, that seems pretty key" | #387 is built, not parked. "Structural" is read as two things. Inside each supervisor, the tick changes shape: it observes once, decides in-process and acts only on fresh evidence (this spec). Across the fleet, one observer decides when each tick runs (the observer spec). Folding the 55 loops into one process is rejected with numbers (§3.7). |
| 2026-10-13 | "Diet now + observer staged (Recommended)" | Plan D (§3): stages 1–2 are this diet; the observer is stage 3, behind it; a stop rule follows W4's measurement. |
| 2026-10-13 | "Yes, 1000 ms (Recommended)" | The tick memo (D-4964) counts as behaviour-unchanged under the terms in §6.5, and `TICK_MEMO_MAX_MS=1000`. |

Every other decision this spec needs is still open and listed with its recommendation in §12.

## 3. Where this sits: plan D

### 3.1 Two factors, and which one each piece cuts

Supervisor CPU is evaluations per second × cost per evaluation. A supervisor waiting in `sleep` or in a builtin `read` uses no CPU, and 92–95% of the cost is in the children an evaluation forks [M]. So:

- the **diet** cuts the cost of each evaluation, from 179 forks to at most 12;
- the **observer** cuts how often a quiet session is evaluated: from every 5 s to a 30 s safety tick plus an early tick on the events that matter;
- **folding** 55 loops into one process cuts neither. A fork costs the same whichever process makes it.

| Option | Supervisor cores, 55 sessions | vs today's 3.84–4.10 [M] |
|---|---|---|
| Observer only, no diet | 1.05–2.1 [I] | −48% to −74% |
| Diet only (W1–W4) | 0.3–0.5 [I] | −88% to −92% |
| Diet + transcript-arm gate (2a) | 0.16–0.27 [I] | −93% to −96% |
| Both: observer gating busy rows too, diet, 2a | 0.08–0.19 [I] | −95% to −98% |

Every inferred figure in this table rests on one assumption: that the post-diet idle tick costs 0.03–0.05 CPU-s. Nobody has measured that. W4's measurement replaces it, and the stop rule (§3.6) reads that measurement.

### 3.2 The stages

| Stage | Content | Effort [I], route | Exit or measure |
|---|---|---|---|
| 0 (now) | This spec, the observer spec and the W1–W3 plan, posted to #387. D-numbers issued and defined in that plan. The literal set D-4967 defined once. The open decisions put to the operator (§12). | 1.5–2 agent-days, native | Both specs approved |
| 1 | Diet W1 (harnesses red against `main`, D-4960, D-4961), W2 (D-4962), W3 (D-4963). Each deployed agent-first and measured. | 3–4, about half handoff | About 1.7 cores after W3 [I]; behaviour canary clean |
| 2 | Diet W4 (D-4964, D-4965, consuming D-4967), then 2a (D-4966). | 2–3, mostly native | 0.3–0.5 cores, then 0.16–0.27 [I]; the post-diet per-tick cost measured |
| 3a (overlaps 2; no fleet contact) | The observer is built and soaked away from the fleet (observer spec). | 8–9, about 45% handoff | Soak passes |
| 3b | The observer in shadow on the fleet; the supervisors are unchanged. Only after the stop rule (§3.6) and the operator's approval of the attach. | 1, native ops, over 3–7 calendar days | The observer spec's shadow gate |
| 3c | The observer's flips: Flip-1 (idle rows), then Flip-2 (busy rows) only if the shadow shows zero late pane-rung actions. | 1, native ops, about 1–2 calendar weeks | 0.08–0.19 cores [I]; latency gains confirmed |
| 4 (separate spec) | #390 reads the observer's fleet state. | 3–4 | — |

Totals [I]: the diet is about 6–8 agent-days and takes about 90% of the CPU win within about 1–1.5 calendar weeks. The observer is about 12–15 agent-days, with its first flip about 3–4 weeks out. Together, about 19–23.

### 3.3 Why the diet is needed under the observer too

1. **Every evaluation that still runs.** That covers quiet rows' safety ticks, triggered ticks and, above all, armed rows, which tick every 5 s by contract. The 2.6 CPU-s searching row is pure limits-JSON forking inside `_swap_target`'s candidate loop, which the observer cannot touch.
2. **The cliffs.**
   - **One account hits its limit.** All of its sessions become armed at once. With 8 such rows that is about +2.4 cores before the diet and about +0.15 after it [I], and it happens exactly when the rescue matters.
   - **The observer goes down.** Every supervisor falls back to `sleep 5`. Without the diet the fleet is back at 3.84–4.10 cores within 15 s; with it, at 0.3–0.5.

   The diet makes the observer's failure modes cheap. The observer only makes the average case cheap.
3. **Herds the observer does not schedule.** `ccrc update`'s sweep restarts all 55 supervisors at once. Each restart runs the pre-flight probe, `cmd_ensure` and a first tick. A mass swap does the same.
4. **Callers outside the supervisor** use the same fork-heavy helpers: `cmd_swap` (≈:25441) through `_swap_target` and `_limit_field`, `_alive` (≈:2986) and its callers, `cmd_ls` through `_session_state` (≈:4206), and the doctor.
5. **The transcript arm.** Under the observer's 30 s safety tick, every quiet tick misses its 30 s cache (§7.1), so 2a matters more under plan D, not less.

### 3.4 What the observer buys that the diet does not

- **Latency [I].** Session death, the stale-limit Enter, route apply and uuid sync are noticed in about 1 s instead of up to 6.8 s. The container measured 2–9 ms for tmux notifications and a 1 s subscription timer.
- **tmux load [I].** About 7 supervisor requests per second into the single tmux server, against about 32 after the diet alone and about 83 today.
- **One fleet state** that #390, #358 and #270 could read.

Its extra CPU saving at 55 sessions, once the diet and 2a are in, is about 0.1 cores [I]. Its case is latency and a shared fleet view, not CPU.

### 3.5 Where the two touch

- **The loop lines** (`cmd_supervise`, ≈:23061–23089). W1 edits the clock reads and the pre-loop. W4 adds one line. The observer's wait (wake routing, D-4972) replaces `sleep "$tick"` (≈:23089) in the live arm only, and adds real-seconds beat accounting under its safety tick (D-4969). **W1 lands first.** The observer's change is about 15 lines and rebases on it.
- **The clock seam.** `_now_s` (D-4961) is the clock the observer's freshness test reads, so a test's `date` stub is honoured on both paths.
- **The literal set, D-4967.** It is defined once in ccd and consumed by W4's prefilters (D-4965) and by the observer's in-server pane search. **W4 depends on it** (§6.6).
- **The heartbeat.** This diet leaves the `.supervised` stamp, `beat=$((beat + tick + spent))` and §4.2 of the 2026-08-12 spec exactly as they are. The observer's own beat file (D-4971) is a different file.

### 3.6 The stop rule

Ruled with plan D. Once diet W4 is deployed and measured (§10), the operator decides whether the observer goes past stage 3a.
- If neither its latency gains nor a fleet view for #390 is wanted, the observer parks after 3a (its off-fleet build and soak), with its code dormant.
- CPU alone, about 0.1 cores at 55 sessions [I], does not justify attaching a new client to the fleet's tmux server. That server is the single point of failure whose out-of-memory kill on 2026-10-12 stopped every pane (#358).

The observer spec's §13.4 states the same rule in the same words.

### 3.7 Rejected, for the record

| Option | Why |
|---|---|
| Fold every session into one process (#387 direction 4) | It saves no CPU before the diet: one serial pass is about 9.4 CPU-s [I]. Route typing holds a row for 20–30 s (the comment at ≈:23041–23055), so a pass has no upper bound. One hang stalls all 55 heartbeats. Porting the rules to node or Python duplicates about 1,700 lines while `cmd_swap`, `_alive`'s callers, `ls` and the doctor keep the bash ones. Its only unique win, about 0.69 GB of RSS [M], belongs on #270. |
| The observer running `ccd supervise --once <id>` per trigger | About 0.15–0.26 cores of pure script parsing [I], and it loses #189's per-process walk state. |
| Gating individual checks | The checks' inputs overlap, and they must run in order within one tick (§5). After the diet the checks that could tolerate it cost about 0 forks. |
| An adaptive or slower tick (#387 direction 1) | After this diet it saves at most about 0.2 cores. It adds up to 25 s to revival, uuid sync, stale-Enter and rescue, breaks three cadence pins, and contradicts `coord/routes.ts`'s 5 s assumption (≈:662–672). No ruling has ever touched the tick. |
| `sleep` replaced by `read -t` | It saves one fork per tick (about 0.02 cores) and breaks `ccd-substrate`'s `sleep` stubs. Under plan D, the observer's FIFO wait replaces `sleep` anyway, and only in the live arm. |

## 4. Goals and non-goals

**Goals**

1. Cut supervisor CPU by at least 85% at the fleet's scale, with nothing observable changing in:
   - liveness and revival;
   - the heartbeat;
   - uuid sync;
   - the stale-limit Enter;
   - auto-swap (rescue and affinity);
   - auto-compaction;
   - route application.
2. Prove the cut with a fork-budget test that goes red when a fork returns. State the measured cost per tick in every PR's departure, following the session-continuity programme's precedent.
3. Prove equivalence with a differential test against vendored copies of today's functions, under the units' measured locale (UTF-8) and under `C`.

**Non-goals**

- Changing `tick=5`, the `unknown` arm's 5→30 s back-off, or the heartbeat arithmetic.
- Any shared, cross-process or on-disk state. The fleet observer is the separate spec named in Related.
- Changing D-3525's target builders or their census (§12 O1).
- Changing the transcript arm's 30 s cadence inside W1–W4. That is 2a, under its own number (§7.1).
- The `unknown` arm (#358) and the server's per-row `has-session`.

## 5. Contracts this design keeps

| Contract | Where | Kept by |
|---|---|---|
| Probe polarity: only "can't find session" is `gone`; a failed or silent probe is `unknown`; `PROBE_SUBSTRATE` is read only at the pre-flight | `_session_probe` ≈:2880–2969 (D-310, D-514, D-515) | The classifier body is unchanged. Only its `type -t` fork and the `-k` cache change (D-4960). |
| The stale check runs before swap in the same tick; compact and route sit on one line | ≈:23070; pins in `ccd-limit-stale.test.ts` (≈:86) and `ccd-route-tick.test.ts` (≈:173) | That line stays byte-identical. `_tick_begin` goes on its own line above it. |
| The compactor captures no pane of its own | `ccd-route-tick.test.ts` (≈:176–189) | The memo lives in `_pane_for_keystroke` and the `_tick_*` helpers. |
| D-2443: swap sees the screen after the stale Enter | `_session_hard_blocked` ≈:16975–16985 | The memo is dropped before every in-tick keystroke. |
| Heartbeat at entry, then at least every 30 real seconds | ≈:22968, ≈:23071–23073; §4.2 of the 2026-08-12 spec | Untouched. `_now_s` honours `date` stubs. |
| Exact tmux targets, and their census | D-3525; `ccd-tmux-anchor.test.ts` (`ALLOWED_CCD_ARG`) | Every `-t` stays `"$(_tmux_t …)"`, or `"$t"` bound from it. |
| Action paths read fresh | the `-e` captures at ≈:17051, ≈:17086, ≈:18534; `_idle_for_keystroke` (≈:18443: pid, status JSON, its width gate) | Unchanged and never memoised. |
| A phrase-carrying reader guards itself | `ccd-reader-standdown.test.ts`'s population census | Every reader keeps its `_pane_measurable` call by name; inside a tick, the call answers from the memo. |
| One unit per session; swap stops the unit | `cmd_swap` ≈:25625; `_ws_unsupervise` ≈:4156 | Unchanged. |

## 6. Design

### 6.1 Rules

1. **Same names, same contracts.**
   - Every converted helper keeps its stdout and rc API as a wrapper.
   - A new `_<name>_to <var> …` form (`printf -v` or a nameref) carries the fork-free core.
   - Callers outside the tick get the old contract with builtin internals.
2. **Stubbed predicates stay called by name.** `_avail`, `_class_gate`, `_swap_target`, `_session_hard_blocked`, `_pane_for_keystroke` and `_pane_measurable` keep their call sites; only their bodies change.
   - A call site moves to an out-var only if nothing in `server/test` stubs its callee, or the stub is ported in the same PR.
   - Census of stubbed value-returning helpers [M]: `_acct_pool_state` 6, `_sync_uuid` 4, `_reg_read` 3, `_pane_ctx_pct` 2, and 1 each for `_reg_get`, `_pane_measurable`, `_route_peek`, `_class_gate`, `_pane_for_keystroke`, `_idle_for_keystroke`, `_session_hard_blocked`, `_project_pool_state` and `_cfg_dir`.
3. **A fast path only on its provable domain.**
   - A builtin replacement answers only for inputs where it provably equals the legacy pipeline under the caller's locale.
   - Every other input runs the legacy code unchanged.
   - Equivalence is then a claim about a stated domain, checked by the corpus, not a claim about all bytes.
4. **The tick memo decides; it never authorizes.**
   - Inside a tick, decisions may read the tick's one observation.
   - Every read an action already makes for itself stays direct: the `-e` box captures, `_idle_for_keystroke`'s width gate, pid and status JSON, and route typing's dialog captures.
5. **No new on-disk state and no format change.** Old and new supervisors coexist, and rollback is the previous version.

### 6.2 W1: constants and clock (D-4960, D-4961)

**The `-k` cache, primed once (D-4960).**
- `_plat_timeout` caches its capability probe (≈:576–582) in `_CCD_TIMEOUT_K`. `cmd_supervise`'s pre-loop, after the pre-flight's `cmd_ensure` and before `while :`, calls `_plat_timeout` itself once on `true` when a `timeout` or `gtimeout` is on PATH. That call runs in the supervisor's own shell, so `_CCD_TIMEOUT_K` survives for the life of the process.
- `_plat_timeout`'s body is not edited, and nothing enters the platform block. Measured at `0d0ea592`, its body has three byte-for-byte copies that tests pin (`ccd-account-auth.test.ts` and `ccgpt-runtime.test.ts`), and `macos-platform.test.ts` holds the platform block byte-identical in `ccd/ccd` and `ccd/ccrc`. Factoring the probe into a helper would move all of them for the same three forks (plan P1).
- For every caller other than the supervisor, `_plat_timeout` behaves as it does today.
- Saving: 3 forks per tick.
- Residual: the unit restarts at every `ccrc update`, so a `timeout` binary upgraded mid-life is re-probed at the next sweep.

**`_session_probe`'s type test (≈:2923, also D-4960).**
- `[[ $(type -t tmux) == function ]]` becomes `declare -F tmux >/dev/null`.
- The two agree for every answer `type -t` can give here: function, file, builtin or none. They would differ only for an alias named `tmux`, which ccd never defines and a script does not expand.
- The classifier and the timeout branch are unchanged. Saving: 1 fork per tick.

**`_now_s` / `_now_s_to <var>` (D-4961).**
- It answers `$EPOCHSECONDS` when the shell sets it (bash 5.0 and later) and no `date` function is defined (`declare -F date` fails). Otherwise it answers `date +%s`. Testing `${EPOCHSECONDS:-}` rather than the version is `_plat_epoch_ms`'s own idiom, and a test drives the fallback with `unset EPOCHSECONDS`.
- That is the idiom `_session_probe` already uses for `tmux`. It honours the `date` function stubs in 11 test files [M], for example `ccd-route-tick.test.ts` (≈:357), `ccd-rescue-policy.test.ts` (≈:619) and `ccd-substrate.test.ts` (≈:44). `printf '%(%s)T'`, a proposal's alternative, ignores those stubs and is not used.
- A PATH-executable `date` shim is bypassed on bash ≥ 5.0. No suite drives a tick-path helper with one today: the executable shims in `ccrc-update`, `ccgpt-runtime`, `macos-platform` and `telemetry-keepalive` drive other code [M, grep]. The budget harness's own `date` shim therefore counts `date` execs, to prove they are gone; it does not supply the time.
- It replaces `$(date +%s)` on the tick path:
  - the loop's `t0`, `spent` and heartbeat reads (≈:23063, ≈:23072, ≈:23073);
  - `_limit_field` (≈:16041);
  - `_session_hard_blocked`, `_auto_stale_check`, `_auto_swap_check`, `_auto_compact_check`, `_idle_for_keystroke` and `_acct_pool_state`.
- ccd's floor is bash 4.4 (the entry check near ≈:30). On 4.4 nothing is saved and nothing regresses.

**`_cfg_dir_to`.**
- It is memoised per wrapper for the life of the process. `_cfg_dir` (≈:15838) is a pure function of the roster, which `accounts.sh` (≈:1681) loads once at source time and never re-sources.
- It needs no number: it is an exact memo, pinned by a parity row.
- It converts two sites, in `_auto_swap_check` and `_idle_for_keystroke`. On a miss it calls `_cfg_dir` by name, so a test's `_cfg_dir` stub is honoured. The one stubbed call site (`_ws_status`, stubbed in `ccd-archive.test.ts`) is not converted (§6.1 rule 2).
- `_sync_uuid`'s own lines are not edited in W1–W3 (§12 O4). It speeds up through the helper bodies only.

**The tick context.** `local CCD_TICK_CTX=1` is set immediately before `while :`, after the pre-flight probe and `cmd_ensure`, so `cmd_ensure` never sees it.
- It is dynamically scoped like `CCD_IN_UNIT` (≈:22979), never exported and never an argv token.
- Nothing reads it until W4. It lands in W1 so that every pre-loop edit lands in the wave the observer's loop change rebases on (§3.5).

### 6.3 W2: limits JSON (D-4962)

**`_limit_json_num` (≈:15996).**
- The legacy pipeline is `grep -oE "\"key\"[[:space:]]*:[[:space:]]*[0-9]+" f | head -1 | grep -oE '[0-9]+$'`.
- The new core reads the file once (`IFS= read -r -d ''`, under a scoped `local LC_ALL=C`). Then:
  - **Fast domain:** the file is regular, readable and under 64 KiB; the read hit EOF with no NUL; and every byte is printable ASCII or one of `\t\n\v\f\r`. All of it is checked under the scoped `C` locale. Under a UTF-8 locale bash 5.x misses a NUL that follows a UTF-8 lead byte in an unpinned `read -d ''` (D-3833, D-3979), so the NUL rule is sound only under the pin. The 64 KiB cap bounds a builtin slurp where grep streamed.
  - Inside the domain, it matches with `[[ =~ ]]`. The whitespace class is written as the literal bytes `[ \t\v\f\r]`, so a match cannot cross a newline the way `[[:space:]]` would; grep, which works per line, never sees one. The leftmost match in the string is the first match in file order, and it prints that match's digits. `"x": 12.5` gives `12`, exactly as grep does. Stdout and rc equal the pipeline's under `pipefail`: rc 0 with a match, rc 1 with none.
  - **Otherwise** it runs the legacy pipeline, in the caller's locale, outside the pin: on a NUL (on which grep 3.11 suppresses `-o` output), on non-ASCII bytes, on a directory, FIFO, unreadable or oversized file, or on a read failure (so the legacy's own stderr and rc come out).
- The producers write compact `printf` output or Python `json.dump` output, ASCII by default, so the fast domain should cover the whole fleet [I].

**`_limit_field_to` (≈:16034).**
- It reads the file once for `val`, `ts` and `<field>ResetAt`. Today those are three reads.
- Three reads could straddle a writer's rename; one read cannot. That narrows a window. It adds no behaviour.
- `_limit_field` stays as the printing wrapper.
- `_avail` (≈:16352), `_serviceable` (≈:16136) and `_limit_score` (≈:16261) call the `_to` form.

**`_share_pct` (≈:16112, fable-class rows only).**
- Today it runs `python3` once for home and once per candidate.
- It is memoised per wrapper for the length of one `_swap_target` call, through a dynamically scoped local in the `CCD_IN_UNIT` pattern, so a memo never outlives the call that asked.
- Inside one call, an answer can now differ from today's only if the sweep file is replaced mid-call or its freshness boundary passes mid-call. Both are sub-second races of the class §11 records for the memo.

### 6.4 W3: registry and route chain (D-4963)

**The bodies of `_reg_get` (≈:3133) and `_reg_read` (≈:3238).**
- The type checks stay first and in order: `-L`, then `-f`. That order is the FIFO and `/dev/zero` hang guard at ≈:3240–3270.
- Then one shared reader, `_file_read_to`, runs `{ ran=1; IFS= read -r -d '' v; } 2>/dev/null < "$f"` under a scoped `local LC_ALL=C`, for the NUL hazard stated in §6.3:
  - **EOF with no NUL:** strip every trailing newline, which is exactly what `$(cat)` does, and answer rc 0.
  - **The redirection failed** (the group never ran, so `ran` is unset): this is the unreadable rung. `_reg_get` answers rc 1 with no output, as `cat` does; `_reg_read` falls to its existing ladder (rc 2 for something that exists, rc 1 for a field that vanished).
  - **A NUL was found:** run the legacy `cat`, which drops NULs.

**`_reg_get_to` / `_reg_read_to`.**
- They are used at the hot sites in `_session_hard_blocked`, `_auto_stale_check`, `_auto_swap_check` and `_auto_compact_check`; the plan's Task 14 lists each site and its stub census. `_home_measured` becomes `_home_measured_to`, and `_authdead` (≈:1835) reads its marker through `_file_read_to`.
- **Left as they are, by measurement (plan P3–P5):** `_sync_uuid`'s reads (§12 O4); the two `.project` tick reads, whose count `cmd_prefer`'s census sentence states and `ccd-reg-get-census.test.ts` parses; `_project_pool_state` (≈:1937), whose `echo` words `pools-prose.test.ts` extracts; and `_crosspool_tick`'s read (≈:25055), which sits behind an `-e` pre-gate off the idle path. The two `.project` reads still lose their `cat` exec, through `_reg_read`'s new body.
- **Required in the same PR:** the census sentence in `_reg_get`'s header ("this file makes 197 invocations across 167 non-comment lines", ≈:3138) is re-measured, as `ccd-reg-get-census.test.ts`'s `CENSUS_RE` instructs. Re-measure the sentence, not the test.

**The route chain.**
- `_route_peek_to`, `_route_effort_for_to`, `_route_wanted_to`, `_route_applied_get_to` and `_route_pending_word_to` (≈:18313–18328, ≈:18742–18809) cover all 15 nested subshells inside `_route_apply_pending` (≈:18820). `_route_effort_for_to` is the fifth form: `_route_wanted`'s `$(_route_effort_for … quiet)` holds three of the 15 (plan refinement 7). Only its quiet arm converts; the other arm keeps its journal side effects.
- `_route_peek`'s one stub is ported with it.

**Other subshells on the swap path.**
- The `$( )` capture of `_home_measured` becomes `_home_measured_to`.
- `$(_rescue_target …)` (≈:24675) stays a subshell, so that `_swap_target`'s globals (`SWAP_TARGET_SKIP`, `POOL_OK_*`) cannot leak into the loop. Cost: 1 fork.

### 6.5 W4: one observation per tick (D-4964)

The operator ruled this memo behaviour-unchanged on 2026-10-13, under the terms below, with `TICK_MEMO_MAX_MS=1000` (§2).

**`_tick_begin "$id"`** runs on its own line in the live arm, above ≈:23070.

- It runs only when `CCD_TICK_CTX=1` and bash is at least 5.0. On older bash the memo is off and every reader runs today's code.
- It binds `t=$(_tmux_t "$id")` once. That costs 2 forks and passes the D-3525 binder rule.
- **One `tmux list-panes -t "$t" -F '#{pane_active} #{pane_width} #{pane_pid}'`.** It stores:
  - the rc;
  - `TICK_WIDTH`, from the first row whose first field is `1`, as `_pane_measurable`'s awk takes it;
  - `TICK_FPID`, from the first row, as `_sync_uuid`'s `head -1` takes it.
- **One capture with a sentinel**, so that the stored value is what `| tail -8` then `$( )` would produce:
  - The form is `raw=$(tmux capture-pane -t "$t" -p 2>/dev/null; printf '\n%s' "x$?")`.
  - tmux's rc is recovered from the sentinel.
  - It takes the last 8 newline-terminated rows, blank rows included, and only then strips trailing newlines. Taking the capture as `$(tmux capture-pane -p)` would strip first and turn a `pane-blank` verdict, a measured fleet condition, into content.
  - It stores `TICK_PANE` and `TICK_CAP_RC`. `_pane_for_keystroke`'s `pane-unreadable rc=N` is reproduced from `TICK_CAP_RC`; under `pipefail`, legacy `prc` is tmux's rc.
- It records `TICK_ID=$id` and its start time from `_tick_now_ms`.
  - `_tick_now_ms` answers epoch milliseconds from `EPOCHREALTIME`, by `_plat_epoch_ms`'s rule (≈:381; the separator is not assumed to be a dot, ≈:378).
  - It is a function, so tests can stub it.
  - Whether it calls a factored fork-free core or restates `_plat_epoch_ms`'s two lines is the plan's choice. That choice is bound by `macos-platform.test.ts`'s pin that the session hook's copy of `_plat_epoch_ms` carries the same body (≈:462).
- The new helpers join ccd's existing `_tick_*` family (`_tick_undecidable`, `_tick_strand_undecidable`, `_tick_decided`). None of their names collide.
- It costs 5 forks per tick.

**The memo is valid only if all of these hold:**
- `CCD_TICK_CTX=1`;
- `TICK_ID == $1`;
- the memo has not been dropped;
- `0 ≤ _tick_now_ms − start ≤ TICK_MEMO_MAX_MS`. The constant is declared once, at 1000, as ruled. A negative age, from a clock stepped backwards, is invalid;
- **per field**, the field was observed. An empty or non-numeric `TICK_FPID` or `TICK_WIDTH`, where today's reader would parse a number, means "not observed", and that reader reads direct. Real tmux always prints both fields. The rule matters for test stubs: `WIDE_PANE` (`ccdWsHelpers.ts`) answers any `*pane_active*` query with `1 200` and no pid. So in on-mode fixtures, `_sync_uuid` reads its pid direct, just as the stub expects today.

Otherwise every reader runs today's direct code.

**What reads the memo:**

| Site | Change |
|---|---|
| `_pane_measurable` (≈:16848; called at ≈:17022, ≈:17077, ≈:17332, ≈:18583) | Answers from the memo: list rc ≠ 0 gives rc 1, as today's `\|\| return 1` does; otherwise the same numeric rule. `_idle_for_keystroke`'s call (≈:18465) asks for a direct read through an explicit argument. It is an action gate, reached only above the compaction threshold. |
| `_auto_stale_check` (≈:17078), `_auto_swap_check` (≈:17621), `_pane_for_keystroke` (≈:18435) | Take `TICK_PANE`. In `_auto_stale_check`, `t=$(_tmux_t "$id")` moves into the branch that acts, so the steady path never calls it. |
| `_sync_uuid` (≈:15856) | Takes `TICK_FPID`. The sessionId is parsed with builtins on the printable-ASCII domain, with grep as the fallback. A changed sessionId is written exactly as today. |

**Dropping the memo.** `_tick_pane_drop` runs immediately before:
- the stale Enter (≈:17091);
- `/compact` (≈:18656);
- the call to `_route_apply_now` (≈:20265), which covers all route typing. Route apply is last on the line, so nothing in that tick reads the memo after it.

**The `send-keys` census.** There are 24 `send-keys` sites in 11 functions [M]. A pin classifies each one: either reachable from the tick, and preceded by a drop, or outside it. A new unclassified site goes red.

### 6.6 W4: classifiers (D-4965, consuming D-4967)

**Fixed-literal greps become `[[ $pane == *literal* ]]`.**
- The sites are `"esc to interrupt"` and `"❯"`:
  - in `_session_hard_blocked` (≈:17034);
  - in `_auto_stale_check` (≈:17081–17082);
  - in `_auto_swap_check`'s affinity path (≈:17872–17873);
  - in `_idle_for_keystroke` (≈:18468–18469).
- Each is a plain `grep -q`, with no `-i`. A pattern with no metacharacter, no newline and no anchor makes the substring test exact.
- The match runs on bytes, under a scoped `LC_ALL=C`. UTF-8 is self-synchronising, so on valid UTF-8 a byte match of a whole encoded literal equals grep's character match [I]. tmux's capture is valid UTF-8 [I].
- The corpus carries invalid-UTF-8 rows. Any divergence found there is fixed, or recorded like §11's case-fold residual, before W4 merges.
- Under `pipefail`, legacy `echo "$pane" | grep -q` could differ only if `echo` took SIGPIPE, which needs a pane larger than the pipe buffer [I]. A corpus row with a pane over 64 KiB pins that.

**Necessary-literal prefilters (D-4965).**
- Before its grep, each of the four banner classifiers asks one fork-free helper whether any literal of the shared set D-4967 is present.
- The helper lowercases its input with `${s,,}`, in the caller's own locale. That locale is never a scoped `C`, so a character that UTF-8 lowercasing maps onto an ASCII letter (the Kelvin sign) folds as grep's would [I].
- It then tests each literal as a substring.
- **A miss** returns the classifier's "no match" (rc 1). **A hit** runs today's `grep -qiE`, unchanged, which decides.
- **Why it is sound.** Every alternative of every one of the four regexes contains at least one literal of the set, and a census pin checks that with a minimal-match corpus. grep works per line, so a line that matches contains its literal, and so does the whole text.
- The prefilter tests the raw pane, before `_pane_outside_box`'s awk (≈:17095). That awk only removes lines, so the raw pane is a superset of what grep would read.
- In `_pane_auto_continue_armed` (≈:16936), the "unmeasurable means armed" arm stays first. The prefilter replaces only the grep after it.

**What W4 takes from D-4967. W4 depends on this.** The set is defined once, as one array, `PANE_LIT`, in `ccd/ccd`'s tuning constants directly after `TRANSCRIPT_ARM_INTERVAL`, and defined in prose in the observer spec's §5. That spec owns D-4967. The observer reads the same array through its `observe-spec` output as its in-server pane search.
- W4 needs exactly one property of the set: every alternative of the four classifiers below contains at least one of its literals.
- As drafted on 2026-10-13, the set is these 14 lowercase literals. This table must match the observer spec's. If the two ever disagree, the ccd array is the truth, and both texts are corrected.

| Literal | Covers (classifier, ≈ line: alternative) |
|---|---|
| `usage limit has reset` | `_pane_limit_stale` (≈:17064): `usage limit has reset.*press enter to continue` |
| `limit reached` | `_pane_hard_blocked` (≈:17129): `limit reached` |
| `reached your ` | `_pane_hard_blocked`: `reached your .*limit` |
| `out of usage` | `_pane_hard_blocked`: `out of (usage\|credits)` |
| `out of credits` | the same alternative |
| `monthly spend limit` | `_pane_hard_blocked`: `monthly spend limit` |
| `hit your ` | `_pane_hard_blocked`: `hit your .*spend`; `_pane_limit_banner` (≈:17181): `hit your ([a-z0-9]+ )*limit ·` |
| `api error: 429` | `_pane_hard_blocked`: `API Error: 429` |
| `too many requests` | `_pane_hard_blocked`: `Too Many Requests` |
| `rate limit` | `_pane_hard_blocked`: `rate limit(ed\| exceeded\| reached)` |
| `invalid api key` | `_pane_hard_blocked`: `Invalid API key` |
| `please run /login` | `_pane_hard_blocked`: `Please run /login` |
| `continuing automatically` | `_pane_auto_continue_armed` (≈:16943): `continuing automatically` |
| `continuing shortly` | `_pane_auto_continue_armed`: `continuing shortly` |

- Each classifier consults the whole set, not only its own rows. That is sound, because the set contains every classifier's necessary literals. It costs nothing measurable: a classifier falls through to its grep only when some limit-shaped text is on screen [I].
- **The bare `limit` is gone.** Rev 0 used it, so any pane mentioning a limit fell through. Each literal above is necessary: dropping any one of them turns its alternative's minimal-match row red.
- **Landing order.** W4 lands the array in `ccd/ccd` unless the observer's stage-3a `observe-spec` PR lands first. Whichever lands second consumes the existing array and adds no copy. A pin finds the array defined once.
- **What W4 waits on.** W4 does not merge until D-4967's set is approved in the observer spec (§12).

**`_pane_ctx_pct` (≈:17933).** It gets a one-entry memo keyed on the exact input. It is a pure function of the pane text: its greps pin `LC_ALL=C` themselves.

### 6.7 Budget

Each PR sets the ratchet constant from measurement. The figures below are a model [I].

| After | Forks / execs per idle tick | Supervisor cores, 55 sessions |
|---|---|---|
| `main` | 179 / 85 [M] | 3.84–4.10 [M] |
| W1 | ~165 / 75 [I] | ~3.5 [I] |
| W2 | ~126 / 48 [I] | ~2.5 [I] |
| W3 | ~86 / 33 [I] | ~1.7 [I] |
| W4 | **≤ 12 / ≤ 5** [I] | **~0.3–0.5** [I] |
| 2a | the same per tick, minus the amortised arm | ~0.16–0.27 [I] |

What remains per tick after W4, in steady state:
- the probe: its `$( )`, `_tmux_t` ×2, then `timeout`, which runs tmux;
- `_tick_begin`: 5;
- `$(_rescue_target …)`: 1;
- `sleep`: 1.

Amortised on top of that:
- the heartbeat's `mv`, every 30 s;
- the D-2444 transcript arm, every 30 s on idle panes: about 27 forks plus `python3`. It is the largest item left, and 2a's subject.

## 7. Stage 2 after W4

Each item goes ahead only if the post-W4 measurement shows it is worth doing.

### 7.1 2a: the transcript-arm gate (D-4966)

- **Today.** `_session_hard_blocked` reuses its `tscan` verdict for `TRANSCRIPT_ARM_INTERVAL` = 30 s (≈:1490, D-2444; the cache read is ≈:17037–17049).
  - A miss runs `_pane_born` (a tmux `display-message`), then `_limit_dated` (≈:24237), which runs `_transcript_path` (≈:5170), `tail -n 60` and `python3` (`_transcript_limit_banner`, ≈:21854). That is about 27 forks plus `python3` [M].
  - The cache test is `-lt 30` (≈:17040). Ticks exactly 30 s apart therefore always miss, which is the observer's safety cadence under plan D.
- **The change.** When the cached verdict is older than the interval but none of its inputs measurably changed, reuse it. "Unchanged" means all of these:
  - the resolved transcript's mtime is not newer than the `tscan` stamp file (a builtin `[[ -nt ]]`);
  - `.lastswap` is the same;
  - pane-born is the same.
- **Why it needs its own number.** It departs from D-2444's cadence, which bounds the arm's staleness by time alone.
- **Prerequisites,** checked in its plan's Task 0 before any code:
  1. The arm's verdict is a function of the transcript bytes, pane-born and `.lastswap`, with no dependence on the current time.
  2. `-nt`'s resolution on the fleet's filesystem is measured. Bash compares nanosecond mtimes where the platform gives them [I].
  3. The gate must not call `_transcript_path` itself, because that resolution is most of the cost. It keys the path on what resolves it: the uuid, the config dir and the workdir [I].
  4. Pane-born costs a tmux call. 2a may add `#{session_created}` to `_tick_begin`'s `list-panes` format, which tmux evaluates in pane context, so that it is free inside a tick [I].
- **Saving:** about 0.1–0.14 cores at 55 sessions [I].
- **Route:** native. 2a's mechanics land in its own plan section, or its own short spec if the prerequisites change its shape, after W4 is measured (§12 O5).

### 7.2 The other residuals

- **(b) The away-from-home candidate loop and fable-class `_share_pct`.** No fixture covers them today. The live outlier cost about 2.6 CPU-s per tick [M]; after W2 that path should be bash-only [I]. T0 adds fixtures for both (`fable` and `leaving`), so W2 measures them.
- **(c) #189.** It should use `_reg_get_to` and trim its own +5 forks per tick (2 `stat` calls and a `uuid` re-read).
  - The event-coverage pass also reproduced a stall on the PR's own function bodies. If the successor transcript exists but is still empty at first sight, `_CI_DONE` is set before the `-s` check, and the walk never hops.
  - That is reported on #189, not fixed here.
- **(d) Optional: amend the D-3525 census** to admit a fork-free exact target builder. That saves 4 forks per tick, about 0.05 cores (§12 O1).

## 8. Invariants

| # | Invariant | Mechanism |
|---|---|---|
| I1 | Probe polarity, the 8 s deadline, absent vs unmeasured | Classifier unchanged. `declare -F` agrees with `type -t … == function`. The K-cache is primed in the main shell. |
| I2 | Cadence and heartbeat | Loop timing untouched. `_now_s` honours `date` functions. |
| I3 | Order within a tick | ≈:23070 byte-identical. A drop before every in-tick keystroke. |
| I4 | Same stdout, rc and side effects for every converted helper | Wrappers, plus fast paths restricted to their domains |
| I5 | No decision on pane evidence that is older than `TICK_MEMO_MAX_MS`, from another session, from outside the supervise loop, from before an in-tick keystroke, or a field the memo did not observe | The memo's validity conditions (§6.5) |
| I6 | Actions read fresh | `-e` captures, `_idle_for_keystroke`'s width gate, its pid and status JSON, and route dialog captures are never memoised |
| I7 | Test seams survive | The stub census rule (§6.1 rule 2). The memo is off outside `CCD_TICK_CTX`, so every existing function-level suite runs today's direct paths. |
| I8 | No prefilter refuses what its regex would match, except the stated case-fold residual | Every regex alternative contains a D-4967 literal (census pin), and the prefilter runs before `_pane_outside_box` |
| I9 | Cost does not regress | The fork-budget ratchet (§9) |

## 9. Proof

**The T0 harnesses** land in W1, red against `main`.

- **`ccd-tick-budget.test.ts`.** It runs the real `cmd_supervise` loop under `set -u` (ccd's `set -uo pipefail`, ≈:9), with only the pre-loop `cmd_ensure` and `_svc_enable` stubbed.
  - Real-executable PATH shims for `tmux`, `timeout`, `date` and `sleep`. The `sleep` shim ends the run after N ticks.
  - Forks are counted as distinct `BASHPID` values, through `BASH_XTRACEFD` and a `PS4` that carries the pid. That is portable to the macOS legs.
  - Execs are counted from the shim logs.
  - Fixtures: idle at home, busy, narrow pane, away from home over the ceiling, hard-blocked, inside the swap cooldown, fable-class, and leaving (home and the current account both over the ceiling, so `_swap_target`'s candidate loop runs; §7.2(b), plan P9).
  - The budget constants are declared once.
  - A real-tmux variant runs on an isolated `-L` socket on Linux CI, following `ccd-tmux-anchor.test.ts`.
- **`ccd-tick-diet-equivalence.test.ts`.**
  - Today's bodies are vendored as `_legacy_*` in a test fixture, each with its origin sha.
  - It compares stdout and rc of legacy and new under `C.UTF-8` and `C`.
  - **Corpus:**
    - every pane constant already in the suites;
    - statusline variants: 0, 9, 10, 99 and 100%, missing, truncated with `…`, an extra `│`;
    - panes that are blank at the bottom, short, wide-character, over 64 KiB, or invalid UTF-8;
    - limits JSON: compact, spaced, null, missing or repeated keys, key and value on separate lines, CRLF, NUL, invalid UTF-8, empty;
    - registry values: `\n\n`, no newline, spaces, CR, NUL, empty, symlink, FIFO, directory, mode 000;
    - sessions JSON: compact, with non-ASCII elsewhere in the file, NUL;
    - a minimal matching string for every alternative of each prefiltered regex;
    - case-fold candidates (`ſ`, `ı`, the Kelvin sign). Each one that diverges is stated as an expected-divergence row (§11);
    - a seeded random corpus.
- **Dual-mode behaviour suites.** `ccd-limit-stale`, `ccd-auto-compact`, `ccd-auto-swap-hold`, `ccd-route-tick` and `ccd-rescue-policy` gain a `tickCtx: [off, on]` dimension. Every scenario must give the same keys, `swap.log` lines and registry bytes in both modes. Their existing stubs serve on-mode unchanged, through the per-field rule in §6.5.

**Mutation rows.** Each guard has a row that turns red when the guard is removed.

| Guard | Mutation | Red test |
|---|---|---|
| K-probe priming (D-4960) | delete the pre-loop prime | budget: `timeout -k 1 1 printf` appears in each of 3 ticks; 0 expected inside the loop |
| `declare -F tmux` (D-4960) | replace it with `false` | parity row: a function stub must take the direct branch |
| `_now_s` seam (D-4961) | drop the `declare -F date` check | `ccd-route-tick.test.ts` (≈:361–391): heartbeat count over 4 × 20 s |
| Limits ASCII domain (D-4962) | remove the fallback | the NUL and invalid-UTF-8 rows diverge |
| Limits per-line class (D-4962) | `[ \t\v\f\r]` → `[[:space:]]` | the "key and value on separate lines" row |
| `_share_pct` memo scope (D-4962) | make the memo process-wide | two `_swap_target` calls around a sweep-file rewrite must give two answers |
| `_reg_get` NUL fallback (D-4963) | remove it | the NUL row |
| `_reg_get` trailing strip (D-4963) | strip only once | the `\n\n` row |
| `_reg_read` type order (D-4963) | move `-L` after the read | the symlink row (rc 2 expected); the FIFO row hangs (`runBounded`) |
| Memo id/context guard (D-4964) | drop the `TICK_ID` check | outside the loop, 2 × `_pane_measurable` must make 2 `list-panes` |
| Memo age bound (D-4964) | delete the age check | the `_tick_now_ms` stub jumps 2 s; a direct `list-panes` is expected |
| Negative age (D-4964) | accept an age below 0 | the `_tick_now_ms` stub steps back 5 s; a direct read is expected |
| Per-field validity (D-4964) | treat an unobserved pid as "no pid" | on-mode with `WIDE_PANE`: `_sync_uuid` must still write the rotated uuid |
| Width gate stays direct (D-4964) | let `_idle_for_keystroke`'s call read the memo | memo wide, live pane narrow: the compactor must stand down |
| Drop before the stale Enter (D-4964) | delete it | the shim log must show `send-keys`, then a fresh `capture-pane` inside swap (D-2443) |
| Drop before `/compact` and route apply (D-4964) | delete each | the same shape for the route check after a compact |
| Tail-8 sentinel (D-4964) | replace it with a plain `$( )` | the "content at top, blank bottom" row: legacy says `pane-blank` |
| Capture rc carried (D-4964) | store text only | the `pane-unreadable rc=1` row in dual-mode `ccd-route-tick` |
| `send-keys` census (D-4964) | add an unclassified site | the census pin |
| Fixed literals case-exact (D-4965) | match case-insensitively | the "ESC TO INTERRUPT" row |
| Prefilter literal set (D-4965, D-4967) | drop any single literal | that alternative's minimal-match row |
| Prefilter placement (D-4965) | move it ahead of `_pane_auto_continue_armed`'s unmeasurable arm | unmeasurable, no literal: `armed` is still expected |
| Lowercasing locale (D-4965) | wrap `${s,,}` in `LC_ALL=C` | the Kelvin-sign row under `C.UTF-8`, if Task 0 confirms grep folds it [I] |
| Fork budget | re-insert `$(date +%s)` in the loop | budget |

**Existing suites that must stay green:**
- `ccd-substrate`: the sleep sequence `['5','5','30','30','5','5']`.
- `ccd-session-state`: 2 stamps in 8 ticks. It is a known load flake; re-run it in isolation.
- `ccd-route-tick`: the same-line and "captures no pane of its own" pins, and the real-seconds beat.
- `ccd-limit-stale`: the source pin (≈:86).
- `ccd-cold-start-substrate` and `ccd-supervised-start`.
- `ccd-tmux-anchor`: the D-3525 census is untouched.
- `ccd-reg-get-census`: re-measured.
- `ccd-reader-standdown`: the population census.
- `ccd-auto-swap-hold`, `ccd-auto-compact`, `ccd-rescue-policy`, `ccd-crosspool`, `ccd-pane-narrow-note`, `ccd-limits`, `ccd-limit-banner`, `ccd-pane-box-draft`, `ccd-serviceable`, `ccd-swap-pin`.
- `macos-platform`, including its `_plat_epoch_ms` body pin.
- `single-definition`, `deviation-refs` and `dtbd`.

The full CI run is `gh workflow run ci.yml --ref <branch> -f mode=full`.

## 10. Rollout and measurement

- **Class:** AGENT-FIRST, ccd body only. No unit-file, server, hook or registry-format change.
  - Dev build: `ccrc rollout --to vX.Y.Z`.
  - Stable: a bare `ccrc rollout` once promoted.
- **How supervisors pick it up.** Supervisors never re-exec.
  - `ccrc update`'s step 4 (`_upd_sweep`, `ccd/ccrc` ≈:21121) runs `try-restart claude-session@*` behind its `KillMode=process` preflight.
  - That restarts the supervisors, not the sessions.
  - Each restart re-parses ccd (about 55 ms [M]), runs the pre-flight probe and `cmd_ensure`, and stamps the entry heartbeat.
  - If the preflight refuses, the old tick keeps running until the next sweep. That is safe, because nothing new is written.
- **Order.**
  - W1, W2 and W3, each deployed and measured.
  - Then W4, once its prerequisites hold (§12): the memo ruling (made), D-4967 approved, and #189 landed.
  - Then 2a, if the post-W4 measurement shows it is worth doing.
- **Measurement after each wave** (read-only, builtin-only sampler, the same one the investigation used):
  - cgroup `cpu.stat` deltas for all units over 30 s;
  - `/proc/stat processes`;
  - PSI cpu;
  - the tick period, from the pids of the `sleep` processes.

  Each PR's departure records the measured cost per tick.
- **The post-W4 measurement is also the stop rule's input (§3.6).** It replaces the inferred 0.03–0.05 CPU-s per idle tick with a measured figure. Every plan-D total in §3.1 is then re-stated from it.
- **Behavioural canary,** 1 h and 24 h after each deploy, compared with the previous day:
  - `swap.log` counts for `auto-compact`, `compact-skip` by reason, `stale-resume`, `auto-home`, `auto-pool`, `auto-rescue`, `tickstuck` and `unstranded`;
  - `routeskip` and `routenote` reasons;
  - no active unit's `supervised` stamp older than 120 s;
  - no `unsupervised` flaps on the board.
- **Rollback:** `ccrc update --to <previous>` or `ccrc rollback`. The sweep restarts the supervisors on the old code. There is no state to migrate, and mixed versions are harmless.
- **Exposure.**
  - A deterministic crash on a new path, for example under `set -u`, would hit every unit after the sweep. The units go FAILED after 5 starts in 120 s, while the sessions keep running (`KillMode=process`).
  - Guards: the real-loop budget harness under `set -u` across 8 fixtures, the post-sweep stay-up check, and one wave per deploy.

## 11. What this does not claim

- **The memo is the one deliberate change in timing. The operator ruled it behaviour-unchanged on 2026-10-13 (§2).** Decisions later in a tick can read pane evidence up to `TICK_MEMO_MAX_MS` (1000 ms) old, where today each check re-reads.
  - With the diet in place, a whole tick runs in tens of milliseconds [I]. Today's gap between capture and action inside `_auto_swap_check` alone is 0.2–1.7 s under saturation [I].
  - The memo does not cover an outside actor, such as an operator's keystroke, changing the pane mid-tick. Today's gaps already allow that, at a similar scale.
- **Exotic case folding is a residual.** The prefilter lowercases in the caller's locale. `grep -i` under UTF-8 also matches characters whose fold reaches an ASCII letter only through uppercasing, such as `ſ` (to `s`) and `ı` (to `i`) [I]. `${s,,}` does not.
  - A banner spelled with such a character would be prefiltered as "no match".
  - The corpus measures each candidate and states every divergence as an expected row. Accepting this residual is §12 O2.
- **Prefilter hit rates on fleet panes are unmeasured.** Touching the fleet's tmux is forbidden. A common pane that contains a literal falls through to today's grep, with no saving and no harm.
- **The sessions-JSON fast domain's hit rate is unmeasured.** A file with non-ASCII elsewhere in it, such as a path, takes grep. That costs forks, never correctness.
- **Not measured:** the bash interpretation cost after the diet (estimated at 5–15 ms per tick), and the fable and candidate-loop paths (no fixture yet; T0 adds them). The 0.03–0.05 CPU-s per idle tick behind every plan-D total is inferred until W4 is measured.
- **The observer's figures** (§3) come from an unloaded container and a prototype, never from the fleet box.
- **#189** rewrites `_sync_uuid` and is currently CONFLICTING. W4 changes about 4 of its lines, so whichever lands second rebases. Its walk state stays valid, because this keeps one long-lived process per session at 5 s.

## 12. Where things stand

### Ruled

- **The structural rework is wanted** (operator, 2026-10-13).
- **Plan D** (operator, 2026-10-13): the diet now as stages 1–2, the observer staged behind it, and a stop rule after W4 (§3).
- **The tick memo is behaviour-unchanged under §6.5's terms, with `TICK_MEMO_MAX_MS=1000`** (operator, 2026-10-13).

### Open: each with the recommendation

- **O1. The D-3525 census.** Keep it untouched in this stage: `_tmux_t` is called twice per tick, for 4 forks. The alternative amends it to admit a fork-free exact builder, saving about 0.05 cores. *Recommended: keep it; revisit as 2d if measurement shows it matters.*
- **O2. Classifiers: prefilters with fallback, not whole-regex ports.** This accepts §11's case-fold residual. *Recommended: yes.*
- **O3. The cadence stays 5 s.** #387's direction 1 (an adaptive tick) is declined: after this work it saves at most about 0.2 cores, and adds up to 25 s to revival, uuid sync, the stale Enter and rescue. Direction 4 (one process) is declined: it costs the same per fork, and its RSS saving goes to #270. Under plan D, the observer, not a slower tick, is what makes quiet rows tick less often. *Recommended: confirm.*
- **O4. Landing order with #189.** W1–W3 change helper bodies and leave `_sync_uuid`'s own lines alone, so they land first. W4 waits for #189. *Recommended: yes.* If #189 is still open when W4 is otherwise ready, the operator chooses between waiting and W4 landing first with #189 rebasing.
- **O5. Follow-ups as separate specs.** 2a (D-4966) gets its own plan section, or a short spec if its prerequisites change its shape, after W4 is measured. The observer has its own spec. #390's consumer is a later spec. *Recommended: yes.*
- **P1–P9. The W1–W3 plan's refinements,** folded into §6.2–§6.4, §9 and §13 in rev 1: the `-k` cache primed through `_plat_timeout` itself, the ledger home, the three swap-path reads left as they are, the exact ratchet, line neutrality, the harness metric and the eighth fixture. *Recommended: confirm them with the plan* (its §Open decisions).
- **The observer's own decisions,** asked in the observer spec's §16 and listed here because plan D puts both specs in one review. None of them blocks W1–W3. The literal set blocks W4's merge (§6.6); the others block neither.
  - `SAFETY_S=30` (D-4969). *Recommended.*
  - Accept that the observer's own tmux session keeps an otherwise empty server alive (F9, D-4970). *Recommended.*
  - Placement: a Python stdlib `ccd-observe.service`, on roles that run sessions, Linux only. *Recommended.*
  - D-4967's literal set, which W4 consumes (§6.6). *Recommended: the 14 literals above, with no bare `limit`.*
  - The rest of that spec's §16: Flip-2 only on shadow evidence, the shadow gate, the limits files left unwatched, arming by two operator acts, and the 3b attach asked for at the time.

### Later

- 2b, 2c and 2d (§7.2), each only if the post-W4 measurement shows it is worth doing.
- The fold's one unique win, about 0.69 GB of supervisor RSS [M], is recorded on #270.
- #390 reads the observer's state, under its own spec, once the observer's first flip is stable.

## 13. Deviation numbers (issued 2026-10-13)

The ledger issued thirteen numbers for #387 on 2026-10-13: D-4960 to D-4966 for this diet, and D-4967 to D-4972 for the observer. This spec defines its seven below. The observer's six are defined in the observer spec and only cited here.
- **The ledger home is one plan, the W1–W3 plan** (`2026-10-13-supervisor-tick-diet-w1-w3.md`, its `## Deviations found`), which defines all thirteen once, in the words below and the observer spec's §17. `crossTreeCollisions` (`server/src/coord/ledger.ts`) reds `deviation-refs.test.ts` on any number defined in two plan files, whatever their subjects, so a per-wave home is not available (plan P2). W4's, 2a's and the observer's plans cite those entries and never redefine them.
- `deviation-refs.test.ts`'s floor case reds while tracked text names a number above the highest one that a plan on the same branch defines. This spec names numbers up to D-4972, so the branch that lands it must also carry a plan that defines them: the W1–W3 plan, which lands with it.

- **D-4960** — `k-cache-subshell`: `_plat_timeout` caches whether `timeout -k` works in `_CCD_TIMEOUT_K` (≈:576–582), but `_session_probe` calls it inside `out=$(…)` (≈:2926). The cache is therefore set in a subshell and lost, and every supervisor re-runs `timeout -k 1 1 printf ccd-k-ok` on every tick: 3 forks [M, seen live in 2 units, and once per tick in the replay]. W1 primes the cache once in `cmd_supervise`'s own shell, after the pre-flight's `cmd_ensure` and before the loop, by calling `_plat_timeout` itself on `true` when a `timeout` or `gtimeout` is on PATH. `_plat_timeout`'s body, pinned byte for byte against three copies, is not edited, and nothing enters the platform block (the plan's refinement 1, P1). The same number covers the probe's other per-tick fork: `[[ $(type -t tmux) == function ]]` (≈:2923) becomes `declare -F tmux >/dev/null`. The two agree for every function, file and builtin answer, and could differ only for an alias named `tmux`, which ccd never defines. Every other caller of `_plat_timeout` behaves as today. Residual: a `timeout` upgraded mid-life is re-probed at the next supervisor restart.
- **D-4961** — `tick-clock-seam`: `_now_s_to <var>` and `_now_s` answer `$EPOCHSECONDS` when the shell sets it and no `date` function is defined, and `date +%s` otherwise. They replace `$(date +%s)` at the tick path's sites: the loop's `t0`, `spent` and heartbeat reads, `_limit_field`, `_session_hard_blocked`, `_auto_stale_check`, `_auto_swap_check`, `_auto_compact_check`, `_idle_for_keystroke` and `_acct_pool_state`. The `declare -F date` test keeps the `date` function stubs of 11 test files [M] working, which `printf '%(%s)T'` would bypass. Testing `${EPOCHSECONDS:-}` rather than the version is `_plat_epoch_ms`'s own idiom: on ccd's bash 4.4 floor it is unset, so nothing is saved and nothing regresses, and a test drives the fallback with `unset EPOCHSECONDS`. The entry heartbeat, the `unknown` arm (#358) and every other `date` site are untouched. The observer's freshness test reads the same seam.
- **D-4962** — `builtin-limits-parse`: `_limit_json_num` and `_limit_field` parse `~/.cc-limits/<w>.json` with builtins on a stated domain only. The file must be regular, readable and under 64 KiB, and read to EOF with no NUL under a scoped `LC_ALL=C`. Every byte must be printable ASCII or one of `\t\n\v\f\r`. Matching is per line, through a literal `[ \t\v\f\r]` class that cannot cross a newline, and takes the first match in file order. Every other input, including an open or read failure, runs today's `grep|head|grep` pipeline unchanged, in the caller's locale. `_limit_field_to` (`_limit_field` renamed in place, with its printing form in the tick-diet block) reads the file once for the value, `ts` and `<field>ResetAt`, which narrows the window in which three reads could straddle a writer's rename. `_avail`, `_limit_score` and `_serviceable` call the `_to` form. The same number covers `_share_pct_to`'s memo, which lives in a dynamically scoped local of one `_swap_target` call, so it never outlives the call that asked, and which stores the rc beside the value. The 9 limits parses per idle tick fall from 39 forks and 27 execs to 0 [I].
- **D-4963** — `builtin-registry-reads`: `_reg_get` and `_reg_read` read through `_file_read_to`, an `IFS= read -r -d ''` under a scoped `LC_ALL=C` (bash 5.x misses a NUL after a UTF-8 lead byte otherwise: D-3833, D-3979). It runs after their unchanged `-L`-then-`-f` guards. EOF with no NUL strips every trailing newline, as `$(cat)` does. A failed open is the unreadable rung: rc 1 for `_reg_get`, and `_reg_read`'s unchanged ladder (rc 2, or rc 1 for a field that vanished). A NUL runs the legacy `cat`. `_reg_get_to` and `_reg_read_to` (`_reg_read` renamed in place) serve the tick's hot reads. `_route_peek_to`, `_route_effort_for_to`, `_route_applied_get_to`, `_route_wanted_to` and `_route_pending_word_to` remove all 15 nested subshells under `_route_apply_pending`. `_home_measured_to` and `_authdead`'s read follow. One stub is ported: `ccd-rescue-policy`'s `_route_peek`. Not converted, by measurement: the two `.project` tick reads (`cmd_prefer`'s census names them), `_project_pool_state` (`pools-prose.test.ts` extracts its `echo` words), `_crosspool_tick`'s read (off the idle path), and `_sync_uuid` (#189). The census sentence in `_reg_get`'s header is re-measured in the same PR, as `ccd-reg-get-census.test.ts` instructs.
- **D-4964** — `tick-memo`: each live tick takes one observation, through `_tick_begin`: one `list-panes` (rc, the active row's width, the first row's pid) and one capture with a sentinel (the bytes `| tail -8` and `$( )` would give, and tmux's rc). `_pane_measurable`, the three pane captures and `_sync_uuid`'s pid read from it.
  - The memo is valid only inside `CCD_TICK_CTX`, for the same id, before any drop, at an age from 0 to `TICK_MEMO_MAX_MS` = 1000, and only for a field it observed. Otherwise every reader reads direct.
  - It is dropped before the stale Enter, `/compact` and route apply.
  - It never serves an action's own fresh reads: the `-e` captures, `_idle_for_keystroke`'s width gate, pid and status JSON, and route dialog captures.
  - A census pin classifies all 24 `send-keys` sites in their 11 functions as reachable from the tick (and preceded by a drop) or outside it.
  - The operator ruled it behaviour-unchanged on 2026-10-13 ("Yes, 1000 ms (Recommended)").
- **D-4965** — `necessary-literal-prefilters`: `_pane_limit_stale`, `_pane_hard_blocked`, `_pane_limit_banner` and `_pane_auto_continue_armed` each first ask whether any literal of the shared set D-4967 is present in the lowercased raw pane.
  - A miss answers "no match". A hit runs today's `grep -qiE` unchanged.
  - It is sound because every alternative of every one of those regexes contains one of the literals (a census pin), and because `_pane_outside_box` only removes lines.
  - `_pane_auto_continue_armed`'s "unmeasurable means armed" arm stays ahead of it.
  - The fixed-literal `grep -q` sites for `esc to interrupt` and `❯` become byte substring tests, and `_pane_ctx_pct` gets a one-entry memo on its exact input.
  - Accepted residual (§12 O2): `grep -i` under UTF-8 folds characters such as `ſ` and `ı` onto ASCII letters, and `${s,,}` does not. A banner spelled with one is prefiltered as "no match". The corpus states each such divergence as an expected row.
- **D-4966** — `transcript-arm-gate`: stage 2a. It departs from D-2444's time-only cadence. Once the cached `tscan` verdict is older than `TRANSCRIPT_ARM_INTERVAL`, it is still reused if the resolved transcript is not newer than the stamp (a builtin `-nt`) and `.lastswap` and pane-born are unchanged.
  - Prerequisites, checked before code: the verdict does not depend on the current time; `-nt`'s resolution on the fleet's filesystem is adequate; the gate does not call `_transcript_path` itself.
  - Under the observer's 30 s safety tick, today's `-lt 30` cache test misses on every quiet tick, which makes this gate worth more under plan D.
  - It goes ahead only on the post-W4 measurement. It saves about 0.1–0.14 cores at 55 sessions [I].

**The observer's numbers** (defined in `2026-10-13-event-gated-fleet-observer-design.md`; cited here where they touch this design):
- **D-4967** is the shared literal set: one array, `PANE_LIT`, defined once in ccd and consumed by D-4965's prefilters and by the observer's in-server pane search. W4 depends on it (§6.6).
- **D-4968** is the observer's attach mode: a control client with `-N`, no `%output`, and a guard and watchdog for the backlog tmux would otherwise buffer without limit.
- **D-4969** is the safety tick (`SAFETY_S`, recommended 30 and still open, §12). Under it, an enrolled quiet row runs a full tick no later than 30 s after its last one started, so the transcript arm's 30 s cache misses on every one of them, which is why 2a is worth more under plan D (§7.1). It keeps §4.2's contract that only a tick which ran the checks stamps `.supervised`.
- **D-4970** is the empty-server rule (F9): whether the observer's own session may keep an otherwise empty tmux server alive (recommended, still open, §12), or the observer detaches when its session is the last one.
- **D-4971** is the observer's own heartbeat, written only when earned. It is a different file from the supervisor's `.supervised`.
- **D-4972** is wake routing: a FIFO waiter in each supervisor, with a jittered fallback to `sleep`. It edits the loop lines W1 touches first (§3.5).

---

*Written by Claude for #387. Posted for operator review before any code lands.*
