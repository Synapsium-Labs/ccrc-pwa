# The box-default effort rides the spawn argv

## Goal

A session with no effort field of its own must start at the box default effort (`SPAWN_EFFORT`, `high`) without rewriting any account setting. ccd passes the default as `--effort <level>` on the spawn argv, the way a recorded effort already is, and no longer types it at settle.

## What was read first

- `_spawn_start` composes the launch flags once (`routeflags`) and splices them into both spawn lines (the `--resume` attempt and the `--session-id` retry). A swap, a supervisor restart and a revival all reach the same function, so one composition covers every spawn.
- `_inject_spawn_effort` ran from `_spawn_settle` for a session whose record carried no `effort` file. It waited on the pane, checked the input box and typed the plain `/effort <level>` form, then answered the switch dialog.
- The route appliers (`_route_type_effort`, `_route_type_model`) use only the bare slider and picker with the `s` key, which is session only. The note above `_route_note` says routes use only session-only forms.
- The only other plain typed form in ccd is `/effort ultracode`, measured not to persist a per-model pin; it stays.

## Deviations found

- **D-8149 (2026-11-10)** — ccd no longer types the plain `/effort <level>` form at settle: Claude Code 2.1.321 saves that form as the account's default for new sessions (the model's `effortLevel` in the config dir's user settings, acknowledged as "saved as your default for new sessions"), so every fresh session without a routing record rewrote an account setting. The box default `SPAWN_EFFORT` now rides the spawn argv as `--effort <level>` on both spawn lines, composed in `_spawn_start` for a session with no `effort` field on an Anthropic backend, and `_inject_spawn_effort` and its wait are removed. It is deliberately not a top-level `effortLevel` in `--settings`, which applies to every model.

## Design

- One composition in `_spawn_start`, after the record is read: `--effort $SPAWN_EFFORT` is appended to the launch flags when `SPAWN_EFFORT` is set, the session has no `effort` file (any value, empty or unreadable included, counts as a field somebody wrote), the lane is an Anthropic backend, and the class is not haiku (haiku takes no effort level).
- Unchanged: a recorded effort and its `--settings` keys, `auto` (the lane decides, no flag), non-Anthropic lanes (no flag), `SPAWN_EFFORT=""` (disables), and the route appliers.
- The journaling notes for a haiku pair, an unrecognised value and an unreadable field are written by the spawn's own `_route_effort_for` call, so they survive the removal.
- A census scans ccd, the server, the PWA and shared for a quoted or backticked `/effort <arg>` or `/model <arg>` built with send-keys, inject or prompt, and allows only the bare picker and slider forms and `/effort ultracode`.

## Tasks

- [x] T1. Tests first, red: both spawn lines carry `--effort high` for no record and for a class-only record; the empty, auto, recorded, haiku and non-Anthropic cases carry the right flag or none; the settle function is gone; the census.
- [x] T2. Build: compose the flag in `_spawn_start`; delete `_inject_spawn_effort`, its call and its call-graph edges; update the `SPAWN_EFFORT` comment.
- [x] T3. Move the byte-exact spawn-argv pins and retire the tests that drove the removed keystroke (settle, re-drive ordering, narrow-pane stand-down, operator-choice journaling, login-screen positive control).
