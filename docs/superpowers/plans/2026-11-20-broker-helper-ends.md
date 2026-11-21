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

## Task S2: the one-time pass (now: desktop polish wave 163, D-8874)

Spec §7.2, Table 10, Table 13's S2 row. Its own PR: "feat(coord): the one-time pass closes the broker's unmeasured records,
dry run first (session helpers S2)". S1 merged as #3142. The real dry run needs S1 and S2 booted on the fleet, so this PR
carries the method and its dry run against fixtures; the operator's dry-run counts are pasted into the PR as a comment
before the pass runs, and nothing here runs the pass, the dry run or anything that writes against the live server.

**The trigger: a session-gated route** (named when S2 started, 2026-11-21), `GET` and `POST /api/coord/delegation-backfill`,
registered from a routes file of its own, `server/src/coord/delegationBackfillRoutes.ts`. It is the smaller of the two the
spec allows: a command would still need a server door to reach the watcher's one applier, plus a client row and a script.

- [x] **Red first** (measured against `origin/main` 137f96672c; the counts are in the task note,
  `docs/superpowers/programs/desktop-polish/s2.md`). Four files:
  - `server/test/delegation-backfill.test.ts` (30 cases): the verdict (B-V1 to B-V7: under 24 hours untouched, the bash
    arm, the positive check's three arms, quiet from `lastEventAt`, a record not open never touched, which parents are
    read), the plan and the report (B-P1 to B-P6), the rows (B-R1 to B-R4), the builder (B-B1) and the applier (B-D1 to
    B-D12: the dry run writes nothing, a `compact` or `resume` alone never passes the check, a second run closes nothing
    and writes nothing, the count refusal, under 24 hours untouched, the undo byte for byte, a touched record keeps its
    `lastEventAt`, the re-run after a rebuild from the journal alone, a list that does not read, F4's count, the scan's
    bound and a refused read).
  - `server/test/delegation-backfill-readers.test.ts` (12 cases): every row of Table 10 by behaviour, six red on their
    own assertions and six labelled characterization pins, and F3.
  - `server/test/delegation-backfill-route.test.ts` (11 cases): the trigger.
  - `server/test/single-definition/delegation-end-rules.test.ts` (3 cases): F9's one writer each.
- [x] **The trigger: the route** (above). `GET` is the dry run. `POST` takes `{act: 'pass', closes: <the dry run's
  count>}` or `{act: 'undo'}` and nothing else (400). The pass refuses `sign-in-unarmed` (403) unless sign-in is armed
  and the caller holds a session; the dry run and the undo stay open dark. The pass refuses `count-changed` (409, a new
  word in `shared/delegationBackfill.ts`, spread into `REFUSAL_STATUS`) unless `closes` is the count it would close now,
  and answers the report it would act on, with "the pass would close N, not M: read the dry run again" (RT-5). The route
  measures the registry (one listing, then each listed parent's incarnation, read twice) for the parents a verdict reads
  only (`backfillParentsToRead`), and decides nothing. It joins `box-token-census.test.ts` as a lane source of its own
  (`DELEGATION_BACKFILL_DOORS`), `auth-gate.test.ts`'s route tally (291 to 293), and CLAUDE.md's door prose in one sentence.
- [x] **The dry run:** the count it would close, by kind and by how long ago each was opened (1 to 7, 7 to 30, 30 days
  and more); how many of those a lease or lineage row names (released or not, open or closed); how many failed the
  positive check; how many are under 24 hours; how many the pass already closed; in a re-run, how many qualify but are
  not on the list; and F4's count. The words ride every report. It writes nothing (B-D1, RT-1). Pasted, as counts, into
  S2's PR as a comment by the operator before the pass runs.
- [x] **The pass:** `DelegationCheckpointBuilder.closeByBackfill(ids)`, run inside `commitLocked` by
  `DelegationDurability.backfillPass`, as D-6268's zero-delta retire runs. The decisions are in a sibling L1 module,
  `server/src/coord/delegation-backfill.ts` (C5): `backfillVerdict`, `planDelegationBackfill`, `backfillClosed`,
  `backfillReopened`, `workerUnderRun`, the list's codec, `backfillParentOf` and `parseBackfillRequest`. Each qualifying
  record: `ended`, `endedAt` null, `endBasis = backfill-unmeasured`, nothing else changed. Idempotent: a second run finds
  nothing to close and writes nothing (B-D3). Growth of the frozen file, measured with `growthCheck.ts#codeLines`: +2
  net code lines (limit 10).
- [x] **The readers of Table 10** read the basis through `delegation-end-basis.ts#hasMeasuredEnd` (the negation of
  `isEndable`): the identity and workflow holds and the retirable set in `delegation-compaction.ts`, `retireBehindCut`,
  and lease liveness (`delegation-projection.ts#livenessOf`, review 2900 F1: S2 does not wait for H3, so a lease row on a
  closed record never draws `end recorded`; the activity rows drop every ended record by its state). Each is a test
  (R-L1 to R-F3, below).
- [x] **`openWorkflowWorkerFromMeta`** (review 3026 F3): a worker opened from a run the pass closed opens closed by it
  (`workerUnderRun`), under any other run as before (R-F3, B-R3).
- [x] **The dry run counts F4's order:** open, or already closed, agent records whose final task notification the
  retained journal holds. The meta door is unchanged in S2 (the coordinator's ruling, 2026-11-21): the pass may close such
  a record, and the next boot's observe pass replaces that close with the task report (`isEndable`). The read of the
  retained journal runs OUTSIDE the applier's queue (the coordinator's condition: nothing the watcher applies waits for
  it), bounded at `DELEGATION_BACKFILL_SCAN_MS` (120 s) by the injected clock; past the bound, or on a read that refuses,
  the count is unmeasured (`reportedScan: cut`), never partial (B-D11, B-D12). Inside the queue the dry run reads only the
  list and decides the plan: 3.4 ms on 31,189 rows (measured, the task note).
- [x] **F9:** one writer each. `maxInstant` lives in `delegation-model.ts` (the checkpoint and `delegation-end-basis.ts`
  import it), and the final-status rule is `delegation-end-basis.ts#isFinalNotification`, which `foldNotification` calls.
  The CHECK and `endBasisDefect` are NOT narrowed: narrowing the CHECK needs a table-rebuild migration for states nothing
  writes, and the assertion must keep mirroring the DDL (`column-check-mirrors-rule`). The silent case of
  `foldTaskReport` stays as S1 left it (unreachable: the identity assertion refuses such a checkpoint).
- [x] **The undo:** `DelegationCheckpointBuilder.reopenBackfill()`, run by `DelegationDurability.backfillUndo` the same way.
  It reopens every record whose basis is the backfill's: `active`, the key removed. An untouched record comes back byte
  for byte (B-D6, RT-7); one an event touched keeps its `lastEventAt` (B-D7). The list stays, so the pass stays one-time.
- [x] **The words,** in `shared/delegationBackfill.ts`: `DELEGATION_BACKFILL_WORDS`, "closed by the one-time pass; its real
  end was not measured".
- [x] **The list (review 2900 F2):** `delegation-backfill.json` in the delegation directory (`~/.ccrc`, beside the journal
  and the checkpoint), canonical JSON `{v: 1, at, ids}`, written whole and durable (temp file, fsync, rename, directory
  fsync) before the first pass's commit, and never removed by the undo. A rebuild from the journal alone rewrites the
  checkpoint and leaves the file, so a re-run closes only its ids (B-D8); a list that does not read refuses the dry run
  and the pass (`unavailable`, 503) and is never read as empty or absent (B-D9, RT-9). The coordination snapshot copies the
  journal, the carried file and the checkpoint by name, so a restore leaves the list in place too.
- [x] **Mutants:** 54 through `mutation-run.py`, 53 killed; the survivor is equivalent (`retirable-basis-equivalent`).
  The table is in the task note.
- [ ] **The rollback note and the operator's dry run** (in the PR, after merge and boot).

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
- **Table 10, the first row** (review 2900 F1, the coordinator's ruling; S2): `livenessOf` reads the basis, so a record the
  pass closed reads as it read before the pass (`live`, `stale`, `asleep` or `unmeasured`), and a lease row on it never
  draws `end recorded`. The activity rows drop every ended record by its state, so a closed record is still drawn nowhere
  as an activity row. The row reads: "`livenessOf`: as before the pass (it reads the basis) | Yes", and a new row,
  "`projectDelegation`'s activity rows: dropped, by the state | No, and that is the point".
- **Table 10, the F3 row** (S2): `openWorkflowWorkerFromMeta`: a worker of a closed run opens closed by the pass.
- **Table 10, the retirable set** (S2): its mutant is equivalent, because the identity hold already keeps every record
  with no measured end from being retired (`retirable-basis-equivalent`); the reading of the basis stays as Table 10 asks.
- **§7.2, "Who runs it"** (S2): the route, `GET` and `POST /api/coord/delegation-backfill`; the pass also needs a signed-in
  operator and the dry run's count (`count-changed`).
- **§7.2, "A rebuild"** (S2, review 2900 F2): the re-run closes only the ids the first pass recorded in
  `~/.ccrc/delegation-backfill.json`; it does not choose again.
- **§7.2, condition 4** (S2): the report also counts the records under 24 hours, the records already closed, the records a
  re-run leaves because the list does not name them, and F4's order, whose read of the journal is bounded at 120 s.
- **§7.2, "Undo"** (S2): it also reopens a worker the meta door opened under a closed run after the pass (F3); such a
  worker was closed by the pass's own rule, so "exactly the records the pass closed" reads "the records the pass's
  basis names".

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
- **D-8874** — `broker-one-time-pass`: session helpers S2 (desktop polish wave 163). The broker's old open records are closed
  once, dry run first: a record open (`active`), quiet for 24 hours and past the positive check becomes `ended`, `endedAt`
  null, `endBasis = backfill-unmeasured`, through two thin builder methods run inside `commitLocked`; the undo reopens
  every record that basis names. Each departure from the spec, by slug:
  - `route-trigger-own-file`: the trigger is a session-gated route pair registered from its own file,
    `server/src/coord/delegationBackfillRoutes.ts`, not `coord/routes.ts` (held by another programme's claim); the census
    reads it as a lane source of its own.
  - `pass-needs-signed-in-operator`: the pass refuses `sign-in-unarmed` while sign-in is dark or the caller holds no
    session; the dry run and the undo do not.
  - `pass-carries-dry-run-count`: the pass carries the dry run's count and refuses `count-changed` on any other, answering
    the count it would close now.
  - `l1-sibling-module`: the decisions live in `delegation-backfill.ts`, a sibling of `delegation-end-basis.ts`.
  - `backfill-list-file`: review 2900 F2's list is `~/.ccrc/delegation-backfill.json`, written before the first pass's
    commit and kept by the undo; once it exists, every pass closes only its ids.
  - `lease-liveness-reads-basis`: review 2900 F1; Table 10's first row corrected (spec corrections).
  - `activity-rows-drop-by-state`: the activity rows drop an ended record by its state, since `livenessOf` no longer
    answers `ended` for a closed one.
  - `worker-inherits-backfill`: review 3026 F3; a worker the meta door opens under a closed run opens closed by the pass,
    and the undo reopens it with the rest.
  - `unknown-state-untouched`: the pass closes `active` records only; `unknown` has no writer and is left alone, so the
    undo can give back `active`.
  - `parents-read-only-when-decisive`: the route reads the registry only for the parents of open agent and workflow
    records quiet for 24 hours and under 7 days; a listing that does not read leaves every such parent unmeasured.
  - `age-bands-by-opening`: "by kind and age" is by kind and by how long ago the record was opened, in three bands.
  - `one-writer-instant-max-and-final-status`: review 3026 F9; `maxInstant` in `delegation-model.ts`,
    `isFinalNotification` in `delegation-end-basis.ts`.
  - `check-and-assertion-not-narrowed`: review 3026 F9's question, decided no (the plan's F9 item).
  - `f4-counted-meta-door-unchanged`: review 3026 F4's order is counted by the dry run; the meta door is unchanged.
  - `f4-scan-outside-queue-bounded`: that count's read of the retained journal runs outside the applier's queue, bounded
    at 120 s; past the bound or on a refused read the count is unmeasured.
  - `retirable-basis-equivalent`: the retirable set's reading of the basis is masked by the identity hold, so its mutant
    is equivalent.
