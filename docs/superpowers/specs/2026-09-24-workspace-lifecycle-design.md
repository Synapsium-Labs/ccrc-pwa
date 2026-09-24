# Workspace lifecycle — released, archived, expired — design

**Status:** the operator ruled every decision in dialogue on 2026-09-24 (§2).
- **Rev 2** applies a four-lens adversarial review: 51 findings, 43 confirmed, 7 partly confirmed, 1 refuted. Every
  surviving finding is applied here.
- **Two consequences** of the rulings are stated for the operator to confirm (§11).
- **Citations.** The code was mapped read-only at `147557fb` (`origin/main` `b501698a` plus docs) and re-read at
  `28271ace`. Line numbers are hints; each citation names its function, so the text can be found after `main`
  moves.

**Date:** 2026-09-24 · **Branch:** `ws/workspace-lifecycle-design` (from `origin/main` `28271ace`)
**Parents:**
- `2026-09-22-child-workspace-reclamation-design.md` (CCR-15). Stages 3 and 4 run on its wave-3 executor
  machinery and its wave-4 sweep lane, and amend six of its texts (§6).
- `2026-09-16-board-placement-and-repo-label-design.md`. Its "Lifetime: while the workspace is held" stays in force.
- `2026-09-23-session-continuity-design.md`. Its wave 9 makes every verb that ends a pane stop the pane's whole
  scope (§5.2).

## 1. The problem, measured

The fleet board on 2026-09-24, 08:56–13:26 UTC, read from `ccd ls`, the runs lists (`ccrc-api runs list`,
`--closed 1`) and registry file existence:

- **Half the board is released workers.** 29 of 56 registry rows are workspaces whose newest run is terminal, that
  no open run names and that carry no hold. They were released by three live coordinators, which released 12, 10
  and 7 of them. 11 still have a live pane. The median time since release was half a day and the oldest was
  6.9 days. 15 of the 29 carry CCR-15's `.child` marker; 14 were minted before CCR-15 wave 1 deployed and carry
  none.
- **Why they are loose.** `nestFleet` draws the coordinator→worker bracket from the `runs` frame, which is
  active-only by construction (`nestFleet.ts`'s header; `watch.ts`'s `emitRuns`). Board placement keys on the hold.
  A release removes both, so the row lands at the top level of its own card under its generated slug.
- **The operator cleans up by hand.** 29 workspaces were archived (median age 0.2 days, oldest 4.7). Nothing ever
  removes an archived workspace. `ws-reap` is human-only, and the only way to reach it is the PWA's audit, then a
  confirmed reap.
- **Stop and Archive are one act under two names.** Both reach `_ws_unsupervise` (the stop stamp, the unit
  disabled, `.supervised` removed) and then `tmux kill-session` (`cmd_stop`; `cmd_ws_archive`). Archive adds a
  manifest and the `.archived` stamp, and refuses a main checkout, a busy session, a worktree that is gone, a status
  it cannot read, and a manifest it cannot build. `cmd_stop` refuses nothing. On the board they end up apart: a
  stopped main checkout stays in the `dead` bucket (`sessionBucket`; M10 pins that a lifecycle moves no bucket),
  and an archived workspace folds into `Archived (N)`. Of the 21 stopped sessions that day, 19 were archived
  workspaces and 2 were stopped main checkouts.
- **A dead coordinator strands its programme.** `measureClaimant` (`coord/reclaim.ts`) answers "is this claimant
  dead", but only the operator's reclaim door calls it.

## 2. Operator rulings (2026-09-24)

| # | Ruling |
|---|---|
| L1 | A **`Released (N)`** fold on every project card, directly above `Archived (N)`. It is collapsed by default and expands on tap, with rows grouped by programme. It is "the transition zone from which they get archived and cleaned". |
| L2 | **Stop and Archive are one user feature, "Archive".** Archiving a busy session confirms first ("It's working. Archive anyway? The turn in progress is lost") and then archives. Archiving a main checkout stops it and shows it in the Archived fold; it is never deleted. "Restore" is the one way back. |
| L3 | **An archived workspace is cleaned up 7 days after its archive.** The cleanup keeps git state and transcripts (§5.3). Main checkouts are exempt. |
| L4 | **A coordinator that CRASHED and stays dead for 1 hour, with no successor,** has its open runs closed `failed`, and its workers are then cleaned up. Only a crash counts. A coordinator the operator archived or stopped is never "dead" here. |
| L5 | **Archiving a coordinator that still has open runs asks** "It has N open runs. End its programme too? Its workers will be cleaned up." Ending a programme is always the operator's explicit act. |
| L6 | **CCR-15 wave 4 dispatches the moment wave 3 merges.** This spec does not re-plan it. Stages 3 and 4 build on it after it lands. |

"Lossless" in L3 keeps everything git knows: commits, dirty work committed first, stashes and operation heads, all
pinned in ccd's attic. It keeps the transcripts. It deletes git-ignored files, secret-shaped files and clips,
recording their paths and sizes. This was stated to the operator and not objected to.

## 3. Why an automatic expiry is safe here when the 2026-09-10 sweep was not

The 2026-09-10 ruling removed `sweepMerged`'s automatic `ws-archive` after 5 of 13 archive markers in 48 hours
landed on sessions a human revived by hand. Its argument is that an instantaneous `idle` cannot tell "finished"
from "a human is reading it", and this spec does not dispute it. CCR-15 §3 answered it for children by changing
the population. L3 changes the population too, by a different declaration:

1. **Someone already archived it.** An archived workspace is one a person archived (stage 2's door), or one a
   run's close archived on a coordinator's explicit `archive:true` (`close.ts`'s archive arm). Nothing in this spec
   archives anything on its own. Stage 1's "Archive all" is the operator's tap.
2. **It has had no pane since.** There is no in-flight turn to lose and no scrollback being read, which is what the
   2026-09-10 harm consisted of.
3. **A week with the doors unchanged.** Every way back is still open for 7 days: restore, start, ensure, Revive,
   swap. Every spawn path clears `.archived` (`_spawn_start`), and the expiry token binds the archive's epoch. So a
   workspace brought back, and archived again later, starts a new week and can never be taken on the old one
   (§5.3).
4. **Nothing git knows is lost.** The pin phase is CCR-15 wave 3's.

**What L2 changes about item 1** (§11 item 2): after stage 2, archiving is the only way to put a workspace down. A
"stop for now" to free memory therefore also starts the 7-day clock.

**Measured before stage 3 ships** (§9). The lifecycle journal mirror records every act with its time. The
measurement counts every return of an archived workspace, not only `restore`, as the time from its `archive` act
to the next spawn-class act on that id (`start`, `ensure`, `restore`, `swap`, `spawn`, `unarchive`; ccd's `_LC_ACTS`). If any return in the journal's horizon came
later than 7 days after its archive, stage 3 does not ship with a 7-day constant until the operator has seen that
number.

## 4. What changes, and where

| Wave | Stage | What | Files (not exhaustive; the plan measures) | Deploy class | Depends on |
|---|---|---|---|---|---|
| 1 | 1 | The `Released (N)` fold; `FleetSession.releasedFrom` | `shared/api.ts`, a new L1 file, `server/src/coord/store.ts`, `server/src/fleet.ts`, `pwa/src/fleet/groupFleet.ts`, `ProjectCard.tsx`, `FleetScreen.tsx` and their tests | server + pwa | — |
| 2 | 2 | One "Archive"; the coordinator ask; the Archived fold takes stopped main checkouts; "Restore" | `server/src/server.ts`, `server/src/coord/routes.ts` (the serialiser), `close.ts` (the port), `shared/api.ts` (refusals, the fold predicate), `SessionHeader.tsx`, `SessionScreen.tsx`, `SessionActionsSheet.tsx`, `ArchiveConflictSheet.tsx`, `groupFleet.ts` and their tests | server + pwa | CCR-15 wave 3 merged (its close-path port) |
| 3 | 3 | `ws-expire`: archived workspaces cleaned 7 days after archive | `ccd/ccd`, the grant files, the lane's file, a new L1 file, CLAUDE.md, README | **AGENT-FIRST** | CCR-15 waves 3–4 merged and deployed; §3's measurement |
| 4 | 4 | The dead-coordinator lane | `coord/reclaim.ts` (the verdict widened), a new L1 file, the lane, `store.ts` (the anchor table), `close.ts` (`causedBy`) | server | wave 2; CCR-15 waves 3–4 |

**Coordination with CCR-15's in-flight waves.** CCR-15's contract cites `shared/api.ts` by line (R9). Wave 1
inserts into that file while CCR-15 waves 3 and 4 are unmerged, so wave 1 places its insertions below the last
line those citations name, or re-points them in the same PR. The plan measures which.

Wave 2 edits `close.ts` and `routes.ts`, which CCR-15 wave 3 also edits, and it needs wave 3's `childReclaim`
port, so it lands after CCR-15 wave 3 merges. Waves 1 and 2 share `groupFleet.ts` and `shared/api.ts`, so they
land one at a time.

## 5. The design, in stages

### 5.1 Stage 1 — the `Released (N)` fold

**The fact comes from the server.** The client sees active runs only, and "released" is a fact about a closed run.
The wire field is named for what it carries: `released` is already a member of `AskState` and of `CLAIM_STATES`
(`shared/api.ts`) with other meanings, so "Released" appears only as the fold's label.

- **The wire field.** `FleetSession.releasedFrom: ReleasedFrom | null` is ADDITIVE, declared in L0 `shared/api.ts`:

  ```ts
  { runId: number; program: string; programTitle: string | null; claimedBy: string | null;
    closedAt: number; child: boolean }
  ```

  `child` is true when the registry's CCR-15 child reading is `marked` or `unreadable`. The PWA needs no second
  read of the marker to skip children (below), and an unreadable marker reads as a child, the direction that
  defers.
  - It is written once, in `assembleFleet`'s literal (`server/src/fleet.ts`).
  - It has ONE reader: an L0 accessor, `releasedFromOf(s)`, returning `s.releasedFrom ?? null`. This matters
    because the PWA's live `fleet` frame is cast, not revived, so an older server's row carries no key at all,
    and `undefined` must read exactly as `null`. `reviveFleetSession` (the state cache and the PWA's offline
    snapshot) reads the field through a structured reviver.
  - The precedent is `boardProject` (board-placement wave 1, Task 3; wave 2 added its failure arm and
    `boardHome`).
  - `null` means "not released", and the row renders exactly as it does today.
- **The decision is one pure L1 function**, `releasedFrom(input)`, in a new file beside `placement.ts`. It is
  non-null only when ALL of these hold:
  - `workspace !== null`;
  - `held === null`;
  - `archivedAt === null`;
  - the session's newest run as `sessionId` is terminal;
  - no non-terminal run names the session as `sessionId`;
  - no non-terminal run names the session as `claimedBy`. A former worker that now coordinates is not released.

  An unreadable store answers `null`: doubt leaves the row where it is today.
- **One batched read per tick.** `coordPlacementStamps` cannot answer this: it filters to
  `coordProject IS NOT NULL` and carries no state. `openRunsForSession` is per-session and reserved for destructive
  decision points. So the store gains one grouped statement, `lastRunBySession()`. It returns, per `sessionId`, the
  newest run's id, state, program, title, claimant and `closedAt`, and whether any non-terminal run names the
  session, together with the set of claimants of non-terminal runs. It is called once per assembly beside
  `readCoordPlacements`, under the same failure contract: a throw or `ok:false` makes every row's `releasedFrom`
  `null`.
- **The fold.** `groupFleet` gains `FleetGroup.released: FleetSession[]`, split beside the archived split.
  - A row is FOLDED when `releasedFromOf(s) !== null` and its bucket is none of `archived`, `attention` or
    `working`, and it carries no strand marker.
  - Attention, work in progress and a strand are never folded, because a fold "can never hide" them
    (`groupFleet.ts`'s governing principle, and the reason its `stranded` count exists). Those rows stay at the top
    level, released or not, and fold on the first frame where none of those holds.
  - Folded rows take no part in `busy` (they are not working) or `pin`. They still count toward `unseen`.
  - `ProjectCard.tsx` renders the fold before the `Archived (N)` block, under the key `<project>::released`,
    inverted to start closed like `::archived` (`FleetScreen.tsx`'s call site).
  - Inside, rows sit under a sub-heading per `releasedFrom.program`, with the title when known. Groups and the rows
    within them run newest `closedAt` first. Each row is a `SessionLine` and opens as today.
- **"Archive all (N)"**, inside the expanded fold, behind one confirm.
  - It sends a PLAIN archive for each row, one at a time: never `interrupt`, never `programme`, never `force`.
  - It skips rows whose `releasedFrom.child` is true. Those are CCR-15's, and they leave on their own once CCR-15
    wave 4 is deployed; CCR-15 §5.9 assumes a child is never archived.
  - Before each row it re-reads that row from the current frame, and skips it if it is no longer folded.
  - A row the server refuses (busy, a coordinator, or anything else) is left in place. One summary toast reports
    how many were archived, skipped and refused, with each refusal's reason.
  - In wave 1 the door is today's (`force:false`), so a busy refusal arrives as today's generic 502 and is
    reported as "refused". Wave 2 gives it its typed reason.
  - This is how the 14 unmarked children leave the fold, and stage 3 cleans them up 7 days later.
- **Placement is unchanged.** A released worker renders on its own card, because board placement's lifetime is
  the hold. Grouping by programme inside the fold is the bundling the operator asked for.

### 5.2 Stage 2 — one "Archive"

**What the operator sees.**
- Every session's menu and actions sheet offers **Archive**. The header's "Stop session" overflow item, its
  `QuickConfirm` and `SessionScreen.tsx`'s `stopSession` are removed. The header's "Stop" keycap is a different
  control: it interrupts the current turn (`api.interrupt`), and it stays.
- "Stop only" survives in exactly one place: the actions sheet offers it after an archive REFUSAL the operator
  cannot fix from the phone (worktree gone, status unreadable, manifest not buildable), so no live session is ever
  left without a way to put it down.
- `ccd stop` and `POST /api/sessions/:id/stop` are unchanged.
- The confirm reads by case:
  - An idle workspace: "Archive this workspace? It goes offline and folds into Archived. Restore brings it back."
    Wave 3 adds "…for 7 days; after that it is cleaned up" when `ws-expire` ships. Wave 2's copy promises nothing
    it does not do.
  - Busy (either kind): "It's working. Archive anyway? The turn in progress is lost."
  - A main checkout: "Archive this session? It goes offline and folds into Archived. Restore starts it again. It is
    never deleted."
  - A coordinator with open runs (L5): "It has N open runs. End its programme too? Its workers will be cleaned
    up." The only choices are **End programme and archive**, or **Cancel**. The sheet says that pausing a
    programme is the coordinator pause switch (Runs screen), not archiving its coordinator. The reason: a delivery
    to an archived recipient backs off and parks (D-1066, `watch.ts`'s mail sweep), so an archived coordinator
    cannot keep a programme alive (§11 item 1).
- **Restore** appears on every row in the Archived fold. A single L0 predicate, `inArchivedFold(s)`, answers for
  both kinds of row; the gate is never keyed on `archivedAt` or `workspace` alone. For a workspace, Restore calls
  `POST /api/sessions/:id/restore` (`ws-restore`). For a main checkout it calls `POST /api/sessions/:id/ensure`:
  `cmd_ensure` clears the stop stamp on the attempt, and the row's own registry fields (wrapper, `rc`, project)
  decide the respawn, exactly as Revive does today.

**The server's one door.** `POST /api/sessions/:id/archive` (`server.ts`) takes
`{ force?, interrupt?, programme?: 'end' }`. EVERY check that can refuse runs before ANY act that cannot be
undone.

1. **Measure, refuse nothing irreversible yet.**
   - The id is safe and known.
   - The row is read.
   - Busy is read from the same live state the fleet frame uses: `status`/`hookState`, re-read on the request, for
     both kinds of row. Without `interrupt:true`, a busy row refuses `409 session-busy`.
   - For a workspace, the worktree is present and `ws-archive`'s verb is supported.
   - The `run-open` check on the session as a WORKER runs as today, with its `force` bypass.
   - The `claimedBy` check: if the session is the claimant of any non-terminal run, the door refuses
     `409 coordinator-has-open-runs` with those runs unless `programme:'end'`.
   - An unreadable store refuses with `runs: []`, fail-shut.
2. **Then act, in this order.**
   - (a) With `programme:'end'`, each run is abandoned through `closeRun`'s abandon arm (`intent:'abandon'`,
     `causedBy:'operator'`), on the coordination serialiser, with CCR-15 wave 3's `childReclaim` port wired exactly
     as the abandon route wires it. If any abandon refuses (for example a run in `closing`, which the abandon arm
     cannot move), the door stops. It answers `409 programme-partly-ended` with which runs closed and which did
     not, and it stops or archives nothing.
   - (b) With `interrupt:true`, or for a main checkout, it runs the stop argv `/stop` already builds:
     `CCD_ARGV.stopId(id, surface)` or `stopPair`, with `--surface` only where ccd's capability allows it.
   - (c) For a workspace, it runs `ws-archive`. A `session-busy` from ccd (a race after the live read) maps to
     `409 session-busy`.
3. **Partial outcome.** If (b) succeeded and (c) refused, the door answers `200 { archived: false, stopped: true,
   refusal }`. The row is then a stopped, unarchived workspace. It stays visible at the top level with its reason
   and offers Archive again, and "Stop only" is moot. Nothing is hidden, nothing is lost.
4. **Main checkout.** A main checkout is never passed to `ws-archive`, and nothing writes `.archived` for one. So
   every reap and expiry path is structurally away from it, and `ws-expire` rung 1 refuses `not-a-workspace` as
   well.

**Refusal codes** (`session-busy`, `coordinator-has-open-runs`, `programme-partly-ended`, and the existing
`run-open`, which is a bare literal written twice today) are declared once, in an L0 `ARCHIVE_REFUSALS` const.
Server and PWA read that const, and a test pins it.

**The census.** With `programme:'end'`, the archive route becomes a coordination write, session-gated with no box
token, like the abandon door (D-282). It is added to the box-token census the way CLAUDE.md records the kickoff
route. That route is registered in `server.ts`, where `coord-pause-route.test.ts` cannot see it, so the plan adds
the census entry that can.

**The board.**
- The bucket ladder is untouched: M10, and `fleet-lifecycle.test.ts`'s "a stopped row is still `dead`/`dead`".
- The Archived fold's split (`groupFleet.ts`) changes from `bucket === 'archived'` to `inArchivedFold(s)`, which is:
  - `bucket === 'archived'`, or
  - `workspace === null`, `status === 'dead'` and `stoppedBy !== null`.

  The fold sorts on `bucketSince`, or on `stoppedBy.at` for a main checkout.
- A started main checkout leaves the fold, because `cmd_start` and `cmd_ensure` remove the stop stamp on the
  attempt.
- The fleet footer's `/archive` route reads `archivedAt` and stays a WORKSPACE archive list; a main checkout does
  not appear there. The bucket bar's `dead` count still includes a stopped main checkout. Both are stated, not
  changed.
- The PWA text pinned by tests moves:
  - `header.test.tsx`'s "Stop session" menu cases become Archive cases; the keycap cases stay.
  - `SessionActionsSheet`'s archive and restore gates move to `inArchivedFold` and every-session Archive.
  - The fleet screen's section vocabulary pin.

**The pane's scope.** Archive, like stop, kills the tmux session. Processes that detached from the pane survive in
its scope (session-continuity §1.3). Session-continuity wave 9 covers every verb that ends a pane, archive and
stop included. This spec adds nothing there and states the dependency.

### 5.3 Stage 3 — archived workspaces expire after 7 days (`ws-expire`)

**The verb.** `ccd ws-expire --expect <token> --session <id>`, minted by `ws-audit --expire`. It is a SIBLING of
CCR-15 wave 3's `ws-reclaim`, not a flag on it: wave 3's rung 2 (the `.child` marker) has "no override
anywhere", and its argument that a population-widening flag becomes an override applies unchanged.

It shares wave 3's machinery (the ladder's generic rungs, the pin phase, the tail, the `$REG/.reap-<id>.lock`) and
has its OWN vocabulary everywhere wave 3's is child-keyed:
- the breadcrumb flavour `expire:`, whose resume arm re-asserts the archive epoch;
- the journal act word `expire`, added to ccd's `_LC_ACTS` and to every declaration that must agree with it (CCR-15's contract names three declarations and four cardinals for that vocabulary);
- the tombstone kind;
- the mirror refusal sentences;
- the feed row;
- the attention entries;
- the capability token `expire-v1`, the `CcdArgv` builder and the `REQUIRED_VERB_FLAG` enrolment with its negative
  type fixture.

`ws-reap`'s resume fork gains an `expire:` arm. That is a second addition where wave 3 recorded "exactly ONE
addition" (§6). A return during an expiry must refuse. `ws-restore` already refuses a workspace another ccd
process is reaping (its lock check in `cmd_ws_restore`). The plan measures which other spawn paths (`_spawn_start`'s
callers) honour reap's `reaping` breadcrumb, and gives every one of them the same refusal for `expire:`.

**The ladder.**
- **Rung 1**, wave 3's: `no-such-session`; `not-a-workspace` for a main checkout.
- **Rung 2′**, replacing the child rung.
  - `.archived` is present, and its epoch is at most `now − WS_EXPIRE_AFTER_S` (604 800).
  - The token's input includes that epoch, so any return and re-archive refuses `state-changed`.
  - A `.child` marker that reads as a child, or cannot be read, refuses `child` (retryable). That follows CCR-15
    R29's direction: an unreadable marker defers.
- **Then wave 3's generic rungs, in wave 3's order.** `paused`; `held`; `attached`; the identity refusal
  `no-worktree-record` (terminal); the vanished-worktree arm; `tree-busy`; `branch-elsewhere`; `tree-unreadable`;
  `containment-unproven`; the fingerprint.
- **The `unmeasured` non-token arm**, as wave 3's.
- **`--defer-expired` does not exist for `ws-expire`.** Rungs `attached` and `tree-busy` are never skipped.

**What it keeps and deletes.** It keeps git state: dirty tracked and unignored untracked work is committed on the
branch, and every commit, stash and operation head is pinned under ccd's attic, `refs/ccrc/attic/<id>/`, which
`ccd ws-attic` reads. The reflog pin cap is wave 3's (200). It keeps the transcripts, whose roots are outside the
worktree. It deletes:
- the worktree;
- the branch ref, after the pin;
- git-ignored files and secret-shaped files, recording their paths and sizes;
- `~/.cc-clips/<id>`, recording its paths;
- the registry row.

This is not the 2026-09-23 manual procedure, which tarred ignored files and refused dirty trees. The operator
accepted the difference (§2).

**The lane.** CCR-15 wave 4's `sweepChildReclaim` pass hosts a second population. It shares the pass's registry
read, its cadence (`CHILD_RECLAIM_SWEEP_MS`) and the switch, and nothing else. It has:
- its own L1 verdict, `archivedExpiryVerdict`, in its own file;
- its own entry map and clocks. Wave 5's chip reads the child lane's defer map, and it must never see an expiry
  entry;
- its own executor call, feed rows and attention entries.

A row is eligible when:
- it is a workspace with `.archived`, epoch at least 7 days old;
- its child reading is `none` (a `marked` or `unreadable` child is the child lane's);
- no non-terminal run names it as `sessionId` or as `claimedBy`. An unreadable store makes it ineligible;
- it is not the `sessionId` of a review run whose reviewed run is non-terminal. This is CCR-15 R16's rule
  applied to unmarked reviewers, because the report lives in that workspace's clips;
- it has no hold;
- the switch is down, and all of the above held on the previous pass too.

Presence defers WITHOUT a ceiling. Rule 4's 15-minute ceiling exists only because a child is nobody's.

**An archived workspace that is still held after 7 days** is not acted on. It goes on the attention list. A close
that archives on `archive:true` leaves the hold standing, so these are real, not hypothetical.

**The switch.** CCR-15 defines `reclaim-paused` as stopping child reclamation "and nothing else". It becomes the
fleet's single CLEANUP switch, stopping child reclamation, `ws-expire` and the stage-4 lane, with its Runs-banner
row relabelled. One toggle is what the operator reaches for. The route's exemption argument (a kill-switch with no
box token) holds unchanged for a wider switch. This amends CCR-15's text (§6).

**The contracts that move.**
- CLAUDE.md's SAFETY list gains `ws-expire` among the verbs no agent runs against the live host. "`ws-reap` is
  human-only by contract" stays literally true. A new sentence says `ws-expire` is the server's, on archived
  workspaces 7 days after their archive.
- The skill corpora do NOT name `ws-expire`. That is CCR-15 wave 3's ruling for the server-composed `ws-reclaim`,
  and the same argument applies.
- One skill sentence becomes false and moves. Wave 3 rewrites coordinator clause 3 to end "this session's own
  workspace is cleaned up by a human, never by a sweep". After stage 3, an archived coordinator workspace is
  expired by the server 7 days after its archive. The clause's last sentence becomes "…cleaned up by a human, or by
  the server seven days after it is archived". The verbatim pin moves in the same commit.
- README's workspace-lifecycle section and `wave-lifecycle.md` §6 say what now happens after 7 days.

### 5.4 Stage 4 — the dead-coordinator lane (L4)

**The verdict is widened, not re-derived.** `measureClaimant` returns `{state, why}`, and the lifecycle word lives
only in the prose `why`. `reclaim.ts`'s own D-1145 note says the THIRD consumer needing the fold split must widen
the type instead of re-splitting by hand. This lane is that consumer: `ClaimantVerdict`'s `dead` arm gains
`cause: 'absent' | 'stopped' | 'orphan' | 'never-started'`. The reclaim door ignores it.

**A crash, and only a crash.** A claimant is crashed for this lane when:
- its verdict is `dead` with cause `orphan`, `never-started` or `absent`; AND
- the lifecycle journal mirror shows NO deliberate act for that id since its last successful start: `stop`, an
  `unsupervise` with a declared surface, `archive`, `reap`, `destroy`, `purge` or `forget` (ccd's `_LC_ACTS`), or
  CCR-15's `reclaim` or this spec's `expire`.

The journal clause matters for two cases.
- A person stopped the session, a later revive failed, and ccd's spawn paths cleared the stop stamp on the
  attempt. The row now reads `orphan`, but it was put down on purpose.
- The row was removed on purpose (expired, reaped, forgotten). `_reg_purge` cannot reach the journal, so the
  record survives the row.

An absent row with no journal history at all is `unmeasured`: it is listed, never acted on. `stopped` is never a
crash (L4). `restarting` is alive: systemd restarts a crashed unit after `RestartSec=3`, and the new supervisor
stamps `supervised` before respawning. `unmeasurable` is never dead.

**The hour is the lane's own observation, made durable.**
- The first pass that measures a claimant crashed writes `firstDeadAt` to a small `coord.db` table keyed by the
  claimant id. The table survives restarts.
- Any `alive`, `unmeasurable` or non-crash answer deletes the row.
- `.supervised`'s epoch is NOT the anchor. It freezes whenever a session runs `unsupervised`, for example a unit
  crash-looped to FAILED under `KillMode=process`, a pre-fix pane or a `darwin` bootout. A pane that dies later
  would read `orphan` with a days-old stamp. The stamp may only raise the anchor, never lower it:
  `max(firstDeadAt, stamp)`. An absent, unparseable or future stamp is ignored.
- The lane acts when `now − firstDeadAt ≥ 1 hour` and the two latest passes both measured the claimant crashed.

**A circuit breaker for correlated death.** A box-level fault (the user manager lost across a reboot, a tmux server
death, a bad ccd) makes every coordinator read dead at once, and that is evidence of a fleet fault, not of N
crashes. The rule:
- when 2 or more claimants are first measured crashed within 10 minutes of each other, or the registry read or
  tmux is `unmeasurable` fleet-wide on that pass, the lane acts on NONE of them;
- it raises one attention item naming them, and it resumes only when the operator clears it or the claimants fall
  back under the threshold;
- a test goes red if the breaker is deleted.

**No successor.** The only evidence is the re-read, because a reclaim is atomic and leaves no pending record. The
lane runs on the coordination serialiser (exported from `registerCoordRoutes`, the one wave 2 uses). So the
reclaim door, which runs inside that serialiser, can never interleave with it. The race that remains is a revive,
`ccd ensure` on the same id, which takes no mutex. So immediately before EACH run's close, the lane re-measures the
claimant, and the store transaction commits only while `claimedBy` still equals the crashed id (compare-and-set).
An `alive` answer at any point ends the whole act.

**The act.** For each non-terminal run whose `claimedBy` is the crashed id, the lane runs `closeRun`'s abandon arm:
- with `causedBy: 'sweep'`, a third attribution word beside `'coordinator' | 'operator'`, so the run event, the
  feed row and the audit never read as the operator's act;
- with CCR-15 wave 3's `childReclaim` port wired as the abandon route wires it. Wave 3 hands a child to the reclaim
  executor only through that optional port.

A run the abandon arm cannot move is listed in the attention item with the crashed id and is not retried beyond the
lane's backoff. The abandon arm aims every non-planned work run at `closing`, so a run already `closing`, or one in
`unknown` (no edges), refuses. One feed row per ended programme reads: "coordinator `<id>` crashed and stayed dead
an hour; programme `<slug>` ended, `<n>` runs closed failed".

**What follows, stated so nobody is surprised.**
- The programme retires as `abandoned`, permanently.
- Outstanding deliveries naming those runs are cancelled.
- The slug stays fenced to the crashed id until someone reclaims it.
- CCR-15 wave 3 reclaims each marked child whose run closed. That includes a worker mid-turn: its work is committed
  and pinned, and its turn is lost (L4).
- An unmarked worker is only released, so it moves into the `Released` fold.

**Cost.** The lane measures only the distinct claimants of non-terminal runs, a handful, at the child lane's
60-second cadence. Each measurement is a registry listing, about 27 field reads and one tmux call, which is an
agent frame in remote mode.

## 6. What this changes outside itself

- **Wire.** Stage 1 adds `FleetSession.releasedFrom` and `ReleasedFrom`. Stage 2 adds `ARCHIVE_REFUSALS` and three
  refusal codes. There is no `FLEET_PROTO` bump.
- **CCR-15 texts this spec amends.** Each is amended when this spec's wave lands, after the CCR-15 wave that wrote
  it has merged:
  1. `reclaim-paused` "and nothing else" becomes the cleanup switch (§5.3).
  2. Coordinator clause 3's closing sentence (§5.3).
  3. Spec §5.9 "No child ever appears in the reap or archive sheets". A person may now archive a child by hand, and
     "Archive all" skips children (§5.1).
  4. Wave 3's "exactly ONE addition" to `ws-reap`'s resume fork: the `expire:` arm is a second (§5.3).
  5. `closeRun`'s `causedBy` vocabulary gains `'sweep'` (§5.4).
  6. Wave 4's lane gains a second population (§5.3).
  7. The contract's `shared/api.ts` line citations (R9), which waves 1 and 2 must place below or re-point (§4).
- **CLAUDE.md** (§5.3), and its box-token census for the archive route (§5.2).
- **Landing-order.** Its stage 5 keys landing entries and intents to runs, and stage 4's lane can fail such a run.
  The landing plan must treat a `sweep`-failed run as it treats an operator abandon. This is recorded there as a
  carried constraint.

## 7. What is not done

- No automatic archive of anything. Released rows are archived by the operator ("Archive all") or reclaimed by
  CCR-15.
- No backfill of CCR-15's marker onto the 14 pre-policy children.
- No change to board placement's lifetime.
- No change to the bucket ladder (M10).
- No new `SessionLifecycle` word.
- No "keep the programme" archive of a coordinator. Pausing a programme is the coordinator pause switch (§11
  item 1).

## 8. Failure modes named

- **A released worker that needs the operator is folded away.** Attention, working and stranded rows are never
  folded (§5.1).
- **A former worker now coordinating is folded as released.** `releasedFrom` excludes any claimant of a
  non-terminal run (§5.1).
- **An older server's row reads as released.** The single accessor turns `undefined` into `null` (§5.1).
- **Archiving a coordinator ends a programme the operator meant to pause.** Only with an explicit
  `programme:'end'`. There is no keep, and pausing is the pause switch (§5.2).
- **Ending a programme succeeds, then the archive refuses.** Every refusable check runs first. A partly ended
  programme stops the door before any stop or archive (§5.2).
- **A busy archive loses a turn.** Only after the busy confirm, which alone sends `interrupt:true`.
- **The stop succeeds and the archive refuses.** The row stays visible, stopped, with its reason and Archive again
  (§5.2).
- **A main checkout is deleted.** Structurally impossible. Nothing writes `.archived` for one, and `ws-expire`'s
  rung 1 refuses it.
- **An archived workspace someone is reading is expired.** Presence defers with no ceiling (§5.3).
- **A workspace brought back and archived again is expired on its first week.** The token binds the archive epoch,
  and spawn clears `.archived` (§5.3).
- **An archived coordinator is expired, and its missing row reads as a crash.** Expiry excludes any claimant of a
  non-terminal run, and the journal clause makes a deliberate removal never a crash (§5.3, §5.4).
- **A coordinator being revived is declared dead.** `restarting` is alive. The hour is the lane's own durable
  observation, and two passes are needed (§5.4).
- **A coordinator the operator stopped, whose revive then failed, is declared crashed.** The journal clause
  (§5.4).
- **Every coordinator reads dead at once after a box fault.** The circuit breaker (§5.4).
- **The lane fails a run a revive just brought back.** Re-measure before each close, plus the compare-and-set
  (§5.4).
- **The lane loops on a run it cannot abandon.** It goes to attention, bounded (§5.4).

## 9. Measurement, targets and the kill rule

Committed with the plan: `deploy/measure-workspace-lifecycle.py`, read-only, run on the fleet box and the server
box. Its rows:

| Row | Baseline (2026-09-24) | Target |
|---|---|---|
| released workspaces at the top level of a card, excluding attention, working and stranded | 29 of 56 rows | 0 |
| archived workspaces older than 7 days, not held | 0 (oldest 4.7 days) | 0 one lane pass after the 7th day |
| archived workspaces older than 7 days and held | measured | listed in attention |
| archive → return delay (restore, start, ensure, swap) over the journal's horizon | measured before stage 3 ships | none later than 7 days; otherwise the operator sees it first (§3) |
| manual archives per day | measured from the journal | falls after waves 1–3 |
| programmes ended by the stage-4 lane; breaker trips; later reclaims of their slugs | — | reported, each with its first-dead time |

**Kill rule for stage 3.** A return of a workspace whose archive is between 6 and 7 days old, seen twice in a
week, means 7 days is too short. Raise `WS_EXPIRE_AFTER_S` before anything else. The attic keeps every expired
workspace's commits in the meantime.

## 10. Sequencing

1. **Wave 1** is independent of CCR-15's code and dispatches now. It respects CCR-15's `shared/api.ts` citations
   (§4).
2. **CCR-15 waves 3 and 4** run as their own programme. L6: wave 4 dispatches the moment wave 3 merges.
3. **Wave 2** dispatches once CCR-15 wave 3 has merged (its close-path port and shared files).
4. **Wave 3** is planned against CCR-15 wave 4's merged lane. It dispatches once CCR-15 wave 4 is deployed and §9's
   return-delay row has been measured.
5. **Wave 4** lands after wave 3 (the same lane file), and after wave 2 (the serialiser and the L5 door).

## 11. For the operator to confirm

The rulings stand as given. Two consequences of them surfaced in review:

1. **L5's "No" is "Cancel", not "archive anyway".** A delivery to an archived recipient backs off and parks
   (D-1066), so an archived coordinator cannot keep its programme running. Its workers' reports would park unread.
   So archiving a coordinator with open runs offers only "End programme and archive" or "Cancel", and a programme
   is paused with the existing coordinator pause switch.
2. **Every workspace archive starts the 7-day clock.** After L2 there is no way to put a workspace down that is not
   an archive, so a "stop for now" to free memory also becomes a deletion in 7 days unless it is brought back.
   Main checkouts are unaffected.
