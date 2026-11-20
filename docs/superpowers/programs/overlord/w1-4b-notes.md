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
  `ccd/coordinator-skill/references/wave-lifecycle-2-dispatch.md`. The plan's one SKILL.md line is NOT in this PR: the
  skill-size ratchet raises a SKILL.md cap only for a new pinned clause, and a raise for a plain line fails it. W1-5
  rewrites that entry.
- `migration-slot`: the column takes the next free `MIGRATIONS` slot on this branch's base. It is renumbered by merge if
  another migration lands first.
- `routes-forced-line`: the dispatch and advance routes' hunks are added lines, except one forced line. The advance
  route's `verifyDone` argument becomes `doneRunOf(run)`, so an in-place run's claim is measured on its recorded branch.

## Follow-ups (nothing acts on them in this PR)

- `in-place-run-close-lane-reads-claimant`: when an in-place run's coordinator is gone, the run-close lane's R6 branch
  facts (open PR, unpushed commits) read the coordinator's workspace, not the sibling branch. No `ws-*` verb results,
  because `closeDecide` refuses it for such a run. The checks read the wrong tree.
- `reclaim-door-moves-claimant` (note): after `reclaimProgram` moves `claimedBy`, an in-place run keeps the old
  coordinator as its `sessionId`. The `inPlace` column still stops every `ws-*` verb and the stall worker subject. Only
  the `self-dispatch` identity no longer holds for it.
- The landing-checks pass reads an in-place run's PR in its coordinator's workspace by the episode's explicit PR
  number. It is read-only, so this is a note only.

## Review 2907 of W1-4, ruled

The plan's W1-4 goal row, file lines, exit gate and D-6095 now say: every refusal (dispatch and send-back) is a journal
line; every wake is a journal line and a feed row.
