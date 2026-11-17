# Linear hierarchy, wave 3: the plan sync (D-8182) — task note

This note is the wave's record for the programme ledger. The coordinator folds it into the plan's ledger on its own
pull request. This pull request edits the plan in one place only, under the coordinator's exception: it defines the
wave's departure numbers, D-8675..D-8681 and D-8699..D-8701, in the plan's `## Deviations found`, where the deviation-refs
scan reads definitions. That edit carries a `Ledger-Edit:` trailer on the head commit. It changes no other line and no
checkbox.

## In short

- **What was built.** Tasks 3.1–3.5 of `docs/superpowers/plans/2026-11-10-linear-hierarchy.md`:
  - **3.1, the deciders:** `server/src/linear/planSyncPolicy.ts`, L1 and pure. It holds `planSyncSteps`,
    `plannedFingerprint`, `requestIdOf`, `fitProjectName` and the text builders.
  - **3.2, the executor:** `server/src/linear/planSync.ts`, L4. It runs one in-process pass per due key, binds
    objects, journals, applies the outcome table and runs the requeue, as lane `linearPlanSync` (`laneSchedule.ts`).
  - **3.3, the moves and closes:** team moves, the C12 read before a state change, cancel comments, and a project's
    extra teams.
  - **3.4, the dispatch:** a fresh work run for a ticket in a private project waits up to 12 s for the ticket's issue
    and is named `<identifier>-<words>`. Every other run gets a PR link on its issue.
  - **3.5, the initiatives item and its route:**
    - the initiatives-off `do` item, one per workspace, which settles on the lane's own beat;
    - `POST /api/items/:id/linear`, which is session-gated.
- **No migration** (D-8673). `ops.ts`, `shared/api.ts` and `coord/delegation-checkpoint.ts` are untouched. `coord/routes.ts`
  carries one 4-line insertion in the dispatch route, before its mutex.
- **Growth** of the capped files over the whole pull request: `watch.ts` +2, `server.ts` +1, `coord/store.ts` 0,
  `coord/routes.ts` +4.

## Departures (defined in the plan)

The coordinator issued these ten numbers for this wave: D-8675..D-8681 at the build, and D-8699..D-8701 in the review's
fix round. Each is defined briefly in the plan's own `## Deviations found`, under the coordinator's exception, because
the deviation-refs scan reads definitions only there. This note keeps the full record.

- D-8675, conflict-detail (defined in the plan): `ops.ts` is frozen, so a repeated create's answers are recognised in
  `hierarchyOps.ts`'s create shapers, not in `ops.ts`'s error table. The two answers are "conflict on insert of
  <Type>" and, for a milestone, "name not unique". `CcrcShaped`'s refusal arm gains `detail: 'conflict' | 'name-taken'`,
  and `runCcrcOp` passes it through. The journal still records `linear-invalid`.
- D-8676, recovery-by-request-id (defined in the plan): this replaces the plan's name-and-creator and name-in-project
  recovery. A create that may not have been sent adopts only ccrc's own object: an initiative or project at
  `id === requestId` made by the viewer, or a milestone at `id === requestId` inside its own bound project. Anything
  else is sent again with its id, so a lost race answers `conflict`. The conflict path then adopts only on
  `id === requestId` and `creatorId === viewer`, read by name. For an issue it adopts only on the planned team and when
  no other binding holds the issue. The final review measured another programme's same-named project being adopted
  after a rate-limited create.
- D-8677, link-by-fingerprint (defined in the plan): there is no link row and no migration. A project's link to its
  initiative is tracked by its fingerprint, F(planned) against F(planned with `initiativeId` null). The link carries
  the deterministic requestId `requestIdOf('epic', id, workspace, 'link')`, and its `conflict` answer means the link
  is already made.
- D-8678, write-ask-destination-team (defined in the plan): `LinearWriteAsk.resource` gains an optional
  `destinationTeamKey`, so a cross-team issue move asks the write policy about both teams. The journal keeps the current
  team. Nothing changes under `allowAll`.
- D-8679, pr-link-rule (defined in the plan): the dispatch's PR link (`issueLink`) is sent whenever the run's branch does
  not carry the issue identifier, replacing a check on the project's mode. A session's PR counts only when its branch
  is the run's own branch. A link refused with a failing word is given up for that URL: the issue stays bound and one
  mail names the cause. A deferring word defers.
- D-8680, requeue-keeps-bound (defined in the plan): `requeueFailed` returns a binding that has a Linear id to `bound`,
  keeping its fingerprint, so a retry sends an update (or a move, or a link), never a create. A binding with no Linear
  id returns to `pending`. The plan put every requeued binding back to `pending`.
- D-8681, no-unlink (defined in the plan): the brief's `SyncStep` listed `unlink`, but wave 3 builds none. A project
  whose initiatives are set off after it was linked keeps its link. The design's "Off by choice" (§9) covers only
  what comes next.
- D-8699, ownership-by-name-first-page (defined in the plan): a known limit, carried to the next capture rather than fixed.
  To prove an initiative or project is ccrc's own, the sync reads it by id and then reads a by-name listing of 10,
  across the workspace and with no team filter. With ten or more same-named objects, ccrc's own can fall off that page,
  so its ownership fails. It fails once, mails once per binding (measured: three requeues gave one mail), and retries on
  the 30-minute backoff without converging. The fix needs `creator { id }` and the teams on `initiativeById` and
  `projectById`, or an id filter, which is a document change in the frozen `ops.ts`. So it waits for the next capture,
  together with `issueOwned`'s creator, and the operator's go.
- D-8700, milestone-target-date-once-met (defined in the plan): a milestone's `targetDate` is ccrc's only from the day
  its checkpoint is met (spec §6.2 "target date once met", §5.3). An open checkpoint's milestone create and update leave
  `targetDate` out, both of the input and of the journal's fields list, so a date someone set in Linear survives a
  rename. A met checkpoint sets it and owns it from then on. The plan's journal fields listed `targetDate` on every
  update.
- D-8701, statuses-unread-distinct (defined in the plan): "statuses never read" is kept apart from "no status of that
  type". `ops.ts` is frozen, so the refresher records the read mark in the directory (`directory.ts`) beside the entries.
  A failed statuses page keeps what was held for the key, mark included. The sync treats unread statuses as a directory
  miss (refresh, then defer) and never fails an epic `status-missing` for them. This changes wave 2's pin in
  `linear-directory-hierarchy.test.ts`, the programme's own. An initiatives probe answering `unknown` defers the
  initiative step and leaves the projects' links alone, which also ends the double send of A3. The exit is bounded (the
  coordinator's ruling):
  - After three consecutive directory refills that all read `unknown` for a workspace, the pass settles without the
    initiative step. The projects stay unlinked, and nothing stays due for ever.
  - The programme's coordinator is mailed once per workspace and episode. The mail says ccrc cannot tell whether
    initiatives are on there, so the initiative waits while projects, milestones and issues still sync.
  - A later `on` reading creates the initiative, links the projects and ends the episode. No item is raised, because the
    "Turn on initiatives" item stays tied to a measured `off`.
  - Unread statuses are bounded the same way (the executor's ruling; the coordinator ruled only the probe). The wait
    escalates on the backoff instead of retrying every 10 s. After three consecutive unread refills, the coordinator
    is mailed once per workspace and episode. The pass keeps waiting, because nothing in that workspace can be built
    without statuses. A refill that reads the statuses ends the episode.
  - The refill count lives in process memory, so a restart restarts a streak. A long episode can then send a second
    mail. The mails go once per programme, like the sync's other mails.

## The wave's rulings

The coordinator's rulings from the brief applied as given:
- every create sends `id: requestId`;
- a milestone binds by its requestId inside its own bound project;
- a project name is at most 80 characters;
- comments never go on a milestone;
- an abandoned programme's initiative becomes `Canceled` (D-8674);
- no migration (D-8673);
- `readInitiativesProbe` never answers `off`, so the initiatives-off item is tested from directory state.

Beyond those, the executor decided:

| Ruling | What |
|---|---|
| Team ids | Team ids come from the slot store's learned teams. A team key with no team id is a `no-team-key` skip. |
| Programme binding | It is keyed by the `programs` row's rowid (`programmeRowId`). |
| Initiative status | `Completed` or `Canceled` once the programme ends. Otherwise `Active` when an epic is active or done, else `Planned`. |
| Egress | Every text is redacted for egress and carries ccrc's provenance. A project's description says "Part of <programme>." only while initiatives are off. |
| Upkeep keys | In wave 3 a due upkeep key is cleared and sends nothing. Upkeep epics arrive with wave 4. |
| Requeue | A failed binding is retried after the slot's directory refills, after 30 minutes, or when its inputs change. |
| Issue state read | A planned state change first reads the issue. If Linear already reads that state type, nothing is sent. A team mismatch always sends. |
| Cancel comments | Sent once, under `requestIdOf('ticket', id, workspace, 'cancel')`. |
| Project teams | A project's teams are the epic's team plus every same-workspace team its tickets file into. |
| Unreadable store | An unreadable Linear store defers the pass with the backoff and keeps its due row. It is never read as "no Linear". |
| Initiatives item | The item settles on the lane's beat, independent of any programme pass. Settling it marks the waiting programmes due. |

## The review's fix round

Review 2311 sent the wave back for one round. Each fix had a test written first and seen failing, unless noted.

| Finding | What changed |
|---|---|
| F1 (D-8701) | Statuses never read are a directory miss, and an `unknown` probe defers the initiative step. Both waits are bounded and mail the coordinator once per episode. |
| A3 | Ended by F1. A failed initiative keeps its projects' links, and no project is newly linked to it. |
| F2 | The initiative's workspaces come from the programme's own bindings, plus the placements of epics that are unbound or bound there. A re-keyed project creates nothing in its new workspace. The old initiative is still updated and is closed at the end. |
| F3, M2 | A bound ticket's team stays in its epic project's `teamIds` whatever its project key does, and inside one workspace until the move binds. |
| F5 | The snapshot leaves out every epic, checkpoint and ticket whose `putBackAt` is set. |
| F6 (D-8700) | An open checkpoint's milestone create and update leave `targetDate` out. |
| A2 | A `workspace-mismatch` skip with no slot in the old workspace fails its binding and mails once. |
| A7/A12 | A deferring failure's backoff holds against plan writes, run transitions, attaches and the dispatch's `ensureTicketBound`. An ordinary wait is still pulled to now. |
| F4 (D-8699) | Measured, not changed: the fail path mails once per binding and word. Three requeues gave one mail. A test pins it. |
| A5 | `item-act-mismatch` has its fixed sentence in `pwa/src/lib/refusalWords.ts`. |
| A6, A10 | A create records its team key. An issue read that finds a move already made binds the issue's new identifier. |
| M1, M5 | The directory's statuses mark is a required argument. `deferralOf` in L1 decides failure or wait and how long, and so do the episode decisions. |
| A8 | This note's opening paragraph. |

**A7/A12 changes the meaning of a column, with no migration.** `plan_sync_due.attempts` came with migration 59 and
nothing read it. Now:
- `deferSync(program, until, why)` takes `why`, which is `failure` or `wait`.
- A `failure` adds one to `attempts`. A `wait` sets it to 0.
- `attempts > 0` means the row is held by a failure. `markSyncDue` then keeps `dueAt` instead of taking the earlier time.

The plan's interface text (`deferSync(db, program, until)`, "increments `attempts`") describes the old meaning. The
plan is the coordinator's to edit, so this note records the change.

**Failures that hold the backoff.** Besides unreachable, timeout, policy-unavailable and journal-unavailable, these also
count as failures, because each is a backoff deferral in the plan's outcome table:
- rate-limited;
- malformed;
- a refused key;
- an unreadable store (C18);
- an ok answer with no id.

**F7: wiring that a test now guards.** Each test was shown red by mutating the line it guards, and the line was then
restored.
- The dispatch route's slug, in `server/test/plan-dispatch-route.test.ts`.
  - Mutation: `if (ticketSlug !== undefined) body.slug = ticketSlug;` became `void ticketSlug;`.
  - Result: the `ws-add` argv carried the caller's slug instead of `key-123-fix-the-thing`.
- The watcher's lane, in `server/test/plan-sync-lane.test.ts`.
  - Mutation: the `runLane('linearPlanSync', …)` line was deleted.
  - Result: `expected [] to deeply equal [1786000000000]`.

**Not red-first, by nature.** These pin behaviour that already held:
- F4's measurement;
- "an `unknown` probe keeps the links";
- "no item is raised on `unknown`".

## Follow-ups

Taken by the coordinator:
- D-8699: prove ownership by id rather than by a by-name page, at the next capture of `ops.ts`'s documents.
- Add `creator { id }` to `issueOwned` at the next capture. Issue adoption has no creator check today; it checks the
  planned team and that no other binding holds the issue.
- Show a project's extra `teamIds` to the write policy, the same class of gap as D-8678.
- Wave 4, open point: what a project set off after linking does to its existing link (D-8681).

From the final review's triage, fine to follow up:
- **Pass robustness:**
  - A thrown pass gets no backoff, and the tick's catch lines carry no error text.
  - A `next` step that makes no progress, which a coherent snapshot does not reach, spins to the pass's step cap.
  - The backoff and malformed counters live in memory, so a restart repeats one backoff step.
  - A throw after an initiatives item settles, before its programmes are marked due, loses that requeue. A slot
    removed for good leaves its item open.
- **Cost per pass:**
  - `planSyncSteps` runs once per step.
  - `ticketPrsOf` reads per bound ticket.
  - The items are queried per step.
  - The requeue sweep reads every programme's bindings each beat. A per-pass cache and one `failed` query are the fix
    if wave 7's adopted issues make this matter.
- **Linear reads and writes:**
  - The by-name read is unpaged (D-8699). If ccrc's own object falls past the first page, recovery re-sends the create, and
    Linear refuses it as a `conflict`.
  - A re-dropped ticket reuses the cancel requestId, so its second comment is not sent.
  - The C12 read also runs on plain edits.
  - `issueLink` carries no requestId (`ops.ts` is frozen); `attachmentLinkURL` upserts by issue and URL.
  - The `issueOwned` read's ask carries the destination team.
- **Dispatch:**
  - The 12 s wait runs before the dispatch's refusals.
  - A caller's invalid slug is normalised instead of refused in the private fresh-spawn case.
- **Initiatives item and its route:**
  - A dismissed initiatives item re-raises while the workspace reads off. Whether Dismiss should stick needs a product
    ruling.
  - The item route branches on the action's shape rather than on its verb. That is latent until a later verb carries
    `workspaceId`.
  - Check again with no slot answers `queued: false`.
- **Code layout:**
  - `planSync.ts` imports a pure helper from `planRoutes.ts`, which belongs in `planPolicy.ts`.
  - `planSyncPolicy.ts` imports `shared/plan.js` on two lines.
  - `PlanSync#restore` (wave 4's consumer) must route through `execute` before it is used.
- **Tests:**
  - The staleness pin should bound three calls per step.
  - Test hygiene: a negative-only test, and a test that reaches into private deps.
- **Found by the fix wave's re-review:**
  - A permanently refused project-to-initiative link fails the project binding. While it is failed, the epic's
    milestones and issues wait up to 30 minutes per change. A give-up like D-8679's for that link is a candidate.
  - The malformed-answer counters are never cleared.
  - The give-up-or-defer choice lives in the executor's outcome table, which should move to L1 with that table later.
- **From review 2311, wave 4:**
  - A1: a ticket added on a team the epic's project lacks is created before the project gains that team.
  - A4: a PR link is sent again when the PR's lookup answers nothing for one pass.
  - A11: ccrc's own object made under an old team is stranded failed if the key changes between a lost create reply
    and the recovery.
  - M3: a failure in one workspace holds the whole programme for up to 30 minutes, including its other workspaces' work.
    Holding per workspace is the fix.
  - The episode counts live in memory: a restart restarts a streak, so a long episode can mail twice.
  - The probe's 3-refill count is taken when a pass reads the directory, not when each refill lands. So a refill that
    reads `on` but that no pass sees does not end the episode, and the programme can settle early with one mail.
  - Once the bound is reached, a plan change re-reads the stored probe answer and asks for no refill. Only a refill can
    change that answer.
