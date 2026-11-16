# The stall watch's coordinator-blocked arm: Plan note

PR #1536 adds the stall watch's `coord-blocked` arm. This note is a new file because shared ledger documents change
only on a ledger branch. One number, D-6942, was issued for the arm.

## Deviations found

- **D-6942** — `coord-blocked`: mail to a coordinator that the server still holds (a delivery still `queued`, timed from its
  mail's queue time; a delivered mail's gated replay is mail already received and never counts) for `COORD_BLOCKED_HELD_MS` (30 min) draws one operator push per episode,
  whatever word the coordinator reads. The push names the gate reason in operator words: waiting on you (an open
  question: a `waiting` word or a pending dialog) with the child mails queued behind it, held behind a background
  workflow (`busy` over a current finished marker), its own long busy stretch (`busy` over a current working marker),
  busy with its turn state unreadable (`busy` over a marker that is not current), or idle but not receiving mail. A
  measured word it cannot name still flags at rung 1, worded as unreadable, so no word silences it. Rung 2 (escalated) follows at a 60 min busy
  or waiting stretch or a 2 h old mail. An episode runs while any mail to the coordinator stays held; recovery closes
  it. A 14-day census found no strict circular wait, and found that a rule requiring `busy` misses the open-question
  and idle holds, so the arm keys on the server's mail state instead. It is a wave-1 arm that follows the Stall watch
  level and only reports. The shipped any-state 30 min rule corresponds to the census row without the busy
  condition (about 77 coordinator-hours in 14 days, roughly 5 a day); the census span is an upper bound (creation to
  the next nudge or the coordinator's own read). The calibration is in the constant's comment in
  `server/src/coord/stall.ts`.
