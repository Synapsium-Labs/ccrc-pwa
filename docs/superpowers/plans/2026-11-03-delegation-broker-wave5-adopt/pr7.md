# PR7 (S3, adoption, the digest and the reminder): departures and measurements

Run 1569, delegation broker wave 5, Tasks 5.7.1 to 5.7.4, with the carried items of the coordinator's brief (reviews 1549
and 1564). Five departures are defined in the plan's "Deviations found": D-8053 (Task 0 left PR7, by the coordinator's ruling
of 2026-11-06; below), D-8054 (adoption's `boxHolds` needs `lease-mark-lock-v1` too, through the one predicate the doors use,
`boxHoldsTrees`), D-8055 (the lane's adoption step is its own module, `server/src/coord/delegationAdoptStep.ts`, called from
`watch.ts`), D-8056 (a notice is owed at the lease's current generation, so a transfer refused back to `adopted` is owed a
notice of its own) and D-8057 (the audit answers are held while the decider watches the lease). The rest of the block issued
to this run is unused, and this note does not spell it.

D-8037's sentence about the mark's locks is amended in place (review 1549 F6): one lock per distinct spelling, as the code and
`pr6.md` say.

## Task 0 left PR7 (D-8053)

The brief made Task 0, the capture of the fleet's lane versions the corpus lacked (2.1.311, 2.1.314, 2.1.316, 2.1.318 and
2.1.319), PR7's first commit. The capture ran clean (`recapture.sh` with those versions named, exit 0, the residue scan
clean), but 55 of its 70 new cells built unmeasured: every agent and workflow scenario stopped at its delegating PreToolUse,
on every version, and only `raw-worktree`, `clear-compact-resume` and `swap-resume` measured. The cause is the rig, not the
versions. The rig installs today's session hook, whose fan-out arm (D-6798) denies an Agent or Task call that names no
model and a workflow `agent()` that names no model or effort. The rig's scripted fan-outs name neither, and the corpus was
captured before that arm landed.

So the worker stopped before Task 5.7.2, and the coordinator ruled that Task 0 leaves PR7. The capture was discarded:
`matrix.json` is HEAD's, the five version directories were removed and the raw root deleted, and the rig README's leftover
check printed nothing. The corpus for those versions, with the rig's fan-outs naming their model, is its own change. It
lands before the operator arms adoption. PR7 lands on the 14-version corpus, which W5-D12 reads at PR7's tip, and the six
corpus suites are green on it, each run alone.

## The floor rule, as built

PR7 adds no transition-table row, loosens no `assertLease` rule or decision, changes no fold of an existing kind, and adds no journal
kind, entry field or checkpoint member. Adoption writes through PR5b's `transitionLease` only, with reason `adopt`, the expiry, the
clamped `terminalEvidenceAt` (D-7968: `max(terminalAt, firstObservedAt)`) and, when the audit answered, its token as `auditEvidence`.
The `retained-lineage` fold is PR5a's (D-7973), unedited here; W5-Q2 pins it and W5-DM15 removes it to show the row reds. The two wire
members (`disposition?`, `expiresAt?`) are wire, not journal. `store.ts` is unchanged.

## How a notice is owed (D-7812, D-7813, D-8056)

Every pass derives the notices from durable state, never from that pass's decisions: `owedLeaseNotices` names every unreleased lease
whose carrier state is `adopted` (its `adoptedAt` set) at its current generation, with a recipient. Each is queued through
`queueRunlessNotice`, which asks `hasMailWithSubject` and inserts in ONE transaction, keyed on a subject that names the lease and its
generation, so a crash, a restart or a standing `mail-disabled` never loses one and never sends one twice (W5-Q3, W5-Q3b, W5-Q4).

- **The adopt generation, through `adoptedAt` (review 1462 M3).** A lease is adopted only from `ephemeral`, so the generation an adopted
  lease stands at is its adoption's. A transfer moves it to `transferring` (owed nothing while it is there); a refused or recovered
  transfer returns it to `adopted` two generations later, and that re-adopted lease is owed a notice of its own under the new
  generation's subject (D-8056; the owed-notice row in `delegation-adoption.test.ts`, which also pins a lease in a transfer).
- **The recipient (O5-4 (a)).** `leaseRecipient(lease, parent, leaseCoordinatorOf(lease, runs))`, with `runs` read through PR8's
  `runStampsOfSeries` (D-8042), never the bounded `delegationRunStamps()`, and no store method added (`run-session-census` keeps its
  ceiling of four). A series that does not read leaves the notice owed this pass, never addressed to the worker.
- **Reminders** are derived the same way: a kept (`adopted` or `retained`) lease whose expiry is at most 24 hours away and not yet
  passed is owed one reminder per lease and generation.

## The audit's two blind spots (reviews 1461 F6 and 1467 M12)

`ws-lease-audit` answers `changed: false` for a tree whose only work is (1) a commit reachable from the tree's HEAD reflog alone (made
on a detached HEAD, then left by a checkout), or (2) a stash, which lives in the repository's shared `refs/stash`, not in the tree.
Adoption leaves such a tree `ephemeral` and the orphan ladder decides it; the removal paths pin reflogs, and a stash is never in the
tree the orphan lane removes. Neither is a change this PR makes.

## Measured, not departures

- **The decider's small widenings.** `AdoptionInput` takes `raised` (the attention keys still standing) and `decideAdoption` answers
  it, so an attention item is raised once per episode (W5-D21) with no clock and no lane decision. The module also exports
  `adoptionCarrierReads` (rules 1 to 3's read set, so the lane reads only candidates' carriers), `adoptTerminalEvidenceAt` (the D-7968
  clamp), `parseLeaseAuditAnswer` (the audit's one server reader; anything outside the verb's grammar is `unmeasured`, which counts as
  changed) and `DELEGATION_HOLD_CLOSING`. `delegationLeaseDoor.ts` exports `boxHoldsTrees` (D-8054).
- **An unmeasured breaker waits.** Rule 8 adopts only on `clear`; `unmeasured` waits too, with the health's `mode: 'unmeasured'`, and
  only `suspended` raises the episode's attention item.
- **The health's `waiting`** counts leases waiting on their carrier's read-back or the settle; the other waits have their own counts.
- **The corpus row's replay (W5-D12).** For every version in `matrix.json`, each scenario is replayed through the real session hook
  (one run per captured payload, into a fixture spool, a stub tmux) and the lane (`delegation-watch.test.ts`'s rig: a FleetWatcher over
  a fixture home), against a census built from the capture's own admin records and metas, to the lane's checkpoint; the decider is then
  given the scenario's audit answer and a settled watch. `agent-iso-unchanged` leaves no admin record (Claude Code removes an unchanged
  isolated tree itself), so it is never leased and never adopted; the decider's `changed: false` rule is pinned by W5-D10. A paused
  workflow (`wf-limit-pause`) leaves no tree either. `wf-iso` adopts exactly when its run's terminal notification is in the replay,
  and a control row holds that the workflow arm adopted on at least one version.
- **Review 1564 F2 (RULED accept).** `treeLeaseOf` stays ownership-blind: an unowned row emitted for an attempt whose path no workspace
  owns names the hidden lease even when that lease's own path is a ccd workspace's (a moved worktree), as a `tree-<key>` resolve does.
  Rows: the moved-worktree case, and the order (first observation, then id) both ways, in `delegation-projection.test.ts`.
- **Review 1549 F1.** On a box that reads nothing, a released lease counts `unsupported` from journal evidence: its carrier was read
  back at some generation (`carrierGenerationSeen` above 0). `pr6.md`'s review 1547 F5 sentence ("a released lease that never had a
  carrier gets no step") is read with that measure; `pr6.md` is not edited here.
- **Review 1549 F4.** The `notIndexed` clear returns in a new place: a by-tree read whose entry names a lease already measured without
  one removes it from `notIndexed`, so its heal is asked again on the next pass.

## Carried items

| Item | What changed | Row (red under its mutant) | Mutant |
|---|---|---|---|
| A, Task 0 | none: Task 0 left PR7 (D-8053) | W5-D12 over the 14-version matrix | none |
| B, D-7973 | none: the fold is PR5a's | W5-Q2 | W5-DM15 |
| B, the clamp | the adopt door writes `max(terminalAt, firstObservedAt)` | W5-Q2 (`terminalEvidenceAt`), the D-7968 row | none |
| B, the adopt generation | D-8056 | the owed-notice row | none |
| B, blind spots | stated here and in the PR body | none | none |
| B, 1546 F1 | the step reads each candidate's carrier itself | W5-Q1, W5-Q2 | none |
| B, D-8037/D-8040 | D-8054 | `boxHolds` rows (lane), W5-R12d | D-8054-lock |
| B, the claimant read | `runStampsOfSeries`, no store method | W5-Q5 | W5-DM11b, W5-DM11d |
| C, 1549 F1 | counted from journal evidence | W5-K2 | 1549-F1 |
| C, 1549 F2 | none (row only) | the F2 row in `delegation-carrier-lane.test.ts` | 1549-F2 |
| C, 1549 F3 | none (row only) | the 1547 F2 row's lower edge | 1549-F3 |
| C, 1549 F4 | the clear, for a late entry | the F4 row | 1549-F4 |
| C, 1549 F5/F6 | `planCarrierPass`'s comment; D-8037 | none | none |
| D, 1564 F1 | none (rows only) | `delegation-lease-acts` 1564 F1 (both ends), W5-Q5 (both ends) | 1564-F1-asc, 1564-F1-desc |
| D, 1564 F2 | none (rows only) | the two 1564 F2 rows | 1564-F2-id-only, 1564-F2-instant-only |
| D, 1564 F5 | one `try` around the decision step | 1564 F5 in `lease-routes.test.ts` | 1564-F5 |
| D, 1564 F8 | none (rows only) | 1564 F8 in `lease-routes.test.ts` and in the lane | (W5-DM14, D-8054-lock) |

## The mutation table

Each mutant was applied alone to a saved copy, run against the rows named, and restored with its sha checked. All 31 were
killed, each on the row it was written for.

| Mutant | File | The mutation | Red rows |
|---|---|---|---|
| W5-DM1 | `delegation-adoption.ts` | drop the adoptable-source filter | W5-D2; W5-D12 on every version |
| W5-DM2 | `delegation-adoption.ts` | any non-active activity is terminal | W5-D4 |
| W5-DM3 | `delegation-adoption.ts` | an unmeasured registry counts as an absent parent | W5-D5 |
| W5-DM4 | `delegation-adoption.ts` | a null incarnation counts as a changed one | W5-D6 |
| W5-DM5 | `delegation-adoption.ts` | no stable-pass count | W5-D7, W5-D9 |
| W5-DM6 | `delegation-adoption.ts` | the breaker never waits | W5-D8, W5-D21 |
| W5-DM7 | `delegation-adoption.ts` | only `changed: true` counts as changed | W5-D10 |
| W5-DM8 | `delegation-adoption.ts` | an absent marker counts as live | W5-D11; W5-Q1 |
| W5-DM9 | `rundefsTx.ts` | dedupe on outstanding mail only | W5-Q3, W5-Q3b |
| W5-DM9b | `delegationAdoptStep.ts` | notices from this pass's decisions, not durable state | W5-Q3b, W5-Q4 |
| W5-DM10 | `delegationAdoptStep.ts` | `mail-disabled` does not hold the notice | W5-Q4 |
| W5-DM11 | `delegation-adoption.ts` | the coordinator never receives | W5-D20; W5-Q5 |
| W5-DM11b | `delegationAdoptStep.ts` | the claimant from open runs only | W5-Q5 (each shape) |
| W5-DM11c | `delegation-adoption.ts` | the parent receives at any incarnation | W5-D20; W5-Q6b |
| W5-DM11d | `delegationAdoptStep.ts` | the bounded `delegationRunStamps()` read | W5-Q5 (first of 502) |
| W5-DM12 | `delegation-adoption.ts` | the decider reads the clock | W5-D10, W5-D11, W5-D14 |
| W5-DM13 | `delegation-adoption.ts` | a conflicting tree does not wait | W5-D18 |
| W5-DM14 | `delegation-adoption.ts` | `boxHolds` ignored | W5-D19; the `boxHolds` rows |
| W5-DM15 | `delegation-checkpoint.ts` | the `retained-lineage` fold removed | W5-Q2 |
| W5-DM16 | `delegation-adoption.ts` | an uncensused project drops its watch | W5-D14b |
| W5-X-writer | `delegationAdoptStep.ts` | the step writes the marker | W5-X1, W5-X2 |
| D-8054-lock | `delegationLeaseDoor.ts` | `boxHoldsTrees` without the lock word | the lane's `boxHolds` row; the lock row in `lease-routes.test.ts` |
| 1564-F1-asc | `store.ts` | the series read takes the first 500 | 1564 F1 (both ends); W5-Q5 (last of 502) |
| 1564-F1-desc | `store.ts` | the series read takes the newest 500 | 1564 F1 (both ends); W5-Q5 (first of 502) |
| 1564-F2-id-only | `delegation-conflicts.ts` | order by id only | the 1564 F2 order row |
| 1564-F2-instant-only | `delegation-conflicts.ts` | order by instant only | the 1564 F2 order row |
| 1564-F5 | `delegationLeaseDoor.ts` | no `try` around the decision step | 1564 F5 |
| 1549-F1 | `delegation-carrier.ts` | no journal evidence for a released lease | W5-K2 |
| 1549-F2 | `delegationCarrierMark.ts` | an up-to-date lease stays unmeasured | the F2 row |
| 1549-F3 | `delegationCarrierMark.ts` | the retry after 3 passes, not 30 | the 1547 F2 row's lower edge |
| 1549-F4 | `delegationCarrierMark.ts` | no `notIndexed` clear | the F4 row |

The mutants in `store.ts`, `delegation-checkpoint.ts` and `delegation-conflicts.ts` touch files PR7 does not edit. They
show that PR7's rows guard code PR7 relies on.

## Counts moved

- The switchboard: 36 rows (32 markers, 4 settings) to 37 (33 markers, 4 settings), `switches.test.ts`.
- `W5_OPEN` in `delegation-wave3.integration.test.ts`: the `delegation-adopt` row names three files, and the
  `ws-lease-audit` row gains `delegation-adoption.ts` and `delegationAdoptStep.ts`. The lane store-mention list gains two
  lines, and the step may call `queueRunlessNotice` once.
- `run-session-census` keeps its ceiling of four. No store method is added.
- The coordinator skill's clauses are unchanged.

## Growth

`GROWTH_CHECK=1` growth-check is green. `watch.ts` grows by 12 lines (13 added, 1 removed): 11 net code lines, against the
plan's aim of at most +40. `store.ts` is unchanged. The two new coord files are `delegation-adoption.ts` (302 lines) and
`delegationAdoptStep.ts` (210).

## Suites at the tip

Each suite ran alone, through `ccrc test`: the plan's "PR7 at its tip" list and every guard suite `fast-plan.mjs#guardTests`
derives, 218 files in all, then `growth-check` (armed), `deviation-refs`, the server and pwa typechecks and pwa's
`older-server-render`. The six corpus suites and W5-D12 ran on the 14-version corpus.

- Green: every one, except `retire-executors-pin`.
- `spawn-group-pin` was red on the first run: the corpus replay's timed hook spawn did not go through `spawnSyncGroup`.
  The replay now uses it, and the suite is green.
- `typecheck-tests` was red twice. The first run lacked the agent package's modules in this worktree. The second was
  killed by the test slice's memory cap with no type error printed. Its third run, alone, is green.
- `retire-executors-pin` is red, 13 of 206. It reds on the fleet box on a clean `main` too (the brief), so the merge queue judges it.
