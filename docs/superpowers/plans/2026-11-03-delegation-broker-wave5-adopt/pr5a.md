# PR5a (S1a, reader only): departures found

Run 1443, delegation broker wave 5, Tasks 5.5.1 and 5.5.2, and fix round 1 (review 1451). The block issued to this run is D-7968 to
D-7973. All six are defined in the plan's "Deviations found" (the coordinator's ruling in mail 14827: the floor case reads definitions
from top-level plans only). This note keeps the narrative.

**D-7968, the terminal-evidence field.** The transition table says `adopt` writes `terminalEvidenceAt`, but the plan's `lease-transition`
entry had no field carrying that instant. PR5a fixes the grammar for every later writer, so a field missed now would cost a reader-first
release later. The coordinator ruled the field in (mail 14816): required on `adopt`, null elsewhere, bounded by the lease's first
observation and the adoption. Writing the adoption instant `at` into the column instead would record the wrong fact, because adoption
waits after the evidence by design (D-7794). Review 1451 (F4) found that an agent which ended before its tree was linked has an end
instant before the lease's first observation. The coordinator ruled that PR7's adopt door writes `max(terminalAt, firstObservedAt)`
there, while the settle still counts from the unclamped instant and the activity row keeps the true end.

**D-7969, the snapshot tool.** The coordination snapshot runs from the installed tree and imports nothing, so it validates the journal
and the checkpoint header with its own copies. Before this PR it refused every kind but the two wave-3 ones. The first round of this PR
taught it the three lease kinds but not the checkpoint's new optional member `leaseCarriers`, so the first checkpoint PR5b writes with a
carrier row would still have refused every capture, and every update and backup with it (review 1451 F1). It now reads that member by
shape too. It names its kinds in one exported list, and a differential row holds that list equal to the server's in both directions
(F11). The words inside the kinds and the carrier rows (`reason`, `to`, `releaseReason`, `lineageClose`) stay shape-only by design: they
are vocabularies, which that file never holds, as it already does for `sourceKind`. Whether a word applies is the server's recovery,
which runs again when the server starts.

**D-7970, the run lineage ID.** `promote` opens a run-owned lineage row, and the plan names no ID for it. The fold derives one, so the
entry need not carry it.

**D-7971, the guard and the proof.** The added `assertLease` rules are each true of every row a wave-5 writer produces, so they refuse
only a wrong row. The proof's released-lease exception is forward compatibility: once PR5b releases a lease, nothing holds that lease's
records, so a compaction may cut them, and a PR5a server must still recover that journal to `ready`. Review 1451 F7 is recorded, not
tightened: the replay fold checks what the table and the decisions need and ignores fields a reason does not use (on `promote`, it does
not require `lineageClose` to be `transfer` or `lineageOpenRun` to equal `runId`). The floor must not refuse what a later writer legally
sends, so those pins belong to PR9's own rows.

**D-7972, a run-owned lineage row whose run is absent.** The projection's foreign key proves a run-owned row's run, but only inside the
projection's transaction, after the checkpoint is durable. A lost or older-restored coord.db under a replayed `promote` would have left
every full projection failing (review 1451 F2). Refusing at build or recovery would leave the floor `reconstructing` on a PR9 journal,
so the fix is in the projection. The store leaves the row out of that pass, warns once per run id, and asks again on the next pass.
The delta arm pre-checks rather than letting the foreign key fail: an application whose prior or next checkpoint holds such a row
goes to the full projection, which leaves it out, or adds it back once the run row exists. Rows: W5-J7b's D-7972 row on the durable
applier (`delegation-recovery.test.ts`), and the store's delta row (`delegation-delta-projection.test.ts`). R16's generated probe now
treats a lineage `runId` with no run as a value the table does not hold, as the foreign key did before.

**D-7973, the adopt fold's parent lineage.** The coordinator ruled (review 1451 F13) that the floor rule covers folds as well as grammar.
A PR5a server replaying a PR7 journal without PR7's fold effect would build different session rows, and a compaction would write them
into the checkpoint PR7 then reads as authority. So the `adopt` fold now adds `retained-lineage` to the parent session row's basis and
makes the row effective, through the same basis rule the intent door uses. A replayed `adopt` whose parent has no session row refuses
`fold-refused`. That state cannot occur in a projectable checkpoint, because projectability already requires the lease's parent row.

The sweep the ruling asked for read the "Files", "Interfaces" and task rows of PR5b, PR6, PR7, PR8 and PR9 for any effect on a kind PR5a
folds (`lease-transition`, `lease-released`, `lease-carrier-seen`):

| PR | What it says about those kinds | Produced in PR5a by |
|---|---|---|
| PR5b | The doors `transitionLease`, `releaseLease` and `noteCarrierSeen` journal the kinds through the same decisions and folds; no fold change. | The folds in `delegation-lease-state.ts`, through `DelegationCheckpointBuilder#foldLeaseKind` |
| PR6 | The carrier lane calls the PR5b doors and reads carriers back; `delegation-checkpoint.ts` is not in its file list. | Nothing new |
| PR7 | The `adopt` fold adds `retained-lineage` to the parent row (the one effect found). | D-7973, `foldLeaseKind`'s adopt arm |
| PR8 | Under O5-8 (c): "nothing beyond PR5b's doors". Resolve is `attach` and a `foreign` release, each with `resolvesThrough`. | The `resolvesThrough` fold on both kinds (W5-J7b, and the F5 rows) |
| PR9 | `promote` closes the lease lineage with `transfer` and opens a run-owned row; `delegation-checkpoint.ts` is not in its file list. | `foldLeaseTransition`'s promote arm (W5-J7b), D-7970, D-7972 |

No effect needs new grammar or state that PR5a lacks. Two branches exist only under O5-8 (a) or (b), PR8a's tree kinds and `attached`
source. Each comes with its own reader-first PR and is not a fold of a PR5a kind.

**Review 1451's minors.**
- **F9 (carried by the coordinator).** PR5b's `noteCarrierSeen` must answer through `foldLeaseCarrierSeen`, a released lease included, so
  live and replay give the same answer.
- **F10 (ruled from the table).** No row of the transition table starts a transfer from `promoted`, so `assertLease` now refuses a
  promoted lease whose carrier row says transferring. The row is in `delegation-model.test.ts`.
- **F8.** The two lower bounds (`terminalEvidenceAt` and `releasedAt` not before `firstObservedAt`) moved from the projectability check
  into `assertLease`. There is one copy, and every caller still meets them. The projectability check's one caller,
  `validateDelegationCheckpoint`, runs `assertLeases` first, as do both store entry points. A row in `coord-store.test.ts` is refused
  before SQLite.

**Mutation note (review 1451 F12).** The plan's mutation table maps W5-JM9 (the adopt fold writes `cleanupState: 'pending'`) to W5-J6. It
reds W5-J7 and W5-J7b instead: W5-J6 tests the guard on hand-built rows, while this mutant edits the fold. The guard then refuses the
folded row in recovery, so recovery stays `reconstructing`, and that is what W5-J7 and W5-J7b assert. The plan's table is left as it is.

Measured, not a departure: the brief places the `delegation_leases` and `delegation_lineage` delta arms in PR5a. `diffDelegationProjection`
now writes a changed lease row as an UPDATE, and a lease-owned lineage row that only CLOSES as an UPDATE. A new lease, a row that leaves,
and any other change to a lease-owned lineage row still take the full projection, and the lease arm has no INSERT. The suites that
pinned the old guard's refusal codes (`coord-store.test.ts`, `delegation-delta-projection.test.ts`, `delegation-delta-applier.test.ts`)
and the wave-3 integration row's lease-table census are re-pinned to the new codes and the one new UPDATE.
