# An account's limit row after an early reset: plan

A defect fix in `ccd/statusline-command.sh`, the one writer of an account's limit row
(`~/.cc-limits/<account>.json`). There is no spec: the rule is stated here and in the script's own comments.

## The defect

Every session on an account publishes its limit reading to the account's row. To stop idle sessions republishing
old snapshots, the writer drops a reading the row calls older: its `resets_at` went backwards, or it names the same
window with a lower figure. That rests on "inside one window, usage only climbs".

The provider can reset an account's limit early. Measured on a fleet: a row at 100% of the weekly window with days
of that window left; the account was reset; the sessions on it then read 0% and 1%, and every one of those readings
was dropped. The row held the ceiling until the old window's end, so `ccd` placed nothing on the account and sent
no session back to it. The only cure was removing the row by hand.

## The rule

1. Each session's usage sidecar (`~/.cc-sessions/usage/<id>.json`, one writer, the same script) carries `limits`:
   the limit payload that render saw, both windows' figures and `resets_at`.
2. A reading the row calls older is published anyway when this session's payload differs from the `limits` its
   previous render wrote, and that previous render had a figure in at least one window. A session's payload changes
   only when an API response arrives, so an idle session's snapshot never differs and never passes.
3. A publish of that kind writes `fiveResetFrom` or `sevenResetFrom` on the row: the end of the window it replaced.
   While a mark stands, a ccd session's reading for a window ending no later than the mark, which would raise the
   row, needs the same proof. Without this the idle sessions still holding the reading from before the reset would
   put the row straight back. The mark is carried on every publish and dropped once the row names a later window.
4. Unchanged: a first render, a session with no ccd id lowering the row, an equal reading, and the two arms that
   protect a live 5h figure. A writer with no ccd id may still raise a marked row.

## Tasks

1. Tests first in `server/test/statusline-script.test.ts`: an early reset in the same window and a rewound
   `resets_at` from an active session publish; an idle session's unchanged snapshot, a first render, a render
   after one with no `rate_limits`, another session's history and a writer with no id are still dropped; the mark
   is written, holds an idle session's old reading back, rides along and ends.
2. The script: the session id and sidecar path are derived before the publish; the verdict gains `older` and
   `raise`; one extra `jq` reads the sidecar on those two words only.
3. Measure each new condition by removing it and reading the red tests.

## Known limits

- An account with no ccd session on it is not cured: the keepalive's one-turn process has no history, so its
  lower reading is still dropped. That needs a follow-up of its own.
- A wrong low reading can land when two active sessions race: one publishes its newer, higher figure and the
  other's render of a slightly older response lands after it. The error is a few seconds old and lasts until the
  next response on the account.
- A session's limit-wait record keeps the reset time it was opened with, so its restart in place still waits for
  the old window's end. The rescue to another account and a cleared sign are not affected.

## Deviations found

- **D-8942 (2026-11-22)** — limit-row-early-reset. A reading that changed since its session's previous render
  lowers the account's limit row; the lowered row marks the window it replaced.
