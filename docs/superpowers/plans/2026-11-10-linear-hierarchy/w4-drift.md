# Linear hierarchy, wave 4: drift, inbound and public text (D-8183) — task note

This note is the wave's record for the programme ledger. The coordinator folds it into the plan's ledger on its own pull
request. This pull request edits the plan in one place only, under the coordinator's instruction: it defines the wave's
departure numbers, D-8703..D-8707, in the plan's `## Deviations found`, and records the coordinator's D-8681 ruling under
that entry. That edit carries a `Ledger-Edit:` trailer on the head commit. It changes no other line and no checkbox.

## In short

- **What was built.** Tasks 4.1–4.4 of `docs/superpowers/plans/2026-11-10-linear-hierarchy.md`, and Task 4.5 (wave 3's
  carried findings, from the brief):
  - **4.1, the migration and the drift deciders:** one migration for every table of the wave (it is entry 88: row
    revisions, #2965, took 87 while this was built; D-8673), `server/src/linear/driftPolicy.ts` (L1) and the plan store's
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
- **D-8681's ruling (no new number).** Links are compared one way: a planned link missing in Linear is drift, restored by
  linking with a fresh request id; a link the plan does not have (D-8681's kept link, or one a person added) is not drift,
  since nothing unlinks. A project's milestones compare the same way: a planned milestone missing is drift (recorded and
  asked about, since no op makes it again), and one a person added is theirs.

## The wave's rulings and the executor's

| Ruling | What |
|---|---|
| Comments | An issue, an initiative and a project take a restore comment (FX2 answer 3); a milestone takes a "Restored on <day>" line in its description, the last three kept (D-8407). The comment rows `initiativeComment` and `projectComment` reuse the session's comment document unchanged. |
| Grace | An issue Linear reads `completed` with no merge recorded waits one pass (`driftSince`), then is restored; with the merge recorded it is left. |
| One comment a day | While a binding's drift item is open, a restore comments at most once a day; persistence counts distinct restore times, not rows. |
| Unrestorable | A planned milestone missing from its project, or a milestone moved to another project, is recorded and raises the item at once (no op makes or re-parents one). |
| Kept plan | A binding whose item was kept is not raised again for seven days. |
| Description compare | Descriptions and names are compared after one normaliser (`normalText`: CRLF, per-line trailing spaces, blank-line runs), so a whitespace re-flow Linear makes is never drift. |
| Inbound pass word | The close of an inbound issue (its comment, then its cancel) runs under a new pass, `inbound`, in `LINEAR_CCRC_PASSES`. |
| A refused close | A refusal that may clear (a rate limit, unreachable, a timeout, an unavailable policy or journal, out of grammar, a key not configured or refused) retries at the next beat; any other gives the close up with one mail to the team's owner and is never sent again in that process (Review Focus 5). |
| Raised issue | A raised issue's row links to its operator item (`linear_inbound.itemId`, the one column the plan's table lacked); when the operator answers, the answer is mailed to the team's owner and the row is `mailed` again. |
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
| 4. ccrc's own object stranded under an old team key (round 1 A11) | `adoptionVerdict` adopts an issue by id alone (id = requestId, held by no other binding) and a project by id and viewer, whatever its team, and answers the object's actual team; the binding records it, so the next pass moves it. An issue made by another ccrc install with the same deterministic id would be adopted: a known limit, as before for an issue (no creator is read, D-8699's list). |
| 5. A project's extra teams reached no policy (D-8707) | `teamKeys` on the project steps, on `CcrcOpAsk` and on `LinearWriteAsk.resource`; never journaled. |
| 6. Episode streaks in memory | Persisted (`linear_sync_streaks`): a restart neither restarts an episode nor mails twice; a test reopens the store for both the probe and the statuses episodes. |
| 7. Three decisions in L4 (round 2 A3) | `probeRecheckDue`, `dispatchWaitVerdict` and `deferralUntil` (with `deferralUsesBackoff`) are pure, in `planSyncPolicy.ts`, each with its own tests. |
| 8. A link re-sent after an update (round 1 A3, round 2 A4) | The stored fingerprint carries the link mark, `<base>+<mark>` (`withLinkMark`, `linkMarkOf`), still with no link row (D-8677). Current = the base matches and (the initiative is not live, or the mark is the live initiative's). An update keeps the mark; a failed initiative sends its linked projects no update; a project is linked once. A fingerprint stored by wave 3's encoding reads not current once after the upgrade: one update, then one link Linear answers `conflict`. |
| 9. A PR link re-sent when the PR is unknown for a pass (round 1 A4) | The same mark for an issue's PR URL: a pass with no PR known sends nothing; a new URL is linked once. |
| 10. The probe mail misstated (round 2 A6) | `probeEpisodeText` (L1): an unbound initiative keeps today's sentence; a bound one says its update waits and its projects stay linked; an end waiting adds that the initiative closes once ccrc can tell. |
| 11. A test that never asserted its second statuses read (round 2 A7) | `linear-directory-hierarchy.test.ts` asserts both refreshes asked for the statuses page; skipping the second goes red. |

The executor's own notes: the dispatch wait starts its pass inside the timer race, since finding the ticket's workspace
reads the Linear store; four tests that forced a row due at a fixed clock now advance the clock past the workspace hold.

## Follow-ups

- The changed* documents' actor (D-8703), with D-8699's by-id creator and `issueOwned`'s creator, at the next capture.
- A milestone description edit may not move its `updatedAt` (FX2 item 4), so `changedMilestones` may not see it.
- A grace-pass issue with another drifted field is restored with its state too (the update carries the planned state);
  the next pass after the merge is recorded completes it again.
- A refused inbound close is forgotten by a restart, so it costs at most one more refused call per restart.
- `deviation-refs.test.ts`' "two real trees" case times out under load on this box (git over two whole trees); CI decides.
