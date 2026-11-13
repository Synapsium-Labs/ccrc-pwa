# Overlord W1a: the renewal deciders, pure (`renewalDue`, the preconditions, the generation machine, observed time) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every decision the generation machine makes exists as a pure function with an exhaustive test, a
monotonicity property and a mutation floor, before any lane acts on it: when a renewal is due and of which class
(`renewalDue`), whether a soft one may start now (`softRenewalMay`), what each event does to a generation
(`generationStep`), and how much time the server observed (`observeTime`).

**Why:** the machine is the same code for every long-lived role (C49, §3.3.11), and §11.7 asks for an exhaustive test of
`renewalDue` over its whole input domain, a property test of each machine, and mutation testing of every new L1
decider, from W1a. Shipping the deciders first, with no I/O, lets the store, lane and port pieces be judged against
them, and lets the simulator run them on the fake ports.

**Architecture:** one L0 file of vocabulary and starting values (`shared/continuity.ts`); four L1 modules in
`server/src/continuity/`; one L1 accumulator in the clock kernel (`server/src/time/observed.ts`); one simulator scenario.
No table, no route, no lane. Two pull requests: **PR A** (Tasks 1 to 4: the vocabulary, observed time, `renewalDue`,
`softRenewalMay`) and **PR B** (Tasks 5 and 6: `generationStep` and the simulator scenario).

**Tech Stack:** TypeScript (ESM), vitest. **No new dependency:** the property tests use the seeded generator already in
the tree (`server/test/fakeTime.ts#mulberry32`, the one copy D-8225 kept), which is this plan's choice of
"property-test library" (§11.7: chosen with the first machine's wave, here).

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` §3.3.1, §3.3.4 (two compactions; a refused proactive
compaction), §3.3.8, §3.3.9 (C50: a coordinator's triggers, preconditions and ordering), §3.3.11 (H12, H13, Tables
3.3.11a and 3.3.11b, the soft budget, the preconditions, "How long a trigger waits"), §11.5 (observed time; two kinds of
timer), Table 11.5b, §11.7 (Table 11.7b; monotonic by construction).

## What exists today

- `shared/fleetRoles.ts#FleetRole`, `FLEET_ROLES[r].longLived` (`overlord`, `coordinator`). `server/src/roleOf.ts`.
- `server/src/time/ports.ts`: `Clock { wall(), mono() }`, `Scheduler { after(ms, fn): Cancel }`, `Entropy`,
  `TimePorts`; `server/test/fakeTime.ts` (the fake, `mulberry32`). No observed-time accumulator exists.
- `server/src/coord/hibernate.ts#hibernateVerdict` answers the hibernate lane's hold table (`HIBERNATE_HOLD_MAP`:
  `pane`, `unmeasured`, `live-word`, `menu`, `background`, `scheduled`, `recent`, `held`, …). It is the spec's
  precondition "the hibernate lane's own hold table"; this piece takes its answer as an input, never re-derives it.
- The simulator (`server/test/sim/`: `world.ts#SimWorld`, `run.ts#simulate`, `coordBlockedDay.ts`), the mutation runner
  and floors (`server/test/sim/mutate.ts`, `mutation-floors.json`, `mutation-floors.test.ts`), and the first model
  (`server/test/model/overlord/model.py`, whose `genmachine` scenario checks `CHECKPOINTED_TIMEOUT`,
  `FAILED_RENEWAL_RETURNS`, `START_WHILE_DOWN` and `CARD_DOOR_SKIPS`; run by `server/test/overlord-model.test.ts`).
- The context readings (`ctxTokens`, `ctxWindow`, `stale`) and `compactionsSince` come from the context-readings piece.
  This piece takes them as plain inputs and does not import that module.

## Global Constraints

- **Architecture (`CLAUDE.md`).** L0 `shared/continuity.ts` imports nothing but the kernel's types (`FleetRole`). Every
  module here is L1: pure, no `fs`, no clock, no timer, no `Math.random`; time arrives as numbers. One definition of
  each value: Table 11.5b's figures and Table 3.3.11a's deadlines are named constants in `shared/continuity.ts`, pinned
  by `server/test/single-definition/` (a new area file, or the time-ports one). The trigger rows are an L1 record keyed
  by role, total over `FLEET_ROLES` (C49), so a role with no row is a compile error. Consolidate: the hold table is
  `hibernateVerdict`'s; this piece adds no second idle test. Each guard ships with a test that goes red without it.
- **Monotonic by construction (§11.7).** Each first-match decider has an exhaustive test over its input domain and a
  property: an unmeasured, stale or missing input never raises the answer (never makes a renewal due, never turns
  "wait" into "start"); adding a fault never does either.
- **SAFETY (`CLAUDE.md`).** Nothing here acts. No ccd, no tmux, no registry.
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`; the last run adds both
  `tsc` runs through `ccrc test --`. The model: `ccrc test -- ./node_modules/.bin/vitest run test/overlord-model.test.ts`.
- **Mutation floors.** `renewalDue`, `softRenewalMay`, `generationStep` and `observeTime` each join `MUTANT_SETS` and
  `server/test/sim/mutation-floors.json` in the task that creates them; a floor only rises.
- **Time scan.** The modules sit in `server/src/continuity/` and `server/src/time/`, inside
  `TIME_PORT_FAMILIES`; the first piece to create `server/src/continuity/` adds `continuity/**` to C3's row of the
  ring-context table in `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`.
- **Simulator limits (carried).** A simulator predicate that reads sweep times assumes the simulator's beat; an async
  lane runs after the timers. Task 6's predicates read only generation rows and the fake clock, never sweep phases.
- Cite by symbol or `@anchor`. No private names. No D-number invented; departures go in
  `docs/superpowers/plans/2026-11-10-overlord/w1a-renewal-deciders/departures.md`.

## Review Focus

1. Hard rows are tested before soft rows, and a soft answer appears only when no hard row fired (Table 3.3.11b).
2. A stale or unmeasured reading never makes a renewal due; `renewalDue` names it as blind instead.
3. Observed time never advances across a gap (a new process, a mono reading that went backwards).
4. `generationStep` never answers `active` from `carded` or from `probing` without a read card and a passed round, and a
   failure before the receipt's first half returns to the state the renewal began from.

---

### Task 1: The vocabulary and the starting values (L0)

**Files:**
- Create: `shared/continuity.ts`
- Create: `server/test/continuity-vocabulary.test.ts`
- Modify: `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (C3's row: `continuity/**`, if absent)

**Interfaces (all exported, each list derived from one map, as `PR_REASONS` is):**

```ts
export type GenerationState = 'active' | 'draining' | 'checkpointed' | 'clearing' | 'carded' | 'probing' | 'degraded' | 'ended';
export type GenerationOutcome = 'renewed' | 'crashed' | 'swapped' | 'woken' | 'woken-elsewhere';
export type TriggerClass = 'hard' | 'soft';
export type RenewalTrigger =
  | 'hard-cap' | 'soft-ceiling' | 'turns' | 'two-compactions' | 'idle' | 'daily-backstop' | 'new-install'
  | 'probe-failed' | 'model-drift' | 'resumed-other-class' | 'entry-retired' | 'term-raised' | 'account-outside-set'
  | 'class-unservable' | 'account-load' | 'compaction-refused' | 'class-changed' | 'evaluation-due' | 'not-local'
  | 'resumed-long' | 'wave-boundary' | 'operator';            // 'operator' = Renew now
export const STATE_DEADLINE_S = { draining: 120, checkpointed: 60, clearing: 90, carded: 45, probing: 165 } as const;
export const RENEWAL_BUDGET_S = 360;                     // checkpointed -> active
export const HOLD_OFF_MS = 600_000;                      // observed
export const LEAST_AGE_MS = 1_800_000;                   // observed
export const SOFT_BUDGET = { count: 3, windowMs: 21_600_000 } as const;   // observed
export const BREAK_NO_MESSAGE_MS = 1_200_000; export const BREAK_PLACE_HIDDEN_MS = 300_000;
export const HARD_CAP_TOKENS = 250_000;                  // or half the window, whichever is lower
export const SOFT_CEILING_FRACTION = 0.6; export const TURNS_SOFT = 40; export const IDLE_SOFT_MS = 2_700_000;
export const ACCOUNT_LOAD_HARD = 0.85; export const EARLY_WHILE_AWAY_FRACTION = 0.5;
export const CHECKPOINT_THREAD = { messages: 60, tokens: 6_000 } as const;
export const NOTES_CAP = { count: 200, chars: 500 } as const;
export function isGenerationState(v: unknown): v is GenerationState;   // and one guard per exported union (D-8235's rule)
```

- [ ] **Step 1: Failing test.** Each list's members, in order; each guard accepts its members and refuses `''`,
  `'constructor'` and a near-miss; the figures equal Table 11.5b's (written out in the test, with the table row named
  in each case's title).
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** this suite, `test/rings/shared-imports.test.ts`,
  `test/rings/wire-totality.test.ts`, `test/rings/totality.test.ts`, both `tsc` runs, and pwa's `tsc` (pwa bundles
  `shared/`). Green.
- [ ] **Step 5: Commit.** `feat(continuity): the generation vocabulary and Table 11.5b's starting values (L0)`

### Task 2: Observed time (the clock kernel's one accumulator)

**Files:**
- Create: `server/src/time/observed.ts`
- Create: `server/test/time-observed.test.ts`

**Interfaces:**

```ts
/** Stored in a column of the row whose timer it bounds (§11.5). */
export interface Observed { readonly ms: number; readonly mono: number; readonly proc: string }
/** Advance by the monotonic delta when `proc` is this process and `mono` did not go back; otherwise re-anchor with
 *  no advance. Never reads a clock: the caller passes `clock.mono()` and its process id. */
export function observeTime(prev: Observed | null, mono: number, proc: string): Observed;
export function observedSince(start: Observed, now: Observed): number;   // ms observed between two stamps
```

- [ ] **Step 1: Failing tests.** Same process, forward: advances by the delta; a new `proc`: no advance, re-anchored;
  `mono` backwards: no advance; `null`: starts at 0. Property (seeded, 1,000 runs of random sequences with process
  changes): `ms` never decreases and never exceeds the sum of in-process forward deltas.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green. Register the floor.
- [ ] **Step 5: Mutation.** Advance across a process change: the property goes red. Revert.
- [ ] **Step 6: Commit.** `feat(time): observed time, one accumulator that never advances across a gap (§11.5)`

### Task 3: `renewalDue`, total over the roles

**Files:**
- Create: `server/src/continuity/renewalDue.ts`
- Create: `server/test/continuity-renewal-due.test.ts`

**Interfaces:**

```ts
export type Reading<T> = { readonly kind: 'measured'; readonly value: T } | { readonly kind: 'unmeasured'; readonly why: string };
export interface RenewalInputs {
  readonly role: FleetRole;
  readonly contextTokens: Reading<number>; readonly windowTokens: Reading<number>;
  readonly fittedCeilingTokens: Reading<number>;       // overlord; the hard cap until probes fit one
  readonly turns: Reading<number>;                     // overlord, W1's rows
  readonly compactions: Reading<number>;               // this generation's, compactionsSince
  readonly idleMs: Reading<number>;                    // the turn marker
  readonly backstopDue: Reading<boolean>;              // overlord, the daily backstop's hour
  readonly installBehind: Reading<boolean>;            // the roll's own "behind" test
  readonly probeFailedUnfixed: Reading<boolean>;
  readonly modelDrift: Reading<boolean>;               // overlord, W1's journal
  readonly startResumed: Reading<{ readonly resumed: boolean; readonly otherClass: boolean }>;
  readonly entryRetired: Reading<boolean>;             // overlord, W4
  readonly termRaised: Reading<boolean>;               // overlord, W1
  readonly accountOutsideSet: Reading<boolean>;        // overlord, W1 (pool-set)
  readonly classUnservable: Reading<boolean>;          // overlord, W1
  readonly accountLoadMove: Reading<boolean>;          // overlord, W1
  readonly compactionRefused: Reading<boolean>;        // the PreCompact arm (compaction piece)
  readonly classChanged: Reading<boolean>;             // overlord, W1
  readonly evaluationDue: Reading<boolean>;            // overlord, W3
  readonly notLocal: Reading<boolean>;
  readonly waveBoundary: Reading<boolean>;             // coordinator: N+1 open and N closed
  readonly renewNow: boolean;                          // the operator's door
}
export type RenewalDue =
  | { readonly due: false; readonly blind: readonly RenewalTrigger[] }
  | { readonly due: true; readonly cls: TriggerClass; readonly why: RenewalTrigger; readonly blind: readonly RenewalTrigger[] };
export const RENEWAL_ROWS: Readonly<Record<FleetRole, readonly RenewalTrigger[]>>;   // Table 3.3.11b, per role, hard rows first
export function renewalDue(i: RenewalInputs): RenewalDue;
export function hardCapTokens(windowTokens: number): number;  // min(HARD_CAP_TOKENS, windowTokens / 2)
```

`RENEWAL_ROWS`: `overlord` takes every row Table 3.3.11b names for it; `coordinator` takes `hard-cap`, `two-compactions`,
`new-install`, `probe-failed`, `compaction-refused`, `not-local`, `resumed-long`, `wave-boundary`; the five roles that
are not long-lived take `[]` (no renewal; their wave is their renewal). `operator` is first for both long-lived roles.
A row whose input is `unmeasured` does not fire and is listed in `blind`. The thresholds (the hard cap, the soft
ceiling at 60% of the fitted ceiling, a quarter of the hard cap for the idle floor and the wave boundary, half of it
for a resumed long conversation) are the L0 constants of Task 1.

- [ ] **Step 1: Failing tests.**
  - **Exhaustive** over each role × each row's input in {unmeasured, measured below its threshold, measured at it,
    above it} (booleans: unmeasured, false, true), one row varied at a time against a base where nothing fires, then
    every pair of rows: the answer names the first firing row in `RENEWAL_ROWS[role]` order, `hard` before `soft`.
  - **Totality:** `Object.keys(RENEWAL_ROWS)` equals `FLEET_ROLE_NAMES`, and only long-lived roles have rows.
  - **Monotonicity** (seeded, 10,000 random inputs per role): replacing any measured input with `unmeasured` never
    turns `due: false` into `due: true` and never turns `hard` into a row of a lower position.
  - **Worked cases** from the spec: a 1M window at 260k tokens is `hard-cap`; a 200k window at 100k is `hard-cap`; a
    coordinator at a wave boundary with 70k tokens on a 1M window is `wave-boundary` (above a quarter of 250k); a stale
    context reading is `due: false` with `hard-cap` blind.
- [ ] **Step 2: Run.** Red. **Step 3: Implement** as a first-match walk over `RENEWAL_ROWS[role]`, one predicate per
  trigger in a `Record<RenewalTrigger, (i) => boolean | 'blind'>`, so a new trigger without a predicate is a compile
  error. **Step 4: Run.** Green. Register the floor (mutants: swap two rows; `>=` to `>` on the hard cap; treat
  unmeasured as below; drop `operator`).
- [ ] **Step 5: Commit.** `feat(continuity): renewalDue, total over FLEET_ROLES, hard rows first, unmeasured never fires`

### Task 4: `softRenewalMay`, the preconditions a soft trigger waits for

**Files:**
- Create: `server/src/continuity/softRenewal.ts`
- Create: `server/test/continuity-soft-renewal.test.ts`

**Interfaces:**

```ts
export interface SoftInputs {
  readonly role: FleetRole;
  readonly hibernateHold: { readonly held: false } | { readonly held: true; readonly reason: string };  // hibernateVerdict's answer
  readonly readersRunning: Reading<number>;            // the hook's reader start and stop reports
  readonly lastOperatorActivityMs: Reading<number>;    // overlord: its last operator message (W1); coordinator: the
                                                       // operator-at-programme mark's age
  readonly placeHiddenForMs: Reading<number>;          // overlord, W1's console report
  readonly mode: 'when-away' | 'on-schedule';          // the Setting (R19); default when-away
  readonly dueSinceObservedMs: number;                 // how long the soft trigger has waited
  readonly generationAgeObservedMs: number;            // least age
  readonly holdOffUntilObservedMs: number | null;
  readonly softRenewalsInWindow: number;               // the budget's count over observed time
  readonly overlordOutsideActive: boolean;             // a coordinator waits while the Overlord renews (C50)
}
export type SoftAnswer = { readonly start: true } | { readonly start: false; readonly waitFor: SoftWait };
export type SoftWait = 'least-age' | 'hold-off' | 'budget' | 'hold' | 'readers' | 'unmeasured' | 'no-break' | 'overlord-first';
export function softRenewalMay(i: SoftInputs): SoftAnswer;
/** At a break, a generation past half of a soft row's threshold renews early (R19). */
export function earlyWhileAway(role: FleetRole, i: RenewalInputs): boolean;
```

Order of the waits: `least-age`, `hold-off`, `budget`, `overlord-first`, `hold`, `readers`, then the break. A break is
`lastOperatorActivity >= BREAK_NO_MESSAGE_MS` or `placeHidden >= BREAK_PLACE_HIDDEN_MS` (quiet hours join in W3, with
their Setting). In `on-schedule` mode, a trigger that has waited 30 minutes skips the break test only. Any `unmeasured`
input answers `unmeasured`, never `start`.

- [ ] **Step 1: Failing tests:** exhaustive over each wait's input at {unmeasured, blocking, clear} one at a time and in
  pairs (the first wait in order is named); `on-schedule` after 30 minutes skips the break but not the hold; the
  monotonicity property (unmeasured never turns a wait into a start). `earlyWhileAway`: at half the soft ceiling and
  half the turns, yes; below, no; an unmeasured reading, no.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green. Register both floors.
- [ ] **Step 5: Commit.** `feat(continuity): softRenewalMay, the preconditions and the budget a soft renewal waits for (R19)`

**PR A ends here.**

### Task 5: `generationStep`, the machine

**Files:**
- Create: `server/src/continuity/generationMachine.ts`
- Create: `server/test/continuity-generation-machine.test.ts`

**Interfaces:**

```ts
export type GenEvent =
  | { readonly kind: 'due'; readonly cls: TriggerClass }       // from active or degraded (degraded: hard or operator only)
  | { readonly kind: 'drained' }                                // no reader running, deliveries held
  | { readonly kind: 'handover' }                               // the note arrived
  | { readonly kind: 'host-ended' }                             // receipt, first half
  | { readonly kind: 'host-failed'; readonly afterEnd: boolean }
  | { readonly kind: 'started'; readonly resumed: boolean }     // a SessionStart that is not a compaction
  | { readonly kind: 'card-read'; readonly hashMatches: boolean }
  | { readonly kind: 'probes'; readonly passed: boolean }
  | { readonly kind: 'deadline' }                               // the state's stored deadline passed
  | { readonly kind: 'renew-now' };
export interface GenView { readonly state: GenerationState; readonly from: 'active' | 'degraded'; readonly tries: number;
                           readonly cls: TriggerClass | null; readonly renudged: boolean; readonly probeRounds: number }
export type GenAction = 'hold-deliveries' | 'release-deliveries' | 'assemble-checkpoint' | 'ask-handover' | 'renew'
  | 'renudge-card' | 'start-probes' | 'raise-item' | 'set-hold-off' | 'mint-next' | 'end-this';
export function generationStep(g: GenView, e: GenEvent): { readonly next: GenView; readonly actions: readonly GenAction[] };
```

Table 3.3.11a's rules, as the machine: `due` → `draining` (hard skips nothing here; it skips `checkpointed` later);
`drained` → `checkpointed`, or `clearing` on a hard trigger; `handover` or `deadline` in `checkpointed` → `clearing`;
`deadline` in `draining` → back to `from` (`active` with `set-hold-off`, or `degraded`); `host-failed` before the first
half → back to `from`; after it, retry while the deadline stands, then `degraded` with `raise-item`; `started` on any
generation → this one `ended` (`end-this`) and the next minted at `carded` (`mint-next`); `card-read` with a match →
`probing` (`start-probes`); `deadline` in `carded` → one `renudge-card`, then `degraded`; `probes` passed → `active`;
failed once → re-read and probe again; twice → `degraded` with `raise-item`; `renew-now` in `degraded` or `active` →
`draining`. Any event a state does not name is ignored (the same view, no action).

- [ ] **Step 1: Failing tests.** Exhaustive over every state × every event × `from` × `cls` × the counters' edge values,
  against a table written out in the test (the spec's words cited in each row's title). Properties (seeded, 10,000
  random event sequences from `active`): never `active` from `carded` or `probing` without a matching `card-read` and a
  passed round; a sequence with no `started` mints nothing; at most one `renew` per generation per try; `ended` is
  terminal.
- [ ] **Step 2: Run.** Red. **Step 3: Implement** as a `Record<GenerationState, (g, e) => step>`, so a new state
  without a handler is a compile error. **Step 4: Run.** Green. Register the floor.
- [ ] **Step 5: The model agrees.** Read `server/test/model/overlord/model.py`'s generation transitions (the
  `genmachine` scenario's checks named above). Write a test that drives `generationStep` through each of those four
  checks' scenarios as event sequences and asserts the model's expected state (`CHECKPOINTED_TIMEOUT` → `clearing`
  without the note, `FAILED_RENEWAL_RETURNS` → `active`, `START_WHILE_DOWN`, `CARD_DOOR_SKIPS`). Where the model's
  anchor sentence no longer matches the spec (the results note's Proposal 9), record it in the departures note.
- [ ] **Step 6: Commit.** `feat(continuity): generationStep, Table 3.3.11a as a pure machine, checked against the model`

### Task 6: A simulator scenario over the deciders

**Files:**
- Create: `server/test/sim/generationDay.ts` (a `Scenario` on `SimWorld`: a coordinator and an overlord identity, a day
  of context growth, compactions, idle stretches, crash and gap injection, driven only through the four deciders and an
  in-memory generation row)
- Create: `server/test/sim/generation-day.test.ts`

Invariants (predicates over the in-memory rows and the fake clock): **G1** no generation is `active` without a read
card hash and a passed round; **G2** at most three soft renewals in any six hours of observed time; **G3** no soft
renewal ends a generation younger than 30 observed minutes; **G4** a server gap neither advances observed time nor
fires a deadline twice; **G5** every start mints exactly one generation. Seeds: 200 in CI, `CCRC_SIM=full` for 5,000.

- [ ] **Step 1: Failing test:** the scenario file absent; red. **Step 2: Implement.** **Step 3: Run** with the default
  seeds. Expected: green, with each invariant's coverage counter above zero (reach coverage, as `coordBlockedDay` does).
- [ ] **Step 4: Mutation.** Break G2 by letting `softRenewalMay` ignore the budget: the scenario goes red within the CI
  seeds. Revert.
- [ ] **Step 5: Commit.** `test(sim): a generation day, the renewal deciders under crash and gap injection`

**PR B ends here.**

## Deviations found

None yet. Decisions this plan takes, by slug:

- **property-tests-in-tree** — the property tests use the tree's seeded `mulberry32`, not a property-test library;
  §11.7 asks the renewal piece to choose, and the tree's earlier choices (the in-tree mutation runner, the Python model
  with no dependency) point the same way.
- **unmeasured-row-is-blind** — a trigger row whose input is unmeasured does not fire and is reported in `blind`, which
  is what "a stale sample is unmeasured, never below" and §11.7's monotonicity require together.
- **renew-now-is-a-trigger** — the operator's Renew now is the first row for both long-lived roles, class `hard`.
- **outcome-woken** — `GenerationOutcome` adds `woken` beside the spec's "woken elsewhere", for a wake on the same host.
- **break-without-quiet-hours** — until W3's quiet-hours Setting exists, a break is the message test or the hidden
  place.

## Where things stand

**Needs before it starts:** nothing beyond `main`. It does not import the context-readings piece; it takes its values.

**What depends on it:** the generations piece (the store and the lane in shadow), the renewal-act piece (the lane's
acts), the probes piece (`probe-failed`, the fitted ceiling), the compaction piece (`compaction-refused`). W1 fills the
Overlord's inputs that read `unmeasured` here (turns, model drift, term, the account set, the class).

**Open questions for the operator:** none. The thresholds are the spec's starting values, which the shadow period
moves.
