# The programme's work map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The programme page gains a Work card below Goals, the realisation of the Linear hierarchy plan's Task 5.2,
extended. It shows the hierarchy's plan model (programme, epic, checkpoint, ticket) with a separate sequence axis the
operator asked for: phases in order, each referencing the epics and tickets it takes on. The card leads with the phases;
each ticket in one has a status derived from facts the server holds and a tag naming its epic; a strip under the
headline gives each epic's count and its checkpoints. A plan with no phases groups by epic. A programme with no plan
shows its work runs so far, under a note that what remains is not known.

**Architecture:** The plan model gains phases and their references to epics and tickets, written by the plan store
alone; epics stop being tied to wave ranges (WM0). Two more additions keep "N of M" honest: a work run names its ticket, and a coordinator
records a finished ticket (WM1). One pure decider in Coordination, `workMapOf` (`server/src/coord/workMap.ts`, L1),
turns the plan, the programme's runs and its open items into a `WorkMapView`, served as an additive `work` field on
`GET /api/programmes/:slug/plan` (WM2). The PWA draws it in `WorkCard.tsx` (L4), with its words in `workMapWords.ts`
(L1), and decides nothing (WM3, WM4).

**Tech Stack:** TypeScript (shared, server, PWA), Fastify, `node:sqlite`, React, bash (`ccd/ccrc-api`), vitest (node,
jsdom and the browser leg).

**Spec:** `docs/superpowers/specs/2026-11-16-programme-work-map-design.md`. Read it whole before any task; §n below are
its sections, Table 6 is its status decider, Table 6a how a phase reads its tickets, Table 5 its measurement of work
and sequence today, and Table 7 what it keeps and changes of the hierarchy's Task 5.2. Desktop polish Task
C37 (D-8669) is the design wave that wrote both.

## What was read first

- `pwa/src/ledgers/ProgrammeScreen.tsx`, `ProgrammeRuns.tsx`, `GoalsPanel.tsx`: the page as it stands.
- `shared/plan.ts`, `server/src/coord/planStore.ts` (`attachTicketInTx`, `onRunAdvancedInTx`),
  `server/src/coord/planPolicy.ts` (`waves-not-contiguous`, `wave-overlap`, `epicForWave`), `server/src/coord/openRun.ts`
  (`planGate`), `server/src/coord/planRoutes.ts` (`planViewOf`, the dual-credential `GET`): the stored plan.
- `shared/api.ts#RunSummary` and `shared/ledgers.ts#ItemView` (`runId`, `state`, `neededBy`).
- `docs/superpowers/specs/2026-10-31-programme-ledgers-design.md` §2 and §7, and
  `docs/superpowers/specs/2026-11-10-linear-hierarchy-design.md` §4 and §11.2, with its plan's Task 5.2.

## Relation to the Linear hierarchy plan

- **Built on its wave 2** (#2661, on `main`): `shared/plan.ts`, `planStore.ts`, `planPolicy.ts`, `planRoutes.ts`. Nothing
  here depends on its waves 3 to 7. The card's *Open in Linear* links appear only once its sync (wave 3) binds the plan
  objects; until then the card draws none.
- **Supersedes its Task 5.2** (the Plan section): WM2 to WM4 build that section's design as the Work card (spec Table 7).
  Its `PlanSection.tsx` is not built.
- **Overlaps with its unbuilt tasks:** its Task 4.1 also adds a migration and writes `planStore.ts`; its Task 6.1 writes
  `ccd/coordinator-skill/references/plan.md`, which WM5 also writes. Whichever lands second takes the next migration slot
  and builds on the other. Its waves 3 to 7 are not planned here; the coordinator has put them to the operator.

## Gates: what each task waits for

| Task | Waits for | Why |
|---|---|---|
| WM0 | The operator's reading of the spec (its "Waiting on you") | It changes the plan model the Linear hierarchy also builds on |
| WM1 | WM0 merged | Its `ticket-required` rule reads WM0's epic-from-ticket path |
| WM2 | WM1 merged | The decider groups by phase and counts on WM1's rule |
| WM3 | WM2 merged; Q2 and Q3 ruled | It draws `WorkMapView`; its leading axis and words are Q2's and Q3's |
| WM4 | WM3 merged; **claim 4522 released** | It edits `pwa/src/ledgers/ProgrammeScreen.tsx` and `pwa/src/lib/api.ts`, both under claim 4522 |
| WM5 | WM1 merged; Q1 ruled | It tells coordinators to declare and keep their plans, which is Q1's answer |

*Table 1. The gates. Claim 4522 holds `ProgrammeScreen.tsx`, `GoalsPanel.tsx`, `ledgerWords.ts` and `pwa/src/lib/api.ts`
for another programme. Only WM4 touches them.*

## Global Constraints

- **Rings.** `shared/plan.ts` stays L0 and imports nothing new. `workMap.ts` and `planPolicy.ts` make no I/O. Routes
  gather facts and call the deciders; they decide nothing. `workMapWords.ts` is pure.
- **One owner.** A ticket's status is decided in `workMapOf` only. A phase's state is derived there too, never stored.
  Ticket state has one writer module, `planStore.ts`.
- **Wire.** Every new field is optional on the wire, with no `FLEET_PROTO` bump, and has one reader in the console.
- **Plans already stored stay valid.** An epic that lists waves keeps every refusal it has today (WM0).
- **No second plan model.** Nothing reads plan files, checkboxes or ledger tables.
- **Tests run through `ccrc test -- <command>`**, cd'd into the package, for example
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/work-map.test.ts`.
- **Mutation floors.** Every new L1 decider joins `MUTANT_SETS` (`server/test/sim/mutation-floors.test.ts`) and
  `server/test/sim/mutation-floors.json` in the PR that creates it, with the floor measured at merge.
- **Migration number.** WM0's migration takes the next `user_version` slot, re-measured on `origin/main` before the PR
  and again before merge, as `server/src/coord/schema.ts`'s entries say.

## Review Focus

- A status or a phase state decided anywhere but `workMapOf`: a second writer of the fact.
- An epic that lists waves losing a refusal it has today.
- Table 4's order: an open item beats a stuck verdict, and stuck beats working.
- The fallbacks never print "N of M done" for a programme with no plan.
- An absent `work` draws no card, never an empty one.

## File Structure

| File | Task | Ring | Change |
|---|---|---|---|
| `server/src/coord/schema.ts` | WM0 | L3 | Migration: `plan_phases` and `plan_phase_refs` |
| `shared/plan.ts` | WM0, WM1, WM2 | L0 | Phase and reference bodies and views; `waves` optional; `unknown-ref`, `ticket-required`; `PlanTicketDoneBody`; `WORK_STATUSES`, `WORK_GROUPS`, `WorkMapView` |
| `server/src/coord/planPolicy.ts` | WM0, WM1 | L1 | Phase and reference checks; contiguity and overlap among epics that list waves; `ticketRequired` |
| `server/src/coord/planStore.ts` | WM0, WM1 | L3 | Phases and references, their one writer; `markTicketDone` |
| `server/src/coord/openRun.ts` | WM0, WM1 | L1 | `planGate`: a named ticket gives the epic; `ticket-required` |
| `server/src/coord/planRoutes.ts` | WM0, WM1, WM2 | L4 | `phases` in `plan put` and `PlanView`; the phase-ref and ticket-done routes; `work` on the `GET` |
| `server/src/auth/gate.ts` | WM0, WM1 | L4 | The two new routes' EXEMPT rows, like their siblings |
| `ccd/ccrc-api` | WM0, WM1 | bash | The `plan phase-ref` and `plan ticket-done` rows |
| `shared/refusal.ts`, `pwa/src/lib/refusalWords.ts` | WM1 | L0, L1 | `ticket-required`'s status and sentence |
| `server/src/coord/workMap.ts` | WM2 | L1 | New: `workMapOf` |
| `server/src/coord/store.ts` | WM2 | L3 | One read: every work run of one programme, with its ticket's key |
| `pwa/src/ledgers/workMapWords.ts`, `pwa/src/ledgers/WorkCard.tsx`, `pwa/src/ledgers/ledgers.css` | WM3 | L1, L4 | New card and its words |
| `pwa/src/lib/api.ts`, `pwa/src/ledgers/ProgrammeScreen.tsx` | WM4 | L3, L4 | `plan(slug)`; the card mounted (claim 4522) |
| `ccd/coordinator-skill/references/plan.md` | WM5 | docs | Declare and keep the plan |

*Table 2. Files by task. New test files are named in each task.*

## Tasks

### Task WM0: phases that reference epics and tickets, and epics free of wave ranges

Spec §3, D13, D14 and D15.

**Files:** Modify `server/src/coord/schema.ts`, `shared/plan.ts`, `server/src/coord/planPolicy.ts`,
`server/src/coord/planStore.ts`, `server/src/coord/openRun.ts`, `server/src/coord/planRoutes.ts`,
`server/src/auth/gate.ts`, `ccd/ccrc-api`; Create `server/test/plan-phases.test.ts`; Test the existing `plan*`,
`open-run*` and schema tests, the box-token census, the ccrc-api row tests and `server/test/single-definition/plan.test.ts`.

**Interfaces:**

```ts
// shared/plan.ts
export const PHASE_REF_KINDS = ['epic', 'ticket'] as const;
export interface PlanPhaseRefBody { kind: (typeof PHASE_REF_KINDS)[number]; key: string }   // an epic key or a ticket key
export interface PlanPhaseBody { key: string; title: string; summary: string; refs: PlanPhaseRefBody[]; droppedWhy?: string }
export interface PlanPutBody { home?: string; title?: string; phases?: PlanPhaseBody[]; epics: PlanEpicBody[] }
// PlanEpicBody.waves becomes optional
export interface PlanPhaseRefMoveBody { byId: string; byUuid: string; phase: string; ref: PlanPhaseRefBody; op: 'add' | 'remove' }
export interface PhaseView { key: string; title: string; summary: string; dropped: boolean; refs: PlanPhaseRefBody[] }
// PlanView gains phases: PhaseView[] (in order). A phase stores no state: progress is the work map's (WM2).
```

- The migration adds `plan_phases (id, program, key, ordinal, title, summary, droppedWhy)`, unique (`program`, `key`),
  and `plan_phase_refs (phaseId, kind, refId)`, unique on all three, `refId` an epic's or a ticket's id by `kind`. New
  tables only, so an older build reads the file as-is.
- `plan put` diffs phases by key as it diffs epics: a phase that disappears needs `droppedWhy`; its references go with
  it and no ticket changes. Each phase's `refs` replace its stored references. A reference to an unknown or dropped epic
  or ticket is refused `unknown-ref` (a new word in `PLAN_REFUSALS`). At most 24 phases.
- `POST /api/programmes/:slug/plan/phases/refs` (`ccrc-api plan phase-ref <slug> --json <f>`): adds or removes one
  reference, under the plan verbs' owner check, so a slip is one call. Its census rows go with it.
- A ticket may be referenced by several phases, and a phase may reference a whole epic and single tickets of it.
- `waves` on an epic is optional. `waves-not-contiguous` and `wave-overlap` are checked among epics that list waves.
  `planGate`: a run that names a ticket takes the ticket's epic, and checks its wave against that epic only when the epic
  lists waves. A run with no ticket still needs an epic that lists its wave (`wave-epic-mismatch` otherwise).

- [ ] **Step 1: Write the failing tests** — `plan put stores phases in order with their references`, `a phase may
  reference a whole epic and a ticket`, `one ticket may be referenced by two phases`, `phase-ref adds and removes one
  reference`, `phase-ref refuses a caller that is not the coordinator`, `a reference to an unknown or dropped epic or
  ticket is refused unknown-ref`, `dropping a phase needs a reason and leaves its tickets alone`, `an epic with no waves
  is accepted`, `two epics with no waves run in parallel`, `a run naming a ticket of an epic with no waves opens`, `an
  epic that lists waves keeps waves-not-contiguous, wave-overlap and wave-epic-mismatch`, `a run with no ticket and no
  epic listing its wave is refused`.
- [ ] **Step 2: Run to fail** —
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/plan-phases.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then every `plan*`, `open-run*` and schema test, the census and `single-definition`.
- [ ] **Step 5: Commit** — `feat(plan): phases that reference epics and tickets, and epics free of wave ranges`.

**Acceptance.** Every stored plan reads the same before and after (a characterization case over a fixture shaped like
the two live plans). **Rollback.** A plain revert; the new tables are left unread.

### Task WM1: a work run names its ticket, and a coordinator records a finished one

Spec §4.1, D10 and D11.

**Files:** Modify `shared/plan.ts`, `shared/refusal.ts`, `server/src/coord/openRun.ts`, `server/src/coord/planPolicy.ts`,
`server/src/coord/planStore.ts`, `server/src/coord/planRoutes.ts`, `server/src/auth/gate.ts`, `ccd/ccrc-api`,
`pwa/src/lib/refusalWords.ts`; Create `server/test/plan-ticket-required.test.ts`, `server/test/plan-ticket-done.test.ts`;
Test the box-token census and the ccrc-api row tests that pin the plan group.

**Interfaces:**
- `planGate`: a `work` run with no `ticket`, into an epic that has at least one `open` ticket whose key is not an auto
  key (`isAutoTicketKey`), is refused `ticket-required`. With no such ticket, it mints one as today. Review runs are
  untouched. The rule sits after `wave-epic-mismatch` in the gate's order.
- `POST /api/programmes/:slug/plan/tickets/done`, body `{ byId, byUuid, ticket, evidence: { pr: number } | { runId:
  number } }`. The owner check is the plan verbs' own. It refuses `unknown-ticket`; a ticket not `open`, or one a run
  holds, with `ticket-unavailable`; and a body without exactly one evidence key with `plan-bad-body`. It sets the ticket
  `done`, settles its epic (`settleEpicInTx`) and marks the plan's sync due, in one transaction.
- `ccrc-api plan ticket-done <slug> --json <f>`.

- [ ] **Step 1: Write the failing tests** — `a run with no ticket into an epic with an open declared ticket is refused
  ticket-required`, `an epic with only auto tickets open admits it`, `an epic with no tickets admits it`, `a review run
  is never refused`, `ticket-done marks an open declared ticket done with a pr`, `ticket-done settles the epic`,
  `ticket-done refuses a ticket a run holds`, `ticket-done refuses a caller that is not the coordinator`,
  `ticket-done refuses two evidence keys`; and the census rows for the new route.
- [ ] **Step 2: Run to fail** —
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/plan-ticket-required.test.ts test/plan-ticket-done.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then every `plan*` and `open-run*` test, the box-token census and `single-definition`.
- [ ] **Step 5: Commit** — `feat(plan): a work run names its ticket, and a coordinator records a finished one`.

**Acceptance.** Each refusal has a case that reds when its check is deleted. **Rollback.** A plain revert. A ticket
the verb marked done stays done, which is correct.

### Task WM2: the work map, decided once and served on the plan read

Spec §4, §5.1 and §7, D2, D4 and D12.

**Files:** Modify `shared/plan.ts`, `server/src/coord/planRoutes.ts`, `server/src/coord/store.ts` (one read); Create
`server/src/coord/workMap.ts`, `server/test/work-map.test.ts`; Test `server/test/single-definition/plan.test.ts`,
`server/test/sim/mutation-floors.test.ts` and its JSON, the plan route's existing test.

**Interfaces:**

```ts
// shared/plan.ts, beside PlanView
export const WORK_STATUSES = ['dropped', 'done', 'waiting-on-you', 'stuck', 'blocked', 'working', 'in-review',
  'merging', 'queued', 'not-started', 'failed'] as const;   // 'failed': the no-plan fallback's alone
export type WorkStatus = (typeof WORK_STATUSES)[number];
export const WORK_GROUPS = ['done', 'in-progress', 'waiting', 'not-started', 'dropped', 'failed'] as const;
export type WorkGroup = (typeof WORK_GROUPS)[number];
export interface WorkItemView {
  key: string; title: string; status: WorkStatus; group: WorkGroup;
  epic: { key: string; title: string } | null;     // the work axis, shown as a tag
  carriedTo: string | null;        // a later phase that also references it, when not done (spec Table 6a)
  carriedFrom: string | null;      // an earlier phase that also references it
  runId: number | null; lastMoveAt: number | null; wave: number | null;
  itemIds: number[];               // open operator items that make it waiting-on-you
  lastFailedRunId: number | null;  // the run that last held a ticket now back at not-started
}
export interface WorkGroupView {
  kind: 'phase' | 'epic' | 'no-phase' | 'before-plan' | 'runs';
  key: string; title: string; summary: string | null; finishedAt: number | null;
  counts: Record<WorkGroup, number>; carried: number;         // carried tickets are neither done nor outstanding here
  wholeEpics: string[];                                       // epic keys this phase takes on whole
  items: WorkItemView[];                                      // plan order
}
export interface WorkMapView {
  source: 'plan' | 'runs';
  groupedBy: 'phase' | 'epic' | 'run';
  counts: Record<WorkGroup, number>;
  epics: { key: string; title: string; done: number; total: number;
    checkpoints: { key: string; title: string; kind: string; state: string; metAt: number | null;
      evidence: CheckpointEvidence | null; url: string | null }[] }[];   // the strip
  doneWhen: { text: string; proved: boolean }[];                         // the Done when line, from PlanView
  waves: { from: number; to: number } | null;                            // the no-plan source line
  groups: WorkGroupView[];
}
// server/src/coord/workMap.ts (L1, pure)
export function workMapOf(input: {
  plan: PlanView; runs: readonly (RunSummary & { ticketKey: string | null })[];
  openItems: readonly { id: number; runId: number | null }[];
  checkpointItems: ReadonlyMap<string, number>;  // checkpoint key -> its open operator-act item
}): WorkMapView;
```

The builder may rename fields; the shape is the spec's.

- `source` is `plan` when `plan.planned` is true, else `runs`. A plan groups by phase when it declares any phase, and by
  epic otherwise. A phase's referenced set is its ticket references plus the not-dropped tickets of its whole-epic
  references, now and later, each once (spec D15). A ticket in no phase sits in a last group, "Not in a phase". A
  programme with no plan groups by run: one group of its work runs, newest first.
- A ticket that is not done and is referenced by a later phase is `carriedTo` that phase in each earlier one, counted in
  `carried` there and not as outstanding; a phase is finished when every ticket it references is done or carried. The
  headline and the strip count each ticket once (spec D16).
- On a planned programme, its work runs with no ticket form one `before-plan` group after the others, counted apart.
- The store read returns every work run of the programme with its ticket's key (`runs.ticketId` joined to
  `plan_tickets.key`). A failed run keeps its `ticketId` while its ticket's `runId` is cleared (`onRunAdvancedInTx`), so
  `lastFailedRunId` is the newest `failed` run naming a ticket that is back at `open`.
- A run title that is null or equal to the programme's title reads as null, and the card draws "Wave N".
- The route reads the plan, the programme's work runs and its open items, calls `workMapOf`, and answers
  `{ ok: true, plan, work }`.

- [ ] **Step 1: Write the failing tests** — `work-map.test.ts`: one case per row of the spec's Table 4, plus `an open
  item on the run beats a stuck verdict`, `stuck beats working`, `a dropped ticket is in no total`, `a failed run's
  ticket reads not-started with lastFailedRunId`, `a review run makes no row`, `a phased plan groups by phase with each
  ticket's epic`, `one phase holds tickets of two epics`, `a whole-epic reference takes a ticket added later and leaves out
  a dropped one`, `a ticket in two phases counts once in the headline`, `it reads carried in the earlier phase and from
  the earlier phase in the later one`, `a phase whose only open ticket is carried is finished`, `a ticket in no phase goes
  to Not in a phase`, `a plan with no
  phases groups by epic`, `the epic strip counts each epic over every phase`, `a finished phase carries finishedAt`,
  `no plan: grouped by run, no total, failed runs counted apart`, `runs with no ticket on a planned programme form
  before-plan, outside the total`, `a title equal to the programme's reads null`. The route's test: `the plan read
  carries work beside plan`. `plan.test.ts`: both lists spelled once.
- [ ] **Step 2: Run to fail** —
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/work-map.test.ts`.
- [ ] **Step 3: Implement** the vocabulary, `workMapOf`, the store read and the route's field.
- [ ] **Step 4: Run to pass**, then the route's test, `single-definition/plan.test.ts` and `sim/mutation-floors.test.ts`.
- [ ] **Step 5: Commit** — `feat(plan): the programme's work map, decided once and served on the plan read`.

**Acceptance.** Every row of Table 4 has a case that reds when the row is deleted (measured with `mutation-run.py`).
`typecheck-tests`, `single-definition` and `rings` pass. **Rollback.** A plain revert: nothing reads the field yet.

### Task WM3: the Work card and its words

Spec §5. The leading axis and the stage's word follow the operator's rulings on Q2 and Q3; the spec's recommendation is
drawn below.

**Files:** Create `pwa/src/ledgers/WorkCard.tsx`, `pwa/src/ledgers/workMapWords.ts`, `pwa/test/work-card.test.tsx`;
Modify `pwa/src/ledgers/ledgers.css`.

**Interfaces:**
- Consumes: `WorkMapView` (WM2).
- Produces: `WorkCard({ work, readAt, runHref, itemHref }): ReactNode`. It takes the view as a prop and reads no store
  and no route, so it merges before WM4. It keeps one piece of local state, the epic filter.
- `workMapWords.ts` holds `statusWord(status)`, `headline(view)` ("11 of 20 done", or "38 work runs done" with no plan),
  `outstandingLine(view)`, `sourceLine(view, readAt, now)`, `groupLine(group)`, `foldLabel(n)` ("5 done"),
  `epicChip(epic)` ("5 of 9 · ◇ 1 of 2"), `carriedWords` ("carried to phase 3", "from phase 2"), `wholeEpicLine`
("takes on all of …"), `doneWhenLine` ("Done when · 1 of 3 proved") and the two fallback notes ("No phases declared: grouped by epic"; "No plan declared, so
  what remains is not known. Below is the work run so far.").
- The card: the headline and the bar; the epic strip (a chip per epic; a tap filters the groups to that epic's tickets
  and opens a row of its checkpoints, each with its state, kind, and when met its date and evidence; a second tap clears
  it); the source line; the groups in order, a finished one folded to its line with its date; in each, outstanding
  tickets first in plan order, carried ones next, then the done ones folded; each row its status word, its title, its
  epic tag and its facts; the folded Done when line; *Open in Linear* only where a `url` is present.

| Width | Layout |
|---|---|
| 360, 390 | One column; a row stacks status, title with its tag, facts; the strip wraps |
| 1280, 1470, 1920 | Status, title with its tag, and facts on one row; the tag wraps under the title before the facts do |

- [ ] **Step 1: Write the failing tests** — jsdom: `the headline reads N of M done`, `the no-plan card has no M and says
  what remains is not known`, `a plan with no phases says it is grouped by epic`, `a finished phase is one line with its
  date`, `done tickets fold into one counted line`, `each ticket shows its epic`, `a chip filters to its epic, shows its
  checkpoints, and a second tap clears it`, `a carried ticket reads carried to its later phase`, `Done when counts the
  proved entries`, `no url draws no Open in Linear`, `every status has a word` (over `WORK_STATUSES`), `a run link opens the run`, `an item link opens the
  item`, `a long title wraps inside the card`.
- [ ] **Step 2: Run to fail** —
  `cd pwa && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/work-card.test.tsx`.
- [ ] **Step 3: Implement** the card and its words.
- [ ] **Step 4: Run to pass**, then pwa's `tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(console): the Work card draws a programme's work map`.

**Acceptance.** The jsdom tests pass; `every status has a word` reds when a word is removed. **Rollback.** A plain
revert: nothing mounts the card yet.

### Task WM4: the programme page shows the Work card below Goals

**Needs claim 4522 released.** It edits `pwa/src/lib/api.ts` and `pwa/src/ledgers/ProgrammeScreen.tsx`.

**Files:** Modify `pwa/src/lib/api.ts` (`plan(slug)`), `pwa/src/ledgers/ProgrammeScreen.tsx`,
`pwa/src/ledgers/ledgers.css`; Test `pwa/test/programme-screen.test.tsx`, `pwa/browser/programme-page.browser.test.ts`.

**Interfaces:**
- `api.plan(slug)` answers `{ ok: true; plan: PlanView; work?: WorkMapView }` or a refusal.
- `ProgrammeScreen` reads the plan on arrival and again when its key moves: this programme's runs as `id:state:stuck`,
  and its items as `id:state`, from the frames already in the store. It keeps the time of the last read for the source
  line. It draws `WorkCard` in the left column under Goals, and moves Waiting on you to the top of the right column,
  above Runs. A failed read keeps the last view and says the read failed. An absent `work` draws no card.

| Width | Order |
|---|---|
| 360, 390 | Goals, Work, Waiting on you, Runs |
| 1280, 1470, 1920 | Left: Goals, Work. Right: Waiting on you, Runs |

- [ ] **Step 1: Write the failing tests** — jsdom: `the Work card sits below Goals`, `Waiting on you heads the right
  column`, `a run moving re-reads the plan`, `an answer with no work draws no card`, `a failed read keeps the last view`;
  browser: the table above in both skins and both themes, no sideways scroll, no clipped phase title or epic tag.
- [ ] **Step 2: Run to fail**, jsdom then the browser file.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** — `feat(console): the programme page shows its work below Goals`.

**Acceptance.** On the live console, one programme with a stored plan and one without each match `plan show` and the
runs list. **Rollback.** A plain revert; the server field stays and is unread.

### Task WM5: coordinators declare and keep their plan, so the Work card shows what remains

**Waits for Q1.** With Q1 answered yes, it also carries the back-fill of each live programme.

**Files:** Modify `ccd/coordinator-skill/references/plan.md`. The skill's `SKILL.md` clauses are pinned verbatim by
`server/test/coordinator-skill.test.ts`, so this task changes the reference file only.

- [ ] **Step 1:** Add a section to `references/plan.md`: the programme page's Work card is drawn from this plan. A
  coordinator declares its epics and tickets (the work) and its phases (the sequence), each phase referencing the epics
  and tickets it takes on, and records a slip with `plan phase-ref`; adds
  a ticket (`plan ticket-add`) in the same act that adds the task to its plan file; names the ticket at `runs open`
  (`ticket-required`, with its recovery); and records a ticket finished before the plan with `plan ticket-done` and its
  pull request.
- [ ] **Step 2:** With Q1 answered yes, each live programme's coordinator declares its plan at its next wave boundary
  with `plan put`, then records each ticket already merged with `plan ticket-done`. This is a coordinator's act, not a
  PR; each records it in its own ledger note.
- [ ] **Step 3:** Run `server/test/coordinator-skill.test.ts` and the skill cap test.
- [ ] **Step 4: Commit** — `docs(coordinator): declare and keep the plan, so the programme page shows what remains`.

**Acceptance.** The skill tests pass. **Rollback.** A plain revert.

## Carried to other plans

- **The Linear hierarchy plan** (`docs/superpowers/plans/2026-11-10-linear-hierarchy.md`): its Task 5.2 is superseded by
  WM2 to WM4 (spec D8 and Table 7); its design's §3 reads an epic as a plan-sized body of work, which may be a stage; its
  §4.1 and §4.3 gain phases and their references, optional epic waves, `ticket-required` and `plan ticket-done` (spec §8).
  Phases in Linear follow the operator's answer to Q4. Whoever picks up its waves 3 to 7 records these in its own
  ledger. This plan does not edit that file.

## Deviations found

Departures are named by slug and reported to the coordinator, who records them in the desktop-polish plan under
D-8669, Task C37's number:

- `phase-is-not-epic`: the operator ruled that a phase or wave and an epic or ticket are separate concepts, that a phase
  references the epics and tickets it takes on, and that a ticket may sit in several phases (spec Table 1, O1 to O4).
  The first draft mapped phase to epic; the plan model gains phases with references, and epics lose their wave ranges
  (spec §3, D13 to D16).
- `hierarchy-5-2-replaced`: the Work card takes the place of the Linear hierarchy plan's Task 5.2 (spec D8).
- `waiting-card-moves-right`: on desktop, Waiting on you moves from under Goals to the top of the right column (spec D5).
- `ticket-required-and-done`: the plan model gains a refusal at `runs open` and a verb that records a finished ticket
  (spec §4.1, D10 and D11), found by the spec's builder check.

## Where things stand

- **Agreed:** the brief's rulings (2026-11-16) on placement, derived status and one owner; the operator's rulings the same
  day (spec Table 1): the sequence and the work are separate axes, a phase references the epics and tickets it takes on,
  a ticket may sit in several phases, and the Linear hierarchy design is the work model.
- **Waiting on you:** Q1 (plans for live programmes), Q2 (the leading axis), Q3 (the stage's word) and Q4 (phases in
  Linear), in the spec.
- **Later:** the hierarchy's waves 3 to 7; a frame for plan edits.
