# One check before ccd types into a pane

## Goal

Operator ruling SH-9: ccd keeps its half-typed-draft check and gains a copy-mode check and a pane-width check, all three in one shared check that runs before ccd types anything into a session's pane. Every place ccd presses a key goes through it, and every refusal is one line in `$REG/swap.log` naming the session and the reason.

## What was read first

- ccd presses keys in ten functions and pastes nothing (`paste-buffer` and `load-buffer` appear nowhere in `ccd/`): the stale-limit Enter (`_auto_stale_check`), the compactor (`_auto_compact_check`), the route appliers (`_route_type_effort`, `_route_type_model`) with their continuations (`_route_escape`, `_route_model_ack_wait`), the spawn gates (`_accept_first_run_prompts`, `_answer_two_option_dialog`), the redrive (`_redrive_after_spawn`) and the operator's `ccd clip` (`cmd_clip`). No other program under `ccd/` sends a key.
- The minimum width already exists: `READER_MIN_COLS` and `_pane_measurable`, the floor every screen reader in ccd stands down on. The draft reading already exists: `_pane_box_read` (`empty`, `draft`, `absent`). Nothing in ccd read `#{pane_in_mode}`. The server's pane-history route records why copy-mode matters: a literal write into a pane in copy-mode hung and the Enter after it was eaten.
- `ccd-limit-no-keys.test.ts` keeps key senders out of the limit-rescue functions. This change adds no key sender anywhere and the check itself sends none, so that census is unchanged.

## Deviations found

- **D-8271 (2026-11-11)** — one typing check: `_pane_type_ready <id> <site> [append]` refuses `narrow` (the active pane is under `READER_MIN_COLS`, or tmux would not measure it), `copy-mode` (`#{pane_in_mode}` is 1, or tmux would not answer) and `draft` (`_pane_box_read` answers `draft`), and logs `type-refused <id>: <reason> at <site>, <detail>` to swap.log. Every function that sends a key calls it before its first key, or is a continuation reached only from functions that did (`_route_escape`, `_route_model_close`, `_route_model_ack_wait`, `_answer_two_option_dialog`), held by the census in `server/test/ccd-typing-check.test.ts`. Three decisions taken in the build: (1) the log is floored per reason through a `typerefuse` registry field (`<reason> <epoch>`): the first refusal, a change of reason, or the same reason after `COMPACT_NOTE_FLOOR` speaks, and a pass ends the episode, because a refused supervise tick retries every 5 s (D-2013's budget); (2) no input box (`absent`) is not a refusal, because the spawn gates and the picker's dialogs are answered exactly there, and the sites that need an empty box keep their own stricter read; (3) `ccd clip` uses the `append` form, copy-mode only, because it adds a path to the operator's own text and sends no Enter, and reads nothing off the screen. The route appliers answer a new rc 3 for a refusal, which `_route_apply_now` does not count as an attempt, and they now journal their keystroke (`_typed_note`) after the check, so a refusal journals nothing.

## Design

- The check is one function beside `_pane_narrow_note`, in context C3. Width is `_pane_measurable` (one definition of the floor). Mode is one `display-message -p '#{pane_in_mode}'` against `_tmux_t`. The draft is `_pane_box_read` over a `capture-pane -e`.
- The site placements: the stale Enter and the redrive check after their own box reads and before the key; the compactor checks after every other gate and before it stamps `lastcompact`, so a refusal is retried on the next tick; the route appliers check first and answer 3; the spawn loop checks before each gate it answers and, refused, waits a second and reads again until its own bound; `ccd clip` dies with the reason.
- The existing site-specific stand-downs and their log lines (`stale-skip`, `redrive-skip`, `compact-skip`, the narrow notes) stay as they were.

## Tasks

- [x] T1. Tests first, red: the census (every key sender is behind the check, continuations reached only from checked functions, no other ccd program sends a key), one row per refusal and the pass, the log line, the floor, a torn floor field, and a row per site driven through its own function.
- [x] T2. Build `_pane_type_ready` and wire every site; rc 3 in `_route_apply_now`; the contexts manifest row and edges, the registry field inventory, and the arithmetic-containment row for the floor.
