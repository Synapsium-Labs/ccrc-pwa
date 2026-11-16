# The programme's work map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The programme page gains a Work card below Goals. It shows the programme's planned work grouped by phase, with
"N of M done", a status for each task derived from facts the server already holds, and, for a programme with no stored
plan, its work runs so far under a note that what remains is not known.

**Architecture:** Two additions to the plan store keep "N of M" honest (WM0): a work run names its task once its phase
lists tasks, and a coordinator records a task done with its evidence. One pure decider in Coordination, `workMapOf` (`server/src/coord/workMap.ts`, L1), turns the stored
plan, the programme's runs and its open items into a `WorkMapView`. The vocabulary sits beside `PlanView` in
`shared/plan.ts` (L0). `GET /api/programmes/:slug/plan` carries the view as an additive `work` field. The PWA draws it
in `WorkCard.tsx` (L4), with its words in `workMapWords.ts` (L1), and decides nothing.

**Tech Stack:** TypeScript (shared, server, PWA), Fastify, `node:sqlite`, React, vitest (node, jsdom and the browser
leg).

**Spec:** `docs/superpowers/specs/2026-11-16-programme-work-map-design.md`. Read it whole before any task; §n below are
its sections, and Table 3 is its status decider. Desktop polish Task C37 (D-8669) is the design wave that wrote both.

## What was read first

- `pwa/src/ledgers/ProgrammeScreen.tsx`, `ProgrammeRuns.tsx`, `GoalsPanel.tsx`: the page as it stands.
- `shared/plan.ts`, `server/src/coord/planStore.ts` (`onRunAdvancedInTx`), `server/src/coord/planRoutes.ts`
  (`planViewOf`, the dual-credential `GET` route): the stored plan and how runs move its tickets.
- `shared/api.ts#RunSummary` (`state`, `stuck`, `blockedBy`, `runTitle`, `kind`, `lastMoveAt`) and
  `shared/ledgers.ts#ItemView` (`runId`, `state`, `neededBy`).
- `docs/superpowers/specs/2026-10-31-programme-ledgers-design.md` §2 and §7, and
  `docs/superpowers/specs/2026-11-10-linear-hierarchy-design.md` §4 and §11.2, with its plan's Task 5.2.

## Gates: what each task waits for

| Task | Waits for | Why |
|---|---|---|
| WM0 | The operator's reading of the spec (its "Waiting on you") | It changes `runs open` for programmes with a plan |
| WM1 | WM0 merged | It fixes the wire and the status table the others draw, and counts on WM0's rule |
| WM2 | WM1 merged; Q2 and Q3 ruled | It reads `WorkMapView`; its order and words are Q2's and Q3's |
| WM3 | WM2 merged; **claim 4522 released** | It edits `pwa/src/ledgers/ProgrammeScreen.tsx` and `pwa/src/lib/api.ts`, both under claim 4522 |
| WM4 | WM1 merged; Q1 ruled | It tells coordinators to declare their plans, which is Q1's answer |

*Table 1. The gates. Claim 4522 holds `ProgrammeScreen.tsx`, `GoalsPanel.tsx`, `ledgerWords.ts` and `pwa/src/lib/api.ts`
for another programme. Only WM3 touches them; WM0, WM1, WM2 and WM4 touch none.*

## Global Constraints

- **Rings.** `shared/plan.ts` imports nothing new (it is L0 and the PWA bundles it). `workMap.ts` imports types only and
  makes no I/O. The route gathers facts and calls the decider; it decides nothing. `workMapWords.ts` is pure.
- **One owner.** A task's status is decided in `workMapOf` and nowhere else. The console never re-derives a status from
  a run's state: it reads `WorkItemView.status`.
- **Wire.** `work` is optional on the answer, with no `FLEET_PROTO` bump. The console has one reader of it, and absence
  draws no card.
- **No second plan model.** Nothing reads plan files, checkboxes or ledger tables.
- **Tests run through `ccrc test -- <command>`**, cd'd into the package, for example
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/work-map.test.ts`.
- **Mutation floors.** `workMapOf` joins `MUTANT_SETS` (`server/test/sim/mutation-floors.test.ts`) and
  `server/test/sim/mutation-floors.json` in WM1, with the floor measured at merge.

## Review Focus

- A status decided anywhere but `workMapOf`: a second writer of the fact.
- Table 3's order: an open item must beat a stuck verdict, and stuck must beat working.
- The fallback must never print "N of M done".
- An absent `work` must draw no card, never an empty one.

## File Structure

| File | Task | Ring | Change |
|---|---|---|---|
| `shared/plan.ts` | WM0 | L0 | `ticket-required` in `PLAN_REFUSALS`; `PlanTicketDoneBody` |
| `shared/refusal.ts` | WM0 | L0 | `ticket-required`'s status |
| `server/src/coord/openRun.ts` | WM0 | L1 | `planGate` refuses `ticket-required` |
| `server/src/coord/planPolicy.ts` | WM0 | L1 | `ticketRequired(epic)`: the epic has an open declared ticket |
| `server/src/coord/planStore.ts` | WM0 | L3 | `markTicketDone`, the one new writer of a ticket's `done` besides the run's |
| `server/src/coord/planRoutes.ts` | WM0 | L4 | `POST /api/programmes/:slug/plan/tickets/done`, and its census rows |
| `ccd/ccrc-api` | WM0 | docs/bash | The `plan ticket-done` row |
| `pwa/src/lib/refusalWords.ts` | WM0 | L1 | `ticket-required`'s sentence |
| `server/test/plan-ticket-required.test.ts`, `server/test/plan-ticket-done.test.ts` | WM0 | test | New |
| `shared/plan.ts` | WM1 | L0 | `WORK_STATUSES`, `WORK_GROUPS`, `WorkItemView`, `WorkGroupView`, `WorkMapView`, beside `PlanView` |
| `server/src/coord/workMap.ts` | WM1 | L1 | New: `workMapOf` |
| `server/src/coord/planRoutes.ts` | WM1 | L4 | The `GET` answer gains `work` |
| `server/src/coord/store.ts` | WM1 | L3 | One read: every work run of one programme, with its ticket's key |
| `server/test/work-map.test.ts` | WM1 | test | New |
| `server/test/single-definition/plan.test.ts` | WM1 | test | Pins the two new lists |
| `server/test/sim/mutation-floors.test.ts`, `server/test/sim/mutation-floors.json` | WM1 | test | `workMapOf`'s set and floor |
| `pwa/src/ledgers/workMapWords.ts` | WM2 | L1 | New: status words, summary line, folds, source line |
| `pwa/src/ledgers/WorkCard.tsx` | WM2 | L4 | New: draws a `WorkMapView` it is given |
| `pwa/src/ledgers/ledgers.css` | WM2 | L4 | The card's rules |
| `pwa/test/work-card.test.tsx` | WM2 | test | New |
| `pwa/src/lib/api.ts` | WM3 | L3 | `plan(slug)` (claim 4522) |
| `pwa/src/ledgers/ProgrammeScreen.tsx` | WM3 | L4 | Mounts the card below Goals; Waiting on you to the right column (claim 4522) |
| `pwa/browser/programme-page.browser.test.ts` | WM3 | test | Widths and order |
| `ccd/coordinator-skill/references/plan.md` | WM4 | docs | Why a coordinator declares and keeps its plan |

*Table 2. Files by task.*

## Tasks

### Task WM0: a work run names its task, and a coordinator records a finished one

Spec §4.1, D10 and D11. Server and the client row only.

**Files:** Modify `shared/plan.ts`, `shared/refusal.ts`, `server/src/coord/openRun.ts`, `server/src/coord/planPolicy.ts`,
`server/src/coord/planStore.ts`, `server/src/coord/planRoutes.ts`, `server/src/auth/gate.ts` (the new route's EXEMPT row,
like its siblings), `ccd/ccrc-api`, `pwa/src/lib/refusalWords.ts`; Create `server/test/plan-ticket-required.test.ts`,
`server/test/plan-ticket-done.test.ts`; Test the box-token census and the ccrc-api row tests that pin the plan group.

**Interfaces:**
- `planGate`: a `work` run with no `ticket`, into an epic that has at least one `open` ticket whose key is not an auto
  key (`isAutoTicketKey`), is refused `ticket-required`. With no such ticket, it mints one as today. Review runs are
  untouched. The rule sits after `wave-epic-mismatch` in the gate's order.
- `POST /api/programmes/:slug/plan/tickets/done`, body `{ byId, byUuid, ticket, evidence: { pr: number } | { runId:
  number } }`. The owner check is the plan verbs' own. It refuses `unknown-ticket`, a ticket not `open` with
  `ticket-unavailable`, and a body without exactly one evidence key with `plan-bad-body`. It sets the ticket `done`,
  settles its epic (`settleEpicInTx`) and marks the plan's sync due, in one transaction. A ticket a run holds is
  refused `ticket-unavailable`: its run closes it.
- `ccrc-api plan ticket-done <slug> --json <f>`.

- [ ] **Step 1: Write the failing tests** — `a run with no ticket into an epic with an open declared ticket is refused
  ticket-required`, `an epic with only auto tickets open admits it`, `an epic with no tickets admits it`, `a review run
  is never refused`, `ticket-done marks an open declared ticket done with a pr`, `ticket-done settles the epic`,
  `ticket-done refuses a ticket a run holds`, `ticket-done refuses a caller that is not the coordinator`,
  `ticket-done refuses two evidence keys`; and the census rows for the new route.
- [ ] **Step 2: Run to fail** —
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/plan-ticket-required.test.ts test/plan-ticket-done.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then every `plan*` and `open-run*` server test, the box-token census and `single-definition`.
- [ ] **Step 5: Commit** — `feat(plan): a work run names its task, and a coordinator records a finished one`.

**Acceptance.** Each refusal has a case that reds when its check is deleted. **Rollback.** A plain revert. A ticket
marked done by the verb stays done, which is correct.

### Task WM1: the work map's vocabulary, its decider and the plan read's `work` field

**Files:** Modify `shared/plan.ts`, `server/src/coord/planRoutes.ts`, `server/src/coord/store.ts` (one read);
Create `server/src/coord/workMap.ts`, `server/test/work-map.test.ts`; Test `server/test/single-definition/plan.test.ts`,
`server/test/sim/mutation-floors.test.ts` and its JSON, the plan route's existing test.

**Interfaces:**

```ts
// shared/plan.ts, beside PlanView
export const WORK_STATUSES = ['dropped', 'done', 'waiting-on-you', 'stuck', 'blocked', 'working', 'in-review',
  'merging', 'queued', 'not-started', 'failed'] as const;   // 'failed': the fallback's alone
export type WorkStatus = (typeof WORK_STATUSES)[number];
export const WORK_GROUPS = ['done', 'in-progress', 'waiting', 'not-started', 'dropped', 'failed'] as const;
export type WorkGroup = (typeof WORK_GROUPS)[number];
export interface WorkItemView {
  key: string; title: string; status: WorkStatus; group: WorkGroup;
  runId: number | null; lastMoveAt: number | null; wave: number | null;
  itemIds: number[];               // open operator items that make it waiting-on-you
  lastFailedRunId: number | null;  // the run that last held a ticket now back at not-started
}
export interface WorkGroupView {
  key: string; title: string; summary: string | null; finishedAt: number | null; url: string | null;
  counts: Record<WorkGroup, number>; checkpoints: { met: number; total: number } | null;
  items: WorkItemView[];           // plan order
}
export interface WorkMapView {
  source: 'plan' | 'runs'; counts: Record<WorkGroup, number>;
  waves: { from: number; to: number } | null;   // the fallback's source line
  groups: WorkGroupView[];
}
// server/src/coord/workMap.ts (L1, pure)
export function workMapOf(input: {
  plan: PlanView; runs: readonly (RunSummary & { ticketKey: string | null })[]; openItems: readonly { id: number; runId: number | null }[];
  checkpointItems: ReadonlyMap<string, number>;  // checkpoint key -> its open operator-act item
}): WorkMapView;
```

The builder may rename fields. The shape (one status per item, counts per group, `source`) is the spec's.

- `source` is `plan` when `plan.planned` is true, else `runs`.
- On a planned programme, its work runs with no ticket (opened before the plan) form one group keyed `before-plan`,
  after the phases, built as the fallback's group is, and counted apart: never in the phases' totals (spec §5.1).
- The store read returns every work run of the programme with its ticket's key (`runs.ticketId` joined to
  `plan_tickets.key`). A failed run keeps its `ticketId` while its ticket's `runId` is cleared (`onRunAdvancedInTx`), so
  `lastFailedRunId` is the newest `failed` run naming a ticket that is back at `open`.
- For `runs`, there is one group, keyed `runs`, holding every work run of the programme newest first. Its items use
  Table 3's rows 3 to 9 off the run, `done` for a run that ended `done`, and `failed` (status and group, used by the
  fallback alone) for one that ended `failed`. A title that is null or equal to the programme's title reads as null,
  and the card draws "Wave N".
- The route reads the plan (as today), the programme's work runs, and its open items, then calls `workMapOf` and
  answers `{ ok: true, plan, work }`.

- [ ] **Step 1: Write the failing tests.** `work-map.test.ts`, one case per row of the spec's Table 3, plus:
  `an open item on the run beats a stuck verdict`, `stuck beats working`, `a dropped ticket is in no total`,
  `a failed run's ticket reads not-started with lastFailedRunId`, `a review run makes no row`,
  `checkpoints count met out of not dropped`, `a finished phase carries finishedAt`,
  `no plan: source runs, no total, failed runs counted apart`,
  `runs with no ticket on a planned programme form before-plan, outside the total`, `a title equal to the programme's reads null`.
  The route's test: `the plan read carries work beside plan`. `plan.test.ts`: both lists spelled once.
- [ ] **Step 2: Run to fail** —
  `cd server && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/work-map.test.ts`.
- [ ] **Step 3: Implement** the vocabulary, `workMapOf` and the route's field.
- [ ] **Step 4: Run to pass**, then the route's test, `single-definition/plan.test.ts` and
  `sim/mutation-floors.test.ts` with `workMapOf`'s new set.
- [ ] **Step 5: Commit** — `feat(plan): the programme's work map, decided once and served on the plan read`.

**Acceptance.** Every row of Table 3 has a case that goes red when the row is deleted (measured with
`mutation-run.py`). `typecheck-tests`, `single-definition` and `rings` pass.
**Rollback.** A plain revert: the field is additive and nothing reads it yet.

### Task WM2: the Work card and its words

**Files:** Create `pwa/src/ledgers/WorkCard.tsx`, `pwa/src/ledgers/workMapWords.ts`, `pwa/test/work-card.test.tsx`;
Modify `pwa/src/ledgers/ledgers.css`.

**Interfaces:**
- Consumes: `WorkMapView` (WM1).
- Produces: `WorkCard({ work, readAt, programme, runHref, itemHref }): ReactNode`. It takes the view as a prop and reads
  no store and no route, so it can merge before WM3. `workMapWords.ts` holds `statusWord(status)`,
  `summaryLine(view)` ("14 of 22 done", or "38 work runs done" for `runs`), `outstandingLine(view)`,
  `sourceLine(view, readAt, now)`, `foldLabel(n)` ("3 done") and the fallback note.
- Order and words follow the operator's rulings on Q2 and Q3. The spec's recommendation: phases in plan order, a
  finished phase folded to one line, outstanding tasks first in a phase and done tasks folded at its end; "phase" and
  "task" on the card.

| Width | Layout |
|---|---|
| 360, 390 | One column; a task row stacks status, line, facts |
| 1280, 1470, 1920 | Status, line and facts on one row; the facts never wrap under the line |

- [ ] **Step 1: Write the failing tests** — jsdom: `the summary reads N of M done`, `the fallback has no M and says what
  remains is not known`, `a finished phase is one line with its date`, `done tasks fold into one counted line`,
  `every status has a word` (over `WORK_STATUSES`), `a run link opens the run`, `an item link opens the item`,
  `a long task title wraps inside the card`.
- [ ] **Step 2: Run to fail** —
  `cd pwa && ~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/work-card.test.tsx`.
- [ ] **Step 3: Implement** the card and its words.
- [ ] **Step 4: Run to pass**, then pwa's `tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(console): the Work card draws a programme's work map`.

**Acceptance.** The jsdom tests pass, and `every status has a word` reds when a word is removed.
**Rollback.** A plain revert: nothing mounts the card yet.

### Task WM3: the programme page shows the Work card below Goals

**Needs claim 4522 released.** It edits `pwa/src/lib/api.ts` and `pwa/src/ledgers/ProgrammeScreen.tsx`.

**Files:** Modify `pwa/src/lib/api.ts` (`plan(slug)`), `pwa/src/ledgers/ProgrammeScreen.tsx`,
`pwa/src/ledgers/ledgers.css`; Test `pwa/test/programme-screen.test.tsx`, `pwa/browser/programme-page.browser.test.ts`.

**Interfaces:**
- `api.plan(slug)` answers `{ ok: true; plan: PlanView; work?: WorkMapView }` or a refusal.
- `ProgrammeScreen` reads the plan on arrival and again when the key moves: this programme's runs as
  `id:state:stuck`, and its items as `id:state`, from the frames already in the store. It keeps the time of the last
  read for the source line. It draws `WorkCard` in the left column under Goals, and moves the Waiting on you card to the
  top of the right column, above Runs. A failed read keeps the last view and says the read failed. An absent `work`
  draws no card.

| Width | Order |
|---|---|
| 360, 390 | Goals, Work, Waiting on you, Runs |
| 1280, 1470, 1920 | Left: Goals, Work. Right: Waiting on you, Runs |

- [ ] **Step 1: Write the failing tests** — jsdom: `the Work card sits below Goals`, `Waiting on you heads the right
  column`, `a run moving re-reads the plan`, `an answer with no work draws no card`, `a failed read keeps the last view`;
  browser: the table above in both skins and both themes, no sideways scroll, no clipped phase title.
- [ ] **Step 2: Run to fail**, jsdom then the browser file.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** — `feat(console): the programme page shows its work below Goals`.

**Acceptance.** On the live console, one programme with a stored plan and one without each match `plan show` and the
runs list. **Rollback.** A plain revert; the server field stays and is unread.

### Task WM4: coordinators keep their plan, so the Work card shows what remains

**Waits for Q1.** With Q1 answered yes, it also carries the back-fill of each live programme.

**Files:** Modify `ccd/coordinator-skill/references/plan.md`. The skill's `SKILL.md` clauses are pinned verbatim by
`server/test/coordinator-skill.test.ts`, so this task changes the reference file only.

- [ ] **Step 1:** Add a section to `references/plan.md`: the programme page's Work card is drawn from this plan. A plan
  that lists every task is how the operator sees what remains, so a coordinator adds a task to the plan (`plan put`) in
  the same act that adds it to its plan file, and names the task at `runs open` (`ticket-required`, with its recovery).
  `plan ticket-done` records a task finished before the plan, with its pull request.
- [ ] **Step 2:** With Q1 answered yes, each live programme's coordinator declares its plan at its next wave boundary,
  with `plan put` and its existing waves listed on their phases, then records each task already merged with
  `plan ticket-done` and its pull request. This is a coordinator's act, not a PR. Record each
  in that programme's own ledger note.
- [ ] **Step 3:** Run `server/test/coordinator-skill.test.ts` and the skill cap test.
- [ ] **Step 4: Commit** — `docs(coordinator): keep the plan, so the programme page shows what remains`.

**Acceptance.** The skill tests pass. **Rollback.** A plain revert.

## Carried to other plans

- **The Linear hierarchy plan's Task 5.2** (`docs/superpowers/plans/2026-11-10-linear-hierarchy.md`) is replaced by
  WM1 to WM3 (spec D8). Its coordinator records the replacement in that plan's own ledger, and keeps the done-when list
  (proved or not) for its console wave. This plan does not edit that file.

## Deviations found

Departures are named by slug and reported to the coordinator, who records them in the desktop-polish plan under
D-8669, Task C37's number:

- `hierarchy-5-2-replaced`: the Work card takes the place of the Linear hierarchy plan's Task 5.2 (spec D8).
- `waiting-card-moves-right`: on desktop, Waiting on you moves from under Goals to the top of the right column (spec D5).
- `ticket-required-and-done`: the plan model gains a refusal at `runs open` and a verb that records a finished task
  (spec §4.1, D10 and D11), found by the spec's builder check.

## Where things stand

- **Agreed:** the brief's rulings (2026-11-16) on placement, derived status and one owner.
- **Waiting on you:** Q1 (plans for live programmes), Q2 (order) and Q3 (words), in the spec's "Waiting on you".
- **Later:** a phase line linking to its epic page (hierarchy Task 5.3); a frame for plan edits.
