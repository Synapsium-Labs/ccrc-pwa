# Limit park and wake — Implementation Plan

**Design:** `docs/superpowers/specs/2026-08-28-limit-park-and-wake-design.md`.
Read it first; this plan does not restate the reasoning, only the work.

**Subject:** the fleet loses work to usage limits it can see coming back. A
parked session is indistinguishable from an idle one, ccd's only detector does
not match the banner Claude Code emits today, the rescue is silent exactly where
it fails, and mail addressed to a parked worker is consumed rather than deferred
— silently, in under the length of the window it is waiting out.

**Status: NOT STARTED.** Nothing below is implemented. This document is the plan
only.

## Global constraints (every task inherits these)

1. **Additive wire only.** `FLEET_PROTO` stays 1, absence permits, one reader per
   field, and any persisted `FleetSession` field is added to
   `reviveFleetSession`'s returned **literal** so a missed path is a compile
   error.
2. **A new vocabulary is a union + a total `Record` map + a derived runtime
   list**, spelled once in `shared/`. A hand-written array beside the type fails
   `single-definition.test.ts`.
3. **No second copy of a policy constant.** The park predicate derives its
   ceiling from `SWAP_CEILING`; it does not declare a number.
4. **Epoch discipline.** `~/.cc-limits` and the registry are epoch **seconds**;
   coord columns and watcher clocks are **milliseconds**. Convert at exactly one
   named seam. This is a 1000× defect every existing test stays green through.
5. **No new ccd verb, no new `EXEC_COMMANDS` entry, no whitelist widening.**
   `capture-pane` and `send-keys` are already granted in both fleet modes.
6. **AGENT-FIRST** for anything touching `ccd/` or `session-hook.sh`: it ships to
   the fleet box before the server.
7. **Mutation-table discipline.** Every guard ships with a test measured RED
   before the guard exists — measured, not asserted in a comment.
8. **Fail-off polarity.** An unreadable store, registry or switch reads as
   *feature disabled*; the fleet then behaves exactly as it does today.
9. **Safety.** No task runs `ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive` or
   `ws-restore`, and none touches tmux, `~/.cc-sessions`, `~/.cc-limits` or
   `claude-session@*` units out of band. Tests use fixture `HOME`s
   (`makeCcdHarness`) exclusively.

## Ledger

D-numbers are **allocated at run-open** from `POST /api/ledger/deviations`
(box-token gated, `count` 1..100), never hand-picked. The highest number readable
on `origin/main` at `05be5a6` is **D-945**, in both docs and source; a fresh seed
scan would compute a floor of 995 (`max + LEDGER_SEED_GAP`). Allocate the
programme's whole block at run-open and record every allocated number in the
`## Deviations found` section below as it is spent.

## Deviations found

*(empty — nothing is implemented; entries are appended as tasks land)*

## Measurements owed before Wave 1 closes

Each is one command on a genuinely limit-blocked pane. None blocks starting Wave
1, and each one narrows a guess in the design:

| M | Question | Command / where |
|---|---|---|
| M1 | What does the live status file report at the banner — `idle`, `busy`, `waiting`? | `<cfgDir>/sessions/<pane-pid>.json` |
| M2 | Does a limit-killed turn fire the `Stop` hook? (if not, hookstate freezes at `working` and dispatch refuses `worker-busy` for 30 min) | `$REG/<id>.hookstate.json` |
| M3 | How many lines does the banner occupy, and does `❯` survive inside `tail -8`? | `tmux capture-pane -p -t <id> \| tail -8` |
| M4 | How often does Claude Code invoke the statusline command? (bounds how stale a captured `resetAt` can be) | observe `~/.cc-limits/<a>.json` mtime |

M1 decides how much of §1.4's burn is happening today rather than in principle.
M3 decides whether ccd's rescue is reachable at all for a blocked pane, and it is
the one measurement Wave 1 Task 2 should be sized against.

---

# Wave 1 — make it visible. No behaviour change.

Ends with the console able to say: *these sessions are parked, for this reason,
until this instant.* Nothing is deferred and nothing is released.

### Task 1 — the park vocabulary (L0)

`shared/park.ts`: the `ParkReason` union, its total `Record` map carrying
`releasable`, `nextAction` and the label, `PARK_REASONS = Object.keys(...)`, and
the three-kind `Resume` union with `confidence` and `because`.

**DoD:** the map is total; the runtime list is derived; `single-definition`
passes; a test enumerates every member and goes red when one is deleted or when
`auth-lost` and `limit-7d` are given the same `releasable` value.

### Task 2 — un-collapse and re-point ccd's classifier (AGENT-FIRST)

`_pane_hard_blocked` returns **which** class it matched (R5 / account-provisioning
§7.3), and the alternation is corrected for the wording Claude Code emits today
(`hit your .*spend` → the limit form as well). The `tail -8` window is **not**
widened — R9 records that as a deliberate trade against restored scrollback.

**DoD:** a fixture module of literal banner strings shared across the bash/TS
boundary (the `rollover.ts` precedent), containing the real strings measured in
the design's §1.2; removing any alternative goes red in **both** languages; the
rescue's policy is unchanged (it may still treat every class alike — only the log
line and the marker must not).

**Note the ordering hazard:** this task widens a trusted actor's reach. Sessions
ccd could not previously see become swap-eligible, together, at a reset boundary
— and those are restarts. It must not deploy ahead of Wave 3 Task 12's slot. See
"Wave order" below.

### Task 3 — the server-side classifier (L1)

`server/src/pane/block.ts`: `classifyPaneBlock(paneText, ...) -> ParkReason |
null`, pure over a string, fed by the whole-pane capture `detectDialogs` already
takes for every registered session every 2 s.

**DoD:** zero additional tmux calls (assert the call count); the same shared
fixture corpus as Task 2; `unknown-block` is returned for a pane that clearly
refuses without matching a known class; `self-waiting` requires positive
evidence; **ready-marker precedence** — a pane at a live prompt is not parked
whatever text sits above it, driven by a fixture containing the whole banner
corpus above a healthy prompt (the shape of a session reading this feature's own
test file); and a `limit-5h`/`limit-7d` park additionally requires telemetry to
agree the account is at the ceiling.

### Task 4 — the park join and the measured-limits port (L1 + L2)

The join is on `$REG/<id>.wrapper`, never `home` and never the id prefix. Limits
are consumed through a port declared by this consumer returning `MeasuredRead`,
so a link outage lands in `Resume.because: 'unreadable'`. The resume instant is
the account's — the later of the blocking windows' resets, `max(five, seven)`
semantics — never the window the banner happened to name, and never a wall-clock
time parsed out of banner text. A park is invalidated by an **identity change**
(`lastswap` or `.uuid` moving), because a swap puts the session on a different
account and the stored instant is then about somebody else's window.

**DoD:** a test goes red if the join uses `home`; if the release path keys on
`five === 0` rather than `fiveRolledOver === true`; if a `~/.cc-limits` epoch is
read as milliseconds; if a park survives a `lastswap`/`.uuid` change; if a park
clears on the absence of a banner or on a `null` capture; or if the release
instant follows the banner's named window while the other window is still over
the ceiling.

### Task 5 — the wire axis (L0 + L4)

`FleetSession.limitPark: { at, reason, resume, source } | null`, additive, added
to `reviveFleetSession`'s literal. Absent → null; an unrecognised reason rejects
the whole snapshot (the `hookState` contract).

**DoD:** `fleetstate.test.ts`-style compatibility case for a snapshot that
predates the field; no `FLEET_PROTO` change; exactly one reader.

### Task 6 — surfaces

The session row's park chip; the accounts screen's calendar, built by **unioning
roster with accounts** so a never-reporting account is a row that says so; the
fleet headline ("N of M accounts; next capacity at T"), derived from raw epochs,
never from `formatReset` (R6).

**DoD:** an account with no telemetry file appears; a `Resume.kind: 'unknown'`
row states *why*; no second copy of the rollover rule in the PWA.

### Task 7 — stop the console lying, and record the silence

The "✓ Finished — back to idle" push must not fire for a turn refused by a limit.
`_auto_swap_check`'s no-destination branch stops returning silently: it records
the fact (AGENT-FIRST; `notify.sh` is already installed by the agent lane and is
already an authenticated fleet→server channel).

**DoD:** a test goes red if the finished-push fires on a parked row; the
no-destination branch writes exactly once per episode, not once per 5 s tick.

### Task 8 — the divergence alarm

If telemetry says accounts are pinned and sessions sit idle on them while the
banner lane has matched nothing for longer than a threshold, the console says so.

**DoD:** a test drives the 2026-08-28 shape — real telemetry, a banner string the
classifier does not know — and the alarm fires. This is the only mechanism in the
plan that would have caught the design's §1.2 without a human noticing.

---

# Wave 2 — stop making it worse, and give the operator the manual twin

Still no automatic release. The only behaviour change is *less* action.

### Task 9 — the mail park conjunct

One conjunct in `sweepMail`'s existing gate stack: a recipient parked in a class
that cannot take a turn is `backOff(id, 'recipient parked: <class> until <t>',
releaseAt, /* countsAsAttempt */ false)` — the shipped `unmeasurable` precedent.

**DoD:** both arms of `dueDeliveries` are suspended (never-delivered selection
*and* the post-delivery replay clock) — a test goes red if only one is;
`MAIL_MAX_ATTEMPTS` never accrues; `tellSender` fires once per **park identity**
(session + class + window, its own column — never the rendered `lastError`,
which re-confirmation rewrites hourly), and a test drives two re-confirmations
and four workers sharing one sweep to prove it stays at one; a `never`-releasable
park escalates after `PARK_ESCALATE_MS` to `rejected('parked:<reason>')`, and a
test goes red if that is folded into `undeliverable`; no deferral stands past
`PARK_DEFER_MAX_MS` without re-confirmation; a `lastswap` freshness conjunct
refuses to type into a session whose pane a swap is currently tearing down; and
any state rewind is one synchronous store method with the whole guard in the
`WHERE` clause, returning `changes`, with no await inside the decision.

### Task 10 — admission control at dispatch, which DEFERS and never refuses

Nothing is handed to a session whose account cannot take a turn. This is F8
(2026-08-12, live) closed: a dispatch spawned a worker onto a rate-limited
account, the unrecognised limit screen pushed the spawn past the agent's 90 s
budget, and the kill orphaned a fully-registered session.

**It must defer, not refuse.** A refusal leaves no delivery row, and the release
path has nothing to act on — a five-hour wait becomes a permanently undispatched
wave. The brief is queued and parked; the release re-offers it.

**DoD:** a test reproduces F8's shape and the dispatch parks rather than
spawning; a second test proves the parked brief is re-offered after the window
turns; a third proves a deferred brief does not silently hold the run's
concurrency slot for the length of the park.

### Task 11 — the manual twin, and the skills learn the word

**Wake now** (the same release path, skipping queue spacing but *not* the idle,
draft or still-pinned gates), **Don't wake**, **Move to another account** — on
the screen Wave 1 built. For a session with nothing owed, the payload is Claude
Code's own resume text, copied verbatim rather than invented. The coordinator and
worker skills gain the vocabulary; their clauses are pinned verbatim, so the
edits are deliberate and the pins move with them.

**DoD:** every automatic act in Wave 3 has a human equivalent that shipped first;
the three shipped sentences that assert waiting cannot help (`ccd:11855`,
`SessionActionsSheet.tsx:331`, `:482`) are re-worded per reason and stay correct
for `auth-lost`.

---

# Wave 3 — the release, earned

### Task 12 — the shared release slot (AGENT-FIRST)

One non-blocking `flock -n` slot on `$REG/.release.lock`, plus a last-grant
stamp; `release.log` records every grant **with the time it waited**. Extended to
`_dispatch_swap`, the single chokepoint every swap already passes through, so the
bound covers ccd's restarts and not only our keystrokes.

**DoD:** a supervisor that cannot take the lock skips its tick rather than
queueing; a stuck lock is visible (the waited column is the observable); every
epoch read off disk is validated as digits before arithmetic, because ccd runs
`set -uo pipefail` and a hand-edited field otherwise prints on every tick.

### Task 13 — `selectReleases` (L1, pure, injected clock)

Probe-first: at a reset boundary the new window is unmeasured, so the answer is
`unknown`, and `unknown` admits exactly **one** session per account — chosen
deterministically **among deliverable candidates**, so a restart picks the same
one and a session that can never be delivered to does not block the account. The
in-flight token is a **lease with an expiry**, not a flag. The bound reads a
durable last-grant stamp on every evaluation, never a process-lifetime field.
Elapsed time comes from a monotonic clock; instants stay wall-clock.

Releasing is an **act**: a candidate whose park has cleared claims a slot before
its row is made due. Deriving the park is right; deriving the release is not.

**DoD:** a test goes red if a second session on an unmeasured account is
released; if a `never` reason is released, one case per member; if the probe is
chosen without a deliverability check; if the token has no expiry; if a restart
between two releases loses the bound; if a backwards clock step freezes the lane;
and if release is reachable without claiming a slot.

### Task 14 — the switch, and the restart story

`POST /api/wake/pause`, ungated by the box token for D-282's own reason: the
actor holding the token is the one that may be wedged. Disarmed by default and a
*mode*, not a phase — detection, classification, deferral and every surface keep
running while the release does not.

**DoD:** a restart at a reset boundary does not storm — the priming tick's "no
storm on boot" discipline extends to this lane, because `mailCooldown`,
`mailInFlight` and `lastMailSweep` are in-memory and a restart clears them.

---

## Wave order, and what forces it

R2 (ship the measurement, let it be trusted, automate later) is the procedural
reason, and it is also the safe order for R4.

The hard constraint is narrower and easy to get wrong: **Task 2 must not deploy
without Task 12.** Fixing ccd's detector makes the rescue reachable for sessions
where it has been structurally dead — and not at the next reset boundary, but
**within one 5-second supervise tick of the deploy landing**. Every supervisor on
every pinned account classifies the banner in the same tick and dispatches
together. That is the 2026-08-13 shape (six restarts, 19 concurrent ~2 GB scans,
a 9.7-hour box stall) reproduced by a bug fix, at a moment nobody is thinking
about windows. Either land Task 12's slot first, or land the two together in one
agent deploy.

## What this plan deliberately does not do

- Revive, restart, resupervise or swap anything. The release is a keystroke into
  a live pane and nothing else.
- Widen ccd's pane window (R9).
- Add a systemd or launchd timer (R3).
- Store the park as truth. It is re-measured from evidence the watcher already
  collects; `coord.db` holds only release bookkeeping and the audit trail.
- Promise that work in flight survives. Even Claude Code's own resume does not:
  a parked session's subagents are gone. "Released" means the session can act
  again.
