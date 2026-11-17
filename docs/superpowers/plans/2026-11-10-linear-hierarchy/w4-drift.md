# Linear hierarchy, wave 4: drift, inbound and public text (D-8183) — task note

This note is the wave's record for the programme ledger. The coordinator folds it into the plan's ledger on its own pull
request. This pull request edits the plan in one place only, under the coordinator's instruction: it defines the wave's
departure numbers, D-8703..D-8707 and, after review run 2386, D-8720..D-8723, in the plan's `## Deviations found`, and
records the coordinator's D-8681 ruling under that entry. That edit carries a `Ledger-Edit:` trailer on the head commit. It changes no other line and no checkbox.

## In short

- **What was built.** Tasks 4.1–4.4 of `docs/superpowers/plans/2026-11-10-linear-hierarchy.md`, and Task 4.5 (wave 3's
  carried findings, from the brief):
  - **4.1, the migration and the drift deciders:** one migration for every table of the wave (it is entry 93: row
    revisions, #2965, took 87, renewal readings A, #2962, 88, remaining work A, #2951, 89, account organization D, #2958,
    90, designation A, #2950, 91 and done tests A, #2964, 92 while this was built; D-8673), `server/src/linear/driftPolicy.ts` (L1) and the plan store's
    drift, inbound, streak and settled-probe functions.
  - **4.2, the drift pass:** `server/src/linear/driftPass.ts` (L4), lane `linearDrift`. Every write it makes is the plan
    sync's, through `PlanSync#restore`, in the programme's flight; a sync write that landed first makes the restore moot.
    The planned values it compares come from the sync's own deciders (`planSyncSteps`' `owned` output), so there is one
    computation of what the plan says Linear should hold. Persistent drift raises a `decide` item with *Hand to the
    coordinator* and *Keep the plan*.
  - **4.3, the inbound path:** `server/src/linear/inboundLane.ts` (L4) and `inboundPolicy.ts` (L1); `plan triage` and
    `plan take`; the Upkeep epic, which syncs under `upkeep:<project>`; the *Name a Linear owner* item and its `name` act;
    `GET /api/projects/:project/upkeep` (masked). The team's Linear owner is decided once, in `planPolicy.ts`
    (`teamOwnerProject`, `linearOwnerOfTeam`), and the owner read, the triage route and the lane all ask it.
  - **4.4, `plan-owned`:** a session's create in a managed team, and its update of a bound issue there, are refused before
    the policy point with no Linear call.
  - **4.5:** see "Wave 3's carried findings" below.
- **Growth** of the capped files over the whole pull request (net code lines): see the PR body's measured table.

## Departures (defined in the plan)

- **D-8703, drift-actor-unread.** The changed* documents select no actor, and `ops.ts` is frozen. Every drift event's
  `actor` is the literal `not read`, and the persistent-drift item says "who: not read by ccrc". The item still shows the
  object, the field, each value and the day. The actor joins the next-capture list beside D-8699 and `issueOwned`'s creator.
- **D-8704, catch-up-by-fingerprint.** The plan's `fingerprintOf(owned) === lastWritten` cannot compare: a binding stores
  F(the planned inputs, with ids), not F(Linear's owned fields). `driftVerdict` takes `sync: { current }`, where `current`
  is the sync's own `isCurrent` for that binding. A difference on a binding that is not current is a catch-up: the
  programme is marked due through `markSyncDue` alone, so a programme a failure holds (D-8702) stays held, and nothing is
  sent. The gap, as the coordinator stated it: a person's edit made while the sync is behind, or while the programme is
  held, is overwritten with no drift event and no comment. `drift-policy.test.ts` pins that a current binding with a
  differing owned value is drift.
- **D-8705, inbound-open-and-kept-text.** `changedIssues` selects no `createdAt` and no creator. An issue is inbound when
  it is open (not completed or canceled), in a managed team, held by no binding, and not named by the journal's
  `viaFleet`. The inbound row keeps the reporter's title and body, cut visibly to the plan's ticket bounds by its one
  writer (`upsertInbound`, through `fitInboundText`), so `plan triage upkeep`, `plan take` and an own-programme `hand` make
  the ticket without calling Linear. The text reaches a mail or an item only inside `untrustedBlock` under
  `LINEAR_TEXT_PREFACE`, and a GET that answers it is in `MASKED_GET_ROUTES`.
- **D-8706, triage-own-programme-epic.** `hand` to a programme whose coordinator is the caller takes the issue at once,
  through the one `takeInto` that `plan take` uses; the body's optional `epic` is then required (`plan-bad-body`), and
  `checkpoint` stays optional.
- **D-8707, write-ask-project-teams.** `LinearWriteAsk.resource` gains `teamKeys`, every team a project write puts the
  project in (the deciders map `teamIds` to keys), so the policy is asked about each, as D-8678 did for a move's
  destination. Nothing changes under `allowAll`.
- **D-8720, kept-plan-quiet** (review run 2386 F3). After *Keep the plan*, the same binding's persistent drift is not raised
  again for seven days; a restore Linear refuses still raises the item at once (§7.4). So does a difference no update can
  put back, which §7.2 already raises at once (`shouldRaiseDriftItem` takes the reason). Only Keep quiets it (review run 2394
  A-1, the coordinator's ruling): *Hand to the coordinator* ends the binding's hold on its item in the same transaction, so
  persistent drift handed on is raised again as §7.4 says.
- **D-8721, restore-comment-daily** (review run 2386 F6). A restore comments at most once a day on an object, whether or not
  its item is open; §7.4 bounds only the open case.
- **D-8722, issue-adopt-by-id** (review run 2386 F5, Task 4.5 item 4). A ticket's issue is adopted by its idempotent id on
  any team, so a key change between a lost create reply and recovery is not stranded. The id hashes kind, local id and
  workspace, so this is safe only while one coord.db has ever filed tickets into that workspace; a second install, or a
  rebuilt database that numbers tickets again, can adopt and rewrite another install's issue. The issue creator on the
  next capture (D-8699's list) closes it.
- **D-8723, w4-schema-additions** (review run 2386 A6). Beyond D-8705's `title` and `body`, `linear_inbound` gains `reason`,
  `actedAt` and `itemId`; `linear_sync_streaks` (item 6) and `linear_probe_settled` (item 1) are tables the plan never
  names; and `linear_drift_marks` keeps one watermark per changed* kind instead of one (A3). A restore deferred on a target
  keeps the watermark of every kind whose event rides on that target, so an initiative's link carried on a project's restore
  is read again (review run 2394 N2).
- **D-8681's ruling (no new number).** Links are compared one way: a planned link missing in Linear is drift, restored by
  linking with a fresh request id; a link the plan does not have (D-8681's kept link, or one a person added) is not drift,
  since nothing unlinks. A project's milestones compare the same way: a planned milestone missing is drift (recorded and
  asked about, since no op makes it again), and one a person added is theirs.

## The wave's rulings and the executor's

| Ruling | What |
|---|---|
| Comments | An issue, an initiative and a project take a restore comment (FX2 answer 3); a milestone takes a "Restored on <day>" line in its description, the last three kept (D-8407). Only a line in ccrc's exact shape is ccrc's record, and only in Linear's copy: a plan line that begins "Restored on" is plan text (A9). The comment rows `initiativeComment` and `projectComment` reuse the session's comment document unchanged. |
| Grace | An issue Linear reads `completed` with no merge recorded waits one pass (`driftSince`), then is restored; with the merge recorded it is left (`graceVerdict`). While the grace stands the issue is re-read by id at every pass (F1), and a restore of another of its fields goes without its state (A5). |
| One comment a day | A restore comments at most once a day on an object, its item open or not (D-8721); persistence counts distinct restore times, not rows. |
| Unrestorable | A planned milestone missing from its project, or a milestone moved to another project, is recorded and raises the item at once (no op makes or re-parents one). |
| Kept plan | A binding whose item was kept is not raised again for persistence for seven days; a refused restore raises at once (D-8720). A handed-on item is no longer the binding's, so its persistence is raised again (A-1). |
| Description compare | Descriptions and names are compared after one normaliser (`normalText`: CRLF, per-line trailing spaces, blank-line runs), so a whitespace re-flow Linear makes is never drift. |
| Inbound pass word | The close of an inbound issue (its comment, then its cancel) runs under a new pass, `inbound`, in `LINEAR_CCRC_PASSES`. |
| A refused close | A refusal that may clear (a rate limit, unreachable, a timeout, an unavailable policy or journal, out of grammar, a key refused) holds the workspace's closes on the plan sync's failure-hold schedule (D-8702's `deferralOf`, F8); the hold grows until the close is done whole (its cancel ok, N1), and an answer out of grammar is given up after the last step, as the plan sync fails a binding. A key refused (a 401) goes through the plan sync's one owner (`keyRefused`: the slot marked rejected, the workspace blocked for both lanes, A-3). A key not configured is retried at the next beat with no hold, as the plan sync does (A-2, ruled (b)). The two key words mail the team's owner once. Any other word gives the close up: the row records it first (`actedAt`, and the reason with the refusal), so it is never sent again, across restarts, and then the owner is mailed once (Review Focus 5; A7, A8). The project's upkeep read lists those closes (`notClosed`). |
| Raised issue | A raised issue's row links to its operator item (`linear_inbound.itemId`, one of D-8723's columns); when the operator answers, the answer is mailed to the team's owner and the row is `mailed` again. |
| `return` with no owner | A handed issue returned while the team has no usable owner goes back to `waiting`, so the *Name a Linear owner* item applies. |
| Upkeep | The Upkeep epic lists no waves, never closes, and no run opens on its ticket (`ticket-unavailable`); its failures mail the project's Linear owner. |

## A live wave 3 bug found here

The plan sync's cancel comment (a dropped ticket, a dropped epic, an abandoned programme) journaled its fields as
`['comment']`, which the real journal's closed field list refuses, so every cancel comment answered `journal-unavailable`
and held its programme on the failure backoff. Found while building Task 4.2 and mailed to the coordinator, who carried the
one-word fix (`['body']`) on fix run 2358; this branch has the same fix, pinned in `plan-sync-lifecycle.test.ts`.

## Wave 3's carried findings (Task 4.5)

The brief's eleven items, each fixed with a test seen red first and its guard proved by one mutation:

| Item | What changed |
|---|---|
| 1. A restart lost the probe's settled mark | Persisted (the coordinator's choice): `linear_probe_settled`, read and written through the plan store; a test reopens the store and a refill reading `on` creates the initiative. |
| 2. A failing workspace held the whole programme (M3/A9) | A deferral from a step's call holds that step's workspace for that programme, with its own backoff step; the pass goes on in the programme's other workspaces, and only when nothing else is runnable is the programme's row held (a failure, D-8702) to the earliest workspace hold. `store-unreadable` still holds the programme. The workspace holds live in process memory (the row's own hold is persisted). The dispatch wait does not wait when its ticket's workspace is held. |
| 3. An issue made before its project gained the team (round 1 A1) | A ticket CREATE on a team that is not its epic's own waits until the epic's project binding is current (its fingerprint holds the planned teams), so the project's team update goes first (§5.2). |
| 4. ccrc's own object stranded under an old team key (round 1 A11) | `adoptionVerdict` adopts an issue by id alone (id = requestId, held by no other binding) and a project by id and viewer, whatever its team, and answers the object's actual team; the binding records it, so the next pass moves it. An issue made by another ccrc install with the same deterministic id would be adopted: D-8722 (no creator is read, D-8699's list). |
| 5. A project's extra teams reached no policy (D-8707) | `teamKeys` on the project steps, on `CcrcOpAsk` and on `LinearWriteAsk.resource`; never journaled. |
| 6. Episode streaks in memory | Persisted (`linear_sync_streaks`): a restart neither restarts an episode nor mails twice; a test reopens the store for both the probe and the statuses episodes. |
| 7. Three decisions in L4 (round 2 A3) | `probeRecheckDue`, `dispatchWaitVerdict` and `deferralUntil` (with `deferralUsesBackoff`) are pure, in `planSyncPolicy.ts`, each with its own tests. |
| 8. A link re-sent after an update (round 1 A3, round 2 A4) | The stored fingerprint carries the link mark, `<base>+<mark>` (`withLinkMark`, `linkMarkOf`), still with no link row (D-8677). Current = the base matches and (the initiative is not live, or the mark is the live initiative's). An update keeps the mark; a failed initiative sends its linked projects no update; a project is linked once. A fingerprint stored by wave 3's encoding reads not current once after the upgrade: one update, then one link Linear answers `conflict`. |
| 9. A PR link re-sent when the PR is unknown for a pass (round 1 A4) | The same mark for an issue's PR URL: a pass with no PR known sends nothing; a new URL is linked once. |
| 10. The probe mail misstated (round 2 A6) | `probeEpisodeText` (L1): an unbound initiative keeps today's sentence; a bound one says its update waits and its projects stay linked; an end waiting adds that the initiative closes once ccrc can tell. |
| 11. A test that never asserted its second statuses read (round 2 A7) | `linear-directory-hierarchy.test.ts` asserts both refreshes asked for the statuses page; skipping the second goes red. |

The executor's own notes: the dispatch wait starts its pass inside the timer race, since finding the ticket's workspace
reads the Linear store; four tests that forced a row due at a fixed clock now advance the clock past the workspace hold.

## After D-8708 (#2973) landed

The merge of `main` took #2973's description fitter (Linear's 255-character cap) into the sync's deciders beside this
wave's changes there, and three notes of its review (run 2368) came to this wave:
- **The Restored lines survive the cap.** A milestone's restored description (`restoredDescription`, L1) puts this
  Restored line and the two newest Linear holds FIRST, newest first, then the planned text, and fits the whole to 255:
  the fit cuts from the end, so it shortens the plan's text and, past that, drops the oldest line first. The comparison
  accepts Linear's text when, without ccrc's lines, it is the plan's text, or when it is EXACTLY what a restore writes for
  the plan's text and the lines it holds: one composition (`composeRestored`) serves the writer and the comparison. The
  first build accepted any prefix of the plan's text once a Restored line stood (review run 2386 F2); fix round 1 made it
  exact, with the review's three probes as tests.
- **The fitter's untested edges** (`plan-sync-description.test.ts`): fitting is idempotent; a bound description carrying a
  note takes one update and then none; the non-ASCII case carries an astral character, so its code-point bound and its
  UTF-16 bound differ. These pin behaviour that held already, so none was red first.
- **A known safe-direction false refusal** (an id-like token running into letters, cut to the id): left, as ruled.

## Fix round 1 (review run 2386)

The review read aeac0d80d with the full panel; the coordinator ruled F3, F5 and F6 and issued D-8720..D-8723. Every fix
has a test seen red against the code before it (the drift ones by running the new tests against the previous source); the
A5 state hold and the inbound hold were also proved by mutating their lines. Main was merged once and the migration is 91.

| Finding | Outcome |
|---|---|
| F1 the grace never got its second look | Fixed: a graced issue is re-read by id at every pass (`graceRereads`, `issueOwned`); the fake honours `since` |
| F2 any prefix accepted once a Restored line stood | Fixed: exactly `composeRestored`'s string, or the plan's text |
| F3 a refused restore quiet for a week after Keep | Ruled: D-8720; persistence alone keeps the quiet |
| F4 `plan-owned` matched only bound bindings | Fixed: any ticket binding holding the issue, whatever its state |
| F5 issue adopted by id on any team | Ruled: D-8722 |
| F6 a comment every pass while no item is open | Ruled: D-8721, once a day whatever the item's state |
| F7 decisions in the L4 pass | Fixed: `graceVerdict`, `graceRereads`, `UNRESTORABLE`/`restorableFields`, `eventVerdict` in `driftPolicy.ts` |
| F8 key refusals retried every beat | Fixed: the D-8702 failure-hold schedule, owner mailed once (round 2's A-2 took `not-configured` back to a beat retry) |
| A1 initiative links judged by the initiative's binding | Fixed: `missingLinksVerdict`, each by the project's own binding |
| A2 `plannedOwned` advanced streaks and asked for fills | Fixed: a read-only snapshot |
| A3 one watermark for four reads | Fixed: one per kind (`nextWatermark`; D-8723) |
| A4 an unrestorable change recorded at every re-read | Fixed: `isNewUnrestorable` |
| A5 a graced issue's state restored with another field | Fixed: the update goes without its state (`holdState`) |
| A6 schema additions not ledgered | Ruled: D-8723; the `itemId` sentence corrected |
| A7, A8 a give-up lost with no owner, two calls per restart | Fixed: the give-up is written on the row before the mail; the upkeep read lists it |
| A9 a plan line beginning "Restored on" dropped | Fixed: only ccrc's exact line, only in Linear's copy |

## Fix round 2 (review run 2394)

The review read 2a8ecf45a with the full panel; the coordinator ruled A-1, A-2 and A-3. Main was merged once and the
migration is 92. Every fix has a test seen red against the code before it.

| Finding | Outcome |
|---|---|
| N1 the inbound hold cleared before the cancel was sent | Fixed: only a close done whole clears the hold, so a cancel refused with a retry word grows it (30 s, 2 min, 10 min) and the calls stop; `malformed` is given up after the last step |
| N2 a deferred link restore lost its initiative's watermark | Fixed: a deferred target keeps the watermark of every kind whose event rides on it; D-8723 gains that clause |
| A-1 any close quieted persistence | Ruled: only Keep (D-8720's words stand); Hand ends the binding's hold on its item, and the test raises the item after a Hand |
| A-2 one word, two rules (`not-configured`) | Ruled (b): the plan sync keeps its per-tick retry and wave 3's pin, and the inbound lane matches it. The word is answered locally, before any Linear call, so a retry each beat costs nothing and a key set in Settings is picked up on the next beat; a backoff spares Linear and the owner's mailbox, and neither is touched. The DEFERRALS row came out. A test drives the close through the real `runCcrcOp` with no key: three beats, three tries, no fetch, one mail |
| A-3 the inbound lane's own holds beside the plan sync's | Ruled: a 401 goes through the plan sync's one owner (`keyRefused`, which marks the slot rejected and blocks the workspace), and the inbound lane honours `keyBlockedUntil`, so a 401 holds both lanes alike. The lane's holds for the other retry words stay its own state on the shared schedule, LEGITIMATELY DIFFERENT: an inbound close must never hold a programme's plan sync (the coordinator's round 2 brief, point 3), so the two lanes share the schedule, never the state |

## Fix round 3 (review run 2408)

The review read 6e4a12a3c with the full panel; round 2's fixes were all built as ruled, and six of its eight mutations went
red. The coordinator ruled a short, closed list for this round (mail 23411), and carried the rest to a follow-up run after
landing (below). Main was merged once: done tests A (#2964) took 92, so the migration is 93 (coord-db pins 93; the
run-close replay undoes back to 53 and replays forty). Every fix has a test seen red before it: against the previous
code for F2, A-2, A-3 and A-8, and, for the test-only F1, F4 and A-5, by mutating the line each guards.

| Finding | Outcome |
|---|---|
| F1 the plan sync's 401 holding the inbound lane had no test | Test: the plan sync's call is refused 401, then a close in that workspace sends nothing until `keyBlockedUntil`, and lands at it. Red with the `keyBlockedUntil` clause removed from the act loop |
| F2 the malformed give-up counted the workspace's hold step | Fixed: the lane counts each close's malformed answers by its linearId (as the plan sync counts a binding's), and `inboundActVerdict` gives up on that count past the last step; the hold step is the wait only. Test: four timeouts and a give-up on one close, then a first malformed answer to a new close holds |
| F4 the Handed-to-nobody arm had no test | Test: Hand on a binding whose programme has no coordinator, then three restores in seven days raise a new item. Red with the arm's callback emptied |
| A-2 the not-configured mail's words, and one subject for two words | Fixed: each key word has its own mail and subject, so each is mailed once per issue; the not-configured mail says ccrc tries again at every beat and closes the issue once a key is set. The coordinator's "once per episode" is once per issue |
| A-3 a rate limit's Retry-After was dropped | Fixed (reversing round 2's majority, the coordinator's ruling): the answer's `retryAfterS` floors the close's wait, as the plan sync floors the same deferral |
| A-5 Task 4.1's state-type rule had no test | Test: In Progress → In Review is not drift, and a move to another state type is. Red with `stateType` out of `OWNED_FIELDS.issue` |
| A-8 the linear skill listed `linear-text-public` for the `linear` verbs | Fixed: the row is out of the skill's refusal table; a test holds the table to the proxy's words and the ones it shares with older routes |
| The merge's one CI red: the grace read a run's lineage itself | Moved (the coordinator's ruling, mail 23472): #2964 (done tests A) made its done-test reader the one reader of a run's `prLineage` and `doneTests.ts` the one decider of "merged" from it, with a guard (`single-definition/done-test-reader.test.ts`), after round 1 had built the §7.3 grace's own read in `driftPass.ts`. The decider `runPrMergedSeen` (merged in the lineage, else the session's listed PR merged on the run's own branch) now sits in `coord/doneTests.ts` and its gatherer `runPrMerged` in `coord/doneTestRead.ts`, taking the session's listed PR from its caller; the drift pass calls it and decides nothing. It is not the `pr-merged` predicate, which reads only the run's own close record: the grace asks while the run is still open (merging, no close record), and a wait for the close would restore an issue the merge just completed. The guard passes unchanged (its ADMITTED list and F4 untouched); the drift-pass grace tests are green, a merging run with no close record whose lineage says merged reads merged (red with the lineage clause removed), and the F1 re-read test still goes red under its mutation |

## Follow-ups

Carried to the follow-up run after landing, with the coordinator's rulings (mail 23411); none is built in this PR:

- **F3, a page-capped changed* read freezes its watermark** (`DRIFT_MAX_PAGES`, 10 pages of 100): a defect, in scope for
  the follow-up run. Direction: no change past the cap is ever skipped. Either keep the page cursor across passes, or
  read in a measured order and advance to the newest node read. Linear's order direction for `updatedAt` is not measured
  in the fixtures, so the cursor approach stands unless a capture proves the order; that capture joins the next-capture
  list.
- **A-1, the generic item dismiss quiets persistence:** the generic dismiss door must refuse a linear-drift action item
  (an L1 rule), so that only Keep quiets persistence.
- **A-4, the restore comment names no values:** it names them (§7.2), ccrc's own from the plan, and Linear's only from
  ccrc's directory reads, never free text.
- **A-6, the grace exempts any completion after a merge:** the actor is unread, so this is D-8703's cause; recorded there
  as a clause.
- **A-7, Hand on a coordinator-less (Upkeep) binding:** it goes to the project's Linear owner; with no owner, Hand is
  refused and the item stays.
- The changed* documents' actor (D-8703), with D-8699's by-id creator and `issueOwned`'s creator, at the next capture.
- A milestone description edit may not move its `updatedAt` (FX2 item 4), so `changedMilestones` may not see it.
- The inbound close's workspace hold (F8) lives in process memory: a restart costs one more call before the next refusal
  holds again.
- `deviation-refs.test.ts`' "two real trees" case times out under load on this box (git over two whole trees); CI decides.
