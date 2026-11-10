# The operator's three rulings ride every spawn's settings

## Goal

Three of the operator's 2026-11-10 rulings (session host research, section 6.1) become fixed keys in the one `--settings` value ccd passes to every spawned Claude Code session.

## What was read first

- `_spawn_start` composes the launch flags once and splices them into both spawn lines. Three composers then merge into the row's one `--settings` (D-5391): `_child_spawn_compose`, `_browser_spawn_compose` and `_account_spawn_compose`. All use `SETTINGS_UNION_JQ`.
- Every wrapper, the codex lane's included, execs Claude Code with the same flags, so the account and browser composers already run on every row.
- Spawn settings have no per-box knob; the operator's ruling is a fixed default, so this adds none.

## Deviations found

- **D-8173 (2026-11-10)** — spawn-settings-rulings: auto-continue at the usage limit off, cross-session inbound refused, idle compaction on

## Design

- `FLEET_SPAWN_PINS` is the one spelling: `autoContinueAtUsageLimit` false (Q4, ccd always swaps, the operator's options come only when no account has room), `crossSessionInbound` "refuse" (Q5, a stray inbox message never opens an approval dialog, nudges stay typed), `idleCompaction` true (Q6, no account or session setting can switch it off).
- `_fleet_spawn_compose` merges the pins last, after the account composer, so no lane or account value beats them. It fails open like the account composer.
- The four screen-read holds (D-2229, D-2369, the rescue near-wait, the stale-Enter check) stay. Each carries a comment naming the follow-up: delete them once the pin is watched working live. The cache-expiry reader for idle compaction is a later change.

## Consequences the ruling carries (review finding, verified)

- **A session with no account room parks until the operator acts.** Before the pin, Claude Code's own wait-then-continue re-sent the turn at the reset. With it off, nothing in ccd re-sends that turn: `_rescue_check` types nothing, the no-room `_rescuewait` closes `clear` once the home account resets (no swap fires, the target is the home wrapper), and `_watchdog_resume_here` restarts in place only when the operator recorded `choice=wait` through `ccd limit-wait`. A fleet that hits the five-hour ceiling unattended therefore sits idle after the reset until someone taps "Wait until reset" on each session. This is what the ruling says ("the operator's options come only when no account has room"); an automatic in-place restart at the reset (for example `_watchdog_resume_here` without `choice=wait`) is NOT part of this change and is left as an open question for the operator.
- **The five-hour near-reset wait can no longer open.** Rule b of `_rescue_check` (`_rescue_armed`) keys on Claude Code's own auto-continue footer, which the pin removes, so every near-reset block now swaps instead of waiting a few minutes. Expect more rescue swaps and more herd/spread pressure until the holds are deleted and the spread is re-measured.

## Evidence for the three spellings (review finding, verified)

A read of the Claude Code binary's strings and settings schema (no live probe). Builds 2.1.306, 2.1.321 and 2.1.322 carry all three keys; 2.1.306 is the oldest on the fleet's disk, so it is the floor read. `autoContinueAtUsageLimit` and `idleCompaction` are optional booleans (same schema helper as `autoScrollEnabled`). `crossSessionInbound` is an enum of accept, hold and refuse, declared `.optional().catch(void 0)`: an unknown spelling falls back to unset instead of invalidating the file. An older build ignores a key it does not know. The pins stay in the one `--settings` (a separate source buys nothing given the read), and a test pins the literal so a respelling needs a new read.

## Tasks

- [x] T1. Test first, red: every launch kind (top-level, routed, child, codex-lane wrapper) carries the three keys with the ruled values in its one `--settings`, on both spawn lines.
- [x] T2. Build: `FLEET_SPAWN_PINS` and `_fleet_spawn_compose` in ccd, called once in `_spawn_start` after the account composer.
- [x] T3. The older byte-exact argv suites clear the pins in their harness, as they pin the browser default.
- [x] T4. Leave the follow-up comment at each of the four holds.
- [x] T5. Review: state both consequences above plainly in the plan and the README (no new restart mechanism; that needs an operator ruling).
- [x] T6. Review: bundle-read evidence and version floor recorded in the ccd comment and here; a test pins the literal.
