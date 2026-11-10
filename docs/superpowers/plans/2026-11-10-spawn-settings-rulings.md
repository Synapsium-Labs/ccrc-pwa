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

## Tasks

- [x] T1. Test first, red: every launch kind (top-level, routed, child, codex-lane wrapper) carries the three keys with the ruled values in its one `--settings`, on both spawn lines.
- [x] T2. Build: `FLEET_SPAWN_PINS` and `_fleet_spawn_compose` in ccd, called once in `_spawn_start` after the account composer.
- [x] T3. The older byte-exact argv suites clear the pins in their harness, as they pin the browser default.
- [x] T4. Leave the follow-up comment at each of the four holds.
