# PR7 (S3, adoption, the digest and the reminder): departures and measurements

Run 1569, delegation broker wave 5, Tasks 5.7.1 to 5.7.4, with the carried items of the coordinator's brief (reviews 1549
and 1564). Six departures are defined in the plan's "Deviations found": D-8053 (Task 0 left PR7, by the coordinator's ruling
of 2026-11-06; below), D-8054 (adoption's `boxHolds` needs `lease-mark-lock-v1` too, through the one predicate the doors use,
`boxHoldsTrees`), D-8055 (the lane's adoption step is its own module, `server/src/coord/delegationAdoptStep.ts`, called from
`watch.ts`), D-8056 (a notice is owed at the lease's current generation, so a transfer refused back to `adopted` is owed a
notice of its own), D-8057 (a definite audit answer is held for its generation and at most an hour, amended in place in fix
round 1) and D-8058 (fix rounds 1 and 2: a parent's death the lane saw is kept and moves only on a measured read, the parents
are classified in L1, a carrier is read only past rules 4 to 6 and the reads rotate, and the interfaces PR9 and PR10 consume).
That uses the whole block issued to this run. D-7812's sentence is amended in place in fix round 2 (review 1604 F10 (a)).

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
lands before the operator arms adoption. PR7 landed on the 21-version corpus (that change, #2397, merged during fix round 2),
which W5-D12 reads at PR7's tip, and the six corpus suites are green on it, each run alone (corrected by PR7b, review 1609 F10).

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
generation, so a crash, a restart or a standing `mail-disabled` never sends one twice and loses none before the lease's hold ends
(W5-Q3, W5-Q3b, W5-Q4). After `cleanupDueAt` the digest is not sent (review 1587 F5; D-7812, amended in fix round 2).

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
  while `mail-disabled` stood and lifted after day 7 queues none; the `expired:` attention item covers that lease, but only from
  `cleanupDueAt + DELEGATION_ORPHAN_HOLD_MARGIN_MS`. For the hour between the two, neither covers the lease (review 1604 F10 (e)).
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
  other waits have their own counts, except rule 8's: a lease held by a breaker that is not clear counts `waiting` too (review
  1604 F10 (b)). Since fix round 2, `waiting` also counts a lease whose kept death is held by an unmeasured parent read, and one
  whose census record read `unreadable`.
- **What the step still classifies (review 1604 F10 (c)).** A7 moved the parents' facts into L1. The step still decides four
  small things: the marker's word (`present`, `absent` or `unmeasured`), `mailHeld` (any read of `mail-disabled` but `clear`
  holds mail), the recipient's unmeasured cases (no store, a failed series read, a throw) and the `owed` arithmetic. Moving those
  into L1 is carried to the Rider, not this PR.
- **Advisories carried to the Rider (review 1604).** `adoption.wouldAdopt` dips for one pass when a lease's decision is `audit` (that
  pass counts it in no member). If the record-only `notice` throws after an applied adoption, the shared `catch` logs that the
  adoption threw, though it committed (wording only; no double act). A `remind` comes from the checkpoint read before the effects'
  awaits, so a retain landing between them can queue a reminder for the old date. A hanging `ws-lease-audit` (60 s) runs first in
  the step with no budget check, and cuts PR6's carrier step while it hangs.
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
  incarnations, the lane's first-dead instants) and `now`. The step passes reads and acts (D-8058); what it still classifies is
  under "Measured, not departures".
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
| F2, restart | F2 (lane: a new lane over a dead parent adopts nothing, read from the new lane's applier; CONTROL: measured absent, it adopts; review 1604 F3) | REVIEW-X-deadalone |
| F3 | F3 and A8 (L1); F3 (lane: past the hour, asked again before adopting) | PR7-FR1-F3-age |
| F3, not definite | F3 and A8 (L1); F3 (lane: an unmeasured answer asked again) | PR7-FR1-F3-unmeasured |
| A8 | F3 and A8 (L1); A8 (lane: no second audit within the hour) | PR7-FR1-A8-unchanged |
| F4 | F4 (lane) | PR7-FR1-F4 |
| F5 | F5 (L1, with its control a minute before); F5 (lane) | PR7-FR1-F5 |
| F6 | F6 (lane: a sent digest is not owed) | PR7-FR1-F6 |
| F6, A2 | W5-D20; F6 and A2 (lane: an unmeasured recipient) | PR7-FR1-A2 |
| F7 | F7 (L1: no read without rules 4 to 6, at most 8) | PR7-FR1-F7-bound, PR7-FR1-F7-past46 |
| A1 | A1 (lane) | PR7-FR1-A1 |

## Fix round 2 (review 1604)

`origin/main` conflicted with round 1's tip in one comment line of `delegation-projection.ts` (#2409). The round's first
commit merges it and keeps both sides. The rest are the coordinator's rulings, each with its rows and mutants.

- **F1 (an unmeasured read holds).** A lease with a kept death moves only on a measured read of its parent. An unmeasured read
  (the registry unmeasured, a present row whose incarnation is unread, or liveness unmeasured) keeps the entry exactly as it was
  and decides nothing. W5-D5 and W5-D6 run on the settled watch again and expect no decision, as at `d399d063f`.
- **The changed incarnation (no code change).** It is rule 4's own evidence, and the kept instant stands (D-8058).
- **F2 (the reads rotate).** As PR6's re-reads do: never read first, then the oldest read, by the lane pass each was last read.
  The lane keeps the last-read map and prunes it with the lease.
- **F3 (the restart row can red).** It reads the new lane's applier, asserts `adopted` 0, and gains a control. REVIEW-X-deadalone
  (a decider that takes a dead parent's row alone as evidence) reds it.
- **F4 (a cut pass writes nothing).** As built here, that held only for a cut inside the audits: `asked` was cleared and `pass`
  counted before the carrier reads, and a cut in the effects loop came after the lane memory was written (review 1609 F4). PR7b
  (`pr7b.md`) moved both below the last awaited read and says exactly what a cut writes at each point.
- **F5 and F7 (what drops a kept death).** Alive again at the lease's incarnation drops it at every rule that keeps the entry, and
  so does the lane's retraction of the death it counted. The lane remembers a retraction until the parent is alive again, dies
  again or is measured absent from the registry's listing; a row the listing names that the registry could not assemble keeps it
  (corrected by PR7b, review 1609 F2: as built here, an unbuilt row erased it).
- **F6 (two later rules keep the entry).** A census record that reads `unreadable` holds it; a definite `changed: false` keeps it.
- **F8.** A held audit answer is young only at an age from 0 to the hour, so a clock step back holds none past it.
- **F9 and F10.** D-8058 records the interfaces PR9 and PR10 consume; the text corrections are in this note, D-7812 and the
  plan's Review Focus (4); `adoptionCarrierReads` reads no lease at generation 0 again (F10 (h)).

| Item | Row (red under its mutant) | Mutant |
|---|---|---|
| F1 | W5-D5, W5-D6; F2 (L1, the decision kind pinned for three unmeasured parents); F1 (one measured absent pass, then eight unmeasured) | PR7-FR2-F1 |
| F2 | F2 (L1: ten candidates, each read within two passes); F2 (lane: ten settled leases in shadow) | PR7-FR2-F2 |
| F3 | F2 restart (lane) | REVIEW-X-deadalone |
| F4 | F4 (lane: a pass cut inside an awaited audit) | PR7-FR2-F4 |
| F5 | F5 (L1) | PR7-FR2-F5 |
| F6, unreadable | F6 (L1) | PR7-FR2-F6-unread |
| F6, unchanged | F6 (L1), W5-D10 | PR7-FR2-F6-unchanged |
| F7 | A7/F1 (L1, the retraction read); F7 (lane) | PR7-FR2-F7 |
| F8 | F8 (L1) | PR7-FR2-F8 |
| F10 (h) | F10 (h) (L1) | PR7-FR2-F10h |

## Carried items

| Item | What changed | Row (red under its mutant) | Mutant |
|---|---|---|---|
| A, Task 0 | none: Task 0 left PR7 (D-8053) | W5-D12 over the 21-version matrix | none |
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

Each mutant was applied alone to a saved copy, run against the rows named, and restored with its sha checked. All 54 were
killed. The original 24 adoption-side and claimant mutants were measured again on fix round 1's tip, and four of them
(W5-DM9b, W5-DM10, W5-DM11 and W5-DM11c) were restated there on the changed code with the same meaning. On fix round 2's tip,
the 13 PR7-FR1 mutants, W5-DM3, DM4, DM5 and DM7, and the 10 this round adds were measured; PR7-FR1-F2-keep,
-F2-counter, -F7-bound and -F7-past46 were restated on the changed code with the same meaning. The carrier, conflict and door
mutants (1549-F1 to F4, 1564-F2 and 1564-F5) touch code neither round changes and are as first measured. The W5-DM11b line
was narrowed by fix round 1 (review 1587 A3): round 1's table said "each shape", and the narrowed line is the measured one.

| Mutant | File | The mutation | Red rows |
|---|---|---|---|
| W5-DM1 | `delegation-adoption.ts` | drop the adoptable-source filter | W5-D2, the carrier-read row; W5-D12 on every version |
| W5-DM2 | `delegation-adoption.ts` | any non-active activity is terminal | W5-D4 |
| W5-DM3 | `delegation-adoption.ts` | an unmeasured registry counts as an absent parent | W5-D5, the two F1 rows and F2 (L1) |
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
| W5-DM12 | `delegation-adoption.ts` | the decider reads the clock | W5-D17, deterministically. While the wall clock is before the fixture's T0 (2026-11-10 12:00 UTC) it also reds W5-D1, D2, D5, D6, D8, D10, D11, D13, D14, D14b, D15, D16, D16b, the carrier-read row and the F1, F2, F3 and F7 rows (19 rows with W5-D17, measured 2026-11-06; 24 of the 40 rows at PR7's merged tip, measured by PR7b on 2026-11-07, review 1609 F10). After T0 most stop being killers; W5-D16 and D16b (their `due` is T0 + 30 days) stay red until about 2026-12-09 |
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
| PR7-FR1-F2-keep | `delegation-adoption.ts` | drop the keep (a measured dead parent's kept death no longer counts) | F2, F5, F7 (L1); F2 aged out (lane) |
| PR7-FR1-F2-counter | `delegation-adoption.ts` | keep without counter-evidence at rule 4 | F2, F7, the F7 carrier-read row, W5-D3, W5-D4 (L1); F2 dead for 3 passes then alive, F7 (lane) |
| PR7-FR1-F3-age | `delegation-adoption.ts` | drop the hour | F3 and A8 (L1); F3 past the hour, A8 (lane) |
| PR7-FR1-F3-unmeasured | `delegation-adoption.ts` | hold an answer that is not definite | F3 and A8 (L1); F3 unmeasured (lane) |
| PR7-FR1-A8-unchanged | `delegation-adoption.ts` | hold `changed: true` only | F3 and A8 (L1); A8 (lane) |
| PR7-FR1-F4 | `delegationAdoptStep.ts` | record the keys before the effects | F4 (lane) |
| PR7-FR1-F5 | `delegation-adoption.ts` | drop the date test | F5 (L1); F5 (lane) |
| PR7-FR1-F6 | `delegationAdoptStep.ts` | count a held notice without asking for its mail | F6 (lane) |
| PR7-FR1-A2 | `delegation-adoption.ts` | an unmeasured registry answers record-only | W5-D20; F6 and A2 (lane) |
| PR7-FR1-F7-bound | `delegation-adoption.ts` | no bound on the reads | F7, F2 (ten candidates) |
| PR7-FR1-F7-past46 | `delegation-adoption.ts` | read every lease past rules 1 to 3, as before | F7, F10 (h) |
| PR7-FR1-A1 | `delegationAdoptStep.ts` | one memory for both lines | A1 (lane) |
| PR7-FR2-F1 | `delegation-adoption.ts` | count and decide on an unmeasured read (round 1's code) | W5-D5, W5-D6, F2, F1 (one measured pass, then eight unmeasured) (L1) |
| PR7-FR2-F2 | `delegation-adoption.ts` | no rotation: the first 8 every pass | F2 (L1, ten candidates); F2 (lane, ten settled leases) |
| REVIEW-X-deadalone | `delegation-adoption.ts` | a present parent that is not alive is evidence on its own | F2, F5, F7 (L1); F2 restart, F7 (lane) |
| PR7-FR2-F4 | `delegationAdoptStep.ts` | no check after the awaited audits | F4 (lane: a pass cut inside an awaited audit) |
| PR7-FR2-F5 | `delegation-adoption.ts` | `keep()` without the alive-again check | F5 (L1) |
| PR7-FR2-F6-unread | `delegation-adoption.ts` | an unreadable census record drops the entry | F6 (L1) |
| PR7-FR2-F6-unchanged | `delegation-adoption.ts` | `changed: false` drops the entry | F6, W5-D10 (L1) |
| PR7-FR2-F7 | `delegation-adoption.ts` | ignore the retraction | A7/F1 (L1); F7 (lane) |
| PR7-FR2-F8 | `delegation-adoption.ts` | no lower bound on a held answer's age | F8 (L1) |
| PR7-FR2-F10h | `delegation-adoption.ts` | read a lease at generation 0 | F10 (h) (L1) |

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

`watch.ts` grows by 15 lines against the merge base (21 added, 6 removed). Two of the added lines are comments, so it grows by
13 net code lines, against the plan's aim of at most +40. Review 1587 A6 corrected the first figure. Fix round 1 added the
listing's ids and liveness to the call; fix round 2 added the lane's memory of a retracted death (review 1604 F7) and passes the
sessions. `store.ts` is unchanged. The two new coord files are `delegation-adoption.ts` (429 lines) and `delegationAdoptStep.ts`
(216).

## Suites at the tip

Fix round 2's tip merges `origin/main` twice: first for #2409, then for the corpus PR #2397, which merged during the round.
With #2397 the matrix holds 21 versions, and W5-D12 (`delegation-adoption-corpus`) is green over all of them, 23 rows. Every
suite on the coordinator's round-2 list ran alone through `ccrc test`, 77 files in all. They were the adoption suites, the rest
of the "PR7 at its tip" list and #2409's suites (`delegation-projection`, `claim-sweep`, `delegation-lease-acts`,
`hibernate-census`, `lease-routes`, `session-ladders-characterization`, `tick-refused-lanes`, and the two `single-definition`
files). They also included `refusal-status`, `coord-store`, `run-session-census`, `delegation-fixtures`, `delegation-rig`,
`anchors`, `citations`, `topology-clean`, every `stall-*`, `single-definition/*` and `rings/*` file, `typecheck-tests`, and
`deviation-refs` and `dtbd` after a fetch. Then `GROWTH_CHECK=1` growth-check, `cd pwa` `tsc --noEmit` and pwa's
`delegation-words` (#2409's) ran. All are green on their first run. The remaining guard suites were not re-run one by one: the
full-ci run on the exact tip is their arbiter, as the ruling says.

Fix round 1's tip ran 226 files alone: the "PR7 at its tip" list, that round's list and the 199 guard suites
`fast-plan.mjs#guardTests` derives. `typecheck-tests` was red there (two rows typed a watch as `never`, and the corpus row's
parent lacked `alive`), fixed in their own commit. `rings/watcher-store-port`, `delegation-recovery` and `secret-mask` were red
under load and green alone. `retire-executors-pin` is red on the fleet box, also on a clean `main`, and the merge queue judges it.

The first round's runs (at `d399d063f`) were the same list less the fix-round additions. There `spawn-group-pin` was red
first, until the corpus replay's hook spawn went through `spawnSyncGroup`. `typecheck-tests` was red twice there, once for
the agent package's missing modules and once killed by the test slice's memory cap, and green alone on its third run.
