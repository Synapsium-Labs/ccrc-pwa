# Overlord W1 other lanes, PR A: build notes

What the ledger should learn from the pull request that builds
`docs/superpowers/plans/2026-11-14-overlord-w1/w1-other-lanes.md` Tasks 1 to 4. The coordinator folds these into the
programme ledger; numbers are the coordinator's to mint, so every departure is named by its slug.

## The plan's own departures, as built

Built as the plan states them, with no change: `other-lane-refusals-unrecorded`, `peer-mail-is-every-send`,
`claim-lane-is-take-and-release`, `refused-set-is-roleofs-and-owed-stops`, `unmeasured-designation-asks-the-profile`,
`overlord-run-refusal-is-an-error-word`, `landing-linear-and-plan-lanes`, `reclaim-refuses-the-overlord-as-heir`,
`run-doors-carry-no-identity`, `route-slicer-shared` and `lanes-without-the-port`.

`one-designation-narrowing` was not needed: designation A shipped `server/src/roleOf.ts#designationFactFrom`, and the
decider calls it. No inline copy was added by this pull request.

`write-doors-classified` was built with the changes below.

## Departures found while building

- **`kebab-admission-already-on-main`.** The coord kebab census in `server/test/mail-routes.test.ts` already admits
  `isOverlordRefusal` (designation A added it), so Task 2's first commit was dropped. The file still changes: the census
  admits `otherLanes.ts`' own kebab words (its `via` column and its verdict's kinds) through a new exported guard,
  `isOtherLaneKebab`, in the census's own idiom.
- **`verdict-generic-on-lane`.** `OtherLaneVerdict`, `otherLaneVerdict` and `decideOtherLane` are generic in the lane,
  so the run-open gate and the reclaim heir rung type their refusal as `overlord-not-a-coordinator | unmeasured`
  without a cast. The plan's signatures, with a type parameter.
- **`write-doors-beyond-table-2`.** The census reads every route file under `server/src`, and found write doors the
  plan's Table 2 does not name. Each is placed by what was measured on `main`:
  - `POST /api/coord/programmes/:slug/remaining` (W2 remaining work A, after the plan): `programme-ownership`, through
    attribution then `claimsProgramme`.
  - `POST /api/mail/:id/ack` and `POST /api/linear/proxy/search`: a new class, `stays-open` (questions 5 and 7 keep
    them open by design).
  - `POST /api/notify`, `POST /api/testbox/tools-sync`, `POST /api/token/claim` and the reader lab's probe POST:
    `launch-profile`. None carries a caller identity.
  - The operator's sign-in doors (`POST /api/auth/login` and the passkey assertion pair): a new class,
    `operator-sign-in`.
- **`operator-gated-derived-from-the-gate`.** `operator-gated` is read from the auth gate's own `EXEMPT` table
  (`server/src/auth/gate.ts`): a write door the gate does not exempt is session-gated when sign-in is armed, and the
  sign-in is the operator's. That replaces a hand list of every session-gated door, which would have been about a
  hundred routes in `server.ts` alone. The red check the plan asks for still holds in both forms: a new box-token door
  the gate exempts is unplaced until it has a class, and a new session-gated door whose handler reads a session's
  identity is unplaced too.
- **`child-only-read-from-the-gate`** (the coordinator's ruling on the refusals below). The child-only door is read
  from the gate's approvals-lane entries in `EXEMPT` (the one write entry whose reason says a dispatched child's hook
  asks), cross-checked against its handler raising an approval. The census never spells that route.
- **`lane-sources-moved-with-the-slicer`.** The move takes the census's lane-source reads (with their notes), `lanesIn`,
  `GATE_PATTERNS` and the `UNGATED` and `SESSION_ONLY` harvests into `server/test/routeRegistrations.ts`, as the plan
  says, so `box-token-census.test.ts` shrinks by about 160 lines rather than the plan's 68. No assertion changed, and
  the move is a commit of its own. One docstring that moved cited `auth-gate.test.ts` by line; the citations ratchet
  counts a moved line as added, so it now cites that file by name (a commit of its own after the move).
- **`heir-sentence-one-home`.** The console's one sentence for the heir refusal is `OVERLORD_HEIR_TEXT` in
  `pwa/src/fleet/resumeHeirs.ts`, which both sheets already import from, so it is written once.
- **`reads-double-fixture`.** `server/test/otherLanesFixture.ts` holds the reads doubles. Beyond the plan's
  `plan-routes.test.ts`, `public-text.test.ts` (it registers the plan routes too) and `linearProxyRig.ts` (the Linear
  proxy suites' rig) take the not-designated double, because the reads are a required field of both route options.
- **`reclaim-reads-as-a-port`.** `reclaim.ts` is L1 by its imports, so it cannot build the reads itself (the rings
  guard reds an import of `otherLaneReads.ts`, an L3 adapter). Its deps type gains them instead:
  `ReclaimRunDeps = ReclaimDeps & { otherLaneReads }`, taken by `reclaimRun` and `moveClaims`, and the two composers
  (the reclaim route in `routes.ts`, the archive hand-over's claims port in `server.ts`) pass the one reads object
  they already build.
- **`plan-doors-grow-on-the-hierarchy-wave`.** The Linear hierarchy wave 4 pull request (#2982) adds two plan write
  doors to `server/src/coord/planRoutes.ts` (`POST /api/programmes/:slug/plan/take` and
  `POST /api/teams/:team/plan/triage`). Census assertion 5 holds the plan rows to exactly the file's write doors, so
  whichever of the two lands second adds their rows to `OTHER_LANES` (and, for the triage door, a decision on whether
  a team-scoped door is a plan lane at all).
- **`plan-phase-refs-is-a-plan-lane`.** The programme work map's WM0 (#2974) landed on `main` while this pull request
  was being built, with a seventh plan write door, `POST /api/programmes/:slug/plan/phases/refs`. The merge of `main`
  made the census red (the door had no class) and `planRoutes.ts` fail to compile (its `door` now takes a lane), as
  designed. This pull request adds the row `planPhaseRefs` (`overlord-uses-its-doors`, via `plan-door`) and passes it
  at that registration. The routes suite refuses it with the other six and admits a plain session on a phased plan. The
  Task 1 pin is unedited and still pins the six doors it was written against.

## Process note

- **`approval-surface-refusals-reported`.** The session hook's approval-surface arm refused two calls: a read-only grep
  whose pattern list spelled the approvals request route (to find where Table 2's doors are registered), and the first
  mail reporting that refusal, which quoted it verbatim. Neither was retried in any form; the report was resent in
  paraphrase. The coordinator ruled that the census reads that door from the gate's table and never spells it.

## Spec fixes for the spec-fixes run

From the plan's "Index changes", unchanged, plus two found here:

- §3.5's "the dispatch doors refuse it as they refuse any non-claimant" is false on `main`: the five run doors
  (`dispatch`, `close`, `advance`, `route`, `items`) carry no caller identity. Whether to add attribution to them, a wire
  and coordinator-corpus change, is a ruling for a later piece.
- A5's "every other write lane" against §3.5's five lanes, with Table 2's classes; the ledger mint takes no identity.
- The reclaim door and the archive hand-over as paths to C48's "it can never become a coordinator", now refused.
- Table 11.6's "Door or lane" cells for both words gain the landing writes, the Linear writes, the plan doors and reclaim.
- Table 11.1e's "the deny set is the guard": `OVERLORD_DENY_RULES` is not on `main` and no W1 piece creates it, so in W1
  the guard is the launch profile's deny rules (sandbox A).
- "Peer mail" means every send by the Overlord's body, run mail included.
- The narrowed unmeasured rule on these lanes (question 4).
- §3.5's server bullet can add that a run naming the Overlord's body as its worker is refused already, by `not-a-child`.
- New here: the write doors outside the spec's lists (`write-doors-beyond-table-2`), so the census's classes are the
  spec's.
- New here: the remaining-work door joins `programme-ownership`.
