# Wave 4 PR1: notes for the ledger

The worker's notes for PR1 (the server's `delegation` frame), to be folded into the plan's "Deviations found" and the programme
ledger by the coordinator's ledger pull request. PR1 owns D-7003..D-7006. The entries below are written as prose, not as
`- **D-N**` definition lines: the plan already defines each of these numbers (as `unused`), and `deviation-refs.test.ts` reads a
second definition line as a collision.

## Deviations

- D-7003, `conflict-is-the-trees-newest-unowned-attempt` (PR1 Task 1.2). The plan says a lease that is not `raw` is no row
  when "a `conflicting` attempt names the same tree", and an unowned row is dropped for "a tree an unreleased lease holds, unless the
  attempt is `conflicting`". Read literally, the two rules lose a tree: if an older attempt on a leased tree is `conflicting` and a
  newer one is `unresolved`, the lease is suppressed by the old conflict and the unowned row (the newer attempt) is dropped because
  the lease holds the tree, so the tree is in neither group. The decider takes the conflict from the tree's NEWEST unowned-work
  attempt (by `attemptedAt`, then `attemptId`, among those `isUnownedWorkReason` admits), the same attempt the unowned row is built
  from. A lease suppressed for a conflict therefore always leaves its tree an unowned row. Pinned by the row "a superseded conflict"
  in `server/test/delegation-projection.test.ts`, which reds when the conflict set is built from every `conflicting` attempt.
- D-7004, D-7005 and D-7006 stay `unused`.

## Smaller notes (no number)

- Task 1.1: the `DelegationUnownedWire.reason` comment names `server/src/coord/delegation-policy.ts` without the plan snippet's
  `:175` line number, under the repository's rule that code is cited by anchor or symbol, not by line.
- Task 1.2, W4-K1: measured red before the arm was added. The kebab-token census named `offline-coordinator` in
  `delegation-projection.ts`, so `mail-routes.test.ts` admits the module's words through `isDelegationProjectionKebab`.
