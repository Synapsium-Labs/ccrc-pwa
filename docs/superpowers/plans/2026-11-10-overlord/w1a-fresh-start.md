# Overlord W1a: ccd's fresh-start flag and its capability word `hibernate-fresh` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ccd hibernate --roll --fresh <id>` ends a session's conversation and starts a fresh one under the same
session id, and `ccd caps` advertises it as `hibernate-fresh`. The server's `CcdArgv` builder can send it, behind that
word. Nothing on the server sends it yet: the renewal-act piece is its first caller.

**Why:** a renewal is the server's act, in the same session, with a fresh context (spec §3.3.1, C36). Its adapter is
the roll's own verb with a fresh-start flag (§3.3.11, H13), so no verb is added. W0a measured a fresh start reaching
its ready prompt in about 0.26 s at p95, and W0b a whole roll in about 7.4 s, so the renewal's deadlines stand.

**Architecture:** ccd only, plus one flag on the server's argv builder. `cmd_hibernate` already sleeps a session and,
with `--roll`, wakes it through `( cmd_ensure "$id" )`, which resumes the conversation because the registry says
`started=1`. That wake runs outside the unit: `cmd_ensure` takes its `CCD_IN_UNIT != 1` branch and calls
`_supervised_start`, and the spawn happens in the unit's own `ccd supervise` process, which re-enters `cmd_ensure` with
`CCD_IN_UNIT=1`. An argument or a dynamic local never crosses that process boundary, and `cmd_ensure` takes ONE
positional by contract (its header: "Do not give this verb another argument", because the agent whitelist grants
`ensure` as a prefix). So `--fresh` crosses through the registry, the way the swap path carries its intent in
`lastswap`: before the wake, `cmd_hibernate --roll --fresh` mints a uuid, writes it to a one-shot, dot-free marker
`$REG/<id>.fresh` and then as the row's uuid (the marker first, so a uuid written without it still resumes, never the
reverse), and the in-unit spawn (`_spawn_mode`) sees a marker naming the row's own uuid, spawns with `--session-id`
and consumes it. This follows the fresh-start build's code (the coordinator's ruling on R5). One pull request.

**Tech Stack:** bash (`ccd/ccd`), TypeScript (ESM), vitest with `makeCcdHarness`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` §3.3.1 (C36), §3.3.8 (swaps, rolls), §3.3.11 (H13:
"Today's adapter is the roll's own verb with a fresh-start flag (`ccd hibernate --roll --fresh`), advertised by a
capability word of its own, `hibernate-fresh`, beside `hibernate-roll`. It adds no verb. A fresh start never loads the
old transcript, applies a change of model or account in the same step, and works when a session wakes elsewhere."),
Table 11.1c (the `SessionHost` row), Table 11.1d (ccd's capability words).

## What exists today

- `ccd/ccd#cmd_hibernate` parses `--roll`, `--surface`, `--actor`, `--reason`, `--hold-ok` and the id. `--roll`
  (D-7458) refuses on `.no-roll` instead of `.no-hibernate`, hibernates, then calls `cmd_ensure`; it exits 4
  (`roll-wake-failed`), 5 (`roll-wake-unrestored`) or 6 (`roll-kill-failed`). `--roll=*` dies with usage.
- `ccd/ccd#cmd_ensure` takes one positional (a security boundary, its header says). Outside the unit it calls
  `_supervised_start`; inside (`CCD_IN_UNIT=1`, set by `cmd_supervise`, never exported and never an argv token) it
  chooses `mode=new`, or `mode=resume` when `_reg_get "$id" started` is `1`, and calls `_spawn_start "$id" "$mode"`. `_spawn_start` builds `--resume '<uuid>'` for resume and `--session-id '<uuid>'` for
  new, from the registry's uuid; a failed resume retries with `--session-id`.
- `ccd/ccd#cmd_caps` prints its verbs, then capability words by `echo`, `hibernate-roll` among them. The tree's pinned
  list is `server/test/ccdCapTokens.ts#CCD_CAPABILITY_TOKENS`. The agent reads `ccd caps` at boot and on each
  capability refresh (`agent/src/server.ts#readCcdVerbs`), and the server asks `ccdCan` / `capSupported`
  (`server/src/ccdargv.ts`).
- `ccd/ccd#_plat_uuid` mints a lowercase uuid; `_reg_set "$id" uuid` is the registry's uuid writer.
- `server/src/ccdargv.ts`'s `hibernate(id, dec, holdOk, roll)` builds `['hibernate', ...rollFlags(roll), …]`; the
  agent's whitelist entry is `['hibernate']`, one token wide, so a new flag needs no whitelist row.
- `CcdArgv.hibernate` has one call site, `server/src/sleepLane.ts`, which passes its `wake` boolean as `roll`.
- `server/test/ccd-hibernate-roll.test.ts` already stubs `_supervised_start` to drive the roll's supervised path.
- Tests: `server/test/ccd-hibernate-roll.test.ts`, `server/test/ccd-hibernate.test.ts`,
  `server/test/capsupported.test.ts`, `server/test/ccdargv-dec-parity.test.ts`.

## Global Constraints

- **Architecture (`CLAUDE.md`).** ccd is the only component that names tmux and Claude Code's on-disk layout; the
  server reaches it only through `CcdArgv`, built at the call site. The flag is a parameter of the existing builder,
  not a second builder. A guard ships with a test that goes red without it, measured once before commit.
- **SAFETY (`CLAUDE.md`).** No new ccd verb: `--fresh` is a flag of `hibernate`. In tests, fixture HOMEs only, through
  `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`); never run `ccd` against the live `$HOME`, never touch
  tmux, `~/.cc-sessions` or a `claude-session@*` unit. The flag is the server's to send: nothing in this piece lets a
  session run it, and it is not added to any session-facing surface.
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`; the last run adds
  `ccrc test -- ./node_modules/.bin/tsc --noEmit` and
  `ccrc test -- ./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit`. The ccd suites are load-sensitive: re-run
  a red one alone before calling it a break.
- **Growth check.** `ccd/ccd` grows at most `GROWTH_LIMIT` (40) net lines in this pull request
  (`server/test/growthCheck.ts`). The fresh path reuses `cmd_ensure` and `_spawn_start`; if it cannot fit, ask the
  coordinator for a waiver number before pushing.
- `ccd/ccd` carries no committed stamp; nothing to restamp. Cite by function name or `@anchor`, never by line.
  Fixture ids `lane-a-project-a`. No private names. No D-number invented; departures go in
  `docs/superpowers/plans/2026-11-10-overlord/w1a-fresh-start/departures.md`.

## Review Focus

1. A fresh start never resumes: the spawn line carries `--session-id` with a uuid that differs from the old one, and no
   `--resume`, on the first try and on the retry. The request reaches the in-unit spawn through the marker only;
   `cmd_ensure` keeps exactly one positional.
2. A failed wake (exit 4) leaves no half state: the marker is gone, and the registry's uuid is the old one again, so
   the next ensure resumes the old conversation rather than silently starting a fresh one. An uncertain wake (exit 5)
   restores nothing, because a pane may already run the new conversation. A stale marker is removed and named on
   stderr, never left and never acted on.
3. Every refusal `--roll` has, `--fresh` has too (`.no-roll`, a busy session, a hold), with the same exit codes.
4. A box without the word never receives the flag: the argv builder refuses to add it unless the caller proved
   `hibernate-fresh`.

---

### Task 1: `--fresh` on `ccd hibernate --roll`

**Files:**
- Modify: `ccd/ccd` (`cmd_hibernate` parses `--fresh` and, after the sleep and before the wake, writes
  `$REG/<id>.fresh` = `<new uuid>` and then the row's uuid = `<new uuid>`; the in-unit spawn's mode reader
  (`_spawn_mode`) answers `new` for a marker naming the row's uuid, and `_spawn_start` consumes it, leaving the receipt
  `used <uuid>` once its `tmux new-session` answered 0; `cmd_hibernate` exits 0 only on that receipt, and otherwise exits
  7, `roll-fresh-unproven`, with the old uuid back (reviews 1904 F1 and 1919 R1); `cmd_hibernate`
  restores the old uuid after a failed wake (exit 4); `cmd_ensure` is unchanged and keeps one positional; `_reg_purge`'s
  inventory comment gains `fresh`)
- Test: `server/test/ccd-hibernate-roll.test.ts`, `server/test/ccd-ensure-argv.test.ts` (new, or the existing suite
  that pins `cmd_ensure`'s arity: measure `grep -ln 'ONE POSITIONAL\|cmd_ensure' server/test`)

- [ ] **Step 1: Characterize.** Run `test/ccd-hibernate-roll.test.ts` and `test/ccd-hibernate.test.ts` on the branch
  point. Expected: green; they stay green, unedited.
- [ ] **Step 2: Failing tests** (fixture HOME, the suite's stub `claude` that records its argv):
  - **The supervised path** (the suite's `_supervised_start` stub, as its roll cases use it): `hibernate --roll --fresh
    lane-a-project-a` writes `$REG/lane-a-project-a.fresh` holding one well-formed uuid `u2`, different from the uuid
    before, and the registry's uuid file now holds `u2`, both before `_supervised_start lane-a-project-a` is called with
    no other argument; `swap.log` names both uuids.
  - **The in-unit spawn** (`CCD_IN_UNIT=1`, the suite's stub `claude` recording its argv): with the marker naming the
    registry's uuid `u2`, the spawn has `--session-id <u2>` and no `--resume`; the marker is gone; `started` stays `1`.
  - The stub refusing the first spawn: the retry also carries `--session-id <u2>` (the same new uuid, not a third).
  - **A stale marker** is one that does not name the row's current uuid (the uuid moved on: a swap, a `/clear` the
    registry followed, a restore after a failed wake, or a `cmd_hibernate` killed between its two writes), or that does
    not parse as one uuid: the spawn resumes as today, and the marker is removed and named on stderr (the builder's
    change, ruling m-B7).
  - A `cmd_hibernate` killed after both writes and before the wake leaves a marker naming the row's uuid: the next
    spawn starts fresh under it, which is right, because the row already names a conversation that never started;
    `swap.log` keeps the old uuid.
  - The wake failing (the stub `_supervised_start` returning 1): exit 4 `roll-wake-failed`, as `--roll`; the marker is
    gone and the registry's uuid is the old one.
  - The wake answering exit 5: nothing is restored; the marker and the new uuid stand (the builder's change, m-B6).
  - **The proof (exit 7, `roll-fresh-unproven`):** a wake that answered 0 with no receipt in the marker exits 7, the
    marker gone and the old uuid back, with `swap.log` and a `failed` hibernate row. The cases: a concurrent wake before
    the roll's writes, and one between them (the real `cmd_ensure` as that wake); the consuming spawn's `tmux
    new-session` failing (a lost duplicate-name race); and an account at its ceiling, where the wake's move answers 0
    with no spawn. The renewal act reads 7 as "not renewed, ask again later".
  - `hibernate --fresh <id>` without `--roll` dies with usage (exit 1: `die` is `exit 1`) and touches nothing.
  - `--fresh=x` dies with usage (exit 1).
  - `.no-roll` present: refused exactly as `--roll` is refused, the uuid unchanged and no marker written.
  - `cmd_ensure` given a second argument still refuses it (its arity pin stays green, unedited).
- [ ] **Step 3: Run.** Expected: red.
- [ ] **Step 4: Implement.** The new uuid comes from `_plat_uuid`. After the sleep, `cmd_hibernate` writes the marker
  and then the row's uuid, each through `_reg_set` (never a second writer), and only then runs the wake. The in-unit
  spawn's mode reader answers `new` when the marker names the row's uuid, and `_spawn_start` builds `--session-id` for
  this spawn and its retry and, once its create answered 0, leaves the receipt `used <uuid>`, which `cmd_hibernate`
  requires after a wake that answered 0 (else exit 7); a stale marker is removed and named on stderr. On a wake exit 4,
  `cmd_hibernate` removes the marker if it still stands and writes the old uuid back; on exit 5 it restores nothing. The fresh path changes only the uuid and the flag; everything else `_spawn_start` composes
  (the route's class, effort and account, the settings, the environment) is read at the spawn, so a route write made
  before the act applies in the same step. The marker's name is dot-free, so `_reg_purge` and `_ws_slug_residue`
  already sweep it with its row; add it to `_reg_purge`'s inventory comment, and a case to the purge suite (measure:
  `grep -ln '_reg_purge' server/test`) that a purge removes it.
- [ ] **Step 5: Run** both hibernate suites. Expected: green.
- [ ] **Step 6: Mutation (measured once).** Make `_spawn_start` ignore the marker: the "no `--resume`" case goes red.
  Drop the failed-wake restore: the failed-wake case goes red. Restore on exit 5 too: the exit-5 case goes red. Leave
  a stale marker in place: the stale case goes red. Revert each.
- [ ] **Step 7: Commit.** `feat(ccd): hibernate --roll --fresh starts a fresh conversation under the same session id`

### Task 2: The capability word `hibernate-fresh`

**Files:**
- Modify: `ccd/ccd` (`cmd_caps` echoes `hibernate-fresh` beside `hibernate-roll`)
- Modify: `server/test/ccdCapTokens.ts` (`CCD_CAPABILITY_TOKENS` gains it)
- Test: `server/test/caps-token-shape.test.ts`, the caps suites that read the list (measure:
  `grep -ln CCD_CAPABILITY_TOKENS server/test`)

- [ ] **Step 1: Failing test.** The caps suites read `ccd caps` from a fixture HOME and compare with the pinned list;
  add the word to the list first. Expected: red (ccd does not print it).
- [ ] **Step 2: Implement** the `echo`, with a comment naming spec H13 and the flag.
- [ ] **Step 3: Run** the caps suites. Expected: green.
- [ ] **Step 4: Commit.** `feat(ccd): ccd caps advertises hibernate-fresh`

### Task 3: The argv builder carries the flag, behind the word

**Files:**
- Modify: `server/src/ccdargv.ts` (`hibernate` takes `mode: 'sleep' | 'roll' | 'fresh'` in place of `roll: boolean`;
  `fresh` emits `--roll --fresh`)
- Modify: the one caller of `CcdArgv.hibernate`, `server/src/sleepLane.ts` (measure: `grep -rn 'hibernate(' server/src`),
  mapping its `wake` boolean to `'roll'`/`'sleep'` only
- Test: `server/test/ccdargv-dec-parity.test.ts`, `server/test/capsupported.test.ts`, a case in the builder's suite

- [ ] **Step 1: Characterize.** The existing callers' argv is pinned by their suites; run them. Expected: green.
- [ ] **Step 2: Failing test.** `hibernate('lane-a-project-a', null, null, 'fresh')` is
  `['hibernate', '--roll', '--fresh', 'lane-a-project-a']`; the dec parity suite covers the new arm.
- [ ] **Step 3: Implement.** The builder makes no capability decision; its comment says the caller sends `fresh` only
  where `ccdCan(…, 'hibernate-fresh')` answered yes, and the renewal-act piece adds that check with its caller.
- [ ] **Step 4: Run** the suites above and both `tsc` runs. Expected: green.
- [ ] **Step 5: Commit.** `feat(ccdargv): the hibernate builder takes a mode, sleep, roll or fresh`

## Deviations found

- **D-8251, fresh-start-growth-waiver, scope** (2026-11-13) — ccd/ccd grows past GROWTH_LIMIT by the fresh start's proof: review 1904 F1 makes the consuming
  `new` spawn leave a receipt (`used <uuid>`) in the marker, and `cmd_hibernate` exits 7 `roll-fresh-unproven`, with the
  old uuid back, when a wake that answered 0 left none (a concurrent wake, a lost create or an account move came first). With the marker
  read through `_reg_get_to`, stale removal, and swap.log naming both uuids before the writes, #2742 measures +54 net
  lines in `ccd/ccd` against its merge base. Waived to 70 by `server/test/growth-waivers/D-8251-ccd-ccd.json`.

Decisions this plan takes, by slug:

- **fresh-is-a-roll-mode** — `--fresh` is accepted only with `--roll`, so it inherits the roll's refusals and exit
  codes, plus its own exit 7 (`roll-fresh-unproven`, an unproven fresh start), and the builder's boolean becomes a three-word mode.
- **fresh-crosses-by-marker** — the fresh request reaches the in-unit spawn through a one-shot, dot-free registry
  marker (`$REG/<id>.fresh`), never an argument, so `cmd_ensure` keeps its one positional; a failed wake (exit 4)
  removes the marker and restores the old uuid. The name `fresh` is the one the build chose and the coordinator ruled
  on; Table 3.6a lists the marker, with one writer (`ccd hibernate --roll --fresh`), consumed by the in-unit spawn (which leaves the receipt the roll
  reads as its proof), and
  no authority and no switch (this programme's spec amendment).
- **marker-follows-the-build** — the marker holds the new uuid only, and `cmd_hibernate` writes it and then the row's
  uuid before the wake; the spawn acts on a marker naming the row's own uuid (the coordinator's ruling on R5).
- **stale-marker-removed** — a marker that does not name the row's uuid, or does not parse, is stale: removed and named
  on stderr, never acted on; a killed roll that wrote both starts fresh under the uuid the row already names (m-B7).
- **restore-on-exit-4-only** — only a failed wake restores the old uuid; an uncertain one (exit 5) restores nothing,
  because a pane may already run the new conversation (m-B6).

## Where things stand

**Needs before it starts:** nothing beyond `main`.

**What depends on it:** the renewal-act piece (the `SessionHost` adapter's `renew`), and W1's designate and rebind doors,
which refuse `capability-missing` without `hibernate-fresh` (Table 11.1d).

**Open questions for the operator:** none.
