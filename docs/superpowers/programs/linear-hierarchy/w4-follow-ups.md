# Linear hierarchy, wave 4 follow-ups: drift and inbound (D-8183) — task note

This note is run 2446's record for the programme ledger; the coordinator folds it into the ledger on its own pull request.
The wave closes the gaps wave 4 (#2982) carried out of its review rounds 4 to 6 with the coordinator's rulings (w4-drift.md,
"Follow-ups"), before wave 7 manages any other team. This pull request edits the plan in one place only: it defines the
run's four departures, D-8733..D-8736 (issued by the coordinator, mail 23943), in `## Deviations found`, after D-8723,
because `deviation-refs` reads definitions from the top-level plan file only. The head commit carries the `Ledger-Edit:`
trailer.

## In short

- **Fourteen items, in the brief's order.** Each is fixed with a test seen red first (the red measured, never argued), or a
  guard proved by mutating its line and running the test (restored from a saved copy each time).
- **Departures:** D-8733 drift-reads-every-team, D-8734 drift-cursor-and-return-tables, D-8735 inbound-retired, D-8736
  w4fu-words. Defined in the plan; summarised below.
- **One migration**, entry 106: `linear_drift_cursors` and `linear_inbound_notes`, and (fix round 1, F4) the nullable
  `linear_inbound.retiredWhy`; additive only. Main ended at 95 at build time (D-8673). Overlord gates A (#2993) landed
  first and took 96, so this entry moved to 97 in the first merge of main; the renewal hand-offs (#2934) then took 97, so
  fix round 1's merge of main (the branch read conflicting) moved it to 98; the decision model B (#2990) then took 98, so
  a second merge in fix round 1, on the coordinator's word (mail 24328), moved it to 99; the Overlord's ladder (#2994) then
  took 99, so fix round 2's one merge of main (mail 24639) moved it to 100, and the run-close replay covered forty-seven.
  The quiz record (#2991) then took 100 ahead of this PR in the merge queue, which dequeued it, so the landing merge
  (coordinator mail 25044) moved it to 101, and the run-close replay covered forty-eight. The health changes (#3003) then
  took 101 before the merge review, so a second landing merge (coordinator mail 25451) moved it to 102, kept local. Approvals
  PR 0 (#3045) then took 102 and door A1 (#3035) 103, as the coordinators agreed (mail 25481), so the landing merge at
  #3035's merge moved it to 104, and the run-close replay covered fifty-one. CI on that tip (514fd6516) read red in one
  server shard: the act-key store test pinned its own migration as the last entry ("expected 102 to be 103"), a test my
  local gate had not run. Approvals PR 1 (#3043) then took 104 and carried the act-key test's position pin on main, so
  the merge at #3043's merge (coordinator mail 25835) moved this entry to 105 with main's line for that test, and the
  run-close replay covered fifty-two. The mail idempotency key (#3056) then took 105 after the merge review accepted
  406246c4e, so the landing merge (coordinator mail 26159) moved this entry to 106, and the run-close replay covers
  fifty-three (54 through 106; main's comment said fifty).
  That merge also changed one line of `coord-db.test.ts` on the coordinator's word (mail 24658): the case "a database from a
  NEWER build still READS" set `user_version` 99, which at 100 entries is no longer newer (red: "migration 100 failed:
  table linear_drift_cursors already exists"), so it now sets `COORD_SCHEMA_VERSION + 1`, a newer build at any length. The
  quiz record (#2991) made the same change on main, so the landing merge takes main's line as it is.
- **Growth:** `watch.ts`, `coord/store.ts`, `coord/routes.ts` and `coord/delegation-checkpoint.ts` are untouched;
  `server.ts` gains one line (fix round 1: the plan routes' `inboundRecheck` option, by the ladder's consent, mail 24088);
  `shared/api.ts` is line-neutral (one cap word on the two existing `plan-phases-v1` lines).
- **Fix round 1** (review run 2457, the coordinator's rulings, mail 24080): F1 to F4 and A1 to A6, each with its test, in
  the section of that name below. **Fix round 2** (review run 2524, mail 24639): F1 to F3 and A1 to A5, in its own section.
- **No live Linear call, capture or probe**, and no Linear key read: every test runs on the recorded and constructed
  fixtures, faked at the pass's `call` or at callLinear's FetchLike.

## The items

| # | Finding | What changed | Test (red measured) |
|---|---|---|---|
| 1 | Restores honour every hold (round 6 P3) | `PlanSync#restore` asks the programme's persisted failure hold (`heldSyncUntil`) and each target's workspace and key hold (`releaseOf`) inside the flight, before it sends; a held target is `deferred` and nothing is sent (`restoreHoldVerdict`, L1). The drift pass skips a workspace whose key is refused (`driftReadHeld`), and a drift read answered 401 goes through the plan sync's one owner, `keyRefusedByRead` (the `linear-unauthorised` deferral on the sync's own schedule, under a key of its own; `keyReadAnswered` resets its step), so a 401 holds both lanes (A-3). | `drift-pass.test.ts` "restores and drift reads honour every hold": failure-held, workspace-held and key-refused restores send nothing (`expected 'restored' to be 'deferred'`); a read's 401 blocks the workspace for the sync and the next tick makes no call; the hold is on the sync's schedule; another workspace still gets its pass |
| 2 | A stored inbound row whose issue completes or is canceled is retired (round 4 F1; D-8735) | `retired` joins `INBOUND_STATES`. `inboundRetireVerdict` (L1) retires a `waiting`, `mailed`, `handed`, `raised` or closed-not-acted row whose issue reads completed, canceled or ccrc's own; `taken`/`placed` rows are never touched. `detect` judges every stored row it reads; a raised row's open item settles in the same transaction. Take, triage and the close refuse a retired row through their existing state checks (`issue-not-inbound`). A reopened issue returns to `waiting` and its owner is mailed once more, under a subject carrying the reopen's time (`linear_inbound_notes`, `kind` `reopened`). | `plan-inbound.test.ts`: stored-then-completed for each state (`expected 'handed' to be 'retired'`, …), a raised row's item settles, closed-not-acted is never written, taken/placed untouched, reopen mailed twice and three times; `plan-vocabulary.test.ts` pins the word |
| 3 | A lost-reply create is ccrc's own, never inbound (round 5 F2, round 6 P1) | `ccrcIssueIds` (`planPolicy.ts`, the one builder) is every id a binding of the workspace holds plus each pending ticket's create id (`requestIdOf('ticket', localId, workspaceId)`, D-8722). `detect` reads it from `bindingsInWorkspace`; a stored row for such an issue is retired; `placeInboundInUpkeep` and `takeInboundIntoEpic` refuse, inside their transaction, an issue already held (`heldByCcrc`), so one issue never gets a second ticket. | `plan-inbound.test.ts`: a pending create stores and mails nothing (`expected { n: 1 } to deeply equal { n: +0 }`); a stored row is retired and take refused with no second binding; the composites refuse before and after `markBound` |
| 4 | The drift pass reads ccrc's record before Linear (round 5 F1) | The pass reads the workspace's bindings (`bindingsInWorkspace`) BEFORE its changed* reads. A node whose binding's fingerprint or state moved since (`syncWroteSince`) is skipped whole: no event, restore or record; the sync's write moved Linear's `updatedAt`, so the next pass reads it. `seen` is the pre-read fingerprint, so the restore's own moot check catches a later write too. A project's planned milestones are judged only when the pre-read record bound them (`milestonesJudged`). Pre-read rather than an `updatedAt` comparison: that would set Linear's clock against ccrc's. | `drift-pass.test.ts` "the skip of a node a sync write moved has a test that goes red without it (review 2457 F1)": a sync write after the read leaves no grace stamp (`setDriftSince`), no due mark (`markSyncDue`), no unrestorable event and no item; each red with the `syncWroteSince` call deleted. (The test this row first cited, "a sync write landing after the Linear read is skipped", stays green without the skip: the restore's own moot check catches that write, so it proves the moot check, not the skip.) "the pass reads ccrc's record before Linear": a stale project node missing a milestone the sync just made raises nothing |
| 5 | Drift scope follows the binding (round 6 P2; D-8733) | `changedIssues` asks every team key the slot lists; an issue of an unmanaged team that no pre-read binding holds is dropped at the read (`keepIssueNode`), before the compare, the grace re-read, inbound detect or any record sees it. `driftScoped` (L1): an issue or a project by its binding's team, a milestone by its planned project's binding, an initiative by its projects' bindings. A moved-out issue is restored with its planned team; a milestone moved into an unbound project is unrestorable and raises the item at once; a graced issue moved out has its grace decided, so its by-id re-read ends. | `drift-pass.test.ts` "drift scope follows the binding": moved-out issue restored (`expected [] to have a length of 1`); the read asks every team; the milestone raises; the grace re-read stops; a foreign issue leaves no row, event, mail or item and never reaches `viaFleet` (`expected ['ZZZ-1'] to not include 'ZZZ-1'`) |
| 6 | A page-capped read never skips a change (F3, round 6 P4; D-8734) | A kind that stops at `DRIFT_MAX_PAGES` keeps its sweep in `linear_drift_cursors` (`since`, Linear's `after`, the newest `updatedAt` read so far, `startedAt`) and the next pass goes on from it with the same `since`. A finished sweep deletes the row and moves the watermark to its newest read, never past `startedAt` less `DRIFT_SWEEP_MARGIN_MS` (five minutes), so a change made behind the cursor while the sweep walked is read again; order-free (`sweepStep`, `sweepWatermark`). A restore deferred in any pass of the sweep holds the watermark at `since` to the end. A read refused `linear-invalid` or `malformed` drops the cursor and restarts the sweep; a retry word keeps it (`driftCursorAfterFailure`). | `drift-pass.test.ts` "a sweep that spans passes": two passes, no node skipped, the mark moves after the last page; a change behind the cursor is read on the next sweep (the coordinator's test); the cursor survives a new pass over a fresh port; a stale cursor restarts. Red by mutation: with the cap out of `sweepWatermark`, `expected '…08:50:00.000Z' to be '…08:15:00.000Z'` |
| 7 | The malformed count is per issue (round 4 F2) | Test only. | `plan-inbound.test.ts` "four malformed answers to one close never count against another close's first": red with `this.malformed` keyed by `row.workspaceId` (`expected { …(14) } to match object { state: 'closed', actedAt: null }`) |
| 8 | Only Keep quiets persistence (A-1) | `actionAdmits` (`shared/ledgers.ts`, L1) is the action rule `moveItemInTx` asks: an action item refuses tick, confirm and return as before, and a `linear-drift` item refuses `dismiss` too (`not-open`, so the dismiss door answers "cannot be dismissed from here"). `closedByKeep` reads the item's own history: only an item whose closing move is ccrc's `settle` with `DRIFT_KEEP_NOTE` quiets persistence (`shouldRaiseDriftItem`'s `last.kept`). | `ledgers-policy.test.ts` `actionAdmits`; `ledgers-store.test.ts` dismiss refused, an end-run item still dismisses; `drift-pass.test.ts` dismiss refused (mutation: admit it, `expected { ok: true … } to deeply equal { ok: false, why: 'not-open' }`); a withdraw or another settle does not quiet (mutation: any close kept, `to have a length of 2 but got 1`) |
| 9 | Restore comments name the values; a restore is recorded only when something was written (A-4; round 5 A1, A2) | `restoreSides` (L1): ccrc's side from the plan (the plan's own name for an id: epic, checkpoint, ticket), Linear's side only from ccrc's directory (project names, state and status types, the slot's team keys) and never Linear's free text (title, name, description); with no name, "moved elsewhere". The directory holds no milestone, issue or initiative names, so those Linear sides are never named. A milestone's Restored line names every field put back (`RESTORED_LINE_RE` still matches the one-field lines an older build wrote). `restore` tells apart: a write answered ok is `restored`; Linear already at the plan (`same`, or a link `conflict`) is `moot`; no key or slot is `deferred`; no comment and no record unless restored. | `drift-pass.test.ts` "restore comments name values": the plan's project named, Linear's only from the directory; a renamed project never echoes Linear's text; the milestone line names every field; not-configured and already-at-plan send no comment and record nothing (`expected [ {op:'issueComment'…} ] to deeply equal []`) |
| 10 | Hand on an Upkeep or coordinator-less binding goes to the project's Linear owner (A-7; D-8736) | `handRoute` (L1): the coordinator, else the home project's Linear owner (`linearOwnerOfProject`, the inbound lane's facts), else none; with none, Hand answers `no-linear-owner` (409, `shared/refusal.ts`, the PWA's sentence in `refusalWords.ts`) and the item stays open. The owner's mail rides the settle and the hold release in one transaction. A binding or key that is gone answers `not-found`. | `drift-pass.test.ts`: Hand on a coordinator-less programme and on an Upkeep binding mails the owner (mutation: owner ignored, `expected { ok: false, word: 'no-linear-owner' } to deeply equal { ok: true }`); no owner or a gone one answers `no-linear-owner` (mutation: gone accepted, the reverse); `refusal-status.test.ts` (mutation: status dropped, red) |
| 11 | A milestone a person added does not raise a kept item again (round 5 A3) | `driftEventValue` (L1): a one-way set records the PLANNED members Linear lacks, so a member a person added changes nothing. | `drift-pass.test.ts` "a person's own milestone is not a new difference": after Keep, a person's milestone records nothing new; a further planned one missing is a new event (`expected 2 to have a length of 1`) |
| 12 | The close path runs the public-text check with no project (round 5 A5) | `textRefusal` takes a null project and judges it as linking mode `unknown`, public (§6.1), through the same `publicTextVerdict`; `plan take`'s close passes the handed row's team. | `plan-inbound.test.ts` "the close path of a take with no project…" (`expected [ 200, '' ] to deeply equal [ 409, 'linear-text-public' ]`) |
| 13 | A return made while the owner is gone is not lost (round 6 A3; D-8734) | The return stores a `returned` note (programme, masked note, time) in the transaction that moves the row to `waiting`; `mailOwner` picks the mail from the note (`inboundNoteMail`): none, the first mail; `reopened`, the reopen mail; `returned`, the return mail with its note fenced, its subject carrying the note's time. The note is deleted in the transaction that mails it. | `plan-inbound.test.ts`: the note is mailed once, fenced, when the owner is live again, across two beats; a second return later is mailed again |
| 14 | A capability word for take and triage (round 4 A1; D-8736); `inboundByIdentifier` by workspace (round 4 A2) | The server advertises `plan-inbound-v1`; `ccd/ccrc-api` refuses `plan.take` and `plan.triage` `capability-missing` when a current cap file omits it, through one gate table beside `plan.phase-ref`'s. `inboundByIdentifier(workspace, identifier)`: the triage door passes its team's workspace, and with none an identifier two workspaces hold resolves to nothing. The take door reads the rows handed to its programme (`handedInboundByIdentifier`): a handed issue may sit in another workspace than the programme's (`ticket-workspace-mismatch` is that door's own check), so the programme's workspace is not the key; two handed rows are told apart by the programme home's workspace, else none is chosen. | `ccrc-api.test.ts`: refused locally without the word (red against the old client: `expected [ +0, undefined ] to deeply equal [ 2, 'capability-missing' ]`), sends with it or with no cap file; `plan-inbound.test.ts`: two workspaces, each door finds its own (`TypeError: Cannot read properties of null`) |

Tests for a pure function written after its pass-level test (`restoreHoldVerdict`, `driftReadHeld`, `syncWroteSince`,
`milestonesJudged`) pin the decider; their pass-level tests were the red.

## Departures

- **D-8733, drift-reads-every-team.** The changed issue read spans every team the slot lists; an unmanaged, unbound issue is
  dropped at the read and leaves nothing behind. **Extra cost per pass:** the issues changed in the workspace's unmanaged
  teams since the watermark, read and dropped, in the same pages of 100 (one rate-service call per page, on lane `sync`,
  like every other read). For a workspace whose unmanaged teams are busy this can reach the page cap, which D-8734's cursor
  now spreads across passes without skipping a change.
- **D-8734, drift-cursor-and-return-tables.** Migration 106: `linear_drift_cursors`, `linear_inbound_notes` and `linear_inbound.retiredWhy`. The margin
  `DRIFT_SWEEP_MARGIN_MS` is ccrc's clock against Linear's `updatedAt`; a skew larger than five minutes with ccrc ahead would
  narrow it, and nothing measures Linear's clock (Linear's `updatedAt` order is unmeasured too, so nothing relies on it).
- **D-8735, inbound-retired.** As in the table, amended by fix round 1 (F4). A retired row keeps its `reason` (a close's
  reason stays a close's reason); the retire's cause is stored in `linear_inbound.retiredWhy` (`completed`, `canceled`,
  `ccrc-own`, `moved-out`), and a reopen clears it. An issue that left the managed teams is retired `moved-out`: the doors
  re-read it by id and the lane re-reads unseen open rows at a bounded interval (below).
- **D-8736, w4fu-words.** `plan-inbound-v1` and `no-linear-owner`; a dismiss of a drift item answers the existing `not-open`.
  It states spec §7.4's Hand change (fix round 1, A4).

## Decisions the brief left to the build

- **A node with no pre-read binding is not compared** (item 4): it was bound after the read, so it matches what the sync just
  wrote; the next pass reads it.
- **The watermark still reads the dropped nodes' `updatedAt`** (item 5): that stores nothing, and holding the watermark back
  for nodes never kept would re-read them at every pass. A node that later moves into a managed team changes `updatedAt` again.
- **`targetDate` and `sortOrder` name Linear's side** (item 9): closed-grammar scalars, neither free text nor ids. An
  initiative's `status` names no Linear side: the directory cannot confirm it.
- **A held target that is also moot answers `moot`** (item 1): only a target that would otherwise be sent becomes `deferred`.
  Fix round 1 (A3) made the code follow this: the moot check runs before both holds (`restoreTargetVerdict`).
- **A restore deferred in an earlier pass of a continuing sweep** (item 6) is carried in the cursor (`newest` equal to
  `since`, which no real read gives, since Linear returns only nodes newer than `since`), so the sweep's end leaves the
  watermark at `since`; a finished sweep that ended on a deferral deletes its cursor and keeps the old watermark.
- **Two older tests changed with item 6:** "an issue completed with no merge waits one pass" and "a page cap keeps the old
  watermark" assumed the mark moves to the newest read at once; with the margin, a pass within five minutes of the mark leaves
  it, and a capped kind leaves a cursor row.
- **The F4 test of round 3** ("after Hand on a binding with no coordinator…") now names an owner, and "Handed to nobody" is
  gone: with no owner Hand is refused (item 10).
- **Upkeep in item 10's test** is simulated by wrapping the port's `dueKeyOfBinding`; no Upkeep rows are built.
- **The reopen mark** (item 2) first lived in `linear_inbound.reason`; that gave one column three meanings, so it moved to the
  notes table with item 13's returns before this was pushed.

## Co-edits by consent

`server/src/coord/schema.ts`, `coord-db.test.ts`, `run-close-switch.test.ts` (Overlord gates A, mails 23955 and 23964: one
appended entry, its count pins and replay drops); `shared/api.ts` and `plan-vocabulary.test.ts` (desktop-polish WM1 through
its coordinator, mail 23945: the cap word on the existing lines, additive cases; WM1 adds `plan-ticket-done-v1` on the same
lines, so the second lander keeps both); `shared/plan.ts` (consent given to wave 5 for its appended block, mail 23949);
`pwa/src/lib/refusalWords.ts` (wave 5, mail 23961: one entry).

## Suites run (fleet slice, `--maxWorkers=2`, ≤ 12 files a command)

- drift-pass, drift-policy, plan-inbound, plan-sync, plan-sync-lane, plan-sync-lifecycle, plan-sync-policy, plan-sync-owned,
  plan-sync-description, plan-dispatch-wait, plan-dispatch-route, linear-items: 506 passed; 555 at the fix round 1 tip; 574 at the fix round 2 tip.
- plan-store, plan-routes, plan-policy, plan-vocabulary, ccrc-api, census-w3/claimant, ledgers-policy, ledgers-store,
  refusal-status, single-definition/plan, single-definition/refusal-table, server-caps: 599 passed; 604 at the fix round 1
  tip; 605 at the fix round 2 tip.
- overlord-other-lanes-census, -pin, -routes, hierarchy-routes, lane-schedule, linear-proxy-routes,
  single-definition/vocabularies, single-definition/done-test-reader, run-close-switch, mail-routes, public-text,
  plan-phases: 560 passed at the fix round 1 commit (A5); 563 at the fix round 2 tip (A3: the merges of main added three
  tests, one in hierarchy-routes and two in lane-schedule; the reviewer measured 563 at 58d8ed47b).
- Fix round 2 also: plan-inbound-policy and coord-policy-rings 37; coord-db alone 149; the guard suites above 740 passed,
  3 skipped; the server typecheck clean; and the test-directory compile check in four batches over every file of `test/`
  (less `types/`), `test-e2e/` and the package root (the whole tests project is killed by the slice's memory cap), with no
  error in the server's files (the only errors are `agent/src`'s missing `ws` module: no `node_modules` in that package in
  this worktree, and the branch changes nothing under `agent/`).
- The guard suites (growth-check, growth-caps, deviation-refs, anchors, citations, token-shared, auth-gate,
  box-token-census, ccrc-api-closed, topology-clean, oss-metadata, ownership), coord-db alone, the PWA's refusal-words
  suite, and the server typecheck: see the PR body for the final counts at the pushed tip.

## Fix round 1 (review run 2457)

Each fix has a test seen red first, against the code before it or, for a test-only fix, by mutating the guarded line and
restoring it from a saved copy.

| # | What changed | Test (red measured) |
|---|---|---|
| F1 | Test only: the round 5 skip's call site in the compare loop (`syncWroteSince`). The item 4 row's citation is corrected. | `drift-pass.test.ts` "the skip of a node a sync write moved has a test that goes red without it (review 2457 F1)": no grace stamp, no due mark, no unrestorable event, no item; all three red with the call deleted |
| F2 | The take door's choice is `handedRowOf` (`planPolicy.ts`, L1): the only row, else the programme home's workspace's, else none. | `plan-inbound.test.ts` "the take door chooses between two handed rows of one identifier (review 2457 F2)": the home's row is taken and the other stays handed; a home that does not decide, or none, answers `issue-not-inbound` with no binding, no row moved and no mail. Red against `handedRows[0]` (3 tests, e.g. `expected [ 200, '' ] to deeply equal [ 409, 'issue-not-inbound' ]`) |
| F3 | The restore comment passes `publicTextVerdict` with each binding's project linking mode and team key (`textRefusalOf`, `textFactsOf`, `planSyncPolicy.ts`, the one owner the sync steps use too; `restoreCommentChoice`, `driftPolicy.ts`). Refused, the fields are still restored and the comment is the fallback sentence naming only the fields (`restoreFallbackCommentOf`). The refusal is told as the sync step's text refusals are: one owner mail per object, no Linear write of the text. A milestone's Restored line already names only fields (pinned). | `drift-pass.test.ts` "the restore comment is public text (review 2457 F3)": a refused name gives the fallback, the fields restored, the refusal told once; a clean name gives the valued comment; a private project is not checked. Red before the fix |
| F4 | A stored row whose issue left the managed teams is retired `moved-out`. (1) `plan take` and `plan triage` re-read each candidate row's issue by id BEFORE the run writers' mutex (`PlanRouteOpts.inboundRecheck`, wired in `server.ts` to `DriftPass#recheckInbound`, the inbound lane's by-id `issueOwned` read through the one rate service; a 401 goes to `keyRefusedByRead`), judged in L1 (`inboundRecheckOf`, `inboundDoorVerdict`): moved out, completed, canceled or not found, the row is retired with its cause and the door refuses `issue-not-inbound`, binding nothing. The close's `act` re-reads before its comment and cancel: moved out, it retires the row and writes nothing in Linear. (2) After each workspace pass's `detect`, `InboundLane#recheckStored` re-reads by id the open stored rows the pass did not see, each at most once per `INBOUND_RECHECK_MS` (6 hours), at most `INBOUND_RECHECK_MAX_PER_PASS` (20) a pass, the longest unchecked first; the last-read time is in memory only. (3) A retire writes only the state and the cause on the existing row (`retireInbound`, the one writer); the re-read's answer is used and dropped. (4) A moved-out issue read open in a managed team again is reopened (`waiting`, the cause cleared) and its owner mailed once more. | `plan-inbound.test.ts` "the doors re-read the issue by id and retire a row whose issue left the managed teams": each take body and triage decision, not-found and completed, still managed, unmeasured, a 401, no reader, both close paths (mutation: the take gate out, 7 red; the triage gate, 6; the re-read in `act`, 3). "the lane retires an open stored row whose issue moved out, within a named interval": not before the interval then once; every open state; a failed read; a 401; the move back in reopened and mailed; the re-read stores nothing of the issue (row fields unchanged, no other row, no text in any table, no log line) (mutation: the call after `detect` out, 6 red; the interval at 0, 8). "every retire writes its cause, and a reopen clears it" (red before: `expected [ undefined, undefined, undefined ] to deeply equal [ 'completed', 'canceled', 'ccrc-own' ]`) |
| A1 | Test only. | `drift-pass.test.ts` "a key that recovers starts the read ladder from its first step again (A1)": red with `keyReadAnswered` deleted from the pass, and with `PlanSync#keyReadAnswered` a no-op |
| A2 | Test only. | `drift-pass.test.ts` "a graced re-read answered 401 holds the key for both lanes and restores nothing (A2)": red with the `keyRefusedByRead` call there deleted |
| A3 | `restore` decides moot first, for the per-target hold and the failure-held programme row (`restoreTargetVerdict`, L1: `moot`, `defer` or `send`); a held programme reads its snapshot read-only and sends nothing. | `drift-pass.test.ts` "a held target that is also moot answers moot (review 2457 A3)": failure-held and key-refused, a moot target is moot and a target to send deferred; a held, moot target does not hold its kind's watermark; a held target to send still does. Red before the fix |
| A4 | D-8736 states spec §7.4's Hand change (plan amendment, wave 5's consent, mail 24086). | — |
| A5 | The third suite group's figure: 560 at the new tip (above). | — |
| A6 | A retire deletes the row's stored inbound note in the same transaction (`retireInboundInTx`/`retireInbound`, `planStore.ts`, the one retire; a row not retirable now is left as it is). | `plan-inbound.test.ts` "a retire deletes the row's stored inbound note (review 2457 A6)" (red before: `expected { kind: 'returned', …(3) } to be null`); `plan-store.test.ts` "the one retire of an inbound row" (mutation: the note delete out, 2 red; the retirable guard out, 1) |

**The re-read's cost per pass** (F4 part 2; corrected in fix round 2, F1 and F2). The pass runs every `DRIFT_PASS_MS`
(30 minutes), so with N open stored rows a workspace pays N reads per 6 hours: N/12 reads a pass of that workspace on
average, never more than 20 in one pass. This holds per workspace whatever the number of workspaces: the last-read times
are kept per workspace, so one workspace's pass never prunes another's (until fix round 2 it did, and with two or more
workspaces each open row was read at every pass of its workspace). After a restart (the last-read times are in memory)
the first passes read at most 20 rows each until every row is read once. Only a workspace-wide answer ends the walk: the
key's refusal, a transport or rate failure, a policy or journal outage, an unreadable store or no managed team
(`inboundRecheckStops`); while one stands, one read a pass. An answer about one row (`malformed`, `linear-forbidden`,
`linear-invalid`, `not-found`) marks that row checked and the walk goes on; the row is not retired and nothing of it is
stored. Every read is one rate-service call on lane `sync`, like the pass's own.

**Decisions the rulings left to the build:**

- **A door's read that cannot be made** (no reader wired, no key or slot, Linear or the key refused) refuses `unreachable`,
  the Linear read's existing 503, only for a decision that binds the issue (a take into an epic, an Upkeep placement, a
  hand), so a moved-out issue is never bound unseen; a close, a raise or a return goes on, because the close's `act`
  re-reads before it writes in Linear and the next read retires the row.
- **An issue Linear no longer answers** (`not-found`: deleted, or out of the key's sight) is no issue in a managed team,
  so it is retired `moved-out`. A workspace with no managed team now is not judged: no call is made.
- **A restore comment's refusal** is told by owner mail, once per object, as the sync's text refusals are, and writes no
  `linear_events` row (the refused text is not stored). A programme binding's comment is judged by every epic's project's
  facts; an unknown project is mode `unknown`, public.
- **The retire rule and its words** (`RETIRE_WHYS`, `inboundRetirable`) live in `server/src/linear/inboundRetire.ts`, L1,
  so the plan store and the inbound policy both reach them without importing each other.

## Fix round 2 (review run 2524)

Each fix has a test seen red first, against the code before it (all seventeen new inbound tests ran red against fix round
1's source, which was then put back from saved copies) or, for a test-only item, by mutating the guarded line and restoring
it from a saved copy.

| # | What changed | Test (red measured) |
|---|---|---|
| F1 | `InboundLane#recheckStored` keeps its last-read times per workspace and prunes only its own workspace's ids. | `plan-inbound.test.ts` "the lane's re-read is bounded per row whatever the number of workspaces (review 2524 F1)": two managed workspaces whose passes alternate read each open row at most once per `INBOUND_RECHECK_MS` (red: `AAA-12: expected [ true, false ] to deeply equal [ true, true ]`) |
| F2 | `inboundRecheckStops` (`inboundPolicy.ts`, L1, typed from Linear's answer words): only a workspace-wide answer ends the lane's walk; an answer about one row marks the row checked and the walk goes on. | `plan-inbound.test.ts` "only a workspace-wide answer stops the lane's walk (review 2524 F2)": a malformed answer, then a `linear-forbidden` one, each followed by a moved-out row retired in the same pass (red: `expected { …(15) } to match object { state: 'retired', …(1) }`), and a transport failure that still stops after one read; `plan-inbound-policy.test.ts` "inboundRecheckStops" |
| F3 | Two bindings of one workspace holding one Linear id: the lowest id is the binding (`bindingByLinearIdOf`, `driftPolicy.ts`, L1), the store's own rule (`bindingByLinearId`), which the pass's pre-read and `projectOf` follow. No uniqueness constraint, no migration (the coordinator's ruling). | `drift-pass.test.ts` "two bindings of one workspace holding one linearId: the lowest id is the binding (review 2524 F3)": the node's drift is compared and restored once (red: `expected [] to deeply equal [ 'Ticket t1' ]`); the store's reader and the pre-read pick the same binding; `drift-policy.test.ts` "bindingByLinearIdOf" |
| A1 | `plan take` refuses `issue-not-inbound` at once when handed rows exist and the home does not decide; `upkeepTicketByIdentifier` is keyed by the programme home's workspace (with none, only an identifier no other workspace's ticket holds resolves, as `inboundByIdentifier` does). | `plan-inbound.test.ts` "plan take never reaches another workspace's Upkeep ticket (review 2524 A1)": with no handed row, and with handed rows the home does not decide (red: `expected [ 409, 'ticket-workspace-mismatch' ]` and `[ 200, '' ]` to equal `[ 409, 'issue-not-inbound' ]`) |
| A2 | Test only. | `plan-inbound.test.ts` "every cause is walked at pass level": `canceled` by id through take, triage, the close's `act` and the lane; an unreadable Linear store (rejecting, or answering unreadable) on the door's re-read (mutation: the `canceled` arm of `inboundRecheckOf` out, 3 red; the re-read answering managed with no slot, 2 red) |
| A3 | The note's three suite-group figures, measured again at the new tip (above). | — |
| A4 | The reopen mail names the row's own retire cause (`REOPEN_PHRASES`, `inboundReopenedMail`), read from `retiredWhy` before the reopen clears it and carried on the `reopened` note's `note` column (ccrc's word; nothing of the issue). | `plan-inbound.test.ts` "the reopen mail names the row's own retire cause (review 2524 A4)": completed, canceled, moved out, ccrc's own and none, each by its exact sentence (red before: the mail said "completed or canceled"); `plan-store.test.ts` the reopened note round trip |
| A5 | Test only. | `drift-pass.test.ts` "keyReadAnswered resets the step of the read ladder and of no other key (A1; review 2524 A5)": a second workspace's key holds its step (mutation: `keyReadAnswered` clearing every read key, red: `expected 1800000033000 to be 1800000603000`) |

## Carried, not built here

- The changed* documents' actor (D-8703), D-8699's by-id creator and `issueOwned`'s creator: the next capture.
- A milestone description edit may not move its `updatedAt` (FX2 item 4).
- The inbound close's workspace hold (F8) still lives in process memory.
- The lane's close comment posts the stored reason without re-running §6.1's check before the write (round 5 A5's second
  half); the reason was checked when the close was decided. Not in this run's list.
- Not mine (the brief): the wave 4 note's gated-count prose and D-8724/D-8725.
