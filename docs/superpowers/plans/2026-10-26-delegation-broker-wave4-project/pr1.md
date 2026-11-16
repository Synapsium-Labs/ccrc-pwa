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
  the conflicting unowned row and no lease row (W4-P21). Its mutant keeps the OLDEST unowned-work attempt per tree (the comparison
  that picks the kept attempt, reversed): measured 4 failed | 21 passed in delegation-projection (W4-P21, W4-P12, the "superseded
  conflict" row and W4-P13).
- D-7004, `r9-decided-in-the-run-binding` (PR1 Task 1.2, found by CI). The plan puts R9 (`coordinatorOf`) in
  `delegation-projection.ts` as a private helper. Its two comparisons (`r.sessionId !== id`, `r.claimedBy === id`) are run/session
  equality sites, and the ARCH-62 census (`run-session-census.test.ts`) pins every such site outside the binding module at zero.
  R9 therefore lives in `server/src/coord/runBinding.ts` as `claimantAt(runs, sessionId, at)` (the id-string rule through
  `runNamesSession`, plus one census entry naming its claimant test as the binding module's own rule), and the projection calls
  it. The rule, its rows (W4-P7, W4-P9, W4-P11, W4-P15, W4-P16) and its mutants (W4-M02, W4-M23 in `runBinding.ts`; W4-M04 in the
  projection) are unchanged. Fix round 1 adds W4-P20 (the interval is inclusive at both ends: W4-M32, `closedAt <= at`, and W4-M33,
  `openedAt >= at`, each red exactly W4-P20) and W4-P19 (the greatest id answers). Fix round 2 (review 1028 P1) made W4-P19 assert both
  input orders, ascending first, because the store read answers ascending and the round-1 fixture's descending order let a first-match
  tie-break survive: W4-M34 (`if (best === null) best = r`, first match wins) and W4-M31 (`r.id < best.id`) each red exactly W4-P19 on
  the ascending order (1 failed | 34 passed with delegation-frame).
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
  that L1 decider (a Coordination file importing the divergence decider: L1 to L1, across contexts). Rows:
  - W4-P17: a tree under another root (`/real/<project>/<slug>`) is owned by the session its ccd id names. Its committed sessions
    carry no `workdir`, because the join reads none. Measured once against the old workdir rule, the same world with workdirs spelled
    `/link/<project>/...` was red (fix round 1), and review 1028 measured the control (the same world with them spelled
    `/real/<project>/...`) green, so that red was the symlink spelling, not a missing field.
  - W4-P18: an Agent-tool lease (`<root>/<project>/.claude/worktrees/agent-x`) is owned by nobody. Its mutant W4-M27 is exactly
    `return id === null || sessions.has(id)` (a null id reads as owned); merely dropping `id !== null` is equivalent to the shipped
    code, since `sessions.has(null)` is false, and is not this mutant. Two separate measurements: the worker's, 14 failed of 22 in
    delegation-projection alone (fix round 1); review 1028's, 22 failed of 35 across delegation-projection and delegation-frame.
  - W4-P22 (fix round 2): ccd's flat layout `<root>/<project>-<slug>` is owned by `<project>-<slug>`, and not when only the
    basename-join ids are listed. Mutant W4-M35, the basename join `` `${project}-${basename}` `` in place of `ccdIdForWorktree`, reds
    exactly W4-P22 (1 failed | 36 passed with delegation-frame).
  - W4-P23 (fix round 2): the nested reading wins, so `<root>/<project>/<project>-x` is owned by `<project>-<project>-x`, not by the
    flat reading's `<project>-x`. An inline flat-first reading reds exactly W4-P23 (1 failed | 36 passed).
  - W4-P8 and W4-W9 were re-fixtured to ccd's layout. W4-W9 lists the owning session only after the lease exists, because the lane
    never leases a tree whose ccd workspace is listed. Fix round 2 (review 1028 R2) added its `unowned` assertion: listing the
    workspace files a `conflicting` attempt, so dropping ownership from the unowned filter reds W4-W9 (with W4-P8, P17, P22, P23: 5
    failed | 32 passed), and dropping it from the lease filter still reds W4-W9 on `leases` (the same five).
  - W4-M03 was re-measured as "drop the ownership precedence" (reds W4-P8, W4-P17), and W4-M24 retired with `workdir`.

  Residue (the divergence sweep's accepted rule; display only in wave 4): a tree outside the worktree root whose last two segments are
  `<project>/<slug>`, or whose basename starts with `<project>-`, reads as owned when that id is listed. Non-equivalence with PR2
  (review 1028 P2, ruled): PR2's rule 7 (plan Task 2.4, row W4-U14, mutant W4-UM8) keeps its workdir-equality re-check on the
  separately arriving frame, and that ruling stands. The two predicates are NOT equivalent, and neither is a symlink-proof identity
  check: this display-only server join reads the ccd id, while PR2's client re-check compares path spellings. So the client re-check
  can miss a tree whose `workdir` and `canonicalPath` are spelled through different symlinks, and it can hide a tree whose path equals
  a session's `workdir` exactly but from which no ccd id derives. Wave 5's acts bind through `bindingOf`, with births, not through
  either predicate.

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
