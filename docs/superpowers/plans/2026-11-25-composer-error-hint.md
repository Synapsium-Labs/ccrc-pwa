# A failed turn's hint is not a draft

**Goal:** a session whose turn ended on a provider error can be reached again. ccrc reads Claude Code's own hint in the
empty input box as empty, whether or not the cursor is drawn over it.

**Measured (2026-11-25, Claude Code 2.1.332; the hint is in every installed build from 2.1.329).** After an API error the
empty box shows `Resend your message to try again` (other errors show `Once fixed, resend your message` or `Run /rewind to
go back`). In a pane no client has ever focused, Claude Code draws its cursor on the hint's first letter: inverse, then a
reset that turns dim on. The dim strip left that one letter, so the server's reader answered the draft `R` and ccd's
answered `draft`. `C-s` stashes nothing, so every mail to the session failed `stash-failed`, the notice that would have
restarted it among them: one worker stayed dead for ten hours after one overloaded answer. After a focus-out (a console
terminal opened and closed) the whole hint is dim, and both readers were right already. ccd's keystroke guards (the limit
rescue and the hibernate arms among them) asked the same reader.

## Task 1: both readers

- [x] Fixtures recorded from the reproduction: the hint with the cursor, the hint after a focus-out, typed text with the
  cursor on its first letter, and one typed letter under the cursor (`server/test/fixtures/panes/box/`).
- [x] `server/src/inject/send.ts` HINT_CURSOR and `ccd/ccd` `_pane_box_plain`: an inverse first cell directly before the
  code that turns dim on joins the dim run. Both columns of the corpus were red on the hint before the fix. Without the
  "dim comes next" half, the two typed-text fixtures go red on both readers.

## Deviations found

- **D-9077** — the dim strip (D-5910, D-6006) took a dim+inverse cursor cell but not an inverse one that is not dim, the
  form a never-focused pane draws. The cursor cell now joins the hint it stands on.
