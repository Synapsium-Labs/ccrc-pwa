# PR7 (S3, adoption, the digest and the reminder): departures and measurements

Run 1569, delegation broker wave 5, Tasks 5.7.1 to 5.7.4, with the carried items of the coordinator's brief (reviews 1549
and 1564). Six departures are defined in the plan's "Deviations found": D-8053 (Task 0 left PR7, by the coordinator's ruling
of 2026-11-06; below), D-8054 (adoption's `boxHolds` needs `lease-mark-lock-v1` too, through the one predicate the doors use,
`boxHoldsTrees`), D-8055 (the lane's adoption step is its own module, `server/src/coord/delegationAdoptStep.ts`, called from
`watch.ts`), D-8056 (a notice is owed at the lease's current generation, so a transfer refused back to `adopted` is owed a
notice of its own), D-8057 (a definite audit answer is held for its generation and at most an hour, amended in place in fix
round 1) and D-8058 (fix round 1: a parent's death the lane saw is kept until counter-evidence, the parents are classified in
L1, and a carrier is read only past rules 4 to 6). That uses the whole block issued to this run.

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
  ceiling of four). It answers one of three, never folded together (review 1587 F6 and A2): `mail` to the coordinator or to the
  parent at the lease's incarnation; `record-only` when there is no one to mail (the parent measured absent, or its row re-created),
  where the adoption's feed row and the Keep control on the lease row are the notice; and `unmeasured` when the parent's row or
  incarnation did not read, or the series did not, which holds the notice and counts it owed, never addressed to the worker.
- **No dated notice after its date (review 1587 F5).** A digest is owed only before the lease's `cleanupDueAt`. An adoption made
  while `mail-disabled` stood and lifted after day 7 queues none; the `expired:` attention item covers that lease.
- **The health's `owed`** counts only notices not yet sent (review 1587 F6): while `mail-disabled` stands, a notice whose subject
  already has mail is not counted; one for an unmeasured recipient is.
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
  `adoptionCarrierReads` (the leases past rules 4 to 6, at most 8 a pass, D-8058), `adoptionParentFacts` (D-8058), `adoptionAudits`
  (D-8057), `adoptTerminalEvidenceAt` (the D-7968 clamp), `parseLeaseAuditAnswer` (the audit's one server reader; anything outside the
  verb's grammar is `unmeasured`, which counts as changed) and `DELEGATION_HOLD_CLOSING`. `delegationLeaseDoor.ts` exports
  `boxHoldsTrees` (D-8054).
- **An unmeasured breaker waits.** Rule 8 adopts only on `clear`; `unmeasured` waits too, with the health's `mode: 'unmeasured'`, and
  only `suspended` raises the episode's attention item.
- **The health's `waiting`** counts leases waiting on their carrier's read-back (one over the read bound included) or the settle; the
  other waits have their own counts.
- **A record-only feed row lost to a crash (review 1587 A9, accepted).** A lease with no one to mail has the adoption's feed row as
  its notice, written on the transition's own `applied` answer and never re-derived from the journal, so a crash between the commit
  and the row loses it. The lease row's `disposition: adopted` still shows the adoption, with the operator's Keep control.
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

## Fix round 1 (review 1587)

The coordinator's rulings on review 1587 at `d399d063f`, each with its rows and its mutants (the mutation table below). The
floor rule holds: no transition row, no loosened `assertLease`, no changed fold, and no new journal kind, entry field or
checkpoint member.

- **A7 (the parents in L1).** The step's `parentFacts` was a decision. `adoptionParentFacts` in `delegation-adoption.ts` now
  classifies the parents from the pass's reads (the registry's listing and the rows it assembled, liveness, the census's
  incarnations, the lane's first-dead instants) and `now`. The step passes reads and acts; it decides nothing (D-8058).
- **F1 (listed but not built).** A row the registry's listing names but could not assemble is `unmeasured`, never `absent`, so it
  gives no terminal evidence. The listing's ids reach the lane through a getter of the watcher's `listedIds`.
- **F2 (a death the lane saw).** Kept after the hour-long dead-since memory ages out, until the parent is measured alive at the
  lease's incarnation (D-8058). A server restart still loses that memory: adoption then waits for evidence that survives a restart
  (an ended activity, a changed incarnation, the row measured absent), which only ever adopts less. The operator's
  `adoption.wouldAdopt` drops after a restart, a rollout included.
- **The restart window.** The review asked whether a supervisor inside its restart window can read as dead. The F2 rows answer it:
  a parent dead for one pass, or for three, and then alive again at its incarnation never adopts.
- **F3 and A8 (held audits).** D-8057 as amended: definite answers only, for the generation and at most an hour, unchanged ones
  included; an answer that is not definite is fed on the pass that read it (rule 7 counts it as changed) and asked again.
- **F4 (attention after the act).** An attention key is recorded only after its notice ran, so a pass cut while the adopt transition
  is awaited raises its items on the next pass, once.
- **F5, F6 and A2 (the notices).** See "How a notice is owed" above.
- **F7 (bounded carrier reads).** The lane reads a carrier only for a lease past rules 4 to 6, just before its act or shadow line,
  at most 8 a pass (`DELEGATION_ADOPT_CARRIER_READS_PER_PASS`, as PR6 bounds its re-reads); one over the bound waits a pass (D-8058).
- **A1 (two log memories).** The shadow line and the refusal line are remembered apart, each once per lease and generation, and
  both are pruned with the lease.

| Item | Row (red under its mutant) | Mutant |
|---|---|---|
| A7, F1 | A7/F1 `adoptionParentFacts`; F1 (L1, over the settle and the passes); F1 (lane) | PR7-FR1-F1 |
| F2 | F2 (L1: kept, dropped when alive again, unmeasured neither); F2 (lane: aged out, shadow then live) | PR7-FR1-F2-keep |
| F2, counter-evidence | F2 (lane: dead for 3 passes, then alive); W5-D3, W5-D4 | PR7-FR1-F2-counter |
| F2, restart | F2 (lane: a new lane over a dead parent adopts nothing) | none: it states what a restart does |
| F3 | F3 and A8 (L1); F3 (lane: past the hour, asked again before adopting) | PR7-FR1-F3-age |
| F3, not definite | F3 and A8 (L1); F3 (lane: an unmeasured answer asked again) | PR7-FR1-F3-unmeasured |
| A8 | F3 and A8 (L1); A8 (lane: no second audit within the hour) | PR7-FR1-A8-unchanged |
| F4 | F4 (lane) | PR7-FR1-F4 |
| F5 | F5 (L1, with its control a minute before); F5 (lane) | PR7-FR1-F5 |
| F6 | F6 (lane: a sent digest is not owed) | PR7-FR1-F6 |
| F6, A2 | W5-D20; F6 and A2 (lane: an unmeasured recipient) | PR7-FR1-A2 |
| F7 | F7 (L1: no read without rules 4 to 6, at most 8) | PR7-FR1-F7-bound, PR7-FR1-F7-past46 |
| A1 | A1 (lane) | PR7-FR1-A1 |

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
| D, 1564 F8 | none (rows only) | 1564 F8 in `lease-routes.test.ts` and in the lane | (W5-DM14) |

## The mutation table

Each mutant was applied alone to a saved copy, run against the rows named, and restored with its sha checked. All 44 were
killed. The red rows are those measured on fix round 1's tip; the original 24 adoption-side and claimant mutants were
measured again there, and four of them (W5-DM9b, W5-DM10, W5-DM11 and W5-DM11c) were restated on the changed code with the same meaning.
The carrier, conflict and door mutants (1549-F1 to F4, 1564-F2 and 1564-F5) touch code fix round 1 does not change and are
as first measured.

| Mutant | File | The mutation | Red rows |
|---|---|---|---|
| W5-DM1 | `delegation-adoption.ts` | drop the adoptable-source filter | W5-D2, the carrier-read row; W5-D12 on every version |
| W5-DM2 | `delegation-adoption.ts` | any non-active activity is terminal | W5-D4 |
| W5-DM3 | `delegation-adoption.ts` | an unmeasured registry counts as an absent parent | W5-D5, F1 (L1), F2 (L1) |
| W5-DM4 | `delegation-adoption.ts` | a null incarnation counts as a changed one | W5-D6, F2 (L1) |
| W5-DM5 | `delegation-adoption.ts` | no stable-pass count | W5-D7, W5-D9, F7 |
| W5-DM6 | `delegation-adoption.ts` | the breaker never waits | W5-D8, W5-D21 |
| W5-DM7 | `delegation-adoption.ts` | only `changed: true` counts as changed | W5-D10 |
| W5-DM8 | `delegation-adoption.ts` | an absent marker counts as live | W5-D11, F2 (L1); W5-Q1, F2, F3, F4, A1 (lane) |
| W5-DM9 | `rundefsTx.ts` | dedupe on outstanding mail only | W5-Q3, W5-Q3b |
| W5-DM9b | `delegationAdoptStep.ts` | notices from this pass's decisions, not durable state | W5-Q3b, W5-Q4, F6 and A2 |
| W5-DM10 | `delegationAdoptStep.ts` | `mail-disabled` does not hold the notice | W5-Q4, F5, F6 and A2 |
| W5-DM11 | `delegation-adoption.ts` | the coordinator never receives | W5-D20; W5-Q5 (each shape) |
| W5-DM11b | `delegationAdoptStep.ts` | the claimant from open runs only | W5-Q5 (the three closed shapes; the open shape cannot red under an open-runs read) |
| W5-DM11c | `delegation-adoption.ts` | the parent receives at any incarnation | W5-D20; W5-Q6b |
| W5-DM11d | `delegationAdoptStep.ts` | the bounded `delegationRunStamps()` read | W5-Q5 (first of 502) |
| W5-DM12 | `delegation-adoption.ts` | the decider reads the clock | W5-D17, deterministically. While the wall clock is before the fixture's T0 (2026-11-10 12:00 UTC) it also reds W5-D1, D2, D5, D6, D8, D10, D11, D13, D14, D14b, D15, D16, D16b, the carrier-read row and the F1, F2, F3 and F7 rows (19 rows with W5-D17, measured 2026-11-06); after T0 those stop being killers |
| W5-DM13 | `delegation-adoption.ts` | a conflicting tree does not wait | W5-D18, the carrier-read row |
| W5-DM14 | `delegation-adoption.ts` | `boxHolds` ignored | W5-D19; the two `boxHolds` rows and the 1564 F8 row (lane) |
| W5-DM15 | `delegation-checkpoint.ts` | the `retained-lineage` fold removed | W5-Q2 |
| W5-DM16 | `delegation-adoption.ts` | an uncensused project drops its watch | W5-D14b |
| W5-X-writer | `delegationAdoptStep.ts` | the step writes the marker | W5-X1, W5-X2 |
| D-8054-lock | `delegationLeaseDoor.ts` | `boxHoldsTrees` without the lock word | the lane's `boxHolds` row without `lease-mark-lock-v1`; the lock row in `lease-routes.test.ts` (not the 1564 F8 rows: with `ccdVerbs` null the mark word already fails) |
| 1564-F1-asc | `store.ts` | the series read takes the first 500 | 1564 F1 (both ends); W5-Q5 (last of 502) |
| 1564-F1-desc | `store.ts` | the series read takes the newest 500 | 1564 F1 (both ends); W5-Q5 (first of 502) |
| 1564-F2-id-only | `delegation-conflicts.ts` | order by id only | the 1564 F2 order row |
| 1564-F2-instant-only | `delegation-conflicts.ts` | order by instant only | the 1564 F2 order row |
| 1564-F5 | `delegationLeaseDoor.ts` | no `try` around the decision step | 1564 F5 |
| 1549-F1 | `delegation-carrier.ts` | no journal evidence for a released lease | W5-K2 |
| 1549-F2 | `delegationCarrierMark.ts` | an up-to-date lease stays unmeasured | the F2 row |
| 1549-F3 | `delegationCarrierMark.ts` | the retry after 3 passes, not 30 | the 1547 F2 row's lower edge |
| 1549-F4 | `delegationCarrierMark.ts` | no `notIndexed` clear | the F4 row |
| PR7-FR1-F1 | `delegation-adoption.ts` | presence read from the assembled rows again (listed but not built reads absent) | A7/F1, F1 (L1); F1, F6 and A2 (lane) |
| PR7-FR1-F2-keep | `delegation-adoption.ts` | drop the keep | F2 (L1); F2 aged out (lane) |
| PR7-FR1-F2-counter | `delegation-adoption.ts` | keep without counter-evidence | F2, F7, W5-D3, W5-D4 (L1); F2 dead for 3 passes then alive (lane) |
| PR7-FR1-F3-age | `delegation-adoption.ts` | drop the hour | F3 and A8 (L1); F3 past the hour, A8 (lane) |
| PR7-FR1-F3-unmeasured | `delegation-adoption.ts` | hold an answer that is not definite | F3 and A8 (L1); F3 unmeasured (lane) |
| PR7-FR1-A8-unchanged | `delegation-adoption.ts` | hold `changed: true` only | F3 and A8 (L1); A8 (lane) |
| PR7-FR1-F4 | `delegationAdoptStep.ts` | record the keys before the effects | F4 (lane) |
| PR7-FR1-F5 | `delegation-adoption.ts` | drop the date test | F5 (L1); F5 (lane) |
| PR7-FR1-F6 | `delegationAdoptStep.ts` | count a held notice without asking for its mail | F6 (lane) |
| PR7-FR1-A2 | `delegation-adoption.ts` | an unmeasured registry answers record-only | W5-D20; F6 and A2 (lane) |
| PR7-FR1-F7-bound | `delegation-adoption.ts` | no bound on the reads | F7 |
| PR7-FR1-F7-past46 | `delegation-adoption.ts` | read every lease past rules 1 to 3, as before | F7 |
| PR7-FR1-A1 | `delegationAdoptStep.ts` | one memory for both lines | A1 (lane) |

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

`watch.ts` grows by 13 lines against the merge base (16 added, 3 removed). Two of the added lines are comments, so it grows by
11 net code lines, against the plan's aim of at most +40 (review 1587 A6 corrected this figure; fix round 1 added the listing's
ids and liveness to the call). `store.ts` is unchanged. The two new coord files are `delegation-adoption.ts` (398 lines) and
`delegationAdoptStep.ts` (204).

## Suites at the tip

Fix round 1's tip ran every suite alone, through `ccrc test`. That is 226 files: the plan's "PR7 at its tip" list, the
coordinator's fix-round list (`lease-routes`, `delegation-lease-acts`, the corpus suites, `refusal-status`, `coord-store`,
`run-session-census`, `anchors`, `topology-clean`, every `single-definition` file, `typecheck-tests`, `deviation-refs` and
`dtbd` after a fetch) and the 199 guard suites `fast-plan.mjs#guardTests` derives. Then `growth-check` armed and the pwa
typecheck. The corpus suites and W5-D12 ran on the 14-version corpus.

- Green: every one, except `retire-executors-pin`.
- `typecheck-tests` was red on its run: two rows typed a watch as `never`, and the corpus row's parent lacked `ParentFact`'s
  new `alive`. Fixed in their own commit; green alone, and the two suites green again.
- `rings/watcher-store-port` (a 20 s `beforeAll` timeout), `delegation-recovery` (two 20 s timeouts, then a descriptor left
  open by a timed-out row) and `secret-mask` (a 250 ms timing bound read 289 ms) were red under load. Each is green alone:
  22/22, 465/465 and 96 passed with 1 skipped. Another worktree was running `delegation-recovery` at the same time, and
  none of the three reaches a module fix round 1 changes.
- `retire-executors-pin` is red, 9 of 206. It reds on the fleet box on a clean `main` too (the brief), so the merge queue
  judges it.

The first round's runs (at `d399d063f`) were the same list less the fix-round additions. There `spawn-group-pin` was red
first, until the corpus replay's hook spawn went through `spawnSyncGroup`. `typecheck-tests` was red twice there, once for
the agent package's missing modules and once killed by the test slice's memory cap, and green alone on its third run.
