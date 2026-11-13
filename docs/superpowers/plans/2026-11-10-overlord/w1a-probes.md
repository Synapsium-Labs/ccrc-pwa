# Overlord W1a: probes that measure memory, from the session's own rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** after every start and every compaction, and while idle as the context grows, the server asks a long-lived
session three to five closed-form questions drawn from its own rows, grades each against the snapshot its generation
was carded with (or, at depth, against the rows of this generation), records whether the session read anything in
between, and moves the generation from `probing` to `active`, or towards `degraded`.

**Why:** canaries prove the card was fetched, not that it was heeded; probes measure memory (C41). The research the spec
cites puts multi-turn loss and contradiction among the weakest skills, so the server measures from outside rather than
taking the session's word. For coordinators, the probes are drawn from their own rows: which wave is open, which run,
which claims, the last ruling on a named question, and one with no answer on record (C52). The probe classes' results
also feed `renewalDue`'s `probe-failed` row and, for the Overlord, the fitted ceiling.

**Architecture:** L1 composes a round (`probeRound`, taking `Entropy`) and grades an answer (`gradeProbe`); a derived L1
read fits the ceiling from probe rows (`fittedCeiling`), with no table of its own. The probe door (L4) serves a round
and takes answers; one table records rounds and answers; the generations lane reads verdicts as events. Two pull
requests: **PR A** (Tasks 1 to 3, pure) and **PR B** (Tasks 4 to 6: the table, the door, the client, the lane, spot
probes).

**Tech Stack:** TypeScript (ESM), `node:sqlite`, Fastify, bash (`ccd/ccrc-api`), vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` §3.3.5 (C41: rounds of three to five across the
classes of Table 3.3.5a; the thread probe; closed-form against the snapshot the generation row names; closed-book; at
depth every 50k tokens while idle, graded against the rows of the generation; the fitted ceiling at 95%, the plan fixes
the rolling window as a count; never typed; a fail re-reads, a second fail in `probing` degrades, a mid-generation fail
a re-read does not fix makes a renewal due), §3.3.9 (C52: a coordinator's probes, through `ccrc-api probe`), Table
11.1a row "Probe rows, the fitted ceiling", Table 11.1b (`probeSet` column), §11.2 (the hook's group for every role but
the designated one).

## What exists today

- No probes exist. `shared/fleetRoles.ts#FLEET_ROLES` has `probeSet: null` on every row (D-8209).
- The card piece stores the snapshot (`continuity_snapshots`, the facts as JSON) and the generations piece records
  `snapshotId` on the generation row when the card is read, moving `carded` to `probing`.
- `generationStep`'s `probes` event (`passed: boolean`) and its two-round rule; `renewalDue`'s `probe-failed` row
  (the renewal-deciders piece).
- The notes piece's `liveNotes` (a `continuation` probe's expected answer is a note's `next`).
- `Entropy` (`server/src/time/ports.ts`), the one source of chance for new continuity code.
- The usage sidecar's `ctxTokens` (the context-readings piece) and the turn marker's idle state.

## Global Constraints

- **Architecture (`CLAUDE.md`).** Composition and grading are L1 (no store, no clock, chance from `Entropy`); the door is
  L4 and decides nothing; the generations lane stays the only writer of generation rows and reads probe verdicts as
  events. One writer: the probe door writes `continuity_probes`. The fitted ceiling is derived on read from probe rows
  (one rule for derived text and values, §3.3.6), never stored. A guard ships with a test that goes red without it.
- **Closed-form only.** An expected answer is an id, a choice from a list, or `none`; free text is never graded (C41).
- **Never typed.** A round reaches a session as the probe door's output. A spot probe to an active coordinator is
  announced by system mail through the existing mail lane, whose body names `ccrc-api probe`; the questions themselves
  arrive only from the door.
- **SAFETY (`CLAUDE.md`).** No ccd verb. A session reads and answers only its own probes.
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`; the last run adds both
  `tsc` runs. **Growth check:** `server/src/coord/store.ts` and `server/src/watch.ts` grow at most 40 net lines.
- **Mutation floors.** `probeRound`, `gradeProbe` and `fittedCeiling` join `MUTANT_SETS` and the floors.
- **New door census** in the same pull request (`server/src/auth/gate.ts`, `server/test/auth-gate.test.ts`,
  `server/test/box-token-census.test.ts`, `server/test/rings/fastify-l4.data.ts`, `server/test/secret-mask.test.ts`
  for the GET, the README's auth paragraph, `CLAUDE.md`'s box-token paragraph). New refusal words through a typed const
  in `shared/refusal.ts`.
- **Migration slot** re-measured before merge. Cite by symbol or `@anchor`. No private names: fixtures `prog-a`,
  `lane-a-project-a`. No D-number invented; departures go in `docs/superpowers/plans/2026-11-10-overlord/w1a-probes/departures.md`.

## Review Focus

1. A probe is graded against the snapshot the generation row names, so a row that moved after the card was read is not
   a failure.
2. An abstention probe's right answer is `none`, and a confident wrong id fails it.
3. Closed-book is recorded honestly: a read of the session's card or notes between ask and answer marks the answer
   open-book; reads the server cannot attribute make it `unmeasured`, never closed.
4. The fitted ceiling never exceeds the hard cap, and is the hard cap until enough spot probes exist.

---

### Task 1: The probe set and a round (L1)

**Files:**
- Modify: `shared/fleetRoles.ts` (`probeSet` column: `readonly ProbeClass[]`; `coordinator`: `fact`, `temporal`,
  `abstention`, `continuation`; `overlord`: every class of Table 3.3.5a (its rows exist from W1); the five roles that are
  not long-lived: `[]`)
- Modify: `shared/continuity.ts` (`ProbeClass`, `PROBE_CLASSES`, `PROBE_ROUND_MIN = 3`, `PROBE_ROUND_MAX = 5`,
  `SPOT_PROBE_EVERY_TOKENS = 50_000`, `FIT_PASS_RATE = 0.95`, `FIT_WINDOW = 20`)
- Create: `server/src/continuity/probes.ts` (`probeRound`)
- Assumes: card PR A's commit that lays `FLEET_ROLES` out one column per line and splits
  `server/test/fleet-roles.test.ts`'s null-columns case one column per line, and its C3 row `continuity/**`; this
  piece edits only its own column's lines in both files
- Test: `server/test/continuity-probes.test.ts` (new), `server/test/fleet-roles.test.ts`

**Interfaces:**

```ts
export interface ProbeQuestion { readonly id: string; readonly cls: ProbeClass; readonly text: string;
                                 readonly choices: readonly string[] | null; readonly expected: string }   // expected never leaves the server
export function probeRound(role: FleetRole, snapshot: CardFacts, notes: readonly CardNote[], entropy: Entropy,
                           kind: 'start' | 'compaction' | 'spot'): readonly ProbeQuestion[];
```

The coordinator's questions: **fact** — "Which run of yours is open for programme `prog-a`?" (choices: the run ids in
the snapshot plus two that are not; expected the open one); "Which of these paths do you hold a claim on?";
**temporal** — "Which of your runs moved last?"; **abstention** — "What did the operator rule on item `<an id that has
no ruling>`?" (expected `none`); **continuation** — "What does your note on `<key>` say comes next?" (choices: the
note's `next` and two others from other notes; skipped when there are fewer than three notes). A round draws one
question per class the role has and the snapshot can support, then tops up from `fact` to at least three; a snapshot
too thin for three answers fewer, and says so.

- [ ] **Step 1: Failing tests:** for a fixed seed, a coordinator snapshot yields a round of three to five, each
  question's `expected` in its `choices` (or `none`); an abstention question names an id with no ruling in the
  snapshot; a snapshot with no runs yields the abstention question and says the round is short; the same seed yields
  the same round. `probeSet` is total and empty for roles that are not long-lived.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** this suite, `test/fleet-roles.test.ts` (the last
  null assertion goes), both `tsc` runs and pwa's `tsc`. Green. Register the floor (mutants: skip the top-up to three;
  let `expected` fall outside `choices`; draw from a class the role lacks; ignore the seed).
- [ ] **Step 5: Commit.** `feat(continuity): a coordinator's probe round, drawn from its own rows (C41, C52)`

### Task 2: Grading (L1)

**Files:**
- Modify: `server/src/continuity/probes.ts` (`gradeProbe`, `roundVerdict`)
- Test: `server/test/continuity-probes.test.ts`

**Interfaces:**

```ts
export type ProbeGrade = 'pass' | 'fail';
export type BookState = 'closed' | 'open' | 'unmeasured';
export function gradeProbe(q: ProbeQuestion, answer: string): ProbeGrade;        // exact match after trim and case-fold of ids
export function roundVerdict(grades: readonly ProbeGrade[]): 'passed' | 'failed'; // all pass
```

- [ ] **Step 1: Failing tests:** exact id passes; a near id fails; `none` passes only an abstention question; an answer
  outside `choices` fails; a round with one fail fails. Monotonicity: changing a pass to a fail never makes a round pass.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green. Register the floor (mutants: drop the
  case-fold; pass `none` on any question; pass a round on most passes).
- [ ] **Step 5: Commit.** `feat(continuity): grade a probe closed-form, and a round all-or-nothing`

### Task 3: The fitted ceiling (L1, derived on read)

**Files:**
- Modify: `server/src/continuity/probes.ts` (`fittedCeiling`)
- Test: `server/test/continuity-probes.test.ts`

`fittedCeiling(spots: readonly { depthTokens: number; grade: ProbeGrade; closed: boolean; modelClass: string }[],
modelClass: string, hardCap: number): { tokens: number; fitted: boolean }` — bucket closed-book spot probes of this
model class by depth (`SPOT_PROBE_EVERY_TOKENS`); a bucket is good when its last `FIT_WINDOW` probes pass at
`FIT_PASS_RATE` or better; the ceiling is the deepest good bucket below which every bucket is good, never above
`hardCap`; with any bucket short of `FIT_WINDOW` probes up to that depth, it is `{ tokens: hardCap, fitted: false }`.

- [ ] **Step 1: Failing tests:** no probes: the hard cap, not fitted; 20 passes at 50k and 100k, 18 of 20 at 150k:
  100k, fitted; a model class with no probes: the hard cap even when another class is fitted; open-book probes do not
  count. Monotonicity: adding a fail never raises the ceiling.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green. Register the floor (mutants: `>=` to `>` on
  the pass rate; count open-book probes; ignore the model class; let the ceiling exceed the hard cap).
- [ ] **Step 5: Commit.** `feat(continuity): the fitted ceiling, derived from closed-book spot probes (C41)`

**PR A ends here.**

### Task 4: The table and the probe door

**Files:**
- Modify: `server/src/coord/schema.ts` (migration: `continuity_probes`)
- Modify: `server/src/continuity/continuityStore.ts` (`openRound`, `answerRound`, `probeRows`)
- Modify: `server/src/continuity/routes.ts` (`GET /api/sessions/:id/probe`, `POST /api/sessions/:id/probe`; the card and
  notes GETs stamp the caller's last read time for closed-book)
- Modify: the census files; `server/test/single-definition/writers-map.test.ts`; `shared/refusal.ts`
  (`PROBE_REFUSALS`: `probe-none-open`, `probe-closed`; spec Table 11.6 lists both, this programme's spec amendment,
  m5)
- Test: `server/test/continuity-probe-route.test.ts` (new)

**Schema:**

```sql
CREATE TABLE continuity_probes (
  id INTEGER PRIMARY KEY, roundId TEXT NOT NULL, sessionId TEXT NOT NULL, generationId INTEGER NOT NULL,
  kind TEXT NOT NULL,                    -- start | compaction | spot
  cls TEXT NOT NULL, question TEXT NOT NULL, choices TEXT, expected TEXT NOT NULL,
  snapshotId TEXT, depthTokens INTEGER, modelClass TEXT,
  askedAt INTEGER NOT NULL, answeredAt INTEGER, answer TEXT, grade TEXT, book TEXT,
  UNIQUE (roundId, cls, question)
);
```

**Doors:** `GET` answers the session's open round's questions (never `expected`), or `probe-none-open`; `POST` takes
`{ roundId, answers: { id, answer }[] }`, grades each, sets `book` (`open` if the session's card or notes were read
after `askedAt`, else `unmeasured`, because reads through other doors carry no attribution in W1a), and answers the
grades. A second answer to an answered round is `probe-closed`.

- [ ] **Step 1: Failing tests:** a round opened for a `probing` generation is served without `expected`; answers are
  graded and stored; a card read between ask and answer marks `open`; none marks `unmeasured`; a second answer is
  refused; another session's round is invisible.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** the new suite, the census suites,
  `test/coord-db.test.ts`, both `tsc` runs. Green.
- [ ] **Step 5: Commit.** `feat(continuity): the probe door, rounds and graded answers`

### Task 5: The lane asks and reads probes

**Files:**
- Modify: `server/src/continuity/generationsLane.ts` (a generation entering `probing` gets a round from `probeRound`
  over its snapshot, through `openRound`; a graded round becomes `generationStep`'s `probes` event; a first failed
  round opens a second round after the card is read again; a compaction counted since the last round opens a
  `compaction` round on an `active` generation; a failed mid-generation round that a re-read does not fix sets the
  `probeFailedUnfixed` input of `renewalDue`)
- Modify: `ccd/ccrc-api` (`probe`: prints the open round; `probe answer --json -`)
- Test: `server/test/continuity-generations-lane.test.ts`, `server/test/ccrc-api-probe.test.ts` (new)

- [ ] **Step 1: Failing tests:** `probing` + a passed round → `active`; one fail → a second round; two fails →
  `degraded` (recorded; no item is raised while the lane is `shadow`); a compaction opens a round on `active`; a failed
  mid-generation round with no fix sets `probe-failed` due (soft).
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green.
- [ ] **Step 5: Commit.** `feat(continuity): the generations lane probes after a card read and after a compaction`

### Task 6: Spot probes at depth

**Files:**
- Modify: `server/src/continuity/generationsLane.ts` (for an `active` generation whose session is idle (the turn
  marker) and whose `ctxTokens` crossed another `SPOT_PROBE_EVERY_TOKENS` since its last spot probe, open a `spot`
  round of one question about this generation's rows (a mail it received or a note it wrote since `enteredAt`), and
  queue one system mail to the session, subject `probe`, body "A spot probe is open: run `ccrc-api probe`."; record
  `depthTokens` and `modelClass`)
- Test: `server/test/continuity-generations-lane.test.ts`

- [ ] **Step 1: Failing tests:** crossing 50k while idle opens one spot round and one mail; crossing again before an
  answer opens nothing more; a busy session gets none; a stale sidecar gets none (unmeasured, never a guess); the spot
  question is about a row written in this generation, not on the snapshot.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** The mail goes through the existing system-mail writer
  (`queueSystemMail`, `rundefsTx.ts`; measure its signature), never a second writer. **Step 4: Run.** Green.
- [ ] **Step 5: Commit.** `feat(continuity): spot probes at depth, announced by mail, answered at the door`

**PR B ends here.**

### Task 7 (waits on the operator's item; can be dropped): a coordinator's thread probe

The spec gives a coordinator no thread probe in W1a (Table 3.3.5a's thread probe is the Overlord's), yet R19's "never
repeat" arguably covers what the operator types into a coordinator. The operator rules between two answers; this task
is written for the second and is dropped, with the slug `no-coordinator-thread-probe` recorded, if the operator rules
the first.

- **W1a has none.** Drop this task. The coordinator's set stays `fact`, `temporal`, `abstention`, `continuation`.
- **The newest ruling in the checkpoint.** Build this task.

**Files:**
- Modify: `shared/fleetRoles.ts` (`coordinator`'s `probeSet` gains `thread`; one line)
- Modify: `server/src/continuity/probes.ts` (`probeRound` draws one `thread` question for a coordinator when the
  snapshot's checkpoint holds at least one ruling: "What did the operator rule last on programme `prog-a`?", choices
  the newest ruling's id and up to three older ones, expected the newest; skipped, and the round says so, when the
  checkpoint has none)
- Test: `server/test/continuity-probes.test.ts`

**Needs:** PR B, and the renewal-act piece's Task 3 (the checkpoint and its last ten rulings).

- [ ] **Step 1: Failing tests:** a snapshot whose checkpoint has three rulings yields one `thread` question whose
  `expected` is the newest; a snapshot with none yields no `thread` question and says so; `gradeProbe` grades it like a
  `fact` question.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green. The floor's mutants gain one: expect the
  oldest ruling.
- [ ] **Step 5: Commit.** `feat(continuity): a coordinator's thread probe, the newest ruling in its checkpoint (R19)`

## Deviations found

None yet. Decisions this plan takes, by slug:

- **fit-window-twenty** — the rolling window of the fitted ceiling is the last 20 closed-book spot probes of a depth
  bucket and model class (§3.3.5: "The plan fixes the rolling window as a count").
- **closed-book-is-unmeasured-in-w1a** — the server can attribute only its own continuity reads (card, notes) to a
  session in W1a, so an answer with none of those reads is `unmeasured`, not closed; M8 counts only `closed`, which
  needs W1's witness. Recorded for the coordinator: until then no probe counts towards M8 or the fitted ceiling.
- **coordinator-probe-classes** — a coordinator's set is `fact`, `temporal`, `abstention` and `continuation`, the classes
  its own rows can grade (C52's list).
- **coordinator-thread-probe-waits-on-the-operator** — whether a coordinator gets a thread probe in W1a is the
  operator's call (an item the coordinator raises); Task 7 is written for "the newest ruling in the checkpoint" and is
  dropped, as `no-coordinator-thread-probe`, if the operator rules "none".
- **spot-probes-announced-by-mail** — an active coordinator learns of a spot probe by system mail; the questions come
  only from the door. The Overlord's arrive as inbox rows in W1.

## Where things stand

**Needs before it starts:** PR A needs the card piece's PR A (`CardFacts` and `CardNote`, in `shared/continuity-card.ts`)
and the renewal-deciders piece's PR A (`shared/continuity.ts`, which Task 1 extends). PR B needs the
card piece (snapshots, the `probing` move), the notes piece, the generations piece and the context-readings piece.

Task 7 waits on the operator's item and on the renewal-act piece's Task 3.

**What depends on it:** the renewal-act piece (`probing` is the last state before `active`), the Overlord's soft
ceiling row (W1, the fitted ceiling), M8 and M23 (§12), the weekly quiz's report (it lands beside the probe rows).

**States W1's face may read** (read-only, for W1's screen): a round's grades and `book`, and a generation in `probing` or
`degraded` after a second failed round ("a probe failing").

**Open questions for the operator:** none.
