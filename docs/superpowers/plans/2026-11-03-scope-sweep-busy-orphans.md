# Scope sweep: the busy arm

> **Execution status:** The sweep, its switches, verb and door are built, shadow by default. The Settings card, Automation › Leftover processes, lands as its own pull request after them: `consolidation-path-guard.test.ts` reds any diff touching `shared/switches.ts` beside `pwa/`, and the fourteen latest commits that touched that file carry no `pwa/` file. After about a week of shadow verdicts the operator arms it from that card.

**Goal:** A pane scope whose session is provably dead becomes collectable after a grace period even when its processes are busy, behind its own switch, shadowed first. It closes the follow-up of #1637.

## Decisions

- **D-7993 (2026-11-03)** — scope sweep: the busy arm collects a provably dead session's orphan behind `scope-sweep-busy-live`. `ccd-scope-sweep` adds a `busy` line beside a busy scope's own `dead` line and changes neither that line nor any inert verdict. The header of `ccd/ccd-scope-sweep` is the definition; the rest of this section is why.
- **D-7994 (2026-11-03)** — scope sweep: the busy arm's switch, its verb, its route and its Settings card. `scope-sweep-live` and `scope-sweep-busy-live` are rows of `shared/switches.ts`. `scope-sweep-live` keeps no writer and the door only reads it. `scope-sweep-busy-live` gets `ccd scope-sweep-busy --state on|off` and `POST /api/coord/scope-sweep`, and its own pull request adds a radio in Settings › Automation › Leftover processes, because the operator's ruling of 2026-10-25 is that an operator act has a control in the console. The door is session-gated with no box token. Like `testbox-remote` and `reclaim-pause`, the verb is not in `FORBIDDEN_CCD_VERBS`: that list lives in rules files, which a pull request may not mix with other changes, so adding it is a rules-only follow-up.

## What was measured

Read-only on the fleet box on 2026-11-04, printing counts only. The one dead scope on the record was `report` with `cpu-moved,process-started-under-6h`. Five of its nine listed pids still ran, and all five carried `CCRC_SESSION_GENERATION`; the other four had exited between the sweep's read and this one, so a looping scope churns, and a carry must not reset its clock. Its generation resolved to a row with no stop stamp: a session still running, its old pane's scope left behind. That is the case a scope-level definition of dead would have stopped. All 67 live panes carried the variable. Every pane's `comm` was a version number such as `2.1.318` and its `argv[0]` lay under `claude/versions/`, so a `comm` check alone would never see Claude Code.

## How the triage's definition was made measurable

The triage asked for three facts: the registry row is stopped or absent, no Claude Code process is in the scope, and the scope's pane is gone from its server. The scope's `Description` names a pane and a tmux server and no session, and the K16 census pins that neither act reads `$REG/<id>.panescope` (that marker also names only a session's last pane, never a scope a swap left behind). So the session comes from each process's own environment: both spawn lines export `CCRC_SESSION_GENERATION`, and `$REG/<id>.generation` holds that uuid for the row's whole life.

Three additions the triage did not list, each in the safe direction:

1. **The grace is the session's clock, not the scope's.** A scope dead for a week whose session stopped a minute ago would otherwise be stopped at once. A `busy` line carries its own `first=`, and a session seen live drops it.
2. **No live pane may carry the generation**, whatever the registry says. A stop stamp beside a running pane is no dead session.
3. **`peer`**, the measurable part of "a scope another live session uses": a loopback TCP connection whose far end is no socket of this scope, or an accepted connection on a named Unix socket. The other parts are a process carrying a live row's generation and predicate 5.

A busy scope's predicates 2 to 4 are what make it busy, so they are the only ones this arm does not ask.

## What stays as it was

The `dead`, `carry` and `old` lines, the header and every inert verdict. With no busy scope and the switch down the record is byte for byte what it was. The units, the timers and `ccd-cap-scopes`. The K16 census pins. `busy-mode live` is written only while both switches stand, so a record without it reads shadow.

The sweep keeps ONE `systemctl --user stop` line, because the K16 census pins one stop act: the inert and busy arms reach it through a shared decision, with the inert arm's ladder (shadow, held, stop) as it was.

The doctor's sentences each gain the busy-orphan count and the mode, so its three exact pins moved with them; they stay exact.

## Mutation table, as run

Each mutation was applied to `ccd/ccd-scope-sweep` alone and run against `server/test/scope-sweep.test.ts`.

| Mutation | Red cases | What went red |
|---|---|---|
| the busy path ignores its switch | 3 | (a) only scope-sweep-live; the doctor's shadow line; the budget with only scope-sweep-live |
| the busy switch alone arms it (the sweep's own switch not needed) | 1 | (a) only scope-sweep-busy-live |
| the live-session check dropped | 4 | (b) the swap case; another live session's generation; the clock drop; the doctor's zero |
| a separate budget per kind | 2 | (d) both mixed cases |
| the live pane's generation check dropped | 2 | (b) both pane-wins cases |
| `argv[0]` left out of the Claude Code check | 1 | (c) the real-shape case |
| the session clock read from the scope's `first` | 8 | the grace cases |
| a carry drops the busy clock | 2 | (e) both carry-clock cases |
| the `peer` hold dropped | 3 | (c) v4, v6 and Unix |
| the Claude Code hold dropped | 2 | (c) both names |
| the elsewhere hold dropped | 1 | (c) a child in another cgroup |
| the pane-exists hold dropped | 1 | (c) a pane outside the scope |
| a missing generation read as absent | 1 | (e) no process carries one |
| the busy verdict written onto the `dead` line | 12 | the byte-for-byte case and the existing socket cases |

## Limits, recorded

A connection between two dead scopes holds both, reported and never stopped. A client of a Unix socket that was not accepted on a named path is not seen.

## Deploy

Agent lane, agent first, then the server lane for the door. Shadow: nothing is stopped until the operator arms it.
