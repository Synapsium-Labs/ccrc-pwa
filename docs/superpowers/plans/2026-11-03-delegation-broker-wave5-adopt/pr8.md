# PR8 (S4, Retain and resolve): departures and measurements

Run 1550, delegation broker wave 5, Tasks 5.8.1 to 5.8.3, under O5-8 (c): one pull request, no tree doors. Three departures are
defined in the plan's "Deviations found": D-8040 (`boxHolds` needs the mark's lock word, carried from PR6's D-8037), D-8041
(`registry-unmeasurable` answers 502) and D-8042 (the unbounded claimant read is composed from the binding series, with no new store
method). The rest of the block issued to this run is unused, and this note does not spell it.

## The floor rule, as built

PR8 adds no transition-table row, loosens no `assertLease` rule or decision, changes no fold, and adds no journal kind, entry field or
checkpoint member. Retain and the operator's keep are `transitionLease` with reason `retain` or `operator-retain`; resolve is
`transitionLease` with reason `attach`, or `releaseLease` with reason `foreign`, each carrying `resolvesThrough`. All of it is grammar
PR5a folds, so the rollback floor stays PR5a.

## Measured, not departures

- **The claimant read (D-8042).** The plan's `CoordStore#delegationRunStampsNaming` was built first, then taken out. It broke two
  censuses. `run-session-census.test.ts` pins the store's session-keyed run readers at four, and a fifth is red. `coord-store.test.ts`
  counts the store's delegation methods. Joined to `WatcherCoordMember`, it broke a third: `rings/watcher-store-port.test.ts` reds a
  member the watcher and its lane files do not reach. The read is `delegationLeaseDoor.ts#runStampsOfSeries`, composed from
  `bindingRunsOf` and `run`, so `store.ts` and `ports.ts` are unchanged.
- **The policy's imports.** `delegation-policy.ts` imports `disownedTreeKey` and `disownedTreeKeys` from `delegation-conflicts.ts`, as
  the plan's "built from `disownedTreeKeys`" asks. Two pins held the policy to the model and correlation only
  (`delegation-policy.test.ts`, `delegation-wave3.integration.test.ts`); each now names the conflict module as well. The conflict module
  imports the policy's classifier, so the two import each other; each reads the other only inside function bodies.
- **The deciders' imports.** `delegation-lease-acts.ts` also imports `runBinding.ts` (`claimantAt`, which the plan's own
  `leaseCoordinatorOf` calls) and `delegation-correlation.ts` (`delegationTreeKey`, the one key the conflict sets use). Both are pure.
- **The interface's small widenings.** `decideResolve` takes `carrierRequired`, since the plan rules that an attach is carrier-gated
  like Retain and its interface listed no such input. The operator's keep is its own function, `decideOperatorRetain`: Retain's checks
  with no claimant. The three request parsers (`parseRetainRequest`, `parseOperatorRetainRequest`, `parseResolveRequest`) are L1
  too, so each handler stays thin.
- **A lease that moves under a door.** If the lease moves between a door's read and its act (the lane's carrier mint, which moves
  generation 0 to 1), PR5b's door answers `stale-generation`, a word the doors' vocabulary does not hold. The door decides once more on
  the fresh checkpoint. If the lease moves again, it answers `not-ready` ("the lease moved while this act was queued — retry").
- **A door whose commit throws.** If a PR5b door throws (a fold refusal or a failed application), the lease door answers `not-ready`,
  saying the act is not confirmed durable. Retain, the keep and resolve each replay as `unchanged`, so the retry is safe.
- **"A live ccd registry row".** The attach's live-parent check is a registry row whose incarnation reads the same twice
  (`$REG/<id>.generation`, the intent route's read). The parent must be the lease's own parent. The doors read no fleet status.
- **The operator's keep's body** is empty: no body, or `{}`.
- **Where W5-R9 lives.** Retain's refusal order is pinned by name in `lease-routes.test.ts`, which runs over the real server, store and
  applier. `coord-pause-route.test.ts` holds the two operator doors in `SESSION_ONLY`, with their reasons.
- **The installer.** `ccd/install-coordinator-skill.sh`'s `REQUIRED_REFS` names `delegated-worktrees.md`. Its directory census
  (`wrapper-roster-fixture.test.ts`, I8) reds when the references directory and the list disagree.
- **The route corpus.** `coordinator-skill.test.ts`'s coordinator-domain census exempts the three lease routes by name. Retain is named
  through its client verb, the intent route's reason. The two operator doors stay unnamed, for `POST /api/coord/pause`'s reason.
- **The reference names no `promotesLease`.** W5-SC1's allow-list for that word is empty until PR9. The reference says promotion is a
  `runs open` that names the lease, a later change.
- **The coordinator skill has twenty clauses**, not the plan's nineteen. They are byte-unchanged.
- **`retire-executors-pin` is red on `main` on this box.** Run alone, it failed three or four cases (the child-spent mail rows, and
  temp-orphan cases taking 20 s) at this branch's tip, and four on a clean tree of `origin/main` (`ae42a89a0`). PR8 touches none of
  that code. It is left to CI.

## Counts, re-measured on the base and moved by exactly the routes added

| Count | Base (0b8755c1e) | Tip |
|---|---|---|
| Box-token machine lanes / in all (`gate.ts`, README, `box-token-census` WORDS) | fifty-seven / sixty | fifty-eight / sixty-one |
| Box-token lanes in EXEMPT among coord routes (`auth-gate` title) | thirty-six | thirty-seven |
| `ROUTES.length` / HTTP half / gated / exempt-HTTP (`auth-gate`) | 183 / 180 / 112 / 68 | 186 / 183 / 114 / 69 |
| `scanRoutes('coord/routes.ts')` | 59 | 62 |
| `SESSION_ONLY` (`coord-pause-route`) | 11 | 13 |
| CLAUDE.md's "The other N are in that file's `SESSION_ONLY` set" | ten (stale) | thirteen |
| `ccrc-api` rows | fifty-seven | fifty-eight |
