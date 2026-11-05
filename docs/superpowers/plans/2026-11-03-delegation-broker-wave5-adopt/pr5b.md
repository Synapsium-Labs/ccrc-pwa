# PR5b (S1b, the writers): departures and measurements

Run 1489, delegation broker wave 5, Tasks 5.5.3 and 5.5.4. The block issued to this run holds six numbers, starting at D-8024.
Two are defined in the plan's "Deviations found", under the coordinator's consent: D-8024 and D-8025. The other four are unused,
and this note does not spell them, since a mention would raise the ledger's floor. This note keeps the narrative.

**D-8024, the promote run check.** Carried item 3 asked whether a promote request's `runId` can differ from the carrier row's
`transferRun`. It can: `decideLeaseTransition` reads only the state, and PR5a's `promote` fold writes `promotedRun` from the entry
without comparing it to the transfer's run (D-7971 left that pin to PR9). The coordinator ruled that the live door refuses the
mismatch, a missing carrier row and a null `transferRun`, all with `wrong-disposition` and before any append, while the decision and
every fold stay as on main. The check is one pure function, `promoteRunMismatch`, beside the decision. No fold calls it.

**D-8025, the last head and the uncensused count.** The plan's `lastHeadSha` is "the head the lane's previous census saw for that
record". At the release, the previous census is the first of the two absent listings, so it never saw the record, and the value
would always be null. D-7796 says the release records "the last head the census saw", so the planner keeps that head per lease in
the lane's memory and puts it on each release request. The plan's step 3 has the lane count the uncensused leases. The planner
answers that count instead, so the lane (L4) only stores it.

## Measured, not departures

- **The doors answer `not-ready`.** They do not throw `requireReady`'s error. The plan's outcome union already holds the word
  (`DELEGATION_LEASE_ACT_REFUSALS`), so a caller reads one answer. `createLease` keeps its throw.
- **The transition request carries `terminalEvidenceAt`.** The plan's `DelegationLeaseTransitionRequest` predates D-7968, which
  added the field to the entry and has PR7's adopt caller write the clamped instant. The door copies it from the request, and the
  fold validates it, as on main.
- **The door knows its own replay.** It answers `unchanged` when the record that wrote the lease's current generation did the same
  act, and the generation is `expectGeneration + 1`. The builder's per-record fact gains `act` (a transition's reason, `released`
  or `seen`) for this. It is in memory only: no checkpoint member, no journal field. A release one generation past the request is
  its replay, since nothing follows a release.
- **"Delta mode" is read at the port.** W5-J9 asks for "the outcome's `projection.mode`". The outcome has no such member, and
  adding one would widen `DelegationApplyOutcome` for a test. The row reads the mode the store's `projectDelegationCheckpointChanges`
  answered, through the projection port, as `delegation-delta-applier.test.ts` does.
- **`store.ts` and `ports.ts` are unchanged.** PR5a already writes a changed lease row and a closing lease-owned lineage row as
  delta UPDATEs. The lane calls only `DelegationDurability` doors, which are not `CoordStore` methods, so `WatcherCoordMember`
  gains nothing. A `promote` opens a run-owned lineage row, which still takes the full projection, as PR5a left it.
- **The phase runs once per census.** `leaseActs` sits inside the block that reconciles a new census. A listing is a census, so a
  pass that reuses an already reconciled census counts nothing.
- **watch.ts.** The coordinator relayed leave for four spots: the `leaseActs` phase in `DelegationLane#run`, its slow key, the
  `absentListings` field and the health's `uncensusedLeases`. The import of `planNativeRemoved` is the one line beyond those spots
  that they need. The slow line's `other` sum is unchanged, so `leaseActs` time is still counted in `other`, and `LANE_BLOCK_KEYS`
  is unchanged, so `leaseActs` time alone never writes a slow line.
- **The pass-timing suite.** Its pinned key list (`SLOW_KEYS`) gains `leaseActs`, in the list's order, and RE3's "phases that ran"
  gains it. RE2 pins the bounded line's exact fill, so its figures move with one more key, re-measured from the formatter itself:
  118 input keys fill 2,035 bytes at seven digits (114 kept, 4 dropped, `cpActivities` now among them) and 2,040 bytes at the largest
  values (77 kept, 41 dropped, `markIds` now among them). The same probe on `main`'s formatter gives RE2's old figures (117 keys:
  2,038 bytes, 114 kept, 3 dropped, and 2,038 bytes, 77 kept, 40 dropped).
- **A wave-3 row re-pinned.** `delegation-watch.test.ts`'s "measured absence is recorded once per tree" ended with "absence
  closes nothing and releases nothing", over four absent listings. The absence record still closes and releases nothing. The lease
  is now released by native-removed at the second absent listing, so the row pins that release (its instant, generation 1 and
  `releaseReason: native-removed`), and that the workspace state stays `unmeasured`.
