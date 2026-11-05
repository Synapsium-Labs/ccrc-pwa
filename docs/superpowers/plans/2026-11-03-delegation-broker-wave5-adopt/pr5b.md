# PR5b (S1b, the writers): departures and measurements

Run 1489, delegation broker wave 5, Tasks 5.5.3 and 5.5.4. The block issued to this run holds six numbers, starting at D-8024.
Three are defined in the plan's "Deviations found", under the coordinator's consent: D-8024, D-8025 and D-8026. The other three
are unused, and this note does not spell them, since a mention would raise the ledger's floor. This note keeps the narrative.

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

Review 1498 F1 widened it: the lane once overwrote its memory with the plan before any release landed, and the plan left a lease it
asked to release out of that memory, so a release that did not land restarted the count and later journalled a null head. A release
candidate now stays in the memory until its door answers `applied` or `unchanged`, one release's throw is warned like a refusal and
never abandons the plan's next release, and a pass whose applier is not ready plans nothing, so the memory stays as it was. F6 recorded
that the head is the census's `headSha`, which `gitref.ts#headOf` sets for a detached HEAD only, so a branch tree releases with a
null head; resolving the branch would change the census, which is not this PR's.

**D-8026, the replay names the act.** Review 1498 F2 found that the doors' replay shortcut compared only the generation and the
act's reason, so a promote naming run 12 was told that run 11's promote already stood, and a release of any reason that any release
did. The coordinator ruled that the shortcut also checks the standing act's identity on the carrier row: a promote's `promotedRun`
and a release's `releaseReason`. Any other request falls through to the decision. For the promote that answers `stale-generation`.
For the release it answers `lease-released`, not the ruling's `stale-generation`: `decideLeaseRelease` checks a released lease before
the generation, and the door keeps the decision's own word. The decisions and the folds are unchanged, so replay is too.

## Measured, not departures

- **The history is not green at every commit (review 1498 F8).** `6c78d31aa` adds the release and the `leaseActs` key but leaves two
  older pins asserting the old values: RE2 in `delegation-pass-timing.test.ts` until `b4337db99`, and the wave-3 "measured absence"
  row in `delegation-watch.test.ts` until `9c8e95e07`. Each re-pin is its own commit, and the history is not rewritten, so a bisect
  through that range lands on red commits. So does fix round 1's `04bbdfd13`, whose throw warning spelled the stall watch's `failed:`
  prefix (`single-definition/update-stall`) until `b4681310d`.
- **The planner's import (the rings note).** `delegation-lease-state.ts` now imports `delegationTreeKey` from
  `./delegation-correlation.js`, a pure module, so the file stays L1. Task 5.5.1's import line names only `shared/api.js` and
  `./delegation-model.js`. It predates the planner, which the plan keys by `delegationTreeKey`.
- **A request the fold refuses rejects (review 1498 F7).** An `adopt` with no `terminalEvidenceAt`, a keep with no `expiresAt` or a
  `transfer` with no run passes the decision and is refused by the fold inside `commitLocked`. The door's promise rejects with
  `fold-refused`, as `createLease`'s does, and nothing is appended. It is never a `refused` answer, and no refusal word is added.
- **`uncensusedLeases` has one reader (review 1498 F5).** `delegationUncensusedLeasesOf`, beside the type in `shared/api.ts`, reads an
  absent member as 0. Nothing reads the health block off the wire yet, so `delegation-health.test.ts` pins it on an older-shape block
  passed through JSON.

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
