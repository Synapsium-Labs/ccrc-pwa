# Workspace lifecycle — released, archived, expired — design

**Status:** the operator ruled every decision in dialogue on 2026-09-24 (§2), and **approved this spec on 2026-09-26**,
confirming both consequences in §11. Wave 1 is planned
(`docs/superpowers/plans/2026-09-26-workspace-lifecycle-wave1-released-fold.md`); the programme ledger is
`docs/superpowers/programs/workspace-lifecycle.md`.
- **Rev 2** applies a four-lens adversarial review: 51 findings, 43 confirmed, 7 partly confirmed, 1 refuted. Every
  surviving finding is applied here.
- **Two consequences** of the rulings were stated for the operator to confirm (§11), and confirmed on 2026-09-26.
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

  `child` is true when the registry's CCR-15 child reading (`FleetSession.child`, a `ChildMark`) is `child` or
  `unreadable`. The PWA needs no second
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
  decision points. So the store gains one grouped read, `lastRunBySession(sessionIds)`, scoped to the assembly's
  session ids (`currentAsksFor`'s shape). It returns, per `sessionId`, the
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
  cannot fix from the phone (worktree gone, status unreadable, manifest not buildable, a coordination store the
  server cannot read, a programme it cannot end, or a fleet box whose `ccd` has no `ws-archive`), so no live
  session is ever left without a way to put it down. That holds while tmux can be asked. Under a substrate fault
  (tmux unreachable) the button is disabled, with the fault's title, as "Restart session" already is, because a stop
  POSTed at a pane nobody can measure during an outage is a stop on a guess (3870). The gate lifts with the fault, so
  an outage defers the way to put the session down and never removes it.
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
  decide the respawn, exactly as Revive does today. For a main checkout that is the same `/ensure` that "Restart
  session" calls, so it is disabled with the fault's title under a substrate fault, in the actions sheet (3868) and in
  the session header's menu (3869) alike. A workspace's Restore (`ws-restore`) is not that path and is not gated. A
  merged-and-archived workspace (the `cleanup` bucket) stays in the live list its chip counts and offers Restore too,
  as it does today; the session header's menu offers Restore in Archive's place on the same rows.

**The server's one door.** `POST /api/sessions/:id/archive` (`server.ts`) takes
`{ force?, interrupt?, programme?: 'end' }`. EVERY check that can refuse runs before ANY act that cannot be
undone.

1. **Measure, refuse nothing irreversible yet.**
   - The id is safe and known. A registry that cannot be listed refuses `503 registry-unmeasurable`, never
     `404 unknown-session`.
   - The row is read.
   - Busy is read from the same live state the fleet frame uses: `status`/`hookState`, re-read on the request, for
     both kinds of row. Without `interrupt:true`, a busy row refuses `409 session-busy`. Busy is one L0 predicate,
     `archiveInterrupts`: a live `busy`, or a bucket of `working` or `attention` (a question waiting is a turn in
     progress). A live `busy` counts even where the hook says the turn finished, since `ws-archive` refuses on it.
     A main checkout's stop refuses nothing, so its busy is read fail-closed, by `_ws_status`'s own rule (the
     server's `stopVerdict`): a wrapper with no config dir is unmeasured, whatever the pane; no pane is idle; a live
     pane is idle only when its live file reads `idle` and the predicate is false. A measured busy refuses
     `409 session-busy` (`interrupt:true` lets it proceed). Whatever could not be read is not busy but unmeasured,
     and refuses `409 status-unknown` whatever the consents (3881): no config dir, tmux `unknown`, an unread pane
     pid, an absent or unreadable live file, a status word `_ws_status` could not extract, and the server's own two
     stricter arms: a missing frame row, and a live file that is present but malformed (not JSON, or no string
     `sessionId`), from which ccd's grep may still read a word. The word is read from the PARSED file, and a `status`
     that is not a string is no word; a file that is not compact JSON (`"status": "idle"`) still diverges from ccd's
     grep, which no observed writer produces. Without `interrupt:true` it is re-read at the stop, so a turn begun during
     the claim reads or the programme end refuses `409 session-busy` (or `status-unknown`, if the state became
     unreadable), naming any runs already ended.
     The same fail-closed read applies to a workspace whenever `programme:'end'` or `interrupt:true` is set: the end
     cannot be undone, and a stop that `interrupt:true` sends runs before `ws-archive`'s own status read could refuse
     it. A measured busy refuses `409 session-busy` unless `interrupt:true`, and one the server could not measure
     refuses `409 status-unknown`, before anything ends or is stopped (3877, 3881). Every other workspace archive,
     with neither, keeps the frame's row, with `ws-archive`'s status read behind it.
   - For a workspace, the worktree is not PROVEN gone, and `ws-archive`'s verb is supported. The server box can
     read a worktree only in local mode: in remote mode the fleet agent's read roots exclude `~/worktrees`, so an
     unmeasured worktree is left to `ws-archive`'s own refusal, which precedes its act.
   - The `run-open` check on the session as a WORKER runs as today, with its `force` bypass.
   - The `claimedBy` check: if the session is the claimant of any non-terminal run, the door refuses
     `409 coordinator-has-open-runs` with those runs unless `programme:'end'`.
   - An unreadable store refuses with `runs: []`, fail-shut, and the refusal carries the store's own `detail`.
2. **Then act, in this order.**
   - (a) With `programme:'end'`, each run is abandoned through `closeRun`'s abandon arm (`intent:'abandon'`,
     `causedBy:'operator'`), on the coordination serialiser, with CCR-15 wave 3's `childReclaim` port wired exactly
     as the abandon route wires it. Before the first abandon, every run is asked what that arm would refuse from
     its row alone (for example a run in `closing`, which the abandon arm cannot move); such a run stops the door
     with nothing ended. If an abandon still refuses at the act, or fails, the door stops there. Either way it
     answers `409 programme-partly-ended` with which runs closed and which did not, and it stops or archives
     nothing.
   - (b) With `interrupt:true`, or for a main checkout, it runs the stop argv `/stop` already builds:
     `CCD_ARGV.stopId(id, surface)` or `stopPair`, with `--surface` only where ccd's capability allows it.
   - (c) For a workspace, it runs `ws-archive`. A `session-busy` from ccd (a race after the live read) maps to
     `409 session-busy`. `ws-archive` answering `already archived` over a pane tmux still proves up stops that pane
     with `/stop`'s argv, only when the turn, re-read at the act, is idle, and answers `stopped: true`; a pane gone, or one tmux cannot be asked about, answers as before.
3. **Partial outcome.** If (b) succeeded and (c) refused, the door answers `200 { archived: false, stopped: true,
   refusal }`. The row is then a stopped, unarchived workspace. It stays visible at the top level with its reason
   and offers Archive again, and "Stop only" is moot. Nothing is hidden, nothing is lost. Any refusal or failure
   that follows (a) carries the runs (a) ended, as `ended`, and the sheet says so before the refusal.
4. **Main checkout.** A main checkout is never passed to `ws-archive`, and nothing writes `.archived` for one. So
   every reap and expiry path is structurally away from it, and `ws-expire` rung 1 refuses `not-a-workspace` as
   well.

**Refusal codes** (`session-busy`, `coordinator-has-open-runs`, `programme-partly-ended`, and the existing
`run-open`, a bare literal written twice in `server.ts` and once in the PWA today) are declared once, in an L0
`ARCHIVE_REFUSALS` const. So are the three refusals "Stop only" answers, `worktree-gone`, `status-unknown` and
`manifest-unbuildable`: `ws-archive`'s own, read off its `die` lines. The server issues two of them itself:
`status-unknown` where its fail-closed read (step 1) could not measure the turn, and `worktree-gone` where it
proves the worktree absent. Server and PWA read that const, and a test pins it.

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

**The lane.** A sibling of CCR-15 wave 4's `sweepChildReclaim` pass, on the same tick, never a population inside it
(wave 3b's sibling pass). It shares the pass's registry read, its cadence (`CHILD_RECLAIM_SWEEP_MS`) and the switch,
and nothing else. It has:
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

**As wave 3 builds the verb** (amended with its plan, `docs/superpowers/plans/2026-10-04-workspace-lifecycle-wave3-ws-expire.md`;
each item is a departure named there). Wave 3 ships `ws-expire` and only what lets the server compose it — the
`CcdArgv` builders, `expire-v1`, the grant and its enrolment. The lane, the switch's wider label, coordinator clause 3
and the README and `wave-lifecycle.md` §6 text above are wave 3b's, planned after it merges.
- **Rung 5 asks more of an expiry.** A DETACHED live pane, or a unit that is running, refuses `live` (retryable): an
  archived workspace has had no pane since its archive (§3 item 2), and `attached` and `tree-busy` alone let both
  through, measured. The question is keyed on the token's binding, not on a flavour a caller could forget; on Darwin a
  `failed` unit answer that comes from ccd's own stamp is re-asked of launchd, as the reclaim tail re-asks it; and an
  interrupted expiry's resume asks it again when it resumes at `children`, or at `branch` when the tombstone records the
  worktree absent (the vanished-worktree arm's first phase), before that attempt's tail stops anything (3963).
  `ws-reclaim` is never asked this. It also refuses `in-use` (retryable) when any process's working directory is the
  worktree or lies under it — a shell an operator opened there by hand, say (3962) — fresh, and at the resume
  wherever presence is asked again (`children`, and `branch` on the vanished-worktree arm, where the worktree is absent
  and the question is vacuously clear), and at `worktree`, where the tree may still stand and this is the one question
  asked (3964). A process is skipped only on proof it vanished (its cwd link or stat file is gone, or
  `ps` could not name its parent and the kernel answers no such process), or when its cwd link answers
  EACCES: so what is not seen is a process of another UNIX user and a same-user non-dumpable one (an `ssh-agent`,
  anything that cleared its dumpable flag, a setuid or setgid exec) — refusing on those would wedge every expiry while
  an ssh-agent runs. Anything else that goes wrong (a process list that cannot be read, a `ps` that is missing) is
  unmeasured, retried — Darwin's `lsof` listing too when it outruns its 20-second bound
  (`WS_EXPIRE_LSOF_DEADLINE_S`), even one that already listed ccd and a process in the worktree. The bound's stated
  limit: a process in uninterruptible kernel wait survives TERM and KILL, so `lsof` can hold the reap lock past it.
- **Rung 2′'s words.** `not-archived` (no stamp), `not-expired` (younger than `WS_EXPIRE_AFTER_S`, a future stamp
  included) and `child`; a stamp that is not an epoch ccd writes is unmeasured, never old.
- **`ws-reap`'s `expire:` arm refuses** (`expire-in-progress`), the twin of its `reclaim:` mirror. The arm that RESUMES
  an interrupted expiry and re-asserts the archive epoch is `ws-expire`'s own. `ws-expire` refuses a row
  with a child marker, so an `expire:` breadcrumb stands only on an unmarked row; `ws-reclaim`, which runs only on
  children, never meets one in practice, and answers it `reap-in-progress` wherever it does, as it answers every
  breadcrumb not its own. A `.reaping` that stands on an ARCHIVED row but cannot be read refuses `reaping-phase-unknown`
  instead of falling through to the fresh arm, as the spawn gate and `ws-expire`'s fork already read such a file.
- **A return during an expiry refuses, on every path.** Measured: before this wave no spawn path honoured a breadcrumb,
  and only `ws-restore` took the reap lock. `start`, `ensure` and `swap` now refuse an `expire:` breadcrumb — and, for
  an archived row, a held reap lock — before they journal their act (a refused return must not read as a return to
  §9's instrument), and so does `enable`, which journals before it reaches `start`; on an archived row a breadcrumb
  that stands but cannot be read refuses too; `ws-restore` refuses `in-progress` under its lock; `_spawn_start`, where every session pane is
  made, holds the same gate as the backstop. One gap remains (3893's residual): the return verbs take the gate and
  release it before their journal line, so an expiry that wins the lock inside that gap leaves the refused return
  journaled as `done`; nothing is lost, and wave 3b closes it before its lane goes live (the coordinator's ruling (a)).
  The lock half refuses whatever holds it: a spawn of an archived row during
  a human `ws-reap` or `ws-restore` of that row refuses too, where it used to race. `ws-add` never mints a row over a
  standing breadcrumb (its slug stays taken).
- **The direct-entry boundary.** `ws-expire` and `ws-audit --session <id> --expire` are protected shapes, as
  `ws-reclaim` and its audit are: the installed launcher starts them under `bash -p`, and the body refuses them
  otherwise.
- **The temp root.** The shared tail removes `~/.cc-tmp/<id>` unrecorded, as it does for a reclaim. Only a child is
  ever given one, and an expiry never touches a row with a child marker, so what stands there was a previous row's
  under a recycled slug — leaked scratch, not this workspace's.
- **The instrument classifies every act.** §9's measurement reads the journal through three lists that place each of
  ccd's acts exactly once: those that return from an archive, those that end one — `expire` and `reclaim` among them,
  a removal and never a return — and a third, `NEUTRAL_ACTS`, for the rest (3887). A test runs ccd's own list, so a
  new act is decided, not silently ignored.
- **Its records.** The tombstone's kind is `"mode":"expire"` with `archivedAt`; the journal carries the epoch as the
  existing `meas.archivedAt`; `ws-audit --expire` prints a document of its own (`session`, `mode`, `archivedAt`,
  `alive`, `exists`, `reaping`, `sensitive`, `resume` when resuming, `verdict`, `detail`, `token` when it mints one).

**As wave 3b builds the lane** (amended with its plan, `docs/superpowers/plans/2026-10-06-workspace-lifecycle-wave3b-expiry-lane.md`;
each item is a departure named there).
- **The words carry the arming condition** (the coordinator's ruling). README, `wave-lifecycle.md` §6 and coordinator
  clause 3 say that an archived workspace is cleaned up seven days after its archive once the operator has armed the
  lane, and that until then the lane only records what it would expire, so they are true before and after the arming.
  The PWA's archive-confirm copy said what an armed fleet does until wave 4 hedged it the same way (review 313,
  parked item 2, the operator's ruling): "Restore brings it back; once automatic cleanup is on, it is cleaned up
  seven days after its archive", and Archive all's "…each is cleaned up seven days after its archive".
- **The lane ships shadowed** (the coordinator's safety ruling, the scope sweep's precedent). Until `$REG/expire-lane-live`
  exists — touched by the operator by hand on the fleet box; nothing in the tree writes it — a due workspace is audited
  and recorded ("would expire", a feed row and an attention entry naming its archive, its expiry instant and how many
  secret-shaped files would be dropped), and `ws-expire` is never composed. `reclaim-paused` stops the lane entirely,
  shadow included. Armed, at most one `ws-expire` is composed per sweep pass, fleet-wide.
- **The threshold is ccd's.** `ws-audit --expire`'s document gains `expiresAt` (`archivedAt + WS_EXPIRE_AFTER_S`), on
  `expirable` and on `not-expired` alike, and `archivedAt` is set on `not-expired` too. The lane reads the instant through
  one reader, audits a row once per archive to learn it, and composes nothing for a document without the key (an older
  ccd). An `in-use` refusal's document also names each process: its pid, its command and its working directory.
- **A sibling pass, not a branch.** The lane runs beside `sweepChildReclaim` on the same tick, cadence and switch, with its
  own memory, verdict, executor, feed rows and attention list, so neither lane's early return silences the other.
- **A return clears the archive inside its gate** (3893's residual, closed before the lane composes the verb): `start`,
  `enable`, `ensure` and `swap` unarchive an archived row while they hold the reap lock, journaled `unarchive` under the
  verb's name, so an expiry that takes the lock next refuses `not-archived`. Holding the lock across the journal instead
  was measured and refused: a supervised start spawns its pane from the unit's own process, which would refuse against it.
- **A standing `in-use` is expected.** It is asked again every pass and, after a few, listed with the pid, its command
  and its path; the text never tells an operator to end a pid without naming what it is (the fleet's own tmux server is
  also a `tmux: server`). The lane never kills.
- **Review 313's residue, closed by wave 4** (each a departure named in the wave-4 plan,
  `docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md`). A learn audit that cannot be
  read, or reads no archive from a ccd that prints the instant, backs off on the failure ladder and is listed (an older
  ccd's audit with no `expiresAt` key reads as no evidence first, never as a failure), and learn slots go in
  `nextAskAt` order; a failure ccd says will not resume is listed at once and never asked again for that archive; an
  ineligible sighting ends the row's would-expire, in-use and held reports and the row is re-audited as soon as it is
  due again, while the verdicts the box itself gave (refused, failing, no evidence) stand on a sighting that is not held;
  a hold replaces a non-final report (a would-expire, an in-use or a retryable failing one) and the row is re-audited as
  soon as it is due again after the release, and a hold never replaces a report whose row the lane has stopped asking; a refusal whose audit names another archive is a row that moved; and the
  held sentence names its instant (`due <instant>`), never a period.
- **The attention list is the lane's own memory.** Child reclamation derives its list from the lifecycle mirror alone; the
  expiry's entries (a shadow `would-expire`, a `held` row past its instant, a standing `in-use`, a refusal, a failure, no
  evidence) are mostly never journaled, so the lane lists them from its own passes and a restart rebuilds the list over
  the next ones, which can delay an expiry and can ask again a row the lane had stopped asking, always behind a fresh
  audit whose token ccd proves again inside its lock (§12).
- **As wave 5 closes the lane's follow-ups** (each a departure named in the wave-5 plan,
  `docs/superpowers/plans/2026-10-08-workspace-lifecycle-wave5-residue-and-expiry-follow-ups.md`).
  - **The consent binds the branch.** Inside its lock `ws-expire` reads the branch three ways at the recompute and
    again at the pin; if the two reads differ (a branch made in between, or, with HEAD not symbolic to `ws/<slug>`
    (detached, on another branch, or with the worktree gone), one deleted) it stops
    there, `failed` `state-changed`, after the pin, which only keeps, and before the tombstone and the breadcrumb.
    With HEAD symbolic to `ws/<slug>`, a branch deleted inside the lock is refused earlier, at the pin, as
    `pin-failed`, before the breadcrumb: resumable on a ccd older than wave 6, audited afresh since (below). A branch already absent when the token was minted reads absent twice and expires
    with its work in the attic. A branch deleted between the fresh pin and the tail's settle is as wave 6 of CCR-15
    left it: its tip was pinned at the fresh pin.
  - **A `failed` `state-changed` is audited afresh.** ccd prints that document only on a fresh expiry, before the
    tombstone and the breadcrumb, so nothing started. As on the reclaim side, "not resumable" means start over, not
    final: the lane forgets the instant it learned and its sightings and returns to learning, so a later pass's audit
    mints a fresh token over what stands, and the row is asked again only once seen eligible twice past its instant. A
    feed row records it, and nothing is listed. `probe-unmeasured` was read as final (and still is from a ccd that prints no `crumb`), but ccd prints it on a
    resumed expiry too, after an earlier attempt's breadcrumb (a tombstone it cannot read, or a tmux probe that did not
    answer), so there it could stop the lane on a part-expired archive until a restart. That was a known gap and an
    arming blocker for the lane; wave 6 closes it with CCR-15 wave 7's `crumb` field (below). Without `crumb` (an older
    ccd), `pin-failed` and `tombstone-unwritable` stay resumable, because the shared tail prints each after the
    breadcrumb too; the `crumb` field is what tells those apart.
  - **A kept leaf is listed.** The `expired` document's `clipsKept` and `tmpRootKept` are read by name. A kept word
    (`refused`, `unmeasured`, `in-use`) lists the archive, though its row is gone, saying what was kept and why, until
    the server restarts. An absent key (an older ccd) is recorded in the feed row as unmeasured and lists nothing, so a
    rollout skew raises no alarm on every expiry.
  - **A day of resumable failures slows the asking.** After 24 hours of `failed` (resumable) or `lock-unopenable`
    answers to the act on one archive, the row moves to a persistent tier. A failure of the act's own audit never
    reaches the persistent tier, only the verb's does: the tier's day and its attempts count the verb's failures
    alone. Its report stands on the list, naming the first failure, the attempts and the last detail, saying the
    expiry may have stopped part-way (the server cannot yet tell), and suggesting no destructive verb. The lane asks
    again four hours after each failed attempt, never stopping. No answer that ends no attempt replaces the entry or resets its run: a
    hold, a deferral, a shadow audit (its feed row then says only that this pass deleted nothing), a refusal the
    box retries, an in-use, ccd's "not yet", an older ccd's silence.
    The entry goes when an attempt completes, finds that none had begun (any failed document ccd marks `crumb: false`,
    or an older ccd's `state-changed`) or stops for good, or when the workspace is archived again; a restart re-learns. A
    terminal refusal and a composition error are still never asked again.
- **As wave 6 closes the lane** (each a departure named in the wave-6 plan,
  `docs/superpowers/plans/2026-10-11-workspace-lifecycle-wave6-resumed-expiry-and-arming-close-out.md`).
  - **`ws-expire` says `crumb`, and the lane reads it first.** Every `failed` document `ws-expire` prints carries
    CCR-15's `crumb`: `false` on a fresh expiry, before its breadcrumb (`probe-unmeasured`, `pin-failed`,
    `state-changed`, `tombstone-unwritable`), `true` on a resumed one (its `probe-unmeasured`, printed while its
    `expire:` breadcrumb stands) and, as before, in the shared tail; a breadcrumb that stands but cannot be read leaves
    it unsaid, as `ws-reclaim` does. The parser reads the word, then `crumb`: `false` is audited afresh, `true` is
    resumed, and an absent or non-boolean `crumb` (an older ccd) falls back to the word rule above, exactly. So a
    resumed expiry's `probe-unmeasured` is retried, never final; a fresh one's, which was final before, is audited
    afresh and counted; and a fresh pin's `pin-failed`, a symbolic HEAD's deleted branch among them, is audited afresh
    rather than resumed. The one document still read final by its word is a `probe-unmeasured` over a breadcrumb that
    turns unreadable between the act's audit and the fork's in-lock read: nothing is deleted, and the row is listed and
    not asked again until the server restarts. A breadcrumb already unreadable at the lane's audit never gets that far,
    and what the lane does with it depends on whether it has learned the row's instant. On a learned row the act's own
    audit answers `unmeasured` (exit 1), read as `audit-failed`: backed off and listed after the hour. On a row not yet
    learned (every row after a server restart, and any but a stuck one after a `restart` answer), `learnExpiry` meets it
    first and lists it at once as a non-final `failing` ("its expiry could not be learned"). Neither is final, and nothing is deleted.
  - **`containment-refuted` is stuck.** The shared tail prints it, past the breadcrumb, when its removal-time re-ask
    proves that what it would remove is not only this workspace's own. Whatever `crumb` says, the row is listed at
    once, saying the expiry stopped part-way and nothing further was deleted, and goes straight to the persistent
    tier. The entry outranks a failing one and stands until an attempt completes or the workspace is archived again; a
    terminal verdict still outranks it, as on the reclaim side. On the wire it is a `failing` entry: no new word.
  - **A restart that recurs is counted.** A failed document the lane audits afresh counts on the run of failures every
    failure of the act counts on, and the learn after it carries that run: it backs off, and is listed once the run
    has lasted the hour. It never reaches the persistent tier, since nothing it started stands.
  - **The words say when.** A standing entry is asked again four hours after each failed attempt, sooner after an
    answer that ends no attempt and never while the workspace is held. A fleet box that answers `flock-unavailable`
    gets no cleanup composed at all, for any workspace, until the server restarts. Its feed row says so, and so does
    the row's entry; a stuck or tier entry keeps its place, and every row whose sentence promises another ask says the
    halt in its own sentence while it stands (a stuck entry, a tier entry and the hourly ladder's non-final `failing`
    row, `lock-unopenable` included), with no new kind and no new word. A shadow feed row over a standing
    entry says that pass deleted nothing and that an earlier attempt may have stopped part-way; it never says nothing
    was deleted.

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
- The programme retires as `abandoned`. Opening a run does not change that: a coordinator revived under the crashed id
  can still open a new run under its fenced slug (`openRun`'s conflict arm updates only the title), and while that run
  is open the programme row still reads `abandoned`. The row is rewritten only when a later close ends the programme's
  last open run, to `done` or `abandoned` by that close (measured in a fixture store, wave 5).
- Outstanding deliveries naming those runs are cancelled.
- The slug stays fenced to the crashed id until someone reclaims it.
- CCR-15 wave 3 reclaims each marked child whose run closed. That includes a worker mid-turn: its work is committed
  and pinned, and its turn is lost (L4).
- An unmarked worker is only released, so it moves into the `Released` fold.

**Cost.** The lane measures only the distinct claimants of non-terminal runs, a handful, at the child lane's
60-second cadence. Each measurement is a registry listing, about 27 field reads and one tmux call, which is an
agent frame in remote mode.

**As wave 4 builds the lane** (amended with its plan, `docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md`;
each item is a departure named there).
- **The lane ships shadowed** (the coordinator's safety ruling, the expiry lane's precedent). Until
  `$REG/dead-coordinator-lane-live` exists — touched by the operator by hand in the registry the server reads (the fleet
  box's through the agent in remote mode); nothing in the tree writes it — the lane measures, keeps its anchors, trips
  its breaker and records "would end programme <slug> (<n> runs)" as a feed row and an attention entry, and never
  reaches `closeRun`'s abandon arm or the reclaim port. The executor re-reads the file inside the serialiser.
  `reclaim-paused` stops it entirely, shadow included.
- **The last start is read off the spawn line itself.** ccd's encoder writes every `meas` value as a string and the
  mirror keeps `meas.rc` only as a number, so the typed field is null on every real line; the clause reads the `spawn`
  line's own bytes, strictly — `"0"` is a start, anything else proves none, and then every row in the horizon counts.
- **Doubt in the journal is deliberate.** An act this build cannot name (`unknown`) and an `unsupervise` whose surface
  cannot be read count as deliberate acts: doubt never reads as a crash.
- **A journal that may have lost the act is unreadable.** The clause also reads the journal's own trust: the mirror's
  health (`unavailable`, or not swept since a restart, or `stale` — the last two make a pass decide nothing at all), a
  gap the mirror recorded in a generation not older than the claimant's last successful spawn, and a journal line ccd
  counted as unwritten after it (`$REG/.lifecycle/errors`' instant). Each makes the claimant unmeasured: listed, never
  acted on.
- **A never-started row with no successful spawn never ran.** `never-started` is a crash only when the journal holds a
  successful spawn for it; otherwise — an heir the operator reclaimed a programme onto and has not started yet reads so —
  it is unmeasured. So is an `orphan` or `absent` claimant whose journal holds a spawn that failed and none that
  succeeded (it was started and never ran); a horizon with no spawn row at all still reads crashed.
- **The anchor restarts after a gap nobody measured.** `dead_claimants` carries `lastDeadAt` beside `firstDeadAt`; an
  episode whose last crashed pass is older than ten minutes (a server down, an older build running after a rollback,
  which never writes the table) starts again at the pass that measures it. A claimant crashed with
  evidence of a later life later than its anchor starts a fresh anchor, as a first crash does, and the hour counts from
  it; the evidence is a supervisor heartbeat (supervision evidence: re-stamped every 30 seconds, at every supervisor
  start and by a swap, so it also shows a supervisor's restart) or the trusted journal's newest successful spawn (which
  covers an unsupervised fallback that stamps none), either later than the anchor and not after now; the breaker adds
  that instant to every instant it remembers, so a lane that skipped the pass that saw it alive no longer keeps the old
  episode alone (D-4825, D-4827). A later life that leaves neither is not seen, and in remote mode a fleet clock running
  behind the server's can hide one; neither is permissive. The table is a new table
  and nothing else, so a rolled-back build boots on it.
- **The breaker holds the whole lane**, not only the claimants it names, and it **clears through the doors that
  already exist**: the claimants fall back under the threshold when the operator revives them, reclaims their
  programmes or abandons their runs. No new route.
- **The breaker remembers.** It keeps every first-dead instant each member has carried while held and releases a member only on evidence (alive,
  stopped, a deliberate act) or when it leaves the population, so one pass that cannot measure a member — which deletes
  that member's anchor — does not dissolve the cluster. "Fleet-wide" is what the pass measured: tmux not answering for
  any claimant trips it whatever the count; a registry that will not list stops the tick before the lane runs. The held
  set is kept in `coord.db`'s typed breaker state, `dead_coordinator_breaker_state` (one row: a generation, `clean`, `dirty` or
  `sealed`, the exact held snapshot and its write time; a new table, the operator's choice over a sentinel claimant row or
  an untyped marker), and recorded beside it as a `run_events` observation row (`fromState = toState`, so nothing pushes
  it) whenever the held set changes, in shadow too; both carry each member's first-dead instants with ids
  percent-escaped by a total encoding (a lone surrogate is `%u` and four hex digits), so any claimant id is carried and
  reads back exactly (several instants of one member are `+`-joined; a member the
  fallback below holds carries a `*` after the list), and the state is read back once per process at the first pass (review 381, F1; D-4857).
  Its clustering is monotone: a member keeps every first-dead instant it has carried while held, adds its current anchor
  each time it is crashed and anchored, and clusters at all of them, and two entries cluster when any instant of one is
  within the window of any instant of the other, so a held instant never replaces a re-anchored one, and, for the
  passes and evidence both lanes share, a restarted lane's breaker stands wherever an unrestarted lane's does, under the
  conditions §12 names; anchors and releases are pass-sampled (review 384, F1; review 385, F3); the
  cost is that a member held at an old instant that crashes anew also clusters near its new instant, and a held member's
  instants, and its record, grow by one per re-anchor while it is held.
- **One claimant a pass**, the longest dead first, ARMED; in shadow every due claimant is recorded.
- **The re-measure runs inside the arm.** A compare-and-set on `claimedBy` cannot see a revive of the same id, so the
  abandon arm re-measures the claimant immediately before each run's fleet act and again after it, before the commit;
  a revive that lands inside that last round trip is the residual. A re-measure that reads anything but a crash deletes
  the anchor, as a pass's would.
- **The attention list is the lane's own memory** (the expiry lane's shape): would-end, unmeasured, stuck and the
  breaker, rebuilt over the passes after a restart. A restart keeps the lane's first-dead anchor (a gap of more than ten
  minutes re-anchors it, as above) and the breaker's hold (the typed state above, read back at the first pass, and trusted only when it reads `sealed`, which a clean shutdown writes (D-4916); a state that is clean but not sealed, dirty, absent or cannot be read makes the lane flag every claimant that pass does not release, beside every member, instant and flag it can still read, and write an exact record, with a warn line and a feed row saying so: a flagged claimant clusters with any other crashed or held claimant, whatever the instants, until evidence releases it, so every claimant a readable record would hold is held too, but only when two or more stand unreleased (one alone holds nothing and only has its hour restarted, and a flagged pair dissolves when evidence releases one of the two), at the cost that while one stands a claimant that crashes is swept into the hold and is flagged itself, until evidence releases it or fewer than two stand), restarts the run of crashed passes, which delays an act, and drops the backoff after a stuck or thrown act, which can bring an abandon back sooner. Every pass that changes an anchor or the held set first marks the state dirty, alone, then writes the exact snapshot, every anchor change and the state clean in one transaction; a mark or a commit that fails, or a statement that throws between them, keeps the changes pending and the new hold in memory and acts on nothing, so a restart finds the last complete state, a dirty one or the new complete one, and a state no start trusts unless a clean shutdown sealed it (D-4857, D-4916; §12's residual (7) is closed by the seal); the server's shutdown handler (SIGTERM and SIGINT, `index.ts`) stops the lane and seals within a bound of five seconds when nothing is pending, warns once on a refusal, never throws and re-raises the signal, and the first pass of a process that read `sealed` unseals it before it can change state or act; an unclean exit starts conservatively, which is a cost: each crashed claimant's hour restarts, and two or more unreleased claimants hold the lane, flagged, until evidence releases one; under a sealed state the first pass still flags every claimant whose durable anchor began after the snapshot was written (D-4826).
  The lane composes no act on a pass whose commit did not land, so the durable state never lags an act. Every act is still behind the claimant's re-measure before and after the fleet act.
- **The lane never pushes.** The stall watch notifies about a dead coordinator's stalled workers — r3
  (`coordinator-dead`) and, once its wave-2 arms are armed, `coord-deaf`, one push per worker, each naming the
  coordinator; this lane's feed rows (each with the claimant's first-dead instant, and one per breaker trip) are records
  of that incident and its entries are a list.
- **Not changed:** the reclaim door and the stall watch ignore the verdict's new `cause`; landing reads a run the sweep
  failed exactly as one the operator abandoned (it keys on open runs, never on `causedBy`).

**As wave 5 corrects the lane** (review 339's residue; each a departure named in the wave-5 plan,
`docs/superpowers/plans/2026-10-08-workspace-lifecycle-wave5-residue-and-expiry-follow-ups.md`).
- **A second crash is a second record.** A reading that ends an episode (anything but a crash) forgets the last
  recorded outcome, so a coordinator that crashes, is revived and crashes again is recorded again in shadow.
- **A release and a re-hold are two acts.** An act the re-measure stopped after its fleet act says which one ran: a
  released worker is unheld until its coordinator re-holds it, and a worker re-held under a surviving run stays claimed.
- **Every thrown act is recorded.** Each thrown act writes one feed row naming the runs it closed, the run whose
  abandon failed, and that nothing more is known.
- **A generation the mirror could not read is not a successful sweep.** One failed read is absorbed; a failure that
  persists turns the mirror's health `stale`, so the lane decides nothing.
- **A mirror gone stale at the act is a hold.** The act stops, the anchor and the run of crashed passes stand (the
  adapter's own rule: a slow mirror never deletes an anchor), and the act waits a pass.
- **An accepted abstention.** The journal clause counts any non-refused `reclaim` row as deliberate, so a child's
  pre-start `reclaim` `failed` `probe-unmeasured` row reads as a deliberate act and the lane abstains from that
  claimant. Abstention ends nothing. It is reachable only by a marked child that becomes a claimant or an heir before
  any successful reclaim of it.

**As wave 6 closes the lane** (each a departure named in the wave-6 plan,
`docs/superpowers/plans/2026-10-11-workspace-lifecycle-wave6-resumed-expiry-and-arming-close-out.md`).
- **The journal's trust is read again after the claimant's measure.** The act reads three things before it measures
  the claimant: the mirror's health state, its gap list and the last instant ccd counted a journal line it could not
  write. The first two are synchronous and are read again after the measure, with nothing awaited between that read
  and the commit, so the revive window stays the measure's own round trip. A mirror that turned `stale` or `unknown`
  meanwhile stops the act as a hold (the anchor and the run of passes stand), and a gap recorded meanwhile joins the
  gaps the clause reads. The write-error instant needs a stat, an await, so it stays the early read's; but the count
  behind it is the mirror's and is read again, so a failure counted during the measure where the early read saw none
  makes it unknown, and the claimant unmeasured. A further failure on top of one already counted is not seen before the
  commit.
- **A hold met after the fleet act is recorded.** A mirror that goes stale between a release and the commit stops the
  act with the worker released and its run open; the feed row and the attention entry say so, the anchor stands, and
  the next pass ends the programme.

## 6. What this changes outside itself

- **Wire.** Stage 1 adds `FleetSession.releasedFrom` and `ReleasedFrom`. Stage 2 adds `ARCHIVE_REFUSALS` with six
  new codes (the door's three and the three `ws-archive` refusals "Stop only" answers), the archive body's
  `interrupt` and `programme`, and its answer's `archived`, `stopped` and `ended`. There is no `FLEET_PROTO` bump.
- **CCR-15 texts this spec amends.** Each is amended when this spec's wave lands, after the CCR-15 wave that wrote
  it has merged:
  1. `reclaim-paused` "and nothing else" becomes the cleanup switch (§5.3). Amended by this design’s wave 3b: CCR-15's
     §5.8 now says the pause stops the expiry of archived workspaces too.
  2. Coordinator clause 3's closing sentence (§5.3). Amended by this design’s wave 3b: the clause, README and
     `wave-lifecycle.md` §6 say the server cleans an archived workspace up seven days after its archive once the
     operator has armed the lane, and that until then the lane only records what it would expire.
  3. Spec §5.9 "No child ever appears in the reap or archive sheets". A person may now archive a child by hand, and
     "Archive all" skips children (§5.1).
  4. Wave 3's "exactly ONE addition" to `ws-reap`'s resume fork: the `expire:` arm is a second (§5.3). Amended by
     this design's wave 3 (3965): CCR-15's §6 now names `ws-reap`'s `expire-in-progress` refusal beside its `reclaim:`
     mirror, and `ws-restore`'s refusal of an expiry in progress.
  5. `closeRun`'s `causedBy` vocabulary gains `'sweep'` (§5.4). Amended by this design’s wave 4: CCR-15's texts name no
     `causedBy` vocabulary (measured); the set is written in the build-4 design (`2026-08-11-build4-conversation-and-controls-design.md`),
     which now names the third word, and in `close.ts`'s `CloseCause`.
  6. Wave 4's lane gains a second population (§5.3). Amended by this design’s wave 3b, recorded by wave 4: the expiry
     lane is a SIBLING pass on the same tick, never a population inside `sweepChildReclaim`, so CCR-15's sweep and its
     text are unchanged.
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
- **Ending a programme succeeds, then the archive refuses.** Every refusable check the server can measure runs
  first, and a partly ended programme stops the door before any stop or archive. A workspace's turn is among them
  when the programme is to end (3877, 3881): before the end, a measured busy workspace is refused `session-busy`
  unless `interrupt:true`, and an unmeasurable one `status-unknown` whatever the consents. What only `ccd`
  measures can still refuse after the end, which includes the worktree in remote mode and the archive manifest
  (and its own `status-unknown` or `session-busy`, should the state change after the server's read); that answer
  names the runs it ended, and the sheet offers "Stop only" where it applies (§5.2).
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

Committed with the wave-1 plan: `deploy/measure-workspace-lifecycle.py`, read-only, run on the server box, which holds
both inputs — `coord.db` (the runs, and the lifecycle journal the server mirrors from ccd) and `state-cache.json` (the
registry facts, as the board last saw them). Its rows:

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

## 11. Confirmed by the operator (2026-09-26)

The rulings stand as given. Two consequences of them surfaced in review, and the operator confirmed both on
2026-09-26:

1. **L5's "No" is "Cancel", not "archive anyway".** A delivery to an archived recipient backs off and parks
   (D-1066), so an archived coordinator cannot keep its programme running. Its workers' reports would park unread.
   So archiving a coordinator with open runs offers only "End programme and archive" or "Cancel", and a programme
   is paused with the existing coordinator pause switch.
2. **Every workspace archive starts the 7-day clock.** After L2 there is no way to put a workspace down that is not
   an archive, so a "stop for now" to free memory also becomes a deletion in 7 days unless it is brought back.
   Main checkouts are unaffected.

## 12. Before arming

Nothing in this tree arms either lane, and nothing writes either live file (`single-definition.test.ts` pins both).
Arming is the operator's act alone: touching `$REG/expire-lane-live`, and then, in the recommended order,
`$REG/dead-coordinator-lane-live`, by hand in the registry the server reads. These are the facts to know before each,
gathered when the programme's last wave (6) closed; each is designed where §5.3 and §5.4 say, and this section only
collects them.

**Both lanes.**
- **Deploy first, the fleet box first.** Both boxes run the release that carries wave 6 (`ccrc version`, and
  `/health`'s `version`), and the feed shows the dead-coordinator lane's shadow rows as well as the expiry lane's. A
  fleet box whose ccd predates it prints no `crumb` on `ws-expire`'s own documents, and the server then reads them by
  the word alone, as before wave 6: a resumed expiry's `probe-unmeasured` is final again.
- **The recommended order.** Arm the expiry lane first, once this release is deployed and its shadow list has been read;
  then the dead-coordinator lane, after its own shadow list has been read and any breaker trip worked through.
- **Their memory is in memory.** A server restart re-learns the expiry lane's instants, sightings, runs of failures and
  attention entries, and the dead-coordinator lane's run of crashed passes, backoff and attention entries. So a restart
  can delay an act and can ask again a row the lane had stopped asking (a halted box, a failure the box said will not
  resume, the unreadable-breadcrumb row below), always behind the lane's own guard: for the expiry lane a fresh audit
  whose token ccd proves again inside its lock, for the dead-coordinator lane the claimant measured again before and
  after the fleet act; neither acts without it. A restart also drops each expiry row's `nextAskAt` (a fresh entry's is
  `0`) and its run of `failures`, so a tier or stuck row (normally asked every four hours) and a row backing off on the
  ladder are asked again within a few passes, SOONER than an unrestarted lane would; every ask is still behind a fresh
  audit and ccd's in-lock re-proof. A kept-leaf entry is lost with it (question (i)).
  The dead-coordinator lane keeps two things across a restart. One is its first-dead anchor (`dead_claimants`), which is
  re-anchored after a gap of more than ten minutes (`DEAD_COORDINATOR_GAP_MS`) in which no pass measured the
  claimant crashed, or when evidence of a later life shows (D-4825, D-4827), so a restart shorter than that keeps the hour. The other is the breaker's hold: its typed state in `coord.db` (`dead_coordinator_breaker_state`: `sealed` or `clean`, each with the exact held snapshot, or `dirty`), written by every pass that changes an anchor or the held set (in shadow too), with a `run_events` record of each change, and read back at the lane's first pass, where only a `sealed` state is trusted as it reads (D-4916, below).
  A state the lane finds dirty, clean (not sealed), absent or unreadable does not stop it: for that pass the lane flags every claimant the pass does not release,
  each flagged in the new record (a `*` after its complete `+` list of instants), beside every member, instant and flag it can still read, and writes an exact record before the state is clean or anything acts. A flagged claimant clusters with any other crashed or held claimant, whatever the instants, until
  evidence releases it, so every claimant a readable record would hold is held too; the cost is that while one stands a
  coordinator that crashes is swept into the hold and is flagged itself, until evidence releases it or fewer than two
  entries stand. The flags HOLD only when two or more claimants stand unreleased: a single one holds nothing and only has its hour restarted, which is a delay, and a flagged pair dissolves when evidence releases one of the two. The server logs one warning and writes one feed row saying which, the operator's sign: "dead coordinator: no breaker state yet" when there is no state, "dead coordinator: breaker state left dirty", "dead coordinator: breaker state not sealed" when the state reads clean but no clean shutdown sealed it, or, with a `ccrc-server: sweepDeadCoordinators could not read the breaker's record of its hold` warning, "dead coordinator: breaker record unreadable". The hold releases on what releases it without a restart: evidence that the
  claimant is alive, stopped or was stopped on purpose, or the claimant leaving the population. For that lane a restart
  also means the run of crashed passes starts again, which delays an act, and the backoff after a stuck or thrown act
  (`nextAskAt`, `attempts`) is lost, so a restarted lane can ask for that abandon SOONER than an unrestarted one would.
  Every pass that changes an anchor or the held set marks the state dirty first, alone, and then commits the exact snapshot, every anchor change and the state clean in one transaction. A mark or a commit that fails changes no durable anchor and acts on nothing; its anchor changes stay pending in memory, laid over the durable anchors and re-sent by the next commit, and the in-memory hold moves to that pass's before the first statement that can throw, and a throw anywhere between the mark and the commit's result (the carrier read included) is the commit-failed path, so a failed write or a thrown statement never forgets a trip or a doubt in the process that saw it. A commit that fails leaves the state dirty, so a restart is conservative; a mark that fails leaves the state as the last landed write left it (`clean`, or `dirty` after an earlier commit that failed) and never `sealed`, because the first pass of every process unseals (D-4857, D-4916).
  THE SEAL (D-4916, the operator's choice of 2026-10-13, "Seal on clean shutdown"). A start trusts the stored snapshot ONLY when the state reads `sealed`; `clean`, `dirty`, absent, unreadable and malformed all seed conservatively. `sealed` is written by the server's shutdown handler, the one signal handler the process has (`index.ts`, through `shutdownseal.ts`): on SIGTERM or SIGINT it stops the watcher, asks the lane to seal within one bound of five seconds (well inside systemd's default stop timeout of ninety, which the unit leaves alone: a pass in flight asks tmux about a few coordinators and the seal itself is one local statement), logs one `ccrc-server: shutdown:` warn line when the seal is refused or fails, never throws, and re-raises the same signal. The exit status is identical to what it was before the handler existed (death by the signal), so systemd, `ccrc update`'s health gate and the watchdog read it as before; the stop takes up to the bound longer. During that bound the watcher's tick is stopped; a tick already in flight, the routes and the independent timers (the box-token driver's, the auth sessions', the session sockets') keep running, so an act begun then is cut off by the re-raise, as any act could be by a SIGKILL. A second identical signal during the bound kills at once, with no seal: the listeners are `once`, so the second reaches the default action, and the cost is an unclean exit. A different signal during the bound (a SIGINT inside a SIGTERM's, or the reverse) is handled, because its `once` listener stands until the first handler ends: both handlers wait on the pass in flight, the first to resume seals and re-raises its own signal, and the process dies of that one; the seal is one generation-checked statement, so no second write can land. The refusal's warn line says what the next start does: for `no-landed-write` and `already-sealed`, which write nothing and leave the state as it stands, it says that a sealed state is trusted, and never that the state is seeded conservatively. The lane seals in one generation-checked statement over the same snapshot, and only when no pass is in flight (a pass is awaited within the bound), a write of this process has landed, no anchor change is pending, the state is durably clean and the held set's key is the one the last commit wrote; otherwise it writes nothing and says which. A seal attempt stops the lane: no pass runs after it. The first pass of a process that read `sealed` writes `clean` back, before any step can change state or act (eagerly, not at the first change, so a trip formed before the first change whose mark then fails is not trusted by the next start), generation-checked and over the same snapshot, and retries each pass until it lands; until that unseal has landed a sealed start writes nothing else (a later mark or commit does not count in its place) and acts on nothing, and takes no `unchanged` shortcut; a conservative seed's permission is its first landed commit.
  Under a sealed state the first pass also flags, at its anchor instant, every claimant of the population whose durable anchor began after the snapshot was written (D-4826); since every anchor change of this release commits with its snapshot, that is only an older build's anchor, written after a rollback.
  The snapshot is written with the write-time clock of the commit that carries the pass's anchor changes, so an anchor of that pass is not flagged. The cost is the conservative seed's, and it is a COST, not a residual: after an unclean exit (a kill, an OOM kill, a crash, or a stop that outlives systemd's timeout) or over a dirty, absent or unreadable state, every claimant the pass does not release is flagged, and held when two or more stand unreleased, until evidence releases it, and no durable anchor is taken as continuing, so each crashed claimant's hour restarts at that pass (an hour's delay for each, the deploy's first pass included); a clean shutdown pays none of it; while the breaker's writes keep failing nothing acts. The limit: a server clock that steps backwards across a restart can make a later anchor read earlier than the snapshot.
  The class mail 4266 measured, and residual (7) after it, are CLOSED, not accepted (D-4857, D-4916): a held instant that lived only in memory because held-set writes failed while anchor writes landed, its anchor deleted by a doubt before a restart, cannot arise, because no anchor change lands without the snapshot that holds it, a commit that fails leaves the state dirty, which a restart reads as fail-shut, and every claimant id, a lone surrogate included, has a spelling; the same loss through a mark that fails is closed by the seal, because a state that was not sealed by a clean shutdown is never trusted.
  Anchors and releases are
  pass-sampled: an anchor sits on its lane's own pass, up to one cadence after the crash, evidence that releases a hold is
  seen only at a pass, and a restart moves the pass grid as any start does, so a pair near the ten-minute window's edge
  can cluster or release in one lane and not in the other, the lane with more passes may act sooner, and the comparison
  below is claimed only for the passes and evidence both lanes share. The breaker's clustering is monotone (§5.4), so for
  the passes, anchors and evidence both lanes share a restarted lane's breaker stands wherever an unrestarted lane's does when the restarted lane's population differs only
  by claimants the unrestarted lane has already ended. A claimant the
  unrestarted lane ended that returns under a new run is covered by the episode boundary: a supervisor heartbeat later
  than its durable anchor starts a fresh anchor at its next crash, so the restarted lane carries the new instant beside
  every one it remembers (D-4825). That rests on a heartbeat or a journaled successful spawn (D-4827): a return that leaves neither is not seen, in remote
  mode a fleet clock behind the server's can hide one, and no claim is made that no other corner exists. The lost backoff has a knock-on: if the unrestarted lane backs off a stuck claimant
  while the restarted lane, its backoff lost, ends it, the unrestarted lane keeps that claimant as an extra entry that can
  cluster with a new crash, so the restarted lane can end a third claimant the unrestarted lane holds. The lane composes no act on a pass whose commit did not land, so the durable state never lags an act, and every act is still behind the claimant's re-measure before and after the fleet act.
- **`$REG/reclaim-paused` stops both lanes at once**, shadow included: the cleanup row's toggle on `/runs`.

**The expiry lane (`$REG/expire-lane-live`).**
- **Its arming blockers are closed.** A pre-breadcrumb `state-changed` is audited afresh (wave 5). A resumed expiry's
  `probe-unmeasured` is retried (wave 6, through `crumb`), and a fresh one's is audited afresh, counted and listed after
  the hour if it recurs, where it was final before. `_ws_expire_cwd_users` resolves its parent through
  `_ws_dir_physical`, so a parent whose physical path holds a newline is unmeasured, never "nobody" (CCR-15 wave 6; its
  case in `ccd-leaf-root-newline.test.ts` goes red when the bare `pwd -P` is put back, measured in wave 6).
- **One residual of question (k), in a narrow window.** A breadcrumb that stands but cannot be read (a
  `$REG/<id>.reaping` that is not a readable file) leaves `crumb` unsaid, as on the reclaim side. If it is already
  unreadable at the lane's audit, `ws-audit --expire` answers `unmeasured` (exit 1): on a learned row that is read as
  `audit-failed`, backed off and listed after the hour; on a row not yet learned (every row after a server restart, and
  any but a stuck one after a `restart` answer), `learnExpiry` lists it at once as a non-final `failing` ("its expiry
  could not be learned"). Neither is final. Only a breadcrumb that turns unreadable between the act's audit and the
  in-lock fork leaves a `probe-unmeasured` read by its word: listed at once and not asked again for that archive until
  the server restarts. Nothing is deleted either way; read what stands in that row before anything else.
- **One archived tree holds a leaked test tmux server** (the ledger's pre-arming item (d)). The lane refuses that row
  `in-use` each time it is asked and lists it after three, naming the process; it never ends it. End that server first, once
  you know what it is, or arm knowing the row stays listed.
- **A branch already gone now expires.** Since CCR-15 wave 6, an archived workspace whose branch is gone when its token
  is minted expires with its work in the attic, where `main` stopped at `pin-failed`, and its ignored and secret-shaped
  files go with the tree, as the standing policy says. A branch deleted between the fresh pin and the tail's settle has
  its tip pinned at the fresh pin. With HEAD still symbolic to a deleted branch the pin fails before the breadcrumb, and
  the lane audits it afresh each time, counted and listed after the hour.
- **A branch deleted or made inside the lock stops the act** before the breadcrumb, in both directions (question (j)).
- **An archive whose admin `gitdir` names no path** is unmeasured and retried, never `no-worktree-record` (CCR-15
  wave 7, rung 8); a record that is truly absent stays terminal.
- **What each answer does to a row.** A person viewing it defers it with no ceiling. A process working in it is refused
  `in-use` each time the row is asked (the lane makes at most one act per pass, fleet-wide) and listed after three, naming
  the process; the lane never kills. A held row past its instant is listed,
  never touched. A terminal refusal, or a failure the box says will not resume, is listed and never asked again for that
  archive. A resumable failure backs off and is listed after the hour (a box answer such as `lock-unopenable` at once); after a day of the verb's failures it becomes a
  standing entry, asked again four hours after each failed attempt. `containment-refuted` is listed at once on that
  tier. A failure ccd printed before the breadcrumb is audited afresh, counted, and listed after the hour if it keeps
  happening. A completed expiry that kept a leaf is listed until a restart.
- **A stuck entry stands through a `restart` answer** (ruling (m)). An act whose document says ccd stopped before it began
  (`crumb: false`) ends a tier entry, but not a stuck one: it keeps its entry, its first instant and the tier's cadence,
  because a restart says nothing about whether the leaf that refused containment is gone. Only an attempt that completes,
  a verdict that stops the row for good, or a fresh archive ends it (a server restart drops it, as it drops every entry).
- **`flock-unavailable` halts the lane's act** on that box until the server restarts. The halt is one process-wide field
  gating only the act: learn audits go on. Its feed row says so, and so does the row's entry; a stuck or tier entry keeps
  its place, and every row whose sentence promises another ask (a stuck entry, a tier entry, the hourly ladder's
  non-final `failing` row, `lock-unopenable` included) says the halt in its own sentence while it stands.
- **The first armed pass faces the backlog** at one expiry a pass, fleet-wide. The operator expired fifteen archives by
  hand on 2026-10-07; raise `WS_EXPIRE_AFTER_S` first if what remains is too many at that pace.

**The dead-coordinator lane (`$REG/dead-coordinator-lane-live`).**
- **Arm it after the expiry lane**, once its own shadow list is read and any breaker trip is worked through.
- **Its wave-5 arming blockers are closed**: the act's own clock is pinned, a second crash is a second record, a
  release and a re-hold are told apart, every thrown act is recorded, and an unread generation is no successful sweep.
  What stands instead is listed in full below, residual by residual.
- **The three early reads, and what wave 6 closes.** Before measuring the claimant the act reads the mirror's health
  state, its gap list and the last instant ccd counted an unwritten journal line. Wave 6 reads the first two again after
  the measure, and the count behind the third: a failure counted during the measure's round trip, where the early read
  saw none, leaves the claimant unmeasured. One thing stays early: a further failure on top of one already counted is
  placed by the earlier instant, so it is not seen before the commit.
- **The journal-gap trade.** A coordinator whose last successful spawn is not newer than a recorded gap stays listed as
  unmeasured, never ended, until it spawns again (wave 4, accepted). Ageing a gap out is carried, for a decision on
  shadow evidence.
- **The accepted residuals, every one of them** (arm only knowing these; this release closes none of them). (1) A lane
  gap of over ten minutes re-anchors every crashed coordinator on the same pass, so the breaker holds and no shadow row
  is written until all but one are revived, reclaimed or abandoned. (2) A revive of the same id inside the act's last
  re-measure window, sub-second to one agent round trip, can still lose its runs. (3) Anchors and releases are
  pass-sampled: an anchor sits on its lane's own pass, up to one cadence after the crash, and evidence that releases a
  hold (alive, stopped, deliberate) is seen only at a pass, so two lanes, or a restarted and an unrestarted one, with
  passes at different moments can hold or release a pair near the ten-minute window's edge differently, and the lane
  with more passes may act sooner. (4) A restart drops the in-memory backoff and retry population (`nextAskAt`,
  `attempts`), so a restarted lane can let another claimant proceed sooner, and if the unrestarted lane backs off a
  stuck claimant while the restarted one ends it, the first keeps it as an extra entry that can cluster with a new
  crash; it still re-audits, waits its durable hour, re-measures before and after the act, and is blocked by the durable
  breaker hold. (5) A later life that leaves neither a supervisor heartbeat nor a journaled successful spawn is not
  seen, and in remote mode a fleet clock running behind the server's can hide one. (6) A start over a state that is not `sealed` (an unclean exit: a kill, an OOM kill, a crash, or a stop that outlived systemd's timeout; a dirty, absent or unreadable state; the deploy that creates the table is one such start) flags every claimant its first pass does not release and restarts every crashed claimant's hour at that pass, which is a COST of the seal's design, paid only on an unclean exit. It HOLDS only when two or more claimants stand unreleased, and then until evidence releases one of them (a flagged pair dissolves when evidence releases one of the two); a single unreleased claimant holds nothing and only has its hour restarted, a delay; while the breaker's writes keep failing nothing acts; and a server clock that steps backwards across a restart can make a later anchor read earlier than the snapshot. (7) is CLOSED, not accepted (D-4916, the operator's choice of 2026-10-13): a restart after a dirty mark that could not be written used to seed the older clean state and could bring an act sooner, and now seeds conservatively, because only a state a clean shutdown sealed is trusted and the first pass of every process unseals it. What stands is the floor any durable design has, named so it is not mistaken for a hole: a process none of whose writes lands, from its first pass to its death, leaves no trace, so the next start trusts the older seal and the trip, doubt or release that process held in memory is lost with it (pinned in the lane's tests: seal, a sealed start whose every write fails, a crash, and the next start trusts the older seal); it needs the store to refuse every write for a process's whole life and then recover for the next, and it is not the class mail 4266 measured. The class mail 4266 measured is not on this list because it is closed, not accepted (D-4857). Each of (1), (2), (5) and (6) only delays an act or holds more; (3) and (4), and the floor named in (7), can bring an act sooner; none
  bypasses the lane's own fresh audit, hour, journal, re-measure or breaker decision. The one action to take before a
  rollback is the next item's.
- **The deploy that creates the breaker's table starts conservatively, once.** The table this release creates has no
  row, and an absent row reads `absent`, which seeds the conservative hold as an unsealed one does: its first pass flags every coordinator it does not see alive, stopped or
  put down on purpose, restarts every crashed coordinator's hour at that pass, writes the first exact record (the state
  reads clean at once) and says so ("dead coordinator: no breaker state yet"). It HOLDS only when two or more such
  coordinators stand unreleased; one alone has its hour restarted, a delay, and a flagged pair dissolves when evidence
  releases one of the two. What lasts, while both lanes are shadowed, is that flagged hold, only for two or more: an
  operator arming later should expect it while they are still crashed, and it releases through the doors that already
  exist: revive, reclaim or abandon. An unclean exit afterwards reads its own words ("dead coordinator: breaker state not
  sealed" when the state was clean, "breaker state left dirty" after a commit that failed); the flags, and holding only for two or more, are the same; a clean shutdown (SIGTERM or SIGINT, handled in `index.ts`) seals
  the state and the next start pays none of it (D-4916).
- **Roll back below this release only with the lane disarmed.** No released build before this one reads the breaker's
  held-set record, so a rollback below it (`ccrc rollback`, or the unattended update watchdog) starts with no hold, the
  restart hole failing open: arm the lane only on a release that carries the reader, and before rolling back below it
  remove `$REG/dead-coordinator-lane-live`: the lane then only records, and never acts. Nor does an older build keep the
  typed state: an older build neither reads nor writes `dead_coordinator_breaker_state`, and it changes `dead_claimants`
  outside it, so on rolling forward again the state reads as this release left it (sealed, trusted, when it stopped cleanly; clean, seeded conservatively, when it did not), and under a sealed one only the anchors the
  older build started are flagged (D-4826), not a hold it formed in memory and lost; read the shadow list and any breaker
  trip again before re-arming, as at the first arming.
- **A permanently unreadable generation pins the mirror `stale`**, with no diagnostic of its own: the lane then decides
  nothing at all, which fails shut. `/api/fleet/health`'s lifecycle state shows it.
- **An accepted abstention** (§5.4): a child's pre-start `reclaim` failure reads as a deliberate act.
- **An abandoned programme's row** stays `abandoned` while a revived coordinator's new run is open (§5.4; question
  (f)). The consequence: `toId:'coordinator'` mail that carries no `runId` is refused while nothing else is active, and
  goes to ANOTHER programme's coordinator when exactly one other programme is active; mail naming a `runId` still
  resolves.

**Questions still open**, lettered as the programme's ledger letters them.
- (b) The archive-confirm copy: the ledger holds it open; wave 4 hedged both confirms to a sentence true before and
  after arming. Is that the copy you want?
- (f) Should a new run under an abandoned programme return its row to active?
- (g) A stale mirror at the act keeps the run of crashed passes, where the switch resets it. Keep, or reset?
- (i) A kept-leaf entry lives until a server restart. Is that the life you want?
- (j) `ws-expire` refuses a branch made inside the lock as well as one deleted. Keep both directions?
- (p) Should a breadcrumb that turns unreadable between the act's audit and the in-lock fork (the only shape left once
  an unreadable one at the audit is backed off) be retried on the persistent tier, rather than listed at once and not
  asked again until the server restarts?
- Wave 2's three: the PR sheet's "Archive now" offers no consent for a busy or coordinating workspace; a real worktree
  check in remote mode needs an agent-first probe; L5's "Its workers will be cleaned up" is true only for CCR-15's
  children.
- Wave 6's own are in its plan's questions for the operator.
