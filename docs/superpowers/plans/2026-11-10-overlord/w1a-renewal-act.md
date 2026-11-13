# Overlord W1a: the renewal act on the `SessionHost` port, and the lane's acts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** when the generations lane is armed `live`, it carries out what `generationStep` answers: it drains a session
(mail held, the turn finished), assembles the checkpoint and asks for the handover note, renews the session through the
`SessionHost` port (ccd's `hibernate --roll --fresh`), reads the receipt in two halves, nudges the fresh conversation to
read its card, runs the probes, and goes back, retries or degrades within each state's deadline. In `shadow` it
records what it would have done, as before.

**Why:** "Renewal is the server's act, in the same session" (C36), through one lane that acts through the `renew` act of
the `SessionHost` port (§3.3.1, §3.6 H2). W0 measured the fresh start's time (about 0.26 s to the ready prompt) and the
fleet's roll (about 7.4 s), so the deadlines stand; W0a measured that a reader in flight survives a `/clear` and reports
into the new conversation, so the drain's wait is load-bearing; the typed `/clear` path is unmeasured, so this piece
renews by fresh start only (H13's selection).

**Architecture:** an L2 port declared by its consumer (the lane) with a failure contract; one L3 adapter over the agent
link and ccd (`CcdArgv.hibernate(…, 'fresh')`, behind `hibernate-fresh`) and the existing prompt sender for the nudge;
the lane's acts in an L4 module beside the pass, executing `GenAction`s, each step a compare-and-set through the store.
The checkpoint is assembled by the lane (its writer) into a table of its own. One pull request; it is the piece that
gives the `continuity` row on the Shadow lanes card its meaning, and it stays `shadow` until the operator arms it.

**Tech Stack:** TypeScript (ESM), `node:sqlite`, vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` §3.3.2 (the checkpoint: notes, the thread, the handover
note; a coordinator's adds its last ten rulings verbatim), §3.3.8, §3.3.9 (C50), §3.3.11 (H12: the states and deadlines
of Table 3.3.11a, the receipt's two halves, `renew(session, n)` idempotent on n, `degraded`; H13: the act, today's
adapter, the typed `/clear` fast path for coordinators only where W0 measures it reliable), §3.6 (H2: `SessionHost`
with `renew`, `compact`, `deliver`, `contextUsage` and `receipt`; adapter one is ccd), Table 11.1c row `SessionHost`,
Table 11.1d (without `hibernate-fresh` the renewal lane does not run).

## What exists today

- `ccd hibernate --roll --fresh` and its word `hibernate-fresh`, and `CcdArgv.hibernate(id, dec, holdOk, mode)` (the
  fresh-start piece). Exit codes: 0; 3 `session-busy: <reason>` (refused, nothing touched); 4 `roll-wake-failed`; 5
  `roll-wake-unrestored`; 6 `roll-kill-failed`.
- `server/src/ccdargv.ts#ccdCan` / `capSupported` read the box's `ccd caps`.
- `server/src/inject/send.ts#sendPrompt` types a prompt into a session's pane (the console's prompt route uses it);
  `server/src/coord/rundefsTx.ts#queueSystemMail` queues system mail.
- The generations lane and store (the generations piece), `continuity_starts` (the start-report piece), the card read
  and the probes (the card and probes pieces), the handover door (the notes piece), the deciders (the renewal-deciders
  piece).
- The mail sweep's gates (`server/src/watch.ts#sweepMail`, `gated(d, word)`); a gated row stays `queued`.
- The roll lane (`server/src/rollLane.ts`) and hibernate lane (`server/src/coord/hibernate.ts`) still act on long-lived
  sessions as today; the renewal-handoffs piece hands them over.

## Global Constraints

- **Architecture (`CLAUDE.md`).** The port is declared by the lane in `server/src/continuity/sessionHost.ts` and states
  its failure contract; the adapter (`server/src/continuity/ccdSessionHost.ts`) keeps every distinction ccd's exit
  codes and the agent link give it, and never narrows one. Decide in L1, act in L4: the acts run what `generationStep`
  answered; the lane never chooses a transition itself. One writer: the lane writes generation rows and
  `continuity_checkpoints`. Consolidate: the nudge uses `sendPrompt`, the item uses the ledger's existing raise, the
  mail hold is one more gate word in the mail sweep's existing `gated`, never a second sweep. A guard ships with a test
  that goes red without it.
- **SAFETY (`CLAUDE.md`).** No new ccd verb: the act is `hibernate --roll --fresh`, built at the call site. The server
  places no session: ccd's spawn picks the account from the route, as today. Never `--force`, never a destructive verb.
  The fresh start is sent only where `ccdCan(…, 'hibernate-fresh')` answered yes; otherwise the lane records
  `capability-missing` and does not act.
- **Arming.** Every act checks the `continuity` row: `live` acts, anything else records. The test suite proves shadow
  sends nothing (no `CcdArgv`, no prompt, no mail, no item). In shadow every step writes `shadowState` (the
  generations piece's store), and `state` stays `active`, so the mail gate and the prompt route, which read `state`
  only, hold no mail and refuse no prompt (the coordinator's ruling on R1).
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`; the last run adds both
  `tsc` runs. **Growth check:** `server/src/watch.ts` (the gate word) and `server/src/coord/store.ts` grow at most 40
  net lines.
- **Time.** Deadlines are the row's `deadlineAt` (wall clock, failing towards the operator); the hold-off is observed
  time. No timer handle is kept: the lane is a `LANE_SCHEDULE` row (30 s).
- **Migration slot** re-measured before merge. Cite by symbol or `@anchor`. No private names. No D-number invented;
  departures go in `docs/superpowers/plans/2026-11-10-overlord/w1a-renewal-act/departures.md`.

## Review Focus

1. `renew(session, n)` is idempotent on n: a retry never starts a second fresh conversation once a start for that
   renewal is recorded (the receipt's second half is read before any retry).
2. A failure before the receipt's first half returns a proven generation to `active` with a hold-off, and an unproven
   one to `degraded` with one item (A2); a failure after it retries within the deadline, then degrades with one item.
3. Shadow sends nothing, by test, and holds nothing: `state` stays `active`, so no delivery is gated and no prompt is
   refused.
4. Deliveries are held from `draining` to `probing` and released after. A delivery delivered but not acked when
   draining began is replayed after `probing` by `dueDeliveries`' existing replay of unacked delivered rows; nothing
   is re-queued and no delivery row is written on entering `draining` (A3).
5. Within one pass, an event stamped before the deadline is fed before `deadline`, so a card read that arrived in time
   is never lost to a deadline seen on the same pass.

---

### Task 1: The port and its failure contract (L2)

**Files:**
- Create: `server/src/continuity/sessionHost.ts`
- Test: `server/test/continuity-session-host.test.ts` (new; the contract's shape, through a fake)

**Interfaces:**

```ts
/** The renewal lane's view of a session's host (§3.6 H2). Declared by its consumer; adapter one is ccd. */
export interface SessionHost {
  /** End the conversation and start a fresh one under the same session id, with the role's launch profile. */
  renew(sessionId: string, n: number): Promise<RenewResult>;
  /** Type the one line that starts the fresh conversation's first turn. */
  deliver(sessionId: string, text: string): Promise<DeliverResult>;
  contextUsage(sessionId: string): Promise<Reading<{ readonly tokens: number; readonly window: number }>>;
  /** The second half of the receipt: the newest reported start since a start id, if any. */
  receipt(sessionId: string, sinceStartId: number): Promise<ReceiptRead>;
}
export type RenewResult =
  | { readonly kind: 'started' }                                   // both halves pending the start report
  | { readonly kind: 'refused'; readonly reason: string }          // nothing touched: before the first half
  | { readonly kind: 'kill-failed' }                               // before the first half
  | { readonly kind: 'wake-failed' } | { readonly kind: 'wake-unrestored' }   // after the first half
  | { readonly kind: 'unreachable' }                               // no answer: the half is unknown
  | { readonly kind: 'capability-missing' };
export type DeliverResult = { readonly kind: 'sent' } | { readonly kind: 'refused'; readonly reason: string } | { readonly kind: 'unreachable' };
export type ReceiptRead = { readonly kind: 'started'; readonly startId: number; readonly uuid: string } | { readonly kind: 'none' } | { readonly kind: 'unreadable' };
```

`compact` (C39's act) stays ccd's auto-compact for now and is not declared, because no consumer asks for it in W1a; the
port grows it when one does. `unreachable` is its own answer: the lane treats an unknown half as "after the first
half" for retries (it reads the receipt before trying again), never as "before".

- [ ] **Step 1: Failing test:** a fake implementing the port type-checks; each `RenewResult` word appears in an
  exhaustive `switch` in the test with `never` in its default (a new word is a compile error).
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green.
- [ ] **Step 5: Commit.** `feat(continuity): the SessionHost port, declared by the renewal lane, with its failure contract`

### Task 2: The ccd adapter (L3)

**Files:**
- Create: `server/src/continuity/ccdSessionHost.ts`
- Test: `server/test/continuity-ccd-session-host.test.ts` (new; a fake `FleetIO`/agent link answering exit codes)

`renew` checks `ccdCan(…, 'hibernate-fresh')` (absent → `capability-missing`), then runs
`CcdArgv.hibernate(id, dec, null, 'fresh')` with the dec `{ actor: 'sweep:renew', reason: 'renewal n=<n>' }`, and maps
exit 0 → `started`, 3 → `refused` with ccd's reason line, 6 → `kill-failed`, 4 → `wake-failed`, 5 → `wake-unrestored`,
a link failure or timeout → `unreachable`, any other code → `unreachable` with the code logged. `deliver` calls
`sendPrompt` and maps its answers. `contextUsage` reads `readUsageMeasured` (stale → `unmeasured`). `receipt` reads
`continuity_starts` after the id.

- [ ] **Step 1: Failing tests:** each exit code maps to its word; no `hibernate-fresh` never runs ccd; the argv is the
  fresh builder's exactly; a stale sidecar is `unmeasured`.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** this suite and `test/ccdargv-dec-parity.test.ts`.
  Green.
- [ ] **Step 5: Mutation.** Map 4 to `kill-failed`: red. Revert.
- [ ] **Step 6: Commit.** `feat(continuity): the ccd adapter of SessionHost, over hibernate --roll --fresh`

### Task 3: The checkpoint (assembled by the lane)

**Files:**
- Modify: `server/src/coord/schema.ts` (migration: `continuity_checkpoints(generationId PRIMARY KEY, notes TEXT,
  rulings TEXT, handover TEXT, at INTEGER)`)
- Create: `server/src/continuity/checkpoint.ts` (L1 `assembleCheckpoint(facts)`: notes, the handover note, and for a
  coordinator its last ten rulings, verbatim, newest first; the Overlord's thread joins in W1)
- Modify: `server/src/continuity/continuityStore.ts` (`putCheckpoint`), `server/src/continuity/cardFacts.ts` (the
  card's `checkpoint` fact reads the checkpoint of the generation that ended last, at a renewal only)
- Test: `server/test/continuity-checkpoint.test.ts` (new)

A ruling is a mail to the coordinator from the operator's doors (system mail whose sender is the operator's, e.g. an
item's tick) or an item answer; measure the rows that carry them (`ledgersStore.ts`, the mail sender words) in Step 1
and name them in the departures note.

- [ ] **Step 1: Measure** the rulings' rows. **Step 2: Failing tests:** ten newest rulings, verbatim, inside
  `untrustedBlock` on the card; fewer than ten when fewer exist; a hard trigger's checkpoint has no handover note.
- [ ] **Step 3: Run.** Red. **Step 4: Implement.** **Step 5: Run.** Green. Register `assembleCheckpoint`'s floor (mutants: oldest first;
  keep eleven; keep the handover on a hard trigger; render a ruling outside `untrustedBlock`).
- [ ] **Step 6: Commit.** `feat(continuity): the checkpoint, assembled by the lane; a coordinator's last ten rulings`

### Task 4: The lane acts

**Files:**
- Create: `server/src/continuity/renewalActs.ts` (L4: `runActions(deps, gen, actions)`)
- Create: `server/src/continuity/renewalOrder.ts` (L1: `overlordFirst(overlordState: GenerationState | 'none' |
  'unmeasured'): boolean`, true when a coordinator's renewal may start: the Overlord's live generation is `active`, or
  no Overlord generation is live. This piece owns the ordering, for hard and soft renewals alike (ruling F11, slug
  `overlord-renews-first-hard-included`); `softRenewalMay`'s `overlordOutsideActive` input is fed from it)
- Modify: `server/src/continuity/generationsLane.ts` (for a live generation: if due and `softRenewalMay` (soft) or at
  once (hard), and only when `overlordFirst` answers true for a coordinator (a hard trigger waits too, recorded as
  `overlord-first`), feed `generationStep` the `due` event; each pass feed `drained` when the hibernate hold table and
  the turn marker say so, `handover` when the note arrived, `host-ended` / `host-failed` from `renew`'s answer,
  `started` from the receipt, `card-read` and `probes` from the card and probes pieces' rows, `midway` once in
  `carded` when half the span from `enteredAt` to `deadlineAt` has passed and `renudged` is 0 (ruling R3), and
  `deadline` when `deadlineAt` passed, last: every other event stamped before `deadlineAt` is fed first (m6). The
  machine's view comes from the row's columns (`state` live, `shadowState` in shadow, `attempts`, `proven`,
  `renudged`, `probeRounds`), and its next view is written back in one compare-and-set; run the actions when `live`,
  record them when not.
  **The gather for `softRenewalMay`** (ruling R4) reads only stored columns and measured readings:
  `generationAgeObservedMs` = `observed.ms - mintedObservedMs`; `dueSinceObservedMs` = `observed.ms -
  dueSinceObservedMs` (the column the generations piece's due write sets); `softRenewalsInWindow` = the identity's
  rows whose `softRenewalObservedMs` is within six observed hours of `observed.ms` (the accumulator carries across
  mints, so the window spans generations); `holdOffUntilObservedMs` from the row; the hold from `hibernateVerdict`;
  `readersRunning` and `placeHiddenObservedMs` `not-applicable` for a coordinator; `operatorQuietObservedMs`
  `unmeasured` (reason `operator-mark`) until the renewal hand-offs piece; `overlordOutsideActive` from
  `overlordFirst`; the mode from the Setting. Feeding a soft `due` writes `softRenewalObservedMs`)
- Modify: `server/src/watch.ts` (`sweepMail` gates a delivery to a session whose live generation is in `draining` to
  `probing` with the gate word `renewing`. Nothing is re-queued and no delivery row is written on entering `draining`:
  a delivery already `delivered` and unacked is replayed by `dueDeliveries`' existing replay of unacked delivered rows
  (`MAIL_REPLAY_MAX_ATTEMPTS`), which the gate holds while the word stands and lets through after `probing`. Step 1
  measures whether a gated replay spends an attempt; if it does, the gate refuses before the attempt is counted, and
  the departures note says which. The gate reads `state` only, never `shadowState`)
- Test: `server/test/continuity-renewal-acts.test.ts` (new), the mail sweep's gate suite

**Actions:** `hold-deliveries` (nothing to send: the gate reads the state); `assemble-checkpoint`; `ask-handover` (system
mail, subject `handover`, body "Your renewal is starting. Write your handover note now with `ccrc-api handover`.";
delivered through the gate's exception for this one subject); `renew` (the port; at most one call per `(n, try)`, and
before any retry the receipt is read: a recorded start ends the retry); `renudge-card` and the first prompt (the port's
`deliver`, one line: "Read your card with `ccrc-api card`, then answer your probes with `ccrc-api probe`."); `start-probes`
(the probes piece's `openRound`); `raise-item` (one item on the coordinator's programme, through the ledger's existing
server raise, title "Renewal of <session> degraded: <why>"); `set-hold-off`; `mint-next` and `end-this` (the pass's
mint, as today).

- [ ] **Step 1: Failing tests** (fake port, fake time, in-memory `coord.db`), each with the lane `live`:
  - a hard `hard-cap` on an idle coordinator: draining → (drained) clearing → `renew` once → a start reported → carded,
    the first prompt delivered → card read → probing → passed → active; deliveries gated `renewing` throughout and
    released after;
  - a hard `hard-cap` on a coordinator while the Overlord's generation is `draining`: no `due` is fed and the wait is
    recorded `overlord-first`; once the Overlord's generation is `active`, the next pass feeds `due`; the Overlord's
    generation `unmeasured`: the coordinator waits too;
  - a soft trigger on a coordinator with no hold and its break measured open (the gather's operator mark given as a
    measured age) waits for nothing more, then checkpointed: the handover asked, received, the checkpoint stored;
  - the lane's real gather before the renewal hand-offs piece lands: the coordinator's operator mark reads `unmeasured`
    (reason `operator-mark`), so the soft trigger waits `unmeasured` and no soft renewal starts; the hand-offs piece's
    Task 3 turns the same case into a start with the real mark;
  - a delivery `delivered` and unacked when `draining` begins is not delivered again while the gate holds, and is
    replayed once after `probing`;
  - `renew` refused (3): back to `active` with a hold-off for a proven generation (`degraded` for one never proven), no
    retry inside it;
  - `renew` unreachable then a start reported: no second `renew`;
  - wake-failed until the clearing deadline: `degraded`, one item;
  - no `hibernate-fresh`: nothing sent, `capability-missing` recorded;
  - the same scenarios with the lane `shadow`: no port call, no mail, no item; the records name each would-be act;
    `state` stays `active` throughout and `shadowState` walks; a delivery to that coordinator is delivered as today,
    never gated `renewing`;
  - a card read stamped before `deadlineAt` and first seen on the pass after it: `probing`, not `degraded` (m6);
  - the soft gather: a coordinator with two soft renewals in its previous generation inside six observed hours and
    one in this one answers `budget`; the same with the oldest seven observed hours back starts.
- [ ] **Step 1b: The deadline is set once** (ruling I2, moved here from the generations piece by ruling R3; fake time).
  A coordinator renewed at `t` reaches `carded`: at `t + 23 s` the pass feeds `midway`, the re-nudge is delivered,
  `renudged` is 1 and `deadlineAt` is unchanged; a later pass in `carded` feeds no second `midway`; it reads the card
  and fails its first round in `probing`: the second round opens, `probeRounds` is 2 and `deadlineAt` is unchanged; it
  passes: `active` and `proven`, and the time from `checkpointed` to `active` is at most `RENEWAL_BUDGET_S`.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** the new suite, the generations lane's suite, the mail
  gate suites, `test/mail-deliveries-writer.test.ts`, `test/mail-hardening.test.ts`. Green.
- [ ] **Step 5: Mutation.** Skip the receipt read before a retry: the unreachable case calls `renew` twice; red.
  Re-arm the deadline on the re-nudge: Step 1b goes red. Never feed `midway`: Step 1b's re-nudge goes red. Feed
  `deadline` first: the m6 case goes red. Gate on `shadowState` too: the shadow delivery case goes red. Revert each.
- [ ] **Step 6: Commit.** `feat(continuity): the generations lane renews through SessionHost when armed live`

### Task 5: The simulator runs the acts under faults

**Files:**
- Modify: `server/test/sim/generationDay.ts` (the fake port: `renew` fails, hangs, succeeds late; the agent link drops;
  the server crashes mid-renewal), `server/test/sim/generation-day.test.ts`

Invariants added: **G7** at most one fresh conversation per renewal (count the fake port's successful `renew`s per
`(identity, n)`); **G8** every renewal ends within `RENEWAL_BUDGET_S` from `checkpointed`, or in `degraded`, or back in
`active` with a hold-off (a proven generation only; an unproven one ends in `degraded`); **G9** deliveries to a renewing session are held and none is lost (each is delivered once
after `probing`).

- [ ] **Step 1:** Add the faults and G7 to G9. **Step 2: Run** with the CI seeds. Green.
- [ ] **Step 3: Mutation.** Skip the receipt read before a retry: G7 goes red within the CI seeds. Revert.
- [ ] **Step 4: Commit.** `test(sim): renewals under port failures, link drops and server crashes`

## Deviations found

None yet. Decisions this plan takes, by slug:

- **port-declares-what-w1a-consumes** — the port declares `renew`, `deliver`, `contextUsage` and `receipt`; `compact`
  joins when a consumer asks for it (H2 lists five).
- **overlord-renews-first-hard-included** — no coordinator renewal, hard ones included, starts while the Overlord's
  live generation is outside `active` (or unmeasured); this piece's `overlordFirst` owns the ordering, and the lane asks
  it before feeding `due` (the coordinator's ruling F11, from review 1894 of renewal deciders A).
- **receipt-never-waits-on-a-clear-start** — a `/clear` start's row lands at the next prompt's resend (run 1886's
  `clear-start-lands-on-next-prompt`), so its `receivedAt` is that resend's time. W1a renews by fresh start, whose uuid
  ccd writes before the spawn, so its start report lands at SessionStart and the receipt reads it; the typed `/clear`
  fast path, when it comes, must not wait on a `/clear` start's row as its receipt, or ccd's tick must resend right
  after it syncs the uuid (the coordinator's carry).
- **gate-reads-state-only** — the mail gate and the prompt route read `state`, which moves only while `continuity` is
  live; shadow's walk is `shadowState` (the coordinator's ruling on R1).
- **midway-fed-by-the-act-lane** — this piece's lane feeds `midway` once in `carded`, and Step 1b tests the set-once
  deadline walk, moved from the generations piece, which feeds no state event (ruling R3).
- **gather-in-the-act-lane** — this piece's lane gathers every `softRenewalMay` input from stored columns on the
  identity's carried accumulator (ruling R4).
- **events-before-the-deadline-first** — within a pass, events stamped before `deadlineAt` are fed before `deadline`
  (m6).
- **fresh-start-only** — W1a renews coordinators by fresh start too; the typed `/clear` fast path waits for a
  measurement of ccrc's own lane typing it (W0-07 found none).
- **first-prompt-by-deliver** — a fresh conversation has no first turn, so the lane delivers one line that sends it to its
  card and probes; for the Overlord (W1) this line is the door process's first call instead.
- **handover-asked-by-mail** — the handover is asked by one system mail that the renewing gate lets through.
- **checkpoint-table** — the checkpoint is a row of `continuity_checkpoints`, written by the lane.
- **degraded-item-on-the-programme** — a degraded coordinator raises one item on its programme.

## Where things stand

**Needs before it starts:** the fresh-start, generations, card, probes, notes and anchor pieces (every state the machine
passes through must exist before the lane may act).

**What depends on it:** the renewal-handoffs piece (Renew now, the prompt route's `renewing`, the roll and hibernate
hand-offs, the `precompact` field, the lost-task nudge); W1's Overlord renewal (the fence and the door process).

**Open questions for the operator, most important first:**

1. **Arm the `continuity` row?** Recommend after one week of shadow records on the fleet's coordinators, with the counts
   per trigger and the blind rows in the item, and after the replay baseline is taken (the replay-quiz piece's
   door refuses `live` before it). The item says what the counts can and cannot show: only coordinators started after
   the generations piece merged have rows (a coordinator running at merge has none until its next start); in shadow
   no first prompt is sent, so most `probing` rows time out to `degraded` (all of it in `shadowState`; `state` stays
   `active`), and those `degraded` counts measure the missing prompt, not the probes; and soft triggers stay waiting `unmeasured` until the renewal hand-offs piece
   brings the operator mark.
2. **Should a degraded coordinator stop acting?** The spec says it keeps acting and raises one item (C50); recommend
   as written.
