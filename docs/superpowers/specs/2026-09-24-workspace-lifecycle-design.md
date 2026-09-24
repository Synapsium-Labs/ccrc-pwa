# Workspace lifecycle — released, archived, expired — design

**Status:** the operator ruled every decision in dialogue on 2026-09-24 (§2). The code was mapped read-only at
`147557fb`, which is `origin/main` `b501698a` plus docs. Line numbers are hints; each citation names its function,
so the text can be found after `main` moves. Not yet reviewed.
**Date:** 2026-09-24 · **Branch:** `ws/workspace-lifecycle-design` (from `origin/main` `28271ace`)
**Parents:**
- `2026-09-22-child-workspace-reclamation-design.md` (CCR-15). This spec's stages 3 and 4 build on its wave-3
  executor and wave-4 sweep lane, and add two populations to it.
- `2026-09-16-board-placement-and-repo-label-design.md`. Its rule "Lifetime: while the workspace is held" is why a
  released worker drops back onto its own card, and it stays in force.
- `2026-09-23-session-continuity-design.md`. Its stage 6, second part (wave 9), makes ending a pane stop the pane's
  whole scope. Archive inherits that and does not duplicate it (§5.2).

## 1. The problem, measured

The fleet board on 2026-09-24, 08:56–13:26 UTC, read from `ccd ls`, the runs lists (`ccrc-api runs list`,
`--closed 1`) and registry file existence:

- **Half the board is released workers.** 29 of 56 registry rows are workspaces whose newest run is terminal, that
  no open run names and that carry no hold. They were released by three live coordinators, which released 12, 10
  and 7 of them. 11 still have a live pane. The median time since release was half a day and the oldest was
  6.9 days. 15 of the 29 carry CCR-15's `.child` marker; 14 were minted before CCR-15 wave 1 deployed and carry
  none.
- **Why they are loose.** `nestFleet` draws the coordinator→worker bracket from the `runs` frame, which is
  active-only by construction (`pwa/src/fleet/nestFleet.ts` header, `watch.ts`'s `emitRuns`). Board placement
  keys on the hold (placement spec §4, "Lifetime: while the workspace is held"). A release removes both, so the row
  lands at the top level of its own project card under its generated slug.
- **The operator cleans up by hand.** 29 workspaces were archived, most of them that morning (median age
  0.2 days, oldest 4.7). Nothing ever removes an archived workspace: `ws-reap` is human-only, and the only way to
  reach it is the PWA's audit, then a confirmed reap.
- **Stop and Archive are one act under two names.** Both run `_ws_unsupervise`, which writes the stop stamp,
  disables `claude-session@<id>` and removes `.supervised`, and then both run `tmux kill-session`
  (`cmd_stop`; `cmd_ws_archive`). They differ in what Archive adds and what it refuses:
  - Archive also writes an archive manifest and the `.archived` stamp.
  - It refuses a main checkout, a busy session and a worktree that is gone.
  - `cmd_stop` refuses nothing.

  On the board the two end up in different places: a stopped main checkout buckets `dead` (`sessionBucket`,
  `shared/api.ts`), while an archived workspace folds into `Archived (N)`. Of the 21 stopped sessions that day,
  19 were archived workspaces and 2 were stopped main checkouts.
- **A dead coordinator strands its programme.** `measureClaimant` (`server/src/coord/reclaim.ts`) already answers
  "is this coordinator dead". Only the operator's reclaim door calls it, and nothing acts on a coordinator that
  died and was never replaced.

## 2. Operator rulings (2026-09-24)

| # | Ruling |
|---|---|
| L1 | A **`Released (N)`** fold on every project card, directly above `Archived (N)`. It is collapsed by default and expands on tap, with rows grouped by programme. It is "the transition zone from which they get archived and cleaned". |
| L2 | **Stop and Archive are one user feature, "Archive".** Archiving a busy session confirms first ("It's working. Archive anyway? The turn in progress is lost") and then archives. Archiving a main checkout stops it and shows it in the Archived fold; it is never deleted. "Restore" is the one way back. |
| L3 | **An archived workspace is cleaned up 7 days after its archive.** The cleanup keeps git state and transcripts (§5.3). Main checkouts are exempt. |
| L4 | **A coordinator that CRASHED and stays dead for 1 hour, with no successor,** has its open runs closed `failed`, and its workers are then cleaned up. Only a crash counts: the session died and nothing is reviving it, or its registry row is gone. A coordinator the operator archived or stopped is never "dead" here. |
| L5 | **Archiving a coordinator that still has open runs asks** "It has N open runs. End its programme too? Its workers will be cleaned up." Ending a programme is always the operator's explicit act, taken at the moment of the archive. |
| L6 | **CCR-15 wave 4 dispatches the moment wave 3 merges.** This spec does not re-plan wave 4; its own later stages build on wave 4 after it lands. |

L3's "lossless" was stated to the operator and was not objected to. It keeps everything git knows: commits, dirty
work committed first, stashes and operation heads, all pinned. It keeps the conversation transcripts. It deletes
git-ignored files, secret-shaped files and clips, recording their paths and sizes (§5.3).

## 3. Why an automatic expiry is safe here when the 2026-09-10 sweep was not

The 2026-09-10 ruling removed `sweepMerged`'s automatic `ws-archive` after 5 of 13 archive markers in 48 hours
landed on sessions a human revived by hand (`watch.ts`, the merged lane's header). Its argument was that an
instantaneous `idle` cannot tell "finished" from "a human is reading it", and this spec does not dispute it.
CCR-15 §3 answered it for children by changing the **population**: a child is nobody's to come back to, by
declaration at birth.

L3 changes the population the same way, but by a different declaration:

1. **Someone already archived it.** An archived workspace is one a human archived, or one a run's close
   archived on a coordinator's explicit `archive:true` (`close.ts`'s archive arm). Nothing in this spec archives
   anything on its own; the expiry acts only on the result of an archive.
2. **It has had no pane since.** `ws-archive` killed the pane. There is no in-flight turn to lose and no scrollback
   to read, which were the two things the 2026-09-10 harm consisted of.
3. **A week to change your mind, with the door unchanged.** Restore works exactly as today for 7 days. A restore
   deletes `.archived`, and the expiry token binds the archive's epoch (§5.3), so a workspace restored and
   re-archived starts a new week and can never be taken on the old one.
4. **Nothing git knows is lost.** The pin phase is CCR-15 wave 3's.

**What must be measured before stage 3 ships** (§9): how often, and how late, archived workspaces are restored.
The lifecycle journal mirror records every `archive` and `restore` act with its time. If any restore in its horizon
came later than 7 days after its archive, stage 3 does not ship with a 7-day constant until the operator has seen
that number.

## 4. What changes, and where, in one table

| Stage | Wave | What | Where | Deploy class | Depends on |
|---|---|---|---|---|---|
| 1 | 1 | The `Released (N)` fold, and `FleetSession.releasedFrom` | server, pwa | server + pwa | — |
| 2 | 2 | One "Archive" (stop merged into it), coordinator ask, "Restore" | server, pwa | server + pwa | — |
| 3 | 3 | `ws-expire`: archived workspaces cleaned 7 days after archive | ccd, server | **AGENT-FIRST** | CCR-15 waves 3–4 merged and deployed |
| 4 | 4 | The dead-coordinator lane | server | server | CCR-15 waves 3–4; stage 2 (L5) |

Waves 1 and 2 touch `groupFleet.ts`, `ProjectCard.tsx` and `shared/api.ts`, so they land one at a time, in either
order. Neither touches ccd, a CCR-15 file, or a guard CCR-15's in-flight waves pin.

## 5. The design, in stages

### 5.1 Stage 1 — the `Released (N)` fold

**The fact comes from the server, because only the server can know it.** The client sees active runs only, and
"released" is a fact about a CLOSED run. Keep the vocabulary apart as well: `released` is already a member of
`AskState` and of `CLAIM_STATES` (`shared/api.ts`), with different meanings. So the wire field is named for what it
carries, and "Released" appears only as the fold's label.

- **The wire field.** `FleetSession.releasedFrom: ReleasedFrom | null`, where `ReleasedFrom` is
  `{ runId: number; program: string; programTitle: string | null; claimedBy: string | null; closedAt: number }`. It
  is ADDITIVE, declared in L0 `shared/api.ts`. It is written once, in `assembleFleet`'s literal
  (`server/src/fleet.ts`), and read once, by one structured reviver inside `reviveFleetSession`. The precedent is
  `boardProject`, added by board-placement wave 2 and pinned by `fleetstate.test.ts`'s absent-and-present case. An
  older server, or a snapshot predating the field, reads `null`, which means "not released". That is the correct
  degradation: the row renders exactly as it does today.
- **The decision is one pure L1 function**, `releasedFrom(input)` beside `placement.ts`, over four facts. It answers
  non-null only when ALL of these hold:
  - `workspace !== null` (a main checkout is never released);
  - `held === null`;
  - `archivedAt === null` (archived rows keep their own fold);
  - the session's newest run is in `TERMINAL_RUN_STATES` and NO non-terminal run names the session.

  Doubt answers `null`, never "released": an unreadable coordination store means the row stays where it is today.
- **One batched read per tick.** `boardPlacement`'s stamps cannot answer this: `coordPlacementStamps` filters to
  `coordProject IS NOT NULL` and carries no run state. `openRunsForSession`'s per-session shape would repeat the
  per-row cost that `readCoordPlacements`' own docstring rejected. So the store gains ONE grouped statement,
  `lastRunBySession()`: for each `sessionId`, the newest run's id, state, program, title, claimant and `closedAt`,
  plus whether any non-terminal run names the session. It is called once per assembly, beside
  `readCoordPlacements`, and follows the same failure contract: a throw or `ok:false` makes every row's
  `releasedFrom` `null`.
- **The fold.** `groupFleet` gains `FleetGroup.released: FleetSession[]`, split beside the archived split.
  - Membership: `releasedFrom !== null`, `bucket !== 'archived'`, and `bucket !== 'attention'`. **Attention is
    never folded**; that is `groupFleet.ts`'s own governing principle, since folding "can never hide the"
    attention.
  - Folded released rows take no part in the card's `busy`, `unseen`, `pin` or `stranded`, exactly as archived rows
    do.
  - `ProjectCard.tsx` renders the fold before the `Archived (N)` block. It uses the same toggle shape under a new
    composite key, `<project>::released`, and is inverted to start closed, like `::archived` (`FleetScreen.tsx`'s
    call site).
  - Inside, rows are grouped under a sub-heading per `releasedFrom.program`, with the title when known. Groups run
    newest `closedAt` first, and rows within a group newest first. Every row is a `SessionLine`, so it opens, and
    its actions sheet works as it does today.
- **"Archive all (N)"** sits inside the expanded fold, behind one confirm. It archives the fold's rows one at a
  time through stage 2's archive door. A row that refuses is toasted with its reason and the rest continue. This is
  how the 14 unmarked children leave the fold: CCR-15 will never reclaim them, and stage 3 cleans them up 7 days
  after this archive. Once CCR-15 wave 4 is deployed, marked children usually leave on their own within about two
  sweep passes of their run's close, so the fold mostly holds unmarked, paused or refused ones.
- **Placement is unchanged.** A released worker renders on its OWN project card, because board placement's
  lifetime is the hold. Grouping by programme inside the fold is the "bundled with the programme that released it"
  the operator asked for, without re-introducing a cross-card move for a row nobody holds.

### 5.2 Stage 2 — one "Archive"

**What the operator sees.**
- Every session's menu and actions sheet offers **Archive**. "Stop session" is removed from the PWA: the header's
  danger item and its `QuickConfirm`, and `SessionScreen.tsx`'s `stopSession`. The CLI verb `ccd stop` and the route
  `POST /api/sessions/:id/stop` stay, for scripts and for the server's own use below.
- The confirm reads by case:
  - An idle workspace: "Archive this workspace? It goes offline and folds into Archived. Restore brings it back for
    7 days; after that it is cleaned up."
  - A busy session: "It's working. Archive anyway? The turn in progress is lost."
  - A main checkout: "Archive this session? It goes offline and folds into Archived. Restore starts it again. It is
    never deleted."
- **Restore** is offered on every archived row. For a workspace it is the existing `POST /api/sessions/:id/restore`
  (`ws-restore`). For a main checkout it is the existing `POST /api/sessions/:id/ensure` (`cmd_ensure` clears the
  stop stamp on the attempt).

**The server's one door.** `POST /api/sessions/:id/archive` (`server.ts`) takes
`{ force?, interrupt?, programme?: 'end' | 'keep' }`.

1. **Coordinator check (L5).** When the session is the `claimedBy` of any NON-terminal run, it refuses
   `409 coordinator-has-open-runs` with those runs, unless `programme` is present.
   - `'end'`: each of those runs is abandoned through the abandon arm of `closeRun` (`intent:'abandon'`,
     `causedBy:'operator'`, the same act as `POST /api/runs/:id/abandon`), serialised on the coordination mutex,
     before the archive. The archive route lives in `server.ts` and the mutex is local to `registerCoordRoutes`
     (`coord/routes.ts`), so the plan either exports the serialiser or registers the programme arm beside it; the
     same choice serves stage 4.
   - `'keep'`: the archive proceeds and the runs stay open. The programme is paused, not ended; its workers keep
     their holds, and restoring the coordinator resumes it.

   A store read that fails refuses `409 coordinator-has-open-runs` with `runs: []`, fail-shut exactly like today's
   `run-open`. The existing `run-open` check, on the session as a WORKER, and its `force` bypass are unchanged.
2. **Main checkout** (`rec.workspace === null`). The server runs the stop argv `/stop` already builds
   (`CCD_ARGV.stopId` / `stopPair`, surface `pwa`), never `ws-archive`. Nothing ever writes `.archived` for a main
   checkout, which keeps every reap and expiry path structurally away from it: `ws-expire`'s rung 1 refuses
   `not-a-workspace` as well (§5.3).
3. **Busy workspace.** Without `interrupt:true`, ccd's own `session-busy` refusal is mapped from the 502 to a typed
   `409 session-busy`, so the PWA can show the busy confirm rather than a generic failure. The mapper found that
   today `{force:true}` on a busy session still 502s from ccd inside `runCcdOr502`'s generic body. With
   `interrupt:true` the server runs `ccd stop --surface pwa <id>` FIRST, then `ws-archive`. ccd needs no new flag:
   after the stop, `_ws_status` no longer reads `busy`.
4. **Idle workspace**: `ws-archive`, as today.

**The board.** `sessionBucket` gains one rung, directly after the archived-workspace rung and under the same D-74
guard (`status === 'dead'`). A main checkout (`workspace === null`) whose `lifecycle` is `stopped` buckets
`archived`, not `dead`. The Archived fold splits by bucket, so the row moves there with no change to `groupFleet`.
A stopped main checkout that is later started leaves the rung, because `cmd_start` and `cmd_ensure` remove the stop
stamp on the attempt. The D-74 regression shape, a revived archived row outranking live rungs, is re-tested for the
new rung.

**The pane's scope.** Archive, like stop today, kills the tmux session. Processes that detached from the pane
survive in its scope, which is where session-continuity §1.3's dead scopes come from. Session-continuity wave 9
("ccd stops a pane's scope when it ends the pane") covers every verb that ends a pane, archive included. This spec
adds nothing there and states the dependency.

### 5.3 Stage 3 — archived workspaces expire after 7 days (`ws-expire`)

**The verb.** `ccd ws-expire --expect <token> --session <id>`, minted and checked exactly like CCR-15 wave 3's
`ws-reclaim`: `ws-audit --expire` mints a 64-hex token, the ladder is re-proven on the box inside the same
`$REG/.reap-<id>.lock`, and the breadcrumb, pin phase and tail are wave 3's.

It is a SIBLING verb, not a flag on `ws-reclaim`. Wave 3's rung 2, the `.child` marker, has "no override anywhere",
and that plan argues why a flag that widens the population becomes an override. Its ladder:

- **Rung 1**, registry identity: `no-such-session`, and `not-a-workspace` for a main checkout. This is wave 3's
  rung 1, unchanged.
- **Rung 2′** replaces the child rung.
  - `.archived` must be present, and its epoch must be at most `now − WS_EXPIRE_AFTER_S` (604 800).
  - The token's input includes that epoch, so a restore, or a restore followed by a re-archive, refuses
    `state-changed`.
  - A row carrying the `.child` marker refuses `child` (retryable). Children belong to CCR-15's lane, which takes
    them first and sooner.
- **Rungs 3–10** are wave 3's: `paused` (the same `reclaim-paused` switch), `held`, `attached`, `tree-busy`,
  `branch-elsewhere`, `tree-unreadable`, `containment-unproven`, and the fingerprint. There are two differences:
  - `--defer-expired` does not exist for `ws-expire`, so rungs 5 and 6 are never skipped (see "presence" below).
  - An archived workspace whose worktree is gone takes wave 3's vanished-worktree arm, as a child's does.

**What it keeps and what it deletes.** It keeps git state: dirty tracked and unignored untracked work is committed
on the branch, and every commit, stash and operation head is pinned under `refs/archive/`, as wave 3's pin phase
does. It keeps the conversation transcripts, since the transcript roots are not under the worktree. It deletes:
- the worktree;
- the branch ref, after the pin;
- git-ignored files and secret-shaped files, with paths and sizes recorded in the tombstone;
- `~/.cc-clips/<id>`, with its paths recorded;
- the registry row.

The reflog pin cap (`ccd/ccd`, 200) and the tombstone format are wave 3's. This is not the 2026-09-23 manual
procedure, which tarred ignored files and refused dirty trees. The operator accepted the difference (§2).

**The lane.** CCR-15 wave 4's `sweepChildReclaim` gains a second population in a sibling L1 verdict,
`archivedExpiryVerdict`, in its own file beside `childReclaimSweep.ts`. It shares the lane's registry read, pass
interval (`CHILD_RECLAIM_SWEEP_MS`), twice-observed memory, `reclaim-paused` switch, feed row and attention list.
A row is eligible when all of these hold:
- it is a workspace, archived, carries no `.child` marker, and its archive epoch is at least 7 days old;
- it has no hold, and no non-terminal run names it (an unreadable store makes it ineligible);
- it is not paused, and every one of the above held on the previous pass too.

Presence is different from children. A PWA viewer, or an attached client, defers WITHOUT a ceiling. Rule 4's
15-minute ceiling exists only because a child is nobody's, and an archived workspace may be the operator's. The
lane keeps its own entry map, so a child's clocks and an archived workspace's clocks never mix.

**Precedence.** An archived child (CCR-15 wave 3 found nothing stops a child being archived) is the child lane's:
`ws-expire` refuses it at rung 2′, and `archivedExpiryVerdict` skips it before the verdict.

**The contracts that move** (every verbatim pin moves in the same commit):
- CLAUDE.md's SAFETY list gains `ws-expire` among the verbs no agent runs against the live host. "`ws-reap` is
  human-only by contract" stays literally true, because `ws-expire` is a different verb with a different
  population. A new sentence says `ws-expire` is the server's, on archived workspaces 7 days after their archive,
  and never an agent's.
- Coordinator clause 3, worker clause 8 and reviewer clause 8 name `ws-expire` beside the verbs they already
  forbid. The equality census, where each forbidden verb appears exactly once and only inside its clause, moves
  with them.
- README's workspace-lifecycle section and `wave-lifecycle.md` §6 ("cleanup is the operator's ceremony in the PWA")
  say what now happens after 7 days.
- The grant: a `CcdArgv` builder, the `expire-v1` capability token read with `capSupported`, and
  `REQUIRED_VERB_FLAG` enrolment with its negative type fixture. This is CCR-15 wave 3's shape for `ws-reclaim`.

### 5.4 Stage 4 — the dead-coordinator lane (L4)

**Death is a crash, measured.** A claimant is dead for this lane when `measureClaimant` answers `dead` AND the
lifecycle word it read is NOT `stopped`. That leaves:
- a cleanly absent registry row, re-confirmed by the second listing;
- `orphan`: pane gone, no fresh supervisor heartbeat, started;
- `never-started`.

`stopped` is excluded, because it means a person stopped or archived the session (§1). L5 already asked that person
about the programme at that moment. `restarting` is alive: systemd restarts a crashed unit after `RestartSec=3` and
the new supervisor stamps `supervised` before respawning, so an out-of-memory kill reads `restarting`, never
`orphan`, while it is being revived. `unmeasurable` is never dead.

**The hour is anchored to evidence where it exists, and is otherwise remembered.**
- For `orphan`, dead-since is the `.supervised` stamp's epoch, the last heartbeat. This is durable across server
  restarts.
- For `never-started` and an absent row, dead-since is the lane's first observation. It is in memory, so a restart
  only delays the act, which is safe.
- Any `alive` or `unmeasurable` answer drops the entry.

The lane acts when dead-since is at least one hour past AND two consecutive passes, 60 s apart, both measured dead.

**No successor.** The only evidence is the re-read, because a reclaim is atomic and leaves no pending record. The
programme's open runs must still name the dead id as `claimedBy`, re-read inside the act. A successor (reclaim door)
changes `claimedBy`, and a revive (Revive, `ccd ensure` on the same id) makes it read `alive`. Either ends the
entry.

**The act.** For each non-terminal run whose `claimedBy` is the dead id, the lane closes the run through the same
abandon arm as the door, with two differences.
- **A third attribution word.** `causedBy` is `'coordinator' | 'operator'` today (`close.ts`) and gains `'sweep'`,
  so the run event, the feed row and the audit never read as the operator's act.
- **A compare-and-set.** The store transaction commits only while `claimedBy` still equals the dead id. A reclaim
  that lands during the lane's `runCcd` (the fleet act runs before the commit) turns the close into a no-op
  refusal, never a failed run belonging to a live heir.

The lane runs on the coordination mutex's serialiser. That serialiser is local to `registerCoordRoutes` today, so
the plan exports it or places the lane beside it. The watcher cannot take it, which is why the CCR-15 wave-4 lane
avoids `closeRun` altogether.

**What follows, stated so nobody is surprised:**
- The programme retires as `abandoned`, permanently.
- Outstanding deliveries naming those runs are cancelled.
- The slug stays fenced to the dead id until someone reclaims it.
- CCR-15 wave 3's close path reclaims each marked child whose run closed. That includes a worker mid-turn: its work
  is committed and pinned, its turn is lost. L4 accepts this, because a report nobody will read is waste.
- An unmarked worker is only released, so it moves into the `Released` fold. From there "Archive all" and stage 3
  finish it.

**Bounds.**
- Runs in `closing` or `unknown` cannot be abandoned (`RUN_TRANSITIONS`). They are listed in the attention item
  with the dead coordinator's id and are not retried beyond the lane's backoff.
- The lane reads only the distinct claimants of open runs, a handful, at the child lane's 60 s cadence. It never
  measures every registry row.
- The `reclaim-paused` switch stops this lane too.
- One feed row per ended programme: "coordinator `<id>` crashed at `<time>` and stayed dead an hour; programme
  `<slug>` ended, `<n>` runs closed failed".

## 6. What this changes outside itself

- **Wire.** Stage 1 adds `FleetSession.releasedFrom`. Stage 2 adds `409 coordinator-has-open-runs` and
  `409 session-busy` on the archive route; each refusal code is declared once, with its test, like `run-open`. No
  `FLEET_PROTO` bump.
- **PWA text pinned by tests.** `header.test.tsx`'s Stop cases (the label, the confirm and the disabled-on-fault
  gate) become Archive cases. `SessionActionsSheet`'s archive and restore gates widen from `workspace !== null` to
  every session. The fleet screen's section-heading vocabulary pin changes, because a stopped main checkout leaves
  `Dead`.
- **Skills and CLAUDE.md** (stage 3), listed in §5.3.
- **CCR-15.** Its wave 4's lane gains a population, and its `causedBy` vocabulary gains a word. Stage 3 and stage 4
  land AFTER CCR-15 wave 4, against its merged code, and amend no CCR-15 plan. L6 is a ruling on CCR-15's order,
  carried to its coordinator.
- **Landing-order.** Its stage 5 (the landing line) keys entries and intents to runs. A run the stage-4 lane fails
  strands its entry, so the landing plan must treat a `sweep`-failed run as it treats an operator abandon. This is
  recorded there as a carried constraint.

## 7. What is not done

- No automatic archive of anything. Released rows are archived by the operator ("Archive all") or reclaimed by
  CCR-15. The 2026-09-10 ruling stands.
- No backfill of CCR-15's marker onto the 14 pre-policy children. Proving a workspace was minted by a run and not
  by the operator is the risky part, and no new unmarked children are being made.
- No change to board placement's lifetime. Released rows stay on their own card.
- No new lifecycle word. "Archived" is a bucket and a fold, not a `SessionLifecycle` member.

## 8. Failure modes named

- **The Released fold hides a worker that needs the operator.** Attention is never folded (§5.1).
- **The fold's count flickers as CCR-15 reclaims children.** Each pass removes rows. That is the fold doing its
  job, and the count reads from the same frame as the rows.
- **An archive of a coordinator ends a programme the operator meant to pause.** It only happens on an explicit
  `programme:'end'`. `'keep'` pauses instead (§5.2).
- **A busy archive loses a turn.** Only after the busy confirm; `interrupt:true` is sent by that confirm alone.
- **A main checkout is deleted.** Structurally impossible. Nothing writes `.archived` for one, and `ws-expire` rung
  1 refuses `not-a-workspace`.
- **An archived workspace the operator is reading is expired.** Presence defers with no ceiling (§5.3).
- **A restored-then-re-archived workspace is expired on its first week.** The token binds the archive epoch, so it
  refuses `state-changed` (§5.3).
- **A coordinator being revived is declared dead.** `restarting` is alive. The hour is anchored to the last
  heartbeat and needs two dead passes (§5.4).
- **A coordinator the operator parked is declared dead.** `stopped` is excluded (§5.4, L4).
- **The lane fails a run a successor just took.** The compare-and-set on `claimedBy` (§5.4).
- **The lane loops on a run it cannot abandon.** `closing` and `unknown` go to the attention item (§5.4).

## 9. Measurement, targets and the kill rule

Committed with the plan: `deploy/measure-workspace-lifecycle.py`, read-only, run on the fleet box and the server
box. Its rows:

| Row | Baseline (2026-09-24) | Target |
|---|---|---|
| released workspaces at the top level of a card | 29 of 56 rows | 0 outside the fold (attention rows excepted) |
| archived workspaces older than 7 days | 0 (oldest 4.7 days) | 0 one lane pass after the 7th day |
| archive → restore delays over the journal's horizon | measured before stage 3 ships | none later than 7 days; otherwise the operator sees it first (§3) |
| manual archives per day | measured from the journal | falls once stage 1's "Archive all" and stage 3 ship |
| programmes ended by the stage-4 lane, and later reclaims of their slugs | — | reported; each one listed with its coordinator's last heartbeat |

**Kill rule for stage 3.** A restore of a workspace whose archive is between 6 and 7 days old, seen twice in a
week, means 7 days is too short for how the operator works. Raise `WS_EXPIRE_AFTER_S` in ccd before anything else.
The attic keeps every expired workspace's commits in the meantime, so nothing is lost while that happens.

## 10. Sequencing

1. **Waves 1 and 2** (stages 1 and 2) are independent of CCR-15 and dispatch now, one at a time.
2. **CCR-15 waves 3 and 4** run as their own programme. L6: wave 4 dispatches the moment wave 3 merges.
3. **Wave 3** (stage 3) is planned against CCR-15 wave 4's merged lane and dispatched once CCR-15 wave 4 is
   deployed. Before it ships, §9's restore-delay row is measured.
4. **Wave 4** (stage 4) is planned against the same merged code and needs wave 2's L5 door. It lands after wave 3,
   because both edit the lane's file.

## 11. Operator decisions

None open. L1–L6 were ruled on 2026-09-24. §3's measurement gate is a precondition of stage 3, not a decision.
