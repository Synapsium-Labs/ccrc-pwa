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
  in `server/test/delegation-projection.test.ts`, which reds when the conflict set is built from every `conflicting` attempt. The
  other direction (review 1024 Q2, fix round 1): an older `unresolved` and a newer `conflicting` attempt on an agent-leased tree give
  the conflicting unowned row and no lease row (W4-P21), red when the kept attempt is the oldest.
- D-7004, `r9-decided-in-the-run-binding` (PR1 Task 1.2, found by CI). The plan puts R9 (`coordinatorOf`) in
  `delegation-projection.ts` as a private helper. Its two comparisons (`r.sessionId !== id`, `r.claimedBy === id`) are run/session
  equality sites, and the ARCH-62 census (`run-session-census.test.ts`) pins every such site outside the binding module at zero.
  R9 therefore lives in `server/src/coord/runBinding.ts` as `claimantAt(runs, sessionId, at)` (the id-string rule through
  `runNamesSession`, plus one census entry naming its claimant test as the binding module's own rule), and the projection calls
  it. The rule, its rows (W4-P7, W4-P9, W4-P11, W4-P15, W4-P16) and its mutants (W4-M02, W4-M23 in `runBinding.ts`; W4-M04 in the
  projection) are unchanged; fix round 1 adds W4-P19 (the greatest id answers) and W4-P20 (the interval is inclusive at both ends).
  The run stamp's shape is declared once, as `StampedRun` in `runBinding.ts`; the projection's `DelegationProjectionRun` aliases it,
  and `runBinding.ts` imports nothing from the projection (no change under `shared/`, `pwa/` or `ui/`). Residue, accepted for wave 4
  (display only): `claimantAt` names the worker by the id-string rule and the stamps carry no births, so a born occupant of a reused
  id whose lease is first observed outside every run of its own, but inside the interval of an older run naming the same id (still
  open, or closed after that instant), nests under that older run's coordinator. Wave 5 binds any act through `bindingOf`, with
  births.
- D-7005, `projection-reads-the-pass-census` (PR1 Task 1.3, found by CI). The plan's `projection()` reads `this.census()` a second
  time after each pass, and `delegation-sweep-clock.test.ts` counts census reads as passes started. The lane instead keeps the census
  its own pass read (`passCensus`, set in `pass()` right after its read) and projects that: a third `watch.ts` edit site, in place
  of the plan's second read.
- D-7006, `ownership-is-the-trees-ccd-id` (PR1 Task 1.2, review 1024 F2). The plan's ownership rule compares a listed session's
  `workdir` with the tree's `canonicalPath` by string; ccd writes `workdir` unresolved while git resolves the worktree path, so a
  symlinked root never matches. A listed session now owns a tree when its id equals `ccdIdForWorktree(project, canonicalPath)` (the
  divergence sweep's identity, `server/src/divergence.ts`); a null id owns nothing, nor does an attempt with no path, and `workdir`
  leaves the projection's session shape and the lane's `LaneSession`. The coordination L1 file `delegation-projection.ts` now imports
  that L1 decider. Rows W4-P17 (a `/link` workdir and a `/real` tree, red against the old rule) and W4-P18 (an Agent-tool lease is
  owned by nobody; mutant W4-M27); W4-P8 and W4-W9 were re-fixtured to ccd's layout, W4-M03 re-measured as "drop the ownership
  precedence" (reds W4-P8, W4-P17), and W4-M24 retired with `workdir`. Residue (the divergence sweep's accepted rule; display only
  in wave 4): a tree outside the worktree root whose last two segments are `<project>/<slug>`, or whose basename starts with
  `<project>-`, reads as owned when that id is listed.

## Smaller notes (no number)

- Task 1.1: the `DelegationUnownedWire.reason` comment names `server/src/coord/delegation-policy.ts` without the plan snippet's
  `:175` line number, under the repository's rule that code is cited by anchor or symbol, not by line.
- Task 1.2, W4-K1: measured red before the arm was added. The kebab-token census named `offline-coordinator` in
  `delegation-projection.ts`, so `mail-routes.test.ts` admits the module's words through `isDelegationProjectionKebab`.
- Fix round 1 (review 1024 F1): `tick()` returns on an unlistable registry before any lane runs, so the withdrawal is also called
  there (`withdrawDelegation()`, shared with the projection's null arm); row W4-W10 drives it through `tick()`, mutant W4-M26.
- Fix round 1 (F3, F4): `delegationRunStamps` is pinned through the real read: W4-ST1 (an unreadable openedAt or closedAt refuses
  the read; W4-M28) and W4-ST2 (every open run plus the newest `closedLimit` closed ones; W4-M29, W4-M30).
- Found by CI: the frame's `FleetMsg` arm shifts `shared/api.ts` by four lines, so the child-workspace-reclamation spec's
  `PRESENCE_*` citation (pinned by `collect-lane-prose.test.ts`) moves from 4638-4639 to 4642-4643. PR2's branch, which
  cherry-picks Task 1.1, needs the same citation change. The wave-3 store census now counts seven delegation methods
  (`delegationRunStamps`), and the hibernation census has a `held-awake` row for the projection's dead-parent compare.
