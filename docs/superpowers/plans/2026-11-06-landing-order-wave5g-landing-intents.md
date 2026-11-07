# Landing order, wave 5g — landing intents at dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dispatch may name the change its wave makes, as one or more landing intents. While a run of another programme in the same project holds one of those intents, the dispatch is refused `intent-held`, before anything happens on the fleet (spec §5.5).
- **The key** is the repository's issue or PR number, `#<n>`, or a deviation number, `D-<n>`. A dispatch names at most 8 keys, each once (D-8081).
- **The hold** lasts while the holding run is not `done` or `failed`. It ends with the run, by whatever door closes it, and nothing writes its end (D-8082).
- **A programme never blocks itself**, so wave N+1 may name what wave N named (D-8083). A review run names no intents (D-8084).
- **The refusal** is the last check of dispatch's `request` step. It answers 409 with the key and the holding run, and the run stays `planned` (D-8085).
- **One writer.** The intents are written in the transaction that marks the run dispatched, and the dispatch's `200` names the keys it wrote, so a coordinator can tell a server that took no hold (D-8086).
- **Not journalled.** Intents live in `coord.db` beside the runs that hold them, and the spec's sentence is amended to say so (D-8080; the operator's item 60, answered 2026-11-07).

**Why:**
- Spec §5.5 counts 28 PRs in 120 days that were closed unmerged because a sibling landed the same change first, and §10 sets stage 5's target for that count at under 5. An intent makes the second dispatch of the same change a refusal instead of a wasted wave.
- 5g is the third of the three sub-waves that share the line's schema and store (5e, 5f, 5g; Decisions, 2026-10-30 23:24). It adds a table of its own (D-7611, "`landing_intents` gets its own slot in 5g with its writer").

**Architecture:**
- **Task 1** (`shared/landingIntents.ts`, `server/src/coord/schema.ts`, `server/src/coord/store.ts`): the L0 words and the key grammar; one migration (slot 41) with the table; the store's held read and its one writer inside `CoordStore.dispatchRun`.
- **Task 2** (`server/src/coord/dispatchDecide.ts`, `server/src/coord/dispatch.ts`, `server/src/coord/routes.ts`, `shared/api.ts`): the body field, the refusal code, the check in the `request` step and the wire answer.
- **Task 3** (`ccd/coordinator-skill/SKILL.md`, `ccd/coordinator-skill/references/wave-lifecycle.md`, `README.md`): the skill text, README's dispatch sentence, and the carried D-7942 wording.
- **Task 4:** the gate, the PR and the wave-done.

**Tech Stack:** TypeScript (Node ≥ 22.16) and `node:sqlite` in the server; Markdown skills; vitest with a temporary coord.db.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`: §5.5 (Data, and Entries and pins), §7 (the coord.db invariant), §10 (stage 5's metric), §13 (no path ownership).

**Other sources:**
- the ledger, `docs/superpowers/programs/landing-order.md`: row 5g, the Decisions entries of 2026-10-30 23:24 and 2026-10-31 08:14, and the Carried constraints (the first, on a `sweep` close; and "From wave 5f's review (1413)", D-7942);
- wave 5e's plan (`docs/superpowers/plans/2026-10-31-landing-order-wave5e-landing-line-core.md`, D-7611) and wave 5f's plan and departures note (`docs/superpowers/plans/2026-10-31-landing-order-wave5f-authority-recovery-attributed-writes.md`, `docs/superpowers/plans/2026-10-31-landing-order-wave5f-departures.md`).

**Prerequisite:** waves 5e (#2020) and 5f (#2246) are on `main`. The fleet box needs nothing new: 5g changes no `ccd` verb and no hook.

**Plan review.**
- **Drafting.** Two Opus readers surveyed `main` at `5dd21cdb2` first: one the dispatch route, the line's store and journal and the run lifecycle; the other the spec, the ledger, the 5e and 5f plans and the skills. The coordinator wrote the plan from both.
- **Review.** Three Opus lenses then read the whole plan (cross-task executability, spec fidelity, fail-closed with the repository's rules), and a Sonnet refuter checked each important finding. Six important findings held, and each is answered:
  - `coord-db.test.ts` pins the schema version, so Task 1 moves its pins;
  - the D-7942 sentence is pinned whole in `coordinator-skill.test.ts`, so Task 3 changes those pins;
  - a run is dispatched once, so the insert is a plain `INSERT`, and a repeated key is tested at the store, where it rolls the dispatch back;
  - a skill mutation row that could not go red now removes the code from every skill file;
  - the gate-order rows cover every new adjacent pair, and each mutation row names a row that exists;
  - a census pins the one writer.
  One important finding was refuted: the existing gate-order rows do not break.
- **Minors.** Each minor finding is answered: where `takenAt` comes from, fresh fixtures for the route cases, the L0 file's purity guard, an `unknown` or unrecognised state still holding, the 'address' item staying carried, and a `200` that names the keys it took, so a server older than 5g reads as having taken no hold.

## The operator's two choices (item 60)

The spec leaves two things open, and the second departs from its text. The operator answered both as proposed on 2026-11-07 (item 60), and the spec's §11 records them as rulings 16 and 17.
1. **The key** is `#<n>` or `D-<n>` (D-8081). A key stops a duplicate only if two coordinators would each write the same key for the same change, and those are the two numbers the fleet already shares. Free text would rarely match.
2. **No journal** (D-8080). The spec says intents are journalled to `~/.ccrc/landing.log`. But a hold ends when its run ends, and runs live only in `coord.db`, so an intent restored from the journal without its run has nothing to judge it by. The journal's parser also refuses every record kind it does not know (`landingJournalPolicy.ts#parseLandingJournal`), so after the first intent record, a server rolled back to a build from 5f up to just before 5g (the builds that read `landing.log`) would refuse to start until the file was moved aside. Intents therefore live in `coord.db` with their runs: a lost database loses both together, and a snapshot restores both together. `CLAUDE.md` needs no change: its coord.db bullet already lists `the landing line` among what a lost database loses, and its authority-recovery sentence lists what `landing.log` restores, which intents are not.

## What this does not claim
- **No journal record, and no `CLAUDE.md` change** (D-8080). The spec's §5.5 and §7 sentences are amended on the plan's own PR.
- **No read route and no view field** (D-8087). The refusal names the holding run, which is all the coordinator needs to act. `GET /api/landing` is unchanged. The console's doors are 5k's.
- **No release write.** Nothing in close, abandon, the dead-coordinator lane or reclaim changes (D-8082).
- **No instrument** (D-8088). Stage 5's §10 metric is read by the coordinator at the two-week reading, by hand.
- **No path keys.** Keying on files would be path ownership, which §13 and ruling R8 rule out.
- **No landed reader** (5h), **no binding order or next-to-land mail** (5i), **no doors** (5j, 5k).
- **The carried 'address' item stays carried.** A requested change the operator answers 'address' still has no mail form of its own (Carried constraints, from wave 5b's reviews). It is a landing-route rule, not a dispatch one, so it goes to 5i, which makes the order binding.

## Global Constraints
- **Modules first.** Run `npm ci` in `server/` before Task 1.
- **A temporary coord.db only.** Never run `ccd`, `ccrc`, `tmux` or `gh` against the live HOME.
- **Tests.**
  - Every test runs as `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 <files>` from `server/`, in the foreground, with a timeout of at least 600000 ms.
  - `typecheck-tests` runs alone.
  - `tsc --noEmit` runs for the server.
- **The architecture rules.**
  - `coord.db` stays synchronous.
  - Decide in L1 (`dispatchDecide.ts`), act in L4 (`dispatch.ts`, `routes.ts`). The store runs SQL only.
  - L0 `shared/landingIntents.ts` imports nothing.
  - No overloaded null at a seam: absent `intents` and `[]` both mean none, and say so in one comment; a refusal's `key` and `holder` are present exactly on `intent-held`.
- **The migration slot.** Re-measure on `origin/main` before the PR: `git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'` prints 40 today, and this wave takes 41. If `main` has moved, take the next slot, move every literal with it (the plan's own files and `coord-db.test.ts`'s pins), and report it.
- **Growth.** Run `growth-check` with `GROWTH_CHECK=1` after `git fetch origin main`. `store.ts`, `routes.ts` and `dispatch.ts` growth is waived by the new file under `shared/` (`L1_L2_NEW_FILE_DIRS`), so no waiver is written. Report each net delta.
- **One state at push.**
  - Commit each task on the workspace's own branch.
  - Between Task 2 and Task 3, `coordinator-skill.test.ts`'s refusal-code census is red BY DESIGN: Task 2 adds `intent-held` to `RunRefuseCode`, and Task 3 names it in the skill.
  - Push nothing until Task 4's gate is green.
- **The verdict fence is byte-identical.** On `origin/main`, the 254 body lines of `wave-lifecycle.md`'s `### 5b` `bash` block hash to `dec52b5aaf9d6166853a25a18db29d2203a38fd6ace044f7c7068e43c4eef3a7` (measured 2026-11-06 at `5dd21cdb2`).
- **`CLAUDE.md` does not change.**
- **Skill text.**
  - No clause is added or removed: `CONTRACT` stays twenty in `coordinator-skill.test.ts` and nineteen in `worker-skill.test.ts`.
  - The two dispatch body literals that `coordinator-skill.test.ts` pins (in `SKILL.md` step 2 and in `wave-lifecycle.md` §2) stay byte-identical. The `intents` field is named in sentences of its own.
  - No new skill sentence holds a double quote.
  - Every paragraph written in `wave-lifecycle.md` wraps at 80 columns.
  - Step 6 keeps its five-space continuation indent.
- **Words.** Write "landing intent" in prose and `landing_intents` in SQL. "Intent" alone already names the coordinator intent (`POST /api/coordinators/:session/intent`) and the update intents (`POST /api/updates/intent`).
- **Cite code by symbol or `@anchor`,** never by file and line.
- **Mutations.** Run them sequentially in the worktree, bounded with `timeout -k` and a measured `ulimit -u`. Restore each mutated file from a saved copy with its sha256 checked, never with `git checkout`, and keep each row's log under `.superpowers/sdd/`.
- **Neutral names only.** The repository is public (`project-a`, `prog-a`, `lane-a`).
- **Deviation numbers are issued, never chosen.**
  - This plan defines D-8080 to D-8089, issued on 2026-11-06.
  - A departure found during execution is named by slug in the wave-done, and the coordinator numbers it.
- **Commits** go on the workspace's own branch. Never update-branch, rebase or force-push.

## Review Focus
1. **Refused before the fleet** (D-8085). An `intent-held` or an `intents` grammar refusal calls no `ccd` verb, lists no registry, writes no row and leaves the run `planned`. The held read runs only after every other `request` check has passed, and only when the dispatch names a key.
2. **A hold ends with its run, by any door** (D-8082). A run closed `done` or `failed` by the close route, the abandon door, the archive door's `programme:'end'` or the dead-coordinator lane (`causedBy:'sweep'`) holds nothing, with no write on the close path. A run at `awaiting-review`, `merging` or `closing`, or one whose state column reads `unknown` or a word outside the vocabulary, still holds: the read excludes the terminal states only.
3. **Who blocks whom** (D-8083, D-8084). Another programme's open run in the same project blocks. The same programme's run never blocks. A run in another project never blocks. A review run naming any key is refused `bad-request`.
4. **One writer, in the dispatch's transaction** (D-8086). A dispatch whose transaction throws or whose transition is refused writes no intent, and a census pins that `CoordStore.dispatchRun` is the only writer. A dispatch that succeeds writes every named key once and names them in its `200`.
5. **The grammar fails closed** (D-8081). Anything but an array of at most 8 distinct strings, each `#<n>` or `D-<n>` with `n` a positive integer of at most nine digits and no leading zero, is refused `bad-request` with a `detail` that begins `intents:`. Absent `intents` and `[]` mean none, and call no read.

**Task order:** 1, 2, 3, 4. A test that needs an earlier task's code says so, and its red-first is measured after that task is on the branch.

---
### Task 1: the words, the table and the one writer

**Files:**
- Create: `shared/landingIntents.ts`
- Modify: `server/src/coord/schema.ts` (`MIGRATIONS`, slot 41)
- Modify: `server/src/coord/store.ts` (`CoordStore.heldLandingIntents`, `CoordStore.dispatchRun`)
- Create (test): `server/test/landing-intents-words.test.ts`, `server/test/landing-intents-migration.test.ts`, `server/test/landing-intents-store.test.ts`
- Modify (test): `server/test/coord-db.test.ts` (its two `toBe(40)` pins of `COORD_SCHEMA_VERSION` and its `MIGRATIONS.length` pin become 41, and `MIGRATIONS[40] (landing_intents, landing order wave 5g)` joins both of its `MIGRATIONS[n]` comment lists); `server/test/landing-entry-census.test.ts` (one case: the one writer)
- No ring-map entry: only `server/src` and `pwa/src` files are mapped. The L0 file's purity is `rings/shared-imports.test.ts`'s, which Step 4 runs.

**Interfaces:**
- Produces, in `shared/landingIntents.ts` (L0, no imports):
  - `LANDING_INTENT_KEY_RE: RegExp`, exactly `/^(?:#[1-9][0-9]{0,8}|D-[1-9][0-9]{0,8})$/`;
  - `LANDING_INTENTS_MAX = 8`;
  - `interface LandingIntentHold { key: string; runId: number; program: string }`;
  - `parseLandingIntents(raw: unknown): { ok: true; keys: readonly string[] } | { ok: false; detail: string }`. `undefined` and `[]` answer `{ok: true, keys: []}`. Every refusal's `detail` begins `intents: `, and names which rule failed: not an array, more than 8, not a string, not a key (quoting the regex source), or a repeated key.
- Produces, in `CoordStore`:
  - `heldLandingIntents(project: string, keys: readonly string[]): readonly LandingIntentHold[]` — every row for that project and those keys whose run's state is not in `TERMINAL_RUN_STATES` (read through the existing `TERMINAL_RUN_STATES_SQL`), ordered by key then run id. An empty `keys` answers `[]` without a query.
  - `dispatchRun`'s input gains `intents?: readonly string[]`. Inside its existing `tx`, after `advanceInner` answers `ok` and after the items, each key is written with a plain `INSERT … SELECT` from the run's own row: `runId` the run, `project` and `setBy` its `project` and `claimedBy`, and `takenAt` its `dispatchedAt`, which `markDispatched` wrote earlier in the same transaction. `advanceInner` is unchanged. `setBy` is nullable with one meaning, stated in the migration's comment: the run had no claimant. The primary key `(runId, key)` makes a repeated key throw, which rolls the whole dispatch back; the grammar refuses a repeated key and the transition table allows one dispatch per run, so the throw is a backstop, not a path. Nothing else in `server/src` writes the table.

- [ ] **Step 1: Write the failing tests.**
  - `landing-intents-words.test.ts`: accepts `#1`, `#123456789`, `D-1`, `D-8080`; refuses `#0`, `#01`, `#1234567890`, `D-0`, `d-1`, `#12 `, `issue:1`, `''`; refuses 9 keys and a repeated key; `undefined` and `[]` give no keys; each refusal's `detail` starts `intents: `. Also: the file imports nothing (the purity scan the 5e plan used for `shared/landingLine.ts`).
  - `landing-intents-migration.test.ts`, in the shape of `landing-journal-migration.test.ts` (its `SLOT` constant and the `slice(0, SLOT - 1)` check that no earlier entry names the table): slot 41 creates `landing_intents(runId, project, key, setBy, takenAt)` with `PRIMARY KEY (runId, key)`, every column `NOT NULL` but `setBy`, `runId` referencing `runs(id)`, and the index `landing_intents_by_key` on `(project, key)`; a file at `user_version 40` migrates to 41 with its rows intact.
  - `landing-intents-store.test.ts`, with real runs opened in a temporary coord.db:
    - a dispatched run's keys are held; the same run closed `done`, and another closed `failed` (through the abandon path, `causedBy` `operator` and `sweep` both), hold nothing;
    - runs at `awaiting-review`, `merging` and `closing` still hold, and so do a run whose raw `state` column reads `unknown` and one whose column holds a word outside the vocabulary (`queued`): the read excludes only the terminal states;
    - another project's row with the same key is not returned;
    - a `dispatchRun` whose transition is refused writes no row;
    - a `dispatchRun` called directly with `intents: ['#1', '#1']` (the store does not parse, so this passes the grammar on purpose) throws, and afterwards the run is still `planned`, holds no row and has no items;
    - `setBy` is the run's `claimedBy`, and `takenAt` its `dispatchedAt`.
  - `landing-entry-census.test.ts`, one case in the shape of its `landing_entries` case (`allWrites`, `inSymbol`): every write to `landing_intents` outside `schema.ts` is an `INSERT` inside `CoordStore.dispatchRun`, and there is at least one.
- [ ] **Step 2: Run them and see them fail** (the module and the table do not exist).
- [ ] **Step 3: Implement** the L0 file, the migration (its comment in the shape of slot 40's: what the table is, its one writer `CoordStore.dispatchRun`, its one reader `CoordStore.heldLandingIntents`, that a hold ends when its run is terminal and nothing writes that end, that an older build opening a file at `user_version 41` takes rule 3 and never names the table, and the two re-measure commands), and the two store methods.
- [ ] **Step 4: Run the three files, `landing-entry-census.test.ts`, `rings/shared-imports.test.ts` and the migration readers** (`coord-db.test.ts`, `landing-line-migration.test.ts`, `landing-journal-migration.test.ts`) **and see them pass.**
- [ ] **Step 5: Measure the mutation rows, then commit.**

| Row | Mutation | Predicted red |
|---|---|---|
| 5G-DATA-1 | `heldLandingIntents` drops the terminal-state filter | store: a `done` run holds |
| 5G-DATA-2 | `heldLandingIntents` drops the project filter | store: another project's row returned |
| 5G-DATA-3 | the insert runs before `advanceInner` answers | store: a refused transition writes a row |
| 5G-DATA-4 | the inserts run in a `tx` of their own after the dispatch's | store: the repeated-key throw leaves the run dispatched |
| 5G-DATA-8 | a second `INSERT INTO landing_intents` is added in another store method | census: a write outside `dispatchRun` |
| 5G-DATA-5 | the regex accepts a leading zero (`[0-9]` for `[1-9]`) | words: `#01` accepted |
| 5G-DATA-6 | `LANDING_INTENTS_MAX` reads 9 | words: 9 keys accepted |
| 5G-DATA-7 | the repeated-key check is removed | words: a repeated key accepted |

```bash
git add shared/landingIntents.ts server/src/coord/schema.ts server/src/coord/store.ts server/test/landing-intents-*.test.ts server/test/coord-db.test.ts server/test/landing-entry-census.test.ts
git commit -m "feat(landing): the landing_intents table, its key grammar and its one writer (landing-order 5g, D-8080 to D-8086)"
```

---
### Task 2: the refusal at dispatch

**Files:**
- Modify: `shared/api.ts` (`RunRefuseCode`, `RUN_REFUSE_CODE_MAP`)
- Modify: `server/src/coord/dispatchDecide.ts` (`RequestFacts`, `RequestPlan`, `decideRequest`)
- Modify: `server/src/coord/dispatch.ts` (`DispatchOutcome`'s `refused` arm, `dispatchRun`)
- Modify: `server/src/coord/routes.ts` (the `POST /api/runs/:id/dispatch` handler and `sendDispatchOutcome`)
- Modify (test): `server/test/dispatch-decide.test.ts`, `server/test/dispatch-gate-order.test.ts`
- Create (test): `server/test/landing-intents-dispatch.test.ts`

**Interfaces:**
- Consumes: Task 1's `parseLandingIntents`, `LandingIntentHold` and `CoordStore.heldLandingIntents`, and `dispatchRun`'s `intents` input.
- Produces:
  - `RunRefuseCode` gains `'intent-held'`.
  - `RequestFacts` gains `intents: unknown` and `held: (project: string, keys: readonly string[]) => readonly LandingIntentHold[]`, a synchronous thunk.
  - `RequestPlan` gains `intentKeys: readonly string[]`.
  - The `refused` arm of `DispatchOutcome` adds `'intent-held'` to its `code` union, and the optional fields `key?: string` and `holder?: { runId: number; program: string }`, each present exactly on `intent-held`.
  - `dispatchRun(deps, id, brief, items, route, slug, intents)`: the new parameter is last and defaults to `undefined`.
  - The `ok: true` arm of `DispatchOutcome` gains `intents: readonly string[]`, the keys written (`[]` when none were named), and the `200` body carries it. A coordinator that named keys and reads a `200` with no `intents` field is talking to a server older than 5g, which took no hold (spec §7: absence means unknown).
  - The wire: `409 {"ok":false,"refused":"intent-held","key":"#123","holder":{"runId":42,"program":"prog-b"}}`.

**The order inside `request`** (D-8085):
1. The grammar is read with the other body fields, after the `slug` block: `parseLandingIntents(intents)` refused answers `bad-request` with its `detail`.
2. On a run of kind `review`, any key answers `bad-request` with the detail `intents: a review run names no landing intents` (D-8084).
3. The held check is the last check of the step, after `bad-session`. It calls `held(run.project, keys)` only when `keys` is not empty, drops every holder whose `program` equals `run.program` (D-8083), and refuses on the first that remains, naming its key and its run.

The step stays synchronous from `coord.run(id)` to its answer: the thunk reads `coord.db`, which is synchronous. The `worker-starting` re-run repeats the step, and so repeats the check.

- [ ] **Step 1: Write the failing tests.**
  - `dispatch-decide.test.ts`: a refused grammar answers `bad-request` with its `detail`; a review run with a key answers `bad-request`; another programme's hold answers `intent-held` with `key` and `holder`; the same programme's hold answers `go`; no keys calls no thunk (a thunk that throws proves it); an earlier refusal (`bad-transition`, `bad-session`) calls no thunk; `go` carries `intentKeys`.
  - `dispatch-gate-order.test.ts`: one row per adjacent pair that one input can trip together, each with its reorder mutant:
    - `slug` before the `intents` grammar;
    - the `intents` grammar before the review-run check: a review run whose `intents` is `"#1"` (not an array) answers the grammar's `detail`, not the review-run one;
    - the `intents` grammar before `hold-invalid`, and the review-run check before `hold-invalid`;
    - the grammar before the held check: `["#123", "#123"]` while another programme holds `#123` answers `bad-request` (a mutant that reads holds from the raw array answers `intent-held`);
    - `bad-session` before `intent-held`;
    - `intent-held` before `paused` (the `admit` step).
    Mirror each `request`-step row in `dispatch-decide.test.ts`. The `intent-held` before `paused` row crosses two steps, so it is measured through `dispatchRun` in `dispatch-gate-order.test.ts` alone, as the existing session-then-pause row is.
  - `landing-intents-dispatch.test.ts`, through the route with the fixture `ccd` that records its calls, each case on a fresh fixture:
    - programme A dispatches with `["#123"]`: `200` with `intents: ["#123"]`, one row; a dispatch naming none answers `intents: []`;
    - programme B's run in the same project, dispatching `["#123", "D-9"]`: `409` with the wire body above, no `ccd` call recorded, the run still `planned`, no row written for B;
    - A holds `#123`, then A's run is closed `done`: B's dispatch now succeeds;
    - A holds `#123` with wave 1 at `merging`: A's wave 2 run (same programme) dispatching `["#123"]` answers `200`;
    - a run in another project naming `#123`: `200`;
    - the body `{"brief":"go","intents":"#123"}` answers `400` with `error:"bad-request"` and a `detail` starting `intents:`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** the code, the decider's three checks, the executor's thunk and its pass-through of `intentKeys` to `coord.dispatchRun` and into the `ok` answer, the handler's read of `body.intents` (both calls, the first and the `worker-starting` re-run), and `sendDispatchOutcome`'s spread of `key` and `holder` by presence, beside the `by` spread and with the same reason.
- [ ] **Step 4: Run the three files, then `run-routes.test.ts`, `mail-routes.test.ts`, `resume-reclaim-l0.test.ts` and `run-states.test.ts`, and see them pass.** `coordinator-skill.test.ts` is red now, by design, until Task 3.
- [ ] **Step 5: Measure the mutation rows, then commit.**

| Row | Mutation | Predicted red |
|---|---|---|
| 5G-DISPATCH-1 | the held check moves before `bad-session` | gate order: `bad-session` before `intent-held` |
| 5G-DISPATCH-2 | the same-programme filter is removed | decide and route: wave 2 refused |
| 5G-DISPATCH-3 | the held check runs after `admit` | gate order: `intent-held` before `paused` |
| 5G-DISPATCH-4 | the thunk is called with no keys | decide: the throwing thunk fires |
| 5G-DISPATCH-5 | the review-run check is removed | decide: a review run's key accepted |
| 5G-DISPATCH-6 | `sendDispatchOutcome` drops `holder` | route: the 409 body lacks `holder` |
| 5G-DISPATCH-7 | the executor does not pass `intentKeys` to `coord.dispatchRun` | route: B's dispatch succeeds |
| 5G-DISPATCH-8 | the `200` body drops `intents` | route: A's answer lacks `intents` |
| 5G-DISPATCH-9 | the held check reads the raw array before the grammar | gate order: the repeated held key answers `intent-held` |

```bash
git add shared/api.ts server/src/coord/dispatchDecide.ts server/src/coord/dispatch.ts server/src/coord/routes.ts server/test/dispatch-decide.test.ts server/test/dispatch-gate-order.test.ts server/test/landing-intents-dispatch.test.ts
git commit -m "feat(dispatch): a dispatch names its landing intents and another programme's hold refuses it (landing-order 5g, D-8083 to D-8085)"
```

---
### Task 3: the skill text, README and the carried step-6 wording

**Files:**
- Modify: `ccd/coordinator-skill/SKILL.md`
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md`
- Modify: `README.md` (the run-lifecycle paragraph on what dispatch checks)
- Modify (test): `server/test/coordinator-skill.test.ts`: step 6's pins of the D-7942 sentence: grep the file for the old sentence's closing words, `grep -n 'with the run at .working.' server/test/coordinator-skill.test.ts`, and change every hit. They are `REPORT_LESS` (the review 1303 F2 case), the inline whole-paragraph array and the `toContain` in the 5f report-less pin case, and `STEP6_AFTER` if the wrap moves, changed to the new wording in the same commit; no clause pin changes

**Interfaces:**
- Consumes: Task 2's code, field and wire body.

- [ ] **Step 1: The refusal lists.** Add `` `intent-held` `` to `SKILL.md`'s sentence "The refusals you will actually meet are …", and to the sentence that names what `/dispatch` puts on `refused`. Run `coordinator-skill.test.ts`: its refusal censuses still fail until Step 2 adds the table row.
- [ ] **Step 2: `wave-lifecycle.md` §2.**
  - A row in the `refused` table: `intent-held` | another programme's run in this project holds a landing intent this dispatch names, and is not `done` or `failed`; `key` names the intent and `holder` the run and its programme | stop. Nothing was spawned and the run is still `planned`. Mail that run's coordinator, naming the key, through its `runId`, and report it in your turn. Dispatch again without the key only once that coordinator or the operator says the two waves are not the same change. Never retry it unchanged.
  - A paragraph, beside the body literal and not inside it: a dispatch may carry `intents`, an array of at most 8 keys, each the issue or PR number its wave answers (`#<n>`) or a deviation number (`D-<n>`). Name one when another programme could take the same change. A hold lasts until your run is `done` or `failed`, your own later waves never trip it, and a review run names none. The `200` names the keys it took in `intents`; a `200` with no `intents` field came from a server older than 5g, which took no hold, so say so in your turn.
- [ ] **Step 3: `SKILL.md` step 2.** One sentence after the body literal, not inside it: the dispatch may also carry `intents` (wave-lifecycle §2).
- [ ] **Step 4: D-7942, carried from wave 5f's review (D-8089).** In step 6, the sentence ending "report it to the operator with the run at `working`" says instead that you report it with the run's state as the advance answered it: `working` after `ok`, still `merging` after a refusal, and unknown after an uncertain answer, which you then read with `runs list`. Keep the five-space indent and the 80-column wrap, and no double quote. Change the three pins of the old sentence in `coordinator-skill.test.ts` to the new one, kept whole-paragraph so it cannot widen.
- [ ] **Step 5: README.** In the run-lifecycle paragraph that says what `POST /api/runs/:id/dispatch` checks, one sentence: the body may name landing intents, and a key another programme's open run in the project holds answers 409 `intent-held` with the key and that run, before any fleet act.
- [ ] **Step 6: Run** `coordinator-skill.test.ts`, `worker-skill.test.ts`, `docs-parity.test.ts`, `citations.test.ts`, `anchors.test.ts` and `readme-holds.test.ts`, **and see them pass.** Check the verdict fence's hash is unchanged.
- [ ] **Step 7: Measure the mutation rows, then commit.**

| Row | Mutation | Predicted red |
|---|---|---|
| 5G-SKILLS-1 | `intent-held` removed from every skill file | coordinator-skill: the reverse census |
| 5G-SKILLS-2 | the `wave-lifecycle.md` row removed | coordinator-skill: the code is not explained there |
| 5G-SKILLS-3 | step 6's old sentence restored | coordinator-skill: the report-less paragraph pin |

```bash
git add ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/wave-lifecycle.md README.md server/test/coordinator-skill.test.ts
git commit -m "docs(skills): landing intents at dispatch, and step 6 names the run's answered state (landing-order 5g, D-8081 to D-8085, D-8089)"
```

---
### Task 4: the gate, the PR and the wave-done

- [ ] **Step 1: The fence and the slot.** The verdict fence hash as in Global Constraints; the migration slot re-measured (40 before this wave's entry).
- [ ] **Step 2: The suites,** each in its own foreground `ccrc test` process: every file this plan creates or names; `single-definition/*`, `rings/*`, `census-w8/*`, `coord-policy-rings`, `box-token-census` (no count moves: no route is added), `citations`, `anchors`, `docs-parity`, `topology-clean` and `dtbd`; then `git fetch origin main` and `deviation-refs`; `growth-check` with `GROWTH_CHECK=1`; `typecheck-tests` alone; the server's `tsc --noEmit`.
- [ ] **Step 3: The mutation table,** every row of Tasks 1 to 3 measured red when mutated and green when restored from its saved copy.
- [ ] **Step 4: `git diff origin/main -- CLAUDE.md` is empty.**
- [ ] **Step 5: The private-name scan before every push.** Push, and open one PR from the workspace's branch to `main`, ready for review. Its body names the plan by its durable link, the deviation block, the mutation table and the suites.
- [ ] **Step 6: The wave-done.** Wait for the PR's fast run on the exact tip to finish, read its selection, and run any selected server file your list missed (Decisions, 2026-10-31 15:17). Then send one wave-done at that tip, with its `suite:` and `failure:` lines, the mutation table, the commits and the PR number.

---
## Deviations found

This plan's numbers are D-8080 to D-8089, issued on 2026-11-06.

- **D-8080** — `landing-intents-not-journalled` (Task 1): landing intents live in `coord.db` beside the runs that hold them and write no `landing.log` record, departing from spec §5.5's and §7's journalling sentence. A hold ends with its run, and runs live only in `coord.db`, so a journalled intent restored without its run has nothing to judge it by; and the journal's parser refuses unknown kinds, so the first intent record would stop a server rolled back to a build from 5f up to just before 5g, the builds that read `landing.log`, from starting. The operator ruled on it in item 60 on 2026-11-07, as proposed, and the spec's two sentences are amended on the plan's PR (§11, ruling 17).
- **D-8081** — `landing-intent-key-grammar` (Tasks 1, 3): a key is `#<n>` or `D-<n>`, with `n` a positive integer of at most nine digits and no leading zero. A dispatch names at most 8, each once. Anything else is refused `bad-request` with a `detail` starting `intents:`.
- **D-8082** — `landing-intent-held-while-run-open` (Task 1): a landing intent is held while its run's state is not in `TERMINAL_RUN_STATES`, and nothing writes its end. Every door that closes a run releases it alike, including the dead-coordinator lane's `sweep` close, which the first carried constraint says a landing reading must treat as the operator's abandon. Closes gain no dependency on the line.
- **D-8083** — `landing-intent-same-programme-never-blocks` (Task 2): a hold by a run of the dispatching run's own programme never refuses. One coordinator owns a programme (clause 8) and opens wave N+1 before it closes wave N, so a per-run hold would otherwise refuse the programme's own next wave.
- **D-8084** — `review-runs-name-no-landing-intents` (Task 2): a review run changes nothing, so a key on its dispatch is refused `bad-request`.
- **D-8085** — `intent-held-last-in-request` (Task 2): the held check is the last check of dispatch's `request` step, after `bad-session` and before the `admit` step's pause and caps, so it refuses before any listing or fleet act. Its answer is `409 refused:'intent-held'` with `key` and `holder: {runId, program}`.
- **D-8086** — `one-landing-intent-writer` (Task 1): the only writer is `CoordStore.dispatchRun`, inside its transaction, after the transition answers `ok`. `project` and `setBy` come from the run row. A dispatch that fails after its fleet acts writes no intent, as it writes no transition. `takenAt` is the run's `dispatchedAt`. The insert is a plain `INSERT`: the grammar and the one-dispatch transition make a repeated key unreachable, and if one arrives its throw rolls the dispatch back. The `200` names the keys written, so a `200` with no `intents` field reads as a server older than 5g, which took no hold.
- **D-8087** — `no-landing-intent-read-in-5g` (scope): no route and no `GET /api/landing` field shows held intents; the refusal names the holder. The console's view, if wanted, is 5k's.
- **D-8088** — `stage-5-duplicate-count-read-by-hand` (scope): §10's stage-5 metric (duplicate-intent closed PRs, baseline 28 in 120 days, target under 5) has no committed instrument, and 5g adds none. At the reading two weeks after 5g's rollout, the coordinator lists the PRs of this repository closed unmerged in the window, classifies each by hand, and records the count and the method in the ledger.
- **D-8089** — `carried-d7942-step-six` (Task 3): wave 5f's review carried D-7942 to the next wave that edits the coordinator skill. 5g edits it, so step 6 now reports the run's state as the advance answered it.

## Where things stand

**Agreed:** the spec's stage 5 and its split into sub-waves (Decisions, 2026-10-30 23:24); 5g's table of its own (D-7611); keys of `#<n>` or `D-<n>`, and intents kept in `coord.db`, not journalled (item 60, 2026-11-07; D-8080, D-8081; spec §11, rulings 16 and 17).

**Waiting on you:**
- The plan's approval.

**Later:** 5h (the landed reader), 5i (the line's head), 5j and 5k (the doors); and stage 5's two-week reading (D-8088).
