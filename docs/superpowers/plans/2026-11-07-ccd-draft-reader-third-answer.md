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

| Caller | empty | draft | absent |
|---|---|---|---|
| `_session_hard_blocked` (the limit swap) | rescue | stand down, `draft` | rescue |
| `_auto_stale_check` (the Enter after a stale auto-continue) | Enter | `stale-skip`, box not empty | `stale-skip`, no input box |
| `_auto_swap_check`'s affinity guard | move | stand down, `draft` | stand down, `no-box` |
| `_idle_for_keystroke` | idle | `drafting` | `no-box` |
| `_inject_spawn_effort` | types `/effort` | skipped | skipped |
| `_redrive_after_spawn` | types the resume prompt | `redrive-skip`, box not empty | `redrive-skip`, no input box |

An Enter on the limit dialog would pick its highlighted row, and that row can be "Switch to usage credits" or "Upgrade
your plan". So every caller that types or presses keys refuses on `absent`.

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

Test panes that drew a bare `❯` row with no border now draw the box with its borders, as Claude Code does.
