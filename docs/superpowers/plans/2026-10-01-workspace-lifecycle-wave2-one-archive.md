# Workspace lifecycle, wave 2 — one "Archive" (spec stage 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Stop and Archive one feature. Every session's menu and actions sheet offer **Archive**, with a confirm that reads by case (an idle workspace, a busy session, a main checkout, a coordinator with open runs), and every session already put away offers **Restore**. `POST /api/sessions/:id/archive` becomes the one door for both kinds of row: it runs every check it can measure before anything it cannot undo, ends a coordinator's programme only on an explicit `{programme:'end'}` (through the abandon door's own decision, on the coordination serialiser, with CCR-15 wave 3's `childReclaim` port, after reading every run's row-alone refusal first), stops a main checkout (whose busy it reads fail-closed, and again at the stop) or an interrupted busy session with the argv `/stop` already builds, archives a workspace with `ws-archive`, and answers a stop followed by a refused archive as a partial outcome. The Archived fold takes stopped main checkouts through one L0 predicate, `inArchivedFold`. The header's "Stop session", its `QuickConfirm` and `SessionScreen`'s `stopSession` are removed; `ccd stop`, `POST /api/sessions/:id/stop` and the `esc` keycap are unchanged.

**Architecture:** L0 (`shared/api.ts`, appended at its end) declares the door's vocabulary once — `ARCHIVE_REFUSALS`, `ARCHIVE_STOP_ONLY`, `ArchiveBody`, `ArchiveAnswer` — and the three predicates both sides read: `archiveInterrupts` (busy, either kind), `inArchivedFold` and `archivedFoldSince`. The store gains one read, `CoordStore.openRunsClaimedBy`. `registerCoordRoutes` returns a handle, `CoordRoutesHandle.withAbandon`, which hands a caller `closeRun`'s abandon arm exactly as `POST /api/runs/:id/abandon` runs it, and that arm's refusal read from a run's row alone (`abandonRefusal`, over the arm's one transition rule `abandonMove`, both extracted in `close.ts`), inside the routes' own `coordMutex`; the abandon route itself now runs through it. The DECISION lives in a new file, `server/src/coord/archiveDoor.ts` (`archiveFlags`, `decideArchive` over a consumer-declared port, `ccdArchiveRefusal`, `archiveOutcome`); `server.ts`'s archive route only measures (the registry row, a fleet row assembled on the request, a main checkout's busy read fail-closed by `_ws_status`'s rule (`idleForStop`) and re-read at the stop, the worktree, the verb) and acts (the stop argv `stopArgvFor`, shared with `/stop`, then `ws-archive`). On the PWA, `api.archive` carries the two new consents and resolves the door's answer, read through one reader (`archivePartial`); a new `ArchiveSheet` holds the conversation and every refusal, with "Stop only" after the three `ws-archive` refusals and after the other refusals no retry answers (a store the server could not read, a programme it could not end, a box whose ccd has no `ws-archive`); the actions sheet, the session header and `groupFleet` move onto it and onto `inArchivedFold`.

**Tech Stack:** TypeScript (node ≥ 22.13, `node:sqlite`), Fastify server, React PWA, vitest 4.1, bash (`ccd`, unchanged; driven in fixture HOMEs by one test file), git 2.43.

**Spec:** `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` — §5.2 (the whole of this wave), §2's L2 and L5, §4's wave-2 row and its coordination paragraph, §6's wire and census items, §7, §8's failure modes for stage 2, §11 (both consequences). Programme ledger: `docs/superpowers/programs/workspace-lifecycle.md` (wave 2's row). Wave 1's plan, `docs/superpowers/plans/2026-09-26-workspace-lifecycle-wave1-released-fold.md`, is the base this plan builds on: it must be merged first (both waves edit `groupFleet.ts`, `shared/api.ts` and the fleet screen's tests).

## Global Constraints

- **Base.** Every block below was generated from, and replayed against, `main` `5b1c58a8` with wave 1 applied (`aefc8415`, a local planning commit, never pushed). On your branch, wave 1 is on `main`. If a Find block is absent or not unique on your base, `main` moved under it: stop and report rather than improvising an anchor. Seven blocks anchor on wave 1's own text (Task 7's three `fleet-screen.test.tsx` blocks, Task 11's two `groupFleet.ts` blocks and its `FleetScreen.tsx` block, Task 12's README block — measured: each is absent on `main` `5b1c58a8` and present once on `aefc8415`). If one of THOSE is absent, wave 1 merged differently from its plan: compare against wave 1's merged text and report it, rather than re-anchoring. Line numbers in prose are hints; the blocks locate every edit by content.
- **Wire: additive, absence-permits.** No `FLEET_PROTO` bump. The request body gains `interrupt?: true` and `programme?: 'end'` (`ArchiveBody`); the 2xx answer gains `archived`, `stopped`, `ended` and, on the partial outcome, `refusal` and `detail` (`ArchiveAnswer`). An older server's bare `{ok:true}` reads as a completed archive through `archivePartial`, the ONE reader of `archived` (pinned by a scan). A refusal is an `error` word from `ARCHIVE_REFUSALS`; a word this build does not know reads as `null`, never as a code.
- **Every refusable check before any irreversible act — as far as the server can measure.** The door's order is: a turn in progress (unless `interrupt`; a main checkout's read fail-closed, Pre-flight finding 6), a worktree PROVEN gone, `run-open` (unless `force`), `coordinator-has-open-runs` (unless `programme:'end'`; an unreadable store — or a store read that throws — refuses either way, `runs: []`), the `ws-archive` verb gate, and every claimed run the abandon arm could not move from its row alone (`abandonRefusal`, Pre-flight finding 3); then end the programme, then (a main checkout without `interrupt`) re-read busy, then stop, then archive. What only `ccd` measures — its status read, the manifest and, in remote mode, the worktree — refuses inside `ws-archive`, before ITS act; any answer after a programme end carries `ended` (Pre-flight finding 1).
- **One spelling of each thing.** `ARCHIVE_REFUSALS` is the only place a refusal code is a literal (`single-definition.test.ts`); `stopArgvFor` is the only stop argv (`/stop` and the door share it); `withAbandon` is the only abandon (the abandon route and the door share it), and `abandonMove` the only abandon transition (the arm and the door's pre-read share it); `inArchivedFold` is the only fold rule (`groupFleet`, the actions sheet, the header); `archivePartial` is the only reader of `archived`.
- **Rings.** `shared/api.ts` imports nothing new. `server/src/coord/archiveDoor.ts` decides and imports only L0 values and types from `io.ts`, `close.ts` and `store.ts`; it reads the store and ends a programme only through `ArchiveCoordPort`, declared there by its consumer. The store stays synchronous — never wrap `CoordStore` async. Server log lines are `console.warn('ccrc-server: …')`, never `req.log`.
- **No new route, no new `ccd` verb, no change to `ccd`, `/stop`, the abandon route's behaviour or the bucket ladder (M10).** `fleet-lifecycle.test.ts`'s "a stopped row is still `dead`/`dead`" stays green untouched; the fleet footer's `/archive` stays a WORKSPACE list (`archivedAt`); the Dead chip still counts a stopped main checkout.
- **The box-token census moves with the route.** With `{programme:'end'}` the archive route is a coordination write with no box token, registered in `server.ts` where `coord-pause-route.test.ts` cannot see it; `box-token-census.test.ts` names it beside the kickoff route and CLAUDE.md's bullet names it (Task 6).
- **Cited files pay the citation tax (S6-R11).** This wave appends to `shared/api.ts` below every cited line and inserts one README paragraph that moves no cited anchor; the measured tax is zero (see "The citation tax", below). CLAUDE.md's README size claim is pinned within 100 lines (`pools-prose.test.ts`), and this wave's README paragraph pushes it past — Task 12 re-measures it.
- **Your scratchpad and your shell.** `<SCRATCH>` stands for your session's scratchpad directory: write its ABSOLUTE path into every command. Every command runs from the worktree root; a package command is wrapped in a subshell, `( cd server && … )`.
- **Test hygiene.** Fixture HOMEs only — never `ccd` against the live `$HOME` (`archive-ccd-words.test.ts` drives the real `cmd_ws_archive` through `makeCcdHarness`, with tmux and systemd as shell stubs). Run a single file as `./node_modules/.bin/vitest run test/<file>` from inside its package, never bare `npx vitest`; suites in the FOREGROUND with a timeout of at least 600000 ms, one Bash call per shard. Known reds that are NOT this wave's: `typecheck-tests.test.ts`'s three environment cases where `agent/node_modules` is absent or `pwa/node_modules` is a symlink (identical on the base; Step 0 of Task 1 installs real modules), and the load flakes CLAUDE.md lists. If the fleet box's root disk is under `ccd`'s 10G `ws-add` floor, every `ws-add` test reds on the base too: run with `CCD_DISK_FLOOR_GB=1` then (the ledger's 2026-09-28 note).
- **Branch discipline.** Commit on your workspace branch, never a separate feature branch. Identity is the noreply address.
- **Deviation numbers.** This plan defines none. Its departures are named by slug under `## Deviations found`; the coordinator mints their numbers at run-open (`POST /api/ledger/deviations`). A departure found while executing is reported, never typed.
- **SAFETY.** Never a destructive `ccd` verb against the live host (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore`); never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*.service` directly; never print secret file contents; `gh` stays off the exec whitelist. Deploy is MEASURE-ONLY (the deploy note at the end).

## Review Focus

The inputs a person using this will meet first, each pinned in the task that owns it:

1. **Archive on a session that is working** — the confirm asks first, and only "Archive anyway" sends `interrupt`; the door stops it, then archives (Task 4: `a busy row with interrupt proceeds, and the stop comes first`; Task 5: `with interrupt, stops the busy workspace FIRST`; Task 8: `busy, either kind`).
2. **The phone saw idle, ccd sees a turn start** — the door's live read said idle, `ws-archive` answers `session-busy`: a typed `409 session-busy`, and the sheet turns to the busy question with nothing lost (Task 4: `archiveOutcome … the race after the live read`; Task 5: `maps ccd's own session-busy`; Task 8: `found busy after all`).
3. **A coordinator with open runs, one of them already `closing`** — "End programme and archive" reads every run's row first, finds the `closing` one before it ends any (whatever its id order), answers `programme-partly-ended` with nothing closed, and stops or archives NOTHING; an abandon that still refuses at the act, or throws, stops the door at that run, naming closed and not-closed runs, and the actions sheet then offers "Stop only" (Task 3: `a run already closing … refuses`, `hands over the arm's own pre-read too`; Task 4: `found BEFORE any run is ended`, `refuses AT the act`, `THROWS after another run was ended`; Task 5: `found BEFORE any run is ended` in both id orders, `refused AT the act`; Task 8: `a partly ended programme says what ended`, `offered after a programme it could not end`).
4. **Remote mode, and the worktree is gone** — the server cannot read `~/worktrees` there, so the door proceeds and `ccd` refuses `worktree-gone`; after a programme end that answer names the ended runs, the sheet says so first and offers "Stop only" (Task 4: `an UNMEASURED worktree is not a refusal`; Task 5: the remote-mode describe; Task 8: `a refusal AFTER the programme was ended`).
5. **A main checkout archived, then brought back** — it is stopped (never sent to `ws-archive`), folds into Archived, offers Restore, and Restore ensures it (never `ws-restore`); started again, it leaves the fold (Task 1: `inArchivedFold — every row shape`; Task 5: `stops an idle main checkout`; Task 9 and Task 10: Restore POSTs `/ensure`; Task 11: `folds a STOPPED main checkout`).
6. **A stop that worked and an archive that did not** — the partial outcome keeps the row visible, stopped, with Archive offered again; the toast says so (Task 4: `the partial outcome`; Task 5: `stopped, then refused`; Task 8: `stopped but not archived`; Task 11: `a stopped workspace that is not archived` stays top-level).
7. **The PWA meets an older server** — an answer with no `archived` key is a completed archive (Task 7: `absence permits`).
8. **A main checkout starts a turn while the door is mid-way** — its stop refuses nothing, so the door reads its busy fail-closed (tmux `unknown`, an unread pane pid or no live file is busy) and re-reads it at the stop: a turn begun during the claim reads, the mutex wait or the programme end answers `409 session-busy` naming what was ended (Task 5: `tmux cannot be asked`, `the pane pid cannot be read`, `no live file`, `a turn that starts DURING the programme end`, `refused BEFORE its programme is ended`).
9. **The coordination store cannot be read, or throws** — every consent refuses `409 coordinator-has-open-runs` with `runs: []` (never a 500), and the actions sheet offers "Stop only", so the session still has a way down; the header's sheet says where it is (Task 4: `a store read that THROWS`; Task 5: `a store that THROWS`; Task 8: `offered after a store this box could not read`, `never offered where the caller does not ask`).

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `shared/api.ts` | 1 | `ARCHIVE_REFUSALS`, `ArchiveRefusal`, `ARCHIVE_REFUSAL_CODES`, `isArchiveRefusal`, `ARCHIVE_STOP_ONLY`, `ArchiveBody`, `ArchiveAnswer`, `archiveInterrupts`, `inArchivedFold`, `archivedFoldSince` — appended at the file's end |
| `server/src/server.ts` | 1, 5 | Task 1: the two `run-open` literals read the const. Task 5: the door's handler, `stopArgvFor` (shared with `/stop`), `liveRowFor`, `idleForStop` (a main checkout's busy, fail-closed), the handle captured from `registerCoordRoutes` |
| `pwa/src/fleet/ArchiveConflictSheet.tsx` | 1, 8 | Task 1: the `run-open` reader reads the const. Task 8: typed refusals in words; `runPhrase`, `claimedSentence`, `CLAIMED_CONSEQUENCE` exported for the new sheet |
| `server/test/archive-wire.test.ts`, `single-definition.test.ts`, `readme-holds.test.ts` | 1 | the vocabulary and the predicates; one spelling of each code; README's archive-gate grounding moves to the const |
| `server/src/coord/store.ts`, `server/test/archive-store.test.ts` | 2 | `openRunsClaimedBy(claimantId)` against a real `coord.db` |
| `server/src/coord/close.ts`, `server/src/coord/routes.ts`, `server/test/archive-coord-handle.test.ts` | 3 | `abandonMove` (the abandon arm's transition rule, extracted) and `abandonRefusal`; `CoordRoutesHandle.withAbandon` hands both the abandon and that pre-read; the abandon route runs through it |
| `server/src/coord/archiveDoor.ts`, `server/test/archive-door-decide.test.ts`, `archive-ccd-words.test.ts` | 4 | the decision, ccd's refusal words (produced by the real verb in fixture HOMEs), the answer on the wire (`archiveOutcome`, `busyAtStop`) |
| `server/test/archive-door.test.ts`, `lifecycle.test.ts`, `pr-routes.test.ts`, `routes.test.ts` | 5 | the door end to end; three older suites' fixtures gain a real worktree; `routes.test.ts` gains the door's `503 registry-unmeasurable` |
| `server/test/box-token-census.test.ts`, `CLAUDE.md` | 6 | the census entry that can see `server.ts`, and the bullet that names the route |
| `pwa/src/lib/api.ts`, `pwa/test/api.test.ts`, `archive-partial.test.ts` (+ three fixture lines in `archive-conflict-sheet.test.tsx`, `fleet-screen.test.tsx`) | 7 | the consents, the read answer, `ARCHIVE_REFUSAL_TEXT`, `archivePartial` |
| `pwa/src/fleet/ArchiveSheet.tsx`, `pwa/test/archive-sheet.test.tsx` | 8 | the one Archive's conversation; `isPutAway`, `restoreSession` |
| `pwa/src/fleet/SessionActionsSheet.tsx`, `pwa/test/session-actions-sheet.test.tsx` | 9 | every session offers Archive; Restore on every put-away row; "Stop only" |
| `pwa/src/session/SessionHeader.tsx`, `pwa/src/screens/SessionScreen.tsx`, `pwa/src/components/QuickConfirm.tsx`, `pwa/test/header.test.tsx`, `lifecycle-ui.test.tsx`, `typed-label.test.tsx` | 10 | the header's Archive/Restore; Stop session removed |
| `pwa/src/fleet/groupFleet.ts`, `pwa/src/screens/FleetScreen.tsx`, `pwa/test/groupFleet.test.ts`, `fleet-screen.test.tsx` | 11 | the Archived fold on `inArchivedFold`, newest first |
| `README.md`, `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`, `CLAUDE.md` | 12 | the operator paragraph; CCR-15's §5.9 sentence (workspace lifecycle §6 item 3); the README size claim |

**Not modified, deliberately:** `ccd/*` and the skills; `server/src/coord/close.ts`'s behaviour (the `childReclaim` port is already on `main` and already wired by the abandon route — Task 3 shares that wiring, it does not respell it; the file changes only by extracting the abandon arm's transition rule into `abandonMove`, which the arm then calls, and adding its reader `abandonRefusal` — `coord-abandon.test.ts` is green before and after); `POST /api/sessions/:id/stop`'s behaviour; `sessionBucket` and `fleet-lifecycle.test.ts`; `ProjectCard.tsx` (it renders `group.archived` as it is); `PrSheet.tsx` (its "Archive now" keeps its toast and now shows the typed words — Open question 1); `pwa/src/fleet/archiveReleased.ts` (wave 1's "Archive all" sends plain archives of workspaces, which the door never stops, so the partial outcome cannot reach it); `server/test/session-hook.test.ts` (the census is re-measured, not edited).

## Pre-flight findings (measured while planning; not deviations unless they say so)

Measured 2026-10-01 on a prototype of this plan's exact edits — a detached worktree, one commit per task, over `aefc8415` — by replaying this document's blocks onto a fresh worktree of the same base task by task: every stage is byte-identical to the prototype's commit for that task, and the last stage to the prototype's tree (`diff -r`, `.git` and `node_modules` excluded, prints nothing).

1. **In remote mode the server cannot see a workspace's worktree** — the deviation `archive-door-defers-unmeasured-worktree-to-ccd`. The agent's read roots (`checkPath`, `agent/src/whitelist.ts`) are `.cc-sessions`, `.cc-limits`, `.cc-clips`, the projects root and the `.claude*` homes; worktrees live under `~/worktrees` (`WORKTREES_ROOT`, `ccd/ccd`), and `cmd_pr_open`'s own comment already says the server cannot read them. A `stat` there answers `unreadable` (`remote/io.ts`'s `statMeasured`), so the door that the first prototype built — refusing `503 worktree-unmeasured` on any unmeasured worktree — would have refused EVERY archive on the live, remote-mode deployment while every test (local io) stayed green. The door now refuses only a PROVEN absence (local mode) and leaves the unmeasured worktree to `cmd_ws_archive`'s `[[ -d "$workdir" ]] || die "worktree is gone: …"`, which precedes ccd's act. The consequence, pinned in Task 5 and stated in the spec amendment: in remote mode a coordinator whose worktree is gone can have its programme ended before `ws-archive` refuses; that 409 carries `ended`, and the sheet says the programme was ended before it shows the refusal and "Stop only".
2. **The close-path port is already on `main`.** CCR-15 wave 3 (#187) wired `childReclaim: childReclaimPort(deps, coord)` into both the close and the abandon routes; `close.ts` needs nothing for the port (it gains only `abandonMove` and `abandonRefusal`, finding 3). The abandon route built its `CloseRunDeps` inline and ran `closeRun(closeDeps, id, { intent: 'abandon' }, 'operator')` inside `coordMutex.run`; Task 3 moves exactly that into `withAbandon` and both callers use it (`dispatch-mutex-gate.test.ts` stays green: `closeRun` is still lexically inside `coordMutex.run`). The base's archive route said, of its missing mutex, "the change is to have `registerCoordRoutes` return its mutex" — this is that change.
3. **What a run the abandon arm cannot move answers, and when the door finds it.** `closeRun`'s abandon arm aims a non-planned run at `closing`; a run already `closing`, or in `unknown`, answers `{ok:false, kind:'bad-transition', from, to:'closing'}` and nothing reaches the box (Task 3). That answer is readable from the run's row before anything is ended, and found only at its own turn it made the outcome depend on id order (measured on the first prototype: `closing` first → nothing ended; `closing` last → run 1 irreversibly `failed`). So the arm's rule moves verbatim into `abandonMove` (`close.ts`), the arm calls it, and `abandonRefusal` reads it for a run without acting; `withAbandon` hands that pre-read to the door inside the same mutex hold, and the door asks it of every claimed run before the first abandon (Task 4: `found BEFORE any run is ended`; Task 5: both id orders, nothing ended). A `planned` run goes straight to `failed`; a dispatched CHILD worker's run releases its workspace and queues its reclaim on the session's own queue, as an operator abandon does (Task 5's CHILD case, measured: `ws-release` then the archive, and a `child reclaim deferred` feed row).
4. **`run-open` was three code-line literals on the base**, not two: `server.ts` twice and `ArchiveConflictSheet.tsx` once. Two vocabularies share spellings with the door's and are excused by name in the single-definition scan: `server/src/wsaudit.ts` keys its audit sentences by `session-busy` and `status-unknown` (ccd's audit verdict words), and `className="run-open"` is the runs board's row button.
5. **`ws-archive`'s refusals, produced by the real verb** (Task 4, fixture HOME): `ccd: session-busy`, `ccd: status-unknown`, `ccd: worktree is gone: <path> — …`, and the manifest family `ccd: cannot describe <id> truthfully — nothing was touched` (a stranger tree) / `empty archive manifest for <id> — …` / `archive manifest for <id> is not valid JSON — …` (both by overriding `_ws_archive_manifest` in the fixture shell, as the file's other cases override `tmux` and `_session_verdict`; rows S53 and S54 red their word away). Every other refusal (`no such session`, `not a workspace`, `incomplete registry`, a usage or flag error) keeps today's `502 {stderr}`. `already archived <id>` exits 0. "Stop only" keys on exactly the three the phone cannot fix — the deviation `archive-refusals-carry-the-stop-only-three`, since the spec names the refusals but declares only its own four codes.
6. **"Busy" is the fleet frame's own derivation, re-read — and for a main checkout, read fail-closed.** `liveRowFor` runs `assembleFleet` over the one registry row (`[rec]`), with this session's hook state read now through `readHookState` (the watcher's own reader), the watcher's newest dialog and statusline maps, and no `coord` (no field the predicate reads comes from it). `archiveInterrupts` is `status === 'busy'` or bucket `working`/`attention`: the ladder's `attention` is a pane dialog or a hook `waiting` — a turn in progress — never a coordination ask. A live `busy` counts even where the hook says the turn finished, which is what `ws-archive`'s own `_ws_status` refuses on. A workspace is read this way, with `ws-archive`'s fail-closed `_ws_status` behind the door. A main checkout's stop (`cmd_stop`) refuses nothing, so the door's own read is its only guard, and the frame's derivation folds what it could not measure towards rest: D-309 turns tmux `unknown` into dead, an unread pane pid leaves `idle`, an absent live file reads `idle`. The review round measured a busy main checkout stopped without `interrupt` in each case, and when a turn began after the read (during the abandon's `ws-release`, and during the coordination-mutex wait); rows S55–S59 put each of those back and red. So for a main checkout busy is read by `_ws_status`'s own rule (`idleForStop`): `gone` is idle; a live pane is idle only when its live file affirmatively reads `idle` and the predicate is false; tmux `unknown`, an unread pid, a wrapper with no config dir or an unread live file is busy. Without `interrupt` it is re-read immediately before the stop, so a turn begun during the claim reads, the mutex wait or the programme end answers `409 session-busy` with `ended` (`busyAtStop`). Applying the fail-closed read to workspaces too (measured: `22 failed | 185 passed (207)` — ten older `lifecycle`, `routes` and `pr-routes` cases and twelve of the door's own, whose workspace fixtures publish no live file) would buy nothing `ws-archive`'s `_ws_status` does not already refuse.
7. **The census.** `coord-pause-route.test.ts`'s `SESSION_ONLY` harvest reads `coord/routes.ts` alone; `box-token-census.test.ts` keeps `KICKOFF` (and `UPDATE_DOORS`) as hand-kept literals for that reason and checks CLAUDE.md's bullet against the union in both directions. Task 6 adds `ARCHIVE` there; the bullet then MUST name the route (measured red without the sentence: `does not name /api/sessions/:id/archive`).
8. **CLAUDE.md's README size claim is a pin.** `pools-prose.test.ts` keeps `README.md` (~N lines) within 100 lines of the file. The base README is 3687 lines against "~3600"; Task 12's paragraph makes it 3711 and reds the pin (`expected 111 to be less than or equal to 100`), so Task 12 sets "~3700". CCR-15 wave 4 adds 13 README lines net; 3724 is still inside.
9. **The citation tax is zero, measured both ways.** The planner's `citetax.py` (below) finds three line citations into the files this wave changes, in README, the S6-R11 corpus and the two specs that cite by line — README's `shared/api.ts:7641-7643` (and its `:7683`, `:7691`, `:7704`), plan A's `shared/api.ts:5644`, CCR-15's design's `shared/api.ts:3856-3857` — all above this wave's first `shared/api.ts` line (8948); none moved. `session-hook.test.ts`'s citation cases: `7 passed | 328 skipped (335)` on the base and on the tree.
10. **CCR-15 wave 4 (#215, open at `e2124728`) overlaps ten files and no hunk.** Both edit `CLAUDE.md`, `README.md`, `pwa/src/lib/api.ts`, `pwa/test/api.test.ts`, `server/src/coord/close.ts`, `server/src/coord/routes.ts`, `server/src/coord/store.ts`, `server/src/server.ts`, `server/test/single-definition.test.ts` and `shared/api.ts` (`close.ts`: #215 changes the abandon arm's `childGateAtClose` call, ten lines below the extracted rule, and merges clean). `git merge-tree` of the prototype with `origin/ws/swift-hollow` conflicts in exactly the five files, with identical conflict hunks (marker labels aside), that the BASE already conflicts in against it (README's stall-watch paragraph and two citation lines, `ccd/ccd`'s generated stamp, three `store.ts` hunks, `watch.ts`'s import list, `session-hook.test.ts` — all `main` against #215, none this wave's). Landing #215 FIRST, on a base-plus-#215 tree with both sides kept in those conflicts (`store.ts`'s three hunks are adjacent additions — #215's patch applied over the base's file; `watch.ts`'s import list is the union; README's stall-watch and reclaim-sweep paragraphs both kept, and #215's side of the citation lines, `ccd/ccd`'s stamp and `session-hook.test.ts`): every Find below occurs exactly once (109 blocks), the server, server-tests and PWA typechecks are clean before and after this wave, this wave's fourteen server test files (641 tests) and sixteen PWA test files (708) pass, the citation tax is `checked 3 citations into 15 changed source files; moved 0`, and the README is 3724 lines, inside Task 12's `~3700`. The census's four citation cases (`session-hook.test.ts`) red identically there before and after this wave — that synthetic merge's own README and census citations, which #215 resolves itself. Landing this wave first: #215 meets no new conflict. Either order: no hunk of this wave's to resolve by hand.
11. **`/stop` is unchanged in behaviour.** Its argv construction moves verbatim into `stopArgvFor(id, rec, identity)`, a function declaration (so `verb-gate.test.ts`, which reads a call site's skew gate off its enclosing function, still finds `stop` ungated by decision); `/stop` calls it and answers through `runCcdOr502` as before. `routes.test.ts`, `verb-gate.test.ts` and `whitelist-subset.test.ts` are green on the tree.
12. **`api.archive` now resolves the door's answer** (`ArchiveAnswer | null`, `null` for a 2xx with nothing readable). Its other callers ignore the value and stay correct: `ArchiveConflictSheet` (`{force:true}` on a workspace), `PrSheet` (plain, a workspace), and wave 1's `archiveReleased` (plain, workspaces only). A plain archive of a workspace is never stopped by the door, so it can never meet the partial outcome.
13. **Accepted, and stated rather than fixed:** (a) between the claim checks (inside `coordMutex`) and the stop and `ws-archive` (after it is released, so a slow manifest cannot hold every coordinator's close), a dispatch could bind a new run to the workspace — the base's forced-path race, narrowed, not closed; (b) `primitives.test.tsx` still exercises `QuickConfirm` with `confirmLabel: 'Stop session'` as example props — a primitive's test, not product text; (c) the actions sheet already offers "Restart session" (ensure) on every row, so a stopped main checkout offers Restore and Restart session, both `ensure`; (d) the route's own `rec.workspace === null ? null : …` guard and the decision's `wsArchive: m.workspace` both keep a main checkout from `ws-archive`; only the second is pinned (row S29), and mutating the first alone stays green by construction (row S42); mutating both reds the main-checkout door cases (row S42c, the control: `3 failed`); (e) the route's `live === null` reading of a workspace's busy is unreachable by construction (`assembleFleet` maps its records 1:1) and is kept, not pinned — row S37 mutates the predicate arm instead; (f) what only an abandon's act measures — the sibling read, a hand-over hold, the verb, ccd's own answer — can still refuse after an earlier run was ended; the door then stops there and names what it closed (`programme-partly-ended`), so a partly ended programme remains possible for those, never for a refusal the row alone shows; (g) `ArchiveSheet`'s `ARCHIVE_STOP_ONLY.includes` cannot be widened observably — every refusal that reaches its `refused` arm is one of the three, the unreadable store or a `501 unsupported` — so row P12 narrows it instead (Stop only keyed on one code), which reds.
14. **Suites on the prototype.** Server: every test file that imports a module this wave changes or scans text it changes — the planning round's 204 files, re-run in the review round as the 201 that are not bash-subject suites (`close.ts`'s importers were already on that list): `7342` tests green but `typecheck-tests.test.ts`'s three environment cases (above; identical on the base) and one load flake, `session-hook.test.ts`'s timing-ratio case, green alone (`335 passed (335)`); the doc-reading cases of `ccrc-doctor`, `ccrc-install-graphify`, `ccrc-update` and `ccrc-versioned-audit` (16) green in the planning round, and none of them reads a document the review round changed. Left out by construction, with the reason: the 42 `ccd-*` suites (they drive `ccd/ccd`, which this wave does not touch; the two that mention `README.md` write a fixture README) and the bash-subject suites' other cases. PWA, unsharded: `3189 passed` in 103 files — the 101 test files and the two type-level `*.test-d` files `vite.config.ts`'s `typecheck` runs (the planning round measured `3135` in 99 files on the base and `3181` in 101 on its prototype, in two shards); `npm run build` succeeds. Measured on a box at load 10 to 45, one vitest process at a time.
15. **The door now reads the row's identity.** `/stop`'s ladder runs first: an unmeasured registry field answers `503 registry-unmeasurable` and runs no verb (Task 5's `routes.test.ts` case, row S47). The base's archive route never read identity and went straight to `ws-archive`, so a workspace with an unreadable registry field, archivable before this wave, now is not until the row reads — fail-shut, because the stop argv recomputes a tmux name from those fields.

## The citation tax (S6-R11), mechanised

The rule: an edit to a file that a line-citing document points into must leave every cited line where it was, or repair the citing document by content in the same commit. This wave's measurement, run on the base and on the tree. `citetax.py` compares the two trees' COMMITTED heads (`git diff --name-only <before HEAD> HEAD`), so run it after Task 12's commit, against a worktree of the merge base:

```bash
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus' )
git worktree add --detach <SCRATCH>/base $(git merge-base HEAD origin/main)
python3 <SCRATCH>/citetax.py <SCRATCH>/base .
git worktree remove --force <SCRATCH>/base
```

Expected: `7 passed | 328 skipped (335)` both times; `checked 3 citations into 15 changed source files; moved 0`. The checker (planner tooling, never committed — write it to `<SCRATCH>/citetax.py` if you re-run it):

````python
#!/usr/bin/env python3
"""citetax.py <before-tree> <after-tree> — the citation tax (S6-R11), mechanised for this wave.

For every NON-TEST file the wave changes (git diff --name-only between the two trees' HEADs), find every `<path>:N` or
`<path>:N-M` citation of it in the documents that cite by line and that the wave must keep true: README.md and
CLAUDE.md (repaired by content when they move), the S6-R11 corpus `server/test/session-hook.test.ts` audits (the
graphify compaction-card spec and plan A), and the two specs whose contracts cite `shared/api.ts` by line (CCR-15's
design, R9, and the workspace-lifecycle design). A citation is MOVED when the cited line's text differs between the
two trees. Prints each moved citation and a total; exit 1 when any moved. Writes nothing."""
import re, subprocess, sys
before, after = sys.argv[1], sys.argv[2]
DOCS = ['README.md', 'CLAUDE.md',
        'docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md',
        'docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md',
        'docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md',
        'docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md']
head = lambda t: subprocess.run(['git', '-C', t, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
names = subprocess.run(['git', '-C', after, 'diff', '--name-only', head(before), 'HEAD'], capture_output=True,
                       text=True).stdout.split()
moved_files = [n for n in names if not re.search(r'(^|/)test/', n) and not n.endswith('.md')]
def lines(tree, rel):
    try: return open(f'{tree}/{rel}', encoding='utf8').read().split('\n')
    except FileNotFoundError: return None
total, cited = 0, 0
for f in moved_files:
    b, a = lines(before, f), lines(after, f)
    # Full path, or the path's tail from its last two segments (README writes `coord/store.ts:N` as often as the full one).
    tails = {f, '/'.join(f.split('/')[-2:])}
    pat = re.compile(r'(?<![A-Za-z0-9_./-])(' + '|'.join(re.escape(t) for t in sorted(tails, key=len, reverse=True)) + r'):(\d+)(?:[-–](\d+))?')
    for d in DOCS:
        text = lines(after, d) or []
        for i, l in enumerate(text, 1):
            for m in pat.finditer(l):
                lo = int(m.group(2)); hi = int(m.group(3) or lo); cited += 1
                if b is None: continue
                bt = b[lo-1:hi] if hi <= len(b) else None
                at = a[lo-1:hi] if a is not None and hi <= len(a) else None
                if bt != at:
                    total += 1
                    print(f'MOVED {d}:{i}  {m.group(0)}  base={bt!r:.90}  tree={at!r:.90}')
print(f'checked {cited} citations into {len(moved_files)} changed source files; moved {total}')
sys.exit(1 if total else 0)
````

If `main` has moved and the census reds after your merge, a NEW citation now points below this wave's insertion: repair the citing text by content, never by adding a delta to a number, and never edit the census to match.

## How to read the blocks

Each edit is a block headed by an HTML comment, `<!-- replay: T<task> <create|replace> <path> -->`. A **replace** shows the text to find — it occurs exactly once in the file at that point of the plan — and the text that replaces it; a **create** shows a whole new file. A block's text is the lines between its fences; it ends with a newline unless the comment says `old-inline` (the Find) or `new-inline` (the Replace), which mark a fragment inside a line. An empty Replace deletes the Find. Apply the blocks in the order given: Step 1 of each task holds its test edits (the red stage), Step 3 its source edits. The planner's replay tool applies exactly these blocks to a fresh base and reproduces the prototype byte for byte, stage by stage.

---

### Task 1: The vocabulary and the predicates (L0), one spelling of each code

**Model routing:** `sonnet`, effort `high` — transcription of the blocks below; the tests are the check.

**Files:**
- Modify: `shared/api.ts` (one block, appended below `REVIEW_DONE_SUBJECT`, the file's last line — below every line README, the S6-R11 corpus and CCR-15's contract cite)
- Modify: `server/src/server.ts` (an import line; the two `run-open` literals)
- Modify: `pwa/src/fleet/ArchiveConflictSheet.tsx` (an import line; the `run-open` reader)
- Create: `server/test/archive-wire.test.ts`
- Modify: `server/test/single-definition.test.ts` (an import line; one describe appended), `server/test/readme-holds.test.ts` (the archive-gate grounding)

**Interfaces:**
- Produces: `ARCHIVE_REFUSALS` (`runOpen`, `sessionBusy`, `coordinatorHasOpenRuns`, `programmePartlyEnded`, `worktreeGone`, `statusUnknown`, `manifestUnbuildable`), `type ArchiveRefusal`, `ARCHIVE_REFUSAL_CODES`, `isArchiveRefusal(v): v is ArchiveRefusal`, `ARCHIVE_STOP_ONLY` (exactly the last three), `interface ArchiveBody { force?: true; interrupt?: true; programme?: 'end' }`, `interface ArchiveAnswer { ok: true; archived; stopped; ended; refusal?; detail? }`, `archiveInterrupts(s: Pick<FleetSession,'status'|'bucket'>)`, `inArchivedFold(s: Pick<FleetSession,'bucket'|'workspace'|'status'|'stoppedBy'>)`, `archivedFoldSince(s): number | null` (epoch ms). Every later task reads these; none restates a code.

- [ ] **Step 0: Install each package's own modules** (a symlinked or missing copy reds three `typecheck-tests` cases on the base too):

```bash
( cd server && npm ci ) && ( cd pwa && npm ci ) && ( cd agent && npm ci )
```

- [ ] **Step 1: Write the failing tests.**

<!-- replay: T1 create server/test/archive-wire.test.ts -->
Create `server/test/archive-wire.test.ts`:

````ts
// Workspace lifecycle wave 2 (spec §5.2): the archive door's L0 vocabulary and the two predicates the board and the
// door share — `inArchivedFold` (the Archived fold's one membership rule) and `archiveInterrupts` (busy, either kind).
import { describe, it, expect } from 'vitest';
import {
  ARCHIVE_REFUSALS, ARCHIVE_REFUSAL_CODES, ARCHIVE_STOP_ONLY, archiveInterrupts, archivedFoldSince, inArchivedFold,
  isArchiveRefusal, type FleetSession,
} from '../../shared/api.js';

const base: FleetSession = {
  id: 'demo-amber', wrapper: 'claude', home: '/home/rc', project: 'demo', workdir: '/data/projects/demo',
  workspace: 'amber', name: null, status: 'idle', statusUpdatedAt: null, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null,
  unmeasured: [], statusUnmeasured: false, lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null,
  started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, releasedFrom: null,
};
const row = (over: Partial<FleetSession>): FleetSession => ({ ...base, ...over });
const STOP = { at: 1_790_000_000_000, surface: 'pwa' as const };

describe('ARCHIVE_REFUSALS — the door vocabulary, declared once', () => {
  it('holds the spec\'s four codes and the three the phone cannot fix, and nothing else', () => {
    expect([...ARCHIVE_REFUSAL_CODES].sort()).toEqual([
      'coordinator-has-open-runs', 'manifest-unbuildable', 'programme-partly-ended', 'run-open',
      'session-busy', 'status-unknown', 'worktree-gone',
    ]);
    expect(ARCHIVE_REFUSAL_CODES).toEqual(Object.values(ARCHIVE_REFUSALS));
  });

  it('offers "Stop only" after exactly the three refusals the phone cannot fix', () => {
    expect([...ARCHIVE_STOP_ONLY].sort()).toEqual(['manifest-unbuildable', 'status-unknown', 'worktree-gone']);
    for (const c of ARCHIVE_STOP_ONLY) expect(ARCHIVE_REFUSAL_CODES).toContain(c);
  });

  it('isArchiveRefusal accepts exactly the codes', () => {
    for (const c of ARCHIVE_REFUSAL_CODES) expect(isArchiveRefusal(c)).toBe(true);
    for (const v of ['busy', 'Run-open', '', null, undefined, 7]) expect(isArchiveRefusal(v)).toBe(false);
  });
});

describe('inArchivedFold — every row shape (spec §5.2)', () => {
  it.each([
    ['an archived workspace', row({ status: 'dead', archivedAt: 1_790_000_000, bucket: 'archived', bucketSince: 1 }), true],
    ['a stopped main checkout', row({ workspace: null, status: 'dead', bucket: 'dead', stoppedBy: STOP }), true],
    ['a main checkout started again — the stop stamp is gone', row({ workspace: null, status: 'idle', stoppedBy: null }), false],
    ['a main checkout that is live while the stamp still reads (a revive in flight)',
      row({ workspace: null, status: 'busy', bucket: 'working', stoppedBy: STOP }), false],
    ['a crashed main checkout — dead, never stopped', row({ workspace: null, status: 'dead', bucket: 'dead', stoppedBy: null }), false],
    ['a stopped WORKSPACE that is not archived — it stays top-level with Archive again',
      row({ status: 'dead', bucket: 'dead', stoppedBy: STOP }), false],
    ['a merged-and-archived workspace — `cleanup` stays in the live list', row({
      status: 'dead', archivedAt: 1_790_000_000, bucket: 'cleanup', bucketSince: 1, stoppedBy: STOP,
    }), false],
    ['a live idle workspace', row({}), false],
  ] as const)('%s', (_label, s, want) => {
    expect(inArchivedFold(s)).toBe(want);
  });

  it('reads a row from a server older than `stoppedBy` (the key absent on a cast frame) as not folded', () => {
    const { stoppedBy: _drop, ...rest } = row({ workspace: null, status: 'dead', bucket: 'dead' });
    expect(inArchivedFold(rest as FleetSession)).toBe(false);
  });
});

describe('archivedFoldSince — the fold\'s sort key', () => {
  it('is the archive time for a workspace, the stop time for a main checkout, null for neither', () => {
    expect(archivedFoldSince(row({ bucket: 'archived', bucketSince: 1234, stoppedBy: STOP }))).toBe(1234);
    expect(archivedFoldSince(row({ workspace: null, status: 'dead', bucket: 'dead', stoppedBy: STOP }))).toBe(STOP.at);
    expect(archivedFoldSince(row({ workspace: null, status: 'dead', bucket: 'dead', stoppedBy: null }))).toBeNull();
  });
});

describe('archiveInterrupts — busy, either kind', () => {
  it.each([
    ['Claude Code\'s own word is busy', row({ status: 'busy', bucket: 'working' }), true],
    ['the live file says busy but the hook says the turn finished', row({ status: 'busy', bucket: 'done' }), true],
    ['the hook says a turn is in flight while the live file reads idle', row({ status: 'idle', bucket: 'working' }), true],
    ['a question is waiting on the operator', row({ status: 'idle', bucket: 'attention' }), true],
    ['idle', row({ status: 'idle', bucket: 'idle' }), false],
    ['done', row({ status: 'idle', bucket: 'done' }), false],
    ['dead', row({ status: 'dead', bucket: 'dead' }), false],
    ['archived', row({ status: 'dead', bucket: 'archived' }), false],
  ] as const)('%s', (_label, s, want) => {
    expect(archiveInterrupts(s)).toBe(want);
  });
});
````

<!-- replay: T1 replace server/test/single-definition.test.ts -->
In `server/test/single-definition.test.ts`, find:

````ts
  SPAWN_VERDICTS,
} from '../../shared/api.js';
````

Replace with:

````ts
  SPAWN_VERDICTS,
} from '../../shared/api.js';
import { ARCHIVE_REFUSALS } from '../../shared/api.js';
````

<!-- replay: T1 replace server/test/single-definition.test.ts -->
In `server/test/single-definition.test.ts`, find:

````ts
    expect(spelling('stall:').test('const d = `stall:${arm}`;')).toBe(true);
  });

  it.each(LITERALS)("'%s' is spelled on a code line in %s alone", (lit, home) => {
    expect(ALL.filter((f) => spelling(lit).test(stallCode(f))).map(rel).sort(), `a second '${lit}'`).toEqual([home]);
  });
});
````

Replace with:

````ts
    expect(spelling('stall:').test('const d = `stall:${arm}`;')).toBe(true);
  });

  it.each(LITERALS)("'%s' is spelled on a code line in %s alone", (lit, home) => {
    expect(ALL.filter((f) => spelling(lit).test(stallCode(f))).map(rel).sort(), `a second '${lit}'`).toEqual([home]);
  });
});

describe('the archive door\'s refusal codes are spelled once, in L0 (workspace lifecycle wave 2)', () => {
  // `ARCHIVE_REFUSALS` (spec §5.2) is the one declaration; the server sends `ARCHIVE_REFUSALS.<name>` and the PWA
  // compares against it. `run-open` was a bare literal written twice in `server.ts` and once in
  // `ArchiveConflictSheet.tsx` before this wave. Code lines only (`stallCode`): prose names the codes in backticks.
  // Two OTHER vocabularies share spellings, and each is excused here by name rather than by widening the scan:
  //   - `server/src/wsaudit.ts` keys its sentences by ccd's AUDIT verdict words, two of which ccd also dies with
  //     in `cmd_ws_archive` (`session-busy`, `status-unknown`) — the audit's seam, not the door's;
  //   - `className="run-open"` is the runs board's row button (D-287), a CSS identity — excluded by the pattern.
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const literal = (code: string): RegExp => new RegExp(`(?<!className=)(['"\`])${esc(code)}\\1`);
  const AUDIT_WORDS = new Set(['session-busy', 'status-unknown']);

  it('CONTROL: the pattern sees a quoted code and passes over a class name and a longer word', () => {
    expect(literal('run-open').test("error: 'run-open',")).toBe(true);
    expect(literal('run-open').test('className="run-open"')).toBe(false);
    expect(literal('worktree-gone').test("'worktree-gone-later'")).toBe(false);
    expect(ALL.filter((f) => literal('coordinator-has-open-runs').test(stallCode(f))).map(rel))
      .toEqual(['shared/api.ts']);
  });

  // The codes as test DATA, bound to the declaration by the first case: a scan driven by `Object.values` alone would
  // scan nothing, and stay green, on a tree where the declaration is gone.
  const CODES = ['run-open', 'session-busy', 'coordinator-has-open-runs', 'programme-partly-ended', 'worktree-gone',
    'status-unknown', 'manifest-unbuildable'];

  it('scans every code the declaration holds', () => {
    expect(Object.values(ARCHIVE_REFUSALS ?? {}).sort()).toEqual([...CODES].sort());
  });

  it.each(CODES)("'%s' is a code-line literal in shared/api.ts alone", (code) => {
    const want = AUDIT_WORDS.has(code) ? ['server/src/wsaudit.ts', 'shared/api.ts'] : ['shared/api.ts'];
    expect(ALL.filter((f) => literal(code).test(stallCode(f))).map(rel).sort(), `a second '${code}'`).toEqual(want);
  });
});
````

<!-- replay: T1 replace server/test/readme-holds.test.ts -->
In `server/test/readme-holds.test.ts`, find:

````ts
    const serverTs = readFileSync(path.join(root, 'server', 'src', 'server.ts'), 'utf8');
    expect(serverTs).toMatch(/'run-open'/);
````

Replace with:

````ts
    // Workspace lifecycle wave 2: the code is L0's `ARCHIVE_REFUSALS.runOpen`, declared once and read by the door.
    expect(readFileSync(path.join(root, 'shared', 'api.ts'), 'utf8')).toMatch(/runOpen: 'run-open'/);
    const serverSrc = (readdirSync(path.join(root, 'server', 'src'), { recursive: true }) as string[])
      .filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(path.join(root, 'server', 'src', f), 'utf8'));
    expect(serverSrc.some((t) => t.includes('ARCHIVE_REFUSALS.runOpen'))).toBe(true);
````

<!-- replay: T1 replace server/test/readme-holds.test.ts -->
In `server/test/readme-holds.test.ts`, find:

````ts
import { readFileSync } from 'node:fs';
````

Replace with:

````ts
import { readFileSync, readdirSync } from 'node:fs';
````

- [ ] **Step 2: Run them to verify they fail.**

Run: `( cd server && ./node_modules/.bin/vitest run test/archive-wire.test.ts test/single-definition.test.ts test/readme-holds.test.ts )`
Expected: `31 failed | 266 passed (297)` — all 21 `archive-wire` cases (`TypeError: ARCHIVE_REFUSAL_CODES is not iterable`, `ARCHIVE_STOP_ONLY is not iterable`, the predicates undefined), the nine new `single-definition` cases (the CONTROL too: `shared/api.ts` holds no code yet; `a second 'run-open': expected [ …(2) ]` — `server.ts` and `ArchiveConflictSheet.tsx`), and `readme-holds`' `states the archive gate as it now is` (`expected … to match /runOpen: 'run-open'/`).

- [ ] **Step 3: Declare the vocabulary and read it.**

<!-- replay: T1 replace shared/api.ts -->
In `shared/api.ts`, find:

````ts
export const REVIEW_DONE_SUBJECT = 'review-done';
````

Replace with:

````ts
export const REVIEW_DONE_SUBJECT = 'review-done';

/**
 * The archive door's refusal codes (workspace lifecycle spec §5.2): every `error` word `POST
 * /api/sessions/:id/archive` refuses with, declared ONCE. The server sends them and the PWA branches on them and says
 * each in words; neither spells one as a bare literal (`single-definition.test.ts`). Appended at the end of this file,
 * like `REVIEW_DONE_SUBJECT` above, so no line README or a contract cites moves.
 *
 *   - `runOpen` — a non-terminal run names this session as its WORKER. `{force:true}` proceeds; the 409 names the runs.
 *   - `sessionBusy` — a turn is in progress: read live on the request (`archiveInterrupts`), or answered by ccd after
 *     that read (a race). `{interrupt:true}` stops the session first, and the turn is lost.
 *   - `coordinatorHasOpenRuns` — this session is the CLAIMANT of a non-terminal run. `{programme:'end'}` ends the
 *     programme first; the 409 names the runs, or carries `runs: []` when the store could not be read (fail-shut).
 *   - `programmePartlyEnded` — `{programme:'end'}` could not end every run. Nothing was stopped or archived.
 *   - `worktreeGone`, `statusUnknown`, `manifestUnbuildable` — the three refusals the operator cannot fix from the
 *     phone (`ARCHIVE_STOP_ONLY`), each ccd's own `cmd_ws_archive` refusal, which it answers before it touches
 *     anything. `worktreeGone` is also the server's, where its box can PROVE the worktree absent (local mode: the
 *     fleet agent's read roots do not include the worktrees, so in remote mode only ccd can tell).
 *
 * A refusal or failure that arrives AFTER `{programme:'end'}` closed runs carries them as `ended` beside its `error`
 * (`archiveOutcome`, `server/src/coord/archiveDoor.ts`): what only ccd measures is measured after the end.
 */
export const ARCHIVE_REFUSALS = {
  runOpen: 'run-open',
  sessionBusy: 'session-busy',
  coordinatorHasOpenRuns: 'coordinator-has-open-runs',
  programmePartlyEnded: 'programme-partly-ended',
  worktreeGone: 'worktree-gone',
  statusUnknown: 'status-unknown',
  manifestUnbuildable: 'manifest-unbuildable',
} as const;
export type ArchiveRefusal = (typeof ARCHIVE_REFUSALS)[keyof typeof ARCHIVE_REFUSALS];

/** Every archive refusal code, DERIVED from `ARCHIVE_REFUSALS` — never a second list. */
export const ARCHIVE_REFUSAL_CODES: readonly ArchiveRefusal[] = Object.values(ARCHIVE_REFUSALS);

export function isArchiveRefusal(v: unknown): v is ArchiveRefusal {
  return typeof v === 'string' && (ARCHIVE_REFUSAL_CODES as readonly string[]).includes(v);
}

/** The refusals after which the session actions sheet offers "Stop only" (spec §5.2): the ones the operator cannot
 *  fix from the phone, so a live session is never left without a way to put it down. Exactly these three. */
export const ARCHIVE_STOP_ONLY: readonly ArchiveRefusal[] = [
  ARCHIVE_REFUSALS.worktreeGone, ARCHIVE_REFUSALS.statusUnknown, ARCHIVE_REFUSALS.manifestUnbuildable,
];

/** `POST /api/sessions/:id/archive`'s body (spec §5.2). Each consent is a SECOND tap, sent only after the operator read
 *  the refusal it answers: `force` answers `run-open`, `interrupt` answers `session-busy` and `programme: 'end'`
 *  answers `coordinator-has-open-runs`. Absent means not given. The PWA builds it (`api.archive`) and the server reads
 *  it by these keys (`archiveFlags`), so a renamed consent is a compile error on both sides. */
export interface ArchiveBody {
  readonly force?: true;
  readonly interrupt?: true;
  readonly programme?: 'end';
}

/** The door's 2xx answer. `archived: true` — the session is put away: a workspace archived, a main checkout stopped
 *  (it folds into Archived and is never deleted). `archived: false` arises only when the door STOPPED the session
 *  and `ws-archive` then refused (`refusal`, or `null` for a refusal this build has no word for, with ccd's text in
 *  `detail`): the row stays at the top level, stopped, with Archive offered again. `ended` lists the runs a
 *  `{programme:'end'}` closed, `[]` when none was asked or none was open. */
export interface ArchiveAnswer {
  readonly ok: true;
  readonly archived: boolean;
  readonly stopped: boolean;
  readonly ended: readonly { readonly id: number; readonly program: string; readonly wave: number; readonly waveOf: number | null }[];
  readonly refusal?: ArchiveRefusal | null;
  readonly detail?: string;
}

/**
 * Whether ARCHIVING this row costs a turn in progress — spec §5.2's "busy (either kind)". ONE predicate: the door
 * reads it off a row it assembles on the request (`assembleFleet` over that one registry row, the fleet frame's own
 * derivation), and the PWA reads it off the row it holds to choose the confirm's words. `status` is Claude Code's own
 * live word (`waiting` already collapsed into `busy`, an unreadable live file painted `busy`, D-115); `working` and
 * `attention` are the bucket ladder's reading of the hook beside it. A dead row is none of these.
 */
export function archiveInterrupts(s: Pick<FleetSession, 'status' | 'bucket'>): boolean {
  return s.status === 'busy' || s.bucket === 'working' || s.bucket === 'attention';
}

/**
 * Whether a row belongs in its card's `Archived (N)` fold (workspace lifecycle spec §5.2) — the ONE predicate the
 * board's split and the actions sheet's Restore gate both read; neither keys on `archivedAt` or `workspace` alone.
 * An archived workspace (the `archived` BUCKET: archived and dead, never `cleanup`), or a STOPPED main checkout (no
 * workspace, no pane, and a stop stamp). A main checkout started again leaves the fold, because `cmd_start` and
 * `cmd_ensure` remove the stop stamp on the attempt; a stopped workspace that is not archived stays at the top level,
 * where Archive is offered again. `stoppedBy` is read `?? null`: the live frame is cast, not revived.
 */
export function inArchivedFold(s: Pick<FleetSession, 'bucket' | 'workspace' | 'status' | 'stoppedBy'>): boolean {
  return s.bucket === 'archived' || (s.workspace === null && s.status === 'dead' && (s.stoppedBy ?? null) !== null);
}

/** When a row entered the Archived fold, the fold's sort key (newest first): `bucketSince` for an archived workspace
 *  (its archive time), the stop stamp's time for a stopped main checkout. `null` when neither is known. */
export function archivedFoldSince(s: Pick<FleetSession, 'bucket' | 'bucketSince' | 'stoppedBy'>): number | null {
  if (s.bucket === 'archived') return s.bucketSince;
  return (s.stoppedBy ?? null)?.at ?? null;
}
````

<!-- replay: T1 replace server/src/server.ts -->
In `server/src/server.ts`, find:

````ts
} from '../../shared/api.js';
````

Replace with:

````ts
} from '../../shared/api.js';
import { ARCHIVE_REFUSALS } from '../../shared/api.js';
````

<!-- replay: T1 replace server/src/server.ts old-inline new-inline -->
In `server/src/server.ts`, find:

````ts
error: 'run-open', runs: [] });
````

Replace with:

````ts
error: ARCHIVE_REFUSALS.runOpen, runs: [] });
````

<!-- replay: T1 replace server/src/server.ts old-inline new-inline -->
In `server/src/server.ts`, find:

````ts
error: 'run-open', runs });
````

Replace with:

````ts
error: ARCHIVE_REFUSALS.runOpen, runs });
````

<!-- replay: T1 replace pwa/src/fleet/ArchiveConflictSheet.tsx -->
In `pwa/src/fleet/ArchiveConflictSheet.tsx`, find:

````tsx
import { Sheet } from '../components/Sheet';
````

Replace with:

````tsx
import { ARCHIVE_REFUSALS } from '../../../shared/api';
import { Sheet } from '../components/Sheet';
````

<!-- replay: T1 replace pwa/src/fleet/ArchiveConflictSheet.tsx old-inline new-inline -->
In `pwa/src/fleet/ArchiveConflictSheet.tsx`, find:

````tsx
.error !== 'run-open') return null;
````

Replace with:

````tsx
.error !== ARCHIVE_REFUSALS.runOpen) return null;
````

- [ ] **Step 4: Run the tests and both typechecks.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archive-wire.test.ts test/single-definition.test.ts test/readme-holds.test.ts )
( cd server && ./node_modules/.bin/tsc --noEmit -p . )
( cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json )
( cd pwa && ./node_modules/.bin/tsc --noEmit -p . )
```

Expected: `297 passed (297)`; no output from any `tsc` (the server's `tsc -p .` covers `src/` alone; `test/tsconfig.tests.json` is the one that typechecks the test files — with Step 0's real agent modules it is silent, and without them it prints only `agent/src`'s four `ws` errors, identical on the base).

- [ ] **Step 5: Commit.**

```bash
git add -u shared/api.ts server/src/server.ts pwa/src/fleet/ArchiveConflictSheet.tsx server/test/single-definition.test.ts server/test/readme-holds.test.ts
git add server/test/archive-wire.test.ts
git commit -m "wire: the archive door's refusal codes, declared once; the fold and busy predicates (workspace lifecycle W2)"
```

### Task 2: The store read — `CoordStore.openRunsClaimedBy`

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `server/src/coord/store.ts` (one method, inserted directly above `openRunsForSession`'s docstring)
- Create: `server/test/archive-store.test.ts`

**Interfaces:**
- Produces: `openRunsClaimedBy(claimantId: string): OpenSiblingsResult` — every non-terminal run whose `claimedBy` is the id, in id order, with `openRunsForSession`'s predicate (the terminal set is the only exclusion, so an unknown state counts as open) and row (`OpenSibling`, all-or-failure, D-2545). Synchronous.

- [ ] **Step 1: Write the failing test.**

<!-- replay: T2 create server/test/archive-store.test.ts -->
Create `server/test/archive-store.test.ts`:

````ts
// `CoordStore.openRunsClaimedBy` (workspace lifecycle spec §5.2): the runs a session COORDINATES, read for the archive
// door's `coordinator-has-open-runs` refusal and its `{programme:'end'}` act, against a real `coord.db`.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));

const open = (s: CoordStore, program: string, wave: number, claimedBy = 'demo-coordinator'): number => {
  const r = s.openRun({ program, title: `${program} title`, project: 'ccrc-pwa', wave, waveOf: 3, claimedBy });
  if (!('id' in r)) throw new Error('openRun refused');
  return r.id;
};

describe('CoordStore.openRunsClaimedBy', () => {
  it('answers this claimant\'s non-terminal runs, in id order, with the columns the refusal names', () => {
    const s = store();
    const a = open(s, 'lifecycle', 1);
    const b = open(s, 'lifecycle', 2);
    const other = open(s, 'elsewhere', 1, 'another-coordinator');
    const closed = open(s, 'over', 1);
    expect(s.advance(closed, 'failed', 'test-close').ok).toBe(true);
    expect(s.openRunsClaimedBy('demo-coordinator')).toEqual({
      ok: true,
      siblings: [
        { id: a, program: 'lifecycle', wave: 1, waveOf: 3 },
        { id: b, program: 'lifecycle', wave: 2, waveOf: 3 },
      ],
    });
    // CONTROL: the other claimant's run is a real open run — it is excluded by its column, not by its state.
    expect(s.openRunsClaimedBy('another-coordinator')).toEqual({
      ok: true, siblings: [{ id: other, program: 'elsewhere', wave: 1, waveOf: 3 }],
    });
  });

  it('keys on the CLAIMANT column — a run naming the session only as its worker is not one it coordinates', () => {
    const s = store();
    const r = open(s, 'lifecycle', 1, 'someone-else');
    s.bindSession(r, 'demo-coordinator');
    expect(s.openRunsClaimedBy('demo-coordinator')).toEqual({ ok: true, siblings: [] });
  });

  it('counts a row in a state this build cannot name as open — the terminal set is the only exclusion', () => {
    const s = store();
    const r = open(s, 'lifecycle', 1);
    s.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run('unknown', r);
    expect(s.openRunsClaimedBy('demo-coordinator')).toMatchObject({ ok: true, siblings: [{ id: r }] });
  });

  it('refuses the WHOLE read when one row cannot be represented — never a partial list', () => {
    const s = store();
    open(s, 'lifecycle', 1);
    s.db.prepare(
      'INSERT INTO runs (id, program, wave, waveOf, project, state, claimedBy, openedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(4242, 'lifecycle', BigInt(Number.MAX_SAFE_INTEGER) + 1n, 3, 'ccrc-pwa', 'planned', 'demo-coordinator', Date.now());
    expect(s.openRunsClaimedBy('demo-coordinator')).toMatchObject({ ok: false, kind: 'run-unreadable' });
  });
});
````

- [ ] **Step 2: Run it to verify it fails.**

Run: `( cd server && ./node_modules/.bin/vitest run test/archive-store.test.ts )`
Expected: `4 failed (4)`, each `TypeError: s.openRunsClaimedBy is not a function`.

- [ ] **Step 3: Add the read.**

<!-- replay: T2 replace server/src/coord/store.ts old-inline new-inline -->
In `server/src/coord/store.ts`, find:

````ts
  /**
   * "Which OPEN runs name this session?"
````

Replace with:

````ts
  /**
   * "Which OPEN runs does this session COORDINATE?" — `openRunsForSession`'s question asked of the OTHER column
   * (workspace lifecycle spec §5.2): every non-terminal run whose `claimedBy` is `claimantId`, in id order, for the
   * archive door's `coordinator-has-open-runs` refusal and its `{programme:'end'}` act. `openCoordinatorIds` answers
   * WHO coordinates something, as a set of ids; this answers WHICH runs, with the columns the refusal names.
   *
   * `openRunsForSession`'s predicate (`state NOT IN` the terminal set, so a row in a state this build cannot name
   * counts as open) and its row (`OpenSibling`, the four integers CAST and proven, ALL-OR-FAILURE, D-2545): a partial
   * list is how "this coordinator has no open runs" gets asserted about one that does, one step from an archive.
   * Synchronous, like every other read on this store.
   */
  openRunsClaimedBy(claimantId: string): OpenSiblingsResult {
    const rows = this.db.prepare(
      'SELECT CAST(id AS TEXT) AS idText, program, CAST(wave AS TEXT) AS waveText, ' +
      'CAST(waveOf AS TEXT) AS waveOfText, CAST(reviews AS TEXT) AS reviewsText FROM runs ' +
      `WHERE claimedBy = ? AND state NOT IN ${TERMINAL_RUN_STATES_SQL} ORDER BY id`,
    ).all(claimantId) as unknown as
      { idText: string; program: string; waveText: string; waveOfText: string | null; reviewsText: string | null }[];
    const runs: OpenSibling[] = [];
    for (const r of rows) {
      const m = measureRunNumbers(r);
      if (!m.ok) return { ok: false, kind: 'run-unreadable', detail: m.detail };
      runs.push({ id: m.nums.id, program: r.program, wave: m.nums.wave, waveOf: m.nums.waveOf });
    }
    return { ok: true, siblings: runs };
  }

  /**
   * "Which OPEN runs name this session?"
````

- [ ] **Step 4: Run it and the typecheck.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archive-store.test.ts )
( cd server && ./node_modules/.bin/tsc --noEmit -p . )
( cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json )
```

Expected: `4 passed (4)`; no output from either `tsc` (Task 1's note on the tests project).

- [ ] **Step 5: Commit.**

```bash
git add -u server/src/coord/store.ts
git add server/test/archive-store.test.ts
git commit -m "store: openRunsClaimedBy — the runs a session coordinates (workspace lifecycle W2)"
```

### Task 3: The handle — `registerCoordRoutes` returns the serialiser with the operator's abandon inside it

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `server/src/coord/close.ts` (`abandonMove` and `abandonRefusal` above `closeRun`'s docstring; the abandon arm calls `abandonMove` — its rule moves there verbatim)
- Modify: `server/src/coord/routes.ts` (the `close.js` import; the `CoordRoutesHandle` interface above `registerCoordRoutes`' docstring; its return type; `withAbandon` beside `coordMutex`; the abandon route through it; `return { withAbandon }` at the function's end)
- Create: `server/test/archive-coord-handle.test.ts`

**Interfaces:**
- Produces: `abandonMove(run: Pick<RunRow,'state'|'kind'>)` — `{ok:true, to}` or the arm's `bad-transition` — and `abandonRefusal(coord, runId): Extract<CloseOutcome,{ok:false}> | null`, what the abandon arm would refuse from the row alone (its read, then `abandonMove`), read without acting (`close.ts`); `export interface CoordRoutesHandle { withAbandon<T>(coord: CoordStore, fn: (abandon: (runId: number) => Promise<CloseOutcome>, refusalOf: (runId: number) => Extract<CloseOutcome, { ok: false }> | null) => Promise<T>): Promise<T> }`; `registerCoordRoutes(...)` returns it. `abandon` is `closeRun(…, runId, { intent: 'abandon' }, 'operator')` with CCR-15 wave 3's `childReclaim: childReclaimPort(deps, coord)`, `refusalOf` is `abandonRefusal(coord, runId)`, and both are reachable only inside `coordMutex` — one method, not two, because `closeRun` may only be called lexically inside `coordMutex.run(...)` (`dispatch-mutex-gate.test.ts`, D-46), and a pre-read taken outside the hold could be stale by the act.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test.**

<!-- replay: T3 create server/test/archive-coord-handle.test.ts -->
Create `server/test/archive-coord-handle.test.ts`:

````ts
// `registerCoordRoutes`' handle (workspace lifecycle spec §5.2): the coordination serialiser with the operator abandon
// inside it, handed to a door registered outside `coord/routes.ts`. The archive door's `{programme:'end'}` is its first
// caller.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import Fastify from 'fastify';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

const setup = () => {
  const home = mkTmp('ccrc-handle-');
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => { calls.push(args); return { code: 0, stdout: '', stderr: '' }; };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps = { ...testDeps(home, run), coord };
  const app = Fastify();
  const handle = registerCoordRoutes(app, deps, new Bus(), undefined,
    { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null });
  const opened = coord.openRun({ program: 'lifecycle', title: 'T', project: 'demo', wave: 1, waveOf: 2,
    claimedBy: 'demo-coordinator' });
  if (!('id' in opened)) throw new Error('fixture openRun refused');
  return { app, handle, coord, calls, id: opened.id };
};

describe('CoordRoutesHandle', () => {
  it('the abandon it hands over closes a run failed, as the OPERATOR — the abandon route\'s own decision', async () => {
    const { app, handle, coord, id } = setup();
    expect(await handle.withAbandon(coord, (abandon) => abandon(id))).toMatchObject({ ok: true, id, state: 'failed' });
    expect(okRun(coord.run(id))!.state).toBe('failed');
    const ev = coord.db.prepare('SELECT causedBy FROM run_events WHERE runId = ? ORDER BY id DESC LIMIT 1').get(id) as
      { causedBy: string };
    expect(ev.causedBy).toBe('operator');
    await app.close();
  });

  it('a run already `closing`, or in a state with no edges, refuses the abandon — and nothing reaches the box', async () => {
    const { app, handle, coord, calls, id } = setup();
    coord.setSession(id, 'demo-worker');
    for (const state of ['closing', 'unknown'] as const) {
      coord.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run(state, id);
      expect(await handle.withAbandon(coord, (abandon) => abandon(id)))
        .toEqual({ ok: false, kind: 'bad-transition', from: state, to: 'closing' });
    }
    expect(calls).toEqual([]);
    await app.close();
  });

  it('hands over the arm\'s own pre-read too: what the abandon would refuse from the row alone, asked WITHOUT acting', async () => {
    const { app, handle, coord, calls, id } = setup();
    expect(await handle.withAbandon(coord, async (_abandon, refusalOf) => [refusalOf(id), refusalOf(id + 99)]))
      .toEqual([null, { ok: false, kind: 'unknown-run' }]);
    coord.setSession(id, 'demo-worker');
    coord.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run('closing', id);
    const closing = { ok: false, kind: 'bad-transition', from: 'closing', to: 'closing' };
    // The SAME answer the abandon itself gives — one rule (`abandonMove`), two readers.
    expect(await handle.withAbandon(coord, async (abandon, refusalOf) => [refusalOf(id), await abandon(id)]))
      .toEqual([closing, closing]);
    expect(okRun(coord.run(id))!.state).toBe('closing');
    expect(calls).toEqual([]);
    await app.close();
  });

  it('withAbandon holds the routes\' OWN mutex — an abandon that arrives while it is held waits for it', async () => {
    const { app, handle, coord, id } = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const order: string[] = [];
    const held = handle.withAbandon(coord, async () => { order.push('held'); await gate; order.push('released'); });
    const abandoned = app.inject({ method: 'POST', url: `/api/runs/${id}/abandon` })
      .then((r) => { order.push('abandon'); return r; });
    await new Promise((r) => setTimeout(r, 60));
    expect(order).toEqual(['held']);
    release();
    await held;
    expect((await abandoned).json()).toMatchObject({ ok: true, id, state: 'failed' });
    expect(order).toEqual(['held', 'released', 'abandon']);
    await app.close();
  });
});
````

- [ ] **Step 2: Run it, and the abandon route's own suite, to verify the new cases fail.**

Run: `( cd server && ./node_modules/.bin/vitest run test/archive-coord-handle.test.ts test/coord-abandon.test.ts )`
Expected: `4 failed | 30 passed (34)` — the four handle cases (`TypeError: Cannot read properties of undefined (reading 'withAbandon')`); `coord-abandon` is green before and after.

- [ ] **Step 3: Return the handle and route the abandon through it.**

<!-- replay: T3 replace server/src/coord/routes.ts -->
In `server/src/coord/routes.ts`, find:

````ts
import { closeRun, type CloseOutcome, type CloseRunDeps } from './close.js';
````

Replace with:

````ts
import { abandonRefusal, closeRun, type CloseOutcome, type CloseRunDeps } from './close.js';
````

<!-- replay: T3 replace server/src/coord/close.ts -->
In `server/src/coord/close.ts`, find:

````ts
/**
 * Close a run: re-measure the done claim (never believe it) — UNLESS the
````

Replace with:

````ts
/**
 * The operator abandon's one move (D-2807): a `planned` run, or any review run (its machine has no `closing`), fails
 * directly; every other run moves to `closing` — unless its own machine has no such edge (a run already `closing`, or
 * in `unknown`), which is the arm's `bad-transition`. ONE spelling, two readers: `closeRun`'s abandon arm below, and
 * `abandonRefusal`, which the archive door asks of every run a programme holds BEFORE it ends the first (workspace
 * lifecycle §5.2: every check that can refuse runs before any act that cannot be undone).
 */
export function abandonMove(run: Pick<RunRow, 'state' | 'kind'>):
  | { readonly ok: true; readonly to: RunState }
  | { readonly ok: false; readonly kind: 'bad-transition'; readonly from: RunState; readonly to: RunState } {
  const to: RunState = run.state === 'planned' || run.kind === 'review' ? 'failed' : 'closing';
  return transitionsFor(run.kind)[run.state].includes(to)
    ? { ok: true, to } : { ok: false, kind: 'bad-transition', from: run.state, to };
}

/**
 * What `closeRun`'s abandon arm would refuse for this run from the ROW ALONE — its read, then `abandonMove` — asked
 * without acting. `null`: the arm can move it. The archive door reads it for every run inside the same `coordMutex`
 * hold that then runs the abandons (`CoordRoutesHandle.withAbandon`), so nothing moves between this read and the act.
 * What only the act measures — the sibling read, a hand-over hold, the verb, ccd's own answer — can still refuse after
 * an earlier run was ended, and the door says which runs it ended (`programme-partly-ended`).
 */
export function abandonRefusal(coord: CoordStore, id: number): Extract<CloseOutcome, { ok: false }> | null {
  const read = coord.run(id);
  // `closeRun`'s own two answers for a row it cannot use (D-2545; an absent run).
  if (!read.ok) return { ok: false, kind: 'hold-invalid', detail: read.detail };
  if (read.run === null) return { ok: false, kind: 'unknown-run' };
  const move = abandonMove(read.run);
  return move.ok ? null : move;
}

/**
 * Close a run: re-measure the done claim (never believe it) — UNLESS the
````

<!-- replay: T3 replace server/src/coord/close.ts -->
In `server/src/coord/close.ts`, find:

````ts
    // D-2807: a review run has no `closing` (REVIEW_RUN_TRANSITIONS); the
    // operator's ungated valve must still reach it, so it fails directly — its
    // own machine's terminal hop.
    const target: RunState = run.state === 'planned' || run.kind === 'review' ? 'failed' : 'closing';
    if (!transitionsFor(run.kind)[run.state].includes(target)) {
      return { ok: false, kind: 'bad-transition', from: run.state, to: target };
    }
````

Replace with:

````ts
    // D-2807: a review run has no `closing` (REVIEW_RUN_TRANSITIONS); the
    // operator's ungated valve must still reach it, so it fails directly — its
    // own machine's terminal hop. `abandonMove` (above) is that rule, spelled
    // once for this arm and for the archive door's pre-read.
    const move = abandonMove(run);
    if (!move.ok) return move;
    const target = move.to;
````

<!-- replay: T3 replace server/src/coord/routes.ts old-inline new-inline -->
In `server/src/coord/routes.ts`, find:

````ts
/**
 * The coordination routes. Registered from
````

Replace with:

````ts
/**
 * What `registerCoordRoutes` hands back to `buildServer` (workspace lifecycle spec §5.2): the coordination
 * serialiser — this server's ONE `CoordMutex` — with the operator's abandon inside it, so a door registered OUTSIDE
 * this file (the archive door's `{programme:'end'}`, in `server.ts`) runs on the same chokepoint and the same
 * decision as `POST /api/runs/:id/abandon`, never a second spelling of either. `server.ts`'s archive route used to say
 * why it held no mutex ("the change is to have `registerCoordRoutes` return its mutex"); this is that change.
 *
 * ONE METHOD, NOT TWO, on purpose: `closeRun` may only be called lexically inside `coordMutex.run(...)`
 * (`dispatch-mutex-gate.test.ts`, D-46), so the abandon is handed to `fn` from INSIDE the hold rather than exported
 * beside it — a caller can only reach it serialised.
 */
export interface CoordRoutesHandle {
  /** Run `fn` as one coordination write — queued behind whichever write route's body is running, ahead of the next —
   *  handed `closeRun`'s abandon arm exactly as the abandon route runs it, and `abandonRefusal` (close.ts): what that
   *  arm would refuse for a run from its row alone, read without acting, so a caller that ends several runs can find
   *  the one it cannot move before it ends the first. */
  withAbandon<T>(coord: CoordStore, fn: (
    abandon: (runId: number) => Promise<CloseOutcome>,
    refusalOf: (runId: number) => Extract<CloseOutcome, { ok: false }> | null,
  ) => Promise<T>): Promise<T>;
}

/**
 * The coordination routes. Registered from
````

<!-- replay: T3 replace server/src/coord/routes.ts old-inline new-inline -->
In `server/src/coord/routes.ts`, find:

````ts
): void {
  const notConfigured
````

Replace with:

````ts
): CoordRoutesHandle {
  const notConfigured
````

<!-- replay: T3 replace server/src/coord/routes.ts -->
In `server/src/coord/routes.ts`, find:

````ts
  const coordMutex = new CoordMutex();
````

Replace with:

````ts
  const coordMutex = new CoordMutex();

  /** `closeRun`'s abandon arm exactly as `POST /api/runs/:id/abandon` runs it — `{intent:'abandon'}` built here and
   *  never read off a body (D-280), `causedBy:'operator'`, CCR-15 wave 3's `childReclaim` port onto the session's own
   *  queue — handed to `fn` INSIDE `coordMutex`. ONE spelling, two callers: that route, and the archive door's
   *  `{programme:'end'}` through the handle this function returns. */
  const withAbandon: CoordRoutesHandle['withAbandon'] = (coord, fn) => coordMutex.run(() => fn((runId) => closeRun(
    { coord, io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd, fleetState: deps.fleetState,
      childReclaim: childReclaimPort(deps, coord) },
    runId, { intent: 'abandon' }, 'operator'), (runId) => abandonRefusal(coord, runId)));
````

<!-- replay: T3 replace server/src/coord/routes.ts -->
In `server/src/coord/routes.ts`, find:

````ts
    const closeDeps: CloseRunDeps = { coord, io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd,
      fleetState: deps.fleetState, childReclaim: childReclaimPort(deps, coord) };
    const outcome = await coordMutex.run(() => closeRun(closeDeps, id, { intent: 'abandon' }, 'operator'));
````

Replace with:

````ts
    const outcome = await withAbandon(coord, (abandon) => abandon(id));
````

<!-- replay: T3 replace server/src/coord/routes.ts -->
In `server/src/coord/routes.ts`, find:

````ts
    return reply.code(200).send({ ok: true, asks: read.asks });
  });
}
````

Replace with:

````ts
    return reply.code(200).send({ ok: true, asks: read.asks });
  });

  return { withAbandon };
}
````

- [ ] **Step 4: Run them, the gates that read this file, and the typecheck.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archive-coord-handle.test.ts test/coord-abandon.test.ts )
( cd server && ./node_modules/.bin/vitest run test/dispatch-mutex-gate.test.ts test/child-reclaim-close.test.ts test/coord-pause-route.test.ts test/run-routes.test.ts )
( cd server && ./node_modules/.bin/tsc --noEmit -p . )
( cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json )
```

Expected: `34 passed (34)`; the four gate files green (`coord-abandon` and `child-reclaim-close` are the abandon arm's own, unchanged by the extraction); no output from either `tsc` (Task 1's note).

- [ ] **Step 5: Commit.**

```bash
git add -u server/src/coord/close.ts server/src/coord/routes.ts
git add server/test/archive-coord-handle.test.ts
git commit -m "coord: registerCoordRoutes returns its serialiser with the operator abandon and its pre-read inside (workspace lifecycle W2)"
```

### Task 4: The decision — `server/src/coord/archiveDoor.ts`

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Create: `server/src/coord/archiveDoor.ts`
- Create: `server/test/archive-door-decide.test.ts`, `server/test/archive-ccd-words.test.ts`

**Interfaces:**
- Produces: `archiveFlags(raw): ArchiveFlags | null` (`null` → 400; keyed by `ArchiveBody`); `interface ArchiveMeasure { workspace; busy; worktree: 'present'|'absent'|'unmeasured'; verbSupported }`; `worktreeOf(MeasuredStat)`; `interface ArchiveCoordPort { openRunsForSession; openRunsClaimedBy; abandonRefusal; abandon }` (declared by this consumer); `decideArchive(port | null, id, flags, measure): Promise<ArchiveDecision>` — `{ok:false, reply}` or `{ok:true, stop, wsArchive, ended}`; a store read that throws is an unreadable store, and an abandon or pre-read that throws is `programme-partly-ended` naming what was closed (refusal kind `threw`), never a rejection; `closeRefusalOf`; `busyAtStop(ended): ArchiveReply`; `ccdArchiveRefusal(stderr): ArchiveRefusal | null`; `archiveOutcome(stopped, ended, {ok, stderr}): ArchiveReply`.
- Consumes: Task 1's vocabulary; Task 2's read and Task 3's pre-read (through the port).

- [ ] **Step 1: Write the failing tests.** The second file runs the REAL `cmd_ws_archive` in a fixture HOME (`makeCcdHarness`; tmux and systemd are shell stubs, as in `ccd-archive.test.ts`), so a reworded `ccd` reds there rather than silently losing its word on the phone.

<!-- replay: T4 create server/test/archive-door-decide.test.ts -->
Create `server/test/archive-door-decide.test.ts`:

````ts
// The archive door's decision (workspace lifecycle spec §5.2), driven through its declared port: the ORDER of its
// refusals, the one act it takes, and how ccd's answer reaches the wire.
import { describe, it, expect } from 'vitest';
import {
  archiveFlags, archiveOutcome, ccdArchiveRefusal, decideArchive, worktreeOf,
  type ArchiveCoordPort, type ArchiveMeasure,
} from '../src/coord/archiveDoor.js';
import type { CloseOutcome } from '../src/coord/close.js';
import type { OpenSibling, OpenSiblingsResult } from '../src/coord/store.js';

const run = (id: number, wave = 1): OpenSibling => ({ id, program: 'lifecycle', wave, waveOf: 3 });
const NONE = { force: false, interrupt: false, programmeEnd: false };
const IDLE_WS: ArchiveMeasure = { workspace: true, busy: false, worktree: 'present', verbSupported: true };
const IDLE_MAIN: ArchiveMeasure = { workspace: false, busy: false, worktree: 'present', verbSupported: false };
const UNREADABLE: OpenSiblingsResult = { ok: false, kind: 'run-unreadable', detail: 'runs.wave' };

/** A port double that records every read and every abandon, in order. `blocked`: what the abandon arm would refuse
 *  from a run's row alone (the pre-read); `refuse`: what an abandon refuses AT the act; `throws`: a store that throws. */
const port = (o: { worker?: OpenSiblingsResult; claimed?: OpenSiblingsResult;
  blocked?: Record<number, Extract<CloseOutcome, { ok: false }>>;
  refuse?: Record<number, Extract<CloseOutcome, { ok: false }>>;
  throws?: { worker?: boolean; claimed?: boolean; blocked?: number; abandon?: number } } = {}) => {
  const seen: string[] = [];
  const p: ArchiveCoordPort = {
    openRunsForSession: (id) => {
      seen.push(`worker:${id}`);
      if (o.throws?.worker === true) throw new Error('database is not open');
      return o.worker ?? { ok: true, siblings: [] };
    },
    openRunsClaimedBy: (id) => {
      seen.push(`claimant:${id}`);
      if (o.throws?.claimed === true) throw new Error('database is not open');
      return o.claimed ?? { ok: true, siblings: [] };
    },
    abandonRefusal: (runId) => {
      seen.push(`can:${runId}`);
      if (o.throws?.blocked === runId) throw new TypeError('transitions undefined');
      return o.blocked?.[runId] ?? null;
    },
    abandon: async (runId) => {
      seen.push(`abandon:${runId}`);
      if (o.throws?.abandon === runId) throw new Error('SQLITE_BUSY: database is locked');
      return o.refuse?.[runId]
        ?? { ok: true, id: runId, state: 'failed', released: true, childReclaim: 'not-queued' } as CloseOutcome;
    },
  };
  return { p, seen };
};

describe('archiveFlags', () => {
  it('reads an absent body as no consent at all', () => {
    expect(archiveFlags(undefined)).toEqual(NONE);
    expect(archiveFlags(null)).toEqual(NONE);
    expect(archiveFlags({})).toEqual(NONE);
  });

  it('reads each consent as given, and `force`/`interrupt` only as true — as `force` always was', () => {
    expect(archiveFlags({ force: true, interrupt: true, programme: 'end' }))
      .toEqual({ force: true, interrupt: true, programmeEnd: true });
    expect(archiveFlags({ force: 'yes', interrupt: 1 })).toEqual(NONE);
  });

  it('refuses a programme word that is not exactly "end", and a body that is not an object', () => {
    for (const bad of [{ programme: 'keep' }, { programme: true }, { programme: 'END' }, [], 'end', 7]) {
      expect(archiveFlags(bad)).toBeNull();
    }
  });
});

describe('worktreeOf', () => {
  it('tells a present worktree from a proven absence from a read that failed', () => {
    expect(worktreeOf({ ok: true, mtimeMs: 1, size: 1 })).toBe('present');
    expect(worktreeOf({ ok: false, reason: 'absent' })).toBe('absent');
    expect(worktreeOf({ ok: false, reason: 'unreadable' })).toBe('unmeasured');
  });
});

describe('decideArchive — every check that can refuse runs before any act', () => {
  it('refuses a turn in progress first, reading nothing from the store', async () => {
    const { p, seen } = port({ claimed: { ok: true, siblings: [run(1)] } });
    expect(await decideArchive(p, 'demo-a', NONE, { ...IDLE_WS, busy: true }))
      .toEqual({ ok: false, reply: { status: 409, body: { ok: false, error: 'session-busy' } } });
    expect(seen).toEqual([]);
  });

  it('a busy row with `interrupt` proceeds, and the stop comes first', async () => {
    const { p } = port();
    expect(await decideArchive(p, 'demo-a', { ...NONE, interrupt: true }, { ...IDLE_WS, busy: true }))
      .toEqual({ ok: true, stop: true, wsArchive: true, ended: [] });
  });

  it('an idle workspace is archived without a stop; a main checkout is stopped and never reaches ws-archive', async () => {
    expect(await decideArchive(port().p, 'demo-a', NONE, IDLE_WS)).toEqual({ ok: true, stop: false, wsArchive: true, ended: [] });
    expect(await decideArchive(port().p, 'claude-demo', NONE, IDLE_MAIN))
      .toEqual({ ok: true, stop: true, wsArchive: false, ended: [] });
  });

  it('a busy main checkout without `interrupt` refuses too — busy is read for both kinds of row', async () => {
    expect(await decideArchive(port().p, 'claude-demo', NONE, { ...IDLE_MAIN, busy: true }))
      .toMatchObject({ ok: false, reply: { status: 409, body: { error: 'session-busy' } } });
  });

  it('refuses a workspace whose worktree is PROVEN gone, before the store is asked', async () => {
    const gone = port({ claimed: { ok: true, siblings: [run(1)] } });
    expect(await decideArchive(gone.p, 'demo-a', { ...NONE, programmeEnd: true }, { ...IDLE_WS, worktree: 'absent' }))
      .toEqual({ ok: false, reply: { status: 409, body: { ok: false, error: 'worktree-gone' } } });
    expect(gone.seen).toEqual([]);
  });

  it('an UNMEASURED worktree is not a refusal — in remote mode this box cannot read one; ccd measures it', async () => {
    const { p, seen } = port({ claimed: { ok: true, siblings: [run(1)] } });
    expect(await decideArchive(p, 'demo-c', { ...NONE, programmeEnd: true }, { ...IDLE_WS, worktree: 'unmeasured' }))
      .toEqual({ ok: true, stop: false, wsArchive: true, ended: [run(1)] });
    expect(seen).toEqual(['worker:demo-c', 'claimant:demo-c', 'can:1', 'abandon:1']);
  });

  it('refuses `run-open` naming the runs, or with EMPTY runs when they could not be read — and `force` skips it', async () => {
    expect(await decideArchive(port({ worker: { ok: true, siblings: [run(4)] } }).p, 'demo-a', NONE, IDLE_WS))
      .toEqual({ ok: false, reply: { status: 409, body: { ok: false, error: 'run-open', runs: [run(4)] } } });
    expect(await decideArchive(port({ worker: UNREADABLE }).p, 'demo-a', NONE, IDLE_WS))
      .toEqual({ ok: false, reply: { status: 409, body: { ok: false, error: 'run-open', runs: [] } } });
    const forced = port({ worker: { ok: true, siblings: [run(4)] } });
    expect(await decideArchive(forced.p, 'demo-a', { ...NONE, force: true }, IDLE_WS)).toMatchObject({ ok: true });
    expect(forced.seen).toEqual(['claimant:demo-a']);
  });

  it('refuses a coordinator with open runs, naming them, and ends nothing without `programme:"end"`', async () => {
    const { p, seen } = port({ claimed: { ok: true, siblings: [run(7), run(8, 2)] } });
    expect(await decideArchive(p, 'demo-c', NONE, IDLE_WS)).toEqual({ ok: false, reply: { status: 409,
      body: { ok: false, error: 'coordinator-has-open-runs', runs: [run(7), run(8, 2)] } } });
    expect(seen).toEqual(['worker:demo-c', 'claimant:demo-c']);
  });

  it('an unreadable store refuses fail-shut with `runs: []` — even with `programme:"end"`', async () => {
    const { p, seen } = port({ claimed: UNREADABLE });
    expect(await decideArchive(p, 'demo-c', { ...NONE, programmeEnd: true }, IDLE_WS)).toEqual({ ok: false,
      reply: { status: 409, body: { ok: false, error: 'coordinator-has-open-runs', runs: [] } } });
    expect(seen.filter((s) => s.startsWith('abandon'))).toEqual([]);
  });

  it('a store read that THROWS is an unreadable store — the same fail-shut refusals, never a rejection (a 500)', async () => {
    expect(await decideArchive(port({ throws: { worker: true } }).p, 'demo-a', NONE, IDLE_WS))
      .toEqual({ ok: false, reply: { status: 409, body: { ok: false, error: 'run-open', runs: [] } } });
    const { p, seen } = port({ throws: { claimed: true } });
    expect(await decideArchive(p, 'demo-c', { ...NONE, force: true, programmeEnd: true }, IDLE_WS)).toEqual({ ok: false,
      reply: { status: 409, body: { ok: false, error: 'coordinator-has-open-runs', runs: [] } } });
    expect(seen).toEqual(['claimant:demo-c']);
  });

  it('refuses a box whose ccd predates ws-archive AFTER the claim checks and BEFORE ending anything', async () => {
    const claimedWs = port({ worker: { ok: true, siblings: [run(4)] } });
    expect(await decideArchive(claimedWs.p, 'demo-a', NONE, { ...IDLE_WS, verbSupported: false }))
      .toMatchObject({ reply: { status: 409, body: { error: 'run-open' } } });
    const coordinator = port({ claimed: { ok: true, siblings: [run(7)] } });
    expect(await decideArchive(coordinator.p, 'demo-c', { ...NONE, programmeEnd: true }, { ...IDLE_WS, verbSupported: false }))
      .toEqual({ ok: false, reply: { status: 501, body: { ok: false, error: 'unsupported' } } });
    expect(coordinator.seen.filter((s) => s.startsWith('abandon'))).toEqual([]);
  });

  it('`programme:"end"` abandons every run it coordinates, in id order, and then proceeds', async () => {
    const { p, seen } = port({ claimed: { ok: true, siblings: [run(7), run(8, 2)] } });
    expect(await decideArchive(p, 'demo-c', { ...NONE, programmeEnd: true }, IDLE_WS))
      .toEqual({ ok: true, stop: false, wsArchive: true, ended: [run(7), run(8, 2)] });
    expect(seen).toEqual(['worker:demo-c', 'claimant:demo-c', 'can:7', 'can:8', 'abandon:7', 'abandon:8']);
  });

  it('a run the abandon arm cannot move from its row alone is found BEFORE any run is ended — whatever its id order', async () => {
    const closing = { ok: false, kind: 'bad-transition', from: 'closing', to: 'closing' } as const;
    for (const blockedId of [7, 9]) {
      const { p, seen } = port({ claimed: { ok: true, siblings: [run(7), run(8, 2), run(9, 3)] }, blocked: { [blockedId]: closing } });
      expect(await decideArchive(p, 'demo-c', { ...NONE, programmeEnd: true, interrupt: true }, IDLE_WS)).toEqual({
        ok: false, reply: { status: 409, body: { ok: false, error: 'programme-partly-ended',
          closed: [], notClosed: [run(7), run(8, 2), run(9, 3)],
          refusal: { id: blockedId, kind: 'bad-transition', detail: 'closing → closing' } } } });
      expect(seen.filter((s) => s.startsWith('abandon'))).toEqual([]);
    }
  });

  it('stops at the first run an abandon refuses AT the act: programme-partly-ended, naming closed and not closed', async () => {
    const { p, seen } = port({ claimed: { ok: true, siblings: [run(7), run(8, 2), run(9, 3)] },
      refuse: { 8: { ok: false, kind: 'fleetFailed', stderr: 'ccd: lock busy\n' } } });
    expect(await decideArchive(p, 'demo-c', { ...NONE, programmeEnd: true, interrupt: true }, IDLE_WS)).toEqual({
      ok: false, reply: { status: 409, body: { ok: false, error: 'programme-partly-ended',
        closed: [run(7)], notClosed: [run(8, 2), run(9, 3)],
        refusal: { id: 8, kind: 'fleetFailed', detail: 'ccd: lock busy' } } } });
    expect(seen).toEqual(['worker:demo-c', 'claimant:demo-c', 'can:7', 'can:8', 'can:9', 'abandon:7', 'abandon:8']);
  });

  it('an abandon that THROWS after another run was ended still names what it closed — never a rejection', async () => {
    const { p, seen } = port({ claimed: { ok: true, siblings: [run(7), run(8, 2)] }, throws: { abandon: 8 } });
    expect(await decideArchive(p, 'demo-c', { ...NONE, programmeEnd: true }, IDLE_WS)).toEqual({
      ok: false, reply: { status: 409, body: { ok: false, error: 'programme-partly-ended',
        closed: [run(7)], notClosed: [run(8, 2)],
        refusal: { id: 8, kind: 'threw', detail: 'SQLITE_BUSY: database is locked' } } } });
    expect(seen).toEqual(['worker:demo-c', 'claimant:demo-c', 'can:7', 'can:8', 'abandon:7', 'abandon:8']);
  });

  it('a pre-read that THROWS ends nothing and says which run it was reading', async () => {
    const { p, seen } = port({ claimed: { ok: true, siblings: [run(7), run(8, 2)] }, throws: { blocked: 8 } });
    expect(await decideArchive(p, 'demo-c', { ...NONE, programmeEnd: true }, IDLE_WS)).toEqual({
      ok: false, reply: { status: 409, body: { ok: false, error: 'programme-partly-ended',
        closed: [], notClosed: [run(7), run(8, 2)],
        refusal: { id: 8, kind: 'threw', detail: 'transitions undefined' } } } });
    expect(seen.filter((s) => s.startsWith('abandon'))).toEqual([]);
  });

  it('a box with no coordination archives exactly as before — no store, no claim checks', async () => {
    expect(await decideArchive(null, 'demo-a', NONE, IDLE_WS)).toEqual({ ok: true, stop: false, wsArchive: true, ended: [] });
  });
});

describe('ccdArchiveRefusal — ccd\'s die lines, and only them', () => {
  it.each([
    ['ccd: session-busy\n', 'session-busy'],
    ['ccd: status-unknown\n', 'status-unknown'],
    ['ccd: worktree is gone: /w/demo-a — cannot describe it for the archive record; see: ccd ws-attic --session demo-a\n', 'worktree-gone'],
    ['_ws_archive_manifest: /w/x is not a worktree of /p/demo\nccd: cannot describe demo-a truthfully — nothing was touched\n', 'manifest-unbuildable'],
    ['ccd: empty archive manifest for demo-a — nothing was touched\n', 'manifest-unbuildable'],
    ['ccd: archive manifest for demo-a is not valid JSON — nothing was touched\n', 'manifest-unbuildable'],
  ] as const)('%j → %s', (stderr, want) => {
    expect(ccdArchiveRefusal(stderr)).toBe(want);
  });

  it.each([
    'ccd: no such session: demo-a', 'ccd: incomplete registry for \'demo-a\'', 'agent unreachable',
    'ccd: session-busy-ish', 'echo ccd: session-busy', '',
  ])('%j has no word', (stderr) => {
    expect(ccdArchiveRefusal(stderr)).toBeNull();
  });
});

describe('archiveOutcome — ws-archive\'s answer on the wire', () => {
  it('archived', () => {
    expect(archiveOutcome(false, [], { ok: true, stderr: '' }))
      .toEqual({ status: 200, body: { ok: true, archived: true, stopped: false, ended: [] } });
  });

  it('the partial outcome: stopped, then refused — 200, the row stays at the top level', () => {
    expect(archiveOutcome(true, [], { ok: false, stderr: 'ccd: status-unknown\n' })).toEqual({ status: 200,
      body: { ok: true, archived: false, stopped: true, ended: [], refusal: 'status-unknown', detail: 'ccd: status-unknown' } });
  });

  it('a refusal with nothing stopped is ccd\'s word as a 409 — the race after the live read included', () => {
    expect(archiveOutcome(false, [], { ok: false, stderr: 'ccd: session-busy\n' }))
      .toEqual({ status: 409, body: { ok: false, error: 'session-busy', detail: 'ccd: session-busy' } });
  });

  it('a refusal this build has no word for keeps today\'s 502 {stderr}, byte for byte', () => {
    expect(archiveOutcome(false, [], { ok: false, stderr: 'ccd: no such session: x\n' }))
      .toEqual({ status: 502, body: { ok: false, stderr: 'ccd: no such session: x\n' } });
  });

  it('says a programme was ended on every answer after it', () => {
    expect(archiveOutcome(false, [run(7)], { ok: false, stderr: 'boom' }).body).toMatchObject({ ended: [run(7)] });
    expect(archiveOutcome(false, [run(7)], { ok: false, stderr: 'ccd: status-unknown' }).body).toMatchObject({ ended: [run(7)] });
  });
});
````

<!-- replay: T4 create server/test/archive-ccd-words.test.ts -->
Create `server/test/archive-ccd-words.test.ts`:

````ts
// `ccdArchiveRefusal` (workspace lifecycle spec §5.2) reads ccd's own `die` lines — so the lines it reads are produced
// HERE by the real `cmd_ws_archive`, under the isolated HOME harness, one per refusal the door names. A reworded ccd
// reds this file instead of silently losing its word on the phone. Fixture HOMEs only; tmux and systemd are shell
// stubs, as in `ccd-archive.test.ts`, whose shapes these are.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';
import { ccdArchiveRefusal } from '../src/coord/archiveDoor.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-archwords-'); });
afterEach(() => { h.cleanup(); });

const ARCH = `_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };
  _session_verdict() { echo gone; };`;
const LIVE = ARCH
  .replace('_session_verdict() { echo gone; };', '_session_verdict() { echo live; };')
  .replace('tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };',
    'tmux() { case "$1" in list-panes) echo 4242 ;; *) echo "tmux $*" >> "$HOME/ccd-calls" ;; esac; };');

/** ccd's stderr for a refused `cmd_ws_archive`. */
const refusal = (snippet: string): string => {
  try {
    h.sh(snippet);
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? '');
  }
  throw new Error('ws-archive did not refuse');
};

const workspace = (): string => {
  h.makeRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
  return path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
};

describe('ccd\'s ws-archive refusals, read back as the door\'s words', () => {
  it('a turn in progress is session-busy', () => {
    workspace();
    const cfg = path.join(h.home, '.claude', 'sessions');
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, '4242.json'), JSON.stringify({ status: 'busy', statusUpdatedAt: 1 }));
    expect(ccdArchiveRefusal(refusal(`${LIVE} cmd_ws_archive --session demo-quiet-basin`))).toBe('session-busy');
  });

  it('a live pane whose status cannot be read is status-unknown', () => {
    workspace();
    fs.mkdirSync(path.join(h.home, '.claude', 'sessions'), { recursive: true });
    expect(ccdArchiveRefusal(refusal(`${LIVE} cmd_ws_archive --session demo-quiet-basin`))).toBe('status-unknown');
  });

  it('a worktree that moved away is worktree-gone', () => {
    const wt = workspace();
    fs.renameSync(wt, `${wt}-moved`);
    expect(ccdArchiveRefusal(refusal(`${ARCH} cmd_ws_archive --session demo-quiet-basin`))).toBe('worktree-gone');
  });

  it('a tree ccd cannot describe truthfully is manifest-unbuildable', () => {
    const wt = workspace();
    fs.rmSync(wt, { recursive: true, force: true });
    fs.mkdirSync(wt, { recursive: true });
    h.git(wt, 'init', '-q', '-b', 'ws/quiet-basin');
    fs.writeFileSync(path.join(wt, 'stranger.txt'), 'x\n');
    h.git(wt, 'add', 'stranger.txt');
    h.git(wt, 'commit', '-qm', 'a stranger');
    expect(ccdArchiveRefusal(refusal(`${ARCH} cmd_ws_archive --session demo-quiet-basin`))).toBe('manifest-unbuildable');
  });

  it('an EMPTY manifest is manifest-unbuildable', () => {
    workspace();
    expect(ccdArchiveRefusal(refusal(`${ARCH} _ws_archive_manifest() { :; }; cmd_ws_archive --session demo-quiet-basin`)))
      .toBe('manifest-unbuildable');
  });

  it('a manifest that is not valid JSON is manifest-unbuildable', () => {
    workspace();
    expect(ccdArchiveRefusal(refusal(`${ARCH} _ws_archive_manifest() { echo '{"bytes": NaN}'; }; cmd_ws_archive --session demo-quiet-basin`)))
      .toBe('manifest-unbuildable');
  });

  it('CONTROL: a refusal the door has no word for stays wordless — the reader is not matching everything', () => {
    expect(ccdArchiveRefusal(refusal(`${ARCH} cmd_ws_archive --session ghost-session`))).toBeNull();
  });
});
````

- [ ] **Step 2: Run them to verify they fail.**

Run: `( cd server && ./node_modules/.bin/vitest run test/archive-door-decide.test.ts test/archive-ccd-words.test.ts )`
Expected: `Cannot find module '../src/coord/archiveDoor.js'`, `Tests no tests`. (A missing module is a weak red on its own; the 45 cases of Step 4 and the mutation table's rows S18–S36 and S49–S54 are what bind each refusal and its order.)

- [ ] **Step 3: Write the decision.**

<!-- replay: T4 create server/src/coord/archiveDoor.ts -->
Create `server/src/coord/archiveDoor.ts`:

````ts
/**
 * The archive door's decision (workspace lifecycle spec §5.2): `POST /api/sessions/:id/archive` is ONE "Archive" for
 * both kinds of row. `server.ts` measures (the registry row, the live row, the worktree, the verb) and acts (the stop
 * argv, `ws-archive`); everything that DECIDES lives here, so the route stays a wiring of measurements to acts.
 *
 * L1 in close.ts's sense, not pure: the coordination half reads the store and ends a programme through a declared
 * port (`ArchiveCoordPort`, declared by this consumer), and `server.ts` runs `decideArchive` on the coordination
 * serialiser (`CoordRoutesHandle.withAbandon`). No fs, no fastify, no clock.
 *
 * THE ORDER IS THE CONTRACT: every check that can refuse runs before any act that cannot be undone (spec §5.2, §8).
 * `decideArchive` refuses, in order: a turn in progress without `interrupt`; a workspace whose worktree this box
 * PROVED gone; a run naming the session as its WORKER, without `force` (the existing door, unchanged); a
 * non-terminal run naming it as CLAIMANT, without `programme:'end'`, or an unreadable store either way (fail-shut,
 * `runs: []` — a store read that THROWS is unreadable too, never a 500); a box whose ccd predates `ws-archive`; and,
 * with `programme:'end'`, any run the abandon arm could not move from its row alone (`abandonRefusal` — a run already
 * `closing`, the spec's own example), found before the first run is ended. Only then does it act, and its one act is
 * ending the programme (each run through the abandon door's own decision); an abandon that still refuses — or throws
 * — stops the door there, naming what it closed, with nothing stopped or archived. What remains for `server.ts` —
 * the stop argv, then `ws-archive` — is decided here too (`stop`, `wsArchive`), and `archiveOutcome` maps
 * `ws-archive`'s answer to the wire.
 *
 * The worker check sits ABOVE the verb gate on purpose, as it always has: a claimed workspace is refused as CLAIMED
 * even on a host whose ccd predates the verb — the claim is the more specific fact, and a 501 would send the operator
 * chasing a fleet upgrade that was never the obstacle.
 *
 * What no check here can see is what only ccd can measure — its own status read, the archive manifest and, on a
 * box that cannot read the worktree, the worktree itself (`worktreeOf`). ccd refuses those before ITS act, so an
 * archive refused there has stopped nothing unless `stop` was asked; when it was, the answer is the partial outcome
 * (`archived:false, stopped:true`), and when a programme was ended first, every answer after it says so (`ended`).
 * Spec §5.2 asks for EVERY refusable check before any act; these are the ones the server cannot run, by measurement.
 */
import {
  ARCHIVE_REFUSALS, type ArchiveBody, type ArchiveRefusal,
} from '../../../shared/api.js';
import type { MeasuredStat } from '../io.js';
import type { CloseOutcome } from './close.js';
import type { OpenSibling, OpenSiblingsResult } from './store.js';

/** The consents a request carries, read once. `force` and `interrupt` are honoured only as `true` (anything else is
 *  absent, as `force` always was); `programme` is `'end'` or absent — a consent to end a programme is exact or it is
 *  refused (`archiveFlags` answers `null` → 400). */
export interface ArchiveFlags {
  readonly force: boolean;
  readonly interrupt: boolean;
  readonly programmeEnd: boolean;
}

export function archiveFlags(raw: unknown): ArchiveFlags | null {
  if (raw === undefined || raw === null) return { force: false, interrupt: false, programmeEnd: false };
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  // Keyed by L0's `ArchiveBody`, the wire shape the PWA builds: a renamed consent is a compile error here.
  const b = raw as { readonly [K in keyof ArchiveBody]?: unknown };
  if (b.programme !== undefined && b.programme !== 'end') return null;
  return { force: b.force === true, interrupt: b.interrupt === true, programmeEnd: b.programme === 'end' };
}

/** What `server.ts` measured before deciding. `busy` is `archiveInterrupts` of the row assembled on the request;
 *  `worktree` and `verbSupported` are read for a workspace only (a main checkout never reaches `ws-archive`).
 *  `worktree: 'unmeasured'` is NOT a refusal: in remote mode — the live deployment — the fleet agent's read roots
 *  (`checkPath`) exclude `~/worktrees`, so this box can never stat a workspace's worktree there, and refusing on
 *  that would refuse every archive. ccd's own `[[ -d $workdir ]]` refusal, which precedes its act, measures it. */
export interface ArchiveMeasure {
  readonly workspace: boolean;
  readonly busy: boolean;
  readonly worktree: 'present' | 'absent' | 'unmeasured';
  readonly verbSupported: boolean;
}

/** A worktree's measured presence (D-114: absent and unreadable are two facts, and only the first is "gone"). A
 *  stat the agent refused as outside its read roots arrives as `unreadable` (`remote/io.ts`), so it is `unmeasured`. */
export function worktreeOf(s: MeasuredStat): ArchiveMeasure['worktree'] {
  return s.ok ? 'present' : s.reason === 'absent' ? 'absent' : 'unmeasured';
}

/** The coordination reads and the one act — DECLARED BY THIS CONSUMER (L2). `server.ts` wires it over `CoordStore`
 *  and the two functions `CoordRoutesHandle.withAbandon` hands it; `null` on a box with no coordination database,
 *  which archives exactly as it did before coordination existed. */
export interface ArchiveCoordPort {
  openRunsForSession(sessionId: string): OpenSiblingsResult;
  openRunsClaimedBy(claimantId: string): OpenSiblingsResult;
  /** What the abandon arm would refuse for this run from its row alone, read without acting (close.ts's
   *  `abandonRefusal`); `null` when it can move it. */
  abandonRefusal(runId: number): Extract<CloseOutcome, { ok: false }> | null;
  abandon(runId: number): Promise<CloseOutcome>;
}

/** An answer the route sends as it stands. */
export interface ArchiveReply { readonly status: number; readonly body: Readonly<Record<string, unknown>> }

export type ArchiveDecision =
  | { readonly ok: false; readonly reply: ArchiveReply }
  | { readonly ok: true; readonly stop: boolean; readonly wsArchive: boolean; readonly ended: readonly OpenSibling[] };

const refuse = (status: number, error: ArchiveRefusal | 'unsupported', extra: Record<string, unknown> = {}):
  ArchiveDecision => ({ ok: false, reply: { status, body: { ok: false, error, ...extra } } });

const thrown = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A store read that THROWS — a `node:sqlite` error; `CoordMutex.run` is `try`/`finally` with no catch and there is no
 *  error handler, so it would leave as a bare 500 — is a store this box could not read, and refuses fail-shut exactly
 *  as one does (`runs: []`), never as a 500 the sheet cannot answer. */
const measured = (read: () => OpenSiblingsResult): OpenSiblingsResult => {
  try { return read(); } catch (e) { return { ok: false, kind: 'run-unreadable', detail: thrown(e) }; }
};

/** Why one abandon refused, in words a sheet can show: `closeRun`'s refusal kind, and its detail where it has one. */
export function closeRefusalOf(id: number, r: Extract<CloseOutcome, { ok: false }>):
  { readonly id: number; readonly kind: string; readonly detail?: string } {
  switch (r.kind) {
    case 'bad-transition': return { id, kind: r.kind, detail: `${r.from} → ${r.to}` };
    case 'refused': return { id, kind: r.kind, detail: r.code };
    case 'doneVerdict': return { id, kind: r.kind, detail: r.code };
    case 'hold-oversize': case 'hold-invalid': return { id, kind: r.kind, detail: r.detail };
    case 'fleetFailed': return { id, kind: r.kind, detail: r.stderr.trim() };
    default: return { id, kind: r.kind };
  }
}

export async function decideArchive(
  port: ArchiveCoordPort | null, id: string, flags: ArchiveFlags, m: ArchiveMeasure,
): Promise<ArchiveDecision> {
  if (m.busy && !flags.interrupt) return refuse(409, ARCHIVE_REFUSALS.sessionBusy);
  // A PROVEN absence only. `unmeasured` proceeds: see `ArchiveMeasure.worktree`.
  if (m.workspace && m.worktree === 'absent') return refuse(409, ARCHIVE_REFUSALS.worktreeGone);
  let claimed: readonly OpenSibling[] = [];
  if (port !== null) {
    if (!flags.force) {
      const worker = measured(() => port.openRunsForSession(id));
      // D-2545: refused as CLAIMED with an EMPTY `runs` — the field's shape does not change with the condition.
      if (!worker.ok) return refuse(409, ARCHIVE_REFUSALS.runOpen, { runs: [] });
      if (worker.siblings.length > 0) return refuse(409, ARCHIVE_REFUSALS.runOpen, { runs: worker.siblings });
    }
    const coordinates = measured(() => port.openRunsClaimedBy(id));
    // Fail-shut, with or without `programme:'end'`: a programme this box cannot enumerate cannot be ended.
    if (!coordinates.ok) return refuse(409, ARCHIVE_REFUSALS.coordinatorHasOpenRuns, { runs: [] });
    claimed = coordinates.siblings;
    if (claimed.length > 0 && !flags.programmeEnd) {
      return refuse(409, ARCHIVE_REFUSALS.coordinatorHasOpenRuns, { runs: claimed });
    }
  }
  if (m.workspace && !m.verbSupported) return refuse(501, 'unsupported');
  // The last check: every run the abandon arm could not move from its row alone, found BEFORE the first is ended —
  // otherwise whether a programme is left partly ended would depend on run id order. Nothing is ended here.
  for (const run of claimed) {
    let why: Extract<CloseOutcome, { ok: false }> | null;
    try { why = port!.abandonRefusal(run.id); } catch (e) {
      return refuse(409, ARCHIVE_REFUSALS.programmePartlyEnded,
        { closed: [], notClosed: claimed, refusal: { id: run.id, kind: 'threw', detail: thrown(e) } });
    }
    if (why !== null) {
      return refuse(409, ARCHIVE_REFUSALS.programmePartlyEnded,
        { closed: [], notClosed: claimed, refusal: closeRefusalOf(run.id, why) });
    }
  }
  // THE ONE ACT THIS FUNCTION TAKES, and the last thing it does. In id order; the first refusal stops the door, so a
  // partly ended programme is never followed by a stop or an archive. An abandon that THROWS after an earlier one
  // ended its run answers the same way, naming what was closed, rather than leaving as a 500 that names nothing.
  const ended: OpenSibling[] = [];
  for (const [i, run] of claimed.entries()) {
    let out: CloseOutcome;
    try { out = await port!.abandon(run.id); } catch (e) {
      return refuse(409, ARCHIVE_REFUSALS.programmePartlyEnded,
        { closed: ended, notClosed: claimed.slice(i), refusal: { id: run.id, kind: 'threw', detail: thrown(e) } });
    }
    if (!out.ok) {
      return refuse(409, ARCHIVE_REFUSALS.programmePartlyEnded,
        { closed: ended, notClosed: claimed.slice(i), refusal: closeRefusalOf(run.id, out) });
    }
    ended.push(run);
  }
  return { ok: true, stop: flags.interrupt || !m.workspace, wsArchive: m.workspace, ended };
}

/**
 * The stop's own busy re-read refused (`server.ts`: a stop nobody consented to interrupt — a main checkout's — re-reads
 * busy fail-closed at the act, because `cmd_stop` refuses nothing). A turn began after the door's first read: during
 * the claim reads, the mutex wait or the programme end. `409 session-busy`, carrying the runs already ended, so the
 * busy question that follows never reads as "nothing happened".
 */
export function busyAtStop(ended: readonly OpenSibling[]): ArchiveReply {
  return { status: 409, body: { ok: false, error: ARCHIVE_REFUSALS.sessionBusy, ...(ended.length > 0 ? { ended } : {}) } };
}

/**
 * ccd's refusal of `ws-archive`, as the door's word for it — or `null` for one this build has no word for. Read off
 * `cmd_ws_archive`'s own `die` lines (`ccd: <message>`), which `archive-ccd-words.test.ts` produces by running the
 * real verb in a fixture HOME, so a reworded ccd reds there rather than silently losing its word here.
 */
export function ccdArchiveRefusal(stderr: string): ArchiveRefusal | null {
  const lines = stderr.split('\n').map((l) => l.trim());
  if (lines.includes('ccd: session-busy')) return ARCHIVE_REFUSALS.sessionBusy;
  if (lines.includes('ccd: status-unknown')) return ARCHIVE_REFUSALS.statusUnknown;
  if (lines.some((l) => l.startsWith('ccd: worktree is gone: '))) return ARCHIVE_REFUSALS.worktreeGone;
  if (lines.some((l) => /^ccd: (cannot describe \S+ truthfully|empty archive manifest for \S+|archive manifest for \S+ is not valid JSON) — nothing was touched$/.test(l))) {
    return ARCHIVE_REFUSALS.manifestUnbuildable;
  }
  return null;
}

/**
 * `ws-archive`'s answer on the wire, once the door has acted. Success is `archived:true`. A refusal AFTER the door
 * stopped the session is the partial outcome — `200 {archived:false, stopped:true, refusal}`: the row is a stopped,
 * unarchived workspace, visible at the top level with Archive offered again. A refusal with nothing stopped is a 409
 * with ccd's word (`detail` carries its sentence), or today's 502 `{stderr}` when this build has no word for it.
 * `ended` rides every answer once a programme was ended, so the operator is never told only half of what happened.
 */
export function archiveOutcome(
  stopped: boolean, ended: readonly OpenSibling[], res: { ok: boolean; stderr: string },
): ArchiveReply {
  if (res.ok) return { status: 200, body: { ok: true, archived: true, stopped, ended } };
  const refusal = ccdArchiveRefusal(res.stderr);
  const detail = res.stderr.trim();
  if (stopped) return { status: 200, body: { ok: true, archived: false, stopped: true, ended, refusal, detail } };
  const endedSpread = ended.length > 0 ? { ended } : {};
  if (refusal !== null) return { status: 409, body: { ok: false, error: refusal, detail, ...endedSpread } };
  return { status: 502, body: { ok: false, stderr: res.stderr, ...endedSpread } };
}
````

- [ ] **Step 4: Run them and the typecheck.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archive-door-decide.test.ts test/archive-ccd-words.test.ts )
( cd server && ./node_modules/.bin/tsc --noEmit -p . )
( cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json )
```

Expected: `45 passed (45)`; no output from either `tsc` (Task 1's note). `archive-ccd-words` mints its fixture workspace with `ws-add`, so on a box whose disk is under `ccd`'s 10G floor its six `ws-add` cases red with `only <N>G free … floor is 10G` — on the base's own `ws-add` suites too — and its CONTROL, which mints none, stays green; re-run it with `CCD_DISK_FLOOR_GB=1` (measured by raising the floor above the free space: `6 failed | 1 passed (7)`; with `CCD_DISK_FLOOR_GB=1`: `7 passed (7)`).

- [ ] **Step 5: Commit.**

```bash
git add server/src/coord/archiveDoor.ts server/test/archive-door-decide.test.ts server/test/archive-ccd-words.test.ts
git commit -m "coord: the archive door's decision — every refusable check before the one act (workspace lifecycle W2)"
```

### Task 5: The door — `POST /api/sessions/:id/archive` for both kinds of row

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `server/src/server.ts` (the imports; the handle captured from `registerCoordRoutes`; `stopArgvFor` and `liveRowFor` above `/stop`; `/stop` calls `stopArgvFor`; the swap route's comment about `/archive`; the archive route rewritten)
- Create: `server/test/archive-door.test.ts`
- Modify: `server/test/lifecycle.test.ts`, `server/test/pr-routes.test.ts`, `server/test/routes.test.ts` (their archive fixtures become workspaces with a real worktree — the door now stops a main checkout and refuses a PROVEN-gone worktree; `routes.test.ts` also gains the door's `503 registry-unmeasurable` case beside `/stop`'s)

**Interfaces:**
- Consumes: `archiveInterrupts` (Task 1), `CoordStore.openRunsClaimedBy` (Task 2), `CoordRoutesHandle.withAbandon` and its pre-read (Task 3), `archiveFlags`/`decideArchive`/`worktreeOf`/`busyAtStop`/`archiveOutcome` (Task 4), `readLiveStateMeasured` (`livestate.ts`, for `idleForStop`).
- Produces, on the wire: `200 {ok:true, archived:true, stopped, ended}`; the partial outcome `200 {ok:true, archived:false, stopped:true, ended, refusal, detail}`; refusals `409 {ok:false, error, …}` (`session-busy`; `worktree-gone`; `run-open` + `runs`; `coordinator-has-open-runs` + `runs`; `programme-partly-ended` + `closed`, `notClosed`, `refusal`; a ccd word + `detail`), `501 unsupported`, `502 {stderr}`, `400 bad-request`, `503 registry-unmeasurable`, `404 unknown-session`; a main checkout found busy at its stop is `409 session-busy` too; every answer after a programme end carries `ended`.

- [ ] **Step 1: Write the failing test, and give the three older suites real worktrees.**

<!-- replay: T5 replace server/test/routes.test.ts old-inline new-inline -->
In `server/test/routes.test.ts`, find:

````ts
    seedSession(home, id, 'claude-a');
    return home;
  };
````

Replace with:

````ts
    seedSession(home, id, 'claude-a');
    // Workspace lifecycle wave 2: the one Archive archives a WORKSPACE whose worktree it measured present; a row with
    // no `workspace` is a main checkout, which it stops instead (`archive-door.test.ts`).
    const worktree = path.join(home, 'worktrees', id);
    mkdirSync(worktree, { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', `${id}.workspace`), id);
    writeFileSync(path.join(home, '.cc-sessions', `${id}.workdir`), worktree);
    return home;
  };
````

<!-- replay: T5 replace server/test/routes.test.ts -->
In `server/test/routes.test.ts`, find:

````ts
  it('still refuses 404 unknown-session for a session PROVEN absent from the registry', async () => {
````

Replace with:

````ts
  it('the archive door refuses 503 registry-unmeasurable too, and runs no ccd verb (workspace lifecycle §5.2)', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, ID, 'claude-a');
    const calls: string[][] = [];
    const run: Runner = async (_c, args) => { calls.push(args); return { code: 0, stdout: '', stderr: '' }; };
    const cfg = loadConfig({ CCRC_HOME: home });
    const app = await buildServer(
      { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: unreadableField(ID, 'wrapper'), queue: new KeyedQueue() },
      new Bus(),
    );
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/archive` });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    expect(calls.filter((c) => c[0] === 'ws-archive' || c[0] === 'stop')).toEqual([]);
    await app.close();
  });

  it('still refuses 404 unknown-session for a session PROVEN absent from the registry', async () => {
````

<!-- replay: T5 replace server/test/pr-routes.test.ts old-inline new-inline -->
In `server/test/pr-routes.test.ts`, find:

````ts
/** A registry home with one workspace session, so `knownId` resolves. */
function seedWorkspace(): string {
  const home = mkTmp('ccrc-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [f, v] of [['uuid', 'u'], ['wrapper', 'claude'], ['workdir', '/w'],
````

Replace with:

````ts
/** A registry home with one workspace session, so `knownId` resolves — and its worktree really there, which the
 *  archive door measures before it acts (workspace lifecycle §5.2). */
function seedWorkspace(): string {
  const home = mkTmp('ccrc-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const worktree = path.join(home, 'w');
  mkdirSync(worktree);
  for (const [f, v] of [['uuid', 'u'], ['wrapper', 'claude'], ['workdir', worktree],
````

<!-- replay: T5 replace server/test/pr-routes.test.ts old-inline new-inline -->
In `server/test/pr-routes.test.ts`, find:

````ts
      expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
      expect(calls).toEqual([]);
````

Replace with:

````ts
      expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
      // No ccd verb at all. The archive door MEASURES first — tmux's read-only `has-session`/`list-panes`, its busy
      // read (workspace lifecycle §5.2) — and refuses before any act.
      expect(calls.filter((c) => c[0] !== 'has-session' && c[0] !== 'list-panes')).toEqual([]);
````

<!-- replay: T5 create server/test/archive-door.test.ts -->
Create `server/test/archive-door.test.ts`:

````ts
// `POST /api/sessions/:id/archive` — the ONE "Archive" (workspace lifecycle spec §5.2), end to end through
// `buildServer`, over a fixture HOME: the registry rows, the worktree, the live status file and the hook state are
// files in it, the coordination store is a real `coord.db`, and every tmux and ccd call is a recorded double.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { Bus } from '../src/bus.js';
import type { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { NotifyLog } from '../src/notifylog.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

const PANE = 4242;
const COORDINATOR = 'demo-coordinator';
const CCD_VERBS = new Set(['ws-archive', 'stop', 'ws-release', 'ws-hold', 'ws-audit', 'ws-reclaim']);

interface BoxCfg {
  /** `tmux has-session` answers: a pane, or a clean "no such session". */
  alive?: boolean;
  /** `tmux has-session` cannot be asked — tmux's own words for a server it cannot reach (`unknown`, D-308). */
  tmuxUnknown?: boolean;
  /** `tmux list-panes` fails, so no pane pid is read. */
  noPanePid?: boolean;
  /** Called with every call's argv BEFORE it is answered — a turn that starts while the door is mid-way. */
  onCall?: (args: string[]) => void;
  /** The watcher's newest pane dialogs (`currentPending`): sessions with a dialog waiting on the operator. */
  pending?: string[];
  /** A ccd verb's answer, by verb; every other verb exits 0. */
  ccd?: Record<string, { code: number; stderr: string }>;
  /** Remote mode's view of a worktree: the fleet agent's read roots (`checkPath`) exclude `~/worktrees`, so every
   *  stat under one answers `unreadable` (`remote/io.ts`), never `absent`. */
  worktreeUnreadable?: boolean;
}

let open: FastifyInstance[] = [];
afterEach(async () => { for (const a of open) await a.close(); open = []; });

const box = async (cfg: BoxCfg = {}, over: Partial<Deps> = {}) => {
  const home = mkTmp('ccrc-archive-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    cfg.onCall?.(args);
    const verb = args[0] ?? '';
    if (verb === 'has-session') {
      if (cfg.tmuxUnknown === true) {
        return { code: 1, stdout: '', stderr: 'error connecting to /tmp/tmux-1000/default (Resource temporarily unavailable)' };
      }
      return cfg.alive === false ? { code: 1, stdout: '', stderr: `can't find session: ${args[2] ?? ''}` }
        : { code: 0, stdout: '', stderr: '' };
    }
    if (verb === 'list-panes') {
      return cfg.noPanePid === true ? { code: 1, stdout: '', stderr: 'lost server' } : { code: 0, stdout: `${PANE}\n`, stderr: '' };
    }
    const scripted = cfg.ccd?.[verb];
    return scripted ? { code: scripted.code, stdout: '', stderr: scripted.stderr } : { code: 0, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  const worktrees = `${path.sep}worktrees${path.sep}`;
  const io = cfg.worktreeUnreadable !== true ? base.io : { ...base.io,
    statMeasured: async (p: string) => (p.includes(worktrees) ? { ok: false as const, reason: 'unreadable' as const }
      : base.io.statMeasured(p)) };
  const watcher = cfg.pending === undefined ? undefined : { currentPending: () => new Set(cfg.pending),
    currentStatuslines: () => new Map(), stop: () => {} } as unknown as FleetWatcher;
  const app = await buildServer({ ...base, io, coord, ...over }, new Bus(), watcher);
  open.push(app);
  return { home, calls, app, coord, ccd: () => calls.filter((c) => CCD_VERBS.has(c[0] ?? '')) };
};

/** A registry row. `workspace: null` is a main checkout, whose id is `<wrapper>-<project>`. */
const seed = (home: string, id: string, o: { workspace?: string | null; worktree?: boolean } = {}): string => {
  const reg = path.join(home, '.cc-sessions');
  const ws = o.workspace === undefined ? id.replace(/^demo-/, '') : o.workspace;
  const workdir = ws === null ? path.join(home, 'projects', 'demo') : path.join(home, 'worktrees', 'demo', ws);
  if (o.worktree !== false) mkdirSync(workdir, { recursive: true });
  const fields: Record<string, string> = { wrapper: 'claude-a', project: 'demo', workdir, uuid: `u-${id}`, started: '1',
    ...(ws === null ? {} : { workspace: ws, branch: `ws/${ws}`, base: 'origin/main' }) };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
  return workdir;
};

/** Claude Code's own live file for the pane: what `status` is read from. */
const liveStatus = (home: string, status: string): void => {
  const dir = path.join(home, '.claude-a', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${PANE}.json`),
    JSON.stringify({ pid: PANE, sessionId: 'u', status, statusUpdatedAt: Date.now() - 60_000 }));
};

const post = (app: FastifyInstance, id: string, payload?: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/api/sessions/${id}/archive`, ...(payload === undefined ? {} : { payload }) });

const coordinates = (coord: CoordStore, n: number, program = 'lifecycle'): number[] =>
  Array.from({ length: n }, (_, i) => {
    const r = coord.openRun({ program, title: 'T', project: 'demo', wave: i + 1, waveOf: 3, claimedBy: COORDINATOR });
    if (!('id' in r)) throw new Error('fixture openRun refused');
    return r.id;
  });

describe('the one Archive — a workspace', () => {
  it('archives an idle workspace with ws-archive alone: nothing else is stopped first', async () => {
    const b = await box();
    seed(b.home, 'demo-amber');
    const res = await post(b.app, 'demo-amber');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, archived: true, stopped: false, ended: [] });
    expect(b.ccd()).toEqual([['ws-archive', '--session', 'demo-amber']]);
  });

  it('refuses a busy workspace 409 session-busy, reading the live file on the request — and touches nothing', async () => {
    const b = await box();
    seed(b.home, 'demo-amber');
    liveStatus(b.home, 'busy');
    const res = await post(b.app, 'demo-amber');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'session-busy' });
    expect(b.ccd()).toEqual([]);
  });

  it('reads the HOOK on the request too: a turn the hook reports in flight is busy though the live file says nothing', async () => {
    const b = await box();
    seed(b.home, 'demo-amber');
    writeFileSync(path.join(b.home, '.cc-sessions', 'demo-amber.hookstate.json'), JSON.stringify({
      v: 1, state: 'working', sessionId: 'u-demo-amber', updatedAt: Date.now(), event: 'PreToolUse' }));
    expect((await post(b.app, 'demo-amber')).json()).toEqual({ ok: false, error: 'session-busy' });
    expect(b.ccd()).toEqual([]);
  });

  it('reads the PANE too: a dialog waiting on the operator is busy though the live file and the hook say nothing', async () => {
    const b = await box({ pending: ['demo-amber'] });
    seed(b.home, 'demo-amber');
    expect((await post(b.app, 'demo-amber')).json()).toEqual({ ok: false, error: 'session-busy' });
    expect(b.ccd()).toEqual([]);
  });

  it('with `interrupt`, stops the busy workspace FIRST and then archives it', async () => {
    const b = await box();
    seed(b.home, 'demo-amber');
    liveStatus(b.home, 'busy');
    const res = await post(b.app, 'demo-amber', { interrupt: true });
    expect(res.json()).toEqual({ ok: true, archived: true, stopped: true, ended: [] });
    expect(b.ccd()).toEqual([['stop', 'demo-amber'], ['ws-archive', '--session', 'demo-amber']]);
  });

  it('refuses a workspace whose worktree is gone, before anything is stopped or archived', async () => {
    const b = await box();
    seed(b.home, 'demo-amber', { worktree: false });
    const res = await post(b.app, 'demo-amber', { interrupt: true });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'worktree-gone' });
    expect(b.ccd()).toEqual([]);
  });

  it('maps ccd\'s own session-busy — the race after the live read — to 409 session-busy', async () => {
    const b = await box({ ccd: { 'ws-archive': { code: 1, stderr: 'ccd: session-busy\n' } } });
    seed(b.home, 'demo-amber');
    const res = await post(b.app, 'demo-amber');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'session-busy', detail: 'ccd: session-busy' });
  });

  it('a manifest ccd cannot build, with nothing stopped, is 409 manifest-unbuildable — a "Stop only" refusal', async () => {
    const b = await box({ ccd: { 'ws-archive': { code: 1,
      stderr: 'ccd: cannot describe demo-amber truthfully — nothing was touched\n' } } });
    seed(b.home, 'demo-amber');
    expect((await post(b.app, 'demo-amber')).json())
      .toMatchObject({ ok: false, error: 'manifest-unbuildable' });
    expect(b.ccd()).toEqual([['ws-archive', '--session', 'demo-amber']]);
  });

  it('stopped, then refused: 200 {archived:false, stopped:true, refusal} — the row stays visible, stopped', async () => {
    const b = await box({ ccd: { 'ws-archive': { code: 1, stderr: 'ccd: status-unknown\n' } } });
    seed(b.home, 'demo-amber');
    liveStatus(b.home, 'busy');
    const res = await post(b.app, 'demo-amber', { interrupt: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, archived: false, stopped: true, ended: [], refusal: 'status-unknown',
      detail: 'ccd: status-unknown' });
  });

  it('refuses a body whose programme word is not "end", reading nothing', async () => {
    const b = await box();
    seed(b.home, 'demo-amber');
    expect((await post(b.app, 'demo-amber', { programme: 'keep' })).statusCode).toBe(400);
    expect(b.calls).toEqual([]);
  });
});

describe('the one Archive — a main checkout', () => {
  it('stops an idle main checkout with /stop\'s own argv, and never sends it to ws-archive', async () => {
    const b = await box();
    seed(b.home, 'claude-a-demo', { workspace: null });
    liveStatus(b.home, 'idle');
    const res = await post(b.app, 'claude-a-demo');
    expect(res.json()).toEqual({ ok: true, archived: true, stopped: true, ended: [] });
    expect(b.ccd()).toEqual([['stop', 'claude-a', 'demo']]);
  });

  it('refuses a busy main checkout without `interrupt`, and stops it with one', async () => {
    const b = await box();
    seed(b.home, 'claude-a-demo', { workspace: null });
    liveStatus(b.home, 'busy');
    expect((await post(b.app, 'claude-a-demo')).json()).toEqual({ ok: false, error: 'session-busy' });
    expect(b.ccd()).toEqual([]);
    expect((await post(b.app, 'claude-a-demo', { interrupt: true })).json()).toMatchObject({ archived: true, stopped: true });
    expect(b.ccd()).toEqual([['stop', 'claude-a', 'demo']]);
  });

  it('answers a failed stop as /stop does — 502 with ccd\'s stderr', async () => {
    const b = await box({ ccd: { stop: { code: 1, stderr: 'ccd: no tmux server\n' } } });
    seed(b.home, 'claude-a-demo', { workspace: null });
    liveStatus(b.home, 'idle');
    const res = await post(b.app, 'claude-a-demo');
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, stderr: 'ccd: no tmux server\n' });
  });

  it('a stop that fails AFTER the programme was ended says both: ccd\'s stderr and the runs it ended', async () => {
    const b = await box({ ccd: { stop: { code: 1, stderr: 'ccd: no tmux server\n' } } });
    seed(b.home, 'claude-a-demo', { workspace: null });
    liveStatus(b.home, 'idle');
    const r = b.coord.openRun({ program: 'lifecycle', title: 'T', project: 'demo', wave: 1, waveOf: 3,
      claimedBy: 'claude-a-demo' });
    if (!('id' in r)) throw new Error('fixture openRun refused');
    const res = await post(b.app, 'claude-a-demo', { programme: 'end' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, stderr: 'ccd: no tmux server\n',
      ended: [{ id: r.id, program: 'lifecycle', wave: 1, waveOf: 3 }] });
  });

  // `cmd_stop` refuses nothing, so the door's own read is a main checkout's only guard: it is read FAIL-CLOSED, by
  // `_ws_status`'s rule, where the fleet frame folds an unmeasured pane towards rest (D-309).
  it.each([
    ['tmux cannot be asked (`unknown`, which the frame reads as dead)', { tmuxUnknown: true }],
    ['the pane pid cannot be read (the frame leaves `idle`)', { noPanePid: true }],
  ] as const)('a busy main checkout is not stopped when %s — 409 session-busy, no verb', async (_why, cfg) => {
    const b = await box(cfg);
    seed(b.home, 'claude-a-demo', { workspace: null });
    liveStatus(b.home, 'busy');
    expect((await post(b.app, 'claude-a-demo')).json()).toEqual({ ok: false, error: 'session-busy' });
    expect(b.ccd()).toEqual([]);
  });

  it('a busy main checkout that coordinates is refused BEFORE its programme is ended — busy is the first check', async () => {
    const b = await box();
    seed(b.home, 'claude-a-demo', { workspace: null });
    liveStatus(b.home, 'busy');
    const r = b.coord.openRun({ program: 'lifecycle', title: 'T', project: 'demo', wave: 1, waveOf: 3,
      claimedBy: 'claude-a-demo' });
    if (!('id' in r)) throw new Error('fixture openRun refused');
    expect((await post(b.app, 'claude-a-demo', { programme: 'end' })).json()).toEqual({ ok: false, error: 'session-busy' });
    expect(okRun(b.coord.run(r.id))!.state).toBe('planned');
    expect(b.ccd()).toEqual([]);
  });

  it('a live main checkout with no live file has not said it is idle: busy, and `interrupt` stops it', async () => {
    const b = await box();
    seed(b.home, 'claude-a-demo', { workspace: null });
    expect((await post(b.app, 'claude-a-demo')).json()).toEqual({ ok: false, error: 'session-busy' });
    expect(b.ccd()).toEqual([]);
    expect((await post(b.app, 'claude-a-demo', { interrupt: true })).json()).toMatchObject({ archived: true, stopped: true });
    expect(b.ccd()).toEqual([['stop', 'claude-a', 'demo']]);
  });

  it('a turn that starts DURING the programme end is not lost: the stop re-reads busy at the act and refuses, naming the end', async () => {
    let home = '';
    const b = await box({ onCall: (args) => { if (args[0] === 'ws-release') liveStatus(home, 'busy'); } });
    home = b.home;
    seed(b.home, 'claude-a-demo', { workspace: null });
    seed(b.home, 'demo-w');
    liveStatus(b.home, 'idle');
    const r = b.coord.openRun({ program: 'lifecycle', title: 'T', project: 'demo', wave: 1, waveOf: 3,
      claimedBy: 'claude-a-demo' });
    if (!('id' in r)) throw new Error('fixture openRun refused');
    b.coord.markDispatched(r.id, 'demo-w', 'demo-w', 'ws/w', false);
    expect(b.coord.advance(r.id, 'dispatched', 'coordinator').ok).toBe(true);
    const res = await post(b.app, 'claude-a-demo', { programme: 'end' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'session-busy',
      ended: [{ id: r.id, program: 'lifecycle', wave: 1, waveOf: 3 }] });
    expect(b.ccd()).toEqual([['ws-release', '--session', 'demo-w']]);
  });
});

describe('the one Archive — a coordinator (L5)', () => {
  it('refuses 409 coordinator-has-open-runs, naming the runs, and ends nothing', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    const [r1, r2] = coordinates(b.coord, 2);
    const res = await post(b.app, COORDINATOR);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'coordinator-has-open-runs', runs: [
      { id: r1, program: 'lifecycle', wave: 1, waveOf: 3 }, { id: r2, program: 'lifecycle', wave: 2, waveOf: 3 }] });
    expect(okRun(b.coord.run(r1!))!.state).toBe('planned');
    expect(b.ccd()).toEqual([]);
  });

  it('with `programme:"end"`, abandons every run as the operator, then archives', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    const [r1, r2] = coordinates(b.coord, 2);
    const res = await post(b.app, COORDINATOR, { programme: 'end' });
    expect(res.json()).toEqual({ ok: true, archived: true, stopped: false, ended: [
      { id: r1, program: 'lifecycle', wave: 1, waveOf: 3 }, { id: r2, program: 'lifecycle', wave: 2, waveOf: 3 }] });
    for (const r of [r1!, r2!]) {
      expect(okRun(b.coord.run(r))!.state).toBe('failed');
      const ev = b.coord.db.prepare('SELECT causedBy FROM run_events WHERE runId = ? ORDER BY id DESC LIMIT 1')
        .get(r) as { causedBy: string };
      expect(ev.causedBy).toBe('operator');
    }
    expect(b.ccd()).toEqual([['ws-archive', '--session', COORDINATOR]]);
  });

  it.each(['last', 'first'] as const)(
    'a run the abandon arm cannot move (here %s by id) is found BEFORE any run is ended: NOTHING is ended, stopped or archived',
    async (where) => {
      const b = await box();
      seed(b.home, COORDINATOR);
      liveStatus(b.home, 'busy');
      const [r1, r2] = coordinates(b.coord, 2);
      const stuck = where === 'last' ? r2! : r1!;
      b.coord.setSession(stuck, 'demo-worker');
      b.coord.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run('closing', stuck);
      const res = await post(b.app, COORDINATOR, { programme: 'end', interrupt: true });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ ok: false, error: 'programme-partly-ended', closed: [],
        notClosed: [{ id: r1, program: 'lifecycle', wave: 1, waveOf: 3 }, { id: r2, program: 'lifecycle', wave: 2, waveOf: 3 }],
        refusal: { id: stuck, kind: 'bad-transition', detail: 'closing → closing' } });
      expect([r1!, r2!].map((r) => okRun(b.coord.run(r))!.state))
        .toEqual(where === 'last' ? ['planned', 'closing'] : ['closing', 'planned']);
      expect(b.ccd()).toEqual([]);
    });

  it('an abandon refused AT the act stops the door there: programme-partly-ended names what it closed, nothing is stopped or archived', async () => {
    const b = await box({ ccd: { 'ws-release': { code: 1, stderr: 'ccd: lock busy\n' } } });
    seed(b.home, COORDINATOR);
    seed(b.home, 'demo-w');
    liveStatus(b.home, 'busy');
    const [r1, r2] = coordinates(b.coord, 2);
    b.coord.markDispatched(r2!, 'demo-w', 'demo-w', 'ws/w', false);
    expect(b.coord.advance(r2!, 'dispatched', 'coordinator').ok).toBe(true);
    const res = await post(b.app, COORDINATOR, { programme: 'end', interrupt: true });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'programme-partly-ended',
      closed: [{ id: r1, program: 'lifecycle', wave: 1, waveOf: 3 }],
      notClosed: [{ id: r2, program: 'lifecycle', wave: 2, waveOf: 3 }],
      refusal: { id: r2, kind: 'fleetFailed', detail: 'ccd: lock busy' } });
    expect([r1!, r2!].map((r) => okRun(b.coord.run(r))!.state)).toEqual(['failed', 'dispatched']);
    expect(b.ccd()).toEqual([['ws-release', '--session', 'demo-w']]);
  });

  it('every refusable check runs before the programme is ended: a gone worktree ends nothing', async () => {
    const b = await box();
    seed(b.home, COORDINATOR, { worktree: false });
    const [r1] = coordinates(b.coord, 1);
    expect((await post(b.app, COORDINATOR, { programme: 'end' })).json()).toEqual({ ok: false, error: 'worktree-gone' });
    expect(okRun(b.coord.run(r1!))!.state).toBe('planned');
  });

  it('an unreadable store refuses fail-shut with `runs: []`, programme or not', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    coordinates(b.coord, 1);
    b.coord.db.prepare(
      'INSERT INTO runs (id, program, wave, waveOf, project, state, claimedBy, openedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(4242, 'lifecycle', BigInt(Number.MAX_SAFE_INTEGER) + 1n, 3, 'demo', 'planned', COORDINATOR, Date.now());
    for (const body of [undefined, { programme: 'end' }]) {
      expect((await post(b.app, COORDINATOR, body)).json())
        .toEqual({ ok: false, error: 'coordinator-has-open-runs', runs: [] });
    }
    expect(b.ccd()).toEqual([]);
  });

  it('a store that THROWS is a store this box cannot read: the same fail-shut 409s, never a 500', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    b.coord.db.close();
    const plain = await post(b.app, COORDINATOR);
    expect(plain.statusCode).toBe(409);
    expect(plain.json()).toEqual({ ok: false, error: 'run-open', runs: [] });
    const forced = await post(b.app, COORDINATOR, { force: true, programme: 'end' });
    expect(forced.statusCode).toBe(409);
    expect(forced.json()).toEqual({ ok: false, error: 'coordinator-has-open-runs', runs: [] });
    expect(b.ccd()).toEqual([]);
  });

  it('ends the programme through the abandon door\'s own decision: a CHILD worker\'s reclaim is queued, as an abandon queues it', async () => {
    const home = mkTmp('ccrc-archive-notify-');
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const queue = new KeyedQueue();
    const b = await box({}, { queue, notifyLog });
    seed(b.home, COORDINATOR);
    seed(b.home, 'demo-child');
    const [r1] = coordinates(b.coord, 1);
    b.coord.markDispatched(r1!, 'demo-child', 'demo-child', 'ws/child', false);
    expect(b.coord.advance(r1!, 'dispatched', 'coordinator').ok).toBe(true);
    writeFileSync(path.join(b.home, '.cc-sessions', 'demo-child.child'), String(r1));
    expect((await post(b.app, COORDINATOR, { programme: 'end' })).json()).toMatchObject({ ok: true, archived: true });
    await queue.run('demo-child', async () => undefined);
    expect(b.coord.feedEvents(50).filter((e) => e.sessionId === 'demo-child').map((e) => e.title))
      .toEqual(['child reclaim deferred']);
    expect(b.ccd()).toEqual([['ws-release', '--session', 'demo-child'], ['ws-archive', '--session', COORDINATOR]]);
  });
});

describe('the one Archive — remote mode, where this box cannot read a worktree', () => {
  it('an unreadable worktree is not a refusal: ws-archive runs, and ccd measures the worktree itself', async () => {
    const b = await box({ worktreeUnreadable: true });
    seed(b.home, 'demo-amber');
    expect((await post(b.app, 'demo-amber')).json()).toEqual({ ok: true, archived: true, stopped: false, ended: [] });
    expect(b.ccd()).toEqual([['ws-archive', '--session', 'demo-amber']]);
  });

  it('a gone worktree only ccd can see: the programme was ended first, and the 409 names the runs it ended', async () => {
    const b = await box({ worktreeUnreadable: true, ccd: { 'ws-archive': { code: 1,
      stderr: `ccd: worktree is gone: /w — cannot describe it for the archive record; see: ccd ws-attic --session ${COORDINATOR}\n` } } });
    seed(b.home, COORDINATOR, { worktree: false });
    const [r1] = coordinates(b.coord, 1);
    const res = await post(b.app, COORDINATOR, { programme: 'end' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'worktree-gone',
      ended: [{ id: r1, program: 'lifecycle', wave: 1, waveOf: 3 }] });
    expect(okRun(b.coord.run(r1!))!.state).toBe('failed');
    expect(b.ccd()).toEqual([['ws-archive', '--session', COORDINATOR]]);
  });
});

describe('the one Archive — the worker check, as it was', () => {
  it('refuses 409 run-open naming the runs, and `force` proceeds', async () => {
    const b = await box();
    seed(b.home, 'demo-amber');
    const r = b.coord.openRun({ program: 'lifecycle', title: 'T', project: 'demo', wave: 1, waveOf: 3, claimedBy: COORDINATOR });
    if (!('id' in r)) throw new Error('fixture openRun refused');
    b.coord.setSession(r.id, 'demo-amber');
    expect((await post(b.app, 'demo-amber')).json())
      .toEqual({ ok: false, error: 'run-open', runs: [{ id: r.id, program: 'lifecycle', wave: 1, waveOf: 3 }] });
    expect((await post(b.app, 'demo-amber', { force: true })).json()).toMatchObject({ ok: true, archived: true });
  });

  it('a dead row needs no interrupt: a stopped workspace is archived again, a crashed main checkout is stopped', async () => {
    const b = await box({ alive: false });
    seed(b.home, 'demo-amber');
    seed(b.home, 'claude-a-demo', { workspace: null });
    expect((await post(b.app, 'demo-amber')).json()).toMatchObject({ archived: true, stopped: false });
    expect((await post(b.app, 'claude-a-demo')).json()).toMatchObject({ archived: true, stopped: true });
  });
});
````

<!-- replay: T5 replace server/test/lifecycle.test.ts -->
In `server/test/lifecycle.test.ts`, find:

````ts
describe('wave 6 — the dec flags are sent only to a ccd that says it parses them', () => {
````

Replace with:

````ts
describe('wave 6 — the dec flags are sent only to a ccd that says it parses them', () => {
  // Workspace lifecycle §5.2: the one Archive sends `ws-archive` for a WORKSPACE (a main checkout is stopped instead)
  // and measures the pane first, through the same runner — so the default session is made a workspace with a real
  // worktree here, and only ccd's own calls are compared.
  const asWorkspace = (home: string): void => {
    const worktree = path.join(home, 'worktrees', 'mek');
    mkdirSync(worktree, { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', `${ID}.workspace`), 'mek');
    writeFileSync(path.join(home, '.cc-sessions', `${ID}.workdir`), worktree);
  };
  const ccdCalls = (calls: string[][], bin: string): string[][] => calls.filter((c) => c[0] === bin);
````

<!-- replay: T5 replace server/test/lifecycle.test.ts old-inline new-inline -->
In `server/test/lifecycle.test.ts`, find:

````ts
    const { app, calls, cfg } = await makeApp({ ccdVerbs: ['ws-archive', 'ws-restore', 'ws-hold', 'ws-release'] });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/archive`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'ws-archive', '--session', ID]]);
````

Replace with:

````ts
    const { app, calls, cfg, home } = await makeApp({ ccdVerbs: ['ws-archive', 'ws-restore', 'ws-hold', 'ws-release'] });
    asWorkspace(home);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/archive`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(ccdCalls(calls, cfg.ccdBin)).toEqual([[cfg.ccdBin, 'ws-archive', '--session', ID]]);
````

<!-- replay: T5 replace server/test/lifecycle.test.ts old-inline new-inline -->
In `server/test/lifecycle.test.ts`, find:

````ts
    const { app, calls, cfg } = await makeApp({ ccdVerbs: null });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/archive`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([[cfg.ccdBin, 'ws-archive', '--session', ID]]);
````

Replace with:

````ts
    const { app, calls, cfg, home } = await makeApp({ ccdVerbs: null });
    asWorkspace(home);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/archive`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(ccdCalls(calls, cfg.ccdBin)).toEqual([[cfg.ccdBin, 'ws-archive', '--session', ID]]);
````

<!-- replay: T5 replace server/test/lifecycle.test.ts old-inline new-inline -->
In `server/test/lifecycle.test.ts`, find:

````ts
    const { app, calls, cfg } = await makeApp({ ccdVerbs: ['ws-archive', 'actor-flags-v1'] });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/archive`, payload: {} });
    expect(res.statusCode).toBe(200);
````

Replace with:

````ts
    const { app, calls, cfg, home } = await makeApp({ ccdVerbs: ['ws-archive', 'actor-flags-v1'] });
    asWorkspace(home);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/archive`, payload: {} });
    expect(res.statusCode).toBe(200);
````

<!-- replay: T5 replace server/test/lifecycle.test.ts old-inline new-inline -->
In `server/test/lifecycle.test.ts`, find:

````ts
    expect(calls).toEqual([[cfg.ccdBin, 'ws-archive', '--session', ID,
                            '--surface', 'pwa', '--actor', 'unmeasured']]);
````

Replace with:

````ts
    expect(ccdCalls(calls, cfg.ccdBin)).toEqual([[cfg.ccdBin, 'ws-archive', '--session', ID,
                            '--surface', 'pwa', '--actor', 'unmeasured']]);
````

- [ ] **Step 2: Run them to verify the door's cases fail.**

Run: `( cd server && ./node_modules/.bin/vitest run test/archive-door.test.ts test/lifecycle.test.ts test/pr-routes.test.ts test/routes.test.ts )`
Expected: `33 failed | 174 passed (207)` — all 32 `archive-door` cases (the old route answers `{ok:true}` where the door answers a shape, `200` where it refuses, and never reads the body's new consents) and `routes.test.ts`'s new `the archive door refuses 503 registry-unmeasurable too` (`expected 200 to be 503`: the base's route never reads the row's identity); the three older suites' other cases pass before and after (their fixtures now carry a real worktree, which the old route ignores).

- [ ] **Step 3: Rewrite the route.**

<!-- replay: T5 replace server/src/server.ts -->
In `server/src/server.ts`, find:

````ts
import { ARCHIVE_REFUSALS } from '../../shared/api.js';
````

Replace with:

````ts
import { archiveInterrupts } from '../../shared/api.js';
import {
  archiveFlags, archiveOutcome, busyAtStop, decideArchive, worktreeOf, type ArchiveMeasure,
} from './coord/archiveDoor.js';
import { readLiveStateMeasured } from './livestate.js';
````

<!-- replay: T5 replace server/src/server.ts -->
In `server/src/server.ts`, find:

````ts
import { freshAskAt, measuredIdentity, readRegistry, readSessionRecord } from './registry.js';
````

Replace with:

````ts
import { freshAskAt, measuredIdentity, readRegistry, readSessionRecord } from './registry.js';
import type { SessionRecord } from './registry.js';
````

<!-- replay: T5 replace server/src/server.ts -->
In `server/src/server.ts`, find:

````ts
  registerCoordRoutes(app, deps, bus, sessionAuth, askDeps, watcher);
````

Replace with:

````ts
  //
  // It answers with its handle (workspace lifecycle §5.2): the coordination serialiser with the operator abandon inside
  // it, which the archive door below runs its `{programme:'end'}` on.
  const coordRoutes = registerCoordRoutes(app, deps, bus, sessionAuth, askDeps, watcher);
````

<!-- replay: T5 replace server/src/server.ts old-inline new-inline -->
In `server/src/server.ts`, find:

````ts
    // header calls the pane "its one cost"), and it too goes straight through
    // `runCcdOr502`. The PR-open
````

Replace with:

````ts
    // header calls the pane "its one cost"), and it too reaches ccd with no
    // queue. The PR-open
````

<!-- replay: T5 replace server/src/server.ts -->
In `server/src/server.ts`, find:

````ts
  app.post('/api/sessions/:id/stop', async (req, reply) => {
````

Replace with:

````ts
  /**
   * The stop argv — ONE spelling, two callers, both the PWA's own controls: `POST /api/sessions/:id/stop` ("Stop only",
   * offered after an archive refusal the phone cannot fix) and the archive door (workspace lifecycle §5.2), which stops
   * a main checkout, or a busy session the operator chose to interrupt.
   *
   * `pwa` is hard-coded here, not threaded from the request: both callers are
   * the PWA's own buttons (grep confirms it — nothing else in server/ or pwa/
   * reaches CCD_ARGV.stopId/stopPair), so there is no other identity this
   * declaration could honestly carry. `null` — omit the flag — when the
   * deployed ccd is not KNOWN to understand it (fix round 2, task 14,
   * Important #1): a bare `['stop', id]` is what every ccd generation has
   * always understood, where `['stop', id, '--surface', 'pwa']` against an
   * old one parses as a stop of a session named `<id>---surface` — exit 0,
   * nothing real touched, and the caller reads that as success. This is the
   * deploy-ordering hazard `deploy/deploy.sh` itself does not close (the
   * agent target installs `ccd`; the default server target never does, and
   * neither cross-checks the other's version), so the check has to live here
   * instead of being a rollout note.
   *
   * A `function` declaration on purpose: `verb-gate.test.ts` reads a call site's skew gate off its enclosing
   * function, and `stop` is ungated by decision (every ccd generation has the verb), as it was inside `/stop`.
   */
  function stopArgvFor(id: string, rec: SessionRecord, identity: { wrapper: string }): CcdArgv {
    const surface = stopSurfaceSupported(deps.fleetState) ? 'pwa' : null;
    // A workspace id is `<project>-<slug>` and encodes no wrapper at all, so
    // there is nothing to reverse: the prefix rule below would fall through to
    // identity.wrapper and ccd would recompute `<wrapper>-<project>` — a
    // DIFFERENT, live session, killed while the workspace kept running and
    // the PWA reported success. ccd stop's one-argument form takes the id
    // whole.
    if (rec.workspace !== null) return CCD_ARGV.stopId(id, surface);
    // Legacy ids DO encode a wrapper, and ccd stop's two-argument form
    // recomputes them — so it needs the ORIGINAL wrapper baked into the id, not
    // identity.wrapper, which a prior swap flips to the new account while the
    // id/tmux name keep the old prefix.
    const originalWrapper = id.endsWith(`-${rec.project}`)
      ? id.slice(0, id.length - rec.project.length - 1)
      : identity.wrapper;
    return CCD_ARGV.stopPair(originalWrapper, rec.project, surface);
  }

  /**
   * The row the fleet frame would assemble for ONE session, measured on the request — the archive door's busy read
   * (workspace lifecycle §5.2: "read from the same live state the fleet frame uses: status/hookState, re-read on the
   * request, for both kinds of row"). `assembleFleet` over this one registry row, so its tmux and live-file reads and
   * its bucket ladder are the frame's own, with this session's hook state read from disk now rather than taken from
   * the watcher's last sweep. The pane-scraped pieces (a dialog menu, a Workflow row) are the watcher's newest. No
   * `coord`: no field `archiveInterrupts` reads comes from it.
   */
  const liveRowFor = async (rec: SessionRecord, uuid: string): Promise<FleetSession | null> => {
    const hs = await readHookState(deps.io, deps.cfg.registryDir, rec.id, uuid, Date.now());
    const [row] = await assembleFleet(deps.io, deps.cfg, deps.tmux, undefined, watcher?.currentPending(),
      watcher?.currentStatuslines(), undefined, undefined, new Map(hs === null ? [] : [[rec.id, hs]]), [rec]);
    return row ?? null;
  };

  /**
   * Whether a STOP nobody consented to interrupt would lose a turn — read FAIL-CLOSED, by `_ws_status`'s own rule
   * (ccd/ccd), because `cmd_stop` refuses nothing: for a main checkout this read is the only guard there is (a
   * workspace keeps `ws-archive`'s own fail-closed `_ws_status` behind the door). `liveRowFor` cannot answer it
   * alone: the frame folds what it could not measure towards rest — tmux `unknown` reads dead (D-309), an unread pane
   * pid or an absent live file leaves `idle`. Here `gone` is the one idle without a reading (no pane, nothing
   * running); a live pane is idle only when its live file affirmatively reads `idle` (an allowlist, as ccd's) AND the
   * frame's row reports no turn and no question (`archiveInterrupts`); tmux `unknown`, an unread pid, a wrapper with
   * no config dir or an unread live file is busy.
   */
  const idleForStop = async (rec: SessionRecord, uuid: string): Promise<boolean> => {
    const v = await deps.tmux.sessionVerdict(rec.id);
    if (v.verdict === 'gone') return true;
    if (v.verdict !== 'live') return false;
    const pid = await deps.tmux.panePid(rec.id);
    const cfgDir = configDirFor(deps.cfg, rec.wrapper);
    if (pid === null || cfgDir === undefined) return false;
    const read = await readLiveStateMeasured(deps.io, cfgDir, pid);
    if (!read.ok || read.state.status !== 'idle') return false;
    const live = await liveRowFor(rec, uuid);
    return live !== null && !archiveInterrupts(live);
  };

  app.post('/api/sessions/:id/stop', async (req, reply) => {
````

<!-- replay: T5 replace server/src/server.ts -->
In `server/src/server.ts`, find:

````ts
    // `pwa` is hard-coded here, not threaded from the request: this route is
    // the PWA's own stop button and has exactly one caller (grep confirms
    // it — nothing else in server/ or pwa/ reaches CCD_ARGV.stopId/
    // stopPair), so there is no other identity this declaration could
    // honestly carry. `null` — omit the flag — when the deployed ccd is not
    // KNOWN to understand it (fix round 2, task 14, Important #1): a bare
    // `['stop', id]` is what every ccd generation has always understood,
    // where `['stop', id, '--surface', 'pwa']` against an old one parses as
    // a stop of a session named `<id>---surface` — exit 0, nothing real
    // touched, and `runCcdOr502` reads that as `200 {ok:true}`. This is the
    // deploy-ordering hazard `deploy/deploy.sh` itself does not close (the
    // agent target installs `ccd`; the default server target never does,
    // and neither cross-checks the other's version), so the check has to
    // live here instead of being a rollout note.
    const surface = stopSurfaceSupported(deps.fleetState) ? 'pwa' : null;
    // A workspace id is `<project>-<slug>` and encodes no wrapper at all, so
    // there is nothing to reverse: the prefix rule below would fall through to
    // identity.wrapper and ccd would recompute `<wrapper>-<project>` — a
    // DIFFERENT, live session, killed while the workspace kept running and
    // the PWA reported success. ccd stop's one-argument form takes the id
    // whole.
    if (rec.workspace !== null) return runCcdOr502(reply, CCD_ARGV.stopId(id, surface));
    // Legacy ids DO encode a wrapper, and ccd stop's two-argument form
    // recomputes them — so it needs the ORIGINAL wrapper baked into the id, not
    // identity.wrapper, which a prior swap flips to the new account while the
    // id/tmux name keep the old prefix.
    const originalWrapper = id.endsWith(`-${rec.project}`)
      ? id.slice(0, id.length - rec.project.length - 1)
      : identity.wrapper;
    return runCcdOr502(reply, CCD_ARGV.stopPair(originalWrapper, rec.project, surface));
````

Replace with:

````ts
    // The argv is `stopArgvFor`'s (above), shared with the archive door: `--surface` and the two id shapes are argued
    // there.
    return runCcdOr502(reply, stopArgvFor(id, rec, identity));
````

<!-- replay: T5 replace server/src/server.ts -->
In `server/src/server.ts`, find:

````ts
  /**
   * The by-hand archive — one tap in the PWA's PR sheet and one in the
   * session actions sheet.
   *
   * WAVE 2: it now knows about coordination, because `ws-archive` has no hold
   * rung in ccd (deliberately: this route is the reason), so a request that
   * arrives HERE meets no coordination check anywhere else on its way to the
   * box — and nothing else on the server archives unasked, so there is no
   * second gate to fall back on. An open run naming this session is refused
   * `409 run-open`, NAMING the runs so the client can render a sentence rather
   * than a slug.
   *
   * NOT a hard refusal — that would reverse a stated policy: README's holds
   * section blesses archiving a held workspace by hand, and this sheet is
   * where it says to do it. `{force:true}` proceeds. The operator's own hands
   * stay able to do it; they just have to mean it.
   *
   * NO `coordMutex`, decided rather than defaulted: the mutex is instantiated
   * INSIDE `registerCoordRoutes` (one per server, deliberately not a module
   * singleton) and this file holds no handle on it. The refusal path is a
   * SYNCHRONOUS read and a reply in the same tick, so no lock could make it
   * more current. The FORCED path CAN race an in-flight dispatch or close,
   * and this build does not close that race — a forced archive is an operator
   * overriding a refusal they have just read. If that is ever judged too
   * loose, the change is to have `registerCoordRoutes` return its mutex.
   *
   * NO box token, also decided: this route carries none today, and adding a
   * coordination REFUSAL is not the same as making it a coordination WRITE.
   * Its tokenless reachability from the phone is exactly what README blesses.
   */
  app.post('/api/sessions/:id/archive', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const body = (req.body ?? {}) as { force?: unknown };
    if (body.force !== true) {
      // ABOVE the `verbSupported` gate on purpose: a claimed workspace is
      // refused as CLAIMED even on a host whose ccd predates the verb — the
      // claim is the more specific fact, and 501 would send the operator
      // chasing a fleet upgrade that was never the obstacle.
      //
      // `?.` — a server with coordination switched off archives exactly as it
      // did before this wave.
      const read = deps.coord?.openRunsForSession(id);
      // D-2545, AND THE SUCCESS PATH IS UNCHANGED — the 409 still carries the
      // full `OpenSibling[]` it has always carried, and the wave-1 ruling's
      // "409 with no row detail" describes only the FAILURE arm below.
      //
      // On a refusal the archive is refused as CLAIMED with an EMPTY `runs`
      // array: this box could not prove the workspace free, and the fail-shut
      // direction at a destructive act is to refuse. The array is empty rather
      // than absent because the field's shape must not change with the
      // condition; the caller reads a refusal that names no row, which is the
      // honest answer when no row was read.
      //
      // `?.` still means "coordination switched off archives exactly as before".
      if (read !== undefined && !read.ok) {
        return reply.code(409).send({ ok: false, error: ARCHIVE_REFUSALS.runOpen, runs: [] });
      }
      const runs = read?.siblings ?? [];
      if (runs.length > 0) return reply.code(409).send({ ok: false, error: ARCHIVE_REFUSALS.runOpen, runs });
    }
    const argv = CCD_ARGV.wsArchive(id, pwaDec(req));
    // `ws-archive` is the SAME verb generation as `ws-audit` and `ws-reap` —
    // all four were added by this branch and all four sit consecutively in
    // `ccd caps` — so a fleet host on an older ccd dies in the verb's own
    // usage check, and `runCcdOr502` renders that as a bare 502 "the archive
    // failed". Same 501 body as every sibling, so the client can tell
    // "this host cannot" from "it tried and could not".
    if (!verbSupported(deps.fleetState, argv)) {
      return reply.code(501).send({ ok: false, error: 'unsupported' });
    }
    return runCcdOr502(reply, argv);
  });
````

Replace with:

````ts
  /**
   * The ONE "Archive" (workspace lifecycle spec §5.2): every session's menu and actions sheet sends here, for both
   * kinds of row. A workspace is archived (`ws-archive`); a main checkout is STOPPED and folds into the Archived fold
   * (`inArchivedFold`), never deleted — it never reaches `ws-archive`, so nothing writes `.archived` for one.
   * `POST /api/sessions/:id/stop` and `ccd stop` are unchanged; this door runs the stop argv that route builds
   * (`stopArgvFor`) when it stops.
   *
   * THE DECISION IS `decideArchive`'s (`coord/archiveDoor.ts`): every check that can refuse — a turn in progress, a
   * worktree this box PROVES gone, a run naming this session as worker (`run-open`, `{force}` proceeds), a run naming
   * it as claimant (`coordinator-has-open-runs`, `{programme:'end'}` ends the programme), the verb — before any act
   * that cannot be undone. What only ccd can measure (its status read, the manifest, and in remote mode the worktree)
   * refuses inside `ws-archive`, before ITS act; `archiveOutcome` carries `ended` on that answer. This handler
   * measures, hands the measurements over, and does what the decision says, in its order: end the programme (inside
   * the decision), stop (`{interrupt}`, or a main checkout), archive (a workspace). A main checkout's busy is read
   * fail-closed (`idleForStop`), and a stop nobody consented to interrupt re-reads it at the act: `cmd_stop` refuses
   * nothing, so that read is the only guard between a turn begun during the claim reads, the mutex wait or the
   * programme end and its loss.
   *
   * ON THE COORDINATION SERIALISER. `server.ts` used to hold no handle on `coordMutex`, so a forced archive could race
   * an in-flight dispatch or close; `registerCoordRoutes` now returns it (`CoordRoutesHandle.withAbandon`), and the
   * claim reads and the programme's end run inside it, beside every other coordination write. The stop and `ws-archive` run
   * after it is released: a slow manifest must not hold every coordinator's close behind it.
   *
   * NO box token, still. Its tokenless reachability from the phone is what README's holds section blesses, and with
   * `{programme:'end'}` it is a coordination WRITE as well — session-gated with no box token, like the abandon door
   * whose decision it reuses (D-282's argument: the party that holds the token is the coordinator being archived).
   * It is registered here, where `coord-pause-route.test.ts` cannot see it, so `box-token-census.test.ts` names it
   * beside the kickoff route.
   */
  app.post('/api/sessions/:id/archive', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isSafeSessionId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const flags = archiveFlags(req.body);
    if (flags === null) return reply.code(400).send({ ok: false, error: 'bad-request' });
    // The row itself, `/stop`'s ladder: an unlistable registry proves nothing about THIS id (503, never 404), and an
    // unmeasured identity is refused rather than guessed at — the stop argv recomputes a tmux name from these fields.
    const read = await readSessionRecord(deps.io, deps.cfg, id);
    if (!read.found) {
      return reply.code(read.reason === 'unlistable' ? 503 : 404)
        .send({ ok: false, error: read.reason === 'unlistable' ? 'registry-unmeasurable' : 'unknown-session' });
    }
    const identity = measuredIdentity(read.record);
    if (identity === null) return reply.code(503).send({ ok: false, error: 'registry-unmeasurable' });
    const rec = read.record;
    const archiveArgv = rec.workspace === null ? null : CCD_ARGV.wsArchive(id, pwaDec(req));
    const measure: ArchiveMeasure = {
      workspace: rec.workspace !== null,
      // A main checkout: the fail-closed read, its stop's only guard (`idleForStop`). A workspace: the frame's own row,
      // with `ws-archive`'s fail-closed `_ws_status` behind it. No row would be no measurement, read as busy —
      // unreachable by construction (`assembleFleet` maps its records 1:1), kept rather than pinned.
      busy: rec.workspace === null
        ? !(await idleForStop(rec, identity.uuid))
        : await liveRowFor(rec, identity.uuid).then((live) => live === null || archiveInterrupts(live)),
      // In remote mode this stat is outside the agent's read roots and answers `unmeasured`, which proceeds — ccd's
      // own `[[ -d $workdir ]]` refusal measures it there (`ArchiveMeasure.worktree`).
      worktree: rec.workspace === null ? 'present' : worktreeOf(await deps.io.statMeasured(rec.workdir)),
      verbSupported: archiveArgv === null || verbSupported(deps.fleetState, archiveArgv),
    };
    const coord = deps.coord;
    const plan = coord === undefined
      ? await decideArchive(null, id, flags, measure)
      : await coordRoutes.withAbandon(coord, (abandon, abandonRefusal) => decideArchive({
        openRunsForSession: (sid) => coord.openRunsForSession(sid),
        openRunsClaimedBy: (sid) => coord.openRunsClaimedBy(sid),
        abandonRefusal,
        abandon,
      }, id, flags, measure));
    if (!plan.ok) return reply.code(plan.reply.status).send(plan.reply.body);
    const endedSpread = plan.ended.length > 0 ? { ended: plan.ended } : {};
    let stopped = false;
    if (plan.stop) {
      // Re-read at the act, fail-closed, unless the operator consented to lose the turn.
      if (!flags.interrupt && !(await idleForStop(rec, identity.uuid))) {
        const busyNow = busyAtStop(plan.ended);
        return reply.code(busyNow.status).send(busyNow.body);
      }
      const res = await deps.runCcd(stopArgvFor(id, rec, identity));
      if (!res.ok) return reply.code(502).send({ ok: false, stderr: res.stderr, ...endedSpread });
      stopped = true;
    }
    if (archiveArgv === null || !plan.wsArchive) return { ok: true, archived: true, stopped, ended: plan.ended };
    const out = archiveOutcome(stopped, plan.ended, await deps.runCcd(archiveArgv));
    return reply.code(out.status).send(out.body);
  });
````

- [ ] **Step 4: Run them, the gates that read `server.ts`, and the typecheck.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archive-door.test.ts test/lifecycle.test.ts test/pr-routes.test.ts test/routes.test.ts )
( cd server && ./node_modules/.bin/vitest run test/verb-gate.test.ts test/whitelist-subset.test.ts test/auth-gate.test.ts test/fleet-lifecycle.test.ts test/readme-holds.test.ts test/single-definition.test.ts )
( cd server && ./node_modules/.bin/tsc --noEmit -p . )
( cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json )
```

Expected: `207 passed (207)`; the six gate files green (`fleet-lifecycle`'s "a stopped row is still `dead`/`dead`" among them, untouched); no output from either `tsc` (Task 1's note).

- [ ] **Step 5: Commit.**

```bash
git add -u server/src/server.ts server/test/lifecycle.test.ts server/test/pr-routes.test.ts server/test/routes.test.ts
git add server/test/archive-door.test.ts
git commit -m "server: one Archive — the door measures, decides through archiveDoor, ends, stops, archives (workspace lifecycle W2)"
```

### Task 6: The census — the archive route is a session-only coordination write

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `server/test/box-token-census.test.ts` (the `ARCHIVE` literal beside `KICKOFF`; `SESSION_ONLY_ALL`; the not-a-lane probe)
- Modify: `CLAUDE.md` (one sentence in the box-token bullet, before "Don't assume — read the guards.")

- [ ] **Step 1: Add the census entry.**

<!-- replay: T6 replace server/test/box-token-census.test.ts -->
In `server/test/box-token-census.test.ts`, find:

````ts
const KICKOFF = '/api/sessions/:id/kickoff';
````

Replace with:

````ts
const KICKOFF = '/api/sessions/:id/kickoff';

/** The archive door (workspace lifecycle wave 2, spec §5.2). With `{programme:'end'}` it ends a coordinator's open
 *  runs through the abandon door's own decision, so it is a coordination WRITE — session-gated, no box token (D-282's
 *  argument: the token's holder is the coordinator being archived). Registered in `server.ts`, so `SESSION_ONLY`
 *  cannot see it, for the kickoff route's reason; named here beside it. */
const ARCHIVE = '/api/sessions/:id/archive';
````

<!-- replay: T6 replace server/test/box-token-census.test.ts old-inline new-inline -->
In `server/test/box-token-census.test.ts`, find:

````ts
const SESSION_ONLY_ALL = [...SESSION_ONLY_DOORS, KICKOFF, ...UPDATE_DOORS];
````

Replace with:

````ts
const SESSION_ONLY_ALL = [...SESSION_ONLY_DOORS, KICKOFF, ARCHIVE, ...UPDATE_DOORS];
````

<!-- replay: T6 replace server/test/box-token-census.test.ts -->
In `server/test/box-token-census.test.ts`, find:

````ts
    expect(ALL_LANES).not.toContain('POST /api/sessions/:id/kickoff');
````

Replace with:

````ts
    expect(ALL_LANES).not.toContain('POST /api/sessions/:id/kickoff');
    expect(ALL_LANES).not.toContain(`POST ${ARCHIVE}`);
````

- [ ] **Step 2: Run it to verify it fails.**

Run: `( cd server && ./node_modules/.bin/vitest run test/box-token-census.test.ts )`
Expected: `1 failed | 22 passed (23)` — `CLAUDE.md's box-token bullet is TRUE, not merely present`: `the bullet promises to name the coordination writes that carry no box token, and does not name /api/sessions/:id/archive`.

- [ ] **Step 3: Name the route in CLAUDE.md's bullet.** No number word: the census reads number words in its scanned passages as claims.

<!-- replay: T6 replace CLAUDE.md -->
In `CLAUDE.md`, find:

````markdown
  Don't assume — read the guards.
````

Replace with:

````markdown
  `POST /api/sessions/:id/archive` joins that class when its body carries `programme:'end'` (workspace lifecycle
  wave 2): it then ends the coordinator's open runs through the abandon door's own decision, on the coordination
  serialiser, and consults no box token — session-gated when the auth gate is armed, like the abandon door. It is
  registered in `server.ts` for the kickoff route's reason, so `box-token-census.test.ts` names it beside that
  route's literal.
  Don't assume — read the guards.
````

- [ ] **Step 4: Run it.**

```bash
( cd server && ./node_modules/.bin/vitest run test/box-token-census.test.ts test/coord-pause-route.test.ts )
( cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json )
```

Expected: both files green (`23 passed` in the first); no output from `tsc` (Task 1's note).

- [ ] **Step 5: Commit.**

```bash
git add -u server/test/box-token-census.test.ts CLAUDE.md
git commit -m "census: the archive route joins the session-only coordination writes (workspace lifecycle W2)"
```

### Task 7: The PWA's door — the consents, the read answer, the refusals in words

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `pwa/src/lib/api.ts` (an import line; `ARCHIVE_REFUSAL_TEXT` above `API_ERROR_TEXT` and spread into it; `archivePartial` after `kickoffErrorText`; `postInit`/`postRead` beside `post`; `archive` carries `interrupt` and `programme` and resolves the answer)
- Create: `pwa/test/archive-partial.test.ts`
- Modify: `pwa/test/api.test.ts`; three mock lines in `pwa/test/archive-conflict-sheet.test.tsx` and `pwa/test/fleet-screen.test.tsx` (`api.archive` resolves `null`, not `undefined`)

**Interfaces:**
- Produces: `api.archive(id, opts?: { force?: boolean; interrupt?: boolean; programme?: 'end' }): Promise<ArchiveAnswer | null>` — the body is an `ArchiveBody`, each consent sent only when given, no body at all when none is (the byte-identical plain request); `ARCHIVE_REFUSAL_TEXT: Record<ArchiveRefusal, string>` (a code without a sentence is a compile error); `archivePartial(a): { refusal: ArchiveRefusal | null; detail: string | null } | null` — THE ONE READER of `archived` (pinned by a scan of `pwa/src`).

- [ ] **Step 1: Write the failing tests.**

<!-- replay: T7 replace pwa/test/archive-conflict-sheet.test.tsx old-inline new-inline -->
In `pwa/test/archive-conflict-sheet.test.tsx`, find:

````tsx
    const archive = vi.fn(async () => {});
    const onDone = vi.fn();
````

Replace with:

````tsx
    const archive = vi.fn(async () => null);
    const onDone = vi.fn();
````

<!-- replay: T7 replace pwa/test/fleet-screen.test.tsx old-inline new-inline -->
In `pwa/test/fleet-screen.test.tsx`, find:

````tsx
    const archive = vi.spyOn(api, 'archive')
      .mockResolvedValueOnce(undefined)
````

Replace with:

````tsx
    const archive = vi.spyOn(api, 'archive')
      .mockResolvedValueOnce(null)
````

<!-- replay: T7 replace pwa/test/fleet-screen.test.tsx old-inline new-inline -->
In `pwa/test/fleet-screen.test.tsx`, find:

````tsx
    const archive = vi.spyOn(api, 'archive').mockResolvedValue(undefined);
````

Replace with:

````tsx
    const archive = vi.spyOn(api, 'archive').mockResolvedValue(null);
````

<!-- replay: T7 replace pwa/test/fleet-screen.test.tsx old-inline new-inline -->
In `pwa/test/fleet-screen.test.tsx`, find:

````tsx
          session({ id: 'a-two', project: 'alpha', workspace: 'two', bucket: 'working', releasedFrom: rel(200) }),
        ] });
      }
    });
````

Replace with:

````tsx
          session({ id: 'a-two', project: 'alpha', workspace: 'two', bucket: 'working', releasedFrom: rel(200) }),
        ] });
      }
      return null;
    });
````

<!-- replay: T7 replace pwa/test/api.test.ts -->
In `pwa/test/api.test.ts`, find:

````ts

const asError = (status: number, body: unknown): unknown => {
````

Replace with:

````ts

import { ARCHIVE_REFUSAL_TEXT } from '../src/lib/api';
import { ARCHIVE_REFUSAL_CODES } from '../../shared/api';

const asError = (status: number, body: unknown): unknown => {
````

<!-- replay: T7 replace pwa/test/api.test.ts -->
In `pwa/test/api.test.ts`, find:

````ts
    await a.archive('demo-x', { force: false });
    expect(calls[0]![1]).toEqual({ method: 'POST' });
  });
````

Replace with:

````ts
    await a.archive('demo-x', { force: false });
    expect(calls[0]![1]).toEqual({ method: 'POST' });
  });

  // Workspace lifecycle §5.2: the two other consents, on `force`'s rule — sent only when given, each alone.
  it.each([
    [{ interrupt: true }, { interrupt: true }],
    [{ programme: 'end' as const }, { programme: 'end' }],
    [{ force: true, interrupt: true, programme: 'end' as const }, { force: true, interrupt: true, programme: 'end' }],
  ])('archive(id, %j) posts exactly %j', async (opts, body) => {
    const calls: [string, RequestInit | undefined][] = [];
    const a = createApi(async (u, init) => { calls.push([String(u), init]); return new Response('', { status: 200 }); });
    await a.archive('demo-x', opts);
    expect(JSON.parse(calls[0]![1]!.body as string)).toEqual(body);
  });

  it('archive(id, {interrupt:false}) is the plain call — a consent that says no is no consent', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const a = createApi(async (u, init) => { calls.push([String(u), init]); return new Response('', { status: 200 }); });
    await a.archive('demo-x', { force: false, interrupt: false });
    expect(calls[0]![1]).toEqual({ method: 'POST' });
  });

  it('archive resolves to the door\'s answer, and to null when a 2xx carried nothing readable', async () => {
    const answer = { ok: true, archived: false, stopped: true, ended: [], refusal: 'status-unknown', detail: 'ccd: status-unknown' };
    expect(await createApi(vi.fn().mockResolvedValue(jsonResponse(200, answer)) as unknown as typeof fetch)
      .archive('demo-x', { interrupt: true })).toEqual(answer);
    expect(await createApi((async () => new Response('', { status: 200 })) as typeof fetch).archive('demo-x')).toBeNull();
  });
````

<!-- replay: T7 replace pwa/test/api.test.ts old-inline new-inline -->
In `pwa/test/api.test.ts`, find:

````ts
  it('does not shadow any code the SEND translator owns either', () => {
````

Replace with:

````ts
  it('says every archive refusal in words — never a bare slug (workspace lifecycle §5.2)', () => {
    for (const code of ARCHIVE_REFUSAL_CODES) {
      expect(ARCHIVE_REFUSAL_TEXT[code], code).toMatch(/\w+ \w+/);
      expect(apiErrorText(asError(409, { ok: false, error: code })), code).toBe(ARCHIVE_REFUSAL_TEXT[code]);
    }
  });

  it('does not shadow any code the SEND translator owns either', () => {
````

<!-- replay: T7 create pwa/test/archive-partial.test.ts -->
Create `pwa/test/archive-partial.test.ts`:

````ts
// `archivePartial` — the ONE reader of the archive door's `archived:false` (workspace lifecycle spec §5.2).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archivePartial } from '../src/lib/api';
import type { ArchiveAnswer } from '../../shared/api';

const answer = (over: Partial<ArchiveAnswer>): ArchiveAnswer => ({ ok: true, archived: true, stopped: false, ended: [], ...over });

describe('archivePartial', () => {
  it('reads a stop that was followed by a refused archive', () => {
    expect(archivePartial(answer({ archived: false, stopped: true, refusal: 'status-unknown', detail: ' ccd: status-unknown\n' })))
      .toEqual({ refusal: 'status-unknown', detail: 'ccd: status-unknown' });
  });

  it('keeps a refusal this build has no word for as null, with ccd\'s text', () => {
    expect(archivePartial(answer({ archived: false, stopped: true, refusal: null, detail: 'ccd: no such session' })))
      .toEqual({ refusal: null, detail: 'ccd: no such session' });
    expect(archivePartial({ ...answer({ archived: false, stopped: true }), refusal: 'not-a-code' as never }))
      .toEqual({ refusal: null, detail: null });
  });

  it('absence permits: archived, an older server\'s {ok:true}, and an unreadable answer are all a completed archive', () => {
    expect(archivePartial(answer({}))).toBeNull();
    expect(archivePartial({ ok: true } as ArchiveAnswer)).toBeNull();
    expect(archivePartial(null)).toBeNull();
  });

  it('is the one place pwa/src compares an answer\'s `archived` — a second reader would decide "archived" on its own', () => {
    const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
    // Any CODE line that reads `.archived` other than as `group.archived.<member>` (the Archived fold's list) — a
    // comparison, a negation (`!answer.archived`), a bare truthiness test. `archivedAt`/`archivedBytes` fail `\b`.
    const READ = /^(?!\s*(?:\/\/|\/?\*)).*\.archived\b(?!\s*\.)/m;
    const readers = (readdirSync(src, { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && READ.test(readFileSync(path.join(src, f), 'utf8')));
    expect(readers).toEqual([path.join('lib', 'api.ts')]);
  });
});
````

- [ ] **Step 2: Run them to verify they fail.**

Run: `( cd pwa && ./node_modules/.bin/vitest run test/api.test.ts test/archive-partial.test.ts test/archive-conflict-sheet.test.tsx test/fleet-screen.test.tsx )`
Expected: `9 failed | 206 passed (215)` — the three new `archive(id, …)` body cases and the answer case, `says every archive refusal in words` (`Cannot read properties of undefined (reading 'run-open')`), and all four `archive-partial` cases (`archivePartial is not a function`; the scan `expected [] to deeply equal [ 'lib/api.ts' ]`).

- [ ] **Step 3: Carry the consents and read the answer.**

<!-- replay: T7 replace pwa/src/lib/api.ts -->
In `pwa/src/lib/api.ts`, find:

````ts
import { raiseAuthLostFrom } from './auth';
````

Replace with:

````ts
import { raiseAuthLostFrom } from './auth';
import { ARCHIVE_REFUSALS, isArchiveRefusal, type ArchiveAnswer, type ArchiveBody, type ArchiveRefusal } from '../../../shared/api';
````

<!-- replay: T7 replace pwa/src/lib/api.ts -->
In `pwa/src/lib/api.ts`, find:

````ts
const API_ERROR_TEXT: Record<string, string> = {
  unsupported: UNSUPPORTED_VERB_TEXT,
````

Replace with:

````ts
/**
 * The archive door's refusals in words (workspace lifecycle spec §5.2) — one sentence per `ARCHIVE_REFUSALS` code,
 * keyed by the L0 const, never by a second spelling of a code. A `Record` over `ArchiveRefusal`, so a code added there
 * without a sentence here is a compile error. `API_ERROR_TEXT` spreads it, so every surface that toasts an archive
 * refusal through `apiErrorText` (the PR sheet, "Archive all") says the same thing the archive sheet does. None of
 * these codes is one `uploadErrorText`, `kickoffErrorText` or `sendErrorText` owns (`api.test.ts` asserts it).
 */
export const ARCHIVE_REFUSAL_TEXT: Readonly<Record<ArchiveRefusal, string>> = {
  [ARCHIVE_REFUSALS.runOpen]: 'A run still claims this workspace.',
  [ARCHIVE_REFUSALS.sessionBusy]: 'It is working — archiving now would lose the turn in progress.',
  [ARCHIVE_REFUSALS.coordinatorHasOpenRuns]: 'It coordinates open runs.',
  [ARCHIVE_REFUSALS.programmePartlyEnded]: 'The programme was only partly ended. Nothing was stopped or archived.',
  [ARCHIVE_REFUSALS.worktreeGone]: 'Its worktree is gone, so it cannot be described for the archive record.',
  [ARCHIVE_REFUSALS.statusUnknown]: 'Its status cannot be read, so it will not be archived on a guess.',
  [ARCHIVE_REFUSALS.manifestUnbuildable]: 'It cannot be described truthfully for the archive record. Nothing was touched.',
};

const API_ERROR_TEXT: Record<string, string> = {
  unsupported: UNSUPPORTED_VERB_TEXT,
  ...ARCHIVE_REFUSAL_TEXT,
````

<!-- replay: T7 replace pwa/src/lib/api.ts -->
In `pwa/src/lib/api.ts`, find:

````ts
  const post = async (path: string, body?: unknown): Promise<void> => {
    await request(
      path,
      body === undefined
        ? { method: 'POST' }
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
  };
````

Replace with:

````ts
  const postInit = (body?: unknown): RequestInit =>
    body === undefined
      ? { method: 'POST' }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        };

  const post = async (path: string, body?: unknown): Promise<void> => {
    await request(path, postInit(body));
  };

  /** `post`'s request, byte for byte, with its 2xx answer READ — for a door whose success carries a second outcome
   *  (the archive door's `archived:false`, workspace lifecycle §5.2). An answer that cannot be read resolves to
   *  `unreadable`, `postJsonOr`'s reasoning below: the exchange completed and answered 2xx. */
  const postRead = async <T>(path: string, unreadable: T, body?: unknown): Promise<T> =>
    (await (await request(path, postInit(body))).json().catch(() => unreadable)) as T;
````

<!-- replay: T7 replace pwa/src/lib/api.ts -->
In `pwa/src/lib/api.ts`, find:

````ts
     *  the whole information. See `ArchiveConflictSheet`. */
    archive: (id: string, opts?: { force?: boolean }) =>
      post(`${sid(id)}/archive`, opts?.force === true ? { force: true } : undefined),
````

Replace with:

````ts
     *  the whole information. See `ArchiveConflictSheet`.
     *
     *  Workspace lifecycle §5.2 adds the two other consents on the same rule — each a second tap after the refusal it
     *  answers, each sent only when it is given: `interrupt` (after `session-busy`) and `programme: 'end'` (after
     *  `coordinator-has-open-runs`). Resolves to the door's answer (`archivePartial` reads it), or `null` when a 2xx
     *  carried nothing readable — an older server's `{ok:true}` with no `archived` reads as archived. */
    archive: (id: string, opts?: { force?: boolean; interrupt?: boolean; programme?: 'end' }) => {
      const body: ArchiveBody = {
        ...(opts?.force === true ? { force: true as const } : {}),
        ...(opts?.interrupt === true ? { interrupt: true as const } : {}),
        ...(opts?.programme === 'end' ? { programme: 'end' as const } : {}),
      };
      return postRead<ArchiveAnswer | null>(`${sid(id)}/archive`, null, Object.keys(body).length > 0 ? body : undefined);
    },
````

<!-- replay: T7 replace pwa/src/lib/api.ts -->
In `pwa/src/lib/api.ts`, find:

````ts
export const kickoffErrorText = (text: string): string => KICKOFF_ERROR_TEXT[text] ?? text;
````

Replace with:

````ts
export const kickoffErrorText = (text: string): string => KICKOFF_ERROR_TEXT[text] ?? text;

/** The archive door's PARTIAL outcome, or `null` when the answer says nothing of one (workspace lifecycle §5.2): the
 *  door stopped the session and `ws-archive` then refused, so the row stays at the top level, stopped, with Archive
 *  offered again. THE ONE READER of `archived:false`. Absence permits: an older server's `{ok:true}` (no `archived`),
 *  or an answer this client could not read (`null`), is a completed archive, exactly what the door used to mean. */
export function archivePartial(a: ArchiveAnswer | null): { refusal: ArchiveRefusal | null; detail: string | null } | null {
  if (a === null || typeof a !== 'object' || a.archived !== false) return null;
  const refusal = isArchiveRefusal(a.refusal) ? a.refusal : null;
  return { refusal, detail: typeof a.detail === 'string' && a.detail.trim() !== '' ? a.detail.trim() : null };
}
````

- [ ] **Step 4: Run them and the typecheck.**

```bash
( cd pwa && ./node_modules/.bin/vitest run test/api.test.ts test/archive-partial.test.ts test/archive-conflict-sheet.test.tsx test/fleet-screen.test.tsx )
( cd pwa && ./node_modules/.bin/tsc --noEmit -p . )
```

Expected: `215 passed (215)`; no output from `tsc`.

- [ ] **Step 5: Commit.**

```bash
git add -u pwa/src/lib/api.ts pwa/test/api.test.ts pwa/test/archive-conflict-sheet.test.tsx pwa/test/fleet-screen.test.tsx
git add pwa/test/archive-partial.test.ts
git commit -m "pwa: api.archive carries interrupt and programme, and reads the door's answer (workspace lifecycle W2)"
```

### Task 8: The one Archive's sheet — `ArchiveSheet`

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Create: `pwa/src/fleet/ArchiveSheet.tsx`
- Modify: `pwa/src/fleet/ArchiveConflictSheet.tsx` (typed refusals in words; `runPhrase`, `claimedSentence`, `CLAIMED_CONSEQUENCE` exported and used by both sheets)
- Create: `pwa/test/archive-sheet.test.tsx`; modify `pwa/test/archive-conflict-sheet.test.tsx` (one case)

**Interfaces:**
- Produces: `ArchiveSheet({ session, open, onClose, onArchived?, onStopOnly?, archive?, fleet? })` — the confirm by case (busy first, then a coordinator's open runs from the runs frame, then the plain words), each consent a second tap that rides along on later sends, every server refusal answered inside it, "Stop only" only where the caller passes `onStopOnly` and only after `ARCHIVE_STOP_ONLY`, a store the server could not read (`coordinator-has-open-runs` with `runs: []`, which refuses every consent), `programme-partly-ended` (a run the abandon arm cannot move from its row refuses the same way on every retry) or `501 unsupported` (a box whose ccd has no `ws-archive`); a sheet without `onStopOnly` says, after those same refusals, that "Stop only" is in the session's actions sheet, and offers no button; `isPutAway(s)` (`inArchivedFold(s) || s.bucket === 'cleanup'`) and `restoreSession(s)` (`ws-restore` for a workspace, `ensure` for a main checkout), one spelling for the actions sheet and the header.
- Consumes: Task 1's vocabulary and predicates; Task 7's `api.archive`, `ARCHIVE_REFUSAL_TEXT`, `archivePartial`.

- [ ] **Step 1: Write the failing tests.**

<!-- replay: T8 create pwa/test/archive-sheet.test.tsx -->
Create `pwa/test/archive-sheet.test.tsx`:

````tsx
// The ONE "Archive" (workspace lifecycle spec §5.2): the confirm by case, each consent a second tap after the words
// that ask for it, the server's refusals answered inside the sheet, and "Stop only" where — and only where — the
// caller asks for it. Rendered directly with an INJECTED `archive` (`ArchiveConflictSheet`'s idiom).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FleetSession, RunSummary } from '../../shared/api';
import { ToastHost } from '../src/components/Toast';
import { ArchiveSheet } from '../src/fleet/ArchiveSheet';
import { createFleetStore } from '../src/stores/fleet';
import { ApiError, type api } from '../src/lib/api';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const s = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-amber', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w/demo/amber', workspace: 'amber', name: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: null,
  ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null,
  bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null, started: true, spawnState: null,
  ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, releasedFrom: null, ...over,
});
const RUN7 = { id: 7, program: 'lifecycle', wave: 1, waveOf: 3 };
const RUN8 = { id: 8, program: 'lifecycle', wave: 2, waveOf: 3 };
const claimedRun = (r: typeof RUN7, state: RunSummary['state'] = 'working'): RunSummary =>
  ({ ...r, state, claimedBy: 'demo-amber', sessionId: 'demo-worker' }) as unknown as RunSummary;

type Archive = typeof api.archive;
const mount = (session: FleetSession, o: {
  archive: Archive; onStopOnly?: (id: string) => void; runs?: RunSummary[]; onArchived?: () => void;
}) => {
  const fleet = createFleetStore();
  if (o.runs) act(() => { fleet.setState({ runs: o.runs! }); });
  const onClose = vi.fn();
  const view = render(
    <>
      <ArchiveSheet session={session} open onClose={onClose} archive={o.archive} fleet={fleet}
        onStopOnly={o.onStopOnly} onArchived={o.onArchived} />
      <ToastHost />
    </>,
  );
  return { onClose, view, fleet };
};
const refusal = (body: Record<string, unknown>, status = 409) => new ApiError(status, { ok: false, ...body });
const buttons = (): string[] => screen.getAllByRole('button').map((b) => b.textContent ?? '');

describe('the confirm reads by case', () => {
  it('an idle workspace: its words, and Archive sends the plain call', async () => {
    const archive = vi.fn(async () => null) as unknown as Archive;
    const onArchived = vi.fn();
    const { onClose } = mount(s(), { archive, onArchived });
    expect(screen.getByText('Archive this workspace?')).toBeInTheDocument();
    expect(screen.getByText('It goes offline and folds into Archived. Restore brings it back.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(archive).toHaveBeenCalledWith('demo-amber', {});
    expect(onArchived).toHaveBeenCalledOnce();
  });

  it('a main checkout: it is never deleted, and Restore starts it again', () => {
    mount(s({ id: 'claude-demo', workspace: null }), { archive: vi.fn() as unknown as Archive });
    expect(screen.getByText('Archive this session?')).toBeInTheDocument();
    expect(screen.getByText('It goes offline and folds into Archived. Restore starts it again. It is never deleted.'))
      .toBeInTheDocument();
  });

  it('busy, either kind: the turn is lost — and only "Archive anyway" sends `interrupt`', async () => {
    const archive = vi.fn(async () => null) as unknown as Archive;
    mount(s({ id: 'claude-demo', workspace: null, status: 'busy', bucket: 'working' }), { archive });
    expect(screen.getByText("It's working. Archive anyway?")).toBeInTheDocument();
    expect(screen.getByText('The turn in progress is lost.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith('claude-demo', { interrupt: true }));
  });

  it('a coordinator with open runs (L5): "End programme and archive" or "Cancel", nothing else, and how to pause instead', async () => {
    const archive = vi.fn(async () => null) as unknown as Archive;
    mount(s(), { archive, runs: [claimedRun(RUN7), claimedRun(RUN8), claimedRun({ ...RUN7, id: 6 }, 'done')] });
    expect(screen.getByText('It has 2 open runs. End its programme too?')).toBeInTheDocument();
    expect(screen.getByText('Its workers will be cleaned up.')).toBeInTheDocument();
    expect(screen.getByText(/coordinator pause switch on the Runs screen/)).toBeInTheDocument();
    expect(buttons()).toEqual(['End programme and archive', 'Cancel']);
    fireEvent.click(screen.getByRole('button', { name: 'End programme and archive' }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith('demo-amber', { programme: 'end' }));
  });
});

describe('the server re-reads, and its refusal turns the sheet', () => {
  it('found busy after all: the busy words, then `interrupt`', async () => {
    const archive = vi.fn()
      .mockRejectedValueOnce(refusal({ error: 'session-busy' }))
      .mockResolvedValueOnce(null) as unknown as Archive;
    mount(s(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText("It's working. Archive anyway?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    await waitFor(() => expect(archive).toHaveBeenLastCalledWith('demo-amber', { interrupt: true }));
  });

  it('found coordinating: L5 with the server\'s runs, and the consent already given rides along', async () => {
    const archive = vi.fn()
      .mockRejectedValueOnce(refusal({ error: 'coordinator-has-open-runs', runs: [RUN7] }))
      .mockResolvedValueOnce(null) as unknown as Archive;
    mount(s({ status: 'busy', bucket: 'working' }), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    expect(await screen.findByText('It has 1 open run. End its programme too?')).toBeInTheDocument();
    expect(screen.getByText('run 7 — lifecycle wave 1/3.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End programme and archive' }));
    await waitFor(() => expect(archive).toHaveBeenLastCalledWith('demo-amber', { interrupt: true, programme: 'end' }));
  });

  it('claimed by a run (`run-open`): the claimed words, and "Archive anyway" sends `force`', async () => {
    const archive = vi.fn()
      .mockRejectedValueOnce(refusal({ error: 'run-open', runs: [RUN7] }))
      .mockResolvedValueOnce(null) as unknown as Archive;
    mount(s(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('run 7 — lifecycle wave 1/3 is still open on this workspace.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    await waitFor(() => expect(archive).toHaveBeenLastCalledWith('demo-amber', { force: true }));
  });

  it('coordinator runs it could not read: refused, nothing to consent to — and where Stop only is', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'coordinator-has-open-runs', runs: [] })) as unknown as Archive;
    mount(s(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText(/could not read them, so it will not archive it/)).toBeInTheDocument();
    expect(screen.getByText("Stop only is in this session's actions sheet on the board.")).toBeInTheDocument();
    expect(buttons()).toEqual(['Close']);
  });

  it('a partly ended programme says what ended, what did not and why, and that nothing else happened', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'programme-partly-ended', closed: [RUN7],
      notClosed: [RUN8], refusal: { id: 8, kind: 'bad-transition', detail: 'closing → closing' } })) as unknown as Archive;
    mount(s(), { archive, runs: [claimedRun(RUN7), claimedRun(RUN8)] });
    fireEvent.click(screen.getByRole('button', { name: 'End programme and archive' }));
    expect(await screen.findByText('The programme was only partly ended')).toBeInTheDocument();
    expect(screen.getByText('Ended: run 7 — lifecycle wave 1/3. Still open: run 8 — lifecycle wave 2/3. '
      + 'Run 8 could not be ended (bad-transition: closing → closing). Nothing was stopped or archived.')).toBeInTheDocument();
  });

  it('a failure with no word stays on the sheet, in the server\'s own words', async () => {
    const archive = vi.fn().mockRejectedValueOnce(new ApiError(502, { ok: false, stderr: 'ccd: no such session' })) as unknown as Archive;
    mount(s(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('ccd: no such session')).toBeInTheDocument();
    expect(screen.getByText('Archive this workspace?')).toBeInTheDocument();
  });
});

describe('"Stop only" — after a refusal the phone cannot fix, and only where the caller asks', () => {
  it.each(['worktree-gone', 'status-unknown', 'manifest-unbuildable'])('offered after %s, and it stops', async (code) => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: code })) as unknown as Archive;
    const onStopOnly = vi.fn();
    const { onClose } = mount(s(), { archive, onStopOnly });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop only' }));
    expect(onStopOnly).toHaveBeenCalledWith('demo-amber');
    expect(onClose).toHaveBeenCalled();
  });

  it('never offered where the caller does not ask for it — the sheet says where it is, and offers no button', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'worktree-gone' })) as unknown as Archive;
    mount(s(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText("Couldn't archive")).toBeInTheDocument();
    expect(screen.getByText("Stop only is in this session's actions sheet on the board.")).toBeInTheDocument();
    expect(buttons()).toEqual(['Close']);
  });

  it('offered after a store this box could not read — every consent is refused there, and the phone cannot fix it', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'coordinator-has-open-runs', runs: [] })) as unknown as Archive;
    const onStopOnly = vi.fn();
    mount(s(), { archive, onStopOnly });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText(/could not read them, so it will not archive it/)).toBeInTheDocument();
    expect(buttons()).toEqual(['Stop only', 'Cancel']);
    fireEvent.click(screen.getByRole('button', { name: 'Stop only' }));
    expect(onStopOnly).toHaveBeenCalledWith('demo-amber');
  });

  it('offered after a programme it could not end — a run no abandon can move, and nothing was stopped', async () => {
    const onStopOnly = vi.fn();
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'programme-partly-ended', closed: [],
      notClosed: [RUN7], refusal: { id: 7, kind: 'bad-transition', detail: 'closing → closing' } })) as unknown as Archive;
    mount(s(), { archive, onStopOnly, runs: [claimedRun(RUN7, 'closing')] });
    fireEvent.click(screen.getByRole('button', { name: 'End programme and archive' }));
    expect(await screen.findByText('The programme was only partly ended')).toBeInTheDocument();
    expect(buttons()).toEqual(['Stop only', 'Cancel']);
    fireEvent.click(screen.getByRole('button', { name: 'Stop only' }));
    expect(onStopOnly).toHaveBeenCalledWith('demo-amber');
  });

  it('offered after `501 unsupported` — a box whose ccd has no ws-archive refuses every retry until it is updated', async () => {
    const onStopOnly = vi.fn();
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'unsupported' }, 501)) as unknown as Archive;
    mount(s(), { archive, onStopOnly });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText("Couldn't archive")).toBeInTheDocument();
    expect(screen.getByText('The fleet host is running a ccd that does not have this verb yet.')).toBeInTheDocument();
    expect(buttons()).toEqual(['Stop only', 'Cancel']);
    fireEvent.click(screen.getByRole('button', { name: 'Stop only' }));
    expect(onStopOnly).toHaveBeenCalledWith('demo-amber');
  });

  it('never offered after a refusal the phone CAN answer — a busy session asks for `interrupt` instead', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'session-busy' })) as unknown as Archive;
    mount(s(), { archive, onStopOnly: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText("It's working. Archive anyway?")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop only' })).not.toBeInTheDocument();
    expect(screen.queryByText("Stop only is in this session's actions sheet on the board.")).not.toBeInTheDocument();
  });
});

describe('the outcome', () => {
  it('stopped but not archived: a toast says so and that Archive is still offered; the row is not called archived', async () => {
    const archive = vi.fn(async () => ({ ok: true, archived: false, stopped: true, ended: [], refusal: 'status-unknown',
      detail: 'ccd: status-unknown' })) as unknown as Archive;
    const onArchived = vi.fn();
    mount(s({ status: 'busy', bucket: 'working' }), { archive, onArchived });
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    expect(await screen.findByText('Stopped, but not archived — Its status cannot be read, so it will not be archived on a guess. '
      + 'Archive is still offered on its row.')).toBeInTheDocument();
    expect(onArchived).not.toHaveBeenCalled();
  });

  it('a refusal AFTER the programme was ended says the programme was ended — then the refusal, then Stop only', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'worktree-gone', detail: 'ccd: worktree is gone: /w',
      ended: [RUN7] })) as unknown as Archive;
    mount(s(), { archive, onStopOnly: vi.fn(), runs: [claimedRun(RUN7)] });
    fireEvent.click(screen.getByRole('button', { name: 'End programme and archive' }));
    expect(await screen.findByText('Its programme was ended first: run 7 — lifecycle wave 1/3.')).toBeInTheDocument();
    expect(screen.getByText("Couldn't archive")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop only' })).toBeInTheDocument();
  });

  it('stopped but not archived after the programme was ended: the toast says both', async () => {
    const archive = vi.fn(async () => ({ ok: true, archived: false, stopped: true, ended: [RUN7], refusal: 'manifest-unbuildable',
      detail: 'ccd: cannot describe demo-amber truthfully — nothing was touched' })) as unknown as Archive;
    mount(s({ status: 'busy', bucket: 'working' }), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    expect(await screen.findByText(/^Its programme was ended \(run 7 — lifecycle wave 1\/3\)\. Stopped, but not archived/))
      .toBeInTheDocument();
  });

  it('a programme ended on an EARLIER send is still named when a later send stops but does not archive', async () => {
    const archive = vi.fn()
      .mockRejectedValueOnce(refusal({ error: 'session-busy', detail: 'ccd: session-busy', ended: [RUN7] }))
      .mockResolvedValueOnce({ ok: true, archived: false, stopped: true, ended: [], refusal: 'status-unknown',
        detail: 'ccd: status-unknown' }) as unknown as Archive;
    mount(s(), { archive, runs: [claimedRun(RUN7)] });
    fireEvent.click(screen.getByRole('button', { name: 'End programme and archive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Archive anyway' }));
    await waitFor(() => expect(archive).toHaveBeenLastCalledWith('demo-amber', { interrupt: true, programme: 'end' }));
    expect(await screen.findByText(/^Its programme was ended \(run 7 — lifecycle wave 1\/3\)\. Stopped, but not archived/))
      .toBeInTheDocument();
  });

  it('a fault landing under the open sheet blocks the send and names it', async () => {
    const archive = vi.fn() as unknown as Archive;
    const { view, fleet } = mount(s(), { archive });
    view.rerender(
      <ArchiveSheet session={s({ substrate: { at: 1, text: 'x' } })} open onClose={() => {}} archive={archive} fleet={fleet} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('tmux unreachable — x')).toBeInTheDocument();
    expect(archive).not.toHaveBeenCalled();
  });
});
````

<!-- replay: T8 replace pwa/test/archive-conflict-sheet.test.tsx old-inline new-inline -->
In `pwa/test/archive-conflict-sheet.test.tsx`, find:

````tsx
  it('renders a 501 as the host-skew sentence, not a slug', async () => {
````

Replace with:

````tsx
  it('renders the archive door\'s typed refusals in words — a forced archive of a busy workspace (workspace lifecycle §5.2)', async () => {
    const archive = vi.fn().mockRejectedValue(new ApiError(409, { ok: false, error: 'session-busy' }));
    render(<ArchiveConflictSheet sessionId="demo-x" runs={RUNS} onClose={() => {}} archive={archive} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    await waitFor(() =>
      expect(screen.getByText('It is working — archiving now would lose the turn in progress.')).toBeTruthy());
  });

  it('renders a 501 as the host-skew sentence, not a slug', async () => {
````

- [ ] **Step 2: Run them to verify they fail.**

Run: `( cd pwa && ./node_modules/.bin/vitest run test/archive-sheet.test.tsx test/archive-conflict-sheet.test.tsx )`
Expected: `archive-sheet.test.tsx` fails to load (`Failed to resolve import "../src/fleet/ArchiveSheet"`); `archive-conflict-sheet` `1 failed | 13 passed (14)` — its new typed-refusal case.

- [ ] **Step 3: Write the sheet.**

<!-- replay: T8 create pwa/src/fleet/ArchiveSheet.tsx -->
Create `pwa/src/fleet/ArchiveSheet.tsx`:

````tsx
// The ONE "Archive" (workspace lifecycle spec §5.2) — the conversation an Archive tap opens, for every session, from
// the session header's menu and from the fleet row's actions sheet. A `Sheet`, not a `QuickConfirm`, for
// `ArchiveConflictSheet`'s reason: a refusal must be answerable INSIDE it, and `QuickConfirm` closes on every tap.
//
// THE CONFIRM READS BY CASE, and each consent is a SECOND tap after the words that ask for it:
//   - an idle workspace, or a main checkout: what archiving does to it, in its own words;
//   - busy (either kind): "It's working. Archive anyway? The turn in progress is lost." — `interrupt`;
//   - a coordinator with open runs (L5): "It has N open runs. End its programme too? Its workers will be cleaned up."
//     — `programme: 'end'`, with Cancel the only other choice (§11 item 1: an archived coordinator cannot keep a
//     programme alive, so pausing is the coordinator pause switch, and the sheet says so);
//   - a workspace a run still claims (`run-open`): `ArchiveConflictSheet`'s own words — `force`.
// Once a programme was ended, every later refusal says so first (the server's `ended`): a refusal only ccd can
// measure may arrive AFTER the programme end, and the operator is never shown only the second half of what happened.
// The opening case is read off the row the caller holds (`archiveInterrupts`, the runs frame). The server re-reads
// both on the request; when it disagrees, its refusal turns the sheet to the case it found, and the consents already
// given ride along — so no refusal is ever answered twice.
//
// "STOP ONLY" LIVES HERE, AND ONLY WHERE THE CALLER ASKS FOR IT. After a refusal the operator cannot fix from the
// phone — `ARCHIVE_STOP_ONLY`; a coordination store the server could not read (`runs: []`), which refuses every
// consent; a programme it could not end (`programme-partly-ended`: a run the abandon arm cannot move from its row
// refuses the same way on every retry); or a box whose ccd has no `ws-archive` (`501 unsupported`) — a sheet given
// `onStopOnly` offers it, so a live session is never left without a way to put it down. Only the actions sheet passes
// it (spec §5.2: "exactly one place"); a sheet without it says where it is instead.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ARCHIVE_REFUSALS, ARCHIVE_STOP_ONLY, TERMINAL_RUN_STATES, archiveInterrupts, inArchivedFold, isArchiveRefusal,
  substrateFault, type ArchiveRefusal, type FleetSession,
} from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { ARCHIVE_REFUSAL_TEXT, ApiError, api, apiErrorText, archivePartial } from '../lib/api';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { CLAIMED_CONSEQUENCE, claimedSentence, runPhrase, type ArchiveConflictRun } from './ArchiveConflictSheet';
import './fleet.css';

/** Whether a session is already put away, so its menu and its actions sheet offer Restore where every other session
 *  offers Archive (spec §5.2). Every row the Archived fold holds (`inArchivedFold`, the ONE predicate — never
 *  `archivedAt` or `workspace` alone), plus a `cleanup` row: an archived workspace whose merge keeps it in the live
 *  list (`groupFleet`'s `archived` doc), archived all the same. ONE spelling, two callers. */
export const isPutAway = (s: FleetSession): boolean => inArchivedFold(s) || s.bucket === 'cleanup';

/** Restore, for both kinds of row (spec §5.2): a workspace is restored (`ws-restore`); a stopped main checkout is
 *  ensured — `cmd_ensure` clears the stop stamp on the attempt and the row's own registry fields decide the respawn,
 *  exactly as Restart session does. ONE spelling, two callers. */
export const restoreSession = (s: FleetSession): Promise<void> =>
  s.workspace !== null ? api.restore(s.id) : api.ensure(s.id);

/** What the sheet is asking right now. */
type Ask =
  | { readonly kind: 'confirm' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'programme'; readonly runs: readonly ArchiveConflictRun[] }
  | { readonly kind: 'claimed'; readonly runs: readonly ArchiveConflictRun[] }
  /** `unfixable`: a refusal outside `ARCHIVE_STOP_ONLY` that the phone cannot fix either — a store the server could
   *  not read refuses every consent, `force` and `programme: 'end'` included, and a box whose ccd has no `ws-archive`
   *  (`501 unsupported`) refuses every archive. */
  | { readonly kind: 'refused'; readonly refusal: ArchiveRefusal | null; readonly text: string; readonly unfixable?: true }
  | { readonly kind: 'partly'; readonly text: string };

interface Consent { readonly force: boolean; readonly interrupt: boolean; readonly programme: boolean }
const NO_CONSENT: Consent = { force: false, interrupt: false, programme: false };

/** `runs` off a refusal body, `ArchiveConflictSheet`'s reader's rules: every field measured, never invented. */
const runsOf = (body: unknown): readonly ArchiveConflictRun[] => {
  const raw = typeof body === 'object' && body !== null ? (body as { runs?: unknown }).runs : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is ArchiveConflictRun => typeof r === 'object' && r !== null
    && typeof (r as ArchiveConflictRun).id === 'number' && typeof (r as ArchiveConflictRun).program === 'string'
    && typeof (r as ArchiveConflictRun).wave === 'number'
    && ((r as ArchiveConflictRun).waveOf === null || typeof (r as ArchiveConflictRun).waveOf === 'number'));
};

/** `programme-partly-ended`, said: which runs closed, which did not and why, and that nothing else happened. */
function partlyText(body: unknown): string {
  const b = (typeof body === 'object' && body !== null ? body : {}) as
    { closed?: unknown; notClosed?: unknown; refusal?: { id?: unknown; kind?: unknown; detail?: unknown } };
  const closed = runsOf({ runs: b.closed });
  const notClosed = runsOf({ runs: b.notClosed });
  const why = b.refusal && typeof b.refusal.id === 'number' && typeof b.refusal.kind === 'string'
    ? ` Run ${b.refusal.id} could not be ended (${b.refusal.kind}${typeof b.refusal.detail === 'string' ? `: ${b.refusal.detail}` : ''}).`
    : '';
  return `${closed.length > 0 ? `Ended: ${closed.map(runPhrase).join('; ')}.` : 'No run was ended.'}`
    + `${notClosed.length > 0 ? ` Still open: ${notClosed.map(runPhrase).join('; ')}.` : ''}${why}`
    + ' Nothing was stopped or archived.';
}

export interface ArchiveSheetProps {
  /** The row to archive — the caller's LIVE row, so the fault re-check below reads the newest frame. */
  session: FleetSession | null;
  open: boolean;
  onClose: () => void;
  /** The session is put away: archived, or (a main checkout) stopped into the Archived fold. */
  onArchived?: () => void;
  /** "Stop only", after a refusal the phone cannot fix (`stopOnlyClass`, below). Absent → not offered (only the
   *  actions sheet passes it). */
  onStopOnly?: (id: string) => void;
  /** Injectable for tests — `ArchiveConflictSheet`'s own idiom. */
  archive?: typeof api.archive;
  fleet?: FleetStore;
}

export function ArchiveSheet({
  session, open, onClose, onArchived, onStopOnly, archive = api.archive, fleet = useFleetStore,
}: ArchiveSheetProps): ReactNode {
  const runs = fleet((s) => s.runs);
  const [ask, setAsk] = useState<Ask>({ kind: 'confirm' });
  const [consent, setConsent] = useState<Consent>(NO_CONSENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The runs the door already ended on an earlier send of this sheet (its `ended`), so a refusal after that end is
   *  never read as "nothing happened". */
  const [ended, setEnded] = useState<readonly ArchiveConflictRun[]>([]);
  // `gen`, `ArchiveConflictSheet`'s idiom: an answer that lands after the sheet closed, or after it was retargeted to
  // another session, speaks for nobody on screen now.
  const gen = useRef(0);
  const id = session?.id ?? null;

  // The opening case, read off the row and the runs frame each time the sheet opens on a session.
  useEffect(() => {
    gen.current += 1;
    setConsent(NO_CONSENT);
    setBusy(false);
    setError(null);
    setEnded([]);
    if (!open || session === null) return;
    const claimed = runs.filter((r) => r.claimedBy === session.id
      && !(TERMINAL_RUN_STATES as readonly string[]).includes(r.state))
      .map((r) => ({ id: r.id, program: r.program, wave: r.wave, waveOf: r.waveOf }));
    setAsk(archiveInterrupts(session) ? { kind: 'busy' }
      : claimed.length > 0 ? { kind: 'programme', runs: claimed } : { kind: 'confirm' });
    // Re-read on open and on a retarget only: a frame landing under an open sheet must not swap its question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id]);

  if (!open || session === null) return null;
  const sid = session.id;
  const workspace = session.workspace !== null;

  const send = (next: Consent): void => {
    if (busy) return;
    // The substrate gate's confirm-path half: the fleet frame updates LIVE under an open sheet, so the fault is
    // re-read at the moment of firing and the refusal named rather than swallowed.
    const fault = substrateFault(session);
    if (fault !== null) {
      setError(`tmux unreachable — ${fault.text}`);
      return;
    }
    const mine = gen.current;
    setConsent(next);
    setBusy(true);
    setError(null);
    void archive(sid, {
      ...(next.force ? { force: true } : {}),
      ...(next.interrupt ? { interrupt: true } : {}),
      ...(next.programme ? { programme: 'end' as const } : {}),
    }).then(
      (answer) => {
        if (gen.current !== mine) return;
        setBusy(false);
        const partial = archivePartial(answer);
        if (partial !== null) {
          const why = partial.refusal !== null ? ARCHIVE_REFUSAL_TEXT[partial.refusal]
            : `${partial.detail ?? 'the archive was refused'}.`;
          const endedFirst = [...ended, ...runsOf({ runs: answer?.ended })];
          toast(`${endedFirst.length > 0 ? `Its programme was ended (${endedFirst.map(runPhrase).join('; ')}). ` : ''}`
            + `Stopped, but not archived — ${why} Archive is still offered on its row.`, 'error');
        } else {
          onArchived?.();
        }
        onClose();
      },
      (err: unknown) => {
        if (gen.current !== mine) return;
        setBusy(false);
        const code = err instanceof ApiError && typeof err.body === 'object' && err.body !== null
          ? (err.body as { error?: unknown }).error : undefined;
        const endedNow = err instanceof ApiError ? runsOf({ runs: (err.body as { ended?: unknown } | null)?.ended }) : [];
        if (endedNow.length > 0) setEnded((prev) => [...prev, ...endedNow]);
        if (err instanceof ApiError && err.status === 409 && isArchiveRefusal(code)) {
          if (code === ARCHIVE_REFUSALS.sessionBusy) return setAsk({ kind: 'busy' });
          if (code === ARCHIVE_REFUSALS.runOpen) return setAsk({ kind: 'claimed', runs: runsOf(err.body) });
          if (code === ARCHIVE_REFUSALS.coordinatorHasOpenRuns) {
            const named = runsOf(err.body);
            return setAsk(named.length > 0 ? { kind: 'programme', runs: named } : { kind: 'refused', refusal: code,
              unfixable: true, text: `${ARCHIVE_REFUSAL_TEXT[code]} This box could not read them, so it will not archive it.` });
          }
          if (code === ARCHIVE_REFUSALS.programmePartlyEnded) return setAsk({ kind: 'partly', text: partlyText(err.body) });
          return setAsk({ kind: 'refused', refusal: code, text: ARCHIVE_REFUSAL_TEXT[code] });
        }
        // `501 unsupported`: the fleet box's ccd predates `ws-archive`, so no retry and no consent archives it there
        // until the box is updated — an unfixable refusal, answered with "Stop only" like the others.
        if (err instanceof ApiError && err.status === 501) {
          return setAsk({ kind: 'refused', refusal: null, unfixable: true, text: apiErrorText(err) });
        }
        setError(apiErrorText(err));
      },
    );
  };

  /** A refusal only "Stop only" answers: one of `ARCHIVE_STOP_ONLY`, an `unfixable` one (a store the server could not
   *  read, a box without `ws-archive`), or a programme it could not end. */
  const stopOnlyClass = ask.kind === 'partly' || (ask.kind === 'refused'
    && (ask.unfixable === true || (ask.refusal !== null && ARCHIVE_STOP_ONLY.includes(ask.refusal))));
  const stopOnly = onStopOnly !== undefined && stopOnlyClass;

  let title: string;
  let body: ReactNode;
  let primary: { label: string; next: Consent } | null;
  switch (ask.kind) {
    case 'confirm':
      title = workspace ? 'Archive this workspace?' : 'Archive this session?';
      body = <p className="qc-consequence">{workspace
        ? 'It goes offline and folds into Archived. Restore brings it back.'
        : 'It goes offline and folds into Archived. Restore starts it again. It is never deleted.'}</p>;
      primary = { label: 'Archive', next: consent };
      break;
    case 'busy':
      title = "It's working. Archive anyway?";
      body = <p className="qc-consequence">The turn in progress is lost.</p>;
      primary = { label: 'Archive anyway', next: { ...consent, interrupt: true } };
      break;
    case 'programme':
      title = `It has ${ask.runs.length} open ${ask.runs.length === 1 ? 'run' : 'runs'}. End its programme too?`;
      body = (
        <>
          <p className="qc-consequence">Its workers will be cleaned up.</p>
          <p className="qc-consequence">{`${ask.runs.map(runPhrase).join('; ')}.`}</p>
          <p className="qc-consequence">
            To pause a programme instead, use the coordinator pause switch on the Runs screen — archiving its
            coordinator does not pause it.
          </p>
        </>
      );
      primary = { label: 'End programme and archive', next: { ...consent, programme: true } };
      break;
    case 'claimed':
      title = 'This workspace is claimed';
      body = (
        <>
          <p className="qc-consequence">{claimedSentence(ask.runs.length > 0 ? ask.runs : null)}</p>
          <p className="qc-consequence">{CLAIMED_CONSEQUENCE}</p>
        </>
      );
      primary = { label: 'Archive anyway', next: { ...consent, force: true } };
      break;
    case 'refused':
      title = "Couldn't archive";
      body = <p className="qc-consequence">{ask.text}</p>;
      primary = null;
      break;
    case 'partly':
      title = 'The programme was only partly ended';
      body = <p className="qc-consequence">{ask.text}</p>;
      primary = null;
      break;
  }

  return (
    <Sheet open onClose={onClose} title={title} eyebrow={session.project}>
      <div className="archive-conflict-sheet">
        {ended.length > 0 && (
          <p className="qc-consequence">{`Its programme was ended first: ${ended.map(runPhrase).join('; ')}.`}</p>
        )}
        {body}
        {/* After a `stopOnlyClass` refusal: what "Stop only" does, or where it is. */}
        {stopOnly && (
          <p className="qc-consequence">Stop only takes it offline without archiving it: it stays on the board, stopped.</p>
        )}
        {stopOnlyClass && !stopOnly && (
          <p className="qc-consequence">Stop only is in this session's actions sheet on the board.</p>
        )}
        <div className="qc-actions">
          {primary !== null && (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => send(primary!.next)}>
              {busy ? 'Archiving…' : primary.label}
            </button>
          )}
          {stopOnly && (
            <button type="button" className="btn-primary" onClick={() => { onStopOnly!(sid); onClose(); }}>
              Stop only
            </button>
          )}
          <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>
            {primary === null && !stopOnly ? 'Close' : 'Cancel'}
          </button>
        </div>
        {error !== null && <p className="abandon-error">{error}</p>}
      </div>
    </Sheet>
  );
}
````

<!-- replay: T8 replace pwa/src/fleet/ArchiveConflictSheet.tsx -->
In `pwa/src/fleet/ArchiveConflictSheet.tsx`, find:

````tsx
import { ARCHIVE_REFUSALS } from '../../../shared/api';
````

Replace with:

````tsx
import { ARCHIVE_REFUSALS, isArchiveRefusal } from '../../../shared/api';
````

<!-- replay: T8 replace pwa/src/fleet/ArchiveConflictSheet.tsx -->
In `pwa/src/fleet/ArchiveConflictSheet.tsx`, find:

````tsx
import { ApiError, UNSUPPORTED_VERB_TEXT, api } from '../lib/api';
````

Replace with:

````tsx
import { ARCHIVE_REFUSAL_TEXT, ApiError, UNSUPPORTED_VERB_TEXT, api } from '../lib/api';
````

<!-- replay: T8 replace pwa/src/fleet/ArchiveConflictSheet.tsx -->
In `pwa/src/fleet/ArchiveConflictSheet.tsx`, find:

````tsx
  if (err.status === 404) return 'that session is gone — the fleet will catch up';
````

Replace with:

````tsx
  if (err.status === 404) return 'that session is gone — the fleet will catch up';
  // Workspace lifecycle §5.2: the door's typed refusals, in the words every archive surface uses.
  const code = typeof err.body === 'object' && err.body !== null ? (err.body as { error?: unknown }).error : undefined;
  if (err.status === 409 && isArchiveRefusal(code)) return ARCHIVE_REFUSAL_TEXT[code];
````

<!-- replay: T8 replace pwa/src/fleet/ArchiveConflictSheet.tsx -->
In `pwa/src/fleet/ArchiveConflictSheet.tsx`, find:

````tsx
const runPhrase = (r: ArchiveConflictRun): string =>
  `run ${r.id} — ${r.program} wave ${r.wave}${r.waveOf === null ? '' : `/${r.waveOf}`}`;
````

Replace with:

````tsx
export const runPhrase = (r: ArchiveConflictRun): string =>
  `run ${r.id} — ${r.program} wave ${r.wave}${r.waveOf === null ? '' : `/${r.waveOf}`}`;

/** The claimed workspace's two sentences, ONE spelling for the two sheets that say them: this one, behind the PR
 *  sheet's door, and `ArchiveSheet`'s `run-open` case (workspace lifecycle §5.2). `null` runs degrade, never invent. */
export const claimedSentence = (named: readonly ArchiveConflictRun[] | null): string =>
  named === null
    ? 'A run is still open on this workspace'
    : named.length === 1
      ? `${runPhrase(named[0]!)} is still open on this workspace.`
      : `${named.map(runPhrase).join('; ')} are still open on this workspace.`;

export const CLAIMED_CONSEQUENCE =
  'Archiving stops the session and puts the worktree away. Nothing is deleted, but the run loses the workspace it is working in.';
````

<!-- replay: T8 replace pwa/src/fleet/ArchiveConflictSheet.tsx -->
In `pwa/src/fleet/ArchiveConflictSheet.tsx`, find:

````tsx
        <p className="qc-consequence">
          {named === null
            ? 'A run is still open on this workspace'
            : named.length === 1
              ? `${runPhrase(named[0]!)} is still open on this workspace.`
              : `${named.map(runPhrase).join('; ')} are still open on this workspace.`}
        </p>
        <p className="qc-consequence">
          Archiving stops the session and puts the worktree away. Nothing is deleted, but the
          run loses the workspace it is working in.
        </p>
````

Replace with:

````tsx
        <p className="qc-consequence">{claimedSentence(named)}</p>
        <p className="qc-consequence">{CLAIMED_CONSEQUENCE}</p>
````

- [ ] **Step 4: Run them and the typecheck.**

```bash
( cd pwa && ./node_modules/.bin/vitest run test/archive-sheet.test.tsx test/archive-conflict-sheet.test.tsx test/pr-sheet.test.tsx )
( cd pwa && ./node_modules/.bin/tsc --noEmit -p . )
```

Expected: the first two files `37 passed (37)`, `pr-sheet` green; no output from `tsc`.

- [ ] **Step 5: Commit.**

```bash
git add -u pwa/src/fleet/ArchiveConflictSheet.tsx pwa/test/archive-conflict-sheet.test.tsx
git add pwa/src/fleet/ArchiveSheet.tsx pwa/test/archive-sheet.test.tsx
git commit -m "pwa: ArchiveSheet — the confirm by case, every refusal answered inside it (workspace lifecycle W2)"
```

### Task 9: The actions sheet — Archive for every session, Restore for every put-away row

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `pwa/src/fleet/SessionActionsSheet.tsx` (the import; `conflict` state → `archiveOpen`; its reset; `archiveNow` → the sheet; the Archive/Restore pair; "Stop only"; the `ArchiveConflictSheet` mount → `ArchiveSheet`)
- Modify: `pwa/test/session-actions-sheet.test.tsx` (the archive-and-restore describe; the substrate-gate case's button name)

**Interfaces:**
- Consumes: Task 8's `ArchiveSheet`, `isPutAway`, `restoreSession`. `onStopOnly` is passed HERE and nowhere else; it calls the unchanged `api.stop`.

- [ ] **Step 1: Rewrite the archive-and-restore cases.**

<!-- replay: T9 replace pwa/test/session-actions-sheet.test.tsx -->
In `pwa/test/session-actions-sheet.test.tsx`, find:

````tsx
describe('archive and restore (D5 rider 1)', () => {
  it('Archive shows only for an unarchived workspace session, and POSTs /archive', async () => {
    render(<SessionActionsSheet session={s()} open onClose={() => {}} onReap={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /archive workspace/i }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(
      (c) => String(c[0]).endsWith('/demo-quiet-mesa/archive'))).toBe(true));
  });

  it('Restore shows only on the complement, and POSTs /restore', async () => {
    render(<SessionActionsSheet session={s({ archivedAt: null })} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/restore workspace/i)).not.toBeInTheDocument();
    cleanup();
    render(<SessionActionsSheet session={s({ archivedAt: 1785300000 })} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/archive workspace/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /restore workspace/i }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(
      (c) => String(c[0]).endsWith('/demo-quiet-mesa/restore'))).toBe(true));
  });

  it('no workspace → neither appears', () => {
    render(<SessionActionsSheet session={s({ workspace: null, archivedAt: 1785300000 })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/archive workspace/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/restore workspace/i)).not.toBeInTheDocument();
  });

  it("failure toasts Couldn't archive — with ccd's own words", async () => {
    stubFetch({ ok: false, stderr: 'not merged' });
    render(
      <>
        <SessionActionsSheet session={s()} open onClose={() => {}} onReap={() => {}} />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /archive workspace/i }));
    expect(await screen.findByText(/Couldn't archive — not merged/)).toBeInTheDocument();
  });

  // Build 8 Wave 2, Task 213. `archive` is INJECTED, not module-mocked — the
  // AbandonSheet idiom, and the reason this component gained the prop. The
  // helper is new: this file had no render helper at all, every mount was
  // spelled inline with `open`/`onClose`/`onReap` each time.
  it('Archive workspace routes a 409 run-open into the sheet, never a toast', async () => {
    const archive = vi.fn().mockRejectedValue(
      new ApiError(409, { ok: false, error: 'run-open', runs: [{ id: 17, program: 'build4', wave: 2, waveOf: 3 }] }));
    renderSheet(workspaceSession(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive workspace' }));
    await waitFor(() => expect(screen.getByText(/This workspace is claimed/)).toBeTruthy());
    expect(screen.getByText(/run 17/)).toBeTruthy();
    // The defect this replaces: a bare slug in a toast.
    expect(screen.queryByText(/Couldn't archive — run-open/)).toBeNull();
  });

  it('any OTHER archive failure still toasts — the sheet is for run-open, not for everything', async () => {
    const archive = vi.fn().mockRejectedValue(new ApiError(502, { ok: false, stderr: 'ws-archive: busy' }));
    renderSheet(workspaceSession(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive workspace' }));
    expect(await screen.findByText(/Couldn't archive — ws-archive: busy/)).toBeInTheDocument();
    expect(screen.queryByText(/This workspace is claimed/)).toBeNull();
  });

  // The SAME class as this file's `swapOpen`/`holdOpen`/`releaseConfirmOpen`
  // resets, one state later: `conflict` is a claim measured for ONE session,
  // and FleetScreen's `openActionsFor` retargets `actionsSession` while
  // `actionsOpen` stays true (tap another row's ··· with this sheet up). The
  // sheet is mounted at screen level and never unmounts on close, so nothing
  // else clears it — session B's operator would be shown session A's run.
  it('a run-open captured for session A does NOT follow a retarget to session B', async () => {
    const archive = vi.fn().mockRejectedValue(
      new ApiError(409, { ok: false, error: 'run-open', runs: [{ id: 17, program: 'build4', wave: 2, waveOf: 3 }] }));
    const b = s({ id: 'demo-still-ridge', workspace: 'still-ridge', archivedAt: null });
    const props = { open: true, onClose: () => {}, onReap: () => {}, archive };
    const { rerender } = render(
      <>
        <SessionActionsSheet session={workspaceSession()} {...props} />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archive workspace' }));
    await waitFor(() => expect(screen.getByText(/This workspace is claimed/)).toBeTruthy());

    rerender(
      <>
        <SessionActionsSheet session={b} {...props} />
        <ToastHost />
      </>,
    );
    expect(screen.queryByText(/This workspace is claimed/)).toBeNull();
    expect(screen.queryByText(/run 17/)).toBeNull();
  });

  // The OTHER half of "unconditional": `ArchiveConflictSheet` is mounted as a
  // SIBLING of `<Sheet open={open}>`, not inside it, so a claim left set while
  // the actions sheet closes stays on screen with nothing behind it. A reset
  // living in the close-only effect above (`if (open) return`) would pass the
  // retarget test and still leave this one red.
  it('closing the door drops the claim — the conflict sheet is not gated on `open`', async () => {
    const archive = vi.fn().mockRejectedValue(
      new ApiError(409, { ok: false, error: 'run-open', runs: [{ id: 17, program: 'build4', wave: 2, waveOf: 3 }] }));
    const session = workspaceSession();
    const props = { session, onClose: () => {}, onReap: () => {}, archive };
    const { rerender } = render(
      <><SessionActionsSheet {...props} open /><ToastHost /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Archive workspace' }));
    await waitFor(() => expect(screen.getByText(/This workspace is claimed/)).toBeTruthy());

    rerender(<><SessionActionsSheet {...props} open={false} /><ToastHost /></>);
    expect(screen.queryByText(/This workspace is claimed/)).toBeNull();
  });
});

````

Replace with:

````tsx
describe('archive and restore (workspace lifecycle §5.2: one Archive, Restore on the fold)', () => {
  /** The archive sheet's own confirm — its primary button, beside the actions sheet's same-named opener. */
  const confirmArchive = async (): Promise<void> => {
    await waitFor(() => expect(document.querySelector('.archive-conflict-sheet .btn-primary')).not.toBeNull());
    fireEvent.click(document.querySelector('.archive-conflict-sheet .btn-primary')!);
  };
  const posted = (suffix: string) => vi.mocked(fetch).mock.calls.some((c) => String(c[0]).endsWith(suffix));

  it('every session offers Archive — a workspace and a main checkout alike — through the one archive sheet', async () => {
    for (const [session, title] of [[s(), 'Archive this workspace?'],
      [s({ id: 'claude-demo', workspace: null }), 'Archive this session?']] as const) {
      const archive = vi.fn(async () => null);
      renderSheet(session, { archive });
      expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
      expect(await screen.findByText(title)).toBeInTheDocument();
      await confirmArchive();
      await waitFor(() => expect(archive).toHaveBeenCalledWith(session.id, {}));
      cleanup();
    }
  });

  it.each([
    ['an archived workspace', s({ status: 'dead', archivedAt: 1785300000, bucket: 'archived' }), '/demo-quiet-mesa/restore'],
    ['a stopped main checkout', s({ id: 'claude-demo', workspace: null, status: 'dead', bucket: 'dead',
      stoppedBy: { at: 1785300000_000, surface: 'pwa' } }), '/claude-demo/ensure'],
    ['a merged-and-archived (`cleanup`) workspace', s({ status: 'dead', archivedAt: 1785300000, bucket: 'cleanup' }),
      '/demo-quiet-mesa/restore'],
  ] as const)('%s offers Restore and no Archive, and Restore POSTs %s', async (_label, session, suffix) => {
    renderSheet(session);
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(posted(suffix)).toBe(true));
  });

  it.each([
    ['a stopped workspace that is not archived — Archive again', s({ status: 'dead', bucket: 'dead',
      stoppedBy: { at: 1785300000_000, surface: 'pwa' } })],
    ['a crashed main checkout — dead, never stopped', s({ id: 'claude-demo', workspace: null, status: 'dead', bucket: 'dead' })],
  ] as const)('%s offers Archive and no Restore', (_label, session) => {
    renderSheet(session);
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  });

  it('a 409 run-open lands in the archive sheet, naming the run — never a toast', async () => {
    const archive = vi.fn().mockRejectedValue(
      new ApiError(409, { ok: false, error: 'run-open', runs: [{ id: 17, program: 'build4', wave: 2, waveOf: 3 }] }));
    renderSheet(workspaceSession(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await confirmArchive();
    await waitFor(() => expect(screen.getByText(/This workspace is claimed/)).toBeTruthy());
    expect(screen.getByText(/run 17/)).toBeTruthy();
    expect(screen.queryByText(/Couldn't archive — run-open/)).toBeNull();
  });

  it('a failure the door has no word for stays in the sheet, in ccd\'s own words', async () => {
    const archive = vi.fn().mockRejectedValue(new ApiError(502, { ok: false, stderr: 'ws-archive: busy' }));
    renderSheet(workspaceSession(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await confirmArchive();
    expect(await screen.findByText('ws-archive: busy')).toBeInTheDocument();
  });

  it('"Stop only" after a refusal the phone cannot fix POSTs the unchanged /stop', async () => {
    const archive = vi.fn().mockRejectedValue(new ApiError(409, { ok: false, error: 'worktree-gone' }));
    renderSheet(workspaceSession(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await confirmArchive();
    fireEvent.click(await screen.findByRole('button', { name: 'Stop only' }));
    await waitFor(() => expect(posted('/demo-quiet-mesa/stop')).toBe(true));
  });

  // The SAME class as this file's `swapOpen`/`holdOpen`/`releaseConfirmOpen`
  // resets, one state later: a claim is measured for ONE session, and
  // FleetScreen's `openActionsFor` retargets `actionsSession` while
  // `actionsOpen` stays true (tap another row's ··· with this sheet up). The
  // sheet is mounted at screen level and never unmounts on close, so nothing
  // else clears it — session B's operator would be shown session A's run.
  it('a run-open captured for session A does NOT follow a retarget to session B', async () => {
    const archive = vi.fn().mockRejectedValue(
      new ApiError(409, { ok: false, error: 'run-open', runs: [{ id: 17, program: 'build4', wave: 2, waveOf: 3 }] }));
    const b = s({ id: 'demo-still-ridge', workspace: 'still-ridge', archivedAt: null });
    const props = { open: true, onClose: () => {}, onReap: () => {}, archive };
    const { rerender } = render(
      <>
        <SessionActionsSheet session={workspaceSession()} {...props} />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await confirmArchive();
    await waitFor(() => expect(screen.getByText(/This workspace is claimed/)).toBeTruthy());

    rerender(
      <>
        <SessionActionsSheet session={b} {...props} />
        <ToastHost />
      </>,
    );
    expect(screen.queryByText(/This workspace is claimed/)).toBeNull();
    expect(screen.queryByText(/run 17/)).toBeNull();
  });

  // The OTHER half of "unconditional": the archive sheet is mounted as a
  // SIBLING of `<Sheet open={open}>`, not inside it, so a claim left set while
  // the actions sheet closes would stay on screen with nothing behind it.
  it('closing the door drops the claim — the archive sheet is gated on `open` too', async () => {
    const archive = vi.fn().mockRejectedValue(
      new ApiError(409, { ok: false, error: 'run-open', runs: [{ id: 17, program: 'build4', wave: 2, waveOf: 3 }] }));
    const session = workspaceSession();
    const props = { session, onClose: () => {}, onReap: () => {}, archive };
    const { rerender } = render(
      <><SessionActionsSheet {...props} open /><ToastHost /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await confirmArchive();
    await waitFor(() => expect(screen.getByText(/This workspace is claimed/)).toBeTruthy());

    rerender(<><SessionActionsSheet {...props} open={false} /><ToastHost /></>);
    expect(screen.queryByText(/This workspace is claimed/)).toBeNull();
  });
});

````

<!-- replay: T9 replace pwa/test/session-actions-sheet.test.tsx old-inline new-inline -->
In `pwa/test/session-actions-sheet.test.tsx`, find:

````tsx
  it('Archive workspace is disabled and the injected archive spy never fires', () => {
    const archive = vi.fn();
    renderSheet(faulted(), { archive });
    const btn = screen.getByRole('button', { name: /archive workspace/i });
````

Replace with:

````tsx
  it('Archive is disabled and the injected archive spy never fires', () => {
    const archive = vi.fn();
    renderSheet(faulted(), { archive });
    const btn = screen.getByRole('button', { name: 'Archive' });
````

- [ ] **Step 2: Run them to verify they fail.**

Run: `( cd pwa && ./node_modules/.bin/vitest run test/session-actions-sheet.test.tsx )`
Expected: `12 failed | 46 passed (58)` — every new archive-and-restore case and the renamed substrate-gate case (the sheet still says `Archive workspace`, offers it to workspaces only, gates Restore on `archivedAt`, and has no `Stop only`).

- [ ] **Step 3: Move the sheet onto the one Archive.**

<!-- replay: T9 replace pwa/src/fleet/SessionActionsSheet.tsx -->
In `pwa/src/fleet/SessionActionsSheet.tsx`, find:

````tsx
import { ArchiveConflictSheet, runOpenRuns, type ArchiveConflictRun } from './ArchiveConflictSheet';
````

Replace with:

````tsx
import { ArchiveSheet, isPutAway, restoreSession } from './ArchiveSheet';
````

<!-- replay: T9 replace pwa/src/fleet/SessionActionsSheet.tsx -->
In `pwa/src/fleet/SessionActionsSheet.tsx`, find:

````tsx
  /** `undefined` = no refusal to show; otherwise the runs the server named
   *  (possibly `[]` — a run-open whose runs we could not read, which the sheet
   *  renders without inventing an id). Three states, because collapsing the
   *  empty case into "no conflict" is the defect the sheet exists to close. */
  const [conflict, setConflict] = useState<readonly ArchiveConflictRun[] | undefined>(undefined);
````

Replace with:

````tsx
  /** The one Archive's sheet (workspace lifecycle §5.2) is open over this one. It hosts every refusal the archive
   *  door can answer — the `run-open` claim this sheet used to hold as `conflict` among them. */
  const [archiveOpen, setArchiveOpen] = useState(false);
````

<!-- replay: T9 replace pwa/src/fleet/SessionActionsSheet.tsx -->
In `pwa/src/fleet/SessionActionsSheet.tsx`, find:

````tsx
  // `conflict` JOINED THIS LIST in the wave-2 review, and it is the worst
  // member of it: the other four are the operator's own half-finished input,
  // but a `409 run-open` is a MEASUREMENT the server made about session A —
  // a named run, a named program, a named wave. Left behind across a
  // retarget it does not merely look stale, it tells session B's operator
  // that THEIR workspace is claimed by a run that never named it, and offers
  // "Archive anyway" over it. Unconditional, like the rest: the retarget
  // happens with `open` staying true, so a reset gated on close never fires.
````

Replace with:

````tsx
  // `conflict` JOINED THIS LIST in the wave-2 review, and it is the worst
  // member of it: the other four are the operator's own half-finished input,
  // but a `409 run-open` is a MEASUREMENT the server made about session A —
  // a named run, a named program, a named wave. Left behind across a
  // retarget it does not merely look stale, it tells session B's operator
  // that THEIR workspace is claimed by a run that never named it, and offers
  // "Archive anyway" over it. Unconditional, like the rest: the retarget
  // happens with `open` staying true, so a reset gated on close never fires.
  // Workspace lifecycle §5.2 moved that claim into `ArchiveSheet`, which resets
  // itself on the same two changes; `archiveOpen` takes its place here.
````

<!-- replay: T9 replace pwa/src/fleet/SessionActionsSheet.tsx old-inline new-inline -->
In `pwa/src/fleet/SessionActionsSheet.tsx`, find:

````tsx
    setForgetConfirmOpen(false);
    setConflict(undefined);
  }, [open, session?.id]);
````

Replace with:

````tsx
    setForgetConfirmOpen(false);
    setArchiveOpen(false);
  }, [open, session?.id]);
````

<!-- replay: T9 replace pwa/src/fleet/SessionActionsSheet.tsx -->
In `pwa/src/fleet/SessionActionsSheet.tsx`, find:

````tsx
  const archiveNow = async (): Promise<void> => {
    if (archBusy) return;
    setArchBusy(true);
    try {
      await archive(session.id);
      onClose();
    } catch (err) {
      // `409 run-open` is not a failure the operator can act on from a toast:
      // the refusal names WHICH run, and naming it is the whole information.
      // Everything else keeps the toast it always had.
      const runs = runOpenRuns(err);
      if (runs !== null) setConflict(runs);
      else toast(`Couldn't archive — ${apiErrorText(err)}`, 'error');
    } finally {
      setArchBusy(false);
    }
  };

  const restoreNow = async (): Promise<void> => {
    if (archBusy) return;
    setArchBusy(true);
    try {
      await api.restore(session.id);
      onClose();
    } catch (err) {
      toast(`Couldn't restore — ${apiErrorText(err)}`, 'error');
    } finally {
      setArchBusy(false);
    }
  };
````

Replace with:

````tsx
  // Workspace lifecycle §5.2: every session offers Archive, and every session already put away offers Restore.
  const putAway = isPutAway(session);

  const restoreNow = async (): Promise<void> => {
    if (archBusy) return;
    setArchBusy(true);
    try {
      await restoreSession(session);
      onClose();
    } catch (err) {
      toast(`Couldn't restore — ${apiErrorText(err)}`, 'error');
    } finally {
      setArchBusy(false);
    }
  };

  // "Stop only" — the one place it survives (spec §5.2): offered by `ArchiveSheet` after an archive refusal the
  // operator cannot fix from the phone, so a live session is never left without a way to put it down. The same
  // `POST /api/sessions/:id/stop` as ever, which is unchanged.
  const stopOnly = (id: string): void => {
    void (async () => {
      try {
        await api.stop(id);
      } catch (err) {
        toast(`Couldn't stop — ${apiErrorText(err)}`, 'error');
      }
    })();
    onClose();
  };
````

<!-- replay: T9 replace pwa/src/fleet/SessionActionsSheet.tsx -->
In `pwa/src/fleet/SessionActionsSheet.tsx`, find:

````tsx
          {session.workspace !== null && session.archivedAt === null && (
            <button type="button" className="btn-ghost" disabled={archBusy || fault !== null}
                    title={faultTitle} onClick={() => void archiveNow()}>
              {archBusy ? 'Archiving…' : 'Archive workspace'}
            </button>
          )}
          {session.workspace !== null && session.archivedAt !== null && (
            <button type="button" className="btn-ghost" disabled={archBusy}
                    onClick={() => void restoreNow()}>
              {archBusy ? 'Restoring…' : 'Restore workspace'}
            </button>
          )}
````

Replace with:

````tsx
          {/* Every session offers Archive (spec §5.2) — a workspace and a main checkout alike; every row the
              Archived fold holds offers Restore instead. Never both. */}
          {!putAway && (
            <button type="button" className="btn-ghost" disabled={fault !== null}
                    title={faultTitle} onClick={() => setArchiveOpen(true)}>
              Archive
            </button>
          )}
          {putAway && (
            <button type="button" className="btn-ghost" disabled={archBusy}
                    onClick={() => void restoreNow()}>
              {archBusy ? 'Restoring…' : 'Restore'}
            </button>
          )}
````

<!-- replay: T9 replace pwa/src/fleet/SessionActionsSheet.tsx -->
In `pwa/src/fleet/SessionActionsSheet.tsx`, find:

````tsx
      {/* The refusal, as a surface the operator can answer — the SAME sheet
          and the SAME reader (`runOpenRuns`) PrSheet's archive door uses, so
          the two doors cannot drift onto two sentences. `onDone` closes this
          sheet too: the archive succeeded, so there is nothing left here to
          act on. */}
      <ArchiveConflictSheet
        sessionId={conflict === undefined ? null : session.id}
        runs={conflict !== undefined && conflict.length > 0 ? conflict : null}
        onClose={() => setConflict(undefined)}
        onDone={() => { setConflict(undefined); onClose(); }}
      />
````

Replace with:

````tsx
      {/* The one Archive (workspace lifecycle §5.2): the confirm by case and every refusal the door answers, a run's
          claim on the workspace included, answered INSIDE it. A sibling of `<Sheet open={open}>`, so it is gated on `open`
          too: closing the door drops whatever it was asking. Archived → this sheet closes as well, as it always did.
          `onStopOnly` is passed HERE and nowhere else. */}
      <ArchiveSheet
        session={session}
        open={open && archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onArchived={onClose}
        onStopOnly={stopOnly}
        archive={archive}
        fleet={fleet}
      />
````

- [ ] **Step 4: Run it and the typecheck.**

```bash
( cd pwa && ./node_modules/.bin/vitest run test/session-actions-sheet.test.tsx test/tap-targets.test.tsx )
( cd pwa && ./node_modules/.bin/tsc --noEmit -p . )
```

Expected: `58 passed (58)` in the first file, `tap-targets` green; no output from `tsc`.

- [ ] **Step 5: Commit.**

```bash
git add -u pwa/src/fleet/SessionActionsSheet.tsx pwa/test/session-actions-sheet.test.tsx
git commit -m "pwa: the actions sheet offers Archive for every session and Restore for every put-away row (workspace lifecycle W2)"
```

### Task 10: The session header — Archive replaces Stop session; Restore in its place when put away

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `pwa/src/session/SessionHeader.tsx` (the header comment; an import; `onStopSession` → `onArchive` + `onRestore`; the menu item)
- Modify: `pwa/src/screens/SessionScreen.tsx` (the `QuickConfirm` import, state, `stopSession` and the confirm removed; `ArchiveSheet` mounted; the header's two callbacks)
- Modify: `pwa/src/components/QuickConfirm.tsx` (its header comment no longer names stop)
- Modify: `pwa/test/header.test.tsx`, `pwa/test/lifecycle-ui.test.tsx`, `pwa/test/typed-label.test.tsx`

**Interfaces:**
- Produces: `SessionHeaderProps.onArchive: () => void`, `SessionHeaderProps.onRestore: () => void` (`onStopSession` is gone; the `esc` keycap, `onInterrupt`, is unchanged).
- Consumes: Task 8's `ArchiveSheet`, `isPutAway`, `restoreSession`. The header mounts no `onStopOnly`: "Stop only" lives in the actions sheet alone, and the header's sheet says so after a refusal it answers.

- [ ] **Step 1: Move the header's tests onto Archive.**

<!-- replay: T10 replace pwa/test/header.test.tsx -->
In `pwa/test/header.test.tsx`, find:

````tsx
  onStopSession: vi.fn(),
````

Replace with:

````tsx
  onArchive: vi.fn(),
  onRestore: vi.fn(),
````

<!-- replay: T10 replace pwa/test/header.test.tsx -->
In `pwa/test/header.test.tsx`, find:

````tsx
  it('disables the Stop menu item under a fault, naming it', async () => {
    const p = renderHeader({ session: fleetSession({ substrate: { at: 1, text: 'x' } }) });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const stop = await screen.findByRole('button', { name: /Stop session/ });
    expect(stop).toBeDisabled();
    expect(stop.getAttribute('title')).toContain('x');
    expect(stop.getAttribute('title')).toMatch(/tmux unreachable/);
    fireEvent.click(stop);
    expect(p.onStopSession).not.toHaveBeenCalled();
  });

  it('a null substrate leaves the Stop menu item live', async () => {
    const p = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const stop = await screen.findByRole('button', { name: /Stop session/ });
    expect(stop).toBeEnabled();
    fireEvent.click(stop);
    expect(p.onStopSession).toHaveBeenCalledOnce();
  });
````

Replace with:

````tsx
  // Workspace lifecycle §5.2: the menu's "Stop session" became "Archive" — stop and archive are one feature. The
  // `esc` keycap (interrupt) is a different control and is pinned unchanged at the top of this file.
  it('disables the Archive menu item under a fault, naming it', async () => {
    const p = renderHeader({ session: fleetSession({ substrate: { at: 1, text: 'x' } }) });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const archive = await screen.findByRole('button', { name: 'Archive' });
    expect(archive).toBeDisabled();
    expect(archive.getAttribute('title')).toContain('x');
    expect(archive.getAttribute('title')).toMatch(/tmux unreachable/);
    fireEvent.click(archive);
    expect(p.onArchive).not.toHaveBeenCalled();
  });

  it('a null substrate leaves the Archive menu item live, and the menu has no Stop session left', async () => {
    const p = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const archive = await screen.findByRole('button', { name: 'Archive' });
    expect(archive).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Stop session/ })).toBeNull();
    fireEvent.click(archive);
    expect(p.onArchive).toHaveBeenCalledOnce();
  });

  it('a session already put away offers Restore in Archive\'s place', async () => {
    const p = renderHeader({ session: fleetSession({ status: 'dead', bucket: 'archived', archivedAt: 1785300000 }) });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(p.onRestore).toHaveBeenCalledOnce();
  });
````

<!-- replay: T10 replace pwa/test/header.test.tsx old-inline new-inline -->
In `pwa/test/header.test.tsx`, find:

````tsx
  it('a fault landing while the stop confirm is already open still blocks the stop', async () => {
    // The menu item's `disabled` cannot cover this: the fleet frame updates
    // LIVE under an open confirm, and QuickConfirm owns its own button — so
    // the confirm path carries a handler guard, and the refusal is named on
    // the toast rather than swallowed.
    const spy = vi.spyOn(api, 'stop').mockResolvedValue(undefined);
````

Replace with:

````tsx
  it('a fault landing while the archive sheet is already open still blocks the archive', async () => {
    // The menu item's `disabled` cannot cover this: the fleet frame updates
    // LIVE under an open sheet, and the sheet owns its own button — so the
    // send re-reads the fault at the moment of firing, and the refusal is
    // named rather than swallowed.
    const spy = vi.spyOn(api, 'archive').mockResolvedValue(null);
````

<!-- replay: T10 replace pwa/test/header.test.tsx old-inline new-inline -->
In `pwa/test/header.test.tsx`, find:

````tsx
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByRole('button', { name: /Stop session/ }));
    // The confirm is on screen; NOW the snapshot flags the substrate.
    act(() => {
      fleet.setState({ sessions: [fleetSession({ substrate: { at: 1, text: 'x' } })] });
    });
    // QuickConfirm's own confirm button — by wrapper class, since the menu's
    // same-named opener may still be unmounting behind it (the actions-sheet
    // suite's Release idiom).
    fireEvent.click(document.querySelector('.qc-actions .btn-primary')!);
````

Replace with:

````tsx
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    // The sheet is on screen; NOW the snapshot flags the substrate.
    act(() => {
      fleet.setState({ sessions: [fleetSession({ substrate: { at: 1, text: 'x' } })] });
    });
    // The sheet's own confirm button — by wrapper class, since the menu's
    // same-named opener may still be unmounting behind it (the actions-sheet
    // suite's Release idiom).
    await waitFor(() => expect(document.querySelector('.archive-conflict-sheet .btn-primary')).not.toBeNull());
    fireEvent.click(document.querySelector('.archive-conflict-sheet .btn-primary')!);
````

<!-- replay: T10 replace pwa/test/typed-label.test.tsx -->
In `pwa/test/typed-label.test.tsx`, find:

````tsx
    onStopSession: () => {}, onOpenHistory: () => {}, onReapWorkspace: () => {},
````

Replace with:

````tsx
    onArchive: () => {}, onRestore: () => {}, onOpenHistory: () => {}, onReapWorkspace: () => {},
````

<!-- replay: T10 replace pwa/test/lifecycle-ui.test.tsx old-inline new-inline -->
In `pwa/test/lifecycle-ui.test.tsx`, find:

````tsx
  it('stop asks for confirmation and fires api.stop only on confirm', () => {
    const stop = vi.spyOn(api, 'stop').mockResolvedValue(undefined);
    renderScreen();

    // Cancel path: the consequence sheet closes without stopping anything.
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: /Stop session/ }));
    expect(
      screen.getByText(
        'The session goes offline until you start it again. Its conversation is kept.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(stop).not.toHaveBeenCalled();

    // Confirm path.
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: /Stop session/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop session' }));
    expect(stop).toHaveBeenCalledWith('claude:OpenClawHetzner');
  });
````

Replace with:

````tsx
  // Workspace lifecycle §5.2: the header's "Stop session" is now "Archive", one feature for both kinds of row — the
  // confirm reads by case, and the header never stops a session on its own any more.
  it('archive asks for confirmation in the case\'s words and fires api.archive only on confirm — never api.stop', async () => {
    const archive = vi.spyOn(api, 'archive').mockResolvedValue(null);
    const stop = vi.spyOn(api, 'stop').mockResolvedValue(undefined);
    renderScreen();

    // Cancel path: the sheet closes without archiving anything.
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(screen.getByText(
      'It goes offline and folds into Archived. Restore starts it again. It is never deleted.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(archive).not.toHaveBeenCalled();

    // Confirm path.
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(document.querySelector('.archive-conflict-sheet .btn-primary')!);
    await waitFor(() => expect(archive).toHaveBeenCalledWith(fleetSession().id, {}));
    expect(stop).not.toHaveBeenCalled();
  });

  it.each([
    ['a stopped main checkout is ENSURED — the stop stamp clears and its own registry fields respawn it', 'ensure',
      { status: 'dead', bucket: 'dead', stoppedBy: { at: Date.now() - MIN, surface: 'pwa' } }],
    ['an archived workspace is RESTORED', 'restore',
      { workspace: 'quiet-basin', status: 'dead', archivedAt: 1785300000, bucket: 'archived', bucketSince: 1785300000_000 }],
  ] as const)('Restore in the menu of a session already put away: %s', async (_label, verb, patch) => {
    const ensure = vi.spyOn(api, 'ensure').mockResolvedValue(undefined);
    const restore = vi.spyOn(api, 'restore').mockResolvedValue(undefined);
    const { fleet } = renderScreen();
    act(() => { fleet.setState({ sessions: [fleetSession(patch as Partial<FleetSession>)] }); });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    const [called, other] = verb === 'ensure' ? [ensure, restore] : [restore, ensure];
    await waitFor(() => expect(called).toHaveBeenCalledWith(fleetSession().id));
    expect(other).not.toHaveBeenCalled();
  });
````

- [ ] **Step 2: Run them to verify they fail.**

Run: `( cd pwa && ./node_modules/.bin/vitest run test/header.test.tsx test/lifecycle-ui.test.tsx test/typed-label.test.tsx )`
Expected: `7 failed | 93 passed (100)` — the four header cases (no `Archive` item, no `Restore`), and the three `lifecycle-ui` cases (the confirm, and Restore ensuring a main checkout and restoring a workspace). The keycap cases stay green.

- [ ] **Step 3: Replace the menu item and its confirm.**

<!-- replay: T10 replace pwa/src/session/SessionHeader.tsx old-inline new-inline -->
In `pwa/src/session/SessionHeader.tsx`, find:

````tsx
// `⋯` opens the lifecycle overflow menu (change model / move account /
// stop), and `esc` interrupts
````

Replace with:

````tsx
// `⋯` opens the lifecycle overflow menu (change model / move account /
// archive), and `esc` interrupts
````

<!-- replay: T10 replace pwa/src/session/SessionHeader.tsx -->
In `pwa/src/session/SessionHeader.tsx`, find:

````tsx
import { TypedLabel } from '../fleet/TypedLabel';
````

Replace with:

````tsx
import { TypedLabel } from '../fleet/TypedLabel';
import { isPutAway } from '../fleet/ArchiveSheet';
````

<!-- replay: T10 replace pwa/src/session/SessionHeader.tsx -->
In `pwa/src/session/SessionHeader.tsx`, find:

````tsx
  /** Overflow menu: "Stop session" — opens the stop QuickConfirm. */
  onStopSession: () => void;
````

Replace with:

````tsx
  /** Overflow menu: "Archive" — opens the one archive sheet (workspace lifecycle §5.2). It replaced "Stop session":
   *  stop and archive are one user feature, and the `esc` keycap below (interrupt) is a different control. */
  onArchive: () => void;
  /** Overflow menu: "Restore" — in place of Archive on a session already put away (`isPutAway`). */
  onRestore: () => void;
````

<!-- replay: T10 replace pwa/src/session/SessionHeader.tsx old-inline new-inline -->
In `pwa/src/session/SessionHeader.tsx`, find:

````tsx
  onMoveAccount,
  onStopSession,
  onOpenHistory,
````

Replace with:

````tsx
  onMoveAccount,
  onArchive,
  onRestore,
  onOpenHistory,
````

<!-- replay: T10 replace pwa/src/session/SessionHeader.tsx old-inline new-inline -->
In `pwa/src/session/SessionHeader.tsx`, find:

````tsx
  // Menu taps close the sheet first so the follow-up surface (swap sheet,
  // stop confirm, arriving model dialog) never fights it for the bottom edge.
````

Replace with:

````tsx
  // Menu taps close the sheet first so the follow-up surface (swap sheet,
  // archive sheet, arriving model dialog) never fights it for the bottom edge.
````

<!-- replay: T10 replace pwa/src/session/SessionHeader.tsx -->
In `pwa/src/session/SessionHeader.tsx`, find:

````tsx
          <button
            type="button"
            className="menu-item menu-item--danger"
            disabled={fault !== null}
            title={faultTitle}
            onClick={() => menuAct(onStopSession)}
          >
            <span className="menu-label">Stop session</span>
          </button>
````

Replace with:

````tsx
          {/* Archive for every session, Restore for one already put away (workspace lifecycle §5.2) — never both.
              Archive is gated like Move above: it ends the pane. It needs the row to choose its words, so a deep
              link that has not seen its first frame yet offers it disabled. */}
          {session !== null && isPutAway(session) ? (
            <button type="button" className="menu-item" onClick={() => menuAct(onRestore)}>
              <span className="menu-label">Restore</span>
            </button>
          ) : (
            <button
              type="button"
              className="menu-item menu-item--danger"
              disabled={fault !== null || session === null}
              title={faultTitle}
              onClick={() => menuAct(onArchive)}
            >
              <span className="menu-label">Archive</span>
            </button>
          )}
````

<!-- replay: T10 replace pwa/src/screens/SessionScreen.tsx -->
In `pwa/src/screens/SessionScreen.tsx`, find:

````tsx
import { QuickConfirm } from '../components/QuickConfirm';
````

Replace with:

````tsx
````

<!-- replay: T10 replace pwa/src/screens/SessionScreen.tsx -->
In `pwa/src/screens/SessionScreen.tsx`, find:

````tsx
import { SwapSheet } from '../fleet/SwapSheet';
````

Replace with:

````tsx
import { SwapSheet } from '../fleet/SwapSheet';
import { ArchiveSheet, restoreSession } from '../fleet/ArchiveSheet';
````

<!-- replay: T10 replace pwa/src/screens/SessionScreen.tsx -->
In `pwa/src/screens/SessionScreen.tsx`, find:

````tsx
  const [stopOpen, setStopOpen] = useState(false);
````

Replace with:

````tsx
  const [archiveOpen, setArchiveOpen] = useState(false);
````

<!-- replay: T10 replace pwa/src/screens/SessionScreen.tsx old-inline new-inline -->
In `pwa/src/screens/SessionScreen.tsx`, find:

````tsx
  // dead banner's Restart and the stop confirm — refuse rather than fire at a
````

Replace with:

````tsx
  // dead banner's Restart and the archive sheet (which re-reads it as it fires) — refuse rather than fire at a
````

<!-- replay: T10 replace pwa/src/screens/SessionScreen.tsx -->
In `pwa/src/screens/SessionScreen.tsx`, find:

````tsx
  const stopSession = async (): Promise<void> => {
    // The gate's confirm-path half. The header's Stop menu item is already
    // disabled under a fault, but the fleet frame updates LIVE beneath an
    // open confirm and QuickConfirm owns its own button — so the fault is
    // re-checked at the moment of firing, and the refusal is named (the same
    // one string) rather than swallowed. Guarded on `faultTitle`, the one
    // composition site, so TS ties the toast to the check without a second
    // copy of the template.
    if (faultTitle !== undefined) {
      toast(faultTitle, 'error');
      return;
    }
    try {
      await api.stop(id);
    } catch (err) {
      toast(`Couldn't stop the session — ${apiErrorText(err)}`, 'error');
    }
  };
````

Replace with:

````tsx
  // The header's Restore, for a session already put away (workspace lifecycle §5.2): a workspace is restored, a main
  // checkout ensured (`restoreSession`). The header's "Stop session", its confirm and `stopSession` are gone: stop and
  // archive are one feature, and its sheet re-checks the substrate fault at the moment it fires.
  const restoreNow = async (): Promise<void> => {
    if (live === null) return;
    try {
      await restoreSession(live);
    } catch (err) {
      toast(`Couldn't restore — ${apiErrorText(err)}`, 'error');
    }
  };
````

<!-- replay: T10 replace pwa/src/screens/SessionScreen.tsx -->
In `pwa/src/screens/SessionScreen.tsx`, find:

````tsx
        onStopSession={() => setStopOpen(true)}
````

Replace with:

````tsx
        onArchive={() => setArchiveOpen(true)}
        onRestore={() => void restoreNow()}
````

<!-- replay: T10 replace pwa/src/screens/SessionScreen.tsx -->
In `pwa/src/screens/SessionScreen.tsx`, find:

````tsx
      <QuickConfirm
        open={stopOpen}
        onClose={() => setStopOpen(false)}
        title="Stop this session?"
        consequence="The session goes offline until you start it again. Its conversation is kept."
        confirmLabel="Stop session"
        onConfirm={() => void stopSession()}
      />
````

Replace with:

````tsx
      {/* The one Archive (workspace lifecycle §5.2). No `onStopOnly`: "Stop only" survives in the actions sheet alone. */}
      <ArchiveSheet session={live} open={archiveOpen} onClose={() => setArchiveOpen(false)} fleet={useFleet} />
````

<!-- replay: T10 replace pwa/src/components/QuickConfirm.tsx old-inline new-inline -->
In `pwa/src/components/QuickConfirm.tsx`, find:

````tsx
// QuickConfirm — the confirm-with-consequence-sentence sheet used by stop and
// move-account flows.
````

Replace with:

````tsx
// QuickConfirm — the confirm-with-consequence-sentence sheet used by the
// release, forget and move-account flows.
````

- [ ] **Step 4: Run them and the typecheck.**

```bash
( cd pwa && ./node_modules/.bin/vitest run test/header.test.tsx test/lifecycle-ui.test.tsx test/typed-label.test.tsx test/primitives.test.tsx )
( cd pwa && ./node_modules/.bin/tsc --noEmit -p . )
```

Expected: `100 passed (100)` in the first three files, `primitives` green; no output from `tsc`.

- [ ] **Step 5: Commit.**

```bash
git add -u pwa/src/session/SessionHeader.tsx pwa/src/screens/SessionScreen.tsx pwa/src/components/QuickConfirm.tsx pwa/test/header.test.tsx pwa/test/lifecycle-ui.test.tsx pwa/test/typed-label.test.tsx
git commit -m "pwa: the header's Stop session becomes Archive, and Restore on a put-away session (workspace lifecycle W2)"
```

### Task 11: The board — the Archived fold takes stopped main checkouts

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `pwa/src/fleet/groupFleet.ts` (an import; the `archived` docstring; the split; the newest-first sort; the "where its work went" loop)
- Modify: `pwa/src/screens/FleetScreen.tsx` (the bucket-bar comment says what the chips and the fold now count — no code)
- Modify: `pwa/test/groupFleet.test.ts` (the new describe; the older `makes the fold the same set the Archived chip counts` case's title and comment now say it holds while no main checkout is stopped), `pwa/test/fleet-screen.test.tsx`

**Interfaces:**
- Consumes: `inArchivedFold`, `archivedFoldSince` (Task 1). `FleetGroup.archived` keeps its type; its membership widens to every stopped main checkout, newest first.

- [ ] **Step 1: Write the failing tests.**

<!-- replay: T11 replace pwa/test/groupFleet.test.ts -->
In `pwa/test/groupFleet.test.ts`, find:

````ts
  // And the counts the two surfaces render therefore agree: the fold's own
  // `Archived (n)` is exactly the `Archived` chip's members, never the union.
  it('makes the fold the same set the Archived chip counts', () => {
````

Replace with:

````ts
  // And the counts the two surfaces render therefore agree for workspaces: the
  // fold's own `Archived (n)` is exactly the `Archived` chip's members while no
  // main checkout is stopped. Workspace lifecycle §5.2 adds stopped main
  // checkouts to the fold, which the Dead chip still counts (below).
  it('makes the fold the same set the Archived chip counts when no main checkout is stopped (workspace lifecycle §5.2 adds those)', () => {
````

<!-- replay: T11 replace pwa/test/groupFleet.test.ts old-inline new-inline -->
In `pwa/test/groupFleet.test.ts`, find:

````ts

// The `unseen` doc named two readers of `isUnseen` that do not exist
````

Replace with:

````ts

describe('the Archived fold takes stopped main checkouts (workspace lifecycle spec §5.2)', () => {
  const STOP = (at: number) => ({ at, surface: 'pwa' as const });
  const main = (id: string, over: Partial<FleetSession> = {}): FleetSession =>
    s({ id, project: 'demo', workspace: null, status: 'dead', bucket: 'dead', ...over });
  const ws = (id: string, over: Partial<FleetSession> = {}): FleetSession =>
    s({ id, project: 'demo', workspace: id, ...over });

  it('folds a STOPPED main checkout into Archived, out of the live list', () => {
    const [g] = groupFleet([ws('demo-a'), main('claude2-demo', { stoppedBy: STOP(5) })], []);
    expect(g!.sessions.map((x) => x.id)).toEqual(['demo-a']);
    expect(g!.archived.map((x) => x.id)).toEqual(['claude2-demo']);
  });

  it.each([
    ['a main checkout started again — the stop stamp is gone', main('claude2-demo', { status: 'idle', bucket: 'idle' })],
    ['a crashed main checkout — dead, never stopped', main('claude2-demo')],
    ['a stopped workspace that is not archived — it offers Archive again', ws('demo-b', {
      status: 'dead', bucket: 'dead', stoppedBy: STOP(5) })],
    ['a merged-and-archived workspace — `cleanup` stays in its chip\'s list',
      ws('demo-b', { status: 'dead', archivedAt: 1785300000, bucket: 'cleanup' })],
  ] as const)('keeps %s at the top level', (_label, row) => {
    const [g] = groupFleet([row], []);
    expect(g!.sessions.map((x) => x.id)).toEqual([row.id]);
    expect(g!.archived).toEqual([]);
  });

  it('runs newest first — a workspace by its archive time, a main checkout by its stop', () => {
    const [g] = groupFleet([
      ws('demo-old', { status: 'dead', archivedAt: 1, bucket: 'archived', bucketSince: 100 }),
      main('claude2-demo', { stoppedBy: STOP(300) }),
      ws('demo-mid', { status: 'dead', archivedAt: 2, bucket: 'archived', bucketSince: 200 }),
    ], []);
    expect(g!.archived.map((x) => x.id)).toEqual(['claude2-demo', 'demo-mid', 'demo-old']);
  });

  it('a released workspace once archived is in Archived, never in both folds', () => {
    const released = { runId: 4, program: 'lifecycle', programTitle: null, claimedBy: 'demo-c', closedAt: 9, child: false };
    const [g] = groupFleet([ws('demo-r', { status: 'dead', archivedAt: 1, bucket: 'archived', bucketSince: 10,
      releasedFrom: released })], []);
    expect(g!.archived.map((x) => x.id)).toEqual(['demo-r']);
    expect(g!.released).toEqual([]);
  });

  it('a stopped main checkout placed on another card is not "where its work went" — that list is live rows only', () => {
    const g = groupFleet([ws('demo-live', { boardProject: 'intake' }),
      main('claude2-demo', { boardProject: 'intake', stoppedBy: STOP(5) })], []);
    expect(g.find((x) => x.project === 'demo')!.elsewhere).toEqual([{ project: 'intake', count: 1 }]);
    expect(g.find((x) => x.project === 'intake')!.archived.map((x) => x.id)).toEqual(['claude2-demo']);
  });

  it('the fold may hold a row the Dead chip counts — stated, not changed', () => {
    const fleet = [ws('demo-b', { status: 'dead', archivedAt: 1, bucket: 'archived' }), main('claude2-demo', { stoppedBy: STOP(5) })];
    const [g] = groupFleet(fleet, []);
    expect(g!.archived).toHaveLength(2);
    // What the chips count is the fleet screen's to pin, not this fixture's: `fleet-screen.test.tsx`'s
    // "a STOPPED main checkout sits behind the Archived fold while the Dead chip still counts it".
  });
});

// The `unseen` doc named two readers of `isUnseen` that do not exist
````

<!-- replay: T11 replace pwa/test/fleet-screen.test.tsx old-inline new-inline -->
In `pwa/test/fleet-screen.test.tsx`, find:

````tsx
  it('does not put a third, larger count under the same noun', () => {
````

Replace with:

````tsx
  it('a STOPPED main checkout sits behind the Archived fold while the Dead chip still counts it (workspace lifecycle §5.2)', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, { conn: 'open', sessions: [plain(), session({
      id: 'claude-P', project: 'P', workspace: null, status: 'dead', bucket: 'dead',
      stoppedBy: { at: 1785300000_000, surface: 'pwa' },
    })] });
    const deadChip = screen.getByText('Dead').closest('.bucket-head') as HTMLElement;
    expect(deadChip.querySelector('.bucket-head-count')).toHaveTextContent('1');
    const archivedChip = screen.getByText('Archived').closest('.bucket-head') as HTMLElement;
    expect(archivedChip.querySelector('.bucket-head-count')).toHaveTextContent('1');
    // The fold holds both — the archived workspace and the stopped main checkout.
    expect(screen.getByRole('button', { name: /^archived \(2\)$/i })).toBeInTheDocument();
    // …and the footer stays the WORKSPACE archive list (`archivedAt`): a main checkout has none, so it counts one.
    expect(screen.getByRole('button', { name: /^archived on disk · 1 · /i })).toBeInTheDocument();
  });

  it('does not put a third, larger count under the same noun', () => {
````

- [ ] **Step 2: Run them to verify they fail.**

Run: `( cd pwa && ./node_modules/.bin/vitest run test/groupFleet.test.ts test/fleet-screen.test.tsx )`
Expected: `5 failed | 152 passed (157)` — `folds a STOPPED main checkout` (`expected [ 'demo-a', 'claude2-demo' ] to deeply equal [ 'demo-a' ]`), `runs newest first`, `the fold may hold a row the Dead chip counts`, `a stopped main checkout placed on another card is not "where its work went"` (`count: 2` for 1), and the screen's `sits behind the Archived fold while the Dead chip still counts it`. The four `keeps … at the top level` cases, `a released workspace once archived is in Archived` and the renamed `makes the fold the same set the Archived chip counts when no main checkout is stopped` pass before and after.

- [ ] **Step 3: Split on the one predicate.**

<!-- replay: T11 replace pwa/src/fleet/groupFleet.ts -->
In `pwa/src/fleet/groupFleet.ts`, find:

````ts
import { boardHome, releasedFromOf, type FleetSession, type ReleasedFrom } from '../../../shared/api';
````

Replace with:

````ts
import { boardHome, releasedFromOf, type FleetSession, type ReleasedFrom } from '../../../shared/api';
import { archivedFoldSince, inArchivedFold } from '../../../shared/api';
````

<!-- replay: T11 replace pwa/src/fleet/groupFleet.ts old-inline new-inline -->
In `pwa/src/fleet/groupFleet.ts`, find:

````ts
  /** Members in the `archived` BUCKET — folded out of the live list, never
   *  dropped.
````

Replace with:

````ts
  /** Members in the `Archived (N)` fold — `inArchivedFold` (workspace lifecycle
   *  spec §5.2): the `archived` BUCKET, plus a STOPPED main checkout, which
   *  archiving now puts away too (it is never deleted). Newest first, on
   *  `archivedFoldSince`. Folded out of the live list, never
   *  dropped.
````

<!-- replay: T11 replace pwa/src/fleet/groupFleet.ts old-inline new-inline -->
In `pwa/src/fleet/groupFleet.ts`, find:

````ts
   *  The fleet footer (`FleetScreen`'s route into `/archive`) is a THIRD,
   *  deliberately wider set — everything with an `archivedAt`, because that
   *  is the disk fact — which is why it no longer says the bare word
   *  "Archived". */
  archived: FleetSession[];
````

Replace with:

````ts
   *  The fleet footer (`FleetScreen`'s route into `/archive`) is a THIRD,
   *  deliberately wider set — everything with an `archivedAt`, because that
   *  is the disk fact — which is why it no longer says the bare word
   *  "Archived".
   *
   *  The stopped main checkout is the one member a DIFFERENT chip counts: its
   *  bucket is still `dead` (M10 — a lifecycle moves no bucket), so the Dead
   *  chip counts a row this fold holds. Stated, not changed (spec §5.2); and
   *  the footer stays a WORKSPACE list, since a main checkout has no
   *  `archivedAt`. */
  archived: FleetSession[];
````

<!-- replay: T11 replace pwa/src/fleet/groupFleet.ts old-inline new-inline -->
In `pwa/src/fleet/groupFleet.ts`, find:

````ts
    // See the `archived` field's doc: the split is on the BUCKET, so a
    // `cleanup` member stays in the live list its own chip counts it in.
    const live = members.filter((m) => m.bucket !== 'archived' && !inReleasedFold(m));
    const archived = members.filter((m) => m.bucket === 'archived');
````

Replace with:

````ts
    // See the `archived` field's doc: the split is `inArchivedFold`, which reads a WORKSPACE's bucket, so a
    // `cleanup` member stays in the live list its own chip counts it in.
    const live = members.filter((m) => !inArchivedFold(m) && !inReleasedFold(m));
    // Workspace lifecycle §5.2: newest first — a workspace by its archive time, a main checkout by its stop.
    const archived = members.filter(inArchivedFold)
      .sort((a, b) => (archivedFoldSince(b) ?? 0) - (archivedFoldSince(a) ?? 0) || a.id.localeCompare(b.id));
````

<!-- replay: T11 replace pwa/src/fleet/groupFleet.ts old-inline new-inline -->
In `pwa/src/fleet/groupFleet.ts`, find:

````ts
      if (s.project !== project || s.bucket === 'archived') continue;
````

Replace with:

````ts
      if (s.project !== project || inArchivedFold(s)) continue;
````

<!-- replay: T11 replace pwa/src/screens/FleetScreen.tsx old-inline new-inline -->
In `pwa/src/screens/FleetScreen.tsx`, find:

````tsx
              of ROWS the cards hold for that bucket. `groupFleet` splits its
              per-project fold on `bucket === 'archived'` for exactly this
              reason: on the `archivedAt` split, a merged workspace counted
````

Replace with:

````tsx
              of ROWS the cards hold for that bucket. `groupFleet` splits its
              per-project fold on `inArchivedFold` — the `archived` bucket, and
              (workspace lifecycle §5.2) a stopped main checkout — and never on
              `archivedAt`, for exactly this
              reason: on the `archivedAt` split, a merged workspace counted
````

<!-- replay: T11 replace pwa/src/screens/FleetScreen.tsx old-inline new-inline -->
In `pwa/src/screens/FleetScreen.tsx`, find:

````tsx
              Two folds hold rows a chip counts. `Archived (n)` states its
              chip's identical count. `Released (n)` (workspace lifecycle
````

Replace with:

````tsx
              Two folds hold rows a chip counts. `Archived (n)` holds its
              chip's members and every STOPPED main checkout, whose bucket is
              still `dead` (M10), so the Dead chip counts a row that fold holds
              — stated, not changed (spec §5.2). `Released (n)` (workspace lifecycle
````

- [ ] **Step 4: Run them, the card and the release fold's suites, and the typecheck.**

```bash
( cd pwa && ./node_modules/.bin/vitest run test/groupFleet.test.ts test/fleet-screen.test.tsx test/project-card.test.tsx test/archiveReleased.test.ts test/archive-screen.test.tsx )
( cd pwa && ./node_modules/.bin/tsc --noEmit -p . )
```

Expected: `157 passed (157)` in the first two files, the other three green; no output from `tsc`.

- [ ] **Step 5: Commit.**

```bash
git add -u pwa/src/fleet/groupFleet.ts pwa/src/screens/FleetScreen.tsx pwa/test/groupFleet.test.ts pwa/test/fleet-screen.test.tsx
git commit -m "pwa: the Archived fold takes stopped main checkouts, newest first (workspace lifecycle W2)"
```

### Task 12: README, CCR-15's §5.9 sentence, and CLAUDE.md's README size claim

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `README.md` (one paragraph, after the `Released (N)` paragraph wave 1 added)
- Modify: `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` (§5.9's "No child ever appears in the reap or archive sheets" — workspace lifecycle §6 item 3 amends it "when this spec's wave lands", wave 1 did not, and with this wave every session, a child included, offers Archive, so the sentence is false on merge)
- Modify: `CLAUDE.md` (the README size claim, `~3600` → `~3700`)

- [ ] **Step 1: Add the operator paragraph, and amend CCR-15's sentence.** The paragraph inserts 24 lines between two paragraphs; the README-reading suites (Pre-flight finding 14) are green with it, and the census cites no README line by number. The CCR-15 design's sentence grows by one line; nothing cites that file by line (`git grep 'reclamation-design.md:[0-9]'` is empty), and `citetax.py` checks its own citations into `shared/api.ts`, which this wave leaves where they were.

<!-- replay: T12 replace README.md -->
In `README.md`, find:

````markdown
project's card, since board placement lasts while the workspace is held.
````

Replace with:

````markdown
project's card, since board placement lasts while the workspace is held.

**One Archive** (workspace lifecycle spec §5.2). Stop and archive are one feature. Every session's menu and its
actions sheet offer **Archive**, and a session already put away offers **Restore** in its place. The confirm reads by
case: an idle workspace goes offline and folds into Archived; a busy session asks first, because the turn in progress
is lost; a main checkout is stopped and folds into Archived, and is never deleted; a coordinator with open runs offers
only **End programme and archive** or **Cancel**, since pausing a programme is the coordinator pause switch.
`POST /api/sessions/:id/archive` runs every check it can make before anything it cannot undo: a turn in progress
(`409 session-busy` unless `{interrupt:true}`; a main checkout's, whose stop refuses nothing, is read fail-closed —
tmux unreachable or no readable live file is busy — and read again at the stop), a worktree it can prove gone, a run
naming the workspace as its worker (`409 run-open` unless `{force:true}`), a run it coordinates
(`409 coordinator-has-open-runs`, naming them, unless `{programme:'end'}`), a store it cannot read (refused,
fail-shut), and a run the abandon cannot move (one already `closing`: `409 programme-partly-ended`, nothing ended).
Then it ends the programme through the abandon door's own decision, stops (a main checkout, or with `interrupt`) and
archives (a workspace). An abandon that still refuses at the act stops the door there, naming what it ended, with
nothing stopped or archived. What only `ccd` can measure — its status read, the archive manifest and, in remote mode,
the worktree itself — refuses inside `ws-archive`, before it touches anything, so such a refusal can follow a
programme the door already ended; the answer then names those runs (`ended`). A stop followed by a refused archive
answers `200 {archived:false, stopped:true, refusal}`, and the row stays visible with Archive offered again. After a
refusal the phone cannot fix (the worktree is gone, the status unreadable, the manifest unbuildable, the coordination
store unreadable) the actions sheet offers **Stop only**. Restore is `ws-restore` for a workspace and `ensure` for a
main checkout. `Archived (N)` holds archived workspaces and stopped main checkouts
(`inArchivedFold`), newest first; the Dead chip still counts a stopped main checkout, and the footer's archive list is
still workspaces only. `ccd stop` and `POST /api/sessions/:id/stop` are unchanged. The refusal codes are
`ARCHIVE_REFUSALS`, declared once in `shared/api.ts`.
````

<!-- replay: T12 replace docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md -->
In `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`, find:

````markdown
**No child ever appears in the reap or archive sheets.** Both are gated on a workspace being archived, which
a child never is.
````

Replace with:

````markdown
**No child appears in the reap or archive sheets unless a person archived it by hand.** Every session offers
Archive (workspace lifecycle §5.2), so a child can be archived like any workspace; "Archive all" skips children
(workspace lifecycle §5.1, §6 item 3).
````

- [ ] **Step 2: Run the size pin and the citation census to see the red.**

Run: `( cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus|README size claim' )`
Expected, on a base whose claim still reads `~3600`: `1 failed | 7 passed | 354 skipped (362)` — `keeps CLAUDE.md's README size claim within 100 lines of the real file`: `CLAUDE.md says 3600 lines, README.md is 3711 — re-measure it in this commit`. If another wave already re-measured the claim (worker stall watch wave 2's README section adds about 107 lines, which reds `~3600` on its own, so that wave must rewrite it first if it lands first), the size case may be green here: `8 passed | 354 skipped (362)`. Either way the seven citation cases are green: the paragraph moves no cited anchor.

- [ ] **Step 3: Re-measure the claim.** First `wc -l README.md` and `` grep -o 'README.md` (~[0-9]* lines)' CLAUDE.md ``. If Step 2's `README size claim` case was already green (another wave re-measured the claim), skip the block below and say so in the PR. Otherwise replace whatever `~N` CLAUDE.md states with the hundred nearest the count. The block below is the case measured here: a base stating `~3600`, with a README of 3650–3749 lines (3711 on `aefc8415`, 3724 with #215 landed first).

<!-- replay: T12 replace CLAUDE.md old-inline new-inline -->
In `CLAUDE.md`, find:

````markdown
**`README.md` (~3600 lines) is the canonical system overview.
````

Replace with:

````markdown
**`README.md` (~3700 lines) is the canonical system overview.
````

- [ ] **Step 4: Run them again.**

Same command as Step 2. Expected: `8 passed | 354 skipped (362)`.

- [ ] **Step 5: Commit.**

```bash
git add -u README.md CLAUDE.md docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md
git commit -m "docs: README's one-Archive paragraph; CCR-15's no-child sentence amended; CLAUDE.md's README size re-measured (workspace lifecycle W2)"
```

### Task 13: The whole branch — the mutation table, the suites, the census, the merge, the PR

**Model routing:** `sonnet`, effort `high`; the PR body is the worker's, the review is the review run's.

- [ ] **Step 1: The mutation table.** Write the runner to `<SCRATCH>/mutate.py` (never committed). It copies each file a row touches aside (never `git checkout --`, which restores to HEAD and eats uncommitted work), applies the row's exact replacement — and, for a row with `also`, each further site with it (row S42c, the control that mutates two guards together) — runs the named files from the row's package, restores and asserts byte-equality:

````python
#!/usr/bin/env python3
"""Mutation runner for workspace-lifecycle wave 2 (wave 1's runner, plus a package per row). Run from the tree root.

usage: mutate.py <rows.json> [ID ...]
rows.json: [{"id": "S1", "pkg": "server"|"pwa", "file": "rel/path", "old": "...", "new": "...", "tests": [...],
             "also": [{"file": ..., "old": ..., "new": ...}]}]   (`also`: optional, more sites mutated WITH the row)
Each row: copy every file it touches ASIDE (never `git checkout --`), replace exactly one occurrence of each `old` with
its `new` (a row any of whose `old` texts is absent or not unique is SKIPPED and says so, touching nothing), run vitest
on the named files from `pkg`, print the totals and the failing titles, restore every copy, and assert byte-equality
after the restore."""
import json, os, re, shutil, subprocess, sys

ROOT = os.getcwd()
spec = json.load(open(sys.argv[1]))
only = sys.argv[2:]
order = [r for r in spec if not only or r['id'] in only]
for row in order:
    sites = [{'file': row['file'], 'old': row['old'], 'new': row['new']}, *row.get('also', [])]
    files = sorted({s['file'] for s in sites})
    origs = {f: open(os.path.join(ROOT, f), 'rb').read() for f in files}
    backups = {}
    for i, f in enumerate(files):
        backups[f] = os.path.join(os.path.dirname(os.path.abspath(sys.argv[1])), f"mutbak-{row['id']}-{i}")
        shutil.copy2(os.path.join(ROOT, f), backups[f])
    try:
        texts = {f: origs[f].decode('utf8') for f in files}
        bad = [(s['file'], texts[s['file']].count(s['old'])) for s in sites if texts[s['file']].count(s['old']) != 1]
        if bad:
            print(f"== {row['id']}: SKIPPED — " + '; '.join(f'`old` occurs {n} times in {f}' for f, n in bad), flush=True)
            continue
        for s in sites:
            texts[s['file']] = texts[s['file']].replace(s['old'], s['new'], 1)
        for f in files:
            open(os.path.join(ROOT, f), 'w', encoding='utf8').write(texts[f])
        r = subprocess.run(['timeout', '570', './node_modules/.bin/vitest', 'run', '--maxWorkers=3', *row['tests']],
                           cwd=os.path.join(ROOT, row.get('pkg', 'server')), capture_output=True, text=True,
                           stdin=subprocess.DEVNULL)
        out = re.sub(r'\x1b\[[0-9;]*m', '', r.stdout + r.stderr)
        fails = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL ')]
        tot = [l.strip() for l in out.splitlines() if re.match(r'^\s*Tests\s', l)]
        where = row['file'] + (f" (+{len(sites) - 1} more site{'s' if len(sites) > 2 else ''})" if len(sites) > 1 else '')
        print(f"== {row['id']}: {where}  rc={r.returncode}  {tot[-1] if tot else 'NO TOTALS — read the output'}", flush=True)
        for f in fails[:4]:
            print('   ', f[:220], flush=True)
    finally:
        for f in files:
            shutil.copy2(backups[f], os.path.join(ROOT, f))
            os.remove(backups[f])
            assert open(os.path.join(ROOT, f), 'rb').read() == origs[f], f'{f} was not restored byte-for-byte'
print('all restored')
````

Write the rows below to `<SCRATCH>/rows.json`. First run every row's test files UNMUTATED and confirm them green — a row whose files are red with no mutation applied proves nothing:

```bash
( cd server && CCD_DISK_FLOOR_GB=1 ./node_modules/.bin/vitest run test/archive-wire.test.ts test/single-definition.test.ts test/archive-store.test.ts test/archive-coord-handle.test.ts test/coord-abandon.test.ts test/archive-door.test.ts test/child-reclaim-close.test.ts test/archive-door-decide.test.ts test/archive-ccd-words.test.ts test/lifecycle.test.ts test/routes.test.ts test/box-token-census.test.ts )
( cd pwa && ./node_modules/.bin/vitest run test/archive-conflict-sheet.test.tsx test/pr-sheet.test.tsx test/api.test.ts test/archive-partial.test.ts test/archive-sheet.test.tsx test/session-actions-sheet.test.tsx test/lifecycle-ui.test.tsx test/header.test.tsx test/groupFleet.test.ts test/fleet-screen.test.tsx )
```

Expected: `575 passed (575)` and `506 passed (506)`. Then, from the worktree root, run the rows in batches that fit one Bash call (each measured under ten minutes at load 20 to 60; the PWA rows are slower). The third batch carries `CCD_DISK_FLOOR_GB=1` because six of its rows run `archive-ccd-words.test.ts`, which mints workspaces with `ws-add`: on a disk under `ccd`'s 10G floor they would red for the floor, not the mutation:

```bash
python3 <SCRATCH>/mutate.py <SCRATCH>/rows.json S1 S2 S3 S4 S5 S6 S7 S8 S9 S10 S11 S12 S13 S14
python3 <SCRATCH>/mutate.py <SCRATCH>/rows.json S15 S16 S17 S48 S18 S19 S20 S21 S22 S23 S24 S49 S25
CCD_DISK_FLOOR_GB=1 python3 <SCRATCH>/mutate.py <SCRATCH>/rows.json S26 S27 S50 S51 S52 S28 S29 S30 S31 S32 S53 S54 S33
python3 <SCRATCH>/mutate.py <SCRATCH>/rows.json S34 S35 S36 S37 S38 S39 S40 S41 S46 S47 S55 S56
python3 <SCRATCH>/mutate.py <SCRATCH>/rows.json S57 S58 S59 S42 S42c S43 S44 S45
python3 <SCRATCH>/mutate.py <SCRATCH>/rows.json P1 P2 P3 P4 P5 P6 P7 P32 P8 P9
python3 <SCRATCH>/mutate.py <SCRATCH>/rows.json P10 P11 P12 P33 P34 P35 P36 P37 P38 P13 P14 P15 P16
python3 <SCRATCH>/mutate.py <SCRATCH>/rows.json P17 P18 P19 P20 P21 P22 P23 P24 P25
python3 <SCRATCH>/mutate.py <SCRATCH>/rows.json P26 P27 P28 P29 P30 P31
```

Every row but S42 must print a non-zero `rc` and a `failed` count (S42c, its control, included); `all restored` must end each batch; `git status --short` must show nothing afterwards. A row that prints `SKIPPED` means its `old` text is not in your tree exactly once: find out why before going on. A row that stays GREEN (other than S42) is a guard nothing pins: stop and report it with the row id.

````json
[
 {
  "id": "S1",
  "task": 1,
  "pkg": "server",
  "file": "shared/api.ts",
  "old": " || (s.workspace === null && s.status === 'dead' && (s.stoppedBy ?? null) !== null)",
  "new": "",
  "tests": [
   "test/archive-wire.test.ts"
  ],
  "what": "inArchivedFold's main-checkout arm dropped"
 },
 {
  "id": "S2",
  "task": 1,
  "pkg": "server",
  "file": "shared/api.ts",
  "old": "(s.workspace === null && s.status === 'dead' && (s.stoppedBy ?? null) !== null)",
  "new": "(s.workspace === null && (s.stoppedBy ?? null) !== null)",
  "tests": [
   "test/archive-wire.test.ts"
  ],
  "what": "inArchivedFold's `status === 'dead'` conjunct dropped"
 },
 {
  "id": "S3",
  "task": 1,
  "pkg": "server",
  "file": "shared/api.ts",
  "old": "(s.workspace === null && s.status === 'dead' && (s.stoppedBy ?? null) !== null)",
  "new": "(s.workspace === null && s.status === 'dead')",
  "tests": [
   "test/archive-wire.test.ts"
  ],
  "what": "inArchivedFold's stop-stamp conjunct dropped"
 },
 {
  "id": "S4",
  "task": 1,
  "pkg": "server",
  "file": "shared/api.ts",
  "old": "(s.workspace === null && s.status === 'dead' && (s.stoppedBy ?? null) !== null)",
  "new": "(s.status === 'dead' && (s.stoppedBy ?? null) !== null)",
  "tests": [
   "test/archive-wire.test.ts"
  ],
  "what": "inArchivedFold's `workspace === null` dropped (a stopped workspace folds)"
 },
 {
  "id": "S5",
  "task": 1,
  "pkg": "server",
  "file": "shared/api.ts",
  "old": "return s.status === 'busy' || s.bucket === 'working' || s.bucket === 'attention';",
  "new": "return s.bucket === 'working' || s.bucket === 'attention';",
  "tests": [
   "test/archive-wire.test.ts"
  ],
  "what": "archiveInterrupts ignores the live file's `busy`"
 },
 {
  "id": "S6",
  "task": 1,
  "pkg": "server",
  "file": "shared/api.ts",
  "old": "return s.status === 'busy' || s.bucket === 'working' || s.bucket === 'attention';",
  "new": "return s.status === 'busy' || s.bucket === 'working';",
  "tests": [
   "test/archive-wire.test.ts"
  ],
  "what": "archiveInterrupts ignores a question waiting on the operator"
 },
 {
  "id": "S7",
  "task": 1,
  "pkg": "server",
  "file": "shared/api.ts",
  "old": "  if (s.bucket === 'archived') return s.bucketSince;\n",
  "new": "",
  "tests": [
   "test/archive-wire.test.ts"
  ],
  "what": "archivedFoldSince reads the stop stamp for an archived workspace"
 },
 {
  "id": "S8",
  "task": 1,
  "pkg": "server",
  "file": "shared/api.ts",
  "old": "  ARCHIVE_REFUSALS.worktreeGone, ARCHIVE_REFUSALS.statusUnknown, ARCHIVE_REFUSALS.manifestUnbuildable,\n];",
  "new": "  ARCHIVE_REFUSALS.worktreeGone, ARCHIVE_REFUSALS.statusUnknown, ARCHIVE_REFUSALS.manifestUnbuildable,\n  ARCHIVE_REFUSALS.runOpen,\n];",
  "tests": [
   "test/archive-wire.test.ts"
  ],
  "what": "a fixable refusal (`run-open`) joins the Stop-only three"
 },
 {
  "id": "S9",
  "task": 1,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "if (!worker.ok) return refuse(409, ARCHIVE_REFUSALS.runOpen, { runs: [] });",
  "new": "if (!worker.ok) return refuse(409, 'run-open', { runs: [] });",
  "tests": [
   "test/single-definition.test.ts"
  ],
  "what": "a second spelling of `run-open` on a server code line"
 },
 {
  "id": "S10",
  "task": 1,
  "pkg": "server",
  "file": "pwa/src/fleet/ArchiveConflictSheet.tsx",
  "old": ".error !== ARCHIVE_REFUSALS.runOpen) return null;",
  "new": ".error !== 'run-open') return null;",
  "tests": [
   "test/single-definition.test.ts"
  ],
  "what": "the PWA's run-open reader spells the code again"
 },
 {
  "id": "S11",
  "task": 1,
  "pkg": "server",
  "file": "shared/api.ts",
  "old": "  runOpen: 'run-open',\n",
  "new": "  runOpen: 'run-open',\n  sessionGone: 'session-gone',\n",
  "tests": [
   "test/single-definition.test.ts",
   "test/archive-wire.test.ts"
  ],
  "what": "a code added to the declaration that the scan's data does not hold"
 },
 {
  "id": "S12",
  "task": 2,
  "pkg": "server",
  "file": "server/src/coord/store.ts",
  "old": "`WHERE claimedBy = ? AND state NOT IN ${TERMINAL_RUN_STATES_SQL} ORDER BY id`,",
  "new": "`WHERE sessionId = ? AND state NOT IN ${TERMINAL_RUN_STATES_SQL} ORDER BY id`,",
  "tests": [
   "test/archive-store.test.ts"
  ],
  "what": "openRunsClaimedBy keys on the worker column"
 },
 {
  "id": "S13",
  "task": 2,
  "pkg": "server",
  "file": "server/src/coord/store.ts",
  "old": "`WHERE claimedBy = ? AND state NOT IN ${TERMINAL_RUN_STATES_SQL} ORDER BY id`,",
  "new": "`WHERE claimedBy = ? ORDER BY id`,",
  "tests": [
   "test/archive-store.test.ts"
  ],
  "what": "openRunsClaimedBy counts terminal runs"
 },
 {
  "id": "S14",
  "task": 2,
  "pkg": "server",
  "file": "server/src/coord/store.ts",
  "old": "    ).all(claimantId) as unknown as\n      { idText: string; program: string; waveText: string; waveOfText: string | null; reviewsText: string | null }[];\n    const runs: OpenSibling[] = [];\n    for (const r of rows) {\n      const m = measureRunNumbers(r);\n      if (!m.ok) return { ok: false, kind: 'run-unreadable', detail: m.detail };",
  "new": "    ).all(claimantId) as unknown as\n      { idText: string; program: string; waveText: string; waveOfText: string | null; reviewsText: string | null }[];\n    const runs: OpenSibling[] = [];\n    for (const r of rows) {\n      const m = measureRunNumbers(r);\n      if (!m.ok) continue;",
  "tests": [
   "test/archive-store.test.ts"
  ],
  "what": "an unrepresentable row skipped \u2014 a partial list"
 },
 {
  "id": "S15",
  "task": 3,
  "pkg": "server",
  "file": "server/src/coord/routes.ts",
  "old": "= (coord, fn) => coordMutex.run(() => fn((runId) => closeRun(",
  "new": "= (coord, fn) => ((f: () => Promise<never>) => f())(() => fn((runId) => closeRun(",
  "tests": [
   "test/archive-coord-handle.test.ts"
  ],
  "what": "withAbandon outside the coordination mutex"
 },
 {
  "id": "S16",
  "task": 3,
  "pkg": "server",
  "file": "server/src/coord/routes.ts",
  "old": "    runId, { intent: 'abandon' }, 'operator'), (runId) =>",
  "new": "    runId, { intent: 'abandon' }, 'coordinator'), (runId) =>",
  "tests": [
   "test/archive-coord-handle.test.ts",
   "test/coord-abandon.test.ts"
  ],
  "what": "the abandon attributed to the coordinator"
 },
 {
  "id": "S17",
  "task": 3,
  "pkg": "server",
  "file": "server/src/coord/routes.ts",
  "old": "    { coord, io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd, fleetState: deps.fleetState,\n      childReclaim: childReclaimPort(deps, coord) },\n    runId, { intent: 'abandon' }, 'operator'), (runId) =>",
  "new": "    { coord, io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd, fleetState: deps.fleetState },\n    runId, { intent: 'abandon' }, 'operator'), (runId) =>",
  "tests": [
   "test/archive-door.test.ts",
   "test/child-reclaim-close.test.ts"
  ],
  "what": "the childReclaim port not wired into the handle's abandon"
 },
 {
  "id": "S48",
  "task": 3,
  "pkg": "server",
  "file": "server/src/coord/routes.ts",
  "old": "'operator'), (runId) => abandonRefusal(coord, runId)));",
  "new": "'operator'), () => null));",
  "tests": [
   "test/archive-coord-handle.test.ts",
   "test/archive-door.test.ts"
  ],
  "what": "the handle hands over no pre-read (every run reads as movable)"
 },
 {
  "id": "S18",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "  if (m.busy && !flags.interrupt) return refuse(409, ARCHIVE_REFUSALS.sessionBusy);\n",
  "new": "",
  "tests": [
   "test/archive-door-decide.test.ts"
  ],
  "what": "the busy refusal deleted"
 },
 {
  "id": "S19",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "  if (m.busy && !flags.interrupt) return",
  "new": "  if (m.busy) return",
  "tests": [
   "test/archive-door-decide.test.ts"
  ],
  "what": "`interrupt` no longer answers busy"
 },
 {
  "id": "S20",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "  if (m.workspace && m.worktree === 'absent') return refuse(409, ARCHIVE_REFUSALS.worktreeGone);\n",
  "new": "",
  "tests": [
   "test/archive-door-decide.test.ts"
  ],
  "what": "a proven-gone worktree no longer refuses"
 },
 {
  "id": "S21",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "  if (m.workspace && m.worktree === 'absent') return",
  "new": "  if (m.workspace && m.worktree !== 'present') return",
  "tests": [
   "test/archive-door-decide.test.ts",
   "test/archive-door.test.ts"
  ],
  "what": "an UNMEASURED worktree refuses (every remote-mode archive would)"
 },
 {
  "id": "S22",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "    if (!flags.force) {\n",
  "new": "    if (true) {\n",
  "tests": [
   "test/archive-door-decide.test.ts"
  ],
  "what": "`force` no longer bypasses run-open"
 },
 {
  "id": "S23",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "      if (worker.siblings.length > 0) return refuse(409, ARCHIVE_REFUSALS.runOpen, { runs: worker.siblings });\n",
  "new": "",
  "tests": [
   "test/archive-door-decide.test.ts"
  ],
  "what": "the run-open refusal deleted"
 },
 {
  "id": "S24",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "    if (claimed.length > 0 && !flags.programmeEnd) {",
  "new": "    if (claimed.length > 0 && false) {",
  "tests": [
   "test/archive-door-decide.test.ts"
  ],
  "what": "a programme ended without `programme:'end'`"
 },
 {
  "id": "S49",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "  try { return read(); } catch (e) { return { ok: false, kind: 'run-unreadable', detail: thrown(e) }; }",
  "new": "  return read();",
  "tests": [
   "test/archive-door-decide.test.ts",
   "test/archive-door.test.ts"
  ],
  "what": "a store read that throws leaves as a rejection (a 500), not the fail-shut refusal"
 },
 {
  "id": "S25",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "    if (!coordinates.ok) return refuse(409, ARCHIVE_REFUSALS.coordinatorHasOpenRuns, { runs: [] });\n    claimed = coordinates.siblings;",
  "new": "    claimed = coordinates.ok ? coordinates.siblings : [];",
  "tests": [
   "test/archive-door-decide.test.ts",
   "test/archive-door.test.ts"
  ],
  "what": "an unreadable store archives (fail-open)"
 },
 {
  "id": "S26",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "  if (m.workspace && !m.verbSupported) return refuse(501, 'unsupported');\n",
  "new": "",
  "tests": [
   "test/archive-door-decide.test.ts"
  ],
  "what": "the verb gate deleted"
 },
 {
  "id": "S27",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "    if (!out.ok) {\n      return refuse(409, ARCHIVE_REFUSALS.programmePartlyEnded,",
  "new": "    if (!out.ok) {\n      if (false) return refuse(409, ARCHIVE_REFUSALS.programmePartlyEnded,",
  "tests": [
   "test/archive-door-decide.test.ts",
   "test/archive-door.test.ts"
  ],
  "what": "a refused abandon no longer stops the door"
 },
 {
  "id": "S50",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "    if (why !== null) {\n",
  "new": "    if (false) {\n",
  "tests": [
   "test/archive-door-decide.test.ts",
   "test/archive-door.test.ts"
  ],
  "what": "a run the abandon arm cannot move is no longer found before the first is ended"
 },
 {
  "id": "S51",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "    try { why = port!.abandonRefusal(run.id); } catch (e) {\n      return refuse(",
  "new": "    try { why = port!.abandonRefusal(run.id); } catch (e) {\n      throw e; return refuse(",
  "tests": [
   "test/archive-door-decide.test.ts"
  ],
  "what": "a pre-read that throws leaves as a rejection"
 },
 {
  "id": "S52",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "    try { out = await port!.abandon(run.id); } catch (e) {\n      return refuse(",
  "new": "    try { out = await port!.abandon(run.id); } catch (e) {\n      throw e; return refuse(",
  "tests": [
   "test/archive-door-decide.test.ts"
  ],
  "what": "an abandon that throws after another run was ended leaves as a rejection that names nothing"
 },
 {
  "id": "S28",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "  return { ok: true, stop: flags.interrupt || !m.workspace, wsArchive: m.workspace, ended };",
  "new": "  return { ok: true, stop: flags.interrupt, wsArchive: m.workspace, ended };",
  "tests": [
   "test/archive-door-decide.test.ts",
   "test/archive-door.test.ts"
  ],
  "what": "a main checkout is not stopped"
 },
 {
  "id": "S29",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "  return { ok: true, stop: flags.interrupt || !m.workspace, wsArchive: m.workspace, ended };",
  "new": "  return { ok: true, stop: flags.interrupt || !m.workspace, wsArchive: true, ended };",
  "tests": [
   "test/archive-door-decide.test.ts"
  ],
  "what": "the decision sends a main checkout to ws-archive"
 },
 {
  "id": "S30",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "  if (lines.includes('ccd: session-busy')) return ARCHIVE_REFUSALS.sessionBusy;\n",
  "new": "",
  "tests": [
   "test/archive-door-decide.test.ts",
   "test/archive-ccd-words.test.ts"
  ],
  "what": "ccd's session-busy (the race) loses its word"
 },
 {
  "id": "S31",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "  if (lines.some((l) => l.startsWith('ccd: worktree is gone: '))) return ARCHIVE_REFUSALS.worktreeGone;\n",
  "new": "",
  "tests": [
   "test/archive-door-decide.test.ts",
   "test/archive-ccd-words.test.ts"
  ],
  "what": "ccd's worktree-gone loses its word"
 },
 {
  "id": "S32",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "  if (lines.some((l) => /^ccd: (cannot describe",
  "new": "  if (lines.some((l) => /^ccd: (cannot-describe",
  "tests": [
   "test/archive-door-decide.test.ts",
   "test/archive-ccd-words.test.ts"
  ],
  "what": "ccd's manifest refusals lose their word"
 },
 {
  "id": "S53",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "|empty archive manifest for \\S+",
  "new": "",
  "tests": [
   "test/archive-ccd-words.test.ts"
  ],
  "what": "ccd's empty-manifest refusal loses its word"
 },
 {
  "id": "S54",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "|archive manifest for \\S+ is not valid JSON",
  "new": "",
  "tests": [
   "test/archive-ccd-words.test.ts"
  ],
  "what": "ccd's invalid-JSON manifest refusal loses its word"
 },
 {
  "id": "S33",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "  if (lines.includes('ccd: status-unknown')) return ARCHIVE_REFUSALS.statusUnknown;\n",
  "new": "",
  "tests": [
   "test/archive-ccd-words.test.ts"
  ],
  "what": "ccd's status-unknown loses its word"
 },
 {
  "id": "S34",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "  if (stopped) return { status: 200, body: { ok: true, archived: false, stopped: true, ended, refusal, detail } };\n",
  "new": "",
  "tests": [
   "test/archive-door-decide.test.ts",
   "test/archive-door.test.ts"
  ],
  "what": "the partial outcome answered as a plain refusal"
 },
 {
  "id": "S35",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "  const endedSpread = ended.length > 0 ? { ended } : {};",
  "new": "  const endedSpread = {};",
  "tests": [
   "test/archive-door-decide.test.ts",
   "test/archive-door.test.ts"
  ],
  "what": "a refusal after a programme end no longer names the ended runs"
 },
 {
  "id": "S36",
  "task": 4,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "  if (b.programme !== undefined && b.programme !== 'end') return null;\n",
  "new": "",
  "tests": [
   "test/archive-door-decide.test.ts",
   "test/archive-door.test.ts"
  ],
  "what": "a programme word other than `end` accepted"
 },
 {
  "id": "S37",
  "task": 5,
  "pkg": "server",
  "file": "server/src/server.ts",
  "old": "(live) => live === null || archiveInterrupts(live)),",
  "new": "(live) => live === null || live.status === 'busy'),",
  "tests": [
   "test/archive-door.test.ts"
  ],
  "what": "a workspace's busy read from the live file alone (the hook and the pane ignored)"
 },
 {
  "id": "S38",
  "task": 5,
  "pkg": "server",
  "file": "server/src/server.ts",
  "old": "new Map(hs === null ? [] : [[rec.id, hs]]), [rec]);",
  "new": "undefined, [rec]);",
  "tests": [
   "test/archive-door.test.ts"
  ],
  "what": "the hook state not re-read on the request"
 },
 {
  "id": "S39",
  "task": 5,
  "pkg": "server",
  "file": "server/src/server.ts",
  "old": "      worktree: rec.workspace === null ? 'present' : worktreeOf(await deps.io.statMeasured(rec.workdir)),",
  "new": "      worktree: 'present',",
  "tests": [
   "test/archive-door.test.ts"
  ],
  "what": "the worktree not measured"
 },
 {
  "id": "S40",
  "task": 5,
  "pkg": "server",
  "file": "server/src/server.ts",
  "old": "    if (plan.stop) {\n",
  "new": "    if (false) {\n",
  "tests": [
   "test/archive-door.test.ts",
   "test/lifecycle.test.ts"
  ],
  "what": "the stop the decision asked for not run"
 },
 {
  "id": "S41",
  "task": 5,
  "pkg": "server",
  "file": "server/src/server.ts",
  "old": "      if (!res.ok) return reply.code(502).send({ ok: false, stderr: res.stderr, ...endedSpread });",
  "new": "      if (!res.ok) return reply.code(502).send({ ok: false, stderr: res.stderr });",
  "tests": [
   "test/archive-door.test.ts"
  ],
  "what": "a failed stop after a programme end hides the end"
 },
 {
  "id": "S46",
  "task": 5,
  "pkg": "server",
  "file": "server/src/server.ts",
  "old": "    const [row] = await assembleFleet(deps.io, deps.cfg, deps.tmux, undefined, watcher?.currentPending(),",
  "new": "    const [row] = await assembleFleet(deps.io, deps.cfg, deps.tmux, undefined, undefined,",
  "tests": [
   "test/archive-door.test.ts"
  ],
  "what": "the watcher's pane dialogs not read (a dialog waiting on the operator reads idle)"
 },
 {
  "id": "S47",
  "task": 5,
  "pkg": "server",
  "file": "server/src/server.ts",
  "old": "    const identity = measuredIdentity(read.record);\n    if (identity === null) return reply.code(503).send({ ok: false, error: 'registry-unmeasurable' });\n",
  "new": "    const identity = measuredIdentity(read.record)!;\n",
  "tests": [
   "test/routes.test.ts"
  ],
  "what": "an unmeasured registry row is archived on a guess (no 503)"
 },
 {
  "id": "S55",
  "task": 5,
  "pkg": "server",
  "file": "server/src/server.ts",
  "old": "      if (!flags.interrupt && !(await idleForStop(rec, identity.uuid))) {",
  "new": "      if (false) {",
  "tests": [
   "test/archive-door.test.ts"
  ],
  "what": "a main checkout's stop no longer re-reads busy at the act"
 },
 {
  "id": "S56",
  "task": 5,
  "pkg": "server",
  "file": "server/src/server.ts",
  "old": "    if (v.verdict === 'gone') return true;",
  "new": "    if (v.verdict !== 'live') return true;",
  "tests": [
   "test/archive-door.test.ts"
  ],
  "what": "tmux `unknown` read as no pane (idle) for a main checkout"
 },
 {
  "id": "S57",
  "task": 5,
  "pkg": "server",
  "file": "server/src/server.ts",
  "old": "    if (pid === null || cfgDir === undefined) return false;",
  "new": "    if (pid === null || cfgDir === undefined) return true;",
  "tests": [
   "test/archive-door.test.ts"
  ],
  "what": "an unread pane pid read as idle for a main checkout"
 },
 {
  "id": "S58",
  "task": 5,
  "pkg": "server",
  "file": "server/src/server.ts",
  "old": "    if (!read.ok || read.state.status !== 'idle') return false;",
  "new": "    if (read.ok && read.state.status === 'busy') return false;",
  "tests": [
   "test/archive-door.test.ts"
  ],
  "what": "a main checkout's live file read as a denylist (absent or unread reads idle)"
 },
 {
  "id": "S59",
  "task": 5,
  "pkg": "server",
  "file": "server/src/server.ts",
  "old": "        ? !(await idleForStop(rec, identity.uuid))\n",
  "new": "        ? false\n",
  "tests": [
   "test/archive-door.test.ts"
  ],
  "what": "a main checkout's busy not read before the claim checks (its programme ended first)"
 },
 {
  "id": "S42",
  "task": 5,
  "pkg": "server",
  "file": "server/src/server.ts",
  "old": "    const archiveArgv = rec.workspace === null ? null : CCD_ARGV.wsArchive(id, pwaDec(req));",
  "new": "    const archiveArgv = CCD_ARGV.wsArchive(id, pwaDec(req));",
  "tests": [
   "test/archive-door.test.ts",
   "test/lifecycle.test.ts"
  ],
  "what": "CONTROL for S29: the route's own main-checkout guard removed (the decision's `wsArchive` still holds)"
 },
 {
  "id": "S42c",
  "task": 5,
  "pkg": "server",
  "file": "server/src/coord/archiveDoor.ts",
  "old": "  return { ok: true, stop: flags.interrupt || !m.workspace, wsArchive: m.workspace, ended };",
  "new": "  return { ok: true, stop: flags.interrupt || !m.workspace, wsArchive: true, ended };",
  "tests": [
   "test/archive-door.test.ts",
   "test/lifecycle.test.ts"
  ],
  "what": "CONTROL for S42: S29 and S42 together \u2014 with both guards gone a main checkout reaches ws-archive",
  "also": [
   {
    "file": "server/src/server.ts",
    "old": "    const archiveArgv = rec.workspace === null ? null : CCD_ARGV.wsArchive(id, pwaDec(req));",
    "new": "    const archiveArgv = CCD_ARGV.wsArchive(id, pwaDec(req));"
   }
  ]
 },
 {
  "id": "S43",
  "task": 5,
  "pkg": "server",
  "file": "server/src/server.ts",
  "old": "    const plan = coord === undefined\n",
  "new": "    const plan = true\n",
  "tests": [
   "test/archive-door.test.ts"
  ],
  "what": "the route skips every coordination check on a box that has a store"
 },
 {
  "id": "S44",
  "task": 6,
  "pkg": "server",
  "file": "CLAUDE.md",
  "old": "  `POST /api/sessions/:id/archive` joins that class when its body carries `programme:'end'` (workspace lifecycle\n",
  "new": "  The archive door joins that class when its body carries `programme:'end'` (workspace lifecycle\n",
  "tests": [
   "test/box-token-census.test.ts"
  ],
  "what": "CLAUDE.md's bullet stops naming the archive route"
 },
 {
  "id": "S45",
  "task": 6,
  "pkg": "server",
  "file": "server/src/server.ts",
  "old": "    const flags = archiveFlags(req.body);\n",
  "new": "    if (checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]) !== 'ok') return reply.code(401).send({ ok: false });\n    const flags = archiveFlags(req.body);\n",
  "tests": [
   "test/box-token-census.test.ts"
  ],
  "what": "the archive route acquires a box-token gate"
 },
 {
  "id": "P1",
  "task": 1,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveConflictSheet.tsx",
  "old": ".error !== ARCHIVE_REFUSALS.runOpen) return null;",
  "new": ".error !== ARCHIVE_REFUSALS.sessionBusy) return null;",
  "tests": [
   "test/archive-conflict-sheet.test.tsx",
   "test/pr-sheet.test.tsx"
  ],
  "what": "the PR sheet's run-open reader keyed on another code"
 },
 {
  "id": "P2",
  "task": 7,
  "pkg": "pwa",
  "file": "pwa/src/lib/api.ts",
  "old": "  ...ARCHIVE_REFUSAL_TEXT,\n",
  "new": "",
  "tests": [
   "test/api.test.ts"
  ],
  "what": "the refusal sentences not spread into apiErrorText"
 },
 {
  "id": "P3",
  "task": 7,
  "pkg": "pwa",
  "file": "pwa/src/lib/api.ts",
  "old": "        ...(opts?.interrupt === true ? { interrupt: true as const } : {}),\n",
  "new": "",
  "tests": [
   "test/api.test.ts"
  ],
  "what": "`interrupt` never sent"
 },
 {
  "id": "P4",
  "task": 7,
  "pkg": "pwa",
  "file": "pwa/src/lib/api.ts",
  "old": "        ...(opts?.programme === 'end' ? { programme: 'end' as const } : {}),\n",
  "new": "",
  "tests": [
   "test/api.test.ts"
  ],
  "what": "`programme:'end'` never sent"
 },
 {
  "id": "P5",
  "task": 7,
  "pkg": "pwa",
  "file": "pwa/src/lib/api.ts",
  "old": "  if (a === null || typeof a !== 'object' || a.archived !== false) return null;",
  "new": "  if (a === null || typeof a !== 'object' || a.archived === true) return null;",
  "tests": [
   "test/archive-partial.test.ts"
  ],
  "what": "an older server's {ok:true} (no `archived`) read as a partial outcome"
 },
 {
  "id": "P6",
  "task": 7,
  "pkg": "pwa",
  "file": "pwa/src/lib/api.ts",
  "old": "  const refusal = isArchiveRefusal(a.refusal) ? a.refusal : null;",
  "new": "  const refusal = a.refusal ?? null;",
  "tests": [
   "test/archive-partial.test.ts"
  ],
  "what": "a refusal word this build does not know passed through"
 },
 {
  "id": "P7",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "        const partial = archivePartial(answer);\n",
  "new": "        const partial = answer !== null && answer.archived === false ? archivePartial(answer) : null;\n",
  "tests": [
   "test/archive-partial.test.ts"
  ],
  "what": "a second reader of `archived` in the sheet"
 },
 {
  "id": "P32",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "        const partial = archivePartial(answer);\n",
  "new": "        const partial = answer !== null && !answer.archived ? archivePartial(answer) : null;\n",
  "tests": [
   "test/archive-partial.test.ts"
  ],
  "what": "a second reader of `archived` in the sheet, spelled as a negation"
 },
 {
  "id": "P8",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "    setAsk(archiveInterrupts(session) ? { kind: 'busy' }\n      : claimed.length",
  "new": "    setAsk(false ? { kind: 'busy' }\n      : claimed.length",
  "tests": [
   "test/archive-sheet.test.tsx"
  ],
  "what": "the busy opening case dropped"
 },
 {
  "id": "P9",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "      : claimed.length > 0 ? { kind: 'programme', runs: claimed } : { kind: 'confirm' });",
  "new": "      : { kind: 'confirm' });",
  "tests": [
   "test/archive-sheet.test.tsx"
  ],
  "what": "a coordinator's open runs not asked about on open"
 },
 {
  "id": "P10",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "next: { ...consent, programme: true } };",
  "new": "next: { ...NO_CONSENT, programme: true } };",
  "tests": [
   "test/archive-sheet.test.tsx"
  ],
  "what": "an earlier consent dropped when the programme is ended"
 },
 {
  "id": "P11",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "  const stopOnly = onStopOnly !== undefined && stopOnlyClass;",
  "new": "  const stopOnly = stopOnlyClass;",
  "tests": [
   "test/archive-sheet.test.tsx"
  ],
  "what": "Stop only offered where the caller did not ask for it"
 },
 {
  "id": "P12",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "(ask.refusal !== null && ARCHIVE_STOP_ONLY.includes(ask.refusal))",
  "new": "ask.refusal === ARCHIVE_REFUSALS.worktreeGone",
  "tests": [
   "test/archive-sheet.test.tsx"
  ],
  "what": "Stop only keyed on one of the three alone"
 },
 {
  "id": "P33",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "    && (ask.unfixable === true || (ask.refusal !== null && ARCHIVE_STOP_ONLY.includes(ask.refusal))));",
  "new": "    && ask.refusal !== null && ARCHIVE_STOP_ONLY.includes(ask.refusal));",
  "tests": [
   "test/archive-sheet.test.tsx"
  ],
  "what": "an `unfixable` refusal (a store the server could not read, a `501 unsupported`) leaves no Stop only"
 },
 {
  "id": "P34",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "        {stopOnlyClass && !stopOnly && (\n",
  "new": "        {false && (\n",
  "tests": [
   "test/archive-sheet.test.tsx"
  ],
  "what": "a sheet without Stop only does not say where it is"
 },
 {
  "id": "P35",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "+ `Stopped, but not archived \u2014 ${why} Archive is still offered on its row.`, 'error');",
  "new": "+ `Stopped, but not archived \u2014 ${why}`, 'error');",
  "tests": [
   "test/archive-sheet.test.tsx"
  ],
  "what": "the toast no longer says Archive is still offered"
 },
 {
  "id": "P36",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "const endedFirst = [...ended, ...runsOf({ runs: answer?.ended })];",
  "new": "const endedFirst = [...runsOf({ runs: answer?.ended })];",
  "tests": [
   "test/archive-sheet.test.tsx"
  ],
  "what": "a programme ended on an earlier send dropped from a later partial outcome"
 },
 {
  "id": "P37",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "  const stopOnlyClass = ask.kind === 'partly' || (",
  "new": "  const stopOnlyClass = (",
  "tests": [
   "test/archive-sheet.test.tsx"
  ],
  "what": "a programme it could not end leaves no Stop only"
 },
 {
  "id": "P38",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "        if (err instanceof ApiError && err.status === 501) {",
  "new": "        if (false) {",
  "tests": [
   "test/archive-sheet.test.tsx"
  ],
  "what": "a box without ws-archive (`501 unsupported`) leaves no Stop only"
 },
 {
  "id": "P13",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "        if (partial !== null) {",
  "new": "        if (false) {",
  "tests": [
   "test/archive-sheet.test.tsx"
  ],
  "what": "a stopped-not-archived answer called archived"
 },
 {
  "id": "P14",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "    if (fault !== null) {\n      setError(",
  "new": "    if (false) {\n      setError(",
  "tests": [
   "test/archive-sheet.test.tsx"
  ],
  "what": "the substrate fault not re-read at send"
 },
 {
  "id": "P15",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "        {ended.length > 0 && (\n",
  "new": "        {false && (\n",
  "tests": [
   "test/archive-sheet.test.tsx"
  ],
  "what": "the programme-ended note dropped"
 },
 {
  "id": "P16",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "return setAsk(named.length > 0 ? { kind: 'programme', runs: named } :",
  "new": "return setAsk(true ? { kind: 'programme', runs: named } :",
  "tests": [
   "test/archive-sheet.test.tsx"
  ],
  "what": "an unreadable store offered as a programme to end"
 },
 {
  "id": "P17",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "            To pause a programme instead, use the coordinator pause switch on the Runs screen \u2014 archiving its\n",
  "new": "            Archiving its\n",
  "tests": [
   "test/archive-sheet.test.tsx"
  ],
  "what": "the pause-switch sentence dropped"
 },
 {
  "id": "P18",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "primary = { label: 'Archive anyway', next: { ...consent, interrupt: true } };",
  "new": "primary = { label: 'Archive anyway', next: { ...consent } };",
  "tests": [
   "test/archive-sheet.test.tsx"
  ],
  "what": "the busy confirm sends no `interrupt`"
 },
 {
  "id": "P19",
  "task": 8,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveConflictSheet.tsx",
  "old": "  if (err.status === 409 && isArchiveRefusal(code)) return ARCHIVE_REFUSAL_TEXT[code];\n",
  "new": "",
  "tests": [
   "test/archive-conflict-sheet.test.tsx"
  ],
  "what": "the conflict sheet shows a typed refusal as an unknown reason"
 },
 {
  "id": "P20",
  "task": 9,
  "pkg": "pwa",
  "file": "pwa/src/fleet/SessionActionsSheet.tsx",
  "old": "  const putAway = isPutAway(session);",
  "new": "  const putAway = session.archivedAt !== null;",
  "tests": [
   "test/session-actions-sheet.test.tsx"
  ],
  "what": "the Restore gate keyed on `archivedAt` alone"
 },
 {
  "id": "P21",
  "task": 9,
  "pkg": "pwa",
  "file": "pwa/src/fleet/SessionActionsSheet.tsx",
  "old": "          {!putAway && (",
  "new": "          {!putAway && session.workspace !== null && (",
  "tests": [
   "test/session-actions-sheet.test.tsx"
  ],
  "what": "Archive offered to workspaces only"
 },
 {
  "id": "P22",
  "task": 9,
  "pkg": "pwa",
  "file": "pwa/src/fleet/SessionActionsSheet.tsx",
  "old": "        onStopOnly={stopOnly}\n",
  "new": "",
  "tests": [
   "test/session-actions-sheet.test.tsx"
  ],
  "what": "the actions sheet does not pass Stop only"
 },
 {
  "id": "P23",
  "task": 9,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "  s.workspace !== null ? api.restore(s.id) : api.ensure(s.id);",
  "new": "  api.restore(s.id);",
  "tests": [
   "test/session-actions-sheet.test.tsx",
   "test/lifecycle-ui.test.tsx"
  ],
  "what": "a main checkout restored (ws-restore) instead of ensured"
 },
 {
  "id": "P24",
  "task": 9,
  "pkg": "pwa",
  "file": "pwa/src/fleet/ArchiveSheet.tsx",
  "old": "inArchivedFold(s) || s.bucket === 'cleanup';",
  "new": "inArchivedFold(s);",
  "tests": [
   "test/session-actions-sheet.test.tsx"
  ],
  "what": "a merged-and-archived row loses Restore"
 },
 {
  "id": "P25",
  "task": 10,
  "pkg": "pwa",
  "file": "pwa/src/session/SessionHeader.tsx",
  "old": "              disabled={fault !== null || session === null}",
  "new": "              disabled={session === null}",
  "tests": [
   "test/header.test.tsx"
  ],
  "what": "the header's Archive not gated on the substrate fault"
 },
 {
  "id": "P26",
  "task": 10,
  "pkg": "pwa",
  "file": "pwa/src/session/SessionHeader.tsx",
  "old": "          {session !== null && isPutAway(session) ? (",
  "new": "          {false ? (",
  "tests": [
   "test/header.test.tsx",
   "test/lifecycle-ui.test.tsx"
  ],
  "what": "the header never offers Restore"
 },
 {
  "id": "P27",
  "task": 10,
  "pkg": "pwa",
  "file": "pwa/src/screens/SessionScreen.tsx",
  "old": "      await restoreSession(live);",
  "new": "      await api.restore(live.id);",
  "tests": [
   "test/lifecycle-ui.test.tsx"
  ],
  "what": "the session screen restores a main checkout with ws-restore"
 },
 {
  "id": "P28",
  "task": 11,
  "pkg": "pwa",
  "file": "pwa/src/fleet/groupFleet.ts",
  "old": "    const live = members.filter((m) => !inArchivedFold(m) && !inReleasedFold(m));",
  "new": "    const live = members.filter((m) => m.bucket !== 'archived' && !inReleasedFold(m));",
  "tests": [
   "test/groupFleet.test.ts",
   "test/fleet-screen.test.tsx"
  ],
  "what": "the live list split back on the bucket"
 },
 {
  "id": "P29",
  "task": 11,
  "pkg": "pwa",
  "file": "pwa/src/fleet/groupFleet.ts",
  "old": "    const archived = members.filter(inArchivedFold)\n",
  "new": "    const archived = members.filter((m) => m.bucket === 'archived')\n",
  "tests": [
   "test/groupFleet.test.ts",
   "test/fleet-screen.test.tsx"
  ],
  "what": "the fold split back on the bucket"
 },
 {
  "id": "P30",
  "task": 11,
  "pkg": "pwa",
  "file": "pwa/src/fleet/groupFleet.ts",
  "old": "      .sort((a, b) => (archivedFoldSince(b) ?? 0) - (archivedFoldSince(a) ?? 0) || a.id.localeCompare(b.id));",
  "new": ";",
  "tests": [
   "test/groupFleet.test.ts"
  ],
  "what": "the fold not sorted newest first"
 },
 {
  "id": "P31",
  "task": 11,
  "pkg": "pwa",
  "file": "pwa/src/fleet/groupFleet.ts",
  "old": "      if (s.project !== project || inArchivedFold(s)) continue;",
  "new": "      if (s.project !== project || s.bucket === 'archived') continue;",
  "tests": [
   "test/groupFleet.test.ts"
  ],
  "what": "a stopped main checkout counted where a card's work went"
 }
]
````

Measured on the prototype (each row's own files; `rc=1` on every row but S42). The rows keep their ids from the planning round that first measured them; the review round added S46–S59, S42c and P32–P36, each placed beside the task it guards, and re-aimed P12 (Pre-flight finding 13 (g)); the verification round added P37 and P38, and moved P33's and P34's `old` onto the lines it rewrote:

| Row | Task | Guard mutated | Measured |
|---|---|---|---|
| S1 | 1 | inArchivedFold's main-checkout arm dropped | 1 failed \| 20 passed (21) |
| S2 | 1 | inArchivedFold's `status === 'dead'` conjunct dropped | 1 failed \| 20 passed (21) |
| S3 | 1 | inArchivedFold's stop-stamp conjunct dropped | 2 failed \| 19 passed (21) |
| S4 | 1 | inArchivedFold's `workspace === null` dropped (a stopped workspace folds) | 2 failed \| 19 passed (21) |
| S5 | 1 | archiveInterrupts ignores the live file's `busy` | 1 failed \| 20 passed (21) |
| S6 | 1 | archiveInterrupts ignores a question waiting on the operator | 1 failed \| 20 passed (21) |
| S7 | 1 | archivedFoldSince reads the stop stamp for an archived workspace | 1 failed \| 20 passed (21) |
| S8 | 1 | a fixable refusal (`run-open`) joins the Stop-only three | 1 failed \| 20 passed (21) |
| S9 | 1 | a second spelling of `run-open` on a server code line | 1 failed \| 259 passed (260) |
| S10 | 1 | the PWA's run-open reader spells the code again | 1 failed \| 259 passed (260) |
| S11 | 1 | a code added to the declaration that the scan's data does not hold | 2 failed \| 279 passed (281) |
| S12 | 2 | openRunsClaimedBy keys on the worker column | 4 failed (4) |
| S13 | 2 | openRunsClaimedBy counts terminal runs | 1 failed \| 3 passed (4) |
| S14 | 2 | an unrepresentable row skipped — a partial list | 1 failed \| 3 passed (4) |
| S15 | 3 | withAbandon outside the coordination mutex | 1 failed \| 3 passed (4) |
| S16 | 3 | the abandon attributed to the coordinator | 2 failed \| 32 passed (34) |
| S17 | 3 | the childReclaim port not wired into the handle's abandon | 1 failed \| 56 passed (57) |
| S48 | 3 | the handle hands over no pre-read (every run reads as movable) | 2 failed \| 34 passed (36) |
| S18 | 4 | the busy refusal deleted | 2 failed \| 36 passed (38) |
| S19 | 4 | `interrupt` no longer answers busy | 1 failed \| 37 passed (38) |
| S20 | 4 | a proven-gone worktree no longer refuses | 1 failed \| 37 passed (38) |
| S21 | 4 | an UNMEASURED worktree refuses (every remote-mode archive would) | 3 failed \| 67 passed (70) |
| S22 | 4 | `force` no longer bypasses run-open | 2 failed \| 36 passed (38) |
| S23 | 4 | the run-open refusal deleted | 2 failed \| 36 passed (38) |
| S24 | 4 | a programme ended without `programme:'end'` | 1 failed \| 37 passed (38) |
| S49 | 4 | a store read that throws leaves as a rejection (a 500), not the fail-shut refusal | 2 failed \| 68 passed (70) |
| S25 | 4 | an unreadable store archives (fail-open) | 4 failed \| 66 passed (70) |
| S26 | 4 | the verb gate deleted | 1 failed \| 37 passed (38) |
| S27 | 4 | a refused abandon no longer stops the door | 2 failed \| 68 passed (70) |
| S50 | 4 | a run the abandon arm cannot move is no longer found before the first is ended | 2 failed \| 68 passed (70) |
| S51 | 4 | a pre-read that throws leaves as a rejection | 1 failed \| 37 passed (38) |
| S52 | 4 | an abandon that throws after another run was ended leaves as a rejection that names nothing | 1 failed \| 37 passed (38) |
| S28 | 4 | a main checkout is not stopped | 6 failed \| 64 passed (70) |
| S29 | 4 | the decision sends a main checkout to ws-archive | 1 failed \| 37 passed (38) |
| S30 | 4 | ccd's session-busy (the race) loses its word | 3 failed \| 42 passed (45) |
| S31 | 4 | ccd's worktree-gone loses its word | 2 failed \| 43 passed (45) |
| S32 | 4 | ccd's manifest refusals lose their word | 2 failed \| 43 passed (45) |
| S53 | 4 | ccd's empty-manifest refusal loses its word | 1 failed \| 6 passed (7) |
| S54 | 4 | ccd's invalid-JSON manifest refusal loses its word | 1 failed \| 6 passed (7) |
| S33 | 4 | ccd's status-unknown loses its word | 1 failed \| 6 passed (7) |
| S34 | 4 | the partial outcome answered as a plain refusal | 2 failed \| 68 passed (70) |
| S35 | 4 | a refusal after a programme end no longer names the ended runs | 2 failed \| 68 passed (70) |
| S36 | 4 | a programme word other than `end` accepted | 2 failed \| 68 passed (70) |
| S37 | 5 | a workspace's busy read from the live file alone (the hook and the pane ignored) | 2 failed \| 30 passed (32) |
| S38 | 5 | the hook state not re-read on the request | 1 failed \| 31 passed (32) |
| S39 | 5 | the worktree not measured | 2 failed \| 30 passed (32) |
| S40 | 5 | the stop the decision asked for not run | 9 failed \| 74 passed (83) |
| S41 | 5 | a failed stop after a programme end hides the end | 1 failed \| 31 passed (32) |
| S46 | 5 | the watcher's pane dialogs not read (a dialog waiting on the operator reads idle) | 1 failed \| 31 passed (32) |
| S47 | 5 | an unmeasured registry row is archived on a guess (no 503) | 1 failed \| 79 passed (80) |
| S55 | 5 | a main checkout's stop no longer re-reads busy at the act | 1 failed \| 31 passed (32) |
| S56 | 5 | tmux `unknown` read as no pane (idle) for a main checkout | 1 failed \| 31 passed (32) |
| S57 | 5 | an unread pane pid read as idle for a main checkout | 1 failed \| 31 passed (32) |
| S58 | 5 | a main checkout's live file read as a denylist (absent or unread reads idle) | 1 failed \| 31 passed (32) |
| S59 | 5 | a main checkout's busy not read before the claim checks (its programme ended first) | 1 failed \| 31 passed (32) |
| S42 | 5 | CONTROL for S29: the route's own main-checkout guard removed (the decision's `wsArchive` still holds) | 83 passed (83) — GREEN by construction: the CONTROL for S29 (Pre-flight finding 13 (d)); S42c, both sites together, is red |
| S42c | 5 | CONTROL for S42: S29 and S42 together — with both guards gone a main checkout reaches ws-archive | 3 failed \| 80 passed (83) |
| S43 | 5 | the route skips every coordination check on a box that has a store | 12 failed \| 20 passed (32) |
| S44 | 6 | CLAUDE.md's bullet stops naming the archive route | 1 failed \| 22 passed (23) |
| S45 | 6 | the archive route acquires a box-token gate | 6 failed \| 17 passed (23) |
| P1 | 1 | the PR sheet's run-open reader keyed on another code | 7 failed \| 69 passed (76) |
| P2 | 7 | the refusal sentences not spread into apiErrorText | 1 failed \| 100 passed (101) |
| P3 | 7 | `interrupt` never sent | 2 failed \| 99 passed (101) |
| P4 | 7 | `programme:'end'` never sent | 2 failed \| 99 passed (101) |
| P5 | 7 | an older server's {ok:true} (no `archived`) read as a partial outcome | 1 failed \| 3 passed (4) |
| P6 | 7 | a refusal word this build does not know passed through | 1 failed \| 3 passed (4) |
| P7 | 8 | a second reader of `archived` in the sheet | 1 failed \| 3 passed (4) |
| P32 | 8 | a second reader of `archived` in the sheet, spelled as a negation | 1 failed \| 3 passed (4) |
| P8 | 8 | the busy opening case dropped | 4 failed \| 19 passed (23) |
| P9 | 8 | a coordinator's open runs not asked about on open | 5 failed \| 18 passed (23) |
| P10 | 8 | an earlier consent dropped when the programme is ended | 1 failed \| 22 passed (23) |
| P11 | 8 | Stop only offered where the caller did not ask for it | 2 failed \| 21 passed (23) |
| P12 | 8 | Stop only keyed on one of the three alone | 2 failed \| 21 passed (23) |
| P33 | 8 | an `unfixable` refusal (a store the server could not read, a `501 unsupported`) leaves no Stop only | 3 failed \| 20 passed (23) |
| P34 | 8 | a sheet without Stop only does not say where it is | 2 failed \| 21 passed (23) |
| P35 | 8 | the toast no longer says Archive is still offered | 1 failed \| 22 passed (23) |
| P36 | 8 | a programme ended on an earlier send dropped from a later partial outcome | 1 failed \| 22 passed (23) |
| P37 | 8 | a programme it could not end leaves no Stop only | 1 failed \| 22 passed (23) |
| P38 | 8 | a box without ws-archive (`501 unsupported`) leaves no Stop only | 1 failed \| 22 passed (23) |
| P13 | 8 | a stopped-not-archived answer called archived | 3 failed \| 20 passed (23) |
| P14 | 8 | the substrate fault not re-read at send | 1 failed \| 22 passed (23) |
| P15 | 8 | the programme-ended note dropped | 1 failed \| 22 passed (23) |
| P16 | 8 | an unreadable store offered as a programme to end | 2 failed \| 21 passed (23) |
| P17 | 8 | the pause-switch sentence dropped | 1 failed \| 22 passed (23) |
| P18 | 8 | the busy confirm sends no `interrupt` | 4 failed \| 19 passed (23) |
| P19 | 8 | the conflict sheet shows a typed refusal as an unknown reason | 1 failed \| 13 passed (14) |
| P20 | 9 | the Restore gate keyed on `archivedAt` alone | 1 failed \| 57 passed (58) |
| P21 | 9 | Archive offered to workspaces only | 2 failed \| 56 passed (58) |
| P22 | 9 | the actions sheet does not pass Stop only | 1 failed \| 57 passed (58) |
| P23 | 9 | a main checkout restored (ws-restore) instead of ensured | 2 failed \| 87 passed (89) |
| P24 | 9 | a merged-and-archived row loses Restore | 1 failed \| 57 passed (58) |
| P25 | 10 | the header's Archive not gated on the substrate fault | 1 failed \| 55 passed (56) |
| P26 | 10 | the header never offers Restore | 3 failed \| 84 passed (87) |
| P27 | 10 | the session screen restores a main checkout with ws-restore | 1 failed \| 30 passed (31) |
| P28 | 11 | the live list split back on the bucket | 1 failed \| 156 passed (157) |
| P29 | 11 | the fold split back on the bucket | 5 failed \| 152 passed (157) |
| P30 | 11 | the fold not sorted newest first | 1 failed \| 58 passed (59) |
| P31 | 11 | a stopped main checkout counted where a card's work went | 1 failed \| 58 passed (59) |

- [ ] **Step 2: The full suites, in the foreground — one Bash call per line.**

```bash
( cd pwa && ./node_modules/.bin/vitest run )
( cd agent && ./node_modules/.bin/vitest run )
( cd server && ./node_modules/.bin/vitest run --shard=1/6 )
( cd server && ./node_modules/.bin/vitest run --shard=2/6 )
( cd server && ./node_modules/.bin/vitest run --shard=3/6 )
( cd server && ./node_modules/.bin/vitest run --shard=4/6 )
( cd server && ./node_modules/.bin/vitest run --shard=5/6 )
( cd server && ./node_modules/.bin/vitest run --shard=6/6 )
( cd pwa && npm run build )
```

Expected: PWA `3189 passed` in 103 files (the 101 test files and the two type-level `*.test-d` files), no type errors; the agent suite green; every server file green except the load flakes CLAUDE.md lists (and, on a disk under `ccd`'s 10G `ws-add` floor, every `ws-add` suite — re-run those with `CCD_DISK_FLOOR_GB=1`) — re-run any red file ALONE before calling it this wave's, and report it by name; the build succeeds. (A shard that will not finish inside one call: split it with `--shard` into twelfths.)

- [ ] **Step 3: The census, the deviation refs, the residue scan.**

```bash
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts test/pools-prose.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus|README size claim' )
git fetch origin main
( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts test/box-token-census.test.ts test/single-definition.test.ts )
```

Expected: `8 passed | 354 skipped (362)`; the five guards green (this plan defines no number, and adds no host, path or account name).

- [ ] **Step 4: If `main` moved, merge it — `git merge origin/main`.** CCR-15 wave 4 (#215) is the one in-flight PR that shares files with this wave (Pre-flight finding 10): measured both ways, neither order produces a conflict in a hunk this wave wrote (`close.ts` included). If it landed first, the merge is clean in this wave's lines; re-run Task 12's `wc -l README.md` (its 13 lines keep the claim at `~3700`), then Steps 1–3. Worker stall watch wave 2, executing now, adds about 107 README lines: if it lands first it must re-measure CLAUDE.md's claim itself, and Task 12's Step 3 then writes the hundred nearest the count rather than `~3700`. Any other conflict: resolve it as the source it is — never take a whole file's side — and re-run Steps 1–3. If `main` gained another append at the end of `shared/api.ts` (the stall watch's pattern), keep both blocks, this wave's below.

- [ ] **Step 5: Open the PR** from the workspace branch: title `Workspace lifecycle wave 2: one Archive`, body naming the spec, this plan, the ledger, the deploy class (server + PWA; nothing on the fleet box changes — see the deploy note), the counts from Steps 1–2, the spec amendment already on `main` beside this plan (`docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, committed with it), the deviation slugs for the coordinator to mint (below), and that no D-number was typed.

---

## Deviations found

Named by slug; the coordinator mints their numbers at run-open. Each but the last is carried into the spec by the amendment committed with this plan to `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` (§5.2 step 1's busy rule and worktree check, §5.2's "Stop only" list, refusal codes, programme end and Restore gate, §6's wire count, §8's ended-then-refused case), so a reader of `main` finds each departure in the spec text it changes.

- `archive-door-defers-unmeasured-worktree-to-ccd` — §5.2 asks that "the worktree is present" before any act. In remote mode the server cannot read `~/worktrees` (Pre-flight finding 1), so the door refuses only a PROVEN absence and leaves an unmeasured worktree to `ws-archive`'s own refusal; what only `ccd` measures can therefore refuse after a programme end, and that answer carries `ended` (§5.2 step 1's worktree check, §5.2 item 3, §8). The first prototype's `503 worktree-unmeasured` is gone with it.
- **D-3836** `archive-refusals-carry-the-stop-only-three` (Task 1, run 236) — `ARCHIVE_REFUSALS` declares, beside the spec's four codes, the three `ws-archive` refusals "Stop only" answers (`worktree-gone`, `status-unknown`, `manifest-unbuildable`), read off ccd's own `die` lines; and `run-open` was three code-line literals on the base, not two (§5.2's refusal codes, §6's wire).
- `restore-gate-keeps-cleanup-rows` — the Restore gate is `isPutAway` = `inArchivedFold(s) || bucket === 'cleanup'`: a merged-and-archived workspace stays in its chip's live list (not the fold) and keeps the Restore it offers today, instead of an Archive `ccd` answers `already archived` (§5.2's Restore).
- `header-menu-offers-restore` — the session header's menu offers Restore in Archive's place on a put-away session; §5.2 names Restore on fold rows and the header's Stop→Archive, but not this pairing (§5.2's Restore).
- **D-3837** `archive-busy-is-live-busy-or-working-or-attention` (Task 1, run 236) — §5.2 names busy's inputs (`status`/`hookState`) but not its rule; `archiveInterrupts` counts a live `busy` even where the hook says the turn finished (ccd's own refusal word), and a question waiting (§5.2 step 1).
- `main-checkout-stop-reads-busy-fail-closed` — §5.2 step 1 reads busy "from the same live state the fleet frame uses" for both kinds of row. For a main checkout, whose stop refuses nothing, the door reads it by `_ws_status`'s fail-closed rule instead (tmux `unknown`, an unread pane pid or an unread live file is busy, where the frame folds each towards rest) and re-reads it at the stop, so a turn begun during the claim reads, the mutex wait or the programme end answers `409 session-busy` with `ended` rather than being lost (Pre-flight finding 6; §5.2 step 1).
- `stop-only-after-an-unreadable-store-an-unendable-programme-or-a-missing-verb` — §5.2 offers "Stop only" after the refusals the phone cannot fix and names three. Three more answer every retry the same way: a coordination store the server cannot read refuses every consent (and a store read that throws answers that refusal rather than a 500); a programme whose stopping run is one the abandon arm cannot move from its row (`closing`, `unknown`, or a kind with no transition) answers `programme-partly-ended` every time, since the pre-read finds that run first, and the Runs screen's abandon refuses it too; and a fleet box whose `ccd` predates `ws-archive` answers `501 unsupported` until it is updated. With the header's Stop session gone nothing else in the PWA reaches `/stop`, so the actions sheet offers it after all three (§5.2's "Stop only").
- **D-3838** `programme-end-reads-every-run-before-ending-one` (Task 3, run 236) — §5.2 item 2(a) stops the door when an abandon refuses; a refusal the run's row alone shows (the spec's own example, a run in `closing`) is now found by `abandonRefusal` before the first run is ended, so whether a programme is left partly ended no longer depends on id order, and `close.ts` gains the extraction that makes it one rule (Pre-flight finding 3; §5.2 item 2(a)).
- `claim-checks-precede-verb-gate` — §5.2 step 1 lists "the worktree is present and `ws-archive`'s verb is supported" before the `run-open` check; the door keeps the base's documented order, where a claimed workspace is refused as CLAIMED even on a host whose ccd predates the verb, so the 501 comes after both claim checks and before any act. No amendment: the spec states no order among its checks beyond "before any act".

## Review lenses

1. **Spec fidelity** — every confirm string verbatim (§5.2's four cases; "End programme and archive" or "Cancel" only; the pause-switch sentence); Stop session, its `QuickConfirm` and `stopSession` gone; `ccd stop`, `/stop` and the `esc` keycap unchanged; "Stop only" in the actions sheet alone — after the three `ws-archive` refusals, an unreadable store, a programme it could not end and a `501 unsupported` — and named, never offered, in the header's sheet; `inArchivedFold` the one gate; the census entry; CCR-15's §5.9 sentence amended (§6 item 3); the deviations above and nothing else.
2. **Ordering and concurrency** — every refusal before the programme end (`archive-door-decide`'s seen-order assertions), a main checkout's busy among them (S59); every run's row-alone refusal before the first abandon, in either id order (S48, S50); the end on the routes' own `coordMutex` and through the abandon route's own decision (rows S15–S17, S43); a partly ended programme stops the door (S27), and so does an abandon that throws (S52); a main checkout's busy re-read at its stop (S55), fail-closed (S56–S58); the race after the live read for a workspace (S30); what runs outside the mutex and why (finding 13 (a)).
3. **Wire and absence-permits** — `ArchiveBody` binds both sides' keys; `archivePartial` is the one reader — a comparison or a negation elsewhere reds the scan — and an older server's `{ok:true}` is archived (P5–P7, P32); an unknown refusal word reads `null` (P6); `ended` on every answer after an end (S35, S41).
4. **Rings and single definitions** — `shared/api.ts` imports nothing new; `archiveDoor.ts` decides and owns no I/O; `server.ts` measures and acts; one spelling of each code (S9–S11), of the stop argv, of the abandon, of the fold rule.
5. **The live deployment** — remote mode: the worktree stat (finding 1, rows S20–S21 and the remote-mode describe); a workspace's busy read is the frame's own derivation, the pane's dialogs included (finding 6, S37, S38, S46), and a main checkout's is fail-closed (S55–S59); a coordination store that throws is an unreadable one (S49); deploy is server + PWA and measure-only.
6. **Tests' honesty** — each new guard has a red row, and every row's files are green unmutated (Task 13's baseline); S42 is the one green, and its control S42c reds; the fixture HOMEs, `archive-ccd-words` producing every ccd word it reads (S53, S54); the one-reader scan of `archived` catches a negation as well as a comparison (P32); no pin that a regex cannot hold.
7. **Merges** — CCR-15 wave 4 measured both ways (finding 10), `close.ts` included; wave 1 must be on `main` first, and the seven blocks that anchor on its text are named in the Global Constraints; the EOF append's merge rule; the README size claim if stall watch wave 2 lands first (Task 12 Step 3).

## Open questions

1. **The PR sheet's "Archive now"** (`PrSheet.tsx`) still archives through a toast: it now says the door's typed refusal in words, but offers no `interrupt` or `programme:'end'` consent, so a busy or coordinating workspace cannot be archived from there. Should it open the one `ArchiveSheet` instead (a small follow-up), or stay as it is because a merged workspace is rarely busy?
2. **A real worktree check in remote mode.** Making §5.2's check hold before a programme end there needs either a read-only `ccd` probe or a wider agent read root over `~/worktrees` — both AGENT-FIRST, both security-relevant (the agent's read roots are a boundary). Is the consequence of deviation `archive-door-defers-unmeasured-worktree-to-ccd` (a programme ended, then a `worktree-gone` that names it) acceptable for good, or wanted as a later wave?
3. **L5's "Its workers will be cleaned up."** The confirm carries the ruling's words verbatim, but in wave 2 they are true only for CCR-15 children, and only once CCR-15 wave 4 deploys: ending a programme abandons each run through the abandon arm, which releases a worker's workspace (`ws-release`, never `ws-archive` — D-280) and queues a CHILD's reclaim; a non-child worker stays live and waits in the Released fold for "Archive all" and, from wave 3, `ws-expire`. The spec's own rule for wave-2 copy is "Wave 2's copy promises nothing it does not do". Keep the words, or say "Its workers are released; children are reclaimed" until wave 3?

## Deploy note — server + PWA; measure-only

This wave changes the server and the PWA (which the server serves) and nothing on the fleet box: no `ccd`, agent, skill, grant or unit change, so there is no AGENT-FIRST ordering. By the operator's ruling of 2026-09-30, nobody runs `ccrc rollout` or `ccrc update` by hand: the merge becomes a release and each box follows its channel through ccrc's own update mechanism. The deploy step only MEASURES that mechanism, read-only, and reports a box that does not converge:

```bash
ccrc version          # on each box: the install line names the release this merge produced
ccrc update --check   # on each box: converged, or what it is waiting for
```

and `GET /api/updates` (session-gated: the PWA's own updates view reads it) for every node's measured stamp, install
state and resolved desired tag.

Expected: both boxes on the release carrying this merge within the mechanism's own cadence; the PWA's `BuildLine` shows it. A box that does not converge is reported with its `update --check` line, not moved by hand.
