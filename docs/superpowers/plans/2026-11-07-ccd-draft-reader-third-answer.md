# ccd's draft reader gets a third answer

A limit rescue stood down on `draft` for hours at a time, with nobody typing. The cause was in ccd's input-box reader,
`_pane_box_draft`. It took the last `❯` row anywhere on the pane as the box, with no check that the row sat inside the
bordered input box.

Claude Code opens its own `/rate-limit-options` dialog ("What do you want to do?") when it shows a limit message. The
dialog takes the input box's place, and its cursor row is indented. An older `❯` row was still on screen above it: the
ccrc mail nudge that opened the failing turn, or the dialog's own `❯ /rate-limit-options` echo. The reader took that
row as a draft. `_session_hard_blocked`'s draft guard then stood the rescue down on every tick until a person answered
the dialog. Nothing in ccrc closes it.

The fix gives the reader a third answer. "No box" is not the same as "empty box". Most callers must refuse on it, and
the limit swap must go ahead.

## Deviations found

- **D-8116 (2026-11-07)** — the draft reader answers empty, draft or no box; only the limit swap goes over an open dialog, and every keystroke caller refuses

## The reader's contract

`_pane_box_read` returns `empty`, `draft` or `absent`. A `❯` row counts as the box only when it sits directly under a
`─` border, the same rule `_pane_outside_box` uses. With no such row, the answer is `absent`: a dialog or menu is open,
or the capture missed the box. `_pane_box_draft` stays the marker-row reader and returns rc 2 when no box is on screen.
Server `hasMenu` gives the same veto the other way round: no menu while the prompt box shows.

A bordered box on screen does not prove that no dialog is open. On a pane whose conversation fills it, Claude Code
keeps drawing the box and the statusline UNDER a slash command's dialog: the real 2.1.291 `/model` captures show the
picker (`❯ 1. Default …` above `Enter to set as default · … · Esc to cancel`) and its `Switch model?` dialog over a
bare `❯` box. The border rule finds that bare row, so before this check the reader answered `empty` there, and an
Enter would pick the highlighted row. `_pane_box_dialog` closes that gap. Before the reader answers `empty`, it reads
the rows between the box's top border and the border before it. An indented numbered cursor row (`❯ N.`, the cursor
`_pane_model_state` reads) in those rows means a dialog is open, and the answer is `absent`. The cursor row counts
when a border closes those rows from above (both 2.1.291 shapes draw one) or a dialog footer (`Esc to cancel`,
`Enter to confirm`, `Enter to select`) sits beside it. Without either, an indented `❯ 1.` is a reply quoting one, and
the box stays `empty`. A draft still reads `draft` under a dialog, so the limit swap still stands down on it. Server
`hasMenu` has the same blind spot, because its `promptBoxShowing` veto fires on this shape. Mirroring the server
would not have caught it.

A reply that quotes a whole dialog must still leave an idle box `empty`, or no keystroke caller would ever act on that
session while the reply stays on screen. Sessions here often quote pane captures of exactly that kind, cursor row,
rule and footer included. So only a rule at column 0 bounds the rows the check reads, because a reply's quoted rows
are indented under its `●`. Rows holding conversation (`●`, `✻`, `⎿`) are a reply and never a dialog. Both 2.1.291
captures fit: their dialog rule starts at column 0, and nothing but the dialog sits between it and the box.

| Caller | empty | draft | absent |
|---|---|---|---|
| `_session_hard_blocked` (the limit swap) | rescue | stand down, `draft` | rescue |
| `_auto_stale_check` (the Enter after a stale auto-continue) | Enter | `stale-skip`, box not empty | `stale-skip`, no input box |
| `_auto_swap_check`'s affinity guard | move | stand down, `draft` | stand down, `no-box` |
| `_idle_for_keystroke` | idle | `drafting` | `no-box` |
| `_inject_spawn_effort` | types `/effort` | skipped | skipped |
| `_redrive_after_spawn` | types the resume prompt | `redrive-skip`, box not empty | `redrive-skip`, no input box |

An Enter on the limit dialog would pick its highlighted row, and that row can be "Switch to usage credits" or "Upgrade
your plan". So every caller that types or presses keys refuses on `absent`, whether the dialog hides the box or
sits above it.

The limit swap goes ahead on `absent` because it only reaches the draft guard when the transcript's newest real row is
this process's own limit row. A limit row carried in from an earlier process answers no before that point. With the
newest row a limit row, no question or permission prompt is pending, so the open dialog is Claude Code's own limit
dialog. The swap carries the transcript, and the dialog holds nothing a person typed.

Known limit: text a person typed before the dialog opened may still sit under the dialog, out of sight. A swap does not
carry it. The pane cannot show this text, so the guard cannot see it either.

## Tests

The pane corpus (`server/test/fixtures/panes/box/`) gains two dialog captures, built from the corpus's own 2.1.303
capture and the repo's real slash-command dialog captures (`cc291-model-picker-*`, `cc280-effort-confirm-fullscreen`):
one with the `❯ /rate-limit-options` echo above the dialog, and one with an old `❯ ccrc-mail: …` row above the limit
message. They are modelled captures, not recorded ones. `verdicts.json` gains the `_pane_box_read` column on every
capture. The two dialog captures read `absent`, and the existing columns are unchanged.

The two modelled captures leave out the box and statusline, so they only cover dialogs that hide the box. The corpus
also holds two real 2.1.291 captures copied verbatim from `fixtures/panes/`: `cc291-model-picker-220x50-full` (the
picker over the box) and `cc291-model-default-switch-120x30` (the `Switch model?` dialog, which has no footer, over
the box). Both read `absent`. The marker row there is the bare box row, so `_pane_box_draft` reads `''` and
`draftOfMeasured` reads `{box: 'present', draft: ''}`.

Test panes that drew a bare `❯` row with no border now draw the box with its borders, as Claude Code does.
