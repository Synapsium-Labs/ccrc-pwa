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
`workMapWords.ts` (L1), and decides nothing (WM3, WM4). Epics free of wave ranges are one task of their own, WM6: the
operator answered Q5 yes (R133, item 359).

**Tech Stack:** TypeScript (shared, server, PWA), Fastify, `node:sqlite`, React, bash (`ccd/ccrc-api`), vitest (node,
jsdom and the browser leg).

**Spec:** `docs/superpowers/specs/2026-11-16-programme-work-map-design.md`. Read it whole before any task; §n below are
its sections, Table 6 is its status decider, Table 6a how a phase reads its tickets, Table 5 its measurement of work
and sequence today, and Table 7 what it keeps and changes of the hierarchy's Task 5.2. Desktop polish Task C37
(D-8669) is the design wave that wrote both. The operator approved the spec (item 363), and WM0's first commit carries
review 2268's amendments into both (D-8715).

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
  (a ticket's done time and evidence). `plan ticket-done` is a new transition beside the hierarchy's, held to verified
  evidence (review 2375 F3); `ticket-required` applies only to a plan that declares phases. Its "the coordinator closes it with a reason" is kept,
  not narrowed: such a ticket reads "closed", counted apart (the coordinator's ruling on review 2268's F10). The one
  change to its model, epics without wave ranges, is the operator's yes to Q5 (R133), built in WM6.
- **Supersedes its Task 5.2** (the Plan section): WM2 to WM4 build that section's design as the Work card (spec Table 7).
  Its `PlanSection.tsx` is not built. Its Task 5.3, the epic page, is unchanged; the strip links to it once it exists.
- **Overlaps with its work in flight and unbuilt:**
  - Its waves change the plan files these tasks change. Each task re-reads the live claims list
    (`ccrc-api claims list --project ccrc-pwa`) for every file it touches and waits for the holder's release or works
    under its co-edit grant (F13 of review 2268). Today's holders, as an example: on 2026-11-17 its wave 4 holds claims
    4728 (`schema.ts`, `planStore.ts`, `planPolicy.ts`, `planRoutes.ts`, `shared/plan.ts`, `shared/refusal.ts`,
    `ccd/ccrc-api` and three tests), 4732 (`auth-gate.test.ts`) and 4737 (`coord-db.test.ts`), and WM0 builds under its
    co-edit grant.
  - Its Task 4.1 also adds a migration and changes `planStore.ts`; its Task 4.3 changes `planRoutes.ts`, `planPolicy.ts`
    and `ccd/ccrc-api`. Whichever lands second takes the next migration slot and builds on the other's store, by merge.
    Neither writes the other's tables.
  - Its Task 6.1, in both directions (F8 of review 2268): it writes `ccd/coordinator-skill/references/plan.md` (WM5
    here) and clause 21, whose test pins that the file names only verbs whose routes exist; and `coordinator-skill.test.ts`
    pins every plan-added run refusal in both `plan.md` and `api.md`, so WM5 adds this plan's verbs and words there.
  - Its §10.1 (each live programme's coordinator declares its plan) is the act R132 brings forward (WM5 Step 2);
    `plan ticket-done` refuses a ticket that is not `open`, so it never acts on a ticket the migration closed.
- **Phases in Linear (R131)** are a label on each issue a phase references, written by its sync, in its sync waves.
  No task here builds it; WM0's `PhaseView` carries each phase's number and title, which the sync names the label from.
- **Its Task 5.2 needs a pointer** to this plan under its heading. That file belongs to the hierarchy programme, so the
  desktop-polish coordinator carries the pointer there; this plan does not edit it.

## Gates: what each task waits for

| Task | Waits for | Why |
|---|---|---|
| WM0 | The operator's approval of the spec (item 363); every file it touches free of other claims, or a co-edit grant | It adds tables and a verb to the plan model the hierarchy builds on, in files that programme is changing now, and a cap word in `shared/api.ts` |
| WM1 | WM0 merged; its files as for WM0 | Its gate rule reads WM0's phases; `ticket-required` is a `RunRefuseCode`, and `plan-ticket-done-v1` a `ServerCap`, in `shared/api.ts` |
| WM2 | WM1 merged; `planRoutes.ts` and `plan-routes.test.ts` as for WM0 | The decider reads WM0's phases and carries and WM1's done facts. The view carries both axes |
| WM3 | WM2 merged | It draws `WorkMapView`, leading with the phases (R130) and calling a stage a phase (R129) |
| WM4 | WM3 merged; **claim 4522 released** | It edits `pwa/src/ledgers/ProgrammeScreen.tsx`, `pwa/src/lib/api.ts` and `pwa/test/programme-screen.test.tsx`, all under claim 4522 |
| WM5 | WM4 merged (so WM0 to WM3 too) | R132: live programmes declare at the first wave boundary after the verbs and the card have landed |
| WM6 | WM1 merged (Q5 is answered yes, R133) | Epics without wave ranges change the hierarchy's work model, which the operator ruled |

*Table 1. The gates. The rule is the re-read, not a list: before it starts, a builder re-reads
`ccrc-api claims list --project ccrc-pwa` for every file in its task, and claim numbers named anywhere in this plan are
examples as measured on their date (F13 of review 2268). On 2026-11-16, for example, claim 4522 held, among others,
`ProgrammeScreen.tsx`, `GoalsPanel.tsx`, `ledgerWords.ts`, `pwa/src/lib/api.ts`, `pwa/src/lib/refusalWords.ts`,
`pwa/test/programme-screen.test.tsx` and `server/test/single-definition/refusal-table.test.ts`, of which only WM4
touches any.*

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
  for WM0, `plan-ticket-done-v1` for WM1, each a `ServerCap` in `SERVER_CAP_MAP`, `shared/api.ts`), as `plan-v1` gates
  the existing rows. Each new cap gate in the client is a cap-reader call that `server/test/census-w3/claimant.test.ts`
  counts, so the task that adds one re-pins that count (F5).
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
- Tables 6 and 6a's order, every terminal outcome named: dropped, then closed, then carried, then done, then left open,
  then outstanding, in a phase (review 2375 F13); an open item beats a stuck verdict, and stuck beats working.
- The four plan states of spec §5.1 kept apart: "no plan" never prints "N of M"; "declared empty" never draws the runs
  fallback; an ended plan shows no outstanding work, decided by `workMapOf` (Table 6 reads row 5 before row 4 there,
  review 2382 L3-F1) and only worded by the card; an unreadable read carries its word, and an absent `work` means
  only an older server.

## File Structure

| File | Task | Ring | Change |
|---|---|---|---|
| `server/src/coord/schema.ts` | WM0, WM1 | L3 | Migrations: `plan_phases` and `plan_phase_refs` (WM0); `plan_tickets.doneAt` and `doneEvidence` (WM1) |
| `shared/plan.ts` | WM0, WM1, WM2 | L0 | Phase, reference and carry bodies and views; `unknown-ref`, `bad-carry`, `evidence-unverified`; `PlanTicketDoneBody`; `WORK_STATUSES`, `WORK_GROUPS`, `WorkMapView` |
| `shared/api.ts` | WM0, WM1 | L0 | `plan-phases-v1` (WM0) and `plan-ticket-done-v1` (WM1) in `ServerCap` and `SERVER_CAP_MAP`; `ticket-required` in `RUN_REFUSE_CODE_MAP` (WM1) |
| `shared/refusal.ts` | WM0, WM1 | L0 | Statuses for the new words; `ticket-required` in `OpenRunConflict` and `RUN_REFUSAL_STATUS` |
| `server/src/coord/planPolicy.ts` | WM0, WM1, WM6 | L1 | Phase, reference and carry checks; a phase's number (`phaseNumbers`, the one derivation); the ticket-done body; optional epic waves (WM6) |
| `server/src/coord/planStore.ts` | WM0, WM1 | L3 | Phases, references and carries, their one writer; `doneAt` and `doneEvidence` in `onRunAdvancedInTx`; `markTicketDone` |
| `server/src/coord/openRun.ts` | WM1, WM6 | L1 | `planGate`: `ticket-required` (WM1); a named ticket gives the epic (WM6) |
| `server/src/coord/planRoutes.ts` | WM0, WM1, WM2 | L4 | `phases` in `plan put` and `PlanView`; the phase-ref and ticket-done routes; `work` on the `GET` |
| `server/src/server.ts` | WM2 | L5 wiring | `registerPlanRoutes` gains the run verdicts reader |
| `server/src/coord/store.ts` | WM1, WM2 | L3 | Reads: a run's state and programme, a landing entry's state (WM1); every work run of one programme with its ticket's key (WM2) |
| `server/src/auth/gate.ts` | WM0, WM1 | L4 | The two new routes' EXEMPT rows, like their siblings |
| `server/src/coord/otherLanes.ts` | WM1 | L1 | `planTicketsDone`, the ticket-done door's row: it refuses the Overlord's body like every plan door (#2996's rule; D-8727) |
| `ccd/ccrc-api` | WM0, WM1 | bash | The `plan phase-ref` and `plan ticket-done` rows, behind their caps |
| `server/src/coord/workMap.ts` | WM2 | L1 | New: `workMapOf` |
| `pwa/src/ledgers/workMapWords.ts`, `pwa/src/ledgers/WorkCard.tsx`, `pwa/src/ledgers/ledgers.css` | WM3 | L1, L4 | New card and its words |
| `pwa/src/lib/api.ts`, `pwa/src/ledgers/ProgrammeScreen.tsx` | WM4 | L3, L4 | `plan(slug)`; the card mounted (claim 4522) |
| `ccd/coordinator-skill/references/plan.md` | WM5 | docs | Declare and keep the plan |

*Table 2. Files by task. New test files are named in each task. No task edits `pwa/src/lib/refusalWords.ts`: only the
coordinator's client sends the plan verbs, and the only plan words with a console sentence today are `linear-text-public`
and `item-act-mismatch` (F20 of review 2268, re-measured for review 2375 F11).*

## Tasks

### Task WM0: phases that reference epics and tickets, with recorded carries

Spec §3, §3.1 and §7, D14, D15, D17 and D18, with F12's carry rule.

**Files:** Modify `server/src/coord/schema.ts`, `shared/plan.ts`, `shared/api.ts` (`plan-phases-v1` in `ServerCap` and
`SERVER_CAP_MAP`), `shared/refusal.ts`, `server/src/coord/planPolicy.ts`, `server/src/coord/planStore.ts`,
`server/src/coord/planRoutes.ts`, `server/src/auth/gate.ts`, `ccd/ccrc-api`; Create `server/test/plan-phases.test.ts`;
Test `server/test/plan-store.test.ts`, `server/test/plan-routes.test.ts`, `server/test/plan-policy.test.ts`,
`server/test/plan-vocabulary.test.ts`, `server/test/coord-db.test.ts`, `server/test/box-token-census.test.ts`,
`server/test/auth-gate.test.ts`, `server/test/ccrc-api.test.ts`, `server/test/ccrc-api-closed.test.ts`,
`server/test/census-w3/claimant.test.ts` (its count of cap-reader calls in `ccrc-api`) and
`server/test/single-definition/plan.test.ts`.

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
  key: string; number: number | null; title: string; summary: string; dropped: boolean; refs: PhaseRefView[];
}   // number: 1-based, in order among the phases not dropped (null for a dropped one); with the title, what the sync
    // names its label from (R131)
// PlanView gains phases?: PhaseView[] (in order), optional on the wire (F6). Its reader is `ccrc-api plan show`.
// A phase stores no state: its progress is the work map's (WM2).
// server/src/coord/planPolicy.ts (L1): THE one derivation of a phase's number (F6); planViewOf and WM2's workMapOf
// both take it from here, and the console never counts positions.
export function phaseNumbers(phases: readonly { key: string; dropped: boolean }[]): ReadonlyMap<string, number>;
```

- The migration adds `plan_phases (id, program, key, ordinal, title, summary, droppedWhy)`, unique (`program`, `key`),
  and `plan_phase_refs (phaseId, kind, refId, carriedTo, carriedAt)`, unique (`phaseId`, `kind`, `refId`), `refId` an
  epic's or a ticket's id by `kind`, `carriedTo` a phase id or null. New tables only, so an older build reads the file
  as-is.
- `plan put` with no `phases` key leaves the stored phases alone. With it, phases diff by key as epics do: a phase that
  disappears needs `droppedWhy`, its references stay stored, and no ticket changes. A put's `refs` are added to the
  stored references and never remove one. A new reference to an unknown or dropped epic or ticket is refused
  `unknown-ref` wherever it stands, on a dropped phase and on a phase the same put drops included; other content on a
  dropped phase, or one the same put drops (its title, summary, position and valid new references), is ignored
  (review 2375 F9), and a reference such a phase already holds is never judged again there (review 2382 L1-F1). One
  stored before that object dropped is kept. At most 24 phases. A put whose phase order would put a
  recorded carry's target at or before its source is refused `bad-carry` (F12).
- `POST /api/programmes/:slug/plan/phases/refs` (`ccrc-api plan phase-ref <slug> --json <f>`), under the plan verbs'
  owner check and shared door: `add` and `remove` change one reference; `carry` writes, in `from`, a ticket reference
  marked `carriedTo` the `to` phase with the time (inserting it when `from` holds the ticket through a whole-epic
  reference), and in `to` a ticket reference, in one transaction. `carry` is refused `bad-carry` when the ticket is not
  `from`'s own work, `to` is not later than `from`, either phase is dropped, or the ticket is done. `add` and `remove`
  refuse an unknown or dropped phase, an unknown object, an `add` of a reference to a dropped object, and a `remove` of
  a reference the phase does not hold, with `unknown-ref`; a `remove` of a stored reference to an object dropped since
  is allowed (review 2375 F14). **F12's remove rule:** a `remove` of either end of a recorded carry (the
  `from` phase's ticket reference marked `carriedTo` a phase that is not dropped, or the `to` phase's ticket reference
  such a carry names) is refused `bad-carry`; every other remove is allowed. A carry from a source dropped since stands,
  so its target end is still refused (review 2375 F10). The verb refuses `plan-closed` once the plan has ended. Its census rows go with it.
- The server advertises `plan-phases-v1`; the new `ccd/ccrc-api` row is refused locally when a current cap file omits it.
- `unknown-ref` and `bad-carry` join `PLAN_REFUSALS`, each with its status in `REFUSAL_STATUS`. `PLAN_REFUSALS`' doc
  comment stops saying every word has a console sentence: only `linear-text-public` and `item-act-mismatch` have one
  (F20; review 2375 F11).
- `census-w3/claimant.test.ts`'s count of cap-reader calls in `ccrc-api` rises by the one new gate (F5).

- [x] **Step 1: Write the failing tests** — `plan-phases.test.ts`: `plan put stores phases in order with their
  references`, `a phase's number counts only phases not dropped`, `a put with no phases key leaves the stored phases`, `a put adds references and never removes one`,
  `a phase may reference a whole epic and a ticket`, `one ticket may be referenced by two phases`, `phase-ref adds and
  removes one reference`, `phase-ref carries a ticket and records the time`, `a carry out of a whole-epic reference is
  stored on a ticket reference`, `each bad-carry case is refused`, `phase-ref refuses a caller that is not the
  coordinator`, `a body naming byId is refused`, `a new reference to an unknown or dropped object is refused
  unknown-ref`, `a reference stored before its ticket dropped is kept`, `dropping a phase needs a reason and leaves its
  tickets alone`, `the stored plans read the same as before`, `removing either end of a recorded carry is refused
  bad-carry`, `removing any other reference is allowed`, `a put that orders a carry's target before its source is
  refused bad-carry`, `phase-ref refuses plan-closed after the plan ends`, `add and remove refuse an unknown or dropped
  phase`; and in `ccrc-api.test.ts`, `the phase-ref row is refused locally without plan-phases-v1`.
- [x] **Step 2: Run to fail** —
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/plan-phases.test.ts`.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run to pass**, then every test named under Files.
- [x] **Step 5: Commit** — `feat(plan): phases that reference epics and tickets, with recorded carries`.

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
`server/test/ccrc-api.test.ts`, `server/test/ccrc-api-closed.test.ts`, `server/test/census-w3/claimant.test.ts` and
`server/test/single-definition/plan.test.ts`.

**Interfaces:**
- The migration adds `plan_tickets.doneAt INTEGER` and `plan_tickets.doneEvidence TEXT` (JSON `{ runId }` or
  `{ pr }`), both nullable, and back-fills every `done` ticket that names a run: `doneEvidence` `{ runId }` from its
  `runId` and `doneAt` from that run's `closedAt` (F1 of review 2268; measured on `main`, every done ticket names its
  done run, because the done arm of `onRunAdvancedInTx` is the only writer of `done` and leaves `runId` set). The done
  arm of `onRunAdvancedInTx` writes `{ runId }` and the time. Nothing outside `planStore.ts` and that migration writes
  either. `shared/api.ts` gains `plan-ticket-done-v1` in `ServerCap` and `SERVER_CAP_MAP`.
- `planGate`, in a plan that declares at least one phase: a `work` run with no `ticket`, into an epic that has an `open`
  ticket whose key is not an auto key (`isAutoTicketKey`) and that no run holds, is refused `ticket-required`. With no
  phase, or no such ticket, it mints one as today. Review runs are untouched. The rule sits after `wave-epic-mismatch`.
  `ticket-required` is a `RunRefuseCode`: its row in `RUN_REFUSE_CODE_MAP`, `OpenRunConflict`, `RUN_REFUSAL_STATUS`
  (409) and `OpenRunConflictCode`, and its row in `open-run-preconditions.test.ts`'s gate order.
- `POST /api/programmes/:slug/plan/tickets/done`, body `{ ticket, evidence: { runId: number } | { pr: number } }`, the
  caller's pair on the query, under the plan verbs' owner check and shared door. It refuses `unknown-ticket`; a ticket
  a run holds with `plan-runs-open` and a ticket not `open` with `plan-bad-body`, the words `plan ticket-move` uses for
  the same conditions (F21 of review 2268); a body without exactly one evidence key with `plan-bad-body`; and evidence
  that does not verify with `evidence-unverified`. `{ runId }` verifies when that run is a `work` run of this programme
  in state `done` whose own ticket is this ticket itself, an auto ticket or none (review 2375 F2: the run that finished
  a ticket is its evidence). `{ pr }` verifies when `landing_entries` holds that pull
  request for the ticket's own project in state `landed` (F19: one rule, the ticket's project); with no landing entry,
  it is refused and the detail says to name the run. Evidence already stored on another ticket of the programme does
  not verify, so one run or pull request closes at most one ticket (F2), except on the run's own auto ticket, which
  folds into the declared ticket (so the fold and the back-fill are reachable, review 2375 F2). On success it sets the ticket `done` with
  `doneAt` and `doneEvidence`, settles its epic (`settleEpicInTx`) and marks the plan's sync due, in one transaction.
- `evidence-unverified` joins `PLAN_REFUSALS` with its status; no `ticket-not-open` is added (F21).
- The server advertises `plan-ticket-done-v1`; `ccrc-api plan ticket-done <slug> --json <f>` is refused locally without it.

- [x] **Step 1: Write the failing tests** — `plan-ticket-required.test.ts`: `in a phased plan, a run with no ticket into
  an epic with an open declared ticket is refused ticket-required`, `a plan with no phases opens it as today`, `an
  epic with only auto tickets open admits it`, `a declared ticket a run holds does not count`, `an epic with no tickets
  admits it`, `a review run is never refused`. `plan-ticket-done.test.ts`: `a run closing done stores doneAt and its
  runId`, `the migration back-fills a done ticket's evidence and time from its run`, `ticket-done marks an open
  declared ticket done with a done run`, `with a landed pull request of the ticket's project`, `refuses a run that is
  not done or not this programme's`, `refuses a run whose own ticket is another declared one`, `accepts the run whose own
  ticket is this one, or whose auto ticket holds its evidence`, `refuses evidence already stored on another ticket of the
  programme, except on the run's own auto ticket`, `refuses a pull request with no landing entry`, `refuses a ticket a run holds with
  plan-runs-open`, `refuses a ticket not open with plan-bad-body`, `settles the epic`, `refuses a caller that is not the
  coordinator`, `refuses two evidence keys`, `refuses a body naming byId`; the census rows for the new route; and in `ccrc-api.test.ts`, `the
  ticket-done row is refused locally without plan-ticket-done-v1`.
- [x] **Step 2: Run to fail** —
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/plan-ticket-required.test.ts test/plan-ticket-done.test.ts`.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run to pass**, then every test named under Files.
- [x] **Step 5: Commit** — `feat(plan): done carries its evidence, and a work run in a phased plan names its ticket`.

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
export const WORK_STATUSES = ['dropped', 'closed', 'done', 'done-unverified', 'left-open', 'waiting-on-you', 'stuck',
  'blocked', 'working', 'state-unknown', 'in-review', 'merging', 'queued', 'not-started', 'failed'] as const;
  // spec Table 6's fourteen rows in order, then 'failed', the no-plan fallback's alone (F22). 'closed': the hierarchy's
  // close with a reason (F10 ruling); 'left-open': an ended plan's ticket that is not done (F4)
export type WorkStatus = (typeof WORK_STATUSES)[number];
export const WORK_GROUPS = ['done', 'in-progress', 'waiting-on-you', 'held', 'not-started', 'dropped', 'closed',
  'left-open', 'failed'] as const;   // closed and left-open count apart, in no "N of M" and no outstanding count (F4)
export type WorkGroup = (typeof WORK_GROUPS)[number];
export interface WorkItemView {
  key: string; title: string; status: WorkStatus; group: WorkGroup;
  reason: string | null;                           // done-unverified: why the evidence does not hold; closed: its reason
  epic: { key: string; title: string } | null;     // the work axis
  // the sequence axis, in order; every number from planPolicy's phaseNumbers (F6). carriedFrom lists each phase whose
  // recorded carry names this one, in phase order: a ticket may be carried into one phase from two (F14). A carry from a
  // source dropped since stands, so its entry's number is null, as PhaseView.number is for a dropped phase (review 2375 F10)
  phases: { key: string; number: number; carriedTo: { key: string; number: number } | null;
    carriedFrom: { key: string; number: number | null }[] }[];
  runId: number | null; lastMoveAt: number | null; wave: number | null;
  doneAt: number | null;
  itemIds: number[];               // open operator items that make it waiting-on-you
  lastFailedRunId: number | null;  // the run that last held a ticket now back at not-started
}
export type PhaseFinish = null | { at: number } | { at: 'unknown' };   // null: not finished
export interface WorkPhaseView {
  key: string; number: number;         // number: from phaseNumbers (F6); dropped phases are not listed
  title: string; summary: string; finish: PhaseFinish;
  counts: Record<WorkGroup, number>;   // its own work: referenced, less dropped and carried out; closed and left-open apart
  carried: number;                     // carried out of this phase
  wholeEpics: string[];                // epic keys this phase takes on whole
  items: string[];                     // ticket keys, plan order
}
export interface WorkEpicView {
  key: string; title: string; done: number; total: number; url: string | null;
  dropped: boolean;                    // a dropped epic is listed only while it holds a done ticket (F3)
  checkpointsMet: number; checkpointsTotal: number;   // decided here, dropped checkpoints in neither (F23)
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
  initiatives: { workspaceId: string; url: string | null; state: BindingState | 'off' | 'none' }[];   // one per workspace, as PlanView (F7)
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
  first match; in an ended plan a ticket not done reads `left-open`, in its own group (F4), a `done-unverified` one
  included: for an ended plan the decider reads row 5 before row 4, so an ended plan shows no outstanding work (the
  coordinator's ruling on review 2382 L3-F1). A ticket the hierarchy's
  Task 4.3 closed with a reason reads `closed` with that reason, in its own group (the F10 ruling); WM2 reads the close
  from whatever that task stores, and until it lands no ticket reads closed.
- Phases follow spec Table 6a, first match: dropped, closed, carried out (a recorded `carriedTo` a phase not dropped),
  done (the verified status, Table 6 row 3: a `done-unverified` ticket is outstanding in a live plan, F9, and left open
  in an ended one, L3-F1), left open, outstanding.
  `carriedTo` is the recorded target; `carriedFrom` lists every phase whose recorded carry names this one. A carry to a
  dropped phase is void. A phase is **empty** when its own work holds no ticket and it records no carry out; an empty
  phase's `finish` is null (F14). Otherwise `finish` is null until all its own work is done, and in an ended plan while
  any own ticket is left open; then the latest of its own `doneAt` and its carries' `carriedAt`, or `'unknown'` when any
  is missing. The headline counts and the strip count each ticket once (spec D16). Tickets in no phase go to
  `notInPhase`.
- A whole-epic reference to a dropped epic still holds the epic's done tickets; the strip lists a dropped epic only
  while it holds a done ticket, marked `dropped`, so the strip's counts add up to the headline's (F3).
- A done ticket's time and evidence come from WM1's columns (its migration back-filled the tickets done before it). A
  done ticket with no stored evidence reads `done-unverified` with the reason "no evidence stored" (F1). A run's own
  ticket (`run-<id>`) whose run is the evidence of a declared ticket is folded into that one ticket (a piece of evidence
  closes at most one, F2; the auto ticket's own `{ runId }` never refuses the declared ticket's, review 2375 F2) and
  counted once.
- `verdicts: 'not-read'` (the reader is empty) skips rows 7 and 8 and is carried on the view; a verdict map drives
  rows 7 and 8 and `lastMoveAt`. The run state `unknown` reads `state-unknown`.
- On a planned programme, its work runs with no ticket are counted in `beforePlan`. A programme with no plan fills
  `runs`: its work runs, newest first; a run title that is null or equal to the programme's title reads as null, and
  the card draws "Wave N".
- The store read returns every work run of the programme with its ticket's key (`runs.ticketId` joined to
  `plan_tickets.key`). A failed run keeps its `ticketId` while its ticket's `runId` is cleared (`onRunAdvancedInTx`), so
  `lastFailedRunId` is the newest `failed` run naming a ticket that is back at `open`.
- The route reads the plan, its end and done facts, the programme's work runs, the run verdicts reader (from
  `PlanRouteOpts`, wired in `server.ts`), the open items and, for each `doneEvidence`, its verdict (a run's state, a
  landing entry's state), calls `workMapOf`, and answers `{ ok: true, plan, work }`. When any of the reads behind `work`
  throws, it answers `work: { unreadable: <word> }` and still serves `plan`. When the plan read itself throws, it
  refuses as any read does, with no `plan` and no `work`; the page (WM4) keeps its last view (F15).

- [x] **Step 1: Write the failing tests** — `work-map.test.ts`: one case per row of the spec's Tables 6 and 6a, plus
  `an open item on the run beats a stuck verdict`, `stuck beats working`, `verdicts not read skips stuck and blocked
  and says so`, `a run in state unknown reads state-unknown`, `evidence that no longer holds reads done-unverified with
  its reason`, `a dropped ticket is in no total`, `a failed run's ticket reads not-started with lastFailedRunId`, `a
  review run makes no row`, `one phase holds tickets of two epics`, `a whole-epic reference takes a ticket added later
  and leaves out a dropped one`, `two whole-epic references keep a ticket outstanding in both and count it once`, `a
  recorded carry reads carried in the earlier phase and from it in the later one`, `a carried ticket done later stays
  carried in the earlier phase`, `a ticket carried twice reads at each phase`, `a ticket carried into one phase from
  two names both`, `a carry to a dropped phase is void`, `a phase's count excludes its carried tickets`, `a phase
  finishes at its latest own done or carry time`, `a finish with a missing time reads unknown`, `an empty phase is not
  finished`, `a phase whose every reference reads as nothing is empty`, `a done-unverified ticket keeps its phase
  open`, `a done ticket with no evidence reads done-unverified`, `a closed ticket reads closed and counts apart`, `a
  dropped epic's done ticket stays in its whole-epic phase and on its chip`, `the strip's counts add up to the
  headline's`, `phase and carry numbers come from phaseNumbers`, `a ticket in no phase goes to notInPhase`, `a plan
  with no phases still fills epics and items`, `the epic strip counts each epic over every phase`, `checkpoints met
  and total leave out dropped checkpoints`, `two epics with the same checkpoint key keep their items apart`, `an
  initiative per workspace`, `a run's own ticket folds into the declared ticket it is evidence of`, `declared with
  nothing to count reads declared-empty`, `an ended plan reads ended, its open tickets left-open in their own group and
  their phase not finished`, `an ended plan's done-unverified ticket reads left-open, not done-unverified, and counts in
  no outstanding total` (review 2382 L3-F1),
  `no plan: runs filled, no total, failed runs counted apart`, `runs with no ticket on a planned programme count in
  beforePlan`, `a title equal to the programme's reads null`. `plan-routes.test.ts`: `the plan read carries work beside
  plan`, `a failing read answers work unreadable and still serves plan`. `plan.test.ts`: both lists spelled once.
- [x] **Step 2: Run to fail** —
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/work-map.test.ts`.
- [x] **Step 3: Implement** the vocabulary, `workMapOf`, the store read, the wiring and the route's field.
- [x] **Step 4: Run to pass**, then
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/plan-routes.test.ts test/single-definition/plan.test.ts test/sim/mutation-floors.test.ts`.
- [x] **Step 5: Commit** — `feat(plan): the programme's work map, decided once and served on the plan read`.

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
  reads no store and no route, so it merges before WM4. It keeps one piece of local state, the epic filter. It keeps no
  last view: the page (WM4) passes it the last `WorkMapView` it drew together with the failure's word (F15).
- `workMapWords.ts` holds `statusWord(status)`, `headline(view)` ("11 of 21 done", "38 work runs done" with no plan,
  "Plan closed as done on …" or "Plan abandoned on …: …" when ended), `outstandingLine(view)` ("3 in progress · 1
  waiting on you · 6 not started", with "held" when any is), `sourceLine(view, readAt, now)` (adding "stuck and blocked
  not read yet" when `verdicts` is `not-read`), `phaseLine(phase)` ("5 of 8 done · 1 carried to phase 3", "finished
  2026-11-02", "finished, date unknown"), `foldLabel(n)` ("5 done"), `epicChip(epic)` ("5 of 9 · ◇ 1 of 2"),
  `carriedWords` ("carried" for a carried row's status column, "carried to phase 3", "from phase 2", and "from phase
  <key>, dropped" when a `carriedFrom` entry's `number` is null, a carry from a phase dropped since, review 2382 L3-F8;
  "carried" is not a `WorkStatus`, F22), `wholeEpicLine` ("takes on all of …"), `doneWhenLine` ("Done
  when · 1 of 3 proved"), `initiativeNote` (initiatives off), and the notes for each state ("No phases declared: grouped
  by epic"; "No plan declared, so what remains is not known. Below is the work run so far."; "The plan is declared but
  lists no work yet."; "The work could not be read: …").
- The card: the headline and the bar; the epic strip (a chip per epic; a tap filters the groups to that epic's tickets
  and opens a row of its checkpoints, each with its state, kind, and when met its date and evidence, linking to the epic
  page when `epicHref` is given; a second tap clears it); the source line; the phases in order, a finished one folded to
  its line with its date; in each, outstanding tickets first in plan order, carried ones next, then the done ones
  folded; each row its status word, its title, its epic tag and its facts; "Not in a phase" last; the folded Done when
  line; *Open in Linear* only where a `url` is present, and the initiatives-off note, one per workspace. A plan with no
  phases draws the epic grouping. An `unreadable` answer draws its note over the view the page passes in.

| Width | Layout |
|---|---|
| 360, 390 | One column; a row stacks status, title with its tag, facts; the strip wraps |
| 1280, 1470, 1920 | Status, title with its tag, and facts on one row; the tag wraps under the title before the facts do |

- [ ] **Step 1: Write the failing tests** — jsdom: `the headline reads N of M done`, `the outstanding line names
  waiting on you and held apart`, `the no-plan card has no M and says what remains is not known`, `a declared empty plan
  says so and draws no runs`, `an ended plan says how it ended and shows no outstanding work`, `an ended plan words the left-open status
  WM2 sends for a ticket marked done whose evidence does not verify, and draws no outstanding line` (review 2375 F13;
  review 2382 L3-F1: `workMapOf` decides it and the card decides nothing), `an unreadable answer
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
  above Runs. The page alone keeps the last view (F15): a failed read, or an `unreadable` `work`, keeps the last view
  and says the read failed; a failed first read draws "The work could not be read" with the refusal's word. An absent
  `work` draws no card.

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

**Files:** Modify `ccd/coordinator-skill/references/plan.md` and `ccd/coordinator-skill/references/api.md`. The skill's
`SKILL.md` clauses are pinned verbatim by
`server/test/coordinator-skill.test.ts`, so this task changes the reference file only, and names only verbs whose
client row and route exist when it merges (the rule the hierarchy's Task 6.1 pins).

- [ ] **Step 1:** Add a section to `references/plan.md`: the programme page's Work card is drawn from this plan. A
  coordinator declares its epics and tickets (the work) and its phases (the sequence), each phase referencing the epics
  and tickets it takes on; records a slip with `plan phase-ref` and `op: 'carry'`; adds a ticket (`plan ticket-add`) in
  the same act that adds the task to its plan file; names the ticket at `runs open` (`ticket-required` in a phased plan,
  with its recovery; `ticket-required` is already in `references/plan.md`, by #3001); and records a ticket finished
  another way with `plan ticket-done` and the run that did it. It names `unknown-ref`, `bad-carry` and
  `evidence-unverified`, each with its recovery, and adds `ticket-required` with its recovery to `references/api.md`, so
  `coordinator-skill.test.ts`'s pin of the plan-added run refusals in both files goes from five to six (F8 of review
  2268); Files gains `ccd/coordinator-skill/references/api.md`.
- [ ] **Step 1b:** In the same act that names `evidence-unverified` in `references/plan.md`, delete WM1's `NOT_MET` row
  for `evidence-unverified` in `server/test/coordinator-plan-reference.test.ts` (and `ticket-done` from its
  `WORK_MAP_VERBS` once the verb is documented), so the test checks the word and the verb from then on; the row does not
  go red by itself when the word is named (D-8727, `evidence-unverified-not-met-until-wm5`).
- [ ] **Step 2:** The notice and the back-fill. A skill reaches a home only once its installer has run there, so the
  desktop-polish coordinator also mails every live programme's coordinator (from `ccrc-api runs list`, each open
  programme's claimant) once this task merges: declare the plan at your next wave boundary with `plan put` (epics and
  tickets, phases with their references), then record each ticket already finished with `plan ticket-done` and the run
  that did it, as `references/plan.md` now says. The run that did it verifies when its own ticket is that ticket, an
  auto ticket or none (spec §4.1, review 2375 F2). Each coordinator's declaration and back-fill is its own act, not a
  PR, recorded in its own ledger note; a ticket whose evidence does not verify stays open (spec §4.1).
- [ ] **Step 3:** Run
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/coordinator-skill.test.ts test/skill-size-ratchet.test.ts test/ccrc-api-closed.test.ts`.
- [ ] **Step 4: Commit** — `docs(coordinator): declare and keep the plan, so the programme page shows what remains`.

**Acceptance.** The skill tests pass. **Rollback.** A plain revert.

### Task WM6: an epic may run without a wave range (Q5, answered yes)

Spec Q5, answered yes (R133, item 359). This changes the hierarchy's work model (its §4.1 "Wave" call, §16 call 2, and
its plan's clause 21), on the operator's yes.

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
  and the done columns, and its §4.1 transition "the coordinator closes it with a reason" is built by its own Task 4.3
  (`take … close: { why }`), beside which WM1 adds `plan ticket-done` (review 2375 F3); the overlaps above (its wave
  3 in flight, Tasks 4.1, 4.3 and 6.1, §10.1). Phases in Linear are its sync waves' work (R131), from the phase number
  and title WM0 carries; epics without wave ranges follow Q5 (answered yes, R133); its "the coordinator closes it with a
  reason" is kept and reads "closed" on the card (the F10 ruling). That programme's coordinator records these in its own
  plan; this plan does not edit that file.

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

Task WM0 departs under its own number:

- **D-8715** — `work-map-review-2268-amendments`: Task WM0 (desktop polish run 2362), issued on 2026-11-17. WM0's first
  commit amends the spec and this plan for review 2268's F1 to F9 and F12 to F25, with the coordinator's ruling on F10
  (the hierarchy's close with a reason is kept as its own outcome, "closed", counted apart; only verified evidence makes
  done) and the operator's R133 (item 359, Q5 yes). Where a finding left a choice, the narrowest reading was taken: a
  done ticket's evidence is back-filled from its run in WM1's migration (F1); one piece of evidence closes one ticket
  (F2); a dropped epic's done tickets stay counted (F3); `left-open` and `closed` are groups of their own (F4, F10);
  `plan-phases-v1` lives in `shared/api.ts` (F5); a phase's number is derived once, in `planPolicy.ts` (F6); the
  `remove` of either end of a recorded carry, and a put that reorders a carry's target before its source, are refused
  `bad-carry` (F12); `plan ticket-done` reuses `plan-runs-open` and `plan-bad-body`, so `ticket-not-open` is never added
  (F21); `{ pr }` evidence is judged by the ticket's own project (F19). The build departs from the plan's text in three
  small ways: `plan show` answers `phases` only for a programme that declares one, so a plan with no phases reads exactly
  as before WM0 (the acceptance); the client refuses `capability-missing`, the timers' word, rather than a new one; and a
  phase holds at most 200 references (`PLAN_BOUNDS.refsPerPhase`, the tickets' bound). Fix round 1 (review 2375) moved
  the migration to slot 90 behind main's 88 and 89, recorded the coordinator's rulings on F9, F10 and F14 in the spec
  and this plan, changed `diffPhases` for F9 (it now refuses `unknown-ref` on a dropped phase and on one the same put
  drops), and corrected F2's rule (evidence stored on another ticket of the programme does not verify, except on the
  run's own auto ticket). Fix round 2 (review 2382) moved the migration to slot 91 behind main's 90, and then to 92 and 93 behind main's 91 and 92, pinned a dropped or
  dropping phase's held and new references with two rows and three mutants, and recorded the coordinator's ruling on
  L3-F1 (an ended plan shows no outstanding work: Table 6 reads row 5 before row 4 there). The task note
  (`docs/superpowers/programs/desktop-polish/wm0.md`) lists each amendment and the finding it answers, the migration
  slot, the rows and the mutants.

Task WM1 departs under its own number:

- **D-8727** — `work-map-wm1-build`: Task WM1 (desktop polish run 2416), issued on 2026-11-17. Its first commit carries
  two of review 2412's three text minors on WM0: spec Figure 2 and two sentences of spec §4.1 now draw the ruled order (an
  ended plan reads a ticket marked done whose evidence does not verify as left open; a live plan keeps "marked done, but
  …", review 2382 L3-F1), and WM0's note words its note-move basis truly. The third, `auth-gate.test.ts`'s gated count,
  measured as the HTTP half less the exempt-HTTP count after WM1's own route, is 161 (the comment said 160); it is in the
  feat commit (review 2429 F11). The build departs from the plan's text in these
  ways, each named by slug: `ticket-done-plan-closed`, `plan ticket-done` refuses `plan-closed` once the plan has ended,
  as its siblings `plan ticket-move` and `plan phase-ref` do; `wm1-reads-reuse-owners`, `store.ts` gains no read: the
  route reads the run through `CoordStore.run` and the landing line through `CoordStore.readLanding`, the one public
  landing read behind its fence, and the plan store gains `ticketOfRun` and `doneFactsOf` beside `markTicketDone`;
  `plan-facts-adapter`, `server/src/coord/planRunFacts.ts` (not in WM1's Files) gives `planGate` the two new facts,
  `phased` and an epic's `tickets`; `pr-evidence-is-one-projects`, a `{ pr }` stored on another ticket refuses only when
  that ticket's project is the same, since a pull request number names one project's pull request (F2 and F19 read
  together); `unreadable-evidence-refuses`, a run or landing line that cannot be read refuses `evidence-unverified` with
  the read's word in the detail, never a new word; `phased-counts-dropped`, a plan "declares a phase" while any phase row
  is stored, dropped ones included; `landed-if-any-entry`, a pull request the landing line holds more than once reads
  landed when any of its entries is `landed`; and the client refuses `capability-missing`, as WM0's row does. After
  review 2429, on the coordinator's ruling (fix round 1, its F2): `run-and-its-pr-are-one-work`, a run and the pull
  request it carried are one piece of work, so a `{ pr }` the landing line ties to a run stored on another ticket does not
  verify, nor a `{ runId }` tied to a pull request stored on another (the linked run's own auto ticket still folds in on
  either side, compared by ticket id: review 2712 F2). The link is read only from `landing_entries`, through `CoordStore.readLanding`, by `evidenceLinksOf` in
  `planRunFacts.ts`, which hands the pure verdict its pairs; nothing reads `runs.closePr` or the lineage, and a link that
  cannot be read refuses `evidence-unverified`, as `unreadable-evidence-refuses` does. The `ticket-required` line in the
  coordinator's `ccd/coordinator-skill/references/plan.md` (outside WM1's Files, added when the coordinator-skill guard went
  red) ships in WM1r, the rules half, for the repository's review judge's rules-mixed reason: a pull request that changes a
  rules file changes nothing else (review 2429 F14); WM1r landed as #3001. After review 2712, on the coordinator's rulings
  (fix round 2): `pr-whose-run-holds-a-ticket` (its F1), a `{ pr }` the landing line ties to a run that holds another
  declared ticket does not verify either, whether or not that ticket stores evidence yet, so one run and the pull request
  it carried cannot close two tickets in either order; the hold is read through its one owner, `plan.ticketOfRun`, by
  `evidenceLinksOf`, which now always reads a `{ pr }`'s own project's line; and `malformed-evidence-refuses` (its F3),
  stored evidence that reads as neither kind goes to the verdict as it was read and refuses `evidence-unverified`, since
  it could be this evidence. Three changes outside WM1's Files, each on the coordinator's word: `ticket-done-is-a-plan-lane`,
  the door is the `OTHER_LANES` row `planTicketsDone` in `server/src/coord/otherLanes.ts`, which refuses the Overlord's body
  as every plan write door does under #2996's rule (`overlord-other-lanes.test.ts` counts ten plan-door rows, and the
  route suite drives the door); `act-key-pinned-at-its-slot`, #3035's act-key store test pinned its migration as the last
  entry, so WM1's later migration turned it red: it now finds the entry by content at slot 102 exactly; and
  `evidence-unverified-not-met-until-wm5`, #3040's plan-reference test gives `evidence-unverified` a `NOT_MET` row until WM5
  names the word in `references/plan.md` and deletes the row. On 2026-11-19, the spec's WM5 sentence that WM5 adds
  `ticket-required` to `references/plan.md` is done already, by #3001. The task
  note (`docs/superpowers/programs/desktop-polish/wm1.md`) gives the migration slot, each row and what reds it, and the
  mutants.

Task WM2 departs under its own number:

- **D-8779** — `work-map-wm2-build`: Task WM2 (desktop polish run 2779), issued on 2026-11-19. The work map is decided once,
  by `workMapOf` in `server/src/coord/workMap.ts` (L1), and served as `work` beside `plan` on the plan read; it needs no
  migration. The build departs from the plan's text in these ways, each named by slug: `closed-reads-nothing-yet`, the
  hierarchy's close with a reason (its Task 4.3) stores a close only as the drop of an Upkeep ticket, so the decider takes
  the close as an input map that Table 6 row 2 reads and its cases pin, and the route passes it empty until that task
  stores a programme ticket's close; `evidence-and-verdicts-decided-in-l1`, the route only gathers, so the read side of
  WM1's evidence rule is a second pure decider, `doneEvidenceVerdict`, and "the reader is empty" is a third,
  `verdictsReadOf`, both in `workMap.ts`; `last-move-from-the-run`, `lastMoveAt` comes from the run, stamped by
  `withLastMoves`, not from the verdicts map, so a reader not read yet keeps every row's last move;
  `dropped-tickets-are-items`, the top-level `items` list every ticket once, a dropped one with status `dropped` counted in
  `counts.dropped`, while no phase, epic, `notInPhase` or "N of M" holds it; `declared-reads-planBy`, "declared" reads
  `planBy`, which the plan store writes in one statement with `planAt`; `run-row-title-nullable`, a run row's title is
  null when its run title is missing or repeats the programme's, and the fallback's `waves` is null with no work run;
  `held-by-an-unread-run`, a ticket held by a run the run read did not return reads `state-unknown`; `unreadable-words`,
  `work.unreadable` is `run-unreadable` (the store's word) or `read-failed` (a read that throws), while a landing line that
  cannot be read makes only that ticket's evidence fail; `dropped-epic-while-it-holds-a-ticket`, a dropped epic stays on
  the strip while it holds a ticket not dropped, so the strip adds up to the headline (F3); `not-in-phase-only-when-phased`,
  `notInPhase` is empty for a plan with no phase; `three-floor-keys`, three `MUTANT_SETS` keys and floors, one per decider
  in `workMap.ts`; and `tests-beside-the-decider`, the cases and the decider were written together, so each row's red is
  measured by its mutant rather than by a run before the decider existed. Three edits under other claims, each with the
  holder's consent by mail: one read in `server/src/coord/store.ts` (`programmeWorkRuns`) and the three floor rows (claim
  5529), the `runVerdicts` wiring property in `server/src/server.ts` (claim 5558), and, after CI's first fast run, the
  plan doors' inline snapshot in `server/test/overlord-other-lanes-pin.test.ts` (claim 5572), which records the whole plan
  read. That run also asked `isPlanKebab` to admit the map's words (`map-words-are-plan-words`: the map's sources, verdict
  reads and unreadable words are lists in `shared/plan.ts` too) and the WM0 characterization to set `work` aside
  (`characterization-reads-plan-only`). The task note
  (`docs/superpowers/programs/desktop-polish/wm2.md`) gives each row and what reds it, the mutants and the test runs.

## Where things stand

- **Agreed:** the brief's rulings (2026-11-16) on placement, derived status and one owner; the operator's rulings the same
  day (spec Table 1); the coordinator's rulings on review 2252: done derived from verified evidence, carries recorded,
  the view carrying both axes, and changes to the hierarchy's model left to the operator.
- **Ruled by the operator:** R129 (item 355, a stage is a phase), R130 (item 354, phases lead), R131 (item 356, a phase
  becomes a Linear label, written by the hierarchy's sync), R132 (item 353, live programmes declare at their next wave
  boundary after the build lands), R133 (item 359, Q5: an epic may list no wave range, built in WM6). The operator
  approved the spec (item 363, "start the build at WM0").
- **Ruled by the coordinator on review 2268:** the hierarchy's close with a reason is kept, as its own outcome
  "closed" (F10); F1 to F9 and F12 to F25 are carried into WM0's first commit as amendments, F11 as one sentence, F26
  is moot and F27 one dropped sentence (D-8715).
- **Ruled by the coordinator on review 2375:** a new reference to an unknown or dropped object is refused everywhere in
  a put (F9); a carry from a dropped source stands (F10); a stored reference to an object dropped since may be removed
  (F14).
- **Ruled by the coordinator on review 2382:** an ended plan shows no outstanding work, decided in `workMapOf` (Table 6
  reads row 5 before row 4 there) and only worded by WM3 (L3-F1).
- **Waiting on you:** nothing.
- **Later:** the hierarchy's waves 3 to 7, set up separately; a frame for plan edits.
