# ARCH-42: one store query for "is this session bound, and by whom" (`bindingsOf`)

GitHub #777. Consolidation spec 2026-10-19 (C4 "Bindings, read once"; C5 overlap row "assembled 9 ways"). Builds on
ARCH-60 (`coord/runBinding.ts`: `bindingOf`, `childrenOf`, `boundRunsOf`) and ARCH-62 (`coord/bindingReads.ts`: the store's
binding readers asked in their callers' shapes).

## Goal

Every production unit that asks a session's OPEN binding (is it bound as a worker, does it coordinate anything, who is
its parent, which open run does its card show, whom does it work for) asks it through ONE store query,
`CoordStore.bindingsOf(sessionId)`, and the query answers through the ARCH-60/ARCH-62 values that already decide it.
No new rule and no parallel path: every answer is the reader the caller used before, read in the same order with the
same arguments, so each move is behaviour-identical by construction.

## D-TBD-bound-by-census: the counting rule

A SITE is a named production code unit under `server/src/` (a function, a method, or an arrow bound to a name, as the
parsed-symbol scanner `server/test/scan/symbols.ts` names it) that CALLS one of the five bound-by readers:

| reader | its question |
| --- | --- |
| `openRunsForSession` | the open runs naming the session as worker (or, `role: 'claimant'`, the ones it claims) |
| `openRunsClaimedBy` | the open runs the session claims |
| `childParentRead` | the session's parent: the claimant of its open binding (heldFor, the drift lane) |
| `sessionRunRead` | the card's newest and open bound run, whose claimant the card names |
| `claimantsOfSession` | every coordinator the session currently works for |

A unit counts once however many readers it calls. The readers' own definitions are the readers, not sites. The query is
the module `server/test/census-w4/bindings.ts` (`boundBySites`), held two ways in `bindings.test.ts`: a FIXTURE row (it
counts what it claims and passes over what it must not) and a REAL row (a may-only-shrink ceiling, lowered by the commit
that moves each site, and every reader still defined where it lives, so a rename cannot empty the census).

Not readers, by this rule:

- the series read `bindingRunsOf`: the binding values read it and it answers no question by itself;
- the any-state history reads `runsNamingSession` and `runsTouching`: they ask "was it ever", not "is it" (the expiry
  lane's review conjunct and the hold candidates read them; their question is a run's history, not the session's binding);
- the pass-wide reads `lastRunBySession`, `activeClaims` and `outstandingMailFor`: fleet-wide or mail, not a session's run
  binding (the stop-done lane's batched `lastRunBySession` read stays batched; moving it per session would change its read);
- the run-keyed reads (`run`, `readCoordinatorOfRun`) and the coordinator-keyed `withChildIds` (whom a coordinator binds,
  not who binds a session).

KNOWN WIDTH: a reader reached through a computed name, an alias or a destructured binding is not seen.

## The measured count: 23, not 9

Measured on `origin/main` at the branch point: **23 sites** in 15 files. The spec's 9 is an estimate of a narrower
question, the lifecycle lanes' composite "keep it" verdict (open runs, claims, outstanding mail, reviews). Of the 23,
five units ask both roles at once (`decideArchive`, its port in `buildServer`, `readExpiryStore`, `collectOpenRunHold`,
`hibernateSweep`'s `storeRead`); the rest ask one role (a worker's open runs before an act, a claimant's open runs) or the
parent. The spec counted per lane; this census counts per unit and includes the parent readers the task names (heldFor's
parent read, the drift lane's, the fleet card's), so it is the wider number.

| # | file | unit | readers |
| --- | --- | --- | --- |
| 1 | `server/src/coord/archiveDoor.ts` | `decideArchive` | `openRunsForSession`, `openRunsClaimedBy` |
| 2 | `server/src/coord/close.ts` | `abandonRun` | `openRunsForSession` |
| 3 | `server/src/coord/close.ts` | `closeWorkRun` | `openRunsForSession` |
| 4 | `server/src/coord/close.ts` | `closeReviewRun.siblingsOf` | `openRunsForSession` |
| 5 | `server/src/coord/collectTempRoot.ts` | `collectOpenRunHold` | `openRunsForSession`, `openRunsClaimedBy` |
| 6 | `server/src/coord/dispatch.ts` | `refuseSpentChild` | `openRunsForSession` |
| 7 | `server/src/coord/driftLane.ts` | `pass` | `childParentRead` |
| 8 | `server/src/coord/endDeadCoordinator.ts` | `endDeadCoordinator` | `openRunsClaimedBy` |
| 9 | `server/src/coord/expireArchived.ts` | `readExpiryStore` | `openRunsForSession`, `openRunsClaimedBy` |
| 10 | `server/src/coord/heldFor.ts` | `openBindingCount` | `openRunsForSession` |
| 11 | `server/src/coord/heldFor.ts` | `heldFor` | `childParentRead` |
| 12 | `server/src/coord/reclaim.ts` | `reclaimRun` | `claimantsOfSession` |
| 13 | `server/src/coord/routes.ts` | `registerCoordRoutes` | `claimantsOfSession` |
| 14 | `server/src/coord/siblingRead.ts` | `siblingFacts` | `openRunsForSession` |
| 15 | `server/src/fleet.ts` | `readSessionRun` | `sessionRunRead` |
| 16 | `server/src/hibernateSweep.ts` | `storeRead` | `openRunsForSession`, `openRunsClaimedBy` |
| 17 | `server/src/server.ts` | `buildServer` | `openRunsForSession`, `openRunsClaimedBy` |
| 18 | `server/src/tmpSweepLane.ts` | `coordinatorOf` | `openRunsForSession` |
| 19 | `server/src/watch.ts` | `FleetWatcher.namesPass` | `openRunsForSession` |
| 20 | `server/src/watch.ts` | `FleetWatcher.commitDeadCoordinatorBreaker` | `openRunsClaimedBy` |
| 21 | `server/src/watch.ts` | `FleetWatcher.sweepMerged` | `openRunsForSession` |
| 22 | `server/src/watch.ts` | `FleetWatcher.sweepLanding` | `openRunsForSession` |
| 23 | `server/src/watch.ts` | `FleetWatcher.hold` | `openRunsForSession` |

## The query: `CoordStore.bindingsOf(sessionId)`

`bindingsOf` answers a `SessionBindings` for one session id: five named, LAZY answers, each the reader a site used
before, so a caller reads exactly what it read and nothing more (a worker-only caller never reads the claimant column, and
a read that fails or throws fails or throws as it did):

- `worker({ excludeRunId?, incarnation? })`: `openRunsForSession(id, excludeRunId, incarnation)`;
- `claimant()`: `openRunsClaimedBy(id)`;
- `parent(minter, incarnation)`: `childParentRead(id, minter, incarnation)` (`childParentOf` over the series);
- `card(incarnation)`: `sessionRunRead(id, incarnation)` (`bindingOf`'s `newest` and `open`);
- `claimants(incarnation?)`: `claimantsOfSession(id, incarnation)` (`claimantsOf`).

Its body is `bindingsOver(port, id)` in `coord/bindingReads.ts`, so a consumer-declared port (a test fake, the archive
door's port) gets the same answers from the same five reads. After the last move the census is **1**: `bindingsOver`
itself.

## Commits

1. The census (this note, `census-w4/bindings.ts`, `bindings.test.ts`). No production byte changes. Ceiling 23.
2. The query: `SessionBindings`, `bindingsOver`, `CoordStore.bindingsOf`. Ceiling 24 (the query is a site).
3. to 25. One site per commit, in the table's order, each moved onto `bindingsOf` with the same reads; the ceiling drops
   by one each time and ends at 1, pinned to `bindingsOver`.

The regression bar on every commit: `server/test/run-binding-probe-corpus.test.ts` (53 shapes) green and unedited, plus
each moved site's own suites, `tsc --noEmit` over `server/` and over `test/tsconfig.tests.json`.

## Decisions

- **D-TBD-bound-by-census**: the counting rule above.
- **D-TBD-bindings-of-lazy**: `bindingsOf` is a view of five lazy answers, not one eager read of both roles. An eager read
  would read the claimant column for a worker-only caller (and the reverse), so a read that fails in the column a caller
  never used would change its answer; the lazy view keeps every move behaviour-identical, and the rule stays in
  `runBinding.ts`.
