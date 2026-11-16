# PR8 (S4, Retain and resolve): departures and measurements

Run 1550, delegation broker wave 5, Tasks 5.8.1 to 5.8.3, under O5-8 (c): one pull request, no tree doors. Four departures are
defined in the plan's "Deviations found": D-8040 (`boxHolds` needs the mark's lock word, carried from PR6's D-8037), D-8041
(`registry-unmeasurable` answers 502, and in resolve-attach an unmeasured parent answers it too), D-8042 (the unbounded claimant read is
fed from the binding series' own rows, with no new store method) and D-8043 (an unmeasured creation base holds a disowned tree). The rest
of the block issued to this run is unused, and this note does not spell it. Fix round 1 answers review 1554 at `c869406d9` under the
coordinator's rulings; its items are under "Fix round 1" below.

## The floor rule, as built

PR8 adds no transition-table row, loosens no `assertLease` rule or decision, changes no fold, and adds no journal kind, entry field or
checkpoint member. Retain and the operator's keep are `transitionLease` with reason `retain` or `operator-retain`; resolve is
`transitionLease` with reason `attach`, or `releaseLease` with reason `foreign`, each carrying `resolvesThrough`. All of it is grammar
PR5a folds, so the rollback floor stays PR5a.

## Measured, not departures

- **The claimant read (D-8042).** The plan's `CoordStore#delegationRunStampsNaming` was built first, then taken out. It broke two
  censuses. `run-session-census.test.ts` pins the store's session-keyed run readers at four, and a fifth is red. `coord-store.test.ts`
  counts the store's delegation methods. Joined to `WatcherCoordMember`, it broke a third: `rings/watcher-store-port.test.ts` reds a
  member the watcher and its lane files do not reach. The read is `delegationLeaseDoor.ts#runStampsOfSeries`, fed from `bindingRunsOf`'s
  rows. Round 0 read each run again through `run`; fix round 1 carries `closedAt` on the series row instead (one column on
  `CoordStore#seriesRows`' SELECT and on `bindingRunsOf`'s result row, no line added to `store.ts`), so no run is hydrated. The census
  pins `seriesRows`' SQL by its opening text, which is unchanged, and `ports.ts` is unchanged.
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
  the fresh checkpoint. If the lease moves again, it answers `not-ready` ("the lease moved while this act was queued — retry"). Pinned
  by F2 (3) in `lease-routes.test.ts`.
- **A door whose commit throws.** If a PR5b door throws (a fold refusal or a failed application), the lease door answers `not-ready`,
  saying the act is not confirmed durable (F2 (4)). A retry is not a replay: every door passes the lease's CURRENT generation, so if
  the thrown commit was in fact durable, the retry reads the new generation and acts again. A second Retain or keep renews the 7 days
  from the retry's instant and a second attach does the same; a second "not delegated" finds the lease released and answers
  `lease-released`. Each second act is benign: none removes anything, and none moves a lease anywhere the first did not.
- **The conflict gate is read before the act is queued (F5, accepted, no change).** `lease-conflicting` is decided on the checkpoint
  the door read; `transitionLease` re-decides the transition table and the generation, not `conflictingTreeKeys`, and an attempt filed
  in between does not bump the lease's generation. So a conflict recorded in that one queue turn does not stop an in-flight Retain. The
  coordinator accepted it: Retain only keeps and never removes, PR7's adoption reads conflicts at decision time, and the operator's
  resolve stays open.
- **"A live ccd registry row".** The attach's live-parent check is a registry row whose incarnation reads the same twice
  (`$REG/<id>.generation`, the intent route's read). The parent must be the lease's own parent. The doors read no fleet status. A row
  measured absent answers `not-live-parent`; an unreadable or changing generation answers `registry-unmeasurable` (D-8041).
- **The incarnation read checks the id's shape at the read.** `incarnationOf` refuses an id that is not a session id's shape and reads
  nothing (CodeQL's path-injection flows end at the parsers' `isSessionIdShape`, which CodeQL does not track through `{ok, byId}`).
- **The operator's keep's body** is empty: no body, or `{}`.
- **Where W5-R9 lives.** Retain's refusal order is pinned by name in `lease-routes.test.ts`, which runs over the real server, store and
  applier. `coord-pause-route.test.ts` holds the two operator doors in `SESSION_ONLY`, with their reasons.
- **The installer.** `ccd/install-coordinator-skill.sh`'s `REQUIRED_REFS` names `delegated-worktrees.md`. Its directory census
  (`wrapper-roster-fixture.test.ts`, I8) reds when the references directory and the list disagree.
- **The route corpus.** `coordinator-skill.test.ts`'s coordinator-domain census exempts the three lease routes by name. Retain is named
  through its client verb, the intent route's reason. The two operator doors stay unnamed, for `POST /api/coord/pause`'s reason.
- **Raw leases and Retain (ruled: the code stands).** Retain checks no source kind: a lease's parent, or its coordinator, may keep a
  lease the server inferred from a shell call. The reference says so; attach and "not delegated" stay the operator's.
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

## Fix round 1 (review 1554 at `c869406d9`)

| Item | Ruling | What changed | Row (red under its mutant) | Mutant |
|---|---|---|---|---|
| F1 | RULED, D-8043 | `planRecord` holds a null-base record on a tree with any disowned key (`disownedTreeRecords`) | D-8043 (a), (b) in `delegation-policy.test.ts`; D-8043 in `delegation-watch.test.ts`; (c) cites `divergence-sweep.test.ts` | FR1-F1 |
| F2 (1) | TAKE | none (row only) | F2 (1) in `lease-routes.test.ts` | FR1-F2.1 (constant incarnation) |
| F2 (2) | TAKE | none (row only) | F2 (2) (a run id past 2^53 in the parent's series) | FR1-F2.2 |
| F2 (3) | TAKE | none (row only) | F2 (3) (stale twice; once, then the act) | FR1-F2.3 (`ATTEMPTS` 1) |
| F2 (4) | TAKE | none (row only) | F2 (4) (a throwing door, all three doors) | FR1-F2.4 (no catch) |
| F3 | TAKE | W5-R3c: fsync off on its fixture database, no `bindSession` for the 501 others, its own 60 s timeout | measured 0.81 s, 0.85 s and 1.19 s (was 12 to 25 s) | none; green under RM1 now |
| F4 | TAKE | this note's retry wording | none | none |
| F5 | ACCEPTED | named in this note | none | none |
| F6 | TAKE | `keysAre` compares element by element | F6 in `delegation-lease-acts.test.ts`; F6 on the route | FR1-F6 (joined string) |
| F7 | RULED | `delegation-conflicts.ts#treeLeaseOf`, read by the projection and `leaseOfTarget` | W5-R7b in `delegation-lease-acts.test.ts` | FR1-F7 (first by id) |
| F8 | RULED, D-8042 amended | the series row carries `closedAt`; no `run()` per row | W5-R3c and the route's W5-R3, each with a spy on `run()` | FR1-F8 (hydrate each row) |
| D-8041 | RULED, amended | resolve-attach: unmeasured parent answers 502 | W5-R6 live-parent row; D-8041 in `lease-routes.test.ts` | FR1-D8041-door, FR1-D8041-decider |
| CodeQL | RULED | shape check inside `incarnationOf` | the CodeQL row in `lease-routes.test.ts` | FR1-CodeQL |
| Raw Retain | RULED | the reference says what the code does | `coordinator-skill.test.ts` (corpus pins) | none |

One consequence of F7, measured: the projection now names the hidden lease through the same derivation the door reads, which reads only
the checkpoint. A non-raw lease on a conflicting tree whose path a ccd workspace owns was skipped, and so not named, before; it is now
named by the tree's unowned row, as it is by a `tree-<key>` resolve, so the two never disagree.

Every round-0 mutant was re-measured on the round's code. W5-RM15, W5-RM16 and W5-RM19 point at the new text (the policy's `disowned`
term, the tree target's `find`, the policy's import line); each is red on a named row. The full table is the report's
`pr8-fr1-mutants.tsv`.
