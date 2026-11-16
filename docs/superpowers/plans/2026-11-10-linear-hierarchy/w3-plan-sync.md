# Linear hierarchy, wave 3: the plan sync (D-8182) — task note

This note is the wave's record for the programme ledger. The coordinator folds it into the plan's ledger on its own
pull request; this pull request does not edit the plan.

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

The coordinator issued these seven numbers for this wave (block D-8675..D-8681). Each one is defined briefly in the plan's own `## Deviations found`, where the deviation-refs scan reads definitions. This note keeps the full record.

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

## Follow-ups

Taken by the coordinator:
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
  - The by-name read is unpaged. If ccrc's own object falls past the first page, recovery re-sends the create, and
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
