# Program: landing-order-proof

The vehicle for landing order's Task 7 proof run (#198). It is three one-line PRs, each from its own fresh fleet
workspace so that `ours_of` (with `one_ours` as its fallback) has a workspace to bind. The coordinator puts them through the native merge queue once
the queue ruleset is on. The runbook is Task 7 of `docs/superpowers/plans/2026-09-24-landing-order-wave2-native-queue.md`.
Every reading, and every state change of these runs, is recorded in `docs/superpowers/programs/landing-order.md`,
not here. Coordinator: `ccrc-pwa-quiet-river`.

## Waves

| # | slot | its part in the proof |
|---|---|---|
| 1 | A | lands through the queue: readings (a), (a2), (b), (c) and (d) |
| 2 | B | lands through the queue: the same readings |
| 3 | D | (a1), armed but not queued; then (e), enqueued and removed; then (f), the held worker's merge is refused; closed unmerged |

The third PR that lands is the coordinator's next ledger PR, slot C. So the proof spends three dispatches, not five.

The table is the 2026-10-07 shape, which the run of 2026-10-20 followed, and it spent (e): (a1)'s pushes, made outside
slot D's workspace, unbound the PR, so its removal could not reach the lane. The re-run follows Task 7's runbook as
landing-order wave 3c amends it:
- A and B are #942 and #963, whose runs 690 and 691 wait at `merging`. C is this coordinator's next ledger PR. All
  three land.
- D is one new dispatch, a PR that never lands. It carries (a0), then (e), then (a1), in that order, then (f), and is
  closed unmerged. (e) runs before (a1) pushes to the PR, never after.
So the re-run spends one dispatch. Every reading is recorded in `docs/superpowers/programs/landing-order.md`.

## Slots

Each proof PR changes only its own slot line below, and nothing else in the repository.

### Slot A

- Slot A: open.

### Slot B

- Slot B: open.

### Slot D

- Slot D: open.
