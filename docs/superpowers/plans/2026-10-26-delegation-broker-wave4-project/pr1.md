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
- D-7004, `r9-decided-in-the-run-binding` (PR1 Task 1.2, found by CI). The plan puts R9 (`coordinatorOf`) in
  `delegation-projection.ts` as a private helper. Its two comparisons (`r.sessionId !== id`, `r.claimedBy === id`) are run/session
  equality sites, and the ARCH-62 census (`run-session-census.test.ts`) pins every such site outside the binding module at zero.
  R9 therefore lives in `server/src/coord/runBinding.ts` as `claimantAt(runs, sessionId, at)` (the id-string rule through
  `runNamesSession`, plus one census entry naming its claimant test as the binding module's own rule), and the projection calls
  it. The rule, its rows (W4-P7, W4-P9, W4-P11, W4-P15, W4-P16) and its mutants (W4-M02, W4-M23 in `runBinding.ts`; W4-M04 in the
  projection) are unchanged.
- D-7005 and D-7006 stay `unused`.

## Smaller notes (no number)

- Task 1.1: the `DelegationUnownedWire.reason` comment names `server/src/coord/delegation-policy.ts` without the plan snippet's
  `:175` line number, under the repository's rule that code is cited by anchor or symbol, not by line.
- Task 1.2, W4-K1: measured red before the arm was added. The kebab-token census named `offline-coordinator` in
  `delegation-projection.ts`, so `mail-routes.test.ts` admits the module's words through `isDelegationProjectionKebab`.
- Task 1.3, found by CI: the lane's `projection()` read the census a second time per pass, which `delegation-sweep-clock.test.ts`
  counts as a second pass. It now projects the census the pass itself read (`passCensus`, set where `pass()` reads it).
- Found by CI: the frame's `FleetMsg` arm shifts `shared/api.ts` by four lines, so the child-workspace-reclamation spec's
  `PRESENCE_*` citation (pinned by `collect-lane-prose.test.ts`) moves from 4638-4639 to 4642-4643. PR2's branch, which
  cherry-picks Task 1.1, needs the same citation change. The wave-3 store census now counts seven delegation methods
  (`delegationRunStamps`), and the hibernation census has a `held-awake` row for the projection's dead-parent compare.
