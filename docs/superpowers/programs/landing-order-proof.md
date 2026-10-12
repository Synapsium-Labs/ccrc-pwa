# Program: landing-order-proof

The vehicle for landing order's Task 7 proof run (CCR-19). It is three one-line PRs, each from its own fresh fleet
workspace so that `is_ours` has a workspace to bind. The coordinator puts them through the native merge queue once
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

## Slots

Each proof PR changes only its own slot line below, and nothing else in the repository.

### Slot A

- Slot A: open.

### Slot B

- Slot B: open.

### Slot D

- Slot D: open.
