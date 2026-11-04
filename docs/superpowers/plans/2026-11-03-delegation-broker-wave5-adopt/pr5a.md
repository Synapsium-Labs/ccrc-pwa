# PR5a (S1a, reader only): departures found

Run 1443, delegation broker wave 5, Tasks 5.5.1 and 5.5.2. A block of six numbers was issued to this run. D-7968, D-7969, D-7970 and
D-7971 are defined in the plan's "Deviations found" (the coordinator's ruling in mail 14827: the floor case reads definitions from
top-level plans only); the block's last two numbers are unused and are not written anywhere. This note keeps the narrative.

**D-7968, the terminal-evidence field.** The transition table says `adopt` writes `terminalEvidenceAt`, but the plan's `lease-transition`
entry had no field carrying that instant. PR5a fixes the grammar for every later writer, so a field missed now would cost a reader-first
release later. The coordinator ruled the field in (mail 14816): required on `adopt`, null elsewhere, bounded by the lease's first
observation and the adoption. Writing the adoption instant `at` into the column instead would record the wrong fact, because adoption
waits after the evidence by design (D-7794).

**D-7969, the snapshot tool.** The coordination snapshot runs from the installed tree and imports nothing, so it validates the journal
with its own copy of the grammar. Before this PR it refused every kind but the two wave-3 ones, so the first lease transition PR5b
journals would have refused every snapshot capture, and every update and backup that takes one. It now reads the three kinds by shape
alone. Their words are vocabularies, which that file never holds, as it already does for `sourceKind`.

**D-7970, the run lineage ID.** `promote` opens a run-owned lineage row, and the plan names no ID for it. The fold derives one, so the
entry need not carry it.

**D-7971, the guard and the proof.** The added `assertLease` rules are each true of every row a wave-5 writer produces, so they refuse
only a wrong row. The proof's released-lease exception is forward compatibility: once PR5b releases a lease, nothing holds that lease's
records, so a compaction may cut them, and a PR5a server must still recover that journal to `ready`.

Measured, not a departure: the brief places the `delegation_leases` and `delegation_lineage` delta arms in PR5a. `diffDelegationProjection`
now writes a changed lease row as an UPDATE, and a lease-owned lineage row that only CLOSES as an UPDATE. A new lease, a row that leaves,
and any other change to a lease-owned lineage row still take the full projection, and the lease arm has no INSERT. The suites that
pinned the old guard's refusal codes (`coord-store.test.ts`, `delegation-delta-projection.test.ts`, `delegation-delta-applier.test.ts`)
and the wave-3 integration row's lease-table census are re-pinned to the new codes and the one new UPDATE.
