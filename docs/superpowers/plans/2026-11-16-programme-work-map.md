# The programme's work map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The programme page gains a Work card below Goals, the realisation of the Linear hierarchy plan's Task 5.2,
extended. It shows the hierarchy's plan model (programme, epic, checkpoint, ticket), unchanged, with a separate sequence
axis the operator asked for: phases in order, each referencing the epics and tickets it takes on, and a slip recorded as
a carry. Each ticket has a status derived from facts the server holds, done included, which is derived from verified
evidence. The view carries both axes; the card leads with the phases (the operator's R130), tags each ticket with its
epic, and puts a strip of epic counts and checkpoints under the headline. A plan with no phases groups by epic. A programme with
no plan shows its work runs so far, under a note that what remains is not known.

**Architecture:** The plan model gains phases, their references and recorded carries, written by the plan store alone
(WM0). A ticket's done time and evidence are stored and verified, and a work run in a phased plan names its ticket
(WM1). One pure decider in Coordination, `workMapOf` (`server/src/coord/workMap.ts`, L1), turns the plan, its end, the
programme's runs, the run verdicts, the open items and the evidence verdicts into a `WorkMapView`, served as an additive
`work` field on `GET /api/programmes/:slug/plan` (WM2). The PWA draws it in `WorkCard.tsx` (L4), with its words in
`workMapWords.ts` (L1), and decides nothing (WM3, WM4). Epics free of wave ranges are one task of their own, WM6, built
only if the operator answers Q5 yes.

**Tech Stack:** TypeScript (shared, server, PWA), Fastify, `node:sqlite`, React, bash (`ccd/ccrc-api`), vitest (node,
jsdom and the browser leg).

**Spec:** `docs/superpowers/specs/2026-11-16-programme-work-map-design.md`. Read it whole before any task; §n below are
its sections, Table 6 is its status decider, Table 6a how a phase reads its tickets, Table 5 its measurement of work
and sequence today, and Table 7 what it keeps and changes of the hierarchy's Task 5.2. Desktop polish Task C37
(D-8669) is the design wave that wrote both.

## What was read first

- `pwa/src/ledgers/ProgrammeScreen.tsx`, `ProgrammeRuns.tsx`, `GoalsPanel.tsx`: the page as it stands.
- `shared/plan.ts`, `server/src/coord/planStore.ts` (`attachTicketInTx`, `onRunAdvancedInTx`, `markCheckpointMet`),
  `server/src/coord/planPolicy.ts` (`waves-not-contiguous`, `wave-overlap`, `epicForWave`), `server/src/coord/openRun.ts`
  (`planGate`, `OpenRunConflictCode`), `server/src/coord/planRoutes.ts` (`PlanRouteOpts`, `planViewOf`, the
  dual-credential `GET`): the stored plan.
- `server/src/coord/schema.ts` migration 59 (`plan_tickets`, `programs.planAt`, `planEnd`, `planEndWhy`, `planEndAt`)
  and the landing line (`landing_entries`, `shared/landingLine.ts`'s `landed`).
- `shared/api.ts#RunSummary` (`stuck`, `blockedBy`, `closedAt`), `server/src/coord/runVerdicts.ts` and
  `server/src/coord/runWire.ts` (`withVerdicts`, `withLastMoves`), `shared/ledgers.ts#ItemView`.
- `docs/superpowers/specs/2026-10-31-programme-ledgers-design.md` §2 and §7, and
  `docs/superpowers/specs/2026-11-10-linear-hierarchy-design.md` §4, §10.1, §11.2 and §16, with its plan's Tasks 4.1,
  4.3, 5.2, 5.3 and 6.1.

## Relation to the Linear hierarchy plan

- **Built on its wave 2** (#2661, on `main`): `shared/plan.ts`, `planStore.ts`, `planPolicy.ts`, `planRoutes.ts`. Nothing
  here depends on its waves 3 to 7, which the operator set up separately and this plan does not plan. The card's *Open
  in Linear* links appear only once its sync (wave 3) binds the plan objects; until then the card draws none.
- **Its work model is unchanged** (spec §8). The additions are a new axis (phases, references, carries) and new facts
  (a ticket's done time and evidence). `plan ticket-done` builds its §4.1 transition "the coordinator closes it";
  `ticket-required` applies only to a plan that declares phases. The one change to its model, epics without wave
  ranges, waits for the operator (Q5) in WM6.
- **Supersedes its Task 5.2** (the Plan section): WM2 to WM4 build that section's design as the Work card (spec Table 7).
  Its `PlanSection.tsx` is not built. Its Task 5.3, the epic page, is unchanged; the strip links to it once it exists.
- **Overlaps with its work in flight and unbuilt:**
  - Its wave 3 is in flight now and holds a claim on `server/src/coord/planStore.ts` (claim 4577 when this was
    written), which WM0 and WM1 change: they wait for that claim's release or work under a co-edit grant from its holder.
  - Its Task 4.1 also adds a migration and changes `planStore.ts`; its Task 4.3 changes `planRoutes.ts`, `planPolicy.ts`
    and `ccd/ccrc-api`; its Task 6.1 writes `ccd/coordinator-skill/references/plan.md` (WM5 here) and clause 21, whose
    test pins that the file names only verbs whose routes exist. Whichever lands second takes the next migration slot
    and builds on the other's store, by merge. Neither writes the other's tables.
  - Its §10.1 (each live programme's coordinator declares its plan) is the act R132 brings forward (WM5 Step 2);
    `plan ticket-done` refuses a ticket that is not `open`, so it never acts on a ticket the migration closed.
- **Phases in Linear (R131)** are a label on each issue a phase references, written by its sync, in its sync waves.
  No task here builds it; WM0's `PhaseView` carries each phase's number and title, which the sync names the label from.
- **Its Task 5.2 needs a pointer** to this plan under its heading. That file belongs to the hierarchy programme, so the
  desktop-polish coordinator carries the pointer there; this plan does not edit it.

## Gates: what each task waits for

| Task | Waits for | Why |
|---|---|---|
| WM0 | The operator's reading of the spec; `planStore.ts` free of the hierarchy wave-3 claim, or a co-edit grant | It adds tables and a verb to the plan model the hierarchy builds on, in a file that programme is changing now |
| WM1 | WM0 merged; `planStore.ts` as for WM0; `shared/api.ts` free of other claims (claim 4579 when this was written), or a co-edit grant | Its gate rule reads WM0's phases; `ticket-required` is a `RunRefuseCode` in `shared/api.ts` |
| WM2 | WM1 merged | The decider reads WM0's phases and carries and WM1's done facts. The view carries both axes |
| WM3 | WM2 merged | It draws `WorkMapView`, leading with the phases (R130) and calling a stage a phase (R129) |
| WM4 | WM3 merged; **claim 4522 released** | It edits `pwa/src/ledgers/ProgrammeScreen.tsx`, `pwa/src/lib/api.ts` and `pwa/test/programme-screen.test.tsx`, all under claim 4522 |
| WM5 | WM4 merged (so WM0 to WM3 too) | R132: live programmes declare at the first wave boundary after the verbs and the card have landed |
| WM6 | WM1 merged; Q5 answered yes | Epics without wave ranges change the hierarchy's work model, which is the operator's call |

*Table 1. The gates. Claim numbers are as measured on 2026-11-16 and change; a builder re-reads `ccrc-api claims list`
for every file in its task before it starts. Claim 4522 holds, among others, `ProgrammeScreen.tsx`, `GoalsPanel.tsx`,
`ledgerWords.ts`, `pwa/src/lib/api.ts`, `pwa/src/lib/refusalWords.ts`, `pwa/test/programme-screen.test.tsx` and
`server/test/single-definition/refusal-table.test.ts`. Only WM4 touches any of them.*

## Global Constraints

- **Rings.** `shared/plan.ts` stays L0 and imports nothing new. `workMap.ts` and `planPolicy.ts` make no I/O. Routes
  gather facts and call the deciders; they decide nothing. `workMapWords.ts` is pure.
- **One owner.** A ticket's status, a phase's progress, a carry's reading and a finish time are decided in `workMapOf`
  only, and never stored. Ticket state, `doneAt`, `doneEvidence` and the phase tables have one writer module,
  `planStore.ts`.
- **The hierarchy's model is unchanged** outside WM6: every rule on epics, checkpoints and tickets reads as before, and a
  plan with no phases opens runs exactly as today.
- **Identity on the query.** Every new verb takes the caller's pair from the query through the plan routes' shared door,
  like the existing plan verbs; a body that names `byId` or `byUuid` is refused by the closed body parsers.
- **Wire.** Every new field is optional on the wire, with no `FLEET_PROTO` bump, and has one reader in the console. Each
  new verb's `ccd/ccrc-api` row is refused locally when a current cap file omits its capability word (`plan-phases-v1`
  for WM0, `plan-ticket-done-v1` for WM1), as `plan-v1` gates the existing rows.
- **No second plan model.** Nothing reads plan files, checkboxes or ledger tables.
- **Tests run through `ccrc test -- <command>`**, cd'd into the package, for example
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/work-map.test.ts`.
- **Mutation floors.** Every new L1 decider joins `MUTANT_SETS` (`server/test/sim/mutation-floors.test.ts`) and
  `server/test/sim/mutation-floors.json` in the PR that creates it, with the floor measured at merge.
- **Migration numbers.** WM0's and WM1's migrations each take the next `user_version` slot, re-measured on
  `origin/main` before the PR and again before merge, as `server/src/coord/schema.ts`'s entries say.

## Review Focus

- A status, a phase state, a carry or a finish time decided anywhere but `workMapOf`: a second writer of the fact.
- A carry read from two phases naming one ticket, rather than from a recorded carry.
- "Done" without evidence that verifies on the read, or "not read" verdicts folded into "not stuck".
- A plan with no phases, or an epic that lists waves, losing or gaining a refusal (outside WM6).
- Tables 6 and 6a's order: dropped, then carried, then done, in a phase; an open item beats a stuck verdict, and stuck
  beats working.
- The four plan states of spec §5.1 kept apart: "no plan" never prints "N of M"; "declared empty" never draws the runs
  fallback; an ended plan shows no outstanding work; an unreadable read carries its word, and an absent `work` means
  only an older server.

## File Structure

| File | Task | Ring | Change |
|---|---|---|---|
| `server/src/coord/schema.ts` | WM0, WM1 | L3 | Migrations: `plan_phases` and `plan_phase_refs` (WM0); `plan_tickets.doneAt` and `doneEvidence` (WM1) |
| `shared/plan.ts` | WM0, WM1, WM2 | L0 | Phase, reference and carry bodies and views; `unknown-ref`, `bad-carry`, `ticket-not-open`, `evidence-unverified`; `PlanTicketDoneBody`; `WORK_STATUSES`, `WORK_GROUPS`, `WorkMapView` |
| `shared/api.ts` | WM1 | L0 | `ticket-required` in `RUN_REFUSE_CODE_MAP` |
| `shared/refusal.ts` | WM0, WM1 | L0 | Statuses for the new words; `ticket-required` in `OpenRunConflict` and `RUN_REFUSAL_STATUS` |
| `server/src/coord/planPolicy.ts` | WM0, WM1, WM6 | L1 | Phase, reference and carry checks; the ticket-done body; optional epic waves (WM6) |
| `server/src/coord/planStore.ts` | WM0, WM1 | L3 | Phases, references and carries, their one writer; `doneAt` and `doneEvidence` in `onRunAdvancedInTx`; `markTicketDone` |
| `server/src/coord/openRun.ts` | WM1, WM6 | L1 | `planGate`: `ticket-required` (WM1); a named ticket gives the epic (WM6) |
| `server/src/coord/planRoutes.ts` | WM0, WM1, WM2 | L4 | `phases` in `plan put` and `PlanView`; the phase-ref and ticket-done routes; `work` on the `GET` |
| `server/src/server.ts` | WM2 | L5 wiring | `registerPlanRoutes` gains the run verdicts reader |
| `server/src/coord/store.ts` | WM1, WM2 | L3 | Reads: a run's state and programme, a landing entry's state (WM1); every work run of one programme with its ticket's key (WM2) |
| `server/src/auth/gate.ts` | WM0, WM1 | L4 | The two new routes' EXEMPT rows, like their siblings |
| `ccd/ccrc-api` | WM0, WM1 | bash | The `plan phase-ref` and `plan ticket-done` rows, behind their caps |
| `server/src/coord/workMap.ts` | WM2 | L1 | New: `workMapOf` |
| `pwa/src/ledgers/workMapWords.ts`, `pwa/src/ledgers/WorkCard.tsx`, `pwa/src/ledgers/ledgers.css` | WM3 | L1, L4 | New card and its words |
| `pwa/src/lib/api.ts`, `pwa/src/ledgers/ProgrammeScreen.tsx` | WM4 | L3, L4 | `plan(slug)`; the card mounted (claim 4522) |
| `ccd/coordinator-skill/references/plan.md` | WM5 | docs | Declare and keep the plan |

*Table 2. Files by task. New test files are named in each task. No task edits `pwa/src/lib/refusalWords.ts`: only the
coordinator's client sends the plan verbs, and no plan word has a console sentence today.*

## Tasks

### Task WM0: phases that reference epics and tickets, with recorded carries

Spec §3, §3.1 and §7, D14, D15, D17 and D18.

**Files:** Modify `server/src/coord/schema.ts`, `shared/plan.ts`, `shared/refusal.ts`, `server/src/coord/planPolicy.ts`,
`server/src/coord/planStore.ts`, `server/src/coord/planRoutes.ts`, `server/src/auth/gate.ts`, `ccd/ccrc-api`; Create
`server/test/plan-phases.test.ts`; Test `server/test/plan-store.test.ts`, `server/test/plan-routes.test.ts`,
`server/test/plan-policy.test.ts`, `server/test/plan-vocabulary.test.ts`, `server/test/coord-db.test.ts`,
`server/test/box-token-census.test.ts`, `server/test/auth-gate.test.ts`, `server/test/ccrc-api.test.ts`,
`server/test/ccrc-api-closed.test.ts` and `server/test/single-definition/plan.test.ts`.

**Interfaces:**

```ts
// shared/plan.ts
export const PHASE_REF_KINDS = ['epic', 'ticket'] as const;
export const PHASE_REF_OPS = ['add', 'remove', 'carry'] as const;
export interface PlanPhaseRefBody { kind: (typeof PHASE_REF_KINDS)[number]; key: string }   // an epic key or a ticket key
export interface PlanPhaseBody { key: string; title: string; summary: string; refs: PlanPhaseRefBody[]; droppedWhy?: string }
export interface PlanPutBody { home?: string; title?: string; phases?: PlanPhaseBody[]; epics: PlanEpicBody[] }
// add or remove: { op, phase, ref }; carry: { op: 'carry', from, to, ticket }. The caller's pair rides the query.
export type PlanPhaseRefMoveBody =
  | { op: 'add' | 'remove'; phase: string; ref: PlanPhaseRefBody }
  | { op: 'carry'; from: string; to: string; ticket: string };
export interface PhaseRefView extends PlanPhaseRefBody { carriedTo: string | null; carriedAt: number | null }
export interface PhaseView {
  key: string; number: number; title: string; summary: string; dropped: boolean; refs: PhaseRefView[];
}   // number: 1-based, in order among the phases not dropped; with the title, what the sync names its label from (R131)
// PlanView gains phases: PhaseView[] (in order). A phase stores no state: its progress is the work map's (WM2).
```

- The migration adds `plan_phases (id, program, key, ordinal, title, summary, droppedWhy)`, unique (`program`, `key`),
  and `plan_phase_refs (phaseId, kind, refId, carriedTo, carriedAt)`, unique (`phaseId`, `kind`, `refId`), `refId` an
  epic's or a ticket's id by `kind`, `carriedTo` a phase id or null. New tables only, so an older build reads the file
  as-is.
- `plan put` with no `phases` key leaves the stored phases alone. With it, phases diff by key as epics do: a phase that
  disappears needs `droppedWhy`, its references stay stored, and no ticket changes. A put's `refs` are added to the
  stored references and never remove one. A new reference to an unknown or dropped epic or ticket is refused
  `unknown-ref`; one stored before that object dropped is kept. At most 24 phases.
- `POST /api/programmes/:slug/plan/phases/refs` (`ccrc-api plan phase-ref <slug> --json <f>`), under the plan verbs'
  owner check and shared door: `add` and `remove` change one reference; `carry` writes, in `from`, a ticket reference
  marked `carriedTo` the `to` phase with the time (inserting it when `from` holds the ticket through a whole-epic
  reference), and in `to` a ticket reference. `carry` is refused `bad-carry` when the ticket is not `from`'s own work,
  `to` is not later than `from`, either phase is dropped, or the ticket is done. Its census rows go with it.
- The server advertises `plan-phases-v1`; the new `ccd/ccrc-api` row is refused locally when a current cap file omits it.
- `unknown-ref` and `bad-carry` join `PLAN_REFUSALS`, each with its status in `REFUSAL_STATUS`.

- [ ] **Step 1: Write the failing tests** — `plan-phases.test.ts`: `plan put stores phases in order with their
  references`, `a phase's number counts only phases not dropped`, `a put with no phases key leaves the stored phases`, `a put adds references and never removes one`,
  `a phase may reference a whole epic and a ticket`, `one ticket may be referenced by two phases`, `phase-ref adds and
  removes one reference`, `phase-ref carries a ticket and records the time`, `a carry out of a whole-epic reference is
  stored on a ticket reference`, `each bad-carry case is refused`, `phase-ref refuses a caller that is not the
  coordinator`, `a body naming byId is refused`, `a new reference to an unknown or dropped object is refused
  unknown-ref`, `a reference stored before its ticket dropped is kept`, `dropping a phase needs a reason and leaves its
  tickets alone`, `the stored plans read the same as before`; and in `ccrc-api.test.ts`, `the phase-ref row is refused
  locally without plan-phases-v1`.
- [ ] **Step 2: Run to fail** —
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/plan-phases.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then every test named under Files.
- [ ] **Step 5: Commit** — `feat(plan): phases that reference epics and tickets, with recorded carries`.

**Acceptance.** Every stored plan reads the same before and after (a characterization case over a fixture shaped like
the two live plans), and `runs open` is unchanged for every plan. **Rollback.** A plain revert; the new tables are left
unread.

### Task WM1: done carries its evidence, and a work run in a phased plan names its ticket

Spec §4.1 and §7, D10 and D11.

**Files:** Modify `server/src/coord/schema.ts`, `shared/plan.ts`, `shared/api.ts`, `shared/refusal.ts`,
`server/src/coord/openRun.ts`, `server/src/coord/planPolicy.ts`, `server/src/coord/planStore.ts`,
`server/src/coord/planRoutes.ts`, `server/src/coord/store.ts`, `server/src/auth/gate.ts`, `ccd/ccrc-api`; Create
`server/test/plan-ticket-required.test.ts`, `server/test/plan-ticket-done.test.ts`; Test
`server/test/open-run-preconditions.test.ts` (its gate-order table gains the row), `server/test/plan-run-attach.test.ts`,
`server/test/plan-store.test.ts`, `server/test/plan-vocabulary.test.ts`, `server/test/refusal-status.test.ts`,
`server/test/coord-db.test.ts`, `server/test/box-token-census.test.ts`, `server/test/auth-gate.test.ts`,
`server/test/ccrc-api.test.ts`, `server/test/ccrc-api-closed.test.ts` and `server/test/single-definition/plan.test.ts`.

**Interfaces:**
- The migration adds `plan_tickets.doneAt INTEGER` and `plan_tickets.doneEvidence TEXT` (JSON `{ runId }` or
  `{ pr }`), both nullable. The done arm of `onRunAdvancedInTx` writes `{ runId }` and the time. Nothing outside
  `planStore.ts` writes either.
- `planGate`, in a plan that declares at least one phase: a `work` run with no `ticket`, into an epic that has an `open`
  ticket whose key is not an auto key (`isAutoTicketKey`) and that no run holds, is refused `ticket-required`. With no
  phase, or no such ticket, it mints one as today. Review runs are untouched. The rule sits after `wave-epic-mismatch`.
  `ticket-required` is a `RunRefuseCode`: its row in `RUN_REFUSE_CODE_MAP`, `OpenRunConflict`, `RUN_REFUSAL_STATUS`
  (409) and `OpenRunConflictCode`, and its row in `open-run-preconditions.test.ts`'s gate order.
- `POST /api/programmes/:slug/plan/tickets/done`, body `{ ticket, evidence: { runId: number } | { pr: number } }`, the
  caller's pair on the query, under the plan verbs' owner check and shared door. It refuses `unknown-ticket`; a ticket
  not `open`, or one a run holds, with `ticket-not-open`; a body without exactly one evidence key with `plan-bad-body`;
  and evidence that does not verify with `evidence-unverified`. `{ runId }` verifies when that run is a `work` run of
  this programme in state `done`. `{ pr }` verifies when `landing_entries` holds that pull request for the programme's
  home project or the ticket's project in state `landed`; with no landing entry, it is refused and the detail says to
  name the run. On success it sets the ticket `done` with `doneAt` and `doneEvidence`, settles its epic
  (`settleEpicInTx`) and marks the plan's sync due, in one transaction.
- `ticket-not-open` and `evidence-unverified` join `PLAN_REFUSALS` with their statuses.
- The server advertises `plan-ticket-done-v1`; `ccrc-api plan ticket-done <slug> --json <f>` is refused locally without it.

- [ ] **Step 1: Write the failing tests** — `plan-ticket-required.test.ts`: `in a phased plan, a run with no ticket into
  an epic with an open declared ticket is refused ticket-required`, `a plan with no phases opens it as today`, `an
  epic with only auto tickets open admits it`, `a declared ticket a run holds does not count`, `an epic with no tickets
  admits it`, `a review run is never refused`. `plan-ticket-done.test.ts`: `a run closing done stores doneAt and its
  runId`, `ticket-done marks an open declared ticket done with a done run`, `with a landed pull request`, `refuses a run
  that is not done or not this programme's`, `refuses a pull request with no landing entry`, `refuses a ticket a run
  holds`, `refuses a ticket not open`, `settles the epic`, `refuses a caller that is not the coordinator`, `refuses two
  evidence keys`, `refuses a body naming byId`; the census rows for the new route; and in `ccrc-api.test.ts`, `the
  ticket-done row is refused locally without plan-ticket-done-v1`.
- [ ] **Step 2: Run to fail** —
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/plan-ticket-required.test.ts test/plan-ticket-done.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then every test named under Files.
- [ ] **Step 5: Commit** — `feat(plan): done carries its evidence, and a work run in a phased plan names its ticket`.

**Acceptance.** Each refusal and each verification has a case that reds when its check is deleted. **Rollback.** A plain
revert. A ticket the verb marked done stays done, and its stored evidence stays, unread.

### Task WM2: the work map, decided once and served on the plan read

Spec §3.1, §4, §5.1 and §7, D2, D4, D12, D19 and D20.

**Files:** Modify `shared/plan.ts`, `server/src/coord/planRoutes.ts` (`PlanRouteOpts` gains the run verdicts reader),
`server/src/server.ts` (the wiring at `registerPlanRoutes`), `server/src/coord/store.ts` (one read); Create
`server/src/coord/workMap.ts`, `server/test/work-map.test.ts`; Test `server/test/plan-routes.test.ts`,
`server/test/single-definition/plan.test.ts`, `server/test/sim/mutation-floors.test.ts` and its JSON.

**Interfaces:**

```ts
// shared/plan.ts, beside PlanView
export const WORK_STATUSES = ['dropped', 'done', 'done-unverified', 'waiting-on-you', 'stuck', 'blocked', 'working',
  'state-unknown', 'in-review', 'merging', 'queued', 'not-started', 'left-open', 'failed'] as const;
  // 'left-open': an ended plan's open ticket; 'failed': the no-plan fallback's alone
export type WorkStatus = (typeof WORK_STATUSES)[number];
export const WORK_GROUPS = ['done', 'in-progress', 'waiting-on-you', 'held', 'not-started', 'dropped', 'failed'] as const;
export type WorkGroup = (typeof WORK_GROUPS)[number];
export interface WorkItemView {
  key: string; title: string; status: WorkStatus; group: WorkGroup;
  reason: string | null;                           // done-unverified: why the evidence no longer holds
  epic: { key: string; title: string } | null;     // the work axis
  phases: { key: string; carriedTo: string | null; carriedFrom: string | null }[];   // the sequence axis, in order
  runId: number | null; lastMoveAt: number | null; wave: number | null;
  doneAt: number | null;
  itemIds: number[];               // open operator items that make it waiting-on-you
  lastFailedRunId: number | null;  // the run that last held a ticket now back at not-started
}
export type PhaseFinish = null | { at: number } | { at: 'unknown' };   // null: not finished
export interface WorkPhaseView {
  key: string; title: string; summary: string; finish: PhaseFinish;
  counts: Record<WorkGroup, number>;   // its own work: referenced, less dropped and carried out
  carried: number;                     // carried out of this phase
  wholeEpics: string[];                // epic keys this phase takes on whole
  items: string[];                     // ticket keys, plan order
}
export interface WorkEpicView {
  key: string; title: string; done: number; total: number; url: string | null;
  checkpoints: { key: string; title: string; kind: string; state: string; metAt: number | null;
    evidence: CheckpointEvidence | null; url: string | null }[];
  items: string[];
}
export interface WorkMapView {
  source: 'plan' | 'declared-empty' | 'ended' | 'runs';
  end: { outcome: PlanEndOutcome; why: string | null; at: number } | null;
  verdicts: 'read' | 'not-read';                                   // the run verdicts reader's state
  counts: Record<WorkGroup, number>;                               // each ticket once
  items: WorkItemView[];                                           // each ticket once
  phases: WorkPhaseView[];                                         // the sequence axis; [] when none declared
  notInPhase: string[];
  epics: WorkEpicView[];                                           // the work axis and the strip
  initiative: { url: string | null; state: BindingState | 'off' | 'none' } | null;
  doneWhen: { text: string; proved: boolean }[];
  beforePlan: { runs: number } | null;
  runs: { items: WorkItemView[]; waves: { from: number; to: number } } | null;   // the no-plan fallback
}
export type WorkAnswer = WorkMapView | { unreadable: string };      // the route's `work` field
// server/src/coord/workMap.ts (L1, pure)
export function workMapOf(input: {
  plan: PlanView & { declared: boolean; end: WorkMapView['end']; done: ReadonlyMap<string, { at: number | null; evidence: unknown }> };
  runs: readonly (RunSummary & { ticketKey: string | null })[];
  verdicts: 'not-read' | ReadonlyMap<number, { stuck: boolean; blockedBy: number | null; lastMoveAt: number | null }>;
  openItems: readonly { id: number; runId: number | null }[];
  checkpointItems: ReadonlyMap<string, number>;      // `${epicKey}/${checkpointKey}` -> its open operator-act item
  evidence: ReadonlyMap<string, { holds: true } | { holds: false; reason: string }>;   // ticket key -> verdict
}): WorkMapView;
```

The builder may rename fields; the shape is the spec's.

- `source`: `ended` when the plan has an end; `plan` when it has at least one ticket to count; `declared-empty` when
  `plan put` was run (`programs.planAt` set) with nothing to count; `runs` otherwise. A ticket's status is Table 6's,
  first match; in an ended plan an open ticket reads `left-open` and counts in no outstanding group.
- Phases follow spec Table 6a, first match: dropped, carried out (a recorded `carriedTo` a phase not dropped), done,
  outstanding. `carriedTo` is the recorded target; `carriedFrom` is the phase whose recorded carry names this one. A
  carry to a dropped phase is void. A phase's `finish` is null until it references a ticket and all its own work is
  done; then the latest of its own `doneAt` and its carries' `carriedAt`, or `'unknown'` when any is missing. The
  headline counts and the strip count each ticket once (spec D16). Tickets in no phase go to `notInPhase`.
- A ticket done before WM1 has no `done` entry: its time is the `closedAt` of the run of this programme that names it,
  else null. A run's own ticket (`run-<id>`) whose run is the evidence of a declared ticket is folded into it and
  counted once.
- `verdicts: 'not-read'` (the reader is empty) skips rows 5 and 6 and is carried on the view; a verdict map drives
  rows 5 and 6 and `lastMoveAt`. The run state `unknown` reads `state-unknown`.
- On a planned programme, its work runs with no ticket are counted in `beforePlan`. A programme with no plan fills
  `runs`: its work runs, newest first; a run title that is null or equal to the programme's title reads as null, and
  the card draws "Wave N".
- The store read returns every work run of the programme with its ticket's key (`runs.ticketId` joined to
  `plan_tickets.key`). A failed run keeps its `ticketId` while its ticket's `runId` is cleared (`onRunAdvancedInTx`), so
  `lastFailedRunId` is the newest `failed` run naming a ticket that is back at `open`.
- The route reads the plan, its end and done facts, the programme's work runs, the run verdicts reader (from
  `PlanRouteOpts`, wired in `server.ts`), the open items and, for each `doneEvidence`, its verdict (a run's state, a
  landing entry's state), calls `workMapOf`, and answers `{ ok: true, plan, work }`. When any of those reads throws, it
  answers `work: { unreadable: <word> }` and still serves `plan`.

- [ ] **Step 1: Write the failing tests** — `work-map.test.ts`: one case per row of the spec's Tables 6 and 6a, plus
  `an open item on the run beats a stuck verdict`, `stuck beats working`, `verdicts not read skips stuck and blocked
  and says so`, `a run in state unknown reads state-unknown`, `evidence that no longer holds reads done-unverified with
  its reason`, `a dropped ticket is in no total`, `a failed run's ticket reads not-started with lastFailedRunId`, `a
  review run makes no row`, `one phase holds tickets of two epics`, `a whole-epic reference takes a ticket added later
  and leaves out a dropped one`, `two whole-epic references keep a ticket outstanding in both and count it once`, `a
  recorded carry reads carried in the earlier phase and from it in the later one`, `a carried ticket done later stays
  carried in the earlier phase`, `a ticket carried twice reads at each phase`, `a carry to a dropped phase is void`, `a
  phase's count excludes its carried tickets`, `a phase finishes at its latest own done or carry time`, `a finish with
  a missing time reads unknown`, `an empty phase is not finished`, `a ticket in no phase goes to notInPhase`, `a plan
  with no phases still fills epics and items`, `the epic strip counts each epic over every phase`, `two epics with the
  same checkpoint key keep their items apart`, `a run's own ticket folds into the declared ticket it is evidence of`,
  `declared with nothing to count reads declared-empty`, `an ended plan reads ended and its open tickets left-open`,
  `no plan: runs filled, no total, failed runs counted apart`, `runs with no ticket on a planned programme count in
  beforePlan`, `a title equal to the programme's reads null`. `plan-routes.test.ts`: `the plan read carries work beside
  plan`, `a failing read answers work unreadable and still serves plan`. `plan.test.ts`: both lists spelled once.
- [ ] **Step 2: Run to fail** —
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/work-map.test.ts`.
- [ ] **Step 3: Implement** the vocabulary, `workMapOf`, the store read, the wiring and the route's field.
- [ ] **Step 4: Run to pass**, then
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/plan-routes.test.ts test/single-definition/plan.test.ts test/sim/mutation-floors.test.ts`.
- [ ] **Step 5: Commit** — `feat(plan): the programme's work map, decided once and served on the plan read`.

**Acceptance.** Every row of Tables 6 and 6a has a case that reds when the row is deleted (measured with
`mutation-run.py`). `typecheck-tests`, `single-definition` and `rings` pass. **Rollback.** A plain revert: nothing reads
the field yet.

### Task WM3: the Work card and its words

Spec §5 and §5.1. Phases lead (R130), and a stage is called a phase (R129).

**Files:** Create `pwa/src/ledgers/WorkCard.tsx`, `pwa/src/ledgers/workMapWords.ts`, `pwa/test/work-card.test.tsx`;
Modify `pwa/src/ledgers/ledgers.css`.

**Interfaces:**
- Consumes: `WorkAnswer` (WM2).
- Produces: `WorkCard({ work, readAt, runHref, itemHref, epicHref? }): ReactNode`. It takes the answer as a prop and
  reads no store and no route, so it merges before WM4. It keeps one piece of local state, the epic filter.
- `workMapWords.ts` holds `statusWord(status)`, `headline(view)` ("11 of 20 done", "38 work runs done" with no plan,
  "Plan closed as done on …" or "Plan abandoned on …: …" when ended), `outstandingLine(view)` ("3 in progress · 1
  waiting on you · 6 not started", with "held" when any is), `sourceLine(view, readAt, now)` (adding "stuck and blocked
  not read yet" when `verdicts` is `not-read`), `phaseLine(phase)` ("5 of 8 done · 1 carried to phase 3", "finished
  2026-11-02", "finished, date unknown"), `foldLabel(n)` ("5 done"), `epicChip(epic)` ("5 of 9 · ◇ 1 of 2"),
  `carriedWords` ("carried to phase 3", "from phase 2"), `wholeEpicLine` ("takes on all of …"), `doneWhenLine` ("Done
  when · 1 of 3 proved"), `initiativeNote` (initiatives off), and the notes for each state ("No phases declared: grouped
  by epic"; "No plan declared, so what remains is not known. Below is the work run so far."; "The plan is declared but
  lists no work yet."; "The work could not be read: …").
- The card: the headline and the bar; the epic strip (a chip per epic; a tap filters the groups to that epic's tickets
  and opens a row of its checkpoints, each with its state, kind, and when met its date and evidence, linking to the epic
  page when `epicHref` is given; a second tap clears it); the source line; the phases in order, a finished one folded to
  its line with its date; in each, outstanding tickets first in plan order, carried ones next, then the done ones
  folded; each row its status word, its title, its epic tag and its facts; "Not in a phase" last; the folded Done when
  line; *Open in Linear* only where a `url` is present, and the initiatives-off note. A plan with no phases draws the
  epic grouping. An `unreadable` answer draws its note over the last view drawn.

| Width | Layout |
|---|---|
| 360, 390 | One column; a row stacks status, title with its tag, facts; the strip wraps |
| 1280, 1470, 1920 | Status, title with its tag, and facts on one row; the tag wraps under the title before the facts do |

- [ ] **Step 1: Write the failing tests** — jsdom: `the headline reads N of M done`, `the outstanding line names
  waiting on you and held apart`, `the no-plan card has no M and says what remains is not known`, `a declared empty plan
  says so and draws no runs`, `an ended plan says how it ended and shows no outstanding work`, `an unreadable answer
  says so`, `verdicts not read are named on the source line`, `a plan with no phases says it is grouped by epic`, `a
  finished phase is one line with its date`, `a finish with no date says date unknown`, `done tickets fold into one
  counted line`, `each ticket shows its epic`, `a chip filters to its epic, shows its checkpoints, and a second tap
  clears it`, `a carried ticket reads carried to its later phase and from its earlier one`, `Done when counts the
  proved entries`, `no url draws no Open in Linear`, `initiatives off draws its note`, `every status has a word` (over
  `WORK_STATUSES`), `a run link opens the run`, `an item link opens the item`, `a long title wraps inside the card`.
- [ ] **Step 2: Run to fail** —
  `cd pwa && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/work-card.test.tsx`.
- [ ] **Step 3: Implement** the card and its words.
- [ ] **Step 4: Run to pass**, then `cd pwa && ~/.local/bin/ccrc test -- ./node_modules/.bin/tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(console): the Work card draws a programme's work map`.

**Acceptance.** The jsdom tests pass; `every status has a word` reds when a word is removed. **Rollback.** A plain
revert: nothing mounts the card yet.

### Task WM4: the programme page shows the Work card below Goals

**Needs claim 4522 released.** It edits `pwa/src/lib/api.ts`, `pwa/src/ledgers/ProgrammeScreen.tsx` and
`pwa/test/programme-screen.test.tsx`.

**Files:** Modify `pwa/src/lib/api.ts` (`plan(slug)`), `pwa/src/ledgers/ProgrammeScreen.tsx`,
`pwa/src/ledgers/ledgers.css`; Test `pwa/test/programme-screen.test.tsx`; Create
`pwa/browser/programme-page.browser.test.ts`.

**Interfaces:**
- `api.plan(slug)` answers `{ ok: true; plan: PlanView; work?: WorkAnswer }` or a refusal.
- `ProgrammeScreen` reads the plan on arrival and again when its key moves: this programme's runs as `id:state:stuck`,
  and its items as `id:state`, from the frames already in the store. It keeps the time of the last read for the source
  line. It draws `WorkCard` in the left column under Goals, and moves Waiting on you to the top of the right column,
  above Runs. A failed read keeps the last view and says the read failed; a failed first read draws "The work could not
  be read" with the refusal's word. An absent `work` draws no card.

| Width | Order |
|---|---|
| 360, 390 | Goals, Work, Waiting on you, Runs |
| 1280, 1470, 1920 | Left: Goals, Work. Right: Waiting on you, Runs |

- [ ] **Step 1: Write the failing tests** — jsdom: `the Work card sits below Goals`, `Waiting on you heads the right
  column`, `a run moving re-reads the plan`, `an answer with no work draws no card`, `a failed read keeps the last
  view`, `a failed first read says the work could not be read`; browser: the table above in both skins and both themes,
  no sideways scroll, no clipped phase title or epic tag.
- [ ] **Step 2: Run to fail** —
  `cd pwa && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/programme-screen.test.tsx`,
  then `cd pwa && ~/.local/bin/ccrc test -- npm run test:browser -- programme-page.browser.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, both commands again, then `cd pwa && ~/.local/bin/ccrc test -- ./node_modules/.bin/tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(console): the programme page shows its work below Goals`.

**Acceptance.** On the live console, one programme with a stored plan and one without each match `plan show` and the
runs list. **Rollback.** A plain revert; the server field stays and is unread.

### Task WM5: coordinators declare and keep their plan, so the Work card shows what remains

**R132:** each live programme's coordinator declares its plan at its next wave boundary, which is the first one after
WM0, WM1, WM3 and WM4 have landed. So this task merges after WM4, and its Step 2 is the act.

**Files:** Modify `ccd/coordinator-skill/references/plan.md`. The skill's `SKILL.md` clauses are pinned verbatim by
`server/test/coordinator-skill.test.ts`, so this task changes the reference file only, and names only verbs whose
client row and route exist when it merges (the rule the hierarchy's Task 6.1 pins).

- [ ] **Step 1:** Add a section to `references/plan.md`: the programme page's Work card is drawn from this plan. A
  coordinator declares its epics and tickets (the work) and its phases (the sequence), each phase referencing the epics
  and tickets it takes on; records a slip with `plan phase-ref` and `op: 'carry'`; adds a ticket (`plan ticket-add`) in
  the same act that adds the task to its plan file; names the ticket at `runs open` (`ticket-required` in a phased plan,
  with its recovery); and records a ticket finished another way with `plan ticket-done` and the run that did it.
- [ ] **Step 2:** The notice and the back-fill. A skill reaches a home only once its installer has run there, so the
  desktop-polish coordinator also mails every live programme's coordinator (from `ccrc-api runs list`, each open
  programme's claimant) once this task merges: declare the plan at your next wave boundary with `plan put` (epics and
  tickets, phases with their references), then record each ticket already finished with `plan ticket-done` and the run
  that did it, as `references/plan.md` now says. Each coordinator's declaration and back-fill is its own act, not a
  PR, recorded in its own ledger note; a ticket whose evidence does not verify stays open (spec §4.1).
- [ ] **Step 3:** Run
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/coordinator-skill.test.ts test/skill-size-ratchet.test.ts test/ccrc-api-closed.test.ts`.
- [ ] **Step 4: Commit** — `docs(coordinator): declare and keep the plan, so the programme page shows what remains`.

**Acceptance.** The skill tests pass. **Rollback.** A plain revert.

### Task WM6: an epic may run without a wave range (only if Q5 is answered yes)

Spec Q5. This changes the hierarchy's work model (its §4.1 "Wave" call, §16 call 2, and its plan's clause 21), so it is
built only on the operator's yes.

**Files:** Modify `shared/plan.ts` (`PlanEpicBody.waves` optional), `server/src/coord/planPolicy.ts`,
`server/src/coord/openRun.ts`; Create `server/test/plan-epic-waves.test.ts`; Test `server/test/plan-policy.test.ts`,
`server/test/open-run-preconditions.test.ts`, `server/test/plan-run-attach.test.ts`.

**Interfaces:**
- `waves` on an epic is optional. `waves-not-contiguous` and `wave-overlap` are checked among epics that list waves
  (`planPolicy.ts` already accepts `[]`; the change is the wire's optionality and `planGate`).
- `planGate`: a run that names a ticket takes the ticket's epic, and checks its wave against that epic only when the
  epic lists waves. A run with no ticket whose wave no epic lists, in a plan where any epic lists no waves, is refused
  `ticket-required` (its remedy is to name a ticket), not `wave-epic-mismatch`.

- [ ] **Step 1: Write the failing tests** — `an epic with no waves is accepted`, `two epics with no waves run side by
  side`, `a run naming a ticket of an epic with no waves opens`, `an epic that lists waves keeps waves-not-contiguous,
  wave-overlap and wave-epic-mismatch`, `a run with no ticket into a plan with an epic of no waves is refused
  ticket-required`.
- [ ] **Step 2: Run to fail** —
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/plan-epic-waves.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then every test named under Files.
- [ ] **Step 5: Commit** — `feat(plan): an epic may run without a wave range`.

**Acceptance.** Every stored plan opens runs exactly as before. **Rollback.** A plain revert, once no stored epic lacks
waves.

## Carried to other plans

- **The Linear hierarchy plan** (`docs/superpowers/plans/2026-11-10-linear-hierarchy.md`): its Task 5.2 is superseded by
  WM2 to WM4 (spec D8 and Table 7), and needs a pointer to this plan under its heading; its §4.2 gains the phase tables
  and the done columns, and its §4.1 transition "the coordinator closes it" is built by WM1; the overlaps above (its wave
  3 in flight, Tasks 4.1, 4.3 and 6.1, §10.1). Phases in Linear are its sync waves' work (R131), from the phase number
  and title WM0 carries; epics without wave ranges follow Q5. That programme's coordinator records these in its own plan; this plan does not edit that file.

## Deviations found

Departures are named by slug and reported to the coordinator, who records them in the desktop-polish plan under
D-8669, Task C37's number:

- `phase-is-not-epic`: the operator ruled that a phase or wave and an epic or ticket are separate concepts, that a phase
  references the epics and tickets it takes on, and that a ticket may sit in several phases (spec Table 1, O1 to O4).
  The first draft mapped phase to epic; the plan model gains phases with references and recorded carries (spec §3,
  D14 to D18).
- `hierarchy-5-2-replaced`: the Work card takes the place of the Linear hierarchy plan's Task 5.2 (spec D8).
- `waiting-card-moves-right`: on desktop, Waiting on you moves from under Goals to the top of the right column (spec D5).
- `ticket-required-and-done`: the plan model gains a refusal at `runs open` in a phased plan and a verb that records a
  finished ticket with verified evidence (spec §4.1, D10 and D11), found by the spec's builder check and the review.

## Where things stand

- **Agreed:** the brief's rulings (2026-11-16) on placement, derived status and one owner; the operator's rulings the same
  day (spec Table 1); the coordinator's rulings on review 2252: done derived from verified evidence, carries recorded,
  the view carrying both axes, and changes to the hierarchy's model left to the operator.
- **Ruled by the operator:** R129 (a stage is a phase), R130 (phases lead), R131 (a phase becomes a Linear label,
  written by the hierarchy's sync), R132 (live programmes declare at their next wave boundary after the build lands).
- **Waiting on you:** Q5 (an epic without a wave range), in the spec; WM6 waits for it.
- **Later:** the hierarchy's waves 3 to 7, set up separately; a frame for plan edits.
