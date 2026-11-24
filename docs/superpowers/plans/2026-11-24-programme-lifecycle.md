# Programme lifecycle: plan

Spec: `docs/superpowers/specs/2026-11-24-programme-lifecycle-design.md`. Deviations D-8983..D-8992 (issued).

## The operator's rulings of 2026-11-24

R1 to R10 in the spec's §1: every coordinator joins a programme at spawn; a programme is a business objective; the
Overlord starts and ends programmes; an end is proposed by the coordinator and confirmed by the operator or the
Overlord, never a side effect (D-51 goes); the states are Open, Active, Idle, Paused, Done and Abandoned; no
Waiting-on-you item for idleness; a coordinator's exit leaves "no coordinator", not an end; every programme's page tells
its story; the backfill is the operator's per-programme decisions, applied from a private file; the `plain` role is
aligned with R1.

## Ground rules for every PR

- Red-first: each guard ships with a test measured red with the guard deleted or mutated, and the PR says which.
- Characterization first when moving code: pin today's inputs and outputs, green on `main`, before the move.
- Fixture HOMEs only (`makeCcdHarness`); never `ccd` against the live `$HOME`; suites in the foreground, one file at a
  time from inside the package, timeout at least 600000 ms.
- No programme slug, account or host in any fixture or text: fixtures use `project-a`, `programme-a`, `lane-a`.
- The per-programme decisions file is never committed, not even as a fixture with real slugs.
- Push once per round (D-8397).

## Waves and order

| Wave | Content | Depends on |
|---|---|---|
| W1 | The model: migration, the one writer, `lifecycleOf`, D-51 removed, gates re-pointed, the binding | — |
| W2 | The doors: start, state, hand over, end proposal, plan close, confirm, decline, archive, ticks, history, reads | W1 |
| W3 | Join at spawn: create routes, join sweep, provisional, filing, the start card, skill clause 22 | W1, W2 (file door) |
| W4 | The role code: `plain` retired | — (parallel with W1) |
| W5 | The console: lifecycle words, chips, coordinator line, History, controls, Finished fold, portfolio | W2 |
| W6 | The backfill door, then the operator's apply (an operational step, not a PR) | W2, W5 |
| W7 | The Overlord's cell and door rows | W2 |

## W1: the model (one PR, server and `shared/`)

1. **Characterization.** `coord-store-programme-lifecycle-char.test.ts`: today's `openRun` row creation, `closeRun`'s
   retire (`done`/`abandoned` at zero open runs), `programmeLive` on `planEnd`, `soleActiveCoordinator` on `state`,
   `claimsProgramme` on open runs. Green on `main`. Later tasks flip the rows they change in their own commits.
2. **`shared/programmeLifecycle.ts`** (L0, imports nothing): `ProgrammeLifecycle`, `lifecycleOf(stored, runs)`,
   `isEnded(stored)`, `CoordinatorLine` and `coordinatorLineOf(binding, registry)`. Tests: the spec §3 truth table
   row by row, including `planned`-only runs (Open or Idle, never Active) and an out-of-vocabulary state (Unknown);
   `coordinatorLineOf` never answers `no-coordinator` for an unreadable registry. Mutation: fold `unknown` into
   `active` → red.
3. **Migration** (the next slot when the PR lands): columns `coordinator`, `coordinatorSince`, `provisional`; table
   `programme_events` and its `(program, at)` index; the `started`, `coordinator` and `migrated` events; the state rule
   (spec §13 step 4). Tests: from the previous version's fixture — a D-51 `done` row with an open run migrates to
   `active` and shows Active; a `planEnd` row stays ended; `paused` stays; an out-of-vocabulary value is untouched;
   one `started` event per row; the binding seeded from the newest non-terminal run; the migration's SQL holds no
   string literal that could be a slug (a scan); a newer `user_version` refuses to start.
4. **`server/src/coord/programmeLifecycleStore.ts`** (L3): `decideInTx(slug, edge, actor, why, detail)`,
   `mintInTx(...)`, `bindCoordinatorInTx(...)`, `appendEventInTx(...)`. `CoordStore#setProgramState` and
   `planStore.ts#closePlan` become private steps of `decideInTx` or are deleted. Tests: every edge writes one event
   with actor and why; an equal target writes nothing; an end writes `planEnd` fields in the same transaction; a reopen
   clears them. Census (`single-definition/`): `UPDATE programs SET state`, `SET planEnd`, `SET coordinator` and
   `INSERT INTO programme_events` appear only in this file. Mutation: a second `UPDATE programs SET state` → red.
5. **Delete D-51** in `CoordStore#closeRun`. Test: closing the last run leaves stored `active` and shows Idle (red on
   `main`); a failed last run shows Idle too.
6. **Re-point the gates to `isEnded`**: `CoordStore#programmeLive`, `planStore.ts#planEndOf`'s gate users
   (`openRun.ts`'s `planGate`, `planRunFacts.ts`, the plan routes), `continuity/timerLane.ts` and `timers.ts`
   (`programme-ended`), `runClose.ts` and `runCloseRefusals.ts`, `overlapsLane.ts`, `continuity/routes.ts`,
   `planPolicy.ts#programmeEnd`, `linear/migration.ts`. The refusal code `plan-closed` is kept; its words change.
   Tests: each reader flips with the decision, not with `planEnd` alone.
7. **`openRun`**: rows created only through `mintInTx` (event `started`, actor the claimant); refusals
   `programme-paused` and `programme-provisional`; binds an empty coordinator; refuses a claimant other than the bound
   coordinator (`programme-has-coordinator`). Check before shipping that nothing opens runs into a `paused` row today
   (the Linear seed row, D-8186 proposals) and record the measurement in the PR. Tests: each refusal; a recycled slug
   cannot be ended and opened in one transaction.
8. **The binding readers**: `CoordStore#claimsProgramme` reads `programs.coordinator`; `soleActiveCoordinator`
   resolves over programmes that show Active (spec §9); `POST /api/runs/:id/reclaim` rebinds through
   `bindCoordinatorInTx`. Tests: an Idle programme's coordinator still owns it; two Active programmes → null; one
   Active with no binding → null; reclaim writes a `coordinator` event.

## W2: the doors (one PR, server)

1. **`POST /api/programmes`** (start), **`POST /api/programmes/:slug/state`** (`pause`, `resume`, `end`, `reopen`),
   **`POST /api/programmes/:slug/coordinator`** (hand over), all in `server/src/coord/ledgersRoutes.ts`'s operator
   registration. Decisions in an L1 decider `programmeEdgePolicy.ts#edgeDecision(stored, runs, edge, actorKind)`;
   the route acts. Tests: the transition table (spec §5) row by row, including `end` over open runs without and with
   `abandonRuns`, Done refused over open runs, reopen refused for the Overlord, pause working while sign-in is dark,
   the step-ups.
2. **`POST /api/programmes/:slug/end-proposal`**: box token, attribution, `claimsProgramme`; raises the decide row
   `action:'end-programme'` (the `endRequest.ts` shape) with evidence per `doneWhen` line. Tests: 401, 403
   `not-coordinator`, 409 `programme-runs-open`, `already-asked`, `programme-ended`; the item's text.
3. **`plan close` raises the proposal** (`planRoutes.ts`); it no longer writes `planEnd`. Tests: after `plan close`
   the programme is not ended and one item is waiting.
4. **Confirm and decline**: `POST /api/items/:id/act {programme}` (`endProgrammeByOperator`) runs `decideInTx`
   (`ended`, evidence, item id); `/decline` mails the coordinator and writes `end-declined`. Tests: both, and confirm
   refused while a run is open.
5. **Archive door**: `archiveDoor.ts#decideArchive`'s `{programme:'end'}` calls `decideInTx` (Abandoned, "archived with
   programme end") after abandoning the runs. Test: the programme is Abandoned with the event, without D-51.
6. **Ticks on idle**: `PROGRAMME_ENDED_SENTENCE` is refused only for an ended programme; an idle tick mails the bound
   coordinator; with none, `no-coordinator`. Tests: Idle tick delivered; ended tick refused; unbound refused.
7. **Reads**: `GET /api/programmes/:slug/history` (programme events merged with runs and `run_events`, oldest first)
   and `GET /api/sessions/:id/programme`. `programmesRead.ts#readProgrammes` adds `lifecycle`, `coordinatorLine`,
   `provisional`, `pausedOpenRuns` to `ProgrammeRow` (additive). Tests: the merged order; a migrated row says so.
8. **Census**: `LEDGER_OPERATOR_DOORS`, `gate.ts` EXEMPT for the box-token doors, `auth-gate.test.ts`, CLAUDE.md's
   box-token sentence in the same commit (`box-token-census.test.ts` checks both directions). Also CLAUDE.md's
   "Open wave N+1's run BEFORE closing wave N's" bullet: its reason changes from "the server retires the program" to
   "mail with no run id resolves only over a programme that shows Active".

## W3: join at spawn (one PR, server, ccd text, skill)

1. **`programmeJoin.ts#joinDecision`** (L1). Tests: `.child`, hold, anchor, Overlord, auditor, replay → skip; bound →
   `already-bound`; picked → `join-picked`; none → `mint-provisional`.
2. **`joinAtSpawn`** (L4) from `POST /api/sessions` and the non-child arm of `POST /api/projects/:project/workspaces`
   (optional `programme` body field), and from the start-programme sheet (`StartProgramSheet.tsx` passes the slug).
   Mints `p-<base36 ms>` with `provisional` 1; queues one system mail naming the programme. Tests: each route writes
   the row or the binding and the events; a slug collision retries with a suffix; the kickoff stays mail-only.
3. **The join sweep**: measure which existing lane re-reads the registry for the coordination store and extend it; if
   none fits, record the "legitimately different" reason in the PR. Live rows only. Tests: a hand-started session is
   joined on the next pass; an exited row is left alone; a second pass writes nothing.
4. **Filing**: `POST /api/programmes/:slug/file` (box token, the provisional's coordinator) and
   `POST /api/programmes/:slug/refile` (operator), one L1 decision `fileDecision`. `{into}` binds and deletes the
   placeholder; `{name, title}` mints and deletes it; the `filed` event carries the placeholder's start. `plan put`, the
   ledger item doors and `openRun` refuse a provisional slug. Tests: every arm and refusal; nothing else references the
   deleted slug (a scan over the tables that name a programme).
5. **The start card**: `ccd/session-hook.sh#_hook_role_card`'s fresh and revival texts become unconditional (spec §7).
   Tests: the hook suite's card-text pins, and children, held sessions and the anchor still get nothing.
6. **The coordinator skill**: clause 22 (`ccd/coordinator-skill/SKILL.md`) says the end is proposed with `plan close`
   and confirmed by the operator or the Overlord; `coordinator-skill.test.ts` updated in the same commit. References
   (`plan.md`, `api.md`, `resume.md`, `wave-steps.md`, `wave-lifecycle-5-boundary.md`,
   `wave-lifecycle-6-final-merge.md`) lose "the program retires" and gain filing and the end proposal.

## W4: the role code (one PR, server and `shared/`)

1. **Characterization**: `roleOf` and `profileFor` over today's fact grid, green on `main`.
2. `roleOf` decides from markers (spec §12); remove `coordinator-or-plain`, its `PROFILE_OF_UNDECIDED` arm, and `plain`
   from `FleetRole` and `FLEET_ROLES`; keep the renderer and compaction text auditor and replay use. A persisted `plain`
   reading revives as `coordinator`. Tests: a session with no runs and no intent is `coordinator`; `FLEET_ROLES` has no
   `plain`; auditor and replay cards are byte-identical to the characterization.
3. `POST /api/coord/plain-auto-memory` refuses `role-retired`; the Settings row is removed from the PWA. Test: the
   refusal; the stored value still reads.

## W5: the console (one PR, PWA)

1. `pwa/src/screens/programmeLifecycleWords.ts` (L1): the one reader of `lifecycle`, `coordinatorLine`, `provisional`,
   `pausedOpenRuns`; the words of spec §6.
2. The Programmes screen's chips with counts (Active, Idle, Open, Paused, No coordinator, Unfiled) and the Finished
   fold keyed on Done and Abandoned (`usePrograms.ts#endingWords`, `ProgrammeCard.tsx`); the Fleet header's "n idle"
   link.
3. `programmeIsLive` (`ledgerWords.ts`, `WaitingScreen.tsx`, `WaitingRoutes.tsx`, `ItemView.tsx`) reads the lifecycle,
   so an Idle programme's items are not shown as ended; `portfolioStore.ts`'s listing keeps every programme that has
   not ended (server).
4. The Programme page (`ProgrammeScreen.tsx`): History section from the history read; the coordinator line; Pause,
   Resume, End, Reopen, Hand to coordinator and Re-file controls, each asking for a why.
5. Tests: an Idle programme is under the Idle chip and not under Finished; its items are live; no Waiting-on-you row
   is raised for idleness; each control posts the right edge; the History renders every event kind.

## W6: the backfill (one PR, then the operator's act)

1. `POST /api/programmes/decisions` (spec §13): preview by default, `apply:true` behind the step-up; Settings, "Apply
   programme decisions", uploads a file from the operator's device. Tests (neutral slugs only): each preview refusal;
   `active`/`idle`/`open` mismatches reported and not forced; a second apply writes zero events; the answer's counts.
2. **Operational, not a PR**: after W1 to W5 are deployed, the operator previews then applies the private decisions
   file, and checks the answer's counts against R9. The join sweep's first pass binds the live coordinators that have
   no programme.

## W7: the Overlord (one PR)

1. `RUNG_CELL_MAP` gains `programme-lifecycle` (full only); `overlordDoors.ts` rows for start, end, hand over, confirm,
   decline; a `programme.end` row in `shared/decisionModel.ts`. Tests: refused at chat and advise, allowed at full; the
   event's `actorKind` is `overlord`; reopen and pause are not reachable through the Overlord's door.
2. `OVERLORD_OPERATOR_DOORS` and CLAUDE.md's sentence updated in the same commit.

## Deviations found

- **D-8983 (2026-11-24)** — one-end-fact-one-writer. `programs.state` is the programme's one decision fact and its end
  fact; `planEnd`, `planEndWhy` and `planEndAt` become the end's record, written with it by
  `programmeLifecycleStore.ts#decideInTx` in the same transaction, and cleared by a reopen. The D-51 auto-retire in
  `CoordStore#closeRun` is deleted, `setProgramState` and `closePlan` stop being writers, and every gate that read
  `planEnd` reads `isEnded(state)`. The refusal code `plan-closed` is kept for the ended programme (no second code).
  Overturns D-51 and D-8558's "NOT `programs.state`". The unmerged kept-worker branch (D-8980..D-8982) reads the same
  predicate.
- **D-8984 (2026-11-24)** — activity-is-derived. Open, Active and Idle are never stored: `lifecycleOf(stored, runs)` in
  `shared/programmeLifecycle.ts` decides them from the stored decision and the runs. A run in `planned` is not
  dispatched, so a programme with only planned runs is Open or Idle, not Active. An out-of-vocabulary stored value
  shows Unknown and is never folded into live or ended.
- **D-8985 (2026-11-24)** — the-coordinator-is-a-stored-binding. `programs.coordinator` names the programme's
  coordinator (one writer, `bindCoordinatorInTx`), seeded by the migration from the runs. `claimsProgramme` reads it,
  so an Idle programme keeps its owner; `openRun` binds an empty binding and refuses another claimant; the reclaim door
  and the operator's hand-over rebind it; `soleActiveCoordinator` resolves over programmes that show Active. Overturns
  spec 2026-10-17 §8's "coordinator-ness is derived from claims"; its "a lighter run kind is out of scope" stands.
- **D-8986 (2026-11-24)** — join-at-spawn-and-provisional. Every non-child coordinator session joins a programme: the
  create routes and the start sheet join the picked one, and a join sweep over live registry rows catches every other
  route and is R9's one-time pass. With no pick a provisional `p-<base36 ms>` row is minted; it can hold no run, plan
  or item, so filing it (`{into}` or `{name, title}`) deletes it and carries its start record onto the target. No ccd
  verb is added. The start card becomes unconditional. Overturns D-8142's conditional wording.
- **D-8987 (2026-11-24)** — an-end-is-proposed-then-confirmed. The coordinator's end proposal raises a decide item
  (`action:'end-programme'`) with evidence against the definition of done; `plan close` raises the same proposal and
  no longer ends anything; the operator or the Overlord confirms or declines. A direct end over open runs must name
  `abandonRuns` and is always Abandoned; the archive door's programme end is an explicit decision. Changes pinned
  coordinator clause 22.
- **D-8988 (2026-11-24)** — overlord-programme-lifecycle-cell. A `programme-lifecycle` cell (full rung only) and door
  rows let the Overlord start, end, hand over, confirm and decline; pause, resume and reopen stay the operator's. A
  `programme.end` decision-model row lets the operator arm or cap the Overlord's confirm.
- **D-8989 (2026-11-24)** — the-programme-tells-its-story. `programme_events` (append-only, one row per decision, mint,
  binding change, filing, end proposal and coordinator exit, each with actor kind, actor, why and detail) and
  `GET /api/programmes/:slug/history`, which merges them with the runs and `run_events`. Derived transitions (Open to
  Active, Active to Idle) write no programme event; the run rows record them.
- **D-8990 (2026-11-24)** — migration-by-rule-backfill-by-private-file. The migration names no programme: it rewrites
  the stored state by one rule (a set `planEnd` is an end, `paused` stays, every other known value becomes `active`),
  because D-51's values are side effects, not decisions, and records each changed row. The operator's per-programme
  decisions are applied from a private file through `POST /api/programmes/decisions` (preview, then apply with a
  step-up, idempotent); the file and its slugs never enter the repository.
- **D-8991 (2026-11-24)** — the-plain-role-retired. A non-child top-level session that is not the Overlord, an auditor
  or a replay is `coordinator`; `coordinator-or-plain`, its undecided profile and the `plain` role row go. The
  renderer auditor and replay reuse stays. The plain auto-memory door refuses `role-retired` for one release.
  Overturns the Overlord spec's §3.3.9 `plain` row and W1a's Settings row.
- **D-8992 (2026-11-24)** — idle-is-not-ended. An Idle programme raises no Waiting-on-you item, stays in the portfolio,
  is not folded under Finished, and its ticks mail its coordinator (refused `no-coordinator` when it has none). The
  Programmes screen's chips and the Fleet header's idle link make it easy to reach. Overturns the
  `PROGRAMME_ENDED_SENTENCE` rule of refusing a tick whenever no run is open.
