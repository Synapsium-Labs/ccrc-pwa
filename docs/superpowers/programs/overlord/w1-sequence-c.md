# Overlord W1, the sequence, PR C: the doors

Wave 237, run 3886, ticket `w1-sequence-c`. Plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sequence-monitor.md`,
Task 7 (PR C), with its Global Constraints, Review Focus points 3 and 4, the PR split's row C and its open questions as
recommended; and Task 0, the carries of the monitor's second review (ticket `sequence-b2-review-carries`). This note is what
the ledger should learn; the coordinator folds it in. No deviation number was allocated: departures are recorded by slug.

The wave runs in two stages. Stage 1 is everything that edits none of the door seam's shared files (the Overlord's routes file
and door table, `server.ts`, the session gate's two files, the box-token census, the rings data file, the masked-routes suite,
the Overlord doors census, `CLAUDE.md`). Stage 2 adds those, after the readiness word's door is on `main`.

## What was built

**Task 0, the monitor's review carries.**
- The lost-record retry case in `invariant-lane.test.ts` pins the rig's sequence head (`headPin`). Since #3395 a latch raise
  stamps a `ladder-latch` line, so a moved head made the next pass due anyway, and the case could not tell a pass remembered
  before its record from one remembered after. With the head pinned, it alone among the latch cases goes red on that mutant.
- A fail-once switch for the resolve (`failResolveNext`) and one case: an open finding that now holds, a resolve that fails
  once when the cadence passes, and the next pass with no clock advance resolves it.
- `invariantLane.ts#invariantMonitorOver` binds the sequence store's `designationBaseline` itself, like the head, the open
  findings, the record and the resolve; the factory no longer takes the read as an argument, so the composition root can pass
  no stand-in (slug `i5-baseline-bound-in-the-factory`). Chosen over a text pin because it removes the seam rather than
  watching it: a root that tried to pass a read would not compile (an excess property), and the production binding is what
  the I5 real-read case in the lane suite exercises. `index.ts` drops its one argument and import (a two-line packet to that
  file's claim holder; see "Stage 1 state").
- The moved-line case's gloss in `invariant-facts.test.ts` names what moves the kept line (below, "Task 0's words").

**Task 7, stage 1.**
- `server/src/coord/overlordSequenceDoor.ts` (C5, L1): the two doors' answers as pure deciders, so the routes only read and act.
  - `readSequenceQuery`: the cursor read's query, closed. `after` defaults to 0 and is a canonical non-negative decimal integer
    (no sign, no leading zero, a safe integer); `limit` defaults to `SEQUENCE_PAGE_MAX` and is 1 to `SEQUENCE_PAGE_MAX`. A key
    other than the caller's pair and these two, a repeated key, or a value outside the grammar is refused, naming the key and
    never quoting the value.
  - `restoreGenerationOf`: the restore counter's one reader's answer as the wire's word: a measured non-negative integer, else
    `unmeasured`, never zero.
  - `sequenceDoorAnswer`: unreadable is `refuse` `unavailable` with an `unmeasured` line; otherwise `sequencePage`'s own order.
    A page is served rows, counted; `gap` and `ahead` are answers that serve no line, each with its own outcome word. The
    ledger line's scope is `after=<n>`.
  - `invariantsReadAnswer`: `no-pass-yet` (with the arming mode) before the first pass; `unmeasured`, naming the read, when the
    open list, the resolved list or the counts could not be read; else the pass: the mode now, the last pass (its time, its
    mode, and every invariant in Table 11.7a's order, a name the pass did not answer reading `unmeasured`), the open and the
    resolved findings of both modes, newest first, each cut at `INVARIANTS_READ_ROWS_MAX` (200) with a flag, and M24's counts.
  - `isSequenceDoorKebab`: the read's own answer words, declared once, for the coordination kebab census.
- `invariantFindingsStore.ts#findingRows`: the open or the resolved rows of both modes, newest first, at most a limit (a read;
  the store's two writers are unchanged).
- The client verb: `ccrc-api overlord sequence [--after <n>] [--limit <m>]`, row `overlord.sequence`
  (`GET /api/overlord/sequence`, query keys `after` and `limit`). Each value must be a canonical non-negative integer
  (`bad-query` otherwise, unsent); the pane's pair rides the query after them, as the inbox's reads. One hundred and three rows.
- The typed tool: one row of the door process's tool table, `sequence`. Its verb is the client row's key, its class `view`,
  unfenced by the table's own rule (its door row is not a write), and `reader: false` (the door-process plan's question 9
  opens only the board and the history to readers). Its input is the verb's two bounded integers (`after` a non-negative safe
  integer, `limit` 1 to the page bound, which the tool file holds as a copy that `door-tools.test.ts` holds equal to the shared
  constant). The later census that holds every `overlord-v1` door to a client row and a tool, both ways, reader flag included,
  would be green for this door once stage 2 adds its door row.
- The route suite, `server/test/overlord-sequence-route.test.ts`, written red against the doors stage 2 adds.

**Task 7, stage 2.** Pending the coordinator's word: one ordinary merge of the named `main`, then the routes file of the
sequence door (`server/src/coord/overlordSequenceRoutes.ts`), the operator door in `overlordRoutes.ts`, the two door rows, the
deps in `server.ts`, and every census of the door seam.

## Where main differed from the plan

Measured at `main` `ad35cf5538`.

- **The sequence door's routes file.** The plan puts both handlers in `overlordRoutes.ts`. On `main` that file registers only
  the operator's session-gated doors (the box-token census pins it); the Overlord's box-token doors each have their own file
  (`overlordInboxRoutes.ts`, `overlordHistoryRoutes.ts`). So the sequence door gets `overlordSequenceRoutes.ts`, and the
  invariants door stays in `overlordRoutes.ts` (slug `sequence-door-in-its-own-routes-file`). What either door answers, writes
  or admits does not change.
- **The client's grammar.** The plan's `ccrc-api sequence` is a bare verb; the client takes a group and a verb, and the
  Overlord's rows are the `overlord` group. The row is `overlord.sequence`, run as `ccrc-api overlord sequence` (slug
  `sequence-verb-is-overlord-sequence`).
- **The restore generation.** The plan passes `unmeasured` until authority journal C. Authority journal C is on `main`, and so
  is the counter's one reader, `OverlordRestoreState.restoreGeneration()`, which the timers read at each set (through the
  continuity routes' deps in `server.ts`). Stage 2 passes that reader, never a second; unreadable or a throw answers
  `unmeasured`, never zero (slug `restore-generation-read-live`, the coordinator's ruling).
- **The read ledger and its runner.** `sequence` is already a read door of the private store (`READ_DOOR_MAP`) with a ceiling
  of 120 an hour (`READ_CEILINGS`), so no shared file changes. The inbox piece's one read runner (`overlordRead.ts`) owns
  count, record, answer for every Overlord read; its served outcome word is `rows`, so a page's line reads `rows`, not the
  plan's `page`, and the private store's readers count it as a served read (slug `sequence-page-line-is-served-rows`). `gap`,
  `ahead` and `unmeasured` lines carry their arm's word.
- **The door process.** The tool table (door process A and B) is on `main`; the plan predates it. The coordinator's ruling adds
  the `sequence` tool (above).
- **The findings reads.** The plan's store names `openFindingKeys` and `findingCounts`; `main` has `openFindings` (one mode's
  open rows) and `findingCounts`. No read served resolved rows, so `findingRows` is new.
- **Censuses beyond the plan's list.** The door process's three suites (`door-tools`, `door-tools-argv`, `door-process`), the
  closed client's own row count (`ccrc-api-closed.test.ts`), and the coordination kebab census in `mail-routes.test.ts`, which
  reads every quoted kebab word under `server/src/coord`.

## Departures, by slug

- `sequence-door-in-its-own-routes-file`, `sequence-verb-is-overlord-sequence`, `restore-generation-read-live`,
  `sequence-page-line-is-served-rows`: above.
- `sequence-limit-is-positive`: the plan says `limit` is a non-negative integer. The door admits 1 to `SEQUENCE_PAGE_MAX`. A
  limit of 0 reads no line from the store (`sequenceAfter`'s `LIMIT 0`), while `sequencePage` serves at least one, so it would
  answer a reader that is behind with an empty page and an unmoved cursor, the thing §10.4 rules out. The coordinator ruled
  it after stage 1: 1 to 500, and a zero is refused like any other bad limit, with no ledger line, never read as a limit.
- `sequence-query-is-closed`: a key other than the caller's pair, `after` and `limit` is refused 400, and so is a repeated key;
  the plan names only the two values' bounds.
- `invariants-read-carries-both-modes`: the read answers the arming mode now (`mode`) and the mode the last pass ran in
  (`lastPass.mode`), and `no-pass-yet` carries the mode too; the plan names one mode.
- `invariants-read-lists-are-cut`: each findings list is cut at 200 rows, newest first, with a flag; rows are never deleted in
  W1, and M24's counts carry the totals.
- `i5-baseline-bound-in-the-factory`: Task 0, above.
- `sequence-door-sets-apart`: the four deciders' mutant sets live in `server/test/sim/sequenceDoorSets.ts`, beside the
  sequence's and the monitor's own sets files, which are other runs'.

## Mutation rows

**The deciders' sets** (`server/test/sim/sequenceDoorSets.ts`, run once by the floors' own runner from a temporary suite file,
then removed; their floors join the floors file by a packet to its claim holder). Before: no key for any of them.

| Decider | Mutants | Killed |
|---|---|---|
| `readSequenceQuery` | 9 (Q1–Q9) | 9 |
| `restoreGenerationOf` | 3 (R1–R3) | 3 |
| `sequenceDoorAnswer` | 7 (S1–S7) | 7 |
| `invariantsReadAnswer` | 8 (V1–V8) | 8 |

Q4 (an unsafe integer admitted) survived the first run: its case's value had seventeen digits, which the grammar already
refuses. A sixteen-digit value above the safe bound now kills it.

**By hand** (each mutant applied, the named suite run, the file restored with no diff):

| Mutant | Where | Before | After |
|---|---|---|---|
| a pass remembered before its record (the store moved above the open read, `done` ignored) | `invariantLane.ts#InvariantMonitor.pass` | the lost-record case green (the latch's line moved the head) | red, beside the refused-latch, failed-shadow-record and failed-resolve cases |
| a failed resolve does not mark the pass not done | the same | the lane suite green (24 cases) | the failed-resolve case red |
| the factory binds a stand-in baseline answering none | `invariantLane.ts#invariantMonitorOver` | (no such seam: the root passed it) | the I5 real-read case red |
| the root passes a stand-in | `index.ts` | compiled (the type allowed any read) | cannot compile: the factory takes no such argument |

Task 7's two hand mutations (the page served before the gate; the ledger line skipped on `gap`) run in stage 2, with the
routes.

## What a merge arms

- Task 0: tests, and one change of shape at the composition root that binds the same read the root passed before. Nothing a
  box runs changes.
- Task 7: two read doors (stage 2). Nothing is written but read ledger lines in the private store, one per served or refused
  sequence read after the gate. The operator can read the monitor's shadow record and arm it on the Shadow lanes card.
  `restoreGeneration` is the restore counter's measured value, or `unmeasured`.

## Known limits

- The sequence door's row is not a write, so the read runner runs it unfenced, and its ceiling (120 an hour) counts every
  attributed line: a session that forges the designated session's pair spends the Overlord's ceiling (the inbox plan's
  question 18). The inbox and history doors are fenced reads; this one is not, by the plan's table and the ruling.
- After a server restart the operator's read answers `no-pass-yet` until the monitor's first pass (at most a minute), though
  the findings table already holds the record.
- The findings lists are cut at 200 rows each.

## Task 0's words

- In W1 no production writer stamps a line of any kind other than `designation` with a session actor. So on a real box I5
  reads holds or `unmeasured`, never violated, and days in shadow carry no I5 evidence either way.
- "A designation line above the floor moves the kept line" holds only for some lines. While a binding stands, only a newer
  `live` line or the retire of the bound body moves it; with no binding, any newer designation line does
  (`overlordSequence.ts#keptDesignationLine`). The moved-line case in `invariant-facts.test.ts` now says so.

## Stage 1 state

- Commits on `ws/overlord-w1-sequence-c`, nothing pushed.
- Packets, each sent before any edit of a file another worker holds: `server/src/index.ts` (two lines) and the kebab census arm
  in `server/test/mail-routes.test.ts` were answered yes and applied as sent; the two mutation floor files wait on their
  holder's answer, untouched here.
- Runs, each through the fleet test wrapper, at most two workers: the Task 0 and Task 7 suites; the rings and single-definition
  suites; the client, door process, containment, skill, census and growth suites that read the changed files; the doc suites
  for this note; the server's source type check. The tests' type check over the whole test tree was killed by the test
  slice's memory cap, so it ran narrowed over the changed test files and what they import: its one error is the route suite's
  missing stage-2 module, by design.
- One red that `main` shows too, on the same box, run alone: the containment suite's loopback `curl` case
  (`--url=` exits 7 where the case expects 2), with the box's curl 8.18.0. Not this branch's; left alone, by the
  coordinator's ruling, who has ticketed it on its own.
