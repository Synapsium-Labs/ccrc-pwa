# ccrc history CP-39: the sweep makes forward progress on every derivation step, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ship ONE PR on `main` that makes every budget-gated step of the history sweep advance on every pass, however large the ingest backlog and however slow its discovery, as fast as the unit's CPU allows, and name honestly what that CPU allows: the entries' FTS backlog clears in hours, but the sidecar backlog (about 126,000 files, about 44 GB raw) takes days on the scheduled path, so Task 6 gives the operator a fast path for it (the import from a transient unit, 30-90 min, then about a day of FTS backfill on the scheduled ticks). Measured read-only on the fleet box: only ingest advances. The FTS backfill cursor stays at 0 with about 486,000 blobs owed, the export census cursor has stood at 0 since 2026-10-09 (so W1-k's dates were never recorded), leaves and card-measure do not move, and `rederiveFts` moves only inside its own fixed slice. Task by task:
- **Task 1 (D-6930).** The sidecar link index is built in ONE walk over a transcript's rows. Lib's new `sidecarNameMatcher` (a multi-pattern automaton) answers every asked name a row's text holds in one pass over that text, at a cost of O(text + hits) per row, where today each row runs `text.includes(name)` once per wanted name. `toolResultCandidates` takes an optional walk: a budget it checks before every row, a resume cursor (`after`) and the count of rows the cursor moved past (`advanced`). Every link result is unchanged.
- **Task 2 (D-6931, D-6932, D-6940).** The link walk is resumable and never restarted. Its state lives in meta `sidecar_walk:<transcript_pk>`: the names a finished walk covers with their first matches, and at most one walk in progress over names it does not cover. A pass whose budget ends inside the walk leaves it where it stopped; a new name gets an EXTENSION walk over the uncovered names alone, and the finished names keep their state. The state is parsed once per pass and written only when it advances or retires. A sidecar's link is known before any of its bytes are read. The sidecar half visits the sidecars grouped by uuid, in the order its caller gives the uuids. `--op import` lists the sidecars ONCE per import and hands the list to every window; its windows resume after the last sidecar the previous window examined, and count a window that examined a sidecar or advanced a walk as progress. `status` never reads a walk's state.
- **Task 3 (D-6933, D-6934, D-6938).** Each half of the ingest keeps its own scan mark (meta `scan_discover_ms`, and a new meta `scan_sidecars_ms`), and discovery itself runs under the ingest's budget: transcript discovery checks it before each project directory, and the sidecar scan lists the known uuids' `tool-results/` from a persisted uuid-directory cursor (meta `scan_sidecars_at`), so a cut listing resumes on the next tick and the sidecar mark waits for a full wrap. A completed wrap stamps meta `sidecars_unseen`, every sidecar it left unseen counted. The import's one listing runs under its windows' budgets from a cursor of its own, and a cut listing is never `done`. Only a name that can reach the link holds a walk (a name whose lstat fails holds none), and a walk that advanced no row over a visit of its group that no budget cut and no stop ended is retired, a visit that met a fs fault included, so no walk defers its uuid's new names for good. D-4340's scan clause is narrowed to the half that met the read error.
- **Task 4 (D-6935, D-6936, D-6939).** The derivation's reserve inside the ONE run budget, as real minimums. Lib's `DERIVE_SHARES` gives a ladder of ceilings (`budgetRungs`) and a floor per step (`budgetFloors`). Ingest (its discovery and its sidecars included) stops at its ceiling rung, which keeps the run's start (O5). The FTS backfill, the leaves, the card step and, on a scheduled pass, the export census each run on a slice that starts at the step's own start and holds the larger of what is left of its ceiling and its floor, as D-4344's `rederiveSlice` is a budget of its own. So a scheduled pass may overrun RUN_BUDGET_MS by at most the floors' sum (36 s) plus one unit per step. One line of spec §9.2 step 7 is amended in place, without moving any line.
- **Task 5 (D-6937).** The export census checks its budget before it builds the file clock, and once the clock is built it always takes at least one chunk.
- **Task 6.** The whole-PR checks, the steps for the coordinator or the operator (the fast path for the sidecar backlog, per-pass rates measured against costs measured on the box, ETAs and thresholds), and the PR body.

Sessions see no change. No schema change, no new table, column, index or counter, no new health word, no new unit or timer, and no wire change. `status`'s output is unchanged; its meta read skips the walk-state rows. The fix reaches the fleet box only through the release lane and `ccrc update`. Rolling it out is the coordinator's or the operator's job, never the worker's (Task 6).

**Architecture:** Fleet-side `ccd/history/*`. The one spec line (D-6936) lands in the coordinator's docs PR, not here. Ring membership is a property of a file's imports.

*L1 `ccd/history/lib.mjs`* (imports `node:crypto` only; it reads no file and runs no SQL) decides:
- `sidecarNameMatcher(names)`: the one-pass multi-pattern matcher. It has the same semantics as `String.prototype.includes` over UTF-16 units (Task 1).
- `SIDECAR_WALK_META`, `SIDECAR_WALK_CHARS_MAX`, `walkNames`, `parseSidecarWalk`, `formatSidecarWalk`, `emptySidecarWalk`, `startSidecarWalk`, `foldWalkCandidates`, `finishSidecarWalk` and `walkCandidates`: the walk state's grammar, its extension rule and its first-match fold (Task 2).
- `parseSidecarScanAt`, `formatSidecarScanAt` and `sidecarWrapClose`: the sidecar scan cursor's grammar and what a finished wrap records (Task 3).
- `DERIVE_SHARES`, `budgetRungs({ maxMs, maxBytes })` and `budgetFloors({ maxMs, maxBytes })`: the ceilings and the floors, as pure numbers (Task 4).

*L4 `ccd/history/sweep.mjs`* measures, persists and applies lib's answers:
- `toolResultCandidates` and its `toolResults` statement (Task 1);
- `linkCandidates` (replacing `candidatesFor`), `unseenOf`, `ingestSidecar`, `ingestSidecars` and an exported `importSidecars` (Task 2);
- `sidecarScanDue`, `walkTranscripts`' stop, `discoverTranscriptsWithin`, `listSidecars`, `candidateFiles`, `unseenOf`'s reachable names, `ingestSidecars`' scan share and its idle-walk retirement, `importSidecars`' budgeted listing and `ingestTick`'s two marks (Task 3);
- `budgetRung`, `stepSlice`, `runRungs`, `tick`'s wiring and `periodicCensus`' census slice (Task 4);
- `exportCensus` (Task 5).

*L4 `ccd/history/cli.mjs`*: one statement, `STATUS_SQL.meta`, gains a `WHERE` that skips the walk-state rows (Task 2).

`derive.mjs`, `card.mjs`, `store.mjs`, `store.d.mts`, `recall.mjs` and `regex-worker.mjs` are **not edited**. `deriveNodes`, `cardStep` and `mergeSteps` take a slice exactly as they take the run budget today: a `newBudget`-shaped object that `budgetLeft` and derive.mjs's `parentsBudgetLeft` read field by field (`startMs`, `now`, `bytes`, `maxMs`, `maxBytes`).

**Tech Stack:**
- Node `>=22.16.0` ES modules (`.mjs`). SQLite through `node:sqlite`, positional parameters only (the `no numbered SQL parameter` describe).
- vitest in `server/`. In-process cases import `sweep.mjs` and run against fixture stores (`IX.openFixtureStore`, `makeHistoryBox`, `createStore`, `openWriter`). Spawned passes go through `runSweep`. Every sweep and derive describe skips on darwin. Lib cases run everywhere.

**Spec:** `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, rev 3.6 as amended in place. Line numbers are hints measured at `origin/main` `ece3dfbee` (the history files are byte-identical at the current `origin/main`):
- §9.2 "The order of a tick" (about :2040), and steps 2, 4, 6 and 7 (about :2066-:2103). Step 2's sidecar line (about :2070) stays true: every known uuid's `tool-results/` is still listed, over one wrap of the cursor. Task 4 amends step 7 in place (:2101), adding words to the same line.
- §9.2 "Backfill" (about :2105). §9.15's census (about :2552-:2606). §9.11's pins O4, O5, O20 and O22 (about :2416-:2436), all of which hold unchanged.

**Authority:** the coordinator's ruled fix shape for CP-39 and its fold rulings on the plan review (Decisions below), then the spec, then the merged code at the base. Earlier history plans are snapshots: `docs/superpowers/plans/2026-10-05-ccrc-history-w1-capture.md` defines D-4224, D-4236, D-4239, D-4240, D-4242, D-4310, D-4340, D-4344 and D-4346, and the B3/B4 plans define D-4740, D-4762, D-5061 and D-5394. This plan cites each of them bare and redefines none. Shipped source comments carry D-refs; read the ones at each site before editing it.

**Base:** `origin/main` at `ece3dfbee`. Each task's Step 0 checks the anchors by content (grep for the named line) and stops before any edit if one has moved.

## Files

Every file this PR touches. Nothing else is edited.

| File | How | Tasks |
|---|---|---|
| `ccd/history/lib.mjs` | new exports, appended beside their neighbours | 1, 2, 3, 4 |
| `ccd/history/lib.d.mts` | one declaration per new export | 1, 2, 3, 4 |
| `ccd/history/sweep.mjs` | edits in place at the sites named | 1, 2, 3, 4, 5 |
| `ccd/history/cli.mjs` | `STATUS_SQL.meta` (:75) only, and `SIDECAR_WALK_META` added to its lib import | 2 |
| `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` | NOT in this PR. W2-6's run holds the spec under a claim, so §9.2 step 7's one-line amendment (D-6936, line :2101, in place, line-neutral) is applied by the coordinator in its own docs PR once that claim is released. Task 4's spec bullet gives the text verbatim | — |
| `server/test/history-lib.test.ts` | appended describes | 1, 2, 3, 4 |
| `server/test/history-ingest.test.ts` | appended describes and the CP39 kit; ONE in-place edit, the sidecar-floor case's scan assertion (Task 3, D-6933) | 1, 2, 3, 4 |
| `server/test/history-cli.test.ts` | one appended describe | 2 |
| `server/test/history-card.test.ts` | ONE in-place edit: the case 'a budget spent before the card step' (:1252-:1279), its title and comment only, re-premised on the card step's own slice, whose byte floor a one-byte run rounds to 0 (Task 4). The positive floor spent is the starvation describe's third arm (P1) | 4 |
| `server/test/history-derive.test.ts` | one appended describe (the starvation case, three arms) | 4 |
| `server/test/history-export.test.ts` | one appended describe | 5 |
| `docs/superpowers/plans/2026-10-25-ccrc-history-sweep-forward-progress.md` | this plan: Task 6's figure corrections, and the definition of D-6941 in "Deviations found" if a task takes it (Global Constraints, D-numbers) | 1-6 |

**Never touched:** `deploy/history-replay.mjs` and `server/test/history-replay.test.ts` (another wave holds them; Task 6 runs the latter read-only, never edits it), `ccd/history/derive.mjs`, `card.mjs`, `store.mjs`, `store.d.mts`, `recall.mjs`, `regex-worker.mjs`, `ccd/ccd`, `ccd/ccrc`, `ccd/ccd-history-sweep`, `ccd/session-hook.sh`, every unit file, `server/test/fixtures/**` (the run-pass driver included), `.github/**`, `README.md`, `CLAUDE.md`, `shared/**`, the programme ledger, and every other spec line.

## Global Constraints

- **One PR, one commit per task, in task order.** The commit forms are `fix(history-sweep): <what> (CP-39 Task <N>; D-<n>)` for Tasks 1 to 5, and `docs(plan): <what> (CP-39 Task 6)` for Task 6's plan correction (only if a figure in this plan proves wrong). A `fix(history-sweep)` commit that takes D-6941 also edits this plan's "Deviations found" to define it, in the same commit (P21); that is the one plan edit a fix commit may carry.
- **No schema change.** No table, column, index, counter, `SCHEMA_ADDED` entry or migration: `SCHEMA_VERSION` stays 2 and `JOURNAL_V` stays 1. The four new meta keys (`sidecar_walk:<pk>`, `scan_sidecars_ms`, `scan_sidecars_at`, `sidecars_unseen`) are rows of the existing `meta` table. The `fts_undecodable:<id>` and `retention:<home>` keys are the precedent for a prefixed key. None is journaled or exported. A rebuilt store has none of them, and the sweep reads that as "no walk in progress", "sidecar scan due" and "a wrap from the start", which are all safe. A restored store (`doctor --backup` copies the whole database with `VACUUM INTO`, meta included) keeps the backup's rows: their entry ids and cursors are the backup's own, so they stay consistent with it, and the rows the restore's replay appends after them read as rows appended to a transcript (Review Focus 2) (P22).
- **No new health word, no new counter, no new unit.** A separate derivation unit or timer is REJECTED by the ruling. `HEALTH_WORDS` is unchanged. `sidecars_unseen` is a meta row, not a `counters` row.
- **One budget per run, never reset per file (§9.2 step 7, O5).** Ingest's ceiling rung is a view of the run budget: the same `startMs`, `now` and `bytes`, and lower `maxMs`/`maxBytes`. A derivation step's slice (D-6939) starts at the step's own start and charges every byte to the run; it resets nothing the run or ingest counts. No task creates a new `newBudget` inside a tick except D-4344's existing `rederiveSlice`.
- **The tick's order is D-4224's.** No step moves. `tick()`'s docstring keeps its numbered list. The `every step the body calls with db is listed` describe stays green, so a helper that takes `db` is either already listed or is called outside `tick`'s body. `runRungs(ctx.budget)` and its `slice(step)` take no `db`.
- **D-4344's slice lines stay byte-identical.** The F2 case (`history-ingest.test.ts`, 'F2 (review 344)') pins `const slice = rederiveSlice(ctx.budget);` and the two lines that pass it. They are not edited.
- **The link rule is §9.2 step 4's, unchanged (D-4239).** First the tool_result whose text names the file (a substring test), then the one answering the `toolu_…` name's tool_use, else NULL. The cases 'linkage is unchanged by the bounded candidate index' and 'lib: linkSidecar (plan task 21)' stay green unedited.
- **The decode guard stays where the census reads it.** `toolResultCandidates` keeps its own `blobOverDecodeCap` check before its own `unbrotli(r.z, r.raw_len)` on a `try` line, and its statement keeps the name `toolResults:` and its `raw_len` column. The census case in `history-ingest.test.ts`, 'census: every decompression of a stored blob in sweep.mjs is guarded', stays green unedited.
- **Exact equality on `ingestSidecars`' result.** The case 'ingestSidecars stops, unpaused and incomplete, …' compares with `toEqual({ bytes: 0, complete: false, paused: false })`. A new field (`walked`, `examined`, `resume`) is spread only when it carries something, as `unreadable` is spread today.
- **Fixture HOMEs only.** Tests use `historyHelpers.ts` (`makeHistoryBox`, `runSweep`, `plantSession`, `plantTranscript`, `openStoreRO`) and the history-ingest `IX` kit, with their poisoned tools. No step runs `ccd`, `ccrc`, the shim, `sweep.mjs` or any history verb against the live `$HOME`, and none reads `~/.ccrc`, `~/.cc-sessions`, `~/.cc-limits` or any account home. In-process passes set `deps.managedSettings: []` so the census never reads the host's managed settings. A slow or faulting dependency is injected through the existing seams: the budget's `now` (a test may replace `ctx.budget.now` after `passCtx` builds it), `deps.budget`, the ingest context's fields, `syncBuiltinESMExports` over `node:fs` and `node:zlib` (the DEFAULT import patched, never a namespace import, P2), and, for the length of one call, a wrapper around `String.prototype.includes` or `JSON.parse`, restored in a `finally`. Never an environment variable, and never a test-only field on a context (P24).
- **Running tests.** From the repository root, `(cd server && ./node_modules/.bin/vitest run test/<file>.test.ts -t '<regex>')`, in the foreground, with a timeout of at least 600000 ms, one suite per tool call. Never bare `npx vitest`. Every `-t` filter below is regex-safe and selects at least one test. A run that reports only skipped tests selected nothing, and is not green. Re-run CLAUDE.md's load flakes in isolation before calling a red a break.
- **Red-first.** Every new guard is watched red on the code without it, with the prediction written into the step before the run. A prediction that the run contradicts is recorded as measured and reported, never re-predicted. A counter the test builds is first run green as a CONTROL, before any red is predicted from it (P12).
- **Mutation-table discipline.** Every new guard has ONE measured mutation step:
  1. copy the file to `.superpowers/sdd/cp39/t<N>/<file>.orig`;
  2. apply the one named edit;
  3. run the guard's filter and record the red title;
  4. restore with `cp`, then `cmp` against the `.orig` (rc 0).
  No mutant is committed. Each task's commit step re-runs the `cmp`. Scratch lives under `.superpowers/sdd/cp39/`, which is gitignored, and never in `git stash`.
- **Never on timing.** No assertion reads a duration. Clocks are injected integers. The rows×names regression is a count of row decodes and of `includes` calls asked an asked name, both counted outside the code under test (P14).
- **Citation corpus.** `citations.test.ts` refuses an added numeric line citation in code or tests (D-5893), so no code comment cites `file:line`. `growth-check.test.ts`'s `GROWTH_FILES` lists none of these files.
- **Fixtures.** Fixture ids and paths are synthetic (`/home/u/x/tool-results/…`, `claude-demo`, `IX.U`). Non-ASCII fixture text is built with `String.fromCharCode`, never a backslash-u escape, because an agent's file write decodes those.
- **Public repo.** No host, user, account, wrapper, lane, pool or person name, no private project name, no IP address, no absolute home path, no ticket id and no docserver URL, in code, tests, comments, commits or the PR body. Say "the fleet box" and `<home>`. Task 6 runs the private-name count over every added line, every commit message and the PR body, and it must print 0.
- **D-numbers.** This wave was issued D-6930 to D-6941. This plan defines D-6930 to D-6940, once each, in "Deviations found". D-6941 is issued and unused. A departure found while executing takes D-6941, defined in "Deviations found" in the `fix(history-sweep)` commit that first cites it (the commit-forms rule above). With none left, write `D-TBD-<slug>` and report it. Never write any other number that is not already defined in the tree. Before the PR: `git fetch origin main`, then `(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)`.
- **Peers.** Before the first edit of each file, read `GET /api/claims?project=ccrc-pwa` and confirm no running worker claims it. Whichever PR lands second merges `main` (never a rebase) and keeps both sides.

## Decisions

The coordinator's ruled fix shape and its fold rulings, and how this plan applies them. Where the code or the spec made the ruled words impossible as written, the row says so and names the smallest compliant alternative.

| Ruling | Applied as | Task |
|---|---|---|
| (A) build the per-transcript link index in ONE walk over the rows, "extracting `tool-results/<name>` references and `toolu_` ids from each tool_result's text into a map" | **One walk, but NOT by extraction.** The shipped rule is a substring test (`text.includes(name)`), and two pinned cases rely on it: in 'linkage is unchanged by the bounded candidate index', `a.txt` links to the row that names `…/tool-results/data.txt`, and lib's `linkSidecar` case links a row whose text is `names toolu_01AAA.txt`, with no `tool-results/` prefix. Extraction would change both. So each row's text is scanned once by a multi-pattern automaton over the asked names (`sidecarNameMatcher`), whose answer is exactly `includes`' answer (differential-tested in scratch: 0 mismatches in about 150,000 cases), at O(text + hits) per row with no per-call allocation sized to the name list (P20). `toolu_` ids still come from `toolResultIdsOf`, as they do today | 1 |
| keep §9.2 step 4's link rule and every existing link-rule test result identical | `linkSidecar` is unedited. A finished walk hands it at most two candidates per name, the first text match and the first `toolu_` match, which are the two candidates it would pick from the full list (proof in D-6931) | 1, 2 |
| add a budget check inside the row walk | before every row, in `toolResultCandidates`' walk mode; the compressed bytes of every row the cursor moves past are charged as the FTS backfill charges them | 1 |
| make the sidecar half resumable or fair, by a persisted cursor or a rotating start, chosen and justified | **A persisted cursor, never a restart.** A rotating start cannot finish a walk longer than one pass's share: the transcript that blocks today (24,450 user rows) would be restarted on every pass. The walk's state persists in meta `sidecar_walk:<pk>`; a cut walk resumes at the next row. A finished walk keeps its state for the names it covers; a new name gets an EXTENSION walk with its own cursor over the uncovered names alone (P9). The state is parsed once per pass and written only on an advance or a retire (P10). **Fairness, the bound that holds:** a walk in progress delays only its own uuid's names that it does not cover; every other uuid's sidecars are visited in the caller's order, hinted first, and wait at most for what the walks ahead of them in that order spend of one pass | 2 |
| the import path makes progress per window, with no false `done` after a window that only built an index | `importSidecars` ends only when a window is complete, or when it examined no sidecar AND advanced no walk; each window resumes after the last sidecar the previous window examined (`resume`), so seen sidecars never exhaust a window (P3). A seen sidecar counts as examined, and each half of the end rule has its own mutant (M2j, M2k). The case counts its windows directly, at the read of each window budget's `maxMs`, never through a guard the import would swallow (an injected `statfs` throw reads as low-disk) | 2 |
| (fold 2) the import lists once; a cut listing is never `done` | the import lists the sidecars ONCE and hands the list to every window (`ingestSidecars`' `opts.found`), so no window re-lists about 135,000 entries (Task 2). Under Task 3's budgeted listing the list is built under the windows' budgets from a cursor of the import's own: a cut listing that passed a uuid directory is progress, resumed in the next window; one cut before its first uuid directory lists the rest once, unbudgeted, in the same window (an import has no run budget, §9.2 "Backfill"), so the listing always ends; and a window the listing ends or spends ingests nothing (D-6932, D-6938) | 2, 3 |
| (P22) `status` must not load walk state | `STATUS_SQL.meta` skips `sidecar_walk:` rows (D-6940) | 2 |
| give the transcript discovery half its own scan completion, IF the D-entries permit | **Permitted; done with a second mark.** No D-entry forbids it. "The scan is marked done only when both halves examined everything" is W1 Task 20/21's contract, not a D-entry, and D-4340's clause holds "the scan". The split supersedes that contract (D-6933) and narrows D-4340's clause to the half that met the error (D-6934). Its guarantee, that the file is found again, is kept. One pinned assertion moves: in the sidecar-floor case, `scan_discover_ms` now reads the later tick, and the new `scan_sidecars_ms` holds the earlier one | 3 |
| (core) discovery is bounded under the ingest rung, with a uuid-directory cursor that rotates | transcript discovery checks the budget before each project directory; the sidecar scan lists from meta `scan_sidecars_at`, checking the budget before each `projects/`, project and uuid directory; the cursor moves past a uuid directory once its sidecars were all examined; the mark waits for a full wrap; the group's lstats (`unseenOf`) run behind the same check (D-6938) | 3 |
| (fold 2) the deferral wedge: no walk may defer its uuid's new names for good | **Two rules.** Only a name that can reach the link counts as still unseen: `unseenOf`'s own lstat leaves out a sidecar over `SIDECAR_MAX_BYTES` and one that is not a regular file, since both return before the link step and never get a `sidecar_seen` row; a name whose lstat fails (a name deleted between the listing and the lstat included) is left out too, and the error never escapes as a fault. And a walk in progress that advanced no row over a visit of its group is retired, its `done` kept, unless a budget cut or a stop (the floor or history-off) ended that visit: a visit that met a fs fault, or a deferral, still retires it, so a sidecar that faults on every pass cannot hold a walk. The sidecar scan visits every known uuid's group once a wrap, so a walk that advanced no row over a whole wrap is retired. The case the ruling names, a walk started by a sidecar that is then deleted beside a sidecar over the cap, ends with the wrap complete and `scan_sidecars_ms` written; each half of the unseen rule has its own case and mutant, the over-the-cap half and the not-regular half (a directory named like a sidecar), and the failed lstat has its own (D-6938) | 3 |
| (P23) the unseen backlog as a `status` figure | **Half done.** A completed wrap stamps meta `sidecars_unseen`: the sidecars that wrap took plus every sidecar it LEFT UNSEEN, too large, refused or deferred, the backlog the figure exists to show. A deferred sidecar is not counted as `examined` (Task 2's progress count) but is counted in `left`; a deferral arm pins it. Small and cheap (D-6938). Its line in `status` is **Later**: §8.3 says every `--json` answer has every field, so a new field is a spec change to the envelope and its pins. Task 6 reads the meta row directly | 3 |
| (B) a derivation reserve inside the ONE run budget: ingest stops at budget minus the reserve; deriveFts, deriveNodes, cardStep and exportCensus each get a minimum slice carved from the same budget, as D-4344's `rederiveSlice` does; slices are not resets | **Ceilings and real floors.** Ingest's ceiling rung shares the run's start (O5): budget less every share. Each derivation step's ceiling is the budget less the shares of the steps after it. Each step runs on a slice from its own start whose limits are `max(what is left of its ceiling, its floor)`, in ms and in bytes (D-4344's precedent: `rederiveSlice` is a fresh budget). `mergeSteps` takes the card step's slice. The census's slice is made in `periodicCensus` on a scheduled pass. A pass may overrun RUN_BUDGET_MS by at most the floors' sum plus one unit per step (D-6939) | 4 |
| choose the reserve constants with a stated rationale; put them in lib.mjs once | `DERIVE_SHARES` in lib.mjs, in per-mille of the run budget: fts 150, nodes 100, card 50, census 100. **One set of numbers serves both** the ladder (`budgetRungs`) and the floors (`budgetFloors`): a second constant would be a second decision for one quantity. Ceilings admit at least one unit whenever the run's own limit is at least 1 (P1); floors round down. A card floor that is positive and spent before the card step's first check withdraws its predictions, counted `card_withdrawn:budget`: the starvation describe's third arm injects the run's limits through `deps.budget`, the seam the floors are derived from (P1, M4l). Rationale, tied to the measured box, in D-6935 and D-6939 | 4 |
| §9.2 step 7 gets a one-line spec amendment | appended to line :2101 in place, line-neutral, scoped to a scheduled tick, naming the export pass's whole budget, the import window's fresh budget and the overrun bound (D-6936, P7) | 4 |
| exportCensus recomputes `exportFileClock`/`dueTranscriptKeys` before its first budget check | it checks first, and once the clock is built it takes at least one chunk (D-6937). With its floor slice (D-6939) it moves on every scheduled pass, the hourly export pass included (P8) | 4, 5 |
| (fold 2, critical) honest rates, and a fast path for the sidecar backlog | D-6935's and Task 6's sidecar figures are re-derived from costs measured on the fleet box (2026-10-25, read-only): inline redaction and FTS cost about 20 ms of CPU per 70 KB sidecar (3.5 MB/s, over the indexed window of the first 512 KB plus a 64 KB margin), and the unit gets 0.1-0.17 of a core under load (measured on the fleet box, under the shipped unit's Nice=19 and idle I/O class and a LOCAL drop-in's CPUWeight=10, `ccd-history-sweep.service.d/60-cpu-weight.conf`, which is not shipped). **The scheduled path** is bound to about 15 s of CPU a pass at most, about 70-150 sidecars a pass, so about 126,000 sidecars (about 44 GB raw, 25-30 GB of index text) take 1.2-2.5 days, up to about 4.5 with a re-derivation generation open. **The fast path** is `--op import --apply`, whose ingest never indexes inline, run from a transient unit at default priority with the timer paused: 30-90 min for the sidecar phase; the FTS backfill then completes on the scheduled ticks at its ceiling once ingest is caught up, about a day (about 2.4 h of CPU). The store grows from about 3 GB to about 16 GB, inside the 50 GB cap. Task 6 names the route and its thresholds; a miss goes to the operator | 4, 6 |
| (C) a separate derivation unit or timer | REJECTED; not built | n/a |
| charging CPU instead of wall clock | out of scope; the spec says wall clock | n/a |

## Review Focus

The input classes most likely to break this PR. Items 3, 4, 5 and 8 now have cases in their owning tasks (P18); a reviewer should still read the code against each, and rule on the questions marked.

1. **A sidecar referenced both by name and by its `toolu_` id, in different rows.** For example, row 7's text names `toolu_01X.txt` and row 3 answers `toolu_01X`. The text rule wins over the toolu rule whatever the entry order. The walk state's two lists must keep both, and `walkCandidates` must offer the text candidate first. Check `foldWalkCandidates` never lets a `toolu` hit stand in for a text hit, that a name that is a substring of another asked name (`a.txt` in `data.txt`) folds both from one row, and that `finishSidecarWalk` keeps `done`'s entry for a stem both parts hold. Task 2's lib case covers the fold; the merge is for review.
2. **A transcript that grows while its walk is in flight.** Rows appended after `after` are walked as the walk proceeds (`entry_id > after`, ascending). A row appended after a walk finished is NOT walked for that walk's names, so a later row naming an earlier sidecar cannot win over that walk's decision. With a persisted walk that window lasts as long as the walk's names stay unseen. Check that the gate `notCaughtUp` still holds the uuid's sidecars back while any copy is short. **To rule on in review:** a sidecar rewritten (a new size or mtime) while a finished walk still covers its name links from that state, so a row appended after the walk that names it is not considered. Is that acceptable, or should a re-read sidecar force an extension?
3. **A sidecar whose transcript is in another home** (pinned: Task 2 'two homes'). `_swap_carry_sidecars` merges `tool-results` trees between homes. The group is keyed by uuid, the walk by `transcript_pk`. Within one pass both homes' copies are one group; across passes (the sidecar scan's cursor can stop between the two homes' directories) each home's share links from the same persisted walk, and a group examined in full retires the walk, so the other home's share may pay one more walk. Check that cost is the only effect.
4. **A budget that expires inside the row walk, at every boundary** (pinned: Task 1 cases (c), (d) and (e)). Still for review: a pass killed between the walk and its meta write (the next pass re-walks only from the last persisted `after`).
5. **A store mid-import** (pinned: Task 2 'import then tick'; the one listing: Task 2's window-counted case and Task 3's two cut-listing cases). `--op import --apply` holds the lock, runs windows with its own fresh budgets, lists the sidecars once from a cursor of its own, and shares meta `sidecar_walk:*` with the scheduled ticks. Check that a cut listing can never end the import `done`, that the unbudgeted retry runs at most once a window, and that the list handed to the windows is filtered by `notCaughtUp` in each window, as a listing of its own would be. Still for review: the reverse order (a tick starts, an import resumes), that the import's `importFile` path (unchanged, `newBudget(ctx.now)`) is not affected by `deps.budget`, and that `resetFtsPending` after the import re-opens the FTS backfill, which now runs on its own slice on the next tick.
6. **The sidecar scan's cursor across a roster change.** `scan_sidecars_at` names a directory under a home. A home that leaves the roster, or a directory that is removed, must restart the wrap from the start (never skip the rest of the tree), and a home added before the cursor's home is listed on the next wrap. Check `listSidecars`' position rule.
7. **The floors' overrun.** A scheduled pass may now run past RUN_BUDGET_MS by up to 36 s plus one unit per step. Check the bound against `CARRIER_KILL_S` (600 s), the timer (`OnUnitActiveSec=2min`, which never starts a second instance while one runs) and the §9.3 floor's one-run headroom (the floors charge bytes the steps READ; a step's writes are index rows).
8. **A walk none of whose names can reach the link** (pinned: Task 3's deleted-beside-over-the-cap case, its twin with a directory named like a sidecar, its failed-lstat case and its idle-walk case). A name whose sidecar is too large or not a regular file, or whose lstat fails, is left out of `unseenOf`, so no walk takes it and none waits for it; a name admission refuses can still sit in a walk, and the idle-walk rule retires that walk after a visit of its group that advanced no row. Check that the retirement never fires on a visit a budget cut or a stop (the floor, history-off) ended (a cut walk is still making progress), that it DOES fire on a visit that met a fs fault (a fault on another name of the group must not keep the walk, or a sidecar that faults on every pass would defer its uuid's new names for as long as it faults; no case pins this arm), that it keeps `done`, that a failed lstat in `unseenOf` is never counted as a fault, and that a sidecar that GROWS past the cap while its name is in a walk in progress is left out at once (its lstat is the next call's).

## Not in this plan

- **The belt's node step inside D-4344's slice** (defect item 3). `beltNodesStep` shares the slice that `reindexForValues` and `rederiveFts` take first, so it gets nothing while a re-derivation generation runs. It runs once the generation completes, because `rederiveFts` then returns idle at once. Giving it a floor inside the slice would change D-4344's slice and the F2-pinned lines, and would re-order security work (re-indexing blobs before re-redacting nodes). That is the operator's ruling to make. Listed under Later for the coordinator.
- **The `sidecars_unseen` figure in `status`.** The sweep stamps it (D-6938); showing it needs a new envelope field, and §8.3 pins every field of every `--json` answer. Later, with that reason.
- **`exportStep` keeps the full run budget.** Its held line names the run's limits (`heldLine(RUN_BUDGET_MS, RUN_BUDGET_BYTES)`, pinned), and the sole-copy export outranks the census. On the hourly export pass (about 1 pass in 30) the export can spend what the ceilings leave, and the census then runs on its floor alone (D-6939), inside the overrun bound. Named residual.
- **The rederive slice comes out of ingest's ceiling** (P23). The slice (up to 20 s and 128 MiB, `REDERIVE_SLICE_*`, charged to the run too) and the drain run before ingest, and ingest's ceiling is measured from the run's start. While a re-derivation generation is open, ingest has about 30 s and 179 MiB of its 54 s and 307 MiB. Named residual; Task 6's sidecar threshold is set from that figure.
- **A wrap's length under a cold cache.** Discovery is bounded and resumed (D-6938), but one wrap still lists about 135,000 entries across 19 homes; under a cold cache that wrap spans more passes. Named residual; Task 6 measures the wrap.
- **The scheduled path does not drain the sidecar backlog fast.** On a scheduled tick each new sidecar is redacted and FTS-indexed inline (`ctx.fts` is true), about 20 ms of CPU per 70 KB (3.5 MB/s) over its indexed window, the first 512 KB plus a 64 KB margin, and the unit gets 0.1-0.17 of a core under load (measured on the fleet box, under the shipped unit's Nice=19 and idle I/O class and a LOCAL drop-in's CPUWeight=10, `ccd-history-sweep.service.d/60-cpu-weight.conf`, which is not shipped): about 70-150 sidecars a pass, so the about 126,000 owed take 1.2-2.5 days, up to about 4.5 with a re-derivation generation open. The floors make every step move; they cannot make this one fast. The fast path is the operator's `--op import --apply` from a transient unit at default priority, whose ingest never indexes inline: 30-90 min, then about a day of FTS backfill on the scheduled ticks (Task 6, the coordinator's step 4). Making the scheduled path itself fast (leaving a scheduled sidecar's index to the FTS backfill, or a larger CPU share for the unit) changes the ingest's contract or the unit, the operator's to rule on. Named residual, and Later.
- **Charging CPU instead of wall clock.** Out of scope (the spec says wall clock). The shipped unit sets MemoryMax=1G (its memory bound), Nice=19 and IOSchedulingClass=idle, and no CPUWeight; on the fleet box a LOCAL drop-in (`ccd-history-sweep.service.d/60-cpu-weight.conf`, not shipped) adds CPUWeight=10. Under those, 90 s of wall clock is about 9-15 s of CPU under load (0.1-0.17 of a core, measured on the fleet box).

---

### Task 1: one walk over the rows asks every name at once (D-6930)

**Files:**
- Modify: `ccd/history/lib.mjs`: add `sidecarNameMatcher` directly after `linkSidecar` (about :3560-:3568, ending before `/** How one secret-bearing file is read`).
- Modify: `ccd/history/lib.d.mts`: declare it after `linkSidecar` (about :377).
- Modify: `ccd/history/sweep.mjs`:
  - lib's import list (:43-:73): add `sidecarNameMatcher` beside `linkSidecar`;
  - `sideStmts`' `toolResults` statement (:5332-:5333): add `AND e.entry_id > ?`;
  - `toolResultCandidates` (:5379-:5413, its doc comment included).
- Test: append to `server/test/history-lib.test.ts`; append the CP39 kit and a describe to `server/test/history-ingest.test.ts`.

**Interfaces:**

```js
/** lib.mjs. CP-39 (D-6930): every asked name a text holds, found in ONE pass over the text, however many names are
 *  asked. An Aho-Corasick automaton over the names' UTF-16 units: `namesIn(text)` answers exactly the names n for
 *  which `text.includes(n)` is true, in the order the names were first given, each once, at O(text + hits) per call
 *  (no per-call allocation sized to the name list). `states` counts the automaton's states (at most one per name
 *  unit, plus the root). A directory entry is never empty, so an empty name is not asked. */
export function sidecarNameMatcher(names) /* -> { namesIn(text: string): string[], states: number } */;
```

```js
/** sweep.mjs. `walk`, when given: { budget, after, advanced, complete }. Rows with entry_id > walk.after only.
 *  Before each row, budgetLeft(walk.budget); a spent budget sets complete = false and returns what it has. Every row
 *  the walk takes moves walk.after to it and counts in walk.advanced, decoded or passed over (an over-cap or
 *  undecodable blob), and its compressed bytes are charged to walk.budget. The iterator's end, and only it, sets
 *  complete = true. Without `walk` it is today's function exactly: from the first row, no budget. */
export function toolResultCandidates(db, transcriptPk, names, walk = null);
```

- [ ] **Step 0: check the base.** `git -C . grep -n "export function linkSidecar" origin/main -- ccd/history/lib.mjs` shows :3560. `grep -n "toolResults: db.prepare" ccd/history/sweep.mjs` shows :5332. `grep -n "export function toolResultCandidates" ccd/history/sweep.mjs` shows :5388. Stop if any has moved.

- [ ] **Step 1: write the lib cases (red).** Append to `server/test/history-lib.test.ts`:

```ts
describe('CP-39 Task 1: sidecarNameMatcher answers every asked name a text holds, in one pass (D-6930)', () => {
  it('answers exactly what String.prototype.includes answers, in the order asked, each once', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    const astral = String.fromCharCode(0xd83d, 0xde00);
    const names = ['data.txt', 'a.txt', 'toolu_01EEE.json', 'zz-orphan.txt', 'ata.t', 'b7k2q9z1x.txt', 'aaa', 'aa', `${astral}x`];
    const texts = [
      'saved to: /home/u/x/tool-results/data.txt',
      'Output too large. Full output saved to: /home/u/x/tool-results/b7k2q9z1x.txt and aaaa',
      'names toolu_01EEE.json twice toolu_01EEE.json',
      '', 'no name here', 'a.tx', `${astral}a.txt ${astral}x`, `${String.fromCharCode(0xd83d)}x`,
    ];
    const m = lib.sidecarNameMatcher(names);
    for (const t of texts) expect(m.namesIn(t), JSON.stringify(t)).toEqual(names.filter((n) => t.includes(n)));
  });
  it('agrees with includes over 400 generated texts and 60 generated, overlapping names', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    let x = 0x39;
    const rnd = (k: number): number => { x = (x * 1103515245 + 12345) % 2147483648; return x % k; };
    const word = (len: number): string => Array.from({ length: len }, () => 'ab.t'[rnd(4)]).join('');
    const names = Array.from({ length: 60 }, () => word(1 + rnd(5)));
    const m = lib.sidecarNameMatcher(names);
    const asked = [...new Set(names)];
    for (let i = 0; i < 400; i += 1) {
      const t = word(rnd(80));
      expect(m.namesIn(t), t).toEqual(asked.filter((n) => t.includes(n)));
    }
  });
  it('holds at most one state per name unit plus the root, and a duplicate name is answered once', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    const names = ['out1.txt', 'out10.txt', 'out1.txt', 'toolu_01A.json'];
    const m = lib.sidecarNameMatcher(names);
    expect(m.states).toBeLessThanOrEqual(1 + [...new Set(names)].reduce((n, s) => n + s.length, 0));
    expect(m.namesIn('…/tool-results/out10.txt and …/out1.txt')).toEqual(['out1.txt', 'out10.txt']);
  });
});
```

Run `(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'CP-39 Task 1')`. Predicted: 3 failed, each `lib.sidecarNameMatcher is not a function`.

- [ ] **Step 2: write the CP39 kit and the walk cases (red).** Append to `server/test/history-ingest.test.ts`, first the kit Tasks 1 to 4 share, then the describe. The kit's counters observe the work from OUTSIDE the code under test (P14): row decodes through `node:zlib`'s default export patched and carried to store.mjs's named `brotliDecompressSync` import by `syncBuiltinESMExports`; a sidecar's bytes being read through `node:fs`'s default `readSync`, as the FR2-d describe's `failReads` does; and `String.prototype.includes` asked an asked name, wrapped for the call.

```ts
// ── CP-39: the kit Tasks 1-4 share: the fixture rows, and counters that observe the work from outside the code under test ──
interface Cp39Walk { budget: IxBudget; after: number; advanced: number; complete: boolean }
const CP39 = (() => {
  const ROWS = 30;
  /** One plain user row, then ROWS tool_result rows; row k's text names tool-results/out<k>.txt and answers toolu_cp39<k>. */
  const rows = (): string => {
    const out: IxRow[] = [IX.user(IX.uuidN(1), null, 'go', 1)];
    for (let k = 1; k <= ROWS; k += 1) {
      const id = `toolu_cp39${String(k).padStart(3, '0')}`;
      out.push(IX.assistant(IX.uuidN(100 + k), IX.uuidN(k === 1 ? 1 : 200 + k - 1), [{ type: 'tool_use', id, name: 'Bash', input: { command: 'make' } }], 2 * k));
      out.push(IX.user(IX.uuidN(200 + k), IX.uuidN(100 + k), [{ type: 'tool_result', tool_use_id: id, content: `saved to: /home/u/x/tool-results/out${k}.txt` }], 2 * k + 1));
    }
    return IX.jsonl(out);
  };
  const names = (n = 40): string[] => Array.from({ length: n }, (_, i) => `out${i + 1}.txt`);
  const sideDir = (home: string, uuid = IX.U): string => {
    const d = path.join(home, 'projects', IX.SLUG, uuid, 'tool-results');
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const pkOf = (db: DatabaseSync, uuid = IX.U): number =>
    (db.prepare('SELECT transcript_pk AS pk FROM transcripts WHERE cc_session_uuid = ?').get(uuid) as { pk: number }).pk;
  const userIds = (db: DatabaseSync, pk: number): number[] =>
    (db.prepare("SELECT entry_id FROM entries WHERE transcript_pk = ? AND type = 'user' ORDER BY entry_id").all(pk) as { entry_id: number }[]).map((r) => r.entry_id);
  const walkOf = (budget: IxBudget, after = 0): Cp39Walk => ({ budget, after, advanced: 0, complete: false });
  /** Successful row decodes, counted outside the walk: a decode that throws (an undecodable blob) is not counted. */
  const countDecodes = async (): Promise<{ n: () => number; restore: () => void }> => {
    const zlib = (await import('node:zlib')).default;
    const real = zlib.brotliDecompressSync;
    let n = 0;
    (zlib as { brotliDecompressSync: unknown }).brotliDecompressSync = function brotliDecompressSync(...a: unknown[]): unknown {
      const out = (real as (...x: unknown[]) => unknown)(...a);
      n += 1;
      return out;
    };
    syncBuiltinESMExports();
    return { n: () => n, restore: () => { (zlib as { brotliDecompressSync: unknown }).brotliDecompressSync = real; syncBuiltinESMExports(); } };
  };
  /** String.prototype.includes calls whose search string is one of `asked`, for the call only. */
  const countIncludes = (asked: readonly string[]): { n: () => number; restore: () => void } => {
    const real = String.prototype.includes;
    const want = new Set(asked);
    let n = 0;
    String.prototype.includes = function includes(this: string, s: string, at?: number): boolean {
      if (want.has(s)) n += 1;
      return real.call(this, s, at);
    };
    return { n: () => n, restore: () => { String.prototype.includes = real; } };
  };
  /** readSync calls on a descriptor whose file lies under `dir`: a sidecar's bytes being read. */
  const countReads = (dir: string): { n: () => number; restore: () => void } => {
    const real = fs.readSync;
    const under = `${fs.realpathSync(dir)}/`;
    let n = 0;
    (fs as { readSync: unknown }).readSync = function readSync(fd: number, ...rest: unknown[]): number {
      if (fs.readlinkSync(`/proc/self/fd/${fd}`).startsWith(under)) n += 1;
      return (real as (...a: unknown[]) => number)(fd, ...rest);
    };
    syncBuiltinESMExports();
    return { n: () => n, restore: () => { (fs as { readSync: unknown }).readSync = real; syncBuiltinESMExports(); } };
  };
  /** The persisted walk state of `pk`, parsed here (never by the code under test), or null. */
  const walkState = (db: DatabaseSync, pk: number): { v: number; done: { names: string[] }; walk: { names: string[]; after: number } | null } | null => {
    const v = (db.prepare('SELECT v FROM meta WHERE k = ?').get(`sidecar_walk:${pk}`) as { v: string } | undefined)?.v;
    return v === undefined ? null : JSON.parse(v);
  };
  const sidecarRows = (db: DatabaseSync): { name: string; uuid: string | null }[] =>
    (db.prepare(`SELECT s.name AS name, e.uuid AS uuid FROM sidecars s LEFT JOIN entries e ON e.entry_id = s.entry_id
      ORDER BY s.name, s.blob_id`).all() as { name: string; uuid: string | null }[]).map((r) => ({ name: r.name, uuid: r.uuid }));
  /** What every out<k>.txt of `ks` links to, in sidecarRows' order (SQLite's BINARY order is the default sort's here). */
  const linked = (ks: number[]): { name: string; uuid: string }[] =>
    ks.map((k) => ({ k, name: `out${k}.txt` })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(({ k, name }) => ({ name, uuid: IX.uuidN(200 + k) }));
  const upTo = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);
  return { ROWS, rows, names, sideDir, pkOf, userIds, walkOf, countDecodes, countIncludes, countReads, walkState, sidecarRows, linked, upTo };
})();

describe('CP-39 Task 1: the link walk decodes each row once and asks every name at once (D-6930)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  interface Cand { entryId: number; text: string; toolUseIds: string[] }
  interface T1 { toolResultCandidates(db: DatabaseSync, pk: number, names: Iterable<string>, walk?: Cp39Walk): Cand[] }
  const names = CP39.names();
  /** A store holding CP39's rows, ingested; answers the store, the transcript's pk and its user rows' ids. */
  const ingested = async (prefix: string): Promise<{ S: IxSweep & T1; db: DatabaseSync; pk: number; ids: number[] }> => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as IxSweep & T1;
    const box = IX.newBox(prefix);
    IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    const { db, ids } = await IX.openFixtureStore(box);
    await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget());
    const pk = CP39.pkOf(db);
    return { S, db, pk, ids: CP39.userIds(db, pk) };
  };

  it('rows x names: each user row is decoded once and no asked name is tested by includes, however many names are asked', async () => {
    const { S, db, pk, ids } = await ingested('ccrc-hist-cp39-t1a-');
    try {
      const walk = CP39.walkOf(S.newBudget());
      const dec = await CP39.countDecodes();
      const inc = CP39.countIncludes(names);
      let got: Cand[];
      try { got = S.toolResultCandidates(db, pk, names, walk); } finally { inc.restore(); dec.restore(); }
      expect(dec.n(), 'CONTROL: the decode counter sees the walk, once per user row').toBe(CP39.ROWS + 1);
      expect(inc.n(), 'no asked name was tested by String.prototype.includes').toBe(0);
      expect(walk.complete, 'the walk reached the last row').toBe(true);
      expect(walk.advanced, 'the cursor moved past every user row').toBe(CP39.ROWS + 1);
      expect(walk.after, 'the cursor names the last user row').toBe(ids.at(-1));
      expect(got, 'CONTROL: the walk answers what the walk-less call answers').toEqual(S.toolResultCandidates(db, pk, names));
      expect(got.map((c) => c.text)).toEqual(CP39.upTo(CP39.ROWS).map((k) => `out${k}.txt`));
    } finally { db.close(); }
  });

  it('a budget spent inside the walk stops it at a row boundary, and a walk resumed from its cursor decodes only the rest', async () => {
    const { S, db, pk, ids } = await ingested('ccrc-hist-cp39-t1b-');
    const dec = await CP39.countDecodes();
    try {
      // Within the budget until the tenth row decode; spent from then on, whatever else reads the clock.
      const cut = CP39.walkOf(S.newBudget(() => (dec.n() >= 10 ? 10_000 : 0), { maxMs: 1_000 }));
      const first = S.toolResultCandidates(db, pk, names, cut);
      expect(cut.complete, 'the budget ended the walk').toBe(false);
      expect(dec.n(), 'ten rows decoded before the check that failed').toBe(10);
      expect(cut.advanced).toBe(10);
      expect(cut.after, 'the cursor is the tenth user row').toBe(ids[9]);
      const before = dec.n();
      const rest = CP39.walkOf(S.newBudget(), cut.after);
      const second = S.toolResultCandidates(db, pk, names, rest);
      expect(rest.complete).toBe(true);
      expect(dec.n() - before, 'the resumed walk decodes only the rows left').toBe(CP39.ROWS + 1 - 10);
      expect([...first, ...second], 'CONTROL: the two halves are the uncut walk').toEqual(S.toolResultCandidates(db, pk, names));
    } finally { dec.restore(); db.close(); }
  });

  it('a budget spent before the first row takes nothing: the cursor stands, nothing is decoded, the walk is incomplete', async () => {
    const { S, db, pk } = await ingested('ccrc-hist-cp39-t1c-');
    const dec = await CP39.countDecodes();
    try {
      const walk = CP39.walkOf(S.newBudget(() => 0, { maxMs: 0 }));
      expect(S.toolResultCandidates(db, pk, names, walk)).toEqual([]);
      expect(dec.n(), 'nothing decoded').toBe(0);
      expect(walk, 'the cursor stands').toMatchObject({ after: 0, advanced: 0, complete: false });
    } finally { dec.restore(); db.close(); }
  });

  it('an over-cap row and an undecodable row: the cursor moves past both, neither is decoded, and the walk answers the rest', async () => {
    const { S, db, pk, ids } = await ingested('ccrc-hist-cp39-t1d-');
    const { lib } = await IX.api();
    const blobOf = (entryId: number): number => (db.prepare('SELECT blob_id AS b FROM entries WHERE entry_id = ?').get(entryId) as { b: number }).b;
    // As the D-4346 cases plant them: ids[3] answers out3.txt, ids[4] answers out4.txt.
    db.prepare('UPDATE blobs SET raw_len = ? WHERE blob_id = ?').run(lib.BLOB_DECODE_MAX + 1, blobOf(ids[3]!));   // over the cap: never decoded
    db.prepare('UPDATE blobs SET raw_len = 1 WHERE blob_id = ?').run(blobOf(ids[4]!));                          // undecodable: its decode throws
    const dec = await CP39.countDecodes();
    try {
      const walk = CP39.walkOf(S.newBudget());
      const got = S.toolResultCandidates(db, pk, names, walk);
      expect(walk.complete).toBe(true);
      expect(walk.advanced, 'the cursor moved past every row, the two passed over included').toBe(CP39.ROWS + 1);
      expect(walk.after).toBe(ids.at(-1));
      expect(dec.n(), 'neither passed-over row was decoded').toBe(CP39.ROWS + 1 - 2);
      expect(got.map((c) => c.text), 'the two passed-over rows name nothing').toEqual(CP39.upTo(CP39.ROWS).filter((k) => k !== 3 && k !== 4).map((k) => `out${k}.txt`));
    } finally { dec.restore(); db.close(); }
  });

  it('complete only when the rows ran out: a budget spent right after the last row still completes; one spent before it does not', async () => {
    const { S, db, pk, ids } = await ingested('ccrc-hist-cp39-t1e-');
    const dec = await CP39.countDecodes();
    try {
      const all = CP39.ROWS + 1;
      const atEnd = CP39.walkOf(S.newBudget(() => (dec.n() >= all ? 10_000 : 0), { maxMs: 1_000 }));
      S.toolResultCandidates(db, pk, names, atEnd);
      expect(atEnd.complete, 'the iterator ended: no check after the last row').toBe(true);
      const base = dec.n();
      const short = CP39.walkOf(S.newBudget(() => (dec.n() - base >= all - 1 ? 10_000 : 0), { maxMs: 1_000 }));
      S.toolResultCandidates(db, pk, names, short);
      expect(short.complete, 'a check that failed before the last row').toBe(false);
      expect(short.after).toBe(ids.at(-2));
    } finally { dec.restore(); db.close(); }
  });
});
```

Run first the counters' CONTROL on the base, alone: `(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts -t 'rows x names')`. Predicted on the base: its first line, the decode counter's CONTROL, green (`dec.n()` is 31: the base decodes each user row once too), then red at 'no asked name was tested by String.prototype.includes' (`expected 1200 to be 0`: 30 tool_result rows times 40 names), which shows the includes counter sees the old loop. Then `-t 'CP-39 Task 1'`. Predicted: 5 failed. Today's function ignores the fourth argument, so the walk object is never written:
  - (a) as above;
  - (b) passes 'the budget ended the walk' (the field keeps its initial `false`) and fails at 'ten rows decoded before the check that failed' (`expected 31 to be 10`: the base checks no budget);
  - (c) at `toEqual([])` (the base answers every candidate);
  - (d) at `walk.complete` (`expected false to be true`);
  - (e) at 'the iterator ended' (`expected false to be true`).
  Record what is measured.

- [ ] **Step 3: implement `sidecarNameMatcher` in lib.mjs.** After `linkSidecar`:

```js
/** CP-39 (D-6930): every asked name a text holds, in ONE pass over the text however many names are asked (the walk asked
 *  `text.includes(name)` once per wanted name, rows x names, and one transcript of 24,450 user rows and about 6,270 unlinked
 *  sidecars cost about 4 minutes of CPU per pass). Aho-Corasick over UTF-16 units, so the answer is exactly includes'
 *  answer: the names n with text.includes(n), in the order first given, each once. namesIn costs O(text + hits): its
 *  stamp array is the matcher's, made once, never one sized to the names per call (P20). A directory entry is never empty. */
export function sidecarNameMatcher(names) {
  const list = [...new Set(names)].filter((n) => typeof n === 'string' && n.length > 0);
  const next = new Map();           // state * 65536 + unit -> state
  const unit = [0];                 // the unit that enters each state
  const kid = [-1];                 // each state's first child; `sib` links the rest, for the breadth-first pass
  const sib = [-1];
  const fail = [0];
  const term = [-1];                // the name index ending exactly here, or -1
  const dict = [-1];                // the nearest proper suffix state that ends a name, or -1
  list.forEach((n, i) => {
    let s = 0;
    for (let k = 0; k < n.length; k += 1) {
      const key = s * 65536 + n.charCodeAt(k);
      let t = next.get(key);
      if (t === undefined) {
        t = fail.length;
        next.set(key, t);
        sib.push(kid[s]); kid[s] = t; kid.push(-1);
        unit.push(n.charCodeAt(k)); fail.push(0); term.push(-1); dict.push(-1);
      }
      s = t;
    }
    term[s] = i;
  });
  const step = (s0, u) => {
    for (let s = s0; ; s = fail[s]) {
      const t = next.get(s * 65536 + u);
      if (t !== undefined) return t;
      if (s === 0) return 0;
    }
  };
  const queue = [];
  for (let t = kid[0]; t !== -1; t = sib[t]) queue.push(t);
  for (let qi = 0; qi < queue.length; qi += 1) {
    const s = queue[qi];
    for (let t = kid[s]; t !== -1; t = sib[t]) {
      const f = step(fail[s], unit[t]);
      fail[t] = f;
      dict[t] = term[f] >= 0 ? f : dict[f];
      queue.push(t);
    }
  }
  const seen = new Uint32Array(list.length);
  let stamp = 0;
  const namesIn = (text) => {
    if (stamp === 0xffffffff) { seen.fill(0); stamp = 0; }
    stamp += 1;
    const hits = [];
    let s = 0;
    for (let k = 0; k < text.length; k += 1) {
      s = step(s, text.charCodeAt(k));
      for (let o = term[s] >= 0 ? s : dict[s]; o !== -1; o = dict[o]) {
        const i = term[o];
        if (seen[i] !== stamp) { seen[i] = stamp; hits.push(i); }
      }
    }
    hits.sort((a, b) => a - b);
    return hits.map((i) => list[i]);
  };
  return { namesIn, states: fail.length };
}
```

The queue starts from the root's children, whose `fail` is 0. For a deeper child, `fail[s]` is shallower than `s`, so `step` never returns the child itself. Measured in scratch on Node 24.14.1, this code: 0 mismatches against `includes` in about 150,000 generated cases; at `SIDECAR_WALK_CHARS_MAX` (2,097 names of 250 units) about 517,000 states, 49 MiB of heap, built in about 0.5 s; 24,450 calls on a 2-character text in 3 ms. Declare it in `lib.d.mts` after `linkSidecar`:

```ts
export function sidecarNameMatcher(names: Iterable<string>): { namesIn(text: string): string[]; states: number };
```

Run Step 1's command. Predicted: 3 passed.

- [ ] **Step 4: implement the walk in sweep.mjs.**
  - Statement (:5332): `WHERE e.transcript_pk = ? AND e.entry_id > ? AND e.type = 'user' AND b.z IS NOT NULL ORDER BY e.entry_id`. The `SELECT` and `raw_len` are unchanged.
  - Body (replace :5388-:5413; the doc comment gains one sentence naming the walk and D-6930):

```js
export function toolResultCandidates(db, transcriptPk, names, walk = null) {
  const asked = [...names];
  const stems = new Set();
  for (const n of asked) {
    const stem = n.replace(/\.[^.]*$/, '');
    if (stem.startsWith('toolu_')) stems.add(stem);
  }
  // CP-39 (D-6930): one pass of one automaton over each row's text, never one includes per asked name.
  const matcher = sidecarNameMatcher(asked);
  const out = [];
  for (const r of sideStmts(db).toolResults.iterate(transcriptPk, walk === null ? 0 : walk.after)) {
    if (walk !== null) {
      if (!budgetLeft(walk.budget)) { walk.complete = false; return out; }
      // D-6930: the cursor moves past every row the walk takes, decoded or passed over, and its compressed bytes are charged.
      walk.after = r.entry_id;
      walk.advanced += 1;
      walk.budget.bytes += r.z.length;
    }
    // D-4346: ENTRY_UPSERT promotes a collided entry's type to 'user' but keeps its first blob_id, so this entry's current blob can be a
    // raw-only line-too-long blob of unbounded raw_len; it is never decompressed whole, and names no sidecar.
    if (blobOverDecodeCap(r.raw_len)) continue;
    let body;
    try { body = parseStoredJson(unbrotli(r.z, r.raw_len)); } catch { continue; }
    const ids = toolResultIdsOf(body);
    if (ids.length === 0) continue;
    const text = ftsTextOf(body, 'entry');
    const named = matcher.namesIn(text);
    const answered = ids.filter((id) => stems.has(id));
    if (named.length > 0 || answered.length > 0) out.push({ entryId: r.entry_id, text: named.join('\0'), toolUseIds: answered });
  }
  if (walk !== null) walk.complete = true;
  return out;
}
```

`budgetLeft` and `newBudget` are defined later in the file, as function declarations, so they are hoisted. `candidatesFor` keeps calling `toolResultCandidates(db, transcriptPk, names)` until Task 2 replaces it.

Run Step 2's command. Predicted: 5 passed. Then run, one per call:
- `(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts -t 'plan task 21')`;
- `-t 'census: every decompression'`;
- `(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'linkSidecar')`.
All are predicted green, unedited.

- [ ] **Step 5: the measured mutations (one per guard, one per call).** Copy `ccd/history/sweep.mjs` to `.superpowers/sdd/cp39/t1/sweep.mjs.orig`. For each, run Step 2's command, record the red title and message, restore with `cp`, then `cmp` (rc 0).
  - **M1a (P14):** replace `const named = matcher.namesIn(text);` with the old loop, and touch nothing else: `const named = []; for (const n of asked) if (text.includes(n)) named.push(n);`. Predicted red: 'rows x names …' at 'no asked name was tested by String.prototype.includes', `expected 1200 to be 0`.
  - **M1b (P18):** move `walk.advanced += 1;` to after the `try` line that decodes (it then counts decoded rows only). Predicted red: 'an over-cap row and an undecodable row …' at 'the cursor moved past every row', `expected 29 to be 31`.
  - **M1c:** replace `if (walk !== null) walk.complete = true;` with `if (walk !== null) walk.complete = budgetLeft(walk.budget);`. Predicted red: 'complete only when the rows ran out …' at 'the iterator ended', `expected false to be true`.
  - **M1d:** move the `if (!budgetLeft(walk.budget)) { … }` line to just after the `try` line that decodes. Predicted red: 'a budget spent before the first row …' at 'nothing decoded', `expected 1 to be 0`.

- [ ] **Step 6: commit.** `cmp` the `.orig` again. Then `git add ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/sweep.mjs server/test/history-lib.test.ts server/test/history-ingest.test.ts` and commit `fix(history-sweep): build the sidecar link index in one walk over the rows (CP-39 Task 1; D-6930)`.

---

### Task 2: a resumable link walk that is never restarted, links known before any read, an import that resumes and counts a walk as progress, and a status that reads no walk (D-6931, D-6932, D-6940)

**Files:**
- Modify: `ccd/history/lib.mjs`: after `sidecarNameMatcher`, add `SIDECAR_WALK_META`, `SIDECAR_WALK_CHARS_MAX`, `walkNames`, `parseSidecarWalk`, `formatSidecarWalk`, `emptySidecarWalk`, `startSidecarWalk`, `foldWalkCandidates`, `finishSidecarWalk` and `walkCandidates`. `ccd/history/lib.d.mts`: their declarations.
- Modify: `ccd/history/sweep.mjs`:
  - lib import: add the ten names above;
  - `candidatesFor` (:5415-:5423): replaced by `linkCandidates` and `unseenOf`;
  - `ingestSidecar` (:5442-:5531): `ensureTranscript` and the link move to before the read; it takes the group in place of the old `cache`;
  - `ingestSidecars` (:5537-:5566): grouping by uuid, `opts.from`, `opts.found`, `walked`, `examined`, `resume`, retiring a walk;
  - `importSidecars` (:6798-:6810): exported; its window budget comes from `ctx.deps.budget`; ONE listing per import, handed to every window; the resume point; the D-6932 end rule.
- Modify: `ccd/history/cli.mjs`: `STATUS_SQL.meta` (:75), and `SIDECAR_WALK_META` added to its first lib import (:36-:40).
- Test: append to `server/test/history-lib.test.ts`, `server/test/history-ingest.test.ts` and `server/test/history-cli.test.ts`.

**Interfaces:**

```js
/** lib.mjs (D-6931). The meta key prefix of a transcript's walk state: one spelling for the sweep that writes it and the
 *  status read that skips it (D-6940). */
export const SIDECAR_WALK_META = 'sidecar_walk:';
/** lib.mjs (D-6931). The most UTF-16 units of names one walk state holds, done and in progress together (chosen):
 *  twice the largest backlog measured on the fleet box (about 6,270 unlinked names, most near 40 units). It bounds the
 *  automaton's states (about 517,000 at the cap, 49 MiB of heap, measured in scratch) and the persisted state, so a
 *  walk's memory stays inside O20's RSS bound (pinned by Task 2's RSS case, P22). */
export const SIDECAR_WALK_CHARS_MAX = 524_288;
/** The names an extension walk takes: `unseen` less `covered`, each once; `first` (the name that asked) always, then the
 *  rest in sorted order while their units fit `room`; answered sorted. */
export function walkNames(unseen, first, covered = [], room = SIDECAR_WALK_CHARS_MAX) /* -> string[] */;
/** A transcript's walk state, meta `sidecar_walk:<transcript_pk>`:
 *  {"v":1,"done":{"names":[…],"text":[[name,entryId]…],"toolu":[[stem,entryId]…]},
 *         "walk":null|{"names":[…],"after":<int>,"text":[…],"toolu":[…]}}.
 *  `done` holds the names finished walks cover, with their first matches; `walk` is the extension in progress, over
 *  names `done` does not hold. Pairs, never object keys, so no file name can reach a prototype. Anything else, or a
 *  malformed field (a name in both parts, a duplicate, a pair for a name or stem its part does not hold, an entry id
 *  that is not a positive integer, an `after` that is not a non-negative one, a text over 64 MiB), is null: the walk
 *  starts again from row 0, which costs work and loses nothing. */
export function parseSidecarWalk(text) /* -> WalkState | null */;
export function formatSidecarWalk(state) /* -> string; keys in the order v, done, walk */;
export function emptySidecarWalk() /* -> WalkState with nothing done and no walk */;
/** Starts an extension walk at row 0 over walkNames(unseen, first, done.names, room). First it prunes from `done` every
 *  name not in `unseen` (that sidecar is seen, its link decided) with its pairs, so `room` is SIDECAR_WALK_CHARS_MAX less
 *  the units `done` keeps. */
export function startSidecarWalk(state, unseen, first) /* -> void */;
/** Folds toolResultCandidates' candidates (in entry order) into the walk in progress: a name or stem it already holds
 *  keeps its entry. */
export function foldWalkCandidates(state, candidates) /* -> void */;
/** Merges the finished walk into `done` (a name or stem `done` already holds keeps its entry) and clears `walk`. */
export function finishSidecarWalk(state) /* -> void */;
/** For a name `done` holds, the candidates linkSidecar reads: the first text match, then the first toolu match of its
 *  stem, each only when held, so linkSidecar answers what it answers over the full candidate list. */
export function walkCandidates(state, name) /* -> Candidate[] */;
```

```js
/** sweep.mjs (D-6931). The link candidates for sidecar `s` of group `g` (one uuid's sidecars this call). The transcript's
 *  walk state is parsed ONCE per call, on the group's first need, and cached on `g` (P10); every advance updates it in
 *  place and writes it through to meta in one NORMAL transaction; nothing else writes it. Answers {ready: true, candidates},
 *  {ready: false} (the budget ended the walk), or {ready: false, deferred: true} (a walk in progress covers other names
 *  still unseen; this one waits for it). */
function linkCandidates(db, g, transcriptPk, s, budget);
/** The names of g's sidecars whose (size, mtime_ns) has no sidecar_seen row, lstat'd once per call and cached on `g`. */
function unseenOf(db, g);
/** ingestSidecars' result gains, each spread only when it carries something: `walked: <rows the walks' cursors moved past>`
 *  (above 0), `examined: <sidecars examined, seen or new; a deferred one is not>` (above 0) and `resume: <the path of the
 *  last sidecar examined>`. `opts.from` (an import window's resume point) skips the sidecars up to and including that path
 *  in this call's order. `opts.found` (the import's one listing, in discoverSidecars' shape and order) is taken as this
 *  call's found sidecars, less those of the uuids notCaughtUp holds back, and the call lists nothing. */
export async function ingestSidecars(db, ctx, budget, uuids, opts = {});
/** Exported for its in-process cases; `ctx.deps.budget` limits each window (tests only), as passCtx's does. It lists the
 *  sidecars ONCE per import and hands the list to every window (D-6932). */
export async function importSidecars(db, ctx, uuids);
```

- [ ] **Step 0: check the base and Task 1.** `grep -n "^function candidatesFor\|^export async function ingestSidecar\b\|^async function importSidecars" ccd/history/sweep.mjs` shows three lines. `grep -n "export function sidecarNameMatcher" ccd/history/lib.mjs` shows one. `grep -n "ingestSidecar(" ccd/history/sweep.mjs server/test/*.ts` shows only `ingestSidecars`' call. `grep -n "meta: 'SELECT k, v FROM meta'," ccd/history/cli.mjs` shows :75. Stop otherwise.

- [ ] **Step 1: the lib cases (red).** Append to `history-lib.test.ts`:

```ts
describe('CP-39 Task 2: the walk state, its extension and its first-match fold (D-6931)', () => {
  type Pair = [string, number];
  interface Part { names: string[]; text: Pair[]; toolu: Pair[] }
  interface State { v: 1; done: Part; walk: (Part & { after: number }) | null }
  const state = (over: Partial<State> = {}): State => ({ v: 1, done: { names: [], text: [], toolu: [] }, walk: null, ...over });

  it('round-trips, with pairs and never object keys', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    const s = state({
      done: { names: ['__proto__', 'a name.txt', 'toolu_01A.json'], text: [['__proto__', 3], ['a name.txt', 3]], toolu: [['toolu_01A', 5]] },
      walk: { names: ['late.txt'], after: 2 ** 31, text: [], toolu: [] },
    });
    expect(lib.parseSidecarWalk(lib.formatSidecarWalk(s))).toEqual(s);
    expect(lib.parseSidecarWalk(lib.formatSidecarWalk(state({ walk: { names: ['x.txt'], after: 0, text: [], toolu: [] } })))?.walk?.after).toBe(0);
    expect(lib.formatSidecarWalk(lib.emptySidecarWalk()), 'the empty state, keys in order').toBe('{"v":1,"done":{"names":[],"text":[],"toolu":[]},"walk":null}');
  });

  it('anything malformed is null, so the walk starts again from row 0', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    const ok = state({ done: { names: ['a.txt'], text: [['a.txt', 3]], toolu: [] }, walk: { names: ['b.txt'], after: 7, text: [], toolu: [] } });
    expect(lib.parseSidecarWalk(JSON.stringify(ok)), 'CONTROL: a well-formed state parses').toEqual(ok);
    const w = ok.walk!;
    const bad: unknown[] = [
      '', '{}', 'not json', { ...ok, v: 2 },
      { ...ok, walk: { ...w, after: -1 } }, { ...ok, walk: { ...w, after: 1.5 } }, { ...ok, walk: { ...w, after: '7' } },
      { ...ok, done: { ...ok.done, names: 'a.txt' } }, { ...ok, done: { ...ok.done, names: [7] } },
      { ...ok, done: { ...ok.done, text: [['a.txt']] } }, { ...ok, done: { ...ok.done, text: [['a.txt', 0]] } },
      { ...ok, done: { ...ok.done, names: ['a.txt', 'a.txt'] } },
      { ...ok, walk: { ...w, names: ['a.txt'] } },                     // a name both parts hold
      { ...ok, done: { ...ok.done, text: [['zz.txt', 3]] } },          // a pair for a name its part does not hold
      { ...ok, done: { ...ok.done, toolu: [['toolu_01Z', 3]] } },      // a stem no name of its part has
    ];
    for (const b of bad) expect(lib.parseSidecarWalk(typeof b === 'string' ? b : JSON.stringify(b)), JSON.stringify(b)).toBeNull();
    expect(lib.parseSidecarWalk(`{"v":1,"done":{"names":["${'q'.repeat(64 * 1024 * 1024)}"],"text":[],"toolu":[]},"walk":null}`), 'over 64 MiB, refused before parsing').toBeNull();
  });

  it('the fold keeps the first entry; finishing merges into done, which keeps its entry for a stem both parts hold', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    const s = state({ done: { names: ['toolu_01A.json'], text: [], toolu: [['toolu_01A', 2]] }, walk: { names: ['a.txt', 'data.txt', 'toolu_01A.txt'], after: 0, text: [], toolu: [] } });
    lib.foldWalkCandidates(s, [
      { entryId: 3, text: 'data.txt\0a.txt', toolUseIds: ['toolu_01A'] },
      { entryId: 5, text: 'a.txt', toolUseIds: ['toolu_01A'] },
    ]);
    expect(s.walk).toMatchObject({ text: [['data.txt', 3], ['a.txt', 3]], toolu: [['toolu_01A', 3]] });
    lib.finishSidecarWalk(s);
    expect(s.walk).toBeNull();
    expect([...s.done.names].sort()).toEqual(['a.txt', 'data.txt', 'toolu_01A.json', 'toolu_01A.txt']);
    expect(s.done.toolu, 'done keeps its own entry for the shared stem').toEqual([['toolu_01A', 2]]);
  });

  it('walkCandidates offers linkSidecar what it would pick from the full candidate list', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    const full = [
      { entryId: 2, text: '', toolUseIds: ['toolu_01A'] },              // answers toolu_01A
      { entryId: 3, text: 'data.txt\0a.txt', toolUseIds: [] },
      { entryId: 4, text: 'toolu_01A.json', toolUseIds: [] },           // names toolu_01A.json AFTER the row that answers it
      { entryId: 6, text: 'a.txt', toolUseIds: ['toolu_01Z'] },
    ];
    const names = ['a.txt', 'data.txt', 'toolu_01A.json', 'toolu_01Z.txt', 'zz.txt'];
    const s = state({ walk: { names, after: 0, text: [], toolu: [] } });
    lib.foldWalkCandidates(s, full);
    lib.finishSidecarWalk(s);
    for (const n of names) expect(lib.linkSidecar(n, lib.walkCandidates(s, n)), n).toBe(lib.linkSidecar(n, full));
  });

  it('walkNames: the uncovered unseen names, sorted, each once, within the room, and always the name that asked', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.walkNames(['c.txt', 'a.txt', 'c.txt', 'b.txt'], 'c.txt', ['b.txt'])).toEqual(['a.txt', 'c.txt']);
    const big = Array.from({ length: 600 }, (_, i) => `${String(i).padStart(4, '0')}${'q'.repeat(996)}`);   // 1,000 units each
    expect(lib.walkNames(big, big[0]!), '524 names of 1,000 units fit 524,288').toHaveLength(524);
    const huge = 'h'.repeat(lib.SIDECAR_WALK_CHARS_MAX + 1);
    expect(lib.walkNames([huge, 'a.txt'], huge), 'the asking name alone, over the room').toEqual([huge]);
  });

  it('startSidecarWalk prunes done to the names still unseen and starts an extension at row 0 over the uncovered ones', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    const s = state({ done: { names: ['a.txt', 'b.txt', 'toolu_01A.json'], text: [['a.txt', 3], ['b.txt', 4]], toolu: [['toolu_01A', 2]] } });
    lib.startSidecarWalk(s, new Set(['b.txt', 'late.txt', 'later.txt']), 'late.txt');
    expect(s.done, "a seen name's pairs go; an unseen covered name keeps its state").toEqual({ names: ['b.txt'], text: [['b.txt', 4]], toolu: [] });
    expect(s.walk).toEqual({ names: ['late.txt', 'later.txt'], after: 0, text: [], toolu: [] });
  });
});
```

  Run `(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'CP-39 Task 2')`. Predicted: 6 red, each on `is not a function` (or `undefined` for `SIDECAR_WALK_CHARS_MAX`).

- [ ] **Step 2: the ingest cases (red).** Append to `history-ingest.test.ts` (after Task 1's describe; the CP39 kit is in scope):

```ts
describe('CP-39 Task 2: the link walk keeps its place across passes and is never restarted (D-6931, D-6932)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  interface T2 {
    ingestSidecars(db: DatabaseSync, ctx: IxCtx, b: IxBudget, uuids: Iterable<string>, opts?: { from?: string | null }): Promise<Record<string, unknown> & { bytes: number; complete: boolean }>;
    importSidecars(db: DatabaseSync, ctx: Record<string, unknown>, uuids: string[]): Promise<string>;
  }
  type S2 = Omit<IxSweep, 'ingestSidecars'> & T2;
  const PLENTY = async (): Promise<{ bsize: number; bavail: number; blocks: number }> => ({ bsize: 1, bavail: 4 * 2 ** 40, blocks: 8 * 2 ** 40 });
  /** CP39's transcript ingested by the transcript half alone (a one-byte budget: the sidecar half then takes nothing),
   *  and its ROWS sidecars out<k>.txt on disk, bodies distinct. */
  const fixture = async (prefix: string) => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as S2;
    const box = IX.newBox(prefix);
    const p = IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    const dir = CP39.sideDir(box.homes[0]!);
    for (let k = 1; k <= CP39.ROWS; k += 1) fs.writeFileSync(path.join(dir, `out${k}.txt`), `body ${k}\n`);
    const { db, ids } = await IX.openFixtureStore(box);
    await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget(Date.now, { maxBytes: 1 }));
    expect(IX.count(db, 'sidecar_seen'), 'CONTROL: the transcript only').toBe(0);
    const ctx = S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids);
    const pk = CP39.pkOf(db);
    return { S, box, p, dir, db, ids, ctx, pk, rowIds: CP39.userIds(db, pk) };
  };
  const lateRow = (): string => IX.jsonl([IX.user(IX.uuidN(400), IX.uuidN(200 + CP39.ROWS), [{ type: 'tool_result', tool_use_id: 'toolu_cp39late', content: 'saved to: /home/u/x/tool-results/late.txt' }], 400)]);
  const walkRows = (db: DatabaseSync): number => IX.count(db, 'meta', "k LIKE 'sidecar\\_walk:%' ESCAPE '\\'");
  /** tool-results/ listings, counted outside the sweep: node:fs's DEFAULT readdirSync patched, carried to sweep.mjs by
   *  syncBuiltinESMExports. */
  const countListings = (): { n: () => number; restore: () => void } => {
    const real = fs.readdirSync;
    let n = 0;
    (fs as { readdirSync: unknown }).readdirSync = function readdirSync(p: unknown, ...rest: unknown[]): unknown {
      if (String(p).endsWith('/tool-results')) n += 1;
      return (real as (...a: unknown[]) => unknown).call(fs, p, ...rest);
    };
    syncBuiltinESMExports();
    return { n: () => n, restore: () => { (fs as { readdirSync: unknown }).readdirSync = real; syncBuiltinESMExports(); } };
  };
  /** An import window's limits whose `maxMs` getter counts the windows: newBudget reads it once a window, and nothing else
   *  reads it, so the case reads the window count directly. Past 40 windows each window is spent at its first check (no
   *  progress, so the import ends): a loop without end stops, and the count shows it. */
  const countedWindows = (): { n: () => number; limits: { readonly maxMs: number } } => {
    let n = 0;
    return { n: () => n, limits: { get maxMs() { n += 1; return n > 40 ? 0 : 1_000; } } };
  };

  it('a pass whose budget ends inside the walk reads no sidecar byte and keeps the walk; the next pass resumes at the persisted cursor and links as an uncut pass links', async () => {
    const { S, dir, db, ctx, pk, rowIds } = await fixture('ccrc-hist-cp39-t2a-');
    try {
      const dec = await CP39.countDecodes();
      const reads = CP39.countReads(dir);
      let cut: Record<string, unknown>;
      try {
        // Within the budget until the tenth row decode; spent from then on, whatever else reads the clock.
        cut = await S.ingestSidecars(db, ctx, S.newBudget(() => (dec.n() >= 10 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]);
      } finally { reads.restore(); dec.restore(); }
      expect(cut, 'cut inside the walk: incomplete, nothing read, ten rows walked').toEqual({ bytes: 0, complete: false, paused: false, walked: 10 });
      expect(reads.n(), 'no sidecar byte was read before its link was known').toBe(0);
      expect(IX.count(db, 'sidecar_seen')).toBe(0);
      const st = CP39.walkState(db, pk);
      expect(st?.walk?.after, 'the walk is kept at its cursor, the tenth user row').toBe(rowIds[9]);
      expect(st?.walk?.names, 'it asks every unseen name').toHaveLength(CP39.ROWS);
      const dec2 = await CP39.countDecodes();
      let rest: { complete: boolean };
      try { rest = await S.ingestSidecars(db, ctx, S.newBudget(), [IX.U]); } finally { dec2.restore(); }
      expect(rest.complete).toBe(true);
      expect(dec2.n(), 'the next pass decoded only the rows after the persisted cursor').toBe(CP39.ROWS + 1 - 10);
      expect(CP39.sidecarRows(db), 'every sidecar links to the row that names it').toEqual(CP39.linked(CP39.upTo(CP39.ROWS)));
      expect(walkRows(db), 'a walk whose group was examined in full is deleted').toBe(0);
    } finally { db.close(); }
  });

  it('a name outside a walk in progress waits (deferred) and the half reports incomplete; once the walk is done the name is linked', async () => {
    const { S, p, dir, db, ctx, pk, rowIds } = await fixture('ccrc-hist-cp39-t2b-');
    try {
      const dec = await CP39.countDecodes();
      try { await S.ingestSidecars(db, ctx, S.newBudget(() => (dec.n() >= 10 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { dec.restore(); }
      // A new sidecar, and the row naming it, appended and ingested by the transcript half alone.
      fs.writeFileSync(path.join(dir, 'late.txt'), 'late body\n');
      fs.appendFileSync(p, lateRow());
      await S.ingestPath(db, ctx, { path: p, uuid: IX.U, home: ctx.homes[0]! }, S.newBudget());
      const dec2 = await CP39.countDecodes();
      let cut: Record<string, unknown>;
      try { cut = await S.ingestSidecars(db, ctx, S.newBudget(() => (dec2.n() >= 5 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { dec2.restore(); }
      expect(cut, 'late.txt (sorted first) waited; the walk advanced five rows').toEqual({ bytes: 0, complete: false, paused: false, walked: 5 });
      expect(CP39.walkState(db, pk)?.walk?.names, 'the walk in progress did not take the new name').not.toContain('late.txt');
      expect(CP39.walkState(db, pk)?.walk?.after).toBe(rowIds[14]);
      const full = await S.ingestSidecars(db, ctx, S.newBudget(), [IX.U]);
      expect(full.complete, 'late.txt waited again while the walk finished').toBe(false);
      expect(IX.count(db, 'sidecar_seen'), 'every out<k>.txt, and not late.txt').toBe(CP39.ROWS);
      expect((await S.ingestSidecars(db, ctx, S.newBudget(), [IX.U])).complete).toBe(true);
      expect(CP39.sidecarRows(db).find((r) => r.name === 'late.txt'), 'late.txt links to the row that names it').toEqual({ name: 'late.txt', uuid: IX.uuidN(400) });
      expect(walkRows(db)).toBe(0);
    } finally { db.close(); }
  });

  it('a new name once a walk is done gets an extension over the uncovered names alone; the done names still unseen keep their state and are never walked again (P9)', async () => {
    const { S, p, dir, db, ctx, pk, rowIds } = await fixture('ccrc-hist-cp39-t2c-');
    try {
      // The walk finishes inside the first sidecar's link; that sidecar's read then spends the budget: one taken, a done walk kept.
      const reads = CP39.countReads(dir);
      try { await S.ingestSidecars(db, ctx, S.newBudget(() => (reads.n() >= 1 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { reads.restore(); }
      expect(IX.count(db, 'sidecar_seen'), 'CONTROL: one sidecar taken').toBe(1);
      expect(CP39.walkState(db, pk)?.walk, 'CONTROL: the walk is done, and kept').toBeNull();
      fs.writeFileSync(path.join(dir, 'late.txt'), 'late body\n');
      fs.appendFileSync(p, lateRow());
      await S.ingestPath(db, ctx, { path: p, uuid: IX.U, home: ctx.homes[0]! }, S.newBudget());
      const dec = await CP39.countDecodes();
      try { await S.ingestSidecars(db, ctx, S.newBudget(() => (dec.n() >= 1 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { dec.restore(); }
      const st = CP39.walkState(db, pk);
      expect(st?.walk?.names, 'the extension asks only the uncovered name').toEqual(['late.txt']);
      expect(st?.walk?.after, 'with its own cursor, from the first row').toBe(rowIds[0]);
      expect(st?.done.names, 'the done names still unseen keep their state').toEqual(CP39.upTo(CP39.ROWS).slice(1).map((k) => `out${k}.txt`).sort());
      const dec2 = await CP39.countDecodes();
      try { expect((await S.ingestSidecars(db, ctx, S.newBudget(), [IX.U])).complete).toBe(true); } finally { dec2.restore(); }
      expect(dec2.n(), 'only the extension went on: the rows after its cursor, once').toBe(CP39.ROWS + 2 - 1);
      expect(CP39.sidecarRows(db)).toEqual([{ name: 'late.txt', uuid: IX.uuidN(400) }, ...CP39.linked(CP39.upTo(CP39.ROWS))]);
    } finally { db.close(); }
  });

  it('the sidecar half takes the uuids in the order it is given them, so a hinted session goes before a backlog', async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as S2;
    const box = IX.newBox('ccrc-hist-cp39-t2d-');
    plantSession(box, 'claude-demo2', { uuid: IX.U2, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
    IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    // U2's transcript is ONE user row, whose tool_result names its one sidecar, so its walk is one decode (P19).
    IX.plantCopy(box.homes[0]!, IX.U2, IX.jsonl([IX.user(IX.uuidN(301), null, [{ type: 'tool_result', tool_use_id: 'toolu_cp39u2', content: 'saved to: /home/u/x/tool-results/u2.txt' }], 301, { sessionId: IX.U2 })]));
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget());   // both transcripts, no sidecar yet
      for (let k = 1; k <= CP39.ROWS; k += 1) fs.writeFileSync(path.join(CP39.sideDir(box.homes[0]!), `out${k}.txt`), `body ${k}\n`);
      fs.writeFileSync(path.join(CP39.sideDir(box.homes[0]!, IX.U2), 'u2.txt'), 'the hinted body\n');
      // One byte: U2's one-row walk and its sidecar fit, then the budget is spent; U's walk, had it gone first, would be cut at its second row.
      const r = await S.ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids), S.newBudget(Date.now, { maxBytes: 1 }), [IX.U2, IX.U]);
      expect(CP39.sidecarRows(db), "exactly one sidecar is taken, and it is U2's").toEqual([{ name: 'u2.txt', uuid: IX.uuidN(301) }]);
      expect(r.complete).toBe(false);
    } finally { db.close(); }
  });

  it('import: each window resumes after the last sidecar the previous one examined, and a window that walked or examined is progress, so the import links every sidecar, from ONE listing (D-6932)', async () => {
    const { S, box, db, ids, pk } = await fixture('ccrc-hist-cp39-t2e-');
    try {
      let t = 0;
      // The window counter, read directly (P3). An injected statfs that threw would be swallowed: statfsWithDeadline reads a
      // throw as {state:'threw'}, planRun reads that as low-disk, and the import would answer 'paused'.
      const w = countedWindows();
      const opCtx = {
        home: box.home, homes: box.homes, paths: historyPaths(box.home), ids, now: () => (t += 100), out: () => {},
        deps: { statfs: PLENTY, budget: w.limits },
      };
      const l = countListings();
      let ended: string;
      try { ended = await S.importSidecars(db, opCtx, [IX.U]); } finally { l.restore(); }
      expect(ended).toBe('done');
      expect(w.n(), 'each window resumed: the import ended in a bounded number of windows').toBeLessThan(40);
      expect(l.n(), 'the sidecars were listed once for the whole import, never once a window').toBe(1);
      expect(IX.count(db, 'sidecar_seen')).toBe(CP39.ROWS);
      expect(CP39.sidecarRows(db), 'every sidecar links to the row that names it').toEqual(CP39.linked(CP39.upTo(CP39.ROWS)));
      expect(CP39.walkState(db, pk), 'the walk retired').toBeNull();
    } finally { db.close(); }
  });

  it('import: a window that re-examined only seen sidecars is progress, and the next resumes past them, so the sidecars a tick left are taken (D-6932, P3)', async () => {
    const { S, box, dir, db, ids, ctx } = await fixture('ccrc-hist-cp39-t2j-');
    try {
      // A scheduled call takes twenty: its walk finishes first (no read), then the budget is spent after the twentieth read.
      const reads = CP39.countReads(dir);
      try { await S.ingestSidecars(db, ctx, S.newBudget(() => (reads.n() >= 20 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { reads.restore(); }
      expect(IX.count(db, 'sidecar_seen'), 'CONTROL: twenty seen before the import').toBe(20);
      let t = 0;
      const w = countedWindows();
      const opCtx = {
        home: box.home, homes: box.homes, paths: historyPaths(box.home), ids, now: () => (t += 100), out: () => {},
        deps: { statfs: PLENTY, budget: w.limits },
      };
      // About nine sidecars fit a window (a check per sidecar at 100 ms of a 1,000 ms window), so the first windows examine seen sidecars only.
      expect(await S.importSidecars(db, opCtx, [IX.U])).toBe('done');
      expect(IX.count(db, 'sidecar_seen'), 'the import took the ten left, past the twenty seen').toBe(CP39.ROWS);
      expect(w.n()).toBeLessThan(40);
    } finally { db.close(); }
  });

  it('a walk an import window started is resumed by a scheduled tick from its persisted cursor, and links as one uncut walk', async () => {
    const { S, box, db, ids, pk, rowIds } = await fixture('ccrc-hist-cp39-t2f-');
    try {
      const dec = await CP39.countDecodes();
      let t = 0;
      // The clock creeps until the fifth row decode, then leaps: the first window is cut there, and the second is spent at its first check.
      const opCtx = {
        home: box.home, homes: box.homes, paths: historyPaths(box.home), ids, now: () => (t += dec.n() >= 5 ? 2_000 : 1), out: () => {},
        deps: { statfs: PLENTY, budget: { maxMs: 1_000 } },
      };
      let ended: string;
      try { ended = await S.importSidecars(db, opCtx, [IX.U]); } finally { dec.restore(); }
      expect(ended, 'a window spent before its first check is no progress: the import ends').toBe('done');
      expect(IX.count(db, 'sidecar_seen'), 'CONTROL: the import took no sidecar').toBe(0);
      expect(CP39.walkState(db, pk)?.walk?.after, 'it left its walk at the fifth user row').toBe(rowIds[4]);
      const dec2 = await CP39.countDecodes();
      try { await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 3_000_000, ids), S.newBudget()); } finally { dec2.restore(); }
      expect(dec2.n(), 'the tick resumed the walk: only the rows after the fifth').toBe(CP39.ROWS + 1 - 5);
      expect(CP39.sidecarRows(db), 'and linked as one uncut walk links').toEqual(CP39.linked(CP39.upTo(CP39.ROWS)));
    } finally { db.close(); }
  });

  it("a uuid's sidecars under two homes are one group: one walk links both homes' copies, a same-name pair to one entry", async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as S2;
    const box = IX.newBox('ccrc-hist-cp39-t2g-');
    IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    const zero = CP39.sideDir(box.homes[0]!);
    const one = CP39.sideDir(box.homes[1]!);   // a home with no <uuid>.jsonl, as _swap_carry_sidecars leaves one
    for (const k of [1, 2, 3]) fs.writeFileSync(path.join(zero, `out${k}.txt`), `home zero ${k}\n`);
    for (const k of [3, 4]) fs.writeFileSync(path.join(one, `out${k}.txt`), `home one ${k}\n`);
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget(Date.now, { maxBytes: 1 }));   // the transcript only
      const dec = await CP39.countDecodes();
      try { expect((await S.ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids), S.newBudget(), [IX.U])).complete).toBe(true); } finally { dec.restore(); }
      expect(dec.n(), 'the rows were walked once, for both homes').toBe(CP39.ROWS + 1);
      expect(CP39.sidecarRows(db)).toEqual(CP39.linked([1, 2, 3, 3, 4]));
    } finally { db.close(); }
  });

  it('the walk state is parsed once per pass however many sidecars link from it (P10)', async () => {
    const { S, dir, db, ctx, pk } = await fixture('ccrc-hist-cp39-t2h-');
    try {
      const reads = CP39.countReads(dir);
      try { await S.ingestSidecars(db, ctx, S.newBudget(() => (reads.n() >= 1 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { reads.restore(); }
      expect(CP39.walkState(db, pk)?.done.names, 'CONTROL: a done walk is kept for the next pass').toHaveLength(CP39.ROWS);
      const realParse = JSON.parse;
      let parses = 0;
      JSON.parse = function parse(text: string, ...rest: unknown[]): unknown {
        if (typeof text === 'string' && text.startsWith('{"v":1,"done":')) parses += 1;
        return (realParse as (...a: unknown[]) => unknown)(text, ...rest);
      } as typeof JSON.parse;
      let r: { complete: boolean };
      try { r = await S.ingestSidecars(db, ctx, S.newBudget(), [IX.U]); } finally { JSON.parse = realParse; }
      expect(r.complete).toBe(true);
      expect(IX.count(db, 'sidecar_seen'), 'CONTROL: the other 29 sidecars linked from the one state').toBe(CP39.ROWS);
      expect(parses, 'one parse for the group, none per sidecar: no walk advanced in this pass').toBeLessThanOrEqual(1);
    } finally { db.close(); }
  });

  it("O20 at the walk's cap: a walk of SIDECAR_WALK_CHARS_MAX units of names beside a 64 MiB sidecar, captured by the real sweep under O20's bound (P22)", async () => {
    const { lib } = await IX.api();
    const box = IX.newBox('ccrc-hist-cp39-t2i-');
    try {
      IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
      const dir = CP39.sideDir(box.homes[0]!);
      // 2,100 names of 250 units: more than the cap holds, so the first walk is built at it (CONTROL below).
      const many = Array.from({ length: 2_100 }, (_, i) => `cp39-${String(i).padStart(4, '0')}-${'q'.repeat(236)}.txt`);
      for (const n of many) fs.writeFileSync(path.join(dir, n), 'x\n');
      const fd = fs.openSync(path.join(dir, 'whole64.txt'), 'w');
      try { for (let at = 0, k = 1; at < 67_108_864; k += 1) { const piece = Buffer.from(IX.words(4000, k)).subarray(0, 67_108_864 - at); fs.writeSync(fd, piece); at += piece.length; } } finally { fs.closeSync(fd); }
      const first = lib.walkNames([...many, 'whole64.txt'], many[0]!);
      expect(first.reduce((n, s) => n + s.length, 0), 'CONTROL: the first walk is built at the cap').toBeGreaterThan(lib.SIDECAR_WALK_CHARS_MAX - 250);
      let peak = 0;
      for (let pass = 0; pass < 4; pass += 1) {
        const r = runSweep(box, [], { preloads: [IX_RSS_PRELOAD] });
        expect(r.code, r.stderr).toBe(0);
        peak = Math.max(peak, Number(/history-test-maxrss-kib=(\d+)/.exec(r.stderr)?.[1] ?? 'NaN'));
        const db = openStoreRO(box);
        let seen = 0;
        try { seen = IX.count(db, 'sidecar_seen'); } finally { db.close(); }
        if (seen === many.length + 1) break;
      }
      const db = openStoreRO(box);
      try { expect(IX.count(db, 'sidecar_seen'), 'every sidecar was taken').toBe(many.length + 1); } finally { db.close(); }
      console.log(`CP-39 walk-cap peak RSS ${peak} KiB on ${process.version}`);
      expect(peak).toBeLessThan(IX_RSS_BOUND_KIB);
    } finally {
      fs.rmSync(box.home, { recursive: true, force: true });   // a 64 MiB sidecar plus its store: never left for afterAll alone
    }
  }, 300_000);
});
```

  Run `(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts -t 'CP-39 Task 2')`. Predicted on Task 1's code:
  - the cut case red at `cut` (Task 1's half links with an unbudgeted walk, so it reads the first sidecar: `bytes` above 0);
  - the deferral case red at its first `cut` (no `walked` field);
  - the extension case red at its state read (no meta row: `expected undefined to equal ['late.txt']`);
  - the order case red at the order (U is visited first and its first sidecar taken: `expected [{ name: 'out1.txt', … }] to equal [{ name: 'u2.txt', … }]`);
  - the three import cases red on `S.importSidecars is not a function`;
  - the two-home case GREEN (Task 1's index cache is per transcript already): it is a regression pin, and its red is M2g's;
  - the parse case red at its CONTROL (no state is persisted);
  - the RSS case red at `lib.walkNames is not a function`.
  Record the measured messages.

- [ ] **Step 2b: the status case (red).** Append to `history-cli.test.ts`:

```ts
describe('CP-39 Task 2: status never reads a link walk\'s state (D-6940)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  it('the meta statement status runs leaves out every sidecar_walk: row, and status answers as before beside one of several MB', () => {
    const box = boundBox('ccrc-hist-cli-cp39-walk-');
    const big = JSON.stringify({ v: 1, done: { names: Array.from({ length: 60_000 }, (_, i) => `n${i}-${'q'.repeat(60)}.txt`), text: [], toolu: [] }, walk: null });
    expect(big.length, 'CONTROL: several MB').toBeGreaterThan(4 * 1024 * 1024);
    const db = new DatabaseSync(dbFile(box));
    try { db.prepare("INSERT INTO meta (k, v) VALUES ('sidecar_walk:7', ?)").run(big); } finally { db.close(); }
    // The statement, read from the module itself in a child, as the cost case reads STATUS_SQL (importing it here would set this worker's umask).
    const sql = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e',
      `const m = await import(${JSON.stringify(pathToFileURL(CLI).href)}); process.stdout.write(m.STATUS_SQL.meta);`], { encoding: 'utf8' });
    expect(sql.status, sql.stderr).toBe(0);
    const ro = new DatabaseSync(dbFile(box), { readOnly: true });
    try {
      const keys = (ro.prepare(sql.stdout).all() as { k: string }[]).map((r) => r.k);
      expect(keys, 'CONTROL: the statement reads the other rows').toContain('store_id');
      expect(keys.filter((k) => k.startsWith('sidecar_walk:')), 'no walk state reaches status').toEqual([]);
    } finally { ro.close(); }
    const r = status(box);
    expect(r.code, r.stderr).toBe(0);
    expect(r.env.store_id).toBe(storeIdOf(box));
  });
});
```

  Run `(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'CP-39 Task 2')`. Predicted red at 'no walk state reaches status' (`expected [ 'sidecar_walk:7' ] to deeply equal []`).

- [ ] **Step 3: implement lib's walk state.** The ten exports above, each with its doc comment naming D-6931. Notes:
  - `parseSidecarWalk` rejects a text over 64 MiB before parsing, uses `JSON.parse` inside `try`, then checks every field as the interface lists; it builds the Sets its checks need and keeps the lists as given.
  - `foldWalkCandidates` splits a candidate's `text` on `'\0'` (never on `''`: an empty text names nothing), and keeps for each name and each stem only its first entry. It works on Maps built from the pairs, then writes the pairs back.
  - `finishSidecarWalk` appends the walk's names to `done.names` and its pairs to `done`'s where `done` holds no entry for that name or stem, then sets `walk` to null.
  - `startSidecarWalk` prunes, computes the room, calls `walkNames`, and sets `walk = { names, after: 0, text: [], toolu: [] }`.
  - `walkCandidates` returns `[{ entryId, text: name, toolUseIds: [] }]` for a text hit, then `{ entryId, text: '', toolUseIds: [stem] }` for a toolu hit, in that order, from `done` only.
  Declare all ten in `lib.d.mts`. Run Step 1's command. Predicted green.

- [ ] **Step 4: implement the walk in sweep.mjs.**
  - **`unseenOf(db, g)`:** on its first call for `g`, lstat each of `g.list`'s sidecars once and keep, as a Set on `g.unseen`, the names whose (size, mtime_ns) `seenSame` does not find; later calls answer it.
  - **`linkCandidates(db, g, transcriptPk, s, budget)`:**
    1. On the group's first need, `g.walk = { key: SIDECAR_WALK_META + transcriptPk, state: parseSidecarWalk(getMeta(db, key)) ?? emptySidecarWalk() }`. Never again in this call (P10).
    2. A name `done` holds answers `{ ready: true, candidates: walkCandidates(state, s.name) }`.
    3. No walk in progress: `startSidecarWalk(state, unseenOf(db, g), s.name)` (P9: an extension over the uncovered names; the done names keep their state).
    4. A walk in progress that does not hold `s.name`: if some name it holds is still in `unseenOf(db, g)`, answer `{ ready: false, deferred: true }`; otherwise its files are gone or seen, so set `state.walk = null` and start an extension as in step 3.
    5. Advance: `const walk = { budget, after: state.walk.after, advanced: 0, complete: false }`, `toolResultCandidates(db, transcriptPk, state.walk.names, walk)`, `foldWalkCandidates`, `state.walk.after = walk.after`, and `finishSidecarWalk(state)` when `walk.complete`. Add `walk.advanced` to `g.walked`. When `walk.advanced > 0 || walk.complete`, write `formatSidecarWalk(state)` with `setMeta` in one `NORMAL` transaction.
    6. Then, if `done` now holds `s.name`, answer as in step 2; otherwise `{ ready: false }`.
  - **`ingestSidecar`** (it now takes the group `g` in place of the old `cache`). After `fstatSync` and the size re-check, and BEFORE `readAt` or `compressFdRange`:

```js
    // CP-39 (D-6931): the link before any byte is read, so a walk the budget cuts reads no sidecar.
    const transcriptPk = withTx(db, 'NORMAL', () => ensureTranscript(db, s.uuid));
    const link = linkCandidates(db, g, transcriptPk, s, budget);
    if (!link.ready) return link.deferred === true ? { bytes: 0, deferred: true } : { bytes: 0, cut: true };
    const entryId = linkSidecar(s.name, link.candidates);
```

    The old `ensureTranscript` and `linkSidecar(..., candidatesFor(...))` lines after the read are deleted. The floor probe and admission keep their places before this, so the probe count the RF5a F15 case reads is unchanged. `g.pk = transcriptPk`.
  - **`ingestSidecars(db, ctx, budget, uuids, opts = {})`:**
    - `found` is `opts.found` when given (filtered to the `due` uuids; nothing is listed), else `discoverSidecars(ctx.homes, due)` as today. Group it by uuid into a Map whose keys are inserted in `due` order (the caller's), each group `{ list, walked: 0 }` with its list in discovery order. The call's order is the groups' lists concatenated.
    - `opts.from`: when that path is in the call's order, skip every sidecar up to and including it; otherwise skip none.
    - Inside a group: a `cut` returns `{ bytes, complete: false, paused: false, …unreadable, …walked, …examined, …resume }` at once. A `deferred` sidecar marks the group partial and is NOT counted in `examined`, the progress count (it stays unseen: Task 3's wrap counts it in `left`), and the loop moves on to the group's next sidecar. A sidecar `ingestSidecar` answered for (taken, seen, too large, refused, or a fs error, counted as today) is examined: `examined += 1`, `resume = s.path`. A seen sidecar is examined: re-skipping it is progress, which the resume point makes finite (P3). A fs error also marks the group partial, as today.
    - After a group whose every sidecar was examined (none deferred, none faulted, no stop), a walk state of `g.pk` is deleted in one `NORMAL` transaction (retire), and `g.walk` dropped.
    - Any deferred sidecar makes `complete` false at the end.
    - `walked` is the sum of the groups' `walked` (rows the cursors moved past, P18). The doc comment states D-6931 and D-6932.
  - **`importSidecars`:** exported. Before the first window it lists the sidecars ONCE, `const found = discoverSidecars(ctx.homes, uuids);` (D-6932: no window re-lists about 135,000 entries; Task 3 moves this listing under the windows' budgets). Each window: `newBudget(ctx.now, ctx.deps?.budget ?? {})` and `ingestSidecars(db, ictx, budget, uuids, { from, found })`. Then:

```js
    // CP-39 (D-6932): a window that examined a sidecar (seen or new) or advanced a walk made progress, even when it read no byte;
    // the next window resumes after the last sidecar this one examined, so seen sidecars never fill a window.
    if (r.complete || (r.examined === undefined && r.walked === undefined)) return 'done';
    if (r.resume !== undefined) from = r.resume;
```

  Its doc comment's "A window that took nothing" sentence becomes "The sidecars are listed once per import and the list handed to every window. A window that examined no sidecar and advanced no link walk, and is still incomplete (history-off, or a budget spent on nothing), ends it; each window resumes after the last sidecar the previous one examined (D-6932)".
  - **cli.mjs:** `STATUS_SQL.meta` becomes `` `SELECT k, v FROM meta WHERE k NOT LIKE '${SIDECAR_WALK_META.replace('_', '\\_')}%' ESCAPE '\\'` ``, with a comment: "CP-39 (D-6940): a link walk's state is the sweep's working memory, up to MBs a row; status reads none of it". `SIDECAR_WALK_META` joins cli.mjs's lib import. The cost case's EXPLAIN check is unchanged: `meta` is not one of the tables it forbids a scan of.

  Run Step 2's and Step 2b's commands. Predicted: the import case is still red, with `'done'` returned and `sidecar_seen` 0, if the end rule is applied last; apply it and run again. All predicted green. Record both runs.

- [ ] **Step 5: the regression sweep.** Run, one per call:
  - `(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts -t 'plan task 21')`;
  - `-t 'D-4340'` and `-t 'SIDECAR_MAX_BYTES'`;
  - `-t 'D-4312'`, `-t 'D-4336'` and `-t 'CP-39 Task 1'`;
  - `(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'RF5a F15')`;
  - `(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts -t 'sidecar')`;
  - `(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'cost')` and `-t 'status health'`.
  All are predicted green, unedited.

- [ ] **Step 6: the measured mutations (one per guard, one per call).** For each, run the named filter, record the red title, restore with `cp`, and `cmp`.
  - **M2a:** in `ingestSidecar`, move the link lines back to after the read. Predicted red: the cut case at 'no sidecar byte was read before its link was known' (`expected 1 to be 0`).
  - **M2b:** in `linkCandidates`, advance every walk from `after: 0`. Predicted red: the cut case at 'the next pass decoded only the rows after the persisted cursor' (`expected 31 to be 21`).
  - **M2c:** in `importSidecars`, restore `if (r.complete || r.bytes === 0) return 'done';`. Predicted red: the import case at `sidecar_seen` (`expected 0 to be 30`).
  - **M2d:** in `ingestSidecars`, iterate `found` in discovery order. Predicted red: the order case (`expected [] to deeply equal [{ name: 'u2.txt', … }]`).
  - **M2e:** in `importSidecars`, drop `from = r.resume`. Every window then starts at the first sidecar and re-skips the seen ones, which is progress, so the import runs until the window counter spends its windows. Predicted red: the import case at 'each window resumed: the import ended in a bounded number of windows' (`expected 41 to be less than 40`). (The guard it replaces, an injected `statfs` that threw past 500 calls, could never have reached the case: `statfsWithDeadline` swallows the throw as `{state:'threw'}`, `planRun` reads it as low-disk, and the import answers 'paused', so the red would have been `expected 'paused' to be 'done'`.)
  - **M2f (P10):** in `linkCandidates`, parse the state on every call (drop the `g.walk` cache). Predicted red: the parse case (`expected 29 to be less than or equal to 1`).
  - **M2g:** key the groups by `${s.home}\0${s.uuid}`. Predicted red: the two-home case at 'the rows were walked once, for both homes' (`expected 62 to be 31`).
  - **M2h (D-6940):** restore `meta: 'SELECT k, v FROM meta',`. Predicted red: the status case at 'no walk state reaches status'.
  - **M2i (P9):** in `linkCandidates` step 3, replace the extension with a fresh walk over every unseen name (`state.done = emptySidecarWalk().done` before `startSidecarWalk`). Predicted red: the extension case at 'the extension asks only the uncovered name' (30 names).
  - **M2j (P3, a seen sidecar counts as examined):** in `ingestSidecars`, count a sidecar as examined, and as the resume point, only when it was taken (`r.bytes > 0`). Predicted red: the seen-sidecar import case at 'the import took the ten left, past the twenty seen' (`expected 20 to be 30`: its first window examined only seen sidecars, and the end rule read it as no progress).
  - **M2k (P3, the walk half of the end rule):** in `importSidecars`, `if (r.complete || r.examined === undefined) return 'done';` (`r.walked` dropped). Predicted red: the import case at `sidecar_seen` (`expected 0 to be 30`: its first window only advanced the walk).
  - **M2l (the one listing):** in `ingestSidecars`, ignore `opts.found` and list with `discoverSidecars(ctx.homes, due)`. Predicted red: the import case at 'the sidecars were listed once for the whole import, never once a window' (`expected <the windows plus one> to be 1`, about 9; record the measured count).

- [ ] **Step 7: commit.** `cmp` again, add the seven files (lib.mjs, lib.d.mts, sweep.mjs, cli.mjs, history-lib.test.ts, history-ingest.test.ts and history-cli.test.ts), and commit `fix(history-sweep): resume the sidecar link walk across passes, never restart it, and count it as import progress (CP-39 Task 2; D-6931, D-6932, D-6940)`.

---

### Task 3: each half of the ingest keeps its own scan mark, and discovery runs under the budget from a resumable cursor (D-6933, D-6934, D-6938)

**Files:**
- Modify: `ccd/history/lib.mjs`: after Task 2's exports, add `parseSidecarScanAt`, `formatSidecarScanAt` and `sidecarWrapClose`. `ccd/history/lib.d.mts`: their declarations.
- Modify: `ccd/history/sweep.mjs`:
  - lib import (:43-:73): add `parseSidecarScanAt`, `formatSidecarScanAt`, `sidecarWrapClose`;
  - beside `SCAN_META` (:4917): `SIDECAR_SCAN_META = 'scan_sidecars_ms'`, `SIDECAR_SCAN_AT_META = 'scan_sidecars_at'`, `SIDECARS_UNSEEN_META = 'sidecars_unseen'` and `sidecarScanDue`;
  - `walkTranscripts` (:1746-:1759): an optional `stop`, checked before each `projects/` and slug listing; it answers whether it walked everything. `discoverTranscripts` (:1763-:1769) and `indexedTranscripts` are unchanged callers;
  - a new `discoverTranscriptsWithin` beside `discoverTranscripts`;
  - `candidateFiles` (:5028-:5049): two more parameters and the `known` and `complete` answers;
  - `recordExamined` (:5051-:5057): unchanged; called for the transcript mark;
  - `ingestTick` (:5081-:5135), its doc comment included;
  - `discoverSidecars` (:5356-:5376): its body becomes `listSidecars`, and it answers `listSidecars(homes, uuids, null).found`;
  - Task 2's `unseenOf` and `ingestSidecars`: the budget check before the group's lstats, only the names that can reach the link, the idle walk's retirement, and the scan share;
  - Task 2's `importSidecars`: its one listing moves under the windows' budgets, from a cursor of the import's own.
- Test: `server/test/history-ingest.test.ts`. One in-place edit: the sidecar-floor case ('sidecar floor (par 9.3, BK17)', :1654-:1677), its comment and assertion at :1668-:1669. Plus an appended describe of eleven cases. And `server/test/history-lib.test.ts`: an appended describe.

**Interfaces:**

```js
/** lib.mjs (D-6938). The sidecar scan's cursor, meta `scan_sidecars_at`: {"v":1,"dir":"<home>/projects/<project>/<uuid>"|null,
 *  "taken":<int>,"left":<int>,"held":<bool>}. `dir` is the last uuid directory, in walk order, whose sidecars this wrap
 *  examined or deferred in full; `taken` counts the sidecars this wrap took, and `left` every sidecar it LEFT UNSEEN in the
 *  directories it passed: too large, refused (by admission or a read error) or deferred. A deferred sidecar is not
 *  `examined` (ingestSidecars' progress count) and IS counted here: the backlog is what the figure shows. `held` says a
 *  read error or a deferral met in this wrap holds the mark. No row (null) is a clean wrap from the start. Anything else is a HELD wrap from the start, so a lost cursor costs
 *  one more wrap and never marks a scan it did not finish. */
export function parseSidecarScanAt(text /* string | null */) /* -> ScanAt */;
export function formatSidecarScanAt(at) /* -> string; keys in the order v, dir, taken, left, held */;
/** What a wrap that reached its end records: `unseen` (taken + left) always, as meta `sidecars_unseen`; the mark only when
 *  nothing held the wrap. */
export function sidecarWrapClose(at) /* -> { unseen: number, mark: boolean } */;
```

```js
/** sweep.mjs (D-6933). Whether the sidecar half's scan is due: never run, or SCAN_INTERVAL_MS since the last wrap that
 *  completed clean over every known uuid. Its clock is meta `scan_sidecars_ms`. */
function sidecarScanDue(db, nowMs);
/** (D-6938) discoverTranscripts under `budget`, checked before each projects/ and slug listing: { files, complete }. */
function discoverTranscriptsWithin(homes, uuids, budget);
/** (D-6933, D-6938) This tick's candidates: hinted, then behind, then, at the transcript scan, every known uuid's files.
 *  Hinted and behind files add their uuids to `uuids` (the sidecar half's given share); the scan's files add none: the
 *  sidecar scan covers `known` from its own cursor. `known` is filled when either scan is due. With `budget`, discovery
 *  checks it before each directory it lists, and `complete` is false when it was cut. */
export function candidateFiles(db, ctx, scan, sideScan = scan, budget = null) /* -> { files, uuids, known, complete } */;
/** (D-6938) discoverSidecars' resumable form: the wanted uuids' tool-results/ in walk order (homes as given, projects and
 *  uuid entries sorted), from just after the uuid directory `from` (null: the start; a `from` under no rostered home, or
 *  one that does not parse, is the start), with budgetLeft checked before each projects/ listing, each project listing
 *  and each wanted uuid directory. Each found entry carries its directory's path, `dir`; `dirs` lists the uuid
 *  directories listed, in order; `complete` says the walk reached its end. */
export function listSidecars(homes, uuids, budget, from = null) /* -> { found, dirs, complete } */;
```

- [ ] **Step 0: check the base and Task 2.** `grep -n "const SCAN_META = 'scan_discover_ms'" ccd/history/sweep.mjs` shows :4917. `grep -n "if (scan && complete && !unreadable) recordExamined" ccd/history/sweep.mjs` shows one line (:5129 at `ece3dfbee`; the content grep is what counts, P20). `grep -n "^function walkTranscripts\|^export function discoverSidecars\|^function unseenOf\|^export async function importSidecars" ccd/history/sweep.mjs` shows four lines. `grep -rn "candidateFiles(" server/test` shows nothing. Stop otherwise.

- [ ] **Step 1: the lib case (red).** Append to `history-lib.test.ts`:

```ts
describe('CP-39 Task 3: the sidecar scan cursor and what a finished wrap records (D-6938)', () => {
  it('round-trips; no row is a clean wrap from the start; anything malformed is a held wrap from the start', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    const at = { v: 1, dir: '/home/u/x/projects/-home-u-tree/6f1c2e3a-0b4d-4c5e-8f60-718293a4b5c6', taken: 3, left: 1, held: false };
    expect(lib.parseSidecarScanAt(lib.formatSidecarScanAt(at))).toEqual(at);
    expect(lib.parseSidecarScanAt(lib.formatSidecarScanAt({ ...at, dir: null }))).toEqual({ ...at, dir: null });
    expect(lib.parseSidecarScanAt(null)).toEqual({ v: 1, dir: null, taken: 0, left: 0, held: false });
    for (const b of ['', '{}', 'not json', JSON.stringify({ ...at, v: 2 }), JSON.stringify({ ...at, taken: -1 }), JSON.stringify({ ...at, left: 1.5 }), JSON.stringify({ ...at, held: 'no' }), JSON.stringify({ ...at, dir: 7 })]) {
      expect(lib.parseSidecarScanAt(b), b).toEqual({ v: 1, dir: null, taken: 0, left: 0, held: true });
    }
  });
  it('a finished wrap records its count always, and the mark only when nothing held it', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.sidecarWrapClose({ v: 1, dir: null, taken: 3, left: 2, held: false })).toEqual({ unseen: 5, mark: true });
    expect(lib.sidecarWrapClose({ v: 1, dir: null, taken: 3, left: 2, held: true })).toEqual({ unseen: 5, mark: false });
  });
});
```

  Run `(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'CP-39 Task 3')`. Predicted: 2 red on `is not a function`.

- [ ] **Step 2: the ingest cases (red).** Append to `history-ingest.test.ts`:

```ts
describe('CP-39 Task 3: each half of the ingest keeps its own scan mark, and discovery runs under the budget (D-6933, D-6934, D-6938)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const sideDir = (home: string, uuid = IX.U): string => CP39.sideDir(home, uuid);
  const metaV = (db: DatabaseSync, k: string): string | null => (db.prepare('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | undefined)?.v ?? null;
  const PLENTY = async (): Promise<{ bsize: number; bavail: number; blocks: number }> => ({ bsize: 1, bavail: 4 * 2 ** 40, blocks: 8 * 2 ** 40 });
  const counterOf = (db: DatabaseSync, name: string): number | undefined =>
    (db.prepare('SELECT n FROM counters WHERE name = ?').get(name) as { n: number } | undefined)?.n;
  /** As the FR2-d describe's: node:fs's readSync faulted for the descriptors that name `bad`, carried to sweep.mjs by
   *  syncBuiltinESMExports. */
  const failReads = (bad: string, code = 'EIO'): { faulted: () => number; restore: () => void } => {
    const realRead = fs.readSync;
    let faulted = 0;
    const err = Object.assign(new Error(`${code}: i/o error, read`), { code, errno: -5, syscall: 'read' });
    (fs as { readSync: unknown }).readSync = function readSync(fd: number, ...rest: unknown[]): number {
      if (fs.readlinkSync(`/proc/self/fd/${fd}`) === bad) { faulted += 1; throw err; }
      return (realRead as (...a: unknown[]) => number)(fd, ...rest);
    };
    syncBuiltinESMExports();
    return { faulted: () => faulted, restore: () => { (fs as { readSync: unknown }).readSync = realRead; syncBuiltinESMExports(); } };
  };
  /** The directories one call lists, counted outside the sweep: every readdirSync under a projects/ tree, and the uuid
   *  of every tool-results/ listed. */
  const listings = (): { projects: () => string[]; toolResults: () => string[]; restore: () => void } => {
    const real = fs.readdirSync;
    const projects: string[] = [];
    const toolResults: string[] = [];
    (fs as { readdirSync: unknown }).readdirSync = function readdirSync(p: unknown, ...rest: unknown[]): unknown {
      const s = String(p);
      if (s.includes('/projects')) projects.push(s);
      if (s.endsWith('/tool-results')) toolResults.push(path.basename(path.dirname(s)));
      return (real as (...a: unknown[]) => unknown).call(fs, p, ...rest);
    };
    syncBuiltinESMExports();
    return { projects: () => projects, toolResults: () => toolResults, restore: () => { (fs as { readdirSync: unknown }).readdirSync = real; syncBuiltinESMExports(); } };
  };
  /** Three known uuids under home 0, each a one-row transcript, ingested by a first tick over no sidecar (its wrap
   *  completes); then one sidecar each, and the sidecar mark deleted so that ONLY the sidecar scan is due on the next ticks. */
  const threeUuids = async (prefix: string) => {
    const { sweep: S } = await IX.api();
    const box = IX.newBox(prefix);
    plantSession(box, 'claude-demo2', { uuid: IX.U2, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
    plantSession(box, 'claude-demo3', { uuid: IX.U3, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
    const uuids = [IX.U, IX.U2, IX.U3];   // their directories sort in this order
    uuids.forEach((u, i) => IX.plantCopy(box.homes[0]!, u, IX.jsonl([IX.user(IX.uuidN(500 + i), null, 'go', 500 + i, { sessionId: u })])));
    const { db, ids } = await IX.openFixtureStore(box);
    const t0 = IX.tsMs(0) + 60_000;
    await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, t0, ids), S.newBudget());
    expect(metaV(db, 'scan_sidecars_ms'), 'CONTROL: the first wrap completed').toBe(String(t0));
    uuids.forEach((u) => fs.writeFileSync(path.join(sideDir(box.homes[0]!, u), 'one.txt'), `the sidecar of ${u}\n`));
    db.prepare("DELETE FROM meta WHERE k = 'scan_sidecars_ms'").run();
    const tick = (k: number, budget: IxBudget) => S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, t0 + k * 60_000, ids), budget);
    return { S, box, db, ids, t0, tick };
  };

  it('a sidecar half the budget cut leaves only its own mark unset: the transcripts are not rediscovered, and the next unhinted tick still takes the known uuid\'s sidecar', async () => {
    const { sweep: S } = await IX.api();
    const box = IX.newBox('ccrc-hist-cp39-t3a-');
    const text = IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]);
    IX.plantCopy(box.homes[0]!, IX.U, text);
    fs.writeFileSync(path.join(sideDir(box.homes[0]!), 'a-first.txt'), 'first body\n');
    fs.writeFileSync(path.join(sideDir(box.homes[0]!), 'b-second.txt'), 'second body\n');
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const at = IX.tsMs(0) + 60_000;
      // The byte budget lets the transcript, its one-row walk and the first sidecar in, then holds the second.
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, at, ids), S.newBudget(Date.now, { maxBytes: Buffer.byteLength(text) + 1 }));
      expect(IX.count(db, 'sidecar_seen'), 'CONTROL: the budget cut the sidecar half after one').toBe(1);
      expect(metaV(db, 'scan_discover_ms'), 'the transcripts are done, so their scan is marked').toBe(String(at));
      expect(metaV(db, 'scan_sidecars_ms'), 'the sidecar half is not').toBeNull();
      // One minute on: no transcript scan is due, nothing is hinted, and the sidecar scan still covers the known uuid.
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, at + 60_000, ids), S.newBudget());
      expect(IX.count(db, 'sidecar_seen'), 'the second sidecar is taken by the sidecar scan alone').toBe(2);
      expect(metaV(db, 'scan_discover_ms'), 'the transcript scan was not re-run').toBe(String(at));
      expect(metaV(db, 'scan_sidecars_ms')).toBe(String(at + 60_000));
    } finally { db.close(); }
  });

  it('D-4340 narrowed: a sidecar read error holds only the sidecar mark; a transcript read error holds only the transcript mark (D-6934)', async () => {
    const { sweep: S } = await IX.api();
    const at = IX.tsMs(0) + 60_000;
    // Arm (a): EIO on a sidecar. The transcripts are done, so their mark is set; the sidecar scan met the error, so its mark is held.
    {
      const box = IX.newBox('ccrc-hist-cp39-t3b1-');
      IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'go', 1)]));
      const dir = sideDir(box.homes[0]!);
      const bad = path.join(fs.realpathSync(dir), 'a-bad.txt');
      fs.writeFileSync(bad, 'unreadable body\n');
      fs.writeFileSync(path.join(dir, 'b-good.txt'), 'readable body\n');
      const { db, ids } = await IX.openFixtureStore(box);
      try {
        const f = failReads(bad);
        try { await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, at, ids), S.newBudget()); } finally { f.restore(); }
        expect(f.faulted(), 'CONTROL: arm (a), the fault fired').toBeGreaterThanOrEqual(1);
        expect(counterOf(db, 'file_unreadable'), 'CONTROL: arm (a), counted once').toBe(1);
        expect(IX.count(db, 'sidecars'), 'arm (a): the good sidecar was taken').toBe(1);
        expect(metaV(db, 'scan_discover_ms'), 'arm (a): the transcript mark is set').toBe(String(at));
        expect(metaV(db, 'scan_sidecars_ms'), 'arm (a): the sidecar mark is held').toBeNull();
      } finally { db.close(); }
    }
    // Arm (b): EIO on a transcript. Its mark is held; the sidecar scan, complete over the other uuid, sets its own.
    {
      const box = IX.newBox('ccrc-hist-cp39-t3b2-');
      plantSession(box, 'claude-demo2', { uuid: IX.U2, generation: IX.G, project: 'demo', workdir: '/home/u/tree' });
      const bad = IX.plantCopy(box.homes[0]!, IX.U, IX.jsonl([IX.user(IX.uuidN(1), null, 'unreadable', 1)]));
      IX.plantCopy(box.homes[0]!, IX.U2, IX.jsonl([IX.user(IX.uuidN(21), null, 'readable', 21, { sessionId: IX.U2 })]));
      fs.writeFileSync(path.join(sideDir(box.homes[0]!, IX.U2), 'c-u2.txt'), 'the readable session\'s sidecar\n');
      const { db, ids } = await IX.openFixtureStore(box);
      try {
        const f = failReads(fs.realpathSync(bad));
        try { await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, at, ids), S.newBudget()); } finally { f.restore(); }
        expect(f.faulted(), 'CONTROL: arm (b), the fault fired').toBeGreaterThanOrEqual(1);
        expect(counterOf(db, 'file_unreadable'), 'CONTROL: arm (b), counted once').toBe(1);
        expect(IX.count(db, 'sidecars'), "arm (b): the other uuid's sidecar was taken").toBe(1);
        expect(metaV(db, 'scan_discover_ms'), 'arm (b): the transcript mark is held').toBeNull();
        expect(metaV(db, 'scan_sidecars_ms'), 'arm (b): the sidecar mark is set').toBe(String(at));
      } finally { db.close(); }
    }
  });

  it('the sidecar scan resumes from its uuid-directory cursor: a cut wrap goes on where it stopped, the mark waits for the whole wrap, and the wrap stamps sidecars_unseen (D-6938)', async () => {
    const { S, db, t0, tick } = await threeUuids('ccrc-hist-cp39-t3c-');
    try {
      // One byte a tick: the listing and one sidecar (a one-row walk, then its read) fit, then the budget is spent.
      const run = async (k: number, budget: IxBudget): Promise<string[]> => {
        const l = listings();
        try { await tick(k, budget); } finally { l.restore(); }
        return l.toolResults();
      };
      expect(await run(1, S.newBudget(Date.now, { maxBytes: 1 })), 'tick 1 lists from the start').toEqual([IX.U, IX.U2, IX.U3]);
      expect(IX.count(db, 'sidecar_seen')).toBe(1);
      expect(JSON.parse(metaV(db, 'scan_sidecars_at')!).dir, "the cursor passed U's directory").toMatch(new RegExp(`/${IX.U}$`));
      expect(metaV(db, 'scan_sidecars_ms'), 'the mark waits for the whole wrap').toBeNull();
      expect(await run(2, S.newBudget(Date.now, { maxBytes: 1 })), 'tick 2 lists only after its cursor').toEqual([IX.U2, IX.U3]);
      expect(IX.count(db, 'sidecar_seen')).toBe(2);
      expect(metaV(db, 'scan_sidecars_ms'), 'still waiting').toBeNull();
      expect(await run(3, S.newBudget()), 'tick 3 finishes the wrap').toEqual([IX.U3]);
      expect(IX.count(db, 'sidecar_seen')).toBe(3);
      expect(metaV(db, 'scan_sidecars_ms'), 'the wrap completed clean: the mark').toBe(String(t0 + 3 * 60_000));
      expect(metaV(db, 'sidecars_unseen'), 'the wrap took three, over three ticks').toBe('3');
      expect(metaV(db, 'scan_sidecars_at'), 'the cursor is reset for the next wrap').toBeNull();
    } finally { db.close(); }
  });

  it('discovery runs under the budget: a spent budget lists nothing under projects/; one spent by a tool-results/ listing lists no further uuid directory (D-6938)', async () => {
    const { S, db, tick } = await threeUuids('ccrc-hist-cp39-t3d-');
    try {
      // (1) Both scans due, the budget spent at entry: neither the transcript scan nor the sidecar scan lists a directory.
      db.prepare("DELETE FROM meta WHERE k = 'scan_discover_ms'").run();
      const l1 = listings();
      try { await tick(1, S.newBudget(() => 0, { maxMs: 0 })); } finally { l1.restore(); }
      expect(l1.projects(), 'a spent budget lists nothing under projects/').toEqual([]);
      // (2) The budget is spent by the first tool-results/ listing: the check before the next uuid directory stops the listing.
      const l2 = listings();
      try { await tick(2, S.newBudget(() => (l2.toolResults().length >= 1 ? 10_000 : 0), { maxMs: 1_000 })); } finally { l2.restore(); }
      expect(l2.toolResults(), 'one uuid directory listed, then the check failed').toEqual([IX.U]);
      expect(IX.count(db, 'sidecar_seen'), 'the budget was spent before any sidecar').toBe(0);
      expect(metaV(db, 'scan_sidecars_at'), 'no directory was examined: the cursor did not move').toBeNull();
    } finally { db.close(); }
  });

  it("the group's lstats run under the budget: once it is spent, unseenOf lstats nothing and the sidecar waits (D-6938)", async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as IxSweep;
    const box = IX.newBox('ccrc-hist-cp39-t3e-');
    IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    const dir = sideDir(box.homes[0]!);
    for (let k = 1; k <= CP39.ROWS; k += 1) fs.writeFileSync(path.join(dir, `out${k}.txt`), `body ${k}\n`);
    const { db, ids } = await IX.openFixtureStore(box);
    const real = fs.lstatSync;
    const under = [`${dir}/`, `${fs.realpathSync(dir)}/`];
    let lstats = 0;
    try {
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 60_000, ids), S.newBudget(Date.now, { maxBytes: 1 }));   // the transcript only
      (fs as { lstatSync: unknown }).lstatSync = function lstatSync(p: unknown, ...rest: unknown[]): unknown {
        if (under.some((d) => String(p).startsWith(d))) lstats += 1;
        return (real as (...a: unknown[]) => unknown)(p, ...rest);
      };
      syncBuiltinESMExports();
      const r = await S.ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, IX.tsMs(0) + 180_000, ids), S.newBudget(() => (lstats >= 1 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]);
      expect(r, 'the sidecar waits: nothing read, nothing walked').toEqual({ bytes: 0, complete: false, paused: false });
      expect(lstats, "only the sidecar's own lstat; none for its group").toBe(1);
    } finally { (fs as { lstatSync: unknown }).lstatSync = real; syncBuiltinESMExports(); db.close(); }
  });

  /** An in-process import's context over the box, whose window limits count the windows at the read of `maxMs` (newBudget
   *  reads it once a window, before the window's listing, and nothing else reads it); `onWindow` runs there too. Past 40 the
   *  read throws, the one stop an import whose listing never ends has; the cases read the count directly. */
  type ImportS = { importSidecars(db: DatabaseSync, ctx: Record<string, unknown>, uuids: string[]): Promise<string> };
  const importCtx = (box: { home: string; homes: string[] }, ids: unknown, now: () => number, onWindow: () => void = () => {}) => {
    let windows = 0;
    const limits = { get maxMs() { windows += 1; onWindow(); if (windows > 40) throw new Error('more than 40 windows: the import does not end'); return 1_000; } };
    return { windows: () => windows, ctx: { home: box.home, homes: box.homes, paths: historyPaths(box.home), ids, now, out: () => {}, deps: { statfs: PLENTY, budget: limits } } };
  };

  it('a walk whose names can no longer reach the link holds nothing back: its sidecar deleted, the sidecar over SIDECAR_MAX_BYTES beside it never in a walk, the new name is linked and the wrap completes with its mark (D-6938)', async () => {
    const { sweep, lib } = await IX.api();
    const S = sweep as unknown as IxSweep;
    const box = IX.newBox('ccrc-hist-cp39-t3f-');
    IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    const dir = sideDir(box.homes[0]!);
    fs.writeFileSync(path.join(dir, 'out1.txt'), 'body 1\n');
    const big = path.join(dir, 'big.txt');
    fs.writeFileSync(big, '');
    fs.truncateSync(big, lib.SIDECAR_MAX_BYTES + 1);   // sparse: over the cap by its stat, with no block written
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const t0 = IX.tsMs(0) + 60_000;
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, t0, ids), S.newBudget(Date.now, { maxBytes: 1 }));   // the transcript only
      const pk = CP39.pkOf(db);
      // out1.txt starts a walk, which the budget cuts at its fifth row.
      const dec = await CP39.countDecodes();
      try { await S.ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, t0 + 60_000, ids), S.newBudget(() => (dec.n() >= 5 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { dec.restore(); }
      expect(CP39.walkState(db, pk)?.walk?.names, 'the walk takes only the names that can reach the link, never the sidecar over the cap').toEqual(['out1.txt']);
      fs.rmSync(path.join(dir, 'out1.txt'));
      fs.writeFileSync(path.join(dir, 'late.txt'), 'late body\n');
      // Two minutes on: only the sidecar scan is due, and its wrap visits the group.
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, t0 + 120_000, ids), S.newBudget());
      expect(CP39.sidecarRows(db).map((r) => r.name), 'the new name is taken in the same tick: no walk held it back').toEqual(['late.txt']);
      expect(metaV(db, 'scan_sidecars_ms'), 'the wrap completed clean: its mark is written').toBe(String(t0 + 120_000));
      expect(metaV(db, 'sidecars_unseen'), 'it took late.txt and left the sidecar over the cap unseen').toBe('2');
      expect(IX.count(db, 'meta', "k LIKE 'sidecar\\_walk:%' ESCAPE '\\'"), 'the group was examined in full: the walk state retired').toBe(0);
    } finally { db.close(); }
  });

  it('a walk that advanced no row over a whole visit of its group is retired, and the wrap counts every sidecar it left unseen, the deferred one included, in sidecars_unseen (D-6938)', async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as IxSweep;
    const box = IX.newBox('ccrc-hist-cp39-t3g-');
    IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    const dir = sideDir(box.homes[0]!);
    fs.writeFileSync(path.join(dir, 'out1.txt'), 'body 1\n');
    fs.writeFileSync(path.join(dir, 'locked.txt'), 'never admitted\n');
    // locked.txt is a small regular file whose every open is refused (EACCES), so admission refuses it before its link on
    // every pass: a name a walk can hold that never reaches the link. node:fs's DEFAULT openSync, carried to sweep.mjs.
    const realOpen = fs.openSync;
    (fs as { openSync: unknown }).openSync = function openSync(p: unknown, ...rest: unknown[]): unknown {
      if (String(p).endsWith('/locked.txt')) throw Object.assign(new Error(`EACCES: permission denied, open '${String(p)}'`), { code: 'EACCES' });
      return (realOpen as (...a: unknown[]) => unknown).call(fs, p, ...rest);
    };
    syncBuiltinESMExports();
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const t0 = IX.tsMs(0) + 60_000;
      const tick = (k: number, budget: IxBudget) => S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, t0 + k * 60_000, ids), budget);
      await tick(0, S.newBudget(Date.now, { maxBytes: 1 }));   // the transcript only
      const pk = CP39.pkOf(db);
      const dec = await CP39.countDecodes();
      try { await S.ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, t0 + 60_000, ids), S.newBudget(() => (dec.n() >= 5 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { dec.restore(); }
      expect(CP39.walkState(db, pk)?.walk?.names, 'CONTROL: a walk in progress holds locked.txt, which never reaches the link').toEqual(['locked.txt', 'out1.txt']);
      fs.rmSync(path.join(dir, 'out1.txt'));
      fs.writeFileSync(path.join(dir, 'late.txt'), 'late body\n');
      // Tick 2: the scan's visit of the group defers late.txt (the walk holds locked.txt, still unseen), refuses locked.txt, and advances no row.
      await tick(2, S.newBudget());
      expect(CP39.walkState(db, pk)?.walk ?? null, "the walk that advanced no row over its group's whole visit is retired").toBeNull();
      expect(metaV(db, 'sidecars_unseen'), 'the wrap left two unseen: late.txt deferred and locked.txt refused').toBe('2');
      expect(metaV(db, 'scan_sidecars_ms'), 'a deferral holds the mark').toBeNull();
      // Tick 3: a new wrap; late.txt starts an extension walk, which links it.
      await tick(3, S.newBudget());
      expect(CP39.sidecarRows(db).map((r) => r.name), 'late.txt is taken').toEqual(['late.txt']);
      expect(metaV(db, 'scan_sidecars_ms'), 'the next wrap completed clean: its mark').toBe(String(t0 + 3 * 60_000));
    } finally { (fs as { openSync: unknown }).openSync = realOpen; syncBuiltinESMExports(); db.close(); }
  });

  it('import: a window whose listing its budget cut resumes the listing from its own cursor in the next window, lists each uuid directory once, and ends done only with every sidecar seen (D-6932, D-6938)', async () => {
    const { S, box, db, ids } = await threeUuids('ccrc-hist-cp39-t3h-');
    try {
      const l = listings();
      let t = 0;
      let leapt = false;
      // The clock creeps, and leaps once, at its first read after the first tool-results/ listing: the first window's listing is cut there.
      const now = (): number => { if (!leapt && l.toolResults().length >= 1) { leapt = true; t += 10_000; } return (t += 1); };
      const im = importCtx(box, ids, now);
      let ended: string;
      try { ended = await (S as unknown as ImportS).importSidecars(db, im.ctx, [IX.U, IX.U2, IX.U3]); } finally { l.restore(); }
      expect(leapt, 'CONTROL: the clock leapt inside the first listing').toBe(true);
      expect(ended).toBe('done');
      expect(IX.count(db, 'sidecar_seen'), 'done only with every sidecar seen').toBe(3);
      expect(im.windows(), 'the cut listing ended its window, and the next resumed it').toBe(2);
      expect(l.toolResults(), 'each uuid directory listed once over the import').toEqual([IX.U, IX.U2, IX.U3]);
    } finally { db.close(); }
  });

  it('import: a listing cut before its first uuid directory lists the rest once with no budget, in the same window, and the next window ingests (D-6932)', async () => {
    const { S, box, db, ids } = await threeUuids('ccrc-hist-cp39-t3i-');
    try {
      const l = listings();
      let t = 0;
      let windows = 0;
      let leaptIn = 0;
      let base = 0;
      // The clock leaps at its first read after a window's first projects/ listing: every window's budgeted listing is cut
      // before its first uuid directory, so only the retry can end it.
      const now = (): number => { if (windows !== leaptIn && l.projects().length > base) { leaptIn = windows; t += 10_000; } return (t += 1); };
      const im = importCtx(box, ids, now, () => { windows += 1; base = l.projects().length; });
      let ended: string;
      try { ended = await (S as unknown as ImportS).importSidecars(db, im.ctx, [IX.U, IX.U2, IX.U3]); } finally { l.restore(); }
      expect(ended).toBe('done');
      expect(IX.count(db, 'sidecar_seen'), 'done only with every sidecar seen').toBe(3);
      expect(im.windows(), 'the retry ended the listing in the first window; the second ingested').toBe(2);
      expect(l.toolResults(), 'each uuid directory listed once, by the retry').toEqual([IX.U, IX.U2, IX.U3]);
    } finally { db.close(); }
  });

  it('a non-regular entry named like a sidecar, beside a walk whose sidecar is deleted, is never in a walk: the new name is linked and the wrap completes with its mark (D-6938)', async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as IxSweep;
    const box = IX.newBox('ccrc-hist-cp39-t3j-');
    IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    const dir = sideDir(box.homes[0]!);
    fs.writeFileSync(path.join(dir, 'out1.txt'), 'body 1\n');
    fs.mkdirSync(path.join(dir, 'dir.txt'));   // a directory under a sidecar's name: its lstat is no regular file
    const { db, ids } = await IX.openFixtureStore(box);
    try {
      const t0 = IX.tsMs(0) + 60_000;
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, t0, ids), S.newBudget(Date.now, { maxBytes: 1 }));   // the transcript only
      const pk = CP39.pkOf(db);
      // out1.txt starts a walk, which the budget cuts at its fifth row.
      const dec = await CP39.countDecodes();
      try { await S.ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, t0 + 60_000, ids), S.newBudget(() => (dec.n() >= 5 ? 10_000 : 0), { maxMs: 1_000 }), [IX.U]); } finally { dec.restore(); }
      expect(CP39.walkState(db, pk)?.walk?.names, 'the walk takes only the names that can reach the link, never the entry that is not a regular file').toEqual(['out1.txt']);
      fs.rmSync(path.join(dir, 'out1.txt'));
      fs.writeFileSync(path.join(dir, 'late.txt'), 'late body\n');
      // Two minutes on: only the sidecar scan is due, and its wrap visits the group.
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, t0 + 120_000, ids), S.newBudget());
      expect(CP39.sidecarRows(db).map((r) => r.name), 'the new name is taken in the same tick: no walk held it back').toEqual(['late.txt']);
      expect(metaV(db, 'scan_sidecars_ms'), 'the wrap completed clean: its mark is written').toBe(String(t0 + 120_000));
      expect(IX.count(db, 'meta', "k LIKE 'sidecar\\_walk:%' ESCAPE '\\'"), 'the group was examined in full: the walk state retired').toBe(0);
    } finally { db.close(); }
  });

  it("unseenOf leaves out a name whose lstat fails: a sidecar listed and then gone before its group's lstat holds nothing back and is no fault (D-6938)", async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as IxSweep;
    const box = IX.newBox('ccrc-hist-cp39-t3k-');
    IX.plantCopy(box.homes[0]!, IX.U, CP39.rows());
    const dir = sideDir(box.homes[0]!);
    fs.writeFileSync(path.join(dir, 'gone.txt'), 'listed, then gone\n');
    fs.writeFileSync(path.join(dir, 'out1.txt'), 'body 1\n');
    const { db, ids } = await IX.openFixtureStore(box);
    const real = fs.lstatSync;
    let failed = 0;
    try {
      const t0 = IX.tsMs(0) + 60_000;
      await S.ingestTick(db, S.makeIngestCtx(box.home, box.homes, t0, ids), S.newBudget(Date.now, { maxBytes: 1 }));   // the transcript only
      // gone.txt is listed (the listing reads names only), and every lstat of it answers ENOENT, the shape of a name deleted
      // between the listing and the lstat: its own lstat (counted missing, as today) and its group's, in unseenOf, when
      // out1.txt (sorted after it) asks for its link.
      (fs as { lstatSync: unknown }).lstatSync = function lstatSync(p: unknown, ...rest: unknown[]): unknown {
        if (String(p).endsWith('/tool-results/gone.txt')) {
          failed += 1;
          throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${String(p)}'`), { code: 'ENOENT' });
        }
        return (real as (...a: unknown[]) => unknown)(p, ...rest);
      };
      syncBuiltinESMExports();
      const r = await S.ingestSidecars(db, S.makeIngestCtx(box.home, box.homes, t0 + 60_000, ids), S.newBudget(), [IX.U]);
      expect(failed, "CONTROL: gone.txt's own lstat and its group's both failed").toBe(2);
      expect(CP39.sidecarRows(db).map((x) => x.name), 'out1.txt is taken in the same call: the failed lstat left gone.txt out of the walk').toEqual(['out1.txt']);
      expect(r['unreadable'], 'a failed lstat in unseenOf is no read error').toBeUndefined();
      expect(r.complete, 'the call completed').toBe(true);
    } finally { (fs as { lstatSync: unknown }).lstatSync = real; syncBuiltinESMExports(); db.close(); }
  });
});
```

  Run `(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts -t 'CP-39 Task 3')`. Predicted on Task 2's code:
  - case 1 red at 'the transcripts are done, so their scan is marked' (`expected null to be '<at>'`);
  - case 2 red at arm (a)'s 'arm (a): the transcript mark is set' (`expected null to be '<at>'`), its three CONTROL lines green first;
  - case 3 red at `threeUuids`' CONTROL 'the first wrap completed' (`expected null to be '<t0>'`: no sidecar mark exists yet);
  - case 4 red at the same CONTROL;
  - case 5 red at 'only the sidecar's own lstat' (`expected 31 to be 1`: Task 2's `unseenOf` checks no budget);
  - case 6 (the deferral wedge's case) red at 'the walk takes only the names that can reach the link …' (`expected [ 'big.txt', 'out1.txt' ] to deeply equal [ 'out1.txt' ]`: Task 2's `unseenOf` keeps the sidecar over the cap);
  - case 7 (the idle walk and the deferral arm) red at "the walk that advanced no row over its group's whole visit is retired" (Task 2 keeps a walk in progress whatever it defers), its CONTROL green first;
  - cases 8 and 9 (the import's cut listings) red at `threeUuids`' CONTROL 'the first wrap completed' (`expected null to be '<t0>'`), as cases 3 and 4 are: both open with `threeUuids`, whose first tick cannot write `scan_sidecars_ms` before Task 3. Their window-count reds are measured on Task 3's tree, under M3k and M3l (Step 6);
  - case 10 (a non-regular entry beside the deleted walk name) red at 'the walk takes only the names that can reach the link, never the entry that is not a regular file' (`expected [ 'dir.txt', 'out1.txt' ] to deeply equal [ 'out1.txt' ]`: Task 2's `unseenOf` keeps a directory its seenSame does not find);
  - case 11 (an lstat that fails in `unseenOf`) red at 'out1.txt is taken in the same call …' (`expected [] to deeply equal [ 'out1.txt' ]`: Task 2's `unseenOf` has no error arm, so the lstat's ENOENT escapes `linkCandidates` and `ingestSidecars` counts it as a read error on out1.txt), its CONTROL green first.
  Record what is measured.

- [ ] **Step 3: implement.**
  - **lib.mjs:** the three functions, each naming D-6938; declared in `lib.d.mts`.
  - **`walkTranscripts(homes, take, stop = null)`:** `if (stop !== null && stop()) return false;` before each home's `projects/` listing and before each slug's listing; `return true` at the end. `discoverTranscriptsWithin(homes, uuids, budget)` is `discoverTranscripts` with `stop = () => !budgetLeft(budget)`, answering `{ files, complete }`.
  - **`candidateFiles(db, ctx, scan, sideScan = scan, budget = null)`:** hinted files through `discoverTranscriptsWithin` (or `discoverTranscripts` when `budget` is null) add their uuids; behind files add theirs; `known = scan || sideScan ? knownUuids(db, ctx.home) : new Set()`; at the transcript scan, and only while nothing was cut, the known uuids' transcripts are discovered the same way and add no uuid. Answers `{ files, uuids, known, complete }`.
  - **`listSidecars(homes, uuids, budget, from = null)`:** `discoverSidecars`' walk. `from` is parsed to (home index, project, uuid) by the rostered home whose `${home}/projects/` prefixes it; homes before it are skipped without a listing, projects before its project are skipped without a listing, and in its project the uuid entries at or before its uuid are skipped. Before the `projects/` listing of each home, before each project listing and before each wanted uuid directory: `if (budget !== null && !budgetLeft(budget)) return { found, dirs, complete: false };`. `discoverSidecars(homes, uuids)` becomes `listSidecars(homes, uuids, null).found`.
  - **`unseenOf(db, g, budget)`:** `if (!budgetLeft(budget)) return null;` before its first lstat (the group's lstats run behind the same checks, the core ruling). `linkCandidates` answers `{ ready: false }` on null. **Only names that can reach the link** (the deferral wedge): from the same lstat, a sidecar that is not a regular file, or is over `SIDECAR_MAX_BYTES`, is left out of the set, since `ingestSidecar` returns for both before the link step and neither ever gets a `sidecar_seen` row. So no walk takes such a name (`startSidecarWalk` reads this set), and `linkCandidates` step 4 never defers a name for one: a walk in progress whose names are all deleted, seen, too large or not regular is replaced at once. **An lstat that throws** leaves its name out of the set too, whatever its code (ENOENT for a name deleted between the listing and the lstat, EACCES, ELOOP): `unseenOf` catches it per name, so it never escapes `linkCandidates` as a fault, and the sidecar that asked goes on to its link; that name's own `ingestSidecar` lstat counts it as today (`missing` for ENOENT). The comment names D-6938.
  - **The idle walk retired** (the deferral wedge, D-6938): in `ingestSidecars`, after a visit of a group that no budget cut and no stop (the floor, history-off) ended, whose walk in progress advanced no row in this call (`g.walked === 0`), the walk in progress is dropped (`state.walk = null`, `done` kept) and the state written in one `NORMAL` transaction. A deferral in the visit does not hold the retirement, and neither does a fs fault: a sidecar whose read throws on every pass (one that links from `done` and then faults) would otherwise keep a walk over a name that never reaches the link, deferring its uuid's new names for as long as it faults. A cut or a stop returns before the group's visit ends, so the retirement never sees one. A visit that advances no row is one in which none of the walk's names reached the link (each that did would advance it or finish it), and the sidecar scan visits every known uuid's group once a wrap, so a walk that advanced no row over a whole wrap is retired, and the next visit starts an extension that covers the deferred names.
  - **`ingestSidecars(db, ctx, budget, uuids, opts = {})`:**
    - The given share: `opts.found` when given (the import's list, Task 2), else `listSidecars(ctx.homes, due, budget)`; a cut listing returns `{ bytes, complete: false, paused: false, … }` at once. Its groups are examined as in Task 2.
    - The scan share, when `opts.scan` is a Set and the given share completed: `at = parseSidecarScanAt(getMeta(db, SIDECAR_SCAN_AT_META))`; the wanted set is `opts.scan` less the uuids `notCaughtUp` holds back and less the given share's uuids; `listSidecars(ctx.homes, wanted, budget, at.dir)`; groups by uuid in listing order, examined as in Task 2. Each sidecar taken adds 1 to `at.taken` at once. A fs error or a deferral sets `at.held`. After the loop or at a cut, `at.dir` moves to the last listed directory such that every listed directory up to it had all its sidecars examined or deferred; every sidecar of the directories it passes that this call left UNSEEN, too large, refused (by admission or a read error) or deferred, adds 1 to `at.left`. Only `examined` (Task 2's progress count) leaves a deferred sidecar out; `left` counts it.
    - If the scan share's listing completed and `at.dir` passed every directory it listed, the wrap is done: `const c = sidecarWrapClose(at)`, and in one `NORMAL` transaction `setMeta(db, SIDECARS_UNSEEN_META, String(c.unseen))`, `if (c.mark) setMeta(db, SIDECAR_SCAN_META, String(ctx.nowMs))`, and the `scan_sidecars_at` row deleted. Otherwise `setMeta(db, SIDECAR_SCAN_AT_META, formatSidecarScanAt(at))` when `at` changed. The call's `complete` is false while the scan share is not done.
  - **`ingestTick`:** `const sideScan = sidecarScanDue(db, ctx.nowMs);` and `candidateFiles(db, ctx, scan, sideScan, budget)`; `complete` starts as its `complete`. Split `unreadable` into `filesUnreadable` (set in the file loop) and `sidesUnreadable` (from `side.unreadable`). After the file loop: `recordExamined(db, ctx, examined, scan && complete && !filesUnreadable)`. The second `recordExamined(…, [], true)` call is deleted. The sidecar half is `ingestSidecars(db, ctx, budget, uuids, { scan: sideScan ? known : null })`, and its mark is that call's (above). The returned shape is unchanged.
  - **`importSidecars`** (D-6932, D-6938): its one listing moves under the windows' budgets, from a cursor of the import's own, kept across windows: `const listing = { found: [], from: null, complete: false };`. In each window, after `importPaused` and the window's `budget`, while the listing is not complete:

```js
    if (!listing.complete) {
      // CP-39 (D-6932, D-6938): the import lists the sidecars ONCE, under its windows' budgets, from a cursor of its own. A cut
      // listing is never 'done': one that passed a uuid directory is progress, resumed by the next window; one cut before its
      // first uuid directory lists the rest once with no budget (an import has no run budget, §9.2 "Backfill"), so it ends.
      let l = listSidecars(ctx.homes, uuids, budget, listing.from);
      if (!l.complete && l.dirs.length === 0) l = listSidecars(ctx.homes, uuids, null, listing.from);
      for (const f of l.found) listing.found.push(f);   // never a spread: a listing can hold about 135,000 entries
      if (l.dirs.length > 0) listing.from = l.dirs[l.dirs.length - 1];
      listing.complete = l.complete;
      // The window the listing did not finish, or spent, ingests nothing: the next window does, on a fresh budget.
      if (!listing.complete || !budgetLeft(budget)) {
        if (runJournalHalf(ctx.home, ctx.ids, ctx.now)) throw new JournalError('append-failed');
        continue;
      }
    }
```

    then `ingestSidecars(db, ictx, budget, uuids, { from, found: listing.found })` and Task 2's end rule, unchanged. Task 2's `discoverSidecars` line before the loop is deleted.
  - The doc comment's "The scan is marked done only when both halves examined everything" becomes: "Each half keeps its own mark: `scan_discover_ms` once the transcripts are examined, `scan_sidecars_ms` once a wrap of the sidecar scan's cursor has examined every known uuid's sidecars (D-6933, D-6938); a read error holds only its own half's mark (D-6934, narrowing D-4340's scan clause); discovery runs under the budget, and a cut listing resumes from the cursor (D-6938)". D-4340's comment at the `unreadable` declaration gains "(D-6934: its own half's mark)".

- [ ] **Step 4: the in-place edit of the sidecar-floor case.** Replace its two lines:

```ts
      // a sidecar half the floor cut short leaves the scan unmarked, so the next tick scans (and takes the sidecar) again
      expect((db.prepare("SELECT v FROM meta WHERE k = 'scan_discover_ms'").get() as { v: string }).v).toBe(String(at(0)));
```

with:

```ts
      // a sidecar half the floor cut short leaves its own scan unmarked (D-6933), so the next tick's sidecar scan covers
      // every known uuid again and takes the sidecar; the transcripts, done, have their own mark
      expect((db.prepare("SELECT v FROM meta WHERE k = 'scan_sidecars_ms'").get() as { v: string }).v).toBe(String(at(0)));
      expect((db.prepare("SELECT v FROM meta WHERE k = 'scan_discover_ms'").get() as { v: string }).v).toBe(String(at(1)));
```

  The edit grows the file by one line, which is fine: `history-ingest.test.ts` is not cited by line. Run Step 1's and Step 2's commands, then `(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts -t 'sidecar floor')`, then `-t 'D-4340'`, `-t 'unreadable roster'`, `-t 'CP-39 Task 2'` and `-t 'DM47'`. All are predicted green.

- [ ] **Step 5: run the card case that resets the scan clock.** `(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts -t 'periodic discovery scan')`. If that filter selects nothing, use the title of the case at `history-card.test.ts` that deletes `scan_discover_ms`. Predicted green: it needs the transcript scan only.

- [ ] **Step 6: the measured mutations.** For each, run Step 2's command, record the red title, restore and `cmp`.
  - **M3a:** restore `if (scan && complete && !unreadable) recordExamined(db, ctx, [], true)` as the only transcript mark. Predicted red: case 1 at 'the transcripts are done …'.
  - **M3b:** in `candidateFiles`, fill `known` only `if (scan)`. Predicted red: case 1 at 'the second sidecar is taken by the sidecar scan alone' (`expected 1 to be 2`).
  - **M3c:** use one `unreadable` for both marks. Predicted red: case 2 at 'arm (a): the transcript mark is set'.
  - **M3d:** in `listSidecars`, ignore `from`. Predicted red: case 3 at 'tick 2 lists only after its cursor'.
  - **M3e:** set `scan_sidecars_ms` whenever the scan share ran. Predicted red: case 3 at 'the mark waits for the whole wrap'.
  - **M3f:** reset `at.taken` to 0 at the start of each call. Predicted red: case 3 at 'the wrap took three, over three ticks' (`expected '1' to be '3'`).
  - **M3g:** drop `listSidecars`' budget checks. Predicted red: case 4 at 'one uuid directory listed, then the check failed'.
  - **M3h:** drop `walkTranscripts`' `stop`. Predicted red: case 4 at 'a spent budget lists nothing under projects/'.
  - **M3i:** drop `unseenOf`'s check. Predicted red: case 5 at 'only the sidecar's own lstat' (`expected 31 to be 1`).
  - **M3j:** in `importSidecars`, never set `listing.from` (every window lists from the start). Predicted red: case 8 at 'each uuid directory listed once over the import' (`[U, U, U2, U3]`).
  - **M3k:** in `importSidecars`, end the import on a cut listing (`if (!listing.complete) return 'done';` in place of going on). Predicted red: case 8 at 'done only with every sidecar seen' (`expected 0 to be 3`).
  - **M3l:** drop the unbudgeted retry. Predicted red: case 9, thrown 'more than 40 windows: the import does not end' (every window's listing is cut before its first uuid directory).
  - **M3m:** drop `|| !budgetLeft(budget)` (the listing's window ingests on the budget the listing spent). Predicted red: case 9 at 'done only with every sidecar seen' (`expected 0 to be 3`: that window examined nothing, and the end rule ended the import).
  - **M3n:** in `unseenOf`, keep a sidecar over `SIDECAR_MAX_BYTES` (the not-regular exclusion stays). Predicted red: case 6 at 'the walk takes only the names that can reach the link …' (`[ 'big.txt', 'out1.txt' ]`); case 10 stays green.
  - **M3o:** drop the idle walk's retirement. Predicted red: case 7 at "the walk that advanced no row over its group's whole visit is retired".
  - **M3p:** add to `at.left` only the sidecars examined and left unseen, never a deferred one. Predicted red: case 7 at 'the wrap left two unseen: late.txt deferred and locked.txt refused' (`expected '1' to be '2'`).
  - **M3q:** in `unseenOf`, keep an entry that is not a regular file (the over-the-cap exclusion stays). Predicted red: case 10 at 'the walk takes only the names that can reach the link, never the entry that is not a regular file' (`[ 'dir.txt', 'out1.txt' ]`); case 6 stays green.
  - **M3r:** in `unseenOf`, drop the per-name catch, so a failed lstat escapes. Predicted red: case 11 at 'out1.txt is taken in the same call …' (`expected [] to deeply equal [ 'out1.txt' ]`).

- [ ] **Step 7: commit.** `fix(history-sweep): give each ingest half its own scan mark and bound discovery by the budget from a resumable cursor (CP-39 Task 3; D-6933, D-6934, D-6938)`.

---

### Task 4: the derivation's reserve inside the ONE run budget, as ceilings and real floors (D-6935, D-6936, D-6939)

**Files:**
- Modify: `ccd/history/lib.mjs`: after `REDERIVE_SLICE_BYTES` (:221), add `DERIVE_SHARES`, `budgetRungs` and `budgetFloors`. `ccd/history/lib.d.mts` after :49.
- Modify: `ccd/history/sweep.mjs`:
  - lib import: add `DERIVE_SHARES`, `budgetRungs`, `budgetFloors`;
  - after `budgetLeft` (:4350-:4353): `budgetRung`, `stepSlice`, `runRungs`;
  - `tick` (:3671-:3782): the call sites at :3738, :3746, :3752, :3758, :3759 and :3763;
  - `tick`'s docstring entries 11, 14, 15, 16 and 18 (wording only; names and order unchanged);
  - `periodicCensus` (:7494-:7508): its `exportCensus(db, nowMs, ctx.budget);` at :7507.
- The spec: NOT in this PR. The coordinator applies line :2101's amendment (below) in its docs PR once W2-6's claim on the spec is released.
- Test: append to `server/test/history-lib.test.ts`, `server/test/history-ingest.test.ts` and `server/test/history-derive.test.ts`; ONE in-place edit of `server/test/history-card.test.ts` (:1252-:1279).

**Interfaces:**

```js
/** lib.mjs (D-6935, D-6939). The derivation's shares of the ONE run budget, in per-mille of its limits (chosen), in tick
 *  order: the FTS backfill, the leaves (deriveNodes), the card step and the export census. One set of numbers serves the
 *  ladder of ceilings and the floors. Ingest, its discovery and its sidecars included, gets what the shares leave below
 *  its ceiling (600 per mille: 54 s and about 307 MiB of the default budget, from the run's start). */
export const DERIVE_SHARES = Object.freeze({ fts: 150, nodes: 100, card: 50, census: 100 });
/** The ceilings, as limits of the same run budget: ingest's is the budget less every share; each step's is the budget less
 *  the shares of the steps after it; the census's is the budget itself. Integers, floor(max * (1000 - after) / 1000), never
 *  above the run's own limits, and at least 1 whenever the run's own limit is at least 1 (P1: a one-byte run still reads
 *  its one chunk). */
export function budgetRungs({ maxMs, maxBytes }, shares = DERIVE_SHARES)
  /* -> { ingest, fts, nodes, card, census }: each { maxMs, maxBytes } */;
/** The floors (D-6939): each step's share of the run's limits, floor(max * share / 1000), with no minimum: a run too small
 *  to have a share gives none. */
export function budgetFloors({ maxMs, maxBytes }, shares = DERIVE_SHARES)
  /* -> { fts, nodes, card, census }: each { maxMs, maxBytes } */;
```

```js
/** sweep.mjs (D-6935). Ingest's ceiling rung of the run budget: the run's clock, start and byte count, SHARED through
 *  accessors, under lower limits. Bytes charged to it are the run's; it never resets anything (O5). */
export function budgetRung(budget, limits);
/** sweep.mjs (D-6939). A derivation step's slice of the run budget: it starts at the step's own start (one clock read),
 *  and its limits are max(what is left of the step's ceiling, the step's floor), in ms and in bytes, as D-4344's
 *  rederiveSlice is a budget of its own. Its byte count starts at 0 and every charge to it is charged to the run. */
export function stepSlice(budget, ceiling, floor);
/** The tick's rungs (D-6935, D-6939): { ingest: budgetRung(…), slice(step) }, where slice('fts' | 'nodes' | 'card' |
 *  'census') makes that step's stepSlice at the moment it is called. No db, no clock read until a slice is made. */
export function runRungs(budget);
```

- [ ] **Step 0: check the base.** Each of these must show exactly one line, else stop:
  - `grep -n "await ingestTick(db, ictx, ctx.budget)" ccd/history/sweep.mjs` (:3738)
  - `grep -n "await deriveFts(db, ictx, ctx.budget)" ccd/history/sweep.mjs` (:3746)
  - `grep -n "deriveNodes(db, ictx, ctx.budget)" ccd/history/sweep.mjs` (:3752)
  - `grep -n "budgetLeft: budgetLeft(ctx.budget) }" ccd/history/sweep.mjs` (:3758)
  - `grep -n "cardStep(db, ictx, ctx.budget)" ccd/history/sweep.mjs` (:3759)
  - `grep -n "  mergeSteps(db, ictx, ctx.budget);" ccd/history/sweep.mjs` (:3763)
  - `grep -n "  exportCensus(db, nowMs, ctx.budget);" ccd/history/sweep.mjs` (:7507)
  - `grep -n "const r = runDriver(box, { budgetBytes: 1 });" server/test/history-card.test.ts` (:1271)
  - `grep -rn "budgetLeft: budgetLeft(ctx.budget)" server/test` (nothing).

- [ ] **Step 1: the lib case (red).** Append to `history-lib.test.ts`:

```ts
describe('CP-39 Task 4: the ladder of ceilings and the floors, from one set of shares (D-6935, D-6939)', () => {
  it('the default budget: ingest ends at 54 s; each step\'s ceiling is the budget less the shares after it; each floor is its share; the floors sum to 36 s', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    expect(lib.DERIVE_SHARES).toEqual({ fts: 150, nodes: 100, card: 50, census: 100 });
    const run = { maxMs: lib.RUN_BUDGET_MS, maxBytes: lib.RUN_BUDGET_BYTES };
    const r = lib.budgetRungs(run);
    expect(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.maxMs]))).toEqual({ ingest: 54_000, fts: 67_500, nodes: 76_500, card: 81_000, census: 90_000 });
    expect(r.ingest.maxBytes).toBe(Math.floor(lib.RUN_BUDGET_BYTES * 600 / 1000));
    expect(r.census).toEqual(run);
    const f = lib.budgetFloors(run);
    expect(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.maxMs]))).toEqual({ fts: 13_500, nodes: 9_000, card: 4_500, census: 9_000 });
    expect(f.fts.maxBytes).toBe(Math.floor(lib.RUN_BUDGET_BYTES * 150 / 1000));
    expect(Object.values(f).reduce((n, x) => n + x.maxMs, 0), 'the overrun bound\'s time part').toBe(36_000);
  });
  it('a ceiling admits one unit whenever the run\'s own limit is at least 1; a floor rounds down to none (P1)', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    for (const v of Object.values(lib.budgetRungs({ maxMs: 1, maxBytes: 1 }))) expect(v).toEqual({ maxMs: 1, maxBytes: 1 });
    for (const v of Object.values(lib.budgetRungs({ maxMs: 0, maxBytes: 0 }))) expect(v).toEqual({ maxMs: 0, maxBytes: 0 });
    for (const v of Object.values(lib.budgetFloors({ maxMs: 1, maxBytes: 1 }))) expect(v).toEqual({ maxMs: 0, maxBytes: 0 });
  });
  it('monotone, integral and never above the run\'s limits, for any budget a test injects', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    for (const b of [{ maxMs: 0, maxBytes: 0 }, { maxMs: 1, maxBytes: 1 }, { maxMs: 35, maxBytes: 1024 }, { maxMs: 1_000, maxBytes: 7 }]) {
      const r = lib.budgetRungs(b);
      const order = [r.ingest, r.fts, r.nodes, r.card, r.census];
      for (let i = 1; i < order.length; i += 1) {
        expect(order[i]!.maxMs).toBeGreaterThanOrEqual(order[i - 1]!.maxMs);
        expect(order[i]!.maxBytes).toBeGreaterThanOrEqual(order[i - 1]!.maxBytes);
      }
      for (const x of [...order, ...Object.values(lib.budgetFloors(b))]) {
        expect(Number.isInteger(x.maxMs) && x.maxMs <= b.maxMs).toBe(true);
        expect(Number.isInteger(x.maxBytes) && x.maxBytes <= b.maxBytes).toBe(true);
      }
    }
  });
});
```

  Run `(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'CP-39 Task 4')`. Predicted: 3 red, `expected undefined to deeply equal …` or `is not a function`.

- [ ] **Step 1b: the rung and slice cases (red).** Append to `history-ingest.test.ts`. The clock is one the test moves by hand (P16), so a rung that took the clock when it was made, or a slice that kept the run's start, reads differently from one that did not.

```ts
describe('CP-39 Task 4: a ceiling rung keeps the run\'s start; a step slice starts at its step and keeps its floor (D-6935, D-6939)', () => {
  interface Lim { maxMs: number; maxBytes: number }
  interface R4 { budgetRung(b: IxBudget, l: Lim): IxBudget; stepSlice(b: IxBudget, ceiling: Lim, floor: Lim): IxBudget; budgetLeft(b: IxBudget): boolean }
  it('a ceiling rung: the run\'s start and bytes, shared; spent at its own maxMs and maxBytes while the run is live; never above the run', async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as IxSweep & R4;
    let t = 1_000;
    const run = S.newBudget(() => t, { maxMs: 100, maxBytes: 100 });   // starts at 1000
    t = 1_030;                                                           // the run has aged when the rung is made
    const rung = S.budgetRung(run, { maxMs: 50, maxBytes: 60 });
    expect(rung.startMs, "the rung keeps the run's start (O5), not the moment it was made").toBe(1_000);
    t = 1_049;
    expect(S.budgetLeft(rung), 'inside its maxMs').toBe(true);
    t = 1_050;
    expect(S.budgetLeft(rung), 'spent at its own maxMs').toBe(false);
    expect(S.budgetLeft(run), 'CONTROL: the run is live').toBe(true);
    const fresh = S.newBudget(() => 0, { maxMs: 100, maxBytes: 100 });
    const byBytes = S.budgetRung(fresh, { maxMs: 50, maxBytes: 60 });
    byBytes.bytes += 70;
    expect(fresh.bytes, "a charge to the rung is the run's").toBe(70);
    expect(S.budgetLeft(byBytes), 'spent at its own maxBytes').toBe(false);
    expect(S.budgetLeft(fresh), 'CONTROL: the run is not').toBe(true);
    const over = S.budgetRung(run, { maxMs: 999, maxBytes: 999 });
    expect([over.maxMs, over.maxBytes], "never above the run's limits").toEqual([100, 100]);
  });
  it('a step slice: it starts at the step, takes the larger of what is left of its ceiling and its floor, and charges the run', async () => {
    const { sweep } = await IX.api();
    const S = sweep as unknown as IxSweep & R4;
    let t = 1_000;
    const run = S.newBudget(() => t, { maxMs: 100, maxBytes: 100 });
    // Before its ceiling: what is left of the ceiling is more than the floor.
    t = 1_020;
    run.bytes = 30;
    const early = S.stepSlice(run, { maxMs: 80, maxBytes: 80 }, { maxMs: 10, maxBytes: 20 });
    expect([early.startMs, early.maxMs, early.maxBytes, early.bytes], "the step's start; 80 - 20 ms and 80 - 30 bytes left").toEqual([1_020, 60, 50, 0]);
    // Past the run's time and past the ceiling's bytes (90 of 80): the floor, in ms and in bytes, from the step's own start.
    t = 1_150;
    run.bytes = 90;
    expect(S.budgetLeft(run), 'CONTROL: the run is spent').toBe(false);
    const late = S.stepSlice(run, { maxMs: 80, maxBytes: 80 }, { maxMs: 10, maxBytes: 20 });
    expect([late.startMs, late.maxMs, late.maxBytes], 'the floor, counted from the step').toEqual([1_150, 10, 20]);
    t = 1_159;
    expect(S.budgetLeft(late), 'inside its floor though the run is spent').toBe(true);
    late.bytes += 15;
    expect(run.bytes, "a charge to the slice is the run's").toBe(105);
    t = 1_160;
    expect(S.budgetLeft(late), 'spent at its floor').toBe(false);
  });
});
```

  Run `(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts -t 'CP-39 Task 4')`. Predicted red: `S.budgetRung is not a function`, `S.stepSlice is not a function`.

- [ ] **Step 2: the starvation describe (red).** Append to `history-derive.test.ts` (it has `plant`, `settle`, `compactionSequence`, `q`, `leavesOf`, `counters`, `openWriter`, `closeWriter`, `withTx`, `historyPaths` and `leafId` in scope; add `cardLine` and `displayPrefixes` to its `lib.mjs` import, both already declared in `lib.d.mts`). Its in-process pass replaces the budget's `now` after `passCtx` builds it, so the clock moves 1 s at each BUDGET read and at nothing else: the steps' limits, never the pass's other clock reads, decide what each step gets. Its second arm adds an injected clock jump inside the first `tool-results/` listing (P13): a discovery that overruns the whole run before any derivation step, the measured cold-cache shape. Its fixture deletes the census's completion and its W1-k dates, so the second arm's census assertions read this pass alone (P17). Its third arm (P1) injects a run of 18 s through `deps.budget`, the seam the floors are derived from: the card step's floor is then a POSITIVE 900 ms (and 25.6 MiB), less than the 1 s the clock moves between the slice's start and its first check, so the card step starts with its own positive floor already spent. The fixture's prediction is the real card line for U's next compaction, so a card step that may not write keeps it and the withdrawal counts it (P1): placeholder text would be deleted by the card step first, and both card assertions would hold on any tree.

```ts
// ── CP-39 Task 4 (D-6935, D-6939): every derivation step advances, whatever ingest and its discovery spent ─────────────────
describe('CP-39 Task 4: every derivation step advances in a pass whose ingest or discovery spent the run (D-6935, D-6939)', () => {
  const ID = 'claude-cp39-starve';
  const U = '0189abcd-1234-4678-9abc-0000000039a1';
  const SIDECARS = 150;
  interface Budget { startMs: number; now: () => number }
  interface SW {
    passCtx(o: Record<string, unknown>): Record<string, unknown> & { budget: Budget };
    idsFromFiles(P: unknown): { storeId: string; writer: string } | null;
    tick(db: unknown, ctx: unknown): Promise<void>;
    periodicCensus(db: unknown, ctx: unknown): void;
    resetFtsPending(db: unknown): void;
  }
  /** A settled store (three spawned passes) whose leaves are wiped and whose every indexed blob is owed to the FTS backfill
   *  again, a REAL card prediction on disk (the line the card step predicts for U's next compaction), and SIDECARS
   *  unlinked sidecars: the backlog shape measured on the fleet box. */
  const starve = (prefix: string): { box: HistoryBox; owed: number[]; settledAt: number; cardFile: string } => {
    const box = makeHistoryBox(prefix);
    const seq = compactionSequence({ n: 6, trigger: 'manual', seed: 0x39, sessionId: U, startMs: T0 });
    plant(box, ID, U, seq.rows);
    settle(box);
    const settledAt = Date.now();
    const w = openWriter(historyPaths(box.home).dbFile);
    let owed: number[] = [];
    try {
      withTx(w, 'NORMAL', () => {
        w.prepare('DELETE FROM node_refs').run();
        w.prepare('DELETE FROM nodes_fts').run();
        w.prepare('DELETE FROM nodes').run();
        w.prepare("DELETE FROM derivation_state WHERE step = 'leaves'").run();
        // The census's completion and W1-k's dates, which settle's passes wrote: the census asserted below is this pass's alone (P17).
        w.prepare("DELETE FROM meta WHERE k IN ('export_census_ms', 'oldest_row_ms', 'first_due_ms', 'first_deletion_ms')").run();
        owed = (w.prepare('SELECT blob_id FROM blobs WHERE fts_indexed = 1 ORDER BY blob_id').all() as { blob_id: number }[]).map((r) => r.blob_id);
        for (const id of owed) {
          w.prepare('DELETE FROM blobs_fts WHERE rowid = ?').run(id);
          w.prepare('UPDATE blobs SET fts_indexed = 0 WHERE blob_id = ?').run(id);
        }
      });
    } finally { closeWriter(w); }
    const dir = path.join(box.accountHome['claude']!, 'projects', SLUG, U, 'tool-results');
    fs.mkdirSync(dir, { recursive: true });
    for (let k = 0; k < SIDECARS; k += 1) fs.writeFileSync(path.join(dir, `cp39-${String(k).padStart(3, '0')}.txt`), `cp39 unlinked body ${k}\n`);
    const cardFile = path.join(box.root, 'card', ID, `${U}.txt`);
    fs.mkdirSync(path.dirname(cardFile), { recursive: true });
    // A REAL card line (P1), never placeholder text: a card step that may not write deletes a file that is no card line
    // (lib decideCardFile), and the withdrawal after it would find nothing to count. This is the line for U's next
    // compaction: its leaf starts at the last boundary's head (lib predictedSpanStart), with no parent (six leaves make no
    // fan-in group and no condensed node). Should the pass's own prediction print it otherwise (a parent, a longer prefix),
    // decideCardFile's same-leaf arm still keeps it whenever the step may not write.
    const leaf = leafId(ID, U, seq.headUuids[5]!);
    fs.writeFileSync(cardFile, `${cardLine({ leaf: displayPrefixes([leaf]).get(leaf)!, parent: null })}\n`);
    return { box, owed, settledAt, cardFile };
  };
  /** One in-process scheduled pass, past SCAN_INTERVAL_MS after the settle (every scan and the census are due) and inside the
   *  export pass's hour (it waits). `limits`, when given, are the run's (deps.budget). Answers how far the budget's clock
   *  moved from the run's start. */
  const pass = async (box: HistoryBox, settledAt: number, jumpMs = 0, limits?: { maxMs?: number; maxBytes?: number }): Promise<number> => {
    const S = (await import('../../ccd/history/sweep.mjs')) as unknown as SW;
    const { syncBuiltinESMExports } = await import('node:module');
    const P = historyPaths(box.home);
    let t = settledAt + 40 * 60_000;
    const ctx = S.passCtx({
      home: box.home, P, ids: S.idsFromFiles(P), now: () => t, out: () => undefined,
      parsed: { homes: box.homes, secrets: [], unanswered: [], rosterUnreadable: false },
      deps: { managedSettings: [], ...(limits === undefined ? {} : { budget: limits }) }, pause: null, ingest: true,
    });
    ctx.budget.now = () => (t += 1_000);   // the budget's `now` seam: only budget reads move the clock
    const realReaddir = fs.readdirSync;
    let jumped = jumpMs === 0;
    (fs as { readdirSync: unknown }).readdirSync = function readdirSync(p: unknown, ...rest: unknown[]): unknown {
      if (!jumped && String(p).endsWith('/tool-results')) { jumped = true; t += jumpMs; }
      return (realReaddir as (...a: unknown[]) => unknown).call(fs, p, ...rest);
    };
    syncBuiltinESMExports();
    const db = openWriter(P.dbFile);
    try {
      S.resetFtsPending(db);
      await S.tick(db, ctx);
      S.periodicCensus(db, ctx);
    } finally {
      (fs as { readdirSync: unknown }).readdirSync = realReaddir;
      syncBuiltinESMExports();
      closeWriter(db);
    }
    expect(jumped, 'CONTROL: a tool-results/ listing ran (and took the jump, when one was asked)').toBe(true);
    return t - ctx.budget.startMs;
  };
  const seenOf = (box: HistoryBox): number => q<{ n: number }>(box, 'SELECT count(*) AS n FROM sidecar_seen')[0]!.n;
  const indexedOf = (box: HistoryBox, owed: number[]): number =>
    q<{ n: number }>(box, `SELECT count(*) AS n FROM blobs WHERE fts_indexed = 1 AND blob_id IN (${owed.join(',')})`)[0]!.n;

  it('an ingest that overran its ceiling: the FTS backfill and the leaves advance in the same pass, and the pass ends near the run budget', async () => {
    const lib = await import('../../ccd/history/lib.mjs');
    const { box, owed, settledAt } = starve('ccrc-hist-cp39-starve-a-');
    expect(owed.length, 'CONTROL: more owed blobs than the FTS step can take in one pass, so it runs to its limit').toBeGreaterThan(30);
    const spent = await pass(box, settledAt);
    expect(seenOf(box), 'CONTROL: the budget cut the ingest, sidecars left').toBeLessThan(SIDECARS);
    const indexed = indexedOf(box, owed);
    expect(indexed, 'the FTS backfill indexed owed blobs in the same pass').toBeGreaterThan(0);
    expect(indexed, 'CONTROL: the backlog outlasted the FTS step').toBeLessThan(owed.length);
    expect(leavesOf(box, U).length, 'the leaves were derived in the same pass').toBeGreaterThan(0);
    // Ingest ended at its ceiling, so the steps after it shared what the run had left and the pass ended near RUN_BUDGET_MS.
    // An ingest on the whole run would leave each step only its floor past it: about RUN_BUDGET_MS plus the floors' 36 s.
    expect(spent, 'the pass ended within the run budget plus half the floors\' sum').toBeLessThanOrEqual(lib.RUN_BUDGET_MS + 18_000);
  }, 240_000);

  it('a discovery that overran the whole run before any derivation step: the FTS backfill, the leaves, the card step and the export census each still advance, on its own floor (P13)', async () => {
    const { box, owed, settledAt, cardFile } = starve('ccrc-hist-cp39-starve-b-');
    const metaOf = (k: string): string | null => q<{ v: string }>(box, 'SELECT v FROM meta WHERE k = ?', k)[0]?.v ?? null;
    expect(metaOf('export_census_ms'), 'CONTROL: no census completion stands before the pass').toBeNull();
    expect(fs.existsSync(cardFile), 'CONTROL: a prediction stands before the pass').toBe(true);
    await pass(box, settledAt, 100_000);   // past the 70 s the ruling names, and past the whole 90 s run
    expect(seenOf(box), 'CONTROL: the discovery overran and the ingest was cut').toBeLessThan(SIDECARS);
    expect(indexedOf(box, owed), 'the FTS backfill indexed owed blobs on its floor').toBeGreaterThan(0);
    expect(leavesOf(box, U).length, 'the leaves were derived on their floor').toBeGreaterThan(0);
    expect(counters(box)['card_withdrawn:budget'], 'the card step ran on its floor: no prediction withdrawn for budget').toBeUndefined();
    expect(fs.existsSync(cardFile), 'the prediction stands: the card step kept it, and no withdrawal took it').toBe(true);
    const after = metaOf('export_census_ms');
    expect(after, 'the census completed in this pass, on its floor').not.toBeNull();
    expect(Number(after), 'a census of this pass, after the settle').toBeGreaterThanOrEqual(settledAt + 40 * 60_000);
    for (const k of ['oldest_row_ms', 'first_due_ms', 'first_deletion_ms']) expect(metaOf(k), `${k} recorded`).not.toBeNull();
  }, 240_000);

  it("the card step's own floor, positive and spent before its first check: the prediction left is withdrawn, counted card_withdrawn:budget (P1)", async () => {
    const { box, settledAt, cardFile } = starve('ccrc-hist-cp39-starve-c-');
    // A run of 18 s, injected through deps.budget, the seam the floors are derived from (DERIVE_SHARES of the run's limits).
    const limits = { maxMs: 18_000 };
    // The card's floor by plain arithmetic: DERIVE_SHARES.card is 50 per mille (Task 4 Step 4), written here as a literal,
    // because this arm first runs on Task 3's tree, where lib has neither DERIVE_SHARES nor budgetFloors.
    expect(Math.floor(limits.maxMs * 50 / 1000), "CONTROL: the card's floor is positive and under the clock's 1 s step").toBe(900);
    expect(fs.existsSync(cardFile), 'CONTROL: a prediction stands before the pass').toBe(true);
    // The jump puts the card step past its 16.2 s ceiling (budgetRungs: 18 s less the census's 100 per mille), so its slice
    // is its floor alone, from its own start; the slice's first check is 1 s later, past its 900 ms.
    await pass(box, settledAt, 100_000, limits);
    expect(seenOf(box), 'CONTROL: the discovery overran and the ingest was cut').toBeLessThan(SIDECARS);
    expect(counters(box)['card_withdrawn:budget'], "the card step's own positive floor was spent: its prediction withdrawn, counted for budget").toBe(1);
    expect(fs.existsSync(cardFile), 'the prediction is gone').toBe(false);
  }, 240_000);
});
```

  Run `(cd server && ./node_modules/.bin/vitest run test/history-derive.test.ts -t 'CP-39 Task 4')` on Task 3's tree (the base's derivation wiring: every step on `ctx.budget`). Predicted: the first two arms red at 'the FTS backfill indexed owed blobs …' (`expected 0 to be greater than 0`): the first because the ingest spends the whole run, the second because the jump does. The third arm GREEN, and green on the base too, whose card wiring Task 3 leaves as it is: its CONTROL is plain arithmetic, so nothing of Task 4 is called, and the base's card step reads the spent run budget (an 18 s run, 100 s past its start). `cardPass.budgetLeft` is false, so the pass withdraws, and the card step, which may not write, keeps the fixture's card line (decideCardFile's same-line and same-leaf arms), so the withdrawal unlinks it: `card_withdrawn:budget` is 1. It is a regression pin of the floor's own bound (a slice is its share, never a reset), and its red is M4l's, measured on the fixed tree. If a CONTROL is red instead (`owed` not above 30, or `seen` not below SIDECARS), the fixture does not overrun: raise `n` or `SIDECARS`, never weaken an assertion. Record the measured titles: this is the red measured on the pre-fix ladder the core ruling asks for.

- [ ] **Step 3: the in-place edit of the card case (its premise only).** The case 'a budget spent before the card step' (`history-card.test.ts` :1252-:1279) keeps its fixture, its driver call and its assertions. Its premise moves: the card step now has a slice of its own, and what a one-byte run spends is that slice, whose byte limit is max(1 less the run's bytes, floor(1 × 50 / 1000) = 0) = 0. That is the zero floor a one-byte run rounds every share to, so this case is NOT P1's pin: the positive floor spent is Step 2's third arm, measured red by M4l. Change its title to

  `'the card step\'s own floor spent (a one-byte run gives every derivation step a byte floor of 0): the consume and delete still run, nothing is written, and the predictions left are withdrawn, counted card_withdrawn:budget'`

  and its comment at :1269-:1270 to:

```ts
    // One byte of budget (D-6935, D-6939): ingest's ceiling admits one unit, so A's one chunk of new rows is read; every
    // derivation step's floor is floor(1 x share / 1000) = 0 bytes, so the card step's own slice is spent when it starts.
```

  Run `(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts -t 'own floor spent')`. Predicted green on Task 3's tree: its outcome does not change, only its premise; its red is M4k's, at its CONTROL.

- [ ] **Step 4: implement.**
  - lib.mjs, after `REDERIVE_SLICE_BYTES`:

```js
/** CP-39 (D-6935, D-6939): the derivation's shares of the ONE run budget, per mille of its limits, in tick order (chosen).
 *  One set of numbers serves the ladder of ceilings (budgetRungs) and the floors (budgetFloors). Measured on the fleet box:
 *  every budget-gated derivation starved while ingest owned the whole budget, and under load the sweep unit (shipped at
 *  Nice=19 with idle I/O) got 0.1-0.17 of a core, so 90 s of wall clock was about 9-15 s of CPU. The FTS backfill takes
 *  the largest share, being the largest backlog by count (at most about 486,000 blobs owed) and the one every grep
 *  waits on; the leaves and the census 10% each (the census builds one
 *  file clock, a stat per recorded file, before its first chunk, over about 1.14 million blobs); the card step 5% (a few
 *  cards a tick in steady state). Ingest keeps 60%, which still drains a backlog over ticks (§9.2 step 7). */
export const DERIVE_SHARES = Object.freeze({ fts: 150, nodes: 100, card: 50, census: 100 });
const RUNG_ORDER = Object.freeze(['fts', 'nodes', 'card', 'census']);
const perMille = (max, k) => Math.floor(max * k / 1000);
/** D-6935: each ceiling admits one unit whenever the run's own limit is at least 1 (P1). */
const ceilingOf = (max, k) => (max >= 1 ? Math.max(1, perMille(max, k)) : 0);
export function budgetRungs({ maxMs, maxBytes }, shares = DERIVE_SHARES) {
  const at = (after) => ({ maxMs: ceilingOf(maxMs, 1000 - after), maxBytes: ceilingOf(maxBytes, 1000 - after) });
  const sumOf = (keys) => keys.reduce((n, k) => n + shares[k], 0);
  const out = { ingest: at(sumOf(RUNG_ORDER)) };
  RUNG_ORDER.forEach((k, i) => { out[k] = at(sumOf(RUNG_ORDER.slice(i + 1))); });
  return out;
}
/** D-6939: each step's floor is its share of the run's limits, rounded down, with no minimum. */
export function budgetFloors({ maxMs, maxBytes }, shares = DERIVE_SHARES) {
  return Object.fromEntries(RUNG_ORDER.map((k) => [k, { maxMs: perMille(maxMs, shares[k]), maxBytes: perMille(maxBytes, shares[k]) }]));
}
```

    Declare all three in `lib.d.mts`.
  - sweep.mjs, after `budgetLeft`:

```js
/** Ingest's ceiling rung of the run's ONE budget (CP-39, D-6935): its clock, start and byte count are the run's, shared
 *  through accessors, under the rung's lower limits. Never a reset: bytes charged to a rung are charged to the run (O5). */
export function budgetRung(budget, limits) {
  return {
    get startMs() { return budget.startMs; },
    now: budget.now,
    chunkBytes: budget.chunkBytes,
    maxMs: Math.min(limits.maxMs, budget.maxMs),
    maxBytes: Math.min(limits.maxBytes, budget.maxBytes),
    get bytes() { return budget.bytes; },
    set bytes(v) { budget.bytes = v; },
  };
}
/** A derivation step's slice of the run's ONE budget (CP-39, D-6939): it starts at the step's own start, and holds the larger
 *  of what is left of the step's ceiling and the step's floor, in ms and in bytes, as D-4344's rederiveSlice is a budget of
 *  its own. Its byte count starts at 0, and every charge to it is a charge to the run. */
export function stepSlice(budget, ceiling, floor) {
  const startMs = budget.now();
  const base = budget.bytes;
  return {
    startMs,
    now: budget.now,
    chunkBytes: budget.chunkBytes,
    maxMs: Math.max(ceiling.maxMs - (startMs - budget.startMs), floor.maxMs),
    maxBytes: Math.max(ceiling.maxBytes - base, floor.maxBytes),
    get bytes() { return budget.bytes - base; },
    set bytes(v) { budget.bytes = base + v; },
  };
}
/** The tick's rungs (D-6935, D-6939): ingest's ceiling, and each derivation step's slice, made when the step starts. */
export function runRungs(budget) {
  const limits = { maxMs: budget.maxMs, maxBytes: budget.maxBytes };
  const ceilings = budgetRungs(limits);
  const floors = budgetFloors(limits);
  return { ingest: budgetRung(budget, ceilings.ingest), slice: (step) => stepSlice(budget, ceilings[step], floors[step]) };
}
```

  - `tick`:
    - after `beltNodesStep(db, ictx, slice);`, add `const rungs = runRungs(ctx.budget);` with the comment `// CP-39 (D-6935, D-6939): ingest stops at its ceiling of the ONE budget; each derivation step runs on its own slice from its own start.`;
    - then `ingestTick(db, ictx, rungs.ingest)`, `deriveFts(db, ictx, rungs.slice('fts'))`, `deriveNodes(db, ictx, rungs.slice('nodes'))`;
    - `const card = rungs.slice('card');` just before `cardPass`, then `budgetLeft: budgetLeft(card)` in `cardPass`, `cardStep(db, ictx, card)` and `mergeSteps(db, ictx, card)`;
    - `exportStep(db, ctx)` keeps `ctx.budget` (see "Not in this plan").
    The D-4740 comment above `cardPass` gains "(the card step's own slice, D-6939)". The docstring entries 11, 14, 15, 16 and 18 say "within its ceiling of the run's ONE budget (D-6935)" (11) and "on its own slice of the run's ONE budget (D-6939)" (14, 15, 16; 18 "on the card step's slice") where they now say "the run's ONE budget" or "what is left of the budget".
  - `periodicCensus`: `exportCensus(db, nowMs, runRungs(ctx.budget).slice('census'));` with the comment `// CP-39 (D-6939): on a scheduled pass the census runs on its own slice, so it moves even when the tick or the hourly export pass spent the run.`
  - Spec :2101 (the COORDINATOR's edit, in its docs PR after W2-6 lands; never this PR), in place, one line. The text after `**never reset per file**.` gains, on the same line, after one space:

```text
On a scheduled tick (CP-39, D-6936), ingest, its discovery and its sidecars included, stops at that budget less the derivation's reserve (`DERIVE_SHARES`), and the sidecar listing resumes from a cursor, so one scan of every known uuid's `tool-results/` may span ticks; the FTS backfill, the leaves, the card step and the export census then each run on a slice that starts at the step's own start and holds the larger of what is left of its ceiling and its own floor share, so a pass may overrun the budget by at most the floors' sum (36 s and 204.8 MiB of the default budget) plus one unit per step. The hourly export pass (step 6) still runs under the whole budget, and each `--op import` window keeps its own fresh full budget.
```

    The coordinator checks, in its docs PR, with `git diff --stat` that the spec shows `1 file changed, 1 insertion(+), 1 deletion(-)`, and with `wc -l` that its length is unchanged.

  Run Step 1's, Step 1b's, Step 2's and Step 3's commands. All predicted green.

- [ ] **Step 5: the regression sweep.** One per call:
  - `(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts -t 'docstring names its steps')`;
  - `(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts -t 'F2 \(review 344\)')`;
  - `-t 'O5'`, `-t 'O20'`, `-t 'O22'`, `-t 'plan task 20'` and `-t 'CP-39 Task 3'`;
  - `(cd server && ./node_modules/.bin/vitest run test/history-derive.test.ts -t 'F13')`;
  - `(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts)`;
  - `(cd server && ./node_modules/.bin/vitest run test/history-drain.test.ts -t 'RF5b F16')`;
  - `(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'whose budget ends early')`.
  All are predicted green, unedited (the card file with Step 3's one edit). A case that now finds a step running where it found none (a test budget past the run, whose floors now give each step its share) is a measured departure: record it, take D-6941, and report it.

- [ ] **Step 6: the measured mutations (one per guard, one per call; restore and `cmp` after each).**
  - **M4a:** `ingestTick(db, ictx, ctx.budget)`. Predicted red: the starvation describe's first arm at 'the pass ended within the run budget plus half the floors' sum' (about RUN_BUDGET_MS + 41 s).
  - **M4b:** in `budgetRung`, `set bytes(v) { /* dropped */ }`. Predicted red: the rung case at "a charge to the rung is the run's".
  - **M4c:** `DERIVE_SHARES.fts: 0`. Predicted red: the lib case at its `toEqual`, and the starvation describe's second arm at 'the FTS backfill indexed owed blobs on its floor' (a floor of 0).
  - **M4d (P16):** in `budgetRung`, `startMs: budget.now(),` for the getter. Predicted red: the rung case at "the rung keeps the run's start".
  - **M4e (P16):** in `budgetRung`, `maxMs: limits.maxMs,` (no `Math.min`). Predicted red: the rung case at "never above the run's limits" (`[999, 100]`).
  - **M4f (P17):** `deriveFts(db, ictx, ctx.budget)`. Predicted red: the second arm at 'the FTS backfill indexed owed blobs on its floor'.
  - **M4g (P17):** `deriveNodes(db, ictx, ctx.budget)`. Predicted red: the second arm at 'the leaves were derived on their floor'.
  - **M4h (P17):** `const card = ctx.budget;`. Predicted red: the second arm at 'the card step ran on its floor …' (`expected 1 to be undefined`): on the spent run budget the card step may not write and keeps the fixture's card line, and `cardPass.budgetLeft` reads that spent budget, so the withdrawal unlinks the line and counts it. On the fixed tree the card's 4.5 s slice is left at its first check, so nothing is withdrawn.
  - **M4i (P17):** in `periodicCensus`, `exportCensus(db, nowMs, ctx.budget)`. Predicted red: the second arm at 'the census completed in this pass, on its floor' (`expected null not to be null`: the fixture deleted the settle's completion, and the census on the spent run budget completes nothing). This is the census end-to-end case measured red (P17): record its title and message in Task 6 Step 5's census of guards.
  - **M4j:** in `stepSlice`, `maxMs: ceiling.maxMs - (startMs - budget.startMs),` (no floor). Predicted red: the slice case at 'the floor, counted from the step' (`[1150, -70, 20]`), and the second arm at its FTS line.
  - **M4k (P1):** in lib's `ceilingOf`, drop the one-unit minimum (`perMille(max, k)` alone). Predicted red: the lib case 'a ceiling admits one unit …', and the card case at "CONTROL: A's second boundary was ingested within the budget" (`expected 1 to be 2`).
  - **M4l (P1):** in `stepSlice`, `maxMs: Math.max(ceiling.maxMs - (startMs - budget.startMs), budget.maxMs),` (a slice whose floor is the whole run's limit: a reset, not a share). Predicted red: the third arm at "the card step's own positive floor was spent: its prediction withdrawn, counted for budget" (`expected undefined to be 1`: the card slice holds 18 s, so `cardPass.budgetLeft` is true, nothing is withdrawn, and the card step keeps or rewrites its prediction; the fixed tree counts 1). The slice case reds too, first at its early arm, "the step's start; 80 - 20 ms and 80 - 30 bytes left" (`[1020, 100, 50, 0]`); record both.
  - **M4m (P16, the byte floor):** in `stepSlice`, `maxBytes: ceiling.maxBytes - base,` (no byte floor). Predicted red: the slice case at 'the floor, counted from the step' (`expected [ 1150, 10, -10 ] to deeply equal [ 1150, 10, 20 ]`).

- [ ] **Step 7: commit.** `fix(history-sweep): give ingest a ceiling and every derivation step a floor of the one run budget (CP-39 Task 4; D-6935, D-6936, D-6939)`.

---

### Task 5: the export census checks its budget before the file clock and takes a chunk once the clock is built (D-6937)

**Files:**
- Modify: `ccd/history/sweep.mjs`: `exportCensus` (:7292-:7343), its doc comment included.
- Test: append to `server/test/history-export.test.ts`. (The census's end-to-end case is Task 4's second starvation arm, which its floor slice makes green and M4i measures red.)

**Interfaces:** `exportCensus(db, nowMs, budget)` keeps its signature and answers. New rules: a spent budget at entry returns false before `exportFileClock`, and once the clock is built the first chunk is taken without a budget check.

- [ ] **Step 0: check the base.** `grep -n "const { files, filesOf, transcripts } = exportFileClock(db, state.homeDays);" ccd/history/sweep.mjs` shows one line (:7296), and the loop's first statement is `if (!budgetLeft(budget)) {`. `grep -n "^import fs from 'node:fs';" server/test/history-export.test.ts` shows :11.

- [ ] **Step 1: the census cases, the counter's CONTROL first.** Append to `history-export.test.ts`, using its module-level `fs` (the DEFAULT import, :11), `x9Store`, `x9Lib`, `x9H`, `x9Fs`, `x9Path`, `x9Hash` and `syncBuiltinESMExports`. The stat counter patches the default import, never the `x9Fs` namespace: a module namespace's properties are read-only, and assigning one throws (P2, measured in scratch: `TypeError: Cannot assign to read only property 'statSync' of object '[object Module]'`). sweep.mjs imports `statSync` by name, so `syncBuiltinESMExports` carries the patch to it, as this file's `linkSync` cases rely on.

```ts
describe('CP-39 Task 5: the export census checks its budget before the file clock and takes a chunk once it is built (D-6937)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  interface C5 { exportCensus(db: X9Db, nowMs: number, budget: Record<string, unknown>): boolean; newBudget(now?: () => number, limits?: { maxMs?: number }): Record<string, unknown> }
  const DAY = 86_400_000;
  /** One transcript whose one file was last written 200 days ago under a 30-day home, one row and its blob: due. */
  const seeded = (prefix: string): { box: ReturnType<typeof x9H.makeHistoryBox>; db: X9Db; file: string } => {
    const box = x9H.makeHistoryBox(prefix);
    x9Store.createStore(box.home);
    const home = box.homes[0]!;
    const file = x9Path.join(home, 'projects', '-home-u-tree-demo', 'cp39-census.jsonl');
    x9Fs.mkdirSync(x9Path.dirname(file), { recursive: true });
    x9Fs.writeFileSync(file, '{}\n');
    const old = Math.floor((Date.now() - 200 * DAY) / 1000);
    x9Fs.utimesSync(file, old, old);
    const db = x9Store.openWriter(x9Lib.historyPaths(box.home).dbFile);
    const t = Number(db.prepare('INSERT INTO transcripts (cc_session_uuid) VALUES (?)').run('39393939-0000-4000-8000-000000000001').lastInsertRowid);
    const f = Number(db.prepare("INSERT INTO ingest_files (dev, ino, source_key, transcript_pk, status, parser_version) VALUES (1, 2, '', ?, 'live', 1)").run(t).lastInsertRowid);
    db.prepare('INSERT INTO file_paths (path, file_id, last_seen_ms) VALUES (?, ?, ?)').run(file, f, Date.now());
    const text = 'cp39 a due row';
    const b = Number(db.prepare('INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, ?, ?, ?)')
      .run(x9Hash('sha256').update(text).digest(), x9Store.CODEC, x9Store.brotli(Buffer.from(text)), Buffer.byteLength(text)).lastInsertRowid);
    db.prepare("INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, 'user', 'operator', 1, 1, ?, ?, ?)")
      .run('39393939-0000-4000-8000-0000000000a1', t, f, b, Date.now() - 200 * DAY);
    db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('export-census', 1, ?, NULL)")
      .run(JSON.stringify({ last: 0, due: 0, overdue: 0, homeDays: { [home]: 30 }, startMs: Date.now(), dueOldest: null }));
    return { box, db, file };
  };
  const cursorOf = (db: X9Db): { last: number; due: number } =>
    JSON.parse((db.prepare("SELECT cursor FROM derivation_state WHERE step = 'export-census'").get() as { cursor: string }).cursor);
  /** Counts statSync calls on `p` from sweep.mjs: node:fs's DEFAULT export patched, carried to sweep.mjs's named import. */
  const countingStat = (p: string): { n: () => number; restore: () => void } => {
    const real = fs.statSync;
    let n = 0;
    (fs as { statSync: unknown }).statSync = Object.assign(function statSync(q: unknown, ...rest: unknown[]): unknown {
      if (q === p) n += 1;
      return (real as (...a: unknown[]) => unknown)(q, ...rest);
    }, real);
    syncBuiltinESMExports();
    return { n: () => n, restore: () => { (fs as { statSync: unknown }).statSync = real; syncBuiltinESMExports(); } };
  };

  it('CONTROL: the counter sees the file clock stat the recorded file, and an ample budget completes the census', async () => {
    const sw = (await import('../../ccd/history/sweep.mjs')) as unknown as C5;
    const { db, file } = seeded('ccrc-hist-cp39-c5c-');
    const c = countingStat(file);
    try {
      expect(sw.exportCensus(db, Date.now(), sw.newBudget()), 'complete').toBe(true);
      expect(c.n(), 'the file clock stat the recorded file').toBeGreaterThan(0);
    } finally { c.restore(); x9Store.closeWriter(db); }
  });

  it("a budget spent before the census builds no file clock: no recorded file is stat'd, the cursor stands", async () => {
    const sw = (await import('../../ccd/history/sweep.mjs')) as unknown as C5;
    const { db, file } = seeded('ccrc-hist-cp39-c5a-');
    const c = countingStat(file);
    try {
      expect(sw.exportCensus(db, Date.now(), sw.newBudget(() => 0, { maxMs: 0 })), 'spent: not complete').toBe(false);
      expect(c.n(), 'the file clock was never built').toBe(0);
      expect(cursorOf(db).last).toBe(0);
    } finally { c.restore(); x9Store.closeWriter(db); }
  });

  it('a budget that ends while the clock is built still takes one chunk: the due blob is counted and the cursor moves', async () => {
    const sw = (await import('../../ccd/history/sweep.mjs')) as unknown as C5;
    const { db, file } = seeded('ccrc-hist-cp39-c5b-');
    const c = countingStat(file);
    try {
      // Within the budget until the file clock stats the file; spent from then on, whatever the order of calls.
      const budget = sw.newBudget(() => (c.n() > 0 ? 10_000 : 0), { maxMs: 1_000 });
      expect(sw.exportCensus(db, Date.now(), budget), 'stopped after one chunk').toBe(false);
      expect(c.n(), 'CONTROL: the clock was built').toBeGreaterThan(0);
      expect(cursorOf(db), 'one chunk taken: the due blob counted, the cursor past it').toMatchObject({ due: 1 });
      expect(cursorOf(db).last).toBeGreaterThan(0);
    } finally { c.restore(); x9Store.closeWriter(db); }
  });
});
```

  Run the CONTROL first, alone: `(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts -t 'CONTROL: the counter sees the file clock')`. Predicted GREEN on the base: the counter works (P12). If it is red, stop: no red below means anything until it is green. Then `(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts -t 'CP-39 Task 5')`. Predicted: the CONTROL green; case 2 red at 'the file clock was never built' (`expected 1 to be 0`); case 3 red at `toMatchObject({ due: 1 })` (due 0: the base's in-loop check fails before any chunk). Record what is measured.

- [ ] **Step 2: implement.** In `exportCensus`:

```js
  const state = stepCursorGet(db, 'export-census');
  if (state === null) return true;
  // CP-39 (D-6937): checked before the file clock, which stats every recorded file; a spent budget builds nothing.
  if (!budgetLeft(budget)) return false;
  const { files, filesOf, transcripts } = exportFileClock(db, state.homeDays);
  …
  let chunks = 0;
  for (;;) {
    // D-6937: once the clock is built, one chunk is always taken, so a census that builds its clock moves.
    if (chunks > 0 && !budgetLeft(budget)) {
      stepCursorSet(db, 'export-census', state);
      return false;
    }
    …
    stepCursorSet(db, 'export-census', state);
    chunks += 1;
  }
```

  The doc comment gains: "It checks the budget before it builds the file clock, and takes at least one chunk once it has (D-6937); on a scheduled pass its budget is its own floor slice (D-6939)". Run Step 1's two commands. Predicted green.

- [ ] **Step 3: the regression sweep.** One per call:
  - `(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts -t 'W1-B4 Task 9')`;
  - `(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts -t 'O38|O58|W1-j')`;
  - `(cd server && ./node_modules/.bin/vitest run test/history-derive.test.ts -t 'CP-39 Task 4')`.
  All predicted green.

- [ ] **Step 4: the measured mutations.**
  - **M5a:** delete the entry check. Predicted red: case 2 at 'the file clock was never built'.
  - **M5b:** `if (!budgetLeft(budget))` without `chunks > 0`. Predicted red: case 3 at `toMatchObject({ due: 1 })`.
  Restore and `cmp` after each.

- [ ] **Step 5: commit.** `fix(history-sweep): let the export census check its budget before its file clock and take a chunk once it is built (CP-39 Task 5; D-6937)`.

---

### Task 6: the whole-PR checks, the steps for the coordinator or the operator, and the PR

- [ ] **Step 1: the file list.** `git diff --name-only origin/main...HEAD` lists the Files table's code and test paths, each of them and nothing else (never the spec), plus this plan only if a Task 6 correction or the definition of D-6941 was committed. It never lists `deploy/history-replay.mjs` or `server/test/history-replay.test.ts`.
- [ ] **Step 2: the spec diff.** `git diff origin/main...HEAD -- docs/superpowers/specs/` is EMPTY: the §9.2 step 7 amendment is the coordinator's, after W2-6 lands.
- [ ] **Step 3: the D-numbers (P21).** Over D-6930 to D-6941: each is defined at most once in "Deviations found", and every one cited anywhere is defined there. Each of D-6930 to D-6940 is cited in at least one code comment or spec line. `grep -rn "D-69[34][0-9]" ccd server/test docs/superpowers/specs` shows no number outside D-6930 to D-6941. Then `git fetch origin main` and `(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)`.
- [ ] **Step 4: the full suites, foreground, one per call.** history-lib, history-ingest, history-derive, history-export, history-sweep, history-op, history-card, history-cli, history-drain, history-recover, history-maint, history-store, history-recall, history-holds, history-parser, history-skill, history-replay (run, never edited), single-definition, citations and deviation-refs. Record each file's pass and fail count, and re-run a CLAUDE.md load flake in isolation before calling it a break.
- [ ] **Step 5: the census of guards.** List every new guard with its mutant and its measured red title (M1a to M1d, M2a to M2l, M3a to M3r, M4a to M4m, M5a and M5b) for the PR body. M4i's line is the census end-to-end case's measured red, and says so.
- [ ] **Step 6: the private-name count.** Over `git diff origin/main...HEAD` added lines, `git log origin/main..HEAD --format=%B`, and the PR body file: the public-repo scan the programme uses must print 0.
- [ ] **Step 7: the PR.** Push the workspace branch and open the PR with the body below. If a figure in this plan proved wrong, correct it in this plan in one commit, `docs(plan): correct <figure> (CP-39 Task 6)`.

**Steps for the coordinator or the operator, never the worker.** These go into the PR body verbatim:
1. Merge. The merge becomes a `dev` prerelease through `release-main.yml`.
   - After W2-6's PR lands and its claim on the spec is released, the coordinator applies D-6936's one line to the spec's §9.2 step 7 (:2101), the text Task 4 gives verbatim, in its own docs PR.
2. Move the fleet box through the release lane: `ccrc rollout --to vX.Y.Z` (or a stable promotion and a bare `rollout`), fleet box first. Never `deploy.sh`, and never a hand copy. No unit, timer or install step changes. The next timer pass runs the new `sweep.mjs` from the installed tree.
3. **Measure the rates, not only the movement (P11).** Read-only, on the fleet box's store opened `?mode=ro` (or `deploy/measure-history.py`), record these figures after each of the first six consecutive passes after the rollout (one pass every two minutes; note whether any was cold, for example the first after a reboot):
   - `F`: the count of blobs the FTS backfill OWES, by its own relation (`FTS_OWED_SQL` in `sweep.mjs`, never `fts_indexed = 0` alone): `fts_indexed = 0`, `z IS NOT NULL`, a `sidecars` row naming the blob or an `entries` row of an indexed provenance (`FTS_ELIGIBLE_SQL`), and no `fts_undecodable:<blob_id>` meta row for the blob's current decoder mode. And `Fb`, the text those blobs owe the backfill, per kind, each kind's FTS window plus the 64 KiB redaction margin (`SIDECAR_REDACT_MARGIN`, which `ENTRY_REDACT_MARGIN` equals): `Fb = sum(min(raw_len, 1048576 + 65536))` over the owed ENTRY blobs (`ENTRY_FTS_BYTES`, 1 MiB) `+ sum(min(raw_len, 524288 + 65536))` over the owed SIDECAR blobs (`SIDECAR_FTS_BYTES`, 512 KiB), a blob being the sidecar kind when a `sidecars` row names it (`FTS_IS_SIDECAR_SQL`);
   - `S`: the count of `sidecar_seen`, and meta `scan_sidecars_at` (read `json_extract(v, '$.dir')`), `scan_sidecars_ms` and `sidecars_unseen`;
   - the `export-census` cursor's `last` and `due`, and `max(blob_id)` of `blobs`;
   - `L`: the count of depth-0 `nodes`, and the count of boundaries with no leaf;
   - the `card-measure` cursor, meta `scan_discover_ms`, and each `sidecar_walk:<pk>` row's `json_extract(v, '$.walk.after')` (never the whole value: it can be MBs);
   - the store's size: the database file and its WAL, by `stat`.
   For each figure take the per-pass deltas and their mean, and compute an ETA = what is left ÷ the mean delta × 2 min. The costs the thresholds are derived from were measured on the fleet box (2026-10-25, read-only): the sweep unit gets 0.1-0.17 of a core under load (measured on the fleet box, under the shipped unit's Nice=19 and idle I/O class and a LOCAL drop-in's CPUWeight=10, `ccd-history-sweep.service.d/60-cpu-weight.conf`, which is not shipped), so a 90 s pass is 9-15 s of CPU; redaction plus FTS costs about 20 ms of CPU per 70 KB, about 3.5 MB/s, scaling with the indexed window; brotli at the store's quality runs at about 68 MB/s. The backlogs: about 486,160 blobs owed to the FTS backfill, about 830 MB raw (a 1.7 KB mean), a figure measured through the owed-row index's two leading terms alone (`fts_indexed = 0 AND z IS NOT NULL`, the `blobs_unindexed` predicate), so an UPPER BOUND on the owed count `F` (read `F`'s deltas against the threshold, not `F` against that figure); about 126,000 sidecars owed, about 44 GB raw and about 25-30 GB of index text (the homes hold 189,007 sidecar files, 66.1 GB, a 350 KB mean, the largest 67.1 MB; 8,414 are stored, 3.27 GB raw in 369 MB, a 0.113 ratio; the FTS index is 658 MB). Compare against these thresholds, each a minimum with its reason:

   | Figure | Threshold (mean per pass) | ETA it bounds | Why this number |
   |---|---|---|---|
   | FTS backlog `F`, while ingest is not caught up | falls by at least 2,000 | at most about 486,160 blobs in 100-175 passes, 3.5-6 h | the FTS floor is 13.5 s of wall clock, 1.35-2.3 s of CPU; at 3.5 MB/s and the 1.7 KB mean, about 0.5 ms a blob, that is 2,800-4,700 blobs a pass on the floor alone |
   | sidecars `S` on the scheduled path | rises by at least 40 while unseen sidecars remain | about 126,000 sidecars in 840-1,800 passes, **1.2-2.5 days**, up to about 4.5 days while a re-derivation generation is open | the scheduled path is bound to about 15 s of CPU a pass at most and cannot drain this backlog fast. Ingest's 54 s ceiling is 5.4-9.2 s of CPU (about 30 s, 3-5 s, while a generation is open). Each new sidecar is redacted and FTS-indexed inline, about 57-68 ms at the backlog's 200-240 KB of index text a sidecar, plus about 5 ms of compression: about 70-150 sidecars a pass, 40-85 with a generation open. Step 4 is the fast path |
   | census `last` | moves on every pass; the census completes (meta `export_census_ms` and the W1-k dates written) within 24 h | about 1.14 million blobs | one 2,000-blob chunk a pass is the guarantee (D-6937), so 570 passes (19 h) is the worst case; the census's 9 s floor, 0.9-1.5 s of CPU, is expected to take several chunks a pass |
   | leaves `L` | rises on every pass while boundaries with no leaf exist | the boundaries owed | the leaves' floor is 9 s; a pass that derives none while one is owed is the starvation this PR fixes |
   | the sidecar scan | its cursor moves on every pass until a wrap completes; a wrap completes (`scan_sidecars_ms` and `sidecars_unseen` written) within 12 h of the end of Step 4's import, or within 4.5 days on the scheduled path alone | one wrap of about 135,000 entries | a wrap after the import lists and lstats seen sidecars only; on the scheduled path a wrap takes the backlog with it, at the `S` row's rate |
   | `scan_discover_ms` | written within the first passes, then re-stamped about every 30 min, not every pass | | D-6933 |
   | a `sidecar_walk` row's `after` | rises on every pass while the row exists | the large transcript's 24,450 rows | the walk's cursor is resumed, never restarted (D-6931) |
   | `card-measure` | moves at least once over the six passes, when leaves newer than its cursor exist | | the card step's floor is 4.5 s |

   Report the figures, the deltas, the ETAs and each verdict in the programme's ledger. **A miss is reported to the operator with its figures, never passed silently**, and is never fixed on the box. A cursor that does not move over three passes is a FAIL to report.
4. **The fast path for the sidecar backlog: the import, from a transient unit.** `--op import --apply`'s ingest never indexes inline (its context has `fts` false), and a transient unit runs it at default priority, not under the shipped sweep unit's Nice=19 and IOSchedulingClass=idle, nor the fleet box's local CPUWeight=10 drop-in. Without inline FTS a sidecar costs about 6 ms of CPU (compression of the 350 KB mean at about 68 MB/s, its hash and its write), about 13 min of CPU for 126,000, which at 0.15-0.4 of a core for a default-priority unit under load (an ESTIMATE from the measured box load, a load average of 45-65 on 16 CPUs on 2026-10-25, never measured for this unit) is **30-90 min for the sidecar phase**. On the operator's go-ahead, from a shell on the fleet box:
   1. Preflight: the store grows from about 3 GB to about 16 GB (about 5 GB of blobs, 44 GB at the measured 0.113 ratio, and the FTS index for 25-30 GB of index text), inside the 50 GB cap. Two figures, both above the §9.3 floor: **about 5 GB free for the import itself**, which writes blobs only (its ingest never indexes inline: `fts` false), and **about 13 GB free in all before the FTS backfill completes**, the rest being the index the scheduled ticks build after it. Report both to the operator before starting. The scheduled ticks pause at the floor on their own; the `capture_paused_low_disk` counter (the `capture-paused-low-disk` pause) rising on those ticks after the import is the signal to report to the operator, with the volume's free space.
   2. Pause the timer, `systemctl --user stop ccd-history-sweep.timer`, and wait until `systemctl --user is-active ccd-history-sweep.service` no longer answers `active` or `activating`.
   3. Run the import, keeping the carrier's memory bound (O20) and nothing else of the sweep unit's: `systemd-run --user --unit=ccd-history-import --collect --wait -p MemoryMax=1G "$HOME/.local/bin/ccd-history-sweep" --op import --apply`. Its output is in `journalctl --user -u ccd-history-import`. Every 10 minutes, record `S` and the store's size, read-only.
   4. When it ends, start the timer again: `systemctl --user start ccd-history-sweep.timer`. The import ends by calling `resetFtsPending`, so the scheduled ticks' FTS backfill indexes the new blobs; once ingest is caught up it runs at its 67.5 s ceiling, 6.75-11.5 s of CPU a pass, 24-40 MB of index text a pass: **about a day** (about 2.4 h of CPU, 650-1,300 passes, 22-43 h).
   5. Then measure the first six passes again, as step 3, and against this table:

   | Figure | Threshold | ETA it bounds | Why this number |
   |---|---|---|---|
   | `S` during the import | rises by at least 14,000 every 10 minutes; the sidecar phase ends within 90 min | about 126,000 sidecars in 30-90 min | 6 ms of CPU a sidecar at 0.15-0.4 of a core (an estimate from the measured box load: load average 45-65 on 16 CPUs, 2026-10-25) |
   | the import's end | no `paused` line (`at-cap`, `capture-paused-low-disk`, `store-unreachable`); the uuids it did not map stay the sidecar scan's, and the first wrap after it stamps their count in `sidecars_unseen` | | a pause ends the ingest, not the pass; the import maps from evidence only (§8.4) |
   | store size | at most about 16 GB after the FTS backfill, from about 3 GB | | the 0.113 ratio and the FTS index; the cap is 50 GB |
   | index text owed `Fb` | falls by at least 20 MB a pass once ingest is caught up | 25-30 GB plus about 830 MB of entries in 650-1,300 passes, 22-43 h | the FTS ceiling is 67.5 s of wall clock, 6.75-11.5 s of CPU, at 3.5 MB/s: 24-40 MB a pass |

   A miss goes to the operator with its figures, as in step 3.
5. Decide on the Later items: the belt's floor inside D-4344's slice; the `sidecars_unseen` line in `status` (an envelope field, §8.3); Review Focus 2's question, whether a rewritten sidecar should force an extension walk; and whether a scheduled tick should leave a new sidecar's index to the FTS backfill (or the unit get a larger CPU share), so that the scheduled path alone drains a sidecar backlog in hours.

**The PR body template** (fixed sections, filled in by the worker at Step 7):

```markdown
## ccrc history CP-39: every derivation step advances on every pass

### Summary
<two to four sentences: the starvation measured on the fleet box, read-only; the one-walk link index; the resumable walk that is never restarted; the per-half scan marks and the bounded, resumable discovery; the ceilings and floors inside the one run budget; the census's forward progress>

### Decisions this PR applies
<the Decisions table's rows, one line each, naming where the code or spec made the ruled words impossible as written (the extraction shape, D-6930; the extension walk reading from the first row, D-6931) and the alternative taken>

### Deviations
<each of D-6930 to D-6940, one line, defined in the plan's "Deviations found"; then whichever numbers of D-6930 to D-6941 stay unused, for example "D-6941 issued, unused">

### Tests run
<each suite of Task 6 Step 4: file, passed, failed, skipped; any flake re-run in isolation and its result>

### Each new guard was measured red
<one line per mutant: the edit, the filter, the red title and message, restored and cmp rc 0>

### Residuals named
- exportStep keeps the full run budget; on the hourly export pass the census runs on its floor alone, inside the overrun bound.
- A scheduled pass may overrun RUN_BUDGET_MS by up to the floors' sum (36 s) plus one unit per step.
- The rederive slice and the drain come out of ingest's ceiling: about 30 s of its 54 s while a generation is open.
- One wrap of the sidecar scan still lists about 135,000 entries; under a cold cache it spans more passes.
- The scheduled path takes days for a sidecar backlog (about 70-150 sidecars a pass, each redacted and indexed inline); the fast path is the operator's import from a transient unit, 30-90 min, then about a day of FTS backfill (steps for the coordinator, step 4).
- A row appended after a walk finished is not walked for that walk's names.
- The belt's node step inside D-4344's slice (Later).
- `sidecars_unseen` is stamped but is not a `status` field (Later).

### Steps for the coordinator or the operator, never the worker
<the five steps above, verbatim, both thresholds tables included, with step 1's spec-line sub-step>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Deviations found

D-6930 to D-6941 were issued to this wave. This plan defines D-6930 to D-6940, once each, here. Each lands on `main` with the plan before dispatch, and the PR defines no other number except D-6941, taken for a departure found while executing and defined here in the `fix(history-sweep)` commit that first cites it. Every other number this plan cites is defined on `main` and is cited bare.

- **D-6930** — `history-sidecar-link-one-walk` (Task 1): NEW departure (no spec §16 row). `toolResultCandidates` finds every asked sidecar name in a row's text in one pass of one Aho-Corasick automaton over the names' UTF-16 units (lib's `sidecarNameMatcher`), where it ran `text.includes(name)` once per wanted name: rows × names, with no budget check inside. On the fleet box one transcript of 24,450 user rows (97.6 MB raw) and about 6,270 unlinked sidecars cost about 4 minutes of CPU per pass, rebuilt every pass, linking one sidecar each. The automaton answers exactly `includes`' answer, in the order the names were given, each once (0 mismatches in about 150,000 generated cases, measured in scratch), so §9.2 step 4's link rule (D-4239) and every link-rule case are unchanged; `namesIn` costs O(text + hits) per row, with its stamp array made once per matcher (P20). In walk mode the function checks the budget before every row, moves its cursor past every row it takes, decoded or passed over (over the decode cap, or undecodable), counts those rows as `advanced` (the figure `walked` reports, P18), charges their compressed bytes as the FTS backfill charges them, sets `complete` only when the rows ran out, and resumes from `after`. This departs from the coordinator's ruled shape, which said to extract `tool-results/<name>` references into a map: the shipped rule is a substring test, and two pinned cases rely on it (`a.txt` linked to the row naming `…/data.txt`; a row naming `toolu_01AAA.txt` with no `tool-results/` prefix), so extraction would have changed both. Pins: Task 1's lib describe (the `includes` agreement, fixed and generated, and the state bound) and its ingest describe (rows × names counted outside the code under test: one decode per user row and no `includes` asked an asked name; the cut and resume; a budget spent before the first row; the over-cap and undecodable rows; `complete` at the iterator's end), mutants M1a to M1d.
- **D-6931** — `history-sidecar-link-walk-resumable` (Task 2): NEW departure (no spec §16 row). A transcript's link walk persists in meta `sidecar_walk:<transcript_pk>` (`SIDECAR_WALK_META`). The state is lib's grammar: `v`, `done` (the names finished walks cover, with their first text and `toolu_` matches) and `walk` (at most one extension in progress, over names `done` does not hold, with its own `after`), as pairs, never object keys. Done and walk together hold at most `SIDECAR_WALK_CHARS_MAX` = 524,288 UTF-16 units of names (*chosen*: twice the largest backlog measured, about 6,270 names of about 40 units; at the cap the automaton is about 517,000 states and 49 MiB of heap, measured in scratch; Task 2's RSS case pins O20's bound with a walk at the cap beside a 64 MiB sidecar, P22).
  - **Resume:** a pass whose budget ends inside the walk leaves the state, and the next pass resumes at the next row.
  - **Link before read:** the sidecar's link is decided before any of its bytes are read. A cut walk reads no sidecar byte, and the floor probe and admission keep their places before it.
  - **A finished walk answers its names:** `walkCandidates` offers `linkSidecar` the first text match, then the first `toolu_` match. These are the two candidates `linkSidecar` would pick from the full list, because a name is in a row's NUL-joined named list exactly when it is a substring of that row's text, and the text rule precedes the toolu rule. So the link is unchanged.
  - **Never restarted (P9):** a finished walk keeps its state for the names it covers; a name it does not cover gets an EXTENSION walk with its own cursor over the uncovered unseen names alone, and when the extension finishes it merges into `done` (a name or stem `done` holds keeps its entry). Starting an extension prunes from `done` the names whose sidecars are seen. The extension reads the transcript's rows from the first, because the link rule is a first match over every row (D-4239): a row before the finished walk's end can answer a new file's `toolu_` id. Its cost is one pass over the rows for the new names, never a re-walk of the done names.
  - **A name a walk in progress does not cover:** it waits (deferred, the half incomplete) while that walk has names still unseen that can reach the link; a walk in progress with no such name is replaced at once, and one that advanced no row over a whole visit of its group is retired (both rules D-6938's, Task 3). A deferred sidecar is not counted in `examined`.
  - **Once per pass (P10):** the state is parsed once per call, on the group's first need, cached on the group, updated in place, and written through to meta only when a walk advanced (or finished); a group examined in full retires it (the row deleted).
  - **Order and fairness:** the sidecar half visits the found sidecars grouped by uuid, in the order the caller gives the uuids (`ingestTick` gives hinted, then behind; the sidecar scan's share follows, Task 3). The bound that holds is for OTHER uuids: a walk in progress delays only its own uuid's names that it does not cover; every other uuid's sidecars wait at most for what the walks ahead of them in that order spend of one pass.
  Why a persisted cursor and not a rotating start: a rotating start cannot finish a walk longer than one pass's share, and the transcript that blocked every pass would restart on each. A malformed state reads as no state, which costs a walk and loses nothing. No schema change: the state is a `meta` row, neither journaled nor exported; a restore keeps the backup's state, consistent with the backup's entry ids (P22). Pins: Task 2's lib describe and ingest describe (the cut and resume, the deferral, the extension, the order, the two homes, the parse count, the RSS case), mutants M2a, M2b, M2d, M2f, M2g and M2i.
- **D-6932** — `history-import-sidecar-window-progress` (Tasks 2 and 3): NEW departure (no spec §16 row). `--op import` lists the sidecars ONCE per import and hands the list to every window (`ingestSidecars`' `opts.found`, filtered to the caught-up uuids in each window), where each window listed every uuid's `tool-results/` again, about 135,000 entries on the fleet box. Under Task 3 the one listing runs under the windows' budgets from a cursor of the import's own (its last uuid directory): a cut listing is never `done`; one that passed a uuid directory is progress and resumes in the next window, and one cut before its first uuid directory lists the rest once with no budget in the same window, so the listing always ends (an import has no run budget, §9.2 "Backfill"); a window the listing did not finish, or spent, ingests nothing. Its sidecar windows (`importSidecars`, §9.2 "Backfill", D-4240) resume after the last sidecar the previous window examined (`ingestSidecars`' `resume`, taken as `opts.from`), and end when a window is complete, or when it examined no sidecar (seen or new) AND advanced no link walk. `ingestSidecars` reports `walked` (the rows its walks' cursors moved past) and `examined` (the sidecars it examined) only when above 0, and `resume` only when it examined one; a seen sidecar is examined, a deferred one is not. Under D-6931 a window can spend its whole budget advancing a walk and read nothing, and the old rule (`r.bytes === 0` ends it `done`) would have ended a backfill after its first window with every large transcript's sidecars unread; a window that only re-skipped seen sidecars would have done the same (P3). The resume point is what makes counting a seen sidecar as progress terminate: each window either finishes, moves the resume point past at least one sidecar, or moves a walk past at least one row, and both are finite. A deferred sidecar a window passes is left to the scheduled ticks, as one the import never reaches is. `importSidecars` is exported for its in-process cases, and its window budget takes `ctx.deps.budget` (an in-process limit for tests only, as `passCtx`'s does); the cases count the windows at the read of that object's `maxMs`, directly, because an injected `statfs` that threw would be swallowed as low-disk and the import would answer 'paused'. Pins: Task 2's three import cases (the window-counted case with its one listing, the seen-sidecar case, the import-then-tick case) and Task 3's two cut-listing import cases, mutants M2c, M2e, M2j, M2k, M2l and M3j to M3m.
- **D-6933** — `history-scan-marks-per-half` (Task 3): NEW departure (no spec §16 row). Each half of the ingest keeps its own scan mark. Meta `scan_discover_ms` is set when the scan's transcripts are all examined. A new meta `scan_sidecars_ms` is set when a wrap of the sidecar scan (D-6938) completes clean over every known uuid. While the sidecar mark is due, `candidateFiles` answers the known uuids (`known`) for the sidecar scan without rediscovering their transcripts, and the transcript scan's files no longer add their uuids to the sidecar half's given share. This supersedes W1 Task 20/21's contract, "the scan is marked done only when both halves examined everything" (`ingestTick`'s doc comment; not a D-entry): under it a sidecar backlog held the transcript scan due, so every tick re-discovered every transcript of every known uuid (19 homes on the fleet box), and `scan_discover_ms` was never written. The sidecar-floor case's assertion is edited in place: `scan_sidecars_ms` holds the earlier tick and `scan_discover_ms` the later one. Its intent, that the next tick's sidecar half covers every known uuid again and takes the sidecar, is kept. Pins: Task 3's first case and the edited sidecar-floor case, mutants M3a and M3b.
- **D-6934** — `history-read-error-holds-its-own-half` (Task 3): supersedes in part D-4340's (`history-ingest-read-error-skips-file`) clause "and the periodic discovery scan is not marked done". A read or open error the OS raised on a transcript holds the transcript scan's mark. One on a sidecar met by the sidecar scan holds that wrap (`scan_sidecars_at`'s `held`), so the sidecar mark waits for a clean wrap. Neither holds the other's. D-4340's guarantee stands: the file is found again by the next tick that lists it. A skipped sidecar is found by the next wrap, which starts at once while the mark is due. Everything else in D-4340 is unchanged. Pins: Task 3's second case, both arms written in full with the fault's CONTROL (P15), mutant M3c; the FR2-d describe stays green unedited.
- **D-6935** — `history-derivation-reserve` (Task 4): NEW departure, with the spec line amended by D-6936 and the floors defined by D-6939. The tick's ingest runs under a ceiling rung of the ONE run budget: a view with the run's clock, start and byte count (shared through accessors) and lower limits, so it never resets anything (O5). Lib's `budgetRungs` derives the ladder from `DERIVE_SHARES`, per mille of the run's limits (*chosen*): fts 150, nodes 100, card 50, census 100. Every ceiling admits at least one unit whenever the run's own limit is at least 1, so a one-byte test run still reads its one chunk (P1).
  - **The ladder:** ingest, its discovery (D-6938) and its sidecars included, ends at the budget less every share: 54 s and about 307 MiB of the default budget, measured from the run's start. The rederive slice (up to 20 s and 128 MiB, charged to the run too) and the drain run before ingest and come out of that ceiling, so while a re-derivation generation is open ingest has about 30 s and 179 MiB (P11; residual named, P23). Each derivation step's ceiling is the budget less the shares of the steps after it: the FTS backfill 67.5 s, the leaves 76.5 s, the card step 81 s, the census the run budget itself. A step's slice (D-6939) holds what is left of its ceiling, or its floor when that is larger.
  - **`mergeSteps`** takes the card step's slice, so it cannot spend the census's. The card withdrawal's budget reading (D-4740) reads the card step's slice, the budget the card step actually has.
  - **What does not change:** `rederiveSlice` (D-4344) and its pinned lines, `exportStep` (the full run budget; residual named), and the tick's order (D-4224). The D-4242 gate is unchanged.
  - **Why fractions:** the ladder scales with an injected test budget and with any future `RUN_BUDGET_*`.
  - **Why these shares, tied to the measured box (2026-10-25, read-only):** under the shipped unit's Nice=19 and idle I/O class and, on the fleet box, a LOCAL drop-in's CPUWeight=10 (`ccd-history-sweep.service.d/60-cpu-weight.conf`, not shipped; the shipped unit sets MemoryMax=1G, Nice=19 and IOSchedulingClass=idle) the unit gets 0.1-0.17 of a core under load, so 90 s of wall clock is about 9-15 s of CPU; redaction plus FTS costs about 20 ms of CPU per 70 KB, about 3.5 MB/s, scaling with the indexed window (the first 512 KB plus a 64 KB margin). The FTS backfill is the largest backlog by count (at most 486,160 blobs, counted through the owed-row index's two leading terms, `fts_indexed = 0 AND z IS NOT NULL`; about 830 MB raw, a 1.7 KB mean) and the one every grep waits on: 150 per mille is 13.5 s of wall clock, 1.35-2.3 s of CPU, about 0.5 ms a blob, so 2,800-4,700 blobs a pass on the floor alone, and the backlog clears in about 100-175 passes (3.5-6 h). The census builds one file clock per pass before its first chunk, over about 1.14 million blobs: 100 per mille. The leaves 100; the card step, small in steady state, 50. Ingest's 60% still drains a backlog over ticks (§9.2 step 7).
  - **What the shares cannot make fast, said honestly:** the sidecar backlog, about 126,000 files (about 44 GB raw, 25-30 GB of index text). On a scheduled tick each is redacted and indexed inline, about 60-75 ms of CPU at the backlog's mean, and ingest's ceiling is 5.4-9.2 s of CPU (3-5 s with a generation open): about 70-150 sidecars a pass (40-85), **1.2-2.5 days** on the scheduled path, up to about 4.5 with a generation open. No share of a 9-15 s CPU pass changes that order. The fast path is the operator's `--op import --apply` from a transient unit at default priority with the timer paused, whose ingest never indexes inline: 30-90 min for the sidecar phase; then the FTS backfill completes on the scheduled ticks, at its ceiling once ingest is caught up, in about a day (about 2.4 h of CPU); the store grows from about 3 GB to about 16 GB, inside the 50 GB cap (Task 6, step 4, with its thresholds; a miss goes to the operator).
  Measured on the fleet box before the fix: ingest held the whole budget and every derivation cursor stood still. Pins: Task 4's lib describe, the rung case (a moving clock: the run's start kept, spent at its own maxMs while the run is live, never above the run, P16), the starvation describe's first arm (the pass ends near the run budget), and the card case's CONTROL, mutants M4a to M4e and M4k.
- **D-6936** — `history-spec-9-2-step-7-reserve` (Task 4): spec amendment, in place, rev 3.6 unchanged. The coordinator applies it in its own docs PR once W2-6's claim on the spec is released; this PR does not edit the spec. §9.2 step 7 ("one wall-clock and byte budget per run, 90 s and 512 MiB *chosen*, **never reset per file**", :2101 at `ece3dfbee`) gains, on the same line and scoped to a scheduled tick (P7): ingest, its discovery and its sidecars included, stops at that budget less the derivation's reserve (`DERIVE_SHARES`), and the sidecar listing resumes from a cursor, so one scan of every known uuid's `tool-results/` may span ticks (which keeps step 2's "for every known uuid" true, over a wrap); the FTS backfill, the leaves, the card step and the export census then each run on a slice from the step's own start holding the larger of what is left of its ceiling and its own floor share, so a pass may overrun the budget by at most the floors' sum (36 s and 204.8 MiB of the default budget) plus one unit per step; the hourly export pass (step 6) still runs under the whole budget, and each `--op import` window keeps its own fresh full budget. No line moves, so no line citation into the spec moves. O5's pin is unchanged: a clock past the budget still defers every later file. Pins: Task 6 Step 2's line-neutral diff.
- **D-6937** — `history-census-progress-per-pass` (Task 5): NEW departure (no spec §16 row). The export census (§9.15, W1-k; `exportCensus`) checks its budget before it builds the file clock, which stats every recorded file, and once the clock is built it always takes one chunk before it checks the budget again. On the fleet box the census's cursor stood at 0 from 2026-10-09: the scheduled pass reached `periodicCensus` with the run budget already spent, built the clock, and returned at its first check, every pass, so W1-k's dates (`oldest_row_ms`, `first_due_ms`, `first_deletion_ms`) were never recorded. What ships (P8): a budget already spent when the census starts builds no clock and moves nothing; on a scheduled pass, though, the census's budget is its own floor slice (D-6939), which is never spent at the census's start for the default budget, so the census moves on every scheduled pass, the hourly export pass included; and once its clock is built it takes at least one chunk, so a slice the clock's own stats spent still moves it. The bound is one chunk (`EXPORT_CENSUS_CHUNK`, 2,000 blobs) past the slice, inside the overrun bound of D-6939 and well inside the carrier's kill (`CARRIER_KILL_S`). Pins: Task 5's export cases (the counter's CONTROL, run green first, P12; the entry check; the one chunk), mutants M5a and M5b; the census's end-to-end pin is Task 4's second starvation arm, measured red by M4i.
- **D-6938** — `history-discovery-bounded-and-resumed` (Task 3): NEW departure (no spec §16 row; spec line by D-6936). Discovery runs under the ingest's ceiling rung. Transcript discovery (`walkTranscripts`' stop, `discoverTranscriptsWithin`) checks the budget before each `projects/` and slug listing; a cut leaves the tick's candidates incomplete and the transcript mark due. The sidecar scan lists the known uuids' `tool-results/` from a persisted uuid-directory cursor, meta `scan_sidecars_at` (lib's grammar: `dir`, `taken`, `left`, `held`), in walk order (homes as given, projects and uuid entries sorted), checking the budget before each `projects/` listing, each project listing and each wanted uuid directory, and skipping the homes, projects and uuid directories at or before the cursor without listing them. The cursor moves past a uuid directory once its sidecars were all examined (or deferred, which holds the wrap). When the listing reaches its end with every directory passed, the wrap is done: it stamps meta `sidecars_unseen` (the sidecars it took plus every sidecar it LEFT UNSEEN in the directories it passed, too large, refused or deferred: the backlog the figure shows, P23; a deferred sidecar is not `examined`, Task 2's progress count, and is counted here), sets `scan_sidecars_ms` unless it was held, and resets the cursor; so the mark stays due until a full wrap completes. The group's lstats (`unseenOf`) run behind the same checks. **The deferral wedge** (fold check, 2026-10-25): a walk in progress whose started name was deleted, beside a name that never reaches the link (a sidecar over `SIDECAR_MAX_BYTES` or not regular returns before the link step and never gets a `sidecar_seen` row), never advanced and was never replaced, so it deferred its uuid's every new name for good, held every wrap, and `scan_sidecars_ms` was never written. Two rules end it: only a name that can reach the link counts as unseen (`unseenOf`'s own lstat leaves out a sidecar over the cap and one that is not a regular file, so no walk takes such a name and none waits for one; a name whose lstat throws, one deleted between the listing and the lstat included, is left out as well, and the error never escapes as a fault), and a walk in progress that advanced no row over a visit of its group is retired, its `done` kept, unless a budget cut or a stop (the floor or history-off) ended the visit: a visit that met a fs fault or a deferral still retires it, so a sidecar that faults on every pass cannot keep a walk; the sidecar scan visits every known uuid's group once a wrap, so a walk that advanced no row over a whole wrap is retired. **The import's one listing** (D-6932) runs under the same `listSidecars`, from the import's own cursor. A cursor under a home that left the roster, or one that does not parse, starts a wrap from the start (a malformed one, held). Before the fix, `candidateFiles` and `discoverSidecars` ran before any budget check, and a cold listing of about 135,000 entries (59-87 s measured) spent the derivation's whole reserve before `deriveFts` was called (P5, P6). Pins: Task 3's lib describe and its third to eleventh cases (the wedge's case, the idle walk with the deferral arm that asserts `sidecars_unseen`, the two cut-listing import cases, the not-regular entry beside the deleted walk name and the failed lstat), mutants M3d to M3r (M3n and M3q one per half of the unseen rule, M3r the failed lstat). The fault arm of the retirement has no case of its own.
- **D-6939** — `history-derivation-floors` (Task 4): NEW departure (spec line by D-6936). Each derivation step (the FTS backfill, the leaves, the card step with `mergeSteps` after it, and, on a scheduled pass, the export census) runs on `stepSlice`: a budget that starts at the step's own start (one clock read when the step starts), whose limits are `max(what is left of the step's ceiling, the step's floor)` in ms and in bytes, whose byte count starts at 0, and every charge to which is a charge to the run. This is D-4344's precedent: `rederiveSlice` is a fresh budget. The floors are lib's `budgetFloors`, the same `DERIVE_SHARES` of the run's limits, rounded down with no minimum (a run too small to have a share gives none, which is what the card case's one-byte run spends; a POSITIVE floor spent before the step's first check withdraws the card's predictions too, counted `card_withdrawn:budget`, the starvation describe's third arm, P1): for the default budget fts 13.5 s and 76.8 MiB, nodes 9 s and 51.2 MiB, card 4.5 s and 25.6 MiB, census 9 s and 51.2 MiB. **The overrun bound:** a scheduled pass may overrun RUN_BUDGET_MS by at most the floors' sum, 36 s and 204.8 MiB, plus one unit's overrun per step (a blob, a leaf, a card, a merge step or a census chunk with its file clock): about 126 s of budgeted work plus four units, well inside `CARRIER_KILL_S` (600 s); the timer (`OnUnitActiveSec=2min`) never starts a second instance while one runs. The floors charge bytes the steps READ (compressed blobs); their writes are index rows, so the §9.3 floor's one-run headroom is not what they spend. **Why the floors are the shares:** a floor smaller than the share would starve a step to less than its share exactly when discovery overruns, the cold-cache pass the fix is for; a larger one would add overrun for no measured need. Measured shape it fixes: a cold pass whose discovery spent 70-87 s reached `deriveFts` after its 67.5 s ceiling, and the leaves after theirs (P5, P6, P13). Pins: Task 4's slice case (a floor from the step's start even past the run, in ms and in bytes, P16), the starvation describe's second arm (a discovery that jumps the clock past the whole run: all four steps still advance, measured red on Task 3's tree; the census asserted on this pass alone, P17) and its third arm (a positive card floor of 900 ms, from a run injected through `deps.budget`, spent before the card step's first check, P1), the retitled card case (its zero byte floor), mutants M4f to M4j, M4l and M4m.
- **D-6940** — `history-status-reads-no-walk-state` (Task 2): NEW departure (no spec §16 row). `status`'s meta read (`STATUS_SQL.meta`) skips every `sidecar_walk:` row (`WHERE k NOT LIKE 'sidecar\_walk:%' ESCAPE '\'`, built from lib's `SIDECAR_WALK_META`). A walk's state is the sweep's working memory, up to MBs a row near `SIDECAR_WALK_CHARS_MAX`, and `status` loaded every meta row on every call (P22). `status`'s output is unchanged: no field of the envelope reads those rows. Pins: Task 2's status case (the statement read from the module, run against a store holding a several-MB walk row), mutant M2h; the cost case's EXPLAIN check stays green.
- D-6941: issued, unused.
