# The Linear hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ccrc's plan gains epics, checkpoints and tickets, and ccrc keeps a matching Linear hierarchy (initiative,
project, milestone, issue) itself: it creates, moves and closes the objects, puts back edits people make, routes issues
filed straight into Linear through each project's Linear owner, and reshapes each team's existing issues by a migration
the operator approves in the console.

**Architecture:** The plan is a Coordination record in coord.db (`server/src/coord/plan*.ts`), declared by coordinators
through a new `ccrc-api plan` group. One server-side writer, the plan sync (`server/src/linear/planSync.ts`), turns plan
changes into Linear writes through fixed GraphQL documents, the write-policy port, the journal and the one rate service,
as the ccrc actor; no session writes a hierarchy object. A drift pass reads what changed in managed teams, restores
ccrc's owned fields and mails inbound issues to the Linear owner. The migration executor applies an approved per-team map
and records every move so *Put back* can replay it in reverse.

**Tech Stack:** TypeScript (shared, server, PWA), Fastify, `node:sqlite`, React, bash (`ccd/ccrc-api`), vitest (node,
jsdom and the browser leg).

**Spec:** `docs/superpowers/specs/2026-11-10-linear-hierarchy-design.md` (approved by the operator on 2026-11-10). Read it
whole before any task; the section numbers below (§n) are its sections.

## What was read first

On the design's base (`945834579`) and this branch:

- **The proxy** (`server/src/linear/`): `LINEAR_DOCUMENTS` and `LINEAR_OPS` in `ops.ts` (thirteen verbs, four mutations:
  `issueCreate`, `issueUpdate`, `commentCreate`, `attachmentLinkURL`); `callLinear` in `client.ts` is the one fetch path;
  `LinearRateService` in `rate.ts` has three lanes (`proxy` 1,700, `request` 100, `floor` 200 calls an hour of a slot's
  2,000); `LinearWriteAsk` in `policy.ts` knows one actor kind, `session`; `LINEAR_JOURNAL_OPS` in `journal.ts` holds
  the four session writes and four key acts, and `target` takes an issue identifier only; `LinearDirectoryEntries` holds
  states, labels, projects (`{id name}`) and users, filled by `LinearRefresher` every ten minutes.
- **The recorded fixtures** (`server/test/fixtures/linear/`, `linear-fixtures.test.ts`): every `LINEAR_DOCUMENTS` entry
  must have a recording byte for byte, except rows in `AWAITING_RECAPTURE` (today only `link`, constructed from the
  schema, D-8141). The recordings were made by a coordinator act with a throwaway key (D-7684, D-7743). No worker makes
  up an `X-Complexity`, an error code or a schema fact.
- **The plan model today**: `programs` (slug, title, state, `homeProject`, `specPath`, `inShort`, `doneWhen`) and `runs`
  in `server/src/coord/schema.ts`; `MIGRATIONS` ends at entry 53 on `main`; 54, 55 and 56 are taken by PRs landing first.
  The one run-transition writer is the private `CoordStore.advanceInner`: `advance` wraps it in its own `tx`, and
  `dispatchRun`, `closeRun` and the sweep's batch call it inside theirs (`settleEndRequests` already hangs off it, so
  no seam can skip it). `DatabaseSync` transactions do not nest. `operator_items.program` is `NOT NULL`; `ItemAction` in
  `shared/ledgers.ts` has two verbs, both carrying a `runId`, and `POST /api/items/:id/act` abandons a run.
- **What `programs` rows mean today**: the only creators are `runs open` (`INSERT … ON CONFLICT(slug) DO NOTHING`, state
  `active`, `homeProject`) and `reconstruct`. The only writer of `programs.state` after that is D-51's retirement in
  `closeRun`: when a programme's last open run closes it reads `done`, or `abandoned` if that run failed. That happens
  at every gap between sequential waves, and nothing sets it back to `active` (no writer of `paused` exists either). So
  `programs.state` is **not** a programme-end signal, and this plan never reads it as one.
  `CoordStore.soleActiveCoordinator()` answers only when exactly one row reads `active` (mail to `coordinator` with no
  `runId`, `tellSender`).
- **Presence on the server**: `coordinatorPresenceIn` (`shared/ledgers.ts`, `CoordinatorPresence` =
  `alive | dead | absent | unmeasured`, where `alive` covers an `asleep` session that mail wakes) and the `presenceOf`
  that `server.ts` builds once from the watcher's fleet frame and registry ids. (`pwa/src/fleet/presence.ts` is the
  PWA's own word and is not used here.)
- **The linking standard** (`project_linking`, `server/src/linking/policy.ts`): `linkingMode`, `ticketRefOfBranch`,
  `trackerIdsIn`; the PR route refuses `tracker-id-public`.
- **The client** (`ccd/ccrc-api`): `ROUTES` rows are `group.verb` with at most one `{id}`; `linear.*` and `linking.show`
  rows carry the pane's identity in the query; local refusals read `~/.ccrc/server-caps` (`ServerCap` in `shared/api.ts`).
- **The skills**: `ccd/coordinator-skill/SKILL.md` is capped (`server/test/skill-size-caps.json`) and keeps a
  twenty-clause contract; procedures live in `references/`. `coordinator-skill.test.ts` requires every
  `RUN_REFUSE_CODES` member to be named in the skill text.
- **The console**: `pwa/src/screens/settings/ProjectLinkingCard.tsx`, `pwa/src/fleet/AddProjectSheet.tsx`,
  `pwa/src/ledgers/ProgrammeScreen.tsx`, `pwa/src/ledgers/ItemActs.tsx` (`ItemControls`), `pwa/src/lib/routes.ts`
  (`ROUTES`, `programmePath`).

## Deviations found

These numbers were allocated to this plan. Each wave's PR cites its own; a departure found while building takes a fresh
number from `POST /api/ledger/deviations`.

- **D-8179 (2026-11-10)** — linear-hierarchy-plan: the Linear hierarchy plan and its departures from the design. The
  design's three-word verbs are hyphenated rows (`plan ticket-add`, `plan ticket-move`, `plan epic-drop`,
  `plan map-propose`) and the second operand (a checkpoint, a ticket, an issue reference) rides the JSON body, because
  `ccrc-api` takes `group verb [id]` with one id. Two migrations (57, 58), not one. Two new rate lanes carved from the
  proxy's. A fixture capture act (FX2) records the new documents and answers the design's builder questions 1 to 6
  before the first live write. A team's migration starts from an operator control on its project row (the design names
  no trigger), and the order rule is a refusal. An abandoned run returns its ticket to `open`. The sync's queue is a
  table. "Created after this build" is a column set at migration time. Hierarchy items act through a route of their own.
  A create with no idempotency key binds by name and creator, not by a hidden marker: two by-name reads
  (`initiativesByName`, `projectsByName`, each selecting `creator { id }`) join the fixed documents for it. Further
  departures, from the plan review:
  - **Programme end is the plan's, not `programs.state`'s.** §5.4's close table runs on a new `plan close` verb (the
    coordinator's explicit end, `done` or `abandoned` with a reason), or on a derived end: `programs.state` reads
    `done` and every epic is `done` or `dropped` with no ticket `open` or `started`. Any other state is live. Nothing
    is ever canceled on `abandoned` alone.
  - **`plan put` creates a new programme's row.** Its body gains `home` (required when no row exists) and an optional
    `title`; the row is inserted in the same transaction (`active`, `homeProject`, `planRequired` 1). `plan(slug)`
    answers `required: true` for an absent row, and `reconstruct` writes `planRequired` 0.
  - **The reserved `linear-sync` row is `paused`, never `active`**, so `soleActiveCoordinator()` is unchanged.
  - **The public-text check lands in wave 2** (Task 2.7), before any wave writes to Linear. The hashed private-name
    matcher moves into shared code (`shared/private-names.mjs`), and `server/test/private-names.mjs` keeps its CLI and
    re-exports the matcher. Each class's `catches` and `passes` fixtures stay in `topology-clean.test.ts`.
  - **`references/plan.md` ships with `plan-missing`** (wave 2). Wave 6 adds clause 21 and the later verbs, and wave 7
    adds `plan map-propose`.
  - **Wave 1 sends no new document live.** `directoryProjects` stays as recorded; the refresher starts the
    `projectStatuses` collection and the initiatives probe only in wave 3, after FX2 has recorded them.
  - **Further departures, from the second review:**
    - **The plan store holds the handle.** `planStore.ts` joins `core-vocab.test.ts`'s `HANDLE_HOLDERS` (the
      `ledgersStore.ts` idiom: every function takes the handle as an argument). Nothing else in `server/src/coord`
      names `coord.db`: the plan routes, the hierarchy routes, `PlanSync`, `DriftPass` and `LinearMigration` take a
      `PlanStorePort` (the store's functions bound to the handle), built once in `index.ts` beside `LinearJournal`.
    - **Plan writes share the run writers' mutex.** Every plan write runs under `CoordRoutesHandle.serial`, and the
      run insert re-checks the plan facts in its own transaction, so a run never opens into a closed plan, a dropped
      epic or a dropped ticket. A fifth run refusal, `plan-closed`, refuses `runs open` after `plan close`.
    - **One writer per Linear object.** `PlanSync` holds one in-process flight per due key; dispatch, the lane tick,
      the drift pass's restores and the migration's writes to adopted issues all go through it.
    - **"Live" for a programme with no declared plan is a non-terminal run.** §10.1 says "no live coordinator", but
      coordinators are long-lived, one per project, so presence would make nearly every done programme live and its
      open issues unmappable. Presence plays no part in the migration's rules.
    - **The migration creates the structure it declares,** as move rows with `before` null, so *Put back* cancels it
      from the move record alone.
  - **Further departures, from wave 2's build:**
    - **An epic is done only with something finished in it.** `epicIsDone` adds to §4.1's rule (no checkpoint `open`,
      no ticket `open` or `started`) that at least one checkpoint is `met` or one ticket `done`. An epic declared empty
      would otherwise close the moment it is put, and an epic with everything dropped is dropped, not finished.
    - **A `done` epic still takes a run and is reopened by it.** `epicAdmitsRun` admits every epic but a dropped one,
      so a later run in a wave a `done` epic lists (a retry, or a wave after its checkpoints were met) opens, and
      `attachTicketInTx` sets the epic back to `active` once every refusal is behind it. The design names no state a
      settled epic returns to.
  - **Further departures, from FX2's capture (D-8407; the answers are in `server/test/fixtures/linear/README.md`,
    "What FX2 measured"):**
    - **A milestone has no creator.** Linear's `ProjectMilestone` has no `creator` field: `projectById`,
      `changedProjects` and `changedMilestones` answered HTTP 400 `GRAPHQL_VALIDATION_FAILED` for it. The three
      documents drop it, and the milestone shapers no longer read a `creatorId`. A milestone binds by exact name inside
      its own bound project (the fallback Task 3.2 already names), and the "another creator" test row covers
      initiatives and projects only. Initiatives and projects keep `creator { id }`, which FX2 measured as the key's viewer.
    - **A repeated milestone create answers `name not unique`, not a conflict on insert.** Every hierarchy create takes
      a caller-chosen id, but Linear checks a milestone's name in its project first. For wave 3 (Task 3.2): on a
      milestone create, `INPUT_ERROR` "name not unique" means the milestone may already exist; the step reads its
      project's `projectById` and binds the milestone of that name whose id is the step's `requestId`, never a second
      create.
    - **A project name is at most 80 characters; ccrc's epic title allows 255.** Linear refuses a longer project name
      with `INVALID_INPUT` ("name must be shorter than or equal to 80 characters", in `userPresentableMessage`). An
      epic's title, which names its Linear project (design §5.2), is bounded by `PLAN_BOUNDS.titleChars` (255), and
      `LINEAR_NAME_MAX_CHARS` (80) bounds only names ccrc reads from Linear, not what the sync writes. Finding for
      wave 3: the plan sync must fit a project name to 80 characters before `projectCreate` and `projectUpdate`, and
      its by-name bind compares the name as sent. Initiative and milestone name limits were not measured.
    - **A milestone update moves neither its project's `updatedAt` nor, for a description-only edit, its own.** The
      drift pass (wave 4) reads changed milestones on their own, and cannot rely on `changedMilestones` alone to see a
      milestone's description edited in Linear.
    - **The initiatives-off probe answer is not recorded.** No workspace the operator has is off, and an on workspace
      with no initiatives answers an empty list, so the probe alone cannot tell off from empty; `readInitiativesProbe`
      keeps answering `unknown` for anything but nodes. The GitHub mirror observation (question 6) moves to the pilot
      team. Six hierarchy documents remain constructed until a later capture: `changedProjects` and
      `changedMilestones` (their corrected documents are unsent), `changedIssues`, `teamOpenIssues`, `projectUpdate`
      and `initiativeToProjectDelete`.
- **D-8180 (2026-11-10)** — linear-hierarchy-w1-proxy: wave 1, the proxy additions: the hierarchy documents and the
  ccrc operation rows, the ccrc actor in the write policy and the journal, the `sync` and `migration` rate lanes, the
  directory's status types and `statusOfType` (unsent until wave 3), and the server-internal caller `runCcrcOp`.
- **D-8181 (2026-11-10)** — linear-hierarchy-w2-plan: wave 2, ccrc's plan model: migration 57, the plan store and
  deciders, the plan verbs (`plan close` included) and their `ccrc-api` rows, runs attached to tickets with
  `wave-epic-mismatch`, `plan-missing`, `reserved-programme`, `ticket-unavailable` and `plan-closed`, the coordinator's
  `references/plan.md`, the per-project Linear owner settings, and the public-text check `linear-text-public`.
- **D-8182 (2026-11-10)** — linear-hierarchy-w3-sync: wave 3, the plan sync: open, move and close of the Linear
  objects from the plan, the initiatives-off item, the item act route, and dispatch waiting for a ticket's issue.
- **D-8183 (2026-11-10)** — linear-hierarchy-w4-drift: wave 4, migration 58, the drift pass and its restores, persistent
  drift, the inbound path (`plan triage`, `plan take`, the Upkeep epic, *Name a Linear owner*) and the `plan-owned`
  refusal.
- **D-8184 (2026-11-10)** — linear-hierarchy-w5-console: wave 5, the console: the project row's hierarchy settings, the
  programme page's Plan section, the epic and Upkeep pages, and the controls of the five hierarchy items.
- **D-8185 (2026-11-10)** — linear-hierarchy-w6-skills: wave 6, the coordinator, worker and Linear skills.
- **D-8186 (2026-11-10)** — linear-hierarchy-w7-migration: wave 7, the per-team migration: start, map propose and
  check, approve, apply at wave boundaries, report, follow-up maps and put back.
- **D-8407 (2026-11-13)** — linear-hierarchy-fx2: FX2's hierarchy capture lands as recorded fixtures, and its one
  schema defect is fixed: `ProjectMilestone` has no `creator`, so no document selects one and a milestone binds by name
  inside its project. Its other findings are the departures above.

## Global Constraints

- **Public repository.** No tracker ids, workspace or team names, hosts, IPs, account or session names, emails or
  private repository names in code, tests, fixtures, commits or docs. Examples use `KEY-123`, `AAA`/`BBB` team keys,
  `ws-a`/`ws-b`, `project-a`, `owner/repo`, `lane-a`. `topology-clean.test.ts` stays green on every branch.
- **One PR per wave**, ordered commits, one per task, each green before the next. Waves land in order 1 to 7; this plan
  lands first (its D-number lines define D-8179 to D-8186, and a tracked file cites a number only once a merged plan
  defines it). Each commit cites its wave's D-number and ends `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  author and committer are the identity the brief names. Named files only (never `git add -A`), `git rev-parse
  --show-toplevel` asserted before each commit, no stash, no push from a task.
- **Consolidation path guard.** No task touches `shared/switches.ts` or `server/src/notice.ts`. A task that finds it
  must, stops: that wave splits into a server PR and a PWA PR (`consolidation-path-guard.test.ts`).
- **Migrations.** This plan's first migration is **57** (wave 2), its second **58** (wave 4). Slots 54, 55 and 56 are
  taken by PRs landing first: **renumber to the next free slot at rebase**, re-measure with
  `git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'` before the PR and before
  merge, and write each entry's header comment in the file's idiom (what it adds, why an older build is safe, the
  re-measure command).
- **Census and pin rules every task keeps green:**
  - *single-definition*: every core word (`LINEAR_SYNC_PROGRAMME`, `UPKEEP_EPIC_KEY`, the plan state lists, the lane
    names, the ccrc provenance line, `PLAN_BOUNDS`) is spelled once and imported everywhere else;
    `server/test/single-definition/` gets a row for each new list.
  - *consolidation-census*: this plan adds no `runCcd` site; if one appears it handles `state.ran === false`.
  - *dispatch-mutex-gate*: `dispatchRun` and `closeRun` are only ever called inside `coordMutex.run(...)`; the dispatch
    wait for a ticket's issue (Task 3.4) runs **outside** the mutex, before it.
  - *secret-mask*: every new GET is in `MASKED_GET_ROUTES` (`server/src/server.ts`) or in `secret-mask.test.ts`'s
    inventory as masked inline or EXEMPT with its reason.
  - *L0 import pin*: `shared/api.ts` keeps exactly 16 import lines; new vocabulary lives in `shared/plan.ts`, which
    `shared/api.ts` never imports (`peers-claims-l0.test.ts`, `collect-lane-l0.test.ts`).
  - *mail-routes kebab census*: every quoted kebab word in `server/src/coord` is a declared code or passes an exported
    guard; this plan's words pass `isPlanKebab` (`shared/plan.ts`), joined to the guard list in `mail-routes.test.ts`;
    new run refusals join `RunRefuseCode` and are quoted in `server/src/coord`.
  - *ccd-contexts*: no `ccd/ccd` function is added; if one is, it gets its `ccd/contexts.tsv` row in definition order.
  - *ccd tests* read ccd via `ccdSource()`; this plan's bash change is `ccd/ccrc-api` only.
  - *watcher-quiet-census*: every test file that builds a `FleetWatcher` ends with `quietAtTestEnd` (or another form
    the census names).
  - *growth check*: `server/src/watch.ts`, `server/src/server.ts`, `server/src/coord/store.ts`,
    `server/src/coord/routes.ts` and `pwa/src/lib/api.ts` grow at most +40 net code lines per PR; logic lives in new
    files. A file that cannot stays under adds `server/test/growth-waivers/D-818x-<file>.json` with its reason in the
    same commit.
  - *handle holders*: `core-vocab.test.ts` lets only `HANDLE_HOLDERS` name `coord.db` in `server/src/coord`
    (`REACH`). `planStore.ts` joins the set in Task 2.2; every other plan file takes the `PlanStorePort`.
  - *verb-gate*: no new `CcdArgv` builder; a task that adds one adds its `PROBE_ARGS` row.
  - *box-token census, gate count, `ccrc-api` row count*: each new box-token route moves `box-token-census.test.ts`,
    the gate's route count and lane list in `server/src/auth/gate.ts` and `auth-gate.test.ts`; each new client row moves
    the count word above `ROUTES` and the counts in `ccrc-api.test.ts` and `ccrc-api-closed.test.ts`. Re-measure every
    count on `origin/main` before the PR.
  - *recorded fixtures*: every new `LINEAR_DOCUMENTS` entry has a recording byte for byte, or a constructed fixture and
    an `AWAITING_RECAPTURE` row until FX2 records it. No worker writes an `X-Complexity`, a header, an error code or a
    schema fact.
  - *refusal words*: every new word has its status in `REFUSAL_STATUS` (`shared/refusal.ts`) and a fixed sentence in
    `pwa/src/lib/refusalWords.ts`; the box's own text is never shown.
  - *rings*: new Fastify importers get a `server/test/rings/fastify-l4.data.ts` entry; L1 files import no I/O.
- **Tests**: `vitest --maxWorkers=2`, at most 12 files per command, never the whole server suite, each through
  `ccrc test -- <command>` on the fleet (commands below are written bare). Linear is faked at the `callLinear` boundary
  (`FetchLike`) with the recorded fixtures; nothing reaches a network. Browser files run locally (PR CI skips the leg):
  `( cd pwa && CCRC_CHROME=<Chrome binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts <files> )`.
- **Every PWA task** is judged at 360, 390, 1280, 1470 and 1920 px, in both skins (Refined, Instrument) and both themes,
  with the per-width table in its task; the coordinator word comes from `coordinatorRole()`.
- **The operator acts only in the console**, and each act's control sits on its item or its project row. Coordinators
  decide by default (their plan, triage, maps); only scope (`raise`) and the map's approval reach the operator.
- **Reusable by any installer.** No team key, workspace, team name, status name or machine in code. Statuses are found
  by type. Every setting is per project in the console.
- **Linear text is data.** Everything read from Linear is untrusted and shown under `untrusted`; nothing read from
  Linear ever changes the plan except through `plan triage` and `plan take`.

## Review Focus

1. **Renamed or missing statuses.** A workspace whose project statuses lack a `canceled` or `started` type, or whose
   issue workflow has no state of the needed type in a team: the sync marks that binding `failed`, mails the
   programme's coordinator once, and keeps going with every other object; it never throws, never picks by name. Test in
   Task 3.1 (`a missing status type fails the step, not the pass`).
2. **A restart between a create and its bind.** The server dies after Linear created an object and before the binding
   row says `bound`: the retry sends the same `requestId`, or, for a create with no idempotent id, reads by exact name
   in its scope (`initiativesByName`, `projectsByName`; a milestone from its project's `projectById`) and binds the one
   object whose `creator` is the key's viewer and that no binding holds. The journal row of that crash is still
   `pending` with no `result`, so `LinearJournal.viaFleet` cannot be the test. Nothing is created twice. Tests in Task
   3.2 (`a create answered conflict-on-insert binds the existing object`, `a crash with the journal row still pending
   binds by name and creator`).
3. **A project's team key changed or cleared after its objects are bound.** Cleared: bindings stay, the sync skips that
   project's objects and `plan show` marks them `unsynced`; changed within the workspace: open issues move to the new
   team (§5.3); changed to another workspace: bindings go `failed` with `ticket-workspace-mismatch` mailed to the
   coordinator, nothing moves. Test in Task 3.3.
4. **A plan revised while a sync pass is mid-way.** A `plan put` lands between two steps of a pass: the pass finishes
   its step, the programme is due again, and the next pass writes the new plan with no duplicate and no lost rename.
   Test in Task 3.2 (`a plan put during a pass is carried by the next pass`).
5. **The key loses write access to a team.** Linear answers `linear-forbidden` or `linear-invalid` on a write: the
   binding is `failed`, the coordinator is mailed, and for a restore the persistent-drift item is raised at once (§7.4);
   no retry loop spends the lane. Tests in Task 3.2 and Task 4.2.
6. **A wave gap is not a programme end.** The last run of a wave closes (done or failed) while later epics are planned:
   `programs.state` turns `done` or `abandoned` (D-51), and nothing in Linear closes. Test in Task 3.3.
7. **The reserved row and the mail resolver.** One live programme plus `linear-sync`: mail to `coordinator` with no
   `runId` still resolves. Test in Task 2.2.
8. **Two writers reaching one object.** A dispatch's `ensureTicketBound`, a lane tick the runner thinks stuck, a drift
   restore and the migration's write to an adopted issue all reach the same programme: each joins that programme's one
   flight, so a `name-and-creator` create is sent once and a restore never lands on top of a newer sync write. Tests in
   Task 3.2 and Task 3.4.

---

## File Structure

| File | Wave | Responsibility |
|---|---|---|
| `server/src/linear/hierarchyOps.ts` (new, L1) | 1 | `LINEAR_CCRC_OPS` rows, their variable builders and shapers, the initiatives probe reader, `withCcrcProvenance` (no document text and no mutation: `single-definition/linear-ops.test.ts` keeps both in `ops.ts`) |
| `server/src/linear/ops.ts` | 1 | `LINEAR_HIERARCHY_DOCUMENTS` (every hierarchy query and mutation string) and `LINEAR_CCRC_PROVENANCE_LINE`, spread into `LINEAR_DOCUMENTS`; `LinearDirectoryEntries` gains project statuses and the initiatives capability (filled from wave 3); `directoryProjects` unchanged |
| `server/src/linear/policy.ts` | 1 | `LinearWriteAsk` gains the `ccrc` actor, the hierarchy ops and the object kind |
| `server/src/linear/journal.ts` | 1 | The hierarchy ops and fields, `ccrcActor`, the UUID `target` and `result` |
| `server/src/linear/rate.ts` | 1 | Lanes `sync` and `migration` |
| `server/src/linear/refresher.ts`, `directory.ts` | 1, 3 | Wave 1: the new parts' types and readers, unsent; wave 3 (after FX2): fill project statuses and run the probe |
| `server/src/linear/ccrcCall.ts` (new) | 1 | `runCcrcOp`: rate, key, policy, journal, `callLinear`, shape, settle, as the ccrc actor |
| `server/test/fixtures/linear/*hierarchy*` | 1, FX2 | Constructed, then recorded, answers |
| `shared/plan.ts` (new, L0) | 2 | The plan vocabulary, bounds, wire types, refusal words, `isPlanKebab` |
| `shared/ledgers.ts` | 2 | `ItemAction` gains five hierarchy verbs; `parseItemAction` reads them |
| `shared/api.ts` | 2 | `RunRefuseCode` +5, `ServerCap` `plan-v1`, `ProjectLinkingWire` gains the hierarchy settings |
| `server/src/coord/schema.ts` | 2, 4 | Migrations 57 and 58 |
| `server/src/coord/planStore.ts` (new, L3) | 2 | Every SQL of the plan tables, bindings and the sync queue; a handle holder; `PlanStorePort` |
| `server/test/helpers/plan.ts` (new) | 2 | `seedLegacyProgramme`, so route tests that open runs on a fresh slug keep opening |
| `server/src/coord/planPolicy.ts` (new, L1) | 2 | Body parsing, the plan diff, state rules, caller and Linear-owner verdicts |
| `server/src/coord/planRoutes.ts` (new, L4) | 2, 4, 7 | The plan verbs' routes (`plan close` included) |
| `server/src/coord/hierarchyRoutes.ts` (new, L4) | 2, 3 | Per-project hierarchy settings, `GET /api/hierarchy`, `POST /api/items/:id/linear` |
| `server/src/coord/openRun.ts`, `routes.ts`, `store.ts` | 2, 3 | Run ↔ ticket attach, refusals, the dispatch wait |
| `ccd/ccrc-api` | 2, 4, 7 | The `plan.*` rows |
| `server/src/linear/planSyncPolicy.ts` (new, L1) | 3 | Steps from a snapshot, the texts, fingerprints, request ids |
| `server/src/linear/planSync.ts` (new, L4) | 3 | `PlanSync`: the due queue, passes, binding writes, dispatch wait |
| `server/src/laneSchedule.ts`, `server/src/watch.ts` | 3, 4, 7 | Lanes `linearPlanSync`, `linearDrift`, `linearMigration` |
| `server/src/linking/publicTextClasses.ts` (new) | 2 | The topology deny classes' `name`, `pattern`/`match`, `allowed` and `skipLine`, moved from the test suite (their `catches`/`passes` fixtures stay in `topology-clean.test.ts`) |
| `shared/private-names.mjs` (moved) | 2 | The hashed private-name matcher, moved from `server/test/private-names.mjs`, which keeps its CLI and the local scan and re-exports it |
| `server/src/linking/policy.ts` | 2, 3 | `publicTextVerdict`, `slugForTicket` |
| `server/src/linear/driftPolicy.ts` (new, L1), `driftPass.ts` (new, L4) | 4 | Drift verdicts, restores, inbound detection |
| `server/src/linear/migrationPolicy.ts` (new, L1), `migration.ts` (new, L4) | 7 | Map check, apply steps, put-back steps, executor |
| `pwa/src/ledgers/planWords.ts`, `PlanSection.tsx`, `EpicScreen.tsx`, `UpkeepScreen.tsx`, `LinearItemControls.tsx` (new) | 5 | The console |
| `pwa/src/screens/settings/ProjectLinkingCard.tsx`, `hierarchyWords.ts` (new), `pwa/src/fleet/AddProjectSheet.tsx` | 5, 7 | Per-project settings, migration control |
| `ccd/coordinator-skill/…`, `ccd/worker-skill/SKILL.md`, `ccd/linear-skill/SKILL.md` | 2, 4, 6, 7 | The skills (`references/plan.md` from wave 2) |

---

## Wave 1 — the proxy additions (D-8180)

Inert: nothing calls the new rows until wave 3. Testable alone over constructed and then recorded fixtures.

### Task 1.1: The hierarchy documents and the ccrc operation rows

**Files:**
- Create: `server/src/linear/hierarchyOps.ts` (rows and shapers only)
- Modify: `server/src/linear/ops.ts` (`LINEAR_HIERARCHY_DOCUMENTS` and `LINEAR_CCRC_PROVENANCE_LINE` declared here, spread
  into `LINEAR_DOCUMENTS`). `server/test/single-definition/linear-ops.test.ts` pins that every document and every
  mutation (`['`]mutation\s`, `issueCreate(`, …) is written in `ops.ts` and nowhere else, so no GraphQL text goes into
  `hierarchyOps.ts`; that census stays unchanged and green. `ops.ts` is not a growth-checked file.
- Create: `server/test/fixtures/linear/<name>-constructed.json`, one per new document (names below)
- Modify: `server/test/linear-fixtures.test.ts` (file count, `AWAITING_RECAPTURE`), `server/test/fixtures/linear/README.md`,
  `docs/superpowers/specs/2026-10-31-linear-central-key-design.md` (§2: one line pointing to this design's reversal of
  its initiatives non-goal, design §15 item 11)
- Test: `server/test/linear-hierarchy-ops.test.ts`, `server/test/linear-ops.test.ts` (census),
  `server/test/single-definition/linear-ops.test.ts` (unchanged, run)

**Interfaces:**
- Consumes: `isPlainObject`-style helpers are private to `ops.ts`; copy nothing, import `cleanName`, `stripLine`,
  `stripMultiline` from `shared/unprintable.js` and `isLinearUuid` from `shared/linear.js`.
- Produces:
  - `export const LINEAR_HIERARCHY_DOCUMENTS` (in `ops.ts`) — frozen record of query and mutation strings, keys:
    reads `initiativeById`, `projectById`, `projectStatuses`, `initiativesProbe`, `initiativesByName`,
    `projectsByName`, `changedInitiatives`, `changedProjects`, `changedMilestones`, `changedIssues`, `teamOpenIssues`,
    `issueOwned`;
    writes `initiativeCreate`, `initiativeUpdate`, `initiativeToProjectCreate`, `initiativeToProjectDelete`,
    `projectCreate`, `projectUpdate`, `projectMilestoneCreate`, `projectMilestoneUpdate`, `issueRelationCreate`.
  - `export type CcrcOpName = keyof typeof LINEAR_CCRC_OPS` — the hierarchy keys above plus `issueCreate`,
    `issueUpdate`, `issueComment`, `issueLink` (which reuse `LINEAR_DOCUMENTS.create/update/comment/link`).
  - `export const LINEAR_CCRC_JOURNAL_OPS = ['initiative-create', 'initiative-update', 'initiative-link', 'initiative-unlink', 'project-create', 'project-update', 'milestone-create', 'milestone-update', 'relation-create'] as const`
    and `export type LinearCcrcJournalOp = (typeof LINEAR_CCRC_JOURNAL_OPS)[number]`: the one list Task 1.2's policy and
    journal read (the issue rows journal as `create`, `update`, `comment`, `link`).
  - `export type CcrcOpInput = Readonly<Record<string, string | number | boolean | null | readonly string[]>>` — the
    closed record a row's `variables` reads: ids are lowercase UUIDs, texts already through `linear-egress`.
  - `export interface CcrcOpRow { op: CcrcOpName; class: 'read' | 'write'; document: string; journalOp: LinearCcrcJournalOp | 'create' | 'update' | 'comment' | 'link' | null; variables(input: CcrcOpInput): Record<string, unknown>; shape(body: unknown): CcrcShaped }`
  - `export const LINEAR_CCRC_OPS: Readonly<Record<CcrcOpName, CcrcOpRow>>`
  - `export type CcrcShaped = { ok: true; value: Record<string, unknown>; created: string | null } | { ok: false; word: LinearAnswerRefusalWord }`
  - `export function readInitiativesProbe(body: unknown): 'on' | 'off' | 'unknown'`
  - `export const LINEAR_CCRC_PROVENANCE_LINE = '— kept by ccrc from its plan'` (in `ops.ts`, beside the session line)
  - `export function withCcrcProvenance(text: string): string` (appends once after a blank line, as `withLinearProvenance` does)

What each document selects (the shapers read exactly these; the implementer writes the GraphQL text once, and FX2
records that text):
- initiative: `id name description status updatedAt projects(first: 50) { nodes { id } }`
- project: `id name description updatedAt status { id type } teams(first: 20) { nodes { key } } initiatives(first: 10) { nodes { id } } projectMilestones(first: 50) { nodes { id name description targetDate sortOrder updatedAt } }`
  (FX2 found no `creator` on `ProjectMilestone`, so the milestone selection has none, D-8407; a milestone binds by name
  inside its project, Task 3.2)
- `projectStatuses`: `id name type`, first 50; `initiativesProbe`: `initiatives(first: 1) { nodes { id } }`
- `initiativesByName`, `projectsByName`: filtered by exact `name`, first 10, each node `id name createdAt creator { id }`
  (a project also `teams(first: 20) { nodes { key } }`): the bind-by-name read of Task 3.2
- `changed*`: the same fields filtered by `updatedAt: { gt: $since }` (issues also by team key set), first 100, paged
- issue (`issueOwned`, `teamOpenIssues`, `changedIssues`): `id identifier title description updatedAt team { key } state { type } project { id } projectMilestone { id } parent { id } labels(first: 50) { nodes { id } }`
- every mutation answers `success` and the created or updated object's `id` (and `identifier` for issues)

- [ ] **Step 1: Write the failing tests**

```ts
// server/test/linear-hierarchy-ops.test.ts
it('every hierarchy document is in LINEAR_DOCUMENTS, and a mutation appears only as a write row', () => {
  for (const [k, doc] of Object.entries(LINEAR_HIERARCHY_DOCUMENTS)) expect(Object.values(LINEAR_DOCUMENTS)).toContain(doc);
  const writes = Object.values(LINEAR_CCRC_OPS).filter((r) => r.class === 'write').map((r) => r.document);
  for (const doc of Object.values(LINEAR_DOCUMENTS)) if (doc.startsWith('mutation')) expect(writes).toContain(doc);
});
it('no document deletes or archives an object (§8.1)', () => {
  for (const doc of Object.values(LINEAR_DOCUMENTS)) {
    expect(doc).not.toMatch(/(?:issue|project|initiative|projectMilestone)(?:Delete|Archive)\b/);
  }
});
it('initiativeToProjectDelete is the only *Delete* document, and it unlinks, never removes an object', () => {
  expect(Object.keys(LINEAR_HIERARCHY_DOCUMENTS).filter((k) => /Delete$/.test(k))).toEqual(['initiativeToProjectDelete']);
});
it.each(Object.keys(LINEAR_CCRC_OPS))('%s shapes its constructed fixture', (op) => {
  const r = linearRecord(fixtureOf(op as CcrcOpName));
  expect(LINEAR_CCRC_OPS[op as CcrcOpName].shape(r.body).ok).toBe(true);
});
it('a shaper refuses an answer outside its grammar as malformed', () => {
  expect(LINEAR_CCRC_OPS.projectById.shape({ data: { project: { id: 'not-a-uuid' } } })).toEqual({ ok: false, word: 'malformed' });
});
it('readInitiativesProbe: nodes → on, the recorded off answer → off, anything else → unknown', () => {
  expect(readInitiativesProbe({ data: { initiatives: { nodes: [] } } })).toBe('on');
  expect(readInitiativesProbe({ data: null, errors: [{ message: 'x', extensions: { code: 'SOMETHING_ELSE' } }] })).toBe('unknown');
});
it('withCcrcProvenance appends the line once', () => {
  expect(withCcrcProvenance(withCcrcProvenance('a'))).toBe(`a\n\n${LINEAR_CCRC_PROVENANCE_LINE}`);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd server && npx vitest run --maxWorkers=2 test/linear-hierarchy-ops.test.ts test/linear-fixtures.test.ts`
Expected: FAIL, `hierarchyOps.js` not found.

- [ ] **Step 3: Write the documents in `ops.ts`, the rows in `server/src/linear/hierarchyOps.ts`, and spread the
  documents into `LINEAR_DOCUMENTS`**

Write each document once, in `ops.ts`. Constructed fixtures follow `mutation-attachment-link-url-constructed.json`'s shape (fixture
UUIDs `00000000-000N-4000-8000-…`, team keys `AAA`/`BBB`, no recorded headers' numbers invented: a constructed file
carries no `x-complexity`), named `read-initiative-by-id-constructed.json`, `read-project-by-id-constructed.json`,
`read-project-statuses-constructed.json`, `read-initiatives-probe-constructed.json`,
`read-initiatives-by-name-constructed.json`, `read-projects-by-name-constructed.json`,
`read-changed-{initiatives,projects,milestones,issues}-constructed.json`, `read-team-open-issues-constructed.json`,
`read-issue-owned-constructed.json`, `mutation-{initiative-create,initiative-update,initiative-to-project-create,initiative-to-project-delete,project-create,project-update,project-milestone-create,project-milestone-update,issue-relation-create}-constructed.json`.
Each gets an `AWAITING_RECAPTURE` row in `linear-fixtures.test.ts`, and the README's table gains them under "constructed".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx vitest run --maxWorkers=2 test/linear-hierarchy-ops.test.ts test/linear-fixtures.test.ts test/linear-ops.test.ts test/single-definition/linear-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/linear/hierarchyOps.ts server/src/linear/ops.ts server/test/linear-hierarchy-ops.test.ts \
  server/test/linear-fixtures.test.ts server/test/linear-ops.test.ts server/test/fixtures/linear/README.md \
  server/test/fixtures/linear/*-constructed.json docs/superpowers/specs/2026-10-31-linear-central-key-design.md
git commit -m "feat(linear): the hierarchy documents and the ccrc operation rows (D-8180)"
```

### FX2: the hierarchy capture (the coordinator's act with the operator; not a subagent task)

Gates Task 3.1. It may run while waves 1 and 2 are in review; wave 1 may land with constructed fixtures.

The coordinator raises a `do` item asking the operator for a throwaway Linear key and a workspace to capture in (and a
second workspace with initiatives turned off, for the probe), and runs the capture on a machine the operator names,
never the fleet box and never the fleet's key, exactly as D-7743 records FX1. It sends each document of
`LINEAR_HIERARCHY_DOCUMENTS` byte for byte as Task 1.1 wrote it, scrubs to the fixture vocabulary, keeps the real
headers, and deletes the objects it created afterwards with its own calls, which are not kept. It also records:
1. introspections of `InitiativeCreateInput`, `ProjectCreateInput` and `ProjectMilestoneCreateInput` (does each take a
   caller-chosen `id`?) and a repeated create with the same `id` where one does (`conflict on insert`?);
2. the initiative status type (enum values; is there a canceled one?);
3. an introspection of `CommentCreateInput` (does it take an initiative, a project or a milestone?);
4. a milestone update followed by its project's read (does the project's `updatedAt` move?);
5. the probe on the initiatives-off workspace;
6. by observation, whether the GitHub mirror of a synced issue shows an issue relation and an attachment link;
7. `initiativesByName` and `projectsByName` on an object it created: does the exact-name filter hold, and does
   `creator { id }` read the key's viewer (the directory's `viewerId`)? And for milestones: does `ProjectMilestone`
   have a `creator` field (introspection), and does `projectById`'s milestone selection read it as the viewer?

It lands as one fixture-only commit (recorded files replace the constructed ones; their `AWAITING_RECAPTURE` rows are
removed; the README gains the answers in a "What FX2 measured" section) in a PR of its own, reviewed for leaked
names before it merges. Every later task that depends on an answer reads it from the README, never from this plan.

### Task 1.2: The ccrc actor in the write policy and the journal

**Files:**
- Modify: `server/src/linear/policy.ts`, `server/src/linear/journal.ts`
- Test: `server/test/linear-policy.test.ts`, `server/test/linear-journal.test.ts`, `server/test/linear-ops.test.ts` (the
  session shaper row)

**Interfaces:**
- Produces:
  - `LinearWriteAsk.actor: { kind: 'session'; id: string; uuid: string } | { kind: 'ccrc'; pass: CcrcPass }`
  - `export type CcrcPass = 'plan-sync' | 'drift-restore' | 'migration' | 'put-back'` (in `policy.ts`)
  - `LinearWriteAsk.resource.op` gains `LinearCcrcJournalOp` (Task 1.1's list, imported as a type);
    `resource.object: { kind: 'initiative' | 'project' | 'milestone' | 'issue'; id: string | null }`; `teamKey` may be
    null for an initiative.
  - `LINEAR_JOURNAL_OPS` spreads `LINEAR_CCRC_JOURNAL_OPS` after `link`.
  - `LINEAR_JOURNAL_FIELDS` rows: `initiative-create`/`-update`: `['name','description','status']`;
    `initiative-link`/`-unlink`: `['project']`; `project-create`/`-update`: `['name','description','status','teams','initiative']`;
    `milestone-create`/`-update`: `['name','description','targetDate','project']`; `relation-create`: `['type','related']`.
    The issue rows the sync writes journal as `create` and `update`, so `create` gains `milestone` and `update` gains
    `milestone` and `team` (§5.2 step 4's `projectMilestoneId`, §5.3's team move, the migration's moves and put back's
    restores). The session body shaper (`ops.ts`'s field map) still has no `projectMilestoneId` and no `teamId` on
    update, so a session can send neither.
  - `export function ccrcActor(pass: CcrcPass): CcrcActor` — a frozen, minted object whose `toString()` is
    `ccrc:<pass>`; `isCcrcActor(a: unknown): a is CcrcActor`.
  - `LinearPendingInput.actor: AccountActor | CcrcActor | null`. A ccrc write row: `sessionId` and `sessionUuid` null,
    `actor` a minted `CcrcActor`; `target` an issue identifier or a lowercase UUID; `result` an identifier or a UUID.

- [ ] **Step 1: Write the failing tests**

```ts
it('a ccrc write row records actor ccrc:<pass> and no session pair', () => {
  const j = new LinearJournal(db, () => 1);
  const w = j.pending({ op: 'project-create', sessionId: null, sessionUuid: null, actor: ccrcActor('plan-sync'),
    workspaceId: WS_A, teamKey: 'AAA', target: null, fields: ['name', 'description'] });
  expect(w.ok).toBe(true);
  expect(db.prepare('SELECT actor, sessionId FROM linear_events').get()).toEqual({ actor: 'ccrc:plan-sync', sessionId: null });
});
it('an unminted object shaped like a ccrc actor is refused (actor)', () => {
  expect(j.pending({ ...row, actor: { toString: () => 'ccrc:plan-sync' } as never })).toEqual({ ok: false, why: 'actor' });
});
it('a session pair on a ccrc op is refused (session)', () => { /* sessionId: 'lane-a' → { ok: false, why: 'session' } */ });
it('a UUID target and a UUID result settle on a hierarchy op', () => { /* settle(id, 'ok', undefined, UUID_B) → ok */ });
it('a field outside the op list is refused (fields)', () => { /* fields: ['title'] on project-create → fields */ });
it('a ccrc issue update moving team, project and milestone journals ok', () => {
  /* op 'update', actor ccrcActor('plan-sync'), target 'KEY-123', fields ['team','project','milestone'] → ok */
});
it('a session update naming team or milestone is still refused by the proxy body shaper', () => { /* … */ });
it('the policy point passes a ccrc ask to the policy unchanged', async () => {
  const seen: LinearWriteAsk[] = [];
  await askWithDeadline(async (a) => { seen.push(a); return { allow: true, decisionId: null }; }, ccrcAsk);
  expect(seen[0]!.actor).toEqual({ kind: 'ccrc', pass: 'plan-sync' });
});
```

- [ ] **Step 2: Run them to verify they fail** — `cd server && npx vitest run --maxWorkers=2 test/linear-journal.test.ts test/linear-policy.test.ts test/linear-ops.test.ts`; Expected: FAIL (`ccrcActor` not exported).
- [ ] **Step 3: Implement** the types and `pendingRefusal`'s ccrc arm in `journal.ts`; `settleRefusal` admits a UUID `result` on a hierarchy op; `policy.ts`'s docstring keeps "the actor is attribution, never a grant".
- [ ] **Step 4: Run them to verify they pass** — same command; Expected: PASS.
- [ ] **Step 5: Commit** — `git add server/src/linear/policy.ts server/src/linear/journal.ts server/test/linear-journal.test.ts server/test/linear-policy.test.ts server/test/linear-ops.test.ts`; message `feat(linear): the ccrc actor in the write policy and the journal (D-8180)`.

### Task 1.3: The `sync` and `migration` rate lanes

**Files:** Modify `server/src/linear/rate.ts`; Test `server/test/linear-rate.test.ts`.

**Interfaces:**
- Produces: `LINEAR_RATE_LANES = ['proxy', 'request', 'floor', 'sync', 'migration']`;
  `LINEAR_LANE_CALLS_PER_HOUR = { proxy: 1_400, request: 100, floor: 200, sync: 200, migration: 100 }` (still summing
  to `LINEAR_SLOT_CALLS_PER_HOUR`, 2,000; the migration's share is below the sync's and the sessions', §10.6).

- [ ] **Step 1: Write the failing tests**

```ts
it('the five lanes sum to the slot', () => {
  expect(Object.values(LINEAR_LANE_CALLS_PER_HOUR).reduce((a, b) => a + b, 0)).toBe(LINEAR_SLOT_CALLS_PER_HOUR);
});
it('a spent migration lane never takes from sync or proxy', () => {
  const r = new LinearRateService(() => T0);
  while (r.take({ lane: 'migration', slot: SLOT, calls: 1 }).ok) { /* spend */ }
  expect(r.take({ lane: 'sync', slot: SLOT, calls: 1 }).ok).toBe(true);
  expect(r.take({ lane: 'proxy', slot: SLOT, calls: 1 }).ok).toBe(true);
});
it('the migration lane is the smallest write lane', () => {
  expect(LINEAR_LANE_CALLS_PER_HOUR.migration).toBeLessThan(LINEAR_LANE_CALLS_PER_HOUR.sync);
});
```

- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/linear-rate.test.ts`; Expected: FAIL.
- [ ] **Step 3: Implement** the two rows; the restart share applies to them as to every lane.
- [ ] **Step 4: Run to pass** — same; Expected: PASS (the existing "restart starts at a quarter" rows cover the new lanes).
- [ ] **Step 5: Commit** — `git add server/src/linear/rate.ts server/test/linear-rate.test.ts`; `feat(linear): the sync and migration rate lanes (D-8180)`.

### Task 1.4: The directory's status types (unsent until wave 3)

Wave 1 is inert, and no new document is sent live before FX2 records it (a schema guess that Linear rejects would fail
the existing refresher's whole page and break sessions' `linear create --project` lookups). So this task changes no
live document and no refresher cycle: `LINEAR_DOCUMENTS.directoryProjects` and its recording stay as they are. A
project's status and teams are read by the sync through `projectById` (Task 1.1), from wave 3.

**Files:** Modify `server/src/linear/ops.ts` (`LinearDirectoryEntries`, `LINEAR_DIRECTORY_COLLECTIONS`'s type,
`readLinearDirectoryPage`), `server/src/linear/directory.ts`, `server/src/linear/refresher.ts` (the new parts default
empty and `unknown`; nothing new is sent); fixture: `directory-project-statuses-page-1-constructed.json` (new, with its
`AWAITING_RECAPTURE` row); Create `server/test/linear-directory-hierarchy.test.ts`; Test `server/test/linear-ops.test.ts`,
`server/test/linear-fixtures.test.ts` (the refresher has no test file of its own: its rows go in the new file, over
`linearServicesFake.ts`).

**Interfaces:**
- Produces:
  - `LinearDirectoryEntries.projectStatuses: readonly { id: string; name: string; type: string }[]` (empty until wave 3)
  - `LinearDirectoryEntries.initiatives: 'on' | 'off' | 'unknown'` (`unknown` until wave 3)
  - the page reader for `projectStatuses` (`LINEAR_HIERARCHY_DOCUMENTS.projectStatuses`), exported and tested over the
    constructed fixture, but not in the refresher's collection order yet. Task 3.2 (after FX2) adds the
    `projectStatuses` collection to the refresher and runs the probe (`initiativesProbe`) once per refresh on the
    `floor` lane, and also when a key is verified.
  - `export function statusOfType(entries: LinearDirectoryEntries, kind: 'project' | 'issue', type: string, teamKey: string | null): { id: string } | null`
    in `ops.ts`: the first status of that type (issue states per team), never by name.

- [ ] **Step 1: Write the failing tests** — `a directory page of project statuses reads id, name and type`;
  `a wave-1 refresh sends exactly the documents it sent before` (the fetch fake's request log against today's four);
  `statusOfType finds by type and ignores a renamed name` (a status named `Shipped` of type `completed` is found for
  `completed`); `statusOfType answers null when no status has the type`.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/linear-directory-hierarchy.test.ts test/linear-ops.test.ts test/linear-fixtures.test.ts`.
- [ ] **Step 3: Implement**; the directory keeps the slot-and-digest keying unchanged.
- [ ] **Step 4: Run to pass** — same command.
- [ ] **Step 5: Commit** — the files and the fixture; `feat(linear): status types in the directory, unsent until the capture (D-8180)`.

### Task 1.5: `runCcrcOp`, the server-internal caller

**Files:** Create `server/src/linear/ccrcCall.ts`; Modify `server/test/rings/fastify-l4.data.ts` only if it imports
Fastify (it must not); Test `server/test/linear-ccrc-call.test.ts` (uses `linearServicesFake.ts` and `linearFetchFake.ts`).

**Interfaces:**
- Consumes: `LINEAR_CCRC_OPS`, `ccrcActor`, `LinearRateService.take/settle`, `readLinearSlotKey`, `askWithDeadline`,
  `LinearJournal.pending/settle`, `callLinear`.
- Produces:
  - `export interface CcrcCallDeps { ccrcDir: string; rate: LinearRateService; journal: LinearJournal; policy: LinearWritePolicy; fetch?: FetchLike; timeoutMs?: number; now?: () => number }`
  - `export interface CcrcOpAsk { op: CcrcOpName; pass: CcrcPass; lane: 'sync' | 'migration' | 'floor'; slot: LinearSlotRef; workspaceId: string; teamKey: string | null; target: string | null; fields: readonly string[]; input: CcrcOpInput }`
  - `export type CcrcOpOutcome = { ok: true; value: Record<string, unknown>; created: string | null } | { ok: false; word: 'rate-limited'; retryAfterS: number } | { ok: false; word: 'policy-denied' | 'policy-unavailable' | 'journal-unavailable' | 'not-configured' | 'timeout' | 'unreachable' | 'linear-unauthorised' | LinearAnswerRefusalWord; maybeSent: boolean }`
  - `export async function runCcrcOp(deps: CcrcCallDeps, ask: CcrcOpAsk): Promise<CcrcOpOutcome>`

Order (the proxy's §6.3 order, less attribution and validation): take one call from the lane → read the key → for a
write: policy ask with `{ kind: 'ccrc', pass }` → journal `pending` (refused → `journal-unavailable`, nothing sent) →
`callLinear` → shape → journal settle (`ok` with `created`, `refused`/`failed`, or `unknown` with `maybeSent: true` on a
timeout after send) → rate settle (`oneCallOutcome`). A read skips the policy and the journal.

- [ ] **Step 1: Write the failing tests** — `a write is journaled pending before the call and ok after, with the created UUID`;
  `a denied policy sends nothing and journals denied`; `a refused journal row sends nothing`;
  `a timeout after send answers maybeSent and journals unknown`; `a rate-limited answer closes the slot for its wait`;
  `a read takes the lane and journals nothing`; `the key is read per call and never appears in an outcome or a log`
  (spy on `console.warn`, assert no `lin_api_fixture` text).
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/linear-ccrc-call.test.ts`.
- [ ] **Step 3: Implement** `runCcrcOp`; it never throws (a thrown fetch is `unreachable`).
- [ ] **Step 4: Run to pass**, then the wave's suite: `cd server && npx vitest run --maxWorkers=2 test/linear-ccrc-call.test.ts test/linear-hierarchy-ops.test.ts test/linear-journal.test.ts test/linear-policy.test.ts test/linear-rate.test.ts test/linear-fixtures.test.ts test/linear-ops.test.ts test/linear-key-containment.test.ts test/linear-proxy-routes.test.ts`
- [ ] **Step 5: Commit** — `feat(linear): runCcrcOp, the server's own Linear caller (D-8180)`. The key containment census
  (`linear-key-containment.test.ts`) gains `ccrcCall.ts` as an allowed reader of the key, with its mutant.

---

## Wave 2 — ccrc's plan model (D-8181)

Useful alone: coordinators declare plans and runs attach to tickets; nothing reaches Linear yet.

### Task 2.1: The plan vocabulary

**Files:** Create `shared/plan.ts`; Modify `shared/ledgers.ts` (`ItemAction`, `parseItemAction`), `shared/api.ts`
(`RunRefuseCode` and its map, `ServerCap`, `ProjectLinkingWire`), `shared/refusal.ts` (`REFUSAL_STATUS`,
`RUN_REFUSAL_STATUS`), `server/test/mail-routes.test.ts` (guard list); Test `server/test/plan-vocabulary.test.ts`,
`server/test/single-definition/plan.test.ts`.

**Interfaces:**
- Produces (`shared/plan.ts`, L0, imports only `./api.js` types and `./ledgers.js` types):
  - `EPIC_STATES = ['planned','active','done','dropped']`, `CHECKPOINT_KINDS = ['acceptance','operator-act','measured']`,
    `CHECKPOINT_STATES = ['open','met','dropped']`, `TICKET_KINDS = ['work','task','bug','follow-up']`,
    `TICKET_SOURCES = ['plan','worker','inbound']`, `TICKET_STATES = ['open','started','done','dropped']`,
    `PLAN_END_OUTCOMES = ['done','abandoned']` (type `PlanEndOutcome`),
    `BINDING_KINDS = ['programme','epic','checkpoint','ticket']`, `BINDING_STATES = ['pending','bound','failed']`,
    `MIGRATION_STATES = ['proposing','proposed','approved','applying','applied','put-back','failed']`,
    `HIERARCHY_STATES = ['not-migrated','map-waiting','migrating','migrated','put-back']`, each with its type.
  - `PLAN_BOUNDS = { epics: 24, checkpointsPerEpic: 16, ticketsPerBody: 200, titleChars: 255, summaryChars: 500, bodyBytes: 65_536, reasonChars: 500 } as const`
  - `LINEAR_SYNC_PROGRAMME = 'linear-sync'`, `UPKEEP_EPIC_KEY = 'upkeep'`, `UPKEEP_EPIC_TITLE = 'Upkeep'`
  - Keys use the programme slug grammar (`shapeProgramSlug` in `shared/api.ts`): `isPlanKey(v: unknown): v is string`.
  - Wire: `PlanPutBody { home?: string; title?: string; epics: PlanEpicBody[] }` (`home` is the programme's home
    project, required when the programme has no row yet and refused `plan-bad-body` when it differs from a stored
    one; `title` names a new programme, default from its slug);
    `PlanCloseBody { outcome: 'done' | 'abandoned'; why?: string }` (`why` required for `abandoned`); `PlanEpicBody { key; title; summary; project?; waves: number[]; checkpoints: PlanCheckpointBody[]; tickets?: PlanTicketBody[]; droppedWhy?: string }`;
    `PlanCheckpointBody { key; title; kind: CheckpointKind; proves?: number[]; itemId?: number }` (`itemId` only on an
    `operator-act` checkpoint: the operator item whose `done` marks it met, §4.1);
    `PlanTicketBody { key; kind: TicketKind; title; body?: string; project?: string; checkpoint?: string }`;
    `PlanView { program: string; planned: boolean; initiatives: { workspaceId: string; url: string | null; state: BindingState | 'off' | 'none' }[]; epics: EpicView[]; doneWhen: { text: string; proved: boolean }[] }`;
    `EpicView { key; title; summary; project; waves; state: EpicState; url: string | null; sync: BindingState | 'none' | 'unsynced'; checkpoints: CheckpointView[]; tickets: TicketView[] }`;
    `CheckpointView { key; title; kind; state; proves: number[]; metAt: number | null; evidence: CheckpointEvidence | null; url: string | null; sync: BindingState | 'none' | 'unsynced'; syncWord: string | null }`;
    `CheckpointEvidence = { pr: number } | { itemId: number } | { path: string }`;
    `TicketView { key; kind; title; project; checkpoint: string | null; source; state; runId: number | null; identifier: string | null; url: string | null; sync: BindingState | 'none' | 'unsynced'; syncWord: string | null }`
    (`EpicView` gains `syncWord` too: a `failed` binding's word, Task 3.2, so `plan show` names why);
    `HierarchyAnswer { ok: true; projects: HierarchyProjectRow[]; coordinators: { id: string; live: boolean }[] }`;
    `HierarchyProjectRow { project; teamKey: string | null; initiatives: 'on' | 'off'; linearOwner: string | null; ownerNow: { id: string | null; source: 'named' | 'default' | 'none'; live: boolean }; ownsTeam: boolean; state: HierarchyState; stateAt: number | null; itemId: number | null; inboundWaiting: number }`.
  - `PLAN_REFUSALS = ['not-plan-owner','not-linear-owner','plan-too-large','plan-bad-body','waves-not-contiguous','wave-overlap','dropped-needs-reason','unknown-epic','unknown-checkpoint','unknown-ticket','ticket-workspace-mismatch','linear-text-public','plan-owned','map-rewrites-plan','map-incomplete','migration-in-flight','not-managed','issue-not-inbound','item-act-mismatch','plan-closed','plan-runs-open'] as const`
  - `export const isPlanKebab = (tok: string): boolean` — true for every kebab word in the lists above (the state
    and kind lists included).
- Produces (`shared/ledgers.ts`): `ItemAction` gains `{ verb: 'linear-map'; migrationId: number }`,
  `{ verb: 'linear-report'; migrationId: number }`, `{ verb: 'linear-drift'; bindingId: number }`,
  `{ verb: 'linear-initiatives'; workspaceId: string }`, `{ verb: 'linear-owner'; project: string }`;
  `LinearItemAct = 'approve' | 'return' | 'put-back' | 'done' | 'hand' | 'keep' | 'check-again' | 'name'`;
  `LINEAR_ITEM_ACTS: Readonly<Record<LinearActionVerb, readonly LinearItemAct[]>>` =
  `{ 'linear-map': ['approve','return'], 'linear-report': ['put-back','done'], 'linear-drift': ['hand','keep'], 'linear-initiatives': ['check-again'], 'linear-owner': ['name'] }`;
  `isLinearItemAction(a: ItemAction | null)`. `parseItemAction` reads the five (a run action still needs `runId`).
  `actAbandons` stays false for them.
- Produces (`shared/api.ts`): `RunRefuseCode` gains `'wave-epic-mismatch' | 'plan-missing' | 'reserved-programme' | 'ticket-unavailable' | 'plan-closed'`
  (`plan-closed` is one word with one status, 409, whether a plan verb or `runs open` answers it);
  `ServerCap` gains `'plan-v1'`; `ProjectLinkingWire` gains `initiatives: 'on' | 'off'`, `linearOwner: string | null`,
  `ownsTeam: boolean`.
- Statuses: `not-plan-owner`, `not-linear-owner` 403; `unknown-epic`, `unknown-checkpoint`, `unknown-ticket` 404;
  `plan-too-large`, `plan-bad-body`, `waves-not-contiguous`, `dropped-needs-reason` 400; every other new word 409.

- [ ] **Step 1: Write the failing tests** — `every PLAN_REFUSALS word has a status`; `isPlanKebab admits the plan words and refuses run-unreadable`;
  `parseItemAction reads each linear verb and refuses one with a missing field`; `a linear action never abandons`;
  `the five new run refusals are RunRefuseCodes with statuses`; the single-definition row: `LINEAR_SYNC_PROGRAMME is spelled once`.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/plan-vocabulary.test.ts test/single-definition/plan.test.ts test/mail-routes.test.ts`.
- [ ] **Step 3: Implement**; `mail-routes.test.ts`'s guard list gains `|| isPlanKebab(tok)`; `shared/api.ts` gains no import line.
- [ ] **Step 4: Run to pass** — same, plus `test/peers-claims-l0.test.ts test/collect-lane-l0.test.ts test/refusal-status.test.ts`.
- [ ] **Step 5: Commit** — `feat(plan): the plan vocabulary (D-8181)`.

### Task 2.2: Migration 57 and the plan store

**Files:** Modify `server/src/coord/schema.ts` (entry 57), `server/src/coord/store.ts` (the hook line:
`advanceInner` calls `planStore.onRunAdvancedInTx` beside `settleEndRequests`, so `advance`, `dispatchRun`, `closeRun`
and the sweep's batch all reach it inside their own transaction; `reconstruct`'s programme INSERT writes
`planRequired` 0; Task 2.5 adds `openRun`'s ticket parameter), `server/src/coord/linkingStore.ts` (the three new
columns), `server/test/single-definition/core-vocab.test.ts` (`planStore.ts` joins `HANDLE_HOLDERS`, with its D-8181
line in the set's comment, beside `linkingStore.ts`'s); Create `server/src/coord/planStore.ts`;
Test `server/test/plan-store.test.ts`, `server/test/coord-db.test.ts` (the schema version), `server/test/coord-store.test.ts`.
`setProgramState` is **not** hooked: `programs.state` is not a programme-end signal (What was read first).

Without the `HANDLE_HOLDERS` row, `REACH` (`/\b(?:coord|store)\.db\s*[.,)]/`) turns `planStore.ts` red, and so would
`planRoutes.ts` and `hierarchyRoutes.ts` if they called `planOf(coord.db, …)`. They never do: they take the
`PlanStorePort`, which `index.ts` (outside `coord/`, where `new LinearJournal(coord.db)` already lives) builds once with
`planStorePort(coord.db)` and hands to the routes' opts, `PlanSync`, `DriftPass` and `LinearMigration`. `store.ts` and
`routes.ts` are holders already and call the free functions with their own handle.

Migration 57 (renumber at rebase):

```sql
CREATE TABLE plan_epics (id INTEGER PRIMARY KEY AUTOINCREMENT, program TEXT, project TEXT NOT NULL, waves TEXT NOT NULL,
  key TEXT NOT NULL, ordinal INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, state TEXT NOT NULL,
  droppedWhy TEXT, putBackAt INTEGER, openedAt INTEGER, doneAt INTEGER, UNIQUE (program, key));
CREATE UNIQUE INDEX plan_epics_upkeep ON plan_epics(project) WHERE program IS NULL;
CREATE TABLE plan_checkpoints (id INTEGER PRIMARY KEY AUTOINCREMENT, epicId INTEGER NOT NULL REFERENCES plan_epics(id),
  key TEXT NOT NULL, ordinal INTEGER NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, proves TEXT NOT NULL,
  state TEXT NOT NULL, droppedWhy TEXT, putBackAt INTEGER, metAt INTEGER, evidence TEXT, itemId INTEGER,
  UNIQUE (epicId, key));
CREATE TABLE plan_tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, program TEXT, project TEXT NOT NULL,
  epicId INTEGER NOT NULL REFERENCES plan_epics(id), checkpointId INTEGER REFERENCES plan_checkpoints(id), key TEXT NOT NULL,
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, source TEXT NOT NULL, state TEXT NOT NULL, runId INTEGER,
  droppedWhy TEXT, putBackAt INTEGER, UNIQUE (program, key));
CREATE UNIQUE INDEX plan_tickets_upkeep ON plan_tickets(epicId, key) WHERE program IS NULL;
ALTER TABLE runs ADD COLUMN ticketId INTEGER;
CREATE TABLE linear_bindings (id INTEGER PRIMARY KEY AUTOINCREMENT, localKind TEXT NOT NULL, localId INTEGER NOT NULL,
  workspaceId TEXT NOT NULL, teamKey TEXT, linearId TEXT, identifier TEXT, fingerprint TEXT, syncedAt INTEGER,
  state TEXT NOT NULL, failedAt INTEGER, failedWord TEXT, failedInputs TEXT, driftCount INTEGER NOT NULL DEFAULT 0,
  driftSince INTEGER, heldItemId INTEGER, UNIQUE (localKind, localId, workspaceId));
CREATE TABLE plan_sync_due (program TEXT PRIMARY KEY, dueAt INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
ALTER TABLE project_linking ADD COLUMN initiatives TEXT NOT NULL DEFAULT 'on';
ALTER TABLE project_linking ADD COLUMN linearOwner TEXT;
ALTER TABLE project_linking ADD COLUMN ownsTeam INTEGER NOT NULL DEFAULT 0;
ALTER TABLE programs ADD COLUMN planBy TEXT;
ALTER TABLE programs ADD COLUMN planAt INTEGER;
ALTER TABLE programs ADD COLUMN planRequired INTEGER NOT NULL DEFAULT 1;
ALTER TABLE programs ADD COLUMN planEnd TEXT;
ALTER TABLE programs ADD COLUMN planEndWhy TEXT;
ALTER TABLE programs ADD COLUMN planEndAt INTEGER;
UPDATE programs SET planRequired = 0;
INSERT OR IGNORE INTO programs (slug, title, createdAt, state, planRequired) VALUES ('linear-sync', 'Linear sync', 0, 'paused', 0);
```

`planRequired = 0` marks every programme that existed before this build (they open runs as today until their team
migrates, §4.3); a programme created later gets the default 1, and `reconstruct` (a legacy programme rebuilt from its
ledger) writes 0. The `linear-sync` row is the reserved item home (§7.6): it is inserted `paused`, never `active`,
because `soleActiveCoordinator()` answers only when exactly one row reads `active`, and an extra active row would turn
every `to: coordinator` mail with no `runId` (`routes.ts`) and the watcher's `tellSender` into `unknown-recipient` on a
box with one live programme. Nothing writes `paused` today, so nothing moves it. `runs open` and `plan put` refuse the
slug (Tasks 2.5, 2.4) and `readProgrammes` never lists a programme with no run. `planEnd` (`done` | `abandoned`),
`planEndWhy` and `planEndAt` are written only by `plan close` (Task 2.4).

`droppedWhy` is the reason a drop carries (`PlanChanges.drop[].why`, `ticket-move`'s `drop.why`, `epic-drop`'s
`why`), read by Task 3.3's cancel comment. `putBackAt` is set only by *Put back* (Task 7.4), on the records it drops;
the sync's snapshot leaves out every record with `putBackAt` set, so it emits nothing for them. It is a column, not a
reason text: a coordinator's own `droppedWhy` that happens to read "put back" is an ordinary drop. `failedAt`,
`failedWord` and `failedInputs` (the fingerprint of the planned inputs at failure) let Task 3.2 return a `failed`
binding to `pending`. `plan_sync_due.program` holds a programme slug or `upkeep:<project>` (Task 4.3).

**Interfaces:**
- Produces (types, in `planStore.ts`; Task 2.3 imports them as types):
  - `EpicRow { id; program: string | null; project; waves: number[]; key; ordinal; title; summary; state: EpicState; droppedWhy: string | null; putBackAt: number | null; openedAt: number | null; doneAt: number | null }`,
    `CheckpointRow { id; epicId; key; ordinal; title; kind; proves: number[]; state; droppedWhy: string | null; putBackAt: number | null; metAt; evidence: CheckpointEvidence | null; itemId: number | null }`,
    `TicketRow { id; program: string | null; project; epicId; checkpointId: number | null; key; kind; title; body; source; state; runId: number | null; droppedWhy: string | null; putBackAt: number | null }`,
    `BindingRow` (the table's columns), `StoredPlan { program: string; planBy: string | null; required: boolean; epics: (EpicRow & { checkpoints: CheckpointRow[]; tickets: TicketRow[] })[] }`.
  - `PlanChanges { epics: Changes<NewEpic, EpicPatch>; checkpoints: Changes<NewCheckpoint, CheckpointPatch>; tickets: Changes<NewTicket, TicketPatch> }`
    with `Changes<N, P> = { insert: N[]; update: (P & { id: number })[]; drop: { id: number; why: string }[] }`; a new
    checkpoint or ticket names its epic by `epicKey` (its epic may be inserted in the same change); patches carry only
    the fields that differ.
- Produces (`planStore.ts`, free functions over `DatabaseSync`). A function named `…InTx` runs inside the caller's
  open transaction and never opens one (`DatabaseSync` transactions do not nest, so calling a `tx`-opening writer from
  `advanceInner` would throw); every other write opens its own `tx`:
  - `planOf(db, program: string): StoredPlan` — epics with checkpoints and tickets, in ordinal order
  - `applyPlanChanges(db, program: string, changes: PlanChanges, by: string, now: number, newRow: { home: string; title: string } | null): void`
    — when `newRow` is given and no `programs` row exists, inserts it first in the same transaction (`active`,
    `homeProject` = `home`, `planRequired` 1, `INSERT … ON CONFLICT(slug) DO NOTHING`); then inserts, updates, drops
    (never deletes; a drop writes its `why` to `droppedWhy`); sets `planBy`/`planAt` on the first call; settles every
    epic it touched (`settleEpicInTx`: a drop or a move can leave an epic with nothing open); marks the programme due
  - `closePlan(db, program: string, outcome: PlanEndOutcome, why: string | null, now: number): void` — writes
    `planEnd`/`planEndWhy`/`planEndAt` once and marks the programme due
  - `planEndOf(db, program: string): { outcome: PlanEndOutcome; why: string | null; at: number } | null`
  - `settleEpicInTx(db, epicId: number, now: number): void` — the one writer of an epic's `done`: when the epic is
    `planned` or `active` and `epicIsDone` (Task 2.3) holds over its checkpoints and tickets, sets `done` and `doneAt`
    and marks its programme (or `upkeep:<project>`; an Upkeep epic never closes, so it is skipped) due. Called from
    `onRunAdvancedInTx`, `markCheckpointMet`, `applyPlanChanges` (drops and moves, for the source and the target
    epic), `updateTicket` (a ticket moved or dropped) and `plan take` (Task 4.3). Without it, the usual order (run
    `done`, then `plan met` with the PR) leaves the epic `active` for good, its Linear project never completes and
    `programmeEnd`'s derived `done` never fires.
  - `markCheckpointMet(db, checkpointId: number, evidence: CheckpointEvidence, now: number): void` — then
    `settleEpicInTx` on its epic, in the same transaction
  - `insertTicket(db, t: NewTicket, now: number): number`; `updateTicket(db, id: number, patch: TicketPatch, now: number): void`
    (a drop's `why` into `droppedWhy`)
  - `ticketById(db, id)`, `ticketByKey(db, program: string | null, epicId: number, key: string)`
  - `attachTicketInTx(db, runId: number, ticket: OpenRunTicket, now: number): { ok: true } | { ok: false; refused: 'plan-closed' | 'wave-epic-mismatch' | 'ticket-unavailable' }`
    — inside `openRun`'s transaction (Task 2.5): re-checks the plan facts (`planEnd` null, the epic live, an existing
    ticket `open` with no run), then inserts the auto ticket (key `run-<runId>`, deterministic) or re-projects the
    named one, and attaches it only when `runs.ticketId IS NULL` (a retried open attaches nothing twice)
  - `onRunAdvancedInTx(db, runId: number, from: RunState, to: RunState, now: number): void` — called from
    `advanceInner`: `dispatched` → ticket `started` and its epic `active` (first run); `done` → ticket `done`, then
    `settleEpicInTx`; `failed` → ticket `open`, `runId` cleared. A review run, or a run
    with no ticket, moves nothing. Marks the programme due through `markSyncDueInTx`.
  - `export interface PlanStorePort` — each function above and below, bound to one handle, without the `db`
    argument; `export function planStorePort(db: DatabaseSync): PlanStorePort` (called once, in `index.ts`).
  - `planOwnerOf(db, program: string): string | null` — the `claimedBy` of the programme's newest run, else `planBy`
  - bindings: `bindingOf(db, kind: BindingKind, localId: number, workspaceId: string): BindingRow | null`,
    `ensurePending(db, kind, localId, workspaceId, teamKey: string | null): BindingRow`,
    `markBound(db, id: number, linearId: string, identifier: string | null, fingerprint: string, now: number): void`,
    `markFailed(db, id: number, word: string, inputs: string, now: number): void`,
    `requeueFailed(db, where: { workspaceId?: string; bindingId?: number; olderThan?: number }): number` (back to
    `pending`, clearing the three `failed*` columns; Task 3.2's rules), `bindingsOf(db, program: string): BindingRow[]`
  - queue: `markSyncDue(db, program: string, at: number): void` and `markSyncDueInTx` (both keep the earlier `dueAt`), `dueSyncs(db, now: number): string[]`,
    `clearSyncDue(db, program: string): void`, `deferSync(db, program: string, until: number): void` (increments `attempts`)
  - settings: `hierarchySettingsOf(db, project)`, `setHierarchySettings(db, project, s: HierarchySettingsBody, by: string, at: number)`

- [ ] **Step 1: Write the failing tests** — `migration 57 applies on a file at 56 and an older build's SELECTs still run`;
  `every pre-existing programme reads planRequired 0 and a new one 1`; `linear-sync exists after the migration, paused`;
  `one real active programme plus linear-sync: soleActiveCoordinator still answers its claimant` (Review Focus 7);
  `a reconstructed programme reads planRequired 0`; `applyPlanChanges with newRow inserts the programme row active with
  its home, and a second call leaves it unchanged`;
  `dispatchRun starts the ticket and activates its epic` and `closeRun done closes the ticket, failed reopens it` (both
  driven through the store's own `dispatchRun` and `closeRun`, not `advance`, so the hook is proven on the path that
  bypasses `advance`); `no planStore InTx writer opens a transaction` (calling one inside `tx` does not throw);
  `a dropped key keeps its row with droppedWhy` (an epic, a checkpoint and a ticket); `two Upkeep epics for one
  project are refused by the index`;
  `onRunAdvancedInTx: done closes the epic too when nothing is open`;
  `plan met on the last checkpoint after the last run closes the epic`; `dropping the last open ticket closes the
  epic`; `a ticket moved out of an epic settles the source epic`; `an Upkeep epic never settles done`;
  `core-vocab's handle ring stays green with planStore.ts holding the handle`;
  `a review run's advance moves no ticket`; `markSyncDue keeps the earlier dueAt`; `planOwnerOf prefers the newest claimant, then planBy`.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/plan-store.test.ts test/coord-db.test.ts`.
- [ ] **Step 3: Implement** the entry with its header comment and the store; `store.ts` gains only the hook line and
  `reconstruct`'s column here.
- [ ] **Step 4: Run to pass** — same, plus `test/coord-store.test.ts test/linking-store.test.ts test/single-definition/core-vocab.test.ts`.
- [ ] **Step 5: Commit** — `feat(plan): migration 57 and the plan store (D-8181)`.

### Task 2.3: The plan deciders

**Files:** Create `server/src/coord/planPolicy.ts`; Test `server/test/plan-policy.test.ts`.

**Interfaces:**
- Consumes: `shared/plan.ts`; `StoredPlan`, `PlanChanges` and the row types from Task 2.2 (type imports).
- Produces:
  - `parsePlanPut(body: unknown): { ok: true; put: PlanPutBody } | { ok: false; word: 'plan-bad-body' | 'plan-too-large'; detail: string }`
    — closed bodies (unknown field refused), bounds from `PLAN_BOUNDS`, titles 1–255 code points with no control
    characters, keys `isPlanKey`, `proves` indexes inside the programme's done-when list length (passed in).
  - `diffPlan(stored: StoredPlan, put: PlanPutBody, ctx: PlanCtx): { ok: true; changes: PlanChanges } | { ok: false; word: PlanRefusal; detail: string }`
    where `PlanCtx = { home: string; doneWhenCount: number; workspaceOfProject(project: string): string | null }`;
    the route fills `home` from the stored row's `homeProject`, or from the put's `home` when no row exists (a put on
    an absent row with no `home` is `plan-bad-body` before `diffPlan` runs).
    Rules: waves of one epic are one contiguous range; no wave in two epics (live epics only) → `wave-overlap`; a key
    that disappears is dropped and needs `droppedWhy` on that epic or a `drops` map → `dropped-needs-reason`; a ticket
    whose project's workspace differs from its epic's → `ticket-workspace-mismatch`; a met or dropped checkpoint is not
    re-opened by a put; `itemId` on a checkpoint that is not `operator-act` is `plan-bad-body`.
  - `parsePlanClose(body: unknown): { ok: true; close: PlanCloseBody } | { ok: false; word: 'plan-bad-body' | 'dropped-needs-reason'; detail: string }`
    — `abandoned` with no `why` is `dropped-needs-reason`.
  - `programmeEnd(f: { planEnd: PlanEndOutcome | null; programState: ProgramState; epics: readonly { state: EpicState }[]; openTickets: number }): PlanEndOutcome | null`
    — the explicit `planEnd` when set; else `done` only when `programState` is `done`, there is at least one epic,
    every epic is `done` or `dropped` and no ticket is `open` or `started`; else `null` (live). Never `abandoned`
    without `planEnd`: a failed last run of a wave is not an abandoned programme.
  - `epicIsDone(checkpoints: readonly { state: CheckpointState }[], tickets: readonly { state: TicketState }[]): boolean`
  - `epicForWave(epics: readonly { id: number; waves: readonly number[]; state: EpicState }[], wave: number): number | null`
  - `planCallerVerdict(caller: string, owner: string | null, verb: 'programme' | 'follow-up', runOfCaller: { program: string; epicId: number | null } | null): { ok: true } | { ok: false; word: 'not-plan-owner' }`
    — a follow-up from a worker is allowed only into its own run's epic, kind `follow-up`.
  - `linearOwnerOf(project: string, f: OwnerFacts): { id: string | null; source: 'named' | 'default' | 'none'; live: boolean; gone: boolean }`
    with `OwnerFacts = { named: string | null; ownsTeamProject: string | null; latestProgrammeCoordinator(project: string): string | null; presence(id: string): CoordinatorPresence }`
    (`CoordinatorPresence` from `shared/ledgers.ts`): a shared team key answers the owning project's owner (default the
    first project that set the key). `live` is `alive` (which covers a hibernated, `asleep` session that mail wakes);
    `gone` is `dead` or `absent` only. `unmeasured` is a doubt, neither live nor gone: it never raises *Name a Linear
    owner* and never holds an inbound issue (§7.5, the coordinator-autonomy ruling).

- [ ] **Step 1: Write the failing tests** (one per rule, with the design's values):

```ts
it('25 epics is plan-too-large', () => expect(parsePlanPut({ epics: range(25).map(epic) })).toMatchObject({ ok: false, word: 'plan-too-large' }));
it('waves 2 and 4 in one epic is waves-not-contiguous', …);
it('wave 3 in two live epics is wave-overlap; in a dropped one it is not', …);
it('a vanished epic key without droppedWhy is dropped-needs-reason', …);
it('a ticket of project-b in an epic of project-a across workspaces is ticket-workspace-mismatch', …);
it('a 256-code-point title is plan-bad-body; a title with a control character is plan-bad-body', …);
it('proves [5] on a programme with 3 done-when entries is plan-bad-body', …);
it('epicIsDone: all met or dropped and no open or started ticket', …);
it('programmeEnd: state done with a planned epic is live; abandoned with no planEnd is live; planEnd wins', …);
it('a put on an absent programme with no home is plan-bad-body', …);
it('abandoned close with no why is dropped-needs-reason', …);
it('a worker files a follow-up into its own epic only', …);
it('the Linear owner of a shared key is the owning project\'s, and the default is the latest programme\'s coordinator', …);
it('an owner whose presence is unmeasured is not gone', …);
```

- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/plan-policy.test.ts`.
- [ ] **Step 3: Implement**; pure, no I/O, no clock.
- [ ] **Step 4: Run to pass**.
- [ ] **Step 5: Commit** — `feat(plan): the plan deciders (D-8181)`.

### Task 2.4: The plan routes and the `ccrc-api plan` rows

**Files:** Create `server/src/coord/planRoutes.ts`; Modify `server/src/server.ts` (register after
`registerCoordRoutes`, passing its handle's `serial`; +`MASKED_GET_ROUTES` entry), `server/src/index.ts` and
`server/src/deps.ts` (`planStorePort(coord.db)` built once, `plan?: PlanStorePort` on the deps), `server/src/auth/gate.ts` (EXEMPT rows and counts), `ccd/ccrc-api` (rows, identity fill, the `plan-v1` local
refusal), `server/test/rings/fastify-l4.data.ts`; Test `server/test/plan-routes.test.ts`, `server/test/ccrc-api.test.ts`,
`server/test/ccrc-api-closed.test.ts`, `server/test/box-token-census.test.ts`, `server/test/auth-gate.test.ts`,
`server/test/secret-mask.test.ts`.

**Interfaces:**
- Consumes: Tasks 2.1–2.3; `attributionVerdict` (as `attribute`), `checkMailToken`, `refuseRoute`, the Linear store
  read and `routeLinear` for `workspaceOfProject`, `redactShapedCount('linear-egress', …)` on every text field.
- `PlanRouteOpts { coord: CoordStore | undefined; plan: PlanStorePort | undefined; serial: CoordRoutesHandle['serial']; mailToken: () => string | BoxTokenHolder | null; attribute: (id: string, uuid: string) => Promise<AttributionRead>; sessionAuth: (req: FastifyRequest) => SessionVerdict; authEnabled: boolean; readLinearStore: () => Promise<LinearStoreRead>; runOfSession: (id: string) => { program: string; epicId: number | null } | null; now: () => number }`
  (`linkingStore`'s and the goals read's deps, gathered the same way in `server.ts`; `serial` is the handle
  `registerCoordRoutes` returns, so these routes are registered after it). Every plan **write** (put, met,
  ticket-add, ticket-move, epic-drop, close; later take, triage and map-propose) runs its checks and its store write
  inside `serial(...)`, the same `coordMutex` that holds `POST /api/runs` from its preconditions to its insert, so a
  plan write never lands between a run's plan check and its attach. Attribution and any Linear read run before it,
  outside. `plan show` takes no lock. The routes read and write only through `plan`; no `coord.db` (Task 2.2).
- Produces routes (box token, then the identity pair from the query, then attribution, then the caller check):
  - `POST /api/programmes/:slug/plan` (`plan put`) → `{ ok: true, plan: PlanView }`. The slug `LINEAR_SYNC_PROGRAMME`
    is refused `reserved-programme` (409, its run status). On a slug with no `programs` row (a new programme, which
    clause 21 declares before its first run), `home` is required and the row is inserted in the same transaction as
    the plan (`applyPlanChanges`'s `newRow`: `active`, `homeProject`, `planRequired` 1); the later `runs open` keeps it
    (its INSERT is `ON CONFLICT DO NOTHING`). A put after `plan close` is `plan-closed`.
  - `GET /api/programmes/:slug/plan` (`plan show`), EXEMPT-BUT-AUTHENTICATED (a session cookie or the box token, the
    goals read's stance), in `MASKED_GET_ROUTES`
  - `POST /api/programmes/:slug/plan/met` body `{ checkpoint, evidence }`
  - `POST /api/programmes/:slug/plan/tickets` body `PlanTicketBody & { epic: string }` (`plan ticket-add`)
  - `POST /api/programmes/:slug/plan/tickets/move` body `{ ticket, epic?, checkpoint?, project?, drop?: { why } }`
  - `POST /api/programmes/:slug/plan/epics/drop` body `{ epic, why }`
  - `POST /api/programmes/:slug/plan/close` body `PlanCloseBody` (`plan close`): the coordinator's explicit programme
    end, the only source of an `abandoned` end (§5.4). Refused `plan-runs-open` while any run of the programme is not
    terminal, `plan-closed` when already closed; `abandoned` needs `why`.
  - `export function registerPlanRoutes(app: FastifyInstance, opts: PlanRouteOpts): void`
  - `ccd/ccrc-api` rows: `[plan.put]='POST|/api/programmes/{id}/plan|yes|-'`, `[plan.show]='GET|/api/programmes/{id}/plan|yes|-'`,
    `[plan.met]='POST|/api/programmes/{id}/plan/met|yes|-'`, `[plan.ticket-add]='POST|/api/programmes/{id}/plan/tickets|yes|-'`,
    `[plan.ticket-move]='POST|/api/programmes/{id}/plan/tickets/move|yes|-'`, `[plan.epic-drop]='POST|/api/programmes/{id}/plan/epics/drop|yes|-'`,
    `[plan.close]='POST|/api/programmes/{id}/plan/close|yes|-'`.
    Every `plan.*` row but `plan.show` gets the pane's identity in the query (the `linear.*` block's rule, never the
    body); every `plan.*` row is refused locally `no-plan-door` when a current cap file omits `plan-v1`.
  - `serverCaps` lists `plan-v1`.

- [ ] **Step 1: Write the failing tests** — `a put by the claimant stores the plan and answers PlanView`;
  `a put by another session is not-plan-owner`; `a programme with no run accepts its first put and records planBy`;
  `a put on a new slug with home inserts the programme row (active, that home, planRequired 1), and a later runs open
  keeps it`; `a put on a new slug with no home is plan-bad-body and stores nothing`; `a put on linear-sync is
  reserved-programme`; `close abandoned with no why is dropped-needs-reason`; `close with a run working is
  plan-runs-open`; `a put after close is plan-closed`; `a plan close sent while a runs open waits on its child gate
  lands after the open, then answers plan-runs-open` (the shared `serial`); `plan met on the last checkpoint after
  the last run closes the epic`;
  `a tokenless call is 401 before anything is read`; `plan show answers a cookie and a token alike, masked`;
  `met with evidence {pr: 12} marks the checkpoint`; `ticket-add by a worker into another epic is not-plan-owner`;
  `ticket-move with drop and no why is dropped-needs-reason`; in `ccrc-api.test.ts`: `plan put sends byId and byUuid in the query and the body unchanged`,
  `plan show sends no identity`, `a current cap file without plan-v1 refuses no-plan-door and sends nothing`.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/plan-routes.test.ts test/ccrc-api.test.ts test/ccrc-api-closed.test.ts`.
- [ ] **Step 3: Implement**; the route decides nothing `planPolicy.ts` decides.
- [ ] **Step 4: Run to pass** — plus `test/box-token-census.test.ts test/auth-gate.test.ts test/secret-mask.test.ts test/rings/fastify-l4.test.ts`; update each count after re-measuring on `origin/main`.
- [ ] **Step 5: Commit** — `feat(plan): the plan verbs and their ccrc-api rows (D-8181)`.

### Task 2.5: Runs attach to tickets

**Files:** Modify `server/src/coord/openRun.ts` (`OPEN_RUN_GATES`: `reservedProgramme`, `ticketShape` after `shape`;
`planGate` after `homeVerdict`), `server/src/coord/routes.ts` (`POST /api/runs`: the plan facts and the ticket handed
to `openRun`), `server/src/coord/store.ts` (`openRun`'s optional `ticket` parameter and its one
`attachTicketInTx` call inside the transaction that inserts the run; a `server/test/growth-waivers/D-8181-store.json`
if the wave's store.ts growth passes +40), `ccd/coordinator-skill/references/api.md` (the five new codes, one recovery
line each; `plan-missing`'s points at
`references/plan.md`); Create `ccd/coordinator-skill/references/plan.md` (the refusal ships with its recovery: the
`plan put` body by example, the design's §4.3 JSON with `home`, and the wave-2 verbs `plan put`, `plan show`,
`plan met`, `plan ticket-add`, `plan ticket-move`, `plan epic-drop`, `plan close`, each with its body and refusals.
Verbs are named as `ccrc-api plan <verb>` commands, never as raw `POST /api/...` paths, because
`coordinator-skill.test.ts`'s route census reads only `coord/routes.ts` and `reviewRoundsRoute.ts`. Wave 6 adds
clause 21 and the later verbs, and wave 7 adds `plan map-propose`);
Test `server/test/open-run-preconditions.test.ts` (gate-order rows, and its facts builder's default `plan` fact),
`server/test/run-routes.test.ts`, `server/test/plan-run-attach.test.ts` (new), `server/test/coordinator-skill.test.ts`,
`server/test/ccrc-api-closed.test.ts` (the pinned list of client commands the skill corpora run gains each `plan.*`
key that `plan.md` runs).

**The ripple into existing route tests.** `plan(slug)` answers `required: true` for an absent row, so every existing
test that opens a run through `POST /api/runs` on a fresh database and a new slug is refused `plan-missing` from this
task on. Measured on this branch's base with `grep -rln "url: '/api/runs'" server/test`, narrowed to the files that
inject a `POST` (the rest only `GET` the list): `archive-coord-handle`, `auth-gate`, `child-reclaim-refusals`,
`coord-attribution`, `coord-caps-route`, `cross-project-claimant-security`, `fable-ladder-door`,
`fable-operator-only`, `home-project-required`, `landing-writes-route`, `open-run-preconditions`,
`route-unreadable-series`, `run-binding-bind-records`, `run-open-registry-id`, `run-route-order`, `run-route-route`,
`run-route-session-trail`, `run-routes`, `runs-attribution-switch` (each `server/test/<name>.test.ts`). Re-measure
on `origin/main` before the PR (both greps, and any helper that posts the route under another spelling), and add
every file found. The fix:
- Create `server/test/helpers/plan.ts` with `seedLegacyProgramme(db: DatabaseSync, slug: string, home: string): void`,
  which inserts the programme's row as a pre-plan programme (`active`, `homeProject` = `home`, `planRequired` 0, the
  same INSERT `runs open` uses). A test whose open is incidental calls it before the open, with the home the open
  sends, and opens as today. (A test file is not under `REACH`'s coord-directory scan.)
- A test whose subject is a **new** programme's first open (`home-project-required`, the new-slug rows of
  `run-routes` and `open-run-preconditions`) declares the plan first through `POST /api/programmes/:slug/plan` with
  the same `home`, so the "no stored row" arm it tests is still reached by a programme the plan inserted; each
  assertion that read "absent row" semantics is re-derived and named in the commit message.
- `open-run-preconditions.test.ts`'s facts builder gets a default `plan` fact (`{ required: false, ended: false,
  epics: [], ticket: () => null }`), so its existing rows keep their verdicts and only the new rows set it.
- These files land in **their own commit**, before the feature commit: `test(plan): route tests seed a legacy
  programme before plan-missing (D-8181)`, run in batches of at most 12 files.

**Interfaces:**
- Consumes: `epicForWave`, `planOf`, `planEndOf`, `attachTicketInTx` (Task 2.2).
- Produces: `OpenRunFacts` gains `plan(slug: string): { required: boolean; ended: boolean; epics: …; ticket(key: string): TicketRow | null } `;
  `required` is the row's `planRequired`, and `true` for a slug with no `programs` row (a new programme that skipped
  `plan put`: answering false would silently disarm `plan-missing`); `ended` is `planEnd IS NOT NULL`;
  `OpenRunPlan` gains `ticket: OpenRunTicket | null`, with
  `OpenRunTicket = { kind: 'existing'; id: number; epicId: number; reproject: string | null } | { kind: 'new'; epicId: number; project: string; title: string }`.
  Refusals: `reserved-programme` (slug `LINEAR_SYNC_PROGRAMME`); `plan-closed` (the plan reads `ended`: `runs open`
  after `plan close`, which the sync would otherwise answer by closing the initiative under a live run);
  `plan-missing` (no epic and `planRequired` 1); `wave-epic-mismatch` (no live epic lists the wave, or the named
  ticket's epic is not the wave's); `ticket-unavailable` (the ticket is `done`, `dropped`, `started` by another run,
  or an Upkeep ticket). Each has its `OPEN_RUN_GATES` row, its `RUN_REFUSAL_STATUS` and its line in `api.md`. A review
  run attaches nothing. A run with no `ticket` in a planned programme gets a new ticket (kind `work`, the run's
  project, the run's title, key `run-<runId>`, which `UNIQUE (program, key)` needs and a retry derives again) in the
  wave's epic; a named ticket in another project takes the run's project.
- **The attach is atomic and idempotent.** The route hands the verdict's `ticket` to `coord.openRun`, and `openRun`
  calls `attachTicketInTx` inside the same transaction that inserts the `planned` row. So a crash leaves either no
  run or a run with its ticket, never a run with no ticket in a programme that requires a plan (whose Linear issue
  would never be made). `attachTicketInTx` re-reads the plan facts in that transaction (`planEnd` null, the epic
  live, the named ticket `open` with no run): the preconditions are read inside the mutex but before
  `childBindGate`'s wait (up to 25 s) and the registry reads, and Task 2.4's writers share the mutex, but the
  re-check makes the insert's own transaction the authority. A failed re-check rolls the insert back and `openRun`
  answers `{ refused: 'plan-closed' | 'wave-epic-mismatch' | 'ticket-unavailable' }`, which the route already sends
  through `refuseRun`. `openRun`'s retry arm (it returns the same `planned` row for the same programme, wave and
  claimant) attaches only when `runs.ticketId IS NULL`, so a retried open never makes a second ticket or a second
  Linear issue.

- [ ] **Step 1: Write the failing tests** — the five refusals, each with its gate-order row and reorder mutant;
  `a run with no ticket gets one in its wave's epic, keyed run-<id>`; `a run opened with a ticket of project-a in project-b re-projects the ticket`;
  `an older programme (planRequired 0) with no plan opens as today`; `a review run never gets a ticket`;
  `a new slug with no row and no plan is plan-missing`; `runs open after plan close is plan-closed`;
  `a retried open answers the same run and leaves one ticket`; `an epic dropped between the gate and the insert
  refuses wave-epic-mismatch and leaves no planned row` (the drop injected through the `childBindGate` fake's wait);
  `a throw after the run insert rolls back the ticket too` (`plan-run-attach.test.ts`); the coordinator corpus names
  the five codes; `plan.md` names every wave-2 plan verb and the body's `home`.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/open-run-preconditions.test.ts test/run-routes.test.ts test/plan-run-attach.test.ts test/coordinator-skill.test.ts test/mail-routes.test.ts test/ccrc-api-closed.test.ts test/skill-size-ratchet.test.ts`.
- [ ] **Step 3: Implement**; the five codes are quoted in `server/src/coord` (the reverse scan).
- [ ] **Step 4: Run to pass** — plus the measured ripple files above, at most 12 per command.
- [ ] **Step 5: Commit** — the ripple commit first (above), then `feat(plan): runs attach to tickets (D-8181)`.

### Task 2.6: The per-project hierarchy settings (server half)

**Files:** Create `server/src/coord/hierarchyRoutes.ts`; Modify `server/src/server.ts` (register; `GET /api/hierarchy`
in `MASKED_GET_ROUTES`), `server/src/coord/linkingStore.ts` (the wire's new fields in `linkingOf`);
Test `server/test/hierarchy-routes.test.ts`.

**Interfaces:**
- Consumes: `linearOwnerOf`, `setHierarchySettings`, and the `presenceOf` that `server.ts` already builds once
  (`coordinatorPresenceIn` over the watcher's fleet frame and registry ids, `shared/ledgers.ts`), passed in as
  `HierarchyRouteOpts.presenceOf: (id: string) => CoordinatorPresence`: the session standing the console already
  shows (§15 item 10). `alive` (covering `asleep`) is live, `dead`/`absent` gone, `unmeasured` neither.
  `HierarchyRouteOpts` also carries `plan: PlanStorePort` and `serial` (Task 2.4's rule): every write here, and the
  item acts later waves add to this file, runs inside `serial(...)`; nothing names `coord.db`.
- Produces:
  - `POST /api/projects/:project/hierarchy` body `{ initiatives: 'on' | 'off'; linearOwner: string | null; ownsTeam: boolean }`
    — session-gated when armed, no box token (the linking write's stance); `ownsTeam: true` clears it on every other
    project with the same team key in one transaction; a `linearOwner` that is no coordinator's id is `bad-request`.
  - `POST /api/hierarchy/owner` body `{ linearOwner: string }` — names one coordinator the owner of every project.
  - `GET /api/hierarchy` → `HierarchyAnswer` (session-gated, masked).
  - `export function registerHierarchyRoutes(app: FastifyInstance, opts: HierarchyRouteOpts): void`

- [ ] **Step 1: Write the failing tests** — `setting ownsTeam on project-b clears it on project-a with the same key`;
  `owner for all writes every project's linearOwner`; `GET answers the default owner and whether it is live`;
  `a hibernated owner reads live`;
  `an unknown owner id is bad-request`; `inboundWaiting reads 0 before wave 4`.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/hierarchy-routes.test.ts`.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run to pass** — plus `test/secret-mask.test.ts test/auth-gate.test.ts`.
- [ ] **Step 5: Commit** — `feat(plan): the per-project Linear owner and hierarchy settings (D-8181)`.

### Task 2.7: The public-text check

In wave 2, so it lands before any wave writes to Linear (§4.3: every plan verb checks text before storing it; §6.1:
the sync checks again before each write). Task 3.2 adds that guard when it creates `planSync.ts`.

**Files:** Create `server/src/linking/publicTextClasses.ts`; Move `server/test/private-names.mjs`'s matcher (the
tokenizer, `hashEntry`, `entriesOf`, `hitsAt`, `matchLine`, `pairHits`, `maskText`, `EXEMPTIONS`, `PRIVATE_NAMES`,
`PRIVATE_NAMES_DIGEST`, the salt and `CANARY`) to `shared/private-names.mjs` (shared already holds `.mjs` modules the
server compiles, `allowJs`); `server/test/private-names.mjs` keeps its CLI (`hash --list`) and the local scan with their
`fs`/`child_process` reads, and re-exports the matcher, so `private-names.test.ts`, `license.test.ts`, the sweep's local
scan and the CLI's path are unchanged. Modify `server/test/topology-clean.test.ts` (imports its classes' patterns from
the new module; its corpus walk, `SELF`, base resolution, liveness rows **and every class's `catches` and `passes`
fixtures stay in this file**, keyed by class name), `server/src/linking/policy.ts` (`publicTextVerdict`),
`server/src/coord/planRoutes.ts` (every text field of every plan verb), `pwa/src/lib/refusalWords.ts` (sentence), the
rings and single-definition rows for the moved matcher (`server/test/rings/*.data.ts`,
`server/test/single-definition/`); Test `server/test/public-text.test.ts`, `server/test/topology-clean.test.ts`,
`server/test/private-names.test.ts`, `server/test/license.test.ts`.

Why the split: `topology-clean.test.ts` excludes only itself (`SELF`) from its walk, by path, because each class's
`catches` list holds tokens the walk forbids (IPs, hosts, session ids, the canary). A `catches` list in
`server/src/linking/publicTextClasses.ts`, a scanned file, would turn the suite red on its own fixtures. And no
`server/src` file may import from `server/test`, so the hashed matcher moves to shared code rather than being read in
place.

**Interfaces:**
- Produces:
  - `export const PUBLIC_TEXT_CLASSES: readonly PublicTextClass[]` with `PublicTextClass = { name: string; pattern?: RegExp; match?: (line: string, file: string) => string[]; allowed?: (token: string) => boolean; skipLine?: (line: string, file: string) => boolean; why: string }`
    — no fixtures. The test suite keeps `const FIXTURES: Record<string, { catches: string[]; passes: string[] }>`
    keyed by `name`, and its liveness rows assert each class through the imported module.
  - The hashed class reads `shared/private-names.mjs` (`matchLine` over `PRIVATE_NAMES`), in the server check and the
    suite alike.
  - `publicTextVerdict(text: string, teamKey: string | null, mode: LinkingMode): { ok: true } | { ok: false; word: 'linear-text-public'; class: string; ids?: string[] }`
    — `private` mode passes; `public` and `unknown` refuse a team tracker id (`trackerIdsIn`) or any class match; a
    hashed hit names its class and `#h8`, never the text.

- [ ] **Step 1: Write the characterization test first** — move nothing yet; assert `topology-clean.test.ts`'s
  liveness rows (each class's `catches` and `passes`, still in that file) through the new import path, red until the
  move. `private-names.test.ts`'s CLI row still runs `server/test/private-names.mjs`.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/topology-clean.test.ts test/public-text.test.ts test/private-names.test.ts test/license.test.ts`.
- [ ] **Step 3: Move the classes and the matcher** (a commit that changes only where code lives and its imports), then add
  `publicTextVerdict` and its tests: `a public project's ticket title naming KEY-123 is refused with ids`,
  `an email in a public summary is refused with its class`, `a private project passes both`,
  `an unknown project is treated as public`, `plan put answers linear-text-public at once and stores nothing`,
  `ticket-add and met evidence are checked too`, `publicTextClasses.ts holds no catches list` (the walk stays green).
- [ ] **Step 4: Run to pass** — same, plus `test/plan-routes.test.ts`, the rings and single-definition files touched.
- [ ] **Step 5: Commit** — two commits: `refactor(linking): the topology classes and the private-name matcher in shared
  modules (D-8181)` and `feat(linking): the public-text check on plan text (D-8181)`.

---

## Wave 3 — the plan sync (D-8182)

Starts after FX2 has landed. From here new programmes are born in the new shape in Linear.

### Task 3.1: The sync's deciders

**Files:** Create `server/src/linear/planSyncPolicy.ts`; Test `server/test/plan-sync-policy.test.ts`.

**Interfaces:**
- Consumes: `StoredPlan`, `BindingRow`, `LinearDirectoryEntries`, `statusOfType`, `withCcrcProvenance`,
  `redactShapedCount`.
- Produces:
  - `export interface SyncSnapshot { program: { slug; title; end: { outcome: PlanEndOutcome; why: string | null; at: number } | null; inShort: string | null; doneWhen: string[] }; plan: StoredPlan; bindings: BindingRow[]; workspaces: { workspaceId: string; initiatives: 'on' | 'off' | 'unknown'; directory: LinearDirectoryEntries | null }[]; projects: { project: string; teamKey: string | null; workspaceId: string | null; mode: LinkingMode; initiatives: 'on' | 'off' }[] }`
  - `export type SyncStep = { kind: 'create'; op: CcrcOpName; local: { kind: BindingKind; id: number }; workspaceId: string; teamKey: string | null; input: CcrcOpInput; fields: string[]; requestId: string } | { kind: 'update'; op: CcrcOpName; bindingId: number; …; fingerprint: string } | { kind: 'link' | 'unlink'; … } | { kind: 'skip'; local; why: 'initiatives-off' | 'no-team-key' | 'status-missing' | 'workspace-mismatch' | 'text-public' }`
  - `planSyncSteps(s: SyncSnapshot): SyncStep[]` — in §5.2's order: initiatives (per workspace the epics sit in), projects
    (and their teams), milestones (plan order), issues; then updates whose owned fields differ from the binding's
    fingerprint; then links. A step whose parent is not `bound` is not emitted (the next pass emits it).
  - `initiativeDescription(s)`, `projectDescription(epic, programmeTitle, initiativesOff)`, `milestoneDescription(cp)`,
    `issueText(ticket)` — §6.1's texts, each through `linear-egress` and ending with the ccrc provenance line; a met
    checkpoint's line is `Met on <YYYY-MM-DD>: <evidence>`, its `targetDate` that day.
  - `fingerprintOf(fields: Readonly<Record<string, unknown>>): string` — the first 16 hex of sha256 over the
    canonical JSON (keys sorted).
  - `requestIdOf(kind: BindingKind, localId: number, workspaceId: string): string` — a v4-shaped UUID from
    sha256(`<kind>:<localId>:<workspaceId>`): hex 0–31, position 12 set to `4`, position 16 to `8`|`9`|`a`|`b` by its
    low two bits.
  - State by type only: epic `active` → project status of type `started`; `done` → `completed`; dropped → `canceled`;
    ticket `started` → issue state type `started`; `done` → `completed`; `dropped` → `canceled`; `open` → `unstarted`.
    The initiative's status values are the set FX2's answer 2 records, held as `LINEAR_INITIATIVE_STATUSES` in
    `hierarchyOps.ts` (the design assumes Planned, Active, Completed; an abandoned programme's initiative uses a
    canceled value only if FX2 found one, else Completed with the "Abandoned on" line).
  - `PlanSyncDeps` (Task 3.2) and the snapshot builder read only coord.db (through the `PlanStorePort`), the Linear
    store and the refresher's directory; this file reads none of them. The builder fills `program.end` from
    `programmeEnd` (Task 2.3): the explicit `plan close`, or the derived `done`. `programs.state` alone never ends a
    programme. The builder leaves out every epic, checkpoint and ticket with `putBackAt` set (Task 2.2), so no step is
    ever emitted for a record *Put back* dropped; a drop's cancel comment reads `droppedWhy`.
  - A `failed` binding emits no step (and nothing under it) until Task 3.2's rules return it to `pending`;
    `planSyncSteps` also reports, per failed binding, the fingerprint of its planned inputs now, so the pass can see
    that a new `plan put` changed them.
  - Text guard: every step that carries text for a project whose mode is `public` or `unknown` runs
    `publicTextVerdict` (Task 2.7) first; a refused text yields `{ kind: 'skip', why: 'text-public' }` for that object,
    which the pass turns into a `failed` binding and one mail to the coordinator (§6.1).

- [ ] **Step 1: Write the failing tests** — `a fresh plan yields initiative, projects, milestones, issues in that order`;
  `no milestone step until its project is bound`; `initiatives off: no initiative step and the project description names the programme`;
  `a renamed epic yields one project update, a matching fingerprint none`; `a missing status type fails the step, not the pass`
  (a `skip` with `status-missing` for that object, every other step still emitted); `requestIdOf is stable and v4-shaped`;
  `fingerprintOf ignores key order`; `a public project's issue text carries no Linear URL and no identifier`;
  `a public project's ticket whose stored title names KEY-123 is skipped text-public, every other step emitted`.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/plan-sync-policy.test.ts`.
- [ ] **Step 3: Implement**; pure. Whether a create sends `id: requestId` is read per kind from FX2's README answer 1;
  a kind with no caller id is marked `bindBy: 'name-and-creator'` on its step.
- [ ] **Step 4: Run to pass**.
- [ ] **Step 5: Commit** — `feat(linear): the plan sync's deciders (D-8182)`.

### Task 3.2: The plan sync

**Files:** Create `server/src/linear/planSync.ts`; Modify `server/src/laneSchedule.ts` (row `linearPlanSync`),
`server/src/watch.ts` (one call per tick), `server/src/index.ts` (build one `PlanSync`), `server/src/deps.ts`
(`planSync?: PlanSync | null`), `server/src/linear/refresher.ts` (now that FX2 has recorded them: the
`projectStatuses` collection after `projects`, and the initiatives probe once per refresh on the `floor` lane and when
a key is verified, into `entries.initiatives`); Test `server/test/plan-sync.test.ts`, `server/test/lane-schedule.test.ts`,
`server/test/linear-directory-hierarchy.test.ts` (`the probe's answer lands in entries.initiatives`, `a refresh reads
project statuses`).

**Interfaces:**
- Consumes: `planSyncSteps`, `runCcrcOp` (lane `sync`, pass `plan-sync`), `dueSyncs`, `deferSync`, `clearSyncDue`,
  `ensurePending`, `markBound`, `markFailed`, `insertSystemMailTx` (mail to `planOwnerOf`).
- Produces:
  - `export const PLAN_SYNC_BEAT_MS = 5_000`, `PLAN_SYNC_DEBOUNCE_MS = 3_000`,
    `PLAN_SYNC_BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000] as const` (in `laneSchedule.ts` for the beat; the
    rest in `planSync.ts`)
  - `PLAN_SYNC_TICK_DEADLINE_MS = 60_000` and `PLAN_SYNC_CALL_TIMEOUT_MS = 15_000` (`runCcrcOp`'s `timeoutMs`), pinned
    so that a tick's deadline plus one call's timeout stays below the lane row's `staleAfterMs`
  - `export interface PlanSyncDeps { coord: CoordStore; plan: PlanStorePort; ccrcDir: string; call: (ask: CcrcOpAsk) => Promise<CcrcOpOutcome>; directory: (slot: LinearSlotRef, keyDigest: string) => LinearDirectoryEntries | null; journal: LinearJournal; markSlotRejected: (slot: LinearSlotRef, digest: string, now: number) => Promise<void>; now: () => number }`
    (`coord` only for `insertSystemMailTx`; every plan read and write goes through `plan`)
  - `export class PlanSync { constructor(deps: PlanSyncDeps); tick(now: number): Promise<void>; passFor(key: string, deadlineAt: number): Promise<'done' | 'deferred'>; withFlight<T>(key: string, fn: () => Promise<T>): Promise<T>; restore(key: string, steps: readonly SyncStep[], pass: 'drift-restore'): Promise<CcrcOpOutcome[]> }`
    (`key` is a programme slug or `upkeep:<project>`)
  - Lane row `{ name: 'linearPlanSync', cadenceMs: PLAN_SYNC_BEAT_MS, derivedFrom: null, clock: 'mono', flight: 'skip', staleAfterMs: 120_000, warnKey: 'ccrc-server: linear plan sync failed' }`

**One writer per Linear object.** `PlanSync` holds an in-process single flight per due key (a `Map<string, Promise>`):
`passFor` on a key with a pass in flight joins that pass and never starts a second; `ensureTicketBound` (Task 3.4,
outside `coordMutex`, so a wave's parallel dispatches would otherwise each start one) and `tick` both go through
`passFor`. The lane runner restarts a `skip` row it thinks stuck after `staleAfterMs` (`laneRunner.ts`'s `start`); a
tick's total deadline (`PLAN_SYNC_TICK_DEADLINE_MS`) plus one call's timeout stays under it, and a restarted tick
still only joins the flights in flight. The drift pass hands its restore steps to `restore` (Task 4.2), and the
migration writes adopted issues inside `withFlight` (Task 7.3), so neither lands between two steps of a pass. Every
Linear write to a bound object, whoever asked for it, updates that binding's fingerprint in the same flight, so a
restore of an older planned value can never be read as drift of a newer sync write.

A pass: read the snapshot, take the first steps, run each, write the binding (`pending` before the call, `bound` with
id and fingerprint after), re-read the plan after every step, stop at the deadline. A create answered "conflict on
insert" reads the object by its `requestId` and binds it. A `name-and-creator` create (a binding still `pending` from a
pass that may have sent it) first reads by exact name in its scope (`initiativesByName`; `projectsByName` narrowed to
the team; a milestone from its project's `projectById`) and binds the one object whose `creator.id` is the key's viewer
(the directory's `viewerId`) and whose id no binding holds; none sends the create, and two or more mark the binding
`failed` and mail the coordinator. FX2's answer 7 found no `creator` on `ProjectMilestone` (D-8407), so a milestone
binds by exact name inside its own bound project when no binding holds
that milestone (a ccrc-bound project holds only what ccrc made, so the name is unique there), and the "another
creator" test row covers initiatives and projects only. It does not use `LinearJournal.viaFleet`: that read matches
only `outcome = 'ok'` rows with a `result`, and in the very crash this exists for (server death after send, before
settle) the row is still `pending` with no result. Before each write the step's text passes the public-text guard
(Task 3.1's `text-public` skip).

Every `CcrcOpOutcome` has one handling (a test row each):

| Outcome | Binding | Programme | Mail |
|---|---|---|---|
| `ok` | `bound` (create) or fingerprint updated (update, link) | goes on | none |
| `rate-limited` | unchanged | deferred by `retryAfterS`, at least the next backoff step | none |
| `unreachable`, or `timeout` with `maybeSent: false` | unchanged | deferred by the backoff | none |
| `timeout` (or any word) with `maybeSent: true` | stays `pending`: the next pass binds a create by `requestId` (conflict on insert) or by name and creator, and re-sends an update (updates set absolute values) | deferred by the backoff | none |
| `malformed` (sent and answered outside the grammar) | as `maybeSent: true`; after the last backoff step it is `failed` | deferred by the backoff | once, at `failed` |
| `not-configured` (no key for the slot) | unchanged | the tick ends for that workspace; due stays | none (the key settings already show it) |
| `linear-unauthorised` | unchanged | every programme in that workspace deferred; the slot marked rejected with `markLinearSlotRejected`, as `proxyRoutes.ts` does | none per binding (the key card shows the rejected slot) |
| `policy-unavailable`, `journal-unavailable` (nothing sent) | unchanged | deferred by the backoff | none |
| `policy-denied`, `linear-forbidden`, `linear-invalid` | `failed` with the word | goes on with other objects | once per binding and word |
| `not-found` on an update of a bound object | `failed` with the word (archived or removed in Linear) | goes on | once |
| a `skip` step (`status-missing`, `text-public`, `workspace-mismatch`) | `failed` with the reason | goes on | once |

A `failed` binding is not terminal. It returns to `pending` (`requeueFailed`) when its planned inputs change (the
fingerprint `planSyncSteps` reports differs from `failedInputs`, as after a `plan put` that fixes a refused text),
when the directory refreshes for its workspace (a status type added), when a key is verified for its slot (write
access regained), when the initiatives probe turns `on`, when its project's team key changes, and otherwise once
`PLAN_SYNC_BACKOFF_MS`'s last step (30 min) has passed since `failedAt`. A retry that fails again with the same word
mails nothing more. `plan show` shows `failed` and its word on the epic, checkpoint or ticket (`sync`, `syncWord`).

- [ ] **Step 1: Write the failing tests** (fetch faked from the recorded fixtures):

```ts
it('a due programme is synced once after the debounce, objects bound in order', …);
it('a create answered conflict-on-insert binds the existing object', …);   // Review Focus 2
it('a server restart between call and bind sends the same requestId', …);
it('a plan put during a pass is carried by the next pass', …);             // Review Focus 4
it('linear-forbidden marks the binding failed and mails the coordinator once', …); // Review Focus 5
it('rate-limited defers by 30 s, then 2 min', …);
it('a pass never runs past its deadline', …);
it('two name matches for a name-and-creator create fail the binding', …);
it('a crash with the journal row still pending binds by name and creator, and sends no second create', …); // Review Focus 2
it('an object of the same name made by another creator, or already bound, is not taken', …);
it('a text refused by the public-text guard fails its binding, mails once, and the pass goes on', …);
it('two concurrent passFor calls on a name-and-creator create send exactly one create', …); // Review Focus 8
it('a tick the lane runner restarts as stuck joins the pass in flight', …);
it('tick deadline plus one call timeout is below the row staleAfterMs', …);
it.each(OUTCOME_ROWS)('outcome %s: binding, programme and mail as the table says', …);
it('linear-unauthorised marks the slot rejected, defers the workspace and mails nothing', …);
it('a create that times out after send stays pending and the next pass binds it by name', …);
it('a failed binding returns to pending when a plan put changes its inputs', …);
it('a failed binding returns to pending when the directory refresh adds the status type', …);
it('a failed binding retried after the ceiling and refused again mails nothing more', …);
it('plan show names a failed binding and its word', …);
```

- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/plan-sync.test.ts test/lane-schedule.test.ts test/linear-directory-hierarchy.test.ts`.
- [ ] **Step 3: Implement**; `watch.ts` gains one `runLane('linearPlanSync', …)` call; a test building a watcher ends
  with `quietAtTestEnd`.
- [ ] **Step 4: Run to pass** — plus `test/watcher-quiet-census.test.ts test/consolidation-census.test.ts`.
- [ ] **Step 5: Commit** — `feat(linear): the plan sync (D-8182)`.

### Task 3.3: Moves and closes

**Files:** Modify `server/src/linear/planSyncPolicy.ts`, `server/src/linear/planSync.ts`; Test
`server/test/plan-sync-lifecycle.test.ts`.

**Interfaces:**
- Produces in `planSyncSteps`, §5.3 and §5.4's tables row by row: run dispatched → issue `started`; run done → issue
  `completed` (skipped when Linear already reads `completed`); checkpoint met → milestone description gains the met line
  and `targetDate`; epic active/done → project status; programme `paused` (the only writer is the migration's backlog
  programmes, Task 7.3) → the initiative description notes it; programme ended `done` (`snapshot.program.end`, from
  `programmeEnd`: an explicit `plan close` done, or the derived end) → initiative `Completed`, every open epic's
  project `completed`, an open issue left open and the coordinator mailed; programme ended `abandoned` (only ever an
  explicit `plan close` with its `why`) → initiative `Completed` with "Abandoned on <date>: <why>", projects and open
  issues `canceled` with a comment naming the reason. `programs.state` is never read here: D-51 sets it `done` or
  `abandoned` at every gap between waves, and a programme with `end: null` is live whatever it reads; epic dropped → project `canceled` with the reason, its tickets
  moved by the plan first, the rest canceled; a ticket's project changed → `issueUpdate` with the new `teamId` inside
  the workspace and the identifier refreshed from the answer.
  - At the start of each tick, an `operator-act` checkpoint whose `itemId` item reads `done` is marked met with
    `{ itemId }` evidence (`markCheckpointMet`, which settles its epic through `settleEpicInTx`), and its programme is
    due (§4.1's design call).
  - The epic-dropped and abandoned cancels read the reason from `droppedWhy` (the epic's, the checkpoint's or the
    ticket's) or `planEndWhy`; a record with `putBackAt` set is never in the snapshot (Task 3.1).
  - The team-key rule (Review Focus 3): `project.teamKey === null` → `skip` `no-team-key` and `plan show` reads
    `unsynced`; a key of the same workspace → the move above; a key of another workspace → `markFailed` and a
    `ticket-workspace-mismatch` mail.

- [ ] **Step 1: Write the failing tests** — one per row above, plus `an operator-act checkpoint is met when its item is done`,
  `plan met on the last checkpoint after the last run closes the epic, and its project completes`,
  `the last epic settling done with programs.state done ends the programme and completes the initiative`,
  `a dropped ticket's cancel comment names its droppedWhy`,
  `the last run of wave 1 closes done while later epics are planned, and nothing in Linear closes`,
  `the last run of wave 1 closes failed (programs.state abandoned), and nothing is canceled` (Review Focus 6, both
  driven through `closeRun`), `plan close abandoned cancels projects and open issues with the reason`,
  `a cleared team key leaves bindings and syncs nothing for that project`,
  `a team key moved to another workspace fails the bindings and moves nothing`.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/plan-sync-lifecycle.test.ts`.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run to pass** — plus `test/plan-sync.test.ts test/plan-sync-policy.test.ts`.
- [ ] **Step 5: Commit** — `feat(linear): the plan sync moves and closes (D-8182)`.

### Task 3.4: The dispatch wait, the ticket's branch name and the pull request link

**Files:** Modify `server/src/coord/routes.ts` (`POST /api/runs/:id/dispatch`: the wait before `run()`),
`server/src/linking/policy.ts` (`slugForTicket`), `server/src/linear/planSync.ts` (`ensureTicketBound`, the PR link);
Test `server/test/plan-dispatch-wait.test.ts`, `server/test/linking-policy.test.ts`, `server/test/dispatch-mutex-gate.test.ts`.

**Interfaces:**
- Produces:
  - `PlanSync.ensureTicketBound(runId: number, budgetMs: number): Promise<{ identifier: string | null }>` — joins the
    pass in flight for the run's programme, or starts one through `passFor` with deadline `now + budgetMs`, and waits
    at most `budgetMs`; it never starts a second pass for a key in flight (Task 3.2's single flight), so a wave's
    parallel dispatches share one pass; `PLAN_SYNC_DISPATCH_WAIT_MS = 12_000`.
  - `slugForTicket(identifier: string, given: string | undefined, title: string): string` — `key-123-<words>`,
    lowercase, fitted to `WS_SLUG_MAX` by `fitSlug`; a `given` slug that already starts with the identifier is kept.
  - The route: outside `coordMutex`, when the run is a work run with a ticket, the project's mode is `private`, and
    the run is a **fresh spawn** (`run.sessionId === null`), await the wait, then pass `slugForTicket(...)` as the
    dispatch slug. A run that resumes its bound session (waves N≥2) gets no slug: `dispatchDecide.ts` refuses any
    slug on such a run (`slug: this run resumes its bound session; a slug names a fresh spawn only`), and its branch is
    the session's, which may carry an earlier ticket's identifier. For a resumed run, as in a `public` or `unknown`
    project, the slug is untouched and, once the run's PR is known, the sync calls `issueLink` with its URL
    (`attachmentLinkURL`, as the ccrc actor). Not bound in time: dispatch as today, and the sync adds the link when the
    issue appears.

- [ ] **Step 1: Write the failing tests** — `a bound ticket in a private project names the workspace key-123-…`;
  `a public project's slug never carries the identifier, and the sync links the PR`;
  `a resumed work run in a private project with a bound ticket dispatches with no slug and gets the attachment link`;
  `Linear slow: dispatch goes after 12 s with today's slug`; `a dispatch during a lane pass joins that pass and sends
  no create of its own`; `three parallel dispatches of one wave start one pass`;
  `the wait never runs inside coordMutex` (the mutex gate test still green with the new call site); `slugForTicket fits 31 characters`.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/plan-dispatch-wait.test.ts test/linking-policy.test.ts test/dispatch-mutex-gate.test.ts`.
- [ ] **Step 3: Implement**; `routes.ts` grows by the call only.
- [ ] **Step 4: Run to pass** — plus `test/run-routes.test.ts`.
- [ ] **Step 5: Commit** — `feat(linear): dispatch waits for its ticket's issue (D-8182)`.

### Task 3.5: The initiatives-off item and the hierarchy item route

**Files:** Modify `server/src/coord/hierarchyRoutes.ts` (`POST /api/items/:id/linear`), `server/src/linear/planSync.ts`
(raise and close the item); Test `server/test/linear-items.test.ts`.

**Interfaces:**
- Consumes: `raiseItem(db, input, now, 'ccrc')` under `LINEAR_SYNC_PROGRAMME`, `moveItem`, `LINEAR_ITEM_ACTS`.
- Produces:
  - When a workspace reads `off` and some programme there needs an initiative (and that project's setting is `on`),
    one `do` item per workspace, `action: { verb: 'linear-initiatives', workspaceId }`, titled "Turn on initiatives in
    this Linear workspace", with the steps; it settles itself when a probe reads `on`. A project set `off` raises nothing.
  - `POST /api/items/:id/linear` body `{ act: LinearItemAct; note?: string; owner?: string }`, session-gated, no box
    token: refuses `item-act-mismatch` for an act its action does not take; `check-again` queues the refresher's probe
    for that workspace and answers at once. Wave 4 and wave 7 add the other acts' arms in this route.

- [ ] **Step 1: Write the failing tests** — `one item per workspace however many programmes wait`; `a probe that reads on settles the item`;
  `a project set off raises nothing`; `check-again queues the probe`; `approve on an initiatives item is item-act-mismatch`.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/linear-items.test.ts`.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run to pass** — plus `test/secret-mask.test.ts test/auth-gate.test.ts`.
- [ ] **Step 5: Commit** — `feat(linear): the initiatives-off item and the hierarchy item route (D-8182)`.

---

## Wave 4 — drift, inbound, public text (D-8183)

Inert until a team is managed (wave 7); every behaviour is testable with an `applied` migration row inserted by the test.

### Task 4.1: Migration 58 and the drift deciders

**Files:** Modify `server/src/coord/schema.ts` (entry 58); Create `server/src/linear/driftPolicy.ts`; Modify
`server/src/coord/planStore.ts` (drift rows, managed teams); Test `server/test/drift-policy.test.ts`,
`server/test/plan-store.test.ts`.

Migration 58 (renumber at rebase):

```sql
CREATE TABLE linear_drift_marks (workspaceId TEXT PRIMARY KEY, watermark TEXT NOT NULL, passAt INTEGER NOT NULL);
CREATE TABLE linear_drift_events (id INTEGER PRIMARY KEY AUTOINCREMENT, bindingId INTEGER NOT NULL, at INTEGER NOT NULL,
  field TEXT NOT NULL, value TEXT NOT NULL, actor TEXT NOT NULL, restored INTEGER NOT NULL, commentedAt INTEGER);
CREATE TABLE linear_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, workspaceId TEXT NOT NULL, teamKey TEXT NOT NULL,
  state TEXT NOT NULL, map TEXT, itemId INTEGER, reportItemId INTEGER, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
  appliedAt INTEGER, putBackAt INTEGER);
CREATE TABLE linear_migration_moves (id INTEGER PRIMARY KEY AUTOINCREMENT, migrationId INTEGER NOT NULL,
  subject TEXT NOT NULL, kind TEXT NOT NULL, linearId TEXT, identifier TEXT, before TEXT, after TEXT NOT NULL,
  appliedAt INTEGER, revertedAt INTEGER);
CREATE UNIQUE INDEX linear_migration_moves_one ON linear_migration_moves(migrationId, subject);
CREATE TABLE linear_inbound (linearId TEXT PRIMARY KEY, workspaceId TEXT NOT NULL, teamKey TEXT NOT NULL, identifier TEXT NOT NULL,
  seenAt INTEGER NOT NULL, mailedTo TEXT, mailedAt INTEGER, handedTo TEXT, state TEXT NOT NULL);
```

`linear_drift_events.value` and `actor` hold Linear text, read only under `untrusted`; `linear_inbound.state` is
`waiting | mailed | handed | taken | placed | closed | raised`. A `linear_migration_moves` row is one subject per
migration: an existing issue's move (`kind` `issue`, `subject` its UUID, `before` its re-read) or a create of
structure the map declares (`kind` `initiative` | `project` | `milestone`, `subject` `<bindingKind>:<localId>`,
`before` null, `linearId` filled when the create answers). The unique index stops a re-run from writing a second row
whose `before` would be the post-move state (Task 7.3).

**Interfaces:**
- Produces (`driftPolicy.ts`, pure):
  - `OwnedFields = Readonly<Record<string, string | number | null | readonly string[]>>` — exactly §6.2's owned columns
    per kind (`OWNED_FIELDS: Readonly<Record<'initiative' | 'project' | 'milestone' | 'issue', readonly string[]>>`;
    an issue's state is its **type**, never its name; labels only those ccrc set).
  - `driftVerdict(owned: OwnedFields, planned: OwnedFields, lastWritten: string | null): 'match' | 'catch-up' | 'drift'`
    — `catch-up` when `fingerprintOf(owned) === lastWritten` (ccrc wrote the current value; the plan moved on).
  - `notDrift(field: string, before: unknown, after: unknown, ctx: { prMerged: boolean; gracePasses: number }): boolean`
    — same state category; an issue `completed` by an integration with the merge recorded, or within one pass of
    grace; any field ccrc does not own (§6.2).
  - `isPersistent(restores: readonly number[], now: number): boolean` — three within seven days
    (`DRIFT_PERSIST = { restores: 3, windowMs: 7 * 86_400_000 }`).
  - `restoreComment(kind, field, planned: string, was: string, at: number): string` — §7.2's sentence;
    `restoredLines(description: string, line: string): string` — keeps the last three "Restored" lines.
  - `isInbound(issue: { linearId: string; teamKey: string }, bound: ReadonlySet<string>, viaFleet: ReadonlySet<string>, managed: ReadonlySet<string>): boolean`
  - planStore: `managedTeams(db): { workspaceId: string; teamKey: string }[]` (`state = 'applied'`), `recordDrift`,
    `driftRestoresOf(db, bindingId, since)`, `upsertInbound`, `inboundWaiting(db, project)`.

- [ ] **Step 1: Write the failing tests** — one per rule: `In Progress → In Review is not drift`, `completed by the integration with the merge recorded is not drift`,
  `completed with no merge recorded waits one pass`, `a moved project is drift`, `a value ccrc wrote is catch-up`,
  `three restores in seven days is persistent, three in eight is not`, `restoredLines keeps three`,
  `an issue created through the journal is not inbound`; migration 58 applies after 57.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/drift-policy.test.ts test/plan-store.test.ts`.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run to pass**.
- [ ] **Step 5: Commit** — `feat(linear): migration 58 and the drift deciders (D-8183)`.

### Task 4.2: The drift pass and persistent drift

**Files:** Create `server/src/linear/driftPass.ts`; Modify `server/src/laneSchedule.ts` (row `linearDrift`),
`server/src/watch.ts`, `server/src/index.ts`, `server/src/coord/hierarchyRoutes.ts` (acts `hand`, `keep`);
Test `server/test/drift-pass.test.ts`.

**Interfaces:**
- Produces:
  - `DRIFT_PASS_MS = 30 * 60_000` per workspace; lane `{ name: 'linearDrift', cadenceMs: 60_000, …, flight: 'skip' }`
    picks the workspace whose `passAt` is oldest and due.
  - `DriftPassDeps` = `PlanSyncDeps` plus `planSync: PlanSync` (a `catch-up` verdict makes the programme due instead
    of writing here) and `presenceOf: (id: string) => CoordinatorPresence` (the one `server.ts` builds, Task 2.6;
    read through `linearOwnerOf`'s `live`/`gone`).
  - `export class DriftPass { constructor(deps: DriftPassDeps); tick(now: number): Promise<void> }` — reads `changed*`
    since the watermark (lane `sync`), compares bound objects, restores (pass `drift-restore`) by handing the restore
    steps to `planSync.restore(key, steps, 'drift-restore')`, which runs them inside that programme's flight, re-reads
    the planned value there (a sync write that landed meanwhile makes the restore moot) and updates the binding's
    fingerprint with each write (Task 3.2), comments on an issue,
    writes a "Restored" line on an initiative, project or milestone (where FX2's answer 3 says no comment is taken),
    records each event, advances the watermark. While a binding holds an open drift item: at most one restore per
    pass and one comment a day.
  - Persistent drift: a `decide` item under `LINEAR_SYNC_PROGRAMME`, `action: { verb: 'linear-drift', bindingId }`,
    options `['Hand to the coordinator', 'Keep the plan']`, recommended 0 (the coordinator decides whether the plan
    should change), showing the object, field, values, who and when as untrusted text. A refused restore raises it at once.
  - Acts: `hand` mails the programme's coordinator (`planOwnerOf`) with the drift record and closes the item; `keep`
    closes it and restoring goes on.

- [ ] **Step 1: Write the failing tests** — `a moved issue is restored with one comment`; `a renamed project gets a Restored line, three kept`;
  `the third restore in a week raises the item`; `with the item open, two edits in one pass restore once and comment once a day`;
  `a restore refused linear-forbidden raises the item at once` (Review Focus 5); `an unmanaged team is never read`;
  `hand mails the coordinator`; `a restore waits for the sync pass in flight and, when that pass wrote the newer
  planned value, writes nothing and raises no drift`.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/drift-pass.test.ts`.
- [ ] **Step 3: Implement**; tests that build a watcher end with `quietAtTestEnd`.
- [ ] **Step 4: Run to pass** — plus `test/lane-schedule.test.ts test/watcher-quiet-census.test.ts test/linear-items.test.ts`.
- [ ] **Step 5: Commit** — `feat(linear): the drift pass and persistent drift (D-8183)`.

### Task 4.3: The inbound path, the Upkeep epic and the Linear owner item

**Files:** Modify `server/src/linear/driftPass.ts` (detect and mail), `server/src/coord/planRoutes.ts` (`take`,
`triage`), `server/src/coord/planPolicy.ts`, `server/src/coord/hierarchyRoutes.ts` (act `name`), `ccd/ccrc-api` (two
rows), `ccd/coordinator-skill/references/api.md` (the two verbs' refusals); Test `server/test/plan-inbound.test.ts`,
`server/test/ccrc-api.test.ts`, `server/test/ccrc-api-closed.test.ts`, `server/test/box-token-census.test.ts`.

**Interfaces:**
- Produces:
  - `POST /api/teams/:team/plan/triage` body `{ issue: string (REF); decision: 'hand' | 'upkeep' | 'close' | 'raise'; programme?: string; reason?: string; note?: string }` — caller must be the team's Linear owner (`not-linear-owner`); the issue must be inbound and waiting (`issue-not-inbound`); `hand` mails the programme's coordinator (taken at once when it is the owner's own); `upkeep` places a ticket (source `inbound`, the reporter's title and text) in the team's Upkeep epic, created on first use (`UPKEEP_EPIC_KEY`, project the owning project, no programme); `close` comments with the reason and completes or cancels it; `raise` raises a `decide` item for the operator under `LINEAR_SYNC_PROGRAMME`.
  - `POST /api/programmes/:slug/plan/take` body `{ issue: string; epic: string; checkpoint?: string } | { issue: string; close: { why: string } } | { issue: string; return: { note: string } }` — the programme's coordinator takes a handed issue or an Upkeep ticket into an epic of its plan (the ticket moves programme and epic; the sync re-parents the issue), closes it, or returns it to the owner. Each arm settles every epic it touched through `settleEpicInTx` (a close can leave the source epic with nothing open).
  - Both routes write under `serial` and through the `PlanStorePort` (Task 2.4's rule).
  - `ccd/ccrc-api` rows `[plan.take]='POST|/api/programmes/{id}/plan/take|yes|-'`, `[plan.triage]='POST|/api/teams/{id}/plan/triage|yes|-'`; the `{id}` of `triage` is a team key (SAFE_RE already admits it).
  - No owner, or the owner `gone` (`dead` or `absent`; an `asleep` owner is live and mail wakes it, and an
    `unmeasured` one is a doubt that raises nothing and is mailed as usual): the issue waits, `inboundWaiting` counts
    it, and one `do` item per project, `action: { verb: 'linear-owner', project }`, "Name a Linear owner", listing the coordinators live now; act `name` (body `owner`) sets the project's `linearOwner`, then the item settles itself once that owner is live and the waiting issues are mailed to it.
  - A run is never opened on an Upkeep ticket (`ticket-unavailable`, Task 2.5).
  - The Upkeep epic syncs like a programme's epic, under the due key `upkeep:<project>` in `plan_sync_due` (a programme
    slug never contains `:`): its Linear project is in the team, linked to no initiative, with no milestones, and it
    never closes. `planSyncSteps` takes a snapshot whose `program` is null for it.
  - `GET /api/projects/:project/upkeep` → the Upkeep epic's `EpicView` (session-gated, in `MASKED_GET_ROUTES`), for the
    console's Upkeep page (Task 5.3).

- [ ] **Step 1: Write the failing tests** — `an unbound issue in a managed team is mailed to the owner once`;
  `triage by another coordinator is not-linear-owner`; `hand to the owner's own programme takes it at once`;
  `upkeep creates the Upkeep epic once and places the ticket`; `take moves an Upkeep ticket into the programme's epic`;
  `raise makes a decide item for the operator`; `no live owner raises one item per project and it settles when an owner is named and live`;
  `a hibernated owner is mailed, and no item is raised`; `an unmeasured owner raises no item`;
  `the Upkeep project is created once, outside any initiative, and never closed`; `GET upkeep answers its tickets, masked`;
  the client rows' identity and count pins.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/plan-inbound.test.ts test/ccrc-api.test.ts test/ccrc-api-closed.test.ts test/box-token-census.test.ts test/coordinator-skill.test.ts`.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run to pass** — plus `test/auth-gate.test.ts test/mail-routes.test.ts test/secret-mask.test.ts`.
- [ ] **Step 5: Commit** — `feat(plan): the inbound path, the Upkeep epic and the Linear owner item (D-8183)`.

### Task 4.4: Session writes in managed teams

**Files:** Modify `server/src/linear/proxyRoutes.ts` (create and update), `ccd/linear-skill/SKILL.md` (the
`plan-owned` and `linear-text-public` refusals and remedies, kept within its cap: trim elsewhere in the file to fit),
`shared/refusal.ts` (`LINEAR_PROXY_REFUSALS` gains `plan-owned`); Test `server/test/linear-proxy-routes.test.ts`,
`server/test/skill-size-ratchet.test.ts`.

**Interfaces:**
- Produces: in a managed team, `create` and `update` of a bound issue answer 409 `plan-owned` with the detail "file it
  through `ccrc-api plan ticket-add`", after routing and before the policy point, journaled `refused`. In an unmanaged
  team, unchanged; `comment`, `link` and reads unchanged.

- [ ] **Step 1: Write the failing tests** — `create in a managed team is plan-owned and sends nothing`; `update of an unbound issue in a managed team passes`;
  `create in an unmanaged team passes`; `comment on a bound issue passes`.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/linear-proxy-routes.test.ts`.
- [ ] **Step 3: Implement** (`LinearProxyDeps` gains `managed(workspaceId: string, teamKey: string): boolean`).
- [ ] **Step 4: Run to pass** — plus `test/skill-size-ratchet.test.ts test/refusal-status.test.ts`.
- [ ] **Step 5: Commit** — `feat(linear): plan-owned in managed teams (D-8183)`.

---

## Wave 5 — the console (D-8184)

PWA only, against the wire of waves 2 to 4 (and the map and report actions typed in Task 2.1, raised from wave 7).
Every task here adds jsdom tests (`pwa/test/*.test.tsx`) and a browser file run locally.

### Task 5.1: The project row's hierarchy settings

**Files:** Modify `pwa/src/screens/settings/ProjectLinkingCard.tsx`, `pwa/src/screens/settings/settings.css`,
`pwa/src/fleet/AddProjectSheet.tsx`, `pwa/src/lib/api.ts` (`saveHierarchy`, `ownerForAll`, `hierarchy`),
`pwa/src/lib/refusalWords.ts`; Create `pwa/src/screens/settings/hierarchyWords.ts`; Test
`pwa/test/project-linking-card.test.tsx`, `pwa/browser/project-linking-card.browser.test.ts`.

**Interfaces:**
- Consumes: `HierarchyAnswer`, `ProjectLinkingWire`'s new fields, `POST /api/projects/:project/hierarchy`, `POST /api/hierarchy/owner`.
- Produces: per row, beside the team key: **Linear owner** (a select of coordinators, "Default: <id> (live)" /
  "Default: none live" as its empty option), **File into initiatives** (a toggle), **Owning project** (shown only when
  another project shares the key), and the hierarchy state ("Not migrated", "Map waiting for you" linking the item,
  "Migrating", "Migrated on <date>", "Put back on <date>") with "<n> inbound issues wait for an owner" when n > 0 and a
  link to the Upkeep page. One card-level act, "Make one coordinator the Linear owner of every project", behind a
  `QuickConfirm`. The add-project sheet gains the owner select (empty) and the initiatives toggle beside the team key.

| Width | Layout |
|---|---|
| 360, 390 | Each row stacks: name, team key and Save, owner select full width, initiatives toggle, state line; the all-projects act at the card's end, full width |
| 1280, 1470 | The row's first line holds name, key and visibility; the second the owner select, toggle and state |
| 1920 | One grid line per row; the state line wraps under the row only when long |

- [ ] **Step 1: Write the failing tests** — jsdom: `the empty owner option names the default and whether it is live`, `saving the owner renders the stored row`,
  `the owning-project control shows only for a shared key`, `the state line links the map item`, `a refusal shows its fixed sentence`;
  browser: no sideways scroll, no clipped text with a long project name, the table above, all twenty views.
- [ ] **Step 2: Run to fail** — `cd pwa && npx vitest run --maxWorkers=2 test/project-linking-card.test.tsx`, then the browser file.
- [ ] **Step 3: Implement**; words in `hierarchyWords.ts`.
- [ ] **Step 4: Run to pass** — both.
- [ ] **Step 5: Commit** — `feat(console): the Linear owner and hierarchy settings per project (D-8184)`.

### Task 5.2: The programme page's Plan section

**Files:** Create `pwa/src/ledgers/PlanSection.tsx`, `pwa/src/ledgers/planWords.ts`; Modify
`pwa/src/ledgers/ProgrammeScreen.tsx`, `pwa/src/ledgers/ledgers.css`, `pwa/src/lib/api.ts` (`plan(slug)`);
Test `pwa/test/plan-section.test.tsx`, `pwa/browser/programme-page.browser.test.ts`.

**Interfaces:**
- Consumes: `GET /api/programmes/:slug/plan` → `PlanView`.
- Produces: `PlanSection({ slug }: { slug: string }): ReactNode` — each epic with state, "3 of 5 met", open tickets,
  *Open in Linear*; the done-when list each marked proved or not; *Open in Linear* for each initiative, or with
  initiatives off "No initiative: initiatives are off in this workspace" (or "…off for this project"). A programme with
  no plan says "No plan declared yet". `planWords.ts` holds `epicStateWord`, `metOf(epic)`, `doneWhenWord`.

| Width | Layout |
|---|---|
| 360, 390 | One column; each epic a card (title, state, "3 of 5 met", link); its checkpoints open under the card |
| 1280, 1470 | Plan beside Goals; epics as rows with checkpoint chips |
| 1920 | Epics and their checkpoints in two columns, Goals alongside |

- [ ] **Step 1: Write the failing tests** — jsdom: `met counts dropped checkpoints out of all` ("2 of 4 met" for 2 met,
  1 dropped, 2 open), `a proved done-when entry is marked`, `initiatives off says why`, `no plan says "No plan declared yet"`,
  `an unsynced epic has no Linear link`; browser (`programme-page.browser.test.ts`): the table above in twenty views, no
  sideways scroll, no clipped title with a long epic name.
- [ ] **Step 2: Run to fail** — `cd pwa && npx vitest run --maxWorkers=2 test/plan-section.test.tsx`, then the browser file.
- [ ] **Step 3: Implement** `PlanSection` and `planWords.ts`; `ProgrammeScreen` renders it beside Goals.
- [ ] **Step 4: Run to pass** — both.
- [ ] **Step 5: Commit** — the files above and `pwa/test/programme-screen.test.tsx` if it changed; `feat(console): the programme's Plan section (D-8184)`.

### Task 5.3: The epic page and the Upkeep page

**Files:** Create `pwa/src/ledgers/EpicScreen.tsx`, `pwa/src/ledgers/UpkeepScreen.tsx`; Modify `pwa/src/lib/routes.ts`
(rows `epic` `^/programmes/([^/]+)/epics/([^/]+)/?$` and `upkeep` `^/projects/([^/]+)/upkeep/?$`; builders
`epicPath(slug, key)`, `upkeepPath(project)`), `pwa/src/app.tsx`, `pwa/src/lib/api.ts` (`upkeep(project)`; the route
is Task 4.3's); Test `pwa/test/epic-screen.test.tsx`, `pwa/browser/epic-page.browser.test.ts`.

**Interfaces:**
- Produces: the epic's checkpoints in order (state, met date, evidence: a PR link, an item link via `itemPath`, or a
  repository path opened in the Docs reader via `docHref`), its tickets with their runs (`/runs/<id>`), *Open in
  Linear*. The Upkeep page: the same component over the Upkeep epic, no checkpoints.

| Width | Layout |
|---|---|
| 360, 390 | Checkpoints as a list, tickets below |
| 1280, 1470 | Checkpoints and tickets side by side |
| 1920 | The same, each ticket's run state inline |

- [ ] **Step 1: Write the failing tests** — jsdom: `evidence {pr} links the pull request, {itemId} the item, {path} the Docs reader`,
  `a ticket with a run links /runs/<id>`, `an unknown epic key says "No such epic in this programme"`,
  `the Upkeep page lists its tickets and no checkpoints`, `matchRoute parses both new paths and refuses a bad slug`;
  browser (`epic-page.browser.test.ts`): the table above in twenty views.
- [ ] **Step 2: Run to fail** — `cd pwa && npx vitest run --maxWorkers=2 test/epic-screen.test.tsx`, then the browser file.
- [ ] **Step 3: Implement** both screens over one `EpicBody` component and the two route rows.
- [ ] **Step 4: Run to pass** — both, plus `test/app.test.tsx` (the route table's matches).
- [ ] **Step 5: Commit** — `feat(console): the epic and Upkeep pages (D-8184)`.

### Task 5.4: The five hierarchy items' controls

**Files:** Create `pwa/src/ledgers/LinearItemControls.tsx`; Modify `pwa/src/ledgers/ItemActs.tsx` (`ItemControls`
dispatches a linear action to it; `carriesControls`), `pwa/src/ledgers/ItemView.tsx` (the map and report bodies),
`pwa/src/lib/api.ts` (`linearItemAct(id, body)`); Test `pwa/test/linear-item-controls.test.tsx`,
`pwa/browser/linear-items.browser.test.ts`.

**Interfaces:**
- Consumes: `isLinearItemAction`, `LINEAR_ITEM_ACTS`, `POST /api/items/:id/linear`.
- Produces: on the item, each act its control: map — *Approve* (one tap, `QuickConfirm`) and *Return* (a note field);
  report — *Put back* (`QuickConfirm`) and *Done*; drift — *Hand to the coordinator* and *Keep the plan*; initiatives
  — *Check again*; owner — *Name* (a select of live coordinators, confirm). The map and report bodies: counts first
  (created, moved, closed, skipped as changed, left), then one group per class; the approve control stays in view on a
  phone (sticky at the item's foot).

| Width | Map approval / report |
|---|---|
| 360, 390 | Counts, then collapsed groups; the act bar sticky at the foot |
| 1280, 1470 | Groups open, two columns of issues |
| 1920 | Groups as a table: issue, class, target |

The drift item's *Hand to the coordinator* uses the existing door word (`ITEM_DOOR_WORDS['hand-to-coordinator']`).

- [ ] **Step 1: Write the failing tests** — jsdom: one per act, asserting the body sent (`{act:'approve'}`,
  `{act:'return', note}`, `{act:'put-back'}`, `{act:'done'}`, `{act:'hand'}`, `{act:'keep'}`, `{act:'check-again'}`,
  `{act:'name', owner}`); `an act the server refuses shows its fixed sentence`; `the map's counts come before its groups`;
  browser (`linear-items.browser.test.ts`): the table above in twenty views, the act bar visible at 360 with a
  200-issue map scrolled to its middle.
- [ ] **Step 2: Run to fail** — `cd pwa && npx vitest run --maxWorkers=2 test/linear-item-controls.test.tsx`, then the browser file.
- [ ] **Step 3: Implement** `LinearItemControls` and the two bodies; `ItemControls` dispatches on `isLinearItemAction`.
- [ ] **Step 4: Run to pass** — both, plus `test/item-view.test.tsx`.
- [ ] **Step 5: Commit** — `feat(console): the hierarchy items' controls (D-8184)`.

---

## Wave 6 — the skills (D-8185)

### Task 6.1: The coordinator skill

**Files:** Modify `ccd/coordinator-skill/references/plan.md` (Task 2.5 created it), `ccd/coordinator-skill/SKILL.md`
(contract clause 21, the map's pointer line, §Linear trimmed to a pointer),
`ccd/coordinator-skill/references/wave-lifecycle-1-open.md`, `ccd/coordinator-skill/references/ledger-template.md`
(the waves table's epic column), `server/test/skill-size-caps.json` (raised by clause 21's bytes only); Test
`server/test/coordinator-skill.test.ts`, `server/test/skill-size-ratchet.test.ts`, `server/test/ccrc-api-closed.test.ts`
(its pinned list of the commands the skill corpora run, references included, gains every `plan.*` key a new
executable block runs).

**Interfaces:**
- Produces clause 21: "A new programme's plan is declared with `ccrc-api plan put` before its first run opens: epics
  plan-sized with their waves, checkpoints as the gates inside them; every run opens with its ticket; a met checkpoint
  is recorded with `plan met` and its evidence; the programme ends with `plan close`; this session never files a hierarchy object or a ticket in a managed
  team with `linear create`." The count word above the contract becomes twenty-one; §Linear shrinks so the file grows
  by the clause line alone.
- `references/plan.md` gains: the run's `ticket` key, handed issues and `plan take`, and the Linear owner's duty
  `plan triage` (never another programme's plan). It names only verbs whose client row and route exist by wave 6:
  `plan map-propose` lands with its row and route in Task 7.2, and naming it here would turn both the closed-corpus
  parity and `coordinator-skill.test.ts`'s route check red.

- [ ] **Step 1: Write the failing tests** — `clause 21 is pinned`; `plan.md names every plan verb registered by wave 6 and every PLAN_REFUSALS word a coordinator meets`;
  `the ledger template's waves table has an epic column`; the ratchet's R4/R6 hold.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/coordinator-skill.test.ts test/skill-size-ratchet.test.ts test/ccrc-api-closed.test.ts`.
- [ ] **Step 3: Write** the text.
- [ ] **Step 4: Run to pass**.
- [ ] **Step 5: Commit** — `docs(skills): the coordinator declares and keeps its plan (D-8185)`.

### Task 6.2: The worker and Linear skills

**Files:** Modify `ccd/worker-skill/SKILL.md` (§Linear: follow-ups with `plan ticket-add`, kind `follow-up`, into its
own run's epic), `ccd/linear-skill/SKILL.md` (the hierarchy is ccrc's; restore comments are ccrc's own; never edit a
managed object), `server/test/skill-size-caps.json` only if lowered; Test `server/test/worker-skill.test.ts`,
`server/test/skill-size-ratchet.test.ts`, `server/test/ccrc-api-closed.test.ts` (the worker's executable
`ccrc-api plan ticket-add` block joins its pinned list).

- [ ] **Step 1: Write the failing tests** — `the worker files follow-ups with plan ticket-add into its own epic`;
  `the Linear skill says the hierarchy is ccrc's`.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/worker-skill.test.ts test/skill-size-ratchet.test.ts test/ccrc-api-closed.test.ts`.
- [ ] **Step 3: Write** the text, net size within each cap.
- [ ] **Step 4: Run to pass** — same command.
- [ ] **Step 5: Commit** — `docs(skills): the worker's follow-ups and the Linear skill's hierarchy rule (D-8185)`.

---

## Wave 7 — the migration (D-8186)

### Task 7.1: The map deciders

**Files:** Create `server/src/linear/migrationPolicy.ts`; Test `server/test/migration-policy.test.ts`.

**Interfaces:**
- Produces:
  - `MAP_CLASSES = ['programme','epic','checkpoint','leaf','upkeep','finished','superseded','stale','unclear'] as const`
    (in `shared/plan.ts`, with `MapBody`, `MapEntry { issue: string (UUID); identifier: string; class: MapClass; target?: { programme?: string; epic?: string; checkpoint?: string; successor?: string; ticketKey?: string; kind?: TicketKind } }`
    (`ticketKey` and `kind` on `leaf` and `upkeep` entries; when absent, `ticketKey` is derived deterministically as
    the identifier lowercased, `key-123`, and `kind` is `task`),
    `MapBody { team: string; backlog?: { slug: string; title: string; epics: PlanEpicBody[] }[]; epics?: { programme: string; epics: PlanEpicBody[] }[]; entries: MapEntry[]; snapshot: Record<string, IssueSnapshot> }`,
    `IssueSnapshot { state: string; team: string; project: string | null; parent: string | null; milestone: string | null; title: string; description: string }`).
  - `IssueSnapshotRow = IssueSnapshot & { linearId: string; identifier: string }`; `MapCounts = { created: number; moved: number; closed: number; left: number; skipped: number }`;
    `MigrationStep = { op: CcrcOpName; linearId: string | null; before: IssueSnapshot | null; after: Readonly<Record<string, unknown>> }`;
    `MoveRow` = a `linear_migration_moves` row with `before` and `after` parsed.
  - `checkMap(map: MapBody, open: readonly IssueSnapshotRow[], plans: (programme: string) => { declared: boolean; live: boolean; plan: StoredPlan | null }): { ok: true; counts: MapCounts } | { ok: false; word: 'map-incomplete' | 'map-rewrites-plan' | 'plan-bad-body'; detail: string }`
    — every open issue listed once and nothing else; every target exists in the map or the store; `epics` given for a
    programme that is `declared || live` is `map-rewrites-plan` (§10.1: the map declares structure only for a
    programme with no plan **and** no live coordinator, so map-declared structure is confined to done and backlog
    programmes, and the owner never rewrites another programme's plan); a `leaf` or `upkeep` ticket key already used in
    its programme (or Upkeep epic) is `plan-bad-body`; a `leaf` whose epic's project is bound to another team is
    `plan-bad-body` (detail `leaf-other-team`: a migration never moves an issue across teams, which would change its
    identifier and its mirror); counts add up. For a programme with no declared plan, `live` means **it has a
    non-terminal run**, and nothing else: presence plays no part (coordinators are long-lived, one per project, so
    "a coordinator that is not gone" would make nearly every done programme live and its open issues unmappable,
    §10.1's main case), and `programs.state` is never read. The same `live` is `applyTick`'s "done programme" test
    (Task 7.3) and Task 7.2's "live programme's coordinator" mail.
  - `applySteps(map: MapBody, live: ReadonlySet<string>, reread: ReadonlyMap<string, IssueSnapshot | 'closed'>): { now: MigrationStep[]; waiting: string[]; skipped: string[] }`
    — skip an issue whose re-read differs from its snapshot; a live programme's part waits. A step's `after` holds
    every field the sync would plan for the adopted ticket (project, milestone, state type, title and description
    through `issueText`, provenance line included), so the move record covers all of it.
  - `reconcileMove(row: MoveRow, reread: IssueSnapshot | 'closed'): 'applied' | 'redo' | 'skip'` — for a row with no
    `appliedAt` found on a re-run: the re-read equals `after` → `applied`; equals `before` → `redo`; anything else →
    `skip`, listed in the report.
  - `putBackSteps(moves: readonly MoveRow[], current: ReadonlyMap<string, IssueSnapshot>): { steps: MigrationStep[]; moved: string[] }`
    — reverse order; an issue that moved since (its current state differs from the row's `after`) is listed, not
    touched; an issue row restores state, project, parent, milestone, **team, title and description** from `before`;
    a row with `before` null (a create, Task 7.3) becomes a cancel of that object.
  - `replacementComment(home: string, mode: LinkingMode, url: string | null): string` — on a public team, the title only.

- [ ] **Step 1: Write the failing tests** — `an issue missing from the map is map-incomplete`; `an issue listed twice is map-incomplete`;
  `epics for a declared programme with a run open is map-rewrites-plan`;
  `epics for an undeclared programme with a non-terminal run is map-rewrites-plan`;
  `epics for a declared programme with no run at all is map-rewrites-plan` (declaration alone refuses);
  `epics for a done programme with no plan pass, even while its coordinator is alive`;
  `a leaf with no ticketKey gets the identifier-derived key`; `a leaf whose epic's project is in another team is
  plan-bad-body`; `a changed snapshot is skipped and listed`;
  `a live programme's part waits`; `put back reverses in order and lists an issue moved since`;
  `put back restores team, title and description`; `a create row put back is a cancel`;
  `reconcileMove: after → applied, before → redo, other → skip`;
  `a public team's replacement comment has no URL and no identifier`.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/migration-policy.test.ts test/plan-vocabulary.test.ts`.
- [ ] **Step 3: Implement**; pure. `isPlanKebab` admits the map classes.
- [ ] **Step 4: Run to pass** — same, plus `test/mail-routes.test.ts`.
- [ ] **Step 5: Commit** — `feat(linear): the migration map's deciders (D-8186)`.

### Task 7.2: Start, propose and approve

**Files:** Create `server/src/linear/migration.ts`; Modify `server/src/coord/planRoutes.ts` (`plan map-propose`),
`server/src/coord/hierarchyRoutes.ts` (`POST /api/projects/:project/hierarchy/migrate`; acts `approve`, `return`),
`ccd/ccrc-api` (row `[plan.map-propose]='POST|/api/teams/{id}/plan/map|yes|-'`),
`ccd/coordinator-skill/references/plan.md` (the Linear owner's `plan map-propose` duty, its body by example and its
refusals, moved here from wave 6 so the text lands with its row and route),
`pwa/src/screens/settings/ProjectLinkingCard.tsx` (the "Reshape in Linear" control); Test
`server/test/migration-propose.test.ts`, `server/test/coordinator-skill.test.ts`, `pwa/test/project-linking-card.test.tsx`,
`pwa/browser/project-linking-card.browser.test.ts`.

**Interfaces:**
- Produces:
  - `POST /api/projects/:project/hierarchy/migrate` (operator, session-gated): refused `migration-in-flight` while
    another team's migration is not `applied` with its report done or `put-back`, and refused `no-team-key` without a
    key. It creates the `linear_migrations` row (`proposing`), mails the team's Linear owner to propose (or raises
    *Name a Linear owner*), and mails each live programme's coordinator of the team to declare its plan first (§10.1;
    live as Task 7.1 defines it: a non-terminal run, the mail going to its `planOwnerOf`).
  - `POST /api/teams/:team/plan/map` (`plan map-propose`, the Linear owner): reads the team's open issues
    (`teamOpenIssues`, lane `migration`), runs `checkMap`, stores the map with snapshots (`proposed`), raises the
    `decide` item (`action: { verb: 'linear-map', migrationId }`, options `['Approve','Return']`, recommended 0) under
    `LINEAR_SYNC_PROGRAMME`. A follow-up map covers only issues skipped by the same migration. The Linear read runs
    first, outside the mutex; `checkMap` and the store write run inside `serial` (Task 2.4's rule), as do the
    `migrate` route and the `approve` and `return` acts.
  - Acts: `approve` → `approved` (the apply lane picks it up); `return` (note) → `proposing` and the note mailed to the
    owner.
  - The console control on the project row: "Reshape in Linear" (`QuickConfirm` naming the team), shown when the state
    is "Not migrated" or "Put back on <date>"; widths as Task 5.1's table (full width at 360/390, inline from 1280).

- [ ] **Step 1: Write the failing tests** — `a second team while the first is applying is migration-in-flight`;
  `propose by a non-owner is not-linear-owner`; `a map missing an open issue is map-incomplete and raises nothing`;
  `approve moves to approved`; `return mails the owner the note`; the client row's identity and count pins; jsdom
  `the control shows only when not migrated or put back` and the twenty browser views.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/migration-propose.test.ts test/ccrc-api.test.ts test/ccrc-api-closed.test.ts test/box-token-census.test.ts test/coordinator-skill.test.ts`;
  `cd pwa && npx vitest run --maxWorkers=2 test/project-linking-card.test.tsx`.
- [ ] **Step 3: Implement** the routes, the propose read, the acts and the control.
- [ ] **Step 4: Run to pass** — same, plus `test/auth-gate.test.ts test/linear-items.test.ts` and the browser file.
- [ ] **Step 5: Commit** — `feat(linear): start, propose and approve a team's migration (D-8186)`.

### Task 7.3: Apply

**Files:** Modify `server/src/linear/migration.ts`, `server/src/laneSchedule.ts` (row `linearMigration`, cadence
30_000, `skip`), `server/src/watch.ts`, `server/src/coord/planStore.ts` (backlog programmes, `planRequired = 1` for the
team's programmes on apply, `adoptIssueAsTicket`), `server/src/linear/planSync.ts` (the `applying` guard); Test
`server/test/migration-apply.test.ts`.

**Interfaces:**
- Produces (`planStore.ts`): `adoptIssueAsTicket(db, a: { issue: IssueSnapshotRow; programme: string | null; epicId: number; checkpointId: number | null; key: string; kind: TicketKind; source: 'plan' | 'inbound' }, binding: { workspaceId: string; teamKey: string; linearId: string; identifier: string; fingerprint: string }, now: number): number`
  — in one transaction: a `plan_tickets` row (key, kind, title and body from the issue snapshot, the epic's project,
  `source` `plan` for a `leaf` and `inbound` for an `upkeep` entry, state `open`, or `started` when the issue's state
  type is `started`) and a `linear_bindings` row already `bound` to the **existing** issue's UUID, identifier and
  fingerprint; only then is the programme (or `upkeep:<project>`) marked due. Without it, the sync's "one issue per
  known ticket" step would create a duplicate issue for every migrated leaf. Its `fingerprint` is
  `fingerprintOf` over exactly the fields `planSyncSteps` will plan for that ticket, which are the move's `after`
  (Task 7.1), so the first sync pass after adoption emits nothing for the issue.
- Produces: `LinearMigration.applyTick(now: number): Promise<void>` — for an `approved` migration (then `applying`):
  - **Structure the map declares.** For programmes with no plan (backlog programmes `paused`; done programmes a
    completed initiative only when they own open issues; a "done programme" is one the map lists under `epics` that
    has no non-terminal run, Task 7.1's `live`, never one read from `programs.state` alone) and for the team's Upkeep
    epic on first use by an `upkeep` entry (`UPKEEP_EPIC_KEY`, the owning project, no programme, as Task 4.3 does):
    the executor inserts the plan rows **without** marking them due, then creates their initiatives, projects and
    milestones itself, inside that key's `PlanSync.withFlight`, through the sync's step runner (`requestIdOf`, bind
    by name and creator) with pass `migration` and lane `migration`. Before each create it writes a move row
    (`before` null, `subject` `<bindingKind>:<localId>`), and on the answer fills `linearId` and `appliedAt` with the
    binding. Only then is the key due, and the sync finds every object bound. So *Put back* finds these objects in
    the move record alone (Task 7.4).
  - **Each listed issue, in this order**, inside its programme's (or `upkeep:<project>`'s) `withFlight`: re-read it;
    if it differs from its snapshot, skip it, list it and **never adopt it**; else write its move row (`before` from
    the re-read, `after` from Task 7.1's step, which carries every field the sync would plan) **before** the write,
    write it (pass `migration`, lane `migration`), set `appliedAt`, and only after the write succeeds adopt a `leaf`
    or `upkeep` issue with `adoptIssueAsTicket` (fingerprint of the after-state, then due). Adopting first would let
    the plan sync (5 s beat, 200 calls an hour) move the issue long before the migration lane (30 s, 100 an hour)
    reaches it, so the re-read would differ, the issue would be skipped with no move row, and *Put back* could not
    restore it. As a second guard, the sync emits no issue step for a binding whose issue is listed in a migration
    that is `approved` or `applying` and has no applied move row yet. Replaced level issues are canceled with
    `replacementComment` and an `issueRelationCreate` to the first ticket placed under the home; finished issues
    completed with their PR as evidence; superseded canceled and related to the successor; stale closed only when the
    map says so; unclear left.
  - **Crash and re-run.** The unique index on `(migrationId, subject)` (Task 4.1) means a re-run never writes a
    second row. A row with no `appliedAt` is reconciled by Task 7.1's `reconcileMove` against a fresh re-read: equal
    to `after` → mark it applied (and adopt, if not yet); equal to `before` → redo the write; anything else → skip
    and list it. A row with `appliedAt` is not redone.
  - A live programme's part waits for its wave boundary (no run in `ACTIVE_RUN_STATES`). When nothing waits: state
    `applied`, the team is managed, its programmes' `planRequired` set to 1.

- [ ] **Step 1: Write the failing tests** — `every move is recorded before its write`; `a re-run after a crash redoes nothing applied`;
  `a crash after the write and before appliedAt marks the row applied on re-run and writes no second row`;
  `a crash before the write redoes it on re-run`; `an issue adopted only after its write; a skipped issue is never
  adopted`; `the sync emits nothing for an adopted issue on its next pass` (the adoption fingerprint is the
  after-state); `a sync pass during applying never moves a listed issue first`;
  `a migrated leaf is bound, and the next sync pass creates no issue`; `the first upkeep entry creates the Upkeep epic
  once and binds its issue`; `the map's declared projects and initiatives are created by the executor as move rows
  with before null`;
  `a changed issue is skipped and listed`; `a live programme's part waits until no run is dispatched or working`;
  `nothing is ever deleted` (no delete document reaches the fake); `the team is managed after apply`.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/migration-apply.test.ts test/lane-schedule.test.ts`.
- [ ] **Step 3: Implement** `applyTick` and the lane row.
- [ ] **Step 4: Run to pass** — same, plus `test/watcher-quiet-census.test.ts test/plan-store.test.ts test/plan-sync.test.ts`.
- [ ] **Step 5: Commit** — `feat(linear): apply an approved map at wave boundaries (D-8186)`.

### Task 7.4: Report and put back

**Files:** Modify `server/src/linear/migration.ts`, `server/src/coord/hierarchyRoutes.ts` (acts `put-back`, `done`);
Test `server/test/migration-putback.test.ts`.

**Interfaces:**
- Produces: on `applied`, the map item settles and a `do` report item is raised (`action: { verb: 'linear-report', migrationId }`):
  counts first (created, moved, closed, skipped as changed, left), then the full list. `put-back` (confirm) runs
  `putBackSteps` from `linear_migration_moves` alone (pass `put-back`, inside each key's `PlanSync.withFlight`):
  closed issues reopen to their old state, moved issues return to their old project, parent, milestone, team, title
  and description, and every row with `before` null (the initiatives, projects and milestones the executor created,
  Task 7.3) is canceled; the programmes' epics and checkpoints the map declared are dropped with the reason "put
  back"; the tickets `adoptIssueAsTicket` made are dropped with the same reason. Each of those drops also sets
  `putBackAt` (Task 2.2), and the sync's snapshot leaves out every record with `putBackAt` set, so it emits nothing
  for them (otherwise its drop would cancel the very issue put back restored). The filter reads the column, never
  the reason text, so a coordinator's own drop that reads "put back" is still synced. An issue moved since is
  listed on the item, untouched; state `put-back`, the team unmanaged. `done` closes the report. Put back is refused
  once the team's next migration has started.

- [ ] **Step 1: Write the failing tests** — `the report counts skipped issues`; `put back reverses every move and cancels created objects`;
  `an issue moved since is listed, not touched`; `put back after the next migration started is refused`;
  `after put back, the next sync pass writes nothing to an adopted issue`; `put back cancels the projects and
  initiatives the executor created, from their move rows`; `put back restores an adopted issue's title and
  description`; `a coordinator's own drop whose why reads "put back" is still canceled by the sync`;
  `the team is no longer managed after put back`.
- [ ] **Step 2: Run to fail** — `cd server && npx vitest run --maxWorkers=2 test/migration-putback.test.ts`.
- [ ] **Step 3: Implement** the report and the put-back executor.
- [ ] **Step 4: Run to pass** — same, plus `test/migration-apply.test.ts test/linear-items.test.ts`.
- [ ] **Step 5: Commit** — `feat(linear): the migration report and put back (D-8186)`.

---

## Rollout after wave 7

1. The pilot team (the team of ccrc's own repository): the operator taps "Reshape in Linear", the Linear owner
   proposes, the operator approves, and reads the report before any other team starts (the server enforces the order).
2. The remaining teams in the pilot's workspace, one at a time; then each other workspace's teams, one at a time.
