# Claude Code binary lifecycle, wave 5: the automatic roll — the scheduler, halts and failures, the retreat's one-tap pin, the Settings controls, then shadow and live — Implementation Plan

> **For agentic workers:** one PR per task, in the order of §Landing order. REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. CB5a and CB5b are band 3 (they decide when sessions restart), written and reviewed natively, never handed off, **two reviewers**. Workers do not edit §Deviations and decisions.

**Spec:** `docs/superpowers/specs/2026-10-18-claude-binary-lifecycle-design.md` (rev 3, approved by the operator 2026-10-19: "all cards accepted/answered"). §7.4, §10.1 to §10.4 and §12 bind this plan in full.

**Status:** rev 1 (2026-10-19): rev 0 with two reviews applied (§Review log); written with the spec's rev 3, the other wave plans and the ledger. No automatic roll runs on a node until the operator's act OA-6 there.

**Inputs.** The spec's §7.4, §10.1, §10.3, §10.4, §11 (W5), §11.1 (M3); the operator's rulings 2, 3, 6, 9, 10, 12, 13 and 16, and the 2026-10-19 swap ruling; the hibernation plan (`2026-10-16-working-state-and-interruptions.md`): `HIBERNATE_SWEEP_MS` and `HIBERNATE_PER_SWEEP` (`server/src/coord/hibernate.ts` ≈:80, ≈:85), the sweep (`server/src/hibernateSweep.ts` `hibernatePass` ≈:158), the stop-finished-workers lane (`server/src/stopDoneSweep.ts` `stopDonePass` ≈:168, Task 15b), the wake budget (`server/src/coord/wakeBudget.ts`, `WAKE_BURST` ≈:17, `wakeAdmit` ≈:26), Task 19's shadow week and stop rule; the update plane's notifier (`server/src/update/notify.ts`) and capability idiom (`moveRefusal`'s `no-update-gate`, `server/src/update/dispatch.ts` ≈:159); the Settings plan's R1b `AckConfirm` (`pwa/src/fleet/updateAck.ts`); W1's §Global constraints, binding here in full.

**Base:** `origin/main` `f82d0c015` (#701). `GET /api/fleet/health` is `server/src/server.ts` ≈:1309.

**Deploy class.** CB5a and CB5b are server lane (the fleet half, `ccd roll` and the switches, shipped in W1 and W2). CB5c is PWA. Then the operator act OA-6, per node.

**Names.** Tasks **CB5a** to **CB5c**; operator act **OA-6**.

---

## Gates

Measured on 2026-10-19 at `f82d0c015`. No open PR holds `server/src/hibernateSweep.ts`, `server/src/stopDoneSweep.ts`, `server/src/coord/hibernate.ts`, `server/src/coord/wakeBudget.ts` or `server/src/update/notify.ts`. **#397** holds `server/src/server.ts` and `shared/api.ts` (CB5a's health counts, CB5b's ack routes' wire types); W2 and W3 waited for it, so it is expected merged; if not, CB5a and CB5b wait.

| Task | Open PRs | Earlier waves | Other |
|---|---|---|---|
| CB5a scheduler, shadow | #397 if open | W2 (all), W3 (all), W4 | **M3** in Step 0 |
| CB5b halts, failures, retreat | #397 if open | CB3a (the tables), CB3d | CB5a |
| CB5c Settings controls | — | CB3j | CB5b; Settings R2b2 |
| OA-6 per node | — | CB5a to CB5c deployed; OA-3 passed on that node's pair | one reviewed shadow week; never during hibernation Task 19's shadow week or first armed day |

## Landing order

```
CB5a (scheduler, shadow; M3) ── CB5b (halts, failures, retreat) ── CB5c (Settings: auto, Ack, Pin to)
--- operator, per node ---
OA-6: review the shadow week (it runs in manual) ── set mode auto ── ccd claude roll-live on
```

## Global constraints

W1's §Global constraints bind here in full. In addition:

- **Never a herd.** One roll in flight per node; the next only after the previous outcome row and its health have settled; at least 5 min apart; at most 6 automatic rolls per node per hour; inside one shared per-sweep budget with hibernation and the stop-finished-workers lane (3 fleet-wide, 1 roll per node per sweep); inside `wakeAdmit`'s two per 60 s; behind ccd's `low-memory` and `recent-spawn` holds (spec §7.4, §12).
- **Swap is shown, never a hold** (decision 6). **A swap is never blocked by a roll** (the 2026-10-19 ruling).
- **Shadow first, on every node, before `auto`.** The sweep computes and logs verdicts for every capable node whose first manual canary has passed, whatever its mode; it dispatches only in `auto` with `$REG/claude-roll-live` (spec §10.4, decision 3's order: shadow week → `auto` → live).
- **Never during Task 19's shadow week or first armed day** (decision 13), **enforced in the act path**: the sweep holds `hibernation-arming` from the node file's `switches.hibernateShadowAt` (younger than 8 days) and `switches.hibernateLiveAt` (younger than 24 h), and passes `--auto` so ccd holds it too, even when `roll-live` is already on; hibernation's arming stays its own decision (decision 16).
- **A retreat is not a halt** (decision 12): it blocks automatic rolls onto its build and nothing else; nothing reads `on-halted` from it.

## Review focus

1. **Two lanes doubling the kill herd.** Rolls, hibernations and stop-done draw from one budget (CB5a).
2. **The serialiser held across a spawn.** `coordMutex` and the session queue are held only for the verdict and the dispatch (CB5a).
3. **A silent node.** The shadow logs each hold by name at most once per id per hour and exposes the counts on `/api/fleet/health` (CB5a).
4. **An automatic downgrade.** A halt pins nothing; a halt of a current target rolls nothing back; a retreat is its own record and only offers a pin (CB5b, decisions 10 and 12).
5. **A halt that clears itself.** Only the operator's Ack clears it; a newer build gets its own canaries (CB5b, decision 9).
6. **`auto` on a node that cannot.** `auto` applies only when the node's `ccd caps` lists `roll` and its row was re-measured since the mode was set; a node back from offline canaries again (CB5a).

## Tasks

### Task CB5a: the roll scheduler, its budgets and its shadow (D-5722; spec §7.4, §10.4's modes and shadow) — GATED: after W2, W3 and W4, and M3

**Routing:** band 3, **two reviewers** (decides when sessions restart). **Lane:** server. **Needs:** every earlier wave; **M3** in Step 0.

**Files:**
- Create `server/src/rollSweep.ts`: a pass inside the hibernation sweep's clock (`HIBERNATE_SWEEP_MS`, 5 min), after `hibernatePass` and `stopDonePass`, drawing from the same per-sweep budget (`HIBERNATE_PER_SWEEP`): for each capable node with a fresh measurement whose first manual canary has passed (**any mode**, so the shadow week can precede `auto`): no `hibernation-arming` (the node file's `switches.hibernateShadowAt` younger than 8 days or `switches.hibernateLiveAt` younger than 24 h), no roll in flight, the last outcome and its health settled, 5 min since the last roll, fewer than 6 this hour; the first behind (or `on-halted`) session by `rollVerdict` (CB2g, the 90 min window, decision 2) passing `wakeAdmit` as an automatic wake; the canary rule (the first roll on a pair with no passed canary for the candidate is its canary); a build in the projection's `retreats` is never the `to` of an automatic roll. It holds `coordMutex` and the session's queue only for the verdict and the dispatch. It **dispatches** (`ccd roll … --auto`) only when the node's mode is `auto` **and** `$REG/claude-roll-live` exists (reported in `claude.json`'s `switches.rollLive`); otherwise it logs `claude-roll-shadow <id> from=<v> to=<v>` and each hold by name, at most once per id per hour, and acts on nothing.
- Modify `server/src/hibernateSweep.ts` (the shared budget) and `server/src/server.ts`'s `/api/fleet/health` (≈:1309): the last sweep's counts by hold.
- Modify `server/src/update/routes.ts`: `POST /api/claude/intent` accepts `mode: 'auto'` for a node whose capability and measurement allow it, else `409` with the reason.
- Create `server/test/roll-sweep.test.ts`.

- [ ] **Step 0: M3, in a development fixture** (no `-p` turn on the fleet): during an idle compaction, is `esc to interrupt` shown, and does the transcript mtime move. If compaction is visible to `_idle_for_keystroke`, the PR says so and the window stays 90 min (decision 2) until the operator revisits it; the `compacting` hold stays either way.
- [ ] **Step 1: Red.** "two behind sessions on one node: one roll this sweep, the next only after the outcome settles"; "a hibernation and a stop-done in the same sweep leave one roll slot of three"; "5 min spacing"; "the seventh in an hour waits"; "a wake budget at its burst defers the roll"; "a swap in flight is never delayed: the roll holds `swapping`"; "no `roll-live`: shadow lines and hold counts, no dispatch"; "a `manual` node whose first canary passed logs shadow lines and dispatches nothing"; "`roll-live` on and `hibernate-live` 1 h old: no automatic dispatch, `hibernation-arming` counted"; "`hibernate-shadow-week` 3 days old: no automatic dispatch"; "every dispatch carries `--auto`"; "a retreat's build is never an automatic `to`"; "a hold is logged at most once per id per hour"; "`auto` refused for a node without `roll` in its caps"; "a node back from offline canaries again"; "`coordMutex` is released before the act's outcome".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | a separate budget for rolls | roll-sweep | "leave one roll slot of three" |
  | the in-flight check removed | roll-sweep | "one roll this sweep" |
  | `wakeAdmit` skipped | roll-sweep | "defers the roll" |
  | shadow acts | roll-sweep | "no dispatch" |
  | the mutex held across the outcome | roll-sweep | its case |
  | the hour cap 12 | roll-sweep | "the seventh … waits" |
  | the shadow only for `auto` nodes | roll-sweep | "a `manual` node … logs shadow lines" |
  | `hibernation-arming` read only at `roll-live on` | roll-sweep | "`hibernate-live` 1 h old: no automatic dispatch" |
  | `--auto` omitted | roll-sweep | "every dispatch carries `--auto`" |

- [ ] **Step 4: Verify.** `tsc --noEmit`; the suite alone; `hibernate-sweep.test.ts` and `stop-done-sweep.test.ts` alone.

### Task CB5b: halts, roll failures, the rollback off a halted build, and the upstream retreat (D-5723; spec §10.1, §10.3, decisions 9, 10 and 12) — GATED: after CB5a

**Routing:** band 3, **two reviewers**. **Lane:** server. **Needs:** CB5a; CB3a's tables; CB3d.

**Files:**
- Create `server/src/update/claudeHalts.ts`: a halt is raised by a failed canary (CB3d's `failed` rows), a failed restore, two post-kill roll failures onto one build within 24 h on any node (`claude_roll_failures`), or the operator; it writes `claude_halts`, re-projects every node, and notifies once (kind `update`, "Claude Code 2.1.303 failed its canary on the fleet node: <reason>; nodes stay on their current build", opening Settings), journalled in `claude_intent_log` with the automatic actor; **nothing is pinned** (decision 10). A single failure records `claude_roll_failures` and the session holds `roll-failed`. Each halt is scoped: **`candidate`** for a build that is no pair's current target (a session on it reads `on-halted` and CB5a rolls it back to its pair's target under the same gate), **`target`** for a build that is some pair's current target (it blocks only promotion and new rolls onto it; sessions on it stay `current`, nothing is rolled back, it is never written to the node's `claude-halted`, and only the operator's Pin moves the target down). An `upstream-retreat` from any node is **not a halt**: it writes a `claude_retreats` row (projected in `retreats`), which only candidate selection and new automatic rolls read, and notifies with a one-tap **Pin to 2.1.x** (decision 12); the launcher, the prune, `on-halted` and the rollback ignore it.
- Modify `server/src/update/routes.ts`: `POST /api/claude/halts/:build/ack`, `POST /api/claude/roll-failures/:id/ack` and `POST /api/claude/retreats/:build/ack`, operator-cookie, non-exempt, journalled. Ack clears the halt, not the pin (decision 9).
- Modify `server/src/fleet.ts`: `on-halted` from `candidate`-scoped `claude_halts` only.
- Create `server/test/claude-halts.test.ts`; modify `server/test/auth-gate.test.ts`.

- [ ] **Step 1: Red.** "a failed canary halts the build on every node and pins nothing"; "one roll failure records a row and holds `roll-failed`; the second within 24 h on another node halts"; "a newer build is not blocked by an older build's halt"; "a halt clears only by Ack; a newer build passing its canary does not clear it"; "`on-halted` sessions are rolled back under the gate"; "a retreat notifies with the pointer's build and selects nothing"; "a retreat leaves sessions on the current target `current`, rolls nothing and pins nothing"; "a halt of the current target produces no `on-halted`, no rollback and no downgrade"; "one push per halt".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | a halt writes a pin | claude-halts | "pins nothing" |
  | a newer build halted with the older | claude-halts | its case |
  | auto-clear on a newer canary | claude-halts | "clears only by Ack" |
  | the 24 h window 48 h | claude-halts | its case |
  | the retreat selects the pointer | claude-halts | "selects nothing" |
  | the retreat written as a halt | claude-halts | "leaves sessions … `current`" |
  | a target-scope halt marks `on-halted` | claude-halts | "no `on-halted`, no rollback" |

- [ ] **Step 4: Verify.** `tsc --noEmit`; each suite alone.

### Task CB5c: the card's automatic controls — auto, Ack and Pin to (D-5724; spec §6.3, decisions 3, 9, 12 and 14) — GATED: after CB5b

**Routing:** band 2. **Lane:** PWA. **Needs:** CB5b; CB3j; Settings R2b2.

**Files:**
- Modify `pwa/src/screens/settings/AutomationSection.tsx`'s Claude Code mode card: `auto` offered per node only when the server reports the node eligible (its first manual canary passed; decision 3), with a sentence naming the shadow week and OA-6.
- Modify `pwa/src/screens/settings/ClaudeCodeCard.tsx`: halted builds with their reason and **Ack** through R1b's `AckConfirm`; roll failures with Ack; the retreat's one-tap **Pin to 2.1.x**; the shadow's hold counts from `/api/fleet/health`; each node's kill switches, read-only.
- Modify `pwa/src/session/sessionFacts.ts`: `on a halted build`, `roll failed, back on 2.1.296`.
- Create `pwa/test/claude-code-auto.test.tsx`.

- [ ] **Step 1: Red.** "`auto` not offered for an ineligible node"; "Ack opens `AckConfirm`, Cancel focused"; "Pin to is one tap and names the build"; "the kill switches offer no control"; "the hold counts are words, not codes".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `auto` always offered | claude-code-auto | its case |
  | Ack one tap | claude-code-auto | its case |
  | a kill switch toggle rendered | claude-code-auto | its case |

- [ ] **Step 4: Per width × skin × mode** (the Settings plan's 32 cells), with `AckConfirm` open at 390 and at 900 or wider, both skins, both modes.
- [ ] **Step 5: Verify.** `cd pwa && ./node_modules/.bin/tsc --noEmit`; the suite alone.

## Operator acts

- **OA-6, per node: review the shadow week, set `auto`, then go live** (decisions 3 and 13), in that order. With CB5a to CB5c deployed and the node's first manual canary passed, the shadow runs while the node is still `manual`: one week of shadow lines and hold counts on `/api/fleet/health`, reviewed by the operator; then mode `auto` for the node in Settings (still no dispatch); then, on the fleet node, `ccd claude roll-live on` (the ask names the SAFETY rule: the marker is the operator's, no session writes it). **Never** during hibernation Task 19's shadow week or its first armed day: `roll-live on` refuses while `hibernate-live` is younger than 24 h or `hibernate-shadow-week` is younger than 8 days, and the sweep and ccd hold `hibernation-arming` for automatic rolls in the same windows even if `roll-live` is already on. When hibernation's Task 19 shadow week starts, the operator runs `ccd claude shadow-week on` on the node (and `off` when it ends). Watch the first day as hibernation's Task 19 watches its own: rolls by outcome, any OOM kill within 120 s, slice and user-tree `anon` within 1 GiB of the binding cap; at any doubt, `ccd claude roll-live off` (or `roll-disable`, which stops every roll, manual included).

## Rollback

Per node: `ccd claude roll-live off` stops every automatic dispatch at once (the shadow keeps logging); `ccd claude roll-disable` stops manual rolls too. Then set the node's mode to `manual` in Settings. Only then roll the server lane back (CB5a to CB5c); the fleet lane is unchanged by this wave. Halts, retreats and roll-failure rows stay in `coord.db` and stay projected until acked.

## Deviations and decisions

### Issued for this work and defined here

From this programme's block, D-5695 to D-5724, this plan defines D-5722 to D-5724. The spec's §14 cites D-5722 and D-5723. Every number of the block is defined (W1: D-5695 to D-5702; W2: D-5703 to D-5710; W3: D-5711 to D-5720; W4: D-5721; here: D-5722 to D-5724).

- **D-5722** — `roll-scheduler-memory-aware` (Task CB5a; spec slug): the automatic roll is scheduled by the server inside the hibernation sweep's clock, serially per node (the next only after the previous outcome and its health settle), at least 5 min apart, at most 6 per node per hour, from one per-sweep act budget shared with hibernation and the stop-finished-workers lane, inside the wake budget, with the serialiser held only for the verdict and the dispatch; ccd re-checks headroom (3 GiB of `anon` against the binding cap, swap never a hold) and `recent-spawn` at the act; the shadow runs for every capable node whose first manual canary passed, in any mode, and dispatch needs `auto` and `roll-live`; `hibernation-arming` is held in the act path (decision 13); `auto` applies only to a capable, re-measured node; the window is 90 min (spec §7.4, §10.4; decisions 2, 3 and 6).
- **D-5723** — `claude-canary-and-auto-roll` (Tasks CB2e, CB3d, CB5b, CB5c; spec slug): selection is two-phase, a candidate then an approved target per (node, lane kind), gated by a canary judged by ccd; a failed canary, a failed restore, two roll failures onto one build in 24 h or the operator halt the build everywhere, pin nothing (decision 10), notify once, and clear only by the operator's Ack (decision 9); a halt is scoped `candidate` (sessions on it are rolled back to their target) or `target` (it blocks promotion and new rolls only, and never rolls back or downgrades); an upstream retreat is its own record, never a halt, offers a one-tap pin and never downgrades (decision 12); modes `off | manual | auto`, `auto` per node after its first manual canary and one shadow week (decision 3); the operator's kill switches (D-5697) (spec §10.1, §10.3, §10.4).
- **D-5724** — `claude-auto-controls` (Task CB5c): Settings offers `auto` for a node only once the server reports it eligible, shows halts and roll failures with Ack through `AckConfirm`, the retreat's one-tap Pin to, the shadow's hold counts in words, and each node's kill switches read-only (decision 14; spec §6.3).

## Out of scope

Arming hibernation (decision 16, hibernation's Task 19); changing hibernation's gate or its N; per-session pins; rolling processes ccrc does not supervise.

## Review log

**rev 0 → rev 1 (2026-10-19).** Two reviews of the spec's rev 3 and the five plans, both NEEDS REVISION. The rows below touch this plan; the spec's §17 carries all of them.

| Finding | Verdict | What changed here |
|---|---|---|
| An upstream retreat modelled as a halt made every session `on-halted` and invited a downgrade; a halt of a current target had no outcome | applied (both reviews) | CB5b: `claude_retreats`, scoped halts, red cases for both |
| OA-6's shadow needed `auto` first, against decision 3's order | applied | CB5a shadows every capable node with a passed canary in any mode; the landing order and OA-6 read shadow week → `auto` → live |
| U13 enforced only at `roll-live on` | applied (both reviews) | CB5a holds `hibernation-arming` and passes `--auto`; OA-6 names `ccd claude shadow-week on` |
| No wave stated its rollback | applied | §Rollback |
