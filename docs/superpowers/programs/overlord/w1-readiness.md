# Overlord W1: the readiness word (task note)

The note of the one pull request that builds `docs/superpowers/plans/2026-11-14-overlord-w1/w1-readiness.md`, Tasks 1 to 4
(programme overlord, wave 235, run 3866). The coordinator folds what the ledger should learn from it. No deviation number was
allocated: every departure below is a slug.

## In short

One measured word for the designated Overlord, decided by a pure first-match table (`overlordReadiness`, Table 6.4a) that
never rises on doubt. A lane computes it every ten seconds from each producer's one reader, records each change of word as a
row stamped on `overlord_sequence`, and serves it through one read that answers `unmeasured` (`boot`, `stale`) whenever this
process has not measured lately. The operator is told one push per dead episode, and items that end when their cause clears.

The build is in two stages (the brief): stage 1 is everything that touches no file the invariant monitor's worker (#3394)
holds; stage 2, after the monitor lands, adds the held files, the wiring and Task 4.

## What was built, task by task

| Task | Commit | What |
|---|---|---|
| 1 | `feat(overlord): the readiness word, decided first match and falling only with doubt (H20)` | `shared/overlord-readiness.ts` (L0: the fourteen words, `admitRank`, the starting values, `RESTART_OUTCOME_MAP`, `STRAND_CAUSE_MAP`, `ACCOUNT_FAILURE_ERRS`, `ReadinessWire`); `server/src/coord/overlordReadiness.ts` (L1: `readinessFactsOf`, `overlordReadiness`, `readinessNotices`, `servedReadiness`, `readinessCountOf`, `readinessSubjectOf`). Tests: an exhaustive reference written from the plan's rows over three domains (130,464 cases), monotonicity over `admitRank`, unmeasured never ready, the restart count and bound, every notice rule, and the spec's Table 6.4a read both ways (`single-definition/overlord-readiness-table.test.ts`). |
| 2 (stage 1) | `feat(overlord): readiness rows, stamped on the one sequence, and the items' records (H20)` | The migration (two tables, two indexes); `coord/overlordReadinessStore.ts` (`recordReadinessInTx`/`recordReadiness`, `readinessNow`, `readinessChanges`, `openReadinessItems`, `closeReadinessItem`, `pruneReadiness`); `continuityStore.ts#restartsSince` and `#liveGenerationOfIdentity`; the private store's `lastServedReadAt`; the `readiness` kind in `SEQUENCE_KIND_MAP` and its writer in the stamp census. |
| 3 (stage 1) | `feat(overlord): the readiness lane's pass and its read, behind a port (C23, H20)` | `coord/overlordReadinessLane.ts`: `ReadinessLane` (its memory, `pass(tick)`, `read()`) behind `ReadinessLanePort`. |

## Where main differed from the plan

Measured on `4fa87d73f8` before Task 1 (mailed to the coordinator, mails 36603 and 36604):

- Every producer the plan cites is on main but `OVERLORD_ITEM_PROGRAMME` (the monitor, #3394) and `accountHolds` (later).
- `GenerationOutcome` gained `retired` after the plan was written (slug `retired-outcome-is-not-a-restart`, below).
- main already classifies StopFailure tokens (`server/src/coord/stopFailure.ts#STOP_FAILURE_ERRORS`, seven in its account
  class), where the plan meant to measure its own list (slug `account-failure-reads-the-stopfailure-classes`, below).
- `restartVerdict(binding, body, now)` also refuses while a pending attempt is inside its deadline, so `restartable` (and the
  push's Restart action) is false then, as the door is.
- The private store answers `StoreRead`; an empty inbox read writes a served line (`rows`, count 0), so `lastServedReadAt`
  takes the served outcome only, and a case pins that an empty read counts.
- The ladder's read is composed in `server.ts` (the gate's ladder port); the default rung is `chat`.
- The candidates are `renewalReadings.ts#overlordCandidatesOf`; exhaustion per candidate is `poolRunway.ts#earliestReset` over
  that account alone.

## Departures, by slug

The plan's own slugs stand as written (questions 1 to 14, and `strand-cause-from-structured-readers`). This build adds:

- **`retired-outcome-is-not-a-restart`** (ruled yes, call 1319). `RESTART_OUTCOME_MAP` has a fourth class, `retire`, for
  `retired`: the operator ended the binding and no later start replaced it, so it is never counted. A case pins that a retire
  then a new designation's first start counts zero restarts, in a new term and in the same term.
- **`served-read-bounded-by-the-generation-start`.** `lastServedReadAt(generation, sinceMs)` takes the generation's start too:
  the read ledger is never pruned and has only the `(door, at)` index, so each door's range reads the index instead of the
  ledger. Proof older than the start never counts anyway (question 7).
- **`readiness-port-declared-by-the-lane`.** The lane's port is declared in the lane's own file (the consumer declares the
  port), not in `coord/ports.ts`, which another worker holds.
- **`registry-named-before-the-brakes`.** Row 3 names the registry before `off`: on a failed listing `mail-disabled` is
  unreadable too, and the plan's Table 2 and Task 3 say the failed listing reads `why: registry`. The word is the same
  either way.
- **`readiness-reads-only-on-coord-store`.** `CoordStore` gains read delegates only (`readinessNow`, `readinessChanges`,
  `restartsSince`, `liveGenerationOfIdentity`); the writers are called by the lane alone, so they get none.
- **`account-failure-reads-the-stopfailure-classes`** (ruled yes, call 1319; a departure from the spec's Table 6.4a sentence
  "only for `rate_limit`, `authentication_failed` or `billing_error`", which the coordinator amends on the ledger). The
  strand's `turn-failed` cause reads the stall watch's one classifier, `stopFailure.ts#stopFailureClass(err) === 'account'`,
  and the plan's L0 `ACCOUNT_FAILURE_ERRS` is not built. Measured list on `4fa87d73f8` (source: `STOP_FAILURE_ERRORS`, the
  hook's StopFailure arm records Claude Code's `error` cleaned to `[a-z_]`): `rate_limit`, `billing_error`,
  `authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`, `verification_required`, `cloud_credential_error`.
  A token the classifier cannot name (it answers null, a missing token included) is neither a failure nor a pass: the
  strand fact reads unmeasured, so the word answers `unmeasured` at row 8 (`stranded`), never higher, unless a measured
  cause (an empty set, every account limited, a blocked swap) strands it first. A case pins that the cause follows the
  owner's class token by token, so a token added to that class later is covered with no edit here.

What the designation plan's Restart section would have said (fix round 1, F5, carried here at the coordinator's ruling):
"`restartVerdict` is the one Restart decider: readiness's `restartable` asks it, so the dead push carries Restart exactly when
the door would act. It accepts an asleep or gone body, and refuses an up, a restarting (`down`) or an unmeasured one, and any
body while a pending attempt is inside its deadline."

## Readings the tests pin that the plan leaves implicit

- A body down WITHIN the bound reads `restarting` even while the generation renews (row 5 comes before row 6); past the bound
  with the generation renewing it reads `renewing`.
- A `down` body is never past the bound until the lane has seen it: `since` is the lane's first sighting.
- When both `deaf` halves are unmeasured, the operator-message half is named.

## Still to come (stage 2)

The held files (the lane's schedule row, the checked settle beside the checked raise, the floors keys, the pins), the
watcher's two calls, the route and its gate row, the masked routes entry, Task 4's texts, the mutation tables, what runs from
the merge, and the migration's renumbering.
