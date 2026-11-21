# Broker helper ends: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an Agent helper's final task notification, already journaled, ends its broker activity record (S1, now), and
the broker's old open records are closed once, dry run first (S2, later).

**Architecture:** every decision lives in one new C5 L1 module, `server/src/coord/delegation-end-basis.ts`: the
task-report arm's join, the basis rules and the widened "not ended". The checkpoint builder
(`delegation-checkpoint.ts`, growth-frozen under D-8641) keeps only thin calls into it. `endBasis` is an optional
checkpoint key and a nullable `delegation_activities` column.

**Tech stack:** TypeScript, `node:sqlite`, vitest; `server/` only.

**Spec:** `docs/superpowers/specs/2026-11-19-session-helpers-design.md` §7, §7.1, §7.2, §11 (Table 13, the S1 and S2 rows),
§12 (J9), §14. Spec corrections go in this plan (below); the coordinator folds them into the spec.

## Global constraints

- Run a single suite from inside `server/`: `~/.local/bin/ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/<file>`.
- Decide in L1, act in L4. `delegation-checkpoint.ts` grows by at most 10 net code lines per PR (`SPINE_LIMIT`), with no
  waiver: a decision goes in `delegation-end-basis.ts`, never in the frozen file.
- Each task starts red against `origin/main`. A test that pins behaviour `main` already has is a labelled
  characterization pin, not a red. A mutant of every new decision branch runs through
  `ccd/coordinator-skill/references/mutation-run.py`.
- Every migration takes the next free slot at `origin/main` and is rechecked before merge; a collision at landing is
  a renumber the coordinator rules.
- D-numbers are issued by the allocator. This plan's one number is D-8830 (below).

## Task S1: an end from journaled evidence (now)

Spec §7.1, Table 9, Table 13's S1 row. One PR: "feat(coord): an Agent's task report ends its broker record (session
helpers S1)".

- [x] **Count first (review 2900 F3).** Read only, from what the fleet box can read. See "F3's counts" below.
- [x] **Red first.** `server/test/delegation-task-report.test.ts`, 24 cases, measured against `origin/main` 66c63606c3:
  19 red, 5 green. (At d0b7467b9 the file had 22 cases, 17 red and 5 green; S1-A7 was added during the build and S1-K1
  in review 3026's fix round, both red on `main`.) The 5 green cases are the two characterization pins, and three guards
  that are green by design, each red under its own mutant: S1-A4 (another key ends nothing), S1-A6 (a Workflow's own
  notification ends its run as before) and S1-C2 (an unknown basis word is refused). Three red cases are red on `main`
  for a reason other than the missing arm, and are labelled so in the file: S1-W4 (`main`'s closed reader refuses its
  hand-written `endBasis` key before the replay runs), S1-C3 (`main` has no projectability rule for the key, and no arm
  ends its fixture row) and S1-M2 (`main` has no `endBasis` entry to find; the refusal it asserts is behaviour `main`
  already has).
  - The arm: S1-A1 (completed), S1-A2 (failed and cancelled end; `unknown` moves nothing), S1-A3 (no launch index),
    S1-A5 (a measured end stands, in either order), S1-A7 (out-of-order event times: the end is never before the record
    opened, and `lastEventAt` never moves back).
  - A record retired before its notification: S1-R1.
  - The boot replay: S1-B1 (recovery), S1-B3 (the applier saves it: disk, SQLite and one warn line).
  - The rebuild gives the same ends: S1-B2.
  - The adoption effect: S1-D1.
  - The codec and the assertion: S1-C1, S1-C3.
  - The widened "not ended", one row per site: S1-W1 (`touchActivity`), S1-W2 (the new arm), S1-W3 (the Workflow run
    and worker arms), S1-W4 (the boot replay over a backfill row).
  - The migration: S1-M1 (the column, null on old rows, its CHECK), S1-M2 (a migration that cannot apply refuses
    rather than opening empty).
  - What an older server can read: S1-K1 (against a frozen copy of `main`'s activity key list, a row a task report
    ended carries exactly `endBasis` outside it, and a checkpoint whose ends are all observed carries no key outside it).
  - Characterization pins, labelled so: PIN-1 (a captured workflow's Start and Stop give an ended `agent` record),
    PIN-2 (a closed reader refuses an unknown activity key with `bad-shape`, and recovery reports that rather than
    opening empty).
- [x] **The decisions, in `delegation-end-basis.ts` (L1, C5).** `isEndable` (the widened "not ended"), `endedBy` (one
  measured end, `observed` written as absence), `taskReportKey` and `taskReportEnd` (the arm's join on the natural key
  through the mapping), `endBasisDefect` (Table 9's projectability rule).
- [x] **The vocabulary, in `delegation-model.ts`.** `DELEGATION_END_BASES` and `DelegationEndBasis` beside the row type,
  the optional `endBasis` on `DelegationActivityRow`, and the codec's `endBasis` column (NULL reads as no key).
- [x] **Thin calls in `delegation-checkpoint.ts`.** The codec's optional key, one assertion line, `sameActivity`
  comparing the basis, `foldTaskReport` (called beside `foldNotification`, in replay and observe alike), and the three
  existing end sites routed through `isEndable` and `endedBy`: `touchActivity`, and `foldNotification`'s run and worker
  arms. Net growth measured with `growthCheck.ts#codeLines`: +3 code lines.
- [x] **The migration, slot 118** (the next free slot at `origin/main` 66c63606c3, which holds 117 entries; it was 112 at
  d0b7467b9 and 116 at 5041cf1733, and moved up each time the branch absorbed `main` after other entries landed). One
  `ALTER TABLE delegation_activities ADD COLUMN endBasis` whose CHECK holds the three words and Table 9's two rules.
  Every test that pins the migration list or the schema, found by what it asserts, is run locally; the task note says
  which files ran where (the coordinator's ruling of 2026-11-20 leaves the other schema importers to CI's selection).
- [x] **Mutants**, each recorded in the task note `docs/superpowers/programs/desktop-polish/s1.md`.
- [ ] **A week after S1 lands** (spec §14): count the open agent records of that week, and how many S1 ended.

### F3's counts (review 2900)

Read only, on 2026-11-20 at 11:49 UTC, on the fleet box. Counts only.

| What | Count | Footing |
|---|---|---|
| Open agent records whose task notification the journal still retains | not reached | The journal, the checkpoint and `coord.db` are on the server box. The fleet box's `~/.ccrc/coord.db` is 0 bytes, and the client has no delegation read |
| Agent records in the hook spool's window with a final task notification | 788 | Measured: 250 session spool directories, 150,824 lines, hours 2026-10-19 19:00 to 2026-11-20 11:00 UTC (the spool keeps about 24 hours for live sessions, longer for stale ones) |
| Of those 788, a SubagentStop before the notification | 788 (all) | Measured |
| Of those 788, a SubagentStop after the notification, or none | 0 | Measured |
| Agents open in the window (a Start or launch, no Stop, no completed launch) | 7, none with a notification | Measured |
| Final notifications that name no agent started in the window | 655, and 118 more that are Workflow tasks | Measured. A notification also reports background shells and agents started before the window |
| Final notifications in the window | 1,705 | Measured. The three counts above (788, 655, 118) are distinct (session, incarnation, task id) keys, each counted once at its first final notification, and between them they hold every key, so the other 144 notifications repeat a key already counted |
| Open agent records the first boot after S1 would end | none expected from the spool's window | Inferred from the two rows above; the server's journal may retain older notifications |

**What the count says (the coordinator's ruling on it, 2026-11-20).**

- **Measured:** no agent in the spool's window was still open when its task notification arrived. Every one of the
  788 agents that reported had already sent its SubagentStop, which ends its record.
- **Inferred** (the arm has not run on the fleet): the arm would close none of today's open records, and it would give
  no earlier adoption terminal time than the Stop already gives, for any record in this window. The spec's "adoption
  watches start sooner" holds only for an agent record whose task notification arrives while it is still open, and
  this window held none.
- **Not found:** the cause of today's residue of open records (spec §2.2) is still unknown. The 7 open agents of the
  window have no notification either, so the arm does not reach them.
- **Not reached:** the server's journal and `coord.db`, so the count of open records the first boot will end is not
  measured; it is inferred from the spool as few or none.
- **Kept anyway (the coordinator's ruling):** the arm is built and tested, it costs no more than the `endBasis` S2 needs,
  and it is a backstop if Stops go missing later. The week-after measurement (spec §14) is still owed.

### Rollback

An older server refuses the new checkpoint (`bad-shape: activity has the unknown key "endBasis"`), as it did after
bb1a9478db: the lane reconstructs until a roll-forward. It does so **only once some row carries `endBasis`**: S1 writes
the key for a task-report end alone, never for an `observed` one (written as absence). A checkpoint written by S1
before any task report ended a record is byte-identical to one written before S1, and an older server reads it. The
first boot after S1 can arm this at once, by ending an open record from a notification the journal retains, so the
trap arms on the first boot that ends anything (review 3026); S1-K1 pins which checkpoints carry the key. The
new column is nullable: an older server never names it in a read or a write, so `coord.db` is not what refuses. PIN-2
pins the refusal shape. The PR body says this plainly.

## Task S2: the one-time pass (later)

Spec §7.2, Table 10, Table 13's S2 row. Its own PR, after S1 has booted on the fleet (its first boot moves the open
counts, spec §7.1).

- [ ] **Red first:** a dry run writes nothing; a second run closes nothing; a record that fails the positive check stays
  open, and a `compact` or `resume` alone never passes it; every row of Table 10 as a test; undo reopens exactly the
  closed records, byte for byte for untouched ones; records younger than 24 h are untouched.
- [ ] **The trigger.** A route (session-gated, joins `box-token-census.test.ts`, named in CLAUDE.md's door prose) or a
  command (refuses inside a session). This plan names it when S2 starts.
- [ ] **The dry run:** the count it would close, by kind and age; how many a lease or lineage names; how many failed the
  positive check. Pasted, as counts, into S2's PR before the pass runs.
- [ ] **The pass:** a `DelegationCheckpointBuilder` method run inside the durability layer's `commitLocked`, as D-6268's
  zero-delta retire runs. Each qualifying record: `ended`, `endedAt` null, `endBasis = backfill-unmeasured`. It is
  idempotent. Its decision goes in `delegation-end-basis.ts` (or a sibling L1 module), not in the frozen file.
- [ ] **The readers of Table 10:** the identity and workflow holds and the retirable set in `delegation-compaction.ts`,
  and `retireBehindCut`, read the basis.
- [ ] **`openWorkflowWorkerFromMeta`** (`delegation-checkpoint.ts`, review 3026 F3): a worker opened from its run's row
  copies the run's `endedAt` and opens ended only when that value is set. A run S2's pass closed has a null `endedAt`,
  so its worker would open active under a closed run, and the next pass would have to close it again. S2 makes this
  site read the run's state and basis, not its `endedAt` alone, with a red test first. S1 cannot reach it: nothing
  writes a backfill yet.
- [ ] **The dry run counts one order S1 leaves to a restart** (review 3026 F4): an agent record opened only by the meta
  door after its final notification was journaled while its key was still unmapped. Live, that notification ended
  nothing, so the record stays open; the next boot's observe pass finds the notification covered and the key mapped,
  ends the record as a task report, counts it and saves. The end is right, but it waits for a restart, against the
  rule that replay never differs from the live path. The dry run reports how many records are in this state; S2
  decides then whether the meta door should apply an already-journaled final notification.
- [ ] **Two writers to fold, and the arm's silent case** (review 3026 F9, carried; no code change in S1):
  `delegation-end-basis.ts` restates `foldNotification`'s "final status" rule, and its `later` restates `maxInstant`,
  so each rule has two writers; S2's L1 work makes each one writer. The CHECK and `endBasisDefect` accept an explicit
  `observed` and an `endBasis` on a row that is not ended, which nothing writes and an older server would refuse for
  nothing; S2 decides whether to narrow them. Where the mapping names an ID with no row, `foldTaskReport` ends nothing
  and says nothing (`mapped-row-missing-ignored`, below), while its two siblings refuse `fold-refused`; it is
  unreachable today, since the checkpoint's identity assertion refuses such a checkpoint.
- [ ] **The undo:** a second builder method that reopens every `backfill-unmeasured` record.
- [ ] **The words,** in `shared/`: "closed by the one-time pass; its real end was not measured".

S1 already gives S2 two things: `endBasisDefect` admits a backfill row (null `endedAt`), and every measured end replaces
one (`isEndable`), so S2 adds no end rule of its own.

## Spec corrections (for the coordinator to fold into the spec)

- **Table 1, the broker row's "Ended by":** add "an Agent's final task notification (S1)".
- **§7.1, "Two effects at S1's first boot":** the spool's window measured no open record with a retained notification
  (F3's counts above). The effects are real but may be empty; S2's dry run still runs after S1 has booted.
- **§7.1, "The adoption effect":** "Adoption watches start sooner" holds only for an agent record whose task
  notification arrives while it is open (F3).
- **§7.1, the rollback:** an older server refuses the checkpoint only once some row carries `endBasis` (review 2900's
  minor at the spec's line 504).
- **Table 9, the projection row:** the column's CHECK also holds Table 9's two rules, so the assertion mirrors the DDL
  (`column-check-mirrors-rule`).
- **§9, Table 12's last row:** the new end and the basis rules live in a new file, `server/src/coord/delegation-end-basis.ts`
  (L1, C5), beside the files that row names (review 2900 F8).
- **Table 10, a missing row** (review 3026 F3): `openWorkflowWorkerFromMeta` in `delegation-checkpoint.ts` reads the
  run's `endedAt` to decide whether a worker opens ended; a backfilled run has none, so S2 must handle this reader too.

## Deviations found

- **D-8830** — `broker-task-report-end`: session helpers S1 (desktop polish wave 156). An Agent's final task notification
  ends its broker activity record on the natural key through the mapping, with no launch index; `endedAt` is the
  notification's observed time, and `endBasis` (`observed`, `task-report` or `backfill-unmeasured`, optional, absence
  meaning `observed`) is a checkpoint key and a nullable column (migration 118). A later measured end replaces a
  backfill one, at every end site. Each departure from the spec, by slug:
  - `observed-written-as-absence`: an `observed` end is written by removing the key, never as `endBasis: 'observed'`, so
    a checkpoint carries the key only for a task report or a backfill. The codec still reads an explicit `observed`.
  - `final-report-only`: an `unknown`-status notification moves nothing on an agent record, not even `lastEventAt`.
    The Workflow arm's `unknown` touch is unchanged.
  - `measured-end-stands`: a record a measured end already ended keeps it, whichever of the Stop and the task report the
    journal holds first. The spec says only that a measured end replaces a backfill one; this rules the other pairs.
  - `unmapped-report-ignored`: a notification whose key the mapping does not hold (never opened, or retired behind the
    cut) ends nothing and sets nothing on an identity candidate.
  - `mapped-row-missing-ignored`: where the mapping names an ID with no row, the arm reads it as unmapped and does not
    refuse. `touchActivity` refuses that case; the checkpoint's identity assertion already refuses such a checkpoint.
  - `column-check-mirrors-rule`: the column's CHECK holds the three words and Table 9's two rules (the spec said "a
    nullable column").
  - `same-activity-basis-equivalent`: `sameActivity` compares the basis, as Table 9 says. No fold changes only the basis
    (every end that changes the basis also changes `endedAt` or the state), so its mutant is equivalent.
  - `f3-not-reached`: F3's journal counts could not be reached from the fleet box; they were counted from the hook spool
    and labelled.
  - `capture-pin-maps-payload`: PIN-1 maps the capture's payload fields as the hook does, rather than running the hook,
    so the file stays out of the hook-spawning suites.
