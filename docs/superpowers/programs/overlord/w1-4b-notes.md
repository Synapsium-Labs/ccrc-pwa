# W1-4b, the in-place bind (D-6096): task notes

Fleet-capacity W1, Task W1-4b (`docs/superpowers/plans/2026-10-20-fleet-capacity-w1.md`; spec §3.5 "The binding").
What the ledger should learn from this PR. The coordinator folds it into the programme ledger.

## Step 0

Self-claimed dispatched runs on the live store, read through the runs read API (`runs list --closed 1`): **0**, over
the 546 runs that read returned. The task's stop condition does not apply, and no departure was entered for it.

## What was built

The six commits of the unreviewed draft, ported onto today's `main` and re-derived. They are the characterization, the
`inPlace` column and `CoordStore.bindInPlace`, `bindRunInPlace` with the `self-dispatch` refusal, the close and abandon
that compose no `ws-*` verb on the claimant, the pins, and the in-place done-claim's PR read. Three further commits
follow, each under a slug below.

## Departures, by slug

- `later-draft-fixes-carried`: the in-place parts of three later fixes in the same draft are carried. The bind holds
  and checks landing intents (D-8085, D-8086). `landing_intents` keeps ONE writer, `CoordStore.holdLandingIntent`, which
  the dispatch and the bind both call. The stall watch drops an in-place run from its worker subjects, so its coordinator
  is never stall-mailed as a worker. Two census rows are added. Their cap-detail wording belongs to W1-5 (D-6097) and is
  not carried.
- `reconstructed-in-place-reads-ordinary` (built, its own behaviour commit): `inPlace` is not recoverable after a
  coord.db rebuild. `actsOnClaimant` (`closeDecide.ts`) therefore treats a run bound to its own claimant like an in-place
  run for every fleet act: no ws-release, ws-hold, ws-archive or child gate on the coordinator. The four self-claimed
  rows of the characterization flip.
- `skill-row-in-dispatch-reference`: `main` split `wave-lifecycle.md`, so the `self-dispatch` refusal row is in
  `ccd/coordinator-skill/references/wave-lifecycle-2-dispatch.md`. That row satisfies `coordinator-skill.test.ts`'s
  `RUN_REFUSE_CODES` loop.
- `skill-line-to-w1-5`: the plan's one SKILL.md line is NOT in this PR, by the coordinator's ruling. SKILL.md sits at its
  size cap, and the skill-size ratchet raises a cap only for a new pinned clause: a line with an 80-byte raise was built,
  failed the ratchet, and was dropped. W1-5 adds the line when it rewrites that entry.
- `migration-slot`: the column takes the next free `MIGRATIONS` slot on this branch's base. It is renumbered by merge if
  another migration lands first.
- `routes-forced-line`: the dispatch and advance routes' hunks are added lines, except one forced line. The advance
  route's `verifyDone` argument becomes `doneRunOf(run)`, so an in-place run's claim is measured on its recorded branch.

## Fix round 1 (review 2993), as ruled

- F1: an in-place done-claim binds the sibling branch's PR on the sibling tip measured in the same read (`siblingPrLine`,
  `fingerprint.ts`): a row binds when it is the repo's own, on the line's base, its head the recorded branch and its head
  commit that tip. ccd's `ours` is never read for it, because ccd computes it by reachability from a registered session's
  tip and the sibling branch is no session's workspace. An open, draft or merged claim passes when true, a closed sibling
  PR regresses an open claim, and the close records `closePr`, which `landOnClose` reads.
- F2: an in-place send-back is never charged at the cap (`sendBackCharged`, L1). Its send-back check answers no refusal,
  so the gate admits it and no admission wait is stamped. An ordinary send-back at a full cap is refused, as on main.
- F3: the bind refuses a branch that is not the sibling's, in one L1 decision (`decideInPlaceTarget`): the claimant's own
  registry branch, any registry row's branch in the project, and the project's base branch. An unlistable registry, a
  missing claimant row, and a project row whose branch cannot be read all refuse.
- F4: `lastRunBySession`'s newest reads skip in-place rows, so a coordinator whose last in-place run closed does not read
  released.
- F5, F6, F9: the in-place arm of `resolveDoneBranch` names no project, an abandon that composed no fleet act reports
  `none` (a new `SweepFleetAct` word) rather than `re-held`, and the comments name the migration slot (117, since #3123
  took 116). The bind's run events read `in-place`, and `bindInPlace` takes `at`.
- F8: one predicate, `actsOnClaimant` (`rundefs.ts`), for the close and the stall watch's worker subjects. The bind's
  refusal ladder, the intent-held test (shared with the dispatch's request step) and the route's body check
  (`inPlaceRequest`) are deciders in `dispatchDecide.ts`. `bindRunInPlace` only reads and writes. The route change is the
  exact delta run 1850's coordinator agreed under item 486.

## Departures of fix round 1, by slug

- `review-close-and-left-hold` (F7, accepted by the coordinator): "every fleet act" means a work run's close, abandon and
  failed close. The review-run close stays as on main, so a self-claimed review run's close still releases or re-holds.
  An ordinary run self-claimed by a reclaim can leave a `program:… run:R` hold, naming a terminal run, on the heir's
  workspace. The sleep path passes such a hold (`run-terminal`), and the operator can clear it by hand.
- `base-branch-from-registry` (F3, amended by review 3023 F3-a): no reader names a project's base branch, so the bind
  takes it from the `base` each of the project's registry rows records (`origin/main` names `main`). An unknown base
  refuses: when no row of the project, the claimant's included, records a base (a coordinator on the main checkout, with
  no ws-add row beside it), the bind answers `bad-request`. A row of the project with a plain field that could not be
  read, or with an empty branch, refuses `registry-unmeasurable`, as an unreadable branch already did.
- `stall-import-pin-admits-acts-on-claimant` (F8): the stall watch's import pin (`stall-vocabulary.test.ts`) admits
  `actsOnClaimant` alone from `rundefs.ts`, which is L1 and imports only L0, beside `sessionRoleOf` from `roleOf`. The
  ruled single predicate needs it.

## Fix round 1, after its fast run

The fast run on the round's tip failed four guards I had not run locally, and CodeQL raised three path alerts. Each is
fixed with no change of behaviour:

- `mail-routes.test.ts`: `in-place` (`IN_PLACE_EVENT`, F9) is a `run_events.detail` word, declared beside
  `session-rebound`.
- `stall-vocabulary.test.ts`: the import pin above.
- `registry-refused-census.test.ts`: the bind's registry read (F3) is a classified site, tagged `refuses` (an unlistable
  registry refuses the bind; a refused row is no registered workspace).
- `end-dead-coordinator.test.ts`: the abandon's commit passes `acted` as on main again. Round 1 had also passed
  `fleet !== null` there, which F6 did not ask for.
- CodeQL `js/path-injection` (3, high): the claimant's project field was read under the request's `by` once the body
  check moved into `inPlaceRequest`. The request step now hands back the claimant as the store recorded it (equal to
  `by`, which it proved), and every read and write after it names that stored id.

## Fix round 2 (review 3023), as ruled

- F3-a: an unknown base refuses in every state (the departure above). There is one red case each: the claimant on a
  main checkout with no ws-add row binding `main`, an unreadable `.base`, and an empty branch. Each was mutation-measured
  on a scratch copy restored from a saved file.
- F4-a: the comment near `other` in `lastRunBySession` no longer says that subquery reads as `newest(true)` does.
- CodeQL-a: the attribution names the stored claimant too. No refusal changes, because the request step proved it equal
  to `by`.

## Follow-ups (nothing acts on them in this PR)

- `in-place-run-close-lane-reads-claimant`: when an in-place run's coordinator is gone, the run-close lane's R6 branch
  facts (open PR, unpushed commits) read the coordinator's workspace, not the sibling branch. No `ws-*` verb results,
  because `closeDecide` refuses it for such a run. The checks read the wrong tree.
- `reclaim-door-moves-claimant` (note): after `reclaimProgram` moves `claimedBy`, an in-place run keeps the old
  coordinator as its `sessionId`. The `inPlace` column still stops every `ws-*` verb and the stall worker subject. Only
  the `self-dispatch` identity no longer holds for it.
- `sibling-worktree-unregistered` (F10, carried): the sibling worktree is registered nowhere (`workspace` stays null),
  so the orphan-tree lane, shadow until `orphan-tree-live`, does not know it. The guards that stand (dirty, in-use,
  committed work keeps its branch) make the worst case friction. Not traced end to end.
- `abandon-commit-stale-without-act`: the abandon's commit step reads a refusal as `stale` even when no fleet act ran
  (a stored id no verb may name, or an in-place run). This is main's behaviour, and it is kept here.
- `raw-in-place-readers` (review 3023 F8-a): three readers still test `run.inPlace === true`, not `actsOnClaimant`:
  `resolveDoneBranch`'s in-place arm, `verifyDone`'s sibling PR-line read and the send-back cap check. After a coord.db rebuild `inPlace` is
  lost, so a rebuilt in-place run's send-back is charged at the cap and its done-claim is measured on the registry
  branch. Both fail closed (`stale-tip`, or a wait at the cap). The ruled single predicate covers the close and the stall
  watch only.
- `in-place-done-fail-closed-costs` (review 3023 F1-a): (a) the in-place done branch names no project, so the
  lineage acceptance never applies and a live tip that is the claim plus clean base merges answers `stale-tip`;
  (b) with no ws-add row in the project, `pr-state --project` gives no full line and the verdict is
  `pr-unmeasurable`; (c) an unpushed local sibling tip binds no PR, so an open claim regresses. All three fail closed.
- `advance-gate-in-place-edge-pin` (review 3023 F2-a): the advance gate's `cap` row knows nothing of in-place runs. The
  exemption is the check `sendBackCapCheck` hands it, and the gate's one production caller always builds the check
  that way. A pin on the in-place edge would catch a future caller that skips it.
- The landing-checks pass reads an in-place run's PR in its coordinator's workspace by the episode's explicit PR
  number. It is read-only, so this is a note only.

## Review 2907 of W1-4, ruled

The plan's W1-4 goal row, file lines, exit gate and D-6095 now say: every refusal (dispatch and send-back) is a journal
line; every wake is a journal line and a feed row.
