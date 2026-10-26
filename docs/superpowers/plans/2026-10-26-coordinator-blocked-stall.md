# The stall watch's coordinator-blocked arm: Plan note

PR #1536 adds the stall watch's `coord-blocked` arm. This note is a new file because shared ledger documents change
only on a ledger branch. One number, D-6942, was issued for the arm.

## Deviations found

- **D-6942** — `coord-blocked`: mail to a coordinator that the server still holds (a delivery still `queued`, or a
  delivered one whose replay a gate holds) for `COORD_BLOCKED_HELD_MS` (30 min) draws one operator push per episode,
  whatever word the coordinator reads. The push names the gate reason in operator words: waiting on you (an open
  question) with the child mails queued behind it, held behind a background workflow (`busy` with no turn), its own
  long busy stretch (`busy` with a turn), or idle but not receiving mail. Rung 2 (escalated) follows at a 60 min busy
  or waiting stretch or a 2 h old mail. An episode runs while any mail to the coordinator stays held; recovery closes
  it. A 14-day census found no strict circular wait, and found that a rule requiring `busy` misses the open-question
  and idle holds, so the arm keys on the server's mail state instead. It is a wave-1 arm that follows the Stall watch
  level and only reports. The measured calibration (about 2.3 flags a day) is in the constant's comment in
  `server/src/coord/stall.ts`.
